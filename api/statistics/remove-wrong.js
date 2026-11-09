const { getPool, ensureTables, parseBody } = require('../_db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(200).json({ success: true, message: 'Veritabanı bağlantısı yok, yerel simülasyon.' });
  }

  try {
    await ensureTables();
    const body = parseBody(req);
    const userId = (req.query.user_id ? parseInt(req.query.user_id, 10) : null) || (body.user_id ? parseInt(body.user_id, 10) : null);
    const word = (body.word || req.query.word || '').trim().toLowerCase();

    if (!userId || !word) {
      return res.status(400).json({ success: false, error: 'user_id ve word zorunludur.' });
    }

    // Aktif kullanıcının tüm statistics kayıtlarındaki wrong_words havuzundan bu kelimeyi temizle
    const records = await pool.query(
      'SELECT id, wrong_words FROM user_statistics WHERE user_id = $1',
      [userId]
    );

    for (const row of records.rows) {
      if (Array.isArray(row.wrong_words)) {
        const filtered = row.wrong_words.filter(w => {
          if (typeof w === 'string') return w.toLowerCase() !== word;
          if (w && w.english) return w.english.toLowerCase() !== word;
          return true;
        });

        await pool.query(
          'UPDATE user_statistics SET wrong_words = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [JSON.stringify(filtered), row.id]
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: `"${word}" zorlu kelimeler havuzundan kalıcı olarak silindi.`,
      word
    });
  } catch (err) {
    console.error('Remove wrong word error:', err);
    return res.status(500).json({ success: false, error: 'Veritabanı silme hatası.' });
  }
};
