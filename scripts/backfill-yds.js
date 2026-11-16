#!/usr/bin/env node
/**
 * YDS Sınıflandırma Migrasyon Betiği
 *
 * Veritabanındaki TÜM kelimeleri YDS standartlarına göre kalıcı olarak
 * sınıflandırır ve zenginleştirir. HİÇBİR VERİ SİLİNMEZ.
 *
 * Kullanım:
 *   DATABASE_URL=postgres://... node scripts/backfill-yds.js
 *   DATABASE_URL=... node scripts/backfill-yds.js --user 1        # tek kullanıcı
 *   DATABASE_URL=... node scripts/backfill-yds.js --force         # tümünü yeniden
 *   DATABASE_URL=... node scripts/backfill-yds.js --dry-run       # yazmadan rapor
 */

const { getPool, ensureTables, backfillYdsLevels, ydsDistribution } = require('../api/_db');
const { LEVEL_LABELS } = require('../api/_yds');

function parseArgs(argv) {
  const args = { user: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') args.user = parseInt(argv[++i], 10);
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function printDistribution(dist, title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(60));
  const levels = (dist && dist.levels) ? dist.levels : dist;
  let total = 0;
  for (let lv = 1; lv <= 5; lv++) {
    const count = levels[lv] || 0;
    total += count;
    console.log(`  Seviye ${lv} (${LEVEL_LABELS[lv]}): ${count} kelime`);
  }
  console.log('─'.repeat(60));
  console.log(`  TOPLAM: ${total} kelime`);
  return total;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const pool = getPool();
  if (!pool) {
    console.error('HATA: DATABASE_URL tanımlı değil. Veritabanı bağlantısı kurulamadı.');
    process.exit(1);
  }

  try {
    console.log('Şema kontrol ediliyor (yeni YDS alanları ekleniyor)...');
    await ensureTables();

    if (args.dryRun) {
      const dist = await ydsDistribution(pool, args.user);
      console.log('\n[DRY-RUN] Hiçbir kayıt değiştirilmedi.');
      printDistribution(dist, 'Mevcut YDS Seviye Dağılımı:');
      process.exit(0);
    }

    console.log(`\nYDS sınıflandırması çalıştırılıyor${args.user ? ` (kullanıcı: ${args.user})` : ' (tüm kullanıcılar)'}${args.force ? ' [force]' : ''}...`);
    const result = await backfillYdsLevels(pool, { userId: args.user, force: args.force });

    console.log(`\nTaranan kayıt: ${result.scanned}, güncellenen: ${result.updated}`);
    printDistribution(result.distribution, 'YDS Seviye Dağılımı (kalıcı):');

    console.log('\n✅ YDS sınıflandırması tamamlandı. Hiçbir kelime/ID/istatistik silinmedi.');
    process.exit(0);
  } catch (err) {
    console.error('Migrasyon hatası:', err);
    process.exit(1);
  }
})();
