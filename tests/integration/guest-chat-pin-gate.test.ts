import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { setReservationPin, QR_PIN_MAX_ATTEMPTS } from "@/lib/guest-chat-pin";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// Faz 5 (#14) — the PIN GATE at the public chat route. Verifies that with the
// feature on, a stay that requires a PIN cannot be claimed / messaged / read
// until the correct PIN is entered, and that the whole thing is inert with the
// flag off (backward compat).

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
import { suggestReply } from "@/lib/ai";
import { GET, POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);

function aiResult(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general", confidence: 0.9, reply: "Çöp salı toplanır.", risk: null,
    priority: "standard", source: "openai", actionSuggestion: null, riskLevel: "none",
    detectedLanguage: "tr", riskType: null, usedSources: [], missingInfo: [],
    statedCheckoutTime: null, ...over,
  };
}

const ENV = ["GUEST_CHAT_ENABLED", "QR_PIN_ENABLED"] as const;
const ORIG: Record<string, string | undefined> = {};

function post(token: string, payload: Record<string, unknown>, cookie?: string, ip = "203.0.113.7") {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}
function get(token: string, cookie?: string, ip = "203.0.113.7") {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, { method: "GET", headers });
  return GET(req as never, { params: Promise.resolve({ token }) });
}
function deviceCookie(res: Response): string | undefined {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : undefined;
}

/** Chat-enabled property + one active reservation. Optionally set a PIN + strict. */
async function fixture(opts: { withPin?: boolean; strict?: boolean } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  if (opts.strict) await prisma.organization.update({ where: { id: orgId }, data: { qrChatPinRequired: true } });
  const r = await prisma.reservation.create({
    data: {
      propertyId, guestName: "Ada", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2),
      status: "confirmed", channel: "airbnb",
    },
  });
  let pin: string | undefined;
  if (opts.withPin) pin = await setReservationPin(r.id);
  return { orgId, propertyId, token, reservationId: r.id, pin };
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  mockSuggest.mockResolvedValue(aiResult());
  for (const k of ENV) ORIG[k] = process.env[k];
  process.env.GUEST_CHAT_ENABLED = "1";
  process.env.QR_PIN_ENABLED = "1";
});
afterEach(() => {
  for (const k of ENV) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

describe("PIN gate — flag OFF (backward compat)", () => {
  it("with QR_PIN_ENABLED off, a reservation WITH a PIN still uses the old first-scan flow", async () => {
    delete process.env.QR_PIN_ENABLED;
    const { token } = await fixture({ withPin: true });
    // GET binds (old behavior) — no pinRequired.
    const g = await get(token);
    const gj = await g.json();
    expect(gj.pinRequired).toBeUndefined();
    expect(gj.open).toBe(true);
    // A message is answered (AI runs).
    const cookie = deviceCookie(g);
    const p = await post(token, { message: "Çöp ne zaman?" }, cookie);
    expect((await p.json()).reply).toContain("Çöp");
    expect(mockSuggest).toHaveBeenCalled();
  });
});

describe("PIN gate — flag ON, reservation has a PIN", () => {
  it("GET without a valid device returns pinRequired and does NOT claim the stay", async () => {
    const { token, reservationId } = await fixture({ withPin: true });
    const g = await get(token);
    const gj = await g.json();
    expect(gj.pinRequired).toBe(true);
    expect(gj.messages).toEqual([]);
    // No device binding was written (bare scan can't claim a PIN'd stay).
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatBoundHash).toBeNull();
  });

  it("POST a message before unlocking is REFUSED (pinRequired) and the AI never runs", async () => {
    const { token, reservationId } = await fixture({ withPin: true });
    const p = await post(token, { message: "Merhaba" });
    expect((await p.json()).pinRequired).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatBoundHash).toBeNull();
  });

  it("WRONG PIN → generic pinError, no claim; CORRECT PIN → unlocked + device bound", async () => {
    const { token, reservationId, pin } = await fixture({ withPin: true });
    const wrong = pin === "000000" ? "111111" : "000000";
    const bad = await post(token, { pin: wrong });
    const bj = await bad.json();
    expect(bj.pinError).toBe(true);
    expect(bj.unlocked).toBeUndefined();
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.chatBoundHash).toBeNull();

    const okRes = await post(token, { pin: pin! });
    const oj = await okRes.json();
    expect(oj.unlocked).toBe(true);
    const cookie = deviceCookie(okRes);
    expect(cookie).toBeTruthy();
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.chatBoundHash).not.toBeNull();

    // With the unlock cookie, messaging works and the AI runs.
    const msg = await post(token, { message: "Çöp ne zaman?" }, cookie);
    expect((await msg.json()).reply).toContain("Çöp");
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("after unlock, GET returns the thread for the bound device", async () => {
    const { token, pin } = await fixture({ withPin: true });
    const unlock = await post(token, { pin: pin! });
    const cookie = deviceCookie(unlock);
    await post(token, { message: "Çöp ne zaman?" }, cookie);
    const g = await get(token, cookie);
    const gj = await g.json();
    expect(gj.pinRequired).toBeUndefined();
    expect(gj.open).toBe(true);
    expect(gj.messages.length).toBeGreaterThan(0);
  });

  it("LOCKOUT: after too many wrong PINs, even the correct PIN is locked out", async () => {
    const { token, pin } = await fixture({ withPin: true });
    const wrong = pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < QR_PIN_MAX_ATTEMPTS; i++) {
      // vary IP so the per-IP limiter (8/5min) doesn't mask the per-reservation lockout
      await post(token, { pin: wrong }, undefined, `10.0.0.${i}`);
    }
    const locked = await post(token, { pin: pin! }, undefined, "10.0.0.250");
    const lj = await locked.json();
    expect(lj.locked).toBe(true);
    expect(lj.retryAfter).toBeGreaterThan(0);
  });

  it("PARALLEL two devices with the CORRECT PIN → exactly one binds, the other boundElsewhere", async () => {
    const { token, pin } = await fixture({ withPin: true });
    const [a, b] = await Promise.all([
      post(token, { pin: pin! }, undefined, "10.1.0.1"),
      post(token, { pin: pin! }, undefined, "10.1.0.2"),
    ]);
    const results = [await a.json(), await b.json()];
    expect(results.filter((r) => r.unlocked === true)).toHaveLength(1);
    expect(results.filter((r) => r.boundElsewhere === true)).toHaveLength(1);
  });

  it("per-IP PIN attempt limit → 429 after the burst", async () => {
    const { token, pin } = await fixture({ withPin: true });
    const wrong = pin === "000000" ? "111111" : "000000";
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await post(token, { pin: wrong }, undefined, "10.2.0.9");
      if (r.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
});

describe("PIN gate — org STRICT mode", () => {
  it("strict + reservation has NO PIN → chat is fail-closed (pinRequired), AI never runs", async () => {
    const { token } = await fixture({ strict: true, withPin: false });
    const g = await get(token);
    expect((await g.json()).pinRequired).toBe(true);
    const p = await post(token, { message: "Merhaba" });
    expect((await p.json()).pinRequired).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();
    // Unlock attempt with any PIN → generic error (no PIN is set → no_pin, masked).
    const u = await post(token, { pin: "123456" });
    expect((await u.json()).pinError).toBe(true);
  });

  it("NOT strict + reservation has no PIN → old flow (no PIN required)", async () => {
    const { token } = await fixture({ strict: false, withPin: false });
    const g = await get(token);
    expect((await g.json()).pinRequired).toBeUndefined();
  });
});

describe("PIN gate — lifecycle", () => {
  it("a CANCELLED reservation never prompts for a PIN (chat is simply closed)", async () => {
    const { token, reservationId } = await fixture({ withPin: true });
    await prisma.reservation.update({ where: { id: reservationId }, data: { status: "cancelled" } });
    const g = await get(token);
    const gj = await g.json();
    expect(gj.open).toBe(false);
    expect(gj.pinRequired).toBeUndefined();
  });

  it("REGENERATION: the old PIN no longer unlocks, the new one does", async () => {
    const { token, reservationId, pin: oldPin } = await fixture({ withPin: true });
    const newPin = await setReservationPin(reservationId);
    expect(newPin).not.toBe(oldPin);
    expect((await (await post(token, { pin: oldPin! }, undefined, "10.3.0.1")).json()).pinError).toBe(true);
    expect((await (await post(token, { pin: newPin }, undefined, "10.3.0.2")).json()).unlocked).toBe(true);
  });
});
