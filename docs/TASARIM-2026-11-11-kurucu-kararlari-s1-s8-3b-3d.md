# Kurucu kararları 11-11 gece — S1–S8, 3b–3d: bugünkü kod, eleştiri, plan

> Kaynak: kurucunun 11-11 gece mesajı (bir kısmını Codex yazdı; kurucu: "sertçe eleştir, daha iyisini biliyorsan yaparak ilerlet").
> Her madde: **karar** · **bugünkü kod** (envanter, `dosya:satır`) · **Codex önerisinin eleştirisi** · **yapılacak** · şema / ölçüm ihtiyacı.
> Sıra ve migration listesi sonda. Misafire / ev sahibine görünen YENİ metinler §12'de toplandı (onay ister).

## 0. Tek bakışta

| Madde | Karar | Şema değişikliği | Ölçüm | Durum |
|---|---|---|---|---|
| S1 çift onay | B — ama taslak kimliğiyle değil, **cevaplanan misafir mesajıyla** | yok | yok | uygulanacak |
| S2 geç alınan mesaj | AI değerlendirsin; toplu eski cevap yok | öğe ↔ gönderim bağı (var olan tablo yeterli mi — §2) | ücretli | anahtar kapalı yazılır, ölçülür |
| S3 hayvan + Wi-Fi | Wi-Fi gitsin, hayvan sizde kalsın | yok | ücretli + yeni kör set | anahtar kapalı yazılır, ölçülür |
| S4 aktarma listesi | elle atananlar ayrı ve işaretsiz | **var** (atamanın kaynağı) | yok | migration turu |
| S5 metinler | onaylandı ("Daha sonra tekrar deneyin") | yok | yok | ✅ `dab99272` |
| S6 iki şema işi | migration turu | **var** | yok | migration turu |
| S7 anahtar reddi | yeni davranış kalır + bekleyen olay kendiliğinden yeniden değerlendirilir | yok (olay zaten saklanıyor) | yok | uygulanacak |
| S8 otomatik mesaj denemesi | "üçte bırak" değil; durum + sınıf + sonraki deneme | yok (kuyruk kaydı zaten taşıyor) | yok | uygulanacak |
| 3b erken giriş | B; ama "herkese gitmesin" sorusu açık | istisna için küçük alan (§8) | yok | **soruda** |
| 3c kim yazdı | Airbnb gibi "Ad · Rol saat"; "görüşmeye katıldı" kalkar; logo | ad + rol için **var** | yok | görsel kısım şimdi, ad / rol migration turu |
| 3d model yokken | söz veren taslak yok, kutu boş + not | yok | yok | uygulanacak |
| İstemdeki "ev sahibiniz görebilir" | kalksın | yok | **ücretli** (bütün cevap kategorileri) | tek örnek değil — §11 |

## 1. S1 — aynı taslağın çift onayı

**Bugünkü kod.** Taslağın sunucuda kimliği / sürümü yok (`AiGeneration.draftText` yalnız metin, `prisma/schema.prisma:1897`; hazır taslak cevaplanan
misafir mesajına bağlı — `conversation-items/prepared-draft.ts:28`). Onayda istemci `{ body, aiAssisted, requestId }` yollar
(`inbox/conversation-thread.tsx:339`); `requestId` her sekmede ayrı üretilir. Kuyruk anahtarı `manual:${id}:req:${requestId}`
(`api/conversations/[id]/reply/route.ts:89`) → iki yönetici = iki anahtar = iki mesaj. Doğrudan yolda aynı METNE 2 dakikalık kilit var
(`outbound-claim.ts:55`); kuyruk yolunda yok.

**Codex önerisinin eleştirisi.** "Taslak kimliği gönderim işlemini belirlesin" doğru yönde ama yetersiz: iki yöneticinin panelleri AYRI üretim
yapabilir (iki ayrı taslak satırı, metinleri bir iki kelime farklı). Taslak kimliğiyle tekilleştirme bu durumda iki mesajı yine gönderir. Asıl
değişmez "aynı taslak iki kez gitmesin" değil, **aynı misafir mesajına yapay zekâ önerisi iki kez gitmesin**. Ayrıca yeni bir taslak tablosu /
sürüm sütunu gerekmiyor.

**Yapılacak (şema yok).**
- Öneri onayı (`source: "suggestion"`) sunucuya cevapladığı misafir mesajının kimliğini taşır; sunucu bunu konuşmaya ait ve hâlâ "son cevapsız
  misafir mesajı" olarak doğrular (istemciye güvenilmez).
- İşlem kimliği: `suggestion:${konuşma}:${cevaplananMesaj}` — kuyruk anahtarı VE doğrudan yolun talebi aynı kimliği kullanır (anahtar açılıp
  kapanınca ikinci gönderim doğmaz).
- İkinci onay yeni gönderim açmaz; var olanın durumunu döner: "Gönderim kuyruğunda" · "Gönderildi" · "Sonucu doğrulanıyor". Kuyruktaki mesaja
  "gönderildi" denmez.
- Mesaj bu arada cevaplandıysa (ilk onay bitti) eski sekmenin onayı reddedilir ve güncel konuşma gösterilir; yeni misafir mesajı geldiyse
  öneri zaten geçersizdir (11-11 M4 düzeltmesi).
- Elle yazılan cevap (kaynak "manual") bu kuralın DIŞINDA: ev sahibi aynı mesaja bilerek ikinci cevap yazabilir; bugünkü `requestId` + 2 dakika
  kuralı aynen. "Adresi tekrar gönderir misiniz?" örneği böylece engellenmez (misafirin yeni mesajı = yeni işlem kimliği).
- Sonucu belirsiz gönderim (zaman aşımı): körlemesine yeniden gönderilmez; bugünkü "incelemede" yolu.

## 2. S2 — cevaptan önce yazılıp sonra içeri alınan mesaj

**Bugünkü kod.** Geç mesaj konuşmayı "Yeni" yapar ve acil ağı onu tarar (11-04 S1); yapay zekâ kendiliğinden cevaplamaz. Öğe bazlı kayıt var
(`ConversationItem`, `AI_CONVERSATION_ITEMS_ENABLED`); bir öğenin hangi gönderimle karşılandığı ayrıca tutulmuyor.

**Eleştiri.** Tablodaki davranışlar doğru. Eksik bir satır: geç mesaj ACİL ağına takılıyorsa (yangın, su baskını) hiçbir "güncel bağlam"
değerlendirmesi beklenmez — bugünkü acil yolu aynen çalışır. "Temel kayıt: hangi ihtiyaç hangi gönderimle karşılandı" doğru hedef; ama bunu
yeni bir tabloyla değil var olan öğe kaydına gönderim bağı ekleyerek yaparım (S3 ile ortak).

**Yapılacak (anahtar KAPALI, ölçümden sonra açılır).** Geç alınan mesaj normal otomatik cevap adayı olur; şu şartların HEPSİ sağlanırsa:
ev sahibi o mesajdan sonra yazmamış · konuşma "Sorunlu" / bekletmede değil · mesaj en çok 24 saat eski (içeri alınma anına göre) · ilk
bağlantıdaki toplu geçmiş değil · öğe hâlâ açık (sonraki mesajlarda geri çekilmemiş, cevaplanmamış). Gönderimden hemen önce aynı şartlar
yeniden okunur. Cevap güncel bağlamla üretilir (eski mesaja eski cevap değil).

## 3. S3 — "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?"

**Bugünkü kod.** Kapı misafir MESAJINA bakıyor: mesajda ev kuralı konusu varsa bütün cevap tutulur (bilinçli, testle pinli).

**Eleştiri.** Beş adımlı akış doğru; iki ekleme: (1) okuyucunun "dolaylı izin" denetimi yalnız hayvan için yazılırsa aynı sınıf (sigara,
parti, ek kişi, erken giriş…) bir sonraki hatada geri gelir — denetim "ev sahibinde kalan HER ihtiyaç için cevapta onay / ret / ima var mı"
diye genel yazılmalı. (2) "Tabii, sorun değil!" örneği gösteriyor ki tek cümlelik selam bile ima taşıyabilir: gönderilebilir ihtiyaç tek ve
bilgi türündeyse cevap selamsız, yalnız bilgi cümlesi olmalı (kodla kurulabilen yerde kodla).

**Yapılacak (anahtar KAPALI).** Anlama katmanı ihtiyaçları ayrı kimlikle çıkarır → ev sahibinde kalan ihtiyaç işaretlenir → cevap yalnız
gönderilebilir ihtiyaç için üretilir → okuyucu özgün mesajın tamamıyla "kalan ihtiyaçlara dair onay / ret / ima" arar → gönderim kaydı yalnız
karşılanan ihtiyacı kapatır; ötekiler açık kalır ve ev sahibine "Wi-Fi cevaplandı · hayvan sorusu sizde" diye görünür.

**Ölçüm (kurucu: "sonuç görülmeden açılmasın; testleri çalıştırabilirsin").** İki sayı birlikte: yanlış izin gönderimi (hedef 0) ve doğru
bilgi cevabının gereksiz tutulması. Geliştirme setinden AYRI yeni kör set (Türkçe + İngilizce + en az iki dil daha, çok turlu konuşmalar);
kör seti ben görmeden hazırlatırım (ayrı ajan yazar, mühürlü klasöre koyar; ben yalnız toplam sonucu okurum).

## 4. S4 — temizlikçi değişince aktarma listesi

**Bugünkü kod.** Sunucu onayda yeniden kontrol ediyor (`tasks/default-cleaner.ts:94-130`, satır kilidi), "N görev aktarıldı / N görev
aktarılamadı: bu arada başlanmış ya da değişmiş" yazıyor, eski kişiye e-posta gönderilmeden güncel atama yeniden okunuyor
(`tasks/notify.ts:113`). **Eksik olan tek şey:** bir sistem görevine temizlikçiyi KİMİN atadığı hiçbir yerde tutulmuyor (`Task` yalnız `origin`
taşır; geçmiş kaydında atama değişikliği yok) → "elle atanmış" görev bugün ayırt edilemiyor.

**Eleştiri.** Codex'in istediği sunucu kontrolü, açık sonuç metni ve bildirim doğrulaması zaten var. Yeni gereken yalnız atamanın kaynağı.

**Yapılacak (migration).** `Task.assignedVia` (boş · `default` · `manual`): varsayılan temizlikçi kuralı `default`, ev sahibinin görev
ekranından yaptığı atama `manual` yazar. Liste: "Otomatik atananlar" (işaretli) · "Sizin atadıklarınız" (işaretsiz, ayrı başlık). Eski
görevlerde alan boştur: tahmin edilmez, bugünkü gibi "otomatik" grubunda kalır.

## 5. S6 — iki şema işi (migration turu)

1. **Abonelik kaydı.** Codex'in ayrımı doğru: tarih "geçerli abonelik" satırına değil, sağlayıcı abonelik kimliğine ait olmalı. Yeni tablo
   `ProviderSubscription` (işletme, sağlayıcı kimliği tekil, sağlayıcıdaki oluşturulma zamanı — bilinmiyorsa boş, son olay zamanı, durum);
   işletmenin geçerli aboneliği bu satırlardan birine bağlanır. Eski veride tarih TAHMİN edilmez. Eşzamanlılık koruması (11-11 P1: olay yalnız
   okuduğu aboneliğe yazar) yerinde kalır — tarih tek başına o açığı kapatmaz, Codex haklı.
2. **Ayar sürümü.** Tek sürüm bütün işletmeye bağlanmaz; bölüm başına sayaç (otomasyon · yapay zekânın sesi · bildirimler · çalışma saatleri).
   İstemci okuduğu sürümü yollar; farklıysa sunucu yazmaz, güncel değeri döner; form ev sahibinin yazdığını SİLMEZ, iki değeri yan yana
   gösterir. İstemci yeni sürümü alıp kendiliğinden yeniden göndermez. Uyarı metni §12'de (onay ister).

## 6. S7 — ödeme sağlayıcısı API anahtarımızı reddederse

**Bugünkü kod.** Gelen her olay imzası doğrulandıktan sonra `WebhookEvent`e yazılıyor (`api/webhooks/paddle/route.ts:931`, olay kimliği
tekil); işlenemezse satır `error` kalıyor ve 500 dönüyor. Ortak anahtar alarmı ayrı ve işletmesiz (`paddle-api-key`, `:800`). **Eksik:**
`error` kalan olayı bizim tarafımızda yeniden değerlendiren hiçbir şey yok; yalnız Paddle'ın yeniden göndermesine güveniliyor.

**Eleştiri.** Codex'in "kalıcı sakla" maddesi zaten var; gerçek boşluk yeniden değerlendirme. "Doğrulama bekliyor" için yeni durum sütunu
gerekmiyor: `error` + tanınan hata öneki yeterli.

**Yapılacak (şema yok).** Saatlik zamanlanmış iş, işlenememiş Paddle olaylarını AYNI işleyiciden yeniden geçirir:

- **Hangi olaylar.** Son 14 günün abonelik / ödeme olayları; durumu "hata" (inceleme bekleyenler HARİÇ — onlar insan kararı ister) ya da
  15 dakikadan uzun "alındı"da kalmış (işlem sırasında süreç çöktü). Küçültülmüş (kişisel verisi silinmiş) yük yeniden işlenmez.
- **Nasıl.** Saklı ham gövde, kendi webhook sırrımızla yeniden imzalanıp süreç içinde aynı uç noktanın işleyicisine verilir. Böylece
  teslim ile yeniden işleme TEK kod yolundan geçer (kopya işleyici yok, ayrışma olmaz); kopya / sıra korumaları aynen geçerlidir (daha
  yeni olay uygulanmışsa eskisi düşer). Olaylar olay zamanına göre sırayla geçirilir.
- **Ne sıklıkla.** Olay başına sınırlı: yaşı 15 dk, 1 sa, 2, 4, 8, 16, 32, 64, 128, 256 saati geçtiğinde birer kez (14 günde en çok 10).
  Bir olay hep hata veriyorsa ötekileri bekletmez (sıra tıkanmaz).
- **"API anahtarı reddedildi / Paddle okunamadı" sınıfı.** Bu olaylar yeniden geçirilmeden önce TEK ucuz okuma ile anahtar sınanır.
  Reddediliyorsa hiçbiri denenmez (sağlayıcıya yüklenilmez, olay başına alarm üretilmez); işletmesiz TEK ortak alarm durumu açılır
  (bir kez + günde bir hatırlatma). Anahtar düzelince ilk turda o sınıftaki bekleyen olayların HEPSİ, yaş sırasını beklemeden geçirilir ve
  alarm durumu kapanır.
- İmza sırrı ile API anahtarı ayrı kalır: anahtar bozukken de olaylar alınıp saklanır (bugünkü davranış).

## 7. S8 — otomatik mesajın yeniden denenmesi

**Bugünkü kod.** Kalıcı kuyruk kaydı Codex'in istediği her şeyi ZATEN taşıyor: gönderim niyeti başına durum, deneme sayısı, sonraki deneme
zamanı, hata sınıfı (`outbox/state.ts:30-42, 187-220`); kesin ret → geri çekilerek en çok 6 deneme sonra "Gönderilemedi" (ev sahibi
"Gönderim durumu" sayfasında görür, elle yeniden deneyebilir); hız sınırı → sağlayıcının süresi; abonelik pasif → bekler; belirsiz sonuç →
yeniden gönderilmez, incelemeye düşer. **Sorun yalnız kuyruk KAPALIYKEN çalışan doğrudan yolda:** kesin hatada damga geri alınıyor, hiçbir
durum okunmuyor → her 2 dakikada yeniden deneniyor ve reddedilen rezervasyonlar 25'lik listenin başını dolduruyor.

**Eleştiri.** Codex "rezervasyona sayaç değil, gönderim niyetine durum" derken haklı; yeni alan / tablo istemek gereksiz.

**İlk planım yanlıştı (uygulamadan önce kodda gördüm).** "Doğrudan yol kuyruk tablosuna 'başarısız' satırı yazsın" demiştim. Sakıncası:
kuyrukta "başarısız" = SON durumdur (kendiliğinden bir daha denenmez). O satırlar aynı anahtarla kalır ve kalıcı kuyruk açıldığı gün
"zaten var" sayılıp mesajı sonsuza dek bekletirdi; ev sahibine "Gönderilemedi" derken arkadan yeniden deneyen iki anlamlı bir kayıt olurdu.

**Yapılan (şema yok).** Doğrudan yolun her denemesi zaten AYRI bir kayda yazılıyor: otomatik gönderim kaydı (`AutomatedMessageSend`,
09-30'dan beri; niyet = işletme + rezervasyon + tür, içeriğin özeti, sonuç). Deneme sayısı ve son deneme anı o kayıtlardan TÜRETİLİR
(`automated-sends.ts` "yeniden deneme defteri"):

| Durum | Davranış |
|---|---|
| Sağlayıcı mesajı kesin reddetti (4xx) | Hemen yeniden denenmez: 1,5 dk → 3 → 6 → 12 → … her seferinde ikiye katlanır, tavan 6 saat (günde ~4 deneme), ±%20 sapma |
| Ev sahibi metni düzeltti | İçerik değişti → sayaç sıfırdan başlar, bir sonraki turda denenir |
| Aynı rezervasyonun başka türdeki mesajı | Etkilenmez (karşılama reddedildi diye giriş bilgisi beklemez) |
| "Çok fazla istek" (429) | Tur orada durur (öteki adaylar denenmez); sağlayıcının istediği süre (yoksa 1 dk, en çok 1 saat) üç gönderici de bekler; bu, mesajın hatası sayılmaz |
| Sonuç belirsiz (zaman aşımı / 5xx) | Bugünkü gibi: yeniden gönderilmez |
| Mesajın zamanı geçti / konaklama iptal | Bugünkü gibi: aday olmaz |

25 sınırı artık vadesi gelmiş adaylara uygulanır (bekleyenler listeden ÖNCE elenir). "Bıraktım" durumu YOK: aralık büyür ama mesaj unutulmaz;
zamanı geçince kendiliğinden düşer. Kalıcı kuyruk açıkken bu defter okunmaz (durum kuyruk satırındadır).

**Bilerek yapılmayanlar.** (1) Bağlantı / yetki hatasına (401 / 402) özel kural: o durumda senkron da düşer ve göndericiler zaten hiç
çalışmaz (`scheduled-sync.ts`); 403'ün işletmeye mi rezervasyona mı ait olduğu bilinmediği için niyet başına bekleme iki yorumu da karşılar
(işletme düzeyinde durdurmak, tek bozuk rezervasyonun bütün sırayı tıkamasına yol açardı). (2) Hız sınırı beklemesi süreç belleğinde
(şema yok): yeniden başlatmada sıfırlanır, en kötü sonuç bir fazladan reddedilen istek.

**Açık kalan — ev sahibine görünürlük (soru, §12).** Doğrudan yolda reddedilen mesajı bugün yalnız operatör alarmı söylüyor; ev sahibinin
"Otomatik mesajlar" kartında görünmüyor. Yeni metin gerektirdiği için sorulacak.

**Yanında bulunan (kalıcı kuyruk yolu, ayrı düzeltme adayı).** Giriş göndericisi her turda "ertelenmiş" kuyruk satırının vadesini şimdiye
çekiyor (Y4, tarih yeniden pencereye girdiyse beklemesin diye). Aynı satır, işçinin kesin retten sonra geri çekilmesi ya da hız sınırı
beklemesi yüzünden ileri atılmış da olabilir → o bekleme de siliniyor. Kuyruk kapalı olduğu için bugün etkisi yok; açılmadan önce düzeltilecek.

## 8. 3b — erken giriş cevabı herkese gitmesin (kurucu sorusu)

**Bugünkü kod.** Ücret ev sahibinin erken giriş KURALINDAN gelir (`early-checkin/rules.ts:63`); kural "otomatik" kipindeyse ve soru tek
konuluysa cevap gider (`automation.ts:3204`). Tekrar gelen misafiri tanıyan fonksiyon var ama yalnız gelen kutusunda size rozet olarak
gösteriliyor (`returning-guest.ts:52`, `inbox/[id]/page.tsx:116`); otomatik cevap kararına girmiyor. Tek bir konuşma için kalıcı "yapay zekâ buna dokunmasın" alanı yok (yalnız "Sorunlu" ve süreli bekletme).

**Öneri — üç küçük istisna, hepsi kuralın kendi ekranında:**

| Durum | Bugün | Öneri |
|---|---|---|
| Tekrar gelen misafir "12'de girebilir miyiz?" | herkes gibi ücret cevabı | kuralda "Daha önce konaklamış misafire otomatik gönderme" kutusu işaretliyse cevap GİTMEZ, taslak olarak size düşer; kartta "tekrar gelen misafir" yazar |
| Bu misafire özel davranmak istiyorsunuz | "Sorunlu" yapmanız gerekir (yanlış anlam) | rezervasyon kartında "Bu rezervasyonda yapay zekâ otomatik cevap vermesin" anahtarı (konaklama bitene kadar); her konu size kalır |
| Bazı günler ücret istemiyorsunuz (boş gün) | kural hep aynı | şimdilik yok — kuralı "taslak" kipine alabilirsiniz (her erken giriş sorusu size taslakla gelir) |

Metin (B, onayınızdan): "Erken giriş ücretimiz ₺500, en erken 12:00. Saat kaçta gelmek istersiniz?" — yalnız kural "otomatik"se ve yukarıdaki
iki istisna devrede değilse gider. İkinci satır (rezervasyon başına anahtar) küçük bir alan ister → migration turu. Kararınız: üç satırdan
hangileri? (Önerim: ilk ikisi.)

## 9. 3c — QR sohbette kim yazdı

**Bugünkü kod.** Etiketler emoji önekli sabit metin: "👥 İşletme ekibi" / "🤖 Lixus AI" (`guest-chat/guest-chat-copy.ts:88`); avatar / logo
yok; saat yok. Ev sahibi yazınca araya "İşletme ekibi görüşmeye katıldı" çizgisi giriyor (`guest-chat-thread.tsx:47`). Mesajda yazan kişinin
kimliği yok; ad `senderName`de duruyor ama istemci de gönderebiliyor (`reply/route.ts:97`) ve hesabın TAM adı.

**Karar (kurucu):** Airbnb'deki gibi — yuvarlak avatar + "Ad · Rol saat"; "görüşmeye katıldı" kalkar; Lixus AI'ın logosu güzelleşir.

**Şimdi (şema yok):** "görüşmeye katıldı" çizgisi kalkar ("Lixus AI yeniden etkinleştirildi" çizgisi kalır — o gerçek bir durum değişikliği);
emoji yerine yuvarlak avatar (Lixus AI: marka işareti; ekip: nötr kişi simgesi); etiketin yanında saat ("Lixus AI 07:29").
**Migration turunda:** mesaja yazan kullanıcının kimliği + o anki rolünün kopyası (sunucudan; istemci seçemez); kişinin misafire görünecek adı
ayrı bir ayar (boşsa "İşletme ekibi") — hesabın tam adı / e-postası kendiliğinden açılmaz; etiket "Ayşe · Ev sahibi" / "Mehmet · Ekip". Eski
mesajlarda yazar tahmin edilmez. `owner` rolü "mülkün sahibi" demek değildir: etiket işletme ayarındaki unvandan gelir (varsayılan "Ev sahibi").
**Sahteleme riski (kodda yazılı gerekçe — unutulmasın):** misafire bugün yalnız rol etiketi gösterilmesinin sebebi, adın bir işaret gibi
kullanılamaması (`api/guest-chats/[id]/reply/route.ts:77`: adı "Lixus AI" olan biri yapay zekâ gibi görünmesin). Ad gösterilecekse: etiket
türü (yapay zekâ / insan) yine yalnız sunucudaki `authorType`tan gelir; görünen ad "Lixus", "AI", "asistan", "bot", "sistem" içeremez ve
avatar türü addan değil rolden seçilir (insan mesajı hiçbir zaman marka işaretini taşımaz).

## 10. 3d — yapay zekâ çalışmıyorken

**Not.** Alıntıladığınız "…İade ve ücret konusunu değerlendirip en kısa sürede size dönüş yapacağım." cümlesi depoda birebir yok; en yakını
iade dalındaki sabit taslak (aşağıda). Panelde gördüğünüz, devir cümlesinin ev sahibi ağzına çevrilmiş hâli de olabilir (§11) — ikisi de kalkıyor.

**Bugünkü kod.** Model yokken 15 konu için sabit taslak üretiliyor (`ai/fallback.ts:3020-3140`); yarısı yapılmamış işi bildiriyor ya da söz
veriyor: "Durumu hemen ekibimize ilettim; en kısa sürede size döneceğim.", "Talebinizi aldım. İade ve ücret konularını ev sahibimiz
değerlendirecek…", "Talebinizi ev sahibimize ilettim; en kısa sürede kendisi sizinle iletişime geçecektir." Bu metinler yalnız panel taslağı
olur (otomatik gitmez); kutuya "Taslağı yaz" düğmesiyle girer ve yazılmış metnin üstüne koşulsuz yazar (`conversation-thread.tsx:1211`).

**Yapılacak (şema yok).**
- Söz / "ilettim" içeren bütün sabit taslaklar KALKAR: şikâyet, iade, erken ayrılış, insan talebi, erken giriş, geç çıkış, varsayılan ve bilgi
  bulunamayan dallar ("…kontrol edip paylaşacağım"). Öneri alanında tek satır: **"Yapay zekâ önerisi şu an hazırlanamadı."**
- Bilgi tabanından / daire kaydından gelen SOMUT içerik (giriş saati, çıkış saati, Wi-Fi, otopark, konum, temizlik, ekipman kalemi) taslak
  olarak kalır; başlığında "Kayıtlı bilgilerinizden hazırlandı — soruya uygunluğunu kontrol edin" yazar; otomatik gitmez (bugün de gitmiyor). Sonuna söz
  cümlesi eklenmez.
- "Taslağı yaz" düğmesi kutuda yazı varken üstüne YAZMAZ: yazının sonuna eklemeyi / değiştirmeyi sorar (tek satır onay). Model hatası kutuyu
  ya da önceki taslağı boşaltmaz.
- "Altın cümleler": geldiğinde konu + koşul başına onaylı şablon olarak eklenir; model yokluğu tek başına gönderim izni değildir.

**"Bir insanla görüşmek istiyorum" — iki anlam.** (a) "Botla değil, ev sahibiyle yazışmak istiyorum" → insan yanıtı ihtiyacı açılır, yapay
zekâ o konuşmada bekler (bugünkü bekletme süresi), misafire metin gitmez. (b) "Resepsiyonun telefonu ne?" → bilgi tabanında "misafirle
paylaşılabilir iletişim" diye işaretli numara varsa cevaplanır; işaret yoksa ev sahibine kalır (bilgi tabanında numara bulunması izin
değildir). (c) Yalın "bir insanla görüşmek istiyorum" → telefon isteği sayılmaz, (a) gibi. "Sizi bağlıyorum / sizi arayacaklar" hiçbir yolda
üretilmez (çıktı vetosuna kalıp + test). (b)'deki "paylaşılabilir" işareti bilgi tabanı kalemine küçük bir alan ister → migration turu;
o güne kadar (b) de ev sahibine kalır.

## 11. İstemdeki "Mesajınız kaydedildi; ev sahibiniz görebilir"

**Düzeltme (rapordaki notum eksikti).** Bu cümle tek bir örnek değil: istemin yaklaşık 40 yerinde öğretilen DEVİR cümlesi. Tasarım şöyle
çalışıyor: model konuyu size bırakırken bu cümleyi yazar → çıktı vetosu cümleyi tanır ve misafire HİÇBİR ŞEY göndermez (kararınız 09-30) →
panel taslağında cümle sizin ağzınıza çevrilir ("Mesajınızı aldım; kontrol edip size dönüş yapacağım." — 3d'de beğenmediğiniz türden).
Yani üçüncü şahıs cümle misafire gitmiyor, ama modele öğretiliyor ve taslak kutusuna söz veren bir cümle olarak dönüyor.

**Doğru çözüm.** Devri cümleyle değil ALANLA bildirmek: model "bu konuyu ev sahibine bırakıyorum" bilgisini ayrı bir alanda verir, cevap
metni boş kalır; taslak kutusu da boş kalır (3d ile aynı ilke). İstemden devir cümlesi ve örnekleri çıkar. Bu, cevap modelinin bütün
kategorilerini etkiler → anahtar KAPALI yazılır, mevcut ölçüm setleriyle eski / yeni kıyaslanır (ücretli), sonuç size gösterilir, sonra açılır.
İstemin bazı bölümlerinde aynı sadeleştirme zaten anahtarla var (`AI_HOST_DECISION_HOLD_ENABLED`: "…kaydedildi, ev sahibiniz görebilir" →
"Bu ev sahibinizin kararıdır."); yeni iş onu bütün devir yerlerine genişletir.

## 12. Onayınızı isteyen yeni metinler

| Yer | Metin |
|---|---|
| S1, ikinci onaylayan | "Bu cevap gönderim kuyruğunda." · "Bu cevap az önce gönderildi." · "Bu cevabın sonucu doğrulanıyor." |
| S4, liste başlığı | "Otomatik atananlar" · "Sizin atadıklarınız (seçerseniz aktarılır)" |
| S6, ayar çakışması | "Bu ayar başka bir yerde değiştirildi. Güncel hâli aşağıda; sizin yazdığınız korunuyor." |
| 3b, kural kutusu | "Daha önce konaklamış misafire otomatik gönderme" · rezervasyonda: "Bu rezervasyonda yapay zekâ otomatik cevap vermesin" |
| 3c, misafir | "Ayşe · Ev sahibi" · "Mehmet · Ekip" · adı kapalıysa "İşletme ekibi" |
| 3d, öneri alanı | "Yapay zekâ önerisi şu an hazırlanamadı." · "Kayıtlı bilgilerinizden hazırlandı — soruya uygunluğunu kontrol edin" |

## 13. Migration turu (tek onay)

Hepsi yalnız-ekleme (yeni boş sütun / yeni tablo; dolu tabloya zorunlu alan, tekil kısıt ya da silme YOK):
1. `Task.assignedVia` (S4)
2. `ProviderSubscription` tablosu + işletmede geçerli aboneliğe bağ (S6-1)
3. Ayar bölümü sürüm sayaçları (S6-2)
4. `Message.authorUserId` + `authorRole` (o anki rol kopyası) + üyelikte misafire görünen ad (3c)
5. Rezervasyonda "yapay zekâ otomatik cevap vermesin" (3b — onaylarsanız)
6. Bilgi tabanı kaleminde "misafirle paylaşılabilir iletişim" işareti (3d-b)
7. Öğe ↔ gönderim bağı (S2 / S3; var olan öğe tablosuna boş sütun)

## 14. Çalışma sırası

1. Şemasız ve ölçümsüz olanlar: 3c görsel kısmı · 3d · S8 · S7 · S1 (her biri kırmızı-önce + mutasyon + tam kapı).
2. Migration turu (§13) — onayınızla.
3. Ölçüm isteyenler, anahtar kapalı: S3 → S2 → §11 (devir alanı). Her biri eski / yeni kıyasıyla size gelir.
