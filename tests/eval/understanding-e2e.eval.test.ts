import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// ---------------------------------------------------------------------------
// ANLAMA ÖLÇÜMÜ — İSTEK BAZLI, GERÇEK MODELLE, UÇTAN UCA (kurucu 10-21; tasarım `docs/TASARIM-2026-10-21-anlama-olcumu.md`).
//
// Ürünün kanal akışı `applyChannelAutoReply` OLDUĞU GİBİ koşar (canlı hat ölçerinin düzeni: ayrı veritabanı, yalnız dışa çıkan uçlar
// yakalanır). Model ayarı ürün profili (`PROD_MODEL_PROFILE`), bayraklar Railway açılış listesi §1. İlişki işareti VARSAYILMAZ: anlama
// katmanının sonucu davranışı değiştirmeyen bir sarmalla OKUNUR. Senaryo başına: modelin çıkardığı istekler (niyet, mesaj, ilişki, özgün
// sorgu) · ev sahibinde açık öğeler · misafire giden metin · iddia denetçisinin istek + iddia hükmü. Puanlama `understanding-e2e-scoring.ts`.
// Modelin güven puanı hiçbir ölçüye girmez.
//
// İKİ KAPI: RUN_REAL_EVAL=1 + gerçek anahtar + EVAL_LIVE_PIPELINE=1 + ayrı yerel veritabanı (TEST_DATABASE_URL, 5433 değil).
// Mühürlü kör set: EVAL_SEALED_FINAL=1 (yalnız tam koşu; rapor yalnız toplu sayı + kimlik basar).
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("eval-token"),
}));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});
// Davranışı değiştirmeyen sarmallar: cevap modelinin girdisi (getirilen bilgi) + ham çıktısı; anlama katmanının sonucu.
vi.mock("@/lib/ai", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai")>();
  return { ...actual, suggestReply: vi.fn(actual.suggestReply) };
});
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandGuestMessages: vi.fn(actual.understandGuestMessages) };
});

import { prisma, resetDb } from "../helpers/db";
import { neutralPadding } from "../helpers/kb-padding";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import { applyChannelAutoReply } from "@/lib/automation";
import { suggestReply } from "@/lib/ai";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { warmPropertyKbVectors } from "@/lib/ai/embeddings/kb-warm";
import { priceFor } from "./reply-scoring";
import { forbiddenIn, productCategory } from "./live-shared";
import { writeSidecar, uniqueReportName } from "./sidecar";
import { evalRuntime } from "./run-meta";
import { applyProdModelProfile } from "./prod-profile";
import { auditReply, JUDGE_MODEL, MEANING_ERRORS, type AuditResult } from "./claim-audit";
import {
  matchRequests,
  relationAgreement,
  requestOutcome,
  scenarioKb,
  spanMessageNumber,
  unansweredMessages,
  validateUxDataset,
  type ModelRequest,
  type RelationAgreement,
  type RequestMatch,
  type RequestOutcome,
  type UxDataset,
  type UxRequest,
  type UxScenario,
} from "./understanding-e2e-scoring";

const SEALED = process.env.EVAL_SEALED_FINAL === "1";
const SET = (process.env.EVAL_UX_SET?.trim() || "understanding-e2e-dev.json").replace(/[^a-z0-9._-]/gi, "");
const SEALED_NAME = "understanding-e2e-blind.json";
const DATASET = SEALED ? path.resolve(__dirname, "../../evals/sealed", SEALED_NAME) : path.resolve(__dirname, "../../evals", SET);

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const dbUrl = process.env.DATABASE_URL ?? "";
const separateDb = /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):(\d+)\//.exec(dbUrl)?.[2] !== "5433" && /localhost|127\.0\.0\.1/.test(dbUrl);
const enabled =
  process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-") && process.env.EVAL_LIVE_PIPELINE === "1" && separateDb;

const datasetBytes = enabled ? readFileSync(DATASET) : Buffer.from('{"version":1,"property":{},"kbSets":{},"scenarios":[]}');
if (SEALED && enabled) {
  // Mühürlü set yalnız SHA-256'sı kayıtla eşleşir ve durumu "sealed" ise; kısmi koşu seti yakar → örnek / süzgeç yasak.
  const seals = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/sealed/SEALS.json"), "utf8")) as Record<string, { sha256?: string; state?: string }>;
  const seal = seals[SEALED_NAME];
  if (!seal || seal.state !== "sealed") throw new Error("mühürlü set 'sealed' durumunda değil (yanmış ya da kayıtsız).");
  if (createHash("sha256").update(datasetBytes).digest("hex") !== seal.sha256) throw new Error("mühürlü setin SHA-256'sı kayıtla eşleşmiyor.");
  if (process.env.EVAL_UX_LIMIT || process.env.EVAL_UX_ONLY) throw new Error("EVAL_UX_LIMIT / EVAL_UX_ONLY mühürlü koşuda kullanılamaz.");
}
const data = JSON.parse(datasetBytes.toString("utf8")) as UxDataset;

const ARM = (process.env.EVAL_UX_ARM?.trim() || "live") as "live" | "topic_absence";
const LIMIT = Number(process.env.EVAL_UX_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_UX_LIMIT)) : Infinity;
const ONLY = new Set((process.env.EVAL_UX_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const TAG = (process.env.EVAL_UX_TAG ?? "").trim().replace(/[^a-z0-9.-]+/gi, "_");
const RPM = Number(process.env.EVAL_UX_RPM) > 0 ? Number(process.env.EVAL_UX_RPM) : 8;
const PAD_TO = process.env.EVAL_UX_PAD === undefined ? 34 : Math.max(0, Math.trunc(Number(process.env.EVAL_UX_PAD) || 0));
const BUDGET_USD = Number(process.env.EVAL_BUDGET_USD) > 0 ? Number(process.env.EVAL_BUDGET_USD) : Infinity;
const TZ = "Europe/Istanbul";
const GUEST = "Alex Doe";

/** Railway açılış listesi §1 (canlıda açık olması gerekenler) — ölçer kendisi yazar; kabuktaki başıboş bayrak ölçümü değiştirmesin. */
const LIVE_FLAGS: Record<string, string> = {
  AUTO_REPLY_ENABLED: "1",
  KB_RETRIEVAL_MODE: "",
  KB_SEMANTIC_RETRIEVAL: "1",
  KB_RERANK_ENABLED: "1",
  KB_RERANK_PER_QUESTION: "",
  KB_RETRIEVAL_WIDE_BUDGET: "",
  AI_UNDERSTANDING_ENABLED: "1",
  AI_STAY_GUARD_ENABLED: "1",
  AI_CONVERSATION_ITEMS_ENABLED: "1",
  AI_HOUSE_RULES_SHADOW: "1",
  HOUSE_RULES_CARD_ENABLED: "1",
  AI_CODE_GREETING_ENABLED: "1",
  AI_HOST_DECISION_HOLD_ENABLED: "1",
  AI_ACCESS_CODE_COMPLETE_ENABLED: "1",
  AI_COMPLAINT_FOLLOWUP_RULE_ENABLED: "1",
  AI_KB_FEE_RULE_ENABLED: "1",
  AI_CONVERSATION_STATE_ENABLED: "",
  AI_ACTION_CLAIMS_ENABLED: "",
  AI_TOPIC_ABSENCE_ENABLED: ARM === "topic_absence" ? "1" : "",
  DURABLE_OUTBOX_ENABLED: "",
  SHADOW_AI_ENABLED: "",
};

const mockSend = vi.mocked(sendOnChannel);
const mockMail = vi.mocked(emailService.sendReporting);
const spySuggest = vi.mocked(suggestReply);
const spyUnderstand = vi.mocked(understandGuestMessages);

// ── Maliyet (canlı hat ölçeriyle aynı kural: her OpenAI yanıtının `usage`ı) ──────────────────────────────────────────────────
interface Usage {
  calls: number;
  in: number;
  cached: number;
  out: number;
  reasoning: number;
}
const usageByModel = new Map<string, Usage>();
function usd(): number {
  let total = 0;
  for (const [m, u] of usageByModel) {
    const p = priceFor(m);
    if (p) total += ((u.in - u.cached) * p.in + u.cached * p.cached + u.out * p.out) / 1e6;
  }
  return total;
}
const realFetch = globalThis.fetch;
function meteredFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> {
  return realFetch(input, init).then(async (res) => {
    if (String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).includes("api.openai.com")) {
      try {
        const j = (await res.clone().json()) as { model?: unknown; usage?: Record<string, unknown> };
        const m = typeof j.model === "string" ? j.model : "unknown";
        const u = j.usage ?? {};
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        const row = usageByModel.get(m) ?? { calls: 0, in: 0, cached: 0, out: 0, reasoning: 0 };
        row.calls += 1;
        row.in += num(u.prompt_tokens);
        row.cached += num((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
        row.out += num(u.completion_tokens);
        row.reasoning += num((u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens);
        usageByModel.set(m, row);
      } catch {
        /* JSON olmayan yanıt: sayılmaz */
      }
    }
    return res;
  });
}

// ── Senaryo kurulumu ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function seed(s: UxScenario): Promise<{ conversationId: string; unansweredIds: string[] }> {
  const now = Date.now();
  const org = await prisma.organization.create({
    data: { name: "Eval Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: TZ },
  });
  await prisma.user.create({
    data: { organizationId: org.id, name: "Eval Owner", email: `owner-${s.id}@example.test`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: data.property.name,
      checkInTime: data.property.checkInTime,
      checkOutTime: data.property.checkOutTime,
      address: data.property.address ?? null,
      city: data.property.city ?? null,
    },
  });
  const kb = scenarioKb(data, s);
  const t0 = Date.UTC(2026, 8, 1);
  await prisma.knowledgeBaseItem.createMany({
    data: [
      ...kb.map((k, i) => ({ category: productCategory(k.category), title: k.title, content: k.content, updatedAt: new Date(t0 - i * 60_000) })),
      ...neutralPadding(Math.max(0, PAD_TO - kb.length), t0 - kb.length * 60_000).map((p) => ({
        category: p.category,
        title: p.title,
        content: p.content,
        updatedAt: p.updatedAt,
      })),
    ].map((k) => ({ ...k, propertyId: property.id, isActive: true, source: "host_manual", reviewState: "approved" })),
  });
  const day = 86_400_000;
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: GUEST,
      guestGivenName: "Alex",
      guestNameSource: "channel",
      arrivalDate: new Date(now - day),
      departureDate: new Date(now + 3 * day),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: `res-${s.id}`,
    },
  });
  const history = s.history ?? [];
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: GUEST,
      status: "new",
      externalReservationId: `res-${s.id}`,
      messages: {
        create: [
          ...history.map((h, i) => ({
            direction: h.direction,
            senderName: h.direction === "inbound" ? GUEST : "GuestOps AI",
            ...(h.direction === "outbound" ? { authorType: "ai" } : {}),
            body: h.body,
            createdAt: new Date(now - (history.length - i + 1) * 10 * 60_000),
          })),
          { direction: "inbound", senderName: GUEST, body: s.message, createdAt: new Date(now - 60_000) },
        ],
      },
    },
    select: { id: true },
  });
  // Cevapsız misafir mesajlarının kimlikleri (anlama isteminin [1]..[n] sırası).
  const inbound = await prisma.message.findMany({
    where: { conversationId: conversation.id, direction: "inbound" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, body: true },
  });
  const unanswered = unansweredMessages(s);
  const unansweredIds = inbound.slice(inbound.length - unanswered.length).map((m) => m.id);
  await warmPropertyKbVectors(property.id);
  return { conversationId: conversation.id, unansweredIds };
}

// ── Koşu ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface ReqRow {
  id: string;
  expect: UxRequest["expect"];
  relation: UxRequest["relation"];
  match: RequestMatch;
  relationAgreement: RelationAgreement;
  outcome: RequestOutcome;
  addressed: string | null;
  itemStatus: string | null;
  factVerdicts: string[];
  wrongBindings: number;
  judgeErrors: { text: string; support: string; explanation: string }[];
}
interface Row {
  id: string;
  lang: string;
  tags: string[];
  pair: string | null;
  ok: boolean;
  error?: string;
  sent: boolean;
  sentText: string | null;
  draft: string | null;
  skippedReason: string | null;
  gateDetail: string | null;
  status: string | null;
  emails: number;
  understanding: "ok" | "failed" | "off" | "missing";
  modelRequests: ModelRequest[];
  extraRequests: ModelRequest[];
  items: { kind: string; status: string; sensitivity: string; message: number | null }[];
  /** Cevap modeline giden bilgi kalemleri (senaryo kimliğiyle; dolgu sayılmaz). */
  retrieved: string[];
  judge: "ok" | "failed" | "skipped";
  claims: { request: string; support: string; relation: string; subject: string; value: string; text: string; explanation: string }[];
  forbiddenSent: boolean;
  requests: ReqRow[];
  ms: number;
}

let lastStart = 0;
async function throttle(): Promise<void> {
  const wait = lastStart + 60_000 / RPM - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
}

const OPEN = new Set(["open", "pending_host"]);

async function runOnce(s: UxScenario): Promise<Row> {
  await resetDb();
  mockSend.mockReset();
  mockSend.mockResolvedValue({ ok: true, externalId: `ext-${s.id}` } as never);
  mockMail.mockClear();
  spySuggest.mockClear();
  spyUnderstand.mockClear();
  const kb = scenarioKb(data, s);
  const { conversationId, unansweredIds } = await seed(s);
  const t0 = Date.now();
  const out = await applyChannelAutoReply(conversationId);
  const ms = Date.now() - t0;
  const sentText = mockSend.mock.calls.length > 0 ? String(mockSend.mock.calls[0][1]) : null;
  const sent = out.sent === true && sentText !== null;

  // Anlama katmanının SON başarılı sonucu (öğe kipinin çağrısı; ilişki işareti modelden).
  let understanding: Row["understanding"] = "missing";
  let modelRequests: ModelRequest[] = [];
  for (const r of spyUnderstand.mock.results) {
    if (r.type !== "return") continue;
    const v = await (r.value as ReturnType<typeof understandGuestMessages>);
    if (v.status === "ok") {
      understanding = "ok";
      modelRequests = v.value.requests.map((q) => ({
        intent: q.intent,
        queryOriginal: q.queryOriginal,
        queryTr: q.queryTr,
        ...(q.message !== undefined ? { message: q.message } : {}),
        ...(q.relation !== undefined ? { relation: q.relation } : {}),
      }));
    } else if (understanding !== "ok") understanding = v.status;
  }

  const lastModel = spySuggest.mock.results.at(-1);
  const raw = lastModel?.type === "return" ? await (lastModel.value as ReturnType<typeof suggestReply>) : null;
  const draft = raw?.source === "openai" ? raw.reply : null;
  const replyInput = spySuggest.mock.calls.at(-1)?.[0] as { knowledgeBase?: { title: string }[] } | undefined;
  const retrieved = (replyInput?.knowledgeBase ?? [])
    .map((k) => kb.find((x) => x.title === k.title)?.id)
    .filter((x): x is string => typeof x === "string");

  const ev = await prisma.riskEvent.findFirst({
    where: { conversationId, surface: "auto_reply" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { kbEvidenceJson: true },
  });
  let gateDetail: string | null = null;
  try {
    gateDetail = (JSON.parse(String(ev?.kbEvidenceJson ?? "{}")) as { g?: { d?: string } }).g?.d ?? null;
  } catch {
    gateDetail = null;
  }
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { status: true } });
  const items = await prisma.conversationItem.findMany({
    where: { conversationId },
    select: { kind: true, status: true, sensitivity: true, messageId: true },
  });
  const itemRows = items.map((i) => ({
    kind: i.kind,
    status: i.status,
    sensitivity: i.sensitivity,
    message: unansweredIds.indexOf(i.messageId) >= 0 ? unansweredIds.indexOf(i.messageId) + 1 : null,
  }));

  const scored = s.requests.filter((r) => r.expect !== "none");
  let audit: AuditResult | null = null;
  let judge: Row["judge"] = "skipped";
  if (sent && sentText) {
    audit = await auditReply(
      { kb, history: s.history ?? [], message: s.message, requests: scored.map((r) => ({ id: r.id, span: r.span })), reply: sentText },
      key,
    );
    judge = audit ? "ok" : "failed";
  }

  const { matches, extra } = matchRequests(s, modelRequests);
  const emails = mockMail.mock.calls.length;
  const conversationOpen = conv?.status === "new" || conv?.status === "problem";
  const requests: ReqRow[] = s.requests.map((r, idx) => {
    const m = matches[idx];
    const n = spanMessageNumber(s, r.span);
    // İsteğin öğesi: aynı mesaj + kabul edilen niyet; bağlı soru asıl talebe katıldıysa o talebin öğesi.
    const own = itemRows.filter((i) => (n === null || i.message === n) && r.intents.includes(i.kind));
    const anchor = m.extraction === "merged" ? itemRows.filter((i) => (n === null || i.message === n) && ["complaint_issue", "cancellation_refund", "human_request", "emergency"].includes(i.kind)) : [];
    const pool = own.length > 0 ? own : anchor;
    const itemOpen = pool.length > 0 ? pool.some((i) => OPEN.has(i.status)) : null;
    const judged = audit?.requests.find((q) => q.id === r.id) ?? null;
    const judgeErrors = (audit?.claims ?? [])
      .filter((c) => c.requestId === r.id && MEANING_ERRORS.has(c.support))
      .map((c) => ({ text: c.text, support: c.support, explanation: c.explanation }));
    const res = requestOutcome(r, {
      sent,
      sentText,
      addressed: judged ? judged.addressed : null,
      judgeErrors: judgeErrors.length,
      itemOpen,
      conversationOpen,
      escalated: conv?.status === "problem",
      emails,
    });
    return {
      id: r.id,
      expect: r.expect,
      relation: r.relation,
      match: m,
      relationAgreement: relationAgreement(r.relation, m),
      outcome: res.outcome,
      addressed: judged?.addressed ?? null,
      itemStatus: pool.length > 0 ? pool.map((i) => i.status).join("+") : null,
      factVerdicts: res.facts.facts.map((f) => f.verdict),
      wrongBindings: res.facts.wrong,
      judgeErrors,
    };
  });
  return {
    id: s.id,
    lang: s.lang,
    tags: s.tags ?? [],
    pair: s.pair ?? null,
    ok: out.skippedReason !== "ai_unavailable" && understanding !== "failed" && judge !== "failed",
    sent,
    sentText,
    draft,
    skippedReason: out.skippedReason ?? null,
    gateDetail,
    status: conv?.status ?? null,
    emails,
    understanding,
    modelRequests,
    extraRequests: extra.map((i) => modelRequests[i]),
    items: itemRows,
    retrieved,
    judge,
    claims: (audit?.claims ?? []).map((c) => ({
      request: c.requestId,
      support: c.support,
      relation: c.relation,
      subject: c.subject,
      value: c.value,
      text: c.text,
      explanation: c.explanation,
    })),
    forbiddenSent: sentText ? forbiddenIn(s.forbidden, sentText) : false,
    requests,
    ms,
  };
}

async function runOne(s: UxScenario): Promise<Row> {
  await throttle();
  try {
    let r = await runOnce(s);
    if (!r.ok) {
      await new Promise((res) => setTimeout(res, 20_000));
      await throttle();
      r = await runOnce(s);
    }
    return r;
  } catch (err) {
    if (process.env.EVAL_LIVE_DEBUG === "1") console.error("[ux-debug]", err instanceof Error ? err.message.slice(0, 1500) : err);
    return {
      id: s.id, lang: s.lang, tags: s.tags ?? [], pair: s.pair ?? null, ok: false, error: err instanceof Error ? err.name : "error",
      sent: false, sentText: null, draft: null, skippedReason: null, gateDetail: null, status: null, emails: 0, understanding: "missing",
      modelRequests: [], extraRequests: [], items: [], retrieved: [], judge: "skipped", claims: [], forbiddenSent: false, requests: [], ms: 0,
    };
  }
}

// ── Rapor ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const pct = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);

/** İstek doğru mu: cevap → doğru (olgu doğrulanmamış dahil); tut → ev sahibinde açık; acil → acil yolu. */
export function requestCorrect(r: Pick<ReqRow, "expect" | "outcome">): boolean | null {
  if (r.expect === "none") return null;
  if (r.expect === "answer") return r.outcome === "ok" || r.outcome === "ok_unverified";
  if (r.expect === "hold") return r.outcome === "held_open";
  return r.outcome === "emergency_ok";
}

export function summarizeUx(rows: Row[]): string[] {
  const ok = rows.filter((r) => r.ok);
  const reqs = ok.flatMap((r) => r.requests.map((q) => ({ ...q, scenario: r.id, tags: r.tags, lang: r.lang })));
  const scored = reqs.filter((q) => q.expect !== "none");
  const by = (e: string) => scored.filter((q) => q.expect === e);
  const count = (xs: typeof scored, o: RequestOutcome) => xs.filter((q) => q.outcome === o).length;
  const ans = by("answer");
  const hold = by("hold");
  const em = by("emergency");
  const rel = scored.filter((q) => q.relationAgreement !== "not_scored");
  const relOf = (e: string, a: RelationAgreement) => rel.filter((q) => q.relation === e && q.relationAgreement === a).length;
  const relN = (e: string) => rel.filter((q) => q.relation === e).length;
  const found = scored.filter((q) => q.match.extraction === "found");
  const claims = ok.filter((r) => r.sent).flatMap((r) => r.claims);
  const claimN = (s: string) => claims.filter((c) => c.support === s).length;
  const pairs = new Map<string, Row[]>();
  for (const r of ok) if (r.pair) pairs.set(r.pair, [...(pairs.get(r.pair) ?? []), r]);
  const rowCorrect = (r: Row) => r.requests.every((q) => requestCorrect(q) !== false);
  const fullPairs = [...pairs.values()].filter((p) => p.length === 2);
  const tags = [...new Set(ok.flatMap((r) => r.tags))].sort();
  const langs = [...new Set(ok.map((r) => r.lang))].sort();
  return [
    "### Anlama (modelin kendisi — ilişki işareti varsayılmadı)",
    "",
    "| ölçü | değer |",
    "|---|---|",
    `| beklenen istek bulundu (niyet + mesaj) | ${pct(found.length, scored.length)} |`,
    `| bağlı soru asıl talebe katıldı (istem tasarımı, uyumlu) | ${pct(scored.filter((q) => q.match.extraction === "merged").length, scored.length)} |`,
    `| 🚨 kaçan istek | ${pct(scored.filter((q) => q.match.extraction === "missed").length, scored.length)} |`,
    `| fazla istek (beklenende karşılığı yok) | ${ok.reduce((a, r) => a + r.extraRequests.length, 0)} |`,
    `| dayanak izi: modelin özgün sorgusu beklenen parçayla örtüşüyor (tanı) | ${pct(found.filter((q) => q.match.traceable).length, found.length)} |`,
    `| ilişki — bağımsız: doğru / gereksiz bağlı-belirsiz | ${relOf("independent", "agree")}/${relN("independent")} · ${relOf("independent", "safe_disagree")} |`,
    `| ilişki — bağlı: doğru / belirsiz / 🚨 "kendi konusu" | ${relOf("dependent", "agree")}/${relN("dependent")} · ${relOf("dependent", "safe_disagree")} · ${relOf("dependent", "unsafe_disagree")} |`,
    `| ilişki — belirsiz: doğru / 🚨 "kendi konusu" | ${relOf("ambiguous", "agree")}/${relN("ambiguous")} · ${relOf("ambiguous", "unsafe_disagree")} |`,
    "",
    "### Son misafir sonucu (istek bazında)",
    "",
    "| beklenen | sonuç | değer |",
    "|---|---|---|",
    `| cevap | doğru (olgu bağı doğrulandı) | ${pct(count(ans, "ok"), ans.length)} |`,
    `| cevap | doğru ama yazılmış olgu bulunamadı (denetçi karşıladı dedi, anlam hatası yok) | ${pct(count(ans, "ok_unverified"), ans.length)} |`,
    `| cevap | 🚨 yanlış bilgi (yanlış bağ / çelişen / desteksiz) | ${pct(count(ans, "wrong_info"), ans.length)} |`,
    `| cevap | gereksiz tutuldu — ev sahibinde açık | ${pct(count(ans, "held_open"), ans.length)} |`,
    `| cevap | 🚨 gereksiz tutuldu — sessiz düştü (ne cevap ne açık konu) | ${pct(count(ans, "held_dropped"), ans.length)} |`,
    `| tut | doğru tutuldu — ev sahibinde açık | ${pct(count(hold, "held_open"), hold.length)} |`,
    `| tut | 🚨 serbest kaldı (misafire içerik olarak cevaplandı) | ${pct(count(hold, "leaked"), hold.length)} |`,
    `| tut | 🚨 tutuldu ama sessiz düştü | ${pct(count(hold, "held_dropped"), hold.length)} |`,
    `| acil | acil yolu (Sorunlu + e-posta, içerik gitmedi) | ${pct(count(em, "emergency_ok"), em.length)} |`,
    `| acil | 🚨 içerik gitti / 🚨 acil yolu çalışmadı | ${count(em, "emergency_leak")} / ${count(em, "emergency_missed")} |`,
    `| çift | aynı sözcük / farklı anlam: iki senaryo da doğru | ${pct(fullPairs.filter((p) => p.every(rowCorrect)).length, fullPairs.length)} |`,
    `| senaryo | bütün istekleri doğru | ${pct(ok.filter(rowCorrect).length, ok.length)} |`,
    `| 🚨 yasak dize misafire giden | ${ok.filter((r) => r.forbiddenSent).length} | |`,
    "",
    "### Cevabın anlamı — iddia denetçisi (misafire giden cevaplar)",
    "",
    "| destek | sayı |",
    "|---|---|",
    ...["supported", "misbound", "contradicted", "unsupported", "unverified", "process"].map((s) => `| ${s} | ${claimN(s)} |`),
    `| denetçi düştü | ${rows.filter((r) => r.judge === "failed").length} |`,
    "",
    "### Etiket / dil kırılımı (istek doğru)",
    "",
    "| kırılım | doğru |",
    "|---|---|",
    ...tags.map((t) => {
      const xs = scored.filter((q) => q.tags.includes(t));
      return `| ${t} | ${pct(xs.filter((q) => requestCorrect(q) === true).length, xs.length)} |`;
    }),
    ...langs.map((l) => {
      const xs = scored.filter((q) => q.lang === l);
      return `| dil ${l} | ${pct(xs.filter((q) => requestCorrect(q) === true).length, xs.length)} |`;
    }),
  ];
}

function detailLines(rows: Row[]): string[] {
  const out: string[] = ["", "## Hatalı istekler (ayrıntı)", ""];
  for (const r of rows) {
    const bad = r.requests.filter((q) => requestCorrect(q) === false);
    if (r.ok && bad.length === 0) continue;
    const s = data.scenarios.find((x) => x.id === r.id);
    out.push(`### ${r.id} (${r.lang}${r.pair ? `, çift ${r.pair}` : ""}) — ${r.ok ? "" : `DÜŞTÜ ${r.error ?? ""} `}durum ${r.status ?? "?"}, gitti ${r.sent ? "evet" : "hayır"}${r.skippedReason ? `, ${r.skippedReason}` : ""}${r.gateDetail ? ` (${r.gateDetail})` : ""}`);
    if (s) out.push(`- mesaj: ${JSON.stringify(s.message)}${s.history?.length ? ` · geçmiş ${s.history.length}` : ""}`);
    out.push(`- model istekleri: ${r.modelRequests.map((m) => `${m.intent}/${m.relation ?? "-"}@${m.message ?? "?"} "${m.queryOriginal}"`).join(" · ") || "(yok)"}`);
    out.push(`- öğeler: ${r.items.map((i) => `${i.kind}:${i.status}@${i.message ?? "?"}`).join(" · ") || "(yok)"} · getirilen: ${r.retrieved.join(",") || "(yok)"}`);
    for (const q of bad) {
      const req = s?.requests.find((x) => x.id === q.id);
      out.push(
        `- **${q.id}** beklenen ${q.expect}/${q.relation} → **${q.outcome}** · çıkarım ${q.match.extraction}${q.match.modelIntent ? ` (${q.match.modelIntent}/${q.match.modelRelation ?? "-"})` : ""} · denetçi ${q.addressed ?? "-"} · öğe ${q.itemStatus ?? "-"} · olgu ${q.factVerdicts.join(",") || "-"} · yanlış bağ ${q.wrongBindings}${req ? ` · parça ${JSON.stringify(req.span)}` : ""}`,
      );
      for (const e of q.judgeErrors) out.push(`  - ${e.support}: ${JSON.stringify(e.text)} — ${e.explanation}`);
    }
    if (r.sentText) out.push(`- giden: ${JSON.stringify(r.sentText)}`);
    else if (r.draft) out.push(`- taslak (gitmedi): ${JSON.stringify(r.draft)}`);
    out.push("");
  }
  return out;
}

describe.skipIf(!enabled)(`ANLAMA ÖLÇÜMÜ — ${SEALED ? "mühürlü kör set" : SET} — kol ${ARM}`, () => {
  const rows: Row[] = [];
  let stoppedForBudget = false;
  const scenarios = data.scenarios
    .filter((s) => ONLY.size === 0 || ONLY.has(s.id))
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  beforeAll(() => {
    applyProdModelProfile();
    for (const [k, v] of Object.entries(LIVE_FLAGS)) vi.stubEnv(k, v);
    globalThis.fetch = meteredFetch as typeof fetch;
  });

  afterAll(() => {
    const runtime = evalRuntime();
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    if (rows.length === 0) return;
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const setTag = SEALED ? "kor" : SET.replace(/\.json$/, "").replace(/^understanding-e2e-?/, "") || "dev";
    const name = uniqueReportName(dir, `anlama-e2e-${setTag}-${ARM}-${stamp}${TAG ? `-${TAG}` : ""}.md`);
    const failed = rows.filter((r) => !r.ok).length;
    const status = stoppedForBudget
      ? `EKSİK — bütçe tavanı ($${BUDGET_USD}) nedeniyle ${scenarios.length - rows.length} senaryo koşmadı`
      : failed > Math.max(1, rows.length * 0.03)
        ? `GEÇERSİZ — ${failed} satır düştü`
        : "GEÇERLİ";
    const lines = [
      `# Anlama ölçümü — ${SEALED ? "mühürlü kör set" : SET} — kol ${ARM} (${stamp})`,
      "",
      `Durum: **${status}** · senaryo ${rows.length}/${scenarios.length} · istek ${rows.reduce((a, r) => a + r.requests.filter((q) => q.expect !== "none").length, 0)} · denetçi ${JUDGE_MODEL} · tahmini maliyet $${usd().toFixed(2)}`,
      "",
      "Tasarım: `docs/TASARIM-2026-10-21-anlama-olcumu.md`. Ürün akışı `applyChannelAutoReply` gerçek modelle; ilişki işareti modelden okunur (varsayılmaz); modelin güven puanı ölçüye girmez.",
      "",
      ...summarizeUx(rows),
      "",
      "### Model kullanımı",
      "",
      "| model | çağrı | girdi | önbellek | çıktı | düşünme |",
      "|---|---|---|---|---|---|",
      ...[...usageByModel].map(([m, u]) => `| ${m} | ${u.calls} | ${u.in} | ${u.cached} | ${u.out} | ${u.reasoning} |`),
      ...(SEALED
        ? ["", "Mühürlü set: ayrıntı basılmaz. Hatalı senaryo kimlikleri: " + rows.filter((r) => !r.ok || r.requests.some((q) => requestCorrect(q) === false)).map((r) => r.id).join(", ")]
        : detailLines(rows)),
    ];
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`, "utf8");
    writeSidecar(dir, name, {
      suite: "understanding-e2e",
      version: data.version,
      meta: { set: SEALED ? SEALED_NAME : SET, sealed: SEALED, arm: ARM, judge: JUDGE_MODEL, status, usd: Number(usd().toFixed(3)) },
      rows,
      runtime,
    });
  });

  it("veri seti geçerli", () => {
    expect(validateUxDataset(data)).toEqual([]);
  });

  it(
    "senaryolar",
    async () => {
      for (const s of scenarios) {
        if (usd() >= BUDGET_USD) {
          stoppedForBudget = true;
          break;
        }
        rows.push(await runOne(s));
      }
      expect(rows.length).toBeGreaterThan(0);
    },
    6 * 60 * 60 * 1000,
  );
});
