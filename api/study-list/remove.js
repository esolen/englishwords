const { getPool, ensureTables, parseBody } = require('../_db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(200).json({ success: true, message: 'Yerel modda silindi.' });
  }

  try {
    await ensureTables();
    const body = parseBody(req);
    const userId = (req.query.user_id ? parseInt(req.query.user_id, 10) : null) || (body.user_id ? parseInt(body.user_id, 10) : null);
    const english = (body.english || body.word || req.query.english || req.query.word || '').trim().toLowerCase();

    if (!userId || !english) {
      return res.status(400).json({ success: false, error: 'user_id ve english zorunludur.' });
    }

    await pool.query(
      'DELETE FROM user_study_list WHERE user_id = $1 AND LOWER(english) = $2',
      [userId, english]
    );

    return res.status(200).json({ success: true, english });
  } catch (err) {
    console.error('Remove from study list error:', err);
    return res.status(500).json({ success: false, error: 'Özel listeden silinirken hata oluştu.' });
  }
};
