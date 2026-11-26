import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ clearSessionCookie: vi.fn(async () => {}) }));

import { GET } from "@/app/api/auth/logout/route";

// Behind Railway, req.url's reported origin is the INTERNAL container address
// (e.g. http://localhost:8080), not the public domain — a redirect built from
// it sends the browser to an unreachable URL (ERR_CONNECTION_REFUSED). This
// simulates exactly that: the request's own URL looks internal, but the real
// public host is only knowable from the Host header.
function reqWithInternalUrlButRealHost(publicHost: string) {
  return new NextRequest("http://localhost:8080/api/auth/logout", {
    headers: { host: publicHost },
  });
}

describe("GET /api/auth/logout — redirect target", () => {
  it("redirects to the PUBLIC host (from the Host header), never the internal request URL", async () => {
    const res = await GET(reqWithInternalUrlButRealHost("www.lixusai.com"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.lixusai.com/login");
  });

  it("falls back to www.lixusai.com when no Host header is present", async () => {
    const req = new NextRequest("http://localhost:8080/api/auth/logout");
    const res = await GET(req);
    expect(res.headers.get("location")).toBe("https://www.lixusai.com/login");
  });

  it("uses http:// for a localhost Host header (local dev)", async () => {
    const res = await GET(reqWithInternalUrlButRealHost("localhost:3000"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
