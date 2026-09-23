# Demo hesabı (Airbnb başvurusu) — işletim notu (09-24)

Airbnb başvurusu öncesi 6 kapıdan biri: demo tenant (demo@lixusai.com, 10–15 örnek mülk).
**Kod + betik hazır; CANLIYA KOŞULMADI.** Canlı koşu kurucu onayı + taze `pg_dump` ister.

## Ne üretir

12 "Lale …" mülkü (İstanbul, Antalya, Bodrum, Göreme, İzmir, Fethiye, Uzungöl) · ~430 rezervasyon
(−120 … +75 gün; bugün 3 giriş, 3 çıkış, 1 aynı gün devir; önümüzdeki 30 gece %60+ dolu; 2 onay bekleyen
doğrudan talep; mülk başına en fazla 2 iptal; bir tekrar eden misafir) · 12 konuşma (TR/EN/DE/RU; AI
cevapları, host cevapları, 2 sorunlu, 2 cevap bekleyen) · ~350 görev (ürünün görev üreticisiyle birebir) ·
84 onaylı bilgi tabanı kalemi · 3 şablon. Her kimlik `lxdemo-` ile başlar.

## Bilinçli olarak YOK

- Sahte kanal bağlantısı / takvim beslemesi / sağlayıcı kimliği (senkron sahte token'la 401 alır, bağlantıyı
  iptal eder, alarm üretirdi). Sonuç: mülk kartları 5/5 değil 4/5 hazır görünür; müsaitlik motoru boş geceye
  "bilinmiyor" der — ürünün gerçek davranışı.
- Rezervasyon kodu, misafir telefonu/e-postası, Wi-Fi şifresi, kapı kodu, QR/takvim token'ı.
- Abonelik satırı (hesap "tam erişim" görünür; deneme bandı/e-postası yok).
- Sinyal/hafıza olayı (yeni bir kaynak türü = kapalı kaynak sözleşmesi değişikliği → ayrı karar).

## Güvenlik

- İnceleme hesabı **yönetici** (sahip DEĞİL): faturalandırma, hesap silme, veri dışa aktarma, misafir silme,
  kanal bağlama sunucu tarafında kapalı. Personel hesapları rastgele (paylaşılmayan) şifreli.
- Yenileme uyarı e-postası adresini SIFIRLAR (paylaşılan hesapta keyfi adrese e-posta yollatılamasın).
- Şikâyet/iade konuşmaları `problem` doğar; `new` + şikâyet otomatik uyarı e-postası tetiklerdi.
- Başka bir org'a ait giriş adresi (açık kayıtla önceden alınmış), demo org'unda canlı bağlantı, kimlik
  çakışması ya da şifresiz ilk kurulum → **SIFIR yazma** ile red.

## Komutlar

```
# Kuru koşu (hiçbir şey yazmaz; sayıları ve şifre gerekip gerekmediğini söyler)
DATABASE_URL=... npx tsx scripts/demo-tenant.ts

# Uygula / yenile
DEMO_TENANT_APPLY=1 DEMO_TENANT_EXPECT_ORG=lxdemo-org DEMO_TENANT_PASSWORD=<en az 20 karakter> \
DATABASE_URL=... npx tsx scripts/demo-tenant.ts
#   yerel olmayan veritabanı: + DEMO_TENANT_REMOTE_HOST=<adresin sunucu adı, birebir>
#   şifreyi yenile (oturumlar düşer): + DEMO_TENANT_ROTATE_PASSWORD=1
#   inceleme sonrası geri al (2FA + kurtarma kodları + oturumlar): + DEMO_TENANT_RESET_SECURITY=1
```

Yenileme aynı komuttur: kimlikler aynı kalır, tarihler bugüne kayar, inceleme ekibinin değişiklikleri geri
alınır; inceleme hesabının şifresi ve oturumu (açıkça istenmedikçe) korunur.

## Kurucu kararı bekleyenler

1. Canlıya koşu zamanı (Railway duraklatıldı; önce yerel 5434'te koşup ekran görüntüsü).
2. Panelde "Örnek veri" bandı + "kanal bağlı değil" ipuçlarının demo org'unda gizlenmesi (küçük görüntü değişikliği).
3. Arayüzdeki "Hospitable" sözcüklerinin temizlenmesi (inceleme ekibi görür; "PMS logosu yok" kuralı).
4. `demo@lixusai.com` posta kutusu (şifre değişikliği kodları oraya gider).
5. İnceleme hesabında 2FA (öneri: kapalı; sentetik veri + yönetici rolü; MFA başvuru dosyasında gösterilir).
6. Demo org'unun "gerçek kullanım" metriklerinden dışlanması.
7. Sinyal/hafıza için `demo_seed` kaynak türü (tekrar eden arıza kartını demoda göstermek için).

## Kanıt

Birim 34 + entegrasyon 13 test (komşu iki org'un tüm satırları önce/sonra birebir; iki koşu idempotent;
reddetmelerde sıfır yazma; hiçbir satır kanaldan mesajlanabilir sayılmıyor; panel yalnız tasarlanan iki
satırı gösteriyor; ürünün görev üreticisi sıfır eksik görev buluyor) + betik boş bir geçici veritabanında
uçtan uca koşuldu. Mutasyon sonuçları: bu turun hüküm belgesi.
