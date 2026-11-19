import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// GÖLGE OKUYUCULARDA MİSAFİR ADI MASKESİ (G1 tur 2 T2-B7, 11-19; anahtarlar `AI_HOST_COMMITMENT_READER_ENABLED` /
// `AI_REPLY_ITEMS_READER_ENABLED` KAPALI). Öteki anlam katmanları modele giden metinde misafirin adını ÜÇ kaynaktan maskeler
// (`automation.ts` kalış bekçisi + anlama katmanı, `ai/index.ts`: konuşmanın görünen adı + rezervasyonun `guestName` + `guestGivenName`).
// Gölge okuyucular yalnız konuşmanın görünen adını veriyordu: görünen ad rezervasyon kodu olduğunda (senkron misafir adını çözemezse
// "Rezervasyon <kod>" yazar) ev sahibinin mesajındaki misafir adı modele MASKESİZ gidiyordu. Artık aday sorgusu konuşmanın rezervasyonundan
// iki adı da alır (yalnız AYNI işletmenin rezervasyonu), okuyucuya üçü gider.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { reportError } from "@/lib/report-error";
import { sweepHostCommitmentShadow } from "@/lib/ai/semantic/host-commitment-shadow";
import { buildHostCommitmentReaderUserContent } from "@/lib/ai/semantic/host-commitment-reader";
import { sweepReplyItemsShadow } from "@/lib/ai/semantic/reply-items-shadow";
import { buildReplyItemsReaderUserContent } from "@/lib/ai/semantic/reply-items-reader";
import type { ReplyItemRef } from "@/lib/ai/semantic/reply-items-verdict";

const BODY = "Ayşe Hanım, havluları yarın 10'da getiriyoruz.";
type Names = readonly (string | null | undefined)[] | undefined;
/** Okuyucuya verilen DOLU ad kaynakları (boş kaynak null / undefined gelir; okuyucu onları zaten eler). */
const givenNames = (names: Names) => (names ?? []).filter((n): n is string => typeof n === "string" && n.length > 0);

/**
 * Konuşmanın görünen adı rezervasyon kodu; rezervasyonda misafirin adı var. `reservationOrgProperty` verilirse rezervasyon O dairede
 * (başka işletme); `noReservation` → konuşma rezervasyonsuz. Konuşmada açık bir istek + ev sahibinin mesajı.
 */
async function world(opts: { reservationOrgProperty?: string; noReservation?: boolean } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const reservation = opts.noReservation
    ? null
    : await prisma.reservation.create({
        data: {
          propertyId: opts.reservationOrgProperty ?? propertyId,
          guestName: "Ayşe Yılmaz",
          guestGivenName: "Ayşe",
          arrivalDate: stayDay(1),
          departureDate: stayDay(3),
          channel: "airbnb",
          status: "confirmed",
          sourceReference: `res-mask-${propertyId}`,
        },
      });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation?.id ?? null,
      channel: "airbnb",
      guestIdentifier: "Rezervasyon HMX123",
      status: "answered",
      externalReservationId: reservation ? `res-mask-${propertyId}` : null,
    },
  });
  await prisma.conversationItem.create({
    data: { organizationId: orgId, conversationId: conversation.id, messageId: "g-1", kind: "cleaning_linen", sources: "understanding", createdAt: new Date(Date.now() - 20 * 60_000) },
  });
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: BODY, deliveryPath: "direct" },
  });
  return { orgId, propertyId };
}

/** İki gölge turunu koşar; okuyucunun aldığı adlar + modele GİDECEK metnin aynısı (okuyucunun kendi kurucusuyla). */
async function sweepBoth() {
  const commitment: { names: Names; content: string }[] = [];
  const replyItems: { names: Names; content: string }[] = [];
  await sweepHostCommitmentShadow(new Date(), {
    reader: async (input) => {
      commitment.push({ names: input.names, content: buildHostCommitmentReaderUserContent(input) });
      return { ok: false, error: "parse", model: "m", ms: 1 };
    },
  });
  await sweepReplyItemsShadow(new Date(), {
    reader: async (input: { message: string; items: readonly ReplyItemRef[]; names?: Names }) => {
      replyItems.push({ names: input.names, content: buildReplyItemsReaderUserContent(input) });
      return { ok: false, error: "parse", model: "m", ms: 1 };
    },
  });
  return { commitment, replyItems };
}

describe("gölge okuyucular — misafir adı üç kaynaktan maskelenir (G1 T2-B7)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AI_HOST_COMMITMENT_READER_ENABLED", "1");
    vi.stubEnv("AI_REPLY_ITEMS_READER_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    // Bu dosyada hata üreten senaryo yok → raporlanan her hata testin kendi kusurudur (sessiz yeşil olmasın).
    expect(vi.mocked(reportError).mock.calls.map((c) => String(c[1]))).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("🚨 konuşmanın görünen adı rezervasyon kodu, misafirin adı rezervasyonda → iki okuyucunun da modele göndereceği metinde ad YOK", async () => {
    await world();
    const { commitment, replyItems } = await sweepBoth();
    expect(commitment).toHaveLength(1);
    expect(replyItems).toHaveLength(1);
    expect(commitment[0]!.content).not.toContain("Ayşe");
    expect(replyItems[0]!.content).not.toContain("Ayşe");
    // Öteki katmanlarla aynı üç kaynak, aynı sırayla (`automation.ts` kalış bekçisi).
    expect(commitment[0]!.names).toEqual(["Rezervasyon HMX123", "Ayşe Yılmaz", "Ayşe"]);
    expect(replyItems[0]!.names).toEqual(["Rezervasyon HMX123", "Ayşe Yılmaz", "Ayşe"]);
    // Mesajın geri kalanı modele gider (maske yalnız adı alır, mesajı boşaltmaz).
    expect(commitment[0]!.content).toContain("havluları yarın 10'da getiriyoruz");
    expect(replyItems[0]!.content).toContain("havluları yarın 10'da getiriyoruz");
  });

  it("🚨 kiracı kapsamı: konuşma BAŞKA işletmenin rezervasyonuna bağlıysa o rezervasyonun adları okunmaz (aday yine okunur)", async () => {
    const other = await makeOrgWithProperty();
    await world({ reservationOrgProperty: other.propertyId });
    const { commitment, replyItems } = await sweepBoth();
    expect(commitment.map((c) => givenNames(c.names))).toEqual([["Rezervasyon HMX123"]]);
    expect(replyItems.map((c) => givenNames(c.names))).toEqual([["Rezervasyon HMX123"]]);
  });

  it("rezervasyonu olmayan konuşma aday olmaya devam eder (sorgu rezervasyonsuz mesajı düşürmez); ad kaynağı yalnız görünen ad", async () => {
    await world({ noReservation: true });
    const { commitment, replyItems } = await sweepBoth();
    expect(commitment.map((c) => givenNames(c.names))).toEqual([["Rezervasyon HMX123"]]);
    expect(replyItems.map((c) => givenNames(c.names))).toEqual([["Rezervasyon HMX123"]]);
    // Ad hiçbir kaynakta yokken metin dokunulmadan gider (maske aşırı uygulanmaz).
    expect(commitment[0]!.content).toContain(BODY);
  });
});
