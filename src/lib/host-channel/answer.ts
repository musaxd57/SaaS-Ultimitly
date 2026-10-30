import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecretBound, encryptSecretBound } from "@/lib/crypto";
import { logEvent } from "@/lib/event-log";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { consumeDailyAiBudget } from "@/lib/ai/daily-budget";
import { sendHostMessage } from "@/lib/host-send";
import { notChannelAutomationWhere } from "@/lib/message-author";
import { applyItemEvent } from "@/lib/conversation-items/store";
import { calendarDateOf } from "@/modules/availability/core";
import { codeAnswerKind } from "./answer-kind";
import { activeBindingAddress } from "./binding";
import { bindingUsable } from "./binding-code";
import { composeGuestReplyFromHostAnswer } from "./compose";
import { checkComposedGuestReply } from "./compose-check";
import { correlateHostReply, type HostQuestionStatus, type PendingHostQuestion } from "./correlate";
import { buildHostQuestion, withoutGuestNames } from "./question-text";
import type { HostChannelTransport, HostInboundEvent } from "./types";

// ---------------------------------------------------------------------------
// EV SAHİBİNİN CEVABI → MİSAFİRE CEVAP (tasarım §3.4–3.8; kurucu 10-30: "hosta kısaca soruyu sorup alınması gereken yanıtı alıp hemen
// cevap ürettirip müşteriye yazma akışına geçilmeli"). Sağlayıcı bilmez (V0). Anahtar: `HOST_QUESTIONS_ENABLED` (çağıran denetler).
//
//  1. Ev sahibi soruya WhatsApp'tan yazar → doğru soruya bağlanır (`correlateHostReply`: "yanıtla" bağlamı ya da bekleyen TEK soru). Bağlamdaki
//     soru BAŞKA işletmenin ise sessizce yok sayılır (yalnız olay günlüğü) — işletme her zaman gönderen numaranın bağlantısından.
//  2. Cevap ŞİFRELİ saklanır; soru açıkken gelen sonraki cevaplar ÖNCEKİLERE EKLENİR (eksik kısmı tamamlama / düzeltme). Taslak kurulur
//     (`compose.ts`: misafirin dilinde, ev sahibinin ağzından, yalnız ev sahibinin sözü; misafirin adı modele gitmez) ve kodla denetlenir
//     (`compose-check.ts`). Ev sahibine hangi daire / hangi soru olduğu yazılı ÖNİZLEME + [Gönder] [Gönderme] gider (ilk dilimde otomatik
//     gönderim YOK).
//  3. Cevap sorunun tamamını karşılamıyorsa misafire HİÇBİR ŞEY gitmez, soru açık kalır (cevapsız soru asla "cevaplandı" görünmez). Soru
//     sorulduktan SONRA misafir yeniden yazdıysa taslak kurulmaz / gönderilmez (cevap bayat olabilir) — soru "yerini başkasına bıraktı".
//  4. [Gönder] → gönderimden hemen önce yeniden doğrulama: bağlantı + rol + oturum kuşağı, sürüm (eski düğme yeni taslağı onaylayamaz), taslak
//     özeti, misafir arada yazdı mı, rezervasyon iptal mi, kod denetimi yeniden. Sonra bugünkü gönderim çekirdeği (`sendHostMessage`: kanal
//     kapıları, çift gönderim kalkanı, kalıcı kuyruk). Belirsiz sonuç → "doğrulanamadı" (kör tekrar YOK). Gönderilen cevap YALNIZ bu turun
//     öğelerini "cevaplandı" yapar; konuşmanın öteki açık öğelerini kapatmaz (`conversation-items/store.ts`).
//  5. Yarıda düşme (süreç öldü / veritabanı kesintisi): Meta mesajı yeniden teslim eder → aynı mesaj kaldığı yerden işlenir; gönderimden ÖNCE
//     düşen [Gönder] kilidi bırakır (yeniden teslimde aynı düğme çalışır). Takılan satırı saatlik süpürge kurtarır ve ev sahibine söyler.
//  6. Ev sahibine giden metinler kodda sabit Türkçe (model üretmez). Misafirin adı / telefonu / metni günlüğe yazılmaz.
// ---------------------------------------------------------------------------

/** Cevap beklenen (açık) sorular. */
const OPEN_STATUSES = ["sent", "awaiting_confirm"] as const;
/** İşlenmekte olan sorular: eşleşir ama yeni cevap kabul etmez. */
const BUSY_STATUSES = ["answered", "sending"] as const;
/** Canlı (açık + işlenen) sorular; misafir silmesi bunları kapatır (`erasure.ts` aynı listeyi yazar — pin: host-channel-answer testi). */
export const HOST_QUESTION_LIVE_STATUSES: readonly string[] = [...OPEN_STATUSES, ...BUSY_STATUSES];
/** Ev sahibinin cevabından taslak kurma tavanı (soru başına). */
export const MAX_COMPOSE_PER_QUESTION = 3;
/** Birikmiş cevap metninin üst sınırı (karakter) — modele giden ev sahibi metni sınırsız büyümesin. */
export const HOST_ANSWER_MAX = 2_000;
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
  queued: "Sıraya alındı; birazdan misafire gidecek ✓",
  declined: "Tamam, gönderilmedi. Soru panelde açık.",
  takesOver: "Tamam, size bıraktım.",
  unknown: "Tamam, misafire bir şey gönderilmedi. Soru panelde açık.",
  unclear: "Cevabınızdan misafire gidecek bir mesaj çıkaramadım. Panelden yazabilirsiniz:",
  partial: "Cevabınız sorunun tamamını karşılamıyor. Eksik kısmı da yazın ya da panelden cevaplayın:",
  composeFailed: "Şu an taslak hazırlanamadı. Panelden yazabilirsiniz:",
  composeLimit: "Bu soru için daha fazla taslak hazırlanamıyor. Panelden yazabilirsiniz:",
  busy: "Önceki cevabınız hâlâ işleniyor; bu mesaj dikkate alınmadı. Önizleme gelince gerekirse yeniden yazın.",
  none: "Şu an bekleyen bir misafir sorusu yok.",
  ambiguous: "Birden çok bekleyen soru var. Cevabınızı ilgili soru mesajına \"Yanıtla\" diyerek yazın.",
  closedElsewhere: "Soru gönderildikten sonra bu konuşmaya panelden yazıldı; çift mesaj olmasın diye misafire bir şey gönderilmedi.",
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
  if (HOST_QUESTION_LIVE_STATUSES.includes(status)) return expiresAt.getTime() <= now.getTime() ? "expired" : "waiting";
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

function decryptOrNull(enc: string | null, aad: string): string | null {
  if (!enc) return null;
  try {
    return decryptSecretBound(enc, aad);
  } catch {
    return null;
  }
}

/** Önceki cevap(lar) + yenisi; tavanı aşarsa en yeni kısım kalır (sonraki söz öncekini düzeltir). */
function accumulateAnswer(previous: string | null, text: string): string {
  const joined = previous ? `${previous}\n${text}` : text;
  const chars = [...joined];
  return chars.length <= HOST_ANSWER_MAX ? joined : chars.slice(chars.length - HOST_ANSWER_MAX).join("");
}

/**
 * Etkin bağlantıdan gelen metin / düğme. `to` = ev sahibinin numarası (cevaplar oraya). Veritabanı hatası yukarı çıkar (web kancası mesajın
 * kilidini bırakır, Meta yeniden dener) — yeniden teslim kaldığı yerden işlenir.
 */
export async function handleHostAnswer(input: {
  binding: BindingForAnswer;
  to: string;
  event: HostInboundEvent;
  transport: HostChannelTransport | null;
  now?: Date;
}): Promise<HostAnswerOutcome> {
  const { binding, event, transport } = input;
  const org = binding.organizationId;
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
    where: { organizationId: org, bindingId: binding.id, status: { in: [...HOST_QUESTION_LIVE_STATUSES] } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 20,
    select,
  });
  // Bağlamın sorusu YALNIZ gönderenin işletmesinde okunur; başka işletmede olup olmadığına yalnız işletme kimliğiyle bakılır (içerik okunmaz)
  // — o durumda eşleyiciye yalnız "yabancı" işareti gider (Haiku 10-30 P3).
  const byContext = event.contextId ? { OR: [{ providerMessageId: event.contextId }, { previewMessageId: event.contextId }] } : null;
  const contextual = byContext ? await prisma.hostQuestion.findFirst({ where: { ...byContext, organizationId: org }, select }) : null;
  const foreignContext =
    byContext && !contextual
      ? await prisma.hostQuestion.findFirst({ where: { ...byContext, organizationId: { not: org } }, select: { organizationId: true } })
      : null;
  if (foreignContext) {
    await logEvent("host_channel.answer.foreign", {}, { organizationId: org });
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
  const c = correlateHostReply({ contextId: event.contextId, senderOrgId: org, questions: pending, now });
  if (c.kind === "foreign") {
    await logEvent("host_channel.answer.foreign", {}, { organizationId: org });
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
    where: { id: c.questionId, organizationId: org, bindingId: binding.id },
    select: {
      id: true,
      status: true,
      version: true,
      composeCount: true,
      conversationId: true,
      turnMessageId: true,
      createdAt: true,
      answerMessageId: true,
      answerEnc: true,
      providerMessageId: true,
      previewMessageId: true,
    },
  });
  if (!q) return "busy";
  // Meta YENİDEN TESLİMİ (sert inceleme 10-30 A2): bu mesaj bu soruya zaten bağlandı. Önceki deneme yarıda düştüyse (soru yeniden açıldı ya da
  // "işleniyor"da kaldı ya da önizleme hiç gitmedi) kaldığı yerden sürdürülür; önizleme ev sahibine gittiyse / gönderim başladıysa tekrar
  // işlenmez.
  const redelivery = q.answerMessageId === event.providerMessageId;
  if (redelivery) {
    const resumable = q.status === "sent" || q.status === "answered" || (q.status === "awaiting_confirm" && q.previewMessageId === null);
    if (!resumable) return "duplicate";
  } else if (!(OPEN_STATUSES as readonly string[]).includes(q.status)) {
    // İşlenmekte olan soruya gelen ikinci mesaj (örn. taslak kurulurken düzeltme) sessizce kaybolmasın.
    await reply(HOST_TEXTS.busy, event.providerMessageId);
    return "busy";
  }
  const link = panelLink(q.conversationId);
  if (await hostRepliedSince(org, q.conversationId, q.createdAt)) {
    await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, status: q.status, version: q.version },
      data: { status: "answered_elsewhere", version: { increment: 1 } },
    });
    await reply(`${HOST_TEXTS.closedElsewhere} ${link}`, event.providerMessageId);
    return "closed";
  }
  // Soru sorulduktan SONRA misafir yeniden yazdı: ev sahibi o mesajı görmedi, taslak bayat olabilir (vazgeçti / düzeltti / yeni sorun).
  if (await guestWroteSince(q.conversationId, q.createdAt)) {
    await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, status: q.status, version: q.version },
      data: { status: "superseded", version: { increment: 1 } },
    });
    await reply(`${HOST_TEXTS.guestWrote} ${link}`, event.providerMessageId);
    return "closed";
  }

  // "Ben yazacağım" (metin ya da şablon düğmesi): model çağrılmaz, misafire bir şey gitmez, soru panelde ev sahibinde.
  if (codeAnswerKind({ kind: "text", text }) === "host_takes_over") {
    const won = await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, status: q.status, version: q.version },
      data: { status: "host_takes_over", version: { increment: 1 } },
    });
    if (won.count === 1) await reply(HOST_TEXTS.takesOver, event.providerMessageId);
    return "takes_over";
  }

  if (q.composeCount >= MAX_COMPOSE_PER_QUESTION) {
    await reply(`${HOST_TEXTS.composeLimit} ${link}`, event.providerMessageId);
    return "compose_failed";
  }

  // Cevap şifreli saklanır. Yeniden teslimde saklı metin aynen kullanılır; yeni mesaj öncekilere eklenir ("eksik kısmı da yazın" sonrası
  // ilk kısım kaybolmasın — sert inceleme 10-30 A2). Aynı WhatsApp mesajı BAŞKA soruya bağlanamaz (`answerMessageId` tekil).
  const previous = decryptOrNull(q.answerEnc, answerAad(q.id, org));
  const hostAnswer = redelivery && previous ? previous : accumulateAnswer(previous, text);
  let claimed: number;
  try {
    claimed = (
      await prisma.hostQuestion.updateMany({
        where: { id: q.id, organizationId: org, status: q.status, version: q.version },
        data: {
          status: "answered",
          answerEnc: encryptSecretBound(hostAnswer, answerAad(q.id, org)),
          answerMessageId: event.providerMessageId,
          answeredAt: now,
          draftEnc: null,
          draftHash: null,
          previewMessageId: null,
          version: { increment: 1 },
        },
      })
    ).count;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    throw err;
  }
  if (claimed !== 1) return "busy";
  await logEvent("host_channel.answer.received", { questionId: q.id }, { organizationId: org });

  // Bu turun yazımları SÜRÜME bağlı: süpürge takılan turu yeniden açıp yeni bir cevap işlenmeye başladıysa eski tur onu ezmez (Haiku 10-30 P3).
  const answeredVersion = q.version + 1;
  const reopen = (extra: Prisma.HostQuestionUpdateManyMutationInput = {}) =>
    prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, status: "answered", version: answeredVersion },
      data: { status: "sent", version: { increment: 1 }, ...extra },
    });
  try {
    return await composeAndPreview({ ...input, now, org, q, hostAnswer, answeredVersion, reopen, reply, link });
  } catch (err) {
    // Yarıda düştü: soru yeniden açık (Meta'nın yeniden teslimi ya da ev sahibinin yeni cevabı işler). Yeniden açma da düşerse süpürge kurtarır.
    await reopen().catch(() => null);
    throw err;
  }
}

async function composeAndPreview(ctx: {
  binding: BindingForAnswer;
  to: string;
  event: HostInboundEvent;
  transport: HostChannelTransport | null;
  now: Date;
  org: string;
  q: { id: string; version: number; conversationId: string; turnMessageId: string; providerMessageId: string | null };
  hostAnswer: string;
  answeredVersion: number;
  reopen: (extra?: Prisma.HostQuestionUpdateManyMutationInput) => Promise<{ count: number }>;
  reply: (text: string, replyTo?: string | null) => Promise<void>;
  link: string;
}): Promise<HostAnswerOutcome> {
  const { binding, event, transport, org, q, hostAnswer, answeredVersion, reopen, reply, link } = ctx;
  const conv = await prisma.conversation.findFirst({
    where: { id: q.conversationId, property: { organizationId: org } },
    select: {
      guestIdentifier: true,
      property: { select: { name: true, organization: { select: { timezone: true } } } },
      reservation: { select: { arrivalDate: true, departureDate: true, guestName: true, guestGivenName: true } },
    },
  });
  const turn = await prisma.message.findFirst({
    where: { id: q.turnMessageId, conversation: { id: q.conversationId, property: { organizationId: org } } },
    select: { body: true },
  });
  // Misafirin adı modele (ve dolayısıyla Meta'ya giden önizlemeye) gitmez — soru metniyle aynı kural (`question-text.ts`).
  const guestNames = [conv?.reservation?.guestName, conv?.reservation?.guestGivenName, conv?.guestIdentifier].filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
  const budget = await consumeDailyAiBudget(org);
  if (!budget.ok) {
    await reopen();
    await reply(`${HOST_TEXTS.composeFailed} ${link}`, event.providerMessageId);
    return "compose_failed";
  }
  const composed = await composeGuestReplyFromHostAnswer({
    hostAnswer,
    guestMessages: turn?.body ? [withoutGuestNames(turn.body, guestNames)] : [],
  });
  // Model çağrısı saniyeler sürer: arada "DUR" / rol düşmesi / şifre değişimi olduysa o numaraya artık hiçbir şey gitmez (sert inceleme 10-30 A2).
  if (!(await usableBinding(binding))) {
    await reopen({ composeCount: { increment: 1 } });
    return "not_usable";
  }
  if (!composed.ok) {
    if (composed.kind === "host_takes_over") {
      await prisma.hostQuestion.updateMany({
        where: { id: q.id, organizationId: org, status: "answered", version: answeredVersion },
        data: { status: "host_takes_over", version: { increment: 1 }, composeCount: { increment: 1 } },
      });
      await reply(HOST_TEXTS.takesOver, event.providerMessageId);
      return "takes_over";
    }
    if (composed.kind === "host_unknown") {
      await prisma.hostQuestion.updateMany({
        where: { id: q.id, organizationId: org, status: "answered", version: answeredVersion },
        data: { status: "host_unknown", version: { increment: 1 }, composeCount: { increment: 1 } },
      });
      await reply(HOST_TEXTS.unknown, event.providerMessageId);
      return "unclear";
    }
    await reopen({ composeCount: { increment: 1 } });
    const failed = composed.reason === "no_key" || composed.reason === "model_failed";
    await reply(`${failed ? HOST_TEXTS.composeFailed : HOST_TEXTS.unclear} ${link}`, event.providerMessageId);
    return failed ? "compose_failed" : "unclear";
  }
  // Kapsama kuralı (K-1029-A ile aynı ruh): cevap bir soruyu karşılamıyorsa misafire HENÜZ hiçbir şey gitmez, soru açık kalır.
  if (composed.uncovered.length > 0) {
    await reopen({ composeCount: { increment: 1 } });
    await reply(`${HOST_TEXTS.partial} ${link}`, event.providerMessageId);
    return "partial";
  }

  // Önizleme hangi daire / hangi konaklama / hangi soru olduğunu söyler (iki benzer soru karışmasın — sert inceleme 10-30 A2) ve TAMAMEN
  // görünmeli: ev sahibinin görmediği metin onaylanamaz (WhatsApp düğmeli mesaj gövdesi 1024 karakter; Haiku 10-30 P3).
  const header = previewHeader(conv, turn?.body ?? "", guestNames);
  const body = `${HOST_TEXTS.previewHeader}\n\n“${composed.reply}”`;
  const withTr = composed.replyTr && composed.replyTr !== composed.reply ? `${body}\n\n${HOST_TEXTS.previewTr} “${composed.replyTr}”` : body;
  const preview = [`${header}${withTr}`, `${header}${body}`].find((p) => p.length <= PREVIEW_MAX) ?? null;
  if (!preview) {
    await reopen({ composeCount: { increment: 1 } });
    await reply(`${HOST_TEXTS.unclear} ${link}`, event.providerMessageId);
    return "unclear";
  }

  const version = q.version + 2;
  const drafted = await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: org, status: "answered", version: answeredVersion },
    data: {
      status: "awaiting_confirm",
      draftEnc: encryptSecretBound(composed.reply, draftAad(q.id, org)),
      draftHash: sha256(composed.reply),
      composeCount: { increment: 1 },
      version,
    },
  });
  if (drafted.count !== 1) return "busy";
  // Önizleme SORU mesajına yanıt olarak gider (WhatsApp üstte soruyu gösterir).
  const sent = transport
    ? await transport
        .sendChoices(
          ctx.to,
          preview,
          [
            { id: hostQuestionButtonId(q.id, version, "send"), title: HOST_TEXTS.send },
            { id: hostQuestionButtonId(q.id, version, "cancel"), title: HOST_TEXTS.cancel },
          ],
          q.providerMessageId ?? event.providerMessageId,
        )
        .catch(() => null)
    : null;
  if (!sent?.ok || !sent.providerMessageId) {
    // Önizleme ev sahibine ulaşmadı: onaylanamayacak bir taslak "onay bekliyor"da kalmasın — soru yeniden açık ve ev sahibi bilir (Haiku 10-30 P3,
    // sert inceleme 10-30 A2). Belirsiz hatada önizleme yine de ulaşmış olabilir: eski düğme sürüm farkıyla işlemez.
    await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, status: "awaiting_confirm", version },
      data: { status: "sent", draftEnc: null, draftHash: null, version: { increment: 1 } },
    });
    await reply(`${HOST_TEXTS.composeFailed} ${link}`, event.providerMessageId);
    return "compose_failed";
  }
  await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: org, version },
    data: { previewMessageId: sent.providerMessageId },
  });
  return "previewed";
}

/** Önizlemenin ilk satırları: "Daire · 12–15 Kas" + misafirin sorusundan kısa, maskeli alıntı (soru mesajının aynısı). */
function previewHeader(
  conv: {
    property: { name: string; organization: { timezone: string | null } };
    reservation: { arrivalDate: Date; departureDate: Date } | null;
  } | null,
  turnBody: string,
  guestNames: readonly string[],
): string {
  if (!conv?.reservation || !turnBody) return "";
  const tz = conv.property.organization.timezone || "Europe/Istanbul";
  const dayMonth = (d: Date) => {
    const [, m, day] = calendarDateOf(d, tz).key.split("-").map(Number);
    return { day: day!, month: m! };
  };
  const m = buildHostQuestion({
    propertyName: conv.property.name,
    arrival: dayMonth(conv.reservation.arrivalDate),
    departure: dayMonth(conv.reservation.departureDate),
    guestText: turnBody,
    guestNames,
  });
  return `${m.property} · ${m.dates}\n“${m.quote}”\n\n`;
}

/**
 * Soru gönderildikten SONRA ev sahibi panelden (ya da başka yoldan) misafire yazdı mı — yazdıysa WhatsApp cevabı ikinci bir mesaj olurdu.
 * Sayılmayanlar (sert inceleme 10-30 A2): kanalın kendi otomatik mesajları, yalnız kendi talebini yanıtlayan karar kartı mesajları ve bu
 * konuşmanın sorularına WhatsApp'tan onaylanıp gönderilen cevaplar (Haiku 10-30 P2: misafirin ikinci sorusu, birincisinin WhatsApp cevabı
 * yüzünden kapanıyordu).
 */
async function hostRepliedSince(organizationId: string, conversationId: string, since: Date): Promise<boolean> {
  const [ours, decisions] = await Promise.all([
    prisma.hostQuestion.findMany({ where: { organizationId, conversationId, resultMessageId: { not: null } }, select: { resultMessageId: true }, take: 200 }),
    prisma.decisionRequest.findMany({ where: { organizationId, conversationId, resultMessageId: { not: null } }, select: { resultMessageId: true }, take: 200 }),
  ]);
  const exclude = [...ours, ...decisions].map((r) => r.resultMessageId).filter((x): x is string => typeof x === "string");
  const n = await prisma.message.count({
    where: {
      conversationId,
      direction: "outbound",
      authorType: "host",
      createdAt: { gt: since },
      AND: [notChannelAutomationWhere()],
      ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
    },
  });
  return n > 0;
}

/** Soru gönderildikten sonra misafirden yeni mesaj geldi mi (turun kendi mesajları sorudan önce yazılmıştır). */
async function guestWroteSince(conversationId: string, since: Date): Promise<boolean> {
  return (await prisma.message.count({ where: { conversationId, direction: "inbound", createdAt: { gt: since } } })) > 0;
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
  const org = binding.organizationId;
  // Kiracı: soru YALNIZ gönderen numaranın bağlantısında aranır. Başka işletmenin soru kimliği düğmeye yazılmış olsa bile bulunmaz.
  const q = await prisma.hostQuestion.findFirst({
    where: { id: parsed.questionId, organizationId: org, bindingId: binding.id },
    select: {
      id: true,
      status: true,
      version: true,
      conversationId: true,
      turnMessageId: true,
      answerEnc: true,
      draftEnc: true,
      draftHash: true,
      createdAt: true,
      expiresAt: true,
      conversation: { select: { id: true, channel: true, guestIdentifier: true, externalReservationId: true, reservation: { select: { status: true } } } },
    },
  });
  if (!q) {
    await logEvent("host_channel.answer.foreign", {}, { organizationId: org });
    return "foreign";
  }
  // Aynı düğmenin ikinci dokunuşu / yeniden teslimi: gönderim sürüyor (ya da yarıda kaldı — süpürge ev sahibine söyler) veya bu düğmeyle
  // gönderim tamamlandı → ikinci mesaj yok, "geçersiz önizleme" de denmez (gitmiş bir cevabı "geçersiz" göstermek panelden tekrar yazdırır).
  if ((q.status === "sending" && q.version === parsed.version + 1) || (q.status === "done" && q.version === parsed.version + 2)) return "duplicate";
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
      where: { id: q.id, organizationId: org, status: "awaiting_confirm", version: q.version },
      data: { status: "declined", version: { increment: 1 } },
    });
    if (won.count === 1) await reply(HOST_TEXTS.declined, event.providerMessageId);
    return "closed";
  }

  // [Gönder] — sürüm CAS: çift dokunuş ikinci mesaj üretmez, eski düğme yeni taslağı onaylayamaz.
  const locked = await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: org, status: "awaiting_confirm", version: q.version },
    data: { status: "sending", version: { increment: 1 } },
  });
  if (locked.count !== 1) return "busy";
  const sendingVersion = q.version + 1;
  const settle = (status: string, extra: Prisma.HostQuestionUpdateManyMutationInput = {}) =>
    prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, status: "sending", version: sendingVersion },
      data: { status, version: { increment: 1 }, ...extra },
    });
  const link = panelLink(q.conversationId);

  // Gönderimden ÖNCEKİ denetimler: biri veritabanı hatasıyla düşerse kilit BIRAKILIR (onay bekleyen hâline, aynı sürüm) — Meta'nın yeniden
  // teslimi aynı düğmeyle baştan işler; misafire henüz hiçbir şey gitmedi (sert inceleme 10-30 A2).
  let draft: string;
  try {
    const checked = await preSendChecks({ ...input, org, q, settle, link });
    if (typeof checked !== "string") return checked.outcome;
    draft = checked;
  } catch (err) {
    await prisma.hostQuestion
      .updateMany({ where: { id: q.id, organizationId: org, status: "sending", version: sendingVersion }, data: { status: "awaiting_confirm", version: q.version } })
      .catch(() => null);
    throw err;
  }

  let result: Awaited<ReturnType<typeof sendHostMessage>>;
  try {
    result = await sendHostMessage({
      organizationId: org,
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
    await settle("send_unverified").catch(() => null);
    await reply(`${HOST_TEXTS.unverified} ${link}`, event.providerMessageId);
    return "closed";
  }
  // Gönderimden SONRAKİ kayıtlar en iyi çaba: misafire gitmiş bir cevap, kayıt hatası yüzünden ev sahibine "gitmedi" gibi görünmesin.
  if (result.status === "sent" || result.status === "queued") {
    const resultMessageId = result.message?.id ?? null;
    await settle("done", { resultMessageId }).catch(() => null);
    await answerTurnItems({ organizationId: org, conversationId: q.conversationId, turnMessageId: q.turnMessageId, resultMessageId, now: input.now }).catch(
      () => null,
    );
    await logEvent("host_channel.answer.sent_to_guest", { questionId: q.id }, { organizationId: org }).catch(() => null);
    await reply(result.status === "queued" ? HOST_TEXTS.queued : HOST_TEXTS.sent, event.providerMessageId);
    return "closed";
  }
  if (result.status === "not_connected") {
    await settle("sent").catch(() => null);
    await reply(HOST_TEXTS.notConnected, event.providerMessageId);
    return "closed";
  }
  // Kesin ret ya da çift gönderim kilidi hiç alınamadı (kilit deposu arızası, fail-closed): misafire HİÇBİR ŞEY gitmedi → soru yeniden açık.
  if (result.status === "failed_definitive" || result.status === "claim_unavailable") {
    await settle("sent").catch(() => null);
    await reply(`${HOST_TEXTS.sendFailed} ${link}`, event.providerMessageId);
    return "closed";
  }
  await settle("send_unverified").catch(() => null);
  await reply(`${HOST_TEXTS.unverified} ${link}`, event.providerMessageId);
  return "closed";
}

/** [Gönder] öncesi denetimler; geçerse gönderilecek taslak metni, geçmezse soruyu kapatıp / açıp sonucu döner. */
async function preSendChecks(ctx: {
  binding: BindingForAnswer;
  event: HostInboundEvent;
  reply: (text: string, replyTo?: string | null) => Promise<void>;
  org: string;
  q: {
    id: string;
    conversationId: string;
    answerEnc: string | null;
    draftEnc: string | null;
    draftHash: string | null;
    createdAt: Date;
    conversation: { reservation: { status: string } | null };
  };
  settle: (status: string, extra?: Prisma.HostQuestionUpdateManyMutationInput) => Promise<{ count: number }>;
  link: string;
}): Promise<string | { outcome: HostAnswerOutcome }> {
  const { binding, event, reply, org, q, settle, link } = ctx;
  const draft = decryptOrNull(q.draftEnc, draftAad(q.id, org));
  const answer = decryptOrNull(q.answerEnc, answerAad(q.id, org));
  // Önizlenen metin = gönderilecek metin; kod denetimi gönderim anında yeniden.
  if (draft === null || answer === null || sha256(draft) !== q.draftHash || checkComposedGuestReply({ reply: draft, hostAnswer: answer }) !== null) {
    await settle("sent");
    await reply(`${HOST_TEXTS.sendFailed} ${link}`, event.providerMessageId);
    return { outcome: "compose_failed" };
  }
  if (await hostRepliedSince(org, q.conversationId, q.createdAt)) {
    await settle("answered_elsewhere");
    await reply(`${HOST_TEXTS.closedElsewhere} ${link}`, event.providerMessageId);
    return { outcome: "closed" };
  }
  if (q.conversation.reservation?.status === "cancelled") {
    await settle("superseded");
    await reply(HOST_TEXTS.cancelledStay, event.providerMessageId);
    return { outcome: "closed" };
  }
  // Soru sorulduktan sonra misafir yeniden yazdıysa taslak bayattır (sert inceleme 10-30 A2: önceden yalnız önizlemeden sonrası sayılıyordu;
  // soru ile cevap arasındaki "vazgeçtim / yanlış yazdım" kaçıyordu).
  if (await guestWroteSince(q.conversationId, q.createdAt)) {
    await settle("superseded");
    await reply(`${HOST_TEXTS.guestWrote} ${link}`, event.providerMessageId);
    return { outcome: "closed" };
  }
  // Bağlantı gönderimden HEMEN önce yeniden: arada "DUR" / rol düşmesi / şifre değişimi olduysa gönderilmez (Haiku 10-30 P3).
  if (!(await usableBinding(binding))) {
    await settle("sent");
    return { outcome: "not_usable" };
  }
  return draft;
}

/**
 * Gönderilen cevap turun KENDİ öğelerini "cevaplandı" yapar (cevap mesajına bağlı — kalıcı kuyruk kesin hatada geri açar). Öteki öğeler açık
 * kalır: ev sahibi WhatsApp'ta yalnız bu turun sorusunu gördü. Hassas öğe yapay zekâ cevabıyla kapanmaz (`nextStatus`).
 */
async function answerTurnItems(input: { organizationId: string; conversationId: string; turnMessageId: string; resultMessageId: string | null; now: Date }) {
  const items = await prisma.conversationItem.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversationId, messageId: input.turnMessageId, status: { in: ["open", "pending_host"] } },
    select: { id: true },
  });
  await applyItemEvent(prisma, {
    organizationId: input.organizationId,
    ids: items.map((i) => i.id),
    event: "answered",
    now: input.now,
    answeredByMessageId: input.resultMessageId,
  });
}

/**
 * Saklama + süre (saatlik): cevap beklerken süresi dolan sorular "süresi geçti" olur; kapanmış sorunun cevap / taslak metni + özeti 7 gün sonra
 * silinir (tasarım §5.8); süresi geçmiş "bekleyen soru yok" gün kilitleri silinir. Yarıda kalan ara durumlar kurtarılır ve ev sahibine
 * SÖYLENİR (aktarım verilirse): taslak kurma → soru yeniden açık ("taslak hazırlanamadı"); gönderim → sonucu bilinmiyor ("doğrulanamadı",
 * kör tekrar YOK — misafire gitmiş olabilir). Yeni işlenen (taze) satıra dokunulmaz.
 */
export async function sweepHostQuestions(
  now: Date = new Date(),
  transport: HostChannelTransport | null = null,
): Promise<{ expired: number; purged: number; recovered: number }> {
  const stuckBefore = new Date(now.getTime() - STUCK_MS);
  const stuck = await prisma.hostQuestion.findMany({
    where: { status: { in: [...BUSY_STATUSES] }, updatedAt: { lt: stuckBefore } },
    select: { id: true, organizationId: true, bindingId: true, conversationId: true, status: true, version: true },
    take: 200,
  });
  let recovered = 0;
  for (const s of stuck) {
    const next = s.status === "answered" ? "sent" : "send_unverified";
    // Sürüm CAS: okuma ile yazma arasında satır ilerlediyse (her geçiş sürümü artırır) dokunulmaz.
    const won = await prisma.hostQuestion.updateMany({
      where: { id: s.id, status: s.status, version: s.version },
      data: { status: next, version: { increment: 1 } },
    });
    if (won.count !== 1) continue;
    recovered++;
    if (!transport || !s.bindingId) continue;
    try {
      if (!(await usableBinding({ id: s.bindingId, organizationId: s.organizationId }))) continue;
      const to = await activeBindingAddress(s.bindingId, s.organizationId);
      if (!to) continue;
      const text = next === "sent" ? HOST_TEXTS.composeFailed : HOST_TEXTS.unverified;
      await transport.sendText(to, `${text} ${panelLink(s.conversationId)}`, null);
    } catch {
      // Bildirim en iyi çaba; durum zaten kurtarıldı.
    }
  }
  const expired = await prisma.hostQuestion.updateMany({
    where: { status: { in: [...OPEN_STATUSES] }, expiresAt: { lt: now } },
    data: { status: "expired", version: { increment: 1 } },
  });
  const purged = await prisma.hostQuestion.updateMany({
    where: {
      status: { notIn: [...HOST_QUESTION_LIVE_STATUSES] },
      updatedAt: { lt: new Date(now.getTime() - HOST_QUESTION_TEXT_RETENTION_MS) },
      OR: [{ answerEnc: { not: null } }, { draftEnc: { not: null } }, { draftHash: { not: null } }],
    },
    data: { answerEnc: null, draftEnc: null, draftHash: null },
  });
  // Günlük "bekleyen soru yok" kilitleri birikmesin (bağlantı başına günde en çok bir satır).
  await prisma.systemLock.deleteMany({ where: { name: { startsWith: NONE_LOCK_PREFIX }, lockedUntil: { lt: now } } });
  return { expired: expired.count, purged: purged.count, recovered };
}
