import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { exchangeCodeForToken, refreshAccessToken, HospitableOAuthError, type HospitableOAuthConfig } from "@/lib/hospitable-oauth";

/**
 * K27-K13 (Codex 11-25 akşam): token isteği istemci sırrını + yetki kodunu / yenileme anahtarını POST GÖVDESİNDE taşır. `fetch`in varsayılan
 * yönlendirme politikası "follow"dur ve 307 / 308 gövdeyi YENİ hedefe aynen taşır (Authorization başlığı köken değişince düşer, gövde düşmez —
 * Node 22 undici'de ölçüldü). Bu test GERÇEK `fetch`i kullanır: kodun verdiği `init` aynen yerel bir HTTP sunucusuna gider (adres https olmak
 * zorunda olduğu için yalnız hedef yerel sunucuya çevrilir). Sunucu 307 / 308 ile ikinci (yabancı) sunucuya yönlendirir; ikinci sunucuya
 * HİÇBİR istek ulaşmamalı ve hata "geçici" (authFailure:false) sayılmalı — kiracının yenileme anahtarı silinmez, sonraki tur yeniden dener.
 */

const realFetch = globalThis.fetch;
const received: { method: string; body: string }[] = [];
let foreign: http.Server;
let redirector: http.Server;
let redirectorPort = 0;

beforeAll(async () => {
  foreign = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method ?? "", body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: "tok_foreign", refresh_token: "rt_foreign", expires_in: 3600 }));
    });
  });
  await new Promise<void>((r) => foreign.listen(0, "127.0.0.1", r));
  const foreignPort = (foreign.address() as AddressInfo).port;
  redirector = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const code = Number((req.url ?? "/307").slice(1)) || 307;
      // "localhost" ≠ "127.0.0.1" → başka köken (çapraz köken yönlendirmesi).
      res.writeHead(code, { location: `http://localhost:${foreignPort}/steal` });
      res.end();
    });
  });
  await new Promise<void>((r) => redirector.listen(0, "127.0.0.1", r));
  redirectorPort = (redirector.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => foreign.close(r));
  await new Promise((r) => redirector.close(r));
});

afterEach(() => {
  vi.unstubAllGlobals();
  received.length = 0;
});

const config: HospitableOAuthConfig = {
  clientId: "client-1",
  clientSecret: "secret-REDIRECT-PROBE",
  authorizeUrl: "https://auth.example.com/authorize",
  tokenUrl: "https://auth.example.com/token",
  redirectUri: "https://www.lixusai.com/api/hospitable/oauth/callback",
};

/** Kodun `fetch(url, init)` çağrısını, init'e DOKUNMADAN yerel yönlendiriciye çevirir. */
function routeToRedirector(code: number) {
  const spy = vi.fn((_url: unknown, init?: RequestInit) => realFetch(`http://127.0.0.1:${redirectorPort}/${code}`, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("K13 — OAuth token isteği yönlendirme İZLEMEZ (sır gövdesi başka hedefe taşınmaz)", () => {
  for (const code of [307, 308]) {
    it(`${code}: yetki kodu değişimi — yabancı sunucuya istek gitmez, hata geçici`, async () => {
      const spy = routeToRedirector(code);
      const err = await exchangeCodeForToken(config, "code-PROBE").catch((e: unknown) => e);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(received).toEqual([]);
      expect(err).toBeInstanceOf(HospitableOAuthError);
      expect((err as HospitableOAuthError).authFailure).toBe(false);
    });

    it(`${code}: yenileme — yabancı sunucuya istek gitmez, anahtar ölü SAYILMAZ`, async () => {
      const spy = routeToRedirector(code);
      const err = await refreshAccessToken(config, "rt-PROBE").catch((e: unknown) => e);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(received).toEqual([]);
      expect(err).toBeInstanceOf(HospitableOAuthError);
      expect((err as HospitableOAuthError).authFailure).toBe(false);
    });
  }

  it("301 / 302 de izlenmez (GET'e dönüşse bile yabancı hedefe istek çıkmaz)", async () => {
    for (const code of [301, 302]) {
      routeToRedirector(code);
      const err = await refreshAccessToken(config, "rt-PROBE").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HospitableOAuthError);
    }
    expect(received).toEqual([]);
  });

  it("kontrol: yönlendirme yoksa aynı yol çalışır (test düzeneği istekleri gerçekten ulaştırıyor)", async () => {
    const spy = vi.fn((_url: unknown, init?: RequestInit) => {
      const port = (foreign.address() as AddressInfo).port;
      return realFetch(`http://127.0.0.1:${port}/token`, init);
    });
    vi.stubGlobal("fetch", spy);
    const tokens = await refreshAccessToken(config, "rt-PROBE");
    expect(tokens.accessToken).toBe("tok_foreign");
    expect(received).toHaveLength(1);
    expect(received[0].body).toContain("rt-PROBE");
  });
});
