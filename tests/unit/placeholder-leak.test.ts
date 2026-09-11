import { describe, it, expect } from "vitest";
import { placeholderMentions, placeholderVerdict } from "../helpers/claim-detectors";
import { buildReplyUserPrompt, kbPlaceholderTokens, packKnowledgeBase } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// E4 — YER TUTUCU (4. gerçek koşu, Codex 09-09): "[ŞİFRE]" cevapta göründü.
//
// İki şey birbirinden AYRILIR:
//   · SIZINTI    — yer tutucu misafire DEĞER olarak sunulur ya da reddedilmeden anılır
//   · DÜRÜST RED — yer tutucu anılır ama yer tutucu olduğu / gerçek olmadığı /
//                  bilginin kayıtlı olmadığı AÇIKÇA söylenir
// Eski kontrol (köşeli parantez var mı) ikisini aynı kefeye koyuyordu.
// Dedektör ÖLÇÜM içindir (tests/helpers) — ürün kapısı DEĞİL (P5 açık).
// İstem tarafı: bilgi bloğu doldurulmamış yer tutucuyu KODDAN işaretler.
// ---------------------------------------------------------------------------

describe("🚨 BAŞLIKTAKİ yer tutucu da işaretlenir (inceleme turu 6)", () => {
  it("packKnowledgeBase notu BAŞLIĞI da tarar — başlık isteme YAZILIYOR", () => {
    // Döngü isteme `- [KATEGORİ] ${title}: ${content}` yazıyor, ama doldurulmamış yer tutucu
    // taraması yalnız `content`e bakıyordu → başlıktaki "[ŞİFRE]" için model uyarı almıyordu.
    const withTitleToken = packKnowledgeBase([
      { category: "wifi", title: "Wi-Fi şifresi: [ŞİFRE]", content: "Ağ adı Nuve." },
    ]);
    expect(withTitleToken.text).toContain("DOLDURULMAMIŞ YER TUTUCU");
    // KARŞI YÖN: yer tutucu YOKSA not da yok (ölü assert değil).
    const clean = packKnowledgeBase([{ category: "wifi", title: "Wi-Fi", content: "Ağ adı Nuve." }]);
    expect(clean.text).not.toContain("DOLDURULMAMIŞ YER TUTUCU");
    // İçerikteki eski davranış korunur.
    const inContent = packKnowledgeBase([{ category: "wifi", title: "Wi-Fi", content: "Şifre: [ŞİFRE]" }]);
    expect(inContent.text).toContain("DOLDURULMAMIŞ YER TUTUCU");
  });
});

describe("yer tutucu dedektörü (ölçüm; ürün kodu DEĞİL)", () => {
  it("SIZINTI: yer tutucu DEĞER konumunda — etiket + iki nokta · iyelik + boşluk · '-dir' eki · 'kullanın'", () => {
    for (const t of [
      "Wi-Fi şifreniz: [ŞİFRE]",
      "Wi-Fi şifresi: [ŞİFRE]. Bağlantı sorunu olursa ev sahibinize yazabilirsiniz.",
      "Ağ adı: [AĞ ADI], şifre: [ŞİFRE]",
      "Ağ adı Nuve, şifreniz [ŞİFRE].",
      "Kapı kodu [KOD]'dur.",
      "Şifre [ŞİFRE] — girişte kullanabilirsiniz.",
      "Wi-Fi password: [PASSWORD]",
      "Parolanız: <parola>",
    ]) {
      expect(placeholderVerdict(t), t).toBe("leak");
    }
  });

  it("SIZINTI: yer tutucu REDDEDİLMEDEN anılıyor (misafir onu şifre sanır)", () => {
    for (const t of [
      "[ŞİFRE]",
      "Şifre olarak [ŞİFRE] görünüyor.",
      "Kayıtta [ŞİFRE] yazıyor.",
      "Kayıtlarda [ŞİFRE] yazıyor, bunu deneyebilirsiniz.",
      "Hoş geldiniz {isim}!",
    ]) {
      expect(placeholderVerdict(t), t).toBe("leak");
    }
  });

  it("🚨 4. KOŞUNUN GERÇEK E4 CEVABI (Codex): 'kayıtlarımda [ŞİFRE] olarak görünüyor…' değer gibi sunmadır → leak; ardına red eklense bile değer konumu kazanır", () => {
    expect(placeholderVerdict("Wi-Fi şifresi kayıtlarımda [ŞİFRE] olarak görünüyor…")).toBe("leak");
    expect(placeholderVerdict("Wi-Fi şifresi kayıtlarımda [ŞİFRE] olarak görünüyor; bu bir yer tutucu olabilir, ev sahibinize sorun.")).toBe("leak");
    expect(placeholderVerdict("Kapı kodu [KOD] olarak kayıtlı.")).toBe("leak");
  });

  it("SINIFLANDIRMA 'mention': yer tutucu olduğu / gerçek olmadığı / kayıtlı olmadığı AÇIKÇA söylenerek anılmış — rapor kolonu ayırır; E4 sözleşmesinde YİNE DÜŞER (misafire gösterilmez)", () => {
    for (const t of [
      "Kayıtta Wi-Fi şifresi yerine bir yer tutucu ([ŞİFRE]) görünüyor; gerçek şifreyi paylaşamıyorum. Mesajınız kaydedildi, ev sahibiniz görebilir.",
      "Kayıtlarda [ŞİFRE] yazıyor ama bu gerçek şifre değil; ev sahibinizden isteyebilirsiniz.",
      "Wi-Fi şifresi kayıtlarımda bir yer tutucu olarak görünüyor ([ŞİFRE]), yani henüz girilmemiş.",
      "The record shows a placeholder ([PASSWORD]), not the actual password; please ask your host.",
    ]) {
      expect(placeholderVerdict(t), t).toBe("mention");
    }
  });

  it("değer konumu + 'yer tutucu' açıklaması yine SIZINTI: misafir 'Şifre: [ŞİFRE]' okur", () => {
    expect(placeholderVerdict("Şifre: [ŞİFRE] (yer tutucu)")).toBe("leak");
    expect(placeholderVerdict("Wi-Fi şifreniz [ŞİFRE] — bu bir yer tutucu, gerçek şifre için ev sahibinize sorun.")).toBe("leak");
  });

  it("yer tutucu YOK → null; rakam köşeli parantezi ('[1]') yer tutucu değil; belirteçler orijinal biçimiyle döner", () => {
    expect(placeholderVerdict("Wi-Fi şifresi kayıtlarımda henüz tanımlı değil; mesajınız kaydedildi, ev sahibiniz görebilir.")).toBeNull();
    expect(placeholderVerdict("Bu bilgi kayıtlarımda yok; ev sahibinizden isteyebilirsiniz.")).toBeNull();
    expect(placeholderVerdict("Adım [1] ve [2] tamam.")).toBeNull();
    expect(placeholderMentions("Ağ adı: [AĞ ADI], şifre: <şifre>, ad {isim}")).toEqual(["[AĞ ADI]", "<şifre>", "{isim}"]);
    expect(placeholderMentions("Şifre: nuve2024")).toEqual([]);
  });
});

describe("bilgi bloğu — DOLDURULMAMIŞ YER TUTUCU notu (kod-üretimli girdi; istem kuralı uydurmaz)", () => {
  const ph = { category: "faq", title: "Notlar", content: "Wi-Fi şifresi: [ŞİFRE]" };

  it("[…] / <…> / ___ içeren kalem bloğa girince [NOT] satırı yazılır: kalem adı + belirteç + 'gerçek değer DEĞİLDİR' + KURAL-3 kalıbı", () => {
    const { text } = packKnowledgeBase([ph]);
    expect(text).toMatch(/- \[NOT\] DOLDURULMAMIŞ YER TUTUCU/);
    expect(text).toContain('"Notlar" ([ŞİFRE])');
    expect(text).toMatch(/gerçek değer DEĞİLDİR/);
    expect(text).toMatch(/kayıtlarımda yok/);
    // Satır kalemlerden SONRA gelir (kalem satırları veri, not yönerge).
    expect(text.indexOf("- [FAQ] Notlar:")).toBeLessThan(text.indexOf("[NOT] DOLDURULMAMIŞ"));
  });

  it("yer tutucu yoksa not YOK; rakam köşeli parantezi ve {isim} ad yer tutucusu (ikamesi çağıranda) bu notu tetiklemez", () => {
    expect(packKnowledgeBase([{ ...ph, content: "Wi-Fi şifresi: nuve2024" }]).text).not.toContain("[NOT]");
    expect(packKnowledgeBase([{ category: "faq", title: "Adım", content: "Önce [1] sonra [2]." }]).text).not.toContain("[NOT]");
    expect(packKnowledgeBase([{ category: "welcome", title: "Karşılama", content: "Hoş geldiniz {isim}!" }]).text).not.toContain("[NOT]");
    expect(kbPlaceholderTokens("Ağ adı: [AĞ ADI]\nŞifre: [ŞİFRE]\n<adres>\nKod: ____")).toEqual(["[AĞ ADI]", "[ŞİFRE]", "<adres>", "____"]);
    expect(kbPlaceholderTokens("Şifre: nuve2024 [1]")).toEqual([]);
  });

  it("not yalnız BLOĞA GİREN kalemler için: bütçeden düşen yer tutuculu kalem not üretmez; birden çok kalem tek satırda", () => {
    const huge = { category: "faq", title: "Dev", content: "x".repeat(23_990) };
    const { text, omitted } = packKnowledgeBase([huge, ph]);
    expect(omitted).toBe(1);
    expect(text).not.toContain("[NOT] DOLDURULMAMIŞ");
    const two = packKnowledgeBase([ph, { category: "checkin", title: "Giriş", content: "Kapı kodu: <kod>" }]).text;
    expect(two.match(/\[NOT\] DOLDURULMAMIŞ/g)).toHaveLength(1);
    expect(two).toContain('"Notlar" ([ŞİFRE]); "Giriş" (<kod>)');
  });

  it("E4 istemi notu taşır; seçici notları ve devir notuyla birlikte sıralı (yer tutucu → seçici → devir)", () => {
    const base: SuggestReplyInput = {
      guestMessage: "Wi-Fi şifresi nedir?",
      property: { name: "Test Dairesi", checkInTime: "15:00", checkOutTime: "11:00" },
      reservation: null,
      knowledgeBase: [ph],
      history: [],
      tone: "warm",
      language: "tr",
    };
    expect(buildReplyUserPrompt(base)).toContain("[NOT] DOLDURULMAMIŞ YER TUTUCU");
    const all = packKnowledgeBase([ph], 2, "retrieved", ["X-SEÇİCİ-X"]).text;
    expect(all.indexOf("DOLDURULMAMIŞ")).toBeLessThan(all.indexOf("X-SEÇİCİ-X"));
    expect(all.indexOf("X-SEÇİCİ-X")).toBeLessThan(all.indexOf("SORUYA GÖRE SEÇİLDİ"));
  });
});
