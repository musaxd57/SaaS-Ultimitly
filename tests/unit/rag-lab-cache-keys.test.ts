import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => {}),
}));

import { replyRequestIdentity, suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { RERANK_SYSTEM_PROMPT } from "@/lib/ai/semantic/rerank";
import { digest } from "../eval/rag-lab/cache";
import { replyCacheKey, rerankCacheKey, sentEffort, understandCacheKey } from "../eval/rag-lab/cache-keys";

// ---------------------------------------------------------------------------
// ÖLÇER ÖNBELLEK ANAHTARLARI (Codex 09-27): model / düşünme çabası / istem değişince ISKA, aynı istek İSABET; bugünkü ücretli
// önbellek (çabasız koşular) aynı anahtarla okunmaya devam eder. Ağ yok — gövde `fetch` taklidiyle yakalanır.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "Çıkış saat kaçta?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [{ category: "checkout", title: "Çıkış", content: "Çıkış 11:00, anahtarı kutuya bırakın." }],
  history: [],
  tone: "warm",
  language: "tr",
};

function capture(): { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ intent: "checkout", confidence: 0.9, reply: "11:00.", priority: "standard", riskLevel: "none", detectedLanguage: "tr" }) },
            },
          ],
        }),
      );
    }),
  );
  return { bodies };
}

const tmpDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("cevap isteğinin kimliği = modele GİDEN istek (üretimle tek kaynak)", () => {
  it("model / çaba / sistem / kullanıcı istemi `suggestReply`nin gönderdiğiyle BİREBİR — reasoning ve klasik modelde", async () => {
    for (const [model, effort] of [
      ["gpt-5.1", undefined],
      ["gpt-6-luna", "low"],
      ["gpt-4.1", "low"],
    ] as const) {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      vi.stubEnv("OPENAI_MODEL", model);
      if (effort) vi.stubEnv("OPENAI_REASONING_EFFORT", effort);
      const c = capture();
      await suggestReply(input);
      const body = c.bodies[0] as { model: string; reasoning_effort?: string; messages: { content: string }[] };
      const id = replyRequestIdentity(input);
      expect(id.model).toBe(body.model);
      expect(id.effort ?? undefined).toBe(body.reasoning_effort);
      expect(id.system).toBe(body.messages[0].content);
      expect(id.user).toBe(body.messages[1].content);
      vi.unstubAllEnvs();
    }
  });

  it("eylem beyanı bayrağı açıkken gönderilen istem değişir — kimlik onu izler", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const off = replyRequestIdentity(input).user;
    vi.stubEnv("AI_ACTION_CLAIMS_ENABLED", "1");
    const c = capture();
    await suggestReply(input);
    const on = replyRequestIdentity(input).user;
    expect(on).not.toBe(off);
    expect(on).toBe((c.bodies[0] as { messages: { content: string }[] }).messages[1].content);
  });
});

describe("cevap önbellek anahtarı (v2)", () => {
  it("model, çaba, sistem istemi, kullanıcı istemi değişince ISKA; aynı istek İSABET", () => {
    const base = { model: "gpt-5.1", effort: null, system: "S", user: "U" };
    const k = digest(replyCacheKey(base));
    expect(digest(replyCacheKey({ ...base }))).toBe(k);
    for (const change of [{ model: "gpt-6-luna" }, { effort: "low" }, { system: "S2" }, { user: "U2" }]) {
      expect(digest(replyCacheKey({ ...base, ...change })), JSON.stringify(change)).not.toBe(k);
    }
  });

  it("🚨 AYNI girdi + farklı model ya da farklı istem kurucusu: eski `{ v: 1, input }` anahtarı AYNI kalıyordu, v2 değişir", () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
    const v1 = digest({ v: 1, input });
    const a = digest(replyCacheKey(replyRequestIdentity(input)));
    vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
    expect(digest({ v: 1, input })).toBe(v1); // eski anahtar modeli görmüyordu
    expect(digest(replyCacheKey(replyRequestIdentity(input)))).not.toBe(a);
    vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
    vi.stubEnv("AI_ACTION_CLAIMS_ENABLED", "1");
    expect(digest({ v: 1, input })).toBe(v1); // eski anahtar istem kurucusunu görmüyordu
    expect(digest(replyCacheKey(replyRequestIdentity(input)))).not.toBe(a);
    vi.unstubAllEnvs();
    vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
    expect(digest(replyCacheKey(replyRequestIdentity(input)))).toBe(a); // değişmeyince isabet
  });

  it("istem kurucusunun çıktısı değişince (kalemde iki koşulsuz çıkış saati → çelişki bloğu) anahtar değişir", () => {
    const two = { ...input, knowledgeBase: [{ category: "checkout", title: "Çıkış", content: "Çıkış 11:00. Çıkış 12:00." }] };
    expect(replyRequestIdentity(two).user).toMatch(/KAYNAK ÇELİŞKİSİ/);
    expect(digest(replyCacheKey(replyRequestIdentity(two)))).not.toBe(digest(replyCacheKey(replyRequestIdentity(input))));
  });
});

describe("yeniden sıralama / anlama anahtarı — GÖNDERİLEN çaba", () => {
  it("çaba yoksa anahtar ESKİSİYLE birebir (mevcut ücretli önbellek okunur)", () => {
    expect(digest(rerankCacheKey({ model: "gpt-5.1", system: "S", user: "U" }))).toBe(digest({ m: "gpt-5.1", s: "S", u: "U" }));
    const mode = { items: true, rules: true };
    expect(digest(understandCacheKey({ version: "V", model: "gpt-5.1", text: "T", history: undefined, mode }))).toBe(
      digest({ v: "V", m: "gpt-5.1", t: "T", h: null, mode }),
    );
  });

  it("çaba gönderilirse anahtara girer (açık `rre:` belirteciyle yazılmış eski girdiyle AYNI biçim); klasik modelde gönderilmez", () => {
    expect(rerankCacheKey({ model: "gpt-6-luna", system: "S", user: "U", effort: "low" })).toEqual({ m: "gpt-6-luna", s: "S", u: "U", e: "low" });
    expect(sentEffort("gpt-4.1", "low")).toBeUndefined();
    expect(rerankCacheKey({ model: "gpt-4.1", system: "S", user: "U", effort: "low" })).toEqual({ m: "gpt-4.1", s: "S", u: "U" });
  });

  async function offlineLab(dir: string) {
    vi.stubEnv("RAG_LAB_CACHE", dir);
    vi.stubEnv("RAG_LAB_OFFLINE", "1");
    vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
    vi.resetModules();
    const core = await import("../eval/rag-lab/core");
    const cache = await import("../eval/rag-lab/cache");
    return { core, cache };
  }

  it("🚨 yeniden sıralayıcı: env varsayılan çabası (belirteçsiz) çabasız girdiyi OKUMAZ; çaba yokken okur", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rag-keys-"));
    tmpDirs.push(dir);
    const { core, cache } = await offlineLab(dir);
    const cands = [
      { key: "a#0", title: "A", text: "Otopark bina altında." },
      { key: "b#0", title: "B", text: "Havlular dolapta." },
    ];
    const { user } = core.labRerankRequest("Otopark var mı?", cands, { k: 20, crop: 600 });
    const f = path.join(dir, "llm", "rerank", `${cache.digest({ m: "gpt-5.1", s: RERANK_SYSTEM_PROMPT, u: user })}.json`);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ answers: ["C1"], related: [] }));
    const hit = await core.labRerank("Otopark var mı?", cands, { k: 20, crop: 600 });
    expect(hit?.scores.get("a#0")).toBe(3);
    vi.stubEnv("AI_SEMANTIC_REASONING_EFFORT", "low");
    await expect(core.labRerank("Otopark var mı?", cands, { k: 20, crop: 600 })).rejects.toThrow(/RAG_LAB_OFFLINE/);
  });

  it("🚨 anlama katmanı: env çabasıyla çabasız girdiyi OKUMAZ; çaba yokken okur", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rag-keys-"));
    tmpDirs.push(dir);
    const { core, cache } = await offlineLab(dir);
    const q = { id: "q", group: "single_tr", cls: "tr", lang: "tr", text: "Otopark var mı?", answers: [] };
    const key = understandCacheKey({ version: core.UND_PROMPT_VERSION, model: "gpt-5.1", text: q.text, history: undefined, mode: core.UNDERSTANDING_MODE });
    const f = path.join(dir, "llm", "understand", `${cache.digest(key)}.json`);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ requests: [] }));
    expect(await core.labUnderstand(q)).toEqual({ requests: [] });
    vi.stubEnv("AI_SEMANTIC_REASONING_EFFORT", "low");
    await expect(core.labUnderstand(q)).rejects.toThrow(/RAG_LAB_OFFLINE/);
  });
});

describe("bağlantı: cevap ölçeri yeni anahtarı ve sabit anı KULLANIR (ücretli koşu burada sınanamaz — kaynak pini)", () => {
  it("rag-answer anahtarı `replyCacheKey(replyRequestIdentity(input))`; eski `{ v: 1, input }` yok; istem anı sabit", () => {
    const src = readFileSync(path.resolve(__dirname, "../eval/rag-answer.eval.test.ts"), "utf8");
    expect(src).toContain("const cacheKey = replyCacheKey(replyRequestIdentity(input));");
    expect(src).toMatch(/llmCached\("reply", cacheKey,/);
    expect(src).not.toMatch(/llmCached\("reply",\s*\{\s*v:\s*1/);
    expect(src).toMatch(/now: REPLY_NOW,/);
  });
});
