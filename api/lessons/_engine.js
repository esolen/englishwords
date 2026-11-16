/**
 * Kolaydan Zora - Dinamik Ders Motoru (5 Seviyeli)
 *
 * Bu modül sabit/hardcoded kelime dizileri içermez. Tüm kelimeler çağıran
 * tarafından (kullanıcının veritabanı havuzundan) beslenir ve aşağıdaki işler
 * tamamen dinamik olarak hesaplanır:
 *   1. Otomatik zorluk puanlaması ve TAM 5 ana seviyeye (Seviye 1..5) bölünme
 *   2. Kelime türü (pos) tespiti
 *   3. Doğal, dilbilgisi uyumlu örnek cümle üretimi (+ Gemini opsiyonu)
 *   4. Akıllı çeldirici üretimi ve 5 şıklı test kurulumu
 *   5. Tekrarsız (unseen) kelime seçimi + zorlu kelime ağırlıklandırması
 */

const https = require('https');

const LEVEL_SIZE = 10;       // Her ders oturumundaki kelime sayısı
const LEVEL_COUNT = 5;       // Kolaydan Zora toplam seviye sayısı
const OPTION_COUNT = 5;      // 1 doğru + 4 çeldirici
const PASS_RATIO = 0.8;      // Seviye geçme eşiği (%80)
const BLANK = '_______';     // Test cümlesindeki boşluk

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
// 1. Otomatik zorluk sınıflandırma (5 seviye)
// ---------------------------------------------------------------------------
const COMMON_A1_A2 = new Set([
  'daily', 'study', 'accept', 'achieve', 'improve', 'decide', 'important', 'modern',
  'learn', 'begin', 'start', 'finish', 'create', 'change', 'choose', 'listen',
  'speak', 'write', 'read', 'think', 'understand', 'remember', 'travel', 'follow',
  'happen', 'provide', 'continue', 'include', 'expect', 'develop', 'require',
  'simple', 'useful', 'future', 'friend', 'family', 'people', 'action', 'reason',
  'water', 'house', 'school', 'happy', 'small', 'great', 'place', 'time', 'work',
  'book', 'food', 'money', 'music', 'city', 'country', 'problem', 'answer', 'question'
]);

const ACADEMIC_C1_C2 = new Set([
  'furthermore', 'nevertheless', 'subsequently', 'notwithstanding', 'consequently',
  'moreover', 'nonetheless', 'predominantly', 'inevitably', 'comprehensive',
  'sustainability', 'implementation', 'sophistication', 'accommodation', 'hypothesis',
  'paradigm', 'ubiquitous', 'meticulous', 'ambiguous', 'coherent', 'empirical',
  'resilient', 'courageous', 'preliminary', 'inherent', 'arbitrary', 'profound'
]);

const ACADEMIC_SUFFIXES = [
  'tion', 'sion', 'ment', 'ance', 'ence', 'ible', 'able', 'tude', 'logy',
  'eous', 'ious', 'ness', 'ship', 'ical', 'ism', 'ity', 'ency', 'ate', 'ous'
];

/**
 * Bir kelimenin dinamik zorluk puanını üretir (yüksek puan = zor).
 * Puan; harf uzunluğu, phrasal/türemiş yapı, YDS akademik ağırlığı ve
 * kullanıcının geçmiş yanlış istatistiklerinden hesaplanır.
 */
function difficultyScore(word) {
  const en = normalizeWord(word.english || word.en || '');
  const letters = en.replace(/[^a-z]/g, '');
  const len = letters.length;
  const wrongCount = Number(word.wrongCount || word.wrong_count || 0);

  let score = 0;

  // 1) Harf uzunluğu (temel ayraç)
  if (len <= 5) score += 0;
  else if (len <= 7) score += 1;
  else if (len <= 9) score += 2;
  else if (len <= 11) score += 3;
  else score += 4;

  // 2) Phrasal / birleşik yapılar (take off, well-known ...)
  if (en.includes(' ') || en.includes('-')) score += 2;

  // 3) Akademik / türetilmiş yapı
  if (ACADEMIC_SUFFIXES.some(s => letters.endsWith(s))) score += 1;

  // 4) Sıklık (CEFR) ipuçları
  if (COMMON_A1_A2.has(en)) score -= 2;
  if (ACADEMIC_C1_C2.has(en)) score += 4;

  // 5) Kullanıcının geçmiş yanlış istatistikleri (zorlu kelimeler üst seviyeye taşınır)
  score += Math.min(3, wrongCount);

  return score;
}

/**
 * Kelimeyi tam olarak 1..5 arası bir seviyeye atar.
 *   Seviye 1 (Başlangıç):  en temel, kısa ve yaygın kelimeler
 *   Seviye 2 (Temel-Orta): temel fiil/sıfat/isimler
 *   Seviye 3 (Orta):       birden fazla anlamlı / bağlaç-zarf yapıları
 *   Seviye 4 (Orta-İleri): soyut ve YDS düzeyinde akademik kelimeler
 *   Seviye 5 (İleri):      en zorlu, nadir akademik ve phrasal yapılar
 */
function classifyDifficultyLevel(word) {
  const score = difficultyScore(word);
  if (score <= 0) return 1;
  if (score <= 2) return 2;
  if (score <= 4) return 3;
  if (score <= 6) return 4;
  return 5;
}

// Bir listeyi `parts` adet dengeli parçaya böler (fazlalık önceki parçalara dağıtılır)
function chunkBalanced(sorted, parts) {
  const n = sorted.length;
  const base = Math.floor(n / parts);
  let rem = n % parts;
  const out = [];
  let idx = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    out.push(sorted.slice(idx, idx + size));
    idx += size;
  }
  return out;
}

/**
 * Havuzu seviyelere böler. Kelimelerde kalıcı `yds_level` (1..5) alanı varsa
 * doğrudan onu kullanır; aksi halde otomatik zorluk puanlamasına düşer.
 * Boş seviye oluşursa (veya hiç yds_level yoksa) kelimeler zorluk puanına göre
 * dengeli parçalara yeniden dağıtılır.
 * Döndürülen: [{ levelNumber, words }, ...] (her zaman 5 eleman)
 */
function buildFiveLevels(words) {
  const list = Array.isArray(words) ? words : [];

  // Kelimelerin çoğunda geçerli yds_level varsa doğrudan onu kullan
  const withYds = list.filter(w => Number(w.yds_level) >= 1 && Number(w.yds_level) <= LEVEL_COUNT);
  const useYds = withYds.length >= Math.max(1, Math.floor(list.length * 0.6));

  const scored = list.map(word => ({
    word,
    score: difficultyScore(word),
    level: useYds
      ? (Number(word.yds_level) >= 1 && Number(word.yds_level) <= LEVEL_COUNT
        ? Number(word.yds_level)
        : classifyDifficultyLevel(word))
      : classifyDifficultyLevel(word)
  }));

  const buckets = Array.from({ length: LEVEL_COUNT }, () => []);
  scored.forEach(item => buckets[item.level - 1].push(item.word));

  const nonEmpty = buckets.filter(b => b.length > 0).length;
  const desired = Math.min(LEVEL_COUNT, scored.length);

  // Özellik bazlı bölünme yeterli seviye üretmediyse dengeli parçalara böl
  if (scored.length >= LEVEL_COUNT && nonEmpty < desired) {
    const sorted = [...scored].sort((a, b) => a.score - b.score);
    const chunks = chunkBalanced(sorted, LEVEL_COUNT);
    for (let i = 0; i < LEVEL_COUNT; i++) {
      buckets[i] = chunks[i].map(item => item.word);
    }
  }

  return buckets.map((bucketWords, i) => ({
    levelNumber: i + 1,
    words: bucketWords
  }));
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

// Phrasal yapılarda ilk kelimenin fiil olma olasılığı yüksektir
const COMMON_VERB_STEMS = new Set([
  'take', 'get', 'give', 'put', 'look', 'turn', 'come', 'go', 'make', 'do',
  'run', 'set', 'bring', 'call', 'carry', 'break', 'hold', 'keep', 'pick',
  'point', 'pull', 'show', 'stand', 'work', 'write', 'cut', 'find', 'figure'
]);

function detectPos(word) {
  const explicit = normalizeWord(word.pos || word.posTag || word.partOfSpeech || '');
  const aliases = {
    noun: 'noun', n: 'noun', isim: 'noun',
    verb: 'verb', v: 'verb', fiil: 'verb',
    adjective: 'adjective', adj: 'adjective', sifat: 'adjective',
    adverb: 'adverb', adv: 'adverb', zarf: 'adverb'
  };
  if (aliases[explicit]) return aliases[explicit];

  const en = normalizeWord(word.english || word.en || '');
  const tr = String(word.turkish || word.tr || '').toLowerCase();

  if (!en) return 'unknown';

  if (COMMON_ADVERBS.has(en)) return 'adverb';

  // Phrasal / birleşik yapılar
  if (en.includes(' ')) {
    const first = en.split(' ')[0];
    if (COMMON_VERB_STEMS.has(first)) return 'verb';
    return 'noun';
  }

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
// yerine konur ve kelime türüne uygun doğal bir bağlam cümlesi üretilir.
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
  // Türü tespit edilemeyen kelimeler için doğal, meta olmayan bağlam cümleleri
  unknown: [
    {
      en: 'We discussed the {{WORD}} in detail during the lesson.',
      tr: 'Derste {{TR}} konusunu ayrıntılı olarak tartıştık.'
    },
    {
      en: 'She mentioned the {{WORD}} while explaining her idea.',
      tr: 'Fikrini açıklarken {{TR}} konusundan bahsetti.'
    },
    {
      en: 'The {{WORD}} plays an important role in this context.',
      tr: 'Bu bağlamda {{TR}} önemli bir rol oynar.'
    },
    {
      en: 'He used the {{WORD}} to support his main argument.',
      tr: 'Ana argümanını desteklemek için {{TR}} kullandı.'
    }
  ]
};

// Yapay/şablon örnek cümleleri tespit et (ör. "The word X appeared in...")
function isArtificialExample(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return /^the word\b/.test(t)
    || /appeared in/.test(t)
    || /is an? (english|turkish) word/.test(t)
    || /in the dictionary/.test(t)
    || /\bexample sentence\b/.test(t);
}

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
 * doğal şablon havuzundan üretilir.
 */
function buildExample(word, seedIndex) {
  const en = String(word.english || word.en || '').trim();
  const tr = String(word.turkish || word.tr || '').trim();
  const pos = detectPos(word);
  const dbExampleEn = String(word.example_en || word.exampleEn || '').trim();
  const dbExampleTr = String(word.example_tr || word.exampleTr || '').trim();

  // 1. Veritabanında hazır ve geçerli örnek cümle varsa doğrudan kullan
  //    (yapay/şablon cümleler atlanır -> doğal cümleye düşülür)
  if (dbExampleEn && !isArtificialExample(dbExampleEn)) {
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

  // 2. Türüne uygun şablon havuzundan doğal cümle üret
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
function buildOptions(target, levelWords, distractorPool) {
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

  // Öncelik sırası: aynı seviye + aynı tür -> aynı tür (tüm havuz) -> tüm havuz
  const sameLevelSamePos = dedupe(levelWords.filter(w => detectPos(w) === targetPos));
  const poolSamePos = dedupe(distractorPool.filter(w => detectPos(w) === targetPos));
  const poolAnyPos = dedupe(distractorPool);

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
 * Seçilmiş kelimelerden tam ders nesnesi (kartlar + test) üretir.
 * Test sorularının sırası kart sırasından bağımsız olarak karıştırılır.
 */
function buildLesson(selectedWords, distractorPool, levelNumber, totalLevels) {
  const examples = selectedWords.map((w, i) => buildExample(w, i));

  const wordsData = selectedWords.map((w, i) => ({
    id: w.id,
    index: i + 1,
    english: w.english,
    turkish: w.turkish,
    pronunciation: w.pronunciation || '',
    pos: examples[i].pos,
    yds_level: Number(w.yds_level) >= 1 && Number(w.yds_level) <= LEVEL_COUNT ? Number(w.yds_level) : levelNumber,
    part_of_speech: w.part_of_speech || examples[i].pos,
    synonyms: Array.isArray(w.synonyms) ? w.synonyms : [],
    example_en: examples[i].example_en,
    example_tr: examples[i].example_tr
  }));

  // Fisher-Yates: test soruları kart sırasıyla aynı olmamalı
  const quizOrder = fisherYates(selectedWords.map((w, i) => i));

  const quizData = quizOrder.map((originalIdx, qIdx) => {
    const word = selectedWords[originalIdx];
    const example = examples[originalIdx];
    const { options, correct_answer } = buildOptions(word, selectedWords, distractorPool);
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

  return {
    level_number: levelNumber,
    total_levels: totalLevels || LEVEL_COUNT,
    words_data: wordsData,
    quiz_data: quizData
  };
}

// ---------------------------------------------------------------------------
// 5. Tekrarsız kelime seçimi (zorlu kelime öncelikli)
// ---------------------------------------------------------------------------
function selectSessionWords(pool, completedSet, wrongCounts, size) {
  const limit = size || LEVEL_SIZE;
  const weightFn = (word) => {
    const key = normalizeWord(word.english);
    const wc = Number((wrongCounts && wrongCounts[key]) || word.wrongCount || 0);
    return 1 + wc * 2; // "Zorlu Kelimeler" öncelik kazanır
  };

  const unseen = pool.filter(w => !completedSet.has(normalizeWord(w.english)));
  if (unseen.length === 0) {
    // Bu seviyedeki tüm kelimeler tamamlandı -> seviye döngüsü sıfırlanır
    const words = fisherYates(weightedSample(pool, weightFn, limit));
    return { words, poolReset: true };
  }

  const words = fisherYates(weightedSample(unseen, weightFn, limit));
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
  LEVEL_COUNT,
  OPTION_COUNT,
  PASS_RATIO,
  BLANK,
  normalizeWord,
  fisherYates,
  chunkBalanced,
  difficultyScore,
  classifyDifficultyLevel,
  buildFiveLevels,
  detectPos,
  isArtificialExample,
  buildExample,
  buildOptions,
  buildLesson,
  selectSessionWords,
  enrichWithGemini
};
