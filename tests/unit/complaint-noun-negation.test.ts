import { describe, it, expect } from "vitest";
import { classifyFallback } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// U7 (kurucu 10-22: "Evet önerin gibi olsun"): "şikâyetim yok / şikayetçi değil / no complaints" ŞİKÂYET DEĞİLDİR. Kırmızı takım kontrol
// vakası (ölçüldü): "Annem şikayetçi değil, sadece soruyor: klimayı soğutmaya nasıl alıyoruz?" kelime ağında şikâyet + ACİL sayılıyor, soru
// ev sahibine kalıyor, bilgi tabanındaki tarif gitmiyordu; aynı soru "şikayet" sözcüğü olmadan otomatik gidiyordu. Kök düz listeden çıktı,
// olumsuzlama guard'lı okunur (`hasUnnegatedComplaintNoun`) — homoglif / büyük harf / şapka sağlamlığı korunur, gerçek şikâyet kalır.
// ---------------------------------------------------------------------------

const intentOf = (m: string) => classifyFallback(m).intent;

describe("şikâyet adı olumsuzlanınca şikâyet sayılmaz", () => {
  for (const m of [
    "Annem şikayetçi değil, sadece soruyor: klimayı soğutmaya nasıl alıyoruz?",
    "Şikayetim yok, sadece klimayı nasıl soğutmaya alırım?",
    "Şikayetimiz yok ama klimayı nasıl açıyoruz?",
    "Şikayet etmiyorum, sadece soruyorum: Wi-Fi şifresi ne?",
    "ŞİKAYETİM YOK, klimayı nasıl açarım?",
    "Şikâyetim yok ama Wi-Fi şifresi nedir?",
    "Sikayetim yok, otopark var mi?",
    "No complaints, how do I turn on the AC?",
    "Not a complaint, just a question: where is the iron?",
  ]) {
    it(`soru: ${m}`, () => {
      expect(intentOf(m)).not.toBe("complaint");
      expect(classifyFallback(m).priority).not.toBe("urgent");
    });
  }
});

describe("gerçek şikâyet şikâyet kalır (aşırı uygulama yok)", () => {
  for (const m of [
    "Şikayetim var, klima çalışmıyor.",
    "Şikayet etmek istiyorum.",
    "Bir şikayetim olacak, ev kirliydi.",
    "Şikayetçi olacağım.",
    "I have a complaint about the noise.",
    "I want to file a complaint.",
    // Olumsuzlama + gerçek sorun: "bozuk" ayrıca okunur.
    "Şikayetçi değilim ama klima bozuk, çalışmıyor.",
    // Homoglif (Kiril "а") ve büyük harf: kök hâlâ yakalanır.
    "Şikаyetim var, ev çok gürültülü.",
    "ŞİKAYETİM VAR.",
    // ASCII yazım (Türkçe klavyesiz misafir).
    "Sikayetim var.",
  ]) {
    it(`şikâyet: ${m}`, () => {
      expect(intentOf(m)).toBe("complaint");
    });
  }
});
