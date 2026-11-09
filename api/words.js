const fs = require('fs');
const path = require('path');
const { getPool, ensureTables } = require('./_db');

function getDefaultWords() {
  try {
    const filePath = path.join(process.cwd(), 'words.json');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Error reading words.json:', err);
  }
  return [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const defaultWords = getDefaultWords();
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;

  const pool = getPool();
  if (!pool || !userId) {
    // If DB is not available or user is guest, return default words
    return res.status(200).json({
      success: true,
      words: defaultWords,
      customCount: 0
    });
  }

  try {
    await ensureTables();
    const result = await pool.query(
      'SELECT id, english, turkish, pronunciation FROM user_words WHERE user_id = $1 ORDER BY id ASC',
      [userId]
    );

    const userWords = result.rows.map(r => ({
      id: r.id,
      english: r.english,
      turkish: r.turkish,
      pronunciation: r.pronunciation || ''
    }));

    // Merge default words with user specific words (avoid duplicate english terms)
    const existingEnglish = new Set(userWords.map(w => w.english.toLowerCase()));
    const filteredDefaults = defaultWords.filter(w => !existingEnglish.has(w.english.toLowerCase()));

    const merged = [...filteredDefaults, ...userWords];

    return res.status(200).json({
      success: true,
      words: merged,
      customCount: userWords.length
    });
  } catch (err) {
    console.error('Fetch words error:', err);
    // Graceful fallback to default words
    return res.status(200).json({
      success: true,
      words: defaultWords,
      customCount: 0,
      warning: 'Could not fetch database words, returning defaults'
    });
  }
};
