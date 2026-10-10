# Güvenlik süreçleri — TASLAK (Airbnb kapı 3; kurucu + avukat onayı bekler)

> Kurucu talimatı 2026-09-07, Airbnb başvurusu öncesi kapı 3: "güvenlik katmanı" — kontroller kodda var (envanter:
> `docs/GUVENLIK-KONTROLLERI-2026-09-28.md`), eksik olan **yazılı süreçler**: üç ayda bir zafiyet taraması, olay müdahalesi + KVKK ihlal
> bildirimi, erişim gözden geçirme. Bu belge o üç sürecin TASLAĞIDIR (gece modu 10-10, Haiku envanteri + kodda doğrulama).
> 🚨 Hukuki maddeler (KVKK bildirim süresi, metin) **avukat teyidi** ister; süreçlerin sahibi kurucudur. Kod değişikliği YOK.

## 1. Üç ayda bir zafiyet taraması

Airbnb "en az üç ayda bir zafiyet taraması" bekliyor (kurucu talimatı). Bugün: her push'ta CI'da zafiyet kapısı (fail-closed;
`scripts/audit-check.mjs`, `security/audit-baseline.json` — süreli kabul kayıtları) + haftalık Dependabot. **Zamanlanmış (push'tan
bağımsız) tarama YOK** — `schedule:` yalnız varsayılan daldaki (`main`) iş akışından koşar; kurulum adımı
`docs/ZAFIYET-KAPISI-ZAMANLAYICI-RUNBOOK.md` Seçenek A (kurucu: `main`e tek dosya ekler).

**Üç ayda bir yapılacaklar (kurucu; ~1 saat; ocak · nisan · temmuz · ekim ilk haftası):**

| # | Ne | Nasıl | Kayıt |
|---|---|---|---|
| 1 | Bağımlılık zafiyetleri | Deploy dalında `node scripts/audit-check.mjs` (ya da son CI "security-audit" işi); süresi 90 günden az kalan kabul kayıtlarını yeniden değerlendir | Bulgu sayısı + karar |
| 2 | Bağımlılık güncelliği | Açık Dependabot PR'ları; Next.js / Prisma / Node güvenlik sürümleri | Güncellenen paketler |
| 3 | Sır sızıntısı | GitHub sır taraması (repo herkese açık → ücretsiz) uyarıları; repoda anahtar / parola / gerçek işletme adı yok (`brand-name-absent` pini CI'da) | Uyarı sayısı |
| 4 | Web başlıkları | Canlı sitede güvenlik başlıkları (HSTS 2 yıl, CSP, X-Frame, nosniff) + CSP rapor uçlarına gelen ihlaller | Değişiklik var mı |
| 5 | Erişim gözden geçirme | §3 listesi | Kaldırılan erişimler |
| 6 | Yedek provası | `scripts/ops-restore-drill.ps1` (şifreli alan kanıtıyla — takvim kaynağı > 0 iken) | Süre + satır eşitliği |
| 7 | Açık denetim bulguları | `docs/audit-2026-09-05/DURUM.md` açıkları + sabah kararları güvenlik maddeleri | Kapanan / kalan |

Kayıt biçimi: `docs/guvenlik-taramalari/YYYY-QN.md` (tarih, kim, yukarıdaki 7 satırın sonucu, açılan iş). İlk kayıt Railway açılınca.

## 2. Olay müdahalesi + KVKK ihlal bildirimi

**Algılama kaynakları:** hata izleme (Sentry, canlı) · `ERROR_ALERT_EMAIL` alarm e-postaları (geçiş tabanlı — aynı arıza sürerken günde
bir) · Dikkat Gerektirenler · `security@lixusai.com` (güvenlik açığı bildirim sayfası `/guvenlik`, `security.txt`; 🚨 posta kutusunun
açık olduğu doğrulanmalı) · müşteri / misafir şikâyeti.

**Önem:** **K1** kişisel veri sızıntısı ya da yetkisiz erişim kanıtı · **K2** sızıntı şüphesi / kimlik bilgisi ele geçmiş olabilir ·
**K3** güvenlik açığı bildirimi (istismar kanıtı yok) · **K4** hizmet kesintisi (veri etkisi yok).

**İlk saat (K1–K2):**
1. **Kayıt aç:** saat, kim fark etti, ilk gözlem (`docs/olaylar/YYYY-MM-DD-kisa-ad.md`; misafir verisi YAZILMAZ).
2. **Durdur (gerekeni, en dar):**
   - Misafire otomatik gönderimi durdur: `AUTO_REPLY_ENABLED=0` (Railway env).
   - Bir kullanıcının oturumlarını düşür: o kullanıcının parolasını sıfırla (oturum sürümü artar); operatör 2FA'sını `/admin`den sıfırla.
   - Bütün oturumları düşür: `AUTH_SECRET` değiştir — 🚨 ÖNCE `ENCRYPTION_KEY`in AYRI tanımlı olduğunu doğrula (yoksa şifreleme anahtarı
     `AUTH_SECRET`e düşer ve şifreli veriler AÇILAMAZ). `ENCRYPTION_KEY` ASLA döndürülmez (kanal anahtarları + takvim adresleri kırılır).
   - Kanal bağlantısı ele geçtiyse: sağlayıcı panelinden belirteci iptal et; bağlantı "reddedildi" durumuna düşer, gönderim durur.
   - Ödeme webhook sırrı şüpheliyse: Paddle panelinden yeni sır + `PADDLE_WEBHOOK_SECRET`.
3. **Kanıtı koru:** taze veritabanı yedeği (`scripts/ops-backup-prod.ps1`), ilgili denetim kayıtları (`AuditLog`), hata izleme olayları —
   silmeden / düzeltmeden ÖNCE.
4. **Kapsamı belirle:** hangi işletmeler, hangi veri türleri (misafir adı / iletişim / mesaj / rezervasyon), hangi zaman aralığı.

**KVKK bildirimi (K1; ⚖️ avukat teyidi):** Kişisel Verileri Koruma Kurulu'na, ihlalin öğrenilmesinden itibaren **en geç 72 saat** içinde
bildirim (Kurul'un ihlal bildirim kararı ve formu); etkilenen kişilere makul en kısa sürede bilgilendirme. Lixus misafir verisinde
çoğunlukla **veri işleyen** konumunda (ev sahibi veri sorumlusu): etkilenen işletmelere (veri sorumlusu) gecikmeden bildirim yapılır ve
Kurul bildirimi için gerekli bilgiler verilir; Lixus'un kendi müşteri hesap verisinde veri sorumlusu Lixus'tur. Bildirim metni: ne oldu,
hangi veri, kaç kişi (tahmini), alınan önlemler, iletişim kişisi.

**Kapanış (her önemde):** kök neden + düzeltme + regresyon testi (kanıt sözleşmesi), kayıt dosyasına "ne değişti, bir daha olmaması için"
bölümü; gerekiyorsa `docs/claude/kalici-kararlar.md`ye kural.

**K3 (açık bildirimi):** `/guvenlik` sayfasındaki süreler: 5 iş günü içinde alındı bildirimi, 10 iş günü içinde değerlendirme; düzeltme
sonrası bildirene haber. Ödül programı yok.

## 3. Erişim gözden geçirme (üç ayda bir + ayrılan kişide hemen)

| Sistem | Kimin erişimi olmalı | Kontrol |
|---|---|---|
| Lixus operatör paneli | `SUPERADMIN_EMAILS` (Railway env) — yalnız kurucu (+ yazılı yetkilendirilen) | Liste + her birinde 2FA (operatör yetkisi 2FA'sız ÇALIŞMAZ) |
| Railway projesi | Kurucu | Üye listesi; env değişkenlerini kim görebilir |
| GitHub deposu | Kurucu (+ yazma yetkili ortaklar) | Collaborator listesi; 2FA zorunlu; deploy dalı koruması |
| Paddle | Kurucu | Panel kullanıcıları; API anahtarları |
| OpenAI | Kurucu | Proje anahtarları (kullanılmayan iptal); harcama sınırı |
| Hospitable OAuth uygulaması / kanal panelleri | Kurucu | Uygulama sırları |
| Alan adı / DNS / e-posta sağlayıcısı | Kurucu | Kullanıcılar + 2FA; `security@` posta kutusu açık |
| Depolama (Tigris) | Kurucu | Erişim anahtarları |

**Ayrılan kişi:** aynı gün — operatör listesinden çıkar, sistem hesaplarını kapat, paylaşılmış anahtar varsa döndür (🚨 `ENCRYPTION_KEY`
HARİÇ), denetim kaydına not. Müşteri tarafı personel: işletme sahibi panelden kaldırır (rol değişimi oturumları düşürür).

## 4. Bu belgeyle kapanmayanlar (dürüst liste)

Bağımsız sızma testi · SOC 2 / ISO 27001 · CSP'nin script-src kısmının zorlanması (nonce altyapısı) · SBOM / statik analiz iş akışı ·
zamanlanmış zafiyet taraması (§1 kurucu adımı) · denetim kaydının değiştirilemezliği (hash zinciri yok) · `security@` posta kutusunun
canlılığı. Entegrasyon dosyası (`docs/AIRBNB-INTEGRATION-DOSSIER.md`) bu listeyle tutarlı tutulur.
