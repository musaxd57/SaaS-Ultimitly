import { describe, it, expect, afterEach, vi } from "vitest";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { composeItemsPlan, relationFactsOf } from "@/lib/conversation-items/plan";
import { faultSignal, touchesHeldDevice } from "@/lib/conversation-items/relation";
import type { ItemKind } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// ARIZA HER YOLDA ARIZA — anahtar `AI_FAULT_GUARD_ENABLED` (VARSAYILAN KAPALI). Kurucu 10-15 inceleme notu (aynen): "ADAM 2 SORU SORMUŞKEN
// SALAK GİBİ TEKİNİ CEVAPLAYIP DİĞERİNİ GÖRMEZDEN GELİYOR GİBİ OLMASIN … Televizyon arızası | KB'de ve kullanılabilir geçmişte doğrulanmış
// çözüm bulunamadı | Arıza açık kalsın; çözüm uydurulmasın, hosta devir/bildirim politikası uygulansın". Sabah Kararları 27 (b) + 30.
// Ölçülen boşluk (Opus 10-15): anlama katmanı arızayı "şikâyet" işaretlemezse (bağlayıcı yok) istek bağımsız sayılıyor, tarif / `kb:`
// kuralları koşmuyor ve ev sahibine bildirim gitmiyordu.
// ---------------------------------------------------------------------------

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
type Req = { intent: ItemKind; q: string; qo?: string; relation: string };

function planOf(body: string, requests: Req[], recipeTopics: string[] = []) {
  const u = parseUnderstanding(
    {
      language: "tr",
      requests: requests.map((r) => ({ intent: r.intent, query_tr: r.q, query_original: r.qo ?? r.q, message: 1, relation: r.relation })),
      stay_change: STAY_NONE,
      withdrawn: [],
    },
    { items: true, followup: true },
  );
  const ex = extractTurnItems({ history: [{ id: "m1", direction: "inbound", body }], guestMessage: body, understanding: u, labelsOf: () => [] });
  if (ex.mode !== "items") throw new Error(`tur bölünmedi: ${ex.reason}`);
  const turnItems = ex.messages.flatMap((m) => m.items.map((it) => ({ messageId: m.messageId, kind: it.kind, sensitivity: it.sensitivity, sources: it.sources })));
  const held = turnItems.filter((i) => i.sensitivity !== "none").map((i) => ({ ...i, riskType: null }));
  const relations = relationFactsOf(ex.messages);
  const plan = composeItemsPlan({ turnItems, held, hints: new Map(), ...(relations ? { relations, kbRecipeTopics: new Set(recipeTopics) } : {}) });
  return { plan, turnItems };
}

const TV_TRASH = "Telvizyonda goruntu yok, sadece siyah ekran var. Copleri nereye atiyoruz?";
const TV: Req = { intent: "appliance_help", q: "televizyonda görüntü yok, siyah ekran", qo: "Telvizyonda goruntu yok, sadece siyah ekran var", relation: "own_topic" };
const TRASH: Req = { intent: "trash", q: "çöpler nereye atılıyor", qo: "Copleri nereye atiyoruz?", relation: "own_topic" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("arıza sinyali (saf)", () => {
  it.each([
    ["televizyonda görüntü yok", true],
    ["TV arızası", true],
    ["klima çalışmıyor", true],
    ["the TV is not working", true],
    ["Wi-Fi bağlanmıyor", true],
    ["televizyon nasıl açılır", false],
    ["kumanda nerede", false],
    ["televizyon çalışmazsa ne yapalım", false],
    ["çöpler nereye atılıyor", false],
    ["taksi gelmiyor", false],
  ])("%j → %s", (q, want) => {
    expect(faultSignal(q, q)).toBe(want);
  });
});

describe("anahtar AÇIK — arıza ev sahibine kalır, bağımsız soru cevaplanır", () => {
  it("🚨 kurucunun örneği: TV arızası (model şikâyet DEMEDİ) + çöp sorusu → çöp cevaplanabilir; TV bağlı; kod şikâyet öğesi ekler (ev sahibi bildirimi)", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const { plan, turnItems } = planOf(TV_TRASH, [TV, TRASH]);
    expect(plan.answerable.map((a) => a.item.kind)).toEqual(["trash"]);
    expect(plan.replyItems.held.map((h) => h.kind)).toEqual(expect.arrayContaining(["complaint_issue", "appliance_help"]));
    const added = turnItems.find((i) => i.kind === "complaint_issue");
    expect(added).toMatchObject({ sensitivity: "sensitive", sources: ["fault_guard"] });
    expect(plan.gateItems.heldDeviceTopics).toEqual(["tv"]);
  });

  it("🚨 ikinci kemer: bırakılan TV'ye değinen uydurma adım (5.1'in cümlesi) kapıda tutulur", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const { plan } = planOf(TV_TRASH, [TV, TRASH]);
    const reply =
      "Televizyon için önce kumandadan televizyonun açık olduğundan ve kaynak girişinin (HDMI/AV/TV) doğru seçili olduğundan emin olur musunuz. Çöp için ise evsel atıkları C-7 konteynerine atabilirsiniz.";
    expect(touchesHeldDevice(plan.gateItems.heldDeviceTopics ?? [], reply)).toBe(true);
    expect(touchesHeldDevice(plan.gateItems.heldDeviceTopics ?? [], "Evsel atıkları sokağın başındaki C-7 konteynerine atabilirsiniz.")).toBe(false);
  });

  it("bilgi tabanında TV TARİFİ varsa ve model 'arıza çözümü' dediyse istek çözüm olarak cevaplanabilir (kurucu 18 'a' — bugünkü kural)", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const { plan } = planOf(TV_TRASH, [{ ...TV, relation: "fix_request" }, TRASH], ["tv"]);
    expect(plan.answerable.map((a) => a.item.kind).sort()).toEqual(["appliance_help", "trash"]);
    expect(plan.replyItems.answerable.find((a) => a.kind === "appliance_help")).toMatchObject({ fix: true });
  });

  it("aşırı uygulama yok: kullanım sorusu ('TV nasıl açılır') ve koşul sorusu arıza sayılmaz — şikâyet öğesi eklenmez", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    for (const q of ["televizyon nasıl açılır", "televizyon çalışmazsa ne yapalım"]) {
      const { plan, turnItems } = planOf(q, [{ intent: "appliance_help", q, relation: "own_topic" }, TRASH]);
      expect(turnItems.some((i) => i.kind === "complaint_issue"), q).toBe(false);
      expect(plan.answerable.map((a) => a.item.kind).sort(), q).toEqual(["appliance_help", "trash"]);
    }
  });

  it("model şikâyeti zaten verdiyse ikinci şikâyet öğesi eklenmez (tek bildirim)", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const { turnItems } = planOf(TV_TRASH, [{ intent: "complaint_issue", q: "televizyonda görüntü yok", relation: "own_topic" }, TV, TRASH]);
    expect(turnItems.filter((i) => i.kind === "complaint_issue")).toHaveLength(1);
    expect(turnItems.find((i) => i.kind === "complaint_issue")?.sources).toEqual(["understanding"]);
  });
});

describe("bırakılan TV kapısı — TV'nin belirti / parça adları (Opus P2; anahtarsız, yalnız sıkılaştırır)", () => {
  it("🚨 'televizyon' sözcüğü geçmeyen uydurma TV adımı da tutulur; çöp cevabı ('siyah konteyner') tutulmaz", () => {
    expect(touchesHeldDevice(["tv"], "Ekranda görüntü yoksa kaynak girişinin (HDMI/AV) doğru seçili olduğundan emin olur musunuz.")).toBe(true);
    expect(touchesHeldDevice(["tv"], "Uydu alıcısının ışığını kontrol edin.")).toBe(true);
    expect(touchesHeldDevice(["tv"], "Çöpleri sokağın başındaki siyah konteynere atabilirsiniz.")).toBe(false);
  });
});

describe("anahtar KAPALI — bugünkü davranış bayt bayt", () => {
  it("TV + çöp: iki istek de cevaplanabilir, şikâyet öğesi yok, olgularda 'fault' alanı YOK", () => {
    const { plan, turnItems } = planOf(TV_TRASH, [TV, TRASH]);
    expect(plan.answerable.map((a) => a.item.kind).sort()).toEqual(["appliance_help", "trash"]);
    expect(turnItems.some((i) => i.kind === "complaint_issue")).toBe(false);
    expect(JSON.stringify(plan.gateItems)).not.toContain("fault");
  });
});
