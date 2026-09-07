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

  it("KONTROL: adaptör gerçekten istemciyi çağırıyor (pin kendini boşa düşürmesin)", () => {
    const c = code(read(ADAPTER));
    expect(c).toMatch(/from\s+["']@\/lib\/hospitable["']/);
    expect(c).toMatch(/sendMessage\(destination\.externalReservationId, body, credential\.token, \{ retries: 0 \}\)/);
  });
});
