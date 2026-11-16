/**
 * İngilizce Kelime Dünyası - Temel Veri ve Servis Katmanı
 * app.js
 */

// 1. WordStore - Tamamen Boş Başlayan ve Neon DB Destekli Kelime Deposu
const WordStore = {
  words: [],
  studyList: new Set(), // Kullanıcının seçtiği özel kelimeler (english lowercase)
  useOnlyStudyList: false, // "Sadece Seçtiğim Kelimelerle Çalış" Filtresi
  DIFFICULT_THRESHOLD: 1,

  getWords() {
    if (this.useOnlyStudyList) {
      return (this.words || []).filter(w => this.studyList.has(w.en.toLowerCase()));
    }
    return this.words || [];
  },

  getAllWords() {
    return this.words || [];
  },

  setWords(newWords) {
    this.words = Array.isArray(newWords) ? newWords : [];
    this.notifyUpdate();
  },

  setStudyList(list) {
    this.studyList = new Set((list || []).map(w => w.toLowerCase()));
    this.notifyUpdate();
  },

  isInStudyList(wordEn) {
    if (!wordEn) return false;
    return this.studyList.has(wordEn.toLowerCase());
  },

  toggleStudyList(wordEn) {
    if (!wordEn) return false;
    const lower = wordEn.toLowerCase();
    const isAdded = !this.studyList.has(lower);
    if (isAdded) {
      this.studyList.add(lower);
    } else {
      this.studyList.delete(lower);
    }
    this.notifyUpdate();

    // Neon DB Asenkron Eşitleme
    if (AuthStore && AuthStore.user && AuthStore.user.id) {
      AuthStore.syncStudyListWord(lower, isAdded ? 'add' : 'remove');
    }
    return isAdded;
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

// 4.1. Güvenli HTML kaçışı ve tek kelimelik İngilizce havuz filtreleri
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Yalnızca 3-10 harfli, boşluk/özel karakter içermeyen saf İngilizce kelimeler
const SINGLE_ENGLISH_RE = /^[a-zA-Z]{3,10}$/;
function filterSingleEnglishWords(words) {
  return (words || []).filter(w => w && typeof w.en === 'string' && SINGLE_ENGLISH_RE.test(w.en.trim()));
}

// "Sadece Seçtiğin Kelimelerle Çalış" filtresi WordStore.getWords() içinde uygulanır
function getHangmanPool() { return filterSingleEnglishWords(WordStore.getWords()); }
function getWordBombPool() { return filterSingleEnglishWords(WordStore.getWords()); }

// 5. Üst Menü ve İstatistik Göstergelerini Güncelleme
function updateHeaderBadges() {
  const words = WordStore.getWords();
  const allWords = WordStore.getAllWords();
  const difficult = WordStore.getDifficultWords();
  const studyListSize = WordStore.studyList ? WordStore.studyList.size : 0;

  // 1. Üst Bar Sayaçları
  const totalBadge = document.getElementById('total-words-badge');
  if (totalBadge) totalBadge.textContent = WordStore.useOnlyStudyList ? `${words.length} (Özel)` : allWords.length;

  const diffBadge = document.getElementById('difficult-count-badge');
  if (diffBadge) diffBadge.textContent = difficult.length;

  const diffCardBadge = document.getElementById('difficult-card-count');
  if (diffCardBadge) diffCardBadge.textContent = difficult.length;

  const studyListBadge = document.getElementById('study-list-count-badge');
  if (studyListBadge) studyListBadge.textContent = studyListSize;

  // 2. Başlık Yanındaki Klon Mobil Buton Sayaçları
  const inlineTotalBadge = document.getElementById('inline-total-words-badge');
  if (inlineTotalBadge) inlineTotalBadge.textContent = WordStore.useOnlyStudyList ? `${words.length} (Özel)` : allWords.length;

  const inlineDiffBadge = document.getElementById('inline-difficult-count-badge');
  if (inlineDiffBadge) inlineDiffBadge.textContent = difficult.length;

  const inlineStudyBadge = document.getElementById('inline-study-list-count-badge');
  if (inlineStudyBadge) inlineStudyBadge.textContent = studyListSize;

  renderWordsTable();
}

// 6. Veritabanı Yönetimi Tablo Render (Debounced & Sayfalanmış / Performanslı)
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

  // 5000+ kelimede DOM kasmaması için ilk 100 kelimeyi hemen bas (Sanal/Pencereli Liste)
  const displayLimit = 100;
  const sliced = filtered.slice(0, displayLimit);

  tbody.innerHTML = sliced.map(w => {
    const isDiff = (w.wrongCount || 0) >= WordStore.DIFFICULT_THRESHOLD;
    const isStarred = WordStore.isInStudyList(w.en);
    return `
      <tr class="hover:bg-slate-800/50 transition">
        <td class="p-2.5 font-semibold text-white flex items-center gap-2">
          <!-- Özel Çalışma Listesi Yıldız / Bookmark Butonu -->
          <button onclick="toggleStudyListHandler('${w.en.replace(/'/g, "\\'")}')" class="p-1 transition ${isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'}" title="${isStarred ? 'Özel Listemden Çıkar' : 'Özel Listeme Ekle'}">
            <i data-lucide="star" class="w-4 h-4 ${isStarred ? 'fill-amber-400' : ''}"></i>
          </button>

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
  }).join('') + (filtered.length > displayLimit ? `<tr><td colspan="5" class="p-2.5 text-center text-slate-400 text-[11px] bg-slate-900/80 italic font-mono">+${filtered.length - displayLimit} kelime daha mevcut. Arama yaparak spesifik kelimelere ulaşabilirsiniz.</td></tr>` : '');

  if (window.lucide) window.lucide.createIcons();
}

function toggleStudyListHandler(wordEn) {
  const isAdded = WordStore.toggleStudyList(wordEn);
  AudioService.playSfx('pop');
  showToast(isAdded ? `"${wordEn}" özel çalışma listenize eklendi! ⭐` : `"${wordEn}" özel listenizden çıkarıldı.`, 'info');
  updateHeaderBadges();
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

  window.addEventListener('click', (e) => {
    if (e.target === dbModal) closeDb();
  });

  if (bulkInput && lineCountBadge) {
    bulkInput.addEventListener('input', () => {
      const lines = bulkInput.value.split('\n').filter(l => l.trim().length > 0);
      lineCountBadge.textContent = `${lines.length} satır tespit edildi`;
    });
  }

  if (filterInput) {
    let filterDebounce = null;
    filterInput.addEventListener('input', (e) => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(() => {
        renderWordsTable(e.target.value);
      }, 300);
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

  // Özel Çalışma Havuzu Toggle Switch Dinleyicisi
  const studyToggle = document.getElementById('custom-study-filter-toggle');
  if (studyToggle) {
    studyToggle.addEventListener('change', (e) => {
      WordStore.useOnlyStudyList = e.target.checked;
      const filteredCount = WordStore.getWords().length;
      if (WordStore.useOnlyStudyList) {
        showToast(`Özel Çalışma Havuzu Aktif! (${filteredCount} kelime)`, 'success');
      } else {
        showToast('Tüm kelime havuzuna dönüldü.', 'info');
      }
      updateHeaderBadges();
    });
  }

  // Yatay Kaydırılabilir Sekmeler Dinleyicisi (Swipeable Tabs Filter)
  const tabButtons = document.querySelectorAll('.category-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => {
        b.classList.remove('active', 'bg-brand-600', 'text-white');
        b.classList.add('bg-slate-800/90', 'text-slate-300');
      });
      btn.classList.add('active', 'bg-brand-600', 'text-white');
      btn.classList.remove('bg-slate-800/90', 'text-slate-300');

      const filter = btn.getAttribute('data-filter');
      const cards = document.querySelectorAll('#game-modules-grid .game-card');

      cards.forEach(card => {
        const gameId = card.getAttribute('data-game') || '';

        if (filter === 'all') {
          card.classList.remove('hidden');
        } else if (filter === 'lessons') {
          card.classList.toggle('hidden', gameId !== 'step-by-step-lessons');
        } else if (filter === 'classic') {
          card.classList.toggle('hidden', !['flashcards', 'multiple-choice', 'difficult-words', 'true-false'].includes(gameId));
        } else if (filter === 'interactive') {
          card.classList.toggle('hidden', !['matching', 'handwriting', 'pronunciation', 'fill-blanks'].includes(gameId));
        } else if (filter === 'speed') {
          card.classList.toggle('hidden', !['hangman', 'time-attack', 'word-bomb'].includes(gameId));
        }
      });
      AudioService.playSfx('click');
    });
  });

  const studyListBadgeBtn = document.getElementById('nav-study-list-badge-btn');
  if (studyListBadgeBtn) {
    studyListBadgeBtn.addEventListener('click', () => {
      if (studyToggle) {
        studyToggle.checked = !studyToggle.checked;
        studyToggle.dispatchEvent(new Event('change'));
      }
    });
  }

  // Başlık Yanındaki Klon Mobil Buton Olayları (Senkronize Tetikleyiciler)
  const inlineDiffBtn = document.getElementById('inline-difficult-btn');
  if (inlineDiffBtn) {
    inlineDiffBtn.addEventListener('click', () => {
      launchGame('difficult-words');
    });
  }

  const inlineStudyBtn = document.getElementById('inline-study-list-btn');
  if (inlineStudyBtn) {
    inlineStudyBtn.addEventListener('click', () => {
      if (studyToggle) {
        studyToggle.checked = !studyToggle.checked;
        studyToggle.dispatchEvent(new Event('change'));
      }
    });
  }

  const inlineDbBtn = document.getElementById('inline-db-modal-btn');
  if (inlineDbBtn) {
    inlineDbBtn.addEventListener('click', openDb);
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

// "Kelime Bombası" ana ekranda bağımsız bir modül olarak çalışır (eski
// Ekstra Oyunlar Odası kaldırılmıştır).
function launchGame(gameId) {
  // Route Guard: Oturum yoksa oyuna girmeyi engelle
  if (!AuthStore.user || !AuthStore.user.id) {
    AuthStore.showGate();
    showToast('Oyun oynamak için lütfen önce giriş yapın.', 'warning');
    return;
  }

  const words = WordStore.getWords();
  if (words.length === 0) {
    if (WordStore.useOnlyStudyList) {
      showToast('Özel çalışma listenizde henüz kelime yok! Kelime tablosundan yıldız ikonuna basarak kelime ekleyin.', 'warning');
      const dbModal = document.getElementById('word-db-modal');
      if (dbModal) dbModal.classList.remove('hidden');
      return;
    }
    showToast('Henüz kelime eklemediniz, lütfen kelime ekleyin!', 'warning');
    const dbModal = document.getElementById('word-db-modal');
    if (dbModal) dbModal.classList.remove('hidden');
    return;
  }

  // Oyun gereksinim kontrolleri
  if (gameId === 'matching' && words.length < 6) {
    showToast(`Bu modu oynamak için listenize en az 6 kelime eklemelisiniz! (Şu an: ${words.length})`, 'warning');
    return;
  }

  if (['multiple-choice', 'fill-blanks'].includes(gameId) && words.length < 4) {
    showToast(`Bu modu oynamak için listenize en az 4 kelime eklemelisiniz! (Şu an: ${words.length})`, 'warning');
    return;
  }

  if (gameId === 'hangman' && getHangmanPool().length === 0) {
    showToast('Adam Asmaca için 3-10 harfli, tek kelimelik (boşluksuz) İngilizce kelimeler gerekir. Lütfen uygun kelime ekleyin.', 'warning');
    return;
  }

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

// Yardımcı fonksiyon: 5000+ kelimelik büyük havuzdan O(1) maliyetle N adet rastgele örnekleme (Random Sampling)
function getRandomSample(array, count) {
  if (!Array.isArray(array) || array.length <= count) {
    return shuffleArray(array || []);
  }
  const result = [];
  const taken = new Set();
  const len = array.length;
  while (result.length < count && taken.size < len) {
    const idx = Math.floor(Math.random() * len);
    if (!taken.has(idx)) {
      taken.add(idx);
      result.push(array[idx]);
    }
  }
  return result;
}

// ============================================================================
// MODÜL 1: KELİME KARTLARI (FLASHCARDS)
// ============================================================================
class FlashcardsGame {
  constructor() {
    // 5000+ kelimede anlık yanıt için rastgele 20 kelimelik çalışma paketi
    this.words = getRandomSample(WordStore.getWords(), 20);
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
      <div class="w-full max-w-lg flex flex-col items-center pb-6">
        <!-- İlerleme Çubuğu -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
          <span>Kart ${this.currentIndex + 1} / ${this.words.length}</span>
          <span>Öğrenilen: ${this.knownCount}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-3 sm:mb-5 overflow-hidden">
          <div class="h-full bg-brand-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- 3D Flip Kart (Mobil Ekranlarda Dikey 280px / Masaüstü 340px) -->
        <div class="flashcard-wrapper ${this.isFlipped ? 'flipped' : ''}" id="flashcard-element">
          <div class="flashcard-inner">
            <!-- Ön Yüz: İngilizce & Okunuş (Flexbox Üst, Orta, Alt Dengeli Dağılım) -->
            <div class="flashcard-face flashcard-front card-front flex flex-col justify-between items-center p-4 sm:p-6 w-full h-full relative">
              <div class="w-full flex items-center justify-between">
                <span class="text-xs uppercase tracking-widest text-brand-400 font-bold">İngilizce</span>
                <!-- Yıldız / Bookmark Butonu -->
                <button id="fc-star-btn" class="p-1 rounded-lg sm:rounded-xl transition ${WordStore.isInStudyList(word.en) ? 'text-amber-400 bg-amber-500/20 border border-amber-500/40' : 'text-slate-500 hover:text-amber-400 bg-slate-800/80 border border-slate-700'}" title="Özel Listeye Ekle/Çıkar">
                  <i data-lucide="star" class="w-4 h-4 ${WordStore.isInStudyList(word.en) ? 'fill-amber-400' : ''}"></i>
                </button>
              </div>

              <div class="my-auto text-center py-1 sm:py-2">
                <h2 class="text-2xl sm:text-4xl font-extrabold text-white mb-1 font-display tracking-tight">${word.en}</h2>
                <p class="text-xs sm:text-base font-mono text-slate-400">${word.ipa ? `[${word.ipa}]` : ''}</p>
              </div>

              <div class="w-full pt-2 sm:pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <button id="card-listen-btn" class="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-brand-500/20 hover:bg-brand-500/30 text-brand-300 border border-brand-500/40 transition flex items-center gap-1.5 font-medium" title="Sesli Oku">
                  <i data-lucide="volume-2" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand-400"></i> Dinle
                </button>
                <span class="flex items-center gap-1 text-[11px] sm:text-xs text-slate-400">
                  <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Çevirmek için tıkla
                </span>
              </div>
            </div>

            <!-- Arka Yüz: Türkçe Anlam (Ön Yüz İle Birebir Kenetli ve Hizalı) -->
            <div class="flashcard-face flashcard-back card-back flex flex-col justify-between items-center p-4 sm:p-6 w-full h-full relative" style="transform: rotateY(180deg); -webkit-transform: rotateY(180deg);">
              <div class="w-full flex items-center justify-between">
                <span class="text-xs uppercase tracking-widest text-blue-200 font-bold">Türkçe Karşılığı</span>
                <span class="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-200 border border-blue-400/30">Anlam</span>
              </div>

              <div class="my-auto text-center py-2 sm:py-4 px-2">
                <h2 class="text-lg sm:text-3xl font-extrabold text-white font-display leading-tight">${word.tr}</h2>
              </div>

              <div class="w-full pt-2 sm:pt-3 border-t border-blue-400/20 flex items-center justify-between text-xs text-blue-100">
                <span class="flex items-center gap-1 text-[11px] sm:text-xs text-blue-200">
                  <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Geri çevir
                </span>
                <span class="text-[10px] sm:text-[11px] text-blue-200/80">Hafıza Kartı</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Alt Kontrol Butonları (Mobil Uyumlu: mt-3, py-2 px-3, text-sm) -->
        <div class="w-full flex items-center justify-between gap-1.5 sm:gap-3 mt-3 sm:mt-5">
          <button id="prev-card-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-medium transition border border-slate-700 flex items-center gap-1 shrink-0" ${this.currentIndex === 0 ? 'disabled style="opacity: 0.5"' : ''}>
            <i data-lucide="chevron-left" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i> Önceki
          </button>

          <div class="flex items-center gap-1.5 sm:gap-2">
            <button id="mark-unknown-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs sm:text-sm font-medium transition flex items-center gap-1">
              <i data-lucide="x" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i> Zorlandım
            </button>
            <button id="mark-known-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs sm:text-sm font-medium transition flex items-center gap-1">
              <i data-lucide="check" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i> Biliyorum
            </button>
          </div>

          <button id="next-card-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-medium transition border border-slate-700 flex items-center gap-1 shrink-0" ${this.currentIndex === this.words.length - 1 ? 'disabled style="opacity: 0.5"' : ''}>
            Sonraki <i data-lucide="chevron-right" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i>
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
    const starBtn = document.getElementById('fc-star-btn');
    const prevBtn = document.getElementById('prev-card-btn');
    const nextBtn = document.getElementById('next-card-btn');
    const markKnownBtn = document.getElementById('mark-known-btn');
    const markUnknownBtn = document.getElementById('mark-unknown-btn');

    if (card) {
      card.addEventListener('click', (e) => {
        if (e.target.closest('#card-listen-btn') || e.target.closest('#fc-star-btn')) return;
        this.isFlipped = !this.isFlipped;
        card.classList.toggle('flipped', this.isFlipped);
        AudioService.playSfx('click');
      });
    }

    if (starBtn) {
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleStudyListHandler(word.en);
        this.render();
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
    this.allWords = WordStore.getWords();
    // 5000+ kelimede anlık yanıt için rastgele 15 soru paketi
    this.words = getRandomSample(this.allWords, 15);
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
    // 5000+ kelimede anlık yanıt için rastgele 6 kelimelik eşleştirme çifti
    this.selectedWords = getRandomSample(WordStore.getWords(), 6);
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

        <!-- Çift Sütunlu Sağlı-Sollu Düzen (Mobil Uyumlu Grid: 2 Sütun, Dinamik Gap & Metin Boyutu) -->
        <div class="w-full grid grid-cols-2 gap-2 sm:gap-4 md:gap-6 items-start mb-6">
          <!-- Sol Sütun: İngilizce -->
          <div class="flex flex-col gap-2 sm:gap-3">
            <div class="flex items-center justify-between px-1 sm:px-2 pb-1 border-b border-slate-700/60">
              <span class="text-[11px] sm:text-xs font-semibold tracking-wider text-blue-400 uppercase flex items-center gap-1">
                <i data-lucide="globe" class="w-3 h-3 sm:w-3.5 sm:h-3.5"></i> İngilizce
              </span>
            </div>
            <div class="flex flex-col gap-2 sm:gap-2.5" id="en-column">
              ${this.enCards.map(c => `
                <div class="match-card ${c.matched ? 'matched-hidden' : 'unmatched'} p-2.5 sm:p-3.5 rounded-xl border flex items-center justify-center text-center select-none cursor-pointer transition shadow-sm" data-card-id="${c.id}" data-type="en">
                  <span class="text-xs sm:text-sm md:text-base font-semibold break-words leading-tight">${c.text}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Sağ Sütun: Türkçe -->
          <div class="flex flex-col gap-2 sm:gap-3">
            <div class="flex items-center justify-between px-1 sm:px-2 pb-1 border-b border-slate-700/60">
              <span class="text-[11px] sm:text-xs font-semibold tracking-wider text-emerald-400 uppercase flex items-center gap-1">
                <i data-lucide="languages" class="w-3 h-3 sm:w-3.5 sm:h-3.5"></i> Türkçe
              </span>
            </div>
            <div class="flex flex-col gap-2.5 sm:gap-2.5" id="tr-column">
              ${this.trCards.map(c => `
                <div class="match-card ${c.matched ? 'matched-hidden' : 'unmatched'} p-2.5 sm:p-3.5 rounded-xl border flex items-center justify-center text-center select-none cursor-pointer transition shadow-sm" data-card-id="${c.id}" data-type="tr">
                  <span class="text-xs sm:text-sm md:text-base font-semibold break-words leading-tight">${c.text}</span>
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
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-2">
          <span>Kelime ${this.currentIndex + 1} / ${this.words.length}</span>
          <span class="text-cyan-400 font-medium flex items-center gap-1.5">
            <i data-lucide="sparkles" class="w-3.5 h-3.5 text-cyan-400"></i> Akıllı Yazı Tahtası
          </span>
        </div>
        <div class="w-full h-1.5 bg-slate-800 rounded-full mb-5 overflow-hidden border border-slate-700/60">
          <div class="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- Türkçe İpucu Kutusu -->
        <div class="w-full bg-slate-800/80 backdrop-blur-md border border-slate-700 rounded-2xl p-5 text-center shadow-xl mb-4">
          <span class="text-xs uppercase tracking-widest text-cyan-400 font-semibold mb-1 block">Türkçe Anlamı</span>
          <h2 class="text-2xl sm:text-3xl font-extrabold text-white mb-1 font-display">${word.tr}</h2>
          <p class="text-xs text-slate-400">Tablet kalemiyle, parmağınızla veya fareyle dijital yazı tahtasına İngilizcesini yazın.</p>
        </div>

        <!-- Modern Çizim Canvas Kapsayıcısı (Smart Slate) -->
        <div class="w-full handwriting-canvas-container relative mb-4">
          <canvas id="handwriting-canvas" class="w-full h-64 sm:h-72"></canvas>

          <!-- OCR Yükleniyor Katmanı (Loading) -->
          <div id="ocr-loading-overlay" class="ocr-loading-overlay hidden">
            <div class="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-white font-bold text-sm tracking-wide">Yazınız Okunuyor...</span>
            <span class="text-cyan-300/80 text-xs font-mono">Tesseract.js OCR Analizi</span>
          </div>

          <!-- Tahta Kılavuz Çizgileri (Defter Çizgisi Estetiği) -->
          <div class="absolute inset-x-6 top-1/3 border-b border-dashed border-slate-700/40 pointer-events-none"></div>
          <div class="absolute inset-x-6 top-2/3 border-b border-dashed border-cyan-500/20 pointer-events-none"></div>
        </div>

        <!-- Modernize Edilmiş Buton Çubuğu (Geri, Temizle, İpucu, Kontrol Et, İleri) -->
        <div class="w-full flex flex-wrap items-center justify-between gap-2">
          <!-- Sol Butonlar: Geri & Temizle -->
          <div class="flex items-center gap-1.5 sm:gap-2">
            <button id="hw-nav-prev-btn" class="py-2.5 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs border border-slate-700 transition flex items-center gap-1 shadow-sm" ${this.currentIndex === 0 ? 'disabled style="opacity: 0.4"' : ''}>
              <i data-lucide="chevron-left" class="w-4 h-4"></i> Geri
            </button>
            <button id="clear-canvas-btn" class="py-2.5 px-3.5 rounded-xl bg-slate-800/90 hover:bg-rose-900/40 text-slate-300 hover:text-rose-300 font-medium text-xs border border-slate-700 hover:border-rose-500/50 transition flex items-center gap-1.5 shadow-sm">
              <i data-lucide="eraser" class="w-3.5 h-3.5"></i> Temizle
            </button>
          </div>

          <!-- Sağ Butonlar: İpucu, Kontrol Et, İleri -->
          <div class="flex items-center gap-1.5 sm:gap-2">
            <button id="hw-hint-btn" class="py-2.5 px-3 rounded-xl bg-slate-800/90 hover:bg-amber-900/40 text-amber-300 font-medium text-xs border border-slate-700 hover:border-amber-500/50 transition flex items-center gap-1 shadow-sm" title="İlk harf ipucu">
              <i data-lucide="lightbulb" class="w-3.5 h-3.5"></i> İpucu
            </button>
            <button id="ocr-check-btn" class="py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-cyan-500/25 transition transform active:scale-95 flex items-center gap-1.5">
              <i data-lucide="check-circle-2" class="w-4 h-4"></i> Kontrol Et
            </button>
            <button id="hw-nav-next-btn" class="py-2.5 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs border border-slate-700 transition flex items-center gap-1 shadow-sm" ${this.currentIndex === this.words.length - 1 ? 'disabled style="opacity: 0.4"' : ''}>
              İleri <i data-lucide="chevron-right" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <!-- Tanınan Metin Geri Bildirim Kutusu -->
        <div id="ocr-result-badge" class="w-full mt-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-center text-xs text-slate-400 min-h-[42px] flex items-center justify-center">
          <span>Yazınızı tahtaya yazdıktan sonra "Kontrol Et" butonuna basınız.</span>
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

    // Gerçek ekrandaki CSS boyutlarını al
    const rect = this.canvas.getBoundingClientRect();

    // Çizim koordinatları ile canvas iç çözünürlüğünü 1:1 tam eşle (kaymayı önle)
    this.canvas.width = Math.round(rect.width);
    this.canvas.height = Math.round(rect.height);

    this.ctx = this.canvas.getContext('2d');

    // Modern akıllı tahta arka planı oluştur (Hafif koyu mat slate zemin)
    this.clearCanvas();

    // Kalem / Fırça Özellikleri: Canlı neon cyan rengi, 3.5px pürüzsüz uç
    this.ctx.strokeStyle = '#38bdf8'; // Parlak neon cyan
    this.ctx.lineWidth = 3.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.isDrawing = false;
    this.hasDrawn = false;
    this.points = [];
  }

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Koyu mat tahta arka planı (#0f172a)
    this.ctx.fillStyle = '#0f172a';
    this.ctx.fillRect(0, 0, width, height);

    // İnce Kılavuz Izgarası (Defter/Tablet Çizgileri)
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    this.ctx.lineWidth = 1;
    const step = 32;
    for (let y = step; y < height; y += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(12, y);
      this.ctx.lineTo(width - 12, y);
      this.ctx.stroke();
    }
    this.ctx.restore();

    this.hasDrawn = false;
    this.points = [];
  }

  bindEvents(word) {
    if (!this.canvas) return;

    const clearBtn = document.getElementById('clear-canvas-btn');
    const checkBtn = document.getElementById('ocr-check-btn');
    const prevBtn = document.getElementById('hw-nav-prev-btn');
    const nextBtn = document.getElementById('hw-nav-next-btn');
    const hintBtn = document.getElementById('hw-hint-btn');

    // 1. Kesin Koordinat Hizalaması Formülü (Exact Canvas Mapping):
    // const rect = canvas.getBoundingClientRect();
    // const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    // const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
      return { x, y };
    };

    // 2. Sıfır Gecikmeli ve İkinci Derece Bezier Eğrisi (quadraticCurveTo) ile Akıcı Çizim
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.isProcessing) return;
      this.isDrawing = true;
      this.hasDrawn = true;
      this.canvas.setPointerCapture(e.pointerId);

      const pos = getPos(e);
      this.points = [pos];

      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
      this.ctx.fillStyle = this.ctx.strokeStyle;
      this.ctx.fill();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDrawing || this.isProcessing) return;
      const pos = getPos(e);
      this.points.push(pos);

      if (this.points.length >= 3) {
        const p1 = this.points[this.points.length - 2];
        const p2 = this.points[this.points.length - 1];
        const midPoint = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2
        };

        this.ctx.beginPath();
        this.ctx.moveTo(this.points[this.points.length - 3].x, this.points[this.points.length - 3].y);
        this.ctx.quadraticCurveTo(p1.x, p1.y, midPoint.x, midPoint.y);
        this.ctx.stroke();
      } else if (this.points.length === 2) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.points[0].x, this.points[0].y);
        this.ctx.lineTo(this.points[1].x, this.points[1].y);
        this.ctx.stroke();
      }
    });

    const stopDrawing = (e) => {
      if (this.isDrawing) {
        this.isDrawing = false;
        this.points = [];
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
        if (badge) badge.innerHTML = `<span>Tahta temizlendi. Kelimeyi tekrar yazabilirsiniz.</span>`;
      });
    }

    if (hintBtn) {
      hintBtn.addEventListener('click', () => {
        const firstLetter = word.en.charAt(0).toUpperCase();
        showToast(`İpucu: Kelime "${firstLetter}" harfi ile başlıyor (${word.en.length} harf).`, 'info');
        AudioService.playSfx('click');
      });
    }

    if (prevBtn && this.currentIndex > 0) {
      prevBtn.addEventListener('click', () => {
        this.currentIndex--;
        AudioService.playSfx('click');
        this.render();
      });
    }

    if (nextBtn && this.currentIndex < this.words.length - 1) {
      nextBtn.addEventListener('click', () => {
        this.currentIndex++;
        AudioService.playSfx('click');
        this.render();
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
// MODÜL 7: ADAM ASMACA (HANGMAN) — GELİŞMİŞ SÜRÜM
//  * Havuz: veritabanından yalnızca ^[a-zA-Z]{3,10}$ (tek kelime, boşluksuz)
//    + "Sadece Seçtiğin Kelimelerle Çalış" filtresi
//  * Kademeli SVG adam asmaca çizimi (sehpa, kafa, gövde, kollar, bacaklar)
//  * Sanal QWERTY + fiziksel klavye (keydown) desteği; doğru=yeşil, yanlış=kırmızı
//  * Kelime telaffuzu için güvenli speechSynthesis butonu (🔊)
//  * Yanlış/kaybedilen kelimeler otomatik "Zorlu Kelimeler" listesine işlenir
// ============================================================================
class HangmanGame {
  constructor() {
    this.maxLives = 6;
    this.words = getHangmanPool();
    this.allWords = this.words;
    this.currentIndex = 0;
    this.score = 0;
    this.totalSolved = 0;
    this.lives = this.maxLives;
    this.guessedLetters = new Set();
    this.isRevealed = false;
    this.keyboardHandler = null;
  }

  init() {
    setGameHeader('Adam Asmaca', 'Can hakların tükenmeden önce harfleri seçerek kelimeyi tahmin et');
    const livesContainer = document.getElementById('game-lives-container');
    if (livesContainer) livesContainer.classList.remove('hidden');

    if (!this.words || this.words.length === 0) {
      this.renderNoWords();
      return;
    }

    this.keyboardHandler = (e) => this.onPhysicalKey(e);
    window.addEventListener('keydown', this.keyboardHandler);

    this.loadWord();
  }

  renderNoWords() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="alert-triangle" class="w-8 h-8"></i>
        </div>
        <h3 class="text-xl font-bold font-display text-white mb-2">Uygun Kelime Yok</h3>
        <p class="text-slate-300 text-sm mb-4">Adam Asmaca yalnızca 3-10 harfli, tek kelimelik (boşluk ve özel karakter içermeyen) İngilizce kelimelerle oynanır. Lütfen uygun kelime ekleyin.</p>
        <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition">Menüye Dön</button>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  }

  loadWord() {
    this.lives = this.maxLives;
    this.guessedLetters = new Set();
    this.isRevealed = false;
    this.render();
  }

  // Kademeli adam asmaca figürü (idam sehpası + kafa/gövde/kollar/bacaklar)
  buildHangmanSvg() {
    const l = this.lives; // 6 → hiç parça yok, 0 → tamamen asılmış
    const show = (maxLives) => l <= maxLives;
    return `
      <svg viewBox="0 0 120 120" class="w-full h-full" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <!-- İdam sehpası (her zaman görünür) -->
        <line x1="18" y1="110" x2="92" y2="110" stroke="#475569" stroke-width="4" />
        <line x1="38" y1="110" x2="38" y2="16" stroke="#475569" stroke-width="4" />
        <line x1="38" y1="16" x2="80" y2="16" stroke="#475569" stroke-width="4" />
        <line x1="80" y1="16" x2="80" y2="28" stroke="#94a3b8" stroke-width="3" />
        <!-- 1: Kafa -->
        ${show(5) ? '<circle cx="80" cy="38" r="10" stroke="#f43f5e" stroke-width="3" />' : ''}
        <!-- 2: Gövde -->
        ${show(4) ? '<line x1="80" y1="48" x2="80" y2="76" stroke="#f43f5e" stroke-width="3" />' : ''}
        <!-- 3: Sol kol -->
        ${show(3) ? '<line x1="80" y1="56" x2="66" y2="68" stroke="#f43f5e" stroke-width="3" />' : ''}
        <!-- 4: Sağ kol -->
        ${show(2) ? '<line x1="80" y1="56" x2="94" y2="68" stroke="#f43f5e" stroke-width="3" />' : ''}
        <!-- 5: Sol bacak -->
        ${show(1) ? '<line x1="80" y1="76" x2="68" y2="96" stroke="#f43f5e" stroke-width="3" />' : ''}
        <!-- 6: Sağ bacak -->
        ${show(0) ? '<line x1="80" y1="76" x2="92" y2="96" stroke="#f43f5e" stroke-width="3" />' : ''}
      </svg>`;
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

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
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-4 overflow-hidden">
          <div class="h-full bg-indigo-500 transition-all duration-300" style="width: ${((this.currentIndex + 1) / this.words.length) * 100}%"></div>
        </div>

        <!-- SVG Adam Asmaca Çizimi -->
        <div class="w-40 h-40 sm:w-48 sm:h-48 bg-slate-800/80 rounded-2xl border border-slate-700 flex items-center justify-center p-3 mb-3 shadow-inner ${isGameOver ? 'animate-shake' : ''}">
          ${this.buildHangmanSvg()}
        </div>

        <!-- Türkçe Anlam İpucu + Telaffuz -->
        <div class="text-center mb-4 flex flex-col items-center gap-1">
          <span class="text-xs uppercase tracking-widest text-indigo-400 font-semibold">Türkçe Anlamı</span>
          <div class="flex items-center gap-2">
            <h3 class="text-2xl font-bold text-white font-display mt-0.5">${escapeHtml(word.tr)}</h3>
            <button id="hang-speak-btn" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white border border-slate-700 transition" title="Kelimeyi Dinle">
              <i data-lucide="volume-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <!-- Kelime Boşlukları -->
        <div class="flex flex-wrap justify-center gap-2 mb-5">
          ${target.split('').map(ch => {
            if (ch === ' ') return `<span class="w-4"></span>`;
            const revealed = this.guessedLetters.has(ch) || isGameOver;
            const isMissed = isGameOver && !this.guessedLetters.has(ch);
            return `
              <div class="w-9 h-11 border-b-4 ${revealed ? (isMissed ? 'border-rose-500 text-rose-400' : 'border-indigo-400 text-white') : 'border-slate-600'} flex items-center justify-center font-display font-extrabold text-2xl uppercase transition">
                ${revealed ? escapeHtml(ch) : ''}
              </div>
            `;
          }).join('')}
        </div>

        <!-- Sanal QWERTY Klavye -->
        <div class="flex flex-col items-center gap-1.5 mb-4 w-full">
          ${this.buildKeyboardRows(isWordGuessed || isGameOver)}
        </div>

        <!-- Sonuç Durumu -->
        ${isWordGuessed && !isGameOver ? `
          <div class="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-center animate-pop w-full max-w-sm">
            <h4 class="text-emerald-400 font-bold font-display text-lg mb-1">Harika! Kelimeyi Buldun!</h4>
            <p class="text-xs text-slate-300 mb-3">+${20 + this.lives * 5} puan</p>
            <button id="hang-next-btn" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition">
              Sıradaki Kelime &rarr;
            </button>
          </div>
        ` : ''}

        ${isGameOver ? `
          <div class="p-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-center animate-shake w-full max-w-sm">
            <h4 class="text-rose-400 font-bold font-display text-lg mb-1">Canların Bitti!</h4>
            <p class="text-xs text-slate-300 mb-3">Doğru kelime: <strong class="text-white">${escapeHtml(word.en)}</strong> &bull; "Zorlu Kelimeler" listenize eklendi.</p>
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

  buildKeyboardRows(disabled) {
    const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    return rows.map(row => `
      <div class="flex justify-center gap-1 sm:gap-1.5">
        ${row.split('').map(letter => {
          const used = this.guessedLetters.has(letter);
          const isCorrect = used && this.words[this.currentIndex].en.toUpperCase().includes(letter);
          const isWrong = used && !isCorrect;
          let cls = 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700';
          if (isCorrect) cls = 'bg-emerald-600 text-white border-emerald-500';
          else if (isWrong) cls = 'bg-rose-600/80 text-rose-100 border-rose-500';
          else if (used) cls = 'bg-slate-800 text-slate-600 border-slate-700';
          return `
            <button class="hang-key-btn w-7 h-9 sm:w-9 sm:h-10 rounded-lg font-bold text-xs sm:text-sm uppercase transition ${cls} ${used ? 'pointer-events-none' : ''}" data-letter="${letter}" ${used ? 'disabled' : ''}>
              ${letter}
            </button>`;
        }).join('')}
      </div>
    `).join('');
  }

  bindEvents(word, target) {
    const nextBtn = document.getElementById('hang-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextWord());
    }

    const speakBtn = document.getElementById('hang-speak-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', () => AudioService.speak(word.en));
    }

    document.querySelectorAll('.hang-key-btn').forEach(btn => {
      btn.addEventListener('click', () => this.guess(btn.getAttribute('data-letter'), word, target));
    });
  }

  onPhysicalKey(e) {
    if (!this.words || this.words.length === 0) return;
    const word = this.words[this.currentIndex];
    if (!word) return;
    const target = word.en.toUpperCase();
    const isWordGuessed = target.split('').every(ch => ch === ' ' || this.guessedLetters.has(ch));
    if (isWordGuessed || this.lives <= 0) {
      if (e.key === 'Enter') this.nextWord();
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      this.guess(e.key.toUpperCase(), word, target);
    }
  }

  guess(letter, word, target) {
    if (!letter || this.guessedLetters.has(letter)) return;
    if (target.split('').every(ch => ch === ' ' || this.guessedLetters.has(ch)) || this.lives <= 0) return;

    this.guessedLetters.add(letter);
    if (target.includes(letter)) {
      AudioService.playSfx('correct');
    } else {
      this.lives--;
      AudioService.playSfx('wrong');
    }

    const isWordGuessed = target.split('').every(ch => ch === ' ' || this.guessedLetters.has(ch));
    if (isWordGuessed) {
      this.score += 20 + this.lives * 5;
      this.totalSolved++;
      WordStore.recordSuccess(word.id);
      AudioService.playSfx('win');
    } else if (this.lives <= 0) {
      // Yanlış bilinen / kaybedilen kelime otomatik "Zorlu Kelimeler"e işlenir
      WordStore.recordMistake(word.id, 'hangman');
    }

    this.render();
  }

  nextWord() {
    if (this.currentIndex < this.words.length - 1) {
      this.currentIndex++;
      this.loadWord();
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
        <p class="text-slate-300 text-sm mb-1">Adam Asmaca turunu tamamladınız.</p>
        <p class="text-slate-400 text-xs mb-4">Çözülen kelime: <span class="text-emerald-400 font-bold">${this.totalSolved}</span> / ${this.words.length} &bull; Skor: <span class="text-brand-400 font-bold font-mono text-xl">${this.score}</span></p>
        <div class="flex items-center justify-center gap-3">
          <button onclick="launchGame('hangman')" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition">Tekrar Oyna</button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  destroy() {
    if (this.keyboardHandler) {
      window.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }
    const livesContainer = document.getElementById('game-lives-container');
    if (livesContainer) livesContainer.classList.add('hidden');
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
// MODÜL 10: ZAMANA KARŞI (TIME ATTACK) — SÜRE SEÇİMLİ
//  * Oyun başında 30 / 60 / 90 / 120 saniye seçim ekranı
//  * Seçilen süreye göre dinamik geri sayım
//  * Süre bitince doğru/yanlış/skor özetli modern bitiş ekranı
// ============================================================================
class TimeAttackGame {
  constructor() {
    this.allWords = WordStore.getWords();
    this.words = shuffleArray(this.allWords);
    this.durations = [30, 60, 90, 120];
    this.duration = 60;
    this.timeLeft = 60;
    this.currentIndex = 0;
    this.score = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.timer = null;
    this.selectedDuration = null;
  }

  init() {
    setGameHeader('Zamana Karşı', 'Süreyi seç, olabildiğince çok kelime bil ve rekor kır!');
    const timerContainer = document.getElementById('game-timer-container');
    if (timerContainer) timerContainer.classList.add('hidden');
    this.renderDurationSelect();
  }

  // --- Süre Seçim Ekranı ---
  renderDurationSelect() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

    const descriptions = {
      30: 'Hızlı tur • Refleks testi',
      60: 'Klasik • Dengeli tempo',
      90: 'Uzun tur • Dayanıklılık',
      120: 'Maraton • Tam konsantrasyon'
    };

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center text-center animate-pop">
        <div class="w-16 h-16 rounded-2xl bg-red-500/20 text-red-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="timer" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-1">Süre Seç</h3>
        <p class="text-slate-400 text-sm mb-6">Kendine uygun tur süresini seçerek başla.</p>

        <div class="w-full grid grid-cols-2 gap-3 sm:gap-4">
          ${this.durations.map(sec => `
            <button class="time-attack-duration-btn group p-5 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-red-500/60 transition flex flex-col items-center gap-1 shadow-lg" data-duration="${sec}">
              <span class="text-3xl font-extrabold font-display text-white group-hover:text-red-300 transition">${sec}</span>
              <span class="text-xs font-semibold uppercase tracking-widest text-red-400">Saniye</span>
              <span class="text-[11px] text-slate-400 mt-1">${descriptions[sec] || ''}</span>
            </button>
          `).join('')}
        </div>

        <button onclick="closeGame()" class="mt-6 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition">Menüye Dön</button>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    stage.querySelectorAll('.time-attack-duration-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = parseInt(btn.getAttribute('data-duration'), 10);
        AudioService.playSfx('click');
        this.startRound(sec);
      });
    });
  }

  // --- Seçilen Süre ile Turu Başlat ---
  startRound(seconds) {
    this.duration = seconds;
    this.timeLeft = seconds;
    this.selectedDuration = seconds;
    this.currentIndex = 0;
    this.score = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.words = shuffleArray(this.allWords);
    this.currentIndex = 0;

    const timerContainer = document.getElementById('game-timer-container');
    if (timerContainer) timerContainer.classList.remove('hidden');
    const timerDisplay = document.getElementById('game-timer-display');
    if (timerDisplay) timerDisplay.textContent = this.timeLeft;

    this.startTimer();
    this.render();
  }

  startTimer() {
    if (this.timer) clearInterval(this.timer);
    const timerDisplay = document.getElementById('game-timer-display');
    this.timer = setInterval(() => {
      this.timeLeft--;
      if (timerDisplay) timerDisplay.textContent = this.timeLeft;
      const bar = document.getElementById('time-attack-bar');
      if (bar) bar.style.width = `${Math.max(0, (this.timeLeft / this.duration) * 100)}%`;
      const lbl = document.getElementById('time-attack-label');
      if (lbl) lbl.textContent = `${Math.max(0, this.timeLeft)}s`;

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this.timer = null;
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
        <!-- Süre Çubuğu -->
        <div class="w-full mb-4">
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="text-red-400 font-bold flex items-center gap-1"><i data-lucide="timer" class="w-3.5 h-3.5"></i> <span id="time-attack-label">${this.timeLeft}s</span></span>
            <span class="text-slate-400">Seri: <strong class="text-amber-400">x${this.combo}</strong></span>
          </div>
          <div class="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-red-500/20">
            <div id="time-attack-bar" class="h-full bg-gradient-to-r from-red-500 to-amber-500 transition-all duration-1000 ease-linear" style="width: ${Math.max(0, (this.timeLeft / this.duration) * 100)}%"></div>
          </div>
        </div>

        <!-- Hızlı Soru Kartı -->
        <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-6 text-center shadow-xl mb-5">
          <span class="text-xs uppercase tracking-widest text-red-400 font-semibold mb-1 block">Türkçe Karşılığı Nedir?</span>
          <h2 class="text-4xl font-extrabold text-white mb-1 font-display">${escapeHtml(currentWord.en)}</h2>
          <p class="text-xs font-mono text-slate-400">${currentWord.ipa ? `[${escapeHtml(currentWord.ipa)}]` : ''}</p>
        </div>

        <!-- 4 Şık Grid -->
        <div class="w-full grid grid-cols-2 gap-3" id="speed-options-container">
          ${options.map(opt => `
            <button class="game-option-btn py-3 text-sm" data-correct="${opt.isCorrect}">
              <span>${escapeHtml(opt.text)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
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
          this.combo++;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          const bonus = Math.min(5, this.combo) * 2;
          this.score += 10 + bonus;
          this.correctCount++;
          AudioService.playSfx('correct');
          WordStore.recordSuccess(currentWord.id);
        } else {
          btn.classList.add('wrong');
          this.combo = 0;
          this.score = Math.max(0, this.score - 5);
          this.wrongCount++;
          AudioService.playSfx('wrong');
          WordStore.recordMistake(currentWord.id, 'time-attack');
          optionButtons.forEach(b => {
            if (b.getAttribute('data-correct') === 'true') b.classList.add('correct');
          });
        }

        setTimeout(() => {
          this.currentIndex++;
          this.render();
        }, 320);
      });
    });
  }

  renderGameOver() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

    const total = this.correctCount + this.wrongCount;
    const accuracy = total > 0 ? Math.round((this.correctCount / total) * 100) : 0;

    stage.innerHTML = `
      <div class="text-center p-6 max-w-lg mx-auto animate-pop">
        <div class="w-16 h-16 rounded-2xl bg-red-500/20 text-red-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="timer-off" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-1">Süre Doldu!</h3>
        <p class="text-slate-400 text-sm mb-5">${this.duration} saniyelik tur tamamlandı.</p>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">Skor</span>
            <span class="text-2xl font-mono font-bold text-white">${this.score}</span>
          </div>
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">Doğru</span>
            <span class="text-2xl font-mono font-bold text-emerald-400">${this.correctCount}</span>
          </div>
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">Yanlış</span>
            <span class="text-2xl font-mono font-bold text-rose-400">${this.wrongCount}</span>
          </div>
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">En Uzun Seri</span>
            <span class="text-2xl font-mono font-bold text-amber-400">x${this.maxCombo}</span>
          </div>
        </div>

        <p class="text-sm text-slate-300 mb-6">Başarı oranı: <span class="text-white font-bold">%${accuracy}</span> &bull; Ortalama hız: <span class="text-white font-bold">${total > 0 ? (this.duration / total).toFixed(1) : '-'}</span> sn/kelime</p>

        <div class="flex items-center justify-center gap-3 flex-wrap">
          <button id="ta-replay-btn" class="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition flex items-center gap-1.5">
            <i data-lucide="rotate-ccw" class="w-4 h-4"></i> Tekrar Dene
          </button>
          <button id="ta-change-duration-btn" class="px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition flex items-center gap-1.5">
            <i data-lucide="timer" class="w-4 h-4"></i> Süre Değiştir
          </button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    const replay = document.getElementById('ta-replay-btn');
    if (replay) replay.addEventListener('click', () => { AudioService.playSfx('click'); this.startRound(this.duration); });
    const changeDur = document.getElementById('ta-change-duration-btn');
    if (changeDur) changeDur.addEventListener('click', () => {
      AudioService.playSfx('click');
      const timerContainer = document.getElementById('game-timer-container');
      if (timerContainer) timerContainer.classList.add('hidden');
      this.renderDurationSelect();
    });
  }

  destroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const timerContainer = document.getElementById('game-timer-container');
    if (timerContainer) timerContainer.classList.add('hidden');
  }
}



GAMES['pronunciation'] = PronunciationGame;
GAMES['time-attack'] = TimeAttackGame;

// ============================================================================
// MODÜL 12: KELİME BOMBASI (BAĞIMSIZ MODÜL — eski Ekstra Oyunlar Odası'ndan çıkarıldı)
//  * Animasyonlu fitilli bomba + kelime zorluğuna göre dinamik azalan süre çubuğu
//  * Türkçe anlam ipucu, karışık (scrambled) harf butonları
//  * Tıklama veya klavye ile harfleri doğru sıraya diz → bomba etkisiz (yeşil onay),
//    skor artar, yeni kelimeye geçilir
//  * Süre biterse patlama efekti, can azalır ve doğru kelime gösterilir
//  * Yanlış yapılan kelimeler otomatik "Zorlu Kelimeler" listesine kaydedilir
// ============================================================================
class WordBombGame {
  constructor() {
    this.words = getWordBombPool();
    this.pool = this.words.slice();
    this.queue = shuffleArray(this.pool);
    this.maxLives = 3;
    this.lives = this.maxLives;
    this.score = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.fuseTimer = null;
    this.target = null;
    this.letters = [];
    this.scrambled = [];
    this.selected = [];
    this.duration = 15;
    this.remaining = 15;
    this.finished = false;
    this.isExploding = false;
    this.keyboardHandler = null;
  }

  init() {
    setGameHeader('Kelime Bombası', 'Fitil bitmeden harfleri doğru sıraya diz!');
    const livesContainer = document.getElementById('game-lives-container');
    if (livesContainer) livesContainer.classList.remove('hidden');
    const livesDisplay = document.getElementById('game-lives-display');
    if (livesDisplay) livesDisplay.textContent = this.lives;

    if (!this.words || this.words.length === 0) {
      this.renderNoWords();
      return;
    }

    this.keyboardHandler = (e) => this.onPhysicalKey(e);
    window.addEventListener('keydown', this.keyboardHandler);

    this.newBomb();
  }

  renderNoWords() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="alert-triangle" class="w-8 h-8"></i>
        </div>
        <h3 class="text-xl font-bold font-display text-white mb-2">Uygun Kelime Yok</h3>
        <p class="text-slate-300 text-sm mb-4">Kelime Bombası yalnızca 3-10 harfli, tek kelimelik İngilizce kelimelerle oynanır. Lütfen uygun kelime ekleyin.</p>
        <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition">Menüye Dön</button>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  }

  nextFromDeck() {
    if (this.pool.length === 0) return null;
    if (this.queue.length === 0) this.queue = shuffleArray(this.pool);
    return this.queue.pop();
  }

  newBomb() {
    if (this.lives <= 0) { this.renderGameOver(); return; }
    const w = this.nextFromDeck();
    if (!w) { this.renderGameOver(); return; }

    this.target = w;
    this.letters = w.en.toUpperCase().split('');
    this.scrambled = shuffleArray(this.letters.map((ch, i) => ({ ch, idx: i })));
    this.selected = [];
    this.finished = false;
    this.isExploding = false;

    // Kelime uzunluğuna/zorluğuna göre dinamik süre (3 harf→12s ... 10 harf→20s)
    this.duration = Math.min(20, Math.max(12, this.letters.length * 2 + 6));
    this.remaining = this.duration;

    this.render();
    this.startFuse();
  }

  render() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

    updateGameScore(this.score);
    const livesDisplay = document.getElementById('game-lives-display');
    if (livesDisplay) livesDisplay.textContent = this.lives;

    const pct = Math.max(0, (this.remaining / this.duration) * 100);
    const critical = this.remaining < this.duration * 0.35;

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center">
        <!-- Fitil: animasyonlu bomba + süre çubuğu -->
        <div class="flex items-center gap-3 mb-4 w-full">
          <div class="relative w-14 h-14 rounded-full bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center text-white shadow-lg shadow-rose-600/40 ${critical ? 'games-room-bomb-pulse' : ''}">
            <i data-lucide="bomb" class="w-8 h-8"></i>
            <span class="absolute -top-1 -right-1 text-base ${critical ? 'animate-ping' : ''}">🔥</span>
          </div>
          <div class="flex-grow">
            <span class="text-[11px] ${critical ? 'text-rose-400' : 'text-amber-400'} font-bold block mb-1">FİTİL (<span id="bomb-time-label">${Math.ceil(this.remaining)}</span>s)</span>
            <div class="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-rose-500/30">
              <div id="fuse-bar" class="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-200 ease-linear" style="width: ${pct}%;"></div>
            </div>
          </div>
        </div>

        <!-- Türkçe İpucu -->
        <div class="p-3 rounded-xl bg-slate-800 border border-slate-700 text-center mb-4 w-full">
          <span class="text-[11px] text-slate-400 font-medium">İmha İpucu (Türkçe)</span>
          <h3 class="text-xl font-extrabold text-white font-display">${escapeHtml(this.target.tr)}</h3>
          <p class="text-[11px] text-slate-500 mt-0.5">${this.letters.length} harfli kelime</p>
        </div>

        <!-- Hedef Kelime Slotları -->
        <div id="bomb-slots" class="flex gap-2 mb-4 min-h-[48px] p-2 bg-slate-900 rounded-xl border border-slate-800 w-full justify-center flex-wrap">
          ${this.letters.map((_, i) => {
            const sel = this.selected[i];
            return sel
              ? `<div class="games-room-slot games-room-slot-filled">${escapeHtml(sel.ch)}</div>`
              : `<div class="games-room-slot games-room-slot-empty">_</div>`;
          }).join('')}
        </div>

        <!-- Karışık Harf Butonları -->
        <div class="flex flex-wrap gap-2 justify-center mb-4">
          ${this.scrambled.map((s, i) => `
            <button class="games-room-letter ${s.used ? 'games-room-letter-used' : ''}" data-slot="${i}" ${s.used ? 'disabled' : ''}>${escapeHtml(s.ch)}</button>
          `).join('')}
        </div>

        <!-- Kontroller -->
        <div class="flex gap-3">
          <button id="bomb-undo" class="games-room-mini-btn"><i data-lucide="delete" class="w-3.5 h-3.5"></i> Geri Al</button>
          <button id="bomb-clear" class="games-room-mini-btn"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Temizle</button>
        </div>
      </div>`;

    if (window.lucide) window.lucide.createIcons();
    this.bind();
  }

  bind() {
    const stage = this.stage;
    if (!stage) return;
    stage.querySelectorAll('.games-room-letter[data-slot]').forEach(b =>
      b.addEventListener('click', () => this.pick(Number(b.getAttribute('data-slot')))));
    const undo = document.getElementById('bomb-undo'); if (undo) undo.addEventListener('click', () => this.undo());
    const clear = document.getElementById('bomb-clear'); if (clear) clear.addEventListener('click', () => this.clear());
  }

  onPhysicalKey(e) {
    if (!this.target || this.finished || this.lives <= 0) return;
    if (e.key === 'Backspace') { e.preventDefault(); this.undo(); }
    else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); this.pickLetter(e.key.toUpperCase()); }
  }

  pick(slot) {
    if (this.finished || this.isExploding) return;
    const item = this.scrambled[slot];
    if (!item || item.used) return;
    item.used = true;
    this.selected.push({ ch: item.ch, srcIdx: slot });
    AudioService.playSfx('click');
    if (this.selected.length === this.letters.length) { this.check(); return; }
    this.render();
  }

  pickLetter(letter) {
    const idx = this.scrambled.findIndex(s => !s.used && s.ch === letter);
    if (idx > -1) this.pick(idx);
  }

  undo() {
    if (this.finished || this.isExploding || this.selected.length === 0) return;
    const last = this.selected.pop();
    if (last && last.srcIdx != null) this.scrambled[last.srcIdx].used = false;
    this.render();
  }

  clear() {
    if (this.finished || this.isExploding) return;
    this.selected.forEach(s => { if (s.srcIdx != null) this.scrambled[s.srcIdx].used = false; });
    this.selected = [];
    this.render();
  }

  check() {
    const typed = this.selected.map(s => s.ch).join('');
    const answer = this.letters.join('');
    if (typed === answer) {
      this.finished = true;
      this.stopFuse();
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += 20 + Math.round(this.remaining * 2) + (Math.min(5, this.combo) * 5);
      this.correctCount++;
      WordStore.recordSuccess(this.target.id);
      AudioService.playSfx('win');
      showToast('BOMBA İMHA EDİLDİ! 💥', 'success');

      // Yeşil onay efekti
      const slots = document.getElementById('bomb-slots');
      if (slots) {
        slots.classList.add('games-room-flash-green');
        slots.querySelectorAll('.games-room-slot').forEach(s => s.classList.add('games-room-slot-ok'));
      }
      setTimeout(() => this.newBomb(), 900);
    } else {
      this.combo = 0;
      this.wrongCount++;
      AudioService.playSfx('wrong');
      showToast('Yanlış sıralama!', 'warning');
      setTimeout(() => { if (!this.finished && !this.isExploding) this.clear(); }, 500);
    }
  }

  startFuse() {
    this.stopFuse();
    this.fuseTimer = setInterval(() => {
      if (this.finished || this.isExploding || this.lives <= 0) return;
      this.remaining -= 0.2;
      const pct = Math.max(0, (this.remaining / this.duration) * 100);
      const b = document.getElementById('fuse-bar');
      if (b) b.style.width = `${pct}%`;
      const lbl = document.getElementById('bomb-time-label');
      if (lbl) lbl.textContent = Math.ceil(Math.max(0, this.remaining));
      if (this.remaining <= 0) { this.explode(); }
    }, 200);
  }

  stopFuse() {
    if (this.fuseTimer) { clearInterval(this.fuseTimer); this.fuseTimer = null; }
  }

  // Süre bitti → patlama efekti, can azalır, doğru kelime gösterilir
  explode() {
    if (this.isExploding) return;
    this.isExploding = true;
    this.stopFuse();
    this.lives--;
    this.combo = 0;
    this.wrongCount++;
    WordStore.recordMistake(this.target.id, 'word-bomb');
    AudioService.playSfx('wrong');
    const livesDisplay = document.getElementById('game-lives-display');
    if (livesDisplay) livesDisplay.textContent = this.lives;

    const stage = this.stage;
    if (stage) {
      stage.classList.add('games-room-shake');
      setTimeout(() => stage.classList.remove('games-room-shake'), 500);
      stage.innerHTML = `
        <div class="w-full max-w-md flex flex-col items-center text-center animate-pop">
          <div class="w-20 h-20 rounded-full bg-rose-600 flex items-center justify-center text-white mb-4 shadow-2xl shadow-rose-600/60 games-room-bomb-pulse">
            <i data-lucide="flame" class="w-10 h-10"></i>
          </div>
          <h3 class="text-2xl font-extrabold font-display text-rose-400 mb-1">💥 BOMBA PATLADI!</h3>
          <p class="text-slate-300 text-sm mb-1">Doğru kelime:</p>
          <p class="text-3xl font-extrabold font-display text-white mb-1">${escapeHtml(this.target.en)}</p>
          <p class="text-slate-400 text-sm mb-4">${escapeHtml(this.target.tr)}</p>
          <p class="text-xs text-amber-300 mb-5">Bu kelime "Zorlu Kelimeler" listenize eklendi. Kalan can: <strong class="text-white">${this.lives}</strong></p>
          <button id="bomb-continue-btn" class="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition">
            ${this.lives > 0 ? 'Sıradaki Kelime' : 'Sonucu Gör'} &rarr;
          </button>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
      const cont = document.getElementById('bomb-continue-btn');
      if (cont) cont.addEventListener('click', () => { AudioService.playSfx('click'); this.newBomb(); });
    }
  }

  renderGameOver() {
    this.stopFuse();
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    const total = this.correctCount + this.wrongCount;
    const accuracy = total > 0 ? Math.round((this.correctCount / total) * 100) : 0;
    const best = Number(localStorage.getItem('wordbomb_best_v1') || 0);
    const isNewBest = this.score > best;
    if (isNewBest) { try { localStorage.setItem('wordbomb_best_v1', String(this.score)); } catch (e) {} }

    stage.innerHTML = `
      <div class="text-center p-6 max-w-lg mx-auto animate-pop">
        <div class="w-16 h-16 rounded-2xl ${isNewBest ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'} mx-auto flex items-center justify-center mb-4">
          <i data-lucide="${isNewBest ? 'award' : 'bomb'}" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-1">Oyun Bitti!</h3>
        <p class="text-slate-400 text-sm mb-5">Tüm canların tükendi.</p>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">Skor</span>
            <span class="text-2xl font-mono font-bold text-white">${this.score}</span>
            ${isNewBest ? '<span class="text-[10px] font-bold text-amber-400">YENİ REKOR!</span>' : ''}
          </div>
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">İmha Edilen</span>
            <span class="text-2xl font-mono font-bold text-emerald-400">${this.correctCount}</span>
          </div>
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">Patlama</span>
            <span class="text-2xl font-mono font-bold text-rose-400">${this.wrongCount}</span>
          </div>
          <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
            <span class="text-[11px] uppercase text-slate-400 font-semibold block">En Uzun Seri</span>
            <span class="text-2xl font-mono font-bold text-amber-400">x${this.maxCombo}</span>
          </div>
        </div>
        <p class="text-sm text-slate-300 mb-6">Başarı oranı: <span class="text-white font-bold">%${accuracy}</span></p>

        <div class="flex items-center justify-center gap-3 flex-wrap">
          <button onclick="launchGame('word-bomb')" class="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition flex items-center gap-1.5">
            <i data-lucide="rotate-ccw" class="w-4 h-4"></i> Tekrar Oyna
          </button>
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition border border-slate-700">Menüye Dön</button>
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  }

  get stage() { return document.getElementById('game-stage'); }

  destroy() {
    this.stopFuse();
    if (this.keyboardHandler) {
      window.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }
    const livesContainer = document.getElementById('game-lives-container');
    if (livesContainer) livesContainer.classList.add('hidden');
  }
}

GAMES['word-bomb'] = WordBombGame;




// ============================================================================
// MODÜL: KOLAYDAN ZORA (KELİME KARTLARI + 5 ŞIKLI SEVİYE TESTİ)
// ============================================================================
class StepByStepLessonsGame {
  constructor() {
    this.LESSON_SIZE = 10;
    this.TOTAL_LEVELS = 5;
    this.STORAGE_PREFIX = 'wordplay_lessons_v2';
    this.currentLevel = 1;
    this.activeStage = 'cards'; // 'cards' | 'quiz'
    this.lessonData = null;
    this.sessionMeta = null;
    this.cardIndex = 0;
    this.isFlipped = false;
    this.knownCount = 0;
    this.quizIndex = 0;
    this.score = 0;
    this.wrongWords = [];
    this.isLoading = false;
    this.serverCompletedIds = [];
    this.localCompleted = [];
  }

  get storageKey() {
    const uid = AuthStore.user ? AuthStore.user.id : 'guest';
    return `${this.STORAGE_PREFIX}_${uid}`;
  }

  get userId() {
    return AuthStore.user ? AuthStore.user.id : null;
  }

  // ---------------------------------------------------------------------
  // localStorage tabanlı çevrimdışı/yedek ilerleme takibi
  // ---------------------------------------------------------------------
  loadLocalProgress() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        const completed = Array.isArray(parsed.completed)
          ? parsed.completed.map(w => String(w).toLowerCase())
          : [];
        return { level: Math.min(Math.max(1, parsed.level || 1), this.TOTAL_LEVELS), completed };
      }
    } catch (e) {
      console.warn('Ders ilerlemesi okunamadı:', e);
    }
    return { level: 1, completed: [] };
  }

  saveLocalProgress() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        level: this.currentLevel,
        completed: this.localCompleted || [],
        updatedAt: Date.now()
      }));
    } catch (e) {
      console.warn('Ders ilerlemesi kaydedilemedi:', e);
    }
  }

  updateLevelBadge(level) {
    const badge = document.getElementById('user-current-level-badge');
    if (badge) badge.textContent = `Seviye ${level}`;
  }

  // ---------------------------------------------------------------------
  // Başlatma
  // ---------------------------------------------------------------------
  async init() {
    setGameHeader('Kolaydan Zora', 'Kelime kartlarıyla öğren, 5 şıklı testle seviye atla');
    const local = this.loadLocalProgress();
    this.currentLevel = local.level || 1;
    this.localCompleted = local.completed || [];
    this.updateLevelBadge(this.currentLevel);
    await this.loadLevel(this.currentLevel);
  }

  renderLoading(message) {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="flex flex-col items-center justify-center p-8 space-y-3 text-center">
        <div class="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-white font-bold text-sm tracking-wide">${message || 'Ders Hazırlanıyor...'}</span>
        <span class="text-xs text-slate-400">Kelime havuzu analiz ediliyor ve 5 seviye oluşturuluyor</span>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  renderError(title, message, options = {}) {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    const icon = options.icon || 'alert-triangle';
    const retryBtn = options.retry === false
      ? ''
      : `<button id="lesson-error-retry" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition">Tekrar Dene</button>`;
    stage.innerHTML = `
      <div class="text-center p-8 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="${icon}" class="w-8 h-8"></i>
        </div>
        <h3 class="text-xl font-bold font-display text-white mb-2">${title}</h3>
        <p class="text-slate-400 text-sm mb-6">${message}</p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
          ${retryBtn}
          <button onclick="closeGame()" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition">Menüye Dön</button>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    const retry = document.getElementById('lesson-error-retry');
    if (retry) retry.addEventListener('click', () => this.loadLevel(this.currentLevel));
  }

  // ---------------------------------------------------------------------
  // Sunucudan dinamik seviye yükleme
  // ---------------------------------------------------------------------
  async loadLevel(levelNum) {
    this.isLoading = true;
    this.renderLoading(`Seviye ${levelNum} Hazırlanıyor...`);

    if (!this.userId) {
      this.isLoading = false;
      this.renderError('Oturum Gerekli', 'Derslere erişmek için lütfen giriş yapın.', { retry: false, icon: 'lock' });
      return;
    }

    const isStudyOnly = WordStore.useOnlyStudyList;
    let data = null;
    try {
      const resp = await fetch(`/api/lessons?user_id=${this.userId}&level=${levelNum}&study_only=${isStudyOnly}`);
      if (!resp.ok) throw new Error(`Sunucu hatası (${resp.status})`);
      data = await resp.json();
    } catch (err) {
      console.warn('Lesson fetch error:', err);
      this.isLoading = false;
      this.renderError('Bağlantı Hatası', 'Ders yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.');
      return;
    }

    this.isLoading = false;

    if (!data || data.success !== true) {
      this.renderError('Ders Yüklenemedi', (data && data.error) || 'Sunucu geçerli bir yanıt vermedi.');
      return;
    }

    if (Array.isArray(data.completed_word_ids)) {
      this.serverCompletedIds = data.completed_word_ids.map(w => String(w).toLowerCase());
    }

    if (!data.lesson) {
      this.renderError(
        'Yeterli Kelime Yok',
        data.error || 'Kolaydan Zora modu için kelime havuzunuza kelime eklemelisiniz.',
        { retry: false }
      );
      return;
    }

    this.lessonData = data.lesson;
    this.sessionMeta = data;
    this.currentLevel = data.lesson.level_number || levelNum;
    this.activeStage = 'cards';
    this.cardIndex = 0;
    this.isFlipped = false;
    this.knownCount = 0;
    this.quizIndex = 0;
    this.score = 0;
    this.wrongWords = [];
    this.updateLevelBadge(this.currentLevel);

    if (data.pool_reset) {
      showToast('Bu seviyedeki tüm kelimeleri tamamladınız, yeni tur başlatılıyor! 🔄', 'success');
    }
    if (data.warning) {
      showToast(data.warning, 'warning');
    }

    this.renderCardsStage();
  }

  // ---------------------------------------------------------------------
  // AŞAMA 1: "KELİME KARTLARI" TARZI TEKLİ KART ARAYÜZÜ
  // ---------------------------------------------------------------------
  renderCardsStage() {
    const stage = document.getElementById('game-stage');
    if (!stage || !this.lessonData) return;

    const wordsList = this.lessonData.words_data || [];
    if (wordsList.length === 0) {
      this.renderError('Kelime Yok', 'Bu seviye için kart oluşturulamadı.');
      return;
    }

    const word = wordsList[this.cardIndex];
    const total = wordsList.length;
    const meta = this.sessionMeta || {};
    const isStudyListed = WordStore.isInStudyList(word.english);
    updateGameScore(this.knownCount);

    stage.innerHTML = `
      <div class="w-full max-w-lg flex flex-col items-center pb-6">
        <!-- Seviye Bilgisi & İlerleme Çubuğu -->
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
          <span class="font-semibold text-emerald-400">Seviye ${this.currentLevel} / ${this.TOTAL_LEVELS} • Kart ${this.cardIndex + 1} / ${total}</span>
          <span>Öğrenilen: <strong class="text-emerald-400 font-bold">${this.knownCount}</strong></span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-3 sm:mb-5 overflow-hidden">
          <div class="h-full bg-emerald-500 transition-all duration-300" style="width: ${((this.cardIndex + 1) / total) * 100}%"></div>
        </div>

        <!-- 3D Flip Kart -->
        <div class="flashcard-wrapper ${this.isFlipped ? 'flipped' : ''}" id="lesson-card-element">
          <div class="flashcard-inner">
            <!-- Ön Yüz: İngilizce & Okunuş -->
            <div class="flashcard-face flashcard-front card-front flex flex-col justify-between items-center p-4 sm:p-6 w-full h-full relative">
              <div class="w-full flex items-center justify-between">
                <span class="text-xs uppercase tracking-widest text-emerald-400 font-bold">İngilizce</span>
                <button id="lesson-star-btn" class="p-1 rounded-lg sm:rounded-xl transition ${isStudyListed ? 'text-amber-400 bg-amber-500/20 border border-amber-500/40' : 'text-slate-500 hover:text-amber-400 bg-slate-800/80 border border-slate-700'}" title="Özel Listeye Ekle/Çıkar">
                  <i data-lucide="star" class="w-4 h-4 ${isStudyListed ? 'fill-amber-400' : ''}"></i>
                </button>
              </div>

              <div class="my-auto text-center py-1 sm:py-2">
                <h2 class="text-2xl sm:text-4xl font-extrabold text-white mb-1 font-display tracking-tight">${word.english}</h2>
                <p class="text-xs sm:text-base font-mono text-slate-400">${word.pronunciation ? `[${word.pronunciation}]` : ''}</p>
              </div>

              <div class="w-full pt-2 sm:pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <button id="lesson-listen-btn" class="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition flex items-center gap-1.5 font-medium" title="Sesli Oku">
                  <i data-lucide="volume-2" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400"></i> Dinle
                </button>
                <span class="flex items-center gap-1 text-[11px] sm:text-xs text-slate-400">
                  <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Çevirmek için tıkla
                </span>
              </div>
            </div>

            <!-- Arka Yüz: Türkçe Karşılığı + Örnek Cümle -->
            <div class="flashcard-face flashcard-back card-back flex flex-col justify-between items-center p-4 sm:p-6 w-full h-full relative" style="transform: rotateY(180deg); -webkit-transform: rotateY(180deg);">
              <div class="w-full flex items-center justify-between">
                <span class="text-xs uppercase tracking-widest text-blue-200 font-bold">Türkçe Karşılığı</span>
                <span class="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-200 border border-blue-400/30">Anlam</span>
              </div>

              <div class="my-auto text-center py-2 sm:py-3 px-2">
                <h2 class="text-lg sm:text-2xl font-extrabold text-white font-display leading-tight">${word.turkish}</h2>
                ${word.example_en ? `
                  <div class="mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t border-blue-400/20 text-left">
                    <p class="text-[11px] sm:text-sm text-blue-50 leading-relaxed">
                      <i data-lucide="quote" class="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-blue-200"></i>${word.example_en}
                    </p>
                    <p class="text-[10px] sm:text-xs text-blue-200/80 mt-1 italic">${word.example_tr || ''}</p>
                  </div>
                ` : ''}
              </div>

              <div class="w-full pt-2 sm:pt-3 border-t border-blue-400/20 flex items-center justify-between text-xs text-blue-100">
                <span class="flex items-center gap-1 text-[11px] sm:text-xs text-blue-200">
                  <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Geri çevir
                </span>
                <span class="text-[10px] sm:text-[11px] text-blue-200/80">Hafıza Kartı</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Alt Kontrol Butonları -->
        <div class="w-full flex items-center justify-between gap-1.5 sm:gap-3 mt-3 sm:mt-5">
          <button id="lesson-prev-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-medium transition border border-slate-700 flex items-center gap-1 shrink-0" ${this.cardIndex === 0 ? 'disabled style="opacity: 0.5"' : ''}>
            <i data-lucide="chevron-left" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i> Önceki
          </button>

          <div class="flex items-center gap-1.5 sm:gap-2">
            <button id="lesson-unknown-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs sm:text-sm font-medium transition flex items-center gap-1">
              <i data-lucide="x" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i> Zorlandım
            </button>
            <button id="lesson-known-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs sm:text-sm font-medium transition flex items-center gap-1">
              <i data-lucide="check" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i> Biliyorum
            </button>
          </div>

          <button id="lesson-next-btn" class="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-medium transition border border-slate-700 flex items-center gap-1 shrink-0" ${this.cardIndex === total - 1 ? 'disabled style="opacity: 0.5"' : ''}>
            Sonraki <i data-lucide="chevron-right" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i>
          </button>
        </div>

        ${this.cardIndex === total - 1 ? `
          <div class="w-full mt-4 sm:mt-5 flex justify-center">
            <button id="lesson-start-quiz-btn" class="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm sm:text-base shadow-xl shadow-emerald-600/30 transition transform active:scale-95 flex items-center justify-center gap-2 border border-emerald-400/40">
              <span>Tüm Kartlar Tamamlandı! Teste Geç</span>
              <i data-lucide="arrow-right" class="w-5 h-5"></i>
            </button>
          </div>
        ` : ''}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindCardEvents(word, total);
  }

  bindCardEvents(word, total) {
    const card = document.getElementById('lesson-card-element');
    const listenBtn = document.getElementById('lesson-listen-btn');
    const starBtn = document.getElementById('lesson-star-btn');
    const prevBtn = document.getElementById('lesson-prev-btn');
    const nextBtn = document.getElementById('lesson-next-btn');
    const knownBtn = document.getElementById('lesson-known-btn');
    const unknownBtn = document.getElementById('lesson-unknown-btn');
    const startQuizBtn = document.getElementById('lesson-start-quiz-btn');

    if (card) {
      card.addEventListener('click', (e) => {
        if (e.target.closest('#lesson-listen-btn') || e.target.closest('#lesson-star-btn')) return;
        this.isFlipped = !this.isFlipped;
        card.classList.toggle('flipped', this.isFlipped);
        AudioService.playSfx('click');
      });
    }

    if (starBtn) {
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleStudyListHandler(word.english);
        this.renderCardsStage();
      });
    }

    if (listenBtn) {
      listenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        AudioService.speak(word.english);
      });
    }

    if (prevBtn && this.cardIndex > 0) {
      prevBtn.addEventListener('click', () => {
        this.cardIndex--;
        this.isFlipped = false;
        AudioService.playSfx('click');
        this.renderCardsStage();
      });
    }

    if (nextBtn && this.cardIndex < total - 1) {
      nextBtn.addEventListener('click', () => {
        this.cardIndex++;
        this.isFlipped = false;
        AudioService.playSfx('click');
        this.renderCardsStage();
      });
    }

    if (knownBtn) {
      knownBtn.addEventListener('click', () => {
        const wid = this.currentCardWordId(word);
        if (wid !== null) WordStore.recordSuccess(wid);
        this.knownCount++;
        AudioService.playSfx('correct');
        this.advanceCard(total);
      });
    }

    if (unknownBtn) {
      unknownBtn.addEventListener('click', () => {
        const wid = this.currentCardWordId(word);
        if (wid !== null) WordStore.recordMistake(wid, 'lessons');
        AudioService.playSfx('wrong');
        showToast(`"${word.english}" zorlu kelimelere eklendi.`, 'warning');
        this.advanceCard(total);
      });
    }

    if (startQuizBtn) {
      startQuizBtn.addEventListener('click', () => {
        AudioService.playSfx('click');
        this.startQuiz();
      });
    }
  }

  currentCardWordId(word) {
    const all = WordStore.getAllWords();
    const found = all.find(w => w.en.toLowerCase() === String(word.english).toLowerCase());
    return found ? found.id : null;
  }

  advanceCard(total) {
    if (this.cardIndex < total - 1) {
      this.cardIndex++;
      this.isFlipped = false;
      this.renderCardsStage();
    } else {
      // Son karttayız: teste geçiş butonunu göster
      this.isFlipped = false;
      this.renderCardsStage();
      showToast('Tüm kartlar tamamlandı! Teste geçebilirsiniz. 🎯', 'success');
    }
  }

  startQuiz() {
    this.activeStage = 'quiz';
    this.quizIndex = 0;
    this.score = 0;
    this.wrongWords = [];
    this.renderQuizStage();
  }

  // ---------------------------------------------------------------------
  // AŞAMA 2: 5 ŞIKLI TEST
  // ---------------------------------------------------------------------
  renderQuizStage() {
    const stage = document.getElementById('game-stage');
    if (!stage || !this.lessonData) return;

    const quizList = this.lessonData.quiz_data || [];
    const currentQ = quizList[this.quizIndex];

    if (!currentQ) {
      this.renderQuizResults();
      return;
    }

    updateGameScore(this.score);

    stage.innerHTML = `
      <div class="w-full max-w-xl flex flex-col items-center">
        <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
          <span>Soru ${this.quizIndex + 1} / ${quizList.length} (Seviye ${this.currentLevel})</span>
          <span class="text-emerald-400 font-bold">Doğru: ${this.score}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-700 rounded-full mb-6 overflow-hidden">
          <div class="h-full bg-emerald-500 transition-all duration-300" style="width: ${((this.quizIndex + 1) / quizList.length) * 100}%"></div>
        </div>

        <div class="w-full bg-slate-800/90 border border-slate-700 rounded-2xl p-6 sm:p-8 text-center shadow-xl mb-6">
          <span class="text-xs uppercase tracking-widest text-emerald-400 font-semibold mb-3 block">
            Cümledeki Boşluğu Tamamlayın
          </span>
          <p class="text-lg sm:text-2xl font-bold text-white font-display leading-relaxed mb-4">
            ${currentQ.sentence}
          </p>
          <div class="inline-flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
            <span>Türkçe İpucu:</span>
            <strong class="text-emerald-300">${currentQ.turkish_meaning}</strong>
          </div>
        </div>

        <div class="w-full space-y-2.5 mb-6" id="five-choice-options-container">
          ${(currentQ.options || []).map(opt => `
            <button class="w-full p-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-white font-medium text-sm sm:text-base border border-slate-700 flex items-center justify-between transition five-choice-btn group shadow-sm" data-key="${opt.key}">
              <div class="flex items-center gap-3">
                <span class="w-7 h-7 rounded-lg bg-slate-700 text-xs font-mono font-bold flex items-center justify-center text-slate-300 group-hover:bg-emerald-600 group-hover:text-white transition uppercase">${opt.key}</span>
                <span class="text-slate-100 font-semibold">${opt.text}</span>
              </div>
              <i data-lucide="circle" class="w-4 h-4 text-slate-500 option-check-icon"></i>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindQuizEvents(currentQ, quizList);
  }

  bindQuizEvents(currentQ, quizList) {
    const optionBtns = document.querySelectorAll('.five-choice-btn');

    optionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        optionBtns.forEach(b => b.disabled = true);
        const selectedKey = btn.getAttribute('data-key');
        const isCorrect = selectedKey.toLowerCase() === String(currentQ.correct_answer).toLowerCase();

        if (isCorrect) {
          btn.classList.remove('bg-slate-800/80', 'border-slate-700');
          btn.classList.add('bg-emerald-600/30', 'border-emerald-500', 'text-emerald-300');
          this.score++;
          AudioService.playSfx('correct');
        } else {
          btn.classList.remove('bg-slate-800/80', 'border-slate-700');
          btn.classList.add('bg-rose-600/30', 'border-rose-500', 'text-rose-300');
          if (!this.wrongWords.map(w => w.toLowerCase()).includes(String(currentQ.target_word).toLowerCase())) {
            this.wrongWords.push(currentQ.target_word);
          }
          AudioService.playSfx('wrong');

          optionBtns.forEach(b => {
            if (b.getAttribute('data-key').toLowerCase() === String(currentQ.correct_answer).toLowerCase()) {
              b.classList.add('bg-emerald-600/30', 'border-emerald-500', 'text-emerald-300');
            }
          });
        }

        setTimeout(() => {
          if (this.quizIndex < quizList.length - 1) {
            this.quizIndex++;
            this.renderQuizStage();
          } else {
            this.renderQuizResults();
          }
        }, 1100);
      });
    });
  }

  // ---------------------------------------------------------------------
  // SONUÇ EKRANI (%80 eşiği + seviye geçiş döngüsü)
  // ---------------------------------------------------------------------
  async renderQuizResults() {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

    const totalQuestions = (this.lessonData && this.lessonData.quiz_data ? this.lessonData.quiz_data.length : 0) || this.LESSON_SIZE;
    const isPassed = totalQuestions > 0 && (this.score / totalQuestions) >= 0.8;
    const learnedThisLevel = (this.lessonData && this.lessonData.words_data)
      ? this.lessonData.words_data.map(w => w.english)
      : [];

    // --- Çevrimdışı (localStorage) kalıcı ilerleme ---
    this.localCompleted = this.localCompleted || [];
    if (isPassed) {
      const merged = new Set([...this.localCompleted, ...learnedThisLevel.map(w => w.toLowerCase())]);
      this.localCompleted = Array.from(merged);
    }
    this.saveLocalProgress();

    // --- Sunucuya ilerleme ve sonucu bildir (asenkron) ---
    let serverResult = null;
    try {
      const resp = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          user_id: this.userId,
          level_number: this.currentLevel,
          correct_count: this.score,
          total_questions: totalQuestions,
          wrong_words: this.wrongWords,
          completed_words: learnedThisLevel,
          study_only: WordStore.useOnlyStudyList === true
        })
      });
      if (resp.ok) serverResult = await resp.json();
    } catch (e) {
      console.warn('Lesson complete sync error:', e);
    }

    if (serverResult && Array.isArray(serverResult.completed_word_ids)) {
      this.serverCompletedIds = serverResult.completed_word_ids.map(w => String(w).toLowerCase());
    }

    // --- Yanlış cevaplanan kelimeleri genel "Zorlu Kelimeler" istatistiğine +1 işle ---
    if (this.wrongWords.length > 0) {
      if (typeof AuthStore.recordStatToBackend === 'function') {
        AuthStore.recordStatToBackend('lessons', 0, this.wrongWords);
      }
      this.wrongWords.forEach(w => {
        const word = WordStore.getAllWords().find(x => x.en.toLowerCase() === String(w).toLowerCase());
        if (word) word.wrongCount = (word.wrongCount || 0) + 1;
      });
    }

    if (isPassed) AudioService.playSfx('win');

    const allComplete = !!(serverResult && serverResult.all_levels_complete);
    const leveledUp = !!(serverResult && serverResult.leveled_up);
    const levelComplete = !!(serverResult && serverResult.level_complete);
    const serverNewLevel = (serverResult && serverResult.new_level) ? serverResult.new_level : this.currentLevel;
    const nextLevel = Math.min(this.currentLevel + 1, this.TOTAL_LEVELS);
    const isFinalLevel = this.currentLevel >= this.TOTAL_LEVELS;

    this.renderResultScreen({
      isPassed,
      allComplete,
      leveledUp,
      levelComplete,
      serverNewLevel,
      isFinalLevel,
      nextLevel,
      totalQuestions,
      serverResult
    });
  }

  renderResultScreen({ isPassed, allComplete, leveledUp, levelComplete, serverNewLevel, isFinalLevel, nextLevel, totalQuestions, serverResult }) {
    const stage = document.getElementById('game-stage');
    if (!stage) return;

    // Seviye yalnızca sunucu "seviye tamamlandı" dediğinde (leveled_up) yükselir;
    // yükselme otomatiktir, kullanıcı aynı akışla sonraki 10 kelimeye devam eder.
    if (leveledUp && serverNewLevel) {
      this.currentLevel = serverNewLevel;
      this.updateLevelBadge(this.currentLevel);
      this.saveLocalProgress();
    }

    const showRestart = allComplete;
    const showNext = isPassed && !allComplete;

    const icon = isPassed ? 'trophy' : 'alert-circle';
    const title = allComplete
      ? 'İnanılmaz! Tüm Seviyeleri Tamamladınız!'
      : (isPassed ? 'Tebrikler! Seviyeyi Geçtiniz!' : 'Tekrar Deneyin!');

    let infoLine = `${totalQuestions} sorudan <strong class="${isPassed ? 'text-emerald-400' : 'text-rose-400'} font-bold font-mono text-base">${this.score} doğru</strong> yaptınız. `;
    if (!isPassed) {
      infoLine += 'Seviyeyi geçmek için en az %80 (8/10) başarı gereklidir.';
    } else if (allComplete) {
      infoLine += 'Tüm 5 seviyeyi başarıyla bitirdiniz. İsterseniz yeni bir tur başlatabilirsiniz.';
    } else if (leveledUp) {
      infoLine += `Seviye tamamlandı, Seviye ${serverNewLevel} kilidi açıldı!`;
    } else if (isFinalLevel) {
      infoLine += 'Seviye 5 tamamlandı! Aşağıdan istediğiniz seviyeyi seçip tekrar edebilirsiniz.';
    } else {
      infoLine += 'Harika! Bu seviyede öğrenilecek yeni kelimeler var.';
    }

    stage.innerHTML = `
      <div class="text-center p-6 max-w-md animate-pop">
        <div class="w-16 h-16 rounded-2xl ${isPassed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'} mx-auto flex items-center justify-center mb-4">
          <i data-lucide="${icon}" class="w-8 h-8"></i>
        </div>
        <h3 class="text-2xl font-bold font-display text-white mb-2">${title}</h3>
        <p class="text-slate-300 text-sm mb-4">${infoLine}</p>

        ${this.wrongWords.length > 0 ? `
          <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 mb-6 text-left">
            <strong>Zorlu Kelimelere Eklendi:</strong> ${this.wrongWords.join(', ')}
          </div>
        ` : ''}

        <!-- Seviye seçici (1..5) -->
        <div class="mb-6">
          <p class="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Seviye Seç</p>
          <div class="flex items-center justify-center gap-1.5 flex-wrap" id="lesson-level-selector">
            ${Array.from({ length: this.TOTAL_LEVELS }, (_, i) => i + 1).map(lv => `
              <button data-level="${lv}" class="lesson-level-chip w-9 h-9 rounded-xl text-xs font-bold border transition ${lv === this.currentLevel ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}">${lv}</button>
            `).join('')}
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
          ${showRestart ? `
            <button id="lesson-restart-btn" class="w-full sm:w-auto px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm shadow-lg shadow-brand-600/30 transition">
              Yeni Tura Başla (Sıfırla) ⟳
            </button>
          ` : (showNext ? `
            <button id="lesson-next-level-btn" data-next-level="${this.currentLevel}" class="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition">
              Sonraki 10 Yeni Kelimeye Geç &rarr;
            </button>
          ` : `
            <button id="lesson-retry-btn" class="w-full sm:w-auto px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm shadow-lg shadow-amber-600/30 transition">
              ${this.wrongWords.length > 0 ? 'Eksik Kelimeleri Tekrar Et' : 'Testi Tekrarla'}
            </button>
          `)}
          <button onclick="closeGame()" class="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition">
            Menüye Dön
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    const nextLevelBtn = document.getElementById('lesson-next-level-btn');
    if (nextLevelBtn) {
      nextLevelBtn.addEventListener('click', () => {
        AudioService.playSfx('click');
        const target = parseInt(nextLevelBtn.getAttribute('data-next-level'), 10) || this.currentLevel;
        this.loadLevel(target);
      });
    }

    const retryBtn = document.getElementById('lesson-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        AudioService.playSfx('click');
        this.loadLevel(this.currentLevel);
      });
    }

    const restartBtn = document.getElementById('lesson-restart-btn');
    if (restartBtn) {
      restartBtn.addEventListener('click', async () => {
        AudioService.playSfx('click');
        await this.resetProgress();
      });
    }

    // Seviye seçici çipleri
    document.querySelectorAll('.lesson-level-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const lv = parseInt(chip.getAttribute('data-level'), 10);
        AudioService.playSfx('click');
        this.loadLevel(lv);
      });
    });
  }

  async resetProgress() {
    this.renderLoading('İlerleme sıfırlanıyor...');
    try {
      await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', user_id: this.userId })
      });
    } catch (e) {
      console.warn('Reset error:', e);
    }
    this.localCompleted = [];
    this.serverCompletedIds = [];
    this.currentLevel = 1;
    this.saveLocalProgress();
    this.updateLevelBadge(1);
    showToast('İlerleme sıfırlandı. Yeni tura Seviye 1\'den başlıyorsunuz. 🔄', 'success');
    await this.loadLevel(1);
  }

  destroy() {
    this.isLoading = false;
  }
}

// GAMES Tablosuna Kaydet
GAMES['step-by-step-lessons'] = StepByStepLessonsGame;
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
    const inlineUsernameDisplay = document.getElementById('inline-username-display');
    if (gateView) gateView.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');
    if (usernameDisplay && this.user) {
      usernameDisplay.textContent = this.user.username;
    }
    if (inlineUsernameDisplay && this.user) {
      inlineUsernameDisplay.textContent = this.user.username;
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

    const handleLogout = () => {
      this.user = null;
      localStorage.removeItem(this.USER_STORAGE_KEY);
      WordStore.setWords([]);
      this.showGate();
      showToast('Oturum kapatıldı.', 'info');
    };

    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    const inlineLogoutBtn = document.getElementById('inline-logout-btn');
    if (inlineLogoutBtn) {
      inlineLogoutBtn.addEventListener('click', handleLogout);
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
            example_en: w.example_en || '',
            example_tr: w.example_tr || '',
            pos: w.pos || '',
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

      // 3. Neon DB'den Kullanıcının Özel Çalışma Listesini Çek
      try {
        const studyResp = await fetch(`/api/study-list?user_id=${this.user.id}`);
        if (studyResp.ok) {
          const studyData = await studyResp.json();
          if (studyData.success && Array.isArray(studyData.studyList)) {
            WordStore.setStudyList(studyData.studyList);
          }
        }
      } catch (err) {
        console.warn('Study list fetch error:', err);
      }

      WordStore.setWords(words);
    } catch (e) {
      console.warn('Backend words fetch error:', e);
      WordStore.setWords([]);
    }
  },

  async syncStudyListWord(wordEn, action = 'add') {
    if (!this.user || !this.user.id || !wordEn) return;
    try {
      const endpoint = action === 'remove' ? '/api/study-list/remove' : '/api/study-list/add';
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: this.user.id,
          english: wordEn
        })
      });
    } catch (e) {
      console.warn('Sync study list word error:', e);
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

// PWA Service Worker Kaydı (Progressive Web App Registration)
function registerPwaServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('PWA ServiceWorker kayıt başarılı, scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('PWA ServiceWorker kayıt uyarısı:', err);
        });
    });
  }
}

// Başlangıç Kurulumu (iOS Safari ve PWA Güvenli Başlatma)
document.addEventListener('DOMContentLoaded', () => {
  try {
    registerPwaServiceWorker();
  } catch (err) {
    console.warn('PWA ServiceWorker kayıt hatası yakalandı (non-fatal):', err);
  }

  try {
    AudioService.init();
  } catch (err) {
    console.warn('AudioService init uyarısı:', err);
  }

  try {
    AuthStore.init();
  } catch (err) {
    console.warn('AuthStore init uyarısı:', err);
  }

  try {
    setupModals();
    updateHeaderBadges();
  } catch (err) {
    console.warn('UI setup uyarısı:', err);
  }

  document.querySelectorAll('.game-card[data-game]').forEach(card => {
    card.addEventListener('click', () => {
      const gameId = card.getAttribute('data-game');
      launchGame(gameId);
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
