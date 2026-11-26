# Ödeme (Paddle) derin inceleme — 2026-10-15

> Salt-okuma inceleme. Kod DEĞİŞTİRİLMEDİ, test KOŞULMADI (vitest / npm / prisma / DB yasak). İzin verilen tek komut
> `git apply --check` (çalışma ağacı sonrasında `git status` ile temiz doğrulandı). HEAD = `72feb52`.
> Okunanlar: `CLAUDE.md` (Faturalandırma) · `docs/claude/kalici-kararlar.md` · `docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md`
> · `docs/SABAH-KARARLARI-2026-10-01.md` §65–66 · iki hazır yama · `src/app/api/webhooks/paddle/route.ts` · `src/lib/payments/paddle.ts`
> · `src/lib/billing/*` · `src/app/api/billing/*` · `tests/integration/*paddle*`, `*billing*`, `checkout-pending-second-subscription`.
> Bu dosya ilerledikçe yazılır (kesme olursa kaybolmasın).

## 1. Tasarım belgesi §1.3'teki dört test eksiği — HÂLÂ eksik mi?

Arama: `tests/` altında Paddle rotasını ya da onay rotasını çağıran bütün dosyalar (6 + 1) tek tek okundu; `Promise.all`, `transaction.paid`,
`invoice.create` değiştirme, fatura P2002 araması yapıldı.

| # | Eksik | Bugün | Kanıt |
|---|---|---|---|
| 1 | Aynı `event_id`'nin EŞZAMANLI iki teslimi | **EKSİK** | Tek test "dedupes a duplicate event_id" (`paddle-webhook.test.ts:589`) iki teslimi SIRAYLA yapar → ikincisi "işlendi" erken dönüşüne düşer; veritabanı hakemleri (olay satırı `upsert`, abonelik P2002 yedeği) hiç yarışta sınanmıyor. Hiçbir ödeme testinde `Promise.all` yok. |
| 2 | Aynı işlemin iki FARKLI `event_id`'si (`transaction.paid` + `transaction.completed`) | **EKSİK** | Testlerde `transaction.paid` hiç geçmiyor. Kod iki türü de fatura yoluna sokuyor (`route.ts:657`), tekilleştirme işlem kimliğiyle (`route.ts:441` + `Invoice @@unique([provider, providerRef])`). |
| 3 | Fatura P2002 dalı (`route.ts:486-491`) | **EKSİK** | P2002 testleri yalnız ABONELİK yolunda (`paddle-webhook.test.ts:697` yapay hata; `k4-race` adım 4). Fatura `create`'i hiçbir testte yarışmıyor; `catch` dalı ölü sayılsa bile hiçbir test kırmızı olmaz. |
| 4 | Eşzamanlı iki onay (consent) isteği | **EKSİK** | `billing-consent-route.test.ts` hepsi sıralı; 20/saat sınırı da sıralı 21 istekle sınanıyor (eşzamanlı sayaç atomikliği kanıtsız). Takip numarasının eşzamanlı isteklerde karışmadığı da kanıtsız. |

**Sonuç:** dördü de hâlâ eksik. Dört test dosyası yazıldı (§2).

## 2. Yazılan dört test dosyası (bu belge yazılırken KOŞULMAMIŞTI; 10-15'te `af8e984` ile itildi, o tarihten beri her tam kapıda ve CI'da
koşuyor ve yeşil — Codex C5 10-16. Mutasyon kanıtı yalnız sonraki ödeme dilimlerinde eklenen davranışlar için var.)

Klasör: `/tmp/claude-0/-home-user-SaaS-Ultimitly/4b3a6b83-dfb6-5a82-b43d-8777d09e2d05/scratchpad/odeme-testleri/` → `tests/integration/`e kopyalanır.
Desen birebir mevcut dosyalardan: `../helpers/db` (`prisma`, `resetDb`), `vi.hoisted` + `vi.mock("@/lib/report-error")`, `vi.stubEnv`,
imza `createHmac(ts:body)`, Prisma temsilcisi `vi.spyOn` DEĞİL elle değiştirme + `.finally` ile geri koyma (`paddle-webhook.test.ts:534`
deseni; CLAUDE.md "spy sızar → ayrı dosya" kuralı gereği her biri AYRI dosya).

**Ortak teknik — buluşma noktası (`meetingPoint`):** yarışı şansa bırakmamak için ilgili okuma (gerçek veritabanı okuması YAPILIR) sonrası
iki istek birbirini bekler; ikisi de "satır yok" gördükten sonra ikisi de yazar. Biri hiç gelmezse 2 sn sonra kapı yine açılır (test
takılmaz) ve `arrivals() === 2` iddiası kırmızı olur → "yarış gerçekten yaşandı" kanıtı (vakum testi olmaz).

### 2.1 `paddle-webhook-concurrent-same-event.test.ts` (eksik 1)
- **A — abonelik olayı:** aynı `subscription.activated` iki kez `Promise.all` ile; kapılar `webhookEvent.findUnique` ve
  `subscription.findUnique` üzerinde. Beklenen: iki 200 `{ok:true}` (ikisi de "duplicate" DEĞİL), tek `WebhookEvent` (processed), tek
  `Subscription` (active/pro/sub_cc/ctm_cc), rota hatası (`reportError("paddle-webhook")`) yok; üçüncü sıralı teslim `{duplicate:true}`.
- **B — işlem olayı:** aynı `transaction.completed` iki kez; kapılar `webhookEvent.findUnique` ve `invoice.findFirst`. Beklenen: iki 200,
  tek fatura (89900 TRY paid), tek olay satırı, rota hatası yok.
- **Neden bugün yeşil:** olay satırı yazımı `upsert` ve koşulları (tek tekil alan `providerEventId`, create'te aynı değer, boş olmayan
  update, iç içe sorgu yok) Prisma 6'nın veritabanı upsert'i (`INSERT … ON CONFLICT DO UPDATE`) şartlarını karşılıyor → iki eşzamanlı
  upsert P2002 vermez ([Prisma v6 API — database upserts](https://www.prisma.io/docs/orm/v6/reference/prisma-client-reference)).
  Abonelik: iki `create` → biri P2002 → `route.ts:406` korumalı `updateMany` (aynı `occurred_at` → `lte` geçer, kimlik şartı aktif
  olayda boş) → count 1 → 200. Fatura: iki `create` → biri P2002 → `route.ts:490` yutar → 200.
- **Hangi mutasyon kırmızı yapar:** (M1) olay yazımını `upsert` yerine `create` yapmak → ikinci teslim P2002 → 500 (statü `[200,500]`).
  (M2) abonelik `catch`'inde P2002 yedeğini silmek (yeniden fırlat) → 500. (M3) fatura P2002 `return`'ünü silmek → B'de 500.
  (M4) `Invoice_provider_providerRef_key` ya da `Subscription_organizationId_key` dizinini düşürmek → iki satır. (M5) "processed →
  duplicate" hızlı yolunu silmek → A'nın son sıralı teslimi `{ok:true}` döner, iddia kırmızı.
  ⚠️ Not: U42 yaması uygulanırsa A YİNE yeşil kalır (yamanın `createMany skipDuplicates` + korumalı güncelleme yolu da tek satır üretir)
  — yani bu test, U42'nin vakum hâline getirdiği eski P2002 testinin (§3.2) yerini tutar.

### 2.2 `paddle-webhook-same-transaction-two-events.test.ts` (eksik 2)
- **A — sıralı:** `transaction.paid` (evt_paid) → fatura VAR (tek başına yazar); aynı işlemin `transaction.completed` (evt_completed)
  → `{ok:true}` (farklı event_id, "duplicate" değil), fatura hâlâ TEK ve aynı satır; iki olay satırı da processed.
- **B — eşzamanlı:** iki olay `Promise.all`, kapı `invoice.findFirst` üzerinde → ikisi de create dener → tek fatura, iki 200, iki olay processed.
- **KONTROL — aşırı uygulama yok:** aynı aboneliğin iki FARKLI yenileme işlemi (onaysız, `subscription_id` ile bağlanır) → İKİ fatura,
  ikisi de abonelik satırına bağlı. (Bu, yenilemenin `subscription_id` → `orgFromProviderRef` yolunun da ilk testi — daha önce yoktu.)
- **Neden bugün yeşil:** `route.ts:657` iki türü de fatura yoluna sokar; A'da ikinci olay `route.ts:442` hızlı yoldan döner; B'de ikinci
  create P2002 → `route.ts:490`. KONTROL'de tekilleştirme anahtarı işlem kimliği olduğu için farklı işlemler ayrı satır.
- **Mutasyonlar:** "transaction.paid"i rotadan çıkarmak → A'nın ilk iddiası (fatura 1) kırmızı. P2002 `return`'ünü silmek → B'de 500.
  Tekil dizini düşürmek → B'de iki fatura. Tekilleştirmeyi işletmeye/aboneliğe göre yapmak → KONTROL'de tek fatura.
  **Eşdeğer mutant (gerekçeli):** yalnız hızlı yolu (`if (existing) return;`) silmek bu dosyada YAŞAR — çünkü asıl hakem tekil dizin +
  P2002; hızlı yol yalnız gereksiz yazma denemesini önleyen bir iyileştirme. Davranış aynı, öldürülmesi gerekmez.

### 2.3 `paddle-webhook-invoice-p2002.test.ts` (eksik 3)
- **A — GERÇEK P2002:** rakip fatura önceden yazılı (89900); hızlı yol `findFirst` → null döndürülür (okuma rakipten önce yapılmış gibi);
  `create` gerçek veritabanına gider ve hata kodu kaydedilir. Beklenen: `createErrors == ["P2002"]` (yapay hata YOK — Postgres'in kendi
  tekil dizini), 200 `{ok:true}`, olay processed, tek fatura = rakibin satırı ve TUTARI (12345 değil 89900 — ilk yazan kazanır), rota hatası yok.
- **KONTROL — yalnız P2002 yutulur:** `create` "db down" hatası → 500, olay "error", fatura yok, `reportError("paddle-webhook")` 1 kez;
  yeniden teslim → 200, tek fatura, processed.
- **Mutasyonlar:** P2002 dalını silmek → A 500. `catch { return; }` (her hatayı yut) → KONTROL'ün 500 iddiası kırmızı (ve gerçek hayatta
  geçici DB hatasında fatura SESSİZCE kaybolurdu — olay "processed" olur, Paddle yeniden denemez). Tekil dizini düşürmek → A'da
  `createErrors` boş + iki fatura. P2002'de "var olanı güncelle" yapmak → A'nın tutar iddiası (89900) kırmızı.

### 2.4 `billing-consent-concurrent.test.ts` (eksik 4)
- **A — iki sekme aynı anda:** kapı "canlı abonelik var mı" okumasında (`subscription.findUnique`, istek başına tek). Beklenen: iki 201,
  iki AYRI `consentId`, iki satır da oturumun işletmesi/kullanıcısı; her satırın `correlationId`'si KENDİ yanıtının `X-Correlation-ID`
  başlığı ve ikisi farklı. **Bilinen sınır kayda geçer:** sunucu eşzamanlı iki onayı ENGELLEMEZ (iki satır) — çift aboneliğe karşı koruma
  "ödemeniz işleniyor" kilidi + webhook'un ikinci abonelik alarmı.
- **B — iki FARKLI işletme aynı anda:** oturum sırası (`vi.hoisted` kuyruk; `withAuth` oturumu ilk `await`ten önce istediği için atama
  belirlenimci). Her onay kendi işletmesine/kullanıcısına; kuyruk tükendi (iki istek de kendi oturumunu aldı).
- **C — 25 eşzamanlı istek:** tam 20 × 201, 5 × 429, 20 satır (veritabanı sayacı `INSERT … ON CONFLICT DO UPDATE … RETURNING` tek ifade →
  atomik; `rate-limit.ts:32-52`).
- **KONTROL:** canlı Paddle aboneliği varken eşzamanlı 3 istek → üçü de 400, satır yok.
- **Neden bugün yeşil:** takip numarası `AsyncLocalStorage` (`correlation.ts:24`) → istekler arası sızmaz; satır `currentCorrelationId()`
  ile, başlık da aynı bağlamda `withCorrelationHeader` ile yazılır (`route-guard.ts:55-66`); işletme / kullanıcı yalnız oturumdan.
- **Mutasyonlar:** onay satırına `newCorrelationId()` yazmak → satır ≠ başlık. Takip numarasını modül düzeyi değişkende tutmak → kapı
  sayesinde iki satır da ikinci isteğin numarasını alır → "farklı" iddiası kırmızı. `rateLimit` çağrısını kaldırmak ya da satırdan sonra
  çağırmak → 25 satır. Sayacı "oku-sonra-yaz" yapmak → eşzamanlı patlamada büyük olasılıkla >20 (olasılıksal). Canlı abonelik kapısını
  kaldırmak → KONTROL'de satır + A'da kapı hiç dolmaz (`arrivals` 0).

**Doğrulama (10-16 güncel):** dört dosya tam kapıda ve CI'da yeşil; yukarıdaki mutasyonların bu dosyalar için ayrı koşusu YAPILMADI.
Tip / lint: `any` yok (`never` + `as unknown as typeof …` — mevcut desen), kullanılmayan içe aktarım yok; yine de `tsc` + `eslint` koşulmalı.

## 3. U39 ve U42 — HEAD (`72feb52`) üzerinde yeniden doğrulama

Rota dosyası yamalardan SONRA 4 kez değişti (`0ab201b` ikinci abonelik alarmı + kilit, `31ee95a`, `2bb6989` takip numarası, `d84ee30`).
Yine de iki yama da bağlam eşleşmesiyle temiz uygulanıyor: `git apply --check` tek tek ve BİRLİKTE → temiz (çalışma ağacı sonra `git status`
ile temiz doğrulandı). İki yama farklı fonksiyonlara dokunuyor (U39 `applyTransactionEvent`, U42 `applySubscriptionEvent`'in sonu).

### 3.1 U39 — bozuk / eksik fatura tutarı (Sabah 65)
- **Hata HÂLÂ VAR:** `route.ts:447-448` `Number.parseInt(grand, 10)` → "100abc" 100, "1e3" 1, "-500" −500, "12.50" 12; tutar yoksa NaN →
  `route.ts:473` `Number.isFinite(amountMinor) ? amountMinor : 0` → **0 tutarlı "paid" fatura**. Ve `route.ts:441-442` (fatura varsa çık) +
  tekil dizin yüzünden aynı işlemin sonraki DOĞRU olayı faturayı DÜZELTEMEZ ("ilk yazan kazanır" — §2.3'te bunu pinleyen test var).
- **Yama doğru mu:** evet. Yalnız `^\d{1,15}$` (güvenli tamsayı) kabul; değilse fatura yazılmaz + `reportError` (eksik para birimi emsali,
  fail-closed) → sonraki doğru olay yazar. Gerçek "0" geçerli. Yeni HEAD'de `logEvent("billing.invoice.recorded", { amountMinor:
  Number.isFinite(amountMinor) ? … })` satırı yamadan sonra da tip olarak doğru (daraltma sonrası `number`). Testleri `paddle-webhook.test.ts`e
  ekleniyor ve bugünkü dosyaya temiz uygulanıyor. Benim yeni dört dosyam U39 ile ÇAKIŞMAZ (hepsi geçerli "89900"/"12345" kullanır).
- **Bırakılırsa risk: DÜŞÜK.** Paddle `details.totals.grand_total`'ı her işlemde tam sayı dizesi olarak gönderir ("Total due on a transaction
  after credits but before any payments" — [Paddle changelog: grand_total](https://developer.paddle.com/changelog/2023/transaction-totals-grand-total/)).
  Gerçekçi tetikleyici "alan YOK" durumudur (Paddle yük şeması değişir / alan yolu kayar) → 0 tutarlı fatura. `transaction.paid` olayı
  `transaction.completed`'dan ÖNCE gelir ve bazı alanları henüz boş olabilir ([Paddle: transaction.paid](https://developer.paddle.com/webhooks/transactions/transaction-paid/))
  → o anda tutar eksikse 0 faturası yazılır ve `completed`'ın doğru tutarı ASLA yazılamaz. Etki yalnız bizim fatura kaydımız: `Invoice`
  yalnız KVKK dışa aktarımında ve saklama kodunda okunuyor (`data-export.ts:236`, `data-retention.ts:796`), ekranda gösterilmiyor, erişimi
  etkilemiyor; gerçek fatura Paddle'da (satıcı Paddle — MoR). Yine de yanlış "ödendi 0 ₺" kaydı muhasebe / müşteri dışa aktarımında yanıltır.
- **Öneri:** onay (yama hazır, ucuz, para hareketine dokunmuyor — yalnız kayıt yazımı).

### 3.2 U42 — ödeme olayı ↔ hesap silme yarışı, ödeme tarafı (Sabah 66)
- **Hata HÂLÂ VAR:** `route.ts:173` işletme var mı okunur (kilitsiz) → `route.ts:191` abonelik okunur → arada hesap silinirse (abonelik
  kademeyle gider) `route.ts:378-385` `updateMany` 0 satır döner ve yorum gereği "daha taze olay yazılmış, bayat" sayılıp **alarmsız** döner.
  Silme tarafı (`account/delete/route.ts:79-91`, org `FOR UPDATE` + işlem içinde faturalı abonelik yeniden denetimi) zaten düzeltilmiş.
- **Ne zaman olabilir (gerçekçilik):** silme yalnız abonelik İPTAL ya da "dönem sonunda iptal" iken izinli (`hasBillableSubscription`).
  Yani yarış: müşteri dönem sonu iptalini Paddle portalında GERİ ALIR (ödemeli `subscription.updated`, status active) ve AYNI SANİYEDE
  panelde hesabını siler. Pencere milisaniyeler. Olasılık çok düşük.
- **Bırakılırsa risk: DÜŞÜK.** Kayıp kalıcı değil: bir sonraki ödemeli olay (yenileme `subscription.updated` / `transaction.completed`)
  işletmeyi bulamaz (abonelik satırı ve onay kademeyle silinmiş) → `alertUnlinkedPayment` alarmı ÇALIŞIR. En kötü durum: alarm bir yenileme
  döngüsü GEÇ gelir, silinmiş hesaba bir kez daha çekim yapılmış olur (iade edilebilir). İlk-kayıt dalında (`create`) zaten güvenli: kuruluş
  yoksa yabancı anahtar hatası → 500 → Paddle yeniden dener → o sefer alarm.
- 🚨 **YENİ BULGU — yama olduğu gibi uygulanırsa TAM KAPI KIRMIZI olur (kod okumasıyla; koşulmadı):** yama ilk yazımı `prisma.subscription.create`
  yerine işlem içinde `tx.subscription.createMany` ile yapıyor. Var olan `paddle-webhook.test.ts:517` "returns 5xx on a transient apply failure"
  testi geçici arızayı `prisma.subscription.create`'i bozarak üretiyor → yamalı kod `create`'i hiç çağırmaz → ilk teslim 200 döner, test
  `toBe(500)` bekler → **KIRMIZI**. Ayrıca `paddle-webhook.test.ts:697` "P2002 create-fallback" testi de aynı değiştirmeye dayanıyor → yamalı
  kodda değiştirilen fonksiyon çağrılmaz, test YEŞİL kalır ama artık hiçbir şey sınamaz (vakum). 10-08 raporundaki "yamalı kodda YEŞİL" yalnız
  yamanın KENDİ testi için ölçülmüş (`SABAH-RAPORU-2026-10-08.md:60`); iki etkilenen test 10-02'den beri var (git blame), yani yama ilk günden
  beri tam kapıda kırmızıydı.
- **Önerim (daha basit alternatif):** yamadaki işlem + `FOR SHARE` yerine 0 satır dönen güncellemeden sonra TEK okuma:
  "güncelleme 0 satır döndü VE olay ödemeli VE işletme artık YOK → `alertUnlinkedPayment(…, 'işletme silindi')`". Neden yeterli: güncelleme 1
  satır yazdıysa silme işlemi kendi `FOR UPDATE` kilidi altında aktif aboneliği görür ve 409 der (silme tarafı zaten düzeltildi); 0 satır
  dönüp işletme hâlâ varsa olay gerçekten bayattır (alarmsız, bugünkü gibi). Kilit / işlem eklemez, mevcut iki testi bozmaz, yamanın kendi
  testi (`paddle-webhook-org-race.test.ts`) aynen geçer. Yama tercih edilirse: `:517` testi `prisma.$transaction`'ı bozacak şekilde
  güncellenmeli ve `:697` testi `createMany`'ye taşınmalı (ya da §2.1-A'nın gerçek yarış testi onun yerini tutar).

## 4. Paddle'a özgü uç durumlar → bizim kod

Kaynaklar Paddle geliştirici belgeleri (WebSearch özetleri; `developer.paddle.com` bu ortamda doğrudan açılamadı — vekil 403 — o yüzden
sayfa ALINTILARI arama özetlerinden; kritik olanlar sandbox'ta doğrulanmalı). Rota: `src/app/api/webhooks/paddle/route.ts` = `route.ts`.

| # | Durum | Paddle ne yapar | Bizim kod | Risk |
|---|---|---|---|---|
| 1 | **İade (refund)** | `adjustment.created` (action `refund`, canlıda çoğu `pending_approval`) → onaylanınca `adjustment.updated` (`approved`/`rejected`); yük `transaction_id` + `subscription_id` taşır. İade aboneliği İPTAL ETMEZ; ayrıca iptal gerekir. Bekleyen iade varken abonelik değişikliği reddedilir (`subscription_outstanding_pending_refund`). [adjustment.updated](https://developer.paddle.com/webhooks/adjustments/adjustment-updated/) · [Refund or credit](https://developer.paddle.com/build/transactions/create-transaction-adjustments/) · [hata sayfası](https://developer.paddle.com/errors/subscriptions/subscription_outstanding_pending_refund/) | `adjustment.*` hiç işlenmiyor (kaydedilir, "processed", hiçbir şey değişmez). `Invoice.status` şemada "refunded" seçeneği var ama HİÇ yazılmıyor → iade edilmiş ödeme dışa aktarımda "paid". Erişim değişmez (Paddle'la tutarlı). Bekleyen iade varken plan değişikliği PATCH'i 4xx → "kesin ret", müşteriye genel hata metni. | Düşük (yalnız kayıt doğruluğu) |
| 2 | **Ters ibraz (chargeback / dispute)** | Paddle otomatik `adjustment` yaratır: `chargeback_warning` (erken uyarı), `chargeback`, kazanılırsa `chargeback_reverse`; tutar iade edilir. Aboneliği otomatik iptal ettiğine dair belge BULUNAMADI. [adjustment.created](https://developer.paddle.com/webhooks/adjustments/adjustment-created/) | Hiç işlenmiyor, ALARM YOK. Ödemesini bankadan geri alan müşteri hizmeti kullanmaya devam eder, kimse bilmez. | Orta-düşük (kötüye kullanım yolu; operatör habersiz) |
| 3 | **past_due → active** | Yenileme ödemesi düşer → `past_due` + `subscription.past_due`; Paddle yeniden dener (Retain yoksa ~30 günde 7 deneme); başarıda `subscription.updated` (active) — `subscription.activated` GELMEZ; tükenirse `subscription.canceled` (iptal geri alınamaz). [Payment Recovery](https://developer.paddle.com/concepts/retain/payment-recovery-dunning/) · [dunning](https://developer.paddle.com/build/lifecycle/subscription-renewal-dunning) | Doğru: her `subscription.*` aynı işleyiciden; `pastDueSince` ilk geçişte damgalanır, active'de silinir; sıra koruması `occurred_at` ile atomik (`route.ts:277`). Testli (`paddle-webhook.test.ts:424, 496`). **Fark (10-15 hâli):** bizim ödemesiz erişim süremiz 14 gün (`BILLING_PAST_DUE_GRACE_DAYS`), Paddle 30 güne kadar deniyor → 15.–30. gün arası erişim kapalı, Paddle hâlâ tahsil etmeye çalışıyor; ödeme düşerse erişim o olayla geri gelir. **10-16 kurucu kararı:** ek süre KALDIRILDI — erişim yalnız ödenmiş dönem sürerken açık; ödeme doğrulanınca (`active` olayı) anında açılır; müşteri yeni ödeme ekranına değil "Aboneliği yönet"e gider (sunucu kapısı canlı abonelikte yeni ödeme ekranı açmaz). | Düşük (ürün kararı) |
| 4 | **Duraklatma (paused)** | Varsayılan dönem sonunda: önce `scheduled_change.action = "pause"` + `subscription.updated` (status active kalır), dönem sonunda `paused` + `subscription.paused`; anında duraklatma da var; `resume` → `subscription.resumed`, varsayılan olarak hemen faturalar. Retain, denemeler tükenince iptal yerine duraklatabilir. [pause](https://developer.paddle.com/api-reference/subscriptions/pause-subscription/) · [subscription.paused](https://developer.paddle.com/webhooks/subscriptions/subscription-paused/) | `paddleStatusToLocal("paused") → "past_due"` (`paddle.ts:165`) → `pastDueSince` damgalanır → **duraklatan müşteri 14 gün daha ücretsiz premium** alır. Planlı duraklatma (`action:"pause"`) okunmuyor (yalnız `cancel` okunuyor, `route.ts:244`) — zararsız. Silme engeli (`hasBillableSubscription`) duraklatılmışı "bitmemiş" sayar → silme 409 (doğru: geri dönebilir). Duraklatılmışta plan değişikliği bizim kapıdan geçer, Paddle reddeder (kesin ret). | Düşük |
| 5 | **Dönem sonunda iptal (scheduled cancel)** | `scheduled_change.action="cancel"` + `subscription.updated`; dönem sonunda `canceled` + `subscription.canceled`; planlı iptal/duraklatma varken "next_billing_period" ücretlendirme kipleri KULLANILAMAZ. İptal geri alınamaz. [Cancel](https://developer.paddle.com/build/subscriptions/cancel-subscriptions/) · [Proration](https://developer.paddle.com/concepts/subscriptions/proration/) | Doğru: `cancelAtPeriodEnd` yazılır, geri alınınca (`scheduled_change` null) false olur; dönem sonunda canceled → erişim biter; silme engeli `cancelAtPeriodEnd`'i "bitmiş" sayar. **Boşluk:** planlı iptali olan müşteri DÜŞÜRME yaparsa bizim kod `prorated_next_billing_period` gönderir (`plan-change.ts:60`) → Paddle reddeder → genel hata metni (para hareketi yok). | Düşük (kötü deneyim) |
| 6 | **Para birimi değişimi** | Fiyatlar ülkeye göre farklı para biriminde olabilir; abonelik `currency_code` taşır. (Abonelik para birimini değiştirme kuralları aramada bulunamadı — belge ile doğrulanmalı.) | Fatura para birimi OLAYDAN (eksikse fail-closed, `route.ts:457-464`); `Subscription`'da para birimi yok; önizleme Paddle'ın para birimiyle biçimlenir. Fatura tutarları hiçbir yerde TOPLANMIYOR (yalnız dışa aktarım) → karışık para birimi hesap bozmaz. Plan eşlemesi fiyat kimliğiyle (para biriminden bağımsız). | Çok düşük |
| 7 | **Kısmi ücretlendirme (proration)** | Beş kip: `prorated_immediately`, `full_immediately`, `prorated_next_billing_period`, `full_next_billing_period`, `do_not_bill`; denemedeki abonelikte yalnız `do_not_bill`. [Proration](https://developer.paddle.com/concepts/subscriptions/proration/) | Yükseltme hemen (fark işlemi `subscription_id` taşır → fatura `orgFromProviderRef` ile bağlanır, ayrı satır), düşürme sonraki dönem; Paddle hesaplar. Kalemler PATCH anında değişir → `subscription.updated` yeni fiyatla gelir → **düşürmede plan kodu (sınırlar) HEMEN düşer**, ödeme farkı sonraki faturada alacak olarak döner. Paddle tarafı deneme kullanılırsa (`trialing`) PATCH'imiz `do_not_bill` göndermediği için reddedilir. | Düşük |
| 8 | **`subscription.updated`, `transaction.completed`'dan ÖNCE gelir** (ya da tersi) | Sıra GARANTİ DEĞİL; en az bir kez teslim; `occurred_at` ile karar verin, `event_id` ile tekilleştirin. Ödemede tipik sıra: `transaction.paid` → `subscription.created` → `transaction.completed`; `transaction.paid`'de `subscription_id` henüz boş olabilir. [How webhooks work](https://developer.paddle.com/webhooks/about/how-webhooks-work/) · [transaction.paid](https://developer.paddle.com/webhooks/transactions/transaction-paid/) · [renewed scenario](https://developer.paddle.com/webhooks/simulator/subscription-renewed/) | İki işleyici bağımsız; ikisi de işletmeyi kendisi bulur (kayıtlı abonelik kimliği → yoksa taze onay). Abonelik olayları arasında sıra koruması var; fatura olaylarında "ilk yazan kazanır". **Küçük boşluk:** işlem önce gelir ve işletmenin HİÇ abonelik satırı yoksa (deneme satırı olmayan eski "grandfathered" hesap) fatura `subscriptionId: null` kalır, sonradan bağlanmaz (yalnız dışa aktarım). **Doğrulanmalı:** yenilemede `transaction.paid` `subscription_id`'siz gelirse, yenileme işlemindeki `custom_data` İLK onayın kopyasıdır (bayat) → "bağlanamayan ödeme" YANLIŞ ALARMI üretir (işlem başına bir kez), ardından `completed` doğru bağlar. Paddle notu bunu "otomatik tahsil edilen yinelenen kalemler" için söylüyor; ilk ödemede zararsız (taze onay var). Sandbox'ta `subscription_renewal` simülasyonuyla bakılmalı. | Düşük (olası alarm gürültüsü) |
| 9 | **5 dakikadan eski tekrar (replay)** | Paddle SDK'ları ±**5 saniye** tolerans uygular, elle doğrulamaya da bunu önerir. Yeniden denemeler 3 güne yayılır (canlıda 60 deneme), "replay" API'si aynı `event_id` ile YENİ bildirim yaratır → her teslim yeniden imzalanır. [Signature verification](https://developer.paddle.com/webhooks/about/signature-verification/) · [Handle delivery](https://developer.paddle.com/webhooks/about/respond-to-webhooks/) · [Replay](https://developer.paddle.com/api-reference/notifications/replay-notification/) | Tolerans ±**5 dk** (`paddle.ts:50`) — Paddle'ınkinden geniş ama zararsız: araya giren biri ancak GERÇEK bir Paddle yükünü 5 dk içinde tekrar edebilir; `event_id` "processed" ise `duplicate`, değilse işleyiciler idempotent. 5 dk'dan eski → 401. **İki not:** (a) eski zaman damgalı tekrar ŞEKİL olarak gerçek teslim gibi görünür → "imza doğrulanmadı — webhook anahtarı yanlış" alarmı (`route.ts:599-605`) yanlış teşhis koyar (anahtar doğru, zaman eski). (b) Operatör bir hatayı düzeltip olayı Paddle'dan "replay" ederse olay zaten "processed" olduğu için `duplicate` döner, HİÇBİR ŞEY yeniden uygulanmaz → kurtarma için önce `WebhookEvent.status` "error"a çekilmeli (çalışma kitabına yazılmalı). | Düşük |
| 10 | **Saat kayması (clock skew)** | Paddle `ts`'yi gönderim anında koyar. | Sunucu saati >5 dk kayarsa HER olay 401 → Paddle 3 gün dener → alarm metni yine "anahtar yanlış" der. Onay tazeliği de `occurred_at` için 5 dk ileri tolerans kullanır (`route.ts:49,64`) — tutarlı. Railway NTP'li; olasılık düşük. | Düşük |
| 11 | **5 saniyede 200 bekleniyor** | Paddle 5 sn içinde 200 ister, yoksa yeniden dener. [Handle delivery](https://developer.paddle.com/webhooks/about/respond-to-webhooks/) | Bütün iş yanıt öncesi eşzamanlı. Yavaş veritabanında her `logEvent` 500 ms'ye kadar bekletebilir (bir olayda 3–5 çağrı) + alarm e-postası `await` ediliyor → 5 sn aşılabilir → Paddle aynı olayı tekrar yollar → tam olarak §2.1'deki eşzamanlı teslim. Kod buna dayanıklı (artık testli). | Düşük |
| 12 | **Paddle tarafı deneme (`trialing`)** — gelecekteki "kartlı deneme" tasarımı | `subscription.created/trialing`, sonra `activated`. | Webhook `trialEndsAt`'ı yalnız `active`'de siler, `trialing`'de DOKUNMAZ → bizim 14 günlük ters denemenin bitiş tarihi satırda kalır; `getEntitlement` `trialing` + geçmiş/boş `trialEndsAt`'ı "deneme bitti" sayar (`subscription.ts`) → `BILLING_ENFORCED` açıkken kartla Paddle denemesine geçmiş müşterinin premium'u kapanabilir. Bugün kullanılmıyor; tasarım belgesi §5 "kartla doğrulama"ya geçilirse ÖNCE bu düzeltilmeli. | Bugün yok · gelecekte Orta |

**Doğru çalışan ve testli olanlar (dokunmayın):** imza (ham gövde, sabit-zamanlı karşılaştırma, çoklu `h1` — anahtar rotasyonu), `event_id`
tekilleştirmesi + "error"daki olayın yeniden işlenmesi, `occurred_at` sıra koruması (atomik WHERE), K4 abonelik kimliği, ikinci aktif abonelik
alarmı, bağlanamayan ödeme alarmı, eski aboneliğin (K4 ile değiştirilen) yenilemeleri → bağlanamayan ödeme alarmı (işletmeyi bulamaz), katalog
dışı fiyat alarmı, para birimi yoksa fatura yazmama, `transaction.payment_failed` → kilidi kaldırma.

## 5. Kurucuya sorular (öneri biçimiyle)

### S1 — U39: bozuk / eksik tutarlı fatura (Sabah 65, yama hazır, HEAD'e temiz uygulanıyor)
- **Bugün böyle yapıyorum:** Paddle'dan gelen tutarı gevşek okuyorum; tutar yoksa "0 ₺ ödendi" faturası yazıyorum ve aynı ödemenin sonraki
  doğru olayı bu yanlış faturayı düzeltemiyor.
- **Büyük şirketler böyle yapıyor:** para alanını katı okur; okuyamadığı kaydı YAZMAZ, alarm verir, doğru veri gelince yazar (bizim eksik
  para birimi kuralımız da böyle).
- **Önerim:** yamayı uygulayalım. Müşteriye görünen hiçbir şey değişmez; fatura listesi yalnız dışa aktarımda.
- **ÖRNEK:** Lale'nin Pro yenilemesi için önce `transaction.paid` gelir, tutar alanı boş. Bugün: "0 ₺ ödendi" faturası yazılır, 1 sn sonra
  gelen `transaction.completed` (899,00 ₺) yok sayılır → dışa aktarımda "0 ₺". Sonra: ilk olayda fatura yazılmaz + operatöre "tutar
  okunamadı" alarmı; ikinci olay 899,00 ₺ faturayı yazar.
- **Böyle yapalım mı?**

### S2 — U42: hesap silme ile ödeme olayının aynı anda olması (Sabah 66)
- **Bugün böyle yapıyorum:** ödeme olayı işletmeyi bulduktan hemen sonra hesap silinirse olayı "eski olay" sanıp sessizce bırakıyorum
  (alarm, bir sonraki ödemede gelir).
- **Büyük şirketler böyle yapıyor:** "yazamadım" ile "yazmama gerek yok" ayrımını yapar; yazamadığı ödemeyi her zaman birine haber verir.
- **Önerim:** hazır yamayı OLDUĞU GİBİ UYGULAMAYALIM — var olan bir testi kırar ve birini anlamsız bırakır (§3.2). Onun yerine daha basit
  düzeltme: "güncelleme 0 satır döndü ve işletme artık yok" ise "bağlanamayan ödeme" alarmı. Aynı sonucu kilitsiz ve işlemsiz verir.
- **ÖRNEK:** Lale dönem sonu iptalini Paddle'da geri alıyor ve aynı anda panelden hesabını siliyor. Bugün: hesap silinir, Paddle bir ay
  sonra yine çeker, alarm ancak o çekimden sonra gelir. Sonra: alarm hemen gelir ("işletme silindi, abonelik canlı — Paddle'da iptal
  edin"), operatör çekimden önce iptal eder. Gerçekten eski olayda (daha yeni olay yazılmış) bugünkü gibi sessiz.
- **Böyle yapalım mı?** (Yoksa yamayı iki eski testi güncelleyerek mi uygulayalım?)

### S3 — İade ve ters ibraz (chargeback)
- **Bugün böyle yapıyorum:** Paddle'ın iade / ters ibraz olaylarını kaydedip hiçbir şey yapmıyorum. İade edilen ödeme bizde "ödendi" kalır;
  bankasından parasını geri alan müşteriden kimsenin haberi olmaz.
- **Büyük şirketler böyle yapıyor:** itiraz (dispute) ayrı bir olay olarak gelir ve hemen satıcıya bildirilir; fatura kaydı "iade edildi"
  olarak işaretlenir. Erişimi kesmek otomatik değil, satıcının kararıdır. Paddle satıcı olarak itirazı bizim adımıza yanıtlar
  ([adjustment.created](https://developer.paddle.com/webhooks/adjustments/adjustment-created/)); bize düşen yalnız haberdar olmak.
- **Önerim:** (a) `adjustment.updated` onaylı iade → ilgili fatura "refunded" (kısmi iade → yalnız not); (b) `chargeback` /
  `chargeback_warning` → operatöre TEK alarm (işlem başına, geçiş tabanlı — mevcut desen). Erişime DOKUNMAYALIM; kararı siz verin.
  Migration GEREKMEZ (`Invoice.status` "refunded"ı zaten tanıyor).
- **ÖRNEK:** Lale yıllık planı ödedi, 3 gün sonra bankasından itiraz etti. Bugün: hiçbir şey olmaz, hesap 12 ay premium kalır. Sonra:
  operatöre "Paddle işlem txn_… için ters ibraz — müşteri ctm_…; erişim değişmedi" e-postası; fatura dışa aktarımda "ödendi" değil
  "itiraz" görünür.
- **Böyle yapalım mı?** Ters ibrazda erişim de kapansın mı (ör. aboneliği "past_due" gibi ödemesiz say)?

### S4 — Duraklatılmış abonelik ve 14 / 30 gün
- **Bugün böyle yapıyorum:** Paddle'da "duraklatıldı" durumunu "ödemesi gecikti" sayıyorum → duraklatan müşteri 14 gün daha premium
  kullanıyor. Ödemesi gecikende 14 gün sonra erişimi kapatıyorum; Paddle ise 30 güne kadar tahsil etmeye çalışıyor.
- **Büyük şirketler böyle yapıyor:** duraklatma "müşterinin isteğiyle ödeme yok" demektir → erişim duraklatma anında durur; ödeme
  gecikmesinde ek süre sağlayıcının deneme süresiyle aynı tutulur ya da daha kısa (bizimki gibi) bilinçli seçilir.
- **Önerim:** duraklatılmışa ek süre vermeyelim (ayrı yerel durum "paused": premium kapalı, hesap silme yine engelli, yeni ödeme ekranı
  açılmaz — "devam ettir" Paddle portalından). 14 gün kuralı aynen kalsın (bilinçli seçim olarak yazalım).
- **ÖRNEK:** Lale kış için aboneliği duraklatıyor. Bugün: duraklatma günü + 14 gün oto-mesaj çalışmaya devam eder. Sonra: duraklatma
  olayıyla oto-mesaj durur; Paddle'da "devam et"e basınca (Paddle hemen faturalar) geri açılır.
- **Böyle yapalım mı?**

### Sormadan yapılabilecekler (müşteriye giden metne dokunmuyor — "kolay + doğru" sınıfı; ben salt-okuma olduğum için YAPMADIM)
1. Dört test dosyası (§2) → `tests/integration/`.
2. İmza alarmında teşhis: HMAC doğru ama zaman damgası eski ise ayrı metin ("saat farkı / eski tekrar"), değilse bugünkü "anahtar yanlış"
   (yalnız operatör e-postası).
3. Çalışma kitabına not: Paddle'dan "replay" ile kurtarma yapmadan önce `WebhookEvent.status` "error"a çekilmeli (yoksa `duplicate` döner).
4. Sandbox doğrulaması: yenilemede `transaction.paid`'in `subscription_id` taşıyıp taşımadığı (§4 #8 — yanlış alarm riski).
5. (Müşteri metni — SORULMALI) planlı iptali olan aboneliğe düşürme denenince açık metin ("Aboneliğiniz dönem sonunda iptal olacak; plan
   değiştirmek için önce iptali geri alın.") — bugün genel hata metni.

## 6. Dürüst sınırlar + nasıl doğrulanır

- **Hiçbir test koşulmadı** (görev salt-okuma). "Bugünkü kodda yeşil" iddiaları satır satır kod izine dayanıyor. En zayıf varsayım:
  §2.1'de olay satırının `upsert`'i Prisma 6.2.1'de veritabanı upsert'i (`ON CONFLICT`) olarak koşuyor. Değilse §2.1-A/B `[200, 500]`
  ile kırmızı olur — bu da GERÇEK bir bulgu demektir (kaybeden teslim 500 alır, olay satırı kısa süre "error" kalabilir; Paddle yeniden
  dener ve düzelir — zararsız ama test beklentisi o zaman `[200, 200|500]` + "sonunda processed" olarak gevşetilmeli).
- Paddle belgeleri bu ortamdan doğrudan açılamadı (vekil 403); bulgular arama özetlerindeki alıntılara dayanıyor. §4 #6 (para birimi
  değişimi), #2 (ters ibrazda abonelik durumu) ve #8 (yenilemede `subscription_id`) belgeyle / sandbox'la kesinleştirilmeli.
- Koşturma (TAM SUIT İLE AYNI ANDA DEĞİL — PG 5433 sıfırlanır): dört dosya `tests/integration/`e kopyalanır →
  `npx vitest run tests/integration/paddle-webhook-concurrent-same-event.test.ts tests/integration/paddle-webhook-same-transaction-two-events.test.ts tests/integration/paddle-webhook-invoice-p2002.test.ts tests/integration/billing-consent-concurrent.test.ts`
  → sonra `npm run typecheck`, `npm run lint`, tam `npm test`, ve §2'deki mutasyonlar `scripts/mutation-run.mjs` ile (M0 kontrol koşusu dahil).
