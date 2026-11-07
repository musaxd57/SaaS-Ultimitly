import { describe, it, expect } from "vitest";
import {
  kbOverlaps as kbOverlapsPrepared,
  retiredValueVerdict as retiredVerdictPrepared,
  prepareKbItems,
  prepareRetiredItems,
  KB_OVERLAP_MAX,
} from "@/lib/history-learn/kb-overlap";

// ---------------------------------------------------------------------------
// L2 (kurucu 10-17): Geçmişten öğren taslağı × mevcut bilgi tabanı — saf "aynı konu" tespiti + "yerine konan eski değer bir daha önerilmez".
// ---------------------------------------------------------------------------

const at = (iso: string) => new Date(iso);
// Eşleştiriciler YALNIZ hazırlanmış kalem alır (üretimde istek / koşu başına bir kez) — testte her çağrıda hazırlanır.
const kbOverlaps = (draft: Parameters<typeof kbOverlapsPrepared>[0], items: Parameters<typeof prepareKbItems>[0]) =>
  kbOverlapsPrepared(draft, prepareKbItems(items));
const retiredValueVerdict = (draft: Parameters<typeof retiredVerdictPrepared>[0], retired: Parameters<typeof prepareRetiredItems>[0]) =>
  retiredVerdictPrepared(draft, prepareRetiredItems(retired));
const item = (id: string, category: string, title: string, content: string, updatedAt = "2026-10-01T00:00:00Z") => ({
  id,
  category,
  title,
  content,
  updatedAt: at(updatedAt),
});

describe("kbOverlaps", () => {
  it("🚨 wifi: farklı şifre → 'differs' (ev sahibine iki değer de gösterilir)", () => {
    const m = kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024" }, [item("k1", "wifi", "Wi-Fi", "Şifre yeni2025")]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: "k1", kind: "differs" });
  });

  it("aynı değer zaten kayıtlı → 'same'; değersiz → 'topic'", () => {
    expect(kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre yeni2025" }, [item("k1", "wifi", "Wi-Fi", "Ağ şifresi yeni2025")])[0].kind).toBe("same");
    expect(kbOverlaps({ category: "parking", title: "Otopark", content: "Binanın arkasında" }, [item("k1", "parking", "Otopark", "Ücretsiz")])[0].kind).toBe(
      "topic",
    );
  });

  it("taslakta değer var ama kalemde değer yok → 'topic' (karşılaştırılacak değer yok — 'farklı' denmez)", () => {
    expect(kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024" }, [item("k1", "wifi", "Wi-Fi", "Şifre kartta yazıyor")])[0].kind).toBe(
      "topic",
    );
    // Kısmi örtüşme (ağ adı aynı, şifre farklı — en sık Wi-Fi değişikliği) → 'differs'.
    expect(
      kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Ağ Lale_Ev şifre lale2024" }, [item("k1", "wifi", "Wi-Fi", "Ağ Lale_Ev şifre yeni2025")])[0].kind,
    ).toBe("differs");
  });

  it("aşırı uygulama yok: geniş kategoride (rules) kavram ayrıysa aday DEĞİL; kategori farklıysa aday değil", () => {
    expect(
      kbOverlaps({ category: "rules", title: "Sigara", content: "Dairede sigara içilmez." }, [
        item("k1", "rules", "Evcil hayvan", "Evcil hayvan kabul edilmez."),
      ]),
    ).toEqual([]);
    expect(kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024" }, [item("k1", "parking", "Otopark", "x")])).toEqual([]);
  });

  it("en çok 5 aday, en yeni önce (eşitlikte kimlik)", () => {
    const items = ["2026-01-01", "2026-03-01", "2026-02-01", "2026-04-01", "2026-04-01", "2025-12-01", "2026-05-01"].map((d, i) =>
      item(`k${i}`, "wifi", "Wi-Fi", `Şifre abc${i}x`, `${d}T00:00:00Z`),
    );
    const m = kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024" }, items);
    expect(KB_OVERLAP_MAX).toBe(5);
    expect(m).toHaveLength(KB_OVERLAP_MAX);
    expect(m.map((x) => x.id)).toEqual(["k6", "k3", "k4", "k1", "k2"]);
  });

  it("🚨 Haiku 10-17: saat parçaları ve kısa sayılar değer DEĞİL ('12:00' ↔ '12:00' aynı değer sayılıp 'same' denmez)", () => {
    const m = kbOverlaps({ category: "checkin", title: "Geç çıkış", content: "Geç çıkış 12:00'ye kadar ücretli." }, [
      item("k1", "checkin", "Çıkış saati", "Çıkış saati 12:00, geç çıkış için yazın."),
    ]);
    expect(m.map((x) => x.kind)).toEqual(["topic"]);
  });

  it("Haiku 10-17 ikinci tur: kısa şifre ('555', 3 hane) değerdir — saat ayıklanır, sayı kalır", () => {
    expect(kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre: 555" }, [item("k1", "wifi", "Wi-Fi", "Şifre: 777")])[0].kind).toBe("differs");
    expect(kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre: 555" }, [item("k1", "wifi", "Wi-Fi", "Şifre: 555")])[0].kind).toBe("same");
  });

  it("dar kategoride konu hesaplanmaz (kategori yeter); geniş kategoride kavram şart", () => {
    const [p] = prepareKbItems([item("k1", "wifi", "Wi-Fi", "Şifre yeni2025")]);
    expect(p.topics).toBeNull();
    const [r] = prepareKbItems([item("k2", "rules", "Sigara", "Dairede sigara içilmez.")]);
    expect(r.topics?.size).toBeGreaterThan(0);
  });
});

describe("retiredValueVerdict — 'güncel olanı seçince o artık doğru' (kurucu 10-17)", () => {
  const retired = [{ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024", supersededAt: at("2026-10-18T10:00:00Z") }];
  it("🚨 yerine konan eski değer, kanıtı değişiklikten önce → bir daha ÖNERİLMEZ", () => {
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024", newestMonth: "2026-09" }, retired)).toBe("suppress");
  });
  it("Haiku 10-17: değişiklik AYINDAKİ kanıt belirsizdir → gizlenmez, 'eski değer' işaretiyle gelir", () => {
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024", newestMonth: "2026-10" }, retired)).toBe("outdated");
  });
  it("🚨 Haiku 10-17: saat parçaları ('12:00' → 12, 00) değer sayılmaz; konu farklıysa gizlenmez (geç çıkış ≠ çıkış saati)", () => {
    const retiredCheckout = [{ category: "checkin", title: "Çıkış saati", content: "Çıkış saati 12:00", supersededAt: at("2026-10-18T10:00:00Z") }];
    expect(
      retiredValueVerdict({ category: "checkin", title: "Geç çıkış", content: "Geç çıkış 12:00'ye kadar ücretli.", newestMonth: "2026-09" }, retiredCheckout),
    ).toBeNull();
  });
  it("Haiku 10-17 ikinci tur: kısa eski şifre ('555') de bir daha önerilmez", () => {
    const old555 = [{ category: "wifi", title: "Wi-Fi", content: "Şifre: 555", supersededAt: at("2026-10-18T10:00:00Z") }];
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre: 555", newestMonth: "2026-09" }, old555)).toBe("suppress");
  });
  it("🚨 Haiku 10-17 ikinci tur: aynı değer ama BAŞKA konu (geniş kategori) → gizlenmez (konu dalı ayrı sınanır)", () => {
    const retiredPet = [{ category: "rules", title: "Evcil hayvan", content: "Evcil hayvan kabul edilmez, ceza 1500 TL.", supersededAt: at("2026-10-18T10:00:00Z") }];
    const draft = { category: "rules", title: "Sigara", content: "Dairede sigara içilmez, ceza 1500 TL.", newestMonth: "2026-09" };
    expect(retiredValueVerdict(draft, retiredPet)).toBeNull();
    // KONTROL: aynı konu + aynı değer → gizlenir (yukarıdaki null konu yüzünden, değer yüzünden değil).
    const retiredSmoke = [{ category: "rules", title: "Sigara", content: "Sigara içilmez, ceza 1500 TL.", supersededAt: at("2026-10-18T10:00:00Z") }];
    expect(retiredValueVerdict(draft, retiredSmoke)).toBe("suppress");
  });
  it("kanıt değişiklikten SONRA (ev sahibi eski değeri yeniden yazmış) → gelir ama 'eski değer' işaretiyle", () => {
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024", newestMonth: "2026-11" }, retired)).toBe("outdated");
  });
  it("aşırı uygulama yok: farklı değer / değersiz metin / başka kategori → karar yok", () => {
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre yeni2025", newestMonth: "2026-09" }, retired)).toBeNull();
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre kartta yazıyor", newestMonth: "2026-09" }, retired)).toBeNull();
    expect(retiredValueVerdict({ category: "parking", title: "P", content: "Şifre lale2024", newestMonth: "2026-09" }, retired)).toBeNull();
  });
});
