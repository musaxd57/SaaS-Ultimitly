#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// KONTROLLÜ SENTRY + UYARI-EPOSTASI TESTİ — veritabanına DOKUNMAZ.
//
// GERÇEK `reportError`'ı çağırır (kopya değil): redaksiyon → Sentry envelope
// (SENTRY_DSN set'se) → uyarı e-postası (ERROR_ALERT_EMAIL/ALERT_EMAIL set'se,
// Resend/SMTP hangisi yapılandırıldıysa). Hata nesnesine BİLEREK sahte PII
// ekilir; gönderimden ÖNCE yerel kontrol bu değerlerin redaksiyondan sağ
// çıkmadığını doğrular — sızıntı varsa HİÇBİR ŞEY gönderilmez.
//
// Sentry gönderimi reportError içinde fire-and-forget'tir (void captureToSentry)
// → script, process kapanmadan isteğin tamamlanması için bekler (Codex şartı).
//
// Önerilen koşum yeri: Railway servis Console'u (gerçek env + gerçek ağ çıkışı):
//   npx tsx scripts/test-sentry-report.ts
// Yerelden de koşulabilir: SENTRY_DSN=... npx tsx scripts/test-sentry-report.ts
// ---------------------------------------------------------------------------
import { redactSensitive, reportError } from "../src/lib/report-error-core";

// Ekilen SAHTE değerler — hepsi uydurma, hiçbiri gerçek bir hesaba ait değil.
const PLANTED = {
  email: "sahte-misafir@example.com",
  token: "sk-testFAKE1234567890abcdefFAKE",
  password: "CokGizliSahteParola99",
  phone: "+90 555 000 11 22",
};

async function main() {
  const sentryOn = Boolean(process.env.SENTRY_DSN?.trim());
  const alertTo = process.env.ERROR_ALERT_EMAIL || process.env.ALERT_EMAIL;
  console.log(`SENTRY_DSN: ${sentryOn ? "SET → Sentry'ye gidecek" : "YOK → Sentry adımı atlanır"}`);
  console.log(`Uyarı e-postası: ${alertTo ? "SET → alert gidecek" : "YOK → e-posta adımı atlanır"}`);
  if (!sentryOn && !alertTo) {
    console.error("İkisi de tanımsız — test edilecek yol yok.");
    process.exitCode = 1;
    return;
  }

  // Base36: uzun rakam dizisi içermez → redaksiyonun [NUM] maskesine takılmaz,
  // işaret hem mesajda hem transaction'da aynen aranabilir kalır.
  const marker = `LIXUS-SENTRY-TEST-${Date.now().toString(36)}`;
  const err = new Error(
    `${marker} — sentetik test hatası. Ekili sahte PII: ${PLANTED.email} ${PLANTED.token} password="${PLANTED.password}" tel ${PLANTED.phone}`,
  );

  // Yerel ön-kontrol: reportError'ın uygulayacağı redaksiyonun AYNISI burada
  // önceden koşulur; ekilen değerlerden biri sağ çıkarsa gönderim İPTAL.
  const redacted = redactSensitive(`${err.name}: ${err.message}\n${err.stack ?? ""}`);
  const leaks = Object.entries(PLANTED).filter(([, v]) => redacted.includes(v));
  if (leaks.length > 0) {
    console.error(`YEREL KONTROL BAŞARISIZ — redakte EDİLMEYEN ekili değerler: ${leaks.map(([k]) => k).join(", ")}`);
    console.error("Hiçbir şey gönderilmedi.");
    process.exitCode = 1;
    return;
  }
  console.log("Yerel redaksiyon kontrolü TEMİZ — ekili sahte PII'nin tamamı maskeleniyor.");
  console.log("── Gönderilecek (redakte) mesaj ──");
  console.log(redactSensitive(err.message));
  console.log("──────────────────────────────────");

  await reportError(`sentry-selftest ${marker}`, err);

  // reportError e-postayı await eder ama Sentry POST'u fire-and-forget başlatır;
  // process hemen kapanırsa istek yarıda kesilir. Tamamlanması için bekle
  // (istemcinin kendi timeout'u 8 sn — 10 sn her durumu kapatır).
  console.log("Sentry gönderiminin tamamlanması bekleniyor (10 sn)...");
  await new Promise((r) => setTimeout(r, 10_000));

  console.log("");
  console.log("BİTTİ. Kontrol listesi:");
  console.log(`  1. Sentry > Issues içinde ara: ${marker}`);
  console.log("  2. Event'te [EMAIL]/[REDACTED]/[PHONE] görmeli, sahte değerlerin kendisini GÖRMEMELİSİN.");
  if (alertTo) console.log("  3. Uyarı e-postası kutusunu kontrol et (konu: 'Lixus AI sistem hatası — sentry-selftest ...') — içeriği de redaktedir.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
