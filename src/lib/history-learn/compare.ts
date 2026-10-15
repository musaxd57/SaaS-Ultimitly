import "server-only";

import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { styleProfileForPrompt } from "@/lib/guest-chat";
import { hostOfferForGate, passesAutoReplySafetyGate } from "@/lib/automation";
import { kbFactsOf } from "@/lib/ai/availability-claims";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import { modelGuestFirstName } from "@/lib/ai/code-greeting";
import { loadPromptInstructions } from "./prompt-instructions";

// ---------------------------------------------------------------------------
// CEVAP KARŞILAŞTIRMA — KURU KOŞU (F1; kurucu 10-15: "canlı cevap modeli"). Geçmiş bir misafir sorusuna BUGÜNKÜ ürün ne cevap verirdi:
// "AI'yı Deneyin" (`api/ai/test`) ile AYNI yol — bilgi tabanı seçimi, yer tutucular, üslup rehberi, mülk talimatı, `suggestReply`, gerçek
// otomatik gönderim kapısı. HİÇBİR ŞEY GÖNDERİLMEZ; konuşma / risk / öğe / iz satırı YAZILMAZ (yalnız karşılaştırma satırı).
// Parite `tests/integration/history-learn-compare.test.ts` ile pinli: aynı soru için bu yol ve test rotası modele AYNI istemi gönderir.
//
// Soru MASKELİ gelir (`maskForLearning`: ad / telefon / kapı kodu) — model geçmiş misafirin kimliğini görmez. Örnek konaklama test
// rotasıyla aynı biçimde, sorunun SORULDUĞU ana göre kurulur (dün giriş, 3 gün sonra çıkış): "bugün / yarın" o güne göre okunur.
// ---------------------------------------------------------------------------

/** Örnek misafir — test rotasıyla AYNI (`api/ai/test` `TEST_GUEST_NAME`). */
export const DRY_RUN_GUEST_NAME = "Ada Demir";
export const DRY_RUN_GUEST_GIVEN_NAME = "Ada";

export interface DryRunProperty {
  id: string;
  name: string;
  checkInTime: string;
  checkOutTime: string;
  address: string | null;
  city: string | null;
}

export interface DryRunResult {
  reply: string | null;
  wouldAutoSend: boolean;
  intent: string | null;
  riskLevel: string | null;
}

export async function dryRunReply(input: {
  organizationId: string;
  property: DryRunProperty;
  message: string;
  now: Date;
}): Promise<DryRunResult> {
  const { property, message, now } = input;
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { aiStyleProfile: true, lateCheckoutOfferText: true, timezone: true },
  });
  const { items: kbRaw, dropped: kbDropped } = await fetchKnowledgeBaseForPrompt({ propertyId: property.id, isActive: true });
  const sampleStay = {
    arrivalDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    departureDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    status: "confirmed",
  };
  const kbSel = await retrieveKbForPrompt({
    items: kbRaw,
    placeholders: { guestFirstName: modelGuestFirstName(DRY_RUN_GUEST_NAME), propertyName: property.name },
    guestMessage: message,
    history: [],
    stayTimes: { checkIn: property.checkInTime, checkOut: property.checkOutTime },
    dateContext: { now, timeZone: org?.timezone, reservation: sampleStay },
  });
  const result = await suggestReply({
    guestMessage: message,
    property: {
      name: property.name,
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      address: property.address,
      city: property.city,
    },
    reservation: { guestName: DRY_RUN_GUEST_NAME, guestGivenName: DRY_RUN_GUEST_GIVEN_NAME, ...sampleStay },
    knowledgeBase: kbSel.items,
    knowledgeBaseDropped: kbDropped + kbSel.droppedItems,
    knowledgeBaseSelection: kbSel.selection,
    knowledgeBaseNotes: kbSel.notes,
    history: [],
    tone: "warm",
    language: "tr",
    styleProfile: styleProfileForPrompt(org?.aiStyleProfile),
    hostInstructions: await loadPromptInstructions(input.organizationId, property.id),
    lateCheckoutOfferText: org?.lateCheckoutOfferText,
    timeZone: org?.timezone,
  });
  const understood = await kbSel.understanding;
  const wouldAutoSend = passesAutoReplySafetyGate(
    {
      intent: result.intent,
      riskLevel: result.riskLevel,
      confidence: result.confidence,
      source: result.source,
      riskType: result.riskType ?? null,
      reply: result.reply,
      stayChange: result.stayChange ?? null,
      timeConflicts: result.timeConflicts ?? null,
      claimedActions: result.claimedActions ?? null,
    },
    message,
    {
      stayTimes: { checkIn: property.checkInTime, checkOut: property.checkOutTime },
      understanding: understood?.stay ?? null,
      understandingRisk: understandingRiskOf(understood),
      hostOfferText: hostOfferForGate(org?.lateCheckoutOfferText),
      kbFacts: kbFactsOf(kbSel.items),
    },
  );
  return { reply: result.reply ?? null, wouldAutoSend, intent: result.intent ?? null, riskLevel: result.riskLevel ?? null };
}
