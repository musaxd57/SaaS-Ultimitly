import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ANON_BODY } from "@/lib/data-retention";
import { emailService } from "@/lib/email";
import { complaintEscalationEmail } from "@/lib/email-templates";
import { logEvent } from "@/lib/event-log";
import { reportError } from "@/lib/report-error";
import { hostAlertRouteOpen, type HostAlertOutcome } from "./alert";
import type { HostChannelTransport } from "./types";

// ---------------------------------------------------------------------------
// HİBRİT ACİL E-POSTASI (tasarım §3.12; kurucu kararı 10-31 sabah: "genelde wp gidiyorsa acil e-posta gitmesin, hibrit akış olsun" →
// WhatsApp önce; 10 dk içinde OKUNMAZSA ya da gönderilemezse e-posta; can güvenliği acillerinde ikisi birden hemen).
//  · Can güvenliği ya da WhatsApp yolu kapalı (anahtar / işletme listesi / aktarım / sır) → BUGÜNKÜ kod birebir: e-posta + bildirim aynı anda.
//  · Standart → ① ertelenmiş e-posta kaydı (`SystemLock` `host-alert-mail:<mesaj>`, `lockedUntil` = VADE) WhatsApp'tan ÖNCE yazılır — çökme
//    e-postayı kaybettirmez ② WhatsApp ③ gitti → e-posta şimdi YOK, çağıran "bildirildi" sayar; gitmedi → e-posta HEMEN + kayıt silinir.
//  · Vade görevi (`deliverDueAlertEmails`, her senkron geçişinde): kayıt kiralanır (CAS); bildirim OKUNDUYSA e-posta yok; değilse aynı şablon
//    mesajdan yeniden kurulur. Hata → 2 dk sonra yeniden; 72 saatten eski / silinmiş / alıcısız → bırakılır.
//  · ⚠️ `lockedUntil` burada VADE anlamındadır (öteki öneklerde son kullanma): bu öneki toptan silen genel bir süpürge YAZILMAZ.
//  · Kayıt adı yalnız mesaj kimliği taşır (metin / ad yok).
// ---------------------------------------------------------------------------

export const ALERT_MAIL_PREFIX = "host-alert-mail:";
export const ALERT_MAIL_DEFER_MS = 10 * 60_000;
const LEASE_MS = 3 * 60_000;
const RETRY_MS = 2 * 60_000;
const GIVE_UP_MS = 72 * 60 * 60_000;
const BATCH = 50;
const BUDGET_MS = 30_000;

export const alertMailLockName = (messageId: string) => `${ALERT_MAIL_PREFIX}${messageId}`;

export interface UrgentDelivery {
  /** E-posta gitti YA DA WhatsApp gitti ve e-posta ertelendi — çağıran "bildirildi" sayar (talep / damga tutulur). */
  ok: boolean;
  deferred: boolean;
}

/**
 * Acil uyarının TEK teslim noktası (kelime uyarı geçişi · tutulan hassas öğe · model yükseltmesi). `sendEmail` bugünkü e-posta çağrısıdır
 * (sonucu okunur), `whatsapp` bugünkü bildirim çağrısı (asla fırlatmamalı; fırlatırsa "gitmedi" sayılır).
 */
export async function deliverUrgentAlert(input: {
  organizationId: string;
  messageId: string;
  lifeSafety: boolean;
  transport: HostChannelTransport | null;
  sendEmail: () => Promise<{ ok: boolean }>;
  whatsapp: () => Promise<HostAlertOutcome | unknown>;
  now?: Date;
}): Promise<UrgentDelivery> {
  const concurrently = async (): Promise<UrgentDelivery> => {
    // Bugünkü davranış: e-posta + bildirim AYNI ANDA (yavaş sağlayıcı acil e-postayı geciktirmez); bildirimin hatası e-postayı etkilemez.
    const [mail] = await Promise.all([input.sendEmail(), Promise.resolve().then(input.whatsapp).catch(() => null)]);
    return { ok: mail.ok, deferred: false };
  };
  if (input.lifeSafety || !hostAlertRouteOpen(input.organizationId, input.transport)) return concurrently();

  const now = input.now ?? new Date();
  const name = alertMailLockName(input.messageId);
  try {
    await prisma.systemLock.create({ data: { name, lockedUntil: new Date(now.getTime() + ALERT_MAIL_DEFER_MS), holder: null } });
  } catch (err) {
    // Bu mesaj için ertelenmiş e-posta zaten kayıtlı (eşzamanlı / yeniden işlenen geçiş): o kayıt vadesinde karar verir.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: true, deferred: true };
    // Kayıt deposu arızası → güvenli yön: bugünkü eşzamanlı yol.
    return concurrently();
  }
  const outcome = await Promise.resolve()
    .then(input.whatsapp)
    .catch(() => null);
  if (outcome === "sent" || (outcome === "duplicate" && (await alertDelivered(input.organizationId, input.messageId)))) {
    await logEvent("host_channel.alert.email_deferred", {}, { organizationId: input.organizationId }).catch(() => null);
    return { ok: true, deferred: true };
  }
  // WhatsApp gitmedi (numara yok, tavan, hata) → e-posta HEMEN. Kayıt e-postadan ÖNCE silinir: başarılı e-postanın ardından kalan kayıt
  // 10 dk sonra ikinci e-posta doğururdu (inceleme 10-31). E-posta düşerse çağıranın yeniden denemesi yeni kayıt açar.
  await prisma.systemLock.deleteMany({ where: { name, holder: null } }).catch(() => null);
  const mail = await input.sendEmail();
  return { ok: mail.ok, deferred: false };
}

async function alertDelivered(organizationId: string, messageId: string): Promise<boolean> {
  const row = await prisma.hostQuestion
    .findFirst({ where: { organizationId, idempotencyKey: `alert:${messageId}` }, select: { status: true } })
    .catch(() => null);
  return row?.status === "alerted";
}

/** Sağlayıcı bildirimi "başarısız" dedi (gönderildi sanılan WhatsApp ulaşmadı) → ertelenmiş e-posta bir sonraki geçişte gider. */
export async function expediteDeferredAlertEmail(messageId: string, now: Date = new Date()): Promise<void> {
  await prisma.systemLock.updateMany({ where: { name: alertMailLockName(messageId), holder: null }, data: { lockedUntil: now } }).catch(() => null);
}

/** Durum bildirimindeki "failed" kimlikleri → o acil bildirimlerin ertelenmiş e-postaları öne çekilir. */
export async function expediteForFailedProviderIds(providerMessageIds: readonly string[], now: Date = new Date()): Promise<void> {
  if (providerMessageIds.length === 0) return;
  const ids = [...new Set(providerMessageIds)].slice(0, 200);
  const rows = await prisma.hostQuestion.findMany({
    where: { providerMessageId: { in: ids }, kind: "alert" },
    select: { turnMessageId: true },
  });
  // Bildirim "ulaşmadı" olarak işaretlenir (ham SQL — `updatedAt` / sürüm değişmez): sonradan gelen düz ev sahibi mesajı onu "okundu"
  // yapamaz, düz mesaj yönlendirmesi de onu seçmez (yalnız "alerted"). İnceleme 10-31.
  await prisma.$executeRaw`UPDATE "HostQuestion" SET "status" = 'failed' WHERE "providerMessageId" = ANY(${ids}) AND "kind" = 'alert' AND "status" = 'alerted'`;
  for (const r of rows) await expediteDeferredAlertEmail(r.turnMessageId, now);
}

type DueOutcome = "sent" | "cancelled_read" | "dropped" | "retry" | "no_recipient";

/** `clock`: süre bütçesinin saati (test edilebilir); vade kararları `now` ile. */
export async function deliverDueAlertEmails(now: Date = new Date(), clock: () => number = Date.now): Promise<Record<DueOutcome, number>> {
  const counts: Record<DueOutcome, number> = { sent: 0, cancelled_read: 0, dropped: 0, retry: 0, no_recipient: 0 };
  const started = clock();
  const due = await prisma.systemLock.findMany({
    where: { name: { startsWith: ALERT_MAIL_PREFIX }, lockedUntil: { lte: now } },
    orderBy: [{ lockedUntil: "asc" }, { name: "asc" }],
    take: BATCH,
    select: { name: true, lockedUntil: true, holder: true },
  });
  for (const row of due) {
    if (clock() - started > BUDGET_MS) break;
    const token = randomUUID();
    // Kiralama (CAS): yalnız bir geçiş gönderir; kiralayan düşerse kira süresi dolunca kayıt yeniden vadeli olur.
    const won = await prisma.systemLock.updateMany({
      where: { name: row.name, lockedUntil: row.lockedUntil, holder: row.holder },
      data: { holder: token, lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (won.count !== 1) continue;
    let outcome: DueOutcome;
    try {
      outcome = await deliverOne(row.name.slice(ALERT_MAIL_PREFIX.length), now);
    } catch {
      outcome = "retry";
    }
    counts[outcome]++;
    if (outcome === "retry") {
      await prisma.systemLock
        .updateMany({ where: { name: row.name, holder: token }, data: { holder: null, lockedUntil: new Date(now.getTime() + RETRY_MS) } })
        .catch(() => null);
    } else {
      await prisma.systemLock.deleteMany({ where: { name: row.name, holder: token } }).catch(() => null);
    }
  }
  return counts;
}

async function deliverOne(messageId: string, now: Date): Promise<DueOutcome> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      body: true,
      createdAt: true,
      conversation: {
        select: {
          id: true,
          guestIdentifier: true,
          channel: true,
          property: {
            select: {
              name: true,
              address: true,
              city: true,
              organizationId: true,
              organization: {
                select: {
                  name: true,
                  alertEmail: true,
                  users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  // Mesaj / konuşma silindi ya da içerik saklama / silme ile anonimleşti → e-posta yok (metin geri yazılmaz).
  if (!message || message.body === ANON_BODY) return "dropped";
  const property = message.conversation.property;
  const alert = await prisma.hostQuestion.findFirst({
    where: { organizationId: property.organizationId, idempotencyKey: `alert:${messageId}` },
    select: { id: true, readAt: true, status: true, sentAt: true, createdAt: true },
  });
  // Okundu → e-posta yok. Sağlayıcı "ulaşmadı" dediyse (status "failed") okundu sayılmaz (inceleme 10-31).
  if (alert?.readAt && alert.status !== "failed") {
    await logEvent("host_channel.alert.email_cancelled_read", {}, { organizationId: property.organizationId }).catch(() => null);
    return "cancelled_read";
  }
  // Vazgeçme süresi ERTELEMEDEN sayılır (bildirimin gönderim anı), mesajın sağlayıcı zamanından DEĞİL: kesintiden sonra işlenen 4 günlük
  // mesajın e-postası ilk denemede atılıyordu (inceleme 10-31). Bildirim satırı yoksa yaşa göre hiç bırakılmaz.
  const anchor = alert ? (alert.sentAt ?? alert.createdAt) : null;
  if (anchor && now.getTime() - anchor.getTime() > GIVE_UP_MS) {
    await reportError("host-channel-alert-email", new Error("Ertelenmiş acil e-postası 72 saati aştı — gönderilmedi")).catch(() => null);
    return "dropped";
  }
  // Alıcı: bugünkü kuralla aynı (işletmenin uyarı adresi, yoksa ilk sahibin e-postası; asla personel / ortam adresi).
  const org = property.organization;
  const to = org.alertEmail?.trim() || org.users[0]?.email?.trim();
  if (!to) return "no_recipient";
  const conv = message.conversation;
  const html = complaintEscalationEmail(
    { id: conv.id, guestIdentifier: conv.guestIdentifier, channel: conv.channel, priority: "urgent" },
    message.body,
    { name: property.name, address: property.address, city: property.city },
    org.name ?? "Lixus AI",
  );
  const mail = await emailService.sendReporting(to, `⚠️ Acil misafir mesajı — ${conv.guestIdentifier} (${property.name})`, html, {
    idempotencyKey: alertMailLockName(messageId),
  });
  if (!mail.ok) return "retry";
  await logEvent("host_channel.alert.email_fallback", {}, { organizationId: property.organizationId }).catch(() => null);
  return "sent";
}
