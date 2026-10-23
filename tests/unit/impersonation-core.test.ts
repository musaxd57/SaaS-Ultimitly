import { describe, it, expect } from "vitest";
import {
  IMPERSONATION_MAX_MS,
  impersonationExpired,
  isImpersonating,
  isReadOnlyMethod,
} from "@/lib/auth/impersonation";

// K8 (kurucu kararı 09-28): bürünme = salt-okunur destek görünümü, en çok 2 saat. Bağlantılar `impersonation-read-only.test.ts`.

describe("bürünme süresi", () => {
  const now = 1_800_000_000_000;
  const at = (msAgo: number) => ({ actorUserId: "op", impersonatedAt: Math.floor((now - msAgo) / 1000) });

  it("2 saat tam sınır geçerli, bir saniye fazlası dolmuş", () => {
    expect(IMPERSONATION_MAX_MS).toBe(2 * 60 * 60 * 1000);
    expect(impersonationExpired(at(IMPERSONATION_MAX_MS), now)).toBe(false);
    expect(impersonationExpired(at(IMPERSONATION_MAX_MS + 1000), now)).toBe(true);
    expect(impersonationExpired(at(60_000), now)).toBe(false);
  });

  it("🚨 damgasız (eski) bürünme belirteci dolmuş sayılır — fail-closed", () => {
    expect(impersonationExpired({ actorUserId: "op" }, now)).toBe(true);
    expect(impersonationExpired({ actorUserId: "op", impersonatedAt: Number.NaN }, now)).toBe(true);
  });

  it("KONTROL — bürünme olmayan oturum hiçbir zaman dolmaz", () => {
    expect(impersonationExpired({}, now)).toBe(false);
    expect(impersonationExpired(null, now)).toBe(false);
    expect(isImpersonating({})).toBe(false);
    expect(isImpersonating({ actorUserId: "op" })).toBe(true);
  });
});

describe("salt okuma yöntemi", () => {
  it("GET / HEAD / OPTIONS okuma; diğerleri yazma (büyük/küçük harf fark etmez)", () => {
    for (const m of ["GET", "head", "Options"]) expect(isReadOnlyMethod(m), m).toBe(true);
    for (const m of ["POST", "put", "PATCH", "DELETE"]) expect(isReadOnlyMethod(m), m).toBe(false);
  });
});
