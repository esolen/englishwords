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
    const gameType = (body.game_type || '').trim();
    const score = typeof body.score === 'number' ? body.score : 0;
    const wrongWords = Array.isArray(body.wrong_words) ? body.wrong_words : [];

    if (!userId || !gameType) {
      return res.status(400).json({ success: false, error: 'user_id ve game_type zorunludur.' });
    }

    // Check if record exists for this user and game
    const existing = await pool.query(
      'SELECT id, score, wrong_words FROM user_statistics WHERE user_id = $1 AND game_type = $2',
      [userId, gameType]
    );

    if (existing.rows.length > 0) {
      const current = existing.rows[0];
      const mergedWrongWords = Array.from(
        new Set([...(current.wrong_words || []), ...wrongWords])
      );
      const newScore = Math.max(current.score, score);

      await pool.query(
        'UPDATE user_statistics SET score = $1, wrong_words = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [newScore, JSON.stringify(mergedWrongWords), current.id]
      );
    } else {
      await pool.query(
        'INSERT INTO user_statistics (user_id, game_type, score, wrong_words) VALUES ($1, $2, $3, $4)',
        [userId, gameType, score, JSON.stringify(wrongWords)]
      );
    }

    return res.status(200).json({ success: true, message: 'İstatistik güncellendi.' });
  } catch (err) {
    console.error('Update statistics error:', err);
    return res.status(500).json({ success: false, error: 'İstatistik güncellenirken hata oluştu.' });
  }
};
