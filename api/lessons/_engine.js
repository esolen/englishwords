/**
 * Kolaydan Zora - Dinamik Ders Motoru
 *
 * Bu modül sabit/hardcoded kelime dizileri içermez. Tüm kelimeler çağıran
 * tarafından (kullanıcının veritabanı havuzundan) beslenir ve aşağıdaki işler
 * tamamen dinamik olarak hesaplanır:
 *   1. Otomatik zorluk puanlaması ve seviye (Seviye 1..N) bölünmesi
 *   2. Kelime türü (pos) tespiti
 *   3. Doğal, dilbilgisi uyumlu örnek cümle üretimi (+ Gemini opsiyonu)
 *   4. Akıllı çeldirici üretimi ve 5 şıklı test kurulumu
 *   5. Tekrarsız (unseen) kelime seçimi + zorlu kelime ağırlıklandırması
 */

const https = require('https');

const LEVEL_SIZE = 10;      // Her ders oturumundaki kelime sayısı
const OPTION_COUNT = 5;     // 1 doğru + 4 çeldirici
const PASS_RATIO = 0.8;     // Seviye geçme eşiği (%80)
const BLANK = '....................';

// ---------------------------------------------------------------------------
// 0. Genel yardımcılar
// ---------------------------------------------------------------------------
function normalizeWord(value) {
  return String(value || '').trim().toLowerCase();
}

function fisherYates(array) {
  const arr = Array.isArray(array) ? [...array] : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Ağırlıklı, tekrarsız örnekleme (zorlu kelimelere öncelik tanır)
function weightedSample(pool, weightFn, count) {
  const items = pool.map(word => ({ word, weight: Math.max(0.0001, weightFn(word)) }));
  const result = [];
  while (result.length < count && items.length > 0) {
    const total = items.reduce((sum, it) => sum + it.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < items.length - 1; idx++) {
      r -= items[idx].weight;
      if (r <= 0) break;
    }
    result.push(items[idx].word);
    items.splice(idx, 1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. Otomatik zorluk sınıflandırma (Kolaydan Zora)
// ---------------------------------------------------------------------------
const COMMON_A1_A2 = new Set([
  'daily', 'study', 'accept', 'achieve', 'improve', 'decide', 'important', 'modern',
  'learn', 'begin', 'start', 'finish', 'create', 'change', 'choose', 'listen',
  'speak', 'write', 'read', 'think', 'understand', 'remember', 'travel', 'follow',
  'happen', 'provide', 'continue', 'include', 'expect', 'develop', 'require',
  'simple', 'useful', 'future', 'friend', 'family', 'people', 'action', 'reason',
  'water', 'house', 'school', 'happy', 'small', 'great', 'place', 'time', 'work'
]);

const ACADEMIC_C1_C2 = new Set([
  'furthermore', 'nevertheless', 'subsequently', 'notwithstanding', 'consequently',
  'moreover', 'nonetheless', 'predominantly', 'inevitably', 'comprehensive',
  'sustainability', 'implementation', 'sophistication', 'accommodation', 'hypothesis',
  'paradigm', 'ubiquitous', 'meticulous', 'ambiguous', 'coherent', 'empirical'
]);

const ACADEMIC_SUFFIXES = [
  'tion', 'sion', 'ment', 'ance', 'ence', 'ible', 'able', 'tude', 'logy',
  'eous', 'ious', 'ness', 'ship', 'ical', 'ism', 'ity', 'ency'
];

/**
 * Bir kelime için YDS/CEFR tabanlı dinamik zorluk puanı üretir.
 * Düşük puan = kolay, yüksek puan = zor.
 */
function calculateDifficulty(word) {
  const en = normalizeWord(word.english || word.en || '');
  const cleanLen = en.replace(/[^a-z]/g, '').length;
  const wrongCount = Number(word.wrongCount || word.wrong_count || 0);

  let score = 40; // temel başlangıç

  if (COMMON_A1_A2.has(en)) score -= 30;
  if (cleanLen <= 3 && !COMMON_A1_A2.has(en)) score += 70; // nadir kısa/arkaik kelimeler
  if (en.includes(' ') || en.includes('-')) score += 110;  // phrasal / birleşik yapılar
  if (ACADEMIC_C1_C2.has(en)) score += 100;

  score += cleanLen * 4;

  ACADEMIC_SUFFIXES.forEach(suffix => {
    if (en.endsWith(suffix)) score += 18;
  });

  // Daha önce yanlış cevaplanan kelimeler ileri seviyeye taşınır
  score += Math.min(60, wrongCount * 20);

  return score;
}

/**
 * Havuzu zorluğa göre sıralar ve 10'arlı seviyelere böler.
 * Döndürülen her seviye: { levelNumber, words: [...] }
 */
function buildLevelPlan(words) {
  const scored = (words || []).map(word => ({
    word,
    difficulty: calculateDifficulty(word)
  }));

  scored.sort((a, b) => a.difficulty - b.difficulty);

  const levels = [];
  for (let i = 0; i < scored.length; i += LEVEL_SIZE) {
    levels.push({
      levelNumber: levels.length + 1,
      words: scored.slice(i, i + LEVEL_SIZE).map(item => item.word)
    });
  }
  return levels;
}

// ---------------------------------------------------------------------------
// 2. Kelime türü (pos) tespiti
// ---------------------------------------------------------------------------
const COMMON_ADVERBS = new Set([
  'nevertheless', 'however', 'therefore', 'moreover', 'furthermore', 'otherwise',
  'meanwhile', 'instead', 'perhaps', 'always', 'often', 'never', 'sometimes',
  'usually', 'already', 'still', 'yet', 'just', 'soon', 'later', 'early', 'late',
  'here', 'there', 'now', 'then', 'today', 'tomorrow', 'yesterday', 'hardly',
  'really', 'probably', 'certainly', 'definitely', 'especially', 'finally',
  'suddenly', 'actually', 'basically', 'clearly', 'exactly', 'generally',
  'naturally', 'obviously', 'perfectly', 'possibly', 'recently', 'seriously',
  'simply', 'totally', 'truly', 'unfortunately', 'widely'
]);

function detectPos(word) {
  const explicit = normalizeWord(word.pos || word.posTag || word.partOfSpeech || '');
  const aliases = {
    noun: 'noun', n: 'noun', isim: 'noun',
    verb: 'verb', v: 'verb', fiil: 'verb',
    adjective: 'adjective', adj: 'adjective', sıfat: 'adjective', sifat: 'adjective',
    adverb: 'adverb', adv: 'adverb', zarf: 'adverb'
  };
  if (aliases[explicit]) return aliases[explicit];

  const en = normalizeWord(word.english || word.en || '');
  const tr = String(word.turkish || word.tr || '').toLowerCase();

  if (!en) return 'unknown';

  if (COMMON_ADVERBS.has(en)) return 'adverb';

  // Türkçe karşılığından ipucu
  if (/(mak|mek)$/.test(tr.split(',')[0].trim())) return 'verb';
  if (/(ca|ce|ça|çe)$/.test(tr.split(',')[0].trim())) return 'adverb';

  // İngilizce son eklerden ipucu
  if (/(ly)$/.test(en)) return 'adverb';
  if (/(tion|sion|ment|ness|ity|ance|ence|ship|hood|ism|ist|er|or)$/.test(en)) return 'noun';
  if (/(ous|ful|ive|able|ible|al|ic|ish|less|ant|ent|ary|ory)$/.test(en) && en.length > 4) return 'adjective';
  if (/(ate|ify|ise|ize|en)$/.test(en) && en.length > 4) return 'verb';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// 3. Doğal örnek cümle üretimi
// ---------------------------------------------------------------------------
// Şablonlar {{WORD}} yer tutucusu kullanır; böylece boşluk tam hedef kelimenin
// yerine konur ve kelime türüne uygun cümle üretilir.
const SENTENCE_TEMPLATES = {
  noun: [
    {
      en: 'She wrote a detailed note about the {{WORD}} before the meeting.',
      tr: 'Toplantıdan önce {{TR}} hakkında ayrıntılı bir not yazdı.'
    },
    {
      en: 'Understanding the {{WORD}} is essential for every student.',
      tr: 'Her öğrenci için {{TR}} kavramını anlamak çok önemlidir.'
    },
    {
      en: 'The team discussed the {{WORD}} during the weekly meeting.',
      tr: 'Ekip, haftalık toplantıda {{TR}} konusunu tartıştı.'
    },
    {
      en: 'This report explains the {{WORD}} in a very clear way.',
      tr: 'Bu rapor {{TR}} konusunu çok net bir şekilde açıklıyor.'
    }
  ],
  verb: [
    {
      en: 'It is important to {{WORD}} regularly.',
      tr: 'Düzenli olarak {{TR}} önemlidir.'
    },
    {
      en: 'He tried hard to {{WORD}} the problem.',
      tr: 'Sorunu {{TR}} için çok çabaladı.'
    },
    {
      en: 'We need to {{WORD}} before the deadline.',
      tr: 'Son tarihten önce {{TR}} zorundayız.'
    },
    {
      en: 'The students want to {{WORD}} more effectively.',
      tr: 'Öğrenciler daha etkili {{TR}} istiyor.'
    }
  ],
  adjective: [
    {
      en: 'The teacher gave us a very {{WORD}} assignment today.',
      tr: 'Öğretmen bugün bize çok {{TR}} bir ödev verdi.'
    },
    {
      en: 'Her explanation was clear and {{WORD}}.',
      tr: 'Açıklaması açık ve {{TR}} idi.'
    },
    {
      en: 'This is one of the most {{WORD}} books I have ever read.',
      tr: 'Bu, şimdiye kadar okuduğum en {{TR}} kitaplardan biri.'
    },
    {
      en: 'The results of the experiment were quite {{WORD}}.',
      tr: 'Deneyin sonuçları oldukça {{TR}} idi.'
    }
  ],
  adverb: [
    {
      en: 'She completed the task {{WORD}}.',
      tr: 'Görevi {{TR}} tamamladı.'
    },
    {
      en: 'He {{WORD}} agreed to help us.',
      tr: 'Bize yardım etmeyi {{TR}} kabul etti.'
    },
    {
      en: 'They worked {{WORD}} to finish on time.',
      tr: 'Zamanında bitirmek için {{TR}} çalıştılar.'
    },
    {
      en: 'The machine operates {{WORD}} under pressure.',
      tr: 'Makine basınç altında {{TR}} çalışır.'
    }
  ],
  unknown: [
    {
      en: 'The word "{{WORD}}" appeared several times in the text.',
      tr: 'Metinde "{{TR}}" kelimesi birkaç kez geçti.'
    },
    {
      en: 'Try to use "{{WORD}}" in a sentence of your own.',
      tr: '"{{TR}}" kelimesini kendi cümlenizde kullanmayı deneyin.'
    },
    {
      en: 'We discussed the meaning of "{{WORD}}" in class.',
      tr: 'Sınıfta "{{TR}}" kelimesinin anlamını tartıştık.'
    }
  ]
};

// Fiil çekimlerini (çoğul -s, geçmiş -ed, -ing vb.) yakalayan regex
function inflectedRegex(word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = new Set([
    esc, `${esc}s`, `${esc}es`, `${esc}ed`, `${esc}d`, `${esc}ing`
  ]);
  if (/[^aeiou]$/i.test(word) && word.length <= 5) {
    const last = esc.slice(-1);
    variants.add(`${esc}${last}ed`);
    variants.add(`${esc}${last}ing`);
  }
  if (/y$/i.test(word)) {
    const stem = esc.slice(0, -1);
    variants.add(`${stem}ies`);
    variants.add(`${stem}ied`);
    variants.add(`${stem}ying`);
  }
  if (/e$/i.test(word)) {
    variants.add(`${esc.slice(0, -1)}ing`);
  }
  const list = Array.from(variants).sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${list.join('|')})\\b`, 'i');
}

// Bir cümledeki hedef kelimenin (çekimli hali dahil) yerini boşluk + ipucu ile değiştirir
function blankOutWord(sentence, word, turkish) {
  const re = inflectedRegex(word);
  if (!re.test(sentence)) return null;
  return sentence.replace(re, `${BLANK} (${turkish})`);
}

/**
 * Bir kelime için örnek cümle ve test sorusu üretir.
 * Önce veritabanındaki example_en/example_tr kullanılır; yoksa türüne uygun
 * akıllı şablon havuzundan üretilir.
 */
function buildExample(word, seedIndex) {
  const en = String(word.english || word.en || '').trim();
  const tr = String(word.turkish || word.tr || '').trim();
  const pos = detectPos(word);
  const dbExampleEn = String(word.example_en || word.exampleEn || '').trim();
  const dbExampleTr = String(word.example_tr || word.exampleTr || '').trim();

  // 1. Veritabanında hazır ve geçerli örnek cümle varsa doğrudan kullan
  if (dbExampleEn) {
    const question = blankOutWord(dbExampleEn, en, tr);
    if (question) {
      return {
        pos,
        example_en: dbExampleEn,
        example_tr: dbExampleTr || dbExampleEn,
        question
      };
    }
  }

  // 2. Türüne uygun şablon havuzundan üret
  const pool = SENTENCE_TEMPLATES[pos] || SENTENCE_TEMPLATES.unknown;
  const template = pool[seedIndex % pool.length];
  const example_en = template.en.replace(/\{\{WORD\}\}/g, en);
  const example_tr = template.tr.replace(/\{\{TR\}\}/g, tr);
  const question = template.en.replace(/\{\{WORD\}\}/g, `${BLANK} (${tr})`);

  return { pos, example_en, example_tr, question };
}

// ---------------------------------------------------------------------------
// 4. Akıllı çeldirici üretimi ve 5 şıklı test
// ---------------------------------------------------------------------------
function buildOptions(target, pool, levelWords) {
  const targetEn = normalizeWord(target.english);
  const targetPos = detectPos(target);

  const dedupe = (list) => {
    const seen = new Set([targetEn]);
    const out = [];
    for (const w of list) {
      const key = normalizeWord(w.english);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
    return out;
  };

  // Önce aynı seviye + aynı kelime türü, sonra aynı tür (genel havuz)
  const sameLevelSamePos = dedupe(levelWords.filter(w => detectPos(w) === targetPos));
  const poolSamePos = dedupe(pool.filter(w => detectPos(w) === targetPos));
  const poolAnyPos = dedupe(pool);

  const picked = [];
  const tryFill = (source) => {
    for (const w of fisherYates(source)) {
      if (picked.length >= OPTION_COUNT - 1) return;
      if (!picked.some(p => normalizeWord(p.english) === normalizeWord(w.english))) {
        picked.push(w);
      }
    }
  };

  tryFill(sameLevelSamePos);
  if (picked.length < OPTION_COUNT - 1) tryFill(poolSamePos);
  if (picked.length < OPTION_COUNT - 1) tryFill(poolAnyPos);

  // Aşırı küçük havuzlar için son çare
  const fallbacks = ['concept', 'method', 'result', 'process', 'value'];
  let fi = 0;
  while (picked.length < OPTION_COUNT - 1 && fi < fallbacks.length) {
    const candidate = fallbacks[fi++];
    if (candidate !== targetEn) picked.push({ english: candidate });
  }

  const optionsRaw = fisherYates([
    { text: target.english, correct: true },
    ...picked.slice(0, OPTION_COUNT - 1).map(w => ({ text: w.english, correct: false }))
  ]);

  const letters = ['a', 'b', 'c', 'd', 'e'];
  const options = optionsRaw.map((opt, idx) => ({
    key: letters[idx],
    text: opt.text
  }));
  const correct_answer = options.find(o => o.text === target.english).key;

  return { options, correct_answer };
}

/**
 * Seçilmiş kelimelerden tam ders nesnesi (öğrenme + test) üretir.
 * Test sorularının sırası öğrenme sırasından bağımsız olarak karıştırılır.
 */
function buildLesson(selectedWords, pool, levelNumber) {
  const examples = selectedWords.map((w, i) => buildExample(w, i));

  const wordsData = selectedWords.map((w, i) => ({
    id: w.id,
    index: i + 1,
    english: w.english,
    turkish: w.turkish,
    pronunciation: w.pronunciation || '',
    pos: examples[i].pos,
    example_en: examples[i].example_en,
    example_tr: examples[i].example_tr
  }));

  // Fisher-Yates: test soruları öğrenme sırasıyla aynı olmamalı
  const quizOrder = fisherYates(selectedWords.map((w, i) => i));

  const quizData = quizOrder.map((originalIdx, qIdx) => {
    const word = selectedWords[originalIdx];
    const example = examples[originalIdx];
    const { options, correct_answer } = buildOptions(word, pool, selectedWords);
    return {
      question_number: qIdx + 1,
      sentence: example.question,
      target_word: word.english,
      target_word_id: word.id,
      turkish_meaning: word.turkish,
      pos: example.pos,
      options,
      correct_answer
    };
  });

  return { level_number: levelNumber, words_data: wordsData, quiz_data: quizData };
}

// ---------------------------------------------------------------------------
// 5. Tekrarsız kelime seçimi (zorlu kelime öncelikli)
// ---------------------------------------------------------------------------
function selectSessionWords(pool, completedSet, wrongCounts) {
  const weightFn = (word) => {
    const key = normalizeWord(word.english);
    const wc = Number((wrongCounts && wrongCounts[key]) || word.wrongCount || 0);
    return 1 + wc * 2; // "Zorlu Kelimeler" öncelik kazanır
  };

  const unseen = pool.filter(w => !completedSet.has(normalizeWord(w.english)));
  if (unseen.length === 0) {
    // Tüm kelimeler tamamlandı -> döngü sıfırlanır, yeni tur başlar
    const words = fisherYates(weightedSample(pool, weightFn, LEVEL_SIZE));
    return { words, poolReset: true };
  }

  const words = fisherYates(weightedSample(unseen, weightFn, LEVEL_SIZE));
  return { words, poolReset: false };
}

// ---------------------------------------------------------------------------
// 6. Opsiyonel Gemini örnek cümle üretimi (önbellekli)
// ---------------------------------------------------------------------------
const geminiCache = new Map();

function callGemini(words) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Promise.resolve(null);

  const payload = JSON.stringify({
    contents: [{
      parts: [{
        text: `You are an English teacher. For each vocabulary item, write one natural, grammatical English example sentence (matching its part of speech) and its Turkish translation.
Return strict JSON: {"items":[{"word":"...","example_en":"...","example_tr":"..."}]}.
Vocabulary: ${JSON.stringify(words.map(w => ({ word: w.english, meaning: w.turkish })))}`
      }]
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.5 }
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates[0].content.parts[0].text
            .replace(/```json/g, '').replace(/```/g, '').trim();
          const json = JSON.parse(text);
          resolve(Array.isArray(json.items) ? json.items : null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

/**
 * Gemini yapılandırılmışsa örnek cümleleri dinamik üretir ve önbelleğe alır.
 * Anahtar yoksa veya hata olursa null döner; çağıran şablon havuzuna düşer.
 */
async function enrichWithGemini(words) {
  if (!process.env.GEMINI_API_KEY) return;

  const missing = words.filter(w => !geminiCache.has(normalizeWord(w.english)));
  if (missing.length > 0) {
    const generated = await callGemini(missing);
    if (Array.isArray(generated)) {
      generated.forEach(item => {
        if (item && item.word && item.example_en) {
          geminiCache.set(normalizeWord(item.word), {
            example_en: String(item.example_en).trim(),
            example_tr: String(item.example_tr || '').trim()
          });
        }
      });
    }
  }

  words.forEach(w => {
    const cached = geminiCache.get(normalizeWord(w.english));
    if (cached && cached.example_en && !w.example_en) {
      w.example_en = cached.example_en;
      w.example_tr = cached.example_tr;
    }
  });
}

module.exports = {
  LEVEL_SIZE,
  OPTION_COUNT,
  PASS_RATIO,
  BLANK,
  normalizeWord,
  fisherYates,
  calculateDifficulty,
  buildLevelPlan,
  detectPos,
  buildExample,
  buildOptions,
  buildLesson,
  selectSessionWords,
  enrichWithGemini
};
