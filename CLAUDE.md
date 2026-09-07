# CLAUDE.md — Lixus AI proje hafızası

> Her oturum başında okunur. Yalnız KURALLAR ve GÜNCEL DURUM. Gerekçeler/ölçümler/tarihçe:
> `docs/history/CLAUDE-2026-09-07-sadelestirme-oncesi-tam-metin.md` (239 KB'lık eski hâl, aynen)
> + `docs/history/CLAUDE-2026-07.md` / `CLAUDE-2026-08.md` + `git log`.
> Kanıt sözleşmesi: `docs/TEST-EVIDENCE-CONTRACT.md` (BAĞLAYICI). Plan: `ROADMAP.md`.
> Denetim turu: `docs/audit-2026-09-05/` (`DURUM.md`). V0: `docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md`.

## Ürün
**Lixus AI** (lixusai.com) — Türkiye odaklı, çok kiracılı SaaS; kısa dönem kiralama hostlarının
Airbnb/Booking misafir mesajlarını AI ile yanıtlar. Operatör: musaxd57 (Nuve, ~10 daire). Türkçe
öncelikli. Temel ilke: AI karar-verici değil yardımcı operatör — riskli mesaj hep insana kalır.
Hedef: Hospitable geçici köprü, uzun vadede bağımsız AI-native PMS (V0 belgesi).

## 🚨 Değişmez kural
Çalışan ürün BOZULMAZ. Her değişiklik additive, testli (K2 = kırmızı-önce + iki yönlü mutasyon +
integration + tam kapılar), geri alınabilir. Para/e-posta/kimlik akışı: kullanıcı onayı + ilk
denemeler birlikte. `npm test` + build yeşil olmadan push YOK. PR yalnız kullanıcı isterse.
Bu dosyaya token/anahtar/parola yazma.

## ⚠️ DOKUNMA / DİKKAT
- **`senderName: "GuestOps AI"`** = mesaj sınıflandırma sihirli string'i (automation/reports/sent).
  DEĞİŞTİRME; görünür marka `displaySenderName()` ile map'lenir. Rapor sayımı `senderName OR aiAssisted`.
- **Konteyner reset:** dosyalar eksikse `git fetch origin claude/great-edison-3zqpZ` →
  `git reset --hard origin/claude/great-edison-3zqpZ` → `npm ci` → `npx prisma generate`.
  `reset --hard` YALNIZ bu konteynerde; operatörün klonunda ASLA (`git status --short` → `pull --ff-only`).
- **Migration ZORUNLU:** boot `prisma migrate deploy`. Şema değişince gerçek migration üret
  (`prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma
  --shadow-database-url postgresql://postgres@localhost:5432/shadow --script`; ASLA prod URL), taze PG'de
  sıfır-drift doğrula. Migration içeren push = taze `pg_dump` + açık onay.
- **Dolu tabloya `@unique` / required-no-default / drop EKLEME** (boot'ta patlar). Index + yeni tablo güvenli.
  Büyük tabloya index: `CONCURRENTLY` değerlendir; küçük tabloda düz index (INVALID index riski daha kötü).
- **Repo PRIVATE** → GitHub Actions ayda 2000 dk (~250 push). CI durursa sebep kota olabilir.
- **Git:** commit author `user.email noreply@anthropic.com` / `user.name Claude`; yedek TAG değil BRANCH
  (`backup/stable-YYYY-MM-DD`); commit mesajında backtick yok → heredoc.
- **`crypto-core.key()` sırası `ENCRYPTION_KEY || AUTH_SECRET`.** `*-undecryptable` alarmında ÖNCE
  salt-okuma teşhis (`scripts/diagnose-hospitable-tokens.ts`), SONRA satır silme.
- **ENCRYPTION_KEY ROTASYONU ASLA** (token'lar + 8 takvim feed URL'i kırılır). Anahtar kasada, DB
  yedeğinden AYRI; DB yedeği tek başına kurtarma değildir.
- **APP_URL sabit taban:** e-posta linkleri/OAuth redirect `appBaseUrl()`; tarayıcı redirect'leri
  `baseUrlFromHost` (allowlist). Railway arkasında hiçbir rota `req.url`'den mutlak URL kurmaz.
- **`"https://www.lixusai.com"` literal'i yalnız app-config'de** (tek kaynak pini).

## Teknik mimari
- Next.js 15 App Router · Prisma 6 · PostgreSQL · Railway (branch `claude/great-edison-3zqpZ` oto-deploy,
  "Wait for CI" AÇIK → kırmızı CI deploy'u atlar). Boot: `migrate deploy && npm run start`; prestart
  `scripts/verify-env.mjs` tek env-doğrulama kaynağı. `/api/health` readiness; `?strict=1` ops.
- Multi-tenancy `Organization`; superadmin (`SUPERADMIN_EMAILS`) impersonation ile girer (JWT
  `actorUserId`). Tüm rotalar org-scoped (`api-route-scoping.test.ts` pinler).
- Auth: JWT + `sessionEpoch`; `withAuth/withManage/withOwner` (route-guard.ts); 2FA TOTP; `mfa` iddiası.
- Hospitable: per-tenant şifreli token (`getOrgHospitableToken` TEK fonksiyon; PAT veya OAuth refresh).
  `financials:read` YOK → gelir özelliği bilinçli KALDIRILDI. Env-token fallback yalnız `PRIMARY_ORG_ID`.
- Sync: `SystemLock` "scheduled-sync" + 2 dk in-process cron (`instrumentation.ts`) + `/api/cron/sync`
  (`CRON_SECRET`). Manuel sync `withSyncLock`.
- **Giden mesaj: Channel Layer (`src/lib/channels`, V0.1)** — `sendOnChannel` ve outbox worker
  `dispatchOutbound`'a gider; `hospitable.sendMessage`'ın tek çağıranı `channels/hospitable-outbound.ts`.
- Model: OpenAI `gpt-5.1` (`OPENAI_MODEL`; `DEFAULT_OPENAI_MODEL` kod içi son çare). Değiştirme =
  gönderim hot-path'i rekalibrasyon; yalnız gerçek arıza + A/B. `ai/openai-compat.ts` TEK KAYNAK DEĞİL
  (`ai/index.ts` ve `translate.ts` OpenAI'yi doğrudan çağırır; `openai-request-contract.test.ts` pinler).

## AI güvenlik mimarisi (ürünün kalbi)
- **Tek kaynak:** `src/lib/ai/prompts.ts` + `fallback.ts`; tüm yüzeyler (oto-yanıt, inbox öneri, Ayarlar
  testi, landing demo, QR) buradan. Demoya özel hiçbir şey yok.
- **3 seviye:** düşük risk → oto-gönder · orta (opt-in `autoHoldingReplyEnabled`, default kapalı) →
  deterministik bekletme mesajı + "Sorunlu" + e-posta · yüksek → sessiz taslak + host'a acil mail.
- **Kod kapısı `passesAutoReplySafetyGate`** (karar modele verilmez): source==openai + intent blocklist +
  kelime-ağı çapraz-kontrol (son mesaj + bekleyen mesajlar) + injection vetosu + bilinmeyen-intent clamp +
  yüksek-riskli `riskType` vetosu + `Number.isFinite(confidence)` + ≥0.75. Tek muafiyet: human_request devir.
- **Model çıktısı STRICT (F01):** `riskLevel` yalnız kapalı-küme string, eksik=tanınmayan="high";
  `confidence` yalnız sonlu number (boolean/string/null→0). Şema ihlali `reportError` (throttled).
- **riskType/evidence:** `riskType` 11'lik kapalı set; `usedSources` kodda doğrulanır; `missingInfo` 5×80.
- **GOLDEN SET** (`tests/unit/golden-scenarios.test.ts`, ~105 senaryo): prompt/kelime-ağı değişince
  koşulur; yeni risk sınıfına hem tehdit hem övgü-tuzağı senaryosu eklenir.
- **Görünmez karakter sınıfı = `\p{Default_Ignorable_Code_Point}` + U+2800** (liste değil); `\p{Mn}`'in
  tamamı EKLENMEZ. **Dil paritesi:** `SAFETY_CRITICAL_WORDS` ↔ `KEYWORDS.complaint` dil kapsamı paralel.
  **Kesme işareti kelime sınırıdır** (`'` ve `’`). **Homoglif/NFKC katlama** (`matchCandidates`) yalnız
  karma yazı sisteminde ve EK aday olarak; `normalizeForMatch`'e `\p{Mn}` konmaz.
- **Katlama kuralı:** `includesAnyFold` (3 katlama) YALNIZ kısıtlayıcı dedektörlerde; `isPositiveFeedback`/
  `isClosingAck` beyaz listelerine ASLA. Tedarik: yalnız `REQUEST_NEGATIONS/QUESTIONS` guard'larında.
- **KB sır kapısı:** `withoutSecretKbItems` (içerik sezgiseli, TAM tarama, `SECRET_SCAN_MAX_CHARS` 24k üstü
  fail-closed) + `QR_SECRET_CATEGORIES` kategori bacağı + `verifiedActiveStay`; onaylı konaklamada kod
  vermek ürünün kendisidir. Kalıp bitişiklik şartı (4–8 hane, telefon-devamı koruması); serbest metin izni
  YOK (12 kalemin 6'sını eliyordu). Stil profili 4 yüzeyde de süzülür (`scrubStyleProfileForPublic`).
- Üslup: duygu beyanı/temenni/çelişki/dolgu-soru yasak; "siz"; ben-dili. Çok soruluda uzunluk kuralı ezilir.
- `REPLY_CHAR_CAP` 4.000 (aşılırsa güven 0.5, sessiz kesme yok) ≠ `max_completion_tokens` 2000.
- **Injection kara listesi yapısal olarak yetersiz** (düz parafrazların çoğu geçer); asıl koruma KB sır
  elemesi + source==openai. Yapısal sınıflandırıcı ayrı tur.

## Canlı durum (Railway env'leri — özet)
| Env | Durum |
|---|---|
| `AUTO_REPLY_ENABLED=1` · `REGISTRATION_OPEN=1` · `TRIAL_EMAILS_ENABLED=1` · `LANDING_DEMO_ENABLED=1` · `GUEST_CHAT_ENABLED` · `DATA_RETENTION_MONTHS=24` | açık |
| `BILLING_ENFORCED=true` | deneme bitince ücretsiz sürüm (kilit yok), oto-mesaj kapanır; `PRIMARY_ORG_ID` muaf |
| Paddle PRODUCTION | canlı; gerçek ödeme + in-app upgrade/downgrade doğrulandı; `PADDLE_PLAN_CHANGE_ENABLED=1`; yıllık fiyat env'leri set |
| `OPENAI_MODEL=gpt-5.1` · `SHADOW_AI_ENABLED=1` (`SHADOW_AI_MODEL=gpt-5.6-luna`, `SHADOW_AI_ORG_IDS`=Nuve, anahtar `OPENAI_API_KEY`'e düşer) · supply-ai OpenAI luna | Akash artık HİÇBİR yerde işleyen değil; `SUPPLY_AI_MODEL/BASE_URL` eski Akash değerleriyse SİL. KVKK metinlerindeki Akash satırları avukat paketinden önce güncellenmeli |
| Hospitable OAuth canlı; Nuve aboneliği 402 (veri donmuş, bug değil) | `TRUST_CF_HEADER` EKLEME |
| `TRUSTED_PROXY_HOPS=2` · `SENTRY_DSN` + `ERROR_ALERT_EMAIL` · `EMAIL_OUTBOX_ENABLED=1` · `CALENDAR_URL_CONTRACT_ENABLED=1` (prod'da düz feed URL kalmadı) · `STORAGE_ENABLED=1` (Tigris `lixus-uploads`, virtual-hosted) | kanıtlı canlı |
| `PASSWORD_RESET_CHALLENGE_ENABLED` | artık okunmuyor (Faz 3), silinmesi davranışı değiştirmez |
| BİLİNÇLİ KAPALI | `DURABLE_OUTBOX_ENABLED` · `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` · `UNVERIFIED_SWEEP_*` · `RETENTION_MESSAGE_AGE_ANCHOR` (onay paketi: `docs/RETENTION-MESSAGE-AGE-ANCHOR-ONAY-PAKETI.md`) · `GUEST_ERASURE_ENABLED` (avukat imzası) · `QR_PIN_ENABLED` · `APP_TRUST_BROWSER_TIMEZONE` |

## Fiyat (kullanıcı onaylı, FLAT)
Başlangıç ₺449 (1-2 daire) · Pro ₺899 (3-7) · İşletme ₺1.699 (8-25; `propertyLimit=25`, "25+ → bize ulaşın").
Yıllık = aylık×10 (₺4.490/8.990/16.990). 14 gün tam Pro deneme, kart yok. Kartlar daire sayısı +
kullanım hacmi + destek ile ayrışır; özellik kilidi YOK. USD/TRY ₺46. `legal-entity.ts` dolu.

## Hospitable ortaklığı
Amaç: Lixus müşterisine "sadece-API" paketi (~$7/daire) → $29/ay Hospitable engelini kaldırmak. Gerçekler:
API yalnız ücretli planlarda; Hospitable partnerlerden OAuth vendor flow bekliyor (bizde ana yol; PAT
fallback: my.hospitable.com → Apps → API access → Access tokens, Read+Write). Patrick (07-02): Connect
kapandı, public API+OAuth tek yol, white-label şimdilik yok ("trafik gösterince pilot"); "tek ana hesap →
çoklu host" property-manager modeli mümkün (tenant izolasyonu yeniden tasarım ister — kullanıcı onayı).
Partner Portal partners.hospitable.com. Dürtme yok.

## Mevcut özellikler (tekrar ekleme)
Panel: dashboard (AI özet + onboarding), inbox (AI öner + risk rozeti), Mesajlar, QR Misafir Sohbetleri,
Gönderilenler (+`/sent/queue` outbox ops), Görevler (Kanban), Takvim, İptaller, Mülkler, Bilgi Tabanı,
Şablonlar, Raporlar, sekmeli Ayarlar (Takvim akışı gizliliği, geç çıkış teklifi, 2FA, faturalandırma).
Operatör paneli: müşteri yönetimi + impersonation + Lead CRM + Operasyon Teşhisi + 2FA sıfırlama.
Landing: 3-seviye kartlar + canlı demo. KVKK: export, retention, erasure (bayraklı), kayıt onayı. VDP:
`/guvenlik` + `security.txt` (posta kutusu `security@lixusai.com` açılmalı).

## Çalışma tarzı
- **`docs/TEST-EVIDENCE-CONTRACT.md` bağlayıcı**: K2 için kırmızı-önce · kaldırma mutasyonu · aşırı-uygulama
  kontrolü · integration · tam kapılar; rapor KOD/CI/DEPLOY/PROD ayrı; "test gerekmiyor" gerekçeli.
- **Codex protokolü:** doğruysa uygula, daha iyisini biliyorsan gerekçeyle reddet; son karar karşılıklı.
- **Ajanlar yalnız araştırır/ölçer/doğrular; kodu Claude yazar.** Bol paralel ajan, bulguları kodla doğrula
  (yarısı yanlış), kısa format. Kararı uygula, soru sorma; klişe yok.
- Kalıcı kararlar buraya, gerekçeler git log/arşive.

## Kalıcı kararlar (yeniden tartışma yok — gerekçe: arşiv + git log)
**Denetim/kanıt**
- Codex 2026-09-05 sekiz P1 kapandı (`docs/audit-2026-09-05/DURUM.md`): F08 test DB kapısı
  (`scripts/test-db-guard.mjs`: loopback ∨ `TEST_DB_ALLOW_REMOTE=1` + DB-yorumu işareti + boş-DB
  sahiplenme/`TEST_DB_ADOPT=1`) · F01 strict model çıktısı · F02 tam sır taraması · F03 silme → kuyruk iptal
  + worker `replyVeto` (conversation_gone/message_gone/tenant_mismatch; "Message yok = geçsin" dalı geri
  gelmez) · F04 OAuth persist CAS (blob) · F05 teslim ACK koşullu (yanıttan sonra inbound yoksa; AI `problem`
  kilidini ezmez; `lastMessageAt` ileri-yön) · F06 DB arızasında `mfa` düşer + impersonation çıkar · F07
  retention bacakları (bacak = süpürgenin kendisinin null yaptığı alan). P2 (F09–F18) açık.
- Kaynak taraması tek yönlüdür → davranışsal test; `rejects.not.toThrow(/…/)` kullanma; senkron CPU
  zaman aşımıyla kesilemez; çapa `indexOf` −1 pinle; mutasyon `assert count==1`.
- Ret edilenler: ETag testi (hedef yok) · HTTP/2 parser testi · kanonik-posta-kutusu kayıt limiti ·
  `emailCanonical` kolonu · escalation claim'inin model yolunda geri alınması (regresyon çıktı) ·
  gölge pilotta teslimat takibi/per-org kota · supply türetmenin import TX'ine alınması.

**Kimlik / oturum**
- 2FA aktifliğinin tek koşulu `twoFactorEnabledAt`; bayat secret arıza değil → `/admin` "2FA'yı sıfırla"
  (bayat dalda epoch artmaz). Operatör müşteri hesabında 2FA kuramaz.
- Operatör yetkisi = allowlist + `mfa === true` (`isSuperAdmin`, tek boğaz noktası). `login` `mfa`yı
  2FA'dan yazar; `verify-email` `mfa:false`; impersonation iddiayı taşır. Sayfa yolu `requireAuth`: DB
  arızasında rol staff + `mfa=false`; impersonation çıkar; normal oturum fail-open.
- "Beni hatırla" (trusted-device) iki epoch'a bağlı (2FA + `sessionEpoch`); şifre değişimi/sıfırlama ve 2FA
  sıfırlama güveni düşürür; legacy çerez fail-closed. Sıradan logout epoch bump'lamaz (S1; "her çıkışta tüm
  cihazlar düşsün" per-session `jti` ister = migration).
- E-posta doğrulama: token fragment'te (`#t=`) + `POST` + PAROLA şart (ön-ele-geçirme kapandı); GET'i geri
  getirme. "Zaten hesabın var" maili ayrı `kind`; enumeration korumaları korunur (`SEND_FAILED_503` ortak).
- Şifre sıfırlama m47 challenge modeli: bütçe challenge satırına ait, token fragment'te, `middleware.ts`
  iki liste (`AUTH_PATHS` / `SIGNED_IN_REDIRECT_PATHS`). Faz 3 bitti (eski kod yolu kalktı); Faz 4 (kolon
  drop) SÜRESİZ ERTELENDİ — `pwResetCodeAttempts: 0` yazması zamanlama paritesidir, SİLME. Zamanlama
  paritesi tek bcrypt (`dummyVerifyPassword`); `hashPassword` ile parite YAZMA. Açık UX: bağlantısız
  kod girişi çıkmaz (formda düzelt, rotada DEĞİL).
- `readJsonCapped` `Content-Type: application/json` ister (öz karşılaştırma; virgül ham değerde).
- Login: hesap kovası kilit silahı değil (doğru parola girer); 2FA hesap-başına kota var.
- `GET /logout` CSRF'i, per-session `jti`, halka açık sayfada çerez yenileme → açık tasarım kararları.

**Tenant / rotalar**
- `api-route-scoping.test.ts`: her rota org-kapsamlı ya da gerekçeli public listesinde; `admin/*`
  hepsi superadmin kapılı (`admin-superadmin-gate.test.ts` davranışsal); `REQUEST_DERIVED_ORG_ID` listesi.
- `cron/sync` · `cron/email-outbox` · `leads` davranışsal pinli (`timingSafeEqual` yapısal pin dahil).
- Hız limiti: `pickClientHop` sağdan `TRUSTED_PROXY_HOPS` (Railway 2); az tahmin güvenli, fazla tehlikeli;
  aralık dışı → 1; boot uyarır, durdurmaz. `clientIp` delil kayıtlarında da kullanılır (geçmiş satır
  düzeltilmez). Bütçe doğrulamadan SONRA tüketilir (import/backfill/diagnostics/AI kotası); `leads`
  istisna (anonim). 429 metni süreyi söyler.
- Ayar değişikliği audit'li (alan adları, değerler değil). `properties/[id]` DELETE ve `admin/leads` PATCH
  audit'siz (açık).
- Yükleme: private mimari (imzalı GET, `orgIdFromKey` 404, sihirli bayt, SVG/HTML yok); prod'da yerel
  diske düşüş 503 (`ALLOW_LEGACY_LOCAL_UPLOADS=1` kaçış). Bucket sağlayıcı görünürlüğü operatör adımı.
  `photoUrl` yalnız göreli.
- CSP: enforce'ta `form-action 'self'`, `script-src` enforce EDİLMEZ; report-only'ye `report-uri`
  (`/api/csp-report`: 8KB, 3 MIME, 30/saat/IP, allowlist alanlar, ham rapor saklanmaz, `reportError` YOK,
  daima 204). Enforce sırası: ≥2 hafta ölç → nonce turu → report-only doğrula → enforce.
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
- Redaksiyon yapısal (`report-error-core.ts`): JSON ağacı gezilir, izin listesi deny'den önce, kv regex
  kalır, işlenemeyen aday `[REDACTED_UNPARSEABLE_JSON]`, oversized/budget koşulsuz sabit, `\uXXXX` çözülür.
- Hesap silme Invoice/Consent/AuditLog'u da siler (migration ister, açık). `Organization.plan` kolonu ölü.
- Takvim feed URL'i at-rest şifreli (`urlEnc`+AAD), prod'da düz URL yok; doğrulama yalnız `--post-contract`.

**Mesajlaşma / outbox / sync**
- Claim-then-send her yolda; claim TTL 120 sn; definitive (4xx≠408) → release+retry, ambiguous → claim
  tutulur (`delivery_unverified`, "iletilemedi" DEME); claim-store hatası 503; adopt-and-heal; çeviri
  fail-closed. Tek atış (`retries:0`); POST idempotent değil.
- Durable outbox (bayrak kapalı): kapalı state seti, `ERASABLE_STATUSES` tek kaynak; teslim etkisi üç
  parça (`markConversationDelivered` · `stampLifecycleSent` · `applyHandoffHold`) + healer; devir hold'u
  enqueue'de değil teslimde; 402 → `blocked`, sync başarısında bir kez `pending`. `autoReplyHoldUntil`
  KİLİTTİR, zamanlayıcı değil; `autoReplyAttemptedAt` konuşmanın `lastMessageAt`'inden alınır.
- CLAIM-THEN-NOTIFY: atomik işaret + yan etki → yan etkinin SONUCU okunur; `emailService.send` bildirim
  yollarında KULLANILMAZ (`sendReporting`); `reportError` `throttled/configured:false` başarısızlık değil.
- Escalation üç yol (model · kelime alerts · `applyInboundMessageRules`); m48 triyaj ikinci model çağrısı
  YOK, temizleme yok, `null` yazılır (undefined değil), `isTriageStale` rozeti.
- Yaşam-döngüsü sorguları `calendarSourceId: null` (kanal iCal işaretçisi DEĞİL); elle `.ics` `channel:"ics"`;
  CSV'de yalnız iptal ön eki eşlenir. Bozuk feed: hataya geçişte tek alarm, ham URL/host alarma girmez,
  `BEGIN:VCALENDAR` yoksa `feed_not_icalendar`. "N kaynak işlendi" = o geçişte vadesi gelen (kohort).
- Sync motoru: fencing token + TTL 15 dk; heartbeat ilerleme-tetikli; `renewLock` geçici hata ≠ kayıp;
  `linkProperty` org-kapsamlı; 540 gün geri pencere kısaltılmaz; gövdesiz sağlayıcı mesajı sayacı
  (`messagesUnimportable`); `str()` trimlemez → `!body.trim()`.
- Provider mesajı sessiz atlanır ve imleç ilerler (bilinçli; ölçüm sayacı var).
- Günlük AI kotası oto-yanıtı da sayar; tavana çarpınca konuşma `new` kalır; kart "AI işlemi" der.
- Yeni org 7/24 açık doğar (şema varsayılanı değişmedi); kurucu muafiyeti `limitsForOrg`.
- Plan sınırları POST/PATCH/COPY hepsinde; yalnız büyüme reddedilir; fail-open (kullanım kapısı).
- Şablon yer tutucu ikamesi TEK GEÇİŞ (`replace` + callback); sıralı split/join ASLA.

**Faturalandırma**
- previewToken HMAC + `jti` tek kullanım; apply öncesi re-preview (409 amountChanged); definitive/ambiguous
  Paddle hataları; pending kilidi; `resolveOrgId` providerRef-first; **`CheckoutConsent`e consumedAt EKLEME**;
  `occurred_at` vetosu; portal plan DEĞİŞTİRMEZ (in-app upgrade/downgrade canlı doğrulandı); `canceled`
  plan değiştiremez (`BILLING_ALLOW_CANCELED_PLAN_CHANGE=1` kaçış); geçersiz imza alarm; hızlı dal audit.
- Yıllık = aynı plan kodu (ayrı "pro_yillik" YOK); `annualAvailable` = 3 env; başlık aylık, alt satır
  yıllık tutar (zorunlu); üstü çizili fiyat YOK; yıllıkta plan değiştirme kapalı. Katalog dışı `priceId`
  reddedilir (katalog yapılandırılmışsa). Açık ticari: `paused` grace; reconcile'da plan otoritesi.

**AI / QR / diğer ürün kararları**
- QR: per-stay device binding; `isOpenNow` simetrik; `chatToken` rotasyonu YOK (bilinçli); PIN DoS tasarımı
  var uygulanmadı (bütçeyi cihaza taşıma REDDEDİLDİ). QR rotasında hata sınırı `reportError`.
- AI öneri paneli kapatılabilir, tercih KALICI DEĞİL. Bekleyen misafir mesajları dar taranıyor
  (`HIGH_STAKES_RISK_TYPES` yalnız son mesajda — açık, ↓açık işler).
- Doluluk gece-katı; ikinci kutucuk `sameDayTurnovers`; üçüncüsünü önerme. Kullanıcının geri aldırdığı
  UI: sidebar grupları, yatay tab-strip, zoom 0.95 geri alma — TEKRAR ÖNERME. Sidebar `mt-4` yük taşır.
- Tarayıcı saat dilimine güven `APP_TRUST_BROWSER_TIMEZONE` default kapalı. S3 virtual-hosted, noktalı
  bucket adı reddedilir. E-posta boot kapısı: Resend veya eksiksiz SMTP.
- Tedarik zinciri: zafiyet kapısı = sıfır TRİAJSIZ (`security/audit-baseline.json`, `expires` zorunlu),
  altyapı arızasında fail-closed + retry; Dependabot PR CI (`head_ref` guard); `schedule:` bu repoda
  çalışmaz (varsayılan dal `main`, `ci.yml` yok) → haftalık denetim CANLI DEĞİL (runbook
  `docs/ZAFIYET-KAPISI-ZAMANLAYICI-RUNBOOK.md`); Node 22 (24 değil); iki aşamalı non-root imaj
  (`chown -R node:node /app` yük taşır; `node:22-slim`de openssl apt şart).
- Operatör scriptleri (PG/Windows): en yüksek kurulu pg sürümü, tüm exe'ler aynı klasör, saf ASCII,
  `pg_ctl -s -w`, `initdb --locale=C`, drill `-ExpectCalendarSources` zorunlu.
- SEO/landing dürüstlük: (app) noindex; mutlak iddia yok; "AI yanıtı" değil "AI işlemi".
- .eu açılışı: ayrı deployment (env: `APP_URL`, `APP_LOCALE`, `APP_BILLING_CURRENCY`, `APP_DEFAULT_TIMEZONE`,
  `APP_TRUST_BROWSER_TIMEZONE=1`); Paddle webhook izolasyonu (ayrı hesap ya da org çözümü persist'ten önce)
  kararı ŞART; SEO yüzeyleri `.com`'a sabit (ayrı tur).

## Açık işler (özet — ayrıntı belgelerde)
- **V0 Channel Independence:** V0.1 ✅ (`2034aba`). Sıradaki V0.2 ortak provider fake + conformance kiti
  (migration yok); V0.3 `ChannelConnection` additive migration → onay. Availability Engine / RAG / geniş
  otonom AI V0 bitmeden YOK.
- **Codex P2 (F09–F18)** ilgili modül turlarında. `docs/DENETIM-2026-08-09.md` (27 açık),
  `docs/ACIK-ISLER-2026-08-08.md` (16), `docs/MIGRATION-BEKLEYEN-ISLER.md`.
- Operatör: bucket sağlayıcı görünürlüğü (imzasız URL 403 olmalı) · `weekly-audit.yml` `main`'e ·
  `security@lixusai.com` · retention bayrağı onay paketi · `UNVERIFIED_SWEEP` açılış sırası (dry-run önce) ·
  Railway Pro + PITR lansmandan 2-3 gün önce · mevcut org'ların aktif-saat penceresi (0/0 elle).
- LEGAL (avukat): SELLER etiketi "MERSİS/Vergi No" ama tüzel kişi İtalyan (metne dokunma) · yıllık peşin
  sözleşmede cayma hakkı · alt-işleyen listesi (Akash çıkarılacak) · KVKK standart sözleşme/VERBİS ·
  erasure bayrağı imza sonrası · `LEGAL_VERSION` bump avukat onayıyla.
- Güvenlik tasarım kararları bekleyen: kurtarma kilitleme (kova `email+IP` çiftine) · `paused` müşteri
  grace · reconcile'da yerel plan yazımı · bekleyen mesajlarda yüksek-risk taraması · middleware noktalı
  yol · halka açık sayfada çerez yenileme · `PADDLE_WEBHOOK_SECRET` boot kapısı.

## Durum
**3458 test yeşil (305 dosya) · typecheck/lint/build temiz · CI 5/5 (run #938, `fc399c0`) · 48 migration
sıfır-drift · Railway healthcheck-gated oto-deploy.** Son kod işi: Codex P1 turu (8 commit) + V0.1
(`2034aba`). Prod smoke bu ortamdan yapılamaz; operatör adımları `docs/audit-2026-09-05/DURUM.md`.
