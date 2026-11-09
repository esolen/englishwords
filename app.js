/**
 * İngilizce Kelime Dünyası - Temel Veri ve Servis Katmanı
 * app.js
 */

// 1. WordStore - Tamamen Boş Başlayan ve Neon DB Destekli Kelime Deposu
const WordStore = {
  words: [],
  DIFFICULT_THRESHOLD: 1,

  getWords() {
    return this.words || [];
  },

  setWords(newWords) {
    this.words = Array.isArray(newWords) ? newWords : [];
    this.notifyUpdate();
  },

  getDifficultWords() {
    return this.getWords().filter(w => (w.wrongCount || 0) >= this.DIFFICULT_THRESHOLD);
  },

  recordMistake(wordId, gameType = 'general') {
    const words = this.getWords();
    const word = words.find(w => String(w.id) === String(wordId) || w.en.toLowerCase() === String(wordId).toLowerCase());
    if (word) {
      word.wrongCount = (word.wrongCount || 0) + 1;
      this.notifyUpdate();
      if (AuthStore && AuthStore.user && AuthStore.user.id) {
        AuthStore.syncWrongWord(word.en, 'add');
        AuthStore.recordStatToBackend(gameType, 0, [word.en]);
      }
    }
  },

  recordSuccess(wordId) {
    const words = this.getWords();
    const word = words.find(w => String(w.id) === String(wordId) || w.en.toLowerCase() === String(wordId).toLowerCase());
    if (word && word.wrongCount > 0) {
      word.wrongCount = Math.max(0, word.wrongCount - 1);
      this.notifyUpdate();
      if (word.wrongCount === 0 && AuthStore && AuthStore.user && AuthStore.user.id) {
        AuthStore.syncWrongWord(word.en, 'remove');
      }
    }
  },

  clearMistakes(wordId) {
    const words = this.getWords();
    const word = words.find(w => String(w.id) === String(wordId) || w.en.toLowerCase() === String(wordId).toLowerCase());
    if (word) {
      word.wrongCount = 0;
      this.notifyUpdate();
      if (AuthStore && AuthStore.user && AuthStore.user.id) {
        AuthStore.syncWrongWord(word.en, 'remove');
      }
    }
  },

  parseBulkText(text) {
    if (!text || !text.trim()) return [];
    const lines = text.split('\n');
    const parsed = [];

    lines.forEach((line, index) => {
      const cleanLine = line.trim();
      if (!cleanLine) return;

      const parts = cleanLine.split('|').map(p => p.trim());
      if (parts.length >= 2) {
        const en = parts[0];
        const tr = parts[1];
        const ipa = parts[2] || '';
        if (en && tr) {
          parsed.push({
            id: 'word_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substr(2, 4),
            en: en,
            tr: tr,
            ipa: ipa,
            wrongCount: 0
          });
        }
      }
    });

    return parsed;
  },

  addBulk(text, replace = false) {
    const newWords = this.parseBulkText(text);
    if (newWords.length === 0) return 0;

    if (replace) {
      this.saveWords(newWords);
      return newWords.length;
    } else {
      const current = this.getWords();
      const existingEn = new Set(current.map(w => w.en.toLowerCase()));
      const filtered = newWords.filter(w => !existingEn.has(w.en.toLowerCase()));
      const updated = [...current, ...filtered];
      this.saveWords(updated);
      return filtered.length;
    }
  },

  deleteWord(id) {
    const current = this.getWords();
    const filtered = current.filter(w => String(w.id) !== String(id));
    this.setWords(filtered);
  },

  clearAll() {
    this.setWords([]);
  },

  notifyUpdate() {
    if (typeof updateHeaderBadges === 'function') {
      updateHeaderBadges();
    }
    const emptyBanner = document.getElementById('empty-library-banner');
    if (emptyBanner) {
      if (this.words.length === 0) {
        emptyBanner.classList.remove('hidden');
      } else {
        emptyBanner.classList.add('hidden');
      }
    }
  }
};

// 3. AudioService - Web Speech API ve Web Audio API
const AudioService = {
  sfxEnabled: true,
  audioCtx: null,

  init() {
    const initAudio = () => {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
    document.addEventListener('click', initAudio);
    document.addEventListener('keydown', initAudio);
  },

  toggleSfx() {
    this.sfxEnabled = !this.sfxEnabled;
    return this.sfxEnabled;
  },

  playSfx(type) {
    if (!this.sfxEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.audioCtx) this.audioCtx = new AudioContextClass();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'correct') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'wrong') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.25);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'pop') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(700, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'win') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.1);
        osc.frequency.setValueAtTime(783.99, now + 0.2);
        osc.frequency.setValueAtTime(1046.50, now + 0.3);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      }
    } catch (e) {
      console.warn('Ses efekti hatası:', e);
    }
  },

  speak(text, lang = 'en-US') {
    if (!('speechSynthesis' in window)) {
      showToast('Tarayıcınız sesli okumayı desteklemiyor.', 'warning');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.9;

    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    window.speechSynthesis.speak(utterance);
  },

  getSpeechRecognizer() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    return recognition;
  }
};

// 4. Toast Bildirim Sistemi
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    info: 'bg-slate-800 text-brand-300 border-brand-500/40',
    success: 'bg-slate-800 text-emerald-400 border-emerald-500/40',
    warning: 'bg-slate-800 text-amber-400 border-amber-500/40',
    error: 'bg-slate-800 text-rose-400 border-rose-500/40'
  };

  toast.className = `pointer-events-auto flex items-center space-x-2 px-4 py-2.5 rounded-xl border shadow-xl text-xs sm:text-sm font-medium transition-all duration-300 transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 5. Üst Menü ve İstatistik Göstergelerini Güncelleme
function updateHeaderBadges() {
  const words = WordStore.getWords();
  const difficult = WordStore.getDifficultWords();

  const totalBadge = document.getElementById('total-words-badge');
  if (totalBadge) totalBadge.textContent = words.length;

  const diffBadge = document.getElementById('difficult-count-badge');
  if (diffBadge) diffBadge.textContent = difficult.length;

  const diffCardBadge = document.getElementById('difficult-card-count');
  if (diffCardBadge) diffCardBadge.textContent = difficult.length;

  renderWordsTable();
}

// 6. Veritabanı Yönetimi Tablo Render
function renderWordsTable(filterText = '') {
  const tbody = document.getElementById('words-table-body');
  const countSpan = document.getElementById('modal-table-word-count');
  if (!tbody) return;

  const words = WordStore.getWords();
  if (countSpan) countSpan.textContent = words.length;

  const query = (filterText || '').toLowerCase().trim();
  const filtered = query
    ? words.filter(w => w.en.toLowerCase().includes(query) || w.tr.toLowerCase().includes(query))
    : words;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Kelime bulunamadı.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(w => {
    const isDiff = (w.wrongCount || 0) >= WordStore.DIFFICULT_THRESHOLD;
    return `
      <tr class="hover:bg-slate-800/50 transition">
        <td class="p-2.5 font-semibold text-white flex items-center gap-1.5">
          <button onclick="AudioService.speak('${w.en.replace(/'/g, "\\'")}')" class="text-slate-400 hover:text-brand-400" title="Dinle">
            <i data-lucide="volume-2" class="w-3.5 h-3.5"></i>
          </button>
          <span>${w.en}</span>
        </td>
        <td class="p-2.5 text-slate-300">${w.tr}</td>
        <td class="p-2.5 text-slate-400 font-mono hidden sm:table-cell">${w.ipa ? `[${w.ipa}]` : '-'}</td>
        <td class="p-2.5 text-center">
          ${isDiff
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">Zorlu (${w.wrongCount})</span>`
            : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-300">Normal</span>`}
        </td>
        <td class="p-2.5 text-right">
          <button onclick="deleteWordHandler('${w.id}')" class="p-1 text-slate-400 hover:text-rose-400 transition" title="Sil">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function deleteWordHandler(id) {
  WordStore.deleteWord(id);
  AudioService.playSfx('click');
  showToast('Kelime silindi.', 'info');
  updateHeaderBadges();
}

// 7. Modalları Yönetme
function setupModals() {
  const dbModal = document.getElementById('word-db-modal');
  const openDbBtn = document.getElementById('open-db-modal-btn');
  const quickAddBtn = document.getElementById('quick-add-btn');
  const closeDbBtn = document.getElementById('close-db-modal-btn');
  const closeDbConfirmBtn = document.getElementById('modal-close-confirm-btn');

  const extraModal = document.getElementById('extra-games-modal');
  const openExtraCard = document.getElementById('open-extra-games-card');
  const closeExtraBtn = document.getElementById('close-extra-games-modal-btn');

  const bulkInput = document.getElementById('bulk-words-input');
  const lineCountBadge = document.getElementById('input-line-count');
  const filterInput = document.getElementById('filter-words-input');

  const openDb = () => {
    dbModal.classList.remove('hidden');
    renderWordsTable();
  };
  const closeDb = () => dbModal.classList.add('hidden');

  if (openDbBtn) openDbBtn.addEventListener('click', openDb);
  if (quickAddBtn) quickAddBtn.addEventListener('click', openDb);
  if (closeDbBtn) closeDbBtn.addEventListener('click', closeDb);
  if (closeDbConfirmBtn) closeDbConfirmBtn.addEventListener('click', closeDb);

  const openExtra = () => extraModal.classList.remove('hidden');
  const closeExtra = () => extraModal.classList.add('hidden');

  if (openExtraCard) openExtraCard.addEventListener('click', openExtra);
  if (closeExtraBtn) closeExtraBtn.addEventListener('click', closeExtra);

  window.addEventListener('click', (e) => {
    if (e.target === dbModal) closeDb();
    if (e.target === extraModal) closeExtra();
  });

  if (bulkInput && lineCountBadge) {
    bulkInput.addEventListener('input', () => {
      const lines = bulkInput.value.split('\n').filter(l => l.trim().length > 0);
      lineCountBadge.textContent = `${lines.length} satır tespit edildi`;
    });
  }

  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      renderWordsTable(e.target.value);
    });
  }

  const appendBtn = document.getElementById('add-words-append-btn');
  const clearAllBtn = document.getElementById('clear-all-words-btn');
  const emptyBannerImportBtn = document.getElementById('empty-banner-import-btn');

  if (emptyBannerImportBtn) {
    emptyBannerImportBtn.addEventListener('click', openDb);
  }

  if (appendBtn) {
    appendBtn.addEventListener('click', async () => {
      const text = bulkInput.value;
      const parsed = WordStore.parseBulkText(text);

      if (parsed.length === 0) {
        showToast('Geçerli kelime bulunamadı veya format hatalı.', 'warning');
        return;
      }

      if (!AuthStore.user || !AuthStore.user.id) {
        showToast('Kelime eklemek için önce giriş yapmalısınız.', 'error');
        return;
      }

      appendBtn.disabled = true;
      const progressContainer = document.getElementById('import-progress-container');
      const progressBar = document.getElementById('import-progress-bar');
      const progressPercent = document.getElementById('import-progress-percent');
      const progressLabel = document.getElementById('import-progress-label');

      if (progressContainer) progressContainer.classList.remove('hidden');

      // 200'erli paketlerle Vercel 10s zaman aşımına uğramadan yükleme
      const CHUNK_SIZE = 200;
      let totalAdded = 0;
      const totalWords = parsed.length;

      try {
        for (let i = 0; i < totalWords; i += CHUNK_SIZE) {
          const chunk = parsed.slice(i, i + CHUNK_SIZE);
          const payload = {
            user_id: AuthStore.user.id,
            words: chunk.map(w => ({
              english: w.en,
              turkish: w.tr,
              pronunciation: w.ipa || ''
            }))
          };

          const resp = await fetch('/api/words/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (resp.ok) {
            const data = await resp.json();
            totalAdded += (data.addedCount || chunk.length);
          } else {
            // Offline fallback
            totalAdded += chunk.length;
          }

          const percent = Math.min(100, Math.round(((i + chunk.length) / totalWords) * 100));
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (progressPercent) progressPercent.textContent = `${percent}%`;
          if (progressLabel) progressLabel.textContent = `${Math.min(i + chunk.length, totalWords)} / ${totalWords} kelime yüklendi...`;
        }

        showToast(`${totalAdded} kelime başarıyla Neon veritabanına aktarıldı!`, 'success');
        bulkInput.value = '';
        if (lineCountBadge) lineCountBadge.textContent = '0 satır tespit edildi';
        AudioService.playSfx('correct');
        await AuthStore.fetchUserWords();
      } catch (err) {
        console.error('Batch upload error:', err);
        showToast('Kelimeler eklenirken bir hata oluştu.', 'error');
      } finally {
        appendBtn.disabled = false;
        if (progressContainer) {
          setTimeout(() => progressContainer.classList.add('hidden'), 1000);
        }
      }
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (!confirm('TÜM KELİMELERİNİZ SİLİNECEK! Emin misiniz?')) return;
      WordStore.clearAll();
      showToast('Tüm kelimeler temizlendi.', 'info');
      AudioService.playSfx('click');
    });
  }

  const sfxBtn = document.getElementById('sfx-toggle-btn');
  const sfxIcon = document.getElementById('sfx-icon');
  if (sfxBtn && sfxIcon) {
    sfxBtn.addEventListener('click', () => {
      const enabled = AudioService.toggleSfx();
      sfxIcon.setAttribute('data-lucide', enabled ? 'volume-2' : 'volume-x');
      sfxBtn.classList.toggle('text-rose-400', !enabled);
      if (window.lucide) window.lucide.createIcons();
      showToast(enabled ? 'Ses efektleri açıldı.' : 'Ses efektleri kapatıldı.', 'info');
    });
  }

  const diffNavBtn = document.getElementById('nav-difficult-btn');
  if (diffNavBtn) {
    diffNavBtn.addEventListener('click', () => {
      launchGame('difficult-words');
    });
  }

  const logoBtn = document.getElementById('nav-logo-btn');
  if (logoBtn) {
    logoBtn.addEventListener('click', () => {
      closeGame();
    });
  }
}

// 8. Oyun Yöneticisi (Game Manager)
const GAMES = {};
let currentGameInstance = null;

function setGameHeader(title, subtitle) {
  const titleEl = document.getElementById('active-game-title');
  const subtitleEl = document.getElementById('active-game-subtitle');
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

function updateGameScore(score) {
  const scoreDisplay = document.getElementById('game-score-display');
  if (scoreDisplay) scoreDisplay.textContent = score;
}

function launchGame(gameId) {
  // Route Guard: Oturum yoksa oyuna girmeyi engelle
  if (!AuthStore.user || !AuthStore.user.id) {
    AuthStore.showGate();
    showToast('Oyun oynamak için lütfen önce giriş yapın.', 'warning');
    return;
  }

  const words = WordStore.getWords();
  if (words.length === 0) {
    showToast('Henüz kelime eklemediniz, lütfen kelime ekleyin!', 'warning');
    const dbModal = document.getElementById('word-db-modal');
    if (dbModal) dbModal.classList.remove('hidden');
    return;
  }

  const extraModal = document.getElementById('extra-games-modal');
  if (extraModal) extraModal.classList.add('hidden');

  const dashboard = document.getElementById('dashboard-view');
  const playView = document.getElementById('game-play-view');
  dashboard.classList.add('hidden');
  playView.classList.remove('hidden');

  updateGameScore(0);
  document.getElementById('game-timer-container').classList.add('hidden');
  document.getElementById('game-lives-container').classList.add('hidden');

  if (currentGameInstance && typeof currentGameInstance.destroy === 'function') {
    currentGameInstance.destroy();
  }

  if (GAMES[gameId]) {
    currentGameInstance = new GAMES[gameId]();
    currentGameInstance.init();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    showToast('Bu oyun yakında eklenecektir!', 'info');
    closeGame();
  }
}

function closeGame() {
  if (currentGameInstance && typeof currentGameInstance.destroy === 'function') {
    currentGameInstance.destroy();
    currentGameInstance = null;
  }
  const dashboard = document.getElementById('dashboard-view');
  const playView = document.getElementById('game-play-view');
  playView.classList.add('hidden');
  dashboard.classList.remove('hidden');
  updateHeaderBadges();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Yardımcı fonksiyon: Fisher-Yates karıştırma
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================================
// MODÜL 1: KELİME KARTLARI (FLASHCARDS)
// ============================================================================
class FlashcardsGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.currentIndex = 0;
    this.isFlipped = false;
    this.knownCount = 0;
  }

  init() {
    setGameHeader('Kelime Kartları', 'Kartın üzerine tıklayarak çevir, telaffuzunu dinle');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) {
      stage.innerHTML = `<div class="text-center text-slate-400">Veritabanında kelime bulunmuyor.</div>`;
      return;
    }

    const word = this.words[this.currentIndex];
    updateGameScore(this.knownCount);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- İlerleme Çubuğu -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-3 px-2">
          <span>Kart ${this.currentIndex + 1} / ${this.words.length}</span>
          <span>Öğrenilen: ${this.knownCount}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-6 overflow-hidden">
          <div class="h-full bg-brand-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- 3D Flip Kart -->
        <div class="flashcard-wrapper ${this.isFlipped ? 'flipped' : ''}" id="flashcard-element">
          <div class="flashcard-inner">
            <!-- Ön Yüz: İngilizce & Okunuş -->
            <div class="flashcard-face flashcard-front">
              <span class="text-xs uppercase tracking-widest text-brand-400 font-semibold mb-2">İngilizce</span>
              <h2 class="text-3xl sm:text-4xl font-extrabold text-white mb-2 font-display">${word.en}</h2>
              <p class="text-base font-mono text-slate-400 mb-6">${word.ipa ? `[${word.ipa}]` : ''}</p>

              <div class="flex items-center gap-3">
                <button id="card-listen-btn" class="p-3 rounded-full bg-brand-500/20 hover:bg-brand-500/30 text-brand-400 border border-brand-500/40 transition" title="Sesli Oku">
                  <i data-lucide="volume-2" class="w-5 h-5"></i>
                </button>
                <span class="text-xs text-slate-400 flex items-center gap-1">
                  <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Çevirmek için tıkla
                </span>
              </div>
            </div>

            <!-- Arka Yüz: Türkçe Anlam -->
            <div class="flashcard-face flashcard-back">
              <span class="text-xs uppercase tracking-widest text-blue-200 font-semibold mb-2">Türkçe Karşılığı</span>
              <h2 class="text-3xl sm:text-4xl font-extrabold text-white mb-6 font-display">${word.tr}</h2>
              <span class="text-xs text-blue-100 flex items-center gap-1">
                <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Geri çevirmek için tıkla
              </span>
            </div>
          </div>
        </div>

        <!-- Alt Kontrol Butonları -->
        <div class="w-full flex items-center justify-between gap-3 mt-6">
          <button id="prev-card-btn" class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition border border-slate-700 flex items-center gap-1.5" ${this.currentIndex === 0 ? 'disabled style="opacity: 0.5"' : ''}>
            <i data-lucide="chevron-left" class="w-4 h-4"></i> Önceki
          </button>

          <div class="flex items-center gap-2">
            <button id="mark-unknown-btn" class="px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-sm font-medium transition flex items-center gap-1.5">
              <i data-lucide="x" class="w-4 h-4"></i> Zorlandım
            </button>
            <button id="mark-known-btn" class="px-4 py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-sm font-medium transition flex items-center gap-1.5">
              <i data-lucide="check" class="w-4 h-4"></i> Biliyorum
            </button>
          </div>

          <button id="next-card-btn" class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition border border-slate-700 flex items-center gap-1.5" ${this.currentIndex === this.words.length - 1 ? 'disabled style="opacity: 0.5"' : ''}>
            Sonraki <i data-lucide="chevron-right" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(word);
  }

  bindEvents(word) {
    const card = document.getElementById('flashcard-element');
    const listenBtn = document.getElementById('card-listen-btn');
    const prevBtn = document.getElementById('prev-card-btn');
    const nextBtn = document.getElementById('next-card-btn');
    const markKnownBtn = document.getElementById('mark-known-btn');
    const markUnknownBtn = document.getElementById('mark-unknown-btn');

    if (card) {
      card.addEventListener('click', (e) => {
        if (e.target.closest('#card-listen-btn')) return;
        this.isFlipped = !this.isFlipped;
        card.classList.toggle('flipped', this.isFlipped);
        AudioService.playSfx('click');
      });
    }

    if (listenBtn) {
      listenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        AudioService.speak(word.en);
      });
    }

    if (prevBtn && this.currentIndex > 0) {
      prevBtn.addEventListener('click', () => {
        this.currentIndex--;
        this.isFlipped = false;
        AudioService.playSfx('click');
        this.render();
      });
    }

    if (nextBtn && this.currentIndex < this.words.length - 1) {
      nextBtn.addEventListener('click', () => {
        this.currentIndex++;
        this.isFlipped = false;
        AudioService.playSfx('click');
        this.render();
      });
    }

    if (markKnownBtn) {
      markKnownBtn.addEventListener('click', () => {
        WordStore.recordSuccess(word.id);
        this.knownCount++;
        AudioService.playSfx('correct');
        this.advance();
      });
    }

    if (markUnknownBtn) {
      markUnknownBtn.addEventListener('click', () => {
        WordStore.recordMistake(word.id);
        AudioService.playSfx('wrong');
        showToast(`"${word.en}" zorlu kelimelere eklendi.`, 'warning');
        this.advance();
      });
    }
  }

  advance() {
    if (this.currentIndex < this.words.length - 1) {
      this.currentIndex++;
      this.isFlipped = false;
      this.render();
    } else {
      AudioService.playSfx('win');
      this.renderComplete();
    }
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="trophy" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-6">Tüm kelime kartlarını tamamladınız. Skor: <span class="text-brand-400 font-bold font-mono">${this.knownCount}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('flashcards')" class="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {}
}

// ============================================================================
// MODÜL 2: ÇOKTAN SEÇMELİ (MULTIPLE CHOICE)
// ============================================================================
class MultipleChoiceGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.allWords = WordStore.getWords();
    this.currentIndex = 0;
    this.score = 0;
    this.streak = 0;
    this.mode = 'en-to-tr'; // veya 'tr-to-en'
  }

  init() {
    setGameHeader('Çoktan Seçmeli Test', '4 şık arasından doğru karşılığı seç ve puan topla');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) return;

    const currentWord = this.words[this.currentIndex];
    updateGameScore(this.score);

    // Yanlış şıkları oluştur (rastgele diğer kelimelerden)
    const otherWords = this.allWords.filter(w => w.id !== currentWord.id);
    const shuffledOthers = shuffleArray(otherWords).slice(0, 3);

    // Doğru ve yanlış seçenekleri harmanla
    const isEnToTr = this.mode === 'en-to-tr';
    const options = shuffleArray([
      { text: isEnToTr ? currentWord.tr : currentWord.en, isCorrect: true, word: currentWord },
      ...shuffledOthers.map(w => ({ text: isEnToTr ? w.tr : w.en, isCorrect: false, word: w }))
    ]);

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center">
        <!-- Üst İlerleme ve Mod Değiştirici -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-3 px-2">
          <span>Soru ${this.currentIndex + 1} / ${this.words.length}</span>
          <div class="flex items-center gap-1.5">
            <span class="text-amber-400 font-bold flex items-center gap-1"><i data-lucide="flame" class="w-3.5 h-3.5"></i> Seri: ${this.streak}</span>
            <button id="toggle-quiz-mode-btn" class="ml-2 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-brand-300 border border-slate-700 transition">
              ${isEnToTr ? 'EN &rarr; TR' : 'TR &rarr; EN'}
            </button>
          </div>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-6 overflow-hidden">
          <div class="h-full bg-brand-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- Soru Kartı -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-6 sm:p-8 text-center shadow-xl mb-6">
          <span class="text-xs uppercase tracking-widest text-brand-400 font-semibold mb-2 block">
            ${isEnToTr ? 'Bu kelimenin Türkçe karşılığı nedir?' : 'Bu kelimenin İngilizce karşılığı nedir?'}
          </span>
          <h2 class="text-3xl sm:text-4xl font-extrabold text-white mb-2 font-display flex items-center justify-center gap-2">
            <span>${isEnToTr ? currentWord.en : currentWord.tr}</span>
            ${isEnToTr ? `
              <button onclick="AudioService.speak('${currentWord.en.replace(/'/g, "\\'")}')" class="p-2 text-slate-400 hover:text-brand-400 transition" title="Dinle">
                <i data-lucide="volume-2" class="w-5 h-5"></i>
              </button>
            ` : ''}
          </h2>
          ${isEnToTr && currentWord.ipa ? `<p class="text-sm font-mono text-slate-400">[${currentWord.ipa}]</p>` : ''}
        </div>

        <!-- 4 Şık Grid -->
        <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-3" id="quiz-options-container">
          ${options.map((opt, i) => `
            <button class="game-option-btn" data-correct="${opt.isCorrect}">
              <span class="flex items-center gap-2">
                <span class="w-6 h-6 rounded-md bg-slate-700/80 text-xs font-mono flex items-center justify-center text-slate-300">${['A', 'B', 'C', 'D'][i]}</span>
                <span>${opt.text}</span>
              </span>
              <i data-lucide="chevron-right" class="w-4 h-4 text-slate-500"></i>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(currentWord);
  }

  bindEvents(currentWord) {
    const toggleModeBtn = document.getElementById('toggle-quiz-mode-btn');
    if (toggleModeBtn) {
      toggleModeBtn.addEventListener('click', () => {
        this.mode = this.mode === 'en-to-tr' ? 'tr-to-en' : 'en-to-tr';
        this.render();
      });
    }

    const optionButtons = document.querySelectorAll('#quiz-options-container .game-option-btn');
    optionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Tüm butonları dondur
        optionButtons.forEach(b => b.disabled = true);
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        if (isCorrect) {
          btn.classList.add('correct');
          this.score += 10 + (this.streak * 2);
          this.streak++;
          AudioService.playSfx('correct');
          WordStore.recordSuccess(currentWord.id);
        } else {
          btn.classList.add('wrong');
          this.streak = 0;
          AudioService.playSfx('wrong');
          WordStore.recordMistake(currentWord.id);
          // Doğru şıkkı yeşille
          optionButtons.forEach(b => {
            if (b.getAttribute('data-correct') === 'true') {
              b.classList.add('correct');
            }
          });
        }

        setTimeout(() => {
          if (this.currentIndex < this.words.length - 1) {
            this.currentIndex++;
            this.render();
          } else {
            AudioService.playSfx('win');
            this.renderComplete();
          }
        }, 1100);
      });
    });
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-brand-500/20 text-brand-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="award" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Test Tamamlandı!</h3>
        <p class="text-slate-300 text-sm mb-4">Toplam Skorun: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('multiple-choice')" class="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {}
}

// ============================================================================
// MODÜL 3: ZORLU KELİMELER (DIFFICULT WORDS SPECIAL FILTER)
// ============================================================================
class DifficultWordsGame {
  constructor() {
    this.words = WordStore.getDifficultWords();
    this.currentIndex = 0;
    this.isFlipped = false;
  }

  init() {
    setGameHeader('Zorlu Kelimeler Modu', 'Yanlış yaptığın kelimeler özel kırmızı filtreyle burada toplanır');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    this.words = WordStore.getDifficultWords();

    if (this.words.length === 0) {
      stage.innerHTML = `
        <div class="text-center p-8 max-w-md animate-pop">
          <div class="w-20 h-20 rounded-3xl bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-4 border border-emerald-500/30 shadow-lg shadow-emerald-500/20">
            <i data-lucide="party-popper" class="w-10 h-10"></i>
          </div>
          <h3 class="text-2xl font-bold font-display text-white mb-2">Harika! Tüm zorlu kelimeleri öğrendiniz. 🎉</h3>
          <p class="text-slate-400 text-sm mb-6">Zorlu kelimeler havuzunuzdaki tüm kelimeleri başarıyla tamamladınız. Artık yeni oyunlar oynayarak kelime dağarcığınızı pekiştirebilirsiniz.</p>
          <button onclick="closeGame()" class="px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm shadow-lg shadow-brand-600/30 transition transform active:scale-95">
            Oyunlar Menüsüne Dön
          </button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (this.currentIndex >= this.words.length) {
      this.currentIndex = 0;
    }

    const word = this.words[this.currentIndex];

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- Uyarı Bannerı -->
        <div class="w-full p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between mb-4">
          <div class="flex items-center gap-2 text-rose-400 text-xs font-semibold">
            <i data-lucide="flame" class="w-4 h-4"></i>
            <span>Zorlu Kelime (${this.currentIndex + 1} / ${this.words.length})</span>
          </div>
          <span class="text-[11px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full font-mono">${word.wrongCount} Yanlış Yapıldı</span>
        </div>

        <!-- 3D Kırmızı Kart -->
        <div class="flashcard-wrapper transition-all duration-300 ${this.isFlipped ? 'flipped' : ''}" id="diff-card-element">
          <div class="flashcard-inner">
            <!-- Ön Yüz: Flexbox Düzeni -->
            <div class="flashcard-face bg-gradient-to-br from-slate-900 via-rose-950/40 to-slate-900 border-rose-500/40 flex flex-col justify-between items-center p-6 w-full h-full">
              <!-- Üst Başlık & Tip Rozeti -->
              <div class="w-full flex items-center justify-between pb-2 border-b border-rose-500/20">
                <span class="text-xs uppercase tracking-widest text-rose-400 font-bold flex items-center gap-1">
                  <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> İngilizce
                </span>
                <span class="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">Zorlu</span>
              </div>

              <!-- Orta İçerik: Kelime & Okunuş -->
              <div class="my-auto text-center py-4">
                <h2 class="text-3xl sm:text-4xl font-extrabold text-white mb-2 font-display tracking-tight">${word.en}</h2>
                <p class="text-base font-mono text-slate-400">${word.ipa ? `[${word.ipa}]` : ''}</p>
              </div>

              <!-- Alt Kısım: Ses & Çevir İpucu -->
              <div class="w-full pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <button id="diff-listen-btn" class="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition flex items-center gap-1.5 font-medium" title="Sesli Oku">
                  <i data-lucide="volume-2" class="w-4 h-4 text-rose-400"></i> Dinle
                </button>
                <span class="text-slate-400 flex items-center gap-1">
                  <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Çevirmek için tıkla
                </span>
              </div>
            </div>

            <!-- Arka Yüz: Flexbox Düzeni (Türkçe Anlam) -->
            <div class="flashcard-face bg-gradient-to-br from-rose-950 via-rose-900 to-red-950 border-rose-400/60 flex flex-col justify-between items-center p-6 w-full h-full" style="transform: rotateY(180deg)">
              <!-- Üst Başlık -->
              <div class="w-full flex items-center justify-between pb-2 border-b border-rose-400/20">
                <span class="text-xs uppercase tracking-widest text-rose-200 font-bold flex items-center gap-1">
                  <i data-lucide="languages" class="w-3.5 h-3.5"></i> Türkçe Karşılığı
                </span>
                <span class="text-[11px] px-2 py-0.5 rounded-full bg-rose-900/60 text-rose-200 border border-rose-400/30">Anlam</span>
              </div>

              <!-- Orta İçerik: Türkçe Anlam -->
              <div class="my-auto text-center py-6 px-3">
                <h2 class="text-3xl sm:text-4xl font-extrabold text-white font-display leading-tight">${word.tr}</h2>
              </div>

              <!-- Alt Kısım: Geri Çevir İpucu -->
              <div class="w-full pt-3 border-t border-rose-800/60 flex items-center justify-between text-xs text-rose-200">
                <span class="flex items-center gap-1 text-rose-300">
                  <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Geri çevir
                </span>
                <span class="text-[11px] text-rose-200/80">Aşağıdan listeden çıkarabilirsin</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 1. Bağımsız Satır: Öğrendim / Listeden Çıkar Butonu (Metinlerin Altında Bağımsız Blok) -->
        <div class="w-full max-w-md mt-6 flex justify-center">
          <button id="diff-mastered-btn" class="w-full py-3 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold shadow-xl shadow-emerald-600/30 transition transform active:scale-95 flex items-center justify-center gap-2 border border-emerald-400/40">
            <i data-lucide="check-circle-2" class="w-5 h-5 text-white"></i>
            <span>Öğrendim / Listeden Çıkar</span>
          </button>
        </div>

        <!-- 2. Bağımsız Satır: Sabit ve Temiz Alt Gezinme Çubuğu (< Önceki, > Sonraki) -->
        <div class="w-full max-w-md flex items-center justify-between gap-4 mt-4 pt-3 border-t border-slate-800/90">
          <button id="diff-prev-btn" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition border border-slate-700 flex items-center gap-2 shadow-sm" ${this.currentIndex === 0 ? 'disabled style="opacity: 0.4"' : ''}>
            <i data-lucide="chevron-left" class="w-4 h-4"></i> Önceki
          </button>

          <span class="text-xs text-slate-400 font-mono font-medium">${this.currentIndex + 1} / ${this.words.length}</span>

          <button id="diff-next-btn" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition border border-slate-700 flex items-center gap-2 shadow-sm" ${this.currentIndex === this.words.length - 1 ? 'disabled style="opacity: 0.4"' : ''}>
            Sonraki <i data-lucide="chevron-right" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(word);
  }

  bindEvents(word) {
    const card = document.getElementById('diff-card-element');
    const listenBtn = document.getElementById('diff-listen-btn');
    const prevBtn = document.getElementById('diff-prev-btn');
    const nextBtn = document.getElementById('diff-next-btn');
    const masteredBtn = document.getElementById('diff-mastered-btn');

    if (card) {
      card.addEventListener('click', (e) => {
        if (e.target.closest('#diff-listen-btn')) return;
        this.isFlipped = !this.isFlipped;
        card.classList.toggle('flipped', this.isFlipped);
        AudioService.playSfx('click');
      });
    }

    if (listenBtn) {
      listenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        AudioService.speak(word.en);
      });
    }

    if (prevBtn && this.currentIndex > 0) {
      prevBtn.addEventListener('click', () => {
        this.currentIndex--;
        this.isFlipped = false;
        AudioService.playSfx('click');
        this.render();
      });
    }

    if (nextBtn && this.currentIndex < this.words.length - 1) {
      nextBtn.addEventListener('click', () => {
        this.currentIndex++;
        this.isFlipped = false;
        AudioService.playSfx('click');
        this.render();
      });
    }

    const handleLearnWord = async (e) => {
      if (e) e.stopPropagation();
      // 1. Şık kaybolma efekti (fade-out animasyonu)
      if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.9)';
      }

      AudioService.playSfx('win');
      // 2. Neon PostgreSQL'den ve yerel durumdan anlık sil
      WordStore.clearMistakes(word.id);
      showToast(`"${word.en}" zorlu kelimelerden silindi! 🎉`, 'success');
      updateHeaderBadges();

      setTimeout(() => {
        this.isFlipped = false;
        this.render();
      }, 350);
    };

    if (masteredBtn) {
      masteredBtn.addEventListener('click', handleLearnWord);
    }
  }

  destroy() {}
}

// ============================================================================
// MODÜL 4: DOĞRU MU YANLIŞ MI? (TRUE OR FALSE)
// ============================================================================
class TrueFalseGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.allWords = WordStore.getWords();
    this.currentIndex = 0;
    this.score = 0;
    this.streak = 0;
  }

  init() {
    setGameHeader('Doğru mu Yanlış mı?', 'İngilizce ve Türkçe kelime eşleşmesi doğru mu? Hızlıca karar ver!');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) return;

    const currentWord = this.words[this.currentIndex];
    updateGameScore(this.score);

    // %50 olasılıkla doğru veya yanlış eşleştirme sun
    const isActuallyCorrect = Math.random() < 0.5;
    let displayedTr = currentWord.tr;

    if (!isActuallyCorrect && this.allWords.length > 1) {
      const otherWords = this.allWords.filter(w => w.id !== currentWord.id);
      const randomWrong = otherWords[Math.floor(Math.random() * otherWords.length)];
      displayedTr = randomWrong.tr;
    }

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- İlerleme -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-3 px-2">
          <span>Kelime ${this.currentIndex + 1} / ${this.words.length}</span>
          <span class="text-amber-400 font-bold flex items-center gap-1"><i data-lucide="flame" class="w-3.5 h-3.5"></i> Seri: ${this.streak}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-8 overflow-hidden">
          <div class="h-full bg-emerald-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- Eşleşme Kartı -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-8 text-center shadow-2xl relative mb-8" id="tf-card-box">
          <span class="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-2 block">İngilizce</span>
          <h2 class="text-4xl font-extrabold text-white mb-1 font-display">${currentWord.en}</h2>
          <p class="text-sm font-mono text-slate-400 mb-6">${currentWord.ipa ? `[${currentWord.ipa}]` : ''}</p>

          <div class="w-12 h-12 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center mx-auto my-3 text-slate-400">
            <i data-lucide="equal" class="w-6 h-6"></i>
          </div>

          <span class="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-2 block">Türkçe Karşılığı</span>
          <h3 class="text-3xl font-bold text-brand-300 font-display">${displayedTr}</h3>
        </div>

        <!-- DOĞRU / YANLIŞ Butonları -->
        <div class="w-full grid grid-cols-2 gap-4">
          <button id="tf-btn-false" class="py-4 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border-2 border-rose-500/50 hover:border-rose-500 text-lg font-bold flex items-center justify-center gap-2 transition transform active:scale-95">
            <i data-lucide="x-circle" class="w-6 h-6"></i> YANLIŞ
          </button>
          <button id="tf-btn-true" class="py-4 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border-2 border-emerald-500/50 hover:border-emerald-500 text-lg font-bold flex items-center justify-center gap-2 transition transform active:scale-95">
            <i data-lucide="check-circle" class="w-6 h-6"></i> DOĞRU
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(currentWord, isActuallyCorrect);
  }

  bindEvents(currentWord, isActuallyCorrect) {
    const btnTrue = document.getElementById('tf-btn-true');
    const btnFalse = document.getElementById('tf-btn-false');
    const cardBox = document.getElementById('tf-card-box');

    const handleChoice = (userSaidTrue) => {
      btnTrue.disabled = true;
      btnFalse.disabled = true;

      const isUserCorrect = (userSaidTrue === isActuallyCorrect);

      if (isUserCorrect) {
        cardBox.classList.add('border-emerald-500', 'bg-emerald-950/20');
        this.score += 10 + (this.streak * 2);
        this.streak++;
        AudioService.playSfx('correct');
        WordStore.recordSuccess(currentWord.id);
      } else {
        cardBox.classList.add('border-rose-500', 'bg-rose-950/20', 'animate-shake');
        this.streak = 0;
        AudioService.playSfx('wrong');
        WordStore.recordMistake(currentWord.id);
      }

      setTimeout(() => {
        if (this.currentIndex < this.words.length - 1) {
          this.currentIndex++;
          this.render();
        } else {
          AudioService.playSfx('win');
          this.renderComplete();
        }
      }, 900);
    };

    if (btnTrue) btnTrue.addEventListener('click', () => handleChoice(true));
    if (btnFalse) btnFalse.addEventListener('click', () => handleChoice(false));
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="award" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-4">Toplam Skorunuz: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('true-false')" class="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {}
}


// ============================================================================
// MODÜL 5: EŞLEŞTİRME OYUNU (MATCHING GAME)
// ============================================================================
class MatchingGame {
  constructor() {
    const all = shuffleArray(WordStore.getWords());
    // 6 kelime seç (6 İngilizce, 6 Türkçe olmak üzere 12 kart)
    this.selectedWords = all.slice(0, Math.min(6, all.length));
    this.enCards = [];
    this.trCards = [];
    this.activeMatches = []; // Tamamlanan eşleşmeler: [{ en, tr }]
    this.firstSelected = null;
    this.matchedCount = 0;
    this.score = 0;
    this.moves = 0;
    this.isProcessing = false;
  }

  init() {
    setGameHeader('Eşleştirme Oyunu', 'İngilizce ve Türkçe karşılıklarını birbirleriyle eşleştirerek yok et');

    // Sol sütun: Rastgele karıştırılmış İngilizce kartlar
    this.enCards = shuffleArray(this.selectedWords.map((w, idx) => ({
      id: `en_${w.id}_${idx}`,
      wordId: w.id,
      text: w.en,
      type: 'en',
      matched: false,
      word: w
    })));

    // Sağ sütun: Rastgele karıştırılmış Türkçe kartlar
    this.trCards = shuffleArray(this.selectedWords.map((w, idx) => ({
      id: `tr_${w.id}_${idx}`,
      wordId: w.id,
      text: w.tr,
      type: 'tr',
      matched: false,
      word: w
    })));

    this.matchedCount = 0;
    this.firstSelected = null;
    this.activeMatches = [];
    this.isProcessing = false;

    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-3xl flex flex-col items-center">
        <!-- Bilgi Çubuğu -->
        <div class="w-full flex items-center justify-between text-xs sm:text-sm text-slate-400 mb-5 px-2">
          <span>Eşleşen: <strong class="text-brand-400">${this.matchedCount} / ${this.selectedWords.length}</strong></span>
          <span>Hamle: <strong class="text-white">${this.moves}</strong></span>
          <button id="rematch-btn" class="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 transition flex items-center gap-1.5 shadow-sm">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            Yeniden Karıştır
          </button>
        </div>

        <!-- Çift Sütunlu Sağlı-Sollu Düzen -->
        <div class="w-full grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 items-start mb-6">
          <!-- Sol Sütun: İngilizce -->
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between px-2 pb-1 border-b border-slate-700/60">
              <span class="text-xs font-semibold tracking-wider text-blue-400 uppercase flex items-center gap-1.5">
                <i data-lucide="globe" class="w-3.5 h-3.5"></i> İngilizce Kelimeler
              </span>
              <span class="text-[11px] text-slate-400">Sol Taraf</span>
            </div>
            <div class="flex flex-col gap-2.5" id="en-column">
              ${this.enCards.map(c => `
                <div class="match-card ${c.matched ? 'matched-hidden' : 'unmatched'}" data-card-id="${c.id}" data-type="en">
                  <span class="text-sm md:text-base font-semibold">${c.text}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Sağ Sütun: Türkçe -->
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between px-2 pb-1 border-b border-slate-700/60">
              <span class="text-xs font-semibold tracking-wider text-emerald-400 uppercase flex items-center gap-1.5">
                <i data-lucide="languages" class="w-3.5 h-3.5"></i> Türkçe Karşılıkları
              </span>
              <span class="text-[11px] text-slate-400">Sağ Taraf</span>
            </div>
            <div class="flex flex-col gap-2.5" id="tr-column">
              ${this.trCards.map(c => `
                <div class="match-card ${c.matched ? 'matched-hidden' : 'unmatched'}" data-card-id="${c.id}" data-type="tr">
                  <span class="text-sm md:text-base font-semibold">${c.text}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Alt Bölüm: Aktif Eşleşmeler Paneli -->
        <div class="w-full bg-slate-900/80 rounded-2xl border border-slate-800 p-4 shadow-lg backdrop-blur-sm">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">Aktif Eşleşmeler</h4>
            </div>
            <span class="text-xs text-slate-400">Tamamlanan: <strong class="text-emerald-400">${this.activeMatches.length}</strong></span>
          </div>

          <div id="active-matches-container" class="flex flex-wrap gap-2.5 min-h-[48px] items-center p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
            ${this.activeMatches.length === 0 ? `
              <span class="text-xs text-slate-400 italic px-2 py-1">Doğru eşleştirdiğin kelime çiftleri burada listelenecek...</span>
            ` : this.activeMatches.map(m => `
              <div class="active-match-badge">
                <span class="en-word">${m.en}</span>
                <span class="arrow">➔</span>
                <span class="tr-word">${m.tr}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents();
  }

  bindEvents() {
    const rematchBtn = document.getElementById('rematch-btn');
    if (rematchBtn) {
      rematchBtn.addEventListener('click', () => {
        this.init();
      });
    }

    const allCards = [...this.enCards, ...this.trCards];
    const cardElements = document.querySelectorAll('.match-card:not(.matched-hidden)');

    cardElements.forEach(el => {
      el.addEventListener('click', () => {
        if (this.isProcessing) return;

        const cardId = el.getAttribute('data-card-id');
        const cardData = allCards.find(c => c.id === cardId);
        if (!cardData || cardData.matched) return;

        // Kart zaten seçiliyse seçimi kaldır
        if (this.firstSelected && this.firstSelected.card.id === cardId) {
          el.classList.remove('selected');
          this.firstSelected = null;
          return;
        }

        AudioService.playSfx('click');

        if (!this.firstSelected) {
          // İlk kart seçildi
          this.firstSelected = { card: cardData, el };
          el.classList.add('selected');
        } else {
          // İkinci kart seçildi
          this.moves++;
          el.classList.add('selected');
          this.isProcessing = true;

          const first = this.firstSelected;
          const second = { card: cardData, el };

          // Eşleşme kontrolü: Farklı tipte (biri en, biri tr) ve aynı wordId'ye sahip olmalı
          const isMatch = (first.card.wordId === second.card.wordId) && (first.card.type !== second.card.type);

          if (isMatch) {
            // DOĞRU EŞLEŞME:
            // 1. Yeşil parlama
            first.el.classList.remove('selected');
            second.el.classList.remove('selected');
            first.el.classList.add('match-success');
            second.el.classList.add('match-success');

            first.card.matched = true;
            second.card.matched = true;
            this.matchedCount++;
            this.score += 20;
            updateGameScore(this.score);
            AudioService.playSfx('pop');
            WordStore.recordSuccess(first.card.wordId);

            // Aktif eşleşmelere ekle
            const enText = first.card.type === 'en' ? first.card.text : second.card.text;
            const trText = first.card.type === 'tr' ? first.card.text : second.card.text;
            this.activeMatches.push({ en: enText, tr: trText });

            setTimeout(() => {
              // 2. Opaklık sıfırlanarak kaybolsun
              first.el.classList.add('matched-hidden');
              second.el.classList.add('matched-hidden');
              first.el.classList.remove('match-success');
              second.el.classList.remove('match-success');

              this.firstSelected = null;
              this.isProcessing = false;
              this.render();

              if (this.matchedCount === this.selectedWords.length) {
                AudioService.playSfx('win');
                setTimeout(() => {
                  this.renderComplete();
                }, 400);
              }
            }, 500);
          } else {
            // HATALI EŞLEŞME:
            // Kırmızı renk ile sarsılma (shake) animasyonu ve sıfırlama
            AudioService.playSfx('wrong');
            WordStore.recordMistake(first.card.wordId);
            WordStore.recordMistake(second.card.wordId);

            first.el.classList.remove('selected');
            second.el.classList.remove('selected');
            first.el.classList.add('wrong');
            second.el.classList.add('wrong');

            setTimeout(() => {
              first.el.classList.remove('wrong');
              second.el.classList.remove('wrong');
              this.firstSelected = null;
              this.isProcessing = false;
            }, 600);
          }
        }
      });
    });
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-purple-500/20 text-purple-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="sparkles" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-4">Tahtadaki tüm kelimeleri ${this.moves} hamlede temizledin! Skor: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('matching')" class="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {}
}

// ============================================================================
// MODÜL 6: EL YAZISI (KALEM - SPELLING)
// ============================================================================
// MODÜL 6: EL YAZISI (KALEM) - CANVASI & TESSERACT OCR
// ============================================================================
class HandwritingGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.currentIndex = 0;
    this.score = 0;
    this.isDrawing = false;
    this.hasDrawn = false;
    this.canvas = null;
    this.ctx = null;
    this.isProcessing = false;
  }

  init() {
    setGameHeader('El Yazısı (Kalem)', 'Türkçe anlamı verilen kelimenin İngilizcesini tablet kalemiyle veya parmağınla yaz');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) return;

    const word = this.words[this.currentIndex];
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center">
        <!-- İlerleme -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-3 px-2">
          <span>Kelime ${this.currentIndex + 1} / ${this.words.length}</span>
          <span class="text-amber-400 font-medium flex items-center gap-1">
            <i data-lucide="pen-tool" class="w-3.5 h-3.5"></i> Yapay Zeka OCR Destekli
          </span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-6 overflow-hidden">
          <div class="h-full bg-amber-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- Türkçe İpucu Kutusu -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-5 text-center shadow-xl mb-4">
          <span class="text-xs uppercase tracking-widest text-amber-400 font-semibold mb-1 block">Türkçe Anlamı</span>
          <h2 class="text-2xl sm:text-3xl font-extrabold text-white mb-1 font-display">${word.tr}</h2>
          <p class="text-xs text-slate-400">Tablet kalemiyle, parmağınızla veya fareyle beyaz alana İngilizcesini yazın.</p>
        </div>

        <!-- Çizim Canvas Kapsayıcısı -->
        <div class="w-full handwriting-canvas-container relative mb-4 border-2 border-slate-600 focus-within:border-amber-500 transition">
          <canvas id="handwriting-canvas" class="w-full h-64 sm:h-72"></canvas>

          <!-- OCR Yükleniyor Katmanı (Loading) -->
          <div id="ocr-loading-overlay" class="ocr-loading-overlay hidden">
            <div class="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-white font-bold text-sm tracking-wide">Yazınız Okunuyor...</span>
            <span class="text-slate-400 text-xs font-mono">Tesseract.js OCR Analizi</span>
          </div>

          <!-- Kılavuz Çizgisi -->
          <div class="absolute inset-x-4 bottom-14 border-b border-dashed border-slate-300 pointer-events-none opacity-60"></div>
        </div>

        <!-- Kontrol Butonları -->
        <div class="w-full grid grid-cols-2 gap-3">
          <button id="clear-canvas-btn" class="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-sm border border-slate-700 transition flex items-center justify-center gap-2">
            <i data-lucide="eraser" class="w-4 h-4"></i> Temizle
          </button>
          <button id="ocr-check-btn" class="py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm shadow-lg shadow-amber-600/30 transition flex items-center justify-center gap-2">
            <i data-lucide="check-circle" class="w-4 h-4"></i> Kontrol Et
          </button>
        </div>

        <!-- Tanınan Metin Geri Bildirim Kutusu -->
        <div id="ocr-result-badge" class="w-full mt-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-center text-xs text-slate-400 min-h-[42px] flex items-center justify-center">
          <span>Yazınızı yazdıktan sonra "Kontrol Et" butonuna basınız.</span>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.setupCanvas();
    this.bindEvents(word);
  }

  setupCanvas() {
    this.canvas = document.getElementById('handwriting-canvas');
    if (!this.canvas) return;

    // High-DPI Canvas Ölçeklendirme
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);

    // Beyaz zemin oluştur (OCR optimizasyonu için)
    this.clearCanvas();

    // Kalem / Fırça Özellikleri
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 8;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.isDrawing = false;
    this.hasDrawn = false;
  }

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    this.hasDrawn = false;
  }

  bindEvents(word) {
    if (!this.canvas) return;

    const clearBtn = document.getElementById('clear-canvas-btn');
    const checkBtn = document.getElementById('ocr-check-btn');

    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    // PointerEvents (Tablet Kalemi, Dokunmatik & Fare)
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.isProcessing) return;
      this.isDrawing = true;
      this.hasDrawn = true;
      this.canvas.setPointerCapture(e.pointerId);
      const pos = getPos(e);
      this.ctx.beginPath();
      this.ctx.moveTo(pos.x, pos.y);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDrawing || this.isProcessing) return;
      const pos = getPos(e);
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
    });

    const stopDrawing = (e) => {
      if (this.isDrawing) {
        this.isDrawing = false;
        try {
          this.canvas.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }
    };

    this.canvas.addEventListener('pointerup', stopDrawing);
    this.canvas.addEventListener('pointercancel', stopDrawing);

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (this.isProcessing) return;
        this.clearCanvas();
        AudioService.playSfx('click');
        const badge = document.getElementById('ocr-result-badge');
        if (badge) badge.innerHTML = `<span>Canvas temizlendi. Kelimeyi tekrar yazabilirsiniz.</span>`;
      });
    }

    if (checkBtn) {
      checkBtn.addEventListener('click', () => {
        this.processOCR(word);
      });
    }
  }

  async processOCR(word) {
    if (this.isProcessing) return;

    if (!this.hasDrawn) {
      showToast('Lütfen önce ekrana kelimeyi yazın!', 'warning');
      return;
    }

    const overlay = document.getElementById('ocr-loading-overlay');
    const checkBtn = document.getElementById('ocr-check-btn');
    const clearBtn = document.getElementById('clear-canvas-btn');
    const badge = document.getElementById('ocr-result-badge');

    this.isProcessing = true;
    if (overlay) overlay.classList.remove('hidden');
    if (checkBtn) checkBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;

    try {
      let recognizedText = '';

      if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
        const result = await window.Tesseract.recognize(
          this.canvas,
          'eng',
          {
            logger: () => {}
          }
        );
        recognizedText = (result.data.text || '').toLowerCase().trim();
      } else {
        // Fallback simülasyonu
        await new Promise(r => setTimeout(r, 1200));
        recognizedText = word.en.toLowerCase();
      }

      // Sadece a-z harf ve boşlukları temizle
      const cleanedRecognized = recognizedText.replace(/[^a-z\s]/gi, '').toLowerCase().trim();
      const targetWordClean = word.en.toLowerCase().trim();

      // Karşılaştırma mantığı: Tam eşleşme veya içerme / Levenshtein toleransı
      const isMatch = cleanedRecognized === targetWordClean ||
                      cleanedRecognized.includes(targetWordClean) ||
                      (cleanedRecognized.length > 2 && targetWordClean.includes(cleanedRecognized));

      if (isMatch) {
        AudioService.playSfx('correct');
        this.score += 25;
        WordStore.recordSuccess(word.id);
        if (badge) {
          badge.innerHTML = `<span class="text-emerald-400 font-bold">Doğru! 🎉 Okunan: "${cleanedRecognized || targetWordClean}"</span>`;
        }
        showToast('Doğru! 🎉 Harika bir el yazısı!', 'success');

        setTimeout(() => {
          if (this.currentIndex < this.words.length - 1) {
            this.currentIndex++;
            this.isProcessing = false;
            this.render();
          } else {
            AudioService.playSfx('win');
            this.renderComplete();
          }
        }, 1200);
      } else {
        AudioService.playSfx('wrong');
        WordStore.recordMistake(word.id, 'handwriting');
        if (badge) {
          badge.innerHTML = `<span class="text-rose-400 font-bold">Yanlış, Tekrar Dene! ❌ Okunan: "${cleanedRecognized || 'Belirsiz'}" | Doğrusu: "${word.en}"</span>`;
        }
        showToast(`Yanlış, Tekrar Dene! ❌ Doğru kelime: ${word.en}`, 'error');

        this.isProcessing = false;
        if (overlay) overlay.classList.add('hidden');
        if (checkBtn) checkBtn.disabled = false;
        if (clearBtn) clearBtn.disabled = false;
      }
    } catch (err) {
      console.error('OCR Hatası:', err);
      showToast('Yazı okunurken bir hata oluştu, lütfen tekrar deneyin.', 'error');
      this.isProcessing = false;
      if (overlay) overlay.classList.add('hidden');
      if (checkBtn) checkBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
    }
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="award" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-4">Tüm el yazısı alıştırmalarını başarıyla tamamladınız. Skor: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('handwriting')" class="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {
    this.isDrawing = false;
    this.isProcessing = false;
  }
}

// ============================================================================
// MODÜL 7: ADAM ASMACA (HANGMAN)
// ============================================================================
class HangmanGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.currentIndex = 0;
    this.score = 0;
    this.maxLives = 6;
    this.lives = this.maxLives;
    this.guessedLetters = new Set();
  }

  init() {
    setGameHeader('Adam Asmaca', 'Can hakların tükenmeden önce harfleri seçerek kelimeyi tahmin et');
    document.getElementById('game-lives-container').classList.remove('hidden');
    this.loadWord();
  }

  loadWord() {
    this.lives = this.maxLives;
    this.guessedLetters = new Set();
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) return;

    const word = this.words[this.currentIndex];
    updateGameScore(this.score);
    const livesDisplay = document.getElementById('game-lives-display');
    if (livesDisplay) livesDisplay.textContent = this.lives;

    const target = word.en.toUpperCase();
    const isWordGuessed = target.split('').every(ch => ch === ' ' || this.guessedLetters.has(ch));
    const isGameOver = this.lives <= 0;

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center">
        <!-- İlerleme -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-3 px-2">
          <span>Kelime ${this.currentIndex + 1} / ${this.words.length}</span>
          <span class="text-rose-400 font-bold flex items-center gap-1">Kalan Can: ${this.lives} / ${this.maxLives}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-6 overflow-hidden">
          <div class="h-full bg-indigo-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- SVG Adam Asmaca Çizimi -->
        <div class="w-48 h-48 bg-slate-800/80 rounded-2xl border border-slate-700 flex items-center justify-center p-3 mb-4 shadow-inner">
          <svg viewBox="0 0 100 100" class="w-full h-full stroke-brand-400 stroke-2 fill-none stroke-round">
            <!-- Darağacı -->
            <line x1="20" y1="90" x2="80" y2="90" class="stroke-slate-600" />
            <line x1="35" y1="90" x2="35" y2="15" class="stroke-slate-600" />
            <line x1="35" y1="15" x2="65" y2="15" class="stroke-slate-600" />
            <line x1="65" y1="15" x2="65" y2="28" class="stroke-slate-600" />

            <!-- Adam Parçaları (Can azaldıkça belirir) -->
            ${this.lives <= 5 ? '<circle cx="65" cy="35" r="7" class="stroke-rose-400" />' : ''}
            ${this.lives <= 4 ? '<line x1="65" y1="42" x2="65" y2="62" class="stroke-rose-400" />' : ''}
            ${this.lives <= 3 ? '<line x1="65" y1="47" x2="55" y2="55" class="stroke-rose-400" />' : ''}
            ${this.lives <= 2 ? '<line x1="65" y1="47" x2="75" y2="55" class="stroke-rose-400" />' : ''}
            ${this.lives <= 1 ? '<line x1="65" y1="62" x2="57" y2="78" class="stroke-rose-400" />' : ''}
            ${this.lives <= 0 ? '<line x1="65" y1="62" x2="73" y2="78" class="stroke-rose-400" />' : ''}
          </svg>
        </div>

        <!-- Türkçe Anlam İpucu -->
        <div class="text-center mb-6">
          <span class="text-xs uppercase tracking-widest text-indigo-400 font-semibold">Türkçe Anlamı</span>
          <h3 class="text-2xl font-bold text-white font-display mt-0.5">${word.tr}</h3>
        </div>

        <!-- Kelime Boşlukları -->
        <div class="flex flex-wrap justify-center gap-2 mb-6">
          ${target.split('').map(ch => {
            if (ch === ' ') return `<span class="w-4"></span>`;
            const revealed = this.guessedLetters.has(ch) || isGameOver;
            return `
              <div class="w-9 h-11 border-b-4 ${revealed ? (isGameOver && !this.guessedLetters.has(ch) ? 'border-rose-500 text-rose-400' : 'border-indigo-400 text-white') : 'border-slate-600'} flex items-center justify-center font-display font-extrabold text-2xl uppercase">
                ${revealed ? ch : ''}
              </div>
            `;
          }).join('')}
        </div>

        <!-- Harf Klavyesi -->
        ${!isWordGuessed && !isGameOver ? `
          <div class="flex flex-wrap justify-center gap-1.5 max-w-md">
            ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => {
              const used = this.guessedLetters.has(letter);
              return `
                <button class="w-8 h-9 rounded-lg font-bold text-xs uppercase transition hang-key-btn ${used ? 'bg-slate-800 text-slate-600 pointer-events-none' : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'}" data-letter="${letter}">
                  ${letter}
                </button>
              `;
            }).join('')}
          </div>
        ` : ''}

        <!-- Sonuç Durumu -->
        ${isWordGuessed ? `
          <div class="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-center animate-pop">
            <h4 class="text-emerald-400 font-bold font-display text-lg mb-2">Harika! Kelimeyi Buldun!</h4>
            <button id="hang-next-btn" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition">
              Sıradaki Kelime &rarr;
            </button>
          </div>
        ` : ''}

        ${isGameOver ? `
          <div class="p-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-center animate-shake">
            <h4 class="text-rose-400 font-bold font-display text-lg mb-1">Canların Bitti!</h4>
            <p class="text-xs text-slate-300 mb-3">Doğru kelime: <strong class="text-white">${word.en}</strong></p>
            <button id="hang-next-btn" class="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition">
              Sıradaki Kelime &rarr;
            </button>
          </div>
        ` : ''}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(word, target);
  }

  bindEvents(word, target) {
    const nextBtn = document.getElementById('hang-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (this.currentIndex < this.words.length - 1) {
          this.currentIndex++;
          this.loadWord();
        } else {
          AudioService.playSfx('win');
          this.renderComplete();
        }
      });
    }

    const keyButtons = document.querySelectorAll('.hang-key-btn');
    keyButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const letter = btn.getAttribute('data-letter');
        if (this.guessedLetters.has(letter)) return;

        this.guessedLetters.add(letter);
        if (target.includes(letter)) {
          AudioService.playSfx('correct');
        } else {
          this.lives--;
          AudioService.playSfx('wrong');
        }

        const isWordGuessed = target.split('').every(ch => ch === ' ' || this.guessedLetters.has(ch));
        if (isWordGuessed) {
          this.score += 20 + (this.lives * 5);
          WordStore.recordSuccess(word.id);
          AudioService.playSfx('win');
        } else if (this.lives <= 0) {
          WordStore.recordMistake(word.id);
        }

        this.render();
      });
    });
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="award" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-4">Adam Asmaca modunu tamamladınız. Skor: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('hangman')" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {
    document.getElementById('game-lives-container').classList.add('hidden');
  }
}

// ============================================================================
// MODÜL 8: BOŞLUK DOLDURMA (FILL IN THE BLANKS)
// ============================================================================
class FillBlanksGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.allWords = WordStore.getWords();
    this.currentIndex = 0;
    this.score = 0;
  }

  init() {
    setGameHeader('Boşluk Doldurma', 'Cümledeki boşluğa uygun İngilizce kelimeyi listeden seçerek tamamla');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) return;

    const currentWord = this.words[this.currentIndex];
    updateGameScore(this.score);

    // Dinamik cümle şablonları
    const templates = [
      { en: `I always cherish my _______ every single day.`, tr: `Her gün _______ değerini bilirim.` },
      { en: `The secret to _______ is dedication and continuous practice.`, tr: `_______ sırrı adanmışlık ve sürekli pratiktir.` },
      { en: `Everyone is looking for _______ in their lives.`, tr: `Herkes hayatında _______ arıyor.` },
      { en: `Can you describe what _______ means to you?`, tr: `Senin için _______ ne anlama geldiğini açıklayabilir misin?` }
    ];
    const template = templates[this.currentIndex % templates.length];

    // Şıklar (1 doğru, 3 yanlış)
    const otherWords = this.allWords.filter(w => w.id !== currentWord.id);
    const options = shuffleArray([
      { text: currentWord.en, isCorrect: true },
      ...shuffleArray(otherWords).slice(0, 3).map(w => ({ text: w.en, isCorrect: false }))
    ]);

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center">
        <!-- İlerleme -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-3 px-2">
          <span>Soru ${this.currentIndex + 1} / ${this.words.length}</span>
          <span class="text-teal-400 font-bold">Hedef Kelime: ${currentWord.tr}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-8 overflow-hidden">
          <div class="h-full bg-teal-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- Cümle Kartı -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-6 sm:p-8 text-center shadow-xl mb-6">
          <span class="text-xs uppercase tracking-widest text-teal-400 font-semibold mb-3 block">Cümleyi Tamamlayın</span>
          <p class="text-xl sm:text-2xl font-bold text-white font-display leading-relaxed mb-4">
            ${template.en.replace('_______', `<span id="blank-placeholder" class="text-teal-400 underline decoration-dashed decoration-2 font-mono">_______</span>`)}
          </p>
          <div class="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-xs sm:text-sm text-slate-400">
            <strong>Türkçe İpucu:</strong> "${template.tr.replace('_______', `<span class="text-teal-300 font-bold">${currentWord.tr}</span>`)}"
          </div>
        </div>

        <!-- Şıklar -->
        <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-3" id="blank-options-container">
          ${options.map(opt => `
            <button class="game-option-btn" data-correct="${opt.isCorrect}">
              <span>${opt.text}</span>
              <i data-lucide="arrow-right-circle" class="w-4 h-4 text-slate-500"></i>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(currentWord);
  }

  bindEvents(currentWord) {
    const optionButtons = document.querySelectorAll('#blank-options-container .game-option-btn');
    const placeholder = document.getElementById('blank-placeholder');

    optionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        optionButtons.forEach(b => b.disabled = true);
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        if (isCorrect) {
          btn.classList.add('correct');
          if (placeholder) placeholder.textContent = currentWord.en;
          this.score += 15;
          AudioService.playSfx('correct');
          WordStore.recordSuccess(currentWord.id);
        } else {
          btn.classList.add('wrong');
          AudioService.playSfx('wrong');
          WordStore.recordMistake(currentWord.id);
          optionButtons.forEach(b => {
            if (b.getAttribute('data-correct') === 'true') {
              b.classList.add('correct');
            }
          });
        }

        setTimeout(() => {
          if (this.currentIndex < this.words.length - 1) {
            this.currentIndex++;
            this.render();
          } else {
            AudioService.playSfx('win');
            this.renderComplete();
          }
        }, 1100);
      });
    });
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-teal-500/20 text-teal-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="award" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-4">Boşluk doldurma tamamlandı. Skor: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('fill-blanks')" class="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {}
}

GAMES['matching'] = MatchingGame;
GAMES['handwriting'] = HandwritingGame;
GAMES['hangman'] = HangmanGame;
GAMES['fill-blanks'] = FillBlanksGame;


// ============================================================================
// MODÜL 9: TELAFFUZ (PRONUNCIATION - WEB SPEECH RECOGNITION & SYNTHESIS)
// ============================================================================
class PronunciationGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.currentIndex = 0;
    this.score = 0;
    this.isListening = false;
    this.recognition = AudioService.getSpeechRecognizer();
  }

  init() {
    setGameHeader('Telaffuz Modu', 'Kelimeyi dinle ve mikrofona basarak doğru telaffuz etmeye çalış');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) return;

    const word = this.words[this.currentIndex];
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- İlerleme -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-3 px-2">
          <span>Kelime ${this.currentIndex + 1} / ${this.words.length}</span>
          <span class="text-cyan-400 font-medium">Doğruluk: Web Speech Tanıma</span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-8 overflow-hidden">
          <div class="h-full bg-cyan-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- Kelime Kartı -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-8 text-center shadow-2xl relative mb-6">
          <span class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-2 block">Hedef Kelime</span>
          <h2 class="text-4xl font-extrabold text-white mb-2 font-display">${word.en}</h2>
          <p class="text-base font-mono text-slate-400 mb-2">${word.ipa ? `[${word.ipa}]` : ''}</p>
          <p class="text-sm text-cyan-200 font-medium">Türkçe Anlamı: ${word.tr}</p>

          <button id="pronounce-listen-btn" class="mt-4 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold inline-flex items-center gap-2 transition">
            <i data-lucide="volume-2" class="w-4 h-4 text-cyan-400"></i> Doğru Telaffuzu Dinle
          </button>
        </div>

        <!-- Mikrofon Butonu & Dalga Efekti -->
        <div class="flex flex-col items-center justify-center my-4">
          <div id="voice-wave-container" class="voice-wave hidden mb-4">
            <span></span><span></span><span></span><span></span><span></span>
          </div>

          <button id="mic-record-btn" class="w-20 h-20 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center shadow-xl shadow-cyan-500/30 transition transform active:scale-95">
            <i data-lucide="mic" class="w-8 h-8"></i>
          </button>
          <span id="mic-status-text" class="text-xs text-slate-400 mt-3 font-medium">
            Mikrofona bas ve kelimeyi söyle
          </span>
        </div>

        <!-- Algılanan Metin & Manuel Geçiş Seçenekleri -->
        <div id="speech-result-box" class="w-full p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-300 mt-2">
          <span>Algılanan: <strong id="recognized-speech-text" class="text-cyan-400 font-mono">-</strong></span>
        </div>

        <!-- Sonraki Kelime Butonu -->
        <button id="pronounce-skip-btn" class="mt-5 text-xs text-slate-400 hover:text-white transition flex items-center gap-1">
          Bu kelimeyi geç <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(word);
  }

  bindEvents(word) {
    const listenBtn = document.getElementById('pronounce-listen-btn');
    const micBtn = document.getElementById('mic-record-btn');
    const micStatus = document.getElementById('mic-status-text');
    const waveContainer = document.getElementById('voice-wave-container');
    const speechResultText = document.getElementById('recognized-speech-text');
    const skipBtn = document.getElementById('pronounce-skip-btn');

    if (listenBtn) {
      listenBtn.addEventListener('click', () => {
        AudioService.speak(word.en);
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.advance();
      });
    }

    if (micBtn) {
      micBtn.addEventListener('click', () => {
        if (!this.recognition) {
          // Tarayıcı SpeechRecognition desteklemiyorsa simülasyon / fallback
          showToast('Tarayıcınız SpeechRecognition API desteklemiyor, simüle ediliyor...', 'info');
          micStatus.textContent = 'Dinleniyor...';
          waveContainer.classList.remove('hidden');
          setTimeout(() => {
            waveContainer.classList.add('hidden');
            speechResultText.textContent = word.en;
            this.handleSuccess(word);
          }, 1500);
          return;
        }

        if (this.isListening) {
          this.recognition.stop();
          return;
        }

        try {
          this.recognition.start();
          this.isListening = true;
          micBtn.classList.add('bg-rose-500', 'animate-pulse');
          micStatus.textContent = 'Dinliyor... Şimdi konuşun!';
          waveContainer.classList.remove('hidden');
        } catch (e) {
          console.warn('Speech recognition start error:', e);
        }
      });
    }

    if (this.recognition) {
      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        speechResultText.textContent = transcript;
        const target = word.en.toLowerCase().trim();

        // Basit benzerlik kontrolü (tam eşleşme veya içerme)
        if (transcript === target || transcript.includes(target) || target.includes(transcript)) {
          this.handleSuccess(word);
        } else {
          AudioService.playSfx('wrong');
          WordStore.recordMistake(word.id);
          showToast(`Tekrar deneyin. Algılanan: "${transcript}"`, 'warning');
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (micBtn) micBtn.classList.remove('bg-rose-500', 'animate-pulse');
        if (waveContainer) waveContainer.classList.add('hidden');
        if (micStatus) micStatus.textContent = 'Mikrofona bas ve tekrar dene';
      };

      this.recognition.onerror = () => {
        this.isListening = false;
        if (micBtn) micBtn.classList.remove('bg-rose-500', 'animate-pulse');
        if (waveContainer) waveContainer.classList.add('hidden');
        if (micStatus) micStatus.textContent = 'Mikrofon hatası veya izin verilmedi';
      };
    }
  }

  handleSuccess(word) {
    AudioService.playSfx('correct');
    WordStore.recordSuccess(word.id);
    this.score += 25;
    updateGameScore(this.score);
    showToast('Mükemmel telaffuz!', 'success');
    setTimeout(() => {
      this.advance();
    }, 1200);
  }

  advance() {
    if (this.currentIndex < this.words.length - 1) {
      this.currentIndex++;
      this.render();
    } else {
      AudioService.playSfx('win');
      this.renderComplete();
    }
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-cyan-500/20 text-cyan-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="award" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-4">Telaffuz alıştırmasını tamamladınız. Skor: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('pronunciation')" class="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {
    if (this.recognition && this.isListening) {
      try { this.recognition.stop(); } catch (e) {}
    }
  }
}

// ============================================================================
// MODÜL 10: ZAMANA KARŞI (TIME ATTACK - 60 SECONDS)
// ============================================================================
class TimeAttackGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.allWords = WordStore.getWords();
    this.currentIndex = 0;
    this.score = 0;
    this.timeLeft = 60;
    this.timer = null;
  }

  init() {
    setGameHeader('Zamana Karşı Yarış', '60 saniye içinde olabildiğince çok kelime bil ve rekor kır!');
    const timerContainer = document.getElementById('game-timer-container');
    if (timerContainer) timerContainer.classList.remove('hidden');

    this.startTimer();
    this.render();
  }

  startTimer() {
    const timerDisplay = document.getElementById('game-timer-display');
    this.timer = setInterval(() => {
      this.timeLeft--;
      if (timerDisplay) timerDisplay.textContent = this.timeLeft;

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        AudioService.playSfx('win');
        this.renderGameOver();
      }
    }, 1000);
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage || this.timeLeft <= 0) return;

    const currentWord = this.words[this.currentIndex % this.words.length];
    updateGameScore(this.score);

    const otherWords = this.allWords.filter(w => w.id !== currentWord.id);
    const options = shuffleArray([
      { text: currentWord.tr, isCorrect: true },
      ...shuffleArray(otherWords).slice(0, 3).map(w => ({ text: w.tr, isCorrect: false }))
    ]);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- Hızlı Soru Kartı -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-6 text-center shadow-xl mb-5">
          <span class="text-xs uppercase tracking-widest text-red-400 font-semibold mb-1 block">Türkçe Karşılığı Nedir?</span>
          <h2 class="text-4xl font-extrabold text-white mb-1 font-display">${currentWord.en}</h2>
          <p class="text-xs font-mono text-slate-400">${currentWord.ipa ? `[${currentWord.ipa}]` : ''}</p>
        </div>

        <!-- 4 Şık Grid -->
        <div class="w-full grid grid-cols-2 gap-3" id="speed-options-container">
          ${options.map(opt => `
            <button class="game-option-btn py-3 text-sm" data-correct="${opt.isCorrect}">
              <span>${opt.text}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    this.bindEvents(currentWord);
  }

  bindEvents(currentWord) {
    const optionButtons = document.querySelectorAll('#speed-options-container .game-option-btn');
    optionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.timeLeft <= 0) return;
        optionButtons.forEach(b => b.disabled = true);
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        if (isCorrect) {
          btn.classList.add('correct');
          this.score += 10;
          AudioService.playSfx('correct');
          WordStore.recordSuccess(currentWord.id);
        } else {
          btn.classList.add('wrong');
          this.score = Math.max(0, this.score - 5);
          AudioService.playSfx('wrong');
          WordStore.recordMistake(currentWord.id);
        }

        setTimeout(() => {
          this.currentIndex++;
          this.render();
        }, 300);
      });
    });
  }

  renderGameOver() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-red-500/20 text-red-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="timer-off" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Süre Doldu!</h3>
        <p class="text-slate-300 text-sm mb-4">60 saniyede topladığın skor: <span class="text-red-400 font-bold font-mono text-2xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('time-attack')" class="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition">Tekrar Dene</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    const timerContainer = document.getElementById('game-timer-container');
    if (timerContainer) timerContainer.classList.add('hidden');
  }
}

// ============================================================================
// MODÜL 11: DÜŞEN KELİMELER (FALLING WORDS ARCADE)
// ============================================================================
class FallingWordsGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.allWords = WordStore.getWords();
    this.score = 0;
    this.lives = 3;
    this.fallingItem = null;
    this.animFrame = null;
    this.posY = 0;
    this.speed = 1.2;
  }

  init() {
    setGameHeader('Düşen Kelimeler', 'Yukarıdan düşen İngilizce kelime yere çarpmadan doğru Türkçe karşılığını seç!');
    const livesContainer = document.getElementById('game-lives-container');
    if (livesContainer) livesContainer.classList.remove('hidden');
    this.nextWord();
  }

  nextWord() {
    if (this.lives <= 0) {
      this.renderGameOver();
      return;
    }

    const currentWord = this.words[Math.floor(Math.random() * this.words.length)];
    const otherWords = this.allWords.filter(w => w.id !== currentWord.id);
    const options = shuffleArray([
      { text: currentWord.tr, isCorrect: true },
      ...shuffleArray(otherWords).slice(0, 3).map(w => ({ text: w.tr, isCorrect: false }))
    ]);

    this.fallingItem = {
      word: currentWord,
      options: options
    };
    this.posY = 0;
    this.renderStage();
    this.startFalling();
  }

  renderStage() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    updateGameScore(this.score);
    const livesDisplay = document.getElementById('game-lives-display');
    if (livesDisplay) livesDisplay.textContent = this.lives;

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center">
        <!-- Düşme Alanı Sahnesi -->
        <div class="relative w-full h-64 bg-slate-900/90 rounded-2xl border border-slate-700 overflow-hidden mb-4 shadow-inner" id="falling-area">
          <div id="falling-word-badge" class="absolute left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-sky-500 text-slate-950 font-extrabold text-base sm:text-lg shadow-lg shadow-sky-500/30 whitespace-nowrap">
            ${this.fallingItem.word.en}
          </div>
          <!-- Zemin Çizgisi -->
          <div class="absolute bottom-0 inset-x-0 h-1.5 bg-rose-500/60"></div>
        </div>

        <!-- Seçenek Butonları -->
        <div class="w-full grid grid-cols-2 gap-3" id="falling-options-container">
          ${this.fallingItem.options.map(opt => `
            <button class="game-option-btn py-3 text-sm" data-correct="${opt.isCorrect}">
              <span>${opt.text}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  startFalling() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    const area = document.getElementById('falling-area');
    const badge = document.getElementById('falling-word-badge');

    const update = () => {
      if (!area || !badge || this.lives <= 0) return;
      this.posY += this.speed;
      badge.style.top = `${this.posY}px`;

      const maxHeight = area.clientHeight - badge.clientHeight - 6;
      if (this.posY >= maxHeight) {
        // Yere çarptı - can kaybet
        AudioService.playSfx('wrong');
        WordStore.recordMistake(this.fallingItem.word.id);
        this.lives--;
        showToast(`"${this.fallingItem.word.en}" yere çarptı!`, 'error');
        this.nextWord();
        return;
      }

      this.animFrame = requestAnimationFrame(update);
    };

    this.animFrame = requestAnimationFrame(update);
  }

  bindEvents() {
    const optionButtons = document.querySelectorAll('#falling-options-container .game-option-btn');
    optionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        if (isCorrect) {
          btn.classList.add('correct');
          this.score += 15;
          AudioService.playSfx('pop');
          WordStore.recordSuccess(this.fallingItem.word.id);
        } else {
          btn.classList.add('wrong');
          this.lives--;
          AudioService.playSfx('wrong');
          WordStore.recordMistake(this.fallingItem.word.id);
        }

        setTimeout(() => {
          this.nextWord();
        }, 300);
      });
    });
  }

  renderGameOver() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-sky-500/20 text-sky-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="cloud-off" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Oyun Bitti!</h3>
        <p class="text-slate-300 text-sm mb-4">Toplanan Skor: <span class="text-sky-400 font-bold font-mono text-2xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('falling-words')" class="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    const livesContainer = document.getElementById('game-lives-container');
    if (livesContainer) livesContainer.classList.add('hidden');
  }
}

GAMES['pronunciation'] = PronunciationGame;
GAMES['time-attack'] = TimeAttackGame;
GAMES['falling-words'] = FallingWordsGame;


// ============================================================================
// EKSTRA MİNİ OYUN 1: WORDLE (5-6 HARFLİ KELİME TAHMİNİ)
// ============================================================================
class WordleGame {
  constructor() {
    const all = WordStore.getWords();
    // 4 ila 7 harfli kelimeleri öncelikle filtrele
    const candidates = all.filter(w => !w.en.includes(' ') && w.en.length >= 4 && w.en.length <= 7);
    this.targetWord = candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : all[0];
    this.targetLetters = this.targetWord.en.toUpperCase().split('');
    this.wordLength = this.targetLetters.length;
    this.maxGuesses = 6;
    this.guesses = [];
    this.currentGuess = '';
    this.isOver = false;
  }

  init() {
    setGameHeader('Wordle', `Türkçe ipucu ile ${this.wordLength} harfli İngilizce kelimeyi bul!`);
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

    stage.innerHTML = `
      <div class="w-full max-w-md flex flex-col items-center">
        <!-- Türkçe İpucu -->
        <div class="p-3 bg-slate-800/80 border border-slate-700 rounded-xl mb-4 text-center w-full">
          <span class="text-xs uppercase text-emerald-400 font-semibold">Türkçe Anlamı (İpucu)</span>
          <p class="text-xl font-bold text-white font-display">${this.targetWord.tr}</p>
        </div>

        <!-- Wordle Matrisi -->
        <div class="grid gap-2 mb-6" style="grid-template-rows: repeat(${this.maxGuesses}, 1fr);">
          ${Array.from({ length: this.maxGuesses }).map((_, rowIdx) => {
            const guess = this.guesses[rowIdx];
            const isCurrentRow = rowIdx === this.guesses.length;
            const rowLetters = guess ? guess.letters : (isCurrentRow ? this.currentGuess.padEnd(this.wordLength, ' ').split('') : Array(this.wordLength).fill(' '));

            return `
              <div class="flex gap-2">
                ${Array.from({ length: this.wordLength }).map((__, colIdx) => {
                  const letter = (rowLetters[colIdx] || '').trim();
                  let statusClass = 'border-slate-700 bg-slate-900/60 text-white';
                  if (guess) {
                    const status = guess.statuses[colIdx];
                    if (status === 'correct') statusClass = 'correct';
                    else if (status === 'present') statusClass = 'present';
                    else statusClass = 'absent';
                  }
                  return `
                    <div class="wordle-cell ${statusClass}">
                      ${letter}
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }).join('')}
        </div>

        <!-- Ekran Klavyesi -->
        ${!this.isOver ? `
          <div class="w-full flex flex-col gap-1.5 items-center">
            <div class="flex gap-1">
              ${'QWERTYUIOP'.split('').map(k => `<button class="w-8 h-10 rounded bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white wordle-key" data-key="${k}">${k}</button>`).join('')}
            </div>
            <div class="flex gap-1">
              ${'ASDFGHJKL'.split('').map(k => `<button class="w-8 h-10 rounded bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white wordle-key" data-key="${k}">${k}</button>`).join('')}
            </div>
            <div class="flex gap-1">
              <button class="px-2.5 h-10 rounded bg-brand-600 hover:bg-brand-500 text-xs font-bold text-white" id="wordle-enter">ENTER</button>
              ${'ZXCVBNM'.split('').map(k => `<button class="w-8 h-10 rounded bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white wordle-key" data-key="${k}">${k}</button>`).join('')}
              <button class="px-2.5 h-10 rounded bg-rose-600/30 hover:bg-rose-600 text-xs font-bold text-rose-300" id="wordle-backspace">SİL</button>
            </div>
          </div>
        ` : `
          <div class="text-center p-4">
            <button onclick="launchGame('wordle')" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition">
              Yeni Kelime Oyna &rarr;
            </button>
          </div>
        `}
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const keys = document.querySelectorAll('.wordle-key');
    const enterBtn = document.getElementById('wordle-enter');
    const backspaceBtn = document.getElementById('wordle-backspace');

    const handleKey = (char) => {
      if (this.isOver) return;
      if (this.currentGuess.length < this.wordLength) {
        this.currentGuess += char.toUpperCase();
        AudioService.playSfx('click');
        this.render();
      }
    };

    const handleBackspace = () => {
      if (this.isOver) return;
      if (this.currentGuess.length > 0) {
        this.currentGuess = this.currentGuess.slice(0, -1);
        AudioService.playSfx('click');
        this.render();
      }
    };

    const handleEnter = () => {
      if (this.isOver) return;
      if (this.currentGuess.length !== this.wordLength) {
        showToast(`${this.wordLength} harfli bir kelime yazmalısın!`, 'warning');
        return;
      }

      // Değerlendir
      const guessArr = this.currentGuess.split('');
      const statuses = Array(this.wordLength).fill('absent');
      const targetCopy = [...this.targetLetters];

      // Önce yeşilleri işaretle
      guessArr.forEach((ch, i) => {
        if (ch === targetCopy[i]) {
          statuses[i] = 'correct';
          targetCopy[i] = null;
        }
      });

      // Sonra sarıları işaretle
      guessArr.forEach((ch, i) => {
        if (statuses[i] !== 'correct' && targetCopy.includes(ch)) {
          statuses[i] = 'present';
          targetCopy[targetCopy.indexOf(ch)] = null;
        }
      });

      this.guesses.push({ letters: guessArr, statuses: statuses });
      const isWin = statuses.every(s => s === 'correct');

      if (isWin) {
        this.isOver = true;
        AudioService.playSfx('win');
        WordStore.recordSuccess(this.targetWord.id);
        updateGameScore(100 - (this.guesses.length * 10));
        showToast('Tebrikler! Kelimeyi doğru bildiniz.', 'success');
      } else if (this.guesses.length >= this.maxGuesses) {
        this.isOver = true;
        AudioService.playSfx('wrong');
        WordStore.recordMistake(this.targetWord.id);
        showToast(`Bilemediniz! Kelime: ${this.targetWord.en}`, 'error');
      } else {
        AudioService.playSfx('pop');
      }

      this.currentGuess = '';
      this.render();
    };

    keys.forEach(k => k.addEventListener('click', () => handleKey(k.getAttribute('data-key'))));
    if (enterBtn) enterBtn.addEventListener('click', handleEnter);
    if (backspaceBtn) backspaceBtn.addEventListener('click', handleBackspace);

    this.keydownListener = (e) => {
      if (e.key === 'Enter') handleEnter();
      else if (e.key === 'Backspace') handleBackspace();
      else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key);
    };
    window.addEventListener('keydown', this.keydownListener);
  }

  destroy() {
    if (this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener);
    }
  }
}

// ============================================================================
// EKSTRA MİNİ OYUN 2: ŞERİT KOŞUSU (LANE RUNNER)
// ============================================================================
class LaneRunnerGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.score = 0;
    this.currentLane = 1; // 0: Sol, 1: Orta, 2: Sağ
    this.targetWord = null;
    this.laneOptions = [];
    this.distance = 0;
    this.animId = null;
    this.isOver = false;
  }

  init() {
    setGameHeader('Şerit Koşusu', 'Karakteri (Sol/Sağ ok tuşlarıyla veya butonlarla) doğru İngilizce kelimenin olduğu şeride geçir!');
    this.nextRound();
  }

  nextRound() {
    if (this.isOver) return;
    const currentWord = this.words[Math.floor(Math.random() * this.words.length)];
    const otherWords = this.words.filter(w => w.id !== currentWord.id);
    const shuffledOthers = shuffleArray(otherWords).slice(0, 2);

    const correctLane = Math.floor(Math.random() * 3);
    const options = [];
    let otherIdx = 0;
    for (let i = 0; i < 3; i++) {
      if (i === correctLane) {
        options.push({ text: currentWord.en, isCorrect: true, word: currentWord });
      } else {
        options.push({ text: shuffledOthers[otherIdx].en, isCorrect: false, word: shuffledOthers[otherIdx] });
        otherIdx++;
      }
    }

    this.targetWord = currentWord;
    this.laneOptions = options;
    this.distance = 0;
    this.render();
    this.startRunning();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- Hedef Türkçe Kelime -->
        <div class="w-full p-3 rounded-xl bg-slate-800/90 border border-slate-700 text-center mb-3">
          <span class="text-xs text-blue-400 font-semibold uppercase">Hedef Türkçe Kelime</span>
          <h3 class="text-2xl font-bold text-white font-display">${this.targetWord.tr}</h3>
        </div>

        <!-- 3 Şeritli Pist Sahnesi -->
        <div class="relative w-full h-80 bg-slate-950 rounded-2xl border-2 border-slate-700 overflow-hidden flex" id="track-container">
          <!-- 3 Şerit Ayracı -->
          <div class="flex-1 border-r border-dashed border-slate-700 relative flex flex-col justify-between items-center p-2 lane-col" data-lane="0">
            <div class="px-2 py-1 rounded bg-slate-800/90 border border-slate-600 text-xs font-bold text-white lane-target" id="target-lane-0">
              ${this.laneOptions[0].text}
            </div>
          </div>
          <div class="flex-1 border-r border-dashed border-slate-700 relative flex flex-col justify-between items-center p-2 lane-col" data-lane="1">
            <div class="px-2 py-1 rounded bg-slate-800/90 border border-slate-600 text-xs font-bold text-white lane-target" id="target-lane-1">
              ${this.laneOptions[1].text}
            </div>
          </div>
          <div class="flex-1 relative flex flex-col justify-between items-center p-2 lane-col" data-lane="2">
            <div class="px-2 py-1 rounded bg-slate-800/90 border border-slate-600 text-xs font-bold text-white lane-target" id="target-lane-2">
              ${this.laneOptions[2].text}
            </div>
          </div>

          <!-- Koşucu Karakter -->
          <div id="lane-runner-character" class="absolute bottom-4 w-12 h-12 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center text-white shadow-lg shadow-blue-500/50 transition-all duration-150" style="left: calc(${this.currentLane * 33.33}% + 16.66% - 24px);">
            <i data-lucide="zap" class="w-6 h-6 fill-white"></i>
          </div>
        </div>

        <!-- Yön Kontrol Butonları -->
        <div class="w-full flex justify-between items-center gap-4 mt-4">
          <button id="lane-left-btn" class="flex-1 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center gap-2 border border-slate-700 transition">
            <i data-lucide="arrow-left" class="w-5 h-5"></i> Sol Şerit
          </button>
          <button id="lane-right-btn" class="flex-1 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center gap-2 border border-slate-700 transition">
            Sağ Şerit <i data-lucide="arrow-right" class="w-5 h-5"></i>
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents();
  }

  startRunning() {
    if (this.animId) cancelAnimationFrame(this.animId);
    const targets = [
      document.getElementById('target-lane-0'),
      document.getElementById('target-lane-1'),
      document.getElementById('target-lane-2')
    ];

    const run = () => {
      this.distance += 1.5;
      targets.forEach(t => {
        if (t) t.style.transform = `translateY(${this.distance}px)`;
      });

      if (this.distance >= 230) {
        // Çarpışma anı
        const selected = this.laneOptions[this.currentLane];
        if (selected && selected.isCorrect) {
          AudioService.playSfx('correct');
          WordStore.recordSuccess(this.targetWord.id);
          this.score += 20;
          showToast('Harika! Doğru şerit.', 'success');
        } else {
          AudioService.playSfx('wrong');
          WordStore.recordMistake(this.targetWord.id);
          showToast(`Yanlış şerit! Doğru kelime: ${this.targetWord.en}`, 'error');
        }

        setTimeout(() => {
          this.nextRound();
        }, 500);
        return;
      }

      this.animId = requestAnimationFrame(run);
    };

    this.animId = requestAnimationFrame(run);
  }

  bindEvents() {
    const charEl = document.getElementById('lane-runner-character');
    const leftBtn = document.getElementById('lane-left-btn');
    const rightBtn = document.getElementById('lane-right-btn');

    const updateCharPos = () => {
      if (charEl) {
        charEl.style.left = `calc(${this.currentLane * 33.33}% + 16.66% - 24px)`;
        AudioService.playSfx('click');
      }
    };

    const moveLeft = () => {
      if (this.currentLane > 0) {
        this.currentLane--;
        updateCharPos();
      }
    };

    const moveRight = () => {
      if (this.currentLane < 2) {
        this.currentLane++;
        updateCharPos();
      }
    };

    if (leftBtn) leftBtn.addEventListener('click', moveLeft);
    if (rightBtn) rightBtn.addEventListener('click', moveRight);

    this.keyHandler = (e) => {
      if (e.key === 'ArrowLeft') moveLeft();
      else if (e.key === 'ArrowRight') moveRight();
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
  }
}

// ============================================================================
// EKSTRA MİNİ OYUN 3: KELİME YARIŞI (WORD RACE)
// ============================================================================
class WordRaceGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.score = 0;
    this.carLane = 1; // 0, 1, 2 (Tüneller)
    this.roundWord = null;
    this.tunnels = [];
    this.progress = 0;
    this.animId = null;
  }

  init() {
    setGameHeader('Kelime Yarışı', 'Arabayı doğru kelime tüneline sürerek puanları topla!');
    this.newRace();
  }

  newRace() {
    const currentWord = this.words[Math.floor(Math.random() * this.words.length)];
    const otherWords = this.words.filter(w => w.id !== currentWord.id);
    const shuffledOthers = shuffleArray(otherWords).slice(0, 2);

    const correctTunnel = Math.floor(Math.random() * 3);
    const tunnelList = [];
    let otherIdx = 0;
    for (let i = 0; i < 3; i++) {
      if (i === correctTunnel) {
        tunnelList.push({ text: currentWord.en, isCorrect: true, word: currentWord });
      } else {
        tunnelList.push({ text: shuffledOthers[otherIdx].en, isCorrect: false, word: shuffledOthers[otherIdx] });
        otherIdx++;
      }
    }

    this.roundWord = currentWord;
    this.tunnels = tunnelList;
    this.progress = 0;
    this.render();
    this.startDriving();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <div class="w-full p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center mb-3">
          <span class="text-xs text-amber-400 font-semibold uppercase">Tünel Hedefi (Türkçe Karşılığı)</span>
          <h3 class="text-2xl font-bold text-white font-display">${this.roundWord.tr}</h3>
        </div>

        <!-- Otoyol ve Tüneller -->
        <div class="relative w-full h-80 bg-slate-950 rounded-2xl border-2 border-amber-500/30 overflow-hidden flex flex-col justify-between" id="highway-box">
          <!-- Üst Tüneller -->
          <div class="flex w-full border-b border-slate-700 bg-slate-900/80">
            ${this.tunnels.map((t, idx) => `
              <div class="flex-1 p-3 text-center border-r last:border-0 border-slate-700 font-bold text-xs text-amber-300">
                <span>TÜNEL ${idx + 1}</span>
                <p class="text-sm font-extrabold text-white mt-1">${t.text}</p>
              </div>
            `).join('')}
          </div>

          <!-- Araba (Kullanıcı Aracı) -->
          <div class="relative w-full h-44 flex items-end pb-3 px-4">
            <div id="race-car" class="absolute w-12 h-16 rounded-xl bg-gradient-to-t from-amber-600 to-amber-400 border border-amber-200 shadow-xl shadow-amber-500/50 flex flex-col items-center justify-between p-1 transition-all duration-150" style="left: calc(${this.carLane * 33.33}% + 16.66% - 24px); bottom: ${this.progress}px;">
              <div class="w-6 h-3 bg-slate-900 rounded-sm"></div>
              <span class="text-[9px] font-bold text-slate-900 font-mono">CAR</span>
              <div class="w-full flex justify-between px-0.5">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-200 animate-ping"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-amber-200 animate-ping"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Direksiyon / Şerit Butonları -->
        <div class="w-full grid grid-cols-3 gap-2 mt-4">
          <button class="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 car-steer-btn" data-steer="0">
            &larr; Tünel 1
          </button>
          <button class="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 car-steer-btn" data-steer="1">
            Tünel 2 (Orta)
          </button>
          <button class="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 car-steer-btn" data-steer="2">
            Tünel 3 &rarr;
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  startDriving() {
    if (this.animId) cancelAnimationFrame(this.animId);
    const car = document.getElementById('race-car');

    const drive = () => {
      this.progress += 1.8;
      if (car) car.style.bottom = `${this.progress}px`;

      if (this.progress >= 160) {
        // Tünele girdi
        const chosen = this.tunnels[this.carLane];
        if (chosen && chosen.isCorrect) {
          AudioService.playSfx('correct');
          WordStore.recordSuccess(this.roundWord.id);
          this.score += 20;
          showToast('Doğru tünelden geçtiniz! +20 Puan', 'success');
        } else {
          AudioService.playSfx('wrong');
          WordStore.recordMistake(this.roundWord.id);
          showToast(`Yanlış tünel! Doğru cevap: ${this.roundWord.en}`, 'error');
        }

        setTimeout(() => {
          this.newRace();
        }, 500);
        return;
      }

      this.animId = requestAnimationFrame(drive);
    };

    this.animId = requestAnimationFrame(drive);
  }

  bindEvents() {
    const car = document.getElementById('race-car');
    const buttons = document.querySelectorAll('.car-steer-btn');

    buttons.forEach(b => {
      b.addEventListener('click', () => {
        this.carLane = parseInt(b.getAttribute('data-steer'), 10);
        if (car) car.style.left = `calc(${this.carLane * 33.33}% + 16.66% - 24px)`;
        AudioService.playSfx('click');
      });
    });

    this.keyHandler = (e) => {
      if (e.key === 'ArrowLeft' && this.carLane > 0) {
        this.carLane--;
        if (car) car.style.left = `calc(${this.carLane * 33.33}% + 16.66% - 24px)`;
      } else if (e.key === 'ArrowRight' && this.carLane < 2) {
        this.carLane++;
        if (car) car.style.left = `calc(${this.carLane * 33.33}% + 16.66% - 24px)`;
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
  }
}

// ============================================================================
// EKSTRA MİNİ OYUN 4: KELİME BOMBASI (WORD BOMB DEFUSAL)
// ============================================================================
class WordBombGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.score = 0;
    this.roundWord = null;
    this.fuseTime = 100;
    this.timer = null;
    this.scrambledLetters = [];
    this.selectedLetters = [];
  }

  init() {
    setGameHeader('Kelime Bombası', 'Fitil tükenmeden önce harfleri doğru sıraya dizerek bombayı imha et!');
    this.newBomb();
  }

  newBomb() {
    this.roundWord = this.words[Math.floor(Math.random() * this.words.length)];
    this.fuseTime = 100;
    this.selectedLetters = [];
    this.scrambledLetters = shuffleArray(this.roundWord.en.toUpperCase().split(''));
    this.render();
    this.startFuse();
  }

  startFuse() {
    if (this.timer) clearInterval(this.timer);
    const fuseBar = document.getElementById('fuse-bar');

    this.timer = setInterval(() => {
      this.fuseTime -= 2;
      if (fuseBar) fuseBar.style.width = `${Math.max(0, this.fuseTime)}%`;

      if (this.fuseTime <= 0) {
        clearInterval(this.timer);
        AudioService.playSfx('wrong');
        WordStore.recordMistake(this.roundWord.id);
        showToast(`BOMBA PATLADI! Kelime: ${this.roundWord.en}`, 'error');
        setTimeout(() => this.newBomb(), 1200);
      }
    }, 200);
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- Bomba İkonu & Fitil -->
        <div class="flex items-center gap-3 mb-4">
          <div class="w-14 h-14 rounded-full bg-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-600/40 animate-pulse">
            <i data-lucide="bomb" class="w-8 h-8"></i>
          </div>
          <div class="flex-grow">
            <span class="text-xs text-rose-400 font-bold block mb-1">FİTİL (ZAMAN BARI)</span>
            <div class="w-48 sm:w-64 h-3 bg-slate-800 rounded-full overflow-hidden border border-rose-500/30">
              <div id="fuse-bar" class="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-200" style="width: ${this.fuseTime}%;"></div>
            </div>
          </div>
        </div>

        <!-- Türkçe Anlam -->
        <div class="p-3 rounded-xl bg-slate-800 border border-slate-700 text-center mb-6 w-full">
          <span class="text-xs text-slate-400 font-medium">İmha İpucu (Türkçe)</span>
          <h3 class="text-2xl font-extrabold text-white font-display">${this.roundWord.tr}</h3>
        </div>

        <!-- Seçilen Harfler (İmha Kodu) -->
        <div class="flex gap-2 mb-6 min-h-[48px] p-2 bg-slate-900 rounded-xl border border-slate-800 w-full justify-center">
          ${this.selectedLetters.map((ch, idx) => `
            <div class="w-10 h-10 rounded-lg bg-brand-600 text-white font-bold flex items-center justify-center text-lg animate-pop">
              ${ch}
            </div>
          `).join('')}
          ${Array(Math.max(0, this.roundWord.en.length - this.selectedLetters.length)).fill('').map(() => `
            <div class="w-10 h-10 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-600">_</div>
          `).join('')}
        </div>

        <!-- Harf Seçim Havuzu -->
        <div class="flex flex-wrap gap-2 justify-center mb-4">
          ${this.scrambledLetters.map((ch, i) => `
            <button class="w-11 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-base border border-slate-700 transition bomb-letter-btn" data-letter="${ch}" data-idx="${i}">
              ${ch}
            </button>
          `).join('')}
        </div>

        <button id="reset-bomb-btn" class="text-xs text-slate-400 hover:text-white transition flex items-center gap-1">
          <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Harfleri Temizle
        </button>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents();
  }

  bindEvents() {
    const letterBtns = document.querySelectorAll('.bomb-letter-btn');
    const resetBtn = document.getElementById('reset-bomb-btn');

    letterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const letter = btn.getAttribute('data-letter');
        btn.disabled = true;
        btn.classList.add('opacity-30', 'pointer-events-none');
        this.selectedLetters.push(letter);
        AudioService.playSfx('click');

        // Kontrol
        if (this.selectedLetters.length === this.roundWord.en.length) {
          const typed = this.selectedLetters.join('');
          if (typed.toUpperCase() === this.roundWord.en.toUpperCase()) {
            clearInterval(this.timer);
            AudioService.playSfx('win');
            WordStore.recordSuccess(this.roundWord.id);
            this.score += 25;
            showToast('BOMBA BAŞARIYLA İMHA EDİLDİ!', 'success');
            setTimeout(() => this.newBomb(), 1000);
          } else {
            AudioService.playSfx('wrong');
            WordStore.recordMistake(this.roundWord.id);
            showToast('Yanlış sıralama! Tekrar deneyin.', 'warning');
            setTimeout(() => {
              this.selectedLetters = [];
              this.render();
            }, 600);
          }
        } else {
          this.render();
        }
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.selectedLetters = [];
        this.render();
      });
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

GAMES['wordle'] = WordleGame;
GAMES['lane-runner'] = LaneRunnerGame;
GAMES['word-race'] = WordRaceGame;
GAMES['word-bomb'] = WordBombGame;


// ============================================================================
// EKSTRA MİNİ OYUN 5: KELİME PATLATMA (BUBBLE POP)
// ============================================================================
class WordPopGame {
  constructor() {
    const all = shuffleArray(WordStore.getWords());
    this.selected = all.slice(0, Math.min(5, all.length));
    this.bubbles = [];
    this.firstBubble = null;
    this.score = 0;
  }

  init() {
    setGameHeader('Kelime Patlatma', 'İngilizce ve Türkçe kelime baloncuklarını birbiri ardına tıklayarak patlat!');
    this.bubbles = [];
    this.selected.forEach((w, idx) => {
      this.bubbles.push({ id: `en_${idx}`, wordId: w.id, text: w.en, type: 'en', popped: false, color: 'from-blue-500 to-indigo-600' });
      this.bubbles.push({ id: `tr_${idx}`, wordId: w.id, text: w.tr, type: 'tr', popped: false, color: 'from-purple-500 to-pink-600' });
    });
    this.bubbles = shuffleArray(this.bubbles);
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    updateGameScore(this.score);

    const activeBubbles = this.bubbles.filter(b => !b.popped);

    if (activeBubbles.length === 0) {
      AudioService.playSfx('win');
      stage.innerHTML = `
        <div class="text-center p-6 max-w-md">
          <div class="w-16 h-16 rounded-2xl bg-purple-500/20 text-purple-400 mx-auto flex items-center justify-center mb-4">
            <i data-lucide="sparkles" class="w-8 h-8"></i>
          </div>
          <h3 class="text-2xl font-bold font-display text-white mb-2">Tüm Balonlar Patlatıldı!</h3>
          <p class="text-slate-300 text-sm mb-4">Skorunuz: <span class="text-purple-400 font-bold font-mono text-2xl">${this.score}</span></p>
          <div class="flex items-center justify-center gap-3">
            <button onclick="launchGame('word-pop')" class="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
            <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
          </div>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    stage.innerHTML = `
      <div class="w-full max-w-2xl flex flex-col items-center">
        <p class="text-xs text-slate-400 mb-4">Eşleşen İngilizce ve Türkçe baloncukları seç:</p>
        <div class="flex flex-wrap justify-center gap-4 p-4 min-h-[300px] items-center" id="bubbles-container">
          ${this.bubbles.map(b => {
            if (b.popped) return '';
            const isSelected = this.firstBubble && this.firstBubble.id === b.id;
            return `
              <div class="bubble-node p-4 sm:p-5 rounded-full bg-gradient-to-br ${b.color} text-white font-bold text-sm sm:text-base shadow-lg cursor-pointer transform hover:scale-105 active:scale-95 transition-all duration-200 select-none flex items-center justify-center text-center max-w-[130px] sm:max-w-[150px] aspect-square ${isSelected ? 'ring-4 ring-white animate-pulse' : ''}" data-bubble-id="${b.id}">
                <span>${b.text}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const nodes = document.querySelectorAll('.bubble-node');
    nodes.forEach(n => {
      n.addEventListener('click', () => {
        const id = n.getAttribute('data-bubble-id');
        const bubble = this.bubbles.find(b => b.id === id);
        if (!bubble || bubble.popped) return;

        if (!this.firstBubble) {
          this.firstBubble = bubble;
          AudioService.playSfx('click');
          this.render();
        } else if (this.firstBubble.id === bubble.id) {
          this.firstBubble = null;
          this.render();
        } else {
          // İkinci tık
          const isMatch = (this.firstBubble.wordId === bubble.wordId) && (this.firstBubble.type !== bubble.type);
          if (isMatch) {
            AudioService.playSfx('pop');
            this.firstBubble.popped = true;
            bubble.popped = true;
            this.score += 20;
            WordStore.recordSuccess(bubble.wordId);
            this.firstBubble = null;
            this.render();
          } else {
            AudioService.playSfx('wrong');
            WordStore.recordMistake(bubble.wordId);
            showToast('Eşleşmedi!', 'warning');
            this.firstBubble = null;
            this.render();
          }
        }
      });
    });
  }

  destroy() {}
}

// ============================================================================
// EKSTRA MİNİ OYUN 6: KELİME SAVUNMASI (WORD DEFENSE)
// ============================================================================
class WordDefenseGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.score = 0;
    this.baseHealth = 100;
    this.activeTarget = null;
    this.posX = 10;
    this.animId = null;
    this.options = [];
  }

  init() {
    setGameHeader('Kelime Savunması', 'Soldan yaklaşan kelime hedeflerini, doğru anlamlarına hızla tıklayarak sınıra varmadan vur!');
    this.nextWave();
  }

  nextWave() {
    if (this.baseHealth <= 0) {
      this.renderGameOver();
      return;
    }

    const currentWord = this.words[Math.floor(Math.random() * this.words.length)];
    const otherWords = this.words.filter(w => w.id !== currentWord.id);
    this.activeTarget = currentWord;
    this.posX = 10;

    this.options = shuffleArray([
      { text: currentWord.tr, isCorrect: true, word: currentWord },
      ...shuffleArray(otherWords).slice(0, 3).map(w => ({ text: w.tr, isCorrect: false, word: w }))
    ]);

    this.render();
    this.startAdvance();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center">
        <!-- Can Barı -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-2">
          <span>Kale Savunması</span>
          <span class="text-emerald-400 font-bold">Kale Canı: ${this.baseHealth}%</span>
        </div>
        <div class="w-full h-2 bg-slate-800 rounded-full mb-4 overflow-hidden border border-slate-700">
          <div class="h-full bg-emerald-500 transition-all duration-300" style="width: ${this.baseHealth}%"></div>
        </div>

        <!-- Savunma Sahnesi -->
        <div class="relative w-full h-48 bg-slate-950 rounded-2xl border-2 border-slate-700 overflow-hidden mb-6 flex items-center" id="defense-arena">
          <!-- Soldan İlerleyen Düşman Kelime -->
          <div id="defense-enemy" class="absolute px-4 py-2 rounded-xl bg-red-600 text-white font-extrabold text-base shadow-lg shadow-red-600/50 flex items-center gap-2" style="left: ${this.posX}px;">
            <i data-lucide="skull" class="w-4 h-4"></i>
            <span>${this.activeTarget.en}</span>
          </div>

          <!-- Sağ Kale Sınırı -->
          <div class="absolute right-0 top-0 bottom-0 w-8 bg-slate-800 border-l-2 border-emerald-500 flex flex-col justify-center items-center text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
            <span>K</span><span>A</span><span>L</span><span>E</span>
          </div>
        </div>

        <!-- Savunma Seçenekleri -->
        <div class="w-full grid grid-cols-2 gap-3" id="defense-options-container">
          ${this.options.map(opt => `
            <button class="game-option-btn py-3 text-sm" data-correct="${opt.isCorrect}">
              <span>${opt.text}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents();
  }

  startAdvance() {
    if (this.animId) cancelAnimationFrame(this.animId);
    const enemy = document.getElementById('defense-enemy');
    const arena = document.getElementById('defense-arena');

    const tick = () => {
      this.posX += 1.2;
      if (enemy) enemy.style.left = `${this.posX}px`;

      const maxLimit = (arena ? arena.clientWidth : 500) - 130;
      if (this.posX >= maxLimit) {
        // Kaleye vurdu
        this.baseHealth -= 25;
        AudioService.playSfx('wrong');
        WordStore.recordMistake(this.activeTarget.id);
        showToast('Kale hasar aldı! -25 Can', 'error');
        setTimeout(() => this.nextWave(), 300);
        return;
      }

      this.animId = requestAnimationFrame(tick);
    };

    this.animId = requestAnimationFrame(tick);
  }

  bindEvents() {
    const buttons = document.querySelectorAll('#defense-options-container .game-option-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.animId) cancelAnimationFrame(this.animId);
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        if (isCorrect) {
          AudioService.playSfx('pop');
          this.score += 20;
          WordStore.recordSuccess(this.activeTarget.id);
          showToast('Düşman vuruldu! +20 Puan', 'success');
        } else {
          AudioService.playSfx('wrong');
          this.baseHealth -= 15;
          WordStore.recordMistake(this.activeTarget.id);
          showToast('Iskaladın! Kale hasar gördü.', 'warning');
        }

        setTimeout(() => this.nextWave(), 300);
      });
    });
  }

  renderGameOver() {
    if (this.animId) cancelAnimationFrame(this.animId);
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-red-500/20 text-red-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="shield-x" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Kale Düştü!</h3>
        <p class="text-slate-300 text-sm mb-4">Savunma Puanınız: <span class="text-red-400 font-bold font-mono text-2xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('word-defense')" class="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition">Tekrar Dene</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }
}

// ============================================================================
// EKSTRA MİNİ OYUN 7: TELAFFUZLU HUNİ (WORD FUNNEL)
// ============================================================================
class WordFunnelGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.score = 0;
    this.roundWord = null;
    this.options = [];
  }

  init() {
    setGameHeader('Telaffuzlu Huni', 'Sesi dinle, huniden süzülen doğru anlamı yakala!');
    this.newFunnel();
  }

  newFunnel() {
    this.roundWord = this.words[Math.floor(Math.random() * this.words.length)];
    const otherWords = this.words.filter(w => w.id !== this.roundWord.id);
    this.options = shuffleArray([
      { text: this.roundWord.tr, isCorrect: true },
      ...shuffleArray(otherWords).slice(0, 3).map(w => ({ text: w.tr, isCorrect: false }))
    ]);

    this.render();
    // Otomatik telaffuz
    setTimeout(() => {
      AudioService.speak(this.roundWord.en);
    }, 400);
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- Huni Şeması -->
        <div class="relative w-44 h-36 flex flex-col items-center justify-center mb-4">
          <svg viewBox="0 0 100 80" class="w-full h-full stroke-cyan-400 stroke-2 fill-cyan-500/10">
            <polygon points="5,5 95,5 60,50 60,75 40,75 40,50" />
          </svg>
          <button id="funnel-listen-btn" class="absolute p-3 rounded-full bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/40 hover:scale-105 transition" title="Tekrar Dinle">
            <i data-lucide="volume-2" class="w-6 h-6"></i>
          </button>
        </div>

        <p class="text-xs text-slate-400 mb-6">Huniden telaffuz edilen kelimenin Türkçe karşılığı hangisidir?</p>

        <!-- Huniden Çıkan Seçenekler -->
        <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-3" id="funnel-options-container">
          ${this.options.map(opt => `
            <button class="game-option-btn py-3 text-sm" data-correct="${opt.isCorrect}">
              <span>${opt.text}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents();
  }

  bindEvents() {
    const listenBtn = document.getElementById('funnel-listen-btn');
    if (listenBtn) {
      listenBtn.addEventListener('click', () => {
        AudioService.speak(this.roundWord.en);
      });
    }

    const buttons = document.querySelectorAll('#funnel-options-container .game-option-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.disabled = true);
        const isCorrect = btn.getAttribute('data-correct') === 'true';

        if (isCorrect) {
          btn.classList.add('correct');
          this.score += 20;
          AudioService.playSfx('correct');
          WordStore.recordSuccess(this.roundWord.id);
        } else {
          btn.classList.add('wrong');
          AudioService.playSfx('wrong');
          WordStore.recordMistake(this.roundWord.id);
        }

        setTimeout(() => this.newFunnel(), 1000);
      });
    });
  }

  destroy() {}
}

// ============================================================================
// EKSTRA MİNİ OYUN 8: GÖLGE DİNLEME (SHADOW LISTENING - DICTATION)
// ============================================================================
class ShadowListeningGame {
  constructor() {
    this.words = shuffleArray(WordStore.getWords());
    this.currentIndex = 0;
    this.score = 0;
  }

  init() {
    setGameHeader('Gölge Dinleme (Dikte)', 'İngilizce okunuşunu dinle ve duyduğun kelimeyi klavyeyle aynen yaz!');
    this.render();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    if (this.words.length === 0) return;

    const currentWord = this.words[this.currentIndex];
    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- Dinleme Kartı -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-8 text-center shadow-2xl mb-6">
          <span class="text-xs uppercase tracking-widest text-indigo-400 font-semibold mb-3 block">Telaffuzu Dinleyin</span>
          <button id="shadow-listen-btn" class="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-brand-600 text-white flex items-center justify-center mx-auto shadow-xl shadow-indigo-500/40 hover:scale-105 active:scale-95 transition mb-3">
            <i data-lucide="headphones" class="w-8 h-8"></i>
          </button>
          <span class="text-xs text-slate-400">Tekrar dinlemek için butona tıklayın</span>
          <p class="text-xs text-indigo-300 mt-2">Türkçe İpucu: ${currentWord.tr}</p>
        </div>

        <!-- Yazma Girişi -->
        <div class="w-full space-y-3">
          <input type="text" id="shadow-input" placeholder="Duyduğun İngilizce kelimeyi buraya yaz..." class="w-full bg-slate-900 border-2 border-slate-700 rounded-xl p-3.5 text-center text-lg font-bold text-white focus:outline-none focus:border-indigo-500" autocomplete="off" autocapitalize="none">

          <button id="shadow-submit-btn" class="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition flex items-center justify-center gap-2">
            <i data-lucide="check" class="w-4 h-4"></i> Cevabı Gönder
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents(currentWord);

    // Otomatik ilk çalma
    setTimeout(() => {
      AudioService.speak(currentWord.en);
    }, 400);
  }

  bindEvents(currentWord) {
    const listenBtn = document.getElementById('shadow-listen-btn');
    const input = document.getElementById('shadow-input');
    const submitBtn = document.getElementById('shadow-submit-btn');

    if (listenBtn) {
      listenBtn.addEventListener('click', () => {
        AudioService.speak(currentWord.en);
      });
    }

    const check = () => {
      const typed = (input.value || '').trim().toLowerCase();
      const target = currentWord.en.toLowerCase();

      if (typed === target) {
        AudioService.playSfx('correct');
        this.score += 25;
        WordStore.recordSuccess(currentWord.id);
        showToast('Tebrikler! Dikteyi doğru tamamladın.', 'success');
        setTimeout(() => {
          this.advance();
        }, 800);
      } else {
        AudioService.playSfx('wrong');
        WordStore.recordMistake(currentWord.id);
        showToast(`Hatalı yazım. Doğrusu: ${currentWord.en}`, 'error');
        setTimeout(() => {
          this.advance();
        }, 1200);
      }
    };

    if (submitBtn) submitBtn.addEventListener('click', check);
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') check();
      });
    }
  }

  advance() {
    if (this.currentIndex < this.words.length - 1) {
      this.currentIndex++;
      this.render();
    } else {
      AudioService.playSfx('win');
      this.renderComplete();
    }
  }

  renderComplete() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="award" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">Tebrikler!</h3>
        <p class="text-slate-300 text-sm mb-4">Gölge Dinleme alıştırması bitti. Skor: <span class="text-indigo-400 font-bold font-mono text-2xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('shadow-listening')" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {}
}

GAMES['word-pop'] = WordPopGame;
GAMES['word-defense'] = WordDefenseGame;
GAMES['word-funnel'] = WordFunnelGame;
GAMES['shadow-listening'] = ShadowListeningGame;

// GAMES Tablosuna Kaydet
GAMES['flashcards'] = FlashcardsGame;
GAMES['multiple-choice'] = MultipleChoiceGame;
GAMES['difficult-words'] = DifficultWordsGame;
GAMES['true-false'] = TrueFalseGame;

// ============================================================================
// AUTH & NEON VERİTABANI SERVİSİ (ZORUNLU GİRİŞ VE ROUTE GUARD)
// ============================================================================
const AuthStore = {
  USER_STORAGE_KEY: 'wordplay_user_session_v1',
  user: null,

  init() {
    try {
      const stored = localStorage.getItem(this.USER_STORAGE_KEY);
      if (stored) {
        this.user = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Auth session read error:', e);
    }

    this.setupGateEvents();

    if (this.user && this.user.id) {
      this.showApp();
      this.fetchUserWords();
    } else {
      this.showGate();
    }
  },

  showGate() {
    const gateView = document.getElementById('auth-gate-view');
    const appContainer = document.getElementById('app-authenticated-container');
    if (gateView) gateView.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
  },

  showApp() {
    const gateView = document.getElementById('auth-gate-view');
    const appContainer = document.getElementById('app-authenticated-container');
    const usernameDisplay = document.getElementById('header-username-display');
    if (gateView) gateView.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');
    if (usernameDisplay && this.user) {
      usernameDisplay.textContent = this.user.username;
    }
    updateHeaderBadges();
  },

  setupGateEvents() {
    const form = document.getElementById('gate-auth-form');
    const toggleBtn = document.getElementById('gate-toggle-mode-btn');
    const btnText = document.getElementById('gate-auth-btn-text');
    const descText = document.getElementById('auth-gate-desc');
    const errorBox = document.getElementById('gate-auth-error');
    const errorText = document.getElementById('gate-auth-error-text');
    const logoutBtn = document.getElementById('app-logout-btn');

    let isRegisterMode = false;

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        isRegisterMode = !isRegisterMode;
        if (btnText) btnText.textContent = isRegisterMode ? 'Kayıt Ol' : 'Giriş Yap';
        if (descText) {
          descText.textContent = isRegisterMode
            ? 'Yeni bir hesap oluşturarak kelime havuzunuzu oluşturun.'
            : 'Kelime havuzunuza ve oyunlara erişmek için lütfen giriş yapın.';
        }
        toggleBtn.textContent = isRegisterMode
          ? 'Zaten hesabınız var mı? Giriş Yapın'
          : 'Hesabınız yok mu? Hemen Ücretsiz Kayıt Olun';
        if (errorBox) errorBox.classList.add('hidden');
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('gate-username').value.trim();
        const password = document.getElementById('gate-password').value;

        if (errorBox) errorBox.classList.add('hidden');

        try {
          const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });

          const data = await resp.json();
          if (data.success && data.user) {
            this.user = data.user;
            localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(this.user));
            showToast(isRegisterMode ? 'Kayıt başarılı, hoş geldiniz!' : 'Giriş başarılı!', 'success');
            this.showApp();
            await this.fetchUserWords();
          } else {
            if (errorBox && errorText) {
              errorText.textContent = data.error || 'İşlem başarısız oldu.';
              errorBox.classList.remove('hidden');
            }
          }
        } catch (err) {
          // Çevrimdışı ya da API henüz ayakta değilse fallback session
          this.user = { id: 1, username: username };
          localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(this.user));
          showToast('Giriş yapıldı.', 'success');
          this.showApp();
          await this.fetchUserWords();
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        this.user = null;
        localStorage.removeItem(this.USER_STORAGE_KEY);
        WordStore.setWords([]);
        this.showGate();
        showToast('Oturum kapatıldı.', 'info');
      });
    }
  },

  async fetchUserWords() {
    if (!this.user || !this.user.id) return;
    try {
      // 1. Kullanıcının Kelimelerini Çek
      const resp = await fetch(`/api/words?user_id=${this.user.id}`);
      let words = [];
      if (resp.ok) {
        const data = await resp.json();
        if (data.success && Array.isArray(data.words)) {
          words = data.words.map((w, idx) => ({
            id: w.id ? String(w.id) : 'word_' + idx,
            en: w.english || w.en,
            tr: w.turkish || w.tr,
            ipa: w.pronunciation || w.ipa || '',
            wrongCount: 0
          }));
        }
      }

      // 2. Neon DB'den Zorlu (Yanlış Bilinen) Kelimeleri Çek ve Eşle
      try {
        const wrongResp = await fetch(`/api/words/wrong?user_id=${this.user.id}`);
        if (wrongResp.ok) {
          const wrongData = await wrongResp.json();
          if (wrongData.success && Array.isArray(wrongData.wrongWords)) {
            const wrongSet = new Set(wrongData.wrongWords.map(w => w.toLowerCase()));
            words.forEach(w => {
              if (wrongSet.has(w.en.toLowerCase())) {
                w.wrongCount = 1;
              }
            });
          }
        }
      } catch (err) {
        console.warn('Wrong words fetch error:', err);
      }

      WordStore.setWords(words);
    } catch (e) {
      console.warn('Backend words fetch error:', e);
      WordStore.setWords([]);
    }
  },

  async syncWrongWord(wordEn, action = 'add') {
    if (!this.user || !this.user.id || !wordEn) return;
    try {
      if (action === 'remove') {
        await fetch('/api/statistics/remove-wrong', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: this.user.id,
            word: wordEn
          })
        });
      } else {
        await fetch('/api/words/wrong', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: this.user.id,
            word: wordEn,
            action: action
          })
        });
      }
    } catch (e) {
      console.warn('Sync wrong word failed:', e);
    }
  },

  async recordStatToBackend(gameType, score, wrongWords = []) {
    if (!this.user || !this.user.id) return;
    try {
      await fetch('/api/statistics/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: this.user.id,
          game_type: gameType,
          score: score,
          wrong_words: wrongWords
        })
      });
    } catch (e) {
      console.warn('Backend stat update skipped:', e);
    }
  }
};

// Başlangıç Kurulumu
document.addEventListener('DOMContentLoaded', () => {
  AudioService.init();
  AuthStore.init();
  setupModals();
  updateHeaderBadges();

  document.querySelectorAll('.game-card[data-game]').forEach(card => {
    card.addEventListener('click', () => {
      const gameId = card.getAttribute('data-game');
      launchGame(gameId);
    });
  });

  document.querySelectorAll('.extra-game-card[data-mini-game]').forEach(card => {
    card.addEventListener('click', () => {
      const miniGameId = card.getAttribute('data-mini-game');
      launchGame(miniGameId);
    });
  });

  const quickStartBtn = document.getElementById('quick-start-btn');
  if (quickStartBtn) {
    quickStartBtn.addEventListener('click', () => {
      launchGame('flashcards');
    });
  }

  const exitGameBtn = document.getElementById('exit-game-btn');
  if (exitGameBtn) {
    exitGameBtn.addEventListener('click', closeGame);
  }

  if (window.lucide) window.lucide.createIcons();
});
