import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// DECISIONS MOTORU (kurucu 10-28: "mantıklı olan yere koyabiliriz … süreyi kısaltmak işimize yarar"). `KB_RERANK_ENGINE=decisions` iken
// yeniden sıralayıcı OpenAI Decisions API'ye gider; varsayılan (boş / tanınmayan) BUGÜNKÜ sohbet sıralayıcısı. Ağ `fetchImpl` ile taklit
// edilir: istek gövdesi, olasılık → puan çevirisi, katı okuma, arıza → `failed` (asla fırlatmaz) ve kalıcı arızanın alarmı sınanır.
// ---------------------------------------------------------------------------

const persistent = vi.fn();
vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: (...a: unknown[]) => persistent(...a),
  noteModelProviderSuccess: vi.fn(),
}));

import { buildRerankRequest, llmRerank, parseDecisionsRerank, prepareRerankScores } from "@/lib/ai/semantic/rerank";
import { rerankEngine } from "@/lib/ai/semantic/config";

const cands = [
  { key: "k1#0", title: "Wi-Fi", text: "Ağ adı Lale, şifre kapıdaki kartta." },
  { key: "k2#0", title: "Otopark", text: "Otopark binanın arkasında." },
  { key: "k3#0", title: "Çöp", text: "Çöpler girişteki konteynere." },
];

type Seen = { url: string; body: Record<string, unknown> };
function fakeFetch(reply: (seen: Seen) => Response | Promise<Response>, seen: Seen[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const s = { url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> };
    seen.push(s);
    return reply(s);
  }) as unknown as typeof fetch;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  persistent.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-rerank-0000000000000000");
  vi.stubEnv("AI_SEMANTIC_API_KEY", "");
  vi.stubEnv("AI_SEMANTIC_MODEL", "");
  vi.stubEnv("KB_RERANK_MODEL", "");
  vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
  vi.stubEnv("KB_RERANK_ENGINE", "decisions");
  vi.stubEnv("KB_RERANK_DECISIONS_MODEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Decisions motoru — anahtar", () => {
  it("varsayılan KAPALI: boş / tanınmayan değer bugünkü sohbet sıralayıcısı; 'decisions' (büyük-küçük harf, boşluk) açar", () => {
    for (const v of ["", "chat", "decision", "1", "true", "decisions-v2"]) {
      vi.stubEnv("KB_RERANK_ENGINE", v);
      expect(rerankEngine(), v).toBe("chat");
    }
    for (const v of ["decisions", " Decisions ", "DECISIONS"]) {
      vi.stubEnv("KB_RERANK_ENGINE", v);
      expect(rerankEngine(), v).toBe("decisions");
    }
  });

  it("anahtar kapalıyken istek BUGÜNKÜ sohbet uç noktasına gider (davranış birebir)", async () => {
    vi.stubEnv("KB_RERANK_ENGINE", "");
    const seen: Seen[] = [];
    const out = await llmRerank(
      "Wi-Fi şifresi?",
      cands,
      [],
      { fetchImpl: fakeFetch(() => json({ choices: [{ message: { content: JSON.stringify({ answers: ["C1"], related: [] }) } }] }), seen) },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/chat\/completions$/);
    expect(out.status === "ok" && out.scores.get("k1#0")).toBe(3);
  });
});

describe("Decisions motoru — istek ve puan", () => {
  it("girdi sohbet sıralayıcısının metniyle BİREBİR aynı; aday başına bir 'predicate' sorusu; model varsayılanı gpt-6-luna", async () => {
    const seen: Seen[] = [];
    await llmRerank("Wi-Fi şifresi?", cands, [], {
      fetchImpl: fakeFetch(() => json({ answers: [{ name: "C1", probability: 0.9 }] }), seen),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/v1\/decisions$/);
    expect(seen[0].body.model).toBe("gpt-6-luna");
    expect(seen[0].body.input).toBe(buildRerankRequest("Wi-Fi şifresi?", cands).user);
    const qs = seen[0].body.questions as { type: string; name: string; instructions: string }[];
    expect(qs.map((q) => q.name)).toEqual(["C1", "C2", "C3"]);
    for (const q of qs) {
      expect(q.type).toBe("predicate");
      expect(q.instructions).toContain(`candidate ${q.name} `);
    }
    // Parça anahtarı isteme GİRMEZ (sohbet sıralayıcısıyla aynı kural).
    expect(JSON.stringify(seen[0].body)).not.toContain("k1#0");
  });

  it("model ezilebilir (KB_RERANK_DECISIONS_MODEL)", async () => {
    vi.stubEnv("KB_RERANK_DECISIONS_MODEL", "gpt-6-luna-2026-11");
    const seen: Seen[] = [];
    await llmRerank("Wi-Fi?", cands, [], { fetchImpl: fakeFetch(() => json({ answers: [{ name: "C1", probability: 0.9 }] }), seen) });
    expect(seen[0].body.model).toBe("gpt-6-luna-2026-11");
  });

  it("olasılık → puan: ≥ 0,5 cevaplıyor (3), ≥ 0,2 ilgili (2), altı puansız; eşik sınırları dahil", async () => {
    const out = await llmRerank("Wi-Fi?", cands, [], {
      fetchImpl: fakeFetch(() =>
        json({
          answers: [
            { name: "C1", probability: 0.5 },
            { name: "C2", probability: 0.2 },
            { name: "C3", probability: 0.199 },
          ],
        }),
      ),
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.scores.get("k1#0")).toBe(3);
    expect(out.scores.get("k2#0")).toBe(2);
    expect(out.scores.has("k3#0")).toBe(false);
    const ids = new Map([["C1", "a"], ["C2", "b"]]);
    expect(parseDecisionsRerank(new Map([["C1", 0.4999], ["C2", 0.1999]]), ids)).toEqual(new Map([["a", 2]]));
  });

  it("KATI okuma: bilinmeyen ad, aralık dışı / sayı olmayan olasılık, tekrar eden ad yok sayılır", async () => {
    const out = await llmRerank("Wi-Fi?", cands, [], {
      fetchImpl: fakeFetch(() =>
        json({
          answers: [
            { name: "C9", probability: 0.99 },
            { name: "C1", probability: 1.5 },
            { name: "C2", probability: "0.9" },
            { name: "C3", probability: 0.1 },
            { name: "C3", probability: 0.95 },
            { name: "C1", probability: Number.NaN },
          ],
        }),
      ),
    });
    expect(out.status).toBe("ok");
    expect(out.status === "ok" && [...out.scores.keys()]).toEqual([]);
  });
});

describe("Decisions motoru — arıza bugünkü sıraya düşer, asla fırlatmaz", () => {
  it("geçerli cevap yok / bozuk gövde / http 500 / ağ hatası → failed", async () => {
    const bad: (() => Response | Promise<Response>)[] = [
      () => json({ answers: [] }),
      () => json({ answers: [{ name: "C1", probability: -0.1 }] }),
      // Yalnız istenmeyen adlar: sağlayıcı başka bir isteğin cevabını döndürdü — "hiçbiri cevaplamıyor" sayılmaz, arızadır.
      () => json({ answers: [{ name: "C9", probability: 0.9 }, { name: "X", probability: 0.8 }] }),
      () => json({ choices: [] }),
      () => new Response("not json", { status: 200 }),
      () => json({ error: { message: "boom" } }, 500),
      () => Promise.reject(new TypeError("fetch failed")),
    ];
    for (const r of bad) {
      const out = await llmRerank("Wi-Fi?", cands, [], { fetchImpl: fakeFetch(r) });
      expect(out.status).toBe("failed");
    }
    expect(persistent).not.toHaveBeenCalled();
  });

  it("kalıcı sağlayıcı arızası (kredi bitti 429) semantic kanalının geçiş alarmına gider", async () => {
    const out = await llmRerank("Wi-Fi?", cands, [], {
      fetchImpl: fakeFetch(() => json({ error: { code: "insufficient_quota", message: "You have no credits remaining." } }, 429)),
    });
    expect(out.status).toBe("failed");
    expect(persistent).toHaveBeenCalledTimes(1);
    expect(persistent.mock.calls[0][3]).toBe("semantic");
  });

  it("64 KB üstü gövde okunmaz → failed", async () => {
    const big = JSON.stringify({ answers: [{ name: "C1", probability: 0.9 }], pad: "x".repeat(70_000) });
    const out = await llmRerank("Wi-Fi?", cands, [], { fetchImpl: fakeFetch(() => new Response(big, { status: 200 })) });
    expect(out.status).toBe("failed");
  });

  it("sıcak yol tavanı Decisions çağrısını da keser (misafir beklemez)", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const t0 = Date.now();
    const out = await llmRerank("Wi-Fi?", cands, [], { fetchImpl: hang, deadlineMs: 60 });
    expect(out.status).toBe("failed");
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("üretim girişi (prepareRerankScores) Decisions motoruyla da puan döndürür", async () => {
    const T0 = Date.UTC(2026, 0, 1);
    const items = cands.map((c) => ({ id: c.key.slice(0, -2), category: "general", title: c.title, content: c.text, updatedAt: new Date(T0) }));
    const seen: Seen[] = [];
    const out = await prepareRerankScores({
      items,
      guestMessage: "Otopark nerede?",
      candidates: [items.map((it) => ({ key: `${it.id}#0` }))],
      fetchImpl: fakeFetch(() => json({ answers: [{ name: "C2", probability: 0.8 }] }), seen),
    });
    expect(seen[0].url).toMatch(/\/v1\/decisions$/);
    expect(out.status === "ok" && out.scores.get("k2#0")).toBe(3);
  });
});
