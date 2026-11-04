import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { understandGuestMessages, understandingSystemPromptFor, __resetUnderstandingCache, UNDERSTANDING_FAULT_CONTEXT_RULE, insertAfterIntentLine } from "@/lib/ai/semantic/understand";
import { writeSidecar, uniqueReportName } from "./sidecar";
import { codeProvenance } from "./code-provenance";
import { claudeArmFromEnv, installAnthropicReplyShim, shimSummaryLine } from "./anthropic-reply-shim";

// ---------------------------------------------------------------------------
// ARIZA ↔ KULLANIM SORUSU (10-15): konuşma öğeleri ölçümünde "Tost makinesi hiç ısınmıyor, Wi-Fi şifresi neydi?" anlama katmanında
// appliance_help sanıldı → ev sahibinde tutulacak şikâyet öğesi oluşmadı, cevap modeli turu "şikâyet" saydı, tur bütünüyle tutuldu ve
// Wi-Fi cevaplanmadı. Bu ölçer yalnız anlama katmanını çağırır; iki kip (canlıdaki öğe + ilişki kipi, temel kip) × tur. İstem kolu
// (bugünkü / arıza cümlesi eklenmiş) çalışma ağacının koduyla gelir; rapor kolu istemden ÖLÇER. İKİ KAPI: RUN_REAL_EVAL=1 + anahtar.
// ---------------------------------------------------------------------------

interface Case {
  id: string;
  lang: string;
  message: string;
  /** Bu mesajdan ÖNCEKİ konuşma (v2, kurucu 11-04: "konuşma geçmişini içeren önce/sonra testleri"). */
  history?: { direction: "inbound" | "outbound"; body: string }[];
  include: string[][];
  exclude?: string[];
}

/** Vaka kimliğinin öneki → kategori (rapor + çevrimdışı pin). */
export const CASE_CATEGORIES: Readonly<Record<string, string>> = {
  b: "mevcut arıza",
  h: "kullanım sorusu",
  y: "varsayımsal soru",
  c: "çözülmüş",
  n: "olumsuzlanan (bozuk değil)",
  m: "arıza + bağımsız soru",
  t: "arıza + tehlike",
  g: "konuşma geçmişli",
};
export const categoryOf = (id: string): string => id.split("-")[0];
const DATA = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/understanding-breakdown.json"), "utf8")) as { cases: Case[] };
// Claude kolu (kurucu 10-31: 5.1 kullanılan katmanlarda Haiku 5.5): anlama çağrısı aynı istem + şemayla Claude'a gider.
const CLAUDE = claudeArmFromEnv();
/**
 * YALNIZ ÖLÇÜM (kurucu 11-04: "Haiku'nun kötü olduğu yerin nedenini öğren, geliştir"): `EVAL_UNDERSTANDING_FAULT_RULE=1` → hazır yamanın
 * (`docs/hazir-yamalar/2026-10-15-anlama-ariza-kullanim-ayrimi.patch`) cümlesi, anlama çağrısının sistem istemine GÖNDERİM ANINDA eklenir.
 * Ürün kodu değişmez; iki modelde (OpenAI + Claude köprüsü) aynı ek. Rapor kolu "ariza-cumlesi-olcum" yazar.
 */
export const FAULT_RULE =
  "- A report that an appliance or device is broken or not working as it should (not heating or cooling, not turning on, leaking, a strange noise, an error, nothing comes out) is complaint_issue, also when the guest asks how to fix it or for a replacement. appliance_help is only for how to use, operate or find something that is not reported broken. Example: 'Tost makinesi hiç ısınmıyor' -> complaint_issue; 'Tost makinesini nasıl çalıştırıyoruz?' -> appliance_help.";
/**
 * v2 (kurucu 11-04): "her zaman şikâyet" sabit kuralına DÖNÜŞMESİN — varsayımsal, olumsuzlanan, çözülmüş durum bağlamdan ayrılır; tehlike ayrı akış;
 * bağımsız soru ayrı istek; konuşma geçmişi okunur. Örnekler BAŞKA cihazla (ütü) yazılır — test cümleleri isteme girmez (pin).
 */
// 11-04 akşam: kural ÜRÜNDE (anahtar `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED`, kapalı) — ölçer AYNI sabiti AYNI yere koyar (ölçülen = gönderilen).
export const FAULT_RULE_V2 = UNDERSTANDING_FAULT_CONTEXT_RULE;
const RULE_VERSION = process.env.EVAL_UNDERSTANDING_FAULT_RULE?.trim() ?? "";
const ACTIVE_RULE = RULE_VERSION === "1" ? FAULT_RULE : RULE_VERSION === "2" ? FAULT_RULE_V2 : null;
const FAULT_RULE_ARM = ACTIVE_RULE !== null;
/** Sistem istemindeki niyet satırının ARDINA kuralı ekler (satır yoksa dokunmaz). */
export function withFaultRule(system: string, rule: string = FAULT_RULE): string {
  return insertAfterIntentLine(system, rule);
}
function installFaultRule(): () => void {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/chat/completions") && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as { messages?: { role: string; content: unknown }[] };
      const sys = body.messages?.find((m) => m.role === "system" || m.role === "developer");
      if (sys && typeof sys.content === "string" && ACTIVE_RULE) sys.content = withFaultRule(sys.content, ACTIVE_RULE);
      return inner(input, { ...init, body: JSON.stringify(body) });
    }
    return inner(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = inner;
  };
}
const key = process.env.OPENAI_API_KEY ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const ROUNDS = Math.min(3, Math.max(1, Math.trunc(Number(process.env.BREAKDOWN_EVAL_ROUNDS) || 2)));
const MODES = [
  { id: "canli-oge-iliski", opts: { items: true, complaintFollowup: true } },
  { id: "temel", opts: {} },
] as const;

/** İstem kolu: arıza / kullanım ayrım cümlesi sistem isteminde var mı. */
export function promptArm(): "ariza-cumlesi" | "bugunku" {
  return /broken or not working as it should/u.test(understandingSystemPromptFor({})) ? "ariza-cumlesi" : "bugunku";
}

export function judgeCase(c: Case, intents: readonly string[]): string[] {
  const fails: string[] = [];
  for (const group of c.include) if (!intents.some((i) => group.includes(i))) fails.push(`eksik ${group.join("|")}`);
  for (const ex of c.exclude ?? []) if (intents.includes(ex)) fails.push(`fazla ${ex}`);
  return fails;
}

describe.skipIf(!enabled)("arıza ↔ kullanım sorusu — anlama katmanı (ücretli)", () => {
  it("kip × vaka × tur → rapor", async () => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    const arm = RULE_VERSION === "2" ? "ariza-baglam-v2-olcum" : FAULT_RULE_ARM ? "ariza-cumlesi-olcum" : promptArm();
    const undo = CLAUDE ? installAnthropicReplyShim(CLAUDE.opts, CLAUDE.key) : null;
    const undoRule = FAULT_RULE_ARM ? installFaultRule() : null; // en dışta: ek, köprüden / OpenAI'den ÖNCE uygulanır
    const rows: { mode: string; id: string; round: number; ok: boolean; intents: string[]; fails: string[] }[] = [];
    for (const mode of MODES) {
      for (let round = 0; round < ROUNDS; round++) {
        __resetUnderstandingCache();
        for (const c of DATA.cases) {
          const out = await understandGuestMessages({ guestMessage: c.message, history: [...(c.history ?? []), { direction: "inbound", body: c.message }], ...mode.opts });
          if (out.status !== "ok") {
            rows.push({ mode: mode.id, id: c.id, round, ok: false, intents: [], fails: [`katman ${out.status}`] });
            continue;
          }
          const intents = out.value.requests.map((r) => r.intent);
          const fails = judgeCase(c, intents);
          rows.push({ mode: mode.id, id: c.id, round, ok: fails.length === 0, intents, fails });
        }
      }
    }
    undoRule?.();
    undo?.();
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const name = uniqueReportName(dir, `ariza-kullanim-${date}-${arm}${CLAUDE ? `-${CLAUDE.label}` : ""}.md`);
    const prov = codeProvenance(path.resolve(__dirname, "../.."));
    const lines = [
      `# Arıza ↔ kullanım sorusu — anlama katmanı (${date}) · istem kolu: ${arm}`,
      "",
      `Kod: HEAD \`${prov.head}\` · ${prov.dirty ? `yerel src değişikliği VAR (özet \`${prov.srcDiff}\`)` : "yerel src değişikliği yok"}`,
      "",
      `Anlama modeli: ${CLAUDE ? `${CLAUDE.label} (Claude köprüsü)` : process.env.AI_UNDERSTANDING_MODEL || process.env.AI_SEMANTIC_MODEL || "kod varsayılanı"}`,
      ...(CLAUDE ? ["", shimSummaryLine()] : []),
      "",
      ...MODES.map((m) => {
        const r = rows.filter((x) => x.mode === m.id);
        const b = r.filter((x) => x.id.startsWith("b-"));
        const h = r.filter((x) => x.id.startsWith("h-"));
        const cats = Object.entries(CASE_CATEGORIES)
          .map(([k, label]) => {
            const rc = r.filter((x) => categoryOf(x.id) === k);
            return rc.length ? `${label} ${rc.filter((x) => x.ok).length}/${rc.length}` : null;
          })
          .filter(Boolean)
          .join(" · ");
        return `- ${m.id}: toplam ${r.filter((x) => x.ok).length}/${r.length} · arıza bildirimi ${b.filter((x) => x.ok).length}/${b.length} · kullanım sorusu ${h.filter((x) => x.ok).length}/${h.length}\n  - kategoriler: ${cats}`;
      }),
      "",
      "| Kip | Vaka | Tur | Sonuç | Niyetler | Hata |",
      "|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.mode} | ${r.id} | ${r.round + 1} | ${r.ok ? "✓" : "✗"} | ${r.intents.join(" + ") || "—"} | ${r.fails.join("; ")} |`),
    ];
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "understanding-breakdown", version: 1, meta: { arm, rounds: ROUNDS, provenance: prov }, rows });
    expect(rows.length).toBe(MODES.length * ROUNDS * DATA.cases.length);
  }, 30 * 60_000);
});

describe("arıza ↔ kullanım ölçeri — çevrimdışı pinler", () => {
  it("ölçüm kuralı niyet satırının ARDINA bir kez eklenir; gerçek istemde satır bulunur", () => {
    const real = understandingSystemPromptFor({});
    const patched = withFaultRule(real);
    expect(patched).toContain(FAULT_RULE);
    expect(patched.indexOf(FAULT_RULE)).toBeGreaterThan(patched.indexOf("- intent: the closest label"));
    expect(withFaultRule(patched)).toBe(patched);
    expect(withFaultRule("başka istem")).toBe("başka istem");
  });
  it("vakalar eşsiz; kategori beklentileri (kurucu 11-04 tablosu) veriyle tutarlı", () => {
    const ids = DATA.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const needs = (c: Case, intent: string) => c.include.some((g) => g.includes(intent));
    for (const c of DATA.cases) {
      const cat = categoryOf(c.id);
      expect(Object.keys(CASE_CATEGORIES)).toContain(cat);
      if (cat === "b" || cat === "m") expect(needs(c, "complaint_issue")).toBe(true); // mevcut arıza host'ta açık iş
      if (cat === "h" || cat === "y" || cat === "c" || cat === "n") expect(c.exclude).toContain("complaint_issue"); // arıza AÇILMAZ
      if (cat === "y" || cat === "c" || cat === "n") expect(c.exclude).toContain("emergency");
      if (cat === "m") expect(c.include.length).toBeGreaterThanOrEqual(2); // bağımsız soru ayrı istek
      if (cat === "t") {
        expect(needs(c, "emergency")).toBe(true); // tehlike akışı
        expect(c.exclude).toContain("appliance_help");
      }
      if (cat === "g") expect(c.history?.length ?? 0).toBeGreaterThan(0);
    }
    // Kurucunun beş cümlesi aynen var (önce / sonra kanıtı bunlar üzerinden okunur).
    for (const m of ["Tost makinesi ısınmazsa ne yapmalıyım?", "Tost makinesi ısınmıyordu ama şimdi düzeldi, teşekkürler.", "Tost makinesi ısınmıyor; çöpleri nereye atıyoruz?", "Tost makinesi ısınmıyor, prizden duman çıkıyor."]) {
      expect(DATA.cases.some((c) => c.message === m)).toBe(true);
    }
  });

  it("v2 kuralı test cümlelerini İÇERMEZ (teste öğretilmez) ve niyet satırının ardına bir kez eklenir", () => {
    for (const c of DATA.cases) expect(FAULT_RULE_V2.includes(c.message)).toBe(false);
    expect(FAULT_RULE_V2).not.toMatch(/tost|toaster|kettle|Wasserkocher|Kaffeemaschine|Waschmaschine/i);
    const patched = withFaultRule(understandingSystemPromptFor({}), FAULT_RULE_V2);
    expect(patched.split(FAULT_RULE_V2).length).toBe(2);
    expect(patched.indexOf(FAULT_RULE_V2)).toBeGreaterThan(patched.indexOf("- intent: the closest label"));
  });
  it("hakem: eksik grup ve fazla niyet hata sayılır", () => {
    const c = DATA.cases.find((x) => x.id === "b-tr-tost-wifi")!;
    expect(judgeCase(c, ["complaint_issue", "wifi"])).toEqual([]);
    expect(judgeCase(c, ["appliance_help", "wifi"])).toEqual(["eksik complaint_issue"]);
    const h = DATA.cases.find((x) => x.id === "h-tr-tost-nasıl")!;
    expect(judgeCase(h, ["appliance_help", "complaint_issue"])).toEqual(["fazla complaint_issue"]);
    expect(["ariza-cumlesi", "bugunku"]).toContain(promptArm());
  });
});
