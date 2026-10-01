import { describe, it, expect } from "vitest";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { composeItemsPlan, relationFactsOf } from "@/lib/conversation-items/plan";
import { fixHazard, isFixRecipeText, kbRecipeTopics, topicsOf, touchesHeldDevice } from "@/lib/conversation-items/relation";
import type { ItemKind } from "@/lib/conversation-items/core";
import { autoReplyGateVerdict } from "@/lib/automation";
import type { SuggestReplyResult } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// ÖNCE ANLAM İLİŞKİSİ — 15 ajan incelemesi A06 (10-01 gece, ölçüldü). Kurucu kararları 17 + 18 "a" + 23'ün KOD tarafındaki açıklar:
//  1. Tehlike sözlüğü kaçırıyordu: sayaç panosu / ana şalter, çakmak / kibrit ile ocak yakma, tornavida, petek / Heizkörper / radiateur
//     havası alma, Gaszähler, FI / УЗО / рубильник / interruptor general / diferencial, المفتاح الرئيسي.
//  2. Cihaz konusu çıkmıyordu: şofben, petek, kondisyoner, mikro dalga, kilidi, televizyonun, klimanın "kar tanesi" simgesi, lave-linge,
//     televisor → örtüşme koruması ve bırakılan cihaz kapısı göremiyordu.
//  3. Tarif tanıyıcı yanlış pozitifleri: çıkış talimatı (kapatıp / ausschalten / apague…), ev kuralı (mantenga), ulaşım (bekleyin /
//     warten / espere / attendez), pazarlama (select), yalnız tırmandırma satırı ("…not working, please message us"), "bilmiyorsanız /
//     istemiyorsanız", İngilizce "basin" (lavabo), Almanca "drucken" (yazdırmak); genel başlıklı SSS kalemi yalnız ANILAN her cihazı da
//     tarifli sayıyordu.
//  4. Birleşik istek (klima + TV): tarif yalnız birinde varken ikisine de çözüm sunuluyordu.
//  5. Cevap bırakılan cihazı ADINI VERMEDEN anıp adım verince ("Makineyi kapatıp fişini çekin") kapı görmüyordu.
//  6. Kelime ağının uyarı geçişinde açtığı şikâyet (olgusuz) konusuz kalıyordu → aynı arızaya bağlı soru bağımsız sayılıyordu.
// İlişki kipi (1, 3, 4, 6) anahtarı kapalıyken HİÇ koşmaz; 2 ve 5 canlı liste kipinin bırakılan cihaz kapısını da sıkılaştırır (yalnız tutar).
// ---------------------------------------------------------------------------

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
type Req = { intent: ItemKind; q: string; relation?: string; message?: number };

function turnOf(bodies: string[], requests: Req[]) {
  const history = bodies.map((body, i) => ({ id: `m${i + 1}`, direction: "inbound" as const, body }));
  const u = parseUnderstanding(
    {
      language: "tr",
      requests: requests.map((r) => ({
        intent: r.intent,
        query_tr: r.q,
        query_original: r.q,
        message: r.message ?? 1,
        ...(r.relation !== undefined ? { relation: r.relation } : {}),
      })),
      stay_change: STAY_NONE,
      withdrawn: [],
    },
    { items: true, followup: true },
  );
  const ex = extractTurnItems({ history, guestMessage: bodies[bodies.length - 1], understanding: u });
  if (ex.mode !== "items") throw new Error(`tur bölünmedi: ${ex.reason}`);
  const turnItems = ex.messages.flatMap((m) => m.items.map((it) => ({ messageId: m.messageId, kind: it.kind, sensitivity: it.sensitivity })));
  return { turnItems, relations: relationFactsOf(ex.messages) };
}

describe("1 — tehlike sözlüğü (kurucu 18 'a': elektrik / gaz / sıcak su / ısıtma çözüm istisnasına girmez)", () => {
  it.each([
    "Sayaç panosundaki anahtarı açın.",
    "Ocak düğmesini bastırarak çakmakla yakın.",
    "Ocağı kibritle yakabilirsiniz.",
    "Petek vanasını tornavidayla gevşetin.",
    "Peteğin havasını alın.",
    "Flip the main switch back on.",
    "Light the stove with a match.",
    "Den Hauptschalter wieder einschalten.",
    "Den FI wieder hochdrücken.",
    "Am Gaszähler den Haupthahn öffnen.",
    "Heizkörper entlüften.",
    "Purgez le radiateur.",
    "Suba el interruptor general.",
    "Rearme el diferencial.",
    "Purgue el radiador.",
    "Включите рубильник.",
    "Поднимите УЗО.",
    "Стравите воздух из батареи.",
    "ارفع المفتاح الرئيسي.",
  ])("🚨 tehlike: %j", (t) => {
    expect(fixHazard(t)).toBe(true);
  });

  // Mutasyon turu (10-01 gece): üstteki cümlelerin bir kısmı İKİ tehlike işareti taşıdığı için tek tek terimler pinsizdi
  // ("Petek vanasını tornavidayla…", "Heizkörper entlüften", "Light the stove with a match", "Den FI wieder…"). Her terim TEK BAŞINA:
  it.each([
    "Vidayı tornavidayla sıkın.",
    "Petek soğuk kalıyor.",
    "Der Heizkörper bleibt kalt.",
    "Die Leitung entlüften.",
    "Le radiateur reste froid.",
    "El radiador está frío.",
    "Purgez la conduite.",
    "Purgue la tubería.",
    "Light it with a match.",
    "Light the stove carefully.",
    "Den FI hochdrücken.",
    "Danach FI wieder einschalten.",
    "Стравите воздух.",
    "Выпустите воздух из батареи.",
  ])("🚨 tek işaretli tehlike: %j", (t) => {
    expect(fixHazard(t)).toBe(true);
  });

  it.each([
    // "FI" yalnız kalıpla: katlanmış "wi-fi" içinde tam sözcük olurdu.
    "Wi-Fi şifresi buzdolabının üstünde.",
    "Den WLAN-Router (Wi-Fi) für 30 Sekunden ausschalten.",
    "Kumandada kar tanesi simgesini seçin.",
    "Watch the match at the bar downstairs.",
    "Haupteingang links, Aufzug rechts.",
    "Klimanın kumandasında MODE tuşuna basın.",
    "Ana kapının kodu giriş günü gönderilir.",
  ])("KONTROL — tehlike değil: %j", (t) => {
    expect(fixHazard(t)).toBe(false);
  });
});

describe("2 — cihaz konusu (yerel sözlük; getirme sözlüğü değişmez)", () => {
  it.each([
    ["şofben yanmıyor", "hot_water"],
    ["şofbeni nasıl yakarız", "hot_water"],
    ["petekler ısınmıyor", "heating"],
    ["peteği ısınmıyor", "heating"],
    ["kondisyoner soğutmuyor", "ac"],
    ["mikro dalga çalışmıyor", "microwave"],
    ["kapının kilidi açılmıyor", "keys"],
    ["televizyonun sesi yok", "tv"],
    ["kumandada kar tanesini seçin", "ac"],
    ["le lave-linge ne démarre pas", "laundry"],
    ["el televisor no enciende", "tv"],
  ])("%j → %s", (text, topic) => {
    expect(topicsOf(text)).toContain(topic);
  });

  it("KONTROL — mevcut eşlemeler aynen", () => {
    expect(topicsOf("çöp konteyneri yeri")).toEqual(["trash"]);
    expect(topicsOf("klima çalışmıyor")).toEqual(["ac"]);
    expect(topicsOf("wifi şifresi")).toEqual(["wifi"]);
  });
});

describe("3 — tarif tanıyıcı: iki kademeli işaret + yalnız tırmandırma satırı", () => {
  it.each([
    "The bathroom basin has a hairdryer in the drawer below.",
    "The garage can hold two cars.",
    "Çıkarken klimayı kapatıp anahtarı kutuya bırakın.",
    "Al salir, apague el aire acondicionado.",
    "Mantenga la puerta del balcón cerrada.",
    "Beim Verlassen bitte die Klimaanlage ausschalten.",
    "En partant, éteignez la climatisation.",
    "При выезде выключите кондиционер и свет.",
    "Please switch off the AC when you leave.",
    "If the TV is not working, please message us.",
    "Klima çalışmıyorsa bize yazın.",
    "Si el televisor no funciona, contáctenos.",
    "Если телевизор не работает, напишите нам.",
    "Kahve makinesini kullanmayı bilmiyorsanız bize sorun.",
    "Bulaşık makinesini kullanmak istemiyorsanız elde yıkayabilirsiniz.",
    "Otobüsü durakta bekleyin; asansör binanın girişinde.",
    "Select your favourite pool day at reception.",
    "Drucken Sie Ihre Bordkarte am Flughafen.",
    "Warten Sie im Aufzug nicht zu lange.",
    "Espere el ascensor en la planta baja.",
    "Attendez l'ascenseur au rez-de-chaussée.",
  ])("tarif DEĞİL: %j", (t) => {
    expect(isFixRecipeText(t)).toBe(false);
  });

  it.each([
    "Kumandadaki ON tuşuna basın.",
    "Drücken Sie die Taste SOURCE.",
    "Modemi kapatıp fişini çekin, 30 saniye sonra takın.",
    "Klima çalışmıyorsa kumandanın pilini değiştirin, düzelmezse bize yazın.",
    "Klima çalışmıyorsa 5 dakika bekleyin, düzelmezse bize yazın.",
    "Le lave-linge ne démarre pas ? Appuyez 3 secondes sur START.",
    "Bei Störungen den Router 30 Sekunden ausschalten und wieder einschalten.",
    "If the router is not working, the green light should be on.",
  ])("tarif: %j", (t) => {
    expect(isFixRecipeText(t)).toBe(true);
  });

  it("ikiz: aynı zayıf fiil İKİNCİ bir zayıf işaretle tarif olur ('kapatıp' + 'bekleyin')", () => {
    expect(isFixRecipeText("Çıkarken klimayı kapatıp anahtarı bırakın.")).toBe(false);
    expect(isFixRecipeText("Modemi kapatıp 30 saniye bekleyin.")).toBe(true);
  });

  it("genel başlıklı SSS: yalnız TARİF CÜMLESİNDEKİ cihaz tariflidir; çok konulu başlıkta da öyle", () => {
    const faq = {
      title: "Sık sorulanlar",
      content: "Klima soğutmuyorsa MODE tuşuna basın. Kahve makinesi mutfakta. Çamaşır makinesi banyoda. Mikrodalga tezgâhta. Wi-Fi şifresi buzdolabının üstünde.",
    };
    expect([...kbRecipeTopics([faq])]).toEqual(["ac"]);
    const combo = { title: "TV ve İnternet", content: "TV görüntü vermiyorsa SOURCE tuşuna basın. Modem salonda, TV ünitesinin altında." };
    expect([...kbRecipeTopics([combo])]).toEqual(["tv"]);
    // Çok konulu başlıkta tarif cümlesinin BAŞLIK DIŞI cihazı (burada klima) tarifli sayılmaz (mutasyon turu: süzgeç pinsizdi).
    const comboExtra = { title: "TV ve İnternet", content: "TV görüntü vermiyorsa SOURCE tuşuna basın, klimayı da kapatın." };
    expect([...kbRecipeTopics([comboExtra])]).toEqual(["tv"]);
    // KONTROL: tek cihazlı başlık eski kural (başlık konusu), tarif cümlesi cihaz adı taşımasa da.
    expect([...kbRecipeTopics([{ title: "Klima", content: "Soğutmazsa MODE tuşuna basın." }])]).toEqual(["ac"]);
  });
});

describe("4 — birleşik istek: HER cihaz konusu tarifli olmalı", () => {
  const reqs: Req[] = [
    { intent: "complaint_issue", q: "klima ve televizyon çalışmıyor", relation: "own_topic" },
    { intent: "appliance_help", q: "klima ve televizyon nasıl düzelir", relation: "fix_request" },
  ];
  const planWith = (recipe: string[]) => {
    const { turnItems, relations } = turnOf(["Klima ve televizyon çalışmıyor, ne yapalım?"], reqs);
    const held = turnItems.filter((i) => i.sensitivity === "sensitive").map((i) => ({ ...i, riskType: null }));
    return composeItemsPlan({ turnItems, held, hints: new Map(), ...(relations ? { relations, kbRecipeTopics: new Set(recipe) } : {}) });
  };
  it("🚨 yalnız klima tarifi varken TV'ye de çözüm SUNULMAZ (istek ev sahibinde)", () => {
    expect(planWith(["ac"]).answerable).toEqual([]);
  });
  it("KONTROL: iki cihazın da tarifi varsa çözüm olarak sunulur", () => {
    expect(planWith(["ac", "tv"]).replyItems.answerable).toEqual([expect.objectContaining({ kind: "appliance_help", fix: true })]);
  });
});

describe("5 — cevap bırakılan cihazı ADSIZ anıp adım veriyor", () => {
  it("🚨 cevaplanan istek cihaz değilken 'Makineyi kapatıp…' bırakılan bulaşık makinesine değinir", () => {
    const reply = "Çöp konteyneri binanın arkasında. Makineyi kapatıp fişini 1 dakika çekin, sonra tekrar başlatın.";
    expect(touchesHeldDevice(["dishwasher"], reply, { genericRef: true })).toBe(true);
    expect(touchesHeldDevice(["dishwasher"], "Cihazı kapatıp fişini çekin; çıkış saati 11:00.", { genericRef: true })).toBe(true);
    expect(touchesHeldDevice(["laundry"], "Please unplug the machine and restart it.", { genericRef: true })).toBe(true);
    expect(touchesHeldDevice(["microwave"], "Débranchez l'appareil puis rebranchez-le.", { genericRef: true })).toBe(true);
    // Klima adımı cihaz adı olmadan ("kar tanesi" simgesi) — konu yoluyla.
    expect(touchesHeldDevice(["ac"], "Kumandada MODE tuşuna basıp kar tanesini seçin.")).toBe(true);
  });
  it("KONTROL: cevaplanan istek cihazsa adsız anış o cihazındır (genericRef yok); adımsız anış değinme değil; adlandırılmış başka cihaz", () => {
    const reply = "Makineyi kapatıp fişini 1 dakika çekin, sonra tekrar başlatın.";
    expect(touchesHeldDevice(["dishwasher"], reply)).toBe(false);
    expect(touchesHeldDevice(["dishwasher"], "Cihazınızı şarj etmek için prizler yatak başında.", { genericRef: true })).toBe(false);
    expect(touchesHeldDevice(["dishwasher"], "Kahve makinemiz mutfakta; kapsülü takıp düğmeye basın.", { genericRef: true })).toBe(false);
  });
  it("plan: genericRef yalnız cevaplanan isteklerin HİÇBİRİ cihaz değilken", () => {
    const run = (second: Req) => {
      const { turnItems, relations } = turnOf(
        ["Bulaşık makinesi çalışmıyor.", second.intent === "trash" ? "Çöp nerede?" : "Wi-Fi şifresi ne?"],
        [{ intent: "complaint_issue", q: "bulaşık makinesi çalışmıyor", relation: "own_topic" }, { ...second, message: 2 }],
      );
      const held = turnItems.filter((i) => i.sensitivity === "sensitive").map((i) => ({ ...i, riskType: null }));
      return composeItemsPlan({ turnItems, held, hints: new Map(), ...(relations ? { relations, kbRecipeTopics: new Set<string>() } : {}) });
    };
    const trash = run({ intent: "trash", q: "çöp konteyneri yeri", relation: "own_topic" });
    expect(trash.gateItems.heldDeviceTopics).toEqual(["dishwasher"]);
    expect(trash.gateItems.heldDeviceGenericRef).toBe(true);
    const wifi = run({ intent: "wifi", q: "wifi şifresi", relation: "own_topic" });
    expect(wifi.gateItems.heldDeviceTopics).toEqual(["dishwasher"]);
    expect(wifi.gateItems.heldDeviceGenericRef).toBeUndefined();
  });
});

describe("5 — kapı bağlantısı: plan bayrağı autoReplyGateVerdict'e ulaşır (liste kipi, canlı yapılandırma)", () => {
  const verdict = (reply: string): SuggestReplyResult => ({
    intent: "general",
    confidence: 0.95,
    reply,
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: ["kb:luggage"],
    missingInfo: [],
    statedCheckoutTime: null,
    answeredRequests: { ok: true, refs: ["R1"] },
  });
  const complaint = { kind: "complaint_issue" as const, sensitivity: "sensitive" as const, riskType: null };
  // Liste kipinde şikâyetten BAĞIMSIZ tür (bavul) — bağlı tür (çöp) önce `items_complaint_dependent` ile tutulurdu.
  const MSG = "Bulaşık makinesi çalışmıyor. Bavulları nereye bırakabiliriz?";
  const items = (generic: boolean) => ({
    items: {
      held: [complaint],
      paymentHeld: false,
      answerableKinds: ["luggage" as const],
      heldDeviceTopics: ["dishwasher"],
      ...(generic ? { heldDeviceGenericRef: true as const } : {}),
    },
  });
  const reply = "Bavullarınızı girişteki dolaba bırakabilirsiniz. Makineyi kapatıp fişini 1 dakika çekin, sonra tekrar başlatın.";
  it("🚨 bayrak varken adsız 'makine' adımı → items_held_touched", () => {
    expect(autoReplyGateVerdict(verdict(reply), MSG, items(true))?.detail).toBe("items_held_touched");
  });
  it("KONTROL: bayrak yokken (cevaplanan istek cihaz) aynı cevap bu sebeple tutulmaz", () => {
    expect(autoReplyGateVerdict(verdict(reply), MSG, items(false))?.detail ?? "geçti").not.toBe("items_held_touched");
  });
});

describe("6 — olgusuz bağlayıcı talep (kelime ağının uyarı geçişi) aynı mesajın konusunu alır", () => {
  it("🚨 'Otopark kapısı açılmıyor!' (anlama: otopark) + 'Arabayla nasıl çıkarız?' → bağlı, TUTULUR", () => {
    const { turnItems, relations } = turnOf(
      ["Otopark kapısı açılmıyor!", "Arabayla nasıl çıkarız?"],
      [
        { intent: "parking", q: "otopark kapısı açılmıyor", relation: "own_topic", message: 1 },
        { intent: "parking", q: "araçla otoparktan çıkış", relation: "own_topic", message: 2 },
      ],
    );
    const held = [
      ...turnItems.filter((i) => i.sensitivity === "sensitive").map((i) => ({ ...i, riskType: null })),
      // Senkronun uyarı geçişi (yalnız kelime ağı) m1 için şikâyet öğesini kalıcı açtı; anlama katmanı onu başka türle okudu.
      { messageId: "m1", kind: "complaint_issue" as const, sensitivity: "sensitive" as const, riskType: null },
    ];
    expect(relations).not.toBeNull();
    const p = composeItemsPlan({ turnItems, held, hints: new Map(), relations: relations!, kbRecipeTopics: new Set(["parking"]) });
    expect(p.answerable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7 — RC60 REGRESYON KOŞUSU (10-01 gece, kör set 6 — ücretli koşu GÖSTERDİ, ölçüm ücretsiz yeniden üretildi): A06 sıkılaştırması üç GERÇEK
// tarifi düşürüyordu → set 6'nın üç tarifli arızası (otopark kumandası, çamaşır makinesi kapağı, bulaşık makinesi) misafire gitmedi:
//  · "touch and hold the key symbol for 3 seconds" (dokunmatik ocak) tek zayıf işaretti;
//  · "Otopark kapısı kumandası çalışmazsa" başlığı sözlükte iki kavrama iniyor (otopark + kumanda) ama TEK cihazdır;
//  · SSS satırında cihaz soru / arıza başlığında anılır, tarif sonraki cümlededir ("…kapağı açılmıyor: … 2 dakika bekleyin; açılmazsa
//    START/PAUSE tuşuna basılı tutun").
// Eval bilgi tabanlarının 568 kaleminde canlıya göre fark 30 → 15 kalem; kalan kayıplar A06'nın hedefi (çıkış talimatı, yalnız anılan cihaz).
// ---------------------------------------------------------------------------
describe("7 — RC60 regresyonu: gerçek tarifler geri, A06 korumaları yerinde", () => {
  it("🚨 dokunmatik 'touch and hold … key symbol' tarifi (set 6 'Induction hob')", () => {
    const hob = {
      title: "Induction hob",
      content:
        "The kitchen hob is induction. If it beeps but no zone heats up, the child lock is on: touch and hold the key symbol for 3 seconds until the small red dot next to it goes out, then switch the hob on with the ON/OFF field.",
    };
    expect([...kbRecipeTopics([hob])]).toEqual(["stove"]);
    // Tek işaretli ikizler (mutasyon): yalnız güçlü ifade ("screen / panel" kontrol adı değil).
    expect(isFixRecipeText("Touch and hold the screen until it wakes up.")).toBe(true);
    expect(isFixRecipeText("Tap and hold the panel until it beeps.")).toBe(true);
  });

  it("🚨 liste ayracı olmayan çok kavramlı başlık TEK cihazdır; listeli başlık ('… ve …') tarif cümlesine bakar", () => {
    const remote = {
      title: "Otopark kapısı kumandası çalışmazsa",
      content:
        "Kapıyı açmak için kumandadaki büyük gri düğmeye 2 saniye basılı tutun ve kapıya en fazla 10 metre yaklaşın. Kapı tepki vermiyor ve kumandanın küçük kırmızı ışığı yanıp sönmüyorsa pil bitmiştir: arka kapağı bozuk parayla çevirerek açın, içindeki CR2032 pili değiştirin.",
    };
    expect([...kbRecipeTopics([remote])].sort()).toContain("parking");
    // KONTROL (A06): listeli başlıkta yalnız tarif cümlesinin cihazı.
    expect([...kbRecipeTopics([{ title: "TV ve İnternet", content: "TV görüntü vermiyorsa SOURCE tuşuna basın. Modem salonda." }])]).toEqual(["tv"]);
  });

  it("🚨 SSS satırı: soru / arıza başlığındaki cihaz aynı satırın tarif cümlesine geçer; sonraki ve ilgisiz önceki cümle geçmez", () => {
    const faq = {
      title: "Sık sorulanlar",
      content:
        "Çamaşır deterjanı nerede? Banyo lavabosunun altındaki dolapta.\nÇamaşır makinesinin kapağı açılmıyor: Program bittikten sonra kapak 2 dakika kapalı kalır. 2 dakika bekleyin; olmazsa START/PAUSE tuşuna 3 saniye basılı tutun.",
    };
    expect([...kbRecipeTopics([faq])]).toContain("laundry");
    // Aynı cihazı anan önceki cümle (başlık değil) de miras verir: "Otopark kapısı kumandayla açılır. Kumanda çalışmazsa … basın."
    const same = { title: "Sık sorulanlar", content: "Otopark kapısı anahtarlıktaki kumandayla açılır. Kumanda çalışmazsa onay tuşuna basın." };
    expect([...kbRecipeTopics([same])]).toContain("parking");
    // İlgisiz önceki bilgi cümlesi (başlık değil, ortak cihaz yok) miras VERMEZ.
    const unrelated = { title: "Sık sorulanlar", content: "Wi-Fi şifresi buzdolabının üstünde. Klima soğutmuyorsa MODE tuşuna basın." };
    expect([...kbRecipeTopics([unrelated])]).toEqual(["ac"]);
    // Yalnız iki nokta başlık değil: "Ağ adı: …, şifre: …" sonraki klima tarifine Wi-Fi geçirmez.
    const colon = { title: "Sık sorulanlar", content: "Ağ adı: Lale-5G, şifre: Lale2025. Klima soğutmuyorsa MODE tuşuna basın." };
    expect([...kbRecipeTopics([colon])]).toEqual(["ac"]);
    // Başka SATIRIN başlığı miras vermez.
    const otherLine = { title: "Sık sorulanlar", content: "Kahve makinesi çalışmıyor mu?\nKlima soğutmuyorsa MODE tuşuna basın." };
    expect([...kbRecipeTopics([otherLine])]).toEqual(["ac"]);
  });

  it.each([
    "Kumandanın tuşuyla COOL seçin.",
    "Kumandanın düğmesine 3 saniye bekleyip tekrar dokunmayın.",
    "Soğutma için COOL modunu seçin.",
    "Günlük yıkama için 30 derece programını seçin.",
    "Kar tanesi simgesini seçin.",
    "Select the eco button.",
    "Select the eco mode.",
    "Select the right setting.",
    "Select the snowflake symbol.",
    "Select the snowflake icon.",
    "Wait and turn the dial.",
    "Wait and turn the knob.",
    "Die Taste einschalten.",
    "Den Knopf einschalten.",
    "Den Modus wählen.",
    "Das Programm wählen.",
    "Den Schalter einschalten.",
    "Sélectionnez le bouton éco.",
    "Sélectionnez la touche éco.",
    "Sélectionnez le programme éco.",
    "Éteignez l'interrupteur.",
    "Sélectionnez le symbole flocon.",
    "Seleccione el botón eco.",
    "Seleccione la tecla eco.",
    "Seleccione el modo eco.",
    "Seleccione el programa eco.",
    "Apague el interruptor.",
    "Seleccione el símbolo del copo.",
    "Выберите кнопку ЭКО.",
    "Выберите режим охлаждения.",
    "Выберите значок снежинки.",
    "Выключите переключатель.",
    "اختر زر التبريد.",
    "انتظر حتى ينطفئ الزر.",
  ])("kontrol adı + TEK zayıf fiil = tarif: %j", (t) => {
    expect(isFixRecipeText(t)).toBe(true);
  });

  it("kontrol adı (tuş / button / Taste…) zayıf işarettir: fiille tarif, tek başına ya da iki ad fiilsiz değil", () => {
    expect(isFixRecipeText("Kumandadaki Source tuşuyla 'TV' kaynağını seçin.")).toBe(true);
    expect(isFixRecipeText("Maintenez le bouton enfoncé, puis attendez.")).toBe(true);
    expect(isFixRecipeText("Kapıda tuşlu kilit var.")).toBe(false);
    expect(isFixRecipeText("Tuş takımı ve düğme kapının solunda.")).toBe(false);
    expect(isFixRecipeText("Select the 5 GHz network for faster speed.")).toBe(false);
  });

  it("Türkçe güç döngüsü ('kapatıp … yeniden açın / açabilirsiniz') tarif; 'yeniden açılır' (bilgi) değil", () => {
    expect(isFixRecipeText("Sinyal zayıfsa modemi kapatıp 30 saniye sonra yeniden açabilirsiniz.")).toBe(true);
    expect(isFixRecipeText("İnternet giderse modemin güç düğmesini kapatın, 30 saniye bekleyip yeniden açın.")).toBe(true);
    expect(isFixRecipeText("Havuz 1 Mayıs'ta yeniden açılır.")).toBe(false);
  });

  it.each([
    "Modemi kapatın ve yeniden açın.",
    "Modemi kapatın, sonra yeniden açınız.",
    "Modemi yeniden açıp deneyin.",
    "Modemi kapatın, 1 dakika sonra yeniden açabilirsiniz.",
    "Modemi kapatın ve tekrar açın.",
    "Router'ı tekrar açıp deneyin.",
    "Modemi kapatın, sonra tekrar açabilirsiniz.",
    "Fişi yeniden takın.",
    "Fişi tekrar takın.",
  ])("Türkçe güç döngüsü ifadesi TEK başına tarif: %j", (t) => {
    expect(isFixRecipeText(t)).toBe(true);
  });

  it.each([
    "Kol yarıda sıkışırsa kapıyı itip kapatın.",
    "Kart okuyucuda takılırsa kartı çıkarıp silin.",
    "İnternet kesilirse modemin fişini 30 saniye çekip takın.",
    "Kumanda bozulursa yedek kumanda çekmecede.",
    "Kombi arızalanırsa önce ekrandaki kodu okuyun.",
  ])("Türkçe olumlu arıza koşulu (kapalı küme) TEK başına arıza anışı: %j", (t) => {
    expect(isFixRecipeText(t)).toBe(true);
  });

  it("SSS: SORU başlığındaki cihaz (arıza sözcüğü olmadan) tarif cümlesine geçer", () => {
    const qa = { title: "Sık sorulanlar", content: "Kahve makinesini nasıl kullanırım? Kapsülü takıp düğmeye basın." };
    expect([...kbRecipeTopics([qa])]).toContain("coffee");
  });

  it("çok satırlı SSS: cihaz ANMAYAN tarif cümlesi cihazı yalnız soru / arıza BAŞLIĞINDAN alır (yedek kural devreye girmez — mutasyon)", () => {
    // İlk satırın kendi cihazlı tarifi var → "hiç cihaz yok" yedeği koşmaz; ikinci satırın tarifi cihazı başlıktan alır.
    const header = {
      title: "Sık sorulanlar",
      content: "Klima soğutmuyorsa MODE tuşuna basın.\nÇamaşır makinesinin kapağı açılmıyor mu? Sağdaki düğmeye 5 saniye basılı tutun.",
    };
    expect([...kbRecipeTopics([header])].sort()).toEqual(["ac", "laundry"]);
    // KONTROL: önceki cümle başlık değil (bilgi) ve tarif cümlesi cihaz anmıyor → miras YOK.
    const info = {
      title: "Sık sorulanlar",
      content: "Klima soğutmuyorsa MODE tuşuna basın.\nÇamaşır makinesi banyoda. Sağdaki düğmeye 5 saniye basılı tutun.",
    };
    expect([...kbRecipeTopics([info])]).toEqual(["ac"]);
  });

  it.each([
    // Başlık ölçütü başına TEK işaret (mutasyon): yalnız soru · yalnız "-mıyor" · yalnız koşul (bize yazın satırı tarif değil) · yalnız arıza ifadesi.
    ["Kahve makinesini nasıl açarım? Sağdaki düğmeye 5 saniye basılı tutun.", "coffee"],
    ["Çamaşır makinesinin kapağı açılmıyor. Sağdaki düğmeye 5 saniye basılı tutun.", "laundry"],
    ["Çamaşır makinesi çalışmıyorsa bize haber verin; önce sağdaki düğmeye 5 saniye basılı tutun.", "laundry"],
    ["If the washing machine is not working, message us; first hold the left button for 5 seconds.", "laundry"],
  ])("başlık ölçütü tek başına mirası taşır: %j", (line, device) => {
    const item = { title: "Sık sorulanlar", content: `Klima soğutmuyorsa MODE tuşuna basın.\n${line}` };
    expect([...kbRecipeTopics([item])].sort()).toEqual(["ac", device].sort());
  });

  it("Türkçe arıza koşulu: 3. şahıs '-mazsa' ve kapalı küme ('sıkışırsa / kesilirse'); 2. şahıs ve 'unutmazsa' değil", () => {
    expect(isFixRecipeText("Kumanda çalışmazsa bariyerin yanındaki tuş takımına 1987 kodunu girin.")).toBe(true);
    expect(isFixRecipeText("Kol yarıda sıkışırsa kolu sonuna kadar aşağı çevirin.")).toBe(true);
    expect(isFixRecipeText("İnternet kesilirse modemin fişini 30 saniye çekip takın.")).toBe(true);
    expect(isFixRecipeText("Saat 22'ye kadar gelmezseniz anahtar kutuda bekler.")).toBe(false);
    expect(isFixRecipeText("Misafirimiz unutmazsa anahtarı kâseye bırakır.")).toBe(false);
    // KONTROL: yalnız tırmandırma satırı yine tarif değil.
    expect(isFixRecipeText("Klima çalışmazsa bize yazın.")).toBe(false);
  });
});
