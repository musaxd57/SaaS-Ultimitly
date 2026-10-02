import { describe, it, expect } from "vitest";
import {
  SAFETY_LINES,
  hasSafetyReassurance,
  hazardDecisionFor,
  hazardEvidenceOf,
  kbSupportsReassurance,
  maskHazardMentions,
  safetyLineFor,
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
    ["Last night the smoke alarm went off but it's out now.", "mentioned"],
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

  it("çalan alarm ekipman anılışını olasıya çevirir (pil mi, gerçek mi — model karar verir)", () => {
    expect(level("Duman alarmı ötüyor, pili mi bitti?")).toBe("possible");
    expect(level("Hallo, der Rauchmelder in der Küche gibt alle paar Minuten einen kurzen Piepton von sich.")).toBe("possible");
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
    ["¡Hay fuego en la cocina!", "clear"],
    ["¡Huele a gas en el apartamento!", "clear"],
    ["Пахнет газом в квартире!", "clear"],
    ["يوجد حريق في المطبخ!", "clear"],
    ["هناك رائحة غاز في الشقة!", "clear"],
    ["Mutfakta gaz kokusu var!", "clear"],
    ["Elektrik çarptı, kolum uyuşuyor.", "clear"],
    ["Prizden kıvılcım çıkıyor.", "clear"],
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

describe("55: güvenlik satırı misafirin dilinde", () => {
  it("yedi dil + desteklenmeyen / boş → Türkçe", () => {
    expect(safetyLineFor("tr")).toBe("Tehlike varsa hemen 112'yi arayın.");
    expect(safetyLineFor("en")).toBe("If there is danger, call 112 immediately.");
    expect(safetyLineFor("de")).toBe(SAFETY_LINES.de);
    expect(safetyLineFor("fr")).toBe(SAFETY_LINES.fr);
    expect(safetyLineFor("es")).toBe(SAFETY_LINES.es);
    expect(safetyLineFor("ru")).toBe(SAFETY_LINES.ru);
    expect(safetyLineFor("ar")).toBe(SAFETY_LINES.ar);
    expect(safetyLineFor("it")).toBe(SAFETY_LINES.tr);
    expect(safetyLineFor(null)).toBe(SAFETY_LINES.tr);
    expect(safetyLineFor("__proto__")).toBe(SAFETY_LINES.tr);
  });
  it("her satır yalnız güvenlik yönergesidir: 112 geçer, söz / devir cümlesi yok", () => {
    for (const line of Object.values(SAFETY_LINES)) {
      expect(line).toContain("112");
      expect(line.length).toBeLessThan(60);
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

  it("maske yalnız fiziksel tehlike sözcüklerini siler", () => {
    expect(isSafetyEmergencyText(maskHazardMentions("Yangın yok, gaz kokusu da yok."))).toBe(false);
    expect(isSafetyEmergencyText(maskHazardMentions("Duman var ve babam bayıldı!"))).toBe(true);
  });
});

// SÜRE (ReDoS kuralı): kalıplar sınırlı ayraçlı; 8.000 karakterlik kötü niyetli girdide doğrusal kalır.
describe("uzun girdide süre", () => {
  it.each([
    ["duman ", 2_000],
    ["a".repeat(50) + " ", 200],
    [" ", 8_000],
    ["yangın yok ama ", 600],
    ["ne duman ne ", 800],
    ["smoke fire gas flood ", 500],
    ["şömine alevler halıya ", 400],
    ["\"yangın\" ", 900],
  ])("%j × %i → < 1,5 sn", (unit, n) => {
    const text = (unit as string).repeat(n as number).slice(0, 9_000);
    const t0 = performance.now();
    hazardEvidenceOf(text);
    hasSafetyReassurance(text);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});
