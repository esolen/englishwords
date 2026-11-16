const { getPool, ensureTables, parseBody } = require('../_db');
const engine = require('./_engine');

const { LEVEL_SIZE, PASS_RATIO, normalizeWord } = engine;

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

async function getLessonProgress(pool, userId) {
  const res = await pool.query(
    'SELECT id, level_number, completed_word_ids, current_cycle FROM lesson_progress WHERE user_id = $1',
    [userId]
  );
  if (res.rows.length > 0) {
    const row = res.rows[0];
    return {
      id: row.id,
      level_number: row.level_number || 1,
      completed_word_ids: Array.isArray(row.completed_word_ids) ? row.completed_word_ids : [],
      current_cycle: row.current_cycle || 1
    };
  }
  const inserted = await pool.query(
    `INSERT INTO lesson_progress (user_id, level_number, completed_word_ids, current_cycle)
     VALUES ($1, 1, '[]'::jsonb, 1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id, level_number, completed_word_ids, current_cycle`,
    [userId]
  );
  const row = inserted.rows[0];
  return {
    id: row.id,
    level_number: row.level_number || 1,
    completed_word_ids: Array.isArray(row.completed_word_ids) ? row.completed_word_ids : [],
    current_cycle: row.current_cycle || 1
  };
}

// ---------------------------------------------------------------------------
// GET: Dinamik ders üretimi
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
      error: 'Henüz kelime eklemediniz. Lütfen önce kelime havuzunuza kelime ekleyin.'
    });
  }

  const activePool = studyOnly ? await fetchWordPool(pool, userId, true) : allPool;

  const baseMeta = {
    study_only: studyOnly,
    total_words: allPool.length,
    pool_words: activePool.length
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

  // Seviye planı (10'arlı gruplar) ve tamamlanan kelimeler
  const plan = engine.buildLevelPlan(activePool);
  const totalLevels = plan.length;

  const progress = await getLessonProgress(pool, userId);
  const completedSet = new Set(progress.completed_word_ids.map(normalizeWord));
  const wrongCounts = await fetchWrongCounts(pool, userId);

  // İstenen seviyeyi sınırla; kullanıcının kayıtlı seviyesi de dikkate alınır
  const effectiveLevel = Math.min(Math.max(1, requestedLevel || progress.level_number || 1), totalLevels);
  const levelWords = plan[effectiveLevel - 1].words;

  // Tekrarsız, zorlu kelime öncelikli seçim
  const selection = engine.selectSessionWords(levelWords, completedSet, wrongCounts);

  // Tüm kelimeler tamamlandıysa yeni döngü başlat (tamamlananları sıfırla)
  let poolReset = selection.poolReset;
  if (poolReset) {
    const resetIds = levelWords.map(w => normalizeWord(w.english));
    const remaining = progress.completed_word_ids.filter(id => !resetIds.includes(normalizeWord(id)));
    await pool.query(
      `UPDATE lesson_progress
          SET completed_word_ids = $1, current_cycle = current_cycle + 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2`,
      [JSON.stringify(remaining), userId]
    );
    progress.current_cycle += 1;
  }

  const selectedWords = selection.words;
  if (selectedWords.length === 0) {
    return res.status(200).json({ success: true, lesson: null, ...baseMeta, error: 'Ders için uygun kelime bulunamadı.' });
  }

  // Örnek cümleler: Gemini varsa dinamik üret, yoksa şablon havuzuna düş
  await engine.enrichWithGemini(selectedWords);

  const lesson = engine.buildLesson(selectedWords, activePool, effectiveLevel);

  const warning = (studyOnly && activePool.length < LEVEL_SIZE)
    ? `Özel listenizde yalnızca ${activePool.length} kelime var. Mini ders oluşturuldu; tam ders için en az ${LEVEL_SIZE} kelime seçin.`
    : null;

  const isMini = selectedWords.length < LEVEL_SIZE;

  return res.status(200).json({
    success: true,
    ...baseMeta,
    user_level: progress.level_number,
    total_levels: totalLevels,
    completed_count: progress.completed_word_ids.length,
    completed_word_ids: progress.completed_word_ids,
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
// POST: Ders sonucu, ilerleme ve zorlu kelime kaydı
// ---------------------------------------------------------------------------
async function handlePost(req, res, pool) {
  const body = parseBody(req);
  const userId = body.user_id ? parseInt(body.user_id, 10) : null;
  const completedLevel = body.level_number ? parseInt(body.level_number, 10) : 1;
  const correctCount = Number.isFinite(body.correct_count) ? body.correct_count : 0;
  const totalQuestions = Number.isFinite(body.total_questions) && body.total_questions > 0
    ? body.total_questions
    : LEVEL_SIZE;
  const completedWords = Array.isArray(body.completed_words) ? body.completed_words : [];
  const studyOnly = body.study_only === true;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'user_id gereklidir.' });
  }

  const ratio = totalQuestions > 0 ? correctCount / totalQuestions : 0;
  const passed = ratio >= PASS_RATIO; // %80 eşiği

  // Yanlış cevaplanan kelimelerin "Zorlu Kelimeler" istatistiği istemci tarafından
  // api/statistics/update.js üzerinden +1 olarak işlenir (tek kaynak).

  // 1. İlerleme kaydını getir
  const progress = await getLessonProgress(pool, userId);
  const completedSet = new Set(progress.completed_word_ids.map(normalizeWord));

  // 2. Sadece %80+ başarıda kelimeler "tamamlandı" olarak işaretlenir
  if (passed) {
    completedWords
      .map(w => normalizeWord(typeof w === 'string' ? w : (w && w.english)))
      .filter(Boolean)
      .forEach(w => completedSet.add(w));
  }

  // 3. Havuzun tamamı tamamlandı mı? (Yeni döngü kontrolü)
  const activePool = await fetchWordPool(pool, userId, studyOnly);
  const poolKeys = activePool.map(w => normalizeWord(w.english));
  const allComplete = poolKeys.length > 0 && poolKeys.every(key => completedSet.has(key));

  let nextCycle = progress.current_cycle;
  let completedList = Array.from(completedSet);

  if (passed && allComplete) {
    // Tüm kelimeler tamamlandı -> tamamlananları sıfırla, yeni tur başlat
    completedList = [];
    nextCycle = progress.current_cycle + 1;
  }

  // 5. Seviye ilerlemesi (yalnızca başarılı testte bir üst seviye açılır)
  const planSource = activePool.length > 0 ? activePool : await fetchWordPool(pool, userId, false);
  const plan = engine.buildLevelPlan(planSource);
  const totalLevels = Math.max(1, plan.length);
  let newLevel = progress.level_number;
  let leveledUp = false;
  if (passed && !allComplete) {
    const candidate = Math.min(completedLevel + 1, totalLevels);
    newLevel = Math.max(candidate, progress.level_number);
    leveledUp = newLevel > progress.level_number;
  }

  await pool.query(
    `UPDATE lesson_progress
        SET level_number = $1, completed_word_ids = $2, current_cycle = $3, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $4`,
    [newLevel, JSON.stringify(completedList), nextCycle, userId]
  );

  // user_statistics ile de senkronize tut (genel istatistik / yedek)
  const stat = await pool.query(
    'SELECT id FROM user_statistics WHERE user_id = $1 AND game_type = $2 ORDER BY id ASC LIMIT 1',
    [userId, 'lessons']
  );
  if (stat.rows.length > 0) {
    await pool.query(
      `UPDATE user_statistics
          SET current_level = $1, completed_word_ids = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
      [newLevel, JSON.stringify(completedList), stat.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO user_statistics (user_id, game_type, score, current_level, completed_word_ids)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, 'lessons', correctCount, newLevel, JSON.stringify(completedList)]
    );
  }

  return res.status(200).json({
    success: true,
    passed,
    leveled_up: leveledUp,
    new_level: newLevel,
    total_levels: totalLevels,
    all_complete: passed && allComplete,
    current_cycle: nextCycle,
    completed_count: completedList.length,
    pool_reset: passed && allComplete,
    message: passed
      ? (allComplete
        ? 'Tüm kelimeleri tamamladınız, yeni döngü başlatılıyor.'
        : 'Tebrikler! Seviyeyi geçtiniz.')
      : 'Başarı oranı %80 altında kaldı. Eksik kelimeleri tekrar edin.'
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
