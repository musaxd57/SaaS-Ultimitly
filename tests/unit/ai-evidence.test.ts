import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Codex #28/#29 — evidence integrity of the model's structured output:
//   #28 usedSources "reservation:*" accepted ANY suffix whenever a reservation
//       existed → a fabricated "reservation:door_code" rendered as a trusted
//       "used context" chip. Now field-whitelisted like property:*.
//   #29 statedCheckoutTime was accepted on FORMAT alone and is persisted onto
//       the reservation (guestCheckoutTime → turnover planning) → a regex-valid
//       hallucination got written. Now it must be deterministically evidenced
//       in the guest's own message.
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { suggestReply } from "@/lib/ai";
import { timeStatedInMessage } from "@/lib/ai/stated-time";
import type { SuggestReplyInput } from "@/lib/ai/types";

function makeInput(guestMessage: string): SuggestReplyInput {
  return {
    guestMessage,
    property: { name: "Galata Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
    reservation: { guestName: "John Smith", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
    knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ: X şifre: Y" }],
    tone: "warm",
    language: "tr",
  };
}

/** Stub OpenAI to return exactly this parsed payload. */
function stubModel(payload: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }] }),
          { status: 200 },
        ),
    ),
  );
}

const BASE = {
  intent: "wifi",
  confidence: 0.9,
  reply: "Örnek cevap",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  missingInfo: [],
};

beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("usedSources reservation:* field whitelist (#28)", () => {
  it("keeps REAL reservation fields, drops invented ones", async () => {
    stubModel({
      ...BASE,
      usedSources: [
        "kb:wifi",
        "reservation:arrivalDate",
        "reservation:status",
        "reservation:door_code", // fabricated — must drop
        "reservation:price", // not in the model's context — must drop
      ],
      statedCheckoutTime: null,
    });
    const result = await suggestReply(makeInput("Wifi şifresi nedir?"));
    expect(result.source).toBe("openai");
    expect(result.usedSources).toEqual(["kb:wifi", "reservation:arrivalDate", "reservation:status"]);
  });

  it("drops ALL reservation:* claims when there is no reservation at all", async () => {
    stubModel({ ...BASE, usedSources: ["reservation:arrivalDate"], statedCheckoutTime: null });
    const input = { ...makeInput("Wifi şifresi nedir?"), reservation: null };
    const result = await suggestReply(input);
    expect(result.usedSources).toEqual([]);
  });
});

describe("statedCheckoutTime requires evidence in the guest message (#29)", () => {
  it("accepted when the guest explicitly wrote the time", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "18:00" });
    const result = await suggestReply(makeInput("Yarın 18:00 gibi çıkarız."));
    expect(result.statedCheckoutTime).toBe("18:00");
  });

  it("accepted for '6pm' stated as 18:00 and 'saat 9' stated as 09:00", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "18:00" });
    expect((await suggestReply(makeInput("We will leave around 6pm tomorrow"))).statedCheckoutTime).toBe("18:00");

    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "09:00" });
    expect((await suggestReply(makeInput("Saat 9 gibi çıkarız"))).statedCheckoutTime).toBe("09:00");
  });

  it("HALLUCINATION dropped: message contains no such time", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "10:00" });
    const result = await suggestReply(makeInput("Konaklama harikaydı, teşekkürler!"));
    expect(result.statedCheckoutTime).toBeNull();
  });

  it("a bare count ('2 valizimiz var') can NOT anchor a 14:00 claim", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "14:00" });
    const result = await suggestReply(makeInput("2 valizimiz var, çıkışta resepsiyona bırakabilir miyiz?"));
    expect(result.statedCheckoutTime).toBeNull();
  });
});

describe("timeStatedInMessage (pure)", () => {
  it("explicit forms", () => {
    expect(timeStatedInMessage("18:00", "18:00 gibi çıkarız")).toBe(true);
    expect(timeStatedInMessage("18:30", "we leave at 6:30 pm")).toBe(true);
    expect(timeStatedInMessage("06:30", "we leave at 6:30 am")).toBe(true);
    expect(timeStatedInMessage("18:30", "çıkış 18.30 olur")).toBe(true);
    expect(timeStatedInMessage("18:30", "we leave at 6:30")).toBe(true); // afternoon reading allowed
  });

  it("cued bare hours", () => {
    expect(timeStatedInMessage("18:00", "akşam 6 gibi çıkarız")).toBe(true);
    expect(timeStatedInMessage("09:00", "saat 9 civarı")).toBe(true);
    expect(timeStatedInMessage("18:00", "18'de çıkarız")).toBe(true);
    expect(timeStatedInMessage("12:00", "çıkışı öğlen 12 yapabilir miyiz")).toBe(true);
    expect(timeStatedInMessage("21:00", "at 9 pm")).toBe(true);
  });

  it("no false anchors from uncued numbers / mismatches", () => {
    expect(timeStatedInMessage("14:00", "2 valizimiz var")).toBe(false);
    expect(timeStatedInMessage("10:00", "oda 10 numarada mı")).toBe(false); // no time cue
    expect(timeStatedInMessage("18:00", "19:00 gibi çıkarız")).toBe(false);
    expect(timeStatedInMessage("18:15", "18:00 gibi çıkarız")).toBe(false);
    expect(timeStatedInMessage("06:00", "we leave at 6 pm")).toBe(false); // pm pins it to 18:00
    expect(timeStatedInMessage("18:00", "harika bir konaklamaydı")).toBe(false);
  });
});
