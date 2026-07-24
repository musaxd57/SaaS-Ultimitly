# Lixus AI — Yol Haritası

> Türkiye odaklı, çok kiracılı SaaS. Airbnb/Booking misafir mesajlarını yapay
> zekâ ile yanıtlar; bireysel Türk hostlara satılır.
>
> **Değişmez kural:** Çalışan ürün bozulmaz — her ekleme *additive*, testli ve
> geri alınabilir. E-posta/para akışına dokunan adımlar onayla ve ilk canlı
> denemeler birlikte doğrulanarak açılır. (Ayrıntılı proje hafızası: `CLAUDE.md`.)
>
> Son güncelleme: 2026-07-22

---

## 🎯 Gerçek durum: kod hazır, iş başlamadı

Mühendislik bir MVP'nin ~%90'ı — paneller cilalı, güvenlik kapısı sağlam, billing/
reverse-trial canlı, Paddle production'da **gerçek ödemeyle uçtan uca doğrulandı**
(2026-07-18: Başlangıç gerçek kartla alındı → in-app Pro upgrade), 1.500+ test yeşil.
**Ama henüz dışarıdan ödeyen müşteri yok ve çekirdek özellik (oto-yanıt) gerçek
misafirde canlı denenmedi** (Nuve'nin Hospitable aboneliği 402/pasif). Asıl belirsizlik
kodda değil, burada. Sıradaki gerçek iş (önem sırasıyla):

1. **Çekirdeği canlı doğrula** — `AUTO_REPLY_ENABLED=1` açık; Hospitable
   yenilenince Nuve'nin kendi dairelerinde **ilk gerçek gönderimleri birlikte izle**.
2. **Kendi ürününü kullan** bir hafta — sonra **1 tanıdık host'a** ücretsiz kur,
   gerçek geri bildirim al (para vermeden "kullanır mıydın?").
3. ~~Paddle'da küçük bir gerçek ödeme test et~~ ✅ 2026-07-18 (satın alma + upgrade canlı).
4. Paralelde **avukat/mali müşavir** — OpenAI DPA ✅ imzalandı (07-18); kalan:
   KVKK Standart Sözleşme + VERBİS + e-fatura.

---

## 📍 Fazlar

| Faz | Başlık | Durum |
|-----|--------|-------|
| **0** | Temel, Güvenlik, İzleme | ✅ Bitti |
| **1** | Ürün Derinliği & Tutundurma | 🔜 Çekirdek launch-hazır; ek özellikler sırada |
| **2** | Ödeme (Paddle) | ✅ Production CANLI · gerçek ödeme + upgrade doğrulandı (07-18) |
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
doğrulama · **KYB onayı GEÇTİ + production env CANLI** (canlı Paddle anahtarı, www webhook aktif).
- [x] **İlk gerçek ödeme testi** ✅ 2026-07-18 — Başlangıç gerçek kartla satın alındı, in-app Pro upgrade doğrulandı (Paddle dashboard: MRR/abone/işlem kanıtlı)
- [ ] e-Arşiv/fatura akışı (mali müşavire danış)

> Subscription'ı olmayan org = *grandfathered → sınırsız* → mevcut müşteri ve kurucu asla bloklanmaz.

## 🏗️ Faz 3 — Dayanıklılık
- [x] Dependabot
- [x] **Mesaj dedup DB kısıtında** ✅ m18-20 (Message/Reservation/Subscription unique'leri; prod önce temizlendi 2026-07-13)
- [ ] Conversation `@@unique([propertyId, externalReservationId])` — aynı protokol (önce prod dupe kontrolü), ayrı migration turu
- [x] **`db push` → migration** geçişi (boot `migrate deploy`, 17 migration, CI migration-chain kapısı)
- [ ] Gelen kutusu **sayfalama** (veri büyüdükçe)
- [x] Sync kilidi fencing-token ✅ (SystemLock, m6)

## ⚖️ Faz 4 — Yasal Uyum (KVKK)
**✅ Kod kısmı yapıldı:** Terms'e veri-işleyen (DPA) maddesi · retention/anonimleştirme
(`DATA_RETENTION_MONTHS`, env-gated) · hesap silme route'u + Ayarlar kartı.
**⏳ Senin/avukatın (para almadan ölçeklenmeden ÖNCE):**
- [x] **OpenAI DPA** ✅ imzalandı 2026-07-18 (DocuSign; AB adresi → OpenAI Ireland tarafıyla)
- [ ] **KVKK Standart Sözleşme** (OpenAI ABD aktarımı) + Kurul'a 5 iş günü bildirim
- [ ] **VERBİS** kaydı değerlendirmesi
- [ ] İhlal müdahale planı (72 saat bildirim) — (`legal-entity.ts` alanları ✅ 07-18'de gerçek değerlerle dolduruldu)

## 🟣 Faz 5 — Ölçek (2027+)
Ekip rolleri & atama · PWA/mobil · misafir CRM · akıllı kilit (Nuki) · white-label ·
**2. PMS adaptörü (Guesty/Hostaway)** — Hospitable tek-nokta bağımlılığını azaltır.

---

## 🔑 Senin kararın/aksiyonun
| Konu | Durum / Not |
|------|-------------|
| Çekirdeği canlı doğrula | `AUTO_REPLY_ENABLED=1` açık → Hospitable yenilenince ilk gönderimleri birlikte izle |
| İlk gerçek ödeme | ✅ Yapıldı (07-18): gerçek kartla satın alma + in-app upgrade doğrulandı |
| İlk müşteri | 1 tanıdık host'a kur, geri bildirim al (asıl risk: birisi öder mi?) |
| Avukat / mali müşavir | OpenAI DPA ✅ · kalan: KVKK Standart Sözleşme + VERBİS + e-fatura + guest-erasure imzası |
| Hospitable | Nuve aboneliği bitik (402) → yenilenince veri canlanır |
