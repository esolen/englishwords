let Pool = null;
try {
  Pool = require('pg').Pool;
} catch (e) {
  // pg may not be installed locally in offline/test environment, but will be installed on Vercel
}

let pool = null;

function getPool() {
  if (!Pool) return null;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return null;
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_user_words_user_id ON user_words(user_id);

    CREATE TABLE IF NOT EXISTS user_statistics (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type VARCHAR(100) NOT NULL,
      score INTEGER DEFAULT 0,
      wrong_words JSONB DEFAULT '[]'::jsonb,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_user_stats_user_game ON user_statistics(user_id, game_type);
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

module.exports = {
  getPool,
  ensureTables,
  parseBody
};
