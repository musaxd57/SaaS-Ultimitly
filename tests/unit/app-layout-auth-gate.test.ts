import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// UYGULAMA SAYFALARININ ASIL YETKİ KAPISI `(app)/layout.tsx` (eski açık iş listesi ACI#1, 10-11 gece ölçümü). Middleware yalnız
// sayfalarda koşar ve eşleyicisi NOKTA içeren yolları atlar (`/((?!api|…|.*\..*).*)`) — yani middleware yetki kapısı DEĞİLDİR. Kapı,
// her uygulama sayfasının düzeni olan `(app)/layout.tsx`'in İLK adımında `requireAuth()`; o yüzden noktalı yol middleware'i atlasa da
// düzende durur. Bu pin bağlantıyı DAVRANIŞLA sınar: `requireAuth` yönlendirirse düzen başka HİÇBİR şey yapmadan (veritabanı okuması
// yok, kabuk çizilmez) yönlendirmeyi taşır.
// ---------------------------------------------------------------------------

const REDIRECT = new Error("NEXT_REDIRECT:/login");
const dbRead = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => Promise.reject(REDIRECT)) }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => dbRead }) }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

import AppLayout from "@/app/(app)/layout";
import { requireAuth } from "@/lib/auth";

describe("(app)/layout — yetki kapısı", () => {
  beforeEach(() => vi.clearAllMocks());

  it("🚨 oturum yoksa (requireAuth yönlendirir) düzen yönlendirmeyi taşır; veritabanı okunmaz, içerik çizilmez", async () => {
    await expect(AppLayout({ children: "GİZLİ İÇERİK" })).rejects.toBe(REDIRECT);
    expect(vi.mocked(requireAuth)).toHaveBeenCalledTimes(1);
    expect(dbRead).not.toHaveBeenCalled();
  });

  it("middleware eşleyicisi API'yi ve noktalı yolları atlar — yetki kapısı olarak ona güvenilmez (bu dosyanın varlık sebebi)", async () => {
    const { config } = await import("@/middleware");
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/inbox/abc")).toBe(true);
    expect(re.test("/inbox/abc.def")).toBe(false);
    expect(re.test("/api/tasks/x")).toBe(false);
  });
});
