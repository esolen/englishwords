/**
 * YDS (Yabancı Dil Bilgisi Seviye Tespit Sınavı) Sınıflandırma ve Zenginleştirme Motoru
 *
 * Bu modül tamamen bağımsızdır (harici bağımlılık yoktur, veritabanına erişmez).
 * Veritabanındaki her kelime kaydı için şu kalıcı alanları üretir:
 *   - yds_level        : 1..5 (YDS zorluk seviyesi)
 *   - part_of_speech   : Verb | Noun | Adj | Adv | Phrasal Verb | Conjunction | Preposition
 *   - synonyms         : Veritabanındaki aynı/yakın Türkçe anlamlı kelimeler (dizi)
 *   - example_en / example_tr : Doğal, YDS bağlamına uygun örnek cümleler
 *
 * Hiçbir kelime SİLİNMEZ; yalnızca bu meta alanlar hesaplanır/işlenir.
 */

// ---------------------------------------------------------------------------
// 0. Sabitler ve yardımcılar
// ---------------------------------------------------------------------------
const LEVEL_MIN = 1;
const LEVEL_MAX = 5;

const LEVEL_LABELS = {
  1: 'Temel YDS Çekirdek (A2-B1)',
  2: 'Orta Düzey Akademik (B1-B2)',
  3: 'İleri Akademik & Soyut (B2-C1)',
  4: 'YDS Çeldirici & Üst Düzey (C1+)',
  5: 'Phrasal Verbs, Bağlaçlar & Akademik Kalıplar'
};

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

// Türkçe anlamı anlam parçacıklarına ayır (eş anlamlı eşleştirmesi için)
function meaningTokens(turkish) {
  return String(turkish || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;/|]|\s+ve\s+|\s+veya\s+/)
    .map(t => t.replace(/[^a-zçğıöşü\s]/gi, ' ').trim())
    .filter(t => t.length >= 2);
}

// ---------------------------------------------------------------------------
// 1. Küratörlü YDS seviye sözlüğü
// ---------------------------------------------------------------------------
// Seviye 1 — Temel YDS çekirdek kelimeleri (A2-B1)
const LEVEL1 = new Set([
  'improve', 'require', 'significant', 'available', 'provide', 'increase', 'important',
  'modern', 'learn', 'begin', 'start', 'finish', 'create', 'change', 'choose', 'listen',
  'speak', 'write', 'read', 'think', 'understand', 'remember', 'travel', 'follow', 'happen',
  'continue', 'include', 'expect', 'develop', 'simple', 'useful', 'future', 'friend',
  'family', 'people', 'action', 'reason', 'water', 'house', 'school', 'happy', 'small',
  'great', 'place', 'time', 'work', 'book', 'food', 'money', 'music', 'city', 'country',
  'problem', 'answer', 'question', 'accept', 'achieve', 'decide', 'daily', 'study',
  'reduce', 'produce', 'support', 'describe', 'explain', 'introduce', 'consider', 'suggest',
  'allow', 'prevent', 'avoid', 'cause', 'effect', 'result', 'method', 'system', 'process',
  'level', 'increase', 'decrease', 'value', 'quality', 'amount', 'number', 'group', 'type',
  'common', 'general', 'special', 'certain', 'possible', 'necessary', 'different', 'similar',
  'various', 'recent', 'current', 'local', 'natural', 'physical', 'social', 'economic'
]);

// Seviye 2 — Orta düzey akademik kelimeler (B1-B2)
const LEVEL2 = new Set([
  'implement', 'determine', 'crucial', 'evident', 'maintain', 'substantial', 'establish',
  'identify', 'indicate', 'involve', 'obtain', 'assume', 'estimate', 'assess', 'evaluate',
  'analyse', 'analyze', 'approach', 'aspect', 'benefit', 'challenge', 'concept', 'conclude',
  'conduct', 'confirm', 'consist', 'construct', 'contribute', 'convince', 'decline',
  'demonstrate', 'derive', 'distinguish', 'emphasize', 'enhance', 'ensure', 'examine',
  'expand', 'expose', 'extend', 'facilitate', 'focus', 'generate', 'guarantee', 'illustrate',
  'imply', 'impose', 'indicate', 'influence', 'interpret', 'investigate', 'justify',
  'modify', 'monitor', 'motivate', 'observe', 'occur', 'perceive', 'permit', 'persist',
  'predict', 'preserve', 'promote', 'pursue', 'recognize', 'reflect', 'regulate', 'reinforce',
  'relate', 'remain', 'require', 'resolve', 'respond', 'reveal', 'revise', 'seek',
  'specify', 'strengthen', 'sufficient', 'suspect', 'sustain', 'transform', 'transmit',
  'tend', 'vary', 'achieve', 'adequate', 'apparent', 'appropriate', 'complex', 'consistent',
  'critical', 'distinct', 'diverse', 'dominant', 'efficient', 'essential', 'extensive',
  'frequent', 'fundamental', 'gradual', 'initial', 'intense', 'major', 'minor', 'obvious',
  'potential', 'precise', 'primary', 'principle', 'priority', 'relevant', 'reliable',
  'remarkable', 'resistant', 'specific', 'stable', 'suitable', 'typical', 'ultimate', 'valid'
]);

// Seviye 3 — İleri akademik ve soyut kavramlar (B2-C1)
const LEVEL3 = new Set([
  'deteriorate', 'mitigate', 'indispensable', 'ambiguous', 'proliferate', 'allocate',
  'alleviate', 'anticipate', 'articulate', 'ascertain', 'attain', 'attribute', 'augment',
  'coherent', 'coincide', 'compile', 'comply', 'comprise', 'conceive', 'concurrent',
  'confer', 'confine', 'conform', 'consecutive', 'consolidate', 'constitute', 'contemplate',
  'contradict', 'convey', 'correlate', 'correspond', 'counterpart', 'culminate', 'deem',
  'deficiency', 'deliberate', 'depict', 'deprive', 'deter', 'deviate', 'diminish',
  'discard', 'disclose', 'discrepancy', 'disperse', 'dispose', 'disrupt', 'diverge',
  'dominate', 'elaborate', 'elicit', 'embody', 'emerge', 'encompass', 'endeavour',
  'endorse', 'endure', 'envisage', 'equate', 'erode', 'evoke', 'exceed', 'exclude',
  'exempt', 'exert', 'explicit', 'exploit', 'facilitate', 'feasible', 'fluctuate',
  'formulate', 'foster', 'hinder', 'hypothesis', 'imminent', 'impair', 'impede', 'implicit',
  'incorporate', 'incur', 'infer', 'inherent', 'inhibit', 'integrate', 'intervene',
  'intrinsic', 'manifest', 'meticulous', 'negligible', 'notion', 'obsolete', 'offset',
  'outweigh', 'paradigm', 'pervasive', 'phenomenon', 'plausible', 'precede', 'predominant',
  'preliminary', 'presume', 'prevail', 'profound', 'prominent', 'propagate', 'prospect',
  'proximity', 'rationale', 'reciprocal', 'redundant', 'refute', 'reinstate', 'reluctant',
  'resilient', 'retain', 'revere', 'rigorous', 'scrutiny', 'sequential', 'simultaneous',
  'sophisticated', 'sporadic', 'stagnant', 'subsequent', 'subsidy', 'substantiate', 'subtle',
  'succumb', 'supplement', 'suppress', 'surpass', 'susceptible', 'tangible', 'tentative',
  'terminate', 'transient', 'unprecedented', 'viable', 'vigorous', 'virtually', 'withstand'
]);

// Seviye 4 — YDS çeldirici ve üst düzey kelimeler (C1+)
const LEVEL4 = new Set([
  'exacerbate', 'ubiquitous', 'precarious', 'scrutinize', 'bolster', 'clandestine',
  'abate', 'aberrant', 'abhor', 'abject', 'abstain', 'acquiesce', 'acrimonious', 'adamant',
  'adroit', 'adverse', 'affable', 'alacrity', 'altruistic', 'ameliorate', 'anomaly',
  'antipathy', 'apathy', 'appease', 'apprehension', 'arbitrary', 'arduous', 'ascetic',
  'assiduous', 'astute', 'audacious', 'austere', 'avarice', 'belligerent', 'benevolent',
  'bequeath', 'blatant', 'bombastic', 'bureaucratic', 'cacophony', 'candid', 'capricious',
  'castigate', 'caustic', 'censure', 'chastise', 'circumspect', 'clandestine', 'coerce',
  'cogent', 'commiserate', 'complacent', 'conciliatory', 'condone', 'conducive', 'conflate',
  'congenial', 'conjecture', 'connoisseur', 'contentious', 'contrite', 'copious',
  'corroborate', 'credulous', 'culpable', 'cursory', 'dearth', 'debilitate', 'decry',
  'deference', 'defunct', 'deleterious', 'delineate', 'denounce', 'deplete', 'deprecate',
  'derogatory', 'desolate', 'despondent', 'detrimental', 'devious', 'didactic', 'diffident',
  'digress', 'diligent', 'discern', 'disconcert', 'discreet', 'disdain', 'disparage',
  'disparate', 'disseminate', 'dissent', 'divulge', 'dogmatic', 'dormant', 'dubious',
  'ebullient', 'eclectic', 'efface', 'effervescent', 'egregious', 'elucidate', 'elusive',
  'embellish', 'eminent', 'empirical', 'emulate', 'enervate', 'engender', 'enigma',
  'enmity', 'ephemeral', 'epitome', 'equivocal', 'erudite', 'esoteric', 'eulogy',
  'euphemism', 'exacting', 'exalt', 'exasperate', 'exemplary', 'exhort', 'exigent',
  'extol', 'extraneous', 'extricate', 'exuberant', 'facetious', 'fallacious', 'fastidious',
  'fathom', 'feckless', 'fervent', 'flippant', 'florid', 'foible', 'forbearance',
  'formidable', 'fortuitous', 'fractious', 'frugal', 'furtive', 'futile', 'garrulous',
  'germane', 'grandiloquent', 'gregarious', 'hackneyed', 'harbinger', 'haughty', 'hegemony',
  'heinous', 'heresy', 'hiatus', 'homogeneous', 'hyperbole', 'idiosyncratic', 'idyllic',
  'ignominious', 'illicit', 'immaculate', 'impecunious', 'imperious', 'imperturbable',
  'impervious', 'implacable', 'importune', 'impromptu', 'impugn', 'inadvertent', 'incisive',
  'incontrovertible', 'indict', 'indigent', 'indolent', 'ineffable', 'ineluctable',
  'inept', 'inert', 'ingenious', 'ingenuous', 'innocuous', 'inordinate', 'insidious',
  'insolent', 'insurmountable', 'intrepid', 'inundate', 'invective', 'irascible',
  'itinerant', 'jubilant', 'juxtapose', 'laconic', 'lament', 'languid', 'latent',
  'laudable', 'lax', 'lithe', 'loquacious', 'lucid', 'lucrative', 'magnanimous',
  'malevolent', 'malleable', 'maverick', 'mendacious', 'mercurial', 'meritorious',
  'misanthrope', 'mitigate', 'morose', 'mundane', 'munificent', 'myriad', 'nascent',
  'nefarious', 'neophyte', 'nonchalant', 'nostalgia', 'novice', 'nuance', 'obfuscate',
  'obsequious', 'obstinate', 'obtuse', 'officious', 'ominous', 'onerous', 'opaque',
  'opulent', 'ostensible', 'ostentatious', 'ostracize', 'palatable', 'palliate', 'panacea',
  'paradox', 'paragon', 'pariah', 'parsimonious', 'paucity', 'pedantic', 'penchant',
  'penitent', 'peremptory', 'perennial', 'perfidious', 'perfunctory', 'pernicious',
  'perspicacious', 'pertinent', 'petulant', 'philanthropic', 'pinnacle', 'pious',
  'pittance', 'placate', 'placid', 'plethora', 'poignant', 'polemical', 'ponderous',
  'pragmatic', 'precarious', 'precedent', 'preclude', 'precocious', 'predilection',
  'preeminent', 'preposterous', 'prerogative', 'prescient', 'pretext', 'prodigal',
  'prodigious', 'proficient', 'profligate', 'profuse', 'prolific', 'propensity',
  'propitious', 'prosaic', 'protean', 'provincial', 'prudent', 'puerile', 'pugnacious',
  'punctilious', 'pundit', 'quandary', 'quell', 'querulous', 'quiescent', 'quintessential',
  'quixotic', 'rampant', 'rancor', 'rapacious', 'rebuff', 'rebuke', 'recalcitrant',
  'recant', 'reciprocate', 'reclusive', 'recondite', 'rectitude', 'redolent', 'redundant',
  'refractory', 'regale', 'relegate', 'remiss', 'remonstrate', 'replete', 'reprehensible',
  'reproach', 'repudiate', 'rescind', 'reticent', 'reverent', 'rhetoric', 'ribald',
  'rife', 'robust', 'rudimentary', 'ruthless', 'sagacious', 'salient', 'salubrious',
  'sanguine', 'scathing', 'scrupulous', 'sedulous', 'servile', 'sinister', 'skeptical',
  'slovenly', 'solicitous', 'solitude', 'somber', 'soporific', 'specious', 'spurious',
  'squalid', 'staid', 'steadfast', 'stentorian', 'stoic', 'stringent', 'stupendous',
  'suave', 'sublime', 'subservient', 'succinct', 'sullen', 'supercilious', 'superfluous',
  'supplant', 'surfeit', 'surmise', 'surreptitious', 'sycophant', 'tacit', 'taciturn',
  'tangential', 'tawdry', 'temerity', 'tenacious', 'tenuous', 'tepid', 'terse', 'thwart',
  'timorous', 'torpid', 'tortuous', 'tractable', 'transgress', 'trenchant', 'trepidation',
  'trite', 'truculent', 'turbulent', 'turgid', 'ubiquitous', 'umbrage', 'unctuous',
  'undulate', 'unfeigned', 'untenable', 'untoward', 'usurp', 'vacillate', 'vanguard',
  'vehement', 'venerate', 'veracity', 'verbose', 'verisimilitude', 'vestige', 'vex',
  'vicarious', 'vicissitude', 'vigilant', 'vindicate', 'vindictive', 'virtuoso', 'virulent',
  'viscous', 'vivacious', 'vociferous', 'volatile', 'voracious', 'vulnerable', 'waive',
  'wane', 'wanton', 'wary', 'whet', 'whimsical', 'zealot', 'zenith', 'zephyr'
]);

// Seviye 5 — Phrasal verbs, bağlaçlar ve akademik kalıplar
const LEVEL5 = new Set([
  'account for', 'stem from', 'bring about', 'in terms of', 'notwithstanding', 'albeit',
  'give rise to', 'carry out', 'put forward', 'come up with', 'point out', 'set out',
  'take into account', 'result in', 'lead to', 'consist of', 'refer to', 'depend on',
  'rely on', 'focus on', 'deal with', 'cope with', 'aim at', 'account for', 'allow for',
  'call for', 'opt for', 'rule out', 'single out', 'draw on', 'build on', 'embark on',
  'resort to', 'subject to', 'attribute to', 'ascribe to', 'adhere to', 'conform to',
  'contribute to', 'give in', 'hold back', 'carry on', 'bring up', 'take up', 'take on',
  'turn out', 'work out', 'make up', 'put off', 'set up', 'look into', 'break down',
  'come across', 'get rid of', 'keep up with', 'put up with', 'look forward to',
  'in spite of', 'on behalf of', 'with regard to', 'as regards', 'owing to', 'due to',
  'apart from', 'aside from', 'rather than', 'as well as', 'provided that', 'in that',
  'so long as', 'even though', 'in order that', 'by means of', 'for the sake of',
  'with respect to', 'in accordance with', 'in the light of', 'on the grounds that',
  'as a result of', 'in contrast to', 'as opposed to', 'by virtue of', 'in the event of'
]);

// Tüm küratörlü sözlükleri birleştir (düşük seviye önceliklidir; çakışmada korunur)
const CURATED_LEVELS = new Map();
function registerCurated(set, level) {
  set.forEach(w => {
    const key = normalize(w);
    if (!CURATED_LEVELS.has(key)) CURATED_LEVELS.set(key, level);
  });
}
registerCurated(LEVEL1, 1);
registerCurated(LEVEL2, 2);
registerCurated(LEVEL3, 3);
registerCurated(LEVEL4, 4);
registerCurated(LEVEL5, 5);

// Küratörlü örnek cümleler (phrasal verb / bağlaç gibi zor yapılar için)
const CURATED_EXAMPLES = {
  'account for': {
    en: 'Several factors account for the sharp rise in energy prices.',
    tr: 'Enerji fiyatlarındaki keskin artışın nedeni birkaç faktördür.'
  },
  'stem from': {
    en: 'Most of these problems stem from a lack of proper planning.',
    tr: 'Bu sorunların çoğu uygun planlama eksikliğinden kaynaklanır.'
  },
  'bring about': {
    en: 'The new regulations could bring about significant social change.',
    tr: 'Yeni düzenlemeler önemli bir toplumsal değişime yol açabilir.'
  },
  'in terms of': {
    en: 'The two methods differ considerably in terms of cost and efficiency.',
    tr: 'İki yöntem maliyet ve verimlilik açısından önemli ölçüde farklıdır.'
  },
  'notwithstanding': {
    en: 'Notwithstanding its limitations, the study offers valuable insights.',
    tr: 'Sınırlamalarına rağmen, çalışma değerli bilgiler sunuyor.'
  },
  'albeit': {
    en: 'The results were promising, albeit preliminary.',
    tr: 'Sonuçlar, her ne kadar ön nitelikte olsa da, umut vericiydi.'
  },
  'give rise to': {
    en: 'Such policies may give rise to unexpected economic consequences.',
    tr: 'Bu tür politikalar beklenmedik ekonomik sonuçlara yol açabilir.'
  },
  'carry out': {
    en: 'The researchers carried out a series of controlled experiments.',
    tr: 'Araştırmacılar bir dizi kontrollü deney gerçekleştirdi.'
  },
  'put forward': {
    en: 'She put forward a compelling argument in favour of the proposal.',
    tr: 'Öneri lehine ikna edici bir argüman ortaya koydu.'
  },
  'come up with': {
    en: 'The team came up with an innovative solution to the problem.',
    tr: 'Ekip soruna yenilikçi bir çözüm buldu.'
  },
  'point out': {
    en: 'The author points out several weaknesses in the existing theory.',
    tr: 'Yazar mevcut teorideki birkaç zayıflığa dikkat çekiyor.'
  },
  'result in': {
    en: 'The delay resulted in a considerable increase in overall costs.',
    tr: 'Gecikme toplam maliyetlerde önemli bir artışa yol açtı.'
  },
  'lead to': {
    en: 'Poor communication often leads to serious misunderstandings.',
    tr: 'Kötü iletişim sıklıkla ciddi yanlış anlamalara yol açar.'
  },
  'consist of': {
    en: 'The committee consists of ten members from various departments.',
    tr: 'Komite çeşitli bölümlerden on üyeden oluşur.'
  },
  'refer to': {
    en: 'The term refers to a wide range of social phenomena.',
    tr: 'Terim, çok çeşitli toplumsal olgulara atıfta bulunur.'
  },
  'deal with': {
    en: 'Governments must deal with the challenges of rapid urbanisation.',
    tr: 'Hükümetler hızlı kentleşmenin zorluklarıyla baş etmelidir.'
  },
  'cope with': {
    en: 'Many families struggle to cope with rising living costs.',
    tr: 'Birçok aile artan yaşam maliyetleriyle baş etmekte zorlanıyor.'
  },
  'allow for': {
    en: 'The schedule should allow for unexpected delays.',
    tr: 'Program beklenmedik gecikmeleri hesaba katmalıdır.'
  },
  'call for': {
    en: 'The crisis calls for immediate and decisive action.',
    tr: 'Kriz acil ve kararlı bir eylem gerektiriyor.'
  },
  'opt for': {
    en: 'Many consumers now opt for environmentally friendly products.',
    tr: 'Birçok tüketici artık çevre dostu ürünleri tercih ediyor.'
  },
  'rule out': {
    en: 'The evidence does not rule out the possibility of error.',
    tr: 'Kanıtlar hata olasılığını dışlamıyor.'
  },
  'draw on': {
    en: 'The study draws on data collected over two decades.',
    tr: 'Çalışma yirmi yılı aşkın sürede toplanan verilerden yararlanıyor.'
  },
  'put up with': {
    en: 'Residents should not have to put up with such noise.',
    tr: 'Sakinler bu tür bir gürültüye katlanmak zorunda kalmamalı.'
  },
  'keep up with': {
    en: 'Firms must keep up with rapid technological change.',
    tr: 'Firmalar hızlı teknolojik değişime ayak uydurmalıdır.'
  },
  'get rid of': {
    en: 'The company decided to get rid of its outdated equipment.',
    tr: 'Şirket modası geçmiş ekipmanından kurtulmaya karar verdi.'
  },
  'in spite of': {
    en: 'In spite of the setbacks, the project was completed on time.',
    tr: 'Aksiliklere rağmen proje zamanında tamamlandı.'
  },
  'on behalf of': {
    en: 'She accepted the award on behalf of the entire team.',
    tr: 'Ödülü tüm ekip adına kabul etti.'
  },
  'with regard to': {
    en: 'With regard to funding, no final decision has been made.',
    tr: 'Finansman konusunda henüz kesin bir karar verilmedi.'
  },
  'due to': {
    en: 'The flight was cancelled due to severe weather conditions.',
    tr: 'Uçuş olumsuz hava koşulları nedeniyle iptal edildi.'
  },
  'apart from': {
    en: 'Apart from a few minor errors, the report was excellent.',
    tr: 'Birkaç küçük hatanın dışında rapor mükemmeldi.'
  },
  'rather than': {
    en: 'The company chose to invest rather than cut costs.',
    tr: 'Şirket maliyetleri kısmak yerine yatırım yapmayı seçti.'
  },
  'as well as': {
    en: 'The policy affects employers as well as employees.',
    tr: 'Politika çalışanların yanı sıra işverenleri de etkiliyor.'
  },
  'provided that': {
    en: 'The offer is valid provided that payment is made in advance.',
    tr: 'Teklif, ödemenin önceden yapılması koşuluyla geçerlidir.'
  },
  'even though': {
    en: 'Even though the task was difficult, they finished it early.',
    tr: 'Görev zor olmasına rağmen onu erken bitirdiler.'
  },
  'by means of': {
    en: 'The data were analysed by means of advanced statistical models.',
    tr: 'Veriler ileri istatistiksel modeller aracılığıyla analiz edildi.'
  },
  'in accordance with': {
    en: 'All procedures were conducted in accordance with the guidelines.',
    tr: 'Tüm işlemler yönergelere uygun olarak yürütüldü.'
  }
};

// ---------------------------------------------------------------------------
// 2. Kelime türü (part_of_speech) tespiti
// ---------------------------------------------------------------------------
// Tek kelimelik yaygın fiiller (son ek ipucu vermeyenler) — POS tespitini güçlendirir
const KNOWN_VERBS = new Set([
  'improve', 'require', 'provide', 'increase', 'decrease', 'reduce', 'learn', 'begin',
  'start', 'finish', 'create', 'change', 'choose', 'listen', 'speak', 'write', 'read',
  'think', 'understand', 'remember', 'travel', 'follow', 'happen', 'continue', 'include',
  'expect', 'develop', 'accept', 'achieve', 'decide', 'produce', 'support', 'describe',
  'explain', 'introduce', 'consider', 'suggest', 'allow', 'prevent', 'avoid', 'cause',
  'implement', 'determine', 'maintain', 'establish', 'identify', 'indicate', 'involve',
  'obtain', 'assume', 'estimate', 'assess', 'evaluate', 'analyse', 'analyze', 'approach',
  'benefit', 'challenge', 'conclude', 'conduct', 'confirm', 'consist', 'construct',
  'contribute', 'convince', 'decline', 'demonstrate', 'derive', 'distinguish', 'emphasize',
  'enhance', 'ensure', 'examine', 'expand', 'expose', 'extend', 'facilitate', 'focus',
  'generate', 'guarantee', 'illustrate', 'imply', 'impose', 'influence', 'interpret',
  'investigate', 'justify', 'modify', 'monitor', 'motivate', 'observe', 'occur', 'perceive',
  'permit', 'persist', 'predict', 'preserve', 'promote', 'pursue', 'recognize', 'reflect',
  'regulate', 'reinforce', 'relate', 'remain', 'resolve', 'respond', 'reveal', 'revise',
  'seek', 'specify', 'strengthen', 'suspect', 'sustain', 'transform', 'transmit', 'tend',
  'vary', 'deteriorate', 'mitigate', 'proliferate', 'allocate', 'alleviate', 'anticipate',
  'articulate', 'ascertain', 'attain', 'attribute', 'augment', 'coincide', 'compile',
  'comply', 'comprise', 'conceive', 'confer', 'confine', 'conform', 'consolidate',
  'constitute', 'contemplate', 'contradict', 'convey', 'correlate', 'correspond',
  'culminate', 'deem', 'depict', 'deprive', 'deter', 'deviate', 'diminish', 'discard',
  'disclose', 'disperse', 'dispose', 'disrupt', 'diverge', 'dominate', 'elaborate',
  'elicit', 'embody', 'emerge', 'encompass', 'endorse', 'endure', 'envisage', 'equate',
  'erode', 'evoke', 'exceed', 'exclude', 'exempt', 'exert', 'exploit', 'fluctuate',
  'formulate', 'foster', 'hinder', 'impair', 'impede', 'incorporate', 'incur', 'infer',
  'inhibit', 'integrate', 'intervene', 'manifest', 'offset', 'outweigh', 'precede',
  'presume', 'prevail', 'propagate', 'refute', 'reinstate', 'retain', 'revere',
  'substantiate', 'succumb', 'supplement', 'suppress', 'surpass', 'terminate', 'withstand',
  'exacerbate', 'scrutinize', 'bolster', 'abate', 'abhor', 'abstain', 'acquiesce',
  'ameliorate', 'appease', 'bequeath', 'castigate', 'censure', 'chastise', 'coerce',
  'commiserate', 'condone', 'conflate', 'corroborate', 'debilitate', 'decry', 'delineate',
  'denounce', 'deplete', 'deprecate', 'digress', 'discern', 'disconcert', 'disparage',
  'disseminate', 'dissent', 'divulge', 'efface', 'elucidate', 'embellish', 'emulate',
  'enervate', 'engender', 'exalt', 'exasperate', 'exhort', 'extol', 'extricate', 'fathom',
  'impugn', 'indict', 'inundate', 'juxtapose', 'lament', 'obfuscate', 'ostracize',
  'palliate', 'placate', 'preclude', 'rebuff', 'rebuke', 'recant', 'reciprocate',
  'relegate', 'remonstrate', 'repudiate', 'rescind', 'supplant', 'surmise', 'thwart',
  'transgress', 'usurp', 'vacillate', 'venerate', 'vex', 'vindicate', 'waive', 'wane',
  'whet'
]);

const CONJUNCTIONS = new Set([
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'although', 'though', 'because',
  'since', 'unless', 'until', 'while', 'whereas', 'whether', 'if', 'whenever',
  'notwithstanding', 'albeit', 'however', 'therefore', 'moreover', 'furthermore',
  'nevertheless', 'nonetheless', 'consequently', 'meanwhile', 'otherwise'
]);

const PREPOSITIONS = new Set([
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at',
  'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by',
  'despite', 'down', 'during', 'except', 'for', 'from', 'in', 'inside', 'into',
  'like', 'near', 'of', 'off', 'on', 'onto', 'opposite', 'outside', 'over', 'past',
  'per', 'plus', 'regarding', 'round', 'since', 'than', 'through', 'throughout',
  'till', 'to', 'toward', 'towards', 'under', 'underneath', 'unlike', 'until', 'up',
  'upon', 'versus', 'via', 'within', 'without'
]);

// Çok kelimeli bağlaç/edat kalıpları
const MULTIWORD_CONNECTORS = new Set([
  'in terms of', 'in spite of', 'on behalf of', 'with regard to', 'as regards',
  'owing to', 'due to', 'apart from', 'aside from', 'rather than', 'as well as',
  'provided that', 'so long as', 'even though', 'in order that', 'by means of',
  'for the sake of', 'with respect to', 'in accordance with', 'in the light of',
  'on the grounds that', 'as a result of', 'in contrast to', 'as opposed to',
  'by virtue of', 'in the event of', 'according to', 'because of', 'instead of',
  'in addition to', 'prior to', 'regardless of', 'thanks to'
]);

const COMMON_VERB_STEMS = new Set([
  'take', 'get', 'give', 'put', 'look', 'turn', 'come', 'go', 'make', 'do', 'run',
  'set', 'bring', 'call', 'carry', 'break', 'hold', 'keep', 'pick', 'point', 'pull',
  'show', 'stand', 'work', 'write', 'cut', 'find', 'figure', 'account', 'stem',
  'opt', 'rule', 'draw', 'build', 'embark', 'resort', 'adhere', 'conform', 'refer',
  'rely', 'depend', 'focus', 'deal', 'cope', 'aim', 'allow', 'lead', 'result',
  'consist', 'contribute', 'attribute', 'subject', 'single', 'ascribe'
]);

const PARTICLES = new Set([
  'up', 'down', 'off', 'on', 'in', 'out', 'over', 'through', 'into', 'about',
  'around', 'back', 'away', 'along', 'forward', 'to', 'with', 'for', 'from', 'at', 'after'
]);

const EXPLICIT_POS_ALIASES = {
  noun: 'Noun', n: 'Noun', isim: 'Noun',
  verb: 'Verb', v: 'Verb', fiil: 'Verb',
  adjective: 'Adj', adj: 'Adj', sifat: 'Adj', sıfat: 'Adj',
  adverb: 'Adv', adv: 'Adv', zarf: 'Adv',
  'phrasal verb': 'Phrasal Verb', phrasal: 'Phrasal Verb',
  conjunction: 'Conjunction', conj: 'Conjunction', bağlaç: 'Conjunction',
  preposition: 'Preposition', prep: 'Preposition', edat: 'Preposition'
};

function detectPartOfSpeech(word) {
  const explicit = normalize(word.part_of_speech || word.pos || word.posTag || '');
  if (EXPLICIT_POS_ALIASES[explicit]) return EXPLICIT_POS_ALIASES[explicit];

  const en = normalize(word.english || word.en || '');
  const tr = String(word.turkish || word.tr || '').toLowerCase();
  if (!en) return 'Noun';

  // Çok kelimeli yapılar
  if (en.includes(' ')) {
    if (MULTIWORD_CONNECTORS.has(en)) {
      // "in terms of", "due to" -> edat; "provided that", "even though" -> bağlaç
      if (/^(provided|even though|so long as|in order that|as a result)/.test(en)) return 'Conjunction';
      return 'Preposition';
    }
    const parts = en.split(' ');
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (COMMON_VERB_STEMS.has(first) && PARTICLES.has(last)) return 'Phrasal Verb';
    if (COMMON_VERB_STEMS.has(first)) return 'Phrasal Verb';
    return 'Noun';
  }

  if (CONJUNCTIONS.has(en)) return 'Conjunction';
  if (PREPOSITIONS.has(en)) return 'Preposition';
  if (KNOWN_VERBS.has(en)) return 'Verb';

  // Türkçe karşılıktan ipucu
  const firstTr = tr.split(',')[0].trim();
  if (/(mak|mek)$/.test(firstTr)) return 'Verb';

  // İngilizce son eklerden ipucu
  if (/ly$/.test(en) && en.length > 4) return 'Adv';
  if (/(tion|sion|ment|ness|ity|ance|ence|ship|hood|ism|ist|er|or|age|ure|ology)$/.test(en)) return 'Noun';
  if (/(ous|ful|ive|able|ible|al|ic|ish|less|ant|ent|ary|ory|ish)$/.test(en) && en.length > 4) return 'Adj';
  if (/(ate|ify|ise|ize|en)$/.test(en) && en.length > 4) return 'Verb';

  return 'Noun';
}

// ---------------------------------------------------------------------------
// 3. YDS seviye sınıflandırması
// ---------------------------------------------------------------------------
const ACADEMIC_SUFFIXES = [
  'tion', 'sion', 'ment', 'ance', 'ence', 'ible', 'able', 'tude', 'logy', 'ity',
  'ism', 'ency', 'aceous', 'escent', 'iloquent', 'iferous', 'esque'
];

const LATINATE_MARKERS = [
  'ious', 'eous', 'uous', 'ify', 'ate', 'ise', 'ize', 'itious', 'aceous', 'itude',
  'aceous', 'aneous', 'aneous'
];

/**
 * Dinamik YDS zorluk puanı (yüksek puan = zor).
 */
function difficultyScore(word) {
  const en = normalize(word.english || word.en || '');
  const letters = en.replace(/[^a-z]/g, '');
  const len = letters.length;
  const wrongCount = Number(word.wrongCount || word.wrong_count || 0);

  let score = 0;

  // Harf uzunluğu
  if (len <= 5) score += 0;
  else if (len <= 7) score += 1;
  else if (len <= 9) score += 2;
  else if (len <= 11) score += 3;
  else if (len <= 13) score += 4;
  else score += 5;

  // Çok kelimeli yapılar
  if (en.includes(' ')) score += 3;

  // Akademik / türetilmiş son ek
  if (ACADEMIC_SUFFIXES.some(s => letters.endsWith(s))) score += 1;

  // Latince/Fransızca köken işaretleri
  if (LATINATE_MARKERS.some(s => letters.endsWith(s))) score += 1;

  // Kullanıcının geçmiş yanlış istatistikleri (zorlu kelimeler üst seviyeye taşınır)
  score += Math.min(3, wrongCount);

  return score;
}

/**
 * Kelimeyi 1..5 arası bir YDS seviyesine atar.
 * Önce küratörlü sözlük, sonra dinamik puanlama kullanılır.
 */
function classifyLevel(word) {
  const en = normalize(word.english || word.en || '');
  if (!en) return 1;

  const curated = CURATED_LEVELS.get(en);
  if (curated) return curated;

  // Çok kelimeli ifadeler doğrudan Seviye 5 (phrasal/pattern)
  if (en.includes(' ')) return 5;

  const score = difficultyScore(word);
  if (score <= 0) return 1;
  if (score <= 2) return 2;
  if (score <= 4) return 3;
  if (score <= 6) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// 4. Doğal YDS örnek cümle üretimi
// ---------------------------------------------------------------------------
// Eski yapay şablonları (ör. "The word X appeared in...") tespit et
function isArtificialExample(text) {
  const t = normalize(text);
  if (!t) return false;
  return /^the word\b/.test(t)
    || /appeared in/.test(t)
    || /is an? (english|turkish) word/.test(t)
    || /in the dictionary/.test(t)
    || /\bexample sentence\b/.test(t);
}

const YDS_TEMPLATES = {
  Verb: [
    { en: 'Researchers must {{WORD}} the data carefully before drawing any conclusions.', tr: 'Araştırmacılar herhangi bir sonuca varmadan önce verileri dikkatle {{TR}}.' },
    { en: 'The committee decided to {{WORD}} the proposal at the next meeting.', tr: 'Komite bir sonraki toplantıda öneriyi {{TR}} kararı aldı.' },
    { en: 'It is essential to {{WORD}} these factors when making such decisions.', tr: 'Bu tür kararlar alırken bu faktörleri {{TR}} çok önemlidir.' },
    { en: 'Governments should {{WORD}} the long-term needs of their citizens.', tr: 'Hükümetler vatandaşlarının uzun vadeli ihtiyaçlarını {{TR}}.' }
  ],
  Noun: [
    { en: 'The {{WORD}} of the study was discussed in considerable detail.', tr: 'Çalışmanın {{TR}} büyük ölçüde ayrıntılı olarak tartışıldı.' },
    { en: 'There has been a significant {{WORD}} in recent years.', tr: 'Son yıllarda önemli bir {{TR}} olmuştur.' },
    { en: 'The report highlights the growing importance of {{WORD}}.', tr: 'Rapor, {{TR}} artan önemini vurguluyor.' },
    { en: 'Several factors influence the {{WORD}} of the final results.', tr: 'Nihai sonuçların {{TR}} birkaç faktör etkiler.' }
  ],
  Adj: [
    { en: 'The findings were considered {{WORD}} by the researchers.', tr: 'Bulgular araştırmacılar tarafından {{TR}} olarak değerlendirildi.' },
    { en: 'This is a {{WORD}} issue that requires careful attention.', tr: 'Bu, dikkatli bir ilgi gerektiren {{TR}} bir konudur.' },
    { en: 'The data proved to be highly {{WORD}} in practice.', tr: 'Veriler pratikte son derece {{TR}} olduğunu kanıtladı.' },
    { en: 'She made a {{WORD}} contribution to the overall project.', tr: 'Genel projeye {{TR}} bir katkı sağladı.' }
  ],
  Adv: [
    { en: 'The results were {{WORD}} consistent with the original hypothesis.', tr: 'Sonuçlar özgün hipotezle {{TR}} tutarlıydı.' },
    { en: 'The situation has {{WORD}} improved since the new policy was introduced.', tr: 'Yeni politika uygulandığından beri durum {{TR}} iyileşti.' },
    { en: 'The two variables are {{WORD}} related to each other.', tr: 'İki değişken birbiriyle {{TR}} ilişkilidir.' }
  ],
  'Phrasal Verb': [
    { en: 'Several factors {{WORD}} the sharp rise in overall costs.', tr: 'Toplam maliyetlerdeki keskin artışın nedeni birkaç faktördür.' },
    { en: 'The committee tried to {{WORD}} the issue before the deadline.', tr: 'Komite sorunu son tarihten önce ele almaya çalıştı.' },
    { en: 'These changes could {{WORD}} significant improvements in efficiency.', tr: 'Bu değişiklikler verimlilikte önemli iyileşmelere yol açabilir.' }
  ],
  Conjunction: [
    { en: '{{WORD}} the challenges, the team managed to complete the project on time.', tr: 'Zorluklara rağmen ekip projeyi zamanında tamamlamayı başardı.' },
    { en: 'The findings were encouraging, {{WORD}} somewhat preliminary.', tr: 'Bulgular, biraz ön nitelikte olsa da, umut vericiydi.' }
  ],
  Preposition: [
    { en: '{{WORD}} its limitations, the study offers valuable insights.', tr: 'Sınırlamalarına rağmen çalışma değerli bilgiler sunuyor.' },
    { en: 'The two approaches differ considerably {{WORD}} cost and efficiency.', tr: 'İki yaklaşım maliyet ve verimlilik açısından önemli ölçüde farklıdır.' }
  ]
};

function buildYdsExample(word, pos) {
  const en = String(word.english || word.en || '').trim();
  const tr = String(word.turkish || word.tr || '').trim();
  const key = normalize(en);

  // Küratörlü örnek varsa onu kullan (phrasal/bağlaç yapıları için en güvenilir)
  if (CURATED_EXAMPLES[key]) {
    return { example_en: CURATED_EXAMPLES[key].en, example_tr: CURATED_EXAMPLES[key].tr };
  }

  const pool = YDS_TEMPLATES[pos] || YDS_TEMPLATES.Noun;
  const tpl = pool[Math.abs(hashCode(key)) % pool.length];
  return {
    example_en: tpl.en.replace(/\{\{WORD\}\}/g, en),
    example_tr: tpl.tr.replace(/\{\{TR\}\}/g, tr || en)
  };
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// 5. Eş anlamlı (synonym) çapraz eşleştirme
// ---------------------------------------------------------------------------
// Yaygın YDS kelimeleri için küratörlü İngilizce eş anlamlılar
const CURATED_SYNONYMS = {
  improve: ['enhance', 'ameliorate', 'better'],
  enhance: ['improve', 'augment', 'boost'],
  require: ['demand', 'necessitate', 'need'],
  significant: ['substantial', 'considerable', 'notable'],
  substantial: ['significant', 'considerable', 'sizeable'],
  available: ['accessible', 'obtainable', 'attainable'],
  provide: ['supply', 'offer', 'furnish'],
  increase: ['augment', 'raise', 'expand'],
  decrease: ['reduce', 'diminish', 'decline'],
  reduce: ['decrease', 'diminish', 'lower'],
  implement: ['execute', 'apply', 'enforce'],
  determine: ['ascertain', 'establish', 'decide'],
  crucial: ['essential', 'vital', 'critical'],
  essential: ['crucial', 'vital', 'indispensable'],
  evident: ['obvious', 'apparent', 'clear'],
  obvious: ['evident', 'apparent', 'manifest'],
  maintain: ['sustain', 'preserve', 'uphold'],
  sustain: ['maintain', 'support', 'uphold'],
  allocate: ['distribute', 'assign', 'apportion'],
  mitigate: ['alleviate', 'reduce', 'lessen'],
  alleviate: ['mitigate', 'relieve', 'ease'],
  deteriorate: ['worsen', 'decline', 'degrade'],
  indispensable: ['essential', 'vital', 'crucial'],
  ambiguous: ['equivocal', 'unclear', 'vague'],
  proliferate: ['multiply', 'expand', 'mushroom'],
  exacerbate: ['aggravate', 'worsen', 'intensify'],
  ubiquitous: ['omnipresent', 'pervasive', 'widespread'],
  precarious: ['unstable', 'risky', 'insecure'],
  scrutinize: ['examine', 'inspect', 'analyse'],
  bolster: ['strengthen', 'reinforce', 'support'],
  clandestine: ['secret', 'covert', 'surreptitious'],
  hinder: ['impede', 'obstruct', 'hamper'],
  impede: ['hinder', 'obstruct', 'hamper'],
  augment: ['increase', 'enhance', 'supplement'],
  diminish: ['decrease', 'reduce', 'lessen'],
  profound: ['deep', 'intense', 'far-reaching'],
  resilient: ['robust', 'tough', 'adaptable'],
  rigorous: ['strict', 'thorough', 'meticulous'],
  coherent: ['consistent', 'logical', 'rational'],
  feasible: ['viable', 'practicable', 'workable'],
  viable: ['feasible', 'practicable', 'sustainable']
};

/**
 * Veritabanındaki kelimeler arasından aynı/yakın Türkçe anlamı paylaşanları
 * (ve küratörlü İngilizce eş anlamlıları) dizi olarak döndürür.
 */
function findSynonyms(word, allWords, limit = 6) {
  const en = normalize(word.english || word.en || '');
  const out = new Set();

  // 1) Küratörlü İngilizce eş anlamlılar
  (CURATED_SYNONYMS[en] || []).forEach(s => {
    if (s !== en) out.add(s);
  });

  // 2) Aynı/yakın Türkçe anlamı paylaşan veritabanı kelimeleri
  const targetTokens = new Set(meaningTokens(word.turkish || word.tr || ''));
  if (targetTokens.size > 0 && Array.isArray(allWords)) {
    for (const other of allWords) {
      const otherEn = normalize(other.english || other.en || '');
      if (!otherEn || otherEn === en) continue;
      const otherTokens = meaningTokens(other.turkish || other.tr || '');
      const shared = otherTokens.some(t => targetTokens.has(t));
      if (shared) out.add(otherEn);
      if (out.size >= limit) break;
    }
  }

  return Array.from(out).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 6. Tek kelimeyi sınıflandır + zenginleştir
// ---------------------------------------------------------------------------
/**
 * Bir kelime kaydı için tüm YDS meta alanlarını üretir.
 * Mevcut dolu örnek cümle korunur; yalnızca yapay/boş cümleler yenilenir.
 */
function classifyWord(word, allWords) {
  const pos = detectPartOfSpeech(word);
  const yds_level = classifyLevel(word);
  const synonyms = findSynonyms(word, allWords);

  const existingEn = String(word.example_en || '').trim();
  const existingTr = String(word.example_tr || '').trim();
  let example_en = existingEn;
  let example_tr = existingTr;

  if (!existingEn || isArtificialExample(existingEn)) {
    const generated = buildYdsExample(word, pos);
    example_en = generated.example_en;
    example_tr = generated.example_tr;
  } else if (!existingTr) {
    // İngilizce örnek var ama Türkçe çeviri yok: POS şablonundan Türkçe üret
    example_tr = buildYdsExample(word, pos).example_tr;
  }

  return { yds_level, part_of_speech: pos, synonyms, example_en, example_tr };
}

module.exports = {
  LEVEL_MIN,
  LEVEL_MAX,
  LEVEL_LABELS,
  normalize,
  meaningTokens,
  detectPartOfSpeech,
  difficultyScore,
  classifyLevel,
  isArtificialExample,
  buildYdsExample,
  findSynonyms,
  classifyWord,
  CURATED_LEVELS
};
