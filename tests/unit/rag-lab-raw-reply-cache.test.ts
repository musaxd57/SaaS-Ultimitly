import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SuggestReplyInput } from "@/lib/ai/types";

vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// CODEX 09-30 (C6): CEVAP ÖLÇERİ MODELİN HAM ÇIKTISINI SAKLAR, İŞLEMEYİ HER KOŞUDA BUGÜNKÜ KODLA YAPAR. Eski önbellek
// `suggestReply`in işlenmiş sonucunu tutuyordu (işleme değişip istem aynı kalınca ölçüm eski işlemeyi okurdu). Ağ yok: `fetch`
// taklidi; önbellek dizini geçici (modül her testte taze yüklenir — dizin sabiti içe aktarma anında okunur).
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

/** Modelin HAM içeriği: tanınmayan niyet (işleme "general" yapar) — ham kayıt ile işlenmiş sonuç ayrışsın diye. */
const MODEL_CONTENT = JSON.stringify({
  intent: "garip_niyet",
  confidence: 0.9,
  reply: "Çıkış 11:00.",
  priority: "standard",
  riskLevel: "none",
  detectedLanguage: "tr",
});

function apiResponse(content: string, finish = "stop"): string {
  return JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
}

let dir = "";
let calls = 0;

async function load() {
  vi.resetModules();
  const cache = await import("../eval/rag-lab/raw-reply-cache");
  const { suggestReply } = await import("@/lib/ai");
  return { ...cache, suggestReply };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "raw-reply-"));
  calls = 0;
  vi.stubEnv("RAG_LAB_CACHE", dir);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      return new Response(apiResponse(MODEL_CONTENT), { status: 200 });
    }),
  );
});

afterEach(async () => {
  const { __uninstallRawReplyCache } = await import("../eval/rag-lab/raw-reply-cache");
  __uninstallRawReplyCache();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

const rawFiles = () => {
  const d = path.join(dir, "llm", "reply-raw");
  return existsSync(d) ? readdirSync(d).map((f) => path.join(d, f)) : [];
};

describe("ham cevap önbelleği (Codex 09-30 C6)", () => {
  it("🚨 saklanan kayıt HAM API yanıtıdır (modelin niyeti olduğu gibi), işlenmiş sonuç değildir", async () => {
    const { withRawReplyCache, suggestReply } = await load();
    const first = await withRawReplyCache(() => suggestReply(input));
    expect(first).toMatchObject({ hit: false, fetched: true, blocked: false });
    expect(first.value.intent).toBe("general"); // işleme: tanınmayan niyet → general
    const files = rawFiles();
    expect(files).toHaveLength(1);
    const stored = JSON.parse(readFileSync(files[0], "utf8"));
    expect(stored.choices[0].message.content).toBe(MODEL_CONTENT); // ham — "garip_niyet" duruyor
  });

  it("🚨 aynı istek ikinci kez AĞA ÇIKMAZ; sonuç bugünkü işlemeyle yeniden üretilir", async () => {
    const { withRawReplyCache, suggestReply } = await load();
    await withRawReplyCache(() => suggestReply(input));
    const second = await withRawReplyCache(() => suggestReply(input));
    expect(calls).toBe(1);
    expect(second).toMatchObject({ hit: true, fetched: false });
    expect(second.value.source).toBe("openai");
    expect(second.value.reply).toBe("Çıkış 11:00.");
  });

  it("🚨 ham kaydın içeriği değişirse (işleme girdisi) sonuç da değişir — işlenmiş sonuç önbellekten okunmaz", async () => {
    const { withRawReplyCache, suggestReply } = await load();
    await withRawReplyCache(() => suggestReply(input));
    const [file] = rawFiles();
    writeFileSync(file, apiResponse(MODEL_CONTENT.replace("Çıkış 11:00.", "Çıkış saati 11:00'dir.")));
    const again = await withRawReplyCache(() => suggestReply(input));
    expect(again.value.reply).toBe("Çıkış saati 11:00'dir.");
    expect(calls).toBe(1);
  });

  it("eski kayıt varken (onMiss: block) ağa çıkılmaz, çağıran eski kaydı ayrı sayar", async () => {
    const { withRawReplyCache, suggestReply } = await load();
    const r = await withRawReplyCache(() => suggestReply(input), { onMiss: "block" });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ hit: false, fetched: false, blocked: true });
    expect(r.value.source).not.toBe("openai");
  });

  it("çevrimdışı kipte ham kayıt yoksa yüksek sesle hata (sessiz 'başarısız çağrı' değil), ağa çıkılmaz", async () => {
    vi.stubEnv("RAG_LAB_OFFLINE", "1");
    const { withRawReplyCache, suggestReply } = await load();
    await expect(withRawReplyCache(() => suggestReply(input))).rejects.toThrow(/RAG_LAB_OFFLINE/);
    expect(calls).toBe(0);
  });

  it("kesilmiş (finish_reason: length) yanıt saklanmaz — tekrar denemede yeniden sorulur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(apiResponse(MODEL_CONTENT, "length"), { status: 200 });
      }),
    );
    const { withRawReplyCache, suggestReply } = await load();
    await withRawReplyCache(() => suggestReply(input));
    expect(rawFiles()).toHaveLength(0);
  });

  it("KONTROL — kapsam dışındaki çağrı yakalanmaz (önbelleğe yazılmaz)", async () => {
    const { withRawReplyCache, suggestReply } = await load();
    await withRawReplyCache(async () => 1); // kurulum
    await suggestReply(input); // kapsam DIŞINDA
    expect(rawFiles()).toHaveLength(0);
    expect(calls).toBe(1);
  });
});
