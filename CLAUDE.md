# CLAUDE.md — Lixus AI proje hafızası

> Her oturum başında otomatik okunur. Kritik bağlam, kurallar, "unutulmayacaklar".
> Plan → `ROADMAP.md`. Ayrıntılı geçmiş → git log. (2026-07-04'te sadeleştirildi;
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
- **BOL AGENT, DURMADAN:** her iş turunda 8-12+ paralel agent (FE/BE/güvenlik/hız/müşteri-gözü/strateji),
  bulguları KOD İLE DOĞRULA (agent ~yarı bulguda yanılır), sadece gerçek+güvenli olanları uygula, sonunda
  tek "karar listesi" sun, soru sorma. ⚠️ Agent raporları uzun → ajanlara "sadece gerçek bulgu, kısa
  format" de (context şişmesin). Limit yakılırsa bulguları CLAUDE.md'ye "sıradaki oturum" olarak yaz.
- **İletişim:** klişeye takılma, önce düşün sonra yaz, ürünü aynı üçlü kalıpla tekrarlama (robotikleşir),
  varyasyon getir. Kararı kullanıcıya değil, uygula ("sen yap").
- **Persist:** önemli kararlar repoya (CLAUDE.md) yazılır — ephemeral web ortamında en güvenilir hafıza.

## ✅ 10-ajan sweep bulguları UYGULANDI (2026-07-04, commit a6d3713)
1-5 (hospitable OAuth refresh koşullu-clear + transient reuse · reports monthly status filtresi · reports
occupancy İstanbul day-key · calendar "N dolu" Set<propertyId> · paddle status default past_due) **YAPILDI**.
+ Bu turda 8-ajan denetiminden doğrulanıp uygulanan ekstralar: reports.getOccupancyForecast aynı UTC-vs-
İstanbul gün-bucket bug'ı (İstanbul day-key'e çevrildi) · AI GATE: safety_emergency deterministik backstop
(şikayet kelimesi olmayan acil mesaj artık kesin veto) + `rule_violation` HIGH_STAKES set'e eklendi (golden
+4 senaryo) · paddle webhook: sadece "processed" satır gerçek duplicate → received/error satır retry'de
yeniden işlenir (upsert; kaybolan abonelik/fatura mutasyonu engellendi) · inbox/tasks/cancellations sayfaları
tekrarlı query-param (string[]) → tek değere coerce (Prisma/`.trim()` crash guard). **605 test yeşil.**

## ✅ 8-ajan denetimi 1-3 UYGULANDI (2026-07-04, commit b94cd8a — migration 6)
1. **Sync fencing** YAPILDI: `SystemLock.holder` (fencing token) + `releaseLock` `updateMany({where:{name,holder}})`
   ownership-check + TTL 5dk→15dk (uzun deep-sync'in ortada expire olup ikinci sync'i concurrent çalıştırmasını
   önler). acquireLock artık holder döndürür; withSyncLock/runScheduledSync holder taşır.
2. **Paddle past_due grace çapası** YAPILDI: `Subscription.pastDueSince` (ilk past_due geçişinde bir kez set,
   non-past_due'da temizle); `getEntitlement` grace anchor'ı `pastDueSince ?? currentPeriodEnd ?? createdAt`
   (ASLA `updatedAt` — @updatedAt her dunning'te sıçrayıp grace'i sonsuza uzatıyordu).
3. **Webhook occurred_at sıralama** YAPILDI: `Subscription.lastEventAt`; `applySubscriptionEvent` occurred_at'i
   son uygulanandan yeni değilse event'i atlar (bayat event taze active/canceled'ı ezip erişimi ters çeviremez).
Migration `6_sync_fencing_billing_anchors` = 3 nullable kolon, taze Postgres'te sıfır-drift doğrulandı.
**4-ajan adversarial doğrulama:** üçü de doğru onaylandı; +3 güvenli cila (webhook `<` guard, null-providerRef
fatura guard, occupancy delta off-by-one pre-existing) + fencing testi eklendi (commit 1d112f7). 607 test.

## ✅ KVKK iCal PII UYGULANDI (2026-07-04, commit 282cfec — migration 7)
Kullanıcı ürün-kararı: iCal feed'de misafir adı VARSAYILAN GİZLİ. `Organization.icalShowGuestName`
(default false; NOT NULL DEFAULT false → dolu tabloda güvenli backfill, taze Postgres'te sıfır-drift).
`buildIcalEvents(reservations, showGuestName)` `lib/export/ics.ts`'e taşındı (pure, testli — ad kapalıyken
summary "Rezervasyon", description'da SADECE kanal/referans; ad hiçbir yerde sızmıyor). Ayarlar → "Takvim
Akışı Gizliliği" toggle (host isterse açar). 609 test.

## ⚠️ BİLİNÇLİ TAVİZLER — canlıda izle (2026-07-04)
Bu oturumun iki düzeltmesi kasıtlı bir maliyet taşıyor; gerçek kullanımda izle, sorun olursa incelt:
1. **AI güvenlik kapısı AŞIRI-KAPSAYICI:** `passesAutoReplySafetyGate`'e eklenen `detectRiskType(msg)===
   "safety_emergency"` deterministik veto, masum güvenlik-kelimeli soruları da (ör. "gaz ocağı var mı?",
   "yangın merdiveni nerede?") insana bırakır → host beklenenden çok "beklet/Sorunlu" görebilir. Felsefeye
   uygun (riskli=insana) ama gerçek taviz. Çok false-hold olursa: `safety_emergency`'yi bağlam/soru-kalıbıyla
   incelt (bare-word `SAFETY_CRITICAL_WORDS` yerine "acil + risk sinyali" kombinasyonu).
2. **Sync kilidi TTL 5dk→15dk** (`scheduled-sync.ts` `LOCK_TTL_MS`): gerçek bir process çökmesinde sync
   toparlanması 15dk'ya kadar gecikir (eskiden 5dk). Deep-sync ortada expire olup ikinci sync'i concurrent
   çalıştırmasın + duplicate satır olmasın diye bilinçli. Sorun olursa: sabit TTL yerine kilit HEARTBEAT'i
   (org-loop içinde `lockedUntil`'i periyodik uzat) daha iyi çözüm — fencing token zaten mevcut.

## ✅ DERİN DENETİM TURU UYGULANDI (2026-07-05, commit fc6f897 + 14965a3)
5 agent (AI çekirdeği / sync motoru / gönderim-yolu / güvenlik primitifleri) + kod-doğrulama:
- **AI kelime-ağı boşlukları** (fallback.ts, additive+threat-anchored, +5 golden): `iptal ed` (bildirimsel
  iptal t→d yumuşaması), `tazminat` (refund), İngilizce off-platform rayları (bank/wire/money transfer,
  venmo/paypal/zelle/revolut/papara), TR bildirimsel kötü-yorum tehdidi (`kötü/olumsuz yorum yaz/bırak/
  yapacağım`, `düşük puan ver`) → artık review_threat, complaint değil.
- **TOTP** `timingSafeEqual` (kod hep 6 hane; teorik timing-oracle kapandı). **fillPlaceholders** fonksiyon-
  replacer (misafir adında `$&`/`$1` gibi desen kendi mesajını bozmasın).
- **Sync BUG1** (yaygın): app/host cevabı `externalId=null` persist ediliyordu → sonraki sync thread'i tekrar
  çekince aynı mesaj dedup'a takılmayıp DUPLICATE "Ev sahibi" satırı yaratıyordu. `sendOnChannel` artık
  provider mesaj-id'sini döndürüyor (`providerMessageId`); reply/auto-reply/holding-ack `externalId`e yazıyor.
  Sınırlı risk: POST-id≠GET-id ise sadece no-op. ⚠️ CANLIDA DOĞRULA: cevaplar thread'de artık iki kez görünmesin.
- **Sync BUG2**: reservation UPDATE'te `guestName` koşulsuz yazılıyordu (email/phone korumalıyken) → Airbnb
  checkout sonrası adı maskeleyince gerçek ad "Misafir"e geriliyordu. Artık korumalı (placeholder sadece create).
- **Sync BUG3**: per-reservation skip-check DB sorguları sarılı değildi → transient DB hatası mülkün kalan
  rezervasyonlarını abort ediyordu. Null-element guard + try/catch, log-and-continue. **614 test yeşil.**

## ⏳ SIRADAKİ OTURUM — kalan (opsiyonel / karar)
5. **[AI — dikkatli tasarım gerek] `discrimination` + `rule_violation` deterministik net YOK:** `detectRiskType`
   bu 2 sınıfı hiç üretmiyor → tespit %100 modelin label'ında (HIGH_STAKES veto var, ama kod-yedeği yok).
   Örnek: "arkadaşlarım da gece kalacak, sorun olmaz değil mi?" → `sorun olmaz` PROBLEM_NEGATIONS'ta, aktif
   de-flag. Net eklemek İSTENİR ama false-positive riski yüksek (ayrımcılıkta misafirin KENDİ milliyetini
   belirtmesi tetiklememeli) → dikkatli, övgü-tuzağı golden'lı ayrı tur. Model zaten label'lıyor, acil değil.
6. **[izle — şema gerek] Otomasyon baseline import-zamanı:** `*EnabledAt` gate'i `Reservation.createdAt`
   (=import anı) üzerinden; host toggle'ı İLK sync'ten önce açar veya hesabı yeniden bağlarsa mevcut gelecek
   rezervasyonlara mesaj gidebilir. Tam-güvenli fix Hospitable "booking-created" zaman damgası ister (yeni kolon).
7. **[doğrula — kod değil] `isGuestMessage` alan-adı varsayımı:** sync `m.sender_type/sender_role/full_name`
   okuyor; canlı API farklı key kullanırsa TÜM mesaj outbound olur → konuşma hiç "new" olmaz → oto-yanıt hiç
   çalışmaz. CLAUDE.md "AUTO_REPLY uçtan uca doğrulandı" diyor → pratikte doğru; yine de gerçek payload'la teyit et.
8. Temiz çıkanlar (bug YOK): auth/session/IDOR (58 rota), prisma şema/migration drift, KVKK retention/export,
   client-component/form XSS/crash, env-token fallback (unreachable prod'da), güvenlik primitifleri (crypto/JWT/
   2FA/rate-limit — sağlam). Tekrar taramaya gerek az.
6. **[opsiyonel/büyük — BİLİNÇLİ ERTELENDİ] `@@unique([conversationId,externalId])` + `(propertyId,
   sourceReference)`** — fencing double-sync'i büyük ölçüde kapattı ama dedupe hâlâ app-level (findFirst-then-
   create). Constraint self-defending yapardı AMA DOLU tabloya @unique = boot'ta patlar → önce prod-dedup ŞART
   (buradan güvenle yapılamaz). Karar: ŞİMDİ EKLEME; ilerde ayrı, elle-doğrulanan dedup+constraint migration'ı ile.

## ⏳ ERTELENEN (güvenli ama büyük / karar-migration gerek)
- Reverse-trial pause-cron (bugün canlı türetiliyor, cron yok — kararla). `@@unique([conversationId,
  externalId])` (önce prod dedup). KVKK: misafir/hesap silme route'u. SEO (JSON-LD). Mobil polish.
  Dağıtık rate-limit + lock fencing (tek-replica'da gereksiz). Surface-enum + prompt modülerleştirme.
- **Kullanıcı-kararlı kalıcı liste** (zamanı gelince): (1) inbox "neden göndermedi" rozeti = Faz-A YAPILDI ✅,
  (2) haftalık ops-özeti e-postası (dormant doğar), (3) review-isteme otomasyonu (insan-onaylı), (4) lost-item
  akışı (iade otomatik-karar ASLA), (5) misafir dil/konu analitiği, (6) temizlikçi paylaşım linki (token model).

## ⏳ LAUNCH ÖNCESİ — KULLANICI/AVUKAT (kodla çözülmez)
1. **KVKK (en keskin):** misafir mesajı OpenAI'a (ABD) gidiyor, aktarım MEKANİZMASI yok → OpenAI DPA +
   KVKK Standart Sözleşme (Kurul'a 5 iş günü bildir) + host'larla DPA + muhtemel VERBİS. (avukat brief hazır.)
2. **legal-entity.ts** [parantez] alanları — ödeme-öncesi (Paddle MoR satıcı gösterimi avukat sorusu).
3. **E-posta DNS:** RESEND doğrulanmış domain + SPF/DKIM/DMARC (şifre/uyarı mailleri spam'e düşmesin).
4. Paddle: küçük gerçek ödeme birlikte test. AUTO_REPLY: ilk gönderimler birlikte doğrula.

## Durum
**614 test yeşil, typecheck temiz, migrate deploy canlıda doğrulanmış.** 8 migration
(0_init→7_ical_hide_guest_name) sıfır-drift (taze Postgres'te doğrulandı). Branch =
`claude/great-edison-3zqpZ`, origin ile senkron (282cfec = iCal PII gizliliği; 1d112f7 = doğrulama-turu
cilası; b94cd8a = sync fencing + Paddle grace anchor + webhook sıralama; a6d3713 = 10-ajan sweep + 8-ajan
denetim; hepsi canlıda deploy'lu).
