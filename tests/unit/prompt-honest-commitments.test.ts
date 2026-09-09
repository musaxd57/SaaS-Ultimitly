import { describe, it, expect } from "vitest";
import { REPLY_SYSTEM_PROMPT, buildReplyUserPrompt, findTimeConflicts } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { unverifiedActionClaims } from "../helpers/claim-detectors";

// ---------------------------------------------------------------------------
// P1 + P4 — KANITSIZ TAAHHÜT ve KAYNAK ÇELİŞKİSİ (kurucu onayı 09-09, YEREL).
//
// Gerçek model eval'inin kök nedeni (docs/EVAL-BULGULARI-2026-09-09-…): model
// "ekibime ilettim / size döneceğim" derken uydurmuyordu — İSTEM bunu EMREDİYORDU
// (kural metninde VE taklit edilsin diye verilen few-shot örneklerde). Ürünün
// böyle bir eylemi yoktur: mesaj iletemez, arama yapamaz, geri dönemez. Garanti
// edilen tek şey mesajın KAYDEDİLDİĞİ ve ev sahibinin görebildiğidir — QR devir
// metni (`escalationReply()`) zaten bunu söyler; istem artık aynı gerçeği söylüyor.
//
// 🚨 DAVRANIŞSAL PİN, METİN TARAMASI DEĞİL: few-shot örnek cevapları JSON olarak
// AYRIŞTIRILIP dedektörden geçirilir. Bir örnek daha eklenirse o da otomatik
// denetlenir; kaynak taraması tek yönlüdür ve burada YETMEZ.
//
// 🚨 KORUNAN: şikâyet / insan talebi / para / güvenlik ETİKETLERİ (intent,
// riskLevel, riskType) DEĞİŞMEDİ — kod kapısı bunlara bakar. Yalnız `reply`
// metinleri dürüstleşti. Aşağıdaki "korunur" testleri bunu ayrıca pinler.
//
// P4 NOTU: giriş/çıkış saati için tanımlı bir öncelik ZATEN VAR (mülk ayarı
// esastır — buildReplyUserPrompt). Bu dilim öncelik İCAT ETMEZ ve var olanı da
// değiştirmez; yalnızca çelişkiyi KODDA tespit edip modele ve ev sahibine
// (missingInfo/actionSuggestion) görünür kılar. "Çelişkide devir mi" kararı
// kurucunundur (P4-b), burada verilmedi.
// ---------------------------------------------------------------------------

/** Sistem istemindeki few-shot örnek cevapları — JSON olarak ayrıştırılır. */
function exampleRows(): { intent: string; reply: string; riskLevel: string; riskType: string | null }[] {
  const rows: { intent: string; reply: string; riskLevel: string; riskType: string | null }[] = [];
  for (const raw of REPLY_SYSTEM_PROMPT.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith('{"intent"')) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

/** Bu ifadelerin istemde EMİR/ŞABLON olarak geçmesi = kök nedenin kendisi. */
const INSTRUCTED_COMMITMENTS = [
  /"Bu konuyu ekibimize ilettim, en kısa sürede size döneceğim\." yaz/,
  /"Bu konuyu kontrol edip en kısa sürede size döneceğim\." yaz/,
  /check-in öncesi ayrıca paylaşacağız/,
  /ekibimiz iletecek/,
  /"ekibimiz en kısa sürede dönecek" de/,
  /"ekibimizle kontrol edip size döneceğim" de/,
  /bulunca\s+haber veririz/,
  /En kısa sürede çözüp size dönüş yapacağız/,
  /İLGİLENİLDİĞİDİR/,
  /ev sahibimiz size dönüş yapacak/,
  /kontrol edip\s+en kısa sürede kesinleştireceğiz/,
];

const ANCHOR = "Mesajınız kaydedildi; ev sahibiniz görebilir.";

function input(over: Partial<SuggestReplyInput> = {}): SuggestReplyInput {
  return {
    guestMessage: "Çıkış saati kaçta?",
    property: { name: "Daire", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: [],
    reservation: null,
    history: [],
    tone: "warm",
    language: "tr",
    ...over,
  };
}

describe("P1 — istem kanıtsız taahhüt EMRETMEZ", () => {
  it("HİÇBİR few-shot örnek cevabı makbuzsuz eylem iddiası/söz taşımaz (JSON ayrıştırılır)", () => {
    const rows = exampleRows();
    // Boş geçemez: örnekler kaybolursa bu test sessizce "geçmiş" olmasın.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const offenders = rows
      .map((r) => ({ intent: r.intent, claims: unverifiedActionClaims(r.reply), reply: r.reply }))
      .filter((r) => r.claims.length > 0);
    expect(offenders, JSON.stringify(offenders, null, 1)).toEqual([]);
  });

  it("kural metni modele 'ilettim / döneceğim / paylaşacağız' YAZMASINI emretmiyor", () => {
    for (const re of INSTRUCTED_COMMITMENTS) {
      expect(REPLY_SYSTEM_PROMPT, `hâlâ emrediyor: ${re}`).not.toMatch(re);
    }
  });

  it("dürüst çapa cümlesi istemde VAR ve devir metniyle aynı gerçeği söylüyor", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain(ANCHOR);
    // `escalationReply()` "kaydedildi … görüntüleyebilir" der; istem de eylem
    // değil OLGU bildirir. İkisi aynı sınıf: kayıt + görünürlük, söz yok.
    expect(unverifiedActionClaims(ANCHOR)).toEqual([]);
  });

  it("son kontrol listesi makbuzsuz iddiayı kendi kendine yakalatır", () => {
    // Büyük harf ve noktalı İ ile AYNEN: JS'te `/i` bayrağı Türkçe İ ↔ i
    // eşlemesini yapmaz (Canonicalize toUpperCase tabanlı), o yüzden
    // duyarsız arama burada sessizce düşerdi.
    expect(REPLY_SYSTEM_PROMPT).toMatch(/12\. reply MAKBUZSUZ EYLEM İDDİASI/);
  });

  it("rezervasyon onaylanmamış bloğu 'girişten önce paylaşılır' VAADİ vermiyor", () => {
    const p = buildReplyUserPrompt(input({ reservation: null }));
    expect(p).not.toMatch(/girişten önce paylaşılır/);
    // Satır kırılımı + girinti olabilir → \s+
    expect(p).toMatch(/onaylı\s+rezervasyon sonrasında paylaşılabilir/);
  });
});

describe("P1 — ŞİKÂYET / İNSAN TALEBİ / PARA / GÜVENLİK devri KORUNUR (etiketler değişmedi)", () => {
  it("örneklerde escalation intent'leri ve risk etiketleri hâlâ modelleniyor — HER örnekte", () => {
    const rows = exampleRows();
    // 🚨 `some` YETMEZ (mutasyonda hayatta kaldı): iki complaint örneği varken
    // birinin etiketi düşürülünce diğeri pini sağlıyordu. Şart HEPSİ içindir:
    // reply metni dürüstleşirken tek bir örneğin bile etiketi gevşememeli.
    const ofIntent = (intent: string) => rows.filter((r) => r.intent === intent);
    const complaints = ofIntent("complaint");
    expect(complaints.length).toBeGreaterThanOrEqual(2);
    expect(complaints.every((r) => r.riskLevel !== "none"), JSON.stringify(complaints)).toBe(true);

    const humans = ofIntent("human_request");
    expect(humans.length).toBeGreaterThanOrEqual(1);
    expect(humans.every((r) => r.riskType === "human_request")).toBe(true);

    const refunds = ofIntent("refund");
    expect(refunds.length).toBeGreaterThanOrEqual(1);
    expect(refunds.every((r) => r.riskLevel !== "none")).toBe(true);
    expect(refunds.some((r) => r.riskLevel === "high")).toBe(true); // platform-dışı ödeme örneği

    expect(rows.some((r) => r.riskType === "safety_emergency" && r.riskLevel === "high")).toBe(true);
    expect(ofIntent("early_departure").every((r) => r.riskLevel === "medium")).toBe(true);
    expect(ofIntent("early_departure").length).toBeGreaterThanOrEqual(1);
  });

  it("niyet taksonomisi ve risk kuralları yerinde (kapının baktığı etiketler)", () => {
    expect(REPLY_SYSTEM_PROMPT).toMatch(/^complaint\s+→/m);
    expect(REPLY_SYSTEM_PROMPT).toMatch(/^human_request\s+→/m);
    expect(REPLY_SYSTEM_PROMPT).toMatch(/^refund\s+→/m);
    expect(REPLY_SYSTEM_PROMPT).toContain("riskLevel=high, intent=refund");
    // Para yönlendirmesi kuralı (KURAL-4) duruyor.
    expect(REPLY_SYSTEM_PROMPT).toMatch(/KURAL-4 \[FİYAT \/ İADE/);
  });
});

describe("P4 — kaynak çelişkisi KODDA tespit edilir, öncelik İCAT EDİLMEZ", () => {
  const kbCheckout = (content: string) => [{ category: "checkout", title: "Çıkış", content }];

  it("KB çıkış saati mülk ayarından FARKLIYSA çelişki bulunur", () => {
    const c = findTimeConflicts(
      { name: "Daire", checkInTime: "15:00", checkOutTime: "11:00" },
      kbCheckout("Çıkış saati 12:00'dir, anahtarı masaya bırakın."),
    );
    expect(c).toEqual([{ field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] }]);
  });

  it("AYNI saat çelişki DEĞİL; KB yoksa çelişki yok; başka kategorideki saat sayılmaz", () => {
    const prop = { name: "Daire", checkInTime: "15:00", checkOutTime: "11:00" };
    expect(findTimeConflicts(prop, kbCheckout("Çıkış 11:00, anahtar masada."))).toEqual([]);
    expect(findTimeConflicts(prop, [])).toEqual([]);
    // Otopark kaleminde geçen "09:00" bir çıkış saati DEĞİLDİR.
    expect(findTimeConflicts(prop, [{ category: "parking", title: "Otopark", content: "09:00-18:00 ücretli" }])).toEqual([]);
    // "11.00" = 11:00 → çelişki değil (nokta ayraç da tanınır).
    expect(findTimeConflicts(prop, kbCheckout("Çıkış 11.00"))).toEqual([]);
  });

  it("TEK HANELİ saat normalize edilir (padStart mutasyonda hayatta kalmıştı — bu durum eksikti)", () => {
    const prop9 = { name: "Daire", checkInTime: "15:00", checkOutTime: "09:00" };
    // "9:00" ve "9.00" → 09:00 = mülk ayarı → çelişki DEĞİL.
    expect(findTimeConflicts(prop9, kbCheckout("Çıkış 9:00."))).toEqual([]);
    expect(findTimeConflicts(prop9, kbCheckout("Çıkış 9.00."))).toEqual([]);
    // "9.30" → 09:30 ≠ 09:00 → çelişki; değer NORMALİZE edilmiş biçimde raporlanır.
    expect(findTimeConflicts(prop9, kbCheckout("Çıkış 9.30"))).toEqual([
      { field: "checkOutTime", propertyValue: "09:00", kbValues: ["09:30"] },
    ]);
    // Mülk ayarı tek haneli yazılmışsa ("9:00") o da normalize edilir.
    const propRaw = { name: "Daire", checkInTime: "15:00", checkOutTime: "9:00" };
    expect(findTimeConflicts(propRaw, kbCheckout("Çıkış 09:00"))).toEqual([]);
  });

  it("giriş saati için de aynı tespit", () => {
    const c = findTimeConflicts(
      { name: "Daire", checkInTime: "15:00", checkOutTime: "11:00" },
      [{ category: "checkin", title: "Giriş", content: "Giriş 14:00'ten itibaren." }],
    );
    expect(c).toEqual([{ field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] }]);
  });

  it("çelişkide istem: blok VAR, iki değer de görünür, var olan öncelik korunur, YENİ öncelik yok", () => {
    const p = buildReplyUserPrompt(input({ knowledgeBase: kbCheckout("Çıkış saati 12:00'dir.") }));
    const i = p.indexOf("KAYNAK ÇELİŞKİSİ");
    expect(i, "çelişki bloğu yok").toBeGreaterThan(-1);
    const block = p.slice(i, i + 900);
    expect(block).toContain("11:00");
    expect(block).toContain("12:00");
    // Ev sahibine görünürlük: missingInfo + actionSuggestion'a yazılması istenir.
    expect(block).toMatch(/missingInfo/);
    expect(block).toMatch(/actionSuggestion/);
    // Öncelik İCAT EDİLMEZ: blok "bilgi tabanı esastır" demez; var olan kurala gönderir.
    expect(block).not.toMatch(/bilgi tabanı esastır/i);
    expect(block).toMatch(/öncelik/i);
    // Uyuşan kaynaklar için mevcut öncelik cümlesi yerinde duruyor.
    expect(p).toContain("mülk bilgisi esastır");
  });

  it("P4-b (kurucu kararı): çelişkide misafire KESİN SAAT YOK, insan incelemesi; host'a gösterim AYRI", () => {
    const p = buildReplyUserPrompt(input({ knowledgeBase: kbCheckout("Çıkış saati 12:00'dir.") }));
    const block = p.slice(p.indexOf("KAYNAK ÇELİŞKİSİ"));
    expect(block).toMatch(/KESİN SAAT SÖYLENMEZ/);
    expect(block).toMatch(/İNSAN İNCELEMESİ/);
    // Ürünün insana devir çizgisi: güven 0.75'in altı (kapı/eşik DEĞİŞMEDİ; istem o çizgiyi hedefler).
    expect(block).toMatch(/0\.75'in ALTINDA/);
    // "netleştirecek/dönecek" vaadi de yasak — P1 ile tutarlı.
    expect(block).toMatch(/SÖZ VERME/);
    // Host'a gösterim misafire cevaptan AYRI bir iş olarak korunuyor.
    expect(block).toMatch(/AYRI bir iştir/);
    expect(block).toMatch(/missingInfo/);
    // Eski "çelişse bile bu saatleri kullan" emri artık YOK; ÖNCELİK satırı çelişkiyi insana bırakıyor.
    expect(p).not.toMatch(/farklı bir\s+saat geçse bile bu saatleri kullan/);
    expect(p).toMatch(/ÇELİŞİYORSA .*misafire kesin saat SÖYLEME/s);
  });

  it("KURAL-4: para yönlendirmesi 'değerlendirecek' VAADİ değil, kararın sahibini söyler", () => {
    expect(REPLY_SYSTEM_PROMPT).not.toMatch(/"ev sahibimiz değerlendirecek"/);
    expect(REPLY_SYSTEM_PROMPT).toMatch(/"bu konu ev sahibinizin kararıdır" ifadesiyle/);
    // Son kontrol listesi de aynı ölçütü sorar.
    expect(REPLY_SYSTEM_PROMPT).toMatch(/4\. Para\/iade konusu varsa rakam yerine "bu konu ev sahibinizin kararıdır"/);
    // Formal ton da gelecek-zaman söz önermez.
    expect(REPLY_SYSTEM_PROMPT).not.toMatch(/"değerlendireceğiz", "inceleyeceğiz" gibi ifadeler kullan/);
  });

  it("çelişki YOKKEN blok basılmaz (sakin durumda gürültü yok)", () => {
    expect(buildReplyUserPrompt(input({ knowledgeBase: kbCheckout("Çıkış 11:00.") }))).not.toContain("KAYNAK ÇELİŞKİSİ");
    expect(buildReplyUserPrompt(input())).not.toContain("KAYNAK ÇELİŞKİSİ");
  });
});
