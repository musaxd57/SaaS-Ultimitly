#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// SALT-OKUMA TEŞHİS — Tur 7 CAL-1: Lixus'un kendi takvim bağlantısı içe aktarma kaynağı olarak eklenmiş mi, kopyalar oluşmuş mu?
//
// HİÇBİR ŞEY YAZMAZ, HİÇBİR SATIR SİLMEZ (Codex / kurucu 11-05: "otomatik veri silme gerekmiyor"). Yalnız SAYAR:
//   · kimliği Lixus'un dışa aktarım soneki (`@guestops-ai`) ile biten rezervasyonlar (= kendi beslememizden geri içe alınmış kopyalar),
//   · durum satırında kendi besleme reddini taşıyan takvim kaynakları (düzeltmeden sonraki ilk senkronda yazılır).
// Çıktıda ad, adres ya da bağlantı YOKTUR — sayılar + kayıt bulunursa etkilenen kaynakların OPAK kimlikleri ve önerilen işlem.
//
// Kullanım: DATABASE_URL=... npx tsx scripts/diagnose-own-feed-loop.ts
// Çıkış kodu: kopya ya da hatalı kaynak varsa 1, yoksa 0.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import { OWN_EXPORT_UID_SUFFIX, OWN_FEED_IMPORT_TEXT } from "../src/lib/export/own-feed";

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const copies = await prisma.reservation.groupBy({
      by: ["propertyId"],
      where: { sourceReference: { endsWith: OWN_EXPORT_UID_SUFFIX } },
      _count: { _all: true },
    });
    const loopSources = await prisma.calendarSource.count({ where: { lastResult: OWN_FEED_IMPORT_TEXT } });
    const total = copies.reduce((n, c) => n + c._count._all, 0);
    console.log(`Kendi beslememizden geri içe alınmış rezervasyon: ${total} (etkilenen daire: ${copies.length})`);
    console.log(`Kendi beslememiz eklendiği için 'hata' yazılmış takvim kaynağı: ${loopSources}`);
    if (copies.length > 0) console.log(`Daire başına adet: ${copies.map((c) => c._count._all).sort((a, b) => b - a).join(", ")}`);
    // Etkilenen kaynaklar (Codex 11-05 gece: "kayıt bulunursa etkilenen kaynaklar ve önerilen işlem gösterilsin"): yalnız OPAK kimlikler
    // (cuid) ve kopya adedi — bağlantı adresi, mülk adı, misafir adı YAZILMAZ. Kurucu kimlikle yönetim ekranından bakar.
    if (copies.length > 0 || loopSources > 0) {
      const bySource = await prisma.reservation.groupBy({
        by: ["calendarSourceId", "propertyId"],
        where: { sourceReference: { endsWith: OWN_EXPORT_UID_SUFFIX } },
        _count: { _all: true },
      });
      const flagged = await prisma.calendarSource.findMany({ where: { lastResult: OWN_FEED_IMPORT_TEXT }, select: { id: true, propertyId: true } });
      console.log("Etkilenen kaynaklar (takvim kaynağı kimliği · daire kimliği · kopya adedi):");
      for (const r of bySource) console.log(`  ${r.calendarSourceId ?? "(kaynaksız)"} · ${r.propertyId} · ${r._count._all}`);
      for (const f of flagged) if (!bySource.some((r) => r.calendarSourceId === f.id)) console.log(`  ${f.id} · ${f.propertyId} · 0 (yalnız 'hata' durumu)`);
      console.log(
        "Önerilen işlem (onayınızla, ayrı adımda): ① bu takvim kaynaklarını daireden kaldırın (Ayarlar → Daire → Takvim bağlantıları);" +
          " ② kopya rezervasyonları ev sahibiyle birlikte gözden geçirip iptal edin — gerçek rezervasyonla çakışan varsa önce gösterilir.",
      );
    }
    console.log("Hiçbir şey değiştirilmedi. Temizlik gerekiyorsa ev sahibiyle birlikte, ayrı ve onaylı bir adımda yapılır.");
    return total > 0 || loopSources > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Teşhis çalışamadı:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
