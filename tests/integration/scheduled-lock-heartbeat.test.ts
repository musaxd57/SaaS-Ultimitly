import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KİLİT KALP ATIŞI — UZUN GEÇİŞ KENDİ KİLİDİNİ TAZELER (denetim, 08-01).
//
// Senkron kilidinin TTL'i 15 dakika. Çok daireli bir hesapta 429 geri
// çekilmeleriyle bir geçiş bunu aşabiliyordu; TTL dolunca İKİNCİ bir koşu aynı
// org için eşzamanlı başlıyor ve tüm duplicate korumasının dayandığı "aynı org
// iki kez koşmaz" varsayımı deliniyordu.
//
// ⚠️ KALP ATIŞI İLERLEME-TETİKLİ, `setInterval` DEĞİL. Zamanlayıcıyla atılan bir
// kalp atışı AĞDA ASILI KALMIŞ bir koşuyu da "canlı" gösterir ve kilidi sonsuza
// kadar tutar — senkron komple, üstelik SESSİZCE durur. Org döngüsünün her
// turunda çağrıldığı için yenileme ancak GERÇEK ilerleme varken olur.
//
// ⚠️ AYRI DOSYA: `vi.mock` dosya geneline hoist edilir. `syncHospitable`'ı burada
// mock'luyoruz ki kilidin durumunu KOŞU SÜRERKEN okuyabilelim — bu, kardeş
// `scheduled-lock.test.ts`'in kurulumuyla çakışırdı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-sync", () => ({ syncHospitable: vi.fn() }));
vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
  HospitableError: class HospitableError extends Error {},
}));

import { syncHospitable } from "@/lib/hospitable-sync";
import { runScheduledSync } from "@/lib/scheduled-sync";

const mockSync = vi.mocked(syncHospitable);

/** `SyncResult` şeklinde boş sonuç (alan eklenirse burası da güncellenir). */
const ZERO = {
  properties: 0,
  reservations: 0,
  conversations: 0,
  messages: 0,
  threads: 0,
  skipped: 0,
  propertiesCapped: 0,
  reservationsUnwritable: 0,
};

async function orgWithProperty(name: string) {
  const o = await prisma.organization.create({ data: { name } });
  await prisma.property.create({ data: { organizationId: o.id, name: `P-${name}` } });
  return o.id;
}

describe("senkron kilidi — ilerleme-tetikli kalp atışı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("TTL koşu ortasında dolsa bile kilit TAZELENİR", async () => {
    await orgWithProperty("A");
    await orgWithProperty("B");

    // Her org turunun BAŞINDA kilidin son geçerlilik anını kaydet, sonra TTL'i
    // geçmişe çek (uzun süren bir org turunun simülasyonu).
    const seen: number[] = [];
    mockSync.mockImplementation(async () => {
      const row = await prisma.systemLock.findUniqueOrThrow({ where: { name: "scheduled-sync" } });
      seen.push(row.lockedUntil.getTime());
      await prisma.systemLock.update({
        where: { name: "scheduled-sync" },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      return ZERO as never;
    });

    await runScheduledSync();

    expect(seen).toHaveLength(2);
    // İkinci org turuna girerken kilit YENİLENMİŞ olmalı: ilk turun sonunda
    // geçmişe çekmiştik. ⬅️ KALP ATIŞI YOKSA burası geçmişte kalır.
    expect(seen[1]).toBeGreaterThan(Date.now());
  });

  it("FENCING: devralınmış kilidi eski koşu yenileyemez", async () => {
    await orgWithProperty("A");
    await orgWithProperty("B");

    // İlk org turunda kilidi BAŞKA bir holder'a devret. İkinci turda `renewLock`
    // koşar ama WHERE'deki `holder` eşleşmediği için hiçbir şey değiştirmemeli.
    const takenOverUntil = new Date(Date.now() + 60_000);
    let first = true;
    mockSync.mockImplementation(async () => {
      if (first) {
        first = false;
        await prisma.systemLock.update({
          where: { name: "scheduled-sync" },
          data: { holder: "other-run", lockedUntil: takenOverUntil },
        });
      }
      return ZERO as never;
    });

    await runScheduledSync();

    const row = await prisma.systemLock.findUniqueOrThrow({ where: { name: "scheduled-sync" } });
    expect(row.holder).toBe("other-run");
    // +15 dk'ya ÇEKİLMEDİ: yabancı kilide dokunulmadı.
    expect(row.lockedUntil.getTime()).toBeLessThan(Date.now() + 5 * 60_000);
  });

  // -------------------------------------------------------------------------
  // KİLİT KAYBI SESSİZ GEÇMEZ (denetim, 08-01 — üçüncü tur).
  //
  // `renewLock` bir `updateMany` idi ve `count`'u HİÇ OKUNMUYORDU. `count === 0`
  // "kilit artık BİZDE DEĞİL" demektir (TTL geçmiş, başka replika devralmış) —
  // yani tam olarak kilidin engellemek için var olduğu durum. Eski kod bunu
  // görmeden kalan org'ları işlemeye DEVAM ediyordu: iki koşu aynı org'lara
  // paralel yazar, `findFirst-then-create` dedupe'u delinir.
  // -------------------------------------------------------------------------
  it("KİLİT KAYBEDİLİRSE geçiş KESİLİR (kalan org'lar işlenmez)", async () => {
    await orgWithProperty("A");
    await orgWithProperty("B");
    await orgWithProperty("C");

    // İlk org turunda kilit devralınır → 2. turun başındaki yenileme başarısız.
    let first = true;
    mockSync.mockImplementation(async () => {
      if (first) {
        first = false;
        await prisma.systemLock.update({
          where: { name: "scheduled-sync" },
          data: { holder: "other-run", lockedUntil: new Date(Date.now() + 60_000) },
        });
      }
      return ZERO as never;
    });

    const totals = await runScheduledSync();

    // ⬅️ ARIZADA 3 olurdu: kilit kaybedilmiş olmasına rağmen hepsi işlenirdi.
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(totals.lockLost).toBe(true);
  });

  it("KİLİT BİZDEYKEN geçiş SONUNA KADAR gider (yanlış-pozitif pini)", async () => {
    await orgWithProperty("A");
    await orgWithProperty("B");
    await orgWithProperty("C");
    mockSync.mockResolvedValue(ZERO as never);

    const totals = await runScheduledSync();

    expect(mockSync).toHaveBeenCalledTimes(3);
    expect(totals.lockLost).toBeUndefined();
  });
});
