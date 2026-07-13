import { describe, it, expect, vi, afterEach } from "vitest";

// Codex #22 final — DNS-rebind (TOCTOU) hardening. validatingLookup is the
// function net/tls calls AT CONNECT TIME, so testing it directly tests the
// exact point where the socket is bound: whatever it validates is what the
// connection uses, and there is no second resolution to race.

const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns", () => dnsMock);

import { validatingLookup, pinnedPublicAgent } from "@/lib/net/pinned-fetch";

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
    // A public sibling must NOT let a poisoned answer through — the set is rejected.
    const res = await runLookup("rebind.evil.test", [
      { address: "93.184.216.34", family: 4 }, // public decoy
      { address: "169.254.169.254", family: 4 }, // cloud metadata
    ]);
    expect(res.err?.code).toBe("EACCES");
    expect(res.address).toBeUndefined(); // nothing handed to the socket
  });

  it("blocks IPv4-mapped IPv6, loopback, link-local, CGNAT and private ranges", async () => {
    for (const bad of [
      "::ffff:169.254.169.254", // IPv4-mapped metadata
      "::ffff:10.0.0.5",        // IPv4-mapped private
      "127.0.0.1",              // loopback
      "10.1.2.3",               // private
      "172.16.5.5",             // private
      "192.168.1.1",            // private
      "169.254.169.254",        // metadata / link-local
      "100.64.0.1",             // CGNAT
      "fe80::1",                // IPv6 link-local
      "fc00::1",                // IPv6 unique-local
      "::1",                    // IPv6 loopback
    ]) {
      const res = await runLookup("x.test", [{ address: bad, family: bad.includes(":") ? 6 : 4 }]);
      expect(res.err?.code, `${bad} must be blocked`).toBe("EACCES");
    }
  });

  it("CONNECT-TIME rebind: whatever resolves AT the lookup call is what's enforced", async () => {
    // First resolution public → allowed. A later flip to private → the very next
    // connection's lookup rejects. This is the TOCTOU closure: enforcement lives
    // at the socket's own resolution, not an earlier pre-check.
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

describe("pinnedPublicAgent — end-to-end enforcement via real global fetch", () => {
  it("refuses a hostname that resolves to a private address (loopback), at connect time", async () => {
    // Real dns.lookup is mocked to loopback for a would-be public host name —
    // fetch through the agent must fail because the socket lookup rejects it.
    dnsMock.lookup.mockImplementation((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }]),
    );
    await expect(
      fetch("http://feed.rebind.test/cal.ics", {
        dispatcher: pinnedPublicAgent(),
        signal: AbortSignal.timeout(2000),
      } as RequestInit & { dispatcher: unknown }),
    ).rejects.toThrow();
  });
});
