import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";

// G11 (kurucu kararı 10-13 "Raporlansın"): yakalanmayan istek hatası Sentry + kısıtlı uyarı e-postasına gider.
// reportError taklit edilir — bu dosya KARARI ve iletiyi sınar (gerçek raporlayıcının kendi testleri ayrı).
const reportErrorMock = vi.fn(async (_context: string, _err: unknown) => ({ notified: false, throttled: false, configured: false }));
vi.mock("@/lib/report-error", () => ({ reportError: (c: string, e: unknown) => reportErrorMock(c, e) }));

import {
  UNCAUGHT_REQUEST_CONTEXT,
  reportUncaughtRequestError,
  requestErrorLabel,
  shouldReportRequestError,
} from "@/lib/request-error-report";
import { onRequestError } from "@/instrumentation";

const withDigest = (digest: string) => Object.assign(new Error(digest), { digest });
const named = (name: string) => Object.assign(new Error("x"), { name });

beforeEach(() => reportErrorMock.mockClear());

describe("shouldReportRequestError — akış kontrolü rapor değildir, gerisi raporlanır", () => {
  it.each([
    ["yönlendirme", withDigest("NEXT_REDIRECT;replace;/login;307;")],
    ["bulunamadı (eski)", withDigest("NEXT_NOT_FOUND")],
    ["bulunamadı (15)", withDigest("NEXT_HTTP_ERROR_FALLBACK;404")],
    ["dinamik kullanım", withDigest("DYNAMIC_SERVER_USAGE")],
    ["istemci çizimine düşme", withDigest("BAILOUT_TO_CLIENT_SIDE_RENDERING")],
    ["istemci iptali", named("AbortError")],
    ["yanıt iptali", named("ResponseAborted")],
  ])("%s → raporlanmaz", (_label, err) => {
    expect(shouldReportRequestError(err)).toBe(false);
  });

  it.each([
    ["sıradan hata", new Error("boom")],
    ["tür hatası", new TypeError("cannot read properties of undefined")],
    ["React digest'i (sayısal)", withDigest("2338785109")],
    ["NEXT_ ile BAŞLAMAYAN ama içeren digest", withDigest("MY_NEXT_REDIRECT")],
    ["Error olmayan fırlatma", "string thrown"],
    ["null", null],
  ])("%s → raporlanır (şüphede raporla)", (_label, err) => {
    expect(shouldReportRequestError(err)).toBe(true);
  });
});

describe("requestErrorLabel — yalnız şablon, yöntem, tür", () => {
  it("rota şablonu + yöntem + tür", () => {
    expect(requestErrorLabel({ method: "POST" }, { routePath: "/api/guest-chats/[id]/reply", routeType: "route" })).toBe(
      "POST /api/guest-chats/[id]/reply · route",
    );
    expect(requestErrorLabel({ method: "GET" }, { routePath: "/(app)/inbox/[id]", routeType: "render", renderSource: "server-rendering" })).toBe(
      "GET /(app)/inbox/[id] · render/server-rendering",
    );
  });

  it("beklenmeyen biçim gerçek değeri taşımaz → '?'", () => {
    expect(requestErrorLabel({ method: "post; drop" }, { routePath: "/api/calendar/abc?token=secret value" })).toBe("? ?");
    expect(requestErrorLabel(undefined, undefined)).toBe("? ?");
    expect(requestErrorLabel({ method: "GET" }, { routePath: "api/no-leading-slash" })).toBe("GET ?");
    expect(requestErrorLabel({ method: "GET" }, { routePath: "/x", routeType: "Route<script>" })).toBe("GET /x");
  });
});

describe("reportUncaughtRequestError — rapor", () => {
  it("TEK kova bağlamı + iletide rota şablonu; gerçek yol HİÇBİR YERDE yok", async () => {
    const realPath = "/api/calendar/cal_9f8e7d6c5b4a3?x=1";
    await reportUncaughtRequestError(
      new Error("db timeout"),
      { method: "GET", path: realPath } as { method: string },
      { routePath: "/api/calendar/[token]", routeType: "route" },
    );
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const [context, err] = reportErrorMock.mock.calls[0];
    expect(context).toBe(UNCAUGHT_REQUEST_CONTEXT);
    expect(context).toBe("uncaught-request");
    const e = err as Error;
    expect(e.message).toBe("Error: db timeout [GET /api/calendar/[token] · route]");
    expect(JSON.stringify({ m: e.message, s: e.stack })).not.toContain("cal_9f8e7d6c5b4a3");
  });

  it("özgün yığın çerçeveleri taşınır (Sentry'de hata yeri)", async () => {
    const original = new Error("boom");
    await reportUncaughtRequestError(original, { method: "GET" }, { routePath: "/x" });
    const e = reportErrorMock.mock.calls[0][1] as Error;
    const originalFrames = original.stack!.split("\n").filter((l) => /^\s+at /.test(l));
    expect(originalFrames.length).toBeGreaterThan(0);
    expect(e.stack).toContain(originalFrames[0]);
    expect(e.stack!.split("\n")[0]).toBe(`Error: ${e.message}`);
  });

  it("Prisma hatası: argüman ağacı (misafir metni) iletiye GİRMEZ, yalnız yapısal özet", async () => {
    const prismaErr = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed. Failing row contains (Ayse Yilmaz, kapi kodu 4821)',
      { code: "P2002", clientVersion: "6.0.0", meta: { modelName: "Message" } },
    );
    await reportUncaughtRequestError(prismaErr, { method: "POST" }, { routePath: "/api/x" });
    const e = reportErrorMock.mock.calls[0][1] as Error;
    expect(e.message).toContain("P2002");
    expect(e.message).not.toContain("Ayse");
    expect(e.message).not.toContain("4821");
  });

  it("akış kontrolü raporlanmaz", async () => {
    await reportUncaughtRequestError(withDigest("NEXT_REDIRECT;push;/login;307;"), { method: "GET" }, { routePath: "/x" });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("raporlayıcı fırlatırsa kanca fırlatmaz", async () => {
    reportErrorMock.mockRejectedValueOnce(new Error("sentry down"));
    await expect(reportUncaughtRequestError(new Error("boom"), { method: "GET" }, { routePath: "/x" })).resolves.toBeUndefined();
  });
});

describe("instrumentation.onRequestError — bağlantı (yalnız Node çalışma zamanı)", () => {
  const original = process.env.NEXT_RUNTIME;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = original;
  });

  it("nodejs → raporlayıcıya gider", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await onRequestError(new Error("boom"), { method: "GET" }, { routePath: "/api/x", routeType: "route" });
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][0]).toBe("uncaught-request");
  });

  it("edge / tanımsız → hiçbir şey yapmaz", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await onRequestError(new Error("boom"), { method: "GET" }, { routePath: "/api/x" });
    delete process.env.NEXT_RUNTIME;
    await onRequestError(new Error("boom"), { method: "GET" }, { routePath: "/api/x" });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("instrumentation.ts raporlayıcıyı STATİK import etmez (edge paketi kırılır — ilk denemenin sebebi)", () => {
    const src = readFileSync(join(process.cwd(), "src/instrumentation.ts"), "utf8");
    const staticImports = src.split("\n").filter((l) => /^\s*import\s/.test(l));
    expect(staticImports.length).toBeGreaterThan(0); // anti-vakum: bugün yaprak modül importları var
    for (const l of staticImports) {
      expect(l).not.toMatch(/report-error|request-error-report|email|prisma|nodemailer/);
    }
    // Dinamik import nodejs dalının içinde.
    expect(src).toMatch(/if \(process\.env\.NEXT_RUNTIME === "nodejs"\) \{\s*const \{ reportUncaughtRequestError \} = await import\("@\/lib\/request-error-report"\);/);
  });
});
