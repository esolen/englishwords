const https = require('https');
const { getPool, ensureTables, parseBody } = require('../_db');

// CEFR / YDS Yaygın Temel Kelime Havuzu (A1-A2 Başlangıç - Seviye 1 İçin)
const COMMON_A1_A2 = new Set([
  'daily', 'study', 'accept', 'achieve', 'improve', 'decide', 'important', 'modern',
  'learn', 'begin', 'start', 'finish', 'create', 'change', 'choose', 'listen',
  'speak', 'write', 'read', 'think', 'understand', 'remember', 'travel', 'follow',
  'happen', 'provide', 'continue', 'include', 'expect', 'develop', 'require',
  'simple', 'useful', 'future', 'friend', 'family', 'people', 'action', 'reason'
]);

// YDS / Akademik Bağlaçlar ve İleri Düzey İfadeler (C1-C2)
const ACADEMIC_C1_C2 = new Set([
  'furthermore', 'nevertheless', 'subsequently', 'notwithstanding', 'consequently',
  'furthermore', 'moreover', 'nonetheless', 'predominantly', 'inevitably',
  'comprehensive', 'sustainability', 'implementation', 'sophistication', 'accommodation'
]);

// YDS / CEFR Zorluk Derecelendirme Motoru:
// Seviye 1 (A1-A2): 10 - 45 puan (Yaygın, günlük temel kelimeler; nadir 2-3 harfli arkaik kelimeler elenir)
// Seviye 2 (B1-B2): 50 - 95 puan (Genel İngilizce, orta düzey sıfatlar ve fiiller)
// Seviye 3+ (C1-C2 / YDS Akademik): 100+ puan (Akademik bağlaçlar, deyimler, phrasal verb'ler, soyut terimler)
function calculateYdsDifficulty(wordObj) {
  const en = (wordObj.english || wordObj.en || '').trim().toLowerCase();
  const cleanLen = en.replace(/\s+/g, '').length;
  let score = 50;

  // 1. Çok nadir/arkaik 2-3 harfli kelimeleri (ox, ail, aye, rye vb.) Seviye 1'e sokmamak için yüksek ceza puanı ver
  if (cleanLen <= 3 && !COMMON_A1_A2.has(en)) {
    score += 80;
  }

  // 2. Yaygın temel A1-A2 kelimelerine öncelik tanı (Seviye 1)
  if (COMMON_A1_A2.has(en)) {
    score -= 30;
  }

  // 3. Çoklu kelimeler (Phrasal verbs, deyimler) C1-C2 YDS düzeyine taşınır
  if (en.includes(' ')) {
    score += 120;
  }

  // 4. İleri düzey akademik kelimeler / bağlaçlar
  if (ACADEMIC_C1_C2.has(en)) {
    score += 100;
  }

  // 5. Harf uzunluğu ve akademik son ekler
  score += cleanLen * 4;

  const academicSuffixes = ['tion', 'sion', 'ment', 'ance', 'ence', 'ible', 'able', 'tude', 'logy', 'eous', 'ious', 'ness', 'ship', 'ical'];
  academicSuffixes.forEach(s => {
    if (en.endsWith(s)) score += 20;
  });

  return score;
}

// Çeşitli ve Doğal Cümle Kalıpları Havuzu (Her kelime için anlam ve bağlama özel dinamik çeşitlilik)
const DIVERSE_PATTERNS = [
  {
    en: (en) => `Recent studies emphasize that consistent ${en} can lead to remarkable personal development.`,
    tr: (tr) => `Son araştırmalar, tutarlı bir ${tr} sürecinin kayda değer bir kişisel gelişime yol açabileceğini vurguluyor.`,
    q: (tr) => `Recent studies emphasize that consistent .................... (${tr}) can lead to remarkable personal development.`
  },
  {
    en: (en) => `The committee decided to ${en} new strategies in order to overcome economic difficulties.`,
    tr: (tr) => `Komite, ekonomik zorlukların üstesinden gelmek için yeni stratejileri ${tr} kararı aldı.`,
    q: (tr) => `The committee decided to .................... (${tr}) new strategies in order to overcome economic difficulties.`
  },
  {
    en: (en) => `Developing a clear understanding of ${en} will substantially help you in upcoming exams.`,
    tr: (tr) => `Konuyla ilgili ${tr} bilgisini pekiştirmek, yaklaşan sınavlarda size büyük ölçüde yardımcı olacaktır.`,
    q: (tr) => `Developing a clear understanding of .................... (${tr}) will substantially help you in upcoming exams.`
  },
  {
    en: (en) => `Experts agree that ${en} is a fundamental pillar for establishing sustainable growth.`,
    tr: (tr) => `Uzmanlar, sürdürülebilir büyüme sağlamak için ${tr} unsurunun temel bir yapı taşı olduğu konusunda hemfikir.`,
    q: (tr) => `Experts agree that .................... (${tr}) is a fundamental pillar for establishing sustainable growth.`
  },
  {
    en: (en) => `Many students find it challenging to ${en} effectively without structured guidance.`,
    tr: (tr) => `Birçok öğrenci, düzenli bir rehberlik olmadan ${tr} adımını verimli şekilde uygulamakta zorlanıyor.`,
    q: (tr) => `Many students find it challenging to .................... (${tr}) effectively without structured guidance.`
  },
  {
    en: (en) => `Environmental scientists highlighted the critical role of ${en} in protecting marine ecosystems.`,
    tr: (tr) => `Çevre bilimciler, deniz ekosistemlerini korumada ${tr} konusunun kritik rolüne dikkat çekti.`,
    q: (tr) => `Environmental scientists highlighted the critical role of .................... (${tr}) in protecting marine ecosystems.`
  },
  {
    en: (en) => `He maintained a strong commitment to ${en} throughout his international career.`,
    tr: (tr) => `Uluslararası kariyeri boyunca ${tr} konusunda güçlü bir kararlılık sürdürdü.`,
    q: (tr) => `He maintained a strong commitment to .................... (${tr}) throughout his international career.`
  },
  {
    en: (en) => `The company announced plans to expand its ${en} initiatives across European markets.`,
    tr: (tr) => `Şirket, Avrupa pazarlarında ${tr} girişimlerini genişletme planlarını duyurdu.`,
    q: (tr) => `The company announced plans to expand its .................... (${tr}) initiatives across European markets.`
  },
  {
    en: (en) => `Historians argue that cultural ${en} played an undeniable role in the renaissance period.`,
    tr: (tr) => `Tarihçiler, Rönesans döneminde kültürel ${tr} unsurunun inkar edilemez bir rol oynadığını savunuyor.`,
    q: (tr) => `Historians argue that cultural .................... (${tr}) played an undeniable role in the renaissance period.`
  },
  {
    en: (en) => `In modern diplomacy, mutual ${en} remains the cornerstone of peaceful international relations.`,
    tr: (tr) => `Modern diplomaside karşılıklı ${tr}, barışçıl uluslararası ilişkilerin temel taşı olmaya devam ediyor.`,
    q: (tr) => `In modern diplomacy, mutual .................... (${tr}) remains the cornerstone of peaceful international relations.`
  }
];

function generateDiverseLesson(levelWords, levelNumber) {
  const wordsData = levelWords.map((w, idx) => {
    const en = w.english || w.en;
    const tr = w.turkish || w.tr;
    const pron = w.pronunciation || w.ipa || '';
    const pattern = DIVERSE_PATTERNS[idx % DIVERSE_PATTERNS.length];

    return {
      index: idx + 1,
      english: en,
      turkish: tr,
      pronunciation: pron,
      example_en: pattern.en(en),
      example_tr: pattern.tr(tr)
    };
  });

  const quizData = levelWords.map((w, idx) => {
    const en = w.english || w.en;
    const tr = w.turkish || w.tr;
    const pattern = DIVERSE_PATTERNS[idx % DIVERSE_PATTERNS.length];
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
      sentence: pattern.q(tr),
      target_word: en,
      turkish_meaning: tr,
      options: options,
      correct_answer: correctLetter
    };
  });

  return { wordsData, quizData };
}

// Google Gemini Flash API ile Her Kelimeye Özel Cümle ve Soru Üretimi
async function callGeminiFlash(levelWords, levelNumber) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are a professional YDS/YÖKDİL exam instructor and linguist.
Create an authentic, contextual, high-yield English learning lesson and 5-choice fill-in-the-blank test for Level ${levelNumber} using these 10 vocabulary items:
${JSON.stringify(levelWords.map(w => ({ word: w.english || w.en, meaning: w.turkish || w.tr })))}

CRITICAL RULES:
1. DO NOT use generic template sentences like "continuous effort to understand" or similar placeholders.
2. Every sentence MUST be completely unique, natural, and specifically match the part of speech (noun, verb, adjective, phrasal verb) and exact meaning of the vocabulary item.
3. For quiz_data, the sentence must contain "...................." where the target word should go, followed by its Turkish translation clue like "(ipucu: ...)".
4. Provide exactly 5 distinct options (a, b, c, d, e) for each question with correct_answer matching the letter key.

Return strictly a valid JSON object with keys "words_data" and "quiz_data". No markdown, no commentary.`;

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4
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
          if (Array.isArray(lessonJson.words_data) && Array.isArray(lessonJson.quiz_data)) {
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

// Seviye Dersi Üretim ve Veritabanı Önbelleği
// Cache Versiyonlama (v2): Eski hatalı şablonlu kayıtları geçersiz kılıp taze veritabanı önbelleği oluşturur
const LESSON_CACHE_KEY_OFFSET = 10000; // v2 önbellek anahtarı

async function getOrGenerateLesson(pool, userId, levelNumber, useStudyListOnly = false) {
  const versionedLevelNumber = LESSON_CACHE_KEY_OFFSET + levelNumber;

  // 1. Veritabanındaki yeni versiyonlu kaydı kontrol et
  const existing = await pool.query(
    'SELECT level_number, words_data, quiz_data FROM generated_lessons WHERE level_number = $1',
    [versionedLevelNumber]
  );

  if (existing.rows.length > 0) {
    return {
      level_number: levelNumber,
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

  // 4. Sabit alfabetik sıralama KALDIRILDI.
  // YDS / CEFR Zorluk Derecelendirmesi:
  // Seviye 1 (A1-A2 Temel), Seviye 2 (B1-B2 Orta), Seviye 3+ (C1-C2 Akademik YDS)
  rawWords.sort((a, b) => calculateYdsDifficulty(a) - calculateYdsDifficulty(b));

  // 5. Tekrar Önleme: Daha önce tamamlanan kelimeleri havuzdan çıkar
  let availableWords = rawWords.filter(w => !completedWords.has((w.english || '').toLowerCase()));

  // Eğer tüm kelimeler tamamlandıysa, havuzu yeniden dolaş
  if (availableWords.length < 10) {
    availableWords = rawWords;
  }

  // Her seviye grubunun içinden 10 rastgele (shuffled) kelime seç
  // Böylece aynı zorluk havuzunda sabit 10 kelimede dönülmez, her seferinde farklı kelimeler gelir
  const targetDifficultyTier = Math.min(2, Math.floor((levelNumber - 1) / 3)); // 0: A1-A2, 1: B1-B2, 2: C1-C2
  const tierSize = Math.max(10, Math.floor(availableWords.length / 3));
  const startIdx = targetDifficultyTier * tierSize;
  const endIdx = targetDifficultyTier === 2 ? availableWords.length : (targetDifficultyTier + 1) * tierSize;

  const currentTierPool = availableWords.slice(startIdx, Math.max(startIdx + 10, endIdx));
  const shuffledTierWords = [...currentTierPool].sort(() => 0.5 - Math.random());
  const levelWords = shuffledTierWords.slice(0, 10);

  if (levelWords.length < 5) {
    return null;
  }

  // 6. Gemini Flash API ile özgün cümleler ürettir; fallback olarak da dinamik çeşitlilik şablonunu kullan
  let generated = await callGeminiFlash(levelWords, levelNumber);
  if (!generated) {
    generated = generateDiverseLesson(levelWords, levelNumber);
  }

  // 7. Neon PostgreSQL'e kaydet (v2 versioned level number ile)
  await pool.query(
    `INSERT INTO generated_lessons (level_number, words_data, quiz_data)
     VALUES ($1, $2, $3)
     ON CONFLICT (level_number) DO UPDATE SET words_data = $2, quiz_data = $3`,
    [versionedLevelNumber, JSON.stringify(generated.wordsData), JSON.stringify(generated.quizData)]
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
