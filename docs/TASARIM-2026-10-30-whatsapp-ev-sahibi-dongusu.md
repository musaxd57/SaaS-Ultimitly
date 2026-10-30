# TASARIM 2026-10-30 — WhatsApp'tan ev sahibine kısa soru → cevap → misafire yanıt ("Ev Sahibi Soru Kanalı")

> **Durum:** TASARIM. Kod YOK, migration YOK, bayrak YOK. Bu belge `src/`, `prisma/`, `tests/` altında hiçbir dosyaya dokunmadan yazıldı.
> **Kurucu talimatı (10-30, aynen):** "WP'yi hemen bağlamak istiyorum artık ordan hemen hosta kısaca soruyu sorup alınması gereken yanıtı alıp
> hemen cevap ürettirip müşteriye yazma akışına geçilmeli".
> **Bağlı belgeler:** `docs/HOST-COPILOT-GEREKSINIMLERI-2026-09-25.md` (§6 iki onay kademesi, §8 bilgi tabanı bakımı, §11 "WhatsApp sistemin
> kendisi değil", Faz 5) · `docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md` (§5 "para ve iptal WhatsApp'tan tek dokunuşla değil") ·
> `docs/TASARIM-2026-10-02-host-karar-motoru.md` · `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md` (K-1029-A) ·
> `docs/claude/acik-isler.md:171` (kurucu 10-29 gece WhatsApp notu).
> **Dış kaynak notu:** `developers.facebook.com` bu oturumda doğrudan AÇILAMADI (ağ izni yok). Meta bilgileri arama motoru özetlerinden alındı;
> her maddenin yanında resmi adres var. Kurulum günü resmi sayfadan bir kez teyit edilir (özellikle fiyat ve sınır rakamları).

---

## 0. Kısaca (kurucu için, teknik olmayan dil)

Bugün yapay zekâ bir misafir sorusunu cevaplayamayınca misafire hiçbir şey gitmiyor, size "Misafir cevabınızı bekliyor" e-postası geliyor,
siz panele girip yazıyorsunuz. Yeni akışta e-posta yerine (ya da e-postadan önce) **WhatsApp'tan kısa bir soru** gelir. Siz WhatsApp'ta
**o mesaja cevap yazarsınız**; yapay zekâ sizin cevabınızdan, **sizin ağzınızdan ve misafirin dilinde** düzgün bir mesaj kurar, bütün güvenlik
kontrollerinden geçirir, size gösterir; siz **[Gönder]**'e basınca misafire gider.

**Örnek — önce (bugün):**
- Misafir (Airbnb): "Is there a baby cot in the apartment?"
- Bilgi tabanında yok → misafire bir şey gitmez → size e-posta: "Misafir cevabınızı bekliyor — Lale". Panele girip yazarsınız.

**Örnek — sonra (öneri):**
- WhatsApp (Lixus AI → siz): "Lale (12–15 Kas) · Misafir soruyor: “Is there a baby cot in the apartment?” Cevabınızı bu mesaja yanıt olarak yazın."
- Siz (mesaja kaydırıp cevap): "var, yatak odasındaki dolapta"
- WhatsApp (Lixus AI → siz): "Misafire gidecek (İngilizce): “Yes, there is a baby cot — you'll find it in the bedroom wardrobe.”
  Türkçesi: “Evet, bebek yatağı var; yatak odasındaki dolapta.” **[Gönder] [Gönderme] [Panelde düzenle]**"
- Siz: **[Gönder]** → "Gönderildi ✓" → (isteğe bağlı) "Bu bilgiyi Lale için kaydedeyim mi? **[Kaydet] [Hayır]**"

Karar kartlarında (erken giriş / geç çıkış) mesaj düğmeli gelir: "Lale · 13:00 erken giriş isteği (14 Kas) **[Onayla] [Reddet] [Panelde aç]**".
Para, iade, iptal içeren kararlar WhatsApp'ta tek dokunuşla verilmez; panel bağlantısı gelir (Faz 0 §5).

---

## 1. Bugün ne var — envanter (kodda doğrulandı, HEAD `98b5d838`)

### 1.1 Ev sahibine giden bildirimler (hepsi e-posta; telefon / WhatsApp yok)

| Ne | Nerede | Tekrar önleme | Yeniden kullanılır mı |
|---|---|---|---|
| "Misafir cevabınızı bekliyor" (K10) | `src/lib/host-reply-waiting.ts:58` `notifyHostReplyWaiting` | Mesaj başına `SystemLock` `reply-waiting-mail:<mesaj>` (`:25`), "gönderildi" onayı `:51`, 45 gün | **Evet** — WhatsApp sorusu AYNI talep satırını kullanır (mesaj başına tek bildirim, kanaldan bağımsız) |
| "Karar bekliyor" | `src/lib/decisions/notify.ts:27` `notifyTurnDecisions` | Aynı `reply-waiting-mail:` kilidi + kart başına `DecisionRequest.notifiedAt` | **Evet** — karar şeridi (§3.10) |
| Acil / hassas öğe e-postası | `src/lib/conversation-items/flow.ts:283` `notifyHeldItems`, önek `held-items-mail:` (`:266`) | Mesaj başına talep + öğe `notifiedAt` | Dilim 4 (acil bildirim) |
| Sessiz kalan açık ihtiyaç | `flow.ts:410` `notifyOpenNeeds`, `open-need-mail:<öğe>` 1 yıl (`:388`) | Satır başına kalıcı kayıt | **Evet** — "aynı soruya ikinci bildirim yok" kuralının kaynağı |
| Çağrı noktaları | `src/lib/automation.ts:3131` (karar), `:3476`/`:3494` (öğe kipi tutuşu), `:3836` (öğesiz K10), `:4357` `notifyItemsForHost`, `:6276` `alertItemsForHost` | — | **Tek tetik noktası buraya bağlanır** (§3.1) |
| Alıcı | `host-reply-waiting.ts:70-79`: `Organization.alertEmail` ya da ilk sahibin e-postası | — | WhatsApp alıcısı ayrı kayıt (§6) |
| Saatlik tavan emsali | `src/lib/hazard-unverified-alert.ts:23` (işletme başına saatte 3) | `rateLimit` | **Evet** — WhatsApp tavanları aynı yapı |
| Geçiş tabanlı alarm | `src/lib/alert-state.ts:52` `alertOnTransition` | `alert-state:<anahtar>` | **Evet** — şablon reddi / belirteç ölümü alarmı |

### 1.2 Host karar motoru (migration 59, anahtar KAPALI)
- Bayrak `src/lib/decisions/flag.ts:6` `HOST_DECISIONS_ENABLED` ("1"); yapay zekâ metni `src/lib/decisions/ai-text.ts:26` `HOST_DECISION_AI_TEXT_ENABLED`.
- Tablo `prisma/schema.prisma:1593` `DecisionRequest` (durum makinesi + CAS `version`, `notifiedAt`, metin taşımaz).
- Taslak yazıcı `ai-text.ts:140` `draftDecisionMessage`: yazıcı yalnız karar kaydını görür (misafir metni GİTMEZ), sonra KOD denetimi
  (`decisions/text-check.ts`) + yön bekçisi (`runStayChangeGuard`); geçmezse onaylı 7 dil şablonu. **Bu desen yeni "cevap kurucu"nun şablonudur**
  (§3.6).
- Gönderimden önce yeniden doğrulama + gönderim: `src/app/api/conversations/[id]/decisions/[decisionId]/route.ts` (315 satır; sürüm CAS,
  `guest_wrote_again` 409 `:179`, `factsHash` `:187-198`, `sendHostMessage` `:253`). **Eksik:** mantık rotanın İÇİNDE; WhatsApp düğmesinin
  çağırabilmesi için `src/lib/decisions/decide.ts` gibi bir kütüphane işlevine (davranış birebir, rota testleri pinler) çıkarılması gerekir.

### 1.3 Açık sorular / tutulan cevaplar
- `src/lib/ai/host-decision-hold.ts:13` `AI_HOST_DECISION_HOLD_ENABLED`: "ev sahibinizin kararıdır" misafire gitmez → K10 yolu.
- Konuşma öğeleri `prisma/schema.prisma:1558` `ConversationItem` (durum `open | pending_host | answered | withdrawn | superseded | done`;
  `topic` kodla kurulan ≤3 sözcük etiket, ad / rakam yok; `notifiedAt`). Çekirdek `src/lib/conversation-items/core.ts:40`; sessiz tür
  `NO_NOTIFY_KINDS` `:96`; acil türler `URGENT_RISK_TYPES` `:136`; konaklama değişikliği türleri `STAY_CHANGE_ITEM_KINDS` `:533`.
- "Ev sahibi yazdı" SAKLANMAZ, türetilir (`effectiveStatus` `core.ts:613`): ev sahibinin konuşmaya yazdığı her mesaj öncesindeki açık öğeleri
  "ev sahibi cevapladı" gösterir. → WhatsApp'tan kurulan cevap **ev sahibi mesajı** olarak gittiğinde öğeler kendiliğinden kapanır
  (ek yazma yolu gerekmez). Dikkat: kapsanmayan öğe de kapanmış görünür → §3.6'da "hepsi kapsanmadan gönderme, önce sor" kuralı.
- K-1029-A (10-30): "ev sahibinize yazın" yedi dilde silinir, cevapsız soru açık kalır (`src/lib/ai/host-contact-filler.ts:680`
  `stripHostContactFiller`, `src/lib/ai/absence.ts:1307` `mentionsHostContact`, kapsama kuralı `conversation-items/host-contact-settle.ts:60`,
  `topic-absence.ts:214`). **WhatsApp sorusunun asıl tetikleyicisi bu "açık kalan soru"dur.**
- Hazır taslak `conversation-items/prepared-draft.ts:37` (son misafir mesajının `aiSuggestedReply` alanı) → "Panelde düzenle" düğmesi taslağı
  buraya yazarak paneli hazır açar.

### 1.4 Misafire gönderim yolu (Channel Layer)
- Ev sahibi adına TEK gönderim çekirdeği `src/lib/host-send.ts:58` `sendHostMessage` (elle cevap ve karar kartı aynı yol): claim-then-send,
  kesin / belirsiz hata ayrımı, kalıcı kuyruk açıksa `enqueueOutbound`, `authorType: "host"`, `aiAssisted`, idempotency anahtarı.
  **Aynen yeniden kullanılır.**
- Sağlayıcı sınırı `src/lib/channels/outbound.ts:100` `OutboundAdapter` + `:145` `dispatchOutbound`, kayıt defteri `channels/index.ts:13`,
  test kancası `__setOutboundAdapterForTest` `:135`. **Bu, ev sahibi kanalı için kopyalanacak desen** (ayrı kayıt defteri; misafir kanalı
  `ChannelConnection` ile KARIŞMAZ — o misafir tarafının sağlayıcısıdır).
- Mimari pin `tests/unit/core-channel-independence.test.ts` (çekirdek sağlayıcı import etmez; `:191` "whatsapp" dahil kanal etiketi
  karşılaştırması `channels/` dışında yasak).

### 1.5 İz, takip numarası, denetim
- `src/lib/correlation.ts` (sunucu üretir; `runAsNewSystemOperation`, `adoptCorrelation`) · `src/lib/event-log.ts:21` `OPERATIONAL_EVENTS`
  kapalı küme + izinli veri anahtarları (telefon / metin sığmaz) · `AuditLog` (`schema.prisma:949`). **Yeniden kullanılır;** yeni olay adları
  ve `questionId` anahtarı eklenir.

### 1.6 Web kancası deseni
- `src/app/api/webhooks/paddle/route.ts`: anahtar yokken uyuyan uç (200 `{disabled:true}`, hiçbir şey saklamaz), HAM gövde üzerinde HMAC
  (`src/lib/payments/paddle.ts:57`, `timingSafeEqual`), `readTextCapped` + `MAX_WEBHOOK_BODY_BYTES` (`src/lib/api.ts:402-412`), kötü imza
  alarm kısıtı (`billing/bad-signature-throttle`), olay kimliğiyle idempotency. **Aynen emsal.**
- Rol / bürünme pin listeleri: `tests/unit/api-route-role-gate.test.ts:179`, `tests/unit/impersonation-read-only-pin.test.ts:34` → yeni uç
  buralara gerekçesiyle girer.

### 1.7 Telefon alanı
- **Ev sahibi / kullanıcı için telefon alanı YOK** (`User` `schema.prisma:211`, `Organization` `:66`). Var olanlar başka amaçlı:
  `Lead.phone` (`:53`, satış adayı), `Reservation.guestPhone` (`:457`, misafirin — WhatsApp'a ASLA gitmez), `NEXT_PUBLIC_WHATSAPP`
  (`.env.example:634`, landing iletişim düğmesi), `Conversation.channel` yorumunda `whatsapp` etiketi (`:584`, misafir kanalı; kullanılmıyor).
- Şifreleme hazır: `src/lib/crypto-core.ts:49` `encryptSecretBound` (AAD'li). HMAC arama emsali: `ErasureTombstone` + `ERASURE_HMAC_SECRET`.
- Doğrulama emsali: `src/lib/alert-email-verify.ts` (imzalı, süreli, kuşak sayaçlı; migration'sız).

### 1.8 Bilgi tabanı
- `src/lib/kb-review.ts:23-28`: kaynak `legacy | host_manual | extracted_draft | suggestion_accepted`, durum `legacy | approved | draft`
  (uygulama düzeyinde kapalı küme → yeni değer migration istemez). Talimat-ele-geçirme süzgeci `detectKbInstructionHijack`, sır kategorisi kapısı.

### 1.9 Bayrak kuralları
- Her `*_ENABLED` `docs/RAILWAY-ACILIS-2026-10-15.md`'de adıyla geçer (pin `tests/unit/railway-doc-flags.test.ts`); yalnız "1" açar
  (`scripts/env-check.mjs:628` `STRICT_ONE_FLAGS`); işletme listesi emsali `DURABLE_OUTBOX_ORG_IDS` (`src/lib/outbox/flag.ts:13-20`).
- Karar motoru + kalıcı kuyruk çakışma uyarısı RAILWAY belgesi §3 madde 8 (`:83`) — WhatsApp karar şeridi aynı uyarıyı devralır.

### 1.10 Hukuk metni
- `src/app/(legal)/gizlilik/content.ts:84-92` alt işleyen listesinde **Meta / WhatsApp YOK** → eklenmeli (yurt dışı aktarım, §9 madde 11).

### 1.11 Önceki kararlar (bu tasarım bunlara uyar)
- HOST-COPILOT §6: bilinen yapılandırılmış seçim → tek dokunuş; yeni serbest talimat → "Anladığım: …" önizleme + onay. §11: WhatsApp bir
  **arayüz**, karar kaydı arka uçta. §12: ev sahibinin sözü misafire DOĞRUDAN gitmez; makbuzsuz iddia yok; bekleme sözü yok.
- Faz 0 §5: numara ↔ kullanıcı eşlemesi doğrulanır; para ve iptal kararları web onayıyla; pencere dışında yalnız onaylı şablon.

### 1.12 Özet: ne var, ne eksik

| Parça | Durum |
|---|---|
| "Ne zaman ev sahibine sorulmalı" kararı | **VAR** (K10 / öğe kipi / karar kartı / açık ihtiyaç noktaları) |
| Mesaj başına tek bildirim kilidi | **VAR** (`reply-waiting-mail:` vb.) |
| Ev sahibi adına misafire gönderim | **VAR** (`sendHostMessage`) |
| Karar kartı + yeniden doğrulama | **VAR** (rota içinde; kütüphaneye çıkarılmalı) |
| Kod denetimli yapay zekâ yazıcı deseni | **VAR** (`decisions/ai-text.ts` + `text-check.ts`) |
| Çıktı kapıları (devir, "bilgim yok", ödeme, iletişim, dil, yönlendirme yasağı) | **VAR** (ayrı modüller; yeni yolda yeniden çağrılır) |
| Ev sahibi telefonu + doğrulama + rıza | **YOK** |
| Ev sahibi kanalı sağlayıcı sınırı (port) + WhatsApp adaptörü | **YOK** |
| Gelen kanca ucu (imza, ayrıştırma, tekrar önleme) | **YOK** (Paddle deseni var) |
| Soru ↔ cevap eşleme kaydı (durum makinesi) | **YOK** |
| "Ev sahibi cevabından misafir cevabı kur" yazıcısı | **YOK** (karar yazıcısı emsal) |
| Meta alt işleyen + rıza metni | **YOK** |

---

## 2. Dış gerçekler — WhatsApp Business Platform (Cloud API)

> Hepsi arama özetinden; resmi sayfa adresleri verildi. ⚠️ = ikincil kaynaklar çelişiyor ya da resmi sayfada rakam görülemedi.

1. **Kurulum parçaları:** Meta Business portföyü (business.facebook.com) → geliştirici uygulaması (Business tipi) + WhatsApp ürünü → WhatsApp
   Business Hesabı (WABA) → telefon numarası (SMS / sesli kodla doğrulanır) → görünen ad onayı → **sistem kullanıcısı + kalıcı belirteç**
   (geçici belirteç geliştirme için uygun değil) → uygulama gizli anahtarı (App secret; imza doğrulaması) → web kancası doğrulama belirteci +
   `messages` alanına abonelik. Belirteç izinleri: resmi "Get Started" `business_management` + `whatsapp_business_messaging` diyor, ikincil
   kaynaklar `whatsapp_business_management` + `whatsapp_business_messaging` ⚠️ → kurulumda ikisi de verilir.
   Kaynak: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
2. **24 saat penceresi:** Kullanıcı (burada: ev sahibi) bize yazdığında ya da aradığında 24 saatlik "müşteri hizmeti penceresi" açılır; her yeni
   mesajında yeniden 24 saate kurulur. Pencere açıkken serbest metin + etkileşimli düğmeler gönderilebilir; **kapalıyken yalnız ONAYLI ŞABLON**.
   Kaynak: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
   → Sonuç: Bir sorunun **ilk** mesajı (ev sahibi son 24 saatte bize yazmadıysa) şablondur; ev sahibi cevap verince açılan pencerede önizleme,
   "Gönderildi", ikinci soru, kaydetme sorusu **serbest metin + düğme** olur.
3. **Fiyat:** 1 Temmuz 2025'ten beri **mesaj başına** ücret (konuşma başına değil). Kategoriler: marketing, utility, authentication, service.
   Pencere içindeki serbest metinler ve **pencere içindeki utility şablonları ücretsiz**; pencere dışındaki utility şablonu utility ücretiyle;
   marketing her zaman ücretli. Meta fiyatları çeyrek başlarında değiştirebilir. Türkiye: 2026 güncellemelerinde Türkiye'de utility /
   authentication ücretinin düşürüldüğü resmi sayfada ve ikincil kaynaklarda geçiyor; **güncel USD rakamı bu oturumda doğrulanamadı** ⚠️.
   Kaba bütçe: kurucu org için ayda ~100 soru şablonu (gerisi pencere içi, ücretsiz) → aylık birkaç doları geçmesi beklenmez; kesin rakam
   WhatsApp Manager fiyat tablosundan. Durum kancasındaki `pricing.type` (`regular` = ücretli, `free_customer_service` = ücretsiz) ile ölçülür.
   Kaynak: https://developers.facebook.com/docs/whatsapp/pricing · https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
4. **Şablon kategorisi:** Bizim sorularımız müşterinin (ev sahibinin) kendi hesabındaki bir olaydan tetiklenen işlem bildirimi → **utility**.
   Nisan 2025'ten beri utility diye gönderilen şablon Meta tarafından marketing'e çevrilerek onaylanabiliyor (reddedilmek yerine); 60 gün içinde
   itiraz. Tanıtım dili ("fırsat", "hemen deneyin") kullanılmaz; metin olayı ve yapılacak işi söyler.
   Kaynak: https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/integrity-and-content-guidelines/
5. **Düğmeler:**
   - Pencere içi **etkileşimli yanıt düğmeleri**: en çok 3, başlık en çok 20 karakter, benzersiz; düğme kimliği en çok 256 karakter; gövde 1024,
     altbilgi 60 karakter. Dokunuş kancası `type: "interactive"` + `interactive.button_reply.{id,title}`.
     Kaynak: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages
   - **Şablondaki hızlı yanıt düğmeleri**: düğme yazısı şablonda sabit, `payload` gönderimde bizim verdiğimiz değer. Dokunuş kancası
     `type: "button"` + `button.{payload,text}` ve düğmeyi taşıyan mesajın kimliği (`context.id`). (İki biçim farklı — ayrıştırıcı ikisini de okur.)
     Kaynak: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button
6. **Cevabı soruya bağlama:** Kullanıcı bir mesaja "yanıtla" ile cevap verirse gelen mesajda `context.id` = cevaplanan mesajın kimliği (`wamid…`),
   `context.from` = o mesajı gönderen numara. Bizim gönderdiğimiz şablonun kimliği gönderim yanıtında döner → saklanır → eşlenir. ⚠️ Alan adları
   resmi "messages" kanca referansından kurulumda teyit edilir.
7. **Kanca güvenliği:** Her POST gövdesi App secret ile HMAC-SHA256 imzalı, başlık `X-Hub-Signature-256: sha256=<onaltılık>`; doğrulama HAM gövde
   üzerinde, sabit zamanlı karşılaştırma. GET el sıkışması `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge` (belirteç eşleşirse challenge
   aynen döner). Teslim **en az bir kez**, sıra garantisi yok, 200 dışı cevapta Meta azalan sıklıkla **7 güne kadar** yeniden dener ⚠️ → mesaj
   kimliğiyle tekrar önleme ŞART, cevap hızlı (iş arka planda).
   Kaynaklar: https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices ·
   https://webhookrelay.com/blog/whatsapp-cloud-api-webhooks/
8. **Durum kancaları:** `sent → delivered → read`, ya da `failed` (teslimden sonra bile gelebilir; okundu gelirse "teslim" atlanabilir).
   `pricing` nesnesi `sent` ve teslim / okundu durumlarında. Kaynak:
   https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
9. **Sınırlar:** İşletme başlatmalı mesaj kademesi (24 saatte farklı alıcı): yeni portföyde 250 → 2.000 → 10.000 → 100.000 → sınırsız; Ekim 2025'ten
   beri portföy düzeyinde ⚠️ (yükselme kuralları kaynaklar arasında çelişiyor). Bizim ölçeğimizde (ev sahibi sayısı) 250 bile yeter.
   Hız: numara başına varsayılan ~80 mesaj/sn (aşımı `130429`); **aynı alıcıya çok sık** mesaj `131056` "pair rate limit" (eşik yayımlanmamış) →
   aynı ev sahibine mesajlar sıraya alınır, birkaç saniye arayla.
   Kaynak: https://docs.ycloud.com/en/documentation/whatsapp-business-platform/pricing-limits-and-quality/messaging-limits-and-throughput.md
10. **Rıza (opt-in):** Yalnız numarasını veren ve mesaj almaya izin veren kişiye yazılır; yöntem serbest (web sitesi formu uygun); kişi istediği
    an çıkabilmeli; rızasız mesaj engellenme ve hesap askısı getirir. KVKK ayrıca geçerli (Meta politikası KVKK'yı karşılamaz).
    Kaynak: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
11. **2026 yapay zekâ politikası:** 15 Ocak 2026'dan beri WhatsApp Business'ta **genel amaçlı** sohbet botları (ChatGPT benzeri, birincil işlevi
    yapay zekâ asistanı olan) yasak; **işletmeye özgü** iş akışları (bildirim, destek, rezervasyon) serbest. Bizim kullanımımız — kendi
    müşterimize (ev sahibine) iş bildirimi ve onun cevabını işlemek — işletmeye özgüdür. Ev sahibine WhatsApp'ta "her şeyi sor" sohbeti
    açılmaz (Faz 3 sorguları bile yalnız kendi verisi). Kaynak: https://respond.io/blog/whatsapp-chatbot-policy-2026 (ikincil; resmi metin:
    WhatsApp Business Solution Terms).
12. **Alternatifler (aracı / BSP):**
    - **Twilio:** platform ücreti yok, Meta ücretine ek ~0,005 $/mesaj ⚠️ (rakip blog). Kolay SDK, ama ek katman + ek alt işleyen.
    - **360dialog:** numara başına aylık lisans (~25–49 €), Meta ücretine kâr eklemiyor (kendi belgesi). Kaynak:
      https://docs.360dialog.com/docs/get-started/pricing
    - **Öneri: Meta Cloud API DOĞRUDAN.** Gerekçe: (a) en az alt işleyen (yalnız Meta; KVKK metni sade), (b) ek ücret yok, (c) hacmimiz küçük,
      BSP'nin toplu gönderim / panel avantajı gereksiz, (d) adaptör sınırı (§4) sayesinde ileride BSP'ye geçiş = yeni adaptör dosyası,
      çekirdek değişmez. Tek dezavantaj: Meta kurulumunu kurucu kendisi yapar (§9 listesi).

---

## 3. Akış tasarımı (uçtan uca)

```
Misafir mesajı ─► oto-yanıt turu (bugünkü kapılar; DEĞİŞMEZ)
                     │
                     ├─ cevap gitti, hiçbir soru açık değil ─► bitti (bildirim yok)
                     │
                     └─ tutuldu / soru açık kaldı / karar kartı açıldı
                              │
                              ▼
                 BİLDİRİM YÖNLENDİRİCİSİ (yeni, kanaldan bağımsız)
                 mesaj başına TEK talep (reply-waiting-mail:<son mesaj>)
                              │
             ┌── ev sahibi WhatsApp'ı bağlı + bayrak açık? ──┐
             │ hayır                                        │ evet
             ▼                                              ▼
        bugünkü e-posta                         HostQuestion (queued) ─► port.send(şablon)
                                                       │                  │
                                                       │       kesin hata ─► e-posta (aynı talep) 
                                                       │       10 dk teslim yok ─► e-posta (bir kez)
                                                       ▼
                            ev sahibi WhatsApp'ta cevap / düğme ─► kanca ucu (imza, tekrar önleme)
                                                       │
                                     eşle (context.id → soru; yoksa tek bekleyen + teyit)
                                                       │
                     ┌─────────── cevap türü ─────────┼────────────────────┐
                     ▼                                ▼                    ▼
           "ben yazarım / bilmiyorum"         bilgi cevabı           karar düğmesi
           → misafire bir şey gitmez,         → CEVAP KURUCU         → karar çekirdeği
             soru panelde açık                  (yalnız ev sahibi       (rotadan çıkarılan
                                                 cevabı + KB, kod        decide.ts; kod metni)
                                                 denetimi + kapılar)          │
                                                       │                      │
                                                       ▼                      ▼
                                       önizleme → [Gönder] (ilk dilim; S1) ─► YENİDEN DOĞRULA
                                                                              │
                                                                   sendHostMessage (bugünkü yol)
                                                                              │
                                                         "Gönderildi ✓" + (isteğe bağlı) KB kaydı sorusu
```

### 3.1 Tetik — hangi durum soru üretir

Yeni bir karar mantığı YAZILMAZ: bugün e-posta gönderen noktalar aynı kalır, yalnız "hangi kanaldan" sorusu yönlendiriciye devredilir.

| Bugünkü durum (kod) | Bugün | Öneri (anahtar açık + WhatsApp bağlı) | Tür |
|---|---|---|---|
| Öğe kipinde tur tutuldu, güvenli öğe açık kaldı (`handoffHeld`, `partsUnanswered`, `hostContactNotify`; `automation.ts:3474-3484`) | "Misafir cevabınızı bekliyor" e-postası | WhatsApp **bilgi sorusu** | A |
| Önceki okumadan kalan açık ihtiyaç (`staleOpen`, `:3491`) | tek e-posta | WhatsApp bilgi sorusu (aynı `open-need-mail:` kaydı) | A |
| Öğesiz K10 tutuşu (`:3835`) | e-posta | WhatsApp bilgi sorusu | A |
| Karar kartı açıldı (`turnDecisions`, `:3131`) | "Karar bekliyor" e-postası | WhatsApp **karar sorusu** (düğmeli) | B |
| Hassas / acil öğe tutuldu (`notifyHeldItems`, `flow.ts:283`) — ödeme, iade, şikâyet, kayıp anahtar, kilitli kalma | "Acil" e-posta | **Dilim 4:** WhatsApp **acil bildirim** (cevap kurulmaz; "Konuşmayı açın" + isteğe bağlı "Ben ilgileniyorum") | C |
| Sessiz tür (`NO_NOTIFY_KINDS`, "bunu nereden biliyorsun") | e-posta yok | WhatsApp da yok | — |
| Tehlike + anlama yok (`escalateHazard`, saatte 3) | Acil e-posta | Dilim 4: C (aynı saatlik tavan) | C |

Tür A'da **konaklama değişikliği** öğeleri (`STAY_CHANGE_ITEM_KINDS`: erken giriş, geç çıkış, uzatma, tarih değişikliği) bilgi sorusu OLMAZ — karar
şeridine (B) gider ya da kart yoksa "panelde yanıtlayın" der. Para / iade / iptal / ödeme yöntemi türleri de A olmaz (C + panel).

### 3.2 Toplama, tekrar önleme, sessiz saat

- **Tur başına TEK WhatsApp mesajı.** Aynı turda 2–3 açık soru varsa tek mesajda numaralı liste ("1) bebek yatağı 2) otopark"). Ev sahibi tek
  cevapta ikisini yazabilir; kurucu her soruya ayrı bakar (§3.6).
- **Talep ortak:** yönlendirici bugünkü `reply-waiting-mail:<turun son mesajı>` talebini BİR KEZ alır, sonra kanal seçer. WhatsApp ile e-posta
  aynı talebi paylaşır → aynı tura ikisi birden gitmez (yedek e-posta yalnız §3.11 kurallarıyla, aynı talebin "yedek" damgasıyla, bir kez).
- **Aynı soru ikinci kez sorulmaz:** öğe başına `open-need-mail:<öğe>` kaydı (bugünkü, 1 yıl) WhatsApp'ta da geçerli. Misafir aynı şeyi
  yeniden yazarsa ("?") yeni mesaj gitmez; bekleyen soru zaten açık.
- **Konuşma başına tek bekleyen soru:** ev sahibi henüz cevaplamadıysa ve misafir YENİ bir şey sorarsa → kısa ek ("Lale · misafir bir şey daha
  sordu: …"), konuşma başına saatte en çok 3; aynı öğe asla.
- **İşletme tavanı:** saatte 30 soru (aşılırsa e-postaya düşer + tek alarm). Ev sahibi başına gelen mesaj işleme tavanı saatte 60.
- **Sessiz saat:** ilk dilimde YOK (misafir bekliyor; telefonun kendi sessiz ayarı var). Sonraki dilimde Ayarlar'da "23:00–08:00 arası yalnız
  acil" seçeneği; o saatlerde soru sabah 08:00'de tek toplu mesaj olur.

### 3.3 Giden WhatsApp metinleri (Türkçe, kısa, en az kişisel veri)

**Kural:** misafirin adı, telefonu, e-postası, rezervasyon kodu ASLA gitmez. Daire adı (ev sahibinin kendi verisi) + tarih aralığı (hangi
konaklama olduğunu ayırt etmek için) + soru. Misafirin sözü yalnız **kısa, maskeli alıntı** (S2): en çok 160 karakter, `redactContactsFromText`
(`src/lib/contact-redact.ts:57`) + `redactSensitive` (`src/lib/redact.ts:293`) + görünmez karakter temizliği; şablon değişkeni kuralları
(satır sonu / sekme yok, ardışık boşluk teke) ⚠️ kurulumda teyit.

Şablonlar (utility, dil `tr`, Meta onayına gönderilecek metin):

| Ad | Gövde | Düğmeler |
|---|---|---|
| `lixus_misafir_sorusu` | "{{1}} ({{2}}) · Misafiriniz soruyor: “{{3}}” Cevabınızı bu mesaja yanıt olarak yazın; misafire sizin adınıza iletmeden önce size gösteririz." | Hızlı yanıt: **[Ben yazacağım]** · URL: **[Panelde aç]** `https://www.lixusai.com/inbox/{{1}}` |
| `lixus_karar_bekliyor` | "{{1}} ({{2}}) · {{3}} isteği. Kontrol: {{4}}." | Hızlı yanıt: **[Onayla] [Reddet]** · URL: **[Panelde aç]** |
| `lixus_acil_bildirim` (dilim 4) | "ACİL · {{1}} ({{2}}) · Misafiriniz {{3}} bildiriyor. Konuşmayı hemen açın." | URL: **[Konuşmayı aç]** · Hızlı yanıt: **[İlgileniyorum]** |

Örnek değerler: `{{1}}`=Lale · `{{2}}`=12–15 Kas · `{{3}}`="Is there a baby cot in the apartment?" · karar `{{3}}`="14 Kas 13:00 erken giriş",
`{{4}}`="temizlik 12:30'da bitiyor, önceki misafir 11:00'de çıkıyor" (kartın uyarı satırlarından, en çok 2).

Pencere içi (ücretsiz) serbest mesajlar: önizleme, "Gönderildi ✓", "Hangi soru?", "Cevabınız 2 sorudan 1'ini karşılıyor…", "Bu soruyu panelden
cevapladınız…", "Sesli mesajları henüz okuyamıyorum, lütfen yazın". Hepsi kodda sabit Türkçe metin (model üretmez); düğme başlıkları ≤20 karakter
("Gönder", "Gönderme", "Panelde düzenle", "Kaydet", "Hayır").

Düğme kimliği (payload / button_reply.id) içeriği: `hq.<soru kimliği>.<sürüm>.<eylem>` — sır değildir; yetki her zaman gönderen numaranın
bağlantısından ve sorunun kiracısından kontrol edilir (§5). Sürüm eski bir düğmenin yeni bir taslağı onaylamasını engeller.

### 3.4 Ev sahibinin cevabını soruya bağlama

1. **`context.id` var** (mesaja "yanıtla" ile ya da düğmeyle cevap): sağlayıcı kimliği → `HostQuestion.providerMessageId` /
   `previewMessageId` eşleşmesi → soru. Bulunan sorunun kiracısı ≠ gönderen numaranın bağlantısının kiracısı → REDDET (sessizce yok say + olay
   günlüğü), asla başka kiracının sorusuna işlem yok.
2. **`context.id` yok** (ev sahibi düz yazdı):
   - Bu ev sahibinin son 24 saatte bekleyen **tek** sorusu varsa → ona bağlanır; önizleme başlığı ("Lale · bebek yatağı") zaten hangi soru
     olduğunu gösterir → ek teyit gerekmez (Gönder'e basmak teyittir).
   - **Birden çok** bekleyen soru varsa → "Bu cevap hangi soru için? **[1 · Lale] [2 · Gül] [Panelde aç]**" (en çok 3 düğme; fazlası → panel).
     Cevap metni bu arada şifreli bekletilir (aynı kayıt).
   - Hiç bekleyen soru yoksa → "Şu an bekleyen bir misafir sorusu yok." (günde bir kez; sohbet botu olmaz).
3. **Geç cevap:** soru `answered_elsewhere` (ev sahibi panelden yazdı), `expired` ya da `superseded` ise → "Bu soruyu panelden cevapladınız;
   misafire yeni bir şey gönderilmedi." / "Bu sorunun süresi geçti." — misafire hiçbir şey gitmez.

### 3.5 Ev sahibinin cevabının türü

Yazıcı modeli (§3.6) cevabı yazmadan önce türü de döndürür; kod bazı kesin durumları önce yakalar:

| Tür | Örnek | Ne olur |
|---|---|---|
| Bilgi cevabı | "var, dolapta" · "otopark 50 TL günlük" | Cevap kurulur → önizleme |
| Ev sahibi devralır | düğme **[Ben yazacağım]** · "ben ararım", "ben yazarım" | Misafire bir şey gitmez; soru panelde açık (sahibi siz); "Tamam, size bıraktım." |
| Bilmiyorum / sonra | "bilmiyorum", "akşam bakarım" | Misafire bir şey gitmez ("bilgim yok" misafire ASLA); soru açık; tekrar sorulmaz |
| Yalnız üslup talimatı | "kısa yaz", "daha resmi" | Son taslak yeniden kurulur (soru başına en çok 3 kez) |
| Belirsiz | "olur" (soru "kaç kişi kalabilir?") | "Cevabınızı anlayamadım: …" + [Panelde aç]; misafire bir şey gitmez |
| Sesli / görsel | sesli not, fotoğraf | "Sesli mesajları henüz okuyamıyorum, lütfen yazın." (ses = Faz 6, alt işleyen ister) |
| Çıkış | yalnız "DUR" / "STOP" (tüm mesaj) | Bağlantı kapatılır, e-postaya dönülür, "WhatsApp bildirimleri kapatıldı." |

### 3.6 Misafir cevabını kurma (CEVAP KURUCU)

**Yer:** `src/lib/host-channel/compose.ts` (sağlayıcı bilmez). **Desen:** `decisions/ai-text.ts` — tek yapılandırılmış model çağrısı, katı JSON
şema, ardından KOD denetimi, ardından bugünkü çıktı kapıları; herhangi biri düşerse misafire gitmez, ev sahibine "panelde yazın" denir.

**Girdi (yalnız bunlar):**
- Ev sahibinin cevabı (ev sahibinin sözü — olgu kaynağı);
- Sorunun öğeleri: tür + kod etiketi (`topic`) + misafirin ilgili mesajları **veri ayraçları içinde** (K10-s "misafirden türeyen metin veri";
  bugünkü istem ayraçları ve görünmez karakter temizliği aynen);
- Bilgi tabanından o soruya getirilen kalemler (`selectKbForPrompt` — tek boğaz, aynı onay kapısı `GUEST_DELIVERABLE_KB_WHERE`);
- Misafirin dili (bugünkü dil sinyali), ev sahibinin üslup profili, mülk standart saatleri.

**Yazıcı kuralları (istem özeti):** misafirin dilinde, ev sahibinin ağzından ("biz / ben"), "siz" hitabı, 1–3 cümle; **YALNIZ** ev sahibinin cevabı
+ verilen bilgi tabanı olguları; yeni sayı / saat / tutar / koşul YOK; "ev sahibiniz diyor ki", "ev sahibinize sordum", "WhatsApp", "ilettim",
"döneceğim" YOK; "ev sahibinize yazın" YOK (K-1029-A); özür / kusur kabulü / "haklısınız" YOK (kurucu 10-21); ev sahibinin cevabı bir soruyu
karşılamıyorsa o soruyu ANMAZ ve `uncovered` listesine koyar.

**Çıktı şeması:** `{ kind: "answer"|"host_takes_over"|"host_unknown"|"style_only"|"unclear", reply: string, replyTr: string, covered: string[],
uncovered: string[] }` (`replyTr` = ev sahibine gösterilen Türkçesi).

**KOD denetimi (`text-check.ts` benzeri, saf):**
1. Cevaptaki her rakam dizisi / saat / tutar ev sahibinin cevabında ya da verilen bilgi tabanı metninde harfiyen geçer (20 ≠ 200).
2. `vetoOutgoingReply` (`src/lib/ai/output-veto.ts:599`) boş; `carriesHandoffNotice` (`:640`) yanlış.
3. `stripHostContactFiller` (`host-contact-filler.ts:680`) hiçbir şey SİLMEMELİ (silerse cevap gitmez — ev sahibinin ağzından "ev sahibinize yazın"
   anlamsız).
4. `admitsMissingKnowledge` / `namesInternalSource` (`absence.ts:1380`, `:1463`) yanlış.
5. Ödeme yöntemi: `namesPaymentMethod` (`src/lib/payment-method-guard.ts:86`) — ev sahibinin cevabında da, çıktıda da; şüphede REDDET
   (platform dışı ödeme talimatı gitmez, CLAUDE.md "ödeme yöntemi TEK KAYNAK").
6. İletişim bilgisi: `containsContactValue` (`contact-redact.ts:49`) + `offPlatformContactHoldsFor` (`channels/airbnb-message-policy.ts:28`) —
   Airbnb kuralı gereği telefon / e-posta / WhatsApp numarası misafire gitmez (ev sahibi yazsa bile; ev sahibine "telefon numarası Airbnb
   kuralları gereği gönderilemez" denir).
7. Dil: `replyLanguageMismatch` (`ai/language-signal.ts:385`).
8. Sır: kapı kodu / Wi-Fi şifresi bugünkü kanal cevabının sır kurallarına tabidir (aynı kapı; QR konuşmasında bugünkü QR sır kuralları aynen).
9. Eylem beyanı: "temizlikçiye haber verdim" gibi makbuzsuz iddia yok (`claimedActions` kuralı).
10. Konaklama değişikliği izni (geç çıkış verildi vb.) bu yoldan GİTMEZ — karar şeridi.
11. Uzunluk + görünmez karakter + yer tutucu (bugünkü kurallar).

**Kapsama kuralı (K-1029-A ile aynı ruh):** `uncovered` boş değilse misafire HENÜZ gönderilmez; ev sahibine (pencere içi, ücretsiz): "Cevabınız
otopark sorusunu karşılamıyor. Ne yazayım? **[Bunu atla] [Panelde aç]**". "Bunu atla" → kalan kısım gider ve atlanan öğe ev sahibinin bilinçli
seçimiyle kapanır (ev sahibi mesajı türetmesi). Böylece "cevapsız soru asla cevaplandı görünmez" kuralı korunur.

**Bütçe:** her kurma `consumeDailyAiBudget` ile sayılır; soru başına en çok 3 kurma; model / çaba katman değişkeni
`AI_HOST_ANSWER_MODEL` / `AI_HOST_ANSWER_REASONING_EFFORT` (boşken cevap modelinin ayarı — `decisionWriterCallParams` deseni).

### 3.7 Otomatik mi, tek dokunuş onay mı (kurucu sorusu S1)

- **Öneri — ilk dilim: önizleme + [Gönder].** Gerekçe: (a) ses tanıma / yazım hatası / yanlış eşleme gerçek bir misafir mesajına dönüşmez,
  (b) numara ele geçirilirse saldırgan misafire serbest metin yazdıramaz (önizleme yine onay ister ama yine de çıktı kapıları), (c) ev sahibinin
  ağzından giden metnin sorumlusu ev sahibi. Maliyeti: bir dokunuş (cevaptan ~5–10 sn sonra önizleme gelir).
- **Sonraki dilim (kurucu seçerse): düşük riskli bilgi sorularında otomatik.** Koşullar: tür A, öğe hassas değil, kod denetimi + kapılar temiz,
  kapsama tam, sayı yok ya da sayı ev sahibinin cevabında harfiyen, misafir arada yazmadı. Ev sahibine "Gönderildi: …" bilgisi gider.
- Karar düğmeleri (B): HOST-COPILOT §6 "bilinen yapılandırılmış seçim → tek dokunuş" — ama metin önizlemesi ilk dilimde yine gösterilir
  (karar metni kodla kurulur; S1 cevabı B için de geçerli).

### 3.8 Gönderimden hemen önce yeniden doğrulama (TOCTOU)

Aynı işlemde, sırayla:
1. Bağlantı hâlâ `active` ve kullanıcının `sessionEpoch`'u doğrulama anındakiyle aynı (şifre değişimi / sıfırlama → yeniden doğrulama; §5).
2. Soru durumu CAS: `awaiting_confirm` + düğmedeki sürüm → `sending` (çift dokunuş ikinci mesaj üretmez).
3. Önizlenen metnin özeti (`draftHash`) = gönderilecek metin (arada değişmez).
4. Önizlemeden SONRA misafir yeniden yazdıysa → gönderme; yeni mesajla yeniden kur ve yeniden önizle ("Misafir yeniden yazdı: “…” — yeni
   taslak: …").
5. Ev sahibi arada panelden yazdıysa → `answered_elsewhere`, gönderme.
6. Rezervasyon iptal / konaklama bitti + 24 sa / öğeler kapandı (misafir vazgeçti) → gönderme, ev sahibine söyle.
7. Kanal bağlı değilse (`sendHostMessage` → `not_connected`) → "Kanal bağlantısı yok, panelden deneyin."
8. Gönderim: `sendHostMessage({ authorType host, senderName: ev sahibinin adı (elle cevap kuralı; "GuestOps AI" sihirli dizesi DEĞİL),
   aiAssisted: true, idempotencyKey: "host-q:<id>:v<sürüm>", claimBody: metin })`. Sonuç eşlemesi karar rotasıyla aynı: `sent` → `done`;
   `queued` → `done` (kuyruk teslim eder; kalıcı kuyruk + karar uyarısı RAILWAY §3 madde 8 burada da geçerli); belirsiz / `duplicate` →
   `send_unverified` ("Gönderim doğrulanamadı, konuşmayı kontrol edin" — kör tekrar YOK); kesin hata → `awaiting_confirm`'a geri, yeni sürüm.

### 3.9 Bilgi tabanına kaydetme (isteğe bağlı, dilim 4)

- Gönderimden sonra yalnız şu koşulda sorulur: bilgi cevabı, sır kategorisi değil (Wi-Fi şifresi / kapı kodu → yalnız panel), talimat-ele-geçirme
  süzgecinden temiz, konaklamaya özgü değil ("bu hafta havuz kapalı" gibi geçici bilgi → sorulmaz; model `durable: boolean` işareti + kod
  "bugün / yarın / bu hafta" süzgeci).
- **[Kaydet]** → `KnowledgeBaseItem` (mülk = sorunun mülkü, içerik = **ev sahibinin kendi sözü**, yapay zekâ cümlesi DEĞİL — değişmez 13;
  başlık = öğe etiketi; `source` yeni değer `host_answer`; `reviewState: "draft"` → panelde tek tıkla onay). Neden taslak: WhatsApp'taki
  kısa söz ("var dolapta") kalıcı bilgi için eksik olabilir; onay ekranı bağlamı gösterir. (Kurucu isterse "approved" — sorulmadı, varsayılan
  güvenli yön.)
- O cevabı bekleyen benzer sorular yeniden aday olur (Faz 4 deseni).

### 3.10 Karar kartları WhatsApp'ta (Tür B, dilim 3)

- Kart açılınca (bugünkü `openTurnDecisions`) yönlendirici "Karar bekliyor" e-postası yerine `lixus_karar_bekliyor` şablonunu gönderir.
- **[Onayla]** → istenen saatle onay; **[Reddet]** → ret. İkisi de rotadan çıkarılan karar çekirdeğine (`decisions/decide.ts`) gider: aynı sürüm
  CAS, `guest_wrote_again`, `factsHash` (kart sayfasıyla AYNI kurucudan), aynı metin (`draftDecisionMessage` / onaylı şablon), aynı
  `sendHostMessage`, aynı denetim kaydı (`decision.approved` …). Fark: `actorUserId` = bağlantının kullanıcısı; kaynak `host_channel`.
- Ücretli onay (kayıtlı kuraldan ücret), saati değiştirme (karşı teklif), uzatma / tarih değişikliği → **yalnız [Panelde aç]** (Faz 0 §5).
- Ev sahibi düz yazarsa ("13:30 olabilir") → karşı teklif = yeni serbest talimat → bu dilimde "Panelde aç" (HOST-COPILOT Faz 2'de "Anladığım: …").

### 3.11 Hata yolları

| Durum | Ne olur | E-posta |
|---|---|---|
| Anahtar kapalı / ev sahibi bağlı değil / işletme listede değil | Bugünkü davranış BİREBİR | bugünkü gibi |
| Şablon gönderimi kesin hata (numara WhatsApp'ta yok, şablon duraklatıldı / reddedildi, belirteç geçersiz) | Soru `failed`; `alertOnTransition("host-channel:<sınıf>")` tek alarm | **hemen**, aynı talep satırıyla, bir kez |
| Gönderim belirsiz (zaman aşımı / 5xx) | WhatsApp'ta **yeniden deneme YOK** (çift mesaj riski) | 2 dk içinde durum kancası gelmezse bir kez |
| `sent` ama 10 dk içinde `delivered` / `read` yok (telefon kapalı, Meta kesintisi) | Soru açık kalır (ev sahibi sonra cevap verebilir) | bir kez ("WhatsApp'a ulaşamadık") |
| Teslim / okundu ama cevap yok | Panelde açık kalır; WhatsApp'ta hatırlatma YOK | **yok** (öneri; S3) |
| Cevap var ama kurucu kod denetiminden / kapıdan geçmedi | Misafire bir şey gitmez; "Cevabınızdan güvenli bir mesaj kuramadım (neden: telefon numarası içeriyor / ödeme yöntemi / …). Panelden yazın: [Panelde aç]"; taslak panele hazır taslak olarak yazılmaz | yok |
| Model arızası / bütçe bitti | "Şu an cevap kuramıyorum, panelden yazın" | yok |
| Meta kancası gelmiyor (kesinti) | Soru `sent`'te kalır → 10 dk kuralı | bir kez |
| Kanca imzası bozuk | 401, saklanmaz; kötü imza alarmı kısıtlı (Paddle deseni) | operatöre alarm |
| Ev sahibi "DUR" yazdı / bağlantıyı kapattı / Meta "kullanıcı engelledi" hatası | Bağlantı `revoked`; bekleyen sorular e-postaya | bekleyenler için bir kez |
| Soru 24 sa cevapsız ya da misafirin ihtiyacı bitti (öğeler kapandı, konaklama bitti) | `expired`; geç cevap → "süresi geçti" | yok |

### 3.12 Panelle birlikte yaşam

- Konuşma sayfasında öğe satırında küçük rozet: "WhatsApp'tan soruldu · 14:02" / "WhatsApp cevabı bekliyor onayınızı" / "Gönderim doğrulanamadı".
- Ev sahibi panelden yazarsa soru kendiliğinden `answered_elsewhere` (türetilir: sorudan sonra ev sahibi mesajı). Panelden "Kartı kapat" →
  WhatsApp sorusu da kapanır (ev sahibine ayrıca mesaj gitmez).
- "Panelde düzenle": son taslak son misafir mesajının `aiSuggestedReply` alanına yazılır (bugünkü hazır taslak yolu) → panel öneri kutusu dolu açılır.

---

## 4. Mimari — çekirdek sağlayıcıya bağlanmaz (V0 kuralı)

**İlke (HOST-COPILOT §11):** WhatsApp yalnız ev sahibinin kapısıdır. Soru, cevap, taslak, onay, gönderim kayıtları sağlayıcıdan bağımsız
tablolarda; WhatsApp'a özgü her şey (Graph API adresi, şablon adları, `X-Hub-Signature-256`, `wamid`, kanca JSON şekli, 24 saat kuralı) TEK
adaptör dosyasında.

```
src/lib/host-channel/                 (ÇEKİRDEK — sağlayıcı import ETMEZ)
  transport.ts      port arayüzü + kayıt defteri + __setHostTransportForTest
  flag.ts           anahtarlar (yaprak)
  binding.ts        bağlantı: doğrulama kodu, rıza, epoch kontrolü, çıkış
  router.ts         bildirim yönlendiricisi: talep → WhatsApp mı e-posta mı (tek giriş noktası; automation.ts buradan çağırır)
  question.ts       soru kaydı: aç / topla / tekrar önle / süre / durum geçişleri (CAS)
  text.ts           ev sahibine giden SABİT Türkçe metinler + şablon değişken kurucu (saf; maskeli alıntı)
  inbound.ts        normalleştirilmiş olaylar → eşleme → durum makinesi (saf karar + ince DB katmanı)
  compose.ts        CEVAP KURUCU (model) + compose-check.ts (saf kod denetimi)
  deliver.ts        yeniden doğrulama + sendHostMessage
  kb-save.ts        isteğe bağlı bilgi tabanı taslağı
src/lib/host-channel/adapters/
  whatsapp-cloud.ts TEK Meta dosyası (gönderim, imza, el sıkışma, ayrıştırma, hata kodu → kind eşlemesi)
  fake.ts           sahte aktarım (testler + yerel geliştirme; üretimde açılamaz)
src/app/api/webhooks/host-channel/[provider]/route.ts   GET el sıkışma, POST imza → ayrıştır → inbound.ts
```

**Port (taslak):**

```ts
export type HostChannelProviderId = "whatsapp_cloud" | "fake";            // kapalı küme
export interface HostButton { id: string; title: string }                  // title ≤ capabilities.buttonTitleMax
export type HostOutbound =
  | { kind: "template"; template: "info_question" | "decision" | "alert"; params: string[]; quickReplies?: HostButton[]; urlSuffix?: string }
  | { kind: "text"; text: string; buttons?: HostButton[] };               // yalnız pencere içinde
export interface HostSendResult {                                          // outbox/state.ts SendResultKind ile aynı sözlük
  ok: boolean; kind: "definitive_success" | "definitive_failure" | "ambiguous";
  providerMessageId?: string | null; errorClass?: string | null;          // errorClass kapalı küme, ham gövde değil
}
export type HostInbound =
  | { type: "text"; id: string; from: string; replyTo: string | null; text: string; at: Date }
  | { type: "button"; id: string; from: string; replyTo: string | null; buttonId: string; at: Date }
  | { type: "unsupported"; id: string; from: string; replyTo: string | null; media: "audio" | "image" | "other"; at: Date }
  | { type: "status"; id: string; status: "sent" | "delivered" | "read" | "failed"; errorClass: string | null; at: Date };
export interface HostChannelTransport {
  readonly provider: HostChannelProviderId;
  readonly capabilities: { freeformWindowMs: number | null; maxButtons: number; buttonTitleMax: number };
  send(toE164: string, msg: HostOutbound): Promise<HostSendResult>;        // TEK atış, asla fırlatmaz
  verifyRequest(rawBody: string, headers: Headers): boolean;               // imza (sabit zamanlı)
  handshake?(url: URL): { status: number; body: string };                  // GET doğrulama
  parse(rawBody: string): HostInbound[];                                   // bilinmeyen tür → atlanır, asla fırlatmaz
}
```

- Çekirdek "pencere açık mı"yı `binding.lastInboundAt` + `capabilities.freeformWindowMs` ile hesaplar (sağlayıcı kelimesi yok); pencere kapalıysa
  serbest metin YERİNE şablon seçer.
- Bu sınır misafir kanalının (`channels/`) AYNISI değildir: misafir sağlayıcısı kiracı başına bağlanır (`ChannelConnection`), ev sahibi kanalı
  Lixus'un TEK WhatsApp numarasıdır (platform yapılandırması); kiracı ayrımı bağlantı tablosundadır.
- **Mimari pinler (yeni test):** `host-channel/*.ts` (adapters hariç) `adapters/` import etmez; `graph.facebook.com` ve `X-Hub-Signature-256`
  dizeleri yalnız `adapters/whatsapp-cloud.ts`'te; `automation.ts` yalnız `host-channel/router` bilir; misafire gönderim yalnız `sendHostMessage`.

---

## 5. Güvenlik

1. **İmza:** HAM gövde üzerinde HMAC-SHA256 (App secret), sabit zamanlı karşılaştırma, imzasız / bozuk → 401 + hiçbir şey saklanmaz; gövde tavanı
   `MAX_WEBHOOK_BODY_BYTES`; `Content-Type` kontrolü; anahtar kapalıyken uç uyur (200 `{disabled:true}`). GET el sıkışma belirteci
   `timingSafeEqual`.
2. **Kiracı:** gelen numara → `HMAC(numara)` → tek `active` bağlantı → kullanıcı + işletme. Soru kimliği / düğme kimliği / `context.id` HİÇBİR
   ZAMAN kiracıyı belirlemez; yalnız bulunan sorunun `organizationId`'si bağlantınınkiyle eşitse işlem yapılır (davranışsal çapraz-kiracı testi,
   reddin SEBEBİ sınanır — CLAUDE.md #211).
3. **Rol:** yalnız sahip / yönetici bağlantı kurabilir ve soru alır (`withManage` eşdeğeri, gelen yolda da her işlemde rol yeniden okunur);
   personel asla (K10). Bürünme oturumunda bağlantı kurulamaz / kaldırılamaz (K8 salt-okuma).
4. **Numara doğrulama = sahiplik + rıza (tek adım, ücretsiz):** Ayarlar → "WhatsApp'ı bağla" → rıza kutusu (metin sürümü kaydedilir) → ekranda
   tek kullanımlık kod `LIXUS-7F3K2Q` + `wa.me/<numaramız>?text=LIXUS-7F3K2Q` bağlantısı → ev sahibi kendi WhatsApp'ından gönderir → kanca kodu
   (bcrypt'li, 15 dk, 5 deneme) + gönderen numarayı eşler → bağlantı `active`. Ev sahibi başlattığı için pencere açılır (ücretsiz) ve numaraya
   sahip olduğunu kanıtlar; kod numaraya değil HESABA bağlıdır (başkası kendi numarasıyla kodu gönderse bile kod yalnız ekranı gören hesapta
   üretildi; yine de bağlanan numara ekranda maskeli gösterilir ve "bu siz misiniz?" onayı istenir).
5. **Oturum kuşağı:** bağlantı doğrulama anındaki `User.sessionEpoch`'u saklar; epoch'u artıran her kimlik işlemi (bugün şifre değişimi /
   sıfırlama; `schema.prisma:265-269`) bağlantıyı askıya alır, yeniden doğrulama ister (ele geçirilmiş hesap kurtarıldığında saldırganın
   WhatsApp'ı da düşer). 2FA sıfırlamasının epoch'u artırıp artırmadığı uygulamada kontrol edilir; artırmıyorsa bağlantı ayrıca askıya alınır.
6. **Tekrar önleme:** gelen her olay (mesaj + durum) `SystemLock` `host-in:<sha256(sağlayıcı+kimlik)>` (8 gün; Meta 7 güne kadar yeniden dener) —
   `create` yarışını tek kazanan; migration'sız (repo deseni). Ev sahibinin cevabının kimliği soruda ayrıca tekil.
7. **Ev sahibinin sözü = ev sahibinin sözü, ama denetlenir:** ev sahibi metni güvenilir kaynak sayılır (olgu), yine de §3.6 kapıları uygulanır
   (ödeme yöntemi, iletişim bilgisi, sır, makbuzsuz eylem, dil, uzunluk). Ele geçirilmiş numara riskine karşı: önizleme + onay (ilk dilim), para /
   iptal yalnız panel, işletme ve bağlantı tavanları, her gönderim denetim kaydında (`host_question.sent`, yalnız kimlikler).
8. **KVKK / veri azaltma:** misafir adı / telefonu / e-postası WhatsApp'a GİTMEZ; alıntı maskeli ve 160 karakter; ev sahibi numarası şifreli
   (`encryptSecretBound`, AAD = bağlantı kimliği) + aramada HMAC; ev sahibinin cevabı ve taslak şifreli, soru sonlanınca 7 gün sonra silinir;
   konuşma silinince kademeli silinir; misafir silme talebinde (erasure) taslak / cevap alanları boşaltılır (CLAUDE.md "scrub kapsamı" +
   `scripts/apply-conversation-dedupe.ts:104` `HANDLED_REFERENCES` listesine yeni `conversationId` taşıyan model eklenir — envanter fail-closed).
   Meta yeni alt işleyen (yurt dışı) → gizlilik metni + ev sahibi rıza metni (avukat).
9. **Olay günlüğü:** yeni kapalı küme olaylar `host_channel.webhook.received|duplicate|bad_signature`, `host_channel.question.sent|failed|
   fallback_email|answered|sent_to_guest|unverified`; veri anahtarı `questionId` (cuid kalıbı), `providerCode` (kapalı küme hata sınıfı);
   telefon / metin sığmaz (bugünkü biçim kuralı).
10. **Meta tarafı hatalar:** belirteç 401 → `alertOnTransition` (geçiş tabanlı, günde bir hatırlatma) + bütün işletmeler e-postaya düşer.

---

## 6. Veri modeli (migration 88 önerisi — YALNIZ yeni tablolar; dolu tabloya kolon / `@unique` YOK)

```prisma
/// EV SAHİBİ KANAL BAĞLANTISI — ev sahibinin bildirim aldığı adres (ilk sağlayıcı WhatsApp). Numara şifreli + HMAC arama anahtarı.
model HostChannelBinding {
  id               String    @id @default(cuid())
  organizationId   String
  userId           String
  provider         String                 // whatsapp_cloud | fake (uygulama kapalı küme)
  addressHash      String                 // HMAC-SHA256(HOST_CHANNEL_HMAC_SECRET, provider + E.164) — gelen mesajı bulma anahtarı
  addressEnc       String                 // encryptSecretBound(E.164, aad = id) — maskeli gösterim
  status           String    @default("pending") // pending | active | revoked
  verifyCodeHash   String?
  verifyExpiresAt  DateTime?
  verifyAttempts   Int       @default(0)
  verifiedAt       DateTime?
  optInAt          DateTime?
  optInTextVersion String?
  userSessionEpoch Int       @default(0)  // doğrulama anındaki User.sessionEpoch; farklıysa askıda
  lastInboundAt    DateTime?              // ev sahibinden son gelen mesaj (serbest metin penceresi hesabı)
  revokedAt        DateTime?
  revokedReason    String?                // user | opt_out | epoch | operator | provider_blocked
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, addressHash])       // bir numara tek bağlantı (yeniden bağlama satırı devralır)
  @@index([organizationId, status])
  @@index([userId])
}

/// EV SAHİBİNE SORU — bir misafir turu için ev sahibine giden soru ve cevabının yaşam döngüsü. Misafir metni / adı SAKLANMAZ.
model HostQuestion {
  id                String    @id @default(cuid())
  organizationId    String
  conversationId    String
  bindingId         String?               // düz kimlik (bağlantı silinse de iz kalır)
  kind              String                // info | decision | alert
  turnMessageId     String                // turun son misafir mesajı (düz kimlik — ConversationItem emsali)
  itemIdsJson       String?               // opak öğe kimlikleri (JSON string[])
  decisionId        String?               // karar sorusu için DecisionRequest kimliği
  status            String    @default("queued")
  // queued | sent | delivered | read | answered | composing | awaiting_confirm | sending | done | send_unverified
  // | host_takes_over | host_unknown | answered_elsewhere | superseded | expired | failed | dismissed
  version           Int       @default(0) // CAS
  idempotencyKey    String                // "turn:<turnMessageId>" | "decision:<decisionId>:v<n>"
  providerMessageId String?   @unique     // giden şablonun / ilk mesajın sağlayıcı kimliği
  previewMessageId  String?   @unique     // önizleme mesajının sağlayıcı kimliği
  answerMessageId   String?   @unique     // ev sahibinin cevabının sağlayıcı kimliği
  answerEnc         String?               // ev sahibinin cevabı (şifreli; soru bitince 7 gün sonra NULL)
  draftEnc          String?               // misafire gidecek taslak (şifreli)
  draftHash         String?               // önizlenen = gönderilen
  draftLang         String?
  composeCount      Int       @default(0)
  resultMessageId   String?               // misafire giden Message
  fallbackEmailAt   DateTime?             // yedek e-posta (en çok bir kez)
  sentAt            DateTime?
  deliveredAt       DateTime?
  readAt            DateTime?
  answeredAt        DateTime?
  expiresAt         DateTime
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, idempotencyKey])
  @@index([organizationId, status])
  @@index([conversationId, status])
  @@index([bindingId, status])
}
```

- İkisi de YENİ tablo → dolu tabloya dokunmaz (boot güvenli). İsteğe bağlı `@unique` kolonları NULL'a izin verir (PG'de NULL'lar çakışmaz).
- `Organization`, `User`, `Conversation` modellerine yalnız ilişki alanı eklenir (Prisma tarafı; veritabanında kolon değişmez).
- Gelen olay tekrar önleme = `SystemLock` (migration yok). Bilgi tabanı `source` yeni değeri `host_answer` = uygulama kapalı küme (migration yok).
- Kural: taze `pg_dump` + kurucunun açık "push et" onayı; `prisma migrate diff` shadow 5432; taze PG'de sıfır-drift.
- Saklama: `HostQuestion` 90 gün sonra silinir (metin alanları 7 günde boşalır); `HostChannelBinding` `revoked` 30 gün sonra silinir.

---

## 7. Bayraklar ve ortam değişkenleri (hepsi varsayılan KAPALI, yalnız "1"; `STRICT_ONE_FLAGS` + RAILWAY belgesi §5)

| Anahtar | Açınca | Ön koşul |
|---|---|---|
| `HOST_CHANNEL_ENABLED` | Ayarlar'da "WhatsApp'ı bağla", kanca ucu uyanır | sırlar dolu; kapalıyken uç 200 `{disabled:true}` |
| `HOST_CHANNEL_ORG_IDS` (liste, bayrak değil) | Yalnız listedeki işletmeler (`*` = hepsi; boş = kimse) | ilk açılış: kurucu org |
| `HOST_QUESTIONS_ENABLED` | Tür A bilgi soruları + cevap kurucu + önizleme | `HOST_CHANNEL_ENABLED` |
| `HOST_QUESTION_DECISIONS_ENABLED` | Tür B karar düğmeleri | `HOST_DECISIONS_ENABLED`; ⚠️ `DURABLE_OUTBOX_ENABLED` denemesi sürerken KAPALI (RAILWAY §3/8 uyarısı) |
| `HOST_QUESTION_ALERTS_ENABLED` | Tür C acil bildirim | — |
| `HOST_QUESTION_KB_SAVE_ENABLED` | "Kaydedeyim mi?" | — |
| `HOST_QUESTION_AUTO_SEND_ENABLED` | Düşük riskli A otomatik (yalnız kurucu S1'de B derse) | — |

Sırlar / ayarlar (değeri repoya yazılmaz): `HOST_CHANNEL_PROVIDER` (`whatsapp_cloud`; `fake` üretimde reddedilir) · `WHATSAPP_ACCESS_TOKEN` ·
`WHATSAPP_APP_SECRET` · `WHATSAPP_WEBHOOK_VERIFY_TOKEN` · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_BUSINESS_ACCOUNT_ID` · `WHATSAPP_GRAPH_VERSION`
(kurulum günü güncel sürüme sabitlenir) · `WHATSAPP_TEMPLATE_INFO` / `_DECISION` / `_ALERT` (şablon adları) · `HOST_CHANNEL_HMAC_SECRET`
(≥32 karakter; `AUTH_SECRET`, `ENCRYPTION_KEY`, `ERASURE_HMAC_SECRET`'tan farklı) · `AI_HOST_ANSWER_MODEL` / `AI_HOST_ANSWER_REASONING_EFFORT`.
`scripts/verify-env.mjs`: `HOST_CHANNEL_ENABLED=1` iken eksik sır → üretimde açılış durur (`QR_PIN_PEPPER` emsali).

---

## 8. Test planı (K2 — `docs/TEST-EVIDENCE-CONTRACT.md`)

**Saf birim (kırmızı-önce):**
- Tetik: hangi bugünkü durum hangi tür soruyu üretir; konaklama değişikliği / para / sessiz tür A olmaz; kapalı anahtarda karar "e-posta".
- Toplama / tekrar önleme: aynı tur iki kez → tek soru; aynı öğe yeni turda → soru yok; yeni öğe → kısa ek, saatte 3 tavanı.
- Metin kurucu: misafir adı / telefon / e-posta / rezervasyon kodu hiçbir değişkende yok (fikstür `Lale`); alıntı ≤160, maskeli, satır sonu yok;
  düğme başlıkları ≤20; Türkçe sabit metinler pinli.
- Eşleme: `context.id` → soru; düğme kimliği sürümü eski → ret; bağlamsız + tek bekleyen → bağla; çok bekleyen → "hangi soru"; başka kiracının
  sorusu → ret (sebep sınanır).
- Cevap türü sınıflaması (kod kısmı: "DUR"/"STOP" tam eşleşme; düğme kimlikleri).
- Kod denetimi (`compose-check`): rakam dayanağı (20 ↔ 200), devir / "bilgim yok" / "ev sahibinize yazın" / ödeme yöntemi / iletişim bilgisi /
  makbuzsuz eylem / dil uyumsuzluğu → ret; kapsama eksik → "atla mı?" sorusu.
- Adaptör: imza (geçerli, bozuk, eksik, başka gizli anahtar, tek bayt değişmiş gövde, `sha256=` öneksiz); el sıkışma (doğru / yanlış belirteç);
  ayrıştırıcı Meta fikstürleri (metin, şablon düğmesi `type:"button"`, etkileşimli `button_reply`, durum `sent/delivered/read/failed`, birden çok
  `entry`, bilinmeyen tür → atlanır, bozuk JSON → boş liste); hata kodu → `kind` eşlemesi (kesin / belirsiz).
- ReDoS: kullanıcı metnine uygulanan her yeni kalıp için 4.000–50.000 karakter süre pini (`*-cost.test.ts`, CLAUDE.md kuralı).

**Entegrasyon (gerçek PG, sahte aktarım):**
- Uçtan uca: misafir mesajı → tutuldu → `HostQuestion queued` → sahte aktarım şablonu kaydetti → gelen cevap → kurucu (fetch saplaması) →
  önizleme → [Gönder] → `sendHostMessage` (sahte misafir adaptörü) → `Message.authorType = host` → öğe "ev sahibi cevapladı".
- **"Ev sahibine tekrar tekrar bildirim yok" pinleri:** aynı tura WhatsApp + e-posta birlikte asla; yedek e-posta en çok bir kez; aynı öğe ikinci
  turda soru yok; aynı kanca iki kez → tek işlem.
- Yeniden doğrulama 409'ları: misafir yeniden yazdı, panelden cevaplandı, rezervasyon iptal, öğe geri çekildi, çift dokunuş (CAS), epoch değişti.
- Hata yolları: kesin hata → anında e-posta; belirsiz → yeniden deneme yok + 2 dk sonra e-posta; 10 dk teslim yok → e-posta (sabit saat).
- Kiracı izolasyonu; personel bağlanamaz; bürünmede bağlantı yazılamaz.
- **Anahtar kapalı paritesi:** e-posta davranışı bayt bayt bugünkü; uç uyur; sorgu yok.
- Kalıcı kuyruk açıkken `queued` sonucu; karar şeridi + kuyruk uyarısı.
- Saklama / erasure: 7 gün metin boşaltma, konuşma silme kademesi, misafir silme talebi alanları boşaltır.

**Rota:** kanca GET/POST (imza 401, gövde 413, uyuyan 200), `api-route-role-gate.test.ts` + `impersonation-read-only-pin.test.ts` +
`api-route-scoping` listelerine gerekçeli giriş; Ayarlar bağlantı rotaları `withManage`.

**Mimari pinler:** §4 son madde; `railway-doc-flags.test.ts` yeni anahtarları kendiliğinden yakalar; `core-channel-independence` kapsamına
`host-channel/` eklenir.

**Mutasyon (`scripts/mutation-run.mjs`, M0 kontrol koşusu şart):** tetik, eşleme, kiracı kontrolü, imza, CAS, yeniden doğrulama, kod denetimi —
iki yönlü (kaldırma + aşırı uygulama); hayatta kalan = eksik pin ya da gerekçeli eşdeğer.

**Ölçüm (ücretli, kurucu onayıyla):** cevap kurucu bataryası — TR/EN/DE/FR/RU/AR misafir soruları × ev sahibi cevapları (kısa "var", yazım hatalı,
sayılı "50 TL", ödeme yöntemli "elden nakit", telefonlu, "bilmiyorum", "ben ararım", iki sorudan birini cevaplayan); ölçüt: yanlış olgu 0,
yasak cümle 0, doğru kapsama oranı; hata olunca `tests/eval/failure-analysis.ts` bağdaştırıcısı.

---

## 9. (a) Kurucunun kurulum listesi

1. **Meta Business portföyü:** business.facebook.com → Lixus için portföy (zaten varsa o). **İşletme doğrulaması** (vergi levhası / ticaret sicil
   belgesi, `lixusai.com` alan adı doğrulaması) — görünen ad güveni ve kademe yükselmesi için önerilir.
2. **Geliştirici uygulaması:** developers.facebook.com → "Uygulama oluştur" → tür **Business** → **WhatsApp** ürününü ekle → WhatsApp Business
   Hesabı (WABA) oluşur. (Panelde Meta'nın ücretsiz **test numarası** ile ilk denemeler yapılabilir ⚠️ kurulumda teyit.)
3. **Telefon numarası:** Lixus'a ait, şu an WhatsApp'ta (kişisel ya da Business uygulamasında) KAYITLI OLMAYAN bir hat (sabit hat da olur; SMS ya da
   sesli kodla doğrulanır). Kişisel numaranızı KULLANMAYIN — o numara WhatsApp uygulamasında kullanılamaz hâle gelebilir. İki adımlı doğrulama PIN'i
   belirleyin, kasaya yazın.
4. **Görünen ad:** "Lixus AI" → onaya gönderin (genelde 1–3 iş günü ⚠️). Profil: logo, `https://www.lixusai.com`, kısa açıklama.
5. **Ödeme yöntemi:** WhatsApp Manager → Faturalandırma → kart (mesaj başına ücretler Meta'dan).
6. **Sistem kullanıcısı + kalıcı belirteç:** İşletme Ayarları → Sistem kullanıcıları → "Lixus Bildirim" (Admin) → uygulamayı ve WABA'yı tam
   yetkiyle ata → belirteç oluştur, izinler: `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management` → **bir kez
   gösterilir, hemen kasaya**. (Paddle dersi: süresiz belirteç bir yıllık takvim hatırlatmasıyla gözden geçirilir.)
7. **Uygulama gizli anahtarı:** Uygulama Ayarları → Temel → App Secret → kasaya.
8. **Numara kimlikleri:** WhatsApp → API kurulumu ekranından **Phone number ID** ve **WhatsApp Business Account ID** → kasaya.
9. **Şablonlar:** WhatsApp Manager → Mesaj şablonları → §3.3'teki üç şablon, kategori **Utility**, dil **Türkçe** → onaya gönderin. Marketing'e
   çevrilirse 60 gün içinde itiraz (metni tanıtım dilinden arındırarak).
10. **Railway açılınca:** ortam değişkenleri (§7 listesi) + `HOST_CHANNEL_ORG_IDS=<kurucu org kimliği>`; sonra uygulamada Webhook → Callback URL
    `https://www.lixusai.com/api/webhooks/host-channel/whatsapp`, Verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN` değeri → **messages** alanına abone olun.
11. **Hukuk:** gizlilik metnine Meta Platforms (WhatsApp) alt işleyen + yurt dışı aktarım cümlesi; ev sahibi için WhatsApp bildirim rıza metni
    (Ayarlar'daki kutu) — avukat onayı.
12. **İlk deneme birlikte:** panelde Ayarlar → "WhatsApp'ı bağla" → kendi numaranızdan kodu gönderin → test konuşmasında bir soru → cevap → önizleme
    → Gönder. İlk gerçek misafir sorularında birlikte izleriz (CLAUDE.md: e-posta / kimlik akışı ilk denemeler birlikte).

---

## 10. (b) Kurucu soruları (yalnız gerçekten gerekli üçü)

**S1 — Misafire gönderim: önizleme + [Gönder] mi, otomatik mi?**
- *A (öneri, ilk dilim):* Siz "var, dolapta" yazınca size gelir: "Misafire gidecek (İngilizce): “Yes, there is a baby cot — you'll find it in the
  bedroom wardrobe.” Türkçesi: … **[Gönder] [Gönderme] [Panelde düzenle]**". Gönder'e basınca gider. (+1 dokunuş, yanlış eşleme / yazım hatası /
  çalınan telefon misafire ulaşamaz.)
- *B:* Aynı cevap düşük riskli bilgi sorusuysa (para, konaklama değişikliği, şikâyet değilse; sayı yalnız sizin yazdığınız) **doğrudan gider**, size
  "Gönderildi: “Yes, there is a baby cot…”" bilgisi gelir. Riskli olanlar yine A gibi.
- Önerim: ilk 2 hafta A, ölçüm (kaç önizlemeyi değiştirdiniz / reddettiniz) sonra B'ye geçiş kararı. Böyle yapalım mı?

**S2 — WhatsApp mesajında misafirin sözü ne kadar görünsün?**
- *A (öneri):* kısa, maskeli alıntı — "Lale (12–15 Kas) · Misafiriniz soruyor: “Bebek yatağı var mı? Bir de otopark ücretli mi?”" (telefon / e-posta
  `[telefon]` olarak maskeli, en çok 160 karakter, misafir adı yok).
- *B:* yalnız konu — "Lale (12–15 Kas) · Misafiriniz 2 şey soruyor: bebek yatağı, otopark." (Meta'ya hiç misafir metni gitmez; ama "olanaklar"
  gibi belirsiz etiketlerde ne sorulduğunu anlamak için paneli açmanız gerekebilir.)
- Önerim A: hızlı cevap için şart; e-postalar bugün zaten alıntı taşıyor. Böyle yapalım mı?

**S3 — WhatsApp bağlıyken e-posta ne olsun? (10-29 "tekrar tekrar e-posta yok" kuralınızla)**
- *Önce (bugün):* her tutulan tur → bir e-posta.
- *A (öneri):* WhatsApp birincil; e-posta YALNIZ yedek: gönderilemezse hemen, 10 dakikada telefonunuza ulaşmazsa bir kez. WhatsApp'ı okuyup
  cevaplamadıysanız ek hatırlatma YOK (soru panelde açık).
- *B:* İkisi birden (WhatsApp + e-posta her turda).
- *C:* A + okunup 2 saat cevaplanmayan soruya tek e-posta hatırlatması.
- Acil bildirimler (kayıp anahtar, kilitli kaldım, Sorunlu) dilim 4'te WhatsApp'a da gelsin mi, yoksa onlarda e-posta da hep gitsin mi
  (öneri: acilde ikisi birden — kaçırılmaması daha önemli)? Böyle yapalım mı?

(Sorulmayan, varsayılan seçilenler: sağlayıcı = Meta Cloud API doğrudan · sessiz saat ilk dilimde yok · alıcı = WhatsApp'ını bağlayan sahip /
yönetici, ilk dilimde tek alıcı · bilgi tabanı kaydı taslak olarak, panelde onay · para / iptal yalnız panel. İtirazınız varsa söyleyin.)

---

## 11. (c) Dilim planı

**Dilim 0 — bu belge + S1–S3 cevapları.** (Kod yok.)

**Dilim 1 — Meta'sız, sahte aktarımla tam akış (kodlanabilir ve test edilebilir; Meta bilgisi gerekmez).**
- Kapsam: `host-channel/` çekirdeği (port + kayıt defteri + `fake` aktarım), migration 88 (iki yeni tablo — taze `pg_dump` + açık onay; onay
  gecikirse **1a**: yalnız saf parçalar — tetik kararı, metin kurucu, eşleyici, cevap kurucu + kod denetimi — migration'sız ağaca girer),
  yönlendiricinin `automation.ts`'teki Tür A noktalarına bağlanması, eşleme, cevap kurucu, önizleme / onay, yeniden doğrulama + `sendHostMessage`,
  e-posta yedeği, saklama, bayraklar KAPALI.
- Sahte aktarım: giden mesajları tabloya / belleğe yazar, `parse` normalleştirilmiş olayları kabul eder; yerel deneme betiği
  (`scripts/host-channel-sim.ts`: "ev sahibi şunu yazdı" → akış ilerler) 5434 geliştirme veritabanında.
- Kanıt: §8 saf + entegrasyon + parite + mutasyon. Ücretli ölçüm yalnız kurucu onayıyla (cevap kurucu bataryası).
- Çıktı: "WhatsApp kablosu takılınca çalışacak" bütün iş mantığı yeşil.

> **Kodda (10-30 gece, bağlı değil):** saf parçalar `host-channel/question-text.ts` · `correlate.ts` · `answer-kind.ts` · `compose.ts` +
> `compose-check.ts` · `routing.ts` (tetik → soru türü, kanal seçimi, işletme saatlik tavanı, tur başına tek mesaj birleşik alıntı) ·
> `whatsapp/signature.ts` · `whatsapp/parse.ts` · `whatsapp/transport.ts`. Kalan: migration 88 (onay) → kayıt defteri + kanca ucu + Tür A
> noktalarına bağlantı.
>
> **Kodda (10-30 gece-2, migration 88 ana dalda; anahtarlar KAPALI):** numara bağlama `host-channel/binding-code.ts` (saf: `LIXUS-XXXXXX` kodu,
> anahtarlı HMAC, 15 dk / 5 deneme, oturum kuşağı) + `host-channel/binding.ts` (başlat / kodla doğrula — kod ev sahibinin KENDİ numarasından
> gelir / kaldır / soru alabilecek bağlantı: sahip-yönetici + kuşak aynı; başka hesabın etkin ya da süresi dolmamış numarası devralınamaz) ·
> Tür A soru gönderimi `host-channel/ask.ts` (anahtar / liste / tür kapalıysa veritabanına dokunmaz; tur başına tek soru; öğe türü
> bilinmiyorsa ya da para / iade / konaklama değişikliğiyse e-posta; gönderim düşerse hemen e-posta) → `host-reply-waiting.ts` içinde aynı
> talep altında (WhatsApp giderse e-posta yok — S3 önerisi A; S1–S3 cevaplarınız gelene kadar anahtarlar kapalı kalır) · sağlayıcı seçici
> `host-channel-runtime.ts` (çekirdek dışında) · cevap kurucu denetimi ASCII dışı rakamları da okur. Kalan: kanca ucu
> (`api/webhooks/host-channel/[provider]`: imza + bağlama kodu + cevap eşleme), Ayarlar ekranı (numara + rıza + kod), önizleme / onay akışı.

**Dilim 2 — WhatsApp Cloud adaptörü + kanca ucu + numara bağlama ekranı.**
- `adapters/whatsapp-cloud.ts` (gönderim, imza, el sıkışma, ayrıştırma, hata eşlemesi; fikstürlerle test), `api/webhooks/host-channel/[provider]`,
  Ayarlar → "WhatsApp'ı bağla" (rıza + kod + maskeli numara + kaldır), verify-env sırları, RAILWAY belgesi, gizlilik metni (avukat).
- Kurucu §9 listesi tamamlanınca: kurucu org'da `HOST_CHANNEL_ENABLED` + `HOST_QUESTIONS_ENABLED`; ilk sorular birlikte.

**Dilim 3 — Karar kartları WhatsApp'ta.** Karar rotası mantığının `decisions/decide.ts`'e birebir çıkarılması (rota testleri pinler) + düğmeler.

**Dilim 4 — Acil bildirimler (10-29 notu) + bilgi tabanı kaydı.** Tür C şablonu, saatlik tavan, S3 cevabına göre e-posta ilişkisi; "Kaydedeyim mi?".

**Dilim 5 — (S1 = B ise) düşük riskli otomatik gönderim + sessiz saat ayarı + çoklu alıcı (ilk cevaplayan kazanır, CAS).**

**Sonra:** ses (Faz 6 — döküm alt işleyeni + saklama paritesi), ev sahibi sorguları (Faz 3 — "bugün ne bekliyor?"), serbest talimat → "Anladığım"
önizlemesi (Faz 2), başka kanallar (Telegram / SMS / mobil bildirim = yeni adaptör, çekirdek değişmez).

---

## 12. Riskler ve bilerek yapılmayanlar

- **Railway kapalı:** gerçek kanca canlı adres ister; dilim 2'nin canlı denemesi Railway açılışına bağlı (yerelde tünel yalnız geliştirici denemesi).
- **Meta kuralları değişkendir** (fiyat çeyreklik, kategori yeniden sınıflama, kademe kuralları): adaptör + şablon adları env'de; kurulumda resmi
  sayfa teyidi.
- **Ele geçirilmiş telefon:** önizleme + para / iptal yalnız panel + epoch bağı + tavanlar; tamamen sıfırlanamaz (WhatsApp'ın kendi iki adımlı
  doğrulaması ev sahibine önerilir).
- **Kapsama hatası** (ev sahibinin cevabı bir soruyu karşılamadığı hâlde karşılamış sayılması): kod denetimi + "atla mı?" sorusu + ölçüm.
- **Yapılmayanlar:** misafire WhatsApp kanalı (ROADMAP:57 ayrı iş; Airbnb kuralları), genel sohbet botu (Meta 2026 politikası), ses, ev sahibinin
  sözünü doğrudan misafire iletme (HOST-COPILOT §12: talimat ≠ mesaj).
