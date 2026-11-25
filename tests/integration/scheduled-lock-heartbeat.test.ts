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

// K27-K3: işletme İÇİNDEKİ aşamalarda kilidin durumu okunur. Her aşama girişte kilidin son geçerlilik anını kaydeder; istenirse çıkışta
// TTL'i geçmişe çeker (o aşama uzun sürdü) ya da kilidi başka bir koşuya devreder. Gerçek aşamalar bu dosyanın ölçtüğü şeyle ilgisiz.
const stage = vi.hoisted(() => ({
  seen: [] as { name: string; lockedUntil: number }[],
  expireAfter: false,
  takeoverAfter: null as string | null,
}));
const observe = vi.hoisted(() => async (name: string) => {
  const { prisma: db } = await import("@/lib/db");
  const row = await db.systemLock.findUnique({ where: { name: "scheduled-sync" } });
  stage.seen.push({ name, lockedUntil: row?.lockedUntil.getTime() ?? 0 });
});
const leave = vi.hoisted(() => async (name: string) => {
  const { prisma: db } = await import("@/lib/db");
  if (stage.takeoverAfter === name) {
    await db.systemLock.update({
      where: { name: "scheduled-sync" },
      data: { holder: "other-run", lockedUntil: new Date(Date.now() + 60_000) },
    });
  } else if (stage.expireAfter) {
    await db.systemLock.update({ where: { name: "scheduled-sync" }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  }
});
vi.mock("@/lib/automation", async (orig) => {
  const actual = await orig<typeof import("@/lib/automation")>();
  return {
    ...actual,
    sendDueAlerts: vi.fn(async () => {
      await observe("alerts");
      await leave("alerts");
      return { alerted: 0 } as never;
    }),
    runDueChannelAutoReplies: vi.fn(async () => {
      await observe("automation");
      await leave("automation");
      return { sent: 0 } as never;
    }),
  };
});
vi.mock("@/lib/import/sync", async (orig) => {
  const actual = await orig<typeof import("@/lib/import/sync")>();
  return {
    ...actual,
    syncDueCalendarSourcesForOrg: vi.fn(async () => {
      await observe("ical");
      await leave("ical");
      return { synced: 0, imported: 0, updated: 0, failed: 0, deferred: 0 } as never;
    }),
  };
});
vi.mock("@/modules/intelligence", async (orig) => {
  const actual = await orig<typeof import("@/modules/intelligence")>();
  return {
    ...actual,
    runIntelligencePass: vi.fn(async () => {
      await observe("intelligence");
      await leave("intelligence");
      return {} as never;
    }),
  };
});

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
    stage.seen = [];
    stage.expireAfter = false;
    stage.takeoverAfter = null;
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

  // -------------------------------------------------------------------------
  // 🚨 KENDİ AÇTIĞIM REGRESYON — DB HIÇKIRIĞI KİLİT KAYBI DEĞİLDİR.
  // (Denetim 08-01, üçüncü tur; ajan yakaladı.)
  //
  // `renewLock`'un ilk hâli `.catch(() => false)` yapıyordu: geçici BİR DB hatası
  // "kilidi kaybettik" sayılıp geçişi İLK org'da kesiyordu. Yenileme döngünün ilk
  // turunda, kilit alındıktan saniyeler sonra koştuğu için hata kalıcıysa HİÇBİR
  // org hiç işlenmiyor, TÜM kiracıların mesaj içe aktarımı + oto-yanıtı duruyor,
  // üstüne saatte 30 alarm üretiliyordu. Kilit kaybı TTL'in (15 dk) GERÇEKTEN
  // dolmasını gerektirir; bir hıçkırık bunu ima etmez.
  // -------------------------------------------------------------------------
  it("YENİLEME HATA VERİRSE geçiş DURMAZ (hıçkırık ≠ kayıp)", async () => {
    await orgWithProperty("A");
    await orgWithProperty("B");
    await orgWithProperty("C");
    mockSync.mockResolvedValue(ZERO as never);

    // `holder` içeren ilk `updateMany` = ilk `renewLock` (org #2'nin başında).
    const real = prisma.systemLock.updateMany.bind(prisma.systemLock);
    let thrown = false;
    vi.spyOn(prisma.systemLock, "updateMany").mockImplementation((async (args: {
      where?: { holder?: string };
    }) => {
      if (!thrown && args?.where?.holder) {
        thrown = true;
        throw new Error("transient DB hiccup");
      }
      return real(args as never);
    }) as never);

    const totals = await runScheduledSync();

    expect(thrown).toBe(true); // hıçkırık gerçekten koştu
    expect(mockSync).toHaveBeenCalledTimes(3); // ⬅️ ARIZADA 1 olurdu
    expect(totals.lockLost).toBeUndefined(); // yanlış alarm da yok
  });

  // -------------------------------------------------------------------------
  // K27-K3 (Codex 11-25): kilit yalnız işletmeler ARASINDA yenileniyordu. Tek işletmenin aşamaları toplamı 15 dk'yı aşınca ikinci koşu
  // kilidi alıp aynı işletmeye paralel yazabiliyordu; TEK işletmeli kurulumda (org #0) hiç yenileme yoktu.
  // -------------------------------------------------------------------------
  it("🚨 K27-K3: TEK işletme — her aşama uzun sürüp TTL'i doldursa da kilit SONRAKİ aşamadan önce yenilenir", async () => {
    await orgWithProperty("A");
    stage.expireAfter = true;
    mockSync.mockImplementation(async () => {
      // Uzun süren senkron: TTL doldu (kimse almadı).
      await prisma.systemLock.update({ where: { name: "scheduled-sync" }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      return ZERO as never;
    });

    const totals = await runScheduledSync();

    expect(stage.seen.map((x) => x.name), "dört aşama da koştu").toEqual(["alerts", "automation", "ical", "intelligence"]);
    // ⬅️ ESKİ KODDA hepsi geçmişte kalır: org #0'ın içinde hiç yenileme yoktu.
    for (const x of stage.seen) expect(x.lockedUntil, `${x.name} aşamasına süresi dolmuş kilitle girildi`).toBeGreaterThan(Date.now());
    expect(totals.lockLost).toBeUndefined();
  });

  it("🚨 K27-K3: TEK işletme — senkron aşamasında kilit DEVRALINIRSA kalan aşamalar koşmaz, kilit kaybı görünür", async () => {
    await orgWithProperty("A");
    mockSync.mockImplementation(async () => {
      await prisma.systemLock.update({
        where: { name: "scheduled-sync" },
        data: { holder: "other-run", lockedUntil: new Date(Date.now() + 60_000) },
      });
      return ZERO as never;
    });

    const totals = await runScheduledSync();

    // ⬅️ ESKİ KODDA lockLost undefined ve bütün aşamalar koşardı (iki koşu aynı işletmede).
    expect(totals.lockLost).toBe(true);
    expect(stage.seen, "kilit kaybından sonra işletmenin kalan aşaması koştu").toEqual([]);
    // Devralan koşunun kilidine dokunulmadı.
    expect((await prisma.systemLock.findUniqueOrThrow({ where: { name: "scheduled-sync" } })).holder).toBe("other-run");
  });

  it("K27-K3: otomasyon aşamasında devralınırsa takvim ve zekâ aşamaları koşmaz", async () => {
    await orgWithProperty("A");
    mockSync.mockResolvedValue(ZERO as never);
    stage.takeoverAfter = "automation";
    const totals = await runScheduledSync();
    expect(stage.seen.map((x) => x.name)).toEqual(["alerts", "automation"]);
    expect(totals.lockLost).toBe(true);
  });

  it("K27-K3: son aşamada (zekâ) devralınırsa döngü sonrası yenileme kaybı GÖRÜR (alarm)", async () => {
    await orgWithProperty("A");
    mockSync.mockResolvedValue(ZERO as never);
    stage.takeoverAfter = "intelligence";
    const totals = await runScheduledSync();
    expect(stage.seen.map((x) => x.name)).toEqual(["alerts", "automation", "ical", "intelligence"]);
    // ⬅️ Döngü sonrası yenileme olmasa tek işletmede kayıp hiç görülmezdi.
    expect(totals.lockLost).toBe(true);
  });

  it("KİLİT BİZDEYKEN geçiş SONUNA KADAR gider (yanlış-pozitif pini)", async () => {
    await orgWithProperty("A");
    await orgWithProperty("B");
    await orgWithProperty("C");
    mockSync.mockResolvedValue(ZERO as never);

    const totals = await runScheduledSync();

    expect(mockSync).toHaveBeenCalledTimes(3);
    expect(stage.seen.filter((x) => x.name === "intelligence"), "kilit bizdeyken hiçbir aşama atlanmaz").toHaveLength(3);
    expect(totals.lockLost).toBeUndefined();
  });
});
