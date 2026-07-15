# CLAUDE.md — Lixus AI proje hafızası

> Her oturum başında otomatik okunur. Kritik bağlam, kurallar, "unutulmayacaklar".
> Plan → `ROADMAP.md`. Ayrıntılı geçmiş → git log. (2026-07-13'te sadeleştirildi;
> eski uzun oturum-anlatıları git geçmişinde durur.)

## Ürün
**Lixus AI** — Türkiye odaklı, çok kiracılı (multi-tenant) SaaS. Kısa dönem kiralama
hostları için Airbnb/Booking misafir mesajlarını AI ile yanıtlar. B2C; bireysel Türk
hostlara satılır. Sahip/operatör: musaxd57 (Nuve, ~10 daire). **Türkçe öncelikli.**
Marka: **Lixus AI** (site: lixusai.com). Temel ilke: AI karar-verici değil, yardımcı
operatör — riskli mesajlar hep insana bırakılır.

## 🚨 Değişmez kural
**Çalışan ürün BOZULMAYACAK.** Her ekleme *additive*, testli, geri alınabilir. Riskli
adımda önce yedek + kullanıcı onayı. Para/e-posta akışına dokunan şeyler kullanıcı
onayıyla ve ilk denemeler birlikte doğrulanarak açılır. Build + `npm test` yeşil
olmadan push etme. PR sadece kullanıcı isterse.

## ⚠️ DOKUNMA / DİKKAT (asla kaybetme)
- **`senderName: "GuestOps AI"`** (automation.ts, reports.ts, sent/page.tsx) = mesaj-
  sınıflandırma SİHİRLİ STRING'i (AI mesajını ayırır). **DEĞİŞTİRME** — eski/yeni DB
  satırları bölünür. Görünür marka "Lixus AI"e rebrand edildi ama bu string aynı kaldı
  (`displaySenderName()` sadece render'da map'ler). Rapor sayımı `senderName OR aiAssisted`.
- **Konteyner reset:** ortam ara sıra eski snapshot'a (365c957) döner; dosyalar eksik/
  tuhaf görünürse PANİK YOK. Kurtarma: `git fetch origin claude/great-edison-3zqpZ` →
  `git reset --hard origin/claude/great-edison-3zqpZ` → `npx prisma generate`. İş hep
  origin'de güvende → **SIK COMMIT+PUSH şart** (edit→hemen commit, pencere açık bırakma).
- **Migration ZORUNLU:** boot artık `prisma migrate deploy` (db push DEĞİL). `schema.prisma`'yı
  elle değiştirince MUTLAKA gerçek migration üret (`prisma migrate diff --from-migrations
  ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --script`), taze throwaway
  Postgres'te sıfır-drift doğrula. Yoksa şema↔DB sessizce ayrışır, deploy'da patlar.
- **Dolu tabloya ASLA `@unique`/required-no-default/drop ekleme** — boot'ta patlar
  (chatToken outage dersi). App-level benzersizlik + findFirst kullan. Index + yeni tablo güvenli.
- **Git:** push author "Unverified" olmasın → `user.email noreply@anthropic.com`, `user.name Claude`.
  Tag push proxy'de çalışmaz → yedek TAG değil BRANCH (`backup/stable-YYYY-MM-DD`).
  Commit mesajında backtick KULLANMA (bash çalıştırıp kelime düşürür) → heredoc kullan.
- **ENCRYPTION_KEY rotasyonu = ASLA** (canlı token'lar kırılır).
- **APP_URL sabit taban (host-injection fix):** e-posta doğrulama linki + OAuth redirect_uri artık `appBaseUrl()` (sabit `APP_URL` env / canonical) kullanır, ASLA request Host'u değil (forged Host → token saldırgan alanına gidiyordu). In-browser redirect'ler (logout/verify/oauth) `baseUrlFromHost` ama artık ALLOWLIST'li (localhost/127/canonical/APP_URL host; gerisi canonical'a düşer). Railway'e `APP_URL` ekle.
- **Railway arkasında hiçbir route `req.url`'den mutlak URL kurmasın** → `baseUrlFromHost(
  req.headers.get("host"))` (localhost redirect bug dersi).

## Teknik mimari
- **Stack:** Next.js 15 (App Router) · Prisma 6.2 · PostgreSQL · Railway. Boot (Dockerfile):
  `prisma migrate deploy && npm run start`. Branch `claude/great-edison-3zqpZ` → Railway oto-deploy.
- **Multi-tenancy:** `Organization`. Operatör (super-admin, `SUPERADMIN_EMAILS`) impersonation
  ile müşteri org'una girer (JWT `actorUserId`/`actorEmail`). ~58 route org-scoped, IDOR yok.
- **Auth:** JWT + `sessionEpoch` (çalınan token şifre-değişince/reset'te düşer — server-enforced).
  `withAuth`/`withManage` HOF'ları (lib/route-guard.ts, ayrı modül — cross-module mock için).
  2FA TOTP (replay-korumalı). Şifre değiştirme 2-adım e-posta kodu (mevcut şifre sorulmaz).
- **Hospitable:** per-tenant şifreli token (`getOrgHospitableToken` = sync/gönderimin TEK
  fonksiyonu). PAT (süresiz) VEYA OAuth (12s access + 90g rotasyonlu refresh, şeffaf yenileme).
  `financials:read` YOK → gelir özelliği bilinçli KALDIRILDI, geri ekleme. Env-token fallback
  SADECE primary org'a (`PRIMARY_ORG_ID`=Nuve `cmpwcnpdz0000oz1yw4wof2o1`).
- **Sync:** cross-instance kilit (`SystemLock` "scheduled-sync") + 2-dk in-process cron
  (instrumentation.ts, `INTERNAL_CRON_DISABLED` ile kapanır) + opsiyonel dış cron
  (`/api/cron/sync`, `CRON_SECRET` header). Hepsi `runScheduledSync`. Manuel sync `withSyncLock`.
- **Gönderim tek-nokta:** `sendOnChannel` (messaging.ts) = ikinci PMS adaptörü buraya takılır.
- **Model:** OpenAI `gpt-5.1` (ucuz, prompt-cache aktif). Değiştirme = gönderim hot-path'i
  yeniden kalibrasyon riski; sadece gerçek arıza + A/B ile değiştir.

## AI GÜVENLİK MİMARİSİ (ürünün kalbi)
**Tek kaynak:** `src/lib/ai/prompts.ts` (sistem prompt + 20 örnek) + `fallback.ts` (OpenAI'sız
deterministik yol + kelime ağları). TÜM yüzeyler buradan: oto-yanıt, inbox AI-öner, Ayarlar
"AI'yı Deneyin", landing demo, QR concierge. Demoya özel hiçbir şey yok.
**3-SEVİYE (kullanıcı modeli):**
- **Seviye-1 düşük risk → OTO-GÖNDER:** wifi/giriş/otopark/çöp/checkout gibi KB'den net konular.
- **Seviye-2 orta risk → opt-in "holding ack":** hafif şikayet (para/güvenlik/tehdit YOK). Host
  `Organization.autoHoldingReplyEnabled` (default KAPALI) açarsa tek deterministik bekletme mesajı
  gider (6 dil; söz vermez, suç kabul etmez, foto/detay ister, host'a devreder). Konuşma YİNE
  "Sorunlu" + e-posta. Açılmazsa landing sözü ("şikayeti otomatik yanıtlamaz") aynen doğru.
- **Seviye-3 yüksek risk → SESSİZ TASLAK + host'a acil mail + "Sorunlu":** şikayet/iade/iptal/
  kötü-yorum tehdidi/platform-dışı ödeme/insan-talebi/güvenlik-acili/injection/ayrımcılık.
**KOD KAPISI (`passesAutoReplySafetyGate`, karar MODELE verilmez):** source==openai + intent
BLOCKLIST + kelime-ağı çapraz-kontrolü + deterministik injection vetosu + bilinmeyen-intent clamp
(→general, conf≤0.5) + yüksek-riskli riskType vetosu + confidence≥0.75. TEK muafiyet: intent VE
riskType birlikte human_request (tasarlanmış devir mesajı + AI 12s susar).
**riskType/evidence (Faz-B):** model çıktısı `riskType` (11'lik kapalı set, kod-clamp), `usedSources`
(kanıt, KODDA doğrulanır — uydurma kaynak düşer), `missingInfo`. UI: öneri paneli/test kartı "İnsan
incelemesi: X" + "Kullandığı bağlam" + "Eksik bilgi"; inbox amber rozet; Raporlar "AI Risk Görünümü
(30g)" kartı. Persist: `Conversation.{skippedReason,lastRiskLevel,lastRiskType}` + `Message.aiSourcesJson`.
**GOLDEN SET** (`tests/unit/golden-scenarios.test.ts`): ~50 sabit senaryo, kapıya bilerek zararsız
0.9-güven verilir → "model yanlış sınıflandırsa bile kod vetolar mı" asserte edilir. **KURAL: prompt/
kelime-ağı değişikliği yapan HERKES golden seti çalıştırır; yeni risk sınıfına hem tehdit hem övgü-
tuzağı senaryosu ekler.** Fallback secret-gate: wifi/checkin/adres KB içeriği SADECE confirmed/
completed konaklamada (QR `verifiedActiveStay` flag'i ile). Üslup kuralları: duygu beyanı yasak,
temenni yasak, çelişki yasak, dolgu-soru yasak, misafire HER ZAMAN "siz", ben-dili (nezaket çoğul).

## MEVCUT CANLI DURUM (env'ler Railway'de AÇIK)
- **`AUTO_REPLY_ENABLED=1`** ✅ (kullanıcı açtı) → otomatik mesaj artık gerçekten gidebilir (org
  toggle + aktif-saat + güvenlik kapısından geçen). ⚠️ İlk gerçek gönderimleri Gönderilenler'den doğrula.
- **`BILLING_ENFORCED=true`** ✅ → 14g deneme bitince TAM KİLİT YOK; org "ücretsiz sürüme" düşer
  (gezer/manuel çalışır) ama oto-mesajlaşma kapanır (`premiumAllowed` tek kapı; grandfathered/
  superadmin=founder hiç etkilenmez). `LimitedModeBanner`. past_due 14g grace (Paddle dunning).
- **Paddle PRODUCTION CANLI** (env=production, canlı key, webhook `www.lixusai.com/api/webhooks/paddle`
  aktif). Sandbox uçtan-uca doğrulandı. ⏳ hazır olunca küçük gerçek ödemeyi birlikte test et.
- **`DATA_RETENTION_MONTHS=24`** ✅ (24 aydan eski misafir PII anonimleşir), **`TRIAL_EMAILS_ENABLED=1`** ✅,
  **`LANDING_DEMO_ENABLED=1`** ✅ (kayıtsız AI demo; IP 6/saat + günlük `LANDING_DEMO_DAILY_CAP` vars.300),
  **`REGISTRATION_OPEN=1`** ✅, **`GUEST_CHAT_ENABLED`** (QR concierge kill-switch).
- **Hospitable OAuth** (`HOSPITABLE_OAUTH_CLIENT_ID/SECRET`) canlı → "Hospitable ile Bağlan" butonu
  çalışıyor (uçtan-uca gerçek hesapla doğrulandı). **`TRUST_CF_HEADER` EKLEME** (origin CF arkasında
  değil, Paddle webhook direkt gelir → default=rightmost XFF doğru).
- **Nuve'nin Hospitable aboneliği bitik (402)** → veri donmuş anlık-görüntü; yenilenince canlı döner (bug değil).

## FİYAT (kesin, 2026-06-16 kullanıcı onaylı) — FLAT tier'ler
**Başlangıç ₺449 (1-2 daire) · Pro ₺899 (3-7) · İşletme ₺1.699 (8-25 daire)**; yıllıkta 2 ay bedava.
Reverse-trial: kayıt → 14g tam Pro ücretsiz (KART YOK, e-posta doğrulama şart), yükseltmezse ücretsiz
sürüme düşer. Flat KALDI (dinamik/mülk-başı REDDEDİLDİ — AI maliyeti ~₺17/daire, marj %75-96; flat-rate
bias + Türk pazarı). İşletme `propertyLimit=25` (canAddProperty + sync-limiti buna bağlı). "25+ → bize ulaşın".
USD/TRY=₺46. **legal-entity.ts [parantez] alanları HÂLÂ BOŞ** (ödeme-öncesi blocker; Paddle MoR satıcı
gösterimi = avukat sorusu).

## 🎯 HOSPITABLE ORTAKLIĞI (kullanıcı direktifi — ASLA UNUTMA)
**#1 SORU:** Hospitable, Lixus müşterilerine özel **"sadece-API / limited" paketi** çıkarır mı? Müşteri
Hospitable panelini kullanmadan, yalnızca Lixus'un çektiği veriyi (property/reservation/message read +
**message:write**) alsın. Amaç: bugünkü **$29/ay Hospitable-app maliyet engelini kaldırmak** (asıl müşteri-
edinme engeli). Fiyat hipotezi ~$7/daire (placeholder). Sıra: ÖNCE fizibilite SONRA fiyat. Pitch: "Lixus
= Hospitable'ı Türkiye'de büyüten dağıtım kanalı" (kazan-kazan).
**Durum (Patrick, 2026-07-02):** Connect KAPANDI (tam mesajlaşma yok, sadece Airbnb-bağlama). **Public API
+ OAuth vendor flow** tek yol (host'un $29 Hospitable aboneliği ŞART). White-label/reseller ŞU AN YOK ("trafik
gösterince pilot konuş" — kapı açık). **YENİ FIRSAT:** Patrick "tek ana hesap altında birden fazla host mülkü
yönetmek mümkün, bariyeri düşürebilir, white-label'lanabilir" dedi → property-manager modeli. ⚠️ Mimari not
(kullanıcı onayı gerek, kod DEĞİL): "tek hesap→çoklu tenant" bugünkü per-org token modelinden farklı, tenant-
izolasyonu yeniden tasarlanmalı. Partner Portal: partners.hospitable.com. Sessizlik normal, 5 iş günü dürtme yok.

## MEVCUT ÖZELLİKLER (var, tekrar ekleme)
Panel: dashboard (AI özet, 6-adım onboarding sağlık kontrolü), inbox (AI-öner + risk rozeti), Mesajlar,
Misafir Sohbetleri (QR concierge, kapalı-doğumlu), Gönderilenler, Görevler (Kanban), **Takvim** (/calendar,
aylık grid), İptaller, Mülkler (readiness "N/5 hazır" rozeti), **Bilgi Tabanı** (6 hazır şablon çipi),
Şablonlar, Raporlar (donut doluluk + AI risk görünümü + risk türleri), Ayarlar (+ "Takvim Akışı Gizliliği" =
iCal feed'de misafir-adı gizleme toggle'ı, default gizli). Operatör paneli: müşteri
yönetimi + impersonation + **Lead mini-CRM** (status/note/followUpAt + WhatsApp linki). Landing: 3-seviye
dürüst senaryo kartları + env-gated canlı AI demo + injection çipi. QR concierge: rezervasyon-penceresi
(aktif konaklama boyunca), secret-free KB, escalate. Returning-guest rozeti (guest.id ile). KVKK: export,
retention/anonimleştirme, orphan-sweep, kayıt onay kutusu.

## ÇALIŞMA TARZI (kalıcı tercih — kullanıcı "ezberle" dedi)
- **CODEX PROTOKOLÜ (kullanıcı, 2026-07-11 — ÇOK ÖNEMLİ):** Codex'in dediklerini ZORLA yapmak zorunda değilsin.
  Doğruysa/mantıklıysa yap; sen daha iyisini biliyorsan GEREKÇENİ AÇIKLA — kullanıcı bunu Codex'e iletir, Codex
  "senin dediğin gibi olsun" derse öyle kalır. Yani: körü körüne uygulama YOK, gerekçeli ret MEŞRU, son karar
  karşılıklı gerekçe üzerinden.
- **BOL AGENT, DURMADAN:** her iş turunda 8-12+ paralel agent (FE/BE/güvenlik/hız/müşteri-gözü/strateji),
  bulguları KOD İLE DOĞRULA (agent ~yarı bulguda yanılır), sadece gerçek+güvenli olanları uygula, sonunda
  tek "karar listesi" sun, soru sorma. ⚠️ Agent raporları uzun → ajanlara "sadece gerçek bulgu, kısa
  format" de (context şişmesin). Limit yakılırsa bulguları CLAUDE.md'ye "sıradaki oturum" olarak yaz.
- **İletişim:** klişeye takılma, önce düşün sonra yaz, ürünü aynı üçlü kalıpla tekrarlama (robotikleşir),
  varyasyon getir. Kararı kullanıcıya değil, uygula ("sen yap").
- **Persist:** önemli kararlar repoya (CLAUDE.md) yazılır — ephemeral web ortamında en güvenilir hafıza.

## 📌 KALICI KARARLAR & MEKANİZMALAR (yeniden tartışma / geri alma YOK — gerekçeler git log'da)
**Migration:** 24 klasör `00_init→23_reservation_amount_decimal`, zero-pad, sıfır-drift doğrulanmış. Test harness `db push` kullanır → migration-chain drift'i TESTTE YAKALANMAZ; yeni migration'da taze PG'de 00→N `migrate deploy` + `migrate diff --exit-code` ELLE (CI'da migration-chain job'ı da var).
**Billing/Paddle (tamam — dokunma):** previewToken HMAC + `jti` TEK-kullanım (SystemLock nonce; başarısız apply release eder) · apply Paddle'a dokunmadan önce tutarı YENİDEN preview edip eşleşme şart (sapma→409 amountChanged) · Paddle hatası **definitive(4xx)=release+retry** vs **ambiguous(5xx/408/network)=nonce tüketik kalır, ASLA ikinci PATCH** → GET-reconcile, değilse 202 pending (webhook settle) · pending kilidi `plan-change-pending:{org}` (atomik claim, holder=hedef priceId; settle yalnız guard-uygulandı VE priceId==holder) · consent freshness imzalı `occurred_at`'e göre (geç retry entitlement kaybettirmez) · `resolveOrgId` providerRef-first, sonra consentId; ham `custom_data.organizationId` sadece legacy fallback (client-supplied, org-binding CONSENT üzerinden) · **CheckoutConsent'e consumedAt/single-use EKLEME** — transaction.completed + subscription.created AYNI consentId'yi sırasız paylaşır, tüketirsen müşteri öder ama entitlement alamaz · webhook occurred_at vetosu `updateMany` WHERE'inde (atomik; bayat event taze durumu ezemez); 5xx→Paddle retry, invalid-sig→401, unparseable→200 · Invoice `@@unique([provider,providerRef])` + `Subscription.customerId` (erasure eşleşmesi) · canceled abone yeni checkout açabilir (`manageable` status!=canceled) · **Paddle hosted portal PLAN DEĞİŞTİRMEZ** (yalnız iptal/kart/fatura — gerçek ₺30 ödemeyle öğrenildi) → in-app upgrade/downgrade `PADDLE_PLAN_CHANGE_ENABLED` (default OFF) + preview-önce-onay (upgrade'de tutar yoksa buton disabled); downgrade HEMEN geçer, fark sonraki faturaya (metin öyle); **upgrade+downgrade KULLANICI HESABINDA CANLI DOĞRULANDI (2026-07-13, flag=1 kalıcı)** · trialing+trialEndsAt=NULL=EXPIRED · founder guard: PRIMARY_ORG_ID asla paywall'lanmaz · grace çapası pastDueSince (ASLA updatedAt).
**DB unique hakemleri (migration 18-20, prod ÖNCE temizlendi):** `Subscription @@unique([provider,providerRef])` (kompozit — Invoice emsali; webhook `orgFromProviderRef` artık `provider:"paddle"` pinli) · `Message @@unique([conversationId,externalId])` · `Reservation @@unique([propertyId,sourceReference])` (NULL'lar distinct → manuel/trial satırlar serbest). **P2002 deseni:** `isUniqueViolation(err, cols)` (db-errors.ts) YALNIZ hedef constraint'i dedupe-hit sayar; yabancı P2002 fırlar. Persist-sonrası dedupe-hit'te konuşma YİNE answered işaretlenir (yoksa claim expire → misafire İKİNCİ mesaj). iCal'de dedupe-hit=skip (başka source'un satırına dokunma). **Task.origin (m17):** manual|system|ai; iptal temizliği YALNIZ system siler; DB default manual=fail-safe; backfill sinyal-bazlı (belgeli residual: başlığı elle değişmiş eski oto-görev manual kalır → iptalde silinmez). **Prod dupe temizliği kaydı (2026-07-13):** pg_dump + preflight → TX-1 (1044 mesaj çifti silindi) + TX-2 (114 rezervasyon çifti birleştirildi: 43 conv + 4 task keeper'a taşındı, amount/currency/guestExternalId coalesce, en-eski-satır korundu) → her ikisi recheck=0.
**Outbound (mesaj gönderimi):** claim-then-send HER yolda (auto/manuel/QR-host) · claim TTL 120s (Hospitable worst-case ~87s) · definitive→release+retry, ambiguous(timeout/5xx)→claim TUTULUR + "konuşmayı kontrol etmeden tekrar gönderme" 502 · claim-store hatası fail-CLOSED 503 · `sendOnChannel` provider mesaj-id döndürür → `externalId`; sync **adopt-and-heal** (aynı-gövdeli id'siz outbound satırını iyileştirir, inbound asla) · translate FAIL-CLOSED: çeviri başarısızsa mesaj GÖNDERİLMEZ (translate() yapılandırılmış sonuç; LRU 200/6h, input 6000 cap).
**Sync motoru:** SystemLock fencing token + TTL 15dk (bilinçli — deep-sync ortada expire olmasın; sorun olursa heartbeat'e geç) · deep-cadence SystemLock'ta (tüm replikalar tek takvim) · reservation UPDATE'te guestName KORUMALI (Airbnb maskesi gerçek adı ezmesin; placeholder sadece create) · retention resurrection guard'ları: scrubbed satıra (ANON_NAME/ANON_ID; konuşma guard'ı REZERVASYONUN ANON_NAME'ine bakar) PII geri yazılmaz + retention-cutoff'tan eski mesajlar re-import edilmez (`retentionCutoff()` tek-kaynak) · linkProperty P2002 log-and-continue · lastMessageAt cursor idempotency.
**iCal:** satırlar kaynağa bağlı (`Reservation.calendarSourceId`; legacy-NULL adoption ATOMİK updateMany) · disappearance-reconcile KAPALI (mass-cancel dersi); STATUS:CANCELLED yalnız KENDİ source satırını iptal eder · fetch: `redirect:"manual"` (0 redirect izlenir → re-validate gereksiz) + 15s timeout + isPrivateHost + fetch-anı `resolvesToPrivate` ön-filtre + **DNS-rebind PIN** (`fetchFeedText` node:https/http + native `lookup`, undici DEĞİL — engine/major-mismatch/container-smoke belirsizliği yok: socket YALNIZ doğrulanmış-public IP'ye bağlanır, TLS SNI/sertifika değişmez; çoklu-yanıtta biri private ise TÜM bağlantı reddedilir, IPv4-mapped dahil; her istek kendi socket'i (`agent:false`=pool yok, rebind sonrası socket-reuse imkânsız), `end`'e kadar tam tüketilir; **timeout=TOTAL wall-clock deadline** (idle değil — slow-drip DoS'u keser) + socket idle timeout) + **streaming 10MB byte-cap** (readBodyCapped) · HTTPS zorunlu (create + SYNC ikisinde; #22: http feed URL'i plaintext credential sızıntısı + TLS-yok rebind → sync artık http'yi de reddeder, legacy http satırı varsa host https'e geçmeli; test transport http'ye izinli) · parser STATUS:CANCELLED okur → yerel iptal + auto-task silinir.
**AI güvenlik (prompts/fallback/gate üstüne ek):** gate `context {history, guestName}` alır — YALNIZ deterministik injection detektörü koşar (risk netleri last.body'de kalır) · `statedCheckoutTime` misafir mesajında DETERMİNİSTİK kanıt şart (`ai/stated-time.ts`; halüsinasyon rezervasyona yazılamaz; TR harflerinde `\b` YOK → `(?:^|\s)`) · usedSources whitelist: property {checkInTime,checkOutTime,name,city,address-varsa} + reservation {guestName,arrivalDate,departureDate,status}; "history" stil-rehberini DE kapsar (prompt sözleşmesi — gevşeklik değil) · çıktı kapları: max_tokens 900 (reasoning 2000), reply/risk/action 2000/300/300, detectedLanguage normalize · guest-name `sanitizePromptValue` · **52KB prompt kısaltma RED** (prompt-cache aktif; kısaltma=hot-path rekalibrasyon) · landing demo `wouldAutoSend` = GERÇEK gate (server-side) · truncated(finish_reason=length)→fallback.
**QR concierge:** per-stay device binding (first-scan atomik claim `chatBoundHash`, rezervasyon başına rotasyon; farklı cihaz→mismatch, geçmiş+model+DB YOK) + host "cihaz kilidini sıfırla" endpoint'i · `isOpenNow` giriş/çıkış SAATİ kapısı simetrik (çıkış günü checkout saatinden, giriş günü checkin saatinden önce/sonra kapalı) · gate `premiumAllowed` (dormant-safe) · mustEscalate backstop'ları (injection/safety/rule_violation/discrimination/human_request/ad) · tavizler: turnover boşluğunda erken tarayan claim=DoS (sızıntı değil) — host reset çözer.
**Auth/RBAC:** sessionEpoch + impersonation actorSessionEpoch · `requireSession` DB fail-CLOSED (throw→null) + DB-yetkili role/org; `requireAuth` oturum fail-open AMA capability staff'a CLAMP · staff 3-katman: ~17 route withManage · task assigned-only + checklist yalnız `done` toggle · middleware exact-`/tasks` · e-posta doğrulama ATOMİK tek-kullanım (updateMany hash-hâlâ-set) · OAuth state {state,orgId,userId} taşır; callback exchange'den ÖNCE session eşitliği (`context_changed`) · **rol değiştiren yüzey YOK** — ekip-yönetimi eklenirse sessionEpoch bump ZORUNLU ŞART · 2FA TOTP atomik burn + timingSafeEqual, fail-closed.
**Boot/deploy/health:** prestart `scripts/verify-env.mjs` = TEK env-doğrulama kaynağı (instrumentation'a doğrulama KOYMA — "Ready ama 500" bug'ıydı); prod'da eksik/placeholder AUTH_SECRET veya eksik/AUTH_SECRET'a-eşit ENCRYPTION_KEY → non-zero exit · railway.json `healthcheckPath=/api/health` (200 gelmeden trafik yok; **startCommand ASLA ekleme** — Dockerfile migrate+prestart zincirini atlatır; pin testli) · `/api/health` normal=readiness (yalnız DB), `?strict=1`=ops (heartbeat eksik/unknown/15dk+ → 503; no-store; reason) — heartbeat=SystemLock("scheduled-sync").updatedAt, iş-yapmayan geçişler de sağlıklı · `guard-local-db.mjs`: db:reset/db:push loopback şart (ALLOW_PROD_SEED=1 kaçış) · seed prod-guard DATABASE_URL-local · CI push-only (main+deploy branch): test + migration-chain + build + e2e smoke (Chromium `/opt/pw-browsers/chromium`).
**KVKK:** `redactSensitive` alan-duyarlı + quoted-branch (virgüllü değer) — code/id/status bare kalır · webhook erasure: custom_data.organizationId + `Subscription.customerId` eşleşmesi; pass-2 BAŞKA org'un satırına asla; redakte satır status:"processed" · outbound gövde ad-redaksiyonu (`\p{L}` lookaround, <3 harf atlanır) · iCal feed'de misafir adı DEFAULT GİZLİ (`icalShowGuestName`) · foto-temizlik hatası reportError'a gider (yutulmaz) · trial-mail başarısızsa claim geri alınır (retry).
**Görev/Supply (Faz A):** akıllı görev İKİ escalation yoluna da bağlı (keyword+model), opt-in `autoTaskFromMessageEnabled` (default OFF), dedupe `{property}:{type}:{topic}:{İst-gün}`, task-only netler GATE'İ BESLEMEZ · supply: profil per-daire × giriş sayısı (AI/misafir-sayısı YOK), stok org-level net (`toBuy=max(0,ihtiyaç−elde)`), +1 `SupplyRequest` opt-in `autoSupplyRequestEnabled` + `@@unique([sourceMessageId,itemKey])`; tavizler: +1 satırı 7g sonra sadece rapor-dışı (silinmez), stok elle güncellenmezse kayar · checklist `buildSupplyChecklist` yalnız YENİ cleaning görevine · Task `@@unique([reservationId,type])` BİLİNÇLİ YOK (manuel 2. görevi bloklar).
**SEO/landing dürüstlük:** (app) layout noindex + robots TÜM (app) dizinleri (fs-drift pin testi) · sitemap /login yok + SABİT lastModified (landing=son içerik değişimi, legal=LEGAL_VERSION) · twitter card "summary" (görsel asset'i yokken large_image bozuk) · TRUST çipleri: "KVKK odaklı tasarım" + "Şikayeti otomatik sonuçlandırmaz" (mutlak iddia YOK) · FAQ opt-in holding-ack'i açıkça söylüyor · fiyat kartları YALNIZ daire sayısı+destekle ayrışır (özellik kilidi YOK — kullanıcı kararı).

## ✅ TARİHÇE — kapanmış turlar (tek satır; ayrıntı git log + commit mesajlarında)
- 07-04: 10-ajan sweep (5 fix) · 8-ajan 1-3 (sync fencing m6 · pastDueSince · occurred_at) · KVKK iCal ad-gizleme (m7).
- 07-05: derin denetim tur-1..5 (kelime-ağı boşlukları · TOTP timing · sync BUG1-3 · impersonation epoch · trial-mail rollback · QR turnover/wifi-secret · CSV sertleştirme · operatör-müşteri login · rule_violation+discrimination netleri · riskLevel fail-closed · seed guard · SEO canonical) · KVKK batch (Sentry redaksiyon · resurrection · webhook PII · "Bu Gece Kalan" · ad-redaksiyonu) · consent-evidence m8 + checkout-consent m9 + fail-closed + legal metinler + #44 KVKK UX + audit-label.
- 07-10: pre-launch 42-ajan workflow (94 bulgu; HIGH: redactSensitive quoted) + migration zero-pad m00-09 prod-fix · akıllı görev Faz A (m10) · hazırlık/supply (m11-13) · 40-ajan lansman + codex örtüşmesi → FAZ-1+2A+2B (requireAuth/requireSession DB-yetkili · 2FA/TOTP · KB-cap · iCal SSRF · consent planCode · founder guard · photoUrl scheme · QR gate) · QR device binding (m14) + reset · staff RBAC 3-katman · Paddle portal v1 + İN-APP plan-change (gated) · codex 3 boşluk (checkout org-binding · canceled kilidi · preview-siz onay) · B3 previewToken HMAC + A1 capability clamp.
- 07-11: 3 billing nüansı (jti tek-kullanım · tutar re-preview · occurred_at freshness) + 2 gap (definitive/ambiguous · providerRef-first) = billing TAMAM · backlog büyük turu 8 commit (manuel-reply claim · adopt-heal · KVKK customer_id m15 · gate geçmiş+ad · Invoice unique · DNS-SSRF · boot fail-fast · İstanbul-ay · rezerve senderName · CI kapıları) · codex kapanış (D2 atomik + E2E smoke — seed emailVerifiedAt regresyonunu İLK koşuda yakaladı) · codex tur-2+4 (staff /tasks sızıntı · iCal mass-cancel m16 · outbound ambiguous · pending kilidi · upload limit · consent withManage).
- 07-12/13: boot-gate #3 (prestart; canlı doğrulandı — AUTH_SECRET placeholder outage'ı bunun eksikliğindendi) · ENCRYPTION_KEY zorunlu · host-header injection (appBaseUrl) · QR saat-kapısı · fiyat metni hizası · #5 strict health (`cbf26f5`) · **codex 40-madde salt-okuma turu: 12 commit** (#4 healthcheck `c4b4cd5` · #9 db-guard `3c2e77a` · #11 verify-atomik `c79bc1b` · #13 OAuth-bağlam `2bd1c18` · #27 demo-verdict `7331915` · #28/29 kanıt `882df5e` · #30 translate `7e64b83` · #7 foto `c560cdb` · #22 iCal `89dade9` · #36-40 dürüstlük/SEO/docs `4d96ffc`); gerekçeli RED: #12 (rol-değişim yüzeyi yok) · #28-history (sözleşme) · #31 (prompt kısaltma). · docs sadeleştirme `4d19b5c` (CLAUDE.md 884→181) · **kolay-kalanlar batch'i:** #34 export metni gerçek allowlist'e (`f923a91`) · #17b mülk-limit yarışı post-create mutabakatı (`735d714` — yarış tek-process'te reprodüse OLMADI, guard multi-replica savunması; test invariant pinler) · #21-lite feed-URL ekran maskesi + account-card field-first (`26af98f`).
- 07-13 (2): **migration turu (m17-21, `6bd46c2`+`aabdf74`):** Task.origin + 3 unique + verify-index + hedefli P2002 companion; taze 00→21 zero-drift + negatif kanıt (dupe veride m19/20 REDDETTİ) + dolu-fixture backfill; 945 test. Task@@unique gerekçeli DIŞARIDA (done→aynı-gün yeniden-açma).
- 07-13 (3): **RiskEvent (m22, `4dfc935`):** append-only karar geçmişi, YALNIZ nihai kod-kararından sonra (dryRun yazmaz, asla fırlatmaz); kapalı-set clamp'ler, keyword yolunda riskLevel=NULL, org FK CASCADE=KVKK, rapor kartı geçmişten sayar.
- 07-13 (4): **para Faz-A (m23, `887e2e9`):** Reservation.totalAmount→DECIMAL shadow `totalAmountDec` (expand-only); okuma Dec-öncelikli (money.ts), rapor geliri Prisma.Decimal. **PG tuzağı: NaN=NaN TRUE** → backfill/healing isimle eler. Cutover healing her sync'te kilitten HEMEN sonra. Faz-B önkoşulu prod reconciliation=0 ✅CANLI.
- 07-14 (1): **Durable Outbox #8 (m29, `23113b6`+`b1ff1f0`+`acdc962`):** enqueueOutbound tek-tx + worker SKIP LOCKED state machine + bounded backoff/seeded-jitter. Codex 7-boşluk (flag-OFF drain · per-conv FIFO+tek-uçuş · UI rozeti · tutucu reconcile · manuel+AI bağlı · teslimde-answered · tenant-izolasyon). Bug: settle() Message.externalId link'inden ayrıldı. Ayrıntı DEPLOYMENT.md §6.
- 07-14 (2): **UZUN OTONOM TUR — FAZ 0-3 + review-fix (`9c70168`·`f50d5fb` m30·`bfa6a1c` m31·`7c97d0a`·`731bddc`):** outbox TAM kapsam (holding-ack + welcome/checkin/checkout via `enqueueProactive`, *SentAt teslimde) + #23 feed-disappearance (m31) + retention TASLAK. CI 4/4.
- 07-14 (3): **Codex tur-6+7 outbox-lifecycle (`e5e4c35`+`14c5d0a`, MIGRATION YOK):** (6) *SentAt yalnız doğrulanmış teslimde (review sahte-damga kaldırıldı) + rollback FENCE `lifecycleOutboxOwns`. (7) **Hospitable 402 = kalıcı `blocked`** (ayrıntı ↑Durum). Kırmızı-önce 7-adım test.
- 07-14 (4): **Outbox ops `/sent/queue` (`e6364a1`, MIGRATION YOK):** owner/manager PII'siz liste + yalnız failed[≠402] tenant-bound retry (`requeueFailedOutbox`); `failed→pending` İNSAN-yolu geri (ayrıntı ↑Durum). 14 test.
- 07-14 (5): **Private storage S3/R2 TEMELİ (`323ca3c`+`9d78be5`+`d8a33ae`, m32, flag `STORAGE_ENABLED` DEFAULT KAPALI):** elle SigV4 + imzalı serve + idempotent silme-kuyruğu + flag-OFF=legacy; StorageDeletion org FK'sız (cascade'den sağ). Review ORTA bulgu: silme choke-point + PATCH org-guard. Ayrıntı DEPLOYMENT.md §7. 31 test.

## ⏳ AÇIK İŞLER (tek birleşik liste)
**[migration — kalan]** para Faz-B/C (Dec'i tek kaynak yap → Float'ı düşür; Faz-B ÖNKOŞULU SAĞLANDI: prod reconciliation=0 CANLIDA doğrulandı 2026-07-13; ~~Faz-A~~ ✅ m23 deploy+backfill canlı) (~~RiskEvent~~ ✅ m22) · **Message.authorType/systemEventType Faz-B (m28 sonrası):** Faz-A=dual-write+backfill+KALICI deriveMessageAuthor fallback (rolling-deploy overlap NULL'ları okumada güvenli; healing=idempotent backfill re-run, 2-dk tarama YOK). Faz-B (authorType NOT NULL / fallback düşür) AYRI migration + ÖNKOŞUL prod `count(Message WHERE authorType IS NULL)=0`. senderName artık yalnız görüntüleme/audit; reports/sent/ui-labels authorType-öncelikli (para semantiği korundu, QR "chat" hariç). · Task `@@unique([propertyId,dedupeKey])` bilinçli DIŞARIDA (semantik: done→aynı-gün yeniden açılabilmeli). ~~conversationId+externalId · propertyId+sourceReference · Subscription provider+providerRef · verify-hash index · Task.origin~~ ✅ m17-21.
**[infra/OPS]** ~~S3/R2 foto (upload sahiplik-bağı + signed URL; local /uploads ephemeral)~~ ✅ TEMEL HAZIR (m32, flag `STORAGE_ENABLED` DEFAULT KAPALI — bucket YOK, kod hazır+testli fake-adapterle; kalan: bucket aç + env + BİRLİKTE ilk-upload doğrula, opsiyonel legacy backfill AYRI tur/[KARAR]) · **durable outbox #8 (m29, flag `DURABLE_OUTBOX_ENABLED` DEFAULT KAPALI):** çekirdek+entegrasyon+Faz-B TAMAM (state machine, FOR UPDATE SKIP LOCKED claim, per-conv FIFO+tek-ucus, bounded backoff+jitter, ambiguous→kör-resend-YOK→review, worker flag-KAPALIYKEN-DE-drain #1, teslimde-answered #6, tenant-izolasyon #7, kalıcı UI rozeti #3). Bağlı yollar: **manuel reply + AI oto-yanıt** (güvenlik kapısından SONRA enqueue; senderName GuestOps AI korunur; QR iç-mesaj HARİÇ). ⏳ ERTELENDİ (migration 30 şart): holding-ack (`markAnsweredOnDelivery` — worker "problem"i "answered"a çevirmesin) + welcome/checkin/checkout (opsiyonel `conversationId` — proaktif, yerel Message/conversation yok + sync-dedup kararı). Açma = para hot-path → İLK gönderimleri BİRLİKTE doğrula. Ölçek notu: durable outbox artık VAR; claim-then-send flag-OFF yolu birebir korunur · dağıtık rate-limit (Redis/DB; bugün tek-replica) · per-org sync kuyruğu (global kilit tenant'ları seri bağlıyor) · ~~iCal DNS-rebind dispatcher~~ ✅ (node:https + validating lookup, undici'siz) + feed-URL at-rest şifreleme (UI maskeleme YAPILDI ✓) · Railway "Wait for CI" + backup/PITR (panel).
**[ürün kararı]** ~~QR per-misafir credential (booking-kanalı PIN)~~ ✅ FAZ 5 (#14: rezervasyona özel PIN, HMAC+pepper, opt-in default OFF `QR_PIN_ENABLED`) · ~~QR escalation e-postası~~ ✅ FAZ 3 (#15, env-gated default OFF `QR_ESCALATION_EMAIL_ENABLED`) · ~~2FA recovery kodları~~ ✅ FAZ 4 (#20, m26) · **QR PIN tek-tık kanal gönderimi (BACKLOG — Hospitable aktifken ilk gerçek gönderimi BİRLİKTE test ederek aç):** host'un kodu misafire kopyalamadan Airbnb dizisine göndermesi; ŞART: yalnız kanal-bağlı rezervasyonlar (externalConversationId var), host önizleme+onayı, idempotent claim-then-send, çift-gönderim koruması, başarısızlıkta PIN'i kaybetmeme, kanal-bağı yoksa/başarısızsa kopyalama fallback'i. Bugün: kopyala-taslak akışı (her rezervasyonda çalışır, gönderim hot-path'ine dokunmaz). · feed-disappearance reconcile (lastSeenAt/missingCount tasarımı) · ~~export'u gerçekten TAMAMLAMA~~ ✅ (#34 TAM: fatura/abonelik + audit + consent + görev-güncellemeleri/foto-linkleri + takvim kaynakları + supply + AI metadata + RiskEvent + ayarlar; secret-tarama pin testli; metin genişletildi) · opsiyonel liste: haftalık ops-özeti · review-isteme · lost-item · misafir dil/konu analitiği · temizlikçi paylaşım linki.
**[düşük]** ~~CSV tırnak-içi-newline parser~~ ✅ (RFC 4180 state-machine, csv.ts; yapısal bozuk→CsvParseError fail-closed 400, satır-eksik→skip; 31/02 rollover reddi; delimiter header'dan; dep YOK) · ~~yanıt-süresi episode-bazlı~~ ✅ (response-episodes.ts; aktivite-scoped + koşu-bazlı, İLK mesaja çapalı) · #46 legalTextHash · OG/Twitter görseli (asset).
**[izle — canlıda doğrula]** AUTO_REPLY ilk gerçek gönderimler + thread'de duplicate yok · **DURABLE_OUTBOX_ENABLED=1 açılışı BİRLİKTE (manuel+AI oto-yanıt outbox'a geçer): ilk gönderimde MessageOutbox pending→sent + Message.externalId dolar + thread rozeti Sırada→İletildi + duplicate yok; review/failed satırı = takılı, elle incele) · safety_emergency false-hold oranı (BİLİNÇLİ AŞIRI-KAPSAYICI: "yangın merdiveni nerede?" bile insana düşer — çok olursa "acil+risk sinyali" kombinasyonuna incelt) · toggle açık org'da smart-task/supply +1 over/under-create · healthcheck'li ilk deploy'lar (Attempt#→Active) · `isGuestMessage` alan-adını gerçek Hospitable payload'la teyit.
**[LEGAL/kullanıcı — kod değil]** SELLER `legal-entity.ts` [parantez] (ödeme-öncesi blocker) · KVKK-DPA: OpenAI ABD aktarımı → DPA + Standart Sözleşme (Kurul 5 iş günü) + host DPA + VERBİS · RESEND domain + SPF/DKIM/DMARC · saklama/erasure politika belgesi (Invoice/Audit cascade vs webhook iskeleti tutarlılığı) · Paddle küçük gerçek ödeme birlikte-test.

## Durum
**1276 test yeşil · typecheck temiz · next build temiz · migrate deploy canlıda doğrulanmış · CI 4/4 yeşil.** 33 migration (00_init→32_storage_deletion_queue) sıfır-drift taze PG'de doğrulanmış. Branch `claude/great-edison-3zqpZ` origin ile senkron; Railway healthcheck-gated deploy AKTİF. Billing "tamam". **Durable Outbox #8 TAM kapsam (m30): manuel + AI oto-yanıt + holding-ack + welcome/checkin/checkout hepsi bağlı** (flag `DURABLE_OUTBOX_ENABLED` DEFAULT KAPALI; QR iç HARİÇ; *SentAt yalnız DOĞRULANMIŞ teslimde; lifecycle veto; **Hospitable 402 = kalıcı `blocked` "abonelik pasif"** [CLAIM edilmez, attempt tüketmez, her pass provider/pager YOK, sync-başarısında `reactivateBlockedOutbox` ile bir-kez pending; geçici outage DEĞİL → diriltme YOK]; rollback-güvenliği sahte SentAt DEĞİL flag-OFF sender'ın outbox kaydına FENCE'i (`lifecycleOutboxOwns` status not:failed→blocked'i kapsar)). **Outbox ops ekranı `/sent/queue`** (owner/manager; PII'siz liste — body/idempotencyKey/claimedBy asla; yalnız failed[≠402] satırına tenant-bound retry; blocked/review salt-okuma açıklamalı; flag OFF'ken geçmiş görünür). **#23 iCal feed-disappearance (m31, flag `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` DEFAULT KAPALI):** 2 ardışık miss + 24h + suspicious/empty-skip + source-binding + per-source lock + stale-ordering, DELETE yok. #35 veri-envanteri TASLAK (`docs/DATA-RETENTION-ERASURE-DRAFT.md`). Kalan işler yukarıdaki AÇIK İŞLER listesinde — çekirdek defalarca tarandı, yeni tur açmadan önce oradan seç.
