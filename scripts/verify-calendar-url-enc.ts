#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// SALT-OKUMA doğrulayıcı — CalendarSource.url şifrelemesi (Faz 2/4 kontrolü).
//
// Hiçbir şey YAZMAZ. Her satırı tek tek açar ve raporlar:
//   • urlEnc NULL sayısı (backfill sonrası 0 beklenir)
//   • parmak izi uyuşmazlığı / çözülemeyen / düz-metinle birebir uyuşmayan
//
// Sayım yeterli değildir (Codex düzeltmesi): "kaç satır dolu" değil, "her
// satır GERÇEKTEN açılıyor ve düz metinle === eşit mi" sorusuna cevap verir.
//
// Kullanım:  DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/verify-calendar-url-enc.ts
//   --expect-complete : urlEnc NULL kalan satır da HATA sayılır (backfill
//                       sonrası ve Faz 4 öncesi bu bayrakla koşulur).
//
// Çıkış kodu: her şey temizse 0; herhangi bir uyuşmazlıkta 1.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import { verifyCalendarSourceUrlEnc } from "../src/lib/calendar-source-url-core";

const expectComplete = process.argv.includes("--expect-complete");
const prisma = new PrismaClient();

async function main() {
  const r = await verifyCalendarSourceUrlEnc(prisma);
  console.log("── CalendarSource.urlEnc doğrulaması (salt-okuma) ──");
  console.log(`toplam satır          : ${r.total}`);
  console.log(`urlEnc NULL (legacy)  : ${r.nullEnc}${expectComplete && r.nullEnc > 0 ? "  ← HATA (--expect-complete)" : ""}`);
  console.log(`tam doğrulanan (===)  : ${r.ok}`);
  console.log(`parmak izi uyuşmazlığı: ${r.fpMismatch}`);
  console.log(`çözülemeyen           : ${r.decryptFailed}`);
  console.log(`düz metinle uyuşmayan : ${r.plaintextMismatch}`);
  if (r.badIds.length > 0) console.log(`sorunlu satır id'leri : ${r.badIds.join(", ")}`);

  const hardFail = r.fpMismatch + r.decryptFailed + r.plaintextMismatch > 0;
  const completeFail = expectComplete && r.nullEnc > 0;
  if (hardFail || completeFail) {
    console.error("SONUÇ: BAŞARISIZ — yukarıdaki satırlar çözülmeden Faz 4'e GEÇİLMEZ.");
    process.exitCode = 1;
  } else {
    console.log(`SONUÇ: TEMİZ ✓${r.nullEnc > 0 ? ` (backfill bekleyen ${r.nullEnc} legacy satır var)` : " — tüm satırlar şifreli ve birebir doğrulandı"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
