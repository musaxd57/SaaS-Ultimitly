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
**KALAN düzeltmeler (kullanıcı onayladı "hepsini yap" — sırada):**
1. **Staff rol kısıtlama** — staff sadece görev durumu/foto; mülk/şablon/KB
   silme + bulk-times owner+manager'a. (properties/tasks/templates/kb routes)
2. **Çok dilli şikayet gate'i** — TR/EN dışı dilde şikayet oto-yanıtlanmasın
   (automation.ts safety gate + fallback keyword kapsamı).
3. **Mülk isim-dedup** — `linkProperty` isim çakışmasında belirsizse birleştirme
   (hospitable-sync.ts); kullanıcının "serdarı ekrem 1" sorunu.
4. **iCal kanal yapısal fix (HIGH)** — lifecycle göndericiler iCal rezervasyonu
   Hospitable'a yönlendiriyor. Kanal güvenilir ayraç DEĞİL (iCal feed'i de
   airbnb/booking etiketlenebilir) → Hospitable reservation id'sini ayrı alanda
   tutmak gerek. Mesaj-yolu = en hassas; aceleye getirme. Bugün misafire zarar yok.
- **Hafıza/persist:** önemli kararlar repoya yazılır (CLAUDE.md + ROADMAP.md) —
  bu, ephemeral web ortamında claude-mem gibi yerel araçlardan daha güvenilir.

## Çalışma şekli
Kullanıcı: "Bana söyle, ben kodlarım." Fazları sırayla, additive + testli.
Build + `npm test` yeşil olmadan push etme. GitHub'da PR sadece kullanıcı
isterse açılır.
