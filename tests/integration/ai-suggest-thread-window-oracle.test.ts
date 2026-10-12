// ---------------------------------------------------------------------------
// MADDE 10 KÂHİNİ — gelen kutusu "AI cevap öner" (`api/conversations/[id]/ai-suggest`): kanal oto-yanıtıyla aynı sınırlı okuyucu
// (`channel-thread-window.ts`). Sözleşme: ev sahibine giden taslak, modele giden istekler ve kayıtlar konuşmanın TAMAMI okunmuş gibi
// BİREBİR aynı. Tohumlu rastgele konuşmalar aynı kimliklerle kurulur; önce tam okuma, sonra 1–7 satırlık sayfalar. Cevap modeli
// GERÇEK (istem metni karşılaştırılır), yalnız OpenAI isteği sahte.
// + K7 bağlantısı (kurucu onayı 09-30): bu yüzeyde de getirme / anlama geçmişi yazar etiketi taşır — otomatik şablon mesajı
//   cevapsız pencereyi sıfırlamaz.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";
import { __setChannelThreadPageForTests } from "@/lib/channel-thread-window";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { __resetRateLimit } from "@/lib/rate-limit";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetModelProviderHealthForTests } from "@/lib/ai/provider-health";

const DAY = 86_400_000;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const GUEST = ["Wifi şifresi nedir?", "Teşekkürler", "Klima çalışmıyor.", "Otopark var mı?", "Tamam 👍", "Giriş saati kaçta?", "", "Havlular nerede?"];
const HOST = ["Wifi şifresi kartta yazıyor.", "Kontrol edip döneceğim.", "Havlu ister misiniz?", "", "Giriş 15:00'ten itibaren."];
const AI = ["Havlular banyodaki dolapta.", "Talebinizi ev sahibine iletiyorum.", "Rica ederiz 😊"];
const AUTOMATION = ["Hoş geldiniz! Giriş bilgileri ektedir.", "Çıkış saatiniz 11:00."];

interface Row {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  authorType: string | null;
  senderName: string;
  systemEventType: string | null;
  createdAt: Date;
}

/** Bu yüzeyde son satır GİDEN de olabilir (ev sahibi zaten yazdıysa öneri son GELEN mesaja). */
function genThread(seed: number, t0: number): Row[] {
  const r = rng(seed);
  const len = 20 + Math.floor(r() * 50);
  const shape = pick(r, ["mixed", "mixed", "longPending", "automationHeavy"] as const);
  const rows: Row[] = [];
  let t = t0;
  for (let i = 0; i < len; i++) {
    if (r() > 0.15) t += 60_000;
    let kind: string;
    if (shape === "longPending" && i > 3) kind = pick(r, ["guest", "guest", "guest", "automation"]);
    else if (shape === "automationHeavy") kind = pick(r, ["guest", "automation", "automation", "host", "ai"]);
    else kind = pick(r, ["guest", "guest", "guest", "host", "ai", "automation", "legacyAi", "system"]);
    if (i === len - 1 && r() < 0.7) kind = "guest";
    const id = `m${String(i).padStart(4, "0")}${pick(r, ["a", "b", "c"])}`;
    const base = { id, createdAt: new Date(t), systemEventType: null };
    if (kind === "guest") rows.push({ ...base, direction: "inbound", body: pick(r, GUEST), authorType: "guest", senderName: "Ayşe" });
    else if (kind === "host") rows.push({ ...base, direction: "outbound", body: pick(r, HOST), authorType: "host", senderName: "Ev sahibi" });
    else if (kind === "ai") rows.push({ ...base, direction: "outbound", body: pick(r, AI), authorType: "ai", senderName: "GuestOps AI" });
    else if (kind === "automation") rows.push({ ...base, direction: "outbound", body: pick(r, AUTOMATION), authorType: "automation", senderName: "Ev sahibi" });
    else if (kind === "legacyAi") rows.push({ ...base, direction: "outbound", body: pick(r, AI), authorType: null, senderName: "GuestOps AI" });
    else rows.push({ ...base, direction: "outbound", body: "", authorType: "system", senderName: "__lixus_ai_resumed__", systemEventType: "guest_chat_ai_resumed" });
  }
  // En az bir misafir mesajı (yoksa rota 400 — kâhin yine aynı ama boş geçer).
  if (!rows.some((m) => m.direction === "inbound")) rows[0] = { ...rows[0], direction: "inbound", body: "Merhaba", authorType: "guest", senderName: "Ayşe", systemEventType: null };
  return rows;
}

async function seed(rows: readonly Row[], now: number) {
  await prisma.organization.create({ data: { id: "org-ai", name: "Öneri Org", timezone: "Europe/Istanbul" } });
  await prisma.user.create({ data: { id: "u-ai", organizationId: "org-ai", name: "h", email: "h-ai@x.com", passwordHash: "x", role: "owner" } });
  await prisma.property.create({ data: { id: "prop-ai", organizationId: "org-ai", name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  await prisma.reservation.create({
    data: {
      id: "res-ai", propertyId: "prop-ai", guestName: "Ayşe Yılmaz", arrivalDate: new Date(now - DAY), departureDate: new Date(now + 3 * DAY),
      channel: "airbnb", status: "confirmed",
    },
  });
  await prisma.conversation.create({
    data: { id: "conv-ai", propertyId: "prop-ai", reservationId: "res-ai", guestIdentifier: "Ayşe Yılmaz", channel: "airbnb", status: "new" },
  });
  await prisma.message.createMany({ data: rows.map((m) => ({ ...m, conversationId: "conv-ai" })) });
  session = { userId: "u-ai", organizationId: "org-ai", role: "owner", email: "h-ai@x.com", name: "h", sessionEpoch: 0 } as SessionPayload;
}

const MODEL_REPLY = {
  reply: "Wifi şifresi giriş kapısının yanındaki kartta yazıyor.", intent: "wifi", confidence: 0.95, riskLevel: "low",
  priority: "standard", detectedLanguage: "tr", usedSources: ["history"], missingInfo: [],
};
const NLU = {
  language: "tr",
  requests: [{ intent: "wifi", query_tr: "wifi şifresi", query_original: "wifi" }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};
function modelFetch(bodies: string[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = String(init?.body);
    bodies.push(body);
    const name = JSON.parse(body).response_format?.json_schema?.name as string | undefined;
    const verdict = name === undefined ? MODEL_REPLY : name === "guest_message_understanding" ? NLU : null;
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), { status: 200 });
  });
}

async function run(rows: readonly Row[], now: number, page: number | null) {
  await resetDb();
  vi.clearAllMocks();
  __resetUnderstandingCache();
  __resetRateLimit();
  __resetKbIndexCache();
  __resetModelProviderHealthForTests();
  const fetchBodies: string[] = [];
  vi.stubGlobal("fetch", modelFetch(fetchBodies));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await seed(rows, now);
  __setChannelThreadPageForTests(page);
  let status = 0;
  let body: unknown;
  try {
    const res = await aiSuggest(
      new NextRequest("http://localhost/api/conversations/conv-ai/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone: "warm" }),
      }),
      { params: Promise.resolve({ id: "conv-ai" }) },
    );
    status = res.status;
    body = await res.json();
  } finally {
    __setChannelThreadPageForTests(null);
    vi.useRealTimers();
  }
  const suggested = await prisma.message.findMany({
    where: { conversationId: "conv-ai", aiSuggestedReply: { not: null } },
    select: { id: true, aiSuggestedReply: true, aiIntent: true, aiConfidence: true },
  });
  return { status, body, fetchBodies, suggested };
}

describe("madde 10 kâhini — AI cevap öner: sayfalı okuma = tam okuma", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(() => __setChannelThreadPageForTests(null));

  const SEEDS = Array.from({ length: 16 }, (_, i) => 2000 + i * 7919);
  const PAGES = [1, 2, 3, 7];

  it("ön koşul: aynı girdi → aynı çıktı (kâhin geçerli); model gerçekten çağrılıyor", async () => {
    const now = Date.now();
    const rows = genThread(SEEDS[0], now - 2 * DAY);
    const a = await run(rows, now, null);
    const b = await run(rows, now, null);
    expect(b).toEqual(a);
    expect(a.status).toBe(200);
    expect(a.fetchBodies.length).toBeGreaterThan(0);
  });

  it.each(SEEDS)("🚨 tohum %i: varsayılan bayraklar — her sayfa boyunda taslak + model istekleri tam okumayla aynı", async (seedN) => {
    const now = Date.now();
    const rows = genThread(seedN, now - 2 * DAY);
    const full = await run(rows, now, null);
    for (const page of PAGES) expect(await run(rows, now, page), `sayfa ${page}`).toEqual(full);
  });

  it.each(SEEDS.slice(0, 8))("🚨 tohum %i: anlama katmanı + konuşma kayıtları açık — kesit öncesi toplamlar dahil aynı", async (seedN) => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const now = Date.now();
    const rows = genThread(seedN, now - 2 * DAY);
    const full = await run(rows, now, null);
    for (const page of PAGES) expect(await run(rows, now, page), `sayfa ${page}`).toEqual(full);
  });
});

describe("K7 bağlantısı — AI cevap öner: otomatik şablon mesajı anlama penceresini sıfırlamaz", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const thread = (middle: "automation" | "host", t0: number): Row[] => [
    { id: "k1", direction: "inbound", body: "Otopark var mı?", authorType: "guest", senderName: "Ayşe", systemEventType: null, createdAt: new Date(t0) },
    { id: "k2", direction: "outbound", body: "Hoş geldiniz! Giriş bilgileri ektedir.", authorType: middle, senderName: "Ev sahibi", systemEventType: null, createdAt: new Date(t0 + 60_000) },
    { id: "k3", direction: "inbound", body: "Wifi şifresi nedir?", authorType: "guest", senderName: "Ayşe", systemEventType: null, createdAt: new Date(t0 + 120_000) },
  ];
  const unansweredSection = (bodies: string[]) => {
    const nlu = bodies.find((b) => b.includes("guest_message_understanding")) ?? "";
    const prompt = String(JSON.parse(nlu || "{}").messages?.at(-1)?.content ?? "");
    return prompt.slice(prompt.indexOf("UNANSWERED GUEST MESSAGES:"));
  };

  it("🚨 şablonun öncesindeki soru CEVAPSIZ listesinde; KONTROL ev sahibi cevabı → yalnız son soru", async () => {
    const now = Date.now();
    const auto = await run(thread("automation", now - 10 * 60_000), now, null);
    expect(unansweredSection(auto.fetchBodies)).toContain("Otopark var mı?");
    expect(unansweredSection(auto.fetchBodies)).toContain("Wifi şifresi nedir?");
    const host = await run(thread("host", now - 10 * 60_000), now, null);
    expect(unansweredSection(host.fetchBodies)).toContain("Wifi şifresi nedir?");
    expect(unansweredSection(host.fetchBodies)).not.toContain("Otopark var mı?");
  });
});
