# Codex 11-10 bulguları — bugünkü kodda doğrulama ve düzeltme kaydı (11-11)

Kurucu 11-10 / 11-11: "önce hataların tamamını düzelt, sonra derinleş". Codex'in baktığı sürümlerden biri (`43ccd3c`) bugünkü kodun 304
commit gerisindeydi → her bulgu önce bugünkü kodda (`3b395d49`) doğrulandı (7 Haiku ajanı, salt okuma; kanıt satırları kodda teyit edilir).
Durum sütunu ilerledikçe güncellenir: `açık` → `düzeltildi (commit)` / `soruda` / `geçerli değil`.

## Ödeme (webhook `api/webhooks/paddle/route.ts`, `lib/billing/**`)
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| P1 | Eşzamanlılıkta eski aboneliğin AKTİF olayı yeni aboneliğin üstüne dönebiliyor (aktif olayda yazma koşulunda abonelik kimliği yok; `getSubscriptionCreatedAt` boş dönerse açık geçiyor) | geçerli (kısmen: aktif olmayan olay korumalı) | **düzeltildi** — aktif olay da okuduğu abonelik kimliğine bağlı yazar; yerinden edilen aboneliğin olayı düşer + alarm; araya başka abonelik girdiyse karar yeniden; yaş ŞU AN okunamıyorsa 500 (Paddle yeniden gönderir). KALAN SORU: yaş KESİN bilinmezse (abonelik Paddle'da yok) kurucu 11-04 kuralı sürüyor → kalıcı çözüm aboneliğin oluşturulma zamanını satırda saklamak (yeni sütun, migration onayı ister) |
| P2 | Ödenmiş işlemden sonra ikinci ödeme ekranı aralığı (`completeCheckoutIntent`: önce `openKey: null`, sonra `markPaidPending`; hata yutuluyor, tekrar onarmıyor) | geçerli | **düzeltildi** — önce kilit, sonra niyet kapanır (üç yolda); kilit yazılamazsa niyet açık kalır ve olay yeniden gelince onarılır; yer boşalınca kilit + canlı abonelik yeniden bakılır |
| P3 | Eski plan önizlemesi (belirteç kaynak plan / abonelik sürümünü bağlamıyor; yeniden önizleme ile PATCH arası koşulsuz) | kısmen (yön değişimi yakalanıyor) | **düzeltildi** — onay kaynağı da bağlar (abonelik + plan + biliniyorsa Paddle fiyatı); kilit alındıktan sonra Paddle fiyatıyla son bakış |
| P4 | Eski isteğin temizliği yeni isteğin kilidini siliyor (`clearPending`, `clearCheckoutPending` adla siliyor, sahip yok) | geçerli | **düzeltildi** — plan değişikliği kilidinin sahibi "hedef fiyat#istek"; "ödemeniz işleniyor" kilidini yalnız kendi ödemesinin (onay kaydı) olayı kaldırır |
| P5 | Hesap silme–ödeme yarışında P2002 yedek dalı 0 satırda alarmsız dönüyor | geçerli | **düzeltildi** — alarm + inceleme |
| P6 | Plan değişikliği başarılı ama gövde okunamazsa "planınız değişmedi" + yenileme yok | geçerli | **düzeltildi** — sonuç bilinmiyorsa var olan "onay bekleniyor" metni + sayfa yenilenir (yeni metin yok) |
| P7 | "Ödeme işleniyor" ile açılan sayfa kendiliğinden yeniden bakmıyor; sonradan gelen bekleme uygulanmıyor | geçerli | **düzeltildi** — kilit sürdükçe 8 sn'de bir yeniden bakar (en çok kilit süresi); kilit iki yönlü uygulanır |

## Mesajlaşma (`lib/host-send.ts`, `lib/outbound-claim.ts`, `lib/automation.ts`, gelen kutusu)
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| M1 | Çift gönderim: kuyruk yolu gövde sahiplenmesi almıyor; istek kilidi adla bırakılıyor (sahip yok) | kısmen (TTL / bayat bırakma gerekir) | açık |
| M2 (A24) | Gönderim kesin hatasında konuşma koşulsuz "Yeni" — ev sahibinin "Sorunlu" kararı siliniyor (normal + nezaket) | geçerli | açık |
| M3 (A25) | Cevap yoldayken gelen soru: son mesaj giden diye "zaten cevaplandı" çıkışı | geçerli | açık |
| M4 (A26) | Karşılama / giriş / çıkış göndericileri ilk 25 gönderilemeyen kayıtta takılıyor | geçerli | açık |
| M5 | Geçersizleşen hazır taslak panelde gönderilebilir kalıyor (`initialDraft` boşalınca temizlenmiyor) | geçerli | açık |

## Takvim / senkron (`lib/import/**`, `lib/data-retention.ts`)
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| C1 | Takvim kimliği 200 karakterde kesiliyor; ilk 200'ü aynı iki UID birleşiyor | geçerli | açık |
| C2 | Eski takvim yanıtı yeni iptali geri açıyor (koşu sırası yalnız kaybolma uzlaştırmasında) | geçerli | açık |
| C3 | Saklama süpürgesi ile senkron yarışı: anonim ad / not geri yazılıyor | geçerli (dar pencere) | açık |
| C4 | İlk takvim (dışa aktarım) bağlantısı iki sekmede iki anahtar üretiyor, sonuncu kazanıyor | geçerli | açık |
| C5 | Bozuk CSV aktarım hakkını tüketiyor (ayrıştırma hatasında kota iade edilmiyor) | geçerli | açık |

## Hospitable / OAuth (`lib/hospitable-credentials.ts`, `lib/hospitable-oauth.ts`, `api/hospitable/oauth/callback`)
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| O1 | Eşzamanlı yenileme: kazanan yazmadan önce kaybeden `invalid_grant` alıp bağlantıyı düşürüyor | geçerli | açık |
| O2 | Geciken OAuth dönüşü bağlantı kaldırmayı / yeni anahtarı eziyor (koşulsuz yazım) | geçerli | açık |
| O3 | 429 dışındaki her 4xx (401 `invalid_client`, 408) yenileme anahtarını sildiriyor | geçerli (test bunu pinliyor) | açık |
| O4 | Doğrulama kesintisi (429 / 5xx / ağ) "geçersiz anahtar" + alarm yok | geçerli | açık |
| O5 | Dönüş tekrarı: aynı imzalı durumla çok sayıda belirteç isteği (tüketim / hız sınırı yok) | geçerli (dar etki) | açık |

## Kimlik
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| A1 (A27) | Eski doğrulama denemesi yeni şifre kodunu siliyor | ajan: düzelmiş (istek başına ayrı kayıt) — e-posta kuyruğu "yerine geçme" yolu ayrıca bakılacak | açık (doğrula) |
| A2 | Bekleyen 2FA kurulumu: `setup` yazımında oturum kuşağı / kurulum sürümü yok | kısmen (etkinleştirme korumalı) | açık |
| A3 | Şifre sıfırlama sayfası aynı sekmede yalnız `#` değişince okumuyor | geçerli | açık |
| A4 | Geçerli doğrulama bağlantısında işlem yapılmadan hata | ajan: düzelmiş | doğrula |
| A5 | Giriş ekranında "yeniden gönder" bekleme sonrası geri gelmiyor | geçerli | açık |
| A6 | Plan onayında klavye odağı yönetilmiyor | geçerli | **düzeltildi** — panel açılınca odak panele, kapanınca açan düğmeye |

## QR / kapı / erken giriş
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| Q1 | QR cevabı kontrollerden SONRA kesiliyor (tavan selamdan önce; kayıtta `slice(0, 2000)`) | geçerli | açık |
| Q2 | Evcil hayvan sorusu bağımsız Wi-Fi cevabını da tutuyor (kapı misafir mesajına bakıyor) | geçerli (bilinçli tasarım, testle pinli) | SORUDA — misafire gideni değiştirir |
| Q3 | Erken kanıtlanmış temizlik "çıkıştan sonra" diye etiketleniyor (`readiness-list/evaluate.ts`) | geçerli | açık |

## Diğer
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| X1 | Göreve bağlanan fotoğrafı temizleyici silebiliyor (`storage/deletion-queue.ts`: "gösterilen" kümesi bir kez okunuyor; silme dalı karşılaştırmasız) | geçerli | açık |
| X2 | Belge kuyruğu: tek sorgu, eskiden yeniye 200 satır, sayfalama / toplam yok | geçerli | açık |
| X3 | Eski ayar sekmesi yeni ücret / otomasyon ayarını eziyor (bütün nesne kaydı, sürüm denetimi yok) | geçerli | açık |
| X4 | Kayıt sürerken yazılan değer kayboluyor (otomasyon metinleri, imza, uyarı adresi; ücret formunda YOK) | kısmen | açık |
| X5 | Görev atama e-postasında saat sunucu saat diliminde (UTC) | geçerli | açık |
| X6 | K-1: aktarılabilir görevler varsayılan SEÇİLİ; elle yeniden atanmış sistem görevi listede işaretsiz | bugünkü davranış | SORUDA (Codex: ayrı göster + seçili gelmesin) |
