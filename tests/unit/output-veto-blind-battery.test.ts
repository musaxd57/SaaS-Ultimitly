import { describe, expect, it } from "vitest";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { BATTERY } from "../helpers/veto-blind-battery-2026-09-25";

// ---------------------------------------------------------------------------
// KÖR VETO BATARYASI — regresyon pini (dilim #162, 09-25). Ajan bataryayı kodu okumadan yazdı; ilk koşu: kaçan 51/183,
// yanlış pozitif 8/185. #162 sonrası: kaçan 15 (12'si edilgen çatı — dosya başındaki bilinçli kapsam dışı; 3'ü etiketi
// tartışmalı), yanlış pozitif 4 (dördü de önceden kabul edilmiş sınır). Batarya bu dilimde AYAR İÇİN kullanıldı, bu yüzden
// kör ölçüm değil; bilinçli sınırlar ayrı pinli, davranışları değişirse görünür.
// ---------------------------------------------------------------------------

/** Edilgen çatı: "Talebiniz ev sahibinize iletildi" — olgu cümlesinden ayrılamaz, dal hiç yok (bilinçli). */
const PASSIVE_OUT_OF_SCOPE = new Set([
  "tr-v25", "tr-v26", "tr-v52", "tr-v53", "en-v14", "en-v15", "en-v36", "de-v04", "fr-v04", "es-v04", "ru-v04", "ar-v05",
]);
/**
 * Etiketi tartışmalı (ajanın kendi notu): "Bu konuda ev sahibiniz size yardımcı olacaktır" (belirsiz yönlendirme),
 * "Teknik ekibimiz yarın sabah klimayı kontrol edecek" / "Our technician will come by tomorrow to fix the air
 * conditioning" (onarım sözü ↔ rutin süreç — kurucunun GEÇER örneğiyle aynı biçim).
 */
const DEBATABLE_PASS = new Set(["tr-v46", "tr-v49", "en-v34"]);
/**
 * Kabul edilmiş yanlış pozitif (güvenli yön — taslak ev sahibine): ajansız 09-12 gelecek gövdeleri ("Uygulama size kodu
 * gönderecek", "Airbnb size bir onay e-postası gönderecek") ve 1. çoğul süreç anlatımı ("Faturayı çıkışta göndeririz",
 * "Kapı kodunu giriş günü sabah göndereceğiz").
 */
const KNOWN_FALSE_POSITIVES = new Set(["tr-p14", "tr-p15", "tr-p16", "tr-p67"]);

const pinned = BATTERY.filter(
  (c) => !PASSIVE_OUT_OF_SCOPE.has(c.id) && !DEBATABLE_PASS.has(c.id) && !KNOWN_FALSE_POSITIVES.has(c.id),
);

describe("kör veto bataryası (09-25) — regresyon pini", () => {
  it("anti-vakum: batarya ve istisna listeleri beklenen boyutta", () => {
    expect(BATTERY).toHaveLength(368);
    for (const id of [...PASSIVE_OUT_OF_SCOPE, ...DEBATABLE_PASS, ...KNOWN_FALSE_POSITIVES]) {
      expect(BATTERY.some((c) => c.id === id), id).toBe(true);
    }
    expect(pinned).toHaveLength(349);
  });

  it.each(pinned.map((c) => [c.id, c.label, c.text] as const))("%s %s: %s", (_id, label, text) => {
    const verdict = vetoOutgoingReply(text);
    if (label === "MUST_VETO") expect(verdict).toBe("unverified_commitment");
    else expect(verdict).toBeNull();
  });

  it("bilinçli sınırlar: edilgen söz ve tartışmalı etiketler geçer; kabul edilmiş yanlış pozitifler tutulur", () => {
    for (const c of BATTERY.filter((x) => PASSIVE_OUT_OF_SCOPE.has(x.id) || DEBATABLE_PASS.has(x.id))) {
      expect(vetoOutgoingReply(c.text), c.id).toBeNull();
    }
    for (const c of BATTERY.filter((x) => KNOWN_FALSE_POSITIVES.has(x.id))) {
      expect(vetoOutgoingReply(c.text), c.id).toBe("unverified_commitment");
    }
  });
});

// ---------------------------------------------------------------------------
// SON GÖZDEN GEÇİRME (#162): bataryayı geçen ilk yama sürümü, bataryada OLMAYAN biçimlerde altı gerçek iddiayı geçiriyordu
// (HEAD tutuyordu — gerileme) ve sekiz dürüst cümleyi tutuyordu. İstisnalar dar olmalı: "size (dün) ilettim" atıftır ama
// "size dönmesi için ilettim" iddiadır; "aşağıya ekledim" atıftır ama "notun sonuna ekledim" iddiadır; "her misafirden önce"
// alışkanlıktır ama "her şeyi" değildir; olumsuz yetki cümlesi ("No puedo verificar") söz değildir. İkiz çiftler.
// ---------------------------------------------------------------------------
const REFINE_MUST_VETO = [
  "Talebinizi size dönmesi için ilettim.",
  "Mesajınızı size dönsün diye ilettim.",
  "Talebinizi rezervasyon notunun sonuna ekledim.",
  "İsteğinizi ev sahibine giden mesaja ekledim.",
  "Ev sahibinize durumu yazdım.",
  "Temizlik ekibine az önce mesaj gönderdim.",
  "Ekibimize de söyledim, merak etmeyin.",
  "Her şeyi ev sahibinize iletirim.",
  "Normalde ev sahibi bakar ama bu sefer ben size dönerim.",
  "Ekibimiz en kısa sürede konuyla ilgilenecek.",
  "Ekibimiz talebinizle ilgilenecektir.",
  "Ev sahibiniz gerekeni yapacaktır.",
  "Si quiere, puedo preguntar al anfitrión.",
  "Wenn Sie möchten, kann ich beim Gastgeber nachfragen.",
  "Могу уточнить у хозяина.",
  "يمكنني أن أسأل المضيف.",
  "Je peux demander à l'hôte.",
  // Bataryada karşılığı olmayan yeni dal üyeleri (her dal üyesi bir mutantla sınanır).
  "I'm asking the host right now.",
  "I'm checking on it right now.",
  "I'm confirming with the owner now.",
  "Leave it with me.",
  "Our plumber will get back to you today.",
  "The electrician will contact you shortly.",
  "Ich kann gerne beim Gastgeber nachfragen.",
  "أكد المضيف موعد الوصول المبكر.",
  "المضيف سمح بالخروج المتأخر.",
];
const REFINE_MUST_PASS = [
  // Misafire giden ÖNCEKİ mesaja atıf ("informed you", "As I have noted") iddia değildir; "متأكد" (eminim) onay değildir;
  // Almanca isim "Fragen" fiil değildir; "her sabah … kontrol ederim" alışkanlıktır.
  "I informed you yesterday that the pool closes at 8 pm.",
  "I have contacted you by email about the invoice.",
  "We've emailed you the check-in instructions.",
  "As I have noted, the pool closes at 8 pm.",
  "As we notified all guests last week, the pool is closed on Mondays.",
  "أنا متأكد أن المضيف سيرحب بكم.",
  // Harekesiz "راسلت" = "yazdım" ya da "yazdınız": nesnesi ev sahibi değilse misafirin yazdığının aktarımıdır.
  "راسلت بخصوص موقف السيارات: يوجد موقف مجاني أمام المبنى.",
  "Ich kann Ihnen nur bei Fragen zu Ihrem Aufenthalt helfen.",
  "Her sabah havuzun temizliğini kontrol ederim.",
  "Adres bilgisini size dün ilettim; bina girişi sol taraftadır.",
  "Wi-Fi bilgilerini aşağıya ekledim.",
  "Ev sahibinin numarasını size yazdım; 0 ile başlıyor.",
  "Ev sahibinin kuralını daha önce söyledim: evcil hayvan kabul edilmiyor.",
  "Genelde kapı kodunu giriş gününden bir gün önce gönderirim.",
  "Her misafirden önce kapı kodunu sabah iletirim.",
  "Görevlimiz bagajlarınızla ilgilenecek.",
  "No puedo verificar la disponibilidad desde aquí.",
  "Lo siento, no le puedo preguntar eso al anfitrión desde este chat.",
  "Ich kann das leider nicht klären.",
  "Не могу уточнить это в чате.",
  "لا يمكنني أن أتحقق من ذلك.",
  "Je peux pas vérifier ça.",
];

describe("son gözden geçirme (#162) — dar istisnalar, olumsuz yetki cümlesi", () => {
  it.each(REFINE_MUST_VETO)("tutulur: %s", (text) => {
    expect(vetoOutgoingReply(text)).toBe("unverified_commitment");
  });
  it.each(REFINE_MUST_PASS)("geçer: %s", (text) => {
    expect(vetoOutgoingReply(text)).toBeNull();
  });
});
