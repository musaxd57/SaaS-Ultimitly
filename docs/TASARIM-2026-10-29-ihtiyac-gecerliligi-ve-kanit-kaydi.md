# Tasarım 10-29 — İhtiyacın geçerliliği (8-4c-1) + ihtiyaç başına kanıt kaydı (G-1)

> Kurucu kararları (aynen, `docs/KURUCU-KARARLARI-2026-10-28-karar-masasi.md` sonu): **8-4c-1** "Evet, tasarım + gölge ölçümle kuralım" ·
> **G-1** "Evet, önce gölge kayıt". İki kararın da şartı: **bugünkü gönderim davranışı değişmez**; önce kayıt, ölçüm, sonra kurucu kararıyla
> politika. Bu belge önceki iki tasarımın üzerine kurulur, onları tekrar etmez: `docs/TASARIM-2026-10-23-ihtiyac-defteri.md` (ihtiyaç defteri,
> parça kipi) ve `docs/TASARIM-2026-10-28-aksam-kurucu-aciklamalari.md` §2 (güven → kanıt) + §3 (8-4c).

## 0. Kurucunun bu iki karara yazdığı ilkeler (özet; bağlayıcı metin karar belgesinde)

1. **Üç ayrı soru** — her ihtiyaç için ayrı ayrı: *bilginin geçerliliği* (söyleyeceğimiz şey bugün doğru mu) · *ihtiyacın durumu* (misafir hâlâ
   bekliyor mu, vazgeçti mi, yeni taleple değiştirdi mi) · *bu mesajın gönderilebilirliği* (bu cevabı ŞİMDİ göndermek hâlâ yararlı ve uygun mu).
   "Bir mesajın gönderim hakkı sona erebilir; misafire karşı açık işimiz devam edebilir."
2. **İki ayrı süre** — *otomatik gönderim penceresi* (ihtiyacın türüne ve kanala göre; QR'daki basit bilgi sorusu ≠ haftalar sonraki konaklama
   için araştırılan istek) · *anlamlı kalma sınırı* (olaya bağlı: "bu akşam", "yarın girişten önce", "13:00'e kadar"). Kesin dakikalar ÖLÇÜLMEDEN
   yazılmaz.
3. **Saat sorunun yaşından işler**: ev sahibinin geç onayı ya da işçinin yeniden denemesi sorunun yaşını SIFIRLAMAZ ("üç günlük cevap 'şimdi
   onaylandı, yepyeni' diye gönderilmesin").
4. **Konu değişmesi isteğin iptali değildir**: "15 mesaj geçti" ya da "başka konu konuşuldu" tek başına isteği kapatmaz. Vazgeçme, yanıtlanma,
   yeni taleple değiştirilme ve sürenin dolması AYRI durumlardır.
5. **Çıkış sabahı kuralı kaba**: geçerlilik gerçek tarih + konaklama durumu + talebin amacı + ev sahibinin kararıyla belirlenir (11:10'da gelen
   "13:00'e kadar kalabilirsiniz" onayı misafir hâlâ dairedeyse işe yarar; misafir 10:30'da ayrıldıysa anlamsız).
6. **Kod / model ayrımı**: model yeni mesajın vazgeçme / düzeltme / tekrar sorma / bağımsız başka konu olup olmadığını anlar ama hangi ihtiyaç ve
   hangi mesajlara dayandığını göstermek zorundadır; kod alıcıyı, konaklamayı, tarihleri, kaynak sürümlerini, gönderim sınırını ve tekrar
   güvenliğini korur. "Geçmişteki 40 doğru gönderim, bugünkü süresi geçmiş cevaba izin vermemeli."
7. **Ev sahibi kısa ve somut neden görür** ("Soru üç gün önce soruldu; otomatik gönderim penceresi doldu." · "Onaydan sonra çıkış tarihi
   değişti."); gönderim penceresi dolan ihtiyaç SESSİZCE KAYBOLMAZ, ev sahibine söylenir. Eski "ekip gelecek" metni tek düğmeyle doğrulanmış gerçeğe
   dönüşmez → gerekirse yeni durum mesajı hazırlanır.
8. **Misafire otomatik "Sorunuz hâlâ geçerli mi?" varsayılan değil** ("AIımız müşteriye gerekmedikçe soru sormamasını daha çok isterim").
9. **Kesintiden dönüşte toplu gönderim yok**: her mesaj güncel durum ve son geçerlilik açısından yeniden değerlendirilir; bunun KANITI istenir.
10. **G-1 kanıtı ayrı alanlar**: doğru misafir ve daire mi · kaynak bu cevabı destekliyor mu · cevap sorulan ihtiyacı karşılıyor mu · tarih ve
    koşullar hâlâ geçerli mi · çelişki / eksik var mı. "Okuyucu evet dedi" yeni bir açıklamasız güven sayısına DÖNÜŞMEZ. Geçmişte düzeltilmeden
    gönderilen cevap "doğrulanmış doğru" SAYILMAZ. Kesin güvenlik ve yetki engelleri başka olumlu sinyallerle aşılamaz. Kaynağın onay tarihi ile
    sorunun bekleme süresi AYRI değerlendirilir.

## 1. Bugün kodda olan (ölçülmüş envanter — yeniden yapılmayacak)

| parça | ne yapıyor | kanıt |
|---|---|---|
| Konuşma öğesi (ihtiyaç satırı) | durum kümesi `open · pending_host · answered · withdrawn · superseded · done`; aynı türden ikinci istek `ordinal`; kısa konu `topic` | `prisma/schema.prisma` `ConversationItem`, `conversation-items/core.ts` |
| Karar isteği (erken giriş / geç çıkış / uzatma / tarih değişikliği) | `pending · sending · approved · declined · send_unverified · superseded · dismissed · resolved_by_policy`; CAS `version`; hedef gün `dayKey`; istenen saat | `DecisionRequest`, `lib/decisions/*` |
| Giden kuyruk gönderim anı vetosu | konuşma / mesaj yok · kiracı uyuşmazlığı · ev sahibi devraldı / durdurdu · **daha yeni mesaj geldi → AI taslağı gitmez** · tetik mesajından sonra gelen misafir mesajı | `outbox/worker.ts replyVeto` |
| Kuyruk satırı ömrü | `expiresAt`; süresi geçen satır gönderilmez | `outbox/worker.ts`, `outbox/health.ts` |
| Yaşam döngüsü mesajlarında bayatlık | konaklama bittiyse giriş mesajı gitmez; çıkış mesajı çıkış GÜNÜ bitince bayat (org saat dilimi) | `outbox/worker.ts` (~583–620) |
| Abonelik kapalıyken bekleyen mesaj | ödeme gelince bayat cevap / giriş bilgisi gitmez | `outbox/billing-hold.ts` |
| Parça kipi hükmü | ihtiyaç başına doğrulandı / bilgi yok / eksik / reddedildi (+ sebep) — yalnız istek anında, kalıcı değil | `ai/answer-parts.ts`, `SuggestReplyResult.answerParts` |
| Doğrulanmış cevap gölge tablosu | ev sahibinin değiştirmeden gönderdiği parça + alıntı + kaynak + parmak izi; gölge isabet / uyuşmazlık sayaçları | `VerifiedAnswer` (migration 85), `answer-reuse/*` |
| Kanıt izi | bulunan kalem kimliği + sürüm (`updatedAt`) + parça no; kapı sonucu ve gerekçe kodu (`RiskEvent` A2 alanları) | `ai/grounding.ts`, `risk-events.ts` |

## 2. Eksikler (kurucunun ilkelerine göre)

| # | eksik | bugünkü davranış (örnek) |
|---|---|---|
| E1 | İhtiyaç başına **son geçerlilik** yok | "Bu akşam havuz açık mı?" sorusunun cevabı ertesi gün ev sahibince onaylanırsa kuyruk onu yeni bir cevap gibi görür; tek fren "daha yeni mesaj geldi" kuralı. |
| E2 | Bayatlık **mesaj düzeyinde**, ihtiyaç düzeyinde değil | daha yeni bir mesaj gelince AI taslağı gitmez — güvenli ve doğru — ama ihtiyacın kendisine "gönderim hakkı doldu, iş açık" diye bir durum yazılmaz; ev sahibi panelde bunu ayrıca görmez (ilke 7). |
| E3 | Sorunun yaşı ile kaynağın onay tarihi ayrı tutulmuyor | kanıt izinde kalem sürümü var ama "soru kaç saattir bekliyor" kararın girdisi değil. |
| E4 | Kanıt **anlık** | parça hükümleri yalnız istek anında; ev sahibinin sonraki onayı / düzeltmesi aynı ihtiyaca bağlanmıyor → ilke 10'daki etiketler (düzeltildi mi) yok. |
| E5 | Kesintiden dönüş kanıtı | kuyrukta `expiresAt` + mesaj vetosu var; "üç günlük kuyruk açılınca hiçbiri topluca gitmedi" senaryosu uçtan uca testle pinli değil. |

## 3. Önerilen model

### 3.1 İhtiyaç satırına üç zaman (yeni, boş olabilen alanlar — migration ister)

- `askedAt` — misafirin ihtiyacı İLK yazdığı an (bugün `createdAt` ≈ bu; ama yeniden işleme / tekrar soru ile karışmasın diye ayrı ve DEĞİŞMEZ).
- `sendWindowUntil` — otomatik gönderim penceresinin sonu (türe + kanala göre; ölçümle seçilecek, §5).
- `meaningfulUntil` — anlamlı kalma sınırı (olaya bağlı; kodla, mümkünse misafirin kendi ifadesinden: "bu akşam" → o günün 23:59'u mülk diliminde;
  "13:00'e kadar" → o gün 13:00; geç çıkış → çıkış günü + istenen saat; konaklama sonu bilinmiyorsa boş).

Saatler HİÇBİR geçişte sıfırlanmaz (ilke 3). Tarihler `ai/date-reading.ts` + `ai/stay-timeline.ts` tek kaynağından okunur (gece yarısı
"yarın" belirsizliği dahil); okunamayan ifade = sınır yok (tahmin üretilmez).

### 3.2 Durumlar (ilke 4 — ayrı ayrı)

| durum | kim koyar | anlamı | örnek |
|---|---|---|---|
| `answered` | kod (teslim doğrulanınca) | cevap gerçekten gitti | bugünkü gibi |
| `withdrawn` | model + kanıt (hangi mesaj) | misafir vazgeçti | "Tamam, gerek kalmadı" |
| `superseded` | model + kanıt | yeni taleple değiştirildi | "13:00 değil 14:00'e kadar kalabilir miyiz?" |
| `send_expired` (yeni) | kod | gönderim hakkı doldu, **iş açık** | üç gün bekleyen havuz sorusu — ev sahibine "gecikmiş ihtiyaç" |
| `moot` (yeni) | kod | anlamlı sınır geçti | "bu akşam havuz açık mı?" ertesi gün |

"Başka konu konuşuldu" HİÇBİR duruma geçiş değildir. Misafir aynı konuyu yeniden sorarsa ("Havuz saatini öğrenebildiniz mi?") yeni mesaj
ihtiyacı yeniden doğrular: aynı satır, `askedAt` aynı, ama eski taslak körlemesine kullanılmaz — güncel bilgiyle yeni cevap hazırlanır.

### 3.3 Gönderim anı kontrolü (kod; bugünkü `replyVeto`nun YANINA, onu gevşetmeden)

Onaylı / kuyruktaki cevap için gönderimden hemen önce, ihtiyaç başına:
1. ihtiyaç hâlâ açık mı (vazgeçme / değiştirme / başka yoldan cevaplanma yok);
2. `meaningfulUntil` geçmedi mi; `sendWindowUntil` geçmedi mi (geçtiyse `send_expired`, ev sahibine somut neden);
3. onaydan sonra rezervasyon değişti mi (tarih / durum / misafir — karar anındaki parmak izi ile kıyas);
4. dayanak kalemin sürümü onaydan sonra değişti mi;
5. aynı ihtiyaç ev sahibinin başka mesajında zaten cevaplandı mı (bu MODEL sorusu — önce gölgede ölçülür).

Kesintiden dönüş: kuyruk her satırı bu kontrolden geçirir; ayrıca **toplu geri dönüş freni** — tek geçişte belli sayının üstünde eski satır
bulunursa yalnız en yeni tur değerlendirilir, ötekiler ev sahibine "kesinti sırasında bekledi" listesiyle döner (sayı ölçülecek). Uçtan uca test:
üç günlük kuyruk açılır → misafire hiçbir eski mesaj gitmez (E5).

### 3.4 Geç cevabın dili

Cevap ihtiyacın sorulmasından uzun süre / çok mesaj sonra gidiyorsa ve konu o arada değiştiyse, model başına misafirin KENDİ sorusuna çapa
koyar ("Geç çıkış sorunuzla ilgili: …"); mekanik değil, yalnız gerektiğinde (ilke: "her cevapta mekanik biçimde kullanılmasına gerek yok").
Kod çapanın gerçekten o ihtiyacın konusunu andığını denetler.

⚠️ **Çelişki — soru S2:** 8-2 notunuz ("bu arada yazmayı unutmuşum, eklemeyi unutmuşum diyebilsin") ile kalıcı kural T-a (özür / kusur kabulü
misafire gitmez, kıdemli okuyucu `reply_apology`) çakışıyor. "Unutmuşum" bir kusur kabulüdür.

### 3.5 Ev sahibi görünümü

Panelde "Gecikmiş ihtiyaçlar" — her satırda somut neden (§0 ilke 7 örnekleri), sorunun yaşı, kaynağın onay tarihi AYRI. "Gönder" düğmesi eski
metni değil **güncel önizlemeyi** gönderir; gerçeğe dönüşmesi gereken metin (ekip gelecek, teknisyen gelecek) yeni durum mesajı olarak hazırlanır.

## 4. G-1 — ihtiyaç başına kanıt kaydı (gölge)

Her cevap turunda, her ihtiyaç için bir kanıt satırı (karar DEĞİŞMEZ, yalnız kayıt):

| alan | üretici | not |
|---|---|---|
| `identityOk` | kod | konuşma ↔ rezervasyon ↔ mülk ↔ kiracı eşleşmesi; yanlış misafir / daire riski |
| `sourceSupports` | kod (parça doğrulayıcısı `answer-binding`) | sebep kodlarıyla (`value_not_in_evidence`, `polarity_mismatch` …), sayı değil |
| `readerSupports` | okuyucu (anahtarlıysa) | AYRI sütun — kodun hükmüyle birleştirilip tek sayı yapılmaz |
| `answersNeed` | kod (`missingAspects`) + okuyucu | saat / tutar soruldu, cevap veriyor mu |
| `conditionsValid` | kod (`stay-timeline`, `date-reading`) | tarih, konaklama durumu, "bu akşam" sınırı |
| `conflicts` | kod (saat çelişkisi, mülk hafızası çelişkisi) | liste |
| `hardBlock` | kod (kapının kesin engelleri: acil, injection, ödeme, kimlik …) | olumlu sinyaller bunu AŞAMAZ (ilke 10) |
| `sourceApprovedAt` / `askedAt` | kod | ayrı ayrı (ilke 10, son madde) |
| `actualDecision` / `policyWouldDecide` | kod | gölge kıyası: bugünkü karar ↔ yeni politika ne derdi |
| `hostOutcome` (sonradan) | kod | ev sahibi aynen gönderdi / düzeltti / sildi — yalnız bu ETİKETTİR; düzeltmeden otomatik giden etiket SAYILMAZ |

Kalibrasyon ayda bir: hangi kanıt bileşimi ev sahibinin aynen onayladığıyla ne kadar örtüşüyor — sayı değil, tablo.

## 5. Gölge ölçüm (önce kayıt, karar değişmez)

- Ölçülecek: (a) yeni politikanın TUTACAĞI ama bugün GİDEN cevaplar ve bunların ev sahibince sonradan düzeltilme oranı; (b) yeni politikanın
  GÖNDERECEĞİ ama bugün TUTULAN ve ev sahibinin aynen gönderdiği cevaplar; (c) `send_expired` / `moot` olacak ihtiyaçların türe ve kanala göre
  bekleme dağılımı → pencere sürelerinin ADAYLARI buradan çıkar (ilke 2: ölçmeden evrensel süre yazılmaz).
- Başlangıç adayları (yalnız gölge kayıt için, karar değil): QR basit bilgi sorusu kısa (dakikalar), kanal bilgi sorusu saatler, konaklama
  öncesi araştırılan istek günler. Gerçek değerler ölçümden.
- Veri: Railway açılınca canlı trafik; o zamana kadar kayıtlı konuşmalar üzerinde çevrimdışı tekrar oynatma (yalnız okunur, ücretsiz — model
  çağrısı yok; model gerektiren 3.3/5. madde kredi gelince).

## 6. Fazlar

| faz | ne | migration | müşteriye etkisi |
|---|---|---|---|
| F0 | saf fonksiyonlar: `meaningfulUntil` okuyucu (ifade → sınır), pencere sınıflayıcı, bayatlık nedenleri, toplu geri dönüş freni kararı + testler; kesintiden dönüş uçtan uca testi (bugünkü kurallarla — E5) | yok | yok |
| F1 | `ConversationItem`e `askedAt · sendWindowUntil · meaningfulUntil` (boş olabilir) + kanıt tablosu `NeedEvidence` (KVKK silme / dışa aktarma kapsamında) | **evet — onay + taze yedek** | yok |
| F2 | gölge yazımı (her tur) + gölge kıyas raporu | — | yok |
| F3 | politika açılışı (anahtarla) — önce/sonra örnekli kurucu kararı | — | var |

## 7. Sorular

- **S1 (F1 migration):** `ConversationItem`e üç boş zaman alanı + yeni `NeedEvidence` tablosu (alanlar §4). Dolu tabloya yalnız boş alan
  eklenir, yeni tablo; KVKK: misafir metni TAŞIMAZ (yalnız kodlar, kimlikler, zamanlar). Onaylıyor musunuz?
- **S2 (8-2 notu ↔ özür yasağı):** geç cevapta "eklemeyi unutmuşum" gibi bir cümle kusur kabulüdür ve T-a kuralına göre misafire gitmez.
  Önerim: kusur kabulü yerine soruya çapa ("Geç çıkış sorunuzla ilgili: …"). Böyle kalsın mı?
- **S3:** gölge kayıt için başlangıç pencere adayları §5'teki gibi kaba sınıflar olsun mu, yoksa ilk hafta hiçbir aday olmadan yalnız bekleme
  dağılımı mı toplansın?
