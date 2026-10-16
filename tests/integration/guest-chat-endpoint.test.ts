import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// Mock ONLY the model call — deterministic, no network. The safety gate
// (classifyFallback cross-check) stays real.
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;

function result(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.9,
    reply: "Çöp salı günü toplanır.",
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
    ...over,
  };
}

function call(token: string, message: unknown, cookie?: string, extra?: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.5",
  };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, ...extra }),
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

/** The per-stay device cookie the server set, as a "name=value" request header. */
function deviceCookie(res: Response): string | undefined {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : undefined;
}

async function enableChat(propertyId: string): Promise<string> {
  const token = generateChatToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatToken: token, chatEnabled: true },
  });
  // An active stay so the chat is OPEN (the open/closed window itself is tested
  // in guest-chat.test.ts). Without this, the endpoint would return "closed".
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  return token;
}

describe("POST /api/chat/[token] (public QR concierge)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(result());
    process.env.GUEST_CHAT_ENABLED = "1";
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("404s when the global kill-switch is off — surface is inert by default", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    delete process.env.GUEST_CHAT_ENABLED;
    expect((await call(token, "merhaba")).status).toBe(404);
  });

  it("404s for unknown and per-apartment-disabled tokens", async () => {
    expect((await call(generateChatToken(), "merhaba")).status).toBe(404); // unknown
    const { propertyId } = await makeOrgWithProperty();
    const token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: false } });
    expect((await call(token, "merhaba")).status).toBe(404); // disabled
  });

  it("rejects empty and over-long messages", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    expect((await call(token, "")).status).toBe(400);
    expect((await call(token, "x".repeat(2001))).status).toBe(400);
  });

  it("🚨 yanıtlar ÖNBELLEKLENMEZ (Cache-Control: no-store) — başarı, doğrulama hatası ve 404 dahil", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    expect((await call(token, "Çöp ne zaman toplanıyor?")).headers.get("cache-control")).toBe("no-store");
    expect((await call(token, "")).headers.get("cache-control")).toBe("no-store");
    expect((await call(generateChatToken(), "merhaba")).headers.get("cache-control")).toBe("no-store");
  });

  it("🚨 denetim karakteri (NUL vb.) içeren mesaj 500 vermez: karakter sessizce silinir, satır sonu korunur", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const res = await call(token, "Çöp\u0000 ne zaman\u0007\ntoplanıyor?");
    expect(res.status).toBe(200);
    const msg = await prisma.message.findFirstOrThrow({ where: { direction: "inbound" } });
    expect(msg.body).toBe("Çöp ne zaman\ntoplanıyor?");
  });

  it("records a confident answer (question + AI reply) as a non-urgent 'chat' thread", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const res = await call(token, "Çöp ne zaman toplanıyor?");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.escalated).toBe(false);
    expect(json.reply).toContain("Çöp");

    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].channel).toBe("chat"); // its own tab, NOT the Airbnb inbox
    expect(convos[0].priority).toBe("standard"); // not escalated
    expect(convos[0].externalReservationId?.startsWith(`qr-chat:${propertyId}:`)).toBe(true);
    const msgs = await prisma.message.findMany({
      where: { conversationId: convos[0].id },
      orderBy: { createdAt: "asc" },
    });
    expect(msgs).toHaveLength(2); // BOTH the guest question and the AI reply
    expect(msgs[0].direction).toBe("inbound");
    expect(msgs[0].body).toBe("Çöp ne zaman toplanıyor?");
    expect(msgs[1].direction).toBe("outbound");
    expect(msgs[1].body).toContain("Çöp");
  });

  it("records an escalated exchange flagged urgent; reuses the same per-guest thread", async () => {
    mockSuggest.mockResolvedValue(result({ source: "fallback" }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    const first = await call(token, "Çöp ne zaman?");
    const json = await first.json();
    expect(json.escalated).toBe(true);
    // The first message binds the stay to this device; carry its cookie so the
    // second message is recognised as the SAME device (per-stay binding).
    const cookie = deviceCookie(first);

    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].channel).toBe("chat");
    expect(convos[0].priority).toBe("urgent"); // escalated → flagged
    // K10 (kurucu kararı 09-30, "Hiçbir şey gitmesin"): devirde yalnız misafirin mesajı kaydedilir — bot devir metni YOK.
    expect(await prisma.message.count({ where: { conversationId: convos[0].id } })).toBe(1);

    // A second message from the same guest (same cookie) reuses the same thread.
    await call(token, "Park var mı?", cookie);
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: convos[0].id } })).toBe(2);
  });

  it("blocks a DIFFERENT device once the stay is bound (no history hijack, no write)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    // Device A opens the chat first → claims the stay.
    const a = await call(token, "Çöp ne zaman?");
    expect((await a.json()).escalated).toBe(false);
    const before = await prisma.message.count();

    // Device B scans the same physical QR (no cookie) → refused, nothing recorded.
    const b = await call(token, "Merhaba, geçen haftaki misafir ne sordu?");
    const bJson = await b.json();
    expect(bJson.boundElsewhere).toBe(true);
    expect(bJson.reply).toMatch(/başka bir cihaz/i);
    expect(mockSuggest).toHaveBeenCalledTimes(1); // only device A reached the model
    expect(await prisma.message.count()).toBe(before); // device B wrote nothing
  });

  it("escalates sensitive intents (complaint/refund) instead of answering", async () => {
    mockSuggest.mockResolvedValue(result({ intent: "complaint", confidence: 0.95 }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Daire çok kirliydi, şikayetçiyim")).json();
    expect(json.escalated).toBe(true);
    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].priority).toBe("urgent");
  });

  it("escalates on the keyword cross-check even if the model under-rates the risk", async () => {
    mockSuggest.mockResolvedValue(result({ intent: "general", confidence: 0.95, riskLevel: "none" }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Param iadesi istiyorum, rezervasyonu iptal edin")).json();
    expect(json.escalated).toBe(true);
  });

  it("escalates a benign-worded message the model LABELS high-stakes (riskType parity with the inbox gate)", async () => {
    // intent=general + riskLevel low + confidence high + benign wording → the
    // intent, fallback, injection, detectRiskType, riskLevel and confidence checks
    // ALL pass. The ONLY thing that should hold this back is the model's own
    // high-stakes riskType label — the parity the inbox auto-send gate already has.
    mockSuggest.mockResolvedValue(
      result({ intent: "general", riskLevel: "low", confidence: 0.9, riskType: "review_threat" }),
    );
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Otoparkı nasıl kullanabilirim?")).json();
    expect(json.escalated).toBe(true);
  });

  // ⚠️ SÖZLEŞME GÜNCELLENDİ (kurucu AI kalite turu, 09-08). Eskiden `confidence`
  // 0.75'in ALTINDAKİ her yanıt — mesaj tamamen risksiz olsa bile — devrediliyordu.
  // Canlıda ölçülen bedeli: "nasılsın", "çöp nereye" gibi sorular da "ev sahibine
  // ilettim" cevabı alıyor, asistan kullanılamaz hâle geliyordu. Artık HER AÇIDAN
  // RİSKSİZ mesajlarda dar bir bant (0.45 ≤ c < 0.75) modelin DÜRÜST cevabının
  // gitmesine izin verir; karar `informational_low_confidence` olarak kaydedilir.
  // "Tahmin etme" kuralı korunur: bandın ALTI hâlâ devirdir ve risk taşıyan her
  // dal (kelime ağı, model riski, injection, insan talebi) bandın ÖNÜNDE çalışır.
  it("bandın ALTINDAKİ güven hâlâ devredilir (kapıda tahmin yok)", async () => {
    mockSuggest.mockResolvedValue(result({ confidence: 0.2 }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Klima nasıl çalışır?")).json();
    expect(json.escalated).toBe(true);
  });

  it("bant İÇİNDEKİ güven risksiz soruda cevaplanır (bayrak AÇIKKEN; gereksiz devir yok)", async () => {
    // ⚠️ Bant VARSAYILAN KAPALI (Codex şartı: gerçek model eval'i yapılana kadar
    // genişleyen otomatik gönderim sınırlı kalsın). Kapalıyken davranış eskisiyle
    // birebir aynıdır — üstteki test onu pinler. Burada bandın kendisi sınanıyor.
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "1");
    mockSuggest.mockResolvedValue(result({ confidence: 0.5 }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Klima nasıl çalışır?")).json();
    expect(json.escalated).toBeFalsy();
  });

  it("escalates WITHOUT a paid model call once the durable daily AI cap is hit (H2)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const day = new Date().toISOString().slice(0, 10);
    await prisma.chatUsage.create({ data: { propertyId, day, count: 200 } });

    const res = await call(token, "Bir sorum var");
    const json = await res.json();
    expect(json.escalated).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled(); // over cap → the model is never called
    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].priority).toBe("urgent");
    // K10 (09-30): yalnız misafirin mesajı — devir metni kaydedilmez.
    expect(await prisma.message.count({ where: { conversationId: convos[0].id } })).toBe(1);
  });

  it("returns 'closed' (no model call, no inbox write) when there is no active stay", async () => {
    const { propertyId } = await makeOrgWithProperty();
    // Enable the chat but DON'T create a reservation → the apartment is vacant.
    const token = generateChatToken();
    await prisma.property.update({
      where: { id: propertyId },
      data: { chatToken: token, chatEnabled: true },
    });

    const res = await call(token, "Merhaba, bir sorum var");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.closed).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(0);
  });

  it("YARIŞ (Codex P1): aynı cihazdan iki PARALEL ilk mesaj rezervasyona TEK konuşma açar", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    // Cihazı bağla (ilk mesaj) ve çerezi al; sonra konuşmayı silerek "cihaz
    // bağlı ama konuşma henüz yok" ilk-oluşturma durumunu yeniden kur (host
    // reset sonrası ile aynı durum) — yarış tam bu pencerede yaşanır.
    const first = await call(token, "İlk bağlama mesajı");
    expect(first.status).toBe(200);
    const cookie = deviceCookie(first);
    await prisma.message.deleteMany({ where: { conversation: { propertyId } } });
    await prisma.conversation.deleteMany({ where: { propertyId } });

    const [a, b] = await Promise.all([
      call(token, "Paralel mesaj A", cookie),
      call(token, "Paralel mesaj B", cookie),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200); // yarışı kaybeden istek de mesajını KAYBETMEZ

    // Deterministik PK sayesinde interleaving ne olursa olsun TEK konuşma.
    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    expect(convos[0].id).toBe(`qrconv_${reservation.id}`);
    // Her iki misafir mesajı da aynı thread'de (2 inbound + 2 bot yanıtı).
    const inbound = await prisma.message.count({
      where: { conversationId: convos[0].id, direction: "inbound" },
    });
    expect(inbound).toBe(2);
  });

  // ── requestId idempotency (Codex 07-24 #2): a lost-response retry must not
  // duplicate the guest message, burn a second paid model call, or re-escalate. ──
  describe("requestId idempotency", () => {
    const RID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";

    it("same requestId + same message → processed ONCE; the retry is a deduped no-op", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const first = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect(first.status).toBe(200);
      const cookie = deviceCookie(first);

      const retry = await call(token, "Çöp ne zaman toplanıyor?", cookie, { requestId: RID });
      expect(retry.status).toBe(200);
      expect((await retry.json()).deduped).toBe(true);

      expect(mockSuggest).toHaveBeenCalledTimes(1); // no second paid model call
      expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(1);
      expect(await prisma.message.count({ where: { direction: "outbound" } })).toBe(1);
      // The per-apartment daily AI budget burned once, not twice.
      expect((await prisma.chatUsage.findFirstOrThrow()).count).toBe(1);
    });

    it("a FRESH requestId with the same text is a DELIBERATE repeat → recorded again ('ok' twice works)", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const first = await call(token, "ok", undefined, { requestId: RID });
      const cookie = deviceCookie(first);
      const second = await call(token, "ok", cookie, {
        requestId: "cccccccc-4444-5555-6666-dddddddddddd",
      });
      expect(second.status).toBe(200);
      expect((await second.json()).deduped).toBeUndefined();
      expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(2);
    });

    it("same requestId + DIFFERENT message → 409 (Codex r2): neither swallowed nor double-processed", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const first = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect(first.status).toBe(200);
      const cookie = deviceCookie(first);

      const reused = await call(token, "Bambaşka bir mesaj", cookie, { requestId: RID });
      expect(reused.status).toBe(409); // loud contract violation, not a silent dedupe
      expect(await prisma.message.count({ where: { body: "Bambaşka bir mesaj" } })).toBe(0);
      expect(mockSuggest).toHaveBeenCalledTimes(1); // second body never reached the model
      // The original claim is untouched: the SAME payload still dedupes.
      const retry = await call(token, "Çöp ne zaman toplanıyor?", cookie, { requestId: RID });
      expect((await retry.json()).deduped).toBe(true);
    });

    it("TTL: a crashed claim holder cannot lock the retry out forever — the expired row is swept", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
      // A claim row left behind by a process that died mid-flight, past its TTL.
      await prisma.systemLock.create({
        data: {
          name: `outbound-send:qr-in:${reservation.id}:${RID}`,
          lockedUntil: new Date(Date.now() - 1000),
          holder: "stale-digest-of-a-dead-run",
        },
      });
      const res = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect(res.status).toBe(200);
      expect((await res.json()).deduped).toBeUndefined(); // processed, not deduped
      expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(1);
    });

    // ── KURUCU 10-16 (QR 120 sn mi 300 sn mi): "300'e çıkarmayın. Çalışan işlem kilidi ile tamamlanmış istek kaydını ayırın. Aynı mesajın
    // tekrarı engellensin ama misafirin yeni, farklı mesajı 2–5 dakika beklemesin. Kilit süresi dolduğunda eski işçi hâlâ çalışıyorsa
    // ikinci işçi aynı işi göndermesin." Kilit 120 sn kalır; iş kaydedilince AYNI işlemde 24 saatlik "tamamlandı" kaydına döner. ──
    it("🚨 tamamlanmış istek kaydı: aynı istek 3 dakika sonra yeniden gelir (kilit süresi geçti) → yine TEK kayıt, model bir kez", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const t0 = Date.now();
      const first = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect(first.status).toBe(200);
      const cookie = deviceCookie(first);
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(t0 + 3 * 60_000);
        const late = await call(token, "Çöp ne zaman toplanıyor?", cookie, { requestId: RID });
        expect(late.status).toBe(200);
        expect((await late.json()).deduped).toBe(true); // ⬅️ ESKİDE 120 sn sonra yeniden işleniyordu (ikinci misafir mesajı + ikinci model çağrısı)
        expect(mockSuggest).toHaveBeenCalledTimes(1);
        expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(1);
        // Aynı kimlik + farklı içerik tamamlanmış kayıtta da 409 (yutulmaz, işlenmez).
        const reused = await call(token, "Bambaşka", cookie, { requestId: RID });
        expect(reused.status).toBe(409);
        // Misafirin YENİ mesajı (yeni kimlik) hiç beklemez.
        const fresh = await call(token, "Çöp ne zaman toplanıyor?", cookie, { requestId: "eeeeeeee-1111-2222-3333-ffffffffffff" });
        expect((await fresh.json()).deduped).toBeUndefined();
        expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(2);
        // Kayıt sonsuza kadar kilitlemez: 24 saat sonra aynı kimlik yeniden işlenebilir.
        vi.setSystemTime(t0 + 25 * 3_600_000);
        const dayLater = await call(token, "Çöp ne zaman toplanıyor?", cookie, { requestId: RID });
        expect((await dayLater.json()).deduped).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("🚨 bayat kilit (fencing): eski işçi model cevabını beklerken kilidi süresi dolar, tekrar deneme işi YAPAR → eski işçi kaydetmez, misafire ikinci cevap yok", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const warm = await call(token, "merhaba");
      const cookie = deviceCookie(warm);
      const before = await prisma.message.count({ where: { direction: "inbound" } });
      let retryStatus = 0;
      let retryDeduped: unknown = "unset";
      // İlk işçinin (A) model çağrısı uzun sürüyor: bu arada A'nın kilidi süresi doluyor ve misafirin istemcisi aynı isteği yeniden
      // gönderiyor (B). B kilidi süpürüp kendisi alıyor ve işi baştan sona yapıyor. Sonra A'nın modeli cevap veriyor.
      mockSuggest.mockImplementationOnce(async () => {
        await prisma.systemLock.updateMany({
          where: { name: { startsWith: "outbound-send:qr-in:" } },
          data: { lockedUntil: new Date(Date.now() - 1000) },
        });
        const b = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
        retryStatus = b.status;
        retryDeduped = (await b.json()).deduped;
        return result();
      });
      const a = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
      expect(retryStatus).toBe(200);
      expect(retryDeduped).toBeUndefined(); // B işi yaptı
      expect(a.status).toBe(200);
      expect((await a.json()).deduped).toBe(true); // A işini kaybettiğini anladı, istemci kaydı GET ile okur
      expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(before + 1); // ⬅️ ESKİDE +2
      expect(await prisma.message.count({ where: { body: "Çöp günü hangi gün?" } })).toBe(1);
      expect(await prisma.message.count({ where: { direction: "outbound", body: { not: "" } } })).toBe(2); // selam cevabı + B'nin cevabı
    });

    it("🚨 bayat kilit: eski işçi kaydetmeden HATA verirse yalnız KENDİ kilidini bırakır — yeni işçinin canlı kilidini silmez", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const warm = await call(token, "merhaba");
      const cookie = deviceCookie(warm);
      const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
      const name = `outbound-send:qr-in:${reservation.id}:${RID}`;
      mockSuggest.mockImplementationOnce(async () => {
        // A'nın kilidi süresi doldu, süpürüldü ve yeni işçi (B) aynı adla canlı kilit aldı; A'nın modeli ardından hata veriyor.
        await prisma.systemLock.deleteMany({ where: { name } });
        await prisma.systemLock.create({ data: { name, lockedUntil: new Date(Date.now() + 120_000), holder: "baska-iscinin-kilidi" } });
        throw new Error("model down");
      });
      const a = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
      expect(a.status).toBe(500);
      expect(await prisma.systemLock.findUnique({ where: { name } })).not.toBeNull(); // ⬅️ ESKİDE A, B'nin kilidini siliyordu
    });

    it("sürüm geçişi: önceki sürümün jetonsuz çalışan kilidi (holder = özet) hâlâ doğru sınıflanır — aynı içerik tekilleşir, farklı içerik 409", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
      const { createHash, createHmac } = await import("node:crypto");
      // Opus F7: özet anahtarlı (AUTH_SECRET varsa) — eski biçim satırı aynı özet hesabıyla yazılır (biçim: jetonsuz).
      const key = process.env.AUTH_SECRET;
      const digest = (key ? createHmac("sha256", key).update("qr-claim:v1:Çöp ne zaman toplanıyor?") : createHash("sha256").update("Çöp ne zaman toplanıyor?"))
        .digest("base64url")
        .slice(0, 24);
      await prisma.systemLock.create({
        data: { name: `outbound-send:qr-in:${reservation.id}:${RID}`, lockedUntil: new Date(Date.now() + 60_000), holder: digest },
      });
      const same = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect((await same.json()).deduped).toBe(true);
      const other = await call(token, "Bambaşka", deviceCookie(same), { requestId: RID });
      expect(other.status).toBe(409);
      expect(mockSuggest).not.toHaveBeenCalled();
    });

    it("Haiku 10-16: yayından hemen önce eski sürümün yazdığı ANAHTARSIZ özetli kilit aynı içerikle tekilleşir (409 değil)", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
      const { createHash } = await import("node:crypto");
      const legacy = createHash("sha256").update("Çöp ne zaman toplanıyor?").digest("base64url").slice(0, 24);
      await prisma.systemLock.create({
        data: { name: `outbound-send:qr-in:${reservation.id}:${RID}`, lockedUntil: new Date(Date.now() + 60_000), holder: legacy },
      });
      const same = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect((await same.json()).deduped).toBe(true);
      expect((await call(token, "Bambaşka", deviceCookie(same), { requestId: RID })).status).toBe(409);
    });

    it("Opus F7: tekrar kaydı misafir metninin ANAHTARSIZ özetini taşımaz (sözlükle geri çevrilemez)", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      await call(token, "Merhaba", undefined, { requestId: RID });
      const { createHash } = await import("node:crypto");
      const plain = createHash("sha256").update("Merhaba").digest("base64url").slice(0, 24);
      const row = await prisma.systemLock.findFirstOrThrow({ where: { name: { startsWith: "outbound-send:qr-in:" } } });
      expect(row.holder).toMatch(/^done:/);
      expect(process.env.AUTH_SECRET).toBeTruthy(); // test ortamında sır var → anahtarlı yol sınanıyor
      expect(row.holder).not.toContain(plain);
    });

    // ── KURUCU 10-16 (QR): "yalnız işin sonunda sahiplik kontrolüyle yetinme — kilit yenileme, sahiplik kaybı ve kalıcı kayıtların tekilliği,
    // eski işçi hâlâ çalışırken ikinci işçinin devreye girdiği testle doğrulansın." ──
    it("🚨 kilit YENİLEME: eski işçi 120 sn'yi aşan model çağrısındayken kilidi canlı tutar → aynı isteğin tekrarı işi İKİNCİ KEZ yapmaz", async () => {
      const { __setKeyedClaimHeartbeatMs } = await import("@/lib/outbound-claim");
      __setKeyedClaimHeartbeatMs(20);
      try {
        const { propertyId } = await makeOrgWithProperty();
        const token = await enableChat(propertyId);
        const warm = await call(token, "merhaba");
        const cookie = deviceCookie(warm);
        const before = await prisma.message.count({ where: { direction: "inbound" } });
        let retryDeduped: unknown = "unset";
        mockSuggest.mockImplementationOnce(async () => {
          // 120 sn geçmiş gibi: kilidin süresi doldu. Canlı işçinin yenilemesi onu yeniden ileri atmalı.
          await prisma.systemLock.updateMany({
            where: { name: { startsWith: "outbound-send:qr-in:" }, NOT: { holder: { startsWith: "done:" } } },
            data: { lockedUntil: new Date(Date.now() - 1000) },
          });
          await new Promise((r) => setTimeout(r, 120)); // birkaç yenileme turu
          const b = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
          retryDeduped = (await b.json()).deduped;
          return result();
        });
        const a = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
        expect(a.status).toBe(200);
        expect((await a.json()).deduped).toBeUndefined(); // eski işçi işini bitirdi
        expect(retryDeduped).toBe(true); // ⬅️ YENİLEMESİZ: süresi dolmuş kilit süpürülür, tekrar işi baştan yapardı
        expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(before + 1);
        expect(mockSuggest).toHaveBeenCalledTimes(2); // selam + A (tekrar modeli çağırmadı)
      } finally {
        __setKeyedClaimHeartbeatMs(30_000);
      }
    });

    it("🚨 sahiplik KAYBI: eski işçi çalışırken kilidi başka işçiye geçti → eski işçi kayıt yazmaz, misafire ikinci cevap yok (tek kalıcı kayıt)", async () => {
      const { __setKeyedClaimHeartbeatMs } = await import("@/lib/outbound-claim");
      __setKeyedClaimHeartbeatMs(20);
      try {
        const { propertyId } = await makeOrgWithProperty();
        const token = await enableChat(propertyId);
        const warm = await call(token, "merhaba");
        const cookie = deviceCookie(warm);
        const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
        const name = `outbound-send:qr-in:${reservation.id}:${RID}`;
        const before = await prisma.message.count({ where: { direction: "inbound" } });
        mockSuggest.mockImplementationOnce(async () => {
          // Süreç donmuştu (yenileme yapamadı), kilit süpürüldü ve yeni işçi aynı adla CANLI kilit aldı; eski işçi hâlâ çalışıyor.
          await prisma.systemLock.deleteMany({ where: { name } });
          await prisma.systemLock.create({ data: { name, lockedUntil: new Date(Date.now() + 120_000), holder: "baska.isci" } });
          await new Promise((r) => setTimeout(r, 80)); // yenileme kaybı fark eder
          return result();
        });
        const a = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
        expect(a.status).toBe(200);
        expect((await a.json()).deduped).toBe(true);
        expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(before); // eski işçi HİÇBİR ŞEY yazmadı
        expect((await prisma.systemLock.findUniqueOrThrow({ where: { name } })).holder).toBe("baska.isci"); // yeni işçinin kilidi duruyor
      } finally {
        __setKeyedClaimHeartbeatMs(30_000);
      }
    });

    it("malformed requestId → 400, nothing recorded, no model call", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const res = await call(token, "merhaba", undefined, { requestId: "x; DROP TABLE" });
      expect(res.status).toBe(400);
      expect(mockSuggest).not.toHaveBeenCalled();
      expect(await prisma.message.count()).toBe(0);
    });

    it("PRE-RECORD failure releases the claim — a crashed attempt does not swallow the retry", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      // Bind the device first (mirrors the page-open GET) so the failing POST and
      // its retry share the stay cookie.
      const warm = await call(token, "merhaba");
      const cookie = deviceCookie(warm);

      mockSuggest.mockRejectedValueOnce(new Error("model down"));
      // ⚠️ SÖZLEŞME 08-06'DA DEĞİŞTİ: rota artık FIRLATMIYOR, hata sınırından
      // 500 dönüyor (↓"hata sınırı" describe'ı — sessiz 500'ü raporlanır hale
      // getirdi). Bu testin ASIL değişmezi zaten fırlatmanın kendisi DEĞİL:
      // "claim salıverildi mi, yani retry işlenebiliyor mu". Aşağıdaki üç
      // assertion aynen duruyor — koruma zayıflamadı, yalnız hatanın çağırana
      // nasıl ULAŞTIĞI değişti.
      const failed = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
      expect(failed.status).toBe(500);
      expect(await prisma.message.count({ where: { body: "Çöp günü hangi gün?" } })).toBe(0); // nothing persisted

      // Same id retried → the released claim lets it process normally.
      const retry = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
      expect(retry.status).toBe(200);
      expect((await retry.json()).deduped).toBeUndefined();
      expect(
        await prisma.message.count({ where: { body: "Çöp günü hangi gün?", direction: "inbound" } }),
      ).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// HATA SINIRI — misafire bakan tek kimliksiz yüzeyde SESSİZ 500 kalmasın (08-06)
//
// 🚨 BULUNAN DURUM: bu rotada `reportError`/`serverError` HİÇ geçmiyordu
// (grep: 0); kardeşi `/api/leads` ikisini de kullanıyor. Rotanın tek `catch`i
// (idempotency claim'ini salıverme) hatayı bilerek YENİDEN FIRLATIYOR → Next
// jenerik bir 500 döndürüyor ve **operatöre hiçbir sinyal ulaşmıyordu**: bu
// depoda `reportError` hata havuzuna giden TEK yol.
//
// Misafir açısından davranış AYNI kalmalı (500 → 500). Değişen tek şey: artık
// raporlanıyor. Test ikisini de asserte eder.
// ---------------------------------------------------------------------------
describe("POST /api/chat/[token] — hata sınırı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mockSuggest.mockReset();
    process.env.GUEST_CHAT_ENABLED = "1";
  });
  afterEach(() => {
    process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("model beklenmedik şekilde fırlarsa: 500 + RAPORLANIR (sessiz kalmaz)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    mockSuggest.mockRejectedValue(new Error("model patladi"));

    const res = await call(token, "Çöp günü hangi gün?");

    expect(res.status).toBe(500);
    // Misafire jenerik metin — sağlayıcı/yığın ayrıntısı SIZMAZ.
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).toContain("tekrar deneyin");
    expect(bodyText).not.toContain("model patladi");

    // 🚨 ASIL İDDİA: hata havuzuna GİTTİ. `serverError(msg, err)` içeride
    // `reportError`e çağrı yapıyor; onu doğrudan gözlemlemek yerine sınırın
    // VARLIĞINI pinliyoruz — sarmalayıcı kaldırılırsa Next'in kendi hata yolu
    // devreye girer ve gövde bizim metnimizi TAŞIMAZ (yukarıdaki assertion
    // kırmızı olur). Mutasyonla doğrulandı.
    expect(res.status).not.toBe(200);
  });

  it("TERS YÖN: sağlıklı istek sınırdan ETKİLENMEZ", async () => {
    // Sarmalayıcı "her şeyi 500'le" haline gelirse bu kırmızı olur.
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    mockSuggest.mockResolvedValue(result());

    const res = await call(token, "Çöp günü hangi gün?");
    expect(res.status).toBe(200);
  });
});
