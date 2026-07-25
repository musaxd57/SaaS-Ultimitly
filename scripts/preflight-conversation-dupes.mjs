#!/usr/bin/env node
// ---------------------------------------------------------------------------
// SALT-OKUMA PREFLIGHT — Conversation @@unique([propertyId, externalReservationId])
//
// Codex'in şartı: unique migration'dan ÖNCE gerçeği ölç. Bu script HİÇBİR ŞEY
// YAZMAZ, HİÇBİR SATIR SİLMEZ ve HAM MİSAFİR VERİSİ BASMAZ. Yalnız sayar ve
// tek soruya cevap arar:
//
//   Aynı (propertyId, externalReservationId) üzerindeki birden fazla konuşma
//   YARIŞ ARTIĞI mı, yoksa sağlayıcının GERÇEKTEN ayrı thread'leri mi?
//
// AYIRT EDİCİ ÖLÇÜT: grup içindeki `externalConversationId` değerleri.
//   · hepsi AYNI ya da biri NULL  → yarış artığı; dedupe + unique DOĞRU yol
//   · GERÇEKTEN FARKLI            → sağlayıcı iki thread vermiş; bu unique YANLIŞ
//                                    olur, doğru anahtar externalConversationId
//                                    üzerinde kısmi (partial) unique olmalı
//
// KOD-DOĞRULAMASI (bu script'i çalıştırmadan ÖNCE yapıldı, sonucu kararı
// zaten büyük ölçüde veriyor — script bunu PROD VERİSİYLE teyit içindir):
//   1. `importThread` mevcut thread'i `findFirst({ propertyId,
//      externalReservationId })` ile arar — yani kod ZATEN "rezervasyon başına
//      tek konuşma"yı invariant kabul ediyor (hospitable-sync.ts).
//   2. Hospitable rezervasyon payload'ında `conversation_id` TEKİLDİR
//      (hospitable.ts: `conversation_id?: string | number`) — dizi değil.
//   3. `externalConversationId` TÜM kod tabanında tek bir yerde yazılır
//      (create) ve HİÇBİR yerde okunmaz/güncellenmez. Yani bugün fiilen
//      yaz-ve-unut bir kolon: sağlayıcı bir rezervasyonun conversation id'sini
//      değiştirse bizde bayat kalır ve hiçbir şey bunu fark etmez.
//      ⚠️ Bu, "partial unique'i externalConversationId üzerine kur" alternatifini
//      DOĞRUDAN ETKİLER: hiç tazelenmeyen + manuel/QR/iCal satırlarda NULL olan
//      bir kolon üzerine unique kurmak güvenli değildir. Önce yazıcıyı düzelt.
//
// KULLANIM (yedek ALINDIKTAN sonra, prod read-replica ya da snapshot tercih
// edilir):  DATABASE_URL=... node scripts/preflight-conversation-dupes.mjs
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Ham değer basmadan kimlik kıyaslamak için kısa, geri-döndürülemez etiket. */
async function main() {
  const out = (label, value) => console.log(`${label.padEnd(52)} ${value}`);

  console.log("\n=== Conversation duplicate preflight (SALT OKUMA) ===\n");

  const totals = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE "externalReservationId" IS NULL)::int AS no_ext_res,
           COUNT(*) FILTER (WHERE "externalConversationId" IS NULL)::int AS no_ext_conv
    FROM "Conversation"
  `;
  out("Toplam konuşma", totals[0].total);
  out("externalReservationId NULL (manuel/QR/iCal)", totals[0].no_ext_res);
  out("externalConversationId NULL", totals[0].no_ext_conv);

  // Yalnız unique'in KAPSAYACAĞI satırlar: NULL'lar Postgres'te distinct sayılır,
  // dolayısıyla manuel/QR satırları kısıtlamayı hiç ilgilendirmez.
  const groups = await prisma.$queryRaw`
    SELECT "propertyId", "externalReservationId",
           COUNT(*)::int AS rows,
           COUNT(DISTINCT "externalConversationId")::int AS distinct_conv_ids,
           COUNT(*) FILTER (WHERE "externalConversationId" IS NULL)::int AS null_conv_ids
    FROM "Conversation"
    WHERE "externalReservationId" IS NOT NULL
    GROUP BY "propertyId", "externalReservationId"
    HAVING COUNT(*) > 1
  `;

  console.log("");
  out("ÇAKIŞAN grup sayısı", groups.length);
  if (groups.length === 0) {
    console.log("\n✅ Çakışma YOK. Unique migration bu veriyle sorunsuz uygulanır.");
    console.log("   (Yine de sync tarafındaki kilit/P2002 sertleştirmesi ÖNCE gitmeli:");
    console.log("    unique tek başına yarışı çözmez, yalnız ikinci yazımı 500'e çevirir.)\n");
    return;
  }

  // Grupları SINIFLA — asıl karar burada.
  let raceArtifacts = 0; // aynı conv id ya da NULL → yarış artığı
  let genuinelyDistinct = 0; // farklı conv id → sağlayıcı ayrı thread vermiş
  for (const g of groups) {
    const distinctNonNull = g.distinct_conv_ids; // COUNT(DISTINCT) NULL saymaz
    if (distinctNonNull > 1) genuinelyDistinct++;
    else raceArtifacts++;
  }
  out("  → yarış artığı (aynı/NULL conversation id)", raceArtifacts);
  out("  → GERÇEKTEN farklı conversation id", genuinelyDistinct);

  // Dedupe planlaması için: taşınması gereken bağlı kayıt hacmi (sayı, içerik YOK).
  const impact = await prisma.$queryRaw`
    WITH dupes AS (
      SELECT "propertyId", "externalReservationId"
      FROM "Conversation"
      WHERE "externalReservationId" IS NOT NULL
      GROUP BY "propertyId", "externalReservationId"
      HAVING COUNT(*) > 1
    ), affected AS (
      SELECT c.id FROM "Conversation" c
      JOIN dupes d ON d."propertyId" = c."propertyId"
                  AND d."externalReservationId" = c."externalReservationId"
    )
    SELECT
      (SELECT COUNT(*)::int FROM affected) AS conversations,
      (SELECT COUNT(*)::int FROM "Message" m WHERE m."conversationId" IN (SELECT id FROM affected)) AS messages,
      (SELECT COUNT(*)::int FROM "MessageOutbox" o WHERE o."conversationId" IN (SELECT id FROM affected)) AS outbox
  `;
  console.log("");
  out("Etkilenen konuşma satırı", impact[0].conversations);
  out("  taşınacak mesaj", impact[0].messages);
  out("  taşınacak outbox kaydı", impact[0].outbox);

  console.log("\n--- KARAR ---");
  if (genuinelyDistinct > 0) {
    console.log("⛔ DUR. En az bir grupta GERÇEKTEN farklı conversation id var.");
    console.log("   @@unique([propertyId, externalReservationId]) bu veriyle YANLIŞTIR:");
    console.log("   meşru ayrı thread'leri birleştirmeye zorlar. Önce sağlayıcı");
    console.log("   davranışını doğrula, sonra doğru anahtarı externalConversationId");
    console.log("   üzerinde tasarla (⚠️ o kolon bugün hiç güncellenmiyor — ↑başlık).");
  } else {
    console.log("✅ Tüm çakışmalar yarış artığı görünüyor (farklı conversation id YOK).");
    console.log("   Aşamalı plan uygulanabilir: (1) sync kilidi + P2002-sonrası");
    console.log("   canonical yeniden-okuma, (2) FK+mesaj koruyan DRY-RUN dedupe,");
    console.log("   (3) yedek, (4) unique migration. Sırayı ATLAMA.");
  }
  console.log("");
}

main()
  .catch((e) => {
    // Hata metni bağlantı dizesi taşıyabilir → yalnız tip/isim.
    console.error(`[preflight] başarısız: ${e?.name ?? "Error"}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
