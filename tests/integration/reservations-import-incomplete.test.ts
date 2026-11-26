import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
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

// ---------------------------------------------------------------------------
// F16 (09-26): "Dosyadan içe aktar" EKSİK okunan dosyayı "dosyanın tamamı" gibi sunmaz. Önizleme ve sonuç
// sade bir not taşır (yarım dosya, tekrarlayan etkinlik, tarihi okunamayan kayıt…); okunan satırlar yine
// aktarılır (gerçek olgular). Tam dosyada not YOK.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const icsDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const vevent = (uid: string, extra: string[] = []) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${icsDay(10)}`, `DTEND;VALUE=DATE:${icsDay(13)}`, "SUMMARY:Sahte Konaklama", ...extra, "END:VEVENT"].join("\r\n");
const full = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
const truncated = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events].join("\r\n");

function req(propertyId: string, ics: string, mode?: "preview") {
  const form = new FormData();
  form.set("file", new File([ics], "takvim.ics", { type: "text/calendar" }));
  form.set("propertyId", propertyId);
  if (mode) form.set("mode", mode);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}
const call = (r: NextRequest) => POST(r, { params: Promise.resolve({}) });

function rawReq(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}

describe("dosyadan içe aktarma — alan türü (sızma testi 11-14, M-2)", () => {
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  it("🚨 `file` alanı düz metin → 400 (eskiden file.name çöküp 500 + hata raporu)", async () => {
    const res = await call(rawReq({ file: "abc", propertyId }));
    expect(res.status).toBe(400);
  });
  it("🚨 `propertyId` dosya olarak gelirse → 400, yazma yok", async () => {
    const res = await call(rawReq({ file: new File([full(vevent("a@x"))], "t.ics", { type: "text/calendar" }), propertyId: new File(["x"], "p.txt") }));
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count()).toBe(0);
  });
  it("KONTROL: geçerli dosya + daire kabul edilir", async () => {
    const res = await call(req(propertyId, full(vevent("ok@x")), "preview"));
    expect(res.status).toBe(200);
  });
});

describe("dosyadan içe aktarma — eksik okuma notu", () => {
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

  it("yarım dosya: önizleme notu söyler, okunan satır yine aktarılır ve sonuç da notu taşır", async () => {
    const preview = await (await call(req(propertyId, truncated(vevent("a@x")), "preview"))).json();
    expect(preview.counts).toEqual({ create: 1, update: 0, cancel: 0, skipped: 0 });
    expect(preview.note).toBe("Dosyanın bir kısmı okunamadı (takvim dosyası yarım geldi); bazı rezervasyonlar aktarılmayabilir.");

    const done = await (await call(req(propertyId, truncated(vevent("a@x"))))).json();
    expect(done).toMatchObject({ imported: 1, note: preview.note });
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(1);
  });

  it("tekrarlayan etkinlik: neden metni farklı", async () => {
    const preview = await (await call(req(propertyId, full(vevent("r@x", ["RRULE:FREQ=WEEKLY;COUNT=3"])), "preview"))).json();
    expect(preview.note).toContain("tekrarlayan etkinlikler okunamıyor");
  });

  it("tam dosya: not YOK (önizleme ve sonuç)", async () => {
    const preview = await (await call(req(propertyId, full(vevent("a@x")), "preview"))).json();
    expect(preview.note).toBeNull();
    const done = await (await call(req(propertyId, full(vevent("a@x"))))).json();
    expect(done.note).toBeNull();
  });
});
