import { describe, it, expect } from "vitest";
import { readJsonCapped, readTextCapped, readJsonCappedOrNull, BodyTooLargeError, MAX_JSON_BODY_BYTES } from "@/lib/api";

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

  it("ACTIVELY cancels the stream (not just releaseLock) when the cap is exceeded", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("a".repeat(4096)));
        // do NOT close — leave it open so cancel() actually has something to cancel
      },
      cancel() {
        cancelled = true; // reader.cancel() propagates here; releaseLock alone would not
      },
    });
    // Feed the stream directly (a real Request would re-wrap it and hide the cancel).
    const req = { headers: new Headers(), body: stream } as unknown as Request;
    await expect(readTextCapped(req, 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancelled).toBe(true); // the oversized body was cancelled, not drained
  });

  it("readJsonCappedOrNull (Codex P2 auth-route drop-in): parses under cap, returns null on malformed AND over-cap", async () => {
    // Faithful `req.json().catch(() => null)` replacement — same null-on-bad, plus the cap.
    expect(await readJsonCappedOrNull(jsonReq(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
    expect(await readJsonCappedOrNull(jsonReq("{bad"))).toBeNull(); // malformed → null
    expect(await readJsonCappedOrNull(chunkedReq("a".repeat(2048)), 1024)).toBeNull(); // over-cap → null (stream capped)
    expect(await readJsonCappedOrNull(new Request("http://t/api/x", { method: "POST" }))).toBeNull(); // empty → null
  });

  it("readTextCapped returns raw text (webhook path) and enforces the cap", async () => {
    expect(await readTextCapped(jsonReq("raw signed body"))).toBe("raw signed body");
    await expect(readTextCapped(jsonReq("a".repeat(2048)), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(await readTextCapped(new Request("http://t/api/x", { method: "POST" }))).toBe(""); // no body → ""
  });
});
