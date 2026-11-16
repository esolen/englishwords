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
  incrementWrongWords
};
