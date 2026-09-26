// ---------------------------------------------------------------------------
// MÜSAİTLİK VETOSU — ELLE DERLENMİŞ BATARYA (09-24). Tasarımla birlikte yazıldı (kör DEĞİL);
// genelleme ölçüsü ayrı kör bataryadır (`availability-battery-blind.ts`, ajan, uygulamayı görmeden).
// İstemin KENDİ standart cümleleri `PROMPT_CANONICAL_DEFERRALS`ta: kapı modelin DOĞRU davranışını
// bloklamamalı (ilk ölçümde İngilizce standart cümle yanlış pozitifti — gömülü soru koruması).
// ---------------------------------------------------------------------------
import type { AvailabilityRequestKind } from "@/lib/ai/availability-claims";

export const REQUESTS_POS: readonly { text: string; kind: AvailabilityRequestKind }[] = [
  // TR
  { text: "Bir gece daha kalabilir miyiz?", kind: "extend" },
  { text: "bir gece daha kalabilirmiyiz", kind: "extend" },
  { text: "Konaklamamızı iki gün uzatmak istiyoruz", kind: "extend" },
  { text: "Rezervasyonu uzatabilir miyiz acaba?", kind: "extend" },
  { text: "Fazladan bir gece ekleyebilir misiniz?", kind: "extend" },
  { text: "Pazara kadar kalabilir miyiz?", kind: "extend" },
  { text: "Biraz daha kalsak olur mu?", kind: "extend" },
  { text: "Erken giriş yapabilir miyiz?", kind: "early" },
  { text: "Sabah 9'da gelebilir miyiz, daha erken girebilir miyiz?", kind: "early" },
  { text: "Check-in'i öne alabilir miyiz?", kind: "early" },
  { text: "Geç çıkış mümkün mü?", kind: "late" },
  { text: "Çıkışı saat 2'ye uzatabilir miyiz?", kind: "late" },
  { text: "Saat 14'e kadar kalabilir miyiz?", kind: "late" },
  { text: "Tarihlerimizi bir gün kaydırabilir miyiz?", kind: "date_change" },
  { text: "Bir gün erken gelsek olur mu?", kind: "date_change" },
  { text: "15-18 Ekim arası daire müsait mi?", kind: "availability" },
  { text: "Önümüzdeki hafta sonu boş musunuz?", kind: "availability" },
  { text: "Wifi şifresi ne? Ayrıca bir gece daha kalabilir miyiz?", kind: "extend" },
  { text: "BİR GECE DAHA KALABİLİR MİYİZ", kind: "extend" },
  { text: "Bir gece da­ha kalabilir miyiz?", kind: "extend" }, // görünmez yumuşak tire
  // EN
  { text: "Can we stay one more night?", kind: "extend" },
  { text: "Could we extend our stay until Sunday?", kind: "extend" },
  { text: "Is it possible to add an extra night?", kind: "extend" },
  { text: "We'd love to stay a bit longer", kind: "extend" },
  { text: "Could we check in early?", kind: "early" },
  { text: "Any chance of an early check-in?", kind: "early" },
  { text: "We arrive at 10am, can we come earlier?", kind: "early" },
  { text: "Late check-out possible?", kind: "late" },
  { text: "Can we check out later, around 2pm?", kind: "late" },
  { text: "Could we change our dates?", kind: "date_change" },
  { text: "Is the apartment available next weekend?", kind: "availability" },
  // DE / FR / ES / RU / AR
  { text: "Können wir eine Nacht länger bleiben?", kind: "extend" },
  { text: "Ist ein früher Check-in möglich?", kind: "early" },
  { text: "Pouvons-nous rester une nuit de plus ?", kind: "extend" },
  { text: "Est-ce qu'on peut partir plus tard ?", kind: "late" },
  { text: "¿Podemos quedarnos una noche más?", kind: "extend" },
  { text: "¿Es posible un check-in temprano?", kind: "early" },
  { text: "Можно остаться ещё на одну ночь?", kind: "extend" },
  { text: "Возможен ли поздний выезд?", kind: "late" },
  { text: "هل يمكننا البقاء ليلة إضافية؟", kind: "extend" },
  { text: "هل يمكن تسجيل خروج متأخر؟", kind: "late" },
];

export const REQUESTS_NEG: readonly string[] = [
  "Saat kaçta giriş yapabiliriz?",
  "Çıkış saati kaçta?",
  "Saat 11'e kadar mı çıkmamız gerekiyor?",
  "Girişten önce market var mı?",
  "Otopark müsait mi?",
  "Evde ütü müsait mi?",
  "Uzatma kablosu var mı?",
  "Giriş kodunu değiştirebilir misiniz?",
  "Havlu var mı?",
  "Wifi şifresi nedir?",
  "15:00'te geliyoruz, anahtar nerede?",
  "Klima çalışmıyor",
  "What time is checkout?",
  "What time can we check in?",
  "Is parking available?",
  "Is the pool free to use?",
  "Is there an extension cord?",
  "We will arrive at 3 pm as planned",
  "Thanks for everything, see you!",
  "Wo ist der Schlüssel?",
  "Où se trouve le parking ?",
  "¿Dónde está la llave?",
];

/** Takvim durumu iddiası. */
export const CALENDAR_CLAIMS: readonly string[] = [
  "Evet, 14 Ekim gecesi daire boş.",
  "O tarihlerde müsaitiz.",
  "Maalesef o gece doluyuz.",
  "Sonrasında başka rezervasyon yok.",
  "Sizden sonra gelen misafir yok, rahat olabilirsiniz.",
  "Takvimimiz o hafta açık görünüyor.",
  "Müsaitliğimiz var.",
  "Yes, next weekend is available.",
  "Unfortunately we're fully booked that night.",
  "The apartment is free on the 14th.",
  "There is no other guest after you.",
  "The next guest arrives on Friday.",
  "We have availability for those dates.",
  "Die Wohnung ist am Wochenende noch frei.",
  "L'appartement est encore disponible ce week-end.",
  "El apartamento está libre ese fin de semana.",
];

/** Konaklama değişikliğine izin. */
export const GRANT_CLAIMS: readonly string[] = [
  "Erken giriş yapabilirsiniz.",
  "Geç çıkış saat 13:00'e kadar mümkün.",
  "Bir gece daha kalabilirsiniz.",
  "Konaklamanızı uzatabilirsiniz.",
  "Saat 14:00'e kadar kalabilirsiniz.",
  "Tabii, sizi bir gece daha ağırlarız!",
  "Erken gelebilirsiniz, sorun olmaz.",
  "No problem, late checkout at 1pm is fine.",
  "You can stay one more night.",
  "Early check-in is possible.",
  "We can extend your booking.",
  "Happy to host you for another night!",
  "Sie können gerne eine Nacht länger bleiben.",
  "Vous pouvez rester une nuit de plus.",
  "Pueden quedarse una noche más.",
];

/** İstemin KENDİ standart erteleme cümleleri (Bölüm 7.5 + few-shot ÖRNEK 5/9 + bagaj örneği). */
export const PROMPT_CANONICAL_DEFERRALS: readonly string[] = [
  "Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.",
  "Hi John, our standard check-in is at 15:00. Whether an earlier arrival is possible is the host's call; your request has been recorded and is visible to your host.",
  "مرحباً، موعد تسجيل الخروج لدينا هو الساعة 11:00 صباحاً. الخروج المتأخر يعود لقرار المضيف؛ تم تسجيل طلبكم ويمكن للمضيف الاطلاع عليه.",
  "Hi, I completely understand wanting to drop your bags off early. Whether luggage drop-off before check-in is possible is the host's call; your request has been recorded and is visible to your host.",
];

/** Erteleme cevapları (iddia TAŞIMAZ, kararı ev sahibine bırakır). */
export const DEFERRALS: readonly string[] = [
  ...PROMPT_CANONICAL_DEFERRALS,
  "Normal çıkış saatimiz 11:00. Saat 13:00'teki çıkış isteği müsaitlik ve temizlik programına bağlı; bu ev sahibinizin kararıdır, mesajınız kaydedildi ve ev sahibiniz görebilir.",
  "Erken girişin mümkün olup olmadığı ev sahibinizin kararıdır; mesajınız kaydedildi.",
  "O gecenin boş olup olmadığını ev sahibiniz teyit edebilir; uzatma için platform üzerinden değişiklik talebi gönderebilirsiniz.",
  "Ev sahibinin geç çıkış teklifi: 14:00'e kadar 300 TL. Uygunluğu ev sahibinizin kararıdır.",
  "Whether you can extend is the host's call; you can also send a change request through Airbnb.",
  "Late check-out is subject to availability; your host will need to confirm.",
  "Die späte Abreise ist die Entscheidung des Gastgebers.",
  "Le départ tardif est la décision de l'hôte.",
  "La salida tardía es decisión del anfitrión.",
  "Поздний выезд — на усмотрение хозяина.",
];

/** Tarafsız cevaplar — ne iddia ne erteleme gerekir. */
export const NEUTRAL_REPLIES: readonly string[] = [
  "Giriş saatimiz 15:00'tir.",
  "Çıkış saatimiz 11:00; anahtarları kutuya bırakabilirsiniz.",
  "15:00'ten itibaren anahtar kutusuyla giriş yapabilirsiniz.",
  "Otopark müsait değil, sokakta park edebilirsiniz.",
  "Havlular dolapta mevcut.",
  "Buzdolabı boş, market 5 dakika uzaklıkta.",
  "Havuz 09:00-20:00 arası açık.",
  "Evcil hayvan kabul etmiyoruz.",
  "Erken giriş maalesef mümkün değil.",
  "Check-in is from 3 pm.",
  "The apartment is available from 15:00 for self check-in.",
  "The Wi-Fi is available in all rooms.",
  "Checkout is at 11:00; please leave the keys on the table.",
  "We're available to help if you need anything.",
  "The pool is open until 8 pm.",
];
