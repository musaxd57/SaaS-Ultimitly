import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { understandGuestMessages, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { semanticModel } from "@/lib/ai/semantic/config";

// ---------------------------------------------------------------------------
// KURAL KİPİ NİYET ETİKETİNİ BOZUYOR MU? (#188, 09-26). Ev kuralı gölge kipi (`AI_HOUSE_RULES_SHADOW`) anlama çağrısına iki
// alan ekler; konuşma öğeleri kipi (canlıda açık) öğe türünü NİYETTEN kurar. Konuşma öğeleri ölçümünde (kural kipi) "parti +
// Wi-Fi" mesajının parti isteği `house_rules` yerine `other` etiketi aldı → öğe eşlenemedi → tur tamamen tutuldu (güvenli yön
// ama Wi-Fi cevaplanmadı). Bu ölçüm aynı mesajları iki kipte (öğe · öğe + kural) sorar ve niyet etiketlerini kıyaslar.
// Veri: `evals/house-rules.json` (dev, görüldü) + konuşma öğeleri senaryolarının cevapsız mesajları. Metin rapora girmez.
// İKİ KAPI: RUN_REAL_EVAL=1 + anahtar. ~2 × N anlama çağrısı.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");

interface Msg {
  id: string;
  text: string;
}

function messages(): Msg[] {
  const hr = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/house-rules.json"), "utf8")) as { cases: { id: string; text: string }[] };
  const ci = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/conversation-items.json"), "utf8")) as {
    scenarios: { id: string; unanswered: string[] }[];
  };
  return [...hr.cases.map((c) => ({ id: c.id, text: c.text })), ...ci.scenarios.map((s) => ({ id: `ci-${s.id}`, text: s.unanswered.join("\n") }))];
}

async function intents(text: string, rules: boolean): Promise<string[] | null> {
  const o = await understandGuestMessages({ guestMessage: text, items: true, ...(rules ? { rules: true } : {}) });
  return o.status === "ok" ? o.value.requests.map((r) => r.intent).sort() : null;
}

describe.skipIf(!enabled)("kural kipi — niyet etiketi kıyası (gerçek model)", () => {
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    __resetUnderstandingCache();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
  });

  it("aynı mesaj iki kipte", async () => {
    const msgs = messages();
    const rows: { id: string; items: string[] | null; rules: string[] | null }[] = [];
    let i = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (i < msgs.length) {
          const m = msgs[i++];
          const [a, b] = await Promise.all([intents(m.text, false), intents(m.text, true)]);
          rows.push({ id: m.id, items: a, rules: b });
        }
      }),
    );
    rows.sort((x, y) => x.id.localeCompare(y.id));
    const failed = rows.filter((r) => !r.items || !r.rules).length;
    const changed = rows.filter((r) => r.items && r.rules && r.items.join(",") !== r.rules.join(","));
    const toOther = changed.filter((r) => (r.rules ?? []).filter((x) => x === "other").length > (r.items ?? []).filter((x) => x === "other").length);
    const lines = [
      `# Kural kipi — niyet etiketi kıyası (${new Date().toISOString().slice(0, 10)})`,
      "",
      `Model \`${semanticModel()}\` · mesaj ${rows.length} · düşen ${failed} · niyet kümesi değişen ${changed.length} · "other" artan ${toOther.length}`,
      "",
      "| kimlik | öğe kipi | öğe + kural kipi |",
      "|---|---|---|",
      ...changed.map((r) => `| ${r.id} | ${(r.items ?? []).join(" ")} | ${(r.rules ?? []).join(" ")} |`),
      "",
    ];
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let name = `kural-kipi-niyet-${new Date().toISOString().slice(0, 10)}.md`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) name = `kural-kipi-niyet-${new Date().toISOString().slice(0, 10)}-${n}.md`;
    writeFileSync(path.join(dir, name), lines.join("\n"));
    console.log(`[eval] REPORT=${path.join(dir, name)}`);
    expect(failed).toBeLessThanOrEqual(Math.floor(rows.length * 0.05));
  }, 20 * 60_000);
});
