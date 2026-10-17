import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { Readable } from "node:stream";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Codex #22 final — DNS-rebind (TOCTOU) hardening on node:https/http. Three
// layers under test: the validating resolver (the pin point), the streaming
// byte-cap, and an END-TO-END fetch over a REAL loopback server (so redirect
// refusal, cap, and stream-to-completion are proven on real sockets).

const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns", () => dnsMock);

import { validatingLookup, readStreamCapped, fetchFeedText, type Lookup } from "@/lib/net/pinned-fetch";
import { isPrivateHost } from "@/lib/net/private-host";

/** Drive validatingLookup and resolve to what it passed the socket callback. */
function runLookup(
  hostname: string,
  answers: { address: string; family: number }[] | Error,
  opts: { all?: boolean; family?: number } = {},
): Promise<{ err: NodeJS.ErrnoException | null; address?: unknown; family?: number }> {
  dnsMock.lookup.mockImplementationOnce((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) => {
    if (answers instanceof Error) cb(answers);
    else cb(null, answers);
  });
  return new Promise((resolve) => {
    validatingLookup(hostname, opts, (err, address, family) => resolve({ err, address, family }));
  });
}

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// WHATWG-NORMALİZE IPv6 BİÇİMLERİ (Codex denetimi, 2026-08-01 — madde 5).
//
// `new URL()` bir IPv6 literalini SIKIŞTIRIR ve küçük harfe indirir:
// "::ffff:127.0.0.1" → "::ffff:7f00:1". Ampirik ölçümde ÜÇ biçim
// sınıflandırıcıdan GEÇİYORDU:
//   · "::7f00:1"              → 127.0.0.1        (IPv4-UYUMLU, "ffff:" YOK)
//   · "::a9fe:a9fe"           → 169.254.169.254  (BULUT METADATA)
//   · "0:0:0:0:0:ffff:7f00:1" → 127.0.0.1        (SIKIŞTIRILMAMIŞ yazım)
//
// İKİ kapı da sınanır (Codex'in açık isteği):
//   1. `isPrivateHost` — IP-LİTERAL bir feed URL'i için TEK savunma. Node,
//      host bir IP literali ise custom `lookup`'ı ATLAR, yani o yolda pinlenmiş
//      çözümleyici hiç çalışmaz.
//   2. `validatingLookup` — bir HOSTNAME bu adreslerden birine çözülürse
//      bağlantı reddedilmeli (DNS-rebind yolu).
// ---------------------------------------------------------------------------
describe("WHATWG-normalize IPv6 — iki kapı da reddeder", () => {
  const forms: [string, string][] = [
    ["::7f00:1", "IPv4-uyumlu 127.0.0.1"],
    ["::a9fe:a9fe", "IPv4-uyumlu bulut metadata"],
    ["0:0:0:0:0:ffff:7f00:1", "sıkıştırılmamış IPv4-mapped 127.0.0.1"],
    ["::ffff:7f00:1", "sıkıştırılmış IPv4-mapped 127.0.0.1 (regresyon)"],
    ["::ffff:a9fe:a9fe", "sıkıştırılmış metadata (regresyon)"],
    ["::ffff:c0a8:1", "192.168.0.1 (regresyon)"],
  ];

  for (const [addr, why] of forms) {
    it(`1. KAPI isPrivateHost engeller: ${addr} (${why})`, () => {
      expect(isPrivateHost(addr)).toBe(true);
    });

    it(`2. KAPI validatingLookup reddeder: ${addr}`, async () => {
      const res = await runLookup("rebind.example.test", [{ address: addr, family: 6 }]);
      expect(res.err).toBeTruthy();
      expect(res.err?.code).toBe("EACCES");
    });
  }

  it("GERÇEK public IPv6 hâlâ geçer (yanlış-pozitif pini)", async () => {
    const pub = "2606:2800:220:1:248:1893:25c8:1946";
    expect(isPrivateHost(pub)).toBe(false);
    const res = await runLookup("feed.example.com", [{ address: pub, family: 6 }]);
    expect(res.err).toBeNull();
  });

  it("public IPv6'nın son iki hextet'i loopback'e BENZESE de geçer (aşırı-eşleşme pini)", async () => {
    // İlk 80 bit sıfır DEĞİL → IPv4-mapped/uyumlu değil, dokunulmamalı.
    const pub = "2001:db8::7f00:1";
    expect(isPrivateHost(pub)).toBe(false);
    const res = await runLookup("feed.example.com", [{ address: pub, family: 6 }]);
    expect(res.err).toBeNull();
  });
});

describe("validatingLookup — pin only to validated PUBLIC addresses", () => {
  it("all-public answers pass; all:false → single (address,family), all:true → array", async () => {
    const pub = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    const single = await runLookup("feed.example.com", pub, { all: false });
    expect(single.err).toBeNull();
    expect(single.address).toBe("93.184.216.34");
    expect(single.family).toBe(4);

    const all = await runLookup("feed.example.com", pub, { all: true });
    expect(all.err).toBeNull();
    expect(all.address).toEqual(pub);
  });

  it("REJECTS the whole connection if ANY answer is private (poisoned multi-record)", async () => {
    const res = await runLookup("rebind.evil.test", [
      { address: "93.184.216.34", family: 4 }, // public decoy
      { address: "169.254.169.254", family: 4 }, // cloud metadata
    ]);
    expect(res.err?.code).toBe("EACCES");
    expect(res.address).toBeUndefined(); // nothing handed to the socket
  });

  it("blocks IPv4-mapped IPv6, loopback, link-local, CGNAT and private ranges", async () => {
    for (const bad of [
      "::ffff:169.254.169.254", "::ffff:10.0.0.5", "127.0.0.1", "10.1.2.3",
      "172.16.5.5", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "fe80::1", "fc00::1", "::1",
    ]) {
      const res = await runLookup("x.test", [{ address: bad, family: bad.includes(":") ? 6 : 4 }]);
      expect(res.err?.code, `${bad} must be blocked`).toBe("EACCES");
    }
  });

  it("CONNECT-TIME rebind: whatever resolves AT the lookup call is what's enforced", async () => {
    const first = await runLookup("rebind.test", [{ address: "93.184.216.34", family: 4 }]);
    expect(first.err).toBeNull();
    const flipped = await runLookup("rebind.test", [{ address: "127.0.0.1", family: 4 }]);
    expect(flipped.err?.code).toBe("EACCES");
  });

  it("empty resolution → ENOTFOUND; a DNS error propagates unchanged", async () => {
    expect((await runLookup("nx.test", [])).err?.code).toBe("ENOTFOUND");
    const dnsErr = Object.assign(new Error("nope"), { code: "ESERVFAIL" });
    expect((await runLookup("bad.test", dnsErr)).err?.code).toBe("ESERVFAIL");
  });
});

describe("readStreamCapped — abort mid-stream at the cap", () => {
  it("returns text under the cap; rejects the moment bytes cross it", async () => {
    expect(await readStreamCapped(Readable.from([Buffer.from("hello")]), 100)).toBe("hello");
    const endless = new Readable({
      read() {
        this.push(Buffer.alloc(1024, 65)); // never ends
      },
    });
    await expect(readStreamCapped(endless, 4096)).rejects.toThrow(/too large/);
    expect(endless.destroyed).toBe(true); // stream torn down, not drained
  });
});

describe("fetchFeedText — end-to-end over a real loopback server", () => {
  let server: http.Server;
  let base: string;
  // Loopback would be refused by the production validatingLookup (correct); a
  // test-only override lets us reach 127.0.0.1 to exercise the real socket path.
  const loopbackLookup: Lookup = (_h, options, cb) =>
    options.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
  const opts = { maxBytes: 1024 * 1024, timeoutMs: 3000, userAgent: "test/1.0", lookupOverride: loopbackLookup };

  const handlers: http.RequestListener[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => handlers.shift()!(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("reads a 200 body fully to completion", async () => {
    handlers.push((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/calendar" });
      res.end("BEGIN:VCALENDAR\nEND:VCALENDAR");
    });
    expect(await fetchFeedText(`${base}/cal.ics`, opts)).toContain("VCALENDAR");
  });

  it("REFUSES to follow a redirect (a 302 is a hard failure, nothing re-resolved)", async () => {
    handlers.push((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/" });
      res.end();
    });
    await expect(fetchFeedText(`${base}/redir`, opts)).rejects.toThrow(/HTTP 302/);
  });

  it("aborts a runaway body at the byte cap (real chunked stream)", async () => {
    handlers.push((_req, res) => {
      res.writeHead(200);
      const t = setInterval(() => res.write(Buffer.alloc(64 * 1024, 88)), 1);
      res.on("close", () => clearInterval(t));
    });
    await expect(
      fetchFeedText(`${base}/huge`, { ...opts, maxBytes: 256 * 1024 }),
    ).rejects.toThrow(/too large/);
  });

  it("PRODUCTION refuses http:// BEFORE any request/DNS (https-only; no override)", async () => {
    // No lookupOverride → production mode. http must be rejected up front, so
    // dns.lookup is never even called.
    dnsMock.lookup.mockImplementation(() => {
      throw new Error("lookup must not run for a rejected http URL");
    });
    await expect(
      fetchFeedText("http://feed.example.com/cal.ics", { maxBytes: 1024, timeoutMs: 1000, userAgent: "t" }),
    ).rejects.toThrow(/non-https/);
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("PRODUCTION https host that resolves to loopback is refused at connect", async () => {
    dnsMock.lookup.mockImplementation((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }]),
    );
    await expect(
      // https so it passes the protocol gate; the pinned lookup then blocks it.
      fetchFeedText("https://feed.rebind.test/cal.ics", { maxBytes: 1024, timeoutMs: 2000, userAgent: "t" }),
    ).rejects.toThrow(); // EACCES from the pinned lookup — never connects
  });

  it("uses agent:false — a truly request-scoped socket (no shared keep-alive pool)", async () => {
    const spy = vi.spyOn(http, "request");
    handlers.push((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await fetchFeedText(`${base}/x`, opts);
    expect(spy.mock.calls[0][0]).toMatchObject({ agent: false });
    spy.mockRestore();
  });

  it("TOTAL wall-clock deadline: a slow-drip that never idles is still cut", async () => {
    // A server that writes a tiny byte every 15ms keeps the socket BUSY, so an
    // idle timeout alone would never fire — only the hard deadline cuts it.
    handlers.push((_req, res) => {
      res.writeHead(200);
      const t = setInterval(() => res.write("x"), 15);
      res.on("close", () => clearInterval(t));
    });
    const start = Date.now();
    await expect(
      fetchFeedText(`${base}/drip`, { ...opts, timeoutMs: 250 }),
    ).rejects.toThrow(/deadline/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(200); // it did wait for the deadline
    expect(elapsed).toBeLessThan(2000); // …and was cut, not left hanging
  });
});

// ---------------------------------------------------------------------------
// P1 #8 (08-09 (2)) — PORT + USERINFO KAPILARI
//
// ⚠️ REDIRECT ŞARTI ZATEN DAHA GÜÇLÜ BİÇİMDE KARŞILANIYOR: bu istemci redirect'i
// HİÇ TAKİP ETMEZ (3xx = sert hata, `HTTP <status>`). "Her hop'u yeniden
// doğrula" isteğinin karşılığı "hop YOK" — dolayısıyla hop başına DNS/IP/host
// yeniden doğrulaması, redirect sayacı ve "redirect'te sır taşınmasın" şartları
// yapısal olarak sağlanıyor. Bu bloktaki testler kalan İKİ boşluğu kapatır.
// ---------------------------------------------------------------------------
describe("P1 #8 — port ve userinfo", () => {
  it("🚨 443 DIŞI port REDDEDİLİR (public adres olsa bile)", async () => {
    // Eskiden `url.port` olduğu gibi kullanılıyordu: `:9200` (Elasticsearch),
    // `:6379` (Redis), `:8080` — adres public olsa bile bu bir port tarama /
    // iç servis yoklama yüzeyidir. Gerçek bir takvim beslemesi ASLA 443 dışında
    // yayınlanmaz (Airbnb/Booking/Google/Vrbo hepsi 443).
    for (const port of ["9200", "6379", "8080", "80"]) {
      await expect(
        fetchFeedText(`https://example.com:${port}/f.ics`, { maxBytes: 1000, timeoutMs: 500, userAgent: "t" }),
      ).rejects.toThrow(/refusing feed port/);
    }
  });

  it("KONTROL: AÇIKÇA 443 yazılmış URL ve portsuz URL reddedilmez", async () => {
    // Bu olmadan "her portu reddet" mutasyonu da yeşil geçerdi ve ürün kırılırdı
    // (443'ü açıkça yazan bir feed URL'i tamamen meşrudur).
    //
    // ⚠️ `rejects.not.toThrow(/…/)` KULLANMA — ölçüldü (08-09 (2)): 443'ü de
    // reddeden mutasyonda o biçim YEŞİL geçti, yani hiçbir şey tutmuyordu.
    // Hatayı AÇIKÇA yakalayıp mesajını sınamak tek güvenilir yol.
    for (const u of ["https://example.invalid:443/f.ics", "https://example.invalid/f.ics"]) {
      let msg = "";
      try {
        await fetchFeedText(u, { maxBytes: 1000, timeoutMs: 500, userAgent: "t" });
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      // Ağ hatası bekleniyor (host çözülmez); kapıya TAKILMADIĞININ kanıtı budur.
      expect(msg, `${u} port kapısına takıldı`).not.toMatch(/refusing feed port/);
    }
  });

  it("🚨 KULLANICI BİLGİSİ taşıyan URL REDDEDİLİR (ayrıştırıcı karışıklığı)", async () => {
    // `https://evil.com@10.0.0.1/` insan gözüne evil.com gösterir, `new URL()`
    // host'u 10.0.0.1 çözer. Kimin haklı olduğuna bağlı bir kapı KAPI DEĞİLDİR.
    for (const u of [
      "https://user:pass@example.com/f.ics",
      "https://example.com@93.184.216.34/f.ics",
      "https://token@example.com/f.ics",
    ]) {
      await expect(
        fetchFeedText(u, { maxBytes: 1000, timeoutMs: 500, userAgent: "t" }),
      ).rejects.toThrow(/userinfo/);
    }
  });
});
