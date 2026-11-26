import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// CODEX 11-17 D2 — OTOMATİK MESAJ SIRASINDA OKUMA SINIRININ ARKASI KALICI AÇ KALMAZ. Gerçek PostgreSQL, kanal taklit.
// Göndericiler bir geçişte en çok 8 sayfa × 25 aday okuyor (doğru bir maliyet kararı) ama okuma HER geçişte en erken adaydan başlıyordu:
// önde 200 gönderilemeyen aday varsa 201. adaya hiçbir geçişte sıra gelmiyordu. İki katman:
//  (1) daire düzeyindeki engel (bu türde metni olmayan daire) SORGUDA elenir — o daireler aday bile değildir;
//  (2) sorguda elenemeyen engeller (silinmiş misafir · kuyruğun sahiplendiği satır · doldurulamayan metin · S8 bekleme) için kalıcı imleç:
//      her geçiş ilk 4 sayfayı yine BAŞTAN okur ("en erken önce"), kalan 4 sayfayı imlecin ardından; sona varınca başa sarar.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: undefined })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendDueWelcomes, sendDueCheckins, sendDueCheckouts, currentHourInTimeZone, __resetLifecycleRateHold } from "@/lib/automation";
import { sendOnChannel } from "@/lib/messaging";
import { reportError } from "@/lib/report-error";
import { tombstoneKeyHash, currentKeyFingerprint } from "@/lib/erasure";
import { buildGuestMessageBody, hasUnfilledPlaceholders } from "@/lib/auto-messages/render";
import { guestFirstNameOf } from "@/lib/kb-placeholders";
import { signatureForChannel } from "@/lib/channels/airbnb-message-policy";
import { lifecycleScanCursorName } from "@/lib/lifecycle-scan-cursor";

const mockSend = vi.mocked(sendOnChannel);
const mockReport = vi.mocked(reportError);
const DAY = 86_400_000;
const SIGNATURE = "Lale";
const WELCOME = "Merhaba {isim}, rezervasyonunuz için teşekkürler.";
const UNFILLED = "Merhaba {isim}, kapı kodu [KOD] olacak.";

/** Şu an yerel saati 09–10 olan sabit kaymalı saat dilimi (çıkış mesajı yalnız 08–11 arası gider; `lifecycle-candidate-paging` emsali). */
function morningZone(): string {
  for (let off = -12; off <= 14; off++) {
    const tz = off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
    const h = currentHourInTimeZone(tz, new Date());
    if (h >= 9 && h <= 10) return tz;
  }
  throw new Error("sabah dilimi bulunamadı");
}

async function seedOrg() {
  const org = await prisma.organization.create({
    data: { name: "Org", timezone: "Europe/Istanbul", aiSignature: SIGNATURE, autoWelcome: true, autoWelcomeEnabledAt: new Date(0), autoCheckin: true, autoCheckinEnabledAt: new Date(0) },
  });
  const mk = (name: string) => prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name } });
  return { orgId: org.id, a: (await mk("Lale 1")).id, b: (await mk("Lale 2")).id, c: (await mk("Lale 3")).id };
}

/** Gelişleri yarından başlayıp `offsetMin + i` dakika artan rezervasyonlar (sıra belirli; sabit takvim tarihi YOK). */
async function seedReservations(propertyId: string, prefix: string, count: number, offsetMin = 0) {
  await prisma.reservation.createMany({
    data: Array.from({ length: count }, (_, i) => {
      const arrival = new Date(Date.now() + DAY + (offsetMin + i) * 60_000);
      return { propertyId, guestName: `Misafir ${prefix}${i}`, arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: `${prefix}-${i}` };
    }),
  });
}

async function erase(orgId: string, refs: string[]) {
  await prisma.erasureTombstone.createMany({
    data: refs.map((ref) => ({
      organizationId: orgId,
      keyType: "source_reference",
      keyHash: tombstoneKeyHash(orgId, "source_reference", ref)!,
      keyFingerprint: currentKeyFingerprint(),
      erasedAt: new Date(),
    })),
  });
}
const refs = (prefix: string, count: number, from = 0) => Array.from({ length: count }, (_, i) => `${prefix}-${from + i}`);
const sentRefs = () => mockSend.mock.calls.map((c) => String((c[0] as { externalReservationId?: string }).externalReservationId));

describe("otomatik mesaj taraması — okuma sınırının arkası kalıcı aç kalmaz (Codex 11-17 D2)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // `mockResolvedValueOnce` kuyruğu `clearAllMocks` ile temizlenmez — tüketilmemiş bir 429 sonraki teste sızmasın.
    mockSend.mockReset();
    mockSend.mockImplementation(async () => ({ ok: true, providerMessageId: undefined }));
    __resetLifecycleRateHold();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 katman 1: metni OLMAYAN dairenin 205 erken rezervasyonu aday bile değildir — arkadaki gönderilebilir rezervasyon İLK geçişte gider", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedReservations(a, "blk", 205);
    await seedAutoMessage(b, "welcome", WELCOME);
    await seedReservations(b, "ok", 1, 1_000);

    const first = await sendDueWelcomes(orgId);
    expect(first.sent).toBe(1); // ⬅️ ESKİDE 0 (ve ikinci geçişte de 0)
    expect(first.considered).toBe(1);
    expect(sentRefs()).toEqual(["ok-0"]);
    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // damgalı — ikinci kez gitmez
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("katman 1: metni BOŞLUKTAN ibaret daire de metinsiz sayılır; metni sonradan yazılan dairenin rezervasyonu sonraki geçişte gider", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", "   \n ");
    await seedReservations(a, "x", 3);
    expect(await sendDueWelcomes(orgId)).toMatchObject({ sent: 0, considered: 0 });
    await prisma.autoMessageTemplate.updateMany({ where: { propertyId: a, kind: "welcome" }, data: { body: WELCOME, revision: { increment: 1 } } });
    expect((await sendDueWelcomes(orgId)).sent).toBe(3);
  });

  it("katman 1: başka TÜRÜN metni sayılmaz — yalnız giriş metni olan dairenin rezervasyonuna karşılama gitmez", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "checkin", "Merhaba {isim}, giriş 15:00'ten itibaren.");
    await seedReservations(a, "x", 2);
    expect(await sendDueWelcomes(orgId)).toMatchObject({ sent: 0, considered: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 katman 2: açıkça SİLİNMİŞ (KVKK) 205 misafirin erken rezervasyonu arkadakini kalıcı bekletmez — ikinci geçişte gider; geçiş başına okuma ≤ 200", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "er", 205);
    await erase(orgId, refs("er", 205));
    await seedReservations(a, "ok", 1, 1_000);

    const first = await sendDueWelcomes(orgId);
    expect(first.sent).toBe(0);
    expect(first.considered).toBe(200); // okuma sınırı aynı (sınırsız tarama yok)
    const second = await sendDueWelcomes(orgId);
    expect(second.sent).toBe(1); // ⬅️ ESKİDE 0 — her geçiş aynı 200 silinmiş adayı okuyordu
    expect(second.considered).toBeLessThanOrEqual(200);
    expect(sentRefs()).toEqual(["ok-0"]); // silinenlere hiçbir şey gitmedi
  });

  it("🚨 katman 2: metni DOLDURULAMAYAN 205 erken rezervasyon da arkadakini kalıcı bekletmez; atlananlar yine sayılır", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "welcome", UNFILLED);
    await seedReservations(a, "un", 205);
    await seedAutoMessage(b, "welcome", WELCOME);
    await seedReservations(b, "ok", 1, 1_000);

    const first = await sendDueWelcomes(orgId);
    expect(first).toMatchObject({ sent: 0, considered: 200, unfilled: 200 });
    const second = await sendDueWelcomes(orgId);
    expect(second.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(sentRefs()).toEqual(["ok-0"]);
  });

  it("🚨 ilk 4 sayfa HER geçişte baştan okunur: imleç dururken öne eklenen gönderilebilir rezervasyon da hemen gider (en erken önce)", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "er", 205, 10);
    await erase(orgId, refs("er", 205));
    await seedReservations(a, "late", 1, 1_000);
    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // imleç 200. adayda
    await seedReservations(a, "early", 1, 0); // hepsinden erken
    const second = await sendDueWelcomes(orgId);
    expect(second.sent).toBe(2);
    expect(sentRefs()).toEqual(["early-0", "late-0"]); // sıra korunur
  });

  it("imleç kaybı (kayıt silindi / bozuldu) hata üretmez: tarama baştan başlar, arkadaki yine birkaç geçişte gider", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "er", 205);
    await erase(orgId, refs("er", 205));
    await seedReservations(a, "ok", 1, 1_000);
    const name = lifecycleScanCursorName("welcome", orgId);

    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    await prisma.systemLock.deleteMany({ where: { name } });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // baştan: yine ilk 200 okundu
    await prisma.systemLock.update({ where: { name }, data: { holder: "{bozuk" } });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // bozuk imleç = baştan
    await prisma.systemLock.update({ where: { name }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // süresi dolmuş imleç = baştan
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
  });

  it("🚨 ÇİFT GÖNDERİM YOK: imleç geriye sarılsa da gönderilmiş rezervasyon yeniden gitmez (gönderildi damgası `welcomeSentAt` + koşullu talep)", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "er", 205);
    await erase(orgId, refs("er", 205));
    await seedReservations(a, "ok", 30, 1_000);
    const perPass: number[] = [];
    for (let i = 0; i < 6; i++) perPass.push((await sendDueWelcomes(orgId)).sent);
    // 1. geçiş: 200 silinmiş okundu · 2.: imleçten sonra 25 · 3.: kalan 5 (imleç incelenen SON adaydadır — incelenmeyenin ötesine geçmez).
    expect(perPass.slice(0, 3)).toEqual([0, 25, 5]);
    expect(new Set(sentRefs())).toEqual(new Set(refs("ok", 30)));
    expect(mockSend).toHaveBeenCalledTimes(30); // her rezervasyona TAM bir kez

    // İmleç en başa sarılır (bayat / yanlış imleç): damgalı satırlar aday değildir.
    const first = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "er-0" } });
    await prisma.systemLock.update({
      where: { name: lifecycleScanCursorName("welcome", orgId) },
      data: { holder: JSON.stringify({ at: new Date(first.arrivalDate.getTime() - DAY).toISOString(), id: "0" }) },
    }).catch(async () => {
      await prisma.systemLock.create({
        data: { name: lifecycleScanCursorName("welcome", orgId), lockedUntil: new Date(Date.now() + DAY), holder: JSON.stringify({ at: new Date(0).toISOString(), id: "0" }) },
      });
    });
    for (let i = 0; i < 3; i++) expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(30);
  });

  it("🚨 429 ile yarıda kalan geçiş imleci İLERLETMEZ: denenmemiş adaylar bir sonraki geçişte sırayla gelir (tur sonunu beklemez)", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "er", 205);
    await erase(orgId, refs("er", 205));
    await seedReservations(a, "ok", 30, 1_000);

    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // imleç 200. adayda
    mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable API hatası (HTTP 429): slow down", kind: "rate_limited" as const, retryAfterSec: 60 } as never);
    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // ilk denemede 429 → tur durdu
    __resetLifecycleRateHold();
    const third = await sendDueWelcomes(orgId);
    expect(third.sent).toBe(25); // ⬅️ imleç ilerleseydi yalnız arkadaki 5 gelirdi
    expect(new Set(sentRefs().slice(1))).toEqual(new Set(refs("ok", 25)));
  });

  it("🚨 tavan SESSİZ KALMAZ: okuma sınırı aşılınca operatöre geçiş tabanlı TEK alarm; birikim sürerken tekrarlanmaz; küme tek geçişe sığınca kapanır", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "er", 300);
    await erase(orgId, refs("er", 300));
    const backlogAlarms = () => mockReport.mock.calls.filter((c) => c[0] === "lifecycle-scan-backlog");

    for (let i = 0; i < 4; i++) await sendDueWelcomes(orgId);
    expect(backlogAlarms()).toHaveLength(1);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "alert-state:lifecycle-scan-backlog:welcome:" } } })).toBe(1);

    // Birikim eridi (silinen misafirlerin rezervasyonları gitti): küme tek geçişe sığar → alarm durumu ve imleç kaydı kapanır.
    await prisma.reservation.deleteMany({ where: { sourceReference: { in: refs("er", 200) } } });
    await sendDueWelcomes(orgId);
    await sendDueWelcomes(orgId);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "alert-state:lifecycle-scan-backlog:" } } })).toBe(0);
    expect(await prisma.systemLock.count({ where: { name: lifecycleScanCursorName("welcome", orgId) } })).toBe(0);
    expect(backlogAlarms()).toHaveLength(1);
  });

  it("KONTROL: tam 200 gönderilemeyen aday — okuma sınırı dolar ama arkada aday yok: tur biter, imleç kaydı ve alarm YOK (sahte birikim yok)", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "er", 200);
    await erase(orgId, refs("er", 200));
    for (let i = 0; i < 3; i++) expect(await sendDueWelcomes(orgId)).toMatchObject({ sent: 0, considered: 200 });
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "lifecycle-scan:" } } })).toBe(0);
    expect(mockReport.mock.calls.filter((c) => c[0] === "lifecycle-scan-backlog")).toHaveLength(0);
  });

  it("KONTROL: sağlıklı işletmede (küme tek geçişe sığar) imleç kaydı YAZILMAZ, alarm yok", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME);
    await seedReservations(a, "ok", 10);
    expect((await sendDueWelcomes(orgId)).sent).toBe(10);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "lifecycle-scan:" } } })).toBe(0);
    expect(mockReport.mock.calls.filter((c) => c[0] === "lifecycle-scan-backlog")).toHaveLength(0);
  });

  it("🚨 katman 1 giriş ve çıkış göndericilerinde de: metni olmayan dairenin 205 adayı arkadakini İLK geçişte engellemez", async () => {
    const { orgId, a, b } = await seedOrg();
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: morningZone(), autoCheckout: true, autoCheckoutEnabledAt: new Date(0) } });
    const at = (prefix: string, propertyId: string, count: number, arrival: (i: number) => Date, departure: (i: number) => Date) =>
      prisma.reservation.createMany({
        data: Array.from({ length: count }, (_, i) => ({ propertyId, guestName: `Misafir ${prefix}${i}`, arrivalDate: arrival(i), departureDate: departure(i), channel: "airbnb", status: "confirmed", sourceReference: `${prefix}-${i}` })),
      });
    // Giriş: hepsi yakın pencerede, metinsizler daha erken.
    await seedAutoMessage(b, "checkin", "Merhaba {isim}, giriş 15:00'ten itibaren; anahtar kutusu kapının sağında.");
    await at("cin", a, 205, (i) => new Date(Date.now() + 30 * 60_000 + i * 1_000), () => new Date(Date.now() + 3 * DAY));
    await at("cinok", b, 1, () => new Date(Date.now() + 30 * 60_000 + 600_000), () => new Date(Date.now() + 3 * DAY));
    expect((await sendDueCheckins(orgId)).sent).toBe(1); // ⬅️ ESKİDE 0
    // Çıkış: bugün çıkanlar, metinsizler daha erken.
    mockSend.mockClear();
    await seedAutoMessage(b, "checkout", "Merhaba {isim}, çıkış saati 11:00; anahtarı kutuya bırakabilirsiniz.");
    await at("cout", a, 205, () => new Date(Date.now() - 2 * DAY), (i) => new Date(Date.now() + i * 100));
    await at("coutok", b, 1, () => new Date(Date.now() - 2 * DAY), () => new Date(Date.now() + 60_000));
    expect((await sendDueCheckouts(orgId)).sent).toBe(1); // ⬅️ ESKİDE 0
    expect(sentRefs()).toEqual(["coutok-0"]);
  });

  it("giriş mesajı göndericisi de aynı imleci KENDİ türüyle kullanır (silinmiş 205 erken rezervasyon arkadakini kalıcı bekletmez)", async () => {
    const { orgId, a } = await seedOrg();
    await seedAutoMessage(a, "checkin", "Merhaba {isim}, giriş 15:00'ten itibaren; anahtar kutusu kapının sağında.");
    const soon = (prefix: string, count: number, baseSec: number) =>
      prisma.reservation.createMany({
        data: Array.from({ length: count }, (_, i) => {
          const arrival = new Date(Date.now() + 30 * 60_000 + (baseSec + i) * 1_000);
          return { propertyId: a, guestName: `Misafir ${prefix}${i}`, arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: `${prefix}-${i}` };
        }),
      });
    await soon("er", 205, 0);
    await erase(orgId, refs("er", 205));
    await soon("ok", 1, 600);
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    expect((await sendDueCheckins(orgId)).sent).toBe(1); // ⬅️ ESKİDE 0
    expect(await prisma.systemLock.count({ where: { name: lifecycleScanCursorName("checkin", orgId) } })).toBe(1); // tür başına ayrı kayıt
    expect(await prisma.systemLock.count({ where: { name: lifecycleScanCursorName("welcome", orgId) } })).toBe(0);
  });

  // ── KÂHİN: seçim kümesi (kime ne gider) BİREBİR aynı; yalnız sıra değişir ──────────────────────────────────────────────────────────────
  /**
   * ESKİ SEÇİM MANTIĞI (okuma sınırı OLMADAN): bir rezervasyona mesaj gider ⟺ dairesinin bu türde boş olmayan metni var · doldurulmuş
   * gövdede doldurulmamış alan yok · misafir açıkça silinmemiş · kuyruk (kapalıyken) o rezervasyonu `failed` dışı bir satırla sahiplenmemiş.
   * (Pencere / durum / taban koşulları fikstürde hep sağlanır.) Saf; göndericinin kullandığı aynı metin kurallarını çağırır.
   */
  function oracleWelcomeSet(
    rows: readonly { sourceReference: string; propertyId: string; guestName: string; channel: string; propertyName: string }[],
    templates: ReadonlyMap<string, string>,
    erased: ReadonlySet<string>,
    owned: ReadonlySet<string>,
  ): Set<string> {
    const out = new Set<string>();
    for (const r of rows) {
      const content = templates.get(r.propertyId);
      if (content === undefined || content.trim() === "") continue;
      const body = buildGuestMessageBody(content, guestFirstNameOf(r.guestName), signatureForChannel(SIGNATURE, r.channel), r.propertyName);
      if (hasUnfilledPlaceholders(body)) continue;
      if (erased.has(r.sourceReference) || owned.has(r.sourceReference)) continue;
      out.add(r.sourceReference);
    }
    return out;
  }

  it("🚨 KÂHİN: karışık engellerle 400 rezervasyon — birkaç geçişin toplamı eski (sınırsız) seçimle AYNI küme; her rezervasyona en çok bir mesaj; geçiş başına ≤ 25 mesaj, ≤ 200 okuma", async () => {
    const { orgId, a, b, c } = await seedOrg();
    // a: metin YOK · b: doldurulamayan metin · c: gönderilebilir metin.
    await seedAutoMessage(b, "welcome", UNFILLED);
    await seedAutoMessage(c, "welcome", WELCOME);
    const propertyFor = (i: number) => (i < 300 ? [a, b, c][i % 3] : i % 4 === 0 ? b : c);
    await prisma.reservation.createMany({
      data: Array.from({ length: 400 }, (_, i) => {
        const arrival = new Date(Date.now() + DAY + i * 60_000);
        return { propertyId: propertyFor(i), guestName: `Misafir r${i}`, arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: i % 7 === 0 ? "booking" : "airbnb", status: "confirmed", sourceReference: `r-${i}` };
      }),
    });
    // İlk 300'ün c'deki satırları: yarısı silinmiş misafir, yarısı kuyruğun sahiplendiği (incelemede bekleyen) satır.
    const cHead = Array.from({ length: 300 }, (_, i) => i).filter((i) => i % 3 === 2);
    const erasedRefs = cHead.filter((_, k) => k % 2 === 0).map((i) => `r-${i}`);
    const ownedRefs = cHead.filter((_, k) => k % 2 === 1).map((i) => `r-${i}`);
    await erase(orgId, erasedRefs);
    await prisma.messageOutbox.createMany({
      data: ownedRefs.map((ref) => ({ organizationId: orgId, channel: "airbnb", externalReservationId: ref, messageType: "welcome", body: "eski", idempotencyKey: `welcome:${orgId}:${ref}`, status: "review" })),
    });

    const rows = await prisma.reservation.findMany({ select: { sourceReference: true, propertyId: true, guestName: true, channel: true, property: { select: { name: true } } } });
    const templates = new Map((await prisma.autoMessageTemplate.findMany({ where: { kind: "welcome" } })).map((t) => [t.propertyId, t.body]));
    const expected = oracleWelcomeSet(
      rows.map((r) => ({ sourceReference: r.sourceReference!, propertyId: r.propertyId, guestName: r.guestName, channel: r.channel, propertyName: r.property.name })),
      templates,
      new Set(erasedRefs),
      new Set(ownedRefs),
    );
    expect(expected.size).toBe(75); // anti-vakum: kâhin boş değil (300..399 arası c'deki satırlar)

    let quiet = 0;
    for (let pass = 0; pass < 20 && quiet < 3; pass++) {
      const out = await sendDueWelcomes(orgId);
      expect(out.sent).toBeLessThanOrEqual(25);
      expect(out.considered).toBeLessThanOrEqual(200);
      quiet = out.sent === 0 ? quiet + 1 : 0;
    }
    const sent = sentRefs();
    expect(new Set(sent)).toEqual(expected); // ⬅️ ESKİDE boş küme (önde 200 gönderilemeyen aday)
    expect(sent).toHaveLength(expected.size); // kopya yok
  });
});
