# Lixus AI — Yol Haritası

> Türkiye odaklı, çok kiracılı SaaS. Airbnb/Booking misafir mesajlarını yapay
> zekâ ile yanıtlar; bireysel Türk hostlara satılır.
>
> **Değişmez kural:** Çalışan ürün bozulmaz — her ekleme *additive*, testli ve
> geri alınabilir. E-posta/para akışına dokunan adımlar onayla ve ilk canlı
> denemeler birlikte doğrulanarak açılır. (Ayrıntılı proje hafızası: `CLAUDE.md`.)
>
> Son güncelleme: 2026-06-15

---

## 📍 Fazlar

| Faz | Başlık | Durum |
|-----|--------|-------|
| **0** | Temel, Güvenlik, İzleme | ✅ Bitti |
| **1** | Ürün Derinliği & Tutundurma | 🔜 Sürüyor |
| **2** | Ödeme Sistemi (Paddle) | ✅ Altyapı + sandbox kanıtlı · enforcement açık |
| **3** | Dayanıklılık | 🔜 |
| **4** | Yasal Uyum (KVKK) | 🔜 Paralel |
| **5** | Ölçek (ekip, mobil, CRM) | 2027+ |

---

## ✅ Faz 0 — Temel, Güvenlik, İzleme

CI (GitHub Actions) · `/api/health` canlılık · audit log + operatör paneli (`/admin`) ·
KVKK veri export · UptimeRobot · Sentry · hata maili · apex/www domain · yedek branch.

---

## 🚀 Faz 1 — Ürün Derinliği & Tutundurma

Üründen alınan değeri artır, müşteriyi elde tut.

- [ ] **WhatsApp kanalı** — misafire WhatsApp üzerinden de yanıt
- [ ] **AI upsell** — erken giriş / geç çıkış / ekstra temizlik önerisi
- [ ] **Haftalık özet e-postası** — host'a performans raporu
- [ ] **Bilgi tabanı/SSS otomasyonu** genişletme

---

## 💳 Faz 2 — Ödeme Sistemi (Paddle, Merchant of Record)

İtalyan Partita IVA üzerinden faturalama → Iyzico kullanılamaz; **Paddle** seçildi
(KDV'yi her ülkede Paddle toplar/öder, TRY fiyat destekler). Iyzico kodu dormant fallback olarak durur.

**Fiyatlama — reverse trial:** kayıt → 14 gün tam **Pro** ücretsiz (kart yok) →
ödemezse "ücretsiz sürüme" düşer (panelleri gezer, ama otomatik mesajlaşma kapanır).
Aylık TRY: **Başlangıç ₺449 · Pro ₺899 · İşletme ₺1.699** (düz-tier).

- [x] Tablolar (`Plan`, `Subscription`, `Invoice`, `WebhookEvent`) + entitlement servisi
- [x] **Paddle** istemci + webhook (imza doğrulama, idempotent) + checkout UI
- [x] **Sandbox uçtan uca doğrulandı** (checkout → TL ödeme → webhook "Delivered" → Subscription)
- [x] **Reverse-trial motoru** + freemium (deneme bitince otomatik mesajlaşma kapanır; `BILLING_ENFORCED`)
- [x] **Self-serve kayıt açık** (`REGISTRATION_OPEN`) + e-posta doğrulama (anti-bot)
- [ ] **Production Paddle** — KYB sonrası prod fiyat/anahtar/webhook + ilk gerçek ödeme testi
- [ ] e-Arşiv/fatura akışı (mali müşavire danış)

> **Güvenlik:** Subscription satırı olmayan org = *grandfathered → sınırsız* →
> mevcut müşteri (ve kurucu) `BILLING_ENFORCED` açık olsa bile asla bloklanmaz.

---

## 🏗️ Faz 3 — Dayanıklılık

- [x] **Dependabot** (haftalık gruplu güncelleme PR'ları)
- [ ] **Mesaj dedup'unu DB kısıtına taşı** `@@unique([conversationId, externalId])` — *önce prod dedup* (dolu tabloya `@unique` boot'ta `db push`'ı patlatır)
- [ ] **`db push` → migration** geçişi (geri-alınabilir şema)
- [ ] **Sayfalama + indeksler** (gelen kutusu büyüdükçe)
- [ ] Sync kilidi için fencing-token / heartbeat

---

## ⚖️ Faz 4 — Yasal Uyum (KVKK)

- [ ] **OpenAI yurt dışı aktarımı** — DPA + KVKK Standart Sözleşme (misafir mesajı ABD'ye gidiyor; mekanizma şart — en keskin risk)
- [ ] **Host-tarafı veri silme** + saklama/imha politikası + otomatik temizleme
- [ ] **DPA + VERBİS** değerlendirmesi (Lixus = işleyen, host = sorumlu)
- [ ] **İhlal müdahale planı** (72 saat bildirim)
- [ ] **Az-yetkili + loglu destek aracı** (tam impersonation yerine)

---

## 🟣 Faz 5 — Ölçek

Ekip rolleri & atama · PWA/mobil · misafir CRM · akıllı kilit (Nuki) ·
white-label (ajans modeli) · 2. PMS adaptörü (Guesty/Hostaway).

---

## 🔑 Senin kararın/aksiyonun

| Konu | Not |
|------|-----|
| Production Paddle | KYB onayı + payout (IBAN) → prod fiyat/anahtar/webhook |
| Mali müşavir / avukat | e-fatura + KVKK metinleri + VERBİS |
| Demo video | `NEXT_PUBLIC_DEMO_VIDEO` env'ine embed URL |
