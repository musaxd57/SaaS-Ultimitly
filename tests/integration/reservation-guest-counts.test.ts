import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { upsertCanonicalReservation } from "@/lib/ingest/write-service";
import { guestPartyOf, normalizeReservation } from "@/lib/channels/hospitable-ingest";
import { guestPartyLineTr, guestPartySentenceEn } from "@/lib/ai/guest-party";
import { buildReplyPrompt } from "@/lib/ai/prompts";
import type { HospitableReservation } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// MİGRATION 86 — REZERVASYON KİŞİ / EVCİL HAYVAN SAYILARI (kurucu onayı 10-23 akşam: "kimlerin geldiğini kaç kişi evcil hayvan var mı
// onu görsün"; seçenek metni: "doğrulayamazsam boş kalır, uydurma yok").
//   · Sağlayıcı eşlemesi ANAHTARLI (`HOSPITABLE_GUEST_COUNTS_ENABLED`): kapalıyken sütunlar boş, okuma sorgusu değişmez.
//   · Yalnız kanalın VERDİĞİ alan yazılır; verilmeyen alan eski değeri silmez; sayılar OLAY değildir.
//   · İstem: bilinen sayı yoksa satır YOK (bayt bayt eski).
// ---------------------------------------------------------------------------

const EXT = "res-guest-counts-1";
const reservation = (guests?: unknown): HospitableReservation => ({
  id: EXT,
  code: "HM9Q1",
  platform: "airbnb",
  arrival_date: "2026-07-20",
  departure_date: "2026-07-23",
  guest: { full_name: "Ayşe Yılmaz" },
  ...(guests !== undefined ? { guests } : {}),
});

async function upsert(propertyId: string, r: HospitableReservation) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { organizationId: true } });
  const ctx = { organizationId: p.organizationId, provider: "hospitable" as const, connectionId: null };
  return prisma.$transaction(async (tx) => upsertCanonicalReservation(tx, propertyId, normalizeReservation(r), ctx));
}
const counts = (propertyId: string) =>
  prisma.reservation.findFirstOrThrow({
    where: { propertyId, sourceReference: EXT },
    select: { id: true, guestAdults: true, guestChildren: true, guestInfants: true, guestPets: true },
  });
const updateEvents = (entityId: string) => prisma.ingestEvent.findMany({ where: { entityId, kind: "reservation.updated" } });

describe("Hospitable eşlemesi (saf)", () => {
  it("guests nesnesindeki sayılar; bozuk / eksik alan null; hiçbiri yoksa null", () => {
    expect(guestPartyOf(reservation({ adult_count: 2, child_count: 1, infant_count: 0, pet_count: 1 }))).toEqual({
      adults: 2,
      children: 1,
      infants: 0,
      pets: 1,
    });
    expect(guestPartyOf(reservation({ adult_count: 2, pet_count: "1", child_count: -1, infant_count: 1.5 }))).toEqual({
      adults: 2,
      children: null,
      infants: null,
      pets: null,
    });
    // Haiku 10-23 akşam: rezervasyonda en az bir yetişkin vardır — 0 yetişkin "bilinmiyor".
    expect(guestPartyOf(reservation({ adult_count: 0, child_count: 2 }))).toEqual({ adults: null, children: 2, infants: null, pets: null });
    expect(guestPartyOf(reservation({ total: 3 }))).toBeNull();
    expect(guestPartyOf(reservation())).toBeNull();
    expect(guestPartyOf(reservation([2, 1]))).toBeNull();
  });
});

describe("bağlam satırları (saf)", () => {
  it("yalnız bilinen sayılar; hiçbiri yoksa boş; evcil hayvan 0 → 'yok'", () => {
    expect(guestPartyLineTr({ guestAdults: 2, guestChildren: 1, guestPets: 1 })).toBe("Kişi sayısı (rezervasyonda kayıtlı): 2 yetişkin, 1 çocuk · evcil hayvan: 1");
    expect(guestPartyLineTr({ guestAdults: 2, guestPets: 0 })).toBe("Kişi sayısı (rezervasyonda kayıtlı): 2 yetişkin · evcil hayvan: yok");
    expect(guestPartyLineTr({ guestAdults: null, guestPets: null })).toBe("");
    // Haiku 10-23 akşam: yalnız evcil hayvan biliniyorsa "Kişi sayısı" denmez; 0 yetişkin yazılmaz.
    expect(guestPartyLineTr({ guestPets: 0 })).toBe("Rezervasyonda kayıtlı evcil hayvan: yok");
    expect(guestPartyLineTr({ guestAdults: 0, guestChildren: 2 })).toBe("Kişi sayısı (rezervasyonda kayıtlı): 2 çocuk");
    expect(guestPartySentenceEn({ guestAdults: 0 })).toBe("");
    expect(guestPartyLineTr(null)).toBe("");
    expect(guestPartySentenceEn({ guestAdults: 1, guestInfants: 2, guestPets: 1 })).toBe(" Booking party: 1 adult, 2 infants; pets on the booking: 1.");
    expect(guestPartySentenceEn({})).toBe("");
  });

  it("🚨 cevap istemi: sayı yoksa BAYT BAYT eski; sayı varsa REZERVASYON bölümünde tek satır", () => {
    const base = {
      guestMessage: "Merhaba",
      property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
      knowledgeBase: [],
      tone: "warm" as const,
      language: "tr",
      now: new Date("2026-07-21T10:00:00Z"),
    };
    const res = { guestName: "Ayşe", arrivalDate: "2026-07-20", departureDate: "2026-07-23", status: "confirmed" };
    const plain = buildReplyPrompt({ ...base, reservation: res }).text;
    expect(buildReplyPrompt({ ...base, reservation: { ...res, guestAdults: null, guestPets: null } }).text).toBe(plain);
    const withParty = buildReplyPrompt({ ...base, reservation: { ...res, guestAdults: 2, guestPets: 1 } }).text;
    expect(withParty).toContain("Kişi sayısı (rezervasyonda kayıtlı): 2 yetişkin · evcil hayvan: 1");
    expect(withParty.indexOf("Kişi sayısı")).toBeGreaterThan(withParty.indexOf("REZERVASYON"));
  });
});

describe("yazma servisi", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 anahtar KAPALIYKEN kanal sayı gönderse de yazılmaz (alan adı doğrulanmadı)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ adult_count: 2, pet_count: 1 }));
    expect(await counts(propertyId)).toMatchObject({ guestAdults: null, guestChildren: null, guestInfants: null, guestPets: null });
  });

  it("🚨 anahtar açıkken yazılır; sonraki senkronda verilmeyen alan eskisini SİLMEZ; değişim OLAY değildir", async () => {
    vi.stubEnv("HOSPITABLE_GUEST_COUNTS_ENABLED", "1");
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ adult_count: 2, child_count: 1, pet_count: 0 }));
    const first = await counts(propertyId);
    expect(first).toMatchObject({ guestAdults: 2, guestChildren: 1, guestInfants: null, guestPets: 0 });
    await upsert(propertyId, reservation({ adult_count: 3 }));
    expect(await counts(propertyId)).toMatchObject({ guestAdults: 3, guestChildren: 1, guestPets: 0 });
    // Mutasyon 10-23 akşam (M15 yaşadı): yetişkin sayısı VERİLMEYEN senkron (yalnız çocuk) eski yetişkin sayısını silmez.
    await upsert(propertyId, reservation({ child_count: 2 }));
    expect(await counts(propertyId)).toMatchObject({ guestAdults: 3, guestChildren: 2, guestPets: 0 });
    await upsert(propertyId, reservation());
    expect(await counts(propertyId)).toMatchObject({ guestAdults: 3, guestChildren: 2, guestPets: 0 });
    expect(await updateEvents(first.id)).toEqual([]);
  });
});
