# Tur 5 — otomatik mesajlar, ev sahibi kararları, pano / rapor sayımları (2026-11-05)

> Nasıl: üç ajan (otomatik yaşam döngüsü mesajları · söz / karar motoru · pano, rapor, görev sayımları) 18 bulgu getirdi; her biri ayrı
> bir **çürütücü** tarafından kodda kendi deneme betiğiyle yeniden üretilmeye çalışıldı (10 çürütücü, veritabanısız). **Hiçbiri
> çürütülemedi**; altısının abartılı kısımları düzeltildi (aşağıda). Müşteriye / misafire giden metni değiştirmeyen ya da sizin önceki
> kararınızı uygulayan düzeltmeler yapıldı; gerisi önce / sonra örnekli soru.

## 1. YAPILANLAR

| # | Ne | Önce → sonra (ölçüm) |
|---|---|---|
| D1 | **Ev sahibinin "hayır"ı otomatik onayla eziliyordu** (Karar Motoru, anahtar kapalı). Ret mesajı turu kapattığı için, misafir "temizlik bittiyse 13:00 olur mu?" diye yeniden sorunca "Daireniz hazır; bugün 13:00 itibarıyla giriş yapabilirsiniz" gidiyordu. | Kalıcı kararınız ("ev sahibinin kartını EZMEZ", tasarım §10) artık turdan bağımsız: aynı konaklamada reddettiğiniz / gönderdiğiniz / başka saati onayladığınız kart varsa otomatik onay **gitmez**, yeni soru size kalır. "Gerek kalmadı" ile kapattığınız kart ve aynı saatin onayı engellemez. |
| D2 | **05:00'ten önceki saat için açılan erken giriş kartı boş kontrol listesi gösteriyordu**: "04:00 erken giriş" kartında önceki misafir 11:00'e kadar içerideyken hiç kırmızı satır yoktu; WhatsApp önizlemesinde "Dikkat" bölümü yoktu. | Kart kontrolleri her zaman koşar: "önceki misafir hâlâ içeride" kırmızı. Otomatik akış aynen (05:00 öncesi geç varış sayılır); kart kipi otomatik onay asla üretmez. |
| D3 | Rezervasyonsuz açılmış kartın onayı komşu konaklamanın kontrollerinde görünmüyordu. | Konuşma rezervasyona bağlanınca kart da bağlanır (onay anında ve sonraki turda). |
| D5 | **Tarih değişikliği kartı hiç kapanmıyordu**: konaklama bittikten aylar sonra da "Karar bekliyor", Dikkat Gerektirenler'de önem 92 ve rozette. | Konaklama bitince "Süresi geçti" (görünen gün aynen). |
| D6 | Erken giriş "başka gün" okuyucusu "Kasım'ın 15'inde", "ayın 15'inde", "16'sında" biçimlerini kaçırıyordu (iki modelin üstüne ikinci savunma hattı). | Tanınıyor; "Ağustos'ta 2 yetişkin", "sabahın 9'unda", "15'te" tanınmaz. Derlem (32.610 dize × iki tarih): fark 4 dize, dördü de gerçekten başka gün. |
| R1 | **Pano "Dikkat Gerektirenler" büyük işletmede bekleyen misafiri göstermiyordu**: adaylar en eski 200 konuşmayla kesiliyordu; 30 günde 200'den fazla konuşma (≈15–20 daire) → cevaplanmış eski konuşmalar tavanı dolduruyordu. | 230 eski + 5 bekleyen: **0 satır → 5 satır**. İki okuma birleşir: en yeni konuşmalar (QR dahil) + en eski açık konuşmalar. |
| R2 | **"Çıkışı yaklaşan misafir cevap bekliyor" satırı Hospitable rezervasyonunda çıkış günü hiç çıkmıyordu** (çıkış D 00:00Z saklanır = İstanbul 03:00; sabahtan sonra "geçti" sayılıyordu). | Tek tarih kuralı: tarih-yalnız çıkış bugün ya da yarın ise "yaklaşan"; saatli kayıt eski 24 saat penceresiyle. |
| R4 | "En Çok Sorulanlar" kartı ham "closing_courtesy 3" kodunu ilk sıraya koyuyordu (kapanış nezaket cevabının iç işareti). | İşaret konu sayılmaz; liste kısalmaz. |
| R5 | Konuşma kartındaki "Devir günü" bandı konaklama başladıktan sonra da geçmiş giriş devrini gösteriyor, asıl yapılacak "çıkış günü yeni misafir giriyor"u gizliyordu. | Yalnız hâlâ yapılacak iş; iki uç da devirse iki satır (metinler aynen). |

Kanıt: her düzeltme kırmızı-önce (eski kodda 11 yeni test kırmızı); mutasyon **21/21** (ilk koşuda 3 mutant yaşadı — D1'in iki emniyeti
birbirini yedekliyordu, D6'nın ay tamlaması sıra-gün ekiyle örtüşüyordu; ikisi ayrı ayrı pinlendi, yeniden koşu 3/3); düzenli ifade en kötü kip
süre pini (D6 için üç yeni ölçüm); tam kapı + build.

## 2. KURUCUYA SORULAR (önce → sonra)

**T5-1 — Google Haritalar bağlantısı otomatik mesajı durduruyor (canlı yol, anahtar gerekmez).** Karşılama / giriş metninde
"…/maps/place/B%C3%BCy%C3%BCkada…" gibi Türkçe harfli bir bağlantı "doldurulmamış alan" sanılıyor: mesaj misafire **gitmiyor**, kartta
anlamsız "%BCy%" uyarısı çıkıyor. (Kadıköy, Beşiktaş, kısa maps.app.goo.gl bağlantıları sorunsuz.)
- Önerim: yalnız BAĞLANTI içinde, "%C3%BC" gibi kodlanmış harfler yer tutucu sayılmaz; bağlantı dışındaki "%WIFI%", "%KOD%de" aynen yakalanır.
- ÖRNEK: "Konum: https://www.google.com/maps/place/B%C3%BCy%C3%BCkada" → **önce:** mesaj gitmez, "(%BCy%)" uyarısı. **Sonra:** mesaj gider.
  Bir gönderim kapısını gevşettiği için soruyorum. Yapalım mı?

**T5-2 — Kalıcı mesaj kuyruğu açılınca bayat karşılama / giriş mesajı konaklamanın ortasında gidebilir** (`DURABLE_OUTBOX_ENABLED`, bugün
kapalı). Kuyrukta bekleyen (bağlantı koptu, gönderim duraklatıldı) karşılama ve giriş mesajları için "varış günü geçti" kontrolü yok;
uzatılan çıkışın "bugün çıkış günü" mesajı 2 gün erken gidiyor.
- Önerim: kuyruklu yol da kuyruksuz yol gibi: varış günü geçtiyse karşılama / giriş iptal; çıkış mesajı gerçek çıkış gününe ertelenir.
- ÖRNEK: Varış 2 Kasım, bağlantı 5 Kasım'a kadar koptu → **önce:** 5 Kasım'da "Rezervasyonunuz için teşekkürler" + "girişiniz bugün 15:00,
  kapı kodu …". **Sonra:** ikisi de gitmez (kayıtta "süresi geçti"). Bu davranış bir testle bilinçli pinlenmiş (gecikmenin dakikalar
  süreceği varsayımıyla); onayınızla değişir.

**T5-3 — `{daire}` bina numarasını daire numarası sanıyor.** Daire adı "Lale Apartman 2 Daire 5" ise `{daire}` = **2**.
- ÖRNEK: Giriş mesajı "Daire numaranız {daire}. Kapı kodu 1234." → **önce:** "Daire numaranız 2." **Sonra:** "Daire numaranız 5."
  ("Lale Apt. No:12 D:5" gibi olağan biçimler zaten doğru.) Önerim: "daire / D:" etiketi "apartman / apt" etiketinden önce okunur. Yapalım mı?

**T5-4 — Gelen kutusu şablonunda `{{guestName}}` yer tutucu adı yazıyor.** Misafirin adı bilinmiyorsa (kanal "Rezervasyon HM4K2" verir)
hazır şablon "Merhaba Rezervasyon HM4K2," olur — ev sahibi fark etmezse misafire gider. 09-28 kuralınız (yer tutucu ad misafire yazılmaz).
- Önerim: adsızken selam adsız: "Merhaba, hoş geldiniz." Böyle yapalım mı?

**T5-5 — Bekleyen talep (soru soran, rezervasyon yapmamış kişi) için temizlik ve giriş hazırlığı görevi açılıyor.** "Ayşe girişi için
hazırlık" ve "Çıkış temizliği - Ayşe" panoda "Bugünkü Görevler"de ve temizlikçinin WhatsApp listesinde; talep rezervasyona dönmezse görev
silinmiyor, tarihi geçince "Geciken" olup performans skorunu düşürüyor.
- Önerim: görev yalnız onaylı rezervasyonda açılır; talep onaylanınca görevler kendiliğinden açılır (senkron her turda kurar; elle durum
  değiştirme yolu da). Risk: sağlayıcının durum adı içinde "pending" geçen gerçek bir rezervasyon görevsiz kalabilir — sözlük ölçülür. Yapalım mı?

**T5-6 — Tarih değişince eski geç çıkış onayı yeni devir gününe taşınıyor.** 14 Kasım 13:00 geç çıkış onayı, çıkış 16'sına alınınca 16'sında
gelen misafirin kartında "Önceki misafirin geç çıkışı onaylandı: 13:00" yazıyor ve onun otomatik onayı engelleniyor (temkinli yön).
Soru: verilen geç çıkış onayı rezervasyonun yeni çıkış gününe taşınsın mı (bugün böyle), yoksa yalnız onaylandığı güne mi ait olsun?

**T5-7 — Ev sahibi Karar Motoru KULLANMADAN elle "erken giriş mümkün değil" yazdıysa**, misafir yeniden sorduğunda doğrulanmış otomatik
onay yine gidebilir (erken giriş akışı önceki ev sahibi cevaplarını okumuyor; kodda okundu, uçtan uca koşulmadı). Önerim: aynı gün ev
sahibinin erken girişe değinen bir mesajı varsa otomatik onay size kalsın. Yapalım mı?

**T5-8 — Sorunlu sekmesindeki öneri paneli 20'de kesiliyor, başlıkta "20 konuşma" yazıyor** (25 varken). Önerim: "25 konuşmadan ilk 20"
yazsın. Yapalım mı?

**T5-9 — Ayarlar'daki çıkış mesajı açıklaması eksik**: kod çıkış mesajını yalnız anahtar açıldıktan SONRA oluşturulan rezervasyonlara
gönderiyor, kart bunu söylemiyor (karşılama ve giriş kartları söylüyor). Önerim: aynı cümle çıkış kartına da. Yapalım mı?

## 3. Bakılıp temiz çıkanlar (kısa)
- Kiracı yalıtımı: karar / taslak rotaları, WhatsApp düğmesi, söz rotaları, komşu karar okumaları, rapor ve risk sorguları işletme kapsamlı.
- Çift tıklama / yarış: karar onayında durum + sürüm kontrolü ve sürüme bağlı gönderim kimliği.
- Yaşam döngüsü gün kuralı, yaz saati, 08:00–12:00 çıkış penceresi, gönderim anı yeniden kontrolleri (iptal, tarih, KVKK silme) doğru.
- Doluluk, aynı gün devir, takvim; yapay zekâ cevabı sayımı ("GuestOps AI" OR `aiAssisted`) doğru; personel görünümü tek kuraldan.
- 7 dilde karar şablonları metin denetiminden temiz; karar metinleri sahte söz üretmiyor.
