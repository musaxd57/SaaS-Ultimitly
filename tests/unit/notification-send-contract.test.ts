import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// BİLDİRİM SÖZLEŞMESİ — `emailService.send` KAYNAKTA KULLANILMAZ.
// (Derin denetim, 2026-08-01 — üçüncü tur.)
//
// CLAUDE.md'nin CLAIM-THEN-NOTIFY kuralı bunu ZATEN söylüyordu ama yalnız METİN
// olarak; kaynakta hâlâ dört çağrı vardı ve bunlardan biri (raportörün KENDİSİ)
// tam da kuralın yasakladığı şeyi yapıyordu.
//
// `send()` ASLA FIRLATMAZ ve `void` döner: sağlayıcı hatasını yutup yalnız
// console'a yazar. Sonucunun okunamaması iki sınıf arıza doğurur:
//   1) SESSİZ KAYIP — atomik olarak "işaretlenmiş" bir satırın bildirimi düşer,
//      satır artık seçilemediği için iş KALICI kaybolur (gecikme değil).
//   2) ÖLÜ KORUMA — `send`i `try/catch`e sarmak koruma HİSSİ verir ama fırlatmaz,
//      yani catch dalı hiç çalışmaz (`/api/leads` tam olarak böyleydi).
//
// `sendReporting()` `{ok, error?}` döndürür → çağıran gerçekten karar verebilir.
//
// ⚠️ SINIR: bu bir KAYNAK TARAMASIDIR. "Sonucu okunuyor mu"yu bilmez, yalnız
// yanlış fonksiyonun çağrılmadığını bilir. Sonucun gerçekten okunduğunu davranış
// testleri pinler (`lifecycle-send-failure-alarm`, `escalation-email-retry`,
// `report-error`).
// ---------------------------------------------------------------------------

const ALLOWED = new Set(["src/lib/email-core.ts"]);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("bildirim sözleşmesi", () => {
  it("`emailService.send(` YALNIZ email-core.ts içinde geçebilir", async () => {
    const files = await walk("src");
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const src = await readFile(f, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        // Yorum satırları serbest: bu arızanın TARİHÇESİ birkaç yerde yazılı ve
        // o açıklamaların silinmesi tam da tekrar edilmesini kolaylaştırır.
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
        if (/emailService\s*\.\s*send\s*\(/.test(code)) offenders.push(`${f}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("`sendReporting` GERÇEKTEN sonuç döndürür (sözleşmenin diğer yarısı)", async () => {
    const src = await readFile("src/lib/email-core.ts", "utf8");
    // İmza değişip `Promise<void>`a dönerse tüm çağrı yerleri sessizce körleşir.
    expect(src).toMatch(/sendReporting\([\s\S]{0,200}?Promise<\{\s*ok:\s*boolean/);
  });

  it("raportörün kendisi de sözleşmeye uyuyor (kendi kuralını çiğniyordu)", async () => {
    const src = await readFile("src/lib/report-error-core.ts", "utf8");
    expect(src).toContain("emailService.sendReporting(");
    // Sonucun okunduğunu da pinle: dönüş tipi ReportOutcome olmalı.
    expect(src).toMatch(/reportError\([\s\S]{0,160}?Promise<ReportOutcome>/);
  });
});
