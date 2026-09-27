import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { wideBudgetInfo } from "@/lib/ai/retrieval/flag";
import {
  KB_CHAR_BUDGET,
  KB_RETRIEVAL_CHAR_BUDGET,
  KB_RETRIEVAL_MAX_CHUNKS,
  KB_RETRIEVAL_WIDE_CHAR_BUDGET,
  KB_RETRIEVAL_WIDE_MAX_CHUNKS,
} from "@/lib/ai/limits";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #189 GENİŞ BLOK BÜTÇESİ (kurucu 09-27 "hazırla, sonra aç"; `KB_RETRIEVAL_WIDE_BUDGET` varsayılan KAPALI). Gerçek müşteri
// boyutunda (60 kalem) iki sorulu mesajın ikinci cevabı aday listesinde ama 6k/12 bloğa sığmıyordu. Sözleşme: kapalıyken
// sonuç BİREBİR eski; açıkken yalnız seçim yapılan bilgi tabanında blok 23k / 40 parçaya kadar büyür, paketleyici seçilen
// hiçbir parçayı atmaz; küçük bilgi tabanı ve acil durdurma etkilenmez; çağıranın kendi bütçesi önceliklidir.
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 0, 1);
const filler = "Araç bina önündeki açık alana ya da yan sokaktaki ücretli alana bırakılabilir; gece de erişim vardır. ";
const parks = Array.from({ length: 45 }, (_, i) => ({
  id: `park${i}`,
  category: "parking",
  title: `Otopark ${i}`,
  content: `Otopark bilgisi ${i}: ${filler.repeat(5)}`,
  updatedAt: new Date(T0 - i * 60_000),
}));
const big = [...parks, ...neutralPadding(20, T0)];
const MSG = "Otopark nerede?";
const rendered = (items: readonly { category: string; title: string; content: string }[]) =>
  items.reduce((n, i) => n + i.category.length + i.title.length + i.content.length + 6, 0);

beforeEach(() => {
  __resetKbIndexCache();
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
  vi.stubEnv("KB_RERANK_ENABLED", "");
  vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
  vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("anahtar", () => {
  it("varsayılan KAPALI; açma yazımları açar; tanınmayan değer KAPALI (gürültülü)", () => {
    expect(wideBudgetInfo()).toEqual({ enabled: false, raw: "", recognized: true });
    for (const on of ["1", "on", "true"]) {
      vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", on);
      expect(wideBudgetInfo().enabled).toBe(true);
    }
    vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "evet");
    expect(wideBudgetInfo()).toMatchObject({ enabled: false, recognized: false });
  });

  it("değerler: legacy'nin 24k tavanının ALTINDA (paketleyici payı), bugünkü bütçenin üstünde", () => {
    expect(KB_RETRIEVAL_WIDE_CHAR_BUDGET).toBeLessThan(KB_CHAR_BUDGET);
    expect(KB_CHAR_BUDGET - KB_RETRIEVAL_WIDE_CHAR_BUDGET).toBeGreaterThanOrEqual(KB_RETRIEVAL_WIDE_MAX_CHUNKS);
    expect(KB_RETRIEVAL_WIDE_CHAR_BUDGET).toBeGreaterThan(KB_RETRIEVAL_CHAR_BUDGET);
    expect(KB_RETRIEVAL_WIDE_MAX_CHUNKS).toBeGreaterThan(KB_RETRIEVAL_MAX_CHUNKS);
  });
});

describe("KAPALI — birebir eski", () => {
  it("sonuç seçicinin varsayılanıyla aynı; ≤12 parça; kanıtta wb YOK", async () => {
    const r = await retrieveKbForPrompt({ items: big, guestMessage: MSG });
    __resetKbIndexCache();
    const direct = selectKbForPrompt({ items: big, guestMessage: MSG });
    expect(r.items.map((i) => `${i.id}#${i.chunk ?? 0}`)).toEqual(direct.items.map((i) => `${i.id}#${i.chunk ?? 0}`));
    expect(r.items.length).toBeLessThanOrEqual(KB_RETRIEVAL_MAX_CHUNKS);
    expect(r.evidence).not.toHaveProperty("wb");
  });
});

describe("AÇIK", () => {
  beforeEach(() => vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "1"));

  it("🚨 seçimde blok büyür (12'den fazla parça), 23k / 40 tavanı aşılmaz; kanıtta wb: 1", async () => {
    const r = await retrieveKbForPrompt({ items: big, guestMessage: MSG });
    expect(r.selection).toBe("retrieved");
    expect(r.items.length).toBeGreaterThan(KB_RETRIEVAL_MAX_CHUNKS);
    expect(r.items.length).toBeLessThanOrEqual(KB_RETRIEVAL_WIDE_MAX_CHUNKS);
    expect(rendered(r.items)).toBeLessThanOrEqual(KB_RETRIEVAL_WIDE_CHAR_BUDGET);
    expect(r.evidence).toMatchObject({ wb: 1 });
  });

  it("🚨 paketleyici seçilen HİÇBİR parçayı atmaz — bütçe tam dolsa da (23k payı; 24k'da son parça düşerdi)", async () => {
    // Her parça seçicinin hesabıyla TAM 600 karakter: 23k'da 38 parça (22.800), 24k'da 40 parça (24.000) — paketleyici satır
    // başına 1 fazla sayar (24.040 > 24k) ve son parçayı sessizce "alınmadı" yapardı.
    const body = (i: number) => {
      let s = `Otopark ${String(i).padStart(3, "0")} bilgisi. `;
      while (s.length < 571) s += "Araç bina önündeki alana bırakılır ve gece de erişim vardır. ";
      return s.slice(0, 571).trimEnd().padEnd(571, "x");
    };
    const exact = Array.from({ length: 50 }, (_, i) => ({
      id: `ex${i}`,
      category: "parking",
      title: `Otopark notu ${String(i).padStart(3, "0")}`,
      content: body(i),
      updatedAt: new Date(T0 - i * 60_000),
    }));
    expect(rendered(exact.slice(0, 1))).toBe(600);
    const r = await retrieveKbForPrompt({ items: exact, guestMessage: MSG });
    expect(r.items.length).toBeGreaterThan(KB_RETRIEVAL_MAX_CHUNKS);
    expect(rendered(r.items)).toBeGreaterThan(KB_RETRIEVAL_WIDE_CHAR_BUDGET - 600);
    const packed = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes);
    expect(packed.omitted).toBe(r.droppedItems);
    expect(packed.text.split("\n").filter((l) => l.startsWith("- [PARKING]"))).toHaveLength(r.items.length);
  });

  it("acil durdurma (legacy) ve küçük bilgi tabanı etkilenmez; kanıtta wb YOK", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    const legacy = await retrieveKbForPrompt({ items: big, guestMessage: MSG });
    expect(legacy.mode).toBe("legacy");
    expect(legacy.evidence ?? {}).not.toHaveProperty("wb");
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
    const small = await retrieveKbForPrompt({ items: parks.slice(0, 10), guestMessage: MSG });
    expect(small.items).toHaveLength(10);
    expect(small.evidence).not.toHaveProperty("wb");
  });

  it("çağıranın kendi bütçesi ÖNCELİKLİ (ölçer / test); kanıtta wb YOK", async () => {
    const r = await retrieveKbForPrompt({ items: big, guestMessage: MSG, budgetChars: 1_500, maxChunks: 3 });
    expect(r.items.length).toBeLessThanOrEqual(3);
    expect(r.evidence).not.toHaveProperty("wb");
  });
});

describe("karar kaydı", () => {
  it("wb yalnız 1 ise kayda geçer", () => {
    const base = { mode: "hybrid", q: 1, fb: "none", sel: 1, cand: 1, ms: 1 } as const;
    const row = [{ id: "kb1", updatedAt: new Date(T0) }];
    const withWb = JSON.parse(buildKbEvidence({ retrieved: row, usedLabels: [], retrieval: { ...base, wb: 1 } }) ?? "{}");
    expect(withWb.retrieval.wb).toBe(1);
    const bad = JSON.parse(buildKbEvidence({ retrieved: row, usedLabels: [], retrieval: { ...base, wb: 2 } }) ?? "{}");
    expect(bad.retrieval).toBeDefined();
    expect(bad.retrieval).not.toHaveProperty("wb");
  });
});
