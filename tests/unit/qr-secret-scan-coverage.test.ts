import { describe, it, expect } from "vitest";
import { withoutSecretKbItems, scrubStyleProfileForPublic } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// QR SIR FİLTRESİ İÇERİĞİN TAMAMINI TARAR (Codex F02 — P1)
//
// 🚨 KAPATILAN AÇIK: `looksLikeSecret` 8.000 karakteri aşan içerikte YALNIZ ilk
// ve son 4.000 karakteri tarıyordu; filtre "temiz" derse ÖZGÜN içeriğin tamamı
// model bağlamına giriyordu. KB giriş sınırı 20.000 karakter → ortadaki
// taranmayan bölüm sıradan uygulama girdisiyle ulaşılabilirdi. Codex 18.019
// karakterlik bir kalemin ortasındaki sentetik kapı kodunu filtreden geçirdi;
// aynı kod kısa girdide engelleniyordu.
//
// Eski gerekçe ("ortaya gömmek için iki uçtan 4.000 dolgu gerekir, o da bütçeye
// çarpar") YANLIŞTI: 20.000'lik tek kalem sınırın içindeydi.
//
// Yeni sözleşme: kabul edilen sınıra kadar TAMAMI taranır; sınırı aşan (yani
// doğrulanamayan) içerik FAIL-CLOSED elenir — hiçbir zaman "taramadım ama
// geçsin" yok. ReDoS kemeri bu üst sınırdır (ölçüldü: 24k adversarial girdi
// 6 kalıp × 3 katlama ≪ 50 ms).
// ---------------------------------------------------------------------------

/** Sırsız, gerçekçi ev kuralı metni — tekrarla istenen uzunluğa çıkar. */
function filler(chars: number): string {
  const para =
    "Dairede sigara içilmez, evcil hayvan kabul edilmez. Çöpler her akşam 22:00'den önce " +
    "bina girişindeki konteynere bırakılır. Klima kumandası mutfak çekmecesinde. Komşuları " +
    "rahatsız etmemek için 23:00 sonrası ses düzeyine dikkat edilir. ";
  let out = "";
  while (out.length < chars) out += para;
  return out.slice(0, chars);
}

const SECRET = "Kapı kodu: 4590";

describe("withoutSecretKbItems — uzun içeriğin ORTASI", () => {
  it("🚨 Codex kanıtı: 18.019 karakterlik kalemin ORTASINDAKİ kapı kodu ELENİR", () => {
    const half = filler(9000);
    const content = `${half}\n${SECRET}\n${half}`; // ≈18.019
    expect(content.length).toBeGreaterThan(8000);
    expect(content.indexOf(SECRET)).toBeGreaterThan(4000);
    expect(content.length - content.indexOf(SECRET)).toBeGreaterThan(4000); // iki uçtan da 4.000+ uzakta
    const out = withoutSecretKbItems([{ title: "Ev Kuralları", content }]);
    expect(out).toEqual([]); // ⬅️ ARIZADA: kalem geçiyordu, kod modele gidiyordu
  });

  it("KONTROL: aynı uzunlukta SIRSIZ kalem KALIR (aşırı-eleme değil)", () => {
    // Bu olmadan "uzun olan her şeyi at" mutasyonu da yeşil geçerdi.
    const out = withoutSecretKbItems([{ title: "Ev Kuralları", content: filler(18_019) }]);
    expect(out).toHaveLength(1);
  });

  it("sır BAŞTA / SONDA / ortanın ötesinde birden çok yerde → hepsi elenir (regresyon)", () => {
    const cases = [
      `${SECRET}\n${filler(18_000)}`,
      `${filler(18_000)}\n${SECRET}`,
      `${filler(5000)}\n${SECRET}\n${filler(13_000)}`,
      `${filler(13_000)}\nAnahtar kutusu 7788\n${filler(5000)}`,
    ];
    for (const content of cases) {
      expect(withoutSecretKbItems([{ title: "T", content }]), content.slice(0, 40)).toEqual([]);
    }
  });

  it("Türkçe katlama derin ofsette de çalışır (İ/I)", () => {
    // `/i` bayrağı İ→i çevirmez; katlama var — ve tam taramada orta bölgede de.
    const content = `${filler(10_000)}\nGİRİŞ KODU 5566\n${filler(7000)}`;
    expect(withoutSecretKbItems([{ title: "T", content }])).toEqual([]);
  });

  it("🚨 doğrulanamayacak kadar uzun içerik FAIL-CLOSED elenir (asla 'taramadım ama geçsin')", () => {
    // Validators 20.000 + başlık 300 → 24.000 kemeri normal girdide ULAŞILMAZ;
    // ulaşılıyorsa kaynak validator'ı atlamıştır → güvenli yön elemektir.
    const out = withoutSecretKbItems([{ title: "T", content: filler(30_000) }]);
    expect(out).toEqual([]);
  });

  it("KONTROL: kemerin hemen altındaki sırsız içerik hâlâ KALIR", () => {
    const out = withoutSecretKbItems([{ title: "T", content: filler(20_000) }]);
    expect(out).toHaveLength(1);
  });

  it("kısa kalem davranışı DEĞİŞMEDİ (kalıp/eşik pini kardeş dosyada)", () => {
    const items = [
      { title: "Wi-Fi", content: "Ağ: NuveEv_5G, şifre: gunes1907" },
      { title: "Otopark", content: "Bina altında ücretsiz otopark var, 2. bodrum" },
      { title: "Adres", content: "Caferağa Mah. Moda Cad. No:12 Kat:3, 34710 Kadıköy" },
    ];
    expect(withoutSecretKbItems(items).map((i) => i.title)).toEqual(["Otopark", "Adres"]);
  });
});

describe("scrubStyleProfileForPublic — satır bazlı, aynı dedektör", () => {
  it("uzun bir satırın ortasındaki sır satırı düşürür, diğer satırlar kalır", () => {
    const profile = ["Kısa ve net yaz.", `${filler(9000)} ${SECRET} ${filler(9000)}`, "Siz diye hitap et."].join("\n");
    const out = scrubStyleProfileForPublic(profile)!;
    expect(out).toContain("Kısa ve net yaz.");
    expect(out).toContain("Siz diye hitap et.");
    expect(out).not.toContain("4590");
  });
});
