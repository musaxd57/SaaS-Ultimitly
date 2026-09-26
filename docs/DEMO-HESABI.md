# Demo hesabı (Airbnb başvurusu) — işletim notu (09-24, güncelleme 09-23 ikinci tur)

Airbnb başvurusu öncesi 6 kapıdan biri: demo tenant (demo@lixusai.com, 10–15 örnek mülk).
**Kod + betik + arayüz hazır; CANLIYA KOŞULMADI.** Canlı koşu kurucu onayı + taze `pg_dump` ister.
Kurucu kararı (09-23): Airbnb API başvurusu YAKINDA YAPILMAYACAK; demo hesabı Railway geri açılınca
aktif edilecek (↓ Aktivasyon).

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
- `IngestEvent` (kapalı kaynak sözleşmesi değişmedi). Sinyaller ürünün tüketicisinin AYNI saf
  türetmesiyle (`deriveMessageSignal`, kaynak/anahtar aynı) doğrudan yazılır; "tekrar eden arıza"
  kartı UYDURULMAZ, senkron geçişinin örüntü kuralıyla (`refreshPatternMemory`) doğar.

## Güvenlik

- İnceleme hesabı **yönetici** (sahip DEĞİL): faturalandırma, hesap silme, veri dışa aktarma, misafir silme
  ve Hospitable bağlama sunucu tarafında kapalı. ⚠️ Yönetici bir mülke **iCal takvim bağlantısı EKLEYEBİLİR**
  (`calendar-sources` POST `withManage`); o durumda sonraki yenileme "canlı bağlantı var" diye REDDEDİLİR —
  operatör bağlantıyı silip yeniden koşar. Personel hesapları rastgele (paylaşılmayan) şifreli.
- Yenileme uyarı e-postası adresini SIFIRLAR (paylaşılan hesapta keyfi adrese e-posta yollatılamasın).
- Şikâyet/iade konuşmaları `problem` doğar; `new` + şikâyet otomatik uyarı e-postası tetiklerdi.
- Başka bir org'a ait giriş adresi (açık kayıtla önceden alınmış), demo org'unda canlı bağlantı, kimlik
  çakışması ya da şifresiz ilk kurulum → **SIFIR yazma** ile red.

⚠️ Uzak veritabanı teyidi yalnız adresin SUNUCU ADINA bakar: `localhost`a açılmış bir tünel (ör. canlı
veritabanına SSH tüneli) yerel sayılır. Canlıya koşuda tünel kullanılmaz; koşu kurucuyla birlikte yapılır.

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

## Arayüzde demo'ya özel olan (09-23, `isDemoOrg` tek kaynak)

- Her sayfanın üstünde bant: "Örnek hesap … hiçbir misafire mesaj gönderilmez" (gerçekten gitmez:
  hiçbir konuşmanın kanal hedefi yok).
- Gizlenen kırık dürtüler: panel kurulum rehberi, Mesajlar'daki "Mesajları çek" + oto-yanıt önizlemesi
  (her zaman boş dönüp AI hakkı yakıyordu), raporlardaki "bağlantı kurulunca dolar", mülk hazırlık
  listesindeki kanal adımı. Ayarlarda demo'ya özel dürüst metin.
- Operatör paneli demo org'unu MÜŞTERİ SAYMAZ (satırda "Demo" etiketi) — "gerçek kullanım kanıtı"
  metriklerine girmez.
- Arayüzde PMS adı YOK (ürün geneli; hata metinleri tek sabit `NOT_CONNECTED_MESSAGE`).

## Aktivasyon (Railway geri açılınca) — sırayla

1. Taze `pg_dump` (`scripts/ops-*` yedek betiği) + kurucunun açık onayı.
2. Önce YEREL (5434) kuru koşu → uygula → ekran görüntüleri (panel, Mesajlar, mülk, Bilgi Tabanı).
3. Canlıya kuru koşu (`DEMO_TENANT_REMOTE_HOST` = adresin sunucu adı, birebir; tünel YOK).
4. Uygula (`DEMO_TENANT_APPLY=1 …`, şifre ≥20 karakter, kasada sakla).
5. Bir zamanlanmış senkron geçişini bekle (2 dk) ya da `/api/cron/sync`i `CRON_SECRET` ile tetikle →
   örüntü hafızası "tekrar eden arıza" kartını üretir (demo org'u mülkü olduğu için geçişe girer; kanal
   kimliği olmadığından senkron bacağı hiçbir şey çekmez, alarm üretmez).
6. İnceleme hesabıyla giriş: bant görünüyor mu, "Dikkat Gerektirenler" kartında çakışma/tekrar eden
   arıza satırları var mı, hiçbir yerde "bağlantıyı kur" dürtüsü yok mu.
7. Operatör panelinde demo satırı "Demo" etiketli ve müşteri sayısına girmiyor mu.

## Kurucu kararı bekleyenler

1. Canlıya koşu zamanı (Railway açılınca; önce yerel 5434'te koşup ekran görüntüsü).
2. `demo@lixusai.com` posta kutusu (şifre değişikliği kodları oraya gider).
3. İnceleme hesabında 2FA (öneri: kapalı; sentetik veri + yönetici rolü; MFA başvuru dosyasında gösterilir).

Kapananlar (09-23): örnek veri bandı + bağlantı dürtüleri · arayüzden PMS adı · metrik dışlama ·
tekrar eden arıza kartı (yeni kaynak türü GEREKMEDİ — ürünün kendi türetmesi).

## Kanıt

Birim 34 + entegrasyon 13 test (09-23: + sinyal eşiği/tarih tutarlılığı/gerekçe kümesi birim, apply →
`refreshPatternMemory` → panel satırı entegrasyon, bant metni UI, arayüz kapıları yapısal pin) (komşu iki org'un tüm satırları önce/sonra birebir; iki koşu idempotent;
reddetmelerde sıfır yazma; hiçbir satır kanaldan mesajlanabilir sayılmıyor; panel yalnız tasarlanan iki
satırı gösteriyor; ürünün görev üreticisi sıfır eksik görev buluyor) + betik boş bir geçici veritabanında
uçtan uca koşuldu. Mutasyon sonuçları: bu turun hüküm belgesi.
