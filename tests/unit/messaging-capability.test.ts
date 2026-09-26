import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  NON_MESSAGING_CHANNELS,
  PROVIDER_MESSAGEABLE_RESERVATION_WHERE,
  PROVIDER_THREAD_CONVERSATION_WHERE,
  reservationMessagingCapable,
  isInternalThread,
} from "@/lib/channels/capability";
import { INTERNAL_THREAD_PREFIX } from "@/lib/channels/outbound";

// ---------------------------------------------------------------------------
// V0.5 — "mesajlanabilir mi?" kararı TEK KAYNAK (channels/capability.ts).
// Envanter 1b: aynı karar automation.ts'te 6 kopya `channel notIn ["ics","manual"]`
// + `calendarSourceId: null` (+ `sourceReference not null`) olarak, iç-thread kuralı
// da 2 kopya `startsWith "qr-chat:"` olarak yazılıydı. Kopyalar birbirinden
// sürüklenebilir; önizleme == gerçek paritesi yorumla değil YAPIYLA korunmalı.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const automation = readFileSync(path.join(ROOT, "src/lib/automation.ts"), "utf8");

describe("messaging capability — tek kaynak", () => {
  it("SHADOW-COMPARE: paylaşılan fragment eski 6 kopyanın literal'ine BİREBİR eşit (davranış değişmedi)", () => {
    expect(PROVIDER_MESSAGEABLE_RESERVATION_WHERE).toEqual({
      sourceReference: { not: null },
      calendarSourceId: null,
      channel: { notIn: ["ics", "manual"] },
    });
    expect(PROVIDER_THREAD_CONVERSATION_WHERE).toEqual({
      externalReservationId: { not: null },
      NOT: { externalReservationId: { startsWith: "qr-chat:" } },
    });
    expect([...NON_MESSAGING_CHANNELS]).toEqual(["ics", "manual"]);
  });

  it("satır predicate'i fragment ile AYNI kararı verir (doğruluk tablosu)", () => {
    const ok = { sourceReference: "h-1", calendarSourceId: null, channel: "airbnb" };
    expect(reservationMessagingCapable(ok)).toBe(true);
    expect(reservationMessagingCapable({ ...ok, channel: "booking" })).toBe(true);
    expect(reservationMessagingCapable({ ...ok, channel: "other" })).toBe(true);
    expect(reservationMessagingCapable({ ...ok, channel: "ics" })).toBe(false); // elle .ics
    expect(reservationMessagingCapable({ ...ok, channel: "manual" })).toBe(false); // elle .csv / UI
    expect(reservationMessagingCapable({ ...ok, calendarSourceId: "src-1" })).toBe(false); // feed satırı, kanalı airbnb olsa bile
    expect(reservationMessagingCapable({ ...ok, sourceReference: null })).toBe(false); // sağlayıcı kimliği yok → hedef yok
  });

  it("iç thread kuralı tek yerde: INTERNAL_THREAD_PREFIX", () => {
    expect(isInternalThread(`${INTERNAL_THREAD_PREFIX}p1:r1`)).toBe(true);
    expect(isInternalThread("6f1c-uuid")).toBe(false);
    expect(isInternalThread(null)).toBe(false);
    expect(isInternalThread(undefined)).toBe(false);
  });

  it("automation.ts'te kopya KALMADI: literal `notIn: [\"ics\", \"manual\"]` ve `startsWith: \"qr-chat:\"` yok, fragment import edilmiş", () => {
    // Kaynak taraması tek yönlüdür (yalnız bu iki yazımı görür); davranışsal parite
    // testi integration/messaging-capability.test.ts'te. İkisi birlikte pin.
    expect(automation.match(/notIn:\s*\[\s*"ics"\s*,\s*"manual"\s*\]/g) ?? []).toHaveLength(0);
    expect(automation.match(/startsWith:\s*"qr-chat:"/g) ?? []).toHaveLength(0);
    expect(automation).toMatch(/from "@\/lib\/channels\/capability"/);
    // 6 rezervasyon kopyası + 2 konuşma kopyası → en az o kadar spread.
    expect((automation.match(/\.\.\.PROVIDER_MESSAGEABLE_RESERVATION_WHERE/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((automation.match(/\.\.\.PROVIDER_THREAD_CONVERSATION_WHERE/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
