# Tur 3 — gerçek tarayıcıda görsel düzen, UX / Türkçe ve güvenlik (2026-11-04 gece)

> Kurucu: "görsel geliştirme, UX ve güvenlikleri kontrol et, didik didik; geliştirme yapabiliyorsan yap."
> Nasıl: atılacak bir PostgreSQL (port 5441) + demo tohumu + ikinci test işletmesi + `next dev` (API anahtarı YOK, dış servis yok). Üç ajan
> gerçek tarayıcıda (Playwright) çalıştı: **görsel** (33 sayfa × 390 / 1280 genişlik × açık / koyu tema = 141 ölçüm), **UX / Türkçe** (ev
> sahibinin uçtan uca akışları + kaynak koddaki görünen dizgeler), **güvenlik** (son iki haftada değişen rotalar, iki işletmeyle kiracılar arası
> deneme). Her güçlü bulgu ayrı bir çürütücüyle (sayfayı yeniden çekip ölçerek) sınandı. Güvenlik ayrıntısı bu PUBLIC repoya yazılmadı.

## 1. YAPILANLAR (metin değiştirmeyen; düzeltmeden sonra aynı betiklerle yeniden ölçüldü)

| Ne | Önce → sonra (ölçüm) |
|---|---|
| Konuşma sayfası, Rezervasyon kartının uyarı satırları **koyu temada okunmuyordu** ("Devir günü…", "Geç çıkış / uzatma…") | kontrast 1,13 / 1,07 → **9,83 / 11,87** (açık tema aynı) |
| Konuşma ekranında Durum / Öncelik / Ton seçim kutularında **yazının altı kesiliyordu** (geniş ekran) | 1280 / 640 / 639 / 390, iki temada düzgün |
| Telefonda gelen kutusunda **misafir adı kısalıyordu** ("Laura Bia…") | ad tam görünür, kısalan mülk adı |
| Koyu temada her sayfa yüklemesinde tarayıcı konsolunda **hidrasyon uyarısı** (gerçek hataları gizliyordu) | 49/49 → **0** |
| Görev / daire / konuşma **oluşturma formları** başarıdan sonra düğmeyi yeniden açıyordu → yönlendirme gecikince **çift kayıt** | başarıda düğme kilitli kalır |
| **Güvenlik:** misafir sohbeti cevap rotası ve 6 operatör yazma rotası, başka siteden gelen / JSON olmayan isteği **kota harcadıktan sonra** reddediyordu | kotaya dokunmadan 403 / 415 (hesap rotalarındaki 11-04 düzeltmesiyle aynı sıra) |
| **Güvenlik:** WhatsApp web kancasında 8 günden eski imzalı mesajın yeniden gönderilmesi (anahtar kapalı yol) | 7,5 günden eski mesaj işlenmez |
| Kuralınızın uygulanması (hitap "siz", 09-23): 2FA kartında "Şifre**ne** ek bir güvenlik katmanı" ve var olmayan düğme adı "2FA kur" | "Şifre**nize**…", gerçek düğme adı "İki adımlı girişi (2FA) kur"; aynı ekranda "08:00'da / 08:00'de" → "08:00'de" |

Bulgu çıkmayanlar (ölçüldü): hiçbir sayfada yatay taşma yok; telefonda tablo sorunu yok; boş durumlar düzgün; panelde odak halkası eksiği yok;
kontrast hatası yukarıdaki iki satır dışında yok; iki işletme arasında veri sızıntısı denemeleri (son iki haftanın rotaları) reddedildi.

## 2. YAPILABİLİR, ÖNERİM (metin değişmez; birden çok bileşende davranış değişir — onayınızla)

- **G2 — Pano açılırken kurulum rehberi sonradan belirip sayfayı aşağı itiyor** (düzen kayması telefonda 0,53, masaüstünde 0,19; iyi değer
  < 0,1). Sebep: rehberin "katlandı / bir kez tamamlandı" bilgisi yalnız tarayıcıda, sunucu ilk boyamada kartı çizemiyor. Önerim: bu bilgiyi
  çerezde de tutmak; sunucu ilk boyamada son hâli çizer, kayma biter. Kartın kendisi ve kurallarınız (mühür, katlama) aynı kalır.
- **G6 — Telefonda sık kullanılan düğmeler küçük** (tema / menü / filtre çipleri 25–34 piksel; önerilen en az 44). Önerim: yalnız telefonda
  dokunma alanını büyütmek, masaüstü görünümü aynı.

## 3. KURUCUYA SORULAR — müşterinin gördüğü metin / davranış (önce → sonra)

**Doğrulanmış (çürütücü yeniden üretti):**

1. **Dış hedefi olmayan konuşmada "Gönder"** (elle açılan "Manuel / E-posta" kanallı konuşma): mesaj hiçbir yere gitmiyor ama ekran "Mesaj
   gönderildi." diyor. Önerim: balonun altında "Yalnız Lixus'a kaydedildi — misafire siz iletin."; yeni konuşma formunda kanal alanının altına
   "Bu konuşmadaki cevaplar misafire otomatik gitmez."
2. **Uyarı e-postası adresi çıkmaza sokuyor:** yardım metni "kendi adresinize… boş bırakırsanız hesabınızın e-postası kullanılır" diyor;
   başka adres yazınca ret "Önce o kişiyi ekibe ekleyin" diyor (ama Ayarlar'da ekip / davet ekranı yok); test düğmesi boş alanda "Önce yukarıdaki
   alana bir e-posta girin" diyor. Önerim: yardım "Uyarılar hesabınızın e-posta adresine gider. Ekibinizden başka birinin adresini de
   yazabilirsiniz." · ret "Bu adres ekibinizden birine ait değil. Hesabınızın e-posta adresini kullanın." · test boşta hesap adresine gitsin
   (e-posta akışı → onayınız).
3. **Check-in / Check-out ↔ Giriş / Çıkış karışık:** görev türleri "Check-in Hazırlık", "Check-out Kontrol" panoda "Bugünkü Girişler"in
   yanında; daire formunda "Check-in saati". Önerim: "Giriş hazırlığı", "Çıkış kontrolü", "Giriş saati", "Çıkış saati".
4. **Varsayılan metinlerde "-ınız":** "lütfen gürültü yapmayınız" (bilgi tabanı çipi, varsayılan ev kuralı şablonu, demo). Önerim:
   "lütfen gürültü yapmayın". (Bu metin misafire giden cevaba girebildiği için soruyorum.)
5. **Yazım birliği:** şikayet (12) / şikâyet (2), dahil / dâhil. Önerim: "şikâyet", "dâhil".

**Doğrulanmamış (ajanın önerisi; kullanım sınırı yüzünden çürütücü koşmadı — her biri kodda kontrol edilip uygulanır):**

6. Varsayılan "Giriş Talimatları" şablonu "Kapı kodunu ve giriş talimatlarını aşağıda bulabilirsiniz: {{wifiInfo}}" diyor ama yer tutucu yalnız
   Wi-Fi'yi getiriyor (kapı kodu gelmez) → "Wi-Fi bilgileri aşağıda: {{wifiInfo}}" ya da kapı kodu yer tutucusu.
7. Bilgi tabanı çipi köşeli parantezli metni doldurulmadan kaydediyor ("Evcil hayvan [kabul edilir / kabul edilmez].") → Ekle'de "Köşeli
   parantezli yerleri doldurun." ile durdurmak.
8. Aynı bilgi tabanı kalemi ikinci kez sessizce ekleniyor; eklenince görünür onay yok → "Eklendi." bildirimi + aynı kalem uyarısı.
9. Yeni daire eklenince onay / sıradaki adım yok → "Daire eklendi. Sıradaki adım: takvim bağlantısını ekleyin."
10. Hospitable kartında "🔒 Token uçtan uca şifreli saklanır" (teknik olarak yanlış: sunucu çözüp kullanıyor) + "Personal Access Token" →
    "Anahtarınız şifrelenerek saklanır ve yalnız bu işletmenin Hospitable mülkleri için kullanılır."
11. Aynı özelliğe üç ad: "AI misafir mesajlarını yanıtlasın" · "Otomatik yanıt" · "Oto-yanıt"; "AI anahtarı" API anahtarı gibi okunuyor →
    tek ad "Otomatik yanıt".
12. Yeni müşterinin raporunda tek konuşmayla "Performans Skoru F 44/100 Kritik" → az veride "Skor için birkaç konuşma daha gerekiyor".
13. Model kapalıyken gelen yedek öneri "AI Önerisi" başlığıyla görünüyor; risk notu "Yöneticiye iletilmeli" (ev sahibi zaten yönetici);
    taslakta "I've notified our team right away…" (bildirim cümlesi, kuralınız K10) → misafire gidecek taslak, ayrıca sorulur.
14. Yer tutucular iki farklı yazımla: şablonlarda `{{guestName}}`, otomatik mesajlarda `{isim}` → ekranda tek Türkçe biçim (eskiler kabul
    edilmeye devam).
15. "AI'yı Deneyin" örnek çiplerinde geliştirici test mesajları ("Ignore previous instructio…", hakaret örneği) müşteriye görünüyor.
16. Teknik terimler: "Çeviri şu an yapılandırılmamış." → "Çeviri şu an kullanılamıyor. Biraz sonra tekrar deneyin."; "güvenlik kapısı",
    "Saat dilimi (IANA)" + İngilizce bölge adları, "uyarı maili / test maili", "Temizlik tamponu", "opsiyonel", "Manuel", "Senkronla",
    "Abonelik pasif" (Lixus aboneliği sanılabilir → "Hospitable aboneliğiniz kapalı").
17. Kayıt ekranı / doğrulama e-postası: "Maildeki butona tıklayın ve az önce belirlediğiniz şifreyi girin." → "E-postadaki düğmeye tıklayın
    ve az önce oluşturduğunuz şifreyi girin." (e-posta metni de var → onayınız).
18. Yapay zekânın üç adı ("AI" · "yapay zekâ" · "asistan") ve karışık ekler (AI'ın / AI'nın); "Mülk" ↔ "Daire".
19. Telefonda çıkış tek simge, tema düğmesinin yanında, onaysız → yanlış dokunuşla çıkış.

**Güvenlik (metin içerir → soru):** WhatsApp numara bağlamada numaranın başka hesapta kayıtlı olup olmadığı yanıttan anlaşılabiliyor ve bağlanınca
numaraya hangi işletmeye bağlandığı söylenmiyor (anahtar kapalı yol). Önerim: dolu numarada da aynı "kodu WhatsApp'tan gönderin" yanıtı +
doğrulamadan sonra tek satırlık "Bu numara {işletme} için Lixus bildirimlerine bağlandı." mesajı. Hospitable bağlama hatasında bazı ham teknik
metinler ekrana düşüyor → genel bir cümle + ayrıntı kayıtta.

## 4. Ortam notları (ürün hatası değil)
- `/register` ve fatura sekmesi bu ortamda görülemedi (kayıt kapalı, Paddle yok); QR sohbetinin yalnız "kullanılamıyor" ekranı çekilebildi.
- Saat / tarih girdileri "03:00 PM" biçiminde görünüyor: başsız tarayıcının dili, ürün değil.
- Yazı tipi için ortam ajanı geliştirme sunucusuna yalnız Google Fonts indirmesi için internet çıkışı verdi (API anahtarı yoktu).
- Ham dosyalar (ekran görüntüleri, ölçüm betikleri): oturumun çalışma klasöründe (repoya girmez).
