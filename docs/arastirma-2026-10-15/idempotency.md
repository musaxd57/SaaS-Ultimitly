# Idempotency (tekrar güvenliği) denetimi — 2026-10-15

> **10-15 uygulama durumu:** #2, #3, #5, #7, #8, #9, #10, #15 kodda kapandı (müşteriye giden değişmedi, migration yok); kalan maddeler ve sorular
> `KURUCU-SORULARI.md`. Rapor metni aşağıda AYNEN (araştırma anındaki hâl).

> Salt-okuma denetim. Kod değiştirilmedi, test koşulmadı. Her bulgu `dosya:satır` ile izlendi.
> Ölçü: AYNI kullanıcı eylemi ya da AYNI dış olay iki kez uygulanınca zarar var mı?
> Önem = zarar × olasılık: P0 = sıradan kullanımda (çift tık / ağ tekrarı) olur VE para / veri kaybı / misafire çift-yanlış mesaj ·
> P1 = sıradan kullanımda olur, zarar orta (çift e-posta, çift görev, çift KB kalemi, kayıp güncelleme) YA DA ağır zarar ama özel koşul ·
> P2 = özel koşul (yanıt kaybı + gecikmeli tekrar, iki sekme) + görünür zarar · P3 = kozmetik / maliyet / teorik.
> Durum: DOĞRULANDI (kod izi) / ŞÜPHELİ (kod izi eksik, çalıştırılarak sınanmalı).
> Bağlam: tek Railway örneği (yatay ölçek yok) → "aynı süreçte iki istek" + "cron ile elle tetik" yarışları gerçek; çok örnek yarışları bugün yok.

**Özet:** P0 yok — ödeme, oto-cevap, yaşam döngüsü mesajları, karar kartı, senkron kilidi, kimlik akışları sağlam (CAS + benzersiz dizin +
kilit). Boşluklar "yeni kayıt OLUŞTURAN" uçlarda (elle rezervasyon / konuşma / söz / görev / KB kopya / talimat) ve elle cevabın kuyruk
kapalı yolunda (`requestId` kullanılmıyor). Sıralı liste §8, kurucu soruları §9, ortak desen önerisi §7.

## 1. Misafire giden mesaj yolları (en ağır zarar sınıfı)

### 1.1 Elle cevap / onaylanan taslak — `POST /api/conversations/[id]/reply`
- **Bugünkü koruma:** istemci mesaj başına `requestId` üretir ve hata / çift tıkta aynı kimliği yeniden kullanır
  (`src/components/inbox/conversation-thread.tsx:269-281`). Sunucuda:
  - Kalıcı kuyruk AÇIKSA (`DURABLE_OUTBOX_ENABLED`, bugün KAPALI): `MessageOutbox @@unique([organizationId, idempotencyKey])`
    (`prisma/schema.prisma:1186`), anahtar `manual:<konuşma>:req:<requestId>` (`reply/route.ts:89-91`), aynı kimlik farklı
    gövdeyle → 409 (`host-send.ts:83-94`). SAĞLAM.
  - Kuyruk KAPALIYKEN (canlı yol): `claimOutboundSend(konuşma, sha256(ham gövde))` → `SystemLock` satırı, TTL 120 sn
    (`outbound-claim.ts:25,42-61`); başarıda kalkan BIRAKILMAZ (120 sn boyunca aynı metin 409), kesin hatada bırakılır
    (`host-send.ts:109-111`), belirsizde tutulur. Sağlayıcı POST'u tek atış (`channels/hospitable-outbound.ts:60` `retries: 0`).
- **Boşluk A (DOĞRULANDI, P1 — özel koşul ama projenin kendi değişmezine göre en ağır sınıf: "çift mesaj, nadir sessiz kayıptan
  kötüdür", `channels/hospitable-outbound.ts:14-18`):** kuyruk kapalı yolda `requestId` **hiç kullanılmıyor** — koruma yalnız 120 sn'lik gövde özeti.
  Senaryo: ev sahibi "Gönder"e basar → Hospitable mesajı kabul eder → yanıt yolda kaybolur (mobil ağ / sekme uykuya geçer) →
  istemci "doğrulanamadı, kontrol edin" der (iyi) → ev sahibi 3 dk sonra aynı metinle (aynı `requestId`) "tekrar dene"ye basar →
  kalkanın süresi dolmuştur → **misafire İKİNCİ aynı mesaj gider.** Zarar: misafire çift mesaj (görünür, utandırıcı; para yok).
  Hafifletici: istemci metni uyarıyor; senkron 2 dk içinde ilk mesajı panele getiriyor.
- **Boşluk B (DOĞRULANDI, P3):** gövde yalnız sunucuya ulaşıp DB yazımı patlarsa (gönderim başarılı, `message.create` P2002
  dışı hata, `host-send.ts:140-143` yeniden fırlatır) istemci 500 görür; 120 sn sonra aynı metin yine gider. Aynı kök.
- **Boşluk C (DOĞRULANDI, P3, maliyet):** çeviri (`translateTo`) kalkandan ÖNCE koşuyor (`reply/route.ts:55-83`) → çift tıkta iki
  ücretli çeviri çağrısı + iki günlük bütçe birimi; ikinci istek sonra 409 alır.
- **En küçük düzeltme (migration YOK):** kuyruk kapalı yolda `requestId` varsa kalkanı ONUNLA kur — `claimKeyedOutboundSend
  ("manual:<org>:<konuşma>:<requestId>", ham gövde)` zaten var (`outbound-claim.ts:82-112`, gövde özetini `holder`da tutar, aynı
  kimlik + farklı gövde = `mismatch` → 409). Bugünkü gövde-özeti kalkanı da kalsın (iki sekme / kimliksiz eski istemci). Teslim
  BAŞARILI olunca kimlik satırının süresini 24 saate uzat ve `holder`a mesaj kimliğini ekle (`<özet>|sent|<messageId>`); yeniden
  deneme `duplicate` görünce satırı okur, "sent" ise **200 + aynı mesaj** döner ("zaten gitti", ikinci gönderim yok). Belirsiz
  sonuçta bugünkü 120 sn kalır (kullanıcı kontrol etsin). Kalıcı ve daha temiz biçimi: `Message.clientRequestId` + `@@unique
  ([conversationId, clientRequestId])` (migration 67 deseni) — ama kayıt teslimden SONRA yazıldığı için "teslim oldu, kayıt patladı"
  artığını (Boşluk B) yalnız teslimden ÖNCE yazılan niyet kapatır, o da kalıcı kuyruğun (bayrak) ta kendisi. Çeviriyi kalkandan SONRA
  çalıştır (kalkanı al → çevir → çeviri hatasında kalkanı bırak).
- **Kanıt testi (gerçek PG):** mevcut `tests/integration/conversations-reply-route.test.ts` deseni (`vi.mock("@/lib/messaging")` ile
  `sendOnChannel` sahte; `:173-184` çift tık testi var) — yeni dava: ① ilk POST 201 ② gövde-özeti kalkanını süresi dolmuş gibi yap
  (`prisma.systemLock.updateMany({ where: { name: { startsWith: "outbound-send:" } }, data: { lockedUntil: new Date(0) } })`; bekleme /
  sahte saat yok — CLAUDE.md "sabit tarih + Date.now() penceresi = zaman bombası") ③ aynı `requestId` + aynı gövdeyle ikinci POST →
  beklenen 200 + aynı mesaj kimliği, `mockSend` 1 kez. Kırmızı-önce: bugün 201 + `mockSend` 2 kez. Eşzamanlı: `Promise.all` iki POST →
  bir 201, bir 409/200, `mockSend` 1 kez. Kontroller: farklı `requestId` + aynı metin (kalkan dolmuşken) → iki gönderim (kasıtlı tekrar
  çalışır); belirsiz hata sonrası aynı kimlik 120 sn içinde → 409 (bugünkü davranış korunur).

### 1.2 Oto-cevap (2 dk cron + `/api/cron/sync` + elle senkron)
- **Koruma:** konuşma durumu CAS'ı — `updateMany where status in [new, waiting] AND görülmemiş gelen mesaj yok → answered`
  (`automation.ts:3406-3416`); kesin hatada geri, belirsizde tutulur (`automation.ts:3459-3530`); mesaj `@@unique([conversationId,
  externalId])` ile senkronla yarışta tekilleşir (`automation.ts:3564-3571`, şema `:718`). Ayrıca küresel senkron kilidi (aşağıda §2.3).
- **Değerlendirme:** SAĞLAM. Aynı gelen mesaja iki oto-cevap için iki geçişin aynı anda CAS'ı kazanması imkânsız. Kalan tek
  pencere bilinçli: belirsiz teslimde konuşma "answered" kalır (çift mesaj yerine sessiz kaçırma — kurucu değişmezi).
- **Not (kapsam dışı ama aynı zarar):** ev sahibinin elle cevabı konuşma CAS'ını almıyor; ev sahibi yazarken oto-cevap da giderse
  misafir iki cevap alır. Bu "aynı eylemin iki kez" değil, iki aktörün yarışı; QR'da danışma kilidi bunu çözüyor
  (`guest-chat.ts:190`), kanal yolunda yok. P3, ayrı tasarım sorusu.

### 1.3 Karşılama / giriş / çıkış mesajları (yaşam döngüsü)
- **Koruma:** rezervasyon damgası CAS'ı (`welcomeSentAt: null → stampedAt`) + kardeş satırlar aynı işlemde + silinmiş misafir
  kapısı (`automation.ts:4613-4629`), geri alma `stampedAt` koşullu (`:4657-4670`); checkin `:4838-4886`, checkout `:5189-5236` aynı.
  Kuyruk açıkken belirlenimli anahtar `{type}:{org}:{rezervasyon}` + `@@unique` (`outbox/enqueue.ts:185-221`).
- **Değerlendirme:** SAĞLAM. Ek eylem yok.

### 1.4 QR sohbetinde ev sahibi cevabı — `POST /api/guest-chats/[id]/reply`
- **Koruma:** `claimOutboundSend(konuşma, metin)` 120 sn (`guest-chats/[id]/reply/route.ts:35-41`) + konuşma danışma kilidi.
  İstemci `requestId` göndermiyor (`components/guest-chats/reply-box.tsx:59` yorumu). İç konuşma; dışarı bir şey gitmiyor.
- **Boşluk (DOĞRULANDI, P3):** 120 sn sonra yeniden deneme ikinci balon yazar (misafir sayfasında iki aynı "İşletme ekibi"
  mesajı). Kayıt patlarsa kalkan 120 sn boyunca aynı metni engeller (kullanıcı "az önce gönderildi" görür ama gitmemiştir).
  Düzeltme 1.1 ile aynı desen (istemci kimliği + `Message.clientRequestId`).

### 1.5 QR yapay zekâyı yeniden aç — `POST /api/guest-chats/[id]/resume-ai`
- **Koruma:** oku-sonra-yaz, kilitsiz (`resume-ai/route.ts` — `guestChatAiPausedFromMessages` kontrolü işlem DIŞINDA).
- **Boşluk (DOĞRULANDI, P3):** eşzamanlı iki tık → iki "Lixus AI yeniden etkinleştirildi" sistem satırı. Zarar kozmetik.
  Düzeltme: kontrolü `$transaction` içine al + `acquireGuestChatThreadLock(tx, id)` (QR rotasıyla aynı kilit).

### 1.6 Host karar kartı — `POST /api/conversations/[id]/decisions/[decisionId]`
- **Koruma:** `version` CAS'ı `pending → sending` (`decisions/[decisionId]/route.ts:227-231`), yerleşme `sending + lockedVersion`
  koşullu (`:233-242`), kuyruk anahtarı `decision:<id>:v<n>` + katı tekilleştirme (`:264-265`); belirsiz sonuç kartı yeniden
  AÇMAZ (`:244-251, 274-278`).
- **Değerlendirme:** SAĞLAM (örnek alınacak desen). Çift tıkta ikinci istek 409 `stale`, ikinci mesaj yok.

### 1.7 Kuyruk elle yeniden deneme — `POST /api/outbox/[id]/retry`
- **Koruma:** korumalı UPDATE yalnız `failed` + kiracı + 402 değil (`outbox/[id]/retry/route.ts:17-19` → `outbox/ops.ts:146`).
  Çift tıkta ikincisi 409. SAĞLAM.

### 1.8 QR misafir sohbeti — `POST /api/chat/[token]` (`requestId`)
- **Koruma:** istemci mesaj başına kimlik, hata sonrası aynı metinle yeniden kullanır (`components/guest-chat/guest-chat.tsx:176-183`,
  başarıda sıfırlar `:234`); sunucu `claimKeyedOutboundSend("qr-in:<konaklama>:<requestId>", metin)` — aynı gövde → `deduped`,
  farklı gövde → 409, mağaza arızası → 503 (`chat/[token]/route.ts:641-664`); kayıt öncesi hata kalkanı bırakır (`:1354-1357`);
  konaklama tavanı kalkandan SONRA sayılır (`:665-671`); iptal edilmiş konaklama yolu ayrı tek-sefer kovası (`:507-509`).
  Ev sahibine e-posta olay kimliğiyle tekil (`guest-chat-alerts.ts:147-175`, acilde içerik parmak izi).
- **Boşluk (ŞÜPHELİ, P3):** kalkan TTL 120 sn (`outbound-claim.ts:25`), ama QR yolu art arda birkaç model çağrısı yapabiliyor; her
  biri 60 sn'ye kadar (`ai/index.ts:385,689` reasoning modelde 60.000 ms). İlk istek >120 sn sürerse kalkan süpürülür, aynı kimlikle
  gelen tekrar İKİNCİ kez işlenir (çift misafir balonu + çift model ücreti + olası ikinci devir). İstemci aynı sekmede gönderim
  sürerken ikinci gönderime izin vermiyor (`sendingRef`), yani pratikte ağ katmanı tekrarı gerekir. Düzeltme: kalkan TTL'ini QR
  isteğinin üst süre sınırına eşitle (ör. 300 sn) ya da kayıt sonrası kalıcı iz (`Message.clientRequestId`, §1.1 ile aynı kolon).
- **Not:** sayfa yenilenince istemci kimliği kaybolur (bellekte `useRef`) → yanıtı kaybolmuş mesajı yenileyip yeniden yazan misafir
  yeni kimlik üretir. Kaçınılmaz değil: kimlik `sessionStorage`'da (metinle birlikte) tutulabilir. P3.

## 2. Dış olaylar: webhook, cron, kuyruk

### 2.1 Paddle webhook — `POST /api/webhooks/paddle`
- **Koruma:** HMAC + `timingSafeEqual` + zaman penceresi; `WebhookEvent.providerEventId @unique` (`schema.prisma:1040`) ve yalnız
  `processed` olanı tekrar sayar (`webhooks/paddle/route.ts:636-651`); abonelik `organizationId @unique` + `occurred_at` korumalı
  UPDATE (`:278, 379-416`, P2002 dalı dahil); fatura `@@unique([provider, providerRef])` + P2002 yutulur (`:441-492`); bekleyen plan
  kilidi yalnız eşleşen hedef fiyatla silinir (`:306-311`); fiyat haritası alarmı `SystemLock` ile 30 günde bir (`:313-370`).
- **Değerlendirme:** SAĞLAM (ödeme belgesindeki tablo doğru). Aynı `event_id`'nin EŞZAMANLI iki teslimi ikisi de `received` görür
  ve ikisi de işleyiciyi çalıştırır — işleyiciler idempotent olduğu için zararsız; tek yan etki iki `billing.webhook.processed`
  olay günlüğü satırı. Ödeme belgesindeki "test eksikleri" hâlâ geçerli (eşzamanlı aynı olay, aynı işlemin iki farklı `event_id`'si).
- **Test (gerçek PG):** `Promise.all([POST(req), POST(req)])` aynı imzalı gövde → `invoice.count === 1`, `subscription` tek satır,
  `webhookEvent` tek satır `processed`. İkinci senaryo: `transaction.completed` iki farklı `event_id`, aynı `data.id` → tek fatura.

### 2.2 Hospitable / e-posta sağlayıcısı webhook'u
- **YOK.** `src/app/api/webhooks/` altında yalnız `paddle` var; Hospitable verisi yoklama (2 dk senkron) ile gelir, Resend teslim
  olayı dinlenmiyor. Webhook tekrar riski bugün sıfır. Gelecekte Hospitable/Airbnb webhook'u eklenirse aynı yazma servisi
  (`ingest/write-service.ts`) + `IngestEvent` tekilleştirmesi kullanılacak (kalıcı karar). Not: yeni webhook ucu yazılırken
  `WebhookEvent` deseni (sağlayıcı olay kimliği `@unique` + yalnız `processed` tekrar sayılır) kopyalanmalı.

### 2.3 Zamanlanmış senkron (süreç içi 2 dk + `/api/cron/sync` + elle "Mesajları çek")
- **Koruma:** `SystemLock "scheduled-sync"` atomik `updateMany where lockedUntil <= now` + rastgele `holder` (fencing) + 15 dk TTL
  (`scheduled-sync.ts:101-109, 188-205`), ilerleme tetikli yenileme ve kayıp tespiti (`:233-250`), sahibine koşullu bırakma
  (`:252-263`), süreç içi `running` bayrağı + elle senkron aynı kilitten (`:271-299`, `hospitable/sync/route.ts:37`). Derin tarama
  aralığı da `SystemLock` CAS'ı (`:164-180`). İçeri aktarımda `Reservation @@unique([propertyId, sourceReference])`
  (`schema.prisma:540`), `Conversation @@unique([propertyId, externalReservationId])` (`:666`), `Message @@unique([conversationId,
  externalId])` (`:718`), `IngestEvent`/`Signal dedupeKey @unique` (`:1337`).
- **Değerlendirme:** SAĞLAM. İki geçiş aynı anda koşamaz; koşsa bile (TTL aşımı) DB benzersizlikleri çift satırı durdurur.
- **Kalan delik (DOĞRULANDI, P3):** elle takvim senkronu (`POST /api/calendar/sync`, `POST /api/calendar-sources/[id]/sync`) senkron
  kilidini ALMIYOR (`calendar/sync/route.ts`, `calendar-sources/[id]/sync/route.ts`). Satır yazımları org danışma kilidi altında
  (`import/sync.ts:392`) ve UID benzersizliği var, yani rezervasyon çiftlenmez; ama satır işleminden SONRA koşan
  `createReservationTasks` (`import/sync.ts:577`) kilitsiz → aşağıda §5.2.

### 2.4 E-posta kuyruğu (kimlik e-postaları)
- **Koruma:** `FOR UPDATE SKIP LOCKED` talep, `claimedBy` CAS'ı, sürüm/güncellik kapısı, `@@unique([userId, kind, version])`
  (`email-outbox.ts:20-56, 463-640`, `schema.prisma:1544`). Kendi belgesi dürüst: "EN AZ BİR KEZ, tam bir kez DEĞİL".
- **Boşluk (DOĞRULANDI, P3):** sağlayıcı çağrısı başarılı olup `sent` yerleşimi kaybolursa (süreç ölür / DB anlık düşer) talep süresi
  dolunca aynı e-posta yeniden gider (`email-outbox.ts:600-611`). Resend çağrısında idempotency başlığı YOK
  (`email-core.ts:82-87`). Resend `Idempotency-Key` başlığını destekliyor (24 saat saklar) → anahtar `email-outbox:<satır id>`
  verilirse bu artık da kapanır. Tek satır, şema yok. (Kaynak bölüm 9'da.)

### 2.5 Kalıcı mesaj kuyruğu (`DURABLE_OUTBOX_ENABLED`, KAPALI)
- **Koruma:** `@@unique([organizationId, idempotencyKey])` + mesaj ve niyet aynı işlemde (`outbox/enqueue.ts:93-158`); yaşam döngüsü
  anahtarı belirlenimli (`:169-221`); işçi tek atış + belirsizde `review`.
- **Değerlendirme:** SAĞLAM. Açıldığında §1.1 Boşluk A kendiliğinden kapanır (anahtar `requestId`'den).

## 3. Kimlik ve faturalandırma uçları

### 3.1 Kayıt — `POST /api/auth/register`
- **Koruma:** `User.email @unique` (`schema.prisma:199`) + yarışın kaybedeni P2002'de var-olan-hesap dalıyla AYNI 201'i alır, işlem geri
  alındığı için yetim kuruluş / abonelik kalmaz (`auth/register/route.ts:190-246`); IP kovası 5/saat (`:66`).
- **Boşluk (DOĞRULANDI, P2):** eşzamanlı değil de ARDIŞIK tekrar (ilk istek işlendi, yanıt kayboldu / kullanıcı yeniden bastı) var-olan-hesap
  dalına düşer ve kullanıcıya **"Bu adresle zaten bir hesabınız var"** e-postası gider (`:124-168`) — az önce "e-postanızı doğrulayın"
  e-postası almış yeni kullanıcıya ikinci, kafa karıştırıcı e-posta. Kovası 4/15 dk + 3/gün olduğu için sel değil.
- **Düzeltme:** var-olan-hesap dalında "aynı adres, doğrulanmamış, son 15 dk içinde ve aynı istemci kaydı (`acceptedIp` + `acceptedUserAgent`)"
  ise bildirimi atla — yanıt yine birebir aynı 201. ⚠️ Zamanlama paritesi: kuyruk açıkken iki dal da yalnız kuyruğa yazıyor; atlanan
  dalda da aynı süreli bir no-op yazma bırakılmalı (unutulan-parola rotasındaki `__timing_parity__` emsali, `forgot-password/route.ts:134-137`).
  Kimlik akışı → kurucu onayı + ilk denemeler birlikte (CLAUDE.md değişmez kuralı).
- **Test:** `register-race.test.ts` deseni; ikinci istek ilk commit'ten SONRA → `emailOutbox.count({kind:"account_exists"}) === 0`; kontrol:
  farklı IP'den 20 dk sonra → 1.

### 3.2 E-posta doğrulama / yeniden gönderme / parola sıfırlama / parola değiştirme
- **Koruma:** doğrulama tek kullanımlık atomik tüketim (`auth/verify-email/route.ts:170-179`); sıfırlama "challenge" satırı + bütçe +
  epoch artışı tek işlemde (`account/forgot-password/route.ts:147-160, 211`, `lib/auth/password-reset-challenge.ts:209-270`); parola
  değişikliği kod hash'i + `sessionEpoch` CAS (`account/password/route.ts:201-231`); e-posta kuyruğu aynı (kullanıcı, tür) bekleyen
  satırı iptal eder (`email-outbox.ts:151-171`).
- **Değerlendirme:** SAĞLAM. Çift tıkta en kötü sonuç: iki farklı kodlu e-posta (ilki kuyrukta iptal edilmediyse); kurucu kararı gereği
  önceki sıfırlama challenge'ı iptal edilmiyor (saldırgan kurbanın kodunu düşüremesin) → iki kod da çalışır. P3, bilinçli.

### 3.3 2FA — `POST /api/account/2fa`
- **Koruma:** `enable` CAS'ı `twoFactorEnabledAt: null + twoFactorSecret = doğrulanan + sessionEpoch` (`account/2fa/route.ts:212-233`);
  kurtarma kodları TOTP adımı yakılarak (`:403-413`) ve kurulum değişmediyse (`lib/auth/recovery-codes.ts:72-95`).
- **Boşluk (DOĞRULANDI, P3):** `setup` çift tık → iki ayrı sır üretilir, ikincisi birincinin üstüne yazar (`:154-174`; CAS yalnız "henüz
  etkin değil"i sınar). Yanıtlar ters sırada gelirse ekranda ESKİ sırrın QR'ı kalır; kullanıcı onu tarar, `enable` "Kod hatalı" der.
  Kilitlenme yok (2FA henüz açık değil), yalnız kafa karışıklığı. Düzeltme: bekleyen (etkin olmayan) sır varsa ve son N dk içinde
  kurulduysa yenisini üretme, aynısını döndür (yeni kolon gerektirmemek için yalnız "bekleyen sır var" yeterli; kullanıcı "yeniden
  başlat" derse ayrı eylem).
- **Not (ŞÜPHELİ, P3):** epoch artıran işlemlerde (2FA aç/kapat, parola değiştir) çift tıkın ikinci isteği eski epoch'lu çerezle gelir →
  `requireSession` null döner (`lib/api.ts:36`) → 401. İlk istek çerezi yenilediği için kullanıcı girişli kalır; ama arayüz ikinci yanıtın
  401'ini "oturum düştü" diye yorumlayıp giriş sayfasına atıyorsa kafa karıştırır. Çalıştırılarak sınanmalı.

### 3.4 Ödeme onayı / ödeme işleniyor kilidi / plan değişikliği
- **Koruma:** plan değişikliği önizleme jetonu HMAC + `jti` tek kullanım + `plan-change-pending` CAS kilidi (`billing/plan-change/route.ts:44-198`);
  "ödemeniz işleniyor" kilidi `SystemLock` (`lib/billing/checkout-pending.ts`); onay kaydı yalnız aktif abonelik / kilit yoksa
  (`billing/consent/route.ts`).
- **Boşluk (DOĞRULANDI, P3):** `POST /api/billing/consent` çift tık → iki `CheckoutConsent` satırı (kontroller kilitsiz oku-sonra-yaz).
  Zarar yok (onay kaydı yalnız iz; `consumedAt` EKLENMEZ kalıcı kararı). Gerçek para riski ödeme belgesindeki "iki sekmede iki ödeme
  ekranı" — Paddle ödeme ekranı bizim sunucumuzu çağırmadan tahsilat yaptığı için sunucu tarafı idempotency anahtarı bunu ÇÖZEMEZ;
  çözüm zaten uygulandı: ikinci aktif abonelik alarmı (`webhooks/paddle/route.ts:296-304`) + işleniyor kilidi. Bkz. ödeme belgesi §5.
- **Ek öneri (P2, kurucu sorusu):** ikinci aktif abonelik alarmı geldiğinde operatör bugün Paddle panelinden elle iptal ediyor. Otomatik
  iade/iptal para akışıdır → YAPILMAZ (kurucu onayı olmadan); alarm yeterli.

## 4. Bilgi tabanı, şablonlar, talimatlar, geçmişten öğrenme, yapay zekâ önerileri

### 4.1 KB oluşturma — `POST /api/kb`
- **Koruma (YENİ, migration 67 ana dalda — `prisma/migrations/67_kb_client_request_id`):** `KnowledgeBaseItem.clientRequestId` +
  `@@unique([propertyId, clientRequestId])` (`schema.prisma:837,843`); önce arama, P2002'de kazananın kalemi, sınır doluyken de kendi
  kalemi döner (`kb/route.ts:36-104`). Hazır yama (`docs/hazir-yamalar/2026-10-14-…migration-65.patch`) 67 numarasıyla uygulanmış.
- **Boşluk (DOĞRULANDI, P1):** kimliği YALNIZ "metinden bilgi çıkar" ekranı gönderiyor (`components/knowledge/kb-import-text.tsx:66-125`).
  Aynı uca giden üç ekran göndermiyor:
  - elle ekleme formu `components/knowledge/kb-manager.tsx:174-186` — ağ hatasında "bağlantınızı kontrol edip tekrar deneyin" diyor
    (`:193`) → kullanıcı yeniden basar → ilk istek yazdıysa **iki aynı kalem**;
  - şablondan öneri "Ekle" `components/knowledge/kb-template-suggestions.tsx:65-90` — hata dalı "Eklenemedi." diyor, düğme yeniden
    etkin → aynı sonuç;
  - geçmiş cevaplar `components/knowledge/kb-past-answers.tsx:98` (yüzey bugün KAPALI, `KB_HISTORY_SUGGESTIONS_ENABLED`).
  Zarar: iki Wi-Fi kalemi; biri sonradan düzeltilirse yapay zekâ eski şifreyi de okuyabilir → **misafire yanlış bilgi** (migration 67
  gerekçesinin aynısı). Düzeltme yalnız İSTEMCİ (sunucu ve şema hazır): üç ekranda da kb-import-text'in `requestIdFor` deseni
  (içerik başına kimlik, başarıda temizle). Migration YOK.
- **Test:** `tests/ui/kb-manager-request-id.test.tsx` (ilk `fetch` reddedilir, ikinci tık AYNI `requestId`'yi yollar) + mevcut
  `tests/integration/kb-create-request-id.test.ts` sunucu tarafını zaten kanıtlıyor.
- **Ek (DOĞRULANDI, P3):** plan sınırı sayımı ile oluşturma arasında kilit yok (`kb/route.ts:65-75`) → sınırın bir altındayken eşzamanlı iki
  FARKLI kalem sınırı 1 aşar. İdempotency değil, kota yarışı; `properties` POST'taki `FOR UPDATE` deseni (`properties/route.ts:88`) uygulanabilir.

### 4.2 KB kopyalama — `POST /api/kb/[id]/copy`
- **Koruma:** YOK (`kb/[id]/copy/route.ts` — hedef başına sayım + `create`, kimlik / kilit yok).
- **Boşluk (DOĞRULANDI, P1):** "3 daireye kopyala" çift tık / ağ tekrarı → her hedef dairede iki aynı kalem. §4.1 ile aynı zarar.
- **En küçük düzeltme (migration YOK):** istemci kopyalama isteği başına bir kimlik yollar; sunucu hedef başına `clientRequestId =
  "copy:" + <istek kimliği>` yazar → migration 67'nin `@@unique([propertyId, clientRequestId])` dizini hedef başına tekilleştirir;
  P2002 → "zaten kopyalandı" say. (Kolon 200 karakter sınırsız TEXT; doğrulayıcı `requestId` biçimi 8-64 → önek dahil sığar.)
- **Test:** `Promise.all` iki kopya isteği aynı kimlikle → her hedefte `count === 1`; kontrol: farklı kimlik → 2.

### 4.3 Şablonlar — `POST /api/templates`, "şablon uygula"
- "Şablon uygula" İSTEMCİDE metni yazma alanına koyar (`components/inbox/conversation-thread.tsx:497-500`); gönderim §1.1'in korumasından
  geçer. Sunucu tarafı ayrı bir "uygula" ucu YOK.
- `POST /api/templates` korumasız (`templates/route.ts` — düz `create`). Çift tık → iki aynı şablon. Zarar küçük (şablon listesi kirlenir;
  yapay zekâya girmez). P3. Düzeltme gerekiyorsa genel desen (§7).

### 4.4 Mülk talimatı (serbest metin) — `POST /api/properties/[id]/instructions`
- **Koruma:** mülk satırı `FOR NO KEY UPDATE` + etkin talimat tavanı (`lib/history-learn/service.ts:559-590`).
- **Boşluk (DOĞRULANDI, P2):** satır kilidi iki isteği SIRAYA koyar ama aynı metni tekilleştirmez → çift tık iki aynı etkin talimat
  (isteme iki kez girer, tavandan iki hak yer). Kardeş `reviewComparison` aynı metinli etkin talimatı zaten yeniden kullanıyor
  (`service.ts:714-722`); `addPropertyInstruction`'a aynı 4 satır eklenir (kilit altında olduğu için yarışsız). Migration YOK.
- **Test:** `Promise.all` iki POST aynı metin → `propertyInstruction.count({status:"active"}) === 1`, iki yanıt aynı `id`.
- Hazır seçenek aç/kapat (`setPresetInstruction`, `:597-628`) SAĞLAM (kilit + var-mı kontrolü).

### 4.5 Geçmişten öğren — çalıştırma, taslak onayı, karşılaştırma kararı
- **Koruma:** başlatma işletme satırı kilitli + mülk başına tek etkin çalıştırma + aylık tavan (`service.ts:111-151`); yürütme `queued →
  running` CAS (`:217-221`); taslak onayı `pending` CAS'ı aynı işlemde KB kalemiyle (`:476-546`); karşılaştırma kararı mülk + satır kilidi
  ve aynı metinli talimat / taslak yeniden kullanımı (`:660-768`).
- **Değerlendirme:** SAĞLAM. Çift tık ikinci çalıştırma / ikinci KB kalemi açmaz.

### 4.6 Yapay zekâ eylem önerisi tek tık onayı — `POST /api/ai-suggestions` (anahtar KAPALI)
- **Koruma:** öneri sunucuda veriden yeniden üretilir; anahtar başına `pg_advisory_xact_lock` + aynı işlemde "karar zaten var mı" (AuditLog)
  + eylem + karar kaydı tek işlem (`lib/ai-suggestions/act.ts:89-164`). Görev yolu ayrıca gün-konu tekilleştirmesi.
- **Değerlendirme:** SAĞLAM. Kalan teorik pencere: zamanlanmış senkronun AYNI mesajdan görev açması öneri kilidini almıyor
  (`automation.ts:5510, 5610`); `createOperationalTaskFromMessage` oku-sonra-yaz (`tasks/create.ts:49-58`) → aynı anda iki görev
  olasılığı. P3 (bkz. §5.2 düzeltmesi bunu da kapatır).

## 5. Görev, rezervasyon, içe aktarma, takvim, mülk, konuşma

### 5.1 Elle rezervasyon — `POST /api/reservations`
- **Koruma:** yalnız referans (`sourceReference`) verilirse `@@unique([propertyId, sourceReference])` (`reservations/route.ts:44-71`).
  Referanssız elle girişte (ev sahibinin en sık yolu) HİÇBİR tekilleştirme yok.
- **Boşluk (DOĞRULANDI, P1):** çift gönderim / ağ tekrarı → iki aynı rezervasyon, ardından her biri için `applyReservationCreatedRules`
  (`automation.ts:1276-1330`): **iki giriş hazırlığı + iki temizlik görevi** (temizlikçi listesinde çift iş) ve **tüm sahip/yöneticilere
  iki "Yeni Rezervasyon" e-postası**. Ek zarar: aynı daire + aynı tarihler → müsaitlik motoru kendi kopyasıyla **çakışma** görür
  (takvim çakışması paneli / V2 para etkisi kartı yanlış alarm).
- **Düzeltme:** istemci kimliği + genel tekrar-güvenliği tablosu (§7) ya da `Reservation.clientRequestId` + `@@unique([propertyId,
  clientRequestId])` (migration 67 deseni). `sourceReference`'a sentetik değer YAZILMAZ (kalıcı karar: elle referans sağlayıcı kimliği
  değil; iCal "legacy" benimseme sorgusu `sourceReference` ile eşleşiyor, `import/sync.ts:413-419`).
- **Test (gerçek PG):** `Promise.all` iki POST aynı `requestId` → `reservation.count === 1`, `task.count === 2` (giriş + temizlik, 4 değil),
  e-posta sahte gönderici 1 çağrı; kontrol: kimliksiz iki POST → 2 (eski davranış korunur).

### 5.2 Görev oluşturma
- **Elle görev `POST /api/tasks`:** korumasız düz `create` (`tasks/route.ts:63-76`). Çift tık → iki görev. P2 (istemci düğmeyi kilitliyor:
  `components/tasks/task-form.tsx:34,133`; yalnız ağ tekrarı kalır).
- **Mesajdan yapay zekâ görevi `createOperationalTaskFromMessage`:** gün-konu anahtarı (`dedupeKey`) ile oku-sonra-yaz, BENZERSİZ DEĞİL
  (`tasks/create.ts:49-58`, şema `@@index([dedupeKey])` `schema.prisma` Task); kod yorumu açığı kabul ediyor. Çağıranların çoğu konuşma CAS'ı
  altında (`automation.ts:3111` claim sonrası, `:5510` uyarı geçişi, `:5610` öğe kipi) ve senkron kilidi altında → pratikte tek; eşzamanlı
  yol: öneri onayı (`ai-suggestions/act.ts:113`) + senkron geçişi aynı mesaj için. P3.
  Düzeltme (migration YOK): fonksiyonu tek işleme al, başına `pg_advisory_xact_lock(hashtext('task-dedupe:' || dedupeKey))` — kod tabanının
  `ai-suggestions/act.ts:91` deseni. (Hazır yama Y5 `docs/hazir-yamalar/2026-10-07-Y5-gorev-tekillestirme.patch` yalnız anahtarın
  KONUSUNU değiştiriyor, atomikliği değil.)
- **Yaşam döngüsü görevleri `createReservationTasks`:** tür başına var-mı okuması + `createMany`, kilitsiz (`automation.ts:1124-1207`).
  Eşzamanlı iki çağrı aynı rezervasyon için iki temizlik görevi açar. Çağıranlar: senkron (kilitli), elle takvim senkronu (KİLİTSİZ,
  §2.3), dosyadan içe aktarma (`reservations/import/route.ts:603, 683`), elle rezervasyon, **"Eksik görevleri oluştur"**
  (`POST /api/tasks/backfill` → `backfillReservationTasks`, `automation.ts:1257-1272`; kova 3/saat → iki eşzamanlı çalıştırma mümkün).
  **(DOĞRULANDI, P2):** backfill çift tık ya da backfill + senkron aynı anda → aynı rezervasyona iki temizlik görevi (temizlikçi iki kez
  gider / iki kez işaretler). Düzeltme (migration YOK): `createReservationTasks`'ı işleme al + `pg_advisory_xact_lock(hashtext('res-tasks:'
  || reservationId))`; backfill ucuna da `SystemLock "tasks-backfill:<org>"` (plan-change-pending deseni) → ikinci tık 409.
  ⚠️ Benzersiz kısmi dizin (`reservationId, type WHERE origin='system'`) DAHA güçlü ama dolu tabloda mevcut çiftler varsa açılışta
  patlar (CLAUDE.md "dolu tabloya @unique EKLEME") → önce salt-okuma sayım + temizlik kararı gerekir; danışma kilidi yeterli.
- **Test:** `Promise.all([createReservationTasks(id), createReservationTasks(id)])` → `task.count({reservationId}) === 2`; bugün 4 (kırmızı-önce).
  Backfill: `Promise.all` iki POST → aynı sonuç.

### 5.3 Söz (commitment) — `POST /api/conversations/[id]/commitments`
- **Koruma:** YOK (`guest-commitments.ts:41-84` — görev + söz + denetim kaydı tek işlem ama tekilleştirme yok; kova 60/saat).
- **Boşluk (DOĞRULANDI, P2):** çift tık → iki söz + iki "Misafire söz: havlu" görevi. Düzeltme: konuşma satırı kilidi + "aynı tür, aynı
  `dueAt`, açık söz var mı" kontrolü (migration YOK), ya da istemci kimliği (§7).

### 5.4 Elle konuşma oluşturma — `POST /api/conversations`
- **Koruma:** YOK (`conversations/route.ts` POST — düz `create` + `applyInboundMessageRules`).
- **Boşluk (DOĞRULANDI, P2):** ilk mesaj şikâyetse her istek: konuşmayı `problem` yapar, **acil "Şikâyet" görevi** açar ve **tüm sahip /
  yöneticilere "Acil Şikayet" e-postası** atar (`automation.ts:1380-1510`). Çift gönderim = iki konuşma + iki acil görev + iki acil e-posta.
  Düğme yükleme sırasında kilitli (`components/inbox/conversation-form.tsx:45,138`) → yalnız ağ tekrarı / yeniden gönderim. Düzeltme: §7.

### 5.5 Dosyadan içe aktarma — `POST /api/reservations/import` (.ics / .csv)
- **Koruma:** UID'li satır `@@unique([propertyId, sourceReference])` + P2002 = atla (`reservations/import/route.ts:685-691`); satır başına
  silme danışma kilidi + taze tombstone; önizleme yazmaz (`:475-495`); UID'siz satırda doğal anahtar (ad + giriş + çıkış) oku-sonra-yaz
  (`:440-463`).
- **Boşluk (DOĞRULANDI, P2):** UID'siz CSV (kimlik sütunu olmayan elle hazırlanmış tablo) AYNI ANDA iki kez aktarılırsa (çift tık, uzun
  süren istekte "Aktar"a yeniden basma) iki istek de "yok" görür → **çift rezervasyon + çift görev** (doğal anahtar benzersiz değil). Ardışık
  tekrar zaten korunuyor (ikinci istek ilkinin yazdığını görür). Düzeltme (migration YOK): aktarım başında `SystemLock
  "reservation-import:<propertyId>"` CAS (TTL 5 dk, bitince sil; plan-change-pending deseni `billing/plan-change/route.ts:131-152`)
  → ikinci eşzamanlı aktarım 409 "Bu daireye aktarım sürüyor". Kilit seri hâle getirince mevcut doğal anahtar kontrolü yeterli olur.
- **Test:** UID'siz 3 satırlık CSV ile `Promise.all` iki POST → `reservation.count === 3`; bugün 6.

### 5.6 Takvim kaynağı ekleme ve senkron
- **Ekleme `POST /api/properties/[id]/calendar-sources`:** mülk satırı `FOR UPDATE` + tavan 10 (`calendar-sources/route.ts`), ama AYNI
  adres iki kez eklenebilir. **(DOĞRULANDI, P3):** çift tık → aynı besleme iki kaynak; ikinci kaynağın UID'leri ilkinin satırlarıyla
  `@@unique` çakışır ve sessizce atlanır (`import/sync.ts:582-590`) → veri çiftlenmez ama ekranda iki kaynak, ikisi de "tamam" görünür,
  her geçişte besleme İKİ kez indirilir. Silme satırları sahipsiz bırakır (`calendar-sources/[id]/route.ts`: `calendarSourceId: null,
  channel: "manual"`), kalan kaynak onları "legacy" eşleşmesiyle benimser (`import/sync.ts:413-419`) → veri kaybı yok. Zarar düşük
  (kafa karışıklığı + çift indirme + iki kaynağın kayıp-uzlaştırma sayaçları ayrı). Düzeltme: aynı mülkte şifre çözülmüş adresi
  karşılaştırmak pahalı → `urlEnc` yanına deterministik HMAC (`urlHmac`, yeni NULL kolon + `@@unique([propertyId, urlHmac])`). Bu bir
  migration; bu önem için DEĞMEZ. Önerilen (migration YOK): ekleme işleminde (mülk satırı zaten kilitli) mülkün mevcut kaynaklarını
  çöz + karşılaştır (en çok 10 kaynak, ucuz) → aynı adres varsa mevcut kaynağı 200 ile döndür.
- **Senkron:** §2.3 (satırlar güvenli; görevler §5.2).

### 5.7 Mülk oluşturma ve QR açma
- **`POST /api/properties`:** plan tavanı olan planlarda işletme satırı `FOR UPDATE` (`properties/route.ts:85-92`) — tavanı korur ama
  çift tık iki aynı daire açar (tavan izin veriyorsa). P3 (kullanıcı siler; daire sayısı plan sınırından yer).
- **`POST /api/properties/[id]/chat` (QR aç):** "token yoksa üret" oku-sonra-yaz, KOŞULSUZ `update` (`properties/[id]/chat/route.ts`).
  **(DOĞRULANDI, P2):** iki eşzamanlı "aç" (iki sekme / ağ tekrarı) iki farklı jeton üretir, son yazan kazanır; yanıtlar ters sırada
  gelirse ev sahibi ÖLÜ jetonun QR'ını basar. QR fiziksel çıkartma ve `chatToken` rotasyonu bilinçli olarak YOK → misafir 404 görür,
  çıkartma yeniden basılır. Düzeltme (migration YOK, 2 satır): `updateMany({ where: { id, chatToken: null }, data: { chatToken } })` sonra
  satırı yeniden oku ve OKUNAN jetonu döndür.
- **Test:** `Promise.all` iki `enabled:true` → iki yanıtın `chatToken`'ı EŞİT ve DB'deki ile aynı.

## 6. Hesap silme, dışa aktarma, misafir silme, deneme kimliği, diğer

- **Hesap silme `POST /api/account/delete`:** parola + abonelik kapısı işlem DIŞINDA, ama silme işleminin ilk adımı sahibin satırını
  `FOR UPDATE` + `sessionEpoch` ile yeniden doğruluyor (`account/delete/route.ts:79-90`). Çift tıkın kaybedeni hiçbir şey silmez,
  `session_revoked` döner (CLAUDE.md "çift tıklamanın kaybedeni 400 sözleşmesi" pinli). SAĞLAM.
- **Dışa aktarma `GET /api/account/export`:** salt okuma; kova 3/saat (`account/export/route.ts`). Çift tık = iki indirme + iki denetim
  satırı. Zarar yok. P3.
- **Misafir silme `POST /api/reservations/[id]/erase` (bayrak KAPALI):** tombstone `createMany skipDuplicates` + zorunlu denetim kaydı aynı
  işlemde, silme danışma kilidi (`lib/erasure.ts:636-711`). İkinci çalıştırma yeniden maskeler (zararsız), ikinci denetim satırı yazar
  (yasal iz açısından fazlası zararsız). SAĞLAM.
- **Deneme kimliği (bayrak KAPALI):** `TrialIdentity.keyHash @unique` (`schema.prisma:1644`) + `createMany skipDuplicates` + kaynak başına
  `trialIdentityCheckedAt` CAS'ı ve hata dalında koşullu geri alma (`lib/billing/trial-identity.ts:174, 212, 262-270`). SAĞLAM.
- **Deneme hatırlatma e-postaları:** `trialEndingSentAt / trialEndedSentAt` CAS'ı (`lib/billing/trial-reminders.ts:94-140`). SAĞLAM.
- **Demo talebi `POST /api/leads`:** korumasız `create` + operatöre e-posta (günlük tavanlı, `lead-notify-budget`). Çift gönderim = iki
  Lead satırı + iki operatör e-postası. Müşteriye etkisi yok. P3.
- **Yükleme `POST /api/upload`:** çift tık iki nesne (biri sahipsiz). Saklama maliyeti, P3.
- **Ücretli tekrarlar (P3, maliyet):** `conversations/[id]/ai-suggest`, `translate-message`, `hazirlik/summary`, `settings/test-email`,
  `admin/quality-audit` — çift tık iki model / e-posta çağrısı; hepsi kovalı, çoğu günlük bütçeli. İdempotency gerekmez; istemci düğme kilidi yeter.
- **PATCH / PUT uçları:** "değeri şuna ayarla" anlamında (ayarlar, mülk, KB düzenleme, stok `hazirlik/stock`, ev kuralları, gecelik
  aralık…) → aynı isteğin tekrarı aynı son durumu verir (doğası gereği idempotent). `increment` kullanan tek yerler epoch / sürüm / deneme
  sayaçları ve QR günlük sayacı (kalkandan sonra). Görev PATCH'i satır kilidi + kontrol listesi çakışması 409 (`tasks/[id]/route.ts:139-191`).
  **Kayıp güncelleme** (iki sekme, eski içerikle kaydetme) ayrı bir sınıf: KB düzenleme son-yazan-kazanır (`kb/[id]/route.ts`, sürüm
  kontrolü yok) → Wi-Fi şifresini yeni sekmede düzelten ev sahibinin değişikliği eski sekmeden "kaydet" ile geri gelebilir. P2,
  idempotency değil eşzamanlılık; düzeltme `expectedUpdatedAt` (istemci okuduğu `updatedAt`'i yollar, `updateMany where updatedAt =` →
  0 satırsa 409 "başka yerde değişti"). Karar kartı ve görev uçları bu deseni zaten kullanıyor.
- **DELETE uçları:** ikinci istek 404 (kayıt yok) — zararsız. Mülk / konuşma silme kuyruğu aynı işlemde iptal ediyor (F03).

## 7. Yeniden kullanılabilir desen — ne yapalım?

### 7.1 Kod tabanında bugün var olan beş desen (iyi olanlar)
1. **Durum CAS'ı** (`updateMany where durum = beklenen`): oto-cevap, yaşam döngüsü damgaları, karar kartı `version`, taslak `pending`,
   2FA, e-posta kuyruğu. Bir varlığın DURUM geçişi olan her eylemde doğru araç.
2. **Doğal anahtar + benzersiz dizin + P2002 yutma**: rezervasyon UID, mesaj `externalId`, fatura, webhook olayı, sinyal, öğe.
3. **Danışma kilidi / satır kilidi** (`pg_advisory_xact_lock`, `FOR UPDATE`): öneri onayı, QR konuşma kilidi, silme kilidi, mülk / işletme
   satırı. Yarışı SIRAYA koyar; tekilleştirmeyi ancak kilit altında "var mı" kontrolüyle birlikte yapar.
4. **`SystemLock` talebi** (TTL'li ad = kilit): elle gönderim kalkanı, QR `requestId`, plan değişikliği `jti`, ödeme işleniyor, senkron.
5. **İstemci istek kimliği**: elle cevap (kuyruk açıkken), QR, KB (migration 67). Doğru yön; ama üç farklı şekilde uygulanmış ve
   yalnız 3 uçta.

**Eksik olan:** "yeni bir şey OLUŞTURAN" uçların (rezervasyon, görev, konuşma, söz, şablon, KB kopya, talimat) ortak bir istek kimliği
mekanizması. Bunlarda durum CAS'ı olacak bir "önceki durum" yok, doğal anahtar da yok (elle girilen veri) → tek doğru araç istemci kimliği.

### 7.2 Büyük şirketler ne yapıyor (kaynaklar §10)
- **Stripe:** tüm POST'lar `Idempotency-Key` başlığı alır; ilk isteğin durum kodu + gövdesi saklanır (500 dahil), aynı anahtar aynı sonucu
  döner; parametreler farklıysa hata; doğrulama hatası ve EŞZAMANLI çakışan istek sonucu saklanmaz (yeniden denenebilir); anahtar en çok
  255 karakter; en az 24 saatlik anahtarlar otomatik silinebilir, silinen anahtar yeni istek sayılır.
- **AWS (Builders' Library, EC2 `ClientToken`):** istemcinin verdiği istek kimliği API sözleşmesinin parçasıdır; "aynı çağıran + aynı
  kimlik = aynı istek". Parametre özetiyle sentetik kimlik ÖNERİLMEZ (kasıtlı iki aynı istek yanlışlıkla birleşir — bizim 120 sn'lik
  gövde-özeti kalkanının bilinen kusuru: "Teşekkürler"i 2 dk içinde ikinci kez yazamamak). Kimliği kaydetmek ile asıl değişikliği yapmak
  birlikte ACID olmalı. SDK'lar ağ hatasında kendiliğinden yeniden dener — kimlik bu yüzden şart.
- **Shopify:** anahtarlar 24 saat izlenir; ilk istek sürerken gelen kopya `IDEMPOTENCY_CONCURRENT_REQUEST`, başarıdan sonra gelen kopya
  önbellekteki yanıtı alır — yanıt veritabanı kayıtlarından YENİDEN KURULUR (birebir aynı olmayabilir). Her çağrıda yeni rastgele UUID
  üretmek korumayı boşa çıkarır; anahtarı sayfa yüklenince ve başarıdan sonra yenileyin.
- **Resend (bizim e-posta sağlayıcımız):** `POST /emails` `Idempotency-Key` alır, 24 saat tekilleştirir, en çok 256 karakter, aynı anahtar
  farklı gövdeyle işaretlenir.
- **IETF taslağı `draft-ietf-httpapi-idempotency-key-header`** (HTTPAPI WG, etkin taslak, -07 Ekim 2025): başlığı standartlaştırıyor;
  henüz RFC değil.
- **brandur.org (Stripe mühendisi, "Stripe-like Idempotency Keys in Postgres"):** kullanıcı + anahtar benzersiz satır; yalnız YEREL
  ACID değişiklik yapan uçta anahtarı iş ile AYNI işlemde yazmak yeter; dış yan etki (ödeme, e-posta) olan uçta "kurtarma noktaları"
  gerekir; sonraki notunda anahtar ömrünü 24 saat yerine 1 saate indirdiğini yazıyor; eşzamanlı kopyaya ve farklı gövdeye 409.
- **Tarayıcı gerçeği:** RFC 9110 bağlantı yanıt gelmeden kapanırsa POST'un kendiliğinden yeniden denenmesine izin veriyor; Chromium
  yeniden kullanılan canlı bağlantıda yanıt başlığı gelmeden kopma olursa isteği yeniden yolluyor (2014 değişikliği; güncel kod yolu
  doğrulanmadı — ŞÜPHELİ). Yani "düğmeyi kilitledik" tek başına çift POST'u engellemez.

### 7.3 Önerim: "istek defteri" — Stripe'ın yanıt önbelleği DEĞİL, AWS `ClientToken` + Shopify "kayıttan yeniden kur" karması
**Neden Stripe'ın tam kopyası değil:** Stripe yanıt GÖVDESİNİ saklar. Bizim yanıtlarımız misafir adı / telefonu / mesaj metni taşır →
yeni bir kişisel veri deposu olur (KVKK: saklama süresi, silme talebinde kapsam, `anonymizeOldGuestData` / `maskReservationRows` bacağı,
kanarya listesi — "Scrub kapsamı kuralı: misafir metni taşıyan her kolon" kalıcı kararı). Ayrıca 500'ü de önbelleğe almak bizim "kesin
hata → yeniden dene" sözleşmemizle çelişir.

**Tasarım (yalnız İŞARETÇİ saklar, PII yok):**
- Tablo (yeni tablo → dolu tabloya `@unique` kuralı geçerli değil; additive):
  `RequestLedger { organizationId (FK Cascade), scope (ör. "reservation.create"), requestId, payloadHash (HMAC, kısa), resultRef
  (ör. "reservation:<id>"), createdAt; @@unique([organizationId, scope, requestId]); @@index([createdAt]) }`.
- Yardımcı (`src/lib/request-ledger.ts`, yaprak modül):
  `withRequestLedger(tx, { organizationId, scope, requestId, payload }, create: () => Promise<{ ref: string }>)` →
  ① aynı işlemin İÇİNDE önce defter satırını INSERT et (benzersiz dizin) ② başarıysa asıl kaydı oluştur, `resultRef`'i yaz ③ P2002 →
  işlem geri alınır; dışarıda defter satırını oku: hash farklıysa 409 "Bu istek kimliği farklı bir içerikle kullanılmış" (kod tabanında
  zaten 2 yerde aynı metin: `conversations/[id]/reply/route.ts:111`, `chat/[token]/route.ts:651`), aynıysa `resultRef`'teki kaydı veritabanından okuyup **200 ile döndür** (Shopify gibi yeniden kurulmuş yanıt).
  PostgreSQL'de ikinci eşzamanlı INSERT birincinin işlemi bitene kadar BEKLER, sonra P2002 alır → "işleniyor" durumu ve kilit süresi
  GEREKMEZ (Stripe'ın `locked_at` karmaşası yok), çünkü iş tamamen yerel ve tek işlemde.
- Yan etkiler (e-posta, görev) işlemden SONRA ve yalnız kazanan istekte koşar (kaybeden erken döner) → bugünkü "en çok bir kez"
  davranışı korunur.
- Dış gönderim (misafire mesaj) bu deftere GİRMEZ: orada niyet teslimden ÖNCE yazılmalı → doğru araç kalıcı kuyruk (`MessageOutbox`,
  zaten aynı desen) ya da §1.1'deki 24 saatlik `SystemLock` işareti.
- İstemci: mevcut `requestIdRef` deseni (`conversation-thread.tsx:269-281`) tek bir kancaya (`useRequestId(payload)`) çıkarılır; gövdede
  `requestId` (mevcut doğrulayıcı `^[A-Za-z0-9-]{8,64}$`, `validators.ts:143`). Başlık (`Idempotency-Key`) şimdilik GEREKMEZ — dış API yok,
  tüm istemciler bizim; Airbnb/ortak API açıldığında başlık takma ad olarak eklenir (IETF taslağı).
- **Göç yolu (migration'sız ilk adım mümkün):** aynı yardımcı ilk sürümde `SystemLock` üstüne kurulabilir (ad `req:<scope>:<org>:<requestId>`,
  `holder` = `<hash>|<resultRef>`, `lockedUntil` = +24 sa; satırı iş ile AYNI işlemde yaz; saatlik süpürgeye `req:` öneki eklenir,
  `scheduled-sync.ts:833-867`). Bedeli: `SystemLock` kilit + durum + defter karışık kullanım; kuruluş silinince satırlar 24 saat kalır
  (yalnız kimlik içerir). Kurucu temiz şema isterse ikinci adımda `RequestLedger` tablosu (1 migration, taze `pg_dump` + onay kuralı).

**Maliyet / saklama / KVKK:**
- Hacim: oluşturma uçlarına günde en çok birkaç yüz istek (10 daire, ~10 kuruluş) → satır başına ~150 bayt, 24 saatte ≪ 1 MB. İstek başına
  +1 INSERT (aynı işlemde, ~1 ms). İndeks bakımı ihmal edilebilir.
- Saklama: **24 saat** (Stripe / Shopify / Resend ile aynı; istemci tekrarları dakikalar içindedir). Saatlik süpürge `createdAt < now-24h`
  siler. Daha kısa (1 sa, brandur) da yeterli olabilir; 24 saat "ertesi sabah sekmeyi açıp yeniden bas" vakasını da kapsar.
- KVKK: satırda misafir verisi YOK (kimlik rastgele UUID, `resultRef` iç kimlik, gövde yerine HMAC — düz SHA-256 değil, çünkü kısa misafir
  metninin özeti sözlükle geri çevrilebilir). Kuruluş silinince `onDelete: Cascade`. Misafir silme (erasure) kapsamına girmesine gerek yok
  (işaret ettiği satır zaten maskelenir; 24 saatte kendiliğinden silinir). Dışa aktarma kapsamı dışı (iç işletim verisi): yeni model
  `tests/unit/data-export-coverage.test.ts:40-84` envanterinde `EXCLUDED`a gerekçeyle eklenmek ZORUNDA (test yeni modeli fail-closed
  yakalar; `SystemLock` zaten orada "işaret satırı" gerekçesiyle).

### 7.4 Neden "her tabloya `clientRequestId`" (migration 67 deseni) yerine tek defter
- Migration 67 deseni tek tablo için mükemmel (atomik, ek durum yok) ama 6-7 tablo için 6-7 migration + 6-7 benzersiz dizin + her rotada
  aynı 30 satır kopya. Defter tek migration (ya da sıfır), tek test kümesi, tek süpürge.
- KB'de migration 67 KALSIN (zaten canlıda, kalem başına kimlik doğal); yeni uçlar deftere bağlanır. KB kopyalama 67'yi `copy:` önekiyle
  kullanabilir (§4.2) — deftere de bağlanabilir; ikisi de doğru, 67 migration'sız.

## 8. Sıralı düzeltme listesi (P0 önce)

**P0: YOK.** Para (Paddle webhook, fatura, plan değişikliği), oto-cevap, karşılama/giriş/çıkış mesajları, karar kartı, kuyruk yeniden deneme,
kimlik akışları ve hesap silme çift uygulamaya karşı korunuyor (CAS + benzersiz dizin + kilit). Sıradan çift tıkla misafire çift mesaj
ya da çift ücret çıkaran bir yol bulunmadı.

| # | Önem | Yer | Zarar | Düzeltme | Migration | Kurucu? |
|---|---|---|---|---|---|---|
| 1 | P1 | Elle cevap, kuyruk kapalı (`host-send.ts:101`, `reply/route.ts:89`) | yanıtı kaybolan mesajın >2 dk sonra aynı kimlikle tekrarı → **misafire çift mesaj** | `requestId`'li `claimKeyedOutboundSend` + başarıda 24 sa işaret, tekrar → 200 "zaten gitti"; çeviriyi kalkandan sonraya al | YOK | EVET (misafire gideni etkiler) — S1 |
| 2 | P1 | KB ekleme 3 ekran (`kb-manager.tsx:174`, `kb-template-suggestions.tsx:69`, `kb-past-answers.tsx:98`) | ağ hatası sonrası yeniden bas → iki aynı KB kalemi → biri düzeltilince yapay zekâ eskisini de okuyabilir | `kb-import-text.tsx`'in `requestIdFor` deseni; sunucu hazır (migration 67) | YOK | 10-14 kararının kapsamı → yap, haber ver |
| 3 | P1 | KB kopyalama (`kb/[id]/copy/route.ts`) | çift tık → her hedef dairede iki kalem | istek kimliği → hedef başına `clientRequestId = "copy:<id>"` (67'nin dizini) | YOK | aynı |
| 4 | P1 | Elle rezervasyon (`reservations/route.ts:30-76`) | iki rezervasyon + 4 görev + tüm yöneticilere 2× e-posta + kendi kopyasıyla sahte takvim çakışması | istek defteri (§7.3) | 0 (SystemLock) / 1 (tablo) | EVET — S2 |
| 5 | P2 | Yaşam döngüsü görevleri `createReservationTasks` (`automation.ts:1124-1207`) + "Eksik görevleri oluştur" (`tasks/backfill`) | aynı konaklamaya iki temizlik görevi | işlem + `pg_advisory_xact_lock('res-tasks:'+id)`; backfill'e `SystemLock` talebi | YOK | yap, haber ver |
| 6 | P2 | Elle konuşma (`conversations/route.ts` POST) | şikâyet ilk mesajında 2× acil görev + 2× "Acil Şikayet" e-postası | istek defteri | 0/1 | S2 ile |
| 7 | P2 | UID'siz CSV aktarımı (`reservations/import/route.ts:440-463`) | eşzamanlı iki aktarım → çift rezervasyon + görev | `SystemLock "reservation-import:<mülk>"` talebi, ikinci 409 | YOK | yap, haber ver |
| 8 | P2 | QR açma (`properties/[id]/chat/route.ts`) | iki "aç" → ölü jetonlu QR çıkartması basılabilir | `updateMany where chatToken: null` + yeniden oku | YOK | yap, haber ver |
| 9 | P2 | Mülk talimatı ekle (`history-learn/service.ts:559-590`) | iki aynı etkin talimat (isteme iki kez girer) | kilit altında aynı metin varsa onu döndür (`reviewComparison` emsali) | YOK | yap, haber ver |
| 10 | P2 | Söz ekle (`guest-commitments.ts:41-84`) | iki söz + iki görev | konuşma kilidi + "aynı tür + `dueAt` açık söz" kontrolü, ya da defter | YOK | yap, haber ver |
| 11 | P2 | Kayıt ardışık tekrarı (`auth/register/route.ts:124-168`) | yeni kullanıcıya "zaten hesabınız var" e-postası | son 15 dk + doğrulanmamış + aynı istemci → bildirimi atla (zamanlama paritesiyle) | YOK | EVET (kimlik akışı) — S4 |
| 12 | P2 | KB düzenleme kayıp güncelleme (`kb/[id]/route.ts`) | eski sekmeden kaydet → düzeltilmiş Wi-Fi şifresi geri döner | `expectedUpdatedAt` CAS → 409 | YOK | EVET (arayüz davranışı) — S5 |
| 13 | P3 | E-posta kuyruğu artığı (`email-core.ts:82-87`) | nadir çift kimlik e-postası | Resend `Idempotency-Key: email-outbox/<satır id>` | YOK | EVET (e-posta akışı) — S6 |
| 14 | P3 | QR kalkanı TTL 120 sn (`outbound-claim.ts:25`) vs. uzun QR işlemi | >120 sn süren istekte tekrar = çift işleme | QR için TTL'i istek üst sınırına çıkar (ör. 300 sn) | YOK | yap, haber ver |
| 15 | P3 | Yapay zekâ görevi oku-sonra-yaz (`tasks/create.ts:49-58`) | nadir çift görev | `pg_advisory_xact_lock('task-dedupe:'+dedupeKey)` | YOK | yap, haber ver |
| 16 | P3 | Diğer: elle görev, şablon, mülk, onay kaydı, 2FA kurulum, QR "yapay zekâyı aç", QR ev sahibi cevabı, demo talebi, yükleme, aynı takvim adresi, çeviri çift ücreti | kozmetik / maliyet | istek defteri ya da küçük CAS; acele yok | — | — |

**Önerilen sıra:** 2-3 (istemci, bugün) → 5, 7, 8, 9, 10, 14, 15 (migration'sız sunucu, tek dilim) → 1 (S1 onayıyla) → istek defteri + 4, 6
(S2 onayıyla) → 11, 12, 13 (onaylarla). Her biri K2: kırmızı-önce + kaldırma mutasyonu (`scripts/mutation-run.mjs`) + gerçek PG eşzamanlılık
testi (`Promise.all`, `tests/integration/kb-create-request-id.test.ts` / `register-race.test.ts` / `ai-action-suggestions.test.ts` deseni) +
tam kapılar. Prisma temsilcisine `vi.spyOn` gereken yarış testleri AYRI dosyada (`kb-create-request-id-race.test.ts` emsali).

## 9. Kurucuya sorular (öneri biçiminde)

**S1 — Elle cevapta "zaten gitti" hafızası**
- *Bunu böyle yapıyorum:* çift tıkı 2 dakikalık "aynı metin" kalkanıyla durduruyorum; mesajın kendi istek kimliği (tarayıcı her mesaja
  bir kimlik veriyor) kalıcı kuyruk kapalıyken HİÇ kullanılmıyor.
- *Büyük şirketler:* Stripe / AWS / Shopify isteğin kimliğini 24 saat hatırlar; aynı kimlik tekrar gelirse işi ikinci kez yapmaz, ilk
  sonucu döndürür.
- *Önerim:* mesaj gerçekten gittiyse kimliğini 24 saat hatırlayalım; aynı kimlikle gelen tekrar "zaten gönderildi" alsın, misafire ikinci
  kez gitmesin. Migration yok.
- *ÖRNEK:* ev sahibi telefonda "Saat 15:00'te kapıda olacağım" yazıp Gönder'e basıyor, asansörde bağlantı kopuyor, ekran "doğrulanamadı,
  kontrol edin" diyor; 3 dakika sonra "Tekrar dene"ye basıyor → **bugün:** misafir aynı mesajı İKİ kez alıyor · **sonra:** misafir bir
  kez alır, ekran "Mesaj zaten gönderilmişti" der.
- *Böyle yapalım mı?*

**S2 — Ortak "istek defteri" (rezervasyon, konuşma, söz, görev, şablon ekleme)**
- *Bunu böyle yapıyorum:* yeni kayıt açan bu uçlarda tekrar koruması yok; yalnız düğme gönderim sırasında kilitleniyor.
- *Büyük şirketler:* AWS her "oluştur" çağrısına istemci kimliği (ClientToken) koyar; Shopify kimliği 24 saat tutar, tekrar gelirse aynı
  kaydı döndürür.
- *Önerim:* tek bir küçük defter: (işletme, işlem türü, istek kimliği) → oluşan kaydın kimliği; 24 saat sonra silinir, misafir verisi
  TUTMAZ. İlk adım migration'sız (mevcut sistem kilidi tablosu), istersen ikinci adımda kendi tablosu (1 migration, taze yedek + onay).
- *ÖRNEK:* ev sahibi elle rezervasyon girip Kaydet'e basıyor, sayfa 10 sn dönüp hata veriyor, yeniden basıyor → **bugün:** iki
  rezervasyon, iki giriş hazırlığı + iki temizlik görevi, ekipteki herkese iki "Yeni Rezervasyon" e-postası, takvimde kendisiyle
  "çakışma" · **sonra:** tek rezervasyon, ikinci basış "kaydedildi" der.
- *Böyle yapalım mı? Migration'sız başlayalım mı, doğrudan ayrı tablo mu?*

**S3 — Görev çiftleri ve dosya aktarımı (migration'sız, misafire etkisi yok)** — kural gereği sorulmadan yapılıp haber verilebilir;
  bilgi olarak: "Eksik görevleri oluştur"a iki kez basmak ya da takvimi elle senkronlarken otomatik senkronun da koşması aynı konaklamaya
  iki temizlik görevi açabiliyor; kilitle tekleştiriyorum. Aynı CSV'yi aynı anda iki kez aktarmak ikinci isteğe "aktarım sürüyor" der.

**S4 — Kayıtta tekrar e-postası (kimlik akışı)**
- *Bunu böyle yapıyorum:* aynı e-postayla ikinci kayıt isteği gelirse adres sahibine "bu adresle zaten hesabınız var" e-postası atıyorum
  (hesabın varlığını sızdırmamak için yanıt aynı).
- *Büyük şirketler:* aynı yaklaşım (yanıt aynı, bildirim e-postası) + tekrar istekleri kısa süre tanıyıp bildirim atmamak.
- *Önerim:* son 15 dakikada AYNI tarayıcıdan açılmış, henüz doğrulanmamış hesaba gelen tekrar → bildirim atılmasın; yanıt yine aynı.
- *ÖRNEK:* yeni ev sahibi "Kayıt ol"a basıyor, bağlantı yavaş, bir daha basıyor → **bugün:** iki e-posta alıyor: "e-postanızı doğrulayın"
  + "bu adresle zaten bir hesabınız var" (kafası karışıyor) · **sonra:** yalnız doğrulama e-postası.
- *Böyle yapalım mı? (ilk denemeler birlikte)*

**S5 — Bilgi tabanında eski sekmeden kaydetme**
- *Bunu böyle yapıyorum:* son kaydeden kazanır.
- *Büyük şirketler:* Google Docs / Notion gibi çakışmayı fark eder; REST'te `If-Match` / sürüm kontrolü (HTTP standardı) ile "bu kayıt siz
  açtıktan sonra değişti" der.
- *Önerim:* kaydederken açtığın andaki sürümü yollayalım; arada değiştiyse "Bu bilgi başka yerde güncellendi, sayfayı yenileyin" uyarısı.
- *ÖRNEK:* ev sahibi Wi-Fi şifresini telefondan "Lale_2026" yapıyor; bilgisayarda açık kalmış eski sekmede başka bir satırı düzeltip
  kaydediyor → **bugün:** şifre eski hâline döner, yapay zekâ misafire ESKİ şifreyi verir · **sonra:** bilgisayar "başka yerde güncellendi"
  der, eski şifre geri gelmez.
- *Böyle yapalım mı?*

**S6 — E-posta sağlayıcısına tekrar kimliği (Resend `Idempotency-Key`)**
- *Bunu böyle yapıyorum:* kimlik e-postaları kuyruktan "en az bir kez" gider; nadiren (süreç tam gönderim anında düşerse) ikinci kopya
  gidebilir.
- *Büyük şirketler:* Resend'in kendisi 24 saatlik tekrar kimliği sunuyor; Stripe e-posta / ödeme çağrılarında aynı.
- *Önerim:* her kuyruk satırının kimliğini sağlayıcıya tekrar kimliği olarak yollayalım (tek satır).
- *ÖRNEK:* şifre sıfırlama e-postası gönderilirken sunucu yeniden başlıyor → **bugün:** kullanıcı aynı kodlu iki e-posta alabilir ·
  **sonra:** tek e-posta.
- *Böyle yapalım mı?*

## 10. Kaynaklar
- Stripe — Idempotent requests: https://docs.stripe.com/api/idempotent_requests (255 karakter, ≥24 sa sonra silinebilir, ilk sonuç 500 dahil
  saklanır, eşzamanlı çakışan ve doğrulama hatası saklanmaz) · ayrıca https://stripe.com/docs/idempotency
- AWS Builders' Library — Making retries safe with idempotent APIs: https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- Shopify — Implementing idempotency: https://shopify.dev/docs/api/usage/implementing-idempotency (24 sa, `IDEMPOTENCY_CONCURRENT_REQUEST`,
  yanıt kayıttan yeniden kurulur) · changelog: https://shopify.dev/changelog/making-idempotency-mandatory-for-inventory-adjustments-and-refund-mutations
- Resend — Idempotency keys: https://resend.com/docs/dashboard/emails/idempotency-keys · https://resend.com/changelog/idempotency-keys ·
  https://www.resend.com/blog/engineering-idempotency-keys
- IETF — The Idempotency-Key HTTP Header Field (etkin taslak -07): https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- brandur.org — Implementing Stripe-like Idempotency Keys in Postgres: https://brandur.org/idempotency-keys · not: https://www.brandur.org/fragments/idempotency-keys-crunchy
- Tarayıcı POST yeniden denemesi: Chromium değişikliği https://codereview.chromium.org/403393003 · Go sorunu https://github.com/golang/go/issues/22158
  (güncel Chromium kod yolu doğrulanmadı — ŞÜPHELİ)
- Not: WebFetch bu ortamda DNS hatası verdi (`ENOTFOUND`); yukarıdaki ayrıntılar arama sonuç özetlerinden alındı, sayfalar doğrudan
  açılamadı. Uygulamadan önce Stripe 24 sa ifadesi resmi sayfadan teyit edilmeli.
