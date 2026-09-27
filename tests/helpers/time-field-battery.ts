// ---------------------------------------------------------------------------
// SAAT ALANI ATFI BATARYASI (09-27, kurucu: "o saat kuralını en iyi şekilde yap, didik didik"). Ev sahiplerinin bilgi
// tabanına gerçekte yazdığı biçimde TR/EN cümleler; her biri için kuralın okuması GEREKEN alan:saat kümesi elle
// etiketlidir. İki yönlü: `true` = gerçek konaklama/işletme saati (okunmalı — kaçarsa gerçek çelişki görünmez),
// `trap` = gündelik saat anlatımı (okunmamalı — okunursa mülk saati gizlenir, cevap onaya düşer, ev sahibine sahte
// "uyuşmayan saat" gösterilir). `soft` = iki okuma da savunulabilir; puanlanmaz, yalnız bilgi.
// Tüketiciler: `tests/unit/kb-time-fields-battery.test.ts` (sabit beklenti) + ölçüm tanısı.
// ---------------------------------------------------------------------------

export interface TimeFieldCase {
  kind: "true" | "trap" | "soft";
  category: string;
  title: string;
  text: string;
  /** Beklenen okuma: "alan:SS:DD" (sırasız). */
  expect: string[];
}

const T = (category: string, title: string, text: string, expect: string[]): TimeFieldCase => ({ kind: "true", category, title, text, expect });
const X = (category: string, title: string, text: string, expect: string[] = []): TimeFieldCase => ({ kind: "trap", category, title, text, expect });
const S = (category: string, title: string, text: string, expect: string[] = []): TimeFieldCase => ({ kind: "soft", category, title, text, expect });

export const TIME_FIELD_BATTERY: TimeFieldCase[] = [
  // ── Gerçek giriş saati ──────────────────────────────────────────────────────────────────────────────────────────
  T("checkin", "Giriş", "Giriş saati 15:00'tir.", ["checkin:15:00"]),
  T("checkin", "Giriş", "Girişler 14:00'ten itibaren yapılabilir.", ["checkin:14:00"]),
  T("checkin", "Varış bilgileri", "14:00'ten sonra gelebilirsiniz.", ["checkin:14:00"]),
  T("general", "Saatler", "Giriş 16:00'dan itibaren, çıkış 11:00'e kadar.", ["checkin:16:00", "checkout:11:00"]),
  T("checkin", "Check-in", "Check-in is from 3 PM.", ["checkin:15:00"]),
  T("checkin", "Arrival", "Arrival time is 15:00 at the earliest.", ["checkin:15:00"]),
  T("checkin", "Giriş", "Daireye 15:00'ten itibaren girebilirsiniz.", ["checkin:15:00"]),
  T("checkin", "Giriş", "Giriş saati 15:00 ile 22:00 arasıdır.", ["checkin:15:00", "checkin:22:00"]),
  T("rules", "Ev kuralları", "Giriş saati 14:00'tür.", ["checkin:14:00"]),
  T("checkin", "Welcome", "Check-in time is 15:00; check-out time is 11:00.", ["checkin:15:00", "checkout:11:00"]),
  T("checkin", "Giriş", "Giriş saatimiz 15.00'tir, erken giriş için bize yazın.", ["checkin:15:00"]),
  T("checkin", "Varış", "Varışınızı en erken 14:00'te yapabilirsiniz.", ["checkin:14:00"]),
  T("checkin", "Giriş", "Daire 15:00'ten itibaren hazır olur.", ["checkin:15:00"]),
  T("checkin", "Giriş", "Valizinizle 14:00'ten sonra giriş yapabilirsiniz.", ["checkin:14:00"]),
  T("checkin", "Giriş ve çıkış", "Giriş 15:00. Çıkış 11:00.", ["checkin:15:00", "checkout:11:00"]),
  T("checkin", "Daireye giriş", "Daireye giriş saati normalde 15.00 ile 21.00 arasındadır.", ["checkin:15:00", "checkin:21:00"]),
  T("checkin", "Giriş", "Girişler 14:00'ten sonra yapılabilir.", ["checkin:14:00"]),
  T("checkin", "Check-in", "Check-in from 15:00 (please message us your arrival time).", ["checkin:15:00"]),
  T("checkin", "Arrival", "Arrival after 15:00 please.", ["checkin:15:00"]),
  T("checkin", "Varış", "Erken gelirseniz 15:00'ten sonra yerleşebilirsiniz.", ["checkin:15:00"]),
  T("checkin", "Giriş", "Erken gelirseniz giriş 15:00'ten sonra yapılır.", ["checkin:15:00"]),
  T("checkin", "Varış", "Valizinizle 14:00'ten sonra gelebilirsiniz.", ["checkin:14:00"]),
  T("general", "Info", "Check-in is of course from 15:00.", ["checkin:15:00"]),
  T("general", "Bilgi", "Persembe gunleri giris saati 16:00'dir.", ["checkin:16:00"]),

  // ── Gerçek çıkış saati ──────────────────────────────────────────────────────────────────────────────────────────
  T("checkout", "Çıkış", "Çıkış saati 11:00'dir.", ["checkout:11:00"]),
  T("checkout", "Çıkış", "En geç 11:00'de çıkış yapılmalıdır.", ["checkout:11:00"]),
  T("checkout", "Çıkış", "Lütfen 11:00'e kadar daireyi boşaltın.", ["checkout:11:00"]),
  T("rules", "Kurallar", "Lütfen 12:00'de çıkın.", ["checkout:12:00"]),
  T("checkout", "Check-out", "Check-out is at 11 am.", ["checkout:11:00"]),
  T("checkout", "Check-out", "Please leave the apartment by 11:00.", ["checkout:11:00"]),
  T("checkout", "Departure", "Departure time is 10:00.", ["checkout:10:00"]),
  T("checkout", "Çıkış", "Daireden 11:00'e kadar ayrılmanız gerekiyor.", ["checkout:11:00"]),
  T("general", "Bilgi", "Çıkış 11:00, giriş 15:00.", ["checkin:15:00", "checkout:11:00"]),
  T("checkout", "Çıkış", "Çıkışta anahtarı kutuya bırakın, çıkış saati 11:00.", ["checkout:11:00"]),
  T("checkout", "Çıkış", "Standart çıkış saati en geç 12:00'dır.", ["checkout:12:00"]),
  T("checkout", "Check-out", "Check-out by 11am, please.", ["checkout:11:00"]),
  T("checkout", "Çıkış", "Daireden en geç 11:00'de çıkmanız gerekiyor.", ["checkout:11:00"]),
  T("rules", "Ev kuralları", "Sigara içilmez. Çıkış saati 12:00'dir.", ["checkout:12:00"]),
  T("checkout", "Çıkış", "Lütfen 11:00'de çıkınız.", ["checkout:11:00"]),
  T("checkout", "Checkout", "Guests must leave the flat by 11:00.", ["checkout:11:00"]),
  T("rules", "Kurallar", "Daireden 12:00'de ayrılmanız gerekmektedir.", ["checkout:12:00"]),
  T("general", "Bilgi", "Odadan en geç 11:00'de çıkmalısınız.", ["checkout:11:00"]),

  // ── Gerçek diğer alanlar ────────────────────────────────────────────────────────────────────────────────────────
  T("rules", "Sessizlik", "Sessizlik saatleri 22:00–08:00 arasıdır.", ["quiet_hours:22:00", "quiet_hours:08:00"]),
  T("rules", "Kurallar", "Gece 23:00'ten sonra yüksek sesle müzik yasaktır.", ["quiet_hours:23:00"]),
  T("rules", "Kurallar", "Lütfen 22:00'den sonra gürültü yapmayın.", ["quiet_hours:22:00"]),
  T("rules", "House rules", "Quiet hours are from 10 pm to 8 am.", ["quiet_hours:22:00", "quiet_hours:08:00"]),
  T("rules", "House rules", "No parties or loud music after 22:00.", ["quiet_hours:22:00"]),
  T("rules", "Ev İçi Sessizlik", "Lütfen 07.00'den önce televizyon sesini düşük tutun.", ["quiet_hours:07:00"]),
  T("rules", "Kurallar", "Gürültü kuralı: 22:00–08:00 arası sessiz olunmalıdır.", ["quiet_hours:22:00", "quiet_hours:08:00"]),
  T("rules", "House rules", "Loud music is not permitted after 11 pm.", ["quiet_hours:23:00"]),
  T("rules", "Kurallar", "Müzik 22:00'ye kadar serbesttir.", ["quiet_hours:22:00"]),
  T("rules", "Havuz", "Havuz 09:00–19:00 arası açıktır.", ["pool:09:00", "pool:19:00"]),
  T("rules", "Pool", "The pool is open from 9 am to 7 pm.", ["pool:09:00", "pool:19:00"]),
  T("rules", "Spor salonu", "Spor salonu 07:00–22:00 arası açık.", ["gym:07:00", "gym:22:00"]),
  T("rules", "Gym", "The gym can be used between 07:00 and 23:00.", ["gym:07:00", "gym:23:00"]),
  T("rules", "Fitness", "Fitness salonu 06:00–23:00 arası açıktır.", ["gym:06:00", "gym:23:00"]),
  T("rules", "Havuz", "Havuz başındaki şezlonglar 09:00–19:00 arası kullanılabilir.", ["pool:09:00", "pool:19:00"]),
  T("cleaning", "Temizlik", "Ara temizlik 11:00–15:00 arasında yapılır.", ["cleaning:11:00", "cleaning:15:00"]),
  T("checkin", "Erken giriş", "Erken giriş 12:00'den itibaren mümkündür.", ["early_checkin:12:00"]),
  T("checkout", "Geç çıkış", "Geç çıkış 14:00'e kadar mümkündür.", ["late_checkout:14:00"]),
  T("checkout", "Geç çıkış", "Geç çıkış 13:00'e kadar ücretlidir.", ["late_checkout:13:00"]),
  T("checkout", "Çıkış", "Çıkış saatimiz 11:00'dir; müsaitse 12:00'ye kadar uzatılabilir.", ["checkout:11:00", "late_checkout:12:00"]),
  T("checkout", "Check-out", "Check-out can be extended to 13:00 for a fee.", ["late_checkout:13:00"]),
  T("checkout", "Çıkış", "Müsaitse çıkışınızı 13:00'e kadar uzatabiliriz.", ["late_checkout:13:00"]),
  T("checkin", "Erken giriş", "Early check-in from 12:00 is possible on request.", ["early_checkin:12:00"]),
  T("checkin", "Geç giriş", "Geç giriş 01:00'e kadar mümkündür.", ["late_checkin:01:00"]),

  // ── Tuzak: geç varış / koşul ────────────────────────────────────────────────────────────────────────────────────
  X("checkin", "Geç varış imkânı", "21.00'den sonra varacaksanız, lütfen önceden bildirin."),
  X("checkin", "Geç varış imkânı", "Çok geç (01.00 sonrası) varışlarda komşuları rahatsız etmeyin."),
  X("checkin", "Geç giriş", "22:00'den sonra gelirseniz anahtar kutusunu kullanın."),
  X("checkin", "Late arrival", "If you arrive after 10 pm, please use the key box."),
  X("checkin", "Varış", "22:00'den sonraki varışlarda anahtar kutusunu kullanın."),
  X("checkin", "Late arrival", "For late arrivals after 23:00 the code is sent by message."),
  X("checkin", "Varış", "Uçağınız 23:00'ten sonra inerse bize haber verin."),
  X("checkin", "Varış", "22:00'den sonraki girişler ücretlidir."),
  X("checkin", "Giriş", "Girişiniz 22:00'den sonra olacaksa önceden bildirin."),
  X("checkin", "Late arrival", "Arrivals after 22:00 must use the key box."),

  // ── Tuzak: valiz / bagaj ────────────────────────────────────────────────────────────────────────────────────────
  X("checkin", "Erken valiz bırakma", "Resmi giriş saatinizden önce, 12.00 ile 14.30 arasında dairede valiz bırakmanıza izin veriyoruz."),
  X("checkin", "Bagaj", "Valizlerinizi 10:00'dan itibaren bırakabilirsiniz."),
  X("checkout", "Bagaj", "Çıkıştan sonra valizlerinizi 14:00'e kadar resepsiyonda bırakabilirsiniz."),
  X("checkout", "Luggage", "After check-out you can leave your luggage until 14:00."),
  X("checkout", "Bagaj", "Çıkış yaptıktan sonra bavullarınızı 16:00'ya kadar saklayabiliriz."),
  X("checkout", "Luggage storage", "Luggage can be stored after check-out until 15:00."),

  // ── Tuzak: araç / kapı / yer ────────────────────────────────────────────────────────────────────────────────────
  X("parking", "Eski çarşı", "Eski Çarşı'da 19.00–24.00 saatleri arasında araç girişi yasaktır."),
  X("building", "Çamaşırhane", "Girişin arkasındaki kapıdan çıkınca sağda kalır ve 08:00–22:00 saatleri arasında açıktır."),
  X("rules", "Kurallar", "Girişin önünde 08:00–20:00 arası park etmek yasaktır."),
  X("checkin", "Giriş", "Girişteki görevli 08:00–20:00 arası bulunur."),
  X("checkin", "Giriş", "Bina girişi 23:00'ten sonra kilitlenir."),
  X("rules", "Kurallar", "Otoparka giriş 23:00'ten sonra kapalıdır."),
  X("checkin", "Giriş", "Giriş kapısının şifresi her gün 23:00'te değişir."),
  X("checkout", "Çıkış", "Çıkış günü bavullarınızı en geç 14:00'e kadar dairenin giriş holünde bırakabilirsiniz."),
  X("checkin", "Giriş", "Resepsiyon 09:00-18:00 arası açıktır."),
  X("checkout", "Çıkış", "Acil çıkış kapısı 23:00'ten sonra alarmlıdır."),

  // ── Tuzak: "çık-" / "leave" / kalkış — başka bir şeyin çıkması ──────────────────────────────────────────────────
  X("local_tips", "Marina Akşam Yürüyüşü", "Sahil yolunda 19.00-22.00 saatleri arasında sokak müzisyenleri çıkıyor."),
  X("location", "Otobüs", "Son otobüs 23:00'te çıkıyor."),
  X("local_tips", "Tekne turu", "Tekne turları her sabah 10:00'da limandan çıkıyor."),
  X("faq", "Şofben", "Sabah 08.00–10.00 arası ilk kullanımda bekleme süresi 3 dakikaya çıkabilir."),
  X("location", "Bus", "The last bus leaves at 23:00."),
  X("location", "Ferry", "Departures from the port are at 08:00 and 17:00."),
  X("location", "Shuttle", "The airport shuttle leaves the square every hour from 06:00."),
  X("checkout", "Çıkış", "Çöpü 20:00'den sonra dışarı çıkarın."),
  X("rules", "Balkon", "Balkona 22:00'den sonra çıkmayın."),
  X("local_tips", "Plaj", "Evden 08:00'de çıkıp plaja yürüyerek gidebilirsiniz."),
  X("rules", "Kurallar", "Daireden çıkmanız gerekirse 22:00'den sonra kapıyı kilitleyin."),
  X("rules", "Kurallar", "Daireden 22:00'den sonra çıkmayınız."),
  X("location", "Tekne", "Tekne 10:00'da limandan ayrılıyor."),
  X("location", "Otobüs", "Otobüs çıkış saati 10:00'dır."),
  X("location", "Ferry", "The ferry departure is at 17:00."),

  // ── Tuzak: iletişim / hizmet saati giriş-çıkış kaleminde ────────────────────────────────────────────────────────
  X("checkin", "Karşılama", "Karşılama görevlimize 09:00–21:00 arası ulaşabilirsiniz."),
  X("checkin", "Check-in help", "For check-in help you can call us between 9:00 and 21:00."),
  X("checkin", "Varış", "Kahvaltı 08:00'de başlar."),
  X("local_tips", "Market", "Market 22:00'ye kadar açık."),
  X("checkin", "Giriş", "Giriş talimatları 12:00'de mesajla gönderilir."),
  X("rules", "Kurallar", "Girişin hemen yanındaki market 22:00'ye kadar açık."),

  // ── Tuzak: sessizlik sözcüğü, kural değil ───────────────────────────────────────────────────────────────────────
  X("local_tips", "Balıkçı İskelesi", "The small pier is especially quiet in the mornings before 09:00."),
  X("local_tips", "Tepe Mahallesi", "The hillside is quiet after dark but some streets get very empty after 22:30."),
  X("general", "Manzara ve Gürültü", "Akşam 20.00-23.00 arasında canlı müzik sesleri hafifçe duyulabilir."),
  X("general", "Asansör", "Gece 23:00–06:30 arasında gürültüyü azaltmak için kapı kapanma hızı yavaş moda alınır."),
  X("local_tips", "Plaj barı", "Plaj barı hafta sonu 01:00'e kadar müzik yapıyor."),
  X("local_tips", "Beach party", "The beach party at the marina starts every Saturday at 22:00."),
  X("local_tips", "Kafe", "Köşedeki kafe 08:00'den itibaren sessiz bir çalışma ortamı sunar."),

  // ── Tuzak: "salon" (oturma odası / kuaför), şezlong (plaj) ───────────────────────────────────────────────────────
  X("general", "Balkon lambası", "Balkon lambası salon kapısının yanındaki anahtarla açılır ve en geç 00.30'da kapatılması rica edilir."),
  X("local_tips", "Ladies hair salon", "The closest salon is open daily from 10:00 to 21:00."),
  X("local_tips", "Kuaför", "Güzellik salonu 09:00–20:00 arası açık."),
  X("general", "Salon", "Salondaki klima 23:00'te otomatik kapanır."),
  X("local_tips", "Şezlong ve Şemsiye", "Halk plajında şezlong ve şemsiyeler 09.00–18.00 arasında kiralanabiliyor."),

  // ── Tuzak: erken giriş / geç çıkış sınırı (standart saat, alanın değeri değil) ─────────────────────────────────
  X("checkout", "Geç Çıkış Ücreti", "11:00 sonrası onaylanmamış her saat için 200 TL geç çıkış ücreti uygulanır."),
  X("checkout", "Late check-out", "Late check-out after 11am costs €20 per hour."),
  X("checkin", "Erken giriş", "15:00'ten önceki erken girişler ücretlidir."),
  X("checkout", "Late check-out", "Late check-out is possible after 11:00 for a fee."),

  // ── 09-27 ikinci tur (kör bataryanın gösterdiği sınıflar; her kural için İKİZ: gerçek + tuzak) ─────────────────────
  // Erişimin başladığı an = giriş saati; bitişi ve başka yerin kodu değil.
  T("checkin", "Kapı kodu", "Dairenin kapı kodu giriş günü 15:00'ten itibaren çalışır.", ["checkin:15:00"]),
  T("checkin", "Self check-in", "Kapı kodu 15:00'te aktif olur.", ["checkin:15:00"]),
  T("checkin", "Keys", "The keys are yours from 2 pm.", ["checkin:14:00"]),
  X("checkin", "Otopark kodu", "Otopark kapısının kodu 07:00'den itibaren çalışır."),
  X("checkin", "Kod süresi", "Kapı kodunuz çıkış günü 11:00'e kadar geçerlidir."),
  X("checkin", "Wi-Fi", "Wi-Fi şifresi 15:00'ten itibaren çalışır."),
  // Müsaitlik koşulu → erken giriş / geç çıkış; standart ya da olumsuz koşul → standart saat.
  T("checkin", "Erken giriş", "Daire hazırsa 13:00'te girebilirsiniz.", ["early_checkin:13:00"]),
  T("faq", "Early arrival", "If the flat is free, you can check in from 11am.", ["early_checkin:11:00"]),
  T("checkout", "Çıkış", "Bir sonraki misafir yoksa 13:00'e kadar kalabilirsiniz.", ["late_checkout:13:00"]),
  T("checkout", "Çıkış", "Çıkış 11:00'dir; müsaitliğe göre çıkış 12:00'ye kadar uzatılabilir.", ["checkout:11:00", "late_checkout:12:00"]),
  T("checkin", "Giriş", "Daire hazırsa 13:00'te, değilse 15:00'te girebilirsiniz.", ["early_checkin:13:00", "checkin:15:00"]),
  T("checkin", "Giriş", "Daire hazır değilse giriş 15:00'te yapılır.", ["checkin:15:00"]),
  T("checkin", "Check-in", "If you arrive by car, you can check in from 3 pm.", ["checkin:15:00"]),
  // Bağımsız erken / geç sözü; koşuldaki erken sözü "…'ten sonra" STANDART sınırını değiştirmez.
  T("checkin", "Erken yerleşme", "Önceki gece dairede misafir yoksa sabah 11:00 gibi erkenden yerleşebilirsiniz.", ["early_checkin:11:00"]),
  T("faq", "Erken gelirsem?", "Erken gelirseniz ve daire hazırsa 13:00'te girebilirsiniz; normal giriş saatimiz 15:00'tir.", ["checkin:15:00", "early_checkin:13:00"]),
  T("checkin", "Giriş", "Erken gelseniz bile giriş 15:00'te yapılır.", ["checkin:15:00"]),
  T("checkout", "Çıkış", "Geç çıkmak isterseniz 13:00'e kadar kalabilirsiniz.", ["late_checkout:13:00"]),
  T("checkout", "Çıkış", "Geç kalırsanız bile çıkış 11:00'de yapılır.", ["checkout:11:00"]),
  // Konaklamanın başı / sonu.
  T("general", "Giriş ve çıkış", "Konaklamanız varış günü 15:00'te başlar, ayrılış günü 11:00'de sona erer.", ["checkin:15:00", "checkout:11:00"]),
  T("general", "Your stay", "Your stay begins at 3 pm and ends at 11 am.", ["checkin:15:00", "checkout:11:00"]),
  X("general", "Kahvaltı", "Konaklamanızın ilk günü kahvaltı 08:00'de başlar."),
  // Havuz / spor salonunun KENDİSİ değil: bar, havlu, bilardo masası, ders, sauna, bakım.
  X("general", "Havuz barı", "Havuz barı 11:00'de açılıyor, 18:00'de kapanıyor."),
  T("general", "Havuz", "Havuz ve havuz barı 09:00-20:00 arası açıktır.", ["pool:09:00", "pool:20:00"]),
  X("general", "Pool towels", "Pool towels can be picked up from the kiosk between 9am and 5 pm."),
  X("general", "Games room", "The games room with table tennis and a pool table is open from 10am to 10 pm."),
  X("general", "Pilates", "Spor salonunda salı akşamları 19:00'da pilates dersi var."),
  X("general", "Sauna", "The sauna next to the gym is open from 4 pm to 10 pm."),
  X("general", "Havuz bakımı", "Havuz her pazartesi 08:00-10:00 arası bakım nedeniyle kapalıdır."),
  T("general", "Havuz", "The pool is of course open until 22:00.", ["pool:22:00"]),
  T("rules", "Havuz kuralları", "Havuza 21:00'den sonra girmek yasaktır.", ["pool:21:00"]),
  // "gir-" fiili: başka bir yere girmek giriş değildir; konaklama yerine / misafire hitapla giriştir.
  X("checkin", "Otopark", "Otoparka 23:00'ten sonra girilemez."),
  X("checkin", "Bina", "Binaya 23:00'ten sonra girmek için kapı kodunu kullanın."),
  T("checkin", "Giriş", "Daireye 15:00'ten itibaren girilebilir.", ["checkin:15:00"]),
  // Temizlik: dükkân ve ürün değil, ekip gelir.
  X("local_tips", "Dry cleaner", "The dry cleaner around the corner closes at 7 pm."),
  X("cleaning", "Temizlik", "Temizlik malzemeleri her pazartesi 10:00'da yenilenir."),
  T("cleaning", "Temizlik", "Temizlik ekibi her gün 11:00-14:00 arası gelir.", ["cleaning:11:00", "cleaning:14:00"]),
  // İletişim penceresi ve gönderim anı hiçbir alanın saati değil; aynı cümledeki gerçek saat ayrılır.
  X("cleaning", "Temizlik ekibi", "Temizlik ekibimize 09:00-18:00 arası WhatsApp'tan yazabilirsiniz."),
  T("cleaning", "Temizlik", "Temizlik 11:00'de başlar, sorularınız için bize yazın.", ["cleaning:11:00"]),
  X("checkin", "Check-in guide", "We send the check-in guide with the door code at 10am on your arrival day."),
  X("checkin", "Kimlik", "Giriş bilgilerini gönderebilmemiz için kimlik fotoğrafınızı 18:00'e kadar iletmeniz gerekiyor."),
  X("checkout", "Reminder", "We'll send you a short check-out checklist at 6 pm the evening before you leave."),
  T("checkin", "Check-in", "Check in between 3 pm and 10 pm and message us your arrival time.", ["checkin:15:00", "checkin:22:00"]),
  // Ulaşım: koşuldaki / önceki tire parçasındaki araç, ana parçanın saatini aracın saati yapar.
  X("checkout", "Çıkış", "Havalimanı transferi ayarladıysanız şoför 10:30'da binanın önünde bekliyor."),
  X("checkout", "Çıkış günü taksi", "Çıkış günü havalimanına taksi isterseniz 10:15'e ayarlayabiliriz."),
  X("checkout", "Taxi", "If you want a taxi, we can book it for 10:15."),
  X("checkin", "Vapurla varış", "Kadıköy'den gelecekseniz vapurlar gece 23:30'a kadar çalışıyor."),
  X("checkout", "Airport taxi", "On check-out day we can book a taxi to the airport for you — most guests go for 9:30 AM."),
  T("checkin", "Varış", "Otobüsle gelecekseniz giriş 15:00'ten sonra yapılır.", ["checkin:15:00"]),
  // Uzun tire: iki yanı cümlecikse böler; etiket ("Giriş – 15:00") ve aralık ("09:00 – 20:00") bölünmez.
  T("checkin", "Arrival", "You're welcome to arrive any time after 4 pm — the lockbox by the door works around the clock.", ["checkin:16:00"]),
  X("checkout", "Before you leave", "Before you leave, please take out the trash — the bin lorry comes at 8am."),
  T("general", "Saatler", "Giriş – 15:00, Çıkış – 11:00", ["checkin:15:00", "checkout:11:00"]),
  T("general", "Havuz", "Havuz her gün 09:00 – 20:00 arası açıktır.", ["pool:09:00", "pool:20:00"]),
  // Boşaltma: konaklama YERİNİ boşaltmak çıkıştır; başka bir şeyi boşaltmak değil.
  T("checkout", "Çıkış saati", "Çıkış günü daireyi en geç 11.00'de boşaltmanızı rica ediyoruz.", ["checkout:11:00"]),
  T("checkout", "Check-out", "Please vacate the apartment by 11 am.", ["checkout:11:00"]),
  T("rules", "Kurallar", "Dairenin en geç 11:00'de boşaltılması gerekmektedir.", ["checkout:11:00"]),
  X("checkout", "Çöp", "Çöp kutuları her sabah 10:00'da boşaltılır."),
  // Gürültü: "noise / volume" sözlükte görünmüyordu; kural dili yoksa anlatımdır.
  T("rules", "Thin walls", "The walls are thin, so please keep the noise down after 11 pm.", ["quiet_hours:23:00"]),
  T("rules", "House rules", "Please keep the volume down after 22:00.", ["quiet_hours:22:00"]),
  X("local_tips", "Bar", "The bar across the street gets noisy after 11 pm."),
  // Sözcük süzgecinin düşürdüğü sahte eşleşme ("salonda" → spor salonu) cümleciği "ve"den BÖLDÜRMEZ.
  T("rules", "Ev içi sessizlik", "Lütfen 07.00'den önce koridorda ve salonda televizyon sesini düşük tutun.", ["quiet_hours:07:00"]),
  // Başvuru noktası ("varıştan bir gün önce") ve valiz deposu.
  X("checkin", "Kimlik yükleme", "Varıştan bir gün önce 18:00'e kadar kimliğinizi yükleyin."),
  X("checkout", "Luggage", "Need to keep your bags after check-out? You can leave them in our storage room until 6 pm."),
  T("checkout", "Luggage", "Leave your bags by the door and check out by 11:00.", ["checkout:11:00"]),

  // Tek başına pinler (her biri YALNIZ bir kural parçasına dayanır; mutasyon koşusu bu ayrımı ister).
  X("checkin", "Erken varış", "Valizlerinizi bırakabilirsiniz ve 10:00'dan itibaren şehri gezebilirsiniz."),
  T("checkout", "Çıkış", "Geç kalkan misafirlerimiz için de çıkış saati 11:00'dir.", ["checkout:11:00"]),
  T("checkin", "Giriş", "Hazırsanız 15:00'te giriş yapabilirsiniz.", ["checkin:15:00"]),
  X("checkin", "Kod", "Kapı kodunuz giriş günü aktifleşir ve çıkış günü 11:00'de sona erer."),
  T("general", "Kurallar", "Her konaklama 16:00'da başlar ve 10:00'da sona erer.", ["checkin:16:00", "checkout:10:00"]),
  X("checkin", "Bina", "Binaya 23:00'ten sonra girilemez."),
  X("rules", "Kurallar", "22:00'den sonra girmek yasaktır."),
  X("rules", "Kurallar", "Gece 23:00'ten sonra girmeyin."),
  X("general", "Havuz başı barı", "Havuz başı barı 11:00'de açılır."),
  X("checkout", "Çıkış", "Şoförümüz 10:30'da binanın önünde bekliyor."),
  X("checkin", "Giriş bilgileri", "Giriş bilgileriniz varış günü 10:00'da hazır olur."),
  X("checkout", "Çıkış", "Çıkmadan önce 10:00'a kadar haber verin."),
  T("checkin", "Giriş", "Erken gelirseniz 15:00'ten itibaren yerleşebilirsiniz.", ["checkin:15:00"]),
  X("checkout", "Taksi", "Havalimanına taksi isterseniz, 10:15'e ayarlayabiliriz."),
  T("checkout", "Check-out", "Subject to availability, you can stay until 1 pm.", ["late_checkout:13:00"]),
  T("checkout", "Check-out", "If no other guests arrive that day, you can check out at 1 pm.", ["late_checkout:13:00"]),
  T("checkin", "Check-in", "If it's free, you can check in at 12:00.", ["early_checkin:12:00"]),

  // ── Savunulabilir iki okuma (puanlanmaz) ────────────────────────────────────────────────────────────────────────
  S("checkout", "Erken Sabah Çıkışı", "Sabah 07:00'den önce çıkarken koridorda yüksek sesle konuşmamaya özen gösterin.", ["quiet_hours:07:00"]),
  S("checkout", "Çıkış", "Temizlik ekibimiz 11:00 sonrası için planlama yapar.", ["cleaning:11:00"]),
  S("checkin", "Check-in desk", "The check-in desk opens at 15:00.", ["checkin:15:00"]),
  // Yere bağlı sessizlik kuralı (havuz başı / havuz alanı): cümlecik İKİ alan (havuz + sessizlik) adlandırır → belirsiz, hüküm
  // yok. Genel sessizlik saati sayılsaydı "sessizlik 23:00" kalemiyle sahte çelişki notu üretirdi; kör batarya etiketçisi ise
  // sessizlik saati bekledi (09-27) — iki okuma da savunulabilir.
  S("general", "Havuz ve müzik", "Havuz başında 22:00'den sonra müzik çalmak yasaktır.", ["quiet_hours:22:00"]),
  S("rules", "Siesta", "Siesta time: please keep the pool area quiet between 2 pm and 5 pm.", ["quiet_hours:14:00", "quiet_hours:17:00"]),
];
