# TASARIM: Çoklu takvim (daireler satırda, tarihler üstte), 2026-10-29

**Durum:** Bu belge yalnız tasarımdır, kod yazılmadı. Kurucuya sorulacak 8 soru §15'te.

**Kaynak:** Kurucu talimatı 10-29 gece (`docs/INCELEME-2026-10-28-gece-dongusu.md:151-154`):
- Ölçüm dört parçaya ayrılacak: sunucu bekleme, aktarım, çizim, etkileşime hazır.
- Tekrarlar kaldırılacak.
- Hiçbir rezervasyon, giriş/çıkış hareketi ya da "diğer kayıtlar" sayısı saklanmayacak.
- Yüklenmemiş bir tarih asla boş ya da müsait görünmeyecek.
- "1 aylık kalmıyacak, bütün daireler tam Airbnb takvim görünümü gibi: daireler yatay, üstte tarih, giren müşterilerin kaldığı gün adedi belli olacak."

---

## 0. Kısa karar özeti

| Konu | Öneri |
|---|---|
| Görünüm | Tek tablo. Her daire bir satır, her tarih iki yarım sütun (sabah ve öğleden sonra). Konaklama, giriş günü öğleden sonra başlayıp çıkış günü sabah biten tek bir çubuktur. Çubukta ad ve "N gece" yazar. |
| Tekrar | HTML'de tek görünüm olur. Bugünkü `md:hidden` ile `hidden md:block` çifti kalkar. Liste görünümü yalnız seçildiğinde (`?gorunum=liste`) ve yalnız o çizilir. |
| Varsayılan aralık | 35 gün: bugün −3'ten başlar. Oklar 14 gün kaydırır. Ay menüsü ayın 1'ine atlar. `?month=` adresi çalışmaya devam eder. |
| Veri | Sunucu bir pencerelik veriyi tek sorguda okur. Pencere sabit 35 gündür, satır tavanı vardır. Gün özeti fark dizileriyle hesaplanır (O(R+P·D)). Bugünkü hesap O(R×D). |
| "Diğer kayıtlar" | Hiçbir çubuk gizlenmez. Her tarihin özet satırında kesin giriş, çıkış ve dolu sayısı vardır. Filtre dışında kalanlar ve iptaller ayrı birer çip olarak sayılır. |
| Yüklenmemiş tarih | Saf kütüphanede bir değişmez olarak tutulur: yüklenen aralığın dışındaki her hücre ve her özet "bilgi yok" (taralı) olur. "Boş" sınıfı yalnız yüklenen aralıkta üretilebilir. Testle pinlenir. |
| Ayrıntı | Çubuğa tıklanınca çekmece açılır ve küçük bir GET isteğiyle konaklama ayrıntısını getirir. Gün özetine tıklanınca o günün listesi DOM'daki çubuklardan kurulur, ek veri gönderilmez. |
| Kod dağılımı | Saf yerleşim kütüphanesi + sunucu sayfası + küçük istemci adası. Izgara bileşeni yalnız serileştirilebilir model alır, böylece istemciye taşınması tek satırdır (ölçüm kolu C2). |
| Geçiş | Yeni ekran `CALENDAR_TIMELINE_ENABLED` bayrağı arkasında yapılır. Eski ve yeni aynı derlemede ölçülür. Kurucu onaylarsa bayrak ve eski kod silinir. |

---

## 1. Bağlayıcı kurallar (tasarımın uyduğu)

- **"Müsait" denmez.** "müsait / kiralanabilir" yazılmaz. En güçlü ifade "bağlı takvimlerinizde boş"; kesinlik yoksa tek bir dipnot yazılır (`docs/claude/kalici-urun-kararlari.md:230-231`, metin örneği `src/modules/availability/stay-edges.ts:122-124,171`).
  - Boş hücrenin açıklaması bu yüzden: **"Kayıtlı rezervasyon yok"**.
- **Arayüzde PMS adı geçmez** (`docs/claude/kalici-urun-kararlari.md:234`).
- **İki kaynağın kaydı birleştirilmez** (değişmez 6; `src/modules/availability/conflicts.ts:13-15`).
- **Doluluk gece başına sayılır** (`docs/claude/kalici-kararlar.md:509`).
- **Kurucunun reddettikleri tekrar önerilmez:** sidebar grupları, yatay sekme şeridi, 0,95 zoom (`docs/claude/kalici-kararlar.md:509-510`).
- **Para gösterilmez.** `totalAmount*` ve `currency` okunmaz (`prisma/schema.prisma:471-479`; CLAUDE.md "V2 para etkisi" pini).
- **Tek tarih kuralı:** gün daima `calendarDateOf` ile bulunur (`src/modules/availability/core.ts:78-84`).
- **Gece semantiği:** gece yarı açık aralıktır, [giriş, çıkış). Aynı gün devir çakışma sayılmaz (`core.ts:11-14`).
- **Sayfa kapısı:** sayfa `requireManagerSession` ile açılır (`src/lib/auth/manager-page.ts:17-21`, pin `tests/unit/manager-page-gate.test.ts`).
- **Yeni API rotası** üç pinden geçer:
  - org kapsamlı olmalı (`tests/unit/api-route-scoping.test.ts:136-139`),
  - rol kapısı olmalı (`tests/unit/api-route-role-gate.test.ts:6-15`),
  - kiracılar arası davranışsal testi olmalı (`tests/unit/cross-tenant-coverage.test.ts:17`).
- **Yeni `*_ENABLED` anahtarı** Railway açılış belgesinde adıyla geçmeli (`tests/unit/railway-doc-flags.test.ts:26-39`) ve yalnız "1" ile açılmalı (`scripts/env-check.mjs:628` `STRICT_ONE_FLAGS`).
- **Müşteriye giden metin** sade, "siz" hitaplı, teknik sözcüksüz (CLAUDE.md).
- **Sormadan sistem kurulmaz.** Müşterinin gördüğü ve yorum gerektiren her nokta §15'te önce/sonra örneğiyle sorulur.

---

## 2. Bugün ve ölçülmüş taban

### 2.1 Ölçüm

Ölçüm `docs/INCELEME-2026-10-28-gece-dongusu.md:183-195` satırlarında; ham çıktı `scratchpad/perf-out/cal-once.json`, betik `scratchpad/cal-measure.mjs`. Veri demo hesabıdır: 10 daire, 1.504 rezervasyon (`:114`).

| | Normal ağ | Yavaş 3G + 4× işlemci |
|---|---|---|
| Doğrudan açılış: sunucu bekleme | 25 ms | 41 ms |
| Doğrudan açılış: aktarım (HTML 74 KB sıkıştırılmış / 527 KB açık) | 173 ms | 3.291 ms |
| Doğrudan açılış: ilk görüntü / ana içerik | 100 / 400 ms | 1.060 / 3.724 ms |
| Doğrudan açılış: etkileşime hazır (uzun görev toplamı) | 217 ms (0) | 3.645 ms (261 ms) |
| Menüden geçiş: sayfa verisi (54 KB sıkıştırılmış / 251 KB açık), sunucu / aktarım | 10 / 52 ms | 14 / 1.704 ms |
| Menüden geçiş: içerik görünür | 378 ms | 2.101 ms |
| DOM düğümü: toplam / mobil ajanda / masaüstü ızgara | 2.508 / 1.063 / 1.069 | — |

**Sonuç:** Sunucu süresi önemsiz. Süreyi aktarım belirliyor. Ana içeriğin yarısı her ekranda gizli duran ikinci kopya.
- Menüden geçişteki 378 ms'nin büyük kısmı React'in iskelet sonrası ~300 ms bekletmesi (`gece-dongusu.md:117`, HZ1 kanıtı `:162-171`).

### 2.2 Kök nedenler (kodda)

1. **İki görünüm birden çiziliyor.** Mobil ajanda `md:hidden` (`src/app/(app)/calendar/page.tsx:235`), masaüstü ızgara `hidden md:block` (`:290`).
   - Her hareket iki kez yazılıyor: ajanda `:261-278`, ızgara `:327-338`.
   - Izgarada ayrıca `title` var (`:328,334`). Her satırda satır içi SVG ikon var (`:263,272,329,335`).
   - Hepsi sayfa verisinde (RSC) bir kez daha tekrar ediyor.
2. **Hücre başına uzun Tailwind sınıf listeleri** her öğede tekrar ediyor, örnek `:262,311-312,328`.
3. **Doluluk hesabı rezervasyon × gün döngüsü** (`:115-121`).
4. **Sorgular sırayla:** önce org (`:37`), sonra mülk (`:50`), sonra rezervasyon (`:66`). `property.name` birleştirmesi gereksiz (`:83`); adlar zaten `:50-54`'te okunuyor.
5. **İskelet sayfanın şekline uymuyor.**
   - Başlıkta 3 düğme çiziyor (`loading.tsx:30-34`), oysa ay düğmeleri kartın içinde (`page.tsx:215-231`).
   - Telefonda da 7×6 ızgara çiziyor (`loading.tsx:42-46`).

---

## 3. Veri yükleme

### 3.1 Pencere ve adres sözleşmesi

**Sabitler** (saf kütüphanede, `src/lib/calendar/timeline.ts`):

| Sabit | Değer | Anlam |
|---|---|---|
| `WINDOW_DAYS` | 35 | Görünen gün sayısı |
| `LEAD_DAYS` | 3 | Bugünden kaç gün önce başlar |
| `STEP_DAYS` | 14 | Okların kaydırdığı gün |
| `FROM_CLAMP_DAYS` | 1.825 | `from` en çok ±5 yıl uzağa gidebilir (saçma adresleri sınırlar; bugünkü "sınırsız ay" sözleşmesini fiilen korur) |

**Pencere çözümü** `resolveWindow({ from, month, today })` ile yapılır. Sonuç `{ from, to }` yarı açık aralığıdır, `to = from + 35`. Sıra:
1. `?from=YYYY-MM-DD` `parseNightKey` (`core.ts:47-54`) testini geçerse kullanılır, sonra sınırlanır.
2. Yoksa `?month=YYYY-MM` aynı regex testini geçerse (`page.tsx:47`) `from = YYYY-MM-01` olur. 35 gün, 31 günlük ayı da tam kapsar.
   - Bu sayede "Dikkat gerektirenler" bağlantıları değişmeden çalışır: `attention.ts:706,748` ve pinleri `tests/ui/attention-panel.test.tsx:157-178`, `tests/integration/attention-booking-gap.test.ts:64`, `tests/integration/availability-engine.test.ts:196`.
3. Hiçbiri yoksa `from = bugün − 3`. Bugün `todayKey(now, tz)` ile bulunur (`core.ts:86-88`). Sayfadaki kopya `dayKey` (`page.tsx:24-26`) kalkar.

**Diğer parametreler:**
- `?property=<id>` yalnız org'un kendi mülküyse süzgeç olur, değilse yok sayılır (bugünkü gibi, `page.tsx:55`).
- `?gorunum=liste` liste görünümünü seçer (§6).
- Dizi gelen parametrelerde ilk değer alınır (`cancellations/page.tsx:67-69` deseni).

**Gezinme bağlantıları** (`<Link>`, diğer parametreleri korur):
- "‹" önceki 2 hafta: `from − 14`.
- "Bugün": `from` parametresi kaldırılır.
- "›" sonraki 2 hafta: `from + 14`.
- "Ay seçin": JS gerektirmeyen bir `<details>` menüsü. Önceki 6 ve sonraki 12 ay, her biri ayın 1'ine atlar.

### 3.2 Sorgu

Sorgular `src/lib/calendar/load.ts` dosyasında (`server-only`) toplanır:

1. `organization.findUnique({ timezone })` ve ardından `orgTimezone` (`src/lib/timezone.ts:48-50`). Pencere bugüne bağlı olduğu için bu sorgu önce gelir.
2. Ardından `Promise.all`:
   - **a. Mülkler:** `property.findMany({ where: { organizationId }, select: { id, name } })`.
   - **b. Rezervasyonlar:** `reservation.findMany`
     - `where`:
       - `property.organizationId = org`,
       - `status in ["confirmed","completed"]` (bugünkü süzgeç, `page.tsx:70`; bekleyenler için §15-S3),
       - `arrivalDate < startOf(to) + 2g`,
       - `departureDate >= startOf(from) − 2g`.
       - ±2 gün genişletme `load.ts:22-23,90-91` desenindendir.
     - `select`: `id, propertyId, guestName, arrivalDate, departureDate, status, channel, calendarSourceId, sourceReference`. Son ikisi tekilleştirme anahtarı içindir (`src/lib/reports.ts:130,139-147`).
     - Okunmayanlar: `property.name` birleştirmesi, para, telefon, e-posta.
     - `orderBy: [{ arrivalDate: "asc" }, { id: "asc" }]` (eşit zamanlı satırlarda sıra `id` ile kesinleşir; CLAUDE.md dersi).
     - `take: ROWS_PER_PROPERTY(150) × mülk sayısı + 1`. Tavana çarpılırsa `truncated` olur (`load.ts:94,115` deseni).
   - **c. Takvim kaynakları:** `calendarSource.findMany({ where: { property: { organizationId } }, select: { propertyId, lastStatus, lastSyncedAt } })`. `url` / `urlEnc` okunmaz; sırdır (`load.ts:14-16`).
   - **d. İptal sayısı:** `reservation.count({ status: "cancelled", aynı pencere })`. Yalnız sayı (§4.9).
3. Bellekte sırayla:
   - `dedupeBookings` (`reports.ts:150-159`). Değişmez 6 korunur: farklı kaynakların satırları birleşmez.
   - `calendarDateOf` ile kesin süzme. Satır şu durumlarda tutulur:
     - normal konaklama: `giriş < to` ve `çıkış ≥ from`,
     - sıfır gece: giriş [from, to) içinde,
     - ters kayıt: [çıkış, giriş] aralığı pencereyle kesişiyor.

**Neden süzgeçsiz okunuyor:** Süzgeç (`?property=`) bellekte uygulanır. Sorgu hep bütün daireleri okur. 10 dairede bu ucuzdur ve "diğer dairelerde N hareket" sayısını ek sorgusuz verir.

**Sorgu sınırları:**
- Pencere uzunluğunu istemci seçemez (sabit 35 gün).
- `from` sınırlıdır.
- Satır tavanı vardır.
- Sorgu sayısı sabittir: auth'un okumaları + 5.
- Geçmiş ne kadar büyürse büyüsün iş 35 günle sınırlı kalır. Dizinler: `[propertyId, arrivalDate]`, `[propertyId, departureDate]` (`schema.prisma:576-577`).

### 3.3 Önbellek ve önceden getirme

- `dynamic = "force-dynamic"` kalır (`page.tsx:13`).
- İstemci yönlendirici önbelleği 30 sn (`next.config.mjs:207`). 14 günlük adımda geri dönüş önbellekten gelir.
- Komşu pencereyi `prefetch={true}` ile önceden getirmek ayrı bir ölçüm kolu olarak denenir (§14), varsayılan değildir.
  - Tam önceden getirme statik bayatlık süresiyle önbelleğe girebilir; bu yüzden ölçmeden açılmaz.

---

## 4. Yerleşim

### 4.1 Tablo yapısı

Görünüm tek bir yerel `<table>` öğesidir, `table-layout: fixed`.

```
<section aria-labelledby="cal-title">
  <h2 id="cal-title" tabindex="-1">26 Eki – 29 Kas 2026</h2>          ← aralık başlığı (odak hedefi)
  <p class="sr-only" aria-live="polite">26 Ekim – 29 Kasım gösteriliyor</p>
  <div class="lxs-cal-scroll" role="region" aria-label="Takvim" tabindex="0">   ← iki eksende kaydırma kabı
    <table class="lxs-cal" data-cal-window="2026-10-26">
      <caption class="sr-only">Daireler ve tarihler, 26 Ekim – 29 Kasım 2026. Boş hücre: kayıtlı rezervasyon yok.</caption>
      <colgroup><col class="p"> + 2×35 <col class="h"> (hafta sonu / bugün: class="h w" / "h t")</colgroup>
      <thead>
        <tr class="m"> ay etiketleri (colspan = o aydaki gün × 2)
        <tr class="d"><th class="p" scope="col">Daire</th> + gün başına <th scope="col" colspan="2" aria-label="12 Kasım Perşembe">Per<b>12</b></th>
        <tr class="s"><th scope="row" class="p">Özet</th> + gün başına <td colspan="2"><button data-date=…>…</button></td>
      </thead>
      <tbody> daire başına 1..L satır (şerit), ilk satırda <th scope="row" rowspan="L" class="p">
    </table>
  </div>
</section>
```

- **Yapışkan sütun ve başlık:**
  - Daire sütunu: `th.p { position: sticky; left: 0; background: var(--card); z-index: 2 }`.
  - Tarih başlığı ve özet satırı: `thead th, thead td { position: sticky; top: … }`. Sol üst köşe en üst katmanda.
  - Dikey yapışma kabın içinde çalışır. Kabın `overflow:auto` olması onu iki eksende kaydırma kabı yapar.
  - Bu yüzden kaba `max-height: calc(100dvh − üst bölüm)` verilir. 10 satırda çoğu zaman tamamı sığar.
  - iOS Safari'de iki eksenli yapışma denenmeli. Başarısız olursa aynı model `display:grid` + `role="table"` ile çizilir (§16).
- **Bayt bütçesi için kısa sınıflar:** hücreler kısa anlamsal sınıflar alır (`td.f`, `td.u`, `td.x`, `td.s`). Kurallar `src/app/globals.css` içinde `.lxs-cal` kapsamında. Bu, depodaki `lxs-*` geleneğidir (`globals.css:581`).
  - Genişlikler CSS değişkenidir: `--cal-p` (daire sütunu), `--cal-day` (gün). Yarım sütun `calc(var(--cal-day)/2)`.
- **Hücre başına ikon yok.** Giriş ve çıkış işaretleri, uyarı simgesi CSS sözde öğesiyle (mask veya background) yapılır. Satır içi SVG ve hücre başına `title` kalkar.

### 4.2 Yarım gün geometrisi (çubuk aralığı)

**Kurallar:**
- Gün indeksi: `i(k) = nightsBetween(from, k)` (`core.ts:71-73`).
- Yarım sütunlar: gün i için `2i` sabah, `2i+1` öğleden sonra. Toplam `2D` yarım (D = 35).
- Konaklama (giriş anahtarı a, çıkış anahtarı d, `n = nightsBetween(a,d) ≥ 1`):
  - `h0 = 2·i(a) + 1`, giriş günü öğleden sonra başlar.
  - `h1 = 2·i(d) + 1` (hariç), çıkış günü sabahını kapsar.
  - Genişlik `h1 − h0 = 2n` yarım.
- Kırpma:
  - `s = max(h0, 0)`, `e = min(h1, 2D)`.
  - `clipL = h0 < 0` (soldan taşıyor), `clipR = h1 > 2D` (sağdan taşıyor).
  - `e ≤ s` ise çubuk pencerede değildir.
- **Gece etiketi kırpılmaz.** Kırpılmış çubuk da gerçek toplam geceyi yazar.

**Kenar örnekleri:**

| Durum | Sonuç |
|---|---|
| Çıkış = `from` | `e = 1`. İlk günün sabah yarısı çizilir; çıkış görünür. |
| Giriş = `to − 1` | `s = 2D − 1`, tek yarım, `clipR`. |
| Giriş = `to` | Pencerede değil. |
| Aynı daire, aynı gün devir | Çıkanın `h1` değeri girenin `h0` değerine eşittir. Çakışma yoktur, ikisi aynı şeride sığar. |

İki konaklamanın yarım aralıklarının bütün sınırları tek sayıdır. Bu yüzden kesişim uzunluğu 0 ya da ≥2 olur: kesişim ancak ortak bir gece varsa vardır. Motorun gece tanımıyla birebir uyar (`core.ts:382`).

### 4.3 Çubuk içeriği

```html
<td colspan="6" class="s c" >                               ← s: konaklama, c: çakışmada (varsa)
  <button type="button" class="lxs-cal-bar" data-id="…" data-a="2026-11-12" data-d="2026-11-15">
    <span class="n">Ayşe Yılmaz</span><span class="g">3 gece</span>
    <span class="sr-only">, giriş 12 Kasım, çıkış 15 Kasım, Airbnb</span>
  </button>
</td>
```

- **Görünen metin:** ad + "N gece".
  - Ad esnek öğedir ve üç noktayla kısalır; "N gece" `flex:none` olduğu için hep görünür. Kurucunun "kaldığı gün adedi belli olacak" şartı budur.
  - Kap sorgusuyla (`container-type:inline-size`):
    - çubuk 56 px'in altındaysa ad gizlenir, yalnız "3" kalır;
    - 28 px'in altındaysa metin gizlenir; çubuk yine vardır, odaklanabilir ve sayılır.
  - CSS ile gizlenen metin DOM'da kalır, ekran okuyucu okur.
- **Kenar işaretleri:** giriş kenarında yeşil, çıkış kenarında amber çentik (bugünkü renk dili, `page.tsx:262,271`). Kırpılmış kenarda çentik yerine ‹ veya › çizilir; sr metni "takvimin dışında devam ediyor".
- **Renk tek bilgi taşıyıcısı değildir.**
  - Durum dolguyla gösterilir: onaylı düz dolgu, tamamlanmış soluk dolgu.
  - Kanal görsel olarak gösterilmez. Kanal adı sr etiketinde ve çekmecede metin olarak vardır.
- **Kanal adı** tek eşlemeden gelir: `channelLabel` (`src/lib/ui-labels.ts:67-82`). İkinci eşleme `RESERVATION_CHANNEL` (`src/lib/constants.ts:37-44`) farklı yazıyor ("Booking" ile "Booking.com"); takvim ilkini kullanır.
- **Misafir adı saklandığı gibi** (`guestName`) yazılır. Anonimleştirilmiş kayıt "Eski misafir" görünür (bugünkü davranış). iCal satırları için §4.8.

### 4.4 Şeritler, çakışma, aynı konaklamanın iki kaydı

- **Şerit atama** daire başına açgözlü ilk-sığan algoritmayla yapılır:
  - Sıra `(h0 artan, h1 azalan, id artan)`; deterministik.
  - Her konaklama, son çubuğu `≤ h0` olan ilk şeride gider.
  - İlk satır `<th rowspan=L>`. Hiçbir çubuk bir başkasının altında kalmaz.
- **Çakışma** daire başına gece sayacıyla bulunur (fark dizisi). Sayaç ≥2 olan geceler çakışan gecedir; o geceye dokunan çubuklar `c` sınıfı (kırmızı çerçeve) alır.
  - Daire başlığında "Çakışma" çipi çıkar. sr metni: "N gece iki rezervasyon üst üste".
- **Aynı giriş ve çıkış, iki kaynak:** iki kaydın giriş ve çıkışı birebir aynıysa çip metni "Aynı konaklama iki kaynaktan gelmiş olabilir" olur.
  - Bu motorun `possibleDuplicate` ipucuyla aynıdır (`conflicts.ts:14-15,91`).
  - Birleştirme yapılmaz; ikisi de çizilir (bugün de ikisi görünüyor: `tests/integration/calendar-page.test.ts:243-259` deseni).
- **Bilinen fark:** Motor bekleyen ve tanınmayan durumlu kayıtları da işgalci sayar (`core.ts:108-123`). "Dikkat gerektirenler" çakışması bu yüzden takvimde görünmeyen bir bekleyen talepten gelebilir. Karar §15-S3'e bağlı.

### 4.5 Hatalı tarihli kayıtlar (asla düşmez)

Motor sıfır gecelik ve ters kayıtları anomali sayar (`core.ts:364-376`).

| Kayıt | Çizim | Özet sayısı |
|---|---|---|
| Sıfır gece (a = d) | O günün öğleden sonra yarısında tek yarımlık işaret (`k:"anomaly"`). Kırmızı tarama + "!", sr "Tarihleri hatalı kayıt: <ad>, giriş ve çıkış aynı gün". | Giriş ve çıkış sayısına girer (bugünkü gibi, `page.tsx:113-114`). Doluluğa girmez. |
| Ters (d < a) | [d, a] arası taranmış işaret. sr "Tarihleri ters kayıt". | Giriş ve çıkış sayısına girer. Doluluğa girmez. |

Bu kayıtların kapsadığı geceler "boş" değil, **"bilgi yok"** çizilir. Motordaki `anomalous_claim` kuralıyla aynıdır (`core.ts:392`); metin `stay-edges.ts:142`.

### 4.6 Boşluk hücreleri: `f` / `u` / `x`

Çubuk olmayan her yarım sütun bir sınıf alır. Ardışık aynı sınıflı yarımlar birleşir ama **gün sınırında kesilir**. Böylece hücre en çok bir gündür: gün çizgileri korunur, ileride gün seçimi için hedef olur.

| Sınıf | Koşul | Görünüm |
|---|---|---|
| `u` (bilgi yok) | Gece yüklenen aralığın dışında, satır kırpılmış ya da gece anomali gecesi | Tarama + sr "Bilgi yok" |
| `x` (dolgu) | O yarım dairenin **başka bir şeridindeki** bir konaklamaca kaplı | Anlamsız dolgu, metin yok. Asla "boş" denmez. |
| `f` (boş) | Yukarıdakilerin hiçbiri değil | Düz hücre. Anlamı başlıkta ve açıklamada: "Kayıtlı rezervasyon yok". |

- **Hangi gece sayılır:** öğleden sonra yarısı `2i+1` gece i'yi, sabah yarısı `2i` gece i−1'i temsil eder.
- İlk günün sabahı için gece −1'in bilgisi de yüklüdür, çünkü sorgu `çıkış ≥ from` satırlarını getirir (§3.2).
- `x` kuralı kritik: açgözlü şeritte 0. şeridin boşluğu, 1. şeritteki uzun bir konaklamanın gecesi olabilir. Bu yüzden "boş" kararı **daire genelindeki birleşik doluluktan** verilir, şeritten değil.

### 4.7 Özet satırı ("diğer kayıtlar" sayısının yeni karşılığı)

Tarih başlığının hemen altında yapışkan bir satır. Her gün için:
- **giriş N:** bugünkü `page.tsx:113` ile aynı tanım, yani pencere içi giriş günü bu gün olan kayıt sayısı.
- **çıkış N**
- **N/T dolu:** o gece dolu ayrı daire sayısı, `page.tsx:120` ile aynı tanım. T, süzgeç varsa 1, yoksa daire sayısı (`page.tsx:145`).
- Hesap fark dizisiyle yapılır, O(R + P·D).
- Gün bilinmiyorsa (yüklenmemiş, ya da genel kırpma var) üç değer `null` olur ve "—" + sr "Bilgi yok" yazılır. **Asla 0 yazılmaz.**
- Hücre bir `<button data-date>`. Tıklanınca gün sayfası açılır (§7): o günün **bütün** giriş ve çıkışları, ad + daire, eksiksiz liste.
- **Bugünkü "+N diğer"in yerine:** bugün kırpma hücre başına 3'tür (`page.tsx:152-167`). Yeni yerleşimde hiçbir çubuk kırpılmaz. Sayılar kesindir ve testle pinlenir: bütün günlerin giriş toplamı, pencere içi giriş günü olan kayıt sayısına eşittir (§13).
- Telefonda da her günün doluluğu görünür. Bugünkü ajanda sakin günlerin doluluğunu hiç göstermiyor (`page.tsx:172-174`).

### 4.8 iCal satırları ve kapatılmış günler

- **Bugünkü durum:**
  - Her VEVENT bir rezervasyon olur. Ad, etkinlik başlığıdır (SUMMARY); başlık boşsa "Misafir" (`src/lib/import/ics.ts:301-303`).
  - Abonelik senkronu satırı `status:"confirmed"` ve `guestNameSource:"calendar"` ile yazar (`src/lib/import/sync.ts:541,564,568`).
  - Köken etiketinin anlamı (`src/lib/guest-name-source.ts:13-19`): `"calendar"` "çoğu zaman ad DEĞİL ('Reserved')".
  - Şemada kapatma (blok) modeli yok.
  - **Sonuç:** "Reserved" ya da "Not available" başlıklı bir satır misafir gibi görünüyor ve gerçek bir rezervasyon mu kapatma mı ayırt edilemiyor.
- **Öneri** (§15-S5 ile sorulur): `calendarSourceId` dolu satırlar kesik kenarlı çubukla çizilir. Görünen ad "Takvim kaydı", ham başlık yalnız çekmecede. İşgal ve sayım değişmez: kayıt hâlâ dolu gecedir.

### 4.9 Süzgeç ve iptaller (gizlenen ama sayılan)

- **Süzgeç varken** çip: "Diğer dairelerde bu tarihlerde 23 giriş / çıkış var · Tüm daireler". Sayı bellekte, aynı veriden çıkar.
- **İptaller** çizilmez (gece işgal etmez; bugün de çizilmiyor, `page.tsx:70`).
  - Pencere içi iptal sayısı çiple gösterilir: "Bu tarihlerde 3 iptal" ve var olan İptaller sayfasına bağlanır (`/cancellations?propertyId=…`; parametre `cancellations/page.tsx:63-69`; menüde `src/lib/nav.ts:32`).
  - §15-S8 ile sorulur.
- **Bilinen boşluk:** "Kanal iptalli rezervasyonu yeniden etkin gösteriyor" satırı takvime aysız düşüyor (`attention.ts:772`). Bu kayıt iptal olduğu için takvimde yok. Bağlantının İptaller sayfasına çevrilmesi ayrı, küçük bir iştir (§16).

### 4.10 Bugün, sıralama, açıklama

- **Bugün:**
  - Başlık hücresinde "Bugün" etiketi ve `aria-current="date"`.
  - Sütun hafif renklenir (`<col class="h t">`). Boşluk hücreleri saydam olduğundan sütun arka planı görünür.
  - Bugünün indeksi sunucuda hesaplanır ve modele girer. İstemcide `Date.now` kullanılmaz; böylece hidrasyon farkı oluşmaz.
- **Daire sırası:** bugün ada göre (`page.tsx:52`), bu yüzden "Daire 10" "Daire 2"den önce geliyor. Mülkler sayfası en yeni önce sıralıyor (`src/app/(app)/properties/page.tsx:23`). Şemada sıra alanı yok (`schema.prisma:353-402`).
  - Öneri: bellekte `Intl.Collator("tr", { numeric: true })` ile doğal sıralama. Migration gerekmez. §15-S6.
- **Açıklama satırı:**
  - "Giriş" (yeşil çentik), "Çıkış" (amber çentik)
  - "N gece: konaklama süresi"
  - "Boş hücre: kayıtlı rezervasyon yok"
  - "Çizgili: bilgi yok"
  - "‹ ›: seçili tarihlerin dışına taşan konaklama"
  - "Çakışma: aynı geceye iki kayıt"
- **Boş durumlar:**
  - Hiç daire yoksa: "Önce bir daire ekleyin." + Mülkler bağlantısı.
  - Daire var, pencerede hiç kayıt yoksa: tablonun üstünde "Bu tarihlerde rezervasyon yok." Tablo yine çizilir; daireler ve tarihler görünür.
  - Bekleyen metin düzeltmesi uygulanır: "görünecek" yerine "görünür" (`docs/claude-work/2026-10-21/ux-copy/bulgular.json:197`).

---

## 5. "Yüklenmemiş" ve "bilinmeyen" tarihler

### 5.1 Değişmez (saf kütüphanede, testle pinli)

`layoutTimeline` iki ayrı girdi alır: `window` (çizilecek) ve `loaded` (verisi okunan, yarı açık).
- Kural: **`f` sınıfı ve sayısal özet yalnız `loaded` içinde üretilebilir.** Dışarıdaki her boşluk `u`, her özet `null` olur.
- v1'de `loaded == window`, yani tablo yalnız yüklenen günleri çizer. Değişmez yine de kütüphanede tutulur, böylece ileride parça parça yükleme (C3) güvenli eklenir.

### 5.2 Hangi durumlarda "bilgi yok" çizilir

1. Gece `loaded` dışında.
2. **Satır tavanı aşıldı:** bütün boşluklar `u` olur ve üstte "Kayıtların tamamı gösterilemedi." uyarısı çıkar. Motorda karşılığı `load_truncated` (`core.ts:352`, `load.ts:154`).
3. Anomali gecesi (§4.5).
4. **Gezinme sürerken:**
   - Yeni `calendar/loading.tsx` iskeleti boş bir ızgara gibi görünmez. Araç çubuğu yer tutucusu + taranmış ızgara alanı + sr "Takvim yükleniyor…".
   - Kök öğe `data-route-skeleton` niteliğini korur. Bu, menü geçiş göstergesinin bitiş ölçütüdür (`src/components/shell/nav-pending.ts:7-8`; bu dosya ve `calendar/loading.tsx` değişikliği çalışma ağacında, henüz commit edilmedi).
   - Tarama, hareketi azaltma tercihinde durur (mevcut kural `globals.css:598`).
5. Sayfa hatası (`(app)/error.tsx`): tablo hiç çizilmez; "boş" gibi görünen bir yarım tablo oluşmaz.

### 5.3 Kaynak tazeliği (satır rozeti; hücre rengi değil)

`CalendarSource.lastStatus` ve `lastSyncedAt` değerlerine göre daire başlığında bir rozet çıkar. Metinler motorun ev sahibi metinleridir (`stay-edges.ts:134-143`):

| Durum | Metin |
|---|---|
| error | "Takvim bağlantısında hata var." |
| partial | "Takvimin bir kısmı okunamadı." |
| son okuma 6 saatten eski (`core.ts:185`) | "Takvim bağlantısı bir süredir güncellenmedi." |
| hiç okunmadı | "Takvim bağlantısı henüz hiç okunmadı." |

**Bu rozet neden hücrelerin "boş / bilgi yok" kararına bağlanmıyor:** Kanal bağlantısının son okuma zamanı bugün hiç kaydedilmiyor (`src/lib/channels/property-links.ts:30` `lastSuccessAt: null`). Motor bu yüzden kanala bağlı her dairenin her boş gecesine "bilinmiyor" diyor (`core.ts:281`; demo için aynı not `src/lib/demo-tenant/dataset.ts:23`).

Hücre durumu motorun kesinliğine bağlansaydı, kanala bağlı bütün daireler taranmış görünürdü. Bu yüzden:
- hücrenin "bilgi yok" kararı **veri kapsamından** verilir (§5.2);
- kaynak tazeliği satır rozetidir;
- bozuk iCal satırının boş günlerinin taranıp taranmayacağı kurucuya sorulur (§15-S4).

---

## 6. Mobil

- **Tek çizim, tek tablo.** Kırılma noktası yalnız CSS değişkenlerini değiştirir:

| | Telefon | md ve üstü |
|---|---|---|
| Daire sütunu (`--cal-p`) | 88 px, kısa ad | 160 px |
| Gün (`--cal-day`) | 44 px | 56 px |

- 390 px ekranda yaklaşık 6 gün görünür: (390 − 32 − 88) / 44 ≈ 6,1. Yatay kaydırma kabın içindedir, sayfa yatay kaymaz.
- 1 gecelik çubuk iki yarımdır, yani 44 px. WCAG 2.2 2.5.8'in 24 px asgari hedefini karşılar.
- **Tarih başlığı iki satır:** "Per" / "12". Bugün sütununda "Bugün".
- **Yakınlaştırma** ("2 hafta" 64 px, "4 hafta" 40 px) yalnız istemcide, tablodaki bir sınıfla değişir. Seçim bu tarayıcıda `localStorage` ile hatırlanır; her okuma ve yazma `try/catch` içinde, sayfa onsuz da doğru çizilir. Sunucu çıktısı değişmez.
- **Liste görünümü:**
  - `?gorunum=liste` ile yalnız ajanda çizilir: hareketli günler, kırpma yok; bugünkü mobil ajandanın içeriği (`page.tsx:235-285`). Aynı modelden türetilir.
  - **Aynı yanıtta iki görünüm asla birlikte çizilmez.**
  - Cihaz tahmini yapılmaz (kullanıcı ajanı ya da genişlik ipucu güvenilir değil). Varsayılan görünüm §15-S2.
  - Kullanıcının seçimi isteğe bağlı olarak bir çerezle hatırlanabilir; sunucu çerezi okuyup doğrudan doğru görünümü çizer, ekranda yanıp sönme olmaz. Bu da S2 ile birlikte sorulur.

---

## 7. Ayrıntı (yalnız istenince açılır)

### 7.1 Konaklama çekmecesi

Çubuğa tıklanınca masaüstünde sağdan çekmece, telefonda alttan sayfa açılır.
- Rol ve odak kalıbı `src/components/confirm-host.tsx:35,100,147`: `role="dialog"`, `aria-modal`, odak hapsi, Escape ile kapanır, odak çubuğa geri döner.
- Veri `GET /api/calendar/stays/[id]` ile gelir:
  - `withManage` kapısı, org kapsamlı okuma. Başka kiracının kimliği 404 döner.
- Dönen alanlar:
  - ad, daire, giriş/çıkış günü, gece sayısı, kanal adı, durum adı (`RESERVATION_STATUS`, `constants.ts:30-35`), kaynak türü (takvim / kanal / elle);
  - kişi ve evcil hayvan sayıları (`schema.prisma:493-499`). NULL "bilinmiyor" yazılır, **0 yazılmaz**;
  - dairenin giriş/çıkış saatleri (`schema.prisma:360-361`);
  - varsa konuşma bağlantısı. Kural `chat` ise `/guest-chats/{id}`, değilse `/inbox/{id}` (`attention.ts:163-165`). Bu kural ortak bir yaprak modüle taşınır.
- Dönmeyenler: para, telefon, e-posta.
- Misafirin yazdığı çıkış saati beyandır; gösterilecekse yalnız `lib/guest-checkout-time.ts` kuralıyla (CLAUDE.md C-9). v1'de gösterilmez.
- **Pin yükümlülükleri:**
  - `cross-tenant-coverage.test.ts:17` COVERAGE listesine `"calendar/stays/[id]": { GET: … }` eklenir ve davranışsal bir kiracılar arası test yazılır (reddin sebebi sınanır);
  - rol kapısı pini otomatik geçer (`withManage`).
- **Alternatif:** `?r=<id>` ile sunucuda çizilen panel. Yeni API rotası gerekmez, ama her açılışta bütün tablo yeniden iner. Ölçülürse kıyaslanır.

### 7.2 Gün sayfası

Özet hücresine tıklanınca ada, kabın içinde `[data-a="<gün>"]` ve `[data-d="<gün>"]` çubuklarını bulur. Her çubuğun metni ve satır başlığından (daire adı) bir liste kurar.
- **Ek veri gönderilmez:** adlar zaten çubuklarda.
- JS yokken de bütün adlar çubuklarda, bütün sayılar özet satırında görünür.

---

## 8. Performans bütçesi

Hedefler aynı makinede, aynı derlemede, demo verisiyle ölçülür. Hedefler tahmindir; tutmayan dürüstçe raporlanır.

| Ölçü | Taban (A) | Hedef (C) |
|---|---|---|
| Doğrudan açılış HTML, açık / sıkıştırılmış | 527 / 74 KB | ≤ 200 / ≤ 35 KB |
| Menüden geçiş sayfa verisi, açık / sıkıştırılmış | 251 / 54 KB | ≤ 100 / ≤ 20 KB |
| DOM düğümü, sayfa toplamı | 2.508 | ≤ 1.500 (takvim bölgesi ≤ 1.100) |
| Sunucu bekleme, p50 normal ağ | 25 ms | ≤ 40 ms (en kötü ≤ 80 ms) |
| Yavaş 3G, doğrudan: ana içerik | 3.724 ms | ≤ 2.200 ms |
| Yavaş 3G, doğrudan: etkileşime hazır | 3.645 ms | ≤ 2.400 ms |
| Yavaş 3G: uzun görev toplamı | 261 ms | ≤ 100 ms |
| Yavaş 3G, menüden: içerik görünür | 2.101 ms | ≤ 1.000 ms |
| Normal ağ, menüden: veri hazır → içerik (bekletme ayrı yazılır) | 378 ms (≈300 ms React bekletmesi) | veri hazır ≤ 120 ms; bekletme ayrıca raporlanır |

**Tahminin dayanağı** (yaklaşık, ölçümle doğrulanacak):

- **Satır başına düğüm:** varsayım daire başına 35 günde ~9–10 çubuk.
  - 1 `tr` + `th`, ~10 boş gün hücresi, ~15 yarım hücre, 10 çubuk × 4 düğüm.
  - Toplam ≈ 78 düğüm/daire, 10 dairede ≈ 780.
  - Başlık + özet ≈ 250. Kabuk ≈ 380.
  - Toplam ≈ 1.400.
- **Bayt:**
  - Çubuk başına ≈ 260 B HTML + benzer RSC: 130 çubuk ≈ 70 KB.
  - Boşluk hücresi başına ≈ 50 B (HTML + RSC): 250 hücre ≈ 13 KB.
  - Başlık + özet ≈ 20 KB.
  - Kabuk ≈ 95 KB: 527 − 182 KB iki görünüm HTML'i − ~250 KB sayfa verisi.
- **Bütçe aşılırsa sırasıyla:**
  1. Boş günleri tek hücrede birleştir (gün çizgisini satır arka plan deseniyle çiz).
  2. Izgarayı istemci bileşenine taşı (C2): RSC'de öğe ağacı yerine yalnız model (≈ 12 KB açık) gider.
  3. `data-a` / `data-d` yerine konumdan türet.

---

## 9. Erişilebilirlik

- **Yerel tablo anlamı:**
  - `<caption>` aralığı ve boş hücre anlamını söyler.
  - Tarih başlıkları `scope="col"` ve tam tarih etiketi taşır: "12 Kasım Perşembe".
  - Daire başlıkları `scope="row"` + `rowspan`.
- **Kaydırma kabı** `role="region" aria-label="Takvim" tabindex="0"`; klavyeyle kaydırılabilir (axe "scrollable-region-focusable").
- **Çubuklar ve özet hücreleri `<button>`.** Erişilebilir ad görünen metin + sr ek: ad, giriş, çıkış, gece, kanal. Ayrıca `aria-label` yazılmaz; metin bir kez bulunur.
- **Boş hücre** metinsizdir (anlamı başlıkta). **Bilgi yok** hücresi her zaman "Bilgi yok" metni taşır.
- **Aralık değişince** `aria-live="polite"` bölgesi "26 Ekim – 29 Kasım gösteriliyor" der. Ada, aralık başlığına odaklanır (`tabindex="-1"`).
- Renk tek bilgi değildir (§4.3). Odak halkası görünür. Hedefler ≥ 24 px.
- **İsteğe bağlı:** APG ızgara klavye modeli (tek sekme durağı, yön tuşları). v1'de doğal sekme sırası.
- Yayından önce axe taraması 390 ve 1280 genişlikte, açık ve koyu temada.

---

## 10. Bugünkü takvimden korunacak bilgiler

| Bugün (dayanak) | Yeni karşılığı |
|---|---|
| Günlük giriş: ad + daire, yeşil ikon (`page.tsx:261-269,327-332`) | Çubuk başlangıcı (öğleden sonra yarısı, yeşil çentik) + adın kendisi + daire satırı + özette "giriş N" + gün sayfası |
| Günlük çıkış (`:270-278,333-338`) | Çubuk sonu (sabah yarısı, amber çentik) + özette "çıkış N" |
| Gece başına dolu daire, N/T (`:254-258,317-324`) | Özet satırında **her gün** N/T. Telefonda artık sakin günlerde de görünür. |
| "+N diğer" + gizlenen adlar (`:339-348`) | Hiçbir çubuk kırpılmaz. Kesin sayılar + gün sayfasında tam liste. Süzgeç ve iptal çipleriyle gizlenen her şey sayılır. |
| Bugün işareti (`:311-316`, " · bugün" `:252`) | Başlıkta "Bugün" + `aria-current` + sütun rengi |
| Hafta günü, ay başlığı, önceki/sonraki (`:215-231,293-297`) | Gün başlığında hafta günü, ay etiket satırı, 2 haftalık oklar, "Bugün", ay menüsü. Aralık sınırsız (±5 yıl sağlık sınırı). |
| Daire çipleri, yalnız >1 dairede (`:184-210`) | Aynen kalır. |
| Boş ay mesajı (`:237-242`) | "Bu tarihlerde rezervasyon yok." (her genişlikte) |
| Açıklama (`:358-369`) | Genişletilmiş açıklama (§4.10) |
| Adres sözleşmesi `?month=&property=` (`:140-144`) | Kabul edilir; `?from=` eklenir. |
| Misafir adı saklandığı gibi | Aynen. iCal satırları için S5 sorusu. |
| İki kaynağın kaydı ayrı (birleştirme yok) | Ayrı şerit + "iki kaynaktan gelmiş olabilir" ipucu |
| Saat dilimi tek kuralla (`:107-111`) | Aynı `calendarDateOf` |

**Yeni gelenler:**
- gece sayısı (kurucu şartı),
- çakışma görünürlüğü,
- hatalı tarihli kayıt işareti,
- satır kaynak rozeti,
- iptal çipi,
- çekmece (kişi sayıları, konuşma bağlantısı).

---

## 11. Modül dağılımı

```
src/lib/calendar/timeline.ts          SAF: DB yok, React yok, saat yok (now/today girdide). Sunucu ve istemcide çalışır.
src/lib/calendar/load.ts              "server-only": org kapsamlı okuma (§3.2) → TimelineInput
src/components/calendar/calendar-grid.tsx      Yalnız çizim; kanca yok; TEK prop: model (JSON). Sunucu bileşeni; "use client" eklemek C2'dir.
src/components/calendar/calendar-agenda.tsx    Liste görünümü (aynı modelden), yalnız ?gorunum=liste
src/components/calendar/calendar-toolbar.tsx   Bağlantılar (oklar, Bugün, ay menüsü, görünüm), sunucu bileşeni
src/components/calendar/calendar-island.tsx    "use client": odak + duyuru, yakınlaştırma, olay devri (çekmece / gün sayfası)
src/components/calendar/stay-drawer.tsx        "use client": iletişim kutusu, GET ile ayrıntı
src/app/(app)/calendar/page.tsx       requireManagerSession → resolveWindow → load → layoutTimeline → çizim
src/app/(app)/calendar/loading.tsx    Yeni yerleşime uygun, taranmış, data-route-skeleton korunur
src/app/api/calendar/stays/[id]/route.ts       withManage, org kapsamlı, para/iletişim yok
src/lib/conversation-href.ts          attention.ts:163-165 kuralı yaprak modüle (iki yer aynı kuralı kullanır)
src/app/globals.css                   .lxs-cal* kuralları (yapışma, değişkenler, tarama, hareketi azalt)
```

**Saf kütüphanenin tipleri:**

```ts
export const WINDOW_DAYS = 35, LEAD_DAYS = 3, STEP_DAYS = 14, ROWS_PER_PROPERTY = 150;
export interface TimelineWindow { from: NightKey; to: NightKey; days: number }
export function resolveWindow(q: { from?: string; month?: string }, today: NightKey): TimelineWindow;

export interface StayRow { id: string; propertyId: string; guestName: string; arrival: Date; departure: Date;
  status: "confirmed" | "completed"; channel: string; fromCalendarFeed: boolean }
export interface TimelineInput { window: TimelineWindow; loaded: { from: NightKey; to: NightKey }; timeZone: string;
  today: NightKey; properties: { id: string; name: string; sourceNote: SourceNote | null }[];
  stays: StayRow[]; truncated: boolean; filterPropertyId: string | null; cancelledInWindow: number }

export type Segment =
  | { k: "f" | "u" | "x"; h: number; n: 1 | 2 }                       // h: başlangıç yarımı, n: yarım sayısı
  | { k: "s"; h: number; n: number; id: string; name: string; nights: number; a: NightKey; d: NightKey;
      clipL: boolean; clipR: boolean; conflict: boolean; tone: "confirmed" | "completed"; feed: boolean; ch: string }
  | { k: "!"; h: number; n: number; id: string; name: string; kind: "zero_nights" | "inverted"; a: NightKey; d: NightKey };
export interface TimelineRow { propertyId: string; name: string; lanes: Segment[][]; conflictNights: number;
  possibleDuplicate: boolean; sourceNote: SourceNote | null }
export interface DaySummary { key: NightKey; arrivals: number | null; departures: number | null; occupied: number | null }
export interface TimelineModel { window: TimelineWindow; todayIndex: number | null; total: number; truncated: boolean;
  days: DaySummary[]; rows: TimelineRow[]; outside: { otherPropertiesMovements: number | null; cancelled: number } }

export function staySpan(a: NightKey, d: NightKey, w: TimelineWindow): { h0: number; h1: number; clipL: boolean; clipR: boolean } | null;
export function assignLanes<T extends { h0: number; h1: number; id: string }>(spans: T[]): T[][];
export function laneSegments(lane: SpanLike[], unionCovered: Uint8Array, nightState: (night: number) => "f" | "u", D: number): Segment[];
export function summarizeDays(input: TimelineInput, keys: StayKeys[]): DaySummary[];   // fark dizileri
export function dayHeader(key: NightKey): { short: string; day: number; long: string; weekend: boolean };
export function layoutTimeline(input: TimelineInput): TimelineModel;
```

**Ayrıntılar:**
- `dayHeader` deterministiktir; `Intl` kullanmaz.
  - Kısa ay adları `stay-edges.ts:127-132`'deki `MONTHS_TR`'den, hafta günleri `page.tsx:21`'deki `WEEKDAYS` dizisinden alınır.
  - Uzun ay adları için sabit Türkçe dizi kullanılır.
  - Böylece sunucu ve istemcide aynı metin çıkar (C2'de hidrasyon farkı olmaz).
- Saat dilimi kararı yalnız `calendarDateOf` ve `todayKey`'dedir. Gün aritmetiği `addNights` / `nightsBetween` ile yapılır (`Date.UTC`), dolayısıyla yaz saatinden etkilenmez (`core.ts:13-14`).

---

## 12. Geçiş yolu

| Dilim | İçerik | Ekrana etkisi |
|---|---|---|
| 0 | Ölçüm betiği depoya: `scripts/perf/calendar-measure.mjs`. Bugünkü `scratchpad/cal-measure.mjs` temel alınır; giriş bilgisi ortam değişkeninden okunur. A tabanı yeniden ölçülür (10/5 koşu). | Yok |
| 1 | `src/lib/calendar/timeline.ts` + birim testleri (kırmızı-önce) + mutasyon (`scripts/mutation-run.mjs`) | Yok |
| 2 | `load.ts`, ızgara, araç çubuğu, sayfa, `CALENDAR_TIMELINE_ENABLED` arkasında. Bayrak tam "1" ile açılır; `STRICT_ONE_FLAGS`'e ve `docs/RAILWAY-ACILIS-2026-10-15.md`'ye yazılır. Kapalıyken eski sayfa birebir aynı (eski kod ayrı dosyaya taşınır, davranış değişmez). | Bayrak kapalıyken yok |
| 3 | Ada, çekmece + API rotası + kiracılar arası test + COVERAGE kaydı, gün sayfası, yeni `loading.tsx` | Bayrak arkasında |
| 4 | A ve C1 ölçümü (isteğe bağlı C2), kurucuya önce/sonra raporu (sayılar + iki ekran görüntüsü) | Yok |
| 5 | Kurucu onayından sonra bayrak + eski ızgara + eski ajanda silinir. Liste görünümü yeni modelden kalır. | Yeni ekran varsayılan |

**Pinlerin değişimi** (kırmızı-önce, dilim 5'te):
- `calendar-page.test.ts:96-108` ikili çizimi pinliyor. Yerine tek çizim pini yazılır: önce eski sayfada kırmızı olduğu görülür, sonra yeni sayfada yeşil.
- "+2 / +7 diğer" pinleri (`:141-170`) kesin sayı pinlerine çevrilir.
- Saat dilimi testlerindeki `li key` yürüyüşü (`:184-202`) `data-a` / `data-d` ile bulmaya çevrilir.

**Bayrak gerekçesi:** canlı yayın kapalı (CLAUDE.md "Canlı durum"). Bayrağın asıl işi geri alınabilirlik ve aynı derlemede A/C ölçümüdür; kısa ömürlüdür.

---

## 13. Testler

### 13.1 Saf yerleşim: `tests/unit/calendar-timeline.test.ts`

Varsayılan pencere: `from = 2026-11-10`, `D = 35`.

1. **Çubuk aralığı:** 12 → 15 Kasım. `h0 = 5`, `n = 6`, `nights = 3`, kırpma yok.
2. **Aynı gün devir:** A 10→12, B 12→14 aynı dairede. Tek şerit, A `[1,5)`, B `[5,9)`, çakışma yok.
3. **Çakışma:** A 10→13, B 12→15. İki şerit. Çakışan gece 12 Kasım. İkisi `conflict`. `conflictNights = 1`.
4. **Birebir aynı tarihli iki kayıt:** `possibleDuplicate = true`. İkisi de çizilir.
5. **Sol kırpma:** giriş `from − 5`, çıkış `from + 2`. `h = 0`, `n = 5`, `clipL`, `nights = 7`.
6. **Sağ kırpma:** giriş `to − 1`, çıkış `to + 3`. `h = 69`, `n = 1`, `clipR`, `nights = 4`.
7. **Çıkış = `from`:** yalnız 0. yarım. Gün 0'da çıkış sayısı 1, gün 0 doluluğu 0.
8. **Giriş = `to`:** hiçbir sayıya ve hücreye girmez.
9. **Sıfır gece** (`from + 4`): tek yarımlık `!` işareti `h = 9`. Giriş ve çıkış sayısı +1. Doluluk değişmez. O gece `u`. **Asla düşmez.**
10. **Ters kayıt** (çıkış `from + 3`, giriş `from + 6`): taranmış işaret. Gün 6'da giriş, gün 3'te çıkış sayılır.
11. **Kapsama değişmezi:** `loaded = [from, from+20)`. 20–34. günlerde hiç `f` yok; özetler `null`; "0" asla üretilmez.
    - Bayrağı ters çeviren mutant ve sınırı bir kaydıran mutant öldürülür.
12. **Kırpılmış veri:** `truncated` → hiç `f` yok, bütün özetler `null`.
13. **Şerit boşluğu asla "boş" değil:** A 10→12 (şerit 0), B 11→20 (şerit 1). Şerit 0'da 12–19 günleri `x`; hiçbir şeritte `f` yok.
14. **Örtü değişmezi:** her şeritte yarım toplamı tam `2D`. Hiçbir hücre bir günü aşmaz. Tohumlu rastgele 2.000 vaka (bağımlılık yok).
15. **Eski hesapla eşitlik:** aynı rastgele veride bugünkü kova algoritması (`page.tsx:106-122`, testte kâhin olarak kopyalanır) ile `summarizeDays` giriş, çıkış ve dolu sayıları birebir aynı.
16. **Toplam:** giriş toplamı = pencere içi giriş günü olan kayıt sayısı; çıkış için aynı. `dolu ≤ T`. Aynı dairede iki kayıt bir sayılır.
17. **Belirlenimcilik:** aynı girdinin farklı sırası aynı modeli verir (`id` ile eşitlik bozma).
18. **Saat dilimi, Europe/Istanbul:**
    - `2026-11-12T21:30:00Z` (gerçek an) → `2026-11-13`.
    - `2026-11-12T00:00:00Z` ve `…T12:00:00Z` → `2026-11-12` (`core.ts:78-84`).
19. **Yaz saati:**
    - **Europe/Berlin**, pencere `2026-10-20 +35`. 25 saatlik 25 Ekim tam bir kez var; 35 sütun ardışık.
      - Giriş `2026-10-24T22:30Z` → yerel 25 Ekim 00:30 (CEST) → anahtar `2026-10-25`.
      - Çıkış `2026-10-27T10:00Z` → `2026-10-27`. `nights = 2`.
      - Yaz saatine geçiş günü `2026-03-29` için aynı kontrol.
    - **America/New_York**, `2026-03-08` ve `2026-11-01`. 23 / 25 saatlik günde sütunlar ardışık.
      - `2026-09-26T00:00Z` girişi 26'sında (bugünkü pinin karşılığı, `calendar-page.test.ts:219-226`).
    - **Bugün:** Berlin'de yerel `2026-10-25 00:30` anı → `todayIndex` 25 Ekim. Pencere dışındaysa `null`. `aria-current` tam bir kez.
20. **`resolveWindow`:**
    - `?from` geçersizse (`2026-02-30`) varsayılan.
    - `?month=2026-10` → `from = 2026-10-01`.
    - Çok uzak tarih sınırlanır.
    - Dizi parametresi.

### 13.2 Sayfa: `tests/integration/calendar-page.test.ts`

Gerçek test veritabanı; bayrak açık ve kapalı iki koşu.

- **Tek çizim:**
  - ağaçta tek `table[data-cal-window]`;
  - `md:hidden` ile `hidden … md:block` çifti yok;
  - **her misafir adı ağaç metninde tam bir kez geçer** (tekrarın geri gelmesine karşı pin).
- **Aynı güne 5 giriş:** 5 ad da çubuk; özet "5 giriş".
- **10 giriş + 1 çıkış (eski +7 vakası):** özet 10 / 1; 11 ad da bir kez var.
- **Saat dilimi:** New York ve İstanbul, çubuk `data-a` / `data-d` ile bulunur.
- **Tekilleştirme:** iki dairede aynı "1" referansı ikisi de görünür (bugünkü `:243-259`).
- **İptal:** çizilmez, çipte sayılır. Bekleyen kayıt: §15-S3 kararına göre.
- **Adres:** `?month=` eşlemesi; yabancı `?property=` yok sayılır.
- **Satır tavanı:** tavan yükleyiciye parametre olarak verilir; testte 3 ile kırpılır ve uyarı çıkar.

### 13.3 Diğer testler

- **API:** `tests/integration/calendar-stay-route.test.ts`
  - başka kiracının kimliği 404, sebebi sınanır;
  - personel `withManage` ile reddedilir;
  - yanıtta para / telefon / e-posta alanı yok.
- **Arayüz:** `tests/ui/calendar-island.test.tsx` (jsdom)
  - çubuğa tıklama → çekmece, `fetch` taklit, odak hapsi, Escape;
  - gün sayfası doğru çubukları listeler;
  - `localStorage` hata fırlatsa da çalışır.
- **Yapısal pinler** geçer: `manager-page-gate`, `theme-scope` (`src/lib/theme.ts:36`), `api-route-scoping`, `api-route-role-gate`, `cross-tenant-coverage`, `railway-doc-flags`.
- **Mutasyon** (yalnız `scripts/mutation-run.mjs`; M0 kontrol koşusu zorunlu):
  - yarım ofseti (`+1` kaldır),
  - şerit eşitlik bozucu,
  - `x` ↔ `f`,
  - kapsama sınırı,
  - anomali düşürme,
  - özet `null` → `0`.

---

## 14. Ölçüm planı (önce ve sonra)

**Araç:** `scratchpad/cal-measure.mjs`, `scripts/perf/calendar-measure.mjs` olarak depoya alınır.

**Bugünkü eksikleri ve düzeltmesi:**

| Eksik | Düzeltme |
|---|---|
| 4 / 2 koşu | 10 doğrudan + 10 menüden (normal), 5 + 5 (yavaş) |
| Yalnız ortanca | Ortanca + en kötü |
| "Etkileşime hazır" vekil (DCL ile son uzun görevin büyüğü) | Adanın `performance.mark("cal:hydrated")` işareti eklenir |
| Menüden geçişte veri ile React bekletmesi ayrılmıyor | Aşağıdaki menüden geçiş satırları |
| Makine yükü kayması (`gece-dongusu.md:195`: 5,5 sn ve 3,5 sn) | A ve C dönüşümlü koşulur (ABAB), aynı oturumda, iki port: `CALENDAR_TIMELINE_ENABLED=0 next start -p 3100` ve `=1 -p 3101`, aynı derleme, aynı demo verisi |

**Ölçülenler:**

| Yol | Sunucu bekleme | Aktarım | Çizim | Etkileşime hazır |
|---|---|---|---|---|
| Doğrudan açılış | `responseStart − requestStart` | `responseEnd − responseStart`; HTML açık / sıkıştırılmış; `self.__next_f` metin toplamı (sayfa verisi payı); takvim bölgesinin `outerHTML` boyutu | FCP, LCP | `cal:hydrated` işareti; uzun görev toplamı; DOM düğümü (sayfa ve takvim bölgesi) |
| Menüden geçiş (Panel → Takvim) | RSC kaynak girdisi `responseStart − requestStart` | RSC `responseEnd`; açık / sıkıştırılmış | tıklama → `[data-cal-window]` DOM'a girdi (MutationObserver) → sonraki rAF | aynı işaret; **bekletme = içerik görünür − max(veri hazır, iskelet görünür + 300)** ayrı yazılır |
| Pencere adımı ("›") | aynı | aynı | tıklama → yeni `data-cal-window` değeri | aynı |
| Ay menüsü | aynı | aynı | aynı | aynı |

**Ek ayrıştırma:**
- **Sunucu içi süre:** `tsx` betiği yükleyiciyi ve `layoutTimeline`'ı HTTP olmadan 50 kez çağırır; veritabanı ms ile yerleşim ms ortancalarını ayrı yazar.
- **Görünüm genişlikleri:** 1280×800 ve 390×844. Ağ profilleri: normal ve yavaş 3G + 4× işlemci (betikteki profil).

**Kollar:**
- A: bugün.
- C1: zaman çizelgesi, sunucu ızgarası.
- C2 (isteğe bağlı): ızgara istemci bileşeni, yalnız model.
- C1 + komşu pencereyi önceden getirme (isteğe bağlı).

**Rapor:** her yol ve profil için A / C tablosu + film şeridi (yavaş 3G) + iki ekran görüntüsü. Hedef (§8) tutmazsa açıkça yazılır.

---

## 15. Kurucuya sorular (karar vermeden kod yok)

**S1. Varsayılan aralık ve adım**
- Böyle yapıyorum: 35 gün, bugünden 3 gün önce başlıyor; oklar 2 hafta kaydırıyor; ay menüsü ayın 1'ine atlıyor.
- Büyük şirketler: Guesty dünden başlıyor; Cloudbeds 4 gün ile 3 hafta arası seçtiriyor.
- Örnek (1280 px dizüstü): açılışta 26 Ekim – 29 Kasım yüklü, ekranda yaklaşık 13 gün görünüyor, sağa kaydırınca kalan 22 gün; "›" ile 9 Kasım'dan başlayan 35 gün.
- Böyle yapalım mı?

**S2. Telefonda varsayılan görünüm**
- Önerim zaman çizelgesi (ekranda ~6 gün, yatay kaydırma); "Liste" bir dokunuş uzakta.
- Örnek: telefonda Takvim açılınca daireler alt alta, tarihler üstte. "Liste"ye basınca bugünkü gibi gün gün giriş/çıkış listesi. Seçiminiz hatırlansın mı?

**S3. Onay bekleyen talepler**
- Bugün takvimde hiç görünmüyor, ama "Dikkat gerektirenler"deki çakışma uyarısı onları sayıyor (`core.ts:108-123`).
- Önerim kesik çizgili çubuk + "Onay bekliyor".
- Önce: 14–16 Kasım'da bekleyen talep takvimde yok, ama panel "takvimi kontrol edin" diyor.
- Sonra: o tarihlerde kesik çizgili "Mehmet K. · 2 gece · Onay bekliyor".
- Gösterelim mi, yoksa bugünkü gibi kalsın mı?

**S4. Takvim bağlantısı bozuk ya da güncel değilse**
- Önerim: daire başlığında "Takvim güncel değil" rozeti; boş günler boş kalır.
- Alternatif: o dairenin boş günleri "bilgi yok" (çizgili) olsun.
- Örnek: Airbnb takvim bağlantısı 2 gündür okunamıyor. Önce: boş günler beyaz. Sonra (alternatif): çizgili.
- Hangisi?

**S5. Takvimden gelen "Reserved" / "Not available" kayıtları**
- Bugün misafir adı gibi görünüyor.
- Önerim kesik kenarlı "Takvim kaydı" çubuğu; asıl başlık ayrıntıda.
- Önce: "Reserved · 3 gece". Sonra: "Takvim kaydı · 3 gece".
- Böyle yapalım mı?

**S6. Daire sırası**
- Önerim doğal sıra: Daire 1, 2, …, 10. Bugün "Daire 10" "Daire 2"den önce geliyor.
- Böyle yapalım mı, yoksa elle sıralama mı istersiniz? Elle sıralama veritabanında yeni bir alan ister.

**S7. Yayın**
- Yeni ekran önce bayrak arkasında, sizin incelemeniz ve önce/sonra ölçümüyle; onayınızdan sonra eski takvim silinsin.
- Uygun mu?

**S8. İptal sayısı çipi**
- "Bu tarihlerde 3 iptal", İptaller sayfasına bağlanıyor. Takvimde iptaller çizilmiyor.
- Eklensin mi?

---

## 16. Riskler ve açık noktalar

1. **İki eksenli yapışkan tablo:** iOS Safari ve eski Chromium'da denenmeli. Başarısız olursa `display:grid` + `role="table"` ve aynı yarım sütun modeli.
2. **Gezinme bekletmesi:** her pencere adımı iskeleti tetikleyip ~300 ms bekletme ekleyebilir (HZ1, `gece-dongusu.md:162-171`).
   - Ölçülür.
   - Gerekirse ada `router.push`'u geçişle sarar; eski tablo soluk ve "Yükleniyor" etiketiyle kalır. Soluk tablo da boş gibi görünmemeli, bu yüzden üzerine tarama gelir.
3. **Kanal bağlantısının tazeliği kaydedilmiyor** (`property-links.ts:30`). Kanala bağlı dairelerde satır rozeti bugün hiçbir şey söyleyemez. Bağlantı katmanı okuma zamanını yazınca rozet ona bağlanır.
4. **Uzun adlar ve ileride 50+ daire:** satır ve sütun sanallaştırma 50 daire ya da 120 gün sonrası için. v1'de yok.
5. **Çakışma ipucu ev sahibini ürkütebilir:** iki kaynaktan gelen aynı konaklama, bugün iki giriş olarak görünüyor; artık "Çakışma" çipiyle görünecek. Metin, kesin bir hata değil ipucu olduğunu söylüyor (`conflicts.ts:14-15`).
6. **Yeniden etkinleşme uyarısının bağlantısı** (`attention.ts:772`) takvime aysız düşüyor ve kayıt takvimde yok. İptaller sayfasına çevrilmeli. Küçük, ayrı bir iş; bağlantıyı değiştirmek `tests/ui/attention-panel.test.tsx` pinlerini etkiler.
7. **Çalışma ağacında commit edilmemiş HZ2 değişiklikleri var:** `calendar/loading.tsx`, `nav-pending.ts`, `app-shell.tsx`. Takvim iskeleti işi bu değişikliklerin üzerine kurulmalı; `data-route-skeleton` sözleşmesi korunmalı.

---

**Dayanak dosyalar:**
- `/home/user/SaaS-Ultimitly/src/app/(app)/calendar/page.tsx`
- `/home/user/SaaS-Ultimitly/src/app/(app)/calendar/loading.tsx`
- `/home/user/SaaS-Ultimitly/src/modules/availability/core.ts`
- `/home/user/SaaS-Ultimitly/src/modules/availability/load.ts`
- `/home/user/SaaS-Ultimitly/src/modules/availability/stay-edges.ts`
- `/home/user/SaaS-Ultimitly/src/modules/availability/conflicts.ts`
- `/home/user/SaaS-Ultimitly/src/lib/channels/property-links.ts`
- `/home/user/SaaS-Ultimitly/src/lib/reports.ts`
- `/home/user/SaaS-Ultimitly/src/lib/import/ics.ts`
- `/home/user/SaaS-Ultimitly/src/lib/import/sync.ts`
- `/home/user/SaaS-Ultimitly/src/modules/intelligence/incidents/attention.ts`
- `/home/user/SaaS-Ultimitly/tests/integration/calendar-page.test.ts`
- `/home/user/SaaS-Ultimitly/docs/INCELEME-2026-10-28-gece-dongusu.md`
- `/tmp/claude-0/-home-user-SaaS-Ultimitly/4b3a6b83-dfb6-5a82-b43d-8777d09e2d05/scratchpad/cal-measure.mjs`
- `/tmp/claude-0/-home-user-SaaS-Ultimitly/4b3a6b83-dfb6-5a82-b43d-8777d09e2d05/scratchpad/perf-out/cal-once.json`