# İstem denetimi — "promptların içinde bu yanlışlara sebep olan yazılar" — 2026-11-12

Kurucu 11-12 sabah: "ben şeyden çok şüpheleniyorum: bizim bu AI promptları içinde bu yanlışlara sebep olan yazıların bulunmasından; bunun
için Sonnet 5.5 ajanlarını gönder, emin olarak uzun uzun her yere baksınlar."

Sonuç tek cümleyle: **şüphe doğru.** Cevap isteminin kendisi, bilgi tabanında karşılığı olmayan soruda modeli kesin bir cümle uydurmaya
itiyor; kapılar da dürüst cevabı tutup uydurmayı geçiriyor.

## 1. Yöntem

- Beş Sonnet 5.5 ajanı, ayrı kapsamlarla, yalnız okuyarak (test / betik koşmadan, mühürlü dosyalara dokunmadan):
  ana cevap istemi · çıktı biçimi + istek bloğu + parça kipi · anlama katmanı + bilgi tabanının modele sunuluşu · okuyucular + kapı ·
  ölçüm raporlarından kanıt + öteki istem yüzeyleri + kuralın tarihi.
- Her çekirdek bulgu kodda yeniden doğrulandı (aşağıdaki satır numaraları `src/lib/ai/prompts.ts`, 11-12 hâli).
- Ajan dosyaları oturumun çalışma klasöründeydi; bu belge onların doğrulanmış özetidir.

## 2. Hata sınıfları (ölçümde görülen gerçek cevaplar)

| Sınıf | Örnek | Bilgi tabanı |
|---|---|---|
| F1 uydurma "yok" | "Konaklamaya dahil kahvaltı servisi bulunmuyor." | Kahvaltı hakkında kayıt yok |
| F2 uydurma "var" | "Dairede ütü bulunmaktadır." | Ütü hakkında kayıt yok |
| F3 değer taşıma | "En yakın eczane yaklaşık 150 metre ileride." | "En yakın market 150 metre ileride." |
| F4 dolaylı izin | "Mümkün. Wi-Fi şifresi …" (evcil hayvan sorusu ev sahibindeyken) | — |
| F5 düşen soru | İki sorudan biri cevaplanmadan tur "cevaplandı" | — |

## 3. Kanıt: dürüstlük tutuluyor, uydurma geçiyor

27 geliştirme ölçüm raporu (966 satır; 514'ü gpt-5.1), satırlar elle etiketlendi:

| Taslak türü (gpt-5.1) | Misafire gitti | Tutuldu |
|---|---|---|
| Bilgi tabanında dayanağı olmayan kesin cümle (uydurma) | **10 / 17** | 7 (3'ü tasarlanmış dayanak kapısı, 1'i tesadüf, 3'ü düşük güven) |
| Açık "bilgim yok" cümlesi | **0 / 22** | 22 |
| "Ev sahibimiz size bilgi verebilir" türü yönlendirme | 4 / 19 (yalnız çok soruluk mesajda yan cümle) | 15 |
| Cevap parçaları kipinde uydurma | **0** | — |

Aynı soru, aynı bilgi tabanı: model dürüst yazarsa tutuluyor, uydurursa gidiyor. (Örneklem bilerek "cevabı olmayan soru" setlerinden; üretim
hata oranı diye okunmaz — ama iki satır aynı setlerden, kıyas adil.)

## 4. Sebep: istemin kendisi (kodda doğrulandı)

| # | İstem metni (satır) | Etkisi |
|---|---|---|
| 1 | KURAL-5 (144–155): "Bilgim yok / kaydım yok / elimde yok … yazma"; KURAL-3 (126) + yönlendirme yasağı katmanı: ev sahibine yönlendirme yazma; KURAL-1 (117): "kontrol edeceğini, ileteceğini SÖYLEME"; KURAL-5: "sanırım, muhtemelen … kullanma"; 10.5: kaynak anlatma | Bilmediği soruda bir insanın kullanacağı beş çıkışın beşi de yasak. Geriye kısa, çekincesiz, atıfsız bir olgu cümlesi kalıyor — F1–F3 cümleleri tam bu biçimde. |
| 2 | "var/yok hükmü" yasağı yalnız KURAL-5'te tek parantez içi madde ve Örnek 2'nin notunda | Öteki yasaklar adıyla, tekrar tekrar; bu yasak zayıf. "Bulunmuyor / sunmuyoruz" modelin gözünde "bilgim yok" değil, bir olgu. |
| 3 | "Soruyu yanıtsız bırakmak asla kabul edilmez" (412) · "ATLAMAK … daha büyük hatadır" (530–532) · "TÜM soruları … eksiksiz yanıtla" (212) · kullanıcı isteminde "HER BİRİNİ … yanıtla ve hiçbirini atlama" (1894) | Dört yerde tamamlama baskısı; cevabı olmayan soru için istisna yok. |
| 4 | KURAL-5: tek izinli çıkış "güveni 0,4'ün altına yaz — bu metin misafire GÖNDERİLMEZ" | Çıkış TURUN TAMAMINI tutuyor. İki soruluk mesajda bildiği cevabı da kaybetmemek için model uyduruyor (ya da bir soruyu sessizce atlıyor — F5). İstek defteri kipinde söz ayrıca yanlış: cevaplanan istekler gider. |
| 5 | Güven tablosu (386–392): "bilgi tabanında karşılığı yok" satırı yok; "0,5–0,7 → bilgi eksik ama güvenli şablon var" | Konu olarak yakın bir kayıt varken model "kısmen mevcut" sayıp 0,4'ün üstünde yazıyor → cevap gidiyor. |
| 6 | KURAL-3 (126): "Bilgi tabanında yoksa: 'Bu bilgi kayıtlarımda yok.'" ↔ KURAL-5: "kaydım yok … yazma" ↔ 10.5: "kayıtlarımda … YAZMA" | Aynı istemde hem emir hem yasak. |
| 7 | Bilgi tabanı başlığı (2044): "GERÇEK BİLGİLER — sadece bunları kullan"; bütün kayıtlar tek blokta; hangi kaydın hangi soru için getirildiği yok; "bu soru için kayıt bulunamadı" işareti yok | Küçük bilgi tabanında (≤ 30 kalem) seçim hiç çalışmaz, hepsi gider. Model yakın kaydı (market ↔ eczane, restoran ↔ kahvaltı) cevap sanıyor; yeniden sıralayıcının "hiçbiri cevaplamıyor" sonucu modele ulaşmıyor. |
| 8 | İstek bloğu başlığı "CEVAPLANACAK istekler" | Liste isteğin TÜRÜNE göre kuruluyor (bilgi tabanına bakılmıyor); model "kod baktı, cevabı var" diye okuyor. "Cevabı yoksa o isteği cevaplama" kuralı yalnız arıza / evcil hayvan / yönlendirme dallarında yazılı. |
| 9 | Varsayılan ton "sıcak": "tabii ki, memnuniyetle" önerir; örneklerde "Tabii." / "Of course" açılışları | Bir istek ev sahibindeyken öteki cevabın onay sözcüğüyle açılması (F4). Yasak yalnız evcil hayvan dalında ve kısa bir sözcük listesiyle. |

### Kapı tarafı (neden durmuyor)

- "Bilgim yok" denetimi yalnız İTİRAFI tutar ("bilgi / kayıt / not" sözcüğü arar). "Kahvaltı servisi bulunmuyor" itiraf değildir; hakem
  isteminde açıkça serbest: "states a fact, including that something does not exist or is not available".
- `usedSources` (modelin kaynak beyanı) boş olsa da hiçbir kapı tutmaz; `answeredRequests` modelin kendi beyanıdır; ikisi birbirine bağlı
  değil (iki soruluk mesajda tek doğru kaynak yeter).
- Cümlenin bilgi tabanıyla desteklendiğini sınayan tek mekanizma cevap parçaları kipi (birebir alıntı kodla doğrulanır) — kapalı.
  İddia desteği ölçümü yalnız sayı / kod / iletişim bilgisi ölçer ve gölgededir; sözel uydurmayı görmez.
- Okuyucu / hakem bilgi tabanını görmüyor; "emin değilim" diyemiyor (yalnız parça okuyucusunda var).

### Tarih

- 09-11: "bilgim yok misafire gitmez" kapısı eklendi; 40 dakika sonra hazır "kayıtlı bilgim yok" paragrafı kurucu isteğiyle istemden
  kaldırıldı. O günün notu "silinirse model uydurur" diyordu; not geri çekildi.
- 10-23 / 10-29: "ev sahibimiz bilgi verebilir" türü yönlendirme de yasaklandı (istem + kod).
- Uydurma ilk kez 11-12'de ölçüldü (5 denemenin 5'i). Öncesinde "cevabı olan soru + cevabı olmayan soru" bir arada ölçülmemişti; nedensellik
  için bu belgedeki karşılaştırmalı ölçüm yapıldı (§6).

## 5. Yapılan: iki katman, iki ayrı iş

**(a) İstem katmanı — `AI_NO_SOURCE_RULE_ENABLED` (VARSAYILAN KAPALI; `src/lib/ai/no-source-rule.ts`)** — sebebi istemde düzeltir:

- Kural İSTEK BAŞINA: cevabı kaynakta açıkça yazmayan istek cevaplanmaz ve `answeredRequests`e konmaz; istek ev sahibinde açık kalır,
  öteki istekler gider. "Yok" hükmü de iddiadır; başka bir şeyin kaydındaki mesafe / saat / ücret / koşul taşınmaz; konu olarak yakın kayıt
  cevap değildir.
- "Hiçbir soruyu atlama" diyen BÜTÜN cümleler (KURAL-5, 10.5, niyet bölümü, ÖRNEK 24 başlığı, uzunluk ipucu) kaynağı olan sorularla
  sınırlandı. Güveni koşulsuz 0.4 altına indirten cümleler (KURAL-1 parantezi, KURAL-5 maddeleri) yalnız HİÇBİR istek cevaplanamadığında
  geçerli — yoksa iki soruluk turda bilinen cevap da düşük güvenle tutulurdu. KURAL-3 (kod / adres ve yol tarifi) bilgisizlik açıklaması
  yerine "o isteği cevaplama" der; güven tablosu aynı kurala bağlandı. İstek bloğuna "liste türe göre kuruldu, doğrulanmadı" cümlesi (üç
  kaynak sayılır: bilgi tabanı, mülk bilgisi, ev sahibinin bu sohbetteki açık cevabı); bilgi tabanı başlığına "yazmıyorsa yok değildir";
  iki soruluk bir örnek. (İlk yazımda altı cümle katmanın dışında kalmıştı — dilim sonu incelemesi buldu, düzeltildi.)
- YALNIZ istek defteri (konuşma öğeleri) varken: defter yoksa atlanan soru iz bırakmadan kaybolurdu.
- Kural cümleleri KONU ADI taşımaz (pinli — teste öğretme yok). İlk yazımdaki örnek sözcüklerinden ikisi mühürlü kabul setinin
  sorularında geçiyordu (set açılmadan, yalnız geçiş sayısı bakıldı); örnekler kör koşudan önce genel anlatıma çevrildi.
- Kod kapısı değişmedi: model yine de uydurursa bu katman onu DURDURMAZ.

**(b) Yapısal güvence — cevap parçaları kipi (yazılı, kapalı, kabul ölçümü bekliyor)** — uydurmayı kodla keser: model her istek için
ayrı parça + bilgi tabanından birebir alıntı yazar; alıntı gösterilen kaynakta yoksa parça gitmez; "bilgi yok" parçası boş kalır ve istek
açık kalır. Kalan açıklar ve uzun vadeli tasarım: `docs/TASARIM-2026-11-12-dayanak-ve-yetki-mimarisi.md`.

## 6. Ölçüm (gpt-5.1, gerçek model çağrıları; kimseye bir şey gitmedi)

Set: `evals/grounding-dev.json` — 43 senaryo, 62 ihtiyaç (34 cevaplanmalı, 28 açık kalmalı); sınıflar Codex'in listesinden: konu yakın ama
cevap yok · açık "yok" bilgisi var · çelişkili kayıt · yakın ama farklı varlık · ücret / mesafe / saat taşıma · ev sahibindeki konu +
cevaplanabilir soru (dört dil) · soru sırası · tek sorulu olağan cevap · üç soruda bir bilinmeyen · çok küçük bilgi tabanı.

### 6.1 Geliştirme seti — dört kol (son kod, `7c2d5edb`)

Aynı 43 senaryo, dört yapılandırma. "Cevaplanmalı" = cevabı bilgi tabanında açıkça yazan 34 ihtiyaç; "açık kalmalı" = cevabı olmayan / çelişen /
ev sahibinde kalan 28 ihtiyaç; "yanlış gönderim" = açık kalması gereken ihtiyaca cevap gitti (uydurma, taşınmış değer, çelişkide tek tarafı
seçme) ya da cevaplanması gereken ihtiyacın konusu geçti ama değeri yanlış / eksik gitti.

| Kol | Yapılandırma | Doğru cevap (34) | Gereksiz tutma | Açık kaldı (28) | 🚨 Yanlış gönderim |
|---|---|---|---|---|---|
| G1 | bugünkü hat | 24 | 10 | 19 | **9** |
| G2 | bugünkü hat + istem katmanı | 26 | 8 | 23 | **5** |
| G3 | cevap parçaları kipi + okuyucu | 30 | 4 | 28 | **0** |
| G4 | cevap parçaları kipi + okuyucu + istem katmanı | 29 | 5 | 28 | **0** |

(Raporlar: `docs/olcum/live-pipeline-2026-11-12-gpt-5.1-grounding-dev-g1f-bugun` · `-g2e-kaynak-kurali` · `-g3e-parca` ·
`-g4e-parca-kaynak-kurali`. Aynı günün önceki koşuları da saklı — kod düzeltmelerinin her adımında yeniden ölçüldü: `-g1-…` → `-g1b-…` → `-g1d-…`
vb. Koşudan koşuya oynama: bugünkü hat üç geçerli koşuda 23–25 doğru, 9 yanlış; parça kipi 30 doğru; katmanlı parça kipi 29–30.)

Okuma:

- **Bugünkü hat her koşuda 9 yanlış cevap gönderdi.** Son koşudan: "Kahvaltı hizmeti bu rezervasyona dahil değil." (kayıt yok) · "Kahvaltı
  hizmeti sunmuyorum" (kayıt yok) · çelişkili otopark kaydında "ücretsizdir" (2) · "Otogardan da … araç ayarlayabilirim, tek yön ücreti 900 TL"
  (havalimanı kaydından) · "Havuz kullanımı ücretsiz" (kayıt yok) · "Deniz Lokantası … yaklaşık 150 metre" (market kaydından) · "There is an ATM
  within walking distance" (kayıt yok) · "Saç düzleştirici … standart ekipmanlarımız arasında yer almıyor" (kayıt yok).
- **İstem katmanı yardım ediyor ama yetmiyor.** Yanlış gönderim 9 → 5. Kalan beşi: çelişkili otopark kaydında "ücretsiz" (2), havalimanı
  transferinin 900 TL'sinin otogara taşınması, "havuz kullanımı ücretsiz", "Deniz Lokantası yaklaşık 150 metre". İstem modelin eğilimini
  değiştirir; uydurmayı DURDURMAZ (kod kapısı aynı).
- **Cevap parçaları kipi iki kolda da 0 yanlış — ama bunu çoğunlukla OKUYUCU sağlıyor, alıntı kuralı değil** (kök neden incelemesi düzeltti;
  ilk yazımda "uydurma parça alıntı gösteremediği için gitmiyor" demiştim, yanlıştı). On parça koşusunda, açık kalması gereken tek ihtiyaçlı
  senaryolarda 140 denemenin 79'unda model kendisi "bilgi yok" yazdı; yazdığı 61 parçanın **11'ini kod, 49'unu yalnız okuyucu tuttu, 1'i
  geçti** ("havuz barı" — artık kodda). Çelişkili otopark, otogar transferi ve lokanta mesafesi parçaları GERÇEK bir alıntı gösteriyor (yakın
  kayıttan); kod bunlarda yalnız danışma işareti yazıyor ve aynı işaretler doğru cevaplarda da çıkıyor. Sonuç: parça kipinin güvencesi
  "parça yapısı + okuyucu"dur; okuyucu 50'de 1 kaçırdı. Bu, D-4'ü (okuyucu iki okuma) ve kod tarafını güçlendirecek dilimleri (ücret
  çelişkisi, değerin hangi nesneye ait olduğu) daha önemli kılıyor.
- **Bugünkü hat dürüst cevabı tutuyor.** G1'in 10 gereksiz tutmasının 6'sı, modelin bir soruya dürüstçe "bu konuda bilgim yok" yazdığı çok soruluk
  cevaplar: "bilgim yok" kapısı turun TAMAMINI tutuyor, öteki soruların doğru cevabı da gitmiyor (§3'teki tablonun bu setteki karşılığı).
- **Parça kipinde kalan tutmalar:** dördü tasarım gereği tur kemeri — evcil hayvan sorusu olan turda yanındaki cevap (3 senaryo — S3 kararı),
  erken giriş isteği olan turda yanındaki Wi-Fi cevabı (1). G4'teki beşinci: "ATM var mı? En yakın market nerede?" tek istek sayıldı, parça
  yalnız marketi cevapladı, okuyucu "yarım" dedi → istek açık kaldı, market cevabı da gitmedi (yanlış değil, eksik; koşudan koşuya değişiyor).

### 6.2 Ölçümde bulunan kod hataları (hepsi düzeltildi)

İlk ölçümde parça kipi 14–17 doğru cevabı gereksiz tutuyordu. Her tutmanın ham parçası çıkarılıp kodda yeniden üretildi; sebeplerin çoğu modelde
değil, doğrulayıcı / okuyucu kodundaydı. Bir kısmı aynı zamanda yanlış cevabı GEÇİREN delikti. Dilim sonu incelemesi (Opus) benim ilk
düzeltmelerimden ikisinin de delik açtığını gösterdi; onlar da düzeltildi (`docs/INCELEME-2026-11-12-opus-dayanak.md`).

| # | Sebep | Etki | Düzeltme |
|---|---|---|---|
| 1 | Etiketli, rakamsız değer: kayıtta `Ağ adı: Lale_Home` tırnaksız (kod sayılmıyor), cevapta tırnaklı (kod) → "değer alıntıda yok" | 8 tutma (Wi-Fi cevapları) | Kayıt tarafında etiketli rakamsız değer kod iddiasıdır ve öteki değerlerle AYNI denetimlerden geçer: aynı etiket ailesi (ağ adı "şifre" diye verilemez) + değerin cümlesi ihtiyacın konusuna bağlı (kapı kodu Wi-Fi şifresi olamaz) + harf birebir. (İlk düzeltmem bir "kısa yol"du; başka nesnenin değerini ve harf farkını geçiriyordu — kaldırıldı.) |
| 2 | Değer ayıklayıcı "Wi-Fi şifresi: …" yazımında "şifresi" sözcüğünü aday alıp reddediyor, asıl etiketi hiç denemiyordu | Tırnaklı, rakamsız şifre HİÇ denetlenmiyordu (delik) | Reddedilen adayda tarama adayın başına döner (doğrusal, süre pinli) |
| 3 | "çamaşır" sözcüğü fiil sanılıyordu ("6+ harf, -ır ile bitiyor") → "makinesi" konu sözcüğü oluyor, "Kurutma makinesi yoktur." çamaşır makinesinin cümlesi sayılıyordu | 1 tutma + **delik**: "Çamaşır makinesi yoktur." (dayanak: kurutma cümlesi) geçiyordu | Kural biçimbilimsel geniş zaman kuyruğuna daraltıldı |
| 4 | İki tesisli kayıtta olumluluk kaydın bütününden okunuyordu | 2 tutma + **delik**: tek cümlelik karışık kayıtta yer değiştirmiş cevap geçiyordu | Olumluluk tesis başına ve HÜKÜM VEREN yan cümleden (yüklem, olumsuzluk ya da yer eki taşıyan); hüküm vermeyen yan cümle aynı cümledeki sonraki hüküm verenin olumluluğunu alır |
| 5 | Müsaitlik iddiası denetimi "20:00." sonrasını cümle sonu saymıyordu → "every day … available" takvim iddiası sanılıyordu | Bugünkü hatta da tutma (iki soruluk İngilizce cevap) | Saatten sonraki nokta cümle sonu — YALNIZ cevap tarafında (aynı bölücü misafir mesajındaki istek tespitinde de kullanılıyordu; orada isteğin türünü değiştiriyordu, ayrıldı) |
| 6 | Okuyucu, birinci tekil "transferi ben ayarlıyorum, ücreti 900 TL" cümlesini "bana ödeyin" sayıyordu (8 okumanın 8'i) | 1 tutma | Ücret satırı netleştirildi: yalnız-fiyat 0/36 yanlış tutma; "bana elden / IBAN / kapıda" 24/24 tutuldu |
| 7 | Okuyucu, taslak bir soruya hiç değinmediğinde "bilgim yok dedi" oyu verip kanıt olarak selam satırını ya da taslakta olmayan uydurma bir cümleyi gösteriyordu | 2 tutma | Selam satırı kanıt değil; itirafı yalnız misafir mesajını gören okuma gördüyse kelime kuralı da görmeli (gerçek itiraf 51/51 tutuldu, sessiz taslak 0/69) |
| 8 | "misafir" sözcüğü (3. düzeltmeden sonra) konu sözcüğü oldu: "Misafir otoparkı ücretsizdir." kaydı "misafir getirmek ücretli mi" sorusuna dayanak oluyordu | **delik** (ölçümde görülmedi, incelemede bulundu ve kodda doğrulandı) | Rol adı tek başına konu değildir; özgül sözcüğün yanında düşer, "misafir odası" gibi tamlamada kalır |
| 9 | "Havuz barı kaça kadar açık?" → model üç koşunun üçünde havuzun saatini yazdı; parça okuyucusu birinde geçirdi. Kod "barı"yı tesis saymıyordu ve eksik tesis okuyucu kipinde yalnız danışmaydı | 1 yanlış gönderim (G3'ün önceki koşusu) | Kısa tesis kökünde ad çekimi tanınır; istek iki tesis adlandırıyor ve parça birini hiç anmıyorsa okuyucu kipinde de KODDA tutulur |

Kanıt: her düzeltme kırmızı-önce testli; mutasyon turları (son turlar 43/44 — yaşayan pinlendi — + 7/7 + 5/5); Haiku dar incelemesinin kodda
doğrulanan bulguları ayrıca düzeltildi; ölçerin kendisi de düzeltildi (bir yanlış gönderimi saymıyordu — §6.5).

### 6.3 Yan bulgu — çok mesajlı tur

Misafir son cevabımızdan sonra iki mesaj yazdıysa ("Otopark var mı?" · "Bir de çıkış saati kaç?") bugün cevap çoğunlukla yalnız son mesajı karşılıyor
(otopark sorusu istek defterinde açık kalıyor). Sebep yine istemin yapısı: "misafir mesajı" bloğu yalnız son mesajı taşıyor.
`AI_TURN_MESSAGES_ENABLED` (KAPALI) bloğa cevapsız mesajların hepsini koyar. 16 senaryoluk geliştirme setinde (`evals/turn-messages-dev.json`;
24 cevaplanmalı / 4 açık kalmalı ihtiyaç), son kodla:

| | Doğru cevap (24) | Yalnız son mesaj cevaplandı | 🚨 Yanlış gönderim |
|---|---|---|---|
| Bugünkü hat | 16 | 5 | 0 |
| Parça kipi + okuyucu + katman, anahtar kapalı | 18 | 4 | 0 |
| Parça kipi + okuyucu + katman, anahtar açık (iki koşu) | 22 · 22 | 0 · 0 | 0 · 0 |

Açık kolda kalan iki tutma tasarım gereği tur kemeri (evcil hayvan / geç çıkış isteği olan tur).

🚨 **Anahtar parça kipi OLMADAN açılamaz — kemer artık kodda.** İlk ölçümde (kemer yokken) bugünkü hatta anahtar açılınca doğru cevap 15 → 21
oldu ama iki koşunun ikisinde 2 yanlış gönderim çıktı: önceki mesajdaki bilgi tabanında OLMAYAN soru da cevaplanmaya başladı ve model uydurdu
("Yes, there is an iron in the apartment."). Bugün o soru görmezden gelindiği için tesadüfen gitmiyordu. Parça kipinde her cevap parçası
alıntıyla doğrulandığı için aynı yan etki yok; kod, tur parça kipinde değilse bloğu eski biçimde bırakır. Ayrıca: mesajlar farklı takvim
günlerindeyse (dünkü "yarın" bugüne göre okunmasın) ya da çok sayıda / çok uzunsa eski biçim; her mesaj tek satırdır (misafir sahte etiket kuramaz).

### 6.4 Görülmemiş (kör) set — HENÜZ KOŞMADI

Ayrı yazarın yazdığı, geliştiricinin açmadığı 74 senaryoluk kabul seti hazır ve mühürlü (118 ihtiyaç: 64 cevaplanmalı / 54 açık kalmalı; yedi
dil). Beş kol (bugünkü hat · katman · parça kipi · parça + katman ×2) iki kez başlatıldı, ikisi de çıktı yazmadan durdu: ilki ölçüm ortamı
yeniden başladığı için, ikincisi **OpenAI hesabının kredisi bittiği için** (`credit_balance_exhausted` — cevap modeli ve embedding birlikte).
İkinci koşu anlamsız sonuç üretmeden elle durduruldu. Rapor / ayrıntı dosyası yazılmadı, mühür "sealed", setten hiçbir şey görülmedi.

Kredi eklenince koşacak komut (kol başına bir kez, her kol ayrı ölçüm veritabanında, paralel):

```
TEST_DATABASE_URL=postgresql://postgres@localhost:5436/<veritabanı> RUN_REAL_EVAL=1 EVAL_LIVE_PIPELINE=1 NODE_USE_ENV_PROXY=1 EVAL_BUDGET_USD=3 \
AI_CODE_GREETING_ENABLED=1 AI_KB_FEE_RULE_ENABLED=1 AI_HOST_DECISION_HOLD_ENABLED=1 AI_ACCESS_CODE_COMPLETE_ENABLED=1 \
AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1 EVAL_SEALED_FINAL=1 EVAL_SEALED_NAME=<dayanak kabul seti> EVAL_LIVE_TAG=<kol etiketi> <kolun bayrakları> \
npx vitest run --config vitest.eval-live.config.ts tests/eval/live-pipeline.eval.test.ts
```

| Kol etiketi | Kolun bayrakları |
|---|---|
| `dayanak-g1-bugun` | (yok) |
| `dayanak-g2-katman` | `AI_NO_SOURCE_RULE_ENABLED=1` |
| `dayanak-g3-parca` | `AI_ANSWER_PARTS_ENABLED=1 AI_ITEM_ORDINAL_ENABLED=1 AI_SENIOR_READER_ENABLED=1` |
| `dayanak-g4-parca-katman` (iki kez) | parça bayrakları + `AI_NO_SOURCE_RULE_ENABLED=1` |

Koşu sürerken çalışma ağacında commit yapılmaz (rapor commit kimliğini koşu sonunda okur). Koşu bitince: mühür kaydı "burned", rapor yolları
erişim pinine, ayrıntı dosyasından neden analizi.

Tahmini maliyet: kol başına ~1 ABD doları (geliştirme setinde 43 senaryo 0,37–0,57 dolar tuttu). **Bu sonuç görülmeden parça kipi ve katman
için "açılabilir" denmez** — geliştirme seti benim yazdığım, düzeltmeleri üzerinde yaptığım settir.

### 6.5 Ölçerin kendi hataları (düzeltildi)

- Kayıtlı bir raporda uydurma "There are ATMs available in the area" cevabı misafire gitmiş ve yanlış gönderim SAYILMAMIŞTI (yasak desen
  çoğulu kaçırıyordu). İlk tabloda bugünkü hat "9 yanlış" görünüyordu; gerçekte en az 10'du.
- Yanlış değer giden ihtiyaç, öğe eşleşmesi kurulamazsa "gereksiz tutma" sayılıyordu. Artık ihtiyaca konu deseni yazılır: konu giden metinde
  geçip beklenen değer yoksa yanlış gönderimdir; "metin gitti ama bu ihtiyacın değeri yok" ayrı satırdır.
- Zayıf beklentiler sıkılaştırıldı; konu deseni eklenince doğru cevabın farklı yazımları da kabul edilir hâle getirildi (yoksa doğru cevap
  yanlış sayılırdı). Kör koşunun ayrıntı dosyası yalnız eksiksiz biten koşuda yazılır.
- 🚨 Çok mesajlı tur ölçümü İstanbul saatiyle 00:00–00:40 arasında koşmaz: senaryo mesajları onar dakika arayla geriye dizilir, önceki mesaj
  düne düşer ve gün şartı bloğu kapatır (ölçüm yanlış kolu ölçer).

### 6.6 Her hatanın kök nedeni (Opus incelemesi)

Kurucunun isteğiyle, bütün geliştirme koşularındaki her hata tek tek incelendi: `docs/INCELEME-2026-11-12-kok-neden.md` (sınıf tablosu,
hata başına zincir, kanıt gücü). 153 giden metin bilgi tabanıyla elle karşılaştırıldı: ölçerin kaçırdığı yanlış 0, doğruyu yanlış saydığı
satır 0. Belgelerde yazmayan ve kodda / veride doğruladığım bulgular:

| Bulgu | Durum |
|---|---|
| Parça kipinin "0 yanlış"ı çoğunlukla okuyucudan geliyor (yukarıda) | Belge düzeltildi; D-4 ve D1d |
| "Otoparkla ilgili bilgi şu anda burada paylaşılmamış." bugünkü hatta misafire GİTTİ (bilgisizlik kuralı bu edilgen yazımı görmüyordu) | Dar kuralla kapatıldı (bilgi nesnesi + "burada" + edilgen olumsuz), iki yönlü pinli |
| Ücret çelişkisi ("ücretsiz" ↔ "200 TL") kodun hiçbir yerinde görülmüyor: seçici ve istem yalnız SAAT çelişkisini biliyor; parça doğrulayıcısı "ücretsiz"i değer saymıyor — her koşuda yalnız okuyucu tuttu, bugünkü hatta 10/10 gitti | Tasarımda D1d; bu turda uygulanmadı (canlı ölçüm yapılamıyor) |
| "history" kaynağı içeriğe bakılmadan doğrulanıyor (geçmişte herhangi bir giden mesaj yeter) — geç mesaj turunda uydurma "kaynaklı" görünür | Yalnız kayıt alanı (kapı okumuyor); tasarımda D2 |
| Parça kipi dışında boş cevap "model arızası" sayılıyor ve en çok üç kez faturalı yeniden deneniyor; istem katmanı "yazman gerekmez" deyince tek bilinmeyen soruluk turda daha sık oluyor (Almanca kahvaltı: 13 denemenin 6'sı) | İstem katmanı parça kipsiz açılmadan ÖNCE düzeltilecek (kayıt) |
| Sıra kipi kapalıyken aynı türden iki soru tek öğede birleşiyor: katmanlı kolda cevap boşuna tutuluyor (8/8), bugünkü hatta bilinmeyen soru sessizce "cevaplandı" kapanıyor | Sıra kipi parça kollarında açık; bugünkü hat için ayrı karar (kayıt) |
| Taban istem "mesajınız kaydedildi, ev sahibiniz görebilir" cümlesini 33 yerde öğretiyor, çıktı vetosu aynı cümleyi tutuyor | Bilinen çelişki — `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §11 (kurucu kararı bekliyor) |
| Okuyucu setindeki üç "iletişim" fazla oyu: beklenti okuyucunun kendi tanımıyla çelişiyor (ödemeyi platform dışına taşımak tanımda iletişim de sayılıyor) | Davranış etkisi yok; set beklentisi düzeltilecek (kayıt) |
| Ölçerin dört kör noktası (aynı türden iki ihtiyaçta öğe durumu · edilgen itiraf deseni · bu sette altı kaydın aynı kaynak etiketine düşmesi · düşen satırın "model cevap vermedi" sayılması) | Bugün sonucu değiştirmedi; ölçer işi (kayıt) |

## 7. Öteki istem yüzeyleri

- QR misafir sohbeti aynı cevap istemini kullanır ve misafire doğrudan yazar; istek defteri / dayanak kapıları orada yok → aynı uydurma
  kalıbı QR'da daha az kapıdan geçer. Katman QR'da etkisizdir (defter yok); QR için karar ayrı (tasarım belgesinde).
- Çevirmen, karar yazıcısı, ev sahibi cevabını biçimleyen kurucu: arada ev sahibi var ya da girdiye sıkı bağlı — uydurma kaynağı değil.
- Kalite denetçisi yalnız kaynak etiketlerini görür (bilgi tabanı metnini değil): F1 / F2 sınıfını ayıramaz.

## 8. Kurucuya sorular

Örnek cevaplar ev sahibinin ağzından yazılmıştır (misafire giden metin böyle olur).

**D-1 · Uydurma sorunu için hangi yol?** Bugünkü hat bilgi tabanında karşılığı olmayan soruya kesin cümle kurabiliyor (geliştirme setinde
her koşuda 9 yanlış).

- Misafir: "Wi-Fi şifresi ne? Kahvaltı dahil mi?" (bilgi tabanında Wi-Fi var, kahvaltı hakkında kayıt yok)
  - Bugün giden: "Wi-Fi ağ adı Lale_Home, şifre Lale2024. Kahvaltı hizmeti bu rezervasyona dahil değil."
  - Parça kipiyle giden: "Wi-Fi ağ adı Lale_Home, şifre Lale2024." — kahvaltı sorusu size açık kalır (panelde "cevap bekliyor").
- Misafir: "Otogardan transfer ayarlıyor musunuz, ne kadar?" (kayıtta yalnız havalimanı transferi: 900 TL)
  - Bugün giden: "Otogardan da … araç ayarlayabilirim, tek yön ücreti 900 TL'dir."
  - Parça kipiyle: bir şey gitmez, soru size kalır.

Seçenekler: **(A — önerim)** cevap parçaları kipi + okuyucu + istem katmanı birlikte (geliştirme setinde 0 yanlış; bedeli: cevap başına bir ek
model çağrısı ve daha çok "size kalan" soru) · (B) yalnız istem katmanı (9 → 5; durdurmaz) · (C) şimdilik aynı kalsın. Hangisi olursa olsun
karar kör set sonucundan SONRA verilmeli (§6.4 — kredi bekliyor).

**D-2 · Kör koşu için OpenAI kredisi.** Hesapta kredi kalmadı; kabul ölçümü (dayanak beş kol + geç mesaj üç kol, toplam ~8–10 dolar) ve
bundan sonraki her gerçek model ölçümü bunu bekliyor. Kredi eklediğinizde haber vermeniz yeter.

**D-3 · Çok mesajlı tur.** Parça kipi açıldıktan sonra açılsın mı?

- Misafir 10:00 "Otopark var mı?" · 10:01 "Bir de çıkış saati kaç?"
  - Bugün giden: "Çıkış saatimiz 11:00." (otopark sorusu cevapsız, size kalıyor)
  - Açıkken (parça kipiyle): "Otoparkımız ücretsizdir; binanın arkasındadır. Çıkış saatimiz 11:00."

**D-4 · Parça okuyucusu iki kez okusun mu?** Ölçümde okuyucu aynı yanlış parçayı üç koşunun birinde geçirdi (o sınıf kodda kapatıldı, ama
okuyucunun tek okumayla kaçırabildiği görüldü). İki okuma (biri "cevaplamıyor" derse tut) kaçırmayı azaltır; bedeli cevap başına bir çağrı
daha ve biraz daha fazla tutma. Önerim: kör set sonucuna bakıp karar vermek — yanlış gönderim çıkarsa aç.

**D-5 · Evcil hayvan / erken giriş turunda yandaki cevabın tutulması** (S3 kararı) parça kipinde de sürüyor (geliştirme setinde 4 tutma).
Değişiklik istemiyorsanız böyle kalır; S3'ün açılması ayrı karar (`docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §3).
