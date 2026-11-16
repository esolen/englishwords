let Pool = null;
try {
  Pool = require('pg').Pool;
} catch (e) {
  // pg may not be installed locally in offline/test environment, but will be installed on Vercel
}

// Vercel Serverless Global Connection Pool Caching
let cachedPool = global.__neon_pool || null;

function getPool() {
  if (!Pool) return null;
  if (!cachedPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return null;
    }
    cachedPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    global.__neon_pool = cachedPool;
  }
  return cachedPool;
}

let migrated = false;

async function ensureTables() {
  const p = getPool();
  if (!p) return false;
  if (migrated) return true;

  const createQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_words (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      english VARCHAR(255) NOT NULL,
      turkish VARCHAR(255) NOT NULL,
      pronunciation VARCHAR(255) DEFAULT '',
      example_en TEXT DEFAULT '',
      example_tr TEXT DEFAULT '',
      pos VARCHAR(50) DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_user_words_user_id ON user_words(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_words_user_english ON user_words(user_id, english);

    -- Mevcut kurulumlar için eksik alanları tamamla
    ALTER TABLE user_words ADD COLUMN IF NOT EXISTS example_en TEXT DEFAULT '';
    ALTER TABLE user_words ADD COLUMN IF NOT EXISTS example_tr TEXT DEFAULT '';
    ALTER TABLE user_words ADD COLUMN IF NOT EXISTS pos VARCHAR(50) DEFAULT '';

    -- YDS (Yabancı Dil Bilgisi Seviye Tespit Sınavı) bazlı kalıcı sınıflandırma alanları
    ALTER TABLE user_words ADD COLUMN IF NOT EXISTS yds_level INTEGER DEFAULT 0;
    ALTER TABLE user_words ADD COLUMN IF NOT EXISTS part_of_speech VARCHAR(50) DEFAULT '';
    ALTER TABLE user_words ADD COLUMN IF NOT EXISTS synonyms JSONB DEFAULT '[]'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_user_words_yds_level ON user_words(user_id, yds_level);

    CREATE TABLE IF NOT EXISTS user_statistics (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type VARCHAR(100) NOT NULL,
      score INTEGER DEFAULT 0,
      wrong_words JSONB DEFAULT '[]'::jsonb,
      wrong_counts JSONB DEFAULT '{}'::jsonb,
      current_level INTEGER DEFAULT 1,
      completed_word_ids JSONB DEFAULT '[]'::jsonb,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE user_statistics ADD COLUMN IF NOT EXISTS current_level INTEGER DEFAULT 1;
    ALTER TABLE user_statistics ADD COLUMN IF NOT EXISTS completed_word_ids JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE user_statistics ADD COLUMN IF NOT EXISTS wrong_counts JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_user_stats_user_game ON user_statistics(user_id, game_type);

    -- Kolaydan Zora modülü için kullanıcı bazlı ders ilerleme takibi
    CREATE TABLE IF NOT EXISTS lesson_progress (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      level_number INTEGER NOT NULL DEFAULT 1,
      completed_word_ids JSONB DEFAULT '[]'::jsonb,
      current_cycle INTEGER DEFAULT 1,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id);

    CREATE TABLE IF NOT EXISTS user_study_list (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      english VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, english)
    );

    CREATE INDEX IF NOT EXISTS idx_user_study_list_uid ON user_study_list(user_id);
  `;

  await p.query(createQuery);
  migrated = true;
  return true;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (e) {
    return {};
  }
}

function normalizeWordKey(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * YDS sınıflandırma zenginleştirmesi (kalıcı, veri kaybı olmadan).
 *
 * Veritabanındaki tüm kelimeleri _yds motoruyla sınıflandırır ve şu alanları
 * günceller: yds_level, part_of_speech, synonyms, example_en, example_tr.
 * - Hiçbir satır SİLİNMEZ; yalnızca boş/yapay alanlar doldurulur.
 * - Kullanıcının elle girdiği dolu örnek cümleler ve tüm diğer alanlar korunur.
 * - `force=false` iken yalnızca yds_level atanmamış (0) kelimeler işlenir.
 *
 * @returns {{ scanned:number, updated:number, distribution:Object }}
 */
async function backfillYdsLevels(pool, { userId = null, force = false, maxRows = 0 } = {}) {
  const yds = require('./_yds');

  const where = ['(yds_level IS NULL OR yds_level = 0 OR $1::boolean = true)'];
  const params = [force];
  if (userId) {
    where.push(`user_id = $${params.length + 1}`);
    params.push(userId);
  }

  const limitClause = maxRows > 0 ? ` LIMIT ${parseInt(maxRows, 10)}` : '';
  const selectSql = `
    SELECT id, user_id, english, turkish, pronunciation, example_en, example_tr, pos
      FROM user_words
     WHERE ${where.join(' AND ')}
     ORDER BY id ASC${limitClause}
  `;

  const rows = (await pool.query(selectSql, params)).rows;
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  if (rows.length === 0) {
    // Yine de mevcut dağılımı raporla
    const dist = await ydsDistribution(pool, userId);
    return { scanned: 0, updated: 0, distribution: dist };
  }

  // Eş anlamlı eşleştirmesi için tüm havuzu (kullanıcı bazlı) yükle
  const poolSql = userId
    ? 'SELECT english, turkish FROM user_words WHERE user_id = $1'
    : 'SELECT english, turkish FROM user_words';
  const allWords = (await pool.query(poolSql, userId ? [userId] : [])).rows;

  let updated = 0;
  const ids = [];
  const levels = [];
  const posList = [];
  const synList = [];
  const exEnList = [];
  const exTrList = [];

  for (const row of rows) {
    const result = yds.classifyWord(row, allWords);
    distribution[result.yds_level] = (distribution[result.yds_level] || 0) + 1;
    ids.push(row.id);
    levels.push(result.yds_level);
    posList.push(result.part_of_speech);
    synList.push(JSON.stringify(result.synonyms));
    exEnList.push(result.example_en);
    exTrList.push(result.example_tr);
    updated++;
  }

  // Tek toplu UPDATE: satır başına sorgu yerine unnest ile tek gidiş-dönüş.
  if (ids.length > 0) {
    await pool.query(
      `UPDATE user_words AS uw
          SET yds_level = v.yds_level,
              part_of_speech = v.part_of_speech,
              synonyms = v.synonyms::jsonb,
              example_en = v.example_en,
              example_tr = v.example_tr,
              pos = CASE WHEN uw.pos IS NULL OR uw.pos = '' THEN v.part_of_speech ELSE uw.pos END
         FROM (
           SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[])
             AS t(id, yds_level, part_of_speech, synonyms, example_en, example_tr)
         ) AS v
        WHERE uw.id = v.id`,
      [ids, levels, posList, synList, exEnList, exTrList]
    );
  }

  const fullDist = await ydsDistribution(pool, userId);
  return { scanned: rows.length, updated, distribution: fullDist };
}

/**
 * Kullanıcı bazında (veya tümü için) YDS seviye dağılımını döndürür.
 */
async function ydsDistribution(pool, userId = null) {
  const params = [];
  let where = 'yds_level BETWEEN 1 AND 5';
  if (userId) {
    params.push(userId);
    where += ' AND user_id = $1';
  }
  const res = await pool.query(
    `SELECT yds_level, COUNT(*)::int AS count FROM user_words WHERE ${where} GROUP BY yds_level ORDER BY yds_level`,
    params
  );
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  res.rows.forEach(r => { dist[r.yds_level] = r.count; total += r.count; });
  return { levels: dist, total };
}

/**
 * Yanlış cevaplanan kelimeleri kullanıcının "Zorlu Kelimeler" istatistiğine işler.
 * Her kelime için wrong_counts +1 artırılır ve wrong_words listesine eklenir.
 * Hem api/statistics/update.js hem de api/lessons/index.js bu yardımcıyı kullanır.
 */
async function incrementWrongWords(pool, userId, wrongWords, gameType = 'difficult_words') {
  const words = (wrongWords || [])
    .map(w => normalizeWordKey(typeof w === 'string' ? w : (w && (w.english || w.en))))
    .filter(Boolean);

  if (!userId || words.length === 0) return { added: 0 };

  const existing = await pool.query(
    'SELECT id, wrong_words, wrong_counts FROM user_statistics WHERE user_id = $1 AND game_type = $2',
    [userId, gameType]
  );

  let counts = {};
  let list = [];
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    counts = (row.wrong_counts && typeof row.wrong_counts === 'object') ? { ...row.wrong_counts } : {};
    list = Array.isArray(row.wrong_words) ? row.wrong_words : [];
  }

  words.forEach(word => {
    counts[word] = (counts[word] || 0) + 1;
  });

  const mergedList = Array.from(new Set([
    ...list.map(normalizeWordKey).filter(Boolean),
    ...words
  ]));

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE user_statistics SET wrong_words = $1, wrong_counts = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [JSON.stringify(mergedList), JSON.stringify(counts), existing.rows[0].id]
    );
  } else {
    await pool.query(
      'INSERT INTO user_statistics (user_id, game_type, score, wrong_words, wrong_counts) VALUES ($1, $2, $3, $4, $5)',
      [userId, gameType, 0, JSON.stringify(mergedList), JSON.stringify(counts)]
    );
  }

  return { added: words.length };
}

module.exports = {
  getPool,
  ensureTables,
  parseBody,
  incrementWrongWords,
  backfillYdsLevels,
  ydsDistribution
};
