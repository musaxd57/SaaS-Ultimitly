# Codex 10-21 düzeltmeleri — Opus sert inceleme (salt-okuma)

Hedef: worktree `wt-dev` (dal night-dev), commit'ler `3aad87ac` (Codex 10-21) + `d2f88eb2` (Haiku bulguları) + `50781bbf` (test kurulumu).
Test / vitest koşulmadı (PG 5433 meşgul); bütün hükümler kod okumasıyla.

---

## B1 — [P2, emin] "Ödenmiş" tespiti TEK SEFERLİK: ikinci denemede yeni Paddle işlemi açılıyor (çift tahsilat penceresi geri açılıyor)

- `src/lib/billing/checkout-intent.ts:148-150` (reuse yolu) ve `:208-216` (`completeCheckoutIntent`, webhook).
- Girdi: Sekme A T1'i öder (Paddle'da `completed`). İstemcinin `checkout.completed` → `/api/billing/checkout-pending` çağrısı GELMEDİ
  (sekme kapandı / successUrl yönlendirmesi olaydan önce / ağ hatası). `subscription.created` webhook'u henüz yok.
  Sekme B "Satın al" → niyet açık, `transactionStatus(T1)="completed"` → niyet `completed`, `openKey=NULL`, cevap "ödemeniz işleniyor".
  Kullanıcı B'de BİR KEZ DAHA tıklar → `closeStale` boş, `create(opening)` başarılı (openKey boşaldı) → `createTransaction` → **T2**
  döner → ikinci ödeme ekranı açılır. Aynı şey `transaction.completed` webhook'u `subscription.created`'dan ÖNCE gelirse de olur
  (Paddle olay sırası garanti değil): `completeCheckoutIntent` niyeti kapatır, abonelik satırı henüz yok → consent rotasındaki
  "canlı abonelik" kontrolü geçer → T2.
- Yanlış sonuç: ödeme olduğu SUNUCUDA bilindiği hâlde ikinci abonelik (iki tahsilat, ikinci abonelik birincinin `providerRef`'ini ezer).
  Kod yorumu ("ödenmiş işlem varken yeni ekran yok") yalnız tek isteklik doğru; kilit kalıcı değil. `checkoutPendingActive` kilidi
  yalnız İSTEMCİ yazar (`api/billing/checkout-pending`), sunucu tarafı hiçbir yol yazmıyor (`grep markCheckoutPending`).
- Öneri: ödenmiş tespit edildiğinde (reuse `paid` dalı, `closeStale` `completed` dalı ve `completeCheckoutIntent`) niyetin
  `organizationId` + `consentId`'siyle sunucuda `markCheckoutPending` yaz (abonelik webhook'u zaten `clearCheckoutPending` yapıyor);
  ya da `openOrReuse` içinde son `CHECKOUT_PENDING_MS` içinde `completed` olmuş ve abonelik satırı henüz yazılmamış niyeti "işleniyor"
  diye engelle. Test: paid → ikinci çağrı da "paid/işleniyor" ve Paddle POST sayısı 1; transaction.completed webhook'u abonelikten önce →
  yeni onay 400.

## B2 — [P2, emin] İptal edilemeyen / Paddle'da bulunamayan işlem niyeti SONSUZA kadar açık tutar; anahtar kapalıyken bile işletme ödeme açamaz

- `src/lib/billing/checkout-intent.ts:51-58, 73-77, 99, 147-162` + `src/app/api/billing/consent/route.ts:104-106`.
- `paddleRequest` 2xx dışı her cevapta fırlatır (`src/lib/payments/paddle.ts:288-297`); `transactionStatus` her hatada `null`,
  `cancelOrConfirmClosed` → `false`. 404 `entity_not_found` (ör. sandbox denemesinde açılan `txn_…`, sonra `PADDLE_ENVIRONMENT` /
  anahtar canlıya çevrildi — sandbox denemesi kurucuyla PLANLI; ya da anahtar yetkisi değişti) KALICI hata:
  · süpürge: `status=null`, iptal başarısız → `continue` → niyet `open` kalır, her saat yeniden dener, hiç kapanmaz;
  · aynı paket: `existing.priceId === priceId` → `expiresAt` HİÇ kontrol edilmeden (satır 160) ölü / süresi dolmuş `txn` istemciye
    verilir → Paddle.js ekranı açamaz;
  · farklı paket: her seferinde "Açık bir ödemeniz var" (409);
  · anahtar KAPATILIRSA: `openCheckoutIntentExists` → 409 sonsuza dek — eski yol da kapanır, işletme hiç ödeme yapamaz;
  · 90 gün temizliği yalnız `openKey: null` satırlara bakar → satır hiç silinmez.
- Ayrıca süresi dolmuş niyetin yeniden verilmesi webhook'un 24 sa onay tazeliğini (`consentAcceptable`) aşabilir: niyetin `consentId`'si
  İLK onaydır; Paddle API uzun süre okunamazsa (≥21 sa) yeniden verilen işlem ödenince olay işletmeye bağlanamaz (`unlinked` alarmı,
  müşteri ödedi ama hesap denemede).
- Öneri: (1) `paddleRequest` hata kodunu taşıyan tipli hata fırlatsın; 404 `entity_not_found` → "kapalı" say (niyet `canceled`);
  (2) reuse dalında `expiresAt < now` ise işlem VERİLMESİN ("busy" + operatör alarmı); (3) mutlak üst sınır: `createdAt + 24 sa`
  geçmiş açık niyet kapatılır (`expired_unverified`) + `alertOnTransition` operatör alarmı (o noktada webhook zaten bağlamaz);
  (4) anahtar kapalı yolunda yalnız `expiresAt > now` olan niyet engellesin. Test: Paddle 404 → süpürge niyeti kapatır; anahtar
  kapalı + süresi dolmuş takılı niyet → eski yol açılır (ya da alarm).

  Ek etki: takılı niyet her onay isteğinde `closeStale` içinde 3 Paddle çağrısı (her biri 15 sn zaman aşımı → en kötü ~45 sn) yapar,
  cevap gecikir; süpürgenin `take: 200` işletme listesini takılı işletmeler kalıcı doldurabilir (bugünkü ölçekte teorik).

## B3 — [P3, emin] Yeniden verilen işlemin süresi uzatılmıyor: ikinci sekme ödeme ekranını açtıktan dakikalar sonra süpürge işlemi iptal edebilir

- `src/lib/billing/checkout-intent.ts:160` (reuse `expiresAt`'e dokunmaz) + `:85-100` (süre dolunca iptal).
- Girdi: niyet 10:00'da açıldı (bitiş 13:00). Sekme B 12:58'de aynı paketi ister → T1 verilir; müşteri kart bilgisini girerken 13:xx
  süpürgesi T1'i Paddle'da iptal eder → ödeme "işlem iptal" hatasıyla düşer.
- Çift tahsilat değil, ama ödeme sırasında beklenmedik hata. Öneri: reuse'ta `expiresAt`'i en az (now + 30 dk) olacak şekilde ileri al
  (koşullu `updateMany where status=open`), toplam ömür 24 sa onay tazeliğinin altında kalsın (B2 üst sınırıyla birlikte).

## B4 — [P3, emin] `billed` "ödendi" sayılıyor

- `src/lib/billing/checkout-intent.ts:48` `PAID_STATES = paid · completed · billed`.
- Paddle Billing'de `billed` = fatura kesildi, ödeme BEKLENİYOR (elle tahsilat). Bu akışta otomatik tahsilatlı işlem `billed` olmaz;
  olursa müşteriye "ödemeniz işleniyor" denir ve niyet `completed` diye kapanır (B1'deki tek seferlik yol yüzünden sonraki tıklama yeni
  işlem açar). `past_due` hiçbir kümede değil → "açık / yeniden verilebilir" sayılır ve iptal edilemez → B2 yoluna düşer.
- Öneri: `billed` ve `past_due`'yu ayrı "iptal edilemez, ödenmemiş" sınıfında tut (yeni ekran yok, operatör alarmı); "ödendi" yalnız
  `paid` / `completed`.

## B5 — [P3, olası] Yayın öncesi açık kalmış sekme (eski istemci) niyeti atlar

- `src/components/settings/paddle-plans.tsx` yeni dal yalnız yeni JS'te. Anahtar açıkken bu sürümden ÖNCE yüklenmiş sekme `transactionId`'yi
  yok sayar, `items + customData.consentId` ile Paddle.js'te kendi işlemini açar; aynı anda yeni JS'li sekme sunucunun T1'ini açar →
  iki işlem, iki tahsilat (eski açık). Webhook ikisini de onaydan bağlar.
- Öneri: anahtar açıkken webhook tarafında, `custom_data.consentId`'si bir niyete ait OLMAYAN ve aynı işletmede açık / yeni tamamlanmış
  niyet varken gelen ilk işlem için operatör alarmı; ya da anahtar ilk açılışta eski istemcileri zorla yenile (sürüm başlığı). Düşük
  öncelik — anahtar ayrı bir env değişikliğiyle açılacağı için pencere kısa.

## B6 — [P3, olası] Söz/görev kilit sırası: `createGuestCommitment` "slot" dalı TERS sırada (söz → görev) kilitliyor

- `src/lib/guest-commitments.ts:180-191`: önce `guestCommitment.updateMany({ id: same.id, topic: null })` (söz satırı kilidi), sonra
  `task.updateMany({ id: same.taskId, … })` (görev satırı kilidi). `closeOneStayEnded` (`src/lib/guest-commitments-auto.ts:276-282`),
  `api/tasks/[id]` ve "Yanlış, kaldır" ise görev → söz.
- Girdi: çıkışı geçmiş konuşmada ev sahibi konulu bir söz önerisini onaylar (konusuz açık söze bağlanır) ve aynı anda saatlik konaklama
  kapatması aynı sözü işler → PostgreSQL deadlock; biri `40P01` ile düşer (kapatma satırı sonraki saatte tekrar dener; onay 500).
  Codex düzeltmesi bunu YENİ getirmedi (önceden var), ama "görev → söz tek sıra" iddiası bu dalda tutmuyor.
- Öneri: slot dalında söz güncellemesinden ÖNCE `SELECT … FROM "Task" WHERE id = same.taskId FOR UPDATE`.

## B7 — [P3, emin] KB kopya işlem kaydı "30 gün sonra silinir" ancak aynı işletme yeniden kopyalarsa; hedef kümesi kayda girmiyor

- `src/app/api/kb/[id]/copy/route.ts:104-107`: temizlik yalnız bu rotada, yalnız kimlikli + hedefli yeni bir kopyalamada çalışır; bir daha
  kopyalamayan işletmenin satırları süresiz kalır (zamanlanmış süpürge yok — `scheduled-sync`'te `kbCopyOperation` geçmiyor). Misafir
  verisi yok, KVKK etkisi düşük; ama `tests/unit/data-export-coverage.test.ts` gerekçesi ("30 gün sonra silinir", "sonuç sayıları")
  koda uymuyor (şemada sonuç sayısı alanı yok).
- Aynı kimlik + aynı iz + FARKLI hedef kümesi kabul edilir (yeni daireye de yazar) — istemci yorumu bunu bilinçli istiyor
  (`kb-manager.tsx:319-321`), hata değil; yalnız not.
- Öneri: `sweepCheckoutIntents` yanına saatlik `kbCopyOperation.deleteMany({ createdAt < now-30g })`; gerekçe metnini düzelt.

---

## Kontrol edilip TEMİZ bulunanlar (bulgu değil)

- Kiracı sızıntısı: `openKey` = işletme kimliği, `findUnique({ openKey: session.organizationId })` → başka işletmenin işlemi okunamaz;
  `completeCheckoutIntent` yalnız imzalı webhook'tan, küresel tekil Paddle `txn` kimliğiyle. Temiz.
- "Açılıyor" kiralaması (30 sn): `paddleRequest` zaman aşımı 15 sn; kiralama dolup başkası niyeti `failed` yaparsa geç dönen işlem koşullu
  güncellemede (`status: "opening"`) kaybeder, iptal edilir ve kimliği istemciye HİÇ verilmez → ödenemez. Temiz.
- Webhook sırası "completed önce, open sonra": işlem kimliği istemciye ancak `open` yazıldıktan sonra gider; önce ödeme imkânsız. Temiz.
- `custom_data` alan adları: sunucu `organizationId · consentId · legalVersion` yazar, webhook `custom_data.consentId` okur (`resolveOrgId`,
  `joinConsentChain`). Aynı.
- Anahtar kapalı: tablo boşken ek olarak yalnız bir `count` (consent), bir `updateMany` (webhook, hatası yutulur) ve saatlik boş `findMany`
  (süpürge) — davranış aynı. Anahtar aç-kapa: süpürge anahtardan bağımsız çalışır, normal niyet ≤ 4 sa içinde kapanır (takılı olan → B2).
- Migration 81 / 82: yalnız yeni tablo + dizin + FK (CASCADE); mevcut tabloya kolon yok → dolu tabloda boot riski yok. Hesap silme:
  işletme / onay CASCADE ile gider. KVKK dışa aktarma: iki tablo gerekçeli kapsam dışı (B7'deki metin hatası hariç).
- Söz kapatma (P2 #2): `FOR UPDATE` sonrası okunan durum READ COMMITTED'da son commit'i görür; görev PATCH (`api/tasks/[id]`) görev
  satırını önce günceller → aynı sıra (görev → söz). Silinmiş görevde `cancelCommitmentsForDeletedTask` sözü zaten kapatmış olur →
  `count 0`. Düzeltme doğru (ters sıralı tek yol B6).
- KB kopya: hedefsiz / geçersiz hedefli istek kayıt açmaz; kaynak silinmişse 404 (kayıt açılmadan); eşzamanlı aynı kimlik → biri yaratır,
  öteki okur (aynı iz → devam, farklı iz → 409); `isUniqueViolation` hedef kolonları doğru.

## Doğrulanamayanlar (sandbox'ta kurucuyla bakılmalı — bulgu DEĞİL)

1. **Paddle "default payment link" önkoşulu:** Paddle Billing, otomatik tahsilatlı işlemi API ile (`POST /transactions`) açarken
   panelde varsayılan ödeme bağlantısı ayarlı değilse `transaction_default_checkout_url_not_set` hatası verdiğini hatırlıyorum. Öyleyse
   anahtar açıldığı an her onay 503 ("Ödeme ekranı açılamadı") → ödeme tamamen durur. Sandbox denemesinin İLK maddesi olmalı.
2. Müşterisiz / adressiz açılan işlem `draft` döner (yorumdaki "ready" varsayımı değil); `Checkout.open({ transactionId })` draft'ı kabul
   ettiğini hatırlıyorum — doğrulanmalı. `PATCH status: canceled` yalnız draft / ready'de geçerli.
3. Sunucuda açılan işlemin `custom_data`'sı abonelik oluşunca aboneliğe kopyalanıyor mu (eski yolda Paddle.js `customData` ile aynı
   davranış varsayılıyor) — `subscription.created` olayının `custom_data.consentId` taşıdığı sandbox'ta görülmeli.
4. Demo hesabı: onay rotası sunucuda demo işletmeyi engellemiyor (yalnız ayarlar sayfası gizliyor); demo sıfırlama `CheckoutIntent`'i
   temizlemiyor ("demo'da ödeme ekranı açılmaz" gerekçesi). Demo sahibinin rotaya doğrudan POST atıp atamadığını doğrulamadım.

---

## DURUM (10-21, Claude — kodda doğrulandı, düzeltildi; hepsi `PADDLE_CHECKOUT_INTENT_ENABLED` KAPALI arkasında ya da iç işleyiş)

| Bulgu | Karar | Düzeltme | Test |
|---|---|---|---|
| B1 | doğru | Ödendi SUNUCUDA görülünce (onay yolu, süpürge, işlem webhook'u) "Ödemeniz işleniyor" kilidi sunucuda da yazılır (`markPaidPending`) | `checkout-intent.test.ts` "Opus B1" ×3 |
| B2 | doğru | Paddle 404 → işlem kapalı sayılır; süresi dolmuş + iptal edilemeyen işlem yeniden VERİLMEZ (409); 24 sa mutlak üst sınırda kapanır + operatöre haber (`checkout-intent-unverified-close`); anahtar kapalı yolu yalnız 24 sa'ten genç niyet kilitler | "Opus B2" ×3 |
| B3 | doğru | Yeniden verilen işlemin süresi en az 30 dk ileri alınır | "Opus B3" |
| B4 | doğru | Ödendi yalnız `paid` / `completed`; `billed` / `past_due` → işlem verilmez, yeni ekran yok (409) | "Opus B4" ×2 |
| B5 | doğru, düşük | Kod değişmedi: anahtar açılışında eski sekme penceresi kısa; Railway açılış listesinde not (anahtarı açtıktan sonra açık sekmeler yenilenmeli) | — |
| B6 | doğru (eski) | Sahiplenme dalı önce GÖREVİ kilitler (görev → söz tek sıra) | `commitment-topic.test.ts` "kilit sırası" (NOWAIT kanıtı) |
| B7 | doğru | Saatlik `kb-copy-operation-sweep` (`lib/kb/copy-operation.ts`); dışa aktarma gerekçe metni düzeltildi | `kb-copy-request-id.test.ts` "Opus B7" |

Doğrulanamayanlar (sandbox) 1–4 → `docs/RAILWAY-ACILIS-2026-10-15.md` Paddle sandbox listesine eklendi.
