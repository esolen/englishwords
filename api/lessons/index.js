const https = require('https');
const { getPool, ensureTables, parseBody } = require('../_db');

// YDS / Akademik Zorluk Sıralaması Fonksiyonu:
// 1. Kısa, tek kelimelik temel ifadeler (3-5 harf) en başta (Düşük Skor: 0 - 50)
// 2. Orta uzunluktaki sıfat, zarf ve fiiller (6-8 harf) ortada (Orta Skor: 60 - 80)
// 3. Uzun akademik YDS kelimeleri (9+ harf) ve birden fazla kelimeden oluşan deyimler/phrasal verbler en sonda (Yüksek Skor: 90+)
function calculateYdsDifficulty(wordObj) {
  const en = (wordObj.english || wordObj.en || '').trim().toLowerCase();
  let score = 0;

  // Boşluk içeren deyimler veya phrasal verb'ler en zordur
  if (en.includes(' ')) {
    score += 150;
  }

  // Harf uzunluğuna göre kademelendirme
  const cleanLen = en.replace(/\s+/g, '').length;
  score += cleanLen * 10;

  // Akademik son ekler (YDS odaklı)
  const academicSuffixes = ['tion', 'sion', 'ment', 'ance', 'ence', 'ible', 'able', 'tude', 'logy', 'eous', 'ious', 'ness', 'ship', 'ical'];
  academicSuffixes.forEach(s => {
    if (en.endsWith(s)) score += 30;
  });

  return score;
}

// Fallback Hızlı Ders Üreteci
function generateFallbackLesson(levelWords, levelNumber) {
  const wordsData = levelWords.map((w, idx) => {
    const en = w.english || w.en;
    const tr = w.turkish || w.tr;
    const pron = w.pronunciation || w.ipa || '';
    return {
      index: idx + 1,
      english: en,
      turkish: tr,
      pronunciation: pron,
      example_en: `In practical contexts, understanding ${en} is essential for language mastery.`,
      example_tr: `Pratik bağlamda, ${tr} kavramını anlamak dil hakimiyeti için esastır.`
    };
  });

  const quizData = levelWords.map((w, idx) => {
    const en = w.english || w.en;
    const tr = w.turkish || w.tr;
    const otherWords = levelWords.filter(item => (item.english || item.en) !== en);
    const shuffledOthers = [...otherWords].sort(() => 0.5 - Math.random()).slice(0, 4);

    const optionsRaw = [
      { text: en, correct: true },
      ...shuffledOthers.map(o => ({ text: o.english || o.en, correct: false }))
    ].sort(() => 0.5 - Math.random());

    const letters = ['a', 'b', 'c', 'd', 'e'];
    const options = optionsRaw.map((opt, oIdx) => ({
      key: letters[oIdx] || 'a',
      text: opt.text
    }));
    const correctLetter = options.find(o => o.text === en).key;

    return {
      question_number: idx + 1,
      sentence: `Experts emphasized that .................... (${tr}) plays a vital role in this case.`,
      target_word: en,
      turkish_meaning: tr,
      options: options,
      correct_answer: correctLetter
    };
  });

  return { wordsData, quizData };
}

// Google Gemini Flash ile Cümle ve Soru Üretimi
async function callGeminiFlash(levelWords, levelNumber) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are a high-level English teacher preparing YDS / Academic vocabulary content for Level ${levelNumber}.
Use these 10 words:
${JSON.stringify(levelWords.map(w => ({ en: w.english || w.en, tr: w.turkish || w.tr })))}

Generate a valid JSON object strictly matching this schema:
{
  "words_data": [
    {
      "index": 1,
      "english": "word",
      "turkish": "translation",
      "pronunciation": "pron",
      "example_en": "Natural English sentence.",
      "example_tr": "Accurate Turkish translation."
    }
  ],
  "quiz_data": [
    {
      "question_number": 1,
      "sentence": "Sentence with .................... (clue: Turkish translation)",
      "target_word": "word",
      "turkish_meaning": "translation",
      "options": [
        {"key": "a", "text": "wordA"},
        {"key": "b", "text": "wordB"},
        {"key": "c", "text": "wordC"},
        {"key": "d", "text": "wordD"},
        {"key": "e", "text": "wordE"}
      ],
      "correct_answer": "a"
    }
  ]
}
Return ONLY pure JSON. No markdown backticks.`;

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

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

// Seviye dersini getir veya YDS sıralı aktif havuzdan yeni 10 kelime seçip oluştur
async function getOrGenerateLesson(pool, userId, levelNumber, useStudyListOnly = false) {
  // 1. Veritabanındaki kayıtlı dersi kontrol et
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

  // 2. Tamamlanan kelimeleri (completed_word_ids) çek
  const statRes = await pool.query(
    'SELECT completed_word_ids FROM user_statistics WHERE user_id = $1 ORDER BY id ASC LIMIT 1',
    [userId]
  );
  const completedWords = new Set(
    (statRes.rows.length > 0 && Array.isArray(statRes.rows[0].completed_word_ids))
      ? statRes.rows[0].completed_word_ids.map(w => w.toLowerCase())
      : []
  );

  // 3. Aktif havuzu çek (Özel liste filtresine veya tüm 5000+ kelime havuzuna göre)
  let rawWords = [];
  if (useStudyListOnly) {
    const studyRes = await pool.query(
      `SELECT uw.english, uw.turkish, uw.pronunciation
       FROM user_words uw
       INNER JOIN user_study_list usl ON LOWER(uw.english) = LOWER(usl.english)
       WHERE uw.user_id = $1 AND usl.user_id = $1`,
      [userId]
    );
    rawWords = studyRes.rows;
  } else {
    const allRes = await pool.query(
      'SELECT english, turkish, pronunciation FROM user_words WHERE user_id = $1',
      [userId]
    );
    rawWords = allRes.rows;
  }

  if (rawWords.length === 0) {
    return null;
  }

  // 4. YDS Zorluk Sıralaması:
  // - 1. Kısa (3-5 harf)
  // - 2. Orta (6-8 harf)
  // - 3. Uzun akademik (9+ harf) ve boşluk içeren deyimler
  rawWords.sort((a, b) => calculateYdsDifficulty(a) - calculateYdsDifficulty(b));

  // 5. Tekrar Önleme: Daha önce tamamlanan kelimeleri havuzdan çıkar
  let availableWords = rawWords.filter(w => !completedWords.has((w.english || '').toLowerCase()));

  // Eğer tüm kelimeler tamamlandıysa, havuzu yeniden dolaş
  if (availableWords.length < 10) {
    availableWords = rawWords;
  }

  // Seviye için sıradaki 10 YDS sıralı kelimeyi al
  const levelWords = availableWords.slice(0, 10);
  if (levelWords.length < 5) {
    return null;
  }

  // 6. Gemini Flash veya Fallback ile Üret
  let generated = await callGeminiFlash(levelWords, levelNumber);
  if (!generated) {
    generated = generateFallbackLesson(levelWords, levelNumber);
  }

  // 7. Neon PostgreSQL'e kaydet
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

    // GET /api/lessons?user_id=1&level=1&study_only=false
    if (req.method === 'GET') {
      const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
      const levelNumber = req.query.level ? parseInt(req.query.level, 10) : 1;
      const useStudyOnly = req.query.study_only === 'true';

      if (!userId) {
        return res.status(401).json({ success: false, error: 'user_id is required.' });
      }

      const statRes = await pool.query(
        'SELECT current_level, completed_word_ids FROM user_statistics WHERE user_id = $1 ORDER BY id ASC LIMIT 1',
        [userId]
      );
      const userLevel = statRes.rows.length > 0 && statRes.rows[0].current_level ? statRes.rows[0].current_level : 1;

      const lesson = await getOrGenerateLesson(pool, userId, levelNumber, useStudyOnly);
      if (!lesson) {
        return res.status(400).json({ success: false, error: 'Yeterli kelime bulunamadı. Lütfen kelime ekleyin.' });
      }

      // Pre-fetching: Arka planda Seviye N+1'i üretip veritabanına kaydet
      setImmediate(async () => {
        try {
          await getOrGenerateLesson(pool, userId, levelNumber + 1, useStudyOnly);
        } catch (e) {}
      });

      return res.status(200).json({
        success: true,
        user_level: userLevel,
        lesson: lesson
      });
    }

    // POST /api/lessons - Seviye tamamlama, seviye artırma ve completed_word_ids kaydetme
    if (req.method === 'POST') {
      const body = parseBody(req);
      const userId = body.user_id ? parseInt(body.user_id, 10) : null;
      const completedLevel = body.level_number ? parseInt(body.level_number, 10) : 1;
      const correctCount = typeof body.correct_count === 'number' ? body.correct_count : 0;
      const wrongWords = Array.isArray(body.wrong_words) ? body.wrong_words : [];
      const completedWords = Array.isArray(body.completed_words) ? body.completed_words : [];

      if (!userId) {
        return res.status(401).json({ success: false, error: 'user_id is required.' });
      }

      // 1. Yanlış kelimeleri Zorlu Kelimeler havuzuna ekle
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

      // 2. Başarıyla tamamlanan kelimeleri completed_word_ids içine kaydet (Tekrarı önleme)
      let leveledUp = false;
      let newLevel = completedLevel;

      if (correctCount >= 7) {
        newLevel = completedLevel + 1;
        leveledUp = true;
      }

      const statRes = await pool.query(
        'SELECT id, current_level, completed_word_ids FROM user_statistics WHERE user_id = $1 ORDER BY id ASC LIMIT 1',
        [userId]
      );

      if (statRes.rows.length > 0) {
        const currentCompleted = Array.isArray(statRes.rows[0].completed_word_ids) ? statRes.rows[0].completed_word_ids : [];
        const mergedCompleted = Array.from(new Set([...currentCompleted, ...completedWords.map(w => w.toLowerCase())]));
        const targetLevel = Math.max(statRes.rows[0].current_level || 1, newLevel);

        await pool.query(
          'UPDATE user_statistics SET current_level = $1, completed_word_ids = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [targetLevel, JSON.stringify(mergedCompleted), statRes.rows[0].id]
        );
      } else {
        await pool.query(
          'INSERT INTO user_statistics (user_id, game_type, score, current_level, completed_word_ids) VALUES ($1, $2, $3, $4, $5)',
          [userId, 'general', 0, newLevel, JSON.stringify(completedWords.map(w => w.toLowerCase()))]
        );
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
