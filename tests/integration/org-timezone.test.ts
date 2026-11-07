import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

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

// DETERMİNİSTİK pin (Codex: acele etme, emin ol) — canlı `new Date()` yerine sabit
// bir an. 2026-07-16 yaz → NY=EDT (UTC-4), Istanbul=UTC+3 (yıl boyu). Bu an için:
//   Istanbul gün başlangıcı = 2026-07-15T21:00Z, NY gün başlangıcı = 2026-07-16T04:00Z.
// Varış bu iki sınırın ARASINDA (02:00Z) → Istanbul için "bugün" (>=21:00Z-dün),
// NY için "henüz bugün değil" (<04:00Z). Böylece saat kaç olursa olsun test aynı.
const PINNED_NOW = new Date("2026-07-16T05:00:00.000Z");
const GAP_ARRIVAL = new Date("2026-07-16T02:00:00.000Z");

/** Org + property + iki-dilim sınırının arasına düşen airbnb rezervasyonu. */
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
  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Test Misafir",
      arrivalDate: GAP_ARRIVAL,
      departureDate: new Date(GAP_ARRIVAL.getTime() + 3 * 86_400_000),
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

    const nyRows = await previewWelcomes(nyOrg.id, 12, PINNED_NOW);
    const istRows = await previewWelcomes(istOrg.id, 12, PINNED_NOW);
    expect(nyRows).toHaveLength(0); // NY takviminde konaklama dün başladı
    expect(istRows).toHaveLength(1); // Istanbul takviminde hâlâ "bugün"
  });

  it("getPrepPlan 'bugün' başlangıcı org.timezone'u izler (aynı ayırt edici varış)", async () => {
    const nyOrg = await seedOrgWithEdgeArrival("America/New_York", "ny2");
    const istOrg = await seedOrgWithEdgeArrival(undefined, "ist2");

    const nyPlan = await getPrepPlan(nyOrg.id, { now: PINNED_NOW });
    const istPlan = await getPrepPlan(istOrg.id, { now: PINNED_NOW });
    expect(nyPlan.totalArrivals).toBe(0); // NY planında varış geçmişte
    expect(istPlan.totalArrivals).toBe(1); // Istanbul planında bugünün varışı
  });
});
