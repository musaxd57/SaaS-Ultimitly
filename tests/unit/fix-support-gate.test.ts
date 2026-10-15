import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));

import {
  fixSupportContextOf,
  fixSupportHolds,
  kbRecipeTopics,
  kbSubjectTopics,
  unsupportedFixStep,
} from "@/lib/conversation-items/relation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// KANITSIZ ARIZA ADIMI (kurucu 10-15 inceleme notu, aynen: "BOZUKLAR İÇİN BİLGİ TABANINDA YAZMAYAN ÖNERİLER VEREMEZ"; anahtar
// `AI_FIX_SUPPORT_GATE_ENABLED`, VARSAYILAN KAPALI). Arıza giderme adımı o cihazın TARİFİNİ, kullanım adımı o cihazın KONUSUNU modele
// giden bilgi tabanında ister. Ölçüm (kayıtlı 3.324 cevap, modelsiz): 21 tutuş, hepsi tarifi olmayan arıza için uydurulmuş adım; gönderilmiş
// cevaplarda yanlış tutuş 0.
// ---------------------------------------------------------------------------

// Kurucunun vakasındaki bilgi tabanı biçimi: Wi-Fi kalemi TV ünitesini ANIYOR ama TV kalemi YOK; klima yalnız KULLANIM bilgisi.
const KB = [
  { title: "Wi-Fi", content: "Ağ adı: Lale-5G, şifre: Lale2025. Modem salondaki TV ünitesinin altındadır." },
  { title: "Çöp", content: "Çöp konteynerleri binanın arka tarafındadır. Geri dönüşüm için mavi konteyneri kullanın." },
  { title: "Klima", content: "Klima kumandası TV ünitesinin çekmecesindedir. MODE tuşuyla soğutma (kar tanesi) seçebilirsiniz; önerilen sıcaklık 24 derecedir." },
  { title: "Otopark", content: "Otopark kapısı siyah kumandayla açılır; kumanda çalışmazsa kapının solundaki tuş takımına 5523 yazın." },
];
const support = { recipeTopics: kbRecipeTopics(KB), subjectTopics: kbSubjectTopics(KB) };
const holds = (reply: string, kb = support) => unsupportedFixStep(reply, kb);

afterEach(() => vi.unstubAllEnvs());

describe("saf kural — kurucunun TV vakası ve ikizleri", () => {
  it.each([
    "Televizyonda görüntü gelmiyorsa kaynak girişinin (HDMI/AV/TV) doğru seçili olduğundan emin olur musunuz?",
    // "televizyon" geçmeyen biçim (belirti adları: görüntü / HDMI)
    "Ekranda görüntü yoksa kaynak girişinin (HDMI/AV) doğru seçili olduğundan emin olur musunuz.",
    "If the TV shows no picture, please check that the HDMI input is selected.",
    "Klima çalışmıyorsa kapatıp 5 dakika sonra yeniden açın.", // klima yalnız KULLANIM bilgisi — arıza adımı tarif ister
    "Modemi kapatıp 30 saniye sonra yeniden açmayı dener misiniz?", // Wi-Fi kalemi tarif değil
    "Bulaşık makinesini kapatıp fişini 1 dakika çekin, sonra tekrar başlatın.",
  ])("🚨 TUTULUR: %j", (reply) => {
    expect(holds(reply)).toBe(true);
  });

  it.each([
    "Çöpleri binanın arka tarafındaki konteynere atabilirsiniz.",
    "Ağ adı Lale-5G, şifre Lale2025.",
    // Kullanım adımı, cihaz bilgi tabanında KONU (Klima kalemi)
    "MODE tuşuyla soğutmayı (kar tanesi) seçip 24 dereceye ayarlayabilirsiniz.",
    // Kumanda nötr: otopark tarifi TV sayılmaz (ölçülen yanlış tutuş)
    "Kumanda çalışmazsa kapının solundaki tuş takımına 5523 yazın.",
    "If the remote does not work, you can enter 5523 on the keypad to the left of the gate.",
    // "check-in" denetim değildir
    "Check-in is at 15:00; the keys are in the lockbox.",
    // kapanış cümlesi
    "Başka sorunuz yoksa iyi tatiller dilerim.",
  ])("aşırı uygulama yok — GEÇER: %j", (reply) => {
    expect(holds(reply)).toBe(false);
  });

  it("bilgi tabanında o cihazın TARİFİ varsa arıza adımı geçer; priz / fiş modemin parçasıdır", () => {
    const withRecipe = [
      ...KB,
      { title: "Televizyon", content: "Görüntü gelmezse kumandadaki SOURCE tuşuna basıp HDMI 1'i seçin." },
      { title: "İnternet", content: "Bağlantı koparsa modemi kapatıp 30 saniye bekleyin ve yeniden açın." },
    ];
    const kb = { recipeTopics: kbRecipeTopics(withRecipe), subjectTopics: kbSubjectTopics(withRecipe) };
    expect(holds("Görüntü gelmiyorsa kumandadaki SOURCE tuşuyla HDMI 1'i seçebilirsiniz.", kb)).toBe(false);
    expect(holds("Modemin fişini prizden çekip 30 saniye bekleyin, sonra yeniden takın.", kb)).toBe(false);
  });

  it("cihaz adı geçmeyen arıza adımı yalnız bilgi tabanında HİÇ tarif yokken tutulur", () => {
    const step = "Fişini çekip bir dakika bekleyin, sonra yeniden takın.";
    expect(holds(step, { recipeTopics: new Set(), subjectTopics: new Set() })).toBe(true);
    expect(holds(step, support)).toBe(false); // otopark tarifi var → konusu çıkarılamayan adım geçer (temkinli yön)
  });

  it("Haiku 10-15 gece: yeniden başlatma tek başına adımdır; deneme önerisi yalnız arıza bağlamında tarif ister; adsız adımın cihazı önceki cümleden / misafirden", () => {
    const empty = { recipeTopics: new Set<string>(), subjectTopics: new Set<string>() };
    expect(holds("Modemi kapatıp açın.", empty)).toBe(true);
    const coffeeKb = [{ title: "Kahve makinesi", content: "Kapsüller makinenin yanındaki kutudadır; su haznesi arkadadır." }];
    const coffee = { recipeTopics: kbRecipeTopics(coffeeKb), subjectTopics: kbSubjectTopics(coffeeKb) };
    const tip = "Kahve makinesinde farklı bir ayarı deneyebilirsiniz.";
    expect(unsupportedFixStep(tip, coffee, "Kahve makinesinde hangi ayarlar var?")).toBe(false); // kullanım önerisi
    expect(unsupportedFixStep(tip, coffee, "Kahve makinesi çalışmıyor")).toBe(true); // arıza → tarif ister
    const acOnly = [{ title: "Klima", content: "Klima çalışmazsa kumandadaki MODE tuşuna basıp kar tanesini seçin." }];
    const ac = { recipeTopics: kbRecipeTopics(acOnly), subjectTopics: kbSubjectTopics(acOnly) };
    expect(unsupportedFixStep("Cihazı kapatıp 30 saniye bekleyin, sonra yeniden açın.", ac, "Bulaşık makinesi çalışmıyor")).toBe(true);
    expect(unsupportedFixStep("Bulaşık makinesi için şunu yapın. Fişini çekip 30 saniye bekleyin.", ac)).toBe(true);
    expect(unsupportedFixStep("Cihazı kapatıp 30 saniye bekleyin, sonra yeniden açın.", ac, "Klima çalışmıyor")).toBe(false);
  });

  it("'Görüntülü diyafon' kalemi TV konusu/tarifi vermez (Opus N2 ile tutarlı)", () => {
    const kb = [{ title: "Görüntülü diyafon", content: "Kapı çaldığında diyafonun ekranında misafiri görür, anahtar tuşuna basıp kapıyı açabilirsiniz." }];
    expect(kbSubjectTopics(kb).has("tv")).toBe(false);
    expect(kbRecipeTopics(kb).has("tv")).toBe(false);
  });
});

describe("anahtar + bağlam", () => {
  it("anahtar KAPALI: bağlam alanı HİÇ yazılmaz, kemer koşmaz (bayt bayt bugünkü)", () => {
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "");
    expect(fixSupportContextOf(KB)).toEqual({});
    expect(fixSupportHolds("Ekranda görüntü yoksa HDMI girişini kontrol edin.", { recipeTopics: [], subjectTopics: [] })).toBe(false);
  });

  it("anahtar yalnız tam '1' ile açılır; açıkken bağlam sıralı kimlik taşır (metin yok)", () => {
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "true");
    expect(fixSupportContextOf(KB)).toEqual({});
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "1");
    const ctx = fixSupportContextOf(KB).kbFixSupport!;
    expect(ctx.recipeTopics).toEqual([...ctx.recipeTopics].sort());
    expect(ctx.subjectTopics).toEqual(expect.arrayContaining(["ac", "parking", "wifi"]));
    expect(ctx.subjectTopics).not.toContain("tv");
    expect(JSON.stringify(ctx)).not.toContain("Lale2025");
    expect(fixSupportHolds("Ekranda görüntü yoksa HDMI girişini kontrol edin.", ctx)).toBe(true);
    expect(fixSupportHolds("Ekranda görüntü yoksa HDMI girişini kontrol edin.", undefined)).toBe(false);
  });
});

describe("QR kapısı paritesi (aynı yüklem)", () => {
  const result = {
    intent: "general",
    riskLevel: "none",
    confidence: 0.95,
    source: "openai",
    riskType: null,
    usedSources: ["kb:Wi-Fi"],
    reply: "Ekranda görüntü yoksa kaynak girişinin (HDMI) doğru seçili olduğundan emin olur musunuz.",
  };
  it("🚨 anahtar açık + bilgi tabanında TV yok → devir (fix_unsupported)", () => {
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "1");
    const v = evaluateEscalation(result, "Televizyonu nasıl açıyoruz?", null, [], fixSupportContextOf(KB));
    expect(v).toEqual({ escalate: true, reason: "fix_unsupported" });
  });
  it("anahtar kapalı → bu gerekçe hiç üretilmez", () => {
    const v = evaluateEscalation(result, "Televizyonu nasıl açıyoruz?", null, [], fixSupportContextOf(KB));
    expect(v.reason).not.toBe("fix_unsupported");
  });
});

describe("süre — model metni uzun olabilir (karesel iş yok)", () => {
  it("50.000 karakterlik tek sözcük / boşluk dizisi / tekrarlanan koşul doğrusal", () => {
    const t0 = performance.now();
    holds("a".repeat(50_000));
    holds(`${" ".repeat(50_000)}kontrol edin`);
    holds("if the ".repeat(7_000));
    holds("görüntü yoksa ".repeat(3_500));
    holds("kumanda ".repeat(6_000));
    holds(`${"emin olun ".repeat(4_000)}televizyon`);
    expect(performance.now() - t0).toBeLessThan(4_000);
  });
});
