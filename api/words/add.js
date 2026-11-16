const { getPool, ensureTables, parseBody } = require('../_db');
const yds = require('../_yds');

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

    // Filtreleme ve temizleme + YDS sınıflandırması
    const validWords = [];
    for (const w of words) {
      const english = (w.english || '').trim();
      const turkish = (w.turkish || '').trim();
      const pronunciation = (w.pronunciation || '').trim();
      const pos = (w.pos || '').trim();
      if (!english || !turkish) continue;

      // YDS meta alanlarını otomatik üret (kullanıcı vermediyse)
      const cls = yds.classifyWord({ english, turkish, pos, example_en: w.example_en, example_tr: w.example_tr }, words);
      const example_en = (w.example_en || '').trim() || cls.example_en;
      const example_tr = (w.example_tr || '').trim() || cls.example_tr;
      const part_of_speech = pos || cls.part_of_speech;
      const yds_level = Number.isInteger(w.yds_level) && w.yds_level >= 1 && w.yds_level <= 5
        ? w.yds_level
        : cls.yds_level;

      validWords.push({
        english, turkish, pronunciation, example_en, example_tr, pos: part_of_speech,
        yds_level, part_of_speech, synonyms: cls.synonyms
      });
    }

    if (validWords.length === 0) {
      return res.status(400).json({ success: false, error: 'Geçerli kelime bulunamadı.' });
    }

    // Toplu ekleme için multi-row parameterized INSERT sorgusu oluşturma
    // Her satır: (user_id, english, turkish, pronunciation, example_en, example_tr, pos, yds_level, part_of_speech, synonyms)
    const valuePlaceholders = [];
    const values = [userId];
    let paramCounter = 2;

    for (const w of validWords) {
      valuePlaceholders.push(
        `($1, $${paramCounter}, $${paramCounter + 1}, $${paramCounter + 2}, $${paramCounter + 3}, $${paramCounter + 4}, $${paramCounter + 5}, $${paramCounter + 6}, $${paramCounter + 7}, $${paramCounter + 8})`
      );
      values.push(
        w.english, w.turkish, w.pronunciation, w.example_en, w.example_tr, w.pos,
        w.yds_level, w.part_of_speech, JSON.stringify(w.synonyms || [])
      );
      paramCounter += 9;
    }

    const insertQuery = `
      INSERT INTO user_words (user_id, english, turkish, pronunciation, example_en, example_tr, pos, yds_level, part_of_speech, synonyms)
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
