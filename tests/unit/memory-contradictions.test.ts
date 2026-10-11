import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
import {
  detectContradictions,
  infoWrongReports,
  ITEM_TOPIC_TO_KB,
  CONTRADICTION_MIN_GUESTS,
  statesInfoWrong,
} from "@/modules/intelligence/memory/contradictions";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 13 / karar 26 (kurucu 10-11) — olası çelişki uyarısının SAF kararı. (1) bilgi tabanı ↔ misafir: son 30 günde ≥3 AYRI misafir
// o BİLGİNİN yanlış / olmadığını söyledi (arıza şikâyeti sayılmaz — kurucu 10-11 düzeltmesi); (2) bilgi tabanı ↔ bilgi tabanı / mülk ayarı (saat). "Bilerek böyle" işareti, kalem sonradan değişmediyse
// uyarıyı kaldırır.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-11T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const item = (conversationId: string, messageId: string, kind: string, at = day(1)) => ({ conversationId, messageId, kind, createdAt: at });
const fact = (id: string, category: string, over: Partial<{ observedAt: Date; humanOverrideAt: Date | null; kbItemId: string }> = {}) => ({
  id,
  category,
  kbItemId: over.kbItemId ?? `kb-${id}`,
  observedAt: over.observedAt ?? day(60),
  humanOverrideAt: over.humanOverrideAt ?? null,
});

describe("🚨 statesInfoWrong — misafir BİLGİNİN KENDİSİNİN yanlış / olmadığını mı söylüyor (kurucu 10-11 düzeltmesi)", () => {
  it.each([
    // ARIZA / kesinti / yavaşlık: bilgi yanlış DEĞİL (kurucu: "Wi-Fi'nin çalışmamasının sebebi şifre veya yanlış ağ olması değil").
    ["Wi-Fi çalışmıyor.", "wifi", false],
    ["İnternet iki saattir yok", "wifi", false],
    ["Wi-Fi yok", "wifi", false],
    ["Wi-Fi çok yavaş", "wifi", false],
    ["The wifi keeps dropping", "wifi", false],
    ["Wi-Fi şifresi doğru ama bağlanmıyor", "wifi", false],
    ["Wi-Fi şifresi doğru ama internet çalışmıyor", "wifi", false],
    ["Şifreyi girdim ama çalışmıyor", "wifi", false],
    // Bilgi yanlış: şifre kabul edilmiyor / değişmiş · ağ adı yanlış · öyle bir ağ yok.
    ["Wi-Fi şifresi yanlış", "wifi", true],
    ["Wi-Fi şifresi\tyanlış", "wifi", true],
    ["Wi-Fi şifresi yanlıştı, ev sahibinden aldık", "wifi", true],
    ["Verdiğiniz şifre kabul etmiyor", "wifi", true],
    ["Wifi şifresi çalışmıyor", "wifi", true],
    ["Wi-Fi'ye bağlanamıyoruz, şifre olmuyor", "wifi", true],
    ["Wi-Fi şifresi değişmiş galiba", "wifi", true],
    ["Yanlış şifre vermişsiniz", "wifi", true],
    ["Şifre yanlış yazılmış", "wifi", true],
    ["The wifi password is wrong", "wifi", true],
    ["The password doesn't work", "wifi", true],
    ["Wrong password in the guide", "wifi", true],
    ["LaleNet diye bir ağ yok", "wifi", true],
    ["LaleNet diye bir ağ görünmüyor", "wifi", true],
    ["Ağ adı yanlış yazılmış", "wifi", true],
    ["There is no network called LaleNet", "wifi", true],
    // Misafirin kendi hatası · soru · koşul · olumsuzlama · başka konu sözcüğü → sayılmaz.
    ["I typed the wrong password, sorry", "wifi", false],
    ["Şifreyi yanlış yazmışım", "wifi", false],
    ["Yanlış şifre girmişim", "wifi", false],
    ["Şifre yanlış mı?", "wifi", false],
    ["Şifre yanlış mı", "wifi", false],
    ["Şifre yanlış değil, modem kapalı", "wifi", false],
    ["Şifreyi girdim ama kabul etmiyor", "wifi", false],
    ["Şifre yanlışsa haber veririm", "wifi", false],
    ["Ağır bagaj yok", "wifi", false],
    // Haiku 10-11 — kaçan yaygın ifadeler.
    ["Şifre doğru değil", "wifi", true],
    ["Wi-Fi şifresi doğru değil", "wifi", true],
    ["Wi-Fi şifreleri yanlış", "wifi", true],
    ["The wifi passwords are wrong", "wifi", true],
    ["Şifrenizi denedik olmadı", "wifi", true],
    ["Şifre değiştirildi", "wifi", true],
    ["Verdiğiniz şifre kabul etmez", "wifi", true],
    ["Şifre olmuyo", "wifi", true],
    ["There is no wifi called LaleNet", "wifi", true],
    ["Wi-Fi ağı yanlış", "wifi", true],
    ["Wi-Fi'nin kodu yanlış", "wifi", true],
    ["The password you gave us still doesn't work", "wifi", true],
    // Haiku 10-11 — yanlış uyarılar: kendi hatası · tahmin · araya başka şey giren cümle.
    ["Sorry, I typed the password wrong", "wifi", false],
    ["I was typing the wrong password", "wifi", false],
    ["I typed in the wrong password", "wifi", false],
    ["Şifreyi yanlış yazmıştım", "wifi", false],
    ["Ağı yanlış seçmişim", "wifi", false],
    ["Girdiğim şifre yanlış", "wifi", false],
    ["Şifreyi yanlış yazmış olabilirim", "wifi", false],
    ["Şifre yanlış olabilir mi", "wifi", false],
    ["Acaba şifre yanlış", "wifi", false],
    ["Could the wifi password be wrong", "wifi", false],
    ["Wi-Fi şifresi bütün cihazlarda çalışmıyor", "wifi", false],
    ["Ağ yok", "wifi", false],
    ["Kapının şifresi yanlış", "wifi", false],
    ["Kapı şifresi yanlış", "wifi", false],
    ["Wi-Fi kodu yanlış", "wifi", true],
    ["Wi-Fi şifresi ne?", "wifi", false],
    // Kapı kodu.
    ["Kapı kodu çalışmıyor", "checkin", true],
    ["Verdiğiniz kod yanlış", "checkin", true],
    ["Wrong door code", "checkin", true],
    ["The code doesn't work", "checkin", true],
    ["Kilit çalışmıyor", "checkin", false],
    ["Kodu yanlış girdik", "checkin", false],
    ["Kodlarınız çalışmıyor", "checkin", true],
    ["Kapı kodu açılmıyor", "checkin", true],
    ["The door code keypad doesn't work", "checkin", false],
    ["Kapı kodu tuş takımı çalışmıyor", "checkin", false],
    ["Wi-Fi'nin kodu yanlış", "checkin", false],
    ["Ağın kodu yanlış", "checkin", false],
    ["Wi-Fi şifresi yanlış", "checkin", false],
    ["Wi-Fi kodu yanlış", "checkin", false],
    ["Kapı şifresi yanlış", "checkin", true],
    // Otopark: "yok" sayılır; "dolu" / "otoparkta yer yok" anlık durumdur.
    ["Otopark yok", "parking", true],
    ["Otopark yoktu, sokağa park ettik", "parking", true],
    ["Otopark bulunmuyor", "parking", true],
    // Bulamamak bilgi yanlış demek değil (misafir kaybolmuş olabilir — adresle aynı kural, Haiku 10-11).
    ["Otoparkı bulamadık", "parking", false],
    ["We couldn't find the parking", "parking", false],
    ["There is no parking", "parking", true],
    ["Otopark dolu", "parking", false],
    ["Otoparkta yer yok", "parking", false],
    ["Otopark konusunda sorun yok", "parking", false],
    ["Otopark yok değil", "parking", false],
    ["No free parking nearby", "parking", false],
    ["No parking spaces left", "parking", false],
    ["Otopark dolu yer yok", "parking", false],
    ["Otopark yakınında market yok", "parking", false],
    ["There is no parking lot", "parking", true],
    ["Otopark yok? Bilgi verir misiniz.", "parking", false],
    ["Otopark girişinin yanındaki eski binanın arkasında market yok", "parking", false],
    // Havlu / çarşaf: "yok / eksik" sayılır; kirli / temiz / ekstra istek sayılmaz.
    ["Havlu yok", "cleaning", true],
    ["Havlular eksikti", "cleaning", true],
    ["There were no towels", "cleaning", true],
    ["No towels in the bathroom", "cleaning", true],
    ["Banyo havlusu yok", "cleaning", true],
    ["Havluları da yok", "cleaning", true],
    ["Havlu kirli", "cleaning", false],
    ["Temiz havlu yok", "cleaning", false],
    ["Fazladan havlu yok", "cleaning", false],
    ["Temiz    havlu yok", "cleaning", false],
    ["Ekstra havlu yok mu?", "cleaning", false],
    ["Havlu yok mu", "cleaning", false],
    ["No clean towels", "cleaning", false],
    // Çöp / adres.
    ["Çöp konteyneri yok", "trash", true],
    ["We couldn't find the bins", "trash", false],
    ["Bins we can't find anywhere", "trash", false],
    ["There are no bins", "trash", true],
    ["Çöp konteyneri dolu olduğu için yer yok", "trash", false],
    ["Çöp konteyneri dolu", "trash", false],
    ["Adres yanlış", "location", true],
    ["Konum yanlış gösteriyor", "location", true],
    ["Wrong address on the listing", "location", true],
    ["Adresi bulamadık", "location", false],
    ["Konum çalışmıyor", "location", false],
    ["Telefonumun konumu yanlış gösteriyor", "location", false],
    // Boş / tanımsız kategori.
    ["", "wifi", false],
    ["Wi-Fi şifresi yanlış", "rules", false],
    ["Wi-Fi şifresi yanlış", "checkout", false],
  ])("%s · %s → %s", (body, cat, expected) => expect(statesInfoWrong(body as string, cat as string)).toBe(expected));

  it("uzun mesajın ilk 8.000 karakteri okunur; uzun tek sözcük / boşluk dizisi / tekrarlanan özne doğrusal (karesel iş yok)", () => {
    expect(statesInfoWrong(`Wi-Fi şifresi yanlış. ${"a".repeat(20_000)}`, "wifi")).toBe(true);
    expect(statesInfoWrong(`${"a ".repeat(4_000)}Wi-Fi şifresi yanlış.`, "wifi")).toBe(false);
    const runs = [
      "a".repeat(30_000),
      `a${" ".repeat(29_990)}b`,
      `a${"\t \u00a0".repeat(9_000)}b`,
      "sifre ".repeat(5_000),
      "otopark ".repeat(4_000),
      "no ".repeat(10_000),
      "yanlis ".repeat(5_000),
      "typed ".repeat(5_000) + "password wrong",
      "kapi ".repeat(6_000) + "sifre yanlis",
      "is ".repeat(10_000),
      "password " + "is ".repeat(10_000) + "wrong",
    ];
    for (const s of runs) {
      const t = performance.now();
      for (const c of Object.values(ITEM_TOPIC_TO_KB)) statesInfoWrong(s, c);
      expect(performance.now() - t).toBeLessThan(1_000);
    }
  });
});

describe("infoWrongReports — konu öğesi + metin bilginin yanlış olduğunu söylüyor", () => {
  it("konu öğesi + 'bilgi yanlış' metni sayılır; arıza metni, eşlenmeyen konu, metni olmayan mesaj sayılmaz; mesaj başına bir kez", () => {
    const items = [
      item("c1", "m1", "wifi"),
      item("c1", "m1", "complaint_issue"),
      item("c1", "m1", "wifi"), // aynı mesajda ikinci öğe → bir kez
      item("c2", "m2", "wifi"),
      item("c3", "m3", "amenities"),
      item("c4", "m4", "wifi"),
    ];
    const bodies = new Map([
      ["m1", "Wi-Fi şifresi yanlış."],
      ["m2", "Wi-Fi çalışmıyor."],
      ["m3", "Wi-Fi şifresi yanlış."],
    ]);
    expect(infoWrongReports(items, bodies)).toEqual([{ conversationId: "c1", kbCategory: "wifi", at: day(1) }]);
  });
  it("eşleme yalnız 'bilgi yanlış' cümlesi tanımlı konular; saat konuları (2) saat denetiminde", () => {
    expect(ITEM_TOPIC_TO_KB).toEqual({
      wifi: "wifi",
      parking: "parking",
      cleaning_linen: "cleaning",
      trash: "trash",
      access_keys: "checkin",
      directions_transport: "location",
    });
  });
});

describe("detectContradictions", () => {
  const topics = (n: number, category = "wifi", at = day(2)) =>
    Array.from({ length: n }, (_, i) => ({ conversationId: `c${i}`, kbCategory: category, at }));

  it(`🚨 bilgi tabanında kalem + ${CONTRADICTION_MIN_GUESTS} ayrı misafir "bu bilgi yanlış" dedi → uyarı (metin misafir sözü taşımaz)`, () => {
    const w = detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(3), timeRows: [], now: NOW });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "kb_vs_complaints", memoryIds: ["f1"] });
    expect(w[0].text).toBe('Son 30 günde 3 misafir bilgi tabanındaki "Wi-Fi" bilgisinin yanlış olduğunu bildirdi. Kontrol edin.');
  });

  it("KONTROL: 2 misafir · aynı konuşmadan 3 mesaj · 30 günden eski · bilgi tabanında o konu yok → uyarı YOK", () => {
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(2), timeRows: [], now: NOW })).toEqual([]);
    const sameGuest = [0, 1, 2].map(() => ({ conversationId: "c1", kbCategory: "wifi", at: day(1) }));
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: sameGuest, timeRows: [], now: NOW })).toEqual([]);
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(3, "wifi", day(31)), timeRows: [], now: NOW })).toEqual([]);
    expect(detectContradictions({ facts: [fact("f1", "parking")], topics: topics(3, "wifi"), timeRows: [], now: NOW })).toEqual([]);
  });

  it("🚨 'Bilerek böyle' (kalem sonradan değişmedi) → uyarı kalkar; kalem işaretten SONRA değiştiyse → uyarı geri gelir", () => {
    const acked = fact("f1", "wifi", { observedAt: day(60), humanOverrideAt: day(1) });
    expect(detectContradictions({ facts: [acked], topics: topics(3), timeRows: [], now: NOW })).toEqual([]);
    const changed = fact("f1", "wifi", { observedAt: day(0.5), humanOverrideAt: day(1) });
    expect(detectContradictions({ facts: [changed], topics: topics(3), timeRows: [], now: NOW })).toHaveLength(1);
    // Aynı konuda iki kalem: biri işaretsizse uyarı kalır; kimlik sırası girdiden bağımsız (sıralı).
    expect(detectContradictions({ facts: [fact("f2", "wifi"), acked], topics: topics(3), timeRows: [], now: NOW })[0].memoryIds).toEqual(["f1", "f2"]);
  });

  it("bilgi tabanı ↔ bilgi tabanı / mülk ayarı (saat): ilgili hafıza kalemleriyle; işaretlenince kalkar; kalemi olmayan satır yok", () => {
    const row = { text: "Giriş saati: mülk ayarı 15:00, bilgi tabanı 14:00.", itemIds: ["kb-f9"] };
    const two = { text: "Giriş saati: iki kalem uyuşmuyor.", itemIds: ["kb-f9", "kb-f3"] };
    expect(
      detectContradictions({ facts: [fact("f9", "checkin"), fact("f3", "checkin")], topics: [], timeRows: [two], now: NOW })[0].memoryIds,
    ).toEqual(["f3", "f9"]);
    expect(detectContradictions({ facts: [fact("f9", "checkin")], topics: [], timeRows: [row], now: NOW })).toEqual([
      { kind: "kb_vs_kb", memoryIds: ["f9"], text: row.text },
    ]);
    expect(
      detectContradictions({ facts: [fact("f9", "checkin", { humanOverrideAt: day(1) })], topics: [], timeRows: [row], now: NOW }),
    ).toEqual([]);
    expect(detectContradictions({ facts: [], topics: [], timeRows: [row], now: NOW })).toEqual([]);
  });

  it("🚨 mülk ayarı ↔ bilgi tabanı satırı: işaret, mülk ayarı SONRADAN değiştiyse geçersiz (Haiku 4. tur)", () => {
    const acked = fact("f9", "checkin", { humanOverrideAt: day(2) });
    const row = (updated: Date | null) => ({ text: "Giriş saati çelişkisi", itemIds: ["kb-f9"], againstPropertyUpdatedAt: updated });
    expect(detectContradictions({ facts: [acked], topics: [], timeRows: [row(day(3))], now: NOW })).toEqual([]);
    expect(detectContradictions({ facts: [acked], topics: [], timeRows: [row(day(1))], now: NOW })).toHaveLength(1);
    expect(detectContradictions({ facts: [acked], topics: [], timeRows: [row(null)], now: NOW })).toEqual([]);
  });

  it("gelecek tarihli öğe sayılmaz (saat kayması)", () => {
    expect(detectContradictions({ facts: [fact("f1", "wifi")], topics: topics(3, "wifi", new Date(NOW.getTime() + 3_600_000)), timeRows: [], now: NOW })).toEqual([]);
  });
});

describe("🚨 yapay zekâya GİTMEZ (kurucu 10-11: yalnız ev sahibine uyarı)", () => {
  it("src/lib/ai altında hiçbir dosya çelişki modülünü / okuyucusunu kullanmaz", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src/lib/ai"));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => /getMemoryContradictions|memory\/contradictions|ContradictionWarning/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
