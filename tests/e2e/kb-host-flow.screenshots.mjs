// Host arayüzü ekran görüntüsü üretici (A3/A4/A5 kanıtı, 09-08).
//
// TESTİN YERİNE GEÇMEZ: burada assertion yok, yalnız görüntü alınır. Amaç
// kurucunun "host bilgiyi nasıl daha kolay giriyor?" sorusuna EKRANDAN yanıt
// vermek. Playwright suite'inin (`tests/e2e/*.spec.ts`) parçası DEĞİLDİR —
// `.mjs` uzantısı bilinçli, CI onu toplamaz.
//
// Çalıştırma (uygulama 3100'de ayakta olmalı):
//   node tests/e2e/kb-host-flow.screenshots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3100";
const OUT = "docs/olcum/ekran";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log("çekildi:", name);
}

await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@guestops.ai");
await page.fill("#password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 30_000 });

await page.goto(`${BASE}/knowledge`);
await page.waitForSelector("text=Bilgi Tabanı", { timeout: 20_000 });
await page.waitForTimeout(800);
await shot("01-bilgi-tabani-kurulum-ve-eksikler");

// "Şablonla doldur" → formun DOLDUĞU an.
const fill = page.getByRole("button", { name: /Şablonla doldur/ }).first();
if (await fill.count()) {
  await fill.click();
  await page.waitForTimeout(500);
  await shot("02-sablonla-doldur-form-doldu");
}

// "Metinden bilgi çıkar" → yapıştır → önizleme.
await page.getByRole("button", { name: "Aç" }).first().click();
await page.waitForTimeout(300);
await page.fill(
  "#kb-import-text",
  [
    "Merhaba {isim}, dairemize hoş geldiniz!",
    "Otopark bina altındadır ve misafirlerimiz için ücretsizdir.",
    "Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.",
    "Çıkış saati 11:00'dir.",
    "Dairede sigara içilmez, evcil hayvan kabul edilmez.",
  ].join("\n"),
);
await page.getByRole("button", { name: "Önizle" }).click();
await page.waitForTimeout(500);
await page.getByText(/satır atlandı/).click().catch(() => {});
await page.waitForTimeout(300);
await shot("03-metinden-bilgi-cikar-onizleme");

await browser.close();
console.log("bitti →", OUT);
