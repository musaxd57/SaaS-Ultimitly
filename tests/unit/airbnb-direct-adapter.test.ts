import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  dispatchOutbound,
  registerOutboundAdapter,
  __setOutboundAdapterForTest,
} from "@/lib/channels";
import { IngestError } from "@/lib/channels/ingest";
import {
  airbnbDirectIngestAdapter,
  airbnbDirectOutboundAdapter,
  verifyAirbnbDirectWebhook,
} from "@/lib/channels/airbnb-direct/adapter";
import { providerErrorMessage } from "@/lib/provider-errors";

// ---------------------------------------------------------------------------
// AIRBNB DIRECT BOŞ SÖZLEŞME ADAPTÖRÜ — "ilan edildi, uygulanmadı" uyum kiti.
// Mevcut ağ kitleri (outbound/ingest-conformance) canlı sağlayıcı ister; bu kit bir
// adaptörün HİÇBİR koşulda ağa çıkmadığını, sessiz başarı üretmediğini ve kimlik bilgisi
// sızdırmadığını sınar. Ayrıca kaynak pinleri: tahminî uç nokta / ağ modülü / env YOK
// (değişmez 18) ve adaptör hiçbir yere BAĞLI değil.
// ---------------------------------------------------------------------------

const TOKEN = "gizli-token-XYZ-123";
const window = { propertyExternalId: "p1", startDate: "2026-01-01", endDate: "2026-02-01" };

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error("AĞA ÇIKILDI");
  });
  vi.stubGlobal("fetch", fetchSpy);
  // Env fallback'i OLMADIĞININ kanıtı: kurucu yolunun env token'ı dursa bile kullanılmaz.
  vi.stubEnv("HOSPITABLE_API_TOKEN", "env-token-ABC");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __setOutboundAdapterForTest("airbnb_direct" as never, null);
});

describe("gönderim: kapalı başarısız, ağa çıkmaz, fırlatmaz", () => {
  it.each([[TOKEN], [undefined]])("token=%s → definitive_failure, fetch çağrılmaz, metinde token yok", async (token) => {
    const r = await airbnbDirectOutboundAdapter.send(
      { provider: "airbnb_direct", externalReservationId: "r1" },
      "merhaba",
      { provider: "airbnb_direct", token },
    );
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("definitive_failure");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(String(r.error)).not.toContain(TOKEN);
    expect(String(r.error)).not.toContain("env-token-ABC");
  });

  it("dispatch: kayıtlı değil → definitive_failure (fırlatmaz)", async () => {
    const r = await dispatchOutbound(
      { provider: "airbnb_direct" as never, externalReservationId: "r1" },
      "x",
      { provider: "airbnb_direct" as never, token: TOKEN },
    );
    expect(r).toMatchObject({ ok: false, kind: "definitive_failure" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("🚨 yanlışlıkla kaydedilse bile boş yetenek kümesi yüzünden dispatch REDDEDER", async () => {
    __setOutboundAdapterForTest("airbnb_direct" as never, airbnbDirectOutboundAdapter as never);
    const r = await dispatchOutbound(
      { provider: "airbnb_direct" as never, externalReservationId: "r1" },
      "x",
      { provider: "airbnb_direct" as never, token: TOKEN },
    );
    expect(r).toMatchObject({ ok: false, kind: "definitive_failure" });
    expect(String(r.error)).toMatch(/cannot send/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("okuma: tipli `unsupported`, ağa çıkmaz", () => {
  it.each([
    ["listProperties", () => airbnbDirectIngestAdapter.listProperties({ provider: "airbnb_direct", token: TOKEN })],
    ["listReservations", () => airbnbDirectIngestAdapter.listReservations({ provider: "airbnb_direct", token: TOKEN }, window)],
    ["listMessages", () => airbnbDirectIngestAdapter.listMessages({ provider: "airbnb_direct", token: TOKEN }, "r1")],
  ])("%s → IngestError(unsupported, airbnb_direct), statüsüz", async (_name, call) => {
    const err = await call().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).kind).toBe("unsupported");
    expect((err as IngestError).provider).toBe("airbnb_direct");
    expect((err as IngestError).status).toBeUndefined();
    expect((err as IngestError).message).not.toContain(TOKEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("müşteriye 'Hospitable'a ulaşılamıyor' DENMEZ — çağıranın kendi cümlesi", () => {
    const err = new IngestError("airbnb_direct", "unsupported", "x");
    expect(providerErrorMessage(err, "ÇAĞIRANIN CÜMLESİ")).toBe("ÇAĞIRANIN CÜMLESİ");
  });
});

describe("webhook: kabul eden sahte doğrulayıcı YOK", () => {
  it("her istek reddedilir", () => {
    expect(verifyAirbnbDirectWebhook()).toEqual({ ok: false, reason: "not_implemented" });
  });
});

// Derleme zamanı pini: kayıt defteri yalnız CANLI sağlayıcıları kabul eder. Tipler
// gevşerse `@ts-expect-error` kullanılmamış kalır ve `tsc` kırmızı verir. Çağrılmaz.
function _compileTimeRegistrationPin() {
  // @ts-expect-error — airbnb_direct canlı sağlayıcı kümesinde (OutboundProvider) değil
  registerOutboundAdapter(airbnbDirectOutboundAdapter);
}
void _compileTimeRegistrationPin;

// ---- Kaynak pinleri (değişmez 18 + "bağlı değil") ----
const ROOT = path.resolve(__dirname, "../..");
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

const FORBIDDEN: Array<[string, RegExp]> = [
  ["fetch çağrısı", /\bfetch\s*\(/],
  ["ağ modülü", /from\s+["'](node:)?(http|https|net|tls|dns)["']|undici|@\/lib\/net\//],
  ["Hospitable istemcisi / DB", /@\/lib\/hospitable|@\/lib\/db|@prisma\/client/],
  ["ortam değişkeni", /process\.env/],
  ["tahminî uç nokta", /https?:\/\/|["'`]\/v\d+\//],
];

describe("kaynak pinleri", () => {
  const dir = path.join(ROOT, "src/lib/channels/airbnb-direct");
  const files = walk(dir);

  it("anti-vakum: dizinde dosya var ve her yasak kalıp GERÇEK istemcide eşleşiyor", () => {
    expect(files.length).toBeGreaterThan(0);
    const real = readFileSync(path.join(ROOT, "src/lib/hospitable.ts"), "utf8");
    expect(/\bfetch\s*\(/.test(real)).toBe(true);
    expect(/https?:\/\//.test(real)).toBe(true);
  });

  it.each(FORBIDDEN)("airbnb-direct içinde %s YOK", (_label, re) => {
    for (const f of files) expect(re.test(code(readFileSync(f, "utf8"))), path.relative(ROOT, f)).toBe(false);
  });

  it("adaptör hiçbir üretim modülüne BAĞLI değil (index kaydı ya da import yok)", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((f) => !f.startsWith(dir))
      .filter((f) => /airbnb-direct/.test(code(readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
