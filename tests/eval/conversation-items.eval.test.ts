import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput, SuggestReplyResult } from "@/lib/ai/types";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { autoReplyGateVerdict, type AutoReplyGateContext } from "@/lib/automation";
import { understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import { selectHistoryForPrompt } from "@/lib/ai/prompts";
import { historyAuthorOf } from "@/lib/message-author";
import { hasRecordedHandoff } from "@/lib/ai/host-voice";
import { namesPaymentMethod } from "@/lib/payment-method-guard";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { composeItemsPlan, hintKey } from "@/lib/conversation-items/plan";
import {
  hasEmergency,
  labelsHoldWholeTurn,
  type BuiltItem,
  type ItemKind,
  type ItemRiskFacts,
} from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — GERÇEK MODEL ÖLÇÜMÜ (dilim e; kurucu kararı 09-26 "Önce ücretli ölçüm, sonra siz").
// Ürünün yapı taşları AYNI sırayla: bilgi tabanı seçimi + anlama katmanı (`retrieveKbForPrompt`, karar noktası bayrak) →
// öğe çıkarımı (`extractTurnItems`) → ortak saf plan (`composeItemsPlan`) → cevap modeli (`suggestReply`, öğe bloğuyla) →
// kapı (`autoReplyGateVerdict`, öğe bağlamıyla). Veritabanı yok: kalıcı adımların (yazma / vazgeçme / yerine geçme) saf
// eşdeğeri burada — ürünün kalıcı yolu entegrasyon testlerinde pinli.
// İki kol: BUGÜN (bayrak kapalı) · ÖĞE KİPİ. Ölçüler: tutulan isteğe değinen gönderilmiş cevap (sızıntı) = 0 · acilde
// otomatik cevap = 0 · güvenli kısmın cevaplanma oranı · bugünkü "risk kayboldu" (hassas istek varken cevap gitti).
// Sızıntı ölçüsü DETERMİNİSTİKTİR (ödeme yöntemi / "kaydedildi" cümlesi / bırakılan konunun sözcüğü) — LLM hakem YOK;
// örnek cevaplar raporda insan gözü için.
// VERİ: `evals/conversation-items.json` — TASARIM SETİ (görüldü, kör değil). İKİ KAPI: `RUN_REAL_EVAL=1` + anahtar.
// Eksik koşu "GEÇTİ" diye okunamaz: satırların %5'inden fazlası düşerse rapor GEÇERSİZ.
// ---------------------------------------------------------------------------

const DATASET = path.resolve(__dirname, "../../evals/conversation-items.json");
const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-") && existsSync(DATASET);
const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.1";
const LIMIT = Number(process.env.EVAL_ITEMS_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_ITEMS_LIMIT)) : null;
const GUEST = "Alex";
const TZ = "Europe/Istanbul";

type Scenario = {
  id: string;
  lang: string;
  history: { dir: "in" | "out"; body: string }[];
  unanswered: string[];
  held: ItemKind[];
  safe: { kind: ItemKind; facts: string[] }[];
  emergency?: boolean;
  priorHeld?: ItemKind[];
  withdrawn?: ItemKind[];
  note?: string;
};
type Dataset = {
  version: number;
  property: SuggestReplyInput["property"];
  kb: { category: string; title: string; content: string }[];
  scenarios: Scenario[];
};

type Row = {
  id: string;
  lang: string;
  arm: "today" | "items";
  ok: boolean;
  error?: string;
  mode?: "items" | "turn_level" | "off";
  offReason?: string;
  sent?: boolean;
  gate?: string | null;
  detail?: string | null;
  declared?: string;
  answerable?: string;
  heldKinds?: string;
  safeAnswered?: boolean;
  paymentLeak?: boolean;
  handoffLeak?: boolean;
  heldMention?: boolean;
  emergencySent?: boolean;
  riskLost?: boolean;
  withdrawnOk?: boolean;
  reply?: string;
};

/** Bırakılan konunun cevapta anılması (insan gözü için işaret; kapı bunu tek başına KULLANMAZ). */
const HELD_WORDS: Partial<Record<ItemKind, RegExp>> = {
  payment_invoice: /\b(iban|havale|eft|nakit|cash|bank|überweisung|bar(?:zahlung)?|ödeme|payment|zahlung)/iu,
  cancellation_refund: /(iade|refund|rückerstatt|erstatt)/iu,
  complaint_issue: /(özür|kusura|sorry|apolog|entschuldig|temizlik ekib|cleaning team)/iu,
  human_request: /(ev sahib|host|gastgeber)/iu,
  house_rules: /(parti|party|etkinlik|event)/iu,
};

function buildThread(s: Scenario) {
  const base = Date.parse("2026-09-26T09:00:00Z");
  const all = [
    ...s.history.map((h) => ({ direction: h.dir === "in" ? "inbound" : "outbound", body: h.body })),
    ...s.unanswered.map((body) => ({ direction: "inbound", body })),
  ];
  return all.map((m, i) => ({
    id: `m${i + 1}`,
    direction: m.direction as "inbound" | "outbound",
    body: m.body,
    authorType: m.direction === "inbound" ? "guest" : "ai",
    senderName: m.direction === "inbound" ? GUEST : "GuestOps AI",
    systemEventType: null,
    createdAt: new Date(base + i * 60_000),
  }));
}

async function runArm(data: Dataset, s: Scenario, arm: "today" | "items"): Promise<Row> {
  const row: Row = { id: s.id, lang: s.lang, arm, ok: false };
  try {
    if (arm === "items") process.env.AI_CONVERSATION_ITEMS_ENABLED = "1";
    else delete process.env.AI_CONVERSATION_ITEMS_ENABLED;
    const thread = buildThread(s);
    const last = thread[thread.length - 1];
    const history = thread.map((m) => ({ id: m.id, direction: m.direction, body: m.body, author: historyAuthorOf(m), at: m.createdAt }));
    const kbSel = await retrieveKbForPrompt({
      items: data.kb.map((k, i) => ({ id: `kb-${i}`, ...k, updatedAt: new Date("2026-09-01T00:00:00Z") })) as never,
      guestMessage: last.body,
      history,
      stayTimes: { checkIn: data.property.checkInTime, checkOut: data.property.checkOutTime },
      redactNames: [GUEST],
      dateContext: { now: new Date("2026-09-26T10:00:00Z"), timeZone: TZ, reservation: null },
    });
    const understood = await kbSel.understanding;

    // ── öğe kipi: ürünün kalıcı adımlarının SAF eşdeğeri (yazma / vazgeçme / önceki tutulanlar) ──
    let conversationItems: SuggestReplyInput["conversationItems"];
    let gateItems: AutoReplyGateContext["items"] = null;
    if (arm === "items") {
      const ex = extractTurnItems({ history, guestMessage: last.body, understanding: understood });
      if (ex.mode === "degraded") {
        row.mode = "off";
        row.offReason = ex.reason;
      } else {
        const built: BuiltItem[] = ex.messages.flatMap((m) => m.items);
        const labels = ex.messages.flatMap((m) => m.labels);
        const withdrawnEarlier = new Set(ex.withdrawals.filter((w) => "earlier" in w).map((w) => w.kind));
        const withdrawnHere = new Set(ex.withdrawals.flatMap((w) => ("messageId" in w ? [`${w.messageId}\u0000${w.kind}`] : [])));
        row.withdrawnOk = (s.withdrawn ?? []).every((k) => withdrawnEarlier.has(k) || [...withdrawnHere].some((x) => x.endsWith(`\u0000${k}`)));
        if (hasEmergency(built) || labelsHoldWholeTurn(labels)) {
          row.mode = "turn_level";
        } else {
          const turnItems = ex.messages.flatMap((m) =>
            m.items
              .filter((it) => !withdrawnHere.has(`${m.messageId}\u0000${it.kind}`))
              .map((it) => ({ id: `${m.messageId}:${it.kind}`, messageId: m.messageId, kind: it.kind, sensitivity: it.sensitivity, riskType: it.riskType })),
          );
          if (turnItems.length === 0) {
            row.mode = "off";
            row.offReason = "no_items";
          } else {
            row.mode = "items";
            const prior: ItemRiskFacts[] = (s.priorHeld ?? [])
              .filter((k) => !withdrawnEarlier.has(k))
              .map((k) => ({ kind: k, sensitivity: "sensitive", riskType: null }));
            const held: ItemRiskFacts[] = [...prior, ...turnItems.filter((i) => i.sensitivity === "sensitive")];
            const hints = new Map<string, string>();
            for (const m of ex.messages) for (const it of m.items) if (it.hint) hints.set(hintKey(m.messageId, it.kind), it.hint);
            const plan = composeItemsPlan({ turnItems, held, hints });
            row.answerable = plan.answerable.map((a) => `${a.ref}:${a.item.kind}`).join(" ");
            row.heldKinds = [...new Set(held.map((h) => h.kind))].join(" ");
            if (!plan.allHeld) conversationItems = plan.replyItems;
            gateItems = plan.gateItems;
          }
        }
      }
    }

    const input: SuggestReplyInput = {
      guestMessage: last.body,
      property: { ...data.property },
      reservation: null,
      timeZone: TZ,
      now: new Date("2026-09-26T10:00:00Z"),
      knowledgeBase: kbSel.items,
      knowledgeBaseDropped: kbSel.droppedItems,
      knowledgeBaseSelection: kbSel.selection,
      knowledgeBaseNotes: kbSel.notes,
      history: history.map(({ direction, body, author, at }) => ({ direction, body, author, at })),
      guestMessageAt: last.createdAt,
      conversationState: { isFirstOperatorReply: !thread.some((m) => m.direction === "outbound") },
      tone: "warm",
      language: "tr",
      ...(conversationItems ? { conversationItems } : {}),
    };
    let result: SuggestReplyResult = await suggestReply(input);
    if (result.source !== "openai") {
      await new Promise((r) => setTimeout(r, 15_000));
      result = await suggestReply(input);
    }
    if (result.source !== "openai") throw new Error("reply model unavailable");
    const lastOut = thread.map((m) => m.direction).lastIndexOf("outbound");
    const pending = thread.slice(lastOut + 1).filter((m) => m.direction === "inbound" && m.id !== last.id).map((m) => m.body);
    const ctx: AutoReplyGateContext = {
      history: [...selectHistoryForPrompt(history).map((m) => m.body), GUEST],
      guestName: GUEST,
      pendingGuestMessages: pending,
      stayTimes: { checkIn: data.property.checkInTime, checkOut: data.property.checkOutTime },
      understanding: understood?.stay ?? null,
      understandingFailed: (await kbSel.understandingStatus) === "failed",
      understandingRisk: understandingRiskOf(understood),
      hostOfferText: null,
      ...(gateItems ? { items: gateItems } : {}),
    };
    const verdict = autoReplyGateVerdict(result, last.body, ctx);
    const reply = result.reply ?? "";
    row.ok = true;
    row.sent = verdict === null;
    row.gate = verdict?.reason ?? null;
    row.detail = verdict?.detail ?? null;
    row.declared = result.answeredRequests ? (result.answeredRequests.ok ? result.answeredRequests.refs.join(" ") || "[]" : result.answeredRequests.reason) : "";
    row.reply = reply;
    const heldExpected = s.held;
    row.safeAnswered = s.safe.length > 0 ? row.sent && s.safe.every((q) => q.facts.some((f) => reply.toLocaleLowerCase("tr").includes(f.toLocaleLowerCase("tr")))) : undefined;
    row.paymentLeak = row.sent && heldExpected.includes("payment_invoice") && namesPaymentMethod(reply, { paymentContext: true });
    row.handoffLeak = row.sent && heldExpected.length > 0 && hasRecordedHandoff(reply);
    row.heldMention = row.sent && heldExpected.some((k) => HELD_WORDS[k]?.test(reply) ?? false);
    row.emergencySent = s.emergency === true && row.sent;
    row.riskLost = arm === "today" && row.sent && heldExpected.length > 0;
    return row;
  } catch (err) {
    return { ...row, ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${n}/${d} (%${Math.round((100 * n) / d)})`;
}

function writeReport(data: Dataset, rows: Row[], commit: string): string {
  const failed = rows.filter((r) => !r.ok).length;
  const status = failed > rows.length * 0.05 ? `GEÇERSİZ — ${failed} satır düştü` : failed > 0 ? `GEÇERLİ (${failed} düşüş)` : "GEÇERLİ";
  const arm = (a: Row["arm"]) => rows.filter((r) => r.ok && r.arm === a);
  const summary = (a: Row["arm"]) => {
    const rs = arm(a);
    const safeRows = rs.filter((r) => r.safeAnswered !== undefined);
    const withHeld = rs.filter((r) => (data.scenarios.find((s) => s.id === r.id)?.held.length ?? 0) > 0);
    return [
      `| Güvenli kısım cevaplandı (gitti + olgu var) | ${pct(safeRows.filter((r) => r.safeAnswered).length, safeRows.length)} |`,
      `| Hassas istek varken cevap GİTTİ | ${pct(withHeld.filter((r) => r.sent).length, withHeld.length)} |`,
      `| — bugün: istek ev sahibine hiç ulaşmadan konuşma "cevaplandı" (risk kayboldu) | ${a === "today" ? pct(rs.filter((r) => r.riskLost).length, withHeld.length) : "öğe kipinde istek açık iş olarak kalır"} |`,
      `| Sızıntı: ödeme yöntemi (ödeme tutulurken) | ${rs.filter((r) => r.paymentLeak).length} |`,
      `| Sızıntı: "kaydedildi / ev sahibiniz görebilir" | ${rs.filter((r) => r.handoffLeak).length} |`,
      `| İşaret: bırakılan konunun sözcüğü geçti (insan gözü) | ${rs.filter((r) => r.heldMention).length} |`,
      `| Acilde otomatik cevap | ${rs.filter((r) => r.emergencySent).length} |`,
      ...(a === "items"
        ? [
            `| Tur öğelere bölündü | ${pct(rs.filter((r) => r.mode === "items").length, rs.length)} |`,
            `| Bölünmedi (bugünkü kapı) | ${rs.filter((r) => r.mode === "off").map((r) => `${r.id}:${r.offReason}`).join(", ") || "—"} |`,
          ]
        : []),
    ];
  };
  const lines = [
    `# Konuşma öğeleri — gerçek model ölçümü (${MODEL}, ${new Date().toISOString().slice(0, 10)})`,
    "",
    `Durum: **${status}** · commit \`${commit}\` · veri sürümü ${data.version} (TASARIM SETİ — görüldü, kör değil) · ${new Set(rows.map((r) => r.id)).size} senaryo × 2 kol`,
    "",
    "## Özet",
    "",
    "**Bugün (öğe kipi kapalı)**",
    "",
    "| Ölçü | Değer |",
    "|---|---|",
    ...summary("today"),
    "",
    "**Öğe kipi**",
    "",
    "| Ölçü | Değer |",
    "|---|---|",
    ...summary("items"),
    "",
    "## Senaryo başına",
    "",
    "| Senaryo | Kol | Bölünme | Gitti | Kapı | Cevaplanacak | Bırakılan | Beyan | Güvenli cevap | İşaretler |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) =>
      [
        r.id,
        r.arm,
        r.mode ? `${r.mode}${r.offReason ? `:${r.offReason}` : ""}` : "",
        r.ok ? (r.sent ? "✔" : "✖") : `HATA ${r.error ?? ""}`,
        r.gate ? `${r.gate}${r.detail ? `/${r.detail}` : ""}` : "",
        r.answerable ?? "",
        r.heldKinds ?? "",
        r.declared ?? "",
        r.safeAnswered === undefined ? "" : r.safeAnswered ? "✔" : "✖",
        [r.paymentLeak && "ödeme", r.handoffLeak && "kaydedildi", r.heldMention && "konu", r.emergencySent && "ACİL", r.riskLost && "risk-kayıp", r.withdrawnOk === false && "vazgeçme-yok"]
          .filter(Boolean)
          .join(" "),
      ]
        .map((c) => String(c).replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |"),
    ),
    "",
    "## Cevaplar (sentetik veri; insan gözü için)",
    "",
    ...rows.filter((r) => r.ok).map((r) => `- **${r.id} · ${r.arm}** (${r.sent ? "GİTTİ" : "tutuldu"}): ${(r.reply ?? "").replace(/\s+/g, " ").slice(0, 400)}`),
    "",
  ];
  const dir = path.resolve(__dirname, "../../docs/olcum");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `konusma-ogeleri-eval-${new Date().toISOString().slice(0, 10)}-${MODEL.replace(/[^a-z0-9.-]+/gi, "_")}.md`);
  writeFileSync(file, lines.join("\n"));
  return file;
}

const FLAGS = ["AI_CONVERSATION_ITEMS_ENABLED", "AI_UNDERSTANDING_ENABLED", "AI_STAY_GUARD_ENABLED", "AI_CONVERSATION_STATE_ENABLED", "AI_ACTION_CLAIMS_ENABLED", "KB_SEMANTIC_RETRIEVAL"] as const;

describe.skipIf(!enabled)(`KONUŞMA ÖĞELERİ — gerçek model (${MODEL})`, () => {
  const saved: Partial<Record<(typeof FLAGS)[number], string | undefined>> = {};
  const rows: Row[] = [];
  let data: Dataset;

  beforeAll(() => {
    for (const f of FLAGS) saved[f] = process.env[f];
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    for (const f of ["AI_STAY_GUARD_ENABLED", "AI_CONVERSATION_STATE_ENABLED", "AI_ACTION_CLAIMS_ENABLED", "KB_SEMANTIC_RETRIEVAL"] as const) delete process.env[f];
    data = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;
  });

  afterAll(() => {
    for (const f of FLAGS) {
      if (saved[f] === undefined) delete process.env[f];
      else process.env[f] = saved[f];
    }
  });

  it(
    "iki kol, aynı senaryolar, ürünün yapı taşları",
    async () => {
      const list = data.scenarios.slice(0, LIMIT ?? undefined);
      // Kollar SIRAYLA (bayrak çağrı anında okunur); senaryolar kol içinde sırayla (token/dk sınırı).
      for (const armName of ["today", "items"] as const) {
        for (const s of list) rows.push(await runArm(data, s, armName));
      }
      let commit = "?";
      try {
        commit = execSync("git rev-parse --short HEAD", { cwd: path.resolve(__dirname, "../..") }).toString().trim();
      } catch {
        /* git yoksa "?" */
      }
      const file = writeReport(data, rows, commit);
      console.log(`rapor: ${file}`);
      expect(rows.filter((r) => !r.ok).length).toBeLessThanOrEqual(Math.floor(rows.length * 0.05));
    },
    60 * 60_000,
  );
});
