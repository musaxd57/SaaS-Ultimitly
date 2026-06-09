# CLAUDE.md — Lixus AI proje hafızası

> Bu dosya her oturum başında otomatik okunur. Önemli bağlam, kurallar ve
> "unutulmaması gerekenler" burada tutulur. Plan için → `ROADMAP.md`.

## Ürün
**Lixus AI** — Türkiye odaklı, çok kiracılı (multi-tenant) SaaS. Kısa dönem
kiralama hostları için Airbnb/Booking misafir mesajlarını AI ile otomatik
yanıtlar. B2C; bireysel Türk hostlara satılır. Sahip/operatör: musaxd57
(Nuve, ~10 daire). Dil: **Türkçe öncelikli**.

## Değişmez kural
🚨 **Çalışan ürün BOZULMAYACAK.** Her ekleme *additive*, testli, geri
alınabilir. Riskli adımda önce yedek + kullanıcı onayı. Para/e-posta akışına
dokunan şeyler kullanıcı onayıyla ve ilk denemeler birlikte doğrulanarak açılır.

## Teknik
- **Stack:** Next.js 15 (App Router) · Prisma · PostgreSQL · Railway deploy.
- **Deploy:** `claude/great-edison-3zqpZ` branch'i Railway'e otomatik deploy olur.
  Dockerfile boot'ta `prisma db push --skip-generate && npm start` çalıştırır →
  şema böyle prod'a gider.
- **Multi-tenancy:** `Organization`. Operatör (super-admin, `SUPERADMIN_EMAILS`
  env) müşteri org'larına impersonation ile girer (JWT `actorUserId`/`actorEmail`).
- **Hospitable API:** per-tenant şifreli token (`getOrgHospitableToken`).
  Kullanıcı **sınırlı erişimde** kullanıyor → `financials:read` YOK → gelir
  özelliği bilinçli olarak KALDIRILDI, geri ekleme.
- **Sync:** cross-instance kilit (`SystemLock` "scheduled-sync") + 2-dk in-process
  cron (instrumentation.ts) + dış cron; hepsi `runScheduledSync`. Manuel sync
  `withSyncLock` ile.
- **AI güvenlik kapısı:** source==openai, intent blocklist (şikayet/iade/erken
  çıkış), keyword cross-check, confidence ≥0.75, master `AUTO_REPLY_ENABLED` +
  per-org toggle.
- **2FA:** TOTP (lib/auth/totp.ts).

## ⚠️ Dokunma / dikkat
- **`senderName: "GuestOps AI"`** (automation.ts, reports.ts, sent/page.tsx) bir
  **mesaj-sınıflandırma sihirli string'i** (AI mesajını ayırır). DEĞİŞTİRME —
  değiştirirsen eski/yeni DB satırları bölünür. Sadece görünür markayı rebrand
  ettik; bu string aynı kaldı.
- **Container reset:** ortam ara sıra eski commit'e (365c957) döner. Kurtarma:
  `git fetch origin && git reset --hard origin/claude/great-edison-3zqpZ && npx prisma generate`.
  Gerçek iş hep origin'de güvende.
- **Git push "non-fast-forward":** `git fetch` + `git rebase origin/<branch>` sonra push.
- **Commit author:** "Unverified" olmasın diye `git config user.email noreply@anthropic.com`,
  `user.name Claude`.
- **Tag push proxy'de çalışmıyor** → yedek için TAG değil BRANCH kullan
  (örn. `backup/stable-YYYY-MM-DD`, GitHub MCP `create_branch` ile).

## Önemli env değişkenleri
`SENTRY_DSN` (hata izleme, SDK'sız kodda hazır) · `ALERT_EMAIL`/`ERROR_ALERT_EMAIL`
(hata maili; ERROR yoksa ALERT'e düşer) · `NEXT_PUBLIC_WHATSAPP` ·
`NEXT_PUBLIC_DEMO_VIDEO` (embed URL) · `SUPERADMIN_EMAILS` · `CRON_SECRET` ·
`AUTO_REPLY_ENABLED` · `HOSPITABLE_API_TOKEN` (primary org fallback).

## Mevcut durum (2026-06-09)
- **Faz 0 bitti** (CI, health, audit, KVKK export, Sentry, UptimeRobot, apex,
  yedek branch). Kalan: Railway Pro + Postgres yedeği (kullanıcı akşam alacak).
- **Faz 2 TEMELİ eklendi (DORMANT):** billing modelleri (Plan/Subscription/
  Invoice/WebhookEvent), `lib/billing` entitlement servisi (Subscription yoksa
  *grandfathered → sınırsız* → canlı müşteri asla bloklanmaz), `lib/payments/
  iyzico.ts` (dependency-free, env'e bağlı), `/api/webhooks/iyzico` (secret yoksa
  kapalı). **Paywall KAPALI** (`BILLING_ENFORCED`), hiçbir yere bağlı değil.
  Sandbox anahtarı gelince gerçek checkout çağrıları + (backfill sonrası) paywall.
- **Dependabot** (Faz 3) eklendi: haftalık gruplu güncelleme PR'ları.

## Denetim (5 agent, 2026-06-09) — uygulanan + kalan
Tüm paneller 5 uzman agent ile denetlendi. Genel: ürün sağlam (multi-tenant
izolasyon, auth, AI güvenlik kapısı, KVKK export, billing-dormant hepsi iyi).
**Uygulanan düzeltmeler (regresyon agent'ı "bozulma YOK" onayladı):**
- HIGH: görev `reservationId` cross-tenant doğrulaması (tasks/route.ts)
- HIGH: rapor/dashboard sayımı — null `sourceReference` artık tek tek sayılıyor
- bcrypt 10→12; otomasyon `*EnabledAt` sadece OFF→ON'da damgalanıyor
- TOTP replay koruması (`User.twoFactorLastStep`, totp/login/2fa)
**Düzeltmeler — durum (her biri ayrı agent ile doğrulandı):**
- ✅ Staff rol kısıtlama — owner/manager yönetir, staff sadece okuma + görev
  güncelleme; tüm yıkıcı/config route'lar `canManage` geçitli.
- ✅ Çok dilli şikayet gate'i — DE/FR/ES/IT/AR/RU kelime ağı; verifier'in bulduğu
  false-positive (`roto`→prototype) temizlendi.
- ✅ Benzersiz mülk ismi (app-level, org bazlı, case-insensitive, trim). RİSKLİ
  `linkProperty` SYNC'ine DOKUNULMADI; manuel create/rename'de aynı-isim reddi.
  (Kullanıcının "serdarı ekrem 1" kopya sorununa kalıcı çözüm.)
- ✅ iCal kanal filtresi (GÜVENLİ kısım) — lifecycle göndericiler + önizlemeler
  `channel: { notIn: ["ics","manual"] }` ile iCal/manuel rezervasyonu atlar.
  `toChannel` asla bu ikisini üretmez → gerçek Hospitable mesajı ASLA bozulmaz.
  2 agent (danışman + doğrulama) onayladı.
  ⏭️ KALAN (opsiyonel, ZARARSIZ): CalendarSource ile "airbnb" etiketli iCal feed'i
  hâlâ filtreden geçiyor; tam kapatmak için yapısal `hospitableReservationId` alanı
  gerek (migration + backfill — mesaj-yoluna dokunur, dikkatli/dedike adım). Bugün
  zararsız (iCal UID Hospitable'da geçersiz → gönderim sessizce fail).

## 10-Agent Tam Tarama (2026-06-09) — 3 frontend + 7 backend
Tüm kod didik didik tarandı. KRİTİK / "sistem bozuk" bulgu YOK. Doğrulanan sağlamlar:
tenant izolasyonu, AI güvenlik kapısı, KVKK export, billing dormant, crypto/TOTP/2FA,
XSS yokluğu, prompt-injection direnci, landing iddiaları, per-org token izolasyonu.
**Uygulanan düzeltmeler:**
- E-posta bildirimlerinde HTML injection → `esc()` ile kaçışlama (misafir mesajı/ismi)
- Hesap-bazlı giriş limiti (20/15dk) + login `decryptSecret` fail-soft
- Impersonation owner-seçimi (string-asc "manager"ı öne alıyordu) + `customer.create` audit
- `calendar-sources/[id]/sync` staff geçidi + login `?next=` açık-yönlendirme guard
**Ertelenenler (dikkat/migration/karar gerek):**
- XFF `clientIp` (platform-bağlı; hesap-limiti ile etkili azaltıldı), CSRF (geniş),
  session revocation, validator `.max/.trim` (escaping zaten exploit'i kapattı),
  N+1 perf, sync kilit fencing-token + `@@unique` (önce prod dedup), iCal yapısal alan.
**Launch öncesi (billing açılmadan gereksiz):** landing↔plans.ts fiyat eşitleme,
Mesafeli Satış Sözleşmesi + Ön Bilgilendirme Formu (yasal), Iyzico imza sandbox testi.
- **Hafıza/persist:** önemli kararlar repoya yazılır (CLAUDE.md + ROADMAP.md) —
  bu, ephemeral web ortamında claude-mem gibi yerel araçlardan daha güvenilir.

## Round-3: konuşma↔rezervasyon bağı + 10-agent re-tarama (2026-06-09)
**Yeni özellik (kullanıcı onaylı):** senkron Hospitable konuşmaları artık yerel
Reservation satırına bağlanıyor (`conversation.reservationId`), katı eşleşme
`(propertyId + Hospitable reservation id)`. Create'te set, "unchanged" sync'te bile
backfill — ama ASLA mevcut/insan-bağını ezmez. Etki: AI doğru misafir-adı/tarih
bağlamı alır; iptal/çıkışı-geçmiş rezervasyonda oto-yanıt atlanır (sadece daha
temkinli; gönderim hedefi hep `externalReservationId`, `reservationId` DEĞİL → yanlış
misafire gitme imkânsız). Testli (create + backfill + iptal/geçmiş/bugün gate'i).
**10 agent (3 FE + 7 BE) tekrar taradı → 9 SOUND, 1 gerçek bug bulundu+düzeltildi:**
- 🔴 **2FA setup-bypass** (FE-3): `setup` aksiyonu `twoFactorEnabledAt:null` yazıyordu →
  aktif hesapta çağrılınca 2FA'yı KODSUZ kapatıyordu. Düzeltildi: aktifken setup reddedilir
  (önce disable—geçerli kod ister). Disable guard'ı da `twoFactorEnabledAt` tek başına.
- iyzico webhook (dormant): `?secret=` query kaldırıldı + `timingSafeEqual`.
- email `reservation.channel` fallback `esc()`; tüm string validator cap'leri tamamlandı.
- task-board hata yüzeyleme (status/sil/foto sessizdi); stable list key'ler.
- previewCheckouts iCal/manual filtresi; getMonthlyReport sourceReference dedup (sayım+gelir).
- dashboard "Bekleyen Mesajlar" kartı = new+waiting+problem (liste ile eşitlendi).
- exitImpersonation fail-safe (operatör user'ı yoksa session temizlenir, org'da kapalı kalmaz).
**Sağlam doğrulandı (değişmedi):** mesaj↔doğru daire/misafir eşleşmesi (BE-1 SOUND:
`Property.hospitableId @unique` + liveIds gate same-named çakışmayı yapısal engeller),
oto-yanıt güvenlik kapısı (5 kontrol intact), tenant izolasyonu (53 route), outgoing
token izolasyonu, billing dormant, KVKK export sır sızdırmaz.
**⏳ Kullanıcı kararı/aksiyonu bekleyen:**
- `/api/conversations/[id]/reply` staff geçidi: BE-5 "rol-modeli ihlali" dedi, BE-3 "inbox işi,
  by-design" dedi (agent'lar çelişti) → KARAR KULLANICININ. Staff misafire yanıt yazabilsin mi?
- **`PRIMARY_ORG_ID`** env'i Railway'de kurucu-org id'sine ayarla (env-token fallback'i kilitler).
**⏭️ Ertelendi (pre-launch / zararsız):** admin/export açık-select daraltma (sır YOK, veri
minimizasyonu), oto-yanıt cutoff'unu org-tz'ye taşıma (konteyner UTC iken sorun yok),
prompt'ta guestName fence (pre-existing, defense-in-depth).

## Çalışma şekli
Kullanıcı: "Bana söyle, ben kodlarım." Fazları sırayla, additive + testli.
Build + `npm test` yeşil olmadan push etme. GitHub'da PR sadece kullanıcı
isterse açılır.
