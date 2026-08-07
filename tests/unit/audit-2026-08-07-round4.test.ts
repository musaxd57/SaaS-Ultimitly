import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { taskUpdateSchema } from "@/lib/validators";
import { detectSupplyRequest } from "@/lib/supply";
import { zonedDayRange, addZonedDays } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// 10-AJANLIK DENETİM TURU (08-07 (4)) — az bakılan modüller.
// Buradaki her pin, ajan iddiasının KOD-DOĞRULANMIŞ ve ÖLÇÜLMÜŞ olanına aittir;
// doğrulanamayanlar uygulanmadı ve CLAUDE.md'ye karar maddesi olarak yazıldı.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Yorumları AT — "yok" iddiaları yalnız GERÇEK KOD üzerinde anlamlıdır.
 *
 * 🚨 Bu yardımcı, testi ilk yazdığımda üç assertion'ı birden çökerten hatadan
 * doğdu: `tabIndex={-1}` ve `bg-foreground/40` düzeltmenin GEREKÇESİNİ anlatan
 * kendi yorumlarımda geçiyordu, yani `not.toContain` kod temiz olmasına rağmen
 * kırmızı veriyordu. Ters yönü daha sinsi: yorumda geçen bir kalıp yüzünden
 * `toContain` yeşil kalıp pini VACUOUS yapabilirdi.
 * ⚠️ Eleme SATIR BAŞINA çapalıdır (`trimStart`) — repo'nun kayıtlı dersi:
 * serbest `//` eleme `https://…` içindeki çift eğik çizgiden itibaren her şeyi
 * siler ve testin aradığı ipucunu kendi eliyle yok eder.
 */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join("\n");

describe("🚨 photoUrl artık DIŞ host kabul etmez", () => {
  // ZİNCİR ÖLÇÜLDÜ: staff (en düşük yetki) kendi görevine mutlak bir https URL
  // yazabiliyordu → `isAcceptablePhotoUrl` depolama-dışı URL'e ERKEN true döner
  // → değer SAHİBİN panosunda `<a href>` + `<img src>` olarak çizilir → CSP
  // `img-src … https:` onu yükler → tıksız IP/User-Agent sızıntısı.
  // Uygulama mutlak URL ÜRETMEZ: /api/upload `/api/storage/photo/<key>` döner.
  it("mutlak https REDDEDİLİR", () => {
    for (const bad of [
      "https://saldirgan.tld/p.png",
      "HTTPS://saldirgan.tld/p.png",
      "https://evil.example.com/track.gif?u=1",
    ]) {
      expect(taskUpdateSchema.safeParse({ photoUrl: bad }).success, bad).toBe(false);
    }
  });

  it("uygulamanın GERÇEKTEN ürettiği göreli yollar KABUL EDİLİR", () => {
    for (const ok of ["/api/storage/photo/org/abc/task/1/x.jpg", "/uploads/org1/123-abc.png"]) {
      expect(taskUpdateSchema.safeParse({ photoUrl: ok }).success, ok).toBe(true);
    }
  });

  it("eski kapılar KORUNUYOR — protokol-göreli, ters bölü, javascript:", () => {
    for (const bad of ["//evil.tld/x.png", "/\\evil.tld/x.png", "javascript:alert(1)", "data:image/png;base64,AA"]) {
      expect(taskUpdateSchema.safeParse({ photoUrl: bad }).success, bad).toBe(false);
    }
  });
});

describe("🚨 doluluk: ÇIKIŞ GÜNÜ sayılmaz", () => {
  // ÖLÇÜLDÜ (düzeltmeden önce dördü de +1 geceydi): eski kod org-YEREL
  // geceyarısını (`cur`) sağlayıcının HAM çıkış anıyla (`end`) karşılaştırıyordu.
  // UTC+3'te çıkış gününün yerel geceyarısı çıkış anından ÖNCE olduğu için o gün
  // de sayılıyordu → /reports donut'u sistematik şişiyor ve /calendar ile
  // ÇELİŞİYORDU (orası zaten gün anahtarı karşılaştırıyor).
  const tz = "Europe/Istanbul";
  const dayKeyTz = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });

  // reports.ts'teki countOccupiedDays'in BİREBİR aynısı (özel fonksiyon).
  function count(arr: string, dep: string, rs = "2026-07-01T00:00:00Z", re = "2026-09-01T00:00:00Z") {
    const rangeStart = new Date(rs);
    const rangeEndKey = dayKeyTz(new Date(re));
    const occupied = new Set<string>();
    const start = new Date(arr) > rangeStart ? new Date(arr) : rangeStart;
    const depKey = dayKeyTz(new Date(dep));
    const endKey = depKey < rangeEndKey ? depKey : rangeEndKey;
    let cur = zonedDayRange(start, tz).start;
    let key = dayKeyTz(cur);
    while (key < endKey) {
      occupied.add(key);
      cur = addZonedDays(cur, 1, tz);
      key = dayKeyTz(cur);
    }
    return occupied.size;
  }

  it("gece sayısı = konaklama gecesi (çıkış günü hariç)", () => {
    expect(count("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z")).toBe(1); // Hospitable 00:00Z
    expect(count("2026-08-05T12:00:00Z", "2026-08-08T12:00:00Z")).toBe(3); // iCal 12:00Z
    expect(count("2026-08-10T00:00:00Z", "2026-08-17T00:00:00Z")).toBe(7);
    expect(count("2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z")).toBe(0); // aynı gün
  });

  it("pencere sınırları korunuyor (taşan konaklama kırpılır)", () => {
    expect(count("2026-06-25T00:00:00Z", "2026-09-10T00:00:00Z")).toBe(62); // Tem 31 + Ağu 31
  });

  it("kaynak GERÇEKTEN gün anahtarı karşılaştırıyor (ham damga değil)", () => {
    const src = codeOnly(read("src/lib/reports.ts"));
    const fn = src.slice(src.indexOf("function countOccupiedDays"), src.indexOf("const clamp ="));
    expect(fn).toContain("const rangeEndKey = dayKeyTz(rangeEnd, tz)");
    expect(fn).toContain("while (key < endKey)");
    // Eski, çerçeve karıştıran karşılaştırma geri gelirse KIRMIZI.
    expect(fn).not.toContain("while (cur < end)");
  });
});

describe("🚨 tedarik: BÜYÜK HARF reddi de guard'a takılır", () => {
  // ÖLÇÜLDÜ: "…LAZIM DEĞİL…" büyük harfliyken guard'ı deliyor ve misafirin
  // AÇIKÇA REDDETTİĞİ ürün alışveriş listesine giriyordu; küçük harflisi ise
  // doğru davranıyordu. Katlama YALNIZ guard'lara eklendi (kısıtlayıcı yön).
  it("büyük harfli red = küçük harfli red", () => {
    const upper = detectSupplyRequest("FAZLADAN NEVRESIM LAZIM DEĞİL AMA HAVLU RICA EDERIM");
    const lower = detectSupplyRequest("fazladan nevresim lazım değil ama havlu rica ederim");
    expect(lower).toEqual([]);
    expect(upper).toEqual([]);
  });

  it("MEŞRU talep hâlâ yakalanıyor (guard fazla geniş değil)", () => {
    const out = detectSupplyRequest("Merhaba, fazladan iki havlu rica edebilir miyiz acaba lütfen");
    expect(out.map((o) => o.itemKey)).toContain("banyo_havlusu");
  });

  it("beyaz listeler KATLANMADI — yalnız guard'lar katlandı", () => {
    const src = codeOnly(read("src/lib/supply.ts"));
    const fn = src.slice(src.indexOf("export function detectSupplyRequest"), src.indexOf("Record any extra-supply"));
    expect(fn).toContain("hitsAny(REQUEST_NEGATIONS)");
    expect(fn).toContain("hitsAny(REQUEST_QUESTIONS)");
    // Bunlara katlama uygulamak listeye YANLIŞ ürün sokar → yasak yön.
    expect(fn).not.toContain("hitsAny(EXTRA_SIGNALS)");
    expect(fn).not.toContain("hitsAny(REQUEST_VERBS)");
    expect(fn).not.toContain("hitsAny(it.words)");
  });
});

describe("panel 404 ve iptaller çıkmazı", () => {
  it("`(app)/not-found.tsx` VAR ve panele döner (pazarlama sitesine DEĞİL)", () => {
    // Yoksa notFound() kök 404'e düşer, kabuk kaybolur ve tek düğme kullanıcıyı
    // landing'e atar — `(app)/error.tsx`in kapattığı arızanın aynısı.
    const src = codeOnly(read("src/app/(app)/not-found.tsx"));
    expect(src).toContain('href="/dashboard"');
    // Kök 404'ün yaptığı gibi landing'e atmamalı (`href="/"` TAM eşleşme).
    expect(src).not.toMatch(/href="\/"/);
  });

  it("iptaller boş kartı SAYFA AŞIMINI ve DAİRE filtresini ayırt eder + çıkış yolu verir", () => {
    const src = codeOnly(read("src/app/(app)/cancellations/page.tsx"));
    const block = src.slice(src.indexOf("reservations.length === 0 ? ("), src.indexOf("</Card>", src.indexOf("reservations.length === 0 ? (")));
    expect(block).toContain("page > 1");
    expect(block).toContain("İlk sayfaya dön");
    expect(block).toContain("Tüm daireleri göster");
  });
});

describe("karanlık mod: perde TERSİNMEZ + şifre düğmesi klavyeyle erişilir", () => {
  it("drawer perdesi `bg-black`, `bg-foreground` DEĞİL", () => {
    // `--foreground` karanlıkta AÇIK renge döner → perde kararmak yerine
    // beyazlar ve elevasyonu tersine çevirirdi. Kardeş örtüler zaten bu desende.
    const src = codeOnly(read("src/components/shell/app-shell.tsx"));
    expect(src).toContain("bg-black/40 dark:bg-black/60");
    expect(src).not.toContain("bg-foreground/40");
  });

  it("şifre göster/gizle düğmesi odak sırasında (tabIndex -1 YOK)", () => {
    const src = codeOnly(read("src/components/ui/password-input.tsx"));
    expect(src).not.toContain("tabIndex={-1}");
    expect(src).toContain("focus-visible:ring-2");
  });
});
