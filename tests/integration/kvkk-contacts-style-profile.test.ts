import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { anonymizeOldGuestData } from "@/lib/data-retention";
import { markStyleProfile, STYLE_PROFILE_MARKER } from "@/lib/ai/style-profile";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
import { eraseReservationData } from "@/lib/erasure";

// ---------------------------------------------------------------------------
// G7 (kurucu kararı 10-13 "İkisi de"; DENETIM 08-09 #20, #21):
//  (a) KVKK süpürgelerinde ad maskesinden SONRA metindeki telefon + e-posta da maskelenir (giden gövde, görev başlığı, görev notu).
//  (b) İşletmenin üslup profili (`aiStyleProfile`) iki süpürgenin de dışındaydı → süpürülen misafirin adı + telefon / e-posta orada da.
// Kurucunun örneği: "Ayşe Hanım, numaram +90 555 123 45 67" → "[Misafir] Hanım, numaram [telefon]".
// ---------------------------------------------------------------------------

const PROFILE_BODY =
  "- Kısa, sıcak cümleler.\n- Örnek: \"Ayşe Hanım, anahtar kutuda; bir sorun olursa +90 555 123 45 67 numarasından yazın.\"\n- Örnek: \"ayse.yilmaz@example.com adresine fatura gönderildi.\"";

async function seed(opts: { departedMonthsAgo: number; guestName: string; otherOrgProfile?: boolean }) {
  const org = await prisma.organization.create({
    data: { name: "Org", aiStyleProfile: markStyleProfile(PROFILE_BODY), aiStyleProfileAt: new Date() },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: opts.guestName,
      guestPhone: "+905551234567",
      guestEmail: "ayse.yilmaz@example.com",
      sourceReference: `res-${opts.guestName}`,
      arrivalDate: subMonths(new Date(), opts.departedMonthsAgo + 1),
      departureDate: subMonths(new Date(), opts.departedMonthsAgo),
      status: "completed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      externalReservationId: `res-${opts.guestName}`,
      channel: "airbnb",
      guestIdentifier: opts.guestName,
      messages: {
        create: [
          { direction: "inbound", senderName: opts.guestName, body: "Numaram 0555 123 45 67" },
          {
            direction: "outbound",
            senderName: "Lixus AI",
            body: "Ayşe Hanım, numaram +90 555 123 45 67 — fatura ayse.yilmaz@example.com adresine. Giriş 12.10.2026 15:00, kapı 4821.",
          },
        ],
      },
    },
  });
  const task = await prisma.task.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      title: "Ayşe Yılmaz için havlu (0532 111 22 33)",
      type: "restock",
      updates: { create: [{ note: "Ayşe Hanım aradı: +90 532 111 22 33, mail ayse.yilmaz@example.com", status: "todo" }] },
    },
  });
  let otherOrgId: string | null = null;
  if (opts.otherOrgProfile) {
    const other = await prisma.organization.create({
      data: { name: "Başka", aiStyleProfile: markStyleProfile(PROFILE_BODY), aiStyleProfileAt: new Date() },
    });
    otherOrgId = other.id;
  }
  return { orgId: org.id, reservationId: reservation.id, conversationId: conversation.id, taskId: task.id, otherOrgId };
}

async function outbound(conversationId: string) {
  return (await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } })).body;
}

function expectScrubbed(text: string) {
  expect(text).not.toContain("Ayşe");
  expect(text).not.toContain("555 123 45 67");
  expect(text).not.toContain("532 111 22 33");
  expect(text).not.toContain("ayse.yilmaz@example.com");
}

describe("G7 — saklama süpürgesi (anonymizeOldGuestData)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("(a) giden gövde: ad + telefon + e-posta maskelenir; tarih, saat, kapı kodu ve ev sahibinin içeriği kalır", async () => {
    const s = await seed({ departedMonthsAgo: 30, guestName: "Ayşe Yılmaz" });
    expect((await anonymizeOldGuestData()).anonymized).toBe(1);
    const body = await outbound(s.conversationId);
    expectScrubbed(body);
    expect(body).toBe(
      "[Misafir] Hanım, numaram [telefon] — fatura [e-posta] adresine. Giriş 12.10.2026 15:00, kapı 4821.",
    );
  });

  it("(a) görev başlığı ve görev notu: telefon + e-posta da maskelenir", async () => {
    const s = await seed({ departedMonthsAgo: 30, guestName: "Ayşe Yılmaz" });
    await anonymizeOldGuestData();
    const task = await prisma.task.findUniqueOrThrow({ where: { id: s.taskId } });
    expectScrubbed(task.title);
    expect(task.title).toContain("havlu");
    const note = (await prisma.taskUpdate.findFirstOrThrow({ where: { taskId: s.taskId } })).note ?? "";
    expectScrubbed(note);
    expect(note).toContain("[telefon]");
    expect(note).toContain("[e-posta]");
  });

  it("(b) üslup profili: süpürülen misafirin adı + telefon + e-posta maskelenir; sürüm işareti ve üslup kalır", async () => {
    const s = await seed({ departedMonthsAgo: 30, guestName: "Ayşe Yılmaz", otherOrgProfile: true });
    await anonymizeOldGuestData();
    const profile = (await prisma.organization.findUniqueOrThrow({ where: { id: s.orgId } })).aiStyleProfile ?? "";
    expectScrubbed(profile);
    expect(profile.startsWith(`${STYLE_PROFILE_MARKER}\n`)).toBe(true);
    expect(profile).toContain("Kısa, sıcak cümleler.");
    expect(profile).toContain("[telefon]");
    // Sıra: önce telefon / e-posta, sonra ad — tersinde ad maskesi adresin içindeki adı parçalar ("[Misafir][e-posta]").
    expect(profile).toContain('"[e-posta] adresine fatura gönderildi."');
    // KİRACI SINIRI: başka işletmenin profiline dokunulmaz (o işletmede bu misafir yok).
    const other = (await prisma.organization.findUniqueOrThrow({ where: { id: s.otherOrgId! } })).aiStyleProfile;
    expect(other).toBe(markStyleProfile(PROFILE_BODY));
  });

  it("KONTROL: saklama süresi dolmamış konaklama — hiçbir şey değişmez", async () => {
    const s = await seed({ departedMonthsAgo: 3, guestName: "Ayşe Yılmaz" });
    expect((await anonymizeOldGuestData()).anonymized).toBe(0);
    expect(await outbound(s.conversationId)).toContain("+90 555 123 45 67");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: s.orgId } })).aiStyleProfile).toBe(markStyleProfile(PROFILE_BODY));
  });
});

describe("G7 — misafir silme (eraseReservationData) ile parite", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("(a)+(b) silinen misafirin gövdesi, görev metinleri ve işletme profili aynı biçimde maskelenir", async () => {
    const s = await seed({ departedMonthsAgo: 1, guestName: "Ayşe Yılmaz", otherOrgProfile: true });
    expect(await eraseReservationData(s.orgId, s.reservationId)).not.toBeNull();
    expectScrubbed(await outbound(s.conversationId));
    const task = await prisma.task.findUniqueOrThrow({ where: { id: s.taskId } });
    expectScrubbed(task.title);
    expectScrubbed((await prisma.taskUpdate.findFirstOrThrow({ where: { taskId: s.taskId } })).note ?? "");
    const profile = (await prisma.organization.findUniqueOrThrow({ where: { id: s.orgId } })).aiStyleProfile ?? "";
    expectScrubbed(profile);
    expect(profile.startsWith(`${STYLE_PROFILE_MARKER}\n`)).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: s.otherOrgId! } })).aiStyleProfile).toBe(
      markStyleProfile(PROFILE_BODY),
    );
  });
});
