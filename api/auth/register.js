const crypto = require('crypto');
const { getPool, ensureTables, parseBody } = require('../_db');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '_englishwords_salt').digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL is not configured' });
  }

  try {
    await ensureTables();
    const body = parseBody(req);
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Kullanıcı adı ve şifre zorunludur.' });
    }

    if (username.length < 3 || password.length < 4) {
      return res.status(400).json({ success: false, error: 'Kullanıcı adı en az 3, şifre en az 4 karakter olmalıdır.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Bu kullanıcı adı zaten alınmış.' });
    }

    const passwordHash = hashPassword(password);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, passwordHash]
    );

    const user = result.rows[0];
    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, error: 'Kayıt sırasında bir hata oluştu.' });
  }
};
