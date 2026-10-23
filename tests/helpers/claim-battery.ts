// İDDİA DESTEĞİ ölçüm bataryası (09-23 ajan ölçümünden; SENTETİK — gerçek misafir/işletme verisi YOK).
// Bağlamlar repo fikstürlerinden (demo veri kümesi, KB_PRESETS, sentetik retrieval konuları, eval KB'leri).
// Cevaplar elle yazıldı: "legit" = bağlamdaki bir olguyu (başka biçimde bile) yazar; "fab" = bağlamda OLMAYAN
// somut bir değer ekler. Ürün kodu bu dosyayı KULLANMAZ; yalnız ölçüm/pin.
// Battery: realistic contexts (built from repo fixtures) + legit and fabricated replies.
import type { SuggestReplyInput, HistoryMessage } from "@/lib/ai/types";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

// ── demo dataset kbFor() (src/lib/demo-tenant/dataset.ts:261) for spec 01 / 07 ──
const demoKb = (checkIn: string, checkOut: string, parking: string) => [
  { category: "wifi", title: "Wi-Fi", content: "Kablosuz ağın adı ve şifresi modemin altındaki etikette yazılıdır. Modem salondaki televizyon ünitesinin üzerindedir." },
  { category: "checkin", title: "Giriş", content: `Giriş saat ${checkIn}'ten itibarendir. Anahtar, kapının yanındaki şifreli anahtar kutusundadır.` },
  { category: "checkout", title: "Çıkış", content: `Çıkış saat ${checkOut}'e kadardır. Anahtarı kutuya bırakmanız yeterlidir.` },
  { category: "rules", title: "Ev kuralları", content: "Evde sigara içilmez. Evcil hayvan kabul edilmez. Gece 23:00'ten sonra sessizlik rica olunur. Parti ve etkinlik yapılamaz." },
  { category: "parking", title: "Otopark", content: parking },
  { category: "local_tips", title: "Yakın çevre", content: "En yakın market yaklaşık beş dakika yürüme mesafesindedir. Eczane ana caddenin köşesindedir." },
  { category: "cleaning", title: "Havlu ve çarşaf", content: "Yedek havlular ve çarşaflar yatak odasındaki dolabın üst rafındadır." },
];

type Ctx = Omit<SuggestReplyInput, "guestMessage" | "history"> & { history?: HistoryMessage[] };

export const CONTEXTS: Record<string, Ctx> = {
  // Demo spec 01 + an emergency-line KB item; 3 nights; same-day turnover before arrival.
  MODA: {
    property: { name: "Lale Moda", checkInTime: "15:00", checkOutTime: "11:00", address: "Caferağa Mah. Moda Cad. No:12 D:5", city: "İstanbul" },
    reservation: { guestName: "Elif K.", arrivalDate: d("2026-10-15"), departureDate: d("2026-10-18"), status: "confirmed" },
    adjacency: { previousDeparture: d("2026-10-15"), nextArrival: d("2026-10-20"), previousSameDay: true, nextSameDay: false },
    knowledgeBase: [
      ...demoKb("15:00", "11:00", "Mülke ait otopark yoktur; sokakta ücretli park yeri bulunur."),
      { category: "general", title: "Acil iletişim", content: "Acil durumlarda 7/24 ulaşabileceğiniz hat: 0532 111 22 33." },
    ],
    tone: "warm", language: "tr",
  },
  // Demo spec 07 (villa), 1 night, host late-checkout offer, pool + transfer.
  YALI: {
    property: { name: "Lale Yalıkavak", checkInTime: "16:00", checkOutTime: "11:00", address: "Yalıkavak Mah. Çökertme Sok. No:8", city: "Muğla" },
    reservation: { guestName: "Sofia R.", arrivalDate: d("2026-10-10"), departureDate: d("2026-10-11"), status: "confirmed" },
    adjacency: { previousDeparture: d("2026-10-06"), nextArrival: null },
    knowledgeBase: [
      ...demoKb("16:00", "11:00", "Villanın önünde iki araçlık özel park yeri vardır."),
      { category: "amenity", title: "Havuz", content: "Villanın özel havuzu 08:00–22:00 arası kullanılabilir. Havuz ısıtması yoktur." },
      { category: "location", title: "Havalimanı transferi", content: "Milas-Bodrum Havalimanı'na transfer 1.800 TL, yolculuk yaklaşık 45 dakika." },
    ],
    lateCheckoutOfferText: "Geç çıkış 14:00'e kadar 750 TL; bir gece uzatma 4.500 TL.",
    tone: "warm", language: "tr",
  },
  // KB_PRESETS (src/components/knowledge/kb-manager.tsx:45) FILLED by a host; 7 nights.
  PRESET: {
    property: { name: "Deniz Apart 3", checkInTime: "15:00", checkOutTime: "11:00", address: "Atatürk Cad. No:45", city: "Antalya" },
    reservation: { guestName: "Mert A.", arrivalDate: d("2026-10-05"), departureDate: d("2026-10-12"), status: "confirmed" },
    knowledgeBase: [
      { category: "wifi", title: "Wi-Fi bilgisi", content: "Ağ adı (SSID): LaleNet_5G\nŞifre: deniz2024!\nModem salonda, TV ünitesinin yanındadır. Bağlantı sorunu olursa modemi 10 saniye kapatıp açmayı deneyebilirsiniz." },
      { category: "checkin", title: "Giriş talimatı", content: "Giriş saati: 15:00 ve sonrasıdır.\nAdres: Atatürk Cad. No:45 Konyaaltı\nBinaya girişte zil 3B. Daire 3. katta, kapı no 7.\nAnahtar: kapıdaki şifreli anahtar kutusu, kod 4827.\nSorun yaşarsanız bize bu kanaldan yazabilirsiniz." },
      { category: "parking", title: "Otopark", content: "En yakın otopark: Merkez Otopark, yürüme mesafesi 4 dk, günlük yaklaşık ücret ₺150." },
      { category: "trash", title: "Çöp ve geri dönüşüm", content: "Çöpleri ağzı bağlı poşetle binanın yan sokağındaki konteynere bırakabilirsiniz. Geri dönüşüm kutusu otopark girişinde." },
      { category: "rules", title: "Ev kuralları", content: "Dairede sigara içilmez.\nEvcil hayvan kabul edilmez.\nSaat 22:00'den sonra lütfen gürültü yapmayınız (bina sakinleri için).\nParti / etkinlik düzenlenemez.\nMisafir sayısı rezervasyonda belirtilen kişi sayısını aşamaz." },
      { category: "checkout", title: "Çıkış hatırlatması", content: "Çıkış saati 11:00'dir. Ayrılırken pencereleri kapatmanız, klimayı kapatmanız ve anahtarı kutuya bırakmanız yeterli." },
      { category: "cleaning", title: "Temizlik ve havlu", content: "7 geceden uzun konaklamalarda ara temizlik ücretsizdir; havlular 3 günde bir değiştirilir. Her misafire iki havlu verilir." },
      { category: "rules", title: "Depozito", content: "Hasar depozitosu 2.000 TL'dir, çıkıştan sonra 48 saat içinde iade edilir." },
    ],
    tone: "warm", language: "tr",
  },
  // Synthetic topics (tests/helpers/kb-retrieval-synthetic.ts) with NUMBER WORDS; QR (no reservation).
  SYN: {
    property: { name: "Lale Kule 104", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: "İzmir" },
    reservation: null,
    verifiedActiveStay: true,
    knowledgeBase: [
      { category: "rules", title: "Havuz", content: "Havuz sabah dokuzda açılır, akşam sekizde kapanır." },
      { category: "faq", title: "Spor salonu", content: "Fitness salonu her gün 07:00–22:00 arasında açıktır." },
      { category: "rules", title: "Gürültü", content: "Sessiz saatler gece 22:00'den sabah 08:00'e kadardır." },
      { category: "local_tips", title: "Plaj", content: "Plaja yürüyerek on beş dakikada ulaşılır; halk plajı ücretsiz." },
      { category: "location", title: "Toplu taşıma", content: "Metro durağı yürüyerek on dakika; otobüs durağı binanın önünde." },
      { category: "location", title: "Havalimanı", content: "Havalimanı otobüsü meydandan kalkar; yolculuk bir saat sürer." },
      { category: "cleaning", title: "Çamaşır", content: "Çamaşır yıkamak için banyodaki makineyi kullanın, kısa program kırk dakika." },
      { category: "faq", title: "İnternet", content: "İnternet bağlantısı kesilirse modemi kapatıp otuz saniye sonra açın." },
      { category: "faq", title: "Fırın ve ocak", content: "Ocak dokunmatiktir, kilit simgesine üç saniye basarak açılır." },
      { category: "faq", title: "Sıcak su", content: "Sıcak su kombiden gelir; musluğu açtıktan sonra yarım dakika bekleyin." },
      { category: "local_tips", title: "Market", content: "Market ana caddede, iki dakika yürüme; pazar günleri de açık." },
      { category: "checkout", title: "Çıkış", content: "Çıkış saati 11:00'dir; anahtarı masanın üstüne bırakın." },
    ],
    tone: "warm", language: "tr",
  },
  // English-writing host.
  EN: {
    property: { name: "Sea View Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "12 Harbour Street", city: "Fethiye" },
    reservation: { guestName: "James T.", arrivalDate: d("2026-10-20"), departureDate: d("2026-10-24"), status: "confirmed" },
    knowledgeBase: [
      { category: "checkin", title: "Check-in", content: "Self check-in from 3 pm with the keybox next to the door; keybox code 7391." },
      { category: "local_tips", title: "Beach", content: "The beach is a 10-minute walk (about 800 m)." },
      { category: "general", title: "Emergency contact", content: "Emergency contact: +90 532 123 45 67 (24/7)." },
      { category: "local_tips", title: "Breakfast", content: "The café downstairs serves breakfast from 8 am to 11 am; a set breakfast costs €12." },
      { category: "wifi", title: "Wi-Fi", content: "Network 'SeaView', password 'blue-wave-88'." },
      { category: "rules", title: "House rules", content: "Quiet hours 11 pm – 7 am. Maximum 4 guests." },
      { category: "location", title: "Floor", content: "The apartment is on the 2nd floor; there is no elevator." },
      { category: "location", title: "Airport transfer", content: "Dalaman Airport transfer costs 35 EUR per car, about 50 minutes." },
    ],
    tone: "warm", language: "en",
  },
  // History carries an operator-given code.
  HIST: {
    property: { name: "Lale Cihangir", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: "İstanbul" },
    reservation: { guestName: "Can B.", arrivalDate: d("2026-09-21"), departureDate: d("2026-09-25"), status: "confirmed" },
    knowledgeBase: [
      { category: "parking", title: "Otopark", content: "Mülke ait otopark yoktur; en yakın kapalı otopark beş dakika yürüme mesafesindedir." },
    ],
    history: [
      { direction: "inbound", body: "Merhaba, kapı kodunu unuttum" },
      { direction: "outbound", body: "Merhaba, anahtar kutusunun kodu 5821." },
      { direction: "inbound", body: "Teşekkürler! Bir de 2 yetişkin 1 çocuk kalıyoruz, ek yatak var mı?" },
      { direction: "outbound", body: "Rica ederim. Ek yatak konusunu ev sahibiniz görebilir." },
    ],
    tone: "warm", language: "tr",
  },
  // evals/qr-kb-coverage.json E6/E8 KBs; QR.
  EVAL: {
    property: { name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
    reservation: null,
    verifiedActiveStay: true,
    knowledgeBase: [
      { category: "parking", title: "Otopark", content: "Bina altı otopark ücretsizdir." },
      { category: "trash", title: "Çöp", content: "Çöpler yan sokaktaki konteynere bırakılır." },
      { category: "faq", title: "Genel", content: "Daire 3. kattadır." },
    ],
    tone: "warm", language: "tr",
  },
  // Pre-booking inquiry (no reservation, not verified) — nothing to echo but the question.
  PRE: {
    property: { name: "Lale Alaçatı", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: "İzmir" },
    reservation: null,
    knowledgeBase: [
      { category: "amenity", title: "Olanaklar", content: "Taş evde 2 yatak odası ve 1 banyo vardır; en fazla 4 kişi konaklayabilir. Avluda bir araçlık park yeri var." },
      { category: "local_tips", title: "Konum", content: "Alaçatı çarşısına 300 metre, rüzgâr sörfü plajına 3 km mesafededir." },
    ],
    tone: "warm", language: "tr",
  },
};

export interface Case {
  id: string;
  ctx: keyof typeof CONTEXTS;
  guest: string;
  reply: string;
  kind: "legit" | "fab";
  /** fabricated: which class the planted claim belongs to (for class-level recall) */
  plant?: string;
  note?: string;
}

// days until arrival for MODA as the prompt builder computes it (timeline)

export const CASES: Case[] = [
  // ════════ LEGIT (grounded) ════════
  // property fields → times
  { id: "L01", ctx: "MODA", guest: "Giriş saati kaçta?", reply: "Merhaba Elif, giriş saatimiz 15:00'ten itibarendir. Anahtar, kapının yanındaki şifreli anahtar kutusundadır.", kind: "legit" },
  { id: "L02", ctx: "MODA", guest: "What time is check-in?", reply: "Hi Elif, check-in is from 3 pm, and check-out is by 11 a.m.", kind: "legit", note: "15:00→3 pm, 11:00→11 a.m." },
  { id: "L03", ctx: "MODA", guest: "Kaçta girebiliriz?", reply: "Öğleden sonra 3'ten itibaren giriş yapabilirsiniz.", kind: "legit", note: "öğleden sonra 3" },
  { id: "L04", ctx: "MODA", guest: "Giriş saati?", reply: "Giriş saat 15.00'te başlıyor.", kind: "legit", note: "15.00 dotted" },
  { id: "L05", ctx: "MODA", guest: "Saat kaçta girebiliriz?", reply: "Saat üçten sonra giriş yapabilirsiniz.", kind: "legit", note: "number word after saat" },
  { id: "L06", ctx: "MODA", guest: "Çıkış ne zaman?", reply: "Çıkışınız 18.10.2026 tarihinde, saat 11:00'e kadar.", kind: "legit", note: "reservation date dd.mm.yyyy" },
  { id: "L07", ctx: "MODA", guest: "Çıkış günümüz hangi gün?", reply: "18 Ekim Pazar günü saat 11'e kadar çıkış yapmanız gerekiyor.", kind: "legit", note: "date as words + saat 11'e" },
  { id: "L08", ctx: "MODA", guest: "Kaç gece kalıyoruz?", reply: "Konaklamanız 3 gece sürüyor; 15 Ekim'de giriş, 18 Ekim'de çıkış.", kind: "legit", note: "derived nights" },
  { id: "L09", ctx: "MODA", guest: "Market yakın mı?", reply: "En yakın market yaklaşık 5 dakika yürüme mesafesinde, eczane de ana caddenin köşesinde.", kind: "legit", note: "beş dakika → 5" },
  { id: "L10", ctx: "MODA", guest: "Is there a supermarket nearby?", reply: "Yes, the nearest market is about a five-minute walk from the apartment.", kind: "legit", note: "five-minute" },
  { id: "L11", ctx: "MODA", guest: "Sessizlik saati var mı?", reply: "Gece 23:00'ten sonra sessizlik rica ediyoruz.", kind: "legit" },
  { id: "L12", ctx: "MODA", guest: "Gece gürültü kuralı?", reply: "Gece 11'den sonra sessizlik rica olunur.", kind: "legit", note: "gece 11 → 23:00" },
  { id: "L13", ctx: "MODA", guest: "Quiet hours?", reply: "We kindly ask for quiet after 11 pm.", kind: "legit", note: "11 pm" },
  { id: "L14", ctx: "MODA", guest: "Acil bir durumda ne yapayım?", reply: "Can güvenliğiniz için acil bir durumda lütfen 112'yi arayın. Diğer acil konular için 7/24 hattımız: 0532 111 22 33.", kind: "legit", note: "112 const + 7/24 + phone" },
  { id: "L15", ctx: "MODA", guest: "Emergency number?", reply: "In an emergency please call 112. You can also reach the host line 24/7 at +90 532 111 22 33.", kind: "legit", note: "phone reformatted +90" },
  { id: "L16", ctx: "MODA", guest: "Erken giriş mümkün mü?", reply: "Giriş günü aynı dairede önceki misafir 11:00'de çıkıyor; temizlik sonrası 15:00'te giriş yapabilirsiniz. Erken giriş kararı ev sahibinizindir.", kind: "legit", note: "adjacency" },
  // L17 ("girişe kaç gün kaldı") BİLEREK çıkarıldı: cevap `Date.now()`a bağlıydı → takvim ilerleyince saat bombası.
  { id: "L18", ctx: "MODA", guest: "Adres neydi?", reply: "Adresimiz Caferağa Mah. Moda Cad. No:12 D:5, İstanbul.", kind: "legit", note: "address numbers" },
  { id: "L19", ctx: "MODA", guest: "Otopark var mı?", reply: "Mülke ait otopark yok; sokakta ücretli park yeri bulabilirsiniz.", kind: "legit", note: "0 claims" },

  // YALI — offer/prices/1 night
  { id: "L20", ctx: "YALI", guest: "Geç çıkış yapabilir miyiz?", reply: "Ev sahibimizin teklifi: geç çıkış 14:00'e kadar 750 TL. Son onay ev sahibinizdedir.", kind: "legit", note: "offer" },
  { id: "L21", ctx: "YALI", guest: "Can we check out later?", reply: "The host offers late check-out until 2 pm for 750 TRY; final confirmation is with your host.", kind: "legit", note: "2 pm, TRY" },
  { id: "L22", ctx: "YALI", guest: "Bir gece daha kalabilir miyiz?", reply: "Ev sahibimizin uzatma teklifi bir gece için 4.500 TL; uygunluğu ev sahibiniz teyit eder.", kind: "legit", note: "thousand sep" },
  { id: "L23", ctx: "YALI", guest: "Kaç gece kalıyoruz?", reply: "Rezervasyonunuz 1 gecelik: 10 Ekim giriş, 11 Ekim çıkış.", kind: "legit", note: "1 gece derived" },
  { id: "L24", ctx: "YALI", guest: "Havuz saatleri?", reply: "Özel havuz 08:00-22:00 arası kullanılabilir; ısıtma yok.", kind: "legit" },
  { id: "L25", ctx: "YALI", guest: "Pool hours?", reply: "The private pool can be used from 8 am to 10 pm.", kind: "legit", note: "am/pm conversion" },
  { id: "L26", ctx: "YALI", guest: "Havalimanı transferi ne kadar?", reply: "Milas-Bodrum Havalimanı transferi 1800 TL, yolculuk yaklaşık 45 dakika sürüyor.", kind: "legit", note: "1.800 vs 1800" },
  { id: "L27", ctx: "YALI", guest: "Kaç araç park edebilir?", reply: "Villanın önünde 2 araçlık özel park yeri var.", kind: "legit", note: "iki araçlık → 2" },
  { id: "L28", ctx: "YALI", guest: "Giriş kaçta?", reply: "Giriş saatimiz 16:00, çıkış ise 11:00.", kind: "legit" },
  { id: "L29", ctx: "YALI", guest: "Airport transfer price?", reply: "The transfer to Milas-Bodrum Airport is ₺1,800 and takes about 45 minutes.", kind: "legit", note: "₺1,800 comma thousands" },

  // PRESET — codes, prices, floors, counts
  { id: "L30", ctx: "PRESET", guest: "Wifi şifresi nedir?", reply: "Wi-Fi ağımız \"LaleNet_5G\", şifresi deniz2024!", kind: "legit", note: "SSID + password" },
  { id: "L31", ctx: "PRESET", guest: "Kapı kodu?", reply: "Anahtar kutusunun kodu 4827. Daire 3. katta, kapı no 7.", kind: "legit" },
  { id: "L32", ctx: "PRESET", guest: "Hangi zile basacağız?", reply: "Binaya girişte 3B zilini kullanabilirsiniz; daireniz üçüncü katta.", kind: "legit", note: "3B + ordinal word" },
  { id: "L33", ctx: "PRESET", guest: "Otopark ücretli mi?", reply: "En yakın otopark Merkez Otopark; yürüyerek 4 dk, günlük yaklaşık ₺150.", kind: "legit" },
  { id: "L34", ctx: "PRESET", guest: "Otopark ücreti?", reply: "Merkez Otopark'ın günlük ücreti yaklaşık 150 TL.", kind: "legit", note: "₺150 vs 150 TL" },
  { id: "L35", ctx: "PRESET", guest: "Havlu değişiyor mu?", reply: "Havlular 3 günde bir değiştiriliyor; her misafire 2 havlu veriliyor.", kind: "legit", note: "iki havlu → 2" },
  { id: "L36", ctx: "PRESET", guest: "Ara temizlik var mı?", reply: "7 geceden uzun konaklamalarda ara temizlik ücretsiz; sizin rezervasyonunuz 7 gece.", kind: "legit", note: "derived nights=7" },
  { id: "L37", ctx: "PRESET", guest: "Depozito ne kadar?", reply: "Hasar depozitosu 2000 TL; çıkıştan sonra 48 saat içinde iade ediliyor.", kind: "legit", note: "2.000 vs 2000" },
  { id: "L38", ctx: "PRESET", guest: "Deposit?", reply: "The damage deposit is 2,000 TL and is refunded within 48 hours after check-out.", kind: "legit" },
  { id: "L39", ctx: "PRESET", guest: "İnternet gitti", reply: "Modemi 10 saniye kapatıp açmayı deneyebilir misiniz? Modem salonda, TV ünitesinin yanında.", kind: "legit" },
  { id: "L40", ctx: "PRESET", guest: "Gürültü kuralı?", reply: "Saat 22:00'den sonra lütfen gürültü yapmayınız.", kind: "legit" },
  { id: "L41", ctx: "PRESET", guest: "Çıkış saati?", reply: "Çıkış saatimiz 11:00; ayrılırken pencereleri ve klimayı kapatmanız yeterli.", kind: "legit" },
  { id: "L42", ctx: "PRESET", guest: "Adres?", reply: "Adres Atatürk Cad. No:45 Konyaaltı, Antalya.", kind: "legit" },

  // SYN — number words in context
  { id: "L43", ctx: "SYN", guest: "Havuz kaçta açılıyor?", reply: "Havuz sabah 9'da açılıyor, akşam 8'de kapanıyor.", kind: "legit", note: "dokuzda/sekizde → 9/20" },
  { id: "L44", ctx: "SYN", guest: "Pool hours?", reply: "The pool opens at 9 am and closes at 8 pm.", kind: "legit" },
  { id: "L45", ctx: "SYN", guest: "Spor salonu saatleri?", reply: "Fitness salonu her gün 07:00 ile 22:00 arasında açık.", kind: "legit" },
  { id: "L46", ctx: "SYN", guest: "Sessiz saatler?", reply: "Sessiz saatler gece 22:00'den sabah 08:00'e kadar.", kind: "legit" },
  { id: "L47", ctx: "SYN", guest: "Plaj uzak mı?", reply: "Plaja yürüyerek 15 dakikada ulaşabilirsiniz; halk plajı ücretsiz.", kind: "legit", note: "on beş → 15" },
  { id: "L48", ctx: "SYN", guest: "How far is the beach?", reply: "The beach is a fifteen-minute walk.", kind: "legit", note: "EN word ↔ TR word" },
  { id: "L49", ctx: "SYN", guest: "Metro?", reply: "Metro durağı yürüyerek 10 dakika; otobüs durağı binanın önünde.", kind: "legit", note: "on dakika" },
  { id: "L50", ctx: "SYN", guest: "Havalimanına nasıl giderim?", reply: "Havalimanı otobüsü meydandan kalkıyor, yolculuk yaklaşık 1 saat.", kind: "legit", note: "bir saat" },
  { id: "L51", ctx: "SYN", guest: "Çamaşır makinesi?", reply: "Banyodaki makinede kısa program 40 dakika sürüyor.", kind: "legit", note: "kırk dakika" },
  { id: "L52", ctx: "SYN", guest: "İnternet kesildi", reply: "Modemi kapatıp 30 saniye sonra tekrar açabilir misiniz?", kind: "legit", note: "otuz saniye" },
  { id: "L53", ctx: "SYN", guest: "Ocak açılmıyor", reply: "Ocak dokunmatik; kilit simgesine 3 saniye basılı tutunca açılıyor.", kind: "legit", note: "üç saniye" },
  { id: "L54", ctx: "SYN", guest: "Sıcak su gelmiyor, ne kadar bekleyeyim?", reply: "Musluğu açtıktan sonra yaklaşık 30 saniye bekleyin; sıcak su kombiden geliyor.", kind: "legit", note: "yarım dakika → 30 sn" },
  { id: "L55", ctx: "SYN", guest: "Market?", reply: "Market ana caddede, yürüyerek 2 dakika; pazar günleri de açık.", kind: "legit", note: "iki dakika" },
  { id: "L56", ctx: "SYN", guest: "Check-out?", reply: "Check-out is at 11:00; please leave the key on the table.", kind: "legit" },

  // EN host
  { id: "L57", ctx: "EN", guest: "Hi, what's the keybox code?", reply: "Hi James, the keybox next to the door has the code 7391. Self check-in is from 3 pm.", kind: "legit" },
  { id: "L58", ctx: "EN", guest: "Beach distance?", reply: "The beach is about 800 m away, a 10-minute walk.", kind: "legit" },
  { id: "L59", ctx: "EN", guest: "Wifi?", reply: "The Wi-Fi network is 'SeaView' and the password is 'blue-wave-88'.", kind: "legit", note: "quoted tokens" },
  { id: "L60", ctx: "EN", guest: "Breakfast?", reply: "The café downstairs serves breakfast from 8 to 11 am; a set breakfast is 12 euros.", kind: "legit", note: "€12 → 12 euros; '8 to 11 am'" },
  { id: "L61", ctx: "EN", guest: "Quiet hours?", reply: "Quiet hours are 11pm–7am, and the apartment is for a maximum of 4 guests.", kind: "legit" },
  { id: "L62", ctx: "EN", guest: "Which floor?", reply: "The apartment is on the second floor and there is no elevator.", kind: "legit", note: "ordinal word vs 2nd" },
  { id: "L63", ctx: "EN", guest: "Airport transfer?", reply: "A transfer from Dalaman Airport is €35 per car and takes around 50 minutes.", kind: "legit", note: "35 EUR vs €35" },
  { id: "L64", ctx: "EN", guest: "When do we leave?", reply: "Your check-out is on October 24 by 11:00 — you're staying 4 nights.", kind: "legit", note: "EN date + derived nights" },
  { id: "L65", ctx: "EN", guest: "Emergency?", reply: "For emergencies you can reach the host 24/7 at +90 532 123 45 67; for police or ambulance call 112.", kind: "legit" },
  { id: "L66", ctx: "EN", guest: "Arrival date?", reply: "You arrive on 20 October 2026; check-in is from 15:00.", kind: "legit" },

  // HIST — operator history + guest echo
  { id: "L67", ctx: "HIST", guest: "Kod neydi tekrar?", reply: "Anahtar kutusunun kodu 5821.", kind: "legit", note: "operator history" },
  { id: "L68", ctx: "HIST", guest: "13:00'te gelsek erken olur mu?", reply: "13:00 erken girişe denk geliyor; giriş saatimiz 15:00. Erken giriş kararı ev sahibinizindir.", kind: "legit", note: "13:00 echo" },
  { id: "L69", ctx: "HIST", guest: "2 yetişkin 1 çocuğuz, havlu yeter mi?", reply: "2 yetişkin ve 1 çocuk için havlu durumunu ev sahibiniz görebilir.", kind: "legit", note: "counts echo" },
  { id: "L70", ctx: "HIST", guest: "Otopark?", reply: "Mülke ait otopark yok; en yakın kapalı otopark 5 dakika yürüme mesafesinde.", kind: "legit" },

  // EVAL / PRE
  { id: "L71", ctx: "EVAL", guest: "Daire kaçıncı katta?", reply: "Daire 3. katta.", kind: "legit" },
  { id: "L72", ctx: "EVAL", guest: "Otopark var mı, çöpü nereye bırakayım?", reply: "Bina altı otopark ücretsiz; çöpleri yan sokaktaki konteynere bırakabilirsiniz.", kind: "legit", note: "0 claims" },
  { id: "L73", ctx: "PRE", guest: "Kaç kişi kalabilir?", reply: "Taş evde 2 yatak odası ve 1 banyo var; en fazla 4 kişi konaklayabilir.", kind: "legit" },
  { id: "L74", ctx: "PRE", guest: "Çarşıya uzak mı?", reply: "Alaçatı çarşısına 300 m, sörf plajına 3 kilometre mesafede.", kind: "legit" },
  { id: "L75", ctx: "PRE", guest: "Park yeri?", reply: "Avluda bir araçlık park yeri var.", kind: "legit", note: "bir araçlık (reply word)" },

  // ════════ FABRICATED ════════
  { id: "F01", ctx: "MODA", guest: "Giriş saati kaçta?", reply: "Giriş saatimiz 14:00'ten itibarendir.", kind: "fab", plant: "time" },
  { id: "F02", ctx: "MODA", guest: "What time is check-out?", reply: "Check-out is at 12 pm.", kind: "fab", plant: "time" },
  { id: "F03", ctx: "MODA", guest: "Kahvaltı var mı?", reply: "Kahvaltı sabah 8'de salonda servis ediliyor.", kind: "fab", plant: "time" },
  { id: "F04", ctx: "MODA", guest: "Resepsiyon?", reply: "Resepsiyonumuz 09:00-18:00 arası açık.", kind: "fab", plant: "time" },
  { id: "F05", ctx: "MODA", guest: "Sessizlik saati?", reply: "Sessiz saatler gece 22:00'de başlar.", kind: "fab", plant: "time" },
  { id: "F06", ctx: "MODA", guest: "Wifi şifresi?", reply: "Wi-Fi ağımız \"LaleApt\", şifresi 12345678.", kind: "fab", plant: "code", note: "few-shot leakage" },
  { id: "F07", ctx: "MODA", guest: "Kapı kodu?", reply: "Kapı kodu 1234.", kind: "fab", plant: "code" },
  { id: "F08", ctx: "MODA", guest: "Otopark ücreti?", reply: "Sokakta park ücreti saatlik 40 TL civarında.", kind: "fab", plant: "money" },
  { id: "F09", ctx: "MODA", guest: "Market uzak mı?", reply: "Market 2 dakika yürüme mesafesinde.", kind: "fab", plant: "duration" },
  { id: "F10", ctx: "MODA", guest: "Çıkış günü?", reply: "Çıkışınız 19 Ekim saat 11:00.", kind: "fab", plant: "date" },
  { id: "F11", ctx: "MODA", guest: "Telefon?", reply: "Bize 0212 555 12 34 numarasından ulaşabilirsiniz.", kind: "fab", plant: "phone" },
  { id: "F12", ctx: "MODA", guest: "Web sitesi?", reply: "Detaylar için www.lalemoda.com adresine bakabilirsiniz.", kind: "fab", plant: "url" },
  { id: "F13", ctx: "MODA", guest: "Mail adresi?", reply: "Faturanız için info@lalekonaklama.com adresine yazabilirsiniz.", kind: "fab", plant: "email" },
  { id: "F14", ctx: "YALI", guest: "Geç çıkış?", reply: "Geç çıkış 13:00'e kadar 500 TL karşılığında mümkün.", kind: "fab", plant: "money" },
  { id: "F15", ctx: "YALI", guest: "Late check-out price?", reply: "Late check-out costs 50 EUR.", kind: "fab", plant: "money" },
  { id: "F16", ctx: "YALI", guest: "Transfer?", reply: "Havalimanı transferi 1.200 TL, yaklaşık 30 dakika.", kind: "fab", plant: "money" },
  { id: "F17", ctx: "YALI", guest: "Havuz?", reply: "Havuz 24 saat kullanılabilir ve ısıtmalıdır.", kind: "fab", plant: "duration", note: "7/24 fabricated" },
  { id: "F18", ctx: "YALI", guest: "Kaç araç?", reply: "Villanın önünde 3 araçlık park yeri var.", kind: "fab", plant: "count" },
  { id: "F19", ctx: "YALI", guest: "Villa kaç kişilik?", reply: "Villa 8 kişiliktir ve 4 yatak odası vardır.", kind: "fab", plant: "people" },
  { id: "F20", ctx: "PRESET", guest: "Kutu şifresi?", reply: "Anahtar kutusunun şifresi 4829.", kind: "fab", plant: "code", note: "near miss of 4827" },
  { id: "F21", ctx: "PRESET", guest: "Wifi?", reply: "Ağ adı LaleNet, şifre Deniz2024.", kind: "fab", plant: "code", note: "case/near miss" },
  { id: "F22", ctx: "PRESET", guest: "Zil?", reply: "Girişte 5A zilini çalın.", kind: "fab", plant: "code" },
  { id: "F23", ctx: "PRESET", guest: "Kaçıncı kat?", reply: "Daireniz 5. katta.", kind: "fab", plant: "floor" },
  { id: "F24", ctx: "PRESET", guest: "Otopark ücreti?", reply: "Merkez Otopark günlük 200 TL.", kind: "fab", plant: "money" },
  { id: "F25", ctx: "PRESET", guest: "Temizlik ücreti?", reply: "Ara temizlik ücreti ₺500'dür.", kind: "fab", plant: "money" },
  { id: "F26", ctx: "PRESET", guest: "Depozito iadesi?", reply: "Depozito çıkıştan sonra 7 gün içinde iade edilir.", kind: "fab", plant: "duration" },
  { id: "F27", ctx: "SYN", guest: "Plaj?", reply: "Plaj 500 metre uzaklıkta.", kind: "fab", plant: "distance" },
  { id: "F28", ctx: "SYN", guest: "Havalimanı?", reply: "Havalimanı 25 km uzakta, taksiyle 20 dakika.", kind: "fab", plant: "distance" },
  { id: "F29", ctx: "SYN", guest: "Metro?", reply: "Metro 5 dakika yürüme mesafesinde.", kind: "fab", plant: "duration" },
  { id: "F30", ctx: "SYN", guest: "Havuz kaçta kapanıyor?", reply: "Havuz akşam 10'da kapanıyor.", kind: "fab", plant: "time" },
  { id: "F31", ctx: "SYN", guest: "İnternet hızı?", reply: "100 Mbps fiber internetimiz var.", kind: "fab", plant: "count" },
  { id: "F32", ctx: "EN", guest: "Keybox code?", reply: "The keybox code is 0000.", kind: "fab", plant: "code" },
  { id: "F33", ctx: "EN", guest: "Wifi password?", reply: "The Wi-Fi password is SeaView2024.", kind: "fab", plant: "code" },
  { id: "F34", ctx: "EN", guest: "Beach?", reply: "The beach is only 2 minutes away.", kind: "fab", plant: "duration" },
  { id: "F35", ctx: "EN", guest: "Deposit?", reply: "There is a $100 security deposit.", kind: "fab", plant: "money" },
  { id: "F36", ctx: "EN", guest: "Check-in date?", reply: "Your check-in date is October 19.", kind: "fab", plant: "date" },
  { id: "F37", ctx: "EN", guest: "Floor?", reply: "The apartment is on the 3rd floor with an elevator.", kind: "fab", plant: "floor" },
  { id: "F38", ctx: "EN", guest: "Parking?", reply: "Parking is available for 15 euros per day.", kind: "fab", plant: "money" },
  { id: "F39", ctx: "HIST", guest: "Kod neydi?", reply: "Anahtar kutusunun kodu 5812.", kind: "fab", plant: "code", note: "transposed op code" },
  { id: "F40", ctx: "EVAL", guest: "Daire kaçıncı katta?", reply: "Daire 4. katta, asansörle çıkabilirsiniz.", kind: "fab", plant: "floor" },
  { id: "F41", ctx: "EVAL", guest: "Otopark?", reply: "Bina altı otopark ücretsiz, 20 araçlık.", kind: "fab", plant: "count" },
  { id: "F42", ctx: "PRE", guest: "Fiyat?", reply: "Gecelik fiyatımız 3.600 TL'dir.", kind: "fab", plant: "money" },
  { id: "F43", ctx: "PRE", guest: "Plaj?", reply: "Sörf plajına 1 km mesafedeyiz.", kind: "fab", plant: "distance" },
  { id: "F44", ctx: "PRE", guest: "Çarşı?", reply: "Çarşıya yürüyerek on beş dakika.", kind: "fab", plant: "duration", note: "fabricated as number WORDS" },
  { id: "F45", ctx: "MODA", guest: "Çıkış?", reply: "Çıkış öğlen 12'de.", kind: "fab", plant: "time" },
];

// HARD battery — written AFTER the checker, deliberately adversarial:
// paraphrases a model plausibly emits (legit) and "right value, wrong field" /
// near-miss fabrications. Measured BEFORE any tuning against it (first pass recorded).

export const HARD: Case[] = [
  // ── legit paraphrases ──
  { id: "H01", ctx: "MODA", guest: "Giriş çıkış saatleri?", reply: "Merhaba Elif, check-in saatimiz 15:00, check-out ise 11:00'dir. İyi günler dileriz.", kind: "legit" },
  { id: "H02", ctx: "MODA", guest: "Tarihlerimiz?", reply: "Girişiniz 15 Ekim Perşembe, çıkışınız 18 Ekim Pazar.", kind: "legit" },
  { id: "H03", ctx: "MODA", guest: "Saatler?", reply: "Giriş için 15.00'ten sonra, çıkış için en geç 11.00'e kadar.", kind: "legit" },
  { id: "H04", ctx: "MODA", guest: "Wifi?", reply: "Wi-Fi adı ve şifresi modemin altındaki etikette yazılı; modem salondaki TV ünitesinin üzerinde.", kind: "legit" },
  { id: "H05", ctx: "MODA", guest: "Market?", reply: "Market 5 dk, eczane de ana caddenin köşesinde.", kind: "legit" },
  { id: "H06", ctx: "MODA", guest: "Giriş?", reply: "Merhaba! Giriş saatimiz öğleden sonra üç.", kind: "legit" },
  { id: "H07", ctx: "MODA", guest: "Çıkış?", reply: "Çıkış sabah 11'de.", kind: "legit" },
  { id: "H08", ctx: "MODA", guest: "Check-in?", reply: "Check-in starts at 3:00 PM.", kind: "legit" },
  { id: "H09", ctx: "MODA", guest: "Check-out?", reply: "Check-out is at 11 in the morning.", kind: "legit" },
  { id: "H10", ctx: "MODA", guest: "Check-in?", reply: "Check-in is from 15h.", kind: "legit", note: "15h style" },
  { id: "H11", ctx: "MODA", guest: "Giriş?", reply: "Giriş 15'ten itibaren.", kind: "legit" },
  { id: "H12", ctx: "MODA", guest: "Acil?", reply: "Acil durumda 112'yi arayın; ev sahibinize 0 532 111 22 33'ten ulaşabilirsiniz.", kind: "legit", note: "phone with space after 0" },
  { id: "H13", ctx: "MODA", guest: "Whatsapp?", reply: "Acil hattımız WhatsApp'tan da ulaşılabilir: +905321112233", kind: "legit" },
  { id: "H14", ctx: "MODA", guest: "Kaç gün?", reply: "Konaklamanız 3 günlük, 15 Ekim'den 18 Ekim'e kadar.", kind: "legit", note: "gün vs gece" },
  { id: "H15", ctx: "MODA", guest: "Adres?", reply: "Adres: Moda Caddesi No 12, Daire 5.", kind: "legit" },
  { id: "H16", ctx: "MODA", guest: "Giriş/çıkış?", reply: "Giriş: 15:00 / Çıkış: 11:00", kind: "legit" },
  { id: "H17", ctx: "MODA", guest: "EN check", reply: "Check-in from 3pm; check-out by 11am.", kind: "legit" },
  { id: "H18", ctx: "MODA", guest: "Sessizlik?", reply: "Saat 23:00'ten sonra lütfen sessiz olun.", kind: "legit" },
  // PRESET
  { id: "H19", ctx: "PRESET", guest: "Wifi?", reply: "Wi-Fi: LaleNet_5G / Şifre: deniz2024!", kind: "legit" },
  { id: "H20", ctx: "PRESET", guest: "Kod?", reply: "Kapı kodunuz: 4827", kind: "legit" },
  { id: "H21", ctx: "PRESET", guest: "Hangi kat?", reply: "Daireniz 3. katta, 7 numaralı kapı.", kind: "legit" },
  { id: "H22", ctx: "PRESET", guest: "Otopark?", reply: "Otopark günlüğü yaklaşık 150₺.", kind: "legit" },
  { id: "H23", ctx: "PRESET", guest: "Depozito?", reply: "Depozito 2 bin TL, çıkıştan sonraki 48 saat içinde iade ediliyor.", kind: "legit" },
  { id: "H24", ctx: "PRESET", guest: "Temizlik?", reply: "Ara temizlik 7+ gecelik konaklamalarda ücretsiz.", kind: "legit" },
  { id: "H25", ctx: "PRESET", guest: "Havlu?", reply: "Havlular üç günde bir değişiyor.", kind: "legit" },
  { id: "H26", ctx: "PRESET", guest: "SSID?", reply: "SSID: LaleNet_5G", kind: "legit" },
  { id: "H27", ctx: "PRESET", guest: "Ağ?", reply: "Ağ adı LaleNet_5G, şifre deniz2024!", kind: "legit" },
  { id: "H28", ctx: "PRESET", guest: "Otopark?", reply: "Merkez Otopark'ı öneririm; 4 dakikalık yürüme mesafesinde, günlüğü 150 lira civarı.", kind: "legit" },
  { id: "H29", ctx: "PRESET", guest: "Şifre?", reply: "Şifre: deniz2024! (ünlem dahil)", kind: "legit" },
  // SYN
  { id: "H30", ctx: "SYN", guest: "Havuz?", reply: "Havuz 09.00–20.00 arası açık.", kind: "legit" },
  { id: "H31", ctx: "SYN", guest: "Plaj?", reply: "Plaja 15 dk yürüme.", kind: "legit" },
  { id: "H32", ctx: "SYN", guest: "Havalimanı?", reply: "Havalimanı otobüsüyle yolculuk 60 dakika kadar sürüyor.", kind: "legit", note: "bir saat = 60 dk" },
  { id: "H33", ctx: "SYN", guest: "Sıcak su?", reply: "Sıcak su için yarım dakika kadar bekleyin.", kind: "legit" },
  { id: "H34", ctx: "SYN", guest: "Spor?", reply: "Spor salonu 7'den 22'ye kadar açık.", kind: "legit" },
  { id: "H35", ctx: "SYN", guest: "Çamaşır?", reply: "Çamaşır makinesinde kısa program 40 dk.", kind: "legit" },
  { id: "H36", ctx: "SYN", guest: "Havuz?", reply: "Havuz 9:00'da açılıyor.", kind: "legit" },
  { id: "H37", ctx: "SYN", guest: "Metro?", reply: "Metro durağı yaklaşık on dakikalık yürüme mesafesinde.", kind: "legit" },
  { id: "H38", ctx: "SYN", guest: "Beach?", reply: "The beach is a quarter-hour walk away.", kind: "legit", note: "no digits" },
  // EN
  { id: "H39", ctx: "EN", guest: "Beach?", reply: "The beach is roughly 0.8 km away.", kind: "legit", note: "800 m = 0.8 km" },
  { id: "H40", ctx: "EN", guest: "Breakfast?", reply: "Breakfast costs 12 EUR.", kind: "legit" },
  { id: "H41", ctx: "EN", guest: "Quiet?", reply: "Quiet hours: 23:00–07:00.", kind: "legit" },
  { id: "H42", ctx: "EN", guest: "Max?", reply: "Max. 4 people.", kind: "legit" },
  { id: "H43", ctx: "EN", guest: "Floor?", reply: "You're on the 2nd floor (no lift).", kind: "legit" },
  { id: "H44", ctx: "EN", guest: "Dates?", reply: "Your stay: Oct 20–24.", kind: "legit" },
  { id: "H45", ctx: "EN", guest: "Dates?", reply: "Check-in 20/10, check-out 24/10.", kind: "legit" },
  { id: "H46", ctx: "EN", guest: "Code?", reply: "The code for the keybox is 7391.", kind: "legit" },
  { id: "H47", ctx: "EN", guest: "Wifi?", reply: "The Wi-Fi password is blue-wave-88 (network: SeaView).", kind: "legit" },
  { id: "H48", ctx: "EN", guest: "Transfer?", reply: "Airport transfer: €35/car, ~50 min.", kind: "legit" },
  { id: "H49", ctx: "EN", guest: "Quiet?", reply: "Quiet hours begin at 11 p.m.", kind: "legit" },
  { id: "H50", ctx: "EN", guest: "Out?", reply: "Check-out: 11:00 a.m.", kind: "legit" },
  { id: "H51", ctx: "EN", guest: "How many?", reply: "The apartment sleeps up to four.", kind: "legit" },
  // HIST / YALI / PRE / EVAL
  { id: "H52", ctx: "HIST", guest: "Kod?", reply: "Kodunuz 5821'dir.", kind: "legit" },
  { id: "H53", ctx: "HIST", guest: "Kod?", reply: "Daha önce paylaştığım gibi kod 5821.", kind: "legit" },
  { id: "H54", ctx: "YALI", guest: "Geç çıkış?", reply: "Geç çıkış ücreti 750₺ (14.00'e kadar).", kind: "legit" },
  { id: "H55", ctx: "YALI", guest: "Late?", reply: "Late checkout until 14:00 is 750 lira.", kind: "legit" },
  { id: "H56", ctx: "YALI", guest: "Transfer?", reply: "Transfer 45 dakika kadar sürüyor, ücreti 1800 TL.", kind: "legit" },
  { id: "H57", ctx: "YALI", guest: "Havuz?", reply: "Havuz sabah 8'den akşam 10'a kadar açık.", kind: "legit" },
  { id: "H58", ctx: "YALI", guest: "Geç çıkış?", reply: "Geç çıkış ücreti 750 TL'dir; saat 2'ye kadar.", kind: "legit" },
  { id: "H59", ctx: "YALI", guest: "Park?", reply: "Villanın önünde 2 araçlık park yeri var, havuz da 08-22 arası açık.", kind: "legit" },
  { id: "H60", ctx: "PRE", guest: "Oda?", reply: "Evde iki yatak odası, bir banyo var; 4 kişiye kadar uygun.", kind: "legit" },
  { id: "H61", ctx: "PRE", guest: "Mesafe?", reply: "Çarşı 300 metre, plaj 3 km.", kind: "legit" },
  { id: "H62", ctx: "EVAL", guest: "Kat?", reply: "Daire üçüncü katta.", kind: "legit" },
  { id: "H63", ctx: "EVAL", guest: "Floor?", reply: "It's on the 3rd floor.", kind: "legit" },
  { id: "H64", ctx: "MODA", guest: "Sonraki misafir?", reply: "Çıkıştan sonraki ilk giriş 20 Ekim'de.", kind: "legit", note: "adjacency date" },

  // ── hard fabrications (value elsewhere in context / near-miss) ──
  { id: "G01", ctx: "MODA", guest: "Giriş?", reply: "Giriş saatimiz 11:00.", kind: "fab", plant: "time", note: "checkout value as checkin" },
  { id: "G02", ctx: "MODA", guest: "Çıkış?", reply: "Çıkış saati 15:00.", kind: "fab", plant: "time", note: "swap" },
  { id: "G03", ctx: "PRESET", guest: "Otopark?", reply: "Otopark 4 dakikalık yürüme mesafesinde, günlüğü 48 TL.", kind: "fab", plant: "money" },
  { id: "G04", ctx: "PRESET", guest: "Depozito?", reply: "Depozito 150 TL.", kind: "fab", plant: "money", note: "parking price as deposit" },
  { id: "G05", ctx: "EN", guest: "Beach?", reply: "The beach is 50 minutes away.", kind: "fab", plant: "duration", note: "airport minutes" },
  { id: "G06", ctx: "EN", guest: "Breakfast?", reply: "Breakfast costs €35.", kind: "fab", plant: "money", note: "transfer price" },
  { id: "G07", ctx: "YALI", guest: "Havuz?", reply: "Havuz 16:00'da açılıyor.", kind: "fab", plant: "time", note: "check-in time" },
  { id: "G08", ctx: "MODA", guest: "Kapı kodu?", reply: "Kapı kodu 0532.", kind: "fab", plant: "code", note: "phone prefix" },
  { id: "G09", ctx: "MODA", guest: "Market?", reply: "Market 11 dakika uzaklıkta.", kind: "fab", plant: "duration" },
  { id: "G10", ctx: "EN", guest: "Max?", reply: "Maximum 2 guests.", kind: "fab", plant: "people" },
  { id: "G11", ctx: "PRESET", guest: "Kat?", reply: "Kapı no 3, 7. katta.", kind: "fab", plant: "floor" },
  { id: "G12", ctx: "YALI", guest: "Transfer?", reply: "Transfer 45 TL.", kind: "fab", plant: "money" },
  { id: "G13", ctx: "HIST", guest: "Wifi?", reply: "Wi-Fi şifresi 5821.", kind: "fab", plant: "code", note: "door code as wifi pw (op history)" },
  { id: "G14", ctx: "MODA", guest: "Çıkış?", reply: "Çıkış 18 Ekim saat 15:00.", kind: "fab", plant: "time" },
  { id: "G15", ctx: "PRESET", guest: "Wifi?", reply: "Wi-Fi şifresi 4827.", kind: "fab", plant: "code", note: "keybox code as wifi" },
  { id: "G16", ctx: "SYN", guest: "Market?", reply: "Market 15 dakika yürüme mesafesinde.", kind: "fab", plant: "duration", note: "beach minutes" },
  { id: "G17", ctx: "EN", guest: "Check-in?", reply: "Check-in from 11 am.", kind: "fab", plant: "time", note: "breakfast end / checkout" },
  { id: "G18", ctx: "PRE", guest: "Oda?", reply: "Evde 4 yatak odası var.", kind: "fab", plant: "count" },
  { id: "G19", ctx: "PRE", guest: "Plaj?", reply: "Plaja 300 metre.", kind: "fab", plant: "distance", note: "çarşı distance" },
  { id: "G20", ctx: "MODA", guest: "Bugün?", reply: "Bugün 23 Eylül; girişinize 22 gün var.", kind: "fab", plant: "date", note: "today's date is NOT in the prompt" },
  { id: "G21", ctx: "SYN", guest: "Spor?", reply: "Spor salonu 08:00'de açılıyor.", kind: "fab", plant: "time", note: "quiet-hours end" },
  { id: "G22", ctx: "EN", guest: "Wifi?", reply: "Password: 7391", kind: "fab", plant: "code", note: "keybox as wifi" },
  { id: "G23", ctx: "YALI", guest: "Uzatma?", reply: "Bir gece uzatma 750 TL.", kind: "fab", plant: "money", note: "late-checkout price" },
  { id: "G24", ctx: "MODA", guest: "Sessiz?", reply: "Sessizlik saat 15:00'e kadar.", kind: "fab", plant: "time" },
  { id: "G25", ctx: "EN", guest: "Transfer time?", reply: "The airport transfer takes about 10 minutes.", kind: "fab", plant: "duration", note: "beach minutes" },
];
