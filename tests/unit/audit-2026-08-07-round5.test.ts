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

  const SECRET = "SSID: Lale3_5G / Sifre: Yaz2026! - Kapi kodu: 4590";
  const vars = (guestName: string) => ({
    guestName,
    propertyName: "Lale 3",
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
    expect(out).toBe("Merhaba Ahmet, Lale 3 girişiniz 15:00.");
    // Wifi yer tutucusu AÇIKÇA yazılmışsa host onu görmek İSTİYOR demektir.
    expect(applyTemplate("Wifi: {{wifiInfo}}", vars("Ahmet"))).toContain("4590");
    // `{isim}` meşru kullanımı korunuyor.
    expect(applyTemplate("Merhaba {isim}!", vars("Ahmet"))).toBe("Merhaba Ahmet!");
  });

  it("doldurulmayan yer tutucu misafire HAM görünmez (eski temizlik korunuyor)", () => {
    expect(applyTemplate("Merhaba {{bilinmeyen}} son.", vars("Ahmet"))).toBe("Merhaba  son.");
  });

  it("kaynak TEK GEÇİŞ kullanıyor — sıralı split/join'e dönerse KIRMIZI", () => {
    // 🚨 KURAL TAŞINDI, PİN DE TAŞINDI (09-11): ikame mantığı artık saf modülde
    // (`src/lib/template-apply.ts`); bileşen yalnız `applyTemplateBody`yi çağırıyor.
    // Bu KAYNAK taraması artık kuralın YEDEĞİDİR — ASIL kanıt davranışsaldır
    // (`tests/unit/template-apply.test.ts`: "misafir adı {{wifiInfo}} ise wifi
    // kalemi SIZMAZ" + "misafir adı {daire} ise daire numarası ÜRETİLMEZ").
    const src = codeOnly(read("src/lib/template-apply.ts"));
    // ⚠️ ÇAPA KORUYUCUSU — `slice(indexOf(a), indexOf(b))` bulunamayan çapada
    // (-1) ya da TERS aralıkta SESSİZCE "" döndürür ve pin bir no-op'a dönüşür.
    // Bu testi yazarken tam olarak o oldu (bitiş çapası dosyada DAHA ÖNCE
    // geçiyordu). Aralığın gerçekten bulunduğunu ASSERTE et.
    const from = src.indexOf("export function applyTemplateBody");
    const to = src.indexOf("\n}", from);
    expect(from, "applyTemplateBody çapası bulunamadı — pin no-op olurdu").toBeGreaterThan(-1);
    expect(to, "fonksiyon sonu bulunamadı").toBeGreaterThan(from);
    const fn = src.slice(from, to);
    expect(fn.length, "aralık boş — pin no-op olurdu").toBeGreaterThan(200);
    // TEK `replace` çağrısı TEK bir birleşik kalıpla (çift parantez + tek parantez).
    expect(fn).toContain("out.replace(TOKENS,");
    // ⚠️ Kalıp artık TEK KAYNAKTAN kuruluyor (`TEMPLATE_VAR_SOURCE`), çünkü aynı
    // kalıp `kb-from-templates.ts`te AYRI yazılmış ve ikisi AYRIŞMIŞTI (inceleme
    // ajanı 09-11). Pin o yüzden düz metin eşitliği DEĞİL, kompozisyonu arar:
    // tek `TOKENS` sabiti + çift parantez sınıfının paylaşılan kaynağı.
    const applySrc = codeOnly(read("src/lib/template-apply.ts"));
    expect(applySrc).toContain("const TOKENS = new RegExp(`${TEMPLATE_VAR_SOURCE}");
    expect(applySrc, "çift parantez kalıbı yine ikinci kez elle yazılmış").toContain(
      "export const TEMPLATE_VAR_SOURCE",
    );
    // ⚠️ Pin DÜZ METİN EŞİTLİĞİ DEĞİL, NİYET ölçer (09-11 düzeltmesi): import
    // listesi büyüdüğünde (`ANY_DOUBLE_BRACE` de aynı modüle taşındı) eşitlik
    // kırılıyordu, oysa kural — "kalıbı yeniden yazma, paylaşılan kaynaktan al"
    // — DAHA İYİ karşılanıyordu. Ölçülen şey: sabit paylaşılan modülden geliyor
    // VE yerel bir kopyası yok.
    const kbFromTemplates = codeOnly(read("src/lib/kb-from-templates.ts"));
    expect(kbFromTemplates, "TEMPLATE_VAR_SOURCE paylaşılan modülden alınmıyor").toMatch(
      /import \{[^}]*TEMPLATE_VAR_SOURCE[^}]*\} from "\.\/template-apply";/,
    );
    expect(
      kbFromTemplates,
      "kb-from-templates kendi kalıbını yeniden yazmış (ayrışma riski geri geldi)",
    ).not.toMatch(/const (?:TEMPLATE_VAR_SOURCE|ANY_DOUBLE_BRACE)\s*=/);
    // 🚨 `{{…}}` SÜPÜRGESİ DE TEK KAYNAKTA (bu tur): iki yerde yazılmıştı ve
    // gönderici kapısı da aynı sınıfı kullanıyor — üç tüketici, tek kalıp.
    expect(applySrc).toContain("export const ANY_DOUBLE_BRACE");
    // Yeniden-tarama yapan eski biçim: her anahtar için ayrı split/join.
    expect(fn).not.toMatch(/for \(const \[key, value\] of Object\.entries/);
    expect(fn).not.toMatch(/\.split\(`\{\{\$\{key\}\}\}`\)/);
    // Bileşen kendi ikamesini YAPMAZ — kural tek yerde yaşar.
    const component = codeOnly(read("src/components/inbox/conversation-thread.tsx"));
    expect(component).toContain("applyTemplateBody(t.body, templateVars)");
    expect(component, "bileşen yeniden kendi ikamesini kurmuş").not.toMatch(/body\.replace\(\/\\\{\\\{/);
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

describe("🚨 iCal TZID artık ATILMIYOR — gün kayması kapandı", () => {
  // ÖLÇÜLDÜ (denetim 08-07 (6)): TZID anahtarın PARAMETRESİNDE geliyor ve
  // ayrıştırıcı onu okuyup ATIYORDU; saatli değer SUNUCUNUN dilimiyle kuruluyordu.
  // Railway UTC olduğu için `TZID=Europe/Istanbul:20260805T230000` →
  // `2026-08-05T23:00Z` oluyordu (doğrusu 20:00Z) ve org-yerel gün 6 AĞUSTOS'a
  // kayıyordu → panelde 5 Ağustos gecesi daire BOŞ görünüyor, çifte rezervasyon.
  // ⚠️ Airbnb/Booking `VALUE=DATE` yolladığı için ANA AKIŞ hiç etkilenmedi;
  // takvim formundaki "Diğer" seçeneği (Google Takvim / Vrbo / PMS) TZID yollar.
  const feed = (s: string, e: string) =>
    `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x@t\n${s}\n${e}\nSUMMARY:R\nEND:VEVENT\nEND:VCALENDAR`;
  const parse = async (s: string, e: string) => {
    const { parseIcs } = await import("@/lib/import/ics");
    return parseIcs(feed(s, e))[0];
  };

  it("TZID'li duvar saati DOĞRU UTC anına çevriliyor", async () => {
    const r = await parse("DTSTART;TZID=Europe/Istanbul:20260805T230000", "DTEND;TZID=Europe/Istanbul:20260808T110000");
    // 23:00 Istanbul = 20:00Z. Eski kod 23:00Z yazıyordu.
    expect(r.arrivalDate.toISOString()).toBe("2026-08-05T20:00:00.000Z");
    expect(r.departureDate.toISOString()).toBe("2026-08-08T08:00:00.000Z");
  });

  it("`Z` yolu değişmedi (referans)", async () => {
    const r = await parse("DTSTART:20260805T200000Z", "DTEND:20260808T080000Z");
    expect(r.arrivalDate.toISOString()).toBe("2026-08-05T20:00:00.000Z");
  });

  it("VALUE=DATE (Airbnb ANA AKIŞ) birebir aynı kaldı — öğlen çapası", async () => {
    const r = await parse("DTSTART;VALUE=DATE:20260805", "DTEND;VALUE=DATE:20260808");
    expect(r.arrivalDate.toISOString()).toBe("2026-08-05T12:00:00.000Z");
    expect(r.departureDate.toISOString()).toBe("2026-08-08T12:00:00.000Z");
  });

  it("BİLİNMEYEN TZID öğlen çapasına düşer — saat kaybolur, GÜN doğru kalır", async () => {
    // `tzOffsetMs` geçersiz dilimde 0 döner = sessizce UTC. O hâlde 23:00 yine
    // günü kaydırırdı; bu yüzden geçersiz dilimde saati bilerek atıyoruz.
    const r = await parse("DTSTART;TZID=Mars/Olympus:20260805T230000", "DTEND;TZID=Mars/Olympus:20260808T110000");
    expect(r.arrivalDate.toISOString()).toBe("2026-08-05T12:00:00.000Z");
  });

  it("floating (Z yok, TZID yok) da öğlen çapası — sunucu dilimine BAĞLANMAZ", async () => {
    const r = await parse("DTSTART:20260805T230000", "DTEND:20260808T110000");
    expect(r.arrivalDate.toISOString()).toBe("2026-08-05T12:00:00.000Z");
  });

  it("geçersiz takvim günü hâlâ REDDEDİLİYOR (UTC getter'lara geçince bozulmadı)", async () => {
    const { parseIcs } = await import("@/lib/import/ics");
    expect(parseIcs(feed("DTSTART;VALUE=DATE:20260231", "DTEND;VALUE=DATE:20260305")).length).toBe(0);
  });

  it("tarih-only artık SUNUCU dilimine bağlı değil (Date.UTC)", async () => {
    const src = codeOnly(read("src/lib/import/ics.ts"));
    expect(src).toContain("new Date(Date.UTC(year, month, day, 12, 0, 0))");
    expect(src).not.toContain("new Date(year, month, day, 12, 0, 0)");
    expect(src).toContain("getUTCFullYear()"); // guard da UTC frame'de
  });
});

describe("panel gezinme + kurulum rehberi kalıcılığı", () => {
  it("🚨 geri bağlantısı AÇIK YÖNLENDİRMEYE kapalı", () => {
    // `from` istemciden gelir. `startsWith("/inbox")` TEK BAŞINA yetmez:
    // `//evil.tld` protokol-göreli bir DIŞ adrestir ve `/inbox@evil.tld` de
    // vardır. Kabul edilen tek biçim: tam `/inbox` ya da `/inbox?` öneki.
    const accept = (raw: string | undefined) =>
      raw === "/inbox" || (raw?.startsWith("/inbox?") ?? false) ? raw! : "/inbox";
    for (const bad of ["//evil.tld", "https://evil.tld", "/inbox@evil.tld", "/inboxevil", "javascript:alert(1)", undefined]) {
      expect(accept(bad), String(bad)).toBe("/inbox");
    }
    for (const ok of ["/inbox", "/inbox?status=problem", "/inbox?status=problem&sayfa=2"]) {
      expect(accept(ok)).toBe(ok);
    }
    // Üretim kodu AYNI kuralı uyguluyor mu?
    const src = codeOnly(read("src/app/(app)/inbox/[id]/page.tsx"));
    expect(src).toContain('rawFrom === "/inbox" || (rawFrom?.startsWith("/inbox?") ?? false)');
    // Liste, bulunduğu filtreyi bağlantıya koyuyor mu?
    const list = codeOnly(read("src/app/(app)/inbox/page.tsx"));
    expect(list).toContain("?from=${encodeURIComponent(hrefFor({}))}");
  });

  it("🚨 kurulum rehberi bir kez bitince KALICI gizlenir", () => {
    // Kart yalnız `allDone` iken gizleniyordu → host otomatik yanıtı sonradan
    // kapatınca 5/6'ya düşüp GERİ GELİYORDU (kullanıcı bildirdi).
    const src = codeOnly(read("src/components/onboarding-guide.tsx"));
    expect(src).toContain('const COMPLETED_KEY = "lixus_onboarding_completed"');
    // Mühür kapısı `allDone` kontrolünden ÖNCE gelmeli — sonra gelseydi
    // 5/6 durumunda kart yine çizilirdi.
    const gateIdx = src.indexOf("if (completedBefore === null || completedBefore) return null;");
    const allDoneIdx = src.indexOf("if (allDone && !justAdvanced) return null;");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(allDoneIdx).toBeGreaterThan(gateIdx);
    // Mühür AYRI effect'te basılır: ilk effect'te basılsaydı aynı render'da
    // gizlenir ve host kutlamayı HİÇ göremezdi.
    expect(src).toMatch(/if \(completedBefore !== false \|\| doneCount !== steps\.length\) return;/);
  });

  it("kutlama: roket UÇAR, kutu yerinde kalır, hareket kapalıysa susar", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("translateY(-64px)"); // roket kutunun dışına çıkar
    expect(css).toContain(".lxo-launch-box { position: relative; overflow: visible; }");
    // prefers-reduced-motion bloğu HER ÜÇ parçayı da kapsamalı: eleman
    // animasyonu, `::after` halkası ve tik. Biri unutulursa kutlama hareket
    // kapalıyken de oynar.
    const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toContain(".lxo-check");
    expect(rm).toContain(".lxo-launch-box::after");
    expect(rm).toMatch(/\.lxo-launch \{ animation: none;/);
  });
});
