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

// ---------------------------------------------------------------------------
// K1 (kurucu kararı 09-30): negatif tutarlı CSV satırı açık hatayla REDDEDİLİR ("Satır N: Tutar negatif olamaz"); dosyanın
// diğer satırları normal aktarılır. Önizleme aynı hatayı satırda gösterir (kaydetmeden).
// ---------------------------------------------------------------------------

function req(propertyId: string, csv: string, preview = false) {
  const form = new FormData();
  form.set("file", new File([csv], "rez.csv", { type: "text/csv" }));
  form.set("propertyId", propertyId);
  if (preview) form.set("mode", "preview");
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}

const CSV = [
  "misafir,giriş,çıkış,tutar",
  "Ada,10.07.2027,14.07.2027,1.500",
  "Bora,15.07.2027,18.07.2027,-450",
  "Cem,20.07.2027,22.07.2027,(300)",
].join("\n");

describe("CSV içe aktarma — negatif tutar", () => {
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 negatif satırlar açık hatayla reddedilir, pozitif satır aktarılır; hiçbir tutar pozitife çevrilmez", async () => {
    const res = await POST(req(propertyId, CSV), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(2);
    expect(body.errors).toEqual(["Satır 3: Tutar negatif olamaz", "Satır 4: Tutar negatif olamaz"]);
    const rows = await prisma.reservation.findMany({ where: { propertyId } });
    expect(rows.map((r) => r.guestName)).toEqual(["Ada"]);
    expect(Number(rows[0].totalAmount)).toBe(1500);
  });

  it("önizleme aynı hatayı satırda gösterir ve hiçbir şey yazmaz", async () => {
    const res = await POST(req(propertyId, CSV, true), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(body.counts).toMatchObject({ create: 1, skipped: 2 });
    const bora = body.rows.find((r: { guestName: string }) => r.guestName === "Bora");
    expect(bora).toMatchObject({ action: "skip", reason: "invalid_amount", error: "Satır 3: Tutar negatif olamaz" });
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });
});
