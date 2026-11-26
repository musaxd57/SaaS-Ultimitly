import "server-only";

import { calendarDateOf, todayKey } from "@/modules/availability/core";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { loadVerifiedAvailability } from "@/lib/ai/verified-availability-load";
import { loadVerifiedExtension } from "@/lib/ai/verified-extension-load";
import { verifiedAvailabilityLang, verifiedAvailabilityText, verifiedAvailabilityUsable } from "@/lib/ai/verified-availability";
import { verifiedExtensionText } from "@/lib/ai/verified-extension";
import { rangeTouchesStay, verifiedQrEnabled } from "@/lib/ai/verified-qr";

// ---------------------------------------------------------------------------
// QR — doğrulanmış müsaitlik / uzatma KOD metni (anahtar `AI_VERIFIED_QR_ENABLED`, VARSAYILAN KAPALI; kurucu yokken karar #3).
// Kanal akışıyla AYNI şartlar (anlama katmanı bütün istekleri tek tür + selam görür, tek soru, dil TR / EN kodla, araç taze ve kesin) +
// QR'ye özgü: müsaitlik yalnız konaklamaya DEĞMEYEN aralıkta (bitişik / örtüşen → konaklama değişikliği → ev sahibi). Burası yalnız METNİ
// kurar; muafiyet ve bütün diğer kontroller QR kapısında (`evaluateEscalation`, bekçi dahil) koşar.
// ---------------------------------------------------------------------------

export interface QrVerifiedStay {
  kind: "availability" | "extension";
  text: string;
}

export async function loadQrVerifiedStay(input: {
  organizationId: string;
  propertyId: string;
  timeZone: string;
  message: string;
  /** Misafirin dili KODLA (QR `confidentLanguage`); modelin tahminine düşülmez. */
  language: string | null;
  reservation: { arrivalDate: Date; departureDate: Date; channel: string | null; status: string };
  understood: MessageUnderstanding | null;
  now?: Date;
}): Promise<QrVerifiedStay | null> {
  if (!verifiedQrEnabled() || !input.understood) return null;
  const lang = verifiedAvailabilityLang(input.language);
  if (!lang) return null;
  if ((input.message.match(/\?/g)?.length ?? 0) > 1 || input.message.length > 300) return null;
  const reqs = input.understood.requests;
  const only = (intent: string) =>
    reqs.length > 0 && reqs.some((q) => q.intent === intent) && reqs.every((q) => q.intent === intent || q.intent === "greeting_thanks");
  const now = input.now ?? new Date();
  const today = todayKey(now, input.timeZone);
  const base = {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    timeZone: input.timeZone,
    guestTexts: [input.message],
    lastGuestText: input.message,
    now,
    enabled: true,
  };
  if (only("extend_stay")) {
    const run = await loadVerifiedExtension({ ...base, reservation: input.reservation });
    if (!run || !verifiedAvailabilityUsable(run.va, run.scope, now)) return null;
    const text = verifiedExtensionText(run.va, lang, today);
    return text ? { kind: "extension", text } : null;
  }
  if (only("availability")) {
    const run = await loadVerifiedAvailability({ ...base, reservation: input.reservation });
    if (!run || !verifiedAvailabilityUsable(run.va, run.scope, now)) return null;
    const stay = {
      arrival: calendarDateOf(input.reservation.arrivalDate, input.timeZone).key,
      departure: calendarDateOf(input.reservation.departureDate, input.timeZone).key,
    };
    if (rangeTouchesStay(run.va.query, stay)) return null; // dairedeki misafirin bitişik / örtüşen tarihi = konaklama değişikliği
    const text = verifiedAvailabilityText(run.va, lang, today);
    return text ? { kind: "availability", text } : null;
  }
  return null;
}
