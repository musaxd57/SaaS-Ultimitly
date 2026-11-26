import { describe, it, expect, beforeEach } from "vitest";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { matchConcepts, lexiconProblems, EMERGENCY_ACIL_FORMS } from "@/lib/ai/retrieval/lexicon";
import { contentStems, stem } from "@/lib/ai/retrieval/text";
import { neutralPadding } from "../helpers/kb-padding";
import { buildScaleLab, loadScaleFile } from "../eval/rag-lab/scale-set";

// ---------------------------------------------------------------------------
// #208 (kurucu kararı 09-27: "getirme hatalarını ölçerek düzelt"; "Şifremi unuttum" bağlama bağlı — Wi-Fi bağlamı yoksa KESİN
// yönlendirme yok). Kök sökücü ünlüden sonraki 1. tekil iyelik "-m"ini sökmüyor ("şifremi" → "sifrem"), bu yüzden "Şifremi
// unuttum" hiçbir şifre kalemini bulmuyordu (dev setinin 60 kalemlik alt kümesinde tek sonuç garaj kumandası — "unuttum ~
// unutmayın"). Kök sökücüye "-m" kuralı ÖLÇÜLÜP REDDEDİLDİ (122 yeni çakışma: "akşam = aksi", "modem = moda"). Kural yalnız
// KAVRAM TESPİTİNDE ve yalnız Türkçe sorguda: "-m"siz kök bir kavram teriminin köküyse kavram tanınır → şifre kavramı TÜM şifre /
// kod kalemlerini getirir (hangisi olduğuna model bağlamla karar verir; tek kaleme kesin yönlendirme yok).
// ---------------------------------------------------------------------------

const t0 = Date.UTC(2026, 5, 1);
const at = (i: number) => new Date(t0 - i * 1000);
const items = [
  { id: "wifi", category: "wifi", title: "Wi-Fi", content: "Wi-Fi ağı Lale-5G, şifresi modemin altındaki etikette.", updatedAt: at(0) },
  { id: "door", category: "checkin", title: "Kapı", content: "Daire kapısının şifresi giriş günü mesajla paylaşılır.", updatedAt: at(1) },
  { id: "remote", category: "parking", title: "Garaj kumandası", content: "Kumandayı çıkarken masada bırakmayı unutmayın.", updatedAt: at(2) },
  { id: "park", category: "parking", title: "Otopark", content: "Araba binanın önündeki açık otoparka bırakılır.", updatedAt: at(3) },
  { id: "coffee", category: "general", title: "Kahve", content: "Kahve kapsülleri mutfak dolabında, yenisi için mesaj atın.", updatedAt: at(4) },
  { id: "towel", category: "cleaning", title: "Havlu", content: "Yedek havlular yatak odasındaki dolapta.", updatedAt: at(5) },
  ...neutralPadding(40),
];
const NOW = Date.UTC(2026, 8, 27, 12);
const pick = (guestMessage: string) => selectKbForPrompt({ items, guestMessage, mode: "hybrid", now: NOW }).items.map((i) => i.id);
const DEV = buildScaleLab(loadScaleFile("dev")!, 302).items;
const pickDev = (guestMessage: string, n: number) =>
  selectKbForPrompt({ items: DEV, guestMessage, mode: "hybrid", now: NOW }).items.slice(0, n).map((i) => i.id);

beforeEach(() => __resetKbIndexCache());

describe("ünlü-sonu iyelik '-m' — kavram tespiti", () => {
  it("kök sökücü DEĞİŞMEDİ (ölçülüp reddedilen kural geri gelmesin): 'şifremi' → 'sifrem', 'akşam' / 'modem' aynen", () => {
    expect(stem("sifremi")).toBe("sifrem");
    expect(stem("aksam")).toBe("aksam");
    expect(stem("modem")).toBe("modem");
    expect(stem("toplam")).toBe("toplam");
  });

  it("yalnız istenince: 'sifrem' → şifre kavramı; seçenek kapalıyken (saat alanı / diğer çağıranlar) eşleşme YOK", () => {
    const stems = contentStems("Şifremi unuttum");
    expect(matchConcepts(stems, { possessive: true }).map((m) => m.concept.id)).toContain("credentials");
    expect(matchConcepts(stems).map((m) => m.concept.id)).not.toContain("credentials");
    // "u" + m (taban kökte "-um" sökülemiyor: "havlum" → "havlum") ve "a" + m.
    expect(matchConcepts(["havlum"], { possessive: true }).map((m) => m.concept.id)).toContain("towels");
    expect(matchConcepts(["arabam"], { possessive: true }).map((m) => m.concept.id)).toContain("parking");
    // Kısa kök (4 harf) denenmez: "adam" / "team" ("tea" + m → kahve kavramı) hiçbir kavrama bağlanmaz.
    expect(matchConcepts(["adam"], { possessive: true })).toEqual([]);
    expect(matchConcepts(["team"], { possessive: true })).toEqual([]);
  });

  // Gerçek boyut (dev seti, 302 kalem — görülebilir set; holdout OKUNMAZ): küçük fikstürde karakter 3-gram kaynağı "şifremi ~ şifresi"yi
  // zaten eşliyor, hata gerçek boyutta görünüyordu. Eski kod: "Şifremi unuttum" → garaj kumandası / kırılan eşya / hacimli çöp;
  // "Arabamı nereye bırakayım?" → TV / gezi / sağlık; "Kumandam çalışmıyor" → yalnız ev rehberi.
  it("🚨 gerçek boyut: 'Şifremi unuttum' → Wi-Fi şifresi + anahtar kutusu şifresi (tek kaleme kesin yönlendirme yok)", () => {
    const top = pickDev("Şifremi unuttum", 5);
    expect(top).toContain("d_wifi_tv_2");
    expect(top).toContain("d_checkin_2");
  });

  it("🚨 gerçek boyut: 'Arabamı nereye bırakayım?' → otopark kalemleri · 'Kumandam çalışmıyor' → TV kalemi", () => {
    expect(pickDev("Arabamı nereye bırakayım?", 3).every((id) => id.startsWith("d_parking"))).toBe(true);
    expect(pickDev("Kumandam çalışmıyor", 5)).toContain("d_wifi_tv_6");
  });

  it("🚨 dil tespitinin İngilizce sandığı kısa Türkçe mesaj da ('Kumandam bozuk' → en): TV kalemi", () => {
    expect(pickDev("Kumandam bozuk", 5)).toContain("d_wifi_tv_6");
  });

  it("KONTROL — iyeliksiz soru eskisi gibi; İngilizce 'team' çay (kahve kavramı) sanılmaz", () => {
    expect(pick("Wi-Fi şifresi ne?")).toContain("wifi");
    const en = matchConcepts(contentStems("Is the cleaning team coming today?"), { possessive: false }).map((m) => m.concept.id);
    expect(en).not.toContain("coffee");
    expect(pick("Is the cleaning team coming today?")).not.toContain("coffee");
  });
});

// ---------------------------------------------------------------------------
// #208 A10 (09-27, çalıştırılarak doğrulandı): (1) "noise" → "no", "waste" → "was", "hastane" → "has", "ısınmıyor" → "is" DURAK
// sözcüğe iniyordu → bu terimler kavramlarını hiç tetiklemiyordu ("Is there a noise rule?" → güvenlik / çocuk kalemleri); (2) "açılıyor"
// ASCII katlamada "acil" → "Havuz ne zaman açılıyor?" ACİL DURUM kavramını tetikliyordu.
// ---------------------------------------------------------------------------
const items2 = [
  { id: "noise", category: "rules", title: "Noise", content: "Please keep the noise down after 22:00, the neighbours are close.", updatedAt: at(0) },
  { id: "trash", category: "trash", title: "Garbage", content: "Put the waste in the grey bins in front of the building.", updatedAt: at(1) },
  { id: "pool", category: "rules", title: "Havuz", content: "Havuz her sabah 09:00'da hizmete girer, akşam 20:00'de kapanır.", updatedAt: at(2) },
  { id: "safety", category: "general", title: "Acil durum", content: "Acil durumda 112'yi arayın; yangın tüpü mutfakta.", updatedAt: at(3) },
  { id: "hospital", category: "local_tips", title: "Sağlık", content: "En yakın hastane Sahil Devlet Hastanesi, arabayla 10 dakika.", updatedAt: at(4) },
  // "acil" sözcüğünü TAŞIMAYAN acil kalemi: yalnız kavram genişletmesiyle ("ambulans") bulunur → kavram yolunu ayrı sınar.
  { id: "amb", category: "general", title: "Sağlık hattı", content: "Ambulans için 112 aranır, bina adresi kapıda yazılı.", updatedAt: at(5) },
  ...neutralPadding(40),
];
const pick2 = (guestMessage: string) => selectKbForPrompt({ items: items2, guestMessage, mode: "hybrid", now: NOW }).items.map((i) => i.id);

describe("sözlük terimleri durak sözcüğe inmez + 'açılıyor' acil sayılmaz", () => {
  it("sözlük sözleşmesi: hiçbir tek kelimelik terimin kökü durak sözcük değil (mekanik pin)", () => {
    expect(lexiconProblems().filter((p) => p.includes("durak"))).toEqual([]);
    // Kural gerçekten yakalar (boş liste vakumlu olmasın).
    expect(lexiconProblems([{ id: "x", terms: ["was"] }]).some((p) => p.includes("durak"))).toBe(true);
    expect(stem("noise")).toBe("noise");
    expect(stem("waste")).toBe("waste");
    expect(stem("hastane")).toBe("hastane");
    expect(stem("isinmiyor")).toBe("isinmiyor");
  });

  it("🚨 'Is there a noise rule?' → gürültü kalemi başta · 'Where do I put the waste?' → çöp · 'En yakın hastane?' → sağlık", () => {
    expect(pick2("Is there a noise rule?")[0]).toBe("noise");
    expect(pick2("Where do I put the waste?")[0]).toBe("trash");
    expect(pick2("En yakın hastane nerede?")[0]).toBe("hospital");
  });

  it("🚨 'Havuz ne zaman açılıyor?' acil durum kavramını tetiklemez; havuz kalemi başta, acil kalemi seçimde YOK", () => {
    const toks = ["havuz", "ne", "zaman", "aciliyor"];
    expect(matchConcepts(contentStems("Havuz ne zaman açılıyor?"), { tokens: toks }).map((m) => m.concept.id)).not.toContain("emergency");
    const ids = pick2("Havuz ne zaman açılıyor?");
    expect(ids[0]).toBe("pool");
    expect(ids).not.toContain("safety");
    // Konusu bilgi tabanında olmayan "açıl-" sorusu: acil kavramının genişletmesi ("ambulans", "hastane") kalem ÇEKMEZ.
    expect(pick2("Market ne zaman açılıyor?")).not.toContain("amb");
    expect(pick2("Kapı açılmıyor")).not.toContain("hospital");
  });

  it("KONTROL — gerçek acil hâlâ acil: 'Acil durum var!' / 'acilen yardım lazım' → acil kavramı ve kalemi", () => {
    for (const msg of ["Acil durum var!", "acilen yardım lazım"]) {
      expect(pick2(msg), msg).toContain("safety");
    }
    // İnce takip sorusu: geçmişteki GERÇEK "acil" taşınır (taşınan mesajın ham belirteçleri de korumaya girer).
    // Önceki "ACİL!" CEVAPLANMIŞ (bekleyen alt sorgu değil) → yalnız taşınan kökten gelir; kavram yolu taşınan belirteçle açılır.
    const thin = selectKbForPrompt({
      items: items2,
      guestMessage: "Ne yapayım?",
      history: [
        { direction: "inbound", body: "ACİL!" },
        { direction: "outbound", body: "Hemen 112 arayın lütfen." },
        { direction: "inbound", body: "Ne yapayım?" },
      ],
      mode: "hybrid",
      now: NOW,
    });
    expect(thin.items.map((i) => i.id)).toContain("amb");
    expect(thin.evidence?.fb).toBe("none");
    // Belirteç verilmeyen çağıran (saat alanı kuralı) DEĞİŞMEDİ: kök tek başına eskisi gibi kavramı tanır.
    expect(matchConcepts(contentStems("Havuz ne zaman açılıyor?")).map((m) => m.concept.id)).toContain("emergency");
  });

  it("parite: getirmenin 'acil' yüzey biçimleri = güvenlik sınıflandırıcısının tam sözcük listesindeki 'acil' ailesi", async () => {
    const { SAFETY_CRITICAL_WHOLE_WORDS } = await import("@/lib/ai/fallback");
    expect([...EMERGENCY_ACIL_FORMS].sort()).toEqual(SAFETY_CRITICAL_WHOLE_WORDS.filter((w: string) => w.startsWith("acil")).sort());
  });
});
