import { describe, it, expect } from "vitest";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// K10 (kurucu kararı 09-30): "host görebilir gibi bir şey yazmasın, gerekirse hiç cevap üretilmesin, hosta haber verilsin" ·
// "ev sahibine gönderdim demesin" · seçim: "Hiçbir şey gitmesin". Devir / bildirim cümlesi ("mesajınız kaydedildi", "ev
// sahibiniz görebilir", "visible to your host") misafire GİTMEZ — cevap tutulur, ev sahibine haber verilir. Aynı turda
// makbuzsuz söz / teklif kapanır ("sorayım mı?", "Shall I ask the host?", "gönderiyorum", "I have sent your request to the
// host"); alıcısı MİSAFİR olan geçmiş anlatım ("Dün size haber verdim: …") serbest kalır. İKİ YÖNLÜ: her kapanan cümlenin
// yanında meşru ikiz.
// ---------------------------------------------------------------------------

const HANDOFF: string[] = [
  "Mesajınız kaydedildi; ev sahibiniz görebilir.",
  "Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.",
  "Talebiniz kaydedildi.",
  "Klimayla ilgili mesajınız kaydedildi; ev sahibiniz görebilir.",
  "Tarihleriniz kaydedildi, ev sahibiniz görecek.",
  "Mesajınız ev sahibinize iletildi.",
  "Your request has been recorded and is visible to your host.",
  "Your message has been recorded and is visible to your host.",
  "Availability is the host's call; your dates have been recorded and are visible to your host.",
  "Your host can see your message.",
  "Ihre Anfrage wurde gespeichert; Ihr Gastgeber kann sie einsehen.",
  "Votre demande a été enregistrée ; votre hôte peut la consulter.",
  "Su solicitud ha sido registrada y su anfitrión puede verla.",
  "Ваше сообщение сохранено, хозяин его увидит.",
  "تم تسجيل طلبكم ويمكن للمضيف الاطلاع عليه.",
];

const PROMISES: string[] = [
  // Kurucunun örnekleri (bugün geçiyordu):
  "İsterseniz ev sahibinize sorayım mı?",
  "Shall I ask the host for you?",
  "Mesajınızı şimdi ev sahibine gönderiyorum.",
  "I have sent your request to the host.",
  // İkizler:
  "Ev sahibine sorayım mı?",
  "Should I ask the host?",
  "Want me to check with the host?",
  "Talebinizi ev sahibine gönderiyoruz.",
  "I've sent your message to the host.",
  "I sent the request to your host.",
];

const LEGIT: string[] = [
  // Alıcısı MİSAFİR olan geçmiş anlatım (kurucunun örneği):
  "Dün size haber verdim: havuz pazartesi kapalı.",
  "Size dün bildirdim: çöpler salı günü alınıyor.",
  "As I mentioned yesterday, the pool is closed on Mondays.",
  // Ev sahibi sözcüğü + "görebilirsiniz" (2. şahıs) devir değildir:
  "Ev sahibiniz size özel bir hoş geldin notu bıraktı, masada görebilirsiniz.",
  "The fire extinguisher is visible next to the door.",
  "Your host's recommendations are in the guidebook; you can see them in the app.",
  // Koddan kurulan erken giriş politika metni (karar ertelemesi, bildirim değil):
  "Erken girişin mümkün olup olmadığı o günkü temizliğe bağlıdır; kararı ev sahibiniz verir.",
  "Whether an early check-in is possible depends on that day's cleaning; your host decides.",
  // Misafire soru (netleştirme) söz değildir:
  "Kaç kişi geleceğinizi sorabilir miyim?",
  "Rezervasyonunuz kaydedildi mi diye mi soruyorsunuz? Airbnb uygulamasından görebilirsiniz.",
];

describe("K10 — devir / bildirim cümlesi misafire GİTMEZ", () => {
  it.each(HANDOFF)("🚨 tutulur: %s", (reply) => {
    expect(vetoOutgoingReply(reply)).toBe("handoff_notice");
  });
});

describe("K10 — makbuzsuz söz / teklif kapanır (kurucunun örnekleri + ikizler)", () => {
  it.each(PROMISES)("🚨 tutulur: %s", (reply) => {
    expect(vetoOutgoingReply(reply)).not.toBeNull();
  });
});

describe("K10 — meşru cümleler geçer", () => {
  it.each(LEGIT)("geçer: %s", (reply) => {
    expect(vetoOutgoingReply(reply)).toBeNull();
  });
});
