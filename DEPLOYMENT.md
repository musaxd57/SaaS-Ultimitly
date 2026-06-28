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
`npx prisma db push --skip-generate && npm run start` — yani şema her açılışta
veritabanına uygulanır, sonra Next.js başlar. `PORT`'u elle eklemeyin (Railway verir).

## 2) Ortam değişkenleri (Variables)

**Zorunlu çekirdek**

| Değişken | Değer |
|---|---|
| `DATABASE_URL` | Railway Postgres bağlantı dizesi (`postgresql://…`) |
| `AUTH_SECRET` | Güçlü rastgele değer (`openssl rand -base64 32`) — oturum + şifreleme anahtarı |
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
| `DATA_RETENTION_MONTHS` | KVKK: bu aydan eski misafir PII'si (ad/mesaj) otomatik anonimleştirilir (ör. `24`). Boş = kapalı |
| `TRIAL_REMINDER_DAYS` | Deneme bitmeden kaç gün kala "bitiyor" maili gider (varsayılan `2`). Mailler yalnızca `BILLING_ENFORCED=true` iken gönderilir |
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

1. İlk deploy: boot'taki `prisma db push` tabloları kurar.
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

## Özet akış

```
cron-job.org ──(5 dk, Bearer CRON_SECRET)──▶ /api/cron/sync
                                               │ Hospitable'dan yeni mesajları çek
                                               │ aktif saat + oto-yanıt açıksa → güvenli cevapları gönder
Paddle ──────(www webhook, imzalı)─────────▶ /api/webhooks/paddle → Subscription/Invoice
```
