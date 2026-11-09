const { getPool, ensureTables, parseBody } = require('../_db');

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
    const userId = body.user_id ? parseInt(body.user_id, 10) : null;
    const words = Array.isArray(body.words) ? body.words : [];

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Geçersiz veya eksik user_id.' });
    }

    if (words.length === 0) {
      return res.status(400).json({ success: false, error: 'Eklenecek kelime listesi boş.' });
    }

    let addedCount = 0;
    for (const w of words) {
      const english = (w.english || '').trim();
      const turkish = (w.turkish || '').trim();
      const pronunciation = (w.pronunciation || '').trim();

      if (english && turkish) {
        // Upsert or insert if not exists for this user
        const existing = await pool.query(
          'SELECT id FROM user_words WHERE user_id = $1 AND LOWER(english) = LOWER($2)',
          [userId, english]
        );

        if (existing.rows.length > 0) {
          await pool.query(
            'UPDATE user_words SET turkish = $1, pronunciation = $2 WHERE id = $3',
            [turkish, pronunciation, existing.rows[0].id]
          );
        } else {
          await pool.query(
            'INSERT INTO user_words (user_id, english, turkish, pronunciation) VALUES ($1, $2, $3, $4)',
            [userId, english, turkish, pronunciation]
          );
        }
        addedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      addedCount
    });
  } catch (err) {
    console.error('Add words error:', err);
    return res.status(500).json({ success: false, error: 'Kelimeler eklenirken bir hata oluştu.' });
  }
};
