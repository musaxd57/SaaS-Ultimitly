import type { KbChunkSource } from "@/lib/ai/retrieval/chunker";

// ---------------------------------------------------------------------------
// SENTETİK MÜLK BİLGİ TABANI ÜRETİCİSİ (RAG dilim 2, 09-09) — deterministik.
//
// Amaç: küçük-KB passthrough'u değil GERÇEK retrieval yolunu 30/100/300 kalemde
// ölçmek. Her konu için 3 Türkçe paraphrase + 1 İngilizce varyant, konu başına
// TR/EN/eşanlam/yazım-hatası soruları; konu kelimesini BAŞKA anlamda kullanan
// çeldiriciler; her 50 kaleme bir 7k'lık rehber (gömülü gerçekler + soruları).
// `updatedAt` 400 güne tohumlu-rastgele yayılır → legacy'nin "en yeni 30"u
// rastgele bir alt kümedir (gerçek hayattaki gibi).
// Gerçek misafir/host metni YOKTUR.
// ---------------------------------------------------------------------------

export interface SynTopic {
  key: string;
  category: string;
  title: string;
  variants: [string, string, string];
  en: string;
  questions: { tr: string; en: string; syn: string; typo: string };
}

export const TOPICS: readonly SynTopic[] = [
  { key: "parking", category: "parking", title: "Otopark", variants: ["Bina altı otopark misafirler için ücretsizdir; giriş yan sokaktan.", "Aracınızı binanın arkasındaki açık otoparka bırakabilirsiniz, ücret alınmaz.", "Misafir otoparkı garaj katındadır; kapı uzaktan kumandayla açılır."], en: "Free parking for guests in the garage under the building; entrance from the side street.", questions: { tr: "Otopark var mı?", en: "Is there parking for my car?", syn: "Arabayı nereye koyabilirim?", typo: "otopakr varmı" } },
  { key: "trash", category: "trash", title: "Çöp", variants: ["Çöpler yan sokaktaki yeşil konteynere bırakılır.", "Çöp konteyneri binanın arkasında, geri dönüşüm kutusu yanındadır.", "Poşetlenmiş çöpü giriş katındaki büyük konteynere atabilirsiniz."], en: "Trash goes to the green container in the side street; recycling bin is next to it.", questions: { tr: "Çöpü nereye bırakayım?", en: "Where do I put the garbage?", syn: "Atıkları nereye atıyoruz?", typo: "çöpü nereye brakayım" } },
  { key: "wifi", category: "faq", title: "İnternet", variants: ["Kablosuz internet dairede ücretsizdir; modem salondadır.", "İnternet bağlantısı kesilirse modemi kapatıp otuz saniye sonra açın.", "Kablosuz ağ tüm odalarda çeker; modem TV ünitesinin altındadır."], en: "Wireless internet is free; the router is in the living room, restart it if the connection drops.", questions: { tr: "İnternet var mı?", en: "Is there wifi in the apartment?", syn: "Kablosuz bağlantı çalışıyor mu?", typo: "intenet var mı" } },
  { key: "ac", category: "faq", title: "Klima", variants: ["Klima kumandası TV sehpasının çekmecesindedir; soğutma için kar tanesi simgesi.", "Klimayı çalıştırmak için kumandadaki güç tuşuna basın, mod olarak soğutmayı seçin.", "Salon ve yatak odasında ayrı klima vardır; pencereler açıkken verimli çalışmaz."], en: "The air conditioning remote is in the TV stand drawer; select the snowflake for cooling.", questions: { tr: "Klima nasıl çalışıyor?", en: "How do I turn on the air conditioning?", syn: "Soğutma nasıl açılıyor?", typo: "klimayı nasıl çalıştrıyorum" } },
  { key: "heating", category: "faq", title: "Isıtma", variants: ["Isıtma kombi üzerinden radyatörlerle sağlanır; vanaları orta seviyede tutun.", "Kışın kalorifer kombiden çalışır, kombi paneli mutfaktadır.", "Radyatörler ısınmıyorsa kombi basıncına bakın; ayarları değiştirmeyin."], en: "Heating runs through the boiler and radiators; keep the valves at a medium level.", questions: { tr: "Isıtma nasıl açılıyor?", en: "How does the heating work?", syn: "Kalorifer nasıl çalışıyor?", typo: "ısıtma nasl açılıyor" } },
  { key: "hotwater", category: "faq", title: "Sıcak su", variants: ["Sıcak su kombiden gelir; musluğu açtıktan sonra yarım dakika bekleyin.", "Duşta sıcak su için birkaç saniye akıtmanız gerekir; kombi mutfaktadır.", "Sıcak su gelmezse kombinin ekranındaki hata koduna bakın ve haber verin."], en: "Hot water comes from the boiler; let the tap run for half a minute before showering.", questions: { tr: "Sıcak su nasıl geliyor?", en: "There is no hot water, what should I do?", syn: "Duş suyu ısınmıyor", typo: "sıcak su gelmiyr" } },
  { key: "checkout", category: "checkout", title: "Çıkış", variants: ["Çıkış saati 11:00'dir; anahtarı masanın üstüne bırakın.", "Ayrılırken pencereleri kapatıp anahtarı kutuya bırakmanız yeterlidir, çıkış 11:00.", "Çıkışta klimayı ve ışıkları söndürün; saat 11:00'e kadar daireyi boşaltın."], en: "Check-out is at 11:00; leave the key on the table and close the windows.", questions: { tr: "Çıkış saati kaçta?", en: "What time is check-out?", syn: "Kaçta ayrılmam gerekiyor?", typo: "çıkış saatı kaçta" } },
  { key: "checkin", category: "faq", title: "Giriş saati", variants: ["Giriş saati 15:00'tir; erken giriş temizliğe bağlıdır.", "Daireye 15:00'ten itibaren girebilirsiniz; erken giriş için önceden yazın.", "Giriş 15:00'te başlar, temizlik bitmişse daha erken haber veririz."], en: "Check-in starts at 15:00; early check-in depends on cleaning.", questions: { tr: "Giriş saati kaçta?", en: "When can I check in?", syn: "Daireye kaçta girebilirim?", typo: "giris saati kacta" } },
  { key: "elevator", category: "faq", title: "Asansör", variants: ["Asansör tüm katlara çıkar; bina kapısı otomatik kapanır.", "Bina asansörlüdür; bebek arabası için giriş rampası vardır.", "Asansör arızalanırsa bina görevlisine haber verin; merdiven koridorun sonundadır."], en: "The elevator serves all floors; there is a ramp at the entrance for strollers.", questions: { tr: "Asansör var mı?", en: "Is there an elevator?", syn: "Binada lift var mı?", typo: "asansor varmı" } },
  { key: "laundry", category: "cleaning", title: "Çamaşır", variants: ["Çamaşır makinesi banyodadır; deterjan lavabonun altındaki dolapta.", "Çamaşır yıkamak için banyodaki makineyi kullanın, kısa program kırk dakika.", "Çamaşır makinesi banyoda, kurutma askısı balkondadır."], en: "The washing machine is in the bathroom; detergent is under the sink.", questions: { tr: "Çamaşır makinesi var mı?", en: "Is there a washing machine?", syn: "Kıyafet yıkayabilir miyim?", typo: "çamasır makinesi varmı" } },
  { key: "dishwasher", category: "faq", title: "Bulaşık makinesi", variants: ["Bulaşık makinesi tabletleri lavabonun altındaki çekmecededir.", "Bulaşık makinesi tezgâhın altında; ekonomik program yeterlidir.", "Bulaşık tabletleri çekmecede; cam ve tahta eşyayı makineye koymayın."], en: "Dishwasher tablets are in the drawer under the sink; the eco program is enough.", questions: { tr: "Bulaşık makinesi nasıl çalışıyor?", en: "How do I use the dishwasher?", syn: "Bulaşıkları nerede yıkıyoruz?", typo: "bulasık makinası nasıl çalışıyor" } },
  { key: "towels", category: "cleaning", title: "Havlu ve çarşaf", variants: ["Yedek havlu ve çarşaf yatak odasındaki dolabın üst rafındadır.", "Temiz havlular banyodaki dolapta, yedek nevresim yatak odasında.", "Havlu değişimi talep üzerine yapılır; yedekler dolaptadır."], en: "Spare towels and sheets are on the top shelf of the bedroom wardrobe.", questions: { tr: "Yedek havlu var mı?", en: "Where are the extra towels?", syn: "Temiz çarşaf nerede?", typo: "yedek havlu varmı" } },
  { key: "iron", category: "faq", title: "Ütü", variants: ["Ütü ve ütü masası yatak odası dolabının yanındadır.", "Ütü dolabın içinde, masası kapının arkasındadır.", "Ütüyü kullandıktan sonra soğumasını bekleyip yerine kaldırın."], en: "The iron and ironing board are next to the bedroom wardrobe.", questions: { tr: "Ütü var mı?", en: "Is there an iron?", syn: "Kıyafetlerimi ütüleyebilir miyim?", typo: "ütü varmı" } },
  { key: "hairdryer", category: "faq", title: "Saç kurutma makinesi", variants: ["Saç kurutma makinesi banyo dolabının içindedir.", "Fön makinesi banyoda, aynanın altındaki çekmecededir.", "Saç kurutma makinesi lavabonun altındaki dolapta durur."], en: "The hair dryer is inside the bathroom cabinet.", questions: { tr: "Saç kurutma makinesi var mı?", en: "Is there a hair dryer?", syn: "Fön makinesi nerede?", typo: "sac kurutma makinesi varmı" } },
  { key: "tv", category: "faq", title: "Televizyon", variants: ["Televizyon akıllı uygulamalarla çalışır; kumandadaki ana menü tuşuyla açılır.", "TV'de kendi hesabınızla giriş yapabilirsiniz; çıkışta oturumu kapatın.", "Televizyon kumandası sehpadadır; uydu kanalları kaynak tuşundan seçilir."], en: "The smart TV works with apps; log in with your own account and log out at check-out.", questions: { tr: "Televizyon nasıl açılıyor?", en: "How does the TV work?", syn: "TV kumandası nerede?", typo: "televizyon nasl açılıyor" } },
  { key: "coffee", category: "faq", title: "Kahve makinesi", variants: ["Kahve makinesi kapsül kullanır; başlangıç kapsülleri dolapta.", "Kapsül kahve makinesi tezgâhtadır; su haznesini her sabah doldurun.", "Kahve makinesi için kapsülleri marketten alabilirsiniz; başlangıç seti bırakıldı."], en: "The coffee machine uses capsules; a starter set is in the cupboard.", questions: { tr: "Kahve makinesi var mı?", en: "Is there a coffee machine?", syn: "Kahve nasıl yapabilirim?", typo: "kahve makinası varmı" } },
  { key: "microwave", category: "faq", title: "Mikrodalga", variants: ["Mikrodalga tezgâhın üstündedir; metal kap koymayın.", "Mikrodalga fırının yanında; kapağı sıkı kapatmadan çalışmaz.", "Mikrodalgada yalnız cam ve porselen kap kullanın."], en: "The microwave is on the counter; do not put metal inside.", questions: { tr: "Mikrodalga var mı?", en: "Is there a microwave?", syn: "Yemek ısıtabileceğim bir şey var mı?", typo: "mikrodlga var mı" } },
  { key: "oven", category: "faq", title: "Fırın ve ocak", variants: ["Ocak indüksiyonludur; yalnız düz tabanlı tencereler çalışır.", "Fırın üst kapaktaki düğmeden çalışır; ocak indüksiyon.", "Ocak dokunmatiktir, kilit simgesine üç saniye basarak açılır."], en: "The hob is induction; only flat-bottom pans work. The oven starts from the top knob.", questions: { tr: "Ocak nasıl çalışıyor?", en: "How do I use the stove?", syn: "Fırını nasıl açıyorum?", typo: "ocak nasl çalışıyor" } },
  { key: "fridge", category: "faq", title: "Buzdolabı", variants: ["Buzdolabının sıcaklık ayarını değiştirmeyin; dondurucu alt bölmededir.", "Buzdolabında hoş geldin suyu bıraktık; dondurucu alt çekmecede.", "Buzdolabı kapısını uzun süre açık bırakmayın; alarm çalar."], en: "Do not change the fridge temperature; the freezer is the bottom drawer.", questions: { tr: "Dondurucu var mı?", en: "Is there a freezer?", syn: "Buzdolabı nasıl ayarlanıyor?", typo: "buzdolabi varmı" } },
  { key: "smoking", category: "rules", title: "Sigara", variants: ["Daire içinde sigara içilmez; balkonda içilebilir.", "Sigara yalnız balkonda; izmaritleri kül tablasına atın.", "İçeride sigara içilmesi temizlik ücreti yansıtılmasına neden olur."], en: "No smoking inside the apartment; smoking is allowed on the balcony.", questions: { tr: "Sigara içebilir miyim?", en: "Is smoking allowed?", syn: "Balkonda sigara serbest mi?", typo: "sigara içebilirmiyim" } },
  { key: "pets", category: "rules", title: "Evcil hayvan", variants: ["Evcil hayvan kabul edilmemektedir; rehber köpekler için yazın.", "Kedi ve köpek kabul edilmez; rehber hayvan istisnadır.", "Evcil hayvanla konaklama mümkün değildir."], en: "Pets are not allowed; guide dogs are an exception.", questions: { tr: "Köpeğimi getirebilir miyim?", en: "Are pets allowed?", syn: "Evcil hayvan kabul ediyor musunuz?", typo: "kopegimi getirebilirmiyim" } },
  { key: "noise", category: "rules", title: "Gürültü", variants: ["Gece geç saatlerde komşuları rahatsız edecek gürültü yapılmaz.", "Sessiz saatler gece 22:00'den sabah 08:00'e kadardır.", "Parti ve yüksek sesli müzik site kurallarına aykırıdır."], en: "Quiet hours are from 22:00 to 08:00; no parties.", questions: { tr: "Sessiz saatler ne zaman?", en: "Are there quiet hours?", syn: "Gürültü kuralı var mı?", typo: "sessiz saatlr ne zaman" } },
  { key: "pool", category: "rules", title: "Havuz", variants: ["Site havuzu 09:00–20:00 arasında açıktır; cam eşya yasaktır.", "Havuz sabah dokuzda açılır, akşam sekizde kapanır.", "Havuz alanında havlu ve şezlong ücretsizdir; cam eşya kullanılmaz."], en: "The pool is open from 09:00 to 20:00; no glass in the pool area.", questions: { tr: "Havuz saat kaçta açılıyor?", en: "When is the pool open?", syn: "Yüzme havuzu var mı?", typo: "havuz kaçta acılıyor" } },
  { key: "gym", category: "faq", title: "Spor salonu", variants: ["Site spor salonu giriş katındadır; anahtar kartla açılır.", "Fitness salonu her gün 07:00–22:00 arasında açıktır.", "Spor salonuna site kartınızla girebilirsiniz; havlu getirin."], en: "The gym is on the ground floor; it opens with the key card.", questions: { tr: "Spor salonu var mı?", en: "Is there a gym?", syn: "Fitness yapabileceğim yer var mı?", typo: "spor salonu varmı" } },
  { key: "pharmacy", category: "local_tips", title: "Eczane", variants: ["En yakın eczane sokağın köşesindedir; nöbetçi listesi camında.", "Eczane ana caddede, marketin yanındadır.", "Nöbetçi eczane için eczanenin camındaki listeye bakın."], en: "The nearest pharmacy is at the corner; the on-duty list is on its window.", questions: { tr: "En yakın eczane nerede?", en: "Where is the nearest pharmacy?", syn: "İlaç almam lazım, nereden?", typo: "eczane nerde" } },
  { key: "grocery", category: "local_tips", title: "Market", variants: ["Yürüme mesafesinde iki market var; büyük olanı gece geç saate kadar açık.", "Market ana caddede, iki dakika yürüme; pazar günleri de açık.", "Bakkal binanın altındadır; büyük market meydandadır."], en: "There are two supermarkets within walking distance; the big one is open late.", questions: { tr: "Yakında market var mı?", en: "Is there a supermarket nearby?", syn: "Alışveriş nereden yapabilirim?", typo: "yakında markt var mı" } },
  { key: "restaurant", category: "local_tips", title: "Restoran", variants: ["Balık için sahildeki lokantalar, kahvaltı için meydandaki kafe önerilir.", "Akşam yemeği için sahil yolundaki restoranlar; rezervasyon önerilir.", "Kahvaltı için köşedeki fırın, öğle için meydandaki lokanta iyidir."], en: "For fish try the seaside restaurants; for breakfast the cafe on the square.", questions: { tr: "Restoran önerir misiniz?", en: "Any restaurant recommendations?", syn: "Nerede yemek yiyebiliriz?", typo: "restorant önerirmisiniz" } },
  { key: "beach", category: "local_tips", title: "Plaj", variants: ["Plaja yürüyerek on beş dakikada ulaşılır; halk plajı ücretsiz.", "En yakın plaj sahil yolunun sonundadır; şezlong ücretlidir.", "Plaj için sahil yolunu takip edin; deniz suyu temizdir."], en: "The beach is a fifteen-minute walk; the public beach is free.", questions: { tr: "Plaj ne kadar uzak?", en: "How far is the beach?", syn: "Denize nasıl gidilir?", typo: "plaj nekadar uzak" } },
  { key: "metro", category: "location", title: "Toplu taşıma", variants: ["Metro durağı yürüyerek on dakika; otobüs durağı binanın önünde.", "Otobüs durağı kapının önünde; metro on dakika yürüme.", "Ulaşım kartını büfeden alabilirsiniz; metro ve otobüs yakındır."], en: "The metro is a ten-minute walk; the bus stop is in front of the building.", questions: { tr: "Metro ne kadar uzak?", en: "How do I get to the metro?", syn: "Toplu taşıma var mı?", typo: "metro nekadar uzak" } },
  { key: "airport", category: "location", title: "Havalimanı", variants: ["Havalimanına servis ana caddedeki duraktan kalkar.", "Havalimanı transferi için bir gün önceden yazın; taksi de mümkündür.", "Havalimanı otobüsü meydandan kalkar; yolculuk bir saat sürer."], en: "The airport shuttle leaves from the stop on the main street.", questions: { tr: "Havalimanına nasıl giderim?", en: "How do I get to the airport?", syn: "Uçağa nasıl ulaşırım?", typo: "havalimanına nasl giderim" } },
  { key: "taxi", category: "location", title: "Taksi", variants: ["Taksi çağırmak için uygulama kullanın; taksimetre çalıştırılmasını isteyin.", "Taksi durağı meydandadır; gece de çalışır.", "Taksi için resepsiyona yazın ya da uygulamadan çağırın."], en: "Use the app to call a taxi; ask them to run the meter.", questions: { tr: "Taksi nasıl çağırırım?", en: "How can I get a taxi?", syn: "Araç çağırabilir miyim?", typo: "taksi nasıl cağırırım" } },
  { key: "keys", category: "rules", title: "Anahtar", variants: ["Anahtar kaybolursa hemen haber verin; kilit değişimi ücretlidir.", "Yedek anahtar bina görevlisindedir; kaybolan anahtar ücret yansıtır.", "Anahtarı çıkışta masaya bırakın; kaybolursa yazın."], en: "If you lose the key, tell us immediately; lock replacement is charged.", questions: { tr: "Anahtarı kaybettim ne yapmalıyım?", en: "What if I lose the key?", syn: "Yedek anahtar var mı?", typo: "anahtarı kaybetim" } },
  { key: "doorman", category: "general", title: "Bina görevlisi", variants: ["Bina görevlisi hafta içi gündüz giriş katındaki odadadır.", "Kapıcı hafta içi çalışır; paketler ona bırakılabilir.", "Bina görevlisine kargo bırakabilirsiniz; hafta sonu yoktur."], en: "The building attendant is on the ground floor on weekdays; packages can be left with him.", questions: { tr: "Kapıcı var mı?", en: "Is there a building attendant?", syn: "Kargomu kim teslim alır?", typo: "kapıcı varmı" } },
  { key: "power", category: "faq", title: "Elektrik", variants: ["Elektrik sigorta kutusu giriş kapısının yanındaki dolaptadır.", "Sigorta atarsa dolaptaki şalteri yukarı kaldırın.", "Elektrik kesintisinde bina jeneratörü yalnız asansörü besler."], en: "The fuse box is in the cupboard next to the entrance door; flip the switch up.", questions: { tr: "Elektrikler gitti ne yapayım?", en: "The power went out, what do I do?", syn: "Sigorta nerede?", typo: "elektirikler gitti" } },
  { key: "plug", category: "faq", title: "Priz", variants: ["Prizler Avrupa tipidir; adaptör çekmecede bulunur.", "Adaptör ihtiyacı olursa TV sehpasının çekmecesine bakın.", "Priz tipi Avrupa standardı; İngiliz fişi için adaptör var."], en: "Sockets are European type; an adapter is in the drawer.", questions: { tr: "Priz adaptörü var mı?", en: "Do you have a plug adapter?", syn: "Fişim uymuyor, adaptör?", typo: "priz adaptoru varmı" } },
  { key: "crib", category: "faq", title: "Bebek yatağı", variants: ["Bebek yatağı ve mama sandalyesi talep üzerine temin edilir.", "Bebek için yatak istiyorsanız bir gün önceden yazın.", "Mama sandalyesi ve bebek yatağı depodadır; isteyince kurulur."], en: "A crib and high chair are available on request; ask a day ahead.", questions: { tr: "Bebek yatağı var mı?", en: "Is there a crib?", syn: "Bebek için karyola alabilir miyiz?", typo: "bebek yatağı varmı" } },
  { key: "fire", category: "general", title: "Yangın", variants: ["Yangın merdiveni koridorun sonundaki yeşil kapıdadır.", "Yangın söndürücü mutfak girişinde asılıdır.", "Yangın alarmı çalarsa merdiveni kullanın, asansörü değil."], en: "The fire escape is behind the green door at the end of the corridor.", questions: { tr: "Yangın merdiveni nerede?", en: "Where is the fire escape?", syn: "Acil çıkış nerede?", typo: "yangın merdiveni nerde" } },
  { key: "packages", category: "faq", title: "Kargo", variants: ["Kargo için bina adını ve daire numarasını verin; görevli yönlendirir.", "Yemek siparişinde kurye zili çalınca kapıyı açın.", "Kargo paketleri görevli odasında saklanır."], en: "For deliveries give the building name and apartment number; the attendant will direct the courier.", questions: { tr: "Kargo sipariş edebilir miyim?", en: "Can I receive a package here?", syn: "Yemek siparişi verebilir miyim?", typo: "kargo siparis edebilirmiyim" } },
];

/** Konu kelimesini BAŞKA anlamda kullanan çeldiriciler (ilgili sayılmaz). */
const DISTRACTORS: readonly { category: string; title: string; content: string }[] = [
  { category: "rules", title: "Balkon", content: "Balkon kapısı otopark tarafına bakar; rüzgârda çarpmasın diye kapatın." },
  { category: "general", title: "Bina girişi", content: "Bina girişindeki çöp kovası yalnız kapıcı içindir; kullanmayın." },
  { category: "rules", title: "Havuz kuralı", content: "Havuz kenarında klima yoktur; şemsiye ücretsizdir." },
  { category: "general", title: "Duyuru", content: "Metro inşaatı nedeniyle taksi durağı geçici olarak taşındı." },
  { category: "faq", title: "Pencere", content: "Pencereleri açarken sigara dumanının içeri girmemesine dikkat edin." },
  { category: "general", title: "Site yönetimi", content: "Site yönetimi anahtar kart ücretini yıllık aidattan tahsil eder." },
  { category: "faq", title: "Balkon mobilyası", content: "Balkondaki masayı plaj havlusuyla örtmeyin; boya lekelenir." },
  { category: "general", title: "Kat planı", content: "Elektrik odası ile eczane kapısı karıştırılmasın; ikisi de giriş kattadır." },
];

const GUIDE_FACTS: readonly { key: string; sentence: string; question: string }[] = [
  { key: "bike", sentence: "Bisikletler için giriş katında ayrı bir askı bulunur; kilidi kendiniz getirin.", question: "Bisikletimi nereye koyabilirim?" },
  { key: "lost", sentence: "Unutulan eşyalar bir hafta saklanır; kargo ücreti misafire aittir.", question: "Eşyamı unuttum, ne olur?" },
  { key: "water_cut", sentence: "Planlı su kesintisinde bina deposu otomatik devreye girer; basınç birkaç dakika düşer.", question: "Su kesintisi olursa ne olacak?" },
];

/** Tohumlu PRNG (mulberry32) — koşular arası aynı küme. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynQuestion {
  id: string;
  topic: string;
  kind: "tr" | "en" | "syn" | "typo" | "guide";
  text: string;
  /** Doğru kaynak kalem kimlikleri (konunun tüm varyantları). */
  goldIds: string[];
  /** Rehber soruları için: istem bloğunda bulunması gereken cümle. */
  mustContain?: string;
}

export interface SyntheticKb {
  items: (KbChunkSource & { supersededById: string | null })[];
  questions: SynQuestion[];
  /** Konu → kalem kimlikleri. */
  goldByTopic: Map<string, string[]>;
}

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 1, 10, 0, 0);

function guideText(round: number, facts: readonly typeof GUIDE_FACTS[number][]): string {
  const filler = [
    "Hoş geldiniz. Bu rehber dairedeki her şeyi açıklar; lütfen baştan sona bir göz atın. Giriş kapısı kendiliğinden kilitlenir.",
    "Koridordaki ışıklar hareket sensörlüdür ve birkaç dakika sonra kendiliğinden söner; bu normaldir. Merdiven sahanlığı da sensörlüdür.",
    "Yatak odasındaki dolapta yedek battaniye ve yastık vardır. Perdeler karartma perdesidir; sabah güneşi rahatsız ederse tam kapatın.",
    "Salondaki kanepe yatağa dönüşür; mekanizma altındaki koldan çekilir. Yastıkları sandığa kaldırabilirsiniz.",
    "Banyoda duş kabininin kapısını kapatmadan suyu açmayın; zemin kayganlaşabilir. Tuvalete kâğıt dışında hiçbir şey atmayın.",
    "Mutfak dolaplarında temel baharatlar ve yağ bulunur. Bıçaklar çekmecenin sol tarafında, kesme tahtası fırının yanındadır.",
    "Çevrede yürüyüş mesafesinde kafe, fırın ve manav vardır. Meydandaki pazar haftada bir kurulur.",
    "Sahil yolu koşu ve bisiklet için uygundur; akşamları kalabalık olabilir. Sahil kafeleri gece geç saate kadar açıktır.",
    "Site güvenliği gece de görevdedir ve ziyaretçileri kaydeder. Gece girişte kimlik istenebilir.",
    "Acil durumlarda önce acil çağrı hattını arayın, sonra ev sahibine yazın. Gaz kokusu alırsanız pencereleri açıp binayı terk edin.",
    "Çocuklar için balkon kapısında güvenlik kilidi vardır; anahtarı çekmecededir. Merdiven korkulukları alçaktır, dikkat edin.",
    "Bizi tercih ettiğiniz için teşekkür ederiz; yorumunuz bizim için değerlidir. İyi yolculuklar dileriz.",
  ];
  // Gerçekler paragrafların ORTASINA (4., 7., 10.) gömülür.
  const paragraphs = [...filler];
  facts.forEach((f, i) => {
    const at = 3 + i * 3;
    paragraphs[at] = `${paragraphs[at]} ${f.sentence}`;
  });
  return paragraphs.map((p) => `${p} (Rehber ${round})`).join("\n\n");
}

/**
 * `n` konu kalemi + n/10 çeldirici + her 50 kaleme bir rehber. Kimlikler kararlı
 * (`syn_<konu>_<tur>`), `updatedAt` 400 güne tohumlu yayılır.
 */
export function makeSyntheticKb(n: number, seed = 42): SyntheticKb {
  const rnd = seededRandom(seed);
  const items: SyntheticKb["items"] = [];
  const goldByTopic = new Map<string, string[]>();
  const T = TOPICS.length;
  for (let i = 0; i < n; i++) {
    const topic = TOPICS[i % T];
    const round = Math.floor(i / T);
    const variant = topic.variants[round % 3];
    const id = `syn_${topic.key}_${round}`;
    items.push({
      id,
      category: topic.category,
      title: round === 0 ? topic.title : `${topic.title} (${round + 1})`,
      content: round === 0 ? variant : `${variant} Blok ${String.fromCharCode(65 + (round % 26))}.`,
      updatedAt: new Date(BASE - Math.floor(rnd() * 400) * DAY),
      supersededById: null,
    });
    goldByTopic.set(topic.key, [...(goldByTopic.get(topic.key) ?? []), id]);
  }
  const distractorCount = Math.max(1, Math.floor(n / 10));
  for (let i = 0; i < distractorCount; i++) {
    const d = DISTRACTORS[i % DISTRACTORS.length];
    items.push({
      id: `syn_distractor_${i}`,
      category: d.category,
      title: i < DISTRACTORS.length ? d.title : `${d.title} (${Math.floor(i / DISTRACTORS.length) + 1})`,
      content: d.content,
      updatedAt: new Date(BASE - Math.floor(rnd() * 400) * DAY),
      supersededById: null,
    });
  }
  const guides = Math.max(1, Math.floor(n / 50));
  const questions: SynQuestion[] = [];
  for (let g = 0; g < guides; g++) {
    const id = `syn_guide_${g}`;
    items.push({
      id,
      category: "general",
      title: g === 0 ? "Ev rehberi" : `Ev rehberi (${g + 1})`,
      content: guideText(g + 1, GUIDE_FACTS),
      updatedAt: new Date(BASE - Math.floor(rnd() * 400) * DAY),
      supersededById: null,
    });
    if (g === 0) {
      for (const f of GUIDE_FACTS) {
        questions.push({
          id: `q_guide_${f.key}`,
          topic: `guide:${f.key}`,
          kind: "guide",
          text: f.question,
          goldIds: Array.from({ length: guides }, (_, k) => `syn_guide_${k}`),
          mustContain: f.sentence,
        });
      }
    }
  }
  for (const [key, ids] of goldByTopic) {
    const topic = TOPICS.find((t) => t.key === key)!;
    for (const kind of ["tr", "en", "syn", "typo"] as const) {
      questions.push({ id: `q_${key}_${kind}`, topic: key, kind, text: topic.questions[kind], goldIds: ids });
    }
  }
  return { items, questions, goldByTopic };
}

/** Bir konu kalemini "günceller": yeni içerik + yeni `updatedAt` + tekil işaret. */
export function updatedItem<T extends KbChunkSource>(item: T, marker: string, now = Date.now()): T {
  return { ...item, content: `${item.content} ${marker}`, updatedAt: new Date(now) };
}
