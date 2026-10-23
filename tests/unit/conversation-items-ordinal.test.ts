import { describe, it, expect, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Migration 84 (kurucu 10-23 D) — aynı mesajda aynı türden ikinci istek AYRI öğe + kısa konu etiketi (C). Anahtar
// `AI_ITEM_ORDINAL_ENABLED`; KAPALIYKEN bugünkü kural (birleşir, sıra 0, etiket yok) bayt bayt.
// ---------------------------------------------------------------------------
import { alignOrdinals, buildItemsForMessage, labelCovers, requestOrdinals, topicsCompatible, MAX_ORDINAL } from "@/lib/conversation-items/core";
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

  it("🚨 R14 (Opus dilim sonu 10-23, F10'u daraltır): etiketleri HİÇ benzemeyen istek eski satıra sırayla eşlenmez — yeni sıra açılır", () => {
    // Önce (F10): "spa merkezi" → "sauna" satırı, "bulaşık makinesi" → "çamaşır makinesi" satırı (cevap yanlış satırı kapatabiliyordu).
    expect(alignOrdinals([R("amenities", "spa merkezi")], [E("amenities", 0, "sauna")])).toEqual([1]);
    expect(alignOrdinals([R("amenities", "bulaşık makinesi")], [E("amenities", 0, "çamaşır makinesi")])).toEqual([1]);
    expect(alignOrdinals([R("amenities", "sauna"), R("amenities", "otopark")], [E("amenities", 0, "havuz"), E("amenities", 1, "sauna")])).toEqual([1, 2]);
    // Ortak sözcük hâlâ eşler; bir tarafı etiketsiz çiftler hâlâ sırayla.
    expect(alignOrdinals([R("amenities", "yüzme havuzu"), R("amenities", "buhar odası")], [E("amenities", 0, "havuz"), E("amenities", 1, "sauna")])).toEqual([0, 2]);
    expect(alignOrdinals([R("amenities", null), R("amenities", null)], [E("amenities", 0, "havuz"), E("amenities", 1, "sauna")])).toEqual([0, 1]);
  });

  it("🚨 Haiku 10-23 gece-2: kısa kökün çekimi aynı satır ('su' ↔ 'suyu', 'çöp' ↔ 'çöpü', 'kat' ↔ 'katta'); konu sözcüğü olmayan etiket sırayla eşlenir", () => {
    for (const [a, b] of [["suyu", "su"], ["çöpü", "çöp"], ["katta", "kat"], ["ücreti", "ücret"], ["kuralları", "kural"], ["temizlikte", "temizlik"]]) {
      expect(alignOrdinals([R("amenities", a)], [E("amenities", 0, b)]), `${a} ↔ ${b}`).toEqual([0]);
    }
    expect(alignOrdinals([R("amenities", "bulaşık makinesi")], [E("amenities", 0, "çamaşır makinesi")])).toEqual([1]);
    expect(labelCovers("havuz açılır", "havuz açılıyor")).toBe(true);
  });

  it("R14: yerine geçme için yeni etiket eskinin bütün sözcüklerini taşımalı ('havuz ısıtmalı' ≠ 'havuz açılıyor')", () => {
    expect(labelCovers("havuz ısıtmalı", "havuz açılıyor")).toBe(false);
    expect(labelCovers("havuz kapanış", "havuz")).toBe(true);
    expect(labelCovers("havuzu", "havuz")).toBe(true);
    expect(labelCovers("havuz", "havuz kapanış")).toBe(false);
    expect(labelCovers(null, "havuz")).toBe(false);
    expect(labelCovers("havuz", null)).toBe(false);
  });

  it("🚨 F10: etiketsiz istek birden çok etiketli satır varken HİÇBİRİNE eşlenmez (havuz cevabı sauna satırını kapatamaz)", () => {
    expect(alignOrdinals([R("amenities", null)], [E("amenities", 0, "havuz"), E("amenities", 1, "sauna")])).toEqual([2]);
    expect(alignOrdinals([R("amenities", null)], [E("amenities", 0, "havuz")])).toEqual([0]);
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

describe("mutasyon 10-23 (D) yaşayanları", () => {
  it("aynı etiket kısmi eşleşmeden ÖNCE gelir ('havuz' isteği 'havuz ısıtma' değil 'havuz' satırına)", () => {
    expect(alignOrdinals([{ intent: "amenities", topic: "havuz" }], [
      { kind: "amenities", ordinal: 0, topic: "havuz ısıtma" },
      { kind: "amenities", ordinal: 1, topic: "havuz" },
    ])).toEqual([1]);
  });

  it("3 harfli sözcük başka sözcüğün başı olsa da eşleşmez ('bar' ≁ 'barbekü')", async () => {
    const { topicsCompatible } = await import("@/lib/conversation-items/core");
    expect(topicsCompatible("bar", "barbekü")).toBe(false);
    expect(topicsCompatible("sauna", "saunada")).toBe(true);
  });

  it("arıza anahtarı tür#sıra: yalnız ikinci (arızalı) istek işaretlenir", () => {
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const body = "Klimanın kumandası nerede? Televizyon çalışmıyor.";
    const u = parseUnderstanding(
      {
        language: "tr",
        requests: [
          { intent: "appliance_help", message: 1, query_tr: "klima kumandası nerede", query_original: "Klimanın kumandası nerede?" },
          { intent: "appliance_help", message: 1, query_tr: "televizyon çalışmıyor", query_original: "Televizyon çalışmıyor." },
        ],
        stay_change: STAY_NONE,
        withdrawn: [],
      },
      { items: true },
    )!;
    const t = extractTurnItems({ history: [{ id: "m1", direction: "inbound", body }], guestMessage: body, understanding: u });
    if (t.mode !== "items") throw new Error("mode");
    expect(t.messages[0].faultKinds).toEqual(["appliance_help#1"]);
  });
});

describe("F9 (Opus güvenlik 10-23): konu uyumu yalnız KONU sözcükleriyle", () => {
  it("🚨 ortak fiil / nitelik / genel baş ad aynı konu yapmaz; ortak konu sözcüğü yapar", () => {
    for (const [a, b] of [
      ["sauna kullanılır", "havuz kullanılır"],
      ["çamaşır makinesi çalışmıyor", "bulaşık makinesi çalışmıyor"],
      ["havuz ücretli", "sauna ücretli"],
      ["sauna açılış", "havuz açılış"],
      ["buhar odası", "yatak odası"],
    ]) {
      expect(topicsCompatible(a, b)).toBe(false);
    }
    expect(topicsCompatible("havuz", "havuz ücretli")).toBe(true);
    expect(topicsCompatible("yüzme havuzu", "havuz")).toBe(true);
    expect(topicsCompatible("çamaşır makinesi", "çamaşır makinesi çalışmıyor")).toBe(true);
  });
});

describe("Opus e2e 10-23 — parça kipinin planı", () => {
  const a = (id: string, ordinal = 0, messageId = "m1") => ({ id, messageId, kind: "amenities" as const, sensitivity: "none" as const, riskType: null, ...(ordinal ? { ordinal } : {}) });
  const hints = new Map([
    [hintKey("m1", "amenities"), "sauna var mı"],
    [hintKey("m1", "amenities", 1), "havuz kaçta kapanıyor"],
  ]);

  it("🚨 F4: parça kipi yalnız sıra kipiyle birlikte (sıra kipi kapalıyken birleşen istekte havuz cevabı sauna sorusunu kapatıyordu)", async () => {
    const { composeItemsPlan } = await import("@/lib/conversation-items/plan");
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "1");
    const off = composeItemsPlan({ turnItems: [a("x0")], held: [], hints });
    expect(off.replyItems.parts).toBeUndefined();
    expect(off.replyItems.answerable[0].need).toBeUndefined();
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    const on = composeItemsPlan({ turnItems: [a("x0")], held: [], hints });
    expect(on.replyItems.parts).toBe(true);
    expect(on.replyItems.answerable[0].need?.queries).toEqual(["sauna var mı"]);
  });

  it("🚨 F5: bu geçişin okumasında karşılığı olmayan eski açık satır parça kipinde cevaplanabilir DEĞİL (ipucusuz R-kimliği olmaz)", async () => {
    const { composeItemsPlan } = await import("@/lib/conversation-items/plan");
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "1");
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    // Önceki geçişin iki satırı (sauna 0, havuz 1); bu geçiş mesajı TEK istek okudu → yalnız sıra 0 üretildi.
    const produced = new Set([hintKey("m1", "amenities")]);
    const plan = composeItemsPlan({ turnItems: [a("s0"), a("p1", 1)], held: [], hints, producedKeys: produced });
    expect(plan.answerable.map((x) => [x.ref, x.item.id])).toEqual([["R1", "s0"]]);
    // Kontrol: parça kipi kapalıyken bugünkü kural (iki satır da cevaplanabilir).
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "0");
    expect(composeItemsPlan({ turnItems: [a("s0"), a("p1", 1)], held: [], hints, producedKeys: produced }).answerable).toHaveLength(2);
  });
});
