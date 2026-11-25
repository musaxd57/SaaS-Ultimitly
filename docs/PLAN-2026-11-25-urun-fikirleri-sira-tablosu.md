# B-sıra tablosu — bütün önerilerin tek tablosu (FİKİR-B; PLAN.md ile birlikte okunur)

> PLAN.md faz faz dizili (numara = faz sırası). Bu tablo **öncelik** sırasıyla dizili: "Sıra" sütunu benim önerdiğim yapılış sırası,
> "Plan #" PLAN.md'deki madde numarası. Büyüklük: K = küçük (≤ 1 dilim) · O = orta · B = büyük. "Migration" = veritabanı değişikliği.
> Sıralama ölçütü: (1) Hospitable'sız hesapta çalışır mı · (2) misafire gideni değiştirir mi · (3) migration · (4) canlı veri olmadan
> doğrulanır mı · (5) para etkisi (yeni müşteri / tutma / maliyet). Kod okumasına dayanır; çalıştırılarak ölçülmedi.

## 0. Ön koşul bandı (özellik değil; sıra numarası almaz)

| Adım | Ne | Büyüklük | Migration | Bağımlılık | Ölçüt (bitti sayılma) |
|---|---|---|---|---|---|
| Ö1 | Açılış dalgaları: D0 altyapı (yedek + geri yükleme provası + bekleyen ~40 migration + kuyruk sağlığı) → D1 misafire dokunmayanlar (boşluk satırı · eylem önerileri · üretim izi + kanal üst verisi · taslak ↔ gönderim bağı) → D2 QR (sohbet kodu + acil numara) → D3 ölçümü olan misafir anahtarları (konuşma kayıtları → tarih okuma → doğrulanmış müsaitlik) → D4 karar kartı + WhatsApp | kod K · kurucu zamanı B | bekleyenler (yeni yok) | Railway · taze yedek · OpenAI kredisi | dalga başına: güvenlik ölçüsü 0 + ev sahibine gereksiz bırakma artmadı; 4 hafta sonra kapalı kalan ONAYLI anahtar sayısı |
| Ö2 | Geçmiş veriden ihtiyaç sayımı (salt-okuma, modelsiz; yalnız sayı) | K | yok | veritabanı açık (yedekten sonra, siteden önce) | dört sayı elde: aynı konu 3+ soru / hafta · açık konuyla biten konaklama · tekrarlanan bakım · aynı gün çıkış + giriş. Düşük çıkan fikir düşer |
| Ö3 | Maliyet karnesi: işletme başına aylık yapay zekâ maliyeti ÷ plan geliri (operatör paneli) | K | yok | üretim izi anahtarı açık (D1) · fiyat tablosu kararı | plan başına brüt marj; mesaj başı maliyet |
| Ö4 | Demo hesabı canlıya + Airbnb dosyası kullanım sayıları | K | yok | canlı + ≥ 4 hafta veri · kurucu işletmenin Hospitable aboneliği | dosyadaki "[TBD]" = 0; kapı 4 ve 5 kapanır |
| Ö5 | On köprüsüz deneme (edinim işi; kod değil) | — | — | kurucunun çevresi + talep listesi | 10 deneme hesabı açıldı |

## 1. Öneriler — öncelik sırasıyla

| Sıra | Plan # | Öneri | Faz | Büyüklük | Migration | Bağımlılık | Ölçüt | Hospitable'sız |
|---|---|---|---|---|---|---|---|---|
| 1 | 7 | Çıkıştan önce açık konu satırı (var olan üç satırın çıkışa 24 saat kala birleşmesi) | V2 | K | yok | yok — açılışı beklemeden | açık konuyla biten konaklama oranı (önce / sonra) | evet |
| 2 | 9 | "Son bakım işi" notu (görev kapanış notunun tekrarlayan sorun satırında gösterimi) | V3 | K | yok (`TaskUpdate.note` var) | yok — açılışı beklemeden | not taşıyan bakım görevi oranı | evet |
| 3 | 10 | Temizlikçi gün sırası + ay sayımı (ücret alanı yok) | V3 | K | yok | yok — açılışı beklemeden | temizlik görevinde "bitti" işaretlenme oranı | evet |
| 4 | 1 | Takvim + QR ile başlama yolu (tanıtım + rehber metinleri) | kapı 2'nin satış yüzü | K–O | yok | metin onayı · avukat (yasal metinlerde Hospitable zorunluluğu) | kayıt → ilk QR sohbeti süresi · QR'ı okutan konaklama oranı · deneme → ödeme | evet |
| 5 | 3a | QR duyuru şeridi (bitiş tarihli, modelsiz, çevirisiz) | V1 | K | yok (daire hafızası, `expiresAt`) | QR sır süzgeci · metin / etiket onayı | not süresince aynı konuda elle yazılan cevap; süresi geçmiş şerit = 0 | evet |
| 6 | 2 | QR ana sayfası — ilk hâli: çevirisiz kartlar + "Çıkış yaptık" beyanı | kapı 2'nin satış yüzü | O | ilk hâli yok | sohbet kodu açık (D2) · kart = sohbetle aynı sır kapısı · metin onayı · Wi-Fi kartı için kurucunun "kodsuz konaklamada Wi-Fi yok" kuralı | okutma oranı · kart sonrası konaklama başına soru · düğme → temizlik "başladı" süresi | evet |
| 7 | 17 | Kimlik bildirimi işareti (bilgi satırı; hatırlatma yok) | V5 | K | küçük (boş bırakılabilir alan) | avukat cevabı | işareti kullanan hesap oranı | evet |
| 8 | 4 | Yazmadan kurulum: "bulduklarım" listesi (+ beş fiziksel özellik sorusu) | V1 | O | yok | 09-11'de kaldırılan iki yüzeyin geri açılması (kurucu) · beş sorunun açılması (kurucu) | kayıt → daire başına 5 onaylı bilgi süresi · rehberi bitiren hesap oranı | evet |
| 9 | 15 | Deneme karnesi — ilk hâli: panelden değiştirilmeden gönderilen taslaklar | ⑤ geniş otonomi | O | yok (migration 96 bekleyenlerde) | taslak ↔ gönderim bağı anahtarı (D1) · kanal kutusu · gerçek karar verisi | denemede otomatik cevabı açan işletme oranı · deneme → ödeme | **hayır** |
| 10 | 11 | Usta rehberi (ekip kişisi etiketi + `wa.me` metni) | V3 | O | küçük (etiket) | ekip kişisi anahtarı (migration 97 bekleyenlerde) | bakım görevinden ustaya yazma oranı | evet |
| 11 | 12 | Periyodik bakım + boşluğa yerleştir | V3 | O | yeni tablo | sıra 2 · müsaitlik motoru (eksik okumada "boşluk bulunamadı") | vadesi geçen bakım sayısı · boşlukta yapılan bakım oranı | evet |
| 12 | 2b | QR ana sayfası — ikinci adım: erken giriş / geç çıkış istek kartı + kart çevirisi | kapı 2 → V3 | O | küçük (çeviri saklama) | karar kartı anahtarı (D4) · çeviri = model (kredi) · ücretli hâli avukat | istek → karar süresi · süresi dolan istek sayısı | evet |
| 13 | 8 | İş varsa tek satır WhatsApp | V2 → V3 | K–O | "günde bir kez" kaydı ölçülmeli | Meta onayı · ev sahibi WhatsApp kanalı (D4) | hazır olmayan girişin giriş saatinden önce çözülme oranı | evet |
| 14 | 5 | Yorumlardan "bilinen sorunlar" (tek seferlik; metin saklanmaz) | V1 (V6'nın öne çekilen dilimi — kurucu kararı) | O | yok (yeni olay kaynağı adı) | OpenAI kredisi · ad maskesi · aydınlatma cümlesi + Airbnb kaynaklı metin politikası (avukat) | onaylanan aday oranı | evet |
| 15 | 16 | Hasar / unutulan eşya dosyası (görsel model yok) | V4 | O | başlangıçta yok (`checkout_review` türü var) | temizlikçi WhatsApp fotoğraf adımı (Meta) · fotoğraf saklama / silme kuralı · taslak yalnız kanal kutulu hesapta gider | dosyası açılan çıkış oranı | evet (taslak hariç) |
| 16 | 3b | Bitiş tarihli nottan yapay zekâ cevabı | V1 | K | küçük (bilgi kalemine boş bırakılabilir bitiş alanı) | kör ölçüm · OpenAI kredisi | süresi geçmiş bilginin misafire gitmesi = 0 · aynı konuda ev sahibine düşen soru | evet (QR) |
| 17 | 6 | İlk sabah yoklaması | V1 sinyal | K–O | muhtemelen yok (dördüncü otomatik mesaj türü) | kanal kutusu · kurucu işletmenin Hospitable aboneliği (ölçüm) · çeviri katmanı · Airbnb mesaj kuralı (doğrulanmadı) | konaklama sürerken öğrenilen sorun oranı ↔ konaklama başına ev sahibine düşen konu (kapatma eşiği +%30) | **hayır** |
| 18 | 14 | Kademeli ulaşma | V3 | O–B | evet | WhatsApp tek kişiye çalışıyor · üyelik (93–94) | acil bildirimde ilk "gördüm"e kadar süre | evet |
| 19 | 13 | Toplu duyuru (kanal) | V3 | O | küçük (gönderim türü) | kanal · çeviri (model) · Airbnb mesaj kuralı · ayrı onay + ilk gönderimler birlikte | duyuru sonrası aynı konuda gelen soru sayısı | **hayır** |
| 20 | 18 | "Bu konaklamaya dikkat" (ihtiyaç ↔ daire) | V5 | O–B | fiziksel özellikler için yok; anlama katmanı şeması değişir | sıra 8'in beş sorusu · anlama katmanının yeniden ölçümü (kredi) | satırdan açılan görev oranı | kısmen |
| 21 | 19 | "Abonelik kendini ödedi" satırı | V8 üstü (ek satış) | K (+ misafir hizmetleri tabloları) | evet (11-06 planı) | avukat (P0) · sıra 12 | beyan gelir ÷ abonelik | evet |
| 22 | 20 | Tavsiye bağlantısı | faz dışı (satış) | O | evet | ilk 5 ödeyen müşteri · Paddle para akışı (kurucu + ilk denemeler) · deneme kimliği | tavsiyeli kayıt oranı | evet |

## 2. Dış bağımlılık → kilitlediği sıralar

| Dış iş (kurucunun elinde) | Kilitlediği sıra numaraları |
|---|---|
| Railway + taze yedek | Ö1–Ö4; 1–3 yazılabilir ama canlıya çıkamaz; 4–22'nin hepsi |
| OpenAI kredisi | 12 (çeviri) · 14 · 16 · 20 · 9'un "aynı şeyi söylüyordu" hâli · D3 dalgası |
| Kurucu işletmenin Hospitable aboneliği | Ö4 (kapı 5) · 9 · 17 |
| Meta (WhatsApp) kurulumu — bugün başlatılabilir | 13 · 15 · 18 · temizlikçi WhatsApp akışı (köprüsüz paketin en güçlü ayağı) |
| Avukat paketi | 4 (yasal metinler) · 7 · 12'nin ücretli hâli · 14 · 21 |
| Kurucu kararı (bekleyen) | 8 (iki yüzey + beş soru) · 20 (daire gerçekleri) · 6'da Wi-Fi kartı |

## 3. Değişmez / kural denetimi (hangi öneri neyi zorlar)

| Öneri | Zorladığı kural | Nasıl korunur |
|---|---|---|
| 14 yorumlar | değişmez 12 (boş yorum tablosu yok) · 13 (model metni kalıcı gerçek değil) · 14 (Airbnb kaynaklı veri politikası) · yürütme sırası (V6) | tablo yok, metin saklanmaz; yalnız ev sahibinin onayladığı kayıt; avukat; öne alma kurucu kararı |
| 5 / 6 / 12 QR yüzeyi | QR sır süzgeci · "Wi-Fi yalnız sohbet kodlu konaklamada" · misafire giden metin ev sahibinin ağzından | kart ve şerit sohbetle aynı kapıdan; sabit metinler pinli; etiket üçüncü şahıs değil |
| 17 / 19 yeni kendiliğinden mesaj | "misafire gideni değiştiren = kurucu onayı + ilk denemeler birlikte" · otomatik mesaj kapalı kümesi | varsayılan kapalı, daire başına; "Sorunlu" / iptal vetoları taşınır |
| 9 deneme karnesi | "rampa kendiliğinden yükseltmez" · makbuzsuz iddia yok | sistem önerir, ev sahibi açar; yalnız kayıtlı olaydan sayım |
| 16 nottan cevap | tek boğaz `selectKbForPrompt` · hafıza olgusu yapay zekâya gitmez (pin) | hafıza değil bilgi kalemi yolu; kör ölçüm |
| 20 ihtiyaç ↔ daire | "anlam kararı modelle" · anlama katmanı değişimi = yeniden ölçüm | kelime listesi yok; ölçülmeden açılmaz |
| 21 / 12 ücretli istek | "Airbnb mesajında ek hizmet / dış ödeme izi yok" · Lixus para tutmaz | yalnız QR; tutar beyan; avukat sonrası |
| 7 kimlik işareti | hukuki sorumluluk (özen yükümlülüğü iması) | "işaretlediniz" dili; hatırlatma yok; avukat |
| Hiçbiri | reddedilenler (semantik önbellek · misafir yüzeyinde streaming · yeni izleme alt işleyeni) | öneri yok |

## 4. Bilerek tabloya girmeyenler
V6 sürekli yorum akışı · V7 gelir / fiyat · V8 "Lixus'a sor" · görsel modelle temizlik puanı · akıllı kilit · misafir profili · köprüsüz hesap
için şimdi ucuz bant · e-postada "gördüm" kademesi · tarayıcı bildirimi (yalnız Meta 4 haftada gelmezse yedek). Gerekçeler PLAN.md
"Önermediklerimiz" bölümünde.
