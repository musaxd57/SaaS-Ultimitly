#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// SALT-OKUMA TEŞHİS — "hospitable-token-undecryptable" alarmının kapsamı.
//
// HİÇBİR ŞEY YAZMAZ. Prod verisine dokunmaz, hiçbir bağlantıyı kesmez, hiçbir
// satırı silmez. Yalnız iki tabloyu OKUR ve SAYAR.
//
// Çıktıda token, ciphertext, hash, e-posta, kullanıcı ya da org kimliği YOKTUR
// (çekirdek modül zaten yalnız sayı döndürür — basacak bir sır elde yok).
//
// Kullanım (Railway Console'dan veya yerel klondan prod DATABASE_URL ile):
//   DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/diagnose-hospitable-tokens.ts
//
// Hipotez sondası (OPSİYONEL, yine salt-okuma):
//   ...  ALT_DECRYPT_KEY=<AUTH_SECRET degeri>  npx tsx scripts/...
// `crypto-core.key()` sırası `ENCRYPTION_KEY || AUTH_SECRET`'tir → `ENCRYPTION_KEY`
// HENÜZ SET DEĞİLKEN yazılmış bir satır, anahtar sonradan eklendiğinde tam da bu
// hatayı verir. Sonda o hipotezi doğrular ya da çürütür.
//
// Çıkış kodu: çözülemeyen değer varsa 1, yoksa 0. (Ölçecek şey yoksa 1 —
// "hata yok" ile "veri yok" karıştırılmasın.)
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import {
  diagnoseHospitableTokens,
  verdictFor,
  type FieldCounts,
} from "../src/lib/hospitable-token-diagnostics-core";

const prisma = new PrismaClient();

function block(title: string, c: FieldCounts, altTried: boolean) {
  console.log(`\n${title}`);
  console.log(`  dolu satır                            : ${c.present}`);
  console.log(`  mevcut anahtarla COZULUYOR            : ${c.ok}`);
  console.log(`  COZULEMIYOR - kimlik dogrulama hatasi : ${c.authFailed}   (yanlis anahtar VEYA bozuk veri)`);
  console.log(`  COZULEMIYOR - bicim bozuk (v1 degil)  : ${c.malformed}`);
  if (altTried) {
    console.log(`  ...bunlardan ALTERNATIF anahtarla acilan: ${c.okUnderAltKey}`);
  }
}

async function main() {
  const alt = process.env.ALT_DECRYPT_KEY || undefined;
  const d = await diagnoseHospitableTokens(prisma, alt);

  console.log("== Hospitable token teshisi (SALT-OKUMA; sir basilmaz) ==");
  console.log(`Organization toplam                     : ${d.organizations}`);
  block("ERISIM TOKEN'I (hospitableTokenEnc)", d.accessToken, d.altKeyTried);
  block("REFRESH TOKEN (hospitableRefreshTokenEnc)", d.refreshToken, d.altKeyTried);
  block(
    "BAGIMSIZ ANAHTAR SONDASI (User.twoFactorSecret - AYNI sifreleme kutusu)",
    d.twoFactorSecret,
    d.altKeyTried,
  );

  const v = verdictFor(d);
  console.log("\n---------------------------------------------------------------");
  if (v === "clean") {
    console.log("HUKUM: TEMIZ - sifreli her deger mevcut anahtarla acildi.");
  } else if (v === "global_key_mismatch") {
    console.log("HUKUM: GENEL ANAHTAR UYUSMAZLIGI - hicbir deger acilamadi.");
    console.log("  => ENCRYPTION_KEY yanlis/degismis olabilir. ANAHTARI ROTATE ETME;");
    console.log("     kasadaki dogru degeri geri getir. Veri silme.");
  } else if (v === "isolated") {
    console.log("HUKUM: IZOLE - bazi degerler ACILIYOR, demek ki ANAHTAR DOGRU.");
    console.log("  => Sorun tek/az sayida satirda. Cozum SQL silme DEGIL:");
    console.log("     etkilenen kiraci urunun 'baglantiyi kes + yeniden bagla' yolunu kullanir.");
  } else {
    console.log("HUKUM: OLCULEMEDI - sifreli hic deger yok (sayilacak sey bulunamadi).");
  }
  if (d.altKeyTried) {
    const altHits = d.accessToken.okUnderAltKey + d.refreshToken.okUnderAltKey + d.twoFactorSecret.okUnderAltKey;
    console.log(
      altHits > 0
        ? `NOT: ${altHits} deger ALTERNATIF anahtarla acildi -> bu satirlar ENCRYPTION_KEY set edilmeden ONCE yazilmis.`
        : "NOT: alternatif anahtar hicbir satiri acmadi -> AUTH_SECRET fallback hipotezi ELENDI.",
    );
  }

  const bad =
    d.accessToken.authFailed +
    d.accessToken.malformed +
    d.refreshToken.authFailed +
    d.refreshToken.malformed +
    d.twoFactorSecret.authFailed +
    d.twoFactorSecret.malformed;
  if (bad > 0 || v === "inconclusive") process.exitCode = 1;
}

main()
  .catch((e) => {
    // Hata mesaji sifreli veri TASIMAZ (kutu sirri degil, yalnizca durumu basar).
    console.error("TESHIS BASARISIZ:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
