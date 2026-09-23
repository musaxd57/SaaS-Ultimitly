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
- **Manuel rezervasyon + kanal etiketi + referans (P3-4) — ÜRÜN KARARI:** elle girilen "Airbnb"
  etiketli bir rezervasyona referans yazılınca mesajlanabilir sayılıyor (yaşam döngüsü göndericisi
  Hospitable'a bu referansla gitmeye çalışır). Doğru çözüm referansın "kanal kimliği mi, not mu"
  olduğuna karar vermek — kurucunun.
- **Login ajanının kimlik AKIŞINI değiştiren dört önerisi — kurucu onayı + ilk deneme birlikte
  (CLAUDE.md kuralı), bu turda UYGULANMADI:** ① oturum çerezine `__Host-` öneki (ad değişince HERKES
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

1. **Entegrasyon sağlığı tablosu** (`IntegrationHealth`): bağlantı başına son başarı/son hata sınıfı —
   alarm durumu bugün `SystemLock` satırında; ürün yüzeyi (host'a "bağlantın bozuk") ayrı tablo ister.
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
