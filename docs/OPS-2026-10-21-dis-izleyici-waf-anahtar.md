# Dış izleyici · WAF · oturum anahtarı (kurucu cevapları 10-21, altyapı soruları 1 · 2 · 4 · 5)

Panel işleri kurucunun hesabından yapılır (hesap açma / ödeme bilgisi bizde yok). Railway kapalıyken kurulursa sürekli "kapalı" uyarısı
gelir — **Railway açılınca** `docs/RAILWAY-ACILIS-2026-10-15.md` §0 sonrası yapılır.

## 1. Ücretsiz dış izleyici (kurucu: "evet")

**Seçim: UptimeRobot ücretsiz plan** (50 izleyici, 5 dakikada bir yoklama, e-posta + telefon uygulaması bildirimi, kart istemez).
Neden GitHub Actions değil: zamanlanmış iş akışı yalnız varsayılan dalda (`main`) koşar ve `main` yayın dalının çok gerisinde
(`.github/workflows/ci.yml` `security-audit` yorumu) — orada çalışan bir izleyici bugünkü kodu değil eski ağacı bilirdi.

Kurulum (≈10 dk):
1. uptimerobot.com → ücretsiz hesap → telefona "UptimeRobot" uygulamasını kurup aynı hesapla girin (anlık bildirim).
2. **Add New Monitor** üç kez:

| Ad | Tür | Adres | Anahtar sözcük | Ne zaman uyarır |
|---|---|---|---|---|
| Lixus — ayakta | HTTP(s) | `https://www.lixusai.com/api/health?live=1` | — | süreç cevap vermiyor (çöktü / yayın bozuk) |
| Lixus — veritabanı | Keyword | `https://www.lixusai.com/api/health` | `"ok":true` (yoksa uyar) | veritabanına ulaşılamıyor |
| Lixus — senkron + kuyruk | Keyword | `https://www.lixusai.com/api/health?strict=1` | `"ok":true` (yoksa uyar) | 15 dk'dır senkron yok ya da kuyruk takıldı |

3. Her izleyicide aralık 5 dk; "senkron + kuyruk" için **Alert after: 3 failures** (geçici gecikmede sizi uyandırmasın).
4. Alert Contacts: e-posta + mobil uygulama.
5. İsteğe bağlı: Status Page (ücretsiz) — müşterilere "sistem durumu" bağlantısı.

Bu üç yoklama `docs/OPS-OLAY-YONETIMI-VE-SLO.md` §1'deki ilk üç SLI'yı ölçer; kurulunca o bölümdeki "dış izleyici BUGÜN YOK" satırı
güncellenir. Yanıtlar kişisel veri / sır taşımaz (yalnız durum alanları), yoklamalar hız sınırına takılmaz (DB'siz canlılık yolu).

## 2. Otomatik veritabanı yedeği (kurucu: "bedavaysa olur, yoksa uğraşma")

Güvenli ve ücretsiz bir yol **yok**: ücretsiz otomatik yedek ya üretim verisini (misafir adları, mesajlar) üçüncü bir yere (GitHub
Actions eserleri, ücretsiz bulut sürücü) koymayı gerektirir — KVKK ve "prod verisi başka yere çıkmaz" kuralına aykırı. **Karar:
uğraşılmıyor**; Railway ücretli planındaki otomatik yedek açılınca kullanılır. O zamana kadar elle yedek: `scripts/ops-backup-prod.ps1`
(migration'lı her yayından önce zorunlu — CLAUDE.md).

## 4. Oturum anahtarı (`AUTH_SECRET`) değişimi (kurucu: "sen bilirsin")

**Karar: önceki anahtarla doğrulama (`AUTH_SECRET_PREVIOUS`) EKLENMEDİ.** Gerekçe:
- `AUTH_SECRET` yalnız oturum çerezi değil; QR PIN özeti (`QR_PIN_PEPPER` yoksa), tanınan cihaz / güvenilir cihaz çerezleri, uyarı
  adresi doğrulama belirteci ve giden mesaj sahiplenme özeti de ondan türer. Yalnız oturuma "önceki anahtar" eklemek değişimi kesintisiz
  yapmaz — diğerleri yine kırılır; yarım bir özellik yanlış güven verir.
- Süresi dolan bir anahtar değil; düzenli değiştirme gerekmiyor. Yalnız **sızma şüphesinde** değişir ve o durumda herkesin bir kez
  yeniden girmesi istenen sonuçtur.

Sızma şüphesinde yapılacaklar (sırayla): (1) Railway'de `AUTH_SECRET` yeni rastgele değer (≥ 32 karakter) → yayın; herkes bir kez
yeniden girer. (2) QR PIN'leri etkilenir: `QR_PIN_ENABLED` açıksa misafirler PIN'i yeniden ister — ev sahiplerine tek satır duyuru.
(3) `ENCRYPTION_KEY` **DEĞİŞMEZ** (ayrı anahtar; rotasyonu ASLA — CLAUDE.md). (4) Olay kaydı `docs/OPS-OLAY-YONETIMI-VE-SLO.md` §5.

## 5. WAF (Cloudflare) (kurucu: "açalım")

Alan adı DNS'i Cloudflare'de. WAF, DNS kaydı **proxy'li** (turuncu bulut) olduğunda çalışır.

1. Cloudflare → alan adı → **DNS**: `www` ve kök kayıt **Proxied** (turuncu bulut).
2. **SSL/TLS** → mod **Full (strict)** (Railway geçerli sertifika sunar; "Flexible" yönlendirme döngüsü yapar).
3. **Security → WAF → Managed rules**: ücretsiz planda "Cloudflare Free Managed Ruleset" AÇIK.
4. **Security → Bots**: "Bot Fight Mode" **KAPALI** bırakın — Paddle ve sağlayıcı webhook'larını, takvim (iCal) okuyucularını
   engelleyebilir. Önce yalnız yönetilen kurallar.
5. **Rate limiting rules** (ücretsiz 1 kural): `/api/auth/*` için IP başına 10 sn'de 20 istek → Block 10 sn. Uygulamanın kendi
   sınırları zaten var; bu yalnız kaba yükü uygulamaya gelmeden keser.
6. 🚨 **Ardından `TRUSTED_PROXY_HOPS` yeniden ölçülür** (proxy bir atlama ekler): kendi telefonunuzdan / bilgisayarınızdan panele girin
   → Operatör paneli → **Operasyon Teşhisi** → "Proxy başlıkları" → `TRUSTED_PROXY_HOPS=…` satırlarından **sizin gerçek IP'nizi**
   gösteren değeri Railway'e yazın (büyük olasılıkla 3). Ölçmeden değiştirmeyin: az tahmin güvenli, fazla tahmin tehlikeli (CLAUDE.md).
7. `TRUST_CF_HEADER` **EKLENMEZ** (değişmedi): Railway'in kendi alan adı (`*.up.railway.app`, Paddle webhook'u oradan da gelebilir)
   doğrudan erişilebilir; oradan gelen istemci `cf-connecting-ip` başlığını istediği gibi yazar.
8. Doğrulama: giriş, QR sohbet, Paddle webhook'u (Paddle panelinden "send test event") ve takvim akışı birer kez denenir.
