import "server-only";

// ---------------------------------------------------------------------------
// Gönderilen oto-yanıttan sonra doğrulanmış cevap tekrarının GÖLGE ölçümü (migration 85, `AI_ANSWER_REUSE_SHADOW_ENABLED`). Misafire giden
// metne, kapılara, bildirimlere DOKUNMAZ — yalnız `VerifiedAnswer` tablosuna yazar. Kullanılan parça = doğrulanmış, beyanda "cevaplandı",
// ve GERÇEKTEN gönderilen metinde duran parça (okuyucu / "bilgim yok" ayıklaması sonrası). Kaynak kimliği istem sırası ("kb:3") değil
// kalemin kalıcı kimliği.
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import { cosineOfUnit, embedTexts } from "@/lib/ai/embeddings/provider";
import { kbLine } from "@/lib/ai/retrieval/kb-line";
import type { ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import type { FingerprintItem } from "./core";
import { answerReuseShadowEnabled, observeVerifiedParts, type ObserveResult, type ObservedPart } from "./store";

export interface ShadowHookInput {
  organizationId: string;
  propertyId: string;
  /** Teyidin geldiği konuşma (yalnız iz özeti saklanır). */
  conversationId: string;
  /** Misafir izi bileşenleri (`core.guestKey`): bağımsız teyit misafir başına. */
  guest?: { reservationId?: string | null; externalReservationId?: string | null };
  /** Dairenin BÜTÜN onaylı + etkin kalemleri (misafirin konaklama durumuna göre süzülmemiş) — yalnız parmak izi. Yoksa `kbVisible`. */
  kbAll?: readonly { id: string; updatedAt: Date; category: string; title: string; content: string }[];
  verifiedParts: readonly { ref: string; text: string; evidence: string; source: string; alsoCited?: string[] }[] | undefined;
  answeredRefs: readonly string[] | null;
  replyItems: ReplyItemsInput | undefined;
  /** İstemdeki bilgi tabanı kalemleri, istem SIRASIYLA ("kb:N" → N-1). Çalışma anında `id` taşır. */
  kbForModel: readonly unknown[];
  /** Dairenin bugünkü görünür (onaylı + etkin) kalemleri — parmak izi + yeniden doğrulama. */
  kbVisible: readonly { id: string; updatedAt: Date; category: string; title: string; content: string }[];
  property: { checkInTime: string; checkOutTime: string; updatedAt?: Date | null };
  sentText: string;
  language: string;
  guestNames: readonly (string | null | undefined)[];
  now: Date;
  /** Testte enjekte edilir; yoksa gömme (bellek önbellekli, 2 sn tavan, sessiz). */
  similarity?: (a: string, b: string) => Promise<number | null>;
}

/** Gölge ölçümün gönderim yolunu bekletebileceği en uzun süre (ms; Opus 10-23 85 incelemesi). */
export const REUSE_SHADOW_DEADLINE_MS = 2_500;

async function embeddingSimilarity(a: string, b: string): Promise<number | null> {
  const v = await embedTexts([a, b], { deadlineMs: 2_000, quiet: true });
  return v ? cosineOfUnit(v[0], v[1]) : null;
}

/** Mülk bilgisinin parça kaynağındaki biçimi (`prompts.ts` `propertyFacts` giriş / çıkış satırları). */
export function propertySourceText(p: { checkInTime: string; checkOutTime: string }): string {
  return `Check-in saati: ${p.checkInTime}\nCheck-out saati: ${p.checkOutTime}`;
}

export async function observeAnswerReuseAfterSend(db: PrismaClient, input: ShadowHookInput): Promise<ObserveResult | null> {
  if (!answerReuseShadowEnabled() || !input.replyItems?.parts || !input.verifiedParts?.length || !input.answeredRefs) return null;
  const refs = new Set(input.answeredRefs);
  const parts: ObservedPart[] = [];
  for (const v of input.verifiedParts) {
    if (!refs.has(v.ref) || !input.sentText.includes(v.text)) continue;
    // Birden çok kaleme dayanan parça (#199) tek kalemle yeniden doğrulanamaz → kayda alınmaz (ölçüm dürüst kalır).
    if (v.alsoCited?.length) continue;
    const item = input.replyItems.answerable.find((a) => a.ref === v.ref);
    if (!item?.hint) continue;
    let sourceRef: string | null = null;
    // Mülk kaynağından yalnız giriş / çıkış saati satırına dayanan parça kaydedilir (Opus 10-23 85 incelemesi: istemin mülk kaynağında adres
    // de var, kancanın yeniden doğrulama metninde yok → adres cevabı hiç "kullanılabilir" sayılamıyordu; kayda almamak ölçümü dürüst tutar).
    if (v.source === "property") sourceRef = propertySourceText(input.property).includes(v.evidence.trim()) ? "property" : null;
    else if (/^kb:\d+$/.test(v.source)) {
      const row = input.kbForModel[Number(v.source.slice(3)) - 1] as { id?: unknown } | undefined;
      if (row && typeof row.id === "string") sourceRef = `kb:${row.id}`;
    }
    if (!sourceRef) continue;
    parts.push({ need: { kind: item.kind, query: item.hint, language: input.language }, partText: v.text, evidence: v.evidence, sourceRef });
  }
  if (parts.length === 0) return null;
  const propertySource: FingerprintItem = { id: "property", updatedAt: input.property.updatedAt ?? new Date(0), text: propertySourceText(input.property) };
  const sources: FingerprintItem[] = [...input.kbVisible.map((k) => ({ id: `kb:${k.id}`, updatedAt: k.updatedAt, text: kbLine(k) })), propertySource];
  const fingerprintSources: FingerprintItem[] | undefined = input.kbAll
    ? [...input.kbAll.map((k) => ({ id: `kb:${k.id}`, updatedAt: k.updatedAt, text: kbLine(k) })), propertySource]
    : undefined;
  return observeVerifiedParts(db, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    conversationId: input.conversationId,
    ...(input.guest ? { guest: input.guest } : {}),
    parts,
    sources,
    ...(fingerprintSources ? { fingerprintSources } : {}),
    guestNames: input.guestNames,
    now: input.now,
    similarity: input.similarity ?? embeddingSimilarity,
  });
}
