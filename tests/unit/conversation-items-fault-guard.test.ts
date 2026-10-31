import { describe, it, expect, afterEach, vi } from "vitest";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { composeItemsPlan, faultRequestsOf, relationFactsOf } from "@/lib/conversation-items/plan";
import { faultDevicesOf, faultSignal, kbRecipeTopics, requestTopics, topicsOf, touchesHeldDevice } from "@/lib/conversation-items/relation";
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

function planOf(body: string, requests: Req[], recipeTopics: string[] = [], opts: { listMode?: boolean } = {}) {
  const u = parseUnderstanding(
    {
      language: "tr",
      requests: requests.map((r) => ({ intent: r.intent, query_tr: r.q, query_original: r.qo ?? r.q, message: 1, ...(opts.listMode ? {} : { relation: r.relation }) })),
      stay_change: STAY_NONE,
      withdrawn: [],
    },
    opts.listMode ? { items: true } : { items: true, followup: true },
  );
  const ex = extractTurnItems({ history: [{ id: "m1", direction: "inbound", body }], guestMessage: body, understanding: u, labelsOf: () => [] });
  if (ex.mode !== "items") throw new Error(`tur bölünmedi: ${ex.reason}`);
  const turnItems = ex.messages.flatMap((m) => m.items.map((it) => ({ messageId: m.messageId, kind: it.kind, sensitivity: it.sensitivity, sources: it.sources })));
  const held = turnItems.filter((i) => i.sensitivity !== "none").map((i) => ({ ...i, riskType: null }));
  const relations = relationFactsOf(ex.messages);
  const faultRequests = faultRequestsOf(ex.messages);
  const plan = composeItemsPlan({
    turnItems,
    held,
    hints: new Map(),
    ...(relations ? { relations, kbRecipeTopics: new Set(recipeTopics) } : {}),
    ...(faultRequests ? { faultRequests } : {}),
  });
  return { plan, turnItems, ex, relations };
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
    // Opus N2: belirti sözlüğü arıza sinyalinde okunur ("televizyon" geçmese de)
    ["ekranda görüntü yok, siyah ekran", true],
    // Opus N3 (10-15 gece, ölçüldü) — yanlış alarmlar: cümlecik dışı, misafir eşyası, koşul, düzelmiş, İspanyolca "rota"
    ["Otoparka rota gönderir misiniz?", false],
    ["Telefon çekmiyor, wifi şifresi ne?", false],
    ["Bavulumuzun tekerleği kırık, asansör var mı?", false],
    ["Arabamız bozuldu, otopark var mı?", false],
    ["otopark için bozuk para lazım mı", false],
    ["Klima arıza yaparsa kimi arayalım?", false],
    ["Televizyon bozuk olursa ne yapalım?", false],
    ["If the TV is broken, who do we call?", false],
    ["Klima çalışmadı ama sonra düzeldi, teşekkürler", false],
    // aşırı düzeltme yok: gerçek arıza yine arıza ("kendi kendine" sahiplik değildir)
    ["Televizyon kendi kendine kapanıyor, bozuk mu bilmiyorum ama görüntü yok", true],
    ["Wi-Fi bağlanmıyor, şifre doğru", true],
    ["Klima: çalışmıyor", true],
    // Haiku 10-15 gece (ölçüldü): zaman "geçti" düzelme değil · dört sözcüklü özne · düzelme SONRA tekrar arıza · geniş / geçmiş zaman ·
    // İspanyolca "sí" koşul değil · aynı cümlecikte koşullu ilk arızadan sonra gerçek ikinci arıza
    ["Klima bir saat geçti hâlâ çalışmıyor", true],
    ["Televizyon kendi kendine kapanıyor, bozuk", true],
    ["Klima düzeldi ama şimdi yine çalışmıyor", true],
    ["Klima çalışmaz", true],
    ["Klima çalışmıyordu, hâlâ öyle", true],
    ["Sí, el televisor no funciona", true],
    ["Klima arıza yaparsa televizyon çalışmıyor", true],
    ["Asansör nerede, tekerlek kırık", false],
    // Kayıtlı mesajlardan (10-15 gece) kaçan biçimler
    ["Kapının kilidi takılıyor, dışarıdan zor kilitleniyor", true],
    ["Klimanın fanı dönmüyor", true],
    ["Klima kumandası hiçbir tuşa tepki vermiyor", true],
    ["Yarım saattir internet yok", true],
    ["The ceiling fan won't respond to the remote", true],
    ["There's no hot water since last night", true],
    ["Die Klimaanlage reagiert nicht", true],
    ["Le fer à repasser ne chauffe plus", true],
    ["El aire acondicionado no arranca", true],
    // Bilinen sınır: cihaz SÖZLÜKTE yoksa (davlumbaz, blender) arıza sayılmaz — anlama katmanının Türkçe sorgusu da aynı sözlükten okunur
    ["Davlumbazın fanı dönmüyor", false],
    // aşırı uygulama yok
    ["Internet şifresi ne?", false],
    ["Wi-Fi var mı?", false],
    ["Klima, çalışmıyor", true],
    ["Asansör var mı, bavulun tekerleği kırık", false],
    ["Asansör var mı, tekerlek kırık", false],
    ["el wifi no funciona", true],
    // Opus gece-2 M4 (ölçüldü): başka cihazın düzelmesi arızayı silmez; soru / sanı düzelme değildir; büyük harf "AMA" bölünür
    ["Klima hâlâ çalışmıyor, internet ise düzeldi.", true],
    ["TV çalışmıyor, wifi ise sorunsuz çalışıyor artık.", true],
    ["The TV is broken, the wifi works now though.", true],
    ["Klima çalışmıyor. Düzeldi mi diye bakar mısınız?", true],
    ["Klima çalışmıyor; düzeldi mi diye baktık, hâlâ aynı.", true],
    ["Klima çalışmıyor, hallettik sandık ama olmadı.", true],
    ["The AC is not working. Fixed?", true], // soru işaretli düzelme düzelme değildir (mutasyon N10)
    ["KLİMA ÇALIŞMIYOR AMA WİFİ DÜZELDİ", true],
    ["Klima çalışmıyor mu yoksa kapalı mı bilmiyoruz, soğutmuyor.", true],
    ["Bavul dolabının kilidi bozuk.", true],
    ["Bulaşık makinesi su boşaltmıyor.", true],
    ["The dishwasher won't drain.", true],
    ["Wifi sürekli kopuyor.", true],
    ["İnternet çok yavaş.", true],
    // M4 yan notu + M7: olumsuzlama / soru / koşul ("durumunda / halinde") / onarıldı / telefon öznesi / misafirin evi
    ["Televizyon bozuk değil, sadece kumandayı bulamadık.", false],
    ["Klima çalışmıyor mu? Nasıl açılıyor?", false],
    ["Wifi'ye bağlandık, telefon çekmiyor.", false],
    ["Our TV at home is broken, does yours have Netflix?", false],
    ["Klima arıza durumunda kimi arayalım?", false],
    ["Klimada arıza halinde ne yapmalıyız?", false],
    ["Klimanın arızası giderildi, teşekkürler.", false],
    ["Klima çalışmadı ama sonra düzeldi.", false],
    // Opus gece-3 P2-b: düzelme yalnız SON arızadan sonra gelirse kapatır; düzelme cümleciği özne verir; yardım isteğiyle çekingen bildirim
    ["Klima dün tamir edildi ve yine bozuldu.", true],
    ["The AC was repaired yesterday and is broken again.", true],
    ["Klimanın arızası giderildi denmişti, yine çalışmıyor.", true],
    ["Klima çalışmıyor mu acaba, bir bakar mısınız?", true],
    ["Klima bozuk durumunda, lütfen birini gönderin.", true],
    ["Wifi'ye bağlanamıyoruz.", true],
    ["We can't connect to the wifi.", true],
  ])("%j → %s", (q, want) => {
    expect(faultSignal(q, q)).toBe(want);
  });
});

describe("arızalı cihaz kümesi (Opus gece-3 P2-a)", () => {
  it("kumanda / TV mobilyası başka cihazla anılınca o cihazın arızasıdır; yalnız kumanda anılmışsa sözlüğün okuması kalır", () => {
    expect([...faultDevicesOf("Klima kumandası çalışmıyor")]).toEqual(["ac"]);
    expect([...faultDevicesOf("The AC remote is not working")]).toEqual(["ac"]);
    expect([...faultDevicesOf("TV ünitesinin altındaki modemin ışıkları yanmıyor")]).toEqual(["wifi"]);
    expect([...faultDevicesOf("Kumanda çalışmıyor")]).toEqual(["tv"]);
    expect([...faultDevicesOf("Televizyonun kumandası çalışmıyor")]).toEqual(["tv"]);
  });
});

describe("TV belirti sözlüğü genel konu çıkarımına GİRMEZ (Opus N2 — anahtarsız, gevşetiyordu)", () => {
  it("🚨 'Görüntülü diyafon' kalemi bilgi tabanında TV TARİFİ sayılmaz; diyafonun anahtar tarifi kaybolmaz", () => {
    expect(kbRecipeTopics([{ title: "Kapı zili", content: "Görüntülü diyafonda görüntü gelmezse sağdaki tuşa 3 saniye basılı tutun." }]).has("tv")).toBe(false);
    expect(topicsOf("Görüntülü diyafon")).not.toContain("tv");
    expect(topicsOf("Ev sahibiyle görüntülü görüşebilir miyiz?")).not.toContain("tv");
  });

  it("belirti adını yalnız BAĞLAYICI tür okur (şikâyet — yalnız sıkılaşır); cevaplanabilir istek ve bilgi tabanı okumaz (gevşetmez — Opus gece-2 M6)", () => {
    expect(requestTopics("ekranda görüntü yok", "", "complaint_issue")).toContain("tv");
    expect(requestTopics("ekranda görüntü yok", "", "appliance_help")).not.toContain("tv");
    expect(kbRecipeTopics([{ title: "Sık sorulanlar", content: "Ekranda görüntü yoksa kaynak tuşuyla HDMI girişini seçin." }]).has("tv")).toBe(false);
    // görüntülü başka cihaz TV değildir
    expect(requestTopics("diyafonda görüntü yok", "", "complaint_issue")).not.toContain("tv");
    expect(requestTopics("kamera görüntüsü gelmiyor", "", "complaint_issue")).not.toContain("tv");
    expect(touchesHeldDevice(["tv"], "Diyafonda görüntü yoksa sağdaki tuşa 3 saniye basılı tutun.")).toBe(false);
  });

  it("Opus gece-3 P3-a/b: görünüş / manzara anlamı TV değildir; görüntülü cihaz vetosu yalnız AYNI cümlede, TV'ye özgü belirti vetolanmaz", () => {
    for (const q of ["Balkondan deniz görüntüsü yok, ilanda vardı", "Daire fotoğraflardaki görüntüden çok farklı", "Binanın dış görüntüsü çok kötü", "The apartment has no picture frames and looks bare"]) {
      expect(requestTopics(q, "", "complaint_issue"), q).not.toContain("tv");
    }
    expect(touchesHeldDevice(["tv"], "Ekranda görüntü yoksa kaynak girişini HDMI 1 yapın. Bina girişindeki kamera yalnız ortak alanı görür.")).toBe(true);
    expect(touchesHeldDevice(["tv"], "Diyafon salondadır. Ekranda görüntü yoksa kaynağı HDMI 1'e alın.")).toBe(true);
    expect(touchesHeldDevice(["tv"], "If there is no picture, check the input. The doorbell camera only shows the entrance.")).toBe(true);
    // "siyah ekran" kapı zili kamerasında da olur → aynı cümlede veto (Haiku 10-16); HDMI TV'ye özgü, vetolanmaz
    expect(requestTopics("kapı zili kamerası siyah ekran oluyor", "", "complaint_issue")).not.toContain("tv");
    expect(requestTopics("kapı zilinin yanındaki TV'de HDMI çalışmıyor", "", "complaint_issue")).toContain("tv");
    // uzun metinde 64. cümleden sonraki belirti de okunur (anahtarsız yolda tavan fail-open olurdu)
    expect(touchesHeldDevice(["tv"], `${"Tamam. ".repeat(80)}Ekranda görüntü yoksa kaynağı değiştirin.`)).toBe(true);
  });

  it("🚨 Opus gece-2 M6 (anahtarsız, ilişki kipi canlı): klima şikâyeti yanında 'Diyafonda görüntü yok' çözüm isteği TV tarifiyle cevaplanabilir OLMAZ", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "");
    const body = "Klima çalışmıyor. Diyafonda görüntü yok, nasıl düzeltirim?";
    const { plan } = planOf(
      body,
      [
        { intent: "complaint_issue", q: "klima çalışmıyor", relation: "own_topic" },
        { intent: "appliance_help", q: "diyafonda görüntü yok", relation: "fix_request" },
      ],
      ["tv"],
    );
    expect(plan.answerable).toEqual([]);
    // "Ekranda görüntü yok" (cihaz adı yok) da tarif sayılmaz → bağlı
    const screen = planOf(
      "Klima çalışmıyor. Ekranda görüntü yok.",
      [
        { intent: "complaint_issue", q: "klima çalışmıyor", relation: "own_topic" },
        { intent: "appliance_help", q: "ekranda görüntü yok", relation: "fix_request" },
      ],
      ["tv"],
    );
    expect(screen.plan.answerable).toEqual([]);
  });

  it("şikâyetin kendisi belirtiyle yazıldıysa ('ekranda görüntü yok') bırakılan cihaz TV olur — anahtarsız, yalnız sıkılaşır", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "");
    const { plan } = planOf("Ekranda görüntü yok. Çöpleri nereye atıyoruz?", [
      { intent: "complaint_issue", q: "ekranda görüntü yok", relation: "own_topic" },
      TRASH,
    ]);
    expect(plan.answerable.map((a) => a.item.kind)).toEqual(["trash"]);
    expect(plan.gateItems.heldDeviceTopics).toEqual(["tv"]);
  });

  it("cevap tarafında belirti adı TV'dir (bırakılan TV kapısı); 'görüntülü' değildir", () => {
    expect(touchesHeldDevice(["tv"], "Ekranda görüntü yoksa kaynak girişini kontrol edin.")).toBe(true);
    expect(touchesHeldDevice(["tv"], "Görüntülü diyafonun ekranında kapıyı açabilirsiniz.")).toBe(false);
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

describe("anahtar AÇIK — liste kipi ve konusu çıkarılamayan arıza (Opus N9)", () => {
  it("🚨 liste kipi (ilişki işareti yok): 'Le wifi ne marche pas' Wi-Fi isteği bilgi tabanı şartı olmadan CEVAPLANMAZ, ev sahibine kalır", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const wifi: Req = { intent: "wifi", q: "wifi çalışmıyor", qo: "Le wifi ne marche pas", relation: "own_topic" };
    const { plan, turnItems, relations } = planOf("Le wifi ne marche pas.", [wifi], [], { listMode: true });
    expect(relations).toBeNull();
    expect(plan.answerable).toEqual([]);
    expect(turnItems.find((i) => i.kind === "complaint_issue")?.sources).toEqual(["fault_guard"]);
  });

  it("liste kipinde arızasız soru cevaplanır (aşırı uygulama yok)", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const wifi: Req = { intent: "wifi", q: "wifi şifresi ne", relation: "own_topic" };
    const { plan } = planOf("Wi-Fi şifresi ne?", [wifi], [], { listMode: true });
    expect(plan.answerable.map((a) => a.item.kind)).toEqual(["wifi"]);
  });

  it("ilişki kipinde 'televizyon' sözcüğü geçmeyen belirti ('ekranda görüntü yok') yine bağlı; bırakılan cihaz TV, çöp cevaplanır", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const screen: Req = { intent: "appliance_help", q: "ekranda görüntü yok", relation: "own_topic" };
    const { plan } = planOf("Ekranda görüntü yok. Çöpleri nereye atıyoruz?", [screen, TRASH]);
    expect(plan.answerable.map((a) => a.item.kind)).toEqual(["trash"]);
    expect(plan.gateItems.heldDeviceTopics).toEqual(["tv"]);
  });
});

describe("anahtar AÇIK — modelin şikâyeti BAŞKA cihaz hakkındaysa ikinci arıza da bağlı (mutasyon N9b)", () => {
  it("🚨 'Klima çalışmıyor' (model şikâyet dedi) + 'televizyonda görüntü yok' (model şikâyet DEMEDİ) + çöp → TV cevaplanmaz, çöp cevaplanır", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "1");
    const body = "Klima çalışmıyor. Televizyonda görüntü yok. Çöpler nereye atılıyor?";
    const { plan } = planOf(body, [
      { intent: "complaint_issue", q: "klima çalışmıyor", relation: "own_topic" },
      { intent: "appliance_help", q: "televizyonda görüntü yok", relation: "own_topic" },
      TRASH,
    ]);
    expect(plan.answerable.map((a) => a.item.kind)).toEqual(["trash"]);
  });
});

describe("anahtar KAPALI — bugünkü davranış bayt bayt", () => {
  it("TV + çöp: iki istek de cevaplanabilir, şikâyet öğesi yok, mesajda arıza türü (faultKinds) YOK", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "");
    const { plan, turnItems, ex } = planOf(TV_TRASH, [TV, TRASH]);
    expect(plan.answerable.map((a) => a.item.kind).sort()).toEqual(["appliance_help", "trash"]);
    expect(turnItems.some((i) => i.kind === "complaint_issue" || i.sources.includes("fault_guard"))).toBe(false);
    expect(ex.mode === "items" && ex.messages.some((m) => "faultKinds" in m)).toBe(false);
  });

  it("liste kipinde de: 'Le wifi ne marche pas' bugünkü gibi cevaplanabilir", () => {
    vi.stubEnv("AI_FAULT_GUARD_ENABLED", "");
    const wifi: Req = { intent: "wifi", q: "wifi çalışmıyor", qo: "Le wifi ne marche pas", relation: "own_topic" };
    const { plan } = planOf("Le wifi ne marche pas.", [wifi], [], { listMode: true });
    expect(plan.answerable.map((a) => a.item.kind)).toEqual(["wifi"]);
  });
});

describe("arıza okuyucu bütün cümlecikleri okur (Codex 10-16: 64 cümlecik tavanı 65. cümlecikteki arızayı kaçırıyordu)", () => {
  it("🚨 63 / 64 / 65 / 200 cümlecikten sonra gelen arıza da açık arızadır", () => {
    for (const n of [63, 64, 65, 200]) {
      const text = `${Array.from({ length: n }, (_, i) => `merhaba ${i}`).join(", ")}, televizyon açılmıyor.`;
      expect([...faultDevicesOf(text)], String(n)).toEqual(["tv"]);
    }
    // aşırı-uygulama kontrolü: arızasız uzun metin arıza üretmez
    expect([...faultDevicesOf(Array.from({ length: 200 }, (_, i) => `merhaba ${i}`).join(", "))]).toEqual([]);
  });
});

describe("görünmez karakter arızayı gizlemez (gece-4 S4-07; yalnız eşleştirme kopyası)", () => {
  it("sözcüğün içindeki sıfır genişlikli boşluk / yumuşak tire / Braille boşluğu arıza okumasını bozmaz", () => {
    for (const ch of ["\u200b", "\u00ad", "\u2060", "\u2800"]) {
      expect(faultSignal(`Klima çalış${ch}mıyor`, ""), JSON.stringify(ch)).toBe(true);
      expect([...faultDevicesOf(`Klima çalış${ch}mıyor`)], JSON.stringify(ch)).toEqual(["ac"]);
    }
    // aşırı-uygulama kontrolü: görünmez karakterli arızasız cümle arıza değil
    expect(faultSignal("Klima\u200b nasıl açılıyor?", "")).toBe(false);
  });
});
