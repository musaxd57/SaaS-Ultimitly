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
| M1 | Çift gönderim: kuyruk yolu gövde sahiplenmesi almıyor; istek kilidi adla bırakılıyor (sahip yok) | kısmen (TTL / bayat bırakma gerekir) | **kısmen düzeltildi + SORUDA.** Sahiplik: her deneme kendi jetonunu yazar (bırakma / uzatma yalnız kendi satırı) — süresi dolan denemenin geç temizliği yeni denemenin talebini silemez. "Kuyruk yolu gövde talebi almıyor" kısmı ise Codex 07-23 kararıydı (testle pinli: niyet istek kimliğinde; farklı kimlik = bilerek ikinci gönderim) → DEĞİŞTİRİLMEDİ. Açık soru: kalıcı kuyruk açıkken iki ekip üyesi aynı taslağı aynı anda onaylarsa misafire iki kez gider — (A) kuyruk yolunda da aynı metni 2 dk engelle (bugünkü doğrudan yol böyle) ya da (B) onaylanan taslağın kimliğiyle tekilleştir |
| M2 (A24) | Gönderim kesin hatasında konuşma koşulsuz "Yeni" — ev sahibinin "Sorunlu" kararı siliniyor (normal + nezaket) | geçerli | **düzeltildi** — geri alma yalnız durum hâlâ bizim talebimizse; senkron "Yeni" yaptıysa yalnız geri çekilme yazılır |
| M3 (A25) | Cevap yoldayken gelen soru: son mesaj giden diye "zaten cevaplandı" çıkışı | geçerli — iki ayrı durum | **kısmen düzeltildi + SORUDA.** (a) Cevap GÖNDERİLİRKEN içeri alınan soru: cevap satırının zamanı kayıt anıydı → soru cevaptan önce sıralanıyor, yapay zekâ cevaplamıyor, sonraki senkron konuşmayı "Cevaplandı" yapıyordu (gelen kutusunda da kayboluyordu). Düzeltildi: satır zamanı = talep anı (ev sahibi yolunda gönder'e basılan an). (b) Cevaptan ÖNCE yazılıp sonradan içeri alınan soru: kurucunun 11-04 S1 kararı ("Yeni" kalır, ev sahibi görür, yapay zekâ kendiliğinden cevaplamaz) AYNEN — yapay zekâ bunu da cevaplasın mı, kurucu sorusu |
| M4 (A26) | Karşılama / giriş / çıkış göndericileri ilk 25 gönderilemeyen kayıtta takılıyor | geçerli | **düzeltildi** — adaylar sayfa sayfa okunur (metni olmayan / doldurulamayan atlanır), geçişte en çok 25 mesaj kuralı aynı, okuma 8 sayfayla sınırlı |
| M5 | Geçersizleşen hazır taslak panelde gönderilebilir kalıyor (`initialDraft` boşalınca temizlenmiyor) | geçerli | **düzeltildi** — sunucu taslağı vermeyince hazır taslak kalkar; konuşmaya yeni bir cevap gelince eldeki her öneri kalkar |

## Takvim / senkron (`lib/import/**`, `lib/data-retention.ts`)
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| C1 | Takvim kimliği 200 karakterde kesiliyor; ilk 200'ü aynı iki UID birleşiyor | geçerli | **düzeltildi** — 200 karakteri aşan kimlik kesilmez: "baş + ~ + özet" (kayıpsız ayırt eder, 200 sınırında kalır). Eski kesilmiş kimlikli satır / silme kaydı içe aktarımdan önce yeni biçime bağlanır; iki uzun kimlik aynı eski kimliğe düşüyorsa satır yalnız tarihleri birebir uyan TEK adaya verilir, yoksa dokunulmaz (otomatik birleştirme yok); silme (KVKK) engeli eski kimlikle de tutar |
| C2 | Eski takvim yanıtı yeni iptali geri açıyor (koşu sırası yalnız kaybolma uzlaştırmasında) | geçerli | **düzeltildi** — her takvim kaynağının koşuları sıralıdır (kaynak başına "en son koşu başlangıcı" damgası, satır yazımıyla aynı işlemde karşılaştırılır): daha yeni bir koşu yazdıysa geç dönen eski yanıt hiçbir satırı yazmaz, durumu / uzlaştırmayı da çalıştırmaz |
| C3 | Saklama süpürgesi ile senkron yarışı: anonim ad / not geri yazılıyor | geçerli (dar pencere) | **düzeltildi** — ad / not / kişisel alanlar AYRI ve koşullu yazılır ("satır hâlâ anonim değilse"); tarih ve durum güncellemesi anonim satıra da uygulanır. Takvim senkronu, dosyadan içe aktarma ve ortak yazma servisi aynı kural |
| C4 | İlk takvim (dışa aktarım) bağlantısı iki sekmede iki anahtar üretiyor, sonuncu kazanıyor | geçerli | **düzeltildi** — anahtar "yalnız boşsa yaz" ile üretilir, her istek KAZANAN anahtarı okur (iki sekme aynı bağlantıyı görür) |
| C5 | Bozuk CSV aktarım hakkını tüketiyor (ayrıştırma hatasında kota iade edilmiyor) | geçerli | **düzeltildi** — dosya ayrıştırılamadıysa (hiçbir şey yazılmadı) aktarım hakkı iade edilir; kötüye kullanım sınırı (istek sayısı) yerinde |

## Hospitable / OAuth (`lib/hospitable-credentials.ts`, `lib/hospitable-oauth.ts`, `api/hospitable/oauth/callback`)
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| O1 | Eşzamanlı yenileme: kazanan yazmadan önce kaybeden `invalid_grant` alıp bağlantıyı düşürüyor | geçerli | **düzeltildi** — bir işletmenin yenilemesini aynı anda TEK istek yapar: aynı süreçte çağrılar tek isteği paylaşır; başka kopya yeniliyorsa (kısa ömürlü kilit) sağlayıcıya gidilmez, onun yazdığı anahtar beklenir. Çöken kopyanın kilidi 30 sn sonra devralınır |
| O2 | Geciken OAuth dönüşü bağlantı kaldırmayı / yeni anahtarı eziyor (koşulsuz yazım) | geçerli | **düzeltildi** — işletme başına tek bekleyen "bağlantı niyeti": dönüş onu sahiplenir, anahtar yazımı niyet satırını AYNI işlemde siler (satır yoksa yazmaz). Bağlantıyı kaldırma / elle anahtar / akışı yeniden başlatma satırı siler ya da değiştirir → geç gelen dönüş yazamaz ("bağlan → kaldır" ile başa dönülse de) |
| O3 | 429 dışındaki her 4xx (401 `invalid_client`, 408) yenileme anahtarını sildiriyor | geçerli (eski test bunu pinliyordu — test düzeltildi) | **düzeltildi** — anahtar yalnız sağlayıcı AÇIKÇA "bu yetki geçersiz" derse silinir (`invalid_grant`; ya da yenileme anahtarını / yetki kodunu adıyla reddeden `invalid_request`). `invalid_client` (bizim yapılandırma hatamız), 408 ve başka 4xx bağlantıyı düşürmez, alarm üretir |
| O4 | Doğrulama kesintisi (429 / 5xx / ağ) "geçersiz anahtar" + alarm yok | geçerli | **düzeltildi** — "sağlayıcı reddetti" yalnız 401 / 402 / 403; hız sınırı, 5xx, ağ / zaman aşımı "bağlantı kurulamadı" + operatöre alarm. Elle anahtar yolunda da: kesintide "Hospitable'a şu anda ulaşılamadı. Birazdan tekrar deneyin." (503), 401'de "Token geçersiz." — ⚠️ ev sahibine giden metin ikiye bölündü (eskisi: "Token geçersiz ya da Hospitable'a ulaşılamadı."), kurucuya bildirildi |
| O5 | Dönüş tekrarı: aynı imzalı durumla çok sayıda belirteç isteği (tüketim / hız sınırı yok) | geçerli (dar etki) | **düzeltildi** — niyet tek kullanımlık: aynı dönüş adresi ikinci kez çağrılınca sağlayıcıya yetki kodu isteği gitmez (O2 ile aynı kayıt) |

## Kimlik
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| A1 (A27) | Eski doğrulama denemesi yeni şifre kodunu siliyor | geçerli (ajanın "düzelmiş" dediği yol şifre sıfırlamaydı; bulgu şifre değiştirmedeydi) | **düzeltildi** — asıl yer oturum içi şifre DEĞİŞTİRME koduydu (`api/account/password`): hak alınamayınca kod koşulsuz siliniyordu. Artık yalnız ÖLÜ kod yakılır (süresi dolmuş / hakkı bitmiş); e-posta gönderilemeyen istek de yalnız KENDİ kodunu siler. Şifre SIFIRLAMA yolu zaten istek başına ayrı kayıt |
| A2 | Bekleyen 2FA kurulumu: `setup` yazımında oturum kuşağı / kurulum sürümü yok | kısmen (etkinleştirme korumalı) | **düzeltildi** — kurulum yazımı oturum kuşağına bağlı (iptal edilmiş oturumun bayat isteği yazamaz → 401); ekran "kurulum kimliği" yollar: başka sekmede kurulum yenilendiyse eski ekranın kodu denenmez, "Kurulum durumu değişti…" (var olan metin) denir ve hatalı deneme sayılmaz |
| A3 | Şifre sıfırlama sayfası aynı sekmede yalnız `#` değişince okumuyor | geçerli | **düzeltildi** — sayfa açıkken adresin `#` kısmı değişince yeni bağlantı okunur; önceki bağlantıya yazılmış kod / şifre temizlenir |
| A4 | Geçerli doğrulama bağlantısında işlem yapılmadan hata | geçerli (ajan "düzelmiş" demişti; aynı sekmede açılan bağlantı okunmuyordu) | **düzeltildi** — aynı sınıf: e-posta doğrulama ve uyarı adresi onayı sayfaları da aynı sekmede açılan (geçerli) bağlantıyı okur; hata ekranı kalmaz |
| A5 | Giriş ekranında "yeniden gönder" bekleme sonrası geri gelmiyor | geçerli | **düzeltildi** — bekleme (sunucunun 10 dakikalık penceresi, aynı sabit) dolunca "tekrar gönder" düğmesi geri gelir |
| A6 | Plan onayında klavye odağı yönetilmiyor | geçerli | **düzeltildi** — panel açılınca odak panele, kapanınca açan düğmeye |

## QR / kapı / erken giriş
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| Q1 | QR cevabı kontrollerden SONRA kesiliyor (tavan selamdan önce; kayıtta `slice(0, 2000)`) | geçerli | **düzeltildi** — gönderim tavanı bütün biçimlendirmeden (kodun selamı dahil) SONRAKİ metne bakar: tavanı aşan cevap kesilmiş cevapla aynı hükmü alır (taslak olarak ev sahibine kalır). QR kaydı cevabı artık kesmez — misafirin gördüğü metinle kayıt aynıdır |
| Q2 | Evcil hayvan sorusu bağımsız Wi-Fi cevabını da tutuyor (kapı misafir mesajına bakıyor) | geçerli (bilinçli tasarım, testle pinli) | SORUDA — misafire gideni değiştirir |
| Q3 | Erken kanıtlanmış temizlik "çıkıştan sonra" diye etiketleniyor (`readiness-list/evaluate.ts`) | geçerli | **düzeltildi** — erken temizlik kuralıyla sayılan kanıt "çıkıştan (11:00) önce, erken temizlik kuralıyla" diye yazılır (hüküm aynı). ⚠️ Girişler sayfasında ev sahibine görünen yeni ifade — kurucuya bildirildi |

## Diğer
| No | Bulgu | Bugünkü kod | Durum |
|---|---|---|---|
| X1 | Göreve bağlanan fotoğrafı temizleyici silebiliyor (`storage/deletion-queue.ts`: "gösterilen" kümesi bir kez okunuyor; silme dalı karşılaştırmasız) | geçerli | **düzeltildi** — fotoğrafı göreve bağlayan yazım ile silmeyi sahiplenen temizleyici nesne başına AYNI kilitten geçer; temizleyici kilit altında yeniden okur ve sahiplenir (`deleting`), sonra siler; sahiplenilmiş / silinmiş fotoğraf bağlanamaz ("Fotoğraf artık kullanılamıyor. Yeniden yükleyip tekrar deneyin." — ⚠️ yeni metin, kurucuya bildirildi). Şema değişmedi |
| X2 | Belge kuyruğu: tek sorgu, eskiden yeniye 200 satır, sayfalama / toplam yok | geçerli | **düzeltildi** — başvurular, askıdakiler ve yeniden okunacaklar AYRI okunur (her biri en çok 200, en eski önce); her listenin toplamı sayılır, gösterilmeyen kayıt sayısı operatör ekranında yazılır |
| X3 | Eski ayar sekmesi yeni ücret / otomasyon ayarını eziyor (bütün nesne kaydı, sürüm denetimi yok) | geçerli | **düzeltildi** — otomasyon ayarları ve "AI'nın sesi" formları yalnız DEĞİŞEN alanı gönderir (sunucu zaten yalnız gelen alanı yazıyordu). Aynı alanı iki sekmenin de değiştirmesi "son kaydeden kazanır" olarak kalır (bilinçli; sürüm sütunu = şema değişikliği, gerekirse ayrı karar) |
| X4 | Kayıt sürerken yazılan değer kayboluyor (otomasyon metinleri, imza, uyarı adresi; ücret formunda YOK) | geçerli | **düzeltildi** — otomasyon metinleri, imza ve uyarı adresi: kayıt sürerken yazılan korunur, "Kaydedildi" yalnız ekrandaki değer kaydedilenle aynıysa görünür |
| X5 | Görev atama e-postasında saat sunucu saat diliminde (UTC) | geçerli | **düzeltildi** — vade işletmenin saat diliminde yazılır; yalnız-tarih vadesinde saat uydurulmaz (yalnız gün) |
| X6 | K-1: aktarılabilir görevler varsayılan SEÇİLİ; elle yeniden atanmış sistem görevi listede işaretsiz | bugünkü davranış | SORUDA (Codex: ayrı göster + seçili gelmesin) |

## İnceleme ve kanıt (11-11)
- **Kırmızı-önce:** düzeltme öncesi kaynakla 21 yeni test kırmızı (şifre kodu 3 · 2FA kurulumu 4 · fotoğraf yarışı 4 · ayar formları 7 · temizlik etiketi 2 · kuyruk yolu pini 1) + kimlik ekranları 6; kontrol testleri yeşil.
- **Mutasyon (`scripts/mutation-run.mjs`, commit `0b836b1d`, M0 yeşil):** kimlik + QR / diğer 41 / 41 · takvim 14 / 15 · OAuth 18 / 18. Yaşayan tek mutant (eski kimlik çevirisinde "yeni kimlik zaten var" koruması) için test eklendi.
- **Haiku incelemesi (dört dar inceleme) → uygulananlar:**
  - OAuth: bağlantıyı düşürmek artık MÜNHASIRLIK ister — kilit alınamadıysa (depo arızası) ya da deneme sırasında elden çıktıysa "anahtar ölü" cevabı bağlantıyı kaldırmaz, sonraki münhasır deneme karar verir. Kilit alındıktan sonra saklanan anahtar yeniden okunur (bu arada başkası yenilediyse sağlayıcıya tüketilmiş anahtarla gidilmez). Kilit ömrü 60 sn. Dönüşte niyet kaydı okunamazsa ham hata yerine bilinen sonuç + operatöre bildirim.
  - QR: "bilgi bandı" anahtarı (`QR_INFORMATIONAL_BAND_ENABLED`, varsayılan kapalı) açıkken güveni 0,5'e çekilmiş kesik / tavanı aşan cevap banttan geçebiliyordu → uzunluk engeli açık işaret (`lengthHeld`) oldu; kapı güven değerine bağlı kalmaz.
  - Takvim: dosya yolunda eski kimlik çevirisi rotanın sahiplik kuralıyla (bağlantısız + `ics`) sınırlandı; hak iadesine saatlik tavan (20) kondu — sınırsız ayrıştırma denemesi yok.
  - Kimlik: kurulum kimliği karşılaştırması sabit süreli; şifre sıfırlamada istek sürerken yeni bağlantı açılırsa eski isteğin geç cevabı yeni ekrana yazılmaz.
- **Bilinçli bırakılanlar (gerekçesiyle):** e-posta doğrulama gönderimi sürerken (≈1 sn) açılan ikinci bağlantı yok sayılır · iki koşu AYNI milisaniyede başlarsa ikisi de yazar (sıra tanımsız, pratikte yok) · kanal gönderiminde ev sahibinin imzası / otomatik yanıt notu tavana sayılmaz (hiçbir yerde kesilmediği için anlam bozulmaz) · tam 00:00Z / 12:00Z vadesi "yalnız gün" sayılır (görev panosuyla aynı kural).

## Opus derin incelemesi (11-11, `3b395d49..bc1c40a8`)
Sonuç: P1 yok · P2 bir · P3 dokuz. Yedisi düzeltildi, üçü gerekçesiyle belgede bırakıldı.

**Düzeltilenler**
| Bulgu | Düzeltme |
|---|---|
| (P2) Paddle API anahtarı reddedilirse (401 / 403) kayıtlı aboneliğin yaşı "bilinmiyor" sayılıyor, eski aboneliğin olayı ödeyen aboneliğin yerine geçebiliyordu | 401 / 403 artık "okunamadı" sınıfında (5xx / ağ hatasıyla aynı): olay işlenmez, Paddle yeniden gönderir; anahtar düzelince doğru karar verilir. Operatör alarmı aynen gider |
| CSV ile içe aktarılmış uzun kimlikli satır, aynı dosya yeniden yüklenince kopya açıyordu | Eski kimlik çevirisi dosya türünün kendi kanalına bakar (`.ics` → `ics`, CSV → `manual`) |
| Abonelik senkronu, önceden dosyayla yüklenmiş (kaynağa bağlı olmayan) eski kimlikli satırı bulamıyor, yeni kimlikle ikinci satır açıyordu | Çeviri önce bu kaynağın satırlarına, yoksa kaynağa bağlı olmayan satırlara bakar (sıra korunur — bağlı satır varken bağlantısıza dokunulmaz) |
| Eski kimlikle tutulan silme (KVKK) kaydı koşu sürerken yazılırsa konaklama yeni kimlikle içe alınabiliyordu | Satır yazımındaki işlem içi silme kontrolü eski kimliği de sorar (abonelik senkronu + dosya yolunun üç yazım noktası) |
| Başka bir istek anahtarı yenilerken bekleme (8 sn) sağlayıcının zaman aşımından (15 sn) kısaydı → yanıltıcı "bağlı değil" | Bekleme sağlayıcı zaman aşımından türetilir (+2 sn = 17 sn; biri değişince öteki geride kalmaz); süre dolunca saklanan anahtar bir kez daha okunur |
| Bağlantı başlatılırken niyet kaydı yazılamazsa ham hata dönüyordu | Bilinen sonuç ekranı ("bağlantı kurulamadı") + operatöre bildirim |
| Şifre sıfırlamada istek sürerken yeni bağlantı açılırsa BAŞARILI eski isteğin sonucu da gizleniyordu | Yalnız başarısız eski cevap gizlenir; başarı her durumda gösterilir |
| Otomatik mesaj sırası: metni olan ama gönderilmeyecek adaylar (açıkça silinmiş misafir · kuyruğun sahiplendiği rezervasyon) 25'lik listeyi doldurup arkadakini bekletiyordu | Bu adaylar liste kurulurken elenir (sayfa başına tek kuyruk sorgusu; silme kaydı koşu başına bir kez). Gönderim anındaki kesin kontroller aynen durur. Kuyruk açıkken BEKLEYEN satır elenmez: ertelenmiş giriş mesajının vadesi, tarih yeniden pencereye girince gönderim döngüsünde şimdiye çekilir (ilk sürüm bunu bozuyordu — ilgili 156 test dosyasının koşusu yakaladı) |

**Belgede bırakılanlar (kod değişmedi)**
- Kesin hata (4xx) alan otomatik mesaj her geçişte yeniden denenir; aynı anda 25 böyle rezervasyon olursa sıra yine tıkanır. Çözüm rezervasyon başına deneme sayacı ister (şema değişikliği) — kurucu sorusu S6 ile birlikte.
- Takvim koşu sırası uygulamanın saatine bakar: tek kopyada doğru, iki kopyada saat kayması kadar pencere var → `docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md` §3 madde 7. Aynı damga satırı her satır yazımında güncellenir (büyük beslemede çok yazım; ölçüm gerekirse o zaman).
- Abonelik olayı "ödemeniz işleniyor" kilidini kaldırdıktan sonra gelen işlem olayı kilidi 10 dakika yeniden yazabilir. Etkisi yok denecek kadar küçük (kilit yalnız aboneliği olmayan hesapta görünür) ve eskiden de vardı.
- Testlerin kapsamadığı yerler (Opus §7): iki abonelik yarışı testinde olaylar oluşturulma tarihi taşımıyor (yaş kıyası ayrı testte) · kilit deposu arızası testi yalnız kilit yazımını düşürüyor · koşu sırası testi tek süreç saatiyle.

