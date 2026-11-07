import { describe, it, expect } from "vitest";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// ÇIKTI VETOSU — 15 ajan incelemesi A05 (10-01, ölçüldü). Kurucu kuralları: bekleme sözü misafire gitmez (09-25), devir / bildirim
// cümlesi misafire gitmez (K10, 09-30 "Hiçbir şey gitmesin"). Açıklar:
//  1. "…:" istisnaları (duyuru / netleştirme) saatin iki noktasını da duyuru sayıyordu → aynı söz "13:00" ile GİDİYOR, "1 pm" ile
//     tutuluyordu; Türkçe ev sahibi öznesi kalıbı saat iki noktasında / noktasında bölünüyordu ("Ev sahibiniz 18:00'e kadar sizi arayacak").
//  2. Araya giren zarf ("I'll gladly ask the host", "I've now let the host know") sözü gizliyordu.
//  3. Dil bildirimi istisnası her sözcüğü dil sayıyordu ("I'll reply in a few minutes"); ev sahibine yönelik onay süreç sayılıyordu.
//  4. Edilgen devir bildirimleri ("Mesajınız ev sahibinize iletilmiştir", "Your message was forwarded to your host") yedi dilde geçiyordu.
// Külliyat ölçümü (docs/olcum, 3.031 gerçek 5.1 / Luna cevabı): yeni tutuş 2 (ikisi de "your host will be able to confirm" ertelemesi),
// düşen 0.
// ---------------------------------------------------------------------------

const HOLD_COMMITMENT: readonly string[] = [
  // 1 — saatin iki noktası
  "I'll check if an early check-in at 13:00 is possible and let you know.",
  "I'll double-check with the host whether the pool is open after 20:00.",
  "Let me check with the host about the 12:00 checkout.",
  "Let me confirm with your host whether 13:00 works.",
  "I'll look into whether the cleaners can finish by 14:00.",
  "Kontrol edeyim, 14:00'te giriş mümkün olabilir.",
  "Durumu hemen iletiyorum, 15:00'e kadar dönüş olur.",
  "Ich frage beim Gastgeber nach, ob ein Check-in um 13:00 möglich ist.",
  "Ich schaue gleich nach, ob der Pool um 20:00 noch offen ist.",
  "Je vais vérifier avec votre hôte si une arrivée à 13:00 est possible.",
  "Je reviens vers vous avant 18:00.",
  "Voy a consultar con el anfitrión si es posible a las 13:00.",
  "Сообщу вам до 18:00.",
  "Уточню у хозяина и отвечу до 18:00.",
  "Ev sahibiniz 18:00'e kadar sizi arayacak.",
  "Ev sahibiniz 15:00'e kadar size dönüş sağlayacak.",
  "Ev sahibiniz 13:00'te girişinizi onayladı.",
  "Ekibimiz 16:00'ya kadar size bilgi verecek.",
  "Ev sahibiniz 18.00'e kadar sizi arayacak.",
  // 2 — araya giren zarf
  "I'll gladly ask the host for you.",
  "I'll happily check with the host.",
  "I'll certainly pass this on to the host.",
  "I will of course check with the host.",
  "I'll definitely let the host know.",
  "I'll immediately notify the host.",
  "I'll right away contact the host.",
  "I'll be sure to pass this on.",
  "I have also already informed the host.",
  "I've personally notified the host.",
  "I've now let the host know.",
  "I have now forwarded your message to the host.",
  "I've gone ahead and notified the host.",
  "I've gone ahead and booked a taxi for 9 am.",
  "The host will most likely get back to you today.",
  "Your host should be able to get back to you soon.",
  "Your host is going to call you shortly.",
  "I'm currently checking with the host.",
  "I'm checking this with the host now.",
  "We'll see what we can do.",
  "I'll also definitely let the host know.",
  // misafire hitaplı bilgilendirme yalnız ardından içerik VERİLİYORSA duyurudur — tek başına "bilgi vereyim" sonraya söz
  "Size bilgi vereyim.",
  "Size hemen haber vereyim.",
  // 3 — dil bildirimi / ev sahibine yönelik onay
  "I'll reply in a few minutes.",
  "I'll respond in a moment with the details.",
  "Le escribiré en breve.",
  "I'll confirm the booking details with the host shortly.",
  "I'll confirm your reservation change with the host.",
  // soru da içeren ev sahibine yönelik söz; ev sahibinden cevap beklemek
  "Let me ask your host whether that's possible — would that work for you?",
  "Let me ask your host, is that okay?",
  "Let me check with the host, anything else I can help with?",
  "I'll send you the details once I hear from the host.",
  // diğer diller — söz / makbuzsuz iddia
  "Ich sage dem Gastgeber Bescheid.",
  "Ich sage Ihnen Bescheid, sobald ich etwas höre.",
  "Ich informiere Sie, sobald ich eine Antwort habe.",
  "Ich spreche mit dem Gastgeber.",
  "Ich kontaktiere den Gastgeber.",
  "Ihre Anfrage habe ich an den Gastgeber weitergeleitet.",
  "Je vous informe dès que j'ai une réponse.",
  "Le informo en cuanto sepa algo.",
  "He comunicado su solicitud al anfitrión.",
  "Вернусь к вам с ответом.",
  "قمت بإرسال طلبك إلى المضيف.",
];

const HOLD_HANDOFF: readonly string[] = [
  "Talebiniz ev sahibinize iletilmiştir.",
  "Talebiniz ev sahibinize ulaştırılmıştır.",
  "Şikayetiniz kayda alınmıştır.",
  "Mesajınız ev sahibinize gönderildi.",
  "Talebiniz ev sahibine aktarılmıştır.",
  "Durumunuz ev sahibinize iletildi.",
  "Mesajınız alınmıştır.",
  "Your message was forwarded to your host.",
  "Your request has been sent to the host.",
  "Your message has been passed to the host.",
  "Your request has been escalated to the host.",
  "The host has your message.",
  "Ihre Nachricht ist bei uns eingegangen.",
  "Ihre Anfrage wurde an Ihren Gastgeber übermittelt.",
  "Ihre Anfrage wurde übermittelt.",
  "Votre demande a été envoyée à votre hôte.",
  "Votre message a été transféré à l'hôte.",
  "Su mensaje fue reenviado al anfitrión.",
  "Ваше сообщение отправлено хозяину.",
  "Ваш запрос направлен хозяину.",
  "تم تحويل رسالتك إلى المضيف.",
];

// KONTROL — gerçek duyuru / netleştirme / olgu / dil bildirimi / misafire giden önceki mesaja atıf GİDER.
const PASS: readonly string[] = [
  "Sizi bilgilendiriyoruz: havuz 10:00'da açılıyor.",
  "Size bilgi vereyim, havuz 09:00'da açılıyor.",
  "Size hemen bilgi vereyim, otopark 23:00'te kapanıyor.",
  "Let me double-check: is it two adults and one child?",
  "Bir kontrol edeyim: iki yetişkin ve bir çocuk, doğru mu?",
  "I'll reply in English from now on.",
  "Le escribiré en español a partir de ahora.",
  "We'll confirm your booking at check-in.",
  "The check-in details were sent to your email yesterday.",
  "Check-in is at 15:00 and check-out is at 11:00.",
  "Ev sahibiniz sizi 15:00'te girişte karşılayacak.",
  "Ev sahibiniz 18:00'de evde olmayacak; anahtar kutusu kapının yanında.",
  "Your booking has been confirmed for 12–14 October.",
  "The pool will be open from 09:00 to 20:00.",
  "Sizi bilgilendirmek isteriz: 13:00 ile 15:00 arası temizlik var.",
  "Wir informieren Sie: Der Pool öffnet um 09:00.",
];

describe("A05 — çıktı vetosu açıkları kapandı", () => {
  it.each(HOLD_COMMITMENT)("🚨 söz / makbuzsuz iddia tutulur: %j", (cevap) => {
    expect(vetoOutgoingReply(cevap)).toBe("unverified_commitment");
  });

  it.each(HOLD_HANDOFF)("🚨 edilgen devir bildirimi tutulur (K10): %j", (cevap) => {
    expect(vetoOutgoingReply(cevap)).not.toBeNull();
  });

  it.each(PASS)("KONTROL — gider: %j", (cevap) => {
    expect(vetoOutgoingReply(cevap)).toBeNull();
  });

  it("ikiz: aynı söz saatsiz de tutulur (değişiklik yalnız iki noktanın okunuşu)", () => {
    expect(vetoOutgoingReply("I'll double-check with the host whether the pool is open after 8 pm.")).toBe("unverified_commitment");
    expect(vetoOutgoingReply("Ev sahibiniz akşama kadar sizi arayacak.")).toBe("unverified_commitment");
  });
});
