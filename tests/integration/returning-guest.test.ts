import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { getReturningGuestInfo } from "@/lib/returning-guest";

async function stay(
  propertyId: string,
  over: Partial<{ guestExternalId: string | null; status: string; arrivalDate: Date; departureDate: Date }> = {},
) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      arrivalDate: over.arrivalDate ?? daysFromNow(-5),
      departureDate: over.departureDate ?? daysFromNow(-2),
      status: over.status ?? "completed",
      channel: "airbnb",
      guestExternalId: "guestExternalId" in over ? over.guestExternalId : null,
    },
  });
}

describe("getReturningGuestInfo (stable guest id only — no false positives)", () => {
  beforeEach(resetDb);

  it("counts prior non-cancelled stays sharing the guest id, excluding the current one", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await stay(propertyId, { guestExternalId: "g1", arrivalDate: daysFromNow(-30), departureDate: daysFromNow(-27) });
    await stay(propertyId, { guestExternalId: "g1", arrivalDate: daysFromNow(-10), departureDate: daysFromNow(-7) });
    const current = await stay(propertyId, {
      guestExternalId: "g1",
      status: "confirmed",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
    });

    const info = await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "g1", arrivalDate: current.arrivalDate });
    expect(info).not.toBeNull();
    expect(info!.stayCount).toBe(3);
    expect(info!.pastStays).toHaveLength(2);
    expect(info!.pastStays.some((s) => s.id === current.id)).toBe(false);
  });

  it("returns null when the current reservation has no guest id (manual/iCal/old rows)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const current = await stay(propertyId, { guestExternalId: null });
    expect(await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: null, arrivalDate: current.arrivalDate })).toBeNull();
  });

  it("returns null for a first-time guest (no other stay shares the id)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const current = await stay(propertyId, { guestExternalId: "solo" });
    expect(await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "solo", arrivalDate: current.arrivalDate })).toBeNull();
  });

  it("excludes cancelled prior stays", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await stay(propertyId, { guestExternalId: "g2", status: "cancelled" });
    const current = await stay(propertyId, { guestExternalId: "g2", status: "confirmed" });
    // The only other stay is cancelled → not counted → first-timer → null.
    expect(await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "g2", arrivalDate: current.arrivalDate })).toBeNull();
  });

  it("çok konaklamalı misafirde SAYI doğrudur (liste kısa, sayı tam)", async () => {
    // BULUNAN HATA: sorgu `take: 20` ile sınırlıydı ve `stayCount` DÖNEN SATIR
    // SAYISINDAN türetiliyordu. 25 önceki konaklaması olan misafirde rozet
    // "21. konaklama" diyordu — kırpma değil, YANLIŞ SAYI. Ekranda kesin bir
    // rakam gibi duruyor ve host bunu misafirle konuşurken kullanıyor.
    const { propertyId, orgId } = await makeOrgWithProperty();
    for (let i = 0; i < 25; i++) {
      await stay(propertyId, {
        guestExternalId: "vip",
        arrivalDate: daysFromNow(-100 + i),
        departureDate: daysFromNow(-99 + i),
      });
    }
    const current = await stay(propertyId, { guestExternalId: "vip", status: "confirmed" });

    const info = await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "vip", arrivalDate: current.arrivalDate });
    expect(info!.stayCount).toBe(26); // 25 önceki + bu konaklama
    // Liste bilinçli kısa (kart bir kenar çubuğunda) — ama sayı tam.
    expect(info!.pastStays.length).toBeLessThanOrEqual(5);
    expect(info!.pastStays.length).toBeGreaterThan(0);
    // En yeniler önce: listedeki ilk satır en son konaklama olmalı.
    expect(info!.pastStays[0].arrivalDate.getTime()).toBeGreaterThan(
      info!.pastStays[info!.pastStays.length - 1].arrivalDate.getTime(),
    );
  });

  it("NEVER matches across organizations (tenant isolation)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await stay(b.propertyId, { guestExternalId: "shared" }); // another tenant's guest with the SAME id
    const current = await stay(a.propertyId, { guestExternalId: "shared" });
    expect(await getReturningGuestInfo(a.orgId, { id: current.id, guestExternalId: "shared", arrivalDate: current.arrivalDate })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SEMANTİK BOŞLUK (Codex): "dönen misafir" NE demek?
//
// Sorgu yalnız `id != current` + `status != cancelled` filtreliyordu, yani
// misafirin İLERİ TARİHLİ ikinci rezervasyonunu da sayıyordu. Sonuç: misafirin
// İLK konaklamasında rozet "2. konaklama" diyor. Bu kişi daha hiç gelmemiş.
//
// Ürün anlamı: "N. konaklama" = BU konaklamanın, misafirin bu işletmedeki
// geçmişindeki SIRA numarası. Dolayısıyla ölçüt MEVCUT REZERVASYONUN gelişine
// göre olmalı ("bundan önce gelen konaklamalar"), takvimdeki "şu an"a göre
// değil: host ileri tarihli bir rezervasyona bakarken de doğru cevabı almalı.
//
// Alan adları da bunu söylüyordu: tip `PastStay`, alan `pastStays` — GEÇMİŞ.
// ---------------------------------------------------------------------------
describe("getReturningGuestInfo — yalnız BU konaklamadan ÖNCEKİLER sayılır", () => {
  beforeEach(resetDb);

  it("ileri tarihli İKİNCİ rezervasyon, İLK konaklamayı 'dönen misafir' YAPMAZ", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    // Misafirin ilk gelişi (yakında) — şu an bakılan rezervasyon.
    const current = await stay(propertyId, {
      guestExternalId: "ileri",
      status: "confirmed",
      arrivalDate: daysFromNow(2),
      departureDate: daysFromNow(5),
    });
    // Aynı misafirin DAHA SONRAKİ ikinci rezervasyonu (iptal değil).
    await stay(propertyId, {
      guestExternalId: "ileri",
      status: "confirmed",
      arrivalDate: daysFromNow(40),
      departureDate: daysFromNow(43),
    });

    // İlk kez geliyor → rozet HİÇ çıkmamalı.
    expect(
      await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "ileri", arrivalDate: current.arrivalDate }),
    ).toBeNull();
  });

  it("ileri tarihli rezervasyona bakılırken ÖNCEKİ konaklama sayılır", async () => {
    // Karşı yön: aşırı kısıtlayıp gerçek dönen misafiri kaçırmamalıyız.
    // Ölçüt "şu an" olsaydı bu senaryo da doğru çıkardı; asıl ayrım aşağıda.
    const { propertyId, orgId } = await makeOrgWithProperty();
    await stay(propertyId, {
      guestExternalId: "gercek",
      arrivalDate: daysFromNow(-60),
      departureDate: daysFromNow(-57),
    });
    const upcoming = await stay(propertyId, {
      guestExternalId: "gercek",
      status: "confirmed",
      arrivalDate: daysFromNow(10),
      departureDate: daysFromNow(13),
    });

    const info = await getReturningGuestInfo(orgId, { id: upcoming.id, guestExternalId: "gercek", arrivalDate: upcoming.arrivalDate });
    expect(info!.stayCount).toBe(2);
  });

  it("ölçüt 'şu an' DEĞİL, MEVCUT REZERVASYONUN gelişi", async () => {
    // İkisi de gelecekte: Ağustos ve Ekim. Ekim'e bakarken Ağustos ÖNCEKİDİR
    // → Ekim gerçekten 2. konaklamadır. "arrivalDate < now" ölçütü bunu
    // kaçırırdı; "arrivalDate < mevcut.arrivalDate" doğru cevabı verir.
    const { propertyId, orgId } = await makeOrgWithProperty();
    await stay(propertyId, {
      guestExternalId: "ikisi-gelecek",
      status: "confirmed",
      arrivalDate: daysFromNow(20),
      departureDate: daysFromNow(23),
    });
    const later = await stay(propertyId, {
      guestExternalId: "ikisi-gelecek",
      status: "confirmed",
      arrivalDate: daysFromNow(80),
      departureDate: daysFromNow(83),
    });

    const info = await getReturningGuestInfo(orgId, {
      id: later.id,
      guestExternalId: "ikisi-gelecek",
      arrivalDate: later.arrivalDate,
    });
    expect(info!.stayCount).toBe(2);
  });

  it("sayı ve liste AYNI ölçütü kullanır (sonraki konaklama listeye sızmaz)", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await stay(propertyId, {
      guestExternalId: "karisik",
      arrivalDate: daysFromNow(-30),
      departureDate: daysFromNow(-27),
    });
    const current = await stay(propertyId, {
      guestExternalId: "karisik",
      status: "confirmed",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
    });
    await stay(propertyId, {
      guestExternalId: "karisik",
      status: "confirmed",
      arrivalDate: daysFromNow(90),
      departureDate: daysFromNow(93),
    });

    const info = await getReturningGuestInfo(orgId, { id: current.id, guestExternalId: "karisik", arrivalDate: current.arrivalDate });
    expect(info!.stayCount).toBe(2); // 3 DEĞİL — gelecekteki sayılmaz
    expect(info!.pastStays).toHaveLength(1);
    expect(info!.pastStays[0].arrivalDate.getTime()).toBeLessThan(current.arrivalDate.getTime());
  });
});
