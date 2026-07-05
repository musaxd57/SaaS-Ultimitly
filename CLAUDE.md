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

## ✅ DERİN DENETİM TURU-2 UYGULANDI (2026-07-05, commit cda01bf + 92e3f0a)
5 agent (QR concierge / operatör-admin / trial-email / kalan rapor fn'leri / request-validation) + doğrulama:
- **[GÜVENLİK] Impersonation epoch bypass** (cda01bf): operatör bir müşteriyi impersonate ederken sessionEpoch
  yalnızca MÜŞTERİ userId'sine bakıyordu → operatör kendi şifresini reset etse bile ÇALINAN impersonation
  token'ı yaşıyordu (müşteri PII erişimi + geri süper-admin'e çıkabiliyor). Fix: `actorSessionEpoch` claim'i
  (operatörün kendi epoch'u, hop'larda korunur); requireSession + layout guard actor epoch'unu da doğruluyor.
  Legacy token'lar claim'siz → atlanır (geriye uyumlu). +2 session testi.
- **[Email] Trial-reminder ölü rollback**: `emailService.send()` hatayı yutup void döndüğü için try/catch
  rollback ÖLÜ koddu → başarısız trial-maili sonsuza "gönderildi" damgalı kalıyordu (TRIAL_EMAILS + enforcement
  CANLI). `sendReporting()` + `ok` dalı → başarısızlıkta claim geri alınır, sonraki turda retry. Test güncellendi.
- **[QR] Turnover shadowing**: resolveGuestChat pencereyi test etmeden EN YENİ rezervasyona indirgiyordu → 12s
  look-ahead sonraki misafiri öne çekince, mevcut misafir turnover öncesi öğleden sonra chat'i KAPALI görüyordu +
  turnover sabahı thread'i sonraki misafirin id'siyle sunuluyordu (çapraz-misafir PII). Artık tüm adayları artan
  varışla değerlendirip AKTİF (incumbent) konaklamayı seçiyor.
- **[Rapor] getHostPerformanceScore** UTC gün penceresi → İstanbul (occupancy ile aynı sınıf). **getAiOpsReport
  openProblems** take:500 uzunluğu yerine gerçek count(). **Validators**: loginSchema.email +.max(254),
  reservationSchema.totalAmount +.max. **616 test yeşil.**

## ✅ DERİN DENETİM TURU-3 UYGULANDI (2026-07-05, commit 892f658 + 54b3eae)
5 agent (middleware/cron / CSV-iCal import / paylaşılan tarih-util / interaktif client-component / OpenAI) + doğrulama.
Temiz çıkanlar: middleware+cron+instrumentation (JWT imzalı doğrulanıyor, matcher tam, cron secret timing-safe),
**paylaşılan tarih/util primitifleri** (zonedDayRange/tzOffsetMs/daysUntilDate — İstanbul UTC+3 doğru, TZ tabanı GÜVENİLİR).
- **[Import] CSV/iCal sertleştirme** (892f658): alan uzunluk kapları (import + remote-feed sync, manuel-yolla hizalı) ·
  dosya-boyutu sınırı (5MB upload / 10MB feed, OOM guard) · id-kolonsuz CSV re-import DUPLICATE yaratıyordu → natural-key
  fallback dedup · miktar ayrıştırma `1.234,56`→1.234 bug'ı (son ayraç=ondalık) düzeltildi.
- **[AI] Kanıt bütünlüğü** (54b3eae): `verifyUsedSources` `property:*` her değere true dönüyordu → model uydurma kaynak
  ("property:door_code") enjekte edip UI'da chip gösterebiliyordu → gerçek alanlar whitelist'lendi. `statedCheckoutTime`
  geçersiz saati ("25:99") kabul ediyordu → aralık-doğrulama.
- **[Güvenlik] JWT** `jwtVerify` `algorithms:["HS256"]` pinlendi (savunma-derinliği). **[QR-UI] Poll yarışı**: 5s poll
  gönderilen mesajı ~5s ekrandan silebiliyordu → monotonik load-seq guard + gönderim sırasında poll atla. **616 test yeşil.**
- **[ERTELENDİ — parser rewrite riski]** CSV tırnak-içi newline yanlış ayrışıyor (\n'de pre-split) → state-machine gerek.
  Translate/summarize reportError paritesi (nit). session.ts:10 bayat "deferred" yorumu (doc).

## ✅ DERİN DENETİM TURU-4 UYGULANDI (2026-07-05, commit 6d6ea75 + 6b3bbef)
5 agent (Hospitable OAuth-connect / hesap-yaşam-döngüsü / KVKK-anonimleştirme / KB-şablon / task-dashboard) + doğrulama.
Temiz çıkanlar: **OAuth connect flow SAĞLAM** (state httpOnly+192-bit+verified, sabit redirect_uri, server-only secret, org
session'dan → IDOR yok), tasks/dashboard aggregation, KVKK anonimleştirme çekirdeği (tüm PII alanları kapsanıyor).
- **[Fonksiyonel] Operatör-oluşturduğu müşteri login kilidi** (6d6ea75): admin/customers `emailVerifiedAt` set etmiyordu →
  müşteri İLK login'de "doğrulama maili" (hiç gönderilmeyen) yüzünden 403 → `emailVerifiedAt` damgalandı (login zaten muaf sayıyor).
- **[Güvenlik] QR Wi-Fi secret gate boşluğu**: keyword'süz yazılan wifi SSID/şifre ("İnternet ağımız 'NuveEv'... 12345678")
  non-secret kategoride `looksLikeSecret`'i atlayıp public QR bağlamına girebiliyordu → keyword-bağımsız wifi pattern eklendi.
- **[Hardening] (6b3bbef)** kbSchema.isActive `z.coerce.boolean` ("false"→true) → `z.boolean` · task checklist `Array.isArray`
  guard (non-array JSON 500) · removeAutoTasks docstring düzeltildi (isAuto flag yok → manuel checkin/cleaning de siliniyor). **616 test.**
- **[ERTELENDİ — karar/latent]** (1) KVKK retention resurrection: `DATA_RETENTION_MONTHS` ≤18'e düşerse deep-sync (540g) anonim
  satırları geri çekip PII'yi diriltir (bugün 24ay/190g marj GÜVENLİ). Fix: deep-back'i retention-cutoff'a clamp VEYA
  anonim satırın (guestName="Eski misafir") PII alanlarını sync'te güncelleme. (2) [legal] outbound Message.body misafir adı
  tutuyor (host kaydı—kasıtlı). (3) [legal] WebhookEvent.payloadJson hesap silmede kalıyor (Paddle MoR). (4) getMonthlyReport
  UTC ay penceresi (İstanbul'a çevrilebilir, düşük etki). (5) dashboard "Şu An Konaklayan" turnover-günü overlap sayıyor.

## ✅ DERİN DENETİM TURU-5 UYGULANDI (2026-07-05, commit 700dd72 + e4b459e + 5a7a028)
5 agent (adversarial AI-gate + adversarial billing + marketing/SEO + error-reporting/audit + boot/env/seed). Temiz:
billing entitlement (grace/trial/grandfathered sağlam), error-reporting+audit (never-throw, actor imzalı, sızıntı yok),
landing demo cost-gate/XSS/hydration, boot-order/env-guard/next.config.
- **[AI GÜVENLİK — turun en kritik bulgusu, 700dd72]** oto-gönderim kapısında 3 delik kapandı: (1) `rule_violation` +
  `discrimination` DETERMİNİSTİK NET YOKTU (tur-2'de ertelenmişti) → evcil-hayvan/parti/kapasite/ayrımcı-talep benign-
  model'le izinsiz onay OTO-GİDİYORDU → word-net + gate veto (ayrımcılık EXCLUSION-anchored, misafirin kendi milliyeti
  tetiklemez). (2) İngilizce güvenlik kelimeleri zayıf ("I smell gas" yakalanmıyordu) → genişletildi. (3) `riskLevel`
  FAIL-OPEN ("High"/"critical"→"none") → fail-closed ("high"). +6 golden. **622 test.**
- **[Ops güvenlik, e4b459e]** seed.ts prod-wipe guard (NODE_ENV=production'da DB silmeyi reddet, ALLOW_PROD_SEED override) ·
  BILLING_ENFORCED "1" de kabul (diğer 8 flag gibi) · EMAIL_PORT boş-string→0 guard.
- **[SEO, 5a7a028]** global canonical="/" her sayfaya miras kalıp yasal/KVKK sayfalarını index-dışı bırakıyordu → kaldırıldı.
- **[✅ KARAR VERİLDİ + UYGULANDI, commit b99f5aa]** Operatör-müşteri billing: admin "müşteri ekle" formuna **Faturalama
  modu** seçici; admin/customers route ARTIK HER ZAMAN Subscription satırı açar → (1) **trial** (varsayılan, public gibi 14g
  Pro sonra ücretli), (2) **manual** (status active/provider manual — premium açık, ödemeyi operatör dışarıda toplar), (3)
  **free** (status grandfathered — sınırsız, enforcement-dışı, AÇIK işaret; artık kazara satırsız-grandfathered YOK). Migration
  YOK (mevcut alanlara oturdu). Operatör paneli SADECE Nuve'de (SUPERADMIN_EMAILS gate; müşterilerde yok — doğrulandı).
- **[ERTELENDİ — latent → ÇOĞU ÇÖZÜLDÜ TURU-6]** ~~error-reporting Sentry redaksiyon~~ ✅ · ~~dashboard "Şu An
  Konaklayan" overlap~~ ✅ (aşağı bak). getMonthlyReport UTC ay = HÂLÂ açık (düşük etki).

## ✅ KVKK SERTLEŞTİRME BATCH'İ UYGULANDI (2026-07-05, commits eb47949·cc468eb·be4dfbc·c827b4a·cea2ce0 — kod değişmez, migration YOK)
Kullanıcı 5 KVKK/doğruluk düzeltmesi istedi; her biri agent-vetted + kod-doğrulanıp uygulandı. **635 test yeşil.**
1. **[Sentry redaksiyon, cc468eb]** `report-error.ts` `redactSensitive()`: bearer/`sk-`/`whsec_`/JWT/authorization/cookie
   maskesi + alan-adı-duyarlı `key:value` redaksiyonu + etiketsiz `[EMAIL]/[PHONE]/[NUM]`. `code/id/status/type` bare kalır
   (P2002/invalid_grant/HTTP-status hata-teşhisi korunur). `reportError` detail/errName/errMessage'i redakte eder; Paddle
   webhook error yazımı da geçer. → provider raw body / AI prompt / misafir mesajı / token/cookie / email-tel-ad-adres artık
   Sentry+log+alert-mail'e SIZMAZ. +2 test.
2. **[Retention resurrection guard, eb47949]** deep-sync (540g) retention-cutoff'u (190g) aşıp anonimleşmiş satırı geri
   çekince taze kanal-PII'si sentineli EZİYORDU. `hospitable-sync.ts` artık `guestName===ANON_NAME` / `guestIdentifier===
   ANON_ID` gördüğünde PII alanlarını YAZMAZ (yeni mesajlar yine import edilir). Option-(b): sync PII restore edemez (boot-fail
   yerine — retention penceresi daralsa bile güvenli). +1 integration test (Booking kanalı; sync→anonymize→re-sync→sentinel korunur).
3. **[Paddle webhook PII minimize, c827b4a]** account-delete'te WebhookEvent SİLİNMEZ (org FK yok, finansal/audit iz —
   Invoice/Subscription cascade ile gider). `redactPaddleWebhooksForOrg`: payloadJson allowlist-rebuild (event_id/type/
   occurred_at + data.{id,status,customer_id,subscription_id,currency_code,period.ends_at,grand_total,custom_data.orgId} +
   `note:"kvkk-erasure"`) → email/ad/adres/tel/ham-gövde düşer, mutabakat iskeleti kalır. Substring-prefilter + parse-verify
   (yanlış org'a dokunmaz), `status:"processed"` (Paddle retry ham-PII'yi geri yazamaz). +1 test.
4. **[Dashboard "bu gece kalan", be4dfbc + kart adı düzeltmesi]** `distinct propertyId` zaten turnover double-count'ı
   engelliyordu; ASIL sorun: BUGÜN çıkış yapıp bu gece boş olan (relet olmayan) evin hâlâ sayılmasıydı. `reports.ts`
   `stayingTonight` = `arrivalDate<=dayEnd AND departureDate>dayEnd` (distinct propertyId; iCal öğlen-UTC için `>dayEnd`
   doğru sınır) → "bugün çıkış yapan ama bu gece kalmayan rezervasyon artık sayılmaz". Kart adı da eski "Şu An Konaklayan"
   (=şu an, yanıltıcı) yerine **"Bu Gece Kalan"** (hint "bu gece evde kalan misafir") → etiket semantiğe birebir uyuyor.
   Dashboard inline dup query kaldırıldı. Doluluk sayımı (occupiedToday) DEĞİŞMEDİ. +2 test.
5. **[Outbound gövde ad-redaksiyonu, cea2ce0]** retention-sweep misafirin KENDİ (inbound) gövdesini siliyordu ama host'un
   outbound cevabı adı ekoluyordu (oto-selam ilk-ad "Merhaba Ahmet,"; manuel imza tam-ad) → ad sonsuza kalıyordu. `redactNameFromBody`:
   bilinen ad(lar)ı outbound'dan çıkarır, host içeriğini ("anahtar kutuda") KORUR → sadece token `[Misafir]`. Rezervasyon-bağlı
   + orphan yolları. Unicode-duyarlı sınır (`\p{L}\p{N}` lookaround; JS `\b` ASCII, TR ç/ğ/ı/ö/ş/ü'de bozulur). <3-harf ad atlanır
   ("Su tesisatı" bozulmasın — bilinçli residual). Idempotent. +5 test.
**Resend DNS = KOD DEĞİL, OPS CHECKLIST** (launch-öncesi): RESEND doğrulanmış domain + SPF/DKIM/DMARC (şifre/uyarı mailleri
spam'e düşmesin) — aşağıdaki "LAUNCH ÖNCESİ" #3'te zaten var, kod tarafı yapılacak bir şey yok.

## 🔄 TUR-6 DENETİM — DEVAM EDİYOR (2026-07-05 başladı)
**ŞU AN YAPILAN:** KVKK batch sonrası kullanıcı 5 kontrol sorusu sordu → hepsi KODLA doğrulandı; 2 gerçek eksik
bulunup düzeltildi (commit `14fe961`): (a) dashboard kartı **"Şu An Konaklayan" → "Bu Gece Kalan"** (etiket ↔ gece-kesin
`stayingTonight` semantiği birebir uyumu; "şu an" yanıltıcıydı), (b) `report-error.test.ts`'e **OpenAI-tarzı redaksiyon
fixture'ı** eklendi (önceki sadece Hospitable-tarzıydı; `ai/index.ts` OpenAI response gövdesini `reportError`'a besliyor →
şimdi o şekil test ediliyor: email+`sk-` key düşer, error type/code kalır). CLAUDE.md dashboard wording düzeltildi
(`distinct propertyId` zaten double-count'ı engelliyordu; asıl fix "bugün çıkış yapan ama bu gece kalmayan").
**Doğrulanan (bug YOK):** Paddle `custom_data.organizationId` checkout'ta damgalanıyor (`paddle-plans.tsx:150`) →
redaksiyon webhook'un org-linking'iyle AYNI anahtar+parse-verify → kapsam birebir. Allowlist provider-id'leri koruyor
(debug sağlam). `[Misafir]` mesaj anlamını bozmuyor (yerinde token, host içeriği kalır).
**8 AGENT SALINDI → 7'si SESSION API LİMİTİNE takıldı (9:20am UTC reset), sadece sync-engine agent'ı bitti.**
Onun TEK doğrulanan bulgusu (commit `1e6959e`, KODLA teyit + düzeltildi): **sync "Misafir" placeholder regresyonu** —
`eb47949`'te eklediğim konuşma resurrection guard'ı `guestIdentifier === ANON_ID` ("Misafir")'e bakıyordu, ama ANON_ID
AYNI ZAMANDA isimsiz-thread placeholder'ı → ismi baştan çözülemeyen konuşma sonsuza "Misafir"e donuyor, gerçek ad gelince
adopte etmiyordu (rezervasyon satırı DISTINCT ANON_NAME="Eski misafir" kullandığı için doğru güncelleniyordu → inbox
"Misafir" ama rezervasyon "Ahmet"). Fix: konuşma guard'ı da rezervasyonun ANON_NAME durumuna baksın + sadece GERÇEK ad
yazılsın (placeholder değil); orphan thread için identifier sentinel'e düş (privacy-safe). +1 test (placeholder→gerçek ad).
Diğer 7 agent limit resetinde tekrar salınacak. **Bilinen açık item'lar hâlâ hedef:** getMonthlyReport UTC-ay ·
automation baseline import-zamanı · `isGuestMessage` alan-adı · CSV tırnak-içi-newline.

## 📊 KULLANICI YENİ İSTEK TURU (2026-07-05) — analitik + KVKK + legal + consent
Kullanıcı büyük bir istek listesi verdi; KODLA doğrulayıp (agentlar limitte) karar-listesi + 3 güvenli win uyguladım.
**KODLA DOĞRULANAN MEVCUT DURUM:** (a) **Veri export VAR** (`/api/account/export` self + `/api/admin/export`). (b) **Hesap
silme VAR** (`/api/account/delete`, bu oturumda sertleştirildi). (c) **Event altyapısı ZATEN VAR** = `writeAudit`+`AuditLog`
(15 event wired: auth.login_*, account.password_*/2fa_*, customer.create, data.export*, hospitable.*, guest_chat.*,
impersonate.*) + "Denetim Kayıtları" admin sayfası. (d) **Register consent:** `acceptedTermsAt` VAR; privacyAcceptedAt/
legalVersion/IP/UA YOK (kullanıcı analizi doğru). (e) **Checkout consent: YOK** (`paddle-plans.tsx`'te Checkout.open öncesi
mesafeli-satış checkbox'ı yok — doğrulandı).
**UYGULANAN (commit `1e8a772`):** (1) **Audit label map** (`auditActionLabel` @ audit.ts) → admin panel ham "auth.login_
success" yerine "Başarılı giriş" gösteriyor (raw action title'da; bilinmeyen→raw fallback). YENİ MODEL YOK, mevcut infra
genişletildi. (2) **Register trust copy**: "14 gün ücretsiz Pro deneme — kart gerekmez" + e-posta doğrulama + oto-ücret-yok notu.
**KARAR/GÖRÜŞ (kullanıcıya sunuldu):** • Analitik: ProductEvent modeli AÇMA — writeAudit/AuditLog zaten trackEvent; eksik
event'leri (ai_reply_sent/auto_reply_blocked/kb_item_created/billing_checkout_*) writeAudit'e tak + admin aggregation ekle.
• KVKK UX (silinir/saklanır paneli + AI veri-kullanım açıklaması + export görünürlüğü) = task #44.
**✅ #41 UYGULANDI (migration 8_consent_evidence, commit `e173c4d`):** User'a 4 NULLABLE kolon (privacyAcceptedAt·
acceptedLegalVersion·acceptedIp·acceptedUserAgent) — dolu tabloda güvenli (NOT NULL/default YOK). Gerçek migration üretildi
(`migrate diff --from-migrations`), throwaway Postgres'te migrate deploy (0..8) + **sıfır-drift doğrulandı**. Register route
aynı transaction'da damgalıyor: privacyAcceptedAt=acceptedTermsAt (tek checkbox Terms+Privacy), acceptedLegalVersion=LEGAL_VERSION,
acceptedIp=clientIp(req) (rightmost XFF, spoof-dayanıklı), acceptedUserAgent=UA (512'ye kırpık, null-safe). Legal versiyon TEK-KAYNAK:
`LEGAL_VERSION="2026-06"` + `LEGAL_LAST_UPDATED="Haziran 2026"` @ legal-entity.ts; 4 legal sayfası artık ortak sabiti render ediyor
(damgalanan versiyon görünen tarihten sapamaz). +2 test (evidence yakalama + header'sız null-safe). 639 test. **Review agent
TEMİZ (7/7 kodla doğrulandı):** migration boot-safe+sıfır-drift · rightmost-XFF spoof-dayanıklı · UA 512-cap null-safe ·
**SIZINTI/IDOR YOK** (export/admin/login hiçbir yerde 4 alanı dönmüyor — allowlist select) · transaction rollback doğru ·
legal-version DRY tutarlı. Bilgi-notu (bug değil): consent ham `data?.consent` ile doğrulanıyor (registerSchema'da değil);
export-dışlama regresyon testi yok (yapı allowlist ile zaten güvenli — istenirse ileride pin-test eklenebilir).
• Register'a mesafeli/ön-bilgilendirme KOYMA (kullanıcı onayı) — sadece terms/privacy kaldı.
**✅ #43 + #42 UYGULANDI (kullanıcı "önce bu 2sini yap" dedi):**
- **#43 Legal metin ekleri (commit `1db744c`):** verilen metin mevcut legal sayfalara ADDITIVE eklendi (mevcut içerik korundu,
  sadece genişletildi/renumber). gizlilik(KVKK) 1→23 (yeni: Kullanılan Bağlam/Risk Etiketleri · Ödeme Webhook'ları+Finansal ·
  Hata Raporlama+Redaksiyon · QR Misafir Sohbeti · Takvim/iCal · Müşteri Yükümlülükleri; genişletilen 5/6/8/10/12).
  on-bilgilendirme 1→15 (AI Sınırları · Üçüncü Taraf Bağımlılık · Platform Spam/Politika). mesafeli-satis §8 ALICI + §9 SATICI
  genişletildi (parti etiketleri SATICI/ALICI'ya harmonize — sözleşme iç-tutarlılığı; metin aksi hâlde birebir). Numara tekrarsız.
- **#42 Checkout consent (commit `c4e7080`):** `paddle-plans.tsx` — ZORUNLU checkbox ("Ön Bilgilendirme + Mesafeli Satış'ı
  okudum"), tüm plan butonlarını kilitler + `openCheckout` içinde defense-in-depth guard + /on-bilgilendirme,/mesafeli-satis link.
  Kabul-KAYDI (timestamp/version server-side) = AYRI task **#45** (şu an SADECE UI gate; #41 register-only, checkout'u kapsamaz).
  Checkout server-kaydı yeni tablo `CheckoutConsent` + `/api/billing/consent` endpoint ister (org/user/planCode/priceId/version/ip/ua). 637 test yeşil.
- **DOĞRULAMA — İKİSİ DE TEMİZ (2 review agent, kodla):** (a) **Checkout gate:** bypass yok (disabled buton + openCheckout guard),
  stale-closure yok (`accepted` deps'te), linkler geçerli, tek checkout yüzeyi. Tek "vektör" konsoldan direkt `Paddle.Checkout.open`
  = her client-side 3rd-party checkout'ta doğal, server-side kayıtla (#41) kapanır — app bug değil. (b) **Legal metin ürün-doğruluğu:**
  6 iddia da DOĞRU — Paddle webhook redaksiyon (data-retention.ts:209-266), report-error redaksiyon (report-error.ts:29-58), sync
  scrubbed-guard (hospitable-sync.ts:346-353,510-527), iCal ad-gizleme (ics.ts + schema icalShowGuestName @default false), QR
  chatEnabled+secret-gate+kill-switch, AI passesAutoReplySafetyGate high-risk veto. gizlilik 1-23 tekrarsız/çelişkisiz.
  Küçük not (fix gerekmez): "hasar/depozito/ceza" için ayrık deterministik kelime-ağı yok (model complaint/refund'a sınıflar+bloklar,
  metin "bırakılabilir" yumuşak) → ileride AI-gate word-net eklenebilir (golden gerekli). `legal-entity.ts` [parantez] alanları HÂLÂ
  boş = bilinen ödeme-öncesi hukuk blocker (kod değil).

## ⏳ SIRADAKİ OTURUM — kalan (opsiyonel / karar)
4b. **[düşük — hardening]** CSV/iCal import (`reservations/import`) manuel-yol uzunluk kaplarını atlıyor (currency
   vb. sınırsız) → satırları `reservationSchema`'dan geçir. QR `looksLikeSecret` yalnız keyword-yanındaki kodu
   yakalıyor (host yanlış kategoriye koyarsa savunma-derinliği boşluğu, sızıntı DEĞİL). conversationReplySchema
   manuel cevapta senderName serbest → "GuestOps AI" ile self-inflate rapor sayımı (kendi-org, exploit değil).
5. ✅ **[YAPILDI tur-5, commit 700dd72] `discrimination` + `rule_violation` deterministik net** eklendi — fallback.ts
   word-net (ayrımcılık EXCLUSION-anchored) + gate veto + 6 golden. Misafirin kendi milliyeti tetiklemiyor (praise-trap testli).
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
**635 test yeşil, typecheck temiz, migrate deploy canlıda doğrulanmış.** 8 migration
(0_init→7_ical_hide_guest_name) sıfır-drift (taze Postgres'te doğrulandı). **KVKK sertleştirme batch'i (5 düzeltme,
migration YOK — mevcut alanlara/koda oturdu): Sentry redaksiyon · retention resurrection guard · Paddle webhook PII
minimize · dashboard "bu gece kalan" · outbound gövde ad-redaksiyonu.** Branch =
`claude/great-edison-3zqpZ`, origin ile senkron. 5-tur derin denetim (loop `197ace29`) yapıldı: tur-1..5 =
AI-gate güvenlik yedekleri (rule_violation/discrimination/safety-EN/riskLevel) · sync fencing/dedup/guestName ·
Paddle grace/webhook · iCal PII · impersonation epoch · trial-email retry · QR turnover + wifi-secret · CSV
import sertleştirme · operatör-müşteri login · seed prod-guard · SEO canonical. Bulgular tur-tur azalıyor
(çekirdek iyi örtüldü). Kalan: çoğu KULLANICI/LEGAL kararı (operatör-müşteri billing, retention-window, KVKK-DPA).
