# Lixus AI — Railway Yayına Alma Rehberi

Uygulama **Railway** üzerinde Docker ile 7/24 çalışır; böylece otomatik yanıt ve
zamanlanmış senkron, siz uyurken / bilgisayarınız kapalıyken bile sürer.
Veritabanı **PostgreSQL**'dir (Railway'in yönetilen Postgres servisi).

> **Önemli:** Hiçbir gizli anahtarı repoya koymayın. Hepsi Railway panelindeki
> **Variables** bölümüne girilir. `claude/great-edison-3zqpZ` dalı Railway'e
> otomatik deploy olur.

---

## 1) Proje ve veritabanı

1. <https://railway.app> → **Login with GitHub** → **New Project** → **Deploy from GitHub repo** → `musaxd57/SaaS-Ultimitly`.
2. Aynı projeye **+ New → Database → PostgreSQL** ekleyin. Railway `DATABASE_URL`'i otomatik üretir; uygulama servisine referans verin.

Build, depodaki **Dockerfile** ile yapılır. Boot komutu sabittir:
`npx prisma migrate deploy && npm run start` — önce commit'lenmiş migration'lar
uygulanır (`prisma/migrations/`; şema-diff YOK), sonra `npm run start`'ın
`prestart` kancası ortam doğrulamasını çalıştırır (`scripts/verify-env.mjs` —
production'da eksik/placeholder `AUTH_SECRET` veya eksik `ENCRYPTION_KEY`
boot'u temiz şekilde durdurur), en son Next.js başlar. `PORT`'u elle
eklemeyin (Railway verir). Sağlık kontrolü `railway.json` ile `/api/health`'e
bağlıdır: yeni container 200 dönmeden trafik almaz.

## 2) Ortam değişkenleri (Variables)

**Zorunlu çekirdek**

| Değişken | Değer |
|---|---|
| `DATABASE_URL` | Railway Postgres bağlantı dizesi (`postgresql://…`) |
| `AUTH_SECRET` | Güçlü rastgele değer (`openssl rand -base64 32`) — oturum imza anahtarı |
| `ENCRYPTION_KEY` | ZORUNLU, `AUTH_SECRET`'ten FARKLI güçlü rastgele değer — saklanan token'ları şifreler; boot kapısı eksikse/aynıysa başlatmaz. ASLA değiştirmeyin (kayıtlı token'lar okunamaz olur) |
| `CRON_SECRET` | Güçlü rastgele değer — zamanlayıcı ucunu korur |
| `SUPERADMIN_EMAILS` | Operatör (süper-admin) e-postaları, virgülle |
| `PRIMARY_ORG_ID` | Kurucu org id'si — env Hospitable token'ını yalnızca bu org kullanır (yeni müşteriler kurucu verisine erişemez) |

**Hospitable + AI**

| Değişken | Değer |
|---|---|
| `HOSPITABLE_API_TOKEN` | Primary org için Hospitable kişisel erişim token'ı |
| `OPENAI_API_KEY` | OpenAI anahtarı (boşsa şablon fallback) |
| `OPENAI_MODEL` | `gpt-5.1` |

**E-posta (şifre kodu / uyarı mailleri)** — Resend tercih edilir, yoksa SMTP:

| Değişken | Değer |
|---|---|
| `RESEND_API_KEY` / `RESEND_FROM` | Resend anahtarı + doğrulanmış gönderen adresi |
| `EMAIL_HOST/PORT/USER/PASS/FROM` | (alternatif) SMTP ayarları |
| `ALERT_EMAIL` | Şikayet/hata uyarılarının gideceği adres |

**Özellik şalterleri + izleme**

| Değişken | Değer |
|---|---|
| `REGISTRATION_OPEN` | `1` → public self-serve kayıt açık |
| `AUTO_REPLY_ENABLED` | `1` → otomatik yanıt master şalteri açık |
| `GUEST_CHAT_ENABLED` | `1` → QR misafir concierge global açık |
| `QR_ESCALATION_EMAIL_ENABLED` | `1` → QR sohbeti eskalasyona düşünce host'a e-posta (varsayılan KAPALI; içerikte misafir metni yok, olay başına dedupe, alıcı org alertEmail → owner) |
| `QR_PIN_ENABLED` | `1` → rezervasyona özel QR sohbet PIN'i (Faz 5, varsayılan KAPALI). Host rezervasyon başına 6 haneli kod üretir; misafir sohbeti cihazında açmak için kodu girer. KAPALI deploy mevcut sohbetleri değiştirmez; PIN'siz eski rezervasyonlar ilk-tarayan cihaz-bağlama akışında kalır (org "strict" moda geçmedikçe) |
| `QR_PIN_PEPPER` | QR PIN HMAC pepper'ı. **`QR_PIN_ENABLED=1` iken prod'da ZORUNLU** (boot gate: eksik/placeholder/<32 karakter/AUTH_SECRET'e eşit ise başlatmayı reddeder — AUTH_SECRET fallback prod'da kullanılmaz). Feature kapalıyken gerekmez. Rotasyonu tüm PIN'leri geçersiz kılar (host yeniden üretir) — kısa ömürlü kod olduğu için kabul edilebilir |
| `DATA_RETENTION_MONTHS` | KVKK: bu aydan eski misafir PII'si (ad/mesaj) otomatik anonimleştirilir (ör. `24`). Boş = kapalı |
| `TRIAL_EMAILS_ENABLED` | `1` → deneme-hatırlatma mailleri açık (varsayılan KAPALI/dormant). Açmadan önce ilk gönderimi birlikte doğrulayın |
| `TRIAL_REMINDER_DAYS` | Deneme bitmeden kaç gün kala "bitiyor" maili gider (varsayılan `1` = 1 gün önce). Mailler yalnızca `BILLING_ENFORCED=true` **ve** `TRIAL_EMAILS_ENABLED=1` iken gider |
| `APP_BASE_URL` | Cron mailleri için panel linki tabanı (varsayılan `https://www.lixusai.com`) |
| `SENTRY_DSN` | Hata izleme (opsiyonel) |
| `NEXT_PUBLIC_WHATSAPP` / `NEXT_PUBLIC_DEMO_VIDEO` | Landing WhatsApp numarası / demo video embed (opsiyonel) |

**Ödeme (Paddle — Merchant of Record)**

| Değişken | Değer |
|---|---|
| `PADDLE_ENV` / `NEXT_PUBLIC_PADDLE_ENV` | `sandbox` veya `production` |
| `PADDLE_API_KEY` · `PADDLE_WEBHOOK_SECRET` | API anahtarı + aktif webhook destination'ın signing secret'ı (`pdl_…`) |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | Paddle.js checkout client token'ı |
| `PADDLE_PRICE_BASLANGIC` · `PADDLE_PRICE_PRO` · `PADDLE_PRICE_ISLETME` | TRY plan fiyat id'leri |
| `BILLING_ENFORCED` | `true` → paywall devrede (boş = herkes serbest). Açmadan önce ilk gerçek ödemeyi doğrulayın. |

## 3) Deploy + domain

1. İlk deploy: boot'taki `prisma migrate deploy` migration zincirini (00→N) uygular ve tabloları kurar.
2. **Settings → Networking** → custom domain (**www** kullanın; apex Cloudflare ile www'ye 301 yönlenir).

## 4) Zamanlayıcı (otomatik senkron + gece yanıtı)

Otomatik yanıtın kendi kendine çalışması için `/api/cron/sync` düzenli çağrılmalı.
Uygulama ayrıca kendi içinde 2 dakikalık bir yedek cron çalıştırır, ama dış bir
zamanlayıcı da önerilir (**cron-job.org**, ücretsiz):

- **URL:** `https://<domain>/api/cron/sync`
- **Schedule:** her 5 dakikada bir (`*/5 * * * *`)
- **Header:** `Authorization: Bearer <CRON_SECRET>`

Uç nokta yanlış secret'ta **401** döner. Otomatik yanıt yalnızca **aktif saat
aralığında** ve oto-yanıt **açıkken** gönderir; aksi halde sadece yeni mesajları çeker.

## 5) Paddle webhook (ödeme aktifse)

Paddle → **Notifications → Destination:**
`https://www.lixusai.com/api/webhooks/paddle` (mutlaka **www** — apex 301 verir,
Paddle 3xx takip etmez). Destination'ın signing secret'ını (`pdl_…`)
`PADDLE_WEBHOOK_SECRET`'a girin. Test ödemesi → log **"Delivered" (200)** olmalı.

---

## 6) Durable Outbox (#8) — opsiyonel, DEFAULT KAPALI

`DURABLE_OUTBOX_ENABLED` **girici mesaj gönderimini kalıcı outbox durum makinesiyle**
yönetir: mesaj + gönderim-niyeti aynı transaction'da yazılır, bir worker
claim/retry/reconcile ile teslim eder (process çökmesi/timeout/çoklu-replika daha
sağlam). **Boş/`0` = KAPALI → canlı gönderim yolu bugünkü claim-then-send ile birebir
aynı** (hiçbir risk yok).

**Outbound yol kapsamı (hangi gönderim gerçekten outbox'a gidiyor):**

| Yol | Outbox'ta mı? | Not |
|-----|---------------|-----|
| Manuel host yanıtı (Mesajlar → Yanıtla) | ✅ Bağlı | conversation + Message var; `messageType:"manual"` → worker teslimde "answered" yapar |
| AI oto-yanıt (`applyChannelAutoReply`) | ✅ Bağlı | güvenlik kapısından SONRA enqueue; `senderName "GuestOps AI"` + `messageType:"ai"`; #6: teslimde answered |
| Holding-ack (Tier-2) | ✅ Bağlı (m30) | `messageType:"holding_ack"` → worker teslimde thread'i "problem" TUTAR (deliveryEffect: none); best-effort |
| Welcome / checkin / checkout | ✅ Bağlı (m30) | PROAKTİF (`enqueueProactive`): conversation/Message YOK; `*SentAt` YALNIZ teslimde worker'ca damgalanır; key `{tip}:{org}:{sourceReference}` → replay/restart tek gönderim; lifecycle veto (cancelled/completed/already-sent/window) |
| QR misafir sohbeti yanıtı | ⛔ Hariç | iç (web) mesaj, dış sağlayıcıya gitmez — outbox'a bilinçli GİRMEZ |

Aynı rezervasyonun manuel + AI + lifecycle mesajları AYNI advisory claim-lock ve ortak
2 mesaj/dk/rezervasyon sınırını paylaşır (rate cap `(org, externalReservationId)` üzerinden;
lifecycle `externalReservationId = sourceReference`). Exactly-once İDDİA YOK: Hospitable
idempotency-key yok → ambiguous sonuç güvenilir doğrulanamıyorsa `review`'da kalır.

**Sağlayıcı idempotency:** Hospitable send-message endpoint'i idempotency-key
belgelemiyor → **"exactly once" garantisi YOK.** Worker `reconcile` (üretim yolu,
`defaultReconcile`) BİLİNÇLİ TUTUCU: dış rezervasyonda güvenilir sağlayıcı-id eşleşmesi
olmadığı için gövde+zaman benzerliğiyle **ASLA "sent" işaretlemez** → satır `ambiguous`
kalır, deneme bitince `review` (manuel). Yani: intent kaybolmaz, definitive failure
güvenli retry, ambiguous (timeout/5xx) **kör resend YOK**. Kalan teorik duplicate penceresi
(send başarılı ama yanıt kayıp) provider-key olmadan kapatılamaz — o yüzden `review`.

**Rezervasyon hız sınırı (Hospitable 2 mesaj/dk/rezervasyon):** claim SQL ATOMİK olarak
her (org, rezervasyon) için 60 sn'de en fazla 2 sağlayıcı çağrısına izin verir
(`ROW_NUMBER` pencere-sıralaması + son-60sn `claimedAt` sayımı; `rn + recent <= 2`). 3.
kayıt sonraki pencereye kalır. Çoklu-replika altında `FOR UPDATE SKIP LOCKED` + commit'li
okuma ile atomik (ayrıca prod'da drain tek sync-kilidi altında). **429** → sağlayıcının
`Retry-After`'ına (yoksa bounded backoff) ERTELENİR ve **terminal deneme SAYILMAZ** (rate
fırtınası gerçek mesajı `failed` yapamaz).

**AI gönderim-anı vetosu (enqueue-öncesi kapı TEK BAŞINA yetmez):** worker, bir AI satırını
POST'lamadan HEMEN ÖNCE canlı thread'i yeniden okur. Host manuel yanıt verdiyse / AI durakladıysa
(`autoReplyHoldUntil`) / konuşma insana devredildiyse (`problem`/`closed`) / kaynak mesajın
üstüne yeni mesaj geldiyse → **provider çağrısı YAPILMAZ**; satır açık `canceled` durumuna
geçer (asla sent/failed görünmez) ve teslim edilmemiş AI taslağı Message silinir (ne hayalet
balon ne "already answered" baskısı). Manuel host yanıtı ASLA vetolanmaz (host bilerek yazdı).

**Lifecycle (welcome/checkin/checkout) kesinti + rollback davranışı (final-review düzeltmeleri):**
`*SentAt` YALNIZ DOĞRULANMIŞ teslimde damgalanır (provider success / güvenilir reconciliation) —
`review`/ambiguous'ta ASLA (doğrulanmamış veriyle sahte "sent" yok). **Hospitable 402 = "abonelik
aktif değil"** GEÇİCİ kesinti DEĞİL, KALICI entegrasyon-duraklaması (Nuve'nin canlı hesabı şu an
tam da bu durumda) → satır ayrı, terminal-olmayan **`blocked`** durumuna gider: bir daha CLAIM
edilmez (her scheduler pass'te provider çağrısı/pager YOK), attempt limitini TÜKETMEZ (claim'in
+1'i geri alınır) ve YALNIZ ilk geçişte tek `outbox-blocked` secretsız ops sinyali üretir. Org'un
Hospitable sync'i tekrar **başarılı** olduğunda (= abonelik yine aktif; 402 sync'i throw eder)
`reactivateBlockedOutbox(orgId)` blocked satırları atomik + tenant-scoped biçimde `pending`'e alır →
worker bir KEZ dener. `enqueueProactive` re-enqueue'da ARTIK diriltme YAPMAZ (402 yolu bu blocked/
reactivate mekanizmasıdır; failed→pending geçişi kaldırıldı). Terminal validation/auth 4xx
(400/401/403/404/422) `failed`'e gider ve ASLA dirilmez (istek hep başarısız → döngü yok). Belirsiz
(5xx/timeout) satır `review`'da park kalır. Flag ON→OFF **rollback duplicate'i** sahte `*SentAt` ile
DEĞİL, flag-OFF sender'ın outbox kaydına **fence** etmesiyle önlenir: (org, reservation, tip) için
`failed` HARİÇ bir kayıt varsa (pending/sending/ambiguous/reconciling/review/sent/canceled/**blocked**)
direct sender ikinci POST atmaz (pending/reactivate'i worker zaten flag-OFF drain eder). ⏳
**Gözlemlenebilirlik:** host ops ekranı **`/sent/queue` "Gönderim Kuyruğu"** (owner/manager; staff
göremez) TÜM outbox satırlarını — proaktif lifecycle dahil — durum filtresi + sayfalama ile gösterir;
PII'siz (mesaj gövdesi/misafir verisi/claim token asla). blocked satırda "abonelik pasif" açıklaması,
review/ambiguous salt-okuma; yalnız kesin-gönderilememiş `failed` (402 hariç) satırda tenant-bound
"Yeniden dene". Ek sinyaller: terminal/park geçişte **secretsız reportError** (tenant + outbox id +
tip; body/guest YOK) + `messageDelivery` export'u + thread rozeti "Abonelik pasif — bağlantı gelince
gönderilecek".

**Açma adımları (hazır olunca — para/gönderim hot-path'i, İLK gönderimleri BİRLİKTE doğrula):**
1. Deploy zaten migration `29_message_outbox`'ı uygular (additive, boş tablo).
2. Worker in-process scheduler'da (2-dk) koşar; ayrı env gerekmez.
3. `DURABLE_OUTBOX_ENABLED=1` ekle → manuel yanıt VE AI oto-yanıt outbox'a gider.
4. Bir yanıt gönder; DB'de `MessageOutbox` satırının `pending → sent` olduğunu
   ve `Message.externalId`'nin worker sonrası dolduğunu doğrula. `review`/`failed`
   satırları takılı gönderimleri gösterir (elle incele); `blocked` = Hospitable aboneliği
   pasif (Nuve'nin şu anki durumu) — sync yeniden başarılı olunca otomatik `pending`'e
   alınıp bir kez denenir. Inbox thread'inde mesajın "Sırada → İletildi" rozetini takip et.
5. Kapatmak (acil rollback) için env'i sil → YENİ gönderimler eski yola döner AMA
   worker bekleyen `pending/sending/ambiguous` satırları **flag KAPALIYKEN DE** boşaltmaya
   devam eder (`hasDrainableOutbox`, Codex #1) → kuyruğa alınmış mesaj asla mahsur kalmaz.

## 7) Private object storage (S3/R2) — opsiyonel, DEFAULT KAPALI

Görev fotoğrafları bugün `public/uploads/{org}` altında **yerel diskte** ve **public statik
URL** ile duruyor (Railway diski ephemeral → deploy'da silinebilir + link herkese açık). Bu özellik
fotoğrafları **private bir S3/R2 bucket**'ına taşır ve yalnız **kısa ömürlü (5 dk, en fazla 15 dk)
imzalı URL** ile sunar. **Henüz bucket yok** → kod hazır, flag KAPALI, gerçek sağlayıcı çağrısı YOK
(testler in-memory fake adaptörle koşar).

**İki bağımsız kapı (bilinçli):**
- `storageConfigured()` = sağlayıcı kimlik bilgileri var mı → **okuma (imzalı GET) + silme kuyruğu**
  drain'ini yönetir. Flag'i kapatsan bile bucket'taki mevcut fotoğraflar çalışmaya devam eder.
- `storageUploadsEnabled()` = `STORAGE_ENABLED` AÇIK **VE** yapılandırılmış → yalnız **YENİ upload**'ları
  yönetir. Kapalıyken upload birebir eski yerel-disk yoluna gider.

**Env (yalnız `STORAGE_ENABLED` açıkken ZORUNLU — prestart gate doğrular, değer basılmaz):**
`STORAGE_ENABLED` (1/true) · `STORAGE_ENDPOINT` (https:// — R2: `https://<acc>.r2.cloudflarestorage.com`) ·
`STORAGE_BUCKET` · `STORAGE_ACCESS_KEY_ID` · `STORAGE_SECRET_ACCESS_KEY` · `STORAGE_REGION` (ops.; R2=`auto`).

**Object key = kiracı sınırı:** `org/{organizationId}/task/{taskId}/{ts}-{random}.{ext}`. Key HER
ZAMAN sunucuda oturum/DB kimliklerinden kurulur (istemciden ASLA), her tüketici `isSafeObjectKey`
(traversal/escape reddi) + org segmenti-oturum eşleşmesi ile yeniden doğrular. Fotoğrafın DB'deki
değeri same-origin `/api/storage/photo/<key>` (mevcut `taskUpdateSchema` doğrulamasını geçer, render
değişmez); serve route bunu **imzalı GET**'e 302 ile çözer — public URL YOK.

**Silme kuyruğu (`StorageDeletion`, org FK'sı YOK — cascade'den sağ çıkar):** görev-silme + hesap-silme
objeyi öksüz bırakan DB işlemiyle **AYNI transaction**'da silme NİYETİNİ yazar → sağlayıcı asla kritik
yolda değil (kesinti DB işlemini ne bloklar ne de sessiz sızıntıya çevirir). Drain (scheduled-sync,
her pass) idempotent: sağlayıcı hatasında satır `pending` kalır + backoff (ASLA sahte "deleted");
yapılandırılmamışsa sessizce atlar (satırlar bekler). Hesap-silme: niyet kaydı transaction'la atomik
→ org silinirse niyet mutlaka var, org silme rollback olursa hiç niyet yazılmaz.

**LEGACY GEÇİŞ / FALLBACK STRATEJİSİ (kural):** Mevcut `/uploads` dosyaları **taşınmaz ve silinmez** —
bu tur SADECE ileriye dönük. Eski `photoUrl`'ler (`/uploads/...`) doğrudan statik olarak sunulmaya
devam eder (serve route yalnız `/api/storage/photo/` önekli key'leri tanır; legacy'e dokunmaz),
silme kuyruğu yalnız storage-önekli satırları hedefler, hesap-silmedeki yerel `rm` legacy klasörünü
eskisi gibi temizler. Açtıktan sonra: eski fotoğraflar zamanla doğal olarak (görev/hesap silindikçe)
tükenir; toplu geri-doldurma (backfill) yapılırsa ayrı bir tur + [KARAR] olarak ele alınmalı (bugün YOK).

**Açma adımları (bucket hazır olunca — ilk gerçek upload'ı BİRLİKTE doğrula):**
1. R2/S3'te **private** bucket aç (public erişim KAPALI), scoped access key üret.
2. Yukarıdaki env'leri Railway'e ekle, `STORAGE_ENABLED=1`. Prestart gate eksik/`http` olanı reddeder.
3. Bir göreve fotoğraf yükle → DB `TaskUpdate.photoUrl` `/api/storage/photo/org/.../...` olmalı,
   bucket'ta obje görünmeli, panelde foto imzalı URL ile açılmalı.
4. Bir görevi sil → `StorageDeletion` satırı `pending` → sonraki sync'te `deleted`, bucket'tan gitmeli.
5. Rollback: `STORAGE_ENABLED`'ı sil → YENİ upload'lar eski yerel yola döner; bucket'taki fotoğraflar
   VE bekleyen silmeler (kimlik bilgileri durdukça) çalışmaya devam eder.

---

## 8) Claude kalite üst-denetçisi — opsiyonel, anahtar yoksa PASİF

Operatör panelindeki "AI Kalite Denetçisi (Claude — gölge)" kartı. **Salt-okuma gölge denetim:**
gönderilmiş AI yanıtlarını (misafir adı/e-posta/telefon redakte edilmiş hâlde) Claude'a
değerlendirtir; rapor + prompt/test önerisi döner. Claude mesaj GÖNDEREMEZ, prompt DEĞİŞTİREMEZ —
öneriler ancak insan onayıyla koda işlenir. Canlı misafir motoru gpt-5.1 olarak kalır.

| Env | Zorunlu | Açıklama |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | özellik için evet | console.anthropic.com API anahtarı. Yokken kart pasif metin gösterir; boot/health etkilenmez. |
| `QUALITY_AUDIT_MODEL` | hayır | Varsayılan `claude-opus-4-8`. |

Açılış: anahtarı Railway'e ekle → redeploy → /admin kartından "Denetimi çalıştır" (1-2 dk sürebilir;
tek senkron çağrı, boş örneklemde API'ye hiç gidilmez). Her çalıştırma denetim kaydına düşer
(`admin.quality_audit`). Not: geniş müşteri verisinde düzenli kullanım öncesi DPA/KVKK aktarım
kararı gerekir (CLAUDE.md LEGAL listesi).

---

## Özet akış

```
cron-job.org ──(5 dk, Bearer CRON_SECRET)──▶ /api/cron/sync
                                               │ Hospitable'dan yeni mesajları çek
                                               │ aktif saat + oto-yanıt açıksa → güvenli cevapları gönder
Paddle ──────(www webhook, imzalı)─────────▶ /api/webhooks/paddle → Subscription/Invoice
```
