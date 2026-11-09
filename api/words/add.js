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
      return res.status(401).json({ success: false, error: 'Yetkisiz erişim: user_id gereklidir.' });
    }

    if (words.length === 0) {
      return res.status(400).json({ success: false, error: 'Eklenecek kelime listesi boş.' });
    }

    // Filtreleme ve temizleme
    const validWords = [];
    for (const w of words) {
      const english = (w.english || '').trim();
      const turkish = (w.turkish || '').trim();
      const pronunciation = (w.pronunciation || '').trim();
      if (english && turkish) {
        validWords.push({ english, turkish, pronunciation });
      }
    }

    if (validWords.length === 0) {
      return res.status(400).json({ success: false, error: 'Geçerli kelime bulunamadı.' });
    }

    // Toplu ekleme için multi-row parameterized INSERT sorgusu oluşturma
    // ($1, $2, $3, $4), ($1, $5, $6, $7), ...
    const valuePlaceholders = [];
    const values = [userId];
    let paramCounter = 2;

    for (const w of validWords) {
      valuePlaceholders.push(`($1, $${paramCounter}, $${paramCounter + 1}, $${paramCounter + 2})`);
      values.push(w.english, w.turkish, w.pronunciation);
      paramCounter += 3;
    }

    const insertQuery = `
      INSERT INTO user_words (user_id, english, turkish, pronunciation)
      VALUES ${valuePlaceholders.join(', ')}
    `;

    await pool.query(insertQuery, values);

    return res.status(200).json({
      success: true,
      addedCount: validWords.length
    });
  } catch (err) {
    console.error('Batch add words error:', err);
    return res.status(500).json({ success: false, error: 'Kelimeler kaydedilirken bir hata oluştu.' });
  }
};
