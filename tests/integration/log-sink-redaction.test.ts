import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { inspect } from "node:util";
import { prisma, resetDb } from "../helpers/db";
import { writeAudit } from "@/lib/audit";
import { rateLimit, __resetRateLimit } from "@/lib/rate-limit";
import { recordShadowVerdict } from "@/lib/shadow-ai";
import { __resetReportThrottle } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// F10 (Codex 09-05) — DAVRANIŞSAL: aynı sentetik hassas değer HİÇBİR log çıkışında görünmez, meşru teşhis kodu kalır.
//
// Her yazıcı gerçekten tetiklenir (veritabanı arızası taklidiyle) ve `console.*`a giden HER argüman `util.inspect`
// ile (hata nesnesinin iletisi, yığını ve `cause`u dahil — ham `console.error(err)` tam olarak bunu basar) aranır.
// 🚨 Prisma temsilcisine `vi.spyOn` sonraki testlere sızar → bu dosya AYRI ve her testte geri alınır.
// ---------------------------------------------------------------------------

const PII_EMAIL = "ayse.yilmaz@example.com";
const PII_PHONE = "0555 123 45 67";
const DIAG = "P2002";

function captureConsole() {
  const lines: string[] = [];
  const spies = (["error", "warn", "log", "info"] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 6 }))).join(" "));
    }),
  );
  return { lines, text: () => lines.join("\n"), restore: () => spies.forEach((s) => s.mockRestore()) };
}

const piiError = (prefix: string) =>
  new Error(`${prefix} ${DIAG} Unique constraint failed DETAIL: Key (key)=(login-acct:${PII_EMAIL}) tel ${PII_PHONE}`, {
    cause: new Error(`upstream said ${PII_EMAIL}`),
  });

describe("F10 — log çıkışları merkezî redaksiyondan geçer", () => {
  let cap: ReturnType<typeof captureConsole>;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    __resetReportThrottle();
    cap = captureConsole();
  });
  afterEach(() => {
    cap.restore();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 audit yazılamazsa: ham hata loga girmez; eylem ve teşhis kodu görünür (reportError satırı)", async () => {
    vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(piiError("Invalid invocation:"));
    await writeAudit({ organizationId: "org_x", action: "auth.2fa_reset", metadata: { email: PII_EMAIL } });
    const text = cap.text();
    expect(text).toContain("audit.write:auth.2fa_reset"); // düşüş görünür kalır
    expect(text).toContain(DIAG);
    expect(text).not.toContain(PII_EMAIL);
    expect(text).not.toContain(PII_PHONE);
  });

  it("🚨 hız limiti sayacına ulaşılamazsa: anahtardaki e-posta loga girmez; uyarı ve teşhis kodu görünür", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(piiError("Raw query failed."));
    const verdict = await rateLimit(`login-acct:${PII_EMAIL}`, 5, 60_000);
    expect(verdict.ok).toBe(true); // yerel sayaç devrede (davranış aynı)
    const text = cap.text();
    expect(text).toContain("[rate-limit]");
    expect(text).toContain(DIAG);
    expect(text).not.toContain(PII_EMAIL);
    expect(text).not.toContain(PII_PHONE);

    // Uyarı dakikada bir kısıtlıdır; test yardımcısı kısıtı da sıfırlar (her test kendi uyarısını görebilsin —
    // yoksa aynı dosyada önce koşan bir arıza bu testi SESSİZCE boş geçirirdi).
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(piiError("Raw query failed."));
    await rateLimit(`login-acct:${PII_EMAIL}`, 5, 60_000);
    expect(cap.lines.filter((l) => l.includes("[rate-limit]"))).toHaveLength(1); // kısıt içinde: ikinci uyarı yok
    __resetRateLimit();
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(piiError("Raw query failed."));
    await rateLimit(`login-acct:${PII_EMAIL}`, 5, 60_000);
    expect(cap.lines.filter((l) => l.includes("[rate-limit]"))).toHaveLength(2);
  });

  it("🚨 gölge AI beklenmedik hatası: ham ileti loga girmez", async () => {
    vi.stubEnv("SHADOW_AI_ENABLED", "1");
    vi.stubEnv("SHADOW_AI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(prisma.shadowVerdict, "count").mockRejectedValueOnce(piiError("Invalid count:"));
    await recordShadowVerdict({ organizationId: "org_x", triggerId: "m1", guestMessage: "x", gateDecision: "auto_sent" });
    const text = cap.text();
    expect(text).toContain("[shadow-ai]");
    expect(text).toContain(DIAG);
    expect(text).not.toContain(PII_EMAIL);
    expect(text).not.toContain(PII_PHONE);
  });

  it("🚨 e-posta sağlayıcısı reddederse: gövdedeki alıcı adresi VE telefon loga girmez; HTTP durumu kalır", async () => {
    // Eski dar kopya yalnız e-posta + 6+ haneli sayıyı maskeliyordu (boşluklu telefon sızıyordu); döngüsel import
    // yüzünden merkezî redaksiyonu alamıyordu — yaprak modül (`lib/redact.ts`) bunu çözdü.
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ name: "validation_error", message: `Invalid to ${PII_EMAIL} tel ${PII_PHONE}` }), { status: 422 })),
    );
    const { emailService } = await import("@/lib/email-core");
    await emailService.send("someone@example.org", "Konu", "<p>Gövde</p>");
    const text = cap.text();
    expect(text).toContain("[EmailService] send failed");
    expect(text).toContain("Resend HTTP 422");
    expect(text).not.toContain(PII_EMAIL);
    expect(text).not.toContain(PII_PHONE);
  });

  it("🚨 zamanlayıcı tıkı düşerse: hata iletisi ve cause redakte; kök sebep (cause) teşhis için kalır", async () => {
    const g = globalThis as typeof globalThis & { __guestopsCronStarted?: boolean; __lixusEmailOutboxPollerStarted?: boolean };
    const before = { cron: g.__guestopsCronStarted, outbox: g.__lixusEmailOutboxPollerStarted };
    delete g.__guestopsCronStarted;
    delete g.__lixusEmailOutboxPollerStarted;
    vi.useFakeTimers();
    try {
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "cron-secret-for-test-only");
      vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
      vi.stubEnv("INTERNAL_CRON_DISABLED", "");
      vi.stubGlobal("fetch", vi.fn(async () => { throw piiError("fetch failed"); }));
      const { register } = await import("@/instrumentation");
      await register();
      await vi.advanceTimersByTimeAsync(21_000); // ilk cron tıkı 15 sn, ilk kuyruk tıkı 20 sn
      const text = cap.text();
      expect(text).toContain("[internal-cron] tick failed");
      expect(text).toContain("[email-outbox-poller] tick failed");
      expect(text).toContain("upstream said"); // cause kaybolmaz
      expect(text).not.toContain(PII_EMAIL);
      expect(text).not.toContain(PII_PHONE);
      expect(text).not.toContain("cron-secret-for-test-only");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      g.__guestopsCronStarted = before.cron;
      g.__lixusEmailOutboxPollerStarted = before.outbox;
    }
  });
});
