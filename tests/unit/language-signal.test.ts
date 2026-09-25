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

  // 🚨 İnceleme 09-25 (P1): desteklenmeyen dile KESİN (yanlış) etiket, istemde modele yanlış dili DAYATIR (Farsça misafire
  // Arapça, Ukraynacaya Rusça, İtalyancaya Fransızca…). Önce 37 mesajın 23'ü kesin etiket alıyordu; şimdi hiçbiri.
  it.each([
    ["fa", "سلام، رمز وای فای چیست؟"],
    ["fa", "ببخشید، پارکینگ دارید؟"],
    ["ur", "السلام علیکم، وائی فائی کا پاس ورڈ کیا ہے؟"],
    ["ckb", "سڵاو، وشەی نهێنی وای فای چییە؟"],
    ["uk", "Привіт, який пароль від wifi?"],
    ["uk", "Доброго дня! Ми приїдемо о 14:00. Чи можна заселитися раніше?"],
    ["bg", "Здравейте, ще пристигнем около 22 часа. Има ли паркинг?"],
    ["sr", "Здраво, која је лозинка за wifi?"],
    ["kk", "Сәлеметсіз бе, wifi құпия сөзі қандай?"],
    ["it", "Buongiorno, il parcheggio è incluso? E il wifi funziona in tutto l'appartamento?"],
    ["it", "Salve, a che ora è il check-out? Il taxi è alle 10."],
    ["pt", "Oi! Estamos chegando. Qual é o código da porta do apartamento? Obrigado"],
    ["pt", "Bom dia! Tem estacionamento perto do apartamento? Estamos de carro."],
    ["nl", "Goedemiddag, wat is het wachtwoord van de wifi? We kunnen het niet vinden."],
    ["sv", "Hej! Vi är på väg. När kan vi checka in? Är det möjligt att få nyckeln tidigare?"],
    ["ro", "Bună seara, suntem în drum spre apartament. Ce cod are ușa? Mulțumim, și ne vedem în curând."],
    ["pl", "Dzień dobry! Który jest kod do drzwi? Również potrzebujemy informacji, kiedy możemy przyjść."],
    ["az", "Salam, bu gün saat neçədə giriş edə bilərik? Bir az tez gəlirik."],
    ["da", "Hej, hvad er koden til døren? Vi er der om en time."],
  ])("desteklenmeyen dil (%s) → null (dayatma yok): %s", (_lang, text) => {
    expect(confidentLanguage(text)).toBeNull();
  });

  it("KONTROL: desteklenen dillerin kendisi bu işaretlerden etkilenmez (Rusça, Arapça, Türkçe)", () => {
    expect(confidentLanguage("Здравствуйте, какой пароль от wifi?")).toBe("ru");
    expect(confidentLanguage("مرحبا، ما هي كلمة سر الواي فاي؟")).toBe("ar");
    expect(confidentLanguage("Merhaba, bugün saat kaçta giriş yapabiliriz acaba?")).toBe("tr");
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

  it("🚨 özel ad (büyük harfle başlayan) Türkçe harf kanıtı sayılmaz: Türkçe adres veren cevap Türkçe SANILMAZ (inceleme P2)", () => {
    expect(confidentLanguage("It's Bağdat Caddesi No:12, Şaşkınbakkal, Kızıltoprak Mahallesi, Kadıköy/İstanbul.")).toBeNull();
    // KONTROL: küçük harfli Türkçe sözcüklerde harf kanıtı sürer.
    expect(confidentLanguage("Tabii, çamaşır makinesi mutfakta, deterjan altındaki dolapta.")).toBe("tr");
  });

  it("çift tırnak içi alıntı (Wi-Fi adı / şifre / tabela) dil kanıtı değildir", () => {
    expect(confidentLanguage('Wi-Fi şifresi: "we are at the sea"')).toBeNull();
    expect(confidentLanguage('Network: "Işıklı Ev", password: "ağaçlıkyol".')).toBeNull();
  });

  it("🚨 karma yazı: Rusça/Arapça cevaptaki tırnaksız İngilizce şifre cevabı İngilizce YAPMAZ (mutasyon turu 09-25)", () => {
    expect(confidentLanguage("Пароль от wifi: we are at the sea")).toBeNull();
    expect(replyLanguageMismatch("ru", "Пароль от wifi: we are at the sea")).toBe(false);
    // KONTROL: yazının çoğu Arapçaysa Arapça kalır (İngilizce şifre çevirmez).
    expect(confidentLanguage("كلمة المرور للواي فاي: we are at the sea")).toBe("ar");
  });

  it("harf kanıtı yalnız listede OLMAYAN sözcükte: listedeki 'şifresi' iki kez sayılmaz (İngilizce ağırlık korunur)", () => {
    expect(confidentLanguage("The wifi şifresi please?")).toBe("en");
  });

  it("karma yazı (Kiril/Arap + Latin adres) hüküm almaz", () => {
    expect(confidentLanguage("Адрес квартиры: Bağdat Caddesi, Şaşkınbakkal, Kızıltoprak Mahallesi, Kadıköy/İstanbul.")).toBeNull();
    expect(confidentLanguage("خذ حافلة Havaş إلى Kadıköy، ثم انزل في Söğütlüçeşme وامشِ إلى Kuşdili Caddesi.")).toBeNull();
  });

  it("İspanyolca ters soru/ünlem işareti kanıttır (tek zayıf sözcükle birlikte kesinleşir)", () => {
    expect(confidentLanguage("¿Tienen secador de pelo, por favor?")).toBe("es");
    expect(confidentLanguage("Tienen secador de pelo, por favor?")).toBeNull();
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

  it("🚨 misafir açıkça bir DİL İSTEDİYSE kod dayatmaz — önceki Türkçe mesaj İngilizce isteğini EZMEZ (inceleme P3)", () => {
    expect(guestTurnLanguage("In English please 🙏", ["Merhaba, havlular nerede acaba?"])).toBeNull();
    expect(guestTurnLanguage("Could you please answer in Turkish?")).toBeNull();
    expect(guestTurnLanguage("Do you speak English?")).toBeNull();
    expect(guestTurnLanguage("Türkçe yazabilir misiniz lütfen?", ["Where is the parking?"])).toBeNull();
    expect(guestTurnLanguage("Können Sie bitte auf Deutsch antworten?")).toBeNull();
    expect(guestTurnLanguage("English please! Where is the key box?")).toBeNull();
    // KONTROL: dil adı yoksa kural aynen.
    expect(guestTurnLanguage("Could you please answer quickly?")).toBe("en");
  });

  it("🚨 dil ADININ sıradan geçişi istek DEĞİL: 'Turkish bath / SIM card / coffee', 'English breakfast' İngilizce kalır", () => {
    // Türkiye'deki misafirde çok sık: burada yönergeyi ve kapıyı düşürmek Türkçeye kaymayı serbest bırakırdı.
    for (const m of [
      "Is the Turkish bath open today? What time does it close?",
      "Where can I buy a Turkish SIM card near the flat?",
      "Is English breakfast included in the price?",
      "We would like to try Turkish coffee, is there a place nearby?",
      "My English is not very good, sorry. Where is the key?",
    ]) {
      expect(guestTurnLanguage(m), m).toBe("en");
    }
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

  it("🚨 cümle düzeyi: cevabın ağırlıklı dili doğru ama bir cümlesi emince başka dilde → uyuşmaz", () => {
    const mixed = "Ihre Sicherheit ist sehr wichtig. Bitte rufen Sie sofort den Notruf 112 an. Mesajınız kaydedildi; ev sahibiniz görebilir.";
    expect(confidentLanguage(mixed)).toBe("de");
    expect(replyLanguageMismatch("de", mixed)).toBe(true);
    // AŞIRI UYGULAMA YOK: özel ad / adres / tek nezaket sözcüğü / bağlantı cümleyi yabancı yapmaz.
    expect(replyLanguageMismatch("en", "The address is Menekşe Sokak No: 14, Alsancak. The bus stop is right outside.")).toBe(false);
    expect(replyLanguageMismatch("de", "Das WLAN-Passwort ist Lale2025. Teşekkürler!")).toBe(false);
    expect(replyLanguageMismatch("en", "You can find the route here: https://maps.example.com/bu-adres-icin-yol-tarifi-ve-bilgi. Enjoy!")).toBe(false);
    // Ondalık sayı ve saat cümle bölmez.
    expect(replyLanguageMismatch("en", "The fee is 3.5 EUR per bag and check-in is at 15:00.")).toBe(false);
  });

  it("🚨 AŞIRI UYGULAMA YOK (inceleme P2): misafirin dilindeki cevap Türkçe adres / özel ad / alıntı taşısa da uyuşur", () => {
    expect(replyLanguageMismatch("ru", "Адрес квартиры: Bağdat Caddesi, Şaşkınbakkal, Kızıltoprak Mahallesi, Kadıköy/İstanbul.")).toBe(false);
    expect(replyLanguageMismatch("ar", "العنوان: Bağdat Caddesi, Şaşkınbakkal, Kızıltoprak Mahallesi, Kadıköy/İstanbul.")).toBe(false);
    expect(replyLanguageMismatch("en", "It's Bağdat Caddesi No:12, Şaşkınbakkal, Kızıltoprak Mahallesi, Kadıköy/İstanbul.")).toBe(false);
    expect(replyLanguageMismatch("en", 'Network: "Işıklı Ev", password: "ağaçlıkyol". Enjoy your stay!')).toBe(false);
    expect(replyLanguageMismatch("tr", 'Wi-Fi şifresi: "we are at the sea"')).toBe(false);
    // Desteklenmeyen dilde misafir (hüküm yok) → kontrol yok.
    const nl = guestTurnLanguage("Hallo, we komen rond 15:00 aan. Is de sleutel in de kluis?");
    expect(nl).toBeNull();
    expect(replyLanguageMismatch(nl, "Hallo! Ja, de sleutel die je nodig hebt zit in de kluis naast de deur.")).toBe(false);
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
    // Kapsama TABANI (09-25 üçüncü tur: tr %70 · en %95 · de %88 · fr %79 · es %79 · ru/ar %100 — özel ad kuralı tr/de'den
    // birkaç puan aldı; ikinci tur tr %72 · de %92; ilk sürüm tr %67 · en %93 · de %90 · fr %78 · es %62). Taban ölçümün
    // altında bırakıldı; düşerse bir liste daraltması fark edilmeden istem talimatını ve kapıyı körleştiriyordur.
    // ⚠️ Bu setler sözcük seçerken GÖRÜLDÜ — kapsama rakamı kör ölçüm değil.
    const floor: Record<string, number> = { tr: 0.65, en: 0.9, de: 0.84, fr: 0.72, es: 0.72, ru: 0.95, ar: 0.95 };
    for (const [lang, min] of Object.entries(floor)) {
      expect(per[lang].conf / per[lang].n, `${lang} kapsama`).toBeGreaterThanOrEqual(min);
    }
  });

  it("🚨 kayıtlı model cevapları: uyuşmazlık TAM OLARAK 5.1'in 7 yanlış dilli cevabında (Luna'da 0); düzeltme sonrası koşuda yalnız kısmi kayma", () => {
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
    // Düzeltme sonrası 5.1 koşusu: yedi vaka düzeldi; Almanca acil durum cevabının sonuna Türkçe devir kalıbı yapışmıştı
    // (cümle düzeyi kural). O koşuda Almanca mesaj henüz tespit edilmiyordu → istem talimatı o satıra gitmemişti.
    expect(flagged("docs/olcum/model-reply-compare-2026-09-25-gpt-5.1-dil.json")).toEqual(["e-de-stromschlag"]);
    // İkinci tur (kapsama + Türkçe kalıp çevirisi) sonrası koşu: TR dışı 59/59, uyuşmazlık YOK.
    expect(flagged("docs/olcum/model-reply-compare-2026-09-25-gpt-5.1-dil2.json")).toEqual([]);
  });
});
