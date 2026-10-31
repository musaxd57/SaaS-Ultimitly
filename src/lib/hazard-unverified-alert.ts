// ---------------------------------------------------------------------------
// KURUCU T2 (10-21): OLASI fiziksel tehlike ("Tost makinesinden duman çıktı") + anlama katmanı bu turda KOŞMADI → kanal cevap kapısı turu
// tutuyordu (`hazardUnverified` → `lexical_risk`) ama kelime ağı sessiz kaldığı için ev sahibine HİÇBİR uyarı gitmiyordu (QR'da gidiyordu).
// Kurucunun kapsamı aynen:
//  · Konuşma "Sorunlu" olur, panelde görünür (yapay zekâ o konuşmada durur — bugünkü acil kuralı).
//  · Aynı olay tekrar işlendiğinde ikinci e-posta GİTMEZ: işaret atomik (`status ≠ problem` → `problem`); ev sahibi cevaplayınca konuşma
//    Sorunlu'dan çıkar, ancak o zaman yeni olay yeniden bildirilir.
//  · İşletme başına saatte en çok 3 bu tür e-posta. Sınıra takılan olay panelden KAYBOLMAZ (Sorunlu işareti yine konur).
//  · Yeni ya da daha AĞIR tehlike önceki olayın tekrarı sayılmaz: kelime ağının yakaladığı tehlike, bu işaretli konuşmada YENİ mesajla
//    gelirse `sendDueAlerts` onu bugünkü acil yoldan bildirir — bu sınırın DIŞINDA (kesin acil alarmları bu sınırla susturulmaz).
// Misafire giden hiçbir şey değişmez (tur bugün de tutuluyordu). E-posta bugünkü acil şikâyet e-postasının AYNISI (yeni metin yok).
// ---------------------------------------------------------------------------
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { emailService } from "@/lib/email";
import { complaintEscalationEmail } from "@/lib/email-templates";
import { buildTriageData } from "@/lib/ai/triage";
import { reportError } from "@/lib/report-error";

/** Konuşmayı bu yolun işaretlediğini gösteren `skippedReason` — daha ağır tehlike bu işaretin ÜSTÜNE yeniden bildirilir (`sendDueAlerts`). */
export const HAZARD_UNVERIFIED_REASON = "hazard_unverified";
/** Kurucu T2: işletme başına saatte en çok bu kadar "olası tehlike" e-postası. */
export const HAZARD_UNVERIFIED_EMAILS_PER_HOUR = 3;
const HOUR_MS = 60 * 60_000;

export const hazardUnverifiedMailKey = (organizationId: string) => `hazard-unverified-mail:${organizationId}`;

export interface HazardUnverifiedInput {
  organizationId: string;
  conversation: {
    id: string;
    guestIdentifier: string;
    channel: string;
    property: { name: string; address: string | null; city: string | null };
  };
  /** Tehlikeyi taşıyan misafir mesajı (e-postada alıntılanan). */
  trigger: { id: string; body: string };
  now?: Date;
  /**
   * Ev sahibi kanalı acil bildirimi (WhatsApp, anahtar arkasında; `automation.ts` `urgentChannelAlert`) — e-posta GİDECEKSE (alıcı var,
   * sınır içinde) e-postayla AYNI ANDA, tetik mesajıyla bir kez çağrılır; hatası e-postayı etkilemez. E-postanın yanındadır, yerine değil.
   */
  onAlert?: (messageId: string, body: string) => Promise<unknown>;
}

export type HazardUnverifiedResult = { claimed: false } | { claimed: true; mailed: boolean; capped: boolean };

/**
 * Atomik "Sorunlu" işareti + (sınır içindeyse) tek e-posta. Konuşma zaten Sorunlu ise hiçbir şey yapmaz (tekrar yok). E-posta gitmezse
 * işaret GERİ ALINMAZ (model yolundaki gerekçe: işaret aynı zamanda "bu konuşma insanda" kilididir; panelde görünür kalır).
 */
export async function escalateUnverifiedHazard(input: HazardUnverifiedInput): Promise<HazardUnverifiedResult> {
  const now = input.now ?? new Date();
  const claimed = await prisma.conversation.updateMany({
    where: { id: input.conversation.id, status: { not: "problem" } },
    data: {
      status: "problem",
      priority: "urgent",
      skippedReason: HAZARD_UNVERIFIED_REASON,
      lastRiskType: "safety_emergency",
      // Model bu turda tehlikeyi değerlendirmedi (anlama katmanı koşmadı) → kod yolu; analiz alanları uydurulmaz.
      ...buildTriageData({ source: "keyword", triggerMessageId: input.trigger.id, now }),
    },
  });
  if (claimed.count !== 1) return { claimed: false };
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    // Alıcı: işletmenin uyarı adresi, yoksa SAHİBİN e-postası (personel değil, ortam yedeği asla — model yoluyla aynı kural).
    select: { name: true, alertEmail: true, users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } } },
  });
  const to = org?.alertEmail?.trim() || org?.users[0]?.email?.trim();
  // Alıcı yoksa hak harcanmaz (Haiku T2: adressiz işletme her olayda saatlik hakkı yakıyordu).
  if (!to) return { claimed: true, mailed: false, capped: false };
  const slot = await rateLimit(hazardUnverifiedMailKey(input.organizationId), HAZARD_UNVERIFIED_EMAILS_PER_HOUR, HOUR_MS);
  if (!slot.ok) return { claimed: true, mailed: false, capped: true };
  const c = input.conversation;
  const html = complaintEscalationEmail(
    { id: c.id, guestIdentifier: c.guestIdentifier, channel: c.channel, priority: "urgent" },
    input.trigger.body,
    { name: c.property.name, address: c.property.address, city: c.property.city },
    org?.name ?? "Lixus AI",
  );
  const [mail] = await Promise.all([
    emailService.sendReporting(to, `⚠️ Acil misafir mesajı — ${c.guestIdentifier} (${c.property.name})`, html),
    input.onAlert ? input.onAlert(input.trigger.id, input.trigger.body).catch(() => null) : null,
  ]);
  if (!mail.ok) {
    // Gitmeyen e-posta hak yemez (QR acil e-postasıyla aynı desen).
    await prisma.rateLimitCounter
      .updateMany({ where: { key: hazardUnverifiedMailKey(input.organizationId), count: { gt: 0 } }, data: { count: { decrement: 1 } } })
      .catch(() => {});
    void reportError(`hazard-unverified-alert org=${input.organizationId}`, new Error("hazard e-mail failed; thread stays 'problem' for the host"));
    return { claimed: true, mailed: false, capped: false };
  }
  return { claimed: true, mailed: true, capped: false };
}
