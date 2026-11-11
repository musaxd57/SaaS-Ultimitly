import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// TAKVİM / SENKRON — Codex 11-10 bulguları (C1–C5). Gerçek PostgreSQL; besleme isteği taklit.
//  C1  200 karakterden uzun kimlik KESİLİYORDU → ilk 200 karakteri aynı iki farklı kimlik tek rezervasyonda birleşiyordu.
//  C2  Beslemeyi daha önce indirmiş yavaş koşu, daha yeni koşunun yazdığı iptali rezervasyonu yeniden onaylayarak geri açıyordu.
//  C3  Senkron satırı okuduktan sonra saklama süpürgesi satırı anonimleştirirse ad / not beslemeden GERİ yazılıyordu.
//  C4  İlk dışa aktarım bağlantısı: iki sekme iki ayrı anahtar üretiyor, sonuncusu kazanıyordu.
//  C5  Okunamayan CSV saatlik aktarım hakkını tüketiyordu.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { syncCalendarSource, feedRunOrderLockName, __syncRowHooks } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { normalizeSourceReference, legacyTruncatedSourceReference } from "@/lib/import/source-ref";
import { ensurePropertyCalendarToken } from "@/lib/export/calendar-token";
import { POST as importPost } from "@/app/api/reservations/import/route";
import { DELETE as deleteSource } from "@/app/api/calendar-sources/[id]/route";
import { __resetRateLimit } from "@/lib/rate-limit";
import { ANON_NAME } from "@/lib/anon-sentinels";
import { tombstoneKeyHash, currentKeyFingerprint } from "@/lib/erasure";

const mockFeed = vi.mocked(fetchFeedText);
const DAY = 86_400_000;
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
/** Yalnız-tarih etkinliğinin saklanan değeri: takvim ayrıştırıcısının ÖĞLE çapası (12:00Z) — beslemeden yazılan satırlarla aynı. */
const dateOnly = (d: number) => new Date(`${new Date(Date.now() + d * DAY).toISOString().slice(0, 10)}T12:00:00.000Z`);
const ev = (uid: string, from = 10, to = 12, extra: string[] = [], summary = "Ahmet Yilmaz") =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${ymd(from)}`, `DTEND;VALUE=DATE:${ymd(to)}`, `SUMMARY:${summary}`, ...extra, "END:VEVENT"].join("\n");
const cal = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events.join("\n")}\nEND:VCALENDAR`;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const source = await prisma.calendarSource.create({ data: { propertyId, label: "Outlook", url: "https://example.com/cal.ics" } });
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  return { orgId, propertyId, sourceId: source.id };
}
const rowsOf = (propertyId: string) => prisma.reservation.findMany({ where: { propertyId }, orderBy: { arrivalDate: "asc" } });

describe("takvim / senkron — Codex 11-10", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    __syncRowHooks.afterExistingRead = null;
    __syncRowHooks.beforeRows = null;
  });
  afterEach(() => {
    __syncRowHooks.afterExistingRead = null;
    __syncRowHooks.beforeRows = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("C1 — uzun kimlik kesilmez, özetlenir", () => {
    const PREFIX = "040000008200E00074C5B7101A82E008" + "0".repeat(190); // 222 karakter ortak önek
    const UID_A = `${PREFIX}-A`;
    const UID_B = `${PREFIX}-B`;

    it("🚨 ilk 200 karakteri aynı iki farklı kimlik İKİ ayrı rezervasyon olur (tek satırda birleşmez)", async () => {
      const { propertyId, sourceId } = await seed();
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 12, [], "Misafir A"), ev(UID_B, 20, 22, [], "Misafir B")));
      const res = await syncCalendarSource(sourceId);
      const rows = await rowsOf(propertyId);
      expect(rows).toHaveLength(2); // ⬅️ ESKİDE 1 (ikinci etkinlik "aynı kimlik" diye atlanıyordu)
      expect(res.imported).toBe(2);
      expect(rows.map((r) => r.guestName)).toEqual(["Misafir A", "Misafir B"]);
      expect(new Set(rows.map((r) => r.sourceReference)).size).toBe(2);
      for (const r of rows) expect(r.sourceReference!.length).toBeLessThanOrEqual(200);
      // İkinci geçiş: hiçbir şey çoğalmaz, tarihler birbirini ezmez.
      await syncCalendarSource(sourceId);
      const again = await rowsOf(propertyId);
      expect(again.map((r) => [r.id, r.arrivalDate.getTime()])).toEqual(rows.map((r) => [r.id, r.arrivalDate.getTime()]));
      expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } })).lastStatus).toBe("ok");
    });

    it("eski (kesilmiş) kimlikle saklanan satır, tek bir uzun kimlik ona düşüyorsa YENİ kimliğe çevrilir — aynı satır yaşar, kopya açılmaz", async () => {
      const { propertyId, sourceId } = await seed();
      const legacyRow = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Misafir A", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: sourceId,
          arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "other",
        },
      });
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 13, [], "Misafir A"))); // tarih de değişti
      await syncCalendarSource(sourceId);
      const rows = await rowsOf(propertyId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(legacyRow.id);
      expect(rows[0].sourceReference).toBe(normalizeSourceReference(UID_A));
      expect(rows[0].departureDate.getTime()).toBe(dateOnly(13).getTime()); // güncelleme eski satıra uygulandı
    });

    it("iki uzun kimlik aynı eski kimliğe düşüyorsa eski satır TARİHİ birebir uyan adaya verilir; öteki kendi satırını açar", async () => {
      const { propertyId, sourceId } = await seed();
      const legacyRow = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Karışmış", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: sourceId,
          arrivalDate: dateOnly(20), departureDate: dateOnly(22), status: "confirmed", channel: "other",
        },
      });
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 12, [], "Misafir A"), ev(UID_B, 20, 22, [], "Misafir B")));
      await syncCalendarSource(sourceId);
      const rows = await rowsOf(propertyId);
      expect(rows).toHaveLength(2);
      const b = rows.find((r) => r.sourceReference === normalizeSourceReference(UID_B))!;
      expect(b.id).toBe(legacyRow.id); // tarihleri uyan B eski satırı aldı
      expect(rows.find((r) => r.sourceReference === normalizeSourceReference(UID_A))!.id).not.toBe(legacyRow.id);
    });

    it("iki aday da eski satırın tarihine uymuyorsa satıra DOKUNULMAZ (tahminle birleştirme yok); yeni kimlikler kendi satırlarını açar", async () => {
      const { propertyId, sourceId } = await seed();
      const legacyRow = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Karışmış", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: sourceId,
          arrivalDate: dateOnly(30), departureDate: dateOnly(32), status: "confirmed", channel: "other",
        },
      });
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 12), ev(UID_B, 20, 22)));
      await syncCalendarSource(sourceId);
      const rows = await rowsOf(propertyId);
      expect(rows).toHaveLength(3);
      const kept = rows.find((r) => r.id === legacyRow.id)!;
      expect(kept.sourceReference).toBe(legacyTruncatedSourceReference(UID_A));
      expect(kept.arrivalDate.getTime()).toBe(dateOnly(30).getTime());
    });

    it("yeni kimlik bu dairede ZATEN varsa eski satıra dokunulmaz ve senkron düşmez (kimlik dairede tekildir — çakışan çeviri denenmez)", async () => {
      const { propertyId, sourceId } = await seed();
      // Önceki bir geçişte yeni kimlikle satır açılmış, eski (kesilmiş) kimlikli satır da duruyor.
      const legacyRow = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Eski Satır", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: sourceId,
          arrivalDate: dateOnly(30), departureDate: dateOnly(32), status: "confirmed", channel: "other",
        },
      });
      const current = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Misafir A", sourceReference: normalizeSourceReference(UID_A)!, calendarSourceId: sourceId,
          arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "other",
        },
      });
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 13, [], "Misafir A")));
      const res = await syncCalendarSource(sourceId);
      expect(res.errors).toEqual([]); // ⬅️ korumasız: tekillik hatası işlemi bozar, senkron düşer
      expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } })).lastStatus).toBe("ok");
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: legacyRow.id } })).sourceReference).toBe(legacyTruncatedSourceReference(UID_A));
      const updated = await prisma.reservation.findUniqueOrThrow({ where: { id: current.id } });
      expect(updated.departureDate.getTime()).toBe(dateOnly(13).getTime()); // güncelleme yeni kimlikli satıra uygulandı
      expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    });

    it("🚨 eski kimlikli silme (KVKK) kaydı koşu SÜRERKEN yazılırsa da satır yazımı onu görür: konaklama yeni kimlikle içe ALINMAZ", async () => {
      const { orgId, propertyId, sourceId } = await seed();
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 12, [], "Silinen Misafir"), ev("kisa-2@example.com", 20, 22, [], "Jane Doe")));
      // Koşu başındaki kontrol silme kaydı görmedi; satırlar yazılmadan hemen önce (çevrilemeyen eski satır silinince) eski kimlikle kayıt düştü.
      __syncRowHooks.beforeRows = async () => {
        await prisma.erasureTombstone.create({
          data: {
            organizationId: orgId,
            keyType: "source_reference",
            keyHash: tombstoneKeyHash(orgId, "source_reference", legacyTruncatedSourceReference(UID_A)!)!,
            keyFingerprint: currentKeyFingerprint(),
            erasedAt: new Date(),
          },
        });
      };
      await syncCalendarSource(sourceId);
      const rows = await rowsOf(propertyId);
      expect(rows.map((r) => r.guestName)).toEqual(["Jane Doe"]); // ⬅️ (ilk sürümde) "Silinen Misafir" yeni kimlikle yazılırdı
    });

    it("🚨 silme (KVKK) kaydı ESKİ kimlikle tutulan konaklama yeni kimlikle de yeniden içe ALINMAZ", async () => {
      const { orgId, propertyId, sourceId } = await seed();
      await prisma.erasureTombstone.create({
        data: {
          organizationId: orgId,
          keyType: "source_reference",
          keyHash: tombstoneKeyHash(orgId, "source_reference", legacyTruncatedSourceReference(UID_A)!)!,
          keyFingerprint: currentKeyFingerprint(),
          erasedAt: new Date(),
        },
      });
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 12, [], "Silinen Misafir"), ev("kisa-1@example.com", 20, 22, [], "Jane Doe")));
      const res = await syncCalendarSource(sourceId);
      const rows = await rowsOf(propertyId);
      expect(rows.map((r) => r.guestName)).toEqual(["Jane Doe"]);
      expect(res.skipped).toBeGreaterThanOrEqual(1);
    });

    it("dosyadan içe aktarma da aynı kimlik kuralını kullanır: iki uzun kimlik iki rezervasyon; eski satır önizlemede 'var' görünür, aktarımda yeni kimliğe çevrilir", async () => {
      const { propertyId } = await seed();
      const post = (ics: string, preview = false) => {
        const form = new FormData();
        form.set("file", new File([ics], "takvim.ics", { type: "text/calendar" }));
        form.set("propertyId", propertyId);
        if (preview) form.set("mode", "preview");
        return importPost(new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }), { params: Promise.resolve({}) });
      };
      expect((await post(cal(ev(UID_A, 10, 12, [], "Misafir A"), ev(UID_B, 20, 22, [], "Misafir B")).replace(/\n/g, "\r\n"))).status).toBe(200);
      expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2); // ⬅️ ESKİDE 1

      // Eski biçimli satır: önizleme yazmaz ama satırı "var" görür; aktarım aynı satırı günceller.
      await prisma.reservation.deleteMany({ where: { propertyId } });
      const legacyRow = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Misafir A", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: null,
          arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "ics",
        },
      });
      const one = cal(ev(UID_A, 10, 12, [], "Misafir A")).replace(/\n/g, "\r\n");
      expect((await post(one, true)).status).toBe(200);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: legacyRow.id } })).sourceReference).toBe(legacyTruncatedSourceReference(UID_A)); // önizleme yazmadı
      expect((await post(one)).status).toBe(200);
      const rows = await rowsOf(propertyId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(legacyRow.id);
      expect(rows[0].sourceReference).toBe(normalizeSourceReference(UID_A));
    });

    it("🚨 CSV: uzun referanslı satır daha önce (eski, kesilmiş kimlikle) yüklendiyse aynı dosyanın yeniden yüklenmesi KOPYA açmaz", async () => {
      const { propertyId } = await seed();
      const ref = "REF-" + "9".repeat(230); // 234 karakter
      const start = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 12 * DAY).toISOString().slice(0, 10);
      // 11-11 öncesi CSV aktarımının yazdığı satır: bağlantısız, kanal "manual", kimlik 200'e kesilmiş.
      const old = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Ayşe", sourceReference: legacyTruncatedSourceReference(ref)!, calendarSourceId: null,
          arrivalDate: new Date(`${start}T12:00:00.000Z`), departureDate: new Date(`${end}T12:00:00.000Z`), status: "confirmed", channel: "manual",
        },
      });
      const csv = `reference,Status,Guest name,Start date,End date\n${ref},Confirmed,Ayşe,${start},${end}\n`;
      const post = (preview: boolean) => {
        const form = new FormData();
        form.set("file", new File([csv], "rezervasyonlar.csv", { type: "text/csv" }));
        form.set("propertyId", propertyId);
        if (preview) form.set("mode", "preview");
        return importPost(new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }), { params: Promise.resolve({}) });
      };
      expect((await post(true)).status).toBe(200); // önizleme yazmaz
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: old.id } })).sourceReference).toBe(legacyTruncatedSourceReference(ref));
      expect((await post(false)).status).toBe(200);
      const rows = await rowsOf(propertyId);
      expect(rows).toHaveLength(1); // ⬅️ (ilk sürümde) 2 — eski satır tanınmıyor, ikinci rezervasyon açılıyordu
      expect(rows[0].id).toBe(old.id);
      expect(rows[0].sourceReference).toBe(normalizeSourceReference(ref));
    });

    it("🚨 abonelik: aynı besleme önce DOSYA olarak yüklenmişse (bağlantısız, eski kimlikli satır) senkron o satırı sahiplenir — kopya açmaz", async () => {
      const { propertyId, sourceId } = await seed();
      const unbound = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Misafir A", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: null,
          arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "ics",
        },
      });
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 12, [], "Misafir A")));
      await syncCalendarSource(sourceId);
      const rows = await rowsOf(propertyId);
      expect(rows).toHaveLength(1); // ⬅️ (ilk sürümde) 2
      expect(rows[0].id).toBe(unbound.id);
      expect(rows[0].sourceReference).toBe(normalizeSourceReference(UID_A));
      expect(rows[0].calendarSourceId).toBe(sourceId); // senkron satırı sahiplendi (eski sahiplenme kuralı aynen)
    });

    it("KONTROL: çeviri DAİRE kapsamındadır — başka dairedeki aynı eski kimlikli bağlantısız satıra dokunulmaz; bu kaynağın bağlı satırı çevrilir", async () => {
      const { propertyId, sourceId } = await seed();
      const other = await prisma.property.create({ data: { organizationId: (await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).organizationId, name: "Lale 9" } });
      const bound = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Bağlı", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: sourceId,
          arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "other",
        },
      });
      // Başka dairede aynı eski kimlikli bağlantısız satır: daire kapsamı dışında, dokunulmaz.
      const elsewhere = await prisma.reservation.create({
        data: {
          propertyId: other.id, guestName: "Başka Daire", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: null,
          arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "ics",
        },
      });
      mockFeed.mockResolvedValue(cal(ev(UID_A, 10, 12, [], "Misafir A")));
      await syncCalendarSource(sourceId);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: bound.id } })).sourceReference).toBe(normalizeSourceReference(UID_A));
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: elsewhere.id } })).sourceReference).toBe(legacyTruncatedSourceReference(UID_A));
    });

    it("🚨 dosya yolu yalnız KENDİ satırının eski kimliğini çevirir: başka kaynağın (kanal) aynı eski kimlikli satırına dokunmaz", async () => {
      const { propertyId } = await seed();
      // Bu rotanın satırı DEĞİL: bağlantısız ama kanalı "ics" olmayan (ör. kanal sağlayıcısından gelmiş) satır.
      const foreign = await prisma.reservation.create({
        data: {
          propertyId, guestName: "Kanal Misafiri", sourceReference: legacyTruncatedSourceReference(UID_A)!, calendarSourceId: null,
          arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "airbnb",
        },
      });
      const form = new FormData();
      form.set("file", new File([cal(ev(UID_A, 10, 12, [], "Misafir A")).replace(/\n/g, "\r\n")], "takvim.ics", { type: "text/calendar" }));
      form.set("propertyId", propertyId);
      const res = await importPost(new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const after = await prisma.reservation.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(after.sourceReference).toBe(legacyTruncatedSourceReference(UID_A)); // kimliği çevrilmedi
      expect(after.guestName).toBe("Kanal Misafiri"); // içeriğine dokunulmadı
    });
  });

  describe("C2 — eski takvim yanıtı yeni sonucu ezmez", () => {
    it("🚨 beslemeyi ÖNCE indirmeye başlayan yavaş koşu, sonradan başlayıp biten koşunun iptalini geri AÇMAZ", async () => {
      const { propertyId, sourceId } = await seed();
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12)));
      await syncCalendarSource(sourceId);
      const [row] = await rowsOf(propertyId);
      expect(row.status).toBe("confirmed");

      // Yavaş koşu (R1) beslemeyi istedi; yanıtı (rezervasyon CANLI) gecikti.
      let releaseSlow!: (text: string) => void;
      mockFeed.mockImplementationOnce(() => new Promise<string>((r) => (releaseSlow = r)));
      const slow = syncCalendarSource(sourceId);
      await vi.waitFor(() => expect(releaseSlow).toBeTypeOf("function"));
      await new Promise((r) => setTimeout(r, 5)); // R2'nin başlangıç anı R1'inkinden kesin SONRA olsun
      // Daha yeni koşu (R2): besleme artık İPTAL diyor; R2 tamamlanır.
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12, ["STATUS:CANCELLED"])));
      await syncCalendarSource(sourceId);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("cancelled");
      const statusAfterNewer = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId }, select: { lastResult: true, lastSyncedAt: true } });

      // Şimdi R1'in ESKİ yanıtı geldi (rezervasyon canlı görünüyor).
      releaseSlow(cal(ev("rez-1", 10, 12)));
      const stale = await slow;
      const after = await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe("cancelled"); // ⬅️ ESKİDE "confirmed" (iptal geri açılıyordu)
      expect(stale.updated).toBe(0);
      // Eski koşu kaynağın durum satırını da ezmedi.
      expect(await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId }, select: { lastResult: true, lastSyncedAt: true } })).toEqual(statusAfterNewer);
    });

    it("KONTROL: sıralı iki koşu (çakışma yok) eskisi gibi çalışır — iptal, ardından yeniden canlı görünen rezervasyon yeniden onaylanır", async () => {
      const { propertyId, sourceId } = await seed();
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12)));
      await syncCalendarSource(sourceId);
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12, ["STATUS:CANCELLED"])));
      await syncCalendarSource(sourceId);
      expect((await rowsOf(propertyId))[0].status).toBe("cancelled");
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12)));
      await syncCalendarSource(sourceId);
      expect((await rowsOf(propertyId))[0].status).toBe("confirmed");
      expect(await prisma.systemLock.count({ where: { name: feedRunOrderLockName(sourceId) } })).toBe(1);
    });

    it("kaynak silinince koşu sırası damgası da silinir", async () => {
      const { sourceId } = await seed();
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12)));
      await syncCalendarSource(sourceId);
      expect(await prisma.systemLock.count({ where: { name: feedRunOrderLockName(sourceId) } })).toBe(1);
      const res = await deleteSource(new NextRequest(`http://localhost/api/calendar-sources/${sourceId}`, { method: "DELETE" }), { params: Promise.resolve({ id: sourceId }) });
      expect(res.status).toBe(200);
      expect(await prisma.systemLock.count({ where: { name: feedRunOrderLockName(sourceId) } })).toBe(0);
    });
  });

  describe("C3 — anonimleştirilen satıra ad / not geri yazılmaz", () => {
    it("🚨 senkron satırı okuduktan SONRA saklama süpürgesi anonimleştirdi → ad ve not beslemeden GERİ YAZILMAZ; tarihler eşitlenir", async () => {
      const { propertyId, sourceId } = await seed();
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12, ["DESCRIPTION:Telefon 0532 000 00 00"], "Ahmet Yilmaz")));
      await syncCalendarSource(sourceId);
      const [row] = await rowsOf(propertyId);
      expect(row.guestName).toBe("Ahmet Yilmaz");

      // Besleme tarihi değiştirdi (yazım gerekecek); satır okunduktan hemen sonra süpürge satırı anonimleştiriyor.
      let hookRan = false;
      __syncRowHooks.afterExistingRead = async () => {
        hookRan = true;
        __syncRowHooks.afterExistingRead = null;
        await prisma.reservation.update({ where: { id: row.id }, data: { guestName: ANON_NAME, notes: null } });
      };
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 13, ["DESCRIPTION:Telefon 0532 000 00 00"], "Ahmet Yilmaz")));
      await syncCalendarSource(sourceId);
      expect(hookRan).toBe(true);
      const after = await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.guestName).toBe(ANON_NAME); // ⬅️ ESKİDE "Ahmet Yilmaz" (ad geri geliyordu)
      expect(after.notes).toBeNull(); // ⬅️ ESKİDE telefonlu not geri geliyordu
      expect(after.departureDate.getTime()).toBe(dateOnly(13).getTime()); // kişisel veri olmayan alan eşitlendi
    });

    it("KONTROL: anonimleştirilmemiş satırda ad / not değişikliği eskisi gibi yazılır", async () => {
      const { propertyId, sourceId } = await seed();
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12, [], "Ahmet Yilmaz")));
      await syncCalendarSource(sourceId);
      mockFeed.mockResolvedValueOnce(cal(ev("rez-1", 10, 12, ["DESCRIPTION:Geç giriş"], "Ahmet Y.")));
      await syncCalendarSource(sourceId);
      const [after] = await rowsOf(propertyId);
      expect([after.guestName, after.notes]).toEqual(["Ahmet Y.", "Geç giriş"]);
    });
  });

  describe("C4 — ilk dışa aktarım bağlantısı", () => {
    it("🚨 aynı anda iki çağrı AYNI anahtarı döndürür ve saklanan anahtar odur (sonuncu kazanmaz)", async () => {
      const { propertyId } = await seed();
      await prisma.property.update({ where: { id: propertyId }, data: { icalToken: null } });
      const [a, b] = await Promise.all([ensurePropertyCalendarToken(propertyId), ensurePropertyCalendarToken(propertyId)]);
      expect(a).toBeTruthy();
      expect(a).toBe(b); // ⬅️ ESKİDE iki sekme iki ayrı anahtar gösteriyordu
      expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).icalToken).toBe(a);
      // Var olan anahtar değiştirilmez.
      expect(await ensurePropertyCalendarToken(propertyId)).toBe(a);
    });
  });

  describe("C5 — okunamayan CSV aktarım hakkını yemez", () => {
    it("🚨 altı kez bozuk CSV → hepsi doğrulama hatası (400), saatlik sınır (429) DEVREYE GİRMEZ; ardından düzgün dosya aktarılır", async () => {
      const { propertyId } = await seed();
      const post = (csv: string) => {
        const form = new FormData();
        form.set("file", new File([csv], "rezervasyonlar.csv", { type: "text/csv" }));
        form.set("propertyId", propertyId);
        return importPost(new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }), { params: Promise.resolve({}) });
      };
      const broken = 'reference,Status,Guest name,Start date,End date\nr-1,Confirmed,"Ayşe,15.11.2026,17.11.2026\n'; // kapanmayan tırnak
      for (let i = 0; i < 6; i++) {
        expect((await post(broken)).status, `deneme ${i + 1}`).toBe(400); // ⬅️ ESKİDE altıncı deneme 429
      }
      const good = `reference,Status,Guest name,Start date,End date\nr-1,Confirmed,Ayşe,${new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10)},${new Date(Date.now() + 12 * DAY).toISOString().slice(0, 10)}\n`;
      expect((await post(good)).status).toBe(200);
      expect(await prisma.reservation.count({ where: { propertyId } })).toBe(1);
    });

    it("iade SINIRSIZ değildir: saatte 20 ücretsiz retten sonra bozuk dosya yine hakkı tüketir (5 deneme) ve sınır devreye girer", async () => {
      const { propertyId } = await seed();
      const post = (csv: string) => {
        const form = new FormData();
        form.set("file", new File([csv], "rezervasyonlar.csv", { type: "text/csv" }));
        form.set("propertyId", propertyId);
        return importPost(new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }), { params: Promise.resolve({}) });
      };
      const broken = 'reference,Status,Guest name,Start date,End date\nr-1,Confirmed,"Ayşe,15.11.2026,17.11.2026\n';
      for (let i = 0; i < 25; i++) expect((await post(broken)).status, `deneme ${i + 1}`).toBe(400); // 20 iade + 5 hak
      expect((await post(broken)).status).toBe(429); // sınırsız ayrıştırma denemesi yok
    });
  });
});
