# Kişisel Veri Saklama ve İmha Politikası — İÇ TASLAK (kod-doğrulamalı)

> ⚠️ **STATÜ: İÇ ÇALIŞMA TASLAĞI — hukukçu onayı OLMADAN yayınlanmaz/imzalanmaz.**
> Bu belge yazılım asistanı tarafından, **satır referanslı kod incelemesiyle** hazırlandı:
> "ne saklanıyor / ne zaman siliniyor / nasıl siliniyor" sütunları koddan doğrulanmıştır.
> **Hukuki gerekçe sütunu ise HİPOTEZDİR** (avukat seçer/onaylar). Karar bekleyen her
> alan `[KARAR-…]` etiketiyle işaretlidir — bu etiketler kapatılmadan belge nihai olamaz.
> Public metinle ilişki: `src/app/(legal)/gizlilik/page.tsx` bilinçli olarak jenerik
> ("mevzuatın gerektirdiği süre boyunca") yazılmıştır ve bu taslakla ÇELİŞMEZ; somut
> süreler önce burada kesinleşir, public metin güncellemesi (LEGAL_VERSION artışı +
> consent-evidence etkisi nedeniyle) ayrı ve bilinçli bir adım olarak yapılır.

## 0) Rol tespiti (hipotez — avukat onayı şart)

- Misafir verileri (rezervasyon, mesajlar): Lixus **ev sahibi adına "veri işleyen"**;
  ev sahibi (Müşteri) veri sorumlusu. (Mevcut `docs/KVKK-taslaklar.md` §1 ile uyumlu.)
- Hesap/kullanım/faturalama/lead verileri: Lixus **veri sorumlusu**.
- `[KARAR-ROL]` Bu ayrımın host sözleşmesine (DPA) yazılması gerekiyor — CLAUDE.md
  LEGAL listesindeki "host DPA" maddesi.

## 1) Saklama/İmha Matrisi

Sütunlar: **Veri kategorisi → Saklama süresi/kaynağı → Silme/anonimleştirme mekanizması → Hukuki gerekçe (hipotez) → Alt işleyen(ler)**

### 1a. Misafir verileri (Lixus = veri işleyen)

| Kategori (model.alan) | Saklama süresi / kaynağı | Silme / anonimleştirme (kod) | Hukuki gerekçe (hipotez) | Alt işleyen |
|---|---|---|---|---|
| Misafir kimlik+iletişim: `Reservation.guestName/guestPhone/guestEmail/guestExternalId/guestCheckoutTime/notes` | Konaklama bitişi + `DATA_RETENTION_MONTHS` (**canlıda 24 ay**, env; kapatılabilir) | Otomatik sweep `anonymizeOldGuestData` (data-retention.ts:70): ad→"Eski misafir", diğerleri→null; parti başına 300 satır; hesap silmede org cascade | Sözleşmenin ifası (host adına misafir iletişimi) + host'un meşru menfaati (uyuşmazlık/kayıt) `[KARAR-GEREKÇE-MISAFIR]` | Hospitable (kaynak), Railway (DB), OpenAI (yalnız ad+tarihler, AI çağrısında) |
| Misafir mesaj gövdeleri: `Message.body` (inbound), `aiSuggestedReply` | Aynı pencere (rezervasyona/`lastMessageAt`e bağlı) | Inbound body→"[saklama süresi doldu — içerik silindi]", `senderName`→"Misafir", `aiSuggestedReply`→null (data-retention.ts:121-129); **outbound (host/AI yanıtı) SAKLANIR**, içindeki misafir adı "[Misafir]" ile redakte edilir (:36-49) — host'un kendi kaydı | Aynı `[KARAR-GEREKÇE-MISAFIR]` | OpenAI (son 6 mesaj + güncel mesaj prompt'a gider — ai/prompts.ts:651-736), Railway |
| Konuşma başlığı: `Conversation.guestIdentifier` | Aynı pencere; rezervasyonsuz (orphan) thread'ler kendi `lastMessageAt`ine göre AYRICA süpürülür (data-retention.ts:154-190) | →"Misafir" | Aynı | Railway |
| QR concierge sohbeti | Normal Conversation/Message satırları (channel "chat") — yukarıdaki kurallar aynen | Aynı sweep + org cascade | Aynı | OpenAI (QR yolunda rezervasyon PII'sı modele GİTMEZ — route.ts:287-293), Railway |
| Cihaz bağlama: `Reservation.chatBoundHash/chatBoundAt` | Konaklama başına; her rezervasyon null başlar | sha256 hash + zaman damgası — **takma-adlı (pseudonymous) teknik tanımlayıcı**; doğrudan kimlik içermez ama KVKK'da kişisel veri sayılıp sayılmayacağı **hukuki teyit bekliyor** `[KARAR-CHATBOUND]`; org cascade ile silinir | `[KARAR-CHATBOUND]` | Railway |
| `ChatUsage` (günlük AI sayaç) | Sayaç, PII yok (propertyId+gün+adet) | Hesap silmede explicit `deleteMany` (data-retention.ts:377) | — | Railway |

**Diriltme korumaları (kod-doğrulanmış):** senkron, anonimleştirilmiş satıra kanal
PII'sını GERİ YAZMAZ ve `retentionCutoff()` (data-retention.ts:59) öncesi mesajları
yeniden import etmez — public metindeki "teknik kontroller uygulanır" cümlesinin karşılığı.

### 1b. Müşteri (host) hesap verileri (Lixus = veri sorumlusu)

| Kategori | Saklama | Silme mekanizması | Hukuki gerekçe (hipotez) | Alt işleyen |
|---|---|---|---|---|
| `User.name/email` + `passwordHash` (bcrypt) + 2FA sırrı (AES-256-GCM şifreli) | Hesap ömrü | `POST /api/account/delete` (owner + parola + impersonation'da bloklu) → `deleteAccountData` → org cascade (User dahil) | Sözleşmenin kurulması/ifası | Railway; e-posta adresi Resend'e (transactional mail) |
| Üyelik/consent delili: `User.acceptedTermsAt/privacyAcceptedAt/acceptedLegalVersion/acceptedIp/acceptedUserAgent` | Hesap ömrü — `[KARAR-CONSENT-SÜRE]` hesap silindikten sonra ispat için saklanmalı mı? (bugün: cascade ile SİLİNİR) | Org cascade | Hukuki yükümlülük/ispat (m.5/2-e hipotezi) | Railway |
| Oturum JWT içeriği: email+name (+impersonation'da actor alanları) | Çerez ömrü 14 gün (sliding), `sessionEpoch` ile sunucu taraflı düşürülebilir | Kendiliğinden; parola değişiminde epoch bump | Sözleşmenin ifası | — |
| Görev fotoğrafları (`public/uploads/{org}/…`, yerel disk) | Hesap ömrü — ⚠️ disk EPHEMERAL (deploy'da kaybolabilir; S3/R2 açık iş) | Hesap silmede klasör `rm` (best-effort; hata `reportError` ile görünür — data-retention.ts:390-400) | Sözleşmenin ifası | Railway (disk) |
| `AuditLog` (aksiyon + actor + metadata) | Hesap ömrü; bağımsız süre YOK `[KARAR-AUDIT-SÜRE]` | Org cascade | Meşru menfaat (güvenlik/izlenebilirlik) | Railway |
| `RiskEvent` (AI karar geçmişi) | **Tasarım gereği PII-siz** (kapalı-set enum + opak id — schema.prisma:690 blok yorumu) | Org cascade | Meşru menfaat (güvenlik kanıtı) | Railway |

### 1c. Faturalama/ödeme verileri

| Kategori | Saklama | Silme mekanizması | Hukuki gerekçe (hipotez) | Alt işleyen |
|---|---|---|---|---|
| `Subscription` / `Invoice` (tutar-minor, durum, provider ref; kart verisi YOK — hiç tutulmaz) | Bugün: hesap ömrü — ⚠️ `[KARAR-FATURA-SÜRE]` VUK/TTK saklama yükümlülüğü (10 yıla kadar) ile org-cascade silme ÇELİŞEBİLİR; Paddle MoR olarak satış kaydını kendisi tutuyor, Lixus tarafındaki satırların niteliğini (dahili mutabakat kaydı mı, yasal defter kaydı mı) avukat belirlemeli | Org cascade (schema.prisma:631,655) | Hukuki yükümlülük | Paddle (MoR — tahsilat+vergi), Railway |
| `CheckoutConsent` (mesafeli satış onay delili: plan, fiyat id, LEGAL_VERSION, ip, UA) | Bugün: hesap ömrü — aynı `[KARAR-FATURA-SÜRE]` sorusu (uyuşmazlıkta delil) | Org cascade | Hukuki yükümlülük/ispat | Railway |
| `WebhookEvent` (Paddle ham olayları) | SİLİNMEZ — hesap silmede **redakte edilir**: allowlist iskelet (event id/tip/tarih, işlem id, customer_id, tutar, para birimi, dönem sonu) kalır; e-posta/ad/adres/kart DÜŞER (`redactPaddleWebhooksForOrg` + `redactPaddlePayload`, data-retention.ts:220-357) | Redaksiyon + status:"processed" (retry ham PII'yı geri yazamaz) | Hukuki yükümlülük (mali iz) — public gizlilik metni §Paddle bunu AYNEN söylüyor ✓ | Paddle, Railway |

### 1d. Pazarlama/operasyon verileri

| Kategori | Saklama | Silme | Hukuki gerekçe (hipotez) | Alt işleyen |
|---|---|---|---|---|
| `Lead` (ad, e-posta, telefon, mesaj, `consentAt`) — org FK'sız | `LEAD_RETENTION_MONTHS` env — **canlıda AYARLI DEĞİL → bugün süresiz** `[KARAR-LEAD-SÜRE: öneri 12-24 ay; env'e yazılınca purgeOldLeads (data-retention.ts:202) otomatik siler]` | `purgeOldLeads` deleteMany; operatör paneli manuel | Açık rıza (`consentAt` kayıt formunda) | Railway; `ALERT_EMAIL` bildirimi (leads/route.ts:47) |
| Hata kayıtları (console → Railway log; opsiyonel Sentry `SENTRY_DSN`; opsiyonel `ERROR_ALERT_EMAIL`) | Railway log saklaması platform-taraflı `[KARAR-LOG-SÜRE: Railway paneli/planına göre doğrula]`; Sentry canlıda açık mı `[KARAR-SENTRY: env doğrula]` | Her egress ÖNCESİ `redactSensitive` (report-error.ts:49-72): parola/token/çerez/JWT/e-posta/telefon/ad/adres/kapı-kodu maskeleme — public metin §hata kayıtları ile uyumlu ✓ | Meşru menfaat (güvenlik) | Railway, (ops.) Sentry, (ops.) Resend |
| Transactional e-postalar (doğrulama, parola kodu, deneme hatırlatma, görev ataması, şikayet uyarısı — uyarı e-postası misafir mesajı ALINTISI içerebilir: email-templates.ts:178, alıcı=host'un kendisi) | Resend/SMTP sağlayıcı log'u `[KARAR-EMAIL-LOG: Resend saklama süresini doğrula]` | — (uçtan geçer, DB'de ayrıca tutulmaz) | Sözleşmenin ifası | Resend (tercih) / SMTP |

### 1e. Yedekler

- Repo'da yedek otomasyonu YOK (kod-doğrulandı; scripts/ = env/guard araçları).
- Railway platform yedeği/PITR panel-taraflı `[KARAR-YEDEK: açık mı, saklama süresi ne,
  rotasyon kaç gün? CLAUDE.md "Railway backup/PITR (panel)" açık işiyle aynı]`.
- ⚠️ Standart imha ilkesi: anonimleştirme YEDEKLERE geriye dönük işlemez; politika
  "silinen/anonimleşen veri, yedek rotasyonu tamamlanınca (en geç [X] gün) yedeklerden
  de düşer" cümlesini `[KARAR-YEDEK]` kapanınca alabilir. Tek seferlik manuel `pg_dump`
  (2026-07-13 prod temizliği öncesi) nerede duruyor, ne zaman imha edilecek `[KARAR-PGDUMP]`.

## 2) İmha/erişim mekanizmaları (kod envanteri)

- **Otomatik anonimleştirme:** `anonymizeOldGuestData` — yalnız `DATA_RETENTION_MONTHS>0`
  iken; scheduled-sync **deep** geçişinde koşar (scheduled-sync.ts:256-267; 2-dk cron,
  deep kadans SystemLock'ta). Kapatılırsa süpürme DURUR (env bilinçli).
- **Hesap silme (m.7 / m.11):** `/api/account/delete` → `deleteAccountData`
  (data-retention.ts:363): ① Paddle webhook redaksiyonu ② ChatUsage temizliği
  ③ `organization.delete` cascade (User, Property→Reservation/Conversation/Message/
  Task/TaskUpdate/KB/SupplyRequest/CalendarSource, MessageTemplate, AutomationRule,
  AuditLog, Subscription, Invoice, CheckoutConsent, RiskEvent) ④ upload klasörü rm.
- **Tekil silme:** rezervasyon/konuşma DELETE uçları (withManage, org-scoped) — public
  metindeki "panelinizden dilediğiniz zaman silebilirsiniz" cümlesinin karşılığı ✓.
- **Veri taşınabilirliği:** `/api/account/export` (owner-only, no-store) — kapsam:
  org+ayarlar, rezervasyonlar, konuşma+mesaj+AI metadata, görev+güncelleme+foto linki,
  takvim kaynakları, supply, fatura/abonelik, audit, consent, RiskEvent. Sırlar
  (parola/2FA/verify hash'leri, şifreli Hospitable token'ları) HARİÇ — pin testli.
- **Başvuru kanalı:** gizlilik sayfasındaki iletişim adresi; 30 gün taahhüdü public
  metinde mevcut (`gizlilik/page.tsx:195`).

## 3) Alt işleyen listesi (kod-doğrulanmış envanter)

| Alt işleyen | İşlev (kod kanıtı) | Veri | Durum |
|---|---|---|---|
| OpenAI (ABD) | AI yanıt üretimi (`ai/index.ts:127`) | Misafir adı+tarihler+mesaj gövdeleri+KB; telefon/e-posta GÖNDERİLMEZ; QR yolunda ad da gitmez | `[KARAR-DPA-OPENAI]` DPA + KVKK m.9 mekanizması (Standart Sözleşme) — CLAUDE.md LEGAL listesi |
| Paddle (MoR) | Ödeme/abonelik + webhook | Ödeme kimliği, tutar, customer_id; kart verisi Lixus'a hiç gelmez | `[KARAR-DPA-PADDLE]` MoR sözleşme metni avukatta |
| Hospitable (ABD) | Kanal senkronu (per-tenant şifreli token) | Rezervasyon+mesaj verisinin KAYNAĞI | `[KARAR-DPA-HOSPITABLE]` |
| Resend (ABD) / SMTP | Transactional e-posta (email.ts) | Alıcı e-posta + içerik | Domain/SPF/DKIM/DMARC açık iş; `[KARAR-EMAIL-LOG]` |
| Railway (AB/ABD) | Barındırma + PostgreSQL + log | Tüm veri at-rest | `[KARAR-YEDEK]`, `[KARAR-LOG-SÜRE]` |
| Sentry (ops.) | Hata izleme — yalnız `SENTRY_DSN` set ise; gönderim öncesi `redactSensitive` | Redakte hata metni | `[KARAR-SENTRY]` canlı env doğrula |

Not: `docs/KVKK-taslaklar.md` §1 tablosunda ödeme sağlayıcı "iyzico" yazıyor — kod ve
canlı Paddle (MoR); o taslak avukata giderken bu satır Paddle olarak düzeltilmeli
(bu belge esas alınsın).

## 4) Açık kararlar (tek liste — kapatılmadan belge nihai olmaz)

1. `[KARAR-ROL]` veri işleyen/sorumlusu ayrımı + host DPA.
2. `[KARAR-GEREKÇE-MISAFIR]` misafir verisi işleme dayanağı (m.5) — avukat.
2b. `[KARAR-CHATBOUND]` chatBoundHash türü tanımlayıcıların (cihaz hash'i) KVKK'da
   kişisel veri/takma-adlı veri sınıflandırması — avukat teyidi.
3. `[KARAR-FATURA-SÜRE]` Invoice/CheckoutConsent: org-cascade silme ↔ VUK/TTK saklama
   yükümlülüğü; gerekirse "hesap silinse de fatura iskeleti X yıl saklanır" istisnası
   (kod değişikliği gerektirir — bugün cascade siler; WebhookEvent iskeleti zaten kalır).
4. `[KARAR-CONSENT-SÜRE]` üyelik/KVKK consent delillerinin hesap sonrası ispat saklaması.
5. `[KARAR-AUDIT-SÜRE]` AuditLog bağımsız saklama süresi.
6. `[KARAR-LEAD-SÜRE]` `LEAD_RETENTION_MONTHS` canlıya yazılacak değer (öneri 12-24).
7. `[KARAR-YEDEK]` + `[KARAR-PGDUMP]` Railway yedek/PITR süresi + manuel dump imhası.
8. `[KARAR-LOG-SÜRE]`, `[KARAR-SENTRY]`, `[KARAR-EMAIL-LOG]` sağlayıcı saklama süreleri.
9. `[KARAR-DPA-*]` OpenAI/Paddle/Hospitable/Resend DPA'ları + KVKK m.9 mekanizması +
   VERBİS kaydı (CLAUDE.md LEGAL listesiyle aynı).
10. Public `gizlilik` metnine somut süre yazılacak mı (yazılırsa LEGAL_VERSION artışı +
    consent-evidence etkisi birlikte planlanır — bu turda bilinçli DOKUNULMADI).
