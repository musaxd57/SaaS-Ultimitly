# Paddle: "Aboneliği devam ettir" (I4 C) + kartla deneme kapısı (yüksek risk) — tasarım ve sandbox doğrulama listesi (10-17)

Kurucu kararları (10-17, aynen özü):
- **I4:** "şimdi A; sonra KESİNLİKLE C — tıklanınca hemen ödeme alınsın, pakete dönsün."
- **C1:** onay penceresi olsun; "altında çok küçük yazıyla kartınızdan tahsil edilecek gibi".
- **C2:** "direk bütün paketler gözüksün".
- **C3:** kartı hiç alınmamış (deneme bitmiş) hesap: paket seçince ödeme ekranı — "öyle kalsın".
- **Kartla deneme:** "Kartla deneme kapısını yap; yüksek riskte öyle bir durum olsun."
- **Paddle:** "ilk denemede sandbox'ta birlikte doğrulayacağız; Paddle'dan doğrulamamız gereken her şeyi doğrulayalım."

İkisi de anahtar KAPALI doğar (`PADDLE_RESUME_ENABLED`, `TRIAL_CARD_GATE_ENABLED`); açma = kurucu + sandbox'ta ilk denemeler birlikte.
Paddle belgeleri bu ortamdan açılamadı → aşağıdaki "Paddle şöyle davranır" cümlelerinin HEPSİ doğrulanacak varsayımdır (listede numaralı).

## 1. Kart güncelleme bağlantısı nedir (kurucu sorusu)
Kart bilgisi bizde hiç durmaz; ilk ödemede Paddle penceresine girilen kart Paddle'da saklanır. "Kart güncelleme" = Paddle'ın kendi güvenli
sayfası: bugün Ayarlar → Faturalandırma → "Aboneliği yönet" ile açılan Paddle müşteri sayfasının "ödeme yöntemini güncelle" bölümü (kodda
`createPortalSession` — `src/lib/payments/paddle.ts`; Paddle'ın aynı oturum yanıtında aboneliğe özel `update_subscription_payment_method`
bağlantısı da var — P4). Yeni sekmede açılır, yeni kart girilir; plan / fiyat / fatura bilgisi DEĞİŞMEZ, yalnız sonraki tahsilatın çekileceği
kart değişir. Bizim tarafta yeni panel yok.

## 2. "Aboneliği devam ettir" (I4 C) — akış
| Durum | Bugün (A) | Sonra (C, anahtar açıkken) |
|---|---|---|
| Duraklatılmış abonelik (`paused`) | "Aboneliği yönet" → Paddle sayfasında devam | Faturalandırma kartında "Aboneliği devam ettir" → BÜTÜN paketler (C2; önceki paketiniz işaretli) → seçilen paket için onay penceresi (C1): büyük yazı "Pro planınız hemen açılır." + altında küçük yazı "₺899 kayıtlı kartınızdan şimdi tahsil edilecek." → Paddle "hemen devam ettir" → erişim ödeme olayıyla açılır |
| Başka paket seçildi | — | Paddle duraklatılmış abonelikte paket değişikliğine izin veriyorsa (P3) devam + paket TEK adım; vermiyorsa önce devam (mevcut paket), sonra bugünkü paket değiştirme penceresi (tutar önizlemeli) |
| Kart reddedildi | — | "Ödeme alınamadı. Kart bilgilerinizi güncelleyin." + kart güncelleme bağlantısı (§1); plan açılmaz |
| İptal edilmiş, dönemi bitmiş abonelik | paket kartları yeni ödeme ekranı açar | AYNI (Paddle iptal edilmiş aboneliği devam ettiremez — P7) |
| Kartı hiç alınmamış (deneme bitti) | paket → ödeme ekranı | AYNI (C3) |

Tutar: onay penceresindeki rakam Paddle'ın fiyat önizlemesinden (vergi dahil, müşterinin ülkesine göre) gelir; okunamazsa pencere açılmaz
(tahmini rakamla para çekilmez). Tekrar güvenliği: bugünkü paket değişikliği ile aynı sınıflandırma — kesin ret (4xx) tekrar denenebilir,
belirsiz sonuç (5xx / zaman aşımı) KÖRLEMESİNE tekrar gönderilmez, Paddle'dan durum okunur; 15 dk "işleniyor" kilidi; denetim kaydı.

## 3. Kartla deneme kapısı (yüksek risk) — akış
- **Ne zaman:** deneme sürerken risk puanı YÜKSEK bantta (≥ 60). Puan operatör listesindeki puanın AYNISI, tek fark: **ağ / IP sinyalleri
  (aynı adres, aynı ağ) bu kapıda SAYILMAZ** — kurucunun onayladığı aydınlatma cümlesi "otomatik karar verilmez" diyor (Q3, pinli). Bugünkü
  sinyallerle yüksek bant: "ilan daha önce başka deneme hesabında kullanıldı" tek başına (60) ya da "aynı posta kutusu başka hesapta" +
  "geçici e-posta" (70).
- **Ne olur:** hesap kapanmaz, deneme süresi silinmez. Otomatik işler (yapay zekâ otomatik cevabı, otomatik mesajlar, yapay zekâ önerisi,
  çeviri, QR yapay zekâsı) deneme bitmiş hesaptaki SINIRLI MODLA aynı şekilde durur — kart eklenene kadar. Panel, mesajlar, elle cevap açık.
- **Müşteri ne görür (öneri, kurucu onayı bekliyor):** bant + faturalandırma kartında: "Denemenize devam etmek için kartınızı ekleyin.
  Deneme süresince ücret alınmaz; deneme bitmeden iptal ederseniz ücret ödemezsiniz." + "Kart ekle" (Paddle ödeme penceresi, deneme süreli
  fiyat).
- **Kart eklenince:** Paddle "trialing" abonelik açar (P1) → webhook yerel satırı Paddle'ın deneme bitişiyle yazar → kapı kalkar, otomatik
  işler anında açılır. Deneme bitince Paddle ilk tahsilatı yapar (P2); başarısızsa bugünkü kural (ek süre yok).
- **Operatör:** riskli deneme listesinde "kart istendi" rozeti; "İşareti kaldır" (ilan istisnası) kartı da kaldırır; "Denemeyi bitir" ayrı.
- **Kalkma:** puan yüksek banttan düşerse (ör. e-posta doğrulandı) kapı saatlik işte kalkar.

### Açık sorular (kartla deneme)
- **KD1 · Aydınlatma cümlesi (otomatik sonuç doğurduğu için ŞART):** öneri — "Ücretsiz deneme sırasında bazı hesap işaretleri (ör. aynı
  ilanın daha önce bir deneme hesabında kullanılmış olması ya da geçici e-posta adresi) görülürse, denemenin devam etmesi için kart bilgisi
  istenebilir; deneme süresince kartınızdan ücret alınmaz. Bu kararın gözden geçirilmesini bize yazarak isteyebilirsiniz." Anahtar bu cümle
  yayınlanmadan açılmaz.
- **KD2 · Kapsam:** sınırlı mod (deneme bitmiş hesapla aynı — önerim, mevcut ve test edilmiş yol) mı, yalnız otomatik gönderim mi?
- **KD3 · Kartla denemenin süresi:** kalan gün kadar mı (ör. 9 gün kaldıysa 9) yoksa karttan itibaren yeniden 14 gün mü? Paddle'da deneme
  süresi fiyata bağlı (P1); kalan güne göre ayarlamak Paddle'ın özel fiyat desteğine bağlı (P5). Önerim: kalan gün (cömert değil, adil).

## 4. Sandbox doğrulama listesi (ilk denemede birlikte; her satır: yap → beklenen → bağlı kod)
| # | Yapılacak | Beklenen (varsayımımız) | Bağlı kod / karar |
|---|---|---|---|
| P1 | Deneme süreli fiyatla ödeme penceresinden kart ekle | Abonelik `trialing`; kart doğrulanır, ücret ÇEKİLMEZ (₺0 ya da sağlayıcı doğrulama işlemi); `current_billing_period.ends_at` = deneme bitişi | webhook `trialing` → `trialEndsAt` = Paddle deneme bitişi |
| P2 | Deneme bitimini sandbox'ta hızlandır / bekle | İlk tahsilat otomatik; `subscription.activated` / `transaction.completed`; durum `active` | `active` olayı `trialEndsAt`ı temizler (bugünkü kod) |
| P2b | Deneme bitiminde kart reddi (sandbox ret kartı) | Durum `past_due`; Paddle yeniden dener | ek süre yok kuralı (`getEntitlement`) |
| P3 | Duraklatılmış abonelikte paket değiştirme (PATCH items) | Paddle reddeder mi kabul mü eder? | devam + paket tek adım mı iki adım mı (§2) |
| P4 | Müşteri portalı oturumu | `urls.subscriptions[].update_subscription_payment_method` bağlantısı dönüyor mu | kart reddi metnindeki bağlantı |
| P5 | Ödeme penceresinde katalog dışı (özel) fiyatla `trial_period` | Paddle kabul ediyor mu (kalan güne göre deneme) | KD3 |
| P6 | Duraklatılmış aboneliği `resume` (`effective_from: immediately`, `on_resume: start_new_billing_period` — alan adı doğrulanacak) | Yeni dönem başlar, kayıtlı karttan HEMEN tahsil; olay sırası (`subscription.resumed` → `transaction.completed` → `subscription.updated`) | devam ettir; erişim olayla açılır |
| P6b | `resume` sırasında kart reddi | İstek hata mı döner (`subscription_payment_declined`?) yoksa abonelik `past_due` mu olur? | kart reddi metni + yeniden deneme |
| P6c | `resume` iki kez (çift tık / yeniden deneme) | İkincisi reddedilir mi (zaten aktif), ikinci tahsilat OLMAZ | tekrar güvenliği |
| P7 | İptal edilmiş + dönemi bitmiş abonelikte `resume` | Reddedilir | C3 / yeni ödeme ekranı |
| P8 🚨 ENGELLEYİCİ | Fiyat önizlemesi (`/pricing-preview`, müşteri kimliğiyle) — Opus 10-17 A1: istekte aboneliğin adresi / indirimi / diğer kalemleri yok; okunan alan `details.totals.grand_total` belgeden doğrulanamadı | Vergi dahil tutar = `resume` sonrası GERÇEK tahsilat (`transaction.completed` `grand_total`) — eşit değilse onay kaynağı aboneliğin kendi kaydına (`recurring_transaction_details` / adresli `transactions/preview`) taşınır; bu madde kanıtlanmadan `PADDLE_RESUME_ENABLED` AÇILMAZ | onay penceresindeki rakam (kod alan yoksa pencereyi açmaz — para riski yok, özellik çalışmaz) |
| P9 | Kart güncelleme sonrası `past_due` abonelik | Paddle bekleyen işlemi yeniden dener → `active` | "Aboneliği yönet" yönlendirmesi |
| P10 | Webhook olay sırası karışık gelirse (eski olay sonra) | Sıra koruması (`lastEventAt`) eski olayı yazmaz | mevcut koruma |
| P11 | Duraklatma planlanmış (`scheduled_change.action = pause`) abonelikte devam | Planlanmış duraklatma kaldırılabiliyor mu | portaldan duraklatma akışı |
| P12 | İade (sandbox) | `adjustment` olayları; fatura satırı | muhasebe kaydı (ayrı) |
| P13 | Yıllık fiyatla devam ettir | Yıllık tutar tahsil, dönem 1 yıl | yıllık env haritası |
| P14 | Para birimi (TRY) + Türkiye vergi | Tutar ve para birimi ödeme ekranıyla aynı | biçimlendirme |

Sonuçlar bu tabloya işlenir; varsayımı tutmayan her satır için kod düzeltilir ve testi güncellenir (para akışı — kurucuyla birlikte).

### Sandbox sonuçları (Chrome'daki Claude, kayıt sayfası https://claude.ai/artifact/8ocDrGZEs26keFm3aEDLGv — 10-17 akşam)
- **D1 ✅ (belge):** `effective_from: "immediately"` (atlanırsa varsayılan) + `on_resume: "start_new_billing_period"` (varsayılan; "yeni dönemin
  tamamı hemen tahsil edilir") | `continue_existing_billing_period`. Yalnız `paused` devam eder; `canceled` edemez. 🚨 Tahsilat başarısızsa abonelik
  `past_due` olur — istek hata DÖNMEZ (ret kodu resume için belgelenmemiş) → kod: yanıttaki durum `past_due` ise başarı denmez, 402 + kart güncelleme.
- **D2 🚨 (belge) → kod düzeltildi:** `/pricing-preview` yanıtında `details.totals.grand_total` YOK; `details` yalnız `line_items` taşır, vergi DAHİL
  tutar `line_items[].totals.total` (indirim + vergi sonrası, en küçük birimde tam sayı metni). Eski kod olmayan alanı okuyordu → anahtar açılsaydı onay
  penceresi hiç açılmazdı (para riski yoktu). Şimdi satır toplamı (katı biçim) + aboneliğin `address_id`si önizlemeye gider (P8 hâlâ ENGELLEYİCİ:
  gerçek tahsilatla eşitlik P6'da ölçülecek).
- **D3 ✅ (belge):** abonelik önizlemesinde `immediate_transaction.details.totals.grand_total` (null olabilir) + `recurring_transaction_details.totals.grand_total`
  (zorunlu) var. **D5 ✅ (belge, tur 3):** GET `/subscriptions/{id}` `include=recurring_transaction_details` destekliyor (alan yalnız include ile
  döner) → Opus PAD-A düzeltmesi (devam tutarı aboneliğin KENDİ tekrarlayan önizlemesinden, `subscriptionRecurringTotal`) belgeyle birebir;
  ek kod değişikliği gerekmedi. **D4 ✅:** işlemde `details.totals.grand_total` + `currency_code`.
- **P5 ✅ (belge):** katalog dışı fiyatta `trial_period` (yinelenen fiyat şart). **P7 kısmi:** iptal edilmiş abonelikte devam / duraklat seçeneği
  yok. **P13 kısmi (tur 2):** yıllık TEST fiyatı TRY 8.990 vergi dahil önizleme. **P2 (belge, tur 2):** `/subscriptions/{id}/activate` deneme
  aboneliğini hemen faturalar — denenmedi.
- **P0 ✅ (tur 3):** ödeme sayfası engeli kalktı — Paddle'ın KENDİ barındırdığı ödeme sayfası (Settings → Payments → Hosted checkouts,
  `sandbox-pay.paddle.io/hsc_…`); "Default payment link" ayarı DEĞİŞMEDİ. P1 / P3 / P4 / P6 / P6b / P8 / P9 / P11 / P12 / P14 bu sayfayla tur 3
  devamında (kartı kurucu girer); **P8 hâlâ `PADDLE_RESUME_ENABLED` için ENGELLEYİCİ**. P10 (simülasyon) bilinçli denenmedi (bildirim hedefine istek atar).
- **Tur 3 sonucu (10-17 gece; 16 geçti · 0 kaldı · 0 engellendi · 6 denenmedi):**
  - **P1 ✅** deneme aboneliği `trialing`, ilk işlem TRY 0.00, dönem 17–31 Eki; deneme sürerken panel duraklatmaya İZİN VERMEZ.
  - **P2 ✅** "End trial & bill now" → hemen `active`, işlem TRY 899.00 (749.17 + %20 vergi 149.83); sonraki ödeme 17 Kas TRY 899.00. Zamanlayıcıyla
    kendiliğinden biten denemenin tahsilatı ayrıca denenmedi (sandbox'ta zaman ileri alınamıyor).
  - **P8 ✅ tutar:** duraklatmadan önceki "sonraki ödeme" (tekrarlayan tutar, vergi dahil 899.00) = devam sonrası GERÇEK işlem 899.00 = katalog → onay
    penceresinin rakam kaynağı (`subscriptionRecurringTotal`) doğru. 🚨 **YENİ ENGEL — çifte tahsilat:** panel saatiyle 6:05'te 899 çekilmişken 6:06'da hemen
    duraklat → devam ettir (panel yalnız "hemen + yeni dönem" sunar = bizim kodun `start_new_billing_period`'ı) bir tam 899 daha çekti, iade / kredi
    yok. Ödenmiş dönem sürerken devam = yeniden tam tahsilat. Karar `KURUCU-SORULARI.md` §S **SG3** (öneri: ödenmiş dönem sürüyorsa para çekme —
    `continue_existing_billing_period`, API'de doğrulanana kadar o durumda düğme yerine "bize yazın"). SG3 kodlanıp sınanmadan anahtar AÇILMAZ.
    Kayıt sayfasından ek: duraklatılmış abonelikte panel dönemi (17 Eki–17 Kas) göstermeye DEVAM ediyor, "Next payment" kayboluyor, "Last payment
    Completed TRY 899.00" kalıyor → "ödenmiş dönem sürüyor mu" kararı aboneliğin `current_billing_period.ends_at` alanından okunabilir (API
    yanıtında duraklatılmışken dolu olduğu ayrıca doğrulanacak; boşsa son tamamlanan işlemin `billing_period.ends_at`'i). Duraklatma seçenekleri:
    "Now" ve "At the end of the current billing period"; "Automatically resume" kapalı varsayılan.
  - **P3 ✅** duraklatılmış abonelikte "Edit subscription" / "Edit billing date" YOK → paket değiştirme sunulmuyor → devam + paket İKİ adım kalır (§2).
  - **P6c ✅** etkin abonelikte ikinci "Resume" yok (kodda ayrıca canlı durum okuması + tek kullanımlık belirteç + kilit). **P7 ✅** iptal edilmiş
    abonelikte Actions menüsü hiç yok. **P11 ✅** dönem sonunda duraklatma planlanıp "Don't pause subscription" ile kaldırılabiliyor.
  - **P14 kısmi ✅** ödeme sayfası rakamları işlem rakamlarıyla aynı (normal bağlantıdan ödenmediği için sınırlı).
  - Denenmedi: P4 / P6b / P9 (ret kartı, kurucu kararıyla atlandı) · P10 (elle sınanamıyor) · P12 (iade) · P13 (yıllık tahsilat). Olay adlarının
    SIRASI panelden okunamadı (kartlarda yazmıyor) → sıra koruması (`lastEventAt`) kod testleriyle kalır.
  - Temizlik: test aboneliği iptal edildi; TEST hosted checkout, iki TEST fiyatı ve TEST müşterisi duruyor; varsayılan ödeme bağlantısı, kayıtlı kart,
    webhook ve vergi ayarlarına DOKUNULMADI.

## 5. Dilim sonu denetimleri (10-17)
- Haiku (devam ettir 11 + kartla deneme / operatör 12 bulgu) ve Opus (P0 yok · P1 A1 · P2 A2, A3, C2–C4, F1) bulguları kodda işlendi; A1 → P8
  engelleyici, C2 → KD4, C3 → KD1, C4 → KD3 (kurucu soruları, `KURUCU-SORULARI.md` §S). Mutasyon 28/29 (+1 gerekçeli eşdeğer: G-exempt).
- Deneme hatırlatma süzgeci `provider: "trial"`: "deneme" durumundaki abonelik satırı yalnız iki yerden yazılır (kayıt / operatör → `trial`,
  webhook → `paddle`) — başka sağlayıcı etkilenmez (kodda doğrulandı). Railway açılınca yine de tek sorguyla bakılır:
  `SELECT provider, count(*) FROM "Subscription" WHERE status='trialing' GROUP BY 1`.

