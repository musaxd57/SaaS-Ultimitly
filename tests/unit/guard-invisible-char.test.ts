import { describe, it, expect } from "vitest";
import { hostVoiceViolation } from "@/lib/ai/host-voice-guard";
import { namesPaymentMethod, namesPaymentMethodInProse } from "@/lib/payment-method-guard";

// ---------------------------------------------------------------------------
// GÖRÜNMEZ KARAKTER KEMERLERİ ATLATMAZ (G1 tur 5 T5-B3, 11-20). Kural `docs/claude/ai-guvenlik.md` "Görünmez karakter" — çıktı vetosu,
// "bilgim yok" ve tazminat kemerleri eşleşme kopyasını bu kümeden temizliyordu; ev sahibi sesi ve ödeme yöntemi kemerleri temizlemiyordu.
// Karakterler kod noktasıyla kurulur (kaynakta görünmez karakter yazılmaz).
// ---------------------------------------------------------------------------

const ZWSP = String.fromCodePoint(0x200b);
const SOFT_HYPHEN = String.fromCodePoint(0x00ad);
const WORD_JOINER = String.fromCodePoint(0x2060);
const BRAILLE_BLANK = String.fromCodePoint(0x2800);

describe("ev sahibi sesi kemeri — görünmez karakter", () => {
  it.each([ZWSP, SOFT_HYPHEN, WORD_JOINER, BRAILLE_BLANK])("sözcük içinde %j → yine üçüncü şahıs", (ch) => {
    expect(hostVoiceViolation(`Wi-Fi şifresi modemin altında. Ev sahi${ch}biniz de binada oturuyor.`)).toBe("host_third_person");
    expect(hostVoiceViolation(`Your ho${ch}st can also help.`)).toBe("host_third_person");
  });

  it("aşırı uygulama yok: görünmez karakter taşıyan kendi sesi cümlesi temiz kalır", () => {
    expect(hostVoiceViolation(`Wi-Fi şifre${ZWSP}miz modemin altında; size yardımcı oluruz.`)).toBeNull();
  });
});

describe("ödeme yöntemi kemeri — görünmez karakter", () => {
  it.each([ZWSP, SOFT_HYPHEN, WORD_JOINER])("yöntem adı içinde %j → yine ödeme yöntemi", (ch) => {
    expect(namesPaymentMethod(`Ücreti IB${ch}AN ile gönderebilirsiniz.`)).toBe(true);
    expect(namesPaymentMethod(`Kapıda ca${ch}sh ödeme yapabilirsiniz.`)).toBe(true);
    expect(namesPaymentMethodInProse(`You can pay by ca${ch}sh at check-in.`)).toBe(true);
  });

  it("aşırı uygulama yok: görünmez karakterli ödemesiz cümle temiz kalır", () => {
    expect(namesPaymentMethod(`Otopark${ZWSP} ücretsizdir.`)).toBe(false);
    expect(namesPaymentMethodInProse(`Parking is free${ZWSP} of charge.`)).toBe(false);
  });
});
