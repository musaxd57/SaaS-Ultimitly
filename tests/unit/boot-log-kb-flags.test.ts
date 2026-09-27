import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { register } from "@/instrumentation";

// ---------------------------------------------------------------------------
// #189 AÇILIŞ LOGU — retrieval bayrakları operatöre görünür: soru başına yeniden sıralama (`KB_RERANK_PER_QUESTION`) ve
// kullanılan gömme modeli + eşiği (`OPENAI_EMBEDDING_MODEL`). Tanınmayan / etkisiz değer GÜRÜLTÜLÜ yazılır (davranış
// değişmez: kapalı kalır).
// ---------------------------------------------------------------------------

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void logs.push(`WARN ${a.join(" ")}`));
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("INTERNAL_CRON_DISABLED", "1");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
  vi.stubEnv("KB_RERANK_ENABLED", "");
  vi.stubEnv("KB_RERANK_PER_QUESTION", "");
  vi.stubEnv("OPENAI_EMBEDDING_MODEL", "");
  vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const rerankLines = () => logs.filter((l) => l.includes("[kb-rerank]"));
const semLines = () => logs.filter((l) => l.includes("[kb-semantic]"));
const wideLines = () => logs.filter((l) => l.includes("geniş blok") || l.includes("KB_RETRIEVAL_WIDE_BUDGET"));

describe("açılış logu — retrieval bayrakları", () => {
  it("hepsi kapalı: soru başına satırı ve model satırı YOK", async () => {
    await register();
    expect(rerankLines()).toEqual(["[kb-rerank] kapalı"]);
    expect(semLines()).toEqual(["[kb-semantic] kapalı"]);
  });

  it("soru başına: tanınmayan değer GÜRÜLTÜLÜ; yeniden sıralayıcı kapalıyken 'etkisiz'; ikisi açıkken AÇIK", async () => {
    vi.stubEnv("KB_RERANK_PER_QUESTION", "evet");
    await register();
    expect(rerankLines().some((l) => l.startsWith("WARN") && l.includes('KB_RERANK_PER_QUESTION="evet" TANINMADI'))).toBe(true);
    logs.length = 0;
    vi.stubEnv("KB_RERANK_PER_QUESTION", "1");
    await register();
    expect(rerankLines()).toContain("WARN [kb-rerank] KB_RERANK_PER_QUESTION AÇIK ama etkisiz: KB_RERANK_ENABLED kapalı");
    logs.length = 0;
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    await register();
    expect(rerankLines()).toEqual(["[kb-rerank] AÇIK", "[kb-rerank] soru başına pencere AÇIK"]);
  });

  it("anlamsal kaynak açıkken kullanılan model ve eşiği yazılır (varsayılan small 0.4; large 0.25)", async () => {
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
    await register();
    expect(semLines()).toContain("[kb-semantic] model=text-embedding-3-small eşik=0.4");
    logs.length = 0;
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
    await register();
    expect(semLines()).toContain("[kb-semantic] model=text-embedding-3-large eşik=0.25");
  });

  it("geniş blok bütçesi: kapalıyken satır YOK; tanınmayan GÜRÜLTÜLÜ; legacy'de 'etkisiz'; açıkken değerleriyle AÇIK", async () => {
    await register();
    expect(wideLines()).toEqual([]);
    vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "evet");
    await register();
    expect(wideLines()).toEqual(['WARN [kb-retrieval] KB_RETRIEVAL_WIDE_BUDGET="evet" TANINMADI — KAPALI. Açmak için: 1 | on | true']);
    logs.length = 0;
    vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    await register();
    expect(wideLines()).toEqual(["WARN [kb-retrieval] geniş blok bütçesi AÇIK ama etkisiz: legacy modda"]);
    logs.length = 0;
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
    await register();
    expect(wideLines()).toEqual(["[kb-retrieval] geniş blok bütçesi AÇIK (23000 karakter / 80 parça)"]);
  });
});
