import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { upsertCanonicalReservation } from "@/lib/ingest/write-service";
import { normalizeReservation } from "@/lib/channels/hospitable-ingest";
import { ANON_NAME } from "@/lib/anon-sentinels";
import type { HospitableReservation } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// TAKVİM C3 (Codex 11-10) — ORTAK YAZMA SERVİSİ: ANONİMLEŞTİRİLEN SATIRA KİŞİSEL VERİ GERİ YAZILMAZ. Gerçek PostgreSQL.
//
// Kanal senkronu satırı okur ("anonim değil"), sonra yazar. Saklama süpürgesi bu işlemin kilidini almaz: okuma ile yazma arasında satırı
// anonimleştirirse eski okumaya dayanan yazım gerçek adı / e-postayı / telefonu kanaldan GERİ yazıyordu ("Eski misafir → Ada"). Kişisel
// alanlar artık ayrı ve koşullu yazılır (satır yazım anında hâlâ anonim değilse); tarih / durum güncellemesi anonim satıra da uygulanır.
// Takvim aboneliği yolunun aynı testi `calendar-codex-1110.test.ts`te.
// ---------------------------------------------------------------------------

const EXT = "prov-res-scrub-1";
const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

function reservation(over: { name?: string; email?: string; phone?: string; departure?: number } = {}): HospitableReservation {
  return {
    id: EXT,
    code: "HM4K2",
    platform: "airbnb",
    status: "accepted",
    arrival_date: isoDay(10),
    departure_date: isoDay(over.departure ?? 13),
    guest: { full_name: over.name ?? "Ada Yılmaz", email: over.email ?? "ada@example.com", phone: over.phone ?? "+905550000001" },
  } as HospitableReservation;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Yazma servisinin rezervasyon OKUMASINDAN hemen sonra (yazmadan önce) `between` koşar — başka bağlantıdan gelen eşzamanlı yazma. */
function racingTx(tx: Tx, between: () => Promise<void>): Tx {
  const reservationDelegate = new Proxy(tx.reservation, {
    get(target, prop) {
      if (prop === "findFirst") {
        return async (args: unknown) => {
          const snap = await (target.findFirst as (a: unknown) => Promise<unknown>)(args);
          await between();
          return snap;
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === "reservation") return reservationDelegate;
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as Tx;
}

async function upsert(propertyId: string, r: HospitableReservation, between?: () => Promise<void>) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { organizationId: true } });
  const ctx = { organizationId: p.organizationId, provider: "hospitable" as const, connectionId: null };
  return prisma.$transaction(async (tx) => upsertCanonicalReservation(between ? racingTx(tx, between) : tx, propertyId, normalizeReservation(r), ctx));
}

const row = (propertyId: string) =>
  prisma.reservation.findFirstOrThrow({
    where: { propertyId, sourceReference: EXT },
    select: { id: true, guestName: true, guestEmail: true, guestPhone: true, departureDate: true, status: true },
  });
/** Saklama süpürgesinin yaptığı: kişisel alanlar gider, ad yer tutucuya döner. */
const anonymize = (id: string) => prisma.reservation.update({ where: { id }, data: { guestName: ANON_NAME, guestGivenName: null, guestEmail: null, guestPhone: null, guestExternalId: null } });

describe("ortak yazma servisi — anonim satıra kişisel veri geri yazılmaz (C3)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 senkron satırı okuduktan SONRA satır anonimleştirildi → ad / e-posta / telefon GERİ YAZILMAZ; tarih yine eşitlenir; olay kişisel alan taşımaz", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ name: "Eski Misafir", email: "eski@example.com", phone: "+905550000009" }));
    const { id } = await row(propertyId);
    const eventsBefore = await prisma.ingestEvent.count({ where: { entityId: id } });

    await upsert(propertyId, reservation({ name: "Ada Yılmaz", departure: 15 }), async () => {
      await anonymize(id); // süpürge tam bu arada koştu
    });

    const after = await row(propertyId);
    expect(after.guestName).toBe(ANON_NAME); // ⬅️ ESKİDE "Ada Yılmaz"
    expect(after.guestEmail).toBeNull(); // ⬅️ ESKİDE "ada@example.com"
    expect(after.guestPhone).toBeNull();
    expect(after.departureDate.toISOString().slice(0, 10)).toBe(isoDay(15)); // kişisel olmayan güncelleme uygulanır

    const events = await prisma.ingestEvent.findMany({ where: { entityId: id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { kind: true, changedFieldsJson: true } });
    expect(events.length).toBe(eventsBefore + 1);
    const last = events[events.length - 1];
    expect(last.kind).toBe("reservation.updated");
    expect(last.changedFieldsJson).toContain("departureDate");
    for (const f of ["guestName", "guestEmail", "guestPhone"]) expect(last.changedFieldsJson ?? "").not.toContain(f); // yazılmayan alan "değişti" denmez
  });

  it("🚨 yalnız kişisel alan değişmişken satır o arada anonimleştirildiyse HİÇBİR şey yazılmaz ve olay üretilmez", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ name: "Eski Misafir" }));
    const { id } = await row(propertyId);
    const eventsBefore = await prisma.ingestEvent.count({ where: { entityId: id } });
    await upsert(propertyId, reservation({ name: "Ada Yılmaz" }), async () => {
      await anonymize(id);
    });
    expect((await row(propertyId)).guestName).toBe(ANON_NAME);
    expect(await prisma.ingestEvent.count({ where: { entityId: id } })).toBe(eventsBefore);
  });

  it("KONTROL: araya anonimleştirme GİRMEZSE ad / e-posta / telefon değişikliği eskisi gibi yazılır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ name: "Eski Misafir", email: "eski@example.com", phone: "+905550000009" }));
    await upsert(propertyId, reservation({ name: "Ada Yılmaz" }), async () => {});
    const after = await row(propertyId);
    expect(after.guestName).toBe("Ada Yılmaz");
    expect(after.guestEmail).toBe("ada@example.com");
    expect(after.guestPhone).toBe("+905550000001");
  });

  it("KONTROL: senkron başlamadan ÖNCE anonimleştirilmiş satır (eski kural) yine korunur", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await upsert(propertyId, reservation({ name: "Eski Misafir" }));
    const { id } = await row(propertyId);
    await anonymize(id);
    await upsert(propertyId, reservation({ name: "Ada Yılmaz", departure: 15 }));
    const after = await row(propertyId);
    expect(after.guestName).toBe(ANON_NAME);
    expect(after.guestEmail).toBeNull();
    expect(after.departureDate.toISOString().slice(0, 10)).toBe(isoDay(15));
  });
});
