#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// SALT-OKUMA TEŞHİS — Tur 7 CAL-1: Lixus'un kendi takvim bağlantısı içe aktarma kaynağı olarak eklenmiş mi, kopyalar oluşmuş mu?
//
// HİÇBİR ŞEY YAZMAZ, HİÇBİR SATIR SİLMEZ (Codex / kurucu 11-05: "otomatik veri silme gerekmiyor"). Yalnız SAYAR:
//   · kimliği Lixus'un dışa aktarım soneki (`@guestops-ai`) ile biten rezervasyonlar (= kendi beslememizden geri içe alınmış kopyalar),
//   · durum satırında kendi besleme reddini taşıyan takvim kaynakları (düzeltmeden sonraki ilk senkronda yazılır).
// Çıktıda ad, adres, bağlantı ya da kimlik YOKTUR — yalnız sayılar ve daire başına adet (daire kimliği kısaltılmış değil, hiç yok).
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
