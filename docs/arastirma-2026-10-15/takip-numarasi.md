# Takip numarası — sonraki dilimlerin tasarımı (derin araştırma, 2026-10-15)

> Hazırlayan: Opus 5.5 alt ajanı (salt-okuma; kod yazılmadı, test / veritabanı koşulmadı). Kaynak: `docs/TASARIM-2026-10-10-correlation-id-takip-numarasi.md`
> (§5 kurucu kararları, §6 uygulama durumu) + kodun bugünkü hâli (dal ucu `72feb52`). Satır numaraları bu commit'e göredir.
> Belge İLERLEDİKÇE yazıldı; her bölümün sonu "bulgu kodla doğrulandı" demektir. Kurucuya giden sorular §15'te, kurucunun biçiminde.

---

## 0. Kısa özet

- **Bugün:** numara üretimi, kimlikli rotalar, hata raporu + Sentry etiketi, ödeme zinciri (onay → webhook), arka plan işleri ve operatör
  araması (yalnız numarayla) çalışıyor. Kayıt yalnız-ekle, 90 gün, kapalı küme, kişisel veri yok.
- **En önemli boşluk:** "ödemem geçmedi" vakasında (kart reddi) müşterinin elinde numara YOK — numara yalnız bizim sunucu 5xx'inde çıkıyor.
  İkincisi: otomatik cevap zincirinde mesaj / deneme başına numara yok; kuyruk işçisi satıra YENİ numara veriyor (zincir kopuyor).
- **Önerilen sıra:** A destek ekranı v2 (numara + konuşma bağlantısı + işletme / 24 saat, zorunlu amaç) → B ödeme tamamlama (kart reddinde
  numara, `billing.payment.failed`) → C otomatik cevap zinciri (deneme başına numara, `parentId`, kuyruk satırı numarayı taşır) → G Sentry
  etiketleri → D QR → E geçmişten öğren + bilgi tabanı → F hesap silme + e-posta kuyruğu → H bütünlük mührü + KVKK.
- **Veri modeli:** tek migration 67, hepsi boş bırakılabilir sütun + dizin (OperationalEvent `subjectId`/`parentId`; WebhookEvent,
  MessageOutbox, RiskEvent, HistoryLearnRun `correlationId`); H için ayrı 68 (`OperationalEventDigest`).
- **Hacim:** bugün ~130 satır/gün (~8 MB / 90 gün); 1.000 dairede ~0,9 M satır (~560 MB); 10.000 dairede ~8,6 M satır (~5,6 GB) — maliyet
  aylık birkaç sent–1,5 $; asıl dikkat Hobby 5 GB tavanı ve süpürge.
- **Kurucu soruları:** F1–F8 (§15). Müşteriye giden tek yeni metin F2 (kart reddi).

---

## 1. Bugün ne var (kodda ölçüldü)

| Parça | Yer | Not |
|---|---|---|
| Numara üretimi + bağlam | `src/lib/correlation.ts:30-87` | `AsyncLocalStorage`; numara YALNIZ sunucuda; `adoptCorrelation` yalnız sunucunun yazdığı satırdan okunan numarayla |
| Kimlikli rotalar | `src/lib/route-guard.ts:43-67` | her istek yeni numara; yanıt başlığı `X-Correlation-ID`; `showToUser` yalnız `/api/billing/` (`correlation.ts:75`) |
| 500 metni | `src/lib/api.ts:203-213` | numara yalnız ödeme uçlarında gövdede (`correlationId`) + kısa biçim metinde |
| Olay günlüğü (tek yazıcı) | `src/lib/event-log.ts:164-187` | kapalı küme olay adı (`:21-40`), izinli anahtar + anahtar başına kalıp (`:48-72`), sınıf başına dakikalık tavan (`:105-109`), 0,5 sn yazım bekleme, asla fırlatmaz |
| Tablo | `prisma/schema.prisma:908-922`, migration 63 | `OperationalEvent(id, correlationId, organizationId?, event, level, dataJson?, createdAt)`; 3 dizin; FK `onDelete: Cascade` |
| Bütünlük | migration 63 (UPDATE tetikleyicisi) + 64 (DELETE yalnız 89+ gün ya da işletme silinmişse; TRUNCATE yasak) | uygulama yalnız ekler |
| Saklama | `event-log.ts:190-197` | 90 gün süpürge |
| Hata raporu | `src/lib/report-error.ts:19-29`, `report-error-core.ts:54-124` | log satırı `[takip …]`, Sentry etiketi `correlation_id`, alarm e-postasında numara, `error.reported` satırı (bağlamın yalnız ilk kod belirteci) |
| Sentry | `report-error-core.ts:169-222` | SDK'sız zarf (envelope) istemcisi; tek etiket `correlation_id`; `environment` = `NODE_ENV`; `release` / `server_name` / işletme etiketi YOK |
| Ödeme zinciri | `api/billing/consent/route.ts:105,109` · `api/billing/checkout-pending/route.ts:33,38` · `api/webhooks/paddle/route.ts:523-542,625-675` · `payments/paddle.ts:274,283` | onay satırı numarayı taşır; webhook `custom_data.consentId` ile SATIRI bulur, numarayı satırdan alır (tazelik kuralıyla) |
| Arka plan (2. dilim) | `api/cron/sync/route.ts:41-58` · `scheduled-sync.ts:504-723` · `outbox/worker.ts:1440-1460` · `email-outbox.ts:194` | senkron geçişi tek numara; işletme işlemesi kendi numarası (`job.org.processed`); giden kuyruk SATIR BAŞINA YENİ numara (`job.outbox.row`); e-posta kuyruğu boşaltımı tek numara |
| Operatör araması | `api/admin/events/route.ts` · `components/admin/event-search.tsx` · `admin/page.tsx:584-591` | kısa / tam numara; süper-admin + 2FA; bürünmede yasak; `sec-fetch-site`; saatte 60; ZORUNLU denetim kaydı (sonuç dönen her işletmenin kaydına da); JSON indir |
| Müşteriye gösterim | `components/tracking-number-copy.tsx` · `settings/paddle-plans.tsx:271,323,369,422,668` | yalnız ödeme ekranı, yalnız sunucu 5xx'inde |

### 1.1 Okurken bulduğum boşluklar (kod satırıyla)

1. **"Ödemem geçmedi" vakasında müşterinin elinde numara YOK.** Numara ekrana yalnız BİZİM sunucumuz 5xx verince çıkar
   (`api.ts:206`). Kart reddi Paddle'ın kendi penceresinde olur; `paddle-plans.tsx:188-206` yalnız `checkout.completed`i dinler,
   hata olayını dinlemez. Zincir veritabanında VAR (onay satırının numarası `N`; `transaction.payment_failed` webhook'u
   `adoptConsentChain` ile `N`'ye katılır, `webhooks/paddle/route.ts:625`), ama müşteri `N`'yi hiç görmez. Yani kurucunun örnek
   cümlesi ("ödemem geçmedi, numara X") bugün yalnız sunucu hatasında mümkün. → Dilim 1'de çözüm (§3).
2. **`billing.webhook.processed` olayı ödemenin SONUCUNU söylemez** — yalnız `eventType` (`route.ts:671`). `transaction.payment_failed`
   geldiğinde operatör "processed" görür; "başarısız ödeme" yazan ayrı bir olay yok. Paddle'ın ret kodu (`error_code`, ör.
   `declined`) da yazılmıyor. → Dilim 1.
3. **`WebhookEvent` ve `Invoice` satırları numara taşımaz** — arama yalnız `OperationalEvent` + `CheckoutConsent` döner
   (`event-log.ts:209-235`). Olay günlüğü 90 günde silinir; `WebhookEvent` kalıcıdır. 90 günden sonra zincir kopar. → Dilim 1
   (isteğe bağlı kolon).
4. **Otomatik cevap zincirinde mesaj başına numara YOK.** `scheduled-sync.ts:504` işletmenin bütün işlemesine TEK numara verir
   (25 konuşmaya kadar, `automation.ts:4056`); `outbox/worker.ts:1440` ise kuyruk satırını YENİ bir numarayla işler → kuyruğa
   yazan geçişle gönderen işçi FARKLI numaralarda. "Bu misafire neden cevap gitmedi" sorusu tek numarayla izlenemiyor. → Dilim 2.
5. **Arama yalnız numarayla.** Otomatik cevap / QR / hesap silme gibi zincirlerde müşteriye numara gösterilmiyor (kurucu kararı);
   operatörün başlangıç noktası numara değil "işletme + zaman" ya da "konuşma". Bugün ters arama yok. → Dilim 0 (destek ekranı).
6. **Sentry'de yalnız `correlation_id` etiketi var**; `release`, alan (`area`), işletme sınıfı yok → Sentry'de "bu sürümden sonra
   başlayan hatalar" ya da "ödeme alanındaki hatalar" süzülemiyor. → Dilim 6.

7. **Arka planda başlayan işlerde zincir kopuyor.** `history-learn` rotası (`api/properties/[id]/history-learn/route.ts:132`)
   yürütücüyü `void executeHistoryLearnRun(...)` ile başlatır → bu yol rotanın numarasını MİRAS ALIR (iyi). Ama süreç ölürse çalıştırma
   saatlik süpürgede (`history-learn/service.ts:404-416`, `scheduled-sync.ts:860`) yürür; o zaman SENKRON GEÇİŞİNİN işletmesiz sistem
   numarasıyla koşar — iki çalıştırma aynı numarayı paylaşır ve hata raporu işletmeye bağlanmaz.
8. **Hesap silme rotası (`api/account/delete/route.ts:24`) `withAuth` kullanmaz** → numarasız; içindeki `serverError` hata için ayrı
   sistem numarası açar. Silinen işletmenin olay satırları FK kademesiyle gider (`schema.prisma:917`); silmenin kendisinin izi kalmaz.
9. **Hazır yama çakışması (yan bulgu):** `docs/hazir-yamalar/2026-10-14-KB-istek-kimligi-migration-65.patch` migration'ı `65_…` diye
   numaralıyor; ana dalda 65 ve 66 artık başka işler (`65_history_learn`, `66_property_instruction_by_operator`). Bu belgedeki
   migration'lar "67+" diye yazıldı; yayın sırasında numara verilir.

---

## 2. Büyük şirketler ne yapıyor (web araştırması, 2026-10-15)

> Not: Bu ortamda sayfa indirme (WebFetch) DNS hatası verdi; aşağıdakiler arama sonuçlarındaki resmi belge özetlerinden. Kaynak
> bağlantıları en altta. Rakam / ayrıntı kritikse resmi sayfadan bir kez daha bakılmalı.

| Şirket / standart | Ne yapıyor | Bize dersi |
|---|---|---|
| **Stripe** | Her API isteğine `req_…` biçiminde istek kimliği; yanıtın `Request-Id` başlığında. Panelde (Workbench → Logs) istek günlüğü numarayla bulunur; günlükler ayrıca **kaynak kimliğiyle** (`cus_…` gibi) süzülür. Destek "numarayı verirseniz daha hızlı çözeriz" der. Eski destek makalesine göre GET günlükleri 31 gün, diğerleri 15 ay saklanır. | Bizde zaten "her istek numara + yanıt başlığı" var. Eksik olan: **kaynak kimliğiyle arama** (konuşma / çalıştırma) ve **zaman + işletme süzgeci**. Saklama: Stripe yazma isteklerini uzun tutuyor; biz ödeme olaylarını 90 gün tutuyoruz (kurucu kararı) ama `WebhookEvent` / `Invoice` kalıcı → numarayı oraya da yazmak 90 gün sonrası için yol bırakır. |
| **Shopify** | API yanıtında `x-request-id`; geliştirici destek formunda "Request Log ID" alanı bu değer. Shopify personeli bir vakada "sipariş kimliği tek başına yetmedi, x-request-id lazım" demiş (topluluk forumu, resmi belge değil). | Kaynak kimliği (bizde konuşma) "ne oldu"yu gösterir ama "hangi deneme" sorusunu ancak deneme numarası çözer → **ikisi birlikte**: konuşma ile ara → denemeleri listele → numarayla zinciri aç. |
| **Intercom** | API hatalarında `request_id`; destek ekibi kendi günlüklerinde arar. Gelen kutusunda temsilci, konuşmanın yanında müşteri verisini ve "uygulama"ları (ör. Shopify sipariş durumu) görür; bazı alanlar yalnız belirli ekiplere görünür. Bir forum cevabında destek ekibinin yalnız son 7 günün günlüğüne erişebildiği yazıyor. | Destek ekranı = **numara + müşterinin bağlamı aynı yerde**. Bizde karşılığı: olay zinciri ekranında işletme adı, plan, bağlantı durumu tek satırda. "Yalnız belirli ekip görür" = bizdeki süper-admin + 2FA. Kısa saklama (7 gün) yaygın; bizim 90 gün cömert. |
| **OpenTelemetry / W3C Trace Context** | `traceparent` başlığı: 32 onaltılık karakterlik **iz kimliği** + 16 karakterlik üst adım kimliği + bayraklar; geçersiz kimlik (ör. hepsi sıfır) yok sayılır. Kuyruk / mesajlaşmada: üretici mesaja bir "oluşturma bağlamı" koyar, tüketici kendi işini ona **bağlar** (span link); toplu işte her mesaj kendi izine bağlanır, toplu iş tek iz değildir. | (1) Bizim "istemcinin numarası kabul edilmez" kuralımız standartla uyumlu (geçersiz değer yok sayılır; biz daha sıkıyız: hiç kabul etmiyoruz). (2) **Kuyruk satırı numarayı taşımalı** (bugün giden kuyruk işçisi her satıra YENİ numara veriyor — `outbox/worker.ts:1440`): standartın "oluşturma bağlamı" tam olarak bu. (3) Toplu iş (senkron geçişi) ile tek mesaj işlemesi ayrı numara olmalı, aralarında "bağ" (bizde: `parent` alanı) olmalı. |
| **Paddle (ödeme sağlayıcımız)** | Paddle.js `eventCallback`'i `checkout.payment.failed` olayını yayar (yükte `che_` ödeme ekranı kimliği, `txn_` işlem kimliği, durum); 2025'te `checkout.payment.error` eklendi (ör. kullanılabilir ödeme yöntemi yok). | Kart reddi bizim sunucumuza 5xx olarak hiç gelmez → müşteriye numara gösterebilmek için bu olayı dinlemek gerekir (Dilim B). |

**Ortak desen (benim çıkarımım):** büyük şirketlerde destek araması üç girişlidir — (a) **numara** (müşteri hata ekranından kopyalar),
(b) **kaynak kimliği** (sipariş / müşteri / konuşma), (c) **hesap + zaman aralığı**. Sonuç ekranı numarayı "bir işlemin adımları" olarak
sıralar ve dış sağlayıcının kendi istek kimliğini (Paddle `request_id`, Stripe `req_`) yanında gösterir ki iki şirketin destek ekibi aynı
işlemi konuşabilsin. Bizde (a) var; (b) ve (c) yok.

---

## 3. Hedef mimari — dilimlerin hepsinde geçerli kurallar

1. **Numara bugünkü gibi YALNIZ sunucuda üretilir.** Yeni dilimlerde de istemci numara seçemez; bir zincire katılma yalnız
   SUNUCUNUN yazdığı satırdan okunan numarayla olur (bugün onay kaydı; yeni "taşıyıcı" satırlar: giden kuyruk satırı, geçmişten-öğren
   çalıştırması, ödeme olayı kaydı).
2. **"Bir işlem" = sistemin yaptığı bir İŞ, müşterinin bir isteği değil.** Ödeme: onay → Paddle → abonelik. Otomatik cevap: bir misafir
   mesajına verilen bir CEVAP DENEMESİ (model → kapı → gönderim). Senkron geçişi ayrı bir iştir; içindeki her deneme kendi numarasını
   alır ve geçişin numarasını **üst numara** (`parentId`) olarak taşır — OpenTelemetry'nin "toplu iş tek iz değildir, her mesaj kendi
   izi + bağ" kuralı.
3. **Kaynak kimliği ayrı bir sütunda (`subjectId`).** Konuşma, geçmişten-öğren çalıştırması gibi opak kimlikler; destek ekranı "bu
   konuşmada ne oldu"yu numarasız da bulur (Stripe'ın "kaynak kimliğiyle süz" deseni). Kişisel veri değil, opak `cuid`
   (RiskEvent'in `conversationId`'si ile aynı politika: FK yok, işletme silinince gider).
4. **Olay verisi bugünkü süzgeçten geçer** (`event-log.ts:79-97`): kapalı küme olay adı, izinli anahtar + anahtar başına kalıp.
   Yeni dilimler yalnız YENİ ANAHTAR ekler, süzgeci gevşetmez. Metin, ad, e-posta, telefon, misafir mesajı ASLA.
5. **Yazım, sıcak yolu (misafire giden cevap, QR yanıtı) bekletmez.** Bugün `logEvent` 0,5 sn'ye kadar bekler (`event-log.ts:158,181`).
   Otomatik cevap ve QR sınıfında bekleme 100 ms'e iner (ya da hiç beklenmez); ödeme sınıfında bugünkü gibi kalır.
6. **Sınıf başına tavan genişler** (`event-log.ts:105-109`): bugün ödeme / iş / diğer. Yeni: **cevap** (otomatik cevap + kanal
   gönderimi) ve **misafir** (QR). Biri ötekinin bütçesini yiyemez — özellikle kimliksiz QR seli ödeme izini boğamaz.
7. **Müşteriye numara yalnız ödeme ekranında** (kurucu kararı 10-12). Diğer zincirlerde destek ekibinin giriş noktası numara değil
   **konuşma bağlantısı** (`/inbox/<kimlik>`, `/guest-chats/<kimlik>` — ev sahibi tarayıcısındaki adresi yapıştırabilir) ya da
   **işletme + zaman aralığı**.

---

## 4. DİLİM A — Destek ekranı v2: üç giriş, tam zincir (ilk yapılacak; yeni olay yazmaz)

**Neden önce bu:** bugünkü verinin değerini hemen artırır, sonraki dilimlerin olaylarını gösterecek kabı kurar, misafire / müşteriye
giden hiçbir şeye dokunmaz.

### A.1 Veri modeli (yalnız ekleme — migration 67, tek dosya)

```sql
-- OperationalEvent: kaynak kimliği + üst numara (ikisi de NULL olabilir; dolu tabloya zorunlu kolon / unique YOK)
ALTER TABLE "OperationalEvent" ADD COLUMN "subjectId" TEXT;
ALTER TABLE "OperationalEvent" ADD COLUMN "parentId" TEXT;
CREATE INDEX "OperationalEvent_subjectId_createdAt_idx" ON "OperationalEvent"("subjectId", "createdAt");
CREATE INDEX "OperationalEvent_parentId_idx" ON "OperationalEvent"("parentId") WHERE "parentId" IS NOT NULL;  -- kısmi: çoğu satırda boş
```

- Tablo en çok 90 günlük ve bugün küçük → düz `CREATE INDEX` (CONCURRENTLY değil; CLAUDE.md kuralı: küçük tabloda INVALID dizin riski
  daha kötü). `ALTER … ADD COLUMN` satır tetikleyicisini (63/64) ÇALIŞTIRMAZ; yalnız-ekle kuralı bozulmaz.
- ⚠️ Kısmi dizin Prisma şemasında ifade edilemez → `prisma migrate diff` kalıcı sapma gösterir. Seçenek: kısmi yerine düz dizin
  (`@@index([parentId])`, birkaç MB fazla) — **önerim düz dizin** (sıfır-sapma kuralı daha değerli).
- Prisma: `subjectId String?` · `parentId String?` · `@@index([subjectId, createdAt])` · `@@index([parentId])`.
- `CorrelationContext`'e (`correlation.ts:13-22`) `parentId?: string | null` eklenir; `logEvent` (`event-log.ts:164-187`) bağlamın
  `parentId`'sini ve yeni `opts.subjectId`'yi (yalnız `^c[a-z0-9]{7,40}$`, aksi düşer) yazar.

### A.2 Arama girişleri (`api/admin/events/route.ts`)

| Giriş | Parametre | Sınır |
|---|---|---|
| Takip numarası (bugünkü) | `?id=<8 karakter ya da tam numara>` | bugünkü gibi |
| Kaynak kimliği (YENİ) | `?subject=<cuid>` ya da yapıştırılan bağlantı (`/inbox/<id>` → sunucu yalnız son yol parçasını alır) | en çok 500 olay, numaraya göre gruplu |
| İşletme + zaman (YENİ) | `?org=<cuid>&from=<ISO>&hours=1..24&level=error\|warn\|all` | pencere ≤ 24 saat; en çok 500 olay |
| **Amaç (YENİ, zorunlu)** | `purpose=support_ticket\|incident_review\|payment_issue` + isteğe bağlı `ticket=<harf/rakam/tire ≤ 40>` | kapalı küme — kalite konsolu emsali (`ai-quality/console.ts:28-34`, `ai-quality/codes.ts:6-10`) |

Kapılar AYNEN: süper-admin + 2FA (`isSuperAdmin`), bürünmede yasak, `sec-fetch-site`, kimlik başına saatte 60 (geçersiz istek de
sayılır), **veri dönmeden ÖNCE** denetim kaydı (amaç + talep numarası + aranan türü; numaranın yalnız ilk 8'i, kaynak kimliğinin yalnız
ilk 8'i), sonucu dönen her işletmenin kendi kaydına da (`route.ts:54-74` deseni).

### A.3 Zincir çözücü (YENİ yaprak-üstü modül `src/lib/event-chain.ts`)

`findEventsByCorrelation` (`event-log.ts:209-235`) "kaynak bağdaştırıcıları" listesine dönüşür. Her bağdaştırıcı numarayı taşıyan
tablodan YALNIZ güvenli sütunları `select` eder:

| Kaynak | Bugün | Dönen alanlar (asla dönmeyen) |
|---|---|---|
| `OperationalEvent` | var | olay, seviye, zaman, işletme, veri (—) |
| `CheckoutConsent` | var | kimlik, plan, zaman (IP, tarayıcı bilgisi ASLA — bugünkü kural) |
| `WebhookEvent` | Dilim B | olay türü, durum, zaman (`payloadJson`, `error` ASLA) |
| `MessageOutbox` | Dilim C | tür, durum, deneme sayısı, `lastErrorKind/Code`, gönderim zamanı (`body` ASLA) |
| `HistoryLearnRun` | Dilim E | tür, durum, hata kodu, çağrı / jeton sayıları (taslak metni ASLA) |

Saf yardımcılar (birim testli): `chainLabelTr(event)` — **kapalı küme olay adı → Türkçe etiket** tek kaynak (ör. `billing.webhook.received`
→ "Paddle bildirimi geldi"); `summarizeChain(events)` → tek satır özet ("Ödeme ekranı açıldı → Paddle ödemenin başarısız olduğunu bildirdi
(kart reddedildi) → 'ödemeniz işleniyor' kilidi kalktı"). Her `OPERATIONAL_EVENTS` anahtarının etiketi olmak ZORUNDA (anti-vakum pini:
etiketsiz olay eklenirse test kırmızı).

Bağlam başlığı (Intercom'un "konuşmanın yanında müşteri verisi" deseni): işletme adı, abonelik durumu, kanal bağlantı durumu — bunlar
`admin/page.tsx:44-57` sorgusunda zaten var; zincir ekranı aynı alanları tek satırda gösterir.

### A.4 Ekran (`components/admin/event-search.tsx`)

Üç sekme (Numara · Konuşma / çalıştırma · İşletme + zaman) + zorunlu "Amaç" seçimi. Sonuç: numaraya göre gruplu zaman çizelgesi
(Europe/Istanbul saati, Türkçe etiket, hata kırmızı), grubun başında tek satır özet; `parentId`'li gruplarda "üst işlem: <kısa numara>"
bağlantısı; Paddle `request_id` ve Sentry olay kimliği "kopyala" ile. JSON indir (bugünkü) kalır.

### A.5 Kod dokunma noktaları

| Dosya:satır | Değişiklik |
|---|---|
| `prisma/schema.prisma:908-922` | iki sütun + iki dizin |
| `src/lib/correlation.ts:13-22, 56-59` | `parentId` bağlamda; `runWithCorrelation` kopyalar |
| `src/lib/event-log.ts:164-187` | `opts.subjectId` (kalıp denetimli) + bağlamdan `parentId` |
| `src/lib/event-log.ts:209-235` | `findEventsByCorrelation` → `event-chain.ts`'ye taşınır (bağdaştırıcı listesi) |
| `src/app/api/admin/events/route.ts:23-76` | üç giriş + amaç / talep + ortak kapılar |
| `src/components/admin/event-search.tsx` | sekmeler, gruplu çizelge, özet satırı |
| `src/lib/ai-quality/codes.ts:6-10` emsali | `EVENT_SEARCH_PURPOSES` (yeni kapalı küme, yaprak modül) |

### A.6 Testler (gerçek PostgreSQL — `tests/integration/event-chain-search.test.ts`)

- Kaynak kimliğiyle arama: aynı konuşmanın iki denemesi iki ayrı numarayla gruplu döner; başka konuşmanın satırı GELMEZ.
- İşletme + zaman: 24 saati aşan pencere 400; pencere içi başka işletmenin satırı GELMEZ.
- Amaç yok → 400 ve reddedilen deneme denetim kaydına; amaç var → kayıtta amaç + talep numarası.
- Bürünme 403, 2FA'sız 401, site dışı 403, saatte 61. istek 429 (bugünkü pinler yeni girişlerde de).
- **Yapısal sızıntı pini:** yanıt JSON'unda `body`, `payloadJson`, `ip`, `userAgent`, `@` karakteri ARANIR — yok (kuyruk satırının gövdesi
  tohumlanır, yanıtta çıkmadığı doğrulanır).
- Denetim kaydı yazılamazsa (`writeAuditInTx` sahte hata — AYRI dosyada, Prisma spy sızıntısı kuralı) 503 ve veri YOK.
- Birim: `summarizeChain` her olay için etiket (anti-vakum); kısa numara / tam numara / bağlantı ayrıştırma; amaç kapalı küme.
- Mutasyon (`scripts/mutation-run.mjs`): denetim-önce-veri sırasını ters çevir · `subject` kalıbını gevşet · işletme süzgecini kaldır ·
  24 saat sınırını kaldır — dördü de ölmeli.

### A.7 Risk

- **Operatör aracı güçleniyor:** "işletme + zaman" bir tarama aracına dönüşebilir. Önlem: amaç zorunlu, pencere ≤ 24 saat, 500 satır,
  her arama işletmenin kendi denetim kaydında görünür.
- **Sıfır-sapma:** kısmi dizin kullanılırsa Prisma sapması — düz dizin önerildi.
- Müşteriye giden hiçbir şey değişmez → kurucuya yalnız bilgi + F1 sorusu (amaç kodları).

---

## 5. DİLİM B — Ödeme zincirini tamamla ("ödemem geçmedi" vakası)

### B.1 Sorun (kodla)
Kart reddi Paddle penceresinde olur; sunucumuz 5xx vermez → ekranda numara çıkmaz (`api.ts:206`). Sunucu tarafında zincir VAR
(`transaction.payment_failed` → `adoptConsentChain` → onayın numarası, `webhooks/paddle/route.ts:625,659-664`) ama:
(a) müşterinin elinde numara yok, (b) olay günlüğünde yalnız "Paddle bildirimi geldi / işlendi" var, "ödeme başarısız" ve Paddle'ın ret
kodu yok, (c) 90 gün sonra iz biter (`WebhookEvent` kalıcı ama numarasız).

### B.2 Veri modeli (migration 67'ye eklenir)
```sql
ALTER TABLE "WebhookEvent" ADD COLUMN "correlationId" TEXT;
CREATE INDEX "WebhookEvent_correlationId_idx" ON "WebhookEvent"("correlationId");
```
İlk teslimatın numarası yazılır, yeniden denemede DEĞİŞMEZ (upsert'in `update` dalı sütuna dokunmaz) — zincirin çapası oynamasın.
`WebhookEvent` 12 ay sonra küçültülür (`minimizeOldPaddleWebhooks`, `scheduled-sync.ts:869`); numara sütunu kişisel veri değil, kalır.

### B.3 Yeni olaylar (kapalı kümeye)
| Olay | Seviye | Veri |
|---|---|---|
| `billing.payment.failed` | warn | `transactionRef` (`txn_`), `providerCode` (Paddle'ın ret kodu, ör. `declined` — kapalı kod biçimi), `eventType` |
| `billing.checkout.number_shown` | info | (veri yok) — müşteriye numara gösterildiği an; yalnız istemcinin `consentId`'si kendi işletmesinin taze onayıysa, `checkout-pending` rotasının aynı kurallarıyla. **İsteğe bağlı** (bkz. F2) |

İşletmeye bağlanamayan başarısız ödeme Paddle kimliği YAZMAZ (bugünkü "işletmesiz satır Paddle kimliği taşımaz" geleneği, `route.ts:152`).

### B.4 Müşteriye gösterim (MÜŞTERİYE GİDEN METİN → kurucu onayı, F2)
- `api/billing/consent/route.ts:113`: başarılı yanıta `correlationId` eklenir (numara zaten yanıt başlığında; gövdeye taşınır).
- `components/settings/paddle-plans.tsx:188-206`: `eventCallback` `checkout.payment.failed` ve `checkout.payment.error`'ı da dinler;
  başarısızlık işaretlenir, pencere kapanınca (`checkout.closed`, tamamlanma yoksa) ekranda:
  **"Ödemeniz alınamadı. Kart bilgilerinizi kontrol edip tekrar deneyin. Sorun sürerse destek ekibimize bu takip numarasıyla
  yazabilirsiniz: 7f3a91b2"** + mevcut `TrackingNumberCopy` (`paddle-plans.tsx:668`).
- Metin kurucunun 10-10 metninin kalıbında; teknik ayrıntı (Paddle kodu) müşteriye GİTMEZ.

### B.5 Kod dokunma noktaları
| Dosya:satır | Değişiklik |
|---|---|
| `src/app/api/webhooks/paddle/route.ts:642-650` | `WebhookEvent` create'te `correlationId: currentCorrelationId()` |
| `src/app/api/webhooks/paddle/route.ts:659-664` | `payment_failed` dalında `logEvent("billing.payment.failed", …, { organizationId: failedOrg })` — `payments[0].error_code` okunur (alan adı Paddle sandbox'ta doğrulanmalı) |
| `src/lib/event-log.ts:21-40` | iki yeni olay adı |
| `src/app/api/billing/consent/route.ts:113` | yanıta numara |
| `src/components/settings/paddle-plans.tsx:186-206, 668` | iki Paddle olayı + metin |
| `src/lib/event-chain.ts` (Dilim A) | `WebhookEvent` bağdaştırıcısı |

### B.6 Testler
- Gerçek PG (`tests/integration/correlation-event-log.test.ts`'e ek): taze onay + `transaction.payment_failed` → `billing.payment.failed`
  onayın numarası + işletme + `providerCode`; `WebhookEvent.correlationId` = aynı numara; aynı olayın yeniden teslimi numarayı DEĞİŞTİRMEZ;
  bağlanamayan başarısızlık → işletmesiz satır, `transactionRef` YOK; Paddle kodu boşluklu / uzun metinse düşer (`_dropped`).
- Arayüz (`tests/ui/`): `checkout.payment.failed` sonrası kapanışta kurucu metni + kopyala düğmesi TAM numarayı taşır; `checkout.completed`
  yolu değişmez (mevcut pinler).
- Mutasyon: `update` dalına numara yazdır (çapa oynar) → test ölmeli.

### B.7 Risk
- Paddle.js olay adları sürüme bağlı (eski "classic" adlar farklı); yanlış ad = metin hiç görünmez (zararsız ama işe yaramaz) →
  sandbox'ta bir kez denenmeli. `error_code` alan adı da sandbox'ta doğrulanmalı.
- Müşteriye yeni bir metin görünür → kurucu onayı + ilk denemeler birlikte (para akışı kuralı).

---

## 6. DİLİM C — Otomatik cevap zinciri (gelen mesaj → yapay zekâ → kapı → kuyruk → sağlayıcı)

### C.1 Bugünkü akış ve kopukluklar (kodla)
`scheduled-sync.ts:504` işletme işlemesi TEK numara → `runDueChannelAutoReplies` (`automation.ts:3995`) 25 konuşmaya kadar döner →
her biri `applyChannelAutoReply` (`automation.ts:1614`): erken çıkışlar → model → kapı → `recordDecision` → `recordRiskEvent`
(`risk-events.ts:205`) → üretimde **satır içi gönderim** (`automation.ts:3440` `sendOnChannel` → `channels/outbound.ts:129`
`dispatchOutbound` → Hospitable); kuyruk bayrağı açıkken `enqueueOutbound` (`automation.ts:3287`) → işçi (`outbox/worker.ts:1440`)
SATIRA YENİ NUMARA verir. Sonuç: 25 konuşmanın hepsi aynı numarada; kuyruk yolunda karar ile gönderim ayrı numaralarda; olay günlüğüne
cevap adımı hiç yazılmıyor (yalnız işletme özeti `job.org.processed`).

### C.2 Tasarım kararı: numara DENEME başına, konuşma `subjectId`'de
| Seçenek | Artı | Eksi |
|---|---|---|
| (1) Gelen mesaja numara (mesaj satırına sütun; OTel "oluşturma bağlamı") | bir mesajın bütün denemeleri tek numarada | `Message` en büyük ve en sıcak tablo; alım yolu (V0.6 yazma servisi) birçok akıştan geçer; QR / iCal / elle girişte de kural gerekir |
| **(2) Deneme başına numara + `subjectId` = konuşma + `messageRef` = tetikleyen mesaj** | sıcak alım yoluna dokunmaz; "sistem ne yaptı" birimi = deneme; konuşmayla arama bütün denemeleri getirir (Shopify dersi: kaynak + istek kimliği birlikte) | aynı mesajın iki denemesi iki numara (ekranda gruplu görünür) |

**Önerim (2).** Geçişin numarası `parentId` olarak taşınır.

### C.3 Veri modeli (migration 67'ye eklenir)
```sql
ALTER TABLE "MessageOutbox" ADD COLUMN "correlationId" TEXT;   -- taşıyıcı: kuyruğa yazan denemenin numarası (dizin gerekmez)
ALTER TABLE "RiskEvent" ADD COLUMN "correlationId" TEXT;       -- İSTEĞE BAĞLI (C2): kalite konsolundan / raporlardan zincire geçiş
CREATE INDEX "RiskEvent_correlationId_idx" ON "RiskEvent"("correlationId");
```
`RiskEvent`'in TEK yazıcısı `recordRiskEvent` olduğu için tek satır değişiklik üç yüzeyi (otomatik cevap · uyarılar · QR) birden bağlar.

### C.4 Yeni olaylar
| Olay | Ne zaman | Veri (izinli anahtarlar) |
|---|---|---|
| `reply.attempt` | her deneme sonucu (geçiş tabanlı: aynı konuşma + aynı mesaj + aynı sonuç ikinci kez YAZILMAZ) | `outcome` (sent · queued · human_review kodu · `skippedReason`'ın ilk belirteci, ör. `send_failed`), `decision`, `riskType`, `confidencePct` (0-100 tam sayı), `messageRef` (cuid), `durationMs` |
| `channel.send` | `dispatchOutbound`'un her sonucu (satır içi + kuyruk + yaşam döngüsü + elle cevap — TEK boğaz) | `provider`, `kind` (sent · definitive_failure · ambiguous · rate_limited · blocked · auth_revoked), `errored`, `providerOutage` |
| `job.outbox.row` (bugünkü) | kuyruk satırının kesin sonucu | artık denemenin numarasında |

Geçiş tabanlı yazım neden şart: damgalanmayan geçici sebepler (`human_hold`, `send_failed`, `not_connected`, `already_claimed` —
`automation.ts:4111-4176`) her 2 dakikada yeniden denenir; 12 saatlik bir devir beklemesi bellek olmadan konuşma başına 360 satır
yazardı. Bellek: süreç içi, en çok 5.000 anahtar (`konuşma:mesaj damgası → son sonuç`); yeniden başlatmada en çok bir tekrar (kabul).

### C.5 Kod dokunma noktaları
| Dosya:satır | Değişiklik |
|---|---|
| `src/lib/scheduled-sync.ts:504` | işletme işlemesi `parentId: <geçiş numarası>` ile |
| `src/lib/automation.ts:4076-4077` | `applyChannelAutoReply(c.id)` → `runWithCorrelation({ id: yeni, organizationId, parentId: <işletme numarası> }, …)`; sonuçla `logEvent("reply.attempt", …, { subjectId: c.id })` (geçiş belleğinden geçerek) |
| `src/lib/channels/outbound.ts:129-146` | `dispatchOutbound` sonucu `channel.send` (sağlayıcının istek kimliği ileride adaptör sonucuna eklenirse `providerRequestId`) |
| `src/lib/outbox/enqueue.ts:121-131, 188-199` | `correlationId: currentCorrelationId()` |
| `src/lib/outbox/worker.ts:73-87, 320-322` | `OutboxRow.correlationId` + `RETURNING` |
| `src/lib/outbox/worker.ts:1440` | `id: isCorrelationId(row.correlationId) ? row.correlationId : newCorrelationId()` — kuyruk satırı denemenin zincirine katılır (ödeme webhook'unun onay satırından okuması gibi) |
| `src/lib/risk-events.ts:211-229` | (C2) `correlationId: currentCorrelationId()` |
| `src/lib/event-log.ts:21-40, 49-72, 105-109` | olaylar, anahtarlar (`outcome`, `decision`, `riskType`, `confidencePct`, `messageRef`, `provider`, `kind`, `providerOutage`), yeni **cevap** sınıfı (işletme 300 / dk), bu sınıfta yazım beklemesi 100 ms |

### C.6 Testler (gerçek PG — `tests/integration/correlation-auto-reply-chain.test.ts`)
- Tohum: işletme + mülk + konuşma + gelen mesaj; model mevcut otomatik cevap testlerindeki sahte istemciyle; gönderim
  `channels/outbound.ts`'deki test adaptörü geçersiz kılmasıyla (`outbound.ts:~118`).
- Satır içi yol: geçiş numarası P içinde koşu → `reply.attempt` + `channel.send` AYNI numara D; D ≠ P; `parentId` = işletme numarası;
  `subjectId` = konuşma; `messageRef` = gelen mesaj; **misafir metni `dataJson`'da YOK** (tohumlanan cümle aranır).
- İki konuşma → iki farklı numara; biri `send_failed` ötekini etkilemez.
- Geçiş tabanlı yazım: `human_hold` iki geçiş üst üste → tek `reply.attempt`; sebep değişince ikinci satır.
- Kuyruk yolu (`DURABLE_OUTBOX_ENABLED=1`): satır D'yi taşır; işçi boşaltımı `job.outbox.row` + `channel.send`'i D ile yazar; numarasız
  eski satır yeni numara alır; sütuna bozuk değer yazılmışsa (elle) yok sayılır.
- (C2) `RiskEvent.correlationId` = D; uyarı yüzeyi (`alerts`) ve QR yüzeyi de kendi numarasıyla.
- Birim: `skippedReason` → `outcome` eşleyici (`"send_failed: HTTP 500 …"` → `send_failed`; boşluklu / uzun değer düşer); bellek tavanı.
- Mutasyon: işçide eski `newCorrelationId()`'ye dönüş · geçiş belleğini kaldır · `subjectId` yazımını kaldır — üçü de ölmeli.

### C.7 Risk
- **Sıcak yol gecikmesi:** bugün her `logEvent` 0,5 sn'ye kadar bekler; 25 deneme × 2 olay, veritabanı yavaşken geçişe 25 sn ekleyebilir
  (kilit TTL 15 dk, işletme bütçesi var). Önlem: cevap sınıfında 100 ms bekleme ya da beklemesiz yazım.
- **İç içe bağlam:** `applyChannelAutoReply` içindeki her `reportError` artık deneme numarasıyla raporlanır (iyi), ama alarm e-postasındaki
  numara işletme numarası değil deneme numarası olur → operatör ekranındaki "üst işlem" bağlantısı bu yüzden şart.
- Misafire giden cevap DEĞİŞMEZ (yalnız iz) → kurucuya bilgi + F3 sorusu (kapsam onayı).

---

## 7. DİLİM D — QR misafir sohbeti

### D.1 Bugün
`api/chat/[token]/route.ts:491-497` kimliksiz rota; numara yok. Hata olursa `serverError` → `reportError` işletmesiz yeni sistem
numarası açar (işletmeye bağlanmaz). Misafire numara GÖSTERİLMEZ (`api.ts:206` — anonim rotada bağlam yok; kurucu kuralı: misafir
Lixus desteğine yazmaz).

### D.2 Tasarım
- POST sarmalayıcısı isteği yeni numarayla koşturur (`runWithCorrelation({ id: yeni, organizationId: null })`).
- Jeton çözülünce (`route.ts:569-570`, `resolveGuestChat`) işletme bağlama eklenir (yeni küçük yardımcı
  `bindCorrelationOrganization(orgId)`; `adoptCorrelation` numarayı da değiştirdiği için ayrı ad, `correlation.ts:81-87` yanında).
- **Çözülmeyen jeton, kapalı sohbet, PIN denemesi YAZILMAZ** — kimliksiz bir saldırgan sistem kovasını dolduramasın; olay yalnız geçerli
  bir konaklamanın mesaj akışında.
- Tek çıkış noktası `finalize` (`route.ts:623-627`) → `logEvent("qr.turn", { outcome: answered|held|handoff|escalated|deduped|closing },
  { subjectId: <konuşma> })`. `finalize` dışından dönen yollar (`route.ts:609-620` PIN gerekli, `:583` kapalı) yazmaz (bilinçli).
- `recordRiskEvent` (`route.ts:680,772,830,1262,1317`) Dilim C2 ile kendiliğinden numarayı taşır; yapay zekâ izi (`route.ts:1170`)
  aynı numarada.
- Ev sahibine giden QR uyarı e-postası (`maybeSendQrEscalationEmail`, ör. `route.ts:522-529`) sonucu: `qr.alert` (`reason` = kapalı kod,
  `errored` = gönderilemedi mi). "Misafir yazdı, bana e-posta gelmedi" sorusunun cevabı.
- Yanıta `X-Correlation-ID` başlığı EKLENMEZ (misafir tarayıcısına iç numara gitmez — kurucu kuralıyla uyumlu; pinlenir).
- Yeni **misafir** sınıfı tavanı (işletme 120 / dk) + yazım beklemesiz (misafirin cevabı gecikmez).

### D.3 Testler (gerçek PG)
- Geçerli konaklama mesajı → `qr.turn` işletme + konuşma `subjectId` + numara; `RiskEvent.correlationId` aynı numara.
- Yanıt gövdesinde ve başlıklarda numara YOK (pin).
- Bilinmeyen jeton / kapalı sohbet → olay satırı YOK.
- 200 istekli sel (IP kovası testte açık) → misafir sınıfı tavanda durur; aynı işletmenin ödeme ve iş sınıfı etkilenmez.
- Misafir metni `dataJson`'da yok (tohumlanan cümle aranır).

### D.4 Risk
Kimliksiz uçtan veritabanına yazım çoğalır (her geçerli mesaja +1 satır). Önlemler: mevcut IP 20 / dk + konaklama saatlik tavanı +
sınıf tavanı + yalnız geçerli konaklama. Misafire giden hiçbir şey değişmez.

---

## 8. DİLİM E — Geçmişten öğren çalıştırmaları + bilgi tabanı içe aktarma

### E.1 Geçmişten öğren (bulgu §1.1-7)
**Veri modeli (migration 67'ye):** `ALTER TABLE "HistoryLearnRun" ADD COLUMN "correlationId" TEXT;` (taşıyıcı; dizin gerekmez — arama
`subjectId = runId` ile olay günlüğünden).

| Dosya:satır | Değişiklik |
|---|---|
| `src/lib/history-learn/service.ts:137-147` | çalıştırma açılırken `correlationId: currentCorrelationId()` (rotanın numarası) |
| `src/lib/history-learn/service.ts:207-221` | `executeHistoryLearnRun` gövdesi `runWithCorrelation({ id: satırın numarası (geçerliyse) ya da yeni, organizationId: run.organizationId })` içinde — süpürgede yürüyen çalıştırma rotanın zincirine geri döner, iki çalıştırma aynı numarayı paylaşmaz |
| `src/lib/history-learn/service.ts:276-292, 386-397` | `history.run.finished` (`status`, `reason`=hata kodu, `calls`, `failedCalls`, `tokensIn`, `tokensOut`, `count`=çift sayısı, `drafts`, `durationMs`; `subjectId` = çalıştırma) |
| `src/lib/history-learn/service.ts:317-322` | arızada `history.run.finished` `status=failed` (hata raporu zaten aynı numarada) |
| `src/app/api/properties/[id]/history-learn/route.ts:113-132` | `history.run.started` (`job` = learn / compare) |
| `src/lib/event-log.ts` | olaylar + sayı anahtarları (`calls`, `failedCalls`, `tokensIn`, `tokensOut`, `drafts`) |

**Testler (gerçek PG):** rota numarası N ile açılan, yürütülmeyen çalıştırma; süpürge sistem numarası S içinde yürütür →
`history.run.finished` N ve işletmeyle (S değil); aynı geçişte iki çalıştırma → iki ayrı numara; yürütücüde fırlatma → `error.reported`
N + işletme; taslak / soru metni olay verisinde YOK. Anahtar (`HISTORY_LEARN_ENABLED`) kapalıyken hiçbir olay yok.
**Risk:** düşük (özellik kapalı; yalnız iz).

### E.2 Bilgi tabanı içe aktarma
Gerçek: "içe aktar" sunucuda TEK işlem değil; istemci kalem başına `POST /api/kb` atar (`components/knowledge/kb-import-text.tsx:88-91`).
Her kalem zaten kendi numarasıyla (`withManage`). İstemci numara seçemeyeceği için (kural 1) bir "içe aktarım numarası" yoktur; destek
sorusu ("12 kalem ekledim, 3'ü yok") **işletme + zaman** aramasıyla çözülür.
- `src/app/api/kb/route.ts:25-…`: `kb.item.created` (`reason` = kaynak kodu: manual / import / template / history) ve reddedilince
  `kb.item.rejected` (`reason` = plan_limit / validation / duplicate). Kalem başlığı / içeriği ASLA.
- Hazır yama "KB istek kimliği" (migration numarası çakışıyor, §1.1-9) uygulanırsa `duplicate` sebebi oradan gelir.
**Test:** plan sınırında 3. kalem → `kb.item.rejected reason=plan_limit` işletmeyle; içerik `dataJson`'da yok. **Risk:** düşük.

---

## 9. DİLİM F — Hesap silme + kimlik e-postası kuyruğu

### F.1 Hesap silme (`api/account/delete/route.ts:24-103`)
- Rota `withAuth` dışında → gövde `runWithCorrelation({ id: yeni, organizationId: session.organizationId })` ile sarılır (500'de hata raporu
  işletmeye bağlanır).
- `account.delete.blocked` (`reason` = billable_subscription · session_revoked) işletmenin altında — işletme yaşadığı için aranabilir
  ("hesabımı silemiyorum" desteği). Hatalı parola YAZILMAZ (yeniden doğrulama sayacı zaten tutuyor; olay günlüğü parola denemesi
  sayacına dönüşmesin).
- `account.deleted` başarılı silmeden SONRA, `organizationId: null` ile (işletmenin satırları FK kademesiyle zaten gitti — bilinçli; KVKK),
  veri yalnız sayılar (`count` = sırada silinecek depolama nesnesi). Kimlik taşımaz → yalnız "bugün kaç hesap silindi" türü sayım + sunucu
  günlüğündeki numara.
- **Test (gerçek PG):** engellenen silme → işletmeli `account.delete.blocked`; başarılı silme → işletmesiz `account.deleted`, işletmenin eski
  satırları yok, silme tetikleyicisi (64) kademeyi engellemedi; hatalı parola → olay yok.
- **Risk:** silme geri alınamaz yol — değişiklik yalnız iz; `deleteAccountData` (`data-retention.ts:891`) dokunulmaz.

### F.2 Kimlik e-postası kuyruğu (`email-outbox.ts:463-560`)
- Boşaltım bugün TEK numara (`email-outbox.ts:194`); satır başına numara + kullanıcının işletmesi (`outbox/worker.ts:1440` deseni) —
  döngü `email-outbox.ts:497-511`.
- `email.identity.sent` / `email.identity.failed` / `email.identity.expired` — `kind` (verify_email · pw_reset_code · pw_change_code,
  kapalı küme), `attempt`, `providerCode`. Alıcı adresi, kod, bağlantı ASLA.
- 🚨 **Kuyruğa yazan istekte (kayıt / şifremi unuttum) olay YAZILMAZ:** bu rotalar bilinen ve bilinmeyen e-posta için aynı süreyi vermek
  zorunda (`kickEmailOutboxDrain` yorumu, `email-outbox.ts:184-190`); 0,5 sn'ye kadar bekleyen bir yazım hesap var / yok sızdırırdı.
  Yalnız arka plan boşaltımında yazılır.
- **Test (gerçek PG):** boşaltım → olay kullanıcının işletmesiyle, `dataJson`'da "@" yok; şifremi-unuttum rotası bilinen / bilinmeyen
  adreste olay tablosuna HİÇ satır yazmaz (rota süresince sayım sabit); süresi geçen satır → `expired`.
- **Risk:** düşük; tek ek sorgu (kullanıcı → işletme) satır başına.

---

## 10. DİLİM G — Sentry etiketleri ve iki yönlü bağ

### G.1 Bugün (`report-error-core.ts:169-222`)
SDK'sız zarf; `environment` = `NODE_ENV` (canlıda her zaman "production" — ayırt etmez), `release` YOK, tek etiket `correlation_id`.
Sentry olay kimliği (`event_id`) içeride üretilip atılıyor → olay günlüğünden Sentry'ye, Sentry'den panele bağ yok (yalnız etiketle arama).

### G.2 Tasarım
| Alan | Değer | Neden |
|---|---|---|
| `release` | `RAILWAY_GIT_COMMIT_SHA`'nın ilk 12 karakteri (Railway'in sağladığı değişken; yoksa alan yok) | "bu sürümden sonra başlayan hata" |
| `environment` | `RAILWAY_ENVIRONMENT_NAME` ya da `NODE_ENV` | ileride .eu açılışı / hazırlık ortamı ayrışır |
| etiket `correlation_id` | bugünkü | — |
| etiket `area` | bağlamın ilk kod belirteci (olay günlüğüyle AYNI kural, `report-error.ts:25`): `paddle-webhook`, `outbox-row`, `api`, `scheduled-sync`… | alan bazında süzme |
| etiket `org_ref` | işletme kimliğinin **anahtarlı özeti** (HMAC-SHA256, alan ayrımlı; `crypto-core.ts:78-80` `encryptionKeyFingerprint` deseni), ilk 12 onaltılık | "aynı müşteride tekrar eden hata" — Sentry işletmenin kimliğini GÖRMEZ, eşleşmeyi yalnız biz kurarız (operatör panelinde işletme satırında `org_ref` gösterilir) |
| etiket `parent_id` | varsa üst numara | geçiş ↔ deneme |
| `event_id` | `reportError`'da üretilir, Sentry'ye gider VE `error.reported` satırına `sentryEventId` (32 onaltılık) olarak yazılır | zincir ekranında "Sentry'de aç" |

Sentry sınırları (resmi belge): etiket anahtarı ≤ 32 karakter, değer ≤ 200 karakter, satır sonu yok — yukarıdakilerin hepsi uyar.

### G.3 Dokunma noktaları
`report-error-core.ts:48-52` (`ReportOutcome.sentryEventId?`), `:54-79` (olay kimliği burada üretilir, bağlamdan `organizationId`/`parentId`
okunur), `:169-209` (`release`, `environment`, etiketler); `report-error.ts:25` (`sentryEventId` olay verisine); `event-log.ts:49-72`
(`sentryEventId: /^[0-9a-f]{32}$/`); `admin/page.tsx` müşteri tablosunda `org_ref` sütunu (yalnız operatör).

### G.4 Testler
Birim (fetch sahte): zarfta `release`, `environment`, etiketler; `org_ref` aynı işletmede sabit, farklı işletmede farklı, işletme kimliğini
İÇERMEZ; her etiket değeri ≤ 200 ve anahtar ≤ 32; `SENTRY_DSN` yokken hiçbir şey gönderilmez (bugünkü pin). Gerçek PG: `error.reported`
satırındaki `sentryEventId` zarftaki `event_id` ile aynı.

### G.5 Risk
Sentry yurt dışı alt işleyen (gizlilik metni §8'de "Sentry (opsiyonel hata izleme)" olarak yazılı). Anahtarlı özet kişisel veri riskini
düşürür; yine de kurucuya bilgi (F5). Etiket kardinalitesi: `correlation_id` zaten olay başına tekil — yeni etiketler düşük kardinaliteli.

---

## 11. DİLİM H — Saklama, KVKK ve yalnız-ekle güvenliği

### H.1 Bugünkü güvenceler (kodda)
UPDATE reddi (63), taze satırın DELETE reddi ve TRUNCATE reddi (64), 90 gün süpürge (`event-log.ts:190-197`), işletme silinince kademe,
operatör okuması kayıtlı. KVKK dökümüne girme kararı avukatta.

### H.2 Öneriler
1. **Saklama: tek süre (90 gün) şimdilik kalsın.** Sınıf başına kısa süre (ör. `job.*` 30 gün) ancak tablo 1 milyon satırı geçince; o
   zaman 64'teki tetikleyici de değişmeli (migration). Yeni taşıyıcı sütunlar kendi tablosunun saklamasına uyar (kuyruk, çalıştırma, ödeme
   olayı kaydı).
2. **Günlük bütünlük mührü (AWS CloudTrail'in "özet dosyası" deseni):** saatlik derin geçişte, mühürlenmemiş her GÜN için
   `(gün, işletme)` grubu başına satır sayısı + SHA-256 (kimlik, numara, olay, veri, zaman — `id` sırasıyla) hesaplanır, yeni
   `OperationalEventDigest` tablosuna yazılır (o tablo da yalnız-ekle tetikleyicili). Doğrulama fonksiyonu operatör ekranında "son 89 gün:
   tutarlı / şu gün şu işletmede fark var" der. Silinen işletmenin grubu "işletme silindi — beklenen" diye işaretlenir. Günlük özetin
   kendisi isteğe bağlı olarak kurucuya e-postayla gider (veritabanı dışında bir çapa — veritabanı sahibinin sessizce yeniden yazmasını
   da ortaya çıkarır). Maliyet: günde en çok işletme sayısı kadar satır.
3. **Ayrı veritabanı rolü (en güçlü, en riskli):** uygulama bağlantısı tetikleyiciyi kaldıramayan bir rolle; migration'lar sahip rolüyle.
   Bugün uygulama tablo sahibi olduğu için tetikleyiciyi kapatabilir. Railway'de `DATABASE_URL` değişimi = açılış riski → ayrı karar,
   ilk denemeler birlikte.
4. **KVKK dökümü:** önerim — işletmenin kendi olay satırları (kimlik kodları + zaman) "işlem kayıtları" olarak işletmenin dökümüne girsin
   (denetim kaydı zaten giriyor; şeffaflık). Avukat kararı.
5. **Misafir silme:** `subjectId` = konuşma kimliği. Misafir silindiğinde olay satırları KALIR (RiskEvent politikasıyla aynı: opak kimlik,
   metin yok; FK yok). 64'teki tetikleyici zaten taze satır silmeyi reddeder. Avukata sorulacak; önerim "kalsın".
6. **Ölçek gelince bölümleme:** 10 milyon satır mertebesinde aylık bölüm (partition) + saklama = bölüm düşürme. Satır tetikleyicisi bölüm
   düşürmede ÇALIŞMAZ → bütünlük mührü bu yüzden önemli. Bugün gerekmiyor.
7. **Süpürge parti parti:** `pruneOperationalEvents` (`event-log.ts:193-197`) tek `deleteMany` — büyüyünce 5.000'lik partiler (uzun kilit
   ve satır başı tetikleyici maliyeti).

### H.3 Test
Gerçek PG: mühür hesapla → bir satırı tetikleyiciyi kapatıp elle değiştir (test içinde, sahip yetkisiyle) → doğrulama "fark var" der;
işletme sil → "beklenen kayıp"; mühür tablosunda UPDATE reddedilir. Birim: özet girdisi sıralı ve deterministik.

---

## 12. Hacim ve maliyet tahmini (olay tablosu)

**Satır boyu (hesap):** yığın ~340 bayt (başlık 24 + cuid 26 + numara 37 + işletme 26 + olay adı ~21 + seviye 6 + veri ~125 + zaman 8 +
yeni `subjectId` 26 / `parentId` 37) + 5 dizin ~230 bayt + silme / boşluk payı ~%20 → **satır başı ≈ 0,65 KB**.

**Taban (kodla ve CLAUDE.md'deki 09-19 yedek sayımıyla):** 17.462 mesaj / 540 günlük senkron penceresi ≈ günde 32 mesaj (~16 gelen),
1.542 rezervasyon ≈ günde ~3 (yaşam döngüsü mesajı ~9 / gün), 11 daire.

| Olay ailesi (günlük) | Bugün (11 daire) | 1.000 daire (~100 müşteri) | 10.000 daire (~1.000 müşteri) |
|---|---|---|---|
| `reply.attempt` (geçiş tabanlı) | ~20 | ~2.000 | ~20.000 |
| `channel.send` (otomatik + yaşam döngüsü + elle) | ~30 | ~3.000 | ~30.000 |
| `job.finished` + `job.org.processed` | ~60 | ~3.500 | ~35.000 |
| `qr.turn` + `qr.alert` | ~5 | ~500 | ~5.000 |
| `error.reported` | ~10 | ~300 | ~3.000 |
| ödeme + e-posta + geçmişten öğren + bilgi tabanı + hesap | ~5 | ~300 | ~3.000 |
| **Toplam / gün** | **~130** | **~9.600** | **~96.000** |
| **90 günde satır** | **~12 bin** | **~0,9 milyon** | **~8,6 milyon** |
| **Disk (≈0,65 KB/satır)** | **~8 MB** | **~560 MB** | **~5,6 GB** |
| **Aylık disk maliyeti** (Railway volume, GB-ay $0,15–0,25 — üçüncü taraf kaynaklar, resmi sayfadan doğrulanmalı) | ~$0 | ~$0,08–0,14 | ~$0,85–1,40 |

Yorum:
- **Para sorun değil; dikkat edilecek şey disk tavanı ve süpürge.** Railway Hobby planında volume tavanı 5 GB (üçüncü taraf kaynak) →
  10.000 dairede olay tablosu tek başına bunu zorlar → o noktada `job.*` için 30 gün ya da aylık bölümleme (H.2-1, H.2-6).
- **Yazım hızı:** en büyük senaryoda ortalama ~1,1 satır / sn; senkron geçişlerinde kısa patlamalar (işletme başına en çok ~50 satır) —
  PostgreSQL için önemsiz. Dakikalık sınıf tavanları (işletme başına cevap 300 / dk, misafir 120 / dk) patlamayı zaten sınırlar.
- **Süpürge:** 10.000 dairede saatte ~4.000 satır silinir; satır başı silme tetikleyicisi (64) ucuz ama tek `deleteMany` uzun sürebilir →
  5.000'lik partiler (H.2-7).
- **Arama hızı:** numara, kaynak kimliği ve (işletme, zaman) aramaları dizinli. Kısa numara (8 karakter) `LIKE 'x%'` dizini kullanamaz
  (§6 bilinen sınır) → 8,6 milyon satırda tam tarama saniyeler sürer. Çözüm o zaman: `text_pattern_ops` dizini (Prisma sapması — bilinçli
  istisna) ya da kısa numarayı ayrı sütunda tutmak. Bugün gerekmez.
- **Taşıyıcı sütunların maliyeti:** satır başına ~37 bayt, yalnız yeni satırlarda (nullable sütun eklemek PostgreSQL'de anlık, tablo
  yeniden yazılmaz). `RiskEvent` dizini karar başına ~50 bayt.

---

## 13. Müşteriye görünen numara — nasıl gösterilir

| Yer | Bugün | Önerim |
|---|---|---|
| Ödeme ekranı, bizim sunucu hatası (5xx) | ✅ kurucu metni + kısa numara + "Takip numarasını kopyala" (`api.ts:206-212`, `paddle-plans.tsx:668`) | aynen |
| Ödeme ekranı, **kart reddi / Paddle hatası** | ❌ numara yok | Dilim B — **F2 sorusu** (yeni metin) |
| Diğer panel hataları | numara yalnız yanıt başlığında, ekranda yok (kurucu kararı) | aynen kalsın; destek girişi = konuşma bağlantısı / işletme + zaman |
| Misafir (QR) | yok | **asla** (misafir Lixus desteğine yazmaz) |
| E-posta (alarm) | operatöre giden alarm e-postasında var | aynen |

Biçim kuralları (bugünkü, korunur): ekranda **ilk 8 onaltılık karakter**, kopyalanan **tam numara**; arama ikisini de bulur. Teknik ayrıntı
(Paddle kodu, HTTP durumu) müşteriye gitmez (CLAUDE.md "müşteriye giden metin sade").

---

## 14. Önerilen sıra

| Sıra | Dilim | Neden bu sırada | Migration | Müşteriye giden değişir mi |
|---|---|---|---|---|
| 1 | **A** destek ekranı v2 | sonrakilerin kabı; bugünkü veriyle hemen işe yarar | 67 (yalnız `OperationalEvent` sütunları) | hayır |
| 2 | **B** ödeme tamamlama | kurucunun asıl istediği yer; "ödemem geçmedi"nin eksiği | 67'ye `WebhookEvent` | **evet** (F2 metni) |
| 3 | **C** otomatik cevap zinciri | ürünün kalbi; en çok destek sorusu ("AI neden cevap vermedi") | 67'ye `MessageOutbox`, `RiskEvent` | hayır |
| 4 | **G** Sentry etiketleri | küçük, bağımsız; C'nin numaralarını Sentry'ye bağlar | yok | hayır |
| 5 | **D** QR | C'nin `RiskEvent` bağıyla yarısı hazır | yok | hayır |
| 6 | **E** geçmişten öğren + bilgi tabanı | özellik kapalı; düşük risk | 67'ye `HistoryLearnRun` | hayır |
| 7 | **F** hesap silme + e-posta kuyruğu | düşük hacim; zamanlama sızıntısı kuralına dikkat | yok | hayır |
| 8 | **H** bütünlük mührü + KVKK | avukat cevabı + ayrı tablo | 68 (`OperationalEventDigest`) | hayır |

**Tek migration önerisi (67):** bütün nullable sütunlar + dizinler tek dosyada (dolu tabloya zorunlu kolon / unique yok; küçük tablolarda
düz dizin). Railway açılmadan önce taze yedek + açık onay (CLAUDE.md). Hazır yamadaki "KB istek kimliği" migration'ı da yeniden
numaralanmalı (65 dolu) — sıra çakışmasın diye o yama 68'den önce mi sonra mı, kurucuya F8'de soruluyor.

Her dilim için ortak kapılar: K2 (kırmızı-önce + iki yönlü mutasyon + gerçek PG + tam kapılar), Haiku dar inceleme, dilim sonunda Opus
derin kontrol; tam suit koşarken başka vitest koşulmaz (PG 5433).

---

## 15. Kurucuya sorular (kurucunun biçiminde)

### F1 — Destek ekranı: üç giriş + amaç (Dilim A)
- **Şu an ne yapıyorum:** Operatör panelinde yalnız takip numarasıyla arıyorum. Numarayı müşteri yalnız ödeme ekranında, bizim sunucu
  hatasında görüyor. Müşteri numarasız yazarsa ("dün akşam ödeme yaptım, olmadı") panelden bulamıyorum.
- **Büyük şirketler ne yapıyor:** Stripe günlükleri hem istek numarasıyla hem kaynak kimliğiyle (müşteri, ödeme) süzüyor; Intercom'da
  destek temsilcisi konuşmanın yanında müşterinin hesap bilgisini görüyor.
- **Önerim:** Üç giriş: numara · konuşma bağlantısı · işletme + son 24 saat. Her aramada "amaç" seçilir (destek talebi / olay incelemesi /
  ödeme sorunu) ve işletmenin denetim kaydına yazılır. Ekranda olaylar Türkçe adlarla, tek satır özetle.
- **ÖRNEK:** Müşteri yazıyor: "Dün 21:00 civarı ödeme yaptım, plan değişmedi" (numara yok). Operatör: işletme = o müşteri, zaman = dün
  20:00–23:59, amaç = ödeme sorunu → ekranda: "21:04 Ödeme ekranı açıldı (Pro) → 21:06 Paddle ödemenin başarısız olduğunu bildirdi →
  'ödemeniz işleniyor' kilidi kalktı · numara 7f3a91b2". Operatör cevabı: "Ödemeniz bankada reddedilmiş, başka kartla deneyebilirsiniz."
- **Böyle yapalım mı?**

### F2 — Kart reddinde ekranda takip numarası (Dilim B — müşteriye giden metin)
- **Şu an ne yapıyorum:** Numara yalnız bizim sunucumuz hata verince çıkıyor. Kart reddi Paddle'ın penceresinde oluyor; pencere kapanınca
  bizim ekranda numara yok. Kayıt arka planda var ama müşterinin elinde numara yok.
- **Büyük şirketler ne yapıyor:** Stripe ve Shopify her yanıtta istek numarası veriyor; destek "numarayı paylaşırsanız daha hızlı çözeriz"
  diyor.
- **Önerim:** Paddle penceresi ödeme başarısız olarak kapanınca ödeme ekranında: **"Ödemeniz alınamadı. Kart bilgilerinizi kontrol edip
  tekrar deneyin. Sorun sürerse destek ekibimize bu takip numarasıyla yazabilirsiniz: 7f3a91b2"** + "Takip numarasını kopyala".
- **ÖRNEK:** Müşteri: "ödemem geçmedi, numara 7f3a91b2". Operatör numarayı yazar → "21:04 Onay kaydedildi (Pro, aylık) → 21:04 ödeme
  ekranı açıldı → 21:06 Paddle: ödeme başarısız (banka reddi, işlem txn_01…) → kilit kalktı". Operatör: "Bankanız ödemeyi reddetmiş;
  başka kartla deneyebilir ya da bankanızı arayabilirsiniz."
- **Böyle yapalım mı?** (Metin müşteriye gidiyor — onayınız + ilk denemeyi Paddle test ortamında birlikte yapalım.)

### F3 — Otomatik cevap: deneme başına numara, konuşmayla arama (Dilim C)
- **Şu an ne yapıyorum:** Senkron bir işletmeyi tek numarayla işliyor; içindeki 25 misafir mesajı aynı numarada. "Bu mesaja neden cevap
  gitmedi" sorusunu panelden izleyemiyorum.
- **Büyük şirketler ne yapıyor:** OpenTelemetry standardında toplu iş tek iz sayılmaz; her mesaj kendi izini alır, toplu işe "bağ"la
  bağlanır. Shopify desteği kaynak kimliğini ve istek numarasını birlikte istiyor.
- **Önerim:** Her cevap denemesi kendi numarası; konuşma kimliğiyle aranır; numara müşteriye GÖSTERİLMEZ (kararınız aynen). Ev sahibi
  konuşmanın bağlantısını bize gönderir, panelde yapıştırırım. Kayıtta mesaj metni yok, yalnız kodlar.
- **ÖRNEK:** Ev sahibi: "Daire 3'teki misafirin dün 14:05 Wi-Fi sorusuna cevap gitmedi" + bağlantı. Operatör yapıştırır → "14:06 deneme 1:
  gönderim başarısız (Hospitable arızası) → 14:08 deneme 2: gönderildi" ya da "14:06 deneme 1: yapay zekâ insana bıraktı (sebep: emin
  değil, risk yok)". Cevap: "Mesaj 14:08'de gitti" / "Bilgi tabanında Wi-Fi şifresi yok, ekleyin".
- **Böyle yapalım mı?**

### F4 — QR sohbeti: yalnız iz, misafire numara yok (Dilim D)
- **Şu an ne yapıyorum:** QR sohbetinde hiçbir iz yok; hata olursa işletmeye bile bağlanmıyor.
- **Büyük şirketler ne yapıyor:** Son kullanıcıya (misafire) iç numara gösterilmez; numara yalnız destek ekibi ile müşteri (işletme)
  arasında kullanılır.
- **Önerim:** Her geçerli QR mesajı kendi numarası + konuşma kimliği + ev sahibine uyarı e-postasının sonucu. Misafire hiçbir şey
  gösterilmez; geçersiz bağlantı / kapalı sohbet hiç yazılmaz (saldırgan tabloyu dolduramasın).
- **ÖRNEK:** Ev sahibi: "Misafir QR'dan kombi arızası yazmış, bana e-posta gelmedi." Operatör konuşma bağlantısını yapıştırır → "22:10
  QR: insana devredildi (acil) → uyarı e-postası: gönderilemedi". Sonra e-posta sağlayıcısına bakılır.
- **Böyle yapalım mı?**

### F5 — Sentry: sürüm + alan + gizli işletme özeti (Dilim G)
- **Şu an ne yapıyorum:** Sentry'ye yalnız takip numarası etiketi gidiyor; hangi sürümde başladığı, hangi alanda olduğu, aynı müşteride
  mi tekrarladığı görünmüyor.
- **Büyük şirketler ne yapıyor:** Sentry etiketleri aranabilir anahtar–değer çiftleri; sürüm ve ortam standart alanlar.
- **Önerim:** sürüm (Railway commit), alan (ödeme / kuyruk / senkron…), işletmenin **anahtarlı özeti** (Sentry işletmeyi tanımaz, eşleşmeyi
  yalnız panel kurar) ve olay günlüğünde Sentry olay kimliği (iki yönlü bağ).
- **ÖRNEK:** Sentry'de "outbox-row" hatası 40 kez → `org_ref` etiketine bakılır: hepsi tek işletmede (ab12cd34ef56) → panelde o işletme
  satırı → bağlantısı iptal edilmiş; sistem geneli arıza değil.
- **Böyle yapalım mı?** (Müşteriye bir şey gitmiyor; yalnız bilgi veriyorum.)

### F6 — Günlük bütünlük mührü (Dilim H)
- **Şu an ne yapıyorum:** Olay kayıtları veritabanı tetikleyicisiyle korunuyor (değiştirme / erken silme reddi), ama veritabanı sahibi
  tetikleyiciyi kapatıp satır silerse kimse fark etmez.
- **Büyük şirketler ne yapıyor:** AWS CloudTrail saatlik "özet dosyası" üretir (her günlük dosyasının SHA-256 özeti, imzalı); sonradan
  değişen ya da silinen kayıt doğrulamada ortaya çıkar.
- **Önerim:** Her gün için işletme başına satır sayısı + SHA-256 özet ayrı tabloya; panelde "son 89 gün tutarlı" satırı; isterseniz günlük
  özet size e-postayla (veritabanı dışında bir kopya).
- **ÖRNEK:** Biri veritabanı konsolundan 12 Ekim'in 3 ödeme olayını silerse panel: "12 Ekim — Lale işletmesinde 3 satır eksik (özet
  tutmuyor)" der.
- **Böyle yapalım mı?** E-posta kopyası da istiyor musunuz?

### F7 — KVKK: olay kayıtları dökümde + misafir silmede (avukat)
- **Şu an ne yapıyorum:** Olay kayıtları işletmenin KVKK dökümüne girmiyor (avukat kararı bekliyor); misafir silmede dokunulmuyor
  (kayıtlarda misafir metni / adı yok).
- **Büyük şirketler ne yapıyor:** Kişisel veri taşımayan işlem kayıtlarını genelde süre sınırlı tutar; erişim kaydını müşteriye açar.
- **Önerim:** İşletmenin kendi olay satırları dökümde "işlem kayıtları" dosyası olarak yer alsın (denetim kaydı zaten giriyor). Misafir
  silinince olay satırları 90 güne kadar kalsın (yalnız opak konuşma kimliği + kodlar; RiskEvent ile aynı politika).
- **ÖRNEK:** İşletme dökümünde `islem-kayitlari.json`: `{ "zaman": "…", "olay": "Paddle bildirimi geldi", "numara": "7f3a91b2…" }` — ad,
  e-posta, mesaj yok.
- **Böyle yapalım mı?** (Avukat paketine iki madde olarak ekleyeyim mi?)

### F8 — Migration 67 tek paket + KB yamasının numarası
- **Şu an ne yapıyorum:** Takip numarası için 63 + 64 itildi. Hazır yamadaki "KB istek kimliği" migration'ı 65 diye yazılmış ama 65 ve 66
  artık başka işlerin.
- **Büyük şirketler ne yapıyor:** Şema değişikliklerini küçük, geri alınabilir ve yalnız-ekleme paketleriyle yaparlar.
- **Önerim:** Bütün yeni sütunlar (olay günlüğü kaynak / üst numara; kuyruk, ödeme olayı kaydı, risk kararı, geçmişten öğren çalıştırması
  numaraları) tek migration 67'de; hepsi boş bırakılabilir, dolu tabloya zorunlu kolon yok. KB yaması 68 olur.
- **ÖRNEK:** Railway açılınca açılışta 67 uygulanır; eski satırlarda sütunlar boş, eski kod aynen çalışır; yeni kod yalnız yeni satırlara
  numara yazar.
- **Böyle yapalım mı?** (Push öncesi taze yedek + açık onay kuralı aynen.)

---

## 16. Kanıt durumu (TEST-EVIDENCE-CONTRACT biçimi)

- **KOD:** yok — bu bir tasarım belgesi; depoya tek satır yazılmadı.
  ⚠️ (10-15 gece ek) Bu satır belgenin YAZILDIĞI ANI anlatır; ilk dilim (ödeme zinciri, migration 63) ve ikinci dilim (arka plan işleri)
  o tarihten önce zaten koddaydı — durum `docs/claude/durum.md` (10-12 gece) ve `docs/TASARIM-2026-10-10-correlation-id-takip-numarasi.md` §6.
- **CI / DEPLOY / PROD:** yok.
- **Ölçüm:** hacim tahmini hesaptır (satır boyu + 09-19 yedek sayımı), canlı veritabanında ölçülmedi (bu ortam canlıya bağlanmaz —
  kurucu kararı §5).
- Doğrulanması gerekenler: Paddle `transaction.payments[].error_code` alan adı ve Paddle.js `checkout.payment.failed` /
  `checkout.payment.error` olay adları (sandbox); `RAILWAY_GIT_COMMIT_SHA` çalışma anında dolu mu (Railway); Railway volume fiyatı ve
  Hobby tavanı (resmi sayfa).

## 17. Kaynaklar

- Stripe — Request IDs: https://docs.stripe.com/api/request_ids · Finding the ID for an API request:
  https://support.stripe.com/questions/finding-the-id-for-an-api-request · Request logs (Workbench, kaynak kimliğiyle süzme):
  https://docs.stripe.com/development/dashboard/request-logs · Log saklama süresi: https://support.stripe.com/questions/stripe-request-log-retention-period
- Shopify — x-request-id ve destek formu (topluluk, resmi belge değil): https://community.shopify.dev/t/developer-support-form/19981 ·
  https://community.shopify.com/t/taxesincluded-false-for-some-orders/77773
- Intercom — Error objects: https://developers.intercom.com/docs/references/rest-api/errors/error-objects · request_id örneği (topluluk):
  https://community.intercom.com/questions/5402 · Gelen kutusunda uygulamalar / müşteri verisi:
  https://www.intercom.com/help/en/articles/6546031-customize-the-inbox-with-apps · Özel nesneler:
  https://www.intercom.com/help/en/articles/6717853-view-custom-object-data-in-the-inbox · 7 günlük günlük erişimi (topluluk):
  https://community.intercom.com/mobile-sdks-24/start-a-conversation-programatically-stopped-working-6760
- W3C Trace Context: https://www.w3.org/TR/trace-context/ · Level 2 taslağı: https://www.w3.org/TR/2024/CRD-trace-context-2-20240328/
- OpenTelemetry mesajlaşma anlam kuralları: https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/ · span link deseni
  (ikincil): https://signoz.io/docs/traces-management/guides/span-links/ ·
  https://oneuptime.com/blog/post/2026-09-03-multiple-queue-messages-share-one-trace-id-span-links/view
- Paddle.js olayları: https://developer.paddle.com/paddle-js/events/checkout-payment-failed.md ·
  https://developer.paddle.com/changelog/2025/checkout-payment-error
- Sentry etiket sınırları: https://docs.sentry.io/platforms/node/enriching-events/tags
- AWS CloudTrail bütünlük doğrulaması: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-custom-validation.html ·
  https://docs.amazonaws.cn/en_us/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html
- Railway değişkenleri: https://docs.railway.com/reference/variables · volume fiyatı (üçüncü taraf):
  https://sota.io/blog/railway-vs-render-vs-fly-pricing-2026 · https://costbench.com/software/developer-tools/railway/
