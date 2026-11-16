# AGENTS.md — englishwords

Türkçe-İngilizce kelime öğrenme PWA'sı. Vanilla JS (tek `app.js`) + Tailwind (CDN) frontend,
Vercel serverless fonksiyonları (`api/*.js`) + Neon PostgreSQL backend.

## Mimari haritası

- `index.html` — tüm görünümler ve modallar (dashboard, `#game-play-view`, `#game-stage`,
  `#word-db-modal`). Asset cache-busting: `style.css?v=`, `app.js?v=`.
- `app.js` — tek dosya. Bölümler:
  - `WordStore` — kelime havuzu, `studyList` (yıldızlı), `useOnlyStudyList` filtresi,
    `getWords()` / `getAllWords()` / `recordMistake()` / `recordSuccess()`.
  - `AuthStore` — oturum (`wordplay_user_session_v1`), `recordStatToBackend()`.
  - `GAMES{}` — modül kayıt tablosu. `launchGame(id)` / `closeGame()` yönlendirici.
  - `StepByStepLessonsGame` — "Kolaydan Zora" modülü (kartlar + 5 şıklı test).
  - `HangmanGame` (Adam Asmaca) ve `WordBombGame` (Kelime Bombası) — bağımsız modüller.
    Her ikisi de `getHangmanPool()` / `getWordBombPool()` ile yalnızca 3-10 harfli, tek
    kelimelik İngilizce kelimeleri (ve aktifse study-list filtresini) kullanır.
  - `TimeAttackGame` — 30/60/90/120 sn süre seçim ekranlı.
- `api/lessons/index.js` — GET (ders üret) / POST (sonuç, seviye ilerlemesi, reset).
- `api/lessons/_engine.js` — SAF motor: zorluk sınıflandırma, örnek cümle, 5 şıklı test,
  tekrarsız seçim. **Hardcoded kelime dizisi içermez**; havuz çağıran taraftan gelir.
  Kelimede kalıcı `yds_level` (1..5) varsa seviye bölünmesi doğrudan onu kullanır.
- `api/_yds.js` — **YDS sınıflandırma & zenginleştirme motoru** (saf, DB'siz):
  `yds_level` (1..5), `part_of_speech`, `synonyms`, YDS bağlamlı doğal `example_en/tr`.
  `classifyWord(word, allWords)` tek giriş noktasıdır.
- `api/_db.js` — `getPool`, `ensureTables`, `parseBody`, `backfillYdsLevels`, `ydsDistribution`.
- `scripts/backfill-yds.js` — kalıcı migrasyon: `DATABASE_URL=... node scripts/backfill-yds.js`
  (`--user`, `--force`, `--dry-run`). Hiçbir satırı SİLMEZ; yalnızca YDS alanlarını doldurur.

## Kritik kurallar

- Kelime havuzu **her zaman** dinamik: `WordStore.getWords()` (filtre aktifse yalnızca study-list).
  Sabit kelime dizisi / sabit indeks aralığı eklemeyin.
- "Zorlu Kelimeler" istatistiği **tek kaynak**: yanlış cevap anında `WordStore.recordMistake(id, game)`
  → `/api/words/wrong` + `AuthStore.recordStatToBackend()` → `/api/statistics/update`.
  Oyun sonunda tekrar kaydetmeyin (mükerrer sayım olur).
- "Ekstra Oyunlar Odası" (arcade) ve "Düşen Kelimeler" **kaldırıldı**; geri eklemeyin.
  Kelime Bombası artık ana ekranda bağımsız karttır ve **4 şıklı hızlı yarış** mekaniğiyle
  çalışır (fitil + 3 can + 2x2 şık paneli). Oyun açılışta **fitil süresi seçim ekranı** gösterir
  (Hızlı 10 sn / Normal 15 sn / Uzun 20 sn / Rahat 25 sn); fitil çubuğu ve sayaç seçilen süreye
  ölçeklenir. Eski harf dizme/kutucuk arayüzünü geri eklemeyin.
- Seviye ilerlemesi yalnızca sunucu `leveled_up` döndüğünde (ilgili seviyenin TÜM kelimeleri
  tamamlanınca) yükselir; başarılı ama eksik testte aynı seviyede sonraki 10 kelime gelir.
- Test/quiz sırası Fisher-Yates ile karıştırılır; şık sırası da her soruda karışır.
- Kelime Bombası fitili **`Date.now()` bazlı geri sayım** kullanır (`startFuse`): `endTime = now + süre*1000`.
  Süre asla `step = duration * (tickMs/1000)` gibi çarpılarak hesaplanmaz — bu eski hata tüm süreleri
  ~1 saniyede bitiriyordu. Seçilen süre `selectedFuseDuration`'da tutulur ve her soruda sıfırlanır.

## Test / doğrulama

- Sözdizimi: `node --check app.js` (ve `api/**/*.js`).
- Tarayıcı testi için mock sunucu: `node /tmp/mock_server.js` (port 12000).
  Work host: https://work-1-iswcdsjxvnhqoike.prod-runtime.all-hands.dev/ (12000).
- jsdom ile gerçek `app.js` yüklenip test edilebilir (`window.eval(appSrc)`); `url:` verilmezse
  localStorage opaque-origin hatası verir.

## Bilinen tuzaklar

- `hwords-main` dosyası eski commit'lerde vardı, çalışma ağacından kaldırılmıştır; geri eklemeyin.
- Türkçe `I/İ` dönüşümleri için `enUp`/`enLow` (İngilizce locale) kullanın; `toUpperCase()` yanlış sonuç verir.

## Kelime yükleme sağlamlığı (arayüz boş kalma hatası)

- **Kök neden:** Tek bir bozuk DB satırı (boş `english`/`turkish`) `WordStore.setWords → notifyUpdate →
  renderWordsTable` zincirinde `undefined.toLowerCase()` hatası fırlatıyordu. `fetchUserWords` catch'i
  ise hatayı "çekme hatası" sanıp `WordStore.setWords([])` ile **tüm listeyi siliyordu** → arayüz boş.
- **Kural:** `WordStore.setWords()` bozuk/eksik alanlı kayıtları ayıklar; `notifyUpdate()` render hatasını
  yutar (state korunur); `fetchUserWords` yalnızca **kelimeler çekilemezse** listeyi temizler
  (`fetched` bayrağı). Arayüzdeki her DOM erişimi `if (el)` ile korunur.
- Tüm `w.en`/`w.tr` erişimlerinde `String(w.en || '')` kullanın; DB'den `null/undefined` gelebilir.

## Kelime Türü Filtresi (KALDIRILDI)

- Global "Kelime Türü" filtresi (`WordStore.posFilter`, `#global-pos-filter`, `global_pos_filter_v1`)
  **tamamen kaldırıldı** — istek üzerine. `getWords()` artık kelime türüne göre filtreleme yapmaz;
  yalnızca bozuk kayıtları ayıklar ve "Sadece Seçtiğim Kelimelerle Çalış" filtresini uygular.
- Geri eklemeyin. `resolveWordPos()` / `posLabelTr()` yardımcıları SADECE gösterim ve çeldirici
  seçimi için (Çoktan Seçmeli) hâlâ kullanılmaktadır; filtreleme amacıyla kullanılmamalıdır.

## Çoktan Seçmeli Test (multiple-choice)

- 15 soruluk oturum; `seenSessionWordIds` ile görülmüş kelimeler atlanır (Diğer Teste Geç = 0 kesişim).
- Ayarlar `QuizSettings` (`mc_quiz_settings_v1`): yön (`en-to-tr`/`tr-to-en`/`mixed`) + klavye kısayolları.
- Çeldiriciler `pickDistractorWords()` ile aynı `resolveWordPos` türünden seçilir (yoksa diğerlerinden).
- Klavye dinleyicisi constructor'da eklenir, `destroy()`'da kaldırılır (bellek sızıntısı yok).

## Eşleştirme (matching)

- Zorluk: kolay 6 / orta 10 / zor 14 çift. Rekorlar `matching_best_times_v1` (zorluk bazlı).
- Kronometre `_startTimer`/`_stopTimer`; `destroy()` timer + `_matchTimeout` temizler.
- İngilizce karta tıklayınca `AudioService.speak()`; doğru → yeşil kilit, yanlış → `shakeWrong`.

## Dashboard kart düzeni

- `DashboardLayout` (`dashboard_card_order`, `dashboard_locked_cards`) + `DashboardLayoutUI` (DnD + touch).
- Düzenleme modu kapalıyken kart tıklaması normal çalışır; açıkken `editing` guard tıklamayı engeller.
- `DEFAULT_CARD_ORDER` **index.html DOM sırasıyla birebir** olmalı (12 kart): flashcards, multiple-choice,
  difficult-words, fill-blanks, word-bomb, time-attack, hangman, step-by-step-lessons, matching,
  true-false, handwriting, pronunciation. `resetLayout()` bu diziye göre sıralar.

## Çalışma Havuzu Filtreleri (Özel + Zorlu)

- `WordStore` iki bağımsız filtre tutar: `useOnlyStudyList` ("Sadece Seçtiğim Kelimelerle Çalış")
  ve `useOnlyDifficult` ("Sadece Zorlu Kelimelerle Çalış"). İkisi **birlikte** açıkken havuz
  **birleşim (union)** olur (ikisi de değilse tüm kelimeler).
- `getWords()` → aktif filtreli havuz (soru/oyun kelimeleri buradan gelir).
- `getDistractorPool()` → filtrelerden bağımsız tüm geçerli kelimeler (durum güncelleme, kelime arama).
- `getQuizDistractorPool()` → önce filtreli havuz, yetmezse genel havuzla tamamlanır (çeldirici üretimi).
- `prioritizedShuffle(list)` → zorlu kelimeleri (wrongCount>0) havuzun önüne alır; filtre kapalıyken
  bile zorlu kelimeler oyunlarda öne çıksın. Tüm oyun constructor'larında `shuffleArray` yerine kullanılır.
- Çeldirici/soru üretiminde asla `getWords()` (filtreli) yerine sabit havuz kullanmayın.

## "Bunu Öğrendim (Zorlu Listesinden Çıkar)" butonu

- `hardWordLearnButtonHtml(word)` yalnızca kelime zorlu ise buton HTML'i döner; `isWordInHardList()` kontrol eder.
- Tıklama → `learnHardWordHandler` → `WordStore.learnHardWord(word)`: yerel `wrongCount=0` +
  `localStorage.learned_hard_words_v1` (çevrimdışı yedek) + `/api/words/wrong` remove.
- Tüm oyunlara ve `StepByStepLessonsGame` (kart + test aşaması) enjekte edilmiştir. DifficultWordsGame'in
  kendi butonu (`#diff-mastered-btn`) da `learnHardWord` kullanır.

## Kolaydan Zora (Dersler) API

- GET `/api/lessons` → `study_only` + `difficult_only` (birleşim) destekler. Seçili havuz < 10 kelime ise
  **mini ders** (tüm aktif havuz) üretilir ve `warning`/`is_mini` döner.
- İstenen seviye boşsa kelime içeren en yakın seviyeye düşülür (`effectiveLevel` fallback).
- POST `/api/lessons` → `difficult_only` gövde alanını kabul eder; seviye tamamlanması aktif havuzdan hesaplanır.
