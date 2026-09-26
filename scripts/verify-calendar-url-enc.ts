#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// SALT-OKUMA doğrulayıcı — CalendarSource.url şifrelemesi.
//
// Hiçbir şey YAZMAZ. İki modu var:
//
// PRE-CONTRACT (varsayılan): her satırı açar, parmak izini ve çözülen değerin
// düz `url` kolonuyla === eşitliğini raporlar. Faz 2 sonrası / Faz 4 öncesi
// kontrol budur (--expect-complete ile NULL kalan satır da hata sayılır).
//
// POST-CONTRACT (--post-contract): contract SONRASI düz kolon sentinel taşır,
// === karşılaştırma tanım gereği imkânsızdır. Bu mod yerine post durumu
// asserte eder: her satırda url === sentinel VE urlEnc mevcut anahtarla
// GERÇEKTEN çözülüyor. Düz metin kalmış / çözülemeyen satır = hata.
//
// Sayım yeterli değildir (Codex düzeltmesi): iki mod da her satırı tek tek açar.
//
// Kullanım:  DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/verify-calendar-url-enc.ts [--expect-complete | --post-contract]
// Çıkış kodu: her şey temizse 0; herhangi bir uyuşmazlıkta 1.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import {
  verifyCalendarSourceUrlContract,
  verifyCalendarSourceUrlEnc,
} from "../src/lib/calendar-source-url-core";

const expectComplete = process.argv.includes("--expect-complete");
const postContract = process.argv.includes("--post-contract");
const prisma = new PrismaClient();

async function main() {
  if (postContract) {
    const r = await verifyCalendarSourceUrlContract(prisma);
    console.log("── CalendarSource.urlEnc doğrulaması (POST-CONTRACT, salt-okuma) ──");
    console.log(`toplam satır          : ${r.total}`);
    console.log(`sağlıklı (sentinel+çözülür): ${r.ok}`);
    console.log(`düz metin KALAN       : ${r.plaintextRemaining}`);
    console.log(`urlEnc NULL           : ${r.nullEnc}`);
    console.log(`parmak izi uyuşmazlığı: ${r.fpMismatch}`);
    console.log(`çözülemeyen           : ${r.decryptFailed}`);
    if (r.badIds.length > 0) console.log(`sorunlu satır id'leri : ${r.badIds.join(", ")}`);
    if (r.ok !== r.total) {
      console.error("SONUÇ: BAŞARISIZ — contract durumu eksik/bozuk.");
      process.exitCode = 1;
    } else {
      console.log("SONUÇ: TEMİZ ✓ — tüm satırlar sentinel'li ve şifreli değer çözülüyor.");
    }
    return;
  }

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
