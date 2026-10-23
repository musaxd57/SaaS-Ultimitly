import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge, refersGuestToHost } from "@/lib/ai/absence";
import { containsContactValue } from "@/lib/contact-redact";

// ---------------------------------------------------------------------------
// EV SAHİBİNE YÖNLENDİRME = BİLGİM YOK (kurucu 10-23 akşam 4.5, aynen: "ev sahibinize sorabilirsiniz yazamaz yasak onlar bilgisi yok
// sayılsın cevap tutulsun"). Misafiri bilgi için ev sahibine gönderen cümle gitmez; telefon / e-posta değeri veren ve olay koşullu
// talimat cümlesi hariç. Altı dil.
// ---------------------------------------------------------------------------

describe("ev sahibine yönlendirme", () => {
  it("🚨 Türkçe yönlendirmeler bilgisizlik sayılır (öğle raporu §4.5 örneği dahil)", () => {
    for (const t of [
      "Otopark için ev sahibinize sorabilirsiniz.",
      "Plaj servisi siteden kalkıyor; tam kalkış noktası için ev sahibinize sorabilirsiniz.",
      "Sauna konusunda ev sahibinizle iletişime geçebilirsiniz.",
      "Bu konuda ev sahibiniz size kesin bilgi verebilir.",
      "Ev sahibiniz, bu konuda size yardımcı olabilir.",
      "Net yol tarifi için ev sahibinizden bilgi alabilirsiniz.",
      "Kahvaltı saatini ev sahibinize danışın.",
      "Bu bilgiyi ev sahibinizden isteyebilirsiniz.",
      "Daha fazla bilgi isterseniz ev sahibinize sorabilirsiniz.",
      "EV SAHİBİNİZE SORABİLİRSİNİZ.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
      expect(admitsMissingKnowledge(t), t).toBe(true);
    }
  });

  it("🚨 İngilizce / Almanca / Fransızca / İspanyolca / Rusça", () => {
    for (const t of [
      "Please check with your host about the parking.",
      "Your host can confirm the exact time.",
      "Your host will be able to tell you more.",
      "Your host can provide more information about the sauna.",
      "Fragen Sie bitte Ihren Gastgeber nach dem Parkplatz.",
      "Ihr Gastgeber kann Ihnen das bestätigen.",
      "Demandez à votre hôte pour le parking.",
      "Votre hôte pourra vous confirmer l'heure.",
      "Pregunte a su anfitrión por el aparcamiento.",
      "Su anfitrión podrá confirmarle la hora.",
      "Уточните у хозяина, пожалуйста.",
      "Хозяин сможет подсказать точное время.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
  });

  it("hariç: iletişim DEĞERİ veren cümle (sorulan bilgi), olay koşullu talimat, olgu, kural, teslim", () => {
    for (const t of [
      "Ev sahibinize 0532 123 45 67 numarasından ulaşabilirsiniz.",
      "You can contact your host at +90 532 123 45 67.",
      "Anahtarı kaybederseniz ev sahibinize ulaşın.",
      "Kombi arıza verirse ev sahibinizle iletişime geçin.",
      "If the Wi-Fi stops working, message your host.",
      "Ev sahibiniz sizi kapıda karşılayacak.",
      "Ev sahibiniz evde sigara içilmesini istemiyor.",
      "Your host can provide a baby cot on request.",
      "Your host will meet you at the entrance.",
      "Anahtarı çıkışta ev sahibinize teslim edin.",
      "Erken giriş için ev sahibinizden onay almanız gerekir.",
      "Wi-Fi şifresi Lale2025.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
  });

  it("çok cümlede yalnız yönlendirme cümlesi sayılır; başka cümledeki koşul onu kurtarmaz", () => {
    expect(refersGuestToHost("Çöpler bina girişindeki konteynere atılır. Sauna için ev sahibinize sorabilirsiniz.")).toBe(true);
    expect(refersGuestToHost("Anahtarı kaybederseniz resepsiyona gidin. Otopark için ev sahibinize sorabilirsiniz.")).toBe(true);
    expect(refersGuestToHost("Çöpler bina girişindeki konteynere atılır. Ev sahibiniz sizi kapıda karşılayacak.")).toBe(false);
  });

  it("iletişim değeri: telefon (10–15 rakam), e-posta, bağlantı; saat / tarih / kapı kodu / fiyat değil", () => {
    for (const t of ["+90 532 123 45 67", "0532 123 45 67", "info@example.com", "https://example.com/x", "www.example.com"]) {
      expect(containsContactValue(t), t).toBe(true);
    }
    for (const t of ["15:00", "12.10.2026", "Kapı kodu 4590", "1.500 TL", "lixusai.com", ""]) {
      expect(containsContactValue(t), t).toBe(false);
    }
  });

  it("süre: uzun tekrar / tek sözcük / boşluk dizisi doğrusal", () => {
    const t0 = performance.now();
    refersGuestToHost("ev sahibiniz ".repeat(4_000));
    refersGuestToHost(`${"a".repeat(50_000)} ev sahibinize`);
    refersGuestToHost(`your host ${" ".repeat(50_000)}can`);
    refersGuestToHost("your host can ".repeat(3_000));
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
