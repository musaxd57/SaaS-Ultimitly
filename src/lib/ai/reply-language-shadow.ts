import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { recordSemanticReading } from "@/lib/semantic-reading/store";
import {
  compareReplyLanguage,
  replyLanguageShadowDetail,
  replyLanguageShadowEnabled,
  resolveReplyLanguageTarget,
  type ReplyLanguageConsumers,
  type ReplyLanguageInput,
} from "./reply-language-target";

/**
 * CEVAP DİLİ HEDEFİ — GÖLGE KAYDI (anahtar `AI_REPLY_LANGUAGE_SHADOW_ENABLED`, KAPALI → hiç sorgu yok). Bir turda üç tüketicinin bugün
 * okuduğu dil ile tek hedef değerin kıyası `SemanticReading`e (katman `reply_language`, mesaj başına tek satır) yazılır. Metin yazılmaz:
 * yalnız dil kodları + kaynak. HİÇBİR DAVRANIŞ DEĞİŞMEZ; asla fırlatmaz (cevap akışını durdurmaz).
 */
export async function recordReplyLanguageShadow(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  language: ReplyLanguageInput;
  consumers: ReplyLanguageConsumers;
}): Promise<void> {
  if (!replyLanguageShadowEnabled()) return;
  try {
    const target = resolveReplyLanguageTarget(input.language);
    await recordSemanticReading(prisma, {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      layer: "reply_language",
      outcome: "ok",
      lexicalDecision: input.consumers.prompt ?? "none",
      modelDecision: target.language ?? "none",
      agreement: compareReplyLanguage(input.consumers, target),
      detail: replyLanguageShadowDetail(input.language, input.consumers, target),
    });
  } catch (err) {
    void reportError("reply-language-shadow", err);
  }
}
