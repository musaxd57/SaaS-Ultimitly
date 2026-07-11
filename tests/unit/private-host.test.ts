import { describe, it, expect, vi, afterEach } from "vitest";

// Mock node:dns/promises so resolvesToPrivate is tested without real lookups.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import { isPrivateHost, resolvesToPrivate } from "@/lib/net/private-host";

describe("isPrivateHost (SSRF guard)", () => {
  it("blocks loopback / link-local / private / metadata / non-public hosts", () => {
    for (const h of [
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "localhost",
      "foo.local",
      "svc.internal",
      "::1",
      "[::1]",
      "fe80::1",
      "fc00::1",
      "",
    ]) {
      expect(isPrivateHost(h)).toBe(true);
    }
  });

  it("allows genuine public hosts (no false-reject of real feeds)", () => {
    for (const h of [
      "www.airbnb.com",
      "calendar.google.com",
      "8.8.8.8",
      "1.1.1.1",
      "172.15.0.1", // just below the private 172.16-31 range
      "172.32.0.1", // just above
      "example.com",
    ]) {
      expect(isPrivateHost(h)).toBe(false);
    }
  });
});

describe("resolvesToPrivate (fetch-time DNS gate)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("true when the public-looking hostname resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    expect(await resolvesToPrivate("evil.example.com")).toBe(true);
  });

  it("true when ANY of the resolved addresses is private (mixed A records)", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 }, // cloud metadata sneaked in
    ]);
    expect(await resolvesToPrivate("mixed.example.com")).toBe(true);
  });

  it("false for a genuinely public resolution", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    expect(await resolvesToPrivate("example.com")).toBe(false);
  });

  it("true for a private IPv6 resolution (unique-local)", async () => {
    lookupMock.mockResolvedValue([{ address: "fd12:3456::1", family: 6 }]);
    expect(await resolvesToPrivate("v6.example.com")).toBe(true);
  });

  it("fail-OPEN on a lookup error (NXDOMAIN/timeout) — fetch fails on its own", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await resolvesToPrivate("nxdomain.example.com")).toBe(false);
  });
});
