import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, posix, win32 } from "node:path";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 16 — "tenant isolation her yeni yolda davranışsal test" (kurucu talimatı 09-07). MEKANİK PİN (10-10 gece, Haiku envanteri +
// kodla doğrulama). `api-route-scoping.test.ts` sorgunun org-kapsamlı YAZILDIĞINI yapısal olarak sınar; bu dosya kimlik parçalı
// (`[id]`, `[…]`) HER API rotasının HER HTTP yöntemini, o yöntemi BAŞKA kiracının gerçek kimliğiyle çağıran davranışsal test dosyasına
// bağlar. Yeni dinamik rota / yeni yöntem eşlemesiz eklenirse kırmızı; eşlenen dosya o yöntemi import etmiyorsa kırmızı; listede olup
// artık var olmayan rota kırmızı (bayat eşleme yok). Eşlemenin İÇERİĞİ (dosyanın gerçekten başka kiracıyla çağırdığı) incelemeyle
// doğrulandı — bu pin yalnız bağlantının kaybolmasını / unutulmasını yakalar.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const API = join(ROOT, "src/app/api");

/** Rota (src/app/api altındaki göreli yol, `/route.ts` olmadan) → yöntem → kiracılar arası davranışsal test dosyası. */
const COVERAGE: Record<string, Record<string, string>> = {
  "calendar-sources/[id]": { DELETE: "tests/integration/cross-tenant-handlers-more.test.ts" },
  "calendar-sources/[id]/sync": { POST: "tests/integration/cross-tenant-handlers.test.ts" },
  "conversations/[id]": { PATCH: "tests/integration/cross-tenant-handlers.test.ts", DELETE: "tests/integration/cross-tenant-handlers.test.ts" },
  "conversations/[id]/ai-suggest": { POST: "tests/integration/cross-tenant-handlers.test.ts" },
  "conversations/[id]/commitments": { POST: "tests/integration/guest-commitments.test.ts" },
  "conversations/[id]/commitments/[commitmentId]": { PATCH: "tests/integration/guest-commitments.test.ts" },
  "conversations/[id]/decisions/[decisionId]": { POST: "tests/integration/decision-route.test.ts" },
  "conversations/[id]/decisions/[decisionId]/draft": { POST: "tests/integration/decision-draft-route.test.ts" },
  "conversations/[id]/items/[itemId]": { PATCH: "tests/integration/conversation-items-host-view.test.ts" },
  "conversations/[id]/reply": { POST: "tests/integration/conversations-reply-route.test.ts" },
  "conversations/[id]/translate-message": { POST: "tests/integration/cross-tenant-handlers-more.test.ts" },
  "guest-chats/[id]/reply": { POST: "tests/integration/cross-tenant-handlers-more.test.ts" },
  "guest-chats/[id]/resume-ai": { POST: "tests/integration/guest-chats-resume-route.test.ts" },
  "kb/[id]": { PATCH: "tests/integration/cross-tenant-handlers.test.ts", DELETE: "tests/integration/cross-tenant-handlers-more.test.ts" },
  "kb/[id]/copy": { POST: "tests/integration/cross-tenant-handlers.test.ts" },
  "outbox/[id]/retry": { POST: "tests/integration/outbox-ops.test.ts" },
  // İç not (Y-1 D1): başka işletmenin notu 404 — sahip de yönetici de (internal-notes "kiracı kapsamı" testi; 403 varlığı sızdırırdı).
  "internal-notes/[id]": { DELETE: "tests/integration/internal-notes.test.ts" },
  // İşletme belgesi Faz 1a: başka işletmenin belgesi 404 (licenses-routes "geri çekme" testi).
  "licenses/[id]/withdraw": { POST: "tests/integration/licenses-routes.test.ts" },
  "properties/[id]": {
    GET: "tests/integration/cross-tenant-handlers.test.ts",
    PATCH: "tests/integration/cross-tenant-handlers.test.ts",
    DELETE: "tests/integration/cross-tenant-handlers-more.test.ts",
  },
  "properties/[id]/calendar-sources": { POST: "tests/integration/cross-tenant-handlers-more.test.ts" },
  "properties/[id]/chat": { POST: "tests/integration/property-chat-route.test.ts" },
  "properties/[id]/early-checkin-rule": {
    PUT: "tests/integration/cross-tenant-handlers-more.test.ts",
    DELETE: "tests/integration/cross-tenant-handlers-more.test.ts",
  },
  "properties/[id]/house-rules": { PUT: "tests/integration/house-rules.test.ts" },
  "properties/[id]/default-cleaner": { PUT: "tests/integration/default-cleaner.test.ts" },
  "team-contacts/[id]/binding": { POST: "tests/integration/team-contacts.test.ts", DELETE: "tests/integration/team-contacts.test.ts" },
  "properties/[id]/history-learn": { GET: "tests/integration/history-learn.test.ts", POST: "tests/integration/history-learn.test.ts" },
  "properties/[id]/auto-messages": {
    GET: "tests/integration/auto-messages.test.ts",
    POST: "tests/integration/auto-messages.test.ts",
    PUT: "tests/integration/auto-messages.test.ts",
  },
  "properties/[id]/instructions": { GET: "tests/integration/history-learn.test.ts", POST: "tests/integration/history-learn.test.ts" },
  "properties/[id]/instructions/[instructionId]": { DELETE: "tests/integration/history-learn.test.ts" },
  "properties/[id]/instructions/presets": { PUT: "tests/integration/history-learn.test.ts" },
  "history-learn/drafts/[id]": { PATCH: "tests/integration/history-learn.test.ts" },
  "history-learn/comparisons/[id]": { PATCH: "tests/integration/history-learn-compare.test.ts" },
  "properties/[id]/history-learn/compare": { POST: "tests/integration/history-learn-compare.test.ts" },
  "properties/[id]/nightly-rate": { PUT: "tests/integration/attention-money.test.ts", DELETE: "tests/integration/attention-money.test.ts" },
  "properties/[id]/memory-acknowledge": { POST: "tests/integration/memory-contradictions.test.ts" },
  "properties/[id]/reset-chat": { POST: "tests/integration/property-reset-chat-route.test.ts" },
  "properties/[id]/rotate-ical": { POST: "tests/integration/cross-tenant-handlers.test.ts" },
  "reservations/[id]": { PATCH: "tests/integration/cross-tenant-handlers.test.ts", DELETE: "tests/integration/cross-tenant-handlers.test.ts" },
  "reservations/[id]/chat-pin": { POST: "tests/integration/reservation-chat-pin-route.test.ts", DELETE: "tests/integration/reservation-chat-pin-route.test.ts" },
  "reservations/[id]/erase": { GET: "tests/integration/reservation-erase-route.test.ts", POST: "tests/integration/reservation-erase-route.test.ts" },
  "reservations/[id]/checkin-message": { GET: "tests/integration/checkin-now.test.ts", POST: "tests/integration/checkin-now.test.ts" },
  "reservations/[id]/reactivate": { POST: "tests/integration/reservation-reactivate-route.test.ts" },
  // UA-1 (11-19): başka işletmenin elle girilen kopyası 404, satır yerinde (sahip de yönetici de).
  "reservations/[id]/manual-copy": { DELETE: "tests/integration/reservation-manual-copy-route.test.ts" },
  "storage/photo/[...key]": { GET: "tests/integration/storage-wiring.test.ts" },
  "tasks/[id]": { PATCH: "tests/integration/tasks-route.test.ts", DELETE: "tests/integration/tasks-route.test.ts" },
  // GET (kurucu 11-19 akşam madde 1, tam metin seçilince): başka işletmenin şablonu 404, gövde sızmaz (template-list "seçilince tam metin").
  "templates/[id]": {
    GET: "tests/integration/template-list.test.ts",
    PATCH: "tests/integration/templates-route.test.ts",
    DELETE: "tests/integration/cross-tenant-handlers-more.test.ts",
  },
};

/** Kiracı oturumuyla çalışmayan dinamik rotalar — gerekçeli. */
const EXEMPT_PREFIXES: Record<string, string> = {
  "admin/": "Operatör rotaları tasarım gereği kiracılar ÜSTÜ (allowlist + mfa, `isSuperAdmin`); kapı `api-route-scoping` + admin testlerinde",
  "calendar/[token]": "Anonim takvim beslemesi: kimlik = mülkün gizli belirteci (`icalToken`; oturum / kiracı yok); `ical-feed-rate-limit` + `ics-export`",
  "chat/[token]": "Anonim QR misafir rotası: kimlik = sohbet belirteci + konaklama cihaz bağı (oturum / kiracı yok); guest-chat-* testleri",
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/**
 * Rotanın dışa verdiği HTTP yöntemleri. Doğrudan bildirim (`export const GET` / `export async function GET`) VE dışa aktarma listesi
 * (`export { handler as GET }`, `export { GET } from "…"`) — liste yazımı görülmezse yeni rota sessizce "yöntemsiz" sayılırdı (yanlış yeşil).
 */
function exportedMethodsOf(src: string): string[] {
  const listed = [...src.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((p) => p.trim().split(/\s+/).pop() ?? ""));
  return METHODS.filter((m) => new RegExp(`export\\s+(?:const|let|async\\s+function|function)\\s+${m}\\b`).test(src) || listed.includes(m));
}
const exportedMethods = (file: string) => exportedMethodsOf(readFileSync(file, "utf8"));

/** Test dosyasının o rotadan import ettiği yöntem adları (`PATCH as kbPatch` → PATCH). */
function importedMethods(testFile: string, route: string): Set<string> {
  const src = readFileSync(join(ROOT, testFile), "utf8");
  const escaped = `@/app/api/${route}/route`.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`, "g");
  const names = new Set<string>();
  for (const m of src.matchAll(re)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+/)[0];
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Saf: API köküne göreli rota dosyası yolu → rota anahtarı ("tasks/[id]"). K27-K12 (Codex 11-25): `path.relative` Windows'ta `\\`
 * ayraçlı döner ("tasks\\[id]\\route.ts") — eski satır yalnız `/` arıyordu, kurucunun bilgisayarında beş kontrolden üçü kırmızıydı.
 */
function routeKeyOf(relPath: string): string {
  return relPath.split("\\").join("/").replace(/\/route\.ts$/, "");
}

const dynamicRoutes = routeFiles(API)
  .map((f) => routeKeyOf(relative(API, f)))
  .filter((r) => r.includes("["))
  .sort();

const isExempt = (r: string) => Object.keys(EXEMPT_PREFIXES).some((p) => (p.endsWith("/") ? r.startsWith(p) : r === p));

describe("değişmez 16 — dinamik rotaların kiracılar arası davranışsal test bağlantısı", () => {
  it("ANTİ-VAKUM: rota taraması gerçek rotaları buluyor (boş liste sessizce geçmez)", () => {
    expect(dynamicRoutes.length).toBeGreaterThanOrEqual(30);
    expect(dynamicRoutes).toContain("tasks/[id]");
  });

  it("K27-K12: rota anahtarı yol ayracından bağımsız (Windows `\\` = POSIX `/`)", () => {
    // Gerçek `path.win32` / `path.posix` işlevleriyle: aynı rota iki işletim sisteminde AYNI anahtarı verir.
    expect(routeKeyOf(win32.relative("C:\\repo\\src\\app\\api", "C:\\repo\\src\\app\\api\\tasks\\[id]\\route.ts"))).toBe("tasks/[id]");
    expect(routeKeyOf(posix.relative("/repo/src/app/api", "/repo/src/app/api/tasks/[id]/route.ts"))).toBe("tasks/[id]");
    expect(routeKeyOf("storage\\photo\\[...key]\\route.ts")).toBe("storage/photo/[...key]");
  });

  it("ANTİ-VAKUM (K27-K12): bulunan rota kümesi, aynı yollar Windows ayracıyla yazılsa da BİREBİR aynı", () => {
    const rels = routeFiles(API).map((f) => relative(API, f));
    const asPosix = rels.map((r) => routeKeyOf(r.split("\\").join("/"))).filter((r) => r.includes("[")).sort();
    const asWindows = rels.map((r) => routeKeyOf(r.split("/").join("\\"))).filter((r) => r.includes("[")).sort();
    expect(asWindows).toEqual(asPosix);
    expect(asPosix).toEqual(dynamicRoutes);
    expect(dynamicRoutes.every((r) => !r.includes("\\") && !r.endsWith("route.ts"))).toBe(true);
  });

  it("yöntem okuyucu iki yazımı da görür (bildirim + dışa aktarma listesi); yöntem olmayan adı saymaz", () => {
    expect(exportedMethods(join(API, "tasks/[id]/route.ts")).sort()).toEqual(["DELETE", "PATCH"]);
    expect(exportedMethodsOf('export const GET = withAuth(async () => {});\nexport async function POST() {}').sort()).toEqual(["GET", "POST"]);
    expect(exportedMethodsOf('export { handler as GET, other as DELETE };\nexport { PUT } from "./x";').sort()).toEqual(["DELETE", "GET", "PUT"]);
    expect(exportedMethodsOf("export const dynamic = 'force-dynamic';\nexport const GETTER = 1;\nexport { GETX };")).toEqual([]);
  });

  it("🚨 kiracı oturumlu HER dinamik rotanın HER yöntemi bir kiracılar arası teste eşli", () => {
    const missing: string[] = [];
    for (const r of dynamicRoutes.filter((x) => !isExempt(x))) {
      for (const m of exportedMethods(join(API, r, "route.ts"))) {
        if (!COVERAGE[r]?.[m]) missing.push(`${r} ${m}`);
      }
    }
    expect(missing, "yeni dinamik rota / yöntem: başka kiracının GERÇEK kimliğiyle davranışsal test yazıp COVERAGE'a ekleyin").toEqual([]);
  });

  it("🚨 eşlenen test dosyası var ve o yöntemi O rotadan import ediyor (bağlantı kopmadı)", () => {
    const broken: string[] = [];
    for (const [r, methods] of Object.entries(COVERAGE)) {
      for (const [m, file] of Object.entries(methods)) {
        if (!existsSync(join(ROOT, file))) broken.push(`${r} ${m}: ${file} yok`);
        else if (!importedMethods(file, r).has(m)) broken.push(`${r} ${m}: ${file} bu yöntemi import etmiyor`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("bayat eşleme yok: listedeki her rota ve yöntem gerçekten var; muaf rotalar gerçekten var", () => {
    const stale: string[] = [];
    for (const [r, methods] of Object.entries(COVERAGE)) {
      const file = join(API, r, "route.ts");
      if (!existsSync(file)) {
        stale.push(`${r} (rota yok)`);
        continue;
      }
      const exported = exportedMethods(file);
      for (const m of Object.keys(methods)) if (!exported.includes(m)) stale.push(`${r} ${m} (yöntem yok)`);
    }
    for (const p of Object.keys(EXEMPT_PREFIXES)) {
      expect(dynamicRoutes.some((r) => (p.endsWith("/") ? r.startsWith(p) : r === p)), `muafiyet ${p} hiçbir rotaya uymuyor`).toBe(true);
    }
    expect(stale).toEqual([]);
  });
});
