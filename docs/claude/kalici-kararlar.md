# Kalıcı kararlar (denetim, kimlik, tenant, KVKK, mesajlaşma, faturalandırma, kanal, AI/QR)

> CLAUDE.md'den 2026-10-08'de AYNEN taşındı (kurucu: ".md'ye yığma, gerekli yerlere taşı, gerekli şeyleri silme").
> Bu dosyadaki kurallar CLAUDE.md'deki kadar BAĞLAYICIDIR. İlgili alanda iş yapmadan önce oku.

## Kalıcı kararlar (yeniden tartışma yok — gerekçe: arşiv + git log)
**Denetim/kanıt — Codex 2026-09-05 (hedef `73dbfb4`; rapor `docs/audit-2026-09-05/`, tur durumu `DURUM.md`)**
Sekiz P1 KAPANDI (09-07), her biri ayrı commit, kırmızı-önce + iki yönlü mutasyon + tam kapılar. Kurallar:
- **F08 test DB kapısı** (`scripts/test-db-guard.mjs`): `TEST_DATABASE_URL` yolunda `db push --accept-data-loss`
  ÖNCESİ üç katman — loopback (ya da açık `TEST_DB_ALLOW_REMOTE=1`) + DB'nin kendi harness işareti
  (VERİTABANI YORUMU `lixus-test-harness:v1`; tabloya yazılsaydı `db push` silerdi) + işaretsiz DB yalnız
  BOŞSA sahiplenilir (dolu için tek seferlik `TEST_DB_ADOPT=1`). URL hiçbir mesaja basılmaz. CI'nin Linux
  provisioning yolu etkilenmez.
- **F01 model çıktısı STRICT** (`ai/index.ts`): `riskLevel` yalnız kapalı kümeden STRING — EKSİK = tanınmayan
  = "high"; `confidence` yalnız sonlu number, boolean/string/null → 0 (coercion YOK). Şema ihlali
  `reportError("openai-reply schema violation")` (throttled) + host'a sebep notu. Kapıda `Number.isFinite`.
  ⚠️ "Eksik → none" ile "tanınmayan → high" asimetrisi açığın ta kendisiydi; geri getirme.
- **F02 QR sır filtresi TAM TARAR** (`guest-chat.ts`): head/tail 4.000 kemeri KALKTI (18k'lik tek kalemin
  ortası taranmıyordu); `SECRET_SCAN_MAX_CHARS` 24.000 = validator tavanı + başlık; üstü hakkında hüküm
  verilmez → elenir. ReDoS ölçüldü: 24k adversarial × 6 kalıp × 3 katlama = 0.7–3.2 ms/kalem.
- **F03 silme → kuyruk sözleşmesi:** `conversations/[id]` ve `properties/[id]` DELETE aynı TX'te
  `ERASABLE_STATUSES` + `claimedBy:null` satırları `canceled` yapar (belt); worker `replyVeto` HER yanıt türü
  için önce "hedef var mı + aynı kiracı mı" sorar (`conversation_gone`/`message_gone`/`tenant_mismatch`),
  SONRA yalnız AI'ya durum vetosu (braces). 🚨 "Message yok = manuel, geçsin" dalı geri gelmez. Bilinen sınır
  pinli: claim+veto sonrası POST ile eşzamanlı silme geri alınamaz, satır dürüstçe `sent` kalır.
- **F04 OAuth refresh CAS** (`hospitable-credentials.ts`): persist `updateMany WHERE hospitableRefreshTokenEnc
  = refresh BAŞLARKEN okunan blob`; 0 satır = bağlantı değişti (disconnect/reconnect/kazanan refresh) → token
  DB'ye yazılmaz VE çağırana aktif diye verilmez (null). Generation kolonu YOK, blob'u değiştiren her yazma
  generation'dır. DB hatası ≠ CAS kaybı (hata dalında eski retry+alarm+taze token korunur).
- **F05 teslim ACK'i koşullu** (`worker.ts markConversationDelivered(row, now)`): yanıtın kendi Message'ından
  SONRA inbound varsa `answered` YAZILMAZ; AI satırı `problem` kilidini ASLA ezmez; host yanıtı eski inbound'un
  açtığı problem'i meşru kapatır; `lastMessageAt` yalnız `lt: now` ise ilerler. Tek UPDATE'te ilişki filtresi.
- **F06 sayfa yolu DB arızası:** `requireAuth` catch'i `session.mfa = false` (operatör yetkisi doğrulanamadıysa
  YOK; `/admin` kapısı `isSuperAdmin` bu yüzden kapanır) + impersonation oturumu doğrulanamazsa ÇIKIŞ. Normal
  müşteri oturumu fail-open (kitlesel çıkış yok). Eski "iddia olduğu gibi kalır" pini YANLIŞTI, ters çevrildi.
- **F07 retention bayrak-AÇIK seçici** (`RETENTION_MESSAGE_AGE_ANCHOR=1`): 8 yeniden-temizlenebilirlik bacağı
  (phone/email/externalId/checkoutTime/notes/konuşma adı/triyaj/görev açıklaması) + öksüz dalda triyaj.
  **BACAK KURALI = SONLANMA KURALI:** yalnız süpürgenin KENDİSİNİN null/sentinel yaptığı alan bacak olur;
  ad-redaksiyonlu metinler (`TaskUpdate.note`, outbound gövde) bacak OLAMAZ → işaret kolonu ister, BİLİNEN
  SINIR test-pinli. Bayrak kapalı davranış birebir eski. Bayrak açma onayı DEĞİL.
- **Kalan P2 (ayrı modül turları):** ~~F09 CSP raporu path token'ı~~ (KAPANDI 09-26, ↓Tenant / rotalar CSP) ·
  ~~F10 merkezi log redaksiyonu~~ (KAPANDI 09-26, ↓Veri yaşam döngüsü redaksiyon; AÇIK: audit yazılamazsa eylem başına
  durdurma politikası = kurucu kararı) · ~~F11 mülk
  silmede obje temizliği~~ (KAPANDI 09-26, ↓Tenant / rotalar yükleme) · ~~F12 audit baseline şeması~~ (KAPANDI 09-26,
  ↓Tedarik zinciri) · ~~F13 üslup profili ↔ tesis gerçeği~~ (KAPANDI 09-26) · F14
  sohbet hafızası/zaman (KODDA 09-26, bayrak arkasında — ↑KONUŞMA KAYITLARI; açık: CUS v2 defteri, bayrağı açmak) ·
  ~~F15 kalite denetimi `{}`~~ (KAPANDI 09-26: `evaluated/inconclusive/empty`; boş liste YALNIZ tam
  değerlendirmede "uygun"; okunamayan / örneklemde olmayan mesaja ait bulgu sayılır, raporu eksik yapar; 09-30: 200'ü aşan bulgu
  listesi eksik rapor, uzun özet kırpılır, 60 üstü gizlenen sayılır, bilinmeyen önem YÜKSEK) · ~~F16 iCal
  completeness~~ (KAPANDI 09-26, ↓Mesajlaşma / outbox / sync) · ~~F17 cron adaleti~~ (KAPANDI 09-26, ↓Sync motoru) · F18 login savunma
  tasarımı (ÖZÜ 09-23'te kapandı: tanınan cihaz kapısı + 2FA günlük tavanı; passkey/kademeli doğrulama kurucu kararı).
  Hepsine dokunuldu; Codex'in "Mevcut iyi temeller" ve V0 mimari önerileri raporda.
- Kaynak taraması tek yönlüdür → davranışsal test; `rejects.not.toThrow(/…/)` kullanma; senkron CPU
  zaman aşımıyla kesilemez; çapa `indexOf` −1 pinle; mutasyon `assert count==1`.
- Ret edilenler: ETag testi (hedef yok) · HTTP/2 parser testi · kanonik-posta-kutusu kayıt limiti ·
  `emailCanonical` kolonu · escalation claim'inin model yolunda geri alınması (regresyon çıktı) ·
  gölge pilotta teslimat takibi/per-org kota · supply türetmenin import TX'ine alınması.

**Kimlik / oturum**
- 🚨 **BÜRÜNME = SALT-OKUNUR DESTEK GÖRÜNÜMÜ (K8, kurucu kararı 09-28, `auth/impersonation.ts`):** operatör müşteri hesabına
  girdiğinde YALNIZ görür — müşteri hesabında HİÇBİR yazma (ödeme / abonelik / misafire mesaj / bilgi tabanı dahil): sarmalı uçlar
  `withAuth` TEK boğazında, sarmalayıcısız müşteri uçları kendi `impersonationReadOnly` kontrolüyle; tüm misafir verisini dışa
  aktarma ve kanal bağlama (OAuth GET) kapalı; sayfa açılışı da yazmaz. Bürünme en çok 2 SAAT (`impersonatedAt` imzalı iddia,
  doğrulama beyaz listesinde; damgasız eski belirteç DOLMUŞ sayılır → API 401, sayfa / ara katman çıkışa); müşteriden müşteriye
  geçişte İLK başlangıç korunur; başlangıç kaydı ZORUNLU ve çerezden ÖNCE (yazılamazsa bürünme başlamaz). Çıkış rotası da süre kapısından GEÇER
  (atlamak çalınmış süresi dolmuş belirteci taze operatör oturumuna çevirirdi); süresi dolunca kabuk 401'i görüp oturumu kapatır (09-28). Mekanik pin
  `impersonation-read-only-pin.test.ts`: YENİ yazma ucu ya sarmalı ya kontrollü ya da listede gerekçeli satır.
  🚨 09-30 (kurucu kararı): bürünmüş operatör misafir QR sohbetini AÇAMAZ / konaklamayı cihazına BAĞLAYAMAZ (GET / POST / PIN + sayfa;
  `lib/guest-chat-support-view.ts`, imzası doğrulanmış çerezden); mülk sayfası destek görünümünde bağlantıyı / karekodu yazmaz; inceleme
  "QR Misafir Sohbetleri" sayfasından. Operatör DIŞA AKTARIMI yalnız kendi hesabından (bürünmede 403) + 2FA + AMAÇ (kapalı küme
  `lib/operator-export.ts`) + isteğe bağlı talep no + ZORUNLU kayıt İNDİRMEDEN ÖNCE (`writeAuditInTx`; yazılamazsa 503, veri çıkmaz);
  ev sahibine anlık bildirim / panelde erişim geçmişi YOK (kurucu kararı), destek erişimi hizmet metninde açıklanacak (avukat).
- 🚨 **OTURUM ÇEREZİ `__Host-guestops_session` (09-23 ikinci tur, kurucu onayı):** üretimde yeni adla yazılır;
  okuma `readSessionCookie` (önce yeni ad, 2026-10-15'e kadar eski ad); middleware + `setSessionCookie` eski çerezi
  siler; çıkış İKİ adı temizler; geliştirmede YALNIZ eski ad okunur/yazılır. 🚨 Oturum çerezini doğrudan
  `SESSION_COOKIE` adıyla OKUMA/YAZMA — `readSessionCookie` / `sessionCookieName`. 🚨 **FIRLATMA KAPISI:** bu
  sürümden itibaren `signSession` her oturuma `hv` iddiası yazar; eski ad YALNIZ `hv`siz (yayından önce eski kodun
  imzaladığı) oturumu taşıyabilir — yoksa yeniden adlandırılıp fırlatılan oturum middleware'de `__Host-`e yükseltilip
  kalıcılaşıyordu. `hv`i kaldırma/koşula bağlama. 2026-10-15 SONRASI eski adın okuma kodu silinebilir.
- **Epoch artıran kimlik işlemi BU CİHAZI yeniden imzalar:** 2FA AÇMA ve şifre DEĞİŞTİRME `sessionEpoch`i artırır
  (başka her oturum düşer) ve işlemi yapan cihazın çerezini yeni epoch ile yeniden imzalar + tanınan-cihaz
  çerezini yeniler (asla ölümcül değil). Şifre SIFIRLAMA oturum açmaz ama tamamlayan tarayıcıyı tanınan cihaz
  yapar (saldırı altında dolu hesap kovasından çıkış yolu). `mfa` iddiası bu işlemlerde YÜKSELTİLMEZ. 🚨 Yeni epoch
  **İŞLEMİN İÇİNDEN** okunur (işlem sonrası okuma araya giren başka bir artışı alıyordu).
- **Parola biçimi (③):** saklama NFC; doğrulama NFC → (girdi NFC değilse) ham; sahte yol aynı sayıda karşılaştırma.
  Yeni parola en fazla 72 BAYT (tek kaynak `password-policy.ts`, bcrypt'siz). Giriş yolu sınır uygulamaz.
  Eski maliyet-10 / ham biçim hash TAM başarılı girişte yükseltilir (`password-upgrade.ts`: CAS, kuyruksuz,
  epoch'a dokunmaz). 🚨 Maliyeti düşük hash'te BAŞARISIZ doğrulama sahte yolun **İŞİNE** tamamlanır: AYNI YUVADA
  maliyet 10 + 11 sahte karşılaştırma = tam bir maliyet-12 (ölçüldü: 318↔319 ms, eşzamanlıda 1,95↔1,90 sn).
  **UYKUYA GERİ DÖNME** — ilk sürüm yuvayı bırakıp ortalamaya kadar uyuyordu; eşzamanlı isteklerde sızdı (inceleme).
- **Hız sınırı kovası `rateLimitClientKey(req)`** (IPv6 → /64, IPv4-eşlemeli → IPv4). `clientIp` yalnız iz/onay
  kayıtları için (tam adres). Ham IP'den kova kurmak mekanik pinle YASAK. 🚨 **Halka açık takvim beslemesi**
  ağ başına geniş taşma kapısı (600/dk) + takvim BAŞINA 60/dk: Airbnb/Booking/Google sunucuları aynı /64'ten çok
  takvim çeker; tek kova 429 → bayat takvim → çift rezervasyon riski demekti. Yeni halka açık "sunucu çeker" ucu
  eklerken aynı soru sorulur. Ek /48 kovası REDDEDİLDİ (mobil operatör havuzları → toplu kilitleme riski).
- 🚨 **OTURUM İÇİ YENİDEN DOĞRULAMA GÜNDE 20 HATA — TEK ORTAK SAYAÇ** (`auth/reauth-guard.ts`,
  `reauth-fail-day:`): 2FA kurulumu (ŞİFRE) + 2FA kapatma/açma/kurtarma kodu (KOD) + hesap silme (ŞİFRE) aynı
  sayaca yazar; tavan dolunca DOĞRU şifre/kod da o gün reddedilir (yoksa tavan yalnız yavaşlatır). Girişin
  sayacından AYRI anahtar. Eskiden kurulum günde 1.440, silme 480 şifre tahmini bırakıyordu. Oturum varken
  şifre/kod soran YENİ bir ekran eklenirse aynı iki çağrıyı yapar (`reauthBlocked` önce, `noteReauthFailure`
  hatada). Sır/kurtarma kodu yanıtları `noStore`.
- **Giriş sonrası `?next=` API yolu olamaz** (`safe-redirect.ts`); çözülemeyen (bozuk yüzde kodlu) hedef de
  olamaz. Host izin listesi yalnız TAM `localhost`/`127.0.0.1` (+port).
- 🚨 **PAROLA ASLA KIRPILMAZ (09-23):** kayıt/giriş parolayı olduğu gibi alır; değiştirme ve sıfırlama da
  öyle (eskiden kırpıyordu → boşluklu parola sıfırlamadan sonra girişte kilitliyordu). Kod/token kırpılır.
- 🚨 **bcrypt EŞZAMANLILIK KAPISI (`auth/password.ts`):** bcryptjs saf JS — ölçüldü: 8 eşzamanlı karşılaştırma
  olay döngüsünü ~800 ms dondurur. Aynı anda en fazla 2 iş (env `PASSWORD_HASH_MAX_IN_FLIGHT`), 32'lik kuyruk,
  8 sn; taşarsa `PasswordHashBusyError` → `serverError` 503 (alarm YOK). Doğrulama/hash/SAHTE doğrulama AYNI
  kapıdan geçer (numaralandırma kâhini doğmaz). bcrypt'i kapı dışında çağırma.
- **Doğrulama e-postası ve DENEME (trial) e-postaları kişiselleştirilmez** (kayıtta yazılan ad = saldırganın
  metni; başkasının adresiyle kayıt olan onu o kişinin kutusuna taşırdı → içerik enjeksiyonu); yeniden gönderme günlük tavanı 6/adres. **Kimlik rotalarında JSON kontrolü IP kovasından ÖNCE**
  (login/register/forgot/resend; 415).
- **Süper-admin e-postası JWT iddiasından okunur** — bugün `User.email`i değiştiren HİÇBİR yol yok (ölçüldü).
  🚨 **E-posta değiştirme özelliği eklenirse** `requireSession`/`requireAuth` e-postayı DB'den okumalı (ön koşul).
- 🚨 **ROL DEĞİŞTİREN / PERSONEL DAVET EDEN akış eklenirse `sessionEpoch` ARTIRILIR (ön koşul, #211):** ara katmanın personel
  yönlendirmesi JWT rolünü okur, kayan oturum rolü aynen yeniden imzalar (tazelemez) ve (app) sayfalarının çoğu rolü kendisi
  kontrol etmez (yalnız API rolü DB'den okur) → yetkisi düşürülen yönetici gelen kutusunu görmeye devam ederdi. Bugün rolü
  değiştiren yol YOK (personel yalnız seed/demo).
- 2FA aktifliğinin tek koşulu `twoFactorEnabledAt`; bayat secret arıza değil → `/admin` "2FA'yı sıfırla"
  (bayat dalda epoch artmaz). Operatör müşteri hesabında 2FA kuramaz. Sıfırlama kaydı AYNI işlemde ve ZORUNLU (`writeAuditInTx`, 10-01
  A02 F3 — yazılamazsa sıfırlama olmaz).
- Operatör yetkisi = allowlist + `mfa === true` (`isSuperAdmin`, tek boğaz noktası). `login` `mfa`yı
  2FA'dan yazar; `verify-email` `mfa:false`; impersonation iddiayı taşır. Sayfa yolu `requireAuth`: DB
  arızasında rol staff + `mfa=false`; impersonation çıkar; normal oturum fail-open. 10-01 gece (A02): operatör
  e-postası yalnız OPERATÖR kimliğiyle (`actorUserId` varken `actorEmail`) sayılır — operatör listesindeki adres müşteri hesabı olarak
  AÇILAMAZ (`isSuperAdminEmail`, büyük harf / boşluk katlanır); operatör dışa aktarımı `Sec-Fetch-Site` same-origin / none ister (başka
  siteden 403, kayıt yazılmaz); destek görünümünde mülk sayfası takvim besleme bağlantısını yazmaz. Test DB koruması `?host=` /
  `?hostaddr=` parametresini ana makine sayar (yerel sanılan uzak veritabanı reddedilir).
- "Beni hatırla" (trusted-device) iki epoch'a bağlı (2FA + `sessionEpoch`); şifre değişimi/sıfırlama ve 2FA
  sıfırlama güveni düşürür; legacy çerez fail-closed. **Çıkış güven çerezini SİLMEZ** (kullanıcı kararı
  09-07; 08-09 sertleştirmesi geri alındı — cihaz güveni çıkışı aşar, kutuyu ortak bilgisayarda
  işaretlememek kullanıcının seçimi). Kutu işaretsizse her giriş kod ister = normal 2FA. Sıradan logout
  epoch bump'lamaz (S1; "her çıkışta tüm cihazlar düşsün" per-session `jti` ister = migration).
- E-posta doğrulama: token fragment'te (`#t=`) + `POST` + PAROLA şart (ön-ele-geçirme kapandı); GET'i geri
  getirme. "Zaten hesabın var" maili ayrı `kind`; enumeration korumaları korunur (`SEND_FAILED_503` ortak).
- Şifre sıfırlama m47 challenge modeli: bütçe challenge satırına ait, token fragment'te, `middleware.ts`
  iki liste (`AUTH_PATHS` / `SIGNED_IN_REDIRECT_PATHS`). Faz 3 bitti (eski kod yolu kalktı); Faz 4 (kolon
  drop) SÜRESİZ ERTELENDİ — `pwResetCodeAttempts: 0` yazması zamanlama paritesidir, SİLME. Zamanlama
  paritesi tek bcrypt (`dummyVerifyPassword`); `hashPassword` ile parite YAZMA. Açık UX: bağlantısız
  kod girişi çıkmaz (formda düzelt, rotada DEĞİL).
- `readJsonCapped` `Content-Type: application/json` ister (öz karşılaştırma; virgül ham değerde).
- Login: hesap kovası doluyken doğru parolayla da YALNIZ tanınan cihaz girer (09-23; bilinmeyen tarayıcı 429, sahibin yeni
  cihazı saldırı boyunca bekler — çıkış şifre sıfırlama); 2FA hesap-başına günlük 20 hata tavanı var.
- `GET /logout` CSRF'i, per-session `jti`, halka açık sayfada çerez yenileme → açık tasarım kararları.

**Tenant / rotalar**
- **Uyarı adresi (09-30, bayrak `ALERT_EMAIL_VERIFY_ENABLED` KAPALI → bugünkü "yalnız ekip üyesi" kuralı):** ekip dışı adres YALNIZ o
  adresin sahibi onaylarsa kaydedilir — imzalı belirteç (`AUTH_SECRET`, alan ayrımlı, 24 saat, istek anındaki eski adrese BAĞLI → CAS),
  parçada (`#t=`), onay AÇIK tıklama + POST (`/api/alert-email/verify`; JSON kontrolü IP kovasından önce), e-posta kişiselleştirilmez,
  günlük tavan org 5 / alıcı 3, denetim kaydına adres DEĞERİ girmez. İlk gerçek deneme kurucuyla. 🚨 10-01 (15 ajan A13 F2): CAS tek başına
  yetmiyordu (adres belirtecin eski değerine dönünce bağlantı yeniden geçiyordu) → belirteç işletmenin uyarı adresi KUŞAĞINI taşır
  (`alert-email-generation.ts`, `SystemLock` sayacı, migration yok): her yeni istek ve her doğrudan adres değişikliği kuşağı ARTIRIR, onay
  TÜKETİR (tek kullanım, yalnız en son istek). `Organization.updatedAt` KULLANILMAZ (OAuth yenilemesi / üslup profili satırı arka planda günceller).
- `api-route-scoping.test.ts`: her rota org-kapsamlı ya da gerekçeli public listesinde; `admin/*`
  hepsi superadmin kapılı (`admin-superadmin-gate.test.ts` davranışsal); `REQUEST_DERIVED_ORG_ID` listesi.
- **Anonim rotalarda da JSON kontrolü IP kovasından ÖNCE (#211, 09-27):** leads · demo/ai · chat POST · csp-report (üç MIME'ı);
  yalnız BAŞLIK bakılır, geçersiz JSON gövde kovayı YİNE tüketir. Yeni kimliksiz POST rotası aynı sırayla yazılır.
- **QR sayfası + GET `resolveGuestChat(…, { knowledgeBase: false })` (#211):** bilgi tabanını KULLANMAYAN yol onu çekmez / taramaz
  (sayfa hız sınırsız, GET 5 sn'de bir). Cevap üreten POST tam çözümler (bağlantı pinli).
- **Kiracılar arası davranışsal test reddin SEBEBİNİ sınar (#211):** 404/403; "2xx değil" YETMEZ (boş hedef listesinin 400'ü, sahte
  modelin 500'ü kapsam silinse de geçiriyordu — mutasyonla doğrulandı).
- **Rol kapısı pini (#211, `api-route-role-gate.test.ts`):** personelin erişebildiği uçlar (`withAuth`, her birinin personeli KENDİ
  görevine daraltan satırıyla), yalnız-sahip uçları ve sarmalayıcısız uçlar (kapı ifadesiyle) KAPALI LİSTE; işleyici BAŞINA, sözdizim
  ağacıyla, yorumsuz. Yeni uç ya da rol değişikliği = listede bilinçli satır.
- `cron/sync` · `cron/email-outbox` · `leads` davranışsal pinli (`timingSafeEqual` yapısal pin dahil).
- Hız limiti: `pickClientHop` sağdan `TRUSTED_PROXY_HOPS` (Railway 2); az tahmin güvenli, fazla tehlikeli;
  aralık dışı → 1; boot uyarır, durdurmaz. `clientIp` delil kayıtlarında da kullanılır (geçmiş satır
  düzeltilmez). Bütçe doğrulamadan SONRA tüketilir (import/backfill/diagnostics/AI kotası); `leads`
  istisna (anonim). 429 metni süreyi söyler.
- Ayar değişikliği audit'li (alan adları, değerler değil). `properties/[id]` DELETE ve `admin/leads` PATCH
  audit'siz (açık).
- **API yanıtında gizli / iç alan yok:** mülk `stripPropertySecrets` (icalToken, chatToken), rezervasyon `stripReservationInternals`
  (QR PIN / cihaz bağlama özeti + kilit durumu, 09-28). `select`siz satır döndüren YENİ uç aynı ayıklamayı yapar.
- Yükleme: private mimari (imzalı GET, `orgIdFromKey` 404, sihirli bayt, SVG/HTML yok); prod'da yerel
  diske düşüş 503 (`ALLOW_LEGACY_LOCAL_UPLOADS=1` kaçış). Bucket sağlayıcı görünürlüğü operatör adımı.
  `photoUrl` yalnız göreli. 🚨 Sunum YALNIZ bu org'da bir TaskUpdate'in HÂLÂ gösterdiği nesneyi imzalar (F11, 09-26); personel
  yalnız ŞU AN kendisine atanmış görevin fotoğrafını açar (K2, 09-30 — görev erişimiyle aynı kural);
  görev VE mülk silme VE rezervasyon iptalinin görev silmesi fotoğrafların silme niyetini aynı işlemde yazar
  (`enqueueUnreferencedPhotoDeletions`: silmeden SONRA, yalnız bu org'da artık hiçbir TaskUpdate'in göstermediği nesne — eski satırlar aynı
  nesneyi başka görevde gösterebilir, 09-30). Kuyruk vadesi UYGULAMA saatiyle. Nesneleri yetim bırakan YENİ bir silme yolu aynısını yapar.
  AÇIK: PATCH düşerse/eşzamanlı silmede sahipsiz nesne uzlaştırması.
- CSP: enforce'ta `form-action 'self'`, `script-src` enforce EDİLMEZ; report-only'ye `report-uri`
  (`/api/csp-report`: 8KB, 3 MIME, 30/saat/IP, allowlist alanlar, ham rapor saklanmaz, `reportError` YOK,
  daima 204). Enforce sırası: ≥2 hafta ölç → nonce turu → report-only doğrula → enforce. 🚨 Rapor alanları loga
  yalnız `lib/csp-report-fields.ts`ten (F09, 09-26): URL → origin + ROTA ŞABLONU (`/c/:token`, `/inbox/:id`),
  directive/disposition/kaynak anahtar kelimesi/şema KAPALI KÜME, URL olmayan → `invalid`, satır merkezî
  redaksiyondan geçer. Yeni halka açık "bağlantıyı bilen girer" rotası `BEARER_PARENTS`a da eklenir.
- iCal SSRF: pinned DNS, redirect yok (3xx hata), private/link-local/IPv6 multicast blok, yalnız 443
  (`url.port` boş olmalı; `!== "443"` ölü kod), userinfo red, 10MB cap, toplam deadline. HTTPS zorunlu.
- Landing iframe'leri Google Fonts çekmez (self-hosted woff2, latin+latin-ext ikisi de şart); CSP
  karşılaması geri EKLENMEZ.
- `/_next/image` kapalı (`images.unoptimized`); `next/image` kullanılırsa önce `sharp` kontrol.

**Veri yaşam döngüsü / KVKK**
- Scrub kapsamı kuralı: misafir metni/adı taşıyan her kolon `anonymizeOldGuestData` VE `maskReservationRows`
  ikisine bağlanır (`scrub-scope-parity.test.ts` dosya düzeyinde; DAL düzeyi kör → dal pinleri ayrı).
- Erasure tombstone guard'ları HER ingress'te: hospitable-sync · iCal · elle `.ics/.csv` · QR
  (`resolveGuestChat`). Yeni sağlayıcı = beşinci ingress, kapı şart. `blocksGuestStay` yalnız sync'te.
- Retention: süre-bazlı rejim ≠ açık silme rejimi; scrubbed satıra PII geri yazılmaz; cutoff'tan eski
  mesaj re-import edilmez. `RETENTION_MESSAGE_AGE_ANCHOR` bayrağı: mesaj yaşı + yeniden-temizlenebilirlik
  bacakları; kapalı davranış birebir eski; açmadan önce onay paketi + taze `pg_dump`; smoke'ta "artık
  korunacak" sayısı düşerse DUR.
- 🚨 **MİSAFİR HİTAP ADI + ADIN KÖKENİ (migration 57, kurucu onayı 09-28, `lib/guest-name-source.ts`):** `Reservation.guestGivenName`
  YALNIZ kanalın AYRI ad alanından (Hospitable `guest.first_name`); tam ad BÖLÜNMEZ, geriye dönük doldurma YOK (eski satırlar NULL).
  `guestNameSource` kapalı küme `channel · placeholder · calendar · file · host` — köken etiketidir, "güvenilir" DEĞİL. İkisi de OLAY
  değil (yalnız onlar değişince `reservation.updated` yok, alan listesine girmez); anonim satıra hitap adı geri yazılmaz. KVKK: iki
  süpürge hitap adını null yapar + giden gövdelerden ayıklar (tam adın ilk sözcüğünden uzun olabilir: "Mehmet Ali"); bayrak açık
  bacak; dışa aktarımda. Adı yazan YENİ yol kökeni de yazar. Yedek + prova kanıtı `docs/TASARIM-2026-09-28-misafir-adi.md` §5.
- 🚨 **ADSIZ YAPAY ZEKÂ + KODLA SELAM ("D", kurucu onayı 09-28; anahtar `AI_CODE_GREETING_ENABLED` VARSAYILAN KAPALI, `ai/code-greeting.ts`):**
  açıkken model misafirin adını HİÇ görmez — istem rezervasyon satırı yok, bilgi tabanı `{isim}` → "misafirimiz" (`modelGuestFirstName`),
  🚨 geçmiş + güncel mesaj + getirme / gömme / anlama / bekçi / sıralayıcı sorgularında ad YALNIZ KİMLİK KONUMUNDA "[Misafir]" (kurucu
  kararı 09-30, tek kaynak `ai/guest-identity-mask.ts`): tam ad iki DOĞAL sırada her yerde (ad önde ↔ soyad önde; ad bloğu sırasını korur, tam ters sıra değil); tek sözcük yalnız misafir metninde "adım / ismim /
  ben / I'm / my name is / this is / call me / Alex here / Name: / Ad:" + imza, BİZİM metnimizde yalnız hitap ("Merhaba X," / "X Hanım");
  kimlik konumundaki adın ardındaki ≤2 ad sözcüğü de. ANLAMLI SÖZCÜK SİLİNMEZ ("Deniz manzarası", "15 Nisan", "Dairede yangın var") — TAM
  GİZLİLİK İDDİASI YOK. Yazar geçmiş satırının yönünden (misafir / bizim). Yer tutucu / anonim ad anahtar olmaz; kimlik konumundaki maske bir
  acil sözcüğünü gizlerse `nameMaskHidesEmergency` KOD NOTU ("Ben Yangın, …"). `reservation:guestName` kaynağı doğrulanmaz; model selam YAZMAZ (türetilmiş istem: ÇAPALI
  değişiklik, çapa bulunamazsa açılış çökmez, pin eksik listesinin boş olduğunu ister); selamı KOD ekler — YALNIZ ilk cevapta, dil kodun
  kesin tespiti ya da modelin beyanı (7 dil tablosu, yoksa selamsız), hitap adı YALNIZ `guestGivenName` (yoksa "Merhaba,"; ilk kelime
  tahmini YOK), kısa tonda yok, resmî tonda da "Merhaba Ayşe,"; modelin baştaki selamı silinir — YALNIZ selam sözcüğü + KAPALI hitap
  listesi ("misafirimiz", "there", "[Misafir]"…); listede olmayan sözcükle selamlaşma ("Hi Michael,") ya da içerik ("Günaydın
  Steakhouse,") dokunulmaz ve kod selamı EKLENMEZ (09-28: eski kalıp restoranın adını siliyordu); yalnız-selam cevaba ikinci selam yok;
  geçmişteki kendi mesajımızın ilk satırı kodun selam satırıysa istemden çıkar (kısa ad "Su" silme anahtarı olamıyordu). Kapı SON metni görür. Kapalıyken istem
  bayt bayt aynı (pinli). Kanıt: tam akış kanaryası (`code-greeting-canary-flow.test.ts`: cevap + anlama + bekçi + gömme + sıralayıcı,
  ikinci tur dahil). Açma = ücretli cevap kıyası (önce 20 satırlık deneme, gerçek tutar ondan) + kurucu onayı.
- **Kalite denetçisi (Claude = ikinci işleyen) girdisinde sır DEĞERLERİ maskelenir (#211):** `maskSecretValuesForAudit` (7 dil
  etiket + tuş takımı biçimi; saat/ücret korunur). 09-28: kapı / kasa / anahtar kutusu / keybox / Schlüssel / tuş takımı / Wi-Fi etiketleri,
  etiketten ÖNCE yazılan değer, "pass" yalnız çıplak / bileşik (passenger değil); "3pm", "11 am", saat aralığı, "450 TL", "30€" korunur. `redactSensitive` GENİŞLETİLMEZ (anlam katmanına giden metni değiştirirdi).
- **Ad silme `redactNameFromBody` Türkçe harf aileleriyle eşleşir (09-28):** iIıİ / sSşŞ / cCçÇ / gGğĞ / oOöÖ / uUüÜ tek sınıf, sözcük arası boşluk
  esnek ("ISMAIL" / "AYŞE YILMAZ" / "Ayse Yilmaz" / "Mehmet  Ali"); ad yoksa metin bayt bayt aynı. Kanalın AYRI hitap adı (`guestGivenName`)
  ad listesi olan HER maskelemeye girer (denetçi, gölge, üslup, QR, eval dışa aktarma).
- Redaksiyon yapısal (`lib/redact.ts` — YAPRAK modül, hiçbir şey import etmez; `report-error-core` yeniden dışa
  verir): JSON ağacı gezilir, izin listesi deny'den önce, kv regex kalır, işlenemeyen aday
  `[REDACTED_UNPARSEABLE_JSON]`, oversized/budget koşulsuz sabit, `\uXXXX` çözülür. 🚨 **Sunucuda ham hata `console.*`a
  VERİLMEZ (F10, 09-26):** alarmsız log satırı `formatErrorForLog(err)` (ad: ileti + cause, redakte, yığın yok), alarm
  `reportError`; e-posta istemcisi ve `instrumentation.ts` de aynı yaprak modülü kullanır (eski dar kopyalar kalktı).
  Mekanik pin TypeScript sözdizim ağacı (`log-sink-redaction-pin.test.ts`); önce değişkene kopyalanan hata ona
  görünmez → yeni bir log yazıcısı davranışsal teste de girer (`log-sink-redaction.test.ts`). 🚨 PRİSMA HATA METNİ VERİ TAŞIR (09-30,
  inceleme b5): argüman ağacı / "Failing row contains" → Prisma hatası log'a, Sentry'ye ve alarm e-postasına YALNIZ yapısal özetle
  (`prismaErrorSummary`: ad · kod · model.işlem · kısıt alanı · pg kodu + yığın çerçeveleri); üretim istemcisi hatayı OLAY olarak alır
  (`db.ts`, `prismaLogEventSummary`) — Prisma'nın kendi kaydedicisi (`log: ["error"]`) kullanılmaz (iletinin tamamını basıyordu).
  🚨 Hata SARMALANIRKEN ham `err.message` ile yeni `Error` KURULMAZ (10-01 gece, A12: senkron özetleri ve satır sarmalayıcıları argüman
  ağacını / misafir adını taşıyordu) → `errorWithContext(err, " (row …)")` (yaprak `redact.ts`; önce `formatErrorForLog`).
- Hesap silme Invoice/Consent/AuditLog'u da siler (migration ister, açık). `Organization.plan` kolonu ölü.
- Takvim feed URL'i at-rest şifreli (`urlEnc`+AAD), prod'da düz URL yok; doğrulama yalnız `--post-contract`.

**Mesajlaşma / outbox / sync**
- 🚨 **SAĞLAYICI HATASI SARMALA KÖR OKUNMAZ (09-23 olayı):** `err instanceof HospitableError` /
  `err.name === "HospitableError"` YASAK (izinli beş dosya: istemci, adaptör sarmalı, `provider-errors`,
  adaptörsüz iki bağlantı rotası — pin `provider-error-wrapper-pin.test.ts`). Okuma TEK yerden:
  `providerErrorStatus` / `isChannelSubscriptionInactive` (`@/lib/provider-errors`). **ÖRDEK TİPLEMESİ YOK**
  (OpenAI SDK hatası da `status: 402` taşır = kota; "Hospitable aboneliği" DEĞİL). Ingest sözlüğünde 402 =
  **`blocked`** (giden yönle AYNI sözcük; eskiden `unknown`). Yeni sarmal/adaptör eklerken: çağıranın özel
  dalları (402 sus · 401 revoke · 429 bekle) sarmaldan SONRA da eşleşiyor mu — davranışsal test şart.
- 🚨 **PERİYODİK İŞİN ALARMI GEÇİŞ TABANLIDIR (09-23, `src/lib/alert-state.ts`, migration YOK):** 2 dk'lık
  döngüde `reportError`ı DOĞRUDAN çağırmak kalıcı arızada günde ~130 e-posta demektir (kısıt bellek-içi, context
  başına 10 dk, yeniden başlatmada sıfırlanır). Yeni periyodik aşama `alertTracker(prefix)` kullanır: `fail(key,
  context, err)` ilk arıza / SINIF değişiminde bir kez + 24 sa hatırlatma; `ok(key)` başarıda temizler (yalnız
  AKTİF anahtara sorgu atar — sağlıklı yol geçiş başına 1 okuma, sayaçla pinli). Anahtar AŞAMA başınadır (bir
  aşamanın başarısı ötekinin alarmını silmesin); e-posta KONUSU değişmez. Hata sınıfı mesaj METNİ taşımaz.
  E-posta gitmediyse ya da KISITA takıldıysa 15 dk sonra yeniden dener; DB düşerse susmaz (eski yol).
  Bilinen sınır: hızlı dalgalanan arıza hâlâ yalnız 10 dk kısıtıyla sınırlı (histerezis ayrı iş).
- **Kimlik e-postası kurtarması HER geçişte** (`recoverEmailOutbox`), silme saatlik (`purgeEmailOutbox`):
  15 sn'lik poller yalnız drain eder; kurtarma saatlik kalırsa deploy ortasında düşen sıfırlama kodu hiç ulaşmaz.
- **Channel Layer (V0.1–V0.2, `src/lib/channels`):** giden-mesaj çekirdeği (`messaging.ts`, `outbox/worker.ts`)
  `@/lib/hospitable` istemcisini import ETMEZ, yalnız `@/lib/channels`; `sendMessage(` src/ içinde TEK yerde =
  `channels/hospitable-outbound.ts` (pin `core-channel-independence.test.ts`). `qr-chat:` iç-thread kuralı
  tek kaynak `resolveOutboundRoute` (`INTERNAL_THREAD_PREFIX`). Sağlayıcı seçimi bugün orada açıkça
  `"hospitable"` (V0.3'te connection karar verir). Adaptör `kind`i HTTP durumundan tipler;
  `classifySendResult` `kind`i metin regex'inden ÖNCE alır (parite pinli). Kimlik bilgisi `undefined`
  olduğu gibi iletilir (istemci env fallback'i, kurucu legacy yolu); **token YOK ve env YOK ise adaptör
  ağa çıkmadan `definitive_failure`** (V0.2 uyum kiti bulgusu). `dispatchOutbound` fırlatmaz (adaptör yok /
  yetenek yok / kimlik↔sağlayıcı uyuşmazlığı → definitive). Ortak fake `tests/helpers/fake-channel.ts`
  (dedupe YOK, sahipsiz rezervasyon 404, timeout=teslim-olabilir) + kit `tests/helpers/outbound-conformance.ts`
  — **yeni adaptör aynı kiti geçmek zorunda**; fake'in varsayımları gerçek adaptörle (fetch stub) pinli.
- **Provenance (V0.4, migration 50 — CANLI 09-07 19:29Z, kanıt envanter §11):** `Reservation/Conversation/Message.connectionId` = KANITLANMIŞ bağlantı — yalnız ingest anında
  ya da NULL iken bir senkron satırı o bağlantıdan gerçekten gözlemleyince (NULL→X) yazılır; ASLA X→Y / X→NULL;
  **çıkarım backfill'i YOK**, "mevcut bağlantıyı aktar" tarihsel kanıt DEĞİL (pencere dışı legacy NULL kalır).
  `ingestedAt` = İLK ALINMA (yalnız create; update yolları dokunmaz; freshness DEĞİL — iCal `feedLastSeenAt`,
  thread `syncCursorAt`). `connectionEvidence` (ingest|observed|outbound) damganın NASIL yazıldığını taşır:
  env fallback ile alınıp sonradan gözlemlenen satır `observed` kalır, "ilk alınma bu bağlantıdan" iddiası
  ÇIKMAZ (iki kolon bunu taşıyamaz). iCal/QR/dosya/env fallback → `connectionId` NULL; elle giriş ve bizim
  çıktımız (AI/bot, doğrudan gönderim) → `ingestedAt` NULL. Sınıflar `channels/provenance.ts`
  (ingest/observed/outbound/unbound/legacy).
  Kolonlarda FK/index/default YOK. Dedupe: Conversation `connectionId single_non_null` (farklı dolu →
  `connection_conflict`, sessiz birleştirme yok), `ingestedAt keeper_wins` (zaman farkı ≠ çelişki, sayılır);
  Message `provenance_id` (→ `message_connection_conflict`, içerikten ayrı), `ingestedAt provenance` (kıyaslanmaz).
- **Messaging capability (V0.5 — CANLI, envanter §12):** "mesajlanabilir mi" TEK KAYNAK `channels/capability.ts`:
  `PROVIDER_MESSAGEABLE_RESERVATION_WHERE` (sourceReference dolu + calendarSourceId null + channel notIn [ics,
  manual]) ve `PROVIDER_THREAD_CONVERSATION_WHERE`/`isInternalThread`; automation.ts literal yazmaz (pin), gönderici
  ve önizleme aynı fragment'i yayar. Org düzeyi yetenek = kimlik çözümü (`getOrgHospitableToken`, env fallback dahil).
- **Ingest (V0.6, migration 51 — CANLI 09-08 03:13Z, envanter §12):**
  okuma yönü `channels/ingest.ts` sözleşmesi (canonical tipler, tipli `IngestError`, adaptör DEDUPE/SIRALAMA yapmaz);
  `@/lib/hospitable` okuma fonksiyonlarının src/ içindeki TEK çağıranı `channels/hospitable-ingest.ts` (+ sağlayıcı-adlı
  `api/hospitable/diagnostics`; pin). Yazma `ingest/write-service.ts` (`upsertCanonicalReservation`,
  `importCanonicalThread`; sağlayıcı tipi imzada YOK; polling ve gelecekteki webhook aynı servis). `IngestEvent` aynı
  TX'te, PII'SİZ (misafir metni/adı ve sağlayıcı kimliği taşımaz; kanarya dışı bilinçli). Değişmeyen senkron UPDATE
  yazmaz ve event üretmez. Fake `tests/helpers/fake-ingest.ts` + kit `tests/helpers/ingest-conformance.ts` — **yeni
  ingest adaptörü aynı kiti geçmek zorunda**; kit ≠ canlı doğrulama.
- **Bağlantı durumu + kimlik çözümü (V0.7 kod hazırlığı — CANLI 09-08, envanter §13):** `resolveHospitableCredential`
  TEK çözümleyici (`getOrgHospitableToken` sarmalayıcı): satır (anahtar açıksa) → org kolonları → env (kurucu).
  **Damgalı kuyruk satırı yalnız damgalandığı bağlantıdan gider** — bağlantı aktif değilse `connection_inactive`
  ile bekler, env'e SESSİZCE DÜŞMEZ; başka org'un satırı `connection_tenant_mismatch`. `getConnectionInfo`
  satırdan (yoksa kolondan), SAKLI veriden, sağlayıcıya çağrı YOK ("bağlantı var" ≠ "sağlıklı"); durumlar
  connected/env_fallback/disconnected/revoked/never_connected; kurucunun revoked bağlantısında env erişimi
  korunur (iki gerçek birlikte). Env fallback bir satır DEĞİL. Kolon DROP'u YOK; operatör planı ayrı belge.
- **ChannelConnection (V0.3, migration 49 — CANLI 09-07, kanıt envanter §10):** `(org, provider)` başına TEK satır, disconnect/reconnect AYNI satırı kullanır
  (kuyruk `connectionId` damgaları kopmaz); `generation` her kimlik-bilgisi yazımında artar = refresh CAS
  ikinci çapası (org blob + generation, ikisi de tek TX'te; biri 0 satır → gecikmiş refresh atılır).
  **Dual-write:** bağlan/kaldır/refresh/revoke org kolonları VE satır, aynı ciphertext (bir kez şifrelenir).
  **Okuma anahtarı `CHANNEL_CONNECTION_READ=1` DEFAULT KAPALI** (açıkken satır otorite; satırı olmayan org
  kolona düşer). **Backfill** idempotent, `scheduled-sync` her geçişte (ciphertext AYNEN kopya).
  **`auth_revoked`** (401/403): satır `pending`e park, deneme TÜKETİLMEZ; PAT ya da taze refresh'e rağmen
  401 → org CAS ile temizlenir + bağlantı `revoked` (`send_401/403`) + audit `channel.connection_revoked` +
  alarm; OAuth (10 dk içinde refresh yoksa) → süre şimdiye çekilir, sonraki okuma refresh eder, bağlantı
  aktif kalır. Worker: satırın `connectionId`si başka org'a aitse `connection_tenant_mismatch` (cancel/review).
  Sync yolu 401'de revoke ETMEZ (bilinçli; geçici arıza riski). Env fallback + `getConnectionInfo` kolon
  okuması V0.7'ye kadar kalır.
- Claim-then-send her yolda; claim TTL 120 sn; definitive (4xx≠408) → release+retry, ambiguous → claim
  tutulur (`delivery_unverified`, "iletilemedi" DEME); claim-store hatası 503; adopt-and-heal; çeviri
  fail-closed. Tek atış (`retries:0`); POST idempotent değil.
- Durable outbox (bayrak kapalı): kapalı state seti, `ERASABLE_STATUSES` tek kaynak; teslim etkisi üç
  parça (`markConversationDelivered` · `stampLifecycleSent` · `applyHandoffHold`) + healer; devir hold'u
  enqueue'de değil teslimde; 402 → `blocked`, sync başarısında bir kez `pending`. `autoReplyHoldUntil`
  KİLİTTİR, zamanlayıcı değil; `autoReplyAttemptedAt` konuşmanın `lastMessageAt`'inden alınır.
  🚨 **Vade kapısı TEK SAAT (`ENQUEUE_CLOCK`, CI #1170):** enqueue `availableAt`'i worker'ın kıyasladığı saatle YAZAR;
  şema varsayılanı (`@default(now())`) başka saattir ve timestamp(3)'e yuvarlanır → aynı milisaniyede satır "vadesi
  gelmedi" görünüyordu (rastgele kırmızı CI = atlanan yayın). JS saatiyle kıyaslanan YENİ zaman kolonu şema varsayılanına
  BIRAKILMAZ. E-posta kuyruğu da aynı kuralla (`nextAttemptAt`, kurucu onayı 09-25; `email-outbox-enqueue-clock.test.ts`). Satırı
  DOĞRUDAN yazan test fikstürü de vade kolonunu JS saatiyle verir (CI #1240: AAD testinin `pending` satırı şema varsayılanıyla
  kalmıştı → veritabanı saati birkaç ms ilerideyken "vadesi gelmedi", rastgele kırmızı).
- CLAIM-THEN-NOTIFY: atomik işaret + yan etki → yan etkinin SONUCU okunur; `emailService.send` bildirim
  yollarında KULLANILMAZ (`sendReporting`); `reportError` `throttled/configured:false` başarısızlık değil.
  E-posta KONUSU tek satır (`singleLineSubject`, gönderim çekirdeğinde; konuya misafir adı / mesajı girer, 09-28).
- Escalation üç yol (model · kelime alerts · `applyInboundMessageRules`); m48 triyaj ikinci model çağrısı
  YOK, temizleme yok, `null` yazılır (undefined değil), `isTriageStale` rozeti.
- **Rezervasyon durumu (#211):** açıkça olumsuz / soru değerleri ("not accepted", "not possible", "inquiry") onaylı DEĞİL; TANINMAYAN
  değerin varsayılanı hâlâ "confirmed" (karar `docs/SABAH-KARARLARI-2026-09-28.md` K7, bilinen sınır pinli).
- Yaşam-döngüsü sorguları `calendarSourceId: null` (kanal iCal işaretçisi DEĞİL); elle `.ics` `channel:"ics"`;
  CSV'de yalnız iptal ön eki eşlenir; negatif tutar ("-100", "(100)") sessizce pozitife çevrilmez, satır hatası (K1, 09-30). Elle oluşturma (`POST /api/reservations`) referans verilince kanalı "manual" yazar (09-28;
  elle girilen referans sağlayıcı kimliği DEĞİL — göndericiler onu POST ediyordu). Rezervasyon yazan YENİ yol aynı kuralı uygular. Bozuk feed: hataya geçişte tek alarm, ham URL/host alarma girmez,
  `BEGIN:VCALENDAR` yoksa `feed_not_icalendar`. "N kaynak işlendi" = o geçişte vadesi gelen (kohort).
- **iCal abonelik senkronunda kayıt kimliği (09-30, inceleme b1):** bir geçişte kayıt başına İLK satır (UID; UID'siz satırda tarih çifti) —
  tekrarlayan etkinliğin iptal edilmiş örneği (aynı UID) rezervasyonu her geçişte iptal ↔ onay arasında çalkalıyordu (dosyadan içe aktarmayla
  aynı kural). UID'siz etkinlik: aynı kaynağın aynı tarihli UID'siz satırı aynı kayıttır (her geçişte kopya açılıyordu). BEGIN/END:VEVENT
  büyük/küçük harf duyarsız, yalnız CR satır sonu okunur.
- 🚨 **EKSİK iCal OKUMASI HÜKÜM VERMEZ (F16, 09-26):** `parseIcsDetailed().incomplete` kapalı küme (yarım dosya ·
  10.000 tavanı · RRULE/RDATE/EXDATE/RECURRENCE-ID — tekrar AÇILMAZ, bilinçli · tarihi eksik/bozuk/ters/sıfır süreli ya
  da BEGIN/END'i bozuk etkinlik · aynı UID çelişen iki hâl). Eksikse okunanlar yazılır ve açık STATUS:CANCELLED işlenir,
  ama kaynak `partial` (satır hatası BASKIN → `error`), kayıp uzlaştırması kayıp SAYMAZ + tabanı ezmez (görülen satırın
  serisi sıfırlanır — şüpheli düşüşte de), müsaitlik motoru o kaynakla "boş" DEMEZ (`source_incomplete`), dosya önizlemesi
  not gösterir. `reconcileFeedDisappearance` `complete` alanı ZORUNLU. Neden metni tek kaynak `icsIncompleteCause`.
  🚨 (10-01 gece, A09) Etkinliğin İÇİNDEKİ alt bileşenin (VALARM / X-…) özellikleri etkinliğe YAZILMAZ (iç STATUS:CANCELLED rezervasyonu
  iptal ediyor, alarm SUMMARY misafir adı oluyordu); kapanmamış / başıboş alt bileşen = okunamayan etkinlik. Tarih YALNIZ RFC 5545 / ISO 8601
  ("2026" gibi gevşek değer → 1 yıllık konaklama); NUL okumadan önce silinir. CSV gün / ay sırası DOSYA başına (`fileDayOrder`; hücre başına
  tahmin 2 geceyi 61 gece okuyordu), karışık dosya sade hata.
- Sync motoru: fencing token + TTL 15 dk; heartbeat ilerleme-tetikli; `renewLock` geçici hata ≠ kayıp; 🚨 org sırası
  kimliğe göre SABİT + adil sıra imleci (F17, `scheduled-sync:resume-from`): bütçe yüzünden atlanan ilk org sonraki geçişte
  önce gelir (eski sırasız liste aynı son org'ları kalıcı aç bırakıyordu);
  `linkProperty` org-kapsamlı; 540 gün geri pencere kısaltılmaz; gövdesiz sağlayıcı mesajı sayacı
  (`messagesUnimportable`); `str()` trimlemez → `!body.trim()`.
- Provider mesajı sessiz atlanır ve imleç ilerler (bilinçli; ölçüm sayacı var).
- **Sağlayıcı dizesinden NUL silinir (09-28, `canonicalStr`):** PostgreSQL `text` NUL saklayamaz; NUL'lu ad / mesaj o rezervasyonun yazmasını
  HER senkronda düşürüyordu. Başka karaktere dokunulmaz.
- Günlük AI kotası oto-yanıtı da sayar; tavana çarpınca konuşma `new` kalır; kart "AI işlemi" der. Model cevap verip çıktı
  kullanılamadıysa (`llmUsage` dolu yedek: çıktı tavanı / bozuk JSON) o da SAYILIR ve aynı mesaj en çok `AI_UNUSABLE_MAX_ATTEMPTS`
  (3) kez denenir, sonra damgalanır (09-28; eskiden 2 dakikada bir sınırsız, faturalı); damgada sebep `ai_unusable` ("elle yanıtlayın"
  — `ai_unavailable`in "yeniden denenecek" metni yanlış olurdu). Modele HİÇ ulaşılamayan kesinti sınırsız yeniden denenir (damga yok)
  — iki durumu karıştıran yeni dal yazılmaz.
- Yeni org 7/24 açık doğar. 🚨 **09-12 GÜNCELLEME — bu satır "şema varsayılanı DEĞİŞMEDİ" diyordu ve
  ARTIK YANLIŞ:** migration 55 `autoReplyEndHour` varsayılanını **9 → 0** yaptı, yani 7/24 artık
  ŞEMANIN kendi varsayılanı. Eski hâlde koruma yalnız UYGULAMA katmanındaydı (`NEW_ORG_AUTO_REPLY_WINDOW`
  kayıt rotalarında) ve org yaratan üçüncü bir yol (seed, davet, fikstür) eklendiği an sessizce gece-only
  bir org doğuruyordu; ayrıca düzeltmeden ÖNCE kurulmuş org'lara (kurucu org dâhil) hiç uygulanmamıştı.
  Sabit hâlâ duruyor ve niyeti belgeliyor. Kurucu muafiyeti `limitsForOrg`.
- Plan sınırları POST/PATCH/COPY hepsinde; yalnız büyüme reddedilir; fail-open (kullanım kapısı).
- Şablon yer tutucu ikamesi TEK GEÇİŞ (`replace` + callback); sıralı split/join ASLA.

**Faturalandırma**
- Kayıtlı abonelikten FARKLI aboneliğin olayı planı değiştirmez (K4, 09-30: ters sırada gelen eski iptal yeni aboneliği ezmiyordu).
  Şart UPDATE'in WHERE'inde (10-01, Codex: bayat okuma yarışı; ilk kayıt çatışması P2002 dalında da) — yalnız aktifleşen yeni abonelik
  eskisinin yerine geçer.
- **Bağlanamayan ödeme sessiz kalmaz (10-01, 15 ajan A10 F1):** imzası doğru ÖDEMELİ olay (abonelik active / trialing / past_due,
  `transaction.completed / paid`) hiçbir işletmeye bağlanamazsa operatöre geçiş tabanlı alarm (`paddle-webhook:unlinked:<Paddle kimliği>`;
  yalnız Paddle kimlikleri, müşteri verisi yok); bağlama kararı ve olay durumu AYNEN ("bağlanamadı" durumu + operatör bağlama yolu Sabah 41a).
  Belirsiz (202) / reddedilen (502) plan değişikliği `billing.plan_change_pending` / `…_rejected` kaydı yazar (A10 F6).
- previewToken HMAC + `jti` tek kullanım; apply öncesi re-preview (409 amountChanged); definitive/ambiguous
  Paddle hataları; pending kilidi; `resolveOrgId` providerRef-first; **`CheckoutConsent`e consumedAt EKLEME**;
  `occurred_at` vetosu; portal plan DEĞİŞTİRMEZ (in-app upgrade/downgrade canlı doğrulandı); `canceled`
  plan değiştiremez (`BILLING_ALLOW_CANCELED_PLAN_CHANGE=1` kaçış); geçersiz imza alarm; hızlı dal audit.
- Yıllık = aynı plan kodu (ayrı "pro_yillik" YOK); `annualAvailable` = 3 env; başlık aylık, alt satır
  yıllık tutar (zorunlu); üstü çizili fiyat YOK; yıllıkta plan değiştirme kapalı. Katalog dışı `priceId`
  reddedilir (katalog yapılandırılmışsa). Açık ticari: `paused` grace; reconcile'da plan otoritesi.

**Kanal sözleşmesi / müsaitlik / demo (09-24)**
- **Sağlayıcı kimliği ≠ OTA etiketi:** `ChannelProviderId` (`hospitable`, `airbnb_direct`) sözleşme kümesi;
  `OutboundProvider` CANLI küme (bugün yalnız `hospitable`) ve kayıt defteri/dispatch YALNIZ onu kabul eder →
  sözleşme aşamasındaki sağlayıcı derleme zamanında kaydedilemez. "airbnb" asla sağlayıcı kimliği olmaz.
- **Yetenek manifestosu** (`channels/manifests.ts`): her kaynak 13 yeteneğin HEPSİNİ ve her veri sınıfını ilan
  eder; Hospitable manifestosu adaptörün çalışma zamanı yetenek kümesiyle PARİTE pinli; `supported` yeteneği
  olan kaynakta veri politikası `requires_terms_review` KALAMAZ; kiracılar arası kullanım her yerde yasak.
  Yeni adaptör önce manifestoya `planned` girer, uyum kitini geçmeden `supported` olmaz.
- **Airbnb Direct adaptörü ağa ÇIKMAZ** (fetch/HTTP/env/DB/URL literal mekanik pinli); tahminî uç nokta/yük
  YAZILMAZ (değişmez 18). Okuma hatası `IngestError("unsupported")` → müşteriye genel metin (Hospitable DEMEZ).
- **Müsaitlik: tek tarih kuralı `calendarDateOf`** (tam 00:00Z/12:00Z = yalnız tarih; aksi an → mülk dilimi).
  Aynı günü karşılaştıran YENİ kod ham `Date` karşılaştırması YAPMAZ, bu kuralı kullanır (`getAdjacency`
  09-24'te bu yüzden düzeltildi). "Boş" yalnız KANITLA (her kapsama kaynağı taze VE tam okunmuş — `partial` taze de
  olsa boş kanıtı değil, F16); kanıt yoksa "bilinmiyor".
  Çakışma OLGUDUR — hiçbir kod çakışan satırı iptal/birleştirmez. Müsaitlik isteme/AI'ya bağlanırken yalnız
  `verified` sonuç otomatik cevaba dayanak olabilir (ayrı dilim, ayrı onay).
  İddia dayanağı (motor 2, 10-09 kurucu yokken karar #9): besleme satırı "taze" yalnız kaynağın son başarılı okumasında
  görüldüyse VE o okuma tazelik sınırı (6 sa) içindeyse; bayat kaynağın satırı kanıtsızdır (panel çakışması 70 / çıkarım).
- **Demo hesabı** (`lib/demo-tenant/`): her kimlik `lxdemo-`; her silme `DEMO_ORG_ID` ile kapsanır (mekanik
  pin); reddetme = SIFIR yazma; sahte bağlantı/rezervasyon kodu/misafir iletişimi/sır YOK; şikâyet asla `new`
  doğmaz. Canlı koşu = kurucu onayı + taze `pg_dump`. Korumalar betik ÇALIŞTIRILARAK değil saf karar
  fonksiyonuyla (`cli.ts`) sınanır.

**AI / QR / diğer ürün kararları**
- 🚨 **HOST KARAR MOTORU (10-02 gece, kurucu: "cevap vermek talebi çözmek değil"; anahtar `HOST_DECISIONS_ENABLED` VARSAYILAN KAPALI; migration 59
  İTİLDİ 10-03 — Railway açılmadan önce taze `pg_dump`; tasarım `docs/TASARIM-2026-10-02-host-karar-motoru.md` §10 inceleme düzeltmeleri):** kart AÇAN sinyal otomatik gönderimi
  DURDURAN sinyalin AYNISI (`stayRequestKinds`; ayrışamaz); saat yalnız isteği gören modelin okuması ve standardın doğru tarafında, yoksa misafirin
  TEK açık saati, yoksa BOŞ (tahmin yok). Kimlik `(konuşma, mesaj, tür)` tekil; her geçiş durum + sürüm CAS; "yanıtladınız / iptal / süresi geçti /
  gönderim yarıda kaldı" TÜRETİLİR (karar mesajı "ev sahibi yazdı" sayılmaz — ne kartlar ne öğeler için). Mesaj başına TEK e-posta: K10 "Misafir
  cevabınızı bekliyor" ile AYNI kilit, hassas öğe e-postası gittiyse yok. Karar ucu gönderimden HEMEN önce: sürüm · iptal · gün · misafir yeniden yazdı ·
  OLGU PARMAK İZİ (`factsHash`, kart sayfayla AYNI kurucudan `decisionCardContextFor` — iki yer farklı yüklerse onay her seferinde düşer) → elle cevapla
  AYNI çekirdek `host-send.ts` (ikinci gönderim yolu yazılmaz). Metni KOD kurar (7 dil, günü adlandırır, saate ek yok, ücret yalnız kayıtlı kuraldan);
  belirsiz teslim kör tekrar edilmez — gönderim sırasında HATA, `duplicate` ve kuyruk kimliği çatışması da "gönderim doğrulanamadı"dır; YALNIZ hiçbir
  şeyin gitmediği kesin hata kartı yeniden açar. Kilit onayın saatini HEMEN yazar (komşu kart / erken giriş kontrolü gönderim sürerken görür). Gün CANLI
  (`liveDecisionDayKey`: rezervasyonun bugünkü tarihi). Aynı talebe turda yeni mesaj gelirse VAR OLAN kart kullanılır (ikinci kart / e-posta yok); saat
  değişince yeni kart eskisinin yerine geçer ve bildirim damgasını DEVRALIR. 🚨 Doğrulanmış OTOMATİK erken giriş onayı ev sahibinin kartını EZMEZ: kartta
  karar verildiyse / veriliyorsa gitmez, bekleyen kart göndermeden önce sahiplenilir (`claimTurnDecisionForPolicy`). Panel ev sahibinin GÖRDÜĞÜ
  değerleri (son misafir mesajı + `factsHash`) düzenleyici açılınca sabitler; arka planda değişirse "Okudum" ister. Karta bağlı öğe "açık iş" rozetinde / panoda / "Açık işler"de İKİNCİ kez sayılmaz. Yalnız sahip / yönetici;
  bürünmede düğme yok, uç 403. Yeni bir karar yüzeyi (WhatsApp, ses) aynı uçtan ve aynı yeniden doğrulamadan geçer.
- QR: per-stay device binding; `isOpenNow` simetrik; `chatToken` rotasyonu YOK (bilinçli); PIN DoS tasarımı
  var uygulanmadı (bütçeyi cihaza taşıma REDDEDİLDİ). QR rotasında hata sınırı `reportError`.
- AI öneri paneli kapatılabilir, tercih KALICI DEĞİL. Bekleyen misafir mesajları dar taranıyor
  (`HIGH_STAKES_RISK_TYPES` yalnız son mesajda — açık, ↓açık işler).
- 🚨 **K8 / K9 (kurucu kararı 09-30):** hassas öğeler birbirinin yerine GEÇMEZ (yalnız hassas olmayan aynı tür); her yeni hassas mesaj
  kendi öğesi + kendi e-postası, aynı mesajın yeniden senkronu ikinci öğe / e-posta üretmez; cevap modelinin BU turun öğeleriyle
  açıklanamayan risk sinyali son mesajda ayrı öğe (güvenli kısım yine gider); önceki mesajların tutulan öğeleri cevap bloğunda ayrı
  bölümde ("intent / risk bunlar için verilmez"). Mesaj başına e-posta tekilliği ATOMİK (10-01, Codex): `held-items-mail:<mesaj>`
  SystemLock talebini alan çağrı atar; kaybeden öğe damgasını geri verir, e-posta gidemezse talep geri verilir.
- 🚨 **ŞİKÂYETE BAĞLI İSTEK CEVAPLANMAZ (kurucu kararı 10-01, ANAHTARSIZ; `conversation-items/core.ts complaintDependent`):** bu turda
  TUTULAN şikâyet varken bağımsız bilgi türü (`COMPLAINT_INDEPENDENT_KINDS`: wifi · parking · checkin_time · checkout_time · luggage ·
  directions_transport · local_recommendations · access_keys) OLMAYAN istek planda cevaplanabilir sayılmaz; kapı da iki öğe doğrudan
  verilse tutar (`items_complaint_dependent`); cevaplanabilir istek yoksa cevap gitmez (`items_nothing_answered`, ikinci kemer).
  "Gürültüden uyuyamadık, yine olursa ne yapacağız?" → hiçbir şey gitmez; "… Wi-Fi ağı hangisi?" → yalnız Wi-Fi. Önceki turun şikâyeti
  bağlamaz (K8). Kök neden istem katmanları `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` KAPALI (anlama: şikâyete bağlı yardım sorusu ayrı
  istek değil; cevap: şikâyetçiye kural hatırlatma yok, 112 yalnız gerçek can güvenliği). 🚨 10-01 sabah (kurucu kararı, Sabah Kararları
  17 + 18 "a"; `conversation-items/relation.ts`): öğe kipi + bu anahtar BİRLİKTE açıkken liste karar VERMEZ — önce anlam ilişkisi: anlama
  katmanı istek başına `relation` (own_topic / fix_request / follow_up / unclear; eksik = unclear = TUT), bağlayıcı talepler şikâyet + iade /
  iptal + ev sahibi talebi; kod koruması yalnız sıkılaştırır ("kendi konusu" denen istek talebin konu kavramını paylaşıyorsa / konusuzsa /
  şikâyette ev kuralıysa bağlı). Arıza çözümü yalnız şikâyette, cihaz / tesis türünde, tehlike sınıfı (sigorta / şalter / elektrik, gaz /
  kombi / şofben / sıcak su cihazı, yangın / duman) DIŞINDA; kapı `kb:` kaynağı ister (`items_fix_unverified`) ve cevabı tehlike sözlüğünde
  tarar (`items_fix_hazard`). Bağımsızlık işareti gönderim izni DEĞİL (bütün kapılar aynen); hassas talep açık + mesaj başına tek e-posta;
  tehlikede tarif hazır taslakta. İşaret yokken (anahtar kapalı) liste BİREBİR. 🚨 Karar 23 (soru SORMADAN arıza bildirimi de çözüm isteği
  alır) + kör set 4 düzeltmesi (10-01 öğlen): arıza çözümü YALNIZ modele giden bilgi tabanında O konunun TARİF kalemi varsa sunulur
  (`relation.kbRecipeTopics`: sorun giderme fiili — bas / bekle / seç / yeniden başlat / "-mıyorsa", yedi dil; çıplak "tuş / button" ve genel
  "kullanın / kapatın" YOK; konu ÖNCE başlıktan); tarifsiz istek şikâyetle ev sahibinde (eksik = tut). Tarifsiz arızada modele sunulan istek
  BOŞ cevap / "bilgide yok" / şifre kalemine dayanan uydurma adım üretiyordu (üçü de ölçüldü). Kaynak atfı `kb:` kalemin BAŞLIĞIYLA da gelir
  ("kb:klima", "kb:FAQ_Televizyon_ve_kumanda", kısa etiket "kb:FAQ_tv_remote" / "kb:internet_restart") → kategori öneki, başlık ya da başlıkla
  ortak ayırt edici sözcük (≥5 harf, genel sözcük değil) o kategoriye iner (`ai/index.ts kbSourceLabel`; ilgisiz atıf düşer). 🚨 Kör set 5:
  karışık mesajda (tarifsiz arıza + başka soru) modeller BIRAKILAN cihaza değindi (uydurma adım / "talimatım yok", ikisi de gitti) → plan bu
  turun bırakılan cihaz kavramlarını kapıya verir (`heldDeviceTopics`; cevaplanan isteğin konusu çıkarılır), cevap değinirse
  `items_held_touched` (liste + ilişki kipinde; yalnız tutar). 10-01 gece (A06): konu sözlüğünde olmayan cihazlar (şofben, petek,
  kondisyoner, mikro dalga, kilidi, televizyonun, klimanın "kar tanesi" simgesi) YEREL sözlükten (`relation.ts LOCAL_DEVICE_WORDS`; getirme
  sözlüğüne EKLENMEZ — canlı seçimi değiştirir); cevaplanan isteklerin hiçbiri cihaz değilse adsız "makineyi / cihazı / the device …" +
  aynı cümlede tarif adımı bırakılan cihaza değinmedir (`heldDeviceGenericRef`). İlişki kipinde: tehlike sözlüğü 17 terim genişledi
  (sayaç panosu, ana şalter, çakmak / kibrit, tornavida, petek / Heizkörper / radiateur, FI / УЗО / рубильник; "FI" tek sözcük OLAMAZ —
  katlanmış "wi-fi"); tarif işareti İKİ KADEMELİ (güçlü: bas / dokun / yeniden başlat / sıfırla / fişten çek; zayıf — kapat / aç / bekle /
  seç / değiştir — ancak iki farklısıyla; arıza anma + yalnız "bize yazın" tarif DEĞİL; "bilmiyorsanız / istemiyorsanız" arıza değil;
  İngilizce "the basin" ≠ "basın", "drucken" ≠ "drücken"); başlık konusuz / çok konuluysa konu TARİF CÜMLESİNDEN; birleşik istekte HER cihaz
  tarifli olmalı; olgusuz bağlayıcı (uyarı geçişinin şikâyeti) aynı mesajın öteki isteklerinin konusunu alır. Kalıp listeleri de KATLANIR
  (Arapça "ئ" → "ي"). 🚨 10-01 gece 2 (RC60 regresyon koşusu — bu sıkılaştırma GERÇEK tarifleri düşürüyordu, set 6'da 3 tarifli arıza tutuldu):
  kontrol adı ("tuş / düğme / mod / button / mode / symbol / Taste / bouton / botón / кнопка / زر"; kapı anahtarı DEĞİL) TEK zayıf işaret
  (fiille tarif); "touch / tap and hold" + Türkçe güç döngüsü ("yeniden / tekrar açın · açıp · açabilirsiniz · takın") güçlü; Türkçe arıza
  koşulu 3. şahıs "-mazsa" + kapalı küme "sıkışırsa / takılırsa / kesilirse / bozulursa / arızalanırsa"; liste ayracı OLMAYAN çok kavramlı
  başlık ("Otopark kapısı kumandası çalışmazsa") TEK cihaz → başlığın cihazları; SSS satırında tarif cümlesi cihazı aynı SATIRIN önceki
  cümlesinden alır — o cümle SORU (?) / arıza anışıysa ya da aynı cihazı anıyorsa (yalnız iki nokta başlık DEĞİL: "Ağ adı: …"). Tarif
  tanıyıcıyı değiştiren tur eval bilgi tabanlarının TÜM kalemlerinde (568) canlıyla farkı yeniden üretir. 🚨 10-02 gece (kör set 7 k7-22 —
  iade turunda "otopark ücrete dahil mi" isteği "çözüm" sayıldı, "otopark günlük 200 TL" GİTTİ): ücret / fiyat / ödeme soran istek arıza çözümü
  SAYILMAZ (`moneyRequest`: Türkçe anlama sorgusunda para sözcüğü — "para" yalnız çekimleriyle, "öde-" yalnız ödeme biçimleriyle, "iade" BİLEREK
  yok — ya da özgün sorguda tutar / muafiyet); çözüm diye cevaplanan istekte tutar / muafiyet → `items_fix_money` (geçmiş koşuların 132 gerçek
  tarif cevabında 0). Canlı liste kipindeki karşılığı kurucu kararı (Sabah Kararları 46).
- 🚨 **BEKLEYEN RİSK ÖĞE BAZINDA (kurucu 09-26):** eski cevapsız risk yeni mesajla KAYBOLMAZ ama TÜM konuşmayı BLOKE
  ETMEZ. "Bekleyen herhangi bir yüksek riskli etiket → cevabın tamamı tutulur" KONUŞMA DÜZEYİ kapısı REDDEDİLDİ (`6c0e6b4`
  gönderilmedi, yedek dal `backup/pending-highstakes-conversation-gate-2026-09-26`) — geri getirme. Kanalda istek düzeyi
  öğe/durum YOK; bugünkü davranış + migration'sız öneri (QR paritesi: öğe başına devir) + eksik kalıcı durum + kurucu
  kararları D1–D6: `docs/BEKLEYEN-RISK-OGE-BAZINDA-2026-09-26.md`; karakterizasyon `pending-risk-item-scenarios.test.ts`.
- 🚨 **KONUŞMA ÖĞELERİ (öğe bazlı risk; 09-26, migration 56; `AI_CONVERSATION_ITEMS_ENABLED=1` CANLI — kurucu 09-26; tasarım
  `docs/TASARIM-2026-09-26-konusma-ogeleri.md`):** hassas istek SESSİZCE ev sahibinde (Sorunlu YOK, bekletme mesajı YOK, mesaj başına
  acil e-posta), güvenli kısım cevaplanır, yalnız acil/enjeksiyon durdurur, emin olunmayan tur öğeye BÖLÜNMEZ (bugünkü kapı), model
  riski TÜM mesajlar için etiketler (ayrımı kod yapar). Bayrak anlama katmanı kapalıyken açık sayılmaz; bayrak YALNIZ bu kod
  canlıdayken eklenir (eski canlı kod bayrağı anlama katmanı şartı olmadan okuyordu). Ödeme/fatura isteği niyetten hassas (`d40a566`,
  her dilde). HAZIR TASLAK (kurucu "Otomatik hazır dursun"): turun tamamı tutulunca cevap ev sahibi ağzıyla `aiSuggestedReply`e
  yazılır, konuşma açılınca panelde durur (`prepared-draft.ts`); kısmen tutulan / müsaitlik vetolu / şablon cevap KAYDEDİLMEZ;
  gösterimde müsaitlik uyarısı yeniden hesaplanır; bayrak kapalıyken gösterilmez.
- **Mülke özgü ev kuralları (#188, `docs/TASARIM-2026-09-26-ev-kurallari-politikasi.md`) ONAYLANDI ("en mantıklı şekilde"):** yasak
  kural NAZİK söylenir; açma sırası (ilk planın migration'ı gerekmedi — depo migration'sız ↓Dilim 2; "57" numarası 09-28'de misafir
  adı sütunlarına verildi) → kural kartı → gölge → ücretli ölçüm → onay; "izinli" parti / ek misafir / sessiz saat ev sahibinde
  kalır. Saf çekirdek `house-rules/core.ts` canlıda, çağıranı YOK. Dilim 2 (migration'sız): depo `house-rules/store.ts` erken giriş
  kuralıyla AYNI tabloda (`AutomationRule`, mülk başına tek satır, aynı kilit sırası), yönetici kapılı `PUT …/house-rules`, mülk silme
  kuralı aynı işlemde siler, kart `HOUSE_RULES_CARD_ENABLED=1` iken (varsayılan KAPALI, canlıda AÇIK; "yapay zekâ henüz kullanmıyor"
  der). Dilim 3 GÖLGE ÖLÇÜM (`AI_HOUSE_RULES_SHADOW`, varsayılan KAPALI, canlıda AÇIK; anlama katmanı açıkken): katman istek başına
  kural konusu + tutum çıkarır, "kural olsaydı" YALNIZ kayda (`hr`) — KARAR DEĞİL, kanal + QR kararı birebir aynı (pinli); kapalıyken
  anlama istemi/şeması/önbellek anahtarı bayt bayt eski. 🚨 "karar değişmez" yalnız KOD için — alanlar aynı çağrıya bindiği için model
  çıktısı oynayabilir (ölçüm: tasarım belgesi §6).
- Doluluk gece-katı; ikinci kutucuk `sameDayTurnovers`; üçüncüsünü önerme. Kullanıcının geri aldırdığı
  UI: sidebar grupları, yatay tab-strip, zoom 0.95 geri alma — TEKRAR ÖNERME. Sidebar `mt-4` yük taşır.
- Tarayıcı saat dilimine güven `APP_TRUST_BROWSER_TIMEZONE` default kapalı. S3 virtual-hosted, noktalı
  bucket adı reddedilir. E-posta boot kapısı: Resend veya eksiksiz SMTP.
- Tedarik zinciri: zafiyet kapısı = sıfır TRİAJSIZ (`security/audit-baseline.json`, `expires` zorunlu),
  altyapı arızasında fail-closed + retry; betik kaydın şemasını KENDİSİ doğrular (F12: `validateBaseline` — takvimde
  gerçek `expires`, tekil kimlik, GHSA ya da NO-GHSA; sayaç zafiyet derken tek danışma çıkmazsa kırmızı); Dependabot PR CI (`head_ref` guard); `schedule:` bu repoda
  çalışmaz (varsayılan dal `main`, `ci.yml` yok) → haftalık denetim CANLI DEĞİL (runbook
  `docs/ZAFIYET-KAPISI-ZAMANLAYICI-RUNBOOK.md`); Node 22 (24 değil); iki aşamalı non-root imaj
  (`chown -R node:node /app` yük taşır; `node:22-slim`de openssl apt şart).
- Operatör scriptleri (PG/Windows): en yüksek kurulu pg sürümü, tüm exe'ler aynı klasör, saf ASCII,
  `pg_ctl -s -w`, `initdb --locale=C`, drill `-ExpectCalendarSources` zorunlu.
- SEO/landing dürüstlük: (app) noindex; mutlak iddia yok; "AI yanıtı" değil "AI işlemi".
- .eu açılışı: ayrı deployment (env: `APP_URL`, `APP_LOCALE`, `APP_BILLING_CURRENCY`, `APP_DEFAULT_TIMEZONE`,
  `APP_TRUST_BROWSER_TIMEZONE=1`); Paddle webhook izolasyonu (ayrı hesap ya da org çözümü persist'ten önce)
  kararı ŞART; SEO yüzeyleri `.com`'a sabit (ayrı tur).
