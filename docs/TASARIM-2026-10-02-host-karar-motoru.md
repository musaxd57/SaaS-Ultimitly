# Host Karar Motoru — Faz 1 tasarımı ve uygulaması (10-02 gece)

> **Durum:** kodda, `HOST_DECISIONS_ENABLED` anahtarının arkasında (VARSAYILAN KAPALI). **Migration 59** (yeni tablo) içerdiği için
> İTİLMEDİ — CLAUDE.md kuralı: migration içeren push = taze `pg_dump` + kurucunun açık "push et" onayı. Misafire giden karar
> metinleri (7 dil) ayrı onay: Sabah Kararları 62. Faz 0 onay paketi: `docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md` (K1–K10).

## 0. Kurucunun tarifi (10-02 akşam, aynen özet)

> "Cevap vermek, talebi çözmek değil. Misafir 'Saat 13:00'te giriş yapabilir miyiz?' diye soruyor; sistem talebi kapanmış
> sayıyor, host'a bildirim göndermiyor. Host panelinde '13:00 erken giriş — karar bekliyor' açık kalır. Host'a bir bildirim
> gider; tekrar tekrar gönderilmez. Host onaylayınca veya reddedince talep sonuçlanır. Baştan savma cevap vermeyecek; gerekirse
> bir şey yazmaz. Temizlikçinin işaretlediği saate, mesajlara, çıkış yapacak ve girecek kişinin saatine bakacak."
>
> "Panelde 'karar bekliyor' kartı ve Onayla / Reddet düğmeleri … en iyi en güzel şekilde doğru UX'li şekilde bitir … 2 tur
> tekrardan bakıyormuş gibi ol; UX olarak da gelişmişlik özellik olarak da ve hata olmaması konusunda."

## 1. Akış (anahtar açıkken)

1. **Misafir yazar** ("Yarın 13:00'te girebilir miyiz?"). Oto-yanıt turu bugünkü kapılardan geçer (değişmedi).
2. **Konaklama isteği tutulursa** (kapının BİRLEŞİM kuralı: kelime ağı ∨ cevap modelinin beyanı / niyeti ∨ anlama katmanı ∨
   bekçi — `stayRequestKinds`; otomatik gönderimi durduran sinyalin AYNISI) `DecisionRequest` açılır: tür, istenen saat, hedef
   gün, misafirin dili, bağlı konuşma öğesi.
   - **Saat:** yalnız isteği GÖREN modelin (anlama / bekçi) okuması ve standardın doğru tarafındaysa (erken giriş standarttan
     önce, geç çıkış sonra); okuma yoksa misafirin yazdığı TEK açık saat; o da yoksa BOŞ — ev sahibi kartta seçer (tahmin yok).
   - **Gün:** erken giriş = varış günü; geç çıkış / uzatma = çıkış günü (tek tarih kuralı `calendarDateOf`, mülk dilimi).
   - Saatli geç çıkış talebi bir GECE uzatması değildir ("Çıkışı 13:00'e uzatabilir miyiz?" tek kart).
   - Doğrulanmış otomatik erken giriş onayı / politika metni seçildiyse kart açılmaz; otomatik onay kartı "otomatik onaylandı"
     olarak kaydeder (`resolveDecisionByPolicy`; onaylı saat yapısal kalır).
3. **Bildirim:** mesaj başına TEK "Karar bekliyor: 13:00 erken giriş — Ada (Lale)" e-postası. K10'un "Misafir cevabınızı
   bekliyor" e-postasının YERİNE gider (aynı kilit `reply-waiting-mail:<mesaj>`); aynı mesaj için hassas öğe e-postası zaten
   gittiyse (`held-items-mail:<mesaj>`) ikincisi yok. E-posta misafir metni taşımaz; bağlantı konuşmaya gider.
4. **Panel:** gelen kutusunda "Karar bekliyor" rozeti, panoda (Dikkat Gerektirenler) "Karar bekliyor: 13:00 erken giriş" satırı,
   konuşma sayfasının EN ÜSTÜNDE kart.
5. **Karar:** ev sahibi Onayla / Reddet (metni kod kurar, ev sahibi görür ve düzenleyebilir) ya da "Gerek kalmadı". Gönderimden
   hemen önce yeniden doğrulama (§4). Onay sonrası misafire giden mesaj "ev sahibi yazdı + `aiAssisted`" (K6).

Anahtar kapalıyken: kart yok, sorgu yok, e-postalar bugünkü gibi (parite testli).

## 2. Veri modeli — migration 59 (`DecisionRequest`, yeni tablo)

| Alan | Anlamı |
|---|---|
| `organizationId`, `conversationId` (FK, `Cascade`) | kiracı + konuşma; her sorgu `organizationId` ile |
| `messageId`, `itemId?`, `reservationId?` | isteği taşıyan misafir mesajı, aynı isteğin konuşma öğesi, rezervasyon (düz kimlikler) |
| `kind` | kapalı küme `early_checkin · late_checkout · extend_stay · date_change` |
| `requestedTime?`, `dayKey?` | "HH:MM" (tahmin yok), hedef takvim günü |
| `lang` | misafirin dili (karar metninin dili; tanınmayan → en) |
| `status`, `version` | durum makinesi (§3) + CAS sürümü |
| `decidedTime?`, `decidedById?`, `decidedAt?`, `resultMessageId?` | karar kaydı (onaylanan saat yapısal) |
| `notifiedAt?` | "Karar bekliyor" e-postasının atomik talebi (gidemezse geri alınır) |

- Tekillik `(conversationId, messageId, kind)`: aynı mesaj kaç kez işlenirse işlensin TEK kart, TEK e-posta.
- Metin YOK (misafir metni / adı / tutar saklanmaz). Konuşma ya da organizasyon silinince silinir.
- Faz 0 planından farklar (bilinçli): olgu fotoğrafı saklanmaz — kontrol listesi her açılışta CANLI kurulur, gönderimde
  yeniden kurulup parmak iziyle kıyaslanır (§4); `propertyId` konuşmadan okunur; `resolution` ayrı alan değil, durumdan.
- Konuşma birleştirme (`apply-conversation-dedupe`) kartları da tutucu konuşmaya taşır (DMMF envanteri güncel).

## 3. Durum makinesi

| Saklı durum | Anlamı | Çıkış |
|---|---|---|
| `pending` | karar bekliyor | `sending` (CAS), `superseded`, `dismissed`, `resolved_by_policy` |
| `sending` | ev sahibi gönderdi, kilitli | `approved` / `declined` (teslim), `send_unverified` (belirsiz), `pending` (kesin hata → yeniden açılır) |
| `approved` / `declined` | sonuçlandı (mesaj gitti) | — |
| `send_unverified` | teslim belirsiz — misafire ulaşmış OLABİLİR | `dismissed` ("kontrol ettim, kapat"; kör tekrar YOK) |
| `superseded` | aynı türden daha yeni istek (misafir saati değiştirdi) | — |
| `dismissed` | "Gerek kalmadı" (misafire bir şey gitmez) | — |
| `resolved_by_policy` | doğrulanmış otomatik onay gitti | — |

Görünen (türetilen, saklanmayan) durumlar — yalnız `pending` için: rezervasyon iptal → "Rezervasyon iptal"; hedef gün geçti →
"Süresi geçti"; talepten SONRA ev sahibi elle yazdı → "Yanıtladınız" (kart sönük, eylemler açık; karar kartıyla giden mesaj
bu türetmeye GİRMEZ). `sending` 5 dakikadan uzun sürdüyse (gönderim sırasında süreç düştü) → "Gönderim doğrulanamadı".

Her geçiş tek `updateMany WHERE status = <beklenen> AND version = <beklenen>`; 0 satır = başkası önce davrandı → 409.

## 4. Gönderimden hemen önce yeniden doğrulama (Faz 0 §4)

1. **Sürüm:** kart `pending` ve istemcinin sürümü güncel olmalı (çift tıklama / ikinci ev sahibi → 409, ikinci mesaj YOK).
2. **Rezervasyon iptal** → 409, gönderim yok. **Hedef gün geçti** → 409.
3. **Misafir talepten sonra yeniden yazdı** → 409 `guest_wrote_again` (kart uyarır, "Okudum, yine de gönder"). Sayfa
   açıldığında görünen sonraki mesaj okunmuş sayılır; sonradan gelen yeni mesaj yine durdurur.
4. **Olgular değişti** (`factsHash`): kart sayfayla AYNI kurucudan yeniden kurulur; kontrol listesi (temizlik, önceki /
   sonraki misafirin kararları, saatin geçmesi, çakışma…) değiştiyse 409 `facts_changed`, kart tazelenir, yazılan metin
   kaybolmaz.
5. **Kilit** `pending → sending` (CAS) → elle cevapla AYNI gönderim çekirdeği (`host-send.ts`; claim-then-send, idempotency
   anahtarı `decision:<id>:v<sürüm>`).
6. **Sonuç:** teslim → `approved` / `declined` + onaylanan saat + öğe "tamamlandı" + denetim kaydı (metin / tutar YOK); belirsiz
   → `send_unverified` (kartta kalır); kesin hata → kart yeniden açılır, yeni sürüm yanıtta (yeniden deneme önce "kart
   değişti" ile düşmez).

## 5. Kart (konuşma sayfası) — iki UX turunun sonucu

- Başlık "13:00 erken giriş" + durum rozeti; gün ("14 Ekim (varış günü)") + talebin anı; misafirin talebinden kısa alıntı
  (tek satır, 220 kod noktası).
- "Bu talebe henüz cevap verilmedi; karar sizin." / "Bu talepten sonra konuşmaya siz yazdınız…" / "Gönderim doğrulanamadı…".
- **Bakmanız gerekenler:** yalnız uyarı satırları; "Tüm kontrol listesi (N)" ile hepsi. Erken girişte kanıt modelinin satırları
  ("AI öner" paneliyle aynı kaynak) karar görünümüyle: otomatik onaya özgü satırlar ("kural kapalı", "otomatik
  gönderilemiyor") yok; varıştan önceki günlerde "varış bugün değil" ve açık temizlik BİLGİ (uyarı sayısını şişirmez).
- **Aynı gün devir:** önceki misafirin geç çıkış kararı erken giriş kartında ("Önceki misafirin geç çıkışı onaylandı: 12:00" —
  beklenen çıkış satırının hemen altında; bekleyen talep varsa "ikisini birlikte değerlendirin"), sonraki misafirin erken giriş
  kararı geç çıkış kartında ("İstenen çıkış (14:00), aynı gün gelen misafire onaylanan erken girişten (13:00) sonra."). Sağdaki
  devir kutusu da onaylı komşu saatini yazar (saate ek yazılmaz — eski "11:00'te" yanlıştı).
- **Onayla / Reddet düzenleyicisi:** 24 saatlik saat seçimi (15 dk; "(istenen)" işaretli; tarayıcının "01:00 PM" kutusu
  KALDIRILDI), mesajın dili (7), "Ücreti mesaja ekle" (kayıtlı kuraldan), metin düzenleme + "Metni yeniden oluştur", kod metni
  kurulamazsa "mesajı siz yazın". Standardın yanlış tarafındaki saat uyarılır.
- **Gerek kalmadı:** satır içi onay ("Kart kapatılsın mı? Misafire bir şey gönderilmez.").
- **Önceki kararlar:** son 3 sonuç tek satır ("14:00 geç çıkış — Reddedildi · 03 Eki 00:32").
- **Telefon:** başlık ve düğmeler alt alta, yatay kaydırma yok (390 px'te 390/390). **Destek görünümü** (bürünme): düğme yok.
- **Tek iş, tek sayı:** karta bağlı konuşma öğesi gelen kutusu "açık iş" rozetinde, panodaki "bırakılan istek" satırında ve
  "Açık işler" kartında İKİNCİ kez görünmez; karar mesajı yalnız kendi talebini kapatır (aynı turun iade isteği açık kalır).

UX turu 1 bulguları (düzeltildi): telefonda başlık 50 px'e sıkışıp düğmeler rozetin üstüne biniyordu; saat kutusu "01:00 PM"
gösteriyordu; kart misafirin ne istediğini göstermiyordu; aynı talep "Açık işler"de ikinci kez "Tamamlandı" düğmesiyle
duruyordu. UX turu 2 bulguları (düzeltildi): masaüstünde "13:00 (istenen)" kesiliyordu; komşu kararı listenin sonuna
düşüyordu; sağ kutu onaylı geç çıkışı göstermiyordu (kartla çelişki).

## 6. Güvenlik

- Yalnız sahip / yönetici (`withManage`); personel kartı görmez (K10); bürünmede yazma yok (K8 / K9; uç 403, kartta düğme yok).
- Her sorgu `organizationId` ile; başka kiracının kart kimliği 404 (sebep sınanır). Komşu kararları kiracı kapsamlı.
- Denetim kaydı (`decision.approved / declined / dismissed`) yalnız kimlik + tür (+ teslim belirsiz işareti); metin / tutar yok.
- Kota org kapsamlı (`decision:<org>:<konuşma>`, dakikada 20).
- E-posta konusu tek satır (gönderim çekirdeği), gövde misafir metni taşımaz.

## 7. Testler

`tests/unit/decisions-core.test.ts` (saf kurallar, 7 dil metni, saat seçenekleri, görünen durum) ·
`tests/integration/decision-store.test.ts` (tekillik, eski isteğin yerini alma, "ev sahibi yazdı" türetmesi, rozet / pano,
kiracı, yarıda kalan gönderim) · `decision-route.test.ts` (onay / ret / kapatma, çift tık, misafir yeniden yazdı, iptal, gün
geçti, belirsiz / kesin hata, olgu değişti, kiracı / personel / bürünme) · `decision-auto-reply.test.ts` (oto-yanıt → kart + tek
e-posta, K10 yerine geçme, kapalı anahtar paritesi) · `decision-card.test.ts` (komşu kararları, karar görünümü satırları,
alıntı, sonuç satırları, öğelerle birlikte yaşam, pano tekilliği).

## 8. Bilerek yapılmayanlar (sonraki faz / kurucu kararı)

- QR misafir sohbeti (v1 yalnız kanal konuşmaları).
- Uzatma / tarih değişikliği için kod metni (kanalda rezervasyon değişikliği gerekir; kart "yanıtı siz yazın" der).
- "Ben ilgileneceğim" (devralma, Faz 0 K7) ve karşı teklif metni (farklı saat onayı bugün "onaylandı: 14:00" der — Sabah
  Kararları 62 c).
- Yapay zekâ isteminin devir satırı onaylı komşu saatini henüz bilmiyor (istem misafire gideni etkiler → Sabah Kararları 62 e).
- WhatsApp / ses / sohbetle karar (Host Copilot sonraki fazlar).

## 9. Açma sırası

1. ✅ Migration 59 itildi (10-03, kurucu: "pushu yaptır"; CI #1292 yeşil). Railway kapalı → tablo canlıya Railway açılınca gelir:
   açmadan ÖNCE taze `pg_dump` (yeni tablo, dolu tabloya dokunmaz). Anahtar KAPALI kalır.
2. Misafir metinleri onayı (Sabah Kararları 62 b) → kurucu org'da `HOST_DECISIONS_ENABLED=1`; ilk kararlar ve ilk "Karar bekliyor"
   e-postaları birlikte (K5).
3. Küçük pilot, sonra genel.

## 10. Üç inceleme ajanının bulguları ve düzeltmeleri (10-03 → 10-07; hepsi kırmızı-önce, eski kodda kırmızı doğrulandı)

**Eşzamanlılık / gönderim (rota):**
- Gönderim sırasında hata (kanal kabul etti, kayıt düştü olabilir), "aynı metin az önce gitti" (`duplicate`) ve kuyruk kimliği çatışması
  kartı yeniden AÇMIYOR → "gönderim doğrulanamadı" (eskiden yeniden açılıyordu: 2 dk sonra ikinci mesaj gidebilirdi). Yalnız hiçbir
  şeyin gitmediği kesin hata (bağlı değil, kalkan okunamadı, kanal kesin reddetti) kartı yeniden açar ve saati geri alır.
- Kilit (`pending → sending`) onayın saatini ve karar vereni HEMEN yazar: gönderim sürerken komşu konaklamanın kartı ve erken giriş
  kontrolü onaylı geç çıkışı görür (ret saat taşımaz).
- Gün CANLI (`liveDecisionDayKey`): rezervasyon değişirse kart, süre kontrolü ve metin rezervasyonun bugünkü gününü kullanır.
- Talebin mesajı bulunamazsa "misafir yeniden yazdı" kontrolü atlanmıyor (çapa kartın açıldığı an).
- Standardın yanlış tarafındaki onay saati sunucuda 400 (arayüz de göndermez). Ev sahibi metni değiştirdiyse mesaj "yapay zekâ destekli"
  sayılmaz.

**Depo / türetme:** ev sahibi cevabı öğelerle aynı tavansız sorguyla (500 satır tavanı başka konuşmaların mesajlarıyla bir cevabı
gizleyebiliyordu) · gönderimi doğrulanamayan / yarıda kalan kart iptal ve gün geçince açık iş sayılmaz · pano en yeni kartları okur ·
gönderimi süren onay komşu kartta sayılır ve gönderilirken kart eylemsiz görünür (kaybolmaz).

**Tur / bildirim / otomatik onay:**
- Misafir aynı talebe yeni mesaj eklerse ("?") yeni kart açılmaz (eskiden yeni kart + İKİNCİ e-posta); saat değişirse (13:00 → 12:00)
  yeni kart eskisinin yerine geçer ve bildirim damgasını devralır (tekrar e-posta yok). Günü geçmiş talep için kart açılmaz.
- Deterministik saat yedeği yalnız tek saatli tür, hiç model okuması yok ve mesaj karşı yuvayı anmıyorken; saati son mesaj yazdıysa o.
- Bildirim kilidi turun son mesajı (K10 ile aynı); hassas öğe e-postası turun herhangi bir mesajına gittiyse e-posta yok ama kartlar
  damgalanır. Kapatılmış / sonuçlanmış kart "Misafir cevabınızı bekliyor" bildirimini yutmaz.
- 🚨 Doğrulanmış OTOMATİK erken giriş onayı ev sahibinin kararını ezmez: kartta karar verildiyse / veriliyorsa (reddedildi, kapatıldı,
  gönderiliyor, doğrulanamadı) otomatik onay gitmez; bekleyen kart göndermeden önce sahiplenilir (kesin hatada geri, belirsizde
  doğrulanamadı). Örnek: ev sahibi 13:00'ü reddetti → temizlik bitince yeniden değerlendirme "onaylandı" göndermez.

**Panel / metin:** düzenleyici açılınca son misafir mesajı + kontrol listesi izi sabitlenir; sayfa arka planda değişirse "Okudum"
denmeden gönderilmez · düzenlenmiş metinde seçilen saat yoksa uyarı · "Hazır metne dön" onaylı · not kutusu ("çevrilmez") · geç çıkış ücret
ipucu · "Kartı kapat / Evet, kapat" · erişilebilirlik (odak, `aria-controls`, ekran okuyucu ön ekleri) · başlık "(saat belli değil)" ·
"14:00 olarak onaylandı" · aynı saat "çakışıyor" · karar görünümünde "Varıştan önceki gece" ve "istenen saatte daire henüz boşalmamış
olabilir" · e-posta (mülk önce, gün etiketi, türe göre paragraf, "Konuşmayı açın") · pano ve gelen kutusunda "Gönderim doğrulanamadı".

**Misafir metinleri (anahtar kapalı; Sabah Kararları 62 b):** "giriş saatimiz" → "giriş saati" (biz varsayılmaz) · EN "Unfortunately, early
check-in…", "you can check out by 13:00 on…" · DE "bis 13:00 Uhr auschecken" · FR bölünmez boşluk + "1er" + "libérer le logement jusqu'à" ·
ES "la entrada / hasta las" · RU "выезд — до". Arapça terim ve para birimi biçimi canlı erken giriş metniyle ortak → değiştirilmedi
(Sabah Kararları 62 f).

**Kanıt (10-07):** mutasyon 35 mutant → 32 öldü; yaşayan 3'ün 2'sine pin (yerine geçilmiş kart turun kartı sayılmaz; iki saatli turda
deterministik saat yazılmaz) → öldü; 1'i gerekçeli EŞDEĞER (otomatik onay talebindeki erken çıkış — CAS aynı korumayı veriyor). Son ekran turu
(masaüstü 1440 + telefon 390): kart, onay düzenleyicisi, "misafir yeniden yazdı → Okudum", kanal bağlı değil hatası, ret, kapatma onayı,
doğrulanamayan kart, gelen kutusu rozetleri; telefonda yatay kaydırma yok (390/390).
