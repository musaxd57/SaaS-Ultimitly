import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildUnderstandingUserContent, understandingSystemPromptFor } from "@/lib/ai/semantic/understand";
import { callStructuredJson } from "@/lib/ai/semantic/structured-call";
import { semanticApiKey, semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";

// ---------------------------------------------------------------------------
// ACİL NUMARA ÖLÇÜMÜ — MODEL NEDEN HATA YAPTI? (kurucu 10-11: "modeli nasıl hata yapıyor, neden hata yaptığını açıklasın, neyden
// etkilendiğini söylesin"). Son `acil-numara-*.json` koşusunda yanlış ayrılan (ev sahibine bırakılması gerekirken yalnız "acil" denen)
// satırlar ve karşılaştırma için doğru bırakılan iki satır, AYNI anlama talimatlarıyla birlikte modele geri verilir; model kendi
// etiketlerini, onu etkileyen sözcükleri ve ev sahibi şikâyeti etiketini neden koymadığını açıklar.
// ⚠️ Bu bir SONRADAN AÇIKLAMADIR: modelin anlattığı gerekçe, ilk çağrıdaki gerçek iç nedenin kanıtı DEĞİLDİR (rapora yazılır).
// İKİ KAPI: RUN_REAL_EVAL=1 + anahtar. ~6 çağrı.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");

const HOLD = new Set(["complaint_issue", "cancellation_refund", "human_request"]);

const SCHEMA = {
  name: "explain_labels",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["influencedBy", "whyEmergency", "whyNoHostComplaint", "betterLabels"],
    properties: {
      influencedBy: { type: "array", items: { type: "string" }, description: "Etiketi belirleyen sözcükler / ifadeler (misafir metninden aynen)" },
      whyEmergency: { type: "string", description: "Neden 'emergency' etiketi verildi (kısa)" },
      whyNoHostComplaint: { type: "string", description: "Ev sahibi şikâyeti / iade / insan talebi etiketi neden verilmedi ya da verildi (kısa)" },
      betterLabels: { type: "array", items: { type: "string" }, description: "Şimdi tekrar baksan hangi niyet etiketlerini verirdin" },
    },
  },
};

describe.skipIf(!enabled)("acil numara — yanlış ayrılan vakalarda modelin açıklaması (gerçek model)", () => {
  it("açıkla", async () => {
    const dir = path.resolve(__dirname, "../../docs/olcum");
    const latest = readdirSync(dir).filter((f) => /^acil-numara-.*\.json$/.test(f) && !f.includes("aciklama")).sort().pop();
    expect(latest).toBeDefined();
    const run = JSON.parse(readFileSync(path.join(dir, latest!), "utf8")) as {
      rows: { id: string; rep: number; expect: string; intents: string[] }[];
    };
    const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/emergency-number.json"), "utf8")) as {
      scenarios: { id: string; text: string }[];
    };
    const textOf = new Map(data.scenarios.map((s) => [s.id, s.text]));
    const wrong = run.rows.filter((r) => r.expect === "hold" && !r.intents.some((i) => HOLD.has(i)));
    const controls = run.rows.filter((r) => r.expect === "hold" && r.intents.some((i) => HOLD.has(i))).slice(0, 2);
    const picked = [...wrong, ...controls];
    const system = understandingSystemPromptFor({ items: true });
    const out: { id: string; rep: number; kind: string; intents: string[]; explanation: unknown }[] = [];
    for (const r of picked) {
      const guest = textOf.get(r.id) ?? "";
      const user = [
        "Aşağıda, yukarıdaki anlama talimatlarınla daha önce etiketlediğin bir misafir mesajı ve senin verdiğin niyet etiketleri var.",
        "Bu etiketleri neden verdiğini açıkla: seni hangi sözcükler etkiledi, 'emergency' neden, ev sahibi şikâyeti / iade / insan talebi",
        "(complaint_issue / cancellation_refund / human_request) neden verilmedi ya da verildi. Şimdi tekrar baksan hangi etiketleri verirdin?",
        "",
        "--- ANLAMA GİRDİSİ ---",
        buildUnderstandingUserContent({ guestMessage: guest, items: true }),
        "--- VERDİĞİN ETİKETLER ---",
        JSON.stringify(r.intents),
      ].join("\n");
      const res = await callStructuredJson({
        apiKey: semanticApiKey() ?? key,
        model: semanticModel("understanding"),
        system,
        user,
        schema: SCHEMA,
        timeoutMs: 120_000,
        maxTokens: 600,
        maxCompletionTokens: 4_000,
        reasoningEffort: semanticReasoningEffort("understanding"),
      });
      out.push({ id: r.id, rep: r.rep, kind: wrong.includes(r) ? "yanlış" : "kontrol", intents: r.intents, explanation: res.ok ? res.data : { error: "çağrı başarısız" } });
    }
    const stem = latest!.replace(/\.json$/, "-aciklama");
    writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify({ source: latest, model: semanticModel("understanding"), out }, null, 1));
    const md = [
      `# Acil numara — modelin kendi açıklaması (${semanticModel("understanding")})`,
      "",
      `Kaynak koşu: \`${latest}\`. ⚠️ Sonradan açıklama: modelin anlattığı gerekçe ilk etiketlemedeki gerçek iç nedenin kanıtı değildir.`,
      "",
      ...out.flatMap((o) => {
        const e = o.explanation as { influencedBy?: string[]; whyEmergency?: string; whyNoHostComplaint?: string; betterLabels?: string[]; error?: string };
        return [
          `## ${o.id} (tekrar ${o.rep + 1}) — ${o.kind}`,
          "",
          `- Misafir: "${textOf.get(o.id)}"`,
          `- Verdiği etiketler: ${o.intents.join(", ") || "—"}`,
          e.error ? `- ${e.error}` : `- Etkilendiği sözcükler: ${(e.influencedBy ?? []).join(" · ")}`,
          e.error ? "" : `- Neden "acil": ${e.whyEmergency}`,
          e.error ? "" : `- Ev sahibi şikâyeti / iade etiketi: ${e.whyNoHostComplaint}`,
          e.error ? "" : `- Şimdi verirdiği etiketler: ${(e.betterLabels ?? []).join(", ")}`,
          "",
        ];
      }),
    ].join("\n");
    writeFileSync(path.join(dir, `${stem}.md`), `${md}\n`);
    expect(out.length).toBe(picked.length);
  }, 900_000);
});
