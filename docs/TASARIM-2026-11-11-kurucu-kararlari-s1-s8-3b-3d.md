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

**Yapılan (şema yok).** İşlemin kimliği **konuşma + önerinin üretildiği andaki konuşma sonu** (son gerçek mesajın kimliği; otomatik
şablon mesajı sayılmaz). Kimliği sunucu verir ("AI cevap öner" yanıtı / kayıtlı taslak), onayda istemci geri yollar, sunucu konuşmaya ait
olduğunu doğrular.

- İlk planım "cevaplanan misafir mesajı"ydı; kodda yanlış çıktı: ev sahibi cevap verdikten SONRA aynı misafir mesajı için yeni bir öneri
  isteyip onaylayabiliyor (bugün var olan akış) — misafir mesajına bağlı kimlik bunu sonsuza dek engellerdi. Konuşma sonu ise her cevapla
  değişir: cevaptan sonra üretilen öneri kendiliğinden YENİ bir işlemdir; aynı durumu gören iki yönetici yine aynı kimliğe düşer.
- Kuyruk anahtarı VE doğrudan yolun talebi aynı kimliği kullanır (anahtar açılıp kapanınca ikinci gönderim doğmaz).
- İkinci onay yeni gönderim açmaz. Kalıcı kuyrukta var olan gönderimin durumunu alır ("sıraya alındı" · "gönderildi" · sonucu
  doğrulanamayan gönderimin kendi etiketi); doğrudan yolda "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor." Metinlerin hepsi
  bugünkü metinler. İkinci yöneticinin önerisi bir iki kelime farklı olsa da gitmez (ilk onay geçerlidir; "farklı içerik" çakışması
  sayılmaz) ve sekme kendini yeniler — gönderilen cevap görünür.
- Öneri üretildikten sonra konuşmaya gerçek bir cevap yazıldıysa (başka biri elle yazdı, yapay zekâ cevapladı) eski sekmenin onayı
  gönderilmez — işlemin 24 saatlik talebi düşmüş olsa da.
- Elle yazılan cevap ("Taslağı kullan" ile kutuya alınıp gönderilen metin dahil) bu kuralın DIŞINDA: bugünkü istek kimliği + 2 dakikalık
  aynı-metin kuralı aynen. "Adresi tekrar gönderir misiniz?" örneği engellenmez. "Gerçekten yeniden göndermek" = metni kutuya alıp
  göndermek (ayrı, açık işlem).
- Öneriden sonra yeni MİSAFİR mesajı gelmesi onayı engellemez (bugünkü davranış; değiştirmek ayrı karar — §12).
- Sonucu belirsiz gönderim (zaman aşımı): körlemesine yeniden gönderilmez; bugünkü "incelemede" yolu. Doğrudan yolda da aynı (Opus
  dilim sonu incelemesi, 11-12): onaylanan önerinin gönderimi doğrulanamadıysa o öneri için "Onayla ve gönder" 24 saat kapalı kalır
  (eskiden 2 dakika sonra öteki yöneticinin onayı aynı öneriyi yeniden gönderebiliyordu — mesaj ulaşmış ama henüz içeri alınmamış
  olabilir). Ev sahibi bugünkü uyarıyı görür ("Gönderim doğrulanamadı — mesaj ulaşmış olabilir. Tekrar göndermeden önce konuşmayı
  kontrol edin."); mesaj gerçekten ulaşmadıysa metni kutuya alıp gönderir (ayrı, açık işlem; 2 dakikalık aynı-metin kuralı aynen).
- "Gönderim durumu" ekranındaki elle "yeniden dene" ile yeniden onay aynı öneriyi iki kez gönderemez (Opus incelemesi, 11-12):
  öneri yeniden onaylanıp yeni gönderimi açıldıysa eski "gönderilemedi" satırı elle yeniden denenmez ve listede denenebilir görünmez;
  zincirin ucundaki satır denenebilir kalır. İki işlem AYNI ANDA gelirse ikisi aynı satır kilidinde buluşur (yeniden onay, yerine
  geçeceği satırı kilitleyip hâlâ "gönderilemedi" mi diye bakar; elle yeniden deneme satırı güncelledikten sonra yerine yenisi açılmış
  mı diye bakar) — biri ötekinin sonucunu görür, gönderilecek tek satır kalır.

**Bilinen sınır (kuyruk anahtarı gönderim sırasında açılıp kapatılırsa).** "Gönderilemedi" satırı kuyruk açıkken doğmuş, yeniden onay
kuyruk kapalıyken DOĞRUDAN gönderilmişse yerine açılmış bir kuyruk satırı yoktur; o eski satır elle yeniden denenirse ikinci kopya
gider. Anahtar yalnız operatörce değişir; taslak kaydı (§13) gelince elle yeniden deneme satıra değil işleme bağlanır ve bu da kapanır.

**Bilinen sınır (migration turunda kapanır).** Kimlik bir taslak SÜRÜMÜ değildir: aynı konuşma durumunda iki yönetici ayrı ayrı öneri
üretip farklı metinleri onaylarsa ilk onaylanan gider, ikincisi gönderilmez ve gönderilen cevap gösterilir; hangi metnin onaylandığı
ayrıca kayda geçmez. Codex'in istediği "onaylanan revizyon + içerik özeti sabitlensin" tam hâliyle taslak kaydı ister (§13).

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

### 2.1 Ayrıntılı tasarım (11-12; mevcut kod okundu — envanter + doğrulama)

**Bugün neden cevaplanmıyor.** Konuşma, mesajın YAZILDIĞI ana göre sıralanır. Misafirin cevabımızdan önce yazıp bize sonra ulaşan mesajı
sırada cevabımızın ÖNÜNE düşer; "son mesaj bizim cevabımız" görünür ve akış `already_answered` der. Aynı sebeple, misafir sonradan yeni
bir mesaj yazsa bile o geç mesaj "cevaplanmış geçmiş" gibi okunur — yapay zekâ onu hiç değerlendirmez.

**Yapılacak tek şey (anahtar `AI_LATE_MESSAGE_REPLY_ENABLED`, KAPALI).** Otomatik cevap akışı konuşmayı okurken, şartlar sağlanıyorsa
geç mesajı kaçırdığı cevabın ARDINA koyar (yalnız bu okumada; veritabanındaki sıra ve ekranlar değişmez, mesajın kendi yazılma anı
aynı kalır — "yarın" gibi sözler doğru güne okunur). Sonrası bugünkü akışın aynısıdır: kapanış denetimi, acil ağı, anlama katmanı,
istek öğeleri, kapılar, gönderim öncesi yeniden okuma. Yeni model çağrısı, yeni tablo, yeni metin yok.

**Şartlar (hepsi; biri sağlanmazsa bugünkü davranış — konuşma "Yeni" kalır, ev sahibi görür):**

1. Kaçırılan cevap BİZİM otomatik cevabımız (yazarı yapay zekâ). Ev sahibinin panelden ya da platformdan yazdığı cevaptan sonra
   gelen geç mesaja yapay zekâ karışmaz — ev sahibi konuşmanın içindedir.
2. Geç mesajın yazıldığı andan sonra ev sahibi hiç yazmamış.
3. Geç mesaj en çok 24 saat önce yazılmış (kararın verildiği ana göre). Birden çok geç mesaj varsa hepsi bu sınırda olmalı.
4. Konuşma "Sorunlu" / bekletmede değil; rezervasyon iptal / bitmiş değil; önceki cevabımızın teslimi doğrulanmış (hepsi var olan
   erken dönüşler — değişmez).
5. Acil ağı önce koşar (bugünkü sıra): geç mesaj acilse konuşma "Sorunlu" olur, yapay zekâ cevaplamaz.

"İlk bağlantıdaki toplu geçmiş" kendiliğinden kapsam dışıdır: geç sayılmak için mesajın BİZİM bir cevabımızdan sonra içeri alınmış
olması gerekir; ilk bağlantıda bizim cevabımız yoktur. "Öğe hâlâ açık" şartı bugünkü öğe akışıyla sağlanır: misafir sonradan
"boşverin" yazdıysa o mesaj da aynı turdadır ve istek geri çekilir.

**Gönderim öncesi yeniden okuma (var olan iki yol, değişmez).** Doğrudan yolda gönderim hakkı ancak "okuduğum andan beri yeni misafir
mesajı gelmedi" şartıyla alınır (küme bazlı — sıra değişikliğinden etkilenmez). Kuyruk yolunda gönderim anı vetosu taslaktan sonra
gelen misafir / ev sahibi mesajında cevabı durdurur; cevabını kaçırdığımız eski mesaj taslaktan eski olduğu için yanlış veto üretmez.

**Örnekler (anahtar açık).**

| Durum | Bugün | Anahtar açıkken |
|---|---|---|
| 10:00 "Wi-Fi şifresi ne?" → 10:01 cevabımız. Misafirin 10:00:40'ta yazdığı "Bir de otopark var mı?" bize 10:03'te ulaşıyor | gitmez; konuşma "Yeni", ev sahibi görür | otopark cevabı gider (bilgi tabanında varsa; yoksa bugünkü gibi ev sahibine kalır) |
| Aynı durum, geç mesaj "Köpeğimizi getirebilir miyiz?" | gitmez | gitmez — hassas istek ev sahibinde (bugünkü kural) |
| Aynı durum, geç mesaj "Tamam, teşekkürler" | gitmez | gitmez (kapanış) |
| Geç mesaj cevabımızın zaten karşıladığı soruyu tekrarlıyor ("Wi-Fi şifresi lazım") ya da "Orada mısınız?" | gitmez | ❓ ölçülecek — hedef: tekrar cevap gitmesin |
| Kaçırılan cevabı ev sahibi yazmış | gitmez | gitmez |
| Geç mesaj 30 saat önce yazılmış | gitmez | gitmez |
| Geç mesaj "Mutfakta duman var" | acil uyarı + "Sorunlu" | aynı (acil ağı önce) |

**Ölçüm (kurucu: "anahtar + ücretli ölçüm").** Ürünün kanal akışı olduğu gibi koşar; senaryo geçmişine "bu mesaj cevaptan önce yazıldı,
sonra ulaştı" işareti eklenir. Sınıflar: cevabı bilgi tabanında olan yeni soru (gitmeli) · bilgi tabanında olmayan soru (gitmemeli,
uydurma 0) · hassas istek · kapanış · tekrar / "orada mısınız" (gitmemeli) · geri çekme · geç mesaj + sonradan yazılmış yeni mesaj ·
şart dışı (ev sahibi yazmış, 24 saatten eski). İki sayı birlikte: yanlış / gereksiz gönderim (hedef 0) ve doğru cevabın gitmesi.
Geliştirme seti açık; kabul ayrı yazarın mühürlü setiyle. Önce yalnız sıra değişikliği ölçülür; "tekrar" sınıfında model gereksiz
cevap yazıyorsa isteme kısa bir zaman notu eklenir ve yeniden ölçülür (kör sete kadar).

**Bilerek yapılmayan.** Geç mesajın yeri ekranlarda değişmez (misafirin platformda gördüğü sırayla aynı kalır) · ev sahibi cevabından
sonraki geç mesaj yapay zekâya verilmez · 24 saat sınırı ayar değildir.

### 2.2 Ölçüm sonuçları — geliştirme seti (11-12; cevap modeli gpt-5.1, planlanan canlı yapılandırma)

Açık set (`evals/late-message-dev.json`). Ürünün kanal akışı olduğu gibi koştu (gerçek model çağrıları, hiçbir şey kimseye gitmez). İki ölçüm:
ilk yazımda 31 senaryo (`…-late-message-dev-s2-kapali` / `-s2-acik`), dilim sonu incelemesinin düzeltmelerinden sonra 35 senaryo
(`…-s2b-kapali` / `-s2b-acik`; zamanlama üretimdeki gibi: geç mesaj cevabımızdan 4 saniye önce yazılmış). Tablo ikinci ölçümdür.

| Sınıf (senaryo) | Bugün (kapalı) — giden | Açık — giden | Not |
|---|---|---|---|
| Geç mesaj yeni, cevabı bilgi tabanında olan soru (9) | 0/9 | **9/9** | dokuzu da doğru değerle; beş dil |
| Geç mesaj + sonradan yazılmış yeni mesaj (2) | 2/2 | 2/2 | iki kolda da çoğunlukla yalnız SON mesaj cevaplanıyor; geç soru istek defterinde açık kalıyor (aşağıda) |
| Cevabı bilgi tabanında olmayan soru (3) | 0/3 | **1/3** 🚨 | "Kahvaltı veriyor musunuz?" → "Kahvaltı servisi sunmuyorum." — bilinen genel uydurma (S2'ye özgü değil; `docs/INCELEME-2026-11-12-istem-denetimi.md`) |
| Hassas istek — evcil hayvan, geç çıkış, uzatma (3) | 0/3 | 0/3 | ev sahibinde |
| Kapanış — "Tamam, teşekkürler" (2) | 0/2 | 0/2 | konuşma gizlenmedi (hedef 0) |
| Tekrar / dürtme (5) | 0/5 | **2/5** | aynı soru yeniden sorulmuşsa aynı cevap ikinci kez gitti; "Orada mısınız?" · "Cevap bekliyorum" gitmedi |
| Geri çekme — "Boşverin, buldum" (2) | 0/2 | 0/2 | |
| Acil · şikâyet (2) | 0/2 | 0/2 | acil ev sahibine yükseltildi |
| Kaçırılan cevabımız soru / teklifle bitiyor, geç mesaj "Evet lütfen" (3) | 0/3 | 0/3 | tur açılmaz (şart 4) |
| Şart dışı — cevabı ev sahibi yazmış · 25 saat (2) | 0/2 | 0/2 | `already_answered` (bugünkü davranış) |
| Kontrol — geç değil (2) | 2/2 | 2/2 | |

Açık kolda 33 geç senaryonun 28'inde tur açıldı (kapalı kolda 0): cevap gitti 14 · kapanış sayıldı 2 · acil yükseltme 1 · tutuldu 11.

**Geç + yeni mesaj sınıfı S2'nin değil, çok mesajlı turun sorunu.** Geç OLMAYAN iki cevapsız mesajda da ("Otopark var mı?" · "Çıkış saati kaç?")
cevap üç koşunun üçünde yalnız son mesajı karşıladı. Sebep cevap isteminin yapısı ("misafir mesajı" bloğu yalnız son mesajı taşıyor); ayrı
anahtar `AI_TURN_MESSAGES_ENABLED` ve ölçümü istem denetimi belgesinde (§6.3).

**Tekrar sınıfı için denenen ve geri alınan.** Modele "bu istek son cevabımızdan önce yazıldı; o cevabın zaten verdiği bilgiyi yeniden
gönderme" işareti eklendi ve aynı set yeniden ölçüldü: tekrar eden soruda cevap yine gitti (2/5 → 3/5), yeni sorular aynı kaldı,
geç + yeni mesajlı turda geç sorunun cevabı bir senaryoda düştü. Ölçülmüş faydası olmayan istem eklemesi geri alındı. Rapor: `…-s2-acik-isaretli`.

**Kurucu kararı gereken iki nokta (§12).**

1. *Tekrar eden soru.* Misafir 10:00'da "Wi-Fi şifresi ne?", 10:00:40'ta "Wi-Fi şifresini alabilir miyim?" yazdı; 10:01'de cevabımız
   gitti; ikinci mesaj bize 10:03'te ulaştı. Açıkken bugün ölçülen: aynı cevap ikinci kez gidiyor. Seçenekler: (A) böyle kalsın —
   misafire zararsız bir tekrar; (B) kod kuralı: son cevabımızın karşıladığı TÜRDEN bir istek geç mesajda yeniden gelirse yapay zekâ
   cevaplamaz, istek size kalır (bedeli: aynı türden gerçekten yeni soru — "Havuz kaçta açılıyor?" cevaplandı, geç mesaj "Havuzda havlu
   var mı?" — da size kalır).
2. *Bilgi tabanında olmayan soru.* S2 açılırsa geç mesajlar olağan mesajlarla aynı kurallara girer; olağan mesajlardaki uydurma sorunu
   geç mesajlarda da aynen vardır. Önerim: S2, o sorunun yapısal çözümünden (cevap parçaları kipi) ÖNCE açılmasın.

### 2.3 Kabul ölçümü — görülmemiş set

**HENÜZ KOŞMADI.** Ayrı yazarın yazdığı kabul seti hazır ve mühürlü; koşu OpenAI hesabının kredisi bittiği için yapılamadı
(`credit_balance_exhausted`, 11-12 akşam). Mühür "sealed", setten hiçbir şey görülmedi.

Kredi gelince koşacak üç kol (komut biçimi: `docs/INCELEME-2026-11-12-istem-denetimi.md` §6.4; set adı geç mesaj kabul seti):

| Kol etiketi | Bayraklar | Neyi ölçer |
|---|---|---|
| `s2-kor-kapali` | (yok) | bugünkü davranış: geç mesaj turu açılmaz |
| `s2-kor-acik` | `AI_LATE_MESSAGE_REPLY_ENABLED=1` | S2 tek başına |
| `s2-kor-tam` | `AI_LATE_MESSAGE_REPLY_ENABLED=1` + parça kipi + okuyucu + istem katmanı + `AI_TURN_MESSAGES_ENABLED=1` | önerilen birleşim: uydurma sorunu ve çok mesajlı tur çözülmüş hâlde S2 |

Bu sonuç görülmeden S2 için "açılabilir" denmez. Geliştirme setindeki iki açık (tekrar eden soruya ikinci cevap · bilgi tabanında olmayan
soruda uydurma) §2.2'de; ikincisinin yapısal çözümü parça kipidir ve onun kabul ölçümü de aynı krediyi bekliyor.

## 3. S3 — "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?"

**Bugünkü kod (11-12'de yeniden okundu — ilk yazdığım eksikti).** İstek ayrımı zaten var: öğe kipinde (canlıda açık) anlama katmanı
"evcil hayvan" ile "Wi-Fi"yi ayrı istek çıkarır, plan evcil hayvanı ev sahibine bırakır, cevap modeline yalnız Wi-Fi verilir ve "bırakılana
değinme" denir. Cevabın TAMAMINI tutan tek yer kapıdaki evcil hayvan kemeri: 10-28 düzeltmesi (hayvanı anmayan "Evet, getirebilirsiniz.
Gecelik ücret 200 TL." cümlesi geçiyordu) tutulan öğeyi de "hayvan turu" saydı; bilgi tabanı açıkça "ücretsiz kabul" demiyorsa o turda
HER cevap tutuluyor — yalnız "Wi-Fi şifresi: …" yazan cevap da. Yani 10-23'te verdiğiniz "köpek sorusu bütün mesajı tutmasın" kararı
(4.3) 10-28'deki sıkılaştırmayla fiilen geri alınmıştı. Aynı kemer, önceki bir mesajdan bekleyen evcil hayvan sorusu varken sonraki
bütün cevapları da tutuyor.

**Eleştiri.** Beş adımlı akış doğru; iki ekleme: (1) okuyucunun "dolaylı izin" denetimi yalnız hayvan için yazılırsa aynı sınıf (sigara,
parti, ek kişi, erken giriş…) bir sonraki hatada geri gelir — denetim "ev sahibinde kalan HER ihtiyaç için cevapta onay / ret / ima var mı"
diye genel yazılmalı. (2) "Tabii, sorun değil!" örneği gösteriyor ki tek cümlelik selam bile ima taşıyabilir: gönderilebilir ihtiyaç tek ve
bilgi türündeyse cevap selamsız, yalnız bilgi cümlesi olmalı (kodla kurulabilen yerde kodla).

> 🚨 **11-12 sabah — sert inceleme sonrası durum: S3 BU HÂLİYLE AÇILMAZ** (§3.2; kayıt `docs/INCELEME-2026-11-12-opus-s3.md`). Aşağıdaki
> dal artık yalnız (a) cevap kodun doğruladığı cevap parçalarından kurulduysa (`AI_ANSWER_PARTS_ENABLED` + `AI_ITEM_ORDINAL_ENABLED`;
> onlar kapalıyken bu anahtar hiçbir şeyi değiştirmez) ve (b) evcil hayvan isteği AYNI turun mesajlarında çıkarıldıysa açılır.

**Yapılan (anahtar `AI_HELD_PET_SPLIT_ENABLED`, KAPALI — ölçüm sonucu görülmeden açılmaz).** Yeni sistem yok; var olan öğe akışında tek
kapı dalı + istemde tek cümle:

- Evcil hayvan isteği ev sahibine BIRAKILMIŞSA (ayrı öğe, tutuluyor) öteki isteklerin cevabı yalnız bu yüzden tutulmaz. Şart: cevap o
  isteğe dair hiçbir onay / ret / koşul / ima taşımaz (`pet-policy.heldPetLeak`, kod):
  1. hayvanı / yardımcı hayvanı anan cümle ("Köpeğiniz için ayrıca döneceğiz" dahil);
  2. onay / ret sözcüğü — "evet", "tabii", "elbette", "sorun değil", "maalesef", "hayır", "yes", "of course", "unfortunately" … yedi dil.
     Konusu ne olursa olsun: aynı turda cevapsız bir evet / hayır sorusu var, "Evet, Wi-Fi şifresi …" ilk soruya da okunur. Anlamı yere
     göre değişenler ("olur", "tamam", "mümkün", "sure", "no", "ja") yalnız yan cümlenin TAMAMI olduklarında ("Olur." · "Sure, …" ·
     "No. …" · "Sure—the …"); bilgi cümlesinin parçasıyken tutmaz. 11-12 sabah eklenenler: yaygın onay öbekleri ("Sure thing", "That's
     possible", "Kein Thema", "Pas de souci", "Claro que sí"), Arapça hayvan / onay / izin sözcükleri ve Arap noktalaması;
  3. getirme / kabul / izin / yasak fiili ("getirebilirsiniz", "kabul edilir", "allowed", "bring", "erlaubt" …);
  4. başka bir hizmetin adını taşımayan cümlede olumsuzluk, ücret ya da para tutarı ("Gecelik ücret 200 TL." · "Bu mümkün olmuyor." ·
     "Ekstra gecelik 300 TL eklenir.").
  Ayrıca hayvanı adıyla anmayan örtmeceler ("minik dostunuz", "patili", "furry friends") ve kalma / katılma fiilleri
  ("konaklayabilir", "stay with you"). Şüphede tutar; bedeli gereksiz tutmadır ve ölçülür.
- **Dayanak şartı (ölçümden çıktı, 11-12).** Cevaplandığı beyan edilen her isteğin konusu, modele gösterilen bir kaynakta geçmeli
  (bilgi tabanı kalemi; giriş / çıkış saatinde mülkün kendi alanı). Geçmiyorsa cevap gitmez. Sebep §3.1'de: evcil hayvan sorusunun
  yanındaki soru bilgi tabanında yoksa model cevap uyduruyor ve taslak bütün kapılardan geçiyor. 🚨 Bu şart KABADIR (§3.2): soruyla
  ilgili ama cevabı içermeyen bir kalem varsa (kahvaltı ↔ "restoran önerileri") uydurmayı dayanaklı sayar — tek başına güvence değil,
  doğrulanmış cevap parçalarının yanında ek kemerdir.
- Cevap modeli kuralı bilir (kural + kapı çifti): evcil hayvan isteği tutulurken isteme "hayvandan söz etme; cevabı onay / ret sözcüğüyle
  başlatma, içinde de kullanma; yalnız bilgiyi düz cümleyle ver" cümlesi eklenir. Anahtar kapalıyken istem bayt bayt aynı.
- Gönderim yalnız karşılanan isteği kapatır; evcil hayvan isteği ev sahibinde açık kalır ve tutulan öğenin bugünkü bildirimi gider
  (var olan davranış — ödeme isteği + Wi-Fi örneğiyle aynı yol).
- DEĞİŞMEYENLER: anlama katmanı evcil hayvan isteğini öğe olarak çıkaramadıysa (yalnız misafirin cümlesinde) cevap bugünkü gibi tutulur ·
  bilgi tabanı "ücretsiz ve koşulsuz kabul" diyorsa evcil hayvan cevabı bugünkü kuralla gider · yalnız evcil hayvan soran mesajda hiçbir
  şey gitmez · evcil hayvan + şikâyet / iade / tarih değişikliği bugünkü gibi · yardımcı hayvan sorusu her zaman ev sahibinde (öteki bilgi
  gider) · QR misafir sohbeti kapsam DIŞI (orada öğe kipi yok; bugünkü kural) · evcil hayvan sorusu ÖNCEKİ bir turdan bekliyorsa (bu turda sorulmadıysa) cevap bugünkü gibi
  tutulur (11-12 sabah daraltması — turlar arası serbest bırakma ayrı karar + ölçüm, §12).
- Genel denetim (eleştiri 1) bu dilimde yok: sigara / parti / ek kişi içeren mesaj bugünkü gibi bütünüyle tutulur (güvenli yön). Aynı
  kalıp ("tutulan tür → cevap ona değiyor mu") arızalı cihaz için zaten var; evcil hayvan ikinci örneği. Ölçüm iyi çıkarsa öteki türler
  aynı kalıpla, her biri kendi ölçümüyle eklenir.

**Örnek (anahtar açık; misafir: "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?").**

| Modelin yazdığı | Bugün | Anahtar açıkken |
|---|---|---|
| "Wi-Fi ağı Lale_Home, şifresi Lale2024." | gitmez (ikisi de sizde) | gider; evcil hayvan sorusu sizde açık |
| "Evet, getirebilirsiniz. Wi-Fi şifresi Lale2024." | gitmez | gitmez |
| "Tabii! Wi-Fi şifresi Lale2024." | gitmez | gitmez ("Tabii" köpek sorusuna da okunur) |
| "Wi-Fi şifresi Lale2024. Köpeğiniz için ayrıca döneceğiz." | gitmez | gitmez (hayvandan söz ediyor) |

**Ölçüm (kurucu: "sonuç görülmeden açılmasın; testleri çalıştırabilirsin").** İki sayı birlikte: yanlış izin gönderimi (hedef 0) ve doğru
bilgi cevabının gereksiz tutulması. Ürünün kanal akışı olduğu gibi koşar (gerçek model çağrıları, hiçbir şey kimseye gitmez); anahtar
kapalı ve açık iki kol. Geliştirme seti açık (27 senaryo, yedi dil, dört bilgi tabanı: kural yok / ücretli-koşullu / yasak / ücretsiz).
Kabul ölçümü ayrı yazarın görmediğim setiyle (mühürlü; ben yalnız toplam sayıları okurum). Sonuçlar: §3.1.

### 3.1 Ölçüm sonuçları (11-12; cevap modeli gpt-5.1, planlanan canlı yapılandırma; raporlar `docs/olcum/live-pipeline-2026-11-12-…`)

**Geliştirme seti (açık, 24 evcil hayvanlı senaryo + kontroller).**

| | Bugün (kapalı) | Açık — ilk yazım | Açık — son hâl (dayanak şartıyla) |
|---|---|---|---|
| Evcil hayvan sorusu sizde kaldı | 24/24 | 24/24 | 24/24 |
| 🚨 Yanlış izin / hayvana değinen cevap giden | 0 | 0 | 0 |
| Yanındaki sorunun doğru cevabı giden | 0/21 | 20/21 | 19/21 |
| Yanındaki soruda gereksiz tutma | 21 | 1 | 2 |
| 🚨 Uydurma / yanlış cevap giden | 0 | 1 | 0 |

Kalan iki gereksiz tutma evcil hayvanla ilgisiz: İngilizce "giriş saati" sorularını başka bir kapı (müsaitlik doğrulaması) tutuyor.

**İlk yazımın açığı — yanındaki soru bilgi tabanında YOKSA (beş konu × üç bağlam).**

| Misafirin mesajı | Uydurma cevap giden — ilk yazım | Son hâl |
|---|---|---|
| "Köpeğimizi getirebilir miyiz? + (eczane · bebek yatağı · ütü · transfer · kahvaltı)" | **5/5** | **0/5** |
| "İnternet şifresi ne? + aynı beş soru" (evcil hayvan YOK — bugünkü davranış, S3'e bağlı değil) | 1/5 | 1/5 |
| Aynı beş soru tek başına | 0/5 | 0/5 |

Giden uydurmalar: "Dairede misafirlerimizin kullanımına açık ütü bulunmaktadır." · "Kahvaltı servisi bulunmuyor." · "En yakın eczane, binanın
yaklaşık 150 metre ilerisindedir." (bilgi tabanında 150 metre MARKET için yazıyor). Model bunları yüksek güvenle ve kaynak göstererek
yazdı; hiçbir kapı tutmadı. Bugün bu taslakları evcil hayvan kemeri tesadüfen tutuyor. Dayanak şartı bu 15 senaryoda hepsini kesti;
ama şart kabadır — bilgi tabanında soruyla ilgili başka bir kalem olsaydı kesmezdi (§3.2; bu sette öyle kalem yoktu).

**Kabul ölçümü — mühürlü set (ayrı yazar; 51 senaryo, 96 ihtiyaç, yedi dil; ben içeriğini görmedim).**

| | Bugün (kapalı) | Açık (son hâl) |
|---|---|---|
| Evcil hayvan sorusu sizde kaldı | 45/45 | 45/45 |
| 🚨 Yanlış izin / hayvana değinen cevap giden (hedef 0) | 0 | **0** |
| Yanındaki sorunun doğru cevabı giden | 0/38 | **29/38** |
| Yanındaki soruda gereksiz tutma | 38 | 8 |
| 🚨 Yanındaki soruda yanlış değer giden | 0 | **1** |
| Bütün sette giden mesaj | 3/51 | 34/51 |

Açık kalan noktalar: (1) o tek yanlış değer anahtar kapalıyken GİTMİYORDU (0 → 1): içeriği ne olursa olsun bu değişikliğin açtığı
yoldan giden yanıltıcı bir cevaptır — ilk yazdığım "evcil hayvanla ilgisiz" etiketi yanlıştı. Ne olduğunu göremiyorum (set mühürlü;
yalnız toplam; set yakıldı, ayrıntılı bakılabilir ama bir daha kabul için kullanılamaz). (2) Sözcük listesi her dolaylı izni sayamaz
("Sizi ve küçük arkadaşınızı bekliyoruz" gibi); 69 evcil hayvanlı senaryoda model böyle bir cümle hiç yazmadı, ama garanti değil. İkinci
katman, cevabı misafirin mesajıyla birlikte okuyan denetim modelidir (kıdemli okuyucu — kapalı, kendi ölçümünü bekliyor).

**Yan bulgu — S3'ten bağımsız, bugünkü yapılandırma.** Evcil hayvan olmayan iki soruluk mesajda da model bilgi tabanında olmayan soruya
cevap uydurup gönderebiliyor: "İnternet şifresi ne? Kahvaltı veriyor musunuz?" → "Wi-Fi ağ adı Lale_Home, şifresi Lale2024. Kahvaltı
hizmeti sunmuyoruz." (üç koşunun üçünde). Aynı bağlamda öteki dört konuda ise cevabın tamamı tutuluyor (Wi-Fi şifresi de gitmiyor).
İki çözüm ölçüldü: aynı dayanak şartını bütün öğe kipine uygulamak (bu 15 senaryoda uydurmaların hepsini tutar) ya da cevap parçaları
kipi (uydurma 0/15 ve Wi-Fi cevabı 5/5 gitti; ama düz "İnternet şifresi ne?" sorusunu bir koşuda tuttu — kendi kabul ölçümü gerekli).
Karar sizde (§12).

### 3.2 Sert inceleme (11-12 sabah) — S3 bu hâliyle açılmaz

Dilim sonu incelemesi (Opus, salt-okuma; bulguların tamamı ve her birine ne yapıldığı `docs/INCELEME-2026-11-12-opus-s3.md`) anahtar
kapalıyken hiçbir farkın olmadığını doğruladı; anahtar AÇIKKEN dört önemli açık buldu. Hepsini kodda denedim:

| Açık | Örnek | Yapılan |
|---|---|---|
| Dayanak şartı kaba | Misafir: "Köpeğimizi getirebilir miyiz? Kahvaltı veriyor musunuz?" — bilgi tabanında "restoran önerileri" kalemi varsa "Kahvaltı servisi bulunmuyor." dayanaklı sayılıp gidiyordu | dal yalnız doğrulanmış cevap parçalarında açılır (her cevap bilgi tabanındaki cümlenin birebir alıntısına bağlı) |
| Sözcük ağında Arapça yok | "evcil hayvanlar kabul edilir" anlamındaki Arapça cümle geçiyordu | eklendi |
| Yaygın onay öbekleri | "Mümkün. Wi-Fi şifresi …" · "Sure thing! …" · "Pas de souci ! …" geçiyordu | eklendi |
| Ücret sözcüğü olmayan tutar | "Wi-Fi şifresi Lale2024. Ekstra gecelik 300 TL eklenir." geçiyordu | eklendi |

Ayrıca: dal yalnız AYNI turda çıkarılmış evcil hayvan isteğinde açılır (ölçülen kapsam; önceki turdan bekleyen soru bugünkü gibi tutar);
istem cümlesi mülk bilgilerini de sayar; ölçüm satırlarına "cevabı olmayan yan soru" eklendi; yeni kalıplar en kötü düzenli ifade
kipinde ölçüldü.

**Neden yine de açılmaz.** Sözcük ağı bir ağdır — sayılmamış bir öbek her zaman kalır; geliştirme setinin "yanlış izin 0" sayısı da
aynı sözcük listesiyle ölçüldüğü için sözcük düzeyinde döngüseldir. Güvence iki katmandan gelir ve ikisi de henüz kabul ölçümünden
geçmedi: (1) cevap parçaları kipi (uydurmayı keser), (2) cevabı misafirin mesajıyla birlikte okuyan denetim (dolaylı izni yakalar).
Sıra: parça kipinin kabul ölçümü → okuyucu denetimi → yeni mühürlü setle S3 (yanlış izin bağımsız okumayla da sayılır) → karar.

Geliştirme setinde parça kipiyle: ilk yazım (`04d90bca`) yanındaki sorunun doğru cevabı 16/21; **son hâl (`dda799c8`) 15/21**,
iki koşuda da yanlış izin 0, yanlış değer 0, cevabı olmayan yan soruda uydurma 0/15. Öğe kipindeki 19/21'den düşük — güvenin bedeli.
Son hâldeki altı gereksiz tutma: parça doğrulayıcısı (2), müsaitlik doğrulaması (1), okuyucu denetimi (2) ve benim eklediğim Arapça
kalıbın selamı onay sayması (1 — ölçüm yakaladı, düzeltildi). Raporlar `docs/olcum/…-s3-sonhal-parca.md`.

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
- Kendi yeniden işlememiz "webhook sırrı sağlam" kanıtı sayılmaz (Opus incelemesi, 11-12): gövdeyi biz imzaladığımız için imza hep
  tutar; sır Paddle'ınkiyle uyuşmuyorken "imza tutmuyor / webhook gelmiyor" alarm durumları yalnız Paddle'ın gerçek teslimiyle kapanır
  (süreç içi işaret; dışarıdan verilemez). Aksi hâlde her yeniden işleme alarmı sıfırlar, sonraki ret yeniden e-posta atardı.
- İnceleme bekleyen ve işleyicisi olmayan olaylar aday sorgusunda elenir (okunan dilim 200 satır): çok sayıda eski "inceleme bekliyor"
  kaydı yeni hataların önünü kesemez.

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

**Yanında bulunan ve düzeltilen (kalıcı kuyruk yolu).** Giriş göndericisi her turda "ertelenmiş" kuyruk satırının vadesini şimdiye
çekiyordu (tarih yeniden pencereye girdiyse beklemesin diye). Aynı satır, işçinin kesin retten sonra geri çekilmesi ya da hız sınırı
beklemesi yüzünden ileri atılmış da olabiliyordu → o bekleme de siliniyordu. Kural artık yalnız hata bilgisi boş satıra uygulanır; işçi
tarihe göre ertelerken hata bilgisini temizler. İşçi de "çok fazla istek" cevabının izini silmiyor, "reddedildi" diye yazıyordu —
kuyruk kapatılırsa doğrudan yolun defteri onu sayardı; iki yol artık aynı kuralı uygular.

**Kanıt.** Kırmızı-önce (eski kodda yeni testler kırmızı) · mutasyon 43/44 → yaşayan tek mutant (defterin tür süzgeci) aynı metinli iki
türle pinlendi · ilgili 118 dosya yeşil · Haiku incelemesi (6 soru): gövde özeti üç göndericide de gönderilen metinle birebir aynı;
uygulanan tek bulgu işçinin 429 izi.

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

## 12. Onayınızı isteyen yeni metinler ve küçük kararlar

Koda girmiş ama onayınızı bekleyen tek yeni metin 3d rozetidir (Railway kapalı — hiçbir müşteri görmedi); ötekiler henüz yazılmadı.

| Yer | Metin / karar | Durum |
|---|---|---|
| 3d, yalnız kayıtlı bilgiden kurulan taslağın rozeti | "Kayıtlı bilgilerinizden hazırlandı — soruya uygunluğunu kontrol edin" | kodda, onay bekliyor |
| 3d, öneri alanı notu | "Yapay zekâ önerisi şu an hazırlanamadı." | sizin metniniz, kodda |
| S1, ikinci onaylayan | Bugünkü metinler kullanıldı ("Mesaj sıraya alındı — birazdan gönderilecek." · "Mesaj gönderildi." · "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor."). İsterseniz ayrı bir cümle: "Bu öneri az önce başka biri tarafından gönderildi." | karar sizde |
| S1, gönderimi doğrulanamamış öneriyi yeniden onaylayan | Bugünkü metin kullanıldı ("Bu mesaj az önce gönderildi veya hâlâ gönderiliyor."). İsterseniz ayrı bir cümle: "Bu önerinin gönderimi doğrulanamadı. Konuşmayı kontrol edin; ulaşmadıysa metni kutuya alıp gönderin." | karar sizde |
| S1, başka biri cevapladıktan sonra eski "gönderilemedi" öneri satırını elle yeniden deneme | Bugün izin var (ev sahibinin açık tıklaması). "Bu konuşma sonradan cevaplandı" diye engellemek ayrı karar | karar sizde |
| S3, anahtarı açma | Kör sette yanlış izin 0/45, yanındaki soru 29/38 cevaplandı, **1 yanlış değer gitti (anahtar kapalıyken 0)**. Sert inceleme sonrası önerim: bu hâliyle AÇILMASIN (§3.2). Soru: cevap parçaları kipinin ve okuyucu denetiminin kabul ölçümü öne alınsın mı | karar sizde |
| S3, önceki mesajdan bekleyen evcil hayvan sorusu | Dün "Köpeğimizi getirebilir miyiz?" (cevaplanmadı), bugün "Otopark nerede?" → bugün gitmez; anahtar açıkken de gitmez. Otopark cevabı gitsin mi (çok turlu ayrı ölçümle) | karar sizde |
| Bilgi tabanında olmayan soruya uydurma cevap (bugünkü yapılandırma) | Dayanak şartı bütün öğe kipine uygulansın mı ("Kahvaltı hizmeti sunmuyoruz" gitmez; o soru size kalır) | karar sizde |
| S2, tekrar eden soru | Geç mesaj, cevabımızın az önce karşıladığı soruyu yeniden soruyorsa bugün ölçülen: aynı cevap ikinci kez gidiyor (2/5). (A) kalsın · (B) o türden istek size kalsın (§2.2) | karar sizde |
| S2, anahtarı açma | Geliştirme setinde yeni sorular 0/9 → 9/9; hassas / kapanış / acil / şikâyet / şart dışı 0 gönderim; bilgi tabanında olmayan soruda bilinen uydurma 1/3. Önerim: uydurma sorununun çözümünden önce açılmasın; kabul ölçümü sonucu §2.3 | karar sizde |
| S1, öneriden sonra yeni misafir mesajı gelirse | Bugün onaya izin var (öneri yeni mesajı görmeden yazılmış olsa da). Engelleyip "Yeni mesaj geldi — öneriyi yenileyin" demek ayrı karar | karar sizde |
| S8, ev sahibine görünürlük | Kanalın reddettiği otomatik mesaj bugün yalnız operatör alarmında. "Otomatik mesajlar" kartına satır: "Bu mesaj kanal tarafından reddedildi; yeniden deneniyor." | karar sizde |
| S4, liste başlığı | "Otomatik atananlar" · "Sizin atadıklarınız (seçerseniz aktarılır)" | migration turu |
| S6, ayar çakışması | "Bu ayar başka bir yerde değiştirildi. Güncel hâli aşağıda; sizin yazdığınız korunuyor." | migration turu |
| 3b, kural kutusu | "Daha önce konaklamış misafire otomatik gönderme" · rezervasyonda: "Bu rezervasyonda yapay zekâ otomatik cevap vermesin" | 3b kararına bağlı |
| 3c, misafir | "Ayşe · Ev sahibi" · "Mehmet · Ekip" · adı kapalıysa "İşletme ekibi" | migration turu |

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

1. Şemasız ve ölçümsüz olanlar: 3c görsel kısmı · 3d · S8 · S7 · S1 (her biri kırmızı-önce + mutasyon + tam kapı) — ✅ 11-11 gece yazıldı.
2. Migration turu (§13) — onayınızla.
3. Ölçüm isteyenler, anahtar kapalı: S3 → S2 → §11 (devir alanı). Her biri eski / yeni kıyasıyla size gelir.
