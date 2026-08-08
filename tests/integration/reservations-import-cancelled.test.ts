import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
// Feed HTTP layer is unit-tested elsewhere (pinned-fetch.test.ts); mocked here so
// the PARITY test can push the exact same ICS text through the subscription engine.
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

// ── YARIŞ TOHUMU (deterministik) ─────────────────────────────────────────────
// Rota silme kapısını İKİ kez okuyor: ucuz ÖN TARAMA (istek başında, bir kez) ve
// yazma-TX'inin İÇİNDEKİ TAZE okuma (advisory kilit altında). İkisi birbirini
// maskelediği için "ucuz kapıyı kaldır" ya da "taze kapıyı kaldır" mutasyonları
// TEK BAŞINA davranışı değiştirmiyor — yani ikisi de gerçekten sınanmadan yeşil
// kalabiliyordu (ölçüldü). Bu tohum tam olarak o boşluğu kapatıyor: ÖN TARAMAYA
// boş bir guard verdirip taze okumayı gerçek bırakıyoruz, yani "tombstone ön
// taramadan SONRA yazıldı" yarışını birebir kuruyor. Böylece TAZE okumanın
// YETKİLİ olduğu iddiası bir yorum olmaktan çıkıp pinlenmiş bir olguya dönüyor.
let erasureLoads = 0;
let hideTombstonesFromPreScan = false;
let preScanWasHidden = false;
vi.mock("@/lib/erasure", async (orig) => {
  const actual = await orig<typeof import("@/lib/erasure")>();
  return {
    ...actual,
    loadErasureGuard: async (...args: Parameters<typeof actual.loadErasureGuard>) => {
      erasureLoads++;
      // ⚠️ Sayaç, ölçülecek İSTEĞİN hemen öncesinde SIFIRLANIR — ilk yazımımda
      // sıfırlama `beforeEach`teydi ve kurulum POST'u sayacı çoktan 2'ye
      // çıkardığı için `=== 1` koşulu HİÇ tetiklenmiyordu: ön tarama gerçek
      // guard'ı görüp satırı zaten blokluyordu ve test, TX-içi kapı SİLİNSE DE
      // yeşil kalıyordu (mutasyonla yakalandı). `preScanWasHidden` bu yüzden var:
      // senaryonun kurulduğunu VARSAYMAK yerine ASSERTE ediyoruz.
      if (hideTombstonesFromPreScan && erasureLoads === 1) {
        preScanWasHidden = true;
        return { isEmpty: true, blocksSourceReference: () => false, blocksGuestStay: () => false, messageCutoffFor: () => null };
      }
      return actual.loadErasureGuard(...args);
    },
  };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/reservations/import/route";
import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { eraseReservationData, __resetErasureHashKey } from "@/lib/erasure";
import { parseCsv } from "@/lib/import/csv";
import { parseIcs } from "@/lib/import/ics";

// ---------------------------------------------------------------------------
// STATUS:CANCELLED — ELLE YÜKLEME İLE ABONELİK SENKRONU ARASINDAKİ AYRIŞMA
//
// 🚨 BULUNAN AÇIK (denetim 08-08): elle `.ics` yüklemesi VEVENT'in
// `STATUS:CANCELLED` alanını OKUYUP ATIYORDU. `parseIcs` alanı ÇIKARIYOR
// (`IcsReservation.status`) ama rota `status: "confirmed"` yazan sabit bir
// nesne kuruyordu — üstelik `ParsedRow` tipinde `status` alanı hiç YOKTU, yani
// TypeScript de sessizdi (fazlalık-alan kontrolü nesne LİTERALİNE uygulanır,
// dizi ATAMASINA değil → `parseIcs(text)` sorunsuz atanıyordu).
//
// Sonuç: AYNI DOSYA nereden girdiğine göre İKİ FARKLI sonuç üretiyordu —
// abonelik senkronu (`sync.ts:227`) iptali yansıtıp otomatik görevleri
// siliyor, elle yükleme ise iptal edilmiş konaklamayı CANLI kaydediyordu.
// Host'a maliyeti: daire DOLU görünür (takvim + doluluk), temizlik/giriş
// görevleri açılır ve `channel:"ics"` olmasa yaşam-döngüsü mesajı bile
// tetiklenebilirdi.
//
// ⚠️ TASARIM SINIRI (bilinçli): elle yükleme yalnız POZİTİF KANITA uyar —
// dosyada AÇIKÇA `STATUS:CANCELLED` yazan satırı iptal eder. Bir satırın
// canlı GÖRÜNMESİ (yani iptal işareti taşımaması) tek başına iptal edilmiş bir
// kaydı GERİ AÇMAZ; bu, aboneliğin "yeniden onayla" dalının (`sync.ts:264`)
// bilerek dışarıda bırakılan yüzüdür — sürekli yoklanan bir feed AKTÜEL,
// elle yüklenen bir dosya ise ESKİ olabilir. Yanlışlıkla iptal edilen kayıt
// üründen geri açılabilir (`PATCH /api/reservations/[id]` → status).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const icsDay = (offset: number) =>
  new Date(Date.now() + offset * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const ARRIVE = icsDay(5);
const DEPART = icsDay(9);

function vevent(uid: string, opts?: { cancelled?: boolean; summary?: string }) {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${ARRIVE}`,
    `DTEND;VALUE=DATE:${DEPART}`,
    `SUMMARY:${opts?.summary ?? "Ahmet Yilmaz"}`,
    ...(opts?.cancelled ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
  ].join("\r\n");
}
const calendar = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");

function icsReq(propertyId: string, ics: string) {
  const form = new FormData();
  form.set("file", new File([ics], "takvim.ics", { type: "text/calendar" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}
function csvReq(propertyId: string, csv: string) {
  const form = new FormData();
  form.set("file", new File([csv], "rez.csv", { type: "text/csv" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}

describe("POST /api/reservations/import — STATUS:CANCELLED", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetErasureHashKey();
    erasureLoads = 0;
    hideTombstonesFromPreScan = false;
    preScanWasHidden = false;
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── 1. ANA HATA: iptal edilmiş VEVENT CANLI kayıt olarak yazılıyordu ──────
  it("🚨 iptal edilmiş bir VEVENT hiç YAZILMAZ (eskiden 'confirmed' olarak içe aktarılıyordu)", async () => {
    const res = await POST(icsReq(propertyId, calendar(vevent("iptal-1@airbnb.com", { cancelled: true }))), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 0, skipped: 1 });
    // Asıl iddia: ortada CANLI bir konaklama YOK. (Eskiden burada
    // status:"confirmed" bir satır vardı → daire dolu görünüyordu.)
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
    // Ve iptal edilmiş bir kayıt UYDURULMAZ da: abonelik yolu da yerel satır
    // yoksa `{kind:"skip"}` diyor, iptal satırı YARATMIYOR (sync.ts:238).
    expect(await prisma.reservation.count({ where: { propertyId, status: "cancelled" } })).toBe(0);
    // Yan etki de olmamalı: iptal edilmiş konaklamaya temizlik görevi açılmaz.
    expect(await prisma.task.count({ where: { property: { organizationId: orgId } } })).toBe(0);
  });

  // ── 2. TERS YÖN: kapı "her satırı iptal say"a dönüşürse KIRMIZI ───────────
  it("TERS YÖN: iptal işareti OLMAYAN satır normal içe aktarılır (koşulsuz iptal = kırmızı)", async () => {
    const res = await POST(icsReq(propertyId, calendar(vevent("canli-1@airbnb.com"))), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, skipped: 0 });
    const rows = await prisma.reservation.findMany({ where: { propertyId }, select: { status: true, channel: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("confirmed");
    // Kanal DEĞİŞMEDİ: `"ics"` yaşam-döngüsü gönderimlerinin dışarıda bıraktığı
    // değerdir (`channel: { notIn: ["ics","manual"] }`) — bu turda kimse onu
    // "düzeltmesin" diye burada da pinli (denetim 08-07 (6)).
    expect(rows[0].channel).toBe("ics");
  });

  // ── 3. KARIŞIK DOSYA: iptal satırı elenir, canlı satır geçer ──────────────
  it("AYNI dosyada iptal + canlı: yalnız canlı olan yazılır", async () => {
    const ics = calendar(
      vevent("iptal-2@airbnb.com", { cancelled: true, summary: "Iptal Eden" }),
      vevent("canli-2@airbnb.com", { summary: "Gelen Misafir" }),
    );
    const res = await POST(icsReq(propertyId, ics), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, skipped: 1 });
    const rows = await prisma.reservation.findMany({ where: { propertyId }, select: { guestName: true } });
    expect(rows.map((r) => r.guestName)).toEqual(["Gelen Misafir"]);
  });

  // ── 4. GÜNCELLEME YOLU: var olan satır iptale çevrilir + oto görevler gider ─
  it("var olan satır + yeniden yüklenen dosya CANCELLED diyor → satır iptal edilir, oto görevler silinir", async () => {
    // İlk yükleme: canlı → satır + yaşam-döngüsü görevleri.
    await POST(icsReq(propertyId, calendar(vevent("degisen@airbnb.com"))), { params: Promise.resolve({}) });
    const before = await prisma.reservation.findFirstOrThrow({
      where: { propertyId, sourceReference: "degisen@airbnb.com" },
      select: { id: true, status: true },
    });
    expect(before.status).toBe("confirmed");
    const autoTasksBefore = await prisma.task.count({
      where: { reservationId: before.id, origin: "system", type: { in: ["checkin_prep", "cleaning"] } },
    });
    expect(autoTasksBefore, "ön koşul: oto görevler gerçekten yaratılmış olmalı").toBeGreaterThan(0);

    // İkinci yükleme: aynı UID, artık CANCELLED.
    const res = await POST(icsReq(propertyId, calendar(vevent("degisen@airbnb.com", { cancelled: true }))), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 0, cancelled: 1 });

    const after = await prisma.reservation.findFirstOrThrow({ where: { id: before.id }, select: { status: true } });
    expect(after.status).toBe("cancelled");
    // Abonelik yolunun ikinci yarısı: `removeAutoTasksForCancelledReservation`.
    expect(
      await prisma.task.count({
        where: { reservationId: before.id, origin: "system", type: { in: ["checkin_prep", "cleaning"] } },
      }),
    ).toBe(0);
  });

  it("ZATEN iptal edilmiş satır tekrar iptal edilmez (idempotent, sayaç şişmez)", async () => {
    await POST(icsReq(propertyId, calendar(vevent("cift@airbnb.com"))), { params: Promise.resolve({}) });
    await POST(icsReq(propertyId, calendar(vevent("cift@airbnb.com", { cancelled: true }))), {
      params: Promise.resolve({}),
    });
    const res = await POST(icsReq(propertyId, calendar(vevent("cift@airbnb.com", { cancelled: true }))), {
      params: Promise.resolve({}),
    });
    expect(await res.json()).toMatchObject({ imported: 0, cancelled: 0, skipped: 1 });
  });

  // ── 5. SAHİPLİK: başka bir KAYNAĞIN satırına dokunulmaz ───────────────────
  it("🔒 abonelik KAYNAĞINA bağlı satır elle yüklemeyle iptal EDİLMEZ (kaynak-sahipliği kuralı)", async () => {
    // Deponun kuralı (`sync.ts:207-209` + CLAUDE.md): "STATUS:CANCELLED yalnız
    // KENDİ source satırını iptal eder". Elle yükleme o kaynak DEĞİLDİR; feed'in
    // kendi satırını yine feed'in kendi geçişi iptal eder. Aksi hâlde eski bir
    // elle dosya, canlı bir aboneliğin satırını devirebilirdi.
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent("paylasilan@airbnb.com")));
    await syncCalendarSource(source.id);
    const owned = await prisma.reservation.findFirstOrThrow({
      where: { propertyId, sourceReference: "paylasilan@airbnb.com" },
      select: { id: true, calendarSourceId: true, status: true },
    });
    expect(owned.calendarSourceId).toBe(source.id);

    const res = await POST(icsReq(propertyId, calendar(vevent("paylasilan@airbnb.com", { cancelled: true }))), {
      params: Promise.resolve({}),
    });
    expect(await res.json()).toMatchObject({ cancelled: 0, skipped: 1 });
    expect((await prisma.reservation.findFirstOrThrow({ where: { id: owned.id } })).status).toBe("confirmed");
  });

  // ── 5b. HOSPITABLE SATIRI ELLE YÜKLEMEYLE İPTAL EDİLEMEZ ──────────────────
  // 🚨 Denetim 08-08: sahiplik kuralı KARDEŞ YOLUN TERSİYDİ. Abonelik senkronu
  // CANCELLED bir olayın SAHİPSİZ satıra dokunmasına hiç izin vermiyor; bu rota
  // ise SADECE sahipsiz satırları iptal ediyordu — ve o küme Hospitable'dan
  // gelen ve elle girilen rezervasyonları DA kapsıyor. UID'si bir Hospitable
  // `sourceReference`'ıyla çakışan bayat bir .ics (Hospitable'ın kendisi de iCal
  // yayımlayabilir) CANLI rezervasyonu iptale çevirip görevlerini silebilirdi.
  it("Hospitable kanalındaki CANLI rezervasyon elle .ics yüklemesiyle İPTAL EDİLEMEZ", async () => {
    // Hospitable'dan gelmiş gibi: kaynağa bağlı DEĞİL (calendarSourceId null)
    // ama kanalı "airbnb" — yani bu rotanın yazdığı satır değil.
    const live = await prisma.reservation.create({
      data: {
        propertyId,
        sourceReference: "cakisan-uid@airbnb.com",
        channel: "airbnb",
        calendarSourceId: null,
        status: "confirmed",
        guestName: "Gerçek Misafir",
        arrivalDate: new Date("2026-09-01T00:00:00Z"),
        departureDate: new Date("2026-09-04T00:00:00Z"),
      },
    });

    const res = await POST(
      icsReq(propertyId, calendar(vevent("cakisan-uid@airbnb.com", { cancelled: true }))),
      { params: Promise.resolve({}) },
    );

    expect(await res.json()).toMatchObject({ cancelled: 0, skipped: 1 });
    expect((await prisma.reservation.findFirstOrThrow({ where: { id: live.id } })).status).toBe("confirmed");
  });

  // ── 6. PARİTE: AYNI METİN iki yoldan da AYNI sonucu vermeli ───────────────
  it("PARİTE: aynı .ics metni elle yükleme ve abonelik senkronunda AYNI sonucu verir", async () => {
    const text = calendar(vevent("parite@airbnb.com", { cancelled: true }));

    // (a) abonelik yolu — ayrı bir mülkte
    const other = await prisma.property.create({
      data: { organizationId: orgId, name: "Abonelik Mülkü", checkInTime: "15:00", checkOutTime: "11:00" },
    });
    const source = await prisma.calendarSource.create({
      data: { propertyId: other.id, label: "Airbnb", url: "https://example.com/parite.ics" },
    });
    vi.mocked(fetchFeedText).mockResolvedValue(text);
    await syncCalendarSource(source.id);

    // (b) elle yükleme yolu
    await POST(icsReq(propertyId, text), { params: Promise.resolve({}) });

    const viaSync = await prisma.reservation.findMany({ where: { propertyId: other.id }, select: { status: true } });
    const viaUpload = await prisma.reservation.findMany({ where: { propertyId }, select: { status: true } });
    // İkisi de "canlı konaklama yaratma" demiyor. Bu testin bulduğu ayrışma
    // tam olarak buydu: viaSync=[] iken viaUpload=[{status:"confirmed"}].
    expect(viaUpload).toEqual(viaSync);
  });

  // ── 7. KVKK: iptal yazımı da silme kapısının AYNI TARAFINDA ───────────────
  it("KVKK: tombstone'lu referansın CANCELLED satırı da yazma YAPMAZ (kapı iptal dalını da kapsar)", async () => {
    // Canlı satırı yarat, sonra silme talebiyle sil (satır DURUYOR, maskeli).
    await POST(icsReq(propertyId, calendar(vevent("silinen@airbnb.com"))), { params: Promise.resolve({}) });
    const row = await prisma.reservation.findFirstOrThrow({
      where: { propertyId, sourceReference: "silinen@airbnb.com" },
      select: { id: true },
    });
    await eraseReservationData(orgId, row.id);
    expect(await prisma.erasureTombstone.count({ where: { organizationId: orgId } })).toBeGreaterThan(0);
    const statusAfterErase = (await prisma.reservation.findFirstOrThrow({ where: { id: row.id } })).status;

    const res = await POST(icsReq(propertyId, calendar(vevent("silinen@airbnb.com", { cancelled: true }))), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cancelled: 0, skipped: 1 });
    // Kapı iptal dalından ÖNCE koşuyor → satıra HİÇ dokunulmadı.
    expect((await prisma.reservation.findFirstOrThrow({ where: { id: row.id } })).status).toBe(statusAfterErase);
  });

  it("KVKK/YARIŞ: tombstone ÖN TARAMADAN SONRA yazılsa da iptal yazımı olmaz (yetkili olan TX-içi taze okuma)", async () => {
    // Kardeş yol da guard'ı yazma-TX'inin İÇİNDE, advisory kilit altında TAZE
    // okur ve ucuz taramayı yalnız optimizasyon sayar (`import/sync.ts`). Burada
    // ön tarama KÖR bırakılıyor → satırı yalnız TX-içi okuma kurtarabilir.
    await POST(icsReq(propertyId, calendar(vevent("yaris@airbnb.com"))), { params: Promise.resolve({}) });
    const row = await prisma.reservation.findFirstOrThrow({
      where: { propertyId, sourceReference: "yaris@airbnb.com" },
      select: { id: true },
    });
    await eraseReservationData(orgId, row.id);
    const statusAfterErase = (await prisma.reservation.findFirstOrThrow({ where: { id: row.id } })).status;

    // Sayaç ÖLÇÜLECEK isteğin hemen önünde sıfırlanır (kurulum POST'u onu çoktan
    // ilerletmişti — ilk yazımımda bu satır yoktu ve test vacuous çıktı).
    erasureLoads = 0;
    hideTombstonesFromPreScan = true;
    const res = await POST(icsReq(propertyId, calendar(vevent("yaris@airbnb.com", { cancelled: true }))), {
      params: Promise.resolve({}),
    });

    // ÖN KOŞULLAR — senaryonun GERÇEKTEN kurulduğunu ve kapıya ULAŞTIĞINI
    // asserte eder; ikisi olmadan test, korumayı hiç sınamadan yeşil kalır.
    expect(preScanWasHidden, "ön tarama körlenmedi → yarış senaryosu hiç kurulmadı").toBe(true);
    expect(erasureLoads, "TX-içi taze okuma koşmadı → satır kapıya varmamış").toBeGreaterThanOrEqual(2);
    expect(await res.json()).toMatchObject({ cancelled: 0, skipped: 1 });
    expect((await prisma.reservation.findFirstOrThrow({ where: { id: row.id } })).status).toBe(statusAfterErase);
  });

  // ── 8. KAPSAM SINIRI: CSV'de durum sütunu YOK (tripwire) ──────────────────
  it("KAPSAM SINIRI: parseCsv durum sütunu ÇIKARMIYOR → CSV satırı canlı içe aktarılır", () => {
    // 🚨 BU TEST KIRMIZIYA DÖNERSE: `csv.ts`'e bir durum/status sütunu eklenmiş
    // demektir. YAPILACAK ŞEY: bu testi SİL — rota `row.status`'ü ayrıştırıcıdan
    // BAĞIMSIZ okuyor (tek `isCancelledRow` kapısı), yani CSV'den gelen bir
    // "cancelled" değeri o an KENDİLİĞİNDEN doğru şekilde onurlandırılır.
    // Bugünkü durum dürüstçe: Airbnb CSV dışa aktarımındaki "Status" sütunu
    // ayrıştırıcıda karşılığı olmadığı için SESSİZCE düşüyor.
    const row = parseCsv("guest_name,arrival,departure,reference,status\nAda,2026-07-10,2026-07-14,R1,cancelled")[0];
    expect(Object.keys(row)).not.toContain("status");

    // Kardeş ayrıştırıcı ise ÇIKARIYOR — rota bu alana dayanıyor.
    const ics = parseIcs(calendar(vevent("u1", { cancelled: true })))[0];
    expect(ics.status).toBe("CANCELLED");
  });

  it("CSV'de 'cancelled' yazan satır (bugün) canlı içe aktarılır — bilinen kapsam sınırı", async () => {
    const res = await POST(
      csvReq(propertyId, "guest_name,arrival,departure,reference,status\nAda,2026-07-10,2026-07-14,R1,cancelled"),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1 });
  });
});
