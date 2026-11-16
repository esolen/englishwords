const { getPool, ensureTables, parseBody, incrementWrongWords } = require('../_db');

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
    const gameType = (body.game_type || '').trim();
    const score = typeof body.score === 'number' ? body.score : 0;
    const wrongWords = Array.isArray(body.wrong_words) ? body.wrong_words : [];

    if (!userId || !gameType) {
      return res.status(400).json({ success: false, error: 'user_id ve game_type zorunludur.' });
    }

    // Yanlış cevaplanan kelimeleri Zorlu Kelimeler havuzuna +1 olarak işle
    if (wrongWords.length > 0) {
      await incrementWrongWords(pool, userId, wrongWords, 'difficult_words');
    }

    // Oyun tipi bazlı skor kaydı (en yüksek skor korunur)
    const existing = await pool.query(
      'SELECT id, score FROM user_statistics WHERE user_id = $1 AND game_type = $2',
      [userId, gameType]
    );

    if (existing.rows.length > 0) {
      const newScore = Math.max(existing.rows[0].score || 0, score);
      await pool.query(
        'UPDATE user_statistics SET score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newScore, existing.rows[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO user_statistics (user_id, game_type, score, wrong_words) VALUES ($1, $2, $3, $4)',
        [userId, gameType, score, JSON.stringify([])]
      );
    }

    return res.status(200).json({ success: true, message: 'İstatistik güncellendi.' });
  } catch (err) {
    console.error('Update statistics error:', err);
    return res.status(500).json({ success: false, error: 'İstatistik güncellenirken hata oluştu.' });
  }
};
