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
