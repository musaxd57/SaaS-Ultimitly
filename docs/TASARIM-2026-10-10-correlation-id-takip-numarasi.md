# Correlation ID (takip numarası) — kurucu isteği, GOAL BİTTİKTEN SONRA yapılacak

> Kurucu (10-10, 8 ekran görüntüsü — kaynak bir eğitim videosu): "Bu ödeme yerinde böyle bir sistem ekleyelim mi … goal işlerimiz
> bittiğinde ona da bakarız; güzelce açıkla, sonra kendi okuyacağın yere nasıl yapacağını da not al." KOD YAZILMADI. Bu belge (1) kavramı,
> (2) bugün bizde ne olduğunu (kodda ölçüldü), (3) adım adım uygulama planını taşır. Başlamadan önce kurucuya §4'teki sorular sorulur.

## 1. Nedir? (görsellerin özeti)

- **Bir işlem = bir takip numarası.** Kullanıcı bir işlem başlattığında (ör. "Sepete ekle", "Sipariş ver", "Ödeme yap") sunucu o işleme
  rastgele, tahmin edilemez bir kimlik verir (UUID, ör. `7f3a91b2-6d84-4e0c-9a52-18b7d6c403ef`).
- **Zincir boyunca aynı numara.** İşlem bir servisten diğerine geçerken (sipariş → ödeme → ödeme sağlayıcısı) numara isteğin başlığında
  (`X-Correlation-ID`) taşınır; her servis kendi log satırına aynı numarayı yazar.
- **Yeni işlem, yeni numara.** Aynı kullanıcının "sepete ekle" ve "sipariş ver" işlemleri FARKLI numaralar alır; bir işlemin ara adımları
  (sepet isteği alındı → stok kontrolü) AYNI numarayı paylaşır.
- **Loglarda arama.** Aynı anda yüzlerce kullanıcının logu karışık akar (Yasemin, Taha, Uğur…); numarayla arayınca yalnız o işlemin satırları
  kalır: "Sipariş alındı → Ödeme başlatıldı → Ödeme zaman aşımına uğradı".
- **Destek.** Hata yanıtında kullanıcıya numara gösterilir; kullanıcı "Ödeme yapamadım" diye destek talebi açarken numarayı paylaşır; destek
  ekranı numarayla tam hata kaydını bulur ("Ödeme sağlayıcısı yanıt vermedi — 10 sn zaman aşımı, POST /v1/payments").

İdempotency ile farkı: idempotency anahtarı "aynı isteği iki kez UYGULAMA" içindir (etkiyi tekler); correlation ID "bu işlemin İZİNİ
bul" içindir (etkiye dokunmaz, yalnız iz bırakır). İkisi birlikte kullanılır.

## 2. Bugün bizde ne var (kodda ölçüldü 10-10)

| Parça | Durum |
|---|---|
| Genel istek takip numarası (her isteğe kimlik + log + yanıt başlığı) | YOK |
| QR misafir mesajı `requestId` (`api/chat/[token]`) | VAR ama bu bir IDEMPOTENCY anahtarı (aynı mesaj iki kez işlenmesin), takip numarası değil |
| Giden mesaj kuyruğu `idempotencyKey` (`lib/outbox`) | İdempotency, takip değil |
| Ödeme zinciri | `consentId` fiilen takip numarası gibi: onay kaydı → Paddle `customData` → webhook → abonelik / fatura. Ama log satırlarında ve hata yanıtlarında yok; kullanıcıya gösterilmiyor |
| Hata bildirimi (`reportError` → Sentry + e-posta) | Bağlam adı var ("paddle-webhook"), işlem numarası yok — "hangi müşterinin hangi denemesi" log içinden çıkarılamıyor |
| Operatör paneli "Operasyon Teşhisi" | Var; numarayla arama yok |

## 3. Nasıl yapılır (adım adım; sıra önemli)

1. **Kimlik üretimi tek yerde — `src/lib/correlation.ts` (yeni, yaprak modül):** `newCorrelationId()` (`crypto.randomUUID()`), biçim
   doğrulayıcı (yalnız UUID biçimi; istemciden gelen değer biçime uymuyorsa YOK sayılıp yenisi üretilir — log zehirleme olmasın), Node
   `AsyncLocalStorage` ile "şu anki işlemin numarası" (`runWithCorrelation(id, fn)`, `currentCorrelationId()`).
2. **Her API isteğine numara:** rota sarmalayıcıları (`lib/route-guard.ts` `withAuth / withManage / withOwner` + anonim rotaların ortak
   sarmalayıcısı) isteği `runWithCorrelation` içinde koşturur; yanıta `X-Correlation-ID` başlığı eklenir. (Next `middleware.ts` edge'de
   koşar, `AsyncLocalStorage` orada yok → numara middleware'de değil sarmalayıcıda üretilir.)
3. **Hata bildirimine otomatik ekle:** `reportError` / `alertOnTransition` mesajına ve Sentry etiketine `currentCorrelationId()` yazılır —
   çağıranların hiçbiri değişmez. Redaksiyon kuralları aynen (numara kişisel veri değildir, ama hiçbir yerde misafir metniyle yan yana
   loglanmaz).
4. **Ödeme zinciri (asıl istenen yer):**
   - Ödeme ekranı açılırken (`api/billing/consent`) numara üretilir, `CheckoutConsent` satırına yazılır (migration: tek nullable kolon) ve
     Paddle `customData`'ya `consentId`'nin yanına konur.
   - Webhook AYRI bir istek olarak gelir — başlık taşınmaz; numarayı `customData`'dan okuyup aynı zinciri sürdürür (abonelik / fatura /
     alarm satırları aynı numarayı taşır). Böylece "onay kaydedildi → ödeme ekranı açıldı → Paddle ödemeyi bildirdi → abonelik yazıldı"
     tek numarayla aranır.
   - "Ödemeniz işleniyor" kilidi (`lib/billing/checkout-pending.ts`, 10-10) ve ikinci abonelik alarmı da numarayı taşır.
   - Paddle'a giden sunucu istekleri (plan değişikliği, portal) numarayı log satırına yazar; Paddle'ın kendi istek kimliği
     (`x-request-id` yanıt başlığı, varsa) yanına kaydedilir — Paddle desteğiyle konuşurken iki taraf aynı işlemi bulur.
5. **Kullanıcıya gösterme (müşteriye giden metin → kurucu onayı):** yalnız beklenmeyen hatada (5xx) sade bir satır: "Bir sorun oluştu.
   Destek ekibimize yazarken bu takip numarasını paylaşın: 7f3a91b2". Kısa biçim (ilk 8 karakter) ekranda, tamamı panoya kopyalanır.
   Teknik ayrıntı GİTMEZ (kurucu 09-23).
6. **Arka plan işleri:** zamanlanmış senkron, giden mesaj kuyruğu, otomatik cevap — her İŞ ÇALIŞMASI ve her MESAJ işlemesi kendi numarasını
   alır (yeni işlem = yeni numara); kuyruğa yazılan satır numarayı taşır, işleyen aynı numarayla loglar.
7. **Destek / operatör ekranı:** "Operasyon Teşhisi"ne numara arama kutusu: numarayla eşleşen onay kaydı, webhook olayları, abonelik /
   fatura satırları, alarm kayıtları listelenir. Kalıcı log deposu yoksa (Railway logları metin araması destekler) ilk dilim yalnız DB
   satırları + Railway log araması bağlantısı.
8. **Testler:** sarmalayıcı her yanıta numara koyar · istemciden gelen bozuk numara yok sayılır · `reportError` numarayı taşır · ödeme
   zincirinde onay → webhook → fatura aynı numarayı taşır (gerçek PG) · iki eşzamanlı istek birbirinin numarasını görmez (AsyncLocalStorage
   sızıntısı yok) · müşteri metninde yalnız sade satır.

## 4. Başlamadan önce kurucuya sorulacaklar

1. Kapsam: yalnız ödeme zinciri mi (en çok istenen), yoksa bütün API + arka plan işleri mi? (Önerim: önce ödeme + hata bildirimi, sonra
   genel.)
2. Kullanıcıya hata ekranında takip numarası gösterilsin mi (müşteriye giden metin)? Biçim: kısa numara + "kopyala" düğmesi.
3. Migration (CheckoutConsent'e tek kolon + isteğe bağlı webhook olayına kolon) kabul mü? (Migration içeren push = taze yedek + onay.)
4. Log deposu: Railway logları yeterli mi, yoksa numarayla aranabilir kalıcı bir log tablosu / harici servis mi? (Maliyet + KVKK saklama
   süresi kararı.)
