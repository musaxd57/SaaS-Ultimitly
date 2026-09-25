import { describe, it, expect } from "vitest";
import { hostVoiceDraft } from "@/lib/ai/host-voice";

// ---------------------------------------------------------------------------
// TASLAK = EV SAHİBİNİN SESİ (09-25, kurucu). İstemin öğrettiği devir kalıpları ("mesajınız kaydedildi; ev sahibiniz
// görebilir") otomatik gönderimde dürüsttür ama ev sahibine gösterilen taslakta — altında onun imzasıyla — anlamsızdır.
// Çeviri YALNIZ ev sahibine gösterilen metne uygulanır; kapı ve kontroller orijinal metne bakar (ayrı rota testleri).
// ---------------------------------------------------------------------------

describe("hostVoiceDraft — istemin devir kalıpları ev sahibinin ağzına", () => {
  it("canlıda görülen iki cevap (Ayarlar testi, 09-25)", () => {
    expect(
      hostVoiceDraft(
        "Merhaba, yaşadığınız bu durum için özür dilerim. Klimayla ilgili mesajınız kaydedildi; ev sahibiniz görebilir.",
      ),
    ).toBe("Merhaba, yaşadığınız bu durum için özür dilerim. Klimayla ilgili mesajınızı aldım; kontrol edip size dönüş yapacağım.");
    expect(
      hostVoiceDraft("Merhaba. Yarın saat 11:00 civarında giriş yapma isteğiniz ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir."),
    ).toBe("Merhaba. Yarın saat 11:00 civarında giriş yapma isteğiniz için kontrol edip size dönüş yapacağım.");
  });

  it("istemin Türkçe kalıp biçimleri (büyük harf korunur, 've' bağlaçlı biçim)", () => {
    expect(hostVoiceDraft("Tabii. Mesajınız kaydedildi; ev sahibiniz görebilir.")).toBe(
      "Tabii. Mesajınızı aldım; kontrol edip size dönüş yapacağım.",
    );
    expect(hostVoiceDraft("Talebiniz kaydedildi ve ev sahibiniz görebilir.")).toBe("Talebinizi aldım; kontrol edip size dönüş yapacağım.");
    expect(hostVoiceDraft("Bu konu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.")).toBe(
      "Bu konu için kontrol edip size dönüş yapacağım.",
    );
  });

  it("istemin İngilizce kalıp biçimleri", () => {
    expect(
      hostVoiceDraft(
        "Hi John, our standard check-in is at 15:00. Whether an earlier arrival is possible is the host's call; your request has been recorded and is visible to your host.",
      ),
    ).toBe("Hi John, our standard check-in is at 15:00. I'll check whether an earlier arrival is possible and get back to you.");
    expect(hostVoiceDraft("Apologies. Your message has been recorded and is visible to your host.")).toBe(
      "Apologies. I've received your message and will get back to you shortly.",
    );
    // ";" sonrası: "I" küçülmez (mutasyon turu bulgusu — eski kod "i've" yazıyordu).
    expect(hostVoiceDraft("Sorry about that; your message has been recorded and is visible to your host.")).toBe(
      "Sorry about that; I've received your message and will get back to you shortly.",
    );
    expect(hostVoiceDraft("Availability is the host's call; your dates have been recorded and are visible to your host.")).toBe(
      "I'll check availability and get back to you.",
    );
  });

  it("inceleme bulguları (09-25): istemin 'Bu …' örneği, saat noktası, büyük İ, hitap, rapor/virgül biçimleri", () => {
    expect(hostVoiceDraft("Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.")).toBe(
      "Bunu kontrol edip size dönüş yapacağım.",
    );
    expect(hostVoiceDraft("Programa bağlı; bu ev sahibinizin kararıdır, mesajınız kaydedildi ve ev sahibiniz görebilir.")).toBe(
      "Programa bağlı; bunu kontrol edip size dönüş yapacağım.",
    );
    expect(
      hostVoiceDraft("Merhaba. Saat 13.00'deki çıkış isteği ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir."),
    ).toBe("Merhaba. Saat 13.00'deki çıkış isteği için kontrol edip size dönüş yapacağım.");
    expect(hostVoiceDraft("İsteğiniz kaydedildi; ev sahibiniz görebilir.")).toBe("İsteğinizi aldım; kontrol edip size dönüş yapacağım.");
    expect(
      hostVoiceDraft("Hi Anna, whether early check-in is possible is the host's call; your request has been recorded and is visible to your host."),
    ).toBe("Hi Anna, I'll check whether early check-in is possible and get back to you.");
    expect(hostVoiceDraft("Thanks, your report has been recorded and is visible to your host.")).toBe(
      "Thanks, I've received your report and will get back to you shortly.",
    );
  });

  it("🚨 GERİ İZLEME YOK: 4.000 karakterlik boşluk dolu taslak anında döner (kübik kalıp düzeltildi)", () => {
    for (const bad of [
      "." + " ".repeat(3990) + "x",
      ". x" + " ".repeat(3990) + " ev sahibinizin kararıdır;",
      "Hi. " + "x ".repeat(1995) + "is the host's call;",
    ]) {
      const t0 = performance.now();
      expect(hostVoiceDraft(bad)).toBe(bad);
      expect(performance.now() - t0).toBeLessThan(200);
    }
  });

  it("AŞIRI UYGULAMA YOK: kalıp dışı metin ve başka diller olduğu gibi kalır; iki kez uygulamak aynı sonucu verir", () => {
    for (const t of [
      "Wi-Fi ağımız Lale-5G, şifresi kartta.",
      "Mesajınız kaydedildi.",
      "Ekmesajınız kaydedildi; ev sahibiniz görebilir.", // kelime içi eşleşme yok
      "Das muss Ihr Gastgeber entscheiden; Ihre Nachricht wurde gespeichert.",
      "",
    ]) {
      expect(hostVoiceDraft(t), t).toBe(t);
    }
    const once = hostVoiceDraft("Tabii. Mesajınız kaydedildi; ev sahibiniz görebilir.");
    expect(hostVoiceDraft(once)).toBe(once);
  });
});
