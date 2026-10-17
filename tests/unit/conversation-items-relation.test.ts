import { describe, it, expect } from "vitest";
import { parseUnderstanding, understandingSchemaFor } from "@/lib/ai/semantic/understanding-schema";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { composeItemsPlan, relationFactsOf } from "@/lib/conversation-items/plan";
import { buildItemsPromptBlock } from "@/lib/conversation-items/reply-block";
import {
  fixHazard,
  touchesHeldDevice,
  isFixRecipeText,
  isGenericFollowup,
  kbRecipeTopics,
  relationGateHold,
  requestDependency,
  requestTopics,
  stricterRelation,
  topicsOf,
  type AnchorFacts,
  type RequestFacts,
} from "@/lib/conversation-items/relation";
import { autoReplyGateVerdict } from "@/lib/automation";
import type { SuggestReplyResult } from "@/lib/ai/types";
import type { ItemKind } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// HASSAS TALEP + BAŞKA SORU: ÖNCE ANLAM İLİŞKİSİ (kurucu kararı 10-01 sabah, Sabah Kararları 17 + 18 "a"). Sabit tür listesi iki yönde
// yanlıştı: "Klima çalışmıyor; çöp konteyneri nerede?" → çöp sorusu tutuluyordu; "Otopark kapısı açılmıyor, nasıl çıkacağız?" → arızaya
// bağlı soru (otopark türü) cevaplanabilir sayılıyordu. Kurucu: ilişki belirsizse tut; bağımsızlık işareti tek başına gönderim izni değil;
// hatalı "bağımsız" işareti doğrudan kapıya verilse de bağlı istek tutulur; elektrik / gaz / sıcak su cihazı çözüm istisnasına girmez.
// Testler ürünün kendi zincirini koşar: anlama çıktısı (çözücü) → tur çıkarımı (gerçek kelime ağı) → plan → kapı.
// ---------------------------------------------------------------------------

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
type Req = { intent: ItemKind; q: string; relation?: string; message?: number; qo?: string };

/** Ürün zinciri: anlama çıktısı → öğeler → plan. `followup` false = bugünkü canlı kip (işaret yok → liste kuralı). */
/**
 * Varsayılan bilgi tabanı: otopark / Wi-Fi / televizyon / klima için TARİF kalemi olan bir mülk (karar 23 kör doğrulaması: arıza çözümü
 * yalnız tarifi olan konuya sunulur). `recipeTopics: []` = tarifsiz bilgi tabanı.
 */
const DEFAULT_RECIPE_TOPICS = ["parking", "wifi", "tv", "ac"];
function planOf(
  bodies: string | string[],
  requests: Req[],
  opts: { followup?: boolean; earlierComplaint?: boolean; recipeTopics?: string[] } = {},
) {
  const list = Array.isArray(bodies) ? bodies : [bodies];
  const history = list.map((body, i) => ({ id: `m${i + 1}`, direction: "inbound" as const, body }));
  const followup = opts.followup ?? true;
  const u = parseUnderstanding(
    {
      language: "tr",
      requests: requests.map((r) => ({
        intent: r.intent,
        query_tr: r.q,
        query_original: r.qo ?? r.q,
        message: r.message ?? 1,
        ...(r.relation !== undefined ? { relation: r.relation } : {}),
      })),
      stay_change: STAY_NONE,
      withdrawn: [],
    },
    { items: true, followup },
  );
  const ex = extractTurnItems({ history, guestMessage: list[list.length - 1], understanding: u });
  if (ex.mode !== "items") throw new Error(`tur bölünmedi: ${ex.reason}`);
  const turnItems = ex.messages.flatMap((m) => m.items.map((it) => ({ messageId: m.messageId, kind: it.kind, sensitivity: it.sensitivity })));
  const held = [
    ...turnItems.filter((i) => i.sensitivity === "sensitive").map((i) => ({ ...i, riskType: null })),
    ...(opts.earlierComplaint ? [{ messageId: "m0", kind: "complaint_issue" as const, sensitivity: "sensitive" as const, riskType: null, earlier: true }] : []),
  ];
  const relations = relationFactsOf(ex.messages);
  return composeItemsPlan({
    turnItems,
    held,
    hints: new Map(),
    ...(relations ? { relations, kbRecipeTopics: new Set(opts.recipeTopics ?? DEFAULT_RECIPE_TOPICS) } : {}),
  });
}
const answerableKinds = (p: ReturnType<typeof planOf>) => p.answerable.map((a) => a.item.kind);

describe("kurucu örnekleri — önce anlam ilişkisi (ürün zinciri)", () => {
  it("🚨 'Klima çalışmıyor; çöp konteyneri nerede?' → çöp sorusu CEVAPLANIR (bugünkü liste tutuyordu)", () => {
    const msg = "Klima çalışmıyor; çöp konteyneri nerede?";
    const reqs: Req[] = [
      { intent: "complaint_issue", q: "klima çalışmıyor arıza", relation: "own_topic" },
      { intent: "trash", q: "çöp konteyneri yeri", relation: "own_topic" },
    ];
    const p = planOf(msg, reqs);
    expect(answerableKinds(p)).toEqual(["trash"]);
    expect(p.replyItems.held.map((h) => h.kind)).toEqual(["complaint_issue"]);
    // KONTROL — işaret yokken (şikâyet takibi anahtarı kapalı, bugünkü canlı yol) liste kuralı BİREBİR: çöp tutulur.
    expect(answerableKinds(planOf(msg, reqs, { followup: false }))).toEqual([]);
  });

  it("🚨 'Otopark kapısı açılmıyor, nasıl çıkacağız?' → model 'kendi konusu' dese de (yanlış işaret) bağlı: TUTULUR", () => {
    const msg = "Otopark kapısı açılmıyor, nasıl çıkacağız?";
    const p = planOf(msg, [
      { intent: "complaint_issue", q: "otopark kapısı açılmıyor", relation: "own_topic" },
      { intent: "parking", q: "otoparktan nasıl çıkılır", relation: "own_topic" },
    ]);
    expect(answerableKinds(p)).toEqual([]);
    expect(p.allHeld).toBe(true);
    expect(p.replyItems.held.map((h) => h.kind)).toEqual(["complaint_issue", "parking"]);
  });

  it("aynı mesaj, model 'arıza çözümü' der → yalnız ÇÖZÜM olarak cevaplanabilir (bilgi tabanı şartı kapıda)", () => {
    const p = planOf("Otopark kapısı açılmıyor, nasıl çıkacağız?", [
      { intent: "complaint_issue", q: "otopark kapısı açılmıyor", relation: "own_topic" },
      { intent: "parking", q: "otopark kapısı açma yöntemi", relation: "fix_request" },
    ]);
    expect(answerableKinds(p)).toEqual(["parking"]);
    expect(p.replyItems.answerable[0]).toMatchObject({ ref: "R1", kind: "parking", fix: true });
    expect(p.gateItems.relation?.requests[0]).toMatchObject({ ref: "R1", relation: "fix_request", recipe: true });
  });

  it("🚨 karar 23 kör doğrulaması: bilgi tabanında bu konunun TARİFİ yoksa arıza çözümü SUNULMAZ — istek şikâyetle ev sahibinde", () => {
    // Kör set 4: tarifsiz arızada model BOŞ cevap verdi / "adımlar bilgide yok" yazdı / şifre kalemine dayanıp adım uydurdu.
    const reqs: Req[] = [
      { intent: "complaint_issue", q: "internet yok", relation: "own_topic" },
      { intent: "wifi", q: "internet bağlantısı nasıl düzelir", relation: "fix_request" },
    ];
    const none = planOf("İnternet bir saattir yok.", reqs, { recipeTopics: [] });
    expect(answerableKinds(none)).toEqual([]);
    expect(none.allHeld).toBe(true);
    expect(none.replyItems.held.map((h) => h.kind)).toEqual(["complaint_issue", "wifi"]);
    // Başka konunun tarifi yetmez (klima tarifi internet arızasını cevaplamaz).
    expect(answerableKinds(planOf("İnternet bir saattir yok.", reqs, { recipeTopics: ["ac"] }))).toEqual([]);
    // KONTROL: tarif varsa çözüm olarak sunulur.
    const withRecipe = planOf("İnternet bir saattir yok.", reqs, { recipeTopics: ["wifi"] });
    expect(withRecipe.replyItems.answerable).toEqual([expect.objectContaining({ ref: "R1", kind: "wifi", fix: true })]);
    // Tarifsiz arıza + bağımsız soru: model yalnız bağımsız soruyu görür (kahve makinesi, kör set 4).
    const mixed = planOf("Kahve makinesi çalışmıyor. Otopark yerimiz hangisi?", [
      { intent: "complaint_issue", q: "kahve makinesi çalışmıyor", relation: "own_topic" },
      { intent: "appliance_help", q: "kahve makinesi turuncu ışık", relation: "fix_request" },
      { intent: "parking", q: "otopark yeri", relation: "own_topic" },
    ]);
    expect(answerableKinds(mixed)).toEqual(["parking"]);
    expect(mixed.replyItems.answerable[0]).not.toHaveProperty("fix");
    expect(mixed.replyItems.held.map((h) => h.kind)).toEqual(["complaint_issue", "appliance_help"]);
  });

  it("🚨 gürültü + 'yine olursa ne yapacağız?' bölünüp 'kendi konusu' işaretlense de TUTULUR (konu yok / aynı konu / ev kuralı)", () => {
    const msg = "Gürültü yüzünden uyuyamadık, yine olursa ne yapacağız?";
    const complaint: Req = { intent: "complaint_issue", q: "gürültü şikâyeti uyuyamadık", relation: "own_topic" };
    for (const follow of [
      { intent: "other", q: "tekrar olursa ne yapmalı", relation: "own_topic" },
      { intent: "house_rules", q: "sessiz saatler kuralı", relation: "own_topic" },
      { intent: "amenities", q: "gürültü tekrar olursa ne yapılır", relation: "own_topic" },
      { intent: "other", q: "gürültü olursa ne yapmalı", relation: "follow_up" },
    ] as Req[]) {
      expect(answerableKinds(planOf(msg, [complaint, follow])), follow.q).toEqual([]);
    }
  });

  it("gürültü + bağımsız 'Wi-Fi ağı hangisi?' → Wi-Fi cevaplanır, şikâyet ev sahibinde", () => {
    const p = planOf("Gürültüden uyuyamadık. Bu arada Wi-Fi ağı hangisi?", [
      { intent: "complaint_issue", q: "gürültü şikâyeti", relation: "own_topic" },
      { intent: "wifi", q: "wifi ağ adı", relation: "own_topic" },
    ]);
    expect(answerableKinds(p)).toEqual(["wifi"]);
  });

  it("kurucu: iade ve ev sahibiyle görüşme talebine de AYNI kural — bağlı soru tutulur, bağımsız soru cevaplanır", () => {
    const refund = { intent: "cancellation_refund", q: "iade talebi", relation: "own_topic" } as Req;
    expect(answerableKinds(planOf("İade istiyorum, şimdi ne olacak?", [refund, { intent: "other", q: "iade süreci ne olacak", relation: "follow_up" }]))).toEqual([]);
    expect(answerableKinds(planOf("İade istiyorum. Wi-Fi şifresi neydi?", [refund, { intent: "wifi", q: "wifi şifresi", relation: "own_topic" }]))).toEqual(["wifi"]);
    const human = { intent: "human_request", q: "ev sahibiyle görüşmek", relation: "own_topic" } as Req;
    expect(answerableKinds(planOf("Ev sahibiyle görüşmek istiyorum. Wi-Fi şifresi neydi?", [human, { intent: "wifi", q: "wifi şifresi", relation: "own_topic" }]))).toEqual(["wifi"]);
    expect(answerableKinds(planOf("Ev sahibiyle görüşmek istiyorum, ne zaman arar?", [human, { intent: "other", q: "ne zaman arar", relation: "unclear" }]))).toEqual([]);
  });

  it("🚨 ilişki belirsizse (unclear / eksik / tanınmayan işaret) TUTULUR", () => {
    const complaint = { intent: "complaint_issue", q: "klima çalışmıyor", relation: "own_topic" } as Req;
    for (const relation of ["unclear", undefined, "independent", "OWN_TOPIC"]) {
      const p = planOf("Klima çalışmıyor; çöp konteyneri nerede?", [complaint, { intent: "trash", q: "çöp konteyneri yeri", relation }]);
      expect(answerableKinds(p), String(relation)).toEqual([]);
    }
  });

  it("🚨 tehlike sınıfı çözüm istisnasına GİRMEZ: sıcak su / kombi, sigorta / elektrik — model 'arıza çözümü' dese de", () => {
    const cases: [string, Req[]][] = [
      ["Sıcak su yok, kombiyi nasıl resetleriz?", [{ intent: "complaint_issue", q: "sıcak su yok", relation: "own_topic" }, { intent: "appliance_help", q: "kombi resetleme", relation: "fix_request" }]],
      ["Sigorta attı, elektrik yok, ne yapalım?", [{ intent: "complaint_issue", q: "elektrik kesildi sigorta attı", relation: "own_topic" }, { intent: "appliance_help", q: "sigorta nasıl kaldırılır", relation: "fix_request" }]],
      ["Şofben yanmıyor, nasıl yakarız?", [{ intent: "complaint_issue", q: "şofben yanmıyor", relation: "own_topic" }, { intent: "appliance_help", q: "şofben yakma", relation: "fix_request" }]],
      ["The boiler is off, how do we relight it?", [{ intent: "complaint_issue", q: "kombi çalışmıyor", relation: "own_topic", qo: "boiler not working" }, { intent: "appliance_help", q: "kombi yeniden yakma", relation: "fix_request", qo: "relight boiler pilot light" }]],
    ];
    for (const [msg, reqs] of cases) {
      const p = planOf(msg, reqs);
      expect(answerableKinds(p), msg).toEqual([]);
      expect(p.allHeld, msg).toBe(true);
    }
  });

  it("tehlikesiz arıza: 'İnternet iki saattir yok, modemi nasıl resetleriz?' → çözüm cevaplanabilir; şikâyet ev sahibinde", () => {
    const p = planOf("İnternet iki saattir yok, modemi nasıl resetleriz?", [
      { intent: "complaint_issue", q: "internet yok", relation: "own_topic" },
      { intent: "wifi", q: "modem yeniden başlatma", relation: "fix_request" },
    ]);
    expect(answerableKinds(p)).toEqual(["wifi"]);
    expect(p.replyItems.answerable[0].fix).toBe(true);
    expect(p.gateItems.held.map((h) => h.kind)).toEqual(["complaint_issue"]);
  });

  it("çözüm istisnası yalnız ŞİKÂYET turunda ve cihaz / tesis türünde (iade turu, ev kuralı türü → tutulur)", () => {
    expect(
      answerableKinds(planOf("İade istiyorum; modemi nasıl resetleriz?", [
        { intent: "cancellation_refund", q: "iade talebi", relation: "own_topic" },
        { intent: "wifi", q: "modem yeniden başlatma", relation: "fix_request" },
      ])),
    ).toEqual([]);
    expect(
      answerableKinds(planOf("Komşular gürültü yapıyor, nasıl susturabiliriz?", [
        { intent: "complaint_issue", q: "komşu gürültüsü", relation: "own_topic" },
        { intent: "house_rules", q: "gürültü nasıl durdurulur", relation: "fix_request" },
      ])),
    ).toEqual([]);
  });

  it("çok mesajlı tur: şikâyet [1], 'ne yapacağız?' [2] → bağlı; ÖNCEKİ turun şikâyeti bugünkü soruyu bağlamaz (K8)", () => {
    expect(
      answerableKinds(planOf(["Klima çalışmıyor.", "Ne yapacağız?"], [
        { intent: "complaint_issue", q: "klima arızası", relation: "own_topic", message: 1 },
        { intent: "other", q: "ne yapmalı", relation: "own_topic", message: 2 },
      ])),
    ).toEqual([]);
    expect(answerableKinds(planOf("Havuz kaçta açılıyor?", [{ intent: "amenities", q: "havuz saatleri", relation: "own_topic" }], { earlierComplaint: true }))).toEqual(["amenities"]);
    // Bugünkü bir şikâyet bu soruları bağlardı (konusuz soru / şikâyette ev kuralı); ÖNCEKİ turun şikâyeti bağlamaz.
    expect(answerableKinds(planOf("Bir şey daha soracağım.", [{ intent: "other", q: "soru", relation: "own_topic" }], { earlierComplaint: true }))).toEqual(["other"]);
    expect(answerableKinds(planOf("Balkonda sigara içilebilir mi?", [{ intent: "house_rules", q: "balkonda sigara", relation: "own_topic" }], { earlierComplaint: true }))).toEqual(["house_rules"]);
  });

  it("KONTROL: ödeme talebi bağlayıcı DEĞİL (kurucu: şikâyet / iade / ev sahibi) — yanındaki konusuz soru bugünkü gibi cevaplanır", () => {
    const p = planOf("IBAN'ınızı atar mısınız? Bir de bir şey soracağım.", [
      { intent: "payment_invoice", q: "ödeme yöntemi", relation: "own_topic" },
      { intent: "other", q: "soru", relation: "own_topic" },
    ]);
    expect(answerableKinds(p)).toEqual(["other"]);
  });

  it("🚨 tehlike yalnız MESAJDA (sorgular temiz): 'Elektrik gitti; modemi nasıl resetleriz?' → çözüm de tutulur", () => {
    const p = planOf("Elektrik gitti; modemi nasıl resetleriz?", [
      { intent: "complaint_issue", q: "internet yok", relation: "own_topic" },
      { intent: "wifi", q: "modem yeniden başlatma", relation: "fix_request" },
    ]);
    expect(answerableKinds(p)).toEqual([]);
  });

  it("tehlikesiz cihaz arızası: 'Televizyon açılmıyor, nasıl açarız?' → çözüm cevaplanabilir", () => {
    const p = planOf("Televizyon açılmıyor, nasıl açarız?", [
      { intent: "complaint_issue", q: "televizyon açılmıyor", relation: "own_topic" },
      { intent: "appliance_help", q: "televizyon açma kumanda", relation: "fix_request" },
    ]);
    expect(answerableKinds(p)).toEqual(["appliance_help"]);
    expect(p.replyItems.answerable[0].fix).toBe(true);
  });

  it("aynı mesajda aynı türden iki istek bir öğe olur: en kısıtlayıcı işaret kalır (kendi konusu + devam → bağlı), sıradan bağımsız", () => {
    const complaint: Req = { intent: "complaint_issue", q: "klima bozuk", relation: "own_topic" };
    const own: Req = { intent: "wifi", q: "wifi şifresi", relation: "own_topic" };
    const follow: Req = { intent: "wifi", q: "wifi giderse ne yapmalı", relation: "follow_up" };
    const msg = "Klima bozuk. Wi-Fi şifresi neydi, Wi-Fi yine giderse ne yapalım?";
    expect(answerableKinds(planOf(msg, [complaint, own, follow]))).toEqual([]);
    expect(answerableKinds(planOf(msg, [complaint, follow, own]))).toEqual([]);
  });

  it("birleşen istekler: konular BİRLEŞİR (biri şikâyetin konusunu taşıyorsa bağlı), genel soru yalnız hepsi genelse, tehlike biri varsa", () => {
    // Konu birleşimi: ikinci sorgu yalnız "wifi" der ama birincisi klimayı (şikâyetin konusunu) taşır → bağlı.
    expect(
      answerableKinds(planOf("Klima bozuk. Klimanın Wi-Fi uygulaması ve Wi-Fi şifresi?", [
        { intent: "complaint_issue", q: "klima arızası", relation: "own_topic" },
        { intent: "wifi", q: "klima wifi uygulaması", relation: "own_topic" },
        { intent: "wifi", q: "wifi şifresi", relation: "own_topic" },
      ])),
    ).toEqual([]);
    // Genel soru: biri konulu-genel değil ("bilgi lazım"), sonraki genel ("ne yapmalı") → öğe genel SAYILMAZ (kendi konusu var).
    expect(
      answerableKinds(planOf("İade istiyorum. Havuz hakkında bilgi lazım; ne yapmalıyız?", [
        { intent: "cancellation_refund", q: "iade talebi", relation: "own_topic" },
        { intent: "amenities", q: "bilgi lazım", relation: "own_topic" },
        { intent: "amenities", q: "ne yapmalı", relation: "own_topic" },
      ])),
    ).toEqual(["amenities"]);
    // Tehlike: mesajda tehlike sözcüğü yok, ama birleşen sorgulardan biri kombiyi soruyor → çözüm tutulur (sıra fark etmez).
    for (const order of [0, 1]) {
      const fixes: Req[] = [
        { intent: "appliance_help", q: "kombi resetleme", relation: "fix_request" },
        { intent: "appliance_help", q: "televizyon açma", relation: "fix_request" },
      ];
      if (order) fixes.reverse();
      expect(
        answerableKinds(planOf("Cihaz çalışmıyor, nasıl resetleriz? Televizyon da açılmıyor.", [{ intent: "complaint_issue", q: "cihaz çalışmıyor", relation: "own_topic" }, ...fixes])),
        String(order),
      ).toEqual([]);
    }
  });

  it("🚨 olgusu bulunmayan aday (plan dışı girdi) 'belirsiz' sayılır → tutulur", () => {
    const turnItems = [
      { messageId: "m1", kind: "complaint_issue" as const, sensitivity: "sensitive" as const },
      { messageId: "m1", kind: "trash" as const, sensitivity: "none" as const },
    ];
    const relations = new Map([["m1\u0000complaint_issue", { relation: "own_topic" as const, topics: ["ac"], generic: false, hazard: false }]]);
    const p = composeItemsPlan({ turnItems, held: [{ ...turnItems[0], riskType: null }], hints: new Map(), relations });
    expect(p.answerable).toEqual([]);
  });

  it("KONTROL: bağlayıcı talep yokken işaret karar vermez (bugünkü davranış) — 'belirsiz' işaretli tek soru da cevaplanır", () => {
    expect(answerableKinds(planOf("Havuz kaçta açılıyor?", [{ intent: "amenities", q: "havuz saatleri", relation: "unclear" }]))).toEqual(["amenities"]);
  });
});

describe("kapı — hatalı 'bağımsız' işareti DOĞRUDAN verilse de bağlı istek tutulur (kurucu)", () => {
  const verdict = (over: Partial<SuggestReplyResult> = {}): SuggestReplyResult => ({
    intent: "general",
    confidence: 0.95,
    reply: "Çıkış için otopark kumandasının 2. tuşuna basın.",
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: ["kb:parking"],
    missingInfo: [],
    statedCheckoutTime: null,
    answeredRequests: { ok: true, refs: ["R1"] },
    ...over,
  });
  const complaint = { kind: "complaint_issue" as const, sensitivity: "sensitive" as const, riskType: null };
  const anchor = (topics: string[], hazard = false): AnchorFacts => ({ kind: "complaint_issue", topics, hazard });
  const req = (over: Partial<RequestFacts>): RequestFacts & { ref: string } => ({
    ref: "R1",
    kind: "parking",
    relation: "own_topic",
    topics: ["parking"],
    generic: false,
    hazard: false,
    recipe: true,
    ...over,
  });
  const gate = (requests: (RequestFacts & { ref: string })[], anchors: AnchorFacts[]) => ({
    items: { held: [complaint], paymentHeld: false, answerableKinds: requests.map((r) => r.kind), relation: { requests, anchors } },
  });
  const MSG = "Otopark kapısı açılmıyor, nasıl çıkacağız?";

  it("🚨 'kendi konusu' işaretli otopark sorusu + otopark şikâyeti → items_complaint_dependent", () => {
    expect(autoReplyGateVerdict(verdict(), MSG, gate([req({})], [anchor(["parking"])]))).toEqual({ reason: "blocked", detail: "items_complaint_dependent" });
  });
  it("🚨 konusuz genel takip sorusu ('kendi konusu' işaretli) → tutulur; belirsiz işaret → tutulur", () => {
    expect(autoReplyGateVerdict(verdict(), MSG, gate([req({ kind: "other", topics: [], generic: true })], [anchor(["noise"])]))?.detail).toBe("items_complaint_dependent");
    expect(autoReplyGateVerdict(verdict(), MSG, gate([req({ relation: "unclear", topics: ["trash"], kind: "trash" })], [anchor(["ac"])]))?.detail).toBe("items_complaint_dependent");
  });
  it("🚨 arıza çözümü bilgi tabanına dayanmıyor (kb: kaynağı yok) → items_fix_unverified", () => {
    expect(autoReplyGateVerdict(verdict({ usedSources: [] }), MSG, gate([req({ relation: "fix_request" })], [anchor(["parking"])]))?.detail).toBe("items_fix_unverified");
    expect(autoReplyGateVerdict(verdict({ usedSources: ["property:checkInTime"] }), MSG, gate([req({ relation: "fix_request" })], [anchor(["parking"])]))?.detail).toBe("items_fix_unverified");
  });
  it("🚨 karar 23 kör doğrulaması: tarifi OLMAYAN arıza çözümü doğrudan kapıya verilse de bağlı sayılır → items_complaint_dependent", () => {
    for (const recipe of [false, undefined]) {
      const r = req({ relation: "fix_request", recipe });
      expect(autoReplyGateVerdict(verdict(), MSG, gate([r], [anchor(["parking"])]))?.detail, String(recipe)).toBe("items_complaint_dependent");
    }
  });
  it("🚨 arıza çözümü cevabı tehlike sınıfına değiyor → items_fix_hazard", () => {
    const hot = verdict({ reply: "Kombinin altındaki sıfırlama düğmesine 5 saniye basılı tutun.", usedSources: ["kb:faq"] });
    expect(autoReplyGateVerdict(hot, MSG, gate([req({ kind: "appliance_help", relation: "fix_request", topics: [] })], [anchor([])]))?.detail).toBe("items_fix_hazard");
  });
  it("KONTROL: bilgi tabanına dayanan tehlikesiz çözüm ilişki kemerinden geçer; bağımsız çöp sorusu da", () => {
    const ok = autoReplyGateVerdict(verdict(), MSG, gate([req({ relation: "fix_request" })], [anchor(["parking"])]));
    expect(ok?.detail ?? "geçti").not.toMatch(/^items_/);
    const trash = verdict({ reply: "Çöp konteyneri binanın arka kapısının yanında.", usedSources: ["kb:trash"] });
    const t = autoReplyGateVerdict(trash, "Klima çalışmıyor; çöp konteyneri nerede?", gate([req({ kind: "trash", topics: ["trash"] })], [anchor(["ac"])]));
    expect(t?.detail ?? "geçti").not.toMatch(/^items_/);
  });
  it("KONTROL: işaret YOKKEN (ilişki bölümü yok) bugünkü liste kemeri aynen", () => {
    const answered = verdict({ reply: "Wi-Fi ağı Lale-5G.", usedSources: [] });
    expect(autoReplyGateVerdict(answered, MSG, { items: { held: [complaint], paymentHeld: false, answerableKinds: ["other"] } })?.detail).toBe("items_complaint_dependent");
    expect(autoReplyGateVerdict(answered, MSG, { items: { held: [complaint], paymentHeld: false, answerableKinds: ["wifi"] } })?.detail ?? "geçti").not.toBe("items_complaint_dependent");
  });
});

describe("karar fonksiyonu (saf)", () => {
  const a = (topics: string[], kind: ItemKind = "complaint_issue", hazard = false): AnchorFacts => ({ kind, topics, hazard });
  const r = (over: Partial<RequestFacts>): RequestFacts => ({ kind: "trash", relation: "own_topic", topics: ["trash"], generic: false, hazard: false, ...over });

  it("bağlayıcı talep yok → bağımsız; işaret ne olursa olsun", () => {
    for (const relation of ["own_topic", "fix_request", "follow_up", "unclear", undefined] as const) {
      expect(requestDependency(r({ relation }), [])).toBe("independent");
    }
  });
  it("kendi konusu: konu kesişimi / konusuz / şikâyette ev kuralı → bağlı; yoksa bağımsız", () => {
    expect(requestDependency(r({}), [a(["ac"])])).toBe("independent");
    expect(requestDependency(r({ topics: ["ac"] }), [a(["ac"])])).toBe("dependent");
    expect(requestDependency(r({ kind: "other", topics: [] }), [a([])])).toBe("dependent");
    expect(requestDependency(r({ kind: "amenities", topics: [], generic: true }), [a([])])).toBe("dependent");
    expect(requestDependency(r({ kind: "amenities", topics: [], generic: false }), [a([])])).toBe("independent");
    expect(requestDependency(r({ kind: "house_rules", topics: ["smoking"] }), [a(["ac"])])).toBe("dependent");
    expect(requestDependency(r({ kind: "house_rules", topics: ["smoking"] }), [a([], "cancellation_refund")])).toBe("independent");
  });
  it("arıza çözümü: yalnız şikâyet + cihaz / tesis türü + tehlike yok + bilgi tabanında TARİF var", () => {
    expect(requestDependency(r({ kind: "wifi", relation: "fix_request", topics: ["wifi"], recipe: true }), [a(["wifi"])])).toBe("fix");
    for (const kind of ["appliance_help", "access_keys", "parking", "amenities"] as ItemKind[]) {
      expect(requestDependency(r({ kind, relation: "fix_request", topics: [], recipe: true }), [a([])]), kind).toBe("fix");
    }
    // Karar 23 kör doğrulaması: tarif yok ya da bilinmiyor → bağlı (TUT).
    expect(requestDependency(r({ kind: "wifi", relation: "fix_request", topics: ["wifi"], recipe: false }), [a(["wifi"])])).toBe("dependent");
    expect(requestDependency(r({ kind: "wifi", relation: "fix_request", topics: ["wifi"] }), [a(["wifi"])])).toBe("dependent");
    expect(requestDependency(r({ kind: "wifi", relation: "fix_request" }), [a([], "human_request")])).toBe("dependent");
    expect(requestDependency(r({ kind: "trash", relation: "fix_request" }), [a([])])).toBe("dependent");
    expect(requestDependency(r({ kind: "wifi", relation: "fix_request", hazard: true }), [a([])])).toBe("dependent");
    expect(requestDependency(r({ kind: "wifi", relation: "fix_request" }), [a([], "complaint_issue", true)])).toBe("dependent");
  });
  it("devam / belirsiz / işaretsiz → bağlı", () => {
    for (const relation of ["follow_up", "unclear", undefined] as const) expect(requestDependency(r({ relation }), [a([])])).toBe("dependent");
  });
  it("birleşen aynı tür: en kısıtlayıcı işaret kalır; biri eksikse belirsiz", () => {
    expect(stricterRelation("own_topic", "fix_request")).toBe("fix_request");
    expect(stricterRelation("follow_up", "own_topic")).toBe("follow_up");
    expect(stricterRelation("unclear", "follow_up")).toBe("unclear");
    expect(stricterRelation("own_topic", undefined)).toBe("unclear");
    expect(stricterRelation(undefined, undefined)).toBeUndefined();
  });
  it("kapı kemeri: cevaplanmamış çözüm kaynak şartını tetiklemez", () => {
    const g = { requests: [{ ...r({ kind: "wifi", relation: "fix_request", topics: ["wifi"], recipe: true }), ref: "R1" }], anchors: [a(["wifi"])] };
    expect(relationGateHold(g, { text: "x", answeredRefs: [], usedSources: [] })).toBeNull();
    expect(relationGateHold(g, { text: "Modemin fişini 30 saniye çekip takın.", answeredRefs: ["R1"], usedSources: ["kb:wifi"] })).toBeNull();
  });
});

describe("bırakılan arızanın CİHAZI (kör set 5, 10-01 öğlen): plan çıkarır, kapı cevaba değmesini tutar", () => {
  it("🚨 tarifsiz arıza + bağımsız soru → planın kapı girdisi bırakılan cihazı taşır; cevaplanan isteğin konusu çıkarılır", () => {
    const p = planOf("Bulaşık makinesi programın ortasında durdu. Çıkış saati kaçta?", [
      { intent: "complaint_issue", q: "bulaşık makinesi programın ortasında durdu", relation: "own_topic" },
      { intent: "appliance_help", q: "bulaşık makinesi hata ışıkları", relation: "fix_request" },
      { intent: "checkout_time", q: "çıkış saati", relation: "own_topic" },
    ]);
    expect(answerableKinds(p)).toEqual(["checkout_time"]);
    expect(p.gateItems.heldDeviceTopics).toEqual(["dishwasher"]);
    // Tarifli arıza çözümü cevaplanınca o cihaz bırakılan sayılmaz (tarif kendi cihazına değinir).
    const fix = planOf("İnternet bir saattir yok.", [
      { intent: "complaint_issue", q: "internet yok", relation: "own_topic" },
      { intent: "wifi", q: "modem yeniden başlatma", relation: "fix_request" },
    ]);
    expect(fix.replyItems.answerable[0]).toMatchObject({ kind: "wifi", fix: true });
    expect(fix.gateItems).not.toHaveProperty("heldDeviceTopics");
  });
  it("cihaz yalnız BAĞLI istekte geçiyorsa da (şikâyetin sorgusu cihazsız) bırakılan sayılır", () => {
    // Mutasyon turu (10-01): şikâyetin kendi sorgusu cihazı taşıdığı için bağlı isteğin katkısı pinsizdi.
    const p = planOf("Çok rahatsız olduk, mikrodalga ısıtmıyor. Otopark yerimiz hangisi?", [
      { intent: "complaint_issue", q: "çok rahatsız olduk", relation: "own_topic" },
      { intent: "appliance_help", q: "mikrodalga ısıtmıyor nasıl düzelir", relation: "fix_request" },
      { intent: "parking", q: "otopark yeri", relation: "own_topic" },
    ]);
    expect(answerableKinds(p)).toEqual(["parking"]);
    expect(p.gateItems.heldDeviceTopics).toEqual(["microwave"]);
  });
  it("yalnız CİHAZ kavramı taşınır: gürültü şikâyeti + Wi-Fi sorusu → kapı girdisinde bırakılan cihaz yok", () => {
    const p = planOf("Gece gürültüden uyuyamadık. Wi-Fi şifresi neydi?", [
      { intent: "complaint_issue", q: "gece gürültü uyuyamadık", relation: "own_topic" },
      { intent: "wifi", q: "wifi şifresi", relation: "own_topic" },
    ]);
    expect(answerableKinds(p)).toEqual(["wifi"]);
    expect(p.gateItems).not.toHaveProperty("heldDeviceTopics");
  });
  it("liste kipinde de (işaret yok, bugünkü canlı yol) şikâyetin ipucu sorgusundan", () => {
    const turnItems = [
      { messageId: "m1", kind: "complaint_issue" as const, sensitivity: "sensitive" as const },
      { messageId: "m1", kind: "wifi" as const, sensitivity: "none" as const },
    ];
    const hints = new Map([
      ["m1\u0000complaint_issue", "mikrodalga ısıtmıyor"],
      ["m1\u0000wifi", "wifi şifresi"],
    ]);
    const p = composeItemsPlan({ turnItems, held: [{ ...turnItems[0], riskType: null }], hints });
    expect(p.gateItems.heldDeviceTopics).toEqual(["microwave"]);
  });
  it("cevap bırakılan cihaza değiniyor mu — yedi dilde cihaz adı; değmeyen cevap serbest", () => {
    expect(touchesHeldDevice(["dishwasher"], "Bulaşık makinesini kapatıp fişini 1 dakika çekin. Çıkış saati 11:00.")).toBe(true);
    expect(touchesHeldDevice(["microwave"], "Votre place est la P-14. Je n'ai pas de consigne pour le micro-ondes.")).toBe(true);
    expect(touchesHeldDevice(["coffee"], "Wenn die Kaffeemaschine laut pumpt, ist dazu keine Anleitung verfügbar.")).toBe(true);
    expect(touchesHeldDevice(["dishwasher"], "Çıkış saati 11:00; çıkarken kapıyı çekmeniz yeterli.")).toBe(false);
    expect(touchesHeldDevice([], "Bulaşık makinesini kapatın.")).toBe(false);
  });
});

describe("arıza TARİFİ kalemi (karar 23 kör doğrulaması, 10-01 öğlen)", () => {
  it("sorun giderme adımı taşıyan kalem tarif sayılır (yedi dil)", () => {
    for (const t of [
      "İnternet yoksa: modemin arkasındaki ON/OFF düğmesine basarak kapatın, 30 saniye bekleyip yeniden açın.",
      "Klima soğutmuyorsa kumandadaki MODE tuşuna basarak kar tanesi simgesini seçin.",
      "Tuş takımı kararmışsa avucunuzla tuş takımının tamamına 2 saniye dokunun.",
      "Otopark kapısı açılmıyorsa kumandanın büyük tuşuna 3 saniye basılı tutun.",
      "Wi-Fi'ye bağlanamıyorsanız telefonunuzda Lale_2G ağını seçin.",
      "If the TV shows 'No signal', press SOURCE and select HDMI 2.",
      "Router not working? Unplug it, wait 30 seconds and plug it back in.",
      "Bei Störungen den Router 30 Sekunden ausschalten und wieder einschalten.",
      "Si la télévision ne fonctionne pas, appuyez sur SOURCE.",
      "Si el router no funciona, apague el aparato y espere 30 segundos.",
      "Если роутер не работает, выключите его и подождите 30 секунд.",
      "إذا لم يعمل الراوتر اضغط على زر التشغيل وانتظر ثلاثين ثانية.",
    ]) {
      expect(isFixRecipeText(t), t).toBe(true);
    }
  });
  it("her işaret sınıfı TEK BAŞINA yeter (fiil yok): 'sıfırla' kökü · '-mıyorsa' başlığı · sorun giderme kalıbı", () => {
    // Mutasyon turu (10-01): üstteki cümlelerin hepsi bir fiil işareti de taşıdığı için kök / koşul / kalıp dalları pinsizdi.
    expect(isFixRecipeText("Modem ışıkları yanmazsa modemi sıfırlayın.")).toBe(true);
    expect(isFixRecipeText("Wi-Fi'ye bağlanamıyorsanız Lale_2G ağı da aynı şifreyle çalışır.")).toBe(true);
    expect(isFixRecipeText("Modemi yeniden başlatmanız yeterli olur.")).toBe(true);
    expect(isFixRecipeText("If the router is not working, the green light should be on.")).toBe(true);
    expect(isFixRecipeText("Если телевизор не работает, проверьте кабель HDMI.")).toBe(true);
  });
  it("yalnız bilgi veren kalem tarif DEĞİLDİR (kör set 4: kahve kapsülü, asansör, bulaşık tableti, ağ adı / şifre)", () => {
    for (const t of [
      "Mutfakta kapsüllü kahve makinesi var; ilk kutu kapsül bizden. Ek kapsülü marketten alabilirsiniz.",
      "Bina asansörlüdür. Daireniz 4. katta; asansörden çıkınca sağdaki kapı.",
      "Mutfakta bulaşık makinesi var; tabletler evyenin altındaki dolapta. Lütfen yalnızca bu tabletleri kullanın.",
      "Ağ adı: Lale_5G. Şifre: Lale2025.",
      "Daire kapısında tuşlu kilit var, kodunuz giriş günü gönderilir.",
      "Çıkış saati 11:00. Çıkarken klimayı ve ışıkları kapatın.",
      "The building has a lift; your flat is on the 4th floor.",
      "Coffee capsules are in the top drawer.",
      // Süre sözcüğü tek başına tarif değil.
      "Asansör kapısı 10 saniye sonra kendiliğinden kapanır.",
      "The beach is just 30 seconds from the building.",
    ]) {
      expect(isFixRecipeText(t), t).toBe(false);
    }
  });
  it("tarif konusu ÖNCE başlıktan: modem tarifindeki 'yeniden açın' klimayı, 'TV ünitesi' televizyonu konu yapmaz; başlık konusuzsa metnin tamamı", () => {
    const modem = {
      title: "İnternet yoksa: modemi yeniden başlatma",
      content: "Modem TV ünitesinin alt rafındadır. ON/OFF düğmesine basarak kapatın, 30 saniye bekleyip yeniden açın.",
    };
    expect([...kbRecipeTopics([modem])]).toEqual(["wifi"]);
    expect([...kbRecipeTopics([{ title: "Sık sorulanlar", content: "Klima soğutmuyorsa MODE tuşuna basın." }])]).toContain("ac");
    // Bilgi kalemi konu vermez.
    expect([...kbRecipeTopics([{ title: "Kahve makinesi", content: "Kapsüller üst çekmecede." }])]).toEqual([]);
  });
  it("tarif konusu yalnız CİHAZ / TESİS kavramı: 'Kapı kilidi ve tuş takımı' başlığı sözlükte 'taksi'ye iniyor → metindeki kilit kavramı alınır", () => {
    const keypad = {
      title: "Kapı kilidi ve tuş takımı",
      content: "Daire kapısında şifreli kilit var. Tuş takımı kararmışsa avucunuzla tuş takımının tamamına 2 saniye dokunun.",
    };
    const topics = [...kbRecipeTopics([keypad])];
    expect(topics).toContain("keys");
    expect(topics).not.toContain("taxi");
    // Başlıkta cihaz varsa metnin yan kavramları eklenmez (modem tarifi televizyon / klima tarifi sayılmaz).
    expect([...kbRecipeTopics([{ title: "Klima", content: "Soğutmazsa MODE tuşuna basın; TV ünitesinin yanındaki askıda kumanda var." }])]).toEqual(["ac"]);
  });
});

describe("konu kavramları ve genel takip sorusu", () => {
  it("konular getirme sözlüğünden; genel kavramlar (şifre / tavsiye / kural) konu sayılmaz", () => {
    expect(topicsOf("çöp konteyneri yeri")).toEqual(["trash"]);
    expect(topicsOf("otopark kapısı açılmıyor")).toContain("parking");
    expect(topicsOf("klima çalışmıyor")).toEqual(["ac"]);
    expect(topicsOf("wifi şifresi")).toEqual(["wifi"]);
    expect(topicsOf("kapı kodu şifre")).not.toContain("credentials");
    expect(requestTopics("ne zaman", "when", "parking")).toEqual(["parking"]);
    expect(requestTopics("Parkplatz", "Parkplatz", "other")).toContain("parking");
  });
  it("genel takip sorusu yedi dilde; konulu soru genel değil", () => {
    for (const q of ["tekrar olursa ne yapmalı", "ne yapmalıyız", "ne olacak şimdi", "what should we do", "was sollen wir tun", "que faire", "qué hacemos", "что делать", "ماذا نفعل"]) {
      expect(isGenericFollowup(q), q).toBe(true);
    }
    for (const q of ["çöp konteyneri yeri", "wifi şifresi", "where is the trash"]) expect(isGenericFollowup(q), q).toBe(false);
  });
});

describe("tehlike sınıfı (kurucu: elektrik / gaz / sıcak su cihazı çözüm istisnasına girmez)", () => {
  it("yedi dilde tehlikeli adım / konu", () => {
    for (const t of [
      "Sigortayı kaldırın.",
      "Elektrik panosundaki şalteri kapatın.",
      "Kombinin sıfırlama düğmesine basın.",
      "Şofbenin düğmesini çevirin.",
      "Termosifonu açın.",
      "Doğalgaz vanasını kontrol edin.",
      "Gaz kokusu varsa çıkın.",
      "Sıcak su cihazının kapağını açın.",
      "Duman çıkıyorsa",
      "Yangın merdiveninden çıkın.",
      "Reset the breaker in the fuse box.",
      "Relight the pilot light on the boiler.",
      "Check the water heater.",
      "Die Sicherung im Sicherungskasten wieder einschalten.",
      "Die Therme neu starten.",
      "Réarmez le disjoncteur.",
      "Redémarrez la chaudière.",
      "Reinicie la caldera.",
      "Suba el diferencial del cuadro eléctrico.",
      "Включите автомат в щитке.",
      "Перезапустите котёл.",
      "أعد تشغيل السخان.",
      "ارفع قاطع الكهرباء في اللوحة.",
    ]) {
      expect(fixHazard(t), t).toBe(true);
    }
  });
  it("KONTROL: tehlikesiz adımlar tutulmaz (modem / priz / fiş / kumanda / güç düğmesi / su ısıtıcısı / gazete / mağaza)", () => {
    for (const t of [
      "Modemin fişini prizden çekip 30 saniye sonra takın.",
      "Unplug the router for 30 seconds and plug it back in.",
      "Klimanın kumandasında MODE tuşuna basın.",
      "Turn the TV off and on with the power button.",
      "Gazete bayisi köşede.",
      "Mağaza 22:00'ye kadar açık.",
      "Gazipaşa otobüsü meydandan kalkar.",
      "Çöp konteyneri binanın arkasında.",
      "Otopark kumandasının 2. tuşuna basın.",
      // ASCII katlamada "açılmıyor … çıkacağız" yangın kavramının "acil çıkış" kalıbına iniyordu — yangın kavramı bu yüzden açık sözlükten.
      "Otopark kapısı açılmıyor, nasıl çıkacağız?",
      // "Strom / luz / كهرباء" yabancı sözlükte elektrik kavramıdır ama burada modem tarifi — tehlike değil.
      "Den Router für 30 Sekunden vom Strom trennen.",
      "Débranchez la box internet pendant 30 secondes.",
      "Si la luz del router parpadea, desenchúfelo 30 segundos.",
      "Отключите роутер от розетки на 30 секунд.",
      "افصل الراوتر عن الكهرباء لمدة 30 ثانية.",
    ]) {
      expect(fixHazard(t), t).toBe(false);
    }
  });
});

describe("tehlike sınıfı — bilinen temkinli tutuş", () => {
  it("'su ısıtıcısı' çaydanlık da sıcak su cihazı da olabilir → tehlike sayılır (yanlış tutuş güvenli yön)", () => {
    expect(fixHazard("Su ısıtıcısı mutfak tezgâhında.")).toBe(true);
  });
});

describe("anlama şeması / istem — ilişki kipi yalnız öğe kipi + şikâyet takibi birlikte", () => {
  it("öğe kipi + takip → istek başına zorunlu 'relation' (kapalı küme); diğer birleşimlerde şema bayt bayt eskisi", () => {
    const s = understandingSchemaFor({ items: true, followup: true });
    const item = s.schema.properties.requests.items as unknown as { required: string[]; properties: Record<string, { enum?: string[] }> };
    expect(item.required).toContain("relation");
    expect(item.properties.relation.enum).toEqual(["own_topic", "fix_request", "follow_up", "unclear"]);
    expect(understandingSchemaFor({ items: true })).toBe(understandingSchemaFor({ items: true, followup: false }));
    expect(understandingSchemaFor({ followup: true })).toBe(understandingSchemaFor({}));
    const both = understandingSchemaFor({ items: true, rules: true, followup: true }).schema.properties.requests.items as unknown as { required: string[] };
    expect(both.required).toEqual(expect.arrayContaining(["rule_topic", "rule_stance", "relation", "message"]));
  });
  it("çözücü: tanınan işaret aynen; eksik / tanınmayan → 'unclear'; ilişki kipi kapalıyken alan YOK", () => {
    const raw = (relation?: unknown) => ({
      language: "tr",
      requests: [{ intent: "wifi", query_tr: "wifi", query_original: "wifi", message: 1, ...(relation !== undefined ? { relation } : {}) }],
      stay_change: STAY_NONE,
      withdrawn: [],
    });
    expect(parseUnderstanding(raw("fix_request"), { items: true, followup: true })?.requests[0].relation).toBe("fix_request");
    expect(parseUnderstanding(raw(), { items: true, followup: true })?.requests[0].relation).toBe("unclear");
    expect(parseUnderstanding(raw("bağımsız"), { items: true, followup: true })?.requests[0].relation).toBe("unclear");
    expect(parseUnderstanding(raw("own_topic"), { items: true })?.requests[0]).not.toHaveProperty("relation");
    expect(parseUnderstanding(raw("own_topic"), { followup: true })?.requests[0]).not.toHaveProperty("relation");
  });
});

describe("cevap modelinin öğe bloğu — arıza çözümü işareti", () => {
  it("çözüm yokken blok bayt bayt eskisi; çözüm varken satır işareti + tek kural paragrafı", () => {
    const plain = buildItemsPromptBlock({ answerable: [{ ref: "R1", kind: "wifi", hint: "wifi şifresi" }], held: [{ kind: "complaint_issue" }] });
    expect(plain).not.toContain("ARIZA ÇÖZÜMÜ");
    expect(buildItemsPromptBlock({ answerable: [{ ref: "R1", kind: "wifi", hint: "wifi şifresi", fix: false }], held: [{ kind: "complaint_issue" }] })).toBe(plain);
    const fixed = buildItemsPromptBlock({ answerable: [{ ref: "R1", kind: "wifi", hint: "modem yeniden başlatma", fix: true }], held: [{ kind: "complaint_issue" }] });
    expect(fixed).toContain('  - R1 · Wi-Fi · "modem yeniden başlatma" · ARIZA ÇÖZÜMÜ');
    expect(fixed).toContain("YALNIZ bilgi tabanında yazan adımları ver");
    expect(fixed).toContain("CEVAPLAMA (answeredRequests'e koyma)");
    expect(fixed.startsWith(plain.slice(0, plain.indexOf("  - R1")))).toBe(true);
  });
});
