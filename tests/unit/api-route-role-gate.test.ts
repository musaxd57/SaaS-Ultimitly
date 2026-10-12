import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// ---------------------------------------------------------------------------
// ROL KAPISI — MEKANİK PİN (#211 gece güvenlik turu, S1 B3).
//
// `api-route-scoping.test.ts` her rotanın KİRACI kapsamını pinler ama EN AZ ROLÜ pinlemez: bir `withManage` rotası
// `withAuth`a (ya da bir `withOwner` rotası `withManage`e) çevrilse bütün süit yeşil kalıyordu — yani temizlikçi (personel)
// misafir mesajlarını okuyabilir / cevap gönderebilir, yönetici ödeme planını değiştirebilirdi. Bu dosya üç yüzeyi KAPALI
// LİSTEYLE pinler (liste EŞİTLİĞİ: eklemek de çıkarmak da bilinçli karardır):
//   1. Personelin erişebildiği uçlar (`withAuth`) — her birinin personeli KENDİ görevine daraltan satırı da pinli.
//   2. Yalnız SAHİBİN uçları (ödeme, hesap silme / dökümü, misafir verisini silme, kanal bağlantısı).
//   3. Sarmalayıcı KULLANMAYAN uçlar — her biri kendi kapısını taşır; kapının kendisi (ifade) pinli.
// Tarama TypeScript sözdizim ağacı üzerinde, işleyici BAŞINA (dosya başına değil: aynı dosyada iki işleyiciden biri kapıyı
// kaybederse görünür) ve YORUMSUZ yazdırılmış kod üzerinde koşar (yorumdaki "canManage(session)" kapı sayılmaz).
// ---------------------------------------------------------------------------

const API_DIR = path.resolve(__dirname, "../../src/app/api");
const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]);
const GUARDS = { withAuth: "member", withManage: "manage", withOwner: "owner" } as const;
type Gate = (typeof GUARDS)[keyof typeof GUARDS] | "custom" | "unknown";

const printer = ts.createPrinter({ removeComments: true });

type Handler = { key: string; gate: Gate; body: string; file: string };

/** Bir rota dosyasındaki dışa aktarılan HTTP işleyicileri: kapı türü + yorumsuz gövde. */
export function routeHandlers(rel: string, text: string): Handler[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dir = rel.replace(/\/?route\.ts$/, "");
  const file = printer.printFile(sf);
  const out: Handler[] = [];
  const exported = (n: ts.Node) =>
    (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && METHODS.has(st.name.text) && exported(st)) {
      out.push({ key: `${dir} ${st.name.text}`, gate: "custom", body: printer.printNode(ts.EmitHint.Unspecified, st, sf), file });
    } else if (ts.isVariableStatement(st) && exported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !METHODS.has(d.name.text) || !d.initializer) continue;
        const init = d.initializer;
        const body = printer.printNode(ts.EmitHint.Unspecified, init, sf);
        let gate: Gate = "unknown";
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text in GUARDS) {
          gate = GUARDS[init.expression.text as keyof typeof GUARDS];
        } else if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          gate = "custom";
        }
        out.push({ key: `${dir} ${d.name.text}`, gate, body, file });
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      // `export { handler as GET }` — kapısı buradan GÖRÜNMEZ; bilinçli olarak "bilinmiyor" (test kırmızı).
      for (const el of st.exportClause.elements) {
        if (METHODS.has(el.name.text)) out.push({ key: `${dir} ${el.name.text}`, gate: "unknown", body: "", file });
      }
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const handlers = walk(API_DIR)
  .map((f) => path.relative(API_DIR, f).split(path.sep).join("/"))
  .filter((rel) => rel.endsWith("route.ts"))
  .flatMap((rel) => routeHandlers(rel, readFileSync(path.join(API_DIR, rel), "utf8")));
const byKey = new Map(handlers.map((h) => [h.key, h]));

/** Satır içi SAHİP kapısı: erken `forbidden` dönüşü ya da "sahip ya da operatör" koşulu. */
const OWNER_INLINE = [
  /if \(session\.role !== "owner"\)\s*return forbidden\(/,
  /if \(!\(session\.role === "owner" \|\| isSuperAdmin\(session\)\)\)/,
];
const ownerInline = (body: string) => OWNER_INLINE.some((re) => re.test(body));

/** 1. PERSONELİN ERİŞEBİLDİĞİ uçlar (`withAuth`). `scope` = personeli KENDİ görevine / org'una daraltan satır. */
const STAFF_REACHABLE: Record<string, { reason: string; scope: RegExp }> = {
  "tasks GET": {
    reason: "personel yalnız KENDİNE atanmış görevleri görür; başlık/açıklama personel görünümünden (tasks/staff-view.ts)",
    scope: /canManage\(session\) \? \{\} : \{ assignedToId: session\.userId \}/,
  },
  "tasks/[id] PATCH": {
    reason: "personel yalnız kendine atanmış görevin durumunu / notunu / maddesini işaretler",
    scope: /if \(!canManage\(session\) && existing\.assignedToId !== session\.userId\)/,
  },
  "upload POST": {
    reason: "görev fotoğrafı; personel yalnız kendine atanmış göreve yükler",
    scope: /if \(!canManage\(session\) && task\.assignedToId !== session\.userId\)/,
  },
  "storage/photo/[...key] GET": {
    reason: "yalnız bu org'un nesnesi, bir TaskUpdate'in HÂLÂ gösterdiği fotoğraf (F11) ve personel için KENDİNE atanmış görev (K2)",
    scope: /\.\.\.\(canManage\(session\) \? \{\} : \{ assignedToId: session\.userId \}\)/,
  },
};

/** 2. YALNIZ SAHİP. `withOwner` ya da (başka bir kapı önce koşmak zorundaysa) satır içi sahip kontrolü. */
const OWNER_ONLY: Record<string, string> = {
  "billing/consent POST": "ödeme onayı (hukuki kayıt)",
  "billing/checkout-pending POST": "\"ödemeniz işleniyor\" kilidi (ödeme ekranı yalnız sahibe açılır)",
  "billing/plan-change POST": "plan değişikliği (para)",
  "billing/plan-preview POST": "plan değişikliği ön hesabı (tek kullanımlık fiyat belirteci üretir)",
  "billing/portal POST": "ödeme portalı oturumu",
  "account/export GET": "hesabın TÜM verisinin dökümü (KVKK)",
  "account/delete POST": "hesabı kalıcı silme",
  "reservations/[id]/erase GET": "misafir verisini silme ön izlemesi (KVKK)",
  "reservations/[id]/erase POST": "misafir verisini silme (KVKK, geri alınamaz)",
  "hospitable/connect GET": "kanal bağlantısı (kimlik bilgisi)",
  "hospitable/connect POST": "kanal bağlantısı kurma (kimlik bilgisi yazar)",
  "hospitable/connect DELETE": "kanal bağlantısını kaldırma",
  "hospitable/oauth/authorize GET": "kanal OAuth başlatma",
  "hospitable/oauth/callback GET": "kanal OAuth dönüşü (kimlik bilgisi yazar)",
};

const SESSION = /if \(!session\)\s*return unauthorized\(\)/;
const SUPERADMIN = /if \(!isSuperAdmin\(session\)\)\s*return unauthorized\(\)/;
const MANAGE_INLINE = /if \(!canManage\(session\)\)\s*return forbidden\(\)/;

/**
 * 3. SARMALAYICISIZ uçlar. `gate` = işleyicinin gövdesinde (ya da `where: "file"` ise dosyada — işleyici aynı dosyadaki bir
 * yardımcıya devrediyorsa) bulunması ZORUNLU kapı ifadeleri; `null` = kimliksiz uç (korumaları kendi testlerinde: hız
 * sınırı, imza, belirteç).
 */
const SELF_GATED: Record<string, { gate: RegExp[] | null; reason: string; where?: "file" }> = {
  "account/2fa GET": { gate: [SESSION], reason: "kişinin KENDİ 2FA durumu" },
  "account/2fa POST": { gate: [SESSION], reason: "kişinin KENDİ 2FA kurulumu (şifre / kod + günlük tavan)" },
  "account/delete POST": { gate: [SESSION, /if \(session\.actorUserId\)/], reason: "sahip + impersonation'da yasak" },
  "account/password POST": { gate: [SESSION, /if \(session\.actorUserId\)/], reason: "kendi şifresi; impersonation'da yasak" },
  "account/forgot-password POST": { gate: null, reason: "kimliksiz: sıfırlama isteği (hız sınırı + genel yanıt)" },
  "admin/ai-quality GET": { gate: [SESSION, SUPERADMIN], reason: "operatör (kalite konsolu, salt-okuma)" },
  "admin/ai-quality/labels POST": { gate: [SESSION, SUPERADMIN], reason: "operatör (kalite etiketi)" },
  "admin/customers POST": { gate: [SESSION, SUPERADMIN], reason: "operatör" },
  "admin/exit POST": { gate: [/exitImpersonation\(\)/], reason: "yalnız impersonation'dan ÇIKAR (yetki düşürür)" },
  "admin/events GET": { gate: [SESSION, SUPERADMIN], reason: "operatör (takip numarasıyla olay araması; bürünmede yasak, kayıtlı)" },
  "admin/export GET": { gate: [SESSION, SUPERADMIN], reason: "operatör" },
  "admin/impersonate POST": { gate: [SESSION, SUPERADMIN], reason: "operatör" },
  "admin/leads/[id] PATCH": { gate: [SESSION, SUPERADMIN], reason: "operatör" },
  "admin/quality-audit POST": { gate: [SESSION, SUPERADMIN], reason: "operatör" },
  "admin/reset-2fa POST": { gate: [SESSION, SUPERADMIN], reason: "operatör" },
  "admin/trial-identity-exempt POST": { gate: [SESSION, SUPERADMIN], reason: "operatör (deneme istisnası; bürünmede yasak)" },
  "alert-email/verify POST": { gate: null, reason: "kimliksiz: uyarı adresi onayı (imzalı belirteç = alıcının posta kutusu; bayrak kapılı)" },
  "auth/login POST": { gate: null, reason: "kimliksiz: giriş" },
  "auth/logout GET": { gate: null, reason: "kimliksiz: yalnız çerezi siler" },
  "auth/logout POST": { gate: null, reason: "kimliksiz: yalnız çerezi siler" },
  "auth/register POST": { gate: null, reason: "kimliksiz: kayıt" },
  "auth/resend-verification POST": { gate: null, reason: "kimliksiz: genel yanıt + hız sınırı" },
  "auth/verify-email GET": { gate: null, reason: "kimliksiz: doğrulama sayfasına yönlendirme" },
  "auth/verify-email POST": { gate: null, reason: "kimliksiz: belirteç + PAROLA" },
  "calendar/[token] GET": { gate: null, reason: "kimliksiz: yoldaki belirteç kimlik bilgisidir" },
  "chat/[token] GET": { gate: null, reason: "kimliksiz: QR belirteci + cihaz bağı" },
  "chat/[token] POST": { gate: null, reason: "kimliksiz: QR belirteci + cihaz bağı" },
  "cron/email-outbox GET": { gate: [/timingSafeEqual\(a, b\)/, /if \(!authorized\(req\)\)/], reason: "CRON_SECRET", where: "file" },
  "cron/email-outbox POST": { gate: [/timingSafeEqual\(a, b\)/, /if \(!authorized\(req\)\)/], reason: "CRON_SECRET", where: "file" },
  "cron/sync GET": { gate: [/timingSafeEqual\(a, b\)/, /if \(!authorized\(req\)\)/], reason: "CRON_SECRET", where: "file" },
  "cron/sync POST": { gate: [/timingSafeEqual\(a, b\)/, /if \(!authorized\(req\)\)/], reason: "CRON_SECRET", where: "file" },
  "csp-report POST": { gate: null, reason: "kimliksiz: tarayıcı CSP raporu (çerezsiz gelir)" },
  "demo/ai POST": { gate: null, reason: "kimliksiz: landing demosu (env kapılı + IP/gün sınırı)" },
  "guest-chats/[id]/reply POST": { gate: [SESSION, MANAGE_INLINE], reason: "yönetici: QR sohbetine cevap" },
  "guest-chats/[id]/resume-ai POST": { gate: [SESSION, MANAGE_INLINE], reason: "yönetici: QR sohbetinde AI'yı sürdür" },
  "health GET": { gate: null, reason: "kimliksiz: hazır olma yoklaması (sır döndürmez)" },
  "hospitable/connect DELETE": { gate: [SESSION, OWNER_INLINE[1]], reason: "sahip ya da operatör" },
  "hospitable/connect GET": { gate: [SESSION, OWNER_INLINE[1]], reason: "sahip ya da operatör" },
  "hospitable/connect POST": { gate: [SESSION, OWNER_INLINE[1]], reason: "sahip ya da operatör" },
  "hospitable/oauth/authorize GET": { gate: [OWNER_INLINE[1]], reason: "sahip ya da operatör (yönlendirmeli ret)" },
  "hospitable/oauth/callback GET": { gate: [OWNER_INLINE[1]], reason: "sahip ya da operatör (yönlendirmeli ret)" },
  "leads POST": { gate: null, reason: "kimliksiz: landing formu (yalnız POST + IP sınırı)" },
  "webhooks/paddle POST": { gate: [/verifyPaddleSignature\(/], reason: "imzalı ödeme web kancası" },
};

describe("API rol kapısı — kapalı listeler", () => {
  it("tarama gerçekten işleyici buluyor ve her biri tanınan bir biçimde (test kendini boşa düşürmesin)", () => {
    expect(handlers.length).toBeGreaterThan(100);
    for (const gate of ["member", "manage", "owner", "custom"] as const) {
      expect(handlers.filter((h) => h.gate === gate).length, gate).toBeGreaterThan(0);
    }
    // Kapısı görünmeyen biçim (başka dosyadan yeniden dışa aktarma, bilinmeyen sarmalayıcı) KABUL EDİLMEZ.
    expect(handlers.filter((h) => h.gate === "unknown").map((h) => h.key)).toEqual([]);
    expect(new Set(handlers.map((h) => h.key)).size).toBe(handlers.length);
  });

  it("🚨 personelin erişebildiği uçlar (withAuth) TAM bu liste — yeni bir uç bilinçli karar ister", () => {
    const member = handlers.filter((h) => h.gate === "member").map((h) => h.key);
    expect(member.sort()).toEqual(Object.keys(STAFF_REACHABLE).sort());
  });

  it("🚨 personel ucunun personeli daraltan satırı yerinde", () => {
    for (const [key, { scope }] of Object.entries(STAFF_REACHABLE)) {
      const h = byKey.get(key);
      expect(h, key).toBeTruthy();
      expect(scope.test(h!.body), `${key}: ${scope}`).toBe(true);
    }
  });

  it("🚨 yalnız sahibin uçları sahip kapılı — ve sahip kapılı her uç listede", () => {
    const observed = handlers.filter((h) => h.gate === "owner" || ownerInline(h.body)).map((h) => h.key);
    expect(observed.sort()).toEqual(Object.keys(OWNER_ONLY).sort());
    // Satır içi sahip kontrolü YALNIZ yönetici kapısının ya da kendi kapısının ARDINDA olabilir (personel ucunda değil).
    for (const key of Object.keys(OWNER_ONLY)) expect(byKey.get(key)?.gate, key).not.toBe("member");
  });

  it("🚨 sarmalayıcısız her uç listede ve kendi kapısını taşıyor", () => {
    const custom = handlers.filter((h) => h.gate === "custom").map((h) => h.key);
    expect(custom.sort()).toEqual(Object.keys(SELF_GATED).sort());
    for (const [key, { gate, where }] of Object.entries(SELF_GATED)) {
      if (!gate) continue;
      const h = byKey.get(key)!;
      const text = where === "file" ? h.file : h.body;
      for (const re of gate) expect(re.test(text), `${key}: ${re}`).toBe(true);
    }
  });
});

describe("tarayıcının kendisi (mekanik pin sahte güven vermesin)", () => {
  const route = (src: string) => routeHandlers("x/route.ts", src);

  it("sarmalayıcı türü doğru okunur; yorumdaki kapı kapı sayılmaz", () => {
    const src = `
      export const GET = withAuth(async (session) => jsonOk({}));
      export const POST = withManage(async (session) => jsonOk({}));
      export const PATCH = withOwner(async (session) => jsonOk({}));
      export async function DELETE() {
        const session = await requireSession();
        // if (!canManage(session)) return forbidden();
        return jsonOk({});
      }`;
    const hs = route(src);
    expect(hs.map((h) => `${h.key}:${h.gate}`)).toEqual(["x GET:member", "x POST:manage", "x PATCH:owner", "x DELETE:custom"]);
    expect(MANAGE_INLINE.test(hs[3].body)).toBe(false);
    expect(MANAGE_INLINE.test(hs[3].body.replace("return jsonOk", "if (!canManage(session)) return forbidden(); return jsonOk"))).toBe(true);
  });

  it("kapısı görünmeyen biçimler 'bilinmiyor' olur (sessizce geçmez)", () => {
    const hs = route(`
      const handler = withAuth(async () => jsonOk({}));
      export { handler as GET };
      export const POST = someOtherWrapper(async () => jsonOk({}));`);
    expect(hs.map((h) => `${h.key}:${h.gate}`)).toEqual(["x GET:unknown", "x POST:unknown"]);
  });

  it("aynı dosyada iki işleyici: kapı işleyici BAŞINA okunur", () => {
    const hs = route(`
      export async function GET() { const session = await requireSession(); if (!session) return unauthorized(); if (!isSuperAdmin(session)) return unauthorized(); return jsonOk({}); }
      export async function POST() { const session = await requireSession(); if (!session) return unauthorized(); return jsonOk({}); }`);
    expect(SUPERADMIN.test(hs[0].body)).toBe(true);
    expect(SUPERADMIN.test(hs[1].body)).toBe(false);
  });
});
