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
