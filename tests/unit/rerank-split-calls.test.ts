import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// #189 SORU BAŞINA AYRI YENİDEN SIRALAMA ÇAĞRISI. Ölçüm: iki sorulu mesajın iki penceresi TEK çağrıda (~90 aday) sorulunca
// model cevap parçalarının %21'ini işaretlemiyordu; soru başına ayrı (paralel) çağrıda tek soru başarısına iner. Ağ kapısı
// taklit edilir: her çağrının GÖRDÜĞÜ aday listesi ve birleşim kuralı sınanır.
// ---------------------------------------------------------------------------

const calls: { user: string }[] = [];
let failWhen: (user: string) => boolean = () => false;
vi.mock("@/lib/ai/semantic/structured-call", () => ({
  callStructuredJson: vi.fn(async (input: { user: string }) => {
    calls.push({ user: input.user });
    if (failWhen(input.user)) return { ok: false, error: "timeout", ms: 2500 };
    // Cevap: metninde "CEVAP" geçen adayların kimlikleri (C1…Cn satırlarından). Ortak taban adayı "Genel bilgi 0": askı
    // penceresinde "cevap", pil penceresinde yalnız "ilgili" (birleşim kuralı sınansın).
    const answers = [...input.user.matchAll(/\[(C\d+)\] <<<[^\n]*CEVAP/g)].map((m) => m[1]);
    const shared = /\[(C\d+)\] <<<[^\n]*Genel bilgi 0\./.exec(input.user)?.[1];
    const related: string[] = [];
    if (shared && input.user.includes("Askı notu")) answers.push(shared);
    else if (shared) related.push(shared);
    return { ok: true, data: { answers, related }, ms: 40 };
  }),
}));

import {
  prepareRerankScores,
  rerankCandidateWindows,
  unionTopCandidates,
  RERANK_LEGACY_CANDIDATES,
  RERANK_OWN_CANDIDATES,
  RERANK_MAX_CALLS,
} from "@/lib/ai/semantic/rerank";

const T0 = Date.UTC(2026, 0, 1);
const item = (id: string, content: string) => ({ id, category: "general", title: id, content, updatedAt: new Date(T0) });
// Özgün (karışık) liste + iki isteğin listeleri. Cevaplar yalnız kendi isteğinin listesinde derinde.
const own = Array.from({ length: 12 }, (_, i) => item(`o${i}`, `Genel bilgi ${i}.`));
const q1 = Array.from({ length: 30 }, (_, i) => item(`a${i}`, i === 25 ? "CEVAP bir: askılık salonda." : `Askı notu ${i}.`));
const q2 = Array.from({ length: 30 }, (_, i) => item(`b${i}`, i === 22 ? "CEVAP iki: pil TV dolabında." : `Pil notu ${i}.`));
const items = [...own, ...q1, ...q2];
const toList = (xs: { id: string }[]) => xs.map((x) => ({ key: `${x.id}#0` }));
const candidates = [toList(own), toList(q1), toList(q2)];
const candidateMeta = [{ extra: false }, { extra: true, request: 0 }, { extra: true, request: 1 }];

beforeEach(() => {
  calls.length = 0;
  failWhen = () => false;
  vi.stubEnv("KB_RERANK_PER_QUESTION", "1");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-rerank-0000000000000000");
  vi.stubEnv("AI_SEMANTIC_API_KEY", "");
  vi.stubEnv("AI_SEMANTIC_MODEL", "");
  vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
});
afterEach(() => vi.unstubAllEnvs());

describe("soru başına ayrı çağrı", () => {
  it("iki istek → iki çağrı; her çağrı KENDİ isteğinin penceresini + tabanı görür; puanlar birleşir", async () => {
    const out = await prepareRerankScores({ items, guestMessage: "Askılık nerede? Bir de pil var mı?", candidates, candidateMeta });
    expect(calls).toHaveLength(2);
    expect(calls[0].user).toContain("CEVAP bir");
    expect(calls[0].user).not.toContain("Pil notu");
    expect(calls[1].user).toContain("CEVAP iki");
    expect(calls[1].user).not.toContain("Askı notu");
    for (const c of calls) expect(c.user).toContain("Genel bilgi 0"); // taban her pencerede
    expect(out.status).toBe("ok");
    expect(out.status === "ok" && out.scores.get("a25#0")).toBe(3);
    expect(out.status === "ok" && out.scores.get("b22#0")).toBe(3);
    expect(out.calls).toBe(2);
    // İki pencerede de görülen aday: bir çağrıda "cevap" (3), ötekinde "ilgili" (2) → birleşim EN YÜKSEĞİ (sıra bağımsız).
    expect(out.status === "ok" && out.scores.get("o0#0")).toBe(3);
  });

  it("bir çağrı düşerse diğerinin işaretleri kullanılır (düşen sorunun adayları bugünkü sırasında)", async () => {
    failWhen = (u) => u.includes("Pil notu");
    const out = await prepareRerankScores({ items, guestMessage: "Askılık nerede? Bir de pil var mı?", candidates, candidateMeta });
    expect(out.status).toBe("ok");
    expect(out.status === "ok" && out.scores.get("a25#0")).toBe(3);
    expect(out.status === "ok" && out.scores.has("b22#0")).toBe(false);
  });

  it("hepsi düşerse `failed` (bugünkü sıra)", async () => {
    failWhen = () => true;
    const out = await prepareRerankScores({ items, guestMessage: "Askılık nerede? Bir de pil var mı?", candidates, candidateMeta });
    expect(out.status).toBe("failed");
    expect(out.calls).toBe(2);
  });

  it("anlama isteği yoksa TEK çağrı (sırayla birleşim penceresi)", async () => {
    const out = await prepareRerankScores({ items, guestMessage: "Askılık nerede?", candidates });
    expect(calls).toHaveLength(1);
    expect(out.status).toBe("ok");
  });

  it("pencereler: taban her pencereye eklenir; çağrı sayısı RERANK_MAX_CALLS'u aşmaz", () => {
    const wins = rerankCandidateWindows(candidates, candidateMeta);
    expect(wins).toHaveLength(2);
    for (const w of wins) expect(w.filter((k) => k.startsWith("o"))).toHaveLength(RERANK_OWN_CANDIDATES);
    const many = [toList(own), ...Array.from({ length: 5 }, (_, r) => toList(q1.map((x) => ({ id: `${x.id}_${r}` }))))];
    const meta = [{ extra: false }, ...Array.from({ length: 5 }, (_, r) => ({ extra: true, request: r }))];
    expect(rerankCandidateWindows(many, meta)).toHaveLength(RERANK_MAX_CALLS);
  });

  it("🚨 bayrak KAPALI (varsayılan): BUGÜNKÜ davranış — tek çağrı, sırayla birleşimin ilk RERANK_LEGACY_CANDIDATES adayı", async () => {
    vi.stubEnv("KB_RERANK_PER_QUESTION", "");
    const out = await prepareRerankScores({ items, guestMessage: "Askılık nerede? Bir de pil var mı?", candidates, candidateMeta });
    expect(calls).toHaveLength(1);
    const ids = [...calls[0].user.matchAll(/\[(C\d+)\]/g)].map((m) => m[1]);
    expect(ids).toHaveLength(RERANK_LEGACY_CANDIDATES);
    // Sırayla birleşim: özgün + iki istek listesi dönüşümlü → derindeki cevaplar (25. ve 22. sıra) pencerede YOK.
    expect(unionTopCandidates(candidates, RERANK_LEGACY_CANDIDATES)).not.toContain("a25#0");
    expect(out.status === "ok" && out.scores.has("a25#0")).toBe(false);
  });
});
