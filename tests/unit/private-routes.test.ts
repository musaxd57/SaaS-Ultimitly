import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, signSession, type SessionPayload } from "@/lib/auth/session";
import { AUTH_PATHS, PRIVATE_APP_PREFIXES, PUBLIC_PREFIXES, classifyPath, isPrivateAppPath } from "@/lib/private-routes";
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

// ── 404 tasarım incelemesi (10-29 gece, G1–G4) ─────────────────────────────────────────────────────────────────────────────
// G1: "(app) dışındaki her sayfa oturumsuz açılır" iddiası 313d5edf'ten sonra BOŞ kaldı — bilinmeyen her yol da artık geçiyor, yani
// sınıflanmadan eklenen yeni bir sayfa da yeşil kalıyordu. Şimdi her sayfa AÇIK bir sınıfa düşmek zorunda (`unknown` = kırmızı).
// G2: rota grupları her derinlikte düşer; `(app)` altında dinamik ilk kesim, paralel yuva (`@…`) ve araya girme (`(.)`) klasörü yok.
// G3: `(app)` altında yalnız sayfa / düzen / iskelet / hata / bulunamadı dosyaları: `route.ts` ya da meta rota düzenin oturum kapısını
// atlar (onları yalnız ara katman korurdu).
// G4: açık ve özel listeler kesişmez; her açık girdi en az bir sayfaya karşılık gelir (bayat girdi kalmaz).
describe("yol sınıfları — her sayfa açıkça sınıflı (G1–G4)", () => {
  const pages = pageFiles(APP_DIR);

  it("G1: (app) içindeki her sayfa `private`, DIŞINDAKİ her sayfa `public` — `unknown` sayfa yok", () => {
    for (const file of pages) {
      const url = urlOf(file).replace(/\[[^\]]+\]/g, "x");
      const inApp = relative(APP_DIR, file).startsWith(`(app)${sep}`);
      expect(classifyPath(url), `${url} (${relative(APP_DIR, file)})`).toBe(inApp ? "private" : "public");
    }
    // Anti-vakumluk: sınıflanmamış bir yol gerçekten `unknown` döner.
    expect(classifyPath("/yeni-sinifsiz-sayfa")).toBe("unknown");
  });

  it("G2: (app) altında dinamik ilk kesim, paralel yuva ya da araya girme klasörü yok (önek listesi bunları ifade edemez)", () => {
    const walkDirs = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((e) => [join(d, e.name), ...walkDirs(join(d, e.name))]);
    const appRoot = join(APP_DIR, "(app)");
    const firstSegs = new Set(
      pages
        .filter((f) => relative(APP_DIR, f).startsWith(`(app)${sep}`))
        .map((f) => urlOf(f).split("/")[1])
        .filter(Boolean),
    );
    for (const s of firstSegs) expect(s, `dinamik ilk kesim: ${s}`).not.toMatch(/^\[/);
    for (const d of walkDirs(appRoot)) {
      const name = d.split(sep).pop()!;
      expect(name, d).not.toMatch(/^@|^\(\.{1,3}\)/);
    }
    // Her (app) sayfasının ilk URL kesimi listede (iç içe grup olsa da).
    for (const s of firstSegs) expect(PRIVATE_APP_PREFIXES as readonly string[]).toContain(`/${s}`);
  });

  it("G3: (app) altında yalnız sayfa / düzen / iskelet / hata / bulunamadı dosyaları (rota ve meta rota düzen kapısını atlar)", () => {
    const files = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [e.name]));
    const allowed = new Set(["page.tsx", "layout.tsx", "loading.tsx", "error.tsx", "not-found.tsx"]);
    for (const f of files(join(APP_DIR, "(app)"))) expect(allowed.has(f), f).toBe(true);
  });

  it("G4: açık ve özel listeler kesişmez; her açık girdi en az bir sayfaya karşılık gelir", () => {
    for (const p of PRIVATE_APP_PREFIXES) expect(classifyPath(p), p).toBe("private");
    for (const p of [...AUTH_PATHS, ...PUBLIC_PREFIXES]) {
      expect(isPrivateAppPath(p), p).toBe(false);
      const hit = pages.some((f) => {
        const u = urlOf(f);
        return u === p || u.startsWith(p + "/");
      });
      expect(hit, `${p} hiçbir sayfaya karşılık gelmiyor (bayat girdi)`).toBe(true);
    }
  });
});
