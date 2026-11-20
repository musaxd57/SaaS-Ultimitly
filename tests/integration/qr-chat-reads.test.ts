// ---------------------------------------------------------------------------
// QR MİSAFİR SOHBETİ — OKUMA SAYISI + EŞZAMANLI DEĞİŞİKLİK KARAKTERİZASYONU (kurucu 11-20 sabah F-4: "Gereksiz okumayı kaldır, güncellik
// kontrolünü değil … Başarı ölçüsü: daha az sorgu, daha düşük p95 gecikmesi ve eşzamanlı değişiklik testlerinde aynı doğruluk").
//
// Gerçek PostgreSQL + gerçek QR rotası; yalnız cevap modeli sahte. Üç bölüm:
//  1. Sorgu sayısı pini (`tests/helpers/query-probe.ts`, `request-path-queries.test.ts` emsali): ilk mesaj · süren sohbet · ev sahibi
//     devraldıktan sonra. Sınırlar ÖLÇÜLEN değer — tekrar okuma kaldırılınca düşürülür, eklenince kırmızı olur. Konuşma satırının kaç kez
//     arandığı (`Conversation.findFirst`) ayrıca pinlidir (F-4'ün hedefi; sınıflandırma `…/sabah/olc/F4-SINIF.md`).
//  2. Model düşünürken değişen dünya — bugünkü DOĞRU sonuç: ev sahibi devralır (ilk mesajda da) · misafir aynı anda ikinci mesajı yazar.
//     (İptal: `qr-cancelled-mid-turn.test.ts`; silme: `qr-erasure-race.test.ts`; ikinci mesajda ev sahibi: `guest-chat-handoff.test.ts`.)
//  3. Gecikme ölçüsü (iddiasız): taklit model gecikmesi + taklit veritabanı gidiş-dönüşü ile N istek; p50 / p95 `OLCUM_OUT` verilirse
//     dosyaya yazılır (ölçüm satırı; süre pini DEĞİL — kapıda süre iddiası yok).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { probeQueries, probeSummary } from "../helpers/query-probe";

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "configured-model", effort: null })),
  replyPromptVersion: vi.fn(() => "promptvqr1"),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { NextRequest } from "next/server";
import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { __resetRateLimit } from "@/lib/rate-limit";

const mockSuggest = vi.mocked(suggestReply);
const DAY = 86_400_000;
const ANSWER = "Çöp zemin kattaki yeşil konteynere bırakılır.";

const draft = (reply = ANSWER) => ({
  reply,
  intent: "general",
  riskLevel: "none",
  riskType: null,
  confidence: 0.95,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "tr",
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none", stance: "none" },
  llmUsage: { m: "served-model", pt: 900, ct: 40 },
});

async function seedQr() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Lale Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      sourceReference: `res-${Math.random().toString(36).slice(2)}`,
    },
  });
  return { orgId, propertyId, token, reservationId: reservation.id };
}

let seq = 0;
async function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `rd${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  const cookieOut = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return {
    status: res.status,
    body: (await res.json()) as { reply?: string | null; handoff?: boolean; escalated?: boolean; closed?: boolean },
    cookie: cookieOut,
  };
}

async function thread(propertyId: string) {
  return prisma.message.findMany({
    where: { conversation: { propertyId, channel: "chat" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { direction: true, authorType: true, senderName: true, body: true },
  });
}

async function hostReplies(propertyId: string, body = "Merhaba, ben ilgileniyorum.") {
  const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" }, select: { id: true } });
  await prisma.message.create({
    data: { conversationId: convo.id, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body, language: "tr" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("F-4 QR: okuma sayısı + model düşünürken değişen dünya", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // ── 1. sorgu sayısı ─────────────────────────────────────────────────────
  it("ilk mesaj: konuşma açılır, cevap gider — sorgu sayısı ve konuşma araması pinli", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const r = await probeQueries(() => ask(s.token, "Çöp nereye atılıyor?"), { depth: true });
    expect(r.result.body.reply).toBe(ANSWER);
    expect(r.byOp["Conversation.findFirst"], probeSummary(r)).toBe(QR_FIRST.conversationFindFirst);
    expect(r.ops, probeSummary(r)).toBe(QR_FIRST.ops);
    expect(r.sql, probeSummary(r)).toBeLessThanOrEqual(QR_FIRST.sqlMax);
    expect(r.depth, probeSummary(r)).toBeLessThanOrEqual(QR_FIRST.depthMax);
  });

  it("süren sohbet (aynı cihazdan ikinci mesaj): sorgu sayısı ve konuşma araması pinli", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const first = await ask(s.token, "Merhaba");
    const r = await probeQueries(() => ask(s.token, "Çöp nereye atılıyor?", first.cookie), { depth: true });
    expect(r.result.body.reply).toBe(ANSWER);
    expect(r.byOp["Conversation.findFirst"], probeSummary(r)).toBe(QR_ONGOING.conversationFindFirst);
    expect(r.ops, probeSummary(r)).toBe(QR_ONGOING.ops);
    expect(r.sql, probeSummary(r)).toBeLessThanOrEqual(QR_ONGOING.sqlMax);
    expect(r.depth, probeSummary(r)).toBeLessThanOrEqual(QR_ONGOING.depthMax);
  });

  it("ev sahibi devraldıktan sonra: model çağrılmaz, mesaj ev sahibine kaydedilir — sorgu sayısı pinli", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const first = await ask(s.token, "Merhaba");
    await hostReplies(s.propertyId);
    mockSuggest.mockClear();
    const r = await probeQueries(() => ask(s.token, "Çöp nereye atılıyor?", first.cookie), { depth: true });
    expect(r.result.body.handoff).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(r.byOp["Conversation.findFirst"], probeSummary(r)).toBe(QR_PAUSED.conversationFindFirst);
    expect(r.ops, probeSummary(r)).toBe(QR_PAUSED.ops);
    expect(r.sql, probeSummary(r)).toBeLessThanOrEqual(QR_PAUSED.sqlMax);
  });

  // ── 2. model düşünürken değişen dünya ────────────────────────────────────
  it("🚨 ilk mesajda model düşünürken ev sahibi yazar → yapay zekâ cevabı YAZILMAZ, misafirin mesajı ev sahibine kalır", async () => {
    const s = await seedQr();
    mockSuggest.mockImplementationOnce((async () => {
      await hostReplies(s.propertyId, "Ben bakıyorum.");
      return draft();
    }) as never);
    const r = await ask(s.token, "Çöp nereye atılıyor?");
    expect(r.body.handoff).toBe(true);
    const t = await thread(s.propertyId);
    expect(t.filter((m) => m.senderName === "Lixus AI")).toHaveLength(0);
    expect(t.filter((m) => m.direction === "inbound").map((m) => m.body)).toEqual(["Çöp nereye atılıyor?"]);
  });

  it("KONTROL: ev sahibi yazmazsa aynı ilk mesajın cevabı yazılır", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const r = await ask(s.token, "Çöp nereye atılıyor?");
    expect(r.body.reply).toBe(ANSWER);
    const t = await thread(s.propertyId);
    expect(t.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
  });

  it("🚨 model düşünürken misafir ikinci mesajı yazar (o da cevaplanır) → iki mesaj da kaydedilir, her biri TEK cevapla, çiftler karışmaz", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft("İlk cevap.") as never);
    const first = await ask(s.token, "Merhaba");
    let nested: Awaited<ReturnType<typeof ask>> | null = null;
    mockSuggest.mockImplementationOnce((async () => {
      // İkinci istek bu model çağrısı sürerken baştan sona işlenir (kendi model çağrısı hemen döner).
      mockSuggest.mockResolvedValueOnce(draft("İkinci mesajın cevabı.") as never);
      nested = await ask(s.token, "Bir de otopark var mı?", first.cookie);
      return draft("Birinci mesajın cevabı.");
    }) as never);
    const r = await ask(s.token, "Çöp nereye atılıyor?", first.cookie);
    expect(r.body.reply).toBe("Birinci mesajın cevabı.");
    expect(nested!.body.reply).toBe("İkinci mesajın cevabı.");
    const t = await thread(s.propertyId);
    // İlk tur + iki eşzamanlı tur: 6 satır, her misafir mesajının HEMEN ardından kendi cevabı (aynı işlemde yazılır).
    expect(t).toHaveLength(6);
    const pairs = new Map<string, string>();
    for (let i = 0; i < t.length; i += 2) {
      expect(t[i].direction).toBe("inbound");
      expect(t[i + 1].direction).toBe("outbound");
      pairs.set(t[i].body, t[i + 1].body);
    }
    expect(pairs.get("Çöp nereye atılıyor?")).toBe("Birinci mesajın cevabı.");
    expect(pairs.get("Bir de otopark var mı?")).toBe("İkinci mesajın cevabı.");
  });

  // ── 3. gecikme ölçüsü (iddiasız) ─────────────────────────────────────────
  it("ölçüm: süren sohbette N mesaj, taklit model + veritabanı gecikmesiyle p50 / p95 (dosyaya; iddia yok)", async () => {
    const n = Math.min(200, Math.max(3, Number(process.env.OLCUM_N) || 8));
    const modelMs = 120;
    const dbMs = 1;
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const first = await ask(s.token, "Merhaba");
    mockSuggest.mockImplementation((async () => {
      await sleep(modelMs);
      return draft();
    }) as never);
    installDbLatency();
    const walls: number[] = [];
    const sqls: number[] = [];
    try {
      DB_LATENCY.ms = dbMs;
      for (let i = 0; i < n; i++) {
        // Sınırlar ölçülen yolu değiştirmesin: her istekten önce sayaçlar sıfır (zaman ölçümünün dışında).
        DB_LATENCY.ms = 0;
        await prisma.rateLimitCounter.deleteMany();
        __resetRateLimit();
        DB_LATENCY.ms = dbMs;
        const t0 = performance.now();
        const r = await probeQueries(() => ask(s.token, `Soru ${i + 1}: çöp nereye atılıyor?`, first.cookie));
        walls.push(performance.now() - t0);
        sqls.push(r.sql);
        expect(r.result.body.reply).toBe(ANSWER);
      }
    } finally {
      DB_LATENCY.ms = 0;
    }
    const sorted = [...walls].sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    LATENCY_ROWS.push({ n, modelMs, dbMsPerCall: dbMs, p50: Math.round(pick(0.5)), p95: Math.round(pick(0.95)), max: Math.round(sorted.at(-1) ?? 0), sqlPerRequest: sqls });
  });

  afterAll(() => {
    const out = process.env.OLCUM_OUT?.trim();
    if (out && LATENCY_ROWS.length > 0) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "qr-p95.json"), JSON.stringify(LATENCY_ROWS, null, 1));
    }
  });
});

// Ölçülen değerler (varsayılan anahtarlar). Bir tekrar okuma kaldırılınca bu değerler DÜŞÜRÜLÜR; artış kırmızıdır. Prisma çağrısı ve derinlik
// belirlenimci (sınır = ölçülen); SQL sayısına motorun bağlantı yoklaması (`SELECT 1`) zaman zaman +1–2 ekler → SQL sınırı ölçülen + 2.
// F-4 öncesi (aa8098f7): ilk mesaj 6 arama / 47 çağrı / 45 tur · süren sohbet 5 / 43 / 41 · devir 2 / 22. Sonrası: konuşma kimliği model
// öncesinde bir kez aranır ve paylaşılır, kayıt işleminde devir kontrolüne aynı işlemin kimliği verilir, doğrulanmış cihaz geçişi bağı ikinci
// kez okumaz. Korunanlar (model beklerken değişebilir): kayıt işlemindeki silme, iptal ve ev sahibi devri okumaları — `F4-SINIF.md`.
const QR_FIRST = { conversationFindFirst: 3, ops: 44, sqlMax: 61, depthMax: 42 };
const QR_ONGOING = { conversationFindFirst: 2, ops: 39, sqlMax: 52, depthMax: 37 };
const QR_PAUSED = { conversationFindFirst: 2, ops: 21, sqlMax: 26 };

// ── taklit veritabanı gidiş-dönüşü (yalnız ölçüm testinde; 0 iken geçirgen) ──
const DB_LATENCY = { ms: 0 };
let latencyInstalled = false;
function installDbLatency(): void {
  if (latencyInstalled) return;
  latencyInstalled = true;
  (prisma as unknown as { $use(mw: (p: unknown, next: (p: unknown) => Promise<unknown>) => Promise<unknown>): void }).$use(async (p, next) => {
    if (DB_LATENCY.ms > 0) await sleep(DB_LATENCY.ms);
    return next(p);
  });
}
const LATENCY_ROWS: Record<string, unknown>[] = [];
