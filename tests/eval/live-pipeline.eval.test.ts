import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

// ---------------------------------------------------------------------------
// CANLI HAT — MİSAFİRE GERÇEKTEN GİDECEK CEVAP (kurucu 09-30: "canlı geçişten önce bugünkü üretim RAG'ı ve gönderim kapılarıyla,
// misafire gerçekten gidecek cevabı da ölç").
//
// Ürünün kanal oto-yanıt akışı `applyChannelAutoReply` OLDUĞU GİBİ koşar: gerçek veritabanı (AYRI port — test veritabanı 5433'e
// DOKUNMAZ, `vitest.eval-live.config.ts`), canlının bayrakları (anlamsal getirme + yeniden sıralayıcı + anlama katmanı + bekçi +
// konuşma öğeleri + ev kuralı gölgesi) ve TÜM katmanlarda gerçek model çağrıları. Yalnız dışarıya çıkan uçlar yakalanır: kanal
// gönderimi (`sendOnChannel` — misafire giden metin buradan okunur), e-posta, sağlayıcı kimliği, alarm. Hiçbir şey kimseye gitmez.
//
// Senaryolar sözcüksel cevap kıyasıyla AYNI (`evals/model-reply-compare.json`); puanlama ortak (`reply-scoring.ts`). Bilgi tabanı,
// üretimde seçimin devreye girdiği boyuta NÖTR dolguyla taşınır (≤30 kalemde seçim yapılmaz; `tests/helpers/kb-padding.ts` emsali) —
// yani gömme + yeniden sıralayıcı gerçekten koşar. `EVAL_LIVE_PAD=0` dolgusuz (küçük bilgi tabanı = tüm küme).
//
// Maliyet her OpenAI yanıtının `usage` alanından (cevap + anlama + bekçi + sıralayıcı + gömme; yeniden denemeler ve gizli düşünme
// dahil) toplanır; `EVAL_BUDGET_USD` aşılınca yeni senaryo BAŞLAMAZ, rapor "EKSİK" der. Canlı model / bayrak DEĞİŞMEZ — yalnız bu
// süreçte ortam değişkeni.
// İKİ KAPI: RUN_REAL_EVAL=1 + gerçek anahtar + EVAL_LIVE_PIPELINE=1 + ayrı test veritabanı (TEST_DATABASE_URL, 5433 değil).
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
// Cevap modelinin HAM çıktısı (gitse de gitmese de) — davranışı değiştirmeyen sarmal: kapının etkisi ile model kalitesi ayrılsın.
vi.mock("@/lib/ai", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai")>();
  return { ...actual, suggestReply: vi.fn(actual.suggestReply) };
});

import { prisma, resetDb } from "../helpers/db";
import { neutralPadding } from "../helpers/kb-padding";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import { applyChannelAutoReply } from "@/lib/automation";
import { suggestReply } from "@/lib/ai";
import { warmPropertyKbVectors } from "@/lib/ai/embeddings/kb-warm";
import { MUST_HOLD, factsHit, languageMatches, priceFor } from "./reply-scoring";
import { GREETING, promiseInReply } from "./reply-metrics";
import { writeSidecar } from "./sidecar";

interface Scenario {
  id: string;
  class: string;
  lang: string;
  kb: "full" | "sparse";
  history?: { direction: "inbound" | "outbound"; body: string }[];
  message: string;
  expect: { autoSend: "yes" | "no" | "any"; facts?: string[] };
}
interface Dataset {
  version: number;
  property: { name: string; checkInTime: string; checkOutTime: string; address?: string; city?: string };
  kbSets: Record<"full" | "sparse", { category: string; title: string; content: string }[]>;
  scenarios: Scenario[];
}

const DATASET = path.resolve(__dirname, "../../evals/model-reply-compare.json");
const data = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const dbUrl = process.env.DATABASE_URL ?? "";
/** Ayrı veritabanı ZORUNLU: 5433 test harness'ının (tam kapılar) veritabanıdır — orada koşmak kapıların koşusunu bozar. */
const separateDb = /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):(\d+)\//.exec(dbUrl)?.[2] !== "5433" && /localhost|127\.0\.0\.1/.test(dbUrl);
const enabled =
  process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-") && process.env.EVAL_LIVE_PIPELINE === "1" && separateDb;

const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.1";
const LIMIT = Number(process.env.EVAL_LIVE_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_LIVE_LIMIT)) : Infinity;
const ONLY = new Set((process.env.EVAL_LIVE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const TAG = (process.env.EVAL_LIVE_TAG ?? "").trim().replace(/[^a-z0-9.-]+/gi, "_");
/** Senaryo / dakika (her senaryo birkaç model çağrısı; canlı hesapla dakikalık token sınırı paylaşılır). */
const RPM = Number(process.env.EVAL_LIVE_RPM) > 0 ? Number(process.env.EVAL_LIVE_RPM) : 8;
/** Bilgi tabanını bu kalem sayısına NÖTR dolguyla taşı (≤30 kalemde üretim seçim yapmaz). 0 = dolgu yok. */
const PAD_TO = process.env.EVAL_LIVE_PAD === undefined ? 34 : Math.max(0, Math.trunc(Number(process.env.EVAL_LIVE_PAD) || 0));
const BUDGET_USD = Number(process.env.EVAL_BUDGET_USD) > 0 ? Number(process.env.EVAL_BUDGET_USD) : Infinity;
const TZ = "Europe/Istanbul";
const GUEST = "Alex Doe";

/**
 * Canlının bayrakları (CLAUDE.md "Canlı değişkenler", kurucu beyanı 09-26): harness bunları KENDİSİ yazar — kabuktaki başıboş bir
 * bayrak ölçümü sessizce değiştirmesin. Anlam katmanları 5.1'e SABİT (Luna planı §5-1: cevap modeli tek başına değişir).
 * Cevap modeli (`OPENAI_MODEL`), düşünme çabası ve ücret kuralı (`AI_KB_FEE_RULE_ENABLED`) ölçülen koldur — kabuktan gelir.
 */
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
  AI_CONVERSATION_STATE_ENABLED: "",
  AI_ACTION_CLAIMS_ENABLED: "",
  AI_CODE_GREETING_ENABLED: "",
  DURABLE_OUTBOX_ENABLED: "",
  SHADOW_AI_ENABLED: "",
  AI_SEMANTIC_MODEL: "gpt-5.1",
  AI_SEMANTIC_REASONING_EFFORT: "",
};

const mockSend = vi.mocked(sendOnChannel);
const mockMail = vi.mocked(emailService.sendReporting);
const spySuggest = vi.mocked(suggestReply);

// ── Maliyet: her OpenAI yanıtının `usage`ı (yeniden denemeler + gizli düşünme dahil) ────────────────────────────────────────────
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
    if (!p) continue;
    total += ((u.in - u.cached) * p.in + u.cached * p.cached + u.out * p.out) / 1e6;
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
async function seed(s: Scenario): Promise<{ conversationId: string }> {
  const now = Date.now();
  const org = await prisma.organization.create({
    data: { name: "Eval Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: TZ },
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
  const kb = data.kbSets[s.kb];
  const t0 = Date.UTC(2026, 8, 1);
  await prisma.knowledgeBaseItem.createMany({
    data: [
      ...kb.map((k, i) => ({ ...k, updatedAt: new Date(t0 - i * 60_000) })),
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
  await warmPropertyKbVectors(property.id);
  return { conversationId: conversation.id };
}

// ── Koşu ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Row {
  id: string;
  cls: string;
  lang: string;
  expectAuto: Scenario["expect"]["autoSend"];
  ok: boolean;
  retried: boolean;
  sent: boolean;
  /** Misafire giden metin (`sendOnChannel`e verilen) — gitmediyse null. */
  sentText: string | null;
  /** Modelin ürettiği taslak (gitse de gitmese de; kalite ile kapı etkisini ayırmak için). */
  draft: string | null;
  skippedReason: string | null;
  gateDetail: string | null;
  riskReason: string | null;
  status: string | null;
  escalated: boolean;
  items: number;
  heldItems: number;
  emails: number;
  factsSent: boolean | null;
  factsDraft: boolean | null;
  langOk: boolean | null;
  promise: boolean;
  greetingRepeat: boolean;
  claimU: number | null;
  ms: number;
  error?: string;
}

let lastStart = 0;
async function throttle(): Promise<void> {
  const gap = 60_000 / RPM;
  const wait = lastStart + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
}

async function runOnce(s: Scenario): Promise<Omit<Row, "retried">> {
  await resetDb();
  mockSend.mockReset();
  mockSend.mockResolvedValue({ ok: true, externalId: `ext-${s.id}` } as never);
  mockMail.mockClear();
  spySuggest.mockClear();
  const { conversationId } = await seed(s);
  const t0 = Date.now();
  const out = await applyChannelAutoReply(conversationId);
  const ms = Date.now() - t0;
  const sentText = mockSend.mock.calls.length > 0 ? String(mockSend.mock.calls[0][1]) : null;
  const ev = await prisma.riskEvent.findFirst({
    where: { conversationId, surface: "auto_reply" },
    orderBy: { createdAt: "desc" },
    select: { reason: true, kbEvidenceJson: true },
  });
  let evidence: { g?: { d?: string }; claims?: { u?: number } } = {};
  try {
    evidence = ev?.kbEvidenceJson ? (JSON.parse(String(ev.kbEvidenceJson)) as typeof evidence) : {};
  } catch {
    evidence = {};
  }
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { status: true, priority: true } });
  const items = await prisma.conversationItem.findMany({ where: { conversationId }, select: { status: true } });
  const inbound = await prisma.message.findFirst({
    where: { conversationId, direction: "inbound" },
    orderBy: { createdAt: "desc" },
    select: { aiSuggestedReply: true },
  });
  const lastModel = spySuggest.mock.results.at(-1);
  const raw = lastModel?.type === "return" ? await (lastModel.value as ReturnType<typeof suggestReply>) : null;
  const draft = raw?.source === "openai" ? raw.reply : (sentText ?? inbound?.aiSuggestedReply ?? null);
  const history = s.history ?? [];
  return {
    id: s.id,
    cls: s.class,
    lang: s.lang,
    expectAuto: s.expect.autoSend,
    ok: out.skippedReason !== "ai_unavailable",
    sent: out.sent === true && sentText !== null,
    sentText,
    draft,
    skippedReason: out.skippedReason ?? null,
    gateDetail: evidence.g?.d ?? null,
    riskReason: ev?.reason ?? null,
    status: conv?.status ?? null,
    escalated: conv?.status === "problem",
    items: items.length,
    heldItems: items.filter((i) => i.status === "pending_host").length,
    emails: mockMail.mock.calls.length,
    factsSent: sentText ? factsHit(s.expect.facts, sentText) : s.expect.facts?.length ? false : null,
    factsDraft: draft ? factsHit(s.expect.facts, draft) : s.expect.facts?.length ? false : null,
    langOk: sentText ? languageMatches(s.lang, sentText) : null,
    promise: sentText ? promiseInReply(sentText) : false,
    greetingRepeat: sentText ? history.some((h) => h.direction === "outbound") && GREETING.test(sentText) : false,
    claimU: typeof evidence.claims?.u === "number" ? evidence.claims.u : null,
    ms,
  };
}

async function runOne(s: Scenario): Promise<Row> {
  await throttle();
  try {
    let r = await runOnce(s);
    let retried = false;
    // Model yanıt vermediyse (429 / geçici arıza) iki koşuya da aynı kural: 20 sn sonra BİR kez yeniden dene (maliyet sayılır).
    if (!r.ok) {
      retried = true;
      await new Promise((res) => setTimeout(res, 20_000));
      await throttle();
      r = await runOnce(s);
    }
    return { ...r, retried };
  } catch (err) {
    return {
      id: s.id, cls: s.class, lang: s.lang, expectAuto: s.expect.autoSend, ok: false, retried: false, sent: false, sentText: null,
      draft: null, skippedReason: null, gateDetail: null, riskReason: null, status: null, escalated: false, items: 0, heldItems: 0,
      emails: 0, factsSent: null, factsDraft: null, langOk: null, promise: false, greetingRepeat: false, claimU: null, ms: 0,
      error: err instanceof Error ? err.name : "error",
    };
  }
}

// ── Rapor ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const pct = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function summarizeLive(rows: Row[]): string[] {
  const ok = rows.filter((r) => r.ok);
  const cls = (c: string) => ok.filter((r) => r.cls === c);
  const grounded = ok.filter((r) => r.expectAuto === "yes");
  const withFacts = ok.filter((r) => r.factsSent !== null);
  const leaks = ok.filter((r) => MUST_HOLD.has(r.cls) && r.sent);
  const nonTr = ok.filter((r) => r.lang !== "tr" && r.sent);
  const missing = cls("missing");
  const human = cls("human_request");
  const emergency = cls("emergency");
  return [
    "| ölçü | değer |",
    "|---|---|",
    `| 🚨 SIZINTI (gitmemesi gereken sınıf misafire gitti) | ${pct(leaks.length, ok.filter((r) => MUST_HOLD.has(r.cls)).length)} |`,
    `| misafire giden (cevabı KB'de olan soru) | ${pct(grounded.filter((r) => r.sent).length, grounded.length)} |`,
    `| doğru olgu MİSAFİRE GİDEN metinde | ${pct(withFacts.filter((r) => r.factsSent === true).length, withFacts.length)} |`,
    `| doğru olgu modelin taslağında (gitmese de) | ${pct(withFacts.filter((r) => r.factsDraft === true).length, withFacts.length)} |`,
    `| bilgisi olmayan soruda misafire giden | ${pct(missing.filter((r) => r.sent).length, missing.length)} |`,
    `| 🚨 bekleme sözü misafire giden metinde (hedef 0) | ${pct(ok.filter((r) => r.promise).length, ok.filter((r) => r.sent).length)} |`,
    `| dil uyumu misafire giden (TR dışı) | ${pct(nonTr.filter((r) => r.langOk).length, nonTr.length)} |`,
    `| selam tekrarı misafire giden (önceki cevaptan sonra) | ${ok.filter((r) => r.greetingRepeat).length} |`,
    `| insan talebi: gitmedi / ev sahibine e-posta | ${pct(human.filter((r) => !r.sent).length, human.length)} · ${pct(human.filter((r) => r.emails > 0).length, human.length)} |`,
    `| acil: gitmedi / Sorunlu / e-posta | ${pct(emergency.filter((r) => !r.sent).length, emergency.length)} · ${pct(emergency.filter((r) => r.escalated).length, emergency.length)} · ${pct(emergency.filter((r) => r.emails > 0).length, emergency.length)} |`,
    `| desteksiz somut iddia (iddia denetimi u>0) misafire giden | ${ok.filter((r) => r.sent && (r.claimU ?? 0) > 0).length} |`,
    `| düşen / hata | ${pct(rows.filter((r) => !r.ok).length, rows.length)} · yeniden denenen ${rows.filter((r) => r.retried).length} |`,
    `| akış süresi p50 / p95 (tüm katmanlar) | ${(quantile(ok.map((r) => r.ms), 0.5) / 1000).toFixed(1)} sn / ${(quantile(ok.map((r) => r.ms), 0.95) / 1000).toFixed(1)} sn |`,
  ];
}

describe.skipIf(!enabled)(`CANLI HAT — ${MODEL}`, () => {
  const rows: Row[] = [];
  let stoppedForBudget = false;

  beforeAll(() => {
    for (const [k, v] of Object.entries(LIVE_FLAGS)) vi.stubEnv(k, v);
    globalThis.fetch = meteredFetch as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    if (!enabled || rows.length === 0) return;
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `live-pipeline-${stamp}-${MODEL.replace(/[^a-z0-9.-]+/gi, "_")}${TAG ? `-${TAG}` : ""}.md`;
    let commit = "?";
    try {
      commit = execSync("git rev-parse --short HEAD", { cwd: path.resolve(__dirname, "../.."), stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      /* git yoksa "?" */
    }
    const planned = data.scenarios.filter((s) => ONLY.size === 0 || ONLY.has(s.id)).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined).length;
    const failed = rows.filter((r) => !r.ok).length;
    const status = stoppedForBudget
      ? `EKSİK — bütçe tavanı ($${BUDGET_USD}) nedeniyle ${planned - rows.length} senaryo koşmadı`
      : failed > rows.length * 0.02
        ? `GEÇERSİZ — ${failed} satır düştü`
        : "GEÇERLİ";
    const usageLines = [...usageByModel].map(
      ([m, u]) => `| ${m} | ${u.calls} | ${u.in} | ${u.cached} | ${u.out} | ${u.reasoning} |`,
    );
    const lines = [
      `# Canlı hat — misafire giden cevap — ${MODEL} (${stamp})`,
      "",
      `Durum: **${status}** · commit \`${commit}\` · satır ${rows.length}/${planned} · bilgi tabanı ${PAD_TO > 0 ? `nötr dolguyla ${PAD_TO} kaleme (seçim + gömme + sıralayıcı koşar)` : "dolgusuz"}`,
      `Bayraklar harness'ta sabit (canlı): ${Object.entries(LIVE_FLAGS).map(([k, v]) => `\`${k}=${v || "(boş)"}\``).join(" · ")}`,
      `Ücret kuralı: \`AI_KB_FEE_RULE_ENABLED=${process.env.AI_KB_FEE_RULE_ENABLED?.trim() || "(boş)"}\` · düşünme: \`OPENAI_REASONING_EFFORT=${process.env.OPENAI_REASONING_EFFORT?.trim() || "(boş)"}\``,
      "",
      ...summarizeLive(rows),
      "",
      `Toplam ölçüm maliyeti (liste fiyatı, TÜM katmanlar, yeniden denemeler + düşünme dahil): **$${usd().toFixed(4)}**`,
      "",
      "| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |",
      "|---|---|---|---|---|---|",
      ...usageLines,
      "",
      "## Sınıf bazında misafire giden",
      "",
      "| sınıf | beklenti | giden | tutulan | Sorunlu |",
      "|---|---|---|---|---|",
      ...[...new Set(rows.map((r) => r.cls))].map((c) => {
        const rs = rows.filter((r) => r.ok && r.cls === c);
        return `| ${c} | ${[...new Set(rs.map((r) => r.expectAuto))].join("/")} | ${rs.filter((r) => r.sent).length} | ${rs.filter((r) => !r.sent).length} | ${rs.filter((r) => r.escalated).length} |`;
      }),
      "",
      "## Tutulma gerekçeleri (misafire gitmeyen)",
      "",
      ...Object.entries(
        rows
          .filter((r) => r.ok && !r.sent)
          .reduce<Record<string, number>>((acc, r) => {
            const k = `${r.skippedReason ?? "-"} · ${r.riskReason ?? "-"}${r.gateDetail ? ` · ${r.gateDetail}` : ""}`;
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
          }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `- ${k}: ${n}`),
      "",
      "## Misafire giden cevaplar (sentetik veri; insan gözü için)",
      "",
      ...rows.filter((r) => r.sent).map((r) => `- **${r.id}** (${r.cls}/${r.lang}): ${JSON.stringify((r.sentText ?? "").slice(0, 320))}`),
      "",
      "## Düşen satırlar",
      "",
      ...rows.filter((r) => !r.ok).map((r) => `- \`${r.id}\` ${r.skippedReason ?? ""} ${r.error ?? ""}`),
      "",
    ];
    writeFileSync(path.join(dir, name), lines.join("\n"), "utf8");
    writeSidecar(dir, name, {
      suite: "live-pipeline",
      version: data.version,
      meta: { model: MODEL, commit, status, pad: PAD_TO, usd: usd(), usage: Object.fromEntries(usageByModel) },
      rows,
    });
  });

  it(
    "senaryolar — ürünün kanal akışı, canlı bayraklar, gerçek kapılar",
    async () => {
      const list = data.scenarios.filter((s) => ONLY.size === 0 || ONLY.has(s.id)).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
      for (const s of list) {
        if (usd() >= BUDGET_USD) {
          stoppedForBudget = true;
          break;
        }
        rows.push(await runOne(s));
      }
      expect(rows.length).toBeGreaterThan(0);
    },
    4 * 60 * 60 * 1000,
  );
});

describe("canlı hat ölçeri — çevrimdışı pinler", () => {
  it("canlı bayrak listesi anlam katmanlarını 5.1'e sabitler ve ölçülen kolları (cevap modeli, çaba, ücret kuralı) YAZMAZ", () => {
    expect(LIVE_FLAGS.AI_SEMANTIC_MODEL).toBe("gpt-5.1");
    for (const k of ["OPENAI_MODEL", "OPENAI_REASONING_EFFORT", "AI_KB_FEE_RULE_ENABLED"]) expect(Object.hasOwn(LIVE_FLAGS, k)).toBe(false);
    for (const k of ["KB_SEMANTIC_RETRIEVAL", "KB_RERANK_ENABLED", "AI_UNDERSTANDING_ENABLED", "AI_STAY_GUARD_ENABLED", "AI_CONVERSATION_ITEMS_ENABLED"]) {
      expect(LIVE_FLAGS[k]).toBe("1");
    }
  });

  it("varsayılan dolgu, üretimde seçimin devreye girdiği boyutu aşar (≤30 kalemde seçim yapılmaz)", () => {
    if (process.env.EVAL_LIVE_PAD !== undefined) return;
    expect(PAD_TO).toBeGreaterThan(30);
    for (const set of ["full", "sparse"] as const) expect(data.kbSets[set].length).toBeLessThanOrEqual(PAD_TO);
  });
});
