import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { stayRequestKinds, type AvailabilityPolicyOptions } from "@/lib/ai/availability-claims";
import { explicitTimeMentions } from "@/lib/early-checkin/text-checks";
import { calendarDateOf, todayKey } from "@/modules/availability/core";
import { reportError } from "@/lib/report-error";
import { decisionDayKey, decisionKindsOf, decisionLang, requestedTimeOf, timeOnRightSide, type DecisionKind } from "./core";
import { findTurnDecision, openTurnDecisions, type PersistedDecision } from "./store";

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
  /** Cevapsız misafir mesajları — İLK eleman turun SON mesajı (otomasyonun `[last.body, ...bekleyenler]` sırası). */
  guestTexts: readonly string[];
  /** Kapının politika girdisi (`availabilityPolicyFor`) — birleşim kuralı ve model saat okumaları buradan. */
  policy: AvailabilityPolicyOptions;
  /** Bu turun kalıcı konuşma öğeleri (varsa): kart aynı isteğin öğesine bağlanır, mesajı onun mesajıdır. */
  items: readonly { id: string; kind: string; messageId: string }[];
  /** Turun son misafir mesajı (öğe yoksa kartın mesajı). */
  lastMessageId: string;
  /** Bu turun TÜM cevapsız misafir mesajları (son mesaj dahil) — aynı talebe bağlı var olan kart yeniden kullanılır. */
  turnMessageIds: readonly string[];
  /** Misafirin dili (kodun kesin tespiti, yoksa cevap modelinin beyanı). */
  language: string | null | undefined;
  /** Bu turda kart AÇILMAYACAK türler (doğrulanmış otomatik onay / politika metni seçildi). */
  skipKinds?: readonly DecisionKind[];
  now: Date;
}

/**
 * Mesaj KARŞI yuvayı da anıyor mu (erken giriş kartında çıkış, geç çıkış kartında giriş sözcüğü) — o zaman mesajdaki tek saat hangi
 * yuvanın olduğu bilinmez ("Erken girip çıkışı 14:00'te yapabilir miyiz?") → deterministik yedek saat YAZMAZ (yalnız sıkılaştırır:
 * saat boş kalır, ev sahibi kartta seçer).
 */
const CHECKOUT_WORDS = /(ç[ıi]k[ıi]ş|ç[ıi]kma|ç[ıi]kab|ç[ıi]kar|check[\s-]?out|departure|depart|leave|auscheck|abreise|salida|выезд|مغادرة|الخروج)/iu;
const CHECKIN_WORDS = /(gir[ıi]ş|girme|gireb|varış|check[\s-]?in|arrival|arrive|einchecken|anreise|arrivée|entrada|llegada|заезд|заселен|الدخول|الوصول)/iu;

function mentionsOtherSlot(kind: DecisionKind, texts: readonly string[]): boolean {
  const re = kind === "early_checkin" ? CHECKOUT_WORDS : CHECKIN_WORDS;
  return texts.some((t) => re.test(t.toLocaleLowerCase("tr-TR")));
}

/** Modellerin okuduğu HER saat (taraf / tür süzgecinsiz) — deterministik yedeğin "hiç okuma yok" şartı. */
function anyModelTime(policy: AvailabilityPolicyOptions): boolean {
  const u = policy.understanding;
  const g = policy.guard?.status === "ok" ? policy.guard.verdict : null;
  return [u?.checkinTime, u?.checkoutTime, g?.requestedCheckinTime, g?.requestedCheckoutTime].some((t) => typeof t === "string" && t.trim() !== "");
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

type DecisionToOpenLocal = { kind: DecisionKind; messageId: string; itemId: string | null; requestedTime: string | null; dayKey: string | null };

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
    // Deterministik yedek: cevapsız mesajlarda tek açık saat anması (iki saat varsa hangisi olduğu bilinmez → boş). YALNIZ turda TEK
    // saatli tür varken, hiçbir model hiçbir saat okumamışken ve mesaj karşı yuvayı anmıyorken: "erken girip 14:00'te çıkabilir
    // miyiz?" saati erken girişe yazılmasın. Saati SON mesaj yazdıysa o esas ("13:00?" → "Pardon, 12:00 olur mu?": yeni saat 12:00 —
    // eski kartın yerine geçer); son mesajda saat yoksa tüm cevapsız mesajlar.
    const timedKinds = kinds.filter((k) => k === "early_checkin" || k === "late_checkout");
    const lastMentions = explicitTimeMentions(input.guestTexts[0] ?? "");
    const mentions =
      timedKinds.length === 1 && !anyModelTime(input.policy) && !mentionsOtherSlot(timedKinds[0], input.guestTexts)
        ? lastMentions.length > 0
          ? lastMentions
          : input.guestTexts.flatMap((t) => explicitTimeMentions(t))
        : [];
    const today = todayKey(input.now, input.timeZone);
    const decisions: DecisionToOpenLocal[] = [];
    for (const kind of kinds) {
      const dayKey = decisionDayKey(kind, stayKeys);
      // Günü geçmiş talep için kart açılmaz (açılır açılmaz "süresi geçti" olurdu; e-posta da gitmez).
      if (dayKey !== null && dayKey < today) continue;
      const item = [...input.items].reverse().find((i) => i.kind === kind) ?? null;
      const readings = modelReadings(kind, input.policy);
      const time = requestedTimeOf(readings, readings.length > 0 ? [] : mentions);
      const standard = kind === "early_checkin" ? (input.policy.stayTimes?.checkIn ?? null) : (input.policy.stayTimes?.checkOut ?? null);
      // Deterministik okuma da standardın doğru tarafında olmalı ("15:00'te geleceğiz" erken giriş saati değildir).
      const requestedTime = time && timeOnRightSide(kind, time, standard) !== false ? time : null;
      // Aynı talebin kartı bu turda zaten var (misafir "?" / "teşekkürler" ekledi; tur yeniden değerlendirildi): yeni kart AÇILMAZ —
      // var olan kart kullanılır (bildirim tekrar gitmez). Saat DEĞİŞTİYSE (13:00 → 12:00) yeni kart eskisinin yerine geçer.
      const existing = await findTurnDecision(db, {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        kind,
        messageIds: input.turnMessageIds,
      });
      if (existing && (existing.requestedTime === null || requestedTime === null || existing.requestedTime === requestedTime)) {
        decisions.push({ kind, messageId: existing.messageId, itemId: existing.itemId, requestedTime, dayKey });
        continue;
      }
      decisions.push({ kind, messageId: item?.messageId ?? input.lastMessageId, itemId: item?.id ?? null, requestedTime, dayKey });
    }
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
