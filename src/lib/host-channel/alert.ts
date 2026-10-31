import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
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
//    WhatsApp üretmez. Satır yalnız iz + tavan sayacıdır (metin taşımaz); durumu "alerted" — cevap beklenen soru DEĞİL. GİTMEMİŞ bildirim
//    ("failed" ya da gönderim ortasında süreç düşmüş, bayat "queued") yol yeniden çağırınca (e-posta da düşüp tur yeniden denenince) aynı satır
//    üzerinden tek sahiple yeniden denenir (sert inceleme 10-31 R-4).
//  · İşletme başına saatte en çok `ALERT_HOURLY_CAP` bildirim (aşan yalnız e-postada kalır). Tavan YALNIZ bildirimleri sayar: sorular acili
//    kesmez; tersi bilinçli — soru tavanı (`ask.ts`) bildirimleri de sayar, acil sel varken sorular e-postaya düşer (ev sahibine toplam yük).
//  · Misafirin adı / telefonu / e-postası gitmez (soru metniyle aynı maskeli alıntı). Asla fırlatmaz: e-posta zaten bugünkü yoldan gider.
// ---------------------------------------------------------------------------

export const ALERT_HOURLY_CAP = 10;
const HOUR_MS = 60 * 60 * 1000;
const ALERT_RECORD_TTL_MS = 24 * HOUR_MS;
/** "queued" satırı bu kadar süredir yazılmadıysa gönderen süreç düşmüştür (aktarım zaman aşımı 10 sn) — yeniden denenebilir. */
const STALE_QUEUED_MS = 2 * 60 * 1000;
/** Kesin gönderim hatasının (şablon uyuşmazlığı, numara) alarm anahtarı — işletme başına, geçiş tabanlı (`alert-state`). */
const failureAlarmKey = (organizationId: string) => `host-channel:alert:${organizationId}`;

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
  let delivered = false;
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

    const idempotencyKey = `alert:${input.messageId}`;
    const fresh = randomUUID();
    try {
      await prisma.hostQuestion.create({
        data: {
          id: fresh,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          bindingId: binding.id,
          kind: "alert",
          turnMessageId: input.messageId,
          status: "queued",
          idempotencyKey,
          expiresAt: new Date(now.getTime() + ALERT_RECORD_TTL_MS),
        },
      });
      alertId = fresh;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      // Bu mesajın kaydı var: gittiyse ya da şu an gönderiliyorsa ikinci bildirim YOK; gitmediyse tek sahiple yeniden dene (CAS).
      const prev = await prisma.hostQuestion.findFirst({
        where: { organizationId: input.organizationId, idempotencyKey, kind: "alert" },
        select: { id: true, status: true, version: true, updatedAt: true },
      });
      const retryable =
        prev !== null && (prev.status === "failed" || (prev.status === "queued" && prev.updatedAt.getTime() < now.getTime() - STALE_QUEUED_MS));
      if (!prev || !retryable) return "duplicate";
      const won = await prisma.hostQuestion.updateMany({
        where: { id: prev.id, status: prev.status, version: prev.version },
        data: { status: "queued", bindingId: binding.id, version: { increment: 1 } },
      });
      if (won.count !== 1) return "duplicate";
      alertId = prev.id;
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
      await prisma.hostQuestion.updateMany({ where: { id: alertId, status: "queued" }, data: { status: "failed", version: { increment: 1 } } });
      // İz (yalnız hata kodu) + kesin hatada geçiş tabanlı tek alarm (sert inceleme M-5; tasarım §3.11 "şablon reddi → tek alarm").
      const reason = sent.ok ? "no_message_id" : (sent.error ?? "unknown");
      await logEvent("host_channel.alert.failed", { reason }, { organizationId: input.organizationId }).catch(() => null);
      if (sent.definitive) {
        await alertOnTransition(failureAlarmKey(input.organizationId), "host-channel alert failed", new Error(reason)).catch(() => null);
      }
      return "failed";
    }
    delivered = true;
    await prisma.hostQuestion.updateMany({
      where: { id: alertId, status: "queued" },
      data: { status: "alerted", sentAt: now, providerMessageId: sent.providerMessageId, version: { increment: 1 } },
    });
    await logEvent("host_channel.alert.sent", {}, { organizationId: input.organizationId }).catch(() => null);
    await clearAlertState(failureAlarmKey(input.organizationId));
    return "sent";
  } catch {
    // Bildirim GİTTİYSE sonraki kayıt hatası onu "gitmedi" yapmaz (ikinci deneme ikinci WhatsApp olurdu).
    if (delivered) return "sent";
    if (alertId) await prisma.hostQuestion.updateMany({ where: { id: alertId, status: "queued" }, data: { status: "failed" } }).catch(() => null);
    return "failed";
  }
}
