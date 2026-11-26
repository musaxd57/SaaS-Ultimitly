import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DOSYADAN İÇE AKTARMA — ESKİ KİMLİKLE TUTULAN SİLME (KVKK) KAYDI YAZIM ANINDA DA ENGELLER (Opus incelemesi 11-11). Gerçek PostgreSQL.
//
// 200 karakterden uzun kimlik artık özetleniyor; eski sürüm onu 200'e KESİP saklıyordu. Silme kaydı da o eski (kesilmiş) kimlikle tutulmuş
// olabilir. Aktarım başındaki kontrol bunu bir kez soruyor; satır yazımındaki taze kontrol ise yalnız YENİ kimliği soruyordu → eski kimlikli
// silme kaydı ikisinin ARASINDA yazılırsa (o sırada koşan silme işlemi satırı eski kimliğiyle okumuşsa) konaklama yeni kimlikle yazılıyordu.
// Araya girme: aktarım başındaki kimlik çevirisi bittikten HEMEN SONRA silme kaydı düşer (üretim kodunda kanca yok — modül sarmalanır).
// ---------------------------------------------------------------------------

const afterReconcile = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }));

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/import/legacy-source-ref", async (orig) => {
  const real = await orig<typeof import("@/lib/import/legacy-source-ref")>();
  return {
    ...real,
    reconcileLegacySourceReferences: async (opts: Parameters<typeof real.reconcileLegacySourceReferences>[0]) => {
      const out = await real.reconcileLegacySourceReferences(opts);
      if (afterReconcile.run && !opts.readOnly) await afterReconcile.run();
      return out;
    },
  };
});

import { POST as importPost } from "@/app/api/reservations/import/route";
import { normalizeSourceReference, legacyTruncatedSourceReference } from "@/lib/import/source-ref";
import { tombstoneKeyHash, currentKeyFingerprint } from "@/lib/erasure";
import { __resetRateLimit } from "@/lib/rate-limit";

const DAY = 86_400_000;
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const dateOnly = (d: number) => new Date(`${new Date(Date.now() + d * DAY).toISOString().slice(0, 10)}T12:00:00.000Z`);
const UID = "040000008200E00074C5B7101A82E008" + "0".repeat(190) + "-A"; // 224 karakter → eski sürüm 200'e keserdi
const LEGACY = legacyTruncatedSourceReference(UID)!;
const NEW_ID = normalizeSourceReference(UID)!;

const ics = (to: number, summary: string, extra: string[] = []) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "BEGIN:VEVENT",
    `UID:${UID}`,
    `DTSTART;VALUE=DATE:${ymd(10)}`,
    `DTEND;VALUE=DATE:${ymd(to)}`,
    `SUMMARY:${summary}`,
    ...extra,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

let orgId = "";
let propertyId = "";
const upload = (body: string) => {
  const form = new FormData();
  form.set("file", new File([body], "takvim.ics", { type: "text/calendar" }));
  form.set("propertyId", propertyId);
  return importPost(new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }), { params: Promise.resolve({}) });
};
/** Bu rotanın daha önce (eski sürümle) yazdığı satır: bağlantısız, kanal "ics", kimlik 200'e kesilmiş. */
const legacyRow = () =>
  prisma.reservation.create({
    data: {
      propertyId, guestName: "Eski Ad", sourceReference: LEGACY, calendarSourceId: null,
      arrivalDate: dateOnly(10), departureDate: dateOnly(12), status: "confirmed", channel: "ics",
    },
  });
/** Aktarım başındaki kontrolden SONRA, eski kimlikle silme kaydı düşer. */
const eraseUnderLegacyKeyMidRun = () => {
  afterReconcile.run = async () => {
    await prisma.erasureTombstone.create({
      data: { organizationId: orgId, keyType: "source_reference", keyHash: tombstoneKeyHash(orgId, "source_reference", LEGACY)!, keyFingerprint: currentKeyFingerprint(), erasedAt: new Date() },
    });
  };
};

describe("dosyadan içe aktarma — eski kimlikli silme kaydı yazım anında da engeller", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    afterReconcile.run = null;
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterEach(() => {
    afterReconcile.run = null;
  });

  it("🚨 YENİ satır: silme kaydı aktarım sürerken eski kimlikle yazıldıysa konaklama yeni kimlikle AÇILMAZ", async () => {
    eraseUnderLegacyKeyMidRun();
    expect((await upload(ics(12, "Silinen Misafir"))).status).toBe(200);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0); // ⬅️ (ilk sürümde) 1 — "Silinen Misafir" yeni kimlikle yazılırdı
  });

  it("🚨 GÜNCELLEME: yeni kimliğe çevrilen satırın silme kaydı o arada eski kimlikle yazıldıysa dosyadaki ad / tarih satıra YAZILMAZ", async () => {
    const row = await legacyRow();
    eraseUnderLegacyKeyMidRun();
    expect((await upload(ics(14, "Yeni Ad"))).status).toBe(200);
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.sourceReference).toBe(NEW_ID); // kimlik çevrildi (kontrol silme kaydından önceydi)
    expect(after.guestName).toBe("Eski Ad"); // ⬅️ (ilk sürümde) "Yeni Ad"
    expect(after.departureDate.toISOString()).toBe(dateOnly(12).toISOString());
  });

  it("🚨 İPTAL: aynı durumda dosyadaki iptal de satıra uygulanmaz (silinmiş kayda dokunulmaz — yeni kimlikli silme kaydıyla aynı kural)", async () => {
    const row = await legacyRow();
    eraseUnderLegacyKeyMidRun();
    expect((await upload(ics(12, "Eski Ad", ["STATUS:CANCELLED"]))).status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("confirmed"); // ⬅️ (ilk sürümde) "cancelled"
  });

  it("KONTROL: silme kaydı yokken aynı üç dosya yazar — yeni satır açılır, satır güncellenir, iptal uygulanır", async () => {
    expect((await upload(ics(12, "Ahmet Yilmaz"))).status).toBe(200);
    const created = await prisma.reservation.findMany({ where: { propertyId } });
    expect(created.map((r) => [r.sourceReference, r.guestName])).toEqual([[NEW_ID, "Ahmet Yilmaz"]]);

    await prisma.reservation.deleteMany({ where: { propertyId } });
    const row = await legacyRow();
    expect((await upload(ics(14, "Yeni Ad"))).status).toBe(200);
    const updated = await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.sourceReference).toBe(NEW_ID);
    expect(updated.guestName).toBe("Yeni Ad");
    expect(updated.departureDate.toISOString()).toBe(dateOnly(14).toISOString());

    expect((await upload(ics(14, "Yeni Ad", ["STATUS:CANCELLED"]))).status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("cancelled");
  });

  it("KONTROL: silme kaydı aktarımdan ÖNCE eski kimlikle yazılmışsa zaten baştaki kontrol engeller (yeni satır açılmaz)", async () => {
    await prisma.erasureTombstone.create({
      data: { organizationId: orgId, keyType: "source_reference", keyHash: tombstoneKeyHash(orgId, "source_reference", LEGACY)!, keyFingerprint: currentKeyFingerprint(), erasedAt: new Date() },
    });
    expect((await upload(ics(12, "Silinen Misafir"))).status).toBe(200);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });
});
