import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectRiskType } from "@/lib/ai/fallback";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// BEŞ AJANLIK İKİNCİ GÜVENLİK TURUNDA (08-07 (2)) KAPATILAN AÇIKLAR.
// Hepsi ÖLÇÜLEREK bulundu; buradaki testler o ölçümlerin donmuş hâlidir.
// ---------------------------------------------------------------------------

describe("homoglif — SAFETY_EMERGENCY sınıfı yazı sistemiyle düşürülemez", () => {
  // 🚨 ÜRÜNÜN EN YÜKSEK BAHİSLİ SINIFI. Harita yalnız Kiril+Yunan tanıyordu ve
  // ÖLÇÜLDÜ: tek bir Ermeni ya da küçük-kapital harf `detectRiskType`'ı NULL'a
  // düşürüyordu. Zincirin devamı daha kötü: sınıf `complaint`e düşünce mesaj
  // "holding ack" uygunu oluyor ve host o seçeneği açmışsa YANGIN bildiren
  // misafire deterministik özür mesajı gidiyor — model hiç çağrılmadan.
  const YANGIN = [
    ["temiz (kontrol)", "Dairede yangın var, duman her yeri sardı"],
    ["Ermenice ո/գ/ս", "Dairede yaոգıո var, dumaո her yeri սardı"],
    ["Cherokee Ꮩ", "Dairede yangın Ꮩar, duman her yeri sardı"],
    ["küçük-kapital", "Dairede yaɴɢın var, duman her yeri sardı"],
  ] as const;

  it.each(YANGIN)("%s → safety_emergency", (_ad, mesaj) => {
    expect(detectRiskType(mesaj)).toBe("safety_emergency");
  });

  it("öz-zarar mesajı küçük-kapital harfle de yakalanır", () => {
    expect(detectRiskType("ölmek istiyorum")).toBe("safety_emergency");
    expect(detectRiskType("ölᴍek istiyorum")).toBe("safety_emergency");
  });

  it("🚨 RUSÇA KORUMASI DURUYOR — sökme metnin YERİNE geçmez", () => {
    // Sökülmüş biçim EK ADAY'dır (`matchCandidates`). Metnin yerine geçseydi
    // gerçek bir Rusça acil deterministik ağdan DÜŞERDİ; bu ölçülmüş bir
    // gerileme olarak belgelenmiş ve kasten önlenmiştir.
    expect(detectRiskType("В квартире пожар!")).toBe("safety_emergency");
    expect(detectRiskType("Дым в коридоре, что делать")).toBe("safety_emergency");
  });

  it("harita ve koşul TEK yerde — ayrı bir yazı-sistemi listesi kalmadı", () => {
    // Koşul eskiden ayrı bir `CYRILLIC_GREEK_RE` aralık listesine bakıyordu:
    // harita büyüyünce o kapı yeni sistemleri DIŞARIDA bırakıyordu. İki liste
    // ayrı yerlerde durunca biri güncellenip diğeri unutuluyor.
    const src = readFileSync(join(process.cwd(), "src/lib/ai/fallback.ts"), "utf8");
    expect(src).not.toMatch(/CYRILLIC_GREEK_RE/);
  });
});

describe("ReDoS — QR sır süzgeci sınırlı nicelik kullanır", () => {
  // 🚨 ÖLÇÜLDÜ: sınırsız hâlde "wifi" + 20.000 harf = 14 saniye BLOKE event
  // loop. `looksLikeSecret` kalem başına 6 kalıp × 3 katlama koşuyor ve QR
  // yolu tek istekte 30 kaleme kadar okuyor → tek kiracı, TÜM replikayı
  // dondurabiliyordu (Node tek iş parçacıklı). Deneme hesabı yeterliydi.
  const src = readFileSync(join(process.cwd(), "src/lib/guest-chat.ts"), "utf8");
  const patterns = src.slice(
    src.indexOf("const SECRET_PATTERNS"),
    src.indexOf("function looksLikeSecret"),
  );

  it("hiçbir kalıpta SINIRSIZ `\\w*` / `[...]*` kalmadı", () => {
    // Yalnız GERÇEK regex satırlarına bak — yorumlar `*` içerebiliyor.
    const regexLines = patterns
      .split("\n")
      .filter((l) => l.trimStart().startsWith("/") && l.trimEnd().endsWith("/i,"));
    expect(regexLines.length).toBeGreaterThan(4); // külliyat gerçekten bulundu
    for (const line of regexLines) {
      expect(line, `sınırsız nicelik: ${line.trim()}`).not.toMatch(/\\w\*/);
      expect(line, `sınırsız sınıf: ${line.trim()}`).not.toMatch(/\]\*[^)]/);
    }
  });

  it("uzunluk kemeri duruyor — ama artık FAIL-CLOSED üst sınır, head/tail kesme DEĞİL (Codex F02)", () => {
    // ⚠️ İFADE ÜÇÜNCÜ KEZ DEĞİŞTİ; bu kez KORUMA DA DEĞİŞTİ ve bilerek.
    // Tarihçe: tek uç (`slice(0,4000)`, 08-07) → iki uç (`slice(0,4000)` +
    // `slice(-4000)`, 08-09) → TAM TARAMA (09-07, Codex F02). İki-uç kemerin
    // gerekçesi ("ortaya gömmek için iki uçtan 4.000 dolgu gerekir, o da bütçeye
    // çarpar") YANLIŞTI: KB tavanı 20.000 olduğu için 18k'lik tek kalemin ortası
    // sıradan girdiyle ulaşılıyor ve HİÇ taranmıyordu. Bu testin eski hâli o
    // kusuru "koruma" diye pinliyordu.
    //
    // Yeni sözleşme: (1) head/tail kesme YOK — `looksLikeSecret` içinde
    // `text.slice(` geçmez; (2) ReDoS kemeri bir ÜST SINIRDIR ve fail-closed
    // (`> SECRET_SCAN_MAX_CHARS` → `return true`, "taramadım ama geçsin" değil);
    // (3) üst sınır KB validator tavanından (20.000) küçük olamaz — yoksa meşru
    // en uzun kalem sırsız da olsa elenir (bedel yalnız özellik kaybı, ama
    // sessiz). Davranışsal kardeşleri: `qr-secret-scan-coverage.test.ts`.
    const fnStart = src.indexOf("function looksLikeSecret(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = src.indexOf("\n}\n", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fn = src.slice(fnStart, fnEnd);
    expect(fn).not.toMatch(/text\.slice\(/); // kesme geri gelirse KIRMIZI
    expect(fn).toMatch(/text\.length > SECRET_SCAN_MAX_CHARS\)\s*return true;/); // fail-closed üst sınır
    const cap = src.match(/const SECRET_SCAN_MAX_CHARS = ([\d_]+);/);
    expect(cap).not.toBeNull();
    const capNum = Number(cap![1].replace(/_/g, ""));
    const kbCap = readFileSync("src/lib/validators.ts", "utf8").match(/content: z\.string\(\)\.min\(2[^)]*\)\.max\((\d+)\)/);
    expect(kbCap, "validators.ts KB içerik tavanı bulunamadı").not.toBeNull();
    expect(capNum).toBeGreaterThanOrEqual(Number(kbCap![1]) + 300); // içerik + başlık
  });

  it("patolojik girdi ANINDA döner (davranışsal)", () => {
    const evil = "wifi" + "a".repeat(20_000);
    const t0 = performance.now();
    scrubStyleProfileForPublic(evil);
    const ms = performance.now() - t0;
    // Sınırsız hâlde bu tek çağrı ~14.000 ms sürüyordu. Eşik cömert: CI
    // makinesi yavaş olabilir, ama iki büyüklük mertebesi fark var.
    expect(ms, `${ms.toFixed(0)} ms — geri-izleme geri gelmiş olabilir`).toBeLessThan(1000);
  });

  it("🚨 TESPİT DENGESİ DEĞİŞMEDİ (sınırlama davranışı bozmamalı)", () => {
    // Sınırlar saf performans düzeltmesidir. Ölçüldü: önce ve sonra BİREBİR
    // aynı — 0/19 yanlış pozitif, 20/20 saldırı yakalandı.
    const mesru = [
      "Moda Cad. No:12 Kapı 3, 34710 Kadıköy",
      "Kapıcı 0532 111 2233",
      "Giriş saati 15:00, çıkış 11:00",
      "İnternet hızı 100 Mbps",
      "Kablosuz internet ücretsizdir",
    ];
    const saldiri = [
      "Kapı: 4590",
      "PIN: 5678",
      "Wifi şifresi Lale2024",
      "İnternet ağımız 'LaleEv', bağlanmak için 12345678 girin",
      "Şifre: gizli123",
    ];
    for (const m of mesru) expect(scrubStyleProfileForPublic(m), m).toBe(m);
    for (const m of saldiri) expect(scrubStyleProfileForPublic(m), m).toBeNull();
  });
});
