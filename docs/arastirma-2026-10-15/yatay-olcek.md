# Yatay ölçek (2+ kopya) hazırlık denetimi — 2026-10-15

> Kapsam: Lixus AI'yı (Next.js 15 · Prisma 6 · PostgreSQL · Railway) bugünkü TEK kopyadan, Railway'in kendi yük dağıtıcısının
> arkasında 2+ kopyaya taşımak. Kod SALT-OKUNUR incelendi; test / DB / npm koşulmadı. Mevcut belge:
> `docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md` (10-10). Bu dosya onu DERİNLEŞTİRİR, çelişkide kod kanıtı yazılır.
> Bulgular ilerledikçe yazılıyor (kesme olursa kaybolmasın).

## Özet (tek ekran)
| # | Konu | Yer | Önem |
|---|---|---|---|
| 1.17 | Prisma havuzu sınırsız (çekirdek×2+1), Postgres 100 bağlantı; olası 2. havuz | `src/lib/db.ts:16-29` | **YÜKSEK** |
| 1.18 | Her kopya açılışta migration; Prisma kilidi 10 sn sabit → P1002 | `Dockerfile:139` | **YÜKSEK** |
| 1.10 | Yerel yükleme dalı (yalnız bayrak açıksa) | `src/app/api/upload/route.ts:111-136` | bayrak kapalı: yok |
| 1.16 | SIGTERM işleyicisi yok → yayında senkron kilidi 15 dk takılır | `src/lib/scheduled-sync.ts:109` | ORTA |
| 1.15 | QR devir e-postası istekten kopuk; kapanışta kaybolur | `src/lib/guest-chat-alerts.ts:281-292` | ORTA |
| 1.1 | Kopya başına 2 dk zamanlayıcı → senkron sıklığı ×N | `src/instrumentation.ts:107-138` | ORTA |
| 1.4 | Anlamsal vektörler süreç belleğinde | `src/lib/ai/embeddings/semantic-retrieval.ts:81-86` | ORTA |
| 1.5 | Anlama sonucu önbelleği kopya başına → karar tutarsızlığı | `src/lib/ai/semantic/understand.ts:278-280` | ORTA |
| 1.2/1.3/1.6–1.9/1.12–1.14 | kilit öncesi işler, fencing deliği, yedek kovalar, bcrypt kapısı, alarm kısıtları, geçmişten öğren | çeşitli | DÜŞÜK / hazır |
| 2 | **Kopya eklemek mesaj işleme kapasitesini BÜYÜTMEZ** (tek seri döngü); tek kopya ~30–45 müşteri / ~100–130 daire; ilk darboğaz saatlik derin geçiş, oto-cevap tavanı ~5–6/dk | `scheduled-sync.ts:332,441,484` | plan |

## 0. Yöntem
- `src/instrumentation.ts`, `src/lib/**`, `src/app/api/**` modül düzeyinde `new Map` / `setTimeout` / `setInterval` / `globalThis`
  / `fs.write*` / sayaç taraması; her bulgu satır numarasıyla kodda doğrulandı.

## 1. Bulgular — tek kopya varsayımları (kodda doğrulandı)

Önem ölçeği: **YÜKSEK** = 2. kopyadan önce düzeltilmeli (veri / güvenlik / açılış riski) · **ORTA** = maliyet, kalite ya da
alarm gürültüsü; 2. kopyadan önce düzeltilmesi önerilir · **DÜŞÜK** = bilinir, kabul edilebilir · **YOK** = zaten hazır.

### 1.1 Süreç içi zamanlayıcı (cron) — `src/instrumentation.ts:107-138`
- **Ne var:** her kopya açılışta kendi 2 dakikalık zamanlayıcısını başlatır (`setInterval(tick, 2 dk)`, `:137`), 15 sn sonra ilk vuruş
  (`:136`); kendi `/api/cron/sync` adresini `127.0.0.1` üzerinden çağırır (`:112`). `globalThis.__guestopsCronStarted` (`:107-109`)
  yalnız AYNI süreçte tekrar başlamayı önler, kopyalar arasında hiçbir şey paylaşmaz.
- **2 kopyada ne olur:** veri bozulmaz — asıl iş `SystemLock("scheduled-sync")` kilidinin arkasında (`scheduled-sync.ts:188-205`).
  Ama SIKLIK değişir: A kopyası t=0, 2, 4… dakikada; B kopyası t=0:50, 2:50… vurur. Bir geçiş 50 sn'den kısa sürerse kilit serbest kalır
  ve B'nin vuruşu İKİNCİ bir tam geçiş başlatır → senkron fiilen dakikada bir koşar. Sonuç: Hospitable'a 2 kat "dar pencere" isteği
  (429 riski — `hospitable.ts:106` geri çekilmesi tek çağrıda dakikalarca uyuyabiliyor), 2 kat org döngüsü sorgusu. N kopyada N kat.
  Ek olarak dış zamanlayıcı (cron-job.org) da aynı uca vuruyor → bugün de 2 tetik var, kopya sayısı bunu N+1'e çıkarır.
- **Önem:** ORTA (bozmaz, maliyeti ve dış API yükünü kopya sayısıyla çarpar).
- **En küçük düzeltme:** kilidi alınca "son geçiş BİTİŞ zamanı" satırı okunur; son başarılı geçiş 100 sn'den yeniyse geçiş atlanır
  (aynı `SystemLock` deseni, `claimDeepWindow` gibi — migration YOK). Alternatif: kopyaların hepsinde `INTERNAL_CRON_DISABLED=1`
  (`:99`) + yalnız dış zamanlayıcı / Railway Cron servisi. Önerim ilki (dış zamanlayıcı düşerse sistem durmasın — dosyanın kendi gerekçesi).

### 1.2 Kilit ÖNCESİ koşan işler — `src/lib/scheduled-sync.ts:308-323`
- **Ne var:** `alertTracker` okuması (`:308`), `backfillChannelConnections()` (`:315`) ve `warmAllKbVectorsOnce()` (`:323`) kilit
  alınmadan ÖNCE koşar; yani kilidi kaybeden kopya da bunları yapar.
- **2 kopyada ne olur:** backfill sorgusu her vuruşta her kopyada (normalde 0 satır, ucuz). Isıtma süreç başına bir kez (`kb-warm.ts:56`
  `bootWarmStarted`) → her kopya bütün bilgi tabanlarını AYRI ayrı gömer (embedding maliyeti × kopya). Backfill'in eşzamanlı iki
  kopyada çakışması ayrıca ölçülmeli (benzersiz kısıt yoksa çift satır; bkz. §1.13).
- **Önem:** DÜŞÜK (maliyet) — backfill için §1.13'e bağlı.
- **Düzeltme:** backfill'i kilidin İÇİNE taşı (tek satırlık yer değişikliği).

### 1.3 SystemLock + fencing — `src/lib/scheduled-sync.ts:101-299`
- **Durum: HAZIR (YOK).** Kilit veritabanında (`updateMany WHERE lockedUntil <= now`, `:200-204`), sahiplik jetonu (`holder`) ile
  uzatma/bırakma (`:233-263`), ilerleme tetikli yenileme (`:497`), kilit kaybında döngü kesilir + alarm (`:751-760`). Derin pencere
  takvimi (`claimDeepWindow`, `:164-180`) ve adil sıra imleci (`:131-156`) de DB'de → kopyalar ortak takvim kullanır.
- **Bilinen delik (tek kopyada da var):** tek org 15 dk'yı aşarsa (TTL `:109`) ikinci koşu paralel başlar (`:217-220` yorumu).
  `withSyncLock`'taki süreç içi `running` bayrağı (`:286`) bu deliği YALNIZ aynı süreçte kapatıyordu; 2 kopyada manuel "Mesajları çek"
  düğmesi öteki kopyaya düşerse bu ek koruma yok → delik 2 kopyada daha ulaşılabilir hâle gelir.
- **Önem:** DÜŞÜK→ORTA (büyük müşteri gelince). **Düzeltme:** org içi ilerleme noktasında `renewLock` (syncHospitable'a `onProgress`)
  ya da org başına ayrı kilit satırı (`scheduled-sync:org:<id>`).

### 1.4 Anlamsal arama vektör deposu — `src/lib/ai/embeddings/semantic-retrieval.ts:81-86`
- **Ne var:** parça vektörleri `const store = new Map<string, Float32Array>()` (`:81`), tavan 4.096 parça ≈ 25 MB (`:48`); saatlik ısıtma
  tavanı `WARM_TEXTS_PER_HOUR = 2.000` (`:55`) süreç belleğinde (`:85-86`). Eksik parça varsa karar SÖZCÜKSEL (`cold`, `:183-186`).
  KB yazma rotaları ısıtmayı yalnız YAZMAYI KARŞILAYAN kopyada başlatır (`kb-warm.ts:50-53`).
- **2 kopyada ne olur — somut senaryo:** ev sahibi A kopyasında "Wi-Fi şifresi" kalemini düzenler → A ısınır. 2 dk sonra cron B'de koşar,
  misafirin "internet çalışmıyor" mesajı B'de değerlendirilir: B'de yeni parçanın vektörü yok → `cold` → sözcüksel yol. Aynı soru A'da
  anlamsal, B'de sözcüksel çözülür; cevap kalitesi kopyaya göre oynar (yanlış cevap DEĞİL — anahtar metin özeti, bayat vektör dönmez).
  Açılış ısıtması ve saatlik tavan kopya başına → maliyet ×N, kalite tutarsızlığı.
- **Önem:** ORTA (güvenlik değil kalite + maliyet). Kurucunun 10-10 belgesinde de §3.3.
- **Düzeltme:** E2 adımı — vektörleri içerik özetiyle veritabanına (pgvector ya da düz `bytea`) yaz; okuma önce bellek, sonra DB.
  Ara çözüm (migration'sız değil): yok; geçici kabul = "soğuk yol sözcüksel, güvenli".

### 1.5 Diğer bellek önbellekleri (saf, içerik anahtarlı) — kopyaya göre tutarsızlık
| Yer | Ne | 2 kopyada | Önem |
|---|---|---|---|
| `src/lib/ai/semantic/understand.ts:278-280` | Anlama katmanı sonucu, 10 dk, 500 girdi, anahtar = model + istem metni | AYNI mesaj iki kopyada iki kez modele gider; model her seferinde aynı cevabı vermeyebilir → panelde "AI öner" (A kopyası) ile gece oto-cevap kararı (B kopyası, cron) aynı mesajı FARKLI okuyabilir. Tek kopyada 10 dk boyunca tutarlıydı. Maliyet ×2'ye kadar. | ORTA |
| `src/lib/ai/embeddings/provider.ts:106` | Sorgu vektörü önbelleği | yalnız gecikme/maliyet | DÜŞÜK |
| `src/lib/ai/translate.ts:32` | Çeviri, 6 sa, 200 girdi | aynı çeviri iki kez ödenebilir | DÜŞÜK |
| `src/lib/ai/retrieval/index-cache.ts:42` | BM25 dizini, 10 dk, içerik parmak izi | her kopya kendi kurar (CPU) — doğruluk etkilenmez | YOK |
| `src/lib/ai/prompts.ts:1413`, `ai/fallback.ts:669`, `retrieval/time-fields.ts:1288`, `history-learn/mask.ts:47`, `tasks/detect.ts:74`, `utils.ts:99`, `timezone.ts:62` | Saf hesap önbellekleri (düzenli ifade, istem türetme, biçimlendirici) | girdi→çıktı aynı, kopyadan bağımsız | YOK |
| `src/lib/hospitable-credentials.ts:49` | `primaryOrgIdCache` | env `PRIMARY_ORG_ID` set ise hiç okunmaz; süreç ömrü | YOK |
| `src/lib/health-probe.ts:32,52` | 3 sn sağlık önbelleği | kopya başına, zararsız | YOK |
- **Anlama tutarlılığı için düzeltme:** sonucu `messageId + istem özeti` anahtarıyla kısa süreli DB satırına yaz (ya da mevcut
  `RiskEvent`/konuşma öğesi kaydından oku). Alternatif kabul: her yol zaten kendi güvenlik kapısını koşuyor; tutarsızlık
  "farklı ama güvenli" sınıfında.

### 1.6 Hız sınırlayıcı — `src/lib/rate-limit.ts:14, 29-61, 104-120`
- **Durum: HAZIR (YOK).** Yetkili sayaç PostgreSQL'de (`RateLimitCounter`, tek `INSERT … ON CONFLICT`, DB saati), kopyalar ortak sayar.
  `buckets` Map'i (`:14`) yalnız DB'ye ulaşılamadığında devreye giren yedek.
- **2 kopyada:** DB kesintisinde her kopya kendi yedek kovasını tutar → limit N kat gevşer (zaten "tam açık değil" tasarımı, `:1-6`).
- **Önem:** DÜŞÜK. **Düzeltme:** yok (bilinçli).

### 1.7 bcrypt eşzamanlılık kapısı — `src/lib/auth/password.ts:36-68`
- **Ne var:** `inFlight`/`waiters` süreç belleğinde; varsayılan aynı anda 2 bcrypt, kuyruk 32, bekleme 8 sn.
- **2 kopyada:** kapının AMACI süreç başına olay döngüsünü korumak → kopya başına olması DOĞRU kapsam. Toplam kapasite 2×2=4 olur.
  Railway trafiği kopyalara RASTGELE dağıttığı için (bkz. §3 kaynak) bir kopyanın kuyruğu dolup 503 "sunucu yoğun" verirken öteki boş
  olabilir — giriş seli anında ufak dengesizlik.
- **Önem:** DÜŞÜK (bilinçli). **Düzeltme:** gerekmez; istenirse `PASSWORD_HASH_MAX_IN_FLIGHT` kopya CPU'suna göre env'den.

### 1.8 Günlük yapay zekâ bütçesi — `src/lib/ai/daily-budget.ts:102-125, 179-218`
- **Durum: HAZIR (YOK).** Sayaç `RateLimitCounter` satırı (`ai-daily:<org>`, `ai-daily-qr:<org>`) — süreç sayacı değil, kopyalar ortak.
  Tek istisna DB kesintisi: `rateLimit` bellek yedeğine düşer → tavan geçici olarak N kat.
- **Önem:** DÜŞÜK.

### 1.9 Süreç içi alarm / kayıt kısıtları (kopya başına çoğalır, bozmaz)
| Yer | Ne | 2 kopyada |
|---|---|---|
| `src/lib/report-error-core.ts:22-23` | hata e-postası bağlam başına 10 dk'da bir | aynı arıza her kopyadan ayrı e-posta (dağıtım bütün sayfaları bozarsa N e-posta). Zamanlanmış iş alarmları ayrıca DB'de geçiş tabanlı (`alert-state.ts`) → onlar ÇOĞALMAZ. |
| `src/lib/event-log.ts:98-113` | takip numarası olay günlüğü dakikalık tavanı (yorum: "yatay ölçekte kopya başına") | tavan ×N |
| `src/lib/automation.ts:4197-4220` | üslup profili deneme kısıtı 6 sa | profilsiz org için 6 saatte N deneme (kilit içinde seri; eşzamanlı değil) — küçük model maliyeti |
| `src/lib/ai/conversation-state-loader.ts:163-171`, `src/lib/erasure.ts:124-125`, `src/lib/ai/index.ts:295`, `src/lib/shadow-ai.ts:84` | günlük/10 dk'lık "bir kez raporla" kısıtları | rapor ×N |
- **Önem:** DÜŞÜK. **Düzeltme:** gerekmez; ileride `reportError` kısıtı `SystemLock` satırına taşınabilir (alert-state deseni).

### 1.10 Dosya sistemine yazma — `src/app/api/upload/route.ts:111-136`
- **Ne var:** eski yol `public/uploads/<org>/` altına yazar (`:130-133`). Üretimde `ALLOW_LEGACY_LOCAL_UPLOADS !== "1"` ise 500 döner
  (`:111-116`), canlıda `STORAGE_ENABLED=1` (Tigris) → dal ulaşılmaz. Saklama silmesi yerel diski de tarar (`data-retention.ts:971`).
- **2 kopyada:** bayrak açılırsa dosya yalnız yazan kopyanın diskinde; öteki kopya 404; saklama silmesi yalnız cron'u koşan kopyanın
  diskini temizler (KVKK). Ek olarak: Next.js YALNIZ derleme anında `public/` içinde olan dosyaları servis eder — çalışma anında
  eklenen dosya tek kopyada da servis edilmez; Railway'de kalıcı disk (volume) ile kopya (replica) birlikte KULLANILAMAZ (§3 kaynak).
- **Önem:** bayrak kapalıyken YOK; açıksa YÜKSEK. **Düzeltme:** canlı env'de `ALLOW_LEGACY_LOCAL_UPLOADS` olmadığını doğrula; ileride
  eski dalı tamamen kaldır (ayrı karar).

### 1.11 WebSocket / SSE — YOK
- Canlı bağlantı yok. Panel 30 sn'de bir `router.refresh()` (`src/components/inbox/auto-refresh.tsx:13-21`), QR misafir ekranı 5 sn'de
  bir yoklama (`src/components/guest-chat/guest-chat.tsx:144`). Her istek bağımsız → herhangi bir kopya cevaplar, yapışkan oturum gerekmez.
- Server Actions / ISR / `revalidatePath` / `unstable_cache` kullanılmıyor (tarama: sıfır eşleşme) → Next.js'in "kopya başına önbellek"
  ve "Server Actions şifreleme anahtarı" sorunları bizi ilgilendirmiyor.

### 1.12 Oturum / JWT epoch — `src/lib/auth/index.ts:83-108`
- **Durum: HAZIR (YOK).** Her sayfa/API isteğinde `User.sessionEpoch`, rol ve aktör epoch'u DB'den okunur; bellek önbelleği yok.
  JWT imzası `AUTH_SECRET` (ortak env). Şifre değişimi A kopyasında yapılınca B kopyasındaki eski çerez bir sonraki istekte düşer.
- **Not:** DB kesintisinde fail-open + rol "staff"a kısılır (`:132-151`) — kopyadan bağımsız.

### 1.13 Kanal bağlantısı geri doldurma — `src/lib/channels/connections.ts:216-252`
- **Durum: HAZIR.** `@@unique([organizationId, provider])` + P2002 yakalanır (`:245-248`) → iki kopya aynı anda koşsa da çift satır olmaz.

### 1.14 "Geçmişten öğren" arka plan yürütmesi — `src/app/api/properties/[id]/history-learn/route.ts:132`, `.../compare/route.ts:37`, `src/lib/history-learn/service.ts:414`
- **Ne var:** POST isteği çalıştırmayı `void executeHistoryLearnRun(...)` ile ARKA PLANDA başlatır (28 dk'ya kadar sürebilir, `service.ts:63`).
  Çift yürütmeyi CAS önler (`queued → running`, `:221-225`) → 2 kopya aynı işi ikilemez.
- **2 kopyada ne olur:** yürütme isteği karşılayan kopyada yaşar. Kopya güncellemede (rolling deploy) kapatılırsa iş yarıda ölür, satır
  `running` kalır; 60 dk sonra (`HISTORY_LEARN_STALE_MS`, `:65`) "interrupted" olur. Kuyruk süpürgesi yalnız `queued` satırı alır (`:404-414`),
  `running`de ölen işi YENİDEN BAŞLATMAZ. Kopya sayısı arttıkça "yayın sırasında öldürülme" olasılığı artar. Rotadan gelen `questions`
  seçeneği süpürge yolunda kaybolur (varsayılan 300).
- **Önem:** DÜŞÜK (anahtar `HISTORY_LEARN_ENABLED` varsayılan kapalı; misafire etkisi yok).
- **Düzeltme:** rota yalnız kuyruğa yazsın, yürütmeyi zamanlanmış iş (tek işçi) yapsın; ya da `after()` (Next.js 15) + Railway boşaltma süresi.

### 1.15 İstekten kopan arka plan e-postaları — `src/lib/guest-chat-alerts.ts:281-292`, `src/app/api/tasks/[id]/route.ts:213-223`
- **Ne var:** QR devir e-postası misafirin cevabını en çok `QR_ALERT_RESPONSE_BUDGET_MS` kadar bekletir, sonra gönderim KOPUK sürer.
  Önce rezervasyon satırına "sahiplenme" yazılır (`guest-chat-alerts.ts:169-189`), sonra e-posta; misafir en çok 2,5 sn bekler (`:96`).
- **2 kopyada ne olur (somut):** misafir QR'dan "su basıyor" yazar → B kopyası sahiplenir, e-postayı göndermeye başlar, tam o anda yeni sürüm
  yayına girer ve B'ye SIGTERM gelir. Kodda SIGTERM işleyicisi YOK (tarama: `process.on` sıfır eşleşme); Railway'in SIGTERM→SIGKILL
  bekleme süresi varsayılanı tartışmalı (0–3 sn, §3). E-posta gitmez, sahiplenme "gönderildi" gibi kalır → kritik olmayan sonraki devir
  e-postaları soğuma penceresi boyunca bastırılır. Tek kopyada da yayın anında olur; N kopyada her yayında N kopya öldürülür.
- **Önem:** ORTA ("riskli mesaj insana gider" sözünün e-posta ayağı).
- **Düzeltme:** `after()` (`next/server`) ile kaydet — Next.js App Router SIGTERM'de `after()` işlerini bekler (§3) — + Railway
  `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` ≥ 30. Daha sağlamı: sahiplenmeye "gönderildi" damgası + zamanlanmış işte "sahiplenilmiş ama
  gönderilmemiş, 5 dk'dan eski" satırı yeniden deneme.

### 1.16 Kapanışta kilit bırakılmıyor — `src/lib/scheduled-sync.ts:109, 252-263`; `src/instrumentation.ts:136-137`
- **Ne var:** SIGTERM işleyicisi yok; geçiş ortasında öldürülen kopya `SystemLock("scheduled-sync")` kilidini BIRAKAMAZ.
- **2 kopyada ne olur:** yayın sırasında eski kopya geçişin ortasındaysa kilit 15 dk (TTL) dolu kalır → yeni kopyalar 15 dk boyunca
  "locked" alır: mesaj içe aktarımı, oto-cevap, karşılama, şikâyet uyarısı 15 dk'ya kadar durur. Bugün geçişler kısa olduğu için olasılık
  düşük; müşteri sayısı arttıkça geçiş uzar (bkz. §2) ve olasılık "geçiş süresi / 120 sn" oranına yaklaşır.
  Railway sağlık kontrolü yalnız YAYIN anında çağrılır, sonra izlenmez (§3) → donmuş bir kopya trafikten otomatik çıkmaz.
- **Önem:** ORTA.
- **Düzeltme:** `instrumentation.ts`'te SIGTERM işleyicisi: zamanlayıcıları durdur, süren geçiş varsa en çok ~20 sn bekle, sonra kendi
  jetonuyla `releaseLock` (fencing zaten var) + Railway boşaltma süresi. Ya da (önerim) zamanlanmış işi ayrı TEK kopyalı "işçi" servisine al
  (§4) — web kopyalarının yayını bir daha geçiş öldürmez.

### 1.17 Prisma bağlantı havuzu — `src/lib/db.ts:16-29`
- **Ne var:** `new PrismaClient(...)` havuz ayarı olmadan; `DATABASE_URL`'de `connection_limit` YOK (repo genelinde tek geçiş bir test
  fikstürü). Prisma 6 varsayılanı = **fiziksel çekirdek × 2 + 1** (§3). Railway kapsayıcısında Prisma'nın gördüğü çekirdek sayısı ana
  makineninki olabilir (ölçülmedi) → kopya başına havuz 20–60+ olabilir. Railway Postgres'in `max_connections`ı standart **100** ve
  panelden değiştirme özelliği yok (§3).
- **İkinci havuz şüphesi (DOĞRULANMADI):** üretimde istemci `globalThis`'e YAZILMIYOR (`:27-29` yalnız geliştirmede). `onRequestError`
  (`instrumentation.ts:182-186`) → `request-error-report` → `report-error` → `event-log` → `db` zinciri Next.js'in "instrumentation"
  katmanında ayrı bir modül örneği yaratırsa, süreç başına İKİNCİ bir PrismaClient (ikinci havuz) doğar.
- **2 kopyada ne olur:** 2 × (havuz + olası ikinci havuz) + açılıştaki `migrate deploy` + operatör betikleri + Railway panel sorguları
  → yük anında "too many clients already" → bütün kopyalarda istekler 500, senkron düşer.
- **Önem:** YÜKSEK. **Düzeltme:** `DATABASE_URL`'e `?connection_limit=10&pool_timeout=20` (2 kopya × 10 = 20, işçi 5, migration/betik
  payı ile 100'ün çok altında) + `db.ts`'te istemciyi üretimde de `globalThis`'e yaz (tek satır, davranış aynı). Önce ÖLÇ:
  `SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1` bugünkü tek kopyada.

### 1.18 Açılışta migration yarışı — `Dockerfile:139` (`npx prisma migrate deploy && npm run start`), `railway.json:8-12`
- **Ne var:** her kopya açılışta migration koşar. Prisma bunu PostgreSQL danışma kilidiyle sıraya koyar, ama kilit bekleme süresi
  **10 sn ve değiştirilemez** (§3); aşılırsa `P1002` → kapsayıcı çıkar → `restartPolicyType: ON_FAILURE`, en çok 3 yeniden deneme.
- **2 kopyada ne olur (somut):** büyük `Message` tablosuna indeks ekleyen bir migration 40 sn sürer. Kopya-1 kilidi alır; kopya-2 10 sn
  bekler, `P1002` ile düşer, yeniden başlar, yine bekler… 3 denemeden sonra yayın "başarısız" olabilir. Railway topluluğunda aynı
  belirti "iki kopya açılışta migration koşuyor" diye teşhis edilmiş (§3). Ayrıca yayın sırasında ESKİ kod yeni şemayla birlikte koşar
  (örtüşme süresi) → "yalnız ekle" kuralı (CLAUDE.md) artık ZORUNLU sözleşme olur, öneri değil.
- **Önem:** YÜKSEK (migration içeren her yayında).
- **Düzeltme:** migration'ı Railway **pre-deploy command** adımına taşı (yayın başına BİR kez, ayrı kapsayıcıda; başarısızsa yayın durur),
  `CMD` yalnız `npm run start`. `tests/unit/railway-config.test.ts` pinleri buna göre güncellenir (bugün "startCommand tanımlama"
  ve "Dockerfile CMD açılış zincirinin sahibi" diye pinli). `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK` KULLANILMAZ (korumayı kaldırır).

### 1.19 Değişmeyenler (kontrol edildi, hazır)
- Mesaj / e-posta kuyruğu: `FOR UPDATE SKIP LOCKED` + `pg_try_advisory_xact_lock` (`outbox/worker.ts:209-221`); e-posta yoklayıcısı her
  kopyada 15 sn'de bir koşar (`instrumentation.ts:152-171`) — güvenli, yalnız N kat boş sorgu.
- iCal besleme kilidi (`import/sync.ts:66` advisory), konuşma kimlik kilidi (`ingest/write-service.ts:71-81`), silme (erasure) kilidi
  (`erasure.ts:209-225`), öneri onay kilidi (`ai-suggestions/act.ts:91`), QR istemci kimlikli tekilleştirme (`api/chat/[token]/route.ts:560-647`),
  plan değişikliği `jti` tek kullanım (`billing/plan-change.ts:262-266`, SystemLock'ta), alarm durumu (`alert-state.ts`, SystemLock'ta).
- `TRUSTED_PROXY_HOPS=2`: kopyalar aynı Railway kenar proxy'sinin arkasında → değişmez (`rate-limit.ts:289-310`).

## 2. Kapasite tahmini — bugünkü TEK kopya (koddan çıkarım; ÖLÇÜLMEDİ, varsayımlar açık)

### 2.1 En önemli gerçek: kopya eklemek "motoru" büyütmez
Mesaj içe aktarma + oto-cevap + karşılama + uyarı + iCal + hafıza geçişi TEK bir döngüdür: global kilit altında (`scheduled-sync.ts:332`),
org'lar SIRAYLA (`:484`), org içinde oto-cevaplar SIRAYLA (`automation.ts:4076` `for (const c of eligible)` → `await applyChannelAutoReply`, aday sorgusu `:4056`
org başına en çok 25). 2, 5, 10 kopya da olsa bu döngüyü aynı anda YALNIZ BİR kopya koşar. Yani kopya artırmak panel / QR / giriş
tarafını ve kesintisizliği büyütür; **misafir mesajı işleme kapasitesini BÜYÜTMEZ.** O kapasitenin anahtarı döngüyü paralelleştirmektir
(org başına kilit + küçük işçi havuzu) — ayrı iş (§4 adım 9).

### 2.2 Varsayımlar (yuvarlak, ölçümle düzeltilmeli)
- Tipik müşteri: 3 daire (Pro). Dar pencere 30 gün geri + 120 gün ileri (`scheduled-sync.ts:420-423`) → daire başına ~25 rezervasyon.
- Rezervasyon başına her geçişte: 1 işlem (silme kilidi + koruma okuması + mülk + rezervasyon okuması, gerekiyorsa yazma) + konuşma
  atlama kontrolü (`hospitable-sync.ts:275-460`) ≈ 6–8 DB gidiş-dönüşü ≈ **~25 ms**. Değişmeyen satır yazılmaz (`ingest/write-service.ts:153+`).
- Hospitable çağrısı ~0,5–1 sn (org başına 1 `listProperties` + daire başına 1 `listReservations` + yalnız yeni mesajı olan konuşmaya `listMessages`).
- Oto-cevap: kendi ölçümümüz gpt-5.1 tüm katmanlar **p50 6,9 sn / p95 10,3 sn** (`docs/olcum/live-pipeline-2026-09-30-gpt-5.1-E1-canli.md:23`)
  + DB + gönderim → **~10 sn / cevap**.
- Yoğun gün: daire başına ~20 misafir mesajı (`billing/plan-limits.ts:54-57` varsayımı); en yoğun saat günün ~%12'si.

### 2.3 Hesap
| Kalem | Tahmin |
|---|---|
| Dar geçiş, org başına | ~1,2 sn sabit + daire başına ~1,3 sn → 3 dairelik müşteri **~5 sn** |
| Saatlik DERİN geçiş (540 gün geri + 365 ileri, `:415-419`), org başına | daire başına ~150 rezervasyon → ~5 sn/daire → 3 dairelik müşteri **~16 sn** |
| Oto-cevap tavanı (seri) | ~6 cevap/dk ≈ **360/saat** (döngü başka hiçbir şey yapmasa) |
| Panel | sekme başına 30 sn'de bir yenileme (`auto-refresh.tsx:13-21`) → 100 açık sekme ≈ 3,3 istek/sn — Node için önemsiz |
| QR misafir ekranı | açık sohbet başına 5 sn'de bir yoklama (`guest-chat.tsx:144`), yoklama başına ~6 DB turu (`:136` yorumu) → 50 açık sohbet ≈ 10 istek/sn, ~60 sorgu/sn — sorun değil |
| Bellek | anlamsal depo tavanı ~25 MB (`semantic-retrieval.ts:48`), dizin önbelleği 64 girdi, anlama 500 girdi — sorun değil |

### 2.4 Sonuç — tek kopya bugün kabaca
- **Müşteri:** ~30–45 tipik müşteri (**~100–130 daire**) — mesaj gecikmesi normal saatte 2–4 dk'da kalır.
- **İlk darboğaz: saatlik derin geçiş.** ~45 tipik müşteride (45 × 16 sn ≈ 12 dk) geçiş bütçesine (`PASS_BUDGET_MS = 12 dk`, `:441`) dayanır;
  o saatte sıranın sonundaki müşterilerin misafir mesajları 12+ dk gecikir (veri kaybı yok — adil sıra imleci sonraki geçişte devam eder).
- **İkinci darboğaz: seri oto-cevap.** Yoğun günde ~100–150 dairede en yoğun saat ≈ 240–360 mesaj/saat → döngünün tamamı modeli beklemeye gider.
  Mesaj/dakika olarak: içe aktarma dakikada yüzlerce mesajı kaldırır; **oto-cevap tavanı ~5–6 mesaj/dk**.
- **Kalite darboğazı (sessiz):** anlamsal depo 4.096 parça + saatte 2.000 ısıtma (`semantic-retrieval.ts:48,55`) TÜM kiracılarda ortak.
  Daire başına 30–60 kalem (Pro/İşletme, `plan-limits.ts:69-81`) ile ~50–100 büyük bilgi tabanından sonra depo birbirini tahliye eder →
  kararların artan kısmı `cold` (sözcüksel) olur. Yanlış cevap değil, ama "anlamsal getirme açık" sanılırken fiilen kapalı.
- **Web / panel / QR:** yüzlerce eşzamanlı ev sahibi + onlarca açık QR sohbeti tek kopyada rahat; darboğaz değil.
- **Bugün:** 9 işletme / 11 daire (09-19 yedeği manifestosu) → tavanın çok altında; tek kopya fazlasıyla yeter.

### 2.5 Hemen yapılabilecek ölçüm (kod değişikliği YOK)
- Geçiş süreleri ZATEN kaydediliyor: `job.finished` / `job.org.processed` satırları `durationMs` taşıyor (`api/cron/sync/route.ts:49-58`,
  `scheduled-sync.ts:720-722`). Operatör olay ekranından "scheduled-sync" süre dağılımı okunur → yukarıdaki 5 sn / 16 sn tahmini düzeltilir.
- `SELECT application_name, state, count(*) FROM pg_stat_activity GROUP BY 1,2;` → bugünkü havuz büyüklüğü (§1.17).

## 3. Dış kaynaklar (web araması 2026-10-15; doğrudan sayfa çekimi bu ortamda engelli, arama özetlerinden)
- **Railway kopyalar:** kopya sayısı servis ayarından artırılır; tek bölgede genel trafik kopyalara RASTGELE dağıtılır (eski sayfa
  "round-robin" der, yapışkan oturum yok) — https://docs.railway.com/deployments/scaling · https://docs.railway.com/reference/scaling
- **Railway volume + kopya:** birlikte kullanılamaz (volume belgesinin "caveats" listesi; personel: "karşılıklı dışlayıcı") —
  https://docs.railway.com/reference/volumes · https://station.railway.com/questions/volume-removal-not-persisting-blocking-c8c64245
- **Railway sağlık kontrolü:** yalnız yayın başında çağrılır, yayından sonra İZLENMEZ; varsayılan zaman aşımı 300 sn —
  https://docs.railway.com/reference/healthchecks
- **Railway yayın kapanışı:** eski yayına SIGTERM, süre dolunca SIGKILL; `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` ve
  `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` ayarlanabilir; varsayılan bekleme forumlarda çelişkili (0 ya da 3 sn) —
  https://docs.railway.com/deployments/deployment-teardown
- **Railway pre-deploy command:** migration / tohumlama için uygulama başlamadan önce koşan komut; başarısızsa yayın düşer —
  https://railway.com/changelog/2025-01-10-pre-deploy-command
- **Railway Cron:** en kısa aralık 5 dk, iş bitince süreç ÇIKMALI → 2 dk'lık döngümüz için uygun değil —
  https://docs.railway.com/reference/cron-jobs
- **Railway Postgres bağlantı sınırı:** standart `max_connections = 100`; Railway'de değiştirme özelliği yok, önerilen çözüm istemci
  tarafı havuz (`connection_limit`) — https://station.railway.com/questions/how-to-increase-the-max-connections-on-p-5f3ce16e ·
  https://station.railway.com/questions/we-re-getting-too-many-database-connecti-2bcbbe76
- **Prisma 6 havuzu:** varsayılan `num_physical_cpus * 2 + 1`, `pool_timeout` 10 sn, `connection_limit` URL parametresiyle —
  https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections/connection-pool
- **Prisma Migrate kilidi:** danışma kilidi 10 sn zaman aşımı, DEĞİŞTİRİLEMEZ; aşılırsa P1002; `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`
  korumayı kaldırır; Railway'de "iki kopya açılışta migration" vakası —
  https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production · https://station.railway.com/questions/need-help-now-7dd9ee44
- **Next.js kendi sunucunda:** önbellek kopya başına (özel `cacheHandler` gerekir — biz ISR kullanmıyoruz); SIGTERM/SIGINT'te sunucu
  `after()` ile planlanan işleri bitirip çıkar — https://nextjs.org/docs/app/guides/self-hosting
- **Next.js `public/`:** yalnız derleme anında var olan dosyalar servis edilir — https://nextjs.org/docs/app/building-your-application/optimizing/static-assets

## 4. 2. kopyadan ÖNCE sırayla yapılacaklar
> Her adım ayrı, geri alınabilir, testli (K2). Misafire giden cevaba dokunan adım YOK (5 ve 7 hariç — onlar kalite, kurucuya sorulur).

0. **Ölç (kod yok):** `pg_stat_activity` bağlantı sayısı · olay günlüğünden geçiş süreleri (`job.finished` `durationMs`) · canlı env'de
   `ALLOW_LEGACY_LOCAL_UPLOADS` YOK, `STORAGE_ENABLED=1` · Railway'in bugünkü SIGTERM bekleme süresi (bir test yayınında log).
1. **Bağlantı havuzu (§1.17):** `DATABASE_URL`'e `connection_limit` + `pool_timeout`; `db.ts`'te istemci üretimde de `globalThis`'e.
   Önce TEK kopyada canlıya, bir gün izle. (Ön koşul: Railway açık.)
2. **Migration'ı açılıştan çıkar (§1.18):** Railway pre-deploy command = `npx prisma migrate deploy`; Dockerfile `CMD` = `npm run start`;
   `railway-config.test.ts` pinleri güncellenir. Tek kopyada denenir (migration'sız bir yayın + boş migration'lı bir yayın).
3. **Kapanış düzeni (§1.15, §1.16, §1.14):** `instrumentation.ts`'e SIGTERM işleyicisi (zamanlayıcıları durdur, süren geçişi ≤20 sn bekle,
   kilidi jetonla bırak); kopuk e-postalar ve "geçmişten öğren" `after()`'a; Railway `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`.
4. **Zamanlanmış işi tek yere topla (§1.1, §1.2):** önerim aynı imajdan ikinci bir Railway servisi "işçi" (kopya = 1, genel alan adı yok,
   zamanlayıcı AÇIK) + web servisi (kopya = N, `INTERNAL_CRON_DISABLED=1`). Daha küçük alternatif: DB'de "son geçiş bitişi" kapısı
   (kopya sayısından bağımsız 2 dk'da bir geçiş). Backfill kilidin içine (tek satır).
5. **Anlamsal vektör deposu (§1.4):** E2 — vektörler DB'de (migration). Ya da bilinçli kabul: soğuk kopyada sözcüksel.
6. **Sağlık izleme:** Railway sağlık kontrolü yalnız yayında → dış izleyici (Uptime Kuma / cron-job.org) `/api/health` + ayrıca
   `?strict=1` (zaten önerilmiş). Kopyayı trafikten otomatik çıkaran mekanizma Railway'de yok → donan süreç `restartPolicy` ile değil
   ancak çökünce yeniden başlar; olay döngüsü gecikmesi ölçümü (ileride) değerlendirilir.
7. **Anlama önbelleği tutarlılığı (§1.5):** kabul ya da DB'de kısa süreli sonuç (kurucu kararı).
8. **2. kopyayı aç:** Railway kopya = 2; ilk 48 saat izle: `lock-lost` alarmı, P1002, bağlantı sayısı, 503 "sunucu yoğun", e-posta alarm sayısı.
9. **(Kapasite için, kopyadan bağımsız):** senkron döngüsünü paralelleştir — org başına kilit satırı + 2–4 org'luk işçi havuzu;
   asıl müşteri ölçeği bununla büyür (§2.1). ~30 müşteriye yaklaşınca başlanmalı.

## 5. 10-10 belgesine göre farklar (düzeltmeler)
- 10-10 "Migration: Prisma kilitle sıraya koyar" → **eksik:** kilit beklemesi 10 sn ve sabit; uzun migration'da ikinci kopya P1002 ile düşer
  (§1.18). Ön koşul listesine girmeli.
- 10-10'da OLMAYANLAR: kapanışta kilidin 15 dk dolu kalması (§1.16) · kopuk QR devir e-postası (§1.15) · kopya sayısıyla senkron
  sıklığının artması (§1.1) · anlama önbelleği tutarsızlığı (§1.5) · olası ikinci Prisma havuzu (§1.17) · Railway sağlık kontrolünün
  yalnız yayında koşması (§1.16) · **kopya eklemenin mesaj işleme kapasitesini büyütmediği** (§2.1).
- 10-10 doğru olanlar aynen geçerli: hız sınırı DB'de, JWT + çerezde OAuth (yapışkan oturum gerekmez), kuyruklar SKIP LOCKED,
  `/api/health` normal mod sağlık kontrolüne uygun, `?strict=1` bağlanmamalı, `TRUSTED_PROXY_HOPS` değişmez.

## 6. Kurucu soruları (biçim: bugün · büyük şirketler · önerim · ÖRNEK · böyle yapalım mı?)

**S1 — 2. kopyayı ne zaman açalım?**
- *Bugün böyle yapıyorum:* tek kopya. Yayında ya da çökmede birkaç saniye–dakika panel ve QR cevap vermez.
- *Büyük şirketler:* en az 2 kopya ile başlar, ama önce "kopyaya hazır" maddelerini kapatır (havuz, migration, kapanış).
- *Önerim:* §4'ün 0–4. adımlarını Railway açılınca TEK kopyada yap; 2. kopyayı ~20–25 müşteride ya da ilk "bakımda açılmadı" şikâyetinde aç.
- *ÖRNEK:* bugün saat 14:00'te yayın → misafir QR'dan "anahtar kutusu açılmıyor" yazıyor, sayfa 30 sn "bağlanılamıyor" diyor.
  2 kopyada aynı yayında öteki kopya cevap verir, misafir kesinti görmez.
- *Böyle yapalım mı?*

**S2 — Zamanlanmış işi ayrı "işçi" servisine ayıralım mı?**
- *Bugün:* her kopya kendi 2 dk'lık zamanlayıcısını çalıştırır; kilit işi teke indirir ama 2 kopyada senkron dakikada bire çıkar, yayın
  sırasında süren geçiş ölebilir ve kilit 15 dk takılır.
- *Büyük şirketler:* "web" (çok kopya) ve "worker" (tek ya da kuyruklu) süreçleri AYRI çalıştırır (Heroku/Railway'in klasik web+worker düzeni).
- *Önerim:* aynı kod, iki Railway servisi: web (N kopya, zamanlayıcı kapalı) + işçi (1 kopya, zamanlayıcı açık). Dış zamanlayıcı yedek kalır.
- *ÖRNEK:* önce — saat 03:10'da misafir yazdı, o sırada yayın oldu, geçiş yarıda öldü → kilit 03:25'e kadar dolu, oto-cevap 03:26'da gitti.
  Sonra — web yayını işçiyi öldürmez, cevap 03:12'de gider.
- *Böyle yapalım mı?* (Alternatif daha küçük iş: tek servis + DB'de "son geçiş 100 sn'den yeniyse atla" kapısı.)

**S3 — Migration'ı açılıştan "yayın öncesi komut"a taşıyalım mı?**
- *Bugün:* her kopya açılışta `prisma migrate deploy` koşar.
- *Büyük şirketler:* migration'ı yayın hattında BİR kez koşar, sonra uygulamayı başlatır.
- *Önerim:* Railway pre-deploy command; başarısızsa yayın hiç başlamaz (bugünkü "açılış zinciri" güvencesi korunur).
- *ÖRNEK:* önce — 2 kopya + 40 sn süren indeks migration'ı: 2. kopya 10 sn sonra "kilit alınamadı" ile düşer, 3 yeniden denemeden sonra yayın
  başarısız. Sonra — migration bir kez koşar, iki kopya temiz şemayla açılır.
- *Böyle yapalım mı?*

**S4 — Veritabanı bağlantı tavanı koyalım mı?**
- *Bugün:* tavan yok; Prisma makinenin çekirdek sayısına göre seçiyor, kaç olduğunu bilmiyoruz. Railway Postgres en çok 100 bağlantı.
- *Büyük şirketler:* kopya başına sabit havuz + toplamı veritabanı sınırının altında tutar.
- *Önerim:* önce bugünkü sayıyı ölç, sonra kopya başına 10 (işçi 5).
- *ÖRNEK:* önce — yoğun anda 2 kopya 2 × 65 bağlantı açmaya çalışır, 101.'si "too many clients" → panel 500, senkron düşer. Sonra — istek
  en çok 20 sn sırada bekler, hata yok.
- *Böyle yapalım mı?*

**S5 — Yayında kapanışı düzenleyelim mi (SIGTERM + 30 sn boşaltma)?**
- *Bugün:* kapanış işleyicisi yok; süren e-posta / geçiş yarıda kesilir.
- *Büyük şirketler:* kapanış sinyalinde yeni iş almaz, sürenleri bitirir, kilitleri bırakır.
- *Önerim:* SIGTERM işleyicisi + `after()` + Railway boşaltma 30 sn.
- *ÖRNEK:* önce — misafir QR'dan "su basıyor" yazdı, devir e-postası tam yayın anında kesildi, ev sahibine HİÇ gitmedi. Sonra — e-posta
  gider, kopya ondan sonra kapanır.
- *Böyle yapalım mı?* (Misafire giden metni DEĞİŞTİRMEZ; yalnız ev sahibi e-postasının kaybolmasını önler.)

**S6 — Anlamsal arama vektörlerini veritabanına taşıyalım mı (E2, migration)?**
- *Bugün:* vektörler süreç belleğinde; her kopya ayrı ısınır, yayından sonra ilk mesajlar sözcüksel yoldan.
- *Büyük şirketler:* vektörler kalıcı depoda (pgvector vb.), sorgu anında yalnız soru gömülür.
- *Önerim:* 2. kopyadan önce yap (10-10 belgesindeki önerimle aynı); depo 4.096 parça tavanı ~50–100 büyük bilgi tabanında zaten dolacak (§2.4).
- *ÖRNEK:* önce — "evi ılık yapabilir miyiz?" A kopyasında "kombi" kalemini bulur, B kopyasında (soğuk) bulamaz, cevap "ev sahibine
  soruyorum"a düşer. Sonra — iki kopyada da aynı kalem bulunur.
- *Böyle yapalım mı?* (Misafire giden cevabın KALİTESİNİ etkiler → önce/sonra ölçümüyle.)

**S7 — Anlama sonucu kopyalar arasında aynı olsun mu?**
- *Bugün:* anlama katmanı sonucu 10 dk süreç belleğinde; tek kopyada panel önerisi ile gece oto-cevabı aynı okumayı kullanır.
- *Büyük şirketler:* model kararını mesaj kimliğiyle kaydeder, tekrar sormaz.
- *Önerim:* şimdilik KABUL (her yol kendi güvenlik kapısını koşuyor); ölçümde fark görülürse sonucu mesaj kimliğiyle DB'ye yaz.
- *ÖRNEK (olası, ölçülmedi):* önce (2 kopyada) — "yarın 11'de girebilir miyiz?" mesajını panelde "AI öner" A kopyasında "erken giriş
  isteği" okur ve taslağı bekletir; 2 dk sonra cron B kopyasında modeli YENİDEN çağırır, model bu kez farklı okuyabilir ve karar
  panelde görülenden ayrışır. Sonra (DB'de kayıt) — iki yol aynı okumayı kullanır.
- *Böyle yapalım mı?*

**S8 — Senkron döngüsünü paralelleştirelim mi (asıl kapasite)?**
- *Bugün:* bütün işletmeler sırayla, tek döngüde; oto-cevaplar da sırayla (~6/dk tavan).
- *Büyük şirketler:* iş kuyruğu + işletme başına kilit + birden çok işçi.
- *Önerim:* ~30 müşteriye yaklaşınca: işletme başına kilit satırı + aynı anda 2–4 işletme.
- *ÖRNEK:* önce — 45 müşteride saatlik derin geçiş 12 dk sürer; 40. sıradaki müşterinin misafiri 12 dk cevap bekler. Sonra — 4 işçiyle ~3 dk.
- *Böyle yapalım mı?*
