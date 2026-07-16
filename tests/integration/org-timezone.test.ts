import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { zonedDayRange } from "@/lib/timezone";

// Org-timezone uçtan uca: Ayarlar'dan kapalı-set doğrulamayla yazılır; otomasyon
// gün sınırları (previewWelcomes) ve hazırlık planı (getPrepPlan) org'un YEREL
// gününü izler. Ayırt edici fikstür: New York gününün başlamasına 1-2 saat kala
// bir varış — NY org için "dün" (listelenmez), Istanbul org için "bugün"
// (listelenir). Varsayılan Istanbul davranışı DEĞİŞMEDİ (regresyon kontrolü).

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/settings/route";
import { previewWelcomes } from "@/lib/automation";
import { getPrepPlan } from "@/lib/supply";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
const owner = (orgId: string): SessionPayload => ({
  userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0,
});

function patch(body: unknown) {
  const req = new NextRequest("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, ctx);
}

/** Org + property + "NY gününe 2 saat kala varan" airbnb rezervasyonu. */
async function seedOrgWithEdgeArrival(timezone: string | undefined, ref: string) {
  const org = await prisma.organization.create({
    data: { name: `Org ${ref}`, ...(timezone ? { timezone } : {}) },
  });
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: `Daire ${ref}`,
      supplyProfileJson: JSON.stringify({ carsaf_takimi: 2 }),
    },
  });
  // New York "bugün"ünün başlangıcından 2 saat ÖNCE: NY için dünün akşamı,
  // Istanbul için bugünün içi (NY start 04/05:00Z − 2h ≥ Istanbul start 21:00Z-dün).
  const nyStart = zonedDayRange(new Date(), "America/New_York").start;
  const arrival = new Date(nyStart.getTime() - 2 * 60 * 60 * 1000);
  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Test Misafir",
      arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 3 * 86_400_000),
      status: "confirmed",
      channel: "airbnb",
      sourceReference: `sr-${ref}`,
    },
  });
  return org;
}

describe("org-timezone", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("Ayarlar PATCH: geçerli IANA dilimi kaydeder, uydurma değeri 400 ile reddeder", async () => {
    const org = await prisma.organization.create({ data: { name: "TZ Org" } });
    session = owner(org.id);

    const ok = await patch({ timezone: "America/New_York" });
    expect(ok.status).toBe(200);
    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.timezone).toBe("America/New_York");

    const bad = await patch({ timezone: "Mars/Olympus" });
    expect(bad.status).toBe(400);
    const data = await bad.json();
    expect(data.fields.timezone).toContain("saat dilimi");
    // Reddedilen değer yazılmadı.
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).timezone).toBe(
      "America/New_York",
    );
  });

  it("previewWelcomes gün sınırı org.timezone'u izler (NY: dünkü varış listelenmez; Istanbul: listelenir)", async () => {
    const nyOrg = await seedOrgWithEdgeArrival("America/New_York", "ny");
    const istOrg = await seedOrgWithEdgeArrival(undefined, "ist"); // default Istanbul

    const nyRows = await previewWelcomes(nyOrg.id);
    const istRows = await previewWelcomes(istOrg.id);
    expect(nyRows).toHaveLength(0); // NY takviminde konaklama dün başladı
    expect(istRows).toHaveLength(1); // Istanbul takviminde hâlâ "bugün"
  });

  it("getPrepPlan 'bugün' başlangıcı org.timezone'u izler (aynı ayırt edici varış)", async () => {
    const nyOrg = await seedOrgWithEdgeArrival("America/New_York", "ny2");
    const istOrg = await seedOrgWithEdgeArrival(undefined, "ist2");

    const nyPlan = await getPrepPlan(nyOrg.id);
    const istPlan = await getPrepPlan(istOrg.id);
    expect(nyPlan.totalArrivals).toBe(0); // NY planında varış geçmişte
    expect(istPlan.totalArrivals).toBe(1); // Istanbul planında bugünün varışı
  });
});
