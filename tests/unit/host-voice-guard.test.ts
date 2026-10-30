import { describe, it, expect, vi, afterEach } from "vitest";
import { hostVoiceViolation, hostVoiceGuardEnabled } from "@/lib/ai/host-voice-guard";
import { autoReplyGateVerdict } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { SENIOR_REWRITE_REASONS } from "@/lib/ai/semantic/senior-rewrite";

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
    // İlan anlatımı + olumsuzluk (WhatsApp cevap kurucusu gerçek model denemesi 10-30).
    "Fiyat ilanda yazmıyor.",
    "The price is not mentioned in the listing.",
    "Der Preis steht nicht im Inserat.",
    // Büyük noktalı İ (/iu bayrağında "i" olmaz): yalnız Türkçe küçük harf biçiminde yakalanır (mutasyon V5-06 bu satırla öldü).
    "Kahvaltı İLANDA yer almıyor.",
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
    // Acil talimatı üçüncü taraf yönlendirmesi sayılmaz — işletme adı geçse de (↓kontrol: acil sözcüğü olmadan aynı yönlendirme ihlaldir).
    "If there is a fire, call 112 and the hotel reception next door.",
    "Kodu tekrar yazın ve # tuşuna basın.",
    "Wi-Fi şifresi Lale1234.",
    "Binada sauna var.",
    "The nearest pharmacy is 200 m away on Atatürk Street.",
    "Havaalanı transferini biz ayarlayabiliriz, ücreti 900 TL.",
    "Havalimanına taksiyle 45–60 dakikada ulaşabilirsiniz.",
    "İlanda da gördüğünüz gibi dairede havuz var.",
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
    const qr = evaluateEscalation({ ...model(reply), reply, usedSources: ["kb:wifi"] }, guest);
    expect(qr.escalate).toBe(true);
    expect(qr.reason).toBe("reply_host_voice");
  });

  it("QR bilgi bandında (güven 0,45–0,75) da tutar; anti-vakum: aynı bantta temiz cevap geçer", () => {
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "1");
    const band = (reply: string) => ({ ...model(reply), reply, confidence: 0.6, usedSources: ["kb:genel"] });
    expect(evaluateEscalation(band("Ev sahibiniz yan dairede oturuyor."), "Ev sahibi nerede?")).toEqual({
      escalate: true,
      reason: "reply_host_voice",
    });
    expect(evaluateEscalation(band("Binada sauna var."), "Sauna var mı?")).toEqual({ escalate: false, reason: "informational_low_confidence" });
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

describe("okuyucu açıkken ses ihlali bir kez yeniden yazılır (kurucu 10-22 'bir kez yeniden yaz' + 10-30 'mesajı ev sahibi yazıyor')", () => {
  it("kod yedeği tutacaksa sebep 'hostVoice'; kanal ve QR kapı ayrıntısı yeniden yazma kümesinde; not birinci çoğul kişiyi ister", async () => {
    const { seniorRewriteReasons, SENIOR_REWRITE_GATE_DETAILS, SENIOR_REWRITE_QR_REASONS, seniorRewriteNotes } = await import(
      "@/lib/ai/semantic/senior-rewrite"
    );
    const checks = { payHost: false, contact: false, apology: false, internalSource: false };
    expect(seniorRewriteReasons(checks, { contactHolds: false, apologyRule: false, hostVoiceLexical: true })).toEqual(["hostVoice"]);
    expect(seniorRewriteReasons(checks, { contactHolds: false, apologyRule: false, hostVoiceLexical: false })).toEqual([]);
    expect(SENIOR_REWRITE_GATE_DETAILS.has("reply_host_voice")).toBe(true);
    expect(SENIOR_REWRITE_QR_REASONS.has("reply_host_voice")).toBe(true);
    const [note] = seniorRewriteNotes(["hostVoice"]);
    expect(note).toContain("birinci çoğul kişiyle");
    expect(note).toContain("onayımıza");
    // Not misafir metni / değer taşımaz.
    expect(note).not.toMatch(/Lale|\d{4}/u);
  });
});

describe("karar kaydı — yeniden yazma izi", () => {
  it("her yeniden yazma nedeni (10-30 hostVoice dahil) `rw` izine geçer; bilinmeyen kod düşer", () => {
    for (const r of SENIOR_REWRITE_REASONS) {
      const ev = JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], seniorRewrite: [r] })));
      expect(ev.rw, r).toEqual([r]);
    }
    expect(buildKbEvidence({ retrieved: [], usedLabels: [], seniorRewrite: ["uydurma"] }) ?? "{}").not.toContain("uydurma");
  });
});
