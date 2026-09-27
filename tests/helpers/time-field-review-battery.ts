// ---------------------------------------------------------------------------
// SAAT OKUMA DOĞRULUK TURU — İNCELEME BATARYASI (09-27, kurucu onayı: "yaklaşık 45 örneği başlangıç, son kabul, saat aralığı,
// koşullu erken/geç giriş ve başka bir olayın saati olarak ayrı test etsin; gerçek çelişkiyi kaçırmasın, sahte çelişki üretmesin.
// Belirsiz ifadede misafire kesin saat uydurmasın."). Cümleler dört inceleme ajanının (A1 Türkçe, A2 İngilizce/diğer, A3 akış, A4 kör
// batarya) çalıştırılarak doğrulanmış bulgularından + Codex C1b; hiçbiri gerçek veri değil. Her vaka BEŞ sınıftan birinde:
//   baslangic  — başlangıç / nokta saat biçimleri ("14'ten itibaren", "12 noon", "4p.m.", "11:00dir", "yours from 2 pm")
//   son_kabul  — giriş penceresinin SONU ("Latest check-in 10 pm", "En geç giriş 23:00"): başlangıç saati DEĞİL
//   aralik     — iki uçlu pencere ("3 PM – 10 PM", "3 – 10 pm", "saat 10-11 arası", "15:00 ve 11:00")
//   kosullu    — koşullu erken giriş / geç çıkış ↔ standart saat ("Müsaitliğe bağlı olarak 12:00'de", "Even if …, check-in is at 3 pm")
//   baska_olay — başka bir olayın saati (fiyat, tarih, bina kapısı kodu, ulaşım seferi, müze, yoga, kahvaltı, teras)
// `expect` = okunması GEREKEN alan:saat kümesi (tam eşitlik). `conflict` = mülk saatleriyle çelişki beklentisi (kapı + istem + ev
// sahibi raporu aynı kuralı kullanır): alan → beklenen uyuşmayan KB saatleri ([] = çelişki YOK).
// ---------------------------------------------------------------------------

export type ReviewClass = "baslangic" | "son_kabul" | "aralik" | "kosullu" | "baska_olay";

export interface ReviewCase {
  id: string;
  cls: ReviewClass;
  /** Bulgunun kaynağı (ajan · bulgu no). */
  src: string;
  category: string;
  title: string;
  text: string;
  /** Beklenen okuma "alan:SS:DD" (sırasız, tam eşitlik); verilmezse okuma puanlanmaz (yalnız çelişki). */
  expect?: string[];
  /** Mülk saatleri + beklenen uyuşmazlık (alan başına KB saatleri; [] = çelişki yok). */
  conflict?: { checkIn?: string; checkOut?: string; checkin?: string[]; checkout?: string[] };
}

const R = (id: string, cls: ReviewClass, src: string, category: string, title: string, text: string, expect?: string[], conflict?: ReviewCase["conflict"]): ReviewCase =>
  ({ id, cls, src, category, title, text, ...(expect ? { expect } : {}), ...(conflict ? { conflict } : {}) });

export const TIME_FIELD_REVIEW_BATTERY: ReviewCase[] = [
  // ── BAŞLANGIÇ / NOKTA SAAT BİÇİMLERİ ───────────────────────────────────────────────────────────────────────────────────
  R("B01", "baslangic", "A1·1", "general", "Saatler", "Giriş 14'ten itibaren, çıkış 11'e kadar.", ["checkin:14:00", "checkout:11:00"], { checkIn: "15:00", checkOut: "12:00", checkin: ["14:00"], checkout: ["11:00"] }),
  R("B02", "baslangic", "A1·1", "checkin", "Giriş", "Giriş günü saat 14'ten itibaren daireye yerleşebilirsiniz; anahtar kutusu şifresi rezervasyon mesajında yazıyor.", ["checkin:14:00"]),
  R("B03", "baslangic", "A2·3", "checkout", "Check-out", "Check-out: 12 noon.", ["checkout:12:00"], { checkOut: "11:00", checkout: ["12:00"] }),
  R("B04", "baslangic", "A2·3", "checkin", "Check-in", "Check-in from 4p.m.", ["checkin:16:00"]),
  R("B05", "baslangic", "A2·3", "checkout", "Check-out", "Check-out is at 11 a.m, thank you.", ["checkout:11:00"]),
  R("B06", "baslangic", "A2·3", "general", "Welcome", "Check-in is from approx. 2 pm.", ["checkin:14:00"]),
  R("B07", "baslangic", "A3·5", "checkout", "Çıkış", "Çıkış saati 11:00dir.", ["checkout:11:00"]),
  R("B08", "baslangic", "A3·5", "checkin", "Giriş", "Giriş 15:00ten itibaren.", ["checkin:15:00"]),
  R("B09", "baslangic", "A1·3", "checkin", "Giriş", "Varış saatimiz 14:00'tür.", ["checkin:14:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("B10", "baslangic", "A1·3", "checkout", "Çıkış", "Ayrılış saatimiz 13:00'tür.", ["checkout:13:00"]),
  R("B11", "baslangic", "A2·2", "general", "Your stay", "The apartment is yours from 2 pm and must be vacated by 11 am.", ["checkin:14:00", "checkout:11:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("B12", "baslangic", "A1·4", "checkin", "Varış", "Erken gelirseniz 15:00 itibarıyla yerleşebilirsiniz.", ["checkin:15:00"]),
  R("B13", "baslangic", "C1b", "checkin", "Giriş", "Check-in from 15:00. Check-in at 14:00.", ["checkin:14:00", "checkin:15:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("B14", "baslangic", "A1·6", "checkout", "Çıkış", "Daireden 11:00'de çıkmanızı rica ederiz.", ["checkout:11:00"], { checkOut: "12:00", checkout: ["11:00"] }),
  R("B15", "baslangic", "A1·6", "checkout", "Çıkış", "Çıkış günü en geç 11:00'de ayrılmanız gerekiyor.", ["checkout:11:00"]),
  R("B16", "baslangic", "A1·1", "checkout", "Çıkış", "Çıkış saat 11 buçukta yapılır.", ["checkout:11:30"], { checkOut: "11:00", checkout: ["11:30"] }),

  // ── SON KABUL (giriş penceresinin sonu — başlangıç saati DEĞİL) ─────────────────────────────────────────────────────────
  R("S01", "son_kabul", "A2·6", "checkin", "Late arrival", "Latest check-in is 10 pm.", ["late_checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  R("S02", "son_kabul", "A3·10", "checkin", "Giriş", "En geç giriş saati 23:00'tür.", ["late_checkin:23:00"], { checkIn: "15:00", checkin: [] }),
  R("S03", "son_kabul", "A3·10", "checkin", "Giriş", "Son giriş saati 22:00.", ["late_checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  R("S04", "son_kabul", "A3·10", "checkin", "Check-in", "Check-in is possible until 11 pm.", ["late_checkin:23:00"], { checkIn: "15:00", checkin: [] }),
  R("S05", "son_kabul", "A2·6", "checkin", "Giriş", "Girişler en geç 22:00'ye kadar yapılabilir.", ["late_checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  R("S06", "son_kabul", "A4", "checkin", "Check-in", "Check-in until 10 pm at the latest.", ["late_checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  R("S07", "son_kabul", "A1·9", "checkin", "Varış", "Geç saatte giriş 23:00'e kadar mümkündür.", ["late_checkin:23:00"], { checkIn: "15:00", checkin: [] }),
  // Pencere sonu mülkün BAŞLANGICINDAN ÖNCE → gerçek çelişki (kaçmamalı).
  R("S08", "son_kabul", "A2·6 ikiz", "checkin", "Check-in", "Check-in must be completed by 14:00.", undefined, { checkIn: "15:00", checkin: ["14:00"] }),
  // Gece yarısını geçen son kabul ertesi gündür (çelişki değil).
  R("S09", "son_kabul", "batarya ikizi", "checkin", "Geç giriş", "Latest check-in is 1 am.", ["late_checkin:01:00"], { checkIn: "15:00", checkin: [] }),
  // Geç varış ücreti / ziyaretçi kuralı giriş saati değil.
  R("S10", "son_kabul", "A1·9", "checkin", "Geç giriş", "22:00'den sonra yapılan girişler için 200 TL ek ücret alınır.", undefined, { checkIn: "15:00", checkin: [] }),
  R("S11", "son_kabul", "A1·9", "rules", "Ziyaretçi", "Ziyaretçilerin daireye girişi 22:00'den sonra yasaktır.", [], { checkIn: "15:00", checkin: [] }),

  // ── ARALIK ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  R("A01", "aralik", "A4", "general", "Key times", "Check-in: 3 PM – 10 PM | Check-out: 11 AM | Quiet hours from 10 PM", ["checkin:15:00", "checkin:22:00", "checkout:11:00", "quiet_hours:22:00"], { checkIn: "14:00", checkin: ["15:00", "22:00"] }),
  R("A02", "aralik", "A2·5", "checkin", "Check-in", "Check-in: 3 – 10 pm.", ["checkin:15:00", "checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  R("A03", "aralik", "A2·5", "checkin", "Check-in", "Check-in between 3-8pm.", ["checkin:15:00", "checkin:20:00"], { checkIn: "15:00", checkin: [] }),
  R("A04", "aralik", "A2·1", "checkin", "Check-in", "Check-in is available from 2 pm to 10 pm.", ["checkin:14:00", "checkin:22:00"], { checkIn: "15:00", checkin: ["14:00", "22:00"] }),
  R("A05", "aralik", "A2·1", "checkin", "Check-in", "Contactless check-in from 4 pm to 10 pm.", ["checkin:16:00", "checkin:22:00"]),
  R("A06", "aralik", "A1·1", "checkout", "Çıkış", "Çıkış saat 10-11 arası yapılmalıdır.", ["checkout:10:00", "checkout:11:00"], { checkOut: "11:00", checkout: [] }),
  R("A07", "aralik", "A1·2", "general", "Saatler", "Giriş ve çıkış saatleri 15:00 ve 11:00'dir.", ["checkin:15:00", "checkout:11:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("A08", "aralik", "A3·6", "general", "Saatler", "Giriş ve çıkış saatleri: 15:00 ve 11:00.", ["checkin:15:00", "checkout:11:00"]),
  R("A09", "aralik", "A2·5", "rules", "Pool", "The pool is open 9 – 7 pm.", ["pool:09:00", "pool:19:00"]),
  R("A10", "aralik", "A4", "checkin", "Check-in", "Check-in: 3:00 PM – 10:00 PM · Check-out: 11:00 AM", ["checkin:15:00", "checkin:22:00", "checkout:11:00"]),

  // ── KOŞULLU ERKEN / GEÇ ↔ STANDART ──────────────────────────────────────────────────────────────────────────────────────
  R("K01", "kosullu", "A1·8", "checkin", "Erken giriş", "Müsaitliğe bağlı olarak 12:00'de girebilirsiniz.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("K02", "kosullu", "A1·8", "checkin", "Giriş", "Uygunsa 12:00'de giriş yapabilirsiniz.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("K03", "kosullu", "A1·8", "checkin", "Giriş", "Temizlik bitmişse 12:00'de girebilirsiniz.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("K04", "kosullu", "A1·8", "checkout", "Çıkış", "Doluluk durumuna göre 13:00'e kadar kalabilirsiniz.", ["late_checkout:13:00"], { checkOut: "11:00", checkout: [] }),
  R("K05", "kosullu", "A2·7", "checkin", "Early check-in", "If available, you can check in at 1 pm.", ["early_checkin:13:00"], { checkIn: "15:00", checkin: [] }),
  R("K06", "kosullu", "A2·7", "checkin", "Early check-in", "You can check in from 12:00 for an extra €30.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("K07", "kosullu", "A2·7", "checkout", "Late check-out", "You can check out at 1 pm for a €20 fee.", ["late_checkout:13:00"], { checkOut: "11:00", checkout: [] }),
  R("K08", "kosullu", "A2·4", "checkin", "Check-in", "Even if the apartment is ready, check-in is at 3 pm.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("K09", "kosullu", "A2·4", "checkout", "Check-out", "Even if nobody is checking in after you, check-out is at 11 am sharp.", ["checkout:11:00"], { checkOut: "12:00", checkout: ["11:00"] }),
  R("K10", "kosullu", "A1·4", "checkin", "Giriş", "Erken gelseniz de giriş 15:00'te yapılır.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("K11", "kosullu", "A1·5", "checkin", "Giriş", "Daire hazırsa 13:00'te, aksi durumda 15:00'te girebilirsiniz.", ["early_checkin:13:00", "checkin:15:00"], { checkIn: "15:00", checkin: [] }),
  R("K12", "kosullu", "A1·8", "checkout", "Geç çıkış", "Geç çıkmak isterseniz 13:00'e dek kalabilirsiniz.", ["late_checkout:13:00"], { checkOut: "11:00", checkout: [] }),
  R("K13", "kosullu", "A2·12", "checkin", "Check-in anticipado", "Check-in anticipado desde las 12:00, sujeto a disponibilidad.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("K14", "kosullu", "A2·12", "checkout", "Check-out", "Später Check-out bis 13:00 Uhr nach Absprache.", ["late_checkout:13:00"], { checkOut: "11:00", checkout: [] }),

  // ── BAŞKA BİR OLAYIN SAATİ (hiçbir konaklama alanı değil) ──────────────────────────────────────────────────────────────
  R("O01", "baska_olay", "A2·8", "checkin", "Check-in", "A deposit of €10.00 is due at check-in.", [], { checkIn: "15:00", checkin: [] }),
  R("O02", "baska_olay", "A2·8", "checkin", "Check-in", "The tourist tax (2.50 EUR per night) is paid in cash at check-in.", [], { checkIn: "15:00", checkin: [] }),
  R("O03", "baska_olay", "A1·1", "checkin", "Giriş", "Tesisimiz 15.04 tarihinde açılır.", [], { checkIn: "15:00", checkin: [] }),
  R("O04", "baska_olay", "A4", "rules", "Havuz", "Havuz sezonu 15.05–30.09 arasıdır.", []),
  R("O05", "baska_olay", "A2·9", "checkin", "Building access", "The gate code works from 7 am to 11 pm.", [], { checkIn: "15:00", checkin: [] }),
  R("O06", "baska_olay", "A2·9", "general", "Bina", "Bina kapısının kodu 07:00–23:00 arası çalışır.", [], { checkIn: "15:00", checkin: [] }),
  R("O07", "baska_olay", "A3·7", "general", "Havuz", "Villanın havuzu 09:00'dan 20:00'ye kadar kullanılabilir.", ["pool:09:00", "pool:20:00"], { checkIn: "15:00", checkOut: "11:00", checkin: [], checkout: [] }),
  R("O08", "baska_olay", "A4", "checkin", "Arrival", "Take the airport shuttle. First departure 04:00, last departure 01:00.", [], { checkIn: "15:00", checkOut: "11:00", checkin: [], checkout: [] }),
  R("O09", "baska_olay", "A4", "checkin", "Ulaşım", "Havalimanından Havaist otobüsüyle gelebilirsiniz; ilk sefer 04:00, son sefer 01:00'de kalkıyor.", [], { checkIn: "15:00", checkin: [] }),
  R("O10", "baska_olay", "A4", "general", "Gezi", "Topkapı Sarayı'na giriş 09:00'da başlıyor, son giriş 17:00'de.", [], { checkIn: "15:00", checkin: [] }),
  R("O11", "baska_olay", "A3·8", "general", "Yoga", "During your stay, yoga classes start at 8 am.", [], { checkIn: "15:00", checkin: [] }),
  R("O12", "baska_olay", "A1·11", "checkout", "Çıkış", "Çıkış sabahı kahvaltı 08:00'de servis edilir.", [], { checkOut: "11:00", checkout: [] }),
  R("O13", "baska_olay", "A1·11", "checkout", "Çıkış", "Check-out'tan sonra 12:00–14:00 arası terası kullanabilirsiniz.", [], { checkOut: "11:00", checkout: [] }),
  R("O14", "baska_olay", "A3·4", "checkout", "Check-out", "Check-out 11:00 — breakfast until 10:00.", ["checkout:11:00"], { checkOut: "10:00", checkout: ["11:00"] }),
  R("O15", "baska_olay", "A1·10", "checkout", "Çıkış günü", "Havalimanına zamanında varmak için 08:30'da yola çıkın.", [], { checkOut: "11:00", checkout: [] }),
  R("O16", "baska_olay", "A1·10", "general", "Oyun odası", "Oyun odasına 10:00–22:00 arası girebilirsiniz.", [], { checkIn: "15:00", checkin: [] }),

  // ── İKİZLER (her yeni kural için: gerçek saat okunmaya / gerçek çelişki yakalanmaya devam eder + tuzak okunmaz) ──────────
  // Başlangıç / nokta biçimleri
  R("T01", "baslangic", "ikiz·tarih", "checkin", "Check-in", "Check-in: 14.30.", ["checkin:14:30"], { checkIn: "15:00", checkin: ["14:30"] }),
  R("T02", "baslangic", "ikiz·noon", "checkout", "Check-out", "Check-out by noon, please.", ["checkout:12:00"], { checkOut: "11:00", checkout: ["12:00"] }),
  R("T03", "baslangic", "ikiz·noon", "checkin", "Check-in", "Check-in in the afternoon.", [], { checkIn: "15:00", checkin: [] }),
  R("T04", "baslangic", "ikiz·buçuk", "checkout", "Çıkış", "Çıkış saat 11'i çeyrek geçe yapılır.", ["checkout:11:15"], { checkOut: "11:00", checkout: ["11:15"] }),
  // Kesin Türkçe dakika çözülür ("on geçe" = 11:10; eskisi 11:00 okuyup mülkün 11:00'iyle çelişkiyi gizliyordu); çözülemeyen dakikada
  // ("biraz geçe") kesin saat UYDURULMAZ.
  R("T05", "baslangic", "ikiz·dakika", "checkout", "Çıkış", "Çıkış saat 11'i on geçe yapılır.", ["checkout:11:10"], { checkOut: "11:00", checkout: ["11:10"] }),
  R("T16", "baslangic", "ikiz·dakika", "checkout", "Çıkış", "Çıkış saat 11'i biraz geçe yapılabilir.", [], { checkOut: "11:00", checkout: [] }),
  R("T17", "baslangic", "ikiz·dakika", "checkout", "Çıkış", "Çıkış 12'ye yirmi kala yapılır.", ["checkout:11:40"], { checkOut: "11:00", checkout: ["11:40"] }),
  R("T06", "baslangic", "ikiz·çıplak saat", "checkin", "Giriş", "Girişte 12'ye kadar misafir kabul edilir.", [], { checkIn: "15:00", checkin: [] }),
  R("T07", "baslangic", "ikiz·çıplak saat", "checkin", "Giriş", "Kapasite 12'de.", [], { checkIn: "15:00", checkin: [] }),
  R("T18", "baslangic", "ikiz·çıplak saat", "checkin", "Giriş", "Girişte 12'ye kadar 4 misafir kabul edilir.", [], { checkIn: "15:00", checkin: [] }),
  R("T08", "baslangic", "ikiz·gün bölümü", "checkout", "Çıkış", "Çıkış sabah 11'de.", ["checkout:11:00"], { checkOut: "12:00", checkout: ["11:00"] }),
  R("T09", "baslangic", "ikiz·çıplak saat", "checkin", "Giriş", "Saat 3'te giriş yapabilirsiniz.", [], { checkIn: "15:00", checkin: [] }),
  R("T10", "baslangic", "ikiz·ziyaretçi", "checkin", "Giriş", "Misafirlerimizin daireye girişi 15:00'ten itibarendir.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T11", "baslangic", "ikiz·başka yer", "checkin", "Giriş", "Villa Lale'ye giriş 15:00'te.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T12", "baslangic", "ikiz·C1b", "checkin", "Check-in", "Check-in from 15:00. Self check-in at 16:00 is possible.", ["checkin:15:00", "checkin:16:00"], { checkIn: "15:00", checkin: [] }),
  R("T13", "baslangic", "ikiz·C1b", "checkout", "Check-out", "Check-out by 11:00. Check-out at 12:00.", ["checkout:11:00", "checkout:12:00"], { checkOut: "11:00", checkout: ["12:00"] }),
  R("T14", "baslangic", "ikiz·C1b", "checkout", "Check-out", "Check-out by 11:00. Check-out at 10:00 is also fine.", ["checkout:10:00", "checkout:11:00"], { checkOut: "11:00", checkout: [] }),
  R("T15", "baslangic", "ikiz·günlük pencere", "checkin", "Kod", "Your door code works from 15:00 on arrival day until 11:00 on departure day.", ["checkin:15:00", "checkout:11:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  // Son kabul
  R("T20", "son_kabul", "ikiz·olumsuz", "checkin", "Check-in", "No check-in after 22:00.", ["late_checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  R("T21", "son_kabul", "ikiz·eşit", "checkin", "Check-in", "Latest check-in is 15:00.", ["late_checkin:15:00"], { checkIn: "15:00", checkin: ["15:00"] }),
  R("T22", "son_kabul", "ikiz·önce", "checkin", "Check-in", "Check-in: 15:00. Latest check-in: 14:00.", ["checkin:15:00", "late_checkin:14:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("T23", "son_kabul", "ikiz·önce", "checkin", "Giriş", "Girişler en geç 14:00'e kadar tamamlanmalıdır.", ["late_checkin:14:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("T24", "son_kabul", "ikiz·pencere", "checkin", "Giriş", "Giriş 15:00'ten itibaren, en geç 22:00'ye kadar yapılabilir.", ["checkin:15:00", "late_checkin:22:00"], { checkIn: "16:00", checkin: ["15:00"] }),
  R("T25", "son_kabul", "ikiz·pencere", "checkin", "Check-in", "Check-in from 15:00 until 22:00.", ["checkin:15:00", "checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  // Aralık
  R("T30", "aralik", "ikiz·ortak am/pm", "rules", "Sessizlik", "Quiet hours 10 – 7 am.", ["quiet_hours:07:00", "quiet_hours:22:00"]),
  R("T31", "aralik", "ikiz·ortak pencere", "checkin", "Saatler", "Giriş ve çıkış işlemleri 09:00 ve 18:00 arasında resepsiyonda yapılır.", [], { checkIn: "15:00", checkOut: "11:00", checkin: [], checkout: [] }),
  R("T32", "aralik", "ikiz·aralık", "checkin", "Check-in", "Check-in is possible between 15:00 and 23:00.", ["checkin:15:00", "checkin:23:00"], { checkIn: "14:00", checkin: ["15:00", "23:00"] }),
  // Koşullu
  R("T40", "kosullu", "ikiz·ücretsiz", "checkin", "Check-in", "Check-in at 15:00, free of charge.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T41", "kosullu", "ikiz·vergi", "checkin", "Check-in", "Check-in at 15:00 (city tax €2 is paid on arrival).", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T42", "kosullu", "ikiz·ücret", "checkin", "Early check-in", "Early check-in at 12:00 costs €20.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("T43", "kosullu", "ikiz·size uygunsa", "checkin", "Giriş", "Size uygunsa 15:00'te giriş yapabilirsiniz.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T44", "kosullu", "ikiz·sondaki müsaitlik", "checkin", "Check-in", "Check-in at 12:00, subject to availability.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("T45", "kosullu", "ikiz·parantez", "checkin", "Check-in", "Check-in from 3 pm (earlier on request).", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T46", "kosullu", "ikiz·ayrı seçenek", "checkin", "Check-in", "Check-in 15:00, early check-in on request.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  // Başka olay
  R("T50", "baska_olay", "ikiz·para", "checkin", "Check-in", "Check-in 15.00 (deposit €10.00 at arrival).", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T51", "baska_olay", "ikiz·tarih", "general", "Rezervasyon", "Rezervasyonlar 01.06 tarihinden itibaren açılır.", []),
  R("T52", "baska_olay", "ikiz·tur", "general", "Tekne turu", "Tekne turu 14:00'te kalkar.", []),
  R("T53", "baska_olay", "ikiz·ortak kapı", "checkin", "Saatler", "Giriş ve çıkış kapısı 07:00 ve 23:00'te kilitlenir.", [], { checkIn: "15:00", checkOut: "11:00", checkin: [], checkout: [] }),
  R("T54", "baska_olay", "ikiz·tire", "checkout", "Check-out", "Check-out 11:00 — the airport bus leaves at 10:00.", ["checkout:11:00"], { checkOut: "11:00", checkout: [] }),
  R("T55", "baska_olay", "ikiz·yola çık", "checkout", "Çıkış", "Daireden 11:00'de çıkın.", ["checkout:11:00"], { checkOut: "12:00", checkout: ["11:00"] }),
  R("T56", "baska_olay", "ikiz·oda", "checkin", "Giriş", "Odanıza 15:00'ten itibaren girebilirsiniz.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T57", "baska_olay", "ikiz·yoga", "general", "Konaklama", "Konaklamanız 15:00'te başlar.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("T58", "baska_olay", "ikiz·kod", "checkin", "Kod", "The code works from 3 pm and is deactivated by 11 am.", [], { checkIn: "14:00", checkOut: "12:00", checkin: [], checkout: [] }),
  R("T59", "baska_olay", "ikiz·gece yarısı", "rules", "Sessizlik", "Gece yarısından sonra lütfen sessiz olun.", ["quiet_hours:00:00"]),

  // ── A10 (dil kuralları ajanı): genel fiil "başka konu" sayılıp gerçek çelişki kaçıyordu; nesneli "leave" / "para" sahte saat üretiyordu ──
  R("L01", "baslangic", "A10·1", "checkin", "Giriş saati", "Kapıyı saat 14:00'ten itibaren açabilirsiniz.", ["checkin:14:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("L02", "baslangic", "A10·1", "checkin", "Giriş saati", "Kapı 14:00'te açılıyor.", ["checkin:14:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("L03", "baslangic", "A10·1", "checkin", "Check-in", "You can get in from 2 pm.", ["checkin:14:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("L04", "baslangic", "A10·1", "checkin", "Check-in", "See you from 2 pm!", ["checkin:14:00"], { checkIn: "15:00", checkin: ["14:00"] }),
  R("L05", "baska_olay", "A10·1 ikiz", "checkin", "Giriş", "Klimayı 16:00'da açın.", [], { checkIn: "15:00", checkin: [] }),
  R("L06", "baska_olay", "A10·1 ikiz", "checkin", "Giriş", "Acil durumda 14:00'ten sonra resepsiyonu arayın.", [], { checkIn: "15:00", checkin: [] }),
  R("L07", "baska_olay", "A10·1 ikiz", "checkin", "Giriş", "Kapılar 23:00'te kapanır, 07:00'de açılır.", [], { checkIn: "15:00", checkin: [] }),
  R("L08", "baska_olay", "A10·2", "general", "Ödeme", "Kalan tutarı (para) 20:00'ye kadar ödemeniz rica olunur.", [], { checkIn: "15:00", checkOut: "11:00", checkin: [], checkout: [] }),
  R("L09", "baska_olay", "A10·2", "checkout", "Towels", "Please leave used towels in the bathtub by 10 am.", [], { checkOut: "11:00", checkout: [] }),
  R("L10", "baska_olay", "A10·2", "checkout", "Trash", "Please leave the trash in the bin before 9 am.", [], { checkOut: "11:00", checkout: [] }),
  R("L11", "baska_olay", "A10·2", "general", "Parking", "Please leave your car in the lot until 12:00.", [], { checkOut: "11:00", checkout: [] }),
  R("L12", "baslangic", "A10·2 ikiz", "checkout", "Check-out", "Please leave by 11 am.", ["checkout:11:00"], { checkOut: "12:00", checkout: ["11:00"] }),
  R("L13", "baslangic", "A10·2 ikiz", "checkout", "Check-out", "Please leave the keys on the table by 11 am.", ["checkout:11:00"], { checkOut: "12:00", checkout: ["11:00"] }),
  R("L14", "baslangic", "A10·2 ikiz", "checkout", "Check-out", "Please leave the premises by 11 am.", ["checkout:11:00"], { checkOut: "12:00", checkout: ["11:00"] }),

  // ── Mutasyon turunun (88 mutant, 73 öldü) hayatta bıraktığı kural parçalarına YALNIZ ona dayanan pin ─────────────────────────
  R("M01", "baska_olay", "mut·N03 tarih", "checkin", "Giriş", "Tesisimiz 15.05 tarihinde açılır.", [], { checkIn: "15:00", checkin: [] }),
  R("M02", "baska_olay", "mut·N04 ay", "rules", "Havuz", "Havuz 01.06'dan itibaren açıktır.", []),
  R("M03", "kosullu", "mut·N32 ücretsiz", "checkin", "Check-in", "You can check in at 15:00 free of charge.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("M04", "kosullu", "mut·N50 or earlier", "checkin", "Check-in", "Check-in from 3 pm or earlier on request.", ["checkin:15:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  R("M05", "baska_olay", "mut·N53 başvuru", "checkout", "Çıkış", "Check-out'tan sonra 12:00'de anahtarı kutuya bırakın.", [], { checkOut: "11:00", checkout: [] }),
  R("M06", "kosullu", "mut·N54 sonraki sıfat", "checkin", "Check-in", "Check-in anticipado desde las 12:00.", ["early_checkin:12:00"], { checkIn: "15:00", checkin: [] }),
  R("M07", "aralik", "mut·N65 ortak işaret", "checkin", "Check-in", "Check-in: 3:00 – 10:00 PM.", ["checkin:15:00", "checkin:22:00"], { checkIn: "15:00", checkin: [] }),
  R("M08", "aralik", "mut·N66 saat aralığı", "cleaning", "Temizlik", "Temizlik saat 11-14 yapılır.", ["cleaning:11:00", "cleaning:14:00"]),
  R("M09", "aralik", "mut·N67 çıplak aralık", "checkout", "Çıkış", "Çıkış 10-11 arası yapılmalıdır.", ["checkout:10:00", "checkout:11:00"], { checkOut: "11:00", checkout: [] }),
  R("M10", "baslangic", "mut·N11b dakika", "checkout", "Çıkış", "Çıkış saat 11'i birkaç dakika geçe yapılabilir.", [], { checkOut: "11:00", checkout: [] }),
  R("M11", "baslangic", "mut·N70 eşleme", "general", "Saatler", "Check-in and check-out: 15:00 and 11:00 until further notice.", ["checkin:15:00", "checkout:11:00"], { checkIn: "14:00", checkin: ["15:00"] }),
  // 09-27 ikinci mutasyon turu (#208/#211, 36 mutant): yaşayan üç parçaya YALNIZ ona dayanan pin.
  R("M12", "baska_olay", "mut·T3 acil", "checkin", "Giriş", "Acil durum hattı 14:00'ten itibaren açıktır.", [], { checkIn: "15:00", checkin: [] }),
  R("M13", "baska_olay", "mut·T8 kapı taşıma", "checkin", "Giriş", "Bina kapısı gece 23:00'te kilitlenir, sabah 07:00'de tekrar açılır.", [], { checkIn: "15:00", checkin: [] }),
  R("M14", "baska_olay", "mut·T8 kapı taşıma EN", "checkin", "Check-in", "The doors close at 11 pm, and you can come in from 7 am.", [], { checkIn: "15:00", checkin: [] }),
];
