# 2. dalga bulguları — kodla doğrulama ve düzeltme takibi (10-21 gece)

Claude Sonnet 5.5 bulguları (86 P2 yeniden doğrulama + 32 arayüz) → 4 Haiku 5.5 ajanı her birini kodla yeniden doğruladı. Kural: ajan önerisi
karar değildir; müşteriye giden mesajı / metni / parayı değiştiren düzeltme kurucuya önce/sonra örnekli sorulur. Tutucu yönde (güvenlik
okuyucusunun acili / tutmayı ARTIRMASI, yanlış daire verisinin gitmemesi, bayat cevabın gitmemesi — N1 kararı) düzeltme yapılır.

## P2 (Claude "doğrulandı" dediği 40 → Haiku: 23 doğrulandı · 15 kısmen · 2 çürütüldü)

| # | konu | Haiku | karar | durum |
|---|---|---|---|---|
| 18 | gaz alarmı: "çalışmıyor VE ötüyor" olumsuzlama sayılıyor | doğrulandı, yüksek | düzelt (tutucu) | |
| 53 | gaz alarmı: cümlenin herhangi yerindeki "if/wenn" bildirimi varsayım yapıyor | doğrulandı, yüksek | düzelt (tutucu) | |
| 78 | "does smoke / could smoke" sigara alışkanlığı sayılıp duman bildirimi düşüyor | doğrulandı, yüksek | düzelt (tutucu) | |
| 21 | eşleşmemiş düz tırnak (inç) arası tehlike cümlesini siliyor | kısmen | düzelt (tutucu) | |
| 69 | "bilgim, maalesef, yok" virgülle kaçıyor | doğrulandı | düzelt (tutucu: bilgim-yok misafire gitmez) | |
| 70 | acil numara: "hote" kökü "hotel"i ev sahibi anlaşmazlığı sayıyor (anahtar KAPALI) | doğrulandı, gizli | düzelt | |
| 95 | yaşam döngüsü metni yenilenirken başka dairenin rezervasyonu seçilebiliyor | kısmen, yüksek | düzelt (yanlış daire verisi gitmez) | |
| 96 | 402 ile bekleyen AI cevabı günler sonra gidiyor | doğrulandı | düzelt (N1 kararıyla aynı: bayat cevap gitmez) | |
| 11 | CSV içe aktarım anonimleştirilmiş satıra adı geri yazabiliyor | doğrulandı, KVKK | düzelt | |
| 43 | CSV "0.500" tutarı 500 okunuyor | doğrulandı | düzelt | |
| 12 | fatura `paidAt` olay zamanı değil işleme zamanı | doğrulandı | düzelt | |
| 4 | QR cevabı kaydı düşerse sahiplenme bırakılmıyor (sahte "az önce gönderildi") | doğrulandı | düzelt | |
| 2 · 8 · 9 · 7 · 0 · 27 · 23/83 · 31 · 32 · 30 · 29 | iç yarış / hata kodu / gizli kusurlar | doğrulandı / kısmen | düzelt (iç) | |
| 60 · 58 · 65 · 81 · 82 · 90 | savunma derinliği / gölge ölçü / karesel kalıp | doğrulandı / kısmen | düzelt (iç) | |
| 16 | "late check-in" geç çıkış, "early check-out" erken giriş sayılıyor (yedek şablon) | doğrulandı | **kurucuya soru** (misafire giden şablon değişir) | |
| 15 | "key" / "tv" alt dize eşleşmesi ("Turkey" → giriş saati şablonu) | doğrulandı | **kurucuya soru** | |
| 22 | "!!" soru sayılıyor, çok-soru ipucu açılıyor | doğrulandı | **kurucuya soru** (cevap biçimi) | |
| 14 | öznesiz "can't find" bilgim-yok sayılıyor (gereksiz tutma) | doğrulandı | **kurucuya soru** (gevşetme) | |
| 28 | 2 harfli alt sorgular ("tv", "ac") getirmeden düşüyor | doğrulandı | **kurucuya soru** (getirme değişir) | |
| 26 | parola en az uzunluk NFC değil ham uzunluk | doğrulandı | **kurucuya soru** (kimlik akışı) | |
| 41 · 44 · 51 · 42 | `lastMessageAt` = şimdi · silme TOCTOU · yükleyici org süzgeci · ICS saati | kısmen | sonraki tur (ulaşılabilirlik ölçülecek) | |

## Arayüz (32 → Haiku: 21 doğrulandı · 2 kısmen · 9 çürütüldü; sunucu tarafı güvenlik açığı YOK — destek görünümü sunucuda salt-okunur)

| # | konu | karar | durum |
|---|---|---|---|
| P1-a | Ayarlar otomatik mesaj kartları metnin "Bilgi Tabanı"nda olduğunu söylüyor (T4'ten sonra yanlış) | düzelt (T4 kararının tutarlılığı; yalnız yönlendirme) | |
| P1-b | "Ödemeniz işleniyor" kilidi sunucu durumu değişince açılmıyor | düzelt | |
| 2 · 6 · 7/21 · 12 · 22 · 23 · 24 · 10 · 19 · 13 · 25 · 1 · 4 | arayüz durum / çift gönderim / hata dalı | düzelt | |
| 3 · 5 · 8 · 9 · 11 · 14 | operatör paneli / nadir | sonraki tur | |


## Durum (10-21 gece, bu tur)

**Düzeltildi + testli (kırmızı-önce + mutasyon 17/18, 1 gerekçeli eşdeğer):** #18 · #53 · #78 · #21 · #69 · #70 (güvenlik okuyucuları, tutucu) ·
#95 (başka dairenin kapı kodu gidebiliyordu — gerçek PostgreSQL testi eski kodda kırmızı) · #11 (KVKK: anonim satıra ad geri yazımı, yarış
testi) · #43 · #12 · #4 · #58 · #65 · #81 · #82 · #29 · #32 · #60 · #90 (eşdeğer, süre pinli) · arayüz P1-a (Ayarlar yönlendirmesi) · P1-b
(ödeme kartı kilidi) · #7/#21 (bozuk e-posta bağlantısı). Eşdeğer mutant W1: iptal edilmiş kopyadan metin kurmama koruması — veto metin
kurulmadan ÖNCE iptali durdurduğu için yalnız yarış savunması.

**Sonraki tur (iç, müşteriye dokunmaz):** #2 · #8 · #9 · #7 (KB plan sınırı yarışı) · #0 · #27 · #23/#83 · #31 · #30 · arayüz 2 · 10 · 12 · 13 ·
19 · 22 · 23 · 24 · 25 · 1 · 4 · operatör paneli 3 · 5 · 8 · 9 · 11 · 14.

## Kurucuya sorular (müşteriye gideni / görünen sayıyı / kimlik akışını değiştirir — onaysız uygulanmadı)

**W1 (#16) Yedek şablon "late check-in"i geç ÇIKIŞ sayıyor.** Model düştüğünde kullanılan sabit cevap yolu. Önce: "Can we do a late check-in
around 23:00?" → "Our check-out time is 11:00. A late check-out may be possible…". Sonra: giriş saati cevabı ("Our check-in time is 15:00…").
"early check-out" da erken GİRİŞ sayılıyor. Öneri: yön kelimesine bağla (late check-out / early check-in). Düzeltelim mi?

**W2 (#15) Yedek şablonda kısa anahtar kelime alt dize eşleşiyor.** "Is there parking near the apartment in Turkey?" → "key" kelimesi "Turkey"
içinde bulunup giriş saati şablonu çıkıyor. Öneri: kısa anahtarlar (key, tv, ac) tam sözcük. Düzeltelim mi?

**W3 (#22) "!!" soru sayılıyor.** "Harika!! Süper!!" iki soru sayılıp istemde "birden çok soru var" ipucu açılıyor → cevap gereksiz uzayabilir.
Öneri: yalnız "?" sayılsın. Düzeltelim mi?

**W4 (#14) Öznesiz "can't find" bilgim-yok sayılıyor (gereksiz tutma).** "If you can't find the keys, they are in the lockbox" taslağı "bilgim
yok" sanılıp ev sahibine tutuluyor. Öneri: yalnız birinci şahıs öznesiyle ("I / we can't find"). Bu GEVŞETMEDİR (daha çok cevap gider) —
onay ister.

**W5 (#28) İki harfli alt sorgular getirmeden düşüyor.** "Wi-Fi şifresi ne, TV nasıl açılır?" → yalnız Wi-Fi kalemi getiriliyor, "tv" alt
sorgusu atılıyor. Öneri: 2 harfli içerik sözcüklerini de getir. Cevaba giren bilgi değişir — ölçümle birlikte açalım mı?

**W6 (#26) Parola en az uzunluğu ham UTF-16 uzunluğuna bakıyor.** Ayrık aksanlı (NFD) 7 "ş" 14 sayılıp geçiyor, saklanan biçim 7 karakter.
Öneri: normalleştirilmiş biçimin karakter sayısı. Kimlik akışı → onayınız.

**W7 (#96) Hospitable 402 (abonelik bitti) sırasında kuyrukta bekleyen AI cevabı, abonelik dönünce GÜNLER sonra gidiyor.** N1 kararındaki
"bayat mesaj gitmesin" ilkesinin aynısı. Öneri: 12 saatten eski bekleyen AI cevabı iptal edilir, gelen kutusunda tek not; karşılama / giriş /
çıkış mesajları kendi zaman kuralıyla (değişmez). Saat eşiği sizin kararınız (öneri 12).

**W8 (sonda) Arapça su baskını / prize su damlaması "acil" değil "şikâyet" sayıldı (2/48).** Mesaj ev sahibinde tutuldu ve e-posta gitti, ama
"Sorunlu" işareti ve acil e-postası yok. Öneri: anlama istemine "aktif su baskını ve elektrikli eşyaya su = acil" örneği. İstem değişikliği,
ölçümle — onay?

**W9 (arayüz #6) Raporlar sayfasında "tutulan" toplamı, satırı olmayan üç sebebi de sayıyor** (tehlike, güvence, acil talimat). Öneri: üç
satır ekle ("Tehlike bildirimi" vb.). Ev sahibinin gördüğü sayı / metin değişir.

## Kurucu cevapları (10-21 gece-3) — uygulandı

| # | karar | durum |
|---|---|---|
| W1 | "late check-in" → giriş, "early check-out" → erken ayrılış (yedek şablon; model düşünce zaten misafire gitmiyor) | ✅ `290b161f` |
| W2 | key / tv / access tam sözcük ("Turkey" giriş saati sanılmaz) | ✅ `290b161f` |
| W3 | "!!" soru sayılmaz | ✅ `290b161f` |
| W4 | "bulamamak" yalnız ben / biz / kaynak öznesiyle itiraf; talimat / olgu tutulmaz (+ Haiku: zarf ve ekip öznesi) | ✅ `a50fb374`, `70d72499` |
| W5 | iki harfli alt sorgu (TV) getirilir | ✅ `290b161f` |
| W6 | parola en az uzunluğu NFC karakter | ✅ `290b161f` |
| W7 | kanal kapalıyken (402) bekleyen yapay zekâ cevabı açılınca gitmez, iptal + not | ✅ `f873deb3` |
| W8 | anlama istemine acil tanımı + örnekler → sonda 48/48 acil yolu (önce 46), geliştirme setinde gerileme yok | ✅ `53e87fd1` |
| W9 | raporlarda tehlike / güvence / acil talimat satırları | ✅ `23e359c0` |
| bağlam | "kelime değil bağlam": bilgim-yok bağlam hakemi (anahtar KAPALI) + gerçek ölçüm | ✅ `1feffe55` … `1a7e9d03`, ölçüm `docs/olcum/BAGLAM-HAKEMI-2026-10-21.md` |
