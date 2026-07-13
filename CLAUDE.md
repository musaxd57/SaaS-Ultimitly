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
   occurred_at + data.{id,status,customer_id,subscription_id,currency_code,period.ends_at,grand_total,custom_data.organizationId} +
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
  Kabul-KAYDI (timestamp/version server-side) → **✅ #45 UYGULANDI (migration `9_checkout_consent`, commit `133e8cc`).**
  Yeni tablo `CheckoutConsent` (org Cascade + user SetNull + index, AuditLog analog — dolu tabloya ALTER YOK, sıfır risk;
  throwaway PG'de migrate deploy 0..9 + sıfır-drift doğrulandı). `POST /api/billing/consent` (withAuth): org+user SESSION'dan
  (IDOR-proof; body org/user zod-strip), legalVersion=LEGAL_VERSION + ip=clientIp(rightmost XFF) + UA(512-cap) = server-türevli.
  Client (paddle-plans) Paddle overlay AÇILMADAN önce best-effort kaydeder (kayıt hatası checkout'u bloklamaz — checkbox gate +
  Paddle txn backstop); legalVersion customData'ya da binerek tamamlanan-işlem webhook'una taşınıyor. resetDb temizliyor.
  **⚠️ KULLANICI DÜZELTMESİ (fail-closed, commit sonraki):** best-effort KALDIRILDI — consent POST başarısızsa (non-2xx VEYA network)
  `Paddle.Checkout.open` ÇAĞRILMIYOR + "Onayınız kaydedilemedi, ödeme başlatılamadı" gösteriliyor. Delil-önce: kayıt commit
  olmadan ödeme yok (endpoint 2xx = satır commit'li). +busy in-flight guard (double-click→çift satır engellendi). +3 UI test
  (jsdom: 500→open YOK, network-hata→open YOK, 201→open VAR). +6 endpoint test
  (kayıt+rightmost-XFF, 401, 400, IDOR-proof, null-safe, 429-cap). **Review agent TEMİZ (7/7 kodla):** migration boot-safe+sıfır-drift ·
  IDOR-proof (zod-strip + session) · FK ihlali imkânsız (requireSession user'ı doğruluyor) · client best-effort checkout'u bloklamıyor ·
  erasure org-cascade ile CheckoutConsent gider (retention sweep dokunmaz — host'un KENDİ kanıtı, guest PII değil) · SIZINTI YOK
  (write-only, hiçbir API/export okumuyor) · rate-limit session-keyed bypass yok. 645 test.
- **✅ FAIL-CLOSED (kullanıcı direktifi, commit `7630ebc`):** best-effort KALDIRILDI. `openCheckout` önce kaydeder, `res.ok`
  (=satır commit'li) DEĞİLSE `Paddle.Checkout.open` ÇAĞRILMAZ + "Onayınız kaydedilemedi, ödeme başlatılamadı". Kanıt olmadan ödeme
  yok. +busy in-flight guard (çift-tık→çift satır engellendi). +3 UI test (jsdom: 500→open YOK · network-hata→open YOK · 201→open VAR). **648 test.**
- **✅ KARAR — consent paketi YETERLİ (kullanıcı, launch için):** timestamp + IP + userAgent + legalVersion + server-side checkout
  kaydı + fail-closed = yeterli. Postgres güvenilir (endpoint 2xx = ACID-commit'li satır; DB düşerse ödeme açılmaz — doğru taviz).
- **⏸️ #46 `legalTextHash` = BACKLOG (kullanıcı: "şimdi başlama").** legalVersion YERİNE değil YANINA sha256(legal metin) → metin
  versiyon-bumpsuz değişse bile kabul-anı hash'i tam gösterileni dondurur. Şart DEĞİL (mevcut standart yeterli), ileride "çok
  profesyonel güçlendirme". Yaparsak: SECTIONS'ı paylaşılan modüle taşı + server-hash + CI drift-test. **Launch öncesi öncelik DEĞİL.**
- **🎯 LAUNCH ÖNCESİ ÖNCELİK (kullanıcı sıralaması):** (1) **SELLER bilgileri** (`legal-entity.ts` [parantez] — KULLANICI/avukat
  girdisi, kod değil), (2) **#44 KVKK UX** (silinir/saklanır paneli + AI veri-kullanım açıklaması + export görünürlüğü — kod), (3) **final denetim** (tur-6 resume).
- **✅ #44 UYGULANDI (commit `6114cc9`):** hesap-silme "silinir/saklanır" paneli (deleteAccountData cascade + redakte-webhook ile
  BİREBİR) + "Yapay Zekâ ve Veri Kullanımı" kartı (misafir tel/e-posta modele gitmez [ReservationContext'te yok] · riskli→insan ·
  "OpenAI API varsayılanı gereği eğitimde kullanılmaz" DÜRÜST-ATIF, ZDR iddiası YOK) + KVKK notu owner→buton/manager→mail düzeltmesi.
  Additive UI, migration YOK. +1 render test.
- **✅ BUGÜNÜN-İŞİ DENETİMİ (4 agent, kullanıcı direktifi):** consent-zinciri (#41+#45+fail-closed) TEMİZ · regresyon TEMİZ (649 test,
  ürün bozulmadı) · #44 doğruluğu 4/5 TEMİZ · metin-tutarlılığı. **4 gerçek fix uygulandı (commit `4c8a28f`):** (1) settings KVKK notu
  `!isOperator` gate (operatör/founder'a var-olmayan silme bölümünü işaret ediyordu) · (2) settings AI kartı "yanıtlanmaz"→"sonuçlandırılmaz;
  insan incelemesine" (opt-in holding-ack ile hizalı, gizlilik §10) · (3) mesafeli §17 "16 maddeden"→"17" (render'la uyum) · (4) on-bilgilendirme
  "İşletme 8+"→"8–25 daire" (propertyLimit=25 + landing ile uyum). #3/#4 pre-existing, denetimde yüzeye çıktı.

## 🔒 PRE-LAUNCH DENETİM (40-agent workflow, kullanıcı direktifi: yeni özellik YOK)
`wf_c54a3844` — 41 agent (10 backend·10 uyum·10 frontend·10 ekstra), yüksek/kritik verify. **18/41 bitti, 23 session-limit'te düştü
(2:30 UTC reset → resume edildi).** Yüksek/kritik YOK; 36 medium/low. **UYGULANAN (kodla-teyit + test):**
- **[GÜVENLİK] SSRF (commit `91c789c`):** calendar-sources keyfi URL kaydediyor → `import/sync.ts` server-fetch, iç-IP filtresi
  yoktu → `lib/net/private-host.ts isPrivateHost` (route create + pre-fetch guard; string-only, no-DNS → legit feed bozulmaz).
  Residual (follow-up): DNS-resolve-to-private + 302-redirect-to-internal (dispatcher/lookup gerek). +1 unit test.
- **[SYNC] linkProperty guard (`91c789c`):** global-@unique hospitableId P2002'si (aynı Airbnb hesabı 2 org'da) TÜM org sync'ini
  abort ediyordu → try/catch log-and-continue (rezervasyon loop'u gibi).
- **[AI-GATE] (commit `9105108`):** injection "your previous instructions" (determiner'da your yoktu) · cancellation isim-formları
  (iptali/cancellation/cancel this) · hasar/depozito/ceza dispute anchor'ları · ırk-temelli exclusion (no black/siyahi olmasın,
  exclusion-anchored → misafirin kendi kökeni tetiklemez) · **QR concierge mustEscalate** backstop'ları (injection+safety_emergency+
  rule_violation+discrimination+human_request — public chat'te human-review taslağı yok). +9 golden (88 pass). Hepsi over-escalate=güvenli.
**UYGULANAN (batch 2, kullanıcı onayı):**
- **[billing] webhook 5xx (commit `6a2c49c`):** signature+parse OK ama apply throw → artık 200 yerine **500** (Paddle retry eder; handler
  idempotent → tam-bir-kez). Invalid-signature→401, unparseable→200 korundu. +test (apply-throw→500+processed değil→retry idempotent).
- **[kopya+UX (commit `7d8bb01`)]:** gizlilik §19 3-çerez (session+2FA-30g+oauth-state) · yasal "yıllık" kaldırıldı (ürün aylık) ·
  landing "25+"→"25'ten fazla" · settings KVKK "veya"→"ve + biri diğerini silmez" · landing-demo Enter busy-guard · guest-chat başarısız-gönderimde optimistic balon rollback + input geri.
**KARAR-LİSTESİ (HÂLÂ ERTELİ — inceleme/karar):**
- [billing-low] invoice dedup non-atomic (findFirst+create; boş tablo→@@unique([provider,providerRef]) güvenli) + occurred_at null/atomic concurrency race.
- [reliability] automation.ts:972 ana persist try/catch (kardeşleri korumalı, bu değil) · manual reply idempotency (claim-then-send, auto-reply'da var).
- [sync-low] deep-cadence multi-replica (module var → SystemLock'a taşı) · outbound externalId-null dedup ("canlıda doğrula").
- [nit] account-card error-first→field-first · landing-demo rozet-overclaim (gate'in 2/8 kontrolü) · billing/consent bayat "best-effort" yorumu (artık fail-closed).
- [sync-low] deep-cadence multi-replica (module var) · outbound externalId-null dedup (CLAUDE.md'de zaten "canlıda doğrula").
**✅ WORKFLOW TAMAMLANDI (42/42 agent, 0 hata, resume ile): 94 bulgu, 1 CONFIRMED HIGH (adversarial), 20 medium, 52 low, 21 info.**
- **[HIGH — DÜZELTİLDİ, commit `fd5585e`]** `redactSensitive` FIELD_RE virgüllü değerleri (adres/full_name/guest_name) redakte edemiyordu →
  değer Sentry(ABD)+log+mail'e SIZIYORDU. Quoted-branch eklendi (virgül dahil tam yakala). +regresyon testi.
- **[safety — DÜZELTİLDİ, commit `151395a`]** seed prod-wipe guard NODE_ENV yerine DATABASE_URL-local kontrolü · verify-email rate-limit (20/saat/IP).
**✅ #47 DEPLOY BLOCKER ÇÖZÜLDÜ + PROD DOĞRULANDI (commit `e8e5eb2`):** migration klasörleri `00_..09_` zero-pad (git rename, history
korundu); throwaway PG'de 00-09 sırayla + `10_` probe artık 09'dan sonra + sıfır-drift. Prod `_prisma_migrations` kullanıcı SQL'iyle
`00_..09_`'a güncellendi (10 satır UPDATE 1), SONRA push edildi → Railway deploy logu **"No pending migrations to apply · 10 migrations
found · Ready in 202ms"** = temiz boot, re-apply YOK. Artık migration 10+ güvenle eklenebilir (verify-email index'i dahil önceden ertelenenler).
**KARAR-LİSTESİ (yeni gerçek bulgular — inceleme/karar):**
- [AI-safety] `passesAutoReplySafetyGate` sadece `last.body`'yi tarıyor; AI cevabı TÜM konuşma geçmişi + misafirin (Airbnb-kontrollü) rezervasyon ADI'ndan üretiliyor → önceki mesaja veya display-name'e gömülü injection kod-kapısını atlar. Gate'i geçmiş+ad'a genişlet (golden gerekli).
- [KVKK] erasure yalnız `custom_data.organizationId`'li webhook satırlarını redakte ediyor; `customer.updated` (email/ad/adres) bu tag'i taşımaz → hesap-silmede redaksiyonsuz kalır. Erasure'ı customer_id ile de eşleştir.
- [QR-privacy] chat geçmişi sadece paylaşılan (fiziksel-asılı) QR token'ıyla korunuyor → önceki misafir/temizlikçi, aktif konaklamada mevcut misafirin sohbetini okuyabilir. Tasarım limiti (per-misafir auth gerek).
- [fe-admin] billing rozeti süresi-dolmuş denemeyi yeşil "Deneme·0g" gösteriyor (limited moda düşmüşken) · [fe-reports] getAiOpsReport openProblems .length(cap 500) yerine count() · [fe-calendar] "+N diğer" turnover günü yanlış sayıyor · [pricing] tier-özel özellik iddiası gate'li değil (kopya) · [password-reset] bcrypt parity-timing enumeration (subtle).
- **DOĞRULAMA — İKİSİ DE TEMİZ (2 review agent, kodla):** (a) **Checkout gate:** bypass yok (disabled buton + openCheckout guard),
  stale-closure yok (`accepted` deps'te), linkler geçerli, tek checkout yüzeyi. Tek "vektör" konsoldan direkt `Paddle.Checkout.open`
  = her client-side 3rd-party checkout'ta doğal, server-side kayıtla (#41) kapanır — app bug değil. (b) **Legal metin ürün-doğruluğu:**
  6 iddia da DOĞRU — Paddle webhook redaksiyon (data-retention.ts:209-266), report-error redaksiyon (report-error.ts:29-58), sync
  scrubbed-guard (hospitable-sync.ts:346-353,510-527), iCal ad-gizleme (ics.ts + schema icalShowGuestName @default false), QR
  chatEnabled+secret-gate+kill-switch, AI passesAutoReplySafetyGate high-risk veto. gizlilik 1-23 tekrarsız/çelişkisiz.
  Küçük not (fix gerekmez): "hasar/depozito/ceza" için ayrık deterministik kelime-ağı yok (model complaint/refund'a sınıflar+bloklar,
  metin "bırakılabilir" yumuşak) → ileride AI-gate word-net eklenebilir (golden gerekli). `legal-entity.ts` [parantez] alanları HÂLÂ
  boş = bilinen ödeme-öncesi hukuk blocker (kod değil).

## ✅ AKILLI GÖREV SİSTEMİ — FAZ A UYGULANDI (2026-07-10, commit `bcb2d49`, migration 10)
Kullanıcı "birkaç AI şu 'smart task system' spec'ini yazdı, mantıklı mı?" diye sordu → değerlendirme sundum
(gerçek geliştirme AMA olduğu gibi risk taşıyor: SMS/Twilio KVKK+İYS+para engeli, şema şişkin, mevcut net
çoğaltma riski) → kullanıcı "Faz A'dan başla". **Faz A = SMS'SİZ, additive, opt-in.**
- **Ne yapar:** escalation eden misafir mesajı fiziksel-operasyon sinyali taşırsa (arıza/eksik/temizlik) kategori
  (mevcut `maintenance/restock/cleaning` tipleri — TASK_TYPE'a DOKUNULMADI) + öncelik + SLA(`dueAt`) ile **deduped**
  görev açar. Eskiden escalation'da HİÇ görev açılmıyordu (sadece "Sorunlu"+mail).
- **⚠️ İKİ ESCALATION YOLUNA DA BAĞLI (canlıda-doğrulama bulgusu, commit `8022f86`):** `sendDueAlerts` (keyword yolu)
  `applyChannelAutoReply`'dan (model yolu) ÖNCE çalışır (scheduled-sync.ts:176 vs 182) ve çoğu operasyonel şikayeti
  o yakalayıp "Sorunlu" işaretler → model-pass status=="problem"'de erken çıkar. İlk sürüm görevi SADECE model-yoluna
  bağlamıştı → pratikte neredeyse hiç tetiklenmiyordu. Şimdi HER İKİ yolda da (keyword claim sonrası + model escalation)
  toggle-gated, deduped, best-effort görev açılıyor.
- **Mail alıcısı (değişmedi):** `alertEmail` varsa o, yoksa org sahibinin (en eski user) giriş maili; **ASLA** env
  operator adresi (cross-tenant sızıntı önlenir). Görev oluşturma HİÇ mail göndermez — sadece Task satırı yazar.
- **Opt-in toggle:** `Organization.autoTaskFromMessageEnabled` (default KAPALI, holding-ack precedent'i gibi). Kapalıyken
  davranış BİREBİR aynı. Ayarlar→Otomasyon Tercihleri'nde toggle+açıklama. `applyInboundMessageRules` (dormant webhook
  yolu) BİLİNÇLİ ELLENMEDİ — canlı ürün risksiz; harmonizasyon Faz-A-sonrası opsiyonel.
- **AYRI GÜVENLİK NETİ AÇILMADI (kritik ilke):** task kategorisi mevcut AI çıktısından (intent/riskType) türetiliyor;
  sadece güvenlik-netinde OLMAYAN operasyonel sinyaller için küçük **task-only** netler (breakage/restock) eklendi
  (`src/lib/tasks/detect.ts`). Bunlar `passesAutoReplySafetyGate`'i BESLEMEZ, golden set'e DOKUNMAZ. fallback.ts
  değişmedi (sadece `matchesIntentKeywords/detectRiskType/classifyFallback` export'ları OKUNUYOR).
- **Detector inceltmesi:** amenity/cleaning gibi TOPIC kuralları çıplak soruyu ("havlular nerede?") görev yapmasın diye
  yalnız gerçek şikayette (`classifyFallback().isComplaint`) tetikler; breakage/restock/safety kendiliğinden problem.
  Non-operasyonel risk (refund/review_threat/cancellation/human_request/injection/discrimination) → `null` (görev yok).
- **Dedupe:** `{propertyId}:{type}:{topic}:{İstanbul-gün}` (topic dahil → aynı-konu tekrarı tek görev AMA aynı gün
  farklı iki ayni-kategori sorunu ayrı; adversarial review over-dedupe bulgusuyla eklendi), findFirst status!=done
  (non-atomic, kod geneliyle tutarlı taviz).
  Başlık PII-lean (tip etiketi + eşleşen kelime; misafir adı BAŞLIKTA YOK — eski "Şikayet: {ad}"'dan daha temiz);
  tam metin description'da (message.slice(0,500), eski complaint-task ile aynı yüzey).
- **Migration 10_smart_task_routing:** Task.sourceMessageId/dedupeKey (NULLABLE), Organization.autoTaskFromMessageEnabled
  (NOT NULL DEFAULT false), Task_dedupeKey_idx. Taze PG'de `migrate deploy` 00→10 sırayla + **sıfır-drift** doğrulandı.
- **679 test yeşil (+17)**, typecheck + build temiz. **⏳ Faz B (ERTELE/karar): dış bildirim (Twilio DEĞİL →
  token'lı temizlikçi paylaşım-linki + KVKK/İYS + legal ek).** ⚠️ CANLIDA: toggle açık org'da ilk gerçek görev
  oluşumlarını doğrula (over/under-create + dedupe).

## ✅ HAZIRLIK & ALIŞVERİŞ PLANI UYGULANDI (2026-07-10, commit `87def85`, migration 11)
Kullanıcı takvimdeki "Tüm daireler" isim-çorbasını sorguladı → "adamlar çarşaf/malzeme adedini girer, AI rapor çıkarır
(bugün çöp poşeti al gibi)" fikri. **Kritik itiraz (kullanıcı):** "kaç misafir geldiğini bilmiyoruz, AI mesajdan çarşaf
kullanımını nasıl çıkaracak?" → HAKLI. Bu yüzden **AI YOK, misafir-sayısı YOK** (rezervasyonda guestCount, mülkte kapasite
YOK — koddan doğrulandı). Mantık: her çıkışta TÜM yataklar toplanır → ihtiyaç **turnover'a** bağlı, kişi sayısına değil.
- **Deterministik:** host mülk başına bir kez profil girer (giriş başına adet); sistem rezervasyonlardan giriş sayısını
  bilir (takvimin kullandığı ayni veri) → **giriş × profil = liste**. Sıfır tahmin/mesaj-okuma/AI.
- **Şema (migration 11_supply_profile):** `Property.supplyProfileJson` (NULLABLE JSON `{itemKey:qtyPerArrival}`, additive,
  taze PG'de 00→11 sıfır-drift). Katalog `SUPPLY_ITEMS` (constants.ts, stable key'ler; çarşaf/nevresim/havlu + sarf).
- **`src/lib/supply.ts`:** `parseSupplyProfile`/`serializeSupplyProfile` (tolerant — unknown-key/0/negatif eler, 999 cap) +
  `getPrepPlan(orgId,{days,now})` = arrivals-in-range × profil, İstanbul gün-penceresi (UTC+3 sabit), `confirmed/completed`
  (cancelled hariç — takvim filtresiyle ayni), org-scoped (IDOR yok). Guest-count-free; PII yok (sadece adet + daire adı + giriş sayısı).
- **UI:** Mülk sayfasına "Malzeme Profili" editörü (self-contained PATCH; `propertySchema.supplyProfile` = z.record(enum,int0-999)
  → bilinmeyen key reddedilir, JSON kolonuna çöp yazılamaz; partial PATCH → normal mülk kaydı profili SİLMEZ). Yeni **/hazirlik**
  sayfası + nav ("Hazırlık"): Alınacaklar (sarf) / Hazırlanacak (çamaşır) / daire-bazında + profilsiz-daire uyarısı + 1/7/14 gün.
- **Takvim DEĞİŞMEDİ** (kullanıcı "büyük değişiklik mi" dedi ama takvim çalışıyor + doğru — bozmadım; bu ayrı, tamamlayıcı araç).
- **✅ GÖREV CHECKLIST BİRLEŞMESİ UYGULANDI (commit `873e5f7`):** kullanıcı direktifi — mevcut turnover görevine profilden
  çarşaf/malzeme checklist'i otomatik dolsun. `buildSupplyChecklist(profile)` → `{label:"Çarşaf takımı × 2",done:false}[]`;
  `createReservationTasks` bunu **"Çıkış temizliği" (cleaning)** görevine takıyor (temizlikçinin fiilen açtığı turnover işi;
  açıklaması zaten "çarşaf/havlu değişimi"). checkin_prep'e KOYULMADI (basit tutuldu). Profil yoksa checklist yok (davranış aynı).
  Sadece YENİ görevler (idempotency korundu; eski görevler backfill'de güncellenmez). +2 test. **697 test yeşil.**
- **✅ AI "BUGÜN AL" ÖZETİ UYGULANDI (kullanıcı onayı "evet, env-gated + buton"):** /hazirlik'e KOZMETİK AI özeti (deterministik
  liste zaten net rakam veriyor; bu sadece cümleye çevirir). **OpenAI-UYUMLU** (`src/lib/supply-ai.ts`): `SUPPLY_AI_API_KEY`
  (unset→buton gizli/no-op), `SUPPLY_AI_BASE_URL` (default `https://api.akashml.com/v1`), `SUPPLY_AI_MODEL` (default `glm-5.2`).
  **Buton-tetikli** (`SupplyAiSummary` client comp) → 8s gecikme sayfayı BLOKLAMAZ. Endpoint `POST /api/hazirlik/summary`
  (withAuth, org rate-limit 20/saat, planı SUNUCUDA org'dan yeniden-hesaplar → IDOR yok). **PII YOK:** modele sadece adet+giriş
  sayısı gider (plan zaten misafir PII taşımıyor); 30s timeout, never-throw. .env.example'a eklendi. +6 test.
- **✅ "DAİRELERE KOPYALA" (SEÇİLEBİLİR, kullanıcı UX itirazı — 20 daireye tek tek girmek işkence):** Malzeme Profili formuna
  "Dairelere kopyala" → checkbox listesi (tümü seçili gelir, "tümünü seç/kaldır") → "Seçili N daireye uygula" (onaylı). +
  `POST /api/properties/bulk-supply-profile` (withManage, opsiyonel `propertyIds` alt-küme; array→sadece onlar, absent→tümü;
  `updateMany` org-scoped = IDOR yok — yabancı id organizationId'ye takılmaz). `bulk-times` deseni. +7 test (tümü/seçili/boş-
  array→0/yabancı-id yok-sayılır/staff 403/IDOR/geçersiz body 400).
- **✅ Settings düzeni (kullanıcı görseli):** "Yapay Zekâ ve Veri Kullanımı" kartı çok yukarıdaydı → **en alta** taşındı
  (Hesabı Sil'in hemen üstü, başlık muted). KVKK şeffaflık notu KALDI (silinmedi) ama artık prominence düşük.
- **[KODLA DOĞRULANDI — kullanıcı sorusu] Check-in/out saatleri gereksiz DEĞİL:** AI onları sistem prompt'una koyup
  (prompts.ts:689-690) "check-in 15:00" diye yanıtlıyor + devir-günü penceresini (çıkış–giriş) hesaplıyor + evidence
  (`property:checkInTime`). Settings toplu-form ile mülkteki alan AYNI veriyi (property.checkInTime) yazıyor (toplu=kolaylık,
  çakışma yok). KB serbest-metin, saat yapılı-veri → farklı işler. Silinecek/redundant bir şey yok.
- **✅ STOK TAKİBİ + MİSAFİR-+1 UYGULANDI (2026-07-10, commit `9e48a85`, migration 12) — kullanıcı "ikisini de yap":**
  İkisi de deterministik, additive, opsiyonel.
  - **STOK (org-level):** `Organization.supplyStockJson {itemKey:qty}`. `getPrepPlan` artık **net** gösteriyor:
    `toBuy = max(0, ihtiyaç − elde)` (asla negatif). /hazirlik'e "Eldeki stok" açılır editör (`PATCH /api/hazirlik/stock`,
    withManage, org SESSION'dan → IDOR yok). Boş = brüt (bugünkü davranış). AI özeti de net (toBuy). Stok org-geneli
    (host merkezi alır) — profil per-daire.
  - **MİSAFİR +1:** yeni `SupplyRequest` tablosu. `detectSupplyRequest` (task-triage-only kelime-net; EXPLICIT ekstra-sinyal
    (ekstra/fazladan/daha…) + tekstil kalemi ŞART → "havlular güzel"/"çarşaf nerede"/"kahve daha" tetiklemez; +1/kalem).
    `recordSupplyRequestFromMessage` sync'te inbound mesaj oluşunca (auto-reply ayarından BAĞIMSIZ, hospitable-sync.ts)
    best-effort + message-id dedup. Plana 7-gün pencerede eklenir + daire-bazında "Misafir talebi: +1 Banyo havlusu" notu.
  - migration 12: Organization'a 1 nullable kolon (ALTER TABLE ADD COLUMN — nullable, no-default → **metadata-only, düşük
    risk** ama "ALTER yok" DEĞİL; sadece yeni SupplyRequest tablosu ALTER'sız) + 1 yeni tablo. Taze PG'de 00→12 sıfır-drift.
- **✅ +1 SERTLEŞTİRME (2026-07-10, commit sonraki, migration 13 — codex+adversarial review bulguları):** kullanıcı "herkese
  otomatik açma" + yanlış-tetikleme örnekleri ("ekstra havlu var mı/ücretli mi/istemiyorum/getirmeyin") + DB-unique + wording.
  - **Opt-in toggle** `Organization.autoSupplyRequestEnabled` (default OFF) → detektör kapalıyken HİÇ çalışmaz. Ayarlar→
    Otomasyon Tercihleri'nde açıklamalı. `recordSupplyRequestFromMessage` önce ucuz keyword, SONRA (eşleşirse) org-toggle sorgusu.
  - **Detektör sıkılaştırıldı:** artık ŞART = extra-sinyal + **gerçek istek-fiili** (alabilir mi/rica/getirir mi/lütfen/could we
    get…) + tekstil kalemi + **olumsuzluk-guard** (istemiyorum/getirmeyin/gerek yok) + **soru/fiyat-guard** (var mı/ücretli mi/
    ne kadar). Review'ın bulduğu "bir dahaki sefere / bir daha yıkanmalı" artık tetiklemiyor (istek-fiili yok). +kullanıcının 4 örneği test.
  - **DB-unique** `@@unique([sourceMessageId,itemKey])` (SupplyRequest YENİ tablo → güvenli; NULL'lar Postgres'te distinct) →
    app-level findFirst artık yarış-korumalı; createMany `skipDuplicates`. migration 13: pre-unique dedup DELETE (ctid) + kolon +
    unique + eski redundant index DROP. Taze PG'de 00→13 **sıfır-drift**.
  - **+18 test (12'de) + toggle-OFF/ON + 4 FP örneği. 729 test yeşil.** ⚠️ v1 tavizler (KESİN ifade — codex nüansı):
    (a) İstek satırı 7 gün sonra **DB'den SİLİNMEZ**; `getPrepPlan`'in 7-gün lookback penceresi dışında kaldığı için sadece
    **raporda hesaba katılmaz** (satır kalır, PII yok — ileride retention'a eklenebilir). (b) Ungated kısa pencerede prod'a
    düşmüş olası hatalı +1 satırı **tamamen zararsız DEĞİL**: 7 gün boyunca alışveriş hesabını +1 etkileyebilir; ancak
    **sınırlı ve kendiliğinden geri dönen** (8. günde hesaba girmez) bir etkidir. (c) Stok ELLE güncellenmezse kayar (girmezse
    brüt — güvenli default). Manuel "karşılandı/kullanıldı" işareti v1'de yok.

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

## 🔍 40-AJAN LANSMAN DENETİMİ (2026-07-10, 2×10 doğrulama ajanı + codex bağımsız tam-tarama — NEREDEYSE BİREBİR ÖRTÜŞTÜ)
Kullanıcı codex'in tam raporunu verdi; benim 20 ajanım (batch-1+2) aynı bulguları kodla teyit etti. **Codex direktifi (benimsendi):
topluca uygulama; her P0'ı yeniden doğrula, küçük bağımsız commit + regresyon testi; migration/ödeme/legal'de KULLANICI ONAYI;
"test yeşil" demeden ÖNCE migration-chain + next build + adversarial testi gerçekten çalıştır.**
**ÇEKİRDEK TEMİZ (teyitli):** IDOR yok (58 route org-scoped) · RBAC matris sistematik doğru · oto-gönderim claim-then-send atomik ·
entitlement anchor'ları stabil · migration 00→13 sıfır-drift · boot/seed/secret fail-safe · MutationObserver konsol-hatası = tarayıcı eklentisi.
**✅ FAZ-1 DÜZELTİLDİ (commit `8604b7c` + `ab05f3a`):** (1) A2 requireAuth epoch (soft-nav'da çalınan oturum sayfa-okuması) + (2) requireSession/
requireAuth **DB-yetkili role/org** (düşürülen manager stale-JWT) · AI3 kurucu "İsa" string jenerik · AI1 stil-profili redaksiyon · H3+hazirlik/summary
premium-gate · iCal feed kanal/referans gizli-modda çıkmıyor · R1 openProblems count() · sidebar overflow. +2 test. **730 test yeşil.**
**🔴 LAUNCH-BLOCKER — KULLANICI ONAYLI YAKLAŞIM (Paddle):** gerçek upgrade/downgrade — downgrade=dönem-sonu (Paddle scheduled change),
upgrade=hemen + kalan-gün proration (Paddle kolay verirse, yoksa düz). Aktif abonede yeni-checkout KİLİTLE + iptal/portal linki. **ORTAK İŞ:**
kod bende AMA Paddle panelinde müşteri-portalı+subscription-update aç + SANDBOX'ta birlikte test etmeden gerçek ödemeye açma.
**✅ FAZ-2 "A" TAMAMLANDI (2026-07-10, commit'ler `b241a8f`·`eb14371`·`853118d` + öncesi):** T1 görev checklist UI
(etiket+işaretle+persist, staff izinli) · sync cursor idempotency (lastMessageAt döngü sonrası) · **oturum DB-yetkili role/org**
(düşürülen manager) · 2FA fail-closed · TOTP atomik · KVKK foto-unlink · KB-cap · unbounded-query take:500 · **guest-name prompt-injection
sanitization** (`sanitizePromptValue`). **733 test yeşil.**
**✅ FAZ-2 "B" TAMAMLANDI (2026-07-10, commit'ler `7856fae`·`a60d33b`·`0b2eeca`·`2961519`·`73430cf` — hepsi gate-less, migration YOK, küçük bağımsız commit + regresyon testi):**
1. **[SSRF+KVKK, `7856fae`] iCal feed import** (`import/sync.ts`): fetch `redirect:"manual"` (public host artık iç-URL'e 30x ile
   isPrivateHost'u atlayamaz → 3xx `res.ok`'ta düşer) + 15s AbortSignal timeout (slow-loris) · resurrection guard (retention-anonim
   satır `guestName===ANON_NAME` iken re-import ad/notu geri YAZMAZ; tarih non-PII → tazelenir; hospitable-sync guard'ının aynası). +1 test.
2. **[P3, `a60d33b`] Checkout consent planCode↔priceId** (`billing/consent/route.ts`): consent = mesafeli-satış DELİLİ; client planCode'u
   `paddlePriceToPlanCode` (webhook'la ayni PADDLE_PRICE_* map) ile SUNUCUDA çapraz-doğrula → uyuşmazsa 400 (fail-closed), saklanan plan
   fiyattan-türetilen (yetkili). Map yoksa (dev/sandbox) client değeri geçerli → geriye uyumlu. +1 test.
3. **[billing, `0b2eeca`] İki entitlement fail-safe** (`billing/subscription.ts`): (a) `trialing` + trialEndsAt=NULL artık EXPIRED
   sayılıyor (eski `!= null` şartı → tarihsiz trialing sonsuz ücretsiz veriyordu; enforcement altında) · (b) **founder guard**:
   `PRIMARY_ORG_ID` ASLA paywall'lanmaz (test-ödemesi Subscription satırı açıp sonra lapse etse/webhook yanlış map'lese bile) — sadece
   `active` zorlanır, görünen plan/status bozulmaz; explicit env-id ile → müşteri org'unu asla kapsamaz. +2 test.
4. **[güvenlik, `2961519`] photoUrl scheme guard** (`validators.ts`): task photoUrl hem `<a href>` hem `<img src>` render ediliyor →
   same-org staff `javascript:`/`data:`/`//host` ile owner'a stored-XSS atabilirdi → yalnız same-origin relative (`/uploads/…`) VEYA https
   kabul; gerisi red. +2 test.
5. **[billing, `73430cf`] QR concierge gate tutarlılığı** (`guest-chat.ts`): `resolveGuestChat` `getEntitlement().active`'i DOĞRUDAN
   kullanıyordu (canceled sub'ı billing DORMANT iken bile blokluyordu — tek dormant-gate'leyen paid yüzey) → `premiumAllowed`'a çevrildi
   (diğer tüm AI yüzeyleriyle ayni dormant-safe kapı; kill-switch QR'ı da geri açar). Bugünkü enforced prod'da davranış AYNI. Test güncellendi (+1).
**740 test yeşil · typecheck temiz · next build temiz.**
**✅ QR PER-STAY DEVICE BINDING UYGULANDI (2026-07-10, commit `982b338`, migration 14):** kullanıcı onayı "konaklama bazlı,
süreli, rotasyonlu". Sabit fiziksel QR bir BEARER credential → eski misafir/temizlikçi QR foto'suyla MEVCUT misafirin sohbet
GEÇMİŞİNİ okuyabiliyordu (codex QR-privacy bulgusu). Fix = **first-scan device binding**: konaklamayı ilk açan cihaz 256-bit
per-stay secret'i (httpOnly `gcs_<propertyId>` cookie) mint edip **atomik** claim eder (`updateMany where chatBoundHash:null` →
first-scan yarışı yok, TOTP-burn deseni). Farklı cihaz → `mismatch` → GEÇMİŞ YOK, model çağrısı YOK, DB yazımı YOK. Rotasyonlu:
her rezervasyon unbound başlar → bir konaklamada yakalanan secret sonrakinde ölü. `bindOrCheckStay` (guest-chat.ts) + GET/POST
`boundElsewhere` + client "başka cihazda açık" bildirimi (composer gizli). **Migration 14** = Reservation'a 2 NULLABLE kolon
(chatBoundHash sha256/chatBoundAt) — ADD COLUMN nullable/no-default → metadata-only, dolu tabloda güvenli; PII değil (hash+zaman)
→ retention dokunmaz; sync/import chatBoundHash'e yazmaz. Zincir 00→14 temiz + **sıfır-drift** (throwaway PG). **Tavizler (belge):**
(a) saldırgan turnover boşluğunda misafirden ÖNCE tararsa stay'i claim eder = DoS (sızıntı değil; misafir host'a sorar), (b) cookie
kapalı tarayıcı/cihaz değiştiren misafir kilitlenir. Host "Misafir Sohbetleri" paneli ETKİLENMEZ (server-side, org-scoped). +7 test. **744 test yeşil.**
**✅ QR (b) KURTARMA — host-side kilit sıfırlama (kullanıcı istedi):** `POST /api/properties/[id]/reset-chat` (withManage, org-scoped→IDOR
yok) daire için `chatBoundHash`/`chatBoundAt`'i temizler → misafir tekrar açınca yeni cihaz claim eder. Mülk sayfası "Misafir Sohbeti"
kartına "Sohbet cihaz kilidini sıfırla" butonu + açıklama. Audit `guest_chat.reset_binding`. Cihaz kaybı/değişimi artık kalıcı kilit DEĞİL. +3 test.
**⏸️ İN-APP upgrade/downgrade (bizim PATCH+preview) — BİLİNÇLİ EKLENMEDİ (BACKLOG, flag: `PADDLE_PLAN_CHANGE_ENABLED`):** portal zaten
upgrade/downgrade/iptal'i Paddle'ın TEST EDİLMİŞ UI'ıyla kapsıyor; sandbox'sız proration kodunu ikilemek untestable para-riski = kötü takas.
İstenirse ilerde gated küçük ek: `PADDLE_PLAN_CHANGE_ENABLED` (default OFF) + `PATCH /subscriptions/{id}` (upgrade `prorated_immediately`,
downgrade `prorated_next_billing_period`) + `POST /subscriptions/{id}/preview` ile önce müşteriye tam tutar gösterip onaylat (fail-closed).
ŞART DEĞİL — portal yeterli; ilk gerçek plan-değişimi hesapta doğrulanınca flag açılır.
**✅ PADDLE ABONELİK YÖNETİMİ v1 UYGULANDI (2026-07-10) — PORTAL yolu (para-math yok):** kullanıcı "sandbox'ı boşver, prod key'ler
hazır, bitir" dedi. Sandbox olmadan proration kodu yazmak canlı-para riski → **Paddle'ın hosted customer portal'ı** kullanıldı
(upgrade hemen / downgrade dönem-sonu / iptal / kart = Paddle'ın TEST EDİLMİŞ UI'ı; proration'ı Paddle sahiplenir, biz HİÇ para
hesabı yapmıyoruz). `createPortalSession(subId)` (paddle.ts): önce `GET /subscriptions/{id}`→customer_id, sonra `POST /customers/
{id}/portal-sessions {subscription_ids}` → `urls.general.overview` (+cancel deep-link); never-throw→null. `POST /api/billing/portal`
(**withManage** = owner/manager, org SESSION'dan→IDOR yok, rate-limit 12/saat, PADDLE_API_KEY şart). UI: aktif Paddle abonesine
"Aboneliği yönet (plan değiştir/iptal)" butonu + **yeni-checkout KİLİDİ** (çift-abonelik önlenir; `manageable` prop) + consent
checkbox gizli (yeni checkout yok). Migration YOK, customer_id on-demand çekilir. **Güvenli taviz:** para-akışı Paddle'da → kötü
senaryoda yanlış endpoint = feature hata verir, müşteri MİSCHARGE OLMAZ. +11 test.
**⚠️ DÜZELTME (canlı test, kullanıcı `iletisimlixusai` hesabıyla gerçek ₺30 ödeme yaptı):** Paddle hosted portal PLAN DEĞİŞİKLİĞİ
YAPMIYOR — sadece **iptal + kart + fatura**. Yukarıdaki "upgrade/downgrade portal'da" iddiası YANLIŞTI. Upgrade/downgrade için satıcı
`PATCH /subscriptions/{id}`'i KENDİ kurmalı ([Paddle docs](https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade/)).
Canlı doğrulanan: checkout ✅ + webhook→abonelik ✅ + checkout kilidi ✅ + portal (iptal/kart) ✅. Nuve'nin "İşletme"si sandbox-leftover
(`404 not_found env=production` — prod API'de yok) → portal 404; DELETE ile temizlenecek (org `cmpwcnpdz...`, Invoice FK `onDelete:SetNull`=güvenli).
`paddleRequest` artık non-2xx'te fırlatıp `reportError`'a `Paddle HTTP <status> (<code>) env=... resource=...` yazıyor (teşhis; id sızmaz).
**✅ İN-APP UPGRADE/DOWNGRADE UYGULANDI (2026-07-10) — portal yapmadığı için ZORUNLU oldu, gated:** `PADDLE_PLAN_CHANGE_ENABLED` (default OFF).
`plan-change.ts`: `planChangeMode` (katalog sırasıyla upgrade/downgrade), `prorationModeFor` (upgrade→`prorated_immediately`, downgrade→
`prorated_next_billing_period`), `resolvePlanChange` (org SESSION'dan sub+priceId+mode, IDOR-proof, DRY). `paddle.ts`: `previewSubscriptionUpdate`
(`PATCH /subscriptions/{id}/preview` → immediate+recurring tutar, defansif parse, best-effort→null) + `updateSubscriptionPlan` (`PATCH
/subscriptions/{id}`; Paddle proration'ı sahiplenir). Route'lar `POST /api/billing/plan-preview` + `/plan-change` (withManage, gated→404,
rate-limit, `billing.plan_change` audit). UI: flag açıkken kartlar "Yükselt/Düşür" → **preview-önce-onayla** paneli (tam prorated tutar
gösterilir) → apply → webhook plan'ı günceller. Flag KAPALIYKEN davranış AYNI (portal-only, kilitli kartlar). Migration YOK. +15 test.
**⚙️ KULLANICI:** test için `PADDLE_PLAN_CHANGE_ENABLED=1` (Railway) → upgrade/downgrade'i hesapta doğrula → kalıcı aç.
**✅ CODEX 3 BOŞLUK KAPATILDI (2026-07-10, migration YOK):** kullanıcı codex raporunu verdi, üçü de kodla teyit + düzeltildi:
1. **[GÜVENLİK] Checkout org-binding** — webhook `custom_data.organizationId`'ye (CLIENT-supplied) güveniyordu → tampered org başka
   tenant'a abonelik bağlayabilirdi. Fix: consent route id döndürüyor (`consentId`), client checkout `customData`'ya koyuyor, webhook
   `resolveOrgId` ÖNCE consent satırından (SESSION-türevli org) çözüyor; ham organizationId sadece legacy fallback. +1 webhook testi
   (forged org yok sayılıp consent org'una bağlanıyor). CheckoutIntent-nonce'un migration'sız hâli (mevcut CheckoutConsent yeniden kullanıldı).
2. **[UX/billing] canceled+providerRef kilidi** — `manageable = provider paddle && providerRef` iptal-edilmiş aboneyi de kilitliyordu →
   lapsed müşteri yeni checkout AÇAMIYORDU. Fix: settings `manageable`'a `status !== "canceled"` eklendi → iptal olan yeniden abone olabilir.
3. **[satış/hukuk] preview-siz onay** — plan-change preview başarısızken (immediateTotal null) upgrade yine onaylanabiliyordu (tutar
   gösterilmeden tahsilat). Fix: FAIL-CLOSED → upgrade'de `immediateTotal` yoksa onay butonu disabled + "Tutar alınamadı, tekrar deneyin".
   Downgrade anında-tahsilat yok, etkilenmez. +2 UI/consent testi. **776 test.**
**✅ CODEX GENİŞ DENETİM — GÜVENLİ BATCH (2026-07-10, migration YOK):** kullanıcı codex'in tam raporunu verdi (30+ bulgu), triaj
yapıldı, önce küçük-güvenli set uygulandı (staff RBAC = büyük parça, SIRADA):
- **[BENİM HATAM] Downgrade metni** — Codex haklı: `prorated_next_billing_period` planı HEMEN değiştirir (limit hemen düşer), sadece
  prorated ücreti sonraki döneme atar. "Dönem sonunda geçerli" YANLIŞTI → metin+buton "hemen geçerli, fark sonraki faturaya" olarak düzeltildi.
- **[GÜVENLİK] Auth fail-CLOSED** — `requireSession` (API) DB hatasında eski JWT ile devam ediyordu (fail-open) → silinmiş/rol-düşürülmüş
  kullanıcı bayat token'la geçebilirdi. Artık DB throw'da `return null` (billing/admin/entegrasyon/export/mesaj hepsi bundan geçer).
  `requireAuth` (sayfa render) lenient kaldı (blip'te toplu-logout olmasın; mutasyonlar zaten API-gated fail-closed).
- **[AI] Çıktı sınırları** — `max_tokens` 900 (reasoning: `max_completion_tokens` 2000) + `detectedLanguage` normalize (2-3 harf kod, yoksa
  "en") + reply/risk/actionSuggestion uzunluk kapları (2000/300/300). Runaway/garbage üretim DB/UI/log'u şişiremez.
- **[Güvenlik] PRIMARY_ORG_ID prod fallback** — `primaryOrgId()` prod'da PRIMARY_ORG_ID yoksa "en eski org"a düşmüyor artık (yanlış müşteriye
  env-token bağlanmasın; prod'da null=fallback yok). Dev/demo'da eski davranış.
- **[iCal] Ghost rezervasyon** — parser `STATUS:CANCELLED` okuyor → yerel rez iptal + auto-task silinir. + **reconciliation**: feed'den
  DÜŞEN (Airbnb siler) GELECEK tarihli rez (aynı kanal) iptal edilir. Guard'lı: boş feed'de mass-cancel YOK, sadece arrivalDate>now, best-effort.
  Reappear'da re-confirm. +3 test (STATUS:CANCELLED · disappeared-reconcile · empty-feed-guard).
**✅ STAFF RBAC UYGULANDI (2026-07-10, kullanıcı #1 isteği, migration YOK):** codex doğrulandı — `staff` (temizlik) pratikte tüm işletmeyi
okuyabiliyordu (tüm görevler/konuşmalar/rezervasyon tutarları/adres/property token'ları/KB, sync tetikleme). 3 KATMAN kapatıldı:
1. **API sınırı (client fetch/mutation):** ~17 route `withAuth`→`withManage` (reservations/kb/conversations[+id/translate/ai-suggest]/
   properties[+id]/reports[ops/daily/monthly]/calendar-sync/hospitable-sync/templates/ai-test/hazirlik-summary/settings-test-email GET dahil).
   Staff artık bunlarda 403. Kalan `withAuth`: tasks (scoped), upload, billing-consent.
2. **Task scoping:** GET (API+PAGE) staff'a SADECE `assignedToId===userId` görevleri; PATCH staff SADECE kendi atanan görevine + checklist'te
   yalnız `done` toggle (etiket değiştiremez/madde ekleyemez — stored label'dan yeniden kurulur; length farkı→403). POST (görev oluşturma) manager-only.
3. **Page sınırı (server-render):** middleware `role==="staff"` → `/tasks` dışındaki tüm app sayfasına `/tasks` redirect (server-rendered guest
   mesajı/fiyat/token sızmaz). Nav staff'a SADECE "Görevler" gösteriyor. Tasks page query staff'a assigned-only.
**Taviz/kalan (belge):** capability-enum (tasks.read_assigned vb.) yerine role-tabanlı katman — pratikte aynı sonuç, daha az kod. Property-
atama modeli YOK (staff "atanmış mülk"ü = atanmış görevinin mülkü, görev üstünden görür). +2 task-route RBAC testi.
**🟠 KALAN P0 (kod, çoğu onay-gerektirmez):** ~~QR per-stay izolasyon~~ ✅ (yukarıda, migration 14) ·
~~CheckoutIntent nonce~~ ✅ (consent-nonce ile kapatıldı, üstte) · staff RBAC daralt (atanan mülk/görev — ürün kararı) ·
**createReservationTasks dup-task race** (findMany-then-createMany non-atomik; per-org sync-lock zaten seri, gerçek yarış yalnız eşzamanlı
→ tam-güvenli fix `@@unique([reservationId,type])` migration+prod-dedup → diğer ertelenen unique-constraint'lerle ayni sınıf, ŞİMDİ EKLEME).
**🟡 HIZLI KÜME (çoğu ✅ FAZ-2 A/B'de yapıldı):** ✅A4 2FA fail-closed · ✅A3 TOTP atomik · ✅AI2 KB-cap · ✅R4 foto-unlink · ✅P3 consent
planCode↔priceId · ✅QR BILLING_ENFORCED tutarlılığı · ✅trialing-null-anchor · ✅founder grandfathered guard · ✅unbounded list `take` ·
✅AI prompt-injection guest-name sanitization · ✅iCal ghost-reservation (resurrection guard) · **KALAN:** boot-time env-assertion · webhook D1/D2 (unique+atomik).
**⏳ OPS/LEGAL/ALTYAPI (kullanıcı/avukat):** SELLER bilgisi (gizlilik/koşullarda ham parantez sızıyor→taslak-banner veya doldur) ·
Railway backup/PITR · object-storage (foto) · KVKK-DPA · landing over-promise kopya (cancel-anytime/KVKK/"asla otomatik yanıtlamaz") ·
CI: migration-chain+next build+lint+E2E kapıları, Railway-deploy CI'ı beklesin · DEPLOYMENT.md/README bayat · durable queue/outbox.

## ✅ CODEX FOLLOW-UP TAMAMLANDI (2026-07-10 gece — B3 + A1, migration YOK)
Kullanıcının son Codex-listesi kapatıldı. **797 test yeşil · typecheck temiz · next build temiz.** İki commit + push (origin senkron):
- **[B3 — `afecf74`] Plan-change previewToken (HMAC bağlama):** UI apply'ı immediateTotal yokken kilitliyordu AMA
  `POST /api/billing/plan-change` doğrudan/çağrılabiliyordu (blind/replay apply → anında tahsilat riski). Artık
  `/plan-preview` kısa ömürlü **HMAC token** basıyor (`{org, priceId, mode}` + 10dk exp, `AUTH_SECRET` ile); `/plan-change`
  bunu ZORUNLU doğruluyor + resolved change'e (org+hedef fiyat+mode) karşı yeniden kontrol ediyor. Blind apply / cross-plan
  reuse / cross-tenant reuse / expiry-replay hepsi kapandı. `signPlanChangeToken`/`verifyPlanChangeToken` @ `plan-change.ts`
  (timingSafeEqual). +6 test (no-token/wrong-price/wrong-org/forged-HMAC/round-trip/token-present).
- **[A1 — `12b6613`] `requireAuth` capability fail-closed:** soft-nav'da `(app)` layout yeniden çalışmıyor → o render'da tek
  kapı `requireAuth`. DB-yetkili rolü tazeliyor + epoch zorluyor AMA catch'i (geçici DB hatası) bayat JWT rolünü KORUYORDU →
  yeni-düşürülmüş/çalınan-yükseltilmiş token DB toparlanana kadar owner/manager UI + role-scoped okuma render edebiliyordu.
  Çözüm: oturum fail-OPEN kalır (DB blip'te toplu-logout YOK — imza geçerli) ama **capability fail-CLOSED**: rol okunamazsa
  en-az-yetkili `"staff"`e clamp'lenir (manager UI + role-scoped okuma DB dönene kadar gizli). Super-admin email+env tabanlı →
  etkilenmez. Yazma yolu zaten fail-closed (`requireSession` + `withManage`). +6 unit test (fail-mode sözleşmesi).
- **[flaky test düzeltmesi — `afecf74`]** `auto-reply-channel` checkout-günü sınır testi `departureDate`'i UTC `startOfDay`
  ile kuruyordu ama kapı İstanbul gün-başını kullanıyor → 21:00–24:00 UTC penceresinde patlıyordu. İstanbul gece-yarısına göre
  yeniden kuruldu (deterministik).
- **[✅ KODLA DOĞRULANIP REDDEDİLDİ — CheckoutConsent single-use nonce]** Codex "consumedAt/expiresAt yok, reuse engellenmiyor"
  dedi. **expiresAt zaten VAR** (createdAt + 24h TTL, `resolveOrgId`) + **priceId-match** + **org SESSION-türevli** (saldırgan
  yalnız KENDİ org'una consent açabilir → cross-tenant binding imkânsız). **single-use (consumedAt) BİLİNÇLİ EKLENMEDİ:**
  Paddle `transaction.completed` ve `subscription.created`'ı AYNI consentId ile AYRI + SIRASIZ gönderir; ilk gelen event
  consent'i tüketirse diğeri düşer → `transaction` önce tüketirse `subscription.created` null'a düşüp DROP olur → **müşteri öder
  ama entitlement almaz (para-akışı kırılır)**. Mevcut stateless TTL+priceId+session-org yaklaşımı sırasız çoklu-event'e KASITLI
  dayanıklı. Güvenlik hedefi (cross-tenant yok, replay sınırlı) zaten karşılanıyor. Migration/webhook değişikliği GEREKMEZ.

## ✅ 3 BILLING NÜANSI KAPATILDI (2026-07-11, commit `7d72c82` — migration YOK, SystemLock nonce store)
Codex'in dünkü 3 billing nüansı: her biri ÖNCE kırmızı-testle gerçek kanıtlandı, SONRA migration'sız + fail-closed düzeltildi.
**806 test yeşil (+9) · typecheck temiz · build temiz.** Para akışında varsayım yapılmadı.
- **[Nüans 1 — previewToken TEK-KULLANIMLIK]** 10dk expiry ≠ single-use; aynı token replay/çift-tık → 2. Paddle PATCH/tahsilat
  üretiyordu. Token'a rastgele `jti` eklendi; apply Paddle'a DOKUNMADAN ÖNCE `jti`'yi SystemLock'ta (unique @id) **atomik claim**
  ediyor → replay consumed bulur → **409**. BAŞARISIZ apply `jti`'yi bırakır (tahsilat yok → aynı token retry edilebilir).
  DB-backed → multi-replica doğru (in-memory rate-limiter'ın aksine). `consumePlanChangeNonce`/`releasePlanChangeNonce` @ plan-change.ts.
- **[Nüans 2 — gösterilen tutar apply'a bağlı]** Token `amount`'ı taşıyordu ama apply kontrol etmiyordu. Apply artık Paddle'da
  **yeniden preview** yapıp immediateTotal'in (currency formatlı string'e dahil) müşterinin onayladığıyla AYNI olmasını şart
  koşuyor; upgrade'de tutar alınamazsa fail-closed. Sapma → **409 {amountChanged}** → yeniden onay. Client 409'da dialog'u kapatıp
  taze preview'e zorluyor.
- **[Nüans 3 — consent freshness geç webhook'u düşürüyor]** 24h TTL `Date.now()` (GELİŞ) ile ölçülüyordu → Paddle outage/retry
  24h+ sonra gelirse gerçek ödeme düşer (müşteri öder, entitlement yok). Artık imzalı `occurred_at`'e göre: ödeme anında taze olan
  geç-teslim event BAĞLANIR; gelecekteki occurred_at (5dk skew ötesi) veya gerçekten bayat consent FAIL-CLOSED; occurred_at yoksa
  geliş-zamanı fallback (para-güvenli, saldırganca uzatılamaz — occurred_at imzalı gövdede). `resolveOrgId` + `applyTransactionEvent`
  occurredAt taşıyor. **consumedAt EKLENMEME kararı korundu + test edildi** (transaction+subscription aynı consentId'yi paylaşıyor).
- **Kırmızı-önce kanıt:** nüans1/2 → 4 yeni test mevcut kodda 200 dönüyordu (409 bekleniyordu); nüans3 → geç-retry count 0 (1
  bekleniyordu) + future count 1 (0 bekleniyordu). Fix sonrası hepsi yeşil. **SystemLock nonce rows** `plan-change-nonce:{jti}`,
  expired olanlar opportunistic sweep'le silinir (token zaten expired → replay imkânsız).

## ✅ 2 BILLING GAP DAHA KAPATILDI (2026-07-11, commit `5b6b25f` — migration YOK) — billing artık "tamam"
Codex bağımsız incelemede 2 gerçek açık daha buldu; ikisi de kırmızı-önce testle kanıtlanıp migration'sız + fail-closed düzeltildi.
**817 test yeşil (+11) · typecheck temiz · build temiz.**
- **[Gap A — ambiguous vs definitive Paddle hatası]** `updateSubscriptionPlan` false dönünce nonce'ı KOŞULSUZ release etmek
  güvensizdi: Paddle genel API'de idempotency key YOK ve PATCH timeout/5xx/network'te aslında UYGULANMIŞ olabilir → release +
  retry = 2. PATCH (çift-tahsilat). Sonuç tipi ayrıldı: **definitive** (4xx = Paddle reddetti, uygulanmadı → release + güvenli
  retry) vs **ambiguous** (5xx/408/network/abort = uygulanmış olabilir → nonce TÜKETİLMİŞ kalır, ASLA yeniden gönderme). Ambiguous'ta
  route `GET /subscriptions` ile **reconcile** eder: hedef price uygulanmışsa başarı (reconciled); değilse **202 pending**, webhook
  settle eder. Yeni: `classifyPaddleFailure` + `getSubscriptionCurrentPriceId` @ paddle.ts. Client 202'de dialog kapatıp refresh.
- **[Gap B — resolveOrgId bayat-consent lifecycle]** Bilinen bir subscription'ın lifecycle event'leri (updated/past_due/canceled)
  ORİJİNAL consentId'yi taşır; bir ay sonra consent 24h'i geçince event DÜŞÜYORDU → iptal/past_due sessizce yok sayılıp org erişimi
  yanlış kalıyordu. Artık `resolveOrgId` ÖNCE `data.id`/`subscription_id` → mevcut `Subscription.providerRef` eşleşmesini kullanıyor
  (yetkili, bayatlamaz); taze consent yalnız İLK, henüz-bilinmeyen bağlantıda gerekli. Ham org id yine ASLA kullanılmıyor.
- **Kırmızı-önce:** Gap A → 5xx/timeout'ta eski kod 2. PATCH gönderiyordu; Gap B → 30-günlük consent + mevcut providerRef +
  canceled/past_due mevcut kodda DÜŞÜYORDU (sub "active" kalıyordu). Fix sonrası hepsi yeşil. **Testler:** definitive-vs-ambiguous +
  reconcile-success + 202-pending + classify(4xx/5xx/408/network) + GET-price + lifecycle-via-providerRef + unknown-ref-red +
  forged-org-asla. **Codex'in 4 istenen testinin tümü + fazlası karşılandı.**

## ✅ BACKLOG BÜYÜK TURU UYGULANDI (2026-07-11, kullanıcı: "sen başla / en doğru şekilde yap" — 8 commit, migration 15)
Kullanıcı onayıyla ertelenen Codex/backlog kalemleri kapatıldı. **848 test yeşil · typecheck temiz · build temiz.** Her fix kırmızı-önce testli
(uygulanabilen her yerde), 2 adversarial review ajanı + kod-doğrulama döngüsüyle. Commit'ler:
- **[`3bad92d`] Manuel reply çift-gönderim guard'ı:** reply route'unda hiç server-side idempotency yoktu (çift-tık/proxy-retry → misafire
  2 kez gider). `src/lib/outbound-claim.ts`: SystemLock-claim `{conversationId, sha256(body)}`, atomik create; başarısız gönderim release
  eder, farklı metin hiç bloklanmaz, fail-OPEN (dedup gate'i teslimat gate'i değil). QR host-reply de aynı guard + $transaction. TTL **120s**
  (review bulgusu: Hospitable worst-case ~87s [4×20s+backoff]; 15s TTL'de sweep canlı claim'i silip double-send açıyordu). +5 test.
- **[`84707c5`] Sync adopt-and-heal:** dış-id'siz (externalId NULL — provider id dönmedi / POST-id≠GET-id) app cevabı sonraki sync'te
  duplicate "Ev sahibi" satırı oluyordu (BUG1 kalıntısı). Import artık outbound api-mesajı için aynı-gövdeli id'siz yerel satırı (en eski)
  ADOPTE edip externalId'sini iyileştiriyor; inbound asla adopte edilmez, gerçek id asla ezilmez. Deep-sync legacy NULL satırları da iyileştirir. +2 test.
- **[`992fab5`+`51ddaea`] KVKK customer.* redaksiyonu + cross-tenant guard (migration 15):** hesap-silme `customer.updated`'ı (custom_data YOK)
  kaçırıyordu → customer_id üzerinden redaksiyon eklendi. Review bulgusu: Paddle müşteriyi e-postayla dedup'ladığı için cid tek-org garanti DEĞİL →
  loose learn başka tenant'ın satırını silebilirdi. Fix: `Subscription.customerId` (migration 15, webhook YETKİLİ çözümde saklıyor — consent/providerRef,
  asla ham custom_data), erasure ONU kullanır (legacy fallback: yalnız org'un kendi providerRef'ine bağlı satırdan öğren), pass-2 BAŞKA org'un
  custom_data'lı satırına ASLA dokunmaz. Kırmızı-önce: paylaşılan-cid senaryosu kurban satırını gerçekten siliyordu. Belgeli residual: custom_data'sız
  gerçekten-paylaşılan customer.* satırı yine redakte edilir (sahiplik belirsiz; iskelet kalır). +3 test.
- **[`3ffbe50`] AI-gate geçmiş+ad injection vetosu:** gate yalnız last.body tarıyordu; model son-6 geçmişi + misafir adını görüyor → önceki mesaja/
  Airbnb-kontrollü ada gömülü injection kapıyı atlıyordu. Gate opsiyonel `context {history, guestName}` alıyor; SADECE deterministik injection
  detektörü koşulur (risk kelime-ağları last.body'de kalır — eski çözülmüş şikayet bugünkü wifi cevabını bloklamasın). Auto-reply call-site modelin
  gördüğünü birebir geçirir; QR mustEscalate'e ad backstop'u. +8 golden (tehdit+övgü-tuzağı çiftleri; TR+EN; 96 golden yeşil).
- **[`0081338`] Review-düzeltmeleri:** claim TTL 15s→120s (üstte) + **retention era-filtresi**: scrubbed konaklamada retention-cutoff'tan ESKİ mesajlar
  asla yeniden import edilmez (redakte gövde body-match edemez → duplicate + AD DİRİLTME oluyordu; kırmızı-önce kanıtlı). `retentionCutoff()` data-retention'dan tek-kaynak. +1 test.
- **[`51ddaea`] Migration 15 `15_invoice_unique_customer_id`:** `@@unique([provider, providerRef])` Invoice'ta (webhook D1 — findFirst+create artık
  yarış-korumalı: create + P2002-catch, unique gerçek hakem) + `Subscription.customerId`. Migration pre-dedup DELETE'li (en eski kalır, NULL-ref'lere
  dokunmaz); taze PG'de 00→15 + sıfır-drift + **DOLU-TABLO KANITI** (dup'lu tabloda deploy edildi, boot temiz). ⚠️ Task `@@unique([reservationId,type])`
  BİLİNÇLİ EKLENMEDİ: manuel görevler de reservationId bağlıyor (meşru 2. görev bloklanırdı), kısmi-unique Prisma'da modellenemez (drift-protokolü kırılır),
  sync kilidi o yarışı zaten serileştiriyor.
- **[`7901c4c`] Sertleştirme beşlisi:** (1) iCal SSRF `resolvesToPrivate()` — fetch anında DNS A/AAAA private-check (string-gate'in göremediği
  "public hostname→iç IP" vektörü; lookup hatasında fail-open, TOCTOU-rebind residual belgeli). (2) **Boot fail-fast**: prod'da AUTH_SECRET yok/placeholder →
  boot reddi (register() cron-return'lerinden ÖNCE; dev etkilenmez). (3) **Deep-sync kadansı SystemLock'ta** — tüm replikalar tek takvim, restart artık
  ekstra 540g süpürme tetiklemez. (4) `getMonthlyReport` İstanbul takvim-ayı (UTC+3 sabit, exclusive end). (5) `conversationReplySchema` rezerve gönderen
  adları reddeder ("GuestOps AI" sihirli-string self-inflate + "Lixus AI" bot-taklidi). +14 test.
- **[`adab75a`] CI kapıları:** mevcut CI deploy branch'inde HİÇ koşmuyordu (yalnız main/PR) → branch eklendi + **migration-chain job'ı** (taze PG'de
  00→N replay + `migrate diff --exit-code` sıfır-drift = elle yürüttüğümüz protokol otomatik) + **build job'ı** (`npm run build`). Railway'i bloklamaz
  (sinyal); "Wait for CI" istenirse Railway panelinden.
**REDDEDİLEN/ERTELENEN (gerekçeli):** Tam outbox tablosu (`OutboundMessage`/`DeliveryAttempt`) — claim-then-send + adopt-heal + idempotent
externalId zinciri pratik riskleri kapattı; outbox'ın artısı ölçekte durable-retry, canlı mesaj akışına dokunan mimari değişiklik → launch sonrası
birlikte-testle. Object storage (S3/R2 env+bucket = kullanıcı/ops) · Railway backup/PITR (ops) · "Wait for CI" (Railway paneli).

## ✅ CODEX KAPANIŞ TURU (2026-07-11 öğle — D2 + E2E kapısı; kullanıcı ilkesi: "Codex'in dediğini mantıklıysa yap")
Kullanıcı direktifi kalıcı: Codex önerileri KÖRÜ KÖRÜNE uygulanmaz — mantıklıysa yapılır, değilse gerekçeli reddedilir. Bu turda:
- **[`5ead13c` — D2 atomik sıralama]** webhook `occurred_at` vetosu read-check-write'tı (upsert etrafında findUnique) → iki EŞZAMANLI teslimatta
  ikisi de bayat okumayı geçip ESKİ event son yazabiliyordu (erişim ters döner). Veto artık `updateMany`'nin WHERE'inde (`lastEventAt <= occurred_at`);
  ilk-event create yarışı P2002'de aynı guard'lı update'e düşer. `pastDueSince` okuması kaldı (yarışta çapa en fazla dakikalar kayar — 14g grace'te
  önemsiz, belgeli). +2 sıralama testi; 5xx-retry testinin hata-enjeksiyonu artık kullanılmayan upsert'ten create'e taşındı.
- **[`5ead13c` — E2E smoke kapısı]** `@playwright/test` + 2 testlik suite: GERÇEK production build'i seed'li Postgres'e karşı boot'layıp
  landing→login→dashboard yürüyor ("app boot olmuyor / auth uçtan uca kırık" sınıfını yalnız bu görür). CI'da yeni `e2e` job'ı (Chromium kur →
  00→N migrate + seed → build → smoke). Lokal + GitHub runner'da yeşil (ilk koşu 4/4). Sandbox'ta `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` ile koşulur.
- **[GERÇEK REGRESYON — smoke İLK koşusunda yakaladı]** e-posta-doğrulama cutoff'undan beri `prisma/seed.ts` demo kullanıcısı HİÇ giriş yapamıyordu
  (403 doğrulama kapısı). Seed artık `emailVerifiedAt` damgalıyor. (E2E kapısının değerini ilk gün kanıtladı.)
- **[`4021901` — CI tek-koşu]** Branch'in açık PR'ı yüzünden her push CI'ı İKİ kez koşturuyordu (push + pull_request merge-ref kopyası) →
  `pull_request` tetikleyicisi kaldırıldı; push-only (main + deploy branch + dispatch). "Cancelled" görünen koşu = concurrency'nin süpersede edilmiş
  eski commit koşusunu iptali (hata DEĞİL — kullanıcıya açıklandı, yorumda belgelendi).
- **[REDDEDİLDİ — outbox tablosu]** Sadece ertelenmedi, ilkece reddedildi: claim-then-send + adopt-heal + cron'un doğal retry'ı pratik riskleri
  kapatıyor; tek-org ölçeğinde sıcak mesaj yoluna kuyruk+worker = risk/fayda tutmuyor. Ölçek gelince (çoklu müşteri + gerçek teslimat-SLA'sı) yeniden değerlendir.
- **[SKIP — lint kapısı]** Repo'da eslint konfigürasyonu yok; typecheck zaten kapıda. Sırf Codex listeledi diye eslint bootstrap'ı = churn.
**CI 4 job GitHub runner'da yeşil.** ~~"Codex'in kod listesinde açık madde kalmadı"~~ — BU İDDİA YANLIŞTI (bir sonraki bağımsız tarama 6 yeni gerçek bulgu çıkardı; "açık iş yok" tarzı mutlak cümle KURMA).

## ✅ CODEX TUR-2 (2026-07-11 akşam — 6/6 bulgu kırmızı-önce doğrulandı ve kapatıldı, migration 16)
1. **[RBAC sızıntı]** staff /tasks org-geneli mülk listesi + backfill sayısı + "Yeni görev" CTA görüyordu; middleware `/tasks/*` açıktı → /tasks/new TÜM mülk+kullanıcı adlarını render ediyordu. Fix: staff exact-/tasks; /tasks/new canManage-redirect; staff mülk çipleri YALNIZ atanmış görev mülklerinden; backfill sayısı manager-only. RSC element-tree testiyle fix-öncesi RED kanıtlı (+3 test).
2. **[iCal MASS-CANCEL — migration 16 `Reservation.calendarSourceId`]** reconciliation propertyId+channel'dı → bir feed, hiç görmediği aynı-kanal rezervasyonları (Hospitable'ınkiler, ikinci feed'inkiler) İPTAL EDİYORDU. Artık import her satırı source'a bağlar (update'te legacy NULL'lar iyileşir), reconciliation SADECE kendi source'una bağlı satırları düşürür. Residual: aynı feed'in kısmi-ama-boş-olmayan cevabı kendi satırlarını yine iptal edebilir (empty-feed guard duruyor). +2 test. Zincir 00→16 sıfır-drift.
3. **[Outbound claim ≠ outbox — dürüst sınır]** `!outcome.ok`'ta koşulsuz release güvensizdi (Hospitable timeout'ta mesaj GİTMİŞ olabilir → release+retry = misafire duplicate). Artık definitive (HTTP 4xx, 408 hariç) → release+retry; ambiguous (timeout/5xx/network) → claim TTL boyunca TUTULUR + kullanıcıya "konuşmayı kontrol etmeden tekrar gönderme" 502'si. Claim store hatası fail-OPEN'dı → fail-CLOSED (503). NOT: bu hâlâ outbox değil — durable delivery-state ölçek işi olarak backlog'da AÇIK kalır ("ilkece reddedildi" ifadesi geri alındı).
4. **[Paddle pending kilidi]** ambiguous 202'den sonra YENİ preview+token ile 2. PATCH mümkündü → SystemLock `plan-change-pending:{org}` (15dk TTL): pending canlıyken preview+apply 409; webhook subscription-event uygulayınca kilidi siler; apply öncesi GET-price hedefteyse PATCH atılmaz (reconciled). +testler.
5. **[Upload]** kullanıcı-başı rate-limit (30/saat); local-disk→S3 backlog'da AÇIK. 6. **[Consent]** withAuth→withManage (staff sözleşme kaydı yapamaz, +403 test).
**✅ CODEX TUR-4 (diff denetimi — 5/5 mantıklı bulunup uygulandı):** pending kilidi upsert→**atomik claim** (updateMany-on-free-slot, holder=hedef priceId; eşzamanlı iki farklı token'dan yalnız biri PATCH atar — deterministik concurrency testi: ilk PATCH askıdayken ikinci apply 409) · webhook settle yalnız guard-uygulandı **VE** event priceId==holder iken (P2002 fallback'ta da count===1 şartı) · iCal legacy-NULL adoption **atomik updateMany** (sahiplik UPDATE içinde yeniden doğrulanır; claim kaybedilirse skip) · STATUS:CANCELLED NULL satırı önce SAHİPLENİP iptal eder, başka source'un satırına asla dokunmaz. +4 test. **863 test yeşil.**
Kalan AÇIK işler: object storage (S3) · durable outbox (ölçekte) · Railway backup/PITR + Wait-for-CI (ops) · QR per-misafir credential · CSV parser rewrite · legalTextHash (#46).

## 📋 YARIN DEVAM — BACKLOG (kullanıcı: "yoruldum, .md'ye yaz, yarın yaparız")
**Bu oturumda BİLEREK BAŞLANMADI (kullanıcı direktifi: yeni büyük parça/migration YOK):**
- **[reliability/BÜYÜK] Outbound idempotency / outbox:** `automation.ts` manuel-reply idempotency (claim-then-send auto-reply'da
  var, manuelde yok) + outbound `externalId`-null dedup ("canlıda doğrula"). Tam çözüm `OutboundMessage`/`DeliveryAttempt`
  outbox tablosu = migration + para/mesaj-akışı → kullanıcı onayı + birlikte test şart.
- **[altyapı/BÜYÜK] Object storage (foto):** task photoUrl şu an local `/uploads` (ephemeral konteynerde kaybolur) → S3/R2. Migration yok ama env+SDK.
- **[altyapı/OPS] Railway backup/PITR** (kullanıcı/ops — kod değil) · **durable queue/outbox** · **boot-time env-assertion** (eksik kritik env'de erken fail).
- **[webhook D1/D2] invoice dedup non-atomic** (findFirst+create; boş tabloda `@@unique([provider,providerRef])` güvenli AMA dolu
  tabloya @unique = boot-fail → önce prod-dedup ŞART, ayrı elle-doğrulanan migration) + occurred_at null/atomic concurrency race.
- **[sync-low] `createReservationTasks` dup-task race** (findMany-then-createMany non-atomik; per-org sync-lock seri → gerçek yarış
  yalnız eşzamanlı; tam-fix `@@unique([reservationId,type])` = yine önce prod-dedup) · deep-cadence multi-replica (module var → SystemLock'a taşı).
- **[güvenlik-latent] iCal DNS-rebinding / 302→internal** (redirect:"manual" + isPrivateHost string-check VAR; DNS-resolve-to-private için dispatcher/lookup gerek) · QR per-guest credential (per-stay device binding VAR; per-misafir auth ayrı iş).
- **[AI-safety — golden gerekli] `passesAutoReplySafetyGate` yalnız `last.body` tarıyor;** geçmiş+misafir-adı (Airbnb-kontrollü) enjeksiyonu kapıyı atlayabilir → gate'i geçmiş+ad'a genişlet (golden senaryo ŞART).
- **[KVKK] erasure yalnız `custom_data.organizationId`'li webhook'ları redakte ediyor;** `customer.updated` (email/ad/adres) bu tag'i taşımaz → customer_id ile de eşleştir.
- **[nit/kopya] `#46 legalTextHash`** (opsiyonel, legalVersion yanına sha256) · account-card error-first→field-first · landing over-promise kopya · getMonthlyReport UTC-ay penceresi · CI kapıları (migration-chain+build+lint+E2E).
- **[CI GAP hatırlatma] test harness `prisma db push` kullanıyor (migration DEĞİL)** → migration-chain drift'i testte yakalanmaz; migration eklerken taze Postgres'te 00→N `migrate deploy` + sıfır-drift ELLE doğrula (CLAUDE.md protokolü).
**[OPS/LEGAL — kullanıcı/avukat, kod değil]:** SELLER bilgisi (`legal-entity.ts` [parantez]) · KVKK-DPA (OpenAI ABD aktarım) · RESEND DNS (SPF/DKIM/DMARC) · Paddle küçük gerçek ödeme birlikte-test · `PADDLE_PLAN_CHANGE_ENABLED=1` ile upgrade/downgrade'i hesapta doğrula.

## Durum
**857 test (+2 E2E) yeşil, typecheck temiz, next build temiz, migrate deploy canlıda doğrulanmış.** 16 migration
(00_init→15_invoice_unique_customer_id) sıfır-drift (taze Postgres'te + dolu-tablo kanıtıyla doğrulandı). Son iş: 40-ajan lansman denetimi →
FAZ-1 (7 bulgu) + FAZ-2 A (T1 checklist UI · sync cursor · oturum DB-yetkili · 2FA/TOTP · foto-unlink · KB-cap · take · prompt-sanitize)
+ FAZ-2 B (iCal SSRF+resurrection · consent planCode↔priceId · billing trialing-null+founder guard · photoUrl scheme · QR gate tutarlılığı)
+ **QR per-stay device binding (migration 14, first-scan claim + rotasyonlu cookie)**
+ **Codex follow-up gecesi: B3 plan-change previewToken HMAC (`afecf74`) + A1 requireAuth capability fail-closed (`12b6613`) + flaky-test fix; CheckoutConsent single-use KODLA-REDDEDİLDİ (para-akışı kırardı).**
+ **3 billing nüansı (`7d72c82`): previewToken tek-kullanımlık (jti+SystemLock nonce) · apply'da tutar yeniden-preview eşleşmesi · consent freshness imzalı occurred_at'e bağlandı (geç retry entitlement kaybettirmez). Kırmızı-önce testli, migration YOK.**
+ **2 billing gap daha (`5b6b25f`): ambiguous-vs-definitive Paddle hatası (5xx/timeout'ta çift-PATCH yok, GET-reconcile/202-pending) · resolveOrgId providerRef-first (bayat-consent lifecycle event'i düşmez). Kırmızı-önce testli, migration YOK. BILLING ARTIK "TAMAM".**
+ **Backlog büyük turu (8 commit, migration 15): manuel-reply claim · sync adopt-heal · KVKK customer_id+cross-tenant guard · AI-gate geçmiş+ad · Invoice unique (D1) · DNS-SSRF · boot fail-fast · deep-kadans SystemLock · İstanbul-ay · rezerve senderName · CI kapıları (yukarıdaki bölüm).**
**⏳ KALAN (küçük): outbox tablosu (launch sonrası, birlikte-test) · object storage (S3/R2 — kullanıcı bucket açmalı) · Railway backup/PITR + "Wait for CI" (ops panel) · QR per-misafir credential (ürün kararı) · CSV tırnak-içi-newline parser (riskli rewrite).** **KVKK sertleştirme batch'i (5 düzeltme,
migration YOK — mevcut alanlara/koda oturdu): Sentry redaksiyon · retention resurrection guard · Paddle webhook PII
minimize · dashboard "bu gece kalan" · outbound gövde ad-redaksiyonu.** Branch =
`claude/great-edison-3zqpZ`, origin ile senkron. 5-tur derin denetim (loop `197ace29`) yapıldı: tur-1..5 =
AI-gate güvenlik yedekleri (rule_violation/discrimination/safety-EN/riskLevel) · sync fencing/dedup/guestName ·
Paddle grace/webhook · iCal PII · impersonation epoch · trial-email retry · QR turnover + wifi-secret · CSV
import sertleştirme · operatör-müşteri login · seed prod-guard · SEO canonical. Bulgular tur-tur azalıyor
(çekirdek iyi örtüldü). Kalan: çoğu KULLANICI/LEGAL kararı (operatör-müşteri billing, retention-window, KVKK-DPA).
