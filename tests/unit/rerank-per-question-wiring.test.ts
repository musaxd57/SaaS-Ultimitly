import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));
// Anlama katmanı: iki ayrı istek döner (her birinin kendi sorgusu). Ağ YOK.
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return {
    ...actual,
    understandingEnabled: () => true,
    understandGuestMessages: vi.fn(async () => ({
      status: "ok" as const,
      ms: 5,
      cached: false,
      value: {
        language: "tr" as const,
        requests: [
          { intent: "amenities" as const, queryTr: "askılık nerede", queryOriginal: "askılık nerede" },
          { intent: "appliance_help" as const, queryTr: "kumanda pili", queryOriginal: "kumanda pili" },
        ],
        stay: { requested: false, kind: "none" as const, checkinTime: null, checkoutTime: null },
      },
    })),
  };
});

import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetSemanticRetrieval, __awaitSemanticWarm } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #189 SORU BAŞINA YENİDEN SIRALAMA — ÜRETİM BAĞLANTISI ("yüklem var, argüman yok" dersi): anlama katmanının istek sırası
// seçicinin aday listelerine (`CandidateListMeta.request`) oradan `prepareRerankScores`e ulaşıyor mu, çağrı sayısı karar
// kaydına (`rrN`) geçiyor mu. Bayrak kapalıyken BUGÜNKÜ tek çağrı.
// ---------------------------------------------------------------------------

const EMB_URL = "https://api.openai.com/v1/embeddings";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
function fakeVec(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[100 + (hash(text) % 1400)] = 1;
  return v;
}

const chatBodies: string[] = [];
function routerFetch() {
  return vi.fn(async (url: string, init: { body: string }) => {
    if (url === EMB_URL) {
      const { input } = JSON.parse(init.body) as { input: string[] };
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((t, index) => ({ index, embedding: fakeVec(t) })) }) };
    }
    if (url === CHAT_URL) {
      const payload = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
      const user = payload.messages.find((m) => m.role === "user")?.content ?? "";
      chatBodies.push(user);
      const answers = [...user.matchAll(/^\[(C\d+)\] <<<[^\n]*(?:Askılık|Kumanda pili)/gm)].map((m) => m[1]);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers, related: [] }) }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`beklenmeyen uç nokta: ${url}`);
  });
}

const T0 = Date.UTC(2026, 0, 1);
const items = [
  ...neutralPadding(35, T0),
  { id: "kb_hanger", category: "general", title: "Salon", content: "Askılık salondaki dolabın yanındadır.", updatedAt: new Date(T0 - 5000) },
  { id: "kb_battery", category: "general", title: "Televizyon", content: "Kumanda pili TV dolabının çekmecesindedir.", updatedAt: new Date(T0 - 6000) },
  // Sözcük paylaşan tuzaklar: her sorunun penceresinde ≥2 aday olsun (tek adaylı pencere çağrılmaz — sıralanacak bir şey yok).
  { id: "kb_hanger_decoy", category: "general", title: "Kırık eşya", content: "Askılık ya da raf kırılırsa bize yazın.", updatedAt: new Date(T0 - 7000) },
  { id: "kb_battery_decoy", category: "general", title: "Atık", content: "Biten pil ve kumanda ambalajı geri dönüşüm kutusuna atılır.", updatedAt: new Date(T0 - 8000) },
];
const MSG = "Askılık nerede? Bir de kumanda pili var mı?";

beforeEach(() => {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetUnderstandingCache();
  clearEmbeddingCache();
  chatBodies.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_RERANK_ENABLED", "1");
  vi.stubEnv("KB_RERANK_PER_QUESTION", "");
  vi.stubGlobal("fetch", routerFetch());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function warmThenDecide() {
  const first = await retrieveKbForPrompt({ items, guestMessage: MSG });
  expect(first.evidence).toMatchObject({ sem: "cold" });
  await __awaitSemanticWarm();
  chatBodies.length = 0;
  return retrieveKbForPrompt({ items, guestMessage: MSG });
}

describe("soru başına yeniden sıralama bağlantısı", () => {
  it("KONTROL — bayrak KAPALI: tek çağrı, kanıtta rrN YOK", async () => {
    const r = await warmThenDecide();
    expect(r.evidence).toMatchObject({ sem: "ok", rr: "ok" });
    expect(chatBodies).toHaveLength(1);
    expect(r.evidence).not.toHaveProperty("rrN");
  });

  it("🚨 bayrak AÇIK: anlama katmanının iki isteği → iki çağrı, kanıtta rrN: 2; iki cevap da bloğa girer", async () => {
    vi.stubEnv("KB_RERANK_PER_QUESTION", "1");
    const r = await warmThenDecide();
    expect(r.evidence).toMatchObject({ sem: "ok", rr: "ok", rrN: 2 });
    expect(chatBodies).toHaveLength(2);
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("kb_hanger");
    expect(ids).toContain("kb_battery");
  });
});
