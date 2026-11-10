const https = require('https');
const { getPool, ensureTables, parseBody } = require('../_db');

// Basit fallback cümle üreteci (AI anahtarı yoksa veya hata verirse sıfır gecikmeli şablon)
function generateFallbackLesson(levelWords, levelNumber) {
  const wordsData = levelWords.map((w, idx) => {
    const en = w.english;
    const tr = w.turkish;
    const pron = w.pronunciation || '';
    return {
      index: idx + 1,
      english: en,
      turkish: tr,
      pronunciation: pron,
      example_en: `She made a continuous effort to understand ${en} in everyday life.`,
      example_tr: `Günlük hayatta ${tr} kavramını anlamak için sürekli çaba gösterdi.`
    };
  });

  const quizData = levelWords.map((w, idx) => {
    const en = w.english;
    const otherWords = levelWords.filter(item => item.english !== en);
    // 4 yanlış seçenek seç
    const shuffledOthers = [...otherWords].sort(() => 0.5 - Math.random()).slice(0, 4);
    const optionsRaw = [
      { text: en, correct: true },
      ...shuffledOthers.map(o => ({ text: o.english, correct: false }))
    ].sort(() => 0.5 - Math.random());

    const letters = ['a', 'b', 'c', 'd', 'e'];
    const options = optionsRaw.map((opt, oIdx) => ({
      key: letters[oIdx],
      text: opt.text
    }));
    const correctLetter = options.find(o => o.text === en).key;

    return {
      question_number: idx + 1,
      sentence: `It is important to remember .................... (${w.turkish}) during our studies.`,
      target_word: en,
      turkish_meaning: w.turkish,
      options: options,
      correct_answer: correctLetter
    };
  });

  return { wordsData, quizData };
}

// Google Gemini Flash API ile yüksek kaliteli cümle ve 5 şıklı soru üretimi
async function callGeminiFlash(levelWords, levelNumber) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are an expert English teacher.
Generate learning content for Level ${levelNumber} using these 10 English-Turkish word pairs:
${JSON.stringify(levelWords.map(w => ({ en: w.english, tr: w.turkish })))}

Requirements:
1. "words_data": array of 10 objects with keys:
   - "index" (number 1 to 10)
   - "english" (word)
   - "turkish" (Turkish translation)
   - "pronunciation" (IPA/phonetic)
   - "example_en" (a natural English sentence using the word)
   - "example_tr" (accurate Turkish translation of the example sentence)
2. "quiz_data": array of 10 objects for fill-in-the-blank questions with keys:
   - "question_number" (1 to 10)
   - "sentence" (sentence with "...................." replacing the target word, include Turkish clue in parenthesis like "(ipucu: ...)")
   - "target_word" (the correct English word)
   - "turkish_meaning" (Turkish meaning)
   - "options": array of 5 objects [{"key":"a","text":"..."},{"key":"b","text":"..."},{"key":"c","text":"..."},{"key":"d","text":"..."},{"key":"e","text":"..."}] using words from this level or similar English vocabulary
   - "correct_answer": "a", "b", "c", "d", or "e"

Return ONLY a valid JSON object with keys "words_data" and "quiz_data". No markdown, no triple backticks.`;

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const rawText = parsed.candidates[0].content.parts[0].text;
          const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          const lessonJson = JSON.parse(cleanedText);
          if (lessonJson.words_data && lessonJson.quiz_data) {
            resolve({
              wordsData: lessonJson.words_data,
              quizData: lessonJson.quiz_data
            });
            return;
          }
        } catch (e) {
          console.warn('Gemini response parse error:', e);
        }
        resolve(null);
      });
    });

    req.on('error', (e) => {
      console.warn('Gemini request error:', e);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

// Seviye içeriğini al veya üretip veritabanına kaydet
async function getOrGenerateLesson(pool, userId, levelNumber) {
  // 1. Veritabanında zaten var mı? (Sıfır gecikmeli SQL önceliği)
  const existing = await pool.query(
    'SELECT level_number, words_data, quiz_data FROM generated_lessons WHERE level_number = $1',
    [levelNumber]
  );

  if (existing.rows.length > 0) {
    return {
      level_number: existing.rows[0].level_number,
      words_data: existing.rows[0].words_data,
      quiz_data: existing.rows[0].quiz_data,
      cached: true
    };
  }

  // 2. Kullanıcının tüm kelimelerini YDS zorluk puanına göre sırala
  // YDS / Akademik zorluk mantığı: Kelime uzunluğu, hece/karakter karmaşıklığı ve nadirlik
  const allUserWordsResult = await pool.query(
    'SELECT english, turkish, pronunciation FROM user_words WHERE user_id = $1',
    [userId]
  );

  let allWords = allUserWordsResult.rows;
  if (allWords.length === 0) {
    return null;
  }

  // YDS Zorluk Skoru Hesaplama:
  // - Kısa, temel kelimeler: Düşük skor (Kolay)
  // - Uzun, akademik son ekli (-tion, -ment, -ance, -ous, -able, -ity vb.): Yüksek skor (Zor)
  function calculateYdsDifficulty(w) {
    const en = (w.english || '').toLowerCase();
    let score = en.length * 10;
    const academicSuffixes = ['tion', 'sion', 'ment', 'ance', 'ence', 'ible', 'able', 'tude', 'logy', 'eous', 'ious', 'ness', 'ship'];
    academicSuffixes.forEach(s => {
      if (en.endsWith(s)) score += 25;
    });
    return score;
  }

  // Kelimeleri zorluk derecesine göre artan sırada sırala
  allWords.sort((a, b) => calculateYdsDifficulty(a) - calculateYdsDifficulty(b));

  // Her seviye (levelNumber) için sıralı havuzun uygun diliminden rastgele 10 farklı kelime seç
  // Böylece Seviye 1 en kolaylardan başlar, seviyeler ilerledikçe YDS seviyesine doğru zorlaşır
  const totalWords = allWords.length;
  const bucketSize = Math.max(10, Math.floor(totalWords / 10)); // 10 zorluk dilimi
  const bucketIndex = Math.min(9, Math.floor((levelNumber - 1) / Math.max(1, Math.ceil(50 / 10))));
  const startIdx = Math.min(bucketIndex * bucketSize, Math.max(0, totalWords - 10));
  const endIdx = Math.min(startIdx + bucketSize + 15, totalWords);

  const candidatePool = allWords.slice(startIdx, Math.max(startIdx + 10, endIdx));

  // Belirlenen zorluk aralığından seviyeye özel tohumlu (levelNumber tabanlı) rastgele 10 kelime seç
  const shuffledCandidates = [...candidatePool].sort(() => 0.5 - Math.random());
  let levelWords = shuffledCandidates.slice(0, 10);

  if (levelWords.length < 10 && allWords.length >= 10) {
    levelWords = allWords.slice(0, 10);
  }

  if (levelWords.length === 0) {
    return null;
  }

  // 3. Gemini Flash ile üretmeyi dene, aksi halde hızlı şablonla üret
  let generated = await callGeminiFlash(levelWords, levelNumber);
  if (!generated) {
    generated = generateFallbackLesson(levelWords, levelNumber);
  }

  // 4. Neon PostgreSQL'e kaydet
  await pool.query(
    `INSERT INTO generated_lessons (level_number, words_data, quiz_data)
     VALUES ($1, $2, $3)
     ON CONFLICT (level_number) DO UPDATE SET words_data = $2, quiz_data = $3`,
    [levelNumber, JSON.stringify(generated.wordsData), JSON.stringify(generated.quizData)]
  );

  return {
    level_number: levelNumber,
    words_data: generated.wordsData,
    quiz_data: generated.quizData,
    cached: false
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const pool = getPool();
  if (!pool) {
    return res.status(200).json({ success: false, error: 'Database is not connected.' });
  }

  try {
    await ensureTables();

    // GET /api/lessons?user_id=1&level=1
    if (req.method === 'GET') {
      const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
      const levelNumber = req.query.level ? parseInt(req.query.level, 10) : 1;

      if (!userId) {
        return res.status(401).json({ success: false, error: 'user_id is required.' });
      }

      // Kullanıcının mevcut seviyesini de çek
      const statRes = await pool.query(
        'SELECT current_level FROM user_statistics WHERE user_id = $1 ORDER BY id ASC LIMIT 1',
        [userId]
      );
      const userLevel = statRes.rows.length > 0 && statRes.rows[0].current_level ? statRes.rows[0].current_level : 1;

      const lesson = await getOrGenerateLesson(pool, userId, levelNumber);
      if (!lesson) {
        return res.status(400).json({ success: false, error: 'Yeterli kelime bulunamadı. Lütfen kelime ekleyin.' });
      }

      // Arka planda sessizce Seviye N+1'i üret ve önbellekle (Pre-fetching)
      setImmediate(async () => {
        try {
          await getOrGenerateLesson(pool, userId, levelNumber + 1);
        } catch (err) {
          // pre-fetch silent catch
        }
      });

      return res.status(200).json({
        success: true,
        user_level: userLevel,
        lesson: lesson
      });
    }

    // POST /api/lessons/complete - Seviye tamamlama ve seviye artırma
    if (req.method === 'POST') {
      const body = parseBody(req);
      const userId = body.user_id ? parseInt(body.user_id, 10) : null;
      const completedLevel = body.level_number ? parseInt(body.level_number, 10) : 1;
      const correctCount = typeof body.correct_count === 'number' ? body.correct_count : 0;
      const wrongWords = Array.isArray(body.wrong_words) ? body.wrong_words : [];

      if (!userId) {
        return res.status(401).json({ success: false, error: 'user_id is required.' });
      }

      // 1. Yanlış yapılan kelimeleri Zorlu Kelimeler havuzuna ekle
      if (wrongWords.length > 0) {
        const existingDiff = await pool.query(
          'SELECT id, wrong_words FROM user_statistics WHERE user_id = $1 AND game_type = $2',
          [userId, 'difficult_words']
        );
        if (existingDiff.rows.length > 0) {
          const currentWrong = existingDiff.rows[0].wrong_words || [];
          const merged = Array.from(new Set([...currentWrong, ...wrongWords]));
          await pool.query(
            'UPDATE user_statistics SET wrong_words = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [JSON.stringify(merged), existingDiff.rows[0].id]
          );
        } else {
          await pool.query(
            'INSERT INTO user_statistics (user_id, game_type, score, wrong_words) VALUES ($1, $2, $3, $4)',
            [userId, 'difficult_words', 0, JSON.stringify(wrongWords)]
          );
        }
      }

      // 2. En az 7 doğru yapıldıysa current_level değerini artır
      let leveledUp = false;
      let newLevel = completedLevel;

      if (correctCount >= 7) {
        newLevel = completedLevel + 1;
        leveledUp = true;

        const statRes = await pool.query(
          'SELECT id, current_level FROM user_statistics WHERE user_id = $1 ORDER BY id ASC LIMIT 1',
          [userId]
        );

        if (statRes.rows.length > 0) {
          const cur = Math.max(statRes.rows[0].current_level || 1, newLevel);
          await pool.query(
            'UPDATE user_statistics SET current_level = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
            [cur, userId]
          );
        } else {
          await pool.query(
            'INSERT INTO user_statistics (user_id, game_type, score, current_level) VALUES ($1, $2, $3, $4)',
            [userId, 'general', 0, newLevel]
          );
        }
      }

      return res.status(200).json({
        success: true,
        leveledUp,
        newLevel
      });
    }

    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Lessons API error:', err);
    return res.status(500).json({ success: false, error: 'Ders yüklenirken bir hata oluştu.' });
  }
};
