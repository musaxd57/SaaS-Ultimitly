# Denetim turu 09-23 — alarm seli + güvenlik/hata ayıklama/login + yapısal geliştirme

> Tetik: kurucunun gelen kutusu "⚠️ Lixus AI sistem hatası — scheduled-sync org …" e-postalarıyla
> doldu (gövde `IngestError: hospitable ingest unknown (HTTP 402)`). İstek (aynen): *"geçici olarak
> durdur gerekirse … yapısal olarak geliştirme … debugging + cybersecurity … Login pageimize ekstra
> 1 agent … hiçbir hack sistemiyle kırılamasın … didik didik."*
> Yöntem: yedi paralel ölçümlü ajan (login ajanı dahil) araştırdı/ölçtü; **kodu yalnız Claude yazdı;
> her bulgu kodda doğrulandı** (ajan raporunun bir kısmı bayat/yanlış çıktı, ↓"Reddedilen/ertelenen").

## 1. Olay: 402 alarm seli — KAPANDI, üretimde doğrulandı

| | |
|---|---|
| Kök neden | `scheduled-sync.ts` 402'yi 08-08'den beri susturuyordu ama `err instanceof HospitableError` diye bakarak. V0.6 (09-07) okumayı ingest adaptörüne taşıdı; adaptör hatayı `IngestError`a **sarıyor** → dal o günden beri ÖLÜYDÜ. Aynı sarmal iki okuyucuyu daha öldürmüştü (`serverError` 402→409 eşlemesi, `hospitable-sync` 401/403 "yeniden bağlan" dalı). |
| Düzeltme | `82bb675` + `e10b677`: tek kaynak `provider-errors` (`providerErrorStatus`, `isChannelSubscriptionInactive`), `IngestErrorKind`e `blocked` (402), sarmal-kör okuma yasağı **sınıf pini** (izinli beş dosya dışında `HospitableError` okunmaz), ördek tiplemesi YOK (OpenAI SDK hataları da `status: 402` taşır). |
| Üretim kanıtı | CI #1114 success 08:11Z → son alarm e-postası **08:08:22Z**; 08:10Z'den sonra `noreply@lixusai.com`dan **sıfır** e-posta (08:29Z kontrol). |

## 2. Sınıf düzeltmesi — "kalıcı arıza = tek e-posta" (`141c4a5`)

402 yalnız o günün tetiğiydi. **Asıl mekanizma:** `reportError`ın kısıtı süreç belleğinde, context
başına 10 dakikadır → 2 dakikalık döngüde HERHANGİ bir kalıcı arıza günde ~130 e-posta üretir, her
yeniden başlatma sayacı sıfırlar, Sentry ayağı hiç kısıtlanmaz.

- **`src/lib/alert-state.ts` (migration YOK — `SystemLock` satırı):** ilk arıza / SINIF değişimi → bir
  kez; aynı sınıf sürerken yalnız log + 24 saatte bir hatırlatma; başarı durumu temizler. E-posta
  gitmediyse **ya da kısıta takıldıysa** (aynı başlığı paylaşan başka anahtar) 15 dk sonra yeniden
  dener. DB düşerse SUSMAZ (eski yola düşer). Hata sınıfı mesaj METNİ taşımaz (PII + kardinalite).
- **Bağlanan yerler:** `scheduled-sync` (org × aşama anahtarı; e-posta KONULARI aynen), `hospitable-sync`
  sekiz toplulaştırılmış alarm, Paddle webhook (dormant + imza uyuşmazlığı — kimliksiz saldırgan
  artık kutuyu dolduramaz). 402 bilinen dış durumdur → aşamanın alarmını TEMİZLER.
- **Bilinen sınır:** hızlı dalgalanan (bir düşüp bir düzelen) arıza hâlâ yalnız `reportError`ın
  10 dk kısıtıyla sınırlı — eski davranıştan KÖTÜ değil; histerezis ayrı iş.

## 3. Bu turda kapatılan güvenlik/hata bulguları

| # | Bulgu (kodda doğrulandı) | Düzeltme | Commit |
|---|---|---|---|
| 1 | **ReDoS (P1):** yer tutucu regex'i kübik — 3.000 karakter 8,1 sn | doğrusal tarayıcı; 24k ~2 ms | `2dd2bd3` |
| 2 | **DoS (P1):** kesme regex'i O(n²) — 2.000 karakter 163–180 ms | eşdeğer doğrusal tarayıcı (400k rastgele girdide eski regex'le 0 fark) | `2dd2bd3` |
| 3 | Login: tanınan cihaz kapısı (hesap kovası kilit silahı olmasın), günlük TOTP tavanı 20 (yılda ~%79 → sınırlı), açık yönlendirme, JSON kontrolü IP kovasından önce | davranışsal pinli | `2dd2bd3`, `f07c473` |
| 4 | Cevap rotası kotası sahiplikten önce + org'suz anahtar → başka kiracı sahibin kotasını yakabiliyordu | org önekli anahtar | `24d1089` |
| 5 | KVKK export kotası rol kontrolünden önce → yönetici sahibin exportunu 1 saat kilitliyordu | sıra döndü | `24d1089` |
| 6 | Görev fotoğrafı: depolama-dışı HER aynı-kaynak yolu kabul → `/logout` gibi yol sahibin panosunda `<img src>` = tıksız GET | yalnız bu org'un yükleme dizini; pano eski satırları çizmeden eler | `24d1089` |
| 7 | OAuth: sağlayıcının kod reddi (invalid_grant) "iç arıza" sayılıp her seferinde alarm | red → `invalid_token`, alarm yok; 5xx/iç arıza alarmda kalır | `24d1089` |
| 8 | `absence.ts`te HAM NUL baytı → git dosyayı ikili saydı, diff/grep kör | kaçış dizisi + mekanik pin | `24d1089` |
| 9 | `npm run env:recover` = çıplak `git reset --hard` (operatör klonunda tek komut = geri dönüşsüz kayıp) | yalnız bulut konteyneri + TEMİZ ağaç | `24d1089` |
| 10 | Doğrulama e-postası kayıtta yazılan ADI basıyordu (kimliksiz içerik enjeksiyonu) + yeniden gönderme günde 384'e izin veriyordu | kişiselleştirme yok (account_exists emsali) + günlük tavan 6 | `141c4a5` |
| 11 | register/forgot/resend: JSON kontrolü IP kovasından SONRA (başka site NAT kovasını yakabiliyordu) | 415 önce | `141c4a5` |
| 12 | Kimlik e-postası KURTARMASI yalnız saatlik → deploy ortasında düşen sıfırlama kodu hiç ulaşmıyordu | her geçişte kurtarma, silme saatlik | `141c4a5` |
| 13 | Sınıflandırıcı önbellekleri: biri ölü ağırlık (≤%4), biri gerçek (+%75) | ölü silindi, gerçek olan ıska sayacıyla pinli | `24f671b` |
| 14 | Test saat-bombası: örüntü hafızası testi 2026-11-06'da kodsuz kırmızıya dönecekti | saat fikstüre sabitlendi (kırmızı-önce: saat ileri alınınca eski test düşüyor) | `4b735fb` |
| 15 | 09-19 yedeği ŞİFRESİZ; belgede "saldırgan da açamaz" YANLIŞTI; OneDrive eşitlemesi uyarısı yoktu | betik uyarır + 7-Zip AES-256 talimatı; belge düzeltildi | `4b735fb` |
| 16 | CSP report-uri geliştirmede HMR `eval`ini her yüklemede raporlayıp yerel konsolu 429 ile dolduruyordu | yalnız üretim derlemesinde | `4b735fb` |
| 17 | **Parola kırpma:** değiştirme/sıfırlama boşlukları siliyordu, giriş silmiyor → boşluklu parola sıfırlamadan sonra kilitliyordu | iki yol da kırpmaz | `f28e23d` |
| 18 | **Zafiyet kapısı fail-open:** URL'sinde GHSA olmayan danışma sayılmıyordu → `npm audit` raporlarken kapı yeşil | kararlı yedek kimlikle sayılır; `main` yalnız doğrudan çalıştırmada | `f28e23d` |
| 19 | `CRON_SECRET` kısa değer uyarısı yoktu (uçlar hız sınırlı değil). ⚠️ İlk taslak "eksik" uyarısını ÇİFTLİYORDU — kırmızı-önce koşusu yakaladı, eksik uyarısı zaten vardı | yalnız uzunluk uyarısı eklendi | `f28e23d` |
| 20 | Kiracılar arası yalıtım sekiz tutamaçta yalnız YAPISAL pinliydi | DAVRANIŞSAL pin (B oturumu + A kimlikleri: 2xx yok, veri değişmez) | `f28e23d` |
| 21 | **bcrypt CPU tüketme (F4):** ölçüldü — 8 eşzamanlı karşılaştırma olay döngüsünü ~800 ms donduruyor (panel/cron/QR dahil) | eşzamanlılık kapısı (2 + 32 kuyruk + 8 sn), taşarsa 503; üç bcrypt işlemi aynı kapıdan | `2a2548f` |

Kanıt: kırmızı-önce (eski kodda yeni testler **düşüyor** — 25 + 5 + saat-bombası + kapı testleri), iki
yönlü mutasyon: tur 2 **23/25** (hayatta kalan iki perf önbelleği ölçüldü: biri ≤%4 → silindi, biri +%75 →
sayaçla pinlendi) · tur 3 **35/36** (hayatta kalan A5 "sağlıklı yolda sorgu yok" → sayaçla pinlendi, tur 4'te
yakalandı) · tur 4 **8/8** · tur 5 **9/9**. Tam kapılar: ↓ bölüm 8.

## 4. Reddedilen / ertelenen (gerekçeli)

- **Süper-admin e-postasını her istekte DB'den okumak — ERTELENDİ (latent):** `User.email`i sonradan
  değiştiren HİÇBİR kod yolu yok (ölçüldü: tüm `user.update*` çağrıları tarandı); JWT e-posta iddiası
  kimliğin ömrü boyunca DB'ye eşit, silinen hesap zaten `sessionEpoch` kontrolünde düşüyor. Merkezi
  kimlik koduna sıfır maruziyetli bir kalem için dokunulmadı. **Ön koşul:** e-posta değiştirme
  özelliği eklenirse bu kontrol O GÜN eklenir (CLAUDE.md'ye yazıldı).
- **Manuel rezervasyon + kanal etiketi + referans (P3-4) — KARAR VERİLDİ (ikinci tur, ↓§9):** elle
  girilen "Airbnb" etiketli bir rezervasyona referans yazılınca mesajlanabilir sayılıyor (yaşam döngüsü
  göndericisi Hospitable'a bu referansla gitmeye çalışır, kod orada olmadığı için gönderim başarısız
  olur). **Karar: elle yazılan referans bir NOTTUR, gönderim yetkisi VERMEZ** — yetki yalnız
  rezervasyonun gerçekten bir kanal bağlantısından gelmesinden doğar (değişmez 20: "channel
  string'inden yetenek çıkarımı yasak"; CSV içe aktarma bu kuralı zaten uyguluyor). Bugünkü etkisi
  sıfır (kurucu org 402'de, başka müşteride sağlayıcı bağlantısı yok); kalıcı uygulama işaret kolonu
  ister (migration) → kanal bağlantısı modeliyle (Airbnb Direct zemini) birlikte.
- **Login ajanının kimlik AKIŞINI değiştiren dört önerisi — kurucu "mantıklı" dedi, İKİNCİ TURDA
  UYGULANDI (↓§9); ilk deneme birlikte yapılacak:** ① oturum çerezine `__Host-` öneki (ad değişince HERKES
  bir kez çıkış yapar) · ② 2FA AÇILINCA diğer oturumların düşürülmesi (`sessionEpoch` artışı + mevcut
  çerezin yeniden imzalanması; bugün 2FA öncesi çalınmış bir oturum geçerli kalıyor) · ③ parolada
  Unicode NFC normalizasyonu + bcrypt'in 72 bayt sınırının belgelenmesi (farklı klavyeden aynı parola
  farklı bayt olabilir; normalizasyon bir sonraki girişte yeniden hash ister) · ④ eski maliyet-10
  hash'lerin girişte maliyet-12'ye yükseltilmesi.
- ~~bcrypt eşzamanlılık tavanı~~ → **UYGULANDI** (`2a2548f`, satır 21). Varsayılan 2 bu konteynerin
  ölçümüne dayanır; Railway CPU'sunda farklıysa env ile deploy'suz ayarlanır.

## 5. Kendi kazam (dürüst kayıt)

`env:recover` koruma betiğini yazdıktan dakikalar sonra "denemek" için bu konteynerde doğrudan
çalıştırdım; koruma TASARIM GEREĞİ geçti ve `git reset --hard` commit edilmemiş ~30 dosyalık işi
sildi. Yerel commit'ler reflog'dan, düzenlemeler oturum kaydından birebir yeniden uygulandı; 31 dosya /
744 test ile doğrulandı. Sonuç: betiğe ikinci kilit (kirli ağaçta ÇALIŞMAZ, `--force` hariç) ve
CLAUDE.md kuralı: **yıkıcı bir betik "denemek" için ASLA çalıştırılmaz; koruma saf fonksiyonla test
edilir.**

## 6. Kurucu aksiyonları

1. **Yedeği şifrele:** `lixus-prod-pause-2026-09-19-104239.{dump,sql,-manifest.txt}` şifresiz;
   OneDrive'daysa çıkar. Komutlar: `docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`.
2. **Sır uzunlukları:** `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` ≥ 32 karakter mi? (Boot üçü için
   de kısa değerde UYARI basıyor; ≥32 doğrulanınca hataya çevrilebilir.)
3. **Deploy sonrası ilk giriş birlikte** ("kimlik akışı: ilk denemeler birlikte" kuralı): tanınan
   cihaz çerezi + günlük TOTP tavanı + doğrulama e-postasının yeni metni.
4. Alarm e-postaları: kutudaki eski "sistem hatası" e-postalarını arşivlemek/etiketlemek istersen söyle
   (izinsiz dokunulmadı).

## 7. Yapısal yol haritası (yapısal ajan önerileri — sıralı, hiçbiri bu turda uygulanmadı)

1. **Kanal bağlantısı sağlığı** — 🚨 Hospitable'a ÖZGÜ DEĞİL (kurucu 09-23: "amacımız zaten
   Hospitable'ı kaldırmak"). İlk yazımdaki "host'a 'Hospitable bağlantın bozuk' de" çerçevesi yanlıştı.
   Doğru biçim: `ChannelConnection` başına sağlayıcıdan bağımsız sağlık (değişmez 9: token/refresh/
   health/reconnect/revoked yaşam döngüsü) — Airbnb Direct geldiğinde aynı yüzey onu da taşır. Hospitable
   için ayrıca ekran YAPILMAZ.
2. **Tek LLM istemcisi + tek cevap boru hattı:** `ai/index.ts`, `translate.ts`, `openai-compat.ts`
   üç ayrı OpenAI çağrı yolu; kapı/iz/maliyet tek yerde toplanmalı.
3. **Yapılandırma kaydı:** env bayrakları dağınık; tek tipli kayıt + boot raporu.
4. **Anahtar halkası:** `ENCRYPTION_KEY` döndürülemiyor (CLAUDE.md "ASLA") — anahtar kimlikli şifre
   metni ile döndürülebilir hâle getirmek (migration + çift okuma).
5. **Operatör MFA zorunluluğu** kodda (bugün allowlist + `mfa` iddiası; kayıt anında zorlanmıyor).
6. **Test paketinin bölünmesi** (birim / DB'li entegrasyon / yavaş) — tam suite süresi ve CI kotası.
7. Açık P2'ler: yaşam döngüsü çift gönderim / açlık, `IngestEvent` indeks + saklama (migration),
   depolama fetch zaman aşımı, sınırsız büyüyen tablolar, OpenAI arıza alarmı, CI eylemlerinin SHA
   sabitlemesi, `security.txt` bitiş alarmı (2027-05-02) ve audit baseline bitişi (2027-02-02).

## 8. Kapılar

Dondurulmuş çalışma ağacında (`2a2548f`): **`npm test` 428 dosya / 5060 test yeşil** (24 atlanan, 1 todo) ·
`tsc` 0 · `lint` 0 · `build` temiz · `audit:check` yeşil (üretim: 4 danışma, 4 triaj kaydı). Migration YOK →
push kurucu onayı gerektirmez (kural: migration içeren push onay ister).

## 9. İkinci tur (aynı gün) — giriş ekranına SALDIRGAN GÖZÜYLE

İstek (kurucu, aynen): *"giriş ekranına karşı kötü niyetli birisi olarak düşünüp uzun uzun didik didik
geliştirmelere devam et agentlar çalıştır."* Beş saldırı ajanı (kaba kuvvet/hız sınırı · oturum/JWT/çerez/
middleware · hesap kurtarma/kayıt · istemci/HTTP yüzeyi · 2FA/kurtarma kodu/operatör) araştırdı ve ölçtü;
**kodu yalnız Claude yazdı, her bulgu eski kodda kırmızı-önce ile doğrulandı.** (İlk denemede beş ajanın dördü
organizasyonun aylık harcama limitine takıldı; limit sıfırlanınca yeniden başlatıldı.)

### 9.1 Kurucunun onayladığı dört öneri (hepsi UYGULANDI)

| # | Ne | Nasıl | Commit |
|---|---|---|---|
| ② | 2FA **açılınca** diğer oturumlar düşer | `sessionEpoch` aynı yazmada artar; işlemi yapan cihazın çerezi yeni epoch ile yeniden imzalanır, tanınan-cihaz çerezi yenilenir. Kapatma/kurtarma kodu üretimi epoch'a dokunmaz; `mfa` iddiası yükseltilmez | `ca6bdf8` |
| ④ | Eski maliyet-10 hash girişte maliyet-12'ye | yalnız TAM başarılı girişten sonra; epoch'a dokunmaz; CAS (arada sıfırlanan parolayı ezmez); parola kapısı doluysa kuyruğa girmez; girişi asla bozmaz | `ca6bdf8` |
| ③ | Parola Unicode NFC + 72 bayt | saklama NFC; doğrulama önce NFC, girdi NFC değilse ham biçim (eski hash kilitlenmez, girişte NFC'ye taşınır); sahte yol aynı sayıda karşılaştırma. Yeni parola en fazla 72 bayt (OWASP; Go/Spring de reddeder). **Müşteri metni sade** (kurucu): "Şifre çok uzun. Lütfen daha kısa bir şifre oluşturun." — bayt anlatılmaz; fiil ve hitap kurucu seçimi ("seçin" değil, "-iniz" değil), pinli | `ca6bdf8`, `e62f95c` |
| ① | Oturum çerezine `__Host-` öneki | üretimde yeni adla yazılır; okuma önce yeni adı, 2026-10-15'e kadar eski adı dener (kimse çıkışa zorlanmaz); middleware eski çerezi siler; çıkış iki adı da temizler; geliştirmede eski ad canlı. Chromium'un `__Host-`i http://127.0.0.1 ve localhost'ta kabul ettiği ölçüldü (CI uçtan uca giriş testi etkilenmez) | `d851afe` |

### 9.2 Saldırgan turunda kapatılan açıklar

| # | Açık (kodda doğrulandı, eski kodda kırmızı) | Düzeltme |
|---|---|---|
| 1 | **IPv6 /64:** hız sınırı kovası tam adresti → tek VPS'in /64'ü = 2^64 ayrı kova; "IP başına 10 deneme" fiilen yoktu (eski kodda aynı /64'ten 11. istek 401 aldı, 429 değil) | kova anahtarı /64 önekine indirgenir (IPv4 aynen, IPv4-eşlemeli → IPv4); iz/onay kayıtları tam adresi yazar; mekanik pin: hiçbir rota ham IP'den kova kurmaz |
| 2 | **2FA yönetiminde günlük tavan yoktu:** 10/10 dk = günde 1.440 kod tahmini; ayda ~%12 ihtimalle çalınmış oturum (parolasız) 10 KALICI kurtarma kodu basabiliyordu (parola değişiminden sağ çıkarlar) | kod doğrulayan eylemlere günde 20 hata tavanı; girişin tavanından AYRI anahtar (→ 13: sayaç ortaklaştı) |
| 3 | **Eski hash zamanlama kâhini:** hatalı giriş maliyet-10 hesapta ~80 ms, bilinmeyen hesapta ~315 ms (oran 0.26) → tek istekle "bu e-posta kayıtlı, erken dönem hesabı" | başarısız doğrulama sahte yolun süresine kadar bekletilir (işlemci harcamadan; başarılı giriş bekletilmez) |
| 4 | Başarısız giriş denetim yazımı yalnız bilinen hesapta ve kovadan SONRA sırayla → DB turu farkı | yazım kova tüketimiyle paralel (davranışsal pin: sıralı kodda test kilitlenir) |
| 5 | **Kayıt yarışı:** aynı yeni e-postayla iki eşzamanlı istek → 500 + ALARM E-POSTASI (sabahki selin aynı sınıfı; hesabı olmayan herkes tetikleyebiliyordu) | e-posta eşsizlik ihlali var-olan-hesap yanıtına eşit 201; yetim org kalmaz |
| 6 | Giriş sonrası `?next=/api/...`: saldırganın bağlantısıyla giren kurban anında çıkışa ya da veri dökümüne gönderilebiliyordu | API yolları hedef olamaz (yüzde kodlu/büyük harfli yazım dahil) |
| 7 | Host izin listesi `localhost:@evil.example`yi geçiriyordu (taban `http://localhost:@evil.example` = host evil.example) | yalnız tam `localhost`/`127.0.0.1` + sayısal port |
| 8 | `verify-email`: JSON kontrolü IP kovasından SONRA (dört kardeş rotada önceydi) | önce 415 |
| 9 | **Deneme e-postaları** kayıtta yazılan adı basıyordu → başkasının adresiyle kayıt olan, 13 gün sonra o kişinin kutusuna Lixus imzalı "Merhaba <kendi metni>" düşürtebiliyordu | selamlama sabit (doğrulama e-postası emsali) |
| 10 | **Sürekli kilitleme:** saldırgan hesap kovasını IP döndürerek dolu tutunca tanınan-cihaz çerezi olmayan her tarayıcı reddediliyor; kurban parolasını sıfırlayınca eski tanınan cihazları da ölüyordu | sıfırlamayı tamamlayan tarayıcı tanınan cihaz olur (kutuyu kanıtladı); kilit mesajı bu yolu söyler |
| 11 | Şifre değişince "yalnız DİĞER oturumlar düşer" yazıyordu ama işlemi yapan cihaz da sessizce çıkışa düşüyordu | bu cihazın çerezi yeni epoch ile yeniden imzalanır (② deseni); "beni hatırla" güveni bilinçli olarak düşer (S2) |
| 12 | 2FA sırrı ve kurtarma kodu yanıtlarında `no-store` yoktu | `Cache-Control: no-store` |
| 13 | **Oturum içi ŞİFRE tahmini:** çalınmış oturum 2FA kurulumunun "şifrenizi girin" adımını günde 1.440, hesap silmeyi günde 480 şifre tahmini için kullanabiliyordu; doğru tahmin ilkinde düz metin 2FA sırrını verir (saldırgan 2FA'yı kendi uygulamasıyla açıp sahibi dışarıda bırakır), ikincisinde hesabı siler. Eski kodda 20 yanlış şifreden sonra doğru şifre sırrı DÖNDÜRDÜ | 2FA kurulumu + 2FA kod işlemleri + hesap silme TEK günlük sayaç (20 hata, `reauth-guard.ts`); tavan dolunca doğru şifre de o gün reddedilir; tahminler ekranlar arasında bölünerek çoğaltılamaz. Şifre değiştirme bu sınıfta DEĞİL (e-postayla gelen kodla çalışıyor, mevcut şifreyi sormuyor) |

### 9.3 Doğrulanıp reddedilen / değişiklik gerektirmeyen

- **XFF adım sayısı (ajan P1, koşullu):** `TRUSTED_PROXY_HOPS=2`, kodun kendi kaydına göre canlı zincirin
  `<istemci>, <railway-edge>` olduğu ölçülerek seçildi; ajanın "edge tek adım ekliyorsa" varsayımı o kayıtla
  çelişiyor. Buradan canlıya istek atılamadığı için yeniden doğrulama kurucu adımı: `/admin` teşhis kartı
  kendi telefonundan açıldığında telefonun GERÇEK IP'sini göstermeli.
- **İstemci ajanı:** XSS, dışarı yönlendirme (98 elle + 400 bin rastgele yük, 0 kaçış), clickjacking (enforce
  `frame-ancestors 'self'` + `X-Frame-Options`), giriş-CSRF, prototip kirlenmesi, derin JSON — hepsi güvenli.
- **Oturum ajanı:** algoritma sabit (alg:none / RS256 reddedilir), `sessionEpoch` her yüzeyde, `mfa` her
  istekte DB'den, 83 rotanın hepsi korumalı ya da bilinçli açık, CVE-2025-29927 sınıfı etkisiz (middleware
  yetki sınırı değil).
- **Kalıcı parola ön-hash'i (SHA-256 → bcrypt) REDDEDİLDİ:** 72 bayt sınırını kaldırırdı ama OWASP'ın
  uyardığı "shucking" ve NUL bayt riskini getirir; reddetmek sektör varsayılanı.

### 9.4 Kurucu onayı bekleyen (kod YAZILMADI)

1. **Güvenlik bildirim e-postası** — parola değişince/sıfırlanınca, 2FA kapatılınca, kurtarma kodu
   üretilince, operatör 2FA sıfırlayınca hesaba "bu siz değilseniz bize yazın" e-postası (kişiselleştirmesiz).
   Bugün kurbanın tek işareti çıkışa düşmek. (E-posta akışı → onay.)
2. **Operatör hesabında "beni hatırla" operatör yetkisi vermesin** — bugün tanınan cihazla 30 gün boyunca
   yalnız parolayla `mfa: true` (operatör paneli) alınıyor; Airbnb'nin "personel MFA ile erişir" şartına
   daha sıkı uyum. Bedel: kurucu panele her girişte kod girer.
3. **Operatör müşteri hesabındayken plan değiştiremesin / veri dökümü alamasın** — 2FA, parola ve hesap
   silme zaten kapalı; plan değişikliği müşterinin kartından anında çeker.
4. **E-posta büyük/küçük harf eşsizliği** (`lower(email)` eşsiz indeksi, migration) — bugün tüm yazma yolları
   küçük harfe çeviriyor ama veritabanı kuralı büyük/küçük harfe duyarlı. Önce salt-okuma kontrol:
   `SELECT lower(email), count(*) FROM "User" GROUP BY 1 HAVING count(*) > 1;` ve
   `SELECT count(*) FROM "User" WHERE email <> lower(email);` — ikisi de 0 ise migration güvenle eklenir.
5. **Doğrulanmamış hesaba deneme e-postası gitmesin** (başkasının adresiyle kayıt = istenmeyen e-posta).
6. **`AUTH_SECRET` 32 karakterden kısaysa boot DURSUN** — bugün yalnız uyarı. Önce Railway'deki değerin
   ≥32 olduğu doğrulanmalı (kısa ise boot çöker; değiştirmek herkesi çıkışa atar ve `ENCRYPTION_KEY` yoksa
   şifreli veriyi kırar — ASLA doğrulamadan değiştirilmez).
7. **Mutlak oturum ömrü** (ör. 90 gün sonra yeniden giriş) — bugün kayan 14 gün; çalınmış bir çerez
   14 günde bir kullanıldıkça ölmüyor.
8. **NFC olmayan parolada ham-biçim denemesinin bir bitiş tarihi** (↓9.6 madde 3) — yayından ~90 gün
   sonra ham biçim denenmez; o tarihe kadar girmemiş ve parolası ayrık yazımla saklanmış (pratikte
   sıfıra yakın) kullanıcı "şifremi unuttum" kullanır. Kimlik akışı → onay.
9. **Kalan maliyet-10 hash'ler** (↓9.6 madde 2) — iş eşitliği zamanlama farkını kapattı; hash'lerin
   kendisini kaldırmak için önce say: `SELECT count(*) FROM "User" WHERE "passwordHash" LIKE '$2_$10$%';`
   (salt-okuma). Sayı küçükse ilgili hesaplara sıfırlama e-postası seçeneği; kimlik akışı → onay.

### 9.5 İlk deneme birlikte (kimlik akışı kuralı)

Deploy sonrası birlikte: giriş (çerez `__Host-` adıyla yazılıyor mu, eski oturum düşmeden taşındı mı) ·
şifre değiştirme (bu cihaz girişli kalıyor mu) · 2FA açma (diğer cihaz çıkışa düşüyor mu) · şifre
sıfırlama + ardından giriş.

### 9.6 İnceleme turu — bu turun KENDİ kodu saldırgan gözüyle (aynı gün)

Bir inceleme ajanı `421c5da..HEAD` farkını saldırgan ve gerileme avcısı gözüyle okudu (P1 yok; 2 × P2,
6 × P3). **Her bulgu kodda doğrulandı ve eski kodda kırmızı-önce ile kanıtlandı.** Ayrıca tam test
paketi, bu turun kendi iki hatasını yakaladı (↓ 10–11).

| # | Bulgu | Hüküm |
|---|---|---|
| 1 | **P2 — CI kırmızı olacaktı:** `verify-email`in JSON kontrolü artık 415 dönüyor, uçtan uca test JSON olmayan dört istek için 400 bekliyordu → "Wait for CI" açık olduğu için canlıya çıkış ATLANIRDI | ✅ test 415'e çekildi; meşru JSON yolu `expired` sebep koduyla gövdenin okunduğunu hâlâ kanıtlıyor; yerel uçtan uca koşu ↓8 |
| 2 | **P2 — zamanlama dolgusu eşzamanlı isteklerde sızıyordu:** başarısız maliyet-10 doğrulama yuvayı erken bırakıp DIŞARIDA uyuyordu → eşzamanlı isteklerde bitiş sırası hesabı ele veriyordu; dolgu hedefi (ortalama) saldırganın ürettiği yükle kaydırılabiliyordu | ✅ **İŞ EŞİTLİĞİ** (ajanın önerisinden iyi, ölçüldü): aynı yuvada maliyet 10 + 11 sahte karşılaştırma = tam bir maliyet-12 işi. Tek istek 318 ↔ 319 ms, 6 eşzamanlı istek 1,95 ↔ 1,90 sn. Uyku ve ortalama makinesi TAMAMEN kalktı; test artık süreye değil İŞE ve SIRAYA bakıyor (titremesiz) |
| 3 | P3 — NFC olmayan parola başarısız girişte bcrypt işini ikiye katlıyor (kapıyı doldurmak için gereken istek yarıya iniyor) | ⏸️ bilinen sınır: kapı + 503 zaten sınırlıyor; kalıcı çözüm bitiş tarihi → onay listesi (9.4 madde 8) |
| 4 | P3 — şifre değiştirme/sıfırlama yeni epoch'u işlem BİTTİKTEN sonra okuyordu → araya giren başka bir artışın epoch'unu alıp o ikinci geçersiz kılmadan sağ çıkabiliyordu | ✅ epoch işlemin içinden (2FA açmadaki desen); sıfırlama fonksiyonu yeni epoch'u döndürüyor |
| 5 | P3 — ortak günlük tavan (20) eşzamanlı isteklerle aşılabilir | ⏸️ bilinen sınır, SINIRLI: kısa kovalar (2FA 10/10 dk, silme 5/15 dk) aşımı en fazla ~34/güne tutar (önceki 1.920/gün); sayacı karşılaştırmadan önce yakıp başarıda iade etmek ek karmaşıklık, kazanç küçük |
| 6 | P3 — `__Host-` geçişi: (a) yeni kodun imzaladığı oturum eski adla FIRLATILIRSA middleware onu `__Host-` adıyla yeniden imzalayıp kalıcılaştırıyordu; (b) geliştirmede `__Host-` de okunuyordu (yerel `next start` kalıntısı geliştirme girişini ezer) | ✅ (a) her yeni oturum `hv` iddiası taşır, eski ad yalnız işaretsiz (yayından önce eski kodun imzaladığı) oturumu taşır → fırlatma penceresi yayından en geç 14 gün sonra kapanır (ajanın "iat tarihi" önerisinden iyi: saat sabiti yok, yayın gecikse de kimse düşmez); (b) geliştirmede yalnız eski ad |
| 7 | P3 — 2FA açma/şifre değiştirme anında uçuştaki başka bir istek eski epoch'lu çerezi geri yazabilir (kullanıcı bir kez çıkışa düşer) | ⏸️ bilinen sınır (düşük olasılık); kayan oturumun yeniden imzalama sıklığını azaltmak ayrı bir tasarım işi |
| 8 | P3 — `?next=` bozuk yüzde kodlamasında API kontrolü atlanıyordu (`/%61pi/auth/logout/%ZZ`) | ✅ çözülemeyen hedef → yok |
| 9 | P3 — IPv6 /48 sahibi hâlâ 256–65.536 kova alır; **takvim beslemesi /64 kovasına düşünce platform sunucuları tek kovayı paylaşacaktı** | ✅ takvim: ağ başına geniş taşma kapısı (600/dk) + takvim BAŞINA 60/dk — eski kodda aynı /64'ten iki takvimi çeken platformun 120 isteğinin 60'ı 429 alıyordu (çift rezervasyon riski). ⛔ ek /48 kovası REDDEDİLDİ: mobil operatörler binlerce aboneyi aynı /48 havuzundan dağıtabilir → ölçmeden toplu kilitleme riski |
| 10 | (tam paket) 08-07 kaynak pini, şifre rotalarında eski "200 karakter" metnini arıyordu | ✅ davranışsal değişmeze çevrildi (belirleme yolunun kabul ettiği en uzun biçimler girişten geçer) |
| 11 | (tip kontrolü) bu turun çerez testinde tip hatası | ✅ |

Kanıt: kırmızı-önce 4 (iş eşitliği) + 3 (takvim) + 2 (epoch) + 2 (yönlendirme) + 4 (çerez); değişen
modüllere dokunan 101 dosya 923/923; mutasyon ↓9.7.

### 9.7 Mutasyon (iki yönlü, temiz ağaçta, M0 kontrolü yeşil)

- Oturum içi yeniden doğrulama tavanı + şifre metni: **12/12** (kapıyı sil, `setup`i listeden çıkar, hata
  saymayı sil ×2, tavanı 19'a indir, bakmayı tüketmeye çevir, anahtarı ayır, metne teknik terim koy,
  "seçin"/"oluşturunuz" geri koy).
- İnceleme turu düzeltmeleri: **16/16** (dolguyu sil, ham-biçim dolgusunu sil, başarıya da dolgu, maliyet-12'ye
  de dolgu, dolguyu tam maliyet-12 yap · takvim kovasını paylaşılana çevir, taşma kapısını sil, takvim kovasını
  sil · üç epoch kaydırma · bozuk kodlamayı geçir · `hv` süzgecini sil, `hv` yazmayı sil, geliştirme dalını
  sil, çözülemeyen token'ı kabul et).
- Önceki (ikinci tur) mutasyon: **37/37**.

