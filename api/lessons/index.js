const { getPool, ensureTables, parseBody } = require('../_db');
const engine = require('./_engine');

const { LEVEL_SIZE, LEVEL_COUNT, PASS_RATIO, normalizeWord } = engine;

// ---------------------------------------------------------------------------
// Veritabanı yardımcıları
// ---------------------------------------------------------------------------

// Aktif kelime havuzunu getirir. studyOnly=true ise yalnızca kullanıcının
// özel çalışma listesindeki (yıldızlı) kelimeler döner.
async function fetchWordPool(pool, userId, studyOnly) {
  if (studyOnly) {
    const res = await pool.query(
      `SELECT uw.id, uw.english, uw.turkish, uw.pronunciation,
              uw.example_en, uw.example_tr, uw.pos
         FROM user_words uw
         INNER JOIN user_study_list usl
                 ON LOWER(usl.english) = LOWER(uw.english) AND usl.user_id = uw.user_id
        WHERE uw.user_id = $1
        ORDER BY uw.id ASC`,
      [userId]
    );
    return res.rows;
  }

  const res = await pool.query(
    `SELECT id, english, turkish, pronunciation, example_en, example_tr, pos
       FROM user_words
      WHERE user_id = $1
      ORDER BY id ASC`,
    [userId]
  );
  return res.rows;
}

// "Zorlu Kelimeler" (yanlış cevaplanan) kelimelerin ağırlık haritasını getirir
async function fetchWrongCounts(pool, userId) {
  const res = await pool.query(
    'SELECT wrong_words, wrong_counts FROM user_statistics WHERE user_id = $1',
    [userId]
  );

  const counts = {};
  for (const row of res.rows) {
    if (row.wrong_counts && typeof row.wrong_counts === 'object') {
      for (const [key, value] of Object.entries(row.wrong_counts)) {
        counts[normalizeWord(key)] = (counts[normalizeWord(key)] || 0) + Number(value || 0);
      }
    }
    if (Array.isArray(row.wrong_words)) {
      for (const w of row.wrong_words) {
        const key = normalizeWord(typeof w === 'string' ? w : (w && w.english));
        if (key) counts[key] = counts[key] || 1;
      }
    }
  }
  return counts;
}

// completed_word_ids JSONB alanını { seviye: [id, ...] } yapısına normalize eder.
// Eski kurulumlardaki düz dizi biçimi (Seviye 1) ile de uyumludur.
function parseLevelCompleted(raw) {
  const result = {};
  for (let i = 1; i <= LEVEL_COUNT; i++) result[i] = [];

  if (Array.isArray(raw)) {
    result[1] = raw.map(normalizeWord).filter(Boolean);
    return result;
  }
  if (raw && typeof raw === 'object') {
    for (let i = 1; i <= LEVEL_COUNT; i++) {
      const val = raw[i] || raw[String(i)];
      if (Array.isArray(val)) result[i] = val.map(normalizeWord).filter(Boolean);
    }
  }
  return result;
}

async function getLessonProgress(pool, userId) {
  const res = await pool.query(
    'SELECT id, level_number, completed_word_ids, current_cycle FROM lesson_progress WHERE user_id = $1',
    [userId]
  );
  let row;
  if (res.rows.length > 0) {
    row = res.rows[0];
  } else {
    const inserted = await pool.query(
      `INSERT INTO lesson_progress (user_id, level_number, completed_word_ids, current_cycle)
       VALUES ($1, 1, '{}'::jsonb, 1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id, level_number, completed_word_ids, current_cycle`,
      [userId]
    );
    row = inserted.rows[0];
  }

  return {
    id: row.id,
    level_number: Math.min(Math.max(1, row.level_number || 1), LEVEL_COUNT),
    level_completed: parseLevelCompleted(row.completed_word_ids),
    current_cycle: row.current_cycle || 1
  };
}

async function saveLessonProgress(pool, userId, levelNumber, levelCompleted, cycle) {
  await pool.query(
    `UPDATE lesson_progress
        SET level_number = $1, completed_word_ids = $2, current_cycle = $3, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $4`,
    [levelNumber, JSON.stringify(levelCompleted), cycle, userId]
  );
}

// ---------------------------------------------------------------------------
// GET: Dinamik ders üretimi (5 seviyeli)
// ---------------------------------------------------------------------------
async function handleGet(req, res, pool) {
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  const requestedLevel = req.query.level ? parseInt(req.query.level, 10) : 1;
  const studyOnly = req.query.study_only === 'true' || req.query.study_only === '1';

  if (!userId) {
    return res.status(401).json({ success: false, error: 'user_id gereklidir.', lesson: null });
  }

  const allPool = await fetchWordPool(pool, userId, false);
  if (allPool.length === 0) {
    return res.status(200).json({
      success: true,
      lesson: null,
      total_words: 0,
      total_levels: LEVEL_COUNT,
      error: 'Henüz kelime eklemediniz. Lütfen önce kelime havuzunuza kelime ekleyin.'
    });
  }

  const activePool = studyOnly ? await fetchWordPool(pool, userId, true) : allPool;

  const baseMeta = {
    study_only: studyOnly,
    total_words: allPool.length,
    pool_words: activePool.length,
    total_levels: LEVEL_COUNT
  };

  if (activePool.length === 0) {
    return res.status(200).json({
      success: true,
      lesson: null,
      ...baseMeta,
      error: studyOnly
        ? 'Özel çalışma listenizde kelime yok. Lütfen kelime tablosundan yıldız ikonuna basarak kelime seçin.'
        : 'Kelime havuzu boş.'
    });
  }

  // Otomatik zorluk sınıflandırması ile TAM 5 seviye
  const levels = engine.buildFiveLevels(activePool);

  const progress = await getLessonProgress(pool, userId);
  const wrongCounts = await fetchWrongCounts(pool, userId);

  // İstenen seviyeyi 1..5 aralığına sınırla
  const effectiveLevel = Math.min(Math.max(1, requestedLevel || progress.level_number || 1), LEVEL_COUNT);
  const levelWords = levels[effectiveLevel - 1].words;

  if (levelWords.length === 0) {
    return res.status(200).json({
      success: true,
      lesson: null,
      ...baseMeta,
      user_level: progress.level_number,
      error: `Seviye ${effectiveLevel} için kelime bulunamadı. Diğer seviyeleri deneyin veya havuza kelime ekleyin.`
    });
  }

  // Seviyeye özel tamamlanan kelimeler
  const completedSet = new Set(progress.level_completed[effectiveLevel] || []);

  // Tekrarsız, zorlu kelime öncelikli seçim (bu seviyenin havuzundan)
  const selection = engine.selectSessionWords(levelWords, completedSet, wrongCounts, LEVEL_SIZE);

  // Bu seviyedeki tüm kelimeler tamamlandıysa seviye döngüsü sıfırlanır
  let poolReset = selection.poolReset;
  if (poolReset) {
    progress.level_completed[effectiveLevel] = [];
    progress.current_cycle += 1;
    await saveLessonProgress(pool, userId, progress.level_number, progress.level_completed, progress.current_cycle);
  }

  const selectedWords = selection.words;
  if (selectedWords.length === 0) {
    return res.status(200).json({ success: true, lesson: null, ...baseMeta, error: 'Ders için uygun kelime bulunamadı.' });
  }

  // Örnek cümleler: Gemini varsa dinamik üret, yoksa doğal şablon havuzuna düş
  await engine.enrichWithGemini(selectedWords);

  const lesson = engine.buildLesson(selectedWords, activePool, effectiveLevel, LEVEL_COUNT);

  const isMini = selectedWords.length < LEVEL_SIZE;
  const warning = (studyOnly && activePool.length < LEVEL_SIZE)
    ? `Özel listenizde yalnızca ${activePool.length} kelime var. Mini ders oluşturuldu; tam ders için en az ${LEVEL_SIZE} kelime seçin.`
    : (levelWords.length < LEVEL_SIZE
      ? `Seviye ${effectiveLevel} havuzunda ${levelWords.length} kelime var. Mini ders oluşturuldu.`
      : null);

  const completedThisLevel = (progress.level_completed[effectiveLevel] || []).length;

  return res.status(200).json({
    success: true,
    ...baseMeta,
    user_level: progress.level_number,
    completed_count: completedThisLevel,
    completed_word_ids: progress.level_completed[effectiveLevel] || [],
    level_words_total: levelWords.length,
    current_cycle: progress.current_cycle,
    pool_reset: poolReset,
    is_mini: isMini,
    warning,
    lesson: {
      ...lesson,
      is_mini: isMini,
      word_count: selectedWords.length
    }
  });
}

// ---------------------------------------------------------------------------
// POST: Ders sonucu / seviye ilerlemesi / sıfırlama
// ---------------------------------------------------------------------------
async function handlePost(req, res, pool) {
  const body = parseBody(req);
  const action = String(body.action || 'complete').toLowerCase();

  const userId = body.user_id ? parseInt(body.user_id, 10) : null;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'user_id gereklidir.' });
  }

  // --- Sıfırlama: tüm seviye ilerlemesini temizle, yeni tura başla ---
  if (action === 'reset') {
    await getLessonProgress(pool, userId);
    const emptyCompleted = {};
    for (let i = 1; i <= LEVEL_COUNT; i++) emptyCompleted[i] = [];
    await saveLessonProgress(pool, userId, 1, emptyCompleted, 1);
    return res.status(200).json({
      success: true,
      reset: true,
      new_level: 1,
      completed_count: 0,
      message: 'İlerleme sıfırlandı. Yeni tura Seviye 1\'den başlayabilirsiniz.'
    });
  }

  // --- Sonuç işleme ---
  const completedLevel = Math.min(Math.max(1, body.level_number ? parseInt(body.level_number, 10) : 1), LEVEL_COUNT);
  const correctCount = Number.isFinite(body.correct_count) ? body.correct_count : 0;
  const totalQuestions = Number.isFinite(body.total_questions) && body.total_questions > 0
    ? body.total_questions
    : LEVEL_SIZE;
  const completedWords = Array.isArray(body.completed_words) ? body.completed_words : [];
  const studyOnly = body.study_only === true;

  const ratio = totalQuestions > 0 ? correctCount / totalQuestions : 0;
  const passed = ratio >= PASS_RATIO; // %80 eşiği

  // Yanlış cevaplanan kelimelerin "Zorlu Kelimeler" istatistiği istemci tarafından
  // api/statistics/update.js üzerinden +1 olarak işlenir (tek kaynak).

  const progress = await getLessonProgress(pool, userId);
  const levelCompleted = progress.level_completed;
  const completedSet = new Set(levelCompleted[completedLevel] || []);

  // Sadece %80+ başarıda kelimeler "tamamlandı" olarak işaretlenir
  if (passed) {
    completedWords
      .map(w => normalizeWord(typeof w === 'string' ? w : (w && w.english)))
      .filter(Boolean)
      .forEach(w => completedSet.add(w));
  }
  levelCompleted[completedLevel] = Array.from(completedSet);

  // Bu seviyenin tamamı bitti mi?
  const activePool = await fetchWordPool(pool, userId, studyOnly);
  const planSource = activePool.length > 0 ? activePool : await fetchWordPool(pool, userId, false);
  const levels = engine.buildFiveLevels(planSource);
  const levelWords = levels[completedLevel - 1] ? levels[completedLevel - 1].words : [];
  const levelKeys = levelWords.map(w => normalizeWord(w.english));
  const levelComplete = levelKeys.length > 0 && levelKeys.every(key => completedSet.has(key));

  // Seviye ilerlemesi: yalnızca başarılı testte bir üst seviye açılır
  let newLevel = progress.level_number;
  let leveledUp = false;
  if (passed) {
    const candidate = Math.min(completedLevel + 1, LEVEL_COUNT);
    newLevel = Math.max(candidate, progress.level_number);
    leveledUp = newLevel > progress.level_number;
  }

  // Tüm seviyeler tamamlandı mı? (yalnızca son seviye tamamen bitince)
  const allLevelsComplete = passed && completedLevel === LEVEL_COUNT && levelComplete;

  await saveLessonProgress(pool, userId, newLevel, levelCompleted, progress.current_cycle);

  // user_statistics ile de senkronize tut (genel istatistik / yedek)
  const completedFlat = Object.values(levelCompleted).flat();
  const stat = await pool.query(
    'SELECT id FROM user_statistics WHERE user_id = $1 AND game_type = $2 ORDER BY id ASC LIMIT 1',
    [userId, 'lessons']
  );
  if (stat.rows.length > 0) {
    await pool.query(
      `UPDATE user_statistics
          SET current_level = $1, completed_word_ids = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
      [newLevel, JSON.stringify(completedFlat), stat.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO user_statistics (user_id, game_type, score, current_level, completed_word_ids)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, 'lessons', correctCount, newLevel, JSON.stringify(completedFlat)]
    );
  }

  let message;
  if (!passed) {
    message = 'Başarı oranı %80 altında kaldı. Eksik kelimeleri tekrar edin.';
  } else if (allLevelsComplete) {
    message = 'Tebrikler! Tüm seviyeleri tamamladınız. Yeni tura başlayabilirsiniz.';
  } else if (levelComplete) {
    message = `Seviye ${completedLevel} tamamlandı! Seviye ${newLevel} açıldı.`;
  } else {
    message = 'Tebrikler! Testi geçtiniz.';
  }

  return res.status(200).json({
    success: true,
    passed,
    leveled_up: leveledUp,
    level_complete: levelComplete,
    all_levels_complete: allLevelsComplete,
    new_level: newLevel,
    completed_level: completedLevel,
    total_levels: LEVEL_COUNT,
    completed_count: (levelCompleted[completedLevel] || []).length,
    completed_word_ids: levelCompleted[completedLevel] || [],
    pool_reset: false,
    message
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const pool = getPool();
  if (!pool) {
    return res.status(200).json({
      success: false,
      error: 'Veritabanı bağlantısı yapılandırılmamış.',
      lesson: null
    });
  }

  try {
    await ensureTables();

    if (req.method === 'GET') {
      return await handleGet(req, res, pool);
    }
    if (req.method === 'POST') {
      return await handlePost(req, res, pool);
    }
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Lessons API error:', err);
    return res.status(500).json({
      success: false,
      error: 'Ders yüklenirken bir hata oluştu.',
      lesson: null
    });
  }
};
