import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/report-error", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { rerankRetrievalInfo } from "@/lib/ai/retrieval/flag";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetSemanticRetrieval, __awaitSemanticWarm } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { unionTopCandidates, RERANK_MAX_CANDIDATES, RERANK_QUESTION_CHARS } from "@/lib/ai/semantic/rerank";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #186 YENİDEN SIRALAYICI — ÜRETİM BAĞLANTISI (kurucu 09-26: "yapalım, en mantıklı şekilde"). Sözleşme:
//  · anahtar `KB_RERANK_ENABLED` VARSAYILAN KAPALI; kapalıyken sohbet uç noktasına hiç gidilmez, sonuç birebir eski;
//  · YALNIZ anlamsal puanlar bu kararda seçiciye ULAŞTIYSA (`sem: ok`) koşar — embedding kapalı / soğuk / küçük KB /
//    acil durdurma → çağrı yok (tavan teşhisi: embedding yokken yeniden sıralama cevabı bulamaz);
//  · model yalnız SIRAYI değiştirir; her arıza bugünkü sıra + kanıtta `rr: failed`;
//  · isteme misafirin cevapsız ÖNCEKİ mesajları da gider (retrieval ile aynı kural), bilinen ad redakte edilir.
// Gömme sahte ama kavram tabanlı; sohbet uç noktası isteğin kendisinden cevap üretir (C-kimliği metinden bulunur).
// ---------------------------------------------------------------------------

const EMB_URL = "https://api.openai.com/v1/embeddings";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Kavram boyutu (otopark) + metne özgü küçük gürültü. */
function fakeVec(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  if (/otopark|araba|araç|park/i.test(text)) v[1] = 1;
  v[100 + (hash(text) % 1400)] += 0.3;
  return v;
}

type ChatMode = { kind: "answer"; marker: string; related?: string } | { kind: "status"; status: number } | { kind: "empty" };

interface Recorded {
  chatBodies: string[];
  embedCalls: number;
}

/** İki uç noktayı ayıran sahte `fetch`: gömme (kavram vektörü) + sohbet (yeniden sıralayıcı). */
function routerFetch(rec: Recorded, chat: () => ChatMode) {
  return vi.fn(async (url: string, init: { body: string }) => {
    if (url === EMB_URL) {
      rec.embedCalls += 1;
      const { input } = JSON.parse(init.body) as { input: string[] };
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((t, index) => ({ index, embedding: fakeVec(t) })) }) };
    }
    if (url === CHAT_URL) {
      const payload = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
      const user = payload.messages.find((m) => m.role === "user")?.content ?? "";
      rec.chatBodies.push(user);
      const mode = chat();
      if (mode.kind === "status") return new Response("boom", { status: mode.status });
      const answers: string[] = [];
      const related: string[] = [];
      if (mode.kind === "answer") {
        for (const line of user.split("\n")) {
          const m = /^\[(C\d+)\] <<<(.*)>>>$/.exec(line);
          if (m && m[2].includes(mode.marker)) answers.push(m[1]);
          else if (m && mode.related && m[2].includes(mode.related)) related.push(m[1]);
        }
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers, related }) }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`beklenmeyen uç nokta: ${url}`);
  });
}

const T0 = Date.UTC(2026, 0, 1);
// Sözcüksel olarak GÜÇLÜ ama yanlış kalem (başlık + metin "otopark" dolu) ve DOĞRU kalem ("ücretsiz" işaretli). Doğru kalemin
// başlığı kavram sözcüğü TAŞIMAZ ("Araç" gömmede otopark kavramına düşüp onu zaten öne alıyordu → KONTROL vakumlu olurdu).
const DECOY = {
  id: "kb_decoy",
  category: "general",
  title: "Otopark kuralları",
  content: "Otopark otopark: komşu binanın otopark kuralları ve otopark yönetimi.",
  updatedAt: new Date(T0 - 1000),
};
const RIGHT = {
  id: "kb_right",
  category: "general",
  title: "Bina önü",
  content: "Binanın önünde ücretsiz otopark var.",
  updatedAt: new Date(T0 - 2000),
};
const QUESTION = "Otopark nerede?";

function bigKb() {
  return [...neutralPadding(35, T0), DECOY, RIGHT];
}

let rec: Recorded;

beforeEach(() => {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  clearEmbeddingCache();
  rec = { chatBodies: [], embedCalls: 0 };
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_RERANK_ENABLED", "");
  vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Parça vektörleri yalnız arka planda üretilir: ilk karar soğuk; ısınma bitince anlamsal puan seçiciye ulaşır. */
async function warm(items = bigKb()) {
  const first = await retrieveKbForPrompt({ items, guestMessage: QUESTION });
  expect(first.evidence).toMatchObject({ sem: "cold" });
  await __awaitSemanticWarm();
}

describe("anahtar — tek okuyucu, varsayılan KAPALI", () => {
  it("varsayılan kapalı; açma yazımları açar; tanınmayan değer KAPALI (gürültülü)", () => {
    expect(rerankRetrievalInfo()).toEqual({ enabled: false, raw: "", recognized: true });
    for (const on of ["1", "on", "true", "yes", "enabled", " TRUE "]) {
      vi.stubEnv("KB_RERANK_ENABLED", on);
      expect(rerankRetrievalInfo().enabled, on).toBe(true);
    }
    for (const off of ["0", "off", "false", "no", "disabled"]) {
      vi.stubEnv("KB_RERANK_ENABLED", off);
      expect(rerankRetrievalInfo(), off).toMatchObject({ enabled: false, recognized: true });
    }
    vi.stubEnv("KB_RERANK_ENABLED", "ture");
    expect(rerankRetrievalInfo()).toMatchObject({ enabled: false, recognized: false });
  });

  it("anahtarı YALNIZ flag.ts okur (açılış logu ve yol aynı yorumu kullanır)", () => {
    const root = path.resolve(__dirname, "../../");
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && readFileSync(path.join(root, rel), "utf8").includes("process.env.KB_RERANK_ENABLED")) readers.push(rel);
      }
    };
    walk("src");
    expect(readers).toEqual(["src/lib/ai/retrieval/flag.ts"]);
  });
});

describe("KAPALI / koşmayan yollar — sohbet uç noktasına gidilmez, sonuç birebir eski", () => {
  it("anahtar kapalı (anlamsal açık ve sıcak): yeniden sıralama YOK, kanıtta `rr` YOK", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    await warm();
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(r.evidence).toMatchObject({ sem: "ok" });
    expect(r.evidence).not.toHaveProperty("rr");
    expect(rec.chatBodies).toEqual([]);
  });

  it("anahtar açık ama KB soğuk (ilk karar sözcüksel) → çağrı YOK", async () => {
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(r.evidence).toMatchObject({ sem: "cold" });
    expect(r.evidence).not.toHaveProperty("rr");
    expect(rec.chatBodies).toEqual([]);
  });

  it("anahtar açık ama anlamsal kaynak KAPALI → çağrı YOK (embedding yokken yeniden sıralama cevabı bulamaz)", async () => {
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(r.evidence).not.toHaveProperty("rr");
    expect(rec.chatBodies).toEqual([]);
    expect(rec.embedCalls).toBe(0);
  });

  it("küçük KB (tamamı gider) → çağrı YOK", async () => {
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    const r = await retrieveKbForPrompt({ items: [DECOY, RIGHT], guestMessage: QUESTION });
    expect(r.selection).toBe("all");
    expect(rec.chatBodies).toEqual([]);
  });

  it("acil durdurma (KB_RETRIEVAL_MODE=legacy) yeniden sıralayıcıyı da kapatır", async () => {
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(r.mode).toBe("legacy");
    expect(rec.chatBodies).toEqual([]);
  });
});

describe("AÇIK — model yalnız SIRAYI değiştirir", () => {
  beforeEach(() => vi.stubEnv("KB_RERANK_ENABLED", "1"));

  it("KONTROL: yeniden sıralamasız bugünkü sıra sözcüksel olarak güçlü yanlış kalemi öne koyar", async () => {
    vi.stubEnv("KB_RERANK_ENABLED", "");
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "empty" })));
    await warm();
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(r.items[0].id).toBe(DECOY.id);
    expect(r.items.map((i) => i.id)).toContain(RIGHT.id);
  });

  it("🚨 modelin 'cevaplıyor' dediği kalem ÖNE geçer; küme değişmez; kanıtta rr: ok + süre + cevap sayısı", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    await warm();
    vi.stubEnv("KB_RERANK_ENABLED", "");
    const before = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    rec.chatBodies.length = 0;
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(rec.chatBodies).toHaveLength(1);
    expect(r.items[0].id).toBe(RIGHT.id);
    expect(new Set(r.items.map((i) => i.id))).toEqual(new Set(before.items.map((i) => i.id)));
    expect(r.evidence).toMatchObject({ sem: "ok", rr: "ok", rrA: 1 });
    expect(typeof r.evidence?.rrMs).toBe("number");
  });

  it("rrA yalnız 'cevaplıyor' denenleri sayar ('ilgili' sayılmaz); cevaplayan ilgilinin önünde", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz", related: "komşu" })));
    await warm();
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(r.evidence).toMatchObject({ rr: "ok", rrA: 1 });
    expect(r.items.map((i) => i.id).slice(0, 2)).toEqual([RIGHT.id, DECOY.id]);
  });

  it("seçici isabet bulamadıysa (geri çekilme) yeniden sıralayıcı KOŞMAZ — kanıtta `rr` yok", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    await warm();
    rec.chatBodies.length = 0;
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: "Zxqv wpyk?" });
    expect(r.evidence?.sem).toBe("ok");
    expect(r.evidence?.fb).not.toBe("none");
    expect(r.evidence).not.toHaveProperty("rr");
    expect(rec.chatBodies).toEqual([]);
  });

  it("isteme parça METNİ C-kimliğiyle gider; parça anahtarı / kalem kimliği GİTMEZ", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "empty" })));
    await warm();
    rec.chatBodies.length = 0;
    await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    const body = rec.chatBodies[0];
    expect(body).toContain("Binanın önünde ücretsiz otopark var.");
    expect(body).toMatch(/\[C1\] <<</);
    expect(body).not.toContain(RIGHT.id);
    expect(body).not.toContain("#0");
    expect(body).toContain(QUESTION);
  });

  it("model 'hiçbiri' derse (boş liste) sıra birebir bugünkü; kanıtta rr: ok, rrA: 0", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "empty" })));
    await warm();
    vi.stubEnv("KB_RERANK_ENABLED", "");
    const before = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(r.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(r.evidence).toMatchObject({ rr: "ok", rrA: 0 });
  });

  it("🚨 sağlayıcı hatası → bugünkü sıra (misafir etkilenmez), kanıtta rr: failed", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "status", status: 500 })));
    await warm();
    vi.stubEnv("KB_RERANK_ENABLED", "");
    const before = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION });
    expect(rec.chatBodies).toHaveLength(1);
    expect(r.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(r.evidence).toMatchObject({ rr: "failed" });
  });

  it("misafirin cevapsız ÖNCEKİ mesajı da isteme gider (eskisi önce); son cevaptan önceki mesaj GİTMEZ", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "empty" })));
    await warm();
    rec.chatBodies.length = 0;
    await retrieveKbForPrompt({
      items: bigKb(),
      guestMessage: QUESTION,
      history: [
        { direction: "inbound", body: "Havlu var mı?" },
        { direction: "outbound", body: "Evet, dolapta." },
        { direction: "inbound", body: "Arabamızı nereye bırakabiliriz?" },
        { direction: "inbound", body: "Bisiklet için de yer var mı?" },
      ],
    });
    const body = rec.chatBodies[0];
    const a = body.indexOf("Arabamızı nereye bırakabiliriz?");
    const b = body.indexOf("Bisiklet için de yer var mı?");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(body.indexOf(QUESTION)).toBeGreaterThan(b);
    expect(body).not.toContain("Havlu var mı?");
  });

  it("sıralanacak tek aday varsa ağa ÇIKMAZ; kanıtta rr: skipped (sıra bugünkü)", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "answer", marker: "ücretsiz" })));
    const only = [...neutralPadding(35, T0), RIGHT];
    await warm(only);
    rec.chatBodies.length = 0;
    const r = await retrieveKbForPrompt({ items: only, guestMessage: QUESTION });
    expect(r.evidence).toMatchObject({ sem: "ok", rr: "skipped", rrMs: 0 });
    expect(r.evidence).not.toHaveProperty("rrA");
    expect(rec.chatBodies).toEqual([]);
    expect(r.items[0].id).toBe(RIGHT.id);
  });

  it("uzun önceki mesaj güncel soruyu KESMEZ (tavan önceki mesajların başından kırpar)", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "empty" })));
    await warm();
    rec.chatBodies.length = 0;
    const long = `Baştaki cümle. ${"Uzun bir açıklama cümlesi. ".repeat(120)}Arabamız da var.`;
    await retrieveKbForPrompt({ items: bigKb(), guestMessage: QUESTION, history: [{ direction: "inbound", body: long }] });
    const q = /^Guest message: <<<([\s\S]*?)>>>$/m.exec(rec.chatBodies[0])?.[1] ?? "";
    expect(q.endsWith(`Arabamız da var.\n${QUESTION}`)).toBe(true);
    expect(q).not.toContain("Baştaki cümle.");
    expect(q.length).toBeLessThanOrEqual(RERANK_QUESTION_CHARS);
    expect(q.length).toBeGreaterThan(RERANK_QUESTION_CHARS - 5);
  });

  it("bilinen ad isteme GİTMEZ (anlama katmanıyla aynı redaksiyon)", async () => {
    vi.stubGlobal("fetch", routerFetch(rec, () => ({ kind: "empty" })));
    await warm();
    rec.chatBodies.length = 0;
    await retrieveKbForPrompt({ items: bigKb(), guestMessage: "Merhaba ben Ayşe Yılmaz, otopark var mı?", redactNames: ["Ayşe Yılmaz", null] });
    expect(rec.chatBodies[0]).not.toContain("Ayşe");
  });
});

describe("aday birleşimi — alt sorgular arası sırayla (çok sorulu mesajda her soru aday alır)", () => {
  it("round-robin, tekrarsız, tavanlı", () => {
    const lists = [
      [{ key: "a#0" }, { key: "b#0" }, { key: "c#0" }],
      [{ key: "d#0" }, { key: "a#0" }, { key: "e#0" }],
    ];
    expect(unionTopCandidates(lists, 4)).toEqual(["a#0", "d#0", "b#0", "e#0"]);
    expect(unionTopCandidates(lists, 10)).toEqual(["a#0", "d#0", "b#0", "e#0", "c#0"]);
    expect(unionTopCandidates([], 5)).toEqual([]);
    const many = [Array.from({ length: 40 }, (_, i) => ({ key: `k${i}#0` }))];
    expect(unionTopCandidates(many, RERANK_MAX_CANDIDATES)).toHaveLength(RERANK_MAX_CANDIDATES);
  });
});

describe("karar kaydı — kanıt yalnız kapalı küme / sayı taşır", () => {
  const base = { mode: "hybrid" as const, q: 1, fb: "none", sel: 3, cand: 9, ms: 4 };
  const parse = (retrieval: Record<string, unknown>) =>
    JSON.parse(buildKbEvidence({ retrieved: [], usedLabels: [], retrieval: retrieval as never }) ?? "{}").retrieval;

  it("rr/rrMs/rrA kayda geçer (süre yuvarlanır)", () => {
    expect(parse({ ...base, rr: "ok", rrMs: 812.345, rrA: 2 })).toMatchObject({ rr: "ok", rrMs: 812.3, rrA: 2 });
    expect(parse({ ...base, rr: "failed", rrMs: 2500 })).toMatchObject({ rr: "failed", rrMs: 2500 });
    expect(parse({ ...base, rr: "skipped", rrMs: 0 })).toMatchObject({ rr: "skipped", rrMs: 0 });
    expect(parse({ ...base, rr: "ok", rrMs: 5, rrA: 0 })).toMatchObject({ rr: "ok", rrA: 0 });
  });

  it("kapalı küme dışı durum / geçersiz sayı DÜŞER", () => {
    const r = parse({ ...base, rr: "maybe", rrMs: -1, rrA: 1.5 });
    expect(r).not.toHaveProperty("rr");
    expect(r).not.toHaveProperty("rrMs");
    expect(r).not.toHaveProperty("rrA");
  });
});
