# TASARIM — Operatörün hassas işlemlerinde taze 2FA (25 Kasım)

> Kaynak: `docs/KURUCU-TALIMATI-2026-11-25-codex-raporu-ve-opus-dalgasi.md` (Codex: "Operatörün hassas işlemlerinde taze 2FA yok … Bu bir 2FA
> atlatma bulgusu değil; mevcut bir operatör oturumu ele geçirilirse etkisini sınırlayan ek kapı eksik").
> Bu belge YENİ bir davranış önerir: kurucu onayı olmadan kod yazılmaz (CLAUDE.md "SORMADAN SİSTEM KURULMAZ"). Kod YOK; yalnız envanter + tasarım
> + sorular. Yazan: Opus (OB), taban `07f679c5`.

## 1. Kısa sonuç

- Codex'in iddiası **doğru** (çalıştırılarak teyit edildi, §2.1). Operatör yetkisi = "e-posta listede + bu oturum bir kez ikinci adımdan geçti".
  "Ne zaman geçti" hiçbir yerde tutulmuyor; oturum her istekte 14 gün uzadığı için (kayan oturum) aylar önceki bir 2FA girişi bugün de yetiyor.
  Hatırlanan cihazla kodsuz giriş de aynı iddiayı (`mfa: true`) basıyor.
- Bu bir atlatma değil (doğru: hatırlanan cihaz belirteci 2FA dönemine + oturum sürümüne bağlı, `trusted-device.ts`). Eksik olan, çalınmış bir
  operatör çerezinin en ağır iki işlemi (müşteri 2FA'sını kaldırmak, müşteri hesabına girmek) hemen yapabilmesini sınırlayan ikinci kapı.
- Öneri: yalnız birkaç işlem için **işleme ve hedefe bağlı, tek kullanımlık, 5 dakikalık "yeniden doğrulama izni"**. Normal girişe ve öteki
  operatör ekranlarına sürtünme yok. Migration GEREKMEZ (tek kullanım için depodaki `SystemLock` nonce deseni). Anahtar
  `OPERATOR_STEP_UP_ENABLED` (varsayılan KAPALI).

## 2. Envanter (çalıştırılarak / kod okunarak doğrulandı)

### 2.1 `mfa` iddiası nerede doğuyor — TEYİTLİ (sonda)

| Yer | Ne yapıyor |
|---|---|
| `src/app/api/auth/login/route.ts:225-231` | 2FA açık hesapta önce `hasTrustedDevice(...)` sorulur; doğruysa kod İSTENMEZ. |
| `src/app/api/auth/login/route.ts:376` | Oturum `mfa: Boolean(user.twoFactorEnabledAt)` ile basılır — TOTP, kurtarma kodu ya da **hatırlanan cihaz**, üçü de aynı `true`. |
| `src/lib/auth/session.ts:107-123` | `mfa` = "bu oturum faktörden geçti mi". Oturumda **ne zaman geçtiği** alanı YOK (beyaz liste `verifySession`, `:160-185`). |
| `src/lib/auth/session.ts:70` + `src/middleware.ts:109-125` | `SESSION_MAX_AGE` 14 gün; her istekte çerez yeniden imzalanır (kayan) → etkin bir operatör oturumu hiç bitmez, `mfa` da onunla yaşar. |
| `src/lib/admin-core.ts:75-80` | `isSuperAdmin` = `session.mfa === true` + e-posta `SUPERADMIN_EMAILS`te. Tazelik denetimi yok. |
| `src/lib/admin.ts:99` | Bürünmeye girerken `mfa` yeni çereze **aktarılır** (yükseltme değil). |
| `src/lib/api.ts:41-96`, `src/lib/auth/index.ts:116-153` | `mfa` her istekte veritabanına karşı DÜŞÜRÜLEBİLİR (2FA kapatılmışsa) ama hiçbir zaman "eskidi" diye düşmez. |

Sonda (commit edilmedi; `tests/integration/zz-probe-ob-t1.test.ts`, `lixus_o3`): 2FA'lı operatör, `hasTrustedDevice → true`, kodsuz giriş →
`200`, basılan oturum alanları `userId,organizationId,role,membershipId,membershipEpoch,email,name,sessionEpoch,mfa` — `mfa=true`, zaman alanı yok;
aynı yük `isSuperAdmin` → `true`.

### 2.2 Operatörün yazan / hassas rotaları ve bugünkü kapıları — TEYİTLİ (kod)

Her rotanın ortak ilk üç kapısı: `requireSession` → `isSuperAdmin` → bürünmede ret (`OPERATOR_SUPPORT_VIEW_MESSAGE`, `auth/impersonation.ts:16`;
istisna `exit`). "Site dışı" = `crossSiteWrite` ya da `sec-fetch-site` kontrolü. Kova = operatör kimliğine bağlı saatlik tavan (veritabanında, `rate-limit.ts:1-6`).

| Rota | Etki | Site dışı | Kova / saat | Zorunlu kayıt |
|---|---|---|---|---|
| `reset-2fa` POST (`route.ts:45-56`) | Müşterinin canlı 2FA'sını kaldırır, oturumlarını düşürür | var | 10 | aynı işlemde (`:117`, `writeAuditInTx`) |
| `impersonate` POST (`route.ts:15-28`) | Müşteri hesabına (salt-okunur, en çok 2 sa — `impersonation.ts:12`) girer | var | 30 | çerezden ÖNCE, zorunlu (`admin.ts:70-82`) |
| `export` GET (`route.ts:28-56`) | Bir işletmenin TAM verisini indirir | `sec-fetch-site` | 20 | indirmeden önce, zorunlu |
| `customers` POST | Yeni müşteri + sahibinin girişi (e-posta doğrulanmış sayılır) | var | 20 | `writeAudit` (hata yutulur) |
| `trial-end` POST | Denemeyi bitirir / geri verir / kart şartını kaldırır | var | 30 | iş fonksiyonunda (emin değilim: rota dosyasında doğrudan kayıt yok) |
| `trial-identity-exempt` POST | Deneme kimlik muafiyeti | var | 30 | aynı işlemde |
| `checkout-release` POST | Takılı ödeme kaydını bırakır | var | 30 | `writeAudit` |
| `quality-audit` POST | Konuşmaları dış denetçiye (Claude) gönderir | var | 20 | `writeAudit` |
| `licenses/[id]/decision · proof · reading` POST | İşletme belgesi kararı | ortak `operatorWritePreamble` | (ön kapıda) | iş fonksiyonunda |
| `leads/[id]` PATCH | Potansiyel müşteri kaydı | var | — | `writeAudit` |
| `events` GET · `ai-quality` GET/POST · `licenses` GET | Okuma (olay arama, konuşma görüntüleme) | var | 60 / — | görüntüleme kaydı |
| `exit` POST | Bürünmeden çıkış (yetki DÜŞÜRÜR) | var | — | — |

Operatör iddiasını kullanan müşteri yüzü rotaları: `hospitable/connect`, `hospitable/oauth/authorize` (`owner || isSuperAdmin`) — bürünme salt-okunur
olduğundan pratikte operatörün kendi işletmesi; `properties/[id]/instructions`, `history-learn/comparisons/[id]` yalnız `byOperator` etiketi yazar.

### 2.3 Oturum içi yeniden doğrulamanın emsali — TEYİTLİ (kod)

- `src/lib/auth/reauth-guard.ts:22-58`: 2FA kurulum/açma/kapatma/kurtarma kodu, hesap silme, veri dışa aktarma aynı günlük **20 hata** sayacına
  yazar (`reauth-fail-day:<userId>`); tavan dolunca doğru kod da reddedilir; hata `account.reauth_failed` olarak denetime yazılır.
- Kod TÜKETME deseni: `src/app/api/account/delete/route.ts:96-118` — `verifyTotpStep` + `twoFactorLastStep` koşullu yazımı (aynı kod ikinci kez
  geçmez; girişle AYNI kolon → girişte kullanılan kod burada da yanmış sayılır).
- Tek kullanımlık belirteç emsali: `src/lib/billing/plan-change.ts:275-381` — HMAC'li belirteç + `jti`, tüketim `SystemLock` satırı
  (`consumePlanChangeNonce`), süresi geçen satır fırsatçı süpürülür. Migration gerektirmeyen hazır yol.
- Bilinen sınır (Codex de söylüyor): `reauthBlocked` (bakış) ile `noteReauthFailure` (sayım) ayrı çağrılar; eşzamanlı denemede günlük tavan birkaç
  hata aşılabilir. Kısa kova ayrı tuttuğu için hesap ele geçirme sayılmaz. Bu tasarım aynı sayacı kullanırsa aynı sınırı devralır (§6 R3).

### 2.4 Ekran — TEYİTLİ (dosya)

Operatör düğmeleri `src/components/admin/reset-2fa-form.tsx` ve `src/components/admin/impersonate-button.tsx`; dışa aktarma formu
`src/app/(app)/admin/page.tsx` içinde. Bugün hiçbiri kod sormuyor.

## 3. Tasarım

### 3.1 İlke

"Kim olduğunu" giriş kanıtlar; "bu işlemi şu an sen mi yapıyorsun" ayrı kanıttır (büyük platformlarda "sudo mode" / "step-up": GitHub sudo modu,
Google "kimliğinizi doğrulayın", AWS konsolunda hassas işlemde MFA). Taze kanıt yalnız geri alınamaz ya da başka hesabın kapısını açan işlemde istenir.

### 3.2 Akış

1. Operatör "2FA'yı sıfırla" ya da "Hesaba gir"e basar. İstemci önce `POST /api/admin/step-up` çağırır:
   `{ operation: "reset_2fa" | "impersonate" | "export", target: <e-posta | organizationId>, code: "123456" }`.
2. Sunucu: bugünkü üç ortak kapı (oturum, `isSuperAdmin`, bürünmede ret) + site dışı + JSON → `reauthBlocked(operatör)` → operatörün KENDİ
   (bürünmede aktör; zaten bürünmede ret var) TOTP'si `verifyTotpStep` + `twoFactorLastStep` koşullu yazımıyla tüketilir. Hata → `noteReauthFailure`
   (`ReauthOperation` kümesine `operator_step_up` eklenir).
3. Başarılıysa sunucu kısa bir belirteç döner: HMAC(AUTH_SECRET'tan ayrı tuzla türetilmiş anahtar) üzerinde
   `{ op, target, actor, actorSessionEpoch, jti, exp = şimdi + 5 dk }`. Belirteç çereze YAZILMAZ (istek gövdesinde taşınır; başka sekme / bağlantı
   tetikleyemez).
4. Asıl rota (`reset-2fa` vb.) gövdede `stepUpToken` ister. Doğrulama: imza · süre · `op` bu rota · `target` istekteki hedefle BİREBİR (normalize
   e-posta / org kimliği) · `actor` = oturumun aktörü · `actorSessionEpoch` = oturumdaki · `jti` `SystemLock`ta ilk kez tüketiliyor
   (`operator-step-up:<jti>`, `lockedUntil = exp`). Biri tutmazsa 403 + sade metin; işlem başlamaz.
5. Tüketim, işin kendisiyle aynı işlemde olamaz (SystemLock ayrı satır); sıra: belirteci tüket → işi yap. İş kesin hatayla düşerse (`409` "az önce
   değişti" gibi) belirteç serbest bırakılmaz — operatör yeni kod girer (basit ve güvenli yön). Emin değilim: 409 sonrası yeni kod istemek operatörü
   yorar mı; kurucu sorusu S4.

Neden oturuma `mfaAt` damgası değil: damga işlem / hedef bağı taşımaz, kayan oturumla birlikte taşınır ve "5 dk içinde her şeyi yap" penceresi açar;
ayrıca `verifySession` beyaz listesine alan eklemek bürünme dahil bütün oturumları etkiler (08-05 `mfa` olayı). İşleme bağlı belirteç bu riskleri taşımaz.

### 3.3 Kapsam (önerilen liste)

| Rota | Kapsamda mı | Gerekçe |
|---|---|---|
| `reset-2fa` | **Evet** | Müşterinin ikinci faktörünü kaldırır; çalınmış operatör çereziyle müşteri hesabına giden en kısa yol. |
| `impersonate` | **Evet** | Müşteri verisine erişim açar (salt-okunur ama KVKK açısından ağır). Hedef = organizationId. |
| `export` | **Evet (öneri)** | Bir işletmenin tam dökümü; tek istekte en çok kişisel veri çıkaran işlem. GET olduğu için belirteç sorgu dizesinde değil, önce POST'la izin alınır; GET `stepUpToken`'ı bir kerelik kullanır (bağlantı paylaşılırsa ikinci indirme olmaz). |
| `customers` POST | Soru (S2) | Hesap açar ama mevcut müşteriye dokunmaz; e-postayı doğrulanmış sayması yüzünden ağır sayılabilir. |
| `quality-audit` | Soru (S2) | Konuşmaları dış hizmete gönderir; anahtarı ayrı (`qualityAuditEnabled`), günlük kullanımı yorabilir. |
| `trial-*`, `checkout-release`, `licenses/*`, `leads`, okuma rotaları | Hayır | Para / deneme durumu geri alınabilir ve kayıtlı; okuma rotalarında görüntüleme kaydı var. Sürtünme değerinden büyük. |
| `exit` | Hayır | Yetki düşürür. |

### 3.4 Ayrıntılar

- **Ömür:** 5 dakika (kod girildikten sonra işi tamamlamaya yetecek, ekranda bırakılan belirtecin değerini düşürecek kadar kısa).
- **Tekrar kullanım:** yok (`jti`). Aynı hedefe ikinci sıfırlama yeni kod ister.
- **Hata bütçesi:** var olan ortak günlük 20 hata (`reauth-guard.ts`), ayrıca kısa kova `admin-step-up:<aktör>` 10 / 10 dk (girişteki
  `login-2fa` kovasıyla aynı ölçü).
- **Kurtarma kodu:** kabul edilmez (2FA kapatma ve hesap silmeyle aynı karar — `account/delete/route.ts:92` yorumu). Telefonunu kaybeden operatör
  önce kurtarma koduyla giriş yapar, 2FA'yı yeniden kurar.
- **Bürünme sırasında:** step-up rotası da bürünmede reddeder (bugünkü kural "operatör yazması önce çıkış"). Bürünmeye girişte alınan belirteç bir kez
  kullanılır; müşteriden müşteriye geçiş bugün zaten reddediliyor (`impersonate/route.ts:20`), yani her giriş ayrı kod ister.
- **Hatırlanan cihaz:** girişte kodu atlatmaya devam eder (normal girişe sürtünme yok) ama step-up'ı atlatmaz — tasarımın asıl kazancı burada.
- **Kayıt:** başarılı step-up `admin.step_up` (operation, hedefin opak kimliği; e-posta YAZILMAZ — `admin.ts:78-79` gerekçesi), hata
  `account.reauth_failed` (operation `operator_step_up`).
- **Anahtar:** `OPERATOR_STEP_UP_ENABLED` — yalnız "1" ile açılır (`STRICT_ONE_FLAGS` + `scripts/env-check.mjs` + açılış belgesi). Kapalıyken asıl rotalar
  belirteç aramaz (bugünkü davranış birebir). Açılış sırası: önce rota belirteci kabul eder ama zorunlu tutmaz (istemci hazır mı), sonra zorunlu.
- **Migration:** gerekmez.

### 3.5 Operatörün göreceği metinler (ÖNERİ — kurucu onayına)

- Kod kutusu başlığı: "Bu işlem için doğrulama uygulamanızdaki kodu girin."
- Alt satır (sıfırlama): "Müşterinin iki adımlı doğrulaması kaldırılacak ve bütün oturumları kapanacak."
- Alt satır (hesaba giriş): "Müşterinin hesabını salt okunur olarak açacaksınız. Giriş kaydedilir."
- Hatalı kod: "Kod hatalı ya da az önce kullanıldı. Uygulamadaki yeni kodu girin."
- Süresi geçen izin: "Doğrulamanın süresi doldu. Kodu yeniden girin."
- Günlük tavan: var olan `REAUTH_CAP_MESSAGE`.

## 4. Kurucuya sorular (önce / sonra örnekli)

**S1 — Kapsam üç işlem mi?** Öneri: 2FA sıfırlama + hesaba giriş + tam dışa aktarma.
- Önce: operatör panelde "Hesaba gir"e basar → anında müşterinin gelen kutusu açılır.
- Sonra: "Hesaba gir" → kod kutusu "Bu işlem için doğrulama uygulamanızdaki kodu girin." → kod → gelen kutusu. Deneme bitirme, ödeme bırakma,
  belge kararı bugünkü gibi kodsuz.
Böyle yapalım mı; dışa aktarma da girsin mi?

**S2 — Hesap açma ve kalite denetimi?** Öneri: şimdilik dışarıda (mevcut müşteriye dokunmuyorlar). İsterseniz eklenir; her yeni müşteri açılışında bir kod
girilir.

**S3 — İzin süresi 5 dakika uygun mu?**
- Örnek: kodu girdiniz, telefonla müşteriyi doğruluyorsunuz, 7 dakika sonra "Sıfırla"ya basıyorsunuz → "Doğrulamanın süresi doldu. Kodu yeniden girin."
  Daha uzun (10 dk) olsun mu?

**S4 — İşlem "az önce değişti" (409) ile düşerse aynı izin yeniden kullanılsın mı?** Öneri: hayır, yeni kod (daha basit, daha güvenli). Bedel:
nadir durumda ikinci kod.

**S5 — Hatırlanan cihaz girişte kodu atlatmaya devam etsin mi?** Öneri: evet (normal girişe sürtünme yok); koruma hassas işlemde. Alternatif: operatör
hesabında "beni hatırla" tamamen kapansın — daha sert, her girişte kod.

## 5. Dilim sırası

1. Saf çekirdek: belirteç imzala / doğrula (op, hedef, aktör, sürüm, süre) + birim testleri (kırmızı-önce, mutasyon: her alanın kıyası tek tek
   kaldırılınca kırmızı).
2. `POST /api/admin/step-up` (anahtar kapalıyken 404) + reauth sayacı bağı + entegrasyon testi (kod tüketimi, ikinci kullanım, günlük tavan).
3. `reset-2fa` belirteci ister (anahtar açıkken) + uçtan uca test (hedef farklı e-posta → 403, süresi geçmiş → 403, tekrar → 403, doğru → 200).
4. `impersonate`, sonra `export` (GET için tek kullanım).
5. Arayüz kod kutusu + metinler (kurucu onaylı).
6. Açılış: belgeye anahtar + sıra.

## 6. Riskler / emin olunmayanlar

- R1: Operatörün TOTP sırrı çözülemezse (anahtar sorunu) step-up imkânsız olur → operatör hassas işlemi yapamaz. Bu bilinçli güvenli yön; acil çare
  anahtarı kapatmak (env). Kurucuya bilgi.
- R2: Saat kayması: `verifyTotpStep` ±1 adım (bugünkü girişle aynı); ek risk yok.
- R3: Ortak günlük sayaçta bakış / sayım ayrı (§2.3) — bu tasarım yeni bir açık getirmez, var olanı devralır. Düzeltmesi ayrı iş (Codex'in giriş
  bulgusuyla aynı sınıf).
- R4: Çalınmış çerez + çalınmış TOTP cihazı birlikteyse bu kapı korumaz (tasarımın kapsamı dışında; doğru).
- R5: `trial-end` rotasında denetim kaydının iş fonksiyonunda yazıldığını varsaydım; rota dosyasında doğrudan kayıt görmedim — emin değilim.
- R6: `export` GET'in panel formu dışında (komut satırı) kullanılıp kullanılmadığını bilmiyorum; belirteç zorunlu olunca o yol da önce POST ister.
