import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { anonymizeOldGuestData } from "@/lib/data-retention";
import { eraseReservationData } from "@/lib/erasure";
import { buildOrganizationDataExport } from "@/lib/data-export";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

// ---------------------------------------------------------------------------
// Yapay zekâ üretim izi (migration 60) — KVKK paritesi (kurucu §D-1 10-09: "mesajlarla aynı saklama").
// Taslak / gönderilen metin ve kurucu etiket notu misafir metni taşır: süre-bazlı süpürgenin İKİ dalı (rezervasyonlu + öksüz) ve
// açık silme bunları siler; kimlik / karar / sayaç alanları kalır (kalite ölçümü anonim kayıtta da doğrudur).
// `scrub-scope-parity` kolon kümesini yapısal pinler; burası gerçek PostgreSQL'de DAVRANIŞI sınar.
// ---------------------------------------------------------------------------

const DRAFT = "Merhaba Ayşe Yılmaz, kapı kodunuz 4711.";
const SENT = "Merhaba Ayşe Yılmaz, kapı kodunuz 4711. İyi konaklamalar.";
const NOTE = "Misafir 'Ayşe Yılmaz, 0555 111 22 33' yazmış; cevap doğru.";

async function seedConversation(opts: { reservation: boolean; monthsAgo: number }) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
  const reservation = opts.reservation
    ? await prisma.reservation.create({
        data: {
          propertyId: property.id,
          guestName: "Ayşe Yılmaz",
          arrivalDate: subMonths(new Date(), opts.monthsAgo + 1),
          departureDate: subMonths(new Date(), opts.monthsAgo),
          status: "completed",
        },
      })
    : null;
  const conv = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation?.id ?? null,
      channel: "airbnb",
      guestIdentifier: "Ayşe Yılmaz",
      lastMessageAt: subMonths(new Date(), opts.monthsAgo),
      messages: { create: [{ direction: "inbound", senderName: "Ayşe Yılmaz", body: "Kapı kodu?" }] },
    },
  });
  const gen = await prisma.aiGeneration.create({
    data: {
      organizationId: org.id,
      conversationId: conv.id,
      propertyId: property.id,
      reservationId: reservation?.id ?? null,
      surface: "channel_auto",
      model: "test-model",
      promptVersion: "p1",
      decision: "auto_sent",
      draftText: DRAFT,
      sentText: SENT,
      promptTokens: 120,
      labels: { create: [{ label: "correct", note: NOTE }] },
    },
  });
  return { orgId: org.id, reservationId: reservation?.id ?? null, generationId: gen.id };
}

async function traceOf(generationId: string) {
  const g = await prisma.aiGeneration.findUniqueOrThrow({ where: { id: generationId }, include: { labels: true } });
  return { draftText: g.draftText, sentText: g.sentText, note: g.labels[0]?.note ?? null, g };
}

describe("AiGeneration izi — süre-bazlı süpürge", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("DAL 1/2 — rezervasyonlu eski konuşmanın iz metni ve etiket notu silinir; kimlik / karar / sayaç kalır", async () => {
    const { generationId } = await seedConversation({ reservation: true, monthsAgo: 30 });
    expect((await anonymizeOldGuestData()).anonymized).toBeGreaterThanOrEqual(1); // KONTROL: dal koştu
    const t = await traceOf(generationId);
    expect({ draftText: t.draftText, sentText: t.sentText, note: t.note }).toEqual({ draftText: null, sentText: null, note: null });
    expect(t.g.decision).toBe("auto_sent");
    expect(t.g.promptTokens).toBe(120);
    expect(t.g.labels[0].label).toBe("correct");
  });

  it("DAL 2/2 — ÖKSÜZ (rezervasyonsuz) eski konuşmada da silinir", async () => {
    const { generationId } = await seedConversation({ reservation: false, monthsAgo: 30 });
    expect((await anonymizeOldGuestData()).anonymized).toBe(1);
    const t = await traceOf(generationId);
    expect({ draftText: t.draftText, sentText: t.sentText, note: t.note }).toEqual({ draftText: null, sentText: null, note: null });
  });

  it.each([true, false])("KONTROL: saklama penceresi İÇİNDEKİ iz dokunulmaz (rezervasyonlu=%s)", async (reservation) => {
    const { generationId } = await seedConversation({ reservation, monthsAgo: 1 });
    await anonymizeOldGuestData();
    const t = await traceOf(generationId);
    expect({ draftText: t.draftText, sentText: t.sentText, note: t.note }).toEqual({ draftText: DRAFT, sentText: SENT, note: NOTE });
  });
});

describe("AiGeneration izi — açık misafir silmesi", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("silinen konaklamanın iz metni ve etiket notu silinir", async () => {
    const { orgId, reservationId, generationId } = await seedConversation({ reservation: true, monthsAgo: 1 });
    expect(await eraseReservationData(orgId, reservationId!)).not.toBeNull();
    const t = await traceOf(generationId);
    expect({ draftText: t.draftText, sentText: t.sentText, note: t.note }).toEqual({ draftText: null, sentText: null, note: null });
    expect(t.g.decision).toBe("auto_sent");
  });

  it("KONTROL: başka konaklamanın izi dokunulmaz", async () => {
    const a = await seedConversation({ reservation: true, monthsAgo: 1 });
    const b = await seedConversation({ reservation: true, monthsAgo: 1 });
    await eraseReservationData(a.orgId, a.reservationId!);
    const t = await traceOf(b.generationId);
    expect({ draftText: t.draftText, sentText: t.sentText, note: t.note }).toEqual({ draftText: DRAFT, sentText: SENT, note: NOTE });
  });
});

describe("AiGeneration izi — KVKK dışa aktarımı", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("org dışa aktarımı izi metniyle taşır; kurucu etiket notu DIŞARIDA; başka org'un izi yok", async () => {
    const a = await seedConversation({ reservation: true, monthsAgo: 1 });
    await seedConversation({ reservation: true, monthsAgo: 1 });
    const out = await buildOrganizationDataExport(a.orgId);
    expect(out!.aiGenerations.map((g) => g.id)).toEqual([a.generationId]);
    expect(out!.aiGenerations[0]).toMatchObject({ decision: "auto_sent", draftText: DRAFT, sentText: SENT });
    expect(JSON.stringify(out)).not.toContain(NOTE);
  });

  it("silmeden sonra dışa aktarım metni artık göstermez", async () => {
    const a = await seedConversation({ reservation: true, monthsAgo: 1 });
    await eraseReservationData(a.orgId, a.reservationId!);
    const out = await buildOrganizationDataExport(a.orgId);
    expect(out!.aiGenerations[0]).toMatchObject({ draftText: null, sentText: null });
    expect(JSON.stringify(out)).not.toContain("4711");
  });
});
