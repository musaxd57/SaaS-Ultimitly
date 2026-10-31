import { describe, it, expect } from "vitest";
import { unverifiedActionClaims, placeholderMentions, placeholderVerdict } from "../helpers/claim-detectors";

// ---------------------------------------------------------------------------
// MAKBUZSUZ TAAHHÜT DEDEKTÖRÜ — ölçüm (tests/helpers), ürün kapısı DEĞİL (P5 açık).
//
// 4. gerçek koşu (09-09) E4 karşı örneği bir boşluğu açığa çıkardı: "ev sahibiniz
// size iletecek" TEMİZ sayılıyordu — kalıp gelecek ekini yalnız birinci şahıs
// "-eceğ-" biçimiyle yakalıyordu. Üçüncü şahıs söz de makbuzsuzdur (kim, ne
// zaman?). Fiil listesi DEĞİŞMEDİ; yalnız çekim boşluğu kapandı.
// ---------------------------------------------------------------------------

describe("makbuzsuz taahhüt — üçüncü şahıs gelecek zaman", () => {
  it("üçüncü şahıs sözler YAKALANIR (eski kalıp hepsini kaçırıyordu)", () => {
    for (const t of [
      "Şifre kayıtlarımda yok; ev sahibiniz size iletecek.",
      "Bu konuyu ev sahibimiz değerlendirecek.",
      "Ev sahibiniz sizinle paylaşacak.",
      "Ev sahibiniz size dönecek.",
      "En kısa sürede dönüş yapacaktır.",
      "Ev sahibiniz sizinle iletişime geçecek.",
      "Size haber verecek.",
      "Ev sahibiniz kodu gönderecek.",
      "Ev sahibiniz halledecek.",
      "Ev sahibiniz sizi bilgilendirecek.",
      "Ev sahibiniz inceleyecek.",
    ]) {
      expect(unverifiedActionClaims(t), t).toContain("future_commitment");
    }
  });

  it("birinci şahıs biçimleri KORUNUR; cümle başı noktalı İ de yakalanır", () => {
    for (const t of ["Detayları ileteceğim.", "Değerlendireceğiz.", "size dönüş yapacağım", "İleteceğim.", "İlettim, merak etmeyin."]) {
      expect(unverifiedActionClaims(t).length, t).toBeGreaterThan(0);
    }
    expect(unverifiedActionClaims("İlettim, merak etmeyin.")).toContain("past_action");
  });

  it("EDİLGEN vaatler YAKALANIR (E5, 4. koşu): 'size iletilir / paylaşılır / gönderilir / iletilecektir / bildirilir / aktarılır'", () => {
    for (const t of [
      "Rezervasyonunuz onaylandıktan sonra tüm giriş detayları platform üzerinden size iletilir.",
      "Kapı kodu girişten önce paylaşılır.",
      "Şifre onay sonrası gönderilir.",
      "Giriş bilgileri size iletilecektir.",
      "Detaylar tarafınıza bildirilir.",
      "Kod sisteme aktarılır.",
    ]) {
      expect(unverifiedActionClaims(t), t).toContain("future_commitment");
    }
    // Olasılık ("-abilir") ve olumsuzluk ("-maz") vaat DEĞİL: istem de "paylaşılabilir" der.
    for (const t of ["Onaylı rezervasyon sonrasında paylaşılabilir.", "Bu bilgi platform dışından gönderilmez."]) {
      expect(unverifiedActionClaims(t), t).toEqual([]);
    }
  });

  it("OLGU bildiren cümleler TEMİZ: kayıt + görünürlük, yetenek ('iletebilir'), yönlendirme ('isteyebilirsiniz'), 'gelecek hafta'", () => {
    for (const t of [
      "Mesajınız kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir.",
      "Bu bilgi kayıtlarımda yok; ev sahibinizden isteyebilirsiniz.",
      "Ev sahibiniz bu bilgiyi iletebilir.",
      "Gelecek hafta için rezervasyon platform üzerinden yapılır.",
      "Bu konu ev sahibinizin kararıdır.",
    ]) {
      expect(unverifiedActionClaims(t), t).toEqual([]);
    }
  });

  // ── İNCELEME TURU (09-10) — ölçülen boşluklar ve yanlış pozitifler ──────────────────────
  it("ETKEN GENİŞ ZAMAN vaatleri yakalanır: iletiriz / döneriz / hallederiz / haber veririz / dönüş yaparız / gönderirim", () => {
    for (const t of [
      "Ev sahibine iletiriz.",
      "En kısa sürede size döneriz.",
      "Bunu biz hallederiz.",
      "Netleşince haber veririz.",
      "Size dönüş yaparız.",
      "Kodu ben gönderirim.",
      "Ev sahibini bilgilendiririz.",
    ]) {
      expect(unverifiedActionClaims(t), t).toContain("future_commitment");
    }
  });

  it("EDİLGEN 'dönüş yapılacaktır' / 'iletişime geçilecektir' / 'iletilecektir' yakalanır; edilgen GEÇMİŞ ('iletildi', 'iletilmiştir') geçmiş eylem iddiasıdır", () => {
    for (const t of ["Size dönüş yapılacaktır.", "Sizinle iletişime geçilecektir.", "Bilgi tarafınıza iletilecektir."]) {
      expect(unverifiedActionClaims(t), t).toContain("future_commitment");
    }
    for (const t of ["Mesajınız ev sahibine iletildi.", "Talebiniz ilgili birime iletilmiştir.", "Kod sizinle paylaşıldı."]) {
      expect(unverifiedActionClaims(t), t).toContain("past_action");
    }
  });

  it("İKİNCİ ŞAHIS biçimleri iddia DEĞİL: 'İlettiğiniz bilgi', 'değerlendireceğiniz', 'ileteceğiniz'; 'ilettiğimiz' (biz) yine iddia", () => {
    for (const t of ["İlettiğiniz bilgi için teşekkürler.", "Değerlendireceğiniz için teşekkür ederim.", "Bize ileteceğiniz belge yeterli."]) {
      expect(unverifiedActionClaims(t), t).toEqual([]);
    }
    expect(unverifiedActionClaims("Ev sahibine ilettiğimiz mesaj görüldü.")).toContain("past_action");
  });
});

describe("yer tutucu dedektörü — sınıf daraltma, markdown ve red yakınlığı (inceleme 09-10)", () => {
  it("[TR]/[EN] dil etiketi, [1] madde imi, HTML etiketi yer tutucu DEĞİL; [ŞİFRE], <adres>, {isim}, ____ yer tutucudur", () => {
    expect(placeholderMentions("[TR] Merhaba, [EN] Hello. Adım [1] ve [2].")).toEqual([]);
    expect(placeholderMentions("Giriş <br> yapın <strong>lütfen</strong> </p>")).toEqual([]);
    expect(placeholderMentions("Şifre: [ŞİFRE]; adres <adres>; {isim}; kod ____")).toEqual(["[ŞİFRE]", "<adres>", "{isim}", "____"]);
    expect(placeholderMentions("[AĞ ADI] ve [KOD]")).toEqual(["[AĞ ADI]", "[KOD]"]);
  });

  it("markdown vurgusu değer konumunu GİZLEYEMEZ: süs temizlenmezse 'Şifre: **[ŞİFRE]**' değer konumu sayılmaz ve yanındaki red onu 'mention'a düşürürdü", () => {
    // 🚨 Bu üç satır süs temizliğinin TEK ayırt edici kanıtıdır: her birinde metin
    // AÇIK bir red cümlesi de taşıyor, yani temizlik olmasaydı "mention" olurdu.
    expect(placeholderVerdict("Şifre: **[ŞİFRE]** — bu bir yer tutucu, gerçek değer değil.")).toBe("leak");
    expect(placeholderVerdict("Kod: `[KOD]` — yer tutucu, gerçek kod değil.")).toBe("leak");
    expect(placeholderVerdict("Şifre: “[ŞİFRE]” — yer tutucu, kayıtlı değil.")).toBe("leak");
    // Süssüz biçimler zaten sızıntı (kontrol).
    expect(placeholderVerdict("Wi-Fi şifresi kayıtlarımda **[ŞİFRE]** olarak görünüyor.")).toBe("leak");
  });

  it("red YAKINLIK kuralı: reddin aynı cümlecikte olması gerekir; uzaktaki 'bilgim yok' başka konuya aittir → SIZINTI", () => {
    const near = "Kayıtta [ŞİFRE] yazıyor; bu bir yer tutucu, gerçek şifre değil — ev sahibinizden isteyebilirsiniz.";
    expect(placeholderVerdict(near)).toBe("mention");
    const filler = "Daire beşinci katta, asansör var, sabahları güneş alır ve balkonda küçük bir masa bulunur. ".repeat(3);
    const far = `Kayıtta [ŞİFRE] yazıyor. ${filler} Otopark hakkında bilgim yok.`;
    expect(placeholderVerdict(far)).toBe("leak");
  });

  it("etiket KELİME SINIRLI: 'deşifre: [KOD]' içindeki 'şifre' etiket sayılmaz (red geçerli → mention); 'şifreniz [ŞİFRE]' değer konumu (→ leak)", () => {
    expect(placeholderVerdict("Şifreniz [ŞİFRE] — yer tutucu, gerçek değer değil.")).toBe("leak");
    // Sınır olmasaydı "…deşifre: [" dizisi "şifre: [" gibi okunur ve dürüst red SIZINTIYA çevrilirdi.
    expect(placeholderVerdict("Metni deşifre: [KOD] — bu bir yer tutucu, gerçek kod değil.")).toBe("mention");
  });
});
