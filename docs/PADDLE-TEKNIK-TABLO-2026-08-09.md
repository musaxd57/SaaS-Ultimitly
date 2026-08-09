# Paddle / para yolu — teknik tablo (2026-08-09)

> **Bu belge bir KARAR BELGESİDİR.** Codex'in kuralı: *"Paddle kararlarına geçmeden önce teknik
> tabloyu çıkarabilir; fakat `paused` müşteriye premium verilsin mi veya ödeme uzlaşmasında hangi
> plan otorite olsun gibi TİCARİ SONUCU OLAN yerde seçenekleri açıklaması mantıklı."*
>
> Aşağıda üç bölüm var: **(A) uygulandı** (para davranışını değiştirmeyen görünürlük işleri),
> **(B) ticari karar bekliyor** (ürün sahibinin girdisi olmadan doğru cevabı yok),
> **(C) mühendislik ama riskli** (uygulanabilir, ama ordering/sahiplik semantiği taşıyor).
>
> Her madde KODDAN doğrulandı; dosya:satır referansları gerçek.

---

## A. UYGULANDI — para davranışı DEĞİŞMEDİ, yalnız görünürlük

### A1. Geçersiz webhook imzası artık alarm veriyor

**Neydi:** `webhooks/paddle/route.ts` — EKSİK anahtar dalı (`paddle-webhook-dormant`) `reportError`
çağırıyordu, **YANLIŞ anahtar dalı çağırmıyordu**. Asimetri tersti: daha sinsi olan ikincisi.

**Neden önemli:** `PADDLE_WEBHOOK_SECRET` bir rotasyon/yazım hatasıyla yanlışsa her olay 401 alır,
Paddle **sonlu** sayıda yeniden dener ve pes eder → olay **kalıcı** kaybolur. İki yönde de sessiz:

| Yön | Sonuç |
|---|---|
| `subscription.canceled` kaybolur | iptal etmiş org **sonsuza kadar premium** kalır |
| `subscription.updated` kaybolur | ödeyen müşterinin yükseltmesi `planCode`'a **hiç ulaşmaz** |

**Ne yapıldı:** 401 **aynen** 401 kaldı; `verifyPaddleSignature`e dokunulmadı. Eklenen tek şey
alarm — ve **yalnız "şekli doğru ama doğrulanmıyor"** hâlinde (`ts=<10+ hane>;h1=<64 hex>`).
Sıradan internet taraması bu şekli üretmez; anahtar uyuşmazlığı DAİMA üretir. Ham gövde alarma
girmez (payload müşteri adı/e-postası/adresi taşır). Üç mutasyon kırmızı.

### A2. Plan değişikliğinin "hızlı dal"ı artık denetim izi bırakıyor

**Neydi:** `billing/plan-change/route.ts` — `alreadyOn === r.priceId` dalı `writeAudit`ten **önce**
dönüyordu. Yani **para rotasında**, müşteriye "başarılı" denen bir sonuç hiçbir iz bırakmadan
geçiyordu. Kardeş "ambiguous → reconciled" dalı aşağı düşüp audit yazıyor; asimetri kazaraydı.

**Ne yapıldı:** aynı kayıt bu dalda da yazılıyor, `noop: true` ile (Paddle'a istek gönderilmedi —
"already applied olanı yeniden PATCH etme" kuralı korunuyor). Mutasyon kırmızı.

---

## B. TİCARİ KARAR BEKLİYOR — senin girdin olmadan doğru cevabı yok

### B1. `paused` müşteriye 14 gün premium veriliyor. Doğru mu?

**Bugünkü zincir (kod-doğrulandı):**

```
Paddle "paused"  →  paddle.ts:164   paddleStatusToLocal → "past_due"
                 →  subscription.ts:31  ACTIVE_STATUSES = {active, trialing, grandfathered} → DEĞİL
                 →  subscription.ts:126 past_due dalı → PAST_DUE_GRACE_DAYS (varsayılan 14) grace
                 →  webhooks/paddle/route.ts:199  pastDueSince o anda damgalanır
                 =  PREMIUM 14 GÜN DAHA AÇIK
```

**Sorun bir tutarsızlık:** `paddle.ts`'in kendi yorumu *"Never gift premium access on an
unrecognized value"* diyor, ama uyguladığı dal tam da onu yapıyor. Grace penceresi **kart
arızası** (istemsiz) için tasarlandı; `paused` ise **iradi** bir durdurma. Aynı kova, iki farklı
niyet.

| Seçenek | Sonuç | Risk |
|---|---|---|
| **(a) Bugünkü hâl kalsın** | Duraklatan müşteri 14 gün daha kullanır | Küçük gelir sızıntısı; "iptal edeyim de 14 gün bedava" öğrenilebilir |
| **(b) `paused` ayrı eşlensin, grace YOK** | Duraklatma anında ücretsiz sürüme düşer | Paddle'ın `paused`'u bazı akışlarda geçici olabilir (kart güncelleme sırasında) → ödeyen müşteriyi anlık kesebilir |
| **(c) `paused` ayrı + KISA grace (ör. 3 gün)** | Geçici duraklamalar korunur, uzun süreli sızıntı kapanır | Yeni bir sabit; `pastDueSince` ile ayrı bir çapa gerekir |
| **(d) TANINMAYAN durum ayrı** — `paused` (b/c), bilinmeyen değer grace'siz | Yorumun iddiası koda döner | En temizi, en çok kod |

**Önerim: (c) + (d).** Gerekçe: `paused` gerçekten geçici olabiliyor, ama 14 gün "geçici" değil;
**tanınmayan** bir değere ise grace vermek savunulamaz (Paddle yarın yeni bir durum adı eklerse
onu ücretsiz premium'a çeviriyoruz). ⚠️ **Bu bir gelir/erişim kararıdır → uygulanmadı.**

### B2. Ödeme uzlaşmasında hangi plan OTORİTE?

**Bugünkü hâl:** `plan-change` rotası **yerel `planCode`'u HİÇ yazmıyor** (kod-doğrulandı: dosyada
`planCode` yalnız istekten okunuyor ve audit'e yazılıyor). Yerel plan **yalnız webhook** ile
güncelleniyor. Yani Paddle otorite, taşıyıcı webhook.

**Boşluk:** rota Paddle'ı **doğrudan okuyup** hedefte olduğunu gördüğü hâlde (`reconciled` dalları)
o bilgiyi yerele yazmıyor. Webhook gelmezse (teslimat arızası, A1'deki anahtar uyuşmazlığı) org
**kalıcı olarak** eski planda kalır:

> Müşteri ₺1.699 İşletme ödedi, yerel `planCode` `"pro"` → `canAddProperty` **7 dairede**
> reddediyor. Tekrar denemek sonsuz döngü: önizleme başarılı, uygulama "başarılı" diyor,
> hiçbir şey değişmiyor.

| Seçenek | Sonuç | Risk |
|---|---|---|
| **(a) Bugünkü hâl** | Tek otorite webhook — basit | Webhook kaybı = kalıcı yanlış yetki, sessiz |
| **(b) Rota da yazsın** (Paddle'dan OKUDUĞU değeri) | Kendi kendini onaran akış | 🚨 **Ordering:** webhook'un `occurred_at` vetosu var, rotanın yok → geç gelen rota yazması taze webhook yazmasını EZEBİLİR |
| **(c) Rota yazsın + AYNI ordering guard** | (b)'nin doğru hâli | Daha çok kod; `lastEventAt` çapasını rotadan da yönetmek gerekir |
| **(d) Ayrı bir drift dedektörü** (periyodik Paddle↔yerel karşılaştırma) | Tüm sapmaları yakalar, tek yazma noktası korunur | Yeni bir zamanlanmış iş + Paddle API kotası |

**Önerim: (c).** Rota Paddle'ı **az önce okumuş** durumda, yani elindeki bilgi webhook'unkiyle aynı
kaynaktan ve daha taze; tek şart ordering guard'ın kopyalanması. (d) daha kapsamlı ama bugünkü tek
müşteri ölçeğinde fazla. ⚠️ **Para hot-path'inde ordering semantiği → uygulanmadı.**

---

## C. MÜHENDİSLİK AMA RİSKLİ — uygulanabilir, onay ister

### C1. `applyTransactionEvent` fiyat eşleşmesini atlıyor

`webhooks/paddle/route.ts:352` → `resolveOrgId(data, null, occurredAt)` — ikinci argüman `null`,
yani `:129`'daki fiyat çapraz-kontrolü **tüm transaction olaylarında** devre dışı. Kardeş çağrı
(`:137`) `eventPriceIdFromData(data)` geçiriyor.

**Etki DÜŞÜK:** yetkilendirme ayrı yoldan (subscription olayı + fiyat kontrolü) belirleniyor;
etkilenen yalnız `Invoice` kaydının hangi org'a yazıldığı. **Ama** `Invoice` KVKK ihracatında ve
10 yıllık saklama yükümlülüğünde → yanlış org'a yazılmış bir fatura satırı ucuz bir hata değil.
*Uygulanmadı: `resolveOrgId`in fiyat dalının transaction payload'ında hangi alanı okuyacağı
doğrulanmalı (gerçek payload görülmeden tahminle yazılmaz).*

### C2. İkinci abonelik penceresi

`route.ts:306-313` — org'un `@unique` Subscription satırı, farklı `providerRef` taşıyan yeni bir
olayla **koşulsuz** eziliyor. Sonuç: eski abonelik Paddle'da sessizce faturalanmaya devam eder ve
portal yalnız güncel `providerRef`'i yönettiği için müşteri onu **kendi kendine iptal edemez**.
*Uygulanmadı: doğru davranış "eskiyi iptal et" mi "yeniyi reddet" mi — bu da ticari bir karar
(çift tahsilat riski vs. yetki kaybı riski).*

### C3. `PADDLE_WEBHOOK_SECRET` hiçbir boot kapısında yok

`scripts/verify-env.mjs` onu doğrulamıyor. A1 artık **çalışma zamanında** alarm veriyor, yani en
sinsi hâl kapandı; boot kapısı eklemek deploy'u bloklama riski taşıdığı için ayrı karar.

---

## Bugün CANLIDA risk var mı?

**Hayır — ama sebebi mimari değil, ölçek.** Tek gerçek ödeyen müşteri kurucunun kendi org'u ve
kurucu `PRIMARY_ORG_ID` muafiyetiyle zaten paywall'lanmıyor. B1/B2'nin ikisi de **ikinci ödeyen
müşteriyle birlikte** gerçek olur. Sıra bu yüzden: **B2 → B1 → C2**.
