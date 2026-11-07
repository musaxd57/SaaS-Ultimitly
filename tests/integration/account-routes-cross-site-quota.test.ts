import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-04 P2 — hesap güvenliği rotaları (2FA yönetimi, şifre değişikliği, hesap silme) kullanıcının deneme KOTASINI, isteğin aynı kökenden
// gelen JSON olduğunu doğrulamadan tüketiyordu: kardeş HTTPS alan adından giden basit (text/plain) istekler kovayı doldurup kullanıcının
// kendi işlemini engelleyebiliyordu. Artık başka siteden yazma 403, JSON olmayan gövde 415 — kota DOKUNULMADAN.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(async () => ({ ok: true })), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as twoFactor } from "@/app/api/account/2fa/route";
import { POST as password } from "@/app/api/account/password/route";
import { POST as accountDelete } from "@/app/api/account/delete/route";

type Handler = (req: NextRequest) => Promise<Response>;
const ROUTES: { name: string; url: string; handler: Handler; good: unknown }[] = [
  { name: "2FA", url: "http://localhost/api/account/2fa", handler: twoFactor as Handler, good: { action: "" } },
  { name: "şifre", url: "http://localhost/api/account/password", handler: password as Handler, good: { action: "" } },
  { name: "hesap silme", url: "http://localhost/api/account/delete", handler: accountDelete as Handler, good: {} },
];

const req = (url: string, init: { site?: string; contentType?: string; body: string }) =>
  new NextRequest(url, {
    method: "POST",
    headers: {
      ...(init.contentType ? { "content-type": init.contentType } : {}),
      ...(init.site ? { "sec-fetch-site": init.site } : {}),
    },
    body: init.body,
  });

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: org.id, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});

describe.each(ROUTES)("$name rotası", ({ url, handler, good }) => {
  it("🚨 kardeş alan adından (same-site) basit POST'lar 403 — kota TÜKETİLMEZ, meşru JSON isteği 429 almaz", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await handler(req(url, { site: "same-site", contentType: "text/plain", body: "{}" }));
      expect(res.status).toBe(403);
    }
    const ok = await handler(req(url, { site: "same-origin", contentType: "application/json", body: JSON.stringify(good) }));
    expect(ok.status).not.toBe(429);
    expect(ok.status).not.toBe(403);
  });

  it("🚨 aynı kökenden ama JSON OLMAYAN gövde 415 — kota TÜKETİLMEZ", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await handler(req(url, { site: "same-origin", contentType: "text/plain", body: "{}" }));
      expect(res.status).toBe(415);
    }
    const ok = await handler(req(url, { site: "same-origin", contentType: "application/json", body: JSON.stringify(good) }));
    expect(ok.status).not.toBe(429);
  });

  it("KONTROL: tarayıcı başlığı olmayan (none / yok) JSON istek geçer; kota meşru isteklerde yine işler (429'a ulaşılır)", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await handler(req(url, { contentType: "application/json", body: JSON.stringify(good) }))).status;
    expect(last).toBe(429);
  });
});
