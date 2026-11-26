// ---------------------------------------------------------------------------
// QR'DA BİRDEN ÇOK MİSAFİR MESAJINA TEK CEVAP (kurucu 11-20 öğlen F4-b; anahtar `GUEST_CHAT_TURN_MERGE_ENABLED`, varsayılan KAPALI).
// Kurucu: "kanal gibi olsun … 5 tane soru sormuşsa bile tek cevapta verebilir … İlk taslağı iptal etmek, ilk soruyu silmek demek olmasın.
// Wi-Fi cevabı zaten misafire gittiyse ikinci cevap yalnız otoparkı kapsasın. Her mesaja sabit üç saniye eklemeyelim. İkinci soru güvenle
// cevaplanamıyorsa onu açık tutalım; QR'da kısmi gönderimi bu değişiklikle gizlice açmayalım."
// Gerçek PostgreSQL + gerçek QR rotası; yalnız cevap modeli sahte (yarışlar model "düşünürken" kurulur).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "configured-model", effort: null })),
  replyPromptVersion: vi.fn(() => "promptvqr1"),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
}));
vi.mock("@/lib/billing/plan-limits", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/plan-limits")>();
  return { ...actual, limitsForOrg: vi.fn(actual.limitsForOrg) };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { NextRequest } from "next/server";
import { suggestReply } from "@/lib/ai";
import { GET, POST } from "@/app/api/chat/[token]/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { QR_TURN_FRESH_MS, QR_TURN_OPEN_PREFIX } from "@/lib/guest-chat-turn-core";

const mockSuggest = vi.mocked(suggestReply);
const mockLimits = vi.mocked(limitsForOrg);
const DAY = 86_400_000;
const WIFI_Q = "Wi-Fi şifresi ne?";
const TRASH_Q = "Çöp ne zaman alınıyor?";
const WIFI_A = "Wi-Fi ağımız LaleNet, şifresi deniz2024.";
const BOTH_A = "Wi-Fi ağımız LaleNet, şifresi deniz2024. Çöpü her akşam kapının önüne bırakabilirsiniz.";

const draft = (reply: string, over: Record<string, unknown> = {}) => ({
  reply,
  intent: "wifi",
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
  ...over,
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
      guestName: "Zeynep Kaya",
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
const newId = () => `tm${++seq}-${Math.random().toString(36).slice(2)}aaaa`;
type Body = { reply?: string | null; merged?: boolean; escalated?: boolean; handoff?: boolean; deduped?: boolean; noReply?: boolean };
async function ask(token: string, message: string, cookie?: string, requestId: string | null = newId()) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestId ? { message, requestId } : { message }),
    }),
    { params: Promise.resolve({ token }) },
  );
  const cookieOut = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return { status: res.status, body: (await res.json()) as Body, cookie: cookieOut };
}
async function history(token: string, cookie: string) {
  const res = await GET(new NextRequest(`http://localhost/api/chat/${token}`, { headers: { cookie } }), { params: Promise.resolve({ token }) });
  return (await res.json()) as { messages: { role: string; text: string; clientId?: string }[] };
}

const thread = (propertyId: string) =>
  prisma.message.findMany({
    where: { conversation: { propertyId, channel: "chat" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, direction: true, body: true, externalId: true, createdAt: true },
  });

/** Dışarıdan çözülen söz: modelin "düşünme" süresini testin eline verir. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** Koşul sağlanana kadar bekler (yarış kurulumunda "öteki istek şuraya geldi" işareti). */
async function until(cond: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 400; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`beklenen durum oluşmadı: ${label}`);
}

describe("QR — birden çok misafir mesajına tek cevap (F4-b)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
    vi.stubEnv("GUEST_CHAT_TURN_MERGE_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("KONTROL (anahtar kapalı): misafir satırı cevabıyla birlikte yazılır, işaret taşımaz; okuma yanıtında istek kimliği yok", async () => {
    vi.stubEnv("GUEST_CHAT_TURN_MERGE_ENABLED", "");
    const s = await seedQr();
    let rowsDuringModel = -1;
    mockSuggest.mockImplementation(async () => {
      rowsDuringModel = (await thread(s.propertyId)).length;
      return draft(WIFI_A) as never;
    });
    const out = await ask(s.token, WIFI_Q);
    expect(out.body.reply).toBe(WIFI_A);
    expect(rowsDuringModel).toBe(0);
    const rows = await thread(s.propertyId);
    expect(rows.map((r) => [r.direction, r.externalId])).toEqual([["inbound", null], ["outbound", null]]);
    const h = await history(s.token, out.cookie!);
    expect(h.messages.every((m) => !("clientId" in m))).toBe(true);
  });

  it("anahtar yalnız tam '1' ile açılır ('true' açmaz)", async () => {
    vi.stubEnv("GUEST_CHAT_TURN_MERGE_ENABLED", "true");
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft(WIFI_A) as never);
    await ask(s.token, WIFI_Q);
    expect((await thread(s.propertyId)).map((r) => r.externalId)).toEqual([null, null]);
  });

  it("misafir satırı modelden ÖNCE kayıtlıdır ('açık'); karar yazılınca 'kararı verildi' olur ve ekran istek kimliğini görür", async () => {
    const s = await seedQr();
    let during: { direction: string; externalId: string | null }[] = [];
    mockSuggest.mockImplementation(async () => {
      during = await thread(s.propertyId);
      return draft(WIFI_A) as never;
    });
    const rid = newId();
    const out = await ask(s.token, WIFI_Q, undefined, rid);
    expect(out.body).toMatchObject({ escalated: false, reply: WIFI_A });
    expect(during.map((r) => [r.direction, r.externalId])).toEqual([["inbound", `${QR_TURN_OPEN_PREFIX}${rid}`]]);
    const rows = await thread(s.propertyId);
    expect(rows.map((r) => [r.direction, r.body, r.externalId])).toEqual([
      ["inbound", WIFI_Q, `qr:${rid}`],
      ["outbound", WIFI_A, null],
    ]);
    // Güncel mesaj geçmişte TEKRARLANMAZ (satır kayıtlı olsa da) ve modele misafirin mesajı olarak gider.
    const input = mockSuggest.mock.calls[0]![0];
    expect(input.guestMessage).toBe(WIFI_Q);
    expect(input.history ?? []).toEqual([]);
    const h = await history(s.token, out.cookie!);
    expect(h.messages.map((m) => [m.role, m.clientId ?? null])).toEqual([["guest", rid], ["ai", null]]);
    // Misafir olayı bir kez yazıldı (alan olayı, satır kimliğiyle).
    expect(await prisma.ingestEvent.count({ where: { entityId: rows[0]!.id } })).toBe(1);
  });

  it("🚨 model düşünürken ikinci mesaj gelir → TEK cevap ikisini kapsar; ilk taslak gitmez, ilk soru SİLİNMEZ; sabit bekleme yok", async () => {
    const s = await seedQr();
    const open = { cookie: await bind(s) };
    const first = deferred<never>();
    mockSuggest.mockImplementationOnce(() => first.promise);
    mockSuggest.mockImplementationOnce(async () => draft(BOTH_A) as never);
    const r1 = ask(s.token, WIFI_Q, open.cookie);
    await until(() => mockSuggest.mock.calls.length === 1, "ilk istek modelde");
    const r2 = await ask(s.token, TRASH_Q, open.cookie);
    // İkinci istek beklemeden çalıştı ve iki mesajı TEK mesaj gibi gördü (yazılış sırasıyla).
    expect(mockSuggest.mock.calls[1]![0].guestMessage).toBe(`${WIFI_Q}\n${TRASH_Q}`);
    expect(mockSuggest.mock.calls[1]![0].history ?? []).toEqual([]);
    expect(r2.body).toMatchObject({ escalated: false, reply: BOTH_A });
    first.resolve(draft(WIFI_A) as never);
    const out1 = await r1;
    expect(out1.status).toBe(200);
    expect(out1.body).toEqual({ merged: true });
    const rows = await thread(s.propertyId);
    expect(rows.map((r) => [r.direction, r.body])).toEqual([
      ["inbound", WIFI_Q],
      ["inbound", TRASH_Q],
      ["outbound", BOTH_A],
    ]);
    expect(rows.filter((r) => r.direction === "inbound").every((r) => r.externalId?.startsWith("qr:"))).toBe(true);
  });

  it("🚨 ilk taslak ÖNCE biterse de gitmez: kayıt anında daha yeni misafir mesajı var (bayat cevap)", async () => {
    const s = await seedQr();
    const open = await bind(s);
    const first = deferred<never>();
    const second = deferred<never>();
    mockSuggest.mockImplementationOnce(() => first.promise);
    mockSuggest.mockImplementationOnce(() => second.promise);
    const r1 = ask(s.token, WIFI_Q, open);
    await until(() => mockSuggest.mock.calls.length === 1, "ilk istek modelde");
    const r2 = ask(s.token, TRASH_Q, open);
    await until(() => mockSuggest.mock.calls.length === 2, "ikinci istek modelde");
    first.resolve(draft(WIFI_A) as never);
    expect((await r1).body).toEqual({ merged: true });
    // İlk istek hiçbir cevap yazmadı; iki soru da kayıtlı ve açık.
    let rows = await thread(s.propertyId);
    expect(rows.map((r) => r.direction)).toEqual(["inbound", "inbound"]);
    expect(rows.every((r) => r.externalId?.startsWith(QR_TURN_OPEN_PREFIX))).toBe(true);
    second.resolve(draft(BOTH_A) as never);
    expect((await r2).body).toMatchObject({ reply: BOTH_A });
    rows = await thread(s.propertyId);
    expect(rows.filter((r) => r.direction === "outbound").map((r) => r.body)).toEqual([BOTH_A]);
  });

  it("Wi-Fi cevabı zaten gittiyse ikinci cevap YALNIZ yeni soruyu kapsar", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValueOnce(draft(WIFI_A) as never);
    const a = await ask(s.token, WIFI_Q);
    mockSuggest.mockResolvedValueOnce(draft("Çöpü her akşam kapının önüne bırakabilirsiniz.") as never);
    await ask(s.token, TRASH_Q, a.cookie);
    const second = mockSuggest.mock.calls[1]![0];
    expect(second.guestMessage).toBe(TRASH_Q);
    expect((second.history ?? []).map((m: { body: string }) => m.body)).toEqual([WIFI_Q, WIFI_A]);
  });

  it("ev sahibine bırakılmış önceki mesaj sonraki tura KATILMAZ (sıralı yazışma bugünkü gibi)", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValueOnce(draft("Bu konuda bilgim yok.", { confidence: 0.2 }) as never);
    const a = await ask(s.token, "Ütü var mı?");
    expect(a.body).toMatchObject({ escalated: true, reply: null });
    mockSuggest.mockResolvedValueOnce(draft(WIFI_A) as never);
    const b = await ask(s.token, WIFI_Q, a.cookie);
    expect(b.body.reply).toBe(WIFI_A);
    expect(mockSuggest.mock.calls[1]![0].guestMessage).toBe(WIFI_Q);
  });

  it("🚨 devir kararı daha yeni mesaj yüzünden DÜŞMEZ; taslağı o mesajı da kapsayan cevap gitmez, kalan mesaj ev sahibinde (kısmi gönderim yok)", async () => {
    const s = await seedQr();
    const open = await bind(s);
    const first = deferred<never>();
    const second = deferred<never>();
    mockSuggest.mockImplementationOnce(() => first.promise);
    mockSuggest.mockImplementationOnce(() => second.promise);
    const r1 = ask(s.token, "Ütü var mı?", open);
    await until(() => mockSuggest.mock.calls.length === 1, "ilk istek modelde");
    const r2 = ask(s.token, WIFI_Q, open);
    await until(() => mockSuggest.mock.calls.length === 2, "ikinci istek modelde");
    // İlk isteğin kararı DEVİR (düşük güven): daha yeni mesaj olsa da yazılır.
    first.resolve(draft("Bu konuda bilgim yok.", { confidence: 0.2 }) as never);
    expect((await r1).body).toMatchObject({ escalated: true, reply: null });
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId: s.propertyId, channel: "chat" }, select: { id: true, priority: true } });
    expect(conv.priority).toBe("urgent");
    let rows = await thread(s.propertyId);
    expect(rows.map((r) => r.externalId?.startsWith(QR_TURN_OPEN_PREFIX))).toEqual([false, true]);
    // İkinci isteğin taslağı iki mesajı birlikte cevaplıyordu; ilki bu arada ev sahibine bırakıldı → cevap gitmez.
    second.resolve(draft(BOTH_A) as never);
    expect((await r2).body).toMatchObject({ escalated: true, reply: null });
    rows = await thread(s.propertyId);
    expect(rows.filter((r) => r.direction === "outbound")).toEqual([]);
    expect(rows.every((r) => r.externalId?.startsWith("qr:"))).toBe(true);
    const events = await prisma.riskEvent.findMany({ where: { conversationId: conv.id }, select: { reason: true, finalDecision: true, triggerId: true } });
    // İki karar da kayıtlı: ilk mesajın deviri (kapının kendi gerekçesiyle) + ikinci isteğin "tur değişti" deviri — ikisi de insan incelemesi.
    expect(events.every((e) => e.finalDecision === "human_review")).toBe(true);
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.reason === "qr_turn_changed").map((e) => e.triggerId)).toEqual([rows[1]!.id]);
    expect(events.find((e) => e.reason !== "qr_turn_changed")!.triggerId).toBe(rows[0]!.id);
  });

  it("daha yeni mesaj ücretli adımdan ÖNCE geldiyse eski tur modeli hiç çağırmaz", async () => {
    const s = await seedQr();
    const open = await bind(s);
    const gate = deferred<void>();
    const real = mockLimits.getMockImplementation()!;
    mockLimits.mockImplementationOnce(async (...args) => {
      await gate.promise;
      return real(...args);
    });
    mockSuggest.mockResolvedValue(draft(BOTH_A) as never);
    const r1 = ask(s.token, WIFI_Q, open);
    await until(async () => (await thread(s.propertyId)).length === 1, "ilk mesaj kayıtlı");
    const r2 = await ask(s.token, TRASH_Q, open);
    expect(r2.body.reply).toBe(BOTH_A);
    gate.resolve();
    expect((await r1).body).toEqual({ merged: true });
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(mockSuggest.mock.calls[0]![0].guestMessage).toBe(`${WIFI_Q}\n${TRASH_Q}`);
    // Bırakılan isteğin tekrar denemesi yeni iş açmaz (mesaj kayıtlı).
    expect((await thread(s.propertyId)).filter((r) => r.direction === "inbound")).toHaveLength(2);
  });

  it("model hatasında mesaj kaybolmaz; aynı istek kimliğiyle tekrar deneme satırı İKİNCİ kez yazmaz ve cevaplar", async () => {
    const s = await seedQr();
    const open = await bind(s);
    const rid = newId();
    mockSuggest.mockRejectedValueOnce(new Error("model düştü"));
    const failed = await ask(s.token, WIFI_Q, open, rid);
    expect(failed.status).toBe(500);
    let rows = await thread(s.propertyId);
    expect(rows.map((r) => [r.direction, r.externalId])).toEqual([["inbound", `${QR_TURN_OPEN_PREFIX}${rid}`]]);
    mockSuggest.mockResolvedValueOnce(draft(WIFI_A) as never);
    const retried = await ask(s.token, WIFI_Q, open, rid);
    expect(retried.body.reply).toBe(WIFI_A);
    rows = await thread(s.propertyId);
    expect(rows.map((r) => [r.direction, r.body])).toEqual([["inbound", WIFI_Q], ["outbound", WIFI_A]]);
    // Kaydedilmiş isteğin geç tekrarı: yeni iş yok.
    const again = await ask(s.token, WIFI_Q, open, rid);
    expect(again.body).toEqual({ deduped: true });
    expect(mockSuggest).toHaveBeenCalledTimes(2);
  });

  it("sahipsiz kalmış eski açık mesaj yeni tura katılmaz; ev sahibine bırakılır (sessiz kalmaz)", async () => {
    const s = await seedQr();
    const open = await bind(s);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId: s.propertyId, channel: "chat" }, select: { id: true } });
    const stale = await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "inbound",
        authorType: "guest",
        senderName: "Zeynep Kaya",
        body: "Yarın geç çıkabilir miyiz?",
        externalId: `${QR_TURN_OPEN_PREFIX}orphan-1`,
        createdAt: new Date(Date.now() - QR_TURN_FRESH_MS - 60_000),
      },
    });
    mockSuggest.mockResolvedValueOnce(draft(WIFI_A) as never);
    const out = await ask(s.token, WIFI_Q, open);
    expect(out.body.reply).toBe(WIFI_A);
    expect(mockSuggest.mock.calls[0]![0].guestMessage).toBe(WIFI_Q);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: stale.id } })).externalId).toBe("qr:orphan-1");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).priority).toBe("urgent");
    expect(await prisma.riskEvent.count({ where: { triggerId: stale.id, reason: "qr_turn_abandoned", finalDecision: "human_review" } })).toBe(1);
  });

  it("taze açık mesaj (süren başka istek) tura KATILIR — sahipsizlik yalnız süreyle", async () => {
    const s = await seedQr();
    const open = await bind(s);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId: s.propertyId, channel: "chat" }, select: { id: true } });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "inbound",
        authorType: "guest",
        senderName: "Zeynep Kaya",
        body: TRASH_Q,
        externalId: `${QR_TURN_OPEN_PREFIX}fresh-1`,
        createdAt: new Date(Date.now() - QR_TURN_FRESH_MS + 60_000),
      },
    });
    mockSuggest.mockResolvedValueOnce(draft(BOTH_A) as never);
    await ask(s.token, WIFI_Q, open);
    expect(mockSuggest.mock.calls[0]![0].guestMessage).toBe(`${TRASH_Q}\n${WIFI_Q}`);
  });

  it("uzun cevap iki mesaja bölünür (kapılar tek metni görür); kısa cevap bölünmez", async () => {
    const s = await seedQr();
    const para = (n: number) => `Çöpü her akşam kapının önüne bırakabilirsiniz, görevli arkadaşımız ${n}. kattan başlayarak topluyor.`;
    const long = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(para).join("\n\n");
    expect(long.length).toBeGreaterThan(700);
    mockSuggest.mockResolvedValueOnce(draft(long) as never);
    const out = await ask(s.token, TRASH_Q);
    expect(out.body.reply).toBe(long);
    const rows = (await thread(s.propertyId)).filter((r) => r.direction === "outbound");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.body).join("\n\n")).toBe(long);
    expect(rows[0]!.createdAt.getTime()).toBeLessThan(rows[1]!.createdAt.getTime());
    // Konuşmanın son mesaj anı ikinci parçanın anı (liste sırası / kapanış izi son mesaja göre).
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId: s.propertyId, channel: "chat" }, select: { lastMessageAt: true } });
    expect(conv.lastMessageAt.getTime()).toBe(rows[1]!.createdAt.getTime());
  });

  it("ev sahibi model düşünürken devraldıysa cevap gitmez; mesaj ev sahibinde, tur kapanır", async () => {
    const s = await seedQr();
    const open = await bind(s);
    mockSuggest.mockImplementationOnce(async () => {
      const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId: s.propertyId, channel: "chat" }, select: { id: true } });
      await prisma.message.create({
        data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Ben ilgileniyorum.", createdAt: new Date(Date.now() + 5) },
      });
      return draft(WIFI_A) as never;
    });
    const out = await ask(s.token, WIFI_Q, open);
    expect(out.body).toEqual({ handoff: true });
    const rows = await thread(s.propertyId);
    expect(rows.some((r) => r.body === WIFI_A)).toBe(false);
    expect(rows.find((r) => r.direction === "inbound")!.externalId?.startsWith("qr:")).toBe(true);
  });

  it("teşekkür + hemen ardından soru: sessiz kapanış kararı yeni mesaj varken yazılmaz, soru cevaplanır", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValueOnce(draft(WIFI_A) as never);
    const a = await ask(s.token, WIFI_Q);
    // "Teşekkürler" isteği kapanış kararını yazmadan önce yeni soru kaydedilir: plan sınırı okumasında değil, kapanış okumasında beklet.
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId: s.propertyId, channel: "chat" }, select: { id: true } });
    await prisma.message.create({
      data: { conversationId: conv.id, direction: "inbound", authorType: "guest", senderName: "Zeynep Kaya", body: "Teşekkürler", externalId: `${QR_TURN_OPEN_PREFIX}thanks-1`, createdAt: new Date(Date.now() + 10) },
    });
    mockSuggest.mockResolvedValueOnce(draft("Çöpü her akşam kapının önüne bırakabilirsiniz.") as never);
    const b = await ask(s.token, TRASH_Q, a.cookie);
    expect(b.body.reply).toBe("Çöpü her akşam kapının önüne bırakabilirsiniz.");
    expect(mockSuggest.mock.calls[1]![0].guestMessage).toBe(`Teşekkürler\n${TRASH_Q}`);
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id }, select: { skippedReason: true } });
    expect(after.skippedReason).toBeNull();
  });

  /** Cihazı bağlayan (çerez veren) ve iz bırakmayan açılış: kapanış / selam turu olmasın diye mesajlar silinir. */
  async function bind(s: { token: string; propertyId: string }): Promise<string> {
    mockSuggest.mockResolvedValueOnce(draft(WIFI_A) as never);
    const first = await ask(s.token, "Merhaba");
    await prisma.message.deleteMany({ where: { conversation: { propertyId: s.propertyId } } });
    await prisma.riskEvent.deleteMany({});
    await prisma.conversation.updateMany({ where: { propertyId: s.propertyId }, data: { priority: "standard", skippedReason: null } });
    mockSuggest.mockReset();
    return first.cookie!;
  }
});
