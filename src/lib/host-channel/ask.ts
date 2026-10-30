import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { decryptSecretBound } from "@/lib/crypto";
import { calendarDateOf } from "@/modules/availability/core";
import { usableHostBindingForOrg, hostChannelSecret, revokeHostBinding } from "./binding";
import { addressHash } from "./binding-code";
import { buildHostQuestion } from "./question-text";
import { chooseHostChannel, hostAskKindOf, hostChannelFlagsFromEnv, type HostAskTrigger } from "./routing";
import type { HostChannelTransport } from "./types";

// ---------------------------------------------------------------------------
// EV SAHİBİNE SORU — Tür A (bilgi sorusu) gönderimi (tasarım §3.1–3.3; kurucu 10-30: "hosta kısaca soruyu sorup alınması gereken yanıtı alıp …").
// Tek çağıran bugünkü "Misafir cevabınızı bekliyor" bildirimi (`host-reply-waiting.ts`, mesaj başına tek talep); WhatsApp gönderilirse o mesaj
// için e-posta GİTMEZ (S3 önerisi A: WhatsApp birincil, e-posta yedek), gönderilemezse hemen bugünkü e-posta.
//
//  · Anahtarlar / işletme listesi / tür kapalıysa veritabanına HİÇ dokunulmaz (`chooseHostChannel` önce sahte "doğrulanmış" bağlantıyla sorulur).
//  · Öğe türleri BİLİNMİYORSA (öğesiz yol) soru WhatsApp'a gitmez: para / iade / konaklama değişikliği bilgi sorusuna dönüşmesin (`email_only`).
//  · Soru kaydı tur başına tek (`turn:<mesaj kimliği>`); aynı tur yeniden değerlendirilirse ikinci WhatsApp yok. Önceki deneme gönderilemediyse
//    (ya da yarıda kaldıysa) e-posta yoluna düşülür — sessiz kalmaktansa yinelenen bildirim.
//  · Misafirin adı / telefonu / e-postası WhatsApp'a gitmez (`buildHostQuestion`: maskeli, en çok 160 karakter alıntı).
//  · Asla fırlatmaz; her beklenmedik hata → "email" (bugünkü davranış).
// ---------------------------------------------------------------------------

export const HOST_QUESTION_TTL_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** `whatsapp`: soru gitti, e-posta gönderilmez. `duplicate`: bu tura soru zaten gitti — e-posta da gönderilmez. */
export type AskHostOutcome = "email" | "none" | "whatsapp" | "duplicate";

const addressAad = (bindingId: string, organizationId: string) => `host-channel-address:v1:${bindingId}:${organizationId}`;

export async function askHostOnChannel(input: {
  organizationId: string;
  conversationId: string;
  /** Turun bildirilen misafir mesajı (soru kaydının tekillik anahtarı). */
  messageId: string;
  messageBody: string;
  trigger: HostAskTrigger;
  /** Turun öğe türleri; bilinmiyorsa `undefined` → WhatsApp'a gitmez. */
  itemKinds: readonly string[] | undefined;
  transport: HostChannelTransport | null;
  now?: Date;
}): Promise<AskHostOutcome> {
  const flags = hostChannelFlagsFromEnv();
  // Bu yol yalnız BİLGİ sorusu kurar (Tür A); karar / acil türleri kendi diliminde (Haiku 10-30 P3-5) → e-posta.
  const classified = input.itemKinds === undefined ? "email_only" : hostAskKindOf(input.trigger, input.itemKinds);
  const kind = classified === "info" || classified === "silent" ? classified : "email_only";
  // Ucuz ön eleme — kapalı anahtar / liste dışı işletme / tür kapalı / e-posta-yalnız tür: veritabanına dokunmadan bugünkü yol.
  const pre = chooseHostChannel({ kind, orgId: input.organizationId, flags, binding: "verified", orgSentLastHour: 0 });
  if (pre !== "whatsapp") return pre;
  const secret = hostChannelSecret();
  if (!input.transport || !secret) return "email";
  const now = input.now ?? new Date();
  let questionId: string | null = null;
  try {
    const binding = await usableHostBindingForOrg(input.organizationId);
    if (!binding) return "email";
    const sentLastHour = await prisma.hostQuestion.count({
      where: { organizationId: input.organizationId, sentAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    });
    // Ad `route`: ev sahibine bildirim yolu — misafir kanalı değil (değişmez 20 kalıbı "channel" + etiket karşılaştırmasını yalnız Channel
    // Layer'da kabul eder).
    const route = chooseHostChannel({ kind, orgId: input.organizationId, flags, binding: "verified", orgSentLastHour: sentLastHour });
    if (route !== "whatsapp") return route;

    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, property: { organizationId: input.organizationId } },
      select: {
        property: { select: { name: true, organization: { select: { timezone: true } } } },
        reservation: { select: { arrivalDate: true, departureDate: true, guestName: true, guestGivenName: true } },
        guestIdentifier: true,
      },
    });
    const res = conv?.reservation;
    if (!conv || !res) return "email";
    const row = await prisma.hostChannelBinding.findFirst({
      where: { id: binding.id, organizationId: input.organizationId, status: "active" },
      select: { addressEnc: true, addressHash: true, provider: true },
    });
    if (!row) return "email";
    // 🚨 Numara anahtarı (`HOST_CHANNEL_HMAC_SECRET`) değiştiyse bu satır artık bulunamaz: gelen "DUR" eşleşmez, ama soru gitmeye devam
    // ederdi (inceleme 10-30 gece). Özet şimdiki anahtarla tutmuyorsa bağlantı kapanır, e-postaya dönülür; ev sahibi yeniden bağlar.
    const to = decryptSecretBound(row.addressEnc, addressAad(binding.id, input.organizationId));
    if (addressHash(row.provider, to, secret) !== row.addressHash) {
      await revokeHostBinding({ bindingId: binding.id, organizationId: input.organizationId, reason: "key_rotated", now });
      return "email";
    }

    // Tur başına tek soru: tekil anahtar yarışı tek kazanır.
    const idempotencyKey = `turn:${input.messageId}`;
    questionId = randomUUID();
    try {
      await prisma.hostQuestion.create({
        data: {
          id: questionId,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          bindingId: binding.id,
          kind: "info",
          turnMessageId: input.messageId,
          status: "queued",
          idempotencyKey,
          expiresAt: new Date(now.getTime() + HOST_QUESTION_TTL_MS),
        },
      });
    } catch (err) {
      questionId = null;
      if ((err as { code?: string })?.code !== "P2002") throw err;
      const prior = await prisma.hostQuestion.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
        select: { status: true },
      });
      return prior && prior.status !== "queued" && prior.status !== "failed" ? "duplicate" : "email";
    }

    // Tek tarih kuralı (`calendarDateOf`): yalnız-tarih saklanan değer gününü korur, an değeri işletmenin saat dilimine göre okunur.
    const tz = conv.property.organization.timezone || "Europe/Istanbul";
    const dayMonth = (d: Date) => {
      const [, m, day] = calendarDateOf(d, tz).key.split("-").map(Number);
      return { day: day!, month: m! };
    };
    const message = buildHostQuestion({
      propertyName: conv.property.name,
      arrival: dayMonth(res.arrivalDate),
      departure: dayMonth(res.departureDate),
      guestText: input.messageBody,
      guestNames: [res.guestName, res.guestGivenName, conv.guestIdentifier].filter((n): n is string => typeof n === "string"),
    });
    const sent = await input.transport.sendQuestion(to, message);
    if (!sent.ok || !sent.providerMessageId) {
      await prisma.hostQuestion.updateMany({ where: { id: questionId, status: "queued" }, data: { status: "failed", fallbackEmailAt: now } });
      return "email";
    }
    await prisma.hostQuestion.updateMany({
      where: { id: questionId, status: "queued" },
      data: { status: "sent", sentAt: now, providerMessageId: sent.providerMessageId, version: { increment: 1 } },
    });
    return "whatsapp";
  } catch {
    if (questionId) {
      await prisma.hostQuestion
        .updateMany({ where: { id: questionId, status: "queued" }, data: { status: "failed", fallbackEmailAt: now } })
        .catch(() => {});
    }
    return "email";
  }
}
