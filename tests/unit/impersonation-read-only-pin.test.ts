import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// ---------------------------------------------------------------------------
// K8 (kurucu kararı 09-28) MEKANİK PİN: bürünmüşken müşteri hesabında yazma YOK. API'deki her YAZMA işleyicisi (POST / PUT /
// PATCH / DELETE) ya `withAuth` / `withManage` / `withOwner` sarmalından geçer (salt-okuma orada TEK boğazda), ya kendi
// bürünme kontrolünü taşır (`impersonationReadOnly(` / `isImpersonating(` / `session.actorUserId`), ya da aşağıdaki GEREKÇELİ
// listededir. Yeni sarmalayıcısız yazma ucu eklenirse test kırmızı: ya kontrol eklenir ya listeye bilinçli satır yazılır.
// Ayrıca GET olduğu hâlde müşteri verisini toplu indiren / bağlantı yazan uçlar açık kontrol taşır.
// ---------------------------------------------------------------------------

const API_DIR = path.resolve(__dirname, "../../src/app/api");
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WRAPPERS = new Set(["withAuth", "withManage", "withOwner"]);
const printer = ts.createPrinter({ removeComments: true });

/** Oturumsuz / kimlik / operatör paneli uçları — müşteri oturumu ADINA yazmazlar. */
const ALLOWED_WITHOUT_CHECK: Record<string, string> = {
  "account/forgot-password POST": "oturumsuz şifre sıfırlama",
  "alert-email/verify POST": "uyarı adresi onayı (imzalı belirteç = alıcının posta kutusu; oturumdan bağımsız)",
  "auth/login POST": "oturumsuz giriş",
  "auth/logout POST": "çıkış (yalnız çerezi siler)",
  "auth/register POST": "oturumsuz kayıt",
  "auth/resend-verification POST": "oturumsuz doğrulama e-postası",
  "auth/verify-email POST": "e-posta doğrulama (belirteç + parola)",
  "chat/[token] POST": "halka açık QR sohbeti (misafir, belirteçle)",
  "cron/email-outbox POST": "zamanlayıcı (sır)",
  "cron/sync POST": "zamanlayıcı (sır)",
  "csp-report POST": "tarayıcı CSP raporu",
  "demo/ai POST": "halka açık demo",
  "leads POST": "halka açık iletişim formu",
  "webhooks/paddle POST": "ödeme sağlayıcısı (imza)",
  "webhooks/host-channel/whatsapp POST": "mesajlaşma sağlayıcısı web kancası (imza; oturum yok)",
  "admin/exit POST": "bürünmeden çıkış",
  // Operatör paneli yazmaları (müşteri açma, bürünme değiştirme, lead, kalite denetimi, 2FA sıfırlama, deneme istisnası) artık
  // KENDİ kontrolünü taşır — destek görünümünde kapalı, önce çıkış (kurucu kararı 10-11). Listeden bu yüzden çıktılar.
};

type Handler = { key: string; wrapped: boolean; body: string };

/** Next.js rota dosyası (09-28 inceleme: yalnız `route.ts` taranıyordu — `route.tsx` / `route.js` görünmezdi). */
const ROUTE_FILE = /(?:^|\/)route\.(?:ts|tsx|js|jsx|mjs)$/;

function handlersOf(rel: string, text: string): Handler[] {
  const kind = /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : /\.jsx?$|\.mjs$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const dir = rel.replace(ROUTE_FILE, "");
  const out: Handler[] = [];
  // Temiz ayrıştırılamayan dosyada tarayıcının gördüğü uçlar eksik / bozuk olabilir → TANINMAYAN kayıt (kırmızı), sessizce geçmez.
  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
  if (!Array.isArray(parseDiagnostics) || parseDiagnostics.length > 0) out.push({ key: `${dir} !parse`, wrapped: false, body: "" });
  const exported = (n: ts.Node) => (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && exported(st)) {
      out.push({ key: `${dir} ${st.name.text}`, wrapped: false, body: printer.printNode(ts.EmitHint.Unspecified, st, sf) });
    } else if (ts.isVariableStatement(st) && exported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = d.initializer;
        const wrapped = ts.isCallExpression(init) && ts.isIdentifier(init.expression) && WRAPPERS.has(init.expression.text);
        out.push({ key: `${dir} ${d.name.text}`, wrapped, body: printer.printNode(ts.EmitHint.Unspecified, init, sf) });
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) out.push({ key: `${dir} ${el.name.text}`, wrapped: false, body: "" });
    } else if (ts.isExportDeclaration(st) && !st.exportClause) {
      // `export * from "…"`: hangi işleyicinin dışa verildiği görünmez → TANINMAYAN uç (sarmalı değil, kontrolsüz).
      out.push({ key: `${dir} *`, wrapped: false, body: "" });
    }
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const all = walk(API_DIR)
  .map((f) => path.relative(API_DIR, f).split(path.sep).join("/"))
  .filter((rel) => ROUTE_FILE.test(rel))
  .flatMap((rel) => handlersOf(rel, readFileSync(path.join(API_DIR, rel), "utf8")));
const mutating = all.filter((h) => MUTATING.has(h.key.split(" ").pop()!));
const OWN_CHECK = /impersonationReadOnly\(|isImpersonating\(|session\.actorUserId\)/;

describe("K8 — her yazma ucu salt-okunur bürünmeyi uygular", () => {
  it("anti-vakum: ayrıştırıcı yazma uçlarını gerçekten buluyor", () => {
    expect(mutating.length).toBeGreaterThan(60);
    expect(mutating.filter((h) => h.wrapped).length).toBeGreaterThan(40);
  });

  it("🚨 sarmalayıcısız her yazma ucu kendi kontrolünü taşır ya da gerekçeli listededir", () => {
    const offenders = mutating
      .filter((h) => !h.wrapped && !OWN_CHECK.test(h.body) && !(h.key in ALLOWED_WITHOUT_CHECK))
      .map((h) => h.key);
    expect(offenders).toEqual([]);
  });

  it("listede artık var olmayan uç kalmaz (bayat satır yok)", () => {
    const keys = new Set(mutating.map((h) => h.key));
    expect(Object.keys(ALLOWED_WITHOUT_CHECK).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("🚨 GET olsa da müşteri verisini toplu indiren / kanal bağlantısı yazan uçlar açık kontrol taşır", () => {
    // U10 (10-22): veri dışa aktarma artık POST + şifre — açık bürünme kontrolü POST işleyicisinde de şart.
    for (const key of ["account/export POST", "hospitable/oauth/authorize GET", "hospitable/oauth/callback GET"]) {
      const h = all.find((x) => x.key === key);
      expect(h, key).toBeDefined();
      expect(h!.body, key).toMatch(/isImpersonating\(/);
    }
  });

  it("🚨 hiçbir rota dosyası işleyicilerini `export *` ile gizlemez ve her rota dosyası temiz ayrıştırılır", () => {
    expect(all.filter((h) => h.key.endsWith(" *") || h.key.endsWith(" !parse")).map((h) => h.key)).toEqual([]);
  });

  it("tarayıcının kendisi: `export *`, yeniden adlandırılmış dışa verme ve route.tsx görünür (09-28 inceleme)", () => {
    expect(handlersOf("x/route.ts", 'export * from "./impl";').map((h) => h.key)).toEqual(["x *"]);
    expect(handlersOf("x/route.ts", "const h = async () => 1;\nexport { h as POST };").map((h) => [h.key, h.wrapped])).toEqual([["x POST", false]]);
    expect(handlersOf("y/route.tsx", "export const POST = withAuth(async () => 1);").map((h) => [h.key, h.wrapped])).toEqual([["y POST", true]]);
    // JSX taşıyan route.tsx kendi diliyle ayrıştırılır (TS olarak okunsa ayrıştırma hatası → tanınmayan kayıt).
    expect(handlersOf("y/route.tsx", "export const GET = withAuth(async () => <div>a</div>);").map((h) => h.key)).toEqual(["y GET"]);
    expect(handlersOf("z/route.ts", "export const GET = withAuth(async () => <div>a</div>);").map((h) => h.key)).toContain("z !parse");
    expect(ROUTE_FILE.test("a/b/route.tsx") && ROUTE_FILE.test("a/route.js") && !ROUTE_FILE.test("a/router.ts")).toBe(true);
  });

  it("🚨 tek boğaz: `withAuth` salt-okuma kontrolünü uygular", () => {
    const guard = readFileSync(path.resolve(__dirname, "../../src/lib/route-guard.ts"), "utf8");
    expect(guard).toMatch(/impersonationReadOnly\(session, req\.method\)/);
  });
});
