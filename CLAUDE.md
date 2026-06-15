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

## Round-4: staff-reply RBAC + 10-agent final re-tarama (2026-06-10) → 10/10 SOUND
**Karar (kullanıcı):** Staff misafire mesaj GÖNDEREMEZ — sadece owner/manager.
`/api/conversations/[id]/reply` artık `canManage` geçitli (tek request-tetikli
gönderim yolu; diğer gönderenler cron/AUTO_REPLY_ENABLED). UI'da staff için composer +
AI-öner + simüle gizli, salt-okunur thread. inbound-mesaj + status route'ları staff'a açık.
**10 agent (3 FE + 7 BE) doğru kod üzerinde → 10/10 SOUND, 0 broken, 0 güvenlik açığı.**
Doğrulanan kritik yollar: mesaj↔doğru daire/misafir (BE-1), oto-yanıt güvenliği (BE-2),
tenant izolasyonu + staff gate completeness (BE-3: sendOnChannel tek choke-point), 2FA
bypass kapandı (BE-4), giden token izolasyonu (BE-5), billing/KVKK (BE-6), regresyon yok (BE-7).
**Eklenen regresyon testleri** (agent'ların tek tekrar eden notu = test borcu): 2FA setup-guard,
staff task-alan kısıtı, exitImpersonation fail-safe (route-level, requireSession/getSession
mock'lu + gerçek DB). Checkout-day gate testi `startOfDay(now)` ile `<` sınırına sabitlendi.
287 test yeşil.
**⚠️ ÖNEMLİ — ortam kurtarma:** Konteyner gece yenilenince ESKİ snapshot'ta (365c957)
açıldı; tüm işim origin'de (e682dc6) güvendeydi ama local geride kalmıştı → agent'lar eski
koda bakıp yanlış "BROKEN" verdi. ÇÖZÜM: `git fetch origin <branch>` → `git reset --hard
origin/<branch>` → `npx prisma generate` (client şema ile senkron olmalı) → typecheck/test/build.
Yeni oturumda kod beklenenden eskiyse ÖNCE bunu yap.
**⏭️ Ertelendi:** hospitableFetch env-fallback guard, @@unique (prod dedup gerek),
source!=="openai" fallback testi.

## Pre-launch hazırlık (2026-06-10) — devam ediyor
Kullanıcı "Launch öncesi hazırlık" yönünü seçti.
**FİYAT KARARI (3 agent web araştırması, kullanıcı onaylı):** USD/TRY=₺46. Model =
**REVERSE TRIAL**: kayıt → 14 gün tam Pro ücretsiz (KART YOK) → yükseltmezse hesap
DURAKLAR (kalıcı bedava tier YOK — Başlangıç artık ÜCRETLİ). Fiyatlar (aylık, TRY):
**Başlangıç ₺449 (1-2 daire) · Pro ₺899 (3-7) · İşletme ₺1.699 (8+/∞)**; yıllıkta 2 ay
bedava. Düz-tier (daire-başı değil). Çıpalar: HemenKamp ₺499, BasitCRM ₺575, rakipler
$7-12/daire; TRY'de fiyatlamak kozumuz. Hedef %12-18 deneme→ücretli. (Opsiyonel sonra:
mevsimsel duraklat ₺99/ay; yılda bir enflasyon ayarı ~%32.) Reverse-trial sayaç+duraklatma
mantığı billing açılınca (Faz 2) kurulur; plan `code` "free" legacy, o zaman rename.
**Yapıldı:** (a) landing + plans.ts bu fiyatlara güncellendi + reverse-trial mesajı. (b) admin/export açık-select
daraltıldı (forward-secrecy, sır sızdırmaz). (c) **Mesafeli Satış Sözleşmesi** +
**Ön Bilgilendirme Formu** TASLAK sayfaları eklendi (`(legal)/mesafeli-satis`,
`(legal)/on-bilgilendirme`), footer'lara linklendi; satıcı bilgisi `src/lib/legal-entity.ts`
SELLER sabitinde (placeholder). Koşullar + Gizlilik zaten vardı.
**⏳ KULLANICI YAPACAK:** `src/lib/legal-entity.ts` [köşeli parantez] alanları (ünvan/adres/
vergi/telefon) doldurulacak + 4 yasal sayfa avukata inceletilecek.
**Tam ödeme launch'ı için kalan (Faz 2):** Iyzico sandbox anahtarları + imza doğrulama testi,
checkout akışı, Plan tablosu seed, BILLING_ENFORCED açma. Billing hâlâ dormant.

## ÇALIŞMA TARZI — KALICI TERCİH (kullanıcı "ezberle" dedi, 2026-06-10)
**Kullanıcı her iş oturumunda DURMADAN, BOL AGENT ile çalışmamı istiyor** ("en az 10 agent her
seferinde", "full agentları hep kullan", "soru sorma sonunda topla"). Standart davranış: her
turda 8-12+ paralel agent (frontend/backend/güvenlik/hız/müşteri-gözü/strateji), bulgularını KOD
İLE DOĞRULA (agent ~yarı bulguda yanılıyor), sadece gerçek+güvenli olanları uygula, sonunda tek
"karar listesi" sun. **KRİTİK:** Konteyner ara sıra eski snapshot'a (365c957) döner → işi SIK SIK
commit+push et ki sıfırlamada kaybolmasın. Kurtarma: `git fetch origin <branch>` → `git reset
--hard origin/<branch>` → `npx prisma generate`.

## ⏳ LAUNCH ÖNCESİ — KULLANICI/AVUKAT KARARLARI (akşam 2. dalga, ~14 agent sentezi)
Kodla çözülmez; kullanıcı dönünce (önem sırasına göre):
1. **Iyzico iş hesabı + sandbox anahtarları** — tüm ödeme işinin kilidi (kayıtlı işletme+muhasebeci). Gelmeden checkout/trial test edilemez.
2. **KVKK — en keskin risk:** misafir mesajları OpenAI'a (ABD) gidiyor, aktarım MEKANİZMASI yok. Gerek: OpenAI DPA + KVKK **Standart Sözleşme** (Kurul'a 5 iş günü bildir) + "API verisi eğitimde kullanılmaz". Ayrıca: host'larla **DPA (veri işleyen eki)** yok; **VERBİS** kaydı muhtemelen gerekli; gizlilik silme/saklama vaat ediyor ama kodda auto-purge YOK.
3. **legal-entity.ts** [parantez] alanları (ünvan/adres/MERSİS/telefon) — ödeme almadan ÖNCE.
4. **E-posta DNS:** RESEND_API_KEY + RESEND_FROM (doğrulanmış domain) + SPF/DKIM/DMARC — yoksa şifre-kodu/uyarı mailleri spam'e düşer. (.env.example'da hâlâ eski "GuestOps" markası.)
5. **Şifre değişince oturum geçersizleştirme** (sessionEpoch) — UX kararı: diğer cihazlardan çıkış ister misin? + istersen 2FA'da TOTP. (Auth hot-path, birlikte.)
6. **/api/health?strict=1** için 2. UptimeRobot monitörü (sync ölürse haber al).

## ⏳ ERTELENEN GELİŞTİRİCİ İŞLERİ (güvenli ama büyük / prod-hazırlık gerek)
- **Reverse-trial + pause motoru** (signup'ta trialing sub, expiry cron, paused durumu) — pricing çekirdeği, YOK. + `canAddProperty`'yi property-create'e bağla (0 çağrı) + webhook→subscription işleme + Iyzico imza doğrulama (placeholder).
- **`@@unique([conversationId, externalId])`** (mesaj dedup'unu DB-constraint'e taşı) — önce PROD dublör temizliği (yoksa db push patlar). + cron lock-heartbeat + claim-then-send (çift-gönderim savunması).
- **KVKK kodu:** misafir/hesap silme route'u + retention/anonimleştirme cron + gizlilik'te alt-işleyenleri tam say.
- **SEO:** JSON-LD (FAQ/Org/Product), fiyat-karşılaştırma tablosu, lead-form KVKK onay kutusu.
- **Mobil (additive Tailwind):** admin tablo overflow, mesaj balonu break-words, kb ikon-buton ≥40px, modal kenar boşluğu.
- **Bağımlılık (düşük, prod temiz):** next 15.5.18→.19, @types/nodemailer→devDeps, vitest (dev-only CRITICAL) güncelle.

## Airbnb-bypass kararı + şifre-mail akışı + perf + 17-agent dalga (2026-06-10 akşam)
**STRATEJİ KARARI (4 bağımsız web-araştırma ajanı + sentez, hepsi aynı sonuç):** "Hospitable'ı
aradan çıkarıp doğrudan Airbnb'ye bağlanma" fikri **PRATİKTE KAPALI ve PEŞİNDEN KOŞULMAYACAK.**
Airbnb API'si **partner-kapılı, davetle, başvuru kapalı**; "Allow/OAuth" ekranı sadece onaylı
partnerlere çıkıyor (bot yanılttı). Mesajlaşma erişimi sadece partnere. Gayriresmi yol (scraping/
private-API/headless) = **müşterinin Airbnb hesabı banlanır → şirketi bitiren risk**; "Allow dedi"
hukuken korumaz (hiQ kaybetti); KVKK/GDPR yükü ayrıca. Hospitable Connect 3. tarafa ÜCRETSİZ →
marjı yemiyor; o senin Airbnb'ye **dokunma lisansın**. **Doğru yol:** billing'i aç + ödeyen müşteri
bul (asıl risk bu); moat = Türkçe/KVKK/yerel GTM; İLERİDE 2. PMS (Guesty/Hostaway) adaptörü ekle
(`sendOnChannel` tek-nokta zaten hazır); Airbnb partnerliğini ancak yüzlerce host'la (supply kozu) gündeme al.
**ŞİFRE DEĞİŞTİRME — kullanıcı kararı uygulandı:** mevcut şifre SORULMAZ (unutana kurtarma). Yerine
`/api/account/password` artık **2 adım: mail'e kod → doğrula → değiştir.** 8 haneli kod (10^8),
bcrypt-hash'li saklanır, 10 dk TTL, kod-başına 5 deneme **atomik claim** (TOCTOU kapalı), `request`
ayrı sıkı limit (4/15dk, mail-bomba+reroll önler), mail gidemezse kod temizlenir, başarıda audit.
User'a `pwChangeCode*` (nullable) eklendi (db-push güvenli, ajan GO verdi). 7 entegrasyon testi.
⚠️ **ÖNEMLİ — Launch öncesi mail round-trip'i KULLANICIYLA birlikte test et** (RESEND/SMTP prod'da
alert-mail için zaten ayarlı). 2 güvenlik ajanı (savunmacı + saldırgan red-team) inceledi.
**⏳ ERTELENEN auth-sertleştirme (RİSKLİ — auth hot-path / proje kuralı "riskli auth = kullanıcı onayı"):**
(1) **Şifre değişince oturum geçersizleştirme** (`User.sessionEpoch` + JWT'ye göm + `getSession`'da
DB-kontrol): çalınmış oturum şu an şifre değişince düşmüyor — stateless JWT (session.ts DB okumuyor).
Bunu eklemek auth-hot-path'e DB-okuma ekler → KULLANICIYLA + yedekle yap. (2) 2FA açıksa confirm'de
TOTP iste (stolen-session+inbox senaryosunu kapatır; (1) ile birlikte yapılmalı). Yapınca customer-UX
"tüm cihazlardan çıkış" notu da DOĞRU olur. (3) CSRF same-origin (geniş; lax+JSON bugün büyük ölçüde örtüyor).
**PERF (ajan denetimi, hepsi behavior-preserving, regresyon ajanı SOUND onayı):** 3 indeks eklendi
(`Reservation[propertyId,sourceReference]`, `Conversation[propertyId,status,lastMessageAt]`,
`Task[reservationId]` — db-push index-only, kilit ms'ler) + `getOccupancyByProperty` N+1 (mülk-başına
2 sorgu) → tek sorgu. Ertelendi: inbox `take`/sayfalama (veri gizler), auto-reply mesaj-context kırpma (AI yolu).
**Customer-UX ajan disiplini:** ajan ~yarı bulgusunda yanıldı (Railway notu zaten operatöre-özel; "tasks
ayara bağlı" YANLIŞ; "tüm cihazdan çıkış" notu şu an YALAN olurdu). HER iddia kod ile doğrulandı, sadece
gerçek+güvenli olanlar uygulandı (AI-üslup boş-durum, Gönderilenler başlığı). Ders: ajan bulgusunu körce uygulama.
**Toplam bu oturum: ~17 agent** (4 ilk denetim + 2 doğrulama + 1 a11y + 4 strateji/perf + 6 Wave-B).

## Polish + 4-agent denetim dalgası (2026-06-10) — 8 commit, hepsi additive, 288 test yeşil
Kullanıcı "ben yokken durmadan çalış, agent çalıştır, panelleri didikle, hata/yalan olmasın,
bozmadan ekleyebildiğini ekle" dedi. 4 read-only denetçi agent (panel-copy, FE-robustness,
BE-correctness, security) → bulguların GÜVENLİ olanları uygulandı. Agent verdiği genel: ürün
sağlam, KRİTİK açık YOK, IDOR YOK, eksik-RBAC (yıkıcı route) YOK.
**Uygulandı (push'landı):**
- **"GuestOps AI" sızıntısı:** inbox thread'de ham senderName görünüyordu → `displaySenderName()`
  SADECE render'da "Lixus AI"e map'liyor. Saklanan string/WHERE karşılaştırmaları DOKUNULMADI
  (sihirli string intact). ui-labels.ts.
- **AI öğrenme görünür:** Ayarlar→AI Sesi'nde "Lixus AI üslubunuzdan ne öğrendi?" salt-okunur
  panel (aiStyleProfile). Landing'de "önceki cevaplarınızdan öğrenir" mesajı güçlendirildi.
- **Doğruluk:** landing "30 günlük doluluk tahmini" → "daireye göre doluluk (geçen aya kıyasla)"
  (gerçekle eşleşsin); raporlara "X mesaj yanıtlandı ~Y saat kazandırıldı" satırı.
- **Oto-yanıt notu (kullanıcı sorusu): EVET kapatılabiliyor** — Ayarlar→Otomasyon→"Otomatik yanıt
  notu" checkbox'ı (`autoReplyDisclosure`). Ayar metni artık misafirin gördüğü TAM notla birebir.
- **FE sessiz-hata yüzeyleme:** calendar-sources sil, kb toggle/sil, şablon sil, conversation
  status/öner/şablon-yükle/çeviri, logout/exit, auto-reply-toggle, task-board — hepsi HTTP-hata
  + network-reject (try/catch/finally) için kullanıcıya mesaj. page-header `flex-wrap` (mobil taşma).
- **Girdi sınırı/hijyen:** reply `translateTo` ≤20, calendar-source label≤120/url≤2000, template
  update `.max()`, import ham DB-hatası gizlendi (generic), hospitable/diagnostics `canManage` geçidi.
- **Güvenlik:** upload artık MIME değil GERÇEK magic-byte (JPEG/PNG/WebP) doğruluyor + uzantı
  sniff'ten türüyor (staff açık kaldı = görev fotoğrafı). Audit log: login başarılı/başarısız
  (bilinen hesap), şifre değiştir, 2FA aç/kapa, hospitable connect/disconnect. Logout cookie
  `path:"/"` + maxAge:0 ile temizleniyor (bare delete proxy'de kalabiliyordu). CSP **report-only**
  (bloklamaz, sadece console'a ihlal raporu = ileride enforce için zemin).
- **UX:** dashboard stat kartları tıklanabilir (StatCard `href` opsiyonel): Bekleyen→/inbox,
  Görevler→/tasks, Sorunlu→/inbox?status=problem, Doluluk→/reports.
**⏭️ ERTELENDİ (kullanıcı kararı / migration / kırma riski — BİLİNÇLİ):**
- **H1 şifre değişimi "mevcut şifre" istesin mi?** Agent #1 önceliği = hesap-ele-geçirme açığı
  (oturumu olan biri şifreyi kalıcı değiştirebilir). AMA `account/password` BİLİNÇLİ "logged-in
  recovery" için yazılmış + e-posta reset akışı YOK → mevcut-şifre zorunlu yapmak, şifresini unutup
  oturumu açık kalan kullanıcıyı kilitler. Kullanıcıya sorulmadan ÇEVİRMEDİM. Audit log eklendi.
  **KARAR KULLANICININ:** güvenlik mi (mevcut-şifre iste) / kurtarma kolaylığı mı? Reset akışı da gerekebilir.
- **H2 CSRF same-origin:** middleware matcher `/api`'yi DIŞLIYOR (line 56) → orada temiz eklenemez;
  her route'a helper = geniş (daha önce de ertelenmişti). `sameSite:lax` ana vektörü zaten kapatıyor. Ertelendi.
- **M2 impersonation self/super-admin guard** (operatörü etkileyebilir), **BE sync gate'leri**
  (hospitable/sync + calendar/sync staff'a açık = POLİTİKA kararı), **ai-suggest/translate gate**
  (UI'da staff'a gizli + rate-limit'li), **L1 dağıtık rate-limit** (replica'da gerek),
  **L2 TOTP atomicity** (çok düşük risk, login'e dokunur). **ENCRYPTION_KEY rotasyonu = ASLA** (canlı token kırılır).

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

## Görevler "Bugün" filtresi tarih-bug'ı (2026-06-10, 3 agent + kod doğrulama)
**Belirti:** Dashboard "bugün 4 çıkış" derken Görevler→"Bugün (0)", backfill butonu da gizli.
**Kök neden (kod ile DOĞRULANDI, agent'lar çelişti → import kodu çözdü):** iCal/CSV içe
aktarımı tarihleri `new Date(y,m,d,12,0,0)` = **öğlen-UTC** saklıyor ("noon to avoid TZ edge"),
Hospitable ise **gece-yarısı-UTC**. Görevler sayfası `dueDays = Math.round((dueAt −
todayMidnightUTC)/86_400_000)` yapıyordu → öğlen-saklı BUGÜNkü çıkış = round(0.5)=**1** → "Bu
hafta"ya düşüp "Bugün"den gizleniyordu. Dashboard doğruydu çünkü `zonedDayRange` (İstanbul) kullanıyor.
**Düzeltme:** `calendarDaysBetween()` (utils.ts) — iki anı önce İstanbul **takvim gününe** indirip
fark alır; saklama saatinden bağımsız robust. tasks/page.tsx artık bunu kullanıyor. +5 unit test
(öğlen-saklı-bugün regresyonu + 21:00Z tz sınırı). 320 test yeşil.
**İlgili (önceki push, branch'te):** hospitable-sync artık her booking'de `createReservationTasks`
çağırıyor (eskiden sadece iCal/manual açıyordu) → Hospitable rezervasyonları da görev üretir.
**Değişmedi (bilinçli, minimal):** createReservationTasks gate'i + reservationsMissingTasks sayımı
date-fns/UTC-midnight kaldı — görünür bug DEĞİLDİ (gate bugünü zaten >= ile yakalıyor; sayım
today-or-future'ı doğru ayırıyor). Sadece görünür filtre düzeltildi. **Ders:** agent storage
iddiasında çelişince import path'i (ics.ts/csv.ts) okumak gerçeği verdi — körü körüne uygulama.

## 13-agent panel denetimi + Mesajlar/RBAC cila (2026-06-10, commit dfe3c90)
Kullanıcı "tüm panellere bak, 5 FE + 5 BE, son kararı sen ver yaz bana yapmadan önce" dedi.
13 agent (3 "bugünkü görev" + 5 FE + 5 BE), kod-doğrulamalı. Kullanıcı onayı: "önerimi uygula" +
"güvenli olanların hepsi".
**"Bugün 0" KESİNLEŞTİ (3 agent):** bugünkü çıkışların görevleri VAR (backfill butonu gizli =
`reservationsMissingTasks=0` = hepsinin görevi var kanıtı). iCal öğlen-UTC saklı → eski Math.round
"Bu hafta"ya atıyordu; ekran deploy-öncesiydi. calendarDaysBetween fix'i ile "Bugün"e düşer. Veri
kaybı/backfill YOK.
**Uygulandı (dfe3c90):** (a) Mesajlar header: "Tekrarları temizle" müşteri header'ından kaldırıldı
(yıkıcı operatör bakımı; endpoint duruyor, sadece buton gizli — `cleanup-duplicates-button.tsx` artık
import edilmiyor) + arama "Temizle"→"Aramayı temizle" (yıkıcı butonla isim çakışması bitti; arama
HİÇBİR ŞEY SİLMİYOR, sadece filtre reset). (b) AI test kartı eşiği 0.4→0.75 (gerçek oto-yanıt kapısı;
0.55-0.74 "gönderilir" gibi görünüyordu — yalan). (c) Raporlar "son 30 gün" başlığı kaldırıldı
(doluluk=bu ay, şikayet=anlık; her kart kendi dönemini yazıyor). (d) Görevler metni "Rezervasyonlardan
oluştur"→"Eksik görevleri oluştur" + boş-durum çıkmazı. (e) iCal "Senkronla" sessiz-hata: 200 dönse de
import 0 + errors varsa sebep gösteriliyor. (f) **Mülkler staff-RBAC UI:** staff salt-okunur; Yeni mülk/
Mülkü sil/form-kaydet/calendar add-sync-sil gizli, /properties/new staff'ı geri yollar (API zaten 403).
(g) Dashboard tarih org-tz'de (UTC değil) + mobil isim truncate.
**Denetim SAĞLAM çıkanlar:** auth/RBAC/tenant izolasyonu (52 route, IDOR yok), dedup over-delete yok +
canManage-gated + onaylı, arama güvenli, per-org token izolasyonu, AI prompt-injection kalkanı, e-posta
HTML kaçışlama, password 2-adım flow, billing dormant.
**⏭️ Ertelenen low'lar (zararsız):** KB dili "tr"e sabit (ölü alan; lookup dile bakmıyor),
auto-reply-toggle/kb/template `window.alert` (inline değil, tutarsız ama çalışıyor), gece oto-yanıt
on/off sadece Inbox'ta (Ayarlar'da pencere var togglesi yok), test-email `canManage` gate (düşük etki,
rate-limit'li, sabit alıcı), releaseLock fencing-token (bilinen/deferred, dedup externalId ile güvenli).

## Görevler "Bugün" — 2. tur düzeltme (UTC-gün) (2026-06-10)
İlk fix (`calendarDaysBetween`, İstanbul-günü) yetmedi: "10 Haz" etiketli görev hâlâ "Bu hafta"daydı.
**Kök:** etiket `formatDate` UTC-sabit ("10 Haz") ama filtre İstanbul'du → dueAt UTC-akşam saatinde
saklıysa İstanbul'da ertesi güne kayıyor (1) → etiketle filtre çelişiyor. **Çözüm:** `daysUntilDate`
— görevi **dueAt'in UTC takvim gününe** göre kovala (etiketin TAM kullandığı baz), "bugün" = host'un
İstanbul günü. Böylece "10 Haz" görünen görev, saklama saatinden BAĞIMSIZ olarak 10'unda "Bugün"e düşer.
`calendarDaysBetween` kaldırıldı → `daysUntilDate(date, now, tz)`. 4 test (akşam-UTC regresyonu dahil).

## Görevler "Bugün" — GERÇEK kök neden (per-type) (2026-06-10, commit dc11846)
Tarih filtresi DEĞİLDİ. Dashboard "bugün 4 çıkış" ama Görevler Bugün'de o 4 temizlik YOK.
**Kök (agent + kod):** `createReservationTasks` `if (existing > 0) return 0` ile herhangi bir görev
varsa komple çıkıyordu → daha önce sadece check-in görevi almış rezervasyon ÇIKIŞ TEMİZLİĞİNİ asla
alamıyor + backfill butonu da gizli (çünkü "görevi var"). Abdulrahman tek görünen çünkü dashboard
onu Jun-11 sayıyor (akşam-UTC), benim UTC-gün denemem onu yanlışlıkla Bugün'e koymuştu.
**Düzeltmeler:** (a) `createReservationTasks` artık **per-type** — eksik olan check-in/cleaning'i ayrı
ayrı oluşturur (idempotent, her sync'te self-heal, asla çift). +1 regresyon testi. (b)
`reservationsMissingTasks` artık **cleaning'i eksik** rezervasyonları sayıyor (Istanbul sınırı) →
"Eksik görevleri oluştur" butonu çıkıyor, tek tık doldurur. (c) Görevler filtresi tekrar **İstanbul
takvim günü** (`daysUntilDate`) → dashboard `zonedDayRange` ile BİREBİR eşleşir (UTC-gün denemesi geri
alındı). (d) Görev tarih etiketi `formatDayInTz` (İstanbul) → kart-tarihi + filtre + dashboard hepsi
aynı; rezervasyon date-only gösterimleri `formatDate` (UTC) kaldı. **Kullanıcı:** deploy + sync (cron
2dk veya "Mesajları çek") sonra bugünkü çıkışların temizlikleri Bugün'e düşer; ya da backfill butonuyla
hemen. **DERS:** önce tarih-matematiğini suçladım (2 yanlış tur); gerçek sorun EKSİK GÖREV'di — veriyi
(dashboard vs task tablosu) baştan karşılaştırmalıydım.

## Görevler "Bugün" — SON parça: oluşturma gate'i UTC→İstanbul (commit acad837)
Per-type fix sonrası "Eksik görevleri oluştur (4)" butonu DOĞRU çıktı (4 eksik temizlik buldu) ama
tıklayınca **0 oluştu** ("geçmiş tarihli"). **Kanıt = kesin teşhis:** bugünkü çıkışların departureDate'i
**İstanbul gece-yarısı** (21:00Z önceki UTC gün) saklı → UTC-midnight'tan ÖNCE. `createReservationTasks`
gate'i `>= startOfDay(new Date())` (date-fns = sunucu UTC günü) kullanıyordu → bugünkü çıkışı "geçmiş"
sanıp temizliği oluşturmuyordu. Sayım sorgusu (İstanbul sınırı) "eksik" diyordu ama gate (UTC) reddediyordu
— iki sınır çelişiyordu. **Düzeltme:** gate artık `zonedDayRange(now, "Europe/Istanbul").start`. +1 test
(İstanbul-gece-yarısı bugün çıkışı). **İLK hipotezim (İstanbul-midnight storage) DOĞRUYMUŞ** — ajanlar
test fixture'ındaki date-only string'e bakıp "UTC-midnight" dedi, ama GERÇEK Hospitable verisi İstanbul
saatli geliyor. **Ders: canlı veriyi (backfill 0 verdi) erken alsaydım 2 tur kazanırdım.**
**⚠️ Ertelenen (aynı UTC skew, RİSKLİ): oto-yanıt/welcome/checkout göndericileri** (automation.ts
474,922,1014,1096,1154,1230,1383) hâlâ UTC startOfDay — checkout günü sabahı oto-yanıtı yanlışlıkla
atlayabilir. Auto-reply hot-path + pinned boundary testi → kullanıcı onaylı dedike adım.

## Otomatik-mesaj yolu 10-agent denetimi + saat-dilimi/çift-gönderim fix (commit 1f51794)
Kullanıcı "misafire mesaj giden her yere 10 agent koy, hata istemiyorum" dedi. 10 agent (3 saat-dilimi
+ 7 mesaj-doğruluk), kodla doğruladı.
**SAĞLAM (dokunulmadı):** oto-yanıt güvenlik kapısı (hava geçirmez — şikayet/iade asla oto-gitmez),
gönderim hedefi (hep kendi externalReservationId'si — yanlış misafir imkânsız), per-org token izolasyonu
(hava geçirmez), iCal/manuel guard (tam; en kötüsü zararsız boş deneme).
**Düzeltildi (kullanıcı onaylı):** (a) **Saat-dilimi** — görevlerdeki UTC↔İstanbul kayması mesaj
göndericilerinde de vardı: **checkout** (`:1252` arrivalDateKey UTC ≠ tomorrowKey İstanbul → İstanbul-
gece-yarısı saklı çıkışlarda mesaj HİÇ gitmiyordu → `dateKeyInTimeZone(departureDate, tz)`), **check-in**
(`:1014` bugünkü girişi atlıyordu), **welcome** + 3 preview (`gte: startOfDay`→`zonedDayRange`), **oto-yanıt
bitiş kapısı** (`:474` checkout sabahı 00:00-03:00 atlıyordu → `zonedDayRange(now, org.timezone).start`).
`startOfDay` import'tan kaldırıldı (artık kullanılmıyor), `arrivalDateKey` ölü → silindi. (b) **Çift-gönderim**:
welcome/checkin/checkout "gönder-sonra-damgala"ydı → **claim-then-send** (önce atomik damgala, kazanırsan
gönder, gönderim fail'de geri al → retry korunur). 2 eşzamanlı sync artık aynı misafire 2 mesaj atamaz.
(c) **Ölü-talep guard**: declined/expired/not_possible/denied → "cancelled" (hospitable-sync) → mesajlanmaz.
+5 regresyon testi. 326 test yeşil.
**⏭️ Ertelendi (düşük/dar):** oto-yanıt+manuel-yanıt eşzamanlı claim (nadir), lock fencing-token (bilinen),
apartmentNumber sezgiseli ("isimdeki son sayı" — "nuve N" isimlemesinde GÜVENLİ, ileride farklı isimde riskli).

## Mesaj-fix doğrulama (5 agent) + ertelenenler kararı (commit 6bbd23f)
Kullanıcı "yaptıklarını 5 agent kontrol etsin + ertelenenlere 5 agentla bak ne yapılabilir" dedi.
**Wave A (5 agent, yapılanları doğrula): HEPSİ SAĞLAM, regresyon YOK.** Saat-dilimi fix'leri doğru
(geçmiş misafiri dahil etmez, null-tz güvenli), claim-then-send atomik (Postgres row-lock → ikinci run
count=0; rollback-kaynaklı duplicate YOK çünkü dış lock + atomiklik; permanent-miss çok dar+kabul
edilebilir), status guard false-cancel yok, uçtan-uca akış sağlam. **2 mikro-sertleştirme uygulandı:**
`expire`→`expired` (string daralt), claim rollback'lerine `.catch(()=>{})` (rollback blip loop'u kırmasın).
**Wave B (5 agent, ertelenenler) — KARAR:**
- **Oto-yanıt atomik claim:** mümkün (~6 satır, welcome paterni) AMA ERTELENDİ. Sebep: yarış SADECE
  çok-replica/lock-TTL-aşımında olur; **tek replica + in-process `running` flag → bugün İMKÂNSIZ.** En
  hassas yol (oto-yanıt = ürünün kalbi). Sadece status:"new" cron yolu gönderiyor. 2. replica'ya geçince İLK eklenecek.
- **Lock fencing-token:** ERTELE. Çalışan kilide stuck-lock riski ekler; claim-then-send zaten guest-duplicate'i
  kapattı. Gerekirse fencing yerine heartbeat-extend (şemasız, düşük risk).
- **`@@unique([conversationId, externalId])`:** ERTELE. Sadece rapor-sayım/inbound-dup (guest'e gitmez);
  prod dedup gerekir yoksa boot'taki `db push` patlar.
- **apartmentNumber:** ERTELE. "isimdeki son sayı" — "nuve N/serdarı ekrem N" hepsinde DOĞRU (3 yerde
  kopya: automation + ai-suggest + ai/test route). {daire} host-opt-in, hiçbir default'ta yok. İleride
  çok-sayılı isim ("Daire 5 Kat 2") koyulursa opsiyonel `Property.unitLabel` alanı (additive, fallback heuristik).

## KARARLAR + launch-fix turu (8-agent, 2026-06-10)
**Konteyner yine 365c957'e sıfırlandı** → `git reset --hard origin` ile geri yüklendi (iş hep origin'de güvende).
CI YEŞİL (tüm commit'ler success; ci.yml deploy'u bloklamaz). Prod env: OPENAI_MODEL=**gpt-5.1**, RESEND ✓+SMTP ✓.
**FİYAT KARARI: ₺449/899/1699 AYNEN KALSIN.** gpt-5.1 ($1.25/M in, $0.125 cached) gpt-4.1'den UCUZ → maliyet
DAHA İYİ. Tüm tier tipik kullanımda %50-75 marj. Prompt caching ZATEN otomatik aktif (sabit prefix + guest
mesajı ayrı user turn). **Tek açık: İşletme "sınırsız"** ~29-44 daire üstü negatif → **~20 daire fair-use tavanı**
kararı; enforcement billing engine'e bağlı (canAddProperty 0-çağrı + BILLING_ENFORCED + backfill) → billing
build'inde. Prompt few-shot kısaltma = opsiyonel margin (şart değil).
**SESSION KARARI:** tam sessionEpoch ERTELENDİ (mass-logout footgun + UX kararına bağlı). Stress-test forgot-
password'ün oturum öldürmemesini gerçek açık saydı → **ucuz mitigasyon: SESSION_MAX_AGE 30g→14g** (hot-path'e
dokunmaz, aktif kullanıcı etkilenmez, çalınan-token penceresi yarıya). sessionEpoch ileride: layout.tsx'teki
MEVCUT DB-read+logout-guard'a 2 satır (middleware DEĞİL), `epoch != null && mismatch` ile mass-logout'tan kaçın.
**Bu turda düzeltilen (push+redeploy):** [HIGH] middleware PUBLIC_PREFIXES'e `/mesafeli-satis`+`/on-bilgilendirme`
(yasal sayfalar çıkış-yapmışken /login'e atıyordu — gerçek launch bug); SESSION_MAX_AGE 14g; AI güven barı
0.6→0.75. Email hepsi Resend'le gider, stale-brand sızıntısı yok, Sentry aktif. 8-agent: yeni iş hepsi SAĞLAM.

## QR Misafir Concierge + Returning-Guest (2026-06-12, otonom 5-saat turu, ~8 agent)
Kullanıcı "5 saat aralıksız, soru sorma, kodla ilgili her şeyi bitir, agentlar didik didik baksın,
QR'ı sonra ben hallederim" dedi. İki büyük özellik kuruldu — ikisi de **KAPALI-DOĞUMLU**.

**QR Misafir Concierge (KAPALI; kullanıcı kendi/Nuve için açacak):** Daireye asılan QR → public
chat → AI bilgi tabanından **genel** soruları yanıtlar → çözemezse host inbox'ına escalate.
- **İki kill-switch:** `GUEST_CHAT_ENABLED=1` env (global; yoksa her şey 404) **+** `Property.chatEnabled`
  (daire-başı, default false). Kullanıcı go-live'da **env'i set edip** property sayfasından daireyi açar.
- Parçalar: `lib/guest-chat.ts` (token→daire→KB çözücü), `api/chat/[token]` (public uç), `app/c/[token]`
  (sayfa) + middleware `/c` public-prefix, `api/properties/[id]/chat` (owner enable toggle) + property
  sayfası kartı (sadece `GUEST_CHAT_ENABLED=1` iken görünür). Token = `icalToken` deseni (2×UUID).
- **GÜVENLİK (3 red-team agent + uygulandı):** (C1) sır dışlama hem **kategori** (`wifi`/`checkin`) hem
  **içerik-tarayıcı** (kapı kodu/keybox/PIN/wifi şifre regex) — kategori-only "fail-open"du (host kodu
  `faq`/`rules`'a koyabilir). Sırlar prompt'a HİÇ girmez → injection bile çalacak şey bulamaz. (H1) escalate'ler
  `qr-chat:<propertyId>` sentetik thread → `sendOnChannel` bunu **internal** sayar (Hospitable'a ASLA POST etmez;
  yoksa host yanıtı 502 + kaybolurdu). Oto-yanıt cron'u da `qr-chat:` thread'leri dışlar. (Privacy) anonim yüzeye
  **ne misafir adı ne tarih** gider (generic + reservation:null); checkout SAATİ property'den. `/c` → `no-referrer`
  (token referer'la sızmasın). Reddet-ve-escalate kapısı: şikayet/iade/insan/düşük-güven → "ev sahibine ilettim".
  Maliyet: per-IP + per-daire günlük AI tavanı + 2000-char sınır.
- **⏳ KULLANICI/ileride:** env set + daireyi aç + ilk-deneme birlikte test (canlı yüzey). QR'ın return-channel'i
  yok (anonim misafir) — host escalate'i inbox'ta GÖRÜR ama geri yazamaz (v1 by-design). KB'ye kapı kodu koyma!
- **⏭️ ERTELENEN güvenlik (kapalıyken zararsız):** H2 günlük maliyet tavanı in-memory (restart'ta sıfırlanır;
  durable sayaç gerek — çok-replica/Railway churn'de gevşer); M1 XFF rightmost-hop spoofing (tek-replica'da düşük);
  KVKK: misafir sorusu OpenAI'a gider (anonim) → mevcut OpenAI-DPA/Standart-Sözleşme işine dahil et.

**Returning-guest ("N. konaklama" rozeti) — guest.id ile (KAPALI değil, additive):** Diagnostics gerçek veride
`reservation.guest.id` VAR (email/phone Airbnb-maskeli) → güvenilir anahtar. `Reservation.guestExternalId`
(nullable+index), sync'te null-safe yakalanır (sonraki sync'te dolar, eski/manuel satır null). `getReturningGuestInfo`
**sadece guest.id ile** eşleşir (isim/email YOK → sıfır yanlış-pozitif), org-scoped (property.organizationId — tenant
izole, test'li), self+cancelled hariç. Inbox konuşma sayfasında "🔁 N. konaklama" rozeti + geçmiş konaklamalar.
**⚠️ Caveat (prod'da doğrula):** guest.id'nin kişi-başı (rezervasyon-başı değil) STABİL olduğu varsayılır; değilse
rozet sessizce hiç çıkmaz (fail-safe, asla yanlış). 1 gerçek tekrar-misafirle teyit et.

**3 derin audit (oto-yanıt çekirdeği + auth/session + broad-app, hepsi kodla doğrulandı) → HEPSİ SAĞLAM:**
CRITICAL/HIGH YOK, ~57 route'ta IDOR yok, RBAC/auth-bypass/çapraz-kiracı sızıntı yok, saat-dilimi bug sınıfı
temizlenmiş, landing↔plans fiyat eşleşiyor. **Uygulanan LOW'lar:** 2FA-card + task-foto fetch try/catch (network
guard), rapor "Doluluk (bugün)" etiketi, ölü cleanup-duplicates-button silindi, 2 stale yorum. **H2 (durable
maliyet tavanı) yapıldı:** `ChatUsage(propertyId,day,count)` tablosu — QR günlük AI tavanı artık restart/replica
güvenli (in-memory değil).
**⏳ ERTELENEN (auth hot-path = KULLANICI ONAYI, otonom uygulanmadı):** sessionEpoch (çalınan token şifre-reset/
rol-değişiminde 14g'e kadar yaşar), impersonation'dayken account/2fa mutasyon bloğu (L3 — escalation değil).
M1 XFF/distributed rate-limit (replica'da gerek). #3 sync "waiting"-preserve (bilinçli). #5 billing açılınca
Pro-tier feature-gate.
**Bu tur: ~16 agent** (5 QR strateji/güvenlik + 3 returning-guest/feasibility + 5 QR-review/regresyon + 3 derin
audit), hepsi kodla doğrulandı. ~13 commit, 365 test yeşil. **DERS (tekrar):** konteyner flux + arka-plan agent
stash'i uncommitted işi geçici "kayıp" gösterdi → sık commit'le kurtardım. SIK COMMIT+PUSH şart.

## 🔴 PROD CRASH + fix + rezervasyon-penceresi (2026-06-12, aynı tur sonu)
**CRASH (benim hatam, "bozma" ihlali):** `Property.chatToken @unique` ekledim → Railway boot'taki `prisma db push`
(--accept-data-loss YOK) **dolu** Property tablosuna unique kısıt eklemeyi "data loss" sayıp HATA verdi → container
crash-loop, prod düştü. **KRİTİK DERS:** boş local test-DB'sine `@unique` sorunsuz eklenir → local YEŞİL, ama
**dolu prod'da `db push` patlar.** Çözüm: `chatToken`'dan `@unique` kaldırıldı (random 2×UUID → app-level benzersiz
yeter, `findUnique`→`findFirst`). Dockerfile boot komutuna DOKUNMADIM (gerçek yıkıcı değişiklik için data-loss ağı
korunsun). **Kural: dolu tabloya ASLA `@unique` ekleme; gerekiyorsa app-level benzersizlik + findFirst.** (Index
ve yeni-tablo `db push`'ta güvenli; sadece unique-kısıt + required-kolon-without-default + drop patlatır.)
**Rezervasyon-penceresi (kullanıcı isteği + güvenlik kazancı):** QR chat artık SADECE aktif konaklama boyunca açık —
giriş gününden çıkış günü `checkOutTime`'a (İstanbul, dakika-hassas) kadar. Vakit dışı/boş daire → KAPALI (model
çağrısı yok, "aktif konaklama yok" mesajı). Eski misafir QR'ı saklasa da çıkıştan sonra kullanamaz; sonraki misafir
için otomatik sıfırlanır (sabit QR kalır, yeniden basma yok). `resolveGuestChat` `open` döndürür; endpoint+sayfa
kapalı-durumu gösterir. 367 test yeşil.

## Ödeme kararı: Paddle (MoR) + İtalyan Partita IVA (2026-06-15)
**Karar (kullanıcı + 4 araştırma ajanı, kaynaklı):** İşletme **ablanın İtalyan Partita IVA**'sı adına
olacak (kullanıcı 18 yaş altı → yetişkin ablan yasal sahip; isim=Partita IVA=IBAN birebir aynı, sen
yetkili kullanıcı). İtalyan entity → **Iyzico KULLANILAMAZ** (Türk vergi levhası ister). Yerine **Paddle
Billing (Merchant of Record)** seçildi: Paddle satıcı olur, KDV'yi her ülkede toplar/öder → ablan hiçbir
yerde KDV kaydı yapmaz, sadece İtalya'da geliri beyan eder (commercialista). TRY fiyatı destekler (Türk
kartı onayı için kritik; Lemon Squeezy USD-only, Stripe ise Türk KDV kaydı ister → elendi). ⚠️ Türk kartı,
yabancı işyerine sınır-ötesi ödemede daha sık reddedilir (3DS) — Iyzico kadar pürüzsüz olmayacak.
**Kod (eklendi, DORMANT):** `lib/payments/paddle.ts` (env-gated, dependency-free: `verifyPaddleSignature`
HMAC-SHA256 `ts:rawBody` + replay guard, `paddlePriceToPlanCode`, `paddleStatusToLocal`, `paddleRequest`),
`/api/webhooks/paddle` (PADDLE_WEBHOOK_SECRET yoksa 200 disabled; raw-body imza → idempotent WebhookEvent
[event_id] → custom_data.organizationId çözülürse Subscription/Invoice upsert; org yoksa sadece kaydeder,
asla çökmez/yanlış org'a yazmaz). Iyzico kodu dormant DURUYOR (Türk-entity fallback). 14 yeni test (imza
valid/tamper/stale/rotation, dormant/401/activated/dedup/transaction/no-link). **Paywall hâlâ KAPALI** (`BILLING_ENFORCED`).
**Checkout UI eklendi (2026-06-15):** `components/settings/paddle-plans.tsx` (Paddle.js CDN'den yüklenir,
dependency-free; overlay checkout, `customData.organizationId` damgalar → webhook org'a bağlar). Ayarlar'a
"Aboneliğiniz" kartı (owner/manager + Paddle env'li → yoksa görünmez/dormant). Env: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`
+ `NEXT_PUBLIC_PADDLE_ENV` + `PADDLE_PRICE_*`. **CSP şu an Report-Only** → Paddle.js bloklanmıyor; CSP enforce
edilirse `cdn.paddle.com`/`*.paddle.com`/`sandbox-buy.paddle.com` script-src/frame-src/connect-src'e eklenmeli.
Sandbox price id'leri Railway'de; kullanıcı sandbox kurulumunu (client token, API key, webhook secret) yaptı.
**⏳ Kalan:** sandbox'ta sahte kartla BİRLİKTE ilk test ödemesi → Paddle KYB onayı → production price'ları +
prod env → paywall (BILLING_ENFORCED, reverse-trial motoru hâlâ YOK, Faz 2).

## Çalışma şekli
Kullanıcı: "Bana söyle, ben kodlarım." Fazları sırayla, additive + testli.
Build + `npm test` yeşil olmadan push etme. GitHub'da PR sadece kullanıcı
isterse açılır.
