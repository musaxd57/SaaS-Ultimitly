import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, signSession, type SessionPayload } from "@/lib/auth/session";
import type { UserRole } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Middleware kimlik yönlendirmesi.
//
// 🚨 ASIL KONU (08-02, Codex): `/sifremi-unuttum` oturum AÇIKKEN panele
// yönlendiriliyordu. Sıfırlama e-postasındaki bağlantı bu sayfaya geldiği için,
// hesabına o tarayıcıdan girmiş bir kullanıcı bağlantıya tıkladığında panele
// düşüyor ve şifresini HİÇ sıfırlayamıyordu. Ek olarak tarayıcı, yönlendirme
// hedefinde fragment yoksa kaynağınkini TAŞIR → challenge token'ı
// `/dashboard#t=...` olarak adres çubuğunda kalıyordu (sayfanın
// `history.replaceState` temizliği orada çalışmaz).
//
// Bu dosya ÜÇ şeyi birden pinler:
//   1. `/sifremi-unuttum` oturum açıkken artık yönlendirilmez,
//   2. `/login` + `/register` yönlendirmesi AYNEN durur (değişiklik dar),
//   3. sayfa oturumsuz ziyaretçi ve staff için HÂLÂ public.
// (2) ve (3) olmadan düzeltme iki farklı yönden sessizce bozulabilirdi:
// `SIGNED_IN_REDIRECT_PATHS` boşaltılırsa (1) yeşil kalır, `AUTH_PATHS`'ten
// çıkarılırsa sayfa oturum ister hâle gelir ve yine (1) yeşil kalır.
// ---------------------------------------------------------------------------

async function reqAs(pathname: string, role: UserRole | null) {
  const req = new NextRequest(`https://www.lixusai.com${pathname}`);
  if (role) {
    const payload: SessionPayload = {
      userId: "u1",
      organizationId: "o1",
      role,
      email: "host@example.com",
      name: "Host",
      sessionEpoch: 0,
    };
    req.cookies.set(SESSION_COOKIE, await signSession(payload));
  }
  return middleware(req);
}

/** Yönlendirme hedefi (yoksa null = istek geçti). */
function redirectTo(res: Response): string | null {
  if (res.status < 300 || res.status >= 400) return null;
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
}

describe("middleware — kimlik sayfası yönlendirmeleri", () => {
  it("oturum AÇIKKEN /sifremi-unuttum yönlendirilmez (e-posta bağlantısı çalışsın)", async () => {
    for (const role of ["owner", "manager"] as UserRole[]) {
      expect(redirectTo(await reqAs("/sifremi-unuttum", role))).toBeNull();
    }
  });

  it("staff da /sifremi-unuttum'a erişebilir (/tasks'e yollanmaz)", async () => {
    // Staff yalnız /tasks görebilir AMA bu kural `isPublic` olmayan sayfalar
    // içindir; sıfırlama sayfası public. Temizlikçi de şifresini unutabilir.
    expect(redirectTo(await reqAs("/sifremi-unuttum", "staff"))).toBeNull();
  });

  it("oturum YOKKEN /sifremi-unuttum hâlâ public (giriş sayfasına yollanmaz)", async () => {
    expect(redirectTo(await reqAs("/sifremi-unuttum", null))).toBeNull();
  });

  // ── Değişikliğin DAR olduğunun pini ────────────────────────────────────────
  it.each(["/login", "/register"])(
    "oturum AÇIKKEN %s HÂLÂ /dashboard'a yönlendirilir (dokunulmadı)",
    async (path) => {
      expect(redirectTo(await reqAs(path, "owner"))).toBe("/dashboard");
    },
  );

  // ── VDP: oturumsuz araştırmacı politikayı OKUYABİLMELİ ────────────────────
  // `security.txt`'in `Policy` alanı buraya işaret ediyor. `/guvenlik`
  // `PUBLIC_PREFIXES`'ten düşerse dış araştırmacı `/login`'e yönlendirilir ve
  // politika tam da hedef kitlesine kapanır — yayımlanmış `Policy` bağlantısı
  // ölü bağlantıya döner.
  //
  // ⚠️ Bu DAVRANIŞSAL pin, `security-txt.test.ts`'teki kaynak taramasının
  // yerine geçer değil ONU TAMAMLAR: kaynak taraması dizenin varlığını görür,
  // bu test yönlendirmenin gerçekten olmadığını ölçer. (Canlı doğrulama da
  // yapıldı: taze build'de `/guvenlik` → 200, `/dashboard` → 307.)
  it("oturum YOKKEN /guvenlik (VDP) yönlendirilmez", async () => {
    expect(redirectTo(await reqAs("/guvenlik", null))).toBeNull();
  });

  it("oturum AÇIKKEN de /guvenlik açılır (panele kaçırılmaz)", async () => {
    expect(redirectTo(await reqAs("/guvenlik", "owner"))).toBeNull();
    // Temizlikçi de bir açık bildirebilir; staff `/tasks`'e kaçırılmamalı.
    expect(redirectTo(await reqAs("/guvenlik", "staff"))).toBeNull();
  });

  // ── Çevredeki kuralların bozulmadığının pini ──────────────────────────────
  it("oturum YOKKEN korumalı sayfa hâlâ /login'e yönlendirilir", async () => {
    expect(redirectTo(await reqAs("/dashboard", null))).toBe("/login");
  });

  it("staff korumalı sayfada hâlâ /tasks'e yönlendirilir", async () => {
    expect(redirectTo(await reqAs("/inbox", "staff"))).toBe("/tasks");
  });
});
