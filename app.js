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
  updateArcadePoolBanner();
}

// Ekstra Oyunlar Odası — aktif kelime havuzu bilgi şeridini güncelle
function updateArcadePoolBanner() {
  const banner = document.getElementById('arcade-pool-banner');
  const text = document.getElementById('arcade-pool-banner-text');
  if (!banner || !text) return;

  const allCount = WordStore.getAllWords().length;
  const poolCount = WordStore.getWords().length;
  const studyOn = WordStore.useOnlyStudyList;

  if (studyOn) {
    banner.classList.remove('hidden');
    if (poolCount < 4) {
      text.innerHTML = `<span class="text-amber-300 font-semibold">Sadece Seçtiğin Kelimelerle Çalış</span> filtresi aktif: <span class="font-bold text-white">${poolCount}</span> kelime seçili. Bazı oyunlar için en az 4 kelime gerekir. Üst menüden filtreyi kapatabilir veya daha fazla kelime yıldızlayabilirsiniz.`;
    } else {
      text.innerHTML = `<span class="text-amber-300 font-semibold">Sadece Seçtiğin Kelimelerle Çalış</span> filtresi aktif: <span class="font-bold text-white">${poolCount}</span> seçili kelime ile oynuyorsunuz.`;
    }
  } else {
    banner.classList.remove('hidden');
    text.innerHTML = `Tüm kelime havuzu aktif: <span class="font-bold text-white">${allCount}</span> kelime. İsterseniz üst menüden <span class="text-amber-300 font-semibold">"Sadece Seçtiğin Kelimelerle Çalış"</span> filtresini açabilirsiniz.`;
  }

  if (window.lucide) window.lucide.createIcons();
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

  const openExtra = () => {
    updateArcadePoolBanner();
    extraModal.classList.remove('hidden');
  };
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
        const isExtra = card.id === 'open-extra-games-card';

        if (filter === 'all') {
          card.classList.remove('hidden');
        } else if (filter === 'lessons') {
          card.classList.toggle('hidden', gameId !== 'step-by-step-lessons');
        } else if (filter === 'classic') {
          card.classList.toggle('hidden', !['flashcards', 'multiple-choice', 'difficult-words', 'true-false'].includes(gameId));
        } else if (filter === 'interactive') {
          card.classList.toggle('hidden', !['matching', 'handwriting', 'pronunciation', 'fill-blanks'].includes(gameId));
        } else if (filter === 'speed') {
          card.classList.toggle('hidden', !['hangman', 'time-attack', 'falling-words'].includes(gameId));
        } else if (filter === 'extra') {
          card.classList.toggle('hidden', !isExtra);
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

// "Ekstra Oyunlar Odası" (arcade) oyun kimlikleri — izole modül tarafından yönetilir
const ARCADE_GAME_IDS = [
  'wordle', 'lane-runner', 'word-race', 'word-bomb',
  'word-pop', 'word-defense', 'word-funnel', 'shadow-listening'
];

function launchGame(gameId) {
  // Ekstra Oyunlar Odası oyunları izole GamesRoomManager modülüne yönlendirilir
  if (ARCADE_GAME_IDS.includes(gameId) && typeof GamesRoomManager !== 'undefined') {
    GamesRoomManager.launch(gameId);
    return;
  }

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

  if (['multiple-choice', 'fill-blanks', 'falling-words', 'word-defense'].includes(gameId) && words.length < 4) {
    showToast(`Bu modu oynamak için listenize en az 4 kelime eklemelisiniz! (Şu an: ${words.length})`, 'warning');
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
  // Arcade oyunu aktifse izole modül üzerinden oyun odalarına dön
  if (typeof GamesRoomManager !== 'undefined' && GamesRoomManager.getActiveGameId && GamesRoomManager.getActiveGameId()) {
    GamesRoomManager.openRoom();
    return;
  }

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
// EKSTRA OYUNLAR ODASI (ARCADE) — İZOLE MODÜL
// Tüm durum, zamanlayıcı, event listener ve yardımcı fonksiyonlar bu IIFE
// (GamesRoomManager) altında kapsüllenmiştir. Diğer modüllerin global
// değişkenleri / event listener'ları ile çakışmaz. Dışa açılan tek arayüz
// window.GamesRoomManager üzerindeki launch() ve openRoom() metotlarıdır.
// ============================================================================
const GamesRoomManager = (function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1) VERİ NORMALİZASYONU VE YARDIMCILAR
  // --------------------------------------------------------------------------
  function enUp(str) { return String(str == null ? '' : str).toLocaleUpperCase('en-US'); }
  function enLow(str) { return String(str == null ? '' : str).toLocaleLowerCase('en-US'); }

  function normalizeGameWord(item) {
    if (!item) return null;
    const en = item.en != null ? item.en
      : item.english != null ? item.english
      : item.word != null ? item.word
      : item.english_word != null ? item.english_word : '';
    const tr = item.tr != null ? item.tr
      : item.turkish != null ? item.turkish
      : item.meaning != null ? item.meaning
      : item.meaning_tr != null ? item.meaning_tr : '';
    const cleanEn = String(en).trim();
    const cleanTr = String(tr).trim();
    if (!cleanEn || !cleanTr) return null;
    const rawId = item.id != null ? item.id : (item._id != null ? item._id : cleanEn);
    return {
      id: String(rawId),
      en: cleanEn,
      tr: cleanTr,
      ipa: item.ipa || item.pronunciation || '',
      example_en: item.example_en || '',
      example_tr: item.example_tr || '',
      pos: item.pos || '',
      wrongCount: Number(item.wrongCount || item.wrong_count || 0) || 0
    };
  }

  function formatShortMeaning(meaning, max = 32) {
    const s = String(meaning == null ? '' : meaning).trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const lastSep = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'));
    const base = lastSep > max * 0.4 ? cut.slice(0, lastSep) : cut;
    return base.trim() + '...';
  }

  function firstMeaning(meaning) {
    const s = String(meaning == null ? '' : meaning).trim();
    if (!s) return '';
    const idx = s.search(/[,;/]/);
    return idx > 0 ? s.slice(0, idx).trim() : s;
  }

  function shuffle(arr) {
    const a = Array.isArray(arr) ? arr.slice() : [];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  const ALPHA_RE = /^[a-zA-Z]{3,10}$/;
  function isAlphaWord(w) {
    return !!w && ALPHA_RE.test(w.en) && !w.en.includes(' ') && !w.en.includes('-') && !w.en.includes("'");
  }

  function createDeck(words) {
    const pool = words.slice();
    let queue = shuffle(pool);
    return {
      next() {
        if (pool.length === 0) return null;
        if (queue.length === 0) queue = shuffle(pool);
        return queue.pop();
      },
      get size() { return pool.length; }
    };
  }

  function pickDistractors(target, pool, count) {
    const usedMeanings = new Set([enLow(firstMeaning(target.tr))]);
    const out = [];
    const shuffled = shuffle(pool);
    for (let i = 0; i < shuffled.length && out.length < count; i++) {
      const w = shuffled[i];
      if (w.id === target.id) continue;
      const key = enLow(firstMeaning(w.tr));
      if (usedMeanings.has(key)) continue;
      usedMeanings.add(key);
      out.push(w);
    }
    return out;
  }

  function speakWordSafely(text, rate) {
    try {
      if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'en-US';
      u.rate = typeof rate === 'number' ? rate : 0.95;
      const voices = window.speechSynthesis.getVoices() || [];
      const voice = voices.find(v => /^en[-_]US/i.test(v.lang))
        || voices.find(v => /^en[-_]GB/i.test(v.lang))
        || voices.find(v => /^en/i.test(v.lang));
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // 2) HUD (ÜST ÇUBUK) YÖNETİMİ
  // --------------------------------------------------------------------------
  const HUD = {
    originalTitle: null,
    originalSubtitle: null,
    captured: false,
    capture() {
      if (this.captured) return;
      const t = document.getElementById('active-game-title');
      const s = document.getElementById('active-game-subtitle');
      this.originalTitle = t ? t.textContent : null;
      this.originalSubtitle = s ? s.textContent : null;
      this.captured = true;
    },
    restore() {
      if (!this.captured) return;
      const t = document.getElementById('active-game-title');
      const s = document.getElementById('active-game-subtitle');
      if (t && this.originalTitle != null) t.textContent = this.originalTitle;
      if (s && this.originalSubtitle != null) s.textContent = this.originalSubtitle;
      this.captured = false;
    },
    setTitle(title, subtitle) {
      const t = document.getElementById('active-game-title');
      const s = document.getElementById('active-game-subtitle');
      if (t) t.textContent = title;
      if (s && subtitle) s.textContent = subtitle;
    },
    setScore(score) {
      const el = document.getElementById('game-score-display');
      if (el) el.textContent = String(score);
    },
    setLives(lives) {
      const c = document.getElementById('game-lives-container');
      const d = document.getElementById('game-lives-display');
      if (c) { c.classList.remove('hidden'); c.classList.add('flex'); }
      if (d) d.textContent = String(Math.max(0, lives));
    },
    hideLives() {
      const c = document.getElementById('game-lives-container');
      if (c) { c.classList.add('hidden'); c.classList.remove('flex'); }
    },
    setTimer(seconds) {
      const c = document.getElementById('game-timer-container');
      const d = document.getElementById('game-timer-display');
      if (c) { c.classList.remove('hidden'); c.classList.add('flex'); }
      if (d) d.textContent = String(Math.max(0, Math.ceil(seconds)));
    },
    hideTimer() {
      const c = document.getElementById('game-timer-container');
      if (c) { c.classList.add('hidden'); c.classList.remove('flex'); }
    },
    reset() { this.setScore(0); this.hideLives(); this.hideTimer(); }
  };

  // --------------------------------------------------------------------------
  // 3) TEMİZ KAPANIŞ (CLEANUP)
  // --------------------------------------------------------------------------
  let rafIds = [];
  let timeoutIds = [];
  let intervalIds = [];
  let resizeObserver = null;
  let globalKeyHandler = null;

  function trackRaf(id) { rafIds.push(id); return id; }
  function trackTimeout(id) { timeoutIds.push(id); return id; }
  function trackInterval(id) { intervalIds.push(id); return id; }

  function cleanupActiveGame() {
    rafIds.forEach(id => { try { cancelAnimationFrame(id); } catch (e) {} });
    rafIds = [];
    timeoutIds.forEach(id => { try { clearTimeout(id); } catch (e) {} });
    timeoutIds = [];
    intervalIds.forEach(id => { try { clearInterval(id); } catch (e) {} });
    intervalIds = [];
    if (resizeObserver) { try { resizeObserver.disconnect(); } catch (e) {} resizeObserver = null; }
    if (globalKeyHandler) { try { window.removeEventListener('keydown', globalKeyHandler); } catch (e) {} globalKeyHandler = null; }
    try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // 4) ORTAK OYUN SONU ÖZETİ + OTOMATİK "ZORLU KELİMELER" KAYDI
  // --------------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const BEST_KEY = 'gamesroom_best_v1';
  function readBestMap() {
    try { const raw = localStorage.getItem(BEST_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function readBestScore(gameId) { return Number(readBestMap()[gameId] || 0) || 0; }
  function writeBestScore(gameId, score) {
    try { const map = readBestMap(); map[gameId] = score; localStorage.setItem(BEST_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function renderGameOver(ctx, result) {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    const gameId = ctx.gameId;
    const score = result.score || 0;
    const prevBest = readBestScore(gameId);
    const isNewBest = score > prevBest;
    if (isNewBest) writeBestScore(gameId, score);

    const missed = Array.isArray(result.missed) ? result.missed : [];
    const uniqueMissed = [];
    const seen = new Set();
    missed.forEach(w => { if (w && !seen.has(w.id)) { seen.add(w.id); uniqueMissed.push(w); } });

    // Yanlış kelimeler oyun sırasında ctx.miss() ile zaten +1 kaydedildi;
    // burada yalnızca skor istatistiği gönderilir (mükerrer sayımı önler).
    try { if (typeof ctx.recordStat === 'function') ctx.recordStat(gameId, score, []); } catch (e) {}

    const stats = ctx.stats || { correct: 0, wrong: 0, maxCombo: 0 };
    const accuracy = (stats.correct + stats.wrong) > 0
      ? Math.round((stats.correct / (stats.correct + stats.wrong)) * 100) : 0;

    stage.innerHTML = `
      <div class="games-room-summary w-full max-w-xl mx-auto">
        <div class="text-center mb-4">
          <div class="w-16 h-16 rounded-2xl ${isNewBest ? 'bg-amber-500/20 text-amber-400' : 'bg-brand-500/20 text-brand-300'} mx-auto flex items-center justify-center mb-3">
            <i data-lucide="${isNewBest ? 'award' : 'flag'}" class="w-8 h-8"></i>
          </div>
          <h3 class="text-2xl font-bold font-display text-white mb-1">${escapeHtml(result.title || 'Oyun Bitti')}</h3>
          <p class="text-slate-400 text-sm">${escapeHtml(result.subtitle || '')}</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div class="games-room-stat">
            <span class="text-[11px] uppercase text-slate-400 font-semibold">Skor</span>
            <span class="text-xl font-mono font-bold text-white">${score}</span>
            ${isNewBest ? '<span class="text-[10px] font-bold text-amber-400 mt-0.5">YENİ REKOR!</span>' : ''}
          </div>
          <div class="games-room-stat">
            <span class="text-[11px] uppercase text-slate-400 font-semibold">Doğru</span>
            <span class="text-xl font-mono font-bold text-emerald-400">${stats.correct || 0}</span>
          </div>
          <div class="games-room-stat">
            <span class="text-[11px] uppercase text-slate-400 font-semibold">Yanlış</span>
            <span class="text-xl font-mono font-bold text-rose-400">${stats.wrong || 0}</span>
          </div>
          <div class="games-room-stat">
            <span class="text-[11px] uppercase text-slate-400 font-semibold">En Uzun Seri</span>
            <span class="text-xl font-mono font-bold text-amber-400">x${stats.maxCombo || 0}</span>
          </div>
        </div>

        <p class="text-center text-xs text-slate-400 mb-3">Başarı: <span class="text-white font-bold">%${accuracy}</span> &bull; Rekor: <span class="text-amber-400 font-bold">${readBestScore(gameId)}</span></p>

        ${uniqueMissed.length > 0 ? `
          <div class="mb-4">
            <p class="text-sm font-semibold text-rose-300 mb-2 flex items-center gap-1.5">
              <i data-lucide="alert-triangle" class="w-4 h-4"></i>
              Bu Oyunda Hata Yapılan / Kaçırılan Kelimeler (Zorlu Kelimelere eklendi)
            </p>
            <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
              ${uniqueMissed.map(w => `
                <div class="games-room-missed-row">
                  <div class="min-w-0">
                    <span class="font-bold text-white">${escapeHtml(w.en)}</span>
                    <span class="text-slate-400 text-xs block truncate" title="${escapeHtml(w.tr)}">${escapeHtml(w.tr)}</span>
                  </div>
                  <button class="games-room-speak-btn shrink-0" data-speak="${escapeHtml(w.en)}" title="Dinle">
                    <i data-lucide="volume-2" class="w-4 h-4"></i>
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center text-emerald-300 text-sm">
            Bu oyunda hiç hata yapmadın, harika!
          </div>
        `}

        <div class="flex items-center justify-center gap-3 flex-wrap">
          <button id="games-room-replay-btn" class="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition flex items-center gap-1.5">
            <i data-lucide="rotate-ccw" class="w-4 h-4"></i> Tekrar Oyna
          </button>
          <button id="games-room-back-btn" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition flex items-center gap-1.5">
            <i data-lucide="layout-grid" class="w-4 h-4"></i> Oyun Odalarına Dön
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    stage.querySelectorAll('[data-speak]').forEach(btn => {
      btn.addEventListener('click', () => speakWordSafely(btn.getAttribute('data-speak')));
    });
    const replayBtn = document.getElementById('games-room-replay-btn');
    if (replayBtn) replayBtn.addEventListener('click', () => launch(gameId));
    const backBtn = document.getElementById('games-room-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => openRoom());
  }

  // --------------------------------------------------------------------------
  // 5) TEMEL OYUN SINIFI
  // --------------------------------------------------------------------------
  class BaseMiniGame {
    constructor() {
      this.rafId = null;
      this.timers = [];
      this.intervalId = null;
      this.stageKeyHandler = null;
      this.cleanupFns = [];
    }
    get stage() { return document.getElementById('game-stage'); }
    afterRender() { if (window.lucide) window.lucide.createIcons(); }
    setTimeoutTracked(fn, ms) {
      const id = setTimeout(fn, ms);
      this.timers.push(id); trackTimeout(id);
      return id;
    }
    setIntervalTracked(fn, ms) {
      this.intervalId = setInterval(fn, ms); trackInterval(this.intervalId);
      return this.intervalId;
    }
    onStageKeydown(handler) {
      this.stageKeyHandler = handler;
      window.addEventListener('keydown', handler);
    }
    onCleanup(fn) { this.cleanupFns.push(fn); }
    destroy() {
      if (this.rafId) { try { cancelAnimationFrame(this.rafId); } catch (e) {} this.rafId = null; }
      this.timers.forEach(id => { try { clearTimeout(id); } catch (e) {} });
      this.timers = [];
      if (this.intervalId) { try { clearInterval(this.intervalId); } catch (e) {} this.intervalId = null; }
      if (this.stageKeyHandler) { try { window.removeEventListener('keydown', this.stageKeyHandler); } catch (e) {} this.stageKeyHandler = null; }
      this.cleanupFns.forEach(fn => { try { fn(); } catch (e) {} });
      this.cleanupFns = [];
    }
  }

  function buildContext(gameId, title, subtitle) {
    return {
      gameId: gameId,
      title: title,
      subtitle: subtitle,
      store: (typeof WordStore !== 'undefined') ? WordStore : null,
      auth: (typeof AuthStore !== 'undefined') ? AuthStore : null,
      best: readBestScore(gameId),
      score: 0,
      lives: 3,
      combo: 0,
      maxCombo: 0,
      stats: { correct: 0, wrong: 0, maxCombo: 0 },
      missed: [],
      deck: null,
      isOver: false,
      // Yanlış cevap anında "Zorlu Kelimeler" istatistiğine +1 kaydet
      miss: function (word) {
        if (!word) return;
        try { this.missed.push(word); } catch (e) {}
        try {
          if (this.store && typeof this.store.recordMistake === 'function') {
            this.store.recordMistake(word.id, this.gameId);
          }
        } catch (e) {}
      },
      recordStat: function (gameType, score, wrongWords) {
        try { if (this.auth && typeof this.auth.recordStatToBackend === 'function') this.auth.recordStatToBackend(gameType, score, wrongWords || []); } catch (e) {}
      }
    };
  }

  // ==========================================================================
  // OYUN 1: WORDLE
  // ==========================================================================
  class WordleGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words.filter(isAlphaWord);
      this.deck = createDeck(this.words);
      this.maxGuesses = 6;
      this.startWord();
    }
    startWord() {
      const w = this.deck.next();
      if (!w) { this.endGame('Kelimeler Bitti'); return; }
      this.target = w;
      this.targetLetters = enUp(w.en).split('');
      this.len = this.targetLetters.length;
      this.guesses = [];
      this.currentGuess = '';
      this.wordOver = false;
      HUD.setTitle('Wordle', `${this.len} harfli İngilizce kelimeyi bul`);
      this.render();
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      const kbRow = (row, extra) => row.split('').map(k =>
        `<button class="games-room-key ${this.keyClass(k)}" data-key="${k}">${k}</button>`).join('');
      stage.innerHTML = `
        <div class="w-full max-w-md flex flex-col items-center">
          <div class="w-full p-3 rounded-xl bg-slate-800/80 border border-slate-700 mb-3 text-center">
            <span class="text-[11px] uppercase text-emerald-400 font-semibold">Türkçe İpucu</span>
            <p class="text-xl font-bold text-white font-display">${escapeHtml(this.target.tr)}</p>
          </div>
          <div class="grid gap-1.5 mb-4">
            ${Array.from({ length: this.maxGuesses }).map((_, r) => {
              const g = this.guesses[r];
              const isCur = r === this.guesses.length && !this.wordOver;
              const letters = g ? g.letters : (isCur ? this.currentGuess.padEnd(this.len, ' ').split('') : Array(this.len).fill(' '));
              return `<div class="flex gap-1.5 justify-center" data-row="${r}">
                ${Array.from({ length: this.len }).map((__, c) => {
                  const ch = (letters[c] || '').trim();
                  let cls = 'games-room-wordle-cell';
                  if (g) cls += ' ' + g.statuses[c];
                  return `<div class="${cls}" ${g ? `style="animation-delay:${c * 90}ms"` : ''}>${escapeHtml(ch)}</div>`;
                }).join('')}
              </div>`;
            }).join('')}
          </div>
          ${this.wordOver ? `
            <div class="w-full flex flex-col items-center gap-3">
              <div class="flex items-center gap-2 text-white font-bold">
                <span>Kelime: <span class="text-emerald-400">${escapeHtml(this.target.en)}</span></span>
                <button class="games-room-speak-btn" data-speak="${escapeHtml(this.target.en)}"><i data-lucide="volume-2" class="w-4 h-4"></i></button>
              </div>
              <button id="wordle-next" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm">Sonraki Kelime &rarr;</button>
            </div>
          ` : `
            <div class="w-full flex flex-col gap-1.5 items-center">
              <div class="flex gap-1 justify-center flex-wrap">${kbRow('QWERTYUIOP')}</div>
              <div class="flex gap-1 justify-center flex-wrap">${kbRow('ASDFGHJKL')}</div>
              <div class="flex gap-1 justify-center flex-wrap">
                <button class="games-room-key games-room-key-wide" id="wordle-enter">ENTER</button>
                ${kbRow('ZXCVBNM')}
                <button class="games-room-key games-room-key-wide bg-rose-600/30 text-rose-300" id="wordle-back">SİL</button>
              </div>
            </div>
          `}
        </div>`;
      this.afterRender();
      this.bind();
    }
    keyClass(k) {
      const st = this.letterStatus(k);
      if (st === 'correct') return 'bg-emerald-600 text-white';
      if (st === 'present') return 'bg-amber-500 text-white';
      if (st === 'absent') return 'bg-slate-700 text-slate-400';
      return 'bg-slate-800 text-white';
    }
    letterStatus(k) {
      let best = '';
      this.guesses.forEach(g => g.letters.forEach((ch, i) => {
        if (ch !== k) return;
        const s = g.statuses[i];
        if (s === 'correct') best = 'correct';
        else if (s === 'present' && best !== 'correct') best = 'present';
        else if (s === 'absent' && !best) best = 'absent';
      }));
      return best;
    }
    bind() {
      this.stage.querySelectorAll('.games-room-key[data-key]').forEach(b =>
        b.addEventListener('click', () => this.input(b.getAttribute('data-key'))));
      const e = document.getElementById('wordle-enter'); if (e) e.addEventListener('click', () => this.submit());
      const bk = document.getElementById('wordle-back'); if (bk) bk.addEventListener('click', () => this.backspace());
      const nx = document.getElementById('wordle-next'); if (nx) nx.addEventListener('click', () => this.startWord());
      this.stage.querySelectorAll('[data-speak]').forEach(b =>
        b.addEventListener('click', () => speakWordSafely(b.getAttribute('data-speak'))));
      if (!this.stageKeyHandler) {
        this.onStageKeydown(ev => {
          if (this.ctx.isOver || this.wordOver) { if (ev.key === 'Enter' && this.wordOver) this.startWord(); return; }
          if (ev.key === 'Enter') this.submit();
          else if (ev.key === 'Backspace') { ev.preventDefault(); this.backspace(); }
          else if (/^[a-zA-Z]$/.test(ev.key)) this.input(enUp(ev.key));
        });
      }
    }
    input(ch) {
      if (this.wordOver || this.currentGuess.length >= this.len) return;
      this.currentGuess += ch;
      if (typeof AudioService !== 'undefined') AudioService.playSfx('click');
      this.updateCurrentRow();
    }
    backspace() {
      if (this.wordOver) return;
      this.currentGuess = this.currentGuess.slice(0, -1);
      this.updateCurrentRow();
    }
    updateCurrentRow() {
      const row = this.guesses.length;
      const cells = this.stage.querySelectorAll(`[data-row="${row}"] .games-room-wordle-cell`);
      if (!cells.length) { this.render(); return; }
      cells.forEach((cell, c) => {
        const ch = (this.currentGuess[c] || '').trim();
        cell.textContent = ch;
      });
    }
    submit() {
      if (this.wordOver) return;
      if (this.currentGuess.length !== this.len) { showToast(`${this.len} harfli kelime yazmalısın!`, 'warning'); return; }
      const g = this.currentGuess.split('');
      const statuses = Array(this.len).fill('absent');
      const pool = this.targetLetters.slice();
      g.forEach((ch, i) => { if (ch === pool[i]) { statuses[i] = 'correct'; pool[i] = null; } });
      g.forEach((ch, i) => {
        if (statuses[i] === 'correct') return;
        const idx = pool.indexOf(ch);
        if (idx > -1) { statuses[i] = 'present'; pool[idx] = null; }
      });
      this.guesses.push({ letters: g, statuses });
      const win = statuses.every(s => s === 'correct');
      if (win) {
        this.wordOver = true;
        this.ctx.score += Math.max(10, 100 - (this.guesses.length - 1) * 15);
        this.ctx.stats.correct++;
        this.bumpCombo(true);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('win');
        showToast('Tebrikler! Doğru bildin.', 'success');
      } else if (this.guesses.length >= this.maxGuesses) {
        this.wordOver = true;
        this.ctx.lives--;
        this.ctx.stats.wrong++;
        this.bumpCombo(false);
        this.ctx.miss(this.target);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        showToast(`Bilemedin! Kelime: ${this.target.en}`, 'error');
        if (this.ctx.lives <= 0) { this.currentGuess = ''; this.render(); this.endGame('Canlar Bitti'); return; }
      } else {
        if (typeof AudioService !== 'undefined') AudioService.playSfx('pop');
      }
      this.currentGuess = '';
      this.render();
    }
    bumpCombo(ok) {
      if (ok) { this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo); }
      else { this.ctx.combo = 0; }
    }
    endGame(title) {
      this.ctx.isOver = true;
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Wordle turu tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN 2: ŞERİT KOŞUSU
  // ==========================================================================
  class LaneRunnerGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words;
      this.deck = createDeck(words);
      this.lane = 1;
      this.laneWords = [];
      this.target = null;
      this.speed = 1.0;
      this.running = false;
      HUD.setTitle('Şerit Koşusu', 'Doğru İngilizce kelimenin şeridine geç!');
      HUD.setLives(this.ctx.lives);
      this.nextRound();
    }
    nextRound() {
      if (this.ctx.isOver) return;
      const t = this.deck.next(); if (!t) { this.endGame('Kelimeler Bitti'); return; }
      this.target = t;
      const distractors = pickDistractors(t, this.words, 2);
      if (distractors.length < 2) { this.endGame('Yeterli Kelime Yok'); return; }
      const correctLane = Math.floor(Math.random() * 3);
      const opts = [];
      let di = 0;
      for (let i = 0; i < 3; i++) {
        if (i === correctLane) opts.push({ word: t, correct: true });
        else opts.push({ word: distractors[di++], correct: false });
      }
      this.laneWords = opts;
      this.correctLane = correctLane;
      this.progress = 0;
      this.running = true;
      this.render();
      this.startLoop();
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      stage.innerHTML = `
        <div class="w-full max-w-lg flex flex-col items-center">
          <div class="w-full p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-center mb-3">
            <span class="text-[11px] text-blue-400 font-semibold uppercase">Hedef Türkçe Anlam</span>
            <h3 class="text-xl font-bold text-white font-display">${escapeHtml(this.target.tr)}</h3>
          </div>
          <div class="games-room-track" id="lane-track">
            ${this.laneWords.map((o, i) => `
              <div class="games-room-lane" data-lane="${i}">
                <div class="games-room-lane-label" data-lane-label="${i}">${escapeHtml(formatShortMeaning(o.word.en, 22))}</div>
              </div>`).join('')}
            <div class="games-room-runner" id="lane-runner"><i data-lucide="zap" class="w-5 h-5"></i></div>
          </div>
          <div class="w-full grid grid-cols-3 gap-2 mt-4">
            <button class="games-room-steer" data-move="-1">&#8592; Sol</button>
            <button class="games-room-steer" data-move="1">Sağ &#8594;</button>
            <button class="games-room-steer games-room-steer-jump" id="lane-jump">&#8681; Atla</button>
          </div>
        </div>`;
      this.afterRender();
      this.positionRunner();
      this.bind();
    }
    positionRunner() {
      const r = document.getElementById('lane-runner');
      if (r) r.style.left = `calc(${this.lane * 33.333}% + 16.666% - 1.25rem)`;
      this.stage.querySelectorAll('[data-lane-label]').forEach(el => {
        el.classList.toggle('games-room-lane-active', Number(el.getAttribute('data-lane-label')) === this.lane);
      });
    }
    bind() {
      this.stage.querySelectorAll('.games-room-steer[data-move]').forEach(b =>
        b.addEventListener('click', () => this.move(Number(b.getAttribute('data-move')))));
      const jump = document.getElementById('lane-jump');
      if (jump) jump.addEventListener('click', () => this.move(0, true));
      this.stage.querySelectorAll('[data-lane]').forEach(l =>
        l.addEventListener('click', () => { this.lane = Number(l.getAttribute('data-lane')); this.positionRunner(); }));
      if (!this.stageKeyHandler) {
        this.onStageKeydown(e => {
          if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); this.move(-1); }
          else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); this.move(1); }
          else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); this.move(0, true); }
        });
      }
    }
    move(delta, jump) {
      if (!this.running) return;
      if (delta !== 0) this.lane = Math.min(2, Math.max(0, this.lane + delta));
      if (typeof AudioService !== 'undefined') AudioService.playSfx('click');
      this.positionRunner();
      if (jump) this.progress = Math.max(this.progress, 200);
    }
    startLoop() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      const track = document.getElementById('lane-track');
      const h = track ? track.clientHeight : 260;
      const labels = Array.from({ length: 3 }).map((_, i) => document.getElementById(`lane-runner`) && this.stage.querySelector(`[data-lane-label="${i}"]`));
      const tick = () => {
        if (!this.running || this.ctx.isOver) return;
        this.progress += this.speed * 2.2;
        const ratio = Math.min(1, this.progress / h);
        this.stage.querySelectorAll('[data-lane-label]').forEach(el => {
          el.style.transform = `translateY(${ratio * (h * 0.62)}px)`;
        });
        if (this.progress >= h) { this.resolve(); return; }
        this.rafId = trackRaf(requestAnimationFrame(tick));
      };
      this.rafId = trackRaf(requestAnimationFrame(tick));
    }
    resolve() {
      this.running = false;
      const chosen = this.laneWords[this.lane];
      const track = document.getElementById('lane-track');
      if (chosen && chosen.correct) {
        this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo);
        this.ctx.score += 10 * Math.min(5, this.ctx.combo);
        this.ctx.stats.correct++;
        this.speed = Math.min(3.2, this.speed + 0.18);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('correct');
        if (track) track.classList.add('games-room-flash-green');
        showToast(`Doğru! +${10 * Math.min(5, this.ctx.combo)} (Combo x${Math.min(5, this.ctx.combo)})`, 'success');
      } else {
        this.ctx.combo = 0;
        this.ctx.lives--;
        this.ctx.stats.wrong++;
        this.ctx.miss(this.target);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        if (track) track.classList.add('games-room-shake');
        showToast(`Yanlış şerit! Doğru kelime: ${this.target.en}`, 'error');
      }
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      if (this.ctx.lives <= 0) { this.setTimeoutTracked(() => this.endGame('Canlar Bitti'), 700); return; }
      this.setTimeoutTracked(() => this.nextRound(), 700);
    }
    endGame(title) {
      this.ctx.isOver = true;
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Şerit Koşusu tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN 3: KELİME YARIŞI
  // ==========================================================================
  class WordRaceGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words;
      this.deck = createDeck(words);
      this.lane = 1;
      this.tunnels = [];
      this.target = null;
      this.speed = 1.0;
      this.running = false;
      HUD.setTitle('Kelime Yarışı', 'Doğru kelime tüneline sür!');
      HUD.setLives(this.ctx.lives);
      this.newRace();
    }
    newRace() {
      if (this.ctx.isOver) return;
      const t = this.deck.next(); if (!t) { this.endGame('Kelimeler Bitti'); return; }
      this.target = t;
      const distractors = pickDistractors(t, this.words, 2);
      if (distractors.length < 2) { this.endGame('Yeterli Kelime Yok'); return; }
      const correct = Math.floor(Math.random() * 3);
      const list = []; let di = 0;
      for (let i = 0; i < 3; i++) list.push(i === correct ? { word: t, correct: true } : { word: distractors[di++], correct: false });
      this.tunnels = list;
      this.progress = 0;
      this.running = true;
      this.render();
      this.startDrive();
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      stage.innerHTML = `
        <div class="w-full max-w-lg flex flex-col items-center">
          <div class="w-full p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center mb-3">
            <span class="text-[11px] text-amber-400 font-semibold uppercase">Aranan Türkçe Anlam</span>
            <h3 class="text-xl font-bold text-white font-display">${escapeHtml(this.target.tr)}</h3>
          </div>
          <div class="games-room-highway" id="race-highway">
            <div class="games-room-tunnels">
              ${this.tunnels.map((t, i) => `
                <div class="games-room-tunnel" data-tunnel="${i}">
                  <span class="games-room-tunnel-label">TÜNEL ${i + 1}</span>
                  <p class="games-room-tunnel-word">${escapeHtml(formatShortMeaning(t.word.en, 20))}</p>
                </div>`).join('')}
            </div>
            <div class="games-room-car" id="race-car"><i data-lucide="car" class="w-5 h-5"></i></div>
          </div>
          <div class="w-full grid grid-cols-3 gap-2 mt-4">
            <button class="games-room-steer" data-steer="0">&#8592; Tünel 1</button>
            <button class="games-room-steer" data-steer="1">Tünel 2</button>
            <button class="games-room-steer" data-steer="2">Tünel 3 &#8594;</button>
          </div>
        </div>`;
      this.afterRender();
      this.positionCar();
      this.bind();
    }
    positionCar() {
      const c = document.getElementById('race-car');
      if (c) c.style.left = `calc(${this.lane * 33.333}% + 16.666% - 1.25rem)`;
    }
    bind() {
      this.stage.querySelectorAll('.games-room-steer[data-steer]').forEach(b =>
        b.addEventListener('click', () => { this.lane = Number(b.getAttribute('data-steer')); this.positionCar(); }));
      this.stage.querySelectorAll('[data-tunnel]').forEach(t =>
        t.addEventListener('click', () => { this.lane = Number(t.getAttribute('data-tunnel')); this.positionCar(); }));
      if (!this.stageKeyHandler) {
        this.onStageKeydown(e => {
          if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); this.lane = Math.max(0, this.lane - 1); this.positionCar(); }
          else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); this.lane = Math.min(2, this.lane + 1); this.positionCar(); }
        });
      }
    }
    startDrive() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      const hw = document.getElementById('race-highway');
      const car = document.getElementById('race-car');
      const h = hw ? hw.clientHeight : 260;
      const tick = () => {
        if (!this.running || this.ctx.isOver) return;
        this.progress += this.speed * 2.4;
        if (car) car.style.bottom = `${Math.min(this.progress, h - 80)}px`;
        if (this.progress >= h - 80) { this.resolve(); return; }
        this.rafId = trackRaf(requestAnimationFrame(tick));
      };
      this.rafId = trackRaf(requestAnimationFrame(tick));
    }
    resolve() {
      this.running = false;
      const chosen = this.tunnels[this.lane];
      const hw = document.getElementById('race-highway');
      if (chosen && chosen.correct) {
        this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo);
        this.ctx.score += 15 * Math.min(5, this.ctx.combo);
        this.ctx.stats.correct++;
        this.speed = Math.min(3.4, this.speed + 0.16);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('correct');
        if (hw) hw.classList.add('games-room-flash-green');
        showToast('Turbo! Doğru tünel.', 'success');
      } else {
        this.ctx.combo = 0;
        this.ctx.lives--;
        this.ctx.stats.wrong++;
        this.ctx.miss(this.target);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        if (hw) hw.classList.add('games-room-shake');
        showToast(`Kaza! Doğru cevap: ${this.target.en}`, 'error');
      }
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      if (this.ctx.lives <= 0) { this.setTimeoutTracked(() => this.endGame('Canlar Bitti'), 700); return; }
      this.setTimeoutTracked(() => this.newRace(), 700);
    }
    endGame(title) {
      this.ctx.isOver = true;
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Kelime Yarışı tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN 4: KELİME BOMBASI
  // ==========================================================================
  class WordBombGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words.filter(isAlphaWord);
      this.deck = createDeck(this.words);
      HUD.setTitle('Kelime Bombası', 'Fitil bitmeden harfleri doğru diz!');
      HUD.setLives(this.ctx.lives);
      this.newBomb();
    }
    newBomb() {
      if (this.ctx.isOver) return;
      const w = this.deck.next(); if (!w) { this.endGame('Kelimeler Bitti'); return; }
      this.target = w;
      this.letters = enUp(w.en).split('');
      this.scrambled = shuffle(this.letters.map((ch, i) => ({ ch: ch, idx: i })));
      this.selected = [];       // {ch, srcIdx}
      this.duration = Math.min(18, Math.max(12, this.letters.length * 2));
      this.remaining = this.duration;
      this.finished = false;
      this.render();
      this.startFuse();
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      const pct = Math.max(0, (this.remaining / this.duration) * 100);
      stage.innerHTML = `
        <div class="w-full max-w-lg flex flex-col items-center">
          <div class="flex items-center gap-3 mb-3 w-full">
            <div class="w-12 h-12 rounded-full bg-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-600/40 ${this.remaining < this.duration * 0.35 ? 'games-room-bomb-pulse' : ''}">
              <i data-lucide="bomb" class="w-7 h-7"></i>
            </div>
            <div class="flex-grow">
              <span class="text-[11px] text-rose-400 font-bold block mb-1">FİTİL (${Math.ceil(this.remaining)}s)</span>
              <div class="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-rose-500/30">
                <div id="fuse-bar" class="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-200" style="width: ${pct}%;"></div>
              </div>
            </div>
          </div>
          <div class="p-3 rounded-xl bg-slate-800 border border-slate-700 text-center mb-4 w-full">
            <span class="text-[11px] text-slate-400 font-medium">İmha İpucu (Türkçe)</span>
            <h3 class="text-xl font-extrabold text-white font-display">${escapeHtml(this.target.tr)}</h3>
          </div>
          <div class="flex gap-2 mb-4 min-h-[48px] p-2 bg-slate-900 rounded-xl border border-slate-800 w-full justify-center flex-wrap">
            ${this.letters.map((_, i) => {
              const sel = this.selected[i];
              return sel
                ? `<div class="games-room-slot games-room-slot-filled">${escapeHtml(sel.ch)}</div>`
                : `<div class="games-room-slot games-room-slot-empty">_</div>`;
            }).join('')}
          </div>
          <div class="flex flex-wrap gap-2 justify-center mb-4">
            ${this.scrambled.map((s, i) => `
              <button class="games-room-letter ${s.used ? 'games-room-letter-used' : ''}" data-slot="${i}" ${s.used ? 'disabled' : ''}>${escapeHtml(s.ch)}</button>
            `).join('')}
          </div>
          <div class="flex gap-3">
            <button id="bomb-undo" class="games-room-mini-btn"><i data-lucide="delete" class="w-3.5 h-3.5"></i> Geri Al</button>
            <button id="bomb-clear" class="games-room-mini-btn"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Temizle</button>
          </div>
        </div>`;
      this.afterRender();
      this.bind();
    }
    bind() {
      this.stage.querySelectorAll('.games-room-letter[data-slot]').forEach(b =>
        b.addEventListener('click', () => this.pick(Number(b.getAttribute('data-slot')))));
      const undo = document.getElementById('bomb-undo'); if (undo) undo.addEventListener('click', () => this.undo());
      const clear = document.getElementById('bomb-clear'); if (clear) clear.addEventListener('click', () => this.clear());
      if (!this.stageKeyHandler) {
        this.onStageKeydown(e => {
          if (e.key === 'Backspace') { e.preventDefault(); this.undo(); }
          else if (/^[a-zA-Z]$/.test(e.key)) this.pickLetter(enUp(e.key));
        });
      }
    }
    pick(slot) {
      if (this.finished) return;
      const item = this.scrambled[slot];
      if (!item || item.used) return;
      item.used = true;
      this.selected.push({ ch: item.ch, srcIdx: slot });
      if (typeof AudioService !== 'undefined') AudioService.playSfx('click');
      if (this.selected.length === this.letters.length) { this.check(); return; }
      this.render();
    }
    pickLetter(letter) {
      const idx = this.scrambled.findIndex(s => !s.used && s.ch === letter);
      if (idx > -1) this.pick(idx);
    }
    undo() {
      if (this.finished || this.selected.length === 0) return;
      const last = this.selected.pop();
      if (last && last.srcIdx != null) this.scrambled[last.srcIdx].used = false;
      this.render();
    }
    clear() {
      if (this.finished) return;
      this.selected.forEach(s => { if (s.srcIdx != null) this.scrambled[s.srcIdx].used = false; });
      this.selected = [];
      this.render();
    }
    check() {
      const typed = this.selected.map(s => s.ch).join('');
      const answer = this.letters.join('');
      if (typed === answer) {
        this.finished = true;
        if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
        this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo);
        this.ctx.score += 20 + Math.round(this.remaining * 2) + (Math.min(5, this.ctx.combo) * 5);
        this.ctx.stats.correct++;
        if (typeof AudioService !== 'undefined') AudioService.playSfx('win');
        showToast('BOMBA İMHA EDİLDİ!', 'success');
        this.setTimeoutTracked(() => this.newBomb(), 900);
      } else {
        this.ctx.combo = 0;
        this.ctx.stats.wrong++;
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        showToast('Yanlış sıralama!', 'warning');
        this.setTimeoutTracked(() => { if (!this.finished) this.clear(); }, 500);
      }
    }
    startFuse() {
      if (this.intervalId) clearInterval(this.intervalId);
      const bar = document.getElementById('fuse-bar');
      this.setIntervalTracked(() => {
        if (this.finished || this.ctx.isOver) return;
        this.remaining -= 0.2;
        const pct = Math.max(0, (this.remaining / this.duration) * 100);
        const b = document.getElementById('fuse-bar');
        if (b) b.style.width = `${pct}%`;
        const lbl = this.stage.querySelector('.text-rose-400');
        if (lbl) lbl.textContent = `FİTİL (${Math.ceil(Math.max(0, this.remaining))}s)`;
        if (this.remaining <= 0) {
          clearInterval(this.intervalId); this.intervalId = null;
          this.finished = true;
          this.ctx.combo = 0;
          this.ctx.lives--;
          this.ctx.stats.wrong++;
          this.ctx.miss(this.target);
          if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
          showToast(`BOMBA PATLADI! Kelime: ${this.target.en}`, 'error');
          HUD.setLives(this.ctx.lives);
          if (this.ctx.lives <= 0) { this.setTimeoutTracked(() => this.endGame('Canlar Bitti'), 900); return; }
          this.setTimeoutTracked(() => this.newBomb(), 1200);
        }
      }, 200);
    }
    endGame(title) {
      this.ctx.isOver = true;
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Kelime Bombası tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN 5: KELİME PATLATMA (BALONCUK)
  // ==========================================================================
  class WordPopGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words;
      this.deck = createDeck(words);
      this.firstSel = null;
      this.locked = false;
      HUD.setTitle('Kelime Patlatma', 'İngilizce ve Türkçe eşleri patlat!');
      HUD.setLives(this.ctx.lives);
      this.newWave();
    }
    newWave() {
      if (this.ctx.isOver) return;
      const picked = [];
      const need = 4;
      for (let i = 0; i < need; i++) { const w = this.deck.next(); if (w) picked.push(w); }
      if (picked.length < 2) { this.endGame('Yeterli Kelime Yok'); return; }
      this.pairs = picked;
      this.bubbles = [];
      picked.forEach((w, idx) => {
        this.bubbles.push({ id: `en_${idx}`, word: w, text: formatShortMeaning(w.en, 18), type: 'en', popped: false });
        this.bubbles.push({ id: `tr_${idx}`, word: w, text: formatShortMeaning(w.tr, 20), type: 'tr', popped: false });
      });
      this.bubbles = shuffle(this.bubbles);
      this.firstSel = null;
      this.locked = false;
      this.render();
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      const active = this.bubbles.filter(b => !b.popped);
      if (active.length === 0) { this.setTimeoutTracked(() => this.newWave(), 500); return; }
      stage.innerHTML = `
        <div class="w-full max-w-2xl flex flex-col items-center">
          <p class="text-xs text-slate-400 mb-3">Eşleşen İngilizce ve Türkçe baloncukları seç</p>
          <div class="games-room-bubble-field" id="bubble-field">
            ${this.bubbles.map(b => {
              if (b.popped) return '';
              const sel = this.firstSel && this.firstSel.id === b.id;
              const size = Math.max(72, Math.min(112, 60 + b.text.length * 2.4));
              return `<button class="games-room-bubble ${b.type === 'en' ? 'games-room-bubble-en' : 'games-room-bubble-tr'} ${sel ? 'games-room-bubble-sel' : ''}"
                        data-bubble="${b.id}" style="width:${size}px;height:${size}px;font-size:clamp(10px,2.4vw,13px)">
                        <span>${escapeHtml(b.text)}</span></button>`;
            }).join('')}
          </div>
        </div>`;
      this.afterRender();
      this.bind();
    }
    bind() {
      this.stage.querySelectorAll('.games-room-bubble').forEach(n =>
        n.addEventListener('click', () => this.tap(n.getAttribute('data-bubble'))));
    }
    tap(id) {
      if (this.locked) return;
      const b = this.bubbles.find(x => x.id === id);
      if (!b || b.popped) return;
      if (!this.firstSel) {
        this.firstSel = b;
        if (typeof AudioService !== 'undefined') AudioService.playSfx('click');
        this.render();
        return;
      }
      if (this.firstSel.id === b.id) { this.firstSel = null; this.render(); return; }
      const match = this.firstSel.word.id === b.word.id && this.firstSel.type !== b.type;
      if (match) {
        if (typeof AudioService !== 'undefined') AudioService.playSfx('pop');
        this.firstSel.popped = true; b.popped = true;
        this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo);
        this.ctx.score += 20 + Math.min(5, this.ctx.combo) * 5;
        this.ctx.stats.correct++;
        this.firstSel = null;
        this.render();
      } else {
        this.locked = true;
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        this.ctx.combo = 0;
        this.ctx.stats.wrong++;
        this.ctx.miss(b.word);
        const n1 = this.stage.querySelector(`[data-bubble="${this.firstSel.id}"]`);
        const n2 = this.stage.querySelector(`[data-bubble="${b.id}"]`);
        if (n1) n1.classList.add('games-room-bubble-wrong');
        if (n2) n2.classList.add('games-room-bubble-wrong');
        showToast('Eşleşmedi!', 'warning');
        this.setTimeoutTracked(() => { this.firstSel = null; this.locked = false; this.render(); }, 500);
      }
    }
    endGame(title) {
      this.ctx.isOver = true;
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Kelime Patlatma tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN 6: KELİME SAVUNMASI
  // ==========================================================================
  class WordDefenseGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words;
      this.deck = createDeck(words);
      this.maxHealth = 100;
      this.health = 100;
      this.enemies = [];
      this.spawnInterval = 2600;
      this.enemySpeed = 0.7;
      this.wave = 0;
      HUD.setTitle('Kelime Savunması', 'Doğru anlama ateş ederek kaleyi koru!');
      HUD.setLives(this.ctx.lives);
      this.render();
      this.startLoop();
      this.scheduleSpawn(600);
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      HUD.setLives(this.ctx.lives);
      stage.innerHTML = `
        <div class="w-full max-w-xl flex flex-col items-center">
          <div class="w-full flex items-center justify-between text-xs text-slate-400 mb-1 px-1">
            <span>Kale Savunması</span>
            <span class="text-emerald-400 font-bold">Kale Canı: ${Math.max(0, this.health)}%</span>
          </div>
          <div class="w-full h-2 bg-slate-800 rounded-full mb-3 overflow-hidden border border-slate-700">
            <div id="defense-health" class="h-full bg-emerald-500 transition-all duration-300" style="width: ${Math.max(0, this.health)}%"></div>
          </div>
          <div class="games-room-arena" id="defense-arena">
            <div class="games-room-castle"><i data-lucide="shield" class="w-5 h-5"></i></div>
          </div>
          <div class="w-full grid grid-cols-2 gap-2.5 mt-3" id="defense-options"></div>
        </div>`;
      this.afterRender();
      this.renderEnemies();
      this.renderOptions();
    }
    renderEnemies() {
      const arena = document.getElementById('defense-arena');
      if (!arena) return;
      arena.querySelectorAll('.games-room-enemy').forEach(n => n.remove());
      this.enemies.forEach(en => {
        const el = document.createElement('div');
        el.className = 'games-room-enemy';
        el.setAttribute('data-enemy', en.id);
        el.style.left = en.x + 'px';
        el.style.top = en.y + 'px';
        el.innerHTML = '<i data-lucide="skull" class="w-3.5 h-3.5"></i><span>' + escapeHtml(en.word.en) + '</span>';
        arena.appendChild(el);
      });
      if (window.lucide) window.lucide.createIcons();
    }
    buildOptions() {
      const alive = this.enemies.filter(e => !e.dead);
      const opts = [];
      const seen = new Set();
      alive.forEach(e => {
        const key = enLow(firstMeaning(e.word.tr));
        if (!seen.has(key)) { seen.add(key); opts.push({ key: key, text: formatShortMeaning(e.word.tr, 26) }); }
      });
      const fill = shuffle(this.words);
      for (let i = 0; i < fill.length && opts.length < 4; i++) {
        const w = fill[i];
        const key = enLow(firstMeaning(w.tr));
        if (seen.has(key)) continue;
        if (alive.some(e => e.word.id === w.id)) continue;
        seen.add(key);
        opts.push({ key: key, text: formatShortMeaning(w.tr, 26) });
      }
      return shuffle(opts).slice(0, 6);
    }
    renderOptions() {
      const box = document.getElementById('defense-options');
      if (!box) return;
      const opts = this.buildOptions();
      box.innerHTML = opts.map(o => '<button class="game-option-btn py-2.5 text-sm" data-opt="' + escapeHtml(o.key) + '"><span>' + escapeHtml(o.text) + '</span></button>').join('');
      box.querySelectorAll('.game-option-btn').forEach(b =>
        b.addEventListener('click', () => this.fire(b.getAttribute('data-opt'))));
    }
    scheduleSpawn(delay) { this.setTimeoutTracked(() => this.spawnEnemy(), delay); }
    spawnEnemy() {
      if (this.ctx.isOver) return;
      const arena = document.getElementById('defense-arena');
      const h = arena ? arena.clientHeight : 200;
      const w = this.deck.next();
      if (!w) { this.endGame('Kelimeler Bitti'); return; }
      const lanes = Math.max(1, Math.floor((h - 40) / 46));
      const lane = Math.floor(Math.random() * lanes);
      this.enemies.push({ id: 'e' + Date.now() + Math.random().toString(36).slice(2, 5), word: w, x: 6, y: 8 + lane * 46, speed: this.enemySpeed + Math.random() * 0.25, dead: false });
      this.wave++;
      if (this.wave % 4 === 0) {
        this.enemySpeed = Math.min(2.4, this.enemySpeed + 0.18);
        this.spawnInterval = Math.max(1100, this.spawnInterval - 220);
      }
      this.renderEnemies();
      this.renderOptions();
      this.scheduleSpawn(this.spawnInterval);
    }
    startLoop() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      const tick = () => {
        if (this.ctx.isOver) return;
        const arena = document.getElementById('defense-arena');
        const limit = arena ? arena.clientWidth - 74 : 380;
        let changed = false;
        this.enemies.forEach(en => {
          if (en.dead) return;
          en.x += en.speed;
          const el = this.stage.querySelector('[data-enemy="' + en.id + '"]');
          if (el) el.style.left = en.x + 'px';
          if (en.x >= limit) {
            en.dead = true; changed = true;
            this.health -= 12;
            this.ctx.miss(en.word);
            this.ctx.stats.wrong++;
            this.ctx.combo = 0;
            if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
            const hb = document.getElementById('defense-health');
            if (hb) hb.style.width = Math.max(0, this.health) + '%';
            showToast('Kale hasar aldı! Kelime: ' + en.word.en, 'error');
          }
        });
        if (changed) {
          this.enemies = this.enemies.filter(e => !e.dead);
          if (this.health <= 0) { this.endGame('Kale Düştü!'); return; }
          this.renderEnemies();
          this.renderOptions();
        }
        this.rafId = trackRaf(requestAnimationFrame(tick));
      };
      this.rafId = trackRaf(requestAnimationFrame(tick));
    }
    fire(optKey) {
      if (this.ctx.isOver) return;
      const target = this.enemies.find(e => !e.dead && enLow(firstMeaning(e.word.tr)) === optKey);
      if (target) {
        target.dead = true;
        this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo);
        this.ctx.score += 15 * Math.min(5, this.ctx.combo);
        this.ctx.stats.correct++;
        if (typeof AudioService !== 'undefined') AudioService.playSfx('pop');
        this.enemies = this.enemies.filter(e => !e.dead);
        HUD.setScore(this.ctx.score);
        this.renderEnemies();
        this.renderOptions();
      } else {
        this.ctx.combo = 0;
        this.ctx.stats.wrong++;
        this.health -= 8;
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        const hb = document.getElementById('defense-health');
        if (hb) hb.style.width = Math.max(0, this.health) + '%';
        showToast('Iskaladın! -8 Kale canı', 'warning');
        if (this.health <= 0) { this.endGame('Kale Düştü!'); return; }
      }
    }
    endGame(title) {
      this.ctx.isOver = true;
      if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Kelime Savunması tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN 7: TELAFFUZLU HUNİ
  // ==========================================================================
  class WordFunnelGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words.filter(isAlphaWord);
      this.deck = createDeck(this.words);
      HUD.setTitle('Telaffuzlu Huni', 'Duyduğun kelimenin harflerini doğru sırayla yakala!');
      HUD.hideLives();
      this.newFunnel();
    }
    newFunnel() {
      if (this.ctx.isOver) return;
      const w = this.deck.next(); if (!w) { this.endGame('Kelimeler Bitti'); return; }
      this.target = w;
      this.answer = enUp(w.en).split('');
      this.filled = [];
      this.letters = this.buildLetterTiles();
      this.render();
      this.setTimeoutTracked(() => speakWordSafely(w.en), 350);
    }
    buildLetterTiles() {
      const answer = this.answer.slice();
      const extraCount = Math.min(4, Math.max(2, Math.round(answer.length / 2)));
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const extras = shuffle(alphabet.filter(c => answer.indexOf(c) === -1)).slice(0, extraCount);
      const tiles = answer.map(ch => ({ ch: ch, used: false }))
        .concat(extras.map(ch => ({ ch: ch, used: false })));
      return shuffle(tiles);
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      stage.innerHTML = `
        <div class="w-full max-w-lg flex flex-col items-center">
          <div class="games-room-funnel">
            <svg viewBox="0 0 100 80" class="w-full h-full stroke-cyan-400 stroke-2 fill-cyan-500/10"><polygon points="5,5 95,5 60,50 60,75 40,75 40,50" /></svg>
            <div class="games-room-funnel-btns">
              <button id="funnel-listen" class="games-room-listen-btn" title="Tekrar Dinle"><i data-lucide="volume-2" class="w-5 h-5"></i></button>
              <button id="funnel-slow" class="games-room-listen-btn games-room-listen-slow" title="Yavaş Dinle"><i data-lucide="turtle" class="w-5 h-5"></i></button>
            </div>
          </div>
          <div class="flex gap-2 mb-4 min-h-[46px] justify-center flex-wrap">
            ${this.answer.map((_, i) => {
              const ch = this.filled[i];
              return ch
                ? '<div class="games-room-slot games-room-slot-filled">' + escapeHtml(ch) + '</div>'
                : '<div class="games-room-slot games-room-slot-empty">_</div>';
            }).join('')}
          </div>
          <p class="text-xs text-slate-400 mb-3">Harfleri duyduğun sıraya göre yakala</p>
          <div class="flex flex-wrap gap-2 justify-center" id="funnel-tiles">
            ${this.letters.map((t, i) => `
              <button class="games-room-letter ${t.used ? 'games-room-letter-used' : ''}" data-tile="${i}" ${t.used ? 'disabled' : ''}>${escapeHtml(t.ch)}</button>
            `).join('')}
          </div>
        </div>`;
      this.afterRender();
      this.bind();
    }
    bind() {
      const l = document.getElementById('funnel-listen'); if (l) l.addEventListener('click', () => speakWordSafely(this.target.en));
      const s = document.getElementById('funnel-slow'); if (s) s.addEventListener('click', () => speakWordSafely(this.target.en, 0.6));
      this.stage.querySelectorAll('.games-room-letter[data-tile]').forEach(b =>
        b.addEventListener('click', () => this.tap(Number(b.getAttribute('data-tile')))));
      if (!this.stageKeyHandler) {
        this.onStageKeydown(e => {
          if (/^[a-zA-Z]$/.test(e.key)) this.tapLetter(enUp(e.key));
          else if (e.key === 'Backspace') { e.preventDefault(); this.undo(); }
        });
      }
    }
    tap(idx) {
      const t = this.letters[idx];
      if (!t || t.used) return;
      const next = this.answer[this.filled.length];
      if (t.ch === next) {
        t.used = true;
        this.filled.push(t.ch);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('click');
        if (this.filled.length === this.answer.length) { this.win(); return; }
        this.render();
      } else {
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        this.ctx.stats.wrong++;
        this.ctx.miss(this.target);
        const el = this.stage.querySelector('[data-tile="' + idx + '"]');
        if (el) { el.classList.add('games-room-letter-wrong'); setTimeout(() => el.classList.remove('games-room-letter-wrong'), 400); }
        showToast('Yanlış harf!', 'warning');
      }
    }
    tapLetter(letter) {
      const idx = this.letters.findIndex(t => !t.used && t.ch === letter);
      if (idx > -1) this.tap(idx);
    }
    undo() {
      if (this.filled.length === 0) return;
      const ch = this.filled.pop();
      const idx = this.letters.findIndex(t => t.used && t.ch === ch);
      if (idx > -1) this.letters[idx].used = false;
      this.render();
    }
    win() {
      this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo);
      this.ctx.score += 25 + Math.min(5, this.ctx.combo) * 5;
      this.ctx.stats.correct++;
      if (typeof AudioService !== 'undefined') AudioService.playSfx('win');
      showToast('Harika! Kelimeyi tamamladın.', 'success');
      this.setTimeoutTracked(() => this.newFunnel(), 900);
    }
    endGame(title) {
      this.ctx.isOver = true;
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Telaffuzlu Huni tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN 8: GÖLGE DİNLEME (DİKTE)
  // ==========================================================================
  class ShadowListeningGame extends BaseMiniGame {
    constructor(ctx, words) {
      super();
      this.ctx = ctx;
      this.words = words.filter(isAlphaWord);
      this.deck = createDeck(this.words);
      HUD.setTitle('Gölge Dinleme', 'Duyduğun kelimeyi eksiksiz yaz (dikte)');
      HUD.hideLives();
      this.nextWord();
    }
    nextWord() {
      if (this.ctx.isOver) return;
      const w = this.deck.next(); if (!w) { this.endGame('Kelimeler Bitti'); return; }
      this.target = w;
      this.answer = w.en;
      this.hintCount = 0;
      this.hintPenalty = 0;
      this.answered = false;
      this.render();
      this.setTimeoutTracked(() => speakWordSafely(w.en), 400);
    }
    render() {
      const stage = this.stage; if (!stage) return;
      HUD.setScore(this.ctx.score);
      const len = this.answer.length;
      const revealed = this.hintCount;
      stage.innerHTML = `
        <div class="w-full max-w-lg flex flex-col items-center">
          <div class="w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-6 text-center mb-4">
            <span class="text-[11px] uppercase tracking-widest text-indigo-400 font-semibold mb-3 block">Telaffuzu Dinleyin</span>
            <div class="flex items-center justify-center gap-3 mb-3">
              <button id="shadow-listen" class="games-room-listen-btn games-room-listen-big" title="Normal Dinle (1.0x)"><i data-lucide="volume-2" class="w-7 h-7"></i></button>
              <button id="shadow-slow" class="games-room-listen-btn games-room-listen-big games-room-listen-slow" title="Yavaş Dinle (0.65x)"><i data-lucide="turtle" class="w-7 h-7"></i></button>
            </div>
            <div class="flex items-center justify-center gap-1.5 mb-3 flex-wrap">
              ${Array.from({ length: len }).map((_, i) => '<span class="games-room-dict-slot">' + (i < revealed ? escapeHtml(this.answer[i]) : '_') + '</span>').join('')}
            </div>
            <p class="text-xs text-indigo-300">Türkçe İpucu: ${escapeHtml(this.target.tr)}</p>
          </div>
          <div class="w-full space-y-3 games-room-dict-area">
            <input type="text" id="shadow-input" placeholder="Duyduğun İngilizce kelimeyi yaz..."
              class="w-full bg-slate-900 border-2 border-slate-700 rounded-xl p-3.5 text-center text-lg font-bold text-white focus:outline-none focus:border-indigo-500"
              autocomplete="off" autocapitalize="none" spellcheck="false">
            <div class="grid grid-cols-2 gap-2.5">
              <button id="shadow-submit" class="py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition flex items-center justify-center gap-2">
                <i data-lucide="check" class="w-4 h-4"></i> Kontrol Et
              </button>
              <button id="shadow-hint" class="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold transition border border-slate-700 flex items-center justify-center gap-2">
                <i data-lucide="lightbulb" class="w-4 h-4"></i> İpucu Al
              </button>
            </div>
          </div>
        </div>`;
      this.afterRender();
      this.bind();
    }
    bind() {
      const l = document.getElementById('shadow-listen'); if (l) l.addEventListener('click', () => speakWordSafely(this.answer, 1.0));
      const s = document.getElementById('shadow-slow'); if (s) s.addEventListener('click', () => speakWordSafely(this.answer, 0.65));
      const sub = document.getElementById('shadow-submit'); if (sub) sub.addEventListener('click', () => this.check());
      const hint = document.getElementById('shadow-hint'); if (hint) hint.addEventListener('click', () => this.hint());
      const input = document.getElementById('shadow-input');
      if (input) {
        input.focus();
        input.addEventListener('keydown', e => { if (e.key === 'Enter') this.check(); });
      }
    }
    hint() {
      if (this.answered || this.hintCount >= this.answer.length - 1) return;
      this.hintCount++;
      this.hintPenalty += 8;
      this.render();
      const inp = document.getElementById('shadow-input');
      if (inp) { inp.value = this.answer.slice(0, this.hintCount); inp.focus(); }
    }
    check() {
      if (this.answered) return;
      const input = document.getElementById('shadow-input');
      const typed = enLow((input ? input.value : '').trim());
      const target = enLow(this.answer);
      this.answered = true;
      if (typed === target) {
        this.ctx.combo++; this.ctx.maxCombo = Math.max(this.ctx.maxCombo, this.ctx.combo);
        this.ctx.score += Math.max(5, 30 - this.hintPenalty) + Math.min(5, this.ctx.combo) * 4;
        this.ctx.stats.correct++;
        if (typeof AudioService !== 'undefined') AudioService.playSfx('correct');
        showToast('Tebrikler! Doğru dikte.', 'success');
        const stage = this.stage;
        const area = stage ? stage.querySelector('.games-room-dict-area') : null;
        if (stage && area && input) {
          input.disabled = true;
          const info = document.createElement('div');
          info.className = 'w-full mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center';
          info.innerHTML = '<p class="text-white font-bold">' + escapeHtml(this.answer) + '</p>'
            + '<p class="text-emerald-300 text-sm">' + escapeHtml(this.target.tr) + '</p>'
            + (this.target.example_en ? '<p class="text-slate-300 text-xs mt-1 italic">' + escapeHtml(this.target.example_en) + '</p>' : '');
          area.appendChild(info);
        }
        this.setTimeoutTracked(() => this.nextWord(), 1400);
      } else {
        this.ctx.combo = 0;
        this.ctx.stats.wrong++;
        this.ctx.miss(this.target);
        if (typeof AudioService !== 'undefined') AudioService.playSfx('wrong');
        showToast('Hatalı yazım. Doğrusu: ' + this.answer, 'error');
        this.setTimeoutTracked(() => this.nextWord(), 1500);
      }
    }
    endGame(title) {
      this.ctx.isOver = true;
      this.ctx.stats.maxCombo = this.ctx.maxCombo;
      renderGameOver(this.ctx, { title: title, subtitle: 'Gölge Dinleme tamamlandı', score: this.ctx.score, missed: this.ctx.missed });
    }
  }

  // ==========================================================================
  // OYUN KAYIT DEFTERİ VE BAŞLATMA MANTIĞI
  // ==========================================================================
  const REGISTRY = {
    'wordle':           { Cls: WordleGame,          title: 'Wordle',           min: 1, needsAlpha: true,  desc: 'Türkçe ipucu ile İngilizce kelimeyi bul.' },
    'lane-runner':      { Cls: LaneRunnerGame,      title: 'Şerit Koşusu',     min: 4, needsAlpha: false, desc: 'Doğru İngilizce kelimenin şeridine geç.' },
    'word-race':        { Cls: WordRaceGame,        title: 'Kelime Yarışı',    min: 4, needsAlpha: false, desc: 'Doğru kelime tüneline sür.' },
    'word-bomb':        { Cls: WordBombGame,        title: 'Kelime Bombası',   min: 1, needsAlpha: true,  desc: 'Fitil bitmeden harfleri doğru diz.' },
    'word-pop':         { Cls: WordPopGame,         title: 'Kelime Patlatma',  min: 4, needsAlpha: false, desc: 'İngilizce ve Türkçe eşleri patlat.' },
    'word-defense':     { Cls: WordDefenseGame,     title: 'Kelime Savunması', min: 4, needsAlpha: false, desc: 'Doğru anlama ateş ederek kaleyi koru.' },
    'word-funnel':      { Cls: WordFunnelGame,      title: 'Telaffuzlu Huni',  min: 1, needsAlpha: true,  desc: 'Huniden süzülen harfleri doğru sırayla yakala.' },
    'shadow-listening': { Cls: ShadowListeningGame, title: 'Gölge Dinleme',    min: 1, needsAlpha: true,  desc: 'Duyduğun kelimeyi eksiksiz yaz.' }
  };

  let activeInstance = null;
  let activeGameId = null;

  function getGameWords(gameId) {
    const cfg = REGISTRY[gameId];
    const store = (typeof WordStore !== 'undefined') ? WordStore : null;
    const raw = store ? store.getWords() : [];
    let normalized = raw.map(normalizeGameWord).filter(Boolean);
    if (cfg && cfg.needsAlpha) normalized = normalized.filter(isAlphaWord);
    return normalized;
  }

  function showLoading(gameId) {
    const cfg = REGISTRY[gameId];
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = '<div class="flex flex-col items-center justify-center gap-3 text-slate-300 py-10">'
      + '<div class="w-10 h-10 border-4 border-brand-500/30 border-t-brand-500 rounded-full games-room-spin"></div>'
      + '<p class="text-sm">' + (cfg ? escapeHtml(cfg.title) : 'Oyun') + ' hazırlanıyor...</p></div>';
  }

  function showRoomError(gameId, message) {
    const stage = document.getElementById('game-stage');
    if (!stage) return;
    stage.innerHTML = `
      <div class="text-center p-6 max-w-md">
        <div class="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 mx-auto flex items-center justify-center mb-4">
          <i data-lucide="alert-triangle" class="w-8 h-8"></i>
        </div>
        <h3 class="text-xl font-bold font-display text-white mb-2">Yeterli Kelime Yok</h3>
        <p class="text-slate-300 text-sm mb-4">${escapeHtml(message)}</p>
        <div class="flex items-center justify-center gap-3 flex-wrap">
          <button id="games-room-disable-filter" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition">Filtreyi Kapatıp Oyna</button>
          <button id="games-room-back-btn2" class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition">Oyun Odalarına Dön</button>
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    const dis = document.getElementById('games-room-disable-filter');
    if (dis) dis.addEventListener('click', () => {
      try {
        const toggle = document.getElementById('custom-study-filter-toggle');
        if (toggle) { toggle.checked = false; toggle.dispatchEvent(new Event('change')); }
        else if (typeof WordStore !== 'undefined') { WordStore.useOnlyStudyList = false; WordStore.notifyUpdate(); }
      } catch (e) {}
      launch(gameId);
    });
    const back = document.getElementById('games-room-back-btn2');
    if (back) back.addEventListener('click', () => openRoom());
  }

  function launch(gameId) {
    const cfg = REGISTRY[gameId];
    if (!cfg) { showToast('Bu oyun bulunamadı.', 'error'); return; }

    if (typeof AuthStore !== 'undefined' && (!AuthStore.user || !AuthStore.user.id)) {
      AuthStore.showGate();
      showToast('Oyun oynamak için lütfen önce giriş yapın.', 'warning');
      return;
    }

    cleanupActiveGame();
    if (activeInstance && typeof activeInstance.destroy === 'function') { try { activeInstance.destroy(); } catch (e) {} }
    activeInstance = null;
    activeGameId = gameId;

    const modal = document.getElementById('extra-games-modal');
    if (modal) modal.classList.add('hidden');

    const dashboard = document.getElementById('dashboard-view');
    const playView = document.getElementById('game-play-view');
    if (dashboard) dashboard.classList.add('hidden');
    if (playView) playView.classList.remove('hidden');

    HUD.capture();
    HUD.setTitle(cfg.title, cfg.desc);
    HUD.reset();

    const words = getGameWords(gameId);

    if (words.length === 0) {
      showRoomError(gameId, 'Bu oyun için uygun kelime bulunamadı. Lütfen kelime listenizi kontrol edin.');
      return;
    }
    if (words.length < cfg.min) {
      const studyOn = (typeof WordStore !== 'undefined') && WordStore.useOnlyStudyList;
      const msg = studyOn
        ? 'Seçtiğiniz kelimeler listesinde bu oyun için yeterli kelime yok (En az ' + cfg.min + ' kelime gerekli). Üst menüden filtreyi kapatabilir veya daha fazla kelime yıldızlayabilirsiniz.'
        : 'Bu oyunu oynamak için en az ' + cfg.min + ' kelime gerekli (Şu an: ' + words.length + '). Lütfen kelime ekleyin.';
      showRoomError(gameId, msg);
      return;
    }

    showLoading(gameId);

    trackTimeout(setTimeout(() => {
      try {
        const ctx = buildContext(gameId, cfg.title, cfg.desc);
        activeInstance = new cfg.Cls(ctx, words);
        if (window.lucide) window.lucide.createIcons();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        console.error('[GamesRoom] Oyun başlatma hatası:', err);
        showRoomError(gameId, 'Oyun başlatılamadı. Lütfen tekrar deneyin.');
      }
    }, 60));
  }

  function openRoom() {
    cleanupActiveGame();
    if (activeInstance && typeof activeInstance.destroy === 'function') { try { activeInstance.destroy(); } catch (e) {} }
    activeInstance = null;
    activeGameId = null;
    HUD.restore();
    HUD.reset();

    const playView = document.getElementById('game-play-view');
    const dashboard = document.getElementById('dashboard-view');
    if (playView) playView.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');

    const modal = document.getElementById('extra-games-modal');
    if (modal) modal.classList.remove('hidden');

    if (typeof updateHeaderBadges === 'function') { try { updateHeaderBadges(); } catch (e) {} }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ESC ile oyun odalarına dön (yalnızca arcade oyunu aktifken çalışır)
  globalKeyHandler = function (e) {
    if (e.key === 'Escape' && activeGameId) openRoom();
  };
  try { window.addEventListener('keydown', globalKeyHandler); } catch (e) {}

  return {
    launch: launch,
    openRoom: openRoom,
    getActiveGameId: function () { return activeGameId; },
    _internals: {
      normalizeGameWord: normalizeGameWord,
      formatShortMeaning: formatShortMeaning,
      firstMeaning: firstMeaning,
      isAlphaWord: isAlphaWord,
      enUp: enUp,
      enLow: enLow,
      shuffle: shuffle,
      createDeck: createDeck,
      readBestScore: readBestScore,
      writeBestScore: writeBestScore,
      registry: REGISTRY
    }
  };
})();

window.GamesRoomManager = GamesRoomManager;
window.launchArcadeGame = function (gameId) { GamesRoomManager.launch(gameId); };
window.openArcadeRoom = function () { GamesRoomManager.openRoom(); };


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
