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

## 5. Kurucu 11-04 öğleden sonra (aynen özet — yarıda kalmasın)

### 5.1 Öncelik
- **"HAİKU VE 5.1 İÇİN ÖNCELİĞİMİZ BU"**: 5.1'in yerine Haiku 5.5'i alacağımız senaryolar. Karar metni yazıcısında Haiku neredeyse 5.1 ile eşit ve
  10× ucuz → gerçekten kaybımız yoksa Haiku'ya geçilir; Haiku'nun hatalı olduğu yerler düzeltilir, ona göre geliştirilir.
- Çalışma biçimi: "uzun uzun, acele etmeden; kapıları beklerken paralelde bozmadan yapabileceğin işleri yap, didik didik düzelt; çıktı vermek için
  acele etme." Codex önerileri yalnız öneri, son karar Claude'da; müşteriye gidecek, garip ya da kurucunun dediğiyle zıt bir durum varsa kurucuya sorulur.

### 5.2 Anlama katmanı — arıza ↔ kullanım (kurucunun kararı, onay için önce/sonra testleri istiyor)
| Mesaj | Beklenen |
|---|---|
| "Tost makinesi ısınmıyor." | Mevcut arıza bildirimi; host'ta açık iş |
| "Tost makinesi ısınmazsa ne yapmalıyım?" | Varsayımsal kullanım sorusu; kendiliğinden arıza açılmaz |
| "Isınmıyordu ama şimdi düzeldi." | Aktif arıza gibi değerlendirilmez |
| "Isınmıyor; çöpleri nereye atıyoruz?" | Arıza host'ta kalır, bağımsız çöp sorusu cevaplanabilir |
| "Isınmıyor, prizden duman çıkıyor." | Kullanım sorusu değil; tehlike akışı |

"Arızayı tanımakla misafire hangi cevabın gönderilebileceği ayrı kararlar." Mevcut arıza bildirimini kullanım sorusundan ayırmak uygun; AMA "her
zaman şikâyet" sabit sözcük kuralına DÖNÜŞMESİN — varsayımsal, olumsuzlanan ve çözülmüş durumlar bağlamdan ayrılsın. Arıza host'ta açık kalırken
bağımsız güvenli sorular cevaplansın, mevcut onaylı kullanım yardımı kuralları korunsun. Bu ayrımları ve KONUŞMA GEÇMİŞİNİ içeren önce/sonra testleri
görülünce davranış değişikliği onaylanacak.

### 5.3 Codex — K-3 görüşü (öneri)
- Sabit 10 dk susturma kalıcı yöntem olmasın: (a) bağımsız sorular gereksiz bekler, (b) 9:59'da gelen soruya 1 sn sonra AI girer; beklemeyi yeni sorudan
  başlatmak her soruya +10 dk ekler. "Host yakın zamanda yazdı" sinyali ile "bu soru ne kadar bekler" kararı AYRI olmalı.
- Öneri: kısa host önceliği (başlangıç 90 sn, ölçülecek) + ihtiyaç bazında sorumluluk + gönderim öncesi güncellik. Host soruyu tamamen cevapladı →
  aynı soruya ikinci AI cevabı yok. "TV ile ben ilgileniyorum" → TV işi host'ta, konuşma devralınmış sayılmaz. Host bu arada o soruyu cevaplarsa bekleyen AI
  cevabı kalkar; başka konuda yazdıysa bağımsız sorunun beklemesi başa sarılmaz. Tehlike değerlendirmesi / uyarısı beklemeye takılmaz. Bekleme mesaj
  sayısına değil cevaplanmamış İHTİYACA bağlı ("?" eklemek süreyi yeniden başlatmaz).
- Netleştirmeler: "dış kanaldan cevaplandı" bütün açık öğelere değil, host mesajıyla ilişkilendirilen öğelere; kapsam belirsizse iş AÇIK kalır. "Bir daha
  cevaplamaz" kalıcı yasak değil (misafir "anlamadım" derse yeni ihtiyaç). "Host'la çelişmez" körü körüne itaat değil (yanlış daire / çelişen saat /
  güvenlik → AI tartışmaz, host'a bırakır; tek mesaj bilgi tabanını değiştirmez). Cevap ≠ ilgilenme ≠ çözme.
- Teknik temel: önce kayıt + eski AI cevabını geçersizleştirme, SONRA anlam analizi (aralık bırakılmaz; host'un kendi taslağı silinmez). Mesaj kökeni
  ayrılır (bizim AI cevabının geri senkronu / otomatik şablon / gerçek host) — sağlayıcı kimlikleri + kendi gönderim kayıtlarımız. Gönderim öncesi
  güncellik. Bekleme sunucuda kalıcı; süre dolması yalnız YENİDEN DEĞERLENDİRME başlatır, "gönder" izni vermez. Devral / güvenlik engeli / belirsiz
  gönderim bekleme bitince kalkmaz. Gölgede 90 / 180 / 600 sn kıyası (gereksiz bekleme, tekrarlanan cevap, host'un üstüne konuşma, yanlış kapanan ihtiyaç);
  AI önce cevapladığı için host'un susması "host cevaplamazdı" kanıtı değildir.

### 5.4 Codex — K-5 şartları + host talimatı
- İlk host bildirimi 15 dk beklemez (yeniden değerlendirme ilk uyarının yerine geçmez). +1/+5/+15 başlangıçtan sayılır, kalıcı iş kaydı. Teknik hata ile
  anlam belirsizliği ayrılır (aynı belirsiz metni "tehlikesiz" diyene kadar sormak güvenli değil; kasıtlı kapatılmış model anahtarı tekrarla aşılmaz).
  Eski değerlendirme yeni durumu ezmez (host müdahalesi, yeni mesaj, başka açık tehlike yeniden okunur; yalnız ilgili engel koşullu kapanır). Hâlâ
  belirsizse tek açık inceleme işi; ayrı / ağırlaşan tehlike "tek bildirim" bahanesiyle bastırılmaz. Engel kalkınca eski taslak gönderilmez, yeniden hazırlanır.
- Host talimatından önizleme + açık Gönder mantıklı; ama ortak gönderim kapısı ayrışmalı: AI duraklatılmışken host'un kendi cevabı engellenmemeli;
  ortak yetki / hedef kontrolleri korunurken otomasyon kuralları insanın onayladığı gönderime körlemesine uygulanmamalı.

### 5.5 Codex statik denetimi (commit `4dc06404`) — 14 bulgu (öneri; doğrulanıp düzeltilecek)
| # | Öncelik | Bulgu | Yer |
|---|---|---|---|
| 1 | P1 | Gecikmiş `transaction.payment_failed` güncel ödeme bekleme kilidini koşulsuz siler → başarılı ödemenin koruması kalkar, çift ödeme riski (Paddle olayları sırasız gelebilir) | `api/webhooks/paddle/route.ts:843` |
| 2 | P1 | Senkron eski okumayla (pending) host'un iptalinden sonra `confirmed` yazar → iptal geri açılır (G9 eski anlık görüntüye bakıyor) | `lib/ingest/write-service.ts:189/225` |
| 3 | P1 | Doğrudan gönderim tamamlanınca koşulsuz `answered` → arada gelen yeni misafir mesajı / Sorunlu / Tamamlandı ezilir (elle + AI; kuyruk yolu korumalı) | `lib/host-send.ts:140,161` · `lib/automation.ts:4224` |
| 4 | P1 (kuyruk açıksa) | Kuyruktaki AI cevabı rezervasyon iptalinden sonra gönderilebilir (gönderim anı vetosu rezervasyonu okumuyor) | `lib/outbox/worker.ts:485` |
| 5 | P2 (ödeme niyeti bayrağı) | Süresi dolmuş niyet temizliği ödemeyi bulsa da çağıran yeni işlem açar | `lib/billing/checkout-intent.ts:128/165` |
| 6 | P2 | Eski KB sekmesi (yalnız başlık değişse de) yeni içeriği geri yazar — sürüm denetimi yok | `api/kb/[id]/route.ts:88` |
| 7 | P2 (QR) | Kapı sırrı taraması `A7B9` / `123` biçimlerini kaçırır; adresten modele gider, son tarama yakalamaz | `lib/guest-chat.ts:606-620` · `api/chat/[token]/route.ts:1057` |
| 8 | P2 | Operatörün yarım 2FA temizliği arada etkinleşen faktörü siler, oturum sürümü artmaz | `api/admin/reset-2fa/route.ts:78-111` |
| 9 | P2 | Gece yarısı tarih kayması: düzenlenen AI önerisindeki eski "yarın" + WhatsApp önizlemesi "yarın" tazeliği | `lib/ai-suggestions/act.ts:132,145` · `lib/host-channel/answer.ts:951` |
| 10 | P2 (WhatsApp) | Kabul sonrası başarısız olan bilgi / karar bildiriminin e-posta yedeği yok (yalnız `alert`) | `lib/host-channel/alert-email.ts:103` |
| 11 | P2 | Rezervasyon tarihi değişirken eşzamanlı görev üretimi eski güne temizlik yazar; söz kapatma uzatılan konaklamanın sözünü iptal eder (bayraklı) | `lib/automation.ts:1343` · `lib/guest-commitments-auto.ts:280` |
| 12 | P2 | Eşzamanlı farklı KB işlemleri plan sınırını aşar | `api/kb/route.ts:79` · `[id]/route.ts:65` · `[id]/copy/route.ts:252` |
| 13 | P2 (koşullu) | Kardeş alan adından aynı-site POST'lar hesap güvenliği kotalarını tüketir (crossSiteWrite yok, içerik türü kotadan sonra); OAuth durum çerezi imzasız / öneksiz | `api/account/{2fa,password,delete}` · `lib/hospitable-oauth.ts:21,106` |
| 14 | P3 (bayraklı) | Aynı mesaj gece yarısının iki yanında eşzamanlı işlenirse çift görev (günlü kilit anahtarı) | `lib/tasks/create.ts:58` |
