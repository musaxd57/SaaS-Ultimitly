import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ERKEN GİRİŞ OKUMA ÖRNEK BANKASI — biçim sözleşmesi (kurucu 11-18 akşam, H-3: "modeli örneklerle beslemeliyiz"; tasarım
// docs/TASARIM-2026-11-18-otomatik-erken-giris-pilotu.md §4). Kredi gerektirmez: model çağrılmaz. Sabitlenen: etiketler bugünkü okumanın
// sözlüğünde, 'train' ve 'measure' kümeleri AYRIK (ölçüm örneği eğitime sızmaz), istek yoksa saat yok, saat HH:MM.
// ---------------------------------------------------------------------------

interface Case {
  id: string;
  split: "train" | "measure";
  lang: string;
  message: string;
  requested: boolean;
  kind: string;
  time: string | null;
  note: string;
}

const set = JSON.parse(readFileSync(path.join(process.cwd(), "evals/early-checkin-reading-dev.json"), "utf8")) as {
  labels: { kind: string[]; split: string[] };
  cases: Case[];
};

describe("erken giriş okuma örnek bankası", () => {
  it("kimlikler tekil; etiketler kapalı kümeden; iki küme de dolu", () => {
    const ids = set.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of set.cases) {
      expect(set.labels.kind, c.id).toContain(c.kind);
      expect(set.labels.split, c.id).toContain(c.split);
      expect(c.message.trim().length, c.id).toBeGreaterThan(0);
    }
    expect(set.cases.filter((c) => c.split === "train").length).toBeGreaterThanOrEqual(10);
    expect(set.cases.filter((c) => c.split === "measure").length).toBeGreaterThanOrEqual(10);
  });

  it("🚨 ölçüm kümesi eğitim kümesine SIZMAZ: aynı (boşluk / büyük-küçük harf farkı gözetmeden) mesaj iki kümede birden yok", () => {
    const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
    const train = new Set(set.cases.filter((c) => c.split === "train").map((c) => norm(c.message)));
    for (const c of set.cases.filter((x) => x.split === "measure")) expect(train.has(norm(c.message)), c.id).toBe(false);
  });

  it("saat HH:MM ya da null; istek yoksa saat yok; erken giriş isteği yalnız 'early_checkin' türünde", () => {
    for (const c of set.cases) {
      if (c.time !== null) expect(c.time, c.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      if (!c.requested) expect(c.time, c.id).toBeNull();
      if (c.requested) expect(c.kind, c.id).toBe("early_checkin");
    }
  });

  it("her kümede zor sınıflar örnekli: bilgi sorusu, geri çekme, geç çıkış, bavul, saatsiz istek", () => {
    for (const split of ["train", "measure"] as const) {
      const cs = set.cases.filter((c) => c.split === split);
      expect(cs.some((c) => !c.requested && c.kind === "other"), `${split}: bilgi sorusu`).toBe(true);
      expect(cs.some((c) => !c.requested && c.kind === "early_checkin"), `${split}: geri çekme`).toBe(true);
      expect(cs.some((c) => c.kind === "late_checkout"), `${split}: geç çıkış`).toBe(true);
      expect(cs.some((c) => c.kind === "luggage"), `${split}: bavul`).toBe(true);
      expect(cs.some((c) => c.requested && c.time === null), `${split}: saatsiz istek`).toBe(true);
    }
  });
});
