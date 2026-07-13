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

  it("PRODUCTION lookup (no override) refuses a loopback-resolving host at connect", async () => {
    // Real dns.lookup mocked to loopback for a would-be public feed host.
    dnsMock.lookup.mockImplementation((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }]),
    );
    await expect(
      fetchFeedText("http://feed.rebind.test/cal.ics", { maxBytes: 1024, timeoutMs: 2000, userAgent: "t" }),
    ).rejects.toThrow(); // EACCES from the pinned lookup — never connects
  });
});
