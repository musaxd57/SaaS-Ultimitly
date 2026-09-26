import { describe, it, expect } from "vitest";
import {
  ITEM_KINDS,
  ITEM_SENSITIVITIES,
  ITEM_STATUSES,
  buildItemsForMessage,
  buildLexicalItems,
  kindForLabel,
  mergeItemFacts,
  effectiveStatus,
  hasEmergency,
  isItemKind,
  isItemSensitivity,
  isItemStatus,
  isOpenForHost,
  labelsHoldWholeTurn,
  maySupersede,
  nextStatus,
  replyRiskAttributable,
  unattributedModelItems,
  type BuiltItem,
  type ItemEvent,
  type ItemSensitivity,
  type ItemStatus,
} from "@/lib/conversation-items/core";
import { UNDERSTANDING_INTENTS, type UnderstandingIntent } from "@/lib/ai/semantic/understanding-schema";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — saf çekirdek (kurucu kararları 09-26; tasarım `docs/TASARIM-2026-09-26-konusma-ogeleri.md`).
// "Eski cevapsız gerçek risk yeni mesaj tarafından KAYBOLMAMALI, fakat bütün konuşmayı BLOKE ETMEMELİ" — risk öğe
// başına tutulur; birleşim değişmezi öğe kapsamında; hassas öğe yapay zekânın cevabıyla kapanmaz.
// ---------------------------------------------------------------------------

const req = (...intents: UnderstandingIntent[]) => intents.map((intent) => ({ intent }));
const pick = (items: BuiltItem[]) => items.map((i) => [i.requestIndex, i.kind, i.sensitivity, i.riskType]);

describe("kapalı kümeler", () => {
  it("öğe türü = anlama katmanının niyet kümesi (tek kaynak)", () => {
    expect([...ITEM_KINDS]).toEqual([...UNDERSTANDING_INTENTS]);
    expect(isItemKind("payment_invoice")).toBe(true);
    expect(isItemKind("iban")).toBe(false);
  });
  it("durum ve hassaslık kümeleri; 'ev sahibi yazdı' SAKLANAN bir durum değil", () => {
    expect([...ITEM_STATUSES]).toEqual(["open", "pending_host", "answered", "withdrawn", "superseded", "done"]);
    expect([...ITEM_SENSITIVITIES]).toEqual(["none", "sensitive", "emergency"]);
    expect(isItemStatus("host_replied")).toBe(false);
    expect(isItemStatus("pending_host")).toBe(true);
    expect(isItemStatus(3)).toBe(false);
    expect(isItemSensitivity("emergency")).toBe(true);
    expect(isItemSensitivity("high")).toBe(false);
  });
});

describe("öğe çıkarımı — birleşim değişmezi ÖĞE kapsamında", () => {
  it("IBAN + Wi-Fi aynı mesajda: yalnız ödeme öğesi hassas, Wi-Fi cevaplanabilir", () => {
    const items = buildItemsForMessage({ requests: req("wifi", "payment_invoice"), lexicalLabels: ["platform_policy"] });
    expect(pick(items)).toEqual([
      [0, "wifi", "none", null],
      [1, "payment_invoice", "sensitive", "platform_policy"],
    ]);
    expect(items[1].sources).toEqual(["understanding", "lexical"]);
    expect(items[0].sources).toEqual(["understanding"]);
  });

  it("etiket hiçbir isteğe atfedilemezse mesajın TAMAMI hassas (bir katmanın 'istek yok'u ötekini silemez)", () => {
    const items = buildItemsForMessage({ requests: req("wifi", "parking"), lexicalLabels: ["platform_policy"] });
    expect(pick(items)).toEqual([
      [0, "wifi", "sensitive", "platform_policy"],
      [1, "parking", "sensitive", "platform_policy"],
    ]);
  });

  it("anlama katmanı istek görmediyse yalnız kelime ağının öğeleri (etiket yoksa öğe yok)", () => {
    expect(buildItemsForMessage({ requests: [], lexicalLabels: [] })).toEqual([]);
    const flagged = buildItemsForMessage({ requests: [], lexicalLabels: ["complaint"] });
    expect(pick(flagged)).toEqual([[0, "complaint_issue", "sensitive", "complaint"]]);
    expect(flagged[0].sources).toEqual(["lexical"]);
  });

  it("yalnız kelime ağı: her etiket kendi türünde; aynı türe düşenler birleşir; eşlemesiz etiket 'other'", () => {
    expect(pick(buildLexicalItems(["complaint", "platform_policy", "review_threat", "discrimination", "safety_emergency"]))).toEqual([
      [0, "complaint_issue", "sensitive", "complaint"],
      [1, "payment_invoice", "sensitive", "platform_policy"],
      [2, "other", "sensitive", "discrimination"],
      [3, "emergency", "emergency", "safety_emergency"],
    ]);
    expect(buildLexicalItems([])).toEqual([]);
  });

  it("etiketten tür: ilk yakın tür; eşlemesiz → other", () => {
    expect(kindForLabel("complaint")).toBe("complaint_issue");
    expect(kindForLabel("refund")).toBe("cancellation_refund");
    expect(kindForLabel("money_refund")).toBe("cancellation_refund");
    expect(kindForLabel("early_departure")).toBe("cancellation_refund");
    expect(kindForLabel("platform_policy")).toBe("payment_invoice");
    expect(kindForLabel("safety_emergency")).toBe("emergency");
    expect(kindForLabel("human_request")).toBe("human_request");
    expect(kindForLabel("prompt_injection")).toBe("other");
  });

  it("aynı türden iki istek TEK öğe (bir mesajda her tür bir kez), ilk sıra kalır", () => {
    expect(pick(buildItemsForMessage({ requests: req("wifi", "wifi", "parking"), lexicalLabels: [] }))).toEqual([
      [0, "wifi", "none", null],
      [2, "parking", "none", null],
    ]);
  });

  it("🚨 ödeme / fatura isteği kelime ağı OLMADAN da hassas (kurucu 09-26 'Evet, hepsi size' — her dilde)", () => {
    // "Could you send me your IBAN?" / "Kalan tutarı nakit ödeyebilir miyim?" kelime ağına takılmıyordu (ölçüm 09-26).
    expect(pick(buildItemsForMessage({ requests: req("payment_invoice", "wifi"), lexicalLabels: [] }))).toEqual([
      [0, "payment_invoice", "sensitive", null],
      [1, "wifi", "none", null],
    ]);
    // Tutulan ödeme öğesi modelin ödeme etiketini karşılar (güvenli Wi-Fi cevabı bu yüzden tutulmaz).
    expect(replyRiskAttributable("platform_policy", buildItemsForMessage({ requests: req("payment_invoice"), lexicalLabels: [] }))).toBe(true);
  });

  it("anlama katmanının kendi hassas niyeti kelime ağı olmadan da hassastır", () => {
    const items = buildItemsForMessage({ requests: req("complaint_issue", "parking", "cancellation_refund", "human_request"), lexicalLabels: [] });
    expect(pick(items)).toEqual([
      [0, "complaint_issue", "sensitive", null],
      [1, "parking", "none", null],
      [2, "cancellation_refund", "sensitive", null],
      [3, "human_request", "sensitive", null],
    ]);
  });

  it("acil: niyet acilse öğe acil; acil etiketi atfedilemezse mesajın tamamı acil", () => {
    expect(pick(buildItemsForMessage({ requests: req("emergency", "wifi"), lexicalLabels: [] }))).toEqual([
      [0, "emergency", "emergency", null],
      [1, "wifi", "none", null],
    ]);
    expect(pick(buildItemsForMessage({ requests: req("emergency", "wifi"), lexicalLabels: ["safety_emergency"] }))).toEqual([
      [0, "emergency", "emergency", "safety_emergency"],
      [1, "wifi", "none", null],
    ]);
    expect(pick(buildItemsForMessage({ requests: req("wifi"), lexicalLabels: ["safety_emergency"] }))).toEqual([
      [0, "wifi", "emergency", "safety_emergency"],
    ]);
  });

  it("birden çok etiket kendi öğesine gider; ilgisiz öğe hassas olmaz", () => {
    const items = buildItemsForMessage({
      requests: req("complaint_issue", "payment_invoice", "wifi"),
      lexicalLabels: ["complaint", "platform_policy"],
    });
    expect(pick(items)).toEqual([
      [0, "complaint_issue", "sensitive", "complaint"],
      [1, "payment_invoice", "sensitive", "platform_policy"],
      [2, "wifi", "none", null],
    ]);
  });

  it("birden çok türe yakın etiket (iade) her uygun öğeye gider", () => {
    const items = buildItemsForMessage({ requests: req("cancellation_refund", "payment_invoice", "wifi"), lexicalLabels: ["money_refund"] });
    expect(pick(items)).toEqual([
      [0, "cancellation_refund", "sensitive", "money_refund"],
      [1, "payment_invoice", "sensitive", "money_refund"],
      [2, "wifi", "none", null],
    ]);
  });

  it("etiket eşlemesi: her kelime ağı etiketi kendi türüne", () => {
    const cases: [string, UnderstandingIntent][] = [
      ["platform_policy", "payment_invoice"],
      ["money_refund", "cancellation_refund"],
      ["refund", "cancellation_refund"],
      ["cancellation", "cancellation_refund"],
      ["early_departure", "date_change"],
      ["review_threat", "complaint_issue"],
      ["complaint", "complaint_issue"],
      ["human_request", "human_request"],
      ["access_security", "access_keys"],
      ["rule_violation", "house_rules"],
    ];
    for (const [label, kind] of cases) {
      const items = buildItemsForMessage({ requests: req(kind, "wifi"), lexicalLabels: [label] });
      expect([label, pick(items)]).toEqual([label, [[0, kind, "sensitive", label], [1, "wifi", "none", null]]]);
    }
  });

  it("eşlemesi olmayan etiket (ayrımcılık, enjeksiyon) mesajın tamamını hassas yapar", () => {
    for (const label of ["discrimination", "prompt_injection", "bilinmeyen"]) {
      const items = buildItemsForMessage({ requests: req("house_rules", "wifi"), lexicalLabels: [label] });
      expect([label, pick(items)]).toEqual([label, [[0, "house_rules", "sensitive", label], [1, "wifi", "sensitive", label]]]);
    }
  });

  it("hassaslık yalnız YÜKSELİR; ilk etiket gerekçe olarak kalır", () => {
    const up = buildItemsForMessage({ requests: req("other"), lexicalLabels: ["complaint", "safety_emergency"] });
    expect(pick(up)).toEqual([[0, "other", "emergency", "complaint"]]);
    const down = buildItemsForMessage({ requests: req("other"), lexicalLabels: ["safety_emergency", "complaint"] });
    expect(pick(down)).toEqual([[0, "other", "emergency", "safety_emergency"]]);
    const understoodEmergency = buildItemsForMessage({ requests: req("emergency"), lexicalLabels: ["complaint"] });
    expect(pick(understoodEmergency)).toEqual([[0, "emergency", "emergency", "complaint"]]);
    const noDup = buildItemsForMessage({ requests: req("complaint_issue"), lexicalLabels: ["complaint", "review_threat"] });
    expect(noDup[0].sources).toEqual(["understanding", "lexical"]);
  });

  it("teşekkür öğesi iş çıkarmaz (oluşturulmaz); sıra numarası korunur", () => {
    expect(pick(buildItemsForMessage({ requests: req("greeting_thanks", "wifi"), lexicalLabels: [] }))).toEqual([[1, "wifi", "none", null]]);
    expect(buildItemsForMessage({ requests: req("greeting_thanks"), lexicalLabels: [] })).toEqual([]);
  });

  it("hassas teşekkür öğesi KALIR ('Teşekkürler ama daire çok kirliydi' — katman şikâyeti görmediyse)", () => {
    expect(pick(buildItemsForMessage({ requests: req("greeting_thanks"), lexicalLabels: ["complaint"] }))).toEqual([
      [0, "greeting_thanks", "sensitive", "complaint"],
    ]);
  });
});

describe("iki geçişin birleşimi (kalıcı öğe + yeniden hesaplanan)", () => {
  const lexical = { sensitivity: "sensitive" as const, riskType: "complaint", sources: ["lexical" as const] };
  const understood = { sensitivity: "none" as const, riskType: null, sources: ["understanding" as const] };
  const emergency = { sensitivity: "emergency" as const, riskType: "safety_emergency", sources: ["understanding" as const] };

  it("hassaslık yalnız yükselir, ilk gerekçe kalır, kaynaklar birleşir", () => {
    expect(mergeItemFacts(lexical, understood)).toEqual({ sensitivity: "sensitive", riskType: "complaint", sources: ["lexical", "understanding"] });
    expect(mergeItemFacts(understood, lexical)).toEqual({ sensitivity: "sensitive", riskType: "complaint", sources: ["understanding", "lexical"] });
    expect(mergeItemFacts(lexical, emergency)).toEqual({ sensitivity: "emergency", riskType: "complaint", sources: ["lexical", "understanding"] });
    expect(mergeItemFacts(emergency, lexical).sensitivity).toBe("emergency");
  });

  it("aynı kaynak iki kez yazılmaz", () => {
    expect(mergeItemFacts(lexical, { ...lexical, riskType: "review_threat" }).sources).toEqual(["lexical"]);
  });
});

describe("tur düzeyi etiketler", () => {
  it("enjeksiyon ve acil turun tamamını tutar; diğerleri tutmaz", () => {
    expect(labelsHoldWholeTurn(["prompt_injection"])).toBe(true);
    expect(labelsHoldWholeTurn(["complaint", "safety_emergency"])).toBe(true);
    expect(labelsHoldWholeTurn(["complaint", "platform_policy", "discrimination"])).toBe(false);
    expect(labelsHoldWholeTurn([])).toBe(false);
  });

  it("acil öğe tespiti", () => {
    expect(hasEmergency(buildItemsForMessage({ requests: req("wifi"), lexicalLabels: [] }))).toBe(false);
    expect(hasEmergency(buildItemsForMessage({ requests: req("wifi"), lexicalLabels: ["complaint"] }))).toBe(false);
    expect(hasEmergency(buildItemsForMessage({ requests: req("wifi", "emergency"), lexicalLabels: [] }))).toBe(true);
  });
});

describe("cevap modelinin tur etiketi öğeye atfedilir mi", () => {
  const ibanWifi = buildItemsForMessage({ requests: req("wifi", "payment_invoice"), lexicalLabels: ["platform_policy"] });

  it("etiket yok → tutma sebebi yok", () => {
    expect(replyRiskAttributable(null, ibanWifi)).toBe(true);
    expect(replyRiskAttributable(undefined, [])).toBe(true);
  });

  it("tutulan ödeme öğesinin etiketi → güvenli kısım tutulmaz", () => {
    expect(replyRiskAttributable("platform_policy", ibanWifi)).toBe(true);
  });

  it("etiketi taşıyan hassas öğe yok → cevabın TAMAMI tutulur", () => {
    expect(replyRiskAttributable("complaint", ibanWifi)).toBe(false);
    const safeParking = buildItemsForMessage({ requests: req("parking"), lexicalLabels: [] });
    expect(replyRiskAttributable("platform_policy", safeParking)).toBe(false);
    expect(replyRiskAttributable("discrimination", ibanWifi)).toBe(false);
  });

  it("anlama katmanının hassas öğesi tür yakınlığıyla etiketi karşılar", () => {
    const refund = buildItemsForMessage({ requests: req("cancellation_refund", "wifi"), lexicalLabels: [] });
    expect(replyRiskAttributable("money_refund", refund)).toBe(true);
    expect(replyRiskAttributable("cancellation", refund)).toBe(true);
    expect(replyRiskAttributable("review_threat", refund)).toBe(false);
  });

  it("aynı etiketi taşıyan (türü eşlenmemiş) hassas öğe etiketi karşılar", () => {
    const disc = buildItemsForMessage({ requests: req("house_rules", "wifi"), lexicalLabels: ["discrimination"] });
    expect(replyRiskAttributable("discrimination", disc)).toBe(true);
  });

  it("enjeksiyon ve acil ASLA öğeye atfedilmez (tur düzeyi)", () => {
    const inj = buildItemsForMessage({ requests: req("wifi"), lexicalLabels: ["prompt_injection"] });
    expect(replyRiskAttributable("prompt_injection", inj)).toBe(false);
    const emg = buildItemsForMessage({ requests: req("emergency"), lexicalLabels: ["safety_emergency"] });
    expect(replyRiskAttributable("safety_emergency", emg)).toBe(false);
  });
});

describe("yaşam döngüsü — hassas öğe kaybolmaz", () => {
  const S: ItemSensitivity[] = ["none", "sensitive", "emergency"];
  const EVENTS: ItemEvent[] = ["held", "answered", "withdrawn", "superseded", "host_done"];

  it("kapanmış öğe hiçbir olayla yeniden açılmaz", () => {
    for (const st of ["answered", "withdrawn", "superseded", "done"] as ItemStatus[]) {
      for (const s of S) for (const e of EVENTS) expect([st, s, e, nextStatus(st, s, e)]).toEqual([st, s, e, st]);
    }
  });

  it("tutma: açık öğe ev sahibine geçer", () => {
    for (const s of S) {
      expect(nextStatus("open", s, "held")).toBe("pending_host");
      expect(nextStatus("pending_host", s, "held")).toBe("pending_host");
    }
  });

  it("yapay zekânın cevabı YALNIZ hassas olmayan öğeyi kapatır", () => {
    expect(nextStatus("open", "none", "answered")).toBe("answered");
    expect(nextStatus("pending_host", "none", "answered")).toBe("answered");
    for (const s of ["sensitive", "emergency"] as ItemSensitivity[]) {
      expect(nextStatus("open", s, "answered")).toBe("open");
      expect(nextStatus("pending_host", s, "answered")).toBe("pending_host");
    }
  });

  it("misafir vazgeçmesi ve yeni öğe acil HARİÇ kapatır", () => {
    for (const st of ["open", "pending_host"] as ItemStatus[]) {
      for (const s of ["none", "sensitive"] as ItemSensitivity[]) {
        expect(nextStatus(st, s, "withdrawn")).toBe("withdrawn");
        expect(nextStatus(st, s, "superseded")).toBe("superseded");
      }
      expect(nextStatus(st, "emergency", "withdrawn")).toBe(st);
      expect(nextStatus(st, "emergency", "superseded")).toBe(st);
    }
  });

  it("ev sahibi her açık öğeyi kapatır (acil dahil)", () => {
    for (const st of ["open", "pending_host"] as ItemStatus[]) for (const s of S) expect(nextStatus(st, s, "host_done")).toBe("done");
  });

  it("yerine geçme: aynı konu + eski acil değil + yeni en az onun kadar hassas", () => {
    expect(maySupersede({ kind: "early_checkin", sensitivity: "none" }, { kind: "early_checkin", sensitivity: "none" })).toBe(true);
    expect(maySupersede({ kind: "payment_invoice", sensitivity: "sensitive" }, { kind: "payment_invoice", sensitivity: "sensitive" })).toBe(true);
    expect(maySupersede({ kind: "complaint_issue", sensitivity: "sensitive" }, { kind: "complaint_issue", sensitivity: "emergency" })).toBe(true);
    // IBAN isteğinin yerini sıradan fatura sorusu ALAMAZ (risk düşerdi):
    expect(maySupersede({ kind: "payment_invoice", sensitivity: "sensitive" }, { kind: "payment_invoice", sensitivity: "none" })).toBe(false);
    expect(maySupersede({ kind: "early_checkin", sensitivity: "none" }, { kind: "late_checkout", sensitivity: "none" })).toBe(false);
    expect(maySupersede({ kind: "emergency", sensitivity: "emergency" }, { kind: "emergency", sensitivity: "emergency" })).toBe(false);
  });
});

describe("görünen durum — 'ev sahibi yazdı' türetilir", () => {
  it("açık / bekleyen öğe ev sahibi yazınca 'ev sahibi yazdı' olur ve listeden düşer", () => {
    expect(effectiveStatus("open", true)).toBe("host_replied");
    expect(effectiveStatus("pending_host", true)).toBe("host_replied");
    expect(isOpenForHost(effectiveStatus("pending_host", true))).toBe(false);
  });
  it("ev sahibi yazmadıysa durum aynen; kapanmış öğe etkilenmez", () => {
    expect(effectiveStatus("pending_host", false)).toBe("pending_host");
    expect(isOpenForHost(effectiveStatus("pending_host", false))).toBe(true);
    expect(isOpenForHost(effectiveStatus("open", false))).toBe(true);
    for (const st of ["answered", "withdrawn", "superseded", "done"] as ItemStatus[]) {
      expect(effectiveStatus(st, true)).toBe(st);
      expect(isOpenForHost(st)).toBe(false);
    }
  });
});

describe("cevap modelinin öğelere atfedilemeyen sinyali (birleşim)", () => {
  const payment = buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] });
  const complaint = buildItemsForMessage({ requests: [{ intent: "complaint_issue" }], lexicalLabels: [] });
  const pick = (m: { intent: string; riskType?: string | null; riskLevel?: string }, held: typeof payment) =>
    unattributedModelItems({ intent: m.intent, riskType: m.riskType ?? null, riskLevel: m.riskLevel ?? "none" }, held).map((i) => [
      i.kind,
      i.sensitivity,
      i.riskType,
      i.sources,
    ]);

  it("hassas niyet ya da yüksek riskli etiket tutulan öğeye atfedilemiyorsa modelin öğesi olur (kaynak reply_model)", () => {
    expect(pick({ intent: "complaint" }, payment)).toEqual([["complaint_issue", "sensitive", "complaint", ["reply_model"]]]);
    expect(pick({ intent: "wifi", riskType: "review_threat" }, payment)).toEqual([["complaint_issue", "sensitive", "review_threat", ["reply_model"]]]);
    expect(pick({ intent: "human_request" }, payment)).toEqual([["human_request", "sensitive", "human_request", ["reply_model"]]]);
    // Aynı türe düşen niyet + etiket TEK öğe.
    expect(pick({ intent: "complaint", riskType: "complaint" }, payment)).toHaveLength(1);
  });

  it("atfedilebilen sinyal öğe ÜRETMEZ; tur düzeyi etiket buraya ait değil", () => {
    expect(pick({ intent: "complaint" }, complaint)).toEqual([]);
    expect(pick({ intent: "wifi", riskType: "platform_policy", riskLevel: "high" }, payment)).toEqual([]);
    expect(pick({ intent: "wifi", riskType: "safety_emergency" }, payment)).toEqual([]);
    expect(pick({ intent: "wifi", riskType: "prompt_injection" }, payment)).toEqual([]);
    expect(pick({ intent: "wifi" }, payment)).toEqual([]);
  });

  it("yükseltilmiş risk düzeyi etiketsiz / atfedilemeyen etiketle 'diğer' öğesi; atfedilebilen etiketle öğe yok", () => {
    expect(pick({ intent: "wifi", riskLevel: "medium" }, payment)).toEqual([["other", "sensitive", null, ["reply_model"]]]);
    expect(pick({ intent: "wifi", riskLevel: "high", riskType: "platform_policy" }, payment)).toEqual([]);
    expect(pick({ intent: "wifi", riskLevel: "low" }, payment)).toEqual([]);
  });
});
