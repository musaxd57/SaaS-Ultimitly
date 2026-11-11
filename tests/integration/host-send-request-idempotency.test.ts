import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-05 (43fb93e incelemesi, P2): istemcinin mesaj başına istek kimliği (`requestId`) kalıcı kuyruk anahtarı AÇIK da KAPALI da olsa
// tek teslime bağlı kalmalı. Eskiden kuyruk yolu yalnız kuyruk satırına, doğrudan yol yalnız 2 dakikalık GÖVDE talebine bakıyordu:
//   · anahtar açıkken kuyruğa yazılan istek, anahtar kapatılınca (geri alma) aynı kimlikle yeniden denenirse doğrudan da GİDİYORDU
//     (işçi, anahtar kapalıyken de mevcut satırı boşaltır → misafire iki mesaj);
//   · tersi: doğrudan gönderilen istek, anahtar açılınca aynı kimlikle kuyruğa İKİNCİ kez yazılıyordu;
//   · doğrudan yolda yanıtı kaybolan başarılı gönderimin 2 dakika sonraki tekrarı yine gidiyordu.
// Belirsiz sonuçta bugünkü "konuşmayı kontrol edip yeniden gönder" penceresi (2 dk) DEĞİŞMEZ; kesin başarısızlıkta hemen yeniden denenir.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, id: "sent-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/outbox/enqueue", async (orig) => {
  const actual = await orig<typeof import("@/lib/outbox/enqueue")>();
  return { ...actual, enqueueOutbound: vi.fn(actual.enqueueOutbound) };
});

import { sendOnChannel } from "@/lib/messaging";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { POST } from "@/app/api/conversations/[id]/reply/route";
import { OUTBOUND_SEND_CLAIM_PREFIX, OUTBOUND_REQUEST_CLAIM_PREFIX } from "@/lib/outbound-claim-name";
import { claimOutboundRequest } from "@/lib/outbound-claim";

const mockSend = vi.mocked(sendOnChannel);
const RID = "11111111-2222-4333-8444-555555555555";

function req(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/conversations/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function outboxOn() {
  vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
  vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
}
function outboxOff() {
  vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
  vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "");
}

/**
 * İki dakika geçti: süresi 3 dk'dan kısa olan BÜTÜN talepler (gövde talebi + kısa doğan istek talebi) geçmişe çekilir; kesin başarıdan sonra
 * 24 saate uzatılmış istek talebi durur. (Zamanı ilerletmek yerine — gerçek PostgreSQL saatine dokunulmaz.)
 */
async function twoMinutesPass() {
  await prisma.systemLock.updateMany({
    where: { lockedUntil: { lt: new Date(Date.now() + 3 * 60_000) } },
    data: { lockedUntil: new Date(Date.now() - 1_000) },
  });
}

describe("elle cevap — istek kimliği kuyruk anahtarından bağımsız tek teslim", () => {
  let orgId: string;
  let conversationId: string;
  const send = (body: string, extra: Record<string, unknown> = {}) =>
    POST(req(conversationId, { body, requestId: RID, ...extra }), { params: Promise.resolve({ id: conversationId }) });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockSend.mockImplementation(async () => ({ ok: true, id: "sent-1" }));
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const property = await prisma.property.create({ data: { organizationId: orgId, name: "Lale" } });
    const conv = await prisma.conversation.create({
      data: { propertyId: property.id, guestIdentifier: "Guest", channel: "airbnb", externalReservationId: "res-1", status: "waiting" },
    });
    conversationId = conv.id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
  });

  it("🚨 anahtar AÇIKKEN kuyruğa yazılan istek, anahtar KAPATILINCA aynı kimlikle yeniden denenirse doğrudan GİTMEZ (kuyruk satırı teslim edilecek)", async () => {
    outboxOn();
    expect((await send("Kapı şifresi 4512")).status).toBe(202);
    outboxOff();
    const retry = await send("Kapı şifresi 4512");
    expect(mockSend).not.toHaveBeenCalled();
    expect(retry.status).toBe(200); // kuyruk yolunun tekilleştirme cevabı
    expect((await retry.json()).outbox).toEqual({ status: "queued", deduped: true, delivery: "pending" });
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("🚨 kuyruk satırı istek talebinden UZUN yaşar: talep süresi dolmuş olsa da (24 sa sonra) aynı kimlik doğrudan GİTMEZ", async () => {
    outboxOn();
    expect((await send("Kapı şifresi 4512")).status).toBe(202);
    // 24 saat geçti: istek talebi süpürüldü, kuyruk satırı (kalıcı kayıt) duruyor.
    await prisma.systemLock.deleteMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } } });
    outboxOff();
    const retry = await send("Kapı şifresi 4512");
    expect(mockSend).not.toHaveBeenCalled();
    expect(retry.status).toBe(200);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("aynı kimlik + FARKLI gövde, anahtar kapatıldıktan sonra da çakışmadır (409) — gönderim yok", async () => {
    outboxOn();
    expect((await send("İlk metin")).status).toBe(202);
    outboxOff();
    const res = await send("Bambaşka metin");
    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("🚨 doğrudan gönderilen istek, anahtar AÇILINCA aynı kimlikle kuyruğa İKİNCİ kez yazılmaz", async () => {
    outboxOff();
    expect((await send("Otopark arkada")).status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(1);
    outboxOn();
    const retry = await send("Otopark arkada");
    expect(retry.status).toBe(409);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("🚨 yanıtı kaybolan BAŞARILI doğrudan gönderimin 2 dakika sonraki tekrarı ikinci mesaj olmaz", async () => {
    outboxOff();
    expect((await send("Havlular dolapta")).status).toBe(201);
    await twoMinutesPass();
    const retry = await send("Havlular dolapta");
    expect(retry.status).toBe(409);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("KONTROL — FARKLI istek kimliği bilinçli ikinci gönderimdir (aynı metin, gövde talebi bittikten sonra)", async () => {
    outboxOff();
    expect((await send("Havlular dolapta")).status).toBe(201);
    await twoMinutesPass();
    const again = await POST(req(conversationId, { body: "Havlular dolapta", requestId: "99999999-8888-4777-8666-555555555544" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(again.status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("KONTROL — KESİN başarısızlıktan sonra aynı kimlik hemen yeniden denenir ve gider", async () => {
    outboxOff();
    mockSend.mockImplementationOnce(async () => ({ ok: false, error: "Hospitable API hatası (HTTP 400): bad" }));
    expect((await send("Wi-Fi şifresi")).status).toBe(502);
    const retry = await send("Wi-Fi şifresi");
    expect(retry.status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("KONTROL — BELİRSİZ sonuçta pencere eskisi gibi 2 dakika: hemen tekrar 409, süre geçince aynı kimlik yine gönderilebilir", async () => {
    outboxOff();
    mockSend.mockImplementationOnce(async () => ({ ok: false, error: "Hospitable API hatası (HTTP 503): down" }));
    const first = await send("Çöp kutusu kapının yanında");
    expect(first.status).toBe(502);
    expect((await first.json()).ambiguous).toBe(true);
    expect((await send("Çöp kutusu kapının yanında")).status).toBe(409);
    // İstek talebi 24 saat DEĞİL, gövde talebiyle aynı 2 dakika tutulur.
    const held = await prisma.systemLock.findMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } }, select: { lockedUntil: true } });
    expect(held).toHaveLength(1);
    expect(held[0].lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + 120_000 + 5_000);
    await prisma.systemLock.updateMany({ data: { lockedUntil: new Date(Date.now() - 1_000) } });
    expect((await send("Çöp kutusu kapının yanında")).status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("🚨 gönderim ortasında ÇÖKEN süreç (talep alındı, sonuç yazılmadı) 24 saatlik kilit bırakmaz: 2 dk sonra aynı kimlik yeniden gönderilebilir (Opus F1)", async () => {
    outboxOff();
    // Süreç talebi aldı ve sağlayıcıyı beklerken öldü: ne uzatma ne bırakma çalıştı.
    expect((await claimOutboundRequest(conversationId, `manual:${conversationId}:req:${RID}`, "direct")).result).toBe("claimed");
    const held = await prisma.systemLock.findMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } }, select: { lockedUntil: true } });
    expect(held[0].lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + 120_000 + 5_000);
    expect((await send("Çöken gönderim")).status).toBe(409); // pencere içinde: "hâlâ gönderiliyor"
    await twoMinutesPass();
    expect((await send("Çöken gönderim")).status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL — gönderim FIRLATIRSA da belirsizdir: istek talebi 24 saat değil 2 dakika tutulur", async () => {
    outboxOff();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockImplementationOnce(async () => {
      throw new Error("socket hang up (test)");
    });
    const first = await send("Klima kumandası çekmecede").catch(() => null);
    expect(first === null || first.status >= 500).toBe(true);
    const held = await prisma.systemLock.findMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } }, select: { lockedUntil: true } });
    expect(held).toHaveLength(1);
    expect(held[0].lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + 120_000 + 5_000);
  });

  it("🚨 başarılı gönderimden sonra tutulan istek talebi 'belirsiz gönderim sürüyor' SAYILMAZ (yazma servisinin okuduğu önek ayrı)", async () => {
    outboxOff();
    expect((await send("Anahtar kutusu")).status).toBe(201);
    await twoMinutesPass();
    // Yazma servisinin `ambiguousSendPending` ölçütü: bu konuşmanın gövde-talebi önekinde süresi dolmamış satır.
    const pending = await prisma.systemLock.count({
      where: { name: { startsWith: `${OUTBOUND_SEND_CLAIM_PREFIX}${conversationId}:` }, lockedUntil: { gt: new Date() } },
    });
    expect(pending).toBe(0);
    // İstek talebi ise duruyor (aynı kimliğin tekrarı engelli).
    expect(await prisma.systemLock.count({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX }, lockedUntil: { gt: new Date() } } })).toBe(1);
  });

  it("eşzamanlı kuyruk denemesi kimliği almışken (satır henüz yok) doğrudan yol GÖNDERMEZ", async () => {
    outboxOff();
    expect((await claimOutboundRequest(conversationId, `manual:${conversationId}:req:${RID}`, "queue")).result).toBe("claimed");
    const res = await send("Merhaba");
    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("kuyruğa yazılamayan istek kimliği kilitli kalmaz: anahtar kapanınca aynı kimlik doğrudan gönderilebilir", async () => {
    outboxOn();
    vi.mocked(enqueueOutbound).mockRejectedValueOnce(new Error("db down (test)"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await send("Su ısıtıcısı mutfakta").catch(() => null);
    expect(failed === null || failed.status >= 500).toBe(true);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(0);
    outboxOff();
    const retry = await send("Su ısıtıcısı mutfakta");
    expect(retry.status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 tekilleşen tekrar satırın ŞU ANKİ durumunu söyler (200 'gönderildi' demek değildir) — iki yolda da", async () => {
    outboxOn();
    expect((await send("Kahve makinesi")).status).toBe(202);
    const again = await send("Kahve makinesi");
    expect(again.status).toBe(200);
    expect((await again.json()).outbox).toEqual({ status: "queued", deduped: true, delivery: "pending" });
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status: "failed" } });
    expect((await (await send("Kahve makinesi")).json()).outbox.delivery).toBe("failed");
    outboxOff(); // doğrudan yolun kuyruk satırı denetimi de aynı durumu döndürür
    expect((await (await send("Kahve makinesi")).json()).outbox.delivery).toBe("failed");
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status: "sent" } });
    expect((await (await send("Kahve makinesi")).json()).outbox.delivery).toBe("sent");
    expect(mockSend).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // MESAJ M1 (Codex 11-10) — TALEBİN SAHİBİ + KUYRUK YOLUNDA GÖVDE TALEBİ.
  // ---------------------------------------------------------------------------
  const RID2 = "99999999-8888-4777-8666-555555555544";
  const sendAs = (rid: string | null, body: string) =>
    POST(req(conversationId, rid ? { body, requestId: rid } : { body }), { params: Promise.resolve({ id: conversationId }) });

  it("🚨 M1: süresi dolan denemenin GEÇ gelen kesin hatası, aynı isteği alıp BAŞARIYLA gönderen yeni denemenin talebini silmez → üçüncü deneme göndermez", async () => {
    outboxOff();
    let finishFirst!: (v: { ok: false; error: string }) => void;
    let firstEntered!: () => void;
    const firstInSend = new Promise<void>((r) => (firstEntered = r));
    mockSend.mockImplementationOnce(() => {
      firstEntered();
      return new Promise((res) => (finishFirst = res));
    });
    const pFirst = send("Kapı kodu 4512"); // A: sağlayıcıda asılı kaldı
    await firstInSend;
    await twoMinutesPass(); // A'nın talepleri düştü
    expect((await send("Kapı kodu 4512")).status).toBe(201); // B: aynı istek yeniden denendi ve GİTTİ (talebi 24 saate uzadı)
    finishFirst({ ok: false, error: "Hospitable API hatası (HTTP 400): bad" }); // A şimdi kesin hatayla döndü
    expect((await pFirst).status).toBe(502);
    // ESKİDE: A'nın temizliği B'nin 24 saatlik kaydını ve gövde talebini adla siliyordu → aşağıdaki üçüncü deneme misafire İKİNCİ mesajı gönderiyordu.
    const third = await send("Kapı kodu 4512");
    expect(third.status).toBe(409); // ⬅️ ESKİDE 201
    expect(mockSend).toHaveBeenCalledTimes(2); // A + B; üçüncü gönderim yok
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
    // B'nin 24 saatlik İSTEK kaydı da duruyor: gövde talebi düştükten (2 dk) sonra aynı kimlik yine gönderilmez.
    await twoMinutesPass();
    expect((await send("Kapı kodu 4512")).status).toBe(409);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("🚨 M1 (kimliksiz istemci): süresi dolan denemenin geç kesin hatası, aynı METNİ gönderen yeni denemenin gövde talebini silmez", async () => {
    outboxOff();
    let finishFirst!: (v: { ok: false; error: string }) => void;
    let firstEntered!: () => void;
    const firstInSend = new Promise<void>((r) => (firstEntered = r));
    mockSend.mockImplementationOnce(() => {
      firstEntered();
      return new Promise((res) => (finishFirst = res));
    });
    const pFirst = sendAs(null, "Anahtar paspasın altında");
    await firstInSend;
    await twoMinutesPass();
    expect((await sendAs(null, "Anahtar paspasın altında")).status).toBe(201); // B gitti; gövde talebi 2 dk B'nin
    finishFirst({ ok: false, error: "Hospitable API hatası (HTTP 400): bad" });
    expect((await pFirst).status).toBe(502);
    expect((await sendAs(null, "Anahtar paspasın altında")).status).toBe(409); // ⬅️ ESKİDE 201 (A'nın temizliği B'nin talebini silmişti)
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("M1: geç BAŞARILI dönen eski deneme, aynı isteği almış yeni denemenin talebini 24 saate UZATMAZ (yalnız kendi talebini uzatır)", async () => {
    outboxOff();
    let finishFirst!: (v: { ok: true; id: string }) => void;
    let finishSecond!: (v: { ok: false; error: string }) => void;
    let firstEntered!: () => void;
    let secondEntered!: () => void;
    const firstInSend = new Promise<void>((r) => (firstEntered = r));
    const secondInSend = new Promise<void>((r) => (secondEntered = r));
    mockSend
      .mockImplementationOnce(() => {
        firstEntered();
        return new Promise((res) => (finishFirst = res));
      })
      .mockImplementationOnce(() => {
        secondEntered();
        return new Promise((res) => (finishSecond = res));
      });
    const pFirst = send("Çöpler akşam alınıyor");
    await firstInSend;
    await twoMinutesPass();
    const pSecond = send("Çöpler akşam alınıyor"); // B talebi aldı, sağlayıcıda bekliyor
    await secondInSend;
    finishFirst({ ok: true, id: "sent-a" }); // A geç de olsa başarılı döndü
    expect((await pFirst).status).toBe(201);
    const held = await prisma.systemLock.findMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } }, select: { lockedUntil: true } });
    expect(held).toHaveLength(1);
    expect(held[0].lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + 120_000 + 5_000); // B'nin talebi kısa kaldı
    finishSecond({ ok: false, error: "Hospitable API hatası (HTTP 400): bad" });
    expect((await pSecond).status).toBe(502);
  });

  it("KONTROL (M1): kendi talebini bırakma çalışır — kesin hata, araya kimse girmeden → aynı metin FARKLI kimlikle de hemen gider", async () => {
    outboxOff();
    mockSend.mockImplementationOnce(async () => ({ ok: false, error: "Hospitable API hatası (HTTP 400): bad" }));
    expect((await send("Wi-Fi şifresi")).status).toBe(502);
    expect((await sendAs(RID2, "Wi-Fi şifresi")).status).toBe(201); // gövde talebi de bırakılmış
  });

  it("🚨 M1: kuyruk yolunda aynı metni AYNI ANDA gönderen iki AYRI istek (iki sekme / iki yönetici) → yalnız biri kuyruğa girer", async () => {
    outboxOn();
    expect((await send("Aynı taslak onaylandı")).status).toBe(202);
    const second = await sendAs(RID2, "Aynı taslak onaylandı");
    expect(second.status).toBe(409); // ⬅️ ESKİDE 202 (misafire iki kez gidiyordu)
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    // Reddedilen isteğin kimlik talebi hemen bırakıldı (yalnız ilk isteğinki duruyor).
    expect(await prisma.systemLock.count({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
    // Reddedilen isteğin kimliği kilitli kalmaz: gövde talebi bitince (2 dk) aynı kimlik yeni mesaj olarak kuyruğa girer.
    await twoMinutesPass();
    expect((await sendAs(RID2, "Aynı taslak onaylandı")).status).toBe(202);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("KONTROL (M1): kuyruk yolunda AYNI isteğin tekrarı gövde talebine takılmaz (200 tekilleşme); kimliksiz istemcinin tekrarı da", async () => {
    outboxOn();
    expect((await send("Tek mesaj")).status).toBe(202);
    expect((await send("Tek mesaj")).status).toBe(200);
    // İstek talebi düşmüş olsa da (2 dk) aynı kimlik kuyruk satırıyla tekilleşir.
    await prisma.systemLock.deleteMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } } });
    expect((await send("Tek mesaj")).status).toBe(200);
    // Kimliksiz (eski) istemci: anahtar gövde + 2 dk kova → tekrar yine 200.
    const first = await sendAs(null, "Kimliksiz mesaj");
    expect(first.status).toBe(202);
    const again = await sendAs(null, "Kimliksiz mesaj");
    expect([200, 409]).toContain(again.status); // kova sınırına denk gelirse "az önce gönderildi" (409) — ikisi de ikinci kopya üretmez
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("M1: kuyruk yolunda içerik çakışması (aynı kimlik, başka metin) yeni metnin gövde talebini TUTMAZ → doğru kimlikle hemen gönderilebilir", async () => {
    outboxOn();
    expect((await send("İlk metin")).status).toBe(202);
    await prisma.systemLock.deleteMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } } }); // istek talebi düştü; satır duruyor
    expect((await send("İkinci metin")).status).toBe(409); // çakışma
    expect((await sendAs(RID2, "İkinci metin")).status).toBe(202); // gövde talebi bırakılmış olmalı
  });

  it("M1: kuyruğa yazılamayan isteğin gövde talebi de bırakılır (aynı metin başka kimlikle hemen kuyruğa girer)", async () => {
    outboxOn();
    vi.mocked(enqueueOutbound).mockRejectedValueOnce(new Error("db down (test)"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await send("Su ısıtıcısı mutfakta").catch(() => null);
    expect(failed === null || failed.status >= 500).toBe(true);
    expect((await sendAs(RID2, "Su ısıtıcısı mutfakta")).status).toBe(202);
  });

  it("🚨 A25 (ev sahibi yolu): cevap satırının zamanı gönder'e basılan andır — gönderim sürerken içeri alınan misafir mesajı cevaptan SONRA sayılır", async () => {
    outboxOff();
    let lateIngestedAt = 0;
    mockSend.mockImplementationOnce(async () => {
      const at = new Date();
      lateIngestedAt = at.getTime();
      await prisma.message.create({
        data: { conversationId, direction: "inbound", senderName: "Guest", body: "Bir sorum daha var", createdAt: new Date(at.getTime() - 20_000), ingestedAt: at },
      });
      return { ok: true, id: "sent-1" };
    });
    expect((await send("Tabii, hallediyoruz")).status).toBe(201);
    const reply = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
    expect(reply.createdAt.getTime()).toBeLessThanOrEqual(lateIngestedAt); // ⬅️ ESKİDE cevap satırı o mesajdan SONRA görünüyordu ("geç" sayılmıyordu)
  });

  it("KONTROL — anahtar AÇIKKEN aynı kimliğin tekrarı bugünkü gibi tekilleşir (200), farklı gövde 409", async () => {
    outboxOn();
    expect((await send("Aynı metin")).status).toBe(202);
    expect((await send("Aynı metin")).status).toBe(200);
    expect((await send("Başka metin")).status).toBe(409);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
  });
});
