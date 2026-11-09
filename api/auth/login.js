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

    const passwordHash = hashPassword(password);
    const result = await pool.query(
      'SELECT id, username FROM users WHERE username = $1 AND password_hash = $2',
      [username, passwordHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    const user = result.rows[0];
    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Giriş yapılırken bir hata oluştu.' });
  }
};
