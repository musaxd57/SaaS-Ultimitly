import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// KİRACI KAPSAMI — kaynak-tarama pin testi (robots/(app) fs-drift emsali).
//
// KURAL: her API rotası ya GERÇEK KODDA `organizationId` ile kapsanır ya da
// aşağıdaki gerekçeli listede yer alır. Guard (withAuth/withManage) TEK BAŞINA
// yeterli SAYILMAZ — çünkü guard yalnız "oturum var mı" der, "bu satır bu
// kiracıya mı ait" demez. Kimliği doğrulanmış bir kullanıcının BAŞKA bir org'un
// kaydını çekmesi (yatay yetki yükseltme) tam olarak bu boşluktan geçer.
//
// Tarama önce YORUMLARI SİLER. Aksi hâlde `// TODO: organizationId filtresi
// eklenecek` satırı testi susturur — ki bunu yazan kişi zaten kapsamı unutan
// kişidir. (İki kural da denetimde MUTASYONLA doğrulandı: yorumdaki kelimeye
// güvenen ve guard'ı kapsam sayan eski sürüm, gerçek bir IDOR rotasını yeşil
// geçiriyordu.)
//
// Testin KALAN sınırı dürüstçe: string taraması "doğru DEĞİŞKENLE mi
// filtreliyor" sorusunu yanıtlamaz. Onu çapraz-org 404 asserte eden ~19
// entegrasyon dosyası yakalar. Bu test, çok daha sık görülen hatayı yakalar:
// kapsamı hiç yazmamak.
// ---------------------------------------------------------------------------

const API_DIR = path.resolve(__dirname, "../../src/app/api");

/** Yorumlar kod sayılmasın: tarama gerçek ifadeler üzerinde koşar. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");
}

/**
 * BİLEREK org-kapsamsız rotalar. Buraya ekleme yapmak bir güvenlik kararıdır:
 * gerekçeyi yaz. İki grup var — public (kendi kimlik bilgisini taşır) ve
 * global (org'a bağlı olmayan veri, superadmin kapılı).
 */
const NOT_ORG_SCOPED: Record<string, string> = {
  "auth/logout/route.ts": "public: yalnız çerezi siler",
  "auth/resend-verification/route.ts": "public: enumeration-korumalı generik yanıt + hız limiti",
  "calendar/[token]/route.ts": "public: yoldaki token'ın KENDİSİ kimlik bilgisi (unguessable, findUnique)",
  "cron/email-outbox/route.ts": "public: CRON_SECRET + timingSafeEqual",
  "cron/sync/route.ts": "public: CRON_SECRET + timingSafeEqual",
  "demo/ai/route.ts": "public: kayıtsız landing demosu; env kapılı + IP/gün limitli",
  "health/route.ts": "public: readiness; sır döndürmez",
  "leads/route.ts": "public: landing formu; YALNIZ POST (listeleme yok) + 5/saat IP limiti",
  "admin/exit/route.ts": "global: impersonation'dan çıkış — operatörün KENDİ oturumunu geri alır",
  "admin/leads/[id]/route.ts": "global: Lead org'a bağlı değil; superadmin kapılı",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const allFiles = walk(API_DIR).map((f) => path.relative(API_DIR, f).split(path.sep).join("/"));
const routes = allFiles
  .filter((rel) => rel.endsWith("/route.ts") || rel === "route.ts")
  .map((rel) => ({ rel, src: stripComments(readFileSync(path.join(API_DIR, rel), "utf8")) }));

describe("API rotaları kiracı kapsamı taşır", () => {
  it("tarama gerçekten rota buluyor (test kendini boşa düşürmesin)", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("KODDA org kapsamı olmayan HER rota, gerekçeli listede", () => {
    const unscoped = routes.filter((r) => !/organizationId/.test(r.src)).map((r) => r.rel);
    expect(unscoped.sort()).toEqual(Object.keys(NOT_ORG_SCOPED).sort());
  });

  it("guard TEK BAŞINA kapsam sayılmaz — org filtresiz kimlikli rota kırmızı olmalı", () => {
    // Sözleşmenin kendisi: yukarıdaki testin ölçütü guard değil `organizationId`.
    // Bu test o ölçütün gevşetilmediğini pinler (bir kişi listeyi genişletmek
    // yerine ölçüte `withAuth` eklemeye kalkarsa görünür olsun).
    const guardOnly = routes.filter(
      (r) => !/organizationId/.test(r.src) && /withAuth|withManage|withOwner/.test(r.src),
    );
    // Böyle bir rota varsa MUTLAKA gerekçeli listede olmalı.
    for (const r of guardOnly) expect(NOT_ORG_SCOPED[r.rel], r.rel).toBeTruthy();
  });

  it("gerekçe listesi bayatlamasın: listedeki her dosya hâlâ var", () => {
    const existing = new Set(routes.map((r) => r.rel));
    expect(Object.keys(NOT_ORG_SCOPED).filter((rel) => !existing.has(rel))).toEqual([]);
  });

  it("kaynak/kayıt id'si alan rotalar org'a göre filtreler (token'la korunanlar hariç)", () => {
    const tokenScoped = ["calendar/[token]/route.ts", "chat/[token]/route.ts"];
    const globalByDesign = ["admin/leads/[id]/route.ts"];
    const dynamic = routes.filter(
      (r) => /\[[^\]]+\]/.test(r.rel) && !tokenScoped.includes(r.rel) && !globalByDesign.includes(r.rel),
    );
    expect(dynamic.length).toBeGreaterThan(15);
    expect(dynamic.filter((r) => !/organizationId/.test(r.src)).map((r) => r.rel)).toEqual([]);
  });

  it("org'a bağlı olmayan admin rotası superadmin kapılı", () => {
    for (const rel of ["admin/leads/[id]/route.ts", "admin/exit/route.ts"]) {
      const r = routes.find((x) => x.rel === rel)!;
      expect(/isSuperAdmin|requireSession|requireAuth/.test(r.src), rel).toBe(true);
    }
  });

  it("mantık route.ts DIŞINA taşınarak taramadan kaçırılamaz", () => {
    // `src/app/api` altında route.ts dışında dosya YOK. Biri sorguyu yardımcı bir
    // dosyaya taşırsa (kapsam taramasından kaçırmanın en kolay yolu) burası kırmızı
    // olur ve tarama kapsamının genişletilmesi gerektiği görünür.
    const strays = allFiles.filter((rel) => !rel.endsWith("route.ts"));
    expect(strays).toEqual([]);
  });
});
