import { describe, it, expect } from "vitest";
import { kbOverlaps, retiredValueVerdict, KB_OVERLAP_MAX } from "@/lib/history-learn/kb-overlap";

// ---------------------------------------------------------------------------
// L2 (kurucu 10-17): Geçmişten öğren taslağı × mevcut bilgi tabanı — saf "aynı konu" tespiti + "yerine konan eski değer bir daha önerilmez".
// ---------------------------------------------------------------------------

const at = (iso: string) => new Date(iso);
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

  it("aşırı uygulama yok: geniş kategoride (rules) kavram ayrıysa aday DEĞİL; kategori farklıysa aday değil", () => {
    expect(
      kbOverlaps({ category: "rules", title: "Sigara", content: "Dairede sigara içilmez." }, [
        item("k1", "rules", "Evcil hayvan", "Evcil hayvan kabul edilmez."),
      ]),
    ).toEqual([]);
    expect(kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024" }, [item("k1", "parking", "Otopark", "x")])).toEqual([]);
  });

  it("en çok 3 aday, en yeni önce (eşitlikte kimlik)", () => {
    const items = ["2026-01-01", "2026-03-01", "2026-02-01", "2026-04-01", "2026-04-01"].map((d, i) =>
      item(`k${i}`, "wifi", "Wi-Fi", `Şifre abc${i}x`, `${d}T00:00:00Z`),
    );
    const m = kbOverlaps({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024" }, items);
    expect(m).toHaveLength(KB_OVERLAP_MAX);
    expect(m.map((x) => x.id)).toEqual(["k3", "k4", "k1"]);
  });
});

describe("retiredValueVerdict — 'güncel olanı seçince o artık doğru' (kurucu 10-17)", () => {
  const retired = [{ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024", supersededAt: at("2026-10-18T10:00:00Z") }];
  it("🚨 yerine konan eski değer, kanıtı değişiklikten önce → bir daha ÖNERİLMEZ", () => {
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024", newestMonth: "2026-09" }, retired)).toBe("suppress");
    expect(retiredValueVerdict({ category: "wifi", title: "Wi-Fi", content: "Şifre lale2024", newestMonth: "2026-10" }, retired)).toBe("suppress");
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
