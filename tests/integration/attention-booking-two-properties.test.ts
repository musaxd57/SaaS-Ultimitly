import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { BOOKING_TWO_PROPERTIES_PANEL_CAP, findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { activeBookingConflicts, BOOKING_CONFLICT_ROW_CAP, BOOKING_ENDED_SLACK_MS } from "@/lib/booking-property-conflict";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// "Dikkat Gerektirenler" — AYNI REZERVASYON İKİ FARKLI DAİREDE KAYITLI (kurucu 11-18 akşam: "iki farklı daireye eşlenmiş rezervasyonda
// otomatik giriş bilgisi tutulmalı ve hosta bir kez eşleştirme uyarısı çıkmalı"). Gerçek PostgreSQL.
//
// Tutma kuralı `booking-property-conflict.ts`te (göndericiler · kuyruk işçisi · Girişler). Bu dosya ev sahibine görünen satırı sınar: aynı
// yüklem, rezervasyon başına TEK satır, sakin günde yok, kiracı kapsamı, tavan aşımı sessiz değil.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;

async function seedOrg(names: string[] = ["Lale 1", "Lale 2", "Lale 3"]) {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const ids: string[] = [];
  for (const name of names) {
    ids.push((await prisma.property.create({ data: { organizationId: org.id, name, createdAt: PROPERTY_EXISTED_BEFORE } })).id);
  }
  return { orgId: org.id, ids };
}

let seq = 0;
async function booking(
  propertyId: string,
  ref: string | null,
  opts: { arrival?: Date; departure?: Date; status?: string } = {},
): Promise<string> {
  const arrivalDate = opts.arrival ?? stayDay(5);
  const departureDate = opts.departure ?? new Date(arrivalDate.getTime() + 3 * 24 * HOUR);
  const r = await prisma.reservation.create({
    data: {
      id: `res-${++seq}`,
      propertyId,
      guestName: "Misafir",
      channel: "airbnb",
      status: opts.status ?? "confirmed",
      sourceReference: ref,
      arrivalDate,
      departureDate,
    },
  });
  return r.id;
}

const rowsOf = async (orgId: string, propertyId?: string) =>
  (await findAttentionItems(orgId, { now: new Date(), ...(propertyId ? { propertyId } : {}) })).filter(
    (i) => i.kind === "booking_two_properties",
  );

describe("Dikkat — aynı rezervasyon iki dairede kayıtlı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(reportError).mockClear();
  });

  it("🚨 iki FARKLI dairede etkin kayıt → TEK satır: iki dairenin adı + varış günü + varış ayının takvimi", async () => {
    const { orgId, ids } = await seedOrg();
    const arrival = stayDay(5);
    // Geç varışlı satır ÖNCE yazılır: "ilk satırın varışı" değil en erken etkin varış okunmalı.
    await booking(ids[0], "HM-1", { arrival: new Date(arrival.getTime() + 24 * HOUR) });
    await booking(ids[1], "HM-1", { arrival });
    const rows = await rowsOf(orgId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.bookingPropertyNames).toEqual(["Lale 1", "Lale 2"]);
    // En erken etkin varış (satırlar farklı tarih taşıyabilir); işletmenin takvim günü.
    expect(row.arrivalDay).toBe(arrival.toISOString().slice(0, 10));
    // UA-1 (kurucu 11-19): bağlantı "Kayıtları karşılaştır" sayfası; anahtar = etkin satırların en küçük kimliği.
    expect(row.href).toBe(`/reservations/compare/${row.rowKey}`);
    expect(row.rowKey).toBe([...(await prisma.reservation.findMany({ select: { id: true } }))].map((r) => r.id).sort()[0]);
    expect(row.bookingMoreCount).toBeUndefined();
    expect(row.certainty).toBe("observed");
    // Kaynak kimliği ekrana / anahtara taşınmaz.
    expect(JSON.stringify(row)).not.toContain("HM-1");
  });

  it("sakin gün: çakışma yoksa satır yok (kart boş)", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    expect(await findAttentionItems(orgId, { now: new Date() })).toEqual([]);
  });

  it("aynı dairede iki kopya (kanal satırı + kaynaksız takvim satırı) → satır YOK", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    await booking(ids[0], null);
    expect(await rowsOf(orgId)).toEqual([]);
  });

  it("kopyalardan biri iptal (yazım farkıyla da) → satır YOK", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    await booking(ids[1], "HM-1", { status: "cancelled" });
    await booking(ids[0], "HM-2");
    await booking(ids[1], "HM-2", { status: "Canceled" });
    expect(await rowsOf(orgId)).toEqual([]);
  });

  it("öteki kopya 'bekliyor' → satır VAR (etkin)", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    await booking(ids[1], "HM-1", { status: "pending" });
    expect(await rowsOf(orgId)).toHaveLength(1);
  });

  it("🚨 konaklaması 48 saatten ÖNCE bitmiş kopya → satır YOK; pay içinde bitmiş → VAR (tutma kuralıyla aynı sınır)", async () => {
    const { orgId, ids } = await seedOrg();
    const now = Date.now();
    // Bayat kopya: pay dışı.
    await booking(ids[0], "HM-OLD", { arrival: new Date(now - 6 * 24 * HOUR), departure: new Date(now - BOOKING_ENDED_SLACK_MS - HOUR) });
    await booking(ids[1], "HM-OLD", { arrival: new Date(now - 6 * 24 * HOUR), departure: new Date(now - BOOKING_ENDED_SLACK_MS - HOUR) });
    expect(await rowsOf(orgId)).toEqual([]);
    // Pay içinde (çıkış dün): hâlâ etkin → satır.
    await booking(ids[0], "HM-NEW", { arrival: new Date(now - 4 * 24 * HOUR), departure: new Date(now - BOOKING_ENDED_SLACK_MS + HOUR) });
    await booking(ids[1], "HM-NEW", { arrival: new Date(now - 4 * 24 * HOUR), departure: new Date(now - BOOKING_ENDED_SLACK_MS + HOUR) });
    expect(await rowsOf(orgId)).toHaveLength(1);
  });

  it("iki AYRI rezervasyon aynı gün iki dairede → satır YOK", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    await booking(ids[1], "HM-2");
    expect(await rowsOf(orgId)).toEqual([]);
  });

  it("🚨 başka işletmenin aynı kaynak kimlikli kaydı → satır YOK (iki tarafta da)", async () => {
    const a = await seedOrg(["Lale 1"]);
    const b = await seedOrg(["Lale 9"]);
    await booking(a.ids[0], "HM-1");
    await booking(b.ids[0], "HM-1");
    expect(await rowsOf(a.orgId)).toEqual([]);
    expect(await rowsOf(b.orgId)).toEqual([]);
  });

  it("🚨 gerçek çakışmanın satırına başka işletmenin aynı kimlikli dairesi KARIŞMAZ", async () => {
    const a = await seedOrg(["Lale 1", "Lale 2"]);
    const b = await seedOrg(["Lale 9"]);
    await booking(a.ids[0], "HM-1");
    await booking(a.ids[1], "HM-1");
    await booking(b.ids[0], "HM-1");
    const rows = await rowsOf(a.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].bookingPropertyNames).toEqual(["Lale 1", "Lale 2"]);
  });

  it("üç dairede → TEK satır, üç ad (ada göre sıralı)", async () => {
    const { orgId, ids } = await seedOrg(["Lale 3", "Lale 1", "Lale 2"]);
    for (const id of ids) await booking(id, "HM-1");
    const rows = await rowsOf(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].bookingPropertyNames).toEqual(["Lale 1", "Lale 2", "Lale 3"]);
  });

  it("iki çakışan rezervasyon → iki satır, ayrık satır anahtarlarıyla (aynı gün aynı ayda olsalar da)", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    await booking(ids[1], "HM-1");
    await booking(ids[1], "HM-2");
    await booking(ids[2], "HM-2");
    const rows = await rowsOf(orgId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(2);
  });

  it("tek daireye daraltılmış çağrı: o daireyi içeren çakışma görünür, içermeyen görünmez", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    await booking(ids[1], "HM-1");
    const own = await rowsOf(orgId, ids[1]);
    expect(own).toHaveLength(1);
    expect(own[0].propertyId).toBe(ids[1]);
    expect(own[0].bookingPropertyNames).toEqual(["Lale 1", "Lale 2"]);
    expect(await rowsOf(orgId, ids[2])).toEqual([]);
  });

  it("tavan: en yakın varışlı `cap` ETKİN çakışma döner, aşım `capped` ile bildirilir; çakışma olmayan aday tavanı doldurmaz", async () => {
    const { orgId, ids } = await seedOrg();
    const other = await seedOrg(["Lale 9"]);
    // Daha ERKEN varışlı ama çakışma OLMAYAN gruplar — sorgu süzgeci gevşerse tavanın bir yerini kapıp HM-B'yi dışarı iterler:
    const now = Date.now();
    await booking(ids[0], "HM-0", { arrival: stayDay(1) }); // tek satır
    await booking(ids[0], "HM-X", { arrival: stayDay(1) }); // öteki kopya iptal (büyük harfli yazım)
    await booking(ids[1], "HM-X", { arrival: stayDay(1), status: "Cancelled" });
    await booking(ids[0], "HM-OLD", { arrival: new Date(now - 10 * 24 * HOUR), departure: new Date(now - 7 * 24 * HOUR) }); // bayat çift
    await booking(ids[1], "HM-OLD", { arrival: new Date(now - 10 * 24 * HOUR), departure: new Date(now - 7 * 24 * HOUR) });
    await booking(ids[0], "HM-T", { arrival: stayDay(1) }); // aynı kimlik başka işletmede
    await booking(other.ids[0], "HM-T", { arrival: stayDay(1) });
    await booking(ids[0], null, { arrival: stayDay(0) }); // kaynaksız iki satır
    await booking(ids[1], null, { arrival: stayDay(0) });
    for (const [i, ref] of ["HM-C", "HM-A", "HM-B"].entries()) {
      // HM-C en geç, HM-A en erken.
      const arrival = stayDay(ref === "HM-A" ? 2 : ref === "HM-B" ? 4 : 9);
      await booking(ids[0], ref, { arrival });
      await booking(ids[1 + (i % 2)], ref, { arrival });
    }
    const capped = await activeBookingConflicts(prisma, { organizationId: orgId, now: new Date(), cap: 2 });
    expect(capped.capped).toBe(true);
    expect(capped.conflicts.map((c) => c.sourceReference)).toEqual(["HM-A", "HM-B"]);
    const exact = await activeBookingConflicts(prisma, { organizationId: orgId, now: new Date(), cap: 3 });
    expect(exact.capped).toBe(false);
    expect(exact.conflicts).toHaveLength(3);
  });

  it("🚨 kart tavanı (UA-1): en yakın varışlı 3 rezervasyon satır olur, SON satır kalan sayıyı taşır; tam 3'te sayı yok", async () => {
    expect(BOOKING_TWO_PROPERTIES_PANEL_CAP).toBe(3);
    const { orgId, ids } = await seedOrg();
    for (const [i, ref] of ["HM-E", "HM-A", "HM-D", "HM-B", "HM-C"].entries()) {
      const arrival = stayDay({ "HM-A": 2, "HM-B": 3, "HM-C": 4, "HM-D": 5, "HM-E": 6 }[ref]!);
      await booking(ids[0], ref, { arrival });
      await booking(ids[1 + (i % 2)], ref, { arrival });
    }
    const rows = await rowsOf(orgId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.arrivalDay)).toEqual([stayDay(2), stayDay(3), stayDay(4)].map((d) => d.toISOString().slice(0, 10)));
    expect(rows.map((r) => r.bookingMoreCount)).toEqual([undefined, undefined, 2]);
    // Öteki satır türleri dışarı itilmez: aynı dairedeki üst üste gecelerin çakışma satırları da 8'lik listede yer bulur.
    const all = await findAttentionItems(orgId, { now: new Date() });
    expect(all.filter((i) => i.kind === "booking_two_properties")).toHaveLength(3);
    expect(all.some((i) => i.kind === "calendar_conflict")).toBe(true);
    // Tam tavan: sayı yok.
    await prisma.reservation.deleteMany({ where: { sourceReference: { in: ["HM-D", "HM-E"] } } });
    expect((await rowsOf(orgId)).map((r) => r.bookingMoreCount)).toEqual([undefined, undefined, undefined]);
  });

  it("🚨 tavan aşımı akışta SESSİZ kalmaz: alarm üretilir", async () => {
    const { orgId, ids } = await seedOrg();
    const data = [];
    for (let i = 0; i <= BOOKING_CONFLICT_ROW_CAP; i++) {
      const ref = `HM-${String(i).padStart(3, "0")}`;
      const base = { guestName: "Misafir", channel: "airbnb", status: "confirmed", sourceReference: ref, arrivalDate: stayDay(3), departureDate: stayDay(6) };
      data.push({ ...base, propertyId: ids[0] }, { ...base, propertyId: ids[1] });
    }
    await prisma.reservation.createMany({ data });
    await rowsOf(orgId);
    // Alarm `void` ile ateşlenir; bir sonraki makro göreve kadar bekle.
    await vi.waitFor(() =>
      expect(vi.mocked(reportError).mock.calls.map((c) => c[0])).toContain("attention booking_two_properties cap"),
    );
  });

  it("tavanın altında alarm YOK", async () => {
    const { orgId, ids } = await seedOrg();
    await booking(ids[0], "HM-1");
    await booking(ids[1], "HM-1");
    await rowsOf(orgId);
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(reportError).mock.calls.map((c) => c[0])).not.toContain("attention booking_two_properties cap");
  });
});
