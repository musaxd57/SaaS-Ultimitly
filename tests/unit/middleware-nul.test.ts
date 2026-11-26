import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, signSession, type SessionPayload } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Yolda / sorguda NUL → sayfaya ulaşmadan 400 (G2 11-19, 11-14 A-1 sınıfı): dinamik parça ve sorgu parametresi veritabanı sorgusuna girip
// 500 + ortak uyarı kovası doğuruyordu (yeniden üretme: G2 `repro-nul-page-param`). Oturumlu ve oturumsuz istek, ham ve küçük harfli kod.
// ---------------------------------------------------------------------------

async function req(path: string, signedIn: boolean) {
  const r = new NextRequest(`https://www.lixusai.com${path}`);
  if (signedIn) {
    const payload: SessionPayload = { userId: "u1", organizationId: "o1", role: "owner", email: "h@example.com", name: "H", sessionEpoch: 0 };
    r.cookies.set(SESSION_COOKIE, await signSession(payload));
  }
  return middleware(r);
}

describe("ara katman — yolda / sorguda NUL", () => {
  it.each(["/inbox/%00", "/properties/%00", "/tasks?propertyId=%00", "/inbox?q=a%00b", "/reservations/compare/x%00", "/inbox?q=%00"])(
    "🚨 %s → 400 (oturumlu da oturumsuz da; sayfa / veritabanı yok)",
    async (path) => {
      expect((await req(path, true)).status).toBe(400);
      expect((await req(path, false)).status).toBe(400);
    },
  );

  it("KONTROL: NUL'suz aynı yollar 400 almaz (oturumlu geçer, oturumsuz girişe yönlenir); yüzde kodlu başka karakter geçer", async () => {
    for (const path of ["/inbox/abc", "/tasks?propertyId=abc", "/inbox?q=%C3%A7ay", "/inbox?q=100%25"]) {
      expect((await req(path, true)).status, path).not.toBe(400);
      expect((await req(path, false)).status, path).not.toBe(400);
    }
  });
});
