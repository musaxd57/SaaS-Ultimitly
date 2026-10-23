import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

// ---------------------------------------------------------------------------
// CODEX 09-30 (B1) — UÇTAN UCA: GERÇEK istemci + adaptör + senkron / temizlik, yalnız AĞ sahte. Okunamayan bir liste sayfası
// eskiden "boş sayfa" sayılıyordu: senkron ilk sayfanın mesajlarını alıp thread imlecini sağlayıcının son mesaj anına
// ilerletiyor, sonraki geçiş "imleç güncel" diye thread'i ATLIYORDU → 3. mesaj (bir sonraki misafir mesajına kadar) hiç
// gelmiyordu. Hayalet rezervasyon temizliği ise kısmi listede olmayan GERÇEK rezervasyonu silebiliyordu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) };
});

import { syncHospitable } from "@/lib/hospitable-sync";
import { cleanupStaleReservations } from "@/lib/reservations-cleanup";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const LAST_MESSAGE_AT = "2026-05-30T11:00:00Z";

function reservation(id: string) {
  return {
    id,
    code: `HM-${id}`,
    platform: "airbnb",
    status: "accepted",
    conversation_id: `conv-${id}`,
    last_message_at: LAST_MESSAGE_AT,
    arrival_date: ymd(daysFromNow(5)),
    departure_date: ymd(daysFromNow(9)),
    guest: { id: `guest-${id}`, first_name: "Ada", last_name: "Demir" },
  };
}
const msg = (id: number, at: string) => ({
  id,
  body: `mesaj ${id}`,
  sender_type: "guest",
  sender_role: "guest",
  sender: { full_name: "Ada Demir" },
  created_at: at,
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
function broken(): Response {
  return new Response('{"data": [{"id": 1003, "body": "mesaj', { status: 200, headers: { "Content-Type": "application/json" } });
}

type Routes = { messagesPage2: () => Response; reservationsPage2?: () => Response };

function stubHospitable(routes: Routes) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const page = url.searchParams.get("page");
    if (url.pathname.endsWith("/properties")) return json({ data: [{ id: "hp-1", name: "Lale 3" }] });
    if (url.pathname.endsWith("/reservations/res-1/messages")) {
      if (page === "1") {
        return json({ data: [msg(1001, "2026-05-30T09:00:00Z"), msg(1002, "2026-05-30T10:00:00Z")], meta: { current_page: 1, last_page: 2 } });
      }
      return routes.messagesPage2();
    }
    if (url.pathname.endsWith("/reservations")) {
      if (routes.reservationsPage2) {
        return page === "1"
          ? json({ data: [reservation("res-1")], meta: { current_page: 1, last_page: 2 } })
          : routes.reservationsPage2();
      }
      return json({ data: [reservation("res-1")], meta: { current_page: 1, last_page: 1 } });
    }
    throw new Error(`beklenmeyen istek ${url.pathname}`);
  });
}

describe("B1 — eksik liste sayfası senkronu 'tamam' saymaz", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("🚨 2. mesaj sayfası okunamadı → thread imleci İLERLEMEZ; sayfa düzelince 3. mesaj gelir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: propertyId }, data: { hospitableId: "hp-1" } });
    await setOrgHospitableToken(orgId, "pat-1", "Lale");

    stubHospitable({ messagesPage2: broken });
    await syncHospitable(orgId);

    const afterBroken = await prisma.conversation.findFirst({
      where: { propertyId, externalReservationId: "res-1" },
      select: { syncCursorAt: true, _count: { select: { messages: true } } },
    });
    // Thread bu geçişte atlandı: imleç yok (varsa bile ilerlemedi), kısmi mesaj yazılmadı.
    expect(afterBroken?.syncCursorAt ?? null).toBeNull();
    expect(afterBroken?._count.messages ?? 0).toBe(0);

    vi.restoreAllMocks();
    stubHospitable({ messagesPage2: () => json({ data: [msg(1003, LAST_MESSAGE_AT)], meta: { current_page: 2, last_page: 2 } }) });
    await syncHospitable(orgId);

    const conv = await prisma.conversation.findFirstOrThrow({
      where: { propertyId, externalReservationId: "res-1" },
      select: { syncCursorAt: true, messages: { select: { externalId: true }, orderBy: { createdAt: "asc" } } },
    });
    expect(conv.messages.map((m) => m.externalId)).toEqual(["1001", "1002", "1003"]);
    expect(conv.syncCursorAt?.toISOString()).toBe(new Date(LAST_MESSAGE_AT).toISOString());
  });

  it("🚨 hayalet temizliği: 2. rezervasyon sayfası okunamadı → mülk ATLANIR, gerçek rezervasyon silinmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: propertyId }, data: { hospitableId: "hp-1" } });
    await setOrgHospitableToken(orgId, "pat-1", "Lale");
    // res-2 gerçek (sağlayıcıda 2. sayfada); Hospitable senkronunda yaratılmış konuşması var (köken kanıtı).
    const real = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Deniz Kaya",
        arrivalDate: daysFromNow(10),
        departureDate: daysFromNow(12),
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-2",
      },
      select: { id: true },
    });
    await prisma.conversation.create({
      data: { propertyId, guestIdentifier: "Deniz Kaya", channel: "airbnb", status: "answered", externalReservationId: "res-2" },
    });

    stubHospitable({ messagesPage2: broken, reservationsPage2: broken });
    const out = await cleanupStaleReservations(orgId);

    expect(out).toMatchObject({ removed: 0, checkedProperties: 0, skippedProperties: 1 });
    expect(await prisma.reservation.findUnique({ where: { id: real.id } })).not.toBeNull();
  });
});
