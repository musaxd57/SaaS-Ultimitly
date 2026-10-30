import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecretBound, encryptSecretBound } from "@/lib/crypto";
import { logEvent } from "@/lib/event-log";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { consumeDailyAiBudget } from "@/lib/ai/daily-budget";
import { sendHostMessage } from "@/lib/host-send";
import { codeAnswerKind } from "./answer-kind";
import { bindingUsable } from "./binding-code";
import { composeGuestReplyFromHostAnswer } from "./compose";
import { checkComposedGuestReply } from "./compose-check";
import { correlateHostReply, type HostQuestionStatus, type PendingHostQuestion } from "./correlate";
import type { HostChannelTransport, HostInboundEvent } from "./types";

// ---------------------------------------------------------------------------
// EV SAHİBİNİN CEVABI → MİSAFİRE CEVAP (tasarım §3.4–3.8; kurucu 10-30: "hosta kısaca soruyu sorup alınması gereken yanıtı alıp hemen
// cevap ürettirip müşteriye yazma akışına geçilmeli"). Sağlayıcı bilmez (V0). Anahtar: `HOST_QUESTIONS_ENABLED` (çağıran denetler).
//
//  1. Ev sahibi soruya WhatsApp'tan yazar → doğru soruya bağlanır (`correlateHostReply`: "yanıtla" bağlamı ya da bekleyen TEK soru). Bağlamdaki
//     soru BAŞKA işletmenin ise sessizce yok sayılır (yalnız olay günlüğü) — işletme her zaman gönderen numaranın bağlantısından.
//  2. Cevap ŞİFRELİ saklanır, taslak kurulur (`compose.ts`: misafirin dilinde, ev sahibinin ağzından, yalnız ev sahibinin sözü) ve kodla
//     denetlenir (`compose-check.ts`). Ev sahibine ÖNİZLEME + [Gönder] [Gönderme] gider (S1 önerisi: ilk dilimde otomatik gönderim YOK).
//  3. Cevap sorunun tamamını karşılamıyorsa misafire HİÇBİR ŞEY gitmez, soru açık kalır (cevapsız soru asla "cevaplandı" görünmez).
//  4. [Gönder] → gönderimden hemen önce yeniden doğrulama: bağlantı + rol + oturum kuşağı, sürüm (eski düğme yeni taslağı onaylayamaz), taslak
//     özeti, misafir arada yazdı mı, rezervasyon iptal mi, kod denetimi yeniden. Sonra bugünkü gönderim çekirdeği (`sendHostMessage`: kanal
//     kapıları, çift gönderim kalkanı, kalıcı kuyruk). Belirsiz sonuç → "doğrulanamadı" (kör tekrar YOK).
//  5. Ev sahibine giden metinler kodda sabit Türkçe (model üretmez). Misafirin adı / telefonu / metni günlüğe yazılmaz.
// ---------------------------------------------------------------------------

/** Cevap beklenen (açık) sorular. */
const OPEN_STATUSES = ["sent", "awaiting_confirm"] as const;
/** İşlenmekte olan sorular: eşleşir ama yeni cevap kabul etmez (sessiz). */
const BUSY_STATUSES = ["answered", "sending"] as const;
/** Ev sahibinin cevabından taslak kurma tavanı (soru başına). */
export const MAX_COMPOSE_PER_QUESTION = 3;
/** WhatsApp düğmeli mesaj gövdesinin üst sınırı — önizleme bunu aşarsa gönderilmez (kesik metin onaylanmaz). */
export const PREVIEW_MAX = 1_024;
/** Taslak kurma / gönderim bu süreden uzun "işleniyor" kalırsa süpürge kurtarır. */
export const STUCK_MS = 10 * 60 * 1000;
/** Kapanmış sorunun cevap / taslak metni bu süre sonra silinir (tasarım §5.8). */
export const HOST_QUESTION_TEXT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const HOST_TEXTS = {
  previewHeader: "Misafire şu cevap gidecek:",
  previewTr: "Türkçesi:",
  send: "Gönder",
  cancel: "Gönderme",
  sent: "Gönderildi ✓",
  declined: "Tamam, gönderilmedi. Soru panelde açık.",
  takesOver: "Tamam, size bıraktım.",
  unknown: "Tamam, misafire bir şey gönderilmedi. Soru panelde açık.",
  unclear: "Cevabınızdan misafire gidecek bir mesaj çıkaramadım. Panelden yazabilirsiniz:",
  partial: "Cevabınız sorunun tamamını karşılamıyor. Eksik kısmı da yazın ya da panelden cevaplayın:",
  composeFailed: "Şu an taslak hazırlanamadı. Panelden yazabilirsiniz:",
  composeLimit: "Bu soru için daha fazla taslak hazırlanamıyor. Panelden yazabilirsiniz:",
  none: "Şu an bekleyen bir misafir sorusu yok.",
  ambiguous: "Birden çok bekleyen soru var. Cevabınızı ilgili soru mesajına \"Yanıtla\" diyerek yazın.",
  closedElsewhere: "Bu soruyu panelden cevapladınız; misafire yeni bir şey gönderilmedi.",
  closedExpired: "Bu sorunun süresi geçti.",
  closedOther: "Bu soru kapandı; misafire yeni bir şey gönderilmedi.",
  stalePreview: "Bu önizleme artık geçerli değil.",
  guestWrote: "Misafir yeni bir mesaj yazdı; misafire bir şey gönderilmedi. Panelden kontrol edin:",
  cancelledStay: "Rezervasyon iptal edilmiş; misafire bir şey gönderilmedi.",
  unverified: "Gönderim doğrulanamadı, konuşmayı kontrol edin:",
  sendFailed: "Gönderilemedi. Panelden deneyin:",
  notConnected: "Kanal bağlantısı yok, panelden deneyin.",
  unsupported: "Sesli mesajları ve görselleri henüz okuyamıyorum, lütfen yazın.",
} as const;

const answerAad = (questionId: string, organizationId: string) => `host-question-answer:v1:${questionId}:${organizationId}`;
const draftAad = (questionId: string, organizationId: string) => `host-question-draft:v1:${questionId}:${organizationId}`;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const panelLink = (conversationId: string) => `${appBaseUrl()}/inbox/${encodeURIComponent(conversationId)}`;

/** Düğme kimliği: `hq.<soru>.<sürüm>.<eylem>` (tasarım §3.3). Sır değildir — yetki gönderen numaranın bağlantısından. */
export function hostQuestionButtonId(questionId: string, version: number, action: "send" | "cancel"): string {
  return `hq.${questionId}.${version}.${action}`;
}

export function parseHostQuestionButton(id: string): { questionId: string; version: number; action: "send" | "cancel" } | null {
  const m = /^hq\.([0-9a-f-]{36})\.(\d{1,9})\.(send|cancel)$/.exec(id);
  if (!m) return null;
  return { questionId: m[1]!, version: Number(m[2]), action: m[3] as "send" | "cancel" };
}

/** Veritabanı durumu → eşleyicinin durumu. Açık + işlenmekte olan "bekliyor"; süresi dolmuş açık soru "süresi geçti". */
function correlationStatus(status: string, expiresAt: Date, now: Date): HostQuestionStatus {
  const open = (OPEN_STATUSES as readonly string[]).includes(status) || (BUSY_STATUSES as readonly string[]).includes(status);
  if (open) return expiresAt.getTime() <= now.getTime() ? "expired" : "waiting";
  if (status === "answered_elsewhere" || status === "expired" || status === "superseded") return status;
  return "sent";
}

export type HostAnswerOutcome =
  | "not_usable"
  | "foreign"
  | "none"
  | "ambiguous"
  | "closed"
  | "busy"
  | "duplicate"
  | "takes_over"
  | "previewed"
  | "partial"
  | "unclear"
  | "compose_failed"
  | "unsupported";

interface BindingForAnswer {
  id: string;
  organizationId: string;
}

/** Bağlantı soru alabilir / cevap verebilir mi (kullanıcı hâlâ işletmede sahip / yönetici, oturum kuşağı aynı). */
async function usableBinding(b: BindingForAnswer): Promise<{ userName: string } | null> {
  const row = await prisma.hostChannelBinding.findFirst({
    where: { id: b.id, organizationId: b.organizationId, status: "active" },
    select: { status: true, userSessionEpoch: true, user: { select: { name: true, role: true, organizationId: true, sessionEpoch: true } } },
  });
  if (!row) return null;
  if (row.user.organizationId !== b.organizationId) return null;
  if (row.user.role !== "owner" && row.user.role !== "manager") return null;
  if (!bindingUsable(row, row.user.sessionEpoch)) return null;
  return { userName: row.user.name };
}

/**
 * Etkin bağlantıdan gelen metin / düğme. `to` = ev sahibinin numarası (cevaplar oraya). Asla fırlatmamaya çalışmaz: veritabanı hatası
 * yukarı çıkar (web kancası mesajın kilidini bırakır, Meta yeniden dener).
 */
export async function handleHostAnswer(input: {
  binding: BindingForAnswer;
  to: string;
  event: HostInboundEvent;
  transport: HostChannelTransport | null;
  now?: Date;
}): Promise<HostAnswerOutcome> {
  const { binding, event, transport } = input;
  const now = input.now ?? new Date();
  const user = await usableBinding(binding);
  if (!user) return "not_usable";
  const reply = async (text: string, replyTo?: string | null) => {
    if (transport) await transport.sendText(input.to, text, replyTo ?? null).catch(() => null);
  };

  if (event.kind === "unsupported") {
    await reply(HOST_TEXTS.unsupported, event.providerMessageId);
    return "unsupported";
  }
  if (event.kind === "button") {
    const parsed = parseHostQuestionButton(event.buttonId);
    if (parsed) return handleButton({ ...input, now, userName: user.userName, parsed, reply });
  }
  const text = event.kind === "text" ? event.text : event.title;

  // Eşleme: bu bağlantının açık soruları + ("yanıtla" bağlamı varsa) o bağlamın sorusu, hangi işletmenin olursa olsun (yabancıyı tanımak için).
  const select = { id: true, organizationId: true, status: true, createdAt: true, expiresAt: true, providerMessageId: true, previewMessageId: true } as const;
  const own = await prisma.hostQuestion.findMany({
    where: { organizationId: binding.organizationId, bindingId: binding.id, status: { in: [...OPEN_STATUSES, ...BUSY_STATUSES] } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 20,
    select,
  });
  // Bağlamın sorusu YALNIZ gönderenin işletmesinde okunur; başka işletmede olup olmadığına yalnız işletme kimliğiyle bakılır (içerik okunmaz)
  // — o durumda eşleyiciye yalnız "yabancı" işareti gider (Haiku 10-30 P3).
  const byContext = event.contextId ? { OR: [{ providerMessageId: event.contextId }, { previewMessageId: event.contextId }] } : null;
  const contextual = byContext ? await prisma.hostQuestion.findFirst({ where: { ...byContext, organizationId: binding.organizationId }, select }) : null;
  const foreignContext =
    byContext && !contextual
      ? await prisma.hostQuestion.findFirst({ where: { ...byContext, organizationId: { not: binding.organizationId } }, select: { organizationId: true } })
      : null;
  if (foreignContext) {
    await logEvent("host_channel.answer.foreign", {}, { organizationId: binding.organizationId });
    return "foreign";
  }
  const all = contextual && !own.some((q) => q.id === contextual.id) ? [...own, contextual] : own;
  const pending: PendingHostQuestion[] = all.map((q) => ({
    id: q.id,
    orgId: q.organizationId,
    status: correlationStatus(q.status, q.expiresAt, now),
    createdAt: q.createdAt,
    providerMessageIds: [q.providerMessageId, q.previewMessageId].filter((x): x is string => typeof x === "string"),
  }));
  const c = correlateHostReply({ contextId: event.contextId, senderOrgId: binding.organizationId, questions: pending, now });
  if (c.kind === "foreign") {
    await logEvent("host_channel.answer.foreign", {}, { organizationId: binding.organizationId });
    return "foreign";
  }
  if (c.kind === "none") {
    await replyNoneOncePerDay(binding.id, now, () => reply(HOST_TEXTS.none, event.providerMessageId));
    return "none";
  }
  if (c.kind === "ambiguous") {
    await reply(HOST_TEXTS.ambiguous, event.providerMessageId);
    return "ambiguous";
  }
  if (c.kind === "closed") {
    await reply(
      c.status === "answered_elsewhere" ? HOST_TEXTS.closedElsewhere : c.status === "expired" ? HOST_TEXTS.closedExpired : HOST_TEXTS.closedOther,
      event.providerMessageId,
    );
    return "closed";
  }

  const q = await prisma.hostQuestion.findFirst({
    where: { id: c.questionId, organizationId: binding.organizationId, bindingId: binding.id },
    select: { id: true, status: true, version: true, composeCount: true, conversationId: true, turnMessageId: true, createdAt: true },
  });
  if (!q || !(OPEN_STATUSES as readonly string[]).includes(q.status)) return "busy";
  if (await hostRepliedSince(q.conversationId, q.createdAt)) {
    await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: binding.organizationId, status: q.status, version: q.version },
      data: { status: "answered_elsewhere", version: { increment: 1 } },
    });
    await reply(HOST_TEXTS.closedElsewhere, event.providerMessageId);
    return "closed";
  }

  // "Ben yazacağım" (metin ya da şablon düğmesi): model çağrılmaz, misafire bir şey gitmez, soru panelde ev sahibinde.
  if (codeAnswerKind({ kind: "text", text }) === "host_takes_over") {
    const won = await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: binding.organizationId, status: q.status, version: q.version },
      data: { status: "host_takes_over", version: { increment: 1 } },
    });
    if (won.count === 1) await reply(HOST_TEXTS.takesOver, event.providerMessageId);
    return "takes_over";
  }

  if (q.composeCount >= MAX_COMPOSE_PER_QUESTION) {
    await reply(`${HOST_TEXTS.composeLimit} ${panelLink(q.conversationId)}`, event.providerMessageId);
    return "compose_failed";
  }

  // Cevap şifreli saklanır; aynı WhatsApp mesajı ikinci kez işlenemez (`answerMessageId` tekil).
  let claimed: number;
  try {
    claimed = (
      await prisma.hostQuestion.updateMany({
        where: { id: q.id, organizationId: binding.organizationId, status: q.status, version: q.version },
        data: {
          status: "answered",
          answerEnc: encryptSecretBound(text, answerAad(q.id, binding.organizationId)),
          answerMessageId: event.providerMessageId,
          answeredAt: now,
          draftEnc: null,
          draftHash: null,
          version: { increment: 1 },
        },
      })
    ).count;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    throw err;
  }
  if (claimed !== 1) return "busy";
  await logEvent("host_channel.answer.received", { questionId: q.id }, { organizationId: binding.organizationId });

  // Bu turun yazımları SÜRÜME bağlı: süpürge takılan turu yeniden açıp yeni bir cevap işlenmeye başladıysa eski tur onu ezmez (Haiku 10-30 P3).
  const answeredVersion = q.version + 1;
  const reopen = (extra: Prisma.HostQuestionUpdateManyMutationInput = {}) =>
    prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: binding.organizationId, status: "answered", version: answeredVersion },
      data: { status: "sent", version: { increment: 1 }, ...extra },
    });

  const turn = await prisma.message.findFirst({
    where: { id: q.turnMessageId, conversation: { id: q.conversationId, property: { organizationId: binding.organizationId } } },
    select: { body: true },
  });
  const budget = await consumeDailyAiBudget(binding.organizationId);
  if (!budget.ok) {
    await reopen();
    await reply(`${HOST_TEXTS.composeFailed} ${panelLink(q.conversationId)}`, event.providerMessageId);
    return "compose_failed";
  }
  const composed = await composeGuestReplyFromHostAnswer({ hostAnswer: text, guestMessages: turn?.body ? [turn.body] : [] });
  if (!composed.ok) {
    if (composed.kind === "host_takes_over") {
      await prisma.hostQuestion.updateMany({
        where: { id: q.id, organizationId: binding.organizationId, status: "answered", version: answeredVersion },
        data: { status: "host_takes_over", version: { increment: 1 }, composeCount: { increment: 1 } },
      });
      await reply(HOST_TEXTS.takesOver, event.providerMessageId);
      return "takes_over";
    }
    if (composed.kind === "host_unknown") {
      await prisma.hostQuestion.updateMany({
        where: { id: q.id, organizationId: binding.organizationId, status: "answered", version: answeredVersion },
        data: { status: "host_unknown", version: { increment: 1 }, composeCount: { increment: 1 } },
      });
      await reply(HOST_TEXTS.unknown, event.providerMessageId);
      return "unclear";
    }
    await reopen({ composeCount: { increment: 1 } });
    const failed = composed.reason === "no_key" || composed.reason === "model_failed";
    await reply(`${failed ? HOST_TEXTS.composeFailed : HOST_TEXTS.unclear} ${panelLink(q.conversationId)}`, event.providerMessageId);
    return failed ? "compose_failed" : "unclear";
  }
  // Kapsama kuralı (K-1029-A ile aynı ruh): cevap bir soruyu karşılamıyorsa misafire HENÜZ hiçbir şey gitmez, soru açık kalır.
  if (composed.uncovered.length > 0) {
    await reopen({ composeCount: { increment: 1 } });
    await reply(`${HOST_TEXTS.partial} ${panelLink(q.conversationId)}`, event.providerMessageId);
    return "partial";
  }

  // Önizleme TAMAMEN görünmeli: ev sahibinin görmediği metin onaylanamaz (WhatsApp düğmeli mesaj gövdesi 1024 karakter; Haiku 10-30 P3).
  const withTr =
    composed.replyTr && composed.replyTr !== composed.reply
      ? `${HOST_TEXTS.previewHeader}\n\n“${composed.reply}”\n\n${HOST_TEXTS.previewTr} “${composed.replyTr}”`
      : `${HOST_TEXTS.previewHeader}\n\n“${composed.reply}”`;
  const bare = `${HOST_TEXTS.previewHeader}\n\n“${composed.reply}”`;
  const preview = withTr.length <= PREVIEW_MAX ? withTr : bare.length <= PREVIEW_MAX ? bare : null;
  if (!preview) {
    await reopen({ composeCount: { increment: 1 } });
    await reply(`${HOST_TEXTS.unclear} ${panelLink(q.conversationId)}`, event.providerMessageId);
    return "unclear";
  }

  const version = q.version + 2;
  const drafted = await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: binding.organizationId, status: "answered", version: answeredVersion },
    data: {
      status: "awaiting_confirm",
      draftEnc: encryptSecretBound(composed.reply, draftAad(q.id, binding.organizationId)),
      draftHash: sha256(composed.reply),
      composeCount: { increment: 1 },
      version,
    },
  });
  if (drafted.count !== 1) return "busy";
  const sent = transport
    ? await transport
        .sendChoices(
          input.to,
          preview,
          [
            { id: hostQuestionButtonId(q.id, version, "send"), title: HOST_TEXTS.send },
            { id: hostQuestionButtonId(q.id, version, "cancel"), title: HOST_TEXTS.cancel },
          ],
          event.providerMessageId,
        )
        .catch(() => null)
    : null;
  if (!sent?.ok || !sent.providerMessageId) {
    // Önizleme ev sahibine ulaşmadı: onaylanamayacak bir taslak "onay bekliyor"da kalmasın — soru yeniden açık (Haiku 10-30 P3).
    await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: binding.organizationId, status: "awaiting_confirm", version },
      data: { status: "sent", draftEnc: null, draftHash: null, version: { increment: 1 } },
    });
    return "compose_failed";
  }
  await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: binding.organizationId, version },
    data: { previewMessageId: sent.providerMessageId },
  });
  return "previewed";
}

/**
 * Soru gönderildikten SONRA ev sahibi panelden (ya da başka yoldan) misafire yazdı mı — yazdıysa WhatsApp cevabı ikinci bir mesaj olurdu.
 * Aynı konuşmanın BAŞKA sorusu için WhatsApp'tan onaylanıp gönderilen cevaplar sayılmaz (Haiku 10-30 P2: misafirin ikinci sorusu, birincisinin
 * WhatsApp cevabı yüzünden "panelden cevapladınız" diye kapanıyordu).
 */
async function hostRepliedSince(conversationId: string, since: Date): Promise<boolean> {
  const ours = await prisma.hostQuestion.findMany({
    where: { conversationId, resultMessageId: { not: null } },
    select: { resultMessageId: true },
    take: 200,
  });
  const exclude = ours.map((r) => r.resultMessageId).filter((x): x is string => typeof x === "string");
  const n = await prisma.message.count({
    where: { conversationId, direction: "outbound", authorType: "host", createdAt: { gt: since }, ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}) },
  });
  return n > 0;
}

/** "Bekleyen soru yok" cevabının gün kilidi (bağlantı başına günde bir); süresi geçenleri saatlik süpürge siler. */
const NONE_LOCK_PREFIX = "host-none:";

async function replyNoneOncePerDay(bindingId: string, now: Date, send: () => Promise<void>): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  try {
    await prisma.systemLock.create({ data: { name: `${NONE_LOCK_PREFIX}${bindingId}:${day}`, lockedUntil: new Date(now.getTime() + 36 * 3600_000) } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
  await send();
}

async function handleButton(input: {
  binding: BindingForAnswer;
  to: string;
  event: HostInboundEvent;
  now: Date;
  userName: string;
  parsed: { questionId: string; version: number; action: "send" | "cancel" };
  reply: (text: string, replyTo?: string | null) => Promise<void>;
}): Promise<HostAnswerOutcome> {
  const { binding, parsed, reply, event } = input;
  // Kiracı: soru YALNIZ gönderen numaranın bağlantısında aranır. Başka işletmenin soru kimliği düğmeye yazılmış olsa bile bulunmaz.
  const q = await prisma.hostQuestion.findFirst({
    where: { id: parsed.questionId, organizationId: binding.organizationId, bindingId: binding.id },
    select: {
      id: true,
      status: true,
      version: true,
      conversationId: true,
      answerEnc: true,
      draftEnc: true,
      draftHash: true,
      answeredAt: true,
      createdAt: true,
      expiresAt: true,
      conversation: { select: { id: true, channel: true, guestIdentifier: true, externalReservationId: true, reservation: { select: { status: true } } } },
    },
  });
  if (!q) {
    await logEvent("host_channel.answer.foreign", {}, { organizationId: binding.organizationId });
    return "foreign";
  }
  if (q.status !== "awaiting_confirm" || q.version !== parsed.version) {
    await reply(HOST_TEXTS.stalePreview, event.providerMessageId);
    return "closed";
  }
  // Süresi geçmiş soru (süpürge henüz kapatmadıysa da) onaylanamaz — yazılı geç cevapla aynı kural (Haiku 10-30 P3).
  if (q.expiresAt.getTime() <= input.now.getTime()) {
    await reply(HOST_TEXTS.closedExpired, event.providerMessageId);
    return "closed";
  }
  if (parsed.action === "cancel") {
    const won = await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: binding.organizationId, status: "awaiting_confirm", version: q.version },
      data: { status: "declined", version: { increment: 1 } },
    });
    if (won.count === 1) await reply(HOST_TEXTS.declined, event.providerMessageId);
    return "closed";
  }

  // [Gönder] — sürüm CAS: çift dokunuş ikinci mesaj üretmez, eski düğme yeni taslağı onaylayamaz.
  const locked = await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: binding.organizationId, status: "awaiting_confirm", version: q.version },
    data: { status: "sending", version: { increment: 1 } },
  });
  if (locked.count !== 1) return "busy";
  const sendingVersion = q.version + 1;
  const settle = (status: string, extra: Prisma.HostQuestionUpdateManyMutationInput = {}) =>
    prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: binding.organizationId, status: "sending", version: sendingVersion },
      data: { status, version: { increment: 1 }, ...extra },
    });
  const link = panelLink(q.conversationId);

  let draft: string;
  let answer: string;
  try {
    if (!q.draftEnc || !q.answerEnc) throw new Error("missing");
    draft = decryptSecretBound(q.draftEnc, draftAad(q.id, binding.organizationId));
    answer = decryptSecretBound(q.answerEnc, answerAad(q.id, binding.organizationId));
  } catch {
    await settle("sent");
    await reply(`${HOST_TEXTS.sendFailed} ${link}`, event.providerMessageId);
    return "compose_failed";
  }
  // Önizlenen metin = gönderilecek metin; kod denetimi gönderim anında yeniden.
  if (sha256(draft) !== q.draftHash || checkComposedGuestReply({ reply: draft, hostAnswer: answer }) !== null) {
    await settle("sent");
    await reply(`${HOST_TEXTS.sendFailed} ${link}`, event.providerMessageId);
    return "compose_failed";
  }
  if (await hostRepliedSince(q.conversationId, q.createdAt)) {
    await settle("answered_elsewhere");
    await reply(HOST_TEXTS.closedElsewhere, event.providerMessageId);
    return "closed";
  }
  if (q.conversation.reservation?.status === "cancelled") {
    await settle("superseded");
    await reply(HOST_TEXTS.cancelledStay, event.providerMessageId);
    return "closed";
  }
  // Önizlemeden sonra misafir yeniden yazdıysa taslak bayattır: gönderilmez, soru açık kalır (ev sahibi yeni cevap yazar / panelden bakar).
  const guestWrote = q.answeredAt
    ? await prisma.message.count({ where: { conversationId: q.conversationId, direction: "inbound", createdAt: { gt: q.answeredAt } } })
    : 0;
  if (guestWrote > 0) {
    await settle("sent");
    await reply(`${HOST_TEXTS.guestWrote} ${link}`, event.providerMessageId);
    return "closed";
  }

  // Bağlantı gönderimden HEMEN önce yeniden: arada "DUR" / rol düşmesi / şifre değişimi olduysa gönderilmez (Haiku 10-30 P3).
  if (!(await usableBinding(binding))) {
    await settle("sent");
    return "not_usable";
  }

  let result: Awaited<ReturnType<typeof sendHostMessage>>;
  try {
    result = await sendHostMessage({
      organizationId: binding.organizationId,
      conversation: q.conversation,
      body: draft,
      claimBody: draft,
      senderName: input.userName,
      aiAssisted: true,
      idempotencyKey: `host-q:${q.id}:v${sendingVersion}`,
      strictIdempotency: true,
    });
  } catch {
    // Teslim olmuş ama kaydedilememiş olabilir → kör tekrar YOK.
    await settle("send_unverified");
    await reply(`${HOST_TEXTS.unverified} ${link}`, event.providerMessageId);
    return "closed";
  }
  if (result.status === "sent" || result.status === "queued") {
    await settle("done", { resultMessageId: result.message?.id ?? null });
    await logEvent("host_channel.answer.sent_to_guest", { questionId: q.id }, { organizationId: binding.organizationId });
    await reply(HOST_TEXTS.sent, event.providerMessageId);
    return "closed";
  }
  if (result.status === "not_connected") {
    await settle("sent");
    await reply(HOST_TEXTS.notConnected, event.providerMessageId);
    return "closed";
  }
  // Kesin ret ya da çift gönderim kilidi hiç alınamadı (kilit deposu arızası, fail-closed): misafire HİÇBİR ŞEY gitmedi → soru yeniden açık.
  if (result.status === "failed_definitive" || result.status === "claim_unavailable") {
    await settle("sent");
    await reply(`${HOST_TEXTS.sendFailed} ${link}`, event.providerMessageId);
    return "closed";
  }
  await settle("send_unverified");
  await reply(`${HOST_TEXTS.unverified} ${link}`, event.providerMessageId);
  return "closed";
}

/**
 * Saklama + süre (saatlik): cevap beklerken süresi dolan sorular "süresi geçti" olur; kapanmış sorunun cevap / taslak metni 7 gün sonra silinir
 * (tasarım §5.8); süresi geçmiş "bekleyen soru yok" gün kilitleri silinir. İşlenmekte olan (cevaplandı / gönderiliyor) satıra dokunulmaz.
 */
export async function sweepHostQuestions(now: Date = new Date()): Promise<{ expired: number; purged: number; recovered: number }> {
  // Yarıda kalan ara durumlar (süreç taslak kurarken / gönderirken öldü): taslak kurma → soru yeniden açık; gönderim → sonucu bilinmiyor
  // ("doğrulanamadı", kör tekrar YOK — misafire gitmiş olabilir).
  const stuckBefore = new Date(now.getTime() - STUCK_MS);
  const reopened = await prisma.hostQuestion.updateMany({
    where: { status: "answered", updatedAt: { lt: stuckBefore } },
    data: { status: "sent", version: { increment: 1 } },
  });
  const unverified = await prisma.hostQuestion.updateMany({
    where: { status: "sending", updatedAt: { lt: stuckBefore } },
    data: { status: "send_unverified", version: { increment: 1 } },
  });
  const expired = await prisma.hostQuestion.updateMany({
    where: { status: { in: [...OPEN_STATUSES] }, expiresAt: { lt: now } },
    data: { status: "expired", version: { increment: 1 } },
  });
  const purged = await prisma.hostQuestion.updateMany({
    where: {
      status: { notIn: [...OPEN_STATUSES, ...BUSY_STATUSES] },
      updatedAt: { lt: new Date(now.getTime() - HOST_QUESTION_TEXT_RETENTION_MS) },
      OR: [{ answerEnc: { not: null } }, { draftEnc: { not: null } }],
    },
    data: { answerEnc: null, draftEnc: null },
  });
  // Günlük "bekleyen soru yok" kilitleri birikmesin (bağlantı başına günde en çok bir satır).
  await prisma.systemLock.deleteMany({ where: { name: { startsWith: NONE_LOCK_PREFIX }, lockedUntil: { lt: now } } });
  return { expired: expired.count, purged: purged.count, recovered: reopened.count + unverified.count };
}
