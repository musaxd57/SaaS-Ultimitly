# Bağımlılık zafiyet kapısı — düzeltme planı ve SONUÇ (2026-09-09)

> **§1-3 teşhis, §4 UYGULANDI (kurucunun açık yerel onayı), §5 kalan karar.**
> `npm audit fix --force` ÇALIŞTIRILMADI · baseline'a istisna EKLENMEDİ (iki istisna **silindi**) ·
> hiçbir test kaldırılmadı/gevşetilmedi · migration YOK · prod/env/bayrak işlemi YOK.
> **PUSH EDİLMEDİ** — ayrı onay bekliyor.

## 1. Ne düştü

CI **#1002** (`f757b52`, 2026-09-09 04:53Z) → `failure`. İki iş düştü, **tek kök neden**:

| İş | Düşen adım | Ayrıntı |
|---|---|---|
| `security-audit` | "Zafiyet triaj kapisi" | 7 `YENI zafiyet (triaj edilmemis)`; `Sonuc: KIRMIZI` |
| `verify` | `tests/unit/audit-gate-fail-closed.test.ts:77` | Aynı kapıyı koşan test; `exit 0` beklerken `1` aldı |

`migration-chain`, `e2e`, `build` **başarılı**. Suit'in geri kalanı yeşil: **3839/3840 geçti**,
tek düşen o kapı testi.

**Operasyonel sonuç:** Railway "Wait for CI" AÇIK → **deploy OLMADI**. `f757b52` (selam tekrarı
düzeltmesi + eval config) **canlıda DEĞİL**; prod hâlâ `4a058ef` üzerinde.

## 2. "Commit'imle ilgisiz" — kanıt ve kanıtın SINIRI

| Kanıt | Nasıl ölçüldü | Sonuç |
|---|---|---|
| Bağımlılık ağacı değişti mi | `git diff 4a058ef f757b52 -- package.json package-lock.json` | `package-lock.json` **hiç değişmedi**; `package.json` **+1 satır** (`"eval"` script'i) |
| Aynı lock ile son yeşil koşu | CI #1000, `4a058ef`, 2026-09-08 **19:39Z** → `success` | ✅ |
| Aynı lock ile ilk kırmızı koşu | CI #1002, `f757b52`, 2026-09-09 **04:53Z** → `failure` | ✅ |
| Baseline / test gevşetildi mi | Aynı diff | `security/audit-baseline.json` **dokunulmadı**, test **dokunulmadı** |

➡️ **Kurulu ağaç birebir aynı.** Kapı canlı registry'ye `npm audit` atar; aynı lock 09-08 19:39Z ile
09-09 04:53Z arasında yeşilden kırmızıya döndü → **değişen taraf registry'nin danışma kümesi**, bizim
ağacımız değil.

🚨 **KANITIN SINIRI (Codex uyarısı doğru):** bu, danışmaların "bugün yayımlandığını" KANITLAMAZ —
yalnız *bu 9 saatlik pencerede npm'in veri kümesine girdiklerini* gösterir. Yayım tarihlerini
doğrulamayı denedim, **doğrulayamadım**: `api.github.com/advisories/...` bu oturumda 403 döndü
("sessions are bound to their configured repositories"). Dolaylı işaret: yeni yedi danışmanın npm
kimlikleri bitişik bir blokta (**1193677–1193779**), daha önce triaj edilenlerin en yenisi ise
**1158513**. Bu bir işarettir, kanıt değildir; **"yeni yayımlandı" diye sunmuyorum.**

## 3. Danışma doğrulaması (kurulu sürüm · yol · resmî düzeltme · erişilebilirlik)

Kurulu: `next@15.5.23` · `nodemailer@8.0.11` · `sharp@0.34.5` (optional) · `postcss@8.4.31`
(`node_modules/next/node_modules/postcss`). Beyan: `next: "^15.5.21"`, `nodemailer: "^8.0.11"`,
`sharp` **doğrudan bağımlılık değil**.

### 3.1 YENİ (triaj edilmemiş) — kapıyı kıran yedi

| # | GHSA | Paket | Şdt | Etkilenen aralık | Resmî düzeltme | Bizim aralıkta mı | Uygulamada erişilebilirlik |
|---|---|---|---|---|---|---|---|
| 1 | `GHSA-p293-qw3h-jr36` | next | critical | `>=13.4.0 <15.5.24` | **15.5.24** | ✅ `^15.5.21` içinde | Danışma **windows-hosted** sunucu diyor. Prod Railway/Linux (`node:22-slim`) → prod'da beklenmiyor. **Ama geliştirme Windows'ta yapılıyor** → yerel `next dev`/`next start` kapsam içinde. Muaf saymıyorum. |
| 2 | `GHSA-2xp9-vwfh-vxw4` | next | critical | `>=10.0.0 <15.5.24` | **15.5.24** | ✅ | Image Optimization API (`/_next/image`) gerektirir. `next.config.mjs:175` `images: { unoptimized: true }`; uç **e2e test-pinli kapalı** (`tests/e2e/security-controls.spec.ts:19`). Erişilebilirlik **düşük** — ama tek savunma bir config satırı. |
| 3 | `GHSA-rgj7-g3m4-5g8c` | sharp | high | `<0.35.4` | **0.35.4** | ✅ next `^0.34.3 \|\| ^0.35.3` diyor | sharp'a tek yol yine `/_next/image` (kapalı). `src/` içinde doğrudan kullanım yok. Mevcut baseline'daki `GHSA-f88m` ile aynı gerekçe. |
| 4 | `GHSA-2x7j-588g-ccc2` | nodemailer | high | `<9.1.0` | 9.1.0 (npm: **10.0.1**) | ❌ `^8.0.11` dışı | `addressparser` kuadratik DoS. Yalnız **SMTP yolu** (`viaSmtp`, `EMAIL_HOST` şartı). Adres bizim DB'mizden gelen tek alıcı; saldırgan kontrollü adres LİSTESİ değil. |
| 5 | `GHSA-8m3c-c648-2xjj` | nodemailer | moderate | `<=9.1.0` | **10.0.1** | ❌ | `resolveContent()` legacy imzası. **Bu fonksiyonu hiç çağırmıyoruz** (kaynak taraması: tek kullanım `createTransport` + `sendMail`). |
| 6 | `GHSA-wmmp-3585-3rmp` | nodemailer | moderate | `<9.1.0` | 9.1.0 | ❌ | IDN/punycode allow-list bypass. **Allow-list özelliğini kullanmıyoruz** (`createTransport` seçenekleri: host/port/secure/auth/3 timeout — başka yok). |
| 7 | `GHSA-cc9r-2j5m-2m83` | nodemailer | moderate | `>=6.9.16 <9.1.0` | 9.1.0 | ❌ | RFC 5322 yorum yanlış-ayrıştırma → alıcı domain doğrulama bypass'ı. Aynı gerekçe: alıcı domainini nodemailer'a doğrulatmıyoruz. |

`sendMail` çağrısındaki alan kümesi sabit: `from · to · subject · html · text`. **`raw` YOK,
`attachments` YOK, dosya/URL referansı YOK** (`src/lib/email-core.ts:108`).

🚨 **PROD MARUZİYETİ DOĞRULANMADI.** Yol seçimi kodda `RESEND_API_KEY` → `EMAIL_HOST` sırasıyla
(`email-core.ts:163-165`), yani prod Resend kullanıyorsa nodemailer transport'u hiç kurulmaz. Ama
`EMAIL_HOST`'un prod'da set olup olmadığını **bu ortamdan göremiyorum** — operatör kontrolü
(aşağıda). "Ulaşılamaz" demiyorum, "kod yolu `EMAIL_HOST` istiyor" diyorum.

### 3.2 Zaten triaj edilmiş (kapıyı kırmıyor)

`postcss` × 4 (`qx2v` · `6g55` · `fxqj` · `r28c`) — hepsi baseline'da, **BUILD-TIME ONLY**.
🚨 **Önemli bulgu: `next@15.5.24` postcss'i hâlâ TAM SÜRÜM `8.4.31` olarak pinliyor.** Yani next
yükseltmesi postcss'i **düzeltmez**; bu dört kayıt yerinde kalır, yeni istisnaya da gerek yok.
`sharp GHSA-f88m` (`<0.35.0`) ve `nodemailer GHSA-p6gq` (`<=9.0.0`) de baseline'da.

## 4. UYGULANAN düzeltme (yerel) — en dar uyumlu güncelleme

| Paket | Önce | Sonra | package.json | Neden bu sürüm |
|---|---|---|---|---|
| `next` | 15.5.23 | **15.5.24** | `^15.5.21` → `^15.5.24` | İki critical'ın resmî düzeltme sürümü. 15.5.25 de var ama **en dar** olan bu; aralık yükseltmesi güvenlik tabanını belgeliyor |
| `sharp` | 0.34.5 | **0.35.4** | **değişmedi** (geçişli/optional kaldı) | `npm update sharp` ile; next'in kendi `^0.34.3 \|\| ^0.35.3` aralığı zaten kapsıyor. Doğrudan bağımlılığa TERFİ ETTİRİLMEDİ |
| `nodemailer` | 8.0.11 | **9.1.1** | `^8.0.11` → `^9.1.1` | 🚨 **Codex'in katkısı.** npm `fixAvailable`'ı `10.0.1` (iki major) diyordu; ama `GHSA-8m3c` aralığı `<=9.1.0`, geri kalanı `<9.1.0` → **9.1.1 beşini de kapatıyor, tek major yetiyor** |
| `postcss` | 8.4.31 | **8.4.31** | — | 🚨 `next@15.5.24` postcss'i **TAM SÜRÜM pinliyor**; yükseltemeyiz. Dört kaydı da baseline'da kalıyor (build-time only) |

`npm audit fix --force` **kullanılmadı** — hedefli `npm install next@15.5.24 nodemailer@9.1.1` +
`npm update sharp`.

### 4.1 Nodemailer major geçişi — kırıcı değişiklik incelendi
Resmî CHANGELOG, **9.0.0'ın TEK ⚠️ BREAKING CHANGES maddesi**: *uzak içerik çekilirken (attachment
href/path URL'leri, OAuth2 token ucu, HTTP/HTTPS proxy CONNECT) TLS sertifikası artık doğrulanıyor.*
Bizim tek çağrı yerimiz (`email-core.ts` `viaSmtp`) bu üçünün **hiçbirini** kullanmıyor: ek dosya yok,
OAuth2 yok (`auth: {user, pass}`), proxy yok. 9.x runtime bağımlılığı **sıfır** (8.0.11 gibi) → yeni
geçişli yüzey gelmedi. `@types/nodemailer` en son **8.0.1** (9 için tip paketi yok) — `^8.0.0`
bırakıldı ve **typecheck temiz**, yani kullandığımız imzalar değişmemiş.

### 4.2 Eski savunmasız geçişli kopya bırakılmadı
Kurulum sonrası ağaç taraması (`package-lock.json`):
`node_modules/next 15.5.24` · `node_modules/nodemailer 9.1.1` (**tek kopya**) ·
`node_modules/sharp 0.35.4 [optional]` · `node_modules/postcss 8.5.26 [dev]` ·
`node_modules/next/node_modules/postcss 8.4.31` (next'in pini — üretimdeki tek kalan).
sharp'ın native ikilisi gerçekten yükleniyor: `sharp 0.35.4 / libvips 8.18.6`.

### 4.3 Baseline: GEVŞETİLMEDİ, SIKILAŞTIRILDI
Kapı yükseltmeden sonra iki kaydı **bayat** diye uyardı; ikisi de **SİLİNDİ**:
`GHSA-f88m` (sharp, artık 0.35.4 ile kapalı) · `GHSA-p6gq` (nodemailer, 9.1.1 ile kapalı).
**Triaj kaydı 6 → 4.** Yeni istisna eklenmedi, hiçbir `expires` uzatılmadı.

### 4.4 Danışma bilançosu

| | Önce | Sonra |
|---|---|---|
| Üretim danışması (distinct) | **13** | **4** |
| Yeni/triajsız | **7** → KIRMIZI | **0** → yeşil |
| Kalan 4 | — | `qx2v` · `6g55` · `fxqj` · `r28c` — **hepsi postcss, hepsi triajlı, build-time only** |

Kapanan yedi: `GHSA-p293` (critical) · `GHSA-2xp9` (critical) · `GHSA-rgj7` (high) ·
`GHSA-2x7j` (high) · `GHSA-8m3c` · `GHSA-wmmp` · `GHSA-cc9r`. Artı bonus iki eski istisna.

## 5. Test kanıtı (hepsi bu ortamda koşuldu)

| Kapı | Sonuç |
|---|---|
| `npm test` (tam suit) | ✅ **347 dosya · 3845 geçti · 0 düştü** (+8 atlanan eval). Önce 346/3840 |
| `tsc --noEmit` | ✅ exit 0 |
| `eslint .` | ✅ exit 0 |
| `npm run build` (üretim) | ✅ tamamlandı |
| `npx playwright test` | ✅ **7/7** — tohumlanmış PG + gerçek üretim derlemesi |
| `prisma migrate diff --exit-code` | ✅ `No difference detected` (şema değişmedi) |
| `scripts/audit-check.mjs` | ✅ `Sonuc: yesil`, uyarı yok |

### 5.1 HEDEFLİ regresyon — görsel (sharp)

🚨 **Codex itirazı (haklı): "404 pini tek başına BAŞARI yolunu doğrulamıyor."** İki ayrı eksiği vardı
ve ikisi de kapatıldı.

**(a) `/_next/image` 200 dalı — BİLEREK AÇILMADI, gerekçesi:** bu uygulamada o ucun başarı yolu
YOKTUR; `next.config.mjs` `images: { unoptimized: true }`. Oradan 200 aldırmak `images.unoptimized`i
kapatmak demek — hem kurucunun bu tura koyduğu "güvenlik bayrağı değişikliği yapma" sınırının
dışında, hem de audit baseline'ının sharp gerekçesini (optimizer kapalı → ULAŞILAMAZ) kendi elimizle
geçersiz kılardı. İtirazın özü olan "kodek gerçekten çalışıyor mu, çözümlenebilir çıktı üretiyor mu"
sorusu bu yüzden başarı yolunun MEŞRU olarak var olduğu iki katmanda ölçüldü:

**(b) Kodek — sentetik görüntüyle, `tests/unit/sharp-image-pipeline.test.ts` (YENİ, 6 test):**
sürüm zafiyetli aralığın dışında (**sayısal** semver kıyası — metin kıyası `"0.35.10" < "0.35.4"`
derdi) · native ikili gerçekten ayakta (libvips 8.18.6) · **PNG · WebP · AVIF** üçü de kodlanıyor,
geri okunuyor (beklenen içerik türü) ve **ham piksele çözülüyor** (`w×h×kanal`) · bozuk girdi süreci
çökertmeden reddediliyor. AVIF önemli: `GHSA-rgj7` tam da o libheif ailesiydi.

**(c) HTTP başarı yolu — `tests/e2e/security-controls.spec.ts` (YENİ test):** gerçek üretim
sunucusundan `/lixus-logo.png` → **200** + `content-type: image/png` + gövde **sharp ile
çözümlenebilir** (format/boyut + ham piksel uzunluğu). Bu aynı zamanda **404'ün SEBEBİNİ bağlıyor**:
aynı yol 200 döndüğüne göre `/_next/image` 404'ü "kaynak yok"tan değil, optimizer kapalı olduğundan
geliyor.

**Mutasyonlar (hepsi yakalandı):**

| Mutasyon | Beklenen | Ölçülen |
|---|---|---|
| e2e `IMAGE_PATH` → olmayan dosya | başarı testi düşsün | ✅ `1 failed \| 5 passed` — **ve 404 pini YİNE GEÇTİ**: eski pinin yanlış sebeple geçebildiğinin ampirik kanıtı |
| `metadata()`e kırpık tampon ver | çözümleme düşsün | ✅ webp + avif düştü; **PNG geçti** (IHDR başta, kırpmadan sağ çıkıyor) → `metadata()` tek başına zayıf |
| `raw()` çıktısını `resize(1,1)` ile boz | üç format da düşsün | ✅ `3 failed \| 3 passed` — yükü taşıyan iddia bu |

### 5.2 HEDEFLİ regresyon — e-posta (nodemailer major) — **YENİ TEST**
🚨 **Bulgu: `viaSmtp` yolunun suit'te HİÇ testi yoktu.** Mevcut e-posta testlerinin hepsi
`EMAIL_HOST: ""` kuruyor, yani nodemailer hiç çağrılmıyordu — bir major yükseltmeyi "3840 test
yeşil" diye doğrulanmış saymak, hiç koşulmamış bir dalı doğrulanmış saymak olurdu.

Yeni: `tests/integration/email-smtp-transport.test.ts` — **gerçek soket**, 127.0.0.1'de ayağa kalkan
minimal ESMTP sunucusu, mock transport DEĞİL. Beş test:
1. teslim ediyor (seçenek + alan kümemiz kurulu sürümde kabul ediliyor); AUTH gerçekten yapılıyor;
   zarf `MAIL FROM`/`RCPT TO` doğru
2. HTML **ve** düz metin alternatifi birlikte gidiyor (`multipart/alternative`)
3. **ek dosya yok** pini — 9.0.0'ın kırıcı değişikliği bu yüzden bizi etkilemiyor; biri ileride
   `attachments` eklerse bu test kırılır ve karar yeniden gerekir
4. sunucu alıcıyı reddederse fırlatmaz → `{ok:false}` + hata metni
5. sunucuya ulaşılamazsa fırlatmaz → `{ok:false}`

**İki yönlü mutasyon (ikisi de yakalandı, tam 1 test / doğru test):**

| Mutasyon | Beklenen | Ölçülen |
|---|---|---|
| `sendMail`'den `text: htmlToText(html)` kaldır | metin alternatifi testi düşsün | ✅ `1 failed \| 4 passed` — "HTML ve DÜZ METİN" |
| `createTransport`'tan `auth` kaldır | teslim/AUTH testi düşsün | ✅ `1 failed \| 4 passed` — "teslim eder" |

Kaynak her mutasyondan sonra geri alındı (`git diff` boş).

## 6. Kalan karar / onay listesi

- [ ] **PUSH ONAYI** — düzeltme yerelde tamam ve tüm kapılar yeşil; `f757b52` (selam tekrarı) ancak
      bu push'la birlikte deploy olabilir. Kurucunun ayrı onayı bekleniyor.
- [ ] **Operatör kontrolü:** prod'da `EMAIL_HOST` set mi? Set DEĞİLSE nodemailer transport'u prod'da
      hiç kurulmuyor (Resend yolu). Bunu bu ortamdan **doğrulayamıyorum** — prod maruziyeti
      doğrulanmış sayılmıyor.
- [ ] **Bilinen risk notu:** nodemailer 9.0.3 STARTTLS/soket işleyişini sertleştirdi. SMTP sağlayıcısı
      self-signed/uyumsuz sertifika kullanıyorsa 9.x reddedebilir. Prod Resend kullandığı sürece
      etkisiz; SMTP'ye geçilirse ilk gönderim gözlenmeli.
- [ ] **postcss** dört kaydı yerinde (`expires: 2027-02-01`). Düzeltme bizde değil: next tam sürüm
      pinliyor. next@16'ya geçiş ayrı bir karar.
