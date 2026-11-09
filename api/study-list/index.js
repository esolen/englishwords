const { getPool, ensureTables } = require('../_db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'user_id gereklidir.', studyList: [] });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(200).json({ success: true, studyList: [] });
  }

  try {
    await ensureTables();
    const result = await pool.query(
      'SELECT english FROM user_study_list WHERE user_id = $1 ORDER BY id DESC',
      [userId]
    );

    const list = result.rows.map(r => r.english.toLowerCase());
    return res.status(200).json({ success: true, studyList: list });
  } catch (err) {
    console.error('Fetch study list error:', err);
    return res.status(500).json({ success: false, error: 'Özel çalışma listesi getirilemedi.', studyList: [] });
  }
};
