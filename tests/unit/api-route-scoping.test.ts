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
  "csp-report/route.ts":
    "public: tarayıcı CSP raporu — kimlik EKLENEMEZ (rapor çerezsiz gelir). " +
    "Korumalar gövde/hız tarafında: 8KB tavan + Content-Type kapalı kümesi + " +
    "30/saat IP kovası + İZİN listesiyle alan seçimi + query/fragment atılır + " +
    "log enjeksiyonu temizliği. Ham rapor SAKLANMAZ, `reportError` KULLANILMAZ.",
  "health/route.ts": "public: readiness; sır döndürmez",
  "leads/route.ts": "public: landing formu; YALNIZ POST (listeleme yok) + 5/saat IP limiti",
  "admin/exit/route.ts": "global: impersonation'dan çıkış — operatörün KENDİ oturumunu geri alır",
  "admin/leads/[id]/route.ts": "global: Lead org'a bağlı değil; superadmin kapılı",
  // ↓ ÜÇÜ DE `organizationId` DİZGİSİNİ TAŞIR AMA KAPSAMLI DEĞİLDİR (↓REQUEST_DERIVED_ORG_ID).
  "admin/export/route.ts": "operatör: org id `?orgId=` ile İSTEKTEN gelir; tek yetki isSuperAdmin",
  "admin/impersonate/route.ts": "operatör: org id GÖVDEDEN gelir; tek yetki isSuperAdmin",
  "admin/quality-audit/route.ts": "operatör: org id GÖVDEDEN gelir; tek yetki isSuperAdmin",
};

/**
 * 🚨 KAPSAM ÖLÇÜTÜNÜN ÖLÇÜLMÜŞ YANLIŞ-NEGATİFİ (08-09).
 *
 * Ölçüt düz `/organizationId/` metin taramasıdır ve bu üç rota o dizgiyi TAŞIR —
 * ama değer OTURUMDAN değil İSTEKTEN gelir (`?orgId=` / gövde). Yani ölçütü
 * sağlayan şeyin kendisi kapsamın YOKLUĞUYDU: rotalar "kapsanmış" sayılıyor,
 * gerekçeli listeye girmeleri İSTENMİYOR ve tek yetkilendirme satırları
 * (`isSuperAdmin`) hiçbir yerde pinli değildi.
 *
 * ÖLÇÜLDÜ: `admin/export` + `admin/impersonate` rotalarından o satır (ve artık
 * kullanılmayan import'u) silinip TÜM süit koşuldu → **3254 test YEŞİL**. Yani
 * kimliği doğrulanmış sıradan bir müşteri, başka bir org'un id'sini yazarak o
 * org'un TÜM verisini indirebilir ve oturumunu o org'a devredebilirdi.
 *
 * Buradaki liste ölçütü DARALTIR (rotalar artık "kapsamsız" sayılır → gerekçeli
 * listede olmak ZORUNDALAR) ve ↓"admin rotaları superadmin kapılı" testi gerçek
 * korumayı pinler. Davranışsal pin ayrı dosyada:
 * `tests/integration/admin-superadmin-gate.test.ts`.
 */
const REQUEST_DERIVED_ORG_ID = new Set([
  "admin/export/route.ts",
  "admin/impersonate/route.ts",
  "admin/quality-audit/route.ts",
]);

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

/**
 * KAPSAM ÖLÇÜTÜ — TEK KAYNAK. Hem "her kapsamsız rota listede" testi hem
 * "guard tek başına kapsam sayılmaz" testi bunu kullanır; ölçüt gevşetilirse
 * (ör. `|| /withAuth/` eklenirse) İKİSİ birden görünür olur.
 */
const isOrgScoped = (src: string) => /organizationId/.test(src);

/**
 * ROTA DÜZEYİNDE NİHAİ HÜKÜM. Dizgi VAR ama değeri istemci yazıyorsa kapsam
 * DEĞİLDİR — saf ölçüt bunu bilemez (metin taraması "değer nereden geliyor"
 * sorusunu yanıtlamaz), o yüzden ayrı bir katman.
 */
const routeIsOrgScoped = (r: { rel: string; src: string }) =>
  isOrgScoped(r.src) && !REQUEST_DERIVED_ORG_ID.has(r.rel);

describe("API rotaları kiracı kapsamı taşır", () => {
  it("tarama gerçekten rota buluyor (test kendini boşa düşürmesin)", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("KODDA org kapsamı olmayan HER rota, gerekçeli listede", () => {
    const unscoped = routes.filter((r) => !routeIsOrgScoped(r)).map((r) => r.rel);
    expect(unscoped.sort()).toEqual(Object.keys(NOT_ORG_SCOPED).sort());
  });

  it("guard TEK BAŞINA kapsam sayılmaz — ÖLÇÜT `organizationId`, guard DEĞİL", () => {
    // ⚠️ ESKİ HÂLİ SIFIR ASSERTION ÇALIŞTIRIYORDU (denetim, 08-01). Yalnız
    // "guard var ama org filtresi yok" kümesi üzerinde dönüyordu; o küme BUGÜN
    // BOŞ (gerekçeli listedeki rotaların hiçbiri guard kullanmıyor) → döngü hiç
    // dönmüyor, test hiçbir şey iddia etmeden yeşil geçiyordu. Üstelik küme bir
    // üstteki testin kümesinin ALT KÜMESİ olduğu için bağımsız kapsamı da sıfırdı.
    // Vitest sıfır-assertion'ı hata saymaz → denetimde "bu da kapalı" diye
    // sayılıyordu ama gerçekte hiçbir şey korumuyordu.
    //
    // Yeni hâli ÖLÇÜTÜN KENDİSİNİ sınar: birisi listeyi genişletmek yerine
    // ölçüte `withAuth` eklemeye kalkarsa (yani guard'ı kapsam saymaya
    // başlarsa) bu test kırmızıya döner — sözleşmenin savunduğu şey buydu.
    const guardedButUnscoped = `export const GET = withAuth(async (session) => {
      const rows = await prisma.property.findMany();
      return jsonOk({ rows });
    });`;
    expect(isOrgScoped(guardedButUnscoped)).toBe(false);
    // Aynı rota org filtresi kazanınca kapsamlı SAYILMALI (ölçüt işini yapıyor).
    expect(
      isOrgScoped(
        guardedButUnscoped.replace(
          "findMany()",
          "findMany({ where: { organizationId: session.organizationId } })",
        ),
      ),
    ).toBe(true);

    // Bugün guard taşıyıp org filtresi olmayan GERÇEK bir rota varsa (şu an yok)
    // mutlaka gerekçeli listede olmalı — küme büyürse bu dal da devreye girer.
    const guardOnly = routes.filter(
      (r) => !routeIsOrgScoped(r) && /withAuth|withManage|withOwner/.test(r.src),
    );
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
    expect(dynamic.filter((r) => !routeIsOrgScoped(r)).map((r) => r.rel)).toEqual([]);
  });

  it("istekten org id alan her rota gerekçeli listede de yer alır (iki liste birlikte hareket eder)", () => {
    // Biri güncellenip diğeri unutulursa rota SESSİZCE hiçbir kapıya tabi olmaz:
    // ölçütten muaf ama gerekçesiz. Bu satır o çifti bağlar.
    for (const rel of REQUEST_DERIVED_ORG_ID) expect(NOT_ORG_SCOPED[rel], rel).toBeTruthy();
  });

  it("🚨 HER admin rotası `isSuperAdmin` taşır — `requireSession` kapsam SAYILMAZ", () => {
    // ⚠️ ESKİ HÂLİ İKİ YÖNDEN DE ZAYIFTI (ölçüldü, 08-09):
    //   (1) Yalnız İKİ rotaya bakıyordu (`admin/leads/[id]`, `admin/exit`) — yani
    //       `admin/export` (bir org'un TÜM verisinin dökümü) ve `admin/impersonate`
    //       (müşteri org'una oturum devri) hiçbir yapısal pin taşımıyordu.
    //   (2) Ölçüt `isSuperAdmin|requireSession|requireAuth` ALTERNASYONUYDU →
    //       `requireSession` TEK BAŞINA tatmin ediyordu, yani "operatör kapılı" ile
    //       "sadece oturumlu" ayırt EDİLEMİYORDU. Her admin rotası zaten
    //       `requireSession` çağırıyor; alternasyon fiilen hiçbir şey istemiyordu.
    // Yeni hâli: KAPALI liste + tek kabul edilen dizgi.
    const adminRoutes = routes.filter((r) => r.rel.startsWith("admin/"));
    // Popülasyon guard'ı: glob bozulursa test trivially geçmesin.
    expect(adminRoutes.length).toBeGreaterThanOrEqual(7);

    // TEK istisna. `admin/exit` yetkiyi ARTIRMAZ, DÜŞÜRÜR: operatörü müşteri
    // org'undan kendi kimliğine geri döndürür ve kimliğini imzalı `actorUserId`
    // taşır. Buraya ikinci bir isim eklemek bir GÜVENLİK KARARIDIR.
    const NO_SUPERADMIN_NEEDED: Record<string, string> = {
      "admin/exit/route.ts": "yalnız impersonation'dan ÇIKAR — yetki düşürür, artırmaz",
    };

    const ungated = adminRoutes.filter((r) => !/isSuperAdmin\(/.test(r.src)).map((r) => r.rel);
    expect(ungated.sort()).toEqual(Object.keys(NO_SUPERADMIN_NEEDED).sort());

    // İstisnanın kendisi de bayatlamasın: `exit` gerçekten yalnız çıkış yapıyor mu.
    const exit = routes.find((r) => r.rel === "admin/exit/route.ts")!;
    expect(/exitImpersonation\(/.test(exit.src)).toBe(true);
    expect(/enterOrganization\(|buildOrganizationDataExport\(/.test(exit.src)).toBe(false);
  });

  it("mantık route.ts DIŞINA taşınarak taramadan kaçırılamaz", () => {
    // `src/app/api` altında route.ts dışında dosya YOK. Biri sorguyu yardımcı bir
    // dosyaya taşırsa (kapsam taramasından kaçırmanın en kolay yolu) burası kırmızı
    // olur ve tarama kapsamının genişletilmesi gerektiği görünür.
    const strays = allFiles.filter((rel) => !rel.endsWith("route.ts"));
    expect(strays).toEqual([]);
  });
});
