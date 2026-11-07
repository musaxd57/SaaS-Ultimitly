import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { hostReplyWaitingEmail } from "@/lib/email-templates";
import { reportError } from "@/lib/report-error";
import { askHostOnChannel } from "@/lib/host-channel/ask";
import type { HostAskTrigger } from "@/lib/host-channel/routing";
import { hostChannelTransport } from "@/lib/host-channel-runtime";

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
//   • WhatsApp (kurucu 10-30 "WP'yi hemen bağlamak istiyorum"; tasarım `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md`, S3 önerisi A):
//     anahtarlar + işletme listesi + doğrulanmış numara + bilgi sorusu türü varsa AYNI talep altında önce WhatsApp sorusu denenir; giderse
//     e-posta GİTMEZ (sonuç "mailed" = ev sahibine ulaşıldı), gitmezse hemen bugünkü e-posta. Anahtarlar kapalıyken veritabanına dokunulmaz,
//     davranış birebir bugünkü. Öğe türü bilinmeyen çağıran (öğesiz yol) ve para / iade / konaklama değişikliği türleri hep e-posta.
// ---------------------------------------------------------------------------

/** Mesaj başına talep adı öneki — "Karar bekliyor" e-postası (Host Karar Motoru) AYNI talebi kullanır: aynı mesaja ikisi birden gitmez. */
export const REPLY_WAITING_MAIL_PREFIX = "reply-waiting-mail:";
const PREFIX = REPLY_WAITING_MAIL_PREFIX;
/** Talep satırının ömrü: mesaj başına tekillik bu süre boyunca korunur; sonra süpürülür (oto-yanıt bu kadar eski mesajı modellemez). */
export const REPLY_WAITING_CLAIM_TTL_MS = 45 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = REPLY_WAITING_CLAIM_TTL_MS;

/**
 * "Gönderildi" onayı (Codex 10-23, bildirim yarışı): talep satırı e-postadan ÖNCE alınır, sonuç belli olunca `holder = SENT` yazılır. Onaysız
 * talep = e-posta UÇUŞTA (gidebilir de düşebilir de — düşerse talep silinir). Başka bir yol onaysız talebi "zaten bildirildi" sayıp kendi
 * kaydını tutarsa ve uçuştaki e-posta düşerse ihtiyaç hiç bildirilmiyordu. "Karar bekliyor" e-postası (`decisions/notify.ts`) da aynı onayı yazar.
 */
export const REPLY_WAITING_SENT = "sent";
/**
 * Onaysız talep bu süreden eskiyse sonuçlanmış sayılır (onay yazılamayan başarılı gönderim / eski kayıtlar; e-posta saniyeler sürer).
 * 🚨 BİLİNÇLİ SEÇİM (Opus 10-23 öğle B8): talep alındıktan sonra, e-posta gitmeden süreç ölürse (yeniden başlatma) talep 45 gün durur ve 10 dk
 * sonra "sonuçlanmış" sayılır → o mesaj için bildirim KAYBOLUR (bu kural öncesinde de böyleydi). "Gönderildi ama onay yazılamadı" ile "hiç
 * gönderilmedi" bugün ayırt edilemiyor; tersine kural ÇİFT e-posta üretirdi. İhtiyaç panelde açık kalır. Ayırt etmek için talebe zaman damgalı
 * "alındı" işareti + sağlayıcı tekrar anahtarıyla bir kez yeniden deneme (açık iş).
 */
export const REPLY_WAITING_IN_FLIGHT_MS = 10 * 60_000;

export function replyWaitingSettled(lock: { holder: string | null; updatedAt: Date }, now: Date): boolean {
  return lock.holder === REPLY_WAITING_SENT || now.getTime() - lock.updatedAt.getTime() > REPLY_WAITING_IN_FLIGHT_MS;
}

/** E-posta gittikten sonra talebe onay yazar (en iyi çaba — yazılamazsa talep `REPLY_WAITING_IN_FLIGHT_MS` sonra sonuçlanmış sayılır). */
export async function confirmReplyWaitingSent(name: string): Promise<void> {
  await prisma.systemLock.updateMany({ where: { name }, data: { holder: REPLY_WAITING_SENT } }).catch(() => {});
}

/** `in_flight`: bu mesaja başka bir geçişin e-postası şu an gönderiliyor (sonucu belli değil) — çağıran "bildirildi" SAYMAZ. */
export type HostReplyWaitingOutcome = "mailed" | "deduped" | "in_flight" | "no_recipient" | "failed" | "unavailable";

export async function notifyHostReplyWaiting(input: {
  organizationId: string;
  conversation: { id: string; guestIdentifier: string; channel: string };
  property: { name: string; address: string | null; city: string | null };
  messageId: string;
  messageBody: string;
  /** WhatsApp yönlendiricisi için bildirimin nedeni (verilmezse tutulan tur). */
  trigger?: HostAskTrigger;
  /** Turun öğe türleri; verilmezse soru WhatsApp'a gitmez (yalnız e-posta). */
  itemKinds?: readonly string[];
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const held = await prisma.systemLock.findUnique({ where: { name }, select: { holder: true, updatedAt: true } }).catch(() => null);
        // Okunamadıysa ya da arada silindiyse (öteki e-posta düştü) temkinli yön: "uçuşta" — çağıran kendi kaydını tutmaz, sonra yeniden dener.
        return held && replyWaitingSettled(held, now) ? "deduped" : "in_flight";
      }
      return "unavailable";
    }

    // Önce WhatsApp (yalnız anahtarlar açık + doğrulanmış numara + bilgi sorusu); giderse ya da bu tura zaten gittiyse e-posta yok.
    const asked = await askHostOnChannel({
      organizationId: input.organizationId,
      conversationId: input.conversation.id,
      messageId: input.messageId,
      messageBody: input.messageBody,
      trigger: input.trigger ?? "handoff_held",
      itemKinds: input.itemKinds,
      transport: hostChannelTransport(),
      now,
    });
    if (asked === "whatsapp" || asked === "duplicate") {
      await confirmReplyWaitingSent(name);
      return "mailed";
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
    await confirmReplyWaitingSent(name);
    return "mailed";
  } catch (err) {
    // Talepten SONRAKİ beklenmedik hata talebi tüketmiş bırakmasın (e-posta gitmedi).
    if (claimed) await prisma.systemLock.deleteMany({ where: { name } }).catch(() => {});
    void reportError(`host-reply-waiting org=${input.organizationId}`, err);
    return "failed";
  }
}
