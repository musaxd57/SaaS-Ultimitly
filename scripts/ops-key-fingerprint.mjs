#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ŞİFRELEME ANAHTARI PARMAK İZİ (gece-4 S10-11; Railway açılış belgesi §0 madde 2).
//
// Amaç: kasadaki ENCRYPTION_KEY ile Railway'deki değer AYNI mı — değeri ekrana basmadan karşılaştırmak. Yanlış anahtar Hospitable
// bağlantılarını, takvim besleme adreslerini ve 2FA sırlarını sessizce okunamaz yapar (CLAUDE.md: ENCRYPTION_KEY ROTASYONU ASLA).
//
// Kullanım:
//   node scripts/ops-key-fingerprint.mjs            → ortamdaki ENCRYPTION_KEY / AUTH_SECRET (Railway kabuğunda)
//   node scripts/ops-key-fingerprint.mjs --stdin    → kasadaki değeri yapıştırın (kabuk geçmişine düşmez), Enter + Ctrl+D
// Çıktı yalnız SHA-256 özetinin ilk 8 onaltılık hanesidir (32 bit): değeri geri çıkarmaya yetmez, iki değerin aynı olduğunu gösterir.
// Uygulamanın kullandığı sıra `crypto-core.key()` ile aynı: ENCRYPTION_KEY, yoksa AUTH_SECRET. Değer KIRPILMAZ (uygulama da kırpmaz);
// başında / sonunda boşluk varsa ayrıca uyarılır.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Değerin parmak izi: SHA-256 özetinin ilk 8 onaltılık hanesi. */
export function fingerprint(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 8);
}

/** Uygulamanın kullanacağı kaynak + parmak izi satırları (değer asla yazılmaz). */
export function describeKeys(env) {
  const lines = [];
  const enc = env.ENCRYPTION_KEY;
  const auth = env.AUTH_SECRET;
  const row = (name, v) => {
    if (!v) return `${name}: tanımlı değil`;
    const spaced = v !== v.trim() ? " · ⚠️ başında / sonunda boşluk var (uygulama kırpmaz — kasadakiyle birebir mi kontrol edin)" : "";
    return `${name}: parmak izi ${fingerprint(v)}${spaced}`;
  };
  lines.push(row("ENCRYPTION_KEY", enc));
  lines.push(row("AUTH_SECRET", auth));
  lines.push(enc ? "Uygulama ENCRYPTION_KEY kullanır." : auth ? "⚠️ ENCRYPTION_KEY yok → uygulama AUTH_SECRET'tan türetir." : "⚠️ İkisi de yok → şifreli alanlar okunamaz.");
  return lines;
}

async function main() {
  if (process.argv.includes("--stdin")) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    // Yapıştırmanın sonundaki tek satır sonu değerin parçası değildir; geri kalan aynen.
    const value = data.replace(/\r?\n$/, "");
    if (!value) {
      console.log("Değer okunmadı.");
      process.exitCode = 1;
      return;
    }
    console.log(`Yapıştırılan değer: parmak izi ${fingerprint(value)}`);
    return;
  }
  for (const line of describeKeys(process.env)) console.log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
