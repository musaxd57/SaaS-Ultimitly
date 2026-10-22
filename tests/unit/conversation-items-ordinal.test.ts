import { describe, it, expect, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Migration 84 (kurucu 10-23 D) — aynı mesajda aynı türden ikinci istek AYRI öğe + kısa konu etiketi (C). Anahtar
// `AI_ITEM_ORDINAL_ENABLED`; KAPALIYKEN bugünkü kural (birleşir, sıra 0, etiket yok) bayt bayt.
// ---------------------------------------------------------------------------
import { alignOrdinals, buildItemsForMessage, requestOrdinals, MAX_ORDINAL } from "@/lib/conversation-items/core";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { hintKey } from "@/lib/conversation-items/plan";
import { itemOrdinalEnabled } from "@/lib/conversation-items/flag";
import { parseUnderstanding, type UnderstandingHistoryEntry } from "@/lib/ai/semantic/understanding-schema";

afterEach(() => vi.unstubAllEnvs());

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
const twoAmenities = parseUnderstanding(
  {
    language: "tr",
    requests: [
      { intent: "amenities", message: 1, query_tr: "havuz kaçta kapanıyor", query_original: "Havuz kaçta kapanıyor?" },
      { intent: "wifi", message: 1, query_tr: "wifi şifresi", query_original: "Wi-Fi şifresi?" },
      { intent: "amenities", message: 1, query_tr: "sauna var mı", query_original: "Sauna var mı?" },
    ],
    stay_change: STAY_NONE,
    withdrawn: [],
  },
  { items: true },
)!;
const history: UnderstandingHistoryEntry[] = [{ id: "m1", direction: "inbound", body: "Havuz kaçta kapanıyor? Wi-Fi şifresi? Sauna var mı?" }];

describe("sıra kuralı", () => {
  it("aynı türden kaçıncı istek; tavanda kalır", () => {
    expect(requestOrdinals(["amenities", "wifi", "amenities"])).toEqual([0, 0, 1]);
    expect(requestOrdinals(Array(7).fill("other"))).toEqual([0, 1, 2, 3, 4, MAX_ORDINAL, MAX_ORDINAL]);
  });

  it("anahtar yalnız tam '1' ile açılır", () => {
    expect(itemOrdinalEnabled()).toBe(false);
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "true");
    expect(itemOrdinalEnabled()).toBe(false);
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    expect(itemOrdinalEnabled()).toBe(true);
  });

  it("ipucu anahtarı sıra 0'da bugünkünün aynısı; sıra > 0 ayrı anahtar", () => {
    expect(hintKey("m1", "amenities")).toBe("m1\u0000amenities");
    expect(hintKey("m1", "amenities", 0)).toBe("m1\u0000amenities");
    expect(hintKey("m1", "amenities", 1)).toBe("m1\u0000amenities#1");
  });
});

describe("öğe kurucu", () => {
  const requests = [
    { intent: "amenities" as const, hint: "havuz", topic: "havuz" },
    { intent: "wifi" as const, hint: "wifi" },
    { intent: "amenities" as const, hint: "sauna", topic: "sauna" },
  ];

  it("🚨 kapalı: aynı türden istekler BİRLEŞİR (bugünkü), sıra / etiket alanı yok", () => {
    const items = buildItemsForMessage({ requests, lexicalLabels: [] });
    expect(items.map((i) => i.kind)).toEqual(["amenities", "wifi"]);
    expect(items.every((i) => !("ordinal" in i) && !("topic" in i))).toBe(true);
  });

  it("açık: ikinci havuz / sauna isteği AYRI öğe (sıra 1), etiketleri ayrı", () => {
    const items = buildItemsForMessage({ requests, lexicalLabels: [], ordinals: requestOrdinals(requests.map((r) => r.intent)) });
    expect(items.map((i) => [i.kind, i.ordinal ?? 0, i.topic])).toEqual([
      ["amenities", 0, "havuz"],
      ["wifi", 0, undefined],
      ["amenities", 1, "sauna"],
    ]);
  });
});

describe("tur çıkarımı", () => {
  it("🚨 kapalı: tür başına tek öğe, sorgular tür anahtarında birleşik (bugünkü)", () => {
    const t = extractTurnItems({ history, guestMessage: history[0].body, understanding: twoAmenities });
    if (t.mode !== "items") throw new Error("mode");
    const m = t.messages[0];
    expect(m.items.map((i) => i.kind)).toEqual(["amenities", "wifi"]);
    expect(Object.keys(m.queries ?? {}).sort()).toEqual(["amenities", "wifi"]);
    expect(m.queries?.amenities).toEqual(["havuz kaçta kapanıyor", "Havuz kaçta kapanıyor?", "sauna var mı", "Sauna var mı?"]);
  });

  it("açık: sauna isteği kendi öğesi + kendi sorguları + kısa etiket ('havuz' / 'sauna')", () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const t = extractTurnItems({ history, guestMessage: history[0].body, understanding: twoAmenities });
    if (t.mode !== "items") throw new Error("mode");
    const m = t.messages[0];
    expect(m.items.map((i) => [i.kind, i.ordinal ?? 0, i.topic])).toEqual([
      ["amenities", 0, "havuz"],
      ["wifi", 0, "wifi"],
      ["amenities", 1, "sauna"],
    ]);
    expect(m.queries?.["amenities#1"]).toEqual(["sauna var mı", "Sauna var mı?"]);
    expect(m.queries?.amenities).toEqual(["havuz kaçta kapanıyor", "Havuz kaçta kapanıyor?"]);
  });
});

describe("yeniden işleme — istek ↔ satır eşlemesi (çoğaltma yok, yanlış bağ yok)", () => {
  const R = (intent: string, topic: string | null) => ({ intent, topic });
  const E = (kind: string, ordinal: number, topic: string | null) => ({ kind, ordinal, topic });

  it("mevcut satır yoksa sıra kuralının aynısı", () => {
    expect(alignOrdinals([R("amenities", "havuz"), R("wifi", "wifi"), R("amenities", "sauna")], [])).toEqual([0, 0, 1]);
  });

  it("🚨 ikinci okuma istekleri TERS sırayla verdi: havuz yine 0, sauna yine 1 (cevap yanlış satıra bağlanmaz)", () => {
    expect(alignOrdinals([R("amenities", "sauna"), R("amenities", "havuz")], [E("amenities", 0, "havuz"), E("amenities", 1, "sauna")])).toEqual([1, 0]);
  });

  it("başka sözcüklerle: ortak sözcük eşler ('havuz kapanış' ↔ 'havuz saat')", () => {
    expect(
      alignOrdinals([R("amenities", "sauna sıcaklık"), R("amenities", "havuz kapanış")], [E("amenities", 0, "havuz saat"), E("amenities", 1, "sauna")]),
    ).toEqual([1, 0]);
  });

  it("🚨 anahtar kapalı dönemin etiketsiz satırı: tek istek o satıra eşlenir (yeni satır YOK)", () => {
    expect(alignOrdinals([R("amenities", "havuz")], [E("amenities", 0, null)])).toEqual([0]);
    expect(alignOrdinals([R("amenities", null)], [E("amenities", 0, "havuz")])).toEqual([0]);
  });

  it("ikinci okuma yeni bir istek buldu: eskisi kendi satırında, yenisi boş ilk sırada", () => {
    expect(alignOrdinals([R("amenities", "havuz"), R("amenities", "sauna")], [E("amenities", 0, "havuz")])).toEqual([0, 1]);
    expect(alignOrdinals([R("amenities", "sauna"), R("amenities", "havuz")], [E("amenities", 0, "havuz")])).toEqual([1, 0]);
  });

  it("🚨 etiketleri HİÇ benzemeyen istek ile satır eşlenmez (ilişki belirsiz → ayrı satır, kapatma yok)", () => {
    expect(alignOrdinals([R("amenities", "jakuzi")], [E("amenities", 0, "havuz"), E("amenities", 1, "sauna")])).toEqual([2]);
  });

  it("başka türün satırı bu türü etkilemez; boş sıra kalmazsa tavanda birleşir", () => {
    expect(alignOrdinals([R("wifi", "wifi"), R("amenities", "havuz")], [E("parking", 0, "otopark")])).toEqual([0, 0]);
    const full = [0, 1, 2, 3, 4].map((o) => E("amenities", o, `x${o}`));
    expect(alignOrdinals([R("amenities", "jakuzi")], full)).toEqual([MAX_ORDINAL]);
  });

  it("tur çıkarımı mevcut satırları okur: ters sıralı ikinci okumada sorgular doğru satırın anahtarında", () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const swapped = parseUnderstanding(
      {
        language: "tr",
        requests: [
          { intent: "amenities", message: 1, query_tr: "sauna var mı", query_original: "Sauna var mı?" },
          { intent: "amenities", message: 1, query_tr: "havuz kaçta kapanıyor", query_original: "Havuz kaçta kapanıyor?" },
        ],
        stay_change: STAY_NONE,
        withdrawn: [],
      },
      { items: true },
    )!;
    const t = extractTurnItems({
      history,
      guestMessage: history[0].body,
      understanding: swapped,
      existingItems: [
        { messageId: "m1", kind: "amenities", ordinal: 0, topic: "havuz" },
        { messageId: "m1", kind: "amenities", ordinal: 1, topic: "sauna" },
      ],
    });
    if (t.mode !== "items") throw new Error("mode");
    const m = t.messages[0];
    expect(m.items.map((i) => [i.ordinal ?? 0, i.topic])).toEqual([
      [1, "sauna"],
      [0, "havuz"],
    ]);
    expect(m.queries?.amenities).toEqual(["havuz kaçta kapanıyor", "Havuz kaçta kapanıyor?"]);
    expect(m.queries?.["amenities#1"]).toEqual(["sauna var mı", "Sauna var mı?"]);
  });
});

describe("Haiku 10-23 D incelemesi", () => {
  it("etiket eşlemesi çekim toleranslı: ikinci okuma 'havuzu' dese de havuz satırına gider", async () => {
    const { topicsCompatible } = await import("@/lib/conversation-items/core");
    expect(alignOrdinals([{ intent: "amenities", topic: "sauna" }, { intent: "amenities", topic: "havuzu" }], [
      { kind: "amenities", ordinal: 0, topic: "havuz" },
      { kind: "amenities", ordinal: 1, topic: "sauna" },
    ])).toEqual([1, 0]);
    expect(topicsCompatible("havuz", "havuzu ısıtmalı")).toBe(true);
    expect(topicsCompatible("havuz", "sauna")).toBe(false);
    expect(topicsCompatible(null, "sauna")).toBe(true);
    // Kısa sözcük öneki eşleşme sayılmaz ("su" ≁ "sauna").
    expect(topicsCompatible("su", "sauna")).toBe(false);
  });

  it("misafirin adı etikete giremez (tur çıkarımı adları alır)", () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const u = parseUnderstanding(
      {
        language: "tr",
        requests: [{ intent: "amenities", message: 1, query_tr: "Mehmet için ekstra havlu", query_original: "Mehmet için havlu?" }],
        stay_change: STAY_NONE,
        withdrawn: [],
      },
      { items: true },
    )!;
    const t = extractTurnItems({ history, guestMessage: history[0].body, understanding: u, guestNames: ["Mehmet Kaya"] });
    if (t.mode !== "items") throw new Error("mode");
    expect(t.messages[0].items[0].topic).toBe("ekstra havlu");
  });

  it("🚨 ilişki olgusu ve arıza anahtarı SIRAYLA okunur: ikinci şikâyetin konusu ilk şikâyetinkiyle karışmaz", async () => {
    const { composeItemsPlan, faultRequestsOf } = await import("@/lib/conversation-items/plan");
    const facts = (topics: string[]) => ({ relation: "own_topic" as const, topics, generic: false, hazard: false });
    const relations = new Map([
      [hintKey("m1", "complaint_issue"), facts(["ac"])],
      [hintKey("m1", "complaint_issue", 1), facts(["tv"])],
    ]);
    const c0 = { id: "c0", messageId: "m1", kind: "complaint_issue" as const, sensitivity: "sensitive" as const, riskType: "complaint" };
    const c1 = { ...c0, id: "c1", ordinal: 1 };
    const plan = composeItemsPlan({ turnItems: [c0, c1], held: [c0, c1], hints: new Map(), relations, kbRecipeTopics: new Set<string>() });
    expect(plan.gateItems.relation?.anchors.map((a) => a.topics)).toEqual([["ac"], ["tv"]]);
    // Arıza anahtarı "tür#sıra": yalnız ikinci istek arızalı → yalnız o ev sahibine kalır, ilki ("kumanda nerede?") cevaplanabilir.
    const faults = faultRequestsOf([{ messageId: "m1", faultKinds: ["appliance_help#1"] }]);
    expect([...(faults ?? [])]).toEqual([hintKey("m1", "appliance_help", 1)]);
    const a0 = { id: "a0", messageId: "m1", kind: "appliance_help" as const, sensitivity: "none" as const, riskType: null };
    const a1 = { ...a0, id: "a1", ordinal: 1 };
    const listPlan = composeItemsPlan({ turnItems: [a0, a1], held: [], hints: new Map(), ...(faults ? { faultRequests: faults } : {}) });
    expect(listPlan.answerable.map((x) => x.item.id)).toEqual(["a0"]);
  });
});
