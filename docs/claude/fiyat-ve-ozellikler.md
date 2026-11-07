# Fiyat + mevcut özellikler

> CLAUDE.md'den 2026-10-23'te AYNEN taşındı (kurucu 10-22 gece: "her turda okumak yerine gerektiğinde oku"). Bu dosyadaki kurallar
> CLAUDE.md'deki kadar BAĞLAYICIDIR. Fiyat / plan / landing işinden ve YENİ özellik eklemeden ÖNCE oku (var olan özellik yeniden eklenmez).

## Fiyat (kullanıcı onaylı, FLAT)
Başlangıç ₺449 (1-2 daire) · Pro ₺899 (3-7) · İşletme ₺1.699 (8-25; `propertyLimit=25`, "25+ → bize ulaşın").
Yıllık = aylık×10 (₺4.490/8.990/16.990). 14 gün tam Pro deneme, kart yok. Kartlar daire sayısı +
kullanım hacmi + destek ile ayrışır; özellik kilidi YOK. USD/TRY ₺46. `legal-entity.ts` dolu.

## Mevcut özellikler (tekrar ekleme)
Panel: dashboard (AI özet + onboarding), inbox (AI öner + risk rozeti), Mesajlar, QR Misafir Sohbetleri,
Gönderilenler (+`/sent/queue` outbox ops), Görevler (Kanban), Takvim, İptaller, Mülkler (+"Mülk Hafızası" kartı, V1), Bilgi Tabanı,
Şablonlar, Raporlar, sekmeli Ayarlar (Takvim akışı gizliliği, geç çıkış teklifi, 2FA, faturalandırma).
Mülk sayfası "Otomatik mesajlar" kartı (kurucu T4 10-21, migration 80): karşılama / giriş / çıkış metni YALNIZ buradan (önizlemeli, sürümlü);
bilgi tabanı kalemleri otomatik mesajı değiştirmez. Mülk sayfası Kanal Takvimleri İKİ seçenek: **takvim bağlantısı** (URL, düzenli senkron) + **Dosyadan içe aktar**
(tek seferlik `.ics`; önizleme kaydetmeden mülk + eklenecek/güncellenecek/iptal/atlanacak sayısını gösterir;
`mode=preview` YAZMAZ ve ayrı kotadadır; dosya yalnız KENDİ satırına dokunur — `calendarSourceId` NULL + `channel`
"ics"; feed satırı `owned_by_feed` ile atlanır; eksik satır iptal EDİLMEZ; iptalli satır canlı dosyayla geri AÇILMAZ).
Operatör paneli: müşteri yönetimi + impersonation + Lead CRM + Operasyon Teşhisi + 2FA sıfırlama.
Landing: 3-seviye kartlar + canlı demo. KVKK: export, retention, erasure (bayraklı), kayıt onayı. VDP:
`/guvenlik` + `security.txt` (posta kutusu `security@lixusai.com` açılmalı).
