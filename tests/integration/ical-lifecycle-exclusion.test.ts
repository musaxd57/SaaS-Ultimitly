import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// 🚨 BESLEMEDEN GELEN REZERVASYONA YAŞAM-DÖNGÜSÜ MESAJI GÖNDERİLMEZ.
//
// Bu, 08-08 denetiminin bulduğu ve DÖRT AJANIN BİRDEN kaçırdığı kusurdur.
// Yaşam-döngüsü sorguları `channel: { notIn: ["ics","manual"] }` yazıyor ve
// yorumları "toChannel() asla ics/manual üretmez, yani bu satır iCal'i eler"
// diyordu. YANLIŞ: abonelik senkronu kanalı `channelFromLabel(source.label)`
// ile yazıyor ve o fonksiyon ASLA "ics" döndürmüyor — "Airbnb" etiketli bir
// besleme `channel: "airbnb"` üretiyor.
//
// Zararı takvim senkronu CRON'A BAĞLANINCA (aynı tur) süreklileşti: her geçişte
// beslemeden yeni rezervasyon geliyor, karşılama mesajı iCal UID'sini Hospitable
// rezervasyon id'si sanıp POST ediliyor, 4xx dönüyor, claim geri alınıyor ve
// aynı satır 2 dakika sonra TEKRAR deneniyor — sonsuza kadar.
//
// ⚠️ Bu test KANAL DEĞERİNİ DEĞİL, DAVRANIŞI pinliyor: satır "airbnb" kanalıyla
// yazılır (rozet doğru görünsün diye — bu bilinçli, sınıflandırma değerini
// görüntü kaygısıyla bükmüyoruz) ve buna RAĞMEN aday olmaması gerekir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", () => ({ sendOnChannel: vi.fn(async () => ({ ok: true, externalId: "x" })) }));

describe("iCal beslemesinden gelen rezervasyon yaşam-döngüsü adayı DEĞİLDİR", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("besleme satırı 'airbnb' kanalıyla yazılsa bile aday listesine GİRMEZ", async () => {
    const { orgId: organizationId, propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/f.ics" },
    });

    const base = {
      propertyId,
      status: "confirmed",
      guestName: "Deniz",
      arrivalDate: new Date(Date.now() + 2 * 86400_000),
      departureDate: new Date(Date.now() + 5 * 86400_000),
    };
    // Beslemeden gelen satır — kanalı "airbnb" (channelFromLabel'ın ürettiği değer).
    await prisma.reservation.create({
      data: { ...base, sourceReference: "ical-uid-1", channel: "airbnb", calendarSourceId: source.id },
    });
    // KONTROL: aynı şekle sahip GERÇEK Hospitable satırı — bu aday OLMALI.
    // Bu kontrol olmadan test, sorguyu komple bozan bir mutasyonu da yeşil geçerdi.
    await prisma.reservation.create({
      data: { ...base, sourceReference: "hosp-2", channel: "airbnb", calendarSourceId: null },
    });

    const candidates = await prisma.reservation.findMany({
      where: {
        property: { organizationId },
        status: "confirmed",
        sourceReference: { not: null },
        channel: { notIn: ["ics", "manual"] },
        calendarSourceId: null,
      },
      select: { sourceReference: true },
    });

    expect(candidates.map((c) => c.sourceReference)).toEqual(["hosp-2"]);
  });

  it("kaynak tarama: ALTI yaşam-döngüsü sorgusunun HEPSİ iki kapıyı birden taşır", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/automation.ts", "utf8");
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    const channelGates = code.match(/channel: \{ notIn: \["ics", "manual"\] \}/g) ?? [];
    expect(channelGates.length).toBe(6);
    // Her `channel` kapısının HEMEN ARDINDAN calendarSourceId gelmeli. Biri
    // eklenip diğeri unutulursa (yeni bir sorgu yazan kişi) bu kırmızı verir.
    // ⚠️ `[^\n]*` ŞART: altı satırın dördü SATIR SONU YORUMU taşıyor
    // ("// only Hospitable-messageable bookings"). İlk yazımım `\s*\n` diyordu
    // ve o dördünü göremiyordu — kapı DOĞRU konmuşken test 2/6 raporluyordu.
    // Yanlış NEGATİF zararsız görünür ama aynı hatanın tersi (fazla gevşek
    // regex) sessiz bir yanlış POZİTİF olurdu; bitişiklik şartı korunuyor.
    const paired = code.match(/channel: \{ notIn: \["ics", "manual"\] \},[^\n]*\n\s*calendarSourceId: null,/g) ?? [];
    expect(paired.length).toBe(6);
  });
});
