import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { stayRequestKinds, type AvailabilityPolicyOptions } from "@/lib/ai/availability-claims";
import { explicitTimeMentions } from "@/lib/early-checkin/text-checks";
import { calendarDateOf } from "@/modules/availability/core";
import { reportError } from "@/lib/report-error";
import { decisionDayKey, decisionKindsOf, decisionLang, requestedTimeOf, timeOnRightSide, type DecisionKind } from "./core";
import { openTurnDecisions, type PersistedDecision } from "./store";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — OTO-YANIT TURUNDAN KART AÇMA (Faz 1). İstek türü kapının BİRLEŞİM kuralıyla (`stayRequestKinds`: kelime
// ağı ∨ cevap modelinin beyanı / niyeti ∨ anlama katmanı ∨ bekçi) — kart açan sinyal, otomatik gönderimi durduran sinyalin
// AYNISIDIR (ikisi ayrışamaz). Saat yalnız isteği GÖREN modelin okumasıdır ve standardın doğru tarafındadır (erken giriş
// standarttan önce, geç çıkış sonra); okuma yoksa / çelişkiliyse misafirin yazdığı TEK açık saat, o da yoksa saat boş — ev sahibi
// kartta seçer. Asla fırlatmaz (oto-yanıt geçişini düşüremez).
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

export interface TurnDecisionInput {
  organizationId: string;
  conversationId: string;
  reservation: { id: string; arrivalDate: Date; departureDate: Date } | null;
  timeZone: string;
  /** Cevapsız misafir mesajları (son mesaj + bekleyenler). */
  guestTexts: readonly string[];
  /** Kapının politika girdisi (`availabilityPolicyFor`) — birleşim kuralı ve model saat okumaları buradan. */
  policy: AvailabilityPolicyOptions;
  /** Bu turun kalıcı konuşma öğeleri (varsa): kart aynı isteğin öğesine bağlanır, mesajı onun mesajıdır. */
  items: readonly { id: string; kind: string; messageId: string }[];
  /** Turun son misafir mesajı (öğe yoksa kartın mesajı). */
  lastMessageId: string;
  /** Misafirin dili (kodun kesin tespiti, yoksa cevap modelinin beyanı). */
  language: string | null | undefined;
  /** Bu turda kart AÇILMAYACAK türler (doğrulanmış otomatik onay / politika metni seçildi). */
  skipKinds?: readonly DecisionKind[];
  now: Date;
}

/** Modelin okuduğu saat — yalnız isteği gören model, yalnız standardın doğru tarafındaysa. */
function modelReadings(kind: DecisionKind, policy: AvailabilityPolicyOptions): (string | null)[] {
  const out: (string | null)[] = [];
  const standard = kind === "early_checkin" ? (policy.stayTimes?.checkIn ?? null) : (policy.stayTimes?.checkOut ?? null);
  const pick = (t: string | null) => (timeOnRightSide(kind, t, standard) === true ? t : null);
  const u = policy.understanding;
  if (u?.requested) out.push(kind === "early_checkin" ? pick(u.checkinTime) : kind === "late_checkout" ? pick(u.checkoutTime) : null);
  const g = policy.guard?.status === "ok" ? policy.guard.verdict : null;
  if (g?.guestRequestsChange) {
    out.push(kind === "early_checkin" ? pick(g.requestedCheckinTime) : kind === "late_checkout" ? pick(g.requestedCheckoutTime) : null);
  }
  return out.filter((t): t is string => t !== null);
}

export async function openDecisionsForTurn(db: Db, input: TurnDecisionInput): Promise<PersistedDecision[]> {
  try {
    const skip = new Set(input.skipKinds ?? []);
    const kinds = decisionKindsOf(stayRequestKinds(input.guestTexts, input.policy)).filter((k) => !skip.has(k));
    if (kinds.length === 0) return [];
    const stayKeys = input.reservation
      ? {
          arrivalKey: calendarDateOf(input.reservation.arrivalDate, input.timeZone).key,
          departureKey: calendarDateOf(input.reservation.departureDate, input.timeZone).key,
        }
      : null;
    // Deterministik yedek: TÜM cevapsız mesajlarda tek açık saat anması (iki saat varsa hangisi olduğu bilinmez → boş).
    const mentions = input.guestTexts.flatMap((t) => explicitTimeMentions(t));
    const decisions = kinds.map((kind) => {
      const item = [...input.items].reverse().find((i) => i.kind === kind) ?? null;
      const readings = modelReadings(kind, input.policy);
      const fallback = kind === "early_checkin" || kind === "late_checkout" ? mentions : [];
      const time = requestedTimeOf(readings, readings.length > 0 ? [] : fallback);
      const standard = kind === "early_checkin" ? (input.policy.stayTimes?.checkIn ?? null) : (input.policy.stayTimes?.checkOut ?? null);
      return {
        kind,
        messageId: item?.messageId ?? input.lastMessageId,
        itemId: item?.id ?? null,
        // Deterministik okuma da standardın doğru tarafında olmalı ("15:00'te geleceğiz" erken giriş saati değildir).
        requestedTime: time && timeOnRightSide(kind, time, standard) !== false ? time : null,
        dayKey: decisionDayKey(kind, stayKeys),
      };
    });
    // "Çıkışı 13:00'e kadar uzatabilir miyiz?": kelime ağı "uzat"tan uzatma, modeller geç çıkış görür. Saatli geç çıkış talebi bir
    // GECE uzatması değildir → aynı turda saatli geç çıkış kartı varsa uzatma kartı açılmaz (iki kart ev sahibini yanıltırdı).
    const lateWithTime = decisions.some((d) => d.kind === "late_checkout" && d.requestedTime !== null);
    if (lateWithTime) decisions.splice(0, decisions.length, ...decisions.filter((d) => d.kind !== "extend_stay"));
    return await openTurnDecisions(db, {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      reservationId: input.reservation?.id ?? null,
      lang: decisionLang(input.language),
      decisions,
      now: input.now,
    });
  } catch (err) {
    void reportError(`host-decisions open org=${input.organizationId}`, err);
    return [];
  }
}
