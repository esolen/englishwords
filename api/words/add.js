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
      const example_en = (w.example_en || '').trim();
      const example_tr = (w.example_tr || '').trim();
      const pos = (w.pos || '').trim();
      if (english && turkish) {
        validWords.push({ english, turkish, pronunciation, example_en, example_tr, pos });
      }
    }

    if (validWords.length === 0) {
      return res.status(400).json({ success: false, error: 'Geçerli kelime bulunamadı.' });
    }

    // Toplu ekleme için multi-row parameterized INSERT sorgusu oluşturma
    // ($1, $2, $3, $4, $5, $6, $7), ($1, $8, ...), ...
    const valuePlaceholders = [];
    const values = [userId];
    let paramCounter = 2;

    for (const w of validWords) {
      valuePlaceholders.push(
        `($1, $${paramCounter}, $${paramCounter + 1}, $${paramCounter + 2}, $${paramCounter + 3}, $${paramCounter + 4}, $${paramCounter + 5})`
      );
      values.push(w.english, w.turkish, w.pronunciation, w.example_en, w.example_tr, w.pos);
      paramCounter += 6;
    }

    const insertQuery = `
      INSERT INTO user_words (user_id, english, turkish, pronunciation, example_en, example_tr, pos)
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
