import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/csp-report/route";

// ---------------------------------------------------------------------------
// CSP RAPOR UCU (P1 #6, 08-09 (2)) — KİMLİKSİZ ve TARAYICI TARAFINDAN ÇAĞRILIR
//
// Kimlik doğrulaması EKLENEMEZ (tarayıcı raporu çerezsiz gönderir), dolayısıyla
// her koruma gövde ve hız tarafındadır. Bu testler o korumaları DAVRANIŞSAL
// olarak tutar.
//
// 🚨 EN ÖNEMLİ İDDİA: ham rapor SAKLANMAZ ve log'a GİRMEZ. Rapor gövdesi oturum
// açmış bir host'un panel URL'ini (`?orgId=`, `?q=<arama>`) ve `script-sample`
// içinde sayfadan birebir alıntı taşıyabilir.
// ---------------------------------------------------------------------------

const IP = "203.0.113.77";

function post(body: unknown, over: { type?: string | null; ip?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": over.ip ?? IP };
  if (over.type !== null) headers["content-type"] = over.type ?? "application/csp-report";
  return POST(
    new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers,
      body: over.raw ?? JSON.stringify(body),
    }),
  );
}

const report = (over: Record<string, unknown> = {}) => ({
  "csp-report": {
    "effective-directive": "script-src",
    "blocked-uri": "https://evil.example/x.js",
    "document-uri": "https://www.lixusai.com/inbox?orgId=org_123&q=Ayse+Yilmaz",
    disposition: "report",
    ...over,
  },
});

describe("/api/csp-report", () => {
  let logs: string[] = [];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    logs = [];
    spy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
  });
  afterEach(() => spy.mockRestore());

  it("geçerli raporu kabul eder ve 204 döner (tarayıcı gövde okumaz)", async () => {
    const res = await post(report());
    expect(res.status).toBe(204);
    expect(logs.join("\n")).toContain("directive=script-src");
  });

  it("🚨 URL QUERY'Sİ SAKLANMAZ — panel URL'i org id ve arama terimi taşır", async () => {
    await post(report());
    const line = logs.join("\n");
    expect(line).not.toContain("orgId=org_123");
    expect(line).not.toContain("Ayse");
    // Yol TUTULUR: "hangi ekran" sorusu ölçümün kendisi.
    expect(line).toContain("/inbox");
  });

  it("🚨 `script-sample` LOG'A GİRMEZ — sayfadan birebir alıntı taşır", async () => {
    await post(report({ "script-sample": "const token='sk-live-SECRET123'" }));
    expect(logs.join("\n")).not.toContain("sk-live-SECRET123");
  });

  it("🚨 LOG ENJEKSİYONU: CR/LF ve kontrol karakterleri satır bölemez", async () => {
    await post(
      report({ "effective-directive": "script-src\n[csp-report] directive=SAHTE-KAYIT" }),
    );
    // Tek `console.warn` çağrısı, tek satır: sahte kayıt uydurulamaz.
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain("\n");
    expect(logs[0]).not.toContain("SAHTE-KAYIT\n");
  });

  it("🚨 YANLIŞ Content-Type 415 — rastgele form POST'u geçemez", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect((await post(report(), { type })).status, type).toBe(415);
    }
    // Başlıksız istek de reddedilir.
    expect((await post(report(), { type: null })).status).toBe(415);
  });

  it("🚨 GÖVDE TAVANI 413 — kimliksiz uçta OOM koruması", async () => {
    const huge = JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(20_000) } });
    expect((await post(null, { raw: huge })).status).toBe(413);
  });

  it("bozuk JSON 400 (sessizce yutulmaz)", async () => {
    expect((await post(null, { raw: "{bozuk" })).status).toBe(400);
  });

  it("🚨 HIZ LİMİTİ IP BAŞINA — tek gürültücü herkesi susturamaz", async () => {
    for (let i = 0; i < 30; i++) expect((await post(report())).status).toBe(204);
    expect((await post(report())).status).toBe(429);
    // Başka istemci kendi bütçesiyle gelir.
    expect((await post(report(), { ip: "198.51.100.9" })).status).toBe(204);
  });

  it("KONTROL: Reporting API dizi biçimi de okunur", async () => {
    const res = await post([
      { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://x.example/a.png" } },
    ]);
    expect(res.status).toBe(204);
    expect(logs.join("\n")).toContain("directive=img-src");
  });
});
