#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// KONTROLLÜ SENTRY TESTİ — prod'a DOKUNMAZ, veritabanı KULLANMAZ.
//
// Ne yapar: içine BİLEREK sahte PII ekilmiş (sahte e-posta, sahte token, sahte
// parola, sahte telefon) sentetik bir hata kurar, uygulamanın KENDİ redaksiyon
// fonksiyonundan (redactSensitive) geçirir ve uygulamanın KENDİ Sentry envelope
// istemcisiyle (captureToSentry — reportError'ın çağırdığı fonksiyonun ta
// kendisi) gönderir. Yani test edilen şey kopya değil, canlı kod yolu.
//
// Kullanım:  SENTRY_DSN=... npx tsx scripts/test-sentry-report.ts
//
// Sentry > Issues ekranında aranacak işaret bu scriptin çıktısında yazar.
// Kontrol listesi:
//   1. Event Issues'a düştü mü? (transaction = işaret)
//   2. Ekilen sahte değerlerin HİÇBİRİ görünmüyor olmalı — yerlerinde
//      [REDACTED] / [EMAIL] / [PHONE] / sk-[REDACTED] olmalı.
//   3. Gerçek bir e-posta/token/parola zaten hiç girilmedi — rapor tanım
//      gereği PII'siz.
// ---------------------------------------------------------------------------
import { captureToSentry, redactSensitive } from "../src/lib/report-error-core";

// Ekilen SAHTE değerler — hepsi uydurma, hiçbiri gerçek bir hesaba ait değil.
const PLANTED = {
  email: "sahte-misafir@example.com",
  token: "sk-testFAKE1234567890abcdefFAKE",
  password: 'password="CokGizliSahteParola99"',
  phone: "+90 555 000 11 22",
};

async function main() {
  if (!process.env.SENTRY_DSN?.trim()) {
    console.error("SENTRY_DSN tanımlı değil — test gönderilemez.");
    process.exitCode = 1;
    return;
  }

  // Base36: uzun rakam dizisi içermez → redaksiyonun [NUM] maskesine takılmaz,
  // işaret hem mesajda hem transaction'da aynen aranabilir kalır.
  const marker = `LIXUS-SENTRY-TEST-${Date.now().toString(36)}`;
  const err = new Error(
    `${marker} — sentetik test hatası. Ekili sahte PII: ${PLANTED.email} ${PLANTED.token} ${PLANTED.password} tel ${PLANTED.phone}`,
  );

  // reportError'ın yaptığının birebir aynısı: önce redakte, sonra gönder.
  const detail = redactSensitive(`${err.name}: ${err.message}\n${err.stack ?? ""}`);
  const message = redactSensitive(err.message);

  console.log("── Gönderilecek (redakte edilmiş) mesaj ──");
  console.log(message);
  console.log("──────────────────────────────────────────");

  // Yerel ön-kontrol: ekilen değerler redaksiyondan sağ çıkmamalı.
  const leaks = Object.entries(PLANTED).filter(([, v]) =>
    detail.includes(v.replace(/^password="/, "").replace(/"$/, "")),
  );
  if (leaks.length > 0) {
    console.error(`YEREL KONTROL BAŞARISIZ — şu ekili değerler redakte EDİLMEDİ: ${leaks.map(([k]) => k).join(", ")}`);
    console.error("Hiçbir şey gönderilmedi.");
    process.exitCode = 1;
    return;
  }
  console.log("Yerel redaksiyon kontrolü TEMİZ — ekili sahte PII'nin tamamı maskelendi.");

  await captureToSentry(`sentry-selftest ${marker}`, err.name, message, detail);
  console.log("");
  console.log("Zarf Sentry'ye POST edildi (2xx garantisi script veremez — istemci sessiz tasarım).");
  console.log(`ŞİMDİ KONTROL ET → Sentry > Issues içinde ara: ${marker}`);
  console.log("Event'te [EMAIL]/[REDACTED]/[PHONE] görmeli, sahte değerlerin kendisini GÖRMEMELİSİN.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
