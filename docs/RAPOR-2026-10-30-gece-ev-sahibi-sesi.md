# 10-30 gece raporu — "Mesajı ev sahibi yazıyor" (kurucu 10-30) + WhatsApp + ölçümler

> Kısa özet kurucu için. Ayrıntı: `docs/claude/durum.md` (10-30 akşam-2), kural metni `docs/claude/ai-guvenlik.md`.

## 1. Ne yapıldı

| İş | Durum |
|---|---|
| Ses kapısı (`reply_host_voice`): üçüncü kişi ev sahibi, iç sistem anlatımı, üçüncü taraf işletmeye yönlendirme misafire gitmez; kanal + QR, kapının EN SONUNDA | kodda, varsayılan AÇIK (acil durdurma `AI_HOST_VOICE_GUARD_DISABLED=1`) |
| İstem kuralı: cevap ev sahibinin ağzından (birinci çoğul kişi); "ev sahibinize yazın / gerek yok" yok; ev sahibinin kendi hizmeti önerilir | kodda |
| "Binada sauna var. Detaylar için ev sahibinize yazabilirsiniz." → "Binada sauna var." gider, soru size açık kalır | kodda |
| Okuyucu açıkken ses ihlalinde cevap bir kez ev sahibinin ağzından yeniden yazılır | kodda (kanal + QR) |
| Prompt caching (OpenAI): amaç anahtarı + 24 saat | kodda (acil durdurma `OPENAI_PROMPT_CACHE_DISABLED=1`) |
| WhatsApp ev sahibi döngüsü: tasarım + saf parçalar (soru metni, eşleştirme, cevap türü, cevap kurucu + kod denetimi, Meta imza / ayrıştırma / gönderici, kanal yönlendiricisi) | kodda, bağlı DEĞİL; migration 88 hazır yamada (onay bekliyor) |
| Eski testlerin 25 kırmızısı | kapandı: 1 gerçek hata (erken giriş teşhisi) düzeltildi, 24 test sabiti üçüncü kişiden ev sahibinin sesine çevrildi + eski metnin artık TUTULDUĞU ayrıca pinlendi |
| Süre pini (50.000 karakter) 1,5 sn sınırını aşıyordu | sebep bulundu ve düzeltildi (sınır gevşetilmedi): 1.550 → 680–950 ms |

## 2. Ölçümler (gerçek model, toplam ≈ 0,70 $)

**135 senaryo (önceki istem → yeni istem):** sızıntı 0/52 → 0/52 · doğru bilgi 51 → 55/55 · üçüncü kişi ev sahibi içeren cevap 54 → 41/135 ·
otomatik GİDEN ihlal 1 → 0.

**Yedi dilde 280 zor örnek (gpt-5.1 üretti; her dilde 8'er: üçüncü kişi ev sahibi / iç sistem anlatımı / üçüncü taraf yönlendirme / temiz / temiz-tuzak):**

| Tür | Bugünkü kod kapısı tutuyor | Kıdemli okuyucu (model) tutuyor |
|---|---|---|
| Üçüncü kişi ev sahibi | 53/56 | 56/56 (deneme istemi) |
| İç sistem anlatımı ("kayıtlarımda yok", "ilanda belirtilmemiş") | 27/56 | **56/56** (bugünkü okuyucu, değişiklik yok) |
| Üçüncü taraf yönlendirme | 5/56 | 56/56 (deneme istemi) |
| Temiz cevap yanlış tutuluyor | 1/112 (ses kapısı) | 0/112 (bugünkü okuyucu) · 2/112 (deneme istemi) |

Sonuç: anlamı **model** okuyor (kurucunun 10-30 tercihi); kod kapısı yedek. İç sistem anlatımı için bugünkü okuyucu yeterli —
**`AI_SENIOR_READER_ENABLED=1` Railway açılış listesinde olmalı.**

**Üçüncü taraf yönlendirme — iki deneme (ikisi de gerçek model, aynı 280 örnek):**
- Bugünkü kıdemli okuyucuya EK SORU olarak: yönlendirmelerin hepsi yakalandı ama temiz "tuzak" cevapların 7–18'i / 56 yanlış işaretlendi —
  özellikle ev sahibinin KENDİ transferi ("Havalimanı transferini ben ayarlayabilirim") ve "karşıda eczane var" gibi cevaplar. Bu sizin
  gitmesini istediğiniz cevaplar → bu yol GERİ ALINDI, koda girmedi.
- AYRI, kısa, odaklı bir denetim çağrısı olarak (yalnız taslağı okur): yönlendirmelerin 56/56'sı (41 özel işletme + 15 kamu kurumu ayrı
  ayrı), temiz 112 cevapta yalnız 2 yanlış. Bedeli: otomatik cevap adayı başına bir küçük çağrı daha (≈0,001 $, ~1 sn).

## 3. Sorular (yalnız gerçekten karar gerektirenler)

**S-1 — Üçüncü taraf yönlendirmesi için ayrı denetim çağrısı kurulsun mu, kamu kurumu dahil mi?** Özel işletmeye yönlendirme (taksi, otel
resepsiyonu, restoran, araç kiralama) sizin kararınızla zaten gitmeyecek; kod kapısı bugün bunun yalnız 5/56'sını yakalıyor. Önerim: yukarıdaki
ayrı odaklı denetim (56/56, temizde 2/112). Yeni bir model çağrısı olduğu için onayınızla kurarım. Açık kalan: kamu kurumları.
- Örnek: misafir "Pasaportumu kaybettim" → cevap "Konsolosluğunuzla iletişime geçmeniz gerekiyor." · misafir "Doktora ihtiyacım var" → "En yakın
  hastaneye gidebilirsiniz." · "Şehir turu için meydandaki turizm ofisine danışabilirsiniz."
- **A (önerim):** kamu kurumu yönlendirmesi GİDER (acil / resmi işler için doğru bilgi; ev sahibinin kazancıyla çakışmaz), yalnız özel işletme tutulur.
- **B:** kamu kurumu da tutulur, ev sahibine sorulur.

**S-2 — Birinci kişi erteleme ("Teras kullanımı bizim kararımızdır") konaklama DIŞI konuda gönderildikten sonra misafir "teşekkürler" derse:**
bugün konuşma listeden düşebilir (sözcük dedektörü yalnız üçüncü kişiyi tanıyor; konaklama değişikliğinde karar kaydı zaten koruyor).
- **Önerim:** kapanış dedektörü birinci kişi ertelemeyi de tanısın → konuşma listede kalır (misafire giden metin değişmez). Onay verirseniz yapıyorum.
- Not: canlı durum belgesine göre `AI_HOST_DECISION_HOLD_ENABLED=1` (sizin beyanınız). Bu anahtar açıkken de bugün yalnız ÜÇÜNCÜ kişi "ev sahibinin
  kararı" cümlesi tutuluyor; istem artık birinci kişi yazdırdığı için "Bu bizim kararımızdır" ertelemesi konaklama dışı konuda gidebilir
  (konaklama değişikliğinde iki model zaten tutuyor). Aynı öneri kapsamında.

**S-3 — Migration 88 (WhatsApp için iki YENİ tablo; dolu tabloya dokunmaz):** onay + taze `pg_dump` ile ana dala alınır. Hazır yama:
`docs/hazir-yamalar/2026-10-30-migration-88-host-channel.patch`.

## 4. Sıradaki iş (sorusuz, kuralınızın uygulaması)

- İstemde hâlâ ~30 yerde üçüncü kişi kalıp var ("Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir"). Yeni kural
  bunları geçersiz kılıyor ama model yine de 41/135 cevapta üçüncü kişi yazıyor (hepsi şikâyet / devir; misafire GİTMİYOR, ama size gelen
  taslak da üçüncü kişi oluyor). Kalıplar ev sahibinin sesine çevrilecek, 135 senaryoda önce / sonra ölçülecek.
- Okuyucuya üçüncü taraf işletme sorusu (S-1 cevabınıza göre kamu kurumu dahil / hariç).
- WhatsApp: migration 88 onayından sonra kanca ucu + kayıt defteri + Tür A bağlantısı.

## 4b. S-1 sonucu (kurucu onayı 10-30: "S-1 yeni model çağrıları yapabilirsin sormana gerek bile yok")

Kuruldu: `ai/semantic/referral-judge.ts`, anahtar `AI_REFERRAL_JUDGE_ENABLED` (yalnız `AI_SENIOR_READER_ENABLED=1` ile). Kıdemli okuyucunun iki
okumasıyla paralel tek çağrı; özel işletmeye yönlendirme ya da üçüncü kişi ev sahibi → `reply_host_voice` + bir kez ev sahibinin ağzından yeniden
yazma. Kamu kurumu sizin cevabınıza kadar GİDER (yalnız ölçülür).

| Gerçek model (10-30) | Denetim tutuyor | Bugünkü kod |
|---|---|---|
| Kör set (ayrı yazar, 7 dil): özel işletmeye yönlendirme | **41/42** | 4/42 |
| Kör set: kamu kurumu (tutulmamalı, ayrılmalı) | 21/21 ayrıldı, 0 tutuş | 0 |
| Kör set: ev sahibi kendisi ayarlıyor / yer bilgisi / acil / düz bilgi (77) | **0 yanlış tutuş** | 0 |
| Geliştirme seti: üçüncü kişi ev sahibi | 56/56 | 53/56 |
| Geliştirme seti: 112 temiz cevap | 1 (kodun da tuttuğu "хозяева животных" = evcil hayvan sahipleri) | 1 |

Kaçan tek örnek: "Marta's Laundry … same-day service, so you may want to drop your clothes off before noon." — denetim bunu "müşteri olarak
gitme daveti" saydı (istemdeki yer bilgisi istisnası); sınırda bir örnek.

Kamu kurumu sorusu (S-1'in ikinci yarısı) hâlâ açık: **A** (önerim) gider · **B** tutulur, ev sahibine sorulur.

## 4c. Yayın öncesi çekişmeli inceleme (10-30 gece, 74 ajanlı iş akışı; doğrulayıcıların çoğu limit yüzünden yarıda kaldı, aşağıdakiler elle doğrulandı)

| Bulgu | Sonuç |
|---|---|
| **B** "Erken giriş yapabilirsiniz. Erken giriş için bir gün önceden ev sahibinize haber verin." → koşul silinip yalnız "Erken giriş yapabilirsiniz." gidiyordu (Türkçe "-ebilirsiniz" izin sayılmıyordu; Türkçe ayağı bu turun gerilemesi, ispanyolca / fransızca / almanca / rusça / arapça ayağı öncesinde de vardı) | **Düzeltildi**: koşulu silinen izin cümlesi varsa cevabın tamamı tutulur (7 dil). 3.274 gerçek cevapta değişen sonuç 0. |
| **C** "Binada sauna var. Wi-Fi şifresi … Detaylar için ev sahibinize yazın." (iki soru) → cevaplanmayan "sauna kaçta açık?" "cevaplandı" sayılıyor, cevaplanan Wi-Fi açık kalıyordu | **Düzeltildi**: konusuz "detaylar için" silmesi birden çok soru varken hiçbir soruyu kapatmaz; bilgi yine gider. |
| **F** QR'da (istek defteri yok) yeni istem kuralı "o isteğe hiç değinme" ev sahibine kalan isteği sessizce düşürüyordu | **Düzeltildi**: 10-29 iki hakem ilkesine dönüldü — "atlama" talimatı yalnız defterli öğe kipinde; başka yerde devir kuralı (cevap misafire gitmez, ev sahibine kalır). |
| **H** "Lale Taksi durağı 100 m ileride, onları arayabilirsiniz." gidiyordu (cümlede 100 / 110 / 155 / "acil" geçince acil muafiyeti) | **Düzeltildi**: muafiyet yalnız gerçek acil çağrı talimatında. |
| **E** Railway'de `OPENAI_PROMPT_CACHE_RETENTION=` boş bırakılırsa 24 saat önbellek sessizce kapanıyordu | **Düzeltildi**: yalnız `in_memory` kısaltır. |
| **A** Kodla kurulan erken giriş POLİTİKA metni "…kararı ev sahibiniz verir / your host decides" (ses kapısı kodla kurulan metni muaf tutuyor) | **Eski durum, sizin kararınızı bekliyor** (SABAH-KARARLARI 10-01 §2). `AI_HOST_DECISION_HOLD_ENABLED=1` açıkken zaten tutuluyor; anahtarsız kurulumda gider. Metnin ev sahibinin ağzından yazılması önerilir ("Erken giriş o günkü temizliğe bağlı; size biz döneceğiz." değil — bekleme sözü yasak; önerim: "Erken giriş o günkü temizliğe bağlıdır; uygun olursa onaylarız." — misafire gideni değiştirdiği için onayınızla). |
| **D** WhatsApp cevap kurucusunun kod denetimi Arapça / Farsça rakamları görmüyor | **Düzeltildi** (WhatsApp inceleme düzeltmeleri: rakamlar denetimden önce ASCII'ye çevrilir). |

## 4d. WhatsApp — gelen uç (web kancası) kodda (10-30 gece-3, anahtarlar KAPALI)

Ne yapıyor: Meta'nın gönderdiği mesajı alır → imzayı doğrular → yalnız GÖNDEREN NUMARADAN işletmeyi bulur → iki şeyi işler: **numara bağlama
kodu** (`LIXUS-7F3K2Q`, ev sahibinin kendi WhatsApp'ından) ve **"DUR" / "STOP"** (bağlantıyı kapatır, "WhatsApp bildirimleri kapatıldı."
der — tasarım §3.5'teki cümle). Ev sahibinin soruya CEVABININ bağlanması sonraki dilim; o gelene kadar `HOST_QUESTIONS_ENABLED` kapalı kalmalı.

Gece modunda sormadan seçtiklerim (hepsi geri alınabilir, misafire giden hiçbir şeye dokunmuyor):

| # | Seçim | Neden |
|---|---|---|
| W1 | Adres tasarımdaki gibi `/api/webhooks/host-channel/whatsapp`; sabit rota (sağlayıcı başına ayrı dosya) | `[provider]` değişkenli rota yerine; aynı adres, daha az kapı |
| W2 | Anahtar kapalıyken el sıkışma da 403 (uç tamamen uyur) | Tasarım §5.1; kurulum sırası Railway belgesine yazıldı: önce anahtar, sonra Meta'da abonelik |
| W3 | Anahtar açık ama sır eksik → 200 + alarm (bir kez + günde bir hatırlatma) | Ödeme web kancasıyla aynı desen; sessiz kayıp yok |
| W4 | "DUR" yalnız DUR / STOP (mesajın tamamı); "iptal" / "durdur" artık kapatmaz | Tasarım §3.5 / §8; "iptal edilsin mi?" sorusuna "İptal" diyen ev sahibinin bağlantısı sessizce kopuyordu |
| W5 | Bağlama kodu doğrulanınca WhatsApp'tan "bağlandı" mesajı GİTMEZ (ekran gösterir) | Tasarım §5.4; yeni cümle sizin onayınız olmadan eklenmedi. İsterseniz: "Lixus bildirimleri bu numaraya bağlandı." |
| W6 | Teslimatta bizim numaramızdan başka numara kimliği varsa hepsi yok sayılır | Karışık teslimatta mesaj başına ayrım yerine en güvenlisi |
| W7 | Bilinmeyen numaradan gelen mesaj: hiçbir kayıt, hiçbir cevap | Numara yoklanamaz; dünyanın her yerinden gelen mesaj seli veritabanına yazı açmaz |
| W8 | Doğrulama anında kullanıcının rolü yeniden okunur (personele düştüyse bağlanmaz); eşzamanlı yanlış kodlar sayacı 5'i aşamaz | Tasarım §5.3; yarış testiyle |

**Kanıt (K2):** kırmızı-önce (eski kodda 5 + 3 dosya, inceleme düzeltmelerinde 12 test kırmızı) · mutasyon web kancası 36/38 (W-08 sonra
pinlendi; W-36b gerekçeli EŞDEĞER: alarm freni yalnız sorgu sayısını azaltır, veritabanı durumu aynı) · Ayarlar 16/16 · Haiku 5 bulgu ✅ ·
sert inceleme iş akışı (4 mercek + bulgu başına çürütücü, 25 ajan) 21 bulgu → 20 doğrulandı, 16'sı düzeltildi. Önemlisi (P2): anahtar açık
ama gelen uç yarım yapılandırılmışken WhatsApp'a soru gitmeye devam ediyor, ev sahibinin cevabı ve "DUR"u yutuluyordu → artık iki yön
birlikte hazır değilse soru gitmez (e-posta), yanlış yapılandırmada 503 (Meta yeniden dener). Kabul edilen 4 küçük kalan: anahtar KAPALIYKEN
gelen "DUR" işlenmez (uç uyur; yeniden açılınca ev sahibi tekrar yazmalı) · yan etki ile "bitti" işareti ayrı yazılır (tekrarda etki
idempotent) · gerçek bir teslimattan sonra sahte imzalı istek bir alarm daha üretebilir (en çok gerçek teslimat sayısı kadar) · rota kapsam
tarayıcısını dolaylı geçer (davranış testleri asıl koruma).

**Ayarlar kartı (aynı gece):** Ayarlar › Bildirimler'in altında "WhatsApp bildirimleri" — yalnız anahtar açık + işletme listede + numaramız
(`WHATSAPP_BUSINESS_NUMBER`) tanımlıyken görünür. Ev sahibi numarasını yazar, rıza kutusunu işaretler, "Kodu al" → `LIXUS-7F3K2Q` + "WhatsApp'ta
aç" düğmesi (kod hazır yazılı açılır) → gönderir → kart "Bağlı numara: +•• ••• ••• •• 67" der. Başka hesapta bağlı numara için tek genel cümle
(numara yoklanamaz), kullanıcı başına 15 dakikada 5 deneme, her kullanıcı yalnız KENDİ numarasını görür / kaldırır, personel ve destek görünümü
yazamaz.

Ekranda / WhatsApp'ta ev sahibine görünen yeni cümleler (hepsi TASLAK, onayınızı bekliyor; misafire giden hiçbir şey yok):
- Rıza kutusu: "Misafir sorularının bu WhatsApp numarasına gönderilmesini kabul ediyorum. Mesajlar Meta (WhatsApp) üzerinden iletilir; istediğim
  zaman buradan ya da WhatsApp'tan DUR yazarak kapatabilirim." (avukat onayı da gerekli — tasarım §9 madde 11)
- Kart: "Cevabını bilmediğimiz bir misafir sorusu geldiğinde size WhatsApp'tan kısa bir soru gönderelim; cevabınızı oradan yazın."
- Hatalar: "Numarayı ülke koduyla yazın (ör. +90 532 123 45 67)." · "Bu numara şu anda bağlanamıyor. Başka bir numara deneyin ya da daha sonra
  tekrar deneyin." · "Devam etmek için onay kutusunu işaretleyin."
- Askı: "Şifreniz değiştiği için +•• … 67 numarasına soru gönderilmiyor. Numaranızı yeniden doğrulayın."

Sizin kararınız gerekenler (sabah): **(1)** W5 "bağlandı" mesajı istiyor musunuz? **(2)** Yukarıdaki cümleler + rıza metni. **(3)** Meta kurulum
listesi (tasarım §9) — hesap, ayrı numara, şablon onayı sizde. **(4)** Tasarım §5.4'teki "bu siz misiniz?" ekran onayı ilk dilimde YOK (kodu ev
sahibinin kendi WhatsApp'ından göndermesi sahipliği kanıtlıyor; bağlanan numara maskeli gösteriliyor) — ister misiniz?

## 4e. WhatsApp — ev sahibinin cevabı misafire (10-30 gece-4, `HOST_QUESTIONS_ENABLED` arkasında)

Akış: misafir sorusu ev sahibine WhatsApp'tan gider → ev sahibi o mesaja cevap yazar ("var, dolapta") → cevap şifreli saklanır, tasarımdaki
cevap kurucu misafirin dilinde, ev sahibinin ağzından taslak yazar, kod denetimi geçer → ev sahibine ÖNİZLEME:

> Lale · 12–15 Kas
> "Is there a baby cot?"
>
> Misafire şu cevap gidecek:
> "Yes, there is a baby cot in the closet."
> Türkçesi: "Evet, dolapta bebek yatağı var."
> **[Gönder] [Gönderme]**

(Önizleme SORU mesajına yanıt olarak gelir; ilk satırlar hangi daire / hangi konaklama / hangi soru olduğunu söyler — iki benzer soru karışmasın.)

[Gönder]'e basınca gönderimden HEMEN ÖNCE yeniden bakılır (bağlantı + rol + şifre değişimi, önizleme sürümü, taslak değişmedi mi, misafir arada
yazdı mı, panelden cevap verildi mi, rezervasyon iptal mi, kod denetimi yeniden) → bugünkü gönderim çekirdeği (çift gönderim kalkanı, kuyruk,
kanal kapıları) → "Gönderildi ✓". Belirsiz sonuçta "Gönderim doğrulanamadı, konuşmayı kontrol edin" (kör tekrar yok).

Seçtiklerim (gece modu; tasarım önerisi neyse o, misafire giden her şey ev sahibinin onayıyla):
- **S1 → onaylı** (otomatik gönderim yok). Otomatik isterseniz ayrı dilim.
- Cevap sorunun TAMAMINI karşılamıyorsa misafire hiçbir şey gitmez, soru açık kalır ("Cevabınız sorunun tamamını karşılamıyor…"). Tasarımdaki
  [Bunu atla] düğmesi bu dilimde YOK.
- Birden çok bekleyen soru varken bağlamsız cevap → düğmeli seçim yerine "Cevabınızı ilgili soru mesajına 'Yanıtla' diyerek yazın."
- Taslağa bu dilimde bilgi tabanı kalemi verilmiyor (yalnız ev sahibinin sözü) — yeni olgu uydurma riski en düşük hâli.
- Soru başına en çok 3 taslak; günlük yapay zekâ bütçesinden sayılır. Kapanmış sorunun cevap / taslak metni 7 gün sonra silinir.

Ev sahibine giden YENİ cümleler (onayınızı bekliyor): "Misafire şu cevap gidecek:" · "Türkçesi:" · [Gönder] [Gönderme] · "Gönderildi ✓" ·
"Tamam, gönderilmedi. Soru panelde açık." · "Tamam, size bıraktım." · "Tamam, misafire bir şey gönderilmedi. Soru panelde açık." ·
"Cevabınızdan misafire gidecek bir mesaj çıkaramadım. Panelden yazabilirsiniz: <bağlantı>" · "Cevabınız sorunun tamamını karşılamıyor. Eksik
kısmı da yazın ya da panelden cevaplayın: <bağlantı>" · "Şu an taslak hazırlanamadı…" · "Bu soru için daha fazla taslak hazırlanamıyor…" ·
"Şu an bekleyen bir misafir sorusu yok." · "Birden çok bekleyen soru var…" · "Soru gönderildikten sonra bu konuşmaya panelden yazıldı; çift
mesaj olmasın diye misafire bir şey gönderilmedi." · "Önceki cevabınız hâlâ işleniyor; bu mesaj dikkate alınmadı. Önizleme gelince gerekirse
yeniden yazın." · "Sıraya alındı; birazdan misafire gidecek ✓" · "Bu sorunun süresi geçti." · "Bu önizleme artık geçerli değil." · "Misafir yeni bir mesaj yazdı; misafire bir şey
gönderilmedi. Panelden kontrol edin: <bağlantı>" · "Rezervasyon iptal edilmiş; misafire bir şey gönderilmedi." · "Gönderim doğrulanamadı,
konuşmayı kontrol edin: <bağlantı>" · "Gönderilemedi. Panelden deneyin: <bağlantı>" · "Kanal bağlantısı yok, panelden deneyin." · "Sesli
mesajları ve görselleri henüz okuyamıyorum, lütfen yazın."

**Sert inceleme (4 mercek, her bulguya ayrı çürütücü; 23 bulgudan 22'si doğrulandı, hepsi düzeltildi — kod `82be72fb`, `f7dab912`):**
- Yarıda düşme: taslak kurulurken çöken / sürecin öldüğü turda Meta'nın yeniden teslimi kaldığı yerden işler (önceden "işleniyor"da kalıyor,
  ev sahibinin cevabı sessizce kayboluyordu). [Gönder] gönderimden ÖNCE düşerse kilit bırakılır, aynı düğme yeniden teslimde gönderir;
  gönderimden SONRAKİ kayıt hatası ev sahibine "gitmedi" gibi görünmez. Takılan soruyu saatlik süpürge kurtarır ve ev sahibine SÖYLER.
- Doğruluk: "eksik kısmı da yazın" sonrası yazılan parça öncekine eklenir (önceden ilk kısım kayboluyor, döngü tavana dayanıyordu). Soru
  sorulduktan sonra misafir yeniden yazdıysa ("vazgeçtim", "yanlış yazdım") taslak kurulmaz / gönderilmez. "Panelden cevaplandı" sayımı
  kanalın otomatik mesajını ve karar kartı mesajını saymaz. Misafirin adı modele ve Meta'ya gitmez. Kuyruğa alınan gönderim "Gönderildi"
  demez. Model çağrısından sonra bağlantı yeniden denetlenir ("DUR" yazan numaraya önizleme gitmez).
- Kapsam: WhatsApp onayıyla giden cevap YALNIZ o turun sorusunu "cevaplandı" yapar; konuşmanın başka açık isteği (ev sahibinin WhatsApp'ta
  görmediği) açık kalır. Misafir silmesi (KVKK) bekleyen taslağı kapatır, cevap / taslak / özeti siler (parite pini).
- Kanıt: 20 yeni test düzeltme ÖNCESİ kodda kırmızı, sonrasında yeşil (`5192ce73` → `82be72fb`); ilgili 67 dosya / 1.122 test yeşil.
  Bir birim testi CI'da kırmızı olacaktı (anahtar taklidi eksik) — düzeltildi.

**İkinci sert inceleme (düzeltmelerin kendisi; 3 mercek + çürütücü): 12 bulgu doğrulandı, hepsi düzeltildi:**
- "Sorudan sonra yazıldı mı" artık mesajın ALINMA anına bakar: misafirin soru kurulmadan hemen önce yazıp sonraki senkronda gelen
  "vazgeçtim"i, ev sahibinin Airbnb uygulamasından yazdığı cevap da yakalanır (önceden sağlayıcı saatine bakıldığı için kaçıyordu).
- Ev sahibinin her WhatsApp mesajı en çok bir soruya bağlanır (mesaj başına kalıcı kayıt): yarıda düşmüş eski bir mesajın geç tekrarı
  yeni cevabı bozmaz, başka misafirin sorusuna bağlanmaz.
- Süpürge, okuduktan sonra yeniden alınmış (taze) satıra dokunmaz; kanal anahtarı kapalıyken WhatsApp'a bildirim göndermez.
- WhatsApp onaylı cevap karar kartlarını da "ev sahibi yazdı" ile kapatmaz (öğe ve kart aynı listeyi kullanır).
- Misafir silmesi WhatsApp'a çıkmakta olan soruyu da kapatır.
- Kanıt: 12 yeni testin 9'u düzeltme öncesi kodda kırmızı (kalan 3'ü inceleme bulgusu test boşluğu: doğru davranışın pini); mutasyon 81
  mutant → 75 + (pin ve sadeleştirme sonrası) yeniden koşuda 7/7, yaşayan 0.

## 4f. WhatsApp — acil bildirim (10-31 gece, `HOST_QUESTION_ALERTS_ENABLED` arkasında; kurucu 10-29 "en önemli bildirimler WhatsApp'tan da")

Bugün ev sahibine "⚠️ Acil misafir mesajı" e-postası 4 ayrı yerden gidiyor: tutulan hassas istek (kayıp anahtar, kilitli kalma, ödeme,
şikâyet) · kelime ağının yakaladığı acil durum (yangın, gaz, CO) ve şikâyet · yapay zekânın "insana bırak" dediği riskli mesaj · olası tehlike
(anlama katmanı koşmadıysa, "kısa devre oldu"). **Dördünde de** e-postayla AYNI ANDA WhatsApp'a da kısa bildirim gider:

> ACİL · Lale (12–15 Kas) · Misafiriniz yazdı: “We lost the key and are locked out!” Konuşmayı hemen açın.  **[Konuşmayı aç]**

- E-postanın YANINDA, yerine değil (aşağıda S3). Mesaj başına TEK bildirim (aynı mesaj yeniden işlense de); işletme başına saatte en çok 10.
- Misafirin adı / telefonu gitmez (soru mesajıyla aynı maskeli alıntı). Bildirim cevap beklemez: ev sahibi bildirime ne yazarsa yazsın
  misafire GİTMEZ, yapay zekâ çağrılmaz; dönen cevap: "Bu bir acil bildirimdi; buraya yazdığınız misafire gitmez. Misafire panelden yazın:
  <bağlantı>". "Yanıtla" kullanmadan düz yazılan mesaj da (en yeni mesajımız bildirimse) aynı şekilde karşılanır — başka misafirin bekleyen
  sorusuna BAĞLANMAZ (sert inceleme bulgusu: "geliyorum" yazısı başka misafirin cevap taslağına girebiliyordu).
- Gönderilemezse e-posta yine gider; iz + (şablon reddi gibi kesin hatada) tek alarm. E-posta da düşüp tur yeniden denenince WhatsApp da
  yeniden denenir (gitmişse ikinci kez gitmez).
- Bilinçli dışarıda: ev sahibinin kendi panelden açtığı konuşma; QR sohbeti (oradaki acil e-posta bilerek metinsiz, ayrı anahtarlı).

**Kurucu kararı gerekenler (gece varsayılanı uygulandı, anahtar KAPALI):**
- **S3 — acilde ikisi birden mi?** Şu an: e-posta + WhatsApp birlikte (kaçırılmaması daha önemli). Alternatif: WhatsApp birincil, e-posta
  yalnız WhatsApp gitmezse. Önerim: ilk haftalar ikisi birden.
- **Şablon metni** (Meta onayına gönderilecek, tasarım §3.3): "ACİL · {{1}} ({{2}}) · Misafiriniz yazdı: “{{3}}” Konuşmayı hemen açın." +
  tek düğme [Konuşmayı aç]. Tasarımdaki eski metin ("Misafiriniz {{3}} bildiriyor") alıntıyla bozuk Türkçe veriyordu ("Misafiriniz We lost
  the key bildiriyor"); [İlgileniyorum] düğmesi çıkarıldı (misafire "ev sahibiniz ilgileniyor" gitsin mi ayrı karar — devir cümlesi kuralı).
- **Ev sahibine giden 2 yeni cümle:** "Bu bir acil bildirimdi; buraya yazdığınız misafire gitmez. Misafire panelden yazın:" · "Son mesajımız
  acil bildirimdi; buraya yazdığınız misafire gitmez. Bekleyen bir soruyu cevaplıyorsanız o soru mesajına "Yanıtla" diyerek yazın. Acil konuşma:".
- **E-posta alıcısı yoksa** (uyarı adresi de sahip e-postası da yok) WhatsApp da gitmez — bildirim e-postanın yanında. WhatsApp tek başına
  gitsin mi?
- **Kapı kodu alıntıda:** misafir "kapı kodu 4821 çalışmıyor" yazarsa alıntı kodu Meta'ya taşır (e-posta bugün de taşıyor). Alıntıda kodu
  maskeleyelim mi? (Ev sahibi kodu zaten biliyor; Meta'da iz kalmaz.)

**Saklama (belgede vardı, kodda yoktu — eklendi):** kapanmış soru / bildirim satırı 90 gün, iptal edilmiş numara bağlantısı 30 gün sonra
saatlik süpürgeyle silinir (misafire giden cevabı işaretleyen satır metinsiz kalır, konuşmayla gider).

**Kurulum notu:** iki şablonda da "Panelde aç" düğmesinin şablondaki sırası ayrı ayardır (`WHATSAPP_QUESTION_URL_BUTTON_INDEX`,
`WHATSAPP_ALERT_URL_BUTTON_INDEX`; soru şablonunda [Ben yazacağım] önce gelirse `1`, acilde `0`). İlk kurulumda her şablon kendi
numaranıza bir kez denenir.

**Kanıt:** sert inceleme 1 (4 mercek + şüpheci; 20 bulgu, 18'i gerçek — hepsi düzeltildi ya da pinlendi) · yeni testlerin 12'si düzeltme
öncesi kodda kırmızı · mutasyon tur 1: 21 mutant → 19 öldü, 2 yaşayan (test boşluğu) kapatıldı; tur 2: 25/25 öldü · sert inceleme 2
(düzeltmelerin kendisi): 20 bulgu, 16'sı gerçek — "yanıtla" kullanılmadan yazılan düz mesaj kuralının kenar durumları (soru akışı bildirimden
sonra ilerlediyse soruya gider; bildirimden önce yazılmış / yeniden teslim edilen mesaj ve düğmeler kural dışı; açık soru varken sessiz
yutma yok), görünmez karakterle maske atlatma, hiç doğrulanmamış numaranın silinmesi, test boşlukları; düzeltme öncesi kodda 7 yeni test
kırmızı. Bilinçli değişiklik: rezervasyona bağlı olmayan konuşmada da acil bildirim gider (tarih yerine "—"; eskiden sessizce düşüyordu).
Kurucu sorusu (yukarıya ek): **rıza metni** (Ayarlar, TASLAK) yalnız "misafir soruları" diyor — acil bildirim ve karar kartlarını da
kapsayacak biçimde güncellenmeli: öneri "Misafir sorularının, acil misafir bildirimlerinin ve karar isteklerinin bu WhatsApp numarasına
gönderilmesini kabul ediyorum." (avukat onayıyla).

## 4g. WhatsApp — karar kartları (dilim 3, 10-31 gece; `HOST_DECISIONS_ENABLED` + `HOST_QUESTION_DECISIONS_ENABLED`, ikisi de KAPALI)

Erken giriş / geç çıkış kartı açılınca "Karar bekliyor" e-postası YERİNE WhatsApp:

> Lale (16–19 Kas) · 16 Kasım (varış günü) · 13:00 erken giriş isteği. Kontrol: Aynı gün çakışan başka bir rezervasyon var.; Bu devir
> için temizlik görevi bulunamadı.; +1 uyarı daha
> **[Onayla] [Reddet]** [Panelde aç]

Kontrol satırında panelde KIRMIZI görünen uyarılar ÖNCE gelir (en çok 2 + "+N uyarı daha"); uyarı yoksa ilk iki satır. (Sert inceleme:
ilk iki satır sırayla alınınca "İstenen saat: 13:00; Misafirin varışı bugün." gidiyor, "daire henüz boşalmamış olabilir" uyarısı
WhatsApp'a hiç ulaşmıyordu — ev sahibi panelden daha az bilgiyle onaylayabiliyordu.)

[Onayla]'ya basınca önce ÖNİZLEME (panelin varsayılan metniyle aynı kod metni — model yok; misafirin dilinde + Türkçesi). Uyarıların
HEPSİ [Gönder]'den önce görünür:

> 13:00 erken giriş · 16 Kasım (varış günü)
>
> Dikkat:
> • Aynı gün çakışan başka bir rezervasyon var.
> • Bu devir için temizlik görevi bulunamadı.
> • Varıştan önceki gecenin boş olduğu doğrulanamadı; kanal takviminden kontrol edin.
>
> Misafire şu gidecek (İngilizce): "Your early check-in is approved — you can check in on 16 November from 13:00."
> Türkçesi: "Erken giriş talebiniz onaylandı: …"
> **[Gönder] [Gönderme]**

Önizleme WhatsApp sınırına (1024 karakter) sığmazsa KESİLMEZ: önce Türkçesi düşer, uyarılar asla; yine sığmazsa "Bu kararı panelden verin".

[Gönder] → paneldeki karar ile AYNI çekirdek (rotadan birebir çıkarıldı; rota testleri değişmeden yeşil): sürüm kilidi, misafir arada
yazdıysa gitmez ("Misafir bu talepten sonra yeniden yazdı; mesajı panelden okuyun"), kontrol listesi değiştiyse gitmez, rezervasyon iptal /
gün geçti → gitmez; çift dokunuş ikinci mesaj üretmez ("Bu karar zaten verildi."). Kararı veren bağlantının kullanıcısı (yalnız sahip /
yönetici), denetim kaydında kaynak "WhatsApp".
- WhatsApp'ta yalnız: metinli tür + istenen saat belli + ÜCRETSİZ onay. Ücretli erken giriş, saatsiz istek, uzatma / tarih değişikliği →
  bugünkü e-posta (WhatsApp'ta basılırsa "Bu kararı panelden verin"); ret her zaman verilebilir (standart saatle).
- Karar mesajına ya da önizlemeye yazıyla cevap ("13:30 olur") misafire gitmez: "Karar için mesajdaki [Onayla] / [Reddet] düğmelerini
  kullanın; farklı bir saat ya da not için panelden yazın: <bağlantı>" (karşı teklif bu dilimde panelde — tasarım §3.10). "Yanıtla"
  kullanılmadan düz yazılırsa yalnız bekleyen başka soru YOKKEN ve kart hâlâ kararsızken bu yönlendirme gelir; bekleyen bilgi sorusu varsa
  düz mesaj ona gider (karar zaten düğmeyle verilir), karar verilmiş kartın bildirimi sonraki sohbeti yutmaz.
- Misafir talepten sonra yeniden yazdıysa WhatsApp'ta karar verilemez (panelde "okudum" adımı var, WhatsApp'ta yok): bildirim bugünkü
  e-postayla gider; eski şablondaki düğmeye basılırsa "Misafir bu talepten sonra yeniden yazdı; … Mesajı panelden okuyun".
- Karar motoru kapatılırsa (`HOST_DECISIONS_ENABLED` boş) daha önce gitmiş şablonun düğmeleri de çalışmaz (panel rotasıyla aynı acil
  durdurma — çekirdekte).

**Kurucu kararı gerekenler:** şablon metni (Meta onayı) "{{1}} ({{2}}) · {{3}} isteği. Kontrol: {{4}}." · ev sahibine giden yeni cümleler
(önizleme başlığı, "Dikkat:" uyarı başlığı, "+N uyarı daha", "Bu karar zaten verildi.", "Bu karar şu an gönderiliyor ya da gönderimi
doğrulanamadı; konuşmayı kontrol edin:", "Bu karar kartı değişti ya da kapandı…", "Bu kararı panelden verin…", "Bu talebin kontrol listesi
… değişti…", "Bu talepten sonra misafire zaten yazdınız; misafire bir şey gönderilmedi. Gerekirse kararı panelden verin:", "Talep edilen
gün geçti…", "Rezervasyon iptal edilmiş…", karar mesajına yazı yönlendirmesi) · önizleme adımı kalsın mı (tek dokunuşla doğrudan gönderim
yerine — öneri: ilk haftalar önizlemeli, S1 ile aynı) · **uyarılı kart WhatsApp'ta onaylanabilsin mi?** Şu an: evet, uyarılar önizlemede
gösterilir (panel de uyarıya rağmen onaya izin veriyor). Daha temkinli seçenek: kırmızı satırı olan kart yalnız panelde onaylanır (ret yine
WhatsApp'ta).

**Kanıt:** karar çekirdeği rotadan birebir çıkarıldı (rota testleri değişmeden yeşil) · mutasyon tur 1: 28 mutant → 26 öldü, 2 eşdeğer
(gerekçeli: yanıt kaydı denetimi o turda başka koşulla örtülüyordu — bu turda yeni testle öldü; ret metni saat kullanmaz, kod sadeleştirildi) ·
sert inceleme (4 mercek + şüpheci): 20 bulgu, 19'u gerçek — karar motoru acil durdurması WhatsApp yolunda yoktu, uyarılar WhatsApp'a
ulaşmıyordu, karar verilmiş kartta [Gönderme] "gönderilmedi" diyordu, karar bildirimi bekleyen bilgi sorusunun düz cevabını yutuyordu,
misafir arada yazmışsa şablon e-postanın yerine geçip işe yaramıyordu, önizlemeye "Yanıtla" ile yazılan metin başka misafirin sorusuna
bağlanabiliyordu, kapanmış kart yanlış nedenle cevaplanıyordu + 9 test boşluğu; hepsi düzeltildi ya da pinlendi; yeni testlerin 9'u
düzeltme öncesi kodda kırmızı · mutasyon tur 2 (düzeltmeler + boşluklar): 32 mutant → 30 öldü; yaşayan 2'si rotadan taşınan çekirdek kuralının ESKİ test boşluğuydu
("misafir yazdı mı" çapası talebin mesajı + "okudum" yalnız en son mesajla) — yeni rota testiyle 2/2 öldü · ilgili 30 dosya / 527 test yeşil.

## 4h. Soru — WhatsApp cevabı bilgi tabanına kaydedilsin mi? (tasarım §3.9; KODLANMADI, karar sizde)

Bugün ev sahibinin WhatsApp cevabı misafire gider, bilgi tabanına GİRMEZ: aynı soru başka misafirden gelince yine ev sahibine sorulur.
Tasarımdaki öneri, gönderimden sonra tek soru:

> Gönderildi ✓
> Bunu Lale'nin bilgi tabanına kaydedeyim mi? Bir dahaki sefere sormadan cevaplarım: “var, yatak odası dolabında”
> **[Kaydet] [Hayır]**

[Kaydet] → bilgi tabanı kalemi (mülk: sorunun dairesi; başlık: konu, örn. "Bebek yatağı"; içerik: ev sahibinin KENDİ sözü, yapay zekâ cümlesi
değil). Sorulmayanlar: Wi-Fi şifresi / kapı kodu (sır — yalnız panel), "bu hafta havuz kapalı" gibi geçici bilgi, talimat-ele-geçirme
süzgecine takılan metin.

**Neden kodlamadım:** tasarım kalemi "taslak" (onay bekleyen) olarak yazıyordu; ama panelde taslak kalemi gösteren / onaylatan ekran YOK
(09-11'de sizin kararınızla kaldırıldı, geri gelmesi pinli). Taslak yazılırsa kalem hiçbir yerde görünmez ve hiç kullanılmaz.

- **(a) Önerim:** [Kaydet] = onaylı kalem (bugünkü "Bilgi tabanına ekle" düğmesiyle aynı: sahibin / yöneticinin açık dokunuşu = onay).
  Kalem mülk sayfasında görünür, düzenlenip kapatılabilir.
- **(b)** Taslak + panelde küçük bir "WhatsApp'tan gelen bilgiler — onayla" kutusu (yeni ekran).
- **(c)** Hiç sorma (bugünkü gibi).

## 5. Railway açılış günü eklenecekler (unutmayın)

- **Decisions API sıralayıcısı:** `KB_RERANK_ENGINE=decisions`, `KB_RERANK_DECISIONS_MODEL` (ölçümle açılır).
- **Kıdemli okuyucu:** `AI_SENIOR_READER_ENABLED=1` (iç sistem anlatımı 56/56) + **S-1 denetimi** `AI_REFERRAL_JUDGE_ENABLED=1` (özel işletme
  yönlendirmesi kör sette 41/42, temizde 0 yanlış).
- Prompt caching kendiliğinden açık; kapatma `OPENAI_PROMPT_CACHE_DISABLED=1`.
- WhatsApp: `HOST_CHANNEL_ENABLED`, `HOST_CHANNEL_ORG_IDS=<kurucu org>` + sırlar (`WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `HOST_CHANNEL_HMAC_SECRET`); acil bildirim `HOST_QUESTION_ALERTS_ENABLED` +
  şablon `WHATSAPP_ALERT_TEMPLATE` (§4f); `HOST_QUESTIONS_ENABLED` cevap dilimi gelene kadar
  KAPALI (§4d) — kurulum adımları
  `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md` §9 (Meta hesabı, ayrı numara, şablon onayı, kalıcı belirteç).
- Tam liste: `docs/RAILWAY-ACILIS-2026-10-15.md` §0.
