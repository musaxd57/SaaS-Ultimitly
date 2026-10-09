import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { anonymizeOldGuestData, ANON_BODY, ANON_ID, ANON_NAME } from "@/lib/data-retention";
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

interface SeedOpts {
  reservation: boolean;
  monthsAgo: number;
  /** Aynı org'a ikinci konaklama (kardeş kontrolü). */
  orgId?: string;
  propertyId?: string;
  /** Konaklama ZATEN süpürülmüş (ad / gövde sentinel) — yalnız iz metni kaldı. */
  alreadySwept?: boolean;
  /** İz ve mesaj yaşı (ay); verilmezse şimdi. */
  genMonthsAgo?: number;
  msgMonthsAgo?: number;
}

async function seedConversation(opts: SeedOpts) {
  const orgId = opts.orgId ?? (await prisma.organization.create({ data: { name: "Org" } })).id;
  const propertyId = opts.propertyId ?? (await prisma.property.create({ data: { organizationId: orgId, name: "Daire 1" } })).id;
  const name = opts.alreadySwept ? ANON_NAME : "Ayşe Yılmaz";
  const reservation = opts.reservation
    ? await prisma.reservation.create({
        data: {
          propertyId,
          guestName: name,
          arrivalDate: subMonths(new Date(), opts.monthsAgo + 1),
          departureDate: subMonths(new Date(), opts.monthsAgo),
          status: "completed",
        },
      })
    : null;
  const at = (m: number | undefined) => (m === undefined ? new Date() : subMonths(new Date(), m));
  const conv = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation?.id ?? null,
      channel: "airbnb",
      guestIdentifier: opts.alreadySwept ? ANON_ID : "Ayşe Yılmaz",
      lastMessageAt: subMonths(new Date(), opts.monthsAgo),
      messages: {
        create: [
          {
            direction: "inbound",
            senderName: opts.alreadySwept ? ANON_ID : "Ayşe Yılmaz",
            body: opts.alreadySwept ? ANON_BODY : "Kapı kodu?",
            createdAt: at(opts.msgMonthsAgo),
          },
        ],
      },
    },
  });
  const gen = await prisma.aiGeneration.create({
    data: {
      organizationId: orgId,
      conversationId: conv.id,
      propertyId,
      reservationId: reservation?.id ?? null,
      surface: "channel_auto",
      model: "test-model",
      promptVersion: "p1",
      decision: "auto_sent",
      draftText: DRAFT,
      sentText: SENT,
      promptTokens: 120,
      createdAt: at(opts.genMonthsAgo),
      labels: { create: [{ label: "correct", note: NOTE }] },
    },
  });
  return { orgId, propertyId, reservationId: reservation?.id ?? null, generationId: gen.id };
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

describe("AiGeneration izi — süpürge, yaş çapası AÇIK (RETENTION_MESSAGE_AGE_ANCHOR=1)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    vi.stubEnv("RETENTION_MESSAGE_AGE_ANCHOR", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([true, false])(
    "🚨 SEÇİM BACAĞI: zaten süpürülmüş konaklamada kalan eski iz metni yeniden seçilip silinir (rezervasyonlu=%s)",
    async (reservation) => {
      const { generationId } = await seedConversation({ reservation, monthsAgo: 30, alreadySwept: true, genMonthsAgo: 26, msgMonthsAgo: 30 });
      await anonymizeOldGuestData();
      const t = await traceOf(generationId);
      expect({ draftText: t.draftText, sentText: t.sentText, note: t.note }).toEqual({ draftText: null, sentText: null, note: null });
      // Sonlanma: ikinci geçiş aynı satırı yeniden seçmez.
      expect((await anonymizeOldGuestData()).anonymized).toBe(0);
    },
  );

  it.each([true, false])(
    "KONTROL (Message paritesi): eski konaklamaya BUGÜN verilmiş cevabın izi korunur, eski iz silinir (rezervasyonlu=%s)",
    async (reservation) => {
      const old = await seedConversation({ reservation, monthsAgo: 30, genMonthsAgo: 30, msgMonthsAgo: 30 });
      const fresh = await prisma.aiGeneration.create({
        data: {
          organizationId: old.orgId,
          conversationId: (await prisma.aiGeneration.findUniqueOrThrow({ where: { id: old.generationId } })).conversationId,
          surface: "channel_auto",
          model: "test-model",
          promptVersion: "p1",
          decision: "auto_sent",
          draftText: DRAFT,
          sentText: SENT,
          labels: { create: [{ label: "correct", note: NOTE }] },
        },
      });
      expect((await anonymizeOldGuestData()).anonymized).toBe(1);
      expect(await traceOf(old.generationId)).toMatchObject({ draftText: null, sentText: null, note: null });
      expect(await traceOf(fresh.id)).toMatchObject({ draftText: DRAFT, sentText: SENT, note: NOTE });
    },
  );
});

describe("AiGeneration izi — açık silme, AYNI org kardeş konaklama", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("KONTROL: aynı org'un başka konaklamasının izi dokunulmaz", async () => {
    const a = await seedConversation({ reservation: true, monthsAgo: 1 });
    const b = await seedConversation({ reservation: true, monthsAgo: 1, orgId: a.orgId, propertyId: a.propertyId });
    await eraseReservationData(a.orgId, a.reservationId!);
    expect(await traceOf(a.generationId)).toMatchObject({ draftText: null, sentText: null, note: null });
    expect(await traceOf(b.generationId)).toMatchObject({ draftText: DRAFT, sentText: SENT, note: NOTE });
  });
});

describe("AiGeneration izi — dışa aktarıma BAĞLI DEĞİL (eğitim yasağı, tasarım §D)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("org dışa aktarımı iz metnini ve kurucu notunu taşımaz", async () => {
    const a = await seedConversation({ reservation: true, monthsAgo: 1 });
    const out = await buildOrganizationDataExport(a.orgId);
    expect(out).not.toBeNull();
    const json = JSON.stringify(out);
    expect(json).not.toContain(DRAFT);
    expect(json).not.toContain(SENT);
    expect(json).not.toContain(NOTE);
    expect(json).not.toContain(a.generationId);
  });
});
