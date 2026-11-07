import { describe, it, expect } from "vitest";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { composeItemsPlan, relationFactsOf } from "@/lib/conversation-items/plan";
import { moneyRequest, relationGateHold, requestDependency, type AnchorFacts, type RequestFacts } from "@/lib/conversation-items/relation";
import { autoReplyGateVerdict } from "@/lib/automation";
import type { SuggestReplyResult } from "@/lib/ai/types";
import type { ItemKind } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// ÜCRET SORUSU ARIZA ÇÖZÜMÜ DEĞİLDİR (kör set 7 k7-22, 10-02 gece — aday GÖNDERDİ, 5.1 yalnız cevabındaki devir cümlesi yüzünden
// tutuldu). Misafir: "İlanda otopark dahil yazıyordu, resepsiyonda ayrıca ücret aldılar, paramızı geri verin." Anlama katmanı şikâyet + iade
// + "otopark ücrete dahil mi" isteğini çıkardı ve sonuncusunu "arıza çözümü" (fix_request) işaretledi; bilgi tabanında otopark kapısının
// tarifi olduğu için plan isteği ÇÖZÜM saydı, kapı yalnız `kb:` kaynağı ve tehlikeye baktığı için misafire "Otopark ayrıca ücretli: günlük
// 200 TL" GİTTİ — iade talebine cevap gibi okunan, ev sahibinin kararını önceden veren bir para cümlesi. Kurucu 18 "a": çözüm = cihaz /
// tesis ARIZASININ onaylı tarifi. İki kemer (yalnız ilişki kipinde; yalnız sıkılaştırır):
//  1. İstek: ücret / fiyat / ödeme soran istek çözüm olarak sunulmaz (bağlı → ev sahibinde).
//  2. Cevap: çözüm olarak cevaplanan istekte tutar / muafiyet varsa cevap GİTMEZ (`items_fix_money`) — 132 gerçek tarif cevabında 0.
// ---------------------------------------------------------------------------

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
type Req = { intent: ItemKind; q: string; qo?: string; relation: string };

/** Ürün zinciri: anlama çıktısı → öğeler (gerçek kelime ağı) → plan. Bilgi tabanında otopark kapısının TARİFİ var. */
function planOf(body: string, requests: Req[]) {
  const u = parseUnderstanding(
    {
      language: "ru",
      requests: requests.map((r) => ({ intent: r.intent, query_tr: r.q, query_original: r.qo ?? r.q, message: 1, relation: r.relation })),
      stay_change: STAY_NONE,
      withdrawn: [],
    },
    { items: true, followup: true },
  );
  const ex = extractTurnItems({ history: [{ id: "m1", direction: "inbound", body }], guestMessage: body, understanding: u });
  if (ex.mode !== "items") throw new Error(`tur bölünmedi: ${ex.reason}`);
  const turnItems = ex.messages.flatMap((m) => m.items.map((it) => ({ messageId: m.messageId, kind: it.kind, sensitivity: it.sensitivity })));
  const held = turnItems.filter((i) => i.sensitivity === "sensitive").map((i) => ({ ...i, riskType: null }));
  const relations = relationFactsOf(ex.messages);
  return composeItemsPlan({ turnItems, held, hints: new Map(), ...(relations ? { relations, kbRecipeTopics: new Set(["parking"]) } : {}) });
}

const K722 =
  "Здравствуйте. В объявлении было написано, что парковка входит в стоимость, а на ресепшене с нас взяли отдельную плату. " +
  "Пожалуйста, верните нам эти деньги.";
const COMPLAINT: Req = { intent: "complaint_issue", q: "ilanda otopark dahil denmişti ama ayrıca ücret alındı", relation: "own_topic" };
const REFUND: Req = { intent: "cancellation_refund", q: "otopark ücreti iade talebi", qo: "возврат денег за парковку", relation: "own_topic" };

describe("ücret sorusu arıza çözümü değildir — plan (ürün zinciri)", () => {
  it("🚨 k7-22: şikâyet + iade + 'otopark ücrete dahil mi' (model: arıza çözümü) → hiçbir şey cevaplanabilir DEĞİL", () => {
    const p = planOf(K722, [
      COMPLAINT,
      REFUND,
      { intent: "parking", q: "otopark ücreti dahil mi", qo: "парковка входит в стоимость", relation: "fix_request" },
    ]);
    expect(p.answerable).toEqual([]);
    expect(p.allHeld).toBe(true);
    expect(p.replyItems.held.map((h) => h.kind)).toEqual(["complaint_issue", "cancellation_refund", "parking"]);
  });

  it("KONTROL (ikiz): aynı turda otopark KAPISI arızasının tarif isteği çözüm olarak cevaplanabilir kalır", () => {
    const p = planOf("Otopark kapısı açılmıyor, nasıl çıkacağız?", [
      { intent: "complaint_issue", q: "otopark kapısı açılmıyor", relation: "own_topic" },
      { intent: "parking", q: "otopark kapısı nasıl açılır", relation: "fix_request" },
    ]);
    expect(p.answerable.map((a) => a.item.kind)).toEqual(["parking"]);
    expect(p.replyItems.answerable[0]).toMatchObject({ kind: "parking", fix: true });
  });

  it("aynı türden iki istek birleşir: biri para sorusuysa birleşik öğe de çözüm olarak sunulmaz (sırası fark etmez)", () => {
    const fee: Req = { intent: "parking", q: "otopark ücreti dahil mi", relation: "fix_request" };
    const gate: Req = { intent: "parking", q: "otopark kapısı nasıl açılır", relation: "fix_request" };
    const complaint: Req = { intent: "complaint_issue", q: "otopark kapısı açılmıyor", relation: "own_topic" };
    expect(planOf("Otopark kapısı açılmıyor; otopark ücrete dahil mi?", [complaint, fee, gate]).answerable).toEqual([]);
    expect(planOf("Otopark kapısı açılmıyor; otopark ücrete dahil mi?", [complaint, gate, fee]).answerable).toEqual([]);
  });

  it("para sinyali yalnız özgün dildeki sorguda (tutar / 'ücretsiz') olsa da çözüm sunulmaz", () => {
    for (const qo of ["Is parking free of charge?", "Is it 200 TL per day?"]) {
      const p = planOf("The parking gate charged us again.", [
        { intent: "complaint_issue", q: "otopark kapısı sorunu", relation: "own_topic" },
        { intent: "parking", q: "otopark kapısı durumu", qo, relation: "fix_request" },
      ]);
      expect(p.answerable, qo).toEqual([]);
    }
  });
});

describe("karar fonksiyonu (saf) — para isteği", () => {
  const r = (over: Partial<RequestFacts>): RequestFacts => ({
    kind: "parking",
    relation: "fix_request",
    topics: ["parking"],
    generic: false,
    hazard: false,
    recipe: true,
    ...over,
  });
  const a = (kind: ItemKind = "complaint_issue"): AnchorFacts => ({ kind, topics: ["parking"], hazard: false });

  it("🚨 arıza çözümü işaretli PARA isteği bağlıdır; para işareti yoksa (ikiz) çözüm", () => {
    expect(requestDependency(r({ money: true }), [a()])).toBe("dependent");
    expect(requestDependency(r({ money: false }), [a()])).toBe("fix");
    expect(requestDependency(r({}), [a()])).toBe("fix");
  });
  it("bağlayıcı talep yoksa para isteği bugünkü gibi bağımsız (kural yalnız bağlayıcı talepli turda)", () => {
    expect(requestDependency(r({ money: true, relation: "own_topic" }), [])).toBe("independent");
  });
});

describe("para sorusu tanıyıcı (Türkçe anlama sorgusu + özgün dilde tutar / muafiyet)", () => {
  // Her alternatif TEK BAŞINA bir vakada (mutasyon: bir alternatif silinince en az bir vaka düşer).
  it.each([
    ["otopark ücreti dahil mi", ""],
    ["ödeme nasıl yapılır", ""],
    ["fiyat ne kadar", ""],
    ["resepsiyonda paramızı aldılar", ""],
    ["fazladan ödedik", ""],
    ["kim ödeyecek", ""],
    ["ödenmesi gerekiyor mu", ""],
    ["fatura kesilir mi", ""],
    ["depozito ne zaman iade edilir", ""],
    ["kaporanın durumu", ""],
    ["indirim yapılır mı", ""],
    ["tazminat talebi", ""],
    ["bedeli nedir", ""],
    ["maliyeti kim karşılar", ""],
    ["otopark durumu", "otopark ücreti ne kadar"],
    ["otopark durumu", "Is parking free of charge?"],
    ["otopark durumu", "They charged us 200 TL"],
  ])("para: %s | %s", (tr, orig) => {
    expect(moneyRequest(tr, orig)).toBe(true);
  });

  it.each([
    ["televizyonda parazit var", ""],
    ["paravan nerede", ""],
    ["odun sobası nasıl yakılır", ""],
    ["ödünç ütü var mı", ""],
    ["otopark kapısı açılmıyor", ""],
    ["kumandanın pili bitti", ""],
    ["modem ışığı turuncu yanıp sönüyor", ""],
    ["telefonu nereden şarj ederiz", "Where can we charge the phone?"],
    ["anahtarı nereye bırakalım", "Where do we return the key?"],
  ])("para değil: %s | %s", (tr, orig) => {
    expect(moneyRequest(tr, orig)).toBe(false);
  });
});

describe("kapı — çözüm cevabında tutar (ikinci kemer)", () => {
  const anchors: AnchorFacts[] = [{ kind: "complaint_issue", topics: ["parking"], hazard: false }];
  const fixReq = { ref: "R1", kind: "parking" as const, relation: "fix_request" as const, topics: ["parking"], generic: false, hazard: false, recipe: true };

  it("🚨 'çözüm' diye cevaplanan istekte tutar → items_fix_money (k7-22'nin gönderilen cevabı)", () => {
    const text = "Парковка оплачивается отдельно: крытая парковка стоит 200 TL в день.";
    expect(relationGateHold({ requests: [fixReq], anchors }, { text, answeredRefs: ["R1"], usedSources: ["kb:parking"] })).toBe("items_fix_money");
    expect(
      relationGateHold({ requests: [fixReq], anchors }, { text: "Parking is free of charge for you.", answeredRefs: ["R1"], usedSources: ["kb:parking"] }),
    ).toBe("items_fix_money");
  });
  it("🚨 kör set 8 k8-37: çözüm + BAĞIMSIZ soru birlikte cevaplandı, para yalnız bağımsız sorunun cümlesinde ('ücretsiz') → GEÇER", () => {
    // İki model de bu doğru cevabı veriyordu; ilk sürüm bütün metinde para aradığı için "es gratuita" yüzünden tutuyordu.
    const stoveFix = { ref: "R1", kind: "appliance_help" as const, relation: "fix_request" as const, topics: ["stove"], generic: false, hazard: false, recipe: true };
    const parkingQ = { ref: "R2", kind: "parking" as const, relation: "own_topic" as const, topics: ["parking"], generic: false, hazard: false };
    const stoveComplaint: AnchorFacts[] = [{ kind: "complaint_issue", topics: ["stove"], hazard: false }];
    const text =
      "Hola Alex, si la hora parpadea en la pantalla, pulse CLOCK, ajuste la hora con los botones + y – y vuelva a pulsar CLOCK. " +
      "Después, gire el selector de programa al modo que desee. Su plaza de aparcamiento es la L4, en el aparcamiento al aire libre de " +
      "la calle trasera del edificio; es gratuita.";
    expect(
      relationGateHold({ requests: [stoveFix, parkingQ], anchors: stoveComplaint }, { text, answeredRefs: ["R1", "R2"], usedSources: ["kb:faq", "kb:parking"] }),
    ).toBeNull();
    // Türkçe ikiz: çözüm cümlesi (fırın) parasız, para bağımsız sorunun cümlesinde.
    const tr = "Fırının saatini CLOCK tuşuyla ayarlayın. Otopark yeriniz L4, ücretsiz.";
    expect(
      relationGateHold({ requests: [stoveFix, parkingQ], anchors: stoveComplaint }, { text: tr, answeredRefs: ["R1", "R2"], usedSources: ["kb:faq", "kb:parking"] }),
    ).toBeNull();
  });
  it("yalnız çözüm cevaplandıysa para, çözümün konusunu anmasa da tutulur (bütün metin)", () => {
    const text = "Kumandanın 2. tuşuna 3 saniye basılı tutun. Ek hizmet ücreti 50 TL.";
    expect(relationGateHold({ requests: [fixReq], anchors }, { text, answeredRefs: ["R1"], usedSources: ["kb:parking"] })).toBe("items_fix_money");
  });
  it("🚨 çözüm + bağımsız soru cevaplandı ama para ÇÖZÜMÜN konusunda (aynı cümle / konusuz devam cümlesi) → items_fix_money", () => {
    const wifiQ = { ref: "R2", kind: "wifi" as const, relation: "own_topic" as const, topics: ["wifi"], generic: false, hazard: false };
    for (const text of [
      "Otopark ayrıca ücretli; günlük 200 TL. Wi-Fi ağı Lale-5G.",
      "Otopark ayrıca ücretlidir. Günlük 200 TL'dir. Wi-Fi ağı Lale-5G.",
      "Wi-Fi ağı Lale-5G. Otopark ayrıca ücretlidir, günlük 200 TL.",
    ]) {
      expect(
        relationGateHold({ requests: [fixReq, wifiQ], anchors }, { text, answeredRefs: ["R1", "R2"], usedSources: ["kb:parking", "kb:wifi"] }),
        text,
      ).toBe("items_fix_money");
    }
  });
  it("KONTROL: tutarsız gerçek tarif geçer; çözüm cevaplanmadıysa (R1 beyan edilmedi) kemer koşmaz", () => {
    const recipe = "Kapı açılmazsa kumandanın 2. tuşuna 3 saniye basılı tutun.";
    expect(relationGateHold({ requests: [fixReq], anchors }, { text: recipe, answeredRefs: ["R1"], usedSources: ["kb:parking"] })).toBeNull();
    expect(
      relationGateHold({ requests: [fixReq], anchors }, { text: "Günlük 200 TL.", answeredRefs: [], usedSources: ["kb:parking"] }),
    ).toBeNull();
  });
  it("kapı kararı uçtan uca: tutarlı çözüm cevabı GİTMEZ, ayrıntı items_fix_money", () => {
    const result: SuggestReplyResult = {
      intent: "parking",
      confidence: 0.95,
      reply: "Парковка оплачивается отдельно: крытая парковка стоит 200 TL в день.",
      risk: null,
      priority: "standard",
      source: "openai",
      actionSuggestion: null,
      riskLevel: "none",
      detectedLanguage: "ru",
      riskType: null,
      usedSources: ["kb:parking"],
      missingInfo: [],
      statedCheckoutTime: null,
      answeredRequests: { ok: true, refs: ["R1"] },
    };
    const v = autoReplyGateVerdict(result, K722, {
      items: {
        held: [{ kind: "complaint_issue", sensitivity: "sensitive", riskType: null }],
        paymentHeld: false,
        answerableKinds: ["parking"],
        relation: { requests: [fixReq], anchors },
      },
    });
    expect(v).toEqual({ reason: "blocked", detail: "items_fix_money" });
  });
});
