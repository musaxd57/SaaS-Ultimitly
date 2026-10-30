import { describe, it, expect, vi, afterEach } from "vitest";
import { hostVoiceViolation, hostVoiceGuardEnabled } from "@/lib/ai/host-voice-guard";
import { autoReplyGateVerdict } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// MESAJI EV SAHİBİ YAZIYOR (kurucu 10-30, `ai/host-voice-guard.ts`). Gönderilecek metinde ev sahibinden üçüncü kişi olarak söz, arka plan
// anlatımı ya da üçüncü taraf işletmeye gönderme kalırsa cevabın tamamı ev sahibine kalır — kanal ve QR AYNI yüklem.
// ---------------------------------------------------------------------------

describe("ev sahibinden üçüncü kişi olarak söz → host_third_person (yedi dil)", () => {
  it.each([
    "Your host lives next door.",
    "Ev sahibiniz Ayşe Hanım çok yardımseverdir.",
    "Mesajınız kaydedildi; ev sahibiniz görebilir.",
    "Ev sahibinize yazmanıza gerek yok, anahtar kutuda.",
    "You don't need to arrange anything with your host; the lockbox code is 4821.",
    "Visitors not listed on the reservation require the host's prior approval.",
    "Ihr Gastgeber wohnt nebenan.",
    "Votre hôte habite à côté.",
    "Su anfitrión vive al lado.",
    "Хозяин живёт рядом.",
    "المضيف يعيش بجوار الشقة.",
    "EV SAHİBİNİZ ŞU AN İSTANBUL'DA.",
  ])("%j", (s) => {
    expect(hostVoiceViolation(s)).toBe("host_third_person");
  });
});

describe("arka plan anlatımı → internal_system (yedi dil)", () => {
  it.each([
    "Telefon numarası paylaşılmamış.",
    "Wi-Fi şifresi henüz paylaşılmamış.",
    "Adres bilgisi belirtilmemiş.",
    "No phone number has been provided.",
    "The phone number hasn't been shared.",
    "Die Telefonnummer wurde nicht angegeben.",
    "Le numéro n'a pas été communiqué.",
    "No se ha proporcionado el número.",
    "Номер телефона не указан.",
    "لم يتم تزويد رقم الهاتف.",
  ])("%j", (s) => {
    expect(hostVoiceViolation(s)).toBe("internal_system");
  });
});

describe("üçüncü taraf işletmeye gönderme → third_party_referral", () => {
  it.each([
    "The hostel next door rents bikes. Just ask them at the front desk.",
    "Lale Taksi'yi arayabilirsiniz, durak köşede.",
    "Taksi için resepsiyonu arayın.",
    "You can call a taxi from the stand on the corner.",
    "Rufen Sie die Taxizentrale an.",
  ])("%j", (s) => {
    expect(hostVoiceViolation(s)).toBe("third_party_referral");
  });
});

describe("ev sahibinin kendi sesi ve mülk olgusu → ihlal yok", () => {
  it.each([
    "Ev sahibiniz olarak size iyi tatiller dilerim.",
    "As your host, I'm happy to help. The Wi-Fi password is Lale1234.",
    "Towels are not provided, please bring your own.",
    "Aksi belirtilmemişse giriş 15:00'tedir.",
    "Kahvaltı fiyata dahil değil.",
    "Acil durumda 112'yi arayın.",
    "Kodu tekrar yazın ve # tuşuna basın.",
    "Wi-Fi şifresi Lale1234.",
    "Binada sauna var.",
    "The nearest pharmacy is 200 m away on Atatürk Street.",
    "Havaalanı transferini biz ayarlayabiliriz, ücreti 900 TL.",
    "Havalimanına taksiyle 45–60 dakikada ulaşabilirsiniz.",
    "",
  ])("%j", (s) => {
    expect(hostVoiceViolation(s)).toBeNull();
  });
});

afterEach(() => vi.unstubAllEnvs());

const model = (reply: string) =>
  ({
    intent: "general",
    confidence: 0.95,
    reply,
    source: "openai",
    priority: "standard",
    riskLevel: "none",
    detectedLanguage: "tr",
  }) as Parameters<typeof autoReplyGateVerdict>[0];

describe("kapı bağlantısı — kanal ve QR aynı sebeple tutar", () => {
  it.each([
    ["Ev sahibiniz yan dairede oturuyor; Wi-Fi şifresi Lale1234.", "Wi-Fi şifresi nedir?"],
    ["Telefon numarası paylaşılmamış. Wi-Fi şifresi Lale1234.", "Wi-Fi şifresi nedir?"],
    ["Lale Taksi'yi arayabilirsiniz, durak köşede.", "Taksi nasıl bulurum?"],
  ])("%j → reply_host_voice", (reply, guest) => {
    expect(autoReplyGateVerdict(model(reply), guest)?.detail).toBe("reply_host_voice");
    const qr = evaluateEscalation({ ...model(reply), usedSources: ["kb:wifi"] }, guest);
    expect(qr.escalate).toBe(true);
    expect(qr.reason).toBe("reply_host_voice");
  });

  it("temiz cevap bu kapıya takılmaz; acil durdurmada eski davranış", () => {
    expect(autoReplyGateVerdict(model("Wi-Fi şifresi Lale1234."), "Wi-Fi şifresi nedir?")?.detail).not.toBe("reply_host_voice");
    vi.stubEnv("AI_HOST_VOICE_GUARD_DISABLED", "1");
    expect(hostVoiceGuardEnabled()).toBe(false);
    expect(autoReplyGateVerdict(model("Ev sahibiniz yan dairede oturuyor; Wi-Fi şifresi Lale1234."), "Wi-Fi şifresi nedir?")?.detail).not.toBe(
      "reply_host_voice",
    );
  });
});

describe("uzun girdide doğrusal süre (ReDoS kuralı)", () => {
  const ms = (fn: () => unknown) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };
  it.each([
    ["50.000 harflik tek sözcük", "a".repeat(50_000)],
    ["50.000 boşluk", "Telefon" + " ".repeat(50_000) + "numarası paylaşılmamış."],
    ["'taksi ' × 8.000", "taksi ".repeat(8_000) + "arayın."],
    ["'call ' × 8.000", "call ".repeat(8_000) + "the front desk."],
    ["'numara ' × 8.000", "numara ".repeat(8_000) + "paylaşılmamış."],
    ["'your ' × 8.000", "your ".repeat(8_000) + "host."],
  ])("%s → 1,5 sn altında", (_ad, girdi) => {
    hostVoiceViolation("ısınma: Ev sahibiniz görebilir.");
    expect(ms(() => hostVoiceViolation(girdi))).toBeLessThan(1_500);
  });
});
