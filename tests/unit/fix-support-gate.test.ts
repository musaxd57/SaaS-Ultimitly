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

// Opus gece-2 (10-16 gece, ölçüldü) — anahtar AÇIK olduğunda kurucunun kuralının çekirdek vakaları geçiyordu.
describe("Opus gece-2 M1: misafirin ARIZA bildirdiği cihaza adım TARİF ister (bilgi tabanında yalnız konu olması yetmez)", () => {
  const mk = (items: { title: string; content: string }[]) => ({ recipeTopics: kbRecipeTopics(items), subjectTopics: kbSubjectTopics(items) });
  const tvSubject = mk([{ title: "Televizyon", content: "TV kumandası sehpanın çekmecesindedir. Netflix uygulaması yüklüdür." }]);
  const wifiSubject = mk([{ title: "Wi-Fi", content: "Ağ adı: Lale-5G, şifre: Lale2025." }]);

  it.each([
    ["Kumandadaki SOURCE tuşuna basıp HDMI 1'i seçin.", "Televizyonda görüntü yok", tvSubject],
    ["Televizyonu kapatıp açabilirsiniz.", "Televizyonda görüntü yok", tvSubject],
    ["Kumandanın pillerini değiştirin; pil çekmecede.", "Kumanda çalışmıyor", tvSubject], // kurucu k6-24
    ["Modemin ışıklarını kontrol edebilir misiniz?", "İnternet çalışmıyor", wifiSubject],
    ["Telefonunuzda ağı unutup yeniden bağlanın.", "Wifi bağlanmıyor", wifiSubject],
    ["Please forget the network on your phone and reconnect.", "The wifi is not working", wifiSubject],
  ])("🚨 TUTULUR: %j (misafir: %j)", (reply, guest, kb) => {
    expect(unsupportedFixStep(reply, kb, guest)).toBe(true);
  });

  it("aşırı uygulama yok: aynı mesajdaki ARIZASIZ cihazın kullanım adımı ve başka konunun cevabı geçer", () => {
    expect(unsupportedFixStep("Ağ adı Lale-5G; ağı seçip şifreyi girin.", wifiSubject, "TV çalışmıyor; wifi şifresi ne?")).toBe(false);
    // kurucunun TV + çöp vakası: çöp cevabı arızalı TV'yi devralmaz
    const trash = mk([{ title: "Çöp", content: "Çöp konteynerleri binanın arka tarafındadır." }]);
    expect(unsupportedFixStep("Çöpleri binanın arkasındaki konteynere atabilirsiniz.", trash, "Televizyonda görüntü yok. Çöpleri nereye atıyoruz?")).toBe(false);
    // arıza yokken aynı TV kullanım adımı geçer (TV konu)
    expect(unsupportedFixStep("Netflix için kumandadaki Netflix tuşuna basın.", tvSubject, "Netflix var mı?")).toBe(false);
  });

  it("cihazı misafirden devralan adımda YALNIZ arızalı cihaz tarif ister (aynı mesajdaki Wi-Fi sorusu tarif istemez — mutasyon N6)", () => {
    const tvRecipe = { recipeTopics: new Set(["tv"]), subjectTopics: new Set(["tv", "wifi"]) };
    const step = "Fişini çekip 30 saniye bekleyin, sonra tekrar takın.";
    expect(unsupportedFixStep(step, tvRecipe, "Televizyon çalışmıyor. Wifi şifresi ne?")).toBe(false);
    // tarif yoksa tutulur
    expect(unsupportedFixStep(step, { recipeTopics: new Set(["parking"]), subjectTopics: new Set(["tv", "wifi"]) }, "Televizyon çalışmıyor. Wifi şifresi ne?")).toBe(true);
  });
});

describe("Opus gece-2 M2: 5.1'in kibar / yabancı dil adım biçimleri adım sayılır (KB'de cihaz yok)", () => {
  const kb = { recipeTopics: kbRecipeTopics(KB.slice(0, 2)), subjectTopics: kbSubjectTopics(KB.slice(0, 2)) }; // yalnız Wi-Fi + çöp
  it.each([
    ["Klimayı kapatıp açabilirsiniz.", "Klima çalışmıyor"],
    ["Klimanın fişini çekebilirsiniz.", "Klima çalışmıyor"],
    ["Klima kumandasındaki pilleri değiştirin.", "Klima çalışmıyor"],
    ["Klimayı soğutma moduna alın.", "Klima soğutmuyor"],
    ["Klimanın filtresinin temizlenmesi işe yarayabilir.", "Klima çalışmıyor"],
    ["You can switch the AC off and on again.", "AC not working"],
    ["Usually turning the AC off and on again helps.", "AC not working"],
    ["The TV may need to be switched to HDMI 1.", "TV not working"],
    ["Bitte starten Sie den Fernseher neu.", "Fernseher geht nicht"],
    ["Schalten Sie die Klimaanlage aus und wieder ein.", "Klimaanlage funktioniert nicht"],
    ["أطفئ المكيف ثم شغله مرة أخرى.", "المكيف لا يعمل"],
    ["Televizyonun kaynağını HDMI 1 yapmanız yeterli.", "Televizyon çalışmıyor"],
    ["Bulaşık makinesinin filtresini temizleyin.", "Bulaşık makinesi su boşaltmıyor"],
    ["Modemi resetlemeniz gerekebilir.", "İnternet çalışmıyor"],
  ])("🚨 TUTULUR: %j", (reply, guest) => {
    expect(unsupportedFixStep(reply, kb, guest)).toBe(true);
  });

  it.each(["Klimayı kapatıp açabilirsiniz.", "Modemin fişini çekebilirsiniz.", "Modemi sıfırlayabilirsiniz.", "Modemi yeniden başlatabilirsiniz."])(
    "misafir arıza demese de kibar yeniden başlatma biçimi arıza giderme adımıdır (tarif ister — mutasyon N24): %j",
    (reply) => {
      expect(holds(reply)).toBe(true);
    },
  );

  it("aşırı uygulama yok: üçüncü şahıs bildirim ('ev sahibiniz görebilir') ve yerel öneri ('mutlaka deneyin') adım değildir", () => {
    const keys = { recipeTopics: new Set<string>(), subjectTopics: new Set(["keys", "stove", "coffee"]) };
    expect(unsupportedFixStep("Kapı kilidiyle ilgili mesajınız kaydedildi, ev sahibiniz görebilir.", keys, "Kapının kilidi takılıyor")).toBe(false);
    const noKitchen = { recipeTopics: new Set<string>(), subjectTopics: new Set(["wifi"]) };
    expect(unsupportedFixStep("Sahildeki kafede Türk kahvesini mutlaka deneyin.", noKitchen, "Kahve için nereye gidelim?")).toBe(false);
    expect(unsupportedFixStep("Köşedeki fırının simitlerini mutlaka deneyin.", noKitchen, "Yakında ne var?")).toBe(false);
    // ama cihaz eylemiyle anılan deneme önerisi adımdır (uygulama / ayar)
    expect(unsupportedFixStep("Try the Netflix app on the TV.", noKitchen, "Is there Netflix?")).toBe(true);
  });
});

describe("Opus gece-2 M3: kullanım adımı KENDİ cihazına bakar (Wi-Fi konusu klima adımını geçirmez)", () => {
  const wifiOnly = { recipeTopics: kbRecipeTopics(KB.slice(0, 1)), subjectTopics: kbSubjectTopics(KB.slice(0, 1)) };
  it("🚨 önceki cümlede / misafir mesajında Wi-Fi geçmesi KB'de olmayan klima kullanım adımını geçirmez (rakamla biten cümle de bölünür)", () => {
    const step = "Klimayı açmak için kumandadaki MODE tuşuyla kar tanesini seçin.";
    expect(unsupportedFixStep(step, wifiOnly, "Klimayı nasıl açarım?")).toBe(true);
    expect(unsupportedFixStep(`Wi-Fi şifresi Lale2025. ${step}`, wifiOnly, "Klimayı nasıl açarım?")).toBe(true);
    expect(unsupportedFixStep(step, wifiOnly, "Wifi şifresi ne? Klimayı nasıl açarım?")).toBe(true);
  });
  it("klima konuyken 'ısıtma / soğutma MODU' ısıtma tesisatına inmez; cihazsız ikinci cümle önceki cümlenin klimasını alır", () => {
    expect(holds("Klima kumandası çekmecede. MODE tuşuyla soğutma ya da ısıtma modunu seçin.")).toBe(false);
  });
});

describe("Opus gece-2 M8: başlık yalnız YER adlandırıyorsa ('Salon', 'Teras') metnin cihazları da konudur", () => {
  it("'Salon' kalemindeki TV kullanım adımı geçer; 'Wi-Fi' kalemindeki 'TV ünitesinin altında' TV'yi konu yapmaz", () => {
    const salon = [{ title: "Salon", content: "TV kumandası sehpadadır. Netflix için kumandadaki Netflix tuşuna basın." }];
    expect(kbSubjectTopics(salon).has("tv")).toBe(true);
    expect(unsupportedFixStep("Netflix için TV kumandasındaki Netflix tuşuna basın.", { recipeTopics: kbRecipeTopics(salon), subjectTopics: kbSubjectTopics(salon) })).toBe(false);
    expect(kbSubjectTopics(KB.slice(0, 1)).has("tv")).toBe(false);
  });
});

describe("Opus gece-3 P1-a: TV mobilyası / oda adı YER tarifidir — tarifli modem adımı tutulmaz", () => {
  const wifiRecipe = [{ title: "Wi-Fi", content: "Modem salondaki TV ünitesinin alt rafındadır. Bağlantı koparsa modemi kapatıp 30 saniye sonra yeniden açabilirsiniz." }];
  const kb = { recipeTopics: kbRecipeTopics(wifiRecipe), subjectTopics: kbSubjectTopics(wifiRecipe) };
  it.each([
    ["Modem salondaki TV ünitesinin alt rafında; kapatıp 30 saniye sonra yeniden açabilirsiniz.", "İnternet çalışmıyor"],
    ["Modem salondaki TV ünitesinin alt rafındadır. Kapatıp 30 saniye sonra yeniden açabilirsiniz.", "İnternet çalışmıyor"],
    ["The router is on the lower shelf of the TV unit; you can switch it off and on again after 30 seconds.", "Internet is not working"],
    ["Bitte schalten Sie den Router unter dem TV-Regal im Wohnzimmer aus, warten Sie 30 Sekunden und schalten Sie ihn wieder ein.", "Das Internet funktioniert nicht"],
    ["Le modem est sous le meuble TV du salon ; vous pouvez l'éteindre puis le rallumer après 30 secondes.", "L'internet ne marche pas"],
  ])("GEÇER: %j", (reply, guest) => {
    expect(unsupportedFixStep(reply, kb, guest)).toBe(false);
  });
  it("aşırı düzeltme yok: TV'nin KENDİ adımı / parçası TV tarifi ister (Opus gece-3 P2-c)", () => {
    expect(unsupportedFixStep("Televizyonun fişini çekip tekrar takın.", kb, "Televizyon çalışmıyor")).toBe(true);
    expect(unsupportedFixStep("Televizyonun altındaki güç düğmesine 5 saniye basılı tutun.", kb, "Televizyon açılmıyor")).toBe(true);
    expect(unsupportedFixStep("Televizyonun alt kısmındaki POWER tuşuna basabilirsiniz.", kb, "Televizyon açılmıyor")).toBe(true);
    expect(unsupportedFixStep("TV'nin üstündeki tuşa basıp birkaç saniye bekleyin.", kb, "Televizyon açılmıyor")).toBe(true);
    expect(unsupportedFixStep("Please press the button under the TV for 5 seconds.", kb, "The TV won't turn on")).toBe(true);
  });
});

describe("Opus gece-3 P1-b: arıza + BAŞKA soru turunda meşru cevaplar tutulmaz (cihazı anılmayan cümle arızayı devralmaz)", () => {
  const kbItems = [
    { title: "Wi-Fi", content: "Ağ adı Lale-5G, şifre Lale2025!. Yatak odasında Lale-2G ağına aynı şifreyle bağlanabilirsiniz." },
    { title: "Çöp", content: "Çöp konteynerleri binanın arkasındadır." },
    { title: "Giriş", content: "Giriş 15:00'ten sonradır. Anahtar kutusunun şifresi 4821." },
  ];
  const kb = { recipeTopics: kbRecipeTopics(kbItems), subjectTopics: kbSubjectTopics(kbItems) };
  it.each([
    ["Lale-5G ağına Lale2025! şifresiyle bağlanabilirsiniz.", "Televizyonda görüntü yok. Wifi şifresi?"],
    ["Şifre Lale2025! — büyük L ile yazmanız gerekiyor.", "Televizyonda görüntü yok. Wifi şifresi?"],
    ["Binanın arkasında; oraya bırakabilirsiniz.", "Televizyonda görüntü yok. Çöpleri nereye atıyoruz?"],
    ["15:00'ten sonra giriş yapabilirsiniz.", "Klima bozuk, saat kaçta giriş yapabiliriz?"],
    ["Vous pouvez les déposer dans les conteneurs derrière l'immeuble.", "La télé ne marche pas. Où jeter les poubelles ?"],
    ["Puede dejarla en el contenedor gris de la esquina.", "El aire acondicionado no funciona. ¿Dónde tiro la basura?"],
    ["Можете оставить мусор в сером контейнере на углу улицы.", "Кондиционер не работает. Куда выбрасывать мусор?"],
  ])("GEÇER: %j (misafir: %j)", (reply, guest) => {
    expect(unsupportedFixStep(reply, kb, guest)).toBe(false);
  });
  it("aşırı düzeltme yok: yalnız arıza bildiren misafire cihazsız adım (k6-24) ve çözüm önerisi yine tutulur", () => {
    const tvSubject = { recipeTopics: new Set<string>(), subjectTopics: new Set(["tv"]) };
    expect(unsupportedFixStep("Kumandanın pillerini değiştirin.", tvSubject, "Kumanda çalışmıyor")).toBe(true);
    expect(unsupportedFixStep("Kumandadaki pilleri değiştirmek çözebilir.", tvSubject, "Televizyon açılmıyor")).toBe(true);
    // cihazı misafirden devralan cümlede GENİŞ nezaket kipi adım değildir (mutasyon Q2)
    expect(unsupportedFixStep("Bu arada dinlenebilirsiniz.", tvSubject, "Televizyonda görüntü yok.")).toBe(false);
    // şifre / kurallar gibi GENEL kavram da cümlenin kendi konusudur — arızalı TV'yi devralmaz (mutasyon Q11)
    expect(unsupportedFixStep("Şifreyi büyük harfle yazmanız gerekiyor.", tvSubject, "Televizyonda görüntü yok.")).toBe(false);
    // arızanın kendisi hakkında genel takip sorusu ("ne yapmalıyız?") BAŞKA soru sayılmaz — devralma sürer
    expect(unsupportedFixStep("Kumandanın pillerini değiştirin.", tvSubject, "Kumanda çalışmıyor, ne yapmalıyız?")).toBe(true);
    // Arapça soru sözcüğü yalnız SÖZCÜK olarak ("أهلا" içindeki "هل" soru değil — Haiku 10-16)
    expect(unsupportedFixStep("Kumandanın pillerini değiştirin.", tvSubject, "Kumanda çalışmıyor. أهلا")).toBe(true);
    // arızalı cihaz önceki cümlede anıldıysa geniş biçim de adımdır ("panoya bakılabilir")
    const none = { recipeTopics: new Set(["parking"]), subjectTopics: new Set(["power"]) };
    expect(unsupportedFixStep("Sigortanın atmış olması mümkün; panoya bakılabilir.", none, "Elektrik yok")).toBe(true);
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

  it("QR kapısı misafirin MESAJINI okur: cihazı anılmayan adımın cihazı misafirden (mutasyon H9)", () => {
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "1");
    const step = { ...result, reply: "Cihazı kapatıp 30 saniye bekleyin, sonra yeniden açın." };
    // bilgi tabanında yalnız otopark tarifi var; misafirin cihazı klima → klima tarifi yok → devir (şikâyet sözcüğü yok: başka kapı tutmasın)
    expect(evaluateEscalation(step, "Klimayı nasıl açarım?", null, [], fixSupportContextOf(KB))).toEqual({ escalate: true, reason: "fix_unsupported" });
  });

  it("koddan kurulan doğrulanmış müsaitlik / uzatma metni kemerden muaf (kanal kapısı paritesi — mutasyon H9)", () => {
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "1");
    const text = "Ekranda görüntü yoksa kaynak girişinin (HDMI) doğru seçili olduğundan emin olur musunuz.";
    for (const key of ["verifiedAvailability", "verifiedExtension"] as const) {
      const v = evaluateEscalation({ ...result, reply: text }, "Televizyonu nasıl açıyoruz?", null, [], { ...fixSupportContextOf(KB), [key]: { text } });
      expect(v.reason, key).not.toBe("fix_unsupported");
    }
  });
});

describe("kemerin bağlamı ve tavanı (mutasyon H5 / H6)", () => {
  const acSubject = { recipeTopics: new Set<string>(), subjectTopics: new Set(["ac"]) };
  it("cihazı anılmayan KULLANIM adımı önceki cümlenin ya da misafirin cihazını alır", () => {
    expect(unsupportedFixStep("Klima kumandası çekmecede. MODE tuşuna basın.", acSubject)).toBe(false);
    expect(unsupportedFixStep("MODE tuşuna basın.", acSubject, "Klimayı nasıl açarım?")).toBe(false);
    // dayanak yoksa tutulur
    expect(unsupportedFixStep("MODE tuşuna basın.", acSubject, "Televizyonu nasıl açarım?")).toBe(true);
  });

  it("taranan cümle sayısı sınırlı — çok uzun model metninde iş doğrusal ve küçük", () => {
    const withRecipe = { recipeTopics: new Set(["ac"]), subjectTopics: new Set(["ac"]) };
    const t0 = performance.now();
    expect(unsupportedFixStep("Klimayı kapatıp açın. ".repeat(20_000), withRecipe, "Klima çalışmıyor")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2_000);
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
