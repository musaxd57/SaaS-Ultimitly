import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ÜSLUP PROFİLİ YENİLEMESİ SENKRON HATASINDAN BAĞIMSIZ (F13, 09-26). `refreshStyleProfile` Hospitable'a dokunmaz
// (yalnız DB + model) ama `syncOk` bloğundaydı: senkronu düşen org'un (kurucu org — 402 "abonelik pasif") eski,
// org genelinden olgu taşıyabilen profili hiç yenilenmez; yeni sürüm kuralıyla o profil isteme girmediği için üslup
// rehberi KALICI olarak kaybolurdu. Aynı gerekçeyle şikâyet uyarıları da senkronun dışına alınmıştı
// (`alerts-survive-sync-failure.test.ts`).
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return {
    ...actual,
    isHospitableConfigured: () => true,
    listProperties: vi.fn(),
    listReservations: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => undefined) };
});
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  summarizeHostStyle: vi.fn(),
}));

import { listProperties, HospitableError } from "@/lib/hospitable";
import { summarizeHostStyle } from "@/lib/ai";
import { runScheduledSync } from "@/lib/scheduled-sync";
import { STYLE_PROFILE_MARKER } from "@/lib/ai/style-profile";

const mockListProperties = vi.mocked(listProperties);
const mockSummarize = vi.mocked(summarizeHostStyle);

const LEGACY = "1) TARZ: kısa.\n2) SIK SORULAN SORULAR:\n- Otopark: bina önünde ücretsiz.";

async function seedLegacyProfileOrg() {
  const org = await prisma.organization.create({
    data: { name: "Org", hospitableTokenEnc: "enc", aiStyleProfile: LEGACY, aiStyleProfileAt: new Date() },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const conversation = await prisma.conversation.create({ data: { propertyId: property.id, guestIdentifier: "Alex" } });
  for (let i = 0; i < 5; i++) {
    await prisma.message.create({
      data: { conversationId: conversation.id, direction: "outbound", senderName: "Ev sahibi", authorType: "host", body: `Rica ederim ${i}!` },
    });
  }
  return org.id;
}

describe("üslup profili yenilemesi — senkron hatasından bağımsız", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "sk-test-style-profile-0000000000");
    mockSummarize.mockResolvedValue("- Kısa yazar");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("🚨 Hospitable 402 fırlatsa bile eski profil YENİLENİR (sürüm işaretli)", async () => {
    const orgId = await seedLegacyProfileOrg();
    mockListProperties.mockRejectedValue(new HospitableError("Subscription not active", 402));

    const res = await runScheduledSync();
    expect(res.ok).toBe(true);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.aiStyleProfile).toBe(`${STYLE_PROFILE_MARKER}\n- Kısa yazar`);
  });

  it("senkron BAŞARILIYKEN de yenilenir (regresyon pini)", async () => {
    const orgId = await seedLegacyProfileOrg();
    mockListProperties.mockResolvedValue([]);

    await runScheduledSync();

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.aiStyleProfile).toBe(`${STYLE_PROFILE_MARKER}\n- Kısa yazar`);
  });
});
