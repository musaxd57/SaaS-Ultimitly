# GuestOps AI

Airbnb, Booking ve kısa dönem kiralama yöneten küçük/orta ölçekli işletmeler için
**AI destekli operasyon platformu**. Misafir iletişimi, temizlik operasyonu,
check-in/out akışı, görev yönetimi, otomatik hatırlatma ve gelir raporunu tek
panelde birleştirir.

> **Temel prensip:** Platformların kurallarını aşmaz. AI karar verici değil,
> **yardımcı operatördür** — sadece öneri üretir, son kararı kullanıcı verir.

Bu repo, dokümandaki **REALISTIC MVP** kapsamına göre üretilmiş, **çalışan ve
production-ready bir MVP**'dir: sade UI, dark mode/animasyon yok, AI yalnızca cevap
önerisi yapar, otomasyon sabit kurallarla çalışır.

---

## ✨ Özellikler (MVP)

| Modül | Açıklama |
|-------|----------|
| **Panel (Dashboard)** | AI günlük operasyon özeti, bugünkü giriş/çıkışlar, bekleyen mesajlar, acil görevler, doluluk |
| **Mesajlar (Inbox)** | Konuşma kutusu, **AI cevap önerisi** (ton seçimi, güven skoru, risk uyarısı), tek tıkla onayla & gönder |
| **Rezervasyonlar** | Manuel rezervasyon girişi, kanal/durum yönetimi, filtreleme |
| **Takvim** | Mülk bazlı 14 günlük doluluk zaman çizelgesi (giriş/çıkış işaretli) |
| **Görevler** | Temizlik/bakım/check-in görevleri için Kanban board, atama, durum takibi |
| **Mülkler** | Mülk ayarları, check-in/out saatleri, temizlik tamponu |
| **Bilgi Tabanı** | Mülke özel Wi-Fi, giriş talimatı, kurallar vb. — AI bu bilgilerle konuşur |
| **Raporlar** | Doluluk, gelir, mesaj/görev metrikleri, en sık konular |

### AI Operasyon Asistanı
- Misafir mesajını **sınıflandırır** (intent + öncelik) ve **cevap taslağı** üretir.
- **OpenAI opsiyoneldir.** `OPENAI_API_KEY` yoksa **deterministik şablon fallback**
  devreye girer — uygulama API anahtarı olmadan da tam çalışır.
- **Prompt-injection korumalı:** misafir mesajı veri olarak işlenir, içindeki
  talimatlar uygulanmaz. Bilgi yoksa uydurmaz; finansal/kritik konuları "risk" olarak
  işaretleyip yöneticiye yönlendirir.

### Sabit Kurallı Otomasyon (fixed rules)
- **Yeni rezervasyon** → otomatik check-in hazırlık + çıkış temizliği görevi.
- **Şikayet algılandı** → konuşma "sorunlu" olarak işaretlenir, öncelik "acil"e çekilir,
  bakım görevi açılır.

---

## 🧱 Teknoloji

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** + shadcn tarzı bileşenler (Radix bağımlılığı yok, sade)
- **Prisma ORM** + **SQLite** (geliştirme için sıfır-konfig; Postgres'e taşınabilir)
- **jose** (JWT oturum) + **bcryptjs** (şifre hash) — özel hafif auth
- **Zod** (doğrulama), **multi-tenant** (organizasyon bazlı veri izolasyonu)

---

## 🚀 Hızlı Başlangıç

```bash
# 1. Bağımlılıklar
npm install

# 2. Ortam değişkenleri
cp .env.example .env
#   AUTH_SECRET değerini değiştirin. OPENAI_API_KEY opsiyonel (boş bırakılabilir).

# 3. Veritabanını oluştur + örnek veri
npm run db:push
npm run db:seed

# 4. Geliştirme sunucusu
npm run dev
# → http://localhost:3000
```

### Demo giriş
```
E-posta: demo@guestops.ai
Şifre:   demo1234
```
(Login ekranında hazır gelir.)

---

## 📜 Komutlar

| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Production build (`prisma generate` + `next build`) |
| `npm run start` | Production sunucusu |
| `npm test` | Testleri çalıştır (Vitest) |
| `npm run test:watch` | Testleri izleme modunda çalıştır |
| `npm run typecheck` | TypeScript tip kontrolü (`tsc --noEmit`) |
| `npm run db:push` | Şemayı veritabanına uygula |
| `npm run db:seed` | Örnek veriyi yükle |
| `npm run db:reset` | DB'yi sıfırla + yeniden seed |
| `npm run db:studio` | Prisma Studio (veri görüntüleyici) |

---

## 🧪 Testler

Vitest ile **56 test** (7 birim + 1 entegrasyon dosyası). Harici API gerektirmez;
entegrasyon testleri geçici bir SQLite veritabanı (`prisma/test.db`) oluşturur.

```bash
npm test
```

Kapsam:
- **AI fallback** — niyet sınıflandırma, cevap üretimi, **prompt-injection güvenliği**
  (misafir mesajındaki talimatlar uygulanmaz; finansal talepler "risk" işaretlenir).
- **AI prompt'ları** — sistem prompt'unun güvenlik kuralları + veri sınırı.
- **Otomasyon motoru** — rezervasyon → 2 görev, şikayet → eskalasyon (gerçek DB).
- **Raporlar** — operasyon istatistikleri, aylık gelir/görev metrikleri, org izolasyonu.
- **Doğrulama** — Zod şemaları, tarih/format kuralları.
- **Auth** — JWT oturum imzala/doğrula, şifre hash/karşılaştır.
- **Sabitler & yardımcılar** — etiket/ton eşlemeleri, biçimlendirme.

---

## 🗂 Proje Yapısı

```
src/
  app/
    (auth)/            # login, register
    (app)/             # panel, inbox, reservations, calendar, tasks, properties, knowledge, reports
    api/               # REST route handlers (auth, properties, reservations, conversations, tasks, kb, reports)
  components/
    ui/                # button, card, input, select, badge, ... (tasarım sistemi)
    inbox/ tasks/ ...  # modül bileşenleri
  lib/
    ai/                # prompt'lar, suggestReply, classify, deterministik fallback
    auth/              # JWT oturum, şifre, session yardımcıları
    automation.ts      # sabit kurallı otomasyon
    db.ts              # Prisma client
    reports.ts         # operasyon/gelir istatistikleri
    validators.ts      # Zod şemaları
    constants.ts       # enum benzeri sabitler + etiketler
prisma/
  schema.prisma        # veri modeli
  seed.ts              # örnek veri
tests/
  unit/                # AI fallback, prompts, validators, auth, utils, constants
  integration/         # otomasyon + raporlar (gerçek SQLite)
  helpers/ stubs/      # test yardımcıları, server-only stub
```

---

## 🔌 API (özet)

`/api/auth/{login,register,logout}` ·
`/api/properties[/:id]` ·
`/api/reservations[/:id]` ·
`/api/conversations[/:id]` · `/:id/reply` · `/:id/messages` · `/:id/ai-suggest` ·
`/api/tasks[/:id]` ·
`/api/kb[/:id]` ·
`/api/reports/{daily,monthly,ops}`

Tüm uç noktalar oturum + organizasyon bazlı yetki kontrolünden geçer.

---

## 🐘 PostgreSQL'e Geçiş

MVP varsayılanı SQLite'tır. Production için:

1. `prisma/schema.prisma` içinde `datasource db` → `provider = "postgresql"`.
2. `.env` → `DATABASE_URL="postgresql://user:pass@host:5432/guestops?schema=public"`.
3. `npx prisma migrate dev` çalıştırın.

Şema Postgres-uyumlu yazılmıştır (enum benzeri alanlar String, JSON alanları String
olarak saklanır; istenirse native enum/`Json` tipine yükseltilebilir).

---

## 🧭 Kapsam Notu (REALISTIC MVP)

İlk sürümde **bilinçli olarak yok**: tam otomatik kanal entegrasyonu, fiyat
optimizasyonu, dinamik kanal senkronu, microservice/queue mimarisi, gelişmiş RBAC,
vector DB, görsel workflow builder, BI dashboard.

**Sonraki adımlar (V2+):** Resmi WhatsApp Business API, e-posta/ICS rezervasyon içe
aktarma, şablon kütüphanesi, çok dilli otomatik çeviri, fotoğraf yükleme (S3),
gelişmiş raporlama.
