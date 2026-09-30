import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { hostReplyWaitingEmail } from "@/lib/email-templates";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// MİSAFİR CEVAP BEKLİYOR (K10, kurucu kararı 09-30: "host görebilir gibi bir şey yazmasın, gerekirse hiç cevap üretilmesin,
// hosta haber verilsin"; seçim "Hiçbir şey gitmesin").
//
// Yapay zekânın kanal cevabı konuyu ev sahibine bırakıyordu ("mesajınız kaydedildi; ev sahibiniz görebilir") ve TUTULDU →
// misafire hiçbir şey gitmedi. Ev sahibi bunu gelen kutusunu açmadan da bilmeli: sade bir e-posta.
//
//   • Mesaj başına EN FAZLA BİR e-posta: atomik talep = `SystemLock` satırı (benzersiz ad, `create` yarışı tek kazanır —
//     `outbound-claim.ts` ile aynı ilke, çok kopyalı sunucuda da doğru). Aynı mesaj yeniden değerlendirilse de (erken giriş
//     yeniden adaylığı, eşzamanlı geçiş) ikinci e-posta gitmez.
//   • E-posta GİTMEZSE talep geri verilir (aynı mesaj yeniden değerlendirilirse tekrar denenir) + tek alarm.
//   • Alıcı acil e-postayla AYNI kural: org'un uyarı adresi, yoksa SAHİBİN e-postası — personel ya da operatör ASLA.
//   • Talep deposu okunamazsa e-posta GİTMEZ (fail-closed yönü: yinelenen e-posta yerine panel; konuşma gelen kutusunda
//     görünür kalır) — bu bildirim bir kolaylıktır, güvenlik kapısı değil.
//   • Asla fırlatmaz: oto-yanıt geçişini düşüremez.
// ---------------------------------------------------------------------------

const PREFIX = "reply-waiting-mail:";
/** Talep satırının ömrü: mesaj başına tekillik bu süre boyunca korunur; sonra süpürülür (oto-yanıt bu kadar eski mesajı modellemez). */
const CLAIM_TTL_MS = 45 * 24 * 60 * 60 * 1000;

export type HostReplyWaitingOutcome = "mailed" | "deduped" | "no_recipient" | "failed" | "unavailable";

export async function notifyHostReplyWaiting(input: {
  organizationId: string;
  conversation: { id: string; guestIdentifier: string; channel: string };
  property: { name: string; address: string | null; city: string | null };
  messageId: string;
  messageBody: string;
  now?: Date;
}): Promise<HostReplyWaitingOutcome> {
  const now = input.now ?? new Date();
  const name = `${PREFIX}${input.messageId}`;
  let claimed = false;
  try {
    const org = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: {
        name: true,
        alertEmail: true,
        users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
      },
    });
    const to = org?.alertEmail?.trim() || org?.users[0]?.email?.trim() || null;
    if (!to) return "no_recipient";

    // Fırsatçı süpürme: süresi dolmuş talep hiçbir şeyi tekilleştiremez.
    await prisma.systemLock
      .deleteMany({ where: { name: { startsWith: PREFIX }, lockedUntil: { lt: now } } })
      .catch(() => {});
    try {
      await prisma.systemLock.create({ data: { name, lockedUntil: new Date(now.getTime() + CLAIM_TTL_MS) } });
      claimed = true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "deduped";
      return "unavailable";
    }

    const html = hostReplyWaitingEmail(
      { id: input.conversation.id, guestIdentifier: input.conversation.guestIdentifier, channel: input.conversation.channel, priority: "normal" },
      input.messageBody,
      input.property,
      org?.name ?? "Lixus AI",
    );
    const mail = await emailService.sendReporting(
      to,
      `Misafir cevabınızı bekliyor — ${input.conversation.guestIdentifier} (${input.property.name})`,
      html,
    );
    if (!mail.ok) {
      claimed = false;
      await prisma.systemLock.deleteMany({ where: { name } }).catch(() => {});
      void reportError(
        `host-reply-waiting org=${input.organizationId}`,
        new Error("reply-waiting e-mail failed; claim released, the conversation stays visible in the inbox"),
      );
      return "failed";
    }
    return "mailed";
  } catch (err) {
    // Talepten SONRAKİ beklenmedik hata talebi tüketmiş bırakmasın (e-posta gitmedi).
    if (claimed) await prisma.systemLock.deleteMany({ where: { name } }).catch(() => {});
    void reportError(`host-reply-waiting org=${input.organizationId}`, err);
    return "failed";
  }
}
