const { getPool, ensureTables, backfillYdsLevels } = require('./_db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Yetkisiz erişim: Kullanıcı oturumu gereklidir.',
      words: []
    });
  }

  const pool = getPool();
  if (!pool) {
    // Veritabanı bağlantısı henüz yapılandırılmamışsa boş liste dön
    return res.status(200).json({
      success: true,
      words: [],
      message: 'Veritabanı bağlantısı bekleniyor.'
    });
  }

  try {
    await ensureTables();

    // YDS alanları atanmamış kelimeleri zenginleştir. İşlem tek toplu UPDATE ile ve
    // satır sayısı sınırlı (maxRows) yapılır; böylece büyük listelerde yanıt zaman aşımına
    // uğramaz. Kalan kelimeler sonraki isteklerde kademeli olarak zenginleştirilir.
    try {
      await backfillYdsLevels(pool, { userId, force: false, maxRows: 400 });
    } catch (enrichErr) {
      console.warn('YDS enrichment skipped:', enrichErr && enrichErr.message);
    }

    const result = await pool.query(
      `SELECT id, english, turkish, pronunciation, example_en, example_tr, pos,
              yds_level, part_of_speech, synonyms
         FROM user_words WHERE user_id = $1 ORDER BY id DESC`,
      [userId]
    );

    const userWords = result.rows.map(r => ({
      id: r.id,
      english: r.english,
      turkish: r.turkish,
      pronunciation: r.pronunciation || '',
      example_en: r.example_en || '',
      example_tr: r.example_tr || '',
      pos: r.part_of_speech || r.pos || '',
      yds_level: Number(r.yds_level) >= 1 && Number(r.yds_level) <= 5 ? Number(r.yds_level) : 1,
      part_of_speech: r.part_of_speech || r.pos || '',
      synonyms: Array.isArray(r.synonyms) ? r.synonyms : []
    }));

    return res.status(200).json({
      success: true,
      words: userWords,
      count: userWords.length
    });
  } catch (err) {
    console.error('Fetch words error:', err);
    return res.status(500).json({
      success: false,
      error: 'Kelimeler getirilirken bir hata oluştu.',
      words: []
    });
  }
};
