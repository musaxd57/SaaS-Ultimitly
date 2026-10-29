import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, signSession, type SessionPayload } from "@/lib/auth/session";
import { PRIVATE_APP_PREFIXES, isPrivateAppPath } from "@/lib/private-routes";
import robots from "@/app/robots";

// ---------------------------------------------------------------------------
// 404 + ÖZEL ADRES LİSTESİ (kurucu 10-29 gece): "özel adres listesi kenar çubuğu menüsünden gelmesin; ekran değil HTTP durum kodu
// kontrol edilsin; QR / sıfırlama / doğrulama kendi akışında kalsın; yetki veri / eylem katmanında".
// Önceki durum (ölçüldü, docs/INCELEME-2026-10-28-gece-dongusu.md): oturumsuz ziyaretçinin HER bilinmeyen adresi 307 → /login idi
// (gerçek 404 hiç dönmüyordu; paylaşım görseli /opengraph-image de girişe yönleniyordu). Ara katmanın açık listesi elle yazılmıştı ve
// sayfa ağacına pinli değildi.
//  1. Liste sayfa ağacına İKİ YÖNLÜ pinli: `(app)` altındaki her klasör listede, listedeki her girdi bir `(app)` klasörü.
//  2. `(app)` DIŞINDAKİ her sayfa ara katmanın açık yollarından biri (yeni bir sayfa sınıflanmadan eklenemez).
//  3. Davranış: oturumsuz özel yol → /login (?next ile); oturumsuz bilinmeyen yol → GEÇER (Next gerçek 404 verir); QR / kimlik /
//     yasal sayfalar bugünkü gibi.
// ---------------------------------------------------------------------------

const APP_DIR = join(process.cwd(), "src", "app");

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pageFiles(p));
    else if (name === "page.tsx" || name === "page.ts") out.push(p);
  }
  return out;
}

/** Sayfa dosyasının URL yolu: rota grupları "(…)" düşer, dinamik kesim olduğu gibi kalır. */
function urlOf(file: string): string {
  const segs = relative(APP_DIR, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

async function reqAs(pathname: string, role: SessionPayload["role"] | null) {
  const req = new NextRequest(`https://www.lixusai.com${pathname}`);
  if (role) {
    req.cookies.set(
      SESSION_COOKIE,
      await signSession({ userId: "u1", organizationId: "o1", role, email: "h@example.com", name: "H", sessionEpoch: 0 }),
    );
  }
  return middleware(req);
}
const redirectTo = (res: Response) => {
  if (res.status < 300 || res.status >= 400) return null;
  const loc = res.headers.get("location");
  return loc ? new URL(loc) : null;
};

describe("özel adres listesi = sayfa ağacı (kenar çubuğu değil)", () => {
  const appDirs = readdirSync(join(APP_DIR, "(app)"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `/${d.name}`)
    .sort();

  it("(app) altındaki HER klasör listede ve listedeki her girdi bir (app) klasörü", () => {
    expect(appDirs.length).toBeGreaterThan(10);
    expect([...PRIVATE_APP_PREFIXES].sort()).toEqual(appDirs);
  });

  it("(app) altındaki her sayfa özel sayılır; (app) DIŞINDAKİ her sayfa oturumsuz açılabilir (ara katmanın açık yolları)", async () => {
    const pages = pageFiles(APP_DIR);
    expect(pages.length).toBeGreaterThan(30);
    for (const file of pages) {
      const url = urlOf(file).replace(/\[[^\]]+\]/g, "x");
      const inApp = relative(APP_DIR, file).startsWith(`(app)${sep}`);
      expect(isPrivateAppPath(url), `${url} (${relative(APP_DIR, file)})`).toBe(inApp);
      if (!inApp) expect(redirectTo(await reqAs(url, null)), `${url} oturumsuz açılmalı`).toBeNull();
    }
  });

  it("robots.ts aynı listeyi kapatır (iki ayrı liste ayrışamaz)", () => {
    const disallow = (robots().rules as { disallow: string[] }).disallow;
    for (const p of PRIVATE_APP_PREFIXES) expect(disallow).toContain(p);
  });
});

describe("ara katman — oturumsuz ziyaretçi", () => {
  it.each(["/dashboard", "/inbox/silinmis-kayit", "/properties/abc", "/admin", "/guest-chats/x/misafir-ekrani", "/tasks/new"])(
    "özel yol %s → /login?next=…",
    async (path) => {
      const to = redirectTo(await reqAs(path, null));
      expect(to?.pathname).toBe("/login");
      expect(to?.searchParams.get("next")).toBe(path);
    },
  );

  it.each(["/olmayan-bir-sayfa", "/inboxx", "/dashboardx/y", "/opengraph-image", "/twitter-image"])(
    "bilinmeyen / paylaşım görseli yolu %s → GEÇER (Next gerçek 404 ya da görsel verir; girişe yönlenmez)",
    async (path) => {
      expect(redirectTo(await reqAs(path, null))).toBeNull();
    },
  );

  it.each(["/", "/c/abc", "/sifremi-unuttum", "/e-posta-dogrula", "/uyari-adresi-dogrula", "/gizlilik", "/guvenlik", "/login"])(
    "kendi akışı olan açık yol %s → bugünkü gibi geçer",
    async (path) => {
      expect(redirectTo(await reqAs(path, null))).toBeNull();
    },
  );
});

describe("ara katman — oturum açık (değişmedi)", () => {
  it("personel bilinmeyen yolda da /tasks'e yönlenir (bugünkü kural)", async () => {
    expect(redirectTo(await reqAs("/olmayan-bir-sayfa", "staff"))?.pathname).toBe("/tasks");
  });
  it("sahip bilinmeyen yolda geçer (Next 404)", async () => {
    expect(redirectTo(await reqAs("/olmayan-bir-sayfa", "owner"))).toBeNull();
  });
});
