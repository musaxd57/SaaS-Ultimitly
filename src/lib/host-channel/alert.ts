import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/event-log";
import { calendarDateOf } from "@/modules/availability/core";
import { activeBindingAddress, hostChannelSecret, usableHostBindingForOrg } from "./binding";
import { buildHostQuestion } from "./question-text";
import { chooseHostChannel, hostChannelFlagsFromEnv } from "./routing";
import type { HostChannelTransport } from "./types";

// ---------------------------------------------------------------------------
// ACİL BİLDİRİM — Tür C (tasarım §3.1 dilim 4; kurucu 10-29 gece: "en önemli ev sahibi bildirimleri ileride WhatsApp'tan da"). Ev sahibinde
// tutulan hassas / acil istek (kayıp anahtar, kilitli kalma, güvenlik, ödeme, şikâyet — `notifyHeldItems`) için bugünkü ACİL E-POSTANIN YANINDA
// (yerine DEĞİL — S3 önerisi: acilde ikisi birden, kaçırılmaması daha önemli) onaylı şablonla WhatsApp bildirimi. Cevap KURULMAZ: ev sahibi
// konuşmayı panelde açar; bildirime yazılan cevap misafire gitmez (`answer.ts`: "panelden yazın").
//
//  · Anahtar `HOST_QUESTION_ALERTS_ENABLED` + kanal anahtarı + işletme listesi + doğrulanmış numara; biri yoksa veritabanına dokunmadan çıkar.
//  · Mesaj başına TEK bildirim: `HostQuestion` satırı (`kind: "alert"`, tekil `alert:<mesaj>` anahtarı) — eşzamanlı / yeniden işlenen geçiş ikinci
//    WhatsApp üretmez. Satır yalnız iz + tavan sayacıdır (metin taşımaz); durumu "alerted" — cevap beklenen soru DEĞİL.
//  · İşletme başına saatte en çok `ALERT_HOURLY_CAP` bildirim (aşan yalnız e-postada kalır). Tavan YALNIZ bildirimleri sayar: sorular acili
//    kesmez; tersi bilinçli — soru tavanı (`ask.ts`) bildirimleri de sayar, acil sel varken sorular e-postaya düşer (ev sahibine toplam yük).
//  · Misafirin adı / telefonu / e-postası gitmez (soru metniyle aynı maskeli alıntı). Asla fırlatmaz: e-posta zaten bugünkü yoldan gider.
// ---------------------------------------------------------------------------

export const ALERT_HOURLY_CAP = 10;
const HOUR_MS = 60 * 60 * 1000;
const ALERT_RECORD_TTL_MS = 24 * HOUR_MS;

export type HostAlertOutcome = "sent" | "skipped" | "duplicate" | "capped" | "failed";

export async function alertHostOnChannel(input: {
  organizationId: string;
  conversationId: string;
  /** Acil isteği taşıyan misafir mesajı (tekillik anahtarı). */
  messageId: string;
  messageBody: string;
  transport: HostChannelTransport | null;
  now?: Date;
}): Promise<HostAlertOutcome> {
  const flags = hostChannelFlagsFromEnv();
  // Ucuz ön eleme — kapalı anahtar / liste dışı işletme: veritabanına dokunmadan çık.
  if (chooseHostChannel({ kind: "urgent", orgId: input.organizationId, flags, binding: "verified", orgSentLastHour: 0 }) !== "whatsapp") return "skipped";
  if (!input.transport || !hostChannelSecret()) return "skipped";
  const now = input.now ?? new Date();
  let alertId: string | null = null;
  try {
    const binding = await usableHostBindingForOrg(input.organizationId);
    if (!binding) return "skipped";
    const lastHour = await prisma.hostQuestion.count({
      where: { organizationId: input.organizationId, kind: "alert", sentAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    });
    if (lastHour >= ALERT_HOURLY_CAP) return "capped";
    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, property: { organizationId: input.organizationId } },
      select: {
        guestIdentifier: true,
        property: { select: { name: true, organization: { select: { timezone: true } } } },
        reservation: { select: { arrivalDate: true, departureDate: true, guestName: true, guestGivenName: true } },
      },
    });
    const res = conv?.reservation;
    if (!conv || !res) return "skipped";
    const to = await activeBindingAddress(binding.id, input.organizationId);
    if (!to) return "skipped";

    alertId = randomUUID();
    try {
      await prisma.hostQuestion.create({
        data: {
          id: alertId,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          bindingId: binding.id,
          kind: "alert",
          turnMessageId: input.messageId,
          status: "queued",
          idempotencyKey: `alert:${input.messageId}`,
          expiresAt: new Date(now.getTime() + ALERT_RECORD_TTL_MS),
        },
      });
    } catch (err) {
      alertId = null;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
      throw err;
    }

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
      guestNames: [res.guestName, res.guestGivenName, conv.guestIdentifier].filter((n): n is string => typeof n === "string" && n.length > 0),
    });
    const sent = await input.transport.sendAlert(to, { ...message, link: input.conversationId });
    if (!sent.ok || !sent.providerMessageId) {
      await prisma.hostQuestion.updateMany({ where: { id: alertId, status: "queued" }, data: { status: "failed" } });
      return "failed";
    }
    await prisma.hostQuestion.updateMany({
      where: { id: alertId, status: "queued" },
      data: { status: "alerted", sentAt: now, providerMessageId: sent.providerMessageId, version: { increment: 1 } },
    });
    await logEvent("host_channel.alert.sent", {}, { organizationId: input.organizationId }).catch(() => null);
    return "sent";
  } catch {
    if (alertId) await prisma.hostQuestion.updateMany({ where: { id: alertId, status: "queued" }, data: { status: "failed" } }).catch(() => null);
    return "failed";
  }
}
