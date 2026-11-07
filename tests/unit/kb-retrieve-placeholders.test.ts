import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetSemanticRetrieval, __awaitSemanticWarm } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { fillGuestPlaceholdersInItems } from "@/lib/kb-placeholders";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #189 (09-26): YER TUTUCU İKAMESİ SEÇİMDEN SONRA. Misafir adı bilgi tabanı metnine seçimden ÖNCE giriyordu (oto-yanıt ve
// gelen kutusu önerisi): `{isim}` taşıyan tek bir kalem bile parça metnini misafire özgü yapıyor, içerik anahtarlı vektör
// deposu o parçayı yeni misafirde bulamıyor ve YARIM HARİTA YOK kuralıyla karar tamamen SÖZCÜKSEL kalıyordu ("cold").
// Artık seçim ham metinle koşar, değerler yalnız seçilen parçalara uygulanır (`retrieveKbForPrompt` `placeholders`).
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Kavram boyutu (ısıtma) + metne özgü gürültü — `kb-semantic-retrieval.test.ts` ile aynı sahte gömme. */
function fakeVec(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  if (/kombi|ısıt|isit|üşü|usu|ılık|ilik/i.test(text)) v[0] = 1;
  v[100 + (hash(text) % 1400)] += 0.3;
  return v;
}

function embeddingFetch() {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const { input } = JSON.parse(init.body) as { input: string[] };
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((t, index) => ({ index, embedding: fakeVec(t) })) }) };
  });
}

const T0 = Date.UTC(2026, 0, 1);
const WELCOME = {
  id: "kb_welcome",
  category: "general",
  title: "Hoş geldiniz {isim}",
  content: "Merhaba {isim}, {daire} numaralı dairemize hoş geldiniz. Anahtar teslimi resepsiyondadır.",
  updatedAt: new Date(T0 - 10 * 86_400_000),
  supersededById: null,
};
const HEATING = {
  id: "kb_heating",
  category: "general",
  title: "Isıtma",
  content: "Kombi koridordaki dolabın içindedir; termostat salonda, 22 dereceye ayarlıdır.",
  updatedAt: new Date(T0 - 365 * 86_400_000),
  supersededById: null,
};
const PARAPHRASE = "Gece çok üşüdük, evi ılık yapabilir miyiz?";
const items = () => [...neutralPadding(35, T0).map((i) => ({ ...i, supersededById: null })), WELCOME, HEATING];
const values = (name: string) => ({ guestFirstName: name, propertyName: "Lale 7" });

beforeEach(() => {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  clearEmbeddingCache();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubGlobal("fetch", embeddingFetch());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("yer tutucu ikamesi seçimden SONRA", () => {
  it("KONTROL (eski sıra): ad seçimden önce girince yeni misafirin ilk kararı SOĞUK kalır", async () => {
    const first = await retrieveKbForPrompt({ items: fillGuestPlaceholdersInItems(items(), values("Ayşe")), guestMessage: PARAPHRASE });
    expect(first.evidence).toMatchObject({ sem: "cold" });
    await __awaitSemanticWarm();
    const other = await retrieveKbForPrompt({ items: fillGuestPlaceholdersInItems(items(), values("Mehmet")), guestMessage: PARAPHRASE });
    expect(other.evidence).toMatchObject({ sem: "cold" });
  });

  it("🚨 ham seçim: ısınmış KB başka misafirin İLK mesajında da sıcak (sem: ok) ve anlamsal cevap seçilir", async () => {
    const first = await retrieveKbForPrompt({ items: items(), placeholders: values("Ayşe"), guestMessage: PARAPHRASE });
    expect(first.evidence).toMatchObject({ sem: "cold" });
    await __awaitSemanticWarm();
    const other = await retrieveKbForPrompt({ items: items(), placeholders: values("Mehmet"), guestMessage: PARAPHRASE });
    expect(other.evidence).toMatchObject({ sem: "ok", fb: "none" });
    expect(other.items[0].id).toBe(HEATING.id);
  });

  it("🚨 seçilen parçalarda yer tutucular ÇÖZÜLMÜŞ (başlık dahil), ham belirteç modele gitmez", async () => {
    const r = await retrieveKbForPrompt({ items: items(), placeholders: values("Mehmet"), guestMessage: "Hoş geldiniz mesajı ve anahtar teslimi nerede?" });
    const welcome = r.items.find((i) => i.id === WELCOME.id);
    expect(welcome, "karşılama kalemi seçilmeli (ölçüm önkoşulu)").toBeDefined();
    expect(welcome!.content).toContain("Merhaba Mehmet");
    expect(welcome!.content).toContain("7 numaralı");
    expect(welcome!.title).toContain("Hoş geldiniz Mehmet");
    for (const i of r.items) expect(`${i.title}\n${i.content}`).not.toMatch(/\{(isim|daire)\}/i);
  });

  it("legacy (acil durdurma) ve küçük KB: kalemlerin kendisi doldurulur — bugünkü ikameyle birebir", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    const legacy = await retrieveKbForPrompt({ items: items(), placeholders: values("Mehmet"), guestMessage: PARAPHRASE });
    expect(legacy.items).toEqual(fillGuestPlaceholdersInItems(items(), values("Mehmet")));
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
    const small = [WELCOME, HEATING];
    const smallR = await retrieveKbForPrompt({ items: small, placeholders: values("Mehmet"), guestMessage: PARAPHRASE });
    expect(smallR.selection).toBe("all");
    expect(smallR.items).toEqual(fillGuestPlaceholdersInItems(small, values("Mehmet")));
  });

  it("`placeholders` verilmezse kalemlere dokunulmaz (bugünkü çağıranlar birebir)", async () => {
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
    const r = await retrieveKbForPrompt({ items: [WELCOME, HEATING], guestMessage: PARAPHRASE });
    expect(r.items).toEqual([WELCOME, HEATING]);
  });
});
