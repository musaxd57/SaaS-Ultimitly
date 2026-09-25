import { describe, it, expect } from "vitest";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// ÇIKTI VETOSU — Codex denetimi bulgu 1+5 (§A). Tasarım ÖLÇÜLEREK daraltıldı:
// kapıya YALNIZ ETKEN dallar bağlandı (77 meşru cevapta 0 yanlış pozitif).
//
// Bu dosya İKİ YÖNÜ de pinler:
//  · gerçek makbuzsuz iddia / yer tutucu DURUR
//  · meşru cevap (özellikle Türkçe EDİLGEN olgu bildirimi ve 2. şahıs
//    soru/koşul) GEÇMEYE DEVAM EDER — sınıfların TAMAMI ölçümden geldi
// ---------------------------------------------------------------------------

describe("çıktı vetosu — YER TUTUCU (sıfır belirsizlik)", () => {
  it("🚨 4. gerçek koşunun GERÇEK cevabı durur", () => {
    // Ölçülmüş metin: model bunu üretti, ürün MİSAFİRE DÖNDÜRDÜ.
    expect(
      vetoOutgoingReply("Wi-Fi şifresi kayıtlarımda [ŞİFRE] olarak görünüyor."),
    ).toBe("placeholder_in_reply");
  });

  it("üç yer tutucu sınıfı da durur", () => {
    expect(vetoOutgoingReply("Adres: [AÇIK ADRES]")).toBe("placeholder_in_reply");
    expect(vetoOutgoingReply("Anahtar: <ANAHTAR TESLİM>")).toBe("placeholder_in_reply");
    expect(vetoOutgoingReply("Wi-Fi: {{wifiInfo}}")).toBe("placeholder_in_reply");
  });

  it("ÇÖZÜLEN belirteçler durdurmaz (aşırı uygulama kontrolü)", () => {
    // `{isim}`/`{daire}` gönderim anında çözülür — yer tutucu SAYILMAZ.
    expect(vetoOutgoingReply("Merhaba {isim}, hoş geldiniz.")).toBeNull();
    expect(vetoOutgoingReply("Daire {daire}")).toBeNull();
    // Madde imi yer tutucu değildir.
    expect(vetoOutgoingReply("Kurallar [1] sessizlik [2] sigara yok")).toBeNull();
  });
});

describe("çıktı vetosu — ETKEN makbuzsuz iddia DURUR", () => {
  const durmali = [
    "Temizlik ekibine ilettim.",
    "Talebinizi oluşturdum.",
    "Kontrol ettim, sorun yok.",
    "Mesajınızı not ettim.",
    "En kısa sürede döneceğim.",
    "Size ileteceğim.",
    "Ev sahibiniz dönüş yapacaktır.",
    "Ekip iletecek.",
    "Ev sahibimiz değerlendirecek.",
    "Hallederiz.",
    "Haber veririz.",
    "İletişime geçeceğiz.",
  ];
  for (const t of durmali) {
    it(`durur: ${t}`, () => expect(vetoOutgoingReply(t)).toBe("unverified_commitment"));
  }

  it("🚨 cümle BAŞINDAKİ noktalı İ de yakalanır (iki katlama)", () => {
    // `/i` bayrağı İ ↔ i katlamaz; ham metin TEK BAŞINA yetmez.
    expect(vetoOutgoingReply("İlettim, merak etmeyin.")).toBe("unverified_commitment");
    expect(vetoOutgoingReply("İleteceğim.")).toBe("unverified_commitment");
  });
});

describe("çıktı vetosu — 09-25 kaçan ETKEN iddialar (mesaj anlama çekirdeği denetimi + iki inceleme)", () => {
  // Ölçüldü: bu cümlelerin hepsi veto'dan geçiyordu. Aynı disiplin (etken 1. şahıs / ajan çapası, edilgen dal YOK). Model
  // cevabı korpusunda (1.287: cevap kıyası ×4 + konaklama eval'i) turun öncesine göre fark yalnız 2 yeni veto, ikisi de
  // gerçek iddia ("Tarihlerinizi … güncelledim", "Ertelemeyi hallettim"); geçen cevaplardan hiçbiri düşmedi.
  const durmali = [
    "Ev sahibinize haber verdim.",
    "Temizlikçiyi aradım, 15:00'te gelecek.",
    "Taksinizi rezerve ettim.",
    "Talebinizi ev sahibine yönlendirdim.",
    "Sorunu hallettim.",
    "Erken girişinizi onayladım.",
    "Kaydınızı güncelledim.",
    "Ev sahibiyle görüştüm.",
    "Teknisyene mesaj attım.",
    "Konuyu ev sahibine bildirmiş bulunuyorum.",
    "Durumu ev sahibine iletiyorum.",
    "Talebinizi yönlendiriyorum.",
    "I have booked a taxi for you.",
    "I have passed your message to the host.",
    "I have notified the host.",
    "I've let the host know.",
    "We've notified the cleaning team.",
    "We've forwarded it.",
    "I've already forwarded your message to the host.",
    "I've reported the issue to maintenance.",
    "I have escalated this to the host.",
    "I'm forwarding this to the host.",
    "I'll pass this on.",
    "I'll ask the host.",
    // Kıvrık kesme işareti (model çıktısında sık; hepsi geçiyordu).
    "I’ve booked a taxi for 9:00.",
    "We’ve notified the cleaning team.",
    "I’ll get back to you shortly.",
  ];
  for (const t of durmali) {
    it(`durur: ${t}`, () => expect(vetoOutgoingReply(t)).toBe("unverified_commitment"));
  }

  it("aynı kökler 2. şahıs / sıfat-fiil / SORU / önceki gerçek mesaja atıf / ev sahibi olgusu biçiminde GEÇER", () => {
    for (const t of [
      "Haber verdiğiniz için teşekkürler.",
      "Paylaştığınız bilgi için teşekkürler.",
      "Aradığınız bilgi panoda yazıyor.",
      "Yukarıda paylaştığım gibi giriş 15:00'te.",
      "Daha önce gönderdiğim mesajda adres var.",
      "Could you send a photo of the issue?",
      "Have you called the building manager?",
      "If you have booked a taxi, the driver can wait at the entrance.",
      // İnceleme (09-25) — ilk genişletmenin yanlış pozitifleri:
      "Size ulaştık mı?",
      "Sizi aradık mı?",
      "Bilgileri aşağıda paylaştım: Wi-Fi Lale2025",
      "Giriş talimatlarını dün size gönderdik; kapı kodu orada.",
      "Wi-Fi bilgilerini giriş mesajında paylaştık.",
      "The check-in instructions we sent this morning include the door code.",
      "The code is in the message I sent you yesterday.",
      "We have reserved a parking spot for every apartment.",
      "We have scheduled housekeeping every Wednesday.",
      "We called it the blue room.",
      "We have booked this flat for you from 15 to 18 October.",
    ]) {
      expect(vetoOutgoingReply(t), t).toBeNull();
    }
  });
});

describe("🚨 MEŞRU CEVAPLAR GEÇER — ölçülen yanlış pozitif sınıfları", () => {
  const gecmeli = [
    // ── EDİLGEN OLGU BİLDİRİMİ: kapıya BİLEREK bağlanmadı (ölçüldü: bu sınıf
    //    9 yanlış pozitifin 7'siydi ve hepsi oto-yanıtın VAR OLMA SEBEBİ) ──
    "Gürültü şikâyetleri site yönetimine bildirilir.",
    "Kurallara uyulmadığında durum apartman yönetimine iletilir.",
    "Fatura, konaklama sonunda e-posta ile gönderilir.",
    "Kat görevlisinin telefonu giriş kapısındaki panoda paylaşılır.",
    "Havuz, sitedeki diğer dairelerle birlikte paylaşılır.",
    "Bina kuralları kira sözleşmesinde bildirilmiştir.",
    "Tüm ev kuralları ilan sayfasında paylaşılmıştır.",
    // ── 2. ŞAHIS SORU/KOŞUL: lookahead genişletmesi (düzeltme ①) ──
    "Fotoğrafı gönderecek misiniz, yoksa tarif etmeniz yeterli mi?",
    "Talebinizi yazılı olarak iletecekseniz, buraya mesaj bırakabilirsiniz.",
    "Değerlendireceğiniz için teşekkürler.",
    // ── Düz bilgi / kural / netleştirme ──
    "Giriş saati 15:00, çıkış 11:00.",
    "Bina girişinden sonra sağdaki asansörü kullanabilirsiniz.",
    "Dairede sigara içilmemektedir.",
    "Hangi tarih için sormuştunuz?",
    "Hoş geldiniz, iyi tatiller dileriz.",
    // ── Misafirin KENDİ eylemi (2. şahıs geçmiş) ──
    "Gönderdiğiniz fotoğraf için teşekkürler.",
    "İlettiğiniz bilgi için teşekkürler.",
    // ── Olasılık kipi: vaat DEĞİL ──
    "Otopark dolu olabilir.",
    "Bu bilgi ev sahibinizle paylaşılabilir.",
    // ── Tuzak: "ilet/gönder" kökü İSİM olarak ──
    "İletişim bilgileri panoda yazıyor.",
    "Otobüs aktarması Kadıköy'de.",
    "Paylaşımlı alan 7/24 açıktır.",
  ];
  for (const t of gecmeli) {
    it(`geçer: ${t}`, () => expect(vetoOutgoingReply(t)).toBeNull());
  }
});

describe("sözleşme", () => {
  it("boş/eksik girdi hüküm üretmez", () => {
    expect(vetoOutgoingReply("")).toBeNull();
    expect(vetoOutgoingReply("   ")).toBeNull();
    expect(vetoOutgoingReply(null)).toBeNull();
    expect(vetoOutgoingReply(undefined)).toBeNull();
  });

  it("YER TUTUCU önce değerlendirilir (iki sebep varsa tek gerekçe)", () => {
    expect(vetoOutgoingReply("İlettim; şifre [ŞİFRE].")).toBe("placeholder_in_reply");
  });

  it("✅ İNGİLİZCE KAPANDI (kurucu 09-12) — eski 'kapsam sıfır' pini TERS ÇEVRİLDİ", () => {
    // Bu satırlar 09-12'ye kadar `toBeNull()` idi ve "bilinçli sınır" diye
    // yazılıydı. Kurucu "kapatmadıklarını kapat" dedi → aynı disiplinle eklendi.
    expect(vetoOutgoingReply("I've forwarded your request to the cleaning team.")).toBe(
      "unverified_commitment",
    );
    // Kurucunun ADIYLA ANDIĞI cümle.
    expect(vetoOutgoingReply("The team will get back to you shortly.")).toBe(
      "unverified_commitment",
    );
    expect(vetoOutgoingReply("Your host will contact you soon.")).toBe("unverified_commitment");
    expect(vetoOutgoingReply("I have created a maintenance ticket for you.")).toBe(
      "unverified_commitment",
    );
  });

  it("🚨 ÇIPLAK `will` HÜKÜM VERMEZ — yoksa meşru olgu cümleleri katledilirdi", () => {
    // Ölçüldü: agent çapası olmadan bu dördü de bloklanırdı.
    expect(vetoOutgoingReply("Check-in will be at 15:00 and check-out at 11:00.")).toBeNull();
    expect(vetoOutgoingReply("The pool will be open from 09:00.")).toBeNull();
    expect(vetoOutgoingReply("You will find the towels in the bathroom cupboard.")).toBeNull();
    expect(vetoOutgoingReply("I will be honest: the flat has no balcony.")).toBeNull();
  });

  it("İngilizce meşru cevaplar GEÇER (aşırı uygulama kontrolü)", () => {
    for (const t of [
      "Breakfast is served between 08:00 and 10:00.",
      "Towels are provided and changed every three days.",
      "Which date were you asking about?",
      "Could you send a photo of the issue?",
      "Thank you for the photo you sent.",
      "You can contact your host through the platform.",
      "The host may be able to arrange an early check-in.",
      "The cleaning team comes every Tuesday.",
      "Our team is available from 09:00 to 18:00.",
    ]) {
      expect(vetoOutgoingReply(t), t).toBeNull();
    }
  });

  it("⚠️ İngilizcede de EDİLGEN dal YOK (Türkçeyle aynı gerekçe)", () => {
    // "has been passed on" ile "is served at 8" aynı belirsizliği taşır.
    expect(vetoOutgoingReply("Your message has been passed on to your host.")).toBeNull();
    expect(vetoOutgoingReply("The details will be shared with you shortly.")).toBeNull();
  });

  it("✅ DE/FR/ES/RU/AR 1. şahıs iletişim/rezervasyon iddiası da durur (09-25: dil kapısı artık misafirin dilinde cevap verdiriyor)", () => {
    for (const t of [
      "Ich habe Ihre Nachricht weitergeleitet.",
      "Ich habe Ihre Nachricht an den Gastgeber weitergeleitet.",
      "J'ai transmis votre message à l'hôte.",
      "He informado al anfitrión.",
      "Я передал ваше сообщение хозяину.",
      "لقد أبلغت المضيف.",
    ]) {
      expect(vetoOutgoingReply(t), t).toBe("unverified_commitment");
    }
    // Edilgen ve olgu cümleleri bu dillerde de geçer (Türkçe/İngilizce ile aynı gerekçe).
    for (const t of ["Ihre Nachricht wurde weitergeleitet.", "Ich habe keine Informationen dazu.", "He visto su mensaje.", "Vous pouvez appeler l'hôte via la plateforme."]) {
      expect(vetoOutgoingReply(t), t).toBeNull();
    }
  });

  it("⚠️ EDİLGEN dal kapıda YOK — ölçülmüş bedel, test-pinli", () => {
    // Bu ikisi GERÇEK makbuzsuz iddiadır ama kapıya bağlanamaz: aynı dilbilgisi
    // meşru olgu bildirimini de yakalıyor (↑ sınıf). Bedel BURADA yazılı.
    expect(vetoOutgoingReply("Mesajınız ev sahibine iletildi.")).toBeNull();
    expect(vetoOutgoingReply("Giriş detayları size iletilir.")).toBeNull();
  });
});
