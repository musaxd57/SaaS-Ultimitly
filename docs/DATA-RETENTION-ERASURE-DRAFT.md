# Veri Envanteri · Saklama · İmha/Erişim — İÇ TASLAK (kod-doğrulamalı)

> **Bu bir TASLAKTIR.** Kesin hukuki iddia (ör. "KVKK'ya tam uyumludur") İÇERMEZ.
> Karar bekleyen yerler **[HUKUK KARARI]** ile işaretlidir ve hukuk onayı olmadan
> belge nihai sayılmaz. Bu belge, koddaki gerçek veri modelinden (Prisma `schema.prisma`,
> `data-retention.ts`, hesap-silme rotası) çıkarılmıştır; politika metni için tamamlayıcı
> belge: `docs/saklama-ve-imha-politikasi.md`. Şirket/SELLER kimlik bilgisi UYDURULMAMIŞTIR;
> `legal-entity.ts` alanları hâlâ boştur (ödeme-öncesi blocker).

## 0) Roller (hipotez — avukat onayı şart)
- **Lixus = veri işleyen (processor):** misafir verileri (host adına işlenir). Host = veri sorumlusu.
- **Lixus = veri sorumlusu (controller):** host hesabı + faturalama verileri (Lixus'un kendi müşterisi).
- Alt-işleyenler: Hospitable (mesaj/rezervasyon), OpenAI (ABD — model), Paddle (MoR/ödeme),
  Resend (e-posta), Railway (barındırma/DB). **[HUKUK KARARI]** OpenAI ABD aktarımı → DPA +
  Standart Sözleşme Hükümleri; VERBİS; host-DPA şablonu.

## 1) Veri envanteri + saklama + imha (kod-doğrulanmış)

Kısaltmalar: **Cascade** = org/parent silinince DB'de otomatik silinir · **SetNull** = FK
NULL'lanır (satır kalır) · **Anon** = `anonymizeOldGuestData` ile PII maskelenir (satır kalır).

| # | Varlık (model) | İçerdiği kişisel veri | Saklama amacı | Önerilen süre | İmha / anonimleştirme mekanizması |
|---|----------------|----------------------|---------------|---------------|-----------------------------------|
| 1 | **User** | ad, e-posta, şifre-hash, 2FA sırrı | hesap/kimlik | hesap yaşadıkça | org silinince **Cascade** |
| 2 | **Organization** | işletme adı, ayarlar, şifreli Hospitable token | hesap | hesap yaşadıkça | `deleteAccountData` → `organization.delete` (kök) |
| 3 | **Property** | mülk adı/adresi | operasyon | hesap yaşadıkça | org'dan **Cascade** |
| 4 | **Reservation** | misafir adı/telefon/e-posta, guestExternalId, tarih, tutar | operasyon + gelir geçmişi | **Anon:** `DATA_RETENTION_MONTHS` sonrası (çıkıştan itibaren); satır doluluk için kalır | Property'den **Cascade**; süre dolunca **Anon** (ad→"Eski misafir", id→"Misafir") |
| 5 | **Conversation** | misafir tanıtıcısı, risk metadatası | mesaj bağlamı | rezervasyonla | Property'den **Cascade**; Anon'da guestIdentifier→"Misafir" |
| 6 | **Message** | misafir/host mesaj gövdesi (serbest metin PII olabilir), AI meta | operasyon + AI kredi | Anon süresi | Conversation'dan **Cascade**; süre dolunca inbound gövde→"[saklama süresi doldu]" + isim in-body redaksiyon |
| 7 | **Task / TaskUpdate** | görev başlığı/not, foto-URL, atanan kullanıcı | operasyon | rezervasyonla | Property'den **Cascade**; `reservationId`/`assignedToId` **SetNull** |
| 8 | **Görev fotoğrafları** | görsel (yerel disk `public/uploads/{org}`) | operasyon | hesap yaşadıkça | **DB DEĞİL** — `deleteAccountData` klasörü fiziksel siler (best-effort, hata → reportError, sessizce yutulmaz) |
| 9 | **SupplyRequest** | tedarik +1 kaydı | operasyon | rezervasyonla | Property'den **Cascade**; `reservationId` **SetNull** |
| 10 | **KnowledgeBaseItem / MessageTemplate** | host içeriği (PII olmayabilir) | operasyon | hesap yaşadıkça | Property/Org'dan **Cascade** |
| 11 | **CalendarSource** | iCal feed URL (kimlik-bilgisi sızabilir), feed-durum metadatası | takvim senk. | hesap yaşadıkça | Property'den **Cascade** |
| 12 | **ChatUsage** | mülk-başı AI kullanım sayacı (PII yok) | maliyet/limit | — | **FK YOK** → `deleteAccountData` propertyId ile ELLE siler |
| 13 | **MessageOutbox** | giden mesaj gövdesi (PII olabilir), teslimat durumu | dayanıklı gönderim + teslimat denetimi | kuyruk ömrü (kısa); terminal satırlar audit | Org'dan **Cascade** (org FK). ⚠ Gövde içerir → erasure kapsamı |
| 14 | **RiskEvent** | AI karar geçmişi (opak conv/property id, gövde YOK) | güvenlik denetimi | **[HUKUK KARARI]** öneri 24 ay | Org'dan **Cascade** |
| 15 | **AuditLog** | aktör kullanıcı-id, aksiyon, metadataJson | güvenlik/denetim | **[HUKUK KARARI]** öneri 12–24 ay | Org'dan **Cascade**; `actorUserId` **SetNull** |
| 16 | **CheckoutConsent** | userId, IP, userAgent, onay zamanı/versiyonu | Mesafeli Satış delili | **öneri (araştırmalı, §5):** zorunlu ≥3y (Mesafeli Söz. Yön. m.20/1, ispat yükü satıcıda) · önerilen 10y (TBK m.146 + KVKK m.5/2-e) — [AVUKAT İMZASI] | Org'dan **Cascade**; `userId` **SetNull** |
| 17 | **Invoice / Subscription** | tutar, sağlayıcı ref, customerId | fatura/muhasebe | **öneri (araştırmalı, §5):** 10y (TTK m.82; VUK m.253=5y → sıkı olan) → erasure'da bile TUTULUR, Yön. m.12 gerekçeli red (Kurul 2021/1104 emsal) — [AVUKAT İMZASI] | Org'dan **Cascade** (bugün); erasure'da satır minimize edilir, silinmez |
| 18 | **WebhookEvent** | Paddle payload (müşteri e-posta/ad/adres) | ödeme mutabakatı | finansal iskelet | **FK YOK** → cascade OLMAZ; `deleteAccountData` **önce PII'yi redakte eder**, iskelet kalır |
| 19 | **TwoFactorRecoveryCode** | kurtarma kodu hash'i | 2FA kurtarma | kod kullanılana/yenilenene | User'dan **Cascade** |
| 20 | **QR PIN metadatası** (Reservation alanları) | `chatBoundHash`, PIN-hash, kilit metadatası | QR concierge cihaz-bağı | rezervasyonla (stay-başı rotasyon) | Reservation ile **Cascade/Anon**. **[HUKUK KARARI]** `chatBoundHash` = **pseudonymous teknik tanımlayıcı** (hash+zaman, doğrudan kimlik değil) — "PII değildir" KESİN sınıflaması YAPILMADI, hukuki teyit bekliyor |
| 21 | **Lead** (operatör CRM) | aday host adı/iletişim/not | satış | **[HUKUK KARARI]** öneri: dönüşmezse N ay sonra purge (`purgeOldLeads` var) | bağımsız satır — ayrı purge |

## 2) İmha/erişim mekanizmaları (kod envanteri)
- **Kendi verini dışa aktarma (erişim):** `/api/account/export` — org + kullanıcılar + mülkler +
  rezervasyonlar + mesajlar + görevler/foto-linkleri + takvim kaynakları + supply + AI metadata +
  RiskEvent + fatura/abonelik + audit + consent + **messageDelivery (outbox durumu)** JSON.
- **Hesabı silme (erasure):** `deleteAccountData(orgId)` → (1) Paddle webhook PII redaksiyonu,
  (2) ChatUsage elle silme, (3) `organization.delete` (Cascade kök), (4) yerel foto klasörü fiziksel silme.
- **Otomatik saklama-süresi anonimleştirmesi:** `anonymizeOldGuestData` — `DATA_RETENTION_MONTHS`
  set ise, çıkışı cutoff'tan eski misafir PII'si maskelenir (satır/doluluk korunur). Orphan-sweep de var.
- **Diriliş koruması:** anonimleşmiş satıra sync/feed PII'yi GERİ YAZMAZ; cutoff'tan eski mesajlar re-import edilmez.

## 3) Hesap silme cascade davranışı (özet)
`organization.delete` → **Cascade**: User, Property (→ Reservation, Conversation→Message, Task→TaskUpdate,
SupplyRequest, KnowledgeBase, CalendarSource), MessageTemplate, AutomationRule, AuditLog, CheckoutConsent,
RiskEvent, Subscription, Invoice, **MessageOutbox**. **SetNull** (satır kalır): Task.reservationId,
AuditLog.actorUserId, CheckoutConsent.userId, TaskUpdate.userId. **FK'siz** (elle/redakte): ChatUsage (silinir),
WebhookEvent (PII redakte, iskelet kalır). **DB dışı:** görev fotoğrafları (yerel disk → fiziksel silinir).

## 4) Yedekler ve ileride PITR etkisi
- **Bugün:** yönetilen/manuel yedek yok denecek kadar (Railway); PITR planlı değil.
- **[HUKUK KARARI]** PITR/yedek açılırsa: bir erasure/anonimleştirme, yedeklerde **gecikmeli** yansır →
  "yedekte kalan PII" için saklama-süresi + geri-yükleme-sonrası yeniden-imha prosedürü tanımlanmalı.
- Yedek şifreleme + erişim kaydı + saklama süresi belgelenmeli.

## 5) Yasal zorunlulukla tutulabilecek kayıtlar (erasure'a rağmen) — ARAŞTIRMA-TEMELLİ ÖNERİ (2026-07-18, yalnız [AVUKAT İMZASI] kaldı)
- **Fatura/Invoice + ödeme kayıtları → 10 YIL (öneri):** TTK m.82 ticari defter/belgeleri **10 yıl**,
  VUK m.253 **5 yıl** (izleyen takvim yılından) saklatır — tacir için sıkı olan (10y) uygulanır.
  KVKK dayanağı: m.5/2-ç (hukuki yükümlülük). Erasure talebi bu satırları SİLDİREMEZ; Yönetmelik
  m.12 gerekçeli RED verilir (emsal: Kurul 2021/1104 — bankanın 10y saklama gerekçeli reddi hukuka
  uygun). Satırlar minimize edilir (bugünkü WebhookEvent-redaksiyon deseni), tamamen silinmez.
- **CheckoutConsent (Mesafeli Satış onay delili) → zorunlu ≥3 YIL, önerilen 10 YIL:** Mesafeli
  Sözleşmeler Yönetmeliği **m.20/1** cayma/bilgilendirme dahil her işlemin bilgi-belgesini **3 yıl**
  saklatır ve **ispat yükü satıcıdadır** → 3 yıl taban ZORUNLU. TBK m.146 genel zamanaşımı (10 yıl)
  boyunca sözleşmesel talep riski sürdüğünden **10 yıla uzatma** m.5/2-e ("bir hakkın tesisi,
  kullanılması veya korunması") ile savunulabilir — önerimiz bu.
- **Ticari e-ileti onay/ret kayıtları (trial-mail vb.) → 3 YIL:** Ticari İletişim ve Ticari
  Elektronik İletiler Hk. Yönetmelik **m.13**: onay kayıtları onayın geçerliliğinin bittiği tarihten,
  diğer kayıtlar (RET dahil) kayıt tarihinden itibaren **3 yıl**. Not: RET kaydının saklanması bizzat
  ZORUNLU — "talebi uygulayabilmek için talebin kaydını tutma" ilkesinin mevzuattaki yerleşik örneği
  (ErasureTombstone'un yerli emsali, §8c-1).

## 6) Müşteri erasure talebi — operasyon akışı (öneri taslağı)
1. Kimlik doğrula (hesap sahibi mi?).
2. **[HUKUK KARARI]** vergi/delil zorunluluğu istisnası uygulanacak mı belirle (Invoice/Consent).
3. Uygulanabilir kapsam için `deleteAccountData` çalıştır (self-servis "Hesabımı sil" bunu tetikler).
4. Foto klasörü silme hatası → operatör to-do (reportError görünür).
5. Alt-işleyenlere ilet (Hospitable/OpenAI/Paddle/Resend'de kalan veri için silme/anonimleştirme talebi).
6. Yedek/PITR açıksa (4. madde) yeniden-imha kuyruğuna ekle.
7. Talebi + sonucu AuditLog'a yaz.

## 7) Açık kararlar (kapatılmadan belge nihai OLMAZ)
- **[HUKUK KARARI]** Rol tespiti (processor/controller sınırları) + host-DPA.
- **[HUKUK KARARI]** Her varlık için kesin saklama süreleri (yukarıdaki "öneri"ler bağlayıcı değil).
- **[HUKUK KARARI]** `chatBoundHash` / PIN-hash / guestExternalId'nin pseudonymization sınıfı.
- ~~Invoice/Consent vergi/delil saklaması vs. erasure çatışması~~ → **öneri DOLU (§5: Invoice 10y TTK m.82 · Consent ≥3y MSY m.20/1 + 10y TBK m.146; m.12 gerekçeli-red mekaniği + 2021/1104 emsali)** — yalnız **[AVUKAT İMZASI]**.
- **[HUKUK KARARI]** OpenAI ABD aktarımı (DPA/SCC), VERBİS kaydı, Resend SPF/DKIM/DMARC + domain.
- **[HUKUK KARARI]** SELLER/legal-entity kimliği (`legal-entity.ts` boş — ödeme-öncesi blocker).
- **Teknik açık:** S3/R2 nesne depolama + imha kuyruğu (foto erasure dayanıklılığı); yedek/PITR politikası.

## 8) İKİ REJİM: süre-bazlı anonimleştirme ≠ açık silme talebi (araştırma-temelli, 2026-07-18)

> Kaynaklar resmî: 6698 sayılı Kanun (m.4, m.5, m.7, m.11, m.13), Kişisel Verilerin Silinmesi,
> Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik (RG 28.10.2017/30224; m.8-12),
> KVKK Kurulu karar özetleri (2021/1104, 2021/847, 2020/481, 2020/93) · saklama süreleri için:
> TTK m.82 (10y) · VUK m.253 (5y) · TBK m.146 (10y zamanaşımı) · Mesafeli Sözleşmeler Yön.
> m.20/1 (3y, ispat yükü satıcıda) · Ticari İletişim ve Ticari Elektronik İletiler Yön. m.13
> (onay/ret kayıtları 3y). Yorum katmanı **[AVUKAT İMZASI]** ile işaretlidir — araştırma-temelli
> öneri hazırdır, avukat onayı bağlayıcıdır.

### 8a) Hukuki çerçeve (doğrulanmış)
- **m.7:** İşleme şartları (m.5/6) tamamen ortadan kalkınca veriler **resen VEYA ilgili
  kişinin talebi üzerine** silinir / yok edilir / anonim hale getirilir.
- **Yönetmelik m.8 (silme tanımı):** silinen veri "ilgili kullanıcılar için **hiçbir şekilde
  erişilemez ve TEKRAR KULLANILAMAZ**" olmalı. → Açık silme talebinden sonra aynı verinin
  dış senkronla (Hospitable/iCal) geri gelmesi bu tanımı doğrudan bozar.
- **Yönetmelik m.10 (anonimleştirme):** başka verilerle eşleştirilse dahi kimlikle
  ilişkilendirilemez olmalı (geri döndürülemezlik).
- **m.13 + Yönetmelik m.12:** talep **en geç 30 günde** sonuçlandırılır. İşleme şartlarının
  **TAMAMI kalkmışsa** → imha zorunlu; **kalkmamışsa** → **gerekçeli RED mümkün** (30 gün
  içinde yazılı bildirim). Emsal: **2021/1104** — bankanın 10 yıllık yasal saklama süresi
  dolmadan silme talebini reddi HUKUKA UYGUN bulundu (Invoice/Consent istisnamız için emsal).
- **m.11:** ilgili kişi silme/yok etmeyi VE bu işlemin verinin **aktarıldığı üçüncü kişilere
  bildirilmesini** isteyebilir (alt-işleyen zinciri: Hospitable/OpenAI/… §6-5. adım).
- **Yönetmelik m.11 + m.7:** periyodik imha aralığı ≤ 6 ay; imha işlemleri kayıt altına
  alınır ve kayıtlar ≥ 3 yıl saklanır (AuditLog'a yazma pratiğimizin dayanağı).

### 8b) Bugünkü kodun sınıfı
`anonymizeOldGuestData` + sync diriliş-guard'ları = **yalnız SÜRE-BAZLI (resen) imha
politikası**. Cutoff-SONRASI gelen gerçekten YENİ mesaj, YENİ bir işleme faaliyetidir ve
kendi hukuki sebebine (m.5/2-c sözleşme, m.5/2-f meşru menfaat **[HUKUK KARARI]**) dayanır;
yeni saklama saati başlar. **Bu davranış genel KVKK kuralı DEĞİLDİR** — açık silme talebi
rejiminde aynı davranış ihlal olurdu.

### 8c) Eksik mekanizma: misafir açık-silme talebi + ErasureTombstone (TASARIM — kod YOK)
Bugün misafir-düzeyi açık silme yüzeyi yok (yalnız hesap-düzeyi + süre-bazlı). Host (veri
sorumlusu) 30-gün yükümlülüğünü yerine getirebilsin diye gereken tasarım:
1. **`ErasureTombstone` tablosu (additive):** orgId + kapsam anahtarları (reservationId'ler,
   `guestExternalId`, e-posta/telefon **hash**'i — talep ANINDA, veri silinmeden önce üretilir)
   + `erasedAt` + audit-ref. Ham PII tombstone'da TUTULMAZ (hash yeter — amaç eşleşme).
   **Tombstone'un kendi hukuki dayanağı (araştırmalı — [AVUKAT İMZASI]):** KVKK m.5/2-ç —
   silme yükümlülüğünün (m.7/Yön. m.8 "tekrar kullanılamaz") KENDİSİNİ uygulayabilmek için
   asgari kayıt tutmak veri sorumlusunun hukuki yükümlülüğüdür; yerli emsal: ticari e-ileti
   RET kaydının saklanması bizzat zorunludur (Ticari İletişim Yön. m.13 — talebi uygulamak
   için talebin kaydı tutulur). Veri minimizasyonu (m.4): yalnız hash + tarih. Saklama:
   org yaşadıkça (sync aynı kaynaktan aynı veriyi her an geri getirebilir → koruma süresiz;
   org silinince Cascade).
2. **Ingress guard'ları:** hospitable-sync (CREATE+UPDATE) · iCal import · QR resolve —
   tombstone eşleşen kaynaktan gelen ve `erasedAt` ÖNCESİ döneme ait veri İÇERİ ALINMAZ
   (mevcut `eraCutoff` deseninin per-talep versiyonu).
3. **Yeni-veri ayrımı (araştırmalı gerekçe — [AVUKAT İMZASI]):** `erasedAt` SONRASI gerçekten
   yeni mesaj/rezervasyon bloklanmaz. Dayanak: m.7/1 imhayı "işleme şartlarının TAMAMI ortadan
   kalkan" MEVCUT veriye uygular; talep sonrası misafirin kendi iradesiyle başlattığı yeni
   konaklama/mesaj o an var olmayan AYRI bir işleme faaliyetidir ve kendi m.5 sebebine dayanır
   (m.5/2-c sözleşmenin ifası — aktif rezervasyon; m.5/2-f meşru menfaat — operasyonel yanıt).
   Karşılaştırmalı destek: GDPR Art.17(3)(b)/(e) muafiyetleri aynı mantık. SINIR: bu yalnız
   OPERASYONEL işleme içindir — pazarlama/e-ileti tarafında ret kayıtları ayrı rejimdir
   (Ticari İletişim Yön. m.13; ret varsa yeni onay olmadan ileti YOK).
4. **İstisna katmanı:** Invoice/CheckoutConsent gibi yasal-saklama kayıtları m.12 gerekçeli
   red kapsamında tutulur (2021/1104 emsali); ret metni host'a hazır şablonla verilir.
5. **Süreç:** host UI'dan talep → kapsam önizleme → onay → imha + tombstone + AuditLog
   (≥3 yıl) + alt-işleyen bildirim listesi (m.11). 30-gün SLA notu UI'da.
6. **Durum (2026-07-18, m40 KOD YAZILDI):** `ErasureTombstone` tablosu (m40) + `src/lib/erasure.ts`
   (hash/normalize + guard + `eraseReservationData` yürütücüsü) + ingress guard'ları
   (hospitable-sync rezervasyon-kapısı + mesaj-cutoff birleşimi; iCal UID-kapısı) +
   host yüzeyi (`GET/POST /api/reservations/[id]/erase`, withManage + audit "kvkk.guest_erasure"
   [yalnız sayılar] + mülk sayfasında onaylı kontrol). **Yüzey `GUEST_ERASURE_ENABLED=1`
   default KAPALI; guard'lar HER ZAMAN AÇIK** (tombstone yoksa no-op — hiçbir şey hash'lenmez).
   Kırmızı-önce testler: satırlar tamamen silinmişken provider re-send → hiçbir şey re-import
   olmaz · yeni-veri sınırı (sonraki konaklama girer, pre-erasure mesaj girmez) · era-bloğu ·
   iCal UID-guard · flag-off 404 · manager/staff 403 (OWNER-only) · IDOR · at-rest ham-PII-yok.
   **YAPISAL TOCTOU GARANTİSİ (Codex, 2. sertleştirme):** ingress yazıcıları (hospitable-sync
   rezervasyon-TX + thread-TX; iCal satır-TX) provider verisini KİLİT DIŞINDA çeker, DB
   yazımını erasure ile AYNI org-scoped advisory xact lock altında yapar ve guard'ı KİLİT
   İÇİNDE taze okur → iki kesin sıralama: sync önce yazdıysa erasure ardından maskeler;
   erasure öncedeyse sync taze tombstone'u görüp YAZMAZ. Commit-sonrası verify-pass artık
   yalnız EK EMNİYET (ana güvence değildir). Kırmızı-önce tam-zamanlama testleri: erasure,
   sync'in fetch'i SIRASINDA commit olur (mock içine enjekte) → in-lock guard yazımı engeller
   (Hospitable + iCal, satırlar silinmiş varyant dahil). **FAIL-CLOSED:** tombstone VARKEN
   `ERASURE_HMAC_SECRET` yoksa (flag sonradan kapatılsa bile) eşleşme imkânsız → guard HER
   ŞEYİ bloklar, sync o org'a hiçbir şey almaz (testli; secret KALDIRILAMAZ — belgelendi).
   **expiresAt ŞARTI:** UI'daki "senkron geri getiremez" vaadi yalnız `expiresAt=null`
   (org-ömrü) iken mutlaktır; avukat süreli saklama seçerse flag O KARARA KADAR KAPALI kalır
   ve süre ancak "upstream geçmişi artık erişilemez" garantisiyle + UI metni birlikte
   güncellenerek kullanılabilir. **[AVUKAT İMZASI]** önerilerin onayı için hâlâ beklenir
   (flag açılmadan önce); belgelenmiş tavizler: CSV/manuel import guard'lanmadı (host'un
   kendi dosyası — sorumluluk host'ta) · kanal (Airbnb/Hospitable) kopyasını Lixus silemez,
   UI bunu açıkça söyler.
