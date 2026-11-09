const { getPool, ensureTables, parseBody } = require('../_db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const pool = getPool();
  if (!pool) {
    return res.status(200).json({ success: true, wrongWords: [] });
  }

  try {
    await ensureTables();

    // GET /api/words/wrong?user_id=123
    if (req.method === 'GET') {
      const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'user_id gereklidir.', wrongWords: [] });
      }

      const result = await pool.query(
        'SELECT wrong_words FROM user_statistics WHERE user_id = $1',
        [userId]
      );

      const allWrongSet = new Set();
      result.rows.forEach(row => {
        if (Array.isArray(row.wrong_words)) {
          row.wrong_words.forEach(w => {
            if (typeof w === 'string') allWrongSet.add(w.toLowerCase());
            else if (w && w.english) allWrongSet.add(w.english.toLowerCase());
          });
        }
      });

      return res.status(200).json({
        success: true,
        wrongWords: Array.from(allWrongSet)
      });
    }

    // POST /api/words/wrong (Zorlu kelime ekleme / silme)
    if (req.method === 'POST') {
      const body = parseBody(req);
      const userId = body.user_id ? parseInt(body.user_id, 10) : null;
      const word = (body.word || '').trim().toLowerCase();
      const action = body.action || 'add'; // 'add' veya 'remove'

      if (!userId || !word) {
        return res.status(400).json({ success: false, error: 'user_id ve word zorunludur.' });
      }

      const existing = await pool.query(
        'SELECT id, wrong_words FROM user_statistics WHERE user_id = $1 AND game_type = $2',
        [userId, 'difficult_words']
      );

      if (existing.rows.length > 0) {
        const current = existing.rows[0];
        let currentList = Array.isArray(current.wrong_words) ? current.wrong_words : [];
        if (action === 'remove') {
          currentList = currentList.filter(w => w.toLowerCase() !== word);
        } else {
          if (!currentList.map(w => w.toLowerCase()).includes(word)) {
            currentList.push(word);
          }
        }

        await pool.query(
          'UPDATE user_statistics SET wrong_words = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [JSON.stringify(currentList), current.id]
        );
      } else if (action === 'add') {
        await pool.query(
          'INSERT INTO user_statistics (user_id, game_type, score, wrong_words) VALUES ($1, $2, $3, $4)',
          [userId, 'difficult_words', 0, JSON.stringify([word])]
        );
      }

      return res.status(200).json({ success: true, action, word });
    }

    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Wrong words API error:', err);
    return res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
};
