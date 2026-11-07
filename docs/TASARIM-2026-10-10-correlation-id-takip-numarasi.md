# Correlation ID (takip numarası) — kurucu isteği, GOAL BİTTİKTEN SONRA yapılacak

> Kurucu (10-10, 8 ekran görüntüsü — kaynak bir eğitim videosu): "Bu ödeme yerinde böyle bir sistem ekleyelim mi … goal işlerimiz
> bittiğinde ona da bakarız; güzelce açıkla, sonra kendi okuyacağın yere nasıl yapacağını da not al." KOD YAZILMADI. Bu belge (1) kavramı,
> (2) bugün bizde ne olduğunu (kodda ölçüldü), (3) adım adım uygulama planını taşır. Başlamadan önce kurucuya §4'teki sorular sorulur.

## 1. Nedir? (görsellerin özeti)

- **Bir işlem = bir takip numarası.** Kullanıcı bir işlem başlattığında (ör. "Sepete ekle", "Sipariş ver", "Ödeme yap") sunucu o işleme
  rastgele, tahmin edilemez bir kimlik verir (UUID, ör. `7f3a91b2-6d84-4e0c-9a52-18b7d6c403ef`).
- **Zincir boyunca aynı numara.** İşlem bir servisten diğerine geçerken (sipariş → ödeme → ödeme sağlayıcısı) numara isteğin başlığında
  (`X-Correlation-ID`) taşınır; her servis kendi log satırına aynı numarayı yazar.
- **Yeni işlem, yeni numara.** Aynı kullanıcının "sepete ekle" ve "sipariş ver" işlemleri FARKLI numaralar alır; bir işlemin ara adımları
  (sepet isteği alındı → stok kontrolü) AYNI numarayı paylaşır.
- **Loglarda arama.** Aynı anda yüzlerce kullanıcının logu karışık akar (Yasemin, Taha, Uğur…); numarayla arayınca yalnız o işlemin satırları
  kalır: "Sipariş alındı → Ödeme başlatıldı → Ödeme zaman aşımına uğradı".
- **Destek.** Hata yanıtında kullanıcıya numara gösterilir; kullanıcı "Ödeme yapamadım" diye destek talebi açarken numarayı paylaşır; destek
  ekranı numarayla tam hata kaydını bulur ("Ödeme sağlayıcısı yanıt vermedi — 10 sn zaman aşımı, POST /v1/payments").

İdempotency ile farkı: idempotency anahtarı "aynı isteği iki kez UYGULAMA" içindir (etkiyi tekler); correlation ID "bu işlemin İZİNİ
bul" içindir (etkiye dokunmaz, yalnız iz bırakır). İkisi birlikte kullanılır.

## 2. Bugün bizde ne var (kodda ölçüldü 10-10)

| Parça | Durum |
|---|---|
| Genel istek takip numarası (her isteğe kimlik + log + yanıt başlığı) | YOK |
| QR misafir mesajı `requestId` (`api/chat/[token]`) | VAR ama bu bir IDEMPOTENCY anahtarı (aynı mesaj iki kez işlenmesin), takip numarası değil |
| Giden mesaj kuyruğu `idempotencyKey` (`lib/outbox`) | İdempotency, takip değil |
| Ödeme zinciri | `consentId` fiilen takip numarası gibi: onay kaydı → Paddle `customData` → webhook → abonelik / fatura. Ama log satırlarında ve hata yanıtlarında yok; kullanıcıya gösterilmiyor |
| Hata bildirimi (`reportError` → Sentry + e-posta) | Bağlam adı var ("paddle-webhook"), işlem numarası yok — "hangi müşterinin hangi denemesi" log içinden çıkarılamıyor |
| Operatör paneli "Operasyon Teşhisi" | Var; numarayla arama yok |

## 3. Nasıl yapılır (adım adım; sıra önemli)

1. **Kimlik üretimi tek yerde — `src/lib/correlation.ts` (yeni, yaprak modül):** `newCorrelationId()` (`crypto.randomUUID()`), biçim
   doğrulayıcı (yalnız UUID biçimi; istemciden gelen değer biçime uymuyorsa YOK sayılıp yenisi üretilir — log zehirleme olmasın), Node
   `AsyncLocalStorage` ile "şu anki işlemin numarası" (`runWithCorrelation(id, fn)`, `currentCorrelationId()`).
2. **Her API isteğine numara:** rota sarmalayıcıları (`lib/route-guard.ts` `withAuth / withManage / withOwner` + anonim rotaların ortak
   sarmalayıcısı) isteği `runWithCorrelation` içinde koşturur; yanıta `X-Correlation-ID` başlığı eklenir. (Next `middleware.ts` edge'de
   koşar, `AsyncLocalStorage` orada yok → numara middleware'de değil sarmalayıcıda üretilir.)
3. **Hata bildirimine otomatik ekle:** `reportError` / `alertOnTransition` mesajına ve Sentry etiketine `currentCorrelationId()` yazılır —
   çağıranların hiçbiri değişmez. Redaksiyon kuralları aynen (numara doğrudan tanımlayıcı değildir — bağlanabildiği için takma adlıdır, 10-16 Codex C6 — ama hiçbir yerde misafir metniyle yan yana
   loglanmaz).
4. **Ödeme zinciri (asıl istenen yer):**
   - Ödeme ekranı açılırken (`api/billing/consent`) numara üretilir, `CheckoutConsent` satırına yazılır (migration: tek nullable kolon) ve
     Paddle `customData`'ya `consentId`'nin yanına konur.
   - Webhook AYRI bir istek olarak gelir — başlık taşınmaz; numarayı `customData`'dan okuyup aynı zinciri sürdürür (abonelik / fatura /
     alarm satırları aynı numarayı taşır). Böylece "onay kaydedildi → ödeme ekranı açıldı → Paddle ödemeyi bildirdi → abonelik yazıldı"
     tek numarayla aranır.
   - "Ödemeniz işleniyor" kilidi (`lib/billing/checkout-pending.ts`, 10-10) ve ikinci abonelik alarmı da numarayı taşır.
   - Paddle'a giden sunucu istekleri (plan değişikliği, portal) numarayı log satırına yazar; Paddle'ın kendi istek kimliği
     (`x-request-id` yanıt başlığı, varsa) yanına kaydedilir — Paddle desteğiyle konuşurken iki taraf aynı işlemi bulur.
5. **Kullanıcıya gösterme (müşteriye giden metin → kurucu onayı):** yalnız beklenmeyen hatada (5xx) sade bir satır: "Bir sorun oluştu.
   Destek ekibimize yazarken bu takip numarasını paylaşın: 7f3a91b2". Kısa biçim (ilk 8 karakter) ekranda, tamamı panoya kopyalanır.
   Teknik ayrıntı GİTMEZ (kurucu 09-23).
6. **Arka plan işleri:** zamanlanmış senkron, giden mesaj kuyruğu, otomatik cevap — her İŞ ÇALIŞMASI ve her MESAJ işlemesi kendi numarasını
   alır (yeni işlem = yeni numara); kuyruğa yazılan satır numarayı taşır, işleyen aynı numarayla loglar.
7. **Destek / operatör ekranı:** "Operasyon Teşhisi"ne numara arama kutusu: numarayla eşleşen onay kaydı, webhook olayları, abonelik /
   fatura satırları, alarm kayıtları listelenir. Kalıcı log deposu yoksa (Railway logları metin araması destekler) ilk dilim yalnız DB
   satırları + Railway log araması bağlantısı.
8. **Testler:** sarmalayıcı her yanıta numara koyar · istemciden gelen bozuk numara yok sayılır · `reportError` numarayı taşır · ödeme
   zincirinde onay → webhook → fatura aynı numarayı taşır (gerçek PG) · iki eşzamanlı istek birbirinin numarasını görmez (AsyncLocalStorage
   sızıntısı yok) · müşteri metninde yalnız sade satır.

## 4. Başlamadan önce kurucuya sorulacaklar

1. Kapsam: yalnız ödeme zinciri mi (en çok istenen), yoksa bütün API + arka plan işleri mi? (Önerim: önce ödeme + hata bildirimi, sonra
   genel.)
2. Kullanıcıya hata ekranında takip numarası gösterilsin mi (müşteriye giden metin)? Biçim: kısa numara + "kopyala" düğmesi.
3. Migration (CheckoutConsent'e tek kolon + isteğe bağlı webhook olayına kolon) kabul mü? (Migration içeren push = taze yedek + onay.)
4. Log deposu: Railway logları yeterli mi, yoksa numarayla aranabilir kalıcı bir log tablosu / harici servis mi? (Maliyet + KVKK saklama
   süresi kararı.)

## 5. KURUCU KARARI (10-10) + seçilen log deposu

1. **Kapsam:** önerildiği gibi — önce ödeme zinciri + hata bildirimi, sonra genel (bütün API + arka plan işleri).
2. **Hata ekranı:** takip numarası gösterilir; metin (sade): **"Bir sorun oluştu. Destek ekibimize bu takip numarasıyla yazarak destek
   alabilirsiniz: 7f3a91b2"** (kısa biçim ekranda, tamamı "kopyala" ile panoya).
3. **Migration:** onaylandı (push öncesi taze yedek kuralı aynen).
4. **Log deposu:** kurucu kalıcı logu tercih etti ("sürekli Railway'e bakmaktan iyi; sen de görebilirsin"), seçim bana bırakıldı + 🚨
   **"güvenlik olarak çok gelişmiş olmalıyız, unutma."** → **SEÇİM: KALICI, YALNIZ-EKLE (append-only) OLAY GÜNLÜĞÜ TABLOSU** (Railway logları
   kaybolur / aranması zor; harici log servisi yeni bir veri işleyen = KVKK + maliyet).

**Güvenlik tasarımı (zorunlu, test-pinli olacak):**
- **Ne yazılır:** her istek DEĞİL — yalnız anlamlı olaylar (ödeme zinciri adımları, hatalar, alarmlar, webhook sonuçları). Olay adı ve kaynak
  KAPALI KÜME (serbest metin yok). Ek alanlar yalnız izinli anahtar listesinden (sayı / kimlik / kapalı küme). **Misafir mesajı, ad, telefon,
  e-posta, parola, jeton, kart verisi ASLA** — tek yazıcı `logEvent()` yapısal redaksiyondan (`lib/redact.ts`) geçirir; uzunluk tavanı.
- **Kim okur:** yalnız operatör (süper-admin allowlist + 2FA `mfa === true`, `isSuperAdmin` tek boğaz noktası); işletme kullanıcıları göremez.
  Her görüntüleme / arama denetim kaydına (`AuditLog`) yazılır; arama hız sınırlı. Bürünme (impersonation) modunda okunamaz.
- **Bütünlük:** uygulama yalnız EKLER; güncelleme yok; silme yalnız saklama süpürgesi ve hesap silmesi.
- **Saklama (KVKK):** süre sınırlı (öneri 90 gün; ödeme / fatura olayları muhasebe gereği ayrı karar) → otomatik süpürge; hesap silinince o
  işletmenin satırları silinir; dışa aktarımda (KVKK export) yer alır mı → avukat paketiyle karar.
- **Kiracı izolasyonu:** satır `organizationId` taşır (nullable — sistem olayları); operatör ekranı işletme süzgeçli; API kapsam pini.
- **Hacim / kötüye kullanım:** satır başı boyut tavanı + işletme başına dakikalık yazma tavanı (log seli tabloyu şişirmesin).
- **Claude'un görmesi:** bu bulut ortamı canlı veritabanına BAĞLANMAZ (bağlanmamalı). Operatör ekranında numarayla arama + "JSON olarak
  indir"; kurucu gerektiğinde dosyayı paylaşır. Doğrudan erişim istenirse ayrı karar (salt-okuma, IP kısıtlı, süreli).

## 6. Uygulama durumu (10-12 gece — ilk dilim: ödeme zinciri + hata bildirimi; migration 63)

| Adım (§3) | Durum | Yer |
|---|---|---|
| 1 Kimlik üretimi | ✅ Yalnız SUNUCUDA; istemcinin gönderdiği başlık / gövde değeri KABUL EDİLMEZ (tasarımdaki "biçime uyan istemci değeri" seçeneği güvenlik için kaldırıldı — başkasının zincirine satır yazdırılamasın) | `lib/correlation.ts` |
| 2 Her API isteği | ✅ `withAuth / withManage / withOwner`; yanıt başlığı `X-Correlation-ID` (yanıt anındaki numara — zincire katılan istekte zincirin). Anonim rotalar (QR, webhook dışı) numarasız | `lib/route-guard.ts` |
| 3 Hata bildirimi | ✅ Log satırı + Sentry etiketi `correlation_id` + alarm e-postası "Takip numarası"; işlem dışı hata kendi numarasını açar | `lib/report-error*.ts` |
| 4 Ödeme zinciri | ✅ Onay kaydı numarayı taşır (`CheckoutConsent.correlationId`); webhook numarayı istemci verisinden DEĞİL onay SATIRINDAN okur ve yalnız bağlama tazeliğini geçen onayda; "Ödemeniz işleniyor" aynı zincire katılır; Paddle istek kimliği günlükte | `api/billing/*`, `api/webhooks/paddle`, `payments/paddle.ts` |
| 5 Kullanıcıya gösterme | ✅ Kurucu metni AYNEN — kurucu kararı 10-12 sabah: **YALNIZ ödeme ekranında** (`/api/billing/*`, tek kaynak `USER_VISIBLE_CORRELATION_PREFIX`); "Takip numarasını kopyala". Diğer panel hatalarında eski metin, numara arka planda | `lib/api.ts serverError`, `tracking-number-copy.tsx` |
| 6 Arka plan işleri | ✅ 2. dilim (kurucu 10-12 sabah "Evet, yap"): senkron geçişi kendi numarasıyla tek özet (`job.finished` / `job.failed`); işletme işlemesi kendi numarası + işletmesiyle (hata raporu o işletmeye bağlı; iş varsa `job.org.processed`); giden kuyruk satırı başına (`job.outbox.row`, sonuç + satır kimliği); e-posta kuyruğu boşaltımı kendi numarasıyla. Migration yok | `api/cron/sync`, `scheduled-sync.ts`, `outbox/worker.ts`, `email-outbox.ts` |
| 7 Operatör ekranı | ✅ Kısa / tam numarayla arama + JSON indir; süper-admin + 2FA, bürünmede yasak, site dışı istek reddi, saatte 60, zorunlu denetim kaydı | `api/admin/events`, `admin/event-search.tsx` |
| 8 Testler | ✅ `tests/unit/correlation.test.ts`, `tests/integration/correlation-event-log.test.ts` (gerçek PostgreSQL; tetikleyici migration dosyasının KENDİ SQL'inden kurulur) | — |

**Güvenlik şartları (§5) → kod (Haiku iki güvenlik turu sonrası):** olay adı kapalı küme (`OPERATIONAL_EVENTS`) · veri yalnız izinli anahtar + ANAHTAR BAŞINA kalıp (`sub_` / `txn_` / `evt_` / cuid / onaltılık istek kimliği); hiçbir metinde boşluk, `@`, `+` ya da 7+ haneli rakam dizisi (telefon / TC kimlik) olamaz; yapısal redaksiyondan geçmeyen değer düşer, düşen sayısı `_dropped` · hata bağlamı yalnız ilk kod belirteci · UPDATE, taze satırın DELETE'i ve TRUNCATE veritabanı tetikleyicisiyle reddedilir (migration 63 + 64; silme yalnız 89+ gün ya da işletme silinmesinin kademesi) · dakikalık tavan sınıf başına (ödeme / iş / diğer — biri ötekini boğamaz; aynı bağlamdan hata 5; tavan tablosu dolunca SIFIRLANMAZ) · yazım en fazla 0,5 sn bekletir, geç düşen loglanır · işletmesiz satır Paddle kimliği taşımaz · operatör araması sonucu dönen her işletmenin kendi denetim kaydına da yazılır · 90 gün süpürge · KVKK dışa aktarma: gerekçeli dışarıda, avukat kararı bekliyor.

**Bilinen sınırlar:** kısa numara (8 karakter) araması `LIKE 'x%'` → `correlationId` dizini kullanılamaz (tablo 90 günlük ve tavanlı; şemada operatör sınıfı Prisma farkında kalıcı sapma üretir) · tavanlar süreç içi (yatay ölçekte kopya başına) · aynı anda iki düzenleyicinin boş kaydetiyle diğerinin değişikliği arasında son yazan kazanır.

**Kararlar:** ödeme olaylarının saklama süresi — kurucu 10-12 sabah "90 gün yeterli" · olay günlüğünün KVKK dökümüne girip girmeyeceği (avukat) · migration 63 / 64 Railway açılmadan önce taze yedek kuralı aynen.
