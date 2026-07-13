# Lixus AI

**Airbnb & Booking misafir mesajlarınızı yapay zekâ yanıtlasın — 7/24, güvenle, misafirin kendi dilinde.**

Kısa dönem kiralama hostları için çok kiracılı (multi-tenant) SaaS. Misafir
iletişimini, temizlik/giriş-çıkış operasyonunu ve görev yönetimini tek panelde
toplar; gelen misafir mesajlarına gece gündüz, misafirin kendi dilinde,
**siz uyurken bile** cevap verir.

> **Temel ilke:** AI karar verici değil, **yardımcı operatördür.** Şikayet, iade
> ve riskli mesajlar her zaman insana bırakılır; otomatik cevap yalnızca güvenli,
> yüksek-güvenli sorulara gider.

---

## ✨ Özellikler

| Modül | Açıklama |
|-------|----------|
| **Panel** | Günlük AI operasyon özeti, bugünkü giriş/çıkışlar, bekleyen mesajlar, bağlantı durumu |
| **Mesajlar** | Airbnb/Booking konuşmaları, AI cevap önerisi (ton + güven skoru + risk uyarısı), tek tıkla onayla & gönder |
| **Otomatik yanıt** | Güvenli sorulara gece/gündüz otomatik cevap — şikayet/iade/risk her zaman insana |
| **Misafir Sohbetleri (QR)** | Daireye asılan QR → public concierge sohbeti; AI bilgi tabanından yanıtlar, çözemezse host'a iletir |
| **Görevler** | Temizlik/bakım/giriş hazırlığı için Kanban; rezervasyondan otomatik üretilir |
| **Mülkler & Bilgi Tabanı** | Daire ayarları + Wi-Fi/giriş talimatı/kurallar — AI ve oto-mesajlar bu bilgiyle konuşur |
| **İptaller** | İptal edilen rezervasyonlar; bekleyen görevleri otomatik temizler |
| **Raporlar** | AI performansı, şikayet yoğunluğu, doluluk, en sık sorulan konular |
| **Ayarlar & Abonelik** | AI sesi/üslubu, otomasyon tercihleri, 2FA, abonelik (Paddle) |

### AI Güvenlik Kapısı

Otomatik cevap, üst üste beş kontrolü geçmeden **asla** gönderilmez:
`source == openai` · şikayet/iade/erken-çıkış **intent blocklist** · anahtar-kelime
çapraz kontrolü · **güven ≥ 0.75** · master + daire-bazı açık/kapalı şalter.
Misafir mesajı veri olarak işlenir (prompt-injection korumalı); bilgi yoksa uydurmaz.

### Diğer

Çok kiracılı izolasyon + operatör impersonation · per-tenant şifreli Hospitable
token · reverse-trial + **Paddle** abonelik (Merchant of Record) · KVKK veri export ·
2FA (TOTP) · e-posta doğrulama · tekrar gelen misafir rozeti.

---

## 🧱 Teknoloji

**Next.js 15** (App Router) · **React 19** · **TypeScript** · **Prisma 6** +
**PostgreSQL** · **Tailwind CSS** · **Zod** · **jose** (JWT) + **bcryptjs** ·
**Vitest**. Deploy: **Railway** (Docker).

---

## 🚀 Hızlı Başlangıç

Yerelde bir **PostgreSQL** veritabanı gerekir (Docker, yerel kurulum veya bir bağlantı dizesi).

```bash
npm install
cp .env.example .env            # AUTH_SECRET + DATABASE_URL ayarlayın

npm run db:push                 # şemayı LOKAL veritabanına uygula (uzak DB'ye guard engel olur)
npm run db:seed                 # örnek veri

npm run dev                     # → http://localhost:3000
```

`OPENAI_API_KEY` opsiyoneldir; boşsa deterministik şablon fallback devreye girer
(uygulama anahtar olmadan da çalışır, üretimde gerçek model kullanılır).

### Örnek giriş (seed)

```
E-posta: demo@guestops.ai
Şifre:   demo1234
```

---

## 📜 Komutlar

| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Production build (`prisma generate` + `next build`) |
| `npm start` | Production sunucusu |
| `npm test` | Testleri çalıştır (Vitest) |
| `npm run typecheck` | TypeScript tip kontrolü |
| `npm run db:push` | Şemayı veritabanına uygula (yalnız lokal DB; `ALLOW_PROD_SEED=1` kaçış) |
| `npm run db:seed` | Örnek veriyi yükle |
| `npm run db:reset` | DB'yi sıfırla + yeniden seed |
| `npm run db:studio` | Prisma Studio |

---

## 🧪 Testler

Vitest — **61 test dosyası, 446 test** (birim + entegrasyon). Entegrasyon testleri gerçek bir
PostgreSQL test veritabanı kullanır. Kapsam: AI güvenlik kapısı, otomasyon motoru,
tenant izolasyonu, billing/entitlement, auth/2FA, raporlar, doğrulama.

```bash
npm test
```

---

## 📁 Proje Yapısı

```
src/app/(app)/      panel, mesajlar, misafir-sohbetleri, görevler, mülkler,
                    bilgi-tabanı, raporlar, iptaller, ayarlar, admin
src/app/api/        REST route handler'ları (auth, conversations, hospitable,
                    tasks, billing webhooks, chat/[token], cron, ...)
src/lib/            ai/ · auth/ · billing/ · payments/ · automation.ts ·
                    scheduled-sync.ts · hospitable-sync.ts
prisma/             schema.prisma · seed.ts
tests/              unit/ · integration/ · helpers/
```

---

## 🚢 Yayına Alma

Railway üzerinde 7/24 çalıştırma, ortam değişkenleri ve zamanlayıcı kurulumu için
→ **[DEPLOYMENT.md](./DEPLOYMENT.md)**. Ürün yol haritası → **[ROADMAP.md](./ROADMAP.md)**.
