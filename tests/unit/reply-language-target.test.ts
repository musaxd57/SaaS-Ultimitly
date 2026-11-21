// Cevap dili hedefi — tek değer (gölge; kurucu 11-20 öğlen-2 konu 1). Saf çözücü + üç tüketiciyle kıyas.
import { describe, it, expect } from "vitest";
import { compareReplyLanguage, replyLanguageShadowDetail, resolveReplyLanguageTarget } from "@/lib/ai/reply-language-target";
import { confidentLanguage, guestTurnLanguage } from "@/lib/ai/language-signal";

describe("resolveReplyLanguageTarget", () => {
  it("açık tercih (anlama katmanı okuduysa) her şeyin önünde: İngilizce yazıp Türkçe cevap isteyen misafir", () => {
    const t = resolveReplyLanguageTarget({ latest: "Could you please answer in Turkish?", explicitPreference: "tr", understandingLanguage: "en" });
    expect(t).toEqual({ language: "tr", source: "explicit" });
  });

  it("🚨 dil isteği adayı var ama okuyan katman yok → yazıldığı dile KİLİTLENMEZ (bugün istem 'İngilizce' diyor)", () => {
    const msg = "Could you please answer in Turkish?";
    expect(confidentLanguage(msg)).toBe("en"); // bugünkü değer: mesajın yazıldığı dil
    expect(resolveReplyLanguageTarget({ latest: msg, understandingLanguage: "en", declaredLanguage: "en" })).toEqual({ language: null, source: "request_unread" });
    expect(resolveReplyLanguageTarget({ latest: "In English please" })).toEqual({ language: null, source: "request_unread" });
  });

  it("dil ADININ geçmesi istek değildir: 'Turkish breakfast' yazıldığı dilde cevaplanır", () => {
    expect(resolveReplyLanguageTarget({ latest: "Where can we have a good Turkish breakfast around here?" })).toEqual({ language: "en", source: "latest_code" });
  });

  it("son anlamlı mesajın dili: kod eminse kod (Arapça)", () => {
    expect(resolveReplyLanguageTarget({ latest: "مرحبا، هل يوجد موقف للسيارات بالقرب من الشقة؟" })).toEqual({ language: "ar", source: "latest_code" });
  });

  it("kod emin değilken anlama katmanının dili — yalnız misafirin metninde izi varsa", () => {
    const short = "Was kostet die Zusatzreinigung während des Aufenthalts?";
    expect(confidentLanguage(short)).toBeNull();
    expect(resolveReplyLanguageTarget({ latest: short, understandingLanguage: "de" })).toEqual({ language: "de", source: "latest_understanding" });
    // İzi olmayan dil (model uydurmasın): hüküm yok.
    expect(resolveReplyLanguageTarget({ latest: "Ok 👍", understandingLanguage: "de", declaredLanguage: "de" })).toEqual({ language: null, source: "none" });
  });

  it("'OK', emoji, kısa onay dili değiştirmez: turun önceki mesajlarıyla birlikte okunur", () => {
    const pending = ["Hello, we will arrive tomorrow evening and we would like to know where the keys are."];
    expect(resolveReplyLanguageTarget({ latest: "Ok 👍", pending })).toEqual({ language: "en", source: "turn_code" });
    expect(resolveReplyLanguageTarget({ latest: "👍" })).toEqual({ language: null, source: "none" });
  });

  it("modelin beyanı en sonda ve yalnız metinde izi varsa (bugünkü kapı kuralı)", () => {
    const short = "Was kostet die Zusatzreinigung während des Aufenthalts?";
    expect(resolveReplyLanguageTarget({ latest: short, declaredLanguage: "de" })).toEqual({ language: "de", source: "declared" });
    expect(resolveReplyLanguageTarget({ latest: short, declaredLanguage: "ru" })).toEqual({ language: null, source: "none" });
  });

  it("emin olunan son mesajda hedef, bugünkü istem değeriyle AYNIDIR (özellik: kod eminse ve dil isteği adayı yoksa fark yok)", () => {
    const samples = [
      "Merhaba, çöpleri hangi gün alıyorsunuz acaba?",
      "Hello, could you tell me where the nearest supermarket is, please?",
      "Bonjour, où est-ce que nous pouvons laisser les clés le jour du départ ?",
      "Здравствуйте, подскажите пожалуйста, где находится ближайшая аптека?",
      "Hola, ¿dónde podemos dejar las maletas después de la salida?",
    ];
    for (const latest of samples) {
      const today = guestTurnLanguage(latest, []);
      expect(today).not.toBeNull();
      expect(resolveReplyLanguageTarget({ latest }).language).toBe(today);
    }
  });
});

describe("compareReplyLanguage + kayıt biçimi", () => {
  it("üç tüketici farklı okuyorsa 'consumers_differ' (kod emin değil: istem boş, kapı modelin beyanı, kod metni boş → dolular tek dil = fark yok)", () => {
    expect(compareReplyLanguage({ prompt: "en", gate: "tr", codeText: "en" }, { language: "en", source: "latest_code" })).toBe("consumers_differ");
    expect(compareReplyLanguage({ prompt: null, gate: "de", codeText: null }, { language: "de", source: "latest_understanding" })).toBe("same");
  });
  it("öteki sınıflar: hedef farklı · hedef dolduruyor · hedef belirsiz · aynı", () => {
    expect(compareReplyLanguage({ prompt: "en", gate: "en", codeText: "en" }, { language: "tr", source: "explicit" })).toBe("target_differs");
    expect(compareReplyLanguage({ prompt: null, gate: null, codeText: null }, { language: "de", source: "latest_understanding" })).toBe("target_fills");
    expect(compareReplyLanguage({ prompt: "en", gate: "en", codeText: "en" }, { language: null, source: "request_unread" })).toBe("target_unsure");
    expect(compareReplyLanguage({ prompt: null, gate: null, codeText: null }, { language: null, source: "none" })).toBe("same");
  });
  it("kayıt yalnız kod taşır — misafir metni yok", () => {
    const input = { latest: "Could you please answer in Turkish?", pending: ["Hi"], understandingLanguage: "en", declaredLanguage: "xx" };
    const target = resolveReplyLanguageTarget(input);
    const detail = replyLanguageShadowDetail(input, { prompt: "en", gate: "en", codeText: "en" }, target);
    expect(detail).toEqual({ p: "en", g: "en", c: "en", u: "en", d: null, x: true, n: 1, t: null, s: "request_unread" });
    expect(JSON.stringify(detail)).not.toContain("Turkish");
  });
});
