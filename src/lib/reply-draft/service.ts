import "server-only";

import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecretBound, encryptSecretBound } from "@/lib/crypto-core";
import { isAutomationMessage } from "@/lib/message-author";
import { undeliveredOutboundIds } from "@/lib/operator-replies";
import { maskSecretValuesForAudit } from "@/lib/quality-audit";
import { cosineOfUnit, EMBEDDING_BATCH_MAX, EMBEDDING_INPUT_MAX_CHARS, embedTexts } from "@/lib/ai/embeddings/provider";
import { embeddingModel } from "@/lib/ai/embeddings/model";
import { encodeVector } from "@/lib/ai/embeddings/vector-store";
import { replyDraftEmbeddingEnabled, replyDraftLinkEnabled } from "./flag";
import {
  CLASSIFIER_VERSION,
  classifyOutcome,
  diffDraft,
  draftAcceptance,
  editKindsOf,
  mineRecurringAdditions,
  normalizeForDiff,
  outcomeInputOf,
  platformOutcomeCounts,
  type AdditionCandidate,
  type DraftOutcome,
  type DraftUse,
  type EditKind,
} from "./core";

// ---------------------------------------------------------------------------
// TASLAK ↔ GÖNDERİLEN METİN BAĞI — kayıt + ertelenmiş anlam ölçümü + öğrenme okuyucuları (kurucu 11-13; tasarım
// docs/TASARIM-2026-11-13-taslak-gonderim-bagi.md). GÖLGE: ekranda yok, misafire gitmez. Gönderim yolunu ASLA bozmaz — çağıran try/catch'le
// sarar, bu modül de anahtar kapalıyken hiçbir sorgu yapmaz.
// 🚨 EĞİTİM YASAĞI (`AiGeneration` ile aynı ilke): bu tablolar hiçbir dışa aktarma / ince ayar yoluna bağlanmaz; okuyan modüller kapalı listede
// (`tests/unit/reply-draft-readers.test.ts`). "Öğrenme" = ürün içi sayım + kümeleme.
// ---------------------------------------------------------------------------

/** Ertelenmiş ölçümde bir satırın en çok deneme sayısı (kalıcı arızada `failed`). */
export const EMBEDDING_MAX_ATTEMPTS = 5;
/** Bir geçişte ölçülen en çok bağ (zamanlanmış senkronun bütçesi). */
export const EMBEDDING_PASS_LIMIT = 32;

const draftAad = (organizationId: string, anchorMessageId: string) => `reply-draft:draft:${organizationId}:${anchorMessageId}`;
const diffAad = (organizationId: string, anchorMessageId: string) => `reply-draft:diff:${organizationId}:${anchorMessageId}`;
const spanAad = (organizationId: string, spanId: string) => `reply-draft:span:${organizationId}:${spanId}`;

export type RecordResult = "disabled" | "no_draft" | "recorded" | "duplicate";

/**
 * Ev sahibinin GÖNDERDİĞİ mesajı, gönderimden önceki son gerçek mesajdaki taslakla bağlar. Taslak = "hazır taslak" kuralının aynısı: son
 * gerçek mesaj (otomatik şablon ve misafire ulaşmamış giden satır sayılmaz) misafirinse ve üzerinde taslak (`aiSuggestedReply`) varsa.
 * `draftUse` istemcinin İPUCUDUR (approved / seeded); metin farkı her durumda sunucuda ölçülür. Taslak başına ve mesaj başına tek satır —
 * yarışan / yeniden denenen çağrı `duplicate` döner.
 */
export async function recordReplyDraftLink(input: {
  organizationId: string;
  conversationId: string;
  sentMessageId: string;
  /** Misafire giden metin (çeviri varsa çevrilmiş hâli — taslak misafirin dilindedir). */
  sentBody: string;
  draftUse?: DraftUse | null;
  sentAt?: Date;
}): Promise<RecordResult> {
  if (!replyDraftLinkEnabled()) return "disabled";
  const { organizationId, conversationId, sentMessageId } = input;
  const sent = await prisma.message.findFirst({
    where: { id: sentMessageId, conversationId, conversation: { property: { organizationId } } },
    select: { createdAt: true, conversation: { select: { propertyId: true } } },
  });
  if (!sent) return "no_draft";
  const recent = await prisma.message.findMany({
    where: { conversationId, id: { not: sentMessageId }, createdAt: { lte: sent.createdAt } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 40,
    select: { id: true, direction: true, authorType: true, aiSuggestedReply: true, aiIntent: true },
  });
  const undelivered = new Set(await undeliveredOutboundIds(conversationId));
  const last = recent.find((m) => !isAutomationMessage(m) && !undelivered.has(m.id));
  if (!last || last.direction !== "inbound") return "no_draft";
  const draft = last.aiSuggestedReply?.trim();
  if (!draft) return "no_draft";

  const diff = diffDraft(draft, input.sentBody);
  const outcomeInput = outcomeInputOf(diff);
  const outcome = classifyOutcome(outcomeInput, null);
  const kinds = editKindsOf(outcomeInput, outcome);
  // Parçalar sır maskesinden geçer: maske bir şey değiştirdiyse parça sır taşıyordu → saklanan metin maskeli, asla bilgi tabanı adayı değil.
  const spans = diff.addedSpans.map((sp) => {
    const masked = maskSecretValuesForAudit(sp.text);
    return { id: randomUUID(), text: masked, hasSecret: masked !== sp.text, contentTokens: sp.contentTokens };
  });
  const diffPayload = JSON.stringify({
    added: spans.map((sp) => sp.text),
    removed: diff.removedSpans.map((r) => maskSecretValuesForAudit(r)),
  });
  try {
    await prisma.$transaction(async (tx) => {
      // Taslağın önceki bağı misafire ULAŞMAMIŞ bir gönderime aitse (kuyrukta başarısız / iptal / engellenmiş — Haiku 11-13) o bağ geçersizdir:
      // silinir (parçaları Cascade ile), bu gönderim yerini alır. Ulaşmış gönderimin bağı korunur (aşağıdaki tekillik `duplicate` döner).
      const previous = await tx.replyDraftLink.findUnique({ where: { anchorMessageId: last.id }, select: { id: true, sentMessageId: true } });
      if (previous && previous.sentMessageId !== sentMessageId && undelivered.has(previous.sentMessageId)) {
        await tx.replyDraftLink.delete({ where: { id: previous.id } });
      }
      const link = await tx.replyDraftLink.create({
        data: {
          organizationId,
          conversationId,
          anchorMessageId: last.id,
          sentMessageId,
          linkKind: input.draftUse ?? "implicit",
          intent: last.aiIntent ?? null,
          draftEnc: encryptSecretBound(draft, draftAad(organizationId, last.id)),
          draftHash: createHash("sha256").update(normalizeForDiff(draft)).digest("base64url"),
          lexicalSim: diff.lexicalSim,
          tokensAdded: diff.tokensAdded,
          tokensRemoved: diff.tokensRemoved,
          valueChanged: diff.valueChanged,
          removedSentence: diff.removedSentence,
          maxAddedRun: diff.maxAddedRun,
          diffTruncated: diff.truncated,
          editKindsJson: JSON.stringify(kinds),
          diffEnc: encryptSecretBound(diffPayload, diffAad(organizationId, last.id)),
          outcome,
          classifierVersion: CLASSIFIER_VERSION,
          sentAt: input.sentAt ?? sent.createdAt,
        },
        select: { id: true },
      });
      if (spans.length > 0) {
        await tx.replyDraftSpan.createMany({
          data: spans.map((sp) => ({
            id: sp.id,
            linkId: link.id,
            organizationId,
            propertyId: sent.conversation.propertyId ?? null,
            conversationId,
            textEnc: encryptSecretBound(sp.text, spanAad(organizationId, sp.id)),
            contentTokens: sp.contentTokens,
            hasSecret: sp.hasSecret,
          })),
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    throw err;
  }
  return "recorded";
}

/**
 * Ertelenmiş anlam ölçümü (zamanlanmış senkronun sonunda, bütçeli). Taslak + gönderilen metin + eklenen parçalar TEK istekte gömülür;
 * kosinüs → `semanticSim`, sonuç saklanan sayılarla YENİDEN sınıflandırılır. Anahtar / embedding anahtarı yoksa hiçbir satıra dokunmaz
 * (beklemede kalır); sağlayıcı arızasında deneme sayacı artar, `EMBEDDING_MAX_ATTEMPTS` sonra `failed`. Metni silinmiş satır `skipped`.
 */
export async function measureReplyDraftEmbeddings(opts: { limit?: number; now?: Date } = {}): Promise<{ measured: number; skipped: number; failed: number }> {
  const res = { measured: 0, skipped: 0, failed: 0 };
  if (!replyDraftEmbeddingEnabled() || !process.env.OPENAI_API_KEY) return res;
  const now = opts.now ?? new Date();
  const rows = await prisma.replyDraftLink.findMany({
    where: { embeddingState: "pending", embeddingAttempts: { lt: EMBEDDING_MAX_ATTEMPTS } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: opts.limit ?? EMBEDDING_PASS_LIMIT,
    select: {
      id: true,
      organizationId: true,
      conversationId: true,
      anchorMessageId: true,
      sentMessageId: true,
      draftEnc: true,
      outcome: true,
      lexicalSim: true,
      valueChanged: true,
      removedSentence: true,
      maxAddedRun: true,
      diffTruncated: true,
      embeddingAttempts: true,
      spans: { select: { id: true, textEnc: true }, orderBy: { id: "asc" } },
    },
  });
  const model = embeddingModel();
  for (const r of rows) {
    const sent = r.draftEnc
      ? await prisma.message.findFirst({ where: { id: r.sentMessageId, conversationId: r.conversationId }, select: { body: true } })
      : null;
    let draft: string | null = null;
    let spanTexts: { id: string; text: string }[] = [];
    try {
      draft = r.draftEnc ? decryptSecretBound(r.draftEnc, draftAad(r.organizationId, r.anchorMessageId)) : null;
      spanTexts = r.spans.map((sp) => ({ id: sp.id, text: decryptSecretBound(sp.textEnc, spanAad(r.organizationId, sp.id)) }));
    } catch {
      draft = null;
    }
    if (!draft || !sent?.body?.trim()) {
      await prisma.replyDraftLink.update({ where: { id: r.id }, data: { embeddingState: "skipped", measuredAt: now } });
      res.skipped++;
      continue;
    }
    const clip = (t: string) => t.slice(0, EMBEDDING_INPUT_MAX_CHARS);
    const usableSpans = spanTexts.filter((sp) => sp.text.trim()).slice(0, EMBEDDING_BATCH_MAX - 2);
    const vecs = await embedTexts([clip(draft), clip(sent.body), ...usableSpans.map((sp) => clip(sp.text))], { quiet: true });
    if (!vecs) {
      const attempts = r.embeddingAttempts + 1;
      const state = attempts >= EMBEDDING_MAX_ATTEMPTS ? "failed" : "pending";
      await prisma.replyDraftLink.update({ where: { id: r.id }, data: { embeddingAttempts: attempts, embeddingState: state } });
      if (state === "failed") res.failed++;
      continue;
    }
    const semanticSim = cosineOfUnit(vecs[0], vecs[1]);
    const input = {
      identical: r.outcome === "unchanged",
      truncated: r.diffTruncated,
      lexicalSim: r.lexicalSim,
      valueChanged: r.valueChanged,
      removedSentence: r.removedSentence,
      maxAddedRun: r.maxAddedRun,
      addedSpanCount: r.spans.length,
    };
    const outcome = classifyOutcome(input, semanticSim);
    await prisma.$transaction([
      prisma.replyDraftLink.update({
        where: { id: r.id },
        data: {
          semanticSim,
          embeddingModel: model,
          embeddingState: "done",
          embeddingAttempts: r.embeddingAttempts + 1,
          measuredAt: now,
          outcome,
          editKindsJson: JSON.stringify(editKindsOf(input, outcome)),
          classifierVersion: CLASSIFIER_VERSION,
        },
      }),
      ...usableSpans.map((sp, k) =>
        prisma.replyDraftSpan.update({
          where: { id: sp.id },
          data: { vector: new Uint8Array(encodeVector(vecs[k + 2])), dims: vecs[k + 2].length, embeddingModel: model },
        }),
      ),
    ]);
    res.measured++;
  }
  return res;
}

/** Saklanan parça vektörü (Float32 küçük-sonlu); boyut / bayt uzunluğu tutmuyorsa ya da sonlu değilse `null`. */
export function decodeSpanVector(bytes: Uint8Array, dims: number): Float32Array | null {
  if (!Number.isInteger(dims) || dims <= 0 || bytes.byteLength !== dims * 4) return null;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    const v = buf.readFloatLE(i * 4);
    if (!Number.isFinite(v)) return null;
    out[i] = v;
  }
  return out;
}

function parseKinds(json: string): EditKind[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as EditKind[]) : [];
  } catch {
    return [];
  }
}

/** Konu başına kabul (son 14 gün) — yerinde devir teklifinin veri kaynağı. Ekrana bağlı DEĞİL (gölge). */
export async function loadDraftAcceptance(organizationId: string, now: Date = new Date()) {
  const rows = await prisma.replyDraftLink.findMany({
    where: { organizationId, sentAt: { gte: new Date(now.getTime() - 15 * 86_400_000), lte: now } },
    select: { intent: true, outcome: true, editKindsJson: true, sentAt: true },
  });
  return draftAcceptance(
    rows.map((r) => ({ intent: r.intent, outcome: r.outcome as DraftOutcome, kinds: parseKinds(r.editKindsJson), at: r.sentAt })),
    now,
  );
}

/** Tekrar eden ekleme adayları (düzeltmeden öğrenme) — son 30 gün, işletme içi. Ekrana bağlı DEĞİL (gölge). */
export async function loadRecurringAdditionCandidates(organizationId: string, now: Date = new Date()): Promise<AdditionCandidate[]> {
  const rows = await prisma.replyDraftSpan.findMany({
    where: { organizationId, createdAt: { gte: new Date(now.getTime() - 31 * 86_400_000), lte: now } },
    select: { id: true, propertyId: true, conversationId: true, textEnc: true, hasSecret: true, vector: true, dims: true, embeddingModel: true, createdAt: true },
    // EN YENİ 2000 parça (Haiku 11-13: eskiden-yeniye + sınır, pencerenin en yenilerini düşürüyordu); çekirdek kendisi sıralar.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 2000,
  });
  const model = embeddingModel();
  const spans = rows.flatMap((r) => {
    let text: string;
    try {
      text = decryptSecretBound(r.textEnc, spanAad(organizationId, r.id));
    } catch {
      return [];
    }
    // Başka modelin vektörü karşılaştırılamaz → yok sayılır (belirteç benzerliğine düşer).
    const vector = r.vector && r.dims && r.embeddingModel === model ? decodeSpanVector(r.vector, r.dims) : null;
    return [{ id: r.id, propertyId: r.propertyId, conversationId: r.conversationId, text, vector, hasSecret: r.hasSecret, at: r.createdAt }];
  });
  return mineRecurringAdditions(spans, now);
}

/** Platform sayımı (işletmeler arası yalnız niyet × sonuç sayısı; en az `minOrgs` işletme). Ekrana bağlı DEĞİL. */
export async function loadPlatformOutcomeCounts(since: Date, minOrgs = 5) {
  const rows = await prisma.replyDraftLink.findMany({
    where: { sentAt: { gte: since } },
    select: { organizationId: true, intent: true, outcome: true },
  });
  return platformOutcomeCounts(
    rows.map((r) => ({ organizationId: r.organizationId, intent: r.intent, outcome: r.outcome as DraftOutcome })),
    minOrgs,
  );
}
