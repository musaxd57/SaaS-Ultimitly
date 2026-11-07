import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { RESERVATION_INTERNAL_FIELDS } from "@/lib/reservation-view";

// ---------------------------------------------------------------------------
// Rezervasyon API yanıtında QR PIN / cihaz bağlama iç durumu YOK (gece denetimi 09-28, kodda doğrulandı): üç uç satırı
// `select`siz döndürüyordu — PIN özeti, cihaz bağlama özeti, kilit sayacı / süresi ve acil e-posta iç kimliği JSON'a giriyordu.
// Diğer alanlar (misafir adı, tarihler, durum, not…) aynen döner. Mülk API'sindeki gizli alan ayıklamasının ikizi.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as listReservations, POST as createReservation } from "@/app/api/reservations/route";
import { PATCH as patchReservation } from "@/app/api/reservations/[id]/route";

const noCtx = { params: Promise.resolve({} as Record<string, never>) };
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const made = await makeOrgWithProperty();
  propertyId = made.propertyId;
  session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function seedWithPinState() {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada",
      arrivalDate: daysFromNow(1),
      departureDate: daysFromNow(3),
      status: "confirmed",
      channel: "manual",
      chatPinHash: "a".repeat(64),
      chatBoundHash: "b".repeat(64),
      chatPinFailedCount: 3,
      chatPinLockedUntil: daysFromNow(1),
      qrEscalationEmailMessageId: "msg_1",
    },
    select: { id: true },
  });
}

// Liste testte AYRICA yazılı (mutasyon: modülün listesinden okumak, listeden silinen alanı testten de siliyordu).
const MUST_NOT_LEAK = ["chatPinHash", "chatBoundHash", "chatPinFailedCount", "chatPinLockedUntil", "qrEscalationEmailMessageId"];
const expectNoInternals = (row: Record<string, unknown>) => {
  for (const f of MUST_NOT_LEAK) expect(row, f).not.toHaveProperty(f);
};

describe("rezervasyon API yanıtı QR iç durumunu taşımaz", () => {
  it("🚨 GET liste: PIN / bağlama alanları yok, misafir adı ve tarihler var", async () => {
    await seedWithPinState();
    const res = await listReservations(new NextRequest("http://localhost/api/reservations"), noCtx);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expectNoInternals(rows[0]);
    expect(rows[0]).toMatchObject({ guestName: "Ada", status: "confirmed" });
    expect(rows[0]).toHaveProperty("arrivalDate");
  });

  it("🚨 PATCH yanıtı: PIN / bağlama alanları yok, güncellenen alan var", async () => {
    const { id } = await seedWithPinState();
    const res = await patchReservation(
      new NextRequest(`http://localhost/api/reservations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "geç varış" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const row = (await res.json()) as Record<string, unknown>;
    expectNoInternals(row);
    expect(row).toMatchObject({ id, notes: "geç varış" });
  });

  it("🚨 POST yanıtı: PIN / bağlama alanları yok (null da olsa anahtar dönmez)", async () => {
    const res = await createReservation(
      new NextRequest("http://localhost/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId, guestName: "Bora", arrivalDate: daysFromNow(4).toISOString(), departureDate: daysFromNow(6).toISOString() }),
      }),
      noCtx,
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as Record<string, unknown>;
    expectNoInternals(row);
    expect(row).toMatchObject({ guestName: "Bora" });
  });

  it("modülün listesi testin listesini kapsar (tek kaynak kayması olmasın)", () => {
    expect([...RESERVATION_INTERNAL_FIELDS].sort()).toEqual([...MUST_NOT_LEAK].sort());
  });

  it("KONTROL — veritabanındaki PIN durumu dokunulmadan kalır (yalnız yanıttan çıkarılır)", async () => {
    const { id } = await seedWithPinState();
    await listReservations(new NextRequest("http://localhost/api/reservations"), noCtx);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id } });
    expect(row.chatPinHash).toBe("a".repeat(64));
    expect(row.chatPinFailedCount).toBe(3);
  });
});
