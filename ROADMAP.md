# Lixus AI — Yol Haritası

> Türkiye odaklı, çok kiracılı SaaS. Airbnb/Booking misafir mesajlarını yapay
> zekâ ile yanıtlar; bireysel Türk hostlara satılır.
>
> **Değişmez kural:** Çalışan ürün bozulmaz — her ekleme *additive*, testli ve
> geri alınabilir. E-posta/para akışına dokunan adımlar onayla ve ilk canlı
> denemeler birlikte doğrulanarak açılır. (Ayrıntılı proje hafızası: `CLAUDE.md`.)
>
> Son güncelleme: 2026-06-23

---

## 🎯 Gerçek durum: kod hazır, iş başlamadı

Mühendislik bir MVP'nin ~%90'ı — paneller cilalı, güvenlik kapısı sağlam, billing/
reverse-trial canlı, Paddle production kuruldu, ~438 test yeşil. **Ama henüz tek
ödeyen müşteri yok ve çekirdek özellik (oto-yanıt) gerçek müşteride canlı denenmedi.**
Asıl belirsizlik kodda değil, burada. Sıradaki gerçek iş (önem sırasıyla):

1. **Çekirdeği canlı doğrula** — `AUTO_REPLY_ENABLED=1` artık açık; Hospitable
   yenilenince Nuve'nin kendi dairelerinde **ilk gerçek gönderimleri birlikte izle**.
2. **Kendi ürününü kullan** bir hafta — sonra **1 tanıdık host'a** ücretsiz kur,
   gerçek geri bildirim al (para vermeden "kullanır mıydın?").
3. **Paddle'da küçük bir gerçek ödeme** test et (zincir prod'da da çalışsın).
4. Paralelde **avukat/mali müşavir** (KVKK Standart Sözleşme + e-fatura).

---

## 📍 Fazlar

| Faz | Başlık | Durum |
|-----|--------|-------|
| **0** | Temel, Güvenlik, İzleme | ✅ Bitti |
| **1** | Ürün Derinliği & Tutundurma | 🔜 Çekirdek launch-hazır; ek özellikler sırada |
| **2** | Ödeme (Paddle) | ✅ Production CANLI · kalan: ilk gerçek ödeme |
| **3** | Dayanıklılık | 🔜 |
| **4** | Yasal Uyum (KVKK) | 🟡 Kod kısmı yapıldı · sözleşme/VERBİS avukatta |
| **5** | Ölçek (ekip, mobil, CRM) | 2027+ |

---

## ✅ Faz 0 — Temel (bitti)
CI · `/api/health` · audit log + operatör paneli · KVKK export · Sentry · UptimeRobot ·
apex→www · yedek branch · **SEO** (sitemap/robots/JSON-LD, www-canonical, Search Console).

## 🚀 Faz 1 — Ürün Derinliği
Çekirdek (oto-yanıt + güvenlik kapısı + görevler/Kanban + raporlar + QR concierge +
returning-guest) **launch-hazır ve cilalı.** Sıradaki ek özellikler:
- [ ] **WhatsApp kanalı** — misafire WhatsApp'tan da yanıt
- [ ] **AI upsell** — erken giriş / geç çıkış / ekstra temizlik önerisi
- [ ] **Haftalık özet e-postası** — host'a performans raporu
- [ ] **Demo video** — `NEXT_PUBLIC_DEMO_VIDEO` env'ine embed URL

## 💳 Faz 2 — Ödeme (Paddle, MoR)
İtalyan Partita IVA → Iyzico kullanılamaz; **Paddle** (KDV'yi toplar/öder, TRY destekler).
Reverse-trial: 14 gün Pro ücretsiz → ödemezse "ücretsiz sürüme" düşer (oto-mesajlaşma kapanır).
Fiyat: **₺449 / ₺899 / ₺1.699** (düz-tier, İşletme 25 daireye kadar).
**✅ Yapıldı:** tablolar + entitlement · webhook (imza/idempotent) + checkout UI · sandbox
uçtan-uca · reverse-trial + freemium (`BILLING_ENFORCED` canlı) · self-serve kayıt + e-posta
doğrulama · **KYB onayı GEÇTİ + production env CANLI** (pdl_live key, www webhook aktif).
- [ ] **İlk gerçek ödeme testi** (prod price id + secret teyidi + küçük canlı ödeme birlikte)
- [ ] e-Arşiv/fatura akışı (mali müşavire danış)

> Subscription'ı olmayan org = *grandfathered → sınırsız* → mevcut müşteri ve kurucu asla bloklanmaz.

## 🏗️ Faz 3 — Dayanıklılık
- [x] Dependabot
- [ ] **Mesaj dedup'unu DB kısıtına taşı** `@@unique([conversationId, externalId])` — *önce prod dedup* (dolu tabloya `@unique` boot'ta patlar)
- [ ] **`db push` → migration** geçişi
- [ ] Gelen kutusu **sayfalama** (veri büyüdükçe)
- [ ] Sync kilidi için fencing-token / heartbeat

## ⚖️ Faz 4 — Yasal Uyum (KVKK)
**✅ Kod kısmı yapıldı:** Terms'e veri-işleyen (DPA) maddesi · retention/anonimleştirme
(`DATA_RETENTION_MONTHS`, env-gated) · hesap silme route'u + Ayarlar kartı.
**⏳ Senin/avukatın (para almadan ölçeklenmeden ÖNCE):**
- [ ] **OpenAI DPA** imzala (dashboard'da tek form — ucuz, bugün yapılabilir)
- [ ] **KVKK Standart Sözleşme** (OpenAI ABD aktarımı) + Kurul'a 5 iş günü bildirim
- [ ] **VERBİS** kaydı değerlendirmesi
- [ ] İhlal müdahale planı (72 saat bildirim) · `legal-entity.ts` [parantez] alanları

## 🟣 Faz 5 — Ölçek (2027+)
Ekip rolleri & atama · PWA/mobil · misafir CRM · akıllı kilit (Nuki) · white-label ·
**2. PMS adaptörü (Guesty/Hostaway)** — Hospitable tek-nokta bağımlılığını azaltır.

---

## 🔑 Senin kararın/aksiyonun
| Konu | Durum / Not |
|------|-------------|
| Çekirdeği canlı doğrula | `AUTO_REPLY_ENABLED=1` açık → Hospitable yenilenince ilk gönderimleri birlikte izle |
| İlk gerçek ödeme | Paddle prod CANLI → küçük gerçek ödemeyi birlikte test |
| İlk müşteri | 1 tanıdık host'a kur, geri bildirim al (asıl risk: birisi öder mi?) |
| Avukat / mali müşavir | OpenAI DPA + KVKK Standart Sözleşme + VERBİS + e-fatura |
| Hospitable | Nuve aboneliği bitik (402) → yenilenince veri canlanır |
