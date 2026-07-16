import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Claude gölge denetçisi route'u. Sözleşmeler: super-admin only · anahtar yokken
// net 400 (özellik pasif) · Claude'a giden istemde HAM misafir PII'si YOK ·
// boş örneklemde API çağrısı YOK (maliyet 0) · başarıda audit-log satırı.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// SDK mock'u: gerçek ağ çağrısı asla yapılmaz; istem içeriğini yakalarız.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class MockAnthropic {
    messages = { create: createMock };
  }
  return { default: MockAnthropic, APIError };
});

import { POST } from "@/app/api/admin/quality-audit/route";

const OPERATOR_EMAIL = "operator@lixusai.com";
const GUEST_NAME = "Yılmaz Kayahan";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/quality-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Gerçek operatör satırı — AuditLog.actorUserId FK'sı sahte id'yi sessizce düşürür.
async function makeOperatorSession(): Promise<SessionPayload> {
  const org = await prisma.organization.create({ data: { name: "Operatör Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Op", email: OPERATOR_EMAIL, passwordHash: "x", role: "owner" },
  });
  return { userId: user.id, organizationId: org.id, role: "owner", email: OPERATOR_EMAIL, name: "Op", sessionEpoch: 0 };
}

/** Müşteri org'u: PII'li misafir mesajı + AI yanıtı olan tek konuşma. */
async function seedCustomerOrg() {
  const org = await prisma.organization.create({ data: { name: "Müşteri Konaklama" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: GUEST_NAME,
      arrivalDate: new Date(Date.now() - 86_400_000),
      departureDate: new Date(Date.now() + 86_400_000),
      status: "confirmed",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      guestIdentifier: GUEST_NAME,
      channel: "airbnb",
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderName: GUEST_NAME,
      authorType: "guest",
      body: `Merhaba, ben ${GUEST_NAME}. Wifi şifresi nedir? Numaram +90 532 123 45 67.`,
      createdAt: new Date(Date.now() - 3_600_000),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "outbound",
      senderName: "GuestOps AI",
      authorType: "ai",
      aiIntent: "wifi",
      body: `Merhaba ${GUEST_NAME}, wifi şifremiz dairenin girişindeki kartta yazıyor.`,
      createdAt: new Date(Date.now() - 3_000_000),
    },
  });
  return org;
}

const MODEL_REPORT = {
  overall: "Yanıtlar genel olarak kurallara uygun.",
  findings: [
    { messageId: "x", severity: "medium", criterion: "uslup", issue: "Selamlama fazla uzun.", suggestion: "Kısalt." },
  ],
  promptSuggestions: ["Wifi yanıtına kaynak ekle."],
  testSuggestions: [],
};

describe("POST /api/admin/quality-audit — Claude gölge denetçisi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    createMock.mockResolvedValue({
      model: "claude-opus-4-8",
      content: [{ type: "text", text: JSON.stringify(MODEL_REPORT) }],
      usage: { input_tokens: 1200, output_tokens: 250 },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("operatör olmayan (müşteri owner dahil) 401 alır, SDK hiç çağrılmaz", async () => {
    const org = await seedCustomerOrg();
    session = { userId: "u", organizationId: org.id, role: "owner", email: "musteri@example.com", name: "M", sessionEpoch: 0 };
    const res = await POST(req({ organizationId: org.id }));
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("ANTHROPIC_API_KEY yokken net 400 — özellik pasif, SDK çağrılmaz", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const org = await seedCustomerOrg();
    session = await makeOperatorSession();
    const res = await POST(req({ organizationId: org.id }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields.apiKey).toContain("ANTHROPIC_API_KEY");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("başarılı denetim: rapor döner, Claude'a giden istemde HAM PII YOK, audit-log yazılır", async () => {
    const org = await seedCustomerOrg();
    session = await makeOperatorSession();
    const res = await POST(req({ organizationId: org.id }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sampleSize).toBe(1);
    expect(data.organizationName).toBe("Müşteri Konaklama");
    expect(data.findings).toHaveLength(1);
    expect(data.promptSuggestions).toEqual(["Wifi yanıtına kaynak ekle."]);
    expect(data.usage).toEqual({ inputTokens: 1200, outputTokens: 250 });

    // KVKK sözleşmesi: SDK'ya giden TÜM parametrelerde misafir adı/telefonu yok.
    expect(createMock).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(createMock.mock.calls[0][0]);
    expect(sent).not.toContain("Yılmaz");
    expect(sent).not.toContain("Kayahan");
    expect(sent).not.toContain("532 123 45 67");
    expect(sent).toContain("[Misafir]");

    const audit = await prisma.auditLog.findFirst({ where: { action: "admin.quality_audit" } });
    expect(audit?.organizationId).toBe(org.id);

    // SALT-OKUMA garantisi: denetim hiçbir mesaja/konuşmaya yazmadı.
    expect(await prisma.message.count()).toBe(2);
  });

  it("AI yanıtı olmayan org: sampleSize 0, Claude'a HİÇ gidilmez (maliyet 0)", async () => {
    const org = await prisma.organization.create({ data: { name: "Boş Org" } });
    session = await makeOperatorSession();
    const res = await POST(req({ organizationId: org.id }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sampleSize).toBe(0);
    expect(data.findings).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("bilinmeyen org 400; model JSON dönmezse dürüst 502 (sessiz boş rapor değil)", async () => {
    session = await makeOperatorSession();
    expect((await POST(req({ organizationId: "yok-boyle-org" }))).status).toBe(400);

    const org = await seedCustomerOrg();
    createMock.mockResolvedValue({
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "Değerlendirme yapamıyorum." }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const res = await POST(req({ organizationId: org.id }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("çözümlenemedi");
  });
});
