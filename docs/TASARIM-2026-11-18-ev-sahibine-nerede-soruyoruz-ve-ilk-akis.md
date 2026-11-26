# Tasarım (ÖNERİ) 2026-11-18 — Ev sahibine bugün nerede, neden soruyoruz; "işi Lixus takip etsin" için ilk uçtan uca akış

> **KOD YOK, karar değil.** Kurucu isteği (11-18, AYNEN `docs/KURUCU-TALIMATI-2026-11-18-codex-raporu-ve-orkestrasyon.md` son bölüm):
> "İlk rapor, hosta bugün nerede ve neden soru sorduğumuzu çıkarıyor. Bunu güncel kodla karşılaştırıp her adımı ayıralım: gerçekten host
> kararı mı, eksik bilgi mi, teknik engel mi, kanal yeteneği mi? Ürün yönüm şu: panel kalsın ama işi Lixus takip etsin. Rutin temizlik
> teklif ve onaya dönmesin; host yalnız gerçek istisnada devreye girsin. Mesaj gönderildi diye iş kapanmasın. İlk uçtan uca akışta neyi
> mevcut altyapıyla yapabileceğimizi, neyin gerçekten yeni geliştirme istediğini görmek istiyorum."
> Yöntem: araştırma ajanı (yalnız okuma) Codex'in sekiz akışını bugünkü kodda izledi; ana oturum taşıyıcı iddiaları kodda yeniden
> doğruladı (§12). Codex eski bir kopyaya bakmıştı; aşağıdaki dosya adları bugünkü ağaca göredir (satır numarası yazılmadı — kayar).
> Açılış kipi = `docs/RAILWAY-ACILIS-2026-10-15.md`. Kurucu kararı gerektiren her şey §11'de H-numaralı ve önce / sonra örneklidir.

## 0. Kısa cevap

1. **Codex'in sekiz akışı bugünkü kodda doğru**, iki düzeltmeyle: "kuyruk açıkken erken girişte otomatik onay yok" doğru ama kuyruk
   açılışta kapalı (bugün etkisi yok); "gitmemiş ev sahibi cevabı açık işi kapatıyor" bu turda kısmen kapandı (kesin gitmeyen sayılmıyor).
2. **Codex'in anlattığı akışların yarısı açılışta KAPALI** (karar kartı, WhatsApp sorusu, bilgi tabanına kaydet, doğrulanmış uzatma).
   Açılışta ev sahibinin gördüğü gerçek yüzey: "Misafir cevabınızı bekliyor" e-postası + konuşma ekranında taslak + "Onayla ve gönder".
3. **Ev sahibine düşen adımların çoğu gerçek ev sahibi kararı değil.** Para / iade / şikâyet / acil / "bir insanla görüşmek istiyorum"
   gerçekten ev sahibinde. Eksik bilgi bir kez sorulup kaydedilebilir ama bugün iki kez yazdırıyor. Erken girişin "gelecek gün" sorusu,
   kanıtsız temizlik ve ikinci onay bizim borcumuz. Uzatma / tarih değişikliği kanalın yeteneği (köprüden yapılamıyor).
4. **"İşi Lixus takip etsin" için eksik olan üç şey** (§6): her açık işin bir SAHİBİ (Lixus mu bekliyor, ev sahibi mi) · Lixus beklerken
   tuttuğu bir SAAT (ne zaman yeniden bakacak, ne zaman istisnaya çevirecek) · işin KANITLA kapanması (yazıldı ≠ gitti ≠ yapıldı).
   Üçünün de parçaları kodda var; birleştiren yapı yok.
5. **İlk uçtan uca akış önerim: devir günü** (temizlik → hazır → erken giriş cevabı → giriş mesajı). En çok hazır parça onda; kurucunun
   temizlik cümlesini doğrudan karşılıyor. Dört dilim (§7): ilki misafire giden hiçbir şeyi değiştirmeden ve migration'sız yapılabilir.
6. **Bir gerilim var:** "mesaj gönderildi diye iş kapanmasın" ile 09-26 kararı "ev sahibi yazdı = kapandı, tıklama gerekmez" çelişiyor
   (H-1). Kodda bir şey değiştirmeden önce bu sorunun cevabı gerekli.

## 1. Açılışta ilgili anahtarlar (belgeden + koddan)

| Anahtar | Açılışta | Ne açar |
|---|---|---|
| `AUTO_REPLY_ENABLED` | AÇIK | genel otomatik cevap (işletme düğmesi `autoReplyHospitable` ayrıca; şema varsayılanı kapalı) |
| `AI_CONVERSATION_ITEMS_ENABLED` | AÇIK | öğe bazlı risk + açık iş defteri |
| `AI_HOST_DECISION_HOLD_ENABLED` | AÇIK | karar ev sahibindeyse misafire ara cümle gitmez → tek e-posta |
| `QR_ESCALATION_EMAIL_ENABLED` | AÇIK | QR'da ev sahibine kalan her mesajda e-posta |
| `HOST_COMMITMENT_AUTO_ENABLED` | AÇIK | ev sahibinin sözü → görev |
| `HOST_DECISIONS_ENABLED` | KAPALI | karar kartı (erken giriş / geç çıkış / uzatma / tarih) |
| `HOST_CHANNEL_*` (soru, karar, uyarı, bilgi tabanına kaydet) | KAPALI | WhatsApp ev sahibi döngüsü (Meta kurulumu bekliyor) |
| `AI_VERIFIED_AVAILABILITY_ENABLED` / `AI_VERIFIED_EXTENSION_ENABLED` | KAPALI | kod metniyle müsaitlik / uzatma cevabı |
| `DURABLE_OUTBOX_ENABLED` | KAPALI | kalıcı kuyruk |
| `STAFF_NOTIFY_ENABLED` / `TEAM_CONTACTS_ENABLED` | KAPALI | temizlikçiye bildirim / hesapsız ekip kişisi |
| Erken giriş kuralı | ANAHTARSIZ | daire başına kapalı / taslak / otomatik; kural yoksa kapalı |

## 2. Codex'in sekiz akışı — bugünkü kodla karşılaştırma

| # | Codex ne dedi | Bugünkü kod | Hüküm |
|---|---|---|---|
| 1 Erken giriş | Kural kapalı / taslak / otomatik; kanıt uygunsa her talepte onay gerekmez; eksik hazırlık / çakışma / belirsiz saat → ev sahibi; kuyruk açıkken otomatik onay engelli | `early-checkin/core.ts` (otomatik gönderim: onaylanabilir + kural otomatik + iki model aynı saat + tek konu + engel yok), `workflow.ts` (kuyruk engeli), `automation.ts` çağrısı | **Doğru.** Eksik söylenen: (a) varış günü değilse istek bekler ama **yeniden değerlendirilmez** (`recheck.ts`: "gelecek varış günü ayrı akış, henüz yok"); yeniden değerlendirme yalnız temizlik bitince ve yalnız varış günü; (b) kuyruk engeli açılışta etkisiz |
| 2 Geç çıkış | Karar ev sahibinde; komşu rezervasyon kontrolü; ücret elle; WhatsApp yalnız saat belli + ücretsizken | `decisions/core.ts`, `decisions/card.ts`, `decision-panel.tsx`, `host-channel/decision-answer.ts` | **Doğru.** Ek: geç çıkış için daire kuralı YOK; yalnız işletme düzeyinde serbest metin. Açılışta kart kapalı → istek tutulur + e-posta |
| 3 Uzatma / tarih | Panel "kanaldan yapın, sonra kartı kapatın"; doğrulanmış uzatma Airbnb talebine yönlendirir | `decision-panel.tsx`, `ai/verified-extension.ts` ("ev sahibi kaynaklı teklif köprüden yapılamıyor") | **Doğru.** İkisi de açılışta kapalı; kanal sözleşmesinde rezervasyon yazma yeteneği yok |
| 4 Eksik bilgi | WhatsApp sorusu → ev sahibi yazar → ayrıca [Gönder] | `host-channel/routing.ts`, `answer.ts` | **Doğru, açılışta KAPALI.** Açılıştaki karşılığı: e-posta + panelde elle yazma |
| 5 Yeniden sormama | Ayrı, kapalı onay zinciri; Wi-Fi / giriş bilgisi alınmaz | `host-channel/kb-save.ts` | **Doğru, KAPALI.** Açılıştaki karşılığı: öneri panelindeki "Bilgi tabanına ekle" bağlantısı formu başlıkla açar, içeriği ev sahibi **yeniden yazar** |
| 6 Normal taslak | Düşük güven otomatiği durdurur; "Taslağı kullan / Onayla ve gönder" | `automation.ts` (eşik 0,75; işletme düğmesi + saat penceresi) | **Doğru.** Kapının ~30 tutma gerekçesi var; düşük güven yalnız biri |
| 7 İade / ödeme / şikâyet / insan / acil | Hassas; bilgi sorusuna alınmaz | `conversation-items/core.ts` (+ evcil hayvan da hassas), `routing.ts` | **Doğru.** Ek: tehlikede misafire hiçbir metin gitmez (kurucu 10-11) |
| 8 Sonuçlandırma | Sonraki serbest ev sahibi mesajı ihtiyacı kapatır; konuşma kontrolü yalnız gölge | `conversation-items/core.ts` (`host_replied` türetmesi), `store.ts` (kapsam dışı cevaplar), `conversation-control/shadow.ts` | **Doğru**, bir düzeltmeyle: kesin gitmemiş cevap artık kapatmıyor (bu tur, `outbox/undelivered.ts`). Doğrulanamayan ve yalnız yerelde kaydedilen cevap hâlâ kapatıyor (soru S-1, S-2) |

## 3. Codex'in listesinde olmayan, ev sahibine iş çıkaran yerler

| Yer | Ev sahibi ne yapıyor | Açılışta |
|---|---|---|
| Temizlik ataması (`tasks/default-cleaner.ts`) | daire başına bir kez seçer; kişi değişince Girişler'de yeniden atar (yedek ön seçili) | atama çalışır; kişiye haber gitmez (`STAFF_NOTIFY` kapalı) |
| Temizlikçi gelemezse | başka kişiyi kendisi bulur, atar | tamamen ev sahibinde (T4 / T5 yalnız tasarım) |
| "Temizlik bitti" kanıtı (`early-checkin/readiness.ts`: kimlikli kullanıcının kaydı gerekir) | görevi kendisi "bitti" yapar ya da hiç yapmaz → erken giriş "hazır mı bilinmiyor" | ev sahibinde (ekip kişisi kodu kapalı, WhatsApp düğmeleri yazılmadı) |
| Ev sahibinin sözünden görev | belirsiz söz (gün yok / iki saat) kart olarak sorulur | açık |
| Giriş mesajı | "kontrol bekliyor" işareti yalnız Girişler'de GÖSTERİLİR; gönderici o işarete bakmaz | otomatik gönderim `autoCheckin` düğmesine bağlı (varsayılan kapalı) |
| Bilgi tabanı onayı | önerileri tek tek onaylar | açık |
| Doğrulanamayan gönderim | konuşmayı kanaldan kontrol eder | açık (doğrudan yolda not) |
| Bağlantı koptu | yeniden bağlanır | açık |
| Konuşma "Sorunlu" | yapay zekâ kalıcı durur; elle açar | açık |

## 4. Adım adım: gerçek karar mı, eksik bilgi mi, teknik engel mi, kanal yeteneği mi

Sınıflar: **K** gerçek ev sahibi kararı · **B** eksik bilgi · **T** bizim teknik borcumuz · **Kn** kanal yeteneği · **P** ürün politikası (kurucu kararı).

| Adım | Sınıf | Açılışta ne oluyor | Ev sahibinin işi | Azaltılabilir mi · ön şart | Yanlış otomatikleşirse |
|---|---|---|---|---|---|
| Erken giriş kuralını ilk kez kurmak (saat, ücret, kip) | K (bir kez) | daire sayfası formu | 1 form / daire | tek seferlik kalır | yanlış ücret / saat söz olur |
| Erken giriş, varış günü, kanıt tam, kural otomatik | — | kendiliğinden gider | 0 | — | önceki misafir içerideyken onay (bugün çıkış saati + "bitti" kaydı engelliyor) |
| Erken giriş **varış gününden önce** soruldu | **T** | bekler, yeniden denenmez → ev sahibinde kalır | e-posta + elle cevap | **evet:** varış günü yeniden aday yapan tarama (var olan `recheck.ts` kalıbı). Ön şart H-3 | erken söz → temizlik yetişmez |
| Erken giriş, "temizlik bitti" kaydı yok | **T** (+B) | "hazır mı bilinmiyor" → ev sahibi | görevi bitirir ya da cevap yazar | **evet:** temizlikçinin kendi [Bitti]'si (T3 + T5). Kimlikli kanıt kuralı korunur | sahte "hazır" → kapıda bekleyen misafir |
| Erken giriş: iki model saati farklı okudu / çok konulu mesaj | T (güvenlik payı) | taslak | 1 dokunuş | kısmen (tarih okumasını koda alan anahtar ölçülürse) | yanlış saat onayı |
| Erken giriş ücretinin tahsili | Kn + P | misafir kanaldan öder | kanalda ek ücret talebi | hayır | platform dışı ödeme ihlali |
| Geç çıkış kararı | K bugün / T (kural yok) | tutulur + e-posta | e-posta + elle cevap | **evet, erken girişin aynası:** daire kuralı + "ertesi gün giriş yok" + temizlik penceresi. Ön şart H-4 | sonraki girişle çakışma |
| Uzatma: müsaitlik cevabı | T | ev sahibi | e-posta + cevap | kod hazır, ölçüm yok | yanlış "müsait" |
| Uzatma / tarih: rezervasyonu değiştirmek | **Kn** | ev sahibi kanalda kabul eder | kanal uygulaması | köprüde hayır; doğrudan kanal bağlantısında planlı | — |
| Eksik bilgi: ilk soru | B | e-posta; panelde yazar | e-posta + yazma + gönder | WhatsApp ile tek dokunuşa iner (kapalı) | — |
| Ev sahibinin bilgisinden kurulan cevaba **ikinci onay** | P ("ilk dilim yalnız onaylı") + T | (WhatsApp kapalı) | 1 ek | koşullu: değer ev sahibinin cümlesinde birebir + soru tam karşılanıyor + hassas değil. Ön şart H-5 | ev sahibinin kastetmediği metin gider |
| Aynı bilgiyi kalıcı yapmak | B + P | form yeniden yazdırılıyor | 1 form | **evet:** ev sahibinin GÖNDERDİĞİ cevaptan öneri (WhatsApp yolunda var, panelde yok). H-7 | konaklamaya özel bilgi kalıcılaşır |
| Düşük güven | T | taslak | 1 | toplu yetkiyle DEĞİL; dayanak / anlama işiyle | uydurma cevap |
| İşletme düğmesi kapalı / saat dışı | P (ev sahibinin ayarı) | taslak | 1 | ilk kurulumda sorulur | — |
| İade / iptal / ödeme | K + P | ev sahibi | e-posta + cevap | şimdilik hayır (H-6 yalnız sayım) | para sözü |
| Şikâyet | K + P | ev sahibi | e-posta + cevap | hayır | ev sahibini haksız duruma düşürür |
| Acil / tehlike | K + P | acil e-posta | panel | yalnız bildirim kanalı hızlanır | can güvenliği |
| "Bir insanla görüşmek istiyorum" | K | ev sahibi | cevap | hayır | — |
| İşi kapatmak | P (09-26) | sonraki serbest mesaj kapatır | 0 (ama yanlış kapanabilir) | H-1 | açık iş kaybolur |
| Doğrulanamayan gönderim | Kn + P | ev sahibi kontrol eder | kanala bakar | kimlikli gönderim veren kanalda | çift mesaj |
| Temizlikçi gelemiyor | **T** | ev sahibinde | bul + ata | **evet**, tasarım hazır (T4 / T5; İ1 onayı bekliyor) | kimse gelmez, fark edilmez |
| Kimse gelemiyor | K (gerçek istisna) | — | arar | hayır — doğru istisna | — |
| Giriş mesajı "kontrol bekliyor" | T + P | gönderici işarete bakmaz | — | daire gerçekleri tasarımı (AT-1) | yanlış kapı kodu |
| Bağlantı koptu | Kn + K | uyarı | yeniden bağlar | hayır | — |

Kaba sayım (sınıflar örtüşüyor; ilk yazılan sınıfa göre): 24 adımın 7'si gerçek karar ya da doğru istisna · 4'ü kanal · 3'ü kurucu
politikası · 2'si eksik bilgi · 1'i zaten otomatik · **7'si doğrudan bizim borcumuz** (ikinci sınıf olarak borç taşıyan iki adımla 9).
Borçların dördü devir günü akışında: gelecek gün sorusu, "bitti" kanıtı, temizlikçi gelemiyor, giriş mesajı işareti.

## 5. "Mesaj gönderildi ≠ iş bitti": dört kanıt

| Kanıt | Kodda | Not |
|---|---|---|
| ① Cevap yazıldı | VAR | mesaj satırı + karar kaydı |
| ② Kanal kabul etti | VAR | sağlayıcı mesaj kimliği; kuyrukta "gönderildi". **Bu turda** her cevap yolunun sonucu tek sözlüğe bağlandı (`lib/delivery-outcome.ts`: yalnız kayıt · QR'da görünür · sıraya alındı · kanal kabul etti · doğrulanamadı · gitmedi) — ekran artık "gönderildi"yi yalnız kanal kabul ettiyse söylüyor |
| ③ Teslim doğrulandı | **YOK (kanal)** | köprünün sözleşmesinde mesaj eşleştirme "yok". Ev sahibine giden WhatsApp'ta iletildi / okundu var; misafir tarafında yok |
| ④ İş fiziksel tamamlandı | KISMEN | yalnız temizlik görevi ("başladım → bitti", kimlikli kullanıcı) ve söz görevleri; hesapsız kişi ve WhatsApp [Bitti] yok |
| İşin tek kayıtta durumu (talep → karar → mesaj → fiziksel) | **YOK** | en yakın yapı karar kartının durum makinesi (kapalı); öğe defteri yalnız ①'den türetiyor |

Yani bugün "iş bitti" diyebildiğimiz tek yer temizlik görevidir. Misafire söylenen her söz (havlu, arıza, erken giriş) ①–② ile kapanıyor.

## 6. "İşi Lixus takip etsin" — önerilen yapı

Üç kural; üçünün de parçası kodda var, birleştiren yapı yok.

1. **Her açık işin bir sahibi vardır.** Ya Lixus bekliyor (neyi beklediği yazılı: "temizlik bitsin", "varış günü gelsin", "temizlikçi cevap
   versin") ya da iş ev sahibinde (nedeni yazılı: karar · eksik bilgi · istisna). Bugün öğe defterinde yalnız "açık / ev sahibinde" var;
   "Lixus bekliyor" durumu yalnız erken girişin karar kaydında, dar bir biçimde duruyor.
2. **Lixus beklerken saati kendisi tutar.** Her bekleyişin bir "yeniden bak" ve bir "en geç" anı olur; "en geç" geçince iş sessizce
   kaybolmaz, ev sahibine İSTİSNA olarak düşer (tek cümle + tek eylem). Altyapı var: iki dakikalık zamanlanmış geçiş, `recheck.ts`
   kalıbı, geçiş tabanlı alarm. Eksik: işe bağlı genel bir "sıradaki kontrol" kaydı.
3. **İş kanıtla ilerler, türüne göre kanıtla kapanır.** Bilgi sorusu ② ile (kanal kabul etti) kapanır. Fiziksel iş gerektiren istek
   (havlu, arıza, temizlik, erken giriş) ② ile "cevaplandı", ancak ④ ile "tamamlandı" olur. Karar (erken giriş / geç çıkış) ② + bağlı
   fiziksel iş varsa ④.

**Sıra önerisi (yeni tablo ile başlamıyoruz):** önce var olan kayıtlardan TÜRETİLEN bir takip görünümü (saf fonksiyon: görev + rezervasyon
+ konuşma öğesi + mesaj sonucu → "hangi adımda, kim bekliyor, sıradaki kontrol ne zaman"). İki akış bunu kullanmaya başlayınca ortak alan
kalıcı kayda taşınır (migration adayı: öğede `waitingOn` + `nextCheckAt`, ikisi de boş bırakılabilir sütun — dolu tabloya güvenli). Sebep:
bugün zaten üç defter var (öğe, görev, karar kartı); anlamı oturmadan dördüncüsünü açmak aynı gerçeği dört yerde tutmak olur.

Bu yapı kurucunun 11-13 yönleriyle aynı çizgide: "yerinde devir" (ayar sayfası değil), "Bugün" ekranı, değer satırı. Yeni bir ajan
altyapısı ÖNERMİYORUM; Codex'in hükmü de bu ("yeni ajan altyapısından önce erken girişteki 'bir kez yetki + her işlemde güncel kanıt'
modelini genişlet").

## 7. İlk uçtan uca akış önerisi — devir günü

Örnek: Lale 5. Önceki misafir 11:00'de çıkıyor, yeni misafir 15:00'te girecek. Yeni misafir dün akşam "Yarın 13:00'te girebilir miyiz?"
yazdı. Dairenin erken giriş kuralı otomatik, en erken 13:00, ücret ₺500.

**Hedef (ev sahibinin işi 0):** temizlik kendiliğinden dairenin kişisine atanır → kişi akşamdan haberdar olur, itirazı yoksa geliyor sayılır →
"Başladım" / "Bitti" kendi telefonundan gelir → "bitti" oturunca bekleyen erken giriş isteği yeniden değerlendirilir ve onay gider →
giriş mesajı saatinde gider → Panel'de tek satır: yapılanlar + varsa takılan adım. Ev sahibine yalnız şu istisnalar düşer: kimse gelemiyor ·
önceki misafir çıkmadı / çıkış saati bilinmiyor · çakışma · temizlik "en geç" saatine kadar başlamadı.

| Parça | Mevcut altyapı | Gerçekten yeni geliştirme | Kurucu kararı | Kanal yüzünden yok |
|---|---|---|---|---|
| Temizliği dairenin kişisine atamak | ✅ `default-cleaner.ts` (kabul adımı yok — 11-06 "doğrudan görevlendirme") | — | — | — |
| Kişiye haber + yalnız [Gelemem] + yedeğe geçiş | yedek kişi kaydı ✅ (T2) | haber + itiraz motoru (T4), WhatsApp düğmeleri (T5) | İ1 (sessizlik = geliyor), Meta ikinci numara | — |
| "Başladım / Bitti" kanıtı | ✅ görev durumu (hesaplı kullanıcı) · ekip kişisi kodu (T3) kapalı | düğme işleme (T5); telefonsuz kişi için ev sahibine tek soru (T6) | `TEAM_CONTACTS_ENABLED` açılışı | — |
| Erken giriş kararı + kod metni | ✅ `early-checkin/*` (anahtarsız), temizlik bitince yeniden değerlendirme ✅ | **önceki gün sorulan istek için yeniden değerlendirme** (aynı kalıp genişler) | H-3 (arada misafire ne gider) | — |
| Ücret | ✅ kayıtlı kural, kod metni | — | — | tahsil kanalda |
| Giriş mesajı | ✅ `autoCheckin`, Girişler'de tek dokunuş | "kontrol bekliyor"da göndericiyi tutma | AT-1 | — |
| İşin takibi ve kapanışı | ✅ parçalar (görev, karar kaydı, teslim sonucu, Girişler, "Bugün" ilk dilimi) | **devir gününün tek takip satırı** (§6'daki türetilmiş görünüm) + "en geç" saatleri | H-1, H-2 | ③ yok |

**Dilimler (her biri ayrı onay / ayrı yayın):**

| Dilim | Ne | Misafire giden değişir mi | Migration | Dış bağımlılık | Ön şart |
|---|---|---|---|---|---|
| A0 | Devir günü takip satırı: var olan kayıtlardan türetilir, Girişler / "Bugün"de gösterilir; hiçbir şeyi göndermez, hiçbir işi kapatmaz | hayır | hayır | yok | H-2 (ev sahibine görünen yeni satır metinleri onayı) |
| A1 | Önceki gün sorulan erken giriş: varış günü yeniden değerlendirme | **evet** (ertesi gün onay gider) | hayır | yok | H-3 |
| A2 | Lixus'un saati: temizlik "en geç" saatine kadar başlamadı / bitmedi → ev sahibine tek istisna | hayır | hayır (alarm durumu var) | yok | bildirim metni onayı |
| A3 | Temizlikçiye haber + [Gelemem] + [Başladım] / [Bitti] | hayır (temizlikçiye gider) | evet (T4, onaylı) | Meta ikinci numara | İ1 + şablon onayı |

A0 → A1 → A2 mevcut altyapıyla yapılabilir; A3 dış bağımlılık bekler. A0 tek başına bile kurucunun iki cümlesini görünür kılar: "işi
Lixus takip etsin" (takılan adım tek yerde) ve "mesaj gönderildi diye iş kapanmasın" (erken giriş cevabı gitti ama temizlik bitmediyse
satır açık kalır).

## 8. Öteki adaylar (kısa)

- **B — Eksik bilgi: "bir kez sor, kaydet, bir daha sorma".** Misafire dokunmayan tek parçası panelden gönderilen cevaptan bilgi tabanı
  önerisidir (H-7; çekirdek var, yüzey yok). Kalanı WhatsApp kurulumunu ve H-5 kararını bekler. A ile paralel gidebilir.
- **C — Geç çıkış kuralı (erken girişin aynası).** Kontroller var (komşu rezervasyon, devir, temizlik penceresi), kod metni var; eksik
  olan daire kuralı ve otomatik dal. Misafire yeni otomatik söz demek → H-4. A'dan küçük, A'nın kalıbını kullanır.

| | A devir günü | B eksik bilgi | C geç çıkış |
|---|---|---|---|
| Hazır parça oranı (kaba) | yüksek | yüksek | orta |
| Misafire giden değişir mi | yalnız A1 | H-5 açılırsa | evet |
| Migration | yalnız A3 | yok | yok |
| Dış bağımlılık | yalnız A3 | WhatsApp için | yok |
| "Rutin temizlik teklif / onaya dönmesin" | doğrudan karşılar | — | — |

## 9. Yapma listesi (cazip ama kararlarla / güvenlik mimarisiyle çelişir)

1. Güven yüzdesiyle toplu otomatik yetki vermek (eşik bir güvenlik ölçüsüdür; Codex de aynı şeyi söylüyor).
2. Bekleme süresini "soruyorum / kaydettim" cümlesiyle doldurmak (K10: devir / bildirim cümlesi misafire gitmez).
3. Rezervasyonu köprü üzerinden değiştirmeye çalışmak (yetenek yok; köprüye özgü yeni özellik yapılmaz).
4. Temizlikçiden her gün "geliyor musun?" onayı istemek (kurucu: "teklif ve onaya dönmesin"; İ1: sessizlik = geliyor).
5. Ev sahibinin serbest metnini ONAYSIZ kalıcı bilgiye / söze çevirmek (Codex: alıntılanan misafir sözü ev sahibi sözü sayılıyor).
6. Doğrulanamayan gönderimi metin benzerliğiyle "teslim edildi" saymak (kod bilinçli olarak reddediyor).
7. Tehlike / şikâyet / para sınıfını "rutin" alt türlere bölüp otomatiğe açmak (ancak ayrı kurucu kararıyla; H-6 yalnız sayım).
8. Kuyruk açıkken erken giriş otomatiğini, gönderim anında yeniden doğrulama yazılmadan açmak.
9. Ayrı bir "ajan altyapısı" açmak; bu yön anlamsal karar mimarisinin gölge hattıyla birleşir (`TASARIM-2026-11-12-…`).
10. Özerkliği ayar sayfası / matrisle açtırmak (kurucu 11-13: yön "yerinde devir").

## 10. Çelişkiler ve dikkat notları

- **"Mesaj gönderildi diye iş kapanmasın" ↔ 09-26 "ev sahibi yazdı = kapandı, tıklama gerekmez".** Konuşma kontrolü tasarımı bunu yalnız
  OLAY için çözüyor; genel öğeler için karar yok → H-1.
- **"İşi Lixus takip etsin" ↔ "Sorunlu konuşmada yapay zekâ kalıcı durur".** "Elle Sorunlu = yalnız işaret" kararı (K-2) onaylı ama kodda
  değil; bugün sorunlu konuşmada iş ev sahibine geri düşüyor.
- **Codex "ikinci onayı işletme yetkisiyle kaldır" ↔ "ilk dilim yalnız onaylı".** Karar değişmedikçe kaldırılmaz (H-5).
- **Temizlikçi tasarımındaki "teklif motoru" adı** kurucunun cümlesiyle karışmasın: rutin işte teklif / kabul YOK; yalnız haber + itiraz
  hakkı. Teklif yalnız kalıcı kişi gelemediğinde yedeğe gider.
- **Ölçülmeyenler:** erken giriş sorularının ne kadarının varış gününden önce geldiği, kapının hangi gerekçeyle kaç mesaj tuttuğu canlı
  veriyle ÖLÇÜLMEDİ (canlı kapalı). Sıralama bu yüzden kod incelemesine dayanıyor; canlı açılınca ilk iş bu sayım olmalı.

## 11. Kurucuya sorular (önce / sonra; misafire giden örnekler bizim ağzımızdan)

**H-1 — "Yazdım" ile "çözdüm" ayrılsın mı?** Bugün (09-26 kararınız): öğeden sonra panelden herhangi bir mesaj yazınca öğe kapanır.
Önerim: bilgi sorusu yine cevapla kapansın; fiziksel iş gerektiren istek (havlu, arıza, temizlik) "cevaplandı · iş açık" olsun ve görev
bitince kapansın; serbest mesajınız yalnız ilgili isteği kapatsın.
- Önce: misafir "Havlu biter mi? Bir de klima soğutmuyor." → siz "Havluyu getiriyoruz." yazdınız → iki istek de kapanır, klima kaybolur.
- Sonra: havlu "cevaplandı · görev açık", klima açık kalır; Panel "Klima — cevap bekliyor" der.

**H-2 — Devir günü tek takip satırı (A0).** Önerim: atandı · başladı · bitti · erken giriş cevabı · giriş mesajı tek satırda; yalnız
takılan adım öne çıkar. Hiçbir şeyi göndermez, hiçbir işi kapatmaz.
- Önce: bilgiler Girişler, Görevler, Mesajlar'a dağılmış; erken giriş cevabı gidince iş bitmiş görünür.
- Sonra: "Lale 5 · 13:00 erken giriş onaylandı · temizlik 11:20 başladı, 12:35 bitti · giriş mesajı 14:00'te gönderildi".

**H-3 — Varış gününden önce sorulan erken giriş (A1).** Bugün size kalıyor. Önerim: istek beklesin, varış günü temizlik "bitti" olunca
kod yeniden değerlendirsin; arada misafire bir şey gitmesin.
- Önce: dün 20:00 "Yarın 13:00'te girebilir miyiz?" → cevap yok, size e-posta; yarın sabah siz yazarsınız.
- Sonra (a, önerim): akşam bir şey gitmez, size de e-posta gitmez; ertesi gün 12:40'ta temizlik bitince "Bugün 13:00 itibarıyla giriş
  yapabilirsiniz. Erken giriş ücreti ₺500." gider. Kanıt eksikse (temizlik 12:30'a kadar bitmediyse) o zaman size düşer.
- Sonra (b): dün 20:00 "Erken giriş için yarın sabah size yazacağız." ara cümlesi de gider — bu, "devir / bildirim cümlesi misafire
  gitmez" kararınıza takılır; önermiyorum, ama misafirin akşamı cevapsız geçirmesi sizi rahatsız ediyorsa bu seçenek var.

**H-4 — Geç çıkış için daire kuralı (C).** Önerim: erken giriş formunun aynası (kapalı / taslak / otomatik · en geç saat · ücret); yalnız
ertesi gün giriş yoksa ve temizlik penceresi yetiyorsa otomatik.
- Önce: "Yarın 13:00'e kadar kalabilir miyiz?" → size e-posta, cevabı siz yazarsınız.
- Sonra: ertesi gün giriş yoksa "Yarın 13:00'e kadar kalabilirsiniz. Geç çıkış ücreti ₺300." gider; giriş varsa size kalır.

**H-5 — Verdiğiniz bilgiyle kurulan cevaba ikinci onay.** Bugünkü kararınız "ilk dilim yalnız onaylı". Önerim: WhatsApp döngüsü açılıp
ölçülene kadar DEĞİŞMESİN; ölçümden sonra yalnız "cevaptaki her değer sizin cümlenizde birebir geçiyor + soru tam karşılanıyor" hâlinde
doğrudan gitsin.
- Önce: WhatsApp'tan "otopark yok, 200 m'de ücretli otopark var" yazarsınız → önizleme → [Gönder].
- Sonra: "Otoparkımız yok; 200 metre ileride ücretli bir otopark var." doğrudan gider, size "Gönderildi" gelir.

**H-6 — Rutin fatura / makbuz sorusu iade pazarlığından ayrılsın mı?** Bugünkü kararınız: ödeme / fatura her dilde size. Önerim:
değiştirmeyelim; canlı açılınca yalnız sayalım (kaç mesaj, hangi tür). Değişiklik ayrı karar.

**H-7 — Panelden yazdığınız cevaptan bilgi tabanı önerisi (B).** Önerim: cevabı gönderdikten sonra tek satır "Bunu bilgi tabanına
ekleyeyim mi? [Ekle] [Hayır]" (tek seferlik / kişiye özel / kod içeren bilgi önerilmez). Misafire giden hiçbir şeyi değiştirmez.
- Önce: "Otoparkınız var mı?" sorusuna elle cevap verirsiniz; bir sonraki misafir sorunca yine size gelir.
- Sonra: [Ekle] → bir sonraki misafire "Otoparkımız yok; 200 metre ileride ücretli bir otopark var." kendiliğinden gider.

**H-8 — Hangisi ilk?** Önerim: A0 → A1 → A2 (devir günü; mevcut altyapıyla), H-7 paralel; A3 Meta numarası gelince; C sonra.

## 12. Doğrulama notu

Ana oturumda kodda yeniden bakılanlar: `recheck.ts` ("gelecek varış günü ayrı akış, henüz yok" ve yalnız zamanlanmış geçişten çağrılması) ·
`early-checkin/core.ts` otomatik gönderim koşulu · `workflow.ts` kuyruk engeli · `readiness.ts` kimlikli kanıt kuralı · şemada
`autoReplyHospitable` ve `autoCheckin` varsayılanı kapalı · Girişler'de "kontrol bekliyor" işaretinin göndericide okunmaması · güven eşiği
0,75 · öğe defterinde `host_replied` türetmesi ve bu turun "kesin gitmeyen cevap" istisnası · öğe kaydında göreve bağ OLMADIĞI (görevde
kaynak mesaj kimliği var) · kanal sözleşmesinde mesaj eşleştirmenin "yok" olması.
Yeniden bakılmayanlar (araştırma ajanının okumasına dayanıyor): WhatsApp ev sahibi döngüsünün ayrıntıları (kapalı), kapının ~30 tutma
gerekçesi sayısı, bilgi tabanı onay ayrıntıları. Bu satırlar uygulama diliminden önce yeniden okunur.
