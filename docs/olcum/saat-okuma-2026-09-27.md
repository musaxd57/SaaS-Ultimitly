# Saat okuma doğruluk turu (27.09, #207)

**Kurucu onayı (09-27, aynen):** "yaklaşık 45 örneği başlangıç, son kabul, saat aralığı, koşullu erken/geç giriş ve başka bir
olayın saati olarak ayrı test etsin; gerçek çelişkiyi kaçırmasın, sahte çelişki üretmesin. Belirsiz ifadede misafire kesin saat
uydurmasın. Eski/yeni sonuçları ve müşteriye gidecek örnek cevapları raporlasın."

## Ne ölçüldü

- **Batarya** `tests/helpers/time-field-review-battery.ts`, kalıcı test `tests/unit/kb-time-fields-review-battery.test.ts`:
  - **67 bulgu:** dört inceleme ajanının çalıştırılarak doğrulanmış bulguları (A1 Türkçe, A2 İngilizce/diğer diller, A3 akış, A4 kör batarya) ve Codex C1b.
  - **44 ikiz:** her yeni kural için bir gerçek vaka (okunmaya ya da çelişki yakalanmaya devam etmeli) ve bir tuzak (okunmamalı).
  - Her vaka beş sınıftan birindedir.
- **Puanlayıcı ürünün kendi fonksiyonlarıdır:**
  - okuma `fieldTimeHits`;
  - mülk saatiyle çelişki `kbPropertyMismatch`. Aynı kuralı istemdeki çelişki bloğu, `kb_time_conflict` gönderim kapısı ve ev sahibinin "Uyuşmayan saatler" raporu kullanır.
- **Eski/yeni:** eski = `c9225d0` (bugün canlıdaki okuyucu), yeni = bu tur (`e344cc6` + `223ea95`).

## Sonuç

Vaka ancak okuma ve çelişki beklentisinin ikisi de tutuyorsa "geçti" sayılır.

| sınıf | bulgu (eski) | bulgu (yeni) | ikiz (eski) | ikiz (yeni) |
|---|---|---|---|---|
| başlangıç / nokta saat biçimi | 2/16 | **16/16** | 11/18 | **18/18** |
| son kabul (giriş penceresinin sonu) | 1/11 | **11/11** | 1/6 | **6/6** |
| saat aralığı | 2/10 | **10/10** | 1/3 | **3/3** |
| koşullu erken giriş / geç çıkış | 1/14 | **14/14** | 5/7 | **7/7** |
| başka bir olayın saati | 0/16 | **16/16** | 6/10 | **10/10** |
| **toplam** | **6/67** | **67/67** | **24/44** | **44/44** |

- Mevcut saat bataryası (168 gerçek + 146 tuzak) ve saat birim testleri değişmeden yeşil.
- Kırmızı-önce: yeni kalıcı test eski kodda 117 testin 86'sında kırmızıydı.

## Misafire giden sonuç

Burada yalnız deterministik kısım gösteriliyor. Ücretli model çağrısı yapılmadı: kredi yok, kurucu kararı. Modelin yazacağı cümle bu yüzden gösterilmiyor.

**Kurgu:**
- Mülk ayarı: giriş 15:00, çıkış 11:00 (satırda başka yazılmadıkça).
- Misafir "Saat kaçta giriş yapabiliriz?" ya da "Çıkış saati kaç?" diye soruyor.

**Tablodaki iki sonucun anlamı:**
- **tutulur:** Cevap otomatik gitmez, ev sahibine taslak olarak düşer. İstem de modele "bu alanda kaynaklar çelişiyor, kesin saat söyleme" der.
- **gider:** Saat kapısı engel olmaz; diğer kapılar ayrıca bakar.

Hesap `findTimeConflicts` ile aynı kuraldır (kalem kalem `kbPropertyMismatch`) ve gönderim kapısı `timeConflictHolds` ile yapıldı. Eski ve yeni kod aynı betikle koşuldu.

| bilgi tabanı cümlesi | eski | yeni | neden |
|---|---|---|---|
| "Latest check-in is 10 pm." | giriş cevabı **tutulur** (sahte 22:00 çelişkisi) | **gider** | son kabul pencerenin sonudur, başlangıç değil |
| "Check-in is possible until 11 pm." | tutulur (23:00) | **gider** | aynı |
| "Check-in: 3 – 10 pm." | tutulur (yalnız 22:00 okunuyordu) | **gider** | ortak "pm": 15:00–22:00, mülkle uyumlu |
| "Müsaitliğe bağlı olarak 12:00'de girebilirsiniz." | tutulur (12:00) | **gider** | koşullu erken giriş bir istisnadır |
| "You can check out at 1 pm for a €20 fee." | çıkış cevabı tutulur (13:00) | **gider** | ücretli geç çıkış seçeneği |
| "A deposit of €10.00 is due at check-in." | tutulur (10:00) | **gider** | para, saat değil |
| "Take the airport shuttle. First departure 04:00, last departure 01:00." | çıkış cevabı tutulur | **gider** | sefer çizelgesi |
| "Topkapı Sarayı'na giriş 09:00'da başlıyor, son giriş 17:00'de." | tutulur | **gider** | başka bir yerin girişi |
| "Çıkış sabahı kahvaltı 08:00'de servis edilir." | çıkış cevabı tutulur | **gider** | kahvaltı saati |
| "Ziyaretçilerin daireye girişi 22:00'den sonra yasaktır." | tutulur | **gider** | ziyaretçi kuralı |
| "Check-in must be completed by 14:00." | tutulur | tutulur | pencere mülkün girişinden önce bitiyor: **gerçek çelişki** |
| "Check-in from 15:00. Check-in at 14:00." | **gider** (çelişki görülmüyordu) | **tutulur** | aynı kalemde iki saat birbirini yalanlıyor (C1b) |
| "Giriş 14'ten itibaren, çıkış 11'e kadar." (mülk 15:00 / 12:00) | gider (saatler hiç okunmuyordu) | **ikisi de tutulur** | "saat" sözcüğü olmadan yazılmış Türkçe saat |
| "Check-out: 12 noon." | gider | **çıkış cevabı tutulur** | noon = 12:00 |
| "Varış saatimiz 14:00'tür." | gider | **tutulur** | "'tür" eki "tur" (tekne turu) sanılıyordu |
| "Even if the apartment is ready, check-in is at 3 pm." (mülk 14:00) | gider | **tutulur** | "even if" ile anlatılan 15:00 standart saattir |
| "Çıkış saat 11'i on geçe yapılır." | gider (11:00 okunuyordu) | **tutulur** (11:10) | dakika artık çözülüyor |

**Tablonun özeti:**
- Önceden tutulan 10 örnek artık gidiyor. Bu, gereksiz yere ev sahibine düşen cevaplardır; misafir daha hızlı cevap alır.
- Önceden giden 6 gerçek çelişki artık tutuluyor. Bu vakalarda misafire yanlış ya da çelişkili saat gidebiliyordu.
- Wi-Fi sorusu hiçbir örnekte tutulmuyor. Çelişki yalnız giriş/çıkış konusuna değen cevabı durdurur.

## Kurallar

Ayrıntı commit mesajlarında ve `src/lib/ai/retrieval/time-fields.ts` yorumlarındadır.

### Tarayıcı

Tarayıcı tek kaynaktır: `scanTimes`. Hem okuyucu hem de gönderim kapısının `timesIn`'i onu kullanır.

- **Saat sayılmayanlar:**
  - para: "€10.00", "2.50 EUR";
  - tarih: "15.04 tarihinde", "15.05–30.09";
  - ölçü.
- **Artık okunan biçimler:**
  - "12 noon", "midnight", "gece yarısı";
  - "4p.m.", "11 a.m,", "approx. 2 pm";
  - eksiz yapışık ek: "11:00dir".
- **Türkçe dakika:**
  - "11 buçuk" = 11:30, "11'i on geçe" = 11:10, "12'ye yirmi kala" = 11:40;
  - dakikası çözülemeyen anlatım ("biraz geçe") hiç okunmaz.
- **"saat" sözcüğü olmadan yazılmış saat:** "14'ten itibaren", "11'e kadar", "11'de".
  - Yalnız 10–23 arası saatlerde okunur.
  - Zayıf kanıt sayılır: saat ancak cümleciğin kendi alanına okunur, başlıktan ödünç alınmaz.
  - "12'ye kadar (4) misafir" bir sayımdır, saat değil.
- **Ortak am/pm:** "3 – 10 pm" = 15:00–22:00; "9 – 7 pm" = 09:00–19:00.

### Son kabul

- Şu anlatımlar giriş penceresinin sonudur ve geç giriş alanına okunur:
  - "latest / last check-in", "son giriş", "en geç giriş";
  - alt ucu olmayan "until / by / en geç";
  - "No check-in after 22:00".
- Mülkün girişinden önce ya da ona eşit saatte biten pencere yine çelişkidir. 06:00'dan önceki saat ertesi gün sayılır.

### Sınırın yanlış tarafı (C1b)

Mülkün saati kalemde yalnız sınır olarak geçiyorsa ("Check-in from 15:00"), sınırın yanlış tarafındaki koşulsuz saat çelişkidir ("Check-in at 14:00"). Doğru taraftaki saat ("Self check-in at 16:00") çelişki sayılmaz.

### Koşullu erken giriş / geç çıkış

- **Taviz standarttır:** "Even if…", "gelseniz de" ile anlatılan saat standart saattir.
- **Müsaitlik anlatımları istisnadır:**
  - "müsaitliğe bağlı", "uygunsa" (ama "size uygunsa" değil), "temizlik bitmişse", "doluluk durumuna göre";
  - İspanyolca, Fransızca, Almanca ve İtalyanca müsaitlik ifadeleri;
  - cümle sonunda tek başına duran "…, subject to availability".
- **Koşulu kapatanlar:** "aksi durumda" ile başlayan cümlecik önceki koşulu kapatır.
- **Ücret:** ücretli seçenek erken giriş / geç çıkış sayılır. "Ücretsiz" ya da vergi (city tax) bu sonucu doğurmaz.
- **Addan sonra gelen sıfat** da okunur: "Check-in anticipado", Almanca "Später".
- **Saatsiz parantez:** içindeki "earlier" dışarıdaki saati erken giriş yapmaz.

### Başka bir olayın saati

- Konaklama alanına okunmayan cümleler:
  - ziyaretçi kuralı;
  - müze veya saray girişi (ve aynı cümledeki "son giriş");
  - sefer çizelgesi;
  - "yola çıkın";
  - gün bölümü ("çıkış sabahı");
  - yoga dersi;
  - villanın havuzu (havuz saatidir);
  - günlük kod penceresi.
- Giriş ve çıkışa ortak olanlar da konaklama saati değildir:
  - "giriş ve çıkış kapısı";
  - "giriş ve çıkış işlemleri 09:00 ve 18:00 arasında" (hizmet saati).
- Tireden sonra kendi saatiyle gelen parça ayrı bilgidir: "Check-out 11:00 — breakfast until 10:00".

### Karşılıklı eşleme

"Giriş ve çıkış saatleri 15:00 ve 11:00'dir" → giriş 15:00, çıkış 11:00. Eskiden iki saat de çıkış saati okunuyordu.

### Ev sahibi raporu

"Uyuşmayan saatler" artık son kabul çelişkisini de gösterir. Bunun için kalemin bütün cümleciklerindeki saatler hesaba katılır.

## Bilinen sınırlar (bilinçli)

- **Okunmayan belirsiz saatler:** "saat 3" ve "3'te" okunmaz, çünkü 03:00 mü 15:00 mü belli değil. Bu kural eskiden beri var.
- **Noktalı yazım:**
  - "22.10" saat olarak kalır;
  - "15.05" gibi 5'in katı bir noktalı yazım, aralığın öbür ucu geçersiz değilse saat okunur.
- **Paranteze alınmış koşul:** Saatsiz parantezdeki "(subject to availability)" dışarıdaki saati erken giriş yapmaz. Şüphede çelişki gösterilir ve ev sahibi düzeltir; bu, gerçek çelişkiyi kaçırmaktan iyidir.
- **Koşul sayılmayan ifadeler:** "on request", "talep üzerine" ve "nach Absprache" koşul sayılmaz. Çok yaygınlar ve çoğu zaman standart saatle aynı cümlede yazılıyorlar.
- **Genelleme için yeni batarya gerekir:** Bu batarya ayarda kullanıldı, yani artık "görülmüş" sayılır. Dürüst bir genelleme sayısı için yeni bir kör batarya gerekir (ayrı tur).

## Mutasyon

Sonuç bir sonraki raporda.

- Koşu: 70 mutant, `/tmp/…/mut-207.json`, commit `e344cc6`.
- Mutasyon koşucusu, ajanların önbellek ölçümü sürerken başka vitest koşusuyla çakışmamak için beklemede.
