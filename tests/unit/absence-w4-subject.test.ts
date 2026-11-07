import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// Kurucu W4 (10-21, "bağlam bazlı tutsun"): "can't find / unable to find" yalnız BEN / BİZ öznesiyle (ya da öznesiz cümle başında)
// bilgisizlik itirafıdır. Misafire talimat ("If you can't find the keys, they are in the lockbox") ve olgu ("You can't see the sea from
// the balcony") itiraf değildir — eskiden çıplak "can't find" ile tutuluyordu.
// ---------------------------------------------------------------------------

describe("W4 — özne: misafire talimat / olgu bilgisizlik değildir", () => {
  it.each([
    "If you can't find the keys, they are in the lockbox next to the door.",
    "If you cannot locate the lockbox, it is behind the plant pot.",
    "If you're unable to find the parking spot, it is the second one on the left.",
    "In case you are not able to find the building, look for the blue door.",
    "You can't see the sea from the balcony, but the park view is lovely.",
    "Guests often can't find the light switch; it is behind the curtain.",
    "The remote is in the drawer — if they can't find it, check under the sofa.",
  ])("tutulmaz: %s", (reply) => {
    expect(admitsMissingKnowledge(reply)).toBe(false);
  });
});

describe("W4 kontrol — gerçek itiraf hâlâ tutulur", () => {
  it.each([
    "I can't find that information.",
    "Unfortunately I couldn't find anything about the gym.",
    "We can't find any details about late check-out.",
    "I really can't see that in the guide.",
    "I'm not able to find that in what I have.",
    "I am unable to locate the parking details.",
    "We were unable to find the Wi-Fi password.",
    "Sorry, can't find the information about the pool.",
    "Can't find anything about the sauna, sorry.",
    "Thanks for asking. Couldn't find details on that.",
  ])("tutulur: %s", (reply) => {
    expect(admitsMissingKnowledge(reply)).toBe(true);
  });
});

describe("W4 — öznesiz soru cümlesi talimattır", () => {
  it("'Can't find the keys? They are in the lockbox.' tutulmaz; soru işaretsiz öznesiz cümle tutulur", () => {
    expect(admitsMissingKnowledge("Can't find the keys? They are in the lockbox.")).toBe(false);
    expect(admitsMissingKnowledge("Welcome! Unable to locate the box? It is behind the plant.")).toBe(false);
    expect(admitsMissingKnowledge("Welcome! Unable to locate details on the pool.")).toBe(true);
  });
});

describe("Haiku 10-21: özne ile fiil arasındaki zarf / ekip öznesi — gerçek itiraf kaçmaz", () => {
  it.each([
    "I'm genuinely unable to find it.",
    "I'm honestly unable to find it.",
    "We currently can't locate the guide.",
    "I actually couldn't find any record of that.",
    "Our team couldn't find the manual.",
    "My notes can't find anything on that.",
  ])("tutulur: %s", (reply) => {
    expect(admitsMissingKnowledge(reply)).toBe(true);
  });
  it.each([
    "I think you can't miss it — it is the blue door.",
    "Our cleaners can't find anything wrong with the boiler, it works fine.",
  ])("KONTROL tutulmaz: %s", (reply) => {
    expect(admitsMissingKnowledge(reply)).toBe(false);
  });
});

describe("W4 kalıpları doğrusal (ReDoS pini)", () => {
  it("uzun zarf / özne / tek sözcük dizilerinde 1 sn altında", () => {
    for (const s of ["i " + "reallyly ".repeat(5000), "our team ".repeat(6000), `${"a".repeat(50_000)}ly can't find`, `${"x".repeat(14)}ly `.repeat(3000)]) {
      const t0 = performance.now();
      admitsMissingKnowledge(s);
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  });
});
