import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { passesAutoReplySafetyGate } from "@/lib/automation";

// ---------------------------------------------------------------------------
// KURUCU KURALI (09-11): **"bilgim yok" MİSAFİRE ASLA GİTMEZ.**
//
// > "müşteriye hiçbir zaman bilgim yok mesajı gitmemeli; bilgi yoksa da cevap
// >  gitmemeli — host neden 'bilgim yok' mesajı göndersin ki?"
//
// ÖLÇÜLEN DAVRANIŞ (2. gerçek koşu, 09-09): modelin güveni **.8**, kaynak **0/0**,
// cevap "kayıtlı bilgim yok; mesajınız kaydedildi…" → kapı ≥0.75 olduğu için
// GEÇİYORDU ve misafire gidiyordu.
//
// 🚨 İSTEM KURALI KALDIRILMADI (bilinçli): `prompts.ts` KURAL-3/KURAL-5 modele
// temellendiremediğinde yokluk söylemesini emreder ve o kural UYDURMAYI ENGELLER.
// Silinseydi model uydururdu — işe yaramaz bir cevaptan çok daha kötü. Kural
// istemde kalır, GÖNDERİM burada kapanır. Fail-safe doğru yönde: kapı delinirse
// misafir bozuk bir belirteç değil, dürüst bir cümle görür.
// ---------------------------------------------------------------------------

const BENIGN = { source: "openai", intent: "general", riskLevel: "low", confidence: 0.9, riskType: null };

describe("'bilgim yok' misafire GİTMEZ — oto-yanıt kapısı", () => {
  it("🚨 GÜVEN 0.9 OLSA BİLE yokluk itirafı gönderilmez", () => {
    for (const reply of [
      "Bu konuda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir.",
      // 🚨 İZOLE EDEN SATIRLAR (mutasyon turu): yukarıdaki cümle İKİ kalıba birden
      // uyuyor ("bilgim yok" VE "kayıtlı…bilgi"), yani her biri tek başına PİNSİZDİ —
      // mutantlar hayatta kalmıştı. Aşağıdaki ikisi kalıpları tek tek sınar.
      "Bu konuda bilgim yok.",                       // yalnız /bilgim yok/
      "Bu konuda kayıtlı bir bilgi mevcut değil.",   // yalnız `kayıtlı…bilgi`
      "Maalesef otopark hakkında bilgim bulunmuyor.",
      "Elimde bu konuda bir bilgi yok.",
      "I don't have any specific information about parking in my records.",
      "There is no record of that in my notes.",
    ]) {
      expect(passesAutoReplySafetyGate({ ...BENIGN, reply }, "Otopark var mı?"), reply).toBe(false);
    }
  });

  it("🚨 BEDEL PİNİ: kaynaksız AMA dayanaklı cevap GİTMEYE DEVAM EDER", () => {
    // Ölçüt "kaynak yok" OLSAYDI ürünün EN SIK sorusu kırılırdı: giriş/çıkış saati
    // MÜLK ALANINDAN gelir, `usedSources` boştur ama cevap uydurma DEĞİLDİR.
    for (const reply of [
      "Giriş saati 15:00, çıkış saati 11:00.",
      "Merhaba! Size nasıl yardımcı olabilirim?",
      "Rica ederim, iyi tatiller dileriz.",
      "Otopark binanın altında, giriş sokaktan.",
      "Check-in is at 15:00 and check-out at 11:00.",
    ]) {
      expect(passesAutoReplySafetyGate({ ...BENIGN, reply }, "Giriş saati kaçta?"), reply).toBe(true);
    }
  });

  it("SAVUŞTURMA yokluk itirafı DEĞİLDİR — kapı gereksiz yere geniş değil", () => {
    // Bu cevaplar bilginin kayıtlarda olmadığını SÖYLEMİYOR. Sözleşme yalnız AÇIK
    // beyanı yakalar; savuşturmanın ayrı bir sorun olduğu ölçüldü (gerçek koşuda
    // `gpt-5.6-luna` legacy modda tam bunu yapıyordu) ama bu kapının işi değil.
    for (const reply of [
      "Otopark konusunda ev sahibiniz yardımcı olabilir; mesajınız kaydedildi.",
      "Bu konuyu ev sahibinizle konuşabilirsiniz.",
    ]) {
      expect(passesAutoReplySafetyGate({ ...BENIGN, reply }, "Otopark var mı?"), reply).toBe(true);
    }
  });

  it("`reply` VERİLMEZSE kural hiç çalışmaz (eski çağıranlar bozulmaz)", () => {
    expect(passesAutoReplySafetyGate(BENIGN, "Giriş saati kaçta?")).toBe(true);
  });
});

describe("QR rotası PARİTE — aynı yüklem, tek kaynak", () => {
  it("QR kapısı `admitsMissingKnowledge` kullanır ve gerekçe kapalı kümede", () => {
    // ⚠️ Kaynak taraması tek yönlüdür; davranışsal yarı yukarıdaki kapı testlerinde
    // (iki yüzey AYNI saf yüklemi çağırıyor). Buradaki amaç: QR dalının sessizce
    // kaldırılması ya da ayrı bir kopyaya bağlanması hâlinde suit'in kırmızıya düşmesi.
    const route = readFileSync(
      path.resolve(__dirname, "../../src/app/api/chat/[token]/route.ts"),
      "utf8",
    );
    expect(route).toContain('from "@/lib/ai/absence"');
    expect(route).toContain('admitsMissingKnowledge(result.reply)');
    expect(route).toContain('yes("absence_admission")');

    const risk = readFileSync(path.resolve(__dirname, "../../src/lib/risk-events.ts"), "utf8");
    expect(risk, "gerekçe kapalı kümede olmalı, yoksa NULL'a kırpılır").toContain('"absence_admission"');
  });

  it("eval harness'ı ÜRÜNLE aynı yüklemi kullanır (kopya yazılamaz)", () => {
    const helper = readFileSync(path.resolve(__dirname, "../helpers/absence-detector.ts"), "utf8");
    expect(helper).toContain('from "@/lib/ai/absence"');
    expect(helper, "helper kendi kalıp listesini TANIMLAMAMALI").not.toMatch(/new RegExp\(/u);
  });
});

describe("admitsMissingKnowledge — saf yüklem", () => {
  it("araya niteleme girse de sayılır (ölçülen harness kusuru)", () => {
    expect(
      admitsMissingKnowledge("Hi, I don't have any specific information about parking in my records."),
    ).toBe(true);
  });

  it("boşluk CÜMLECİK İÇİ — uzak kelimeler eşleşmez", () => {
    expect(admitsMissingKnowledge("No. The information you need is in the welcome guide.")).toBe(false);
    expect(admitsMissingKnowledge("Hayır, kayıt yapmadık ama gerekli bilgi kapıda asılı.")).toBe(false);
  });

  it("boş / null girdi çökmez", () => {
    expect(admitsMissingKnowledge("")).toBe(false);
    expect(admitsMissingKnowledge(null)).toBe(false);
    expect(admitsMissingKnowledge(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 🚨 YENİDEN YAZIM PİNLERİ (09-11, inceleme ajanı ÖLÇTÜ, bağımsız doğrulandı).
// İlk sürüm düz kalıp listesiydi: 67 işe yarar cevabın 18'ini blokluyor (%27) ve
// 38 gerçekçi yokluk ifadesinin 29'unu kaçırıyordu. Aşağıdaki satırların HER BİRİ
// o ölçümde DÜŞEN somut bir vakadır — biri silinirse sınıf geri açılır.
// ---------------------------------------------------------------------------
describe("🚨 YANLIŞ POZİTİF PİNLERİ — bu cevaplar misafire GİTMEYE DEVAM EDER", () => {
  it("`no` İLE BAŞLAYAN İngilizce kelimeler yokluk DEĞİLDİR (sağ sınır yoktu)", () => {
    for (const reply of [
      "Nothing extra is needed; the information is on the table.",
      "Note: all the check-in information is in the welcome folder.",
      "Nobody else has the details; I'll share them now.",
      "Normally the details are in the guidebook by the door.",
      "Sure, no worries — the parking details are in the folder.",
      // 🚨 Noktalama boşluğu KESER: "no extra charge; the information" eşleşmemeli.
      "There is no extra charge; the information pack is on the table.",
    ]) {
      expect(admitsMissingKnowledge(reply), reply).toBe(false);
    }
  });

  it("çıplak `not listed` yokluk DEĞİLDİR (çapa: in/on my|our|the)", () => {
    for (const reply of [
      "The pool is not listed as closed, it is open 09:00-20:00.",
      "Parking is not listed on Airbnb but we do have a free spot for you.",
      "Your reservation is not listed as canceled, everything is fine.",
    ]) {
      expect(admitsMissingKnowledge(reply), reply).toBe(false);
    }
    // KARŞI YÖN: çapa varsa yakalanır.
    expect(admitsMissingKnowledge("That is not listed in my records.")).toBe(true);
  });

  it("🚨 `yok` NESNEYE BİTİŞİK olmalı — 'sorun yok' nezaket kapanışı bloklanmaz", () => {
    for (const reply of [
      // 🚨 BU SATIR KURALI TEK BAŞINA SINAR (mutasyon turu): ötekilerde kararı
      // NOKTALAMA veriyor (virgül/iki nokta boşluğu zaten kesiyor), yani boşluk
      // 1'den 6'ya çıkarılsa bile yeşil kalıyorlardı. Burada araya yalnız KELİME
      // giriyor ("rehberde yazıyor ama görevli" = 4) → kararı YALNIZCA mesafe verir.
      "Bu bilgi rehberde yazıyor ama görevli yok.",
      "Bu bilgi rehberde var, sorun yok.",
      "Wi-Fi bilgileri kapının arkasında, sorun yok.",
      "Otopark bilgisi: ücretsiz, kapıda görevli yok.",
    ]) {
      expect(admitsMissingKnowledge(reply), reply).toBe(false);
    }
    expect(admitsMissingKnowledge("Bu konuda bilgi yok.")).toBe(true);
    expect(admitsMissingKnowledge("Bu konuda kayıtlı bilgi yoktur.")).toBe(true);
    // "yokluğu" YOKLUK DEĞİL (sağ sınır).
    expect(admitsMissingKnowledge("Bu konuda bilgi yokluğu söz konusu değil, rehberde yazıyor.")).toBe(false);
  });

  it("`kayıtlı` + `bilgi` OLUMLU bir Türkçe kalıptır (eski kalıp bunu blokluyordu)", () => {
    for (const reply of [
      "Giriş 15.00'te, çıkış 11.00'de. Kayıtlı rezervasyon bilgileriniz doğru.",
      "Kayıtlı adresinize göre bilgi veriyorum: daire girişi bina arkasında.",
      "Rezervasyon kaydınız görünüyor, her şey yolunda.",
    ]) {
      expect(admitsMissingKnowledge(reply), reply).toBe(false);
    }
  });

  it("CÜMLE SINIRI boşluğu keser (çapraz-cümle sızıntısı)", () => {
    expect(admitsMissingKnowledge("There is no smoking. Details are in the rules.")).toBe(false);
    expect(admitsMissingKnowledge("Sorun yok. Detaylı bilgi için bize yazın.")).toBe(false);
    // 🚨 AMA "15.00" BÖLÜNMEZ (noktadan sonra boşluk yok) — eski `[^.!?]` sınıfı
    // tam tersini yapıyor ve Türkçe saat yazımı yüzünden bu cümleyi KAÇIRIYORDU.
    expect(admitsMissingKnowledge("I don't have the 15.00 check-in information for your stay.")).toBe(true);
  });
});

describe("🚨 KAÇAK PİNLERİ — modelin GERÇEKTE yazdığı yokluk ifadeleri", () => {
  it("Türkçe fiil ailesi (bulamadım / göremiyorum / görünmüyor / kayıtlı değil)", () => {
    for (const reply of [
      "Bu detay bende kayıtlı değil.",
      "Ne yazık ki paylaşabileceğim bir kayıt göremiyorum.",
      "Bu konuda kayıtlarımda bir şey bulamadım.",
      "Üzgünüm, bu konuda elimde bir veri yok.",
      "Kayıtlarımda bu detay görünmüyor.",
      "Bununla ilgili bir not göremiyorum.",
      "Maalesef bu soruyu yanıtlayacak bir kaydım yok.",
      "Bu bilgiye erişimim yok.",
      "Bilmiyorum.",
    ]) {
      expect(admitsMissingKnowledge(reply), reply).toBe(true);
    }
  });

  it("İngilizce — TEKİL/ÇOĞUL ve didn't biçimleri (liste yalnız birini taşıyordu)", () => {
    for (const reply of [
      "There are no records of that request.", // `records` çoğul
      "I don't have that detail.", // `detail` tekil
      "I didn't have any information on that.", // didn't
      "I couldn't locate that detail.",
      "I'm not able to find that in what I have.",
      "I can't confirm that from what's recorded here.",
      "There's nothing in my records about that.",
      "I don't see anything about that in the listing.",
      "That information isn't available to me.",
      "That detail isn't something I have on hand.",
    ]) {
      expect(admitsMissingKnowledge(reply), reply).toBe(true);
    }
  });

  it("🚨 İKİ KATLAMA: tr yereli TEK BAŞINA İngilizce büyük I'yı bozuyordu", () => {
    // "I" → "ı" olur, "Information" → "ınformation" → kalıp kaçardı (ölçüldü).
    expect(admitsMissingKnowledge("I do not have any Information about parking.")).toBe(true);
    expect(admitsMissingKnowledge("No Information is recorded for that.")).toBe(true);
    // KARŞI YÖN — 🚨 BU İKİ SATIR tr OKUMASINI TEK BAŞINA SINAR (mutasyon turu:
    // "yalnız standart katlama" mutantı HAYATTA KALMIŞTI). Sebep ölçüldü: "BİLGİM"
    // standart küçültmede de "bilgim"e iner (U+0307 sıyrılıyor), yani İ'li örnekler
    // ayrımı GÖSTERMİYOR. Ayrım BÜYÜK HARFLİ DOTSUZ I'da ortaya çıkıyor —
    // "KAYITLI" standart okumada "kayitli" (ASCII i) olur ve kalıplar "kayıtlı"
    // yazılı olduğu için KAÇAR; tr okuması "kayıtlı" üretir.
    expect(admitsMissingKnowledge("Bu detay sistemde KAYITLI DEĞİL.")).toBe(true);
    expect(admitsMissingKnowledge("Maalesef bu bilgiyi BULAMADIM.")).toBe(true);
    expect(admitsMissingKnowledge("Otopark hakkında kayıtlarımda BULAMADIM.")).toBe(true);
    expect(admitsMissingKnowledge("BİLGİM YOK")).toBe(true);
    // ⚠️ Bu satır TERS yönü sınar: ASCII I ile yazılmış Türkçe yalnız STANDART
    // okumada çözülür ("bılgım" değil "bilgim") — yani İKİ okuma da yük taşıyor.
    expect(admitsMissingKnowledge("BILGIM YOK")).toBe(true);
  });

  it("⚠️ BİLİNÇLİ DIŞARIDA: belirsizlik ve savuşturma (ayrı sınıf)", () => {
    // "emin değilim" NETLEŞTİRME SORUSUYLA aynı kalıbı paylaşıyor — bloklamak
    // ürünün MEŞRU bir davranışını keserdi. Ölçülmüş karşı örnek:
    expect(admitsMissingKnowledge("Sorunuzu tam anladığımdan emin değilim, hangi tarihten bahsediyorsunuz?")).toBe(false);
    expect(admitsMissingKnowledge("Bu konuda emin değilim.")).toBe(false);
    expect(admitsMissingKnowledge("Bu konuyu ev sahibinizle konuşabilirsiniz.")).toBe(false);
  });
});
