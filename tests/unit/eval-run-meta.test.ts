import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  evalRuntime,
  evalRuntimeMarkdown,
  PIPELINE_FLAGS,
  REPLY_VARIANT_INPUT,
  reasoningLabel,
  storedRunRuntime,
  understandingModeLabel,
  type EvalRuntime,
} from "../eval/run-meta";
import { writeSidecar } from "../eval/sidecar";
import { understandingSystemPromptFor } from "@/lib/ai/semantic/understand";
import { STRICT_ONE_FLAGS } from "../../scripts/env-check.mjs";

const sha12 = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);

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

  it("çeviri + üslup: GÖNDERİLEN çaba ürünün kuralıyla (10-02: kimlik tablosu her zaman '—' yazıyordu, Luna medium / none görünmüyordu)", () => {
    lunaEnv();
    vi.stubEnv("OPENAI_TRANSLATE_MODEL", "gpt-6-luna");
    vi.stubEnv("OPENAI_TRANSLATE_REASONING_EFFORT", "medium");
    vi.stubEnv("OPENAI_STYLE_MODEL", "gpt-6-luna");
    vi.stubEnv("OPENAI_STYLE_REASONING_EFFORT", "none");
    let rt = evalRuntime();
    expect(rt.layers.translate).toEqual({ model: "gpt-6-luna", reasoning: "medium" });
    expect(rt.layers.style).toEqual({ model: "gpt-6-luna", reasoning: "none" });
    const md = evalRuntimeMarkdown(rt);
    expect(md).toContain("| Çeviri | `gpt-6-luna` | medium |");
    expect(md).toContain("| Üslup özeti | `gpt-6-luna` | none |");
    // Ayarsız / tanınmayan çaba gönderilmez; klasik modele hiç gitmez (ürün: `isReasoningModel && layerReasoningEffort`).
    vi.stubEnv("OPENAI_TRANSLATE_REASONING_EFFORT", "turbo");
    vi.stubEnv("OPENAI_STYLE_MODEL", "gpt-4.1");
    vi.stubEnv("OPENAI_STYLE_REASONING_EFFORT", "high");
    rt = evalRuntime();
    expect(rt.layers.translate).toEqual({ model: "gpt-6-luna", reasoning: "gönderilmez (model varsayılanı)" });
    expect(rt.layers.style).toEqual({ model: "gpt-4.1", reasoning: "yok (klasik model)" });
    // Eski yan dosyada alan yoksa tablo yine kurulur ("—", uydurma yok).
    const old: EvalRuntime = { ...rt, layers: { ...rt.layers, translate: { model: "gpt-5.1" }, style: { model: "gpt-5.1" } } };
    expect(evalRuntimeMarkdown(old)).toContain("| Çeviri | `gpt-5.1` | — |");
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

  it("🚨 ölçer anlama kipini KENDİSİ veriyorsa istem kimliği O kiple (10-01: konaklama raporları gerçekte koşan öğe + kural istemi yerine yalnız şikâyet takibinin kimliğini yazdı)", () => {
    for (const f of PIPELINE_FLAGS) vi.stubEnv(f, "");
    vi.stubEnv("AI_COMPLAINT_FOLLOWUP_RULE_ENABLED", "1");
    const full = { items: true, rules: true, complaintFollowup: true };
    const rt = evalRuntime({ understanding: full });
    expect(rt.prompts?.understanding).toBe(sha12(understandingSystemPromptFor(full)));
    expect(rt.prompts?.understanding).not.toBe(sha12(understandingSystemPromptFor({ complaintFollowup: true })));
    expect(rt.prompts?.understandingMode).toBe("items+rules+cfu");
    // Yalnız `true` kip açar (ölçerin `=== "1"` okumasıyla aynı katılık); eksik alan kapalı.
    const itemsOnly = evalRuntime({ understanding: { items: true } });
    expect(itemsOnly.prompts?.understanding).toBe(sha12(understandingSystemPromptFor({ items: true })));
    expect(itemsOnly.prompts?.understandingMode).toBe("items");
  });

  it("kip verilmezse ürünün karar noktasıyla AYNI bayraklardan (`kb-retrieve.ts`): öğe / kural kipi anlama katmanı açıkken sayılır", () => {
    for (const f of PIPELINE_FLAGS) vi.stubEnv(f, "");
    vi.stubEnv("AI_SEMANTIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_COMPLAINT_FOLLOWUP_RULE_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    // Anlama katmanı kapalı (anahtar yok) → öğe / kural kipi AÇIK SAYILMAZ (ürün kuralı).
    expect(evalRuntime().prompts?.understandingMode).toBe("cfu");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-run-meta");
    const rt = evalRuntime();
    expect(rt.prompts?.understandingMode).toBe("items+rules+cfu");
    expect(rt.prompts?.understanding).toBe(sha12(understandingSystemPromptFor({ items: true, rules: true, complaintFollowup: true })));
  });

  it("🚨 cevap isteminin ÇAĞRI BAŞINA katmanları da kimlikte (10-02: aday kod 53 + 47 ile bugünkü kod aynı cevap kimliğini yazıyordu)", async () => {
    for (const f of PIPELINE_FLAGS) vi.stubEnv(f, "");
    const { replyRequestIdentity } = await import("@/lib/ai");
    const rt = evalRuntime();
    // Sabit örnek (yabancı dilde misafir + bırakılan öğe): SİSTEM + KULLANICI istemi birlikte — dil satırı ve öğe bloğu kullanıcı isteminde.
    const id = replyRequestIdentity(REPLY_VARIANT_INPUT);
    expect(rt.prompts?.replyVariant).toBe(sha12(`${id.system}\n${id.user}`));
    expect(rt.prompts?.replyVariant).not.toBe(rt.prompts?.reply);
    // Örnek gerçekten iki katmanı da tetikler: Türkçe OLMAYAN misafirin dil satırı + konuşma öğeleri bloğu (bırakılan öğe dahil).
    expect(id.user).toContain("ÇEVİREREK yaz");
    expect(id.user).toContain("r1 · Wi-Fi");
    // Saatten BAĞIMSIZ (sabit an): kullanıcı istemi "Bugün" satırı taşır, kimlik günden güne oynamamalı.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-05T03:00:00Z"));
      const a = evalRuntime().prompts?.replyVariant;
      vi.setSystemTime(new Date("2026-11-20T21:00:00Z"));
      expect(evalRuntime().prompts?.replyVariant).toBe(a);
    } finally {
      vi.useRealTimers();
    }
    const md = evalRuntimeMarkdown(rt);
    expect(md).toContain(`cevap \`${rt.prompts?.reply}\` (öğe + yabancı dil örneği \`${rt.prompts?.replyVariant}\`)`);
    // Eski yan dosya (alan yok): tablo yine kurulur, uydurma kimlik yazılmaz.
    const old = { ...rt, prompts: { reply: "aaaaaaaaaaaa", understanding: "bbbbbbbbbbbb" } };
    expect(evalRuntimeMarkdown(old)).toContain("cevap `aaaaaaaaaaaa` · anlama");
    expect(evalRuntimeMarkdown(old)).not.toContain("öğe + yabancı dil");
  });

  it("understandingModeLabel: ölçerlerin 'anlama kipi' söz dizimi; hiçbiri yoksa 'temel'", () => {
    expect(understandingModeLabel({})).toBe("temel");
    expect(understandingModeLabel({ rules: true, complaintFollowup: true })).toBe("rules+cfu");
    expect(understandingModeLabel({ items: true, rules: false, complaintFollowup: true })).toBe("items+cfu");
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

  it("markdown: istem kimliğinin yanında anlama kipi yazılır (kimlik hangi istemin)", () => {
    for (const f of PIPELINE_FLAGS) vi.stubEnv(f, "");
    const md = evalRuntimeMarkdown(evalRuntime({ understanding: { items: true, rules: true, complaintFollowup: true } }));
    expect(md).toContain(`anlama \`${sha12(understandingSystemPromptFor({ items: true, rules: true, complaintFollowup: true }))}\` (kip: items+rules+cfu)`);
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

  it("🚨 konaklama ölçeri kimliği KENDİ anlama kipiyle verir (kip `EVAL_UNDERSTANDING_*` ile gelir, ürün bayrağıyla değil)", () => {
    const s = read("stay-change.eval.test.ts");
    const call = s.slice(s.indexOf("writeSidecar(dir, name, {"));
    expect(s.indexOf("writeSidecar(dir, name, {")).toBeGreaterThan(0);
    expect(call.slice(0, call.indexOf("});"))).toContain("runtime: evalRuntime({ understanding: NLU_MODE })");
  });

  it("🚨 canlı hat ölçeri kimliği canlı bayraklar GERİ ALINMADAN önce alır ve rapora o kimliği verir (10-01: bayraklar '(boş)' yazılıyordu)", () => {
    const s = read("live-pipeline.eval.test.ts");
    const after = s.slice(s.indexOf("afterAll(() => {"));
    expect(s.indexOf("afterAll(() => {")).toBeGreaterThan(0);
    const take = after.indexOf("const runtime = evalRuntime();");
    const unstub = after.indexOf("vi.unstubAllEnvs();");
    expect(take).toBeGreaterThan(0);
    expect(unstub).toBeGreaterThan(take);
    const sidecar = after.slice(after.indexOf("writeSidecar(dir, name, {"));
    expect(after.indexOf("writeSidecar(dir, name, {")).toBeGreaterThan(unstub);
    expect(sidecar.slice(0, sidecar.indexOf("});"))).toMatch(/^\s+runtime,$/m);
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
