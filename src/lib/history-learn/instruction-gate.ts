import { detectKbInstructionHijack } from "@/lib/ai/fallback";
import { qrReplyHasDoorCode } from "@/lib/guest-chat";
import { namesPaymentMethod } from "@/lib/payment-method-guard";

// Mülk talimatı metin kapısı — YAPRAK (veritabanı / servis içe aktarmaz): talimat yükleyicisi (cevap yolu) ve servis (kayıt) aynı kuralı
// kullanır; servisin karşılaştırma bağımlılığı cevap yoluna taşınmaz.

export const INSTRUCTION_MAX_CHARS = 500;
/** Etkin talimat tavanı. İsteme giren TOPLAM ayrıca sınırlı (istem bağlama dilimi). */
export const INSTRUCTIONS_MAX_ACTIVE = 10;

export type InstructionRejectReason = "empty" | "too_long" | "door_code" | "hijack" | "payment";
export type InstructionCheck = { ok: true; content: string } | { ok: false; reason: InstructionRejectReason };

/**
 * Talimat metni kapısı (talimat cevap istemine girer → ev sahibi metni İSTEMDİR): kapı kodu değeri · bilgi tabanı ele geçirme kalıbı
 * · ödeme yöntemi / yeri (TEK KAYNAK `payment-method-guard`, ŞÜPHEDE REDDET) · uzunluk tavanı. Kaydederken VE isteme girerken koşar.
 */
export function checkInstruction(raw: string): InstructionCheck {
  const content = raw.replace(/\s+/gu, " ").trim();
  if (!content) return { ok: false, reason: "empty" };
  if (content.length > INSTRUCTION_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (qrReplyHasDoorCode(content, [])) return { ok: false, reason: "door_code" };
  if (detectKbInstructionHijack(content)) return { ok: false, reason: "hijack" };
  if (namesPaymentMethod(content)) return { ok: false, reason: "payment" };
  return { ok: true, content };
}

