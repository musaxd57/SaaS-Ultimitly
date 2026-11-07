import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// MİMARİ PİN — ÇEKİRDEK, SAĞLAYICI İSTEMCİSİNİ DOĞRUDAN ÇAĞIRMAZ (V0.1)
//
// Envanter (docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md §1c, kod-doğrulandı):
// `sendOnChannel` `ChannelTarget.channel`'ı alıp hiç okumuyor, tek dallanma
// `qr-chat:` öneki, değilse KOŞULSUZ `hospitable.sendMessage`; worker'ın
// `defaultSend`i AYNI varsayımı ikinci kez yazıyor. "Soyutlama var, dispatch yok."
//
// V0.1 sonrası sözleşme (bu dosya pinler; davranışsal kanıt
// `tests/integration/outbound-dispatch.test.ts`):
//   1. Giden-mesaj çekirdeği (`messaging.ts`, `outbox/worker.ts`) `@/lib/hospitable`
//      istemcisini import ETMEZ — yalnız `@/lib/channels` sınırını bilir.
//   2. `sendMessage(` çağrısı src/ altında TEK yerde yaşar: Hospitable adaptörü.
//   3. `qr-chat:` iç-thread kuralı giden yolda TEK yerde (`resolveOutboundRoute`);
//      messaging/worker literal taşımaz.
// ⚠️ Kaynak taraması TEK YÖNLÜDÜR (sözleşme §2) — bu yüzden her pinin
// davranışsal kardeşi var; bu dosya erken uyarıdır, garanti değil.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Yorum satırlarını at (satır başına çapalı — `https://` içindeki `//` korunur). */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const CORE_OUTBOUND = ["src/lib/messaging.ts", "src/lib/outbox/worker.ts"];
const ADAPTER = "src/lib/channels/hospitable-outbound.ts";

describe("V0.1 — giden-mesaj çekirdeği sağlayıcıdan bağımsız", () => {
  it("🚨 messaging.ts ve outbox/worker.ts `@/lib/hospitable` istemcisini import etmez", () => {
    for (const rel of CORE_OUTBOUND) {
      const c = code(read(rel));
      expect(c, rel).not.toMatch(/from\s+["']@\/lib\/hospitable["']/);
      // Sınırı bilir:
      expect(c, rel).toMatch(/from\s+["']@\/lib\/channels["']/);
    }
  });

  it("🚨 `sendMessage(` çağrısı src/ altında YALNIZ Hospitable adaptöründe", () => {
    const files = [...walk(path.join(ROOT, "src/lib")), ...walk(path.join(ROOT, "src/app"))];
    const callers: string[] = [];
    for (const abs of files) {
      const rel = path.relative(ROOT, abs);
      const c = code(readFileSync(abs, "utf8"));
      // Tanımın kendisi (`export async function sendMessage(`) sayılmaz.
      const calls = c.replace(/export async function sendMessage\(/g, "").match(/\bsendMessage\(/g) ?? [];
      if (calls.length > 0) callers.push(rel);
    }
    expect(callers.sort()).toEqual([ADAPTER]);
  });

  it("🚨 `qr-chat:` iç-thread kuralı giden çekirdekte literal olarak YOK (tek kaynak: resolveOutboundRoute)", () => {
    for (const rel of CORE_OUTBOUND) {
      expect(code(read(rel)), rel).not.toContain("qr-chat:");
    }
    const outbound = code(read("src/lib/channels/outbound.ts"));
    expect(outbound).toContain('INTERNAL_THREAD_PREFIX = "qr-chat:"');
    expect(outbound).toMatch(/startsWith\(INTERNAL_THREAD_PREFIX\)/);
  });

  it("🚨 V0.6: sağlayıcı OKUMA fonksiyonları (listProperties/listReservations/listMessages) src/ altında YALNIZ ingest adaptöründe (+ sağlayıcı-adlı operatör teşhis rotası)", () => {
    // Çekirdek (hospitable-sync, ingest write service, cleanup, automation) sağlayıcı
    // payload'ını görmez: okuma `channels/hospitable-ingest.ts` üzerinden canonical'a çevrilir.
    // Tek istisna: `api/hospitable/diagnostics` — adı üstünde sağlayıcı-özel operatör yüzeyi.
    const ALLOWED = new Set(["src/lib/channels/hospitable-ingest.ts", "src/app/api/hospitable/diagnostics/route.ts"]);
    const offenders: string[] = [];
    for (const abs of walk(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, abs);
      if (rel === "src/lib/hospitable.ts" || ALLOWED.has(rel)) continue;
      const c = code(read(rel));
      if (/import\s*\{[^}]*\b(listProperties|listReservations|listMessages)\b[^}]*\}\s*from\s*["']@\/lib\/hospitable["']/.test(c)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    // Kontrol: adaptör gerçekten istemciyi çağırıyor.
    const adapter = code(read("src/lib/channels/hospitable-ingest.ts"));
    expect(adapter).toMatch(/hospitableListReservations\(/);
    expect(adapter).toMatch(/hospitableListMessages\(/);
    // Ve write service çekirdeği sağlayıcı istemcisini import etmez.
    expect(code(read("src/lib/ingest/write-service.ts"))).not.toMatch(/from\s+["']@\/lib\/hospitable["']/);
  });

  it("🚨 V1: intelligence bounded context'i sağlayıcı modülü import etmez ve `hospitable*` alanı okumaz (değişmez 1/20)", () => {
    const files = walk(path.join(ROOT, "src/modules/intelligence")).map((p) => path.relative(ROOT, p));
    expect(files.length).toBeGreaterThan(3);
    for (const rel of files) {
      const c = code(read(rel));
      expect(c, rel).not.toMatch(/from\s+["']@\/lib\/hospitable(-[a-z-]+)?["']/);
      expect(c, rel).not.toMatch(/from\s+["']@\/lib\/channels\/hospitable-/);
      expect(c, rel).not.toMatch(/hospitable(TokenEnc|RefreshTokenEnc|Label|ConnectedAt|Id)\b/);
    }
  });

  it("🚨 V1 ürün akışı: IngestEvent'in TEK yazıcısı ingest/events.ts (+ write-service toplu mesaj); iCal · elle dosya · QR aynı sözleşmeyi çağırır (yapay olay üreten başka yazıcı yok)", () => {
    const files = walk(path.join(ROOT, "src")).map((p) => path.relative(ROOT, p));
    const writers = files.filter((rel) => /ingestEvent\.create(Many)?\(/.test(code(read(rel)))).sort();
    expect(writers).toEqual(["src/lib/ingest/events.ts", "src/lib/ingest/write-service.ts"]);
    for (const rel of ["src/lib/import/sync.ts", "src/app/api/reservations/import/route.ts", "src/app/api/chat/[token]/route.ts"]) {
      expect(code(read(rel)), rel).toMatch(/recordIngestEvent\(/);
    }
    // Sözleşme sağlayıcı modülü bilmez.
    const c = code(read("src/lib/ingest/events.ts"));
    expect(c).not.toMatch(/from\s+["']@\/lib\/hospitable/);
  });

  it("🚨 V0.8: sağlayıcı modülleri src/ altında YALNIZ entegrasyon sınırından import edilir (değişmez 1 / 4 / 9 / 20)", () => {
    // Sağlayıcı modülü = `@/lib/hospitable`, `@/lib/hospitable-*`, `@/lib/channels/hospitable-*` (göreli yazımlar dahil,
    // dinamik `import()` dahil). Çekirdek, panel sayfaları ve otomasyon kimlik bilgisini / bağlantı durumunu
    // `@/lib/channels` sınırından alır (`resolveOrgChannelCredential` · `handleOutboundCredentialRejected` ·
    // `hasMessagingConnection`). İzin listesi GEREKÇELİDİR; yeni satır eklemek bilinçli bir mimari karardır.
    const ALLOWED: Record<string, string> = {
      "src/lib/channels/index.ts": "adaptör / çözücü kaydı (Channel Layer giriş noktası)",
      "src/components/settings/hospitable-connect-card.tsx": "sağlayıcının kendi bağlantı kartı (yalnız tip)",
      "src/app/(app)/settings/page.tsx":
        "köprünün KENDİ bağlantı kartı (sağlayıcıya özgü arayüz: etiket, iptal nedeni, env fallback durumu, OAuth yapılandırması) — çekirdek mantık değil; sınırın bilinçli istisnası",
      "src/lib/scheduled-sync.ts": "köprünün yoklayıcısını çağıran zamanlayıcı — V0 kalanı: yoklayıcı kaydı (YOL-PLANI-DURUM §2d)",
    };
    // Sağlayıcı modülleri DOSYA olarak tanımlanır; her import yolu ÇÖZÜLÜR (`@/` takma adı, göreli yol, uzantı,
    // `index`) — inceleme 10-09: düzenli ifade `import "x"` (yan etki), `require("x")`, `../../lib/hospitable` ve rakamlı
    // ad (`hospitable-v2`) yazımlarını kaçırıyordu. Airbnb Direct adaptörü de sağlayıcı modülüdür.
    const isProviderModule = (rel: string) =>
      /^src\/lib\/hospitable(-[a-z0-9-]+)?\.tsx?$/.test(rel) ||
      /^src\/lib\/channels\/hospitable-[a-z0-9-]+\.tsx?$/.test(rel) ||
      rel.startsWith("src/lib/channels/airbnb-direct/");
    const isProviderOwned = (rel: string) => isProviderModule(rel) || rel.startsWith("src/app/api/hospitable/");
    const allFiles = walk(path.join(ROOT, "src")).map((abs) => path.relative(ROOT, abs));
    const providerModules = new Set(allFiles.filter(isProviderModule));
    const fileSet = new Set(allFiles);
    const resolveSpec = (fromRel: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
      else if (spec.startsWith(".")) base = path.join(path.dirname(fromRel), spec);
      else return null; // paket
      base = base.split(path.sep).join("/");
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (fileSet.has(cand)) return cand;
      return null;
    };
    const specsOf = (src: string): string[] =>
      [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"'\n]+)["']/g)].map((m) => m[1]);
    // Çıkarıcının kendisi: bütün yazımları görür (anti-vakum).
    expect(specsOf('import "@/lib/a"; const b = require("../b"); import t from \'./c\'; export { d } from "@/d"; await import("@/e");')).toEqual(
      ["@/lib/a", "../b", "./c", "@/d", "@/e"],
    );
    const importers: string[] = [];
    const offenders: string[] = [];
    for (const rel of allFiles) {
      const hits = specsOf(code(read(rel))).map((sp) => resolveSpec(rel, sp)).filter((r): r is string => r !== null && providerModules.has(r));
      if (hits.length === 0) continue;
      importers.push(rel);
      if (!isProviderOwned(rel) && !(rel in ALLOWED)) offenders.push(rel);
    }
    expect(offenders.sort()).toEqual([]);
    // Anti-vakum: tarayıcı bilinen köprü importlarını GERÇEKTEN görüyor ve izin listesi ölü satır taşımıyor.
    expect(importers).toContain("src/lib/channels/hospitable-access.ts");
    expect(importers).toContain("src/lib/channels/hospitable-outbound.ts");
    expect(resolveSpec("src/lib/x/y.ts", "../../lib/hospitable")).toBe("src/lib/hospitable.ts");
    for (const rel of Object.keys(ALLOWED)) expect(importers, `ölü izin satırı: ${rel}`).toContain(rel);
  });

  it("🚨 V0.8: kimlik bilgisini kullanan çekirdek yollar sınırdan alır (bağlantı davranışsal kardeşi: channel-access.test.ts)", () => {
    for (const rel of ["src/lib/automation.ts", "src/lib/host-send.ts", "src/lib/outbox/worker.ts", "src/lib/reservations-cleanup.ts"]) {
      const c = code(read(rel));
      expect(c, rel).toMatch(/resolveOrgChannelCredential\(/);
      expect(c, rel).not.toMatch(/getOrgHospitableToken|handleProviderAuthFailure/);
    }
    expect(code(read("src/lib/outbox/worker.ts"))).toMatch(/handleOutboundCredentialRejected\(/);
  });

  it("🚨 V0.9 (değişmez 20): kanal / platform DİZESİNDEN yetenek çıkarımı YALNIZ Channel Layer'da (`channels/capability.ts`)", () => {
    // Yasak (channels/ dışında): kanal ya da platform değerini bir OTA / sağlayıcı etiketiyle KARŞILAŞTIRMAK
    // (`channel === "airbnb"`, `"booking" !== r.platform`) ve kanal alanına SABİT liste süzgeci yazmak
    // (`channel: { notIn: [...] }` / `{ in: [...] }`). "Bu rezervasyona mesaj gidebilir mi" sorusunun tek cevabı
    // `PROVIDER_MESSAGEABLE_RESERVATION_WHERE` / `reservationMessagingCapable`; Airbnb Direct girince etiket değil bağlantı
    // yeteneği karar verir. İZİNLİ (yetenek değil): QR iç konuşması `channel: "chat"` (yüzey ayrımı, sağlayıcı değil) ve
    // dosya / elle giriş sahipliği `ics` / `manual` (değişmez 6: sahiplik işaretçisi).
    const LABELS = "airbnb|booking|vrbo|expedia|direct|whatsapp|email";
    const CMP = new RegExp(
      `\\b\\w*(?:channel|platform)\\w*\\s*(?:===|!==|==|!=)\\s*["'](?:${LABELS})["']|["'](?:${LABELS})["']\\s*(?:===|!==|==|!=)\\s*[\\w.?]*(?:channel|platform)\\b`,
      "i",
    );
    const LIST_FILTER = /\bchannel\s*:\s*\{\s*(?:notIn|in)\s*:\s*\[/;
    const offenders: string[] = [];
    for (const abs of walk(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, abs);
      if (rel.startsWith("src/lib/channels/")) continue;
      const c = code(read(rel));
      if (CMP.test(c) || LIST_FILTER.test(c)) offenders.push(rel);
    }
    expect(offenders.sort()).toEqual([]);
    // Anti-vakum: aynı kalıplar tek kaynağı ve köprünün etiket eşlemesini GERÇEKTEN yakalıyor.
    expect(LIST_FILTER.test(code(read("src/lib/channels/capability.ts")))).toBe(true);
    expect(CMP.test('if (r.platform === "airbnb") send();')).toBe(true);
    expect(CMP.test('if ("booking" !== conv.channel) return;')).toBe(true);
    expect(CMP.test('if (issue.validation === "email") return;')).toBe(false); // kanal değil
    expect(CMP.test('if (c.channel === "chat") return;')).toBe(false); // QR yüzeyi izinli
  });

  it("KONTROL: adaptör gerçekten istemciyi çağırıyor (pin kendini boşa düşürmesin)", () => {
    const c = code(read(ADAPTER));
    expect(c).toMatch(/from\s+["']@\/lib\/hospitable["']/);
    expect(c).toMatch(/sendMessage\(destination\.externalReservationId, body, credential\.token, \{ retries: 0 \}\)/);
  });
});
