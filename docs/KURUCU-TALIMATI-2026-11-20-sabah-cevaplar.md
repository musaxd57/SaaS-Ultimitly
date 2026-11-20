# Kurucu talimatı — 20 Kasım sabah (gece raporuna cevaplar), AYNEN

> Kurucunun cevapları aşağıda değiştirilmeden. Bir kısmı kurucunun aktardığı Codex görüşüdür ("codex yazdı"); kurucu son kararı Claude'a
> bıraktığı yerleri açıkça yazdı. Sorular: `scratchpad/sorular-1120-sabah.md` (gece) — burada her cevabın önünde sorunun kısa adı var.
> Bu işte her dilimden ÖNCE bu dosya okunur.

---

## Ö-1 · QR'da model düşünürken iptal edilen konaklama
Seçim: **Cevap gitmesin (Önerilen)** — misafire bugünkü "Şu an bu daire için aktif bir konaklama görünmüyor; sohbet kapalı." metni, misafirin
mesajı ev sahibine iletilir.

## G-3 · Fikir akışı F-1…F-4 (kurucunun yazdığı, aynen)

F‑4 · Gereksiz okumayı kaldır, güncellik kontrolünü değil
“Mesaj başına tek sorgu” hedefi koymazdım. Hedef, aynı aşamada aynı konuşma bilgisini boşuna tekrar okumamak. QR ile başlardım: rapordaki 5–6 okumanın hangileri aynı bilgiyi tekrar getiriyor, hangileri model beklerken değişebilecek bir şeyi kontrol ediyor, önce bunu ayıralım.

İlk aşamada konuşma ve gerekli bağlam topluca yüklenip yalnız o işlem içinde paylaşılabilir. Ama model düşünürken host konuşmayı devralabilir, misafir yeni mesaj yazabilir veya rezervasyon iptal olabilir. Gönderimden önce bu değişkenler tekrar doğrulansın. Sırf sorgu sayısı düşsün diye bu kontrolü kaldırmak ya da model çağrısı boyunca veritabanı işlemini açık tutmak yanlış takas. Başarı ölçüsü: daha az sorgu, daha düşük p95 gecikmesi ve eşzamanlı değişiklik testlerinde aynı doğruluk. Bunu ölçmeden Redis eklemezdim. 

Karar ekranında dördünü de seçip şu notu düşerdim: “F‑1 ve F‑3 ayrı değişiklikler olarak ilerlesin. F‑4 önce QR’da ölçülsün; gönderim öncesi güncellik kontrolleri korunsun. F‑2 mevcut iki ekranla sınırlı başlasın. F‑1’de doğrudan yol ile kuyruk arasında misafire giden bir fark bulunursa, yeni davranışa karar vermeden önce örneğini bana gösterin. codex böyle yazdı mantıklı mı söylüyor,F-1 tek karar fonksiyonu,F-3 uyarı kovası rota başına,F-4 mesaj başına tekrar okumaları azalt,F-2 geç dönen okuma yardımcısı

## B-1 · "İki dairede kayıtlı" Dikkat satırı (kurucunun yazdığı, aynen)

Aynı rezervasyon birden fazla dairede görünüyor
Sahil Evi · Lale 5 · Giriş: 5 Ara
Otomatik gönderim durduruldu · Kayıtları karşılaştır

Küçük ama önemli fark: “Mesajlar bekletiliyor” fiilen sırada mesaj varmış ve sorun çözülünce mutlaka gidecekmiş gibi anlaşılabilir. “Otomatik gönderim durduruldu” ise yalnız bu rezervasyon için gönderim gerçekten engelleniyorsa gösterilsin. Eski mesajları sonradan gönderme sözü vermesin.

## E-1/E-2/E-4/E-5 · Anlamsal arama bütçesi (kurucunun yazdığı, aynen)

İşletme başına saatte 600, toplamda 2.000 parça ve 20 saniye bekleme ile başlayalım. Bekleme yalnız arka plandaki vektör üretimi için olsun; bilgi tabanı kaydı hemen güncellensin. Art arda düzenlemede yalnız son sürüm işlensin. Bütçe dolarsa iş kaybolmasın, sonraki uygun zamanda devam etsin. Kalıcı depo, şema ve güncellik testleri geçince önce sınırlı bir pilotta açılsın. 

Yayın öncesi iki test isterdim:
1. A işletmesi büyük dosya işlerken B’nin yeni düzenlediği bilgi tabanı kaydı da makul sürede işleniyor. B’nin hazır vektörleriyle arama yapabilmesi tek başına yeterli test değil.
2. Host Wi‑Fi şifresini değiştirir değiştirmez eski şifre artık gönderilmiyor. Yeni vektör hazır değilse güncel kayıtta sözcüksel arama yapılıyor.
Aylık 4 dolar bir tahmin, bütçe garantisi değil. İlk hafta benim izleyeceğim sayı “bir KB değişikliği anlamsal aramaya ne kadar sürede yansıyor?” olurdu. Limiti buna göre ayarlarız. codex yazdı

## G-1 · Girişler: kuyrukta gönderilemeyen giriş mesajı
Seçim: **"gönderilemedi" (Önerilen)** — "Otomatik giriş mesajı gönderilemedi · giriş bilgisini siz gönderin" + elle gönderim düğmesi.

## E-3 · Yeni bilgi vektörleşmeden, sözcüksel eşleşme de yokken (kurucunun yazdığı, aynen)

Vektör hazır değil veya kelime eşleşmedi diye cevabı otomatik tutmayalım. Önce mevcut anlama ve getirme akışıyla doğru dairenin güncel, yetkili kaydını vektörsüz bulmayı deneyelim. Güncel dayanak varsa cevap verilebilir; dayanak yoksa ya da çelişkiliyse tahmin gönderilmesin. Önce gönderimi değiştirmeden ölçelim: Kaç doğru cevap korunuyor, kaç yanlış veya eski cevap engelleniyor, kaç doğru cevap gereksiz tutuluyor? Şifre değişimi, kelimesiz parafraz, başka daire ve kuyruktayken ikinci değişiklik ayrı vakalar olsun. Sonucu görmeden otomatik gönderim davranışını değiştirmeyelim 
güncel kaydı vektörden bağımsız bulabilmek ve son gönderimi o kaydın sürümüne bağlamak olurdu.
codex yazdı mantıklı mı konuşuyor sen daha iyi biliyorsan söyle son karar sende en iyi fikri uzun vadeli gelişmiş fikri uygulamayalım.

## Ş-2 · Şablon sınırına yaklaşınca uyarı
Seçim: **Evet, 450'de uyarı** — Şablonlar sayfasında "Özel şablon sınırına yaklaşıyorsunuz (450 / 500)." gibi bir satır.

## B-2 · "Rezervasyonu aç" (kurucunun yazdığı, aynen)

Doğrudan rezervasyonu açsın (önerim). Önce sade bir rezervasyon detay ekranı tasarlansın. Daire, tarih, durum ve kayıt kaynağı görünsün; “Beklemede” kayıtlar da açılsın. Mesajlar ve görevler daha sonra eklenebilir. bu kısmı bana daha iyi açıkla son çıktında
