const { getPool, ensureTables, parseBody } = require('../_db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(200).json({ success: true, message: 'Yerel modda eklendi.' });
  }

  try {
    await ensureTables();
    const body = parseBody(req);
    const userId = body.user_id ? parseInt(body.user_id, 10) : null;
    const english = (body.english || body.word || '').trim().toLowerCase();

    if (!userId || !english) {
      return res.status(400).json({ success: false, error: 'user_id ve english zorunludur.' });
    }

    await pool.query(
      `INSERT INTO user_study_list (user_id, english)
       VALUES ($1, $2)
       ON CONFLICT (user_id, english) DO NOTHING`,
      [userId, english]
    );

    return res.status(200).json({ success: true, english });
  } catch (err) {
    console.error('Add to study list error:', err);
    return res.status(500).json({ success: false, error: 'Özel listeye eklenirken hata oluştu.' });
  }
};
