import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { detectAvailabilityClaim, detectAvailabilityRequest, hasAvailabilityDeferral } from "@/lib/ai/availability-claims";

// ---------------------------------------------------------------------------
// DETERMİNİSTİK YEDEĞİN TABANI (09-24) — HEDEF DEĞİL, CIRCIR.
//
// Kör bataryada ölçülen gerçek (`evals/stay-change.json`, `dev` bölümü): kelime ağı izinlerin 19/60'ını,
// takvim iddialarının 31/57'sini, isteklerin 77/125'ini yakalıyor. Bu yüzden karar artık dört katmanın
// birleşimidir ve kelime ağı YALNIZ YEDEKTİR (model yokken/arızadayken de çalışan dar ağ). Bu dosya
// yedeğin ölçülmüş düzeyinin sessizce DÜŞMEMESİNİ pinler: bir değişiklik tabanı düşürürse kırmızı.
// Taban YALNIZ YUKARI güncellenir, ve 'dev' bölümüne göre kalıp eklemek ölçüyü bozar (kör değil artık)
// — genelleme `holdout` bölümüyle, gerçek model eval'inde ölçülür (`tests/eval/stay-change.eval.test.ts`).
// ---------------------------------------------------------------------------

interface Item {
  split: string;
  text: string;
  kind?: string;
  label?: string;
}
const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/stay-change.json"), "utf8")) as {
  requests: Item[];
  replies: Item[];
};

function count(items: Item[], pred: (i: Item) => boolean) {
  return items.filter(pred).length;
}

describe("deterministik yedek — ölçülmüş taban (dev bölümü)", () => {
  const req = data.requests.filter((r) => r.split === "dev");
  const rep = data.replies.filter((r) => r.split === "dev");
  const byLabel = (l: string) => rep.filter((r) => r.label === l);

  it("çapa: bölüm dolu (vakum değil)", () => {
    expect(req.length).toBe(268);
    expect(rep.length).toBe(326);
  });

  it("istek: isabet ≥ 77/125, yanlış alarm ≤ 10/143", () => {
    const pos = req.filter((r) => r.kind !== "none");
    const neg = req.filter((r) => r.kind === "none");
    expect(pos.length).toBe(125);
    expect(count(pos, (r) => detectAvailabilityRequest(r.text) !== null)).toBeGreaterThanOrEqual(77);
    expect(count(neg, (r) => detectAvailabilityRequest(r.text) !== null)).toBeLessThanOrEqual(10);
  });

  it("cevap: takvim ≥ 31/57 · izin ≥ 19/60 · erteleme tanıma ≥ 61/76 · tarafsızda yanlış alarm ≤ 1/118", () => {
    expect(count(byLabel("claim"), (r) => detectAvailabilityClaim(r.text) !== null)).toBeGreaterThanOrEqual(31);
    expect(count(byLabel("grant"), (r) => detectAvailabilityClaim(r.text) !== null)).toBeGreaterThanOrEqual(19);
    expect(count(byLabel("deferral"), (r) => detectAvailabilityClaim(r.text) === null && hasAvailabilityDeferral(r.text))).toBeGreaterThanOrEqual(61);
    expect(count(byLabel("neutral"), (r) => detectAvailabilityClaim(r.text) !== null)).toBeLessThanOrEqual(1);
  });
});

describe("deterministik yedek — ölçülmüş taban (holdout bölümü, İLK ve TEK ölçüm 09-24)", () => {
  // 🚨 HOLDOUT'A GÖRE KALIP YAZILMAZ: bu bölüm ikinci kör bataryadır (uygulamayı görmeyen ajan, ~%40'ı
  // anahtar kelimesiz, saatler mülkün standart saatine göre etiketli). Sayılar kelime ağının GERÇEK
  // genelleme düzeyidir ve kararın neden model katmanlarında olduğunu gösterir; yalnız DÜŞMEMELERİ pinlenir.
  const req = data.requests.filter((r) => r.split === "holdout");
  const rep = data.replies.filter((r) => r.split === "holdout");
  const byLabel = (l: string) => rep.filter((r) => r.label === l);

  it("çapa: bölüm dolu (vakum değil)", () => {
    expect(req.length).toBe(331);
    expect(rep.length).toBe(421);
  });

  it("istek: isabet ≥ 77/170, yanlış alarm ≤ 28/161 (zor benzerler: olumsuz/karşı-olgusal istek, olanak müsaitliği, uzatma kablosu)", () => {
    const pos = req.filter((r) => r.kind !== "none");
    const neg = req.filter((r) => r.kind === "none");
    expect(pos.length).toBe(170);
    expect(count(pos, (r) => detectAvailabilityRequest(r.text) !== null)).toBeGreaterThanOrEqual(77);
    expect(count(neg, (r) => detectAvailabilityRequest(r.text) !== null)).toBeLessThanOrEqual(28);
  });

  it("cevap: takvim ≥ 26/73 · izin ≥ 13/95 · erteleme tanıma ≥ 41/77 · tarafsızda yanlış alarm ≤ 3/127", () => {
    expect(count(byLabel("claim"), (r) => detectAvailabilityClaim(r.text) !== null)).toBeGreaterThanOrEqual(26);
    expect(count(byLabel("grant"), (r) => detectAvailabilityClaim(r.text) !== null)).toBeGreaterThanOrEqual(13);
    expect(count(byLabel("deferral"), (r) => detectAvailabilityClaim(r.text) === null && hasAvailabilityDeferral(r.text))).toBeGreaterThanOrEqual(41);
    expect(count(byLabel("neutral"), (r) => detectAvailabilityClaim(r.text) !== null)).toBeLessThanOrEqual(3);
  });
});
