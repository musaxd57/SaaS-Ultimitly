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
| Manuel host yanıtı (Mesajlar → Yanıtla) | ✅ Bağlı | conversation + Message var; worker teslimde "answered" yapar |
| AI oto-yanıt (`applyChannelAutoReply`) | ✅ Bağlı | güvenlik kapısından SONRA enqueue; `senderName "GuestOps AI"` + AI metadata korunur; #6: teslimde answered |
| Holding-ack (Tier-2) | ⏳ Ertelendi | opt-in + best-effort + şikayet zaten eskale; worker `markConversationDelivered`'ı "problem"i "answered"a ÇEVİRİR → migration 30 (`markAnsweredOnDelivery`) gerekir |
| Welcome / checkin / checkout | ⏳ Ertelendi | proaktif, rezervasyon-kapsamlı; bugün YEREL Message/conversation OLUŞTURMAZ → migration 30 (opsiyonel `conversationId`) + proaktif/sync-dedup kararı gerekir |
| QR misafir sohbeti yanıtı | ⛔ Hariç | iç (web) mesaj, dış sağlayıcıya gitmez — outbox'a bilinçli GİRMEZ |

Ertelenen yollar kanıtlanmış claim-then-send yolunda kalır (her biri tek tek doğru).
İkisi de migration 30'luk tek bir sonraki artımdır (kullanıcı yanındayken).

**Sağlayıcı idempotency:** Hospitable send-message endpoint'i idempotency-key
belgelemiyor → **"exactly once" garantisi YOK.** Worker `reconcile` (üretim yolu,
`defaultReconcile`) BİLİNÇLİ TUTUCU: dış rezervasyonda güvenilir sağlayıcı-id eşleşmesi
olmadığı için gövde+zaman benzerliğiyle **ASLA "sent" işaretlemez** → satır `ambiguous`
kalır, deneme bitince `review` (manuel). Yani: intent kaybolmaz, definitive failure
güvenli retry, ambiguous (timeout/5xx) **kör resend YOK**. Kalan teorik duplicate penceresi
(send başarılı ama yanıt kayıp) provider-key olmadan kapatılamaz — o yüzden `review`.

**Açma adımları (hazır olunca — para/gönderim hot-path'i, İLK gönderimleri BİRLİKTE doğrula):**
1. Deploy zaten migration `29_message_outbox`'ı uygular (additive, boş tablo).
2. Worker in-process scheduler'da (2-dk) koşar; ayrı env gerekmez.
3. `DURABLE_OUTBOX_ENABLED=1` ekle → manuel yanıt VE AI oto-yanıt outbox'a gider.
4. Bir yanıt gönder; DB'de `MessageOutbox` satırının `pending → sent` olduğunu
   ve `Message.externalId`'nin worker sonrası dolduğunu doğrula. `review`/`failed`
   satırları takılı gönderimleri gösterir (elle incele). Inbox thread'inde mesajın
   "Sırada → İletildi" rozetini takip et.
5. Kapatmak (acil rollback) için env'i sil → YENİ gönderimler eski yola döner AMA
   worker bekleyen `pending/sending/ambiguous` satırları **flag KAPALIYKEN DE** boşaltmaya
   devam eder (`hasDrainableOutbox`, Codex #1) → kuyruğa alınmış mesaj asla mahsur kalmaz.

---

## Özet akış

```
cron-job.org ──(5 dk, Bearer CRON_SECRET)──▶ /api/cron/sync
                                               │ Hospitable'dan yeni mesajları çek
                                               │ aktif saat + oto-yanıt açıksa → güvenli cevapları gönder
Paddle ──────(www webhook, imzalı)─────────▶ /api/webhooks/paddle → Subscription/Invoice
```
