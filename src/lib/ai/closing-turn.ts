// ---------------------------------------------------------------------------
// KAPANIŞ MESAJINA SESSİZLİK (kurucu kuralı 09-25): misafir yalnız teşekkür / onay / övgü yazdıysa ("Teşekkürler",
// "Tamamdır", "👍", "Harika", "Anladım") ve cevapsız başka bir soru/istek yoksa yapay zekâ HİÇBİR ŞEY göndermez;
// konuşma içeride "cevap gerekmedi" olarak işaretlenir ("Anladım teşekkürler ama 12'de gelebilir miyiz?" → normal akış).
// Kanal oto-yanıtı ve QR sohbeti AYNI yüklemleri kullanır. İki yol, ikisi de yalnız SUSTURUR (asla metin üretmez):
//  · SÖZCÜK (hızlı yol, model çağrısı yok): cevapsız misafir mesajlarının HEPSİ `isClosingAck` / `isPositiveFeedback`
//    beyaz listesinde. TEK mesaja değil TÜMÜNE bakılır ("Bir gece daha kalabilir miyiz?" + "Teşekkürler 🙏" → modele).
//  · ANLAM (listenin kaçırdığı "Anladım", "Kolay gelsin", başka diller): anlama katmanı cevapsız mesajların TAMAMINI
//    gördü ve YALNIZ `greeting_thanks` buldu + cevap modeli de kendi istem kuralına göre "soru/talep yok" dedi (niyet
//    `general`, güven < 0.4 — istem: "sadece teşekkür/onay/kapanış → confidence 0.4'ün ALTINA") + kapı YALNIZ düşük
//    güvenden kapandı (hiçbir güvenlik kontrolü düşmedi; o denetim çağıranda). İki bağımsız modelin uyuşması şart:
//    yanlış susturmak misafirin gerçek sorusunu cevapsız bırakır.
// Saf; DB/ağ yok.
// ---------------------------------------------------------------------------

import { isClosingAck, isPositiveFeedback } from "./fallback";
import type { MessageUnderstanding } from "./semantic/understanding-schema";
import { UNDERSTANDING_WINDOW } from "./semantic/understand";

/** İstemin kapanış kuralındaki güven tavanı (`prompts.ts` BÖLÜM 11: "confidence değerini 0.4'ün ALTINA koy"). */
export const CLOSING_MAX_MODEL_CONFIDENCE = 0.4;

/**
 * Anlam yolunun kısa-mesaj tavanı: saf kapanış kısadır; uzun mesajda anlama katmanının kesme payı (maske metni
 * uzatabilir) ve gizli bir soru riski büyür → hüküm verilmez.
 */
const SEMANTIC_CLOSING_MAX_CHARS = 280;

function nonEmpty(texts: readonly string[]): string[] {
  return texts.filter((t) => t.trim() !== "");
}

/** Sözcük yolu: cevapsız misafir mesajlarının HEPSİ kapanış/teşekkür/övgü (en az bir mesaj). */
export function lexicalClosingOnly(unanswered: readonly string[]): boolean {
  const texts = nonEmpty(unanswered);
  return texts.length > 0 && texts.every((t) => isClosingAck(t) || isPositiveFeedback(t));
}

/**
 * Anlam yolu: iki bağımsız model "yalnız teşekkür/kapanış" diyor. Kapı koşulu (yalnız düşük güvenden kapandı)
 * ÇAĞIRANDA denetlenir — bu yüklem onu varsaymaz.
 */
export function semanticClosingOnly(input: {
  unanswered: readonly string[];
  understood: MessageUnderstanding | null | undefined;
  reply: { intent: string; confidence: number; source: string };
}): boolean {
  const texts = nonEmpty(input.unanswered);
  if (texts.length === 0 || texts.length > UNDERSTANDING_WINDOW.maxMessages) return false;
  if (texts.some((t) => t.length > SEMANTIC_CLOSING_MAX_CHARS)) return false;
  const u = input.understood;
  if (!u || u.requests.length === 0) return false;
  if (!u.requests.every((r) => r.intent === "greeting_thanks")) return false;
  if (u.stay.requested) return false;
  const r = input.reply;
  return (
    r.source === "openai" &&
    r.intent === "general" &&
    Number.isFinite(r.confidence) &&
    r.confidence < CLOSING_MAX_MODEL_CONFIDENCE
  );
}
