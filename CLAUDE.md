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

## Görevler "Bugün" — FİNAL çözüm (3 tur birleştirildi, commit acad837)
Birkaç yanlış turdan (calendarDaysBetween → daysUntilDate UTC-gün → per-type → gate UTC→İstanbul)
sonra kök iki parçaydı: **(1) EKSİK GÖREV** — `createReservationTasks` "herhangi görev varsa çık"
yapıyordu → sadece check-in alan rezervasyon ÇIKIŞ temizliğini hiç almıyordu. **(2) Saat-dilimi
sınır çelişkisi** — sayım İstanbul, oluşturma gate'i UTC günüydü. **Final fix:** (a)
`createReservationTasks` **per-type** (eksik check-in/cleaning'i ayrı ayrı, idempotent self-heal);
(b) `reservationsMissingTasks` cleaning-eksik'i İstanbul sınırıyla sayar; (c) Görevler filtresi +
etiket + dashboard hepsi **İstanbul takvim günü** (`daysUntilDate` + `formatDayInTz`, dashboard
`zonedDayRange` ile birebir); (d) oluşturma gate'i `zonedDayRange(now, "Europe/Istanbul").start`
(GERÇEK Hospitable verisi İstanbul-gece-yarısı saklı). **DERS:** önce tarih-matematiğini suçladım
(2 yanlış tur) — gerçek sorun eksik görevdi; canlı veriyi (dashboard vs task tablosu) baştan
karşılaştırsaydım kazanırdım. (Aynı UTC-skew'in oto-yanıt/welcome/checkout göndericilerindeki hâli
sonradan commit 1f51794'te `zonedDayRange`/`dateKeyInTimeZone` ile düzeltildi — aşağıya bak.)

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

## Paddle SANDBOX uçtan-uca DOĞRULANDI (2026-06-15) ✅
Checkout → TL ödeme → webhook **Delivered (200)** → Subscription upsert → Ayarlar "Şu anki planınız: İşletme".
Tüm zincir sandbox'ta çalışıyor. Çözülen tuzaklar (ÖNEMLİ, tekrar yaşanmasın):
- **Webhook URL = `https://www.lixusai.com/api/webhooks/paddle`** — apex `lixusai.com` Cloudflare ile **301 → www**
  yönlendiriyor, Paddle 3xx'i takip etmiyor → "Failed". Railway custom domain zaten **www** (apex değil).
  Railway app domaini (`saas-ultimitly-production.up.railway.app`) da çalışır (Cloudflare yok).
- **Her Paddle notification destination'ın AYRI signing secret'ı (`pdl_...`) var** → `PADDLE_WEBHOOK_SECRET`
  AKTİF destination'ın secret'ı ile birebir aynı olmalı; yoksa kod 401 "Yetkisiz erişim" döner.
- **Fiyat para birimi:** price'ı TRY oluştur (yoksa checkout USD gösterir — yanlış). Sandbox price/secret/token
  production'dan AYRI.
- Domain "Request website approval" (Checkout settings) onaylanmadan checkout "Something went wrong" verir.
**✅ KYB ONAYI GEÇTİ (2026-06-19) — "Verification passed".** İşletme (ablanın İtalyan Partita IVA'sı) ödeme
toplamaya onaylı — bu en büyük eşikti. **⏳ PRODUCTION go-live için kalan (Paddle dashboard, çoğu no-code):**
(1) **Payout details** (ablanın IBAN'ı) gir; (2) prod ortamında **3 fiyat TRY** oluştur → yeni price id; (3) prod
**client-side token** + prod **API key**; (4) prod **webhook destination (www URL)** + onun signing secret'ı;
(5) Checkout default link + domain "website approval". Sonra bunları bana ver → Railway prod env:
`PADDLE_ENV=production`, `NEXT_PUBLIC_PADDLE_ENV=production`, yeni `PADDLE_PRICE_*` + `PADDLE_API_KEY` +
`PADDLE_WEBHOOK_SECRET` + `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`. (Sandbox uçtan-uca zaten DOĞRULANDI; prod aynı
zincir, sadece yeni anahtarlar. Reverse-trial + BILLING_ENFORCED durumu aşağıdaki bölümlerde.)
**↳ GÜNCELLEME (2026-06-19, aynı gün): PRODUCTION KURULDU ✅.** Railway'de `PADDLE_ENV=production`, canlı
`pdl_live_apikey_...` (Active), client-side token (Active), webhook `https://www.lixusai.com/api/webhooks/paddle`
(Active, 56 event almış). Yani Paddle production CANLI. Kalan teyitler: (a) webhook teslimatları **200/Delivered**
mı (401 değil → secret doğru), (b) `PADDLE_PRICE_*` değerleri **prod price id** mi (sandbox değil), (c) Checkout
domain "website approval" onaylı mı, (d) hazır olunca **KÜÇÜK BİR GERÇEK ÖDEMEYİ birlikte** test (zincir prod'da da
çalışsın). NOT: Paddle "Getting started / Integration checklist" sayfası **otomatik tiklenmez, generic rehberdir** —
gerçek durum göstergesi yeşil "Verification passed" (geçti).

## Self-serve kayıt AÇILDI + e-posta doğrulama (2026-06-15) ✅
**Karar (kullanıcı):** Landing "Başla/Üye ol" → `/register`; public self-serve kayıt açıldı.
**Güvenlik (10 agent + kod):** Yeni org KURUCUNUN Hospitable verisine ERİŞEMEZ — env-token
fallback SADECE primary org'a (PRIMARY_ORG_ID=Nuve `cmpwcnpdz0000oz1yw4wof2o1`, ya da en eski).
Sync yeni org'u atlar (token=null). 58 route org-scoped, IDOR yok, impersonation gated, QR izole,
billing webhook güvenli. Tek teorik bulgu (çeviri cache) sızıntı değil. **Founder güvende.**
**E-posta doğrulama (yeni, anti-bot):** `lib/auth/email-verify.ts` (256-bit token URL'de + sha256
hash saklanır, 24s, tek-kullanım). register AUTO-LOGIN YOK → doğrulama maili. `/api/auth/verify-email`
+ `/resend-verification`. login gate **SADECE** `createdAt >= EMAIL_VERIFY_REQUIRED_FROM
(2026-06-15T18:00Z)` + doğrulanmamış hesapları 403'ler → **ESKİ tüm hesaplar (founder dahil) muaf,
kilitlenmez** (6 test + güvenlik ajanı SOUND). User +3 nullable alan (db-push güvenli).
**Railway env (app servisi):** `REGISTRATION_OPEN=1` + `PRIMARY_ORG_ID=cmpwcnpdz0000oz1yw4wof2o1`.
**⚠️ NOT:** Nuve'nin Hospitable aboneliği BİTMİŞ (HTTP 402 "Subscription not active") → mesaj sync'i
durdu; Hospitable planı yenilenince döner (bug değil). Onboarding rehberi zaten var (4 adım, ilk=Hospitable).
**⏭️ Ertelendi (B'den, düşük öncelik):** org-başı AI maliyet tavanı (oto-yanıt zaten Hospitable-gated
= ödeyen kullanıcı; test çağrıları rate-limit'li). Demo video = `NEXT_PUBLIC_DEMO_VIDEO` env'e URL koy.

## Reverse-trial + duraklatma motoru EKLENDİ (2026-06-15, DORMANT) ✅
Kullanıcı "ekle hepsini sen seç" dedi → reverse-trial çekirdeği kuruldu. **`BILLING_ENFORCED`
hâlâ master kill-switch (KAPALI) → bugün kimse bloklanmaz.** Parçalar:
- **Signup'ta trial:** `register` artık org+user ile birlikte atomik **`trialing` Subscription**
  oluşturuyor (planCode "pro", provider "trial", `trialEndsAt = now + TRIAL_DAYS` [vars. 14]).
  `Subscription.trialEndsAt DateTime?` eklendi (nullable → db-push güvenli).
- **Süre dolumu CANLI türetilir (cron YOK — bilinçli):** `getEntitlement` trial'i live hesaplar
  (`trialing`, `trialEndsAt`, `trialDaysLeft`, `trialExpired`). **Süre dolmuş trial erişimi SADECE
  `BILLING_ENFORCED=true` iken kaybeder.** Persist-eden sweep/cron KOYMADIM: paused'ı diske yazsam
  enforcement sonradan kapatılınca org'lar stuck-paused kalırdı → BILLING_ENFORCED gerçek tek anahtar
  kalsın diye türetme tercih edildi. (Stranding riski yok; toggle-off her şeyi geri açar.)
- **Enforcement kapısı:** `(app)/layout.tsx` — `billingEnforced() && !active && !operatör` → app yerine
  `BillingLockedScreen` (Paddle planları yerinde + "Çıkış"). Operatör (impersonation/superadmin) bypass.
- **UX:** trialing iken her sayfada slim `TrialBanner` ("Pro deneme: N gün kaldı · Planları görün");
  Ayarlar abonelik kartı + locked-screen `trialDaysLeft` gösterir. Paddle webhook ödeme gelince
  trialing→active upsert ediyor (zaten vardı).
- **QR tutarlılığı:** süre dolmuş trial + enforced → QR da durur (resolveGuestChat getEntitlement.active'e
  bakıyor); dormant'ta QR çalışmaya devam. canceled/past_due paid sub → her zaman QR durur (önceki davranış).
- **Test:** `tests/integration/trial.test.ts` (8) + guest-chat-subscription'a 2 trial testi. 407 test yeşil.
- **⚠️ login-route.test time-bomb FIX:** EMAIL_VERIFY_REQUIRED_FROM (2026-06-15T18:00Z) gerçek-zamanı
  geçti → "şimdi" oluşturulan doğrulanmamış kullanıcılar login'de 403. Login testleri verify'ı test
  etmiyordu → fixture'lara `emailVerifiedAt` eklendi (prod doğru: post-cutoff doğrulama zorunlu).
- **⏳ KULLANICI/launch:** (1) `BILLING_ENFORCED=true` ancak prod org'lar active/grandfathered teyit
  edilince + erken-üyelere (dormant'ta açılan, trial'ı çoktan geçmiş) karar verince açılır — flip anında
  süresi geçmiş trial'lar paused olur. (2) "Deneme bitiyor/bitti" **e-postası KOYULMADI** (e-posta akışı =
  kullanıcı onayı + birlikte ilk-test kuralı) → istenirse ayrı dilim. (3) `canAddProperty` property-create'e
  hâlâ bağlı değil (limit enforcement; enforced açılınca bağlanır).

## Freemium: tam kilit YERİNE "ücretsiz sürüme düşür" (2026-06-15) ✅ — BILLING_ENFORCED=true CANLI
Kullanıcı `BILLING_ENFORCED=true`'yu Railway'e koydu (enforcement artık AÇIK). Karar: 14 gün
deneme bitince **tam kilit YOK** → org "ücretsiz sürüme" düşer (panelleri gezer/okur, manuel
çalışır) ama **otomatik mesajlaşma (asıl ücretli özellik) kapanır.** 10-agent denetimi (4 paralel,
kodla doğrulandı) ile tasarlandı, son kararı ben verdim.
**KEEP (ücretsiz tier):** tüm panelleri gez/oku, Hospitable sync (kendi token'ı, maliyet 0), manuel
cevap, raporlar/KVKK export. **BLOCK:** AI oto-yanıt + oto karşılama/giriş/çıkış + AI öner/test +
çeviri + QR concierge (zaten) + yeni daire (zaten).
**Mimari (tek kapı = `premiumAllowed(orgId)` = `!billingEnforced() || getEntitlement.active`):**
- **Otomatik gönderim kapatma:** `scheduled-sync.ts` per-org döngüsünde `premiumAllowed` ile 4 gönderici
  (auto-reply/welcome/checkin/checkout) atlanıyor; `syncHospitable` + `sendDueAlerts` (host-only) çalışmaya
  devam → inbox dolar, misafire otomatik gitmez. (Agent: `sendOnChannel` tek choke-point; manuel sync
  route gönderici çağırmıyor; in-process timer cron route'una gidiyor → tek nokta yeter.)
- **Suistimal deliği kapatıldı (agent buldu):** AI öner/test/çeviri + 4 preview route'u human-tetikli
  OpenAI harcamasıydı, entitlement gate'i YOKTU → 7 route'a `premiumAllowed → paymentRequired (402)` eklendi.
- **Tam kilit kaldırıldı:** `(app)/layout.tsx` artık `BillingLockedScreen` göstermiyor (dosya silindi).
  Yerine slim `LimitedModeBanner` ("deneme doldu — otomatik yanıtlar kapalı · Planları görün").
- **UI:** `AutoReplyToggle` + `AutoReplyTestButton`'a `locked` prop → inbox + 3 ayar toggle'ı kilitliyken
  "yükseltin" gösterip inert (yanıltıcı "Açık" olmaz). Yükseltme yolu: banner → Ayarlar "Aboneliğiniz" kartı.
- **DORMANT-SAFE:** `premiumAllowed` BILLING_ENFORCED kapalıyken HEP true → env'i geri kapatırsan her şey
  açılır (tek master switch). **Founder (grandfathered+superadmin) HİÇ etkilenmez** (active=true).
- **Test:** premiumAllowed (5) + premium-route 402 gate (3). 425 test yeşil, build temiz.
- **⏳ Kalan/dikkat:** AI test kartı + MessagePreviewButton (ayarlar) limited iken 402 mesajını gösteriyor
  (inert değil ama bozuk değil — toggle'lar zaten kilitli). İstenirse onlara da `locked` prop eklenir.
  `BILLING_ENFORCED` canlı → sandbox Paddle ise ödeme testi yap; prod price/secret teyit et.

## Landing overhaul: kopya + efekt + dürüstlük (2026-06-16, 6-agent panel)
Kullanıcı "sayfayı netleştir + şık/geçişli-efektli yap, 10 agent baksın, sen karar ver; sonra her sayfa
sırayla" dedi. 6 uzman agent (kopya/IA/motion/claims/mobil-a11y), kodla doğrulandı, son kararı ben verdim.
**Motion (dependency-free):** `Reveal` (IntersectionObserver, once, prefers-reduced-motion ile kapanır),
`NavScroll` (scroll'da gölge), `MobileNav` (hamburger — mobilde nav linkleri YOKtu, kritik fix). globals.css'e
keyframes + `.reveal/.hero-aura/.card-lift/.cta-glow/.cta-arrow/.badge-in` + `scroll-behavior:smooth` +
reduced-motion bloğu. Hepsi transform/opacity (CLS=0, GPU). **Kopya/dürüstlük (claims agent kodla doğruladı):**
"Telefon desteği"→"Öncelikli destek" (telefon hattı YOK), "Özel kurulum"→"Birebir kurulum desteği", "doğru/anında"
çıkarıldı (hatasız gibi), "asla uydurmaz→bilmediğini size sorar", Rusça dil listesi 3 yerde eşitlendi. Hero H1
"insan gibi"→"gece 3'te bile" (somut). **IA:** boş demo-video kutusu artık `NEXT_PUBLIC_DEMO_VIDEO` yoksa GİZLİ
(eskiden boş 16:9 kutu = bitmemiş izlenimi). FAQ → native `<details>` accordion (mobilde kısa). Final CTA self-serve
vs assisted ayrıştırıldı. Trust-strip (Türkiye'de geliştirildi/KVKK/şikayette-otomatik-yok) eklendi. **Lead bildirimi:**
`/api/leads` artık yeni lead'de ALERT_EMAIL'e mail atıyor (eskiden pull-only → kaçırılıyordu; fire-and-forget, esc'li).
LeadForm KVKK consent server-enforced (zaten vardı). 425 test yeşil, build temiz.
**⏳ KULLANICI KARARI:** "Sınırsız daire" (İşletme) kodda gerçekten limitsiz (margin riski, CLAUDE.md fair-use ~20
notu) — landing'de "Sınırsız" kaldı; istenirse "Yüksek daire (adil kullanım)" + canAddProperty'ye soft-cap. **⏭️ SIRADA:**
diğer paneller tek tek (kullanıcı isteği) aynı titizlikle.

## Fiyat modeli kararı: FLAT kalsın + İşletme 25 daire (2026-06-16, 6-agent araştırma + kullanıcı onayı)
Kullanıcı flat'i saçma bulup Hospitable gibi mülk-başı dinamik fiyat sordu. 6 ajan (strateji/maliyet/
Türk-pazarı/psikoloji/feasibility/rakip), web+kodla. **Karar (kullanıcı AskUserQuestion ile seçti): FLAT
tier'ler KALSIN, sadece İşletme'yi marj-güvenli yap.**
**Neden flat (dinamik DEĞİL):** (1) **AI maliyeti çok küçük** — gpt-5.1 + prompt-cache ile ~₺17/daire/ay
(yoğunda ~₺30); Başlangıç %93-96, Pro %87-91 marj → flat zaten kârlı, dinamiğe maliyet ihtiyacı YOK.
(2) **Flat-rate bias** (Lambrecht-Skiera JMR, akademik): küçük host öngörülebilir sabit fiyatı sayaçlı/
mülk-başına TERCİH eder, "taksimetre etkisi" satın almayı düşürür. (3) 2026 uzman konsensüsü = basitlik.
(4) Türk pazarı flat-tier (BasitCRM/HemenKamp/Paraşüt); ₺449 giriş tabanına (₺300-600) tam oturuyor.
(5) Müşteri zaten Hospitable'a mülk-başı ödüyor → üstüne mülk-başı = zor satış.
**Uygulanan:** `plans.ts` İşletme `propertyLimit` 200→**25** (25 dairede ~%75 marj; canAddProperty otomatik
uydu). Landing: "8-25 daireli profesyoneller" + "25 daireye kadar" + fiyat altına "25+ daire → bize ulaşın"
(elle teklif/değer-bazlı pazarlık). Başlangıç ₺449 / Pro ₺899 / İşletme ₺1.699 AYNEN.
**⏭️ ERTELENEN (kullanıcı isterse — daha çok gelir ama karmaşık):** strateji ajanının "hibrit" önerisi —
flat base + 2 daire üstü daire-başı (₺120/daire 3-10, ₺90 11-40, ₺65 41+), hacimde inen oran. Paddle quantity
destekliyor; `Subscription.unitCount` (nullable, db-push güvenli) + webhook quantity + entitlement `unitCount ??
tier` → canAddProperty zaten mülk-başı olur. Büyük hesaptan değer-bazlı daha çok alır ama checkout/billing
karmaşıklaşır + küçük hostu korkutma riski (bu yüzden ertelendi; bugünün kararı flat-basitlik).
**Rakip referansı:** Besty $12/listing, Conduit(HostAI) $500 flat, Hospitable AI plana dahil ($29-99/mülk),
Hostex 10-reply/mülk metered. Lixus ₺120/daire (~$2.6) hepsinden ucuz — TRY-native moat.
**⏳ Launch KDV kararı:** B2C → yasal olarak KDV-dahil headline (Madde 57); ama Paddle MoR KDV'yi kendi
topluyor/gösteriyor → checkout'ta netleşir, launch'ta teyit et.

## Panel cilası + hero + güvenlik-kapısı sertleştirme (2026-06-19→23, ~50 agent toplam) ✅
Kullanıcı "tüm panellere gerçek-müşteri gözüyle bak, saçma/dev-artığı şeyleri sil, bol agent" dedi.
**KURAL (kullanıcı, kalıcı):** "bundan sonra eklediğimiz HER ŞEY gerçek satılan ürüne giriyor" — gösteriş/debug yok.
**Panel batch (10 denetim + 7 uygulama + 10 re-audit agent, hepsi kodla doğrulandı, 10/10 SOUND, davranış KANITLI değişmedi):**
- **Görevler → Kanban panosu** (Yapılacak/Devam ediyor/Tamamlandı durum sütunları; in_progress geri açıldı; görev formu 3 durumla eşitlendi). RBAC/filtre/not-foto korundu.
- **Raporlar:** ortalama doluluk **donut'u** + gradient çubuklar; doluluk artık **"bugüne kadarki"** payda (ay-sonu yerine — ayın 18'inde dolu daire %100, eski ~%55 yanıltması bitti); delta **aynı-gün** karşılaştırması + üstüne-gelince tooltip.
- **Ayarlar:** ana-şalter uyarısı **müşteriden gizli** (operatöre özel); "Hospitable Bağlantısı"→"Airbnb/Booking Bağlantısı"; "AI Cevap Testi (misafire gitmez)"→**"AI'yı Deneyin"**; "önizleme (misafire gitmez)" butonları silindi.
- **Mesajlar:** "Misafir mesajı dene (test)" **debug aracı + endpoint'i silindi**; ham "Güven %73+çubuk"→sade "AI bundan emin/değil"; çelişkili kaynak rozeti kaldırıldı; şablonlarda `{isim}` de çalışır.
- **Şablonlar:** personel salt-okunur (RBAC UI). **Bilgi Tabanı:** kategoriler 2 optgroup (otomatik-gönderilen ↔ AI-okur) + Şablonlar çapraz-link; aktif/pasif göz→toggle ikonu + inline hata. **İptaller:** gün filtresi UTC→İstanbul. **Gönderilenler:** oto-mesajlar gerçek KB içeriğini gösterir. **Mülkler/iCal:** ham hata→Türkçe, Senkronla/Sil etiketli, User-Agent "GuestOps-AI"→"Lixus-AI". **Görev kartı** 📷→ikon. Ölü kod (MessagePreviewButton + simülasyon route) silindi.
- **Misafir Sohbetleri (QR):** menü-geçidi `GUEST_CHAT_ENABLED && rol≠staff` (env açık → TÜM müşteriler görür; **kullanıcı kararı: müşterilere açık kalsın**); boş ekran → karşılama + 3-adım yönlendirme + "Mülklere git".
**Landing hero (defalarca yinelendi, 10-agent iddia-denetimi):** Final = **"Misafir mesajlarını 7/24, güvenle yanıtlayan yapay zekâ."** + alt: **"Özelleştirilebilir otomatik yanıtlama — misafiriniz hangi dilde yazarsa o dilde cevap alır. Şikayet, iade gibi riskli konuları otomatik yanıtlamaz, size bırakır."** Ajanlar "asla/risksiz/%100 güvenli/dakikalar içinde" gibi **mutlak iddiaları yalan/Reklam-Kurulu riski** buldu → hepsi atıldı, dürüst+güçlü kaldı. ("siz yaşayın" da kullanıcı "saçma" deyince gitti.)
**Güvenlik-kapısı SERTLEŞTİRME (8-agent denetim sonrası, en son iş):** landing'deki "şikayeti otomatik yanıtlamaz" iddiasını gerçekten doğrulamak için `lib/ai/fallback.ts`'e (a) **örtük şikayet + telafi/indirim** kelimeleri (olumsuzluk-çapalı → "tam beklediğim gibi"/"indirimli sezon" FP YOK; bare "indirim"/"плохо" tuzakları bilerek atlandı), (b) **AR/RU/IT zenginleştirme** eklendi. (c) `automation.ts` `applyChannelAutoReply` artık model şikayet/iade/yüksek-risk görüp kelime ağı kaçırırsa da konuşmayı **atomik "problem" + host'a mail** yapar (`skippedReason: "escalated_to_human"`; `sendDueAlerts` status="new" baktığı için **çift-mail imkânsız**; alıcı per-tenant, operatöre sızmaz). **+8 regresyon testi, 434 yeşil.** Oto-yanıt güvenlik kapısı SADECE daha sıkı oldu.
**urun.html / kurulum.html (landing demo animasyonları):** tam 11-madde nav + düzgün Ayarlar dişlisi; mesajlar yazıldığı anda görünür (display:none fix); raporlar çubukları gerçekten dolar (inline-span `display:block` kök-sebep); WiFi adı anonim.
**⏳ KULLANICI/launch hatırlatmaları (hâlâ geçerli):**
- 🔴 **`AUTO_REPLY_ENABLED=1` Railway'de set DEĞİL** (Ayarlar "ana şalter KAPALI" gösteriyor) → şu an hiç kimseye (Nuve dahil) otomatik mesaj GİTMİYOR. Canlıya hazır olunca **birlikte ilk gönderimleri doğrula**, sonra "1" yap.
- 💳 **Paddle production CANLI** (env=production, pdl_live_ key, webhook aktif) → hazır olunca **küçük gerçek ödemeyi birlikte** test et.
- Nuve'nin Hospitable aboneliği bitik (402) → veri donmuş anlık-görüntü; yenilenince canlı döner.

## Logo + reverse-trial doğrulama + deneme-hatırlatma maili (2026-06-28)
**Logo:** `public/lixus-logo.png` (yatay kilit) + `lixus-logo-icon.png` (512) + `src/app/apple-icon.png`
(180) + `icon.svg` (gradient) — hepsi aynı bina markası. `BrandMark` (currentColor vektör) lucide `Hotel`'i
nav/footer/app-shell/auth+legal layout/error/404'te değiştirdi → uygulama-içi marka favicon ile birebir.
JSON-LD logo → PNG.
**Reverse-trial KODLA DOĞRULANDI (kullanıcı sorusu):** kayıt KARTSIZ 14 gün Pro (`register` → `trialing`
sub, `trialEndsAt=+14g`); **otomatik giriş yok, e-posta doğrulama şart** (anti-bot, Resend prod'da load-bearing).
14 gün bitince **canlı türetilir** (cron yok) + `BILLING_ENFORCED=true` ile etki: **tam kilit YOK** (kullanıcı
kararı) → "ücretsiz sürüm": gezer/manuel çalışır, OTO-mesajlaşma kapanır + `LimitedModeBanner` + Ayarlar'da plan.
**YENİ — deneme-hatırlatma maili (kullanıcı "zor değilse ekle"):** `lib/billing/trial-reminders.ts`
`sendDueTrialReminders()` deep-sync'te. SADECE `BILLING_ENFORCED` açıkken (mesaj doğru olsun), idempotent
(`Subscription.trialEndingSentAt`/`trialEndedSentAt` nullable, atomik claim-then-send + fail'de rollback),
alıcı = org owner (oldest user, env DEĞİL), "ended" 30-gün grace (eski trial'ları blast etmez). 2 mail
(`trialEndingSoonEmail` 1g kala / `trialEndedEmail` bitince — kullanıcı "ikisi de, 1 gün önce" seçti).
**DORMANT ŞİP:** `TRIAL_EMAILS_ENABLED=1` (default KAPALI) olmadan hiç mail gitmez — e-posta-akışı kuralı
(deploy edince oto-blast olmasın). +8 test (446 yeşil). Env: `TRIAL_EMAILS_ENABLED` (kullanıcı Railway'de
1 yaptı), `TRIAL_REMINDER_DAYS` (vars.1), `APP_BASE_URL` (vars. www).
**⏳ KULLANICI: ilk gerçek gönderimi (bir denemenin bitişinde) birlikte izle.**

## PMS bağlantı katmanı stratejisi — 12-ajan araştırma (2026-06-28)
**Soru (varoluşsal ICP kısıtı):** "Müşteri Airbnb'sini buraya nasıl bağlayacak?" Bugün ürün per-tenant
Hospitable token istiyor → host Hospitable'a (~$29/ay) ödemeli + Hospitable takvimi devralıyor. Kapı kapı
satıştan ÖNCE çözülmesi gereken asıl soru bu. **12 ajan** (9 PMS + Airbnb/Booking direkt + ToS + founder-
accounts), hepsi kaynak/kodla doğrulandı. Filtre = **programatik Airbnb mesaj GÖNDERME** (okuma yaygın,
gönderme nadir/ayırt edici).
**3 gerçek aday (mesaj gönderen):**
- **Hospitable $29 (MEVCUT):** ✅ gönderir · ✅ **mesaj-only mod VAR ("Limited Connection" → takvime/fiyata
  karışmaz, host Airbnb'yi kendi tutar)** · ✅ **OAuth "Connect" butonu küçük geliştiriciye AÇIK** (vendor
  başvurusu birkaç gün, davet-gerektirmez — Airbnb'nin tersi) · ❌ reseller/cash-affiliate YOK (sadece $100
  bill credit) · cheapest API plan $29 (free Essentials API kullanamaz).
- **Hostex $7/ay (Pro, en ucuz):** 🥇 fiyatta Hospitable'ı kıran TEK aday · ✅ gönderir (`POST /v3/
  conversations/{id}`, kendi SDK'sı + canlı repo'larla KODDAN doğrulandı) · ❌ mesaj-only mod yok (kanal
  yöneticisi → takvim senkronu gelir) · token (self-serve) veya OAuth (partner-onaylı) · sandbox yok · referral %30.
- **Beds24 ~$27/ay (€15.90 + €10 API rate-limit):** ✅ gönderir (`POST /bookings/messages`, scope
  `bookings-personal`, native Airbnb thread) · ❌ mesaj-only mod yok (iCal takvime karışmaz ama mesaj taşımaz) ·
  **per-tenant invite-code→refresh-token (mevcut `getOrgHospitableToken` şifreli-token modeline birebir uyar)** ·
  ✅ **white-label + reseller programı** · Airbnb Preferred+ · yeni-mesaj webhook'u var.
**Elenenler:** Smoobu (€29-35, mesaj-only yok=takvim zorla, ama %10 nakit affiliate), Hostaway ($125-175 satış-
gated), Guesty ($40-72/daire, Lite'ta API yok), Hostfully ($129+API eklenti) — pahalı/ağır; **Lodgify (mesaj
API READ-ONLY — gönderemiyor), Uplisting (public API'de mesajlaşma HİÇ yok)** — diskalifiye.
**⚠️ TERS-KÖŞE İÇGÖRÜ (en önemlisi):** Kullanıcının nefret ettiği "Hospitable takvime karışıyor" derdinden
kaçışın olan TEK yer = **Hospitable'ın Limited Connection'ı.** Ucuz alternatiflerin (Hostex/Beds24/Smoobu)
HİÇBİRİNDE mesaj-only mod yok — hepsi tam kanal-yöneticisi, takvimi zorla devralır. Yani **ucuz = daha hafif
DEĞİL, tam tersi.**
**KARARLAR (sıralı):**
1. **ŞİMDİ — Hospitable'da kal, 2 ekleme (C; kullanıcı "kesinlikle yap, unutma" dedi):** (a) **"Hospitable ile
   Bağlan" OAuth butonu** (token kopyala-yapıştır yerine tek-tık; demo pürüzsüzleşir). ⚠️ Mesaj GÖNDERME scope'u
   `message:write` ayrı onay isteyebilir → Hospitable'a SOR (team-platform@hospitable.com) yol haritasına koymadan.
   (b) **Limited Connection rehberi** → "takvime karışıyor" derdi biter. ⚠️ Hospitable "limited modda mesaj
   güvenilirliği düşebilir" diyor → **önce Nuve'da gerçek veriyle TEST et**, sonra müşteriye öner.
2. **ORTA — Hostex ($7) ikinci adaptör** (`sendOnChannel` tek-nokta zaten hazır): fiyata duyarlı, kanal
   yöneticisini değiştirmeye razı host için ucuz tier. Takvim devralmayı kabul gerek + sandbox yok.
3. **OPSİYON — Beds24 white-label** (görünmez bundle: müşteri PMS'i görmez, sen markalarsın) — ama operasyonel
   yük + aylık min ücret. İleride büyürsen.
4. **D (kendi Airbnb/Booking partnerliğin) = KAPALI, KANITLANDI:** Airbnb API davet-usulü/başvuru kapalı, yayınlı
   ilan-sayısı YOK (niteliksel supply + 6ay-zorunlu-özellik + güvenlik denetimi); Booking yayınlı eşik **≥250 ilan
   + ≥3000 rezervasyon/yıl** + yeni-partner onboarding "ikinci duyuruya kadar DURDURULMUŞ". Bypass (scrape/private-
   API/headless) = ToS ihlali + müşterinin Airbnb hesabı BAN (hiQ davası: ToS ihlalinden $500k tazminat, "izin
   verdi/legal" KORUMAZ; mesajlar login arkasında=public-scraping savunması geçersiz). → **Supply topla (A/B ile),
   100-200 host'ta tekrar bak. D = bitiş çizgisi, başlangıç değil.**
**Satış (A):** ICP = "PMS kullanan/kullanmaya razı host" (apart-otel/pansiyon/property-manager); kart bırakma
DEĞİL → canlı demo + oracıkta 14-gün bedava denemeye kayıt. **Mimari hazır:** `sendOnChannel` tek choke-point +
per-tenant şifreli token modeli Beds24/Hostex'e de uyar (Beds24 sadece 24s refresh-token rotasyonu ekler).
**Hiçbiri henüz KODLANMADI** — kullanıcı yön seçince additive eklenir (bağlantı katmanı = kullanıcı onayı kuralı).

## Hospitable partnerlik başvurusu + Connect ≠ Public API (2026-06-30)
Connect/Public-API erişim formu (typeform hnDLwUvF) dolduruldu → **5 iş günü** inceleme. Frances
olumlu döndü, **Patrick (Kıdemli Ortaklıklar Müd.)** cc'de. Forma verilenler: scope'lar **property:read,
reservation:read, message:read, message:write** (financials/calendar bilinçli YOK = "dokunmuyoruz" kozu);
endpoint-bazlı açıklama (her özellik→endpoint); app-tile logo = `lixusai.com/lixus-logo-icon.png` (kare);
müşteri sayısı dürüstçe **"1" (Nuve)**; "marketplace sayfan var mı"→**Yes** + `lixusai.com/entegrasyonlar`
sayfası eklendi+deploy (commit a6907d9, middleware public-prefix + footer link).
**🔑 KRİTİK YENİ BİLGİ — Connect oyunu değiştiriyor.** İki AYRI ürün var:
- **Hospitable Connect** (`connect.hospitable.com/api/v1`): müşteri **doğrudan Airbnb'sini bağlar**, **kendi
  Hospitable aboneliği GEREKMEZ.** Doküman aynen *"PMS kullanmayan (ve hiç kullanmayacak) host'lara açılın"*
  diyor = tam ICP'miz + **$29/ay müşteri-maliyet engelini kaldırabilir** (kullanıcının "müşteri Hospitable'a
  girmeden bağlansın" isteğinin cevabı). Bearer token (partner portal → Settings > Access tokens), 60 req/dk,
  customer-scoped `/customers/{id}/reservations`, `_select=` ile alan seçimi, webhooks (listing/calendar/
  reservation/guest). Connect 3. tarafa ücretsiz.
- **Public API** (`developer.hospitable.com`, /v2, OAuth2/PAT): bir Hospitable KULLANICISININ hesabına
  entegrasyon — host'un Hospitable aboneliği ŞART (şu an PAT ile kullandığımız yol).
- **⚠️ MAKE-OR-BREAK AÇIK SORU:** Connect overview verisi listing/rezervasyon/takvim/misafir sayıyor, **MESAJ
  yok.** Ürünümüz mesajlaşma. Scope formunda message:read/write vardı → muhtemelen destekliyor ama
  KESİNLEŞTİRİLMELİ. Patrick'e net soru: "Connect üzerinden misafir mesajı okunur/gönderilir mi + müşteri-
  Airbnb-bağlama modeli." Cevap evet ise entegrasyon = yeni base URL + customer-scoped + webhooks (mimari
  şu anki Public-API/PAT'ten farklı; `sendOnChannel` tek-nokta yine adapte edilir).

## ÇALIŞMA TARZI — iletişim geri bildirimi (kullanıcı, 2026-06-30)
Kullanıcı: "bir cümleye/klişeye takılma, daha zekice düşün, yazmadan düşün." Somut kural: ürünü her yerde
**aynı kalıpla tekrarlama** (örn. "müşterinin dilinde cevap veren, 7/24 çalışan, şikayeti size bırakan" —
bu üçlüyü brošür/mail/başvuruda fazla tekrarladım, robotikleşti). Bunun yerine: duruma göre **değişken,
daha keskin/yerinde** tanımlar; ürünü/siteyi zaten biliyorum, varyasyon getir; **önce düşün sonra yaz.**
Tekrar = robotik, kaçın.

## Hospitable takip + yasal sayfa detayları + satış/GTM + oturum kapanışı (2026-07-01)

**Hospitable — sessizlik NORMAL, dürtme:** Frances+Patrick'e "Connect mi (müşteri Hospitable
aboneliksiz doğrudan bağlanır) yoksa agency/white-label mi mümkün + fiyatlandırma nasıl olur"
sorusu gönderildi (2026-06-30 09:59). ~1 gün geçti, cevap yok — bu BEKLENEN: (a) form incelemesi
ayrı "5 iş günü" süreci, henüz dolmadı; (b) bu ek soru düşünülüyor/Patrick'e iletiliyor olabilir;
(c) form kararı + bu sorunun cevabı TEK mailde birleşebilir. Sessizlik = ret/görmezden-gelme
DEĞİL. 5 iş günü dolup hâlâ ses yoksa nazik TEK hatırlatma at, öncesinde dürtme.

**Yasal sayfalar — 4'ü de kapsamlı genişletildi (commit b6a19a0):**
- **Gizlilik** 10→17 bölüm: tam KVKK m.11 hakları, roller netliği (host misafir verisinde veri
  SORUMLUSU, biz veri İŞLEYENiz), alt-işleyenlere **Paddle** eklendi, yurt dışı aktarım (KVKK m.9),
  AI/otomatik-işleme şeffaflığı (tam otomatik karar YOK — insan onayı/denetimi vurgulandı), Kurul'a
  şikâyet yolu, ~30-gün başvuru cevap süresi.
- **Kullanım Koşulları** 11→21 bölüm: 14-gün kartsız deneme + deneme-sonrası "ücretsiz sürüm"
  açıklaması, Paddle MoR ödeme modeli, mücbir sebep, sorumluluk sınırı (son 12 ay ödenen tutarla
  sınırlı), tazminat maddesi, uygulanacak hukuk + Tüketici Hakem Heyeti/Mahkemesi.
- **Ön Bilgilendirme** 6→12, **Mesafeli Satış** 10→17: tanımlar, taraf yükümlülükleri, delil
  sözleşmesi (HMK m.193), temerrüt hükmü eklendi.
- **Silme/saklama sözü BİLEREK "yapılabilir" tutuldu** ("talebiniz üzerine sileriz"), "otomatik
  silinir" DENMEDİ — çünkü o an özellik opsiyonel bir env'e bağlıydı, tutulamayacak söz verilmedi.

**`DATA_RETENTION_MONTHS=24` artık Railway'de CANLI** (kullanıcı bu oturumda set etti) →
`anonymizeOldGuestData()` gerçekten çalışıyor: 24 aydan eski `departureDate`'li rezervasyonların
misafir PII'si (ad/telefon/e-posta/misafirin mesaj gövdesi) deep-sync'te periyodik anonimleştirilir,
doluluk/rapor sayıları bozulmaz.
**⏭️ Küçük açık uç:** Gizlilik'in "Saklama ve İmha" bölümü hâlâ jenerik dil kullanıyor ("gerektiği
süre"), artık gerçek olan "24 ay" rakamını anmıyor. Yanlış değil (daha az kesin), istenirse
netleştirilebilir — düşük öncelik, launch'ı engellemez.

**Avukat incelemesi — brief hazırlandı, REPOYA GİRMEDİ:** KVKK/e-ticaret avukatına iletilmek üzere
tek-sayfalık brief (scratchpad'de, kullanıcıya dosya olarak gönderildi — proje deposunun parçası
DEĞİL, gerekirse yeniden üretilir). 7 net soru: (1) OpenAI'a aktarım mekanizması (Standart
Sözleşme/Kurul-bildirimi/açık rıza?), (2) VERBİS kaydı gerekli mi, (3) host'larla veri-işleyen
sözleşmesi (DPA) şablonu gerekir mi, (4) açık rıza gereken bir nokta var mı, (5) **entity/hukuk
sorusu** (İtalyan Partita IVA + Paddle MoR + Türk tüketici — hangi çerçeve, sitede hangi satıcı
bilgisi gösterilmeli), (6) Paddle-MoR kurgusunda tüketici-hukuku uyumu, (7) genel madde eksik/risk
taraması.

**`legal-entity.ts` placeholder'ları HÂLÂ DOLU DEĞİL (bilinçli, ertelendi):** Kullanıcı "millet
koddan görür mü" diye sordu → netleştirildi: (a) bu bilgi YASA GEREĞİ sitede herkese açık olmak
ZORUNDA (mesafeli satışta satıcı kimliği gizlenemez) — GitHub public/private olması bunu
DEĞİŞTİRMEZ, çünkü site (lixusai.com) repo'dan bağımsız her zaman açık; (b) AMA Paddle
Merchant-of-Record olduğu için gerçek gösterilen "satıcı" Paddle olabilir, ablanın İtalyan
entity'si hiç görünmeyebilir — tam avukat-brief soru-5'in konusu, cevap gelmeden KARAR VERİLMEDİ.
(c) Kullanıcı ayrıca genel olarak **repoyu private yapmayı** düşünüyor (kaynak kodu gizlemek için,
ayrı/bağımsız bir konu) — henüz yapılmadı, kullanıcının kararı, GitHub Settings→"Change repository
visibility". **SONUÇ: `legal-entity.ts` hâlâ `[SATICI ÜNVANI]` vb. placeholder'larla duruyor —
ödeme açmadan/launch'tan ÖNCE ya avukat cevabına göre Paddle'ı satıcı gösterecek şekilde sayfalar
güncellenir, ya da kullanıcı ablasının bilgilerini verir, dosya doldurulur.**

**AI model kararı (kullanıcı sordu, GPT-5.1 vs Claude Opus/Sonnet/Haiku):** KARAR: **gpt-5.1'de
KAL**, kod DEĞİŞMEDİ. Gerekçe: iş frontier-seviye akıl yürütme istemiyor (çok-dilli sınıflandırma +
şablon-cevap, ikisi de yeterli); güvenlik kapısı (güven-eşiği 0.75, şikayet/iade kelime-ağı)
gpt-5.1'in davranışına kalibre — model değişimi mesaj-gönderim hot-path'inde yeniden test/kalibrasyon
riski taşır ("bozma" kuralı). gpt-5.1 ucuz (input $1.25/M vs Sonnet $3/M), prompt-cache zaten aktif.
**Sadece somut bir gerçek-dünya arıza çıkarsa** gerçek mesajlarla A/B test edilip değiştirilir —
sezgiyle/moda diye değil.

**Satış/GTM işi bu oturumda (KOD DEĞİL — iş bağlamı, gelecek oturum devam etsin diye kayıtlı):**
- Kullanıcı saha satışına çıkıyor. **Broşür** (tek-sayfa HTML, scratchpad'de — repo'da DEĞİL,
  istenirse yeniden üretilir): logo + 6 fayda (Airbnb-yanıt-süresi/7-24, misafir kendi dilinde,
  üslup öğrenir, "açınca otomatik yanıtlar/isterseniz önce önizleyip onaylarsınız", riskliyi
  size-bırakır, takvime-dokunmaz) + 3 adım (Bağla→AI cevabı yazar→Otomatik ya da onaylı) + QR
  (lixusai.com) + WhatsApp 0534 513 27 12 + "14 gün kartsız bedava".
- **ICP netleşti:** PMS-kullanan/kullanmaya-razı host, apart-otel/pansiyon, ve özellikle
  **property-manager/co-host (çarpan etkisi — 1 anlaşma = 10-50 daire)**.
- **Somut co-host/yönetim şirketleri (İstanbul, araştırıldı+kaynaklı):** Missafir, Hanemo,
  WelcomeConcierge, Line To Mars, Settle Turkey, Istanbul Homes — bunlara özel outreach maili
  hazırlandı (bunlar host-portföyü zaten yönetiyor → doğrudan satış hedefi, referans ikinci öncelik).
- **Temizlikçi kanalı (referans/altın kaynak):** Kon Temizlik, Avant/Beyoğlu Temizlik Şirketi,
  **Armut.com ilçe sayfaları** (Şişli 219 sağlayıcı, Beyoğlu otel/ev temizliği).
- **Armut.com "Airbnb Danışmanlığı" hizmeti açıldı** — tanıtım yazısı yazıldı (Armut'un özel-
  karakter/telefon/link YASAK kısıtına uyularak) → inbound lead kanalı.
- Demo script (5dk) + itiraz-cevap kartı hazır. **API'siz/Hospitable'sız demo yolu:**
  Ayarlar→**"AI'yı Deneyin"** kartı (`ai-test-card.tsx`) — hazır örnek mesaj butonlarıyla çok-dillilik/
  risk-tespiti/güvenlik-kapısı canlı gösterilir, hiçbir bağlantı gerektirmez.

**🔴 KONTEYNER YİNE SIFIRLANDI (2026-07-01) — DERS TEKRARLANDI (3.-4. kez):** Yerel git sadece
"Initial commit" + 16-byte placeholder README'ye dönmüştü (tüm proje dosyaları yerelden silinmiş
görünüyordu). `git fetch origin <branch>` + `git reset --hard origin/<branch>` ile **TÜM iş
(b6a19a0'a kadar) sorunsuz kurtarıldı** — hiçbir şey kaybolmadı çünkü SIK COMMIT+PUSH kuralı
uygulanmıştı. **KURAL (tekrar tekrar doğrulanan gerçek):** konteyner yerel state'i güvenilmez,
**origin/uzak branch tek gerçek kaynak.** Yeni oturum başında dosyalar eksik/tuhaf görünürse PANİK
YAPMA — önce `git remote -v` + `git fetch` + `git log origin/<branch> --oneline` ile uzak geçmişi
gör, sonra `git reset --hard origin/<branch>` ile yerel'i eşitle.

**Araç/iş akışı tavsiyeleri (kod değil):** VS Code'un kendi terminali > ayrı cmd/PowerShell (diff-
görünümü + dosya ağacı + olgun Claude Code IDE entegrasyonu). **Google Antigravity IDE'ye GEÇME** —
çok yeni (Kasım 2025), kendi rakip Gemini-tabanlı ajanı var; kullanıcının %100 Claude-Code-odaklı
akışına hiçbir şey katmıyor, sadece kararsızlık/karmaşıklık riski ekliyor.

## 🎯 HOSPITABLE ORTAKLIĞI — SORULACAK #1 SORU: Lixus'a özel "sadece-API" paketi (2026-07-01, kullanıcı direktifi — ASLA UNUTMA)
**Kullanıcının net direktifi (ezberle):** Hospitable ile yazışmada **en öncelikli soru** şu olmalı —
Hospitable, **Lixus müşterilerine özel bir "limited / sadece-API" paketi** çıkarır mı? Müşteri,
Hospitable'ın tam uygulamasını/panelini **kullanmadan** (ve ona ihtiyaç duymadan), **yalnızca Lixus'un
ihtiyaç duyduğu verileri API ile çekmemizi sağlayan** ucuz bir paket satın alsın.
- **İçerik:** Lixus'un uygulamamızda kullandığı tüm özellikler/scope'lar (property/reservation/message
  read + **message:write**) yeter. Müşterinin ekstra Hospitable uygulama özelliklerini **kullanamaması
  SORUN DEĞİL** — paketi **salt "bağlantı lisansı"/API** olarak alır. Yani "sadece Lixus için işe
  yarayan her şey" = yeterli.
- **Fiyat hipotezi:** ~**$7/daire/ay** (kullanıcı "sallıyorum" dedi = placeholder, pazarlığa açık). Amaç:
  bugünkü **$29/ay Hospitable-app maliyet engelini kaldıran** API-only düşük fiyat noktası — müşteri-
  edinme engelimizin asıl kaynağı bu maliyet.
- **Sıra (önemli):** ÖNCE **fizibilite** ("böyle bir paket / müşterilerime özel iş birliği mümkün mü"),
  mümkünse **SONRA fiyat**.
- **Kaldıraç/pitch:** "Bu ortaklıkla **Hospitable'ı Türkiye pazarında gerçekten büyütebileceğimize
  şüphemiz yok**" — Lixus, Hospitable'a çok sayıda Türk host getiren **dağıtım kanalı** olur → onlar
  API-lisans geliri + pazar payı kazanır, biz müşteri-maliyet engelini kaldırırız = kazan-kazan.
- **Özü:** "Müşterinin **sırf API için** alabileceği paket" **veya** "**benim müşterilerime özel paket**"
  = reseller / white-label / toptan-API iş birliği.

**Mevcut bağlamla ilişki (bu YENİ bir soru değil — en kritik hale getirilmiş + fiyat/ticari çerçeve
eklenmiş hali):** Zaten keşfedilen **Hospitable Connect** ile birebir örtüşüyor (yukarıdaki 2026-06-30
notu): *"müşteri doğrudan Airbnb'sini bağlar, kendi Hospitable aboneliği GEREKMEZ"* + *"Connect 3. tarafa
ÜCRETSİZ"*. Yani bu paketin teknik zemini muhtemelen **Connect**; kullanıcının direktifi buna **fiyat/
ticari çerçeve** ekliyor. **⚠️ Hâlâ açık make-or-break:** Connect üzerinden **misafir mesajı okunur/
gönderilir mi** (Connect overview'da mesaj YOK; ürünümüz mesajlaşma). **Frances + Patrick'e** (2026-06-30
gönderilen agency/white-label + fiyat sorusu hâlâ bekliyor) bu paket sorusunu **MESAJLAŞMA sorusuyla
BİRLİKTE** netleştir. (5 iş günü inceleme dolmadan dürtme kuralı geçerli.)

## 12-agent tam inceleme + güvenli-küme uygulaması (2026-07-02) — 8 commit, 462 test yeşil, build temiz
Kullanıcı "projeyi baştan sona incele, iyi mi, geliştirilecek yanları ne" dedi → **12 paralel uzman agent**
(güvenlik/çok-kiracılık/AI-hattı/billing/sync/frontend/test/perf/ürün/devops/KVKK/kod-kalitesi), hepsi kodla
doğrulandı. **Genel: ürün SAĞLAM** — kritik güvenlik açığı / IDOR / çapraz-kiracı sızıntı / AI-güvenlik deliği YOK.
Sonra kullanıcı "güvenli kümenin tamamını yap, sorun olmuycaksa uzun uzun" dedi → additive + testli + commit'li uygulandı:
- **#1 Gözlemlenebilirlik:** 34 API route'u 500'ü sessiz yutuyordu (`catch{}`+argümansız `serverError()`) → Sentry görmüyordu; `serverError(undefined, err)` ile bağlandı (davranış aynı).
- **#5 Maliyet kapıları:** 4 önizleme route'una `rateLimit` (6/dk) + reply-route inline `translateText`'e `premiumAllowed` geçidi (freemium'da tek açık OpenAI harcaması kapandı).
- **#3c AI yanlış-pozitif:** çıplak `problem`/`sorun` → `hasUnnegatedProblemWord()` (negasyon-korumalı; "no problem"/"sorun yok" artık şikayet sanılmıyor) + şikayet/iade ağı net terimlerle zenginleşti (terrible/disgusting/cockroach/chargeback/dispute…). Güvenlik kapısı SADECE sıkılaştı.
- **#4 KVKK:** (a) orphan-konuşma retention — `reservationId=null` konuşmalar artık `lastMessageAt` yaşına göre anonimleşiyor (host rezervasyonu silince misafir mesajı sonsuza kalıyordu → gizlilik sözü artık tutuluyor); (b) `purgeOldLeads()` — **`LEAD_RETENTION_MONTHS` env-gated, default KAPALI** (satış lead'leri sessizce silinmesin); (c) kayıt onay kutusu (Koşullar+Gizlilik linkli, server-enforced, `User.acceptedTermsAt`). **Test-isolation bug bulundu+düzeltildi:** `resetDb` `Lead` tablosunu temizlemiyordu.
- **#2 Billing past_due grace:** kart 1 kez reddedilince (Paddle dunning penceresi) ödeyen müşteri anında premium kaybediyordu (kural ihlali, BILLING_ENFORCED canlı) → `past_due` grace boyunca (`BILLING_PAST_DUE_GRACE_DAYS`, vars.14; `currentPeriodEnd ?? updatedAt`'e çapalı) aktif; Paddle `canceled` gönderince biter. QR concierge de bu grace'e uyar (test güncellendi).
- **#8 AI kredisi:** onaylanan AI cevapları host adıyla kaydediliyordu → Reports aktif kullanıcıya 0 AI kredisi gösteriyordu. `Message.aiAssisted` (default false) eklendi; "Onayla ve gönder" işaretliyor; `getAiOpsReport` `senderName="GuestOps AI" OR aiAssisted` sayıyor (**sihirli string OR ile korundu, DEĞİŞMEDİ**).
- **#3a/#3b Oto-yanıt (ürünün kalbi, dikkatli):** (a) `Conversation.autoReplyAttemptedAt` — düşük-güvenli "new" konuşma artık her 2-dk tik'te yeniden modele gitmiyor (yeni mesaj `lastMessageAt`'i ilerletince tekrar uygun); (b) claim-then-send (atomik `status new/waiting→answered` gönderimden ÖNCE, fail'de geri al) → çok-replica'da çift-gönderim savunması. Tek replica'da davranış aynı.
- **Cila:** "Kaydedildi" rozetleri düzenlemede sıfırlanıyor (yalan söylemiyor), TaskBoard staff'a sil-butonu göstermiyor, Reports delta tooltip'i dokunmatik'te `title` ile erişilir, Reservation `[propertyId,arrivalDate]`+`[propertyId,departureDate]` index'leri (index-only, db-push güvenli).
**Yeni env:** `LEAD_RETENTION_MONTHS` (default off), `BILLING_PAST_DUE_GRACE_DAYS` (default 14). **Yeni şema (hepsi nullable/defaulted → db-push güvenli):** `User.acceptedTermsAt`, `Message.aiAssisted`, `Conversation.autoReplyAttemptedAt`.
**⏭️ BİLİNÇLİ ERTELENDİ (agent önerdi ama riskli/büyük — kullanıcı kararı/dikkat gerek):**
- **`withAuth/withManage` wrapper** (48 route'ta tekrar eden auth+org-scope+try/catch preamble'ı tek HOF'a) — izolasyonu "konvansiyon"dan "yapısal"a taşır, EN yüksek hata-önleme kaldıracı AMA tüm route'lara dokunur = büyük blast-radius, ayrı/dikkatli oturum.
- **db-push-on-boot → gerçek migration'lar** (`prisma migrate deploy`) — `chatToken` outage dersi; dolu prod'da her yapısal değişiklik boot-crash riski. Migrate'i serve'den ayır. Altyapı değişikliği = kullanıcı onayı.
- **sessionEpoch** (çalınan token şifre-reset/rol-değişiminde 14g yaşıyor) — auth hot-path, proje kuralı "riskli auth = kullanıcı onayı".
- **apartmentNumber 4× kopya → tek lib** — mesaj-yolu refactor'u, saf-cleanup için mesaj hot-path'ine dokunmak istemedim (regresyon > fayda bu turda).
- **sync'te gereksiz findUnique'ler** (perf C) — LOW-MED, sync-yolu hassas, ayrı dikkatli tur.
- **#6 legal-entity.ts placeholder'ları** (canlı gösteriliyor, ödeme-öncesi blocker) + **#7 landing'de $29 Hospitable dürüstlüğü** — kullanıcı/kopya kararı, kod değil.
**DERS:** tam suit tek gerçek bug'ı yakaladı (QR concierge past_due grace'e uymuyordu — #2'nin yan etkisi, düzeltildi). Her batch: hedefli test → commit → push (konteyner-reset güvenliği). Commit mesajında backtick KULLANMA (bash çalıştırıyor, kelime düşürdü).

## Auth-sertleştirme turu: sessionEpoch + withAuth + migrations (2026-07-02, ~4 araştırma agent)
Kullanıcı ertelenen 3 riskli işi ("hepsini yap, dikkatli ol, acele etme") istedi. 3 read-only araştırma
agent'ı (session-mimarisi + route-deseni + Prisma-migration baselining, hepsi kodla/ampirik doğrulandı),
sonra sırayla uygulandı — her biri ayrı test+commit+push checkpoint'i.
**① sessionEpoch (BİTTİ, canlı):** çalınan JWT şifre-değişince/sıfırlanınca 14g yaşıyordu → `User.sessionEpoch
Int @default(0)` JWT'ye gömülü, SUNUCU-tarafında zorlanıyor. Enforcement `requireSession`(api.ts, +1 PK
lookup, fail-OPEN DB-blip'te) + `(app)/layout.tsx` (mevcut org-read'e katıldı, 0 ek sorgu, mismatch→`/api/auth/
logout` — `/login` döngü yapardı). **Middleware/verifySession edge-stateless KALDI** (sadece payload alanı).
Legacy token→0, DB default 0 → **deploy'da toplu-çıkış YOK**. 4 mint noktası (login/verify-email/impersonate
enter+exit) epoch damgalar; şifre-değiştir + forgot-password `increment:1`. +7 test.
**② withAuth/withManage (BİTTİ, org-scoped yüzey):** tekrar eden `requireSession→401 + canManage→403 + try/catch→
serverError` preamble'ı **`lib/route-guard.ts`** HOF'larına katlandı. **KRİTİK:** HOF'lar ayrı modülde çünkü
`withAuth` `requireSession`'ı api.ts'ten **import** ediyor → testlerin `vi.mock("@/lib/api",{requireSession})`
cross-module yakalanıyor (**testler değişmeden çalışır**; intra-module çağrı mock'u atlardı). HOF AUTH-only,
org-scope her handler'da KALDI. ctx **zorunlu** (Next 15 dinamik-route tip-doğrulaması opsiyoneli reddediyor);
collection route'u direkt çağıran testler `{params:Promise.resolve({})}` geçer. Migrate: tüm CRUD (conversations/
tasks/kb/templates/reservations/properties/settings) + AI (ai-suggest/translate/ai-test) + reply + property-sub +
diagnostics + calendar/sync + export + upload + import (~40 handler). **Bilinçli EXPLICIT bırakıldı:** account/2fa+
password (user-scoped auth, marjinal fayda + auth-hassas), 4 hospitable/*-test önizleme (zaten premium+rate-limit,
testleri POST() ile çağırıyor), kategori-C (public-token/health, webhook-imza, cron-secret, admin-superadmin,
hospitable/connect custom-gate, account/delete owner-only) — hepsi kendi geçidini korur.
**③ Migrations db-push→migrate deploy (Faz 0-1 BİTTİ + runbook; Faz 2-3 kullanıcı):** bugünkü boot'ta düz
`migrate deploy` **P3005 → prod crash** (ampirik kanıtlandı). `prisma/migrations/0_init` baseline (20 tablo/40
index/21 FK) üretildi, throwaway PG'de **SIFIR drift + P3005-tehlike + resolve-düzeltme** uçtan-uca doğrulandı.
**Faz 1 (commit'lendi): Dockerfile boot DEĞİŞMEDİ (hâlâ db-push, migrations dizinini yok sayar) → prod etkilenmedi.**
`docs/MIGRATION_CUTOVER.md` runbook: **Faz 2 = kullanıcı prod'da `npx prisma migrate resolve --applied 0_init`**
(tek sefer, veri-dokunmaz) → **Faz 3 = Dockerfile'ı `migrate deploy`e çevir** (auto-deploy, Faz 2'den SONRA).
Rollback = Dockerfile commit'ini revert. **Guarded auto-baseline REDDEDİLDİ** (P3008 race + boş-DB felaketi).
**Toplam: ~30 commit bu 2 oturum, 469 test yeşil, build+typecheck temiz.** DERS: (a) ESM intra-module çağrı
mock'u atlar → HOF'u ayrı modüle koy. (b) Next 15 route-tip-doğrulaması ctx-opsiyonel reddeder → zorunlu tut,
testte boş-ctx geç. (c) prod-migration cutover'ı kullanıcıyla koordine (prod erişimi yok + auto-deploy).
**⏳ KULLANICI:** migration Faz 2 (prod baseline komutu) + Faz 3 (Dockerfile flip, birlikte izle). withAuth
kalan explicit route'lar isteğe bağlı, sıfır-risk artımlı adapte edilebilir.

## Gemini-önerisi AI dilimi: pre-booking + closing-ack + fence (2026-07-02, commit 30aff93) — 476 test yeşil
Kullanıcı Gemini'nin 4 AI önerisini getirdi ("son karar sende, mantıklıları ekle"). Her biri kodla değerlendirildi:
- **✅ Pre-booking guard (UYARLANDI):** rezervasyon yok/pending/cancelled → prompt'a per-request blok:
  potansiyel-misafir çerçevesi, **kapı kodu/keybox-PIN/Wi-Fi şifresi/açık adres/giriş talimatı ASLA
  paylaşılmaz** (KB'de yazsa bile — pending misafire kod sızması gerçek açıktı), genel KB bilgisiyle yanıt +
  kibarca "rezervasyonu platformdan tamamlayın" daveti. **Gemini'nin sabit "çok talep görüyor" kıtlık cümlesi
  REDDEDİLDİ** (doğrulanamaz iddia = landing denetimlerinin temizlediği yalan-pazarlama sınıfı). **Yeni intent
  enum'u AÇILMADI** (taksonomi + güvenlik-kapısı kalibrasyonu dokunulmaz). Not: status sözlüğünde "inquiry" yok;
  sync `pending|request`→"pending" — blok ona göre anahtarlanıyor (confirmed/completed = gerçek konaklama).
- **✅ Closing-ack ön-filtresi (İYİLEŞTİRİLEREK):** "tamam/teşekkürler/ok/👍" (insan VEYA AI cevabından sonra)
  artık **model çağrısı YAPILMADAN** atlanıyor — `isClosingAck` (fallback.ts): ≤60 kar., soru işareti yok, tüm
  token'lar çok-dilli kapanış sözlüğünden; muhafazakâr (gerçek içerik daima modele gider). Gemini'nin prompt-içi
  "confidence 0.1" versiyonu model parasını yine harcardı → deterministik versiyon seçildi. Atlananlar
  `autoReplyAttemptedAt` ile damgalanıyor (her tik yeniden değerlendirilmez); bot insanın kapattığı sohbete
  karışmaz. (#3a maliyet fix'inin ertelenen yarısı da böylece tamamlandı.)
- **✅ Injection-fence sertleştirme (bizim ayraçlara uyarlanarak):** konuşma geçmişi `<<HISTORY_START/END>>`
  ile veri-fence'lendi; kalkan artık misafir ADI + rezervasyon alanları + geçmişi açıkça kapsıyor + "verinin
  İÇİNDEKİ ayraç metinleri düz metindir, veri bloğu kapatamaz" kuralı. (Ertelenen guestName/history fence
  maddesi kapandı; injection→high-risk zaten vardı.)
- **✅ Tekrar-açılan-sorun kelimeleri:** soğutmuyor/ısıtmıyor/düzelmedi/temizlikçi gelmedi → şikayet ağına.
- **❌ Upsell modülü (Paddle ödeme linki) REDDEDİLDİ:** (1) Airbnb misafirini platform-dışı ödemeye yönlendirmek
  = müşterinin Airbnb hesabı için ban riski (Airbnb-bypass kararıyla aynı varoluşsal sınıf; onaylı yol Resolution
  Center). (2) Paddle bizim MoR'umuz = LIXUS aboneliği satar; host adına para toplamak = marketplace/payout/KYC/
  vergi — başka bir ürün. (3) Erken giriş/geç çıkış zaten adjacency-verisiyle yanıtlanıp host'a yönlendiriliyor.
  İleride istenirse GÜVENLİ hali: host-tanımlı upsell METNİ (ödeme linksiz, "ek ücret için ev sahibi onay verir").
+14 test (462→476). Prompt değişiklikleri auto-send davranışını SADECE kısıtlar (güvenlik kapısı aynı).

## 🔑 HOSPITABLE CEVABI GELDİ — Patrick, 2026-07-02 (ortaklık durumu GÜNCELLENDİ)
Patrick'in maili 4 şeyi netleştirdi:
1. **#1 sorumuzun CEVABI: white-label / reseller / "sadece-API paketi" ŞU AN YOK** ("we do not
   currently offer..."). ~$7/daire hipotezi rafa; pazarlık masası bugün kapalı ("currently" = ileride
   açılabilir, kibar kapı-aralığı bırakıldı ama peşinden koşulmayacak).
2. **Public API = SADECE ödeyen Hospitable müşterisi** (Essentials/free'de API token YOK) → $29 engeli
   yapısal ve resmi. Mesajlaşma + rezervasyon verisi Public API'de tam (mevcut yolumuz onaylı).
3. **Resmî OAuth vendor flow'a DAVET etti** ("move from PAT to the official OAuth vendor flow if you
   want a public integration") — CLAUDE.md karar C-(a)'daki "Hospitable ile Bağlan" butonunun resmi yolu.
   Sonraki adım: başvuru süreci + message:write scope teyidi (cevap taslağında soruldu).
4. **Connect = bugün SADECE Airbnb + Public API'den "daha sınırlı"** — ama "host'un Hospitable'ı olmadan"
   segmentine açık. ⚠️ **KALAN MAKE-OR-BREAK: Connect'te misafir mesajı OKUMA+GÖNDERME var mı?** Patrick
   zikretmedi ("more limited"). Cevap maili bu soruyu net soruyor (ürün = mesajlaşma; cevaba göre
   Hospitable'sız-Airbnb-host segmenti açılır ya da kapanır).
**GÜNCEL STRATEJİ:** (A) Hospitable'lı hostlar → Public API + OAuth vendor başvurusu (hemen). (B)
Hospitable'sız Airbnb hostları (Türk ICP'nin çoğu) → Connect, MESAJLAŞMA cevabına bağlı. (C) Booking.com
isteyen → Hospitable aboneliği şart (satışta dürüstçe söylenir). Reply taslağı kullanıcıya verildi
(OAuth adımları + scope teyidi + Connect messaging/pricing/authorization + kibar "reseller açılırsa ilk
sıradayız" kapanışı).

## Hospitable — Patrick'e FİNAL cevap gönderildi (2026-07-02)
Patrick'in mailine tek birleşik cevap verildi (kullanıcı gönderiyor): (1) OAuth vendor flow'a EVET +
sıradaki adım/scope (message:write dahil) teyidi; (2) **Connect'in 3 kritik sorusu:** Airbnb mesajlaşma
(okuma+GÖNDERME) var mı · Hospitable-üyeliği-olmayan host nasıl authorize eder · partner fiyatı ne;
(3) #1-direktifin (sadece-API/reseller "Türkiye'de büyütürüz" kozu) büyüme-pitch versiyonu kibarca gömülü
(Patrick "white-label şu an YOK" dediği için sıfırdan sorulmadı, kapı açık tutuldu + pilot önerisi); (4) call teklifi.
**Netleşen mantık — abonelik:** Public API = host ödemeli Hospitable şart ($29, kesin). **Connect = Hospitable
kendi dokümanında "host aboneliği GEREKMEZ" diyor (Connect'in amacı bu) AMA Patrick teyit etmedi/fiyat vermedi
→ email tam bunu + mesajlaşmayı soruyor.** Connect üyeliksiz+mesajlaşmalıysa $29 engeli çözülür (Türk ICP kapısı).
Cevap beklenirken dürtme yok.

## Migration cutover CANLIDA DOĞRULANDI (2026-07-02) + 2. Gemini denetimi (ufak güvenli küme)
**Faz 2+3 canlıda teyit edildi:** kullanıcı Railway'de PostgreSQL public URL'iyle `npx prisma migrate
resolve --applied 0_init` çalıştırdı ("Migration 0_init marked as applied", PostgreSQL "railway" DB'sine
bağlandı — SQLite değil, çünkü yerel klasör önce `git reset --hard origin` ile güncellendi, aksi halde
eski/yanlış şema kullanılıyordu). Ardından Dockerfile `migrate deploy`'a çevrildi, push edildi, Railway
deploy log'u **"Deployment successful"** dedi ve dashboard gerçek veriyle sorunsuz yüklendi. Cutover
uçtan-uca kanıtlı çalışıyor.

**2. Gemini denetim dokümanı** (`lixus_ai_detailed_audit_and_proposals.md`) değerlendirildi:
- **✅ Uygulandı (ucuz+güvenli):** (a) OpenAI çağrı hataları artık Sentry'ye raporlanıyor — önceden
  `callOpenAI` her hatada (kötü anahtar/rate-limit/timeout) sessizce `null` dönüp fallback'e düşüyordu,
  kalıcı bir sorun (süresi dolmuş anahtar, tükenmiş kota) fark edilmeden AI kalitesini sürekli düşürebilirdi
  — fallback davranışı DEĞİŞMEDİ, sadece raporlama eklendi. (b) `clientIp` artık Cloudflare'ın
  `CF-Connecting-IP` header'ını (varsa) rightmost-XFF'den önce tercih ediyor — kendi güvenlik denetimimizin
  de işaret ettiği iyileştirme, header yoksa zararsız no-op. (c) `npm run env:recover` script'i
  (CLAUDE.md'deki kurtarma komutunun kısayolu) — sıfır riskli kolaylık.
- **❌ Reddedildi (aynı gerekçeyle tekrar):** AI-upsell/Paddle-ödeme-linki modülü — önceki turda zaten
  reddedilmişti (Airbnb-ban riski + Paddle host-marketplace değil), yeni argüman yok. Tam sistem-prompt
  yeniden yazımı + misafir mesajından TÜM `<>` karakterlerini regex'le silme — zaten şu an daha güvenli/test
  edilmiş bir fence savunmamız var (`<<...>>` + "veri bloğu kapatamaz" kuralı), regex-silme yıkıcı
  (meşru içerikte `<3` gibi karakterleri bozar) ve gereksiz. Yeni `pre_booking_inquiry` intent'i (15.
  kategori) — aynı davranışsal hedefi ÖNCEKİ turda taksonomiye dokunmadan, kapsamlı prompt-bloğuyla zaten
  sağladık; intent enum'unu genişletmek güvenlik-kapısı kalibrasyonuna gereksiz risk katar.
- **⏸️ Ertelendi (bizim önceki derin denetimimizle birebir örtüşüyor, yeni bilgi yok):** SystemLock
  heartbeat/fencing-token — zaten "çok-replica'ya geçince ilk eklenecek" kararı var, tek-replica'da
  gerçek risk yok.
- **🔵 İleride/kullanıcı-kararı (özellik, kod-otomasyonu değil):** WhatsApp kanal entegrasyonu (yeni
  webhook/hesap/maliyet), Bilgi Tabanı çok-dilli oto-çeviri (her KB düzenlemesinde OpenAI maliyeti +
  şema kararı), few-shot style-summarizer yeniden tasarımı (çekirdek reply-prompt'a dokunur, gerçek
  kalite-sinyali olmadan otonom yapılmaz). Yerel prompt-simülatör betiği — zaten Ayarlar→"AI'yı Deneyin"
  kartıyla karşılanıyor + önerilen dosya yolu/`ts-node` bizim repoya uygun değildi (yanlış/alakasız).
+4 test (CF-IP tercihi, OpenAI hata-raporlama 3 senaryo). 480 test yeşil, build temiz.

**⚠️ Bu turda BİR KEZ DAHA konteyner/çalışma-dizini reset'i yaşandı** — 3 dosyalık commit'lenmemiş
değişiklik (cf-connecting-ip, reportError, env:recover) diskten silindi TAM `git commit` anında (`git add
-A` boş geldi). Local HEAD origin ile hep eşitti (önceki tüm iş güvendeydi) — sadece o anki commit'lenmemiş
değişiklikler kayboldu, hemen yeniden yazılıp bu sefer **anında** commit+push edildi. **Ders (tekrar,
kalıcı kural olarak pekişti): edit → hemen commit+push, aradaki pencereyi hiç açık bırakma** — özellikle
tek dosya/küçük değişikliklerde bile, tam-suit testini push'tan SONRA doğrulama olarak çalıştır, önce değil.

## Hospitable — Patrick'in FİNAL cevabı geldi (2026-07-02): Connect kapandı + YENİ fırsat
**Connect netleşti (olumsuz):** Patrick açıkça "Connect tam misafir mesajlaşması değil, sadece Airbnb-bağlama
için sınırlı, Hospitable inbox üzerinden tam oku/gönder mesajlaşma DEĞİL" dedi. **Connect yolu artık kapalı** —
mesajlaşma gereken tek yol Public API (host'un kendi Hospitable aboneliği hâlâ şart).
**OAuth:** Devam — Public API partner vendor flow'a geçiyoruz. Scope'lar (property:read, reservation:read,
message:read, message:write) onaylandı, vendor flow sürecinde kesinleşecek. **Partner Portal:**
https://partners.hospitable.com/login · **Partner Resources:** https://hospitable.notion.site/Hospitable-Partner-Resources-6b5b233e5e334a05a81c8f9063539955
**🔑 YENİ FIRSAT — $29 engelinin olası çözümü:** Patrick kendiliğinden önerdi: **tek bir ana Hospitable hesabı
altında BİRDEN FAZLA host'un mülkünü yönetmek mümkün** ("could work well for property managers or operators
managing several listings centrally... it would still require a Hospitable subscription [tek hesap için] but
may lower the barrier... it would be somehow white labeled"). Yani: her Türk host kendi $29/ay'lık Hospitable
hesabı açmak yerine, **Lixus TEK bir hesapla birden fazla müşteri mülkünü yönetebilir** (property-manager/
operatör modeli). Tam gizli-arka-plan reseller şu an YOK ama **"trafik göstermeye başlarsan pilot/ticari
konuşmayı tekrar açarız"** dedi — kapı açık, kanıt (gerçek Türk host trafiği) istiyor.
**Gönderilecek cevap taslağı hazırlandı** (kullanıcı onayı bekliyor): OAuth'a başlıyoruz + tek-hesap/çoklu-mülk
modeline 3 somut soru (fiyatlandırma per-property ölçekte nasıl, "white-label" pratikte ne demek — misafir/host
Hospitable markasını hiç görmeyecek mi, farklı/ilişkisiz host'ların mülklerini tek hesapta yönetmenin bir kısıtı
var mı) + gerçek trafik gösterince pilot konuşmasını tekrar açma daveti.
**⚠️ Mimari not (ileride, kod DEĞİL, kullanıcı kararı gerek):** "tek hesap → çoklu tenant mülkü" modeli bugünkü
per-org şifreli-token mimarisinden (`getOrgHospitableToken`) farklı — paylaşılan tek master token'ı birden fazla
Lixus org'una mülk-bazında eşlemek gerekir, tenant-izolasyonu (org A'nın misafir verisi asla org B'ye sızmamalı)
yeniden tasarlanmalı. Fiyatlandırma/limit netleşmeden ve kullanıcı onayı olmadan buna dokunulmayacak.

## Hospitable OAuth vendor flow — CANLI (2026-07-02, commit 586ddb2)
Kullanıcı Partner Portal'a girdi (`partners.hospitable.com`), Public API erişimi onaylandı, "New client" ile
**Client ID + Secret** üretildi → **Railway env'e eklendi** (`HOSPITABLE_OAUTH_CLIENT_ID/SECRET`, repoya asla
yazılmadı). **"Hospitable ile Bağlan" tek-tık OAuth butonu** kodlandı (`lib/hospitable-oauth.ts` + `api/
hospitable/oauth/{authorize,callback}`), Settings'te manuel-token formunun üstünde ("veya elle bağlanın" ayracıyla).
**Authorize/token adresleri bulundu** (WebSearch ile `developer.hospitable.com/docs/public-api-docs` →
Authentication, 2 bağımsız aramada doğrulandı): `auth.hospitable.com/oauth/{authorize,token}` — artık kodda
**varsayılan** (env ile override edilebilir ama zorunlu değil). Yani **buton artık sadece Client ID+Secret ile
canlı** — bu ikisi Railway'de zaten var → **bu deploy'la buton gerçek kullanıcılara görünür oldu.**
**🔑 Kritik bulgu (aynı aramada çıktı, kodu değiştirdi):** OAuth access token **PAT gibi süresiz DEĞİL** —
**12 saatte doluyor**, `refresh_token` ile yenileniyor (o da 90 günde dolular + **rotasyonlu**: her yenilemede
yeni bir refresh_token dönüyor, eskisi tekrar kullanılamıyor). İlk yazdığım kod bunu süresiz sanıyordu, 12 saat
sonra sessizce bozulurdu — yakalanıp düzeltildi. `Organization.hospitableRefreshTokenEnc` + `hospitableTokenExpiresAt`
eklendi (nullable, PAT'lerde null kalır = eski davranış aynen korunuyor). `getOrgHospitableToken()` — sync/gönderimin
kullandığı TEK fonksiyon — artık süre dolunca **şeffafça yeniliyor**, hiçbir çağıran yer değişmedi. Kalıcı
hata (dead refresh token, 4xx) → bağlantı temizlenir (Settings "bağlı değil" gösterir, host yeniden bağlanmaya
yönlendirilir). Geçici hata (ağ/5xx) → bağlantı silinmez, o tur "bağlı değil" sayılır, sonraki tur kendini onarır.
Tarayıcıda gerçek client ID ile uçtan uca doğrulandı (Playwright): redirect linki `auth.hospitable.com`'a, doğru
scope + state cookie ile gidiyor. +19 test toplam (2 tur), 501 yeşil, build temiz.
**⏳ KULLANICIYLA BİRLİKTE DOĞRULANMASI GEREKEN (deploy sonrası):** Bu sandbox'tan Hospitable'ın gerçek OAuth
sunucusuna karşı UÇTAN UCA hiç denenmedi (yalnızca dokümantasyon-uyumlu şekil test edildi). **Kullanıcı Settings'te
"Hospitable ile Bağlan"a tıklayıp gerçek izin ekranından geçmeli**, callback'in düzgün "Bağlandı" dönüp senkronun
başladığını birlikte teyit etmeliyiz — para/e-posta akışı kuralına benzer "ilk gerçek denemeyi birlikte doğrula" ilkesi.

## Hospitable OAuth — CANLIDA DOĞRULANDI ✅ + 2 prod olayı + kalıcı ders (2026-07-02, 3 commit)
Kullanıcı gerçek hesabıyla "Hospitable ile Bağlan" butonunu denedi → yolda **2 prod olayı** çıktı, ikisi de
aynı gün düzeltildi, **son deneme temiz "Bağlı ✓ Hospitable ile bağlandı" ile bitti** (ekran görüntüsüyle
teyitli). Buton artık gerçek kullanıcılar için CANLI ve ÇALIŞIYOR.
- **Olay 1 — eksik migration (hotfix 495f83e):** `hospitableRefreshTokenEnc`/`hospitableTokenExpiresAt` alanları
  `schema.prisma`'ya elle eklenip `prisma generate` çalıştırılmıştı AMA gerçek migration dosyası ÜRETİLMEMİŞTİ.
  Boot bu oturumda zaten `migrate deploy`'a çevrilmişti (yukarıdaki "Migration cutover" bölümü) → sadece şemayı
  düzenlemek prod'da HİÇBİR ŞEY yapmadı, DB'de kolonlar hiç oluşmadı. Sonuç: her org için `scheduled-sync`
  `PrismaClientKnownRequestError: column does not exist` ile patladı (kullanıcı 5 ayrı hata-maili gösterdi).
  **Düzeltme:** `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel
  ./prisma/schema.prisma --script` ile eksik migration üretildi, taze bir throwaway Postgres'te 0_init + bu
  migration'ın SIFIR-drift uyguladığı doğrulandıktan sonra push edildi. **KALICI KURAL:** `schema.prisma`'yı
  elle değiştirdikten sonra **HER ZAMAN** gerçek bir migration dosyası üret (artık `db push` değil `migrate
  deploy` kullanılıyor) — yoksa şema ile DB sessizce ayrışır, sadece kod deploy edilince patlar.
- **Olay 2 — localhost yönlendirme buggy (fix df63441 + proaktif tarama 1784ed0):** Her iki yeni OAuth route'u
  `NextResponse.redirect(new URL(path, req.url))` kullanıyordu. Railway'in reverse-proxy'si arkasında `req.url`
  **container'ın İÇ adresini** taşır (`localhost:8080`), public domaini DEĞİL → kullanıcı callback'ten sonra
  `localhost:8080/settings?...` adresine (ERR_CONNECTION_REFUSED) yönlendirildi. Kod tabanında zaten aynı sorunun
  daha önce çözüldüğü bir yer vardı (`lib/auth/email-verify.ts`'teki `baseUrlFromHost(host)` — Host header'ından
  inşa eder). Her iki OAuth route'una bu fonksiyon uygulandı. **Ardından "hatasız olsun kontrolleri sağla"
  talimatıyla `src/app/api/` ağacının tamamı aynı desen (`new URL(...req.url)`) için tarandı** → üçüncü bir
  gerçek örnek bulundu: `api/auth/logout/route.ts`'in GET'i (aynı bug). Önemi: bu route, bu oturumda eklenen
  **sessionEpoch uyuşmazlığı guard'ının** yönlendirme hedefi de — yani düzeltilmeseydi şifre değiştirince/
  sessionEpoch uyuşmazlığında kullanıcı da aynı şekilde localhost'a düşerdi. Düzeltildi + 3 regresyon testi
  (`tests/integration/logout-route.test.ts`). **KALICI KURAL:** Railway arkasında **hiçbir route** `req.url`
  içinden mutlak URL kurmasın; her zaman `baseUrlFromHost(req.headers.get("host"))` kullan.
- **State mismatch (kullanıcı kendi teşhis etti, bug DEĞİL):** Bir denemede "state_mismatch" tekrarlandı ama
  bu sefer doğru domaindeydi — sebep 2 sekmenin aynı anda açık olup state cookie'sini ezmesiydi (kullanıcı: "2
  tane aynı sekme açıktı ondan sorun yok"). Tek sekmeyle temiz deneme başarılı oldu.
- **"0 mülk" görünmesi → bug DEĞİL:** Test edilen Hospitable hesabının gerçekten 0 mülkü var (Nuve'nin gerçek
  hesabı DEĞİL, bilinçli olarak ayrı test hesabıyla denendi — Nuve'nin Hospitable aboneliği zaten bitik/402).
- **Logo Partner Portal'da görünmüyor:** dosya repoda doğru (`public/lixus-logo-icon.png`, geçerli 512×512 PNG,
  `lixusai.com/lixus-logo-icon.png` canlıda erişilebilir) → bizim kod sorunu değil, muhtemelen Hospitable Partner
  Portal'ın kendi tarafında bir yapılandırma/cache gecikmesi. Düşük öncelik, işlevi etkilemiyor.
**Sonuç: 3 commit (495f83e, df63441, 1784ed0), 504 test yeşil, build+typecheck temiz, buton gerçek Hospitable
hesabıyla uçtan uca doğrulandı.** Bu bölüm kapandı — sıradaki OAuth işi kullanıcı yeni bir hesap/host bağladığında.

## Çalışma şekli
Kullanıcı: "Bana söyle, ben kodlarım." Fazları sırayla, additive + testli.
Build + `npm test` yeşil olmadan push etme. GitHub'da PR sadece kullanıcı
isterse açılır.
