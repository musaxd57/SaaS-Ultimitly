import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// YÖNETİCİ SAYFASI KAPISI (10-11 gece, Haiku incelemesi). Personel yalnız `/tasks` görür; sınır middleware'deydi ve 24 uygulama sayfasının
// 15'i YALNIZ ona dayanıyordu. Artık her uygulama sayfası `requireManagerSession()` (oturum + yönetici değilse `/tasks`) çağırır; istisnalar
// gerekçeli. (1) davranış: personel yönlendirilir, yönetici geçer; (2) büyüyemez kural: yeni sayfa kapısız eklenemez.
// ---------------------------------------------------------------------------

const redirectSpy = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
let session: { role: string; organizationId: string; userId: string } = { role: "owner", organizationId: "o", userId: "u" };
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectSpy(to) }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => session) }));

import { requireManagerSession } from "@/lib/auth/manager-page";

describe("requireManagerSession — davranış", () => {
  // Süslü parantez şart: dönen işlev (casus) vitest'te temizlik kancası sayılır ve çağrılır.
  beforeEach(() => {
    redirectSpy.mockClear();
  });

  it("🚨 personel → /tasks'a yönlendirilir (sayfa verisi okunmaz)", async () => {
    session = { role: "staff", organizationId: "o", userId: "s" };
    await expect(requireManagerSession()).rejects.toThrow("REDIRECT:/tasks");
    expect(redirectSpy).toHaveBeenCalledWith("/tasks");
  });

  it("KONTROL: sahip ve yönetici geçer, oturum döner", async () => {
    for (const role of ["owner", "manager"]) {
      session = { role, organizationId: "o", userId: "u" };
      await expect(requireManagerSession()).resolves.toMatchObject({ role });
    }
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

const APP = join(process.cwd(), "src/app/(app)");
/** Kapıdan muaf sayfalar — gerekçeli. */
const EXEMPT: Record<string, string> = {
  "tasks/page.tsx": "Personelin TEK yüzeyi (middleware tam /tasks'a izin verir); sayfa kendi içinde personel görünümünü uygular (staff-view)",
  "billing/page.tsx": "Yalnız yönlendirme; veri çizmez",
  "admin/page.tsx": "Operatör paneli: kendi kapısı isSuperAdmin (allowlist + mfa); personel middleware'de yönlendirilir",
  "admin/ai-quality/page.tsx": "Operatör kalite konsolu: kendi kapısı isSuperAdmin; personel middleware'de yönlendirilir",
};

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === "page.tsx") out.push(relative(APP, p));
  }
  return out.sort();
}

describe("uygulama sayfaları — büyüyemez kural", () => {
  const all = pages(APP);

  it("ANTİ-VAKUM: tarama gerçek sayfaları buluyor", () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(all).toContain("reports/page.tsx");
  });

  it("🚨 muaf olmayan HER uygulama sayfası requireManagerSession() ile başlar (yeni sayfa kapısız eklenemez)", () => {
    const missing = all.filter((p) => !(p in EXEMPT)).filter((p) => !/await requireManagerSession\(\)/.test(readFileSync(join(APP, p), "utf8")));
    expect(missing, "personel kapısı yok: requireManagerSession() çağırın ya da gerekçeyle EXEMPT'e ekleyin").toEqual([]);
  });

  it("bayat muafiyet yok: listedeki her sayfa gerçekten var", () => {
    for (const p of Object.keys(EXEMPT)) expect(all, p).toContain(p);
  });
});
