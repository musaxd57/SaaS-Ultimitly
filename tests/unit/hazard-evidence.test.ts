import { describe, it, expect } from "vitest";
import * as hazardModule from "@/lib/ai/hazard-evidence";
import {
  __hazardMentionEvalCount,
  contextLabels,
  hasSafetyReassurance,
  hazardDecisionFor,
  hazardEvidenceOf,
  hasEmergencyCallDirective,
  kbSupportsReassurance,
  maskHazardMentions,
} from "@/lib/ai/hazard-evidence";
import { isSafetyEmergencyText } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// FİZİKSEL TEHLİKE KANITI — bağlam ilkesi (kurucu kararı 10-02 akşam, Sabah Kararları 51 + 55). Kurucunun sınırları:
//  "Prizden duman çıkıyor, yanık kokuyor" açık tehlike (model geçersiz kılamaz); "Çay kaynarken buhar çıkıyor" alarm değil;
//  "Çaydanlıktan siyah duman geliyor, sapı eriyor" çaydanlık geçiyor diye normal sayılmaz; "Komşunun sigara dumanı geliyor"
//  genellikle şikâyet, nefes alamama / yoğun ve kaynağı bilinmeyen duman kararı değiştirir; "Yangın yok, gaz kokusu da yok" kesin
//  tehlike değil; "su bastı" her durumda 112 değil (taşan lavabo ≠ elektriğe ulaşan su). Olumsuzlama, geçmiş olay, alıntı ve aynı
//  mesajdaki çelişen belirtiler sınanır. Model arızasında güvenli taraf YALNIZ olası tehlike için.
// ---------------------------------------------------------------------------

const level = (m: string) => hazardEvidenceOf(m).level;

describe("kurucunun örnekleri (aynen)", () => {
  it.each([
    ["Prizden duman çıkıyor, yanık kokuyor!", "clear"],
    ["Çay kaynarken buhar çıkıyor, normal mi?", "none"],
    ["Çaydanlıktan siyah duman geliyor, sapı eriyor!", "clear"],
    ["Komşunun sigara dumanı geliyor.", "possible"],
    ["Komşunun sigara dumanı geliyor, nefes alamıyoruz.", "clear"],
    ["Her yer yoğun duman, nereden geldiğini bilmiyoruz!", "clear"],
    ["Yangın yok, gaz kokusu da yok, sadece kombi ses yapıyor.", "mentioned"],
    ["Lavabo taştı, banyoyu su bastı.", "possible"],
    ["Banyoyu su bastı, su prizlere ulaştı!", "clear"],
  ])("%j → %s", (m, want) => {
    expect(level(m)).toBe(want);
  });

  it("çaydanlık nesnesi istisna değil: yalın duman olası (model karar verir), siyah duman + erime açık", () => {
    expect(level("Çaydanlıktan duman çıkıyor, normal mi?")).toBe("possible");
    expect(level("Çaydanlıktan siyah duman geliyor, sapı eriyor!")).toBe("clear");
  });

  it("bilinen zararsız kaynak (sigara) yoğun da olsa açık DEĞİL; nefes alamama kararı değiştirir", () => {
    expect(level("Komşunun sigara dumanı geliyor, her yer duman kokuyor.")).toBe("possible");
    expect(level("Mangaldan çok duman geliyor, rahatsız oluyoruz.")).toBe("possible");
    expect(level("Komşu sigara içiyor, nefes alamıyoruz, her yer duman!")).toBe("clear");
  });
});

describe("su: taşan lavabo ≠ elektriğe ulaşan su", () => {
  it.each([
    ["Banyoyu su bastı.", "possible"],
    ["¡Se inundó el baño!", "possible"],
    ["Das Bad ist überflutet, überall Wasser!", "possible"],
    ["Затопило ванную!", "possible"],
    ["Banyoda su akıyor, lambayı nasıl açarım?", "possible"],
    ["Buzdolabından su akıyor, normal mi?", "possible"],
  ])("%j → %s (elektrik teması yok)", (m, want) => {
    expect(level(m)).toBe(want);
  });

  it.each([
    "Banyoyu su bastı, su prizlere ulaştı!",
    "Tavandan su akıyor, avizenin içine damlıyor.",
    "ACİL!! banyonun tavanından su akıyor, yerde su birikti, lambalar da yanıp sönüyor",
    "Water is dripping into the light fixture in the bathroom!",
    "The outlet is wet, water is everywhere.",
    "Wasser tropft in die Steckdose!",
  ])("%j → açık (su elektriğe ulaşıyor / elektrik arızası belirtisi)", (m) => {
    expect(level(m)).toBe("clear");
  });
});

describe("olumsuzlama · geçmiş · varsayım · alıntı · çelişen belirtiler", () => {
  it.each([
    ["Yangın yok, duman da yok.", "mentioned"],
    ["Ne yangın var ne de duman, sadece kombi ses yapıyor.", "mentioned"],
    ["There is no smoke, just steam from the kettle.", "mentioned"],
    ["Kein Rauch, nur Dampf vom Wasserkocher.", "mentioned"],
    ["Dün mutfakta küçük bir yangın çıktı ama söndürdük.", "mentioned"],
    // "Last night the smoke alarm went off but it's out now." → H3 + geçmiş indirimi yok (10-13): açık duman (gas-detector-alarm.test.ts).
    ["Yangın çıkarsa ne yapmalıyız?", "mentioned"],
    ["Gaz kokusu alırsanız ne yapmalıyım?", "mentioned"],
    ["What should we do in case of fire?", "mentioned"],
    ["Que faire en cas d'incendie ?", "mentioned"],
  ])("%j → %s", (m, want) => {
    expect(level(m)).toBe(want);
  });

  it("alıntı (çift tırnak) değerlendirilmez", () => {
    expect(level('Kapıdaki tabelada "yangın çıktı" yazıyor, ne demek?')).toBe("none");
    expect(level("Komşu «yangın var» diye bağırdı, ama bir şey göremiyoruz")).not.toBe("clear");
  });

  it("aynı mesajda çelişen belirtiler: olumsuzlanan tür düşer, kalan açık tehlike kalır", () => {
    expect(hazardEvidenceOf("Yangın yok ama prizden duman çıkıyor.")).toEqual({ level: "clear", kinds: ["smoke"] });
    expect(level("Duman yok ama yanık kokusu var.")).toBe("possible");
    expect(level("It's not just smoke, there are flames!")).toBe("clear");
  });

  it("'yalnız X değil' / 'not just X' olumsuzlama değil (X'e ek olarak)", () => {
    expect(level("Not just smoke in the kitchen, it's thick and black!")).toBe("clear");
    expect(level("Sadece duman değil, her yer duman doldu!")).toBe("clear");
  });

  it("tek 'ne' olumsuzlama değil ('Bu ne duman böyle!'); 'emin değilim' tehlikeyi olumsuzlamaz", () => {
    expect(level("Bu ne duman böyle, her yer doldu!")).toBe("clear");
    expect(level("Gaz mı kokuyor emin değilim.")).toBe("clear");
  });

  it("nezaket / belirsizlik kalıbı koşul DEĞİL (bildirim varsayıma dönmez)", () => {
    expect(level("Mutfakta yangın var isterseniz hemen gelin.")).toBe("clear");
    expect(level("Mutfakta yangın var mümkünse hemen gelin")).toBe("clear");
    expect(level("Fire in the kitchen if you can come quickly please")).toBe("clear");
    expect(level("يوجد حريق في المطبخ لو سمحت ساعدنا")).toBe("clear");
    expect(level("I'm not sure if it's smoke or steam coming from the oven")).toBe("possible");
    expect(level("Banyoyu su bastı zahmet olmazsa birini gönderir misiniz")).toBe("possible");
  });

  it("süren olay geçmiş DEĞİL ('dünden beri', 'since yesterday')", () => {
    expect(level("Dünden beri gaz kokusu var.")).toBe("clear");
    expect(level("Since yesterday there is a gas smell in the kitchen.")).toBe("clear");
    expect(level("Seit gestern riecht es nach Gas.")).toBe("clear");
  });
});

describe("ekipman / yer / ürün / argo / sigara izni — yalnız anılış", () => {
  it.each([
    ["Yangın söndürücü nerede?", "none"],
    ["Duman dedektörü var mı?", "mentioned"],
    // K6 bağlam kuralı yer sorusunu tehlike taramasından önce nötrler.
    ["Where is the fire extinguisher?", "none"],
    ["You guys are on fire, great host!", "mentioned"],
    ["Can we smoke on the balcony?", "mentioned"],
    ["None of us smoke, just so you know. Is there a supermarket nearby?", "mentioned"],
    ["We'll be smoking out on the terrace in the evenings.", "mentioned"],
    ["Mon mari fume, il sortira sur le balcon le soir.", "mentioned"],
    ["Mein Mann raucht, dürfen wir auf dem Balkon rauchen?", "mentioned"],
    ["How do I use the Fire TV stick?", "none"],
    ["The TV is a good brand.", "none"],
    ["¿Me llamas mañana?", "none"],
  ])("%j → %s", (m, want) => {
    expect(level(m)).toBe(want);
  });

  it("bileşik ekipman adı (Rauchmelder) çalmıyorsa yalnız anılış", () => {
    expect(level("Wir haben einen Rauchmelder im Flur.")).toBe("mentioned");
  });

  it("🚨 H3 (kurucu kararı 10-13 \"Evet, doğrudan ev sahibine\"): ÖTEN duman alarmı açık duman — pil uyarısı da ev sahibine (önce: olası, karar modeldeydi)", () => {
    expect(level("Duman alarmı ötüyor, pili mi bitti?")).toBe("clear");
    expect(level("Hallo, der Rauchmelder in der Küche gibt alle paar Minuten einen kurzen Piepton von sich.")).toBe("clear");
  });
});

describe("istenen ateş (şömine, mum) ≠ yangın; tutuşma ve yayılma her bağlamda açık", () => {
  it.each([
    ["The fire in the fireplace is burning nicely, thanks!", "possible"],
    ["The candle flames are beautiful.", "possible"],
    ["Şöminede alevler çok güzel.", "possible"],
  ])("%j → olası (betimleme)", (m, want) => {
    expect(level(m)).toBe(want);
  });

  it.each([
    "The curtain caught fire from the candle!",
    "Şömineden alevler yükseliyor, halıya sıçradı!",
    "Tava alev aldı!",
    "Perde yanıyor!",
    "Mutfakta yangın çıktı!",
  ])("%j → açık", (m) => {
    expect(level(m)).toBe("clear");
  });

  it("Türkçe 'yanmak' çalışan cihazda yangın değil ('Kombi yanıyor')", () => {
    expect(level("Kombi yanıyor ama su ısınmıyor.")).toBe("none");
  });
});

describe("ışık / gösterge bağlamı yangın değil", () => {
  it.each([
    "Das Licht brennt im Flur die ganze Nacht.",
    "На плите горит красная лампочка, что это значит?",
    "There's no hot water and the boiler display shows a flame with a cross through it.",
  ])("%j → yok", (m) => {
    expect(level(m)).toBe("none");
  });
  it("İKİZ: gerçek yangın aynı dillerde açık", () => {
    expect(level("Es brennt in der Küche!")).toBe("clear");
    expect(level("Пожар на кухне!")).toBe("clear");
  });
});

describe("soru cümlesi açık tehlike bildirimi değildir (gaz hariç)", () => {
  it.each([
    ["Yangın var mı? Siren sesleri geliyor.", "possible"],
    ["Is something on fire? I hear alarms.", "possible"],
  ])("%j → %s", (m, want) => {
    expect(level(m)).toBe(want);
  });
  it("Türkçe soru eki soru işareti olmadan da soru: 'Yangın var mı bilmiyorum…' olası", () => {
    expect(level("Yangın var mı bilmiyorum siren sesleri geliyor")).toBe("possible");
  });
  it("gaz kokusu sorusu da bildirimdir → açık", () => {
    expect(level("Gaz kokusu normal mi?")).toBe("clear");
    expect(level("Does it smell like gas in here or is it just me?")).toBe("clear");
  });
});

describe("elektrikli cihaz dumanı açık; pişirme dumanı modele kalır", () => {
  it.each(["There's smoke coming out of the bedroom AC unit and the smoke alarm is going off!!", "Klimadan duman çıkıyor!", "Prizden yanık kokusu geliyor."])(
    "%j → açık",
    (m) => {
      expect(level(m)).toBe("clear");
    },
  );
  it("fırından duman (yanan yemek) olası", () => {
    expect(level("Smoke is coming from the oven, I think the pizza burned.")).toBe("possible");
    expect(level("Se está quemando la comida, ¿cómo apago el horno?")).toBe("possible");
  });
});

describe("yalnız haykırış", () => {
  it("'Yangın!' / 'Fire!!' / '¡Fuego!' açık; ünlemsiz tek sözcük modele kalır", () => {
    expect(level("Yangın!")).toBe("clear");
    expect(level("Fire!!")).toBe("clear");
    expect(level("¡Fuego!")).toBe("clear");
    expect(level("Yangın")).toBe("possible");
    expect(level("Yangın Demirtaş")).toBe("possible");
  });
});

describe("yedi dil", () => {
  it.each([
    ["Thick black smoke everywhere, we can't breathe!", "clear"],
    ["Es riecht nach Gas in der Wohnung!", "clear"],
    ["Il y a le feu dans la cuisine !", "clear"],
    ["Il y a de la fumée dans la chambre !", "possible"],
    // Nefes alamama dumanı açık tehlikeye çıkarır (her dilde; İspanyolca iki biçim) — aynı duman nefessiz olası kalır.
    ["Hay humo en el pasillo y no podemos respirar", "clear"],
    ["Hay humo, nos estamos asfixiando", "clear"],
    ["Hay humo en el pasillo", "possible"],
    ["¡Hay fuego en la cocina!", "clear"],
    ["¡Huele a gas en el apartamento!", "clear"],
    ["Пахнет газом в квартире!", "clear"],
    ["يوجد حريق في المطبخ!", "clear"],
    ["هناك رائحة غاز في الشقة!", "clear"],
    ["Mutfakta gaz kokusu var!", "clear"],
    ["Elektrik çarptı, kolum uyuşuyor.", "clear"],
    ["Prizden kıvılcım çıkıyor.", "clear"],
    // Kaçak akım (10-14): önce hiçbir ağa takılmıyordu.
    ["Kahve makinesi kaçak akım yapıyor.", "clear"],
    ["Çamaşır makinesi akım kaçırıyor, dokununca çarpıyor.", "clear"],
    ["Banyoda elektrik kaçağı var.", "clear"],
    ["The kettle has an electrical leak, I felt a tingle.", "clear"],
    ["Mein Sohn hat beim Einstecken des Ladegeräts einen Stromschlag bekommen.", "clear"],
    ["There's smoke coming from the bedroom!", "possible"],
    ["Yanık kokusu var.", "possible"],
    ["Wifi şifresi ne?", "none"],
  ])("%j → %s", (m, want) => {
    expect(level(m)).toBe(want);
  });

  it("tür(ler) yalnız açık / olası düzeyde döner", () => {
    expect(hazardEvidenceOf("Mutfakta gaz kokusu var!").kinds).toEqual(["gas"]);
    expect(hazardEvidenceOf("Yangın yok, duman da yok.").kinds).toEqual([]);
    expect(hazardEvidenceOf("")).toEqual({ level: "none", kinds: [] });
    expect(hazardEvidenceOf(null)).toEqual({ level: "none", kinds: [] });
  });
});

describe("55 geri alındı (kurucu kararı 10-11): misafire koddan acil yönergesi YOK", () => {
  it("modül misafire gidecek bir güvenlik / '112'yi arayın' satırı dışa vermez", () => {
    // Dışa verilen veri (işlev olmayan her şey: metin sabitleri, tablolar) "112" taşımaz.
    const data = Object.values(hazardModule as Record<string, unknown>).filter((v) => typeof v !== "function");
    expect(JSON.stringify(data)).not.toMatch(/112/);
    expect(Object.keys(hazardModule)).not.toContain("safetyLineFor");
    expect(Object.keys(hazardModule)).not.toContain("SAFETY_LINES");
  });
});

describe("acil arama yönergesi (kurucu kararı 10-11: '112'yi arayın yazmasın')", () => {
  it.each([
    "Tehlike varsa hemen 112'yi arayın.",
    "Lütfen vakit kaybetmeden acil servisi arayın.",
    "Polisi arayabilirsiniz.",
    "Please call 112 immediately.",
    "Call the police right away.",
    "Rufen Sie sofort die Polizei.",
    "Appelez le 112.",
    "Llame a emergencias.",
    // Haiku 10-11 #5 (kaçanlar): Türkçe çağır / telefon et / çevir / aramalısınız, Rusça вызовите / наберите, Arapça بال ön eki,
    // aksanlı yazımlar.
    "Ambulansı çağırın.",
    "112'ye telefon edin.",
    "112'yi çevirin.",
    "112'yi aramalısınız.",
    "Polise haber verin.",
    "Вызовите 112.",
    "Вызовите полицию.",
    "Позвоните в полицию.",
    "Наберите 112.",
    "اتصل بالإسعاف.",
    "Contactez le 112.",
    "Llame a la policía.",
    "Wählen Sie die 112.",
    "Rufen Sie den Notarzt.",
    "Phone 911 right away.",
  ])("🚨 yönerge: %s", (t) => expect(hasEmergencyCallDirective(t)).toBe(true));
  it.each([
    "Ambulans: 112",
    "Türkiye'de acil numara 112'dir.",
    "Ev sahibinizi arayabilirsiniz.",
    "Polis karakolu 200 m ileride.",
    "Check-in 15:00.",
    "",
    // Haiku 10-11 #4 (yanlış tutuşlar): "bizi / us" nesnesi, daire / dahili numarası, yer tarifi.
    "For any emergency, please call us at +90 532 000 0000.",
    "Who should I contact in an emergency?",
    "Daire 117'de kalıyorsunuz, sorun olursa bizi arayın.",
    "Sorun olursa 155 dahili kapıcıyı arayın.",
    "Ambulans durağının yanındaki binada, bizi arayın.",
    "Polis merkezi yanındaki sokakta, bizi arayın.",
    "Contact your host for anything.",
    // Nesne "bizi / us" ise acil servis anılsa da yönerge değil; otel dahili numarası acil numara değil.
    "Call us, not the police.",
    "Polise değil, bizi arayın.",
    "Resepsiyon için dahili 110'u arayın.",
  ])("KONTROL değil: %s", (t) => expect(hasEmergencyCallDirective(t)).toBe(false));

  it("süre pini: 50.000 karakterlik dizide doğrusal", () => {
    for (const s of ["112 ".repeat(12_000), "polis ".repeat(8_000), `call ${"x ".repeat(24_000)}112`]) {
      const t = performance.now();
      hasEmergencyCallDirective(s);
      expect(performance.now() - t).toBeLessThan(1500);
    }
  });
});

describe("51: kaynaksız güvence", () => {
  it.each([
    "Bu buhar normaldir, endişelenmeyin.",
    "It's perfectly safe, don't worry.",
    "Das ist ganz normal, keine Sorge.",
    "C'est tout à fait normal, ne vous inquiétez pas.",
    "Es totalmente normal, no se preocupe.",
    "Это нормально, не волнуйтесь.",
    "هذا طبيعي، لا داعي للقلق.",
  ])("%j → güvence", (r) => {
    expect(hasSafetyReassurance(r)).toBe(true);
  });
  it("güvence içermeyen cevap", () => {
    expect(hasSafetyReassurance("Ocak 2 numaralı düğmeyle açılır.")).toBe(false);
    expect(hasSafetyReassurance("")).toBe(false);
    expect(hasSafetyReassurance(null)).toBe(false);
  });
  it("bilgi tabanı dayanağı: güvence sözü tehlike / buhar konusunun yanında olmalı", () => {
    expect(kbSupportsReassurance(["Kombi çalışırken bacadan buhar çıkması normaldir."])).toBe(true);
    expect(kbSupportsReassurance(["Otopark ücretsizdir, sorun yok."])).toBe(false);
    expect(kbSupportsReassurance([])).toBe(false);
    expect(kbSupportsReassurance(null)).toBe(false);
  });
});

describe("51: acil KARARI (bağlam ilkesi)", () => {
  const decide = (m: string, ran: boolean, modelEmergency: boolean) =>
    hazardDecisionFor({ texts: [m], understandingRan: ran, understandingEmergency: modelEmergency }, isSafetyEmergencyText);

  it("açık tehlike: model 'acil değil' dese de, model düşse de ACİL; alarm kaldırılmaz", () => {
    for (const [ran, em] of [[true, false], [true, true], [false, false]] as const) {
      const d = decide("Prizden duman çıkıyor, yanık kokuyor!", ran, em);
      expect(d.emergency).toBe(true);
      expect(d.lexicalCleared).toBe(false);
    }
  });

  it("olası tehlike: model karar verir; model koşmadıysa güvenli taraf (acil)", () => {
    expect(decide("Çaydanlıktan duman çıkıyor, normal mi?", true, false)).toMatchObject({ emergency: false, lexicalCleared: true });
    expect(decide("Çaydanlıktan duman çıkıyor, normal mi?", true, true)).toMatchObject({ emergency: true, lexicalCleared: false });
    expect(decide("Çaydanlıktan duman çıkıyor, normal mi?", false, false)).toMatchObject({ emergency: true, lexicalCleared: false });
  });

  it("anılan tehlike: model 'acil' derse acil; model düşerse acil SAYILMAZ ve alarm kalkar", () => {
    expect(decide("Yangın yok, gaz kokusu da yok, sadece kombi ses yapıyor.", true, true)).toMatchObject({ emergency: true, lexicalCleared: false });
    expect(decide("Yangın yok, gaz kokusu da yok, sadece kombi ses yapıyor.", true, false)).toMatchObject({ emergency: false, lexicalCleared: true });
    expect(decide("Yangın yok, gaz kokusu da yok, sadece kombi ses yapıyor.", false, false)).toMatchObject({ emergency: false, lexicalCleared: true });
  });

  it("🚨 Haiku 10-14: kelime ağının SESSİZ kaldığı olası tehlike + model koşmadı → `unverifiedPossible` (kapılar bunu devre bağlar)", () => {
    // "kısa devre" kelime ağında YOK (kurucu kararı 10-14: model karar verir) — model yoksa karar verecek kimse yok.
    expect(isSafetyEmergencyText("Kısa devre oldu, wifi şifresi neydi?")).toBe(false);
    expect(decide("Kısa devre oldu, wifi şifresi neydi?", false, false)).toMatchObject({ emergency: true, unverifiedPossible: true });
    // Model koştu → karar modelin (acil değil dediyse tutuş yok; acil dediyse anlama katmanının kendi devri).
    expect(decide("Kısa devre oldu, wifi şifresi neydi?", true, false)).toMatchObject({ emergency: false, unverifiedPossible: false });
    expect(decide("Kısa devre oldu, wifi şifresi neydi?", true, true)).toMatchObject({ unverifiedPossible: false });
    // Açık tehlike ayrı yoldan (model beklenmeden devir); anılış / tehlikesiz metin tutulmaz.
    expect(decide("Prizden duman çıkıyor, yanık kokuyor!", false, false).unverifiedPossible).toBe(false);
    expect(decide("Yangın çıkarsa ne yapmalıyız?", false, false).unverifiedPossible).toBe(false);
    expect(decide("Wifi şifresi ne?", false, false).unverifiedPossible).toBe(false);
  });

  it("başka acil sınıfı (sağlık) varsa fiziksel bağlam alarmı KALDIRAMAZ", () => {
    const d = decide("Duman var ve babam bayıldı!", true, false);
    expect(d.lexicalCleared).toBe(false);
  });

  it("kelime ağı acil demediyse kaldırılacak bir şey yok", () => {
    expect(decide("Wifi şifresi ne?", true, false)).toMatchObject({ emergency: false, lexicalCleared: false });
  });

  it("birden çok metin: en ağır düzey sayılır", () => {
    const d = hazardDecisionFor(
      { texts: ["Yangın yok.", "Mutfakta gaz kokusu var!"], understandingRan: true, understandingEmergency: false },
      isSafetyEmergencyText,
    );
    expect(d.evidence.level).toBe("clear");
    expect(d.emergency).toBe(true);
  });

  it("olası tehlikede kalkan etiket ŞİKÂYET olarak kalır (kurucu: komşunun sigara dumanı → şikâyet akışı); anılışta tamamen kalkar", () => {
    expect(decide("Komşunun sigara dumanı geliyor.", true, false)).toMatchObject({ lexicalCleared: true, clearedAsIssue: true });
    expect(decide("Yangın çıkarsa ne yapmalıyız?", true, false)).toMatchObject({ lexicalCleared: true, clearedAsIssue: false });
    expect(decide("Prizden duman çıkıyor, yanık kokuyor!", true, false)).toMatchObject({ lexicalCleared: false, clearedAsIssue: false });
  });

  it("contextLabels: kalkmadıysa aynen; olası tehlikede acil → şikâyet (şikâyet zaten varsa tekrar edilmez); anılışta acil düşer", () => {
    const issue = { lexicalCleared: true, clearedAsIssue: true };
    const drop = { lexicalCleared: true, clearedAsIssue: false };
    expect(contextLabels(["safety_emergency", "money_refund"], null)).toEqual(["safety_emergency", "money_refund"]);
    expect(contextLabels(["safety_emergency", "money_refund"], { lexicalCleared: false, clearedAsIssue: false })).toEqual([
      "safety_emergency",
      "money_refund",
    ]);
    expect(contextLabels(["safety_emergency", "money_refund"], issue)).toEqual(["complaint", "money_refund"]);
    expect(contextLabels(["safety_emergency", "complaint"], issue)).toEqual(["complaint"]);
    expect(contextLabels(["safety_emergency", "money_refund"], drop)).toEqual(["money_refund"]);
    expect(contextLabels(["rule_violation"], drop)).toEqual(["rule_violation"]);
  });

  it("51 a–f: bağlamı belirsiz kalıpta kararı MODEL verir (koşmadıysa etiket kalır); açık olay aynı mesajda varsa kalkmaz", () => {
    const cleared = (m: string, ran: boolean, em = false) => decide(m, ran, em).lexicalCleared;
    for (const m of [
      "Daireye bayıldık, her şey için teşekkürler!",
      "Manzaraya bayıldım",
      "Çocuklar havuza bayıldı!",
      "İnternet düştü, modemi yeniden başlatayım mı?",
      "Fiyatlar düştü mü?",
      "Suyun basıncı düştü",
      "Помогите, пожалуйста, как подключиться к Wi-Fi?",
      "Помогите, пожалуйста, какой номер экстренной службы?",
      "No puedo entrar a la red wifi",
      "Не могу войти в сеть Wi-Fi",
      "لا أستطيع الدخول إلى شبكة الواي فاي",
      "Was ist die Notfallnummer?",
      "What's the emergency number here, just in case?",
      "Acil bir durumda hangi numarayı aramamız gerekiyor? Bilelim diye soruyorum.",
      "Hi, I need to cancel my booking due to a family emergency. How do I get a refund?",
      "Im Flur brennt das Licht nicht",
    ]) {
      expect(cleared(m, true), m).toBe(true);
      expect(cleared(m, false), `${m} (model koşmadı)`).toBe(false);
      expect(cleared(m, true, true), `${m} (model acil dedi)`).toBe(false);
    }
    for (const m of [
      "Annem bayıldı!",
      "Hepimiz bayıldık, başımız dönüyor",
      "Derya bayıldı!",
      "Annem merdivenden düştü",
      "Merdivenden düştüm",
      "Помогите!",
      "Помогите, пожалуйста! Мама упала, идёт кровь",
      "Emergency! What's the emergency number?",
      "Daireye bayıldık ama babam düştü ve kanıyor",
    ]) {
      expect(cleared(m, true), m).toBe(false);
    }
  });

  it("Arapça / Rusça acil numara / varsayım sorusu sözcük ağında acil DEĞİL (kaldırılacak etiket yok); ağa eklenirse belirsiz kalıp maskesine de eklenir", () => {
    for (const m of [
      "ما هو رقم الطوارئ هنا؟",
      "ماذا نفعل في حالة الطوارئ؟",
      "Какой номер скорой помощи?",
      "Какой номер экстренной службы?",
      "Что делать в экстренном случае?",
    ]) {
      expect(isSafetyEmergencyText(m), m).toBe(false);
      expect(decide(m, false, false).emergency, m).toBe(false);
    }
  });

  it("maske yalnız fiziksel tehlike sözcüklerini siler", () => {
    expect(isSafetyEmergencyText(maskHazardMentions("Yangın yok, gaz kokusu da yok."))).toBe(false);
    expect(isSafetyEmergencyText(maskHazardMentions("Duman var ve babam bayıldı!"))).toBe(true);
  });
});

// SÜRE (ReDoS kuralı): kalıplar sınırlı ayraçlı; 8.000 karakterlik kötü niyetli girdide doğrusal kalır.
describe("uzun girdide süre", () => {
  it("tekrar eden sözcük dizisinde cümlecik başına en çok 32 anılış değerlendirilir (tavansız iş karesel: 8.000 karakterde 145 ms ↔ 6 ms)", () => {
    // U3 (10-07): aynı bağlam penceresindeki anılış bir kez değerlendirilir → tekrar eden dizide iş tavanın da altında kalır.
    const before = __hazardMentionEvalCount();
    hazardEvidenceOf("duman ".repeat(1_000));
    const evals = __hazardMentionEvalCount() - before;
    expect(evals).toBeGreaterThan(0);
    expect(evals).toBeLessThanOrEqual(32);
  });

  it.each([
    ["duman ", 2_000],
    ["a".repeat(50) + " ", 200],
    [" ", 8_000],
    ["yangın yok ama ", 600],
    ["ne duman ne ", 800],
    ["smoke fire gas flood ", 500],
    ["şömine alevler halıya ", 400],
    ["\"yangın\" ", 900],
    // Çok cümlecik: mesaj düzeyi sinyaller BİR KEZ hesaplanır (cümlecik başına tüm mesajı taramak karesel işti — 176 ms → 13 ms).
    ["duman, ", 1_200],
    ["su bastı. ", 900],
  ])("%j × %i → < 1,5 sn", (unit, n) => {
    const text = (unit as string).repeat(n as number).slice(0, 9_000);
    const t0 = performance.now();
    hazardEvidenceOf(text);
    hasSafetyReassurance(text);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});

// ---------------------------------------------------------------------------
// U3 (Codex 10-07, 15c8663): tarama tavanı "tehlike yok" kanıtı DEĞİLDİR · olumsuzlama bağlacı aşmaz · ekipman bir yangın fiilinin
// ÖZNESİYKEN istisna değildir. Her vaka zararsız ikiziyle (kontrol) birlikte; açık eval setlerindeki 3.067 misafir metninde seviye
// değişimi 0 (`docs/INCELEME-2026-10-07-codex-u16-u44.md`).
// ---------------------------------------------------------------------------
describe("U3 — aktif tehlike zararsız metinle bastırılamaz", () => {
  const FIRE = "the kitchen is on fire and flames are spreading";
  it.each([31, 32, 200])("%i kez 'no fire' + gerçek yangın → açık", (n) => {
    expect(hazardEvidenceOf(`${"no fire ".repeat(n)}${FIRE}`).level).toBe("clear");
  });
  it("Türkçe: 40 kez 'yangın yok' + gerçek yangın → açık", () => {
    expect(hazardEvidenceOf(`${"yangın yok ".repeat(40)}mutfakta yangın çıktı alevler yükseliyor`).level).toBe("clear");
  });
  it("benzersiz anılış tavanı aşılırsa en az OLASI (asla anılış)", () => {
    const unique = Array.from({ length: 40 }, (_, i) => `no fire in room ${i}`).join(" ");
    expect(hazardEvidenceOf(unique).level).toBe("possible");
    // KONTROL: 32'nin altında benzersiz ve hepsi olumsuz → anılış (tavan aşılmadıkça davranış aynı)
    expect(hazardEvidenceOf(Array.from({ length: 20 }, (_, i) => `no fire in room ${i}`).join(" ")).level).toBe("mentioned");
  });
  it.each([
    ["The stove caught fire!", "clear"],
    ["Mutfaktaki ocak alev aldı!", "clear"],
    ["The curtains caught fire!", "clear"],
  ])("ekipman bir yangın fiilinin öznesi: %s → %s", (text, level) => {
    expect(hazardEvidenceOf(text).level).toBe(level);
  });
  it.each([
    "We have no power and smoke is coming out of the socket",
    "There is no water and fire in the kitchen",
  ])("olumsuzlama bağlacı aşmaz: %s → açık", (text) => {
    expect(hazardEvidenceOf(text).level).toBe("clear");
  });
  it.each([
    ["Where is the fire extinguisher?", "none"],
    ["The gas stove is not working", "none"],
    ["Yangın tüpü nerede?", "none"],
    ["no fire", "mentioned"],
    ["There is no smoke and no fire, all good", "mentioned"],
    ["Can we use the fireplace?", "none"],
  ])("KONTROL (değişmez): %s → %s", (text, level) => {
    expect(hazardEvidenceOf(text).level).toBe(level);
  });
});

describe("kaçak akım — kanal ağı da acil (10-14, iki ağ eşit)", () => {
  it.each([
    "Kahve makinesi kaçak akım yapıyor.",
    "Çamaşır makinesi akım kaçırıyor.",
    "The kettle has an electrical leak.",
  ])("%j → kanal safety_emergency", (m) => {
    expect(isSafetyEmergencyText(m)).toBe(true);
  });
  it.each(["Kaçak akım rölesi nerede?", "Kaçak akım şalteri attı, nasıl açarım?"])(
    "KONTROL: %j cihaz (RCD) sorusu — acil değil",
    (m) => {
      expect(isSafetyEmergencyText(m)).toBe(false);
      expect(level(m)).not.toBe("clear");
    },
  );
  // Haiku 10-14: çarpma / aşırı ısınma — önce iki ağda da boştu; RCD adı gerçek bildirimi yutuyordu.
  it.each([
    "prizden akım kaçıyor",
    "Duş başlığı çarpıyor",
    "the shower gives me a shock",
    "I get a tingle from the washing machine",
    "I got a shock from the kettle",
    "kaçak akım rölesi attı, priz ısınıyor",
    "Kaçak akım rölesi atıyor, dokununca çarpıyor.",
    "kaçak akım rölesi sürekli atıyor ve priz ısınıyor",
    "Priz ısınıyor",
    "The socket is very hot",
    "the kettle is overheating",
    "the cable is burning hot",
    "kettle'a dokununca çarpıyor",
    "Dokununca çarpıyor, ne yapalım?",
    // Haiku 10-14 son tur: iki ağda da kaçıyordu.
    "The socket is too hot to touch.",
    "The charger got really hot and smells strange.",
    "I felt a shock from the tap.",
    "Every time I touch the kettle I get a tingle.",
    "The kettle shocked me.",
    "Priz çok sıcak oluyor.",
    "Duştan akım geliyor.",
    "Musluktan elektrik geliyor.",
    "Musluk beni çarpıyor.",
    // Haiku 10-14 ikinci tur.
    "şarj aleti çok sıcak ve kokuyor",
    "çaydanlık elektrik kaçırıyo",
    "I felt a tingle when I touched the washer",
    "şalter çok sıcak",
    "kablodan elektrik geliyo",
    "kapı kolu çarpıyor elektrik gibi",
    "Duşta akım var sanki, çarpıyor",
    // Mutasyon N7 / N8: dal başına ayrı pin (diğer dal aynı cümleyi yakalıyordu).
    "I got a shock when I touched the fridge",
    "şalter ısınıyor",
    // Haiku 10-14 ikinci tur: QR açık, kanal kaçırıyordu ("smells burning" vardı, "smells like burning" yoktu).
    "the plug smells like burning and it's hot",
    "There is a smell of burning from the socket",
    // Haiku 10-14 üçüncü tur: daraltmadan sonra da yakalanmalı.
    "Kapı kolu elektrik gibi çarpıyor",
    "I got a shock when I touched it",
    "I got a shock when I turned on the light switch",
    // Elektrik artıkları (10-14): "shocked" yalnız elektrikli özne / nesneyle açık; kanalda "electrocut" da (QR'da vardı).
    "It shocked me when I touched it",
    "I got shocked touching the kettle.",
    "I got shocked by the shower",
    "I almost got electrocuted by the socket",
  ])("🚨 %j → iki ağda acil", (m) => {
    expect(isSafetyEmergencyText(m)).toBe(true);
    expect(level(m)).toBe("clear");
  });
  it.each([
    "Rüzgârdan kapı çarpıyor",
    "Bu sıcakta oda çok ısınıyor",
    "The coffee is hot",
    "It's hot outside, where is the AC remote?",
    // Haiku 10-14: hava "hot" / kapı "çarpıyor" RCD adının susturmasını bozmamalı.
    "Kaçak akım şalteri nerede, hava çok sıcak (hot) bugün",
    "Kapı çarpıyor, kaçak akım şalteri nerede?",
    "The kettle is hot, can I use it?",
    // Haiku 10-14 son tur — mecaz "shock", kapı / kapak / baş "çarpıyor", sıcak çalışan cihaz, elektrik var mı sorusu.
    "The view from the balcony gives me a shock, it is so beautiful!",
    "The price gave us a shock when we checked out.",
    "Got a shock when I saw the bill.",
    "Duştan çıkınca kapı çarpıyor, rüzgardan olsa gerek.",
    "Fırın kapağı çarpıyor, kapanmıyor.",
    "Lamba başıma çarpıyor, tavan çok alçak.",
    "The heater is really hot in the bedroom, can we lower it?",
    "The kettle is really hot, can I use it straight away?",
    "Prizden elektrik geliyor mu?",
    "Kapı kolu duvara çarpıyor",
    "Kablodan internet geliyor mu?",
    "Şarj aleti var mı?",
    // Haiku 10-14 üçüncü tur — "when I …" nesnesi elektrikli değil, yemek / tütsü kokusu, normal ısınan şarj aleti, tamir talebi.
    "I got a shock when I turned on the lights, so beautiful",
    "tingle when I used the massage chair, very relaxing",
    "I got a tingle when I touched the fresh mint, it smells great",
    "smells like burning incense in the living room, so cozy",
    "smell of burning wood from the fireplace is lovely",
    "Telefonun şarj aleti hafif ısınıyor, bu normal mi acaba?",
    "şarj aleti sıcak mı olur normalde?",
    "kapı kolu çarpıyor diye biraz tamir etmemiz gerekebilir, sorun değil",
    // "Acil değil" susturması: çıplak "ısınıyor" / "really hot" olay işareti DEĞİL (10-14 ara sürümünde bu iki cümle acildi).
    "Acil değil ama oda ısınıyor, klimayı açar mısınız?",
    "This is not an emergency, but the room is really hot.",
  ])(
    "KONTROL %j → acil değil (elektrikli özne yok)",
    (m) => {
      expect(isSafetyEmergencyText(m)).toBe(false);
      expect(level(m)).not.toBe("clear");
    },
  );
  it("süre: 50.000 karakterde çarpma / ısınma kalıpları doğrusal", () => {
    const t0 = performance.now();
    isSafetyEmergencyText("priz ".repeat(10_000));
    isSafetyEmergencyText(`dus ${"a ".repeat(25_000)}`);
    level("socket ".repeat(7_000));
    isSafetyEmergencyText("touch the kettle ".repeat(3_000));
    level("musluk beni ".repeat(5_000));
    isSafetyEmergencyText(`got ${"a ".repeat(25_000)}`);
    isSafetyEmergencyText("smells like burning ".repeat(2_500));
    isSafetyEmergencyText(`shock when i touched ${"the ".repeat(12_000)}`);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
  it("mecaz 'shocked' QR'da açık DEĞİL (kanal da acil saymaz); bağlamsız 'It shocked me!' olası = model karar verir", () => {
    for (const m of ["The bill shocked me.", "I got shocked when I saw the bill"]) {
      expect(isSafetyEmergencyText(m)).toBe(false);
      expect(level(m)).not.toBe("clear");
    }
    expect(isSafetyEmergencyText("It shocked me!")).toBe(false);
    expect(level("It shocked me!")).toBe("possible");
  });
  it("'kaçak yapıyor' QR'da olası (kanal ağı zaten acil — iki ağ arasında açık KALMAZ)", () => {
    expect(isSafetyEmergencyText("Kahve makinesi kaçak yapıyor.")).toBe(true);
    expect(level("Kahve makinesi kaçak yapıyor.")).toBe("possible");
  });
  it("KONTROL: şalter adı + olay işareti → yine acil", () => {
    expect(isSafetyEmergencyText("Kaçak akım şalteri yanıyor, duman çıkıyor!")).toBe(true);
  });
});

describe("kurucu kararı 10-14: 'kısa devre' = model karar verir (olası), elektrik nesnesiyle açık", () => {
  it.each(["Kısa devre oldu", "Kısa devre oldu, sigorta attı, ışıklar yok", "There was a short circuit"])("%j → olası", (m) => {
    expect(level(m)).toBe("possible");
  });
  it.each(["kısa devre oldu prizde", "Kısa devre oldu, priz kararmış ve yanık kokusu var"])("🚨 %j → açık", (m) => {
    expect(level(m)).toBe("clear");
  });
  it("varsayım sorusu açık değil", () => {
    expect(level("Kısa devre olursa ne yapmalıyım?")).not.toBe("clear");
  });
});

describe("🚨 Claude kod incelemesi 10-21 (doğrulandı): virgülsüz panik cümlesi açık tehlike kalır", () => {
  // Önce: dördü de "anılış"a iniyordu (model katmanı koşmazsa acil etiketi düşüyordu); virgül konunca açıktı — anlam virgüle bağlı olamaz.
  it.each([
    // 'sondu' (söndü) öneki 'söndüremiyoruz' / 'söndürüyoruz'u geçmiş sayıyordu.
    "Mutfakta yangın var söndüremiyoruz",
    "Yangın var söndürmeye çalışıyoruz",
    // İki ayrı soru 'ne'si "ne … ne …" olumsuzlaması sanılıyordu.
    "Yangın çıktı ne yapacağız ne edeceğiz",
    // Araya başka yüklem giren 'yok / gelmiyor' tehlikenin olumsuzu sanılıyordu.
    "Yangın çıktı çıkış yok",
    "Yangın var yardım gelmiyor",
    // Olay fiili anılışın dışında kaldığından yakındaki 'çıkış / merdiven / ocak' ekipman sanılıyordu.
    "Yangın çıktı çıkışı bulamıyoruz",
    "Ocağın yanında yangın çıktı",
  ])("%j → açık", (m) => {
    expect(level(m)).toBe("clear");
  });

  it("anlam virgüle bağlı değil: virgülsüz hâl virgüllü hâlle aynı düzeyde (yalın duman olası — kurucu 10-14)", () => {
    for (const [plain, comma] of [
      ["Duman çıkıyor ne kadar tehlikeli ne yapmalıyız", "Duman çıkıyor, ne kadar tehlikeli ne yapmalıyız"],
      ["Mutfakta yangın var söndüremiyoruz", "Mutfakta yangın var, söndüremiyoruz"],
      ["Yangın çıktı çıkış yok", "Yangın çıktı, çıkış yok"],
    ]) {
      expect(level(plain), plain).toBe(level(comma));
    }
    expect(level("Duman çıkıyor ne kadar tehlikeli ne yapmalıyız")).toBe("possible");
  });

  it.each([
    // Aşırı uygulama kontrolleri: gerçek olumsuzlama / geçmiş / ekipman aynen.
    ["Ne yangın var ne duman, sadece kombi ses yapıyor.", "mentioned"],
    ["Ne gaz kokusu var ne de duman.", "mentioned"],
    ["Yangın söndü, her şey yolunda.", "mentioned"],
    ["Dün yangın çıktı ama söndürdük.", "mentioned"],
    ["Yangın falan yok, merak etmeyin.", "mentioned"],
    ["Gaz kokusu kesinlikle yok.", "mentioned"],
    ["Yangın tüpü var mı?", "none"],
    ["Yangın tüpü var", "none"],
  ])("KONTROL %j → %s", (m, want) => {
    expect(level(m)).toBe(want);
  });
});
