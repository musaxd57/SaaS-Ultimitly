import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// AIRBNB MESAJ KURALLARI SETİ (kurucu 10-22: "airbnb'nin engellediği mesajları bizim modele bir dosyada koyabiliriz"). Pin: set biçimi
// geçerli, her soru için iki yön de var, gizli kötü niyetli (attack) vakalar yeterli, örnekler okuyucu istemine EZBER olarak girmemiş, kaynak
// belgesi Airbnb'nin kendi yardım sayfalarını anıyor.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
import { SENIOR_READER_SYSTEM_PROMPT } from "@/lib/ai/semantic/absence-judge";

const ROOT = path.resolve(__dirname, "../..");
type Exp = { payHost: boolean | null; contact: boolean | null; apology: boolean | null };
const set = JSON.parse(readFileSync(path.join(ROOT, "evals", "airbnb-message-policy.json"), "utf8")) as {
  cases: { id: string; guest: string; draft: string; attack?: boolean; expect: Exp }[];
};

describe("Airbnb mesaj kuralları seti", () => {
  it("biçim: tekil kimlik, dolu metin, üç hüküm (boolean ya da null)", () => {
    expect(set.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(set.cases.map((c) => c.id)).size).toBe(set.cases.length);
    for (const c of set.cases) {
      expect(c.guest.trim().length).toBeGreaterThan(0);
      expect(c.draft.trim().length).toBeGreaterThan(0);
      for (const k of ["payHost", "contact", "apology"] as const) expect([true, false, null]).toContain(c.expect[k]);
    }
  });

  it("her soru için iki yön de var (yalnız 'evet' ya da yalnız 'hayır' seti ölçmez)", () => {
    for (const k of ["payHost", "contact", "apology"] as const) {
      expect(set.cases.filter((c) => c.expect[k] === true).length).toBeGreaterThanOrEqual(4);
      expect(set.cases.filter((c) => c.expect[k] === false).length).toBeGreaterThanOrEqual(10);
    }
  });

  it("gizli kötü niyetli vakalar: en az 5, en az biri 'hayır' beklentili (aşırı tutma da ölçülür)", () => {
    const attacks = set.cases.filter((c) => c.attack);
    expect(attacks.length).toBeGreaterThanOrEqual(5);
    expect(attacks.some((c) => c.expect.payHost === false && c.expect.contact === false && c.expect.apology === false)).toBe(true);
  });

  it("ezber yok: setteki taslaklar okuyucu isteminde geçmez", () => {
    for (const c of set.cases) expect(SENIOR_READER_SYSTEM_PROMPT).not.toContain(c.draft.slice(0, 28));
  });

  it("kaynak belgesi Airbnb'nin kendi yardım sayfalarını anar", () => {
    const doc = path.join(ROOT, "docs", "AIRBNB-MESAJ-KURALLARI.md");
    expect(existsSync(doc)).toBe(true);
    const text = readFileSync(doc, "utf8");
    for (const a of ["help/article/4155", "help/article/251", "help/article/2799"]) expect(text).toContain(a);
  });
});
