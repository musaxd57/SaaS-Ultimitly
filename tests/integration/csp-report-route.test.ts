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

  // -------------------------------------------------------------------------
  // F09 (Codex 09-05): YOL da taşıyıcıdır. `/c/<chatToken>` QR sohbetinin kapısı (sabit, fiziksel olarak asılı bearer),
  // `/api/calendar/<token>` halka açık takvim beslemesi. Query atılıyordu ama yol olduğu gibi loga gidiyordu; URL
  // olmayan değerin ilk 120 karakteri, directive/disposition serbest metin olarak yazılıyordu.
  // -------------------------------------------------------------------------
  describe("F09 — log sınırı: yol şablonu + kapalı kümeler", () => {
    const CHAT_TOKEN = "3f9a1c2e7b8d4e6fa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3";
    const line = () => logs.join("\n");

    it("🚨 QR sohbet yolundaki token loga girmez (query/fragment de) — rota şablonu kalır", async () => {
      await post(report({ "document-uri": `https://www.lixusai.com/c/${CHAT_TOKEN}?token=QUERY_SECRET#FRAG_SECRET` }));
      expect(line()).not.toContain(CHAT_TOKEN);
      expect(line()).not.toContain(CHAT_TOKEN.slice(0, 16));
      expect(line()).not.toContain("QUERY_SECRET");
      expect(line()).not.toContain("FRAG_SECRET");
      expect(line()).toContain("document=https://www.lixusai.com/c/:token");
    });

    it("🚨 takvim beslemesi ve sohbet API'sindeki token da şablona iner (her iki alan)", async () => {
      await post(report({ "blocked-uri": `https://www.lixusai.com/api/calendar/${CHAT_TOKEN}.ics`, "document-uri": `https://www.lixusai.com/api/chat/${CHAT_TOKEN}` }));
      expect(line()).not.toContain(CHAT_TOKEN.slice(0, 16));
      expect(line()).toContain("blocked=https://www.lixusai.com/api/calendar/:token");
      expect(line()).toContain("document=https://www.lixusai.com/api/chat/:token");
    });

    it("🚨 kimlik taşıyan yol parçası şablona iner; ekran adı kalır (ölçümün kendisi)", async () => {
      await post(report({ "document-uri": "https://www.lixusai.com/inbox/cmf8x2k9q0001abcd1234efgh?x=1" }));
      expect(line()).not.toContain("cmf8x2k9q0001abcd1234efgh");
      expect(line()).toContain("document=https://www.lixusai.com/inbox/:id");
    });

    it("🚨 kullanıcı bilgisi (user:parola@) loga girmez", async () => {
      await post(report({ "blocked-uri": "https://admin:PAROLA_SECRET@evil.example/a.js" }));
      expect(line()).not.toContain("PAROLA_SECRET");
      expect(line()).not.toContain("admin:");
      expect(line()).toContain("blocked=https://evil.example/a.js");
    });

    it("🚨 URL olmayan değer OLDUĞU GİBİ dönmez (sahte rapordaki kişisel veri)", async () => {
      await post(report({ "blocked-uri": "Ayse Yilmaz TC 12345678901 tel 0555 123 45 67" }));
      expect(line()).not.toContain("Ayse");
      expect(line()).not.toContain("0555");
      expect(line()).toContain("blocked=invalid");
    });

    it("🚨 data:/blob: kaynağının İÇERİĞİ girmez, yalnız şeması", async () => {
      await post(report({ "blocked-uri": "data:text/html;base64,U0VDUkVUX1BBWUxPQUQ=" }));
      expect(line()).not.toContain("U0VDUkVUX1BBWUxPQUQ");
      expect(line()).not.toContain("text/html");
      expect(line()).toContain("blocked=data:");
    });

    it("özel kaynak anahtar kelimeleri (inline/eval/…) izin listesiyle aynen kalır", async () => {
      for (const kw of ["inline", "eval", "wasm-eval", "trusted-types-sink"]) {
        logs = [];
        await post(report({ "blocked-uri": kw }));
        expect(line(), kw).toContain(`blocked=${kw} `);
      }
    });

    it("🚨 directive KAPALI KÜME: sahte/uzun değer 'other'; CSP2 biçimi ('script-src 'self' …') ilk sözcüğe iner", async () => {
      await post(report({ "effective-directive": "script-src;Ayse Yilmaz 05551234567" }));
      expect(line()).not.toContain("Ayse");
      expect(line()).toContain("directive=other ");
      logs = [];
      await post(report({ "effective-directive": undefined, "violated-directive": "script-src 'self' https://cdn.example" }));
      expect(line()).toContain("directive=script-src ");
      expect(line()).not.toContain("cdn.example");
      logs = [];
      await post(report({ "effective-directive": "x".repeat(5000) }));
      expect(line()).toContain("directive=other ");
      expect(line().length).toBeLessThan(600);
    });

    it("meşru directive'ler aynen kalır (aşırı uygulama yok)", async () => {
      for (const d of ["script-src-elem", "style-src-attr", "img-src", "connect-src", "frame-ancestors", "form-action"]) {
        logs = [];
        await post(report({ "effective-directive": d }));
        expect(line(), d).toContain(`directive=${d} `);
      }
    });

    it("🚨 disposition KAPALI KÜME: enforce/report aynen, başka her şey 'other'", async () => {
      await post(report({ disposition: "enforce" }));
      expect(line()).toContain("disposition=enforce");
      logs = [];
      await post(report({ disposition: "Ayse-SAHTE" }));
      expect(line()).not.toContain("Ayse");
      expect(line()).toContain("disposition=other");
    });

    it("üçüncü taraf kaynağın ekran adı yolu kalır (ölçüm değeri korunur)", async () => {
      await post(report({ "blocked-uri": "https://www.googletagmanager.com/gtag/js?id=G-SECRET1" }));
      expect(line()).toContain("blocked=https://www.googletagmanager.com/gtag/js ");
      expect(line()).not.toContain("G-SECRET1");
    });

    it("🚨 merkezî redaksiyon bu sink'te de: sahte raporun origin'ine yazılmış telefon numarası loga girmez", async () => {
      await post(report({ "blocked-uri": "https://05551234567.evil.example/a.js" }));
      expect(line()).not.toContain("05551234567");
      expect(line()).toContain("directive=script-src");
    });

    it("🚨 büyük alan: 7 KB'lık yol loga taşınmaz (segment tavanı)", async () => {
      const long = `https://evil.example/${Array.from({ length: 400 }, (_, i) => `seg${i}x`).join("/")}`;
      await post(report({ "blocked-uri": long }));
      expect(line().length).toBeLessThan(600);
      expect(line()).not.toContain("seg399x");
    });
  });

  it("KONTROL: Reporting API dizi biçimi de okunur", async () => {
    const res = await post([
      { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://x.example/a.png" } },
    ]);
    expect(res.status).toBe(204);
    expect(logs.join("\n")).toContain("directive=img-src");
  });
});
