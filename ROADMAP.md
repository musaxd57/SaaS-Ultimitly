# Lixus AI — 5 Yıllık Yol Haritası

> Türkiye odaklı, çok kiracılı (multi-tenant) SaaS. Kısa dönem kiralama
> hostları için Airbnb/Booking misafir mesajlarını yapay zekâ ile otomatik
> yanıtlar. B2C — bireysel Türk hostlara satılır.
>
> **Değişmez kural:** Çalışan ürün **bozulmayacak**. Her ekleme *additive*
> (üzerine ekleme), testli ve geri alınabilir olur. Riskli bir şey varsa
> önce yedek + onay.
>
> Son güncelleme: 2026-06-09 · Toplam **6 faz** (Faz 0 → Faz 5)

---

## 📍 Fazların Özeti

| Faz | Başlık | Ana Hedef | Tahmini Zaman |
|-----|--------|-----------|----------------|
| **0** | Temel, Güvenlik, İzleme | Sağlam zemin — izleme, yedek, hukuki araçlar | ✅ Bugün (2026 Q2) |
| **1** | Ürün Derinliği & Tutundurma | Daha çok değer + müşteriyi elde tutma | 2026 Q3 (1–3 ay) |
| **2** | Para Altyapısı (Monetizasyon) | Otomatik abonelik + fatura + self-serve satış | 2026 Q3–Q4 |
| **3** | Ölçek & Güvenilirlik | Çok müşteride çökmeden, hızlı çalışma | 2026 Q4 – 2027 Q1 |
| **4** | Büyüme & Pazarlama | Yeni müşteri kazanımı, otomatik onboarding | 2027 |
| **5** | Olgunluk & Kurumsallaşma | Ekip, mobil, kurumsal, yurt dışı | 2027–2029 |

---

## ✅ Faz 0 — Temel, Güvenlik, İzleme  *(BUGÜN — neredeyse bitti)*

**Amaç:** Üzerine güvenle inşa edebileceğimiz sağlam bir zemin.

**Kod (eklendi, canlıda, yedekli):**
- [x] **CI** (GitHub Actions) — her değişiklikte otomatik test, bozuk kod canlıya gidemez
- [x] **Marka rebrand** — e-posta/hata/takvimde "Lixus AI"
- [x] **`/api/health`** — site/DB/cron canlılık ölçümü
- [x] **Audit log** — operatör bir hesaba girince iz kalır
- [x] **Denetim paneli** (/admin) — bu izleri görüntüleme
- [x] **KVKK veri export** — bir müşterinin tüm verisini JSON indir

**Dış servisler (birlikte kuruldu):**
- [x] **UptimeRobot** — çökersen haber verir (`www.lixusai.com/api/health`)
- [x] **Sentry** — hata izleme (`node` projesi Railway'e bağlı)
- [x] **Hata maili** — `ALERT_EMAIL` → musacinar2009@gmail.com
- [x] **apex domain** — www'suz `lixusai.com` çalışıyor
- [x] **GitHub yedek branch** — `backup/stable-2026-06-09` (donmuş kopya)
- [ ] **Railway Pro + otomatik Postgres yedeği** ← *akşam alınacak*

---

## 🚀 Faz 1 — Ürün Derinliği & Tutundurma  *(2026 Q3)*

**Amaç:** Üründen alınan değeri artır, müşteriyi elde tut (retention).
Para almadan önce ürünü "bırakılamaz" hale getir.

- [ ] **WhatsApp kanalı** — misafirle WhatsApp üzerinden de konuşma/yanıt
- [ ] **AI upsell önerileri** — erken giriş / geç çıkış / ekstra temizlik gibi
      satışları AI'nin uygun anda önermesi (ek gelir hostlara)
- [ ] **Haftalık özet e-postası** — host'a performans raporu (kaç mesaj,
      kaç otomatik yanıt, doluluk) → düzenli geri dönüş, tutundurma
- [ ] **Çoklu dil genişletme** — misafirin diline otomatik yanıtı güçlendir
- [ ] **Bilgi tabanı / SSS otomasyonu** — host kendi cevaplarını öğretsin

> ⚠️ E-posta ve para akışına dokunan her şey **senin onayınla** ve ilk
> gönderimler **birlikte doğrulanarak** açılır.

---

## 💳 Faz 2 — Para Altyapısı (Monetizasyon)  *(2026 Q3–Q4)*

**Amaç:** Müşteri kendi kaydolsun, otomatik ödesin, fatura kessin.
**Bu fazın hazırlığı BUGÜN paralel başlamalı** (hesap onayları gün alır).

- [ ] **Iyzico abonelik entegrasyonu** — recurring (otomatik aylık tahsilat)
- [ ] **Plan/paket yapısı** — örn. Başlangıç / Pro / İşletme + kullanım limitleri
- [ ] **Self-serve kayıt + ödeme akışı** — şu an kayıt kapalı; açılacak
- [ ] **e-Arşiv / e-fatura** — özel entegratör (Paraşüt vb.) ile otomatik fatura
- [ ] **Hukuki metinler (avukat onaylı)** — KVKK aydınlatma + açık rıza +
      mesafeli satış sözleşmesi + iade/gizlilik politikası
- [ ] **VERBİS kaydı** (gerekirse)

**🔑 Senin başlatman gerekenler (BUGÜN):**
- **Iyzico iş hesabı** başvurusu (şirket/şahıs + IBAN + evrak) → onay birkaç gün
- **Mali müşavir** randevusu (e-fatura/entegratör kurulumu)
- **Avukat** randevusu (yukarıdaki metinler + VERBİS)

---

## 📈 Faz 3 — Ölçek & Güvenilirlik  *(2026 Q4 – 2027 Q1)*

**Amaç:** 10 değil 100+ müşteride bile çökmeden, hızlı ve tutarlı çalışmak.

- [ ] **Reservation `@@unique` kısıtı** + veri tekilleştirme (önce prod'da dedup)
- [ ] **Prisma migrate history'ye geçiş** (`db push` yerine kontrollü migration)
- [ ] **Kuyruk/worker mimarisi** — sync ve AI işleri arka planda, sıraya girerek
- [ ] **PostHog analytics** — hangi özellik ne kadar kullanılıyor (ürün kararları)
- [ ] **Rate limiting + sağlam hata kurtarma** — API kötüye kullanımına karşı
- [ ] **Yük testleri** — çok kiracılı senaryoda performans ölçümü

---

## 🌱 Faz 4 — Büyüme & Pazarlama  *(2027)*

**Amaç:** Yeni müşteriyi otomatik kazan ve dakikalar içinde kur.

- [ ] **Demo video** + landing iyileştirme + **SEO**
- [ ] **Onboarding sihirbazı** — yeni host 5 dakikada kendi kurar
- [ ] **Referans / affiliate programı** — mevcut hostlar yeni host getirsin
- [ ] **Yeni entegrasyonlar** — Hospitable dışı PMS/kanallar
- [ ] **Çoklu para birimi** — yurt dışına açılım hazırlığı

---

## 🏛️ Faz 5 — Olgunluk & Kurumsallaşma  *(2027–2029)*

**Amaç:** Tek kişilik üründen kurumsal platforma.

- [ ] **Ekip/rol yönetimi** — host'un çalışanları için yetkiler
- [ ] **Gelişmiş AI** — otomasyon kuralları, host stilini öğrenen yanıtlar
- [ ] **Mobil uygulama**
- [ ] **Güvenlik sertifikasyonları** — kurumsal müşteriler için
- [ ] **Açık API / marketplace** — 3. parti eklentiler

---

## 🔑 Anahtar/Karar Gerektirenler (özet — sende)

| Konu | Ne zaman | Not |
|------|----------|-----|
| Railway Pro + yedek | Bu akşam | ~$20/ay, otomatik Postgres yedeği |
| Iyzico iş hesabı | **Bugün başlat** | Onay gün alır; Faz 2'nin önkoşulu |
| Mali müşavir | Bugün başlat | e-fatura/entegratör |
| Avukat | Bugün başlat | KVKK + mesafeli satış metinleri, VERBİS |
| Demo video | Faz 4'ten önce | landing'de `NEXT_PUBLIC_DEMO_VIDEO` |

> **Çalışma şekli:** "Bana söyle, ben kodlarım." Her faz maddesi additive +
> testli eklenir, mevcut çalışan ürün **bozulmaz**. Riskli adımlarda önce
> yedek alınır, ilk canlı denemeler birlikte doğrulanır.
