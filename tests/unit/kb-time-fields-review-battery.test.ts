import { describe, it, expect } from "vitest";
import { timesIn, fieldTimeHits } from "@/lib/ai/retrieval/time-fields";
import { findTimeConflicts } from "@/lib/ai/prompts";
import { timeConflictHolds } from "@/lib/ai/time-conflict-gate";
import { kbTimeConflicts } from "@/lib/kb-time-conflicts";
import { TIME_FIELD_REVIEW_BATTERY, type ReviewClass } from "../helpers/time-field-review-battery";
import { scoreReviewCase } from "../helpers/time-field-review-score";

// ---------------------------------------------------------------------------
// SAAT OKUMA DOĞRULUK TURU (09-27, kurucu onayı: "yaklaşık 45 örneği başlangıç, son kabul, saat aralığı, koşullu erken/geç giriş
// ve başka bir olayın saati olarak ayrı test etsin; gerçek çelişkiyi kaçırmasın, sahte çelişki üretmesin. Belirsiz ifadede misafire
// kesin saat uydurmasın."). Batarya dört inceleme ajanının çalıştırılarak doğrulanmış bulguları + Codex C1b + her yeni kuralın
// İKİZİ (gerçek saat okunmaya / gerçek çelişki yakalanmaya devam eder + tuzak okunmaz). Eski okuyucu (`c9225d0`) 67 bulgunun 6'sını,
// 41 ikizin 23'ünü geçiyordu; rapor `docs/olcum/saat-okuma-2026-09-27.md`. Okuma = `fieldTimeHits`; çelişki = `kbPropertyMismatch`
// (istem çelişki bloğu + `kb_time_conflict` gönderim kapısı + ev sahibi "Uyuşmayan saatler" raporu aynı kuralı kullanır).
// ---------------------------------------------------------------------------

const CLASSES: ReviewClass[] = ["baslangic", "son_kabul", "aralik", "kosullu", "baska_olay"];

for (const cls of CLASSES) {
  describe(`inceleme bataryası — ${cls}`, () => {
    for (const c of TIME_FIELD_REVIEW_BATTERY.filter((x) => x.cls === cls)) {
      it(`${c.id} [${c.src}] ${c.text}`, () => {
        const s = scoreReviewCase(c);
        if (c.expect) expect(s.got).toEqual([...c.expect].sort());
        if (c.conflict?.checkin) expect(s.gotConflict.checkin).toEqual([...c.conflict.checkin].sort());
        if (c.conflict?.checkout) expect(s.gotConflict.checkout).toEqual([...c.conflict.checkout].sort());
      });
    }
  });
}

describe("batarya bütünlüğü", () => {
  it("anti-vakum: her sınıfta hem bulgu hem ikiz var; kimlikler tekil; her vaka bir şey puanlıyor", () => {
    const ids = TIME_FIELD_REVIEW_BATTERY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cls of CLASSES) {
      const rows = TIME_FIELD_REVIEW_BATTERY.filter((c) => c.cls === cls);
      expect(rows.some((c) => !c.id.startsWith("T")), cls).toBe(true);
      expect(rows.some((c) => c.id.startsWith("T")), cls).toBe(true);
    }
    for (const c of TIME_FIELD_REVIEW_BATTERY) expect(c.expect !== undefined || c.conflict !== undefined, c.id).toBe(true);
    expect(TIME_FIELD_REVIEW_BATTERY.length).toBeGreaterThanOrEqual(100);
  });
});

describe("uçtan uca — istem çelişki bloğu + gönderim kapısı + ev sahibi raporu", () => {
  const PROP = { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" };
  const kb = (category: string, title: string, content: string) => ({ category, title, content });
  const asksCheckin = { intent: "checkin", reply: "Giriş saatimiz 15:00'tir.", guestTexts: ["Saat kaçta giriş yapabiliriz?"] };

  it("🚨 son kabul sahte çelişki DEĞİL: 'Latest check-in is 10 pm' → istemde çelişki yok, giriş sorusunun cevabı TUTULMAZ", () => {
    const conflicts = findTimeConflicts(PROP, [kb("checkin", "Late arrival", "Latest check-in is 10 pm.")]);
    expect(conflicts).toEqual([]);
    expect(timeConflictHolds(conflicts, asksCheckin)).toBe(false);
  });

  it("KONTROL — pencere mülkün girişinden önce biterse gerçek çelişki: 'Check-in must be completed by 14:00' → tutulur", () => {
    const conflicts = findTimeConflicts(PROP, [kb("checkin", "Check-in", "Check-in must be completed by 14:00.")]);
    expect(conflicts).toEqual([{ field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] }]);
    expect(timeConflictHolds(conflicts, asksCheckin)).toBe(true);
  });

  it("🚨 C1b: 'Check-in from 15:00. Check-in at 14:00.' gerçek çelişki (eskiden kaçıyordu) → tutulur", () => {
    const conflicts = findTimeConflicts(PROP, [kb("checkin", "Giriş", "Check-in from 15:00. Check-in at 14:00.")]);
    expect(conflicts).toEqual([{ field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] }]);
    expect(timeConflictHolds(conflicts, asksCheckin)).toBe(true);
  });

  it("🚨 koşullu erken giriş / para / ziyaretçi / müze girişi mülkle çelişmez (hepsi eskiden sahte çelişkiydi)", () => {
    expect(
      findTimeConflicts(PROP, [
        kb("checkin", "Giriş", "Müsaitliğe bağlı olarak 12:00'de girebilirsiniz."),
        kb("checkin", "Check-in", "A deposit of €10.00 is due at check-in."),
        kb("rules", "Ziyaretçi", "Ziyaretçilerin daireye girişi 22:00'den sonra yasaktır."),
        kb("general", "Gezi", "Topkapı Sarayı'na giriş 09:00'da başlıyor, son giriş 17:00'de."),
        kb("checkout", "Check-out", "You can check out at 1 pm for a €20 fee."),
      ]),
    ).toEqual([]);
  });

  it("KONTROL — gerçek çelişki yakalanır: 'Giriş 14'ten itibaren, çıkış 12'ye kadar' ('saat'siz Türkçe saat)", () => {
    expect(findTimeConflicts(PROP, [kb("general", "Saatler", "Giriş 14'ten itibaren, çıkış 12'ye kadar.")])).toEqual([
      { field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] },
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });

  it("ev sahibi raporu son kabul çelişkisini gösterir: cümle pencere sonunun cümlesidir", () => {
    const rows = kbTimeConflicts({ checkInTime: "15:00", checkOutTime: "11:00" }, [
      { id: "k1", category: "checkin", title: "Giriş", content: "Giriş 15:00'tir. Girişler en geç 14:00'e kadar tamamlanmalıdır." },
    ]);
    const row = rows.find((r) => r.field === "checkin" && r.kind === "property");
    expect(row?.sides).toEqual([
      expect.objectContaining({ itemId: "k1", values: ["14:00"], sentence: "Girişler en geç 14:00'e kadar tamamlanmalıdır" }),
    ]);
  });

  it("🚨 gönderim kapısı cevabın saatini aynı tarayıcıyla okur: para / tarih saat değil, 'noon' ve 'buçuk' saat", () => {
    expect([...timesIn("The deposit is €15.00 and the tourist tax 2.50 EUR.")]).toEqual([]);
    expect([...timesIn("Rezervasyonlar 15.04 tarihinde açılır.")]).toEqual([]);
    expect([...timesIn("Check-out by noon.")]).toEqual(["12:00"]);
    // Noktasız / bitişik işaret: "11 a.m," (virgülden önce) ve "4p.m." — kapı cevap metnini normalleştirmeden tarar.
    expect([...timesIn("Check-out at 11 a.m, thanks.")]).toEqual(["11:00"]);
    expect([...timesIn("Check-in from 4p.m.")]).toEqual(["16:00"]);
    expect([...timesIn("Çıkış saat 11 buçukta.")]).toEqual(["11:30"]);
    expect([...timesIn("Check-in 3 – 10 pm.")].sort()).toEqual(["15:00", "22:00"]);
    // Kesin Türkçe dakika çözülür; çözülemeyen dakikada kesin saat yok (eskisi ikisini de 11:00 okuyordu).
    expect([...timesIn("saat 11'i on geçe")]).toEqual(["11:10"]);
    expect([...timesIn("saat 11'i biraz geçe")]).toEqual([]);
    // Çelişkili mülkte cevap çelişen saati "12 noon" diye söylese de tutulur.
    const conflicts = [{ field: "checkOutTime" as const, propertyValue: "11:00", kbValues: ["12:00"] }];
    expect(timeConflictHolds(conflicts, { intent: "general", reply: "You can leave at 12 noon.", guestTexts: ["Taxi?"] })).toBe(true);
  });

  it("zayıf kanıt ('saat'siz Türkçe saat) başlıktan ödünç alınmaz; cümleciğin kendi alanına okunur", () => {
    expect(fieldTimeHits("Giriş", "Kapasite 12'de.", "checkin")).toEqual([]);
    expect(fieldTimeHits("Bilgi", "Çıkış 11'de.", "general").map((h) => `${h.field}:${h.time}`)).toEqual(["checkout:11:00"]);
  });
});
