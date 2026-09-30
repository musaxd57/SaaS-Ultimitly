import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { evalRuntime, evalRuntimeMarkdown, PIPELINE_FLAGS, reasoningLabel, storedRunRuntime, type EvalRuntime } from "../eval/run-meta";
import { writeSidecar } from "../eval/sidecar";
import { STRICT_ONE_FLAGS } from "../../scripts/env-check.mjs";

// ---------------------------------------------------------------------------
// KOŞU KİMLİĞİ (Aşama 1, kurucu 09-30): "Gerçek değerlendirmelerde model ve reasoning ayarını kaydet. Eski önbellek
// cevaplarını yeni Luna sonucu sayma."
//  · Her rapor + yan dosya katman bazında model + GÖNDERİLEN düşünme çabasını taşır (ürünün çözücüleriyle aynı kural).
//  · Yeniden puanlanan ESKİ koşu kendi kimliğini korur — şu anki ortamın modeli (Luna) eski cevaplara yazılmaz.
// ---------------------------------------------------------------------------

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "eval-run-meta-"));
  dirs.push(d);
  return d;
}

function quiet(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
}

function lunaEnv(): void {
  vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
  vi.stubEnv("OPENAI_REASONING_EFFORT", "low");
  vi.stubEnv("AI_SEMANTIC_MODEL", "");
  vi.stubEnv("AI_SEMANTIC_REASONING_EFFORT", "");
  vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
}

describe("evalRuntime — katman bazında model + gönderilen düşünme çabası", () => {
  it("Luna: cevap modeli + çaba; anlam katmanı OPENAI_MODEL'e düşer ve çabası gönderilmez (model varsayılanı); gömme modeli", () => {
    lunaEnv();
    const rt = evalRuntime();
    expect(rt.layers.reply).toEqual({ model: "gpt-6-luna", reasoning: "low" });
    expect(rt.layers.semantic).toEqual({ model: "gpt-6-luna", reasoning: "gönderilmez (model varsayılanı)" });
    expect(rt.layers.embedding).toEqual({ model: "text-embedding-3-large" });
  });

  it("anlam katmanının kendi modeli ve çabası ayrı okunur", () => {
    lunaEnv();
    vi.stubEnv("AI_SEMANTIC_MODEL", "gpt-5.1");
    vi.stubEnv("AI_SEMANTIC_REASONING_EFFORT", "minimal");
    expect(evalRuntime().layers.semantic).toEqual({ model: "gpt-5.1", reasoning: "minimal" });
  });

  it("🚨 klasik modele çaba GİTMEZ (ürün kuralı) → 'yok'; tanınmayan çaba değeri gönderilmez", () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-4.1");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "high");
    vi.stubEnv("AI_SEMANTIC_MODEL", "");
    vi.stubEnv("AI_SEMANTIC_REASONING_EFFORT", "high");
    const rt = evalRuntime();
    expect(rt.layers.reply).toEqual({ model: "gpt-4.1", reasoning: "yok (klasik model)" });
    expect(rt.layers.semantic).toEqual({ model: "gpt-4.1", reasoning: "yok (klasik model)" });

    vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "turbo");
    expect(evalRuntime().layers.reply).toEqual({ model: "gpt-5.1", reasoning: "gönderilmez (model varsayılanı)" });
  });

  it("OPENAI_MODEL boşsa kod içi varsayılan (canlı model ailesi) yazılır, boş dize değil", () => {
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "");
    vi.stubEnv("AI_SEMANTIC_MODEL", "");
    const rt = evalRuntime();
    expect(rt.layers.reply.model).toBe("gpt-5.1");
    expect(rt.layers.semantic.model).toBe("gpt-5.1");
  });

  it("hattı değiştiren bayraklar ham değerleriyle; ayarsız = '(boş)'", () => {
    for (const f of PIPELINE_FLAGS) vi.stubEnv(f, "");
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", " 1 ");
    const rt = evalRuntime();
    expect(rt.flags.KB_SEMANTIC_RETRIEVAL).toBe("1");
    expect(rt.flags.AI_UNDERSTANDING_ENABLED).toBe("1");
    expect(rt.flags.KB_RERANK_ENABLED).toBe("(boş)");
    expect(Object.keys(rt.flags).sort()).toEqual([...PIPELINE_FLAGS].sort());
  });

  it("ürünün yalnız '1' ile açılan HER AI_* bayrağı koşu kimliğinde (yeni bayrak ölçümü sessizce değiştirmesin)", () => {
    const aiFlags = STRICT_ONE_FLAGS.filter((f: string) => f.startsWith("AI_"));
    expect(aiFlags.length).toBeGreaterThanOrEqual(8); // anti-vakum
    expect(aiFlags.filter((f: string) => !(PIPELINE_FLAGS as readonly string[]).includes(f))).toEqual([]);
  });

  it("reasoningLabel: klasik / gönderilmez / gönderilen", () => {
    expect(reasoningLabel("gpt-4.1", "high")).toBe("yok (klasik model)");
    expect(reasoningLabel("gpt-6-luna", null)).toBe("gönderilmez (model varsayılanı)");
    expect(reasoningLabel("gpt-6-luna", undefined)).toBe("gönderilmez (model varsayılanı)");
    expect(reasoningLabel("gpt-6-luna", "none")).toBe("none");
  });
});

describe("writeSidecar — kimlik yan dosyaya ve rapora", () => {
  it("yan dosya şu anki ortamın kimliğini taşır; mevcut rapora 'Koşu kimliği' bölümü eklenir", () => {
    lunaEnv();
    quiet();
    const dir = tmp();
    writeFileSync(path.join(dir, "r.md"), "# rapor\n", "utf8");
    const json = writeSidecar(dir, "r.md", { suite: "s", version: 1, meta: {}, rows: [] });
    const side = JSON.parse(readFileSync(json, "utf8")) as { runtime: EvalRuntime };
    expect(side.runtime.layers.reply).toEqual({ model: "gpt-6-luna", reasoning: "low" });
    const md = readFileSync(path.join(dir, "r.md"), "utf8");
    expect(md.startsWith("# rapor\n")).toBe(true);
    expect(md).toContain("## Koşu kimliği");
    expect(md).toContain("| `gpt-6-luna` | low |");
    expect(md).toContain("`text-embedding-3-large`");
  });

  it("rapor dosyası yoksa YARATILMAZ (yalnız yan dosya)", () => {
    quiet();
    const dir = tmp();
    writeSidecar(dir, "yok.md", { suite: "s", version: 1, meta: {}, rows: [] });
    expect(existsSync(path.join(dir, "yok.md"))).toBe(false);
    expect(readdirSync(dir)).toEqual(["yok.json"]);
  });

  it("🚨 yeniden puanlama: verilen ESKİ kimlik korunur — ortam Luna dese de yan dosya ve rapor eski modeli yazar", () => {
    lunaEnv();
    quiet();
    const dir = tmp();
    writeFileSync(path.join(dir, "eski.md"), "# eski\n", "utf8");
    const old = storedRunRuntime({ meta: { model: "gpt-5.1", commit: "abc1234" } });
    const json = writeSidecar(dir, "eski.md", { suite: "s", version: 1, meta: {}, rows: [], runtime: old });
    const raw = readFileSync(json, "utf8");
    expect(JSON.parse(raw).runtime).toEqual(old);
    expect(raw).not.toContain("gpt-6-luna");
    expect(readFileSync(path.join(dir, "eski.md"), "utf8")).not.toContain("gpt-6-luna");
  });
});

describe("storedRunRuntime — ESKİ koşunun kimliği (ortamı okumaz)", () => {
  it("yan dosya kimlik taşıyorsa AYNEN", () => {
    lunaEnv();
    const rt: EvalRuntime = {
      commit: "c1",
      layers: { reply: { model: "gpt-5.1", reasoning: "gönderilmez (model varsayılanı)" }, semantic: { model: "gpt-5.1", reasoning: "low" }, embedding: { model: "text-embedding-3-small" } },
      flags: { KB_SEMANTIC_RETRIEVAL: "1" },
    };
    expect(storedRunRuntime({ meta: { model: "başka", commit: "c2" }, runtime: rt })).toBe(rt);
  });

  it("🚨 09-30 öncesi yan dosya: cevap modeli meta'dan, gerisi 'bilinmiyor' — şu anki Luna ortamı YAZILMAZ", () => {
    lunaEnv();
    const rt = storedRunRuntime({ meta: { model: "gpt-5.1", commit: "abc1234" } });
    expect(rt.commit).toBe("abc1234");
    expect(rt.layers.reply.model).toBe("gpt-5.1");
    expect(rt.layers.reply.reasoning).toMatch(/bilinmiyor/);
    expect(rt.layers.semantic.model).toMatch(/bilinmiyor/);
    expect(rt.layers.embedding.model).toMatch(/bilinmiyor/);
    expect(rt.flags).toEqual({});
    expect(JSON.stringify(rt)).not.toMatch(/gpt-6-luna|text-embedding-3-large/);
  });

  it("meta eksik / tipi yanlışsa 'bilinmiyor' ve commit null", () => {
    const rt = storedRunRuntime({ meta: { model: 5, commit: null } });
    expect(rt.layers.reply.model).toMatch(/bilinmiyor/);
    expect(rt.commit).toBeNull();
    expect(storedRunRuntime({}).layers.reply.model).toMatch(/bilinmiyor/);
  });

  it("markdown: bayrak listesi boşsa 'bilinmiyor' yazar (eski koşu); yapılandırma geçersiz kılma notu hep var", () => {
    const md = evalRuntimeMarkdown(storedRunRuntime({ meta: { model: "gpt-5.1", commit: "abc" } }));
    expect(md).toMatch(/Bayraklar: bilinmiyor/);
    expect(md).toContain("| `gpt-5.1` | bilinmiyor (09-30 öncesi koşu) |");
    expect(md).toMatch(/geçersiz kılma/);
  });
});

describe("bağlantı pinleri (kaynak taraması, tek yönlü — davranış ↑yukarıda)", () => {
  const evalDir = path.resolve(__dirname, "../eval");
  const read = (f: string) => readFileSync(path.join(evalDir, f), "utf8");

  it("iki yeniden puanlama yolu ESKİ kimliği verir", () => {
    const compare = read("model-reply-compare.eval.test.ts");
    const rescoreBlock = compare.slice(compare.indexOf("const RESCORE"));
    expect(compare.indexOf("const RESCORE")).toBeGreaterThan(0);
    expect(rescoreBlock).toContain("storedRunRuntime(side)");
    const cus = read("conversation-state.eval.test.ts");
    const cusBlock = cus.slice(cus.indexOf("const RESCORE"));
    expect(cus.indexOf("const RESCORE")).toBeGreaterThan(0);
    expect(cusBlock).toContain("storedRunRuntime(side)");
    expect(read("conversation-state-harness.ts")).toMatch(/rows, runtime \}\);/);
  });

  it("docs/olcum'a rapor yazan HER ölçer dosyası kimliği taşır (writeSidecar ya da evalRuntimeMarkdown)", () => {
    const writers = readdirSync(evalDir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => {
        const s = read(f);
        return s.includes("docs/olcum") && s.includes("writeFileSync(");
      });
    expect(writers.length).toBeGreaterThanOrEqual(12);
    const missing = writers.filter((f) => {
      const s = read(f);
      return !s.includes("writeSidecar(") && !s.includes("evalRuntimeMarkdown(");
    });
    expect(missing).toEqual([]);
  });
});
