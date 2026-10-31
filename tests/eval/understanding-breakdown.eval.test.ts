import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { understandGuestMessages, understandingSystemPromptFor, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
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
  include: string[][];
  exclude?: string[];
}
const DATA = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/understanding-breakdown.json"), "utf8")) as { cases: Case[] };
// Claude kolu (kurucu 10-31: 5.1 kullanılan katmanlarda Haiku 5.5): anlama çağrısı aynı istem + şemayla Claude'a gider.
const CLAUDE = claudeArmFromEnv();
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
    const arm = promptArm();
    const undo = CLAUDE ? installAnthropicReplyShim(CLAUDE.opts, CLAUDE.key) : null;
    const rows: { mode: string; id: string; round: number; ok: boolean; intents: string[]; fails: string[] }[] = [];
    for (const mode of MODES) {
      for (let round = 0; round < ROUNDS; round++) {
        __resetUnderstandingCache();
        for (const c of DATA.cases) {
          const out = await understandGuestMessages({ guestMessage: c.message, history: [{ direction: "inbound", body: c.message }], ...mode.opts });
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
        return `- ${m.id}: toplam ${r.filter((x) => x.ok).length}/${r.length} · arıza bildirimi ${b.filter((x) => x.ok).length}/${b.length} · kullanım sorusu ${h.filter((x) => x.ok).length}/${h.length}`;
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
  it("vakalar eşsiz; her arıza vakası complaint_issue ister, her kullanım vakası onu dışlar", () => {
    const ids = DATA.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DATA.cases) {
      if (c.id.startsWith("b-")) expect(c.include.some((g) => g.includes("complaint_issue"))).toBe(true);
      else expect(c.exclude).toContain("complaint_issue");
    }
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
