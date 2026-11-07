import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { anonymizeOldGuestData } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// m48 — KVKK KAPSAMI, **DAL DÜZEYİNDE**
//
// 🚨 NEDEN AYRI DOSYA VE NEDEN DAL DÜZEYİ (Codex kısıtı, 08-09):
// `scrub-scope-parity.test.ts` iki süpürgenin YAZDIĞI (model, kolon) KÜMELERİNİ
// karşılaştırıyor — yani DOSYA düzeyinde. `data-retention.ts` içinde İKİ ayrı
// `conversation.updateMany` var (rezervasyonlu dal ve ÖKSÜZ dal) ve parite testi
// yalnız birine yazılmış olsa bile kümeleri EŞİT görür. Bu deponun daha önce
// tam olarak burada yandığı biliniyor: `TaskUpdate.note` öksüz dalda unutulmuştu
// ve parite testi görmemişti.
//
// Bu yüzden ÜÇ yol ayrı ayrı sürülüyor:
//   1. süre-bazlı · REZERVASYONLU dal
//   2. süre-bazlı · ÖKSÜZ dal  ← parite testinin kör noktası
//   3. açık silme (`erasure.ts`) — kendi dosyasındaki testte (`erasure.test.ts`
//      harness'ı tombstone kurulumu ister); buradaki iki dal onun aynası.
//
// KAPSAM KARARI: yalnız İKİ METİN kolonu silinir. `aiConfidence` (sayı),
// `aiTriageSource` (kapalı-set etiket), `aiTriagedAt` (damga) ve
// `aiTriageTriggerMessageId` (opak id) kişisel veri TAŞIMAZ — `aiSourcesJson`
// emsali. Bu testler o kararı da pinliyor: dördü SAĞ KALMALI.
// ---------------------------------------------------------------------------

const TRIAGE = {
  aiActionSuggestion: "Ayşe Yılmaz'ı arayın, banyodaki küfü fotoğraflatın.",
  aiMissingInfoJson: JSON.stringify(["fotoğraf", "Ayşe Yılmaz'ın telefonu"]),
  aiConfidence: 0.87,
  aiTriageSource: "model",
  aiTriageTriggerMessageId: "msg-tetikleyici",
  aiTriagedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("m48 KVKK — süre-bazlı süpürge, İKİ DAL AYRI AYRI", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("DAL 1/2 — REZERVASYONLU konuşmada triyaj METİNLERİ silinir", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire 1" },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Ayşe Yılmaz",
        arrivalDate: subMonths(new Date(), 31),
        departureDate: subMonths(new Date(), 30),
        status: "completed",
      },
    });
    const conv = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        reservationId: reservation.id,
        channel: "airbnb",
        guestIdentifier: "Ayşe Yılmaz",
        lastMessageAt: subMonths(new Date(), 30),
        messages: { create: [{ direction: "inbound", senderName: "Ayşe Yılmaz", body: "Küf var" }] },
        ...TRIAGE,
      },
    });

    expect((await anonymizeOldGuestData()).anonymized).toBeGreaterThan(0); // KONTROL

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.aiActionSuggestion).toBeNull();
    expect(c.aiMissingInfoJson).toBeNull();
    // Misafir adı gerçekten metnin içindeydi — yani silinen şey PII taşıyordu.
    expect(TRIAGE.aiActionSuggestion).toContain("Ayşe");
    // KAPSAM DIŞI dördü SAĞ KALIR (kapsamı genişleten mutasyon da kırmızı verir).
    expect(c.aiConfidence).toBe(0.87);
    expect(c.aiTriageSource).toBe("model");
    expect(c.aiTriageTriggerMessageId).toBe("msg-tetikleyici");
    expect(c.aiTriagedAt).not.toBeNull();
  });

  it("DAL 2/2 — ÖKSÜZ konuşmada da silinir (parite testinin KÖR NOKTASI)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire 1" },
    });
    const orphan = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        // reservationId YOK — süpürgenin ÖKSÜZ dalına düşer.
        channel: "airbnb",
        guestIdentifier: "Fatma Şahin",
        lastMessageAt: subMonths(new Date(), 30),
        messages: { create: [{ direction: "inbound", senderName: "Fatma Şahin", body: "Kapı kodu?" }] },
        ...TRIAGE,
      },
    });

    expect((await anonymizeOldGuestData()).anonymized).toBe(1); // KONTROL: öksüz dal koştu

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: orphan.id } });
    // ⬅️ Yalnız rezervasyonlu dala eklenseydi BURASI dolu kalırdı ve
    //    `scrub-scope-parity` bunu GÖREMEZDİ (kümeler yine eşit olurdu).
    expect(c.aiActionSuggestion).toBeNull();
    expect(c.aiMissingInfoJson).toBeNull();
    expect(c.aiConfidence).toBe(0.87); // kapsam dışı, sağ kaldı
    expect(c.aiTriageSource).toBe("model");
  });

  it("KONTROL: saklama penceresi İÇİNDEKİ konuşmaya DOKUNULMAZ", async () => {
    // Bu olmadan "her zaman sil" mutasyonu da yeşil geçerdi ve süpürge canlı
    // konuşmaların analizini silerdi.
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire 1" },
    });
    const fresh = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: "Taze Misafir",
        lastMessageAt: subMonths(new Date(), 1),
        messages: { create: [{ direction: "inbound", senderName: "Taze Misafir", body: "Merhaba" }] },
        ...TRIAGE,
      },
    });

    await anonymizeOldGuestData();

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(c.aiActionSuggestion).toBe(TRIAGE.aiActionSuggestion);
    expect(c.aiMissingInfoJson).toBe(TRIAGE.aiMissingInfoJson);
  });
});
