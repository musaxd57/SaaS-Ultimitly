// ---------------------------------------------------------------------------
// BEKLEYEN MESAJ GÜVENLİK PENCERESİ — KAYDIRMA SALDIRISI (kurucu talimatı 09-07, "BOUNDED CONVERSATION CONTEXT" madde 4 + 12,
// eval senaryosu 6 ve 5).
//
// "Guest sends 'İade istiyorum' followed by more than 25 harmless messages without a successfully delivered operator reply.
//  Expected: the refund request remains in the deterministic pending-message safety window and cannot be displaced by the
//  generation-context ceiling." + "A resolved complaint before the last delivered operator reply does not poison every future
//  reply forever."
//
// Üretim penceresi (istem) 25 mesajla sınırlı (`selectHistoryForPrompt`); kanal kapısının cevapsız-misafir listesi
// (`pendingGuestMessages`) bu pencereden BAĞIMSIZ, son cevaplayan giden mesajdan sonraki HER misafir mesajını taşır. Bu dosya
// bunu uçtan uca kanıtlar (gerçek DB, gerçek kapı; yalnız model ve gönderim sahte). Her "gitmedi" iddiasının aynı tohumla
// "gitti" KONTROLÜ var (tuzak testler boru hattının erken bir aşamasında vetolanıp hiçbir şey iddia etmeden yeşil kalabiliyordu).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { HISTORY_MESSAGE_CAP } from "@/lib/ai/limits";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

const REFUND = "İade istiyorum, ödediğim parayı geri istiyorum.";
const HARMLESS = (i: number) => `Bir sorum daha var (${i}): otopark var mı?`;

const benignVerdict = {
  intent: "parking",
  confidence: 0.95,
  reply: "Otopark bilgisi için ev sahibimiz size dönüş yapacak.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "low",
  detectedLanguage: "tr",
  riskType: null as string | null,
  usedSources: [] as string[],
  missingInfo: [] as string[],
  statedCheckoutTime: null,
};

type Turn = { dir: "inbound" | "outbound"; body: string };

async function seed(turns: Turn[]) {
  const org = await prisma.organization.create({
    data: { name: "Kaydırma Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  const r = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-disp-1",
    },
  });
  const start = Date.now() - turns.length * 60_000;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: r.id,
      guestIdentifier: "Ayşe Yılmaz",
      channel: "airbnb",
      status: "new",
      externalReservationId: "res-disp-1",
      lastMessageAt: new Date(),
      messages: {
        create: turns.map((t, i) => ({
          direction: t.dir,
          senderName: t.dir === "inbound" ? "Ayşe Yılmaz" : "Ev sahibi",
          authorType: t.dir === "inbound" ? "guest" : "host",
          body: t.body,
          createdAt: new Date(start + i * 60_000),
        })),
      },
    },
  });
  return conversation;
}

const harmless = (n: number, from = 0): Turn[] => Array.from({ length: n }, (_, i) => ({ dir: "inbound" as const, body: HARMLESS(from + i) }));

describe("bekleyen mesaj güvenlik penceresi üretim penceresinden bağımsız", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue(benignVerdict as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  const N = HISTORY_MESSAGE_CAP + 5; // üretim penceresinin tavanından fazla zararsız mesaj

  it("ön koşul: zararsız mesaj sayısı üretim penceresini GERÇEKTEN aşıyor", () => {
    expect(HISTORY_MESSAGE_CAP).toBeLessThanOrEqual(25);
    expect(N).toBeGreaterThan(HISTORY_MESSAGE_CAP);
  });

  it("KONTROL: yalnız zararsız mesajlar (iade yok) → oto-yanıt GİDER", async () => {
    const c = await seed(harmless(N + 1));
    const r = await applyChannelAutoReply(c.id);
    expect(r.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it(`🚨 'İade istiyorum' + ${HISTORY_MESSAGE_CAP + 5} zararsız mesaj (araya cevap girmedi) → GÖNDERİLMEZ, iade insana kalır`, async () => {
    const c = await seed([{ dir: "inbound", body: REFUND }, ...harmless(N)]);
    const r = await applyChannelAutoReply(c.id);
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(r.skippedReason).not.toBe("not_connected");
  });

  it("🚨 çözülmüş şikâyet zehirlemez: iade → TESLİM EDİLMİŞ ev sahibi cevabı → zararsız mesajlar → oto-yanıt GİDER", async () => {
    const c = await seed([
      { dir: "inbound", body: REFUND },
      { dir: "outbound", body: "İadeniz için platform üzerinden talep açtık, size dönüş yapacağız." },
      ...harmless(N),
    ]);
    const r = await applyChannelAutoReply(c.id);
    expect(r.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
