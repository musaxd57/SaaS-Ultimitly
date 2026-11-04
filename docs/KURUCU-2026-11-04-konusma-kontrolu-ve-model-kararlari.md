# Kurucu 11-04 — kararlar ve istekler (sohbette yarıda kalmasın diye aynen özet)

> Kaynak: kurucunun 11-04 mesajı (kendi kararları + Codex'e düşündürdüğü akış). Kurucu notu: "Codex sana emretmiyor, son karar sende;
> mantıklıysa uygula, üstüne geliştir." Müşteriye gideni değiştiren dilimler yine önce/sonra örnekli sorulur (CLAUDE.md).
> İlgili plan: `docs/PLAN-2026-10-31-codex-hiz-acil-ve-model-gecisi.md`.

## 1. Kurucunun açık kararları

| # | Konu | Karar |
|---|---|---|
| K-A1 | Anlık bildirim (web kancası) | **Airbnb Direct / Booking / Vrbo** için kurulur (Hospitable için değil). |
| K-A2 | Panel canlı güncelleme | Bugün tek sunucu; ama doğruluk tek sunucunun BELLEĞİNE bağlı olmaz, ikinci sunucuda baştan yazılmaz. Ayrı Redis / ikinci veritabanı şart değil; PostgreSQL ortak bildirim (LISTEN/NOTIFY) değerlendirilir; bağlantı kopunca panel güncel durumu veritabanından yeniden okur. |
| K-T1 | 3 saat tekrar penceresi | Aynı türdeki her tehlike 3 saat içinde otomatik "aynı olay" SAYILMAZ: olay çözülüp yeniden başladıysa ya da AĞIRLAŞTIYSA yeni uyarı gerekir. |
| K-T2 | Ev sahibi cevabı ≠ çözüm | "Ev sahibi cevap yazdı" ile "tehlike çözüldü, otomasyon açılabilir" aynı şey değildir. Ör. misafir "Prizden duman çıkıyor", host "Gördüm, ilgileniyorum" → AI kendiliğinden normale DÖNMEZ; host olayı çözüldü işaretleyince kalan engeller yeniden kontrol edilip otomasyon açılabilir. |
| K-T3 | Değerlendirilemeyen olası tehlike | Bugün konuşma "Sorunlu" yapılıyor ve model sonra düzelse de yeniden değerlendirme planlanmıyor. İyileştir: sınırlı otomatik yeniden değerlendirme; tehlike çözüldü VARSAYILMAZ; hâlâ belirsizse tek açık iş + bildirim. |
| K-M1 | Cevap katmanı kıyası | **Rakiplerine karşı** (açılış planındaki model: Luna) yeniden koşulacak — 5.1'e karşı kıyas yanlış hedefti. |
| K-M2 | OpenAI anahtarı GitHub'da | Eklendi (Actions sırrı `OPENAI_API_KEY`). İki model aynı koşuda karşılıklı ölçülür. Haiku testlerle gözle görülür iyiyse geçiş **onaylı**; Haiku'nun daha iyi olması için düzenleme yapılabilir. |
| K-M3 | Anlama katmanı | Haiku'nun 5.1'den kötü olduğu yerlerin NEDENİ öğrenilir, ona göre geliştirme; sonra geçilebilir. |
| K-M4 | Karar metni yazıcısı | Haiku daha iyi duruyor; "lütfen bekleyin" eklemesinin nedeni öğrenilir, düzeltilir, **düşünme kapalı** Haiku'ya geçilebilir. |
| K-L1 | Ton | Misafirin kaldığı gün sayısına göre ton — ileride (önemli, unutma). |

## 2. Senaryo → davranış (kurucunun ilettiği hedef tablo)

| Senaryo | Hedef davranış |
|---|---|
| "TV siyah ekran, çöpler nerede?" | TV ihtiyacı host'ta açık kalır; bağımsız çöp sorusu cevaplanabilir. |
| "İade istiyorum; Wi-Fi şifresi ne?" | İade host'a kalır; güvenli Wi-Fi cevabı ayrı değerlendirilir. |
| "Prizden duman çıkıyor!" | Olağan otomatik cevaplar durur, host hemen uyarılır. |
| "Çaydanlıktan buhar çıkıyor, normal mi?" | Bağlam değerlendirilir; yalnız "duman/buhar" kelimesi kalıcı kilit yaratmaz. |
| Olası tehlike var, anlama servisi çalışmıyor | İlgili cevap bekler; sınırlı otomatik yeniden değerlendirme. Tehlike çözüldü varsayılmaz. |
| Bir cevabın dili yanlış / dayanağı eksik | O taslak tutulur; tek başına bütün konuşmayı süresiz kapatmaz. |
| Host "Gördüm, ilgileniyorum" yazdı | Mesaj gönderilir; açık tehlike otomatik çözülmüş sayılmaz. |

## 3. Konuşma kontrolü — kurucunun istediği ("milyarlık", uzun vadeli, en gelişmiş sistem)

Sorun (kurucu): host bir dairede bir mesajda "Sorunlu" dedi → AI susuyor; elle cevap gönderimi de ilgili yolda konuşmayı "Cevaplandı"
yapıyor → host yalnız "İlgileniyorum" yazdığında bile engel kalkabiliyor. "Sorunlu" bir takip işareti olarak kalabilir; otomasyonu gizlice
kapatan anahtar olmamalı. Host bir sorunu işaretlemekle bütün sohbeti devralmış sayılmaz. Host bilerek "sus" dediyse AI'ın susması doğru.

Codex'in önerdiği akış (karar değil, girdi):
- **Üç ayrı gerçek:** açık ihtiyaçlar (TV arızası, havlu, iade…) · konuşmanın kontrolü (otomatik açık / host açıkça devraldı) · gönderim
  engelleri (devam eden tehlike, yetki, geçici teknik sorun). Cevap vermek ≠ arızanın çözülmesi ≠ AI'ın yeniden açılması (PagerDuty'deki
  üstlenme ≠ çözme ayrımı gibi).
- **Üç işlem:** *Yanıtla* (seçilen mesaj/ihtiyaç için yazma; yazarken AI gönderimleri geçici bekler) · *Devral* (kalıcı host kontrolü;
  yalnız yetkili owner/manager açıkça geri verir — model, misafirin "teşekkürler"i ya da süre kaldıramaz) · *AI'ye geri ver* (devralmayı
  kaldırır; diğer engeller yine kontrol; ESKİ taslaklar / birikmiş cevaplar TOPLUCA GÖNDERİLMEZ, yalnız sonraki yeni mesajlar).
  "Çözüldü ve AI'ye geri ver" birleşik işlemi olabilir ama iki şey yaptığı açık olmalı, başka engel varsa çalışmamalı.
- **Durum satırı (ekran):** "Otomatik cevaplar açık → [Devral]" · "Musa devraldı · 14:32 → [AI'ye geri ver]" · "Güvenlik nedeniyle
  durduruldu · Prizden duman bildirimi → [Olayı incele]"; birden çok neden birlikte gösterilir; tehlike kapanınca host'un kendi
  duraklatması yanlışlıkla kalkmaz.
- **Yanıtla oturumu:** sunucuda süreli, yenilenen yazma oturumu (≈20 sn'de bir yenileme; yenileme kesilirse 60 sn sonra geçersiz;
  hareketsiz 90 sn uyarı, 120 sn yalnız yazma beklemesi biter; gönderimde ayrıca 120 sn beklenmez). Sekmeye özel sahiplik (iki sekme ayrı
  kimlik; bayat sekme yenisinin beklemesini kaldıramaz). Yeni misafir mesajı hareketsizlik sayacını sıfırlamaz. Taslak süre dolumunda
  ASLA otomatik gönderilmez / kaybolmaz. Sabit "yeni soru gelince 120 sn beklet" kuralı YOK.
- **Yeni mesaj gelirse (TV + Wi-Fi örneği):** host TV'ye yazarken Wi-Fi sorusu kaydedilir, panelde "1 yeni mesaj"; AI araya girmez; host
  yalnız TV'yi cevaplarsa Wi-Fi cevaplanmış SAYILMAZ; host mesajının sağlayıcı kabulünden sonra konuşma AI kipindeyse Wi-Fi güncel bağlamla
  YENİDEN değerlendirilir (eski taslak körlemesine gitmez). "TV düzeldi" geldiyse görülmemiş güncelleme varken eski taslak sessizce
  gitmez (Help Scout çakışma denetimi gibi). "Prizden duman" yazma beklemesinden bağımsız uyarı üretir.
- **Altta güvenceler:** sürümlü kontrol (her devralma/geri verme sürüm artırır; AI açıkken hazırlanmış cevap geri verildikten sonra
  geçersiz) · bağımsız engeller (yangın kapanınca gaz bildirimi / host duraklatması korunur) · gönderim anı kontrolü (kuyruğa girişteki
  izin yetmez; göndermeden hemen önce kontrol + konuşma + hedef yeniden doğrulanır) · dürüst sınır (sağlayıcıya çıkmış mesaj geri alınmış
  gösterilmez; belirsiz gönderim yeniden açma bahanesiyle tekrar gönderilmez) · kalıcı otorite PostgreSQL (yeniden başlama AI'yı açamaz) ·
  ortak politika (QR, kanal, WhatsApp host cevabı, kuyruk aynı sözleşme; misafir metni / model çıktısı host yetkisi yerine geçemez) · iki
  yöneticinin eski ekrandan birbirini ezmemesi (sürüm koşulu, HTTP If-Match gibi).
- **Durdurma kaydı:** gerekçe + kapsam (hangi mesaj, hangi olay, hangi kanıt; yalnız ilgili ihtiyaç mı, bütün konuşma mı) kayıtlı; host
  neden durduğunu görür. Belirsizlik sınırlı tekrarla yeniden değerlendirilir (sonsuz tekrar / sessiz unutma yok). Devam eden ciddi
  tehlikede SÜRE DOLMASI çözüm sayılmaz; yeni tehlike eski onayla kapanmaz. Otomatik cevap durmuş olsa bile mesaj kaydı, tehlike taraması
  ve gerekli bildirimler sürer (yalnız kelime kontrolünün çalıştığı yola "dolaylı tehlikeyi de anlıyor" denmez — ayrıca ölçülür).
- **Unutulan devralma:** süre sonunda AI açılarak çözülmez; yeni cevapsız misafir mesajı varsa görünür takip + tekilleştirilmiş hatırlatma;
  sessiz konuşmada bildirim yağdırılmaz.
- **Bugünkü fark giderilmeli:** QR'da host cevabı AI'ı duraklatıyor (ayrı işlemle açılıyor); kanalda elle cevabın doğrulanmış teslimi
  konuşmayı "Cevaplandı" yapabiliyor. Kontrol kararının QR, kanal, WhatsApp host cevabı ve kuyrukta ORTAK anlamı olmalı.
- **Geçiş:** mevcut ihtiyaç defteri + kuyruk korunur, küçük sürümlü kontrol kaydı eklenir (migration'dan kaçınılmaz); önce gölgede
  karşılaştırma, sonra kontrollü açılış. Eski "Sorunlu" kayıtlar nedeni belirsiz diye otomatik AÇILMAZ.
- **Kabul testleri:** devralma sırasında çalışan model · kuyruktaki eski cevap · iki yönetici · iki açık tehlike · bağlantı kopması · dış
  kanaldan host cevabı · yeni konaklamaya TAŞINMAYAN kontrol · iki sekme · eski heartbeat · gönderim sırasında yeni mesaj · durdur–yeniden
  aç yarışları (gerçek veritabanı + iki ayrı süreç; ekrandaki durum değil sağlayıcıya gerçekten giden mesaj doğrulanır).
- **Başarı ölçüsü:** yakalanan tehlike + gereksiz durdurma + host müdahalesi olmadan toparlanma + yanlış yeniden açılma + cevapsız kalan
  bağımsız soru oranı.
- İlke: anlamı model değerlendirebilir; kimin yazdığına, beklemenin geçerliliğine ve gönderim sırasına model karar VERMEZ.

## 4. Benim değerlendirmem ve iş sırası

Tasarım belgesi: `docs/TASARIM-2026-11-04-konusma-kontrolu.md` (envanter + karar soruları; kod bu belge onaylanınca). Yapılacaklar:
1. K-T1 tekrar penceresi (QR kritik e-posta tekrar hafızası olayın ağırlaşmasını / yeniden başlamasını bastırmasın) — kod + test.
2. K-M1/M2 ölçüm: Actions'ta iki anahtar; cevap katmanı Luna ↔ Haiku, anlama 5.1 ↔ Haiku aynı koşuda; köprü yalnız ölçülen katmanı
   çevirir, diğer çağrılar iki kolda da gerçek OpenAI'ye gider (adil kıyas). Haiku'nun kaybettiği vakaların neden analizi.
3. K-M4 "lütfen bekleyin" nedeni → istem düzeltmesi → yeniden ölçüm → onaylı geçiş için ürün kodunda Anthropic bağdaştırıcısı.
4. K-T2/K-T3 + §3 konuşma kontrolü: tasarım → kurucu onayı (müşteri akışı + migration) → gölge → açılış.
5. K-A1/K-A2: web kancası (Airbnb Direct / Booking / Vrbo) + PostgreSQL bildirimli panel — tasarım belgesi.
