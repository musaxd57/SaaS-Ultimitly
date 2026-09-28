# Güvenlik kontrolleri envanteri (28 Eylül 2026)

> Amaç: Airbnb başvurusu öncesi "ciddi güvenlik katmanı" ve "entegrasyon dosyası" kapıları için TEK yerde, kod kaynaklı ve dürüst
> bir envanter. Başvuruda kullanılacak İngilizce metin bundan çevrilir. **Sertifika yok** (SOC 2 / ISO 27001 / bağımsız sızma testi
> yok) — aşağıdakiler kodda doğrulanmış kontrollerdir, denetim raporu değildir. Kaynak: CLAUDE.md kalıcı kararları + 27–28.09 gece
> denetimleri (e-posta, SSRF, toplu atama / kiracılar arası erişim, personel sayfaları, halka açık uçlar, bürünme, sayfa sorgularının
> kiracı kapsamı, sunucudan tarayıcıya veri, gece kodunun düşmanca incelemesi).

## 1. Kimlik doğrulama ve oturum

| Kontrol | Nerede | Not |
|---|---|---|
| İki adımlı doğrulama (TOTP, RFC 6238) + kurtarma kodları | `src/lib/auth/totp.ts`, `api/account/2fa` | kullanıcı açar; operatör (süper-admin) yetkisi 2FA'lı oturum ister (`isSuperAdmin` = izin listesi + `mfa: true`) |
| Parola: bcrypt maliyet 12, NFC, en çok 72 bayt, eşzamanlılık kapısı (aynı anda 2 iş, taşarsa 503) | `src/lib/auth/password.ts`, `password-policy.ts` | eski maliyet-10 hash başarılı girişte yükseltilir; başarısız doğrulamada zamanlama eşitliği |
| Oturum: JWT HS256 (algoritma sabit), `__Host-` çerez, httpOnly + Secure + SameSite=Lax, 14 gün kayan | `src/lib/auth/session.ts`, `index.ts` | `sessionEpoch` ile toplu iptal (şifre / 2FA değişimi diğer oturumları düşürür) |
| Oturum içi yeniden doğrulama (2FA kurulum/kapatma, hesap silme) günde 20 hata tavanı | `src/lib/auth/reauth-guard.ts` | doğru şifre de tavan dolunca reddedilir |
| Giriş / kayıt / sıfırlama hız sınırları (IP /64 kovası + hesap kovası) | `src/lib/rate-limit.ts`, `api/auth/*` | JSON kontrolü kovadan önce (başka site ziyaretçinin kovasını yakamaz) |
| E-posta doğrulama ve şifre sıfırlama: tek kullanımlık belirteç adres çubuğunda değil parçada (`#t=`), POST + parola | `api/auth/verify-email`, `lib/auth/password-reset-challenge.ts` | numaralandırma korumaları |
| Başka siteden istek (CSRF): SameSite=Lax + durum değiştiren uçlarda `application/json` zorunlu | `src/lib/api.ts` `readJsonCapped` | OAuth akışında durum parametresi oturuma ve org'a bağlı (`api/hospitable/oauth/*`) |

## 2. Yetkilendirme ve kiracı izolasyonu

| Kontrol | Nerede | Not |
|---|---|---|
| Her API ucu org kapsamlı ya da gerekçeli halka açık listede (mekanik pin) | `tests/unit/api-route-scoping.test.ts` | süper-admin uçları davranışsal pinli |
| Rol kapısı pini: personelin (temizlikçi) erişebildiği 4 uç, yalnız-sahip 13 uç, kendi kapısını taşıyan uçlar kapalı listede | `tests/unit/api-route-role-gate.test.ts` | işleyici başına, sözdizim ağacıyla |
| Kiracılar arası davranışsal testler reddin SEBEBİNİ sınar (404/403) | `tests/integration/cross-tenant-handlers.test.ts` | "2xx değil" yetmez |
| Sayfa sorguları (23 sayfa + yardımcılar) org süzgeçli; ayrıntı sayfaları kimliği org süzgeciyle arar (yoksa 404) | gece denetimi 28.09 | açık bulunmadı |
| Personel yalnız Görevler'i görür; görev görünümü misafir adı / mesajı taşımaz | `src/middleware.ts`, `lib/tasks/staff-view.ts` | ⚠️ sayfalar rolü kendisi kontrol etmiyor → rol değiştiren akıştan ÖNCE sayfa düzeyinde kapı (karar K10-m) |
| Operatör bürünmesi: izin listesi + 2FA'lı oturum, her istekte yeniden doğrulama; bürünmüşken şifre / 2FA / hesap silme kapalı | `src/lib/api.ts`, `lib/admin.ts` | ⚠️ ödeme uçları ve bazı yazmalar iz bırakmıyor, süre sınırı yok (karar K8) |

## 3. Veri koruma

| Kontrol | Nerede | Not |
|---|---|---|
| Saklanan sırlar AES-256-GCM (+ ek doğrulanmış veri): sağlayıcı belirteçleri, takvim besleme adresleri | `src/lib/crypto-core.ts` | anahtar DB yedeğinden ayrı kasada; rotasyon yapılmaz (belgeli) |
| Aktarım: HTTPS, HSTS (2 yıl, alt alan adları), güvenlik başlıkları (nosniff, frame, referrer, permissions, COOP/CORP) | `next.config.mjs` | CSP zorlanan kısım + rapor-yalnız kısım (script-src henüz zorlanmıyor) |
| API yanıtında gizli / iç alan yok (mülk belirteçleri, QR PIN / cihaz bağlama özetleri) | `api/properties`, `lib/reservation-view.ts` | 28.09 denetimi |
| Yüklemeler özel depolamada, imzalı ve org'a bağlı erişim; sihirli bayt kontrolü, SVG/HTML yok | `api/upload`, `api/storage/photo/[...key]` | fotoğraf bağlantısı yalnız göreli ve bu org'un |
| Veri dışa aktarma (KVKK) izin listeli, sırları içermez | `src/lib/data-export.ts` | yalnız sahip |
| Günlüklerde merkezi redaksiyon (e-posta, telefon, belirteç); ham hata `console`a verilmez | `src/lib/redact.ts`, `log-sink-redaction-pin.test.ts` | |

## 4. Girdi ve dış istek güvenliği

| Kontrol | Nerede | Not |
|---|---|---|
| Gövde boyut tavanı ve içerik türü kontrolü | `readJsonCapped` | halka açık uçlarda da |
| Kiracının verdiği adrese istek YALNIZ takvim beslemesi: yalnız HTTPS/443, özel adres engeli (IPv6 eşlemeli dahil), sabitlenmiş DNS, yönlendirme yok, 10 MB, zaman sınırı | `src/lib/net/pinned-fetch.ts`, `private-host.ts` | SSRF denetimi 28.09: açık yok |
| Açık yönlendirme yok (izin listeli taban adres, `?next=` doğrulaması) | `lib/auth/email-verify.ts`, `lib/safe-redirect.ts` | |
| Güvensiz ham SQL yok; kullanıcı içeriği HTML'e ham basılmıyor; e-posta şablonları kaçışlı, konu tek satır | `lib/email-templates.ts`, `lib/email-core.ts` | |
| Halka açık QR sohbeti: tahmin edilemez belirteç, konaklama başına cihaz bağlama (httpOnly çerez), hız sınırı, mesaj tavanı | `api/chat/[token]` | devir kontrolü tek satır (28.09) |

## 5. Yapay zekâ güvenliği (ürünün kalbi)

| Kontrol | Nerede |
|---|---|
| Otomatik gönderim kararını KOD verir (model güveni tek başına mesaj gönderemez) | `passesAutoReplySafetyGate` |
| İstem enjeksiyonu: veri ayraçları, sahte ayraç / geçmiş etiketi vetosu, bilgi tabanı talimat süzgeci (`detectKbInstructionHijack`), anlam katmanı istemlerinde çit temizliği | `ai/fallback.ts`, `ai/kb-fetch.ts`, `ai/semantic/fence.ts` |
| Sırlar konaklama durumuna göre süzülür (onaylı konaklama dışında Wi-Fi / kapı kodu modele gitmez); ham ve ad yerleştirilmiş metin ayrı taranır | `lib/guest-chat.ts` `kbForStayScope`, `withoutSecretKbItems` |
| Misafire "bilgim yok", makbuzsuz söz, bekleme sözü, yer tutucu gitmez; saat çelişkisi ve ödeme yöntemi süzgeci | `ai/absence.ts`, `ai/output-veto.ts`, `ai/time-conflict-gate.ts`, `lib/payment-method-guard.ts` |
| Anlam modellerine giden metinde kişisel veri redaksiyonu (önce redakte, sonra kırp); misafir adı ev sahibi bilgisine yalnız ad biçiminde | `ai/semantic/redact.ts`, `kb-placeholders.ts` |

## 6. İzleme, olay ve iz

- Hata bildirimi (Sentry + e-posta) merkezi redaksiyonla; periyodik işlerde geçiş tabanlı alarm (alarm seli yok) — `lib/report-error-core.ts`, `lib/alert-state.ts`.
- Denetim kaydı: ayar değişiklikleri (alan adları), bürünme başlangıç/bitiş, dışa aktarma, misafir verisi silme, bağlantı değişiklikleri — `lib/audit.ts`.
- Yapay zekâ karar kaydı (`RiskEvent`): her otomatik / tutulan cevabın kapalı-küme gerekçesi, kişisel veri taşımaz.

## 7. Tedarik zinciri ve altyapı

- Zafiyet kapısı: `npm audit` sıfır TRİAJSIZ bulgu (triyajlı kayıtlar son kullanma tarihli), altyapı arızasında kapalı — `scripts/audit-check.mjs`, `security/audit-baseline.json`.
- İki aşamalı, root olmayan kapsayıcı imajı (Node 22) — `Dockerfile`.
- Her yayın: tam test paketi (~10.100 test) + tip + lint + derleme + zafiyet kapısı; CI yeşil değilse yayın atlanır (Railway "Wait for CI").

## 8. KVKK

- Saklama süresi (misafir verisi 24 ay sonra temizlenir), misafir verisi silme (bayraklı, avukat imzası bekliyor), dışa aktarma, kayıt onayı — `lib/data-retention.ts`, `lib/erasure.ts`.

## 9. Açık kalanlar (dürüst liste)

- Bağımsız sızma testi, SOC 2 / ISO 27001 hazırlığı YOK; haftalık otomatik zafiyet denetimi zamanlayıcısı canlı değil (runbook hazır).
- `security@lixusai.com` posta kutusu açılmalı (güvenlik açığı bildirim sayfası ona yönlendiriyor).
- CSP'nin script-src kısmı zorlanmıyor (ölçüm → nonce → zorlama sırası belgeli).
- Kurucu kararı bekleyenler: `docs/SABAH-KARARLARI-2026-09-28.md` K8 (bürünmüşken ödeme / iz / süre), K10 a–s (takvim beslemesi penceresi, Dependabot hedef dalı, giriş kapasitesi, QR PIN, CSRF ek katmanı, oturum ömrü / PKCE, repo görünürlüğü, bürünme izi, şifre sıfırlama günlük tavanı, iletişim formu e-posta tavanı, Paddle webhook ön kısıtı, QR acil e-postası bekleme süresi, sayfa düzeyinde rol kapısı, QR devir dizini, misafir adının ev sahibi bilgisine girmesi — karakter süzgeci harf sınıfını kapatamaz, önizlemenin bütçe çarpanı, deneme süresi istismarı, oturumlu kullanıcının tetiklediği bildirim e-postası tavanı, misafirden türeyen metnin istemdeki etiketi).
