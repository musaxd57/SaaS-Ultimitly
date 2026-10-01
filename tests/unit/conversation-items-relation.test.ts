import { describe, it, expect } from "vitest";
import { parseUnderstanding, understandingSchemaFor } from "@/lib/ai/semantic/understanding-schema";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { composeItemsPlan, relationFactsOf } from "@/lib/conversation-items/plan";
import { buildItemsPromptBlock } from "@/lib/conversation-items/reply-block";
import {
  fixHazard,
  isGenericFollowup,
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
function planOf(bodies: string | string[], requests: Req[], opts: { followup?: boolean; earlierComplaint?: boolean } = {}) {
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
  return composeItemsPlan({ turnItems, held, hints: new Map(), ...(relations ? { relations } : {}) });
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
    expect(p.gateItems.relation?.requests[0]).toMatchObject({ ref: "R1", relation: "fix_request" });
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
  it("arıza çözümü: yalnız şikâyet + cihaz / tesis türü + tehlike yok", () => {
    expect(requestDependency(r({ kind: "wifi", relation: "fix_request", topics: ["wifi"] }), [a(["wifi"])])).toBe("fix");
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
    const g = { requests: [{ ...r({ kind: "wifi", relation: "fix_request", topics: ["wifi"] }), ref: "R1" }], anchors: [a(["wifi"])] };
    expect(relationGateHold(g, { text: "x", answeredRefs: [], usedSources: [] })).toBeNull();
    expect(relationGateHold(g, { text: "Modemin fişini 30 saniye çekip takın.", answeredRefs: ["R1"], usedSources: ["kb:wifi"] })).toBeNull();
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
    for (const q of ["tekrar olursa ne yapmalı", "ne olacak şimdi", "what should we do", "was sollen wir tun", "que faire", "qué hacemos", "что делать", "ماذا نفعل"]) {
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
