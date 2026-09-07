# TEST-EVIDENCE CONTRACT — bağlayıcı kanıt sözleşmesi

> **Kısa, merkezî, bağlayıcı.** Davranış değiştiren her değişiklik bu belgeye
> tabidir. CLAUDE.md'nin "ÇALIŞMA TARZI" bölümü buraya bağlanır. Sürüm: 2026-09-07.
>
> **Tek cümlelik özet:** *CI'nın yeşil olması kanıt değildir; kırmızı-önce test +
> iki yönlü mutasyon + gerçek sınırlarda entegrasyon + kritik akış = kanıt.*

---

## 0. Doğrulanmış başlangıç durumu (2026-09-07, HEAD `73dbfb4`)

Belge var olmayan bir korumayı varmış gibi yazmaz. Ölçülen:

| Konu | Durum | Kanıt |
|---|---|---|
| `npm test` | `prisma generate && vitest run` → **tests/unit + tests/integration + tests/ui birlikte** | `package.json:15` |
| CI `verify` job'ı | `npm test` koşuyor → integration süiti CI'da **koşuyor** (Postgres kuruluyor) | `ci.yml:100-101` |
| CI `e2e` job'ı | Playwright smoke (`security-controls.spec.ts`, `smoke.spec.ts`) | ayrı job |
| Kritik akış matrisi | **Yoktu** — bu belge ile ilk kez merkezîleşti (↓§3) | — |
| Mutasyon kanıtı | **CI'da YOK ve olmayacak** — çalışma ağacı ritüeli; kayıt yeri tur raporundaki kanıt tablosu (↓§4) | tasarım kararı |
| Kırmızı-önce | Geçmişte uygulanmış (git log), ama **bağlayıcı kural değildi** — artık §2 | — |

⚠️ **Yeni bir CI job'ı EKLENMEDİ ve eklenmemeli.** CI zaten tam integration + e2e
süitini koşuyor; "kritik akış" adıyla tekrar eden boş bir job sahte güven üretir.
Kritik akış koruması **gerçek test dosyalarına** haritalanır (§3).

---

## 1. Risk kademeleri — kural değişikliğin sınıfına göre

| Kademe | Kapsam | Zorunlu kanıt |
|---|---|---|
| **K0 — davranışsız** | belge · yorum · biçimlendirme · görünmeyen metin | Yeni test gerekmez. **Ama:** görünen metne bağlı mevcut test beklentileri güncellenir; "test gerekmiyor" kararı **raporda açıkça gerekçelendirilir**, sessiz verilmez. |
| **K1 — davranışsal, güvenlik-dışı** | UI akışı · rapor hesabı · kopya · sıralama | Kırmızı-önce hedef test + kaldırma mutasyonu + tam kapılar. |
| **K2 — güvenlik / veri / para** | auth · 2FA · session · tenant isolation · billing/entitlement · veri yaşam döngüsü (export/deletion/retention/tombstone) · provider/sync/webhook/iCal · AI gönderimi · storage · operatör rotaları · bug fix'in tamamı | **§2'nin TAMAMI zorunlu.** |

Şüphede kal → **K2**.

---

## 2. K2 için zorunlu kanıt zinciri

1. **Kırmızı-önce.** Düzeltmeden ÖNCE gerçek kusuru yeniden üreten hedef test
   yazılır ve **doğru assertion nedeniyle** kırmızı olur. Derleme hatası ya da
   ilgisiz bir hata "kırmızı" sayılmaz.
2. **Hedef unit testi** — saf fonksiyon varsa.
3. **Hedef integration testi** — değişiklik bir sınır aşıyorsa. **Karar mekanizması
   mock'lanmaz:** rota+auth+DB, worker+DB+provider-fake gibi gerçek sınırlar birlikte
   koşar. (Emsal: `admin-superadmin-gate.test.ts` — `isSuperAdmin` bilerek
   mock'lanmadı; yalnız oturum enjeksiyonu ve çerez yazan fonksiyon mock'landı.)
4. **Etkilenen kritik akış testi** (§3) yeşil kalır — ya da o akış için yeni bir
   kırmızı test eklenir.
5. **Mutasyon 1 — KALDIRMA:** koruma/düzeltme kaldırılınca ilgili test kırmızı olur.
6. **Mutasyon 2 — AŞIRI UYGULAMA:** koruma koşulsuz/aşırı geniş uygulanınca
   **kontrol** testi kırmızı olur. (Bu olmadan "her şeyi reddet" mutasyonu yeşil
   geçer; bu depoda üç kez ölçüldü.)
7. **Mutasyon hijyeni:** yalnız çalışma ağacında; commit/push edilmez; **mutasyonun
   gerçekten uygulandığı doğrulanır** (`assert count == 1` / `grep`) — em-dash ve
   kaçışlı `/` yüzünden sessizce no-op olmuş bir perl `s///` iki kez yanlış sonuç
   üretti; sayısı bilinmeyen bir silme ölçüm değildir.
8. **Geri yükleme + tam kapılar:** gerçek kod geri gelir; typecheck · lint · tam test ·
   build · e2e · migration-chain · security-audit **hepsi** yeşil olmadan
   "tamamlandı" denmez.

**Bilinen test-şekli tuzakları (ölçülmüş, tekrar etme):**
- `rejects.not.toThrow(/…/)` hiçbir şey tutmaz → `try/catch` + mesaj sına.
- `it(ad, {timeout}, fn)` bu vitest'te yok sayılır; konumsal `it(ad, fn, ms)` de
  **senkron CPU yanmasını kesemez** (zamanlayıcı olay döngüsü ister). Süre ancak
  fark ~1000× ise ölçülür.
- Çapa arayan `indexOf` −1 dönerse `slice(-1)` son karakteri verir → assertion boşa
  düşer; çapa `toBeGreaterThan(-1)` ile pinlenir.
- Kaynak taraması **tek yönlüdür**: aşırı uygulamayı hiç, eksik uygulamayı ancak
  yazarın hayal ettiği biçimde görür. Davranışsal testin yerine geçmez.
- Değer-biçimli regex'e (e-posta/telefon) takılan bir fikstür, **yapısal** yolu izole
  etmez; yapısal yolu sınamak için hiçbir regex'e takılmayan girdi (bir AD) kullan.

---

## 3. Kritik akış matrisi — GERÇEK test dosyalarıyla

Her satır "bu akış hangi dosyalarla korunuyor" sorusunun ölçülmüş cevabıdır.
Durum: ✅ davranışsal kapsam var · ⚠️ kısmî (boşluk yazılı).

| Akış | Koruyan dosyalar (tests/…) | Durum |
|---|---|---|
| **Login · hesap kilidi · zamanlama paritesi** | `integration/login-route`, `login-account-lockout`, `unit/forgot-password-timing-parity` | ✅ |
| **2FA (TOTP tek-kullanım, kurtarma, operatör sıfırlama)** | `integration/account-2fa-route`, `two-factor-recovery`, `admin-reset-2fa`, `unit/totp` | ✅ |
| **Şifre sıfırlama (challenge, fragment token, faz-3 sözleşmesi)** | `integration/password-reset-challenge`, `forgot-password-route`, `forgot-password-phase3-contract` | ✅ |
| **Session revocation (epoch, trusted-device iki-epoch, çıkış, DB arızasında sayfa yolu)** | `integration/session-epoch`, `trusted-device-login-wiring`, `logout-clears-trusted-device`, `unit/trusted-device`, `require-auth-failclosed` (F06: DB hatasında `mfa` düşer, impersonation çıkar) | ✅ |
| **Tenant isolation · admin export · impersonation** | `integration/admin-superadmin-gate` (davranışsal), `exit-impersonation`, `impersonation-superadmin-revoke`, `unit/api-route-scoping` (yapısal), `api-secret-exposure` | ✅ — ⚠️ `api-route-scoping` metin taramasıdır; "doğru değişkenle mi filtreliyor" sorusunu ~19 çapraz-org 404 entegrasyon dosyası yanıtlar |
| **OAuth · ChannelConnection yaşam döngüsü (bağlanma · refresh çift CAS · disconnect/reconnect · revoke · backfill · 401/403 → auth_revoked)** | `integration/hospitable-oauth`, `hospitable-oauth-context`, `hospitable-credentials` (F04), **`channel-connection-lifecycle`**, **`channel-connection-migration`** (backfill + legacy kuyruk paritesi), **`outbox-connection`** (V0.3: damga · park · PAT revoke+audit · OAuth refresh zorla · kiracı↔bağlantı) | ✅ |
| **Provenance (V0.4, migration 50): `connectionId` yalnız kanıtla (ingest / gözlemle NULL→X, asla ez), `ingestedAt` = ilk alınma (değişmez), çıkarım backfill YOK, adoption ≠ kanıt, dedupe bağlantı çelişkisi ayrı kova** | **`integration/provenance-ingest`** (Hospitable her iki yön · ilk alınma değişmezliği: değişmeyen VE değişen tekrar senkron · env fallback → bağlan → kaldır · adoption ≠ kanıt / gözlemlenen `observed` / pencere dışı `legacy` · iCal/.csv/QR unbound · enqueue Message damgası), **`unit/provenance-classes`**, **`integration/conversation-dedupe-dryrun`** (+5 provenance: `connection_conflict` · NULL↔dolu · zaman farkı ≠ çelişki · `message_connection_conflict` ≠ içerik · tam kopya), `unit/scrub-scope-parity` (kanarya kararı) | ✅ |
| **Test harness güvenliği (disposable DB kanıtı)** | `unit/test-db-guard` (gerçek `global-setup`, child_process mock — F08), `unit/db-guard` | ✅ |
| **Provider sync · polling** | `integration/hospitable-sync`, `sync-conversation-identity-lock`, `sync-p2002-retry-scope`, `alerts-survive-sync-failure` | ✅ |
| **Webhook (Paddle imza, idempotency, ordering)** | `integration/paddle-webhook`, `paddle-webhook-signature-alarm` | ✅ |
| **iCal (SSRF, rebind, feed-disappearance, URL şifreleme)** | `integration/calendar-sync`, `calendar-source-hardening`, `scheduled-ical-sync`, `feed-disappearance`, `calendar-url-encryption`, `unit/pinned-fetch`, `private-host` | ✅ |
| **Inbound → sınıflandırma/AI → outbox/send → audit** | `integration/auto-reply-channel` (gate + outbox satırı), `ai-output-schema-autosend` (GERÇEK parser + gerçek `applyChannelAutoReply`, yalnız OpenAI HTTP'si sahte — F01), `outbox` (worker), `outbox-delivery-race` (teslim ACK ↔ yeni inbound/problem — F05), `delete-cancels-outbox` (silme → kuyruk iptali + varlık/kiracı vetosu — F03), `outbox-ops` (audit), `conversations-reply-route`, `escalation-model-path-claim`, `unit/golden-scenarios` (~105 kapı senaryosu), `unit/ai-output-schema` | ⚠️ **Parça parça korunuyor; TEK bir uçtan uca test yok** (inbound → gate → outbox → teslim → audit aynı testte). V0/AI turunda kırmızı-önce eklenecek. |
| **Paddle · billing · entitlement** | `integration/plan-change-route`, `billing-consent-route`, `billing-portal-route`, `account-delete-billing-guard`, `unit/billing`, `plan-change`, `paddle` | ✅ |
| **Export · deletion · retention · tombstone** | `integration/account-export`, `data-retention`, `retention-message-age-anchor` (F07: yeniden-temizlenebilirlik bacakları + sonlanma + bayrak-kapalı parite), `erasure`, `erasure-outbox-revival`, `guest-chat-erasure-gate`, `task-description-scrub`, `unit/scrub-scope-parity` | ✅ — ⚠️ `scrub-scope-parity` DAL düzeyinde kördür; dal-düzeyi pinler ayrı dosyalarda |
| **QR / KB sır sınırı** | `unit/qr-secret-scan-coverage` (F02: içeriğin tamamı, fail-closed üst sınır), `secret-detection-golden`, `integration/prebooking-kb-secret-gate`, `unit/style-profile-channel-scrub` | ✅ |
| **Private upload · yetkisiz obje erişimi** | `unit/upload-hardening`, `integration/storage-wiring`, `storage-foundation` | ⚠️ Servis rotasının **çapraz-kiracı 404**'ü davranışsal olarak yalnız `orgIdFromKey` seviyesinde pinli; rota+oturum+DB ile uçtan uca test yok. Prod smoke 2a/2b manuel geçti (08-09). |
| **CSP rapor ucu** | `integration/csp-report-route` | ✅ |
| **Giden-mesaj dispatch sınırı (Channel Layer, V0.1–V0.2)** | `integration/outbound-dispatch` (worker varsayılan deps + `sendOnChannel` + gerçek `sendDueWelcomes` + elle yanıt rotası, sızıntı dedektörü), `messaging` (shadow-compare), `unit/core-channel-independence` (yapısal pin), `outbound-classification-parity`, `outbound-dispatch-guards`, **`unit/outbound-adapter-conformance`** (aynı 14 senaryo: ortak fake ↔ gerçek adaptör/fetch stub), **`integration/outbound-fake-flows`** (yinelenen istek · belirsiz gönderim → kör tekrar yok · 429/402 · bağlantı kesildi · 401 · kiracı sınırı; sağlayıcı-tarafı `deliveries` sayacıyla) | ✅ |
| **QR guest chat (binding, PIN, erasure, handoff)** | `integration/guest-chat-*` (8 dosya) | ✅ |

**Bilinen üç boşluk** (⚠️ satırları) K2 değişikliği o akışa dokunduğunda **önce
kırmızı testle** kapatılır; sırf boşluk var diye boş bir test eklenmez.

---

## 4. Tur raporu — zorunlu kanıt tablosu

Her davranış değiştiren turun final raporu bu tabloyu taşır (K0 ise "K0 —
istisna, gerekçe: …" satırı):

| Alan | İçerik |
|---|---|
| Kırmızı test ve beklenen hata | dosya + assertion + gözlenen hata metni |
| Düzeltme | dosya:satır özeti |
| Kaldırma mutasyonu | ne kaldırıldı → hangi test kırmızı (sayı) |
| Aşırı-uygulama mutasyonu | ne genişletildi → hangi kontrol testi kırmızı |
| Hedef integration testi | dosya; hangi sınırlar gerçek, ne mock'landı ve neden |
| Etkilenen kritik akış | §3 satırı |
| Tam kapı sonuçları | typecheck · lint · test (sayı) · build · e2e · migration-chain · security-audit |
| Kalan risk | dürüstçe |

Ayrıca her rapor **KOD / CI / DEPLOY / PROD SMOKE** ayrımını yazar; kod yazıldı
diye hiçbir şey "prod'da tamamlandı" gösterilmez.

---

## 5. Migration içeren değişiklikler

Yerelde `prisma migrate diff` ile üretilir, taze PostgreSQL'de 00→N zinciri ve
sıfır drift doğrulanır (CI `migration-chain` job'ı da bunu yapar). **Taze
doğrulanmış `pg_dump` ve açık prod onayı olmadan** migration içeren commit
oto-deploy dalına push edilmez. Dolu tabloya `@unique`/required-no-default/drop
eklenmez (boot'ta patlar — chatToken dersi).
