import { describe, it, expect } from "vitest";
import { isPrivateHost } from "@/lib/net/private-host";

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
