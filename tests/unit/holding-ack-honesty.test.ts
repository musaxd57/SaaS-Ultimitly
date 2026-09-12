import { describe, it, expect } from "vitest";
import { holdingAckText, HOLDING_ACK_LANGS } from "@/lib/automation";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { unverifiedActionClaims } from "../helpers/claim-detectors";

// ---------------------------------------------------------------------------
// BEKLETME MESAJI (tier-2 holding ack) — DÜRÜSTLÜK SÖZLEŞMESİ (denetim §B).
//
// 🚨 ÖLÇÜLEN KUSUR: altı dilin altısı da "Mesajınızı ev sahibimize İLETTİM;
// en kısa sürede sizinle İLGİLENECEK" diyordu. İkisi de makbuzsuz:
//  · "ilettim" — AI'ın kendi eylem iddiası; hiçbir yerde makbuzu yok
//    (`actionReceipt` uygulanmamış).
//  · "ilgilenecek" — ÜÇÜNCÜ ŞAHSIN (host'un) GELECEK eylemi. Ürün bunu hiçbir
//    koşulda garanti edemez; host hiç açmayabilir.
// Üstelik model yolunda e-posta `if (to)` bloğunun İÇİNDE, `maybeSendHoldingAck`
// ise DIŞINDA — yani alıcısı olmayan (ya da e-postası kalıcı bozuk) bir org'da
// host'a HİÇBİR ŞEY gitmezken misafir o cümleyi okuyordu.
//
// ── ÇAĞRI ANINDA GARANTİ OLAN TEK ŞEY ────────────────────────────────────────
// `maybeSendHoldingAck`in kendi sözleşmesi: "The CALLER must have already
// atomically claimed the conversation into 'problem'". Yani konuşma host'un
// panelinde ÖNCELİKLİ olarak işaretlidir — bu SERT bir garanti, e-postadan da
// modelden de bağımsız. Metin YALNIZ bunu söyleyebilir.
//
// ⚠️ Bu dosya `escalationReply()` ve `prompts.ts` çapasıyla AYNI sınıftadır:
// kayıt + görünürlük bildirilir, SÖZ verilmez. Üç yüzey tek sözleşme.
// ---------------------------------------------------------------------------

/** Ürünün kendi vetosu bu metinlerin üzerinden HİÇ geçmiyor (muafiyet: devir
 *  akışı) — o yüzden metnin dürüstlüğü BURADA, kaynağında pinlenir. */
describe("bekletme mesajı — makbuzsuz iddia YOK (altı dil)", () => {
  it("altı dilin altısı da gerçekten okunuyor (anti-vakumluk)", () => {
    expect([...HOLDING_ACK_LANGS].sort()).toEqual(["ar", "de", "en", "fr", "ru", "tr"]);
    for (const lang of HOLDING_ACK_LANGS) {
      expect(holdingAckText(lang).length, lang).toBeGreaterThan(40);
    }
  });

  it("🚨 ÜRÜN VETOSU hiçbir dilde tetiklenmiyor", () => {
    for (const lang of HOLDING_ACK_LANGS) {
      expect(vetoOutgoingReply(holdingAckText(lang)), lang).toBeNull();
    }
  });

  it("🚨 ölçüm dedektörü (TR) de temiz", () => {
    expect(unverifiedActionClaims(holdingAckText("tr"))).toEqual([]);
  });

  it("🚨 HOST'UN GELECEK EYLEMİ hiçbir dilde VAAT EDİLMİYOR", () => {
    // Ölçülen eski metinlerin tam da bu parçaları. Yasak liste DEĞİL: her biri
    // "host şunu YAPACAK" diyen, ürünün doğrulayamadığı bir cümleciktir.
    const vaatler: Record<string, RegExp> = {
      tr: /ilgilenecek|dönüş yapacak|ileteceğ|ilettim/i,
      en: /will follow up|will get back|I've passed|I have passed/i,
      de: /weitergeleitet|erhalten in Kürze|Rückmeldung/i,
      fr: /transmis|reviendra vers vous/i,
      ru: /свяжутся|передано/i,
      ar: /سيتواصل|أرسلت/,
    };
    for (const lang of HOLDING_ACK_LANGS) {
      expect(holdingAckText(lang), lang).not.toMatch(vaatler[lang]);
    }
  });

  it("metinler dile göre HÂLÂ farklı (tek stringe çökertilerek 'temizlenmedi')", () => {
    const hepsi = HOLDING_ACK_LANGS.map((l) => holdingAckText(l));
    expect(new Set(hepsi).size).toBe(HOLDING_ACK_LANGS.length);
  });

  it("bilinmeyen dil İngilizceye düşer (davranış değişmedi)", () => {
    expect(holdingAckText("zz")).toBe(holdingAckText("en"));
  });

  it("ünlem yok (guest-text-quality sözleşmesiyle parite)", () => {
    for (const lang of HOLDING_ACK_LANGS) {
      expect(holdingAckText(lang), lang).not.toMatch(/!/);
    }
  });
});

describe("bekletme mesajı — İŞE YARAR parçalar KORUNDU", () => {
  it("özür + fotoğraf/ayrıntı isteği her dilde duruyor", () => {
    // Dürüstleştirme, mesajı işe yaramaz hâle getirmenin bahanesi değil:
    // misafirin YAPABİLECEĞİ tek şey ayrıntı/fotoğraf paylaşmaktır ve o istek
    // bir vaat değildir.
    const foto: Record<string, RegExp> = {
      tr: /fotoğraf/i,
      en: /photo/i,
      de: /Foto/i,
      fr: /photo/i,
      ru: /фото/i,
      ar: /صورة/,
    };
    for (const lang of HOLDING_ACK_LANGS) {
      expect(holdingAckText(lang), lang).toMatch(foto[lang]);
    }
  });

  it("🚨 GARANTİ EDİLEN OLGU söyleniyor — kayıt + host için işaretlenme", () => {
    // Anti-vakumluk: metin yalnız "özür + fotoğraf"a indirgenmiş olmasın;
    // misafir mesajının BİR YERE düştüğünü öğrenmeli (devir metniyle aynı sınıf).
    const olgu: Record<string, RegExp> = {
      tr: /kaydedildi/i,
      en: /recorded/i,
      de: /erfasst/i,
      fr: /enregistré/i,
      ru: /сохранено/i,
      ar: /تسجيل/,
    };
    for (const lang of HOLDING_ACK_LANGS) {
      expect(holdingAckText(lang), lang).toMatch(olgu[lang]);
    }
  });
});
