import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// KİRACI KAPSAMI — kaynak-tarama pin testi (robots/(app) fs-drift emsali).
//
// Bugün 80 API rotasının hepsi ya org'a göre kapsanmış ya da bilerek public ve
// kendi kimlik bilgisine sahip. Bu bir DURUM; test onu KURALA çeviriyor: yeni bir
// rota eklendiğinde ya org kapsamı/guard izi taşıyacak ya da aşağıdaki listeye
// GEREKÇESİYLE yazılacak. Yani "org filtresini unutmak" sessiz bir IDOR değil,
// kırmızı bir test olur.
//
// Testin SINIRI dürüstçe söylenmeli: bu bir string taramasıdır. "organizationId
// geçiyor" ile "doğru değişkenle filtreleniyor" aynı şey değil — mantık hatasını
// entegrasyon testleri yakalar (çapraz-org 404 asserte eden ~19 dosya). Buranın
// yakaladığı şey, çok daha sık görülen hata: kapsamı hiç yazmamak.
// ---------------------------------------------------------------------------

const API_DIR = path.resolve(__dirname, "../../src/app/api");

/** Kimliği doğrulanmış/kiracıya bağlı olduğunu gösteren izler. */
const SCOPE_MARKERS = /organizationId|withAuth|withManage|requireSession|requireAuth|isSuperAdmin/;

/**
 * BİLEREK PUBLIC rotalar — her biri kendi kimlik bilgisini/limitini taşır.
 * Buraya ekleme yapmak bir güvenlik kararıdır: gerekçeyi yaz.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "auth/logout/route.ts": "çerezi siler; kimlik gerektirmez",
  "auth/resend-verification/route.ts": "public; enumeration-korumalı generik yanıt + hız limiti",
  "calendar/[token]/route.ts": "yoldaki token'ın KENDİSİ kimlik bilgisi (unguessable, findUnique)",
  "cron/email-outbox/route.ts": "CRON_SECRET + timingSafeEqual",
  "cron/sync/route.ts": "CRON_SECRET + timingSafeEqual",
  "demo/ai/route.ts": "kayıtsız landing demosu; env kapılı + IP/gün limitli",
  "health/route.ts": "public readiness; sır döndürmez",
  "leads/route.ts": "landing formu; YALNIZ POST (listeleme yok) + 5/saat IP limiti",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const routes = walk(API_DIR).map((f) => ({
  rel: path.relative(API_DIR, f).split(path.sep).join("/"),
  src: readFileSync(f, "utf8"),
}));

describe("API rotaları kiracı kapsamı taşır", () => {
  it("tarama gerçekten rota buluyor (test kendini boşa düşürmesin)", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("kapsam/guard izi olmayan HER rota, gerekçeli public listesinde", () => {
    const unscoped = routes.filter((r) => !SCOPE_MARKERS.test(r.src)).map((r) => r.rel);
    expect(unscoped.sort()).toEqual(Object.keys(PUBLIC_BY_DESIGN).sort());
  });

  it("public liste bayatlamasın: listedeki her dosya hâlâ var", () => {
    const existing = new Set(routes.map((r) => r.rel));
    const missing = Object.keys(PUBLIC_BY_DESIGN).filter((rel) => !existing.has(rel));
    expect(missing).toEqual([]);
  });

  it("kaynak/kayıt id'si alan rotalar org'a göre filtreler (token'la korunanlar hariç)", () => {
    // `[id]` bir başkasının satırının id'si olabilir — IDOR tam olarak burada olur.
    const tokenScoped = ["calendar/[token]/route.ts", "chat/[token]/route.ts"];
    const globalByDesign = ["admin/leads/[id]/route.ts"]; // Lead org'a bağlı DEĞİL; superadmin kapılı
    const dynamic = routes.filter(
      (r) => /\[[^\]]+\]/.test(r.rel) && !tokenScoped.includes(r.rel) && !globalByDesign.includes(r.rel),
    );
    expect(dynamic.length).toBeGreaterThan(15);
    const missingOrgFilter = dynamic.filter((r) => !/organizationId/.test(r.src)).map((r) => r.rel);
    expect(missingOrgFilter).toEqual([]);
  });

  it("org'a bağlı olmayan admin rotası superadmin kapılı", () => {
    const src = routes.find((r) => r.rel === "admin/leads/[id]/route.ts")!.src;
    expect(src).toContain("isSuperAdmin");
  });
});
