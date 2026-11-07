import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/reservations/import/route";
import { ANON_NAME } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// Claude 2. dalga #11 (10-21, KVKK): dosya aktarımı satırı TX DIŞINDA sınıflandırıyor ("anonimleştirilmiş mi?"), yazımı sonra yapıyordu.
// Arada saklama süpürgesi satırı anonimleştirirse dosyadaki ad GERİ yazılıyordu. Yazım artık satırın o anda anonim olmadığını şart koşar.
// Yarış, yazım işlemi açılmadan hemen önce satırı anonimleştirerek kurulur (prisma temsilcisine spyOn → AYRI dosya, sızmasın).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const icsDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const ics = (uid: string, summary: string, from: number, to: number) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${icsDay(from)}`,
    `DTEND;VALUE=DATE:${icsDay(to)}`,
    `SUMMARY:${summary}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
function req(propertyId: string, body: string) {
  const form = new FormData();
  form.set("file", new File([body], "rez.ics", { type: "text/calendar" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}
const call = (r: NextRequest) => POST(r, { params: Promise.resolve({}) });
const UID = "scrub-race-uid@lixusai.com";

describe("POST /api/reservations/import — anonimleştirme yarışı (KVKK)", () => {
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    await call(req(propertyId, ics(UID, "Ada Guest", 10, 13)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 sınıflandırmadan sonra, yazımdan önce anonimleştirilen satıra dosyadaki ad GERİ YAZILMAZ", async () => {
    const before = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: UID } });
    expect(before.guestName).toBe("Ada Guest");
    const original = prisma.$transaction.bind(prisma);
    let raced = false;
    vi.spyOn(prisma, "$transaction").mockImplementation((async (...args: unknown[]) => {
      if (!raced) {
        raced = true;
        await prisma.reservation.update({ where: { id: before.id }, data: { guestName: ANON_NAME, notes: null } });
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as never);
    const res = await call(req(propertyId, ics(UID, "Ada Guest Yeni", 11, 14)));
    expect(res.status).toBe(200);
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.guestName).toBe(ANON_NAME);
  });

  it("KONTROL: yarış yoksa güncelleme aynen yazılır (ad + tarih)", async () => {
    const res = await call(req(propertyId, ics(UID, "Ada Guest Yeni", 11, 14)));
    expect(res.status).toBe(200);
    const after = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: UID } });
    expect(after.guestName).toBe("Ada Guest Yeni");
  });
});
