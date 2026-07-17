import { describe, it, expect } from "vitest";
import { readJsonCapped, BodyTooLargeError, MAX_JSON_BODY_BYTES } from "@/lib/api";

const jsonReq = (body: string) =>
  new Request("http://t/api/x", { method: "POST", body, headers: { "content-type": "application/json" } });

// A body with NO Content-Length header (chunked) — forces the streaming path.
const chunkedReq = (text: string) => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  // duplex is required by Node's fetch Request for a stream body.
  return new Request("http://t/api/x", { method: "POST", body: stream, duplex: "half" } as RequestInit & {
    duplex: "half";
  });
};

describe("readJsonCapped (body-size cap)", () => {
  it("parses a normal JSON body under the cap", async () => {
    const data = await readJsonCapped<{ a: number; s: string }>(jsonReq(JSON.stringify({ a: 1, s: "ok" })));
    expect(data).toEqual({ a: 1, s: "ok" });
  });

  it("REJECTS an oversized body via the Content-Length header (declared size)", async () => {
    // A real >cap body gives a real >cap Content-Length → the cheap header check fires.
    const huge = JSON.stringify({ x: "a".repeat(2048) });
    await expect(readJsonCapped(jsonReq(huge), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("REJECTS mid-stream when Content-Length is ABSENT (chunked can't smuggle a huge body)", async () => {
    await expect(readJsonCapped(chunkedReq("a".repeat(2048)), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("allows a chunked body that stays UNDER the cap", async () => {
    const data = await readJsonCapped<{ ok: boolean }>(chunkedReq(JSON.stringify({ ok: true })), 1024);
    expect(data.ok).toBe(true);
  });

  it("throws SyntaxError (→ caller maps to 400) on malformed JSON", async () => {
    await expect(readJsonCapped(jsonReq("{not valid"))).rejects.toBeInstanceOf(SyntaxError);
  });

  it("throws SyntaxError on an empty/absent body", async () => {
    await expect(readJsonCapped(new Request("http://t/api/x", { method: "POST" }))).rejects.toBeInstanceOf(SyntaxError);
  });

  it("default cap is 64 KB", () => {
    expect(MAX_JSON_BODY_BYTES).toBe(64 * 1024);
  });
});
