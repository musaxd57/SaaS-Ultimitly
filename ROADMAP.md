# Lixus AI — 5 Yıllık Yol Haritası

> Türkiye odaklı, çok kiracılı (multi-tenant) SaaS. Kısa dönem kiralama
> hostları için Airbnb/Booking misafir mesajlarını yapay zekâ ile otomatik
> yanıtlar. B2C — bireysel Türk hostlara satılır. (İşletme: Nuve, ~10 daire.)
>
> **Değişmez kural:** Çalışan ürün **bozulmayacak**. Her ekleme *additive*
> (üzerine ekleme), testli ve geri alınabilir olur. Riskli adımda önce
> yedek + onay, ilk canlı denemeler birlikte doğrulanır.
>
> Son güncelleme: 2026-06-09 · Toplam **6 faz** (Faz 0 → Faz 5)
> *(Faz 2–5 detayları kullanıcının onayladığı orijinal plandan birebir.)*

---

## 📍 Fazların Özeti

| Faz | Başlık | Ana Hedef | Zaman |
|-----|--------|-----------|-------|
| **0** | Temel, Güvenlik, İzleme | Sağlam zemin: izleme, yedek, ilk araçlar | ✅ Bugün (2026 Q2) |
| **1** | Ürün Derinliği & Tutundurma | Daha çok değer + müşteriyi elde tutma | 2026 Q3 |
| **2** | **Ödeme Sistemi** | Otomatik abonelik + plan limiti + fatura | ~3–4 hafta (anahtarınla) |
| **3** | Dayanıklılık | 5-yıl sağlamlık: veri bütünlüğü, performans | 2026 Q4 – 2027 Q1 |
| **4** | Yasal Uyum (KVKK) | Paralel; çoğu doküman/avukat işi | Faz 2 ile paralel |
| **5** | Sonra (büyüdükçe) | Ekip, mobil, CRM, white-label | 2027+ |

---

## ✅ Faz 0 — Temel, Güvenlik, İzleme  *(BUGÜN — neredeyse bitti)*

**Kod (eklendi, canlıda, yedekli):**
- [x] **CI** (GitHub Actions) — her değişiklikte otomatik test
- [x] **Marka rebrand** — Lixus AI (e-posta/hata/takvim)
- [x] **`/api/health`** — site/DB/cron canlılık ölçümü
- [x] **Audit log** — operatör impersonation izi *(Faz 4 "loglu destek"in temeli)*
- [x] **Denetim paneli** (/admin)
- [x] **KVKK veri export (operatör)** *(Faz 4 "veri export"un ilk parçası)*

**Dış servisler:**
- [x] **UptimeRobot** · **Sentry** (`node` projesi) · **Hata maili** (`ALERT_EMAIL`)
- [x] **apex domain** (www'suz lixusai.com) · **GitHub yedek branch** `backup/stable-2026-06-09`
- [ ] **Railway Pro + otomatik Postgres yedeği** ← *akşam alınacak*

---

## 🚀 Faz 1 — Ürün Derinliği & Tutundurma  *(2026 Q3)*

**Amaç:** Üründen alınan değeri artır, müşteriyi elde tut. Para almadan önce
ürünü "bırakılamaz" yap.

- [ ] **WhatsApp kanalı** — misafirle WhatsApp üzerinden de yanıt
- [ ] **AI upsell** — erken giriş / geç çıkış / ekstra temizlik satışını AI önersin
- [ ] **Haftalık özet e-postası** — host'a performans raporu → düzenli geri dönüş
- [ ] **Çoklu dil genişletme** + **bilgi tabanı/SSS** otomasyonu

> ⚠️ E-posta ve para akışına dokunan her şey **senin onayınla**, ilk gönderimler
> **birlikte doğrulanarak** açılır.

---

## 💳 Faz 2 — Ödeme Sistemi  *(senin kararın + anahtarın, ~3–4 hafta)*

**Iyzico** (Türkiye'de Stripe yok; Iyzico'nun yerel abonelik ürünü var —
otomatik tahsilat + webhook). Yedek: **PayTR**.

- [ ] **Yeni tablolar** (hepsi additive/güvenli): `Plan`, `Subscription`, `Invoice`, `WebhookEvent`
- [ ] **Plan limiti** (mülk sayısı 1–2 / 3–7 / 8+) + **paywall** (operatör/impersonation **hep muaf**)
- [ ] **e-Arşiv fatura** (özel entegratör Paraşüt vb. — başta elle; mali müşavire danış)
- [ ] **Self-serve kayıt + ödeme akışı** (şu an kayıt kapalı; açılacak)

> ⚠️ **En kritik risk:** canlı müşterileri yanlışlıkla paywall'a düşürmemek →
> mevcut org'ları **"aktif" backfill ŞART.**

**🔑 Senin başlatman gerekenler (BUGÜN — onay gün alır):**
Iyzico iş hesabı + API anahtarı · mali müşavir (e-fatura) · avukat (metinler).

---

## 🏗️ Faz 3 — Dayanıklılık  *(5-yıl sağlamlık)*

- [ ] **Reservation benzersizlik kısıtı** `@@unique([propertyId, sourceReference])` — **önce dedup, sonra ekle**
- [ ] **`db push` → migration geçişi** (şema değişiklikleri geri-alınabilir olsun)
- [ ] **Dependabot** (Prisma 7 / Next 16 güncellemeleri planlı)
- [ ] **Sayfalama + indeksler** (gelen kutusu büyüdükçe yavaşlamasın)
- [ ] **Şifreleme anahtarı versiyonlama** (rotasyon kilitleme yapmadan)

---

## ⚖️ Faz 4 — Yasal Uyum (KVKK)  *(paralel; çoğu doküman/avukat işi)*

- [ ] **Veri export/silme araçları** (KVKK m.11 — host'un misafir verisini silmesi)
      *(operatör export'u Faz 0'da yapıldı; host-tarafı silme kalan parça)*
- [ ] **Saklama/imha politikası** + eski mesajları otomatik temizleme
- [ ] **DPA + VERBİS değerlendirmesi** (Lixus = işleyen, host = sorumlu) — avukat/mali müşavir
- [ ] **İhlal müdahale planı** (KVKK 72 saat bildirimi)
- [ ] **Az-yetkili + loglu destek aracı** — operatör müşteri sorununu sınırlı yetkiyle çözsün
      *(şu an tam impersonation = çok yetki; audit log temeli Faz 0'da atıldı)*

---

## 🟣 Faz 5 — Sonra (büyüdükçe)

Ekip rolleri & görev atama · PWA/mobil · Misafir CRM (tekrar gelen misafir) ·
Akıllı kilit (Nuki) · White-label (ajans modeli) · Instagram/e-posta birleşik kutu.

---

## 🔑 Anahtar/Karar Gerektirenler (sende)

| Konu | Ne zaman | Not |
|------|----------|-----|
| Railway Pro + yedek | Bu akşam | ~$20/ay, otomatik Postgres yedeği |
| Iyzico iş hesabı | **Bugün başlat** | Faz 2 önkoşulu; sandbox anahtarıyla erken kodlanabilir |
| Mali müşavir | Bugün başlat | İşletme yapısı + e-fatura (Iyzico kayıtlı işletme ister) |
| Avukat | Bugün başlat | KVKK + mesafeli satış metinleri, VERBİS |
| Demo video | Faz 4'ten önce | landing `NEXT_PUBLIC_DEMO_VIDEO` |
