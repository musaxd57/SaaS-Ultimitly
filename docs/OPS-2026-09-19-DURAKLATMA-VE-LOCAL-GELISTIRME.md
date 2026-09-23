# Railway duraklatma + local geliştirmeye geçiş — operatör kontrol listesi

> **Durum:** Railway ücretli planından çıkılıyor, **servis SİLİNMİYOR**. Geliştirme
> local'de sürecek; proje bitmeye yakın tekrar açılacak. `.env` değerleri kaydedildi.
>
> **Bu belgenin sözü:** aşağıdaki 4 komutu sırayla koş, gerisi yazılı. Her adımın
> neden orada olduğu da yazılı — sırayı bozarsan ne kaybedeceğini görebilesin diye.

---

## 0. Önce şunu netleştir: "deploy'u kapatmak" tek başına parayı durdurmaz

| Yaptığın şey | Servis çalışır mı | Fatura | Veri |
|---|---|---|---|
| Auto-deploy'u kapatmak | **Evet, çalışmaya devam eder** | **Devam eder** | Durur |
| Servisi durdurmak/pause | Hayır | Büyük ölçüde durur | Volume durur |
| Plandan düşmek (Pro → ücretsiz) | Limit aşılırsa askıya alınır | Düşer | Volume durur |
| **Servisi/projeyi SİLMEK** | Hayır | Durur | 🚨 **VOLUME SİLİNİR** |

**Senin niyetin son satır DEĞİL.** Yine de yedeği, son satır olsaydı da kurtulacak
şekilde alıyoruz — çünkü yedeğin değeri "planladığım şey olmazsa" anındadır.

⚠️ Railway'in ücretsiz/askıya alınmış projelerde veriyi ne kadar sakladığını
buradan doğrulayamam. **Yedek alınmadan plandan düşme.**

---

## 1. Yedek al (tek komut, ~2-5 dk)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-pause-backup.ps1
```

İstediği tek şey: **Railway PUBLIC/PROXY `DATABASE_URL`** (gizli sorulur, komut
geçmişine yazılmaz). Masaüstüne üç dosya bırakır:

- `lixus-prod-pause-<tarih>.dump` — asıl geri yükleme dosyası (`-Fc`)
- `lixus-prod-pause-<tarih>.sql` — düz SQL ikinci kopya (soğuk saklama)
- `lixus-prod-pause-<tarih>-manifest.txt` — **satır sayıları** + SHA256'lar

**Neden iki format:** `-Fc` seçici/paralel restore verir ama `pg_restore` ister;
düz SQL yıllar sonra herhangi bir `psql` ile açılır. İkinci formatın maliyeti
birkaç on MB, faydası "tek araç çalışmazsa yedek ölü" riskinin kalkması.

**Neden satır sayısı manifesti:** geri döndüğünde "bir şey kayboldu mu?" sorusunu
tahminle değil **karşılaştırmayla** yanıtlarsın.

---

## 2. Yedeği DOĞRULA — bu adım atlanırsa yedek yok sayılır

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-restore-drill.ps1 -ExpectedSha <1.ADIMDA-BASILAN-SHA> -DumpPattern "lixus-prod-pause-*.dump"
```

(1. adım bu komutu SHA'sı doldurulmuş hâlde ekrana basıyor — kopyala yapıştır.)

Prova **prod'a hiç dokunmaz**: 127.0.0.1'de geçici, koşu sonunda silinen bir
kümeye geri yükler ve fail-closed doğrular — migration sayısı, bitmemiş migration
yok, takvim sözleşmesi değişmezi ve 🚨 **her şifreli alanın kasadaki
`ENCRYPTION_KEY` ile GERÇEKTEN açılması**.

> Açılmamış bir yedek, yedek değil bir dosyadır. Bu tek adım "elimde yedek var"
> cümlesini iddiadan olguya çevirir.

---

## 3. Üç şeyi AYRI yerlere koy

| Ne | Nereye | Neden |
|---|---|---|
| `.dump` + `.sql` + `manifest` | **İki ayrı yer**, biri çevrimdışı (harici disk) — **7-Zip AES-256 ile ŞİFRELİ** | Tek kopya kopya değildir |
| `ENCRYPTION_KEY` | Kasa — **dump'la AYNI yere ASLA** | Aynı yerde: şifreli kolonlar da açılır. Ayrı yerde: `*Enc` kolonları korunur |
| Diğer `.env` (AUTH_SECRET, Paddle, Resend/SMTP, Tigris) | Kasa | Sen kaydettin ✅ |

🚨 **DÜZELTME (09-23 denetimi, tedarik zinciri ajanı):** bu tablo önceden "ayrı yerde saldırgan da
açamaz" diyordu — **YANLIŞTI.** `ENCRYPTION_KEY` yalnız `*Enc` kolonlarını (Hospitable token'ları,
takvim feed URL'leri, 2FA sırları) korur. Dump'ın GERİ KALANI düz okunur: misafir adları/telefonları/
**17.462 mesaj**, **QR sohbet ve iCal erişim token'ları** (`Property.chatToken` / `icalToken` — servis
geri açılınca ÇALIŞIRLAR; `chatToken` bilinçli olarak döndürülmüyor çünkü QR'lar dairelerde basılı) ve
parola hash'leri. Yani dump'ın kendisi şifrelenmeli ve OneDrive'la eşitlenen bir klasörde durmamalı.

**Mevcut 09-19 yedeğini şifrele (PowerShell, yedeğin olduğu klasörde):**
```powershell
& 'C:\Program Files\7-Zip\7z.exe' a -t7z -mhe=on -p lixus-prod-pause-2026-09-19-104239.7z lixus-prod-pause-2026-09-19-104239.dump lixus-prod-pause-2026-09-19-104239.sql lixus-prod-pause-2026-09-19-104239-manifest.txt
& 'C:\Program Files\7-Zip\7z.exe' t lixus-prod-pause-2026-09-19-104239.7z
```
`-p` değersiz verilir → 7-Zip parolayı SORAR (komut geçmişine yazılmaz). `-mhe=on` dosya adlarını da
gizler. `7z t` "Everything is Ok" dedikten sonra düz `.dump`/`.sql` dosyalarını sil; OneDrive'daki
Masaüstü kopyasını da sil (OneDrive geri dönüşüm kutusunu da boşalt). Parola `ENCRYPTION_KEY`den
FARKLI olsun ve ondan AYRI yerde saklansın.

🚨 **Dump tek başına kurtarma DEĞİLDİR.** Hospitable token'ları ve 8 takvim feed
URL'i at-rest şifreli; `ENCRYPTION_KEY` olmadan geri yüklenen DB'de o alanlar
açılmaz. **Anahtar rotasyonu ASLA** (CLAUDE.md değişmezi).

⚠️ **Tigris `lixus-uploads` bucket'ı bu dump'ta YOK** — ayrı bir sağlayıcı ve
Railway planından bağımsız. Mülk fotoğrafları oradadır; Railway'i kapatmak onu
etkilemez, ama "her şeyin yedeği var" derken bunu da sayma.

---

## 4. Fırsat penceresi: zaten bağlıyken bekleyen doğrulamaları yap

Bu üç sorgu **salt-okumadır** ve aylardır bekliyor (migration 53/54/55'in prod
damgaları). Bağlantı elindeyken 30 saniye:

```sql
-- migration 55: aktif saat varsayılanı 0/0 oldu mu, kaç org hâlâ eski pencerede?
SELECT "autoReplyStartHour" AS bas, "autoReplyEndHour" AS bit, count(*)
FROM "Organization" GROUP BY 1,2 ORDER BY 3 DESC;

-- migration 53 (A1): KB onay sözleşmesi dağılımı
SELECT source, "reviewState", count(*) FROM "KnowledgeBaseItem" GROUP BY 1,2 ORDER BY 3 DESC;

-- migration 54 (A2): temellendirme kolonları gerçekten doluyor mu
SELECT count(*) AS toplam,
       count("kbRetrieved") AS kb_olculdu,
       count("srcDeclared") AS beyan_olculdu,
       count("srcVerified") AS dogrulandi
FROM "RiskEvent";

-- migration zinciri eksiksiz mi
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL;  -- 0 olmalı
```

Çıktıyı manifest dosyasının yanına kaydet. 🚨 **A2 kuralı:** `NULL` = ÖLÇÜLMEDİ,
`0` DEĞİL — "kb_olculdu" düşükse bu bir arıza değil, o yolun ölçmemesidir.

---

## 5. Kapatırken ne duruyor (bilerek kabul ediyorsun)

| Duran şey | Geri dönüşte ne olur |
|---|---|
| **QR misafir sohbeti** | 🚨 Dairelerdeki QR'ı okutan misafir **ölü sayfa** görür. Önümüzdeki 11 günde rezervasyon varsa bu gerçek bir müşteri etkisidir — QR stickerlarını geçici kaldırmayı düşün |
| Oto-yanıt + Hospitable/iCal senkron | Kendiliğinden toparlanır: geri açınca **540 günlük geri pencere** eski mesajları yeniden alır |
| E-posta kuyruğu (`EMAIL_OUTBOX_ENABLED=1`) | Kuyrukta bekler, geri açınca gönderilir |
| Deneme e-postaları / yeni kayıt | Kayıt sayfası da kapalı olacak |
| **Paddle webhook'ları** | ⚠️ Paddle bir süre tekrar dener, sonra vazgeçer. Abonelik durumu **kayabilir** → geri dönüşte **reconcile** koş (§7) |
| Hospitable OAuth refresh | ⚠️ Uzun kullanılmayan refresh token'ların süresi dolabilir — geri dönüşte "yeniden bağlan" gerekebilir. Kesin süreyi buradan doğrulayamam, **kontrol et** |

**Dış host müşterin varsa onları önceden haberdar et** — ürün 11 gün cevap vermeyecek.

---

## 6. Local geliştirme (tek komut)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-local-dev-setup.ps1
```

Yaptığı: yerel PostgreSQL kümesi (**port 5434**) → `lixus_dev` DB → `.env.local`
(yoksa, **taze üretilmiş** geliştirme sırlarıyla) → `prisma db push` + demo seed.

Sonra: `npm run dev` → http://localhost:3000 → **demo@guestops.ai / demo1234**

🚨 **Port 5434, 5433 değil.** 5433'ü test harness'ı sahipleniyor: her `vitest run`
o kümeyi `stop -m immediate` + `initdb` ile **sıfırlıyor**. Geliştirme DB'ni oraya
kurarsan ilk `npm test` onu siler. İki küme ayrı olduğu için `npm test` ile
`npm run dev` aynı anda sorunsuz koşar.

🚨 **Prod `ENCRYPTION_KEY`'i `.env.local`'e KOPYALAMA.** Script kendi sırlarını
üretiyor. Prod anahtarı local'de (a) hiçbir işe yaramaz — local DB'de şifreli prod
verisi yok, (b) sırrı geliştirme makinesine yayar.

🚨 **Prod dump'ı local'e yükleme** (bilinçli): içinde gerçek misafir adları,
telefonları ve mesajları var. Demo seed geliştirme için yeterli. Gerçek veriyle
ölçüm gerekirse o AYRI bir karar (KVKK).

Bilgisayarı yeniden başlattıktan sonra **aynı komut** — kurulum atlanır, yalnız
küme başlatılır.

---

## 7. Geri açarken (proje bitmeye yakın)

1. Railway'de planı geri al, servisi başlat.
2. Boot `prisma migrate deploy` uygular — **elle SQL çalıştırma**.
3. `/api/health?strict=1` yeşil mi?
4. **Satır sayılarını manifest ile karşılaştır** (§1'in dosyası). Düşen varsa DUR.
5. **Paddle reconcile** koş — 11 günlük webhook boşluğu abonelik durumunu kaydırmış olabilir.
6. **Hospitable bağlantısını kontrol et** — token süresi dolduysa yeniden bağlan.
7. İlk senkrondan sonra: yeni mesajlar geliyor mu, oto-yanıt çalışıyor mu.
8. QR stickerlarını geri koy (kaldırdıysan).

---

## 8. Kod tarafı — bu turda hazırlandı

| Dosya | Ne |
|---|---|
| `scripts/ops-pause-backup.ps1` | **YENİ** — duraklatma öncesi tam yedek (iki format + manifest) |
| `scripts/ops-local-dev-setup.ps1` | **YENİ** — Railway'siz local ortam, tek komut, idempotent |
| `scripts/ops-restore-drill.ps1` | Mevcut, dokunulmadı — `-DumpPattern` ile yeni yedeği de doğruluyor |
| `scripts/ops-backup-prod.ps1` | Mevcut, dokunulmadı — post-contract yedeği için duruyor |
| `backup/stable-2026-09-19` dalı | Kodun o günkü hâli, uzakta duruyor |

Migration YOK, şema değişikliği YOK, üretim davranışı DEĞİŞMEDİ — bu tur yalnız
operatör araçları ve belge ekledi.
