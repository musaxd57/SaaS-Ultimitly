import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecretBound, encryptSecretBound } from "@/lib/crypto";
import { logEvent } from "@/lib/event-log";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { afterKbItemsChanged } from "@/lib/kb/after-change";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { GUEST_DELIVERABLE_KB_WHERE } from "@/lib/kb-review";
import { foldTurkishAscii } from "@/lib/ai/fallback";
import { extractDraftsFromPairs, gateDraft, type DraftFlag, type LearnDraft } from "@/lib/history-learn/extract";
import { kbOverlaps, prepareKbItems } from "@/lib/history-learn/kb-overlap";
import { maskForLearning } from "@/lib/history-learn/mask";
import type { HostChoice } from "./types";

// ---------------------------------------------------------------------------
// WHATSAPP CEVABI → BİLGİ TABANI, ÖNİZLEMELİ ONAY (kurucu 10-31; tasarım `docs/TASARIM-2026-10-31-whatsapp-cevabi-bilgi-tabanina.md` §7,
// migration 89). Anahtar `HOST_QUESTION_KB_SAVE_ENABLED` (yalnız "1"), varsayılan KAPALI.
//  · Misafire gönderim (bugünkü [Gönder] yolu) hiç değişmez; bu dosya gönderim "Gönderildi ✓" olduktan SONRA ve ondan bağımsız koşar. Bilgi
//    tabanı adımının hiçbir sonucu misafir yolunu etkilemez (hata → yeniden gönderim YOK).
//  · Sıra: ucuz kod ön süzgeci → AYRI mesajla [Bilgi tabanına ekle] → (dokununca) "Geçmişten öğren"in çıkarıcısı + kapısı (model; tek seferlik
//    / zamana bağlı / kişiye özel / ödeme / kod işaretleri) + 7 dilde zaman / söz işaretleri → önizleme (daire · konu · bilgi · varsa mevcut
//    bilgi) → [Kaydet] / [Yerine yaz] / [Ayrı ekle] / [Vazgeç].
//  · Öneri soru satırında ŞİFRELİ durur (`kbProposalEnc`); bilgi tabanı kalemi YALNIZ kayıt anında `approved` yazılır — taslak kalem yok (panel
//    listesine / plan sınırına / kopyaya sızmaz). Kalemin istek kimliği `hq:<soru>` (tekil): iki kez [Kaydet] ikinci kalem açmaz.
//  · Kategori izin listesi: Wi-Fi ve giriş HARİÇ (sır kategorisi + otomatik mesaj şablon rozeti) — bunlar panelden eklenir.
//  · Kaydedilen metin istemde VERİ çerçevesinde durur; talimat biçimli metin (`detectKbInstructionHijack`) ve kapı kodu kapıda düşer.
// ---------------------------------------------------------------------------

export function hostQuestionKbSaveEnabled(): boolean {
  return process.env.HOST_QUESTION_KB_SAVE_ENABLED?.trim() === "1";
}

export type KbButtonAction = "offer" | "save" | "replace" | "separate" | "cancel";
const KB_ACTIONS: readonly KbButtonAction[] = ["offer", "save", "replace", "separate", "cancel"];

/** Düğme kimliği: `hk.<soru>.<eylem>`. Sır değildir — yetki gönderen numaranın bağlantısından ve sorunun kiracısından. */
export function kbButtonId(questionId: string, action: KbButtonAction): string {
  return `hk.${questionId}.${action}`;
}
export function parseKbButton(id: string): { questionId: string; action: KbButtonAction } | null {
  const m = /^hk\.([0-9a-f-]{36})\.([a-z]{4,8})$/.exec(id);
  if (!m || !(KB_ACTIONS as readonly string[]).includes(m[2]!)) return null;
  return { questionId: m[1]!, action: m[2] as KbButtonAction };
}

export const KB_TEXTS = {
  offer: "Bu cevabı bilgi tabanına eklemek ister misiniz? Benzer bir soru gelince yapay zekâ bu bilgiyi kullanır.",
  offerButton: "Bilgi tabanına ekle",
  notGeneral: "Bu cevap bu konaklamaya ya da belirli bir güne özel görünüyor; bilgi tabanına eklenmedi.",
  nothing: "Bu cevaptan kalıcı bir bilgi çıkmadı; bilgi tabanına eklenmedi.",
  panelOnly: "Wi-Fi ve giriş bilgileri bilgi tabanına panelden eklenir.",
  alreadySaved: "Bu bilgi bilgi tabanında zaten kayıtlı ✓",
  saved: "Bilgi tabanına eklendi ✓",
  cancelled: "Tamam, bilgi tabanına eklenmedi.",
  stale: "Bu öneri artık geçerli değil.",
  disabled: "Bilgi tabanına ekleme şu an kapalı.",
  failed: "Bilgi tabanına kaydedilemedi; panelden ekleyebilirsiniz.",
  changed: "Bilgi tabanındaki kayıt bu arada değişti; panelden kontrol edin.",
  planFull: "Bu dairenin bilgi tabanı sınırı dolu; panelden yer açabilirsiniz.",
} as const;

/** Genel bilgi SAYILMAYAN işaretler (gateDraft): tek seferlik, zamana bağlı, deneme, bilgi yok, ödeme, kişisel bilgi, kapı, misafir adı, tek sefer eylem. */
const NOT_GENERAL_FLAGS: ReadonlySet<DraftFlag> = new Set([
  "one_off",
  "time_bound",
  "tentative",
  "no_info",
  "payment",
  "sensitive",
  "door_mention",
  "guest_name",
  "single_source",
  "needs_edit",
]);
/** Panelden eklenen kategoriler (sır / şablon rozeti). */
const PANEL_ONLY_CATEGORIES: ReadonlySet<string> = new Set(["wifi", "checkin"]);
/**
 * Zaman / kişiye özel / söz işaretleri — 7 dil (katlanmış metin). "Bugün size özel 13.00'te giriş" ya da "Teknisyen yarın gelecek" genel bilgi
 * değildir; şüphede teklif YOK (yanlış kalıcı bilgi, eksik tekliften pahalı).
 */
const NOT_GENERAL_MARKERS = new RegExp(
  [
    "bugun", "yarin", "bu aksam", "bu gece", "bu sabah", "bu sefer", "size ozel", "sizin icin", "simdilik", "gelecek", "gelecekler", "gelir gelmez",
    "today", "tomorrow", "tonight", "this time", "for you", "right now", "will come", "is coming",
    "heute", "morgen", "heute abend", "fur sie", "für sie", "kommt",
    "сегодня", "завтра", "для вас", "приедет", "придет", "придёт",
    "اليوم", "غدا", "لكم", "سيأتي",
    "aujourd'hui", "demain", "pour vous", "viendra",
    "hoy", "manana", "mañana", "para usted", "vendra", "vendrá",
  ]
    .map((w) => `(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`)
    .join("|"),
  "iu",
);

/** Ucuz ön süzgeç (model YOK): gönderilen ev sahibi cevabı kalıcı bilgi adayı mı? Şüphede hayır. */
export function kbOfferCandidate(answer: string): boolean {
  const a = answer.trim();
  if (a.length < 8 || a.length > 600) return false;
  if (NOT_GENERAL_MARKERS.test(foldTurkishAscii(a))) return false;
  const g = gateDraft("Ev sahibi cevabı", a, { supportConversations: 1 });
  return g.ok && !g.flags.some((f) => NOT_GENERAL_FLAGS.has(f));
}

interface KbProposal {
  propertyId: string;
  propertyName: string;
  category: string;
  title: string;
  content: string;
  /** Aynı konuda FARKLI değer taşıyan etkin kalem (varsa) — [Yerine yaz] onu pasife alır. */
  replace: { id: string; updatedAt: string; preview: string } | null;
  /** Yalnız konu benzerliği (çelişki denmez) — önizlemede bilgi olarak. */
  similar: string | null;
}

const proposalAad = (questionId: string, organizationId: string) => `host-question-kb:v1:${questionId}:${organizationId}`;
const answerAad = (questionId: string, organizationId: string) => `host-question-answer:v1:${questionId}:${organizationId}`;
const panelKbLink = (propertyId: string) => `${appBaseUrl()}/properties/${encodeURIComponent(propertyId)}`;

function decryptOrNull(enc: string | null, aad: string): string | null {
  if (!enc) return null;
  try {
    return decryptSecretBound(enc, aad);
  } catch {
    return null;
  }
}

/**
 * Gönderim "Gönderildi ✓" olduktan sonra çağrılır (en iyi çaba, fırlatmaz): aday cevapta soruyu "teklif edildi" yapar ve AYRI mesajla tek düğme
 * gönderir. Soru satırının `status` / `version` alanlarına DOKUNMAZ (bugünkü yinelenen [Gönder] koruması bozulmasın).
 */
export async function offerKbSaveAfterSend(input: {
  organizationId: string;
  questionId: string;
  answer: string;
  choices: (text: string, buttons: readonly HostChoice[]) => Promise<unknown>;
}): Promise<boolean> {
  try {
    if (!hostQuestionKbSaveEnabled() || !kbOfferCandidate(input.answer)) return false;
    const won = await prisma.hostQuestion.updateMany({
      where: { id: input.questionId, organizationId: input.organizationId, status: "done", kbProposalState: null },
      data: { kbProposalState: "offered" },
    });
    if (won.count !== 1) return false;
    await input.choices(KB_TEXTS.offer, [{ id: kbButtonId(input.questionId, "offer"), title: KB_TEXTS.offerButton }]);
    await logEvent("host_channel.kb.offered", { questionId: input.questionId }, { organizationId: input.organizationId }).catch(() => null);
    return true;
  } catch {
    return false;
  }
}

/** Testte çıkarıcıyı değiştirmek için (model çağrısı yok). */
export const __kbSaveHooks: { extract: typeof extractDraftsFromPairs } = { extract: extractDraftsFromPairs };

/**
 * `hk.` düğmesi. Anahtar kapalıyken de buraya gelir ("kapalı" denir — düğme başlığı serbest metin cevap sanılıp misafire yazılmasın).
 * Kiracı: soru YALNIZ gönderen numaranın bağlantısında ve işletmesinde aranır.
 */
export async function handleKbButton(input: {
  organizationId: string;
  bindingId: string;
  parsed: { questionId: string; action: KbButtonAction };
  reply: (text: string) => Promise<void>;
  choices: (text: string, buttons: readonly HostChoice[]) => Promise<unknown>;
  now: Date;
}): Promise<"closed" | "foreign" | "disabled"> {
  const { organizationId: org, parsed, reply } = input;
  if (!hostQuestionKbSaveEnabled()) {
    await reply(KB_TEXTS.disabled);
    return "disabled";
  }
  const q = await prisma.hostQuestion.findFirst({
    where: { id: parsed.questionId, organizationId: org, bindingId: input.bindingId },
    select: {
      id: true,
      status: true,
      answerEnc: true,
      kbProposalEnc: true,
      kbProposalState: true,
      turnMessageId: true,
      conversationId: true,
      conversation: {
        select: { propertyId: true, guestIdentifier: true, property: { select: { name: true } }, reservation: { select: { guestName: true } } },
      },
    },
  });
  if (!q) {
    await logEvent("host_channel.kb.foreign", {}, { organizationId: org }).catch(() => null);
    return "foreign";
  }
  if (parsed.action === "cancel") {
    const won = await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, kbProposalState: { in: ["offered", "previewed"] } },
      data: { kbProposalState: "cancelled", kbProposalEnc: null },
    });
    await reply(won.count === 1 ? KB_TEXTS.cancelled : KB_TEXTS.stale);
    return "closed";
  }
  if (parsed.action === "offer") return prepareProposal({ ...input, q });
  return saveProposal({ ...input, q, mode: parsed.action });
}

type LoadedQuestion = {
  id: string;
  status: string;
  answerEnc: string | null;
  kbProposalEnc: string | null;
  kbProposalState: string | null;
  turnMessageId: string;
  conversationId: string;
  conversation: { propertyId: string; guestIdentifier: string; property: { name: string }; reservation: { guestName: string | null } | null };
};

async function prepareProposal(ctx: {
  organizationId: string;
  q: LoadedQuestion;
  reply: (text: string) => Promise<void>;
  choices: (text: string, buttons: readonly HostChoice[]) => Promise<unknown>;
  now: Date;
}): Promise<"closed"> {
  const { organizationId: org, q, reply } = ctx;
  // Çift dokunuş tek model çağrısı: teklif → hazırlanıyor (CAS).
  const won = await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: org, status: "done", kbProposalState: "offered" },
    data: { kbProposalState: "preparing" },
  });
  if (won.count !== 1) {
    if (q.kbProposalState !== "preparing") await reply(KB_TEXTS.stale);
    return "closed";
  }
  const decline = async (text: string) => {
    await prisma.hostQuestion.updateMany({ where: { id: q.id, organizationId: org, kbProposalState: "preparing" }, data: { kbProposalState: "declined" } });
    await reply(text);
    return "closed" as const;
  };
  try {
    const answer = decryptOrNull(q.answerEnc, answerAad(q.id, org));
    if (!answer) return await decline(KB_TEXTS.stale);
    const guestNames = [q.conversation.guestIdentifier, q.conversation.reservation?.guestName].filter((n): n is string => !!n?.trim());
    const turn = await prisma.message.findFirst({ where: { id: q.turnMessageId, conversationId: q.conversationId }, select: { body: true } });
    const month = ctx.now.toISOString().slice(0, 7);
    const result = await __kbSaveHooks.extract(
      [{ n: 1, conversationId: q.conversationId, month, question: maskForLearning(turn?.body ?? "", guestNames), answer: maskForLearning(answer, guestNames) }],
      { guestNames },
    );
    const draft: LearnDraft | undefined = result.drafts[0];
    if (!draft) return await decline(KB_TEXTS.nothing);
    if (PANEL_ONLY_CATEGORIES.has(draft.category)) return await decline(KB_TEXTS.panelOnly);
    if (draft.flags.some((f) => NOT_GENERAL_FLAGS.has(f)) || NOT_GENERAL_MARKERS.test(foldTurkishAscii(`${draft.title}\n${draft.content}`))) {
      return await decline(KB_TEXTS.notGeneral);
    }
    const items = await prisma.knowledgeBaseItem.findMany({
      where: { propertyId: q.conversation.propertyId, ...GUEST_DELIVERABLE_KB_WHERE, supersededById: null },
      select: { id: true, category: true, title: true, content: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 500,
    });
    const overlaps = kbOverlaps(draft, prepareKbItems(items));
    if (overlaps.some((o) => o.kind === "same")) return await decline(KB_TEXTS.alreadySaved);
    const differs = overlaps.find((o) => o.kind === "differs") ?? null;
    const topic = overlaps.find((o) => o.kind === "topic") ?? null;
    const proposal: KbProposal = {
      propertyId: q.conversation.propertyId,
      propertyName: q.conversation.property.name,
      category: draft.category,
      title: draft.title,
      content: draft.content,
      replace: differs ? { id: differs.id, updatedAt: differs.updatedAt.toISOString(), preview: differs.preview } : null,
      similar: !differs && topic ? topic.preview : null,
    };
    const stored = await prisma.hostQuestion.updateMany({
      where: { id: q.id, organizationId: org, kbProposalState: "preparing" },
      data: { kbProposalState: "previewed", kbProposalEnc: encryptSecretBound(JSON.stringify(proposal), proposalAad(q.id, org)) },
    });
    if (stored.count !== 1) return "closed";
    const lines = [
      "Bilgi tabanına eklenecek",
      `Daire: ${proposal.propertyName}`,
      `Konu: ${proposal.title}`,
      `Bilgi: "${proposal.content}"`,
      ...(proposal.replace ? [`Şu anki bilgi: "${proposal.replace.preview}"`] : []),
      ...(proposal.similar ? [`Benzer mevcut bilgi: "${proposal.similar}"`] : []),
    ];
    const buttons: HostChoice[] = proposal.replace
      ? [
          { id: kbButtonId(q.id, "replace"), title: "Yerine yaz" },
          { id: kbButtonId(q.id, "separate"), title: "Ayrı ekle" },
          { id: kbButtonId(q.id, "cancel"), title: "Vazgeç" },
        ]
      : [
          { id: kbButtonId(q.id, "save"), title: "Kaydet" },
          { id: kbButtonId(q.id, "cancel"), title: "Vazgeç" },
        ];
    await ctx.choices(lines.join("\n"), buttons);
    return "closed";
  } catch (err) {
    // Hazırlık yarıda kaldı → teklif yeniden açılır (aynı düğme yeniden denenebilir).
    await prisma.hostQuestion
      .updateMany({ where: { id: q.id, organizationId: org, kbProposalState: "preparing" }, data: { kbProposalState: "offered" } })
      .catch(() => null);
    throw err;
  }
}

class KbChangedAbort extends Error {}

async function saveProposal(ctx: {
  organizationId: string;
  q: LoadedQuestion;
  mode: "save" | "replace" | "separate";
  reply: (text: string) => Promise<void>;
  now: Date;
}): Promise<"closed"> {
  const { organizationId: org, q, reply, mode } = ctx;
  const proposal = (() => {
    const raw = decryptOrNull(q.kbProposalEnc, proposalAad(q.id, org));
    try {
      return raw ? (JSON.parse(raw) as KbProposal) : null;
    } catch {
      return null;
    }
  })();
  // Düğme önizlemeyle tutarlı olmalı: çakışma varken düz [Kaydet] yok; çakışma yokken [Yerine yaz] yok.
  if (!proposal || (mode === "save") !== !proposal.replace) {
    if (q.kbProposalState !== "saved" && q.kbProposalState !== "saving") await reply(KB_TEXTS.stale);
    return "closed";
  }
  const locked = await prisma.hostQuestion.updateMany({
    where: { id: q.id, organizationId: org, kbProposalState: "previewed" },
    data: { kbProposalState: "saving" },
  });
  // İkinci dokunuş / yeniden teslim: kayıt sürüyor ya da tamamlandı → ikinci kalem YOK, ikinci mesaj YOK.
  if (locked.count !== 1) return "closed";
  const unlock = () =>
    prisma.hostQuestion
      .updateMany({ where: { id: q.id, organizationId: org, kbProposalState: "saving" }, data: { kbProposalState: "previewed" } })
      .catch(() => null);
  const replaceId = mode === "replace" ? proposal.replace!.id : null;
  let outcome: "saved" | "plan_items" | "changed";
  try {
    const limits = await limitsForOrg(org);
    if (proposal.content.length > limits.kbCharsPerItem) outcome = "plan_items";
    else {
      outcome = await prisma.$transaction(async (tx) => {
        const active = await tx.knowledgeBaseItem.count({ where: { propertyId: proposal.propertyId, isActive: true } });
        if (active - (replaceId ? 1 : 0) >= limits.kbItemsPerProperty) return "plan_items" as const;
        const kb = await tx.knowledgeBaseItem.create({
          data: {
            propertyId: proposal.propertyId,
            category: proposal.category,
            title: proposal.title,
            content: proposal.content,
            isActive: true,
            source: "suggestion_accepted",
            reviewState: "approved",
            approvedAt: ctx.now,
            sourceRef: `hq:${q.id}`,
            clientRequestId: `hq:${q.id}`,
          },
          select: { id: true },
        });
        if (replaceId) {
          const retired = await tx.knowledgeBaseItem.updateMany({
            where: { id: replaceId, propertyId: proposal.propertyId, isActive: true, supersededById: null, updatedAt: new Date(proposal.replace!.updatedAt) },
            data: { isActive: false, supersededById: kb.id, supersededAt: ctx.now },
          });
          if (retired.count !== 1) throw new KbChangedAbort();
        }
        return "saved" as const;
      });
    }
  } catch (err) {
    if (err instanceof KbChangedAbort) outcome = "changed";
    else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") outcome = "saved"; // aynı istek kimliğiyle kalem zaten var
    else {
      await unlock();
      await reply(`${KB_TEXTS.failed} ${panelKbLink(proposal.propertyId)}`);
      return "closed";
    }
  }
  if (outcome !== "saved") {
    await prisma.hostQuestion
      .updateMany({ where: { id: q.id, organizationId: org, kbProposalState: "saving" }, data: { kbProposalState: "cancelled", kbProposalEnc: null } })
      .catch(() => null);
    await reply(`${outcome === "changed" ? KB_TEXTS.changed : KB_TEXTS.planFull} ${panelKbLink(proposal.propertyId)}`);
    return "closed";
  }
  await prisma.hostQuestion
    .updateMany({ where: { id: q.id, organizationId: org, kbProposalState: "saving" }, data: { kbProposalState: "saved", kbProposalEnc: null } })
    .catch(() => null);
  await afterKbItemsChanged({ organizationId: org, propertyIds: [proposal.propertyId] }).catch(() => null);
  await logEvent("host_channel.kb.saved", { questionId: q.id, mode }, { organizationId: org }).catch(() => null);
  await reply(`${KB_TEXTS.saved} (${proposal.propertyName} · ${proposal.title})`);
  return "closed";
}
