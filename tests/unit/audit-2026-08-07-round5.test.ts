import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 7-AJANLIK DENETİM TURU (08-07 (5)) — testlerin kendisi, şema, middleware,
// panel, ayarlar formları, gelen kutusu, boot/CI.
// Yalnız KOD-DOĞRULANMIŞ ve ÖLÇÜLMÜŞ bulgular; gerisi CLAUDE.md'de karar maddesi.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Yorumları at — "yok" iddiaları yalnız GERÇEK KOD üzerinde anlamlıdır. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join("\n");

describe("🚨 ŞABLON YER TUTUCUSU — misafir adı KB sırrını enjekte edemez", () => {
  // ÖLÇÜLDÜ: eski kod `Object.entries` üzerinde döngüyor ve her anahtar, ÖNCEKİ
  // anahtarların YERİNE KOYDUĞU metni de yeniden tarıyordu. `guestName`
  // sağlayıcıdan gelir ve MİSAFİR KONTROLÜNDEDİR (Airbnb görünen adı).
  // Misafir adını `{{wifiInfo}}` yapınca, wifi yer tutucusu HİÇ GEÇMEYEN bir
  // şablon bile KB'nin wifi kalemini (host'a kapı kodunu oraya yazması söylenir)
  // host'un yazma alanına basıyordu.
  //
  // ⚠️ Bu, `conversation-thread.tsx applyTemplate`'in BİREBİR mantığıdır. Bileşen
  // içi özel fonksiyon olduğu için import edilemiyor; bu yüzden aşağıda AYRICA
  // kaynak taraması var (tek-geçiş biçimi korunuyor mu) — davranış testi tek
  // başına, üretim kodu eski döngüye dönerse yeşil kalırdı.
  function applyTemplate(tBody: string, vars: Record<string, string> | null): string {
    let body = tBody;
    if (vars) {
      body = body.replace(/\{\{(\w+)\}\}|\{(isim|ad)\}/g, (match, dblKey?: string, single?: string) => {
        const value = dblKey ? vars[dblKey] : single ? vars.guestName : undefined;
        return value ? value : match;
      });
    }
    return body.replace(/\{\{[^}]+\}\}/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  const SECRET = "SSID: Nuve3_5G / Sifre: Yaz2026! - Kapi kodu: 4590";
  const vars = (guestName: string) => ({
    guestName,
    propertyName: "Nuve 3",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    wifiInfo: SECRET,
  });

  it("misafir adı `{{wifiInfo}}` olsa bile sır SIZMAZ", () => {
    const out = applyTemplate("Merhaba {{guestName}}, {{propertyName}} girişiniz {{checkInTime}}.", vars("{{wifiInfo}}"));
    expect(out).not.toContain("4590");
    expect(out).not.toContain("Yaz2026");
  });

  it("tek-parantez `{isim}` yolu da enjekte edilemez", () => {
    const out = applyTemplate("Merhaba {isim}, görüşmek üzere.", vars("{{wifiInfo}}"));
    expect(out).not.toContain("4590");
  });

  it("ters yön: MEŞRU ikame hâlâ çalışıyor (aşırı kısıtlamadım)", () => {
    const out = applyTemplate("Merhaba {{guestName}}, {{propertyName}} girişiniz {{checkInTime}}.", vars("Ahmet"));
    expect(out).toBe("Merhaba Ahmet, Nuve 3 girişiniz 15:00.");
    // Wifi yer tutucusu AÇIKÇA yazılmışsa host onu görmek İSTİYOR demektir.
    expect(applyTemplate("Wifi: {{wifiInfo}}", vars("Ahmet"))).toContain("4590");
    // `{isim}` meşru kullanımı korunuyor.
    expect(applyTemplate("Merhaba {isim}!", vars("Ahmet"))).toBe("Merhaba Ahmet!");
  });

  it("doldurulmayan yer tutucu misafire HAM görünmez (eski temizlik korunuyor)", () => {
    expect(applyTemplate("Merhaba {{bilinmeyen}} son.", vars("Ahmet"))).toBe("Merhaba  son.");
  });

  it("kaynak TEK GEÇİŞ kullanıyor — sıralı split/join'e dönerse KIRMIZI", () => {
    const src = codeOnly(read("src/components/inbox/conversation-thread.tsx"));
    // ⚠️ ÇAPA KORUYUCUSU — `slice(indexOf(a), indexOf(b))` bulunamayan çapada
    // (-1) ya da TERS aralıkta SESSİZCE "" döndürür ve pin bir no-op'a dönüşür.
    // Bu testi yazarken tam olarak o oldu (bitiş çapası dosyada DAHA ÖNCE
    // geçiyordu). Aralığın gerçekten bulunduğunu ASSERTE et.
    const from = src.indexOf("function applyTemplate");
    const to = src.indexOf("\n  }", from);
    expect(from, "applyTemplate çapası bulunamadı — pin no-op olurdu").toBeGreaterThan(-1);
    expect(to, "fonksiyon sonu bulunamadı").toBeGreaterThan(from);
    const fn = src.slice(from, to);
    expect(fn.length, "aralık boş — pin no-op olurdu").toBeGreaterThan(200);
    expect(fn).toContain("body.replace(/\\{\\{(\\w+)\\}\\}|\\{(isim|ad)\\}/g");
    // Yeniden-tarama yapan eski biçim: her anahtar için ayrı split/join.
    expect(fn).not.toMatch(/for \(const \[key, value\] of Object\.entries/);
    expect(fn).not.toMatch(/body\.split\(`\{\{\$\{key\}\}\}`\)/);
  });
});

describe("🚨 ZAFİYET KAPISI: 'JSON ayrıştırılabildi' YETMEZ", () => {
  // npm audit ALTYAPI hatasında da `{` ile başlayan geçerli JSON basar
  // (ENOLOCK / ECONNREFUSED). Eski kod bunu ayrıştırıp `vulnerabilities`
  // anahtarını bulamıyor, "sıfır bulgu" sanıp kapıyı YEŞİL basıyordu — yani
  // tedarik zinciri kapısı HİÇBİR ŞEY denetlemeden yeşil diyordu.
  const src = read("scripts/audit-check.mjs");

  it("şekil doğrulaması VAR ve HER İKİ okuma yolunda koşuyor", () => {
    expect(src).toContain("function asAuditReport(");
    const code = codeOnly(src);
    // Başarılı yol + hata yolu: ikisi de ham JSON.parse döndürmemeli.
    expect(code).toMatch(/return asAuditReport\(\s*\n?\s*JSON\.parse\(execFileSync/);
    expect(code).toContain("return asAuditReport(JSON.parse(out));");
    expect(code).not.toMatch(/return JSON\.parse\(execFileSync/);
  });

  it("hem danışma haritasını HEM sayaçları ister (biri yetmez)", () => {
    // Yalnız birine bakmak yetmez: bazı hata payload'ları boş bir obje taşıyabilir.
    const fn = src.slice(src.indexOf("function asAuditReport("), src.indexOf("function main("));
    expect(fn).toContain("hasAdvisoryMap");
    expect(fn).toContain("hasCounters");
    expect(fn).toMatch(/if \(!hasAdvisoryMap \|\| !hasCounters\) return null;/);
  });
});

describe("nanoid yaması — üretim ağacında 3.3.18", () => {
  it("kilit dosyası yamalı sürümü pinliyor", () => {
    // İki `high` danışma (negatif/sıfır `size` ile sonsuz döngü) `next → postcss →
    // nanoid` üzerinden ÜRETİM ağacındaydı ve kapıyı kırmızı yapıyordu. Triaj
    // etmek yerine yamalandı: 3.3.12 → 3.3.18, aynı major, kırıcı değil.
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { version?: string }>;
    };
    const entries = Object.entries(lock.packages).filter(([k]) => k.endsWith("node_modules/nanoid"));
    expect(entries.length, "nanoid kilit dosyasında bulunamadı").toBeGreaterThan(0);
    for (const [name, meta] of entries) {
      const [maj, min, patch] = (meta.version ?? "0.0.0").split(".").map(Number);
      const atLeast = maj > 3 || (maj === 3 && (min > 3 || (min === 3 && patch >= 18)));
      expect(atLeast, `${name} = ${meta.version} — yamalı sürüm 3.3.18+`).toBe(true);
    }
  });
});

describe("ayarlar: alertEmail yorumu artık YALAN söylemiyor", () => {
  it("env ALERT_EMAIL'e düşüldüğü iddiası kaynakta YOK", () => {
    // Yorum "boş bırakınca env ALERT_EMAIL'e düşer" diyordu; depo 40 satır ötede
    // bunu SERT biçimde yasaklıyor (o adres operatörün kişisel kutusu). Gerçek
    // fallback org'un KENDİ en eski kullanıcısı. Yorumu düzelten şey kozmetik
    // değil: "restore" etmeye çalışan biri kiracı uyarılarını kurucuya yollardı.
    const src = read("src/app/api/settings/route.ts");
    const branch = src.slice(src.indexOf("update.alertEmail =") - 1200, src.indexOf("update.alertEmail =") + 80);
    expect(branch).not.toMatch(/falls back to the env ALERT_EMAIL/);
    // Kodun kendisi env'e HİÇ dokunmuyor (asıl değişmez).
    expect(codeOnly(src)).not.toContain("ALERT_EMAIL");
  });
});
