// ---------------------------------------------------------------------------
// PARAFRAZ + NEGATİF sorgu kümeleri (09-23 ajan ölçümü; SENTETİK — gerçek misafir metni YOK).
//
// Parafraz: altın kalemin kelimelerini (neredeyse) HİÇ paylaşmayan gerçekçi misafir ifadesi
// (`kb-retrieval-synthetic.ts` konuları). 82 sorgunun 74'ü altınla ortak güçlü kök taşımaz → sözcüksel
// retrieval'ın YAPISAL sınırını ölçer (embedding'in asıl gerekçesi). Bazıları bilinçli bir sözcük TUZAĞI
// taşır (`trap`: başka konunun kalemine işaret eden kelime). Negatif: cevap sentetik KB'de YOK.
// Ölçüm belgesi: `docs/olcum/kb-retrieval-parafraz-2026-09-23.md`.
// ---------------------------------------------------------------------------
export interface ParaQuery {
  id: string;
  lang: "tr" | "en";
  /** Topic key in TOPICS, or "guide:<factKey>". */
  gold: string;
  text: string;
  /** Word that lexically points at ANOTHER topic's item (realistic confusion), if any. */
  trap?: string;
}

const P = (gold: string, tr: string, en: string, trapTr?: string, trapEn?: string): ParaQuery[] => [
  { id: `p_${gold.replace("guide:", "g_")}_tr`, lang: "tr", gold, text: tr, ...(trapTr ? { trap: trapTr } : {}) },
  { id: `p_${gold.replace("guide:", "g_")}_en`, lang: "en", gold, text: en, ...(trapEn ? { trap: trapEn } : {}) },
];

export const PARAPHRASES: readonly ParaQuery[] = [
  ...P("parking", "Kiraladığımız otomobili gece nerede tutabiliriz?", "Where can I leave the rental car overnight?"),
  ...P("trash", "Mutfaktaki artıklar birikti, dışarı nereye çıkaralım?", "What do we do with the rubbish when the bin bag is full?"),
  ...P("wifi", "Evden çalışacağım, çevrimiçi toplantılara katılabilir miyim?", "I need to get online for a work call, is that possible?"),
  ...P("ac", "İçerisi çok boğucu, serinletmenin bir yolu var mı?", "It's boiling inside, how can we cool the place down?"),
  ...P("heating", "Gece çok üşüdük, evi daha ılık yapabilir miyiz?", "We are freezing at night, can we make the flat warmer?"),
  ...P("hotwater", "Yıkanırken buz gibi akıyor, ılıtmak için ne yapmalı?", "The shower only runs cold, how do I get it warm?"),
  ...P("checkout", "Pazar günü uçağımız akşam, sabah en geç ne zamana kadar kalabiliriz?", "On our last day, until when can we stay?", "uçak→airport"),
  ...P("checkin", "Öğlen gibi şehre varıyoruz, eve hemen yerleşebilir miyiz?", "Our train gets in at noon, can we settle in right away?"),
  ...P("elevator", "Annem dizlerinden rahatsız, üst kata basamaksız çıkabilir mi?", "My mother can't manage stairs, is there another way up?"),
  ...P("laundry", "Kirli kıyafetlerimiz birikti, temizlemenin bir yolu var mı?", "Is there somewhere to wash clothes?"),
  ...P("dishwasher", "Yemekten sonra tabak çanağı elde mi yıkayacağız?", "Do we have to do the dishes by hand?"),
  ...P("towels", "Duştan sonra kurulanacak bir şey bulamadık", "We need more things to dry ourselves after showering", "duş→hotwater"),
  ...P("iron", "Gömleğim kırış kırış oldu, düzeltmem lazım", "My shirt is all wrinkled, how can I press it?"),
  ...P("hairdryer", "Kafam ıslak kaldı, hızlıca kurulamak için bir cihaz var mı?", "I need to blow-dry my hair, is there a device for that?"),
  ...P("tv", "Akşam dizi izlemek istiyoruz, ekranı nasıl açarız?", "We want to watch a series tonight, how do we switch on the screen?"),
  ...P("coffee", "Sabahları espresso içmeden kendime gelemiyorum, hazırlayabileceğim bir şey var mı?", "I can't start my day without an espresso, can I make one?"),
  ...P("microwave", "Dünden kalan yemeği çabucak ılıtmak istiyorum", "I want to warm up leftovers quickly", "yemek→restaurant/packages"),
  ...P("oven", "Makarna haşlamak istiyoruz, pişirme nasıl yapılıyor?", "We'd like to cook pasta, how do the burners work?"),
  ...P("fridge", "Aldığımız buzlu ürünleri nerede saklayalım?", "Where can we keep frozen food?"),
  ...P("smoking", "Eşim tütün kullanıyor, içeride yakabilir mi?", "My husband smokes, can he light up indoors?"),
  ...P("pets", "Tüylü dostumuzla gelebilir miyiz?", "Can we bring our furry friend along?"),
  ...P("noise", "Gece yarısına kadar arkadaşlarla kutlama yapabilir miyiz?", "Can we have friends over and celebrate late into the night?"),
  ...P("pool", "Çocuklar suya girmek istiyor, yüzebilecekleri bir yer var mı?", "The kids want to swim, where can they go for a dip?"),
  ...P("gym", "Tatilde antrenmanımı aksatmak istemiyorum, ağırlık çalışabileceğim bir yer var mı?", "Can I lift weights or work out somewhere?"),
  ...P("pharmacy", "Başım çok ağrıyor, ağrı kesici nereden bulurum?", "I have a headache, where can I buy painkillers?"),
  ...P("grocery", "Süt, yumurta ve ekmek nereden alabiliriz?", "Where can we buy milk and eggs?"),
  ...P("restaurant", "Akşam dışarıda karnımızı doyurmak istiyoruz, nereyi tavsiye edersiniz?", "Where should we go out for dinner tonight?"),
  ...P("beach", "Kumda güneşlenmek için nereye gidelim?", "We want to sunbathe on the sand, where should we go?"),
  ...P("metro", "Şehir merkezine arabasız nasıl gideriz?", "How can we get downtown without a car?", "araba→parking/taxi", "car→parking"),
  ...P("airport", "Uçuşumuz sabah erken, terminale nasıl gideriz?", "Our flight leaves early, how do we reach the terminal?"),
  ...P("taxi", "Gece geç saatte bizi alacak bir şoför bulabilir miyiz?", "Can you get us a cab late at night?"),
  ...P("keys", "Evin kilidini açan şeyi düşürmüşüz, içeri giremiyoruz", "We misplaced the thing that opens the front door, what now?"),
  ...P("doorman", "Binada gündüz bize yardımcı olacak bir sorumlu kişi var mı?", "Is there a concierge in the building during the day?"),
  ...P("power", "Birden bütün lambalar söndü, ne yapmalıyız?", "Suddenly all the lights went off, what should we do?", "söndür→checkout"),
  ...P("plug", "İngiltere'den geldik, şarj aletimiz duvara uymuyor", "Our UK charger doesn't fit the wall outlet"),
  ...P("crib", "Altı aylık oğlumuz geceleri nerede uyuyacak?", "Where will our six-month-old sleep?"),
  ...P("fire", "Duman kokusu alırsak binadan nasıl kaçarız?", "If there's smoke, how do we get out of the building?", "duman→smoking distractor", "smoke→smoking"),
  ...P("packages", "Online alışveriş yaptım, bu adrese teslim edilebilir mi?", "Can I have an online order delivered here?", "alışveriş→grocery"),
  ...P("guide:bike", "İki tekerlilerimizi nerede muhafaza edebiliriz?", "Where can we store our bicycles?"),
  ...P("guide:lost", "Çıkarken şarj aletimi odada bıraktım, geri alabilir miyim?", "I left my charger behind after checking out, can you send it?", "şarj aleti→plug", "check out→checkout"),
  ...P("guide:water_cut", "Şebeke suyu giderse ne yapacağız?", "What happens if the mains water supply stops?"),
];

export interface NegQuery {
  id: string;
  lang: "tr" | "en";
  text: string;
}

export const NEGATIVES: readonly NegQuery[] = [
  { id: "n_jacuzzi_tr", lang: "tr", text: "Jakuzi var mı?" },
  { id: "n_sauna_tr", lang: "tr", text: "Sauna kullanabilir miyiz?" },
  { id: "n_piano_tr", lang: "tr", text: "Evde piyano var mı?" },
  { id: "n_bbq_tr", lang: "tr", text: "Bahçede barbekü yapabilir miyiz?" },
  { id: "n_tennis_tr", lang: "tr", text: "Yakında tenis kortu var mı?" },
  { id: "n_console_tr", lang: "tr", text: "Oyun konsolu var mı?" },
  { id: "n_extend_tr", lang: "tr", text: "Rezervasyonu bir gece uzatabilir miyiz?" },
  { id: "n_boat_tr", lang: "tr", text: "Tekne turu ayarlayabilir misiniz?" },
  { id: "n_bedrooms_tr", lang: "tr", text: "Dairede kaç yatak odası var?" },
  { id: "n_invoice_tr", lang: "tr", text: "Faturayı şirket adına kesebilir misiniz?" },
  { id: "n_hottub_en", lang: "en", text: "Is there a hot tub?" },
  { id: "n_boat_en", lang: "en", text: "Can you arrange a boat trip?" },
  { id: "n_yoga_en", lang: "en", text: "Do you offer yoga classes?" },
  { id: "n_sauna_en", lang: "en", text: "Is there a sauna?" },
  { id: "n_extend_en", lang: "en", text: "Can we extend our stay by one night?" },
  { id: "n_piano_en", lang: "en", text: "Is there a piano we can play?" },
  { id: "n_deposit_en", lang: "en", text: "Can I pay the deposit in cash?" },
  { id: "n_games_en", lang: "en", text: "Do you have board games for the kids?" },
  { id: "n_terrace_en", lang: "en", text: "Is there a rooftop terrace with a view?" },
  { id: "n_dentist_en", lang: "en", text: "Can you recommend a dentist?" },
];
