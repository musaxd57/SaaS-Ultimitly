import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/reservations/import/route";
import { eraseReservationData, __resetErasureHashKey } from "@/lib/erasure";
import { parseCsv } from "@/lib/import/csv";
import { parseIcs } from "@/lib/import/ics";

// Codex #25 — the CSV import must FAIL CLOSED on a structurally broken file
// (import nothing, return a clear 400) while still doing a partial import that
// skips only semantically bad rows.

function importReq(propertyId: string, csv: string) {
  const form = new FormData();
  form.set("file", new File([csv], "rez.csv", { type: "text/csv" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}

describe("POST /api/reservations/import — CSV fail-closed", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("OOM guard: an over-cap body is rejected by Content-Length (413) BEFORE req.formData() buffers it", async () => {
    // >6 MB (5 MB file cap + 1 MB envelope). A 413 proves the header pre-check fired
    // FIRST; if it hadn't, formData() would buffer the whole thing and the later
    // file.size check would 400 — so asserting 413 specifically pins the OOM guard.
    const big = new NextRequest("http://localhost/api/reservations/import", {
      method: "POST",
      headers: { "content-length": String(7 * 1024 * 1024) }, // > 6 MB cap
    });
    const res = await POST(big, { params: Promise.resolve({}) });
    expect(res.status).toBe(413);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("a structurally broken CSV (column mismatch) → 400, imports NOTHING", async () => {
    const csv = "guest_name,arrival,departure\nAda,2026-07-10,2026-07-14,EXTRA";
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("an unbalanced-quote CSV → 400, imports NOTHING", async () => {
    const csv = 'guest_name,arrival,departure\n"Ada,2026-07-10,2026-07-14';
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("VALIDATE-THEN-IMPORT: first rows valid but the LAST row is broken → 400, ZERO written", async () => {
    // The whole file is tokenized+validated before any DB write, so a corrupt
    // final row rolls back the entire import (no partial persist).
    const csv =
      "guest_name,arrival,departure\n" +
      "Ada,2026-07-10,2026-07-14\n" + // valid
      "Bora,2026-08-01,2026-08-03\n" + // valid
      "Cem,2026-09-01,2026-09-04,EXTRA"; // structural break on the last line
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0); // nothing written
  });

  it("a well-formed CSV imports rows and skips only the semantically bad one", async () => {
    const csv =
      "guest_name,arrival,departure\n" +
      "Ada,2026-07-10,2026-07-14\n" +
      "Bora,31/02/2026,2026-08-03\n" + // invalid calendar date → skipped
      "Cem,2026-09-01,2026-09-04";
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const names = (await prisma.reservation.findMany({ where: { propertyId }, select: { guestName: true } })).map(
      (r) => r.guestName,
    );
    expect(names.sort()).toEqual(["Ada", "Cem"]);
  });
});

// ---------------------------------------------------------------------------
// KVKK ERASURE INGRESS — ELLE YÜKLEME ÜÇÜNCÜ GİRİŞ YOLU (denetim, 08-06)
//
// 🚨 BULUNAN AÇIK: `erasure.ts`'in başlık yorumu "every tombstone-scoped ingress
// writer" diyor ve İKİ yol sayıyordu (hospitable-sync + iCal feed sync). Elle
// `.ics`/`.csv` yüklemesi listede yoktu ve rotada `loadErasureGuard` HİÇ
// geçmiyordu (grep: 0) → misafir m.11 silme talebi yapıp host rezervasyonu
// sildikten sonra, aynı dosyayı TEKRAR yüklemek silinmiş konaklamayı misafirin
// GERÇEK adıyla geri getiriyordu. Yönetmelik m.8 "tekrar kullanılamaz" ihlali.
//
// Testler GERÇEK tombstone üretiyor (`eraseReservationData`), sahte satır değil —
// hash/fingerprint zincirinin tamamı koşuyor.
// ---------------------------------------------------------------------------
describe("POST /api/reservations/import — KVKK silme kapısı", () => {
  let orgId: string;
  let propertyId: string;

  const ERASED_REF = "REF-SILINDI-1";
  const GUEST = "Ada Lovelace";

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetErasureHashKey();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });

  /** Bir konaklamayı silme talebiyle sil, sonra YEREL SATIRI TAMAMEN KALDIR.
   *  Satır silinmesi senaryonun ta kendisi: satır dururken zaten dedupe kapısı
   *  (aynı sourceReference) yeni kaydı engelliyor — yani satır silinmeden test,
   *  tombstone kapısını DEĞİL dedupe'u ölçerdi. Tombstone org'a bağlı, satıra
   *  değil (şema: `ErasureTombstone.organizationId`), bu yüzden silmeye rağmen
   *  yaşar — koruma tam olarak bunun için var. */
  async function eraseAndDropRow(sourceReference: string) {
    const r = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: GUEST,
        guestEmail: "ada@example.com",
        sourceReference,
        arrivalDate: new Date("2026-07-10"),
        departureDate: new Date("2026-07-14"),
        status: "completed",
        channel: "airbnb",
      },
    });
    await eraseReservationData(orgId, r.id);
    await prisma.reservation.delete({ where: { id: r.id } });
    return r.id;
  }

  it("silinmiş bir konaklamanın referansı TEKRAR YÜKLENSE de geri gelmez", async () => {
    await eraseAndDropRow(ERASED_REF);
    expect(await prisma.erasureTombstone.count({ where: { organizationId: orgId } })).toBeGreaterThan(0);

    const csv = `guest_name,arrival,departure,reference\n${GUEST},2026-07-10,2026-07-14,${ERASED_REF}`;
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 0, skipped: 1 });
    // Asıl iddia: misafirin gerçek adı hiçbir satırda yok.
    expect(await prisma.reservation.count({ where: { propertyId, guestName: GUEST } })).toBe(0);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("TERS YÖN: silinmemiş referanslar AYNI dosyada normal içe aktarılır", async () => {
    // Kapı "her şeyi blokla"ya dönüşürse bu kırmızı olur — koruma DAR olmalı.
    await eraseAndDropRow(ERASED_REF);

    const csv =
      "guest_name,arrival,departure,reference\n" +
      `${GUEST},2026-07-10,2026-07-14,${ERASED_REF}\n` + // bloklanmalı
      "Bora Yilmaz,2026-08-01,2026-08-03,REF-TEMIZ-2"; // geçmeli

    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, skipped: 1 });

    const rows = await prisma.reservation.findMany({ where: { propertyId }, select: { guestName: true } });
    expect(rows.map((r) => r.guestName)).toEqual(["Bora Yilmaz"]);
  });

  it("TOMBSTONE YOKKEN davranış birebir eski hâli (kapı ölçülebilir maliyet getirmez)", async () => {
    // Bugünkü üretim durumu: `GUEST_ERASURE_ENABLED` KAPALI → hiç tombstone yok.
    // Bu test kapının o durumda GÖRÜNMEZ olduğunu pinler.
    const csv = `guest_name,arrival,departure,reference\n${GUEST},2026-07-10,2026-07-14,${ERASED_REF}`;
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, skipped: 0 });
  });

  it("KAPSAM SINIRI: ayrıştırıcılar KİŞİ anahtarı üretmiyor → blocksGuestStay bilerek çağrılmıyor", () => {
    // `TombstoneKeyInput` kişi anahtarları: guest_external_id / guest_email /
    // guest_phone. İKİ ayrıştırıcı da bunların hiçbirini çıkarmıyor, yani
    // `blocksGuestStay` bugün ÇAĞRILSA ölü kod olurdu (sıfır anahtar → asla
    // bloklamaz) ve referanssız düz bir CSV korunamıyor.
    //
    // 🚨 BU TEST KIRMIZIYA DÖNERSE: ayrıştırıcıya e-posta/telefon/sağlayıcı-id
    // eklenmiş demektir → rotadaki kapıya `blocksGuestStay(...)` ÇAĞRISINI EKLE
    // ve `erasure.ts` başlığındaki "KAPSAM SINIRI" notunu güncelle.
    // ⚠️ `Object.keys` ile bakılıyor, alan okumasıyla DEĞİL: alanı `as Record<…>`
    // ile okumak TypeScript'i de susturur ve gerçek soruyu (satırda böyle bir
    // alan VAR mı) kaçırırdı — tsc bu cast'i zaten reddetti, doğru sinyaldi.
    const PERSON_KEYS = ["guestEmail", "guestPhone", "guestExternalId", "email", "phone"];

    const row = parseCsv(
      "guest_name,arrival,departure,reference,email,phone\n" +
        "Ada,2026-07-10,2026-07-14,R1,ada@example.com,+905551234567",
    )[0];
    expect(row.sourceReference).toBe("R1"); // referans ÇIKARILIYOR (kapı buna dayanıyor)
    expect(
      Object.keys(row).filter((k) => PERSON_KEYS.includes(k)),
      "parseCsv artık kişi anahtarı üretiyor — rotadaki kapıya blocksGuestStay ekle",
    ).toEqual([]);

    const ics = parseIcs(
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:U1\r\nDTSTART;VALUE=DATE:20260710\r\n" +
        "DTEND;VALUE=DATE:20260714\r\nSUMMARY:Ada\r\nEND:VEVENT\r\nEND:VCALENDAR",
    )[0];
    expect(ics.sourceReference).toBe("U1");
    expect(
      Object.keys(ics).filter((k) => PERSON_KEYS.includes(k)),
      "parseIcs artık kişi anahtarı üretiyor — rotadaki kapıya blocksGuestStay ekle",
    ).toEqual([]);
  });
});
