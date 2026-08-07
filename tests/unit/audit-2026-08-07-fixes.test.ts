import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildIcsCalendar } from "@/lib/export/ics";
import { isDefinitiveSendFailure } from "@/lib/messaging";
import { taskUpdateSchema } from "@/lib/validators";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// 14 AJANLIK GÜVENLİK TURUNDA (08-07) KAPATILAN AÇIKLARIN PİNLERİ.
// Hepsi ÖLÇÜLEREK bulundu; buradaki testler o ölçümlerin donmuş hâlidir.
// ---------------------------------------------------------------------------

describe("iCal dışa aktarımı — satır enjeksiyonu", () => {
  // `escapeIcsText` eskiden `\r?\n` ile kaçışlıyordu, yani TEK BAŞINA `\r`
  // (LF'siz CR) ham olarak beslemeye giriyordu. Feed HERKESE AÇIK ve
  // Airbnb/Booking/Google okuyor; CR'yi satır sonu sayan bir ayrıştırıcıda
  // sahte VEVENT enjekte edilebilirdi.
  it("TEK BAŞINA CR de kaçışlanır — çıktıda ham kontrol karakteri kalmaz", () => {
    const out = buildIcsCalendar("Daire\rEND:VCALENDAR\rX-EVIL:1", [
      {
        uid: "u1",
        start: new Date("2026-09-01"),
        end: new Date("2026-09-05"),
        allDay: true,
        summary: "Ali\rEND:VEVENT\rBEGIN:VEVENT\rSUMMARY:SAHTE",
        description: "not\rX-EVIL:2",
      },
    ]);
    // Satırları ayıran CRLF dışında HİÇ ham CR kalmamalı.
    expect(out.match(/\r(?!\n)/g)).toBeNull();
    // Enjekte edilmeye çalışılan satırlar kendi başlarına satır olmamalı.
    expect(out.split(/\r\n/).filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(out).not.toMatch(/^SUMMARY:SAHTE$/m);
  });

  it("diğer C0 kontrol karakterleri düşürülür (RFC 5545 metin değerlerinde yasak)", () => {
    const out = buildIcsCalendar("Daire\u0000\u0007\u001B", []);
    expect(out).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  });

  it("meşru içerik bozulmaz (ters yön)", () => {
    const out = buildIcsCalendar("Nuve Daire 3", [
      {
        uid: "u1",
        start: new Date("2026-09-01"),
        end: new Date("2026-09-05"),
        allDay: true,
        summary: "Ayşe Yılmaz",
        description: "Kanal: airbnb",
      },
    ]);
    expect(out).toContain("X-WR-CALNAME:Nuve Daire 3");
    expect(out).toContain("SUMMARY:Ayşe Yılmaz");
  });
});

describe("isDefinitiveSendFailure — kardeş okuyucularla AYNI sonucu vermeli", () => {
  // `sendMessage` hatayı `"… (HTTP <status>): <sağlayıcı gövdesi>"` diye kuruyor.
  // Konumdan bağımsız `.test()` gövdedeki sahte bir `HTTP 4xx`'i de yakalıyordu:
  // 5xx yanlışlıkla DEFINITIVE sayılınca claim geri alınıyor → misafire ÇİFT
  // mesaj; 4xx yanlışlıkla AMBIGUOUS sayılınca mesaj bir daha DENENMİYOR.
  const firstMatch = (e: string) => /HTTP (\d{3})/.exec(e)?.[1];

  it("5xx + gövdede 'HTTP 404' → AMBIGUOUS (yeniden gönderim yok)", () => {
    const err = 'Hospitable API hatası (HTTP 500): {"msg":"upstream HTTP 404"}';
    expect(firstMatch(err)).toBe("500");
    expect(isDefinitiveSendFailure(err)).toBe(false);
  });

  it("4xx + gövdede 'HTTP 408' → DEFINITIVE (kalıcı hata, yeniden denenir)", () => {
    const err = 'Hospitable API hatası (HTTP 400): {"msg":"retry HTTP 408"}';
    expect(firstMatch(err)).toBe("400");
    expect(isDefinitiveSendFailure(err)).toBe(true);
  });

  it("gerçek 404 definitive, gerçek 408 ve ağ hatası ambiguous (ters yön)", () => {
    expect(isDefinitiveSendFailure("Hospitable API hatası (HTTP 404): yok")).toBe(true);
    expect(isDefinitiveSendFailure("Hospitable API hatası (HTTP 408): timeout")).toBe(false);
    expect(isDefinitiveSendFailure("fetch failed")).toBe(false);
    expect(isDefinitiveSendFailure(null)).toBe(false);
  });
});

describe("photoUrl — ters bölü ile dış origin'e kaçış", () => {
  // WHATWG URL ayrıştırıcısı özel şemalarda `\`'yi `/`'ye çevirir, yani
  // `/\evil.com` protokol-göreli kapısını delip `https://evil.com/`e çözülüyordu.
  const ok = (photoUrl: string) => taskUpdateSchema.safeParse({ photoUrl }).success;

  it("ters bölülü ve protokol-göreli değerler reddedilir", () => {
    for (const v of ["/\\evil.com/x.png", "//evil.com/x.png", "/\t\\evil.com/x.png"]) {
      expect(ok(v), v).toBe(false);
      // Reddedilenlerin gerçekten dış origin'e çözüldüğünü de pinliyoruz —
      // yoksa test "zaten zararsız bir şeyi" engelliyor olabilirdi.
      expect(new URL(v, "https://app.lixusai.com").origin).toBe("https://evil.com");
    }
  });

  it("meşru değerler kabul edilir (ters yön)", () => {
    expect(ok("/api/storage/photo/a/b/c/d/e.png")).toBe(true);
    expect(ok("https://cdn.example.com/a.png")).toBe(true);
  });
});

describe("QR sır kapısı — giriş ismi + 4+ rakam", () => {
  // Kalıplar bir "kod/şifre/pin" KELİMESİ arıyordu; host "Kapı: 4590" yazınca
  // hiçbiri eşleşmiyor ve kalem QR istemine giriyordu (elle ekleme formunun
  // varsayılan kategorisi `general`, yani kategori elemesi de kurtarmıyor).
  // 🚨 EŞİK 4 RAKAM: "Giriş saati 15:00" ve "Kapı 3. katta" QR'ın ASIL işi;
  // "herhangi bir sayı" deseydik özellik işe yaramaz hâle gelirdi.
  // ⚠️ Pin DAVRANIŞSAL, kaynak taraması DEĞİL: `looksLikeSecret` dışa açık
  // değil ama `scrubStyleProfileForPublic` onu SATIR SATIR uyguluyor, yani
  // her satır tek bir sır kararıdır. Kaynak taraması yalnız "kalıp duruyor mu"
  // diyebilirdi; bu, kalıbın GERÇEKTEN ne yakalayıp ne yakalamadığını ölçer.
  const ATTACKS = [
    "Kapı: 4590",
    "Anahtar kutusu 7788",
    "keybox 8842",
    "Door 9021",
    "Gate 40021",
    "Giriş: 1234",
    "Bina kapısı 4590, sonra 3. kat",
    "kapi 5566",
    "lock 4321",
    "entry 9999",
    "KAPI 4590",
  ];
  // 🚨 Bu satırlar QR concierge'in ASIL işidir — elenirlerse özellik ölür.
  // ⚠️ LİSTE BİLEREK "RAKAM DOLU": ilk yazımda buraya yalnız rakamsız/zararsız
  // cümleler koymuştum ve "8/8 meşru geçti" diye ÖLÇTÜM — oysa kalıbın asıl
  // zararı tam da RAKAM TAŞIYAN meşru içerikteydi ve o külliyat onu göremiyordu.
  // Adres · telefon · posta kodu · yıl · daire numarası artık ŞART: kalıp
  // serbest-metin araya izin verecek şekilde gevşetilirse ALTISI birden düşer
  // (ölçüldü) ve misafir "adres ne?" diye sorduğunda AI'ın elinde adres kalmaz.
  const LEGITIMATE = [
    "Moda Cad. No:12 Kapı 3, 34710 Kadıköy",
    "Apartman girişindeki güvenlik 0212 555 4433",
    "Giriş 15:00, geç giriş için 0532 111 2233 arayın",
    "Daire kapı numaramız 1203",
    // ⚠️ "kapıcı" (apartman görevlisi) `kap[ıi]\w*` tarafından KAPSANIYOR ve
    // telefonu Türkçe'de öbekli yazılıyor — ilk öbek "0532" TAM 4 hane, yani
    // üst sınır kurtarmıyor. Bu üç satır `(?![\s\-.]\d)` korumasını pinler.
    "Kapıcı 0532 111 2233",
    "Kapıcı: 0212 555 4433",
    // Bitişik yazılan 11 haneli telefon → ÜST SINIRI (`{4,8}`) pinler.
    "Kapıcı 05321112233",
    "Kapı 05321112233",
    "Giriş katındaki market 2024 yılında açıldı",
    "Apartman giriş aidatı 2025 yılında 1500 TL",
    "Havalimanından kapıya taksi yaklaşık 850 TL",
    "Girişte 7/24 market var, telefonu 0216 444 5566",
    "Kapıdan çıkınca sola, 500 metre ileride metro var",
    "Giriş saati 15:00, çıkış 11:00",
    "Kapı 3. katta, asansör sağda",
    "Kapalı otopark 2. bodrumda, yer no 42",
    "Misafire her zaman siz diye hitap et",
    "Kapıyı sertçe çekmek gerekiyor",
  ];

  it("giriş ismi + 4+ rakam taşıyan satırlar ELENİR", () => {
    for (const line of ATTACKS) {
      expect(scrubStyleProfileForPublic(line), line).toBeNull();
    }
  });

  it("meşru rakamlı içerik GEÇER — adres/telefon/posta kodu/yıl (ters yön)", () => {
    // İki gevşetme de bu testi kırmızıya çevirir:
    //  · `\d{4,}` → `\d+`  (saatler, kat numaraları elenir)
    //  · bitişiklik → `[^.\n]{0,20}` (adres, telefon, yıl elenir — ÖLÇÜLDÜ: 6/12)
    // Aşırı-eleme burada "güvenli yön" DEĞİL, özelliğin kendisidir.
    for (const line of LEGITIMATE) {
      expect(scrubStyleProfileForPublic(line), line).toBe(line);
    }
  });

  it("karışık rehberde yalnız sırlı satır düşer, gerisi kalır", () => {
    const profile = ["Kısa ve sıcak yaz", "Kapı: 4590", "Giriş saati 15:00"].join("\n");
    expect(scrubStyleProfileForPublic(profile)).toBe("Kısa ve sıcak yaz\nGiriş saati 15:00");
  });

  it("BİLGİ TABANI kalem biçiminde (`başlık\\nicerik`) de doğru karar verilir", () => {
    // 🚨 BURASI ASIL BAHİS. `looksLikeSecret` bilgi tabanında KALEMİN TAMAMINA
    // uygulanıyor (`guest-chat.ts`: `kbRaw.filter(k => !looksLikeSecret(
    // \`${k.title}\\n${k.content}\`))`) ve eşleşen kalem KOMPLE düşüyor — satır
    // satır değil. Yani "Adres" kalemindeki tek bir posta kodu, ADRESİN
    // TAMAMINI misafirin sorabileceği bağlamdan siliyordu.
    // Aşağıdaki yardımcı aynı yüklemi kalem biçiminde ölçer: sırlı içerik
    // düşerse `null`/kısalma, meşru içerik aynen döner.
    const asItem = (title: string, content: string) =>
      scrubStyleProfileForPublic(`${title}\n${content}`);

    // Meşru kalemler BÜTÜN olarak hayatta kalmalı.
    for (const [t, c] of [
      ["Adres", "Moda Cad. No:12 Kapı 3, 34710 Kadıköy"],
      ["Acil durum", "Apartman girişindeki güvenlik 0212 555 4433"],
      ["Check-in", "Giriş 15:00, geç giriş için 0532 111 2233 arayın"],
      ["Daire", "Daire kapı numaramız 1203"],
    ] as const) {
      expect(asItem(t, c), `${t} kalemi düştü`).toBe(`${t}\n${c}`);
    }

    // Gerçek erişim kodu taşıyan kalemde içerik satırı DÜŞMELİ.
    for (const [t, c] of [
      ["Giriş", "Kapı: 4590"],
      ["Anahtar", "Anahtar kutusu 7788"],
    ] as const) {
      expect(asItem(t, c), `${t} sırrı sızdı`).not.toContain(c);
    }
  });
});

describe("kaynak pinleri — geri alınması KOLAY ama tehlikeli düzeltmeler", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("mülk sayfası ham `Host` başlığından mutlak URL KURMAZ", () => {
    // Sayfa `icalToken` ve `chatToken` taşıyan iki mutlak URL üretiyor; ham
    // Host ile kurulunca sahte bir başlık bu bearer sırları saldırgan alan
    // adına yazdırıyordu (host onu kopyalayıp Airbnb'ye yapıştırıyor).
    const src = read("src/app/(app)/properties/[id]/page.tsx");
    expect(src).toContain("baseUrlFromHost(");
    expect(src).not.toMatch(/\$\{protocol\}:\/\/\$\{host\}/);
  });

  it("test-email operatörün env adresine DÜŞMEZ", () => {
    // `ALERT_EMAIL` operatörün kişisel adresi: kiracının ekranına basılıyor ve
    // dakikada 5 kez oraya posta attırılabiliyordu. Deponun kendi kuralı bunu
    // `automation.ts` ve `guest-chat-alerts.ts`'te zaten yasaklıyor.
    // ⚠️ Yorum satırları elenir: dosyanın AÇIKLAMASI o env adını anlatıyor,
    // aranan şey KOD'daki fallback ifadesi.
    const code = read("src/app/api/settings/test-email/route.ts")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(code).toContain("const to = org?.alertEmail?.trim();");
    expect(code).not.toMatch(/process\.env\.ALERT_EMAIL/);
  });

  it("giriş formu `next`i ORIGIN karşılaştırmasıyla doğrular, karakter listesiyle değil", () => {
    // TAB/LF/CR karakterlerini URL ayrıştırıcısı SİLİYOR → önek kara listesi
    // (`//`, `/\`) delinebiliyordu. Doğru yöntem sonucu sınamak.
    const src = read("src/components/auth/login-form.tsx");
    expect(src).toContain("u.origin === window.location.origin");
    expect(src).not.toMatch(/next\.startsWith\("\/\/"\)/);
  });

  it("mülk API'leri bearer token'ları yanıttan çıkarır", () => {
    // ⚠️ UCUZ ERKEN UYARI — GARANTİ DEĞİL. `toContain` fonksiyonun AYNI
    // DOSYADAKİ TANIMIYLA tatmin oluyor, yani her çağrı yeri silinse bile bu
    // test YEŞİL kalıyor (ölçüldü). GERÇEK pin:
    // `tests/integration/api-secret-exposure.test.ts` — rotaları çağırıp
    // yanıtta `icalToken`/`chatToken` ANAHTARINI ve DEĞERİNİ birden arar.
    for (const rel of ["src/app/api/properties/route.ts", "src/app/api/properties/[id]/route.ts"]) {
      const src = read(rel);
      expect(src, rel).toContain("stripPropertySecrets");
      expect(src, rel).not.toMatch(/return jsonOk\(propert(y|ies)[,)]/);
    }
  });

  it("landing demo yanıtı iç sınıflandırma alanlarını sızdırmaz", () => {
    // `source` cevabın OpenAI'den mi fallback'ten mi geldiğini, `intent` de
    // modelin etiketini söylüyordu → kapı saatte 6 istekle haritalanabiliyordu.
    // ⚠️ UCUZ ERKEN UYARI — GARANTİ DEĞİL: bu KARA LİSTE yalnız bildiği adları
    // tanır, `return jsonOk({ ...result, reply })` gibi tek satırlık bir
    // gerileme onu YEŞİL geçirip üç alanı birden sızdırır (ölçüldü). GERÇEK
    // pin `tests/integration/demo-ai-route.test.ts` içinde ve İZİN LİSTESİDİR
    // (`Object.keys(...)` tam eşleşme), yani BİLİNMEYEN alanı da yakalar.
    const src = read("src/app/api/demo/ai/route.ts");
    const body = src.slice(src.indexOf("return jsonOk({"));
    expect(body).not.toMatch(/\bsource:/);
    expect(body).not.toMatch(/\bintent:/);
    expect(body).not.toMatch(/detectedLanguage:/);
  });

  it("DoS'a açık üç ağır rota hız limiti taşır", () => {
    // Sırasıyla: satır başına ~9 sorgu × 10.000 satır · `take`siz findMany + N+1 ·
    // istek başına ~120 dış Hospitable çağrısı. Üçü de limitsizdi.
    // ⚠️ BU TARAMA GARANTİ DEĞİL, YALNIZ UCUZ ERKEN UYARIDIR. Ölçüldü: yorum
    // satırına alınmış bir `rateLimit(` çağrısını da, sonucu okunmayan bir
    // çağrıyı da (`if (false && !limited.ok)`) YEŞİL geçiriyor. GERÇEK pin
    // davranışsaldır → `tests/integration/reservations-import-route.test.ts`
    // ("hız limiti"): 429'u, Retry-After'ı ve "geçersiz istek bütçe yakmaz"
    // sırasını rotayı ÇAĞIRARAK asserte eder.
    for (const rel of [
      "src/app/api/reservations/import/route.ts",
      "src/app/api/tasks/backfill/route.ts",
      "src/app/api/hospitable/diagnostics/route.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).toMatch(/rateLimit\(/);
      expect(src, rel).toMatch(/tooManyRequests\(/);
    }
  });

  it("katalog dışı Paddle fiyatı consent kapısında reddedilir", () => {
    // Çapraz-kontrol YALNIZ harita bir değer döndürünce çalışıyordu; haritada
    // olmayan `priceId` sessizce geçiyor ve org kalıcı "pro" yetkisi alıyordu.
    const src = read("src/app/api/billing/consent/route.ts");
    expect(src).toContain("paddlePriceCatalogConfigured()");
    expect(src).toMatch(/!derivedPlanCode && paddlePriceCatalogConfigured\(\)/);
  });

  it("test e-postası ortak kabuğu kullanır (elle inline HTML değil)", () => {
    const src = read("src/app/api/settings/test-email/route.ts");
    expect(src).toContain("identityEmailShell({");
    expect(src).not.toMatch(/const html =\s*`<div/);
  });

  it("şifre BELİRLEME yolları giriş şemasıyla aynı üst sınırı uygular", () => {
    // Sınır yokken 200'den uzun bir şifre belirlenebiliyor, sonra `loginSchema`
    // onu reddediyordu → kullanıcı kendi hesabından kilitleniyordu.
    for (const rel of [
      "src/app/api/account/password/route.ts",
      "src/app/api/account/forgot-password/route.ts",
    ]) {
      expect(read(rel), rel).toContain("newPassword.length > 200");
    }
  });
});

describe("landing iframe'leri Google Fonts ÇEKMEZ", () => {
  // 🚨 `public/urun.html` ve `public/kurulum.html` landing sayfasına <iframe>
  // ile gömülü, yani siteyi AÇAN HERKES bunları yükler. Ham
  // `<link href="https://fonts.googleapis.com/...">` kullanıyorlardı →
  // ziyaretçinin IP'si + User-Agent'i + Referer'i, hiçbir tıklama olmadan
  // Google'a gidiyordu. Gizlilik metnimizin alt-işleyen listesinde Google YOK.
  // ⚠️ Ana uygulamada bu sorun HİÇ olmadı: `next/font/google` fontu BUILD
  // ANINDA indirip kendi origin'imizden servis eder. Bu iki statik dosya o
  // korumanın dışında kalan tek yerdi.
  const IFRAMES = ["public/urun.html", "public/kurulum.html"];
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  // Yorumlar elenir: dosyaların AÇIKLAMASI eski durumu anlatıyor, aranan şey
  // gerçek bir istek üreten `<link>`/`url()`/`@import` ifadesi.
  const withoutComments = (s: string) =>
    s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("hiçbir landing iframe'i Google'a istek üretmez", () => {
    for (const rel of IFRAMES) {
      const code = withoutComments(read(rel));
      expect(code, rel).not.toMatch(/fonts\.googleapis\.com/);
      expect(code, rel).not.toMatch(/fonts\.gstatic\.com/);
      // Genel kural: bu iki dosya HİÇBİR dış origin'den kaynak çekmemeli.
      const external = [...code.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)].map(
        (m) => m[0],
      );
      expect(external, `${rel} dış kaynak çekiyor`).toEqual([]);
    }
  });

  it("Inter kendi origin'imizden servis ediliyor ve dosyalar GERÇEKTEN var", () => {
    // Yalnız kaynak taraması yetmez: biri font dosyalarını silse `@font-face`
    // ayakta kalır, tarayıcı sessizce fallback'e düşer ve tipografi bozulur.
    for (const rel of IFRAMES) {
      const code = withoutComments(read(rel));
      expect(code, rel).toContain("/fonts/inter-latin.woff2");
      expect(code, rel).toContain("/fonts/inter-latin-ext.woff2");
    }
    // Türkçe için İKİSİ DE gerekli: ı/ç/ö/ü latin'de, ğ/ş/İ latin-ext'te.
    for (const f of ["public/fonts/inter-latin.woff2", "public/fonts/inter-latin-ext.woff2"]) {
      const buf = readFileSync(join(process.cwd(), f));
      expect(buf.subarray(0, 4).toString("latin1"), `${f} woff2 imzası`).toBe("wOF2");
      // woff2 başlığındaki uzunluk alanı dosya boyutuyla eşleşmeli — kesik
      // (LFS pointer'ı / yarım kopyalanmış) dosya buradan yakalanır.
      expect(buf.readUInt32BE(8), `${f} kesik`).toBe(buf.length);
    }
  });

  it("iframe parçaları arama motoruna KAPALI (tek başına sayfa değiller)", () => {
    // Bu iki dosya landing'e gömülen PARÇA: başlığı, menüsü, CTA'sı yok.
    // robots.txt "/" altındaki her şeye izin veriyor ve (app) grubunun
    // noindex'i bunları KAPSAMIYOR → indekslenirlerse kullanıcı çıkışsız bir
    // kırıntıya düşer. iframe içinde gösterim bundan etkilenmez.
    for (const rel of IFRAMES) {
      expect(read(rel), rel).toMatch(/<meta\s+name="robots"\s+content="noindex/i);
    }
  });

  it("CSP'deki Google Fonts karşılaması kaldırıldı ve geri gelmedi", () => {
    // Karşılamanın TEK sebebi bu iki dosyaydı; artık gerekmiyor. Geri eklenmesi
    // neredeyse kesinlikle <link>'lerin geri konduğu anlamına gelir.
    // ⚠️ YORUM ELEME SATIR BAŞINA ÇAPALI OLMAK ZORUNDA. İlk yazımım
    // `/\/\/[^\n]*/g` idi ve o kalıp `https://fonts.gstatic.com` içindeki
    // `//`den itibaren HER ŞEYİ siliyordu — yani test tam da aradığı ipucunu
    // kendi eliyle yok ediyor ve mutasyonda YEŞİL kalıyordu (ölçüldü).
    const cfg = read("next.config.mjs")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(cfg).not.toMatch(/fonts\.googleapis\.com/);
    expect(cfg).not.toMatch(/fonts\.gstatic\.com/);
  });
});
