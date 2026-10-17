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

  // ── 8. CSV DURUM SÜTUNU (eski KAPSAM SINIRI, 08-09 (2)'de kapatıldı) ──────
  //
  // Bu iki test eskiden TERSİNİ pinliyordu ("CSV'de cancelled yazan satır canlı
  // içe aktarılır — bilinen kapsam sınırı") ve o testin kendi yorumu şunu
  // söylüyordu: *"BU TEST KIRMIZIYA DÖNERSE csv.ts'e durum sütunu eklenmiş
  // demektir; rota row.status'ü ayrıştırıcıdan BAĞIMSIZ okur, yani değer o an
  // KENDİLİĞİNDEN doğru onurlandırılır."* Aynen öyle oldu: rotaya TEK SATIR
  // dokunulmadı, yalnız ayrıştırıcı alanı üretmeye başladı.
  //
  // Kapatılan gerçek zarar: Airbnb CSV dışa aktarımı iptalleri de içerir ve
  // onlar `status:"confirmed"` yazılıyordu → doluluk/takvim/panel giriş-çıkış
  // listelerinde CANLI görünüyor, üstelik `createReservationTasks` gelmeyecek
  // misafir için temizlik görevi açıyordu.
  it("parseCsv durum sütununu ÇIKARIR ve RFC token'ına indirger", () => {
    const row = parseCsv("guest_name,arrival,departure,reference,status\nAda,2026-07-10,2026-07-14,R1,cancelled")[0];
    expect(row.status).toBe("CANCELLED");

    // Gerçek dışa aktarım değerleri — TAM eşleşme bunların hiçbirini yakalamazdı.
    const variants = ["Cancelled by guest", "Canceled", "İptal edildi", "iptal"];
    for (const v of variants) {
      const r = parseCsv(`name,arrival,departure,durum\nAda,2026-07-10,2026-07-14,${v}`)[0];
      expect(r.status, v).toBe("CANCELLED");
    }

    // 🚨 TERS YÖN — İPTAL DIŞI HİÇBİR DEĞER EŞLENMEZ. "status" başlıklı sütun her
    // zaman rezervasyon durumu değildir (ödeme durumu da aynı başlığı taşıyor);
    // `pending` eşlenseydi tamamen ödenmiş bir konaklama doluluk tahmininde bir,
    // diğer sekiz yüzeyde başka türlü sayılırdı.
    for (const v of ["confirmed", "pending", "paid", "completed", "past guest", ""]) {
      const r = parseCsv(`name,arrival,departure,status\nAda,2026-07-10,2026-07-14,${v}`)[0];
      expect(r.status, v).toBeUndefined();
    }

    // Kardeş ayrıştırıcıyla AYNI sözlük — rotanın tek kapısı ikisini de okur.
    const ics = parseIcs(calendar(vevent("u1", { cancelled: true })))[0];
    expect(ics.status).toBe("CANCELLED");
  });

  it("🚨 CSV'de 'cancelled' yazan satır CANLI İÇE AKTARILMAZ", async () => {
    const res = await POST(
      csvReq(propertyId, "guest_name,arrival,departure,reference,status\nAda,2026-07-10,2026-07-14,R1,cancelled"),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 0, skipped: 1 });
    // Kardeş `.ics` yolunun sözleşmesiyle birebir: iptal kaydı UYDURULMAZ,
    // yani ortada eşleşecek yerel satır yoksa hiçbir şey yazılmaz.
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("KONTROL: durum sütunu olmayan CSV eskisi gibi canlı içe aktarılır", async () => {
    // Bu olmadan "CSV hiç import etmiyor" mutasyonu da yeşil geçerdi.
    const res = await POST(
      csvReq(propertyId, "guest_name,arrival,departure,reference\nAda,2026-07-10,2026-07-14,R2"),
      { params: Promise.resolve({}) },
    );
    expect(await res.json()).toMatchObject({ imported: 1 });
    expect((await prisma.reservation.findFirstOrThrow({ where: { propertyId } })).status).toBe("confirmed");
  });

  // ⚠️ KAPSAM SINIRI, DÜRÜSTÇE PİNLENİYOR: iptalli bir CSV satırı YALNIZ
  // `.ics` yüklemesinin doğurduğu satırı (`channel:"ics"`) iptal edebilir —
  // KENDİ doğurduğu (`channel:"manual"`) satırı EDEMEZ. Sebep sahiplik
  // belirsizliği: `channel:"manual"` elle GİRİLEN rezervasyonların da değeri,
  // ve WHERE'i genişletmek eski bir dosyanın host'un elle girdiği kaydı
  // sessizce öldürmesine kapı açardı (08-08'de tam bu sınıf iki kez yandı).
  // Zarar yok: satır zaten canlı doğmuyor; eksik olan yalnız GERİYE DÖNÜK iptal.
  it("kapsam sınırı: CSV iptali, CSV'nin kendi (manual) satırını iptal ETMEZ", async () => {
    await POST(csvReq(propertyId, "name,arrival,departure,id\nAda,2026-07-10,2026-07-14,R9"), {
      params: Promise.resolve({}),
    });
    const before = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    expect(before.channel).toBe("manual");

    const res = await POST(
      csvReq(propertyId, "name,arrival,departure,id,status\nAda,2026-07-10,2026-07-14,R9,cancelled"),
      { params: Promise.resolve({}) },
    );
    expect(await res.json()).toMatchObject({ cancelled: 0, skipped: 1 });
    expect((await prisma.reservation.findFirstOrThrow({ where: { id: before.id } })).status).toBe("confirmed");
  });

  // ── CSV BACAGI DA YASAM-DONGUSU KAPISININ DISINDA ──────────────────────────
  // 🚨 Ayni delik bugun iki kez kapatildi — `.ics` yuklemesinde (parser
  // `channel:"ics"` sabitliyor) ve abonelik senkronunda (`calendarSourceId`) —
  // ama CSV bacaginda IKI ISARETCI DE yoktu: rota CSV'deki `channel` hucresini
  // HAM yaziyordu, yani dosyaya `channel: airbnb` yazan bir satir alti kapiyi da
  // geciyor ve `sendOnChannel` CSV referansini Hospitable rezervasyon id'si
  // sanip POST ediyordu.
  it("CSV 'airbnb' dese bile satır Hospitable-mesajlanabilir SAYILMAZ", async () => {
    const csv = ["name,arrival,departure,channel,id", "Deniz Yilmaz,2026-09-01,2026-09-04,airbnb,CSV-REF-1"].join("\n");
    const res = await POST(csvReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    const row = await prisma.reservation.findFirstOrThrow({
      where: { propertyId, sourceReference: "CSV-REF-1" },
      select: { channel: true, calendarSourceId: true },
    });
    // Kanal MEKANIZMAYI anlatir, dosyadaki OTA adini degil.
    expect(row.channel).toBe("manual");
    expect(row.calendarSourceId).toBeNull();

    // ASIL DEGISMEZ: alti yasam-dongusu sorgusunun kullandigi iki kapi birlikte.
    const messageable = await prisma.reservation.count({
      where: {
        propertyId,
        sourceReference: { not: null },
        channel: { notIn: ["ics", "manual"] },
        calendarSourceId: null,
      },
    });
    expect(messageable).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 🚨 CSV BACAĞI DA YAŞAM-DÖNGÜSÜ KAPISININ DIŞINDA KALMALI (denetim 08-08).
//
// Aynı delik bugün iki kez kapatıldı — `.ics` yüklemesinde (parser `channel:"ics"`
// sabitliyor) ve abonelik senkronunda (`calendarSourceId`) — ama CSV bacağında
// İKİ İŞARETÇİ DE yoktu: rota CSV'deki `channel` hücresini ham yazıyordu, yani
// dosyaya `channel: airbnb` yazan bir satır altı kapıyı da geçiyordu.
// ---------------------------------------------------------------------------
