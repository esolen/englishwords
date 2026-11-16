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
- `api/_db.js` — `getPool`, `ensureTables`, `parseBody`.

## Kritik kurallar

- Kelime havuzu **her zaman** dinamik: `WordStore.getWords()` (filtre aktifse yalnızca study-list).
  Sabit kelime dizisi / sabit indeks aralığı eklemeyin.
- "Zorlu Kelimeler" istatistiği **tek kaynak**: yanlış cevap anında `WordStore.recordMistake(id, game)`
  → `/api/words/wrong` + `AuthStore.recordStatToBackend()` → `/api/statistics/update`.
  Oyun sonunda tekrar kaydetmeyin (mükerrer sayım olur).
- "Ekstra Oyunlar Odası" (arcade) ve "Düşen Kelimeler" **kaldırıldı**; geri eklemeyin.
  Kelime Bombası artık ana ekranda bağımsız karttır ve **4 şıklı hızlı yarış** mekaniğiyle
  çalışır (fitil + 3 can + 2x2 şık paneli). Eski harf dizme/kutucuk arayüzünü geri eklemeyin.
- Seviye ilerlemesi yalnızca sunucu `leveled_up` döndüğünde (ilgili seviyenin TÜM kelimeleri
  tamamlanınca) yükselir; başarılı ama eksik testte aynı seviyede sonraki 10 kelime gelir.
- Test/quiz sırası Fisher-Yates ile karıştırılır; şık sırası da her soruda karışır.

## Test / doğrulama

- Sözdizimi: `node --check app.js` (ve `api/**/*.js`).
- Tarayıcı testi için mock sunucu: `node /tmp/mock_server.js` (port 12000).
  Work host: https://work-1-iswcdsjxvnhqoike.prod-runtime.all-hands.dev/ (12000).
- jsdom ile gerçek `app.js` yüklenip test edilebilir (`window.eval(appSrc)`); `url:` verilmezse
  localStorage opaque-origin hatası verir.

## Bilinen tuzaklar

- `hwords-main` dosyası eski commit'lerde vardı, çalışma ağacından kaldırılmıştır; geri eklemeyin.
- Türkçe `I/İ` dönüşümleri için `enUp`/`enLow` (İngilizce locale) kullanın; `toUpperCase()` yanlış sonuç verir.
