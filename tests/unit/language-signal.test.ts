import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { confidentLanguage, guestTurnLanguage, languageLabel, replyLanguageMismatch, unansweredGuestTexts } from "@/lib/ai/language-signal";

// ---------------------------------------------------------------------------
// DİL SİNYALİ (09-25, kurucu: "5.1'in zayıf noktasını düzelt"). Ölçüldü: gpt-5.1 İngilizce yazan misafirlerin
// 7/59'una Türkçe cevap verdi; biri kapıdan geçip otomatik gidiyordu. Bu modül istem talimatını ve kapıyı besler.
// Sözleşme: YALNIZ EMİNKEN dil döner — yanlış kesin hüküm doğru cevabı tutar ya da modele yanlış dil dayatır.
// ---------------------------------------------------------------------------

describe("confidentLanguage — eminken dil", () => {
  it.each([
    ["Merhaba, otopark var mı?", "tr"],
    ["slm wifi sifresi nedir", "tr"],
    ["Klima çalışmıyor, yardımcı olabilir misiniz?", "tr"],
    ["What time is checkout?", "en"],
    ["Got it. And the wifi password again? Lost my note", "en"],
    ["Wie ist das WLAN-Passwort für die Wohnung?", "de"],
    ["Können wir früher einchecken?", "de"],
    ["Bonjour, où est la clé de l'appartement ?", "fr"],
    ["Hola, ¿dónde está la llave?", "es"],
    ["Здравствуйте, какой пароль от wifi?", "ru"],
    ["مرحبا، ما هي كلمة سر الواي فاي؟", "ar"],
  ])("%s → %s", (text, lang) => {
    expect(confidentLanguage(text)).toBe(lang);
  });

  it.each([
    "",
    "ok",
    "OK 👍",
    "👍",
    "Thanks!",
    "Hi Ben",
    "EV charger?",
    "Lale2025!",
    "15:00",
    "https://maps.app.goo.gl/abc123",
    // Desteklenmeyen diller KESİN hüküm almaz (Portekizce "es", İtalyanca "fr" sanılmasın).
    "Olá, qual é a senha do wifi?",
    "Ciao, qual è la password del wifi?",
    "Wat is het wachtwoord van de wifi?",
    // Gerçekten karışık metin: iki dil eşit ağırlıkta.
    "Merhaba, wifi şifresi nedir? What is the password?",
  ])("belirsiz → null: %j", (text) => {
    expect(confidentLanguage(text)).toBeNull();
  });

  it("null / undefined güvenli", () => {
    expect(confidentLanguage(null)).toBeNull();
    expect(confidentLanguage(undefined)).toBeNull();
  });

  it("özel ad dili değiştirmez: İngilizce cümlede 'Havaş' / 'Alsancak' → en", () => {
    expect(confidentLanguage("Hi Alex, the Havaş bus takes about 45 minutes to reach Alsancak.")).toBe("en");
  });

  it("kod / saat / şifre dil kanıtı değildir (rakamlı belirteç ayıklanır)", () => {
    expect(confidentLanguage("The password is Lale2025 and checkout is at 11:00.")).toBe("en");
    expect(confidentLanguage("Şifre Lale2025, çıkış 11:00.")).toBeNull();
    // İngilizce sözcük taşıyan şifre ("Is4You2Go") Türkçe cevabı karışık GÖSTERMEZ.
    expect(confidentLanguage("Wi-Fi şifresi Is4You2Go, iyi günler")).toBe("tr");
  });

  it("bağlantı dil kanıtı değildir (İngilizce sözcüklü URL Türkçe cümleyi çevirmez)", () => {
    expect(confidentLanguage("Adres linki: https://example.com/the-house-is-here-and-there")).toBeNull();
    expect(confidentLanguage("Konum bilgisi için bu bağlantıya bakabilirsiniz: https://example.com/where-is-the-flat-and-how")).toBe("tr");
  });

  it("Latin metinde Kiril ad metni Rusça yapmaz (yazı sistemi PAYLA)", () => {
    expect(confidentLanguage("Hi, my name is Иван, what is the wifi password?")).toBe("en");
  });

  it("languageLabel istemde okunur ad verir", () => {
    expect(languageLabel("en")).toBe("İngilizce (en)");
    expect(languageLabel("tr")).toBe("Türkçe (tr)");
  });
});

describe("guestTurnLanguage — son mesaj, değilse cevapsız mesajların tamamı", () => {
  it("son mesaj eminse o", () => {
    expect(guestTurnLanguage("Where is the parking?", ["Otopark var mı?"])).toBe("en");
  });

  it("son mesaj belirsizse cevapsız mesajlarla birlikte okunur", () => {
    expect(guestTurnLanguage("ok", ["Where can we park the car?"])).toBe("en");
    expect(guestTurnLanguage("👍", ["Otopark nerede acaba?"])).toBe("tr");
  });

  it("hiçbiri emin değilse null (istem eski kurala döner)", () => {
    expect(guestTurnLanguage("ok")).toBeNull();
    expect(guestTurnLanguage("ok", ["👍"])).toBeNull();
  });
});

describe("unansweredGuestTexts — son giden mesajdan sonraki misafir mesajları", () => {
  const h = (d: "inbound" | "outbound", body: string) => ({ direction: d, body });

  it("son giden mesajdan ÖNCEKİLER sayılmaz", () => {
    expect(unansweredGuestTexts([h("inbound", "Otopark var mı?"), h("outbound", "Evet."), h("inbound", "Where is it?")])).toEqual(["Where is it?"]);
    expect(unansweredGuestTexts([h("inbound", "a"), h("inbound", "b")])).toEqual(["a", "b"]);
    expect(unansweredGuestTexts([h("inbound", "a"), h("outbound", "b")])).toEqual([]);
  });

  it("geçmiş güncel mesajla bitiyorsa o satır çıkar (güncel mesaj iki kez sayılmaz — kapı paritesi)", () => {
    const hist = [h("outbound", "Hoş geldiniz."), h("inbound", "Where is the parking?"), h("inbound", "thanks")];
    expect(unansweredGuestTexts(hist, "thanks")).toEqual(["Where is the parking?"]);
    // Güncel mesaj geçmişte değilse (QR yolu) hiçbir şey çıkmaz.
    expect(unansweredGuestTexts(hist.slice(0, 2), "thanks")).toEqual(["Where is the parking?"]);
    // Çift sayım belirsiz "thanks"i kesin hükme çevirirdi: tek başına belirsiz.
    expect(guestTurnLanguage("thanks", unansweredGuestTexts([h("inbound", "thanks")], "thanks"))).toBeNull();
    expect(guestTurnLanguage("thanks", ["thanks"])).toBe("en");
  });
});

describe("replyLanguageMismatch — yalnız ikisi de eminken", () => {
  it("🚨 ölçülen vakalar: İngilizce misafire Türkçe cevap → uyuşmaz", () => {
    const en = guestTurnLanguage("Got it. And the wifi password again? Lost my note");
    expect(replyLanguageMismatch(en, "Wi-Fi ağ adı Lale-5G, şifre Lale2025. Yatak odasında sinyal zayıf olursa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.")).toBe(true);
    expect(replyLanguageMismatch(guestTurnLanguage("Is there an EV charger nearby?"), "EV şarj istasyonlarıyla ilgili net bilgiyi ev sahibiniz size verebilir.")).toBe(true);
  });

  it("KONTROL: aynı dilde cevap uyuşur", () => {
    const en = guestTurnLanguage("Got it. And the wifi password again? Lost my note");
    expect(replyLanguageMismatch(en, "The Wi-Fi network is Lale-5G and the password is Lale2025.")).toBe(false);
  });

  it("belirsiz misafir ya da belirsiz cevap → kontrol yok (yalnız sıkılaştırır)", () => {
    expect(replyLanguageMismatch(null, "Wi-Fi ağ adı Lale-5G, şifre Lale2025, iyi günler dileriz.")).toBe(false);
    expect(replyLanguageMismatch("en", "Lale2025")).toBe(false);
    expect(replyLanguageMismatch("en", "")).toBe(false);
    expect(replyLanguageMismatch("en", null)).toBe(false);
  });
});

// ── VERİYE DAYALI PİN: eval setlerindeki gerçek metinler (1.498 misafir/cevap metni + iki modelin 270 cevabı) ──
const ROOT = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

type Scenario = { id: string; lang: string; message: string; history?: { direction: string; body: string }[] };

describe("veri pini — yanlış kesin hüküm SIFIR", () => {
  const rc = readJson("evals/model-reply-compare.json") as { scenarios: Scenario[] };
  const st = readJson("evals/stay-change.json") as { requests: { lang: string; text: string }[]; replies: { lang: string; text: string }[] };
  const texts: { lang: string; text: string }[] = [];
  for (const s of rc.scenarios) {
    texts.push({ lang: s.lang, text: s.message });
    for (const h of s.history ?? []) if (h.direction === "inbound") texts.push({ lang: s.lang, text: h.body });
  }
  for (const r of st.requests) texts.push(r);
  for (const r of st.replies) texts.push(r);

  it("anti-vakum: iki set gerçekten okundu", () => {
    expect(texts.length).toBeGreaterThanOrEqual(1400);
  });

  it("🚨 kesin hüküm verilen her metinde dil DOĞRU (0 hata) + dil başına kapsama tabanı", () => {
    const per: Record<string, { n: number; conf: number }> = {};
    const wrong: string[] = [];
    for (const t of texts) {
      const p = (per[t.lang] ??= { n: 0, conf: 0 });
      p.n++;
      const l = confidentLanguage(t.text);
      if (l) {
        p.conf++;
        if (l !== t.lang) wrong.push(`${t.lang}→${l}: ${t.text}`);
      }
    }
    expect(wrong).toEqual([]);
    // Kapsama TABANI (09-25 ölçümü: tr %67 · en %93 · de %90 · fr %78 · es %62 · ru/ar %100). Taban ölçümün altında
    // bırakıldı; düşerse bir liste daraltması fark edilmeden istem talimatını ve kapıyı körleştiriyordur.
    const floor: Record<string, number> = { tr: 0.6, en: 0.88, de: 0.85, fr: 0.7, es: 0.55, ru: 0.95, ar: 0.95 };
    for (const [lang, min] of Object.entries(floor)) {
      expect(per[lang].conf / per[lang].n, `${lang} kapsama`).toBeGreaterThanOrEqual(min);
    }
  });

  it("🚨 kayıtlı model cevapları: uyuşmazlık TAM OLARAK 5.1'in 7 yanlış dilli cevabında (Luna'da 0)", () => {
    const byId = new Map(rc.scenarios.map((s) => [s.id, s]));
    const flagged = (file: string) => {
      const rows = readJson(file).rows as { id: string; reply: string }[];
      expect(rows.length).toBe(135);
      return rows
        .filter((row) => {
          const s = byId.get(row.id)!;
          const hist = s.history ?? [];
          const lastOut = hist.map((m) => m.direction).lastIndexOf("outbound");
          const pending = hist.slice(lastOut + 1).filter((m) => m.direction === "inbound").map((m) => m.body);
          return replyLanguageMismatch(guestTurnLanguage(s.message, pending), row.reply);
        })
        .map((row) => row.id)
        .sort();
    };
    expect(flagged("docs/olcum/model-reply-compare-2026-09-25-gpt-5.1.json")).toEqual([
      "i-en-dan-roleplay",
      "i-en-ignore-system-prompt",
      "m-en-ev-charger",
      "m-en-museum-distance",
      "m-en-sparse-airport",
      "mt-en-checkout-then-wifi",
      "mt-en-then-construction-noise",
    ]);
    expect(flagged("docs/olcum/model-reply-compare-2026-09-25-gpt-6-luna.json")).toEqual([]);
  });
});
