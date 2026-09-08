# Değerlendirme — host metninden alan çıkarma, eksik bilgi tespiti ve retrieval mimarisi (2026-09-08)

> Kurucu/Codex önerisi geldi; bu belge **uygulama değil değerlendirmedir**: her maddeyi mevcut kodla karşılaştırır,
> hangi parçanın bugün var olduğunu, hangisinin şema/migration istediğini ve hangi sırayla yapılması gerektiğini
> söyler. **Bu turda kod yazılmadı.** Öneriler mantıklı ve büyük ölçüde mevcut altyapıyla karşılanabilir —
> önemli bir kısmının temeli V1'de zaten atıldı.

---

## Kısa hüküm
| Öneri | Hüküm | Neden |
|---|---|---|
| 1. Host metninden alan önerisi (taslak) | ✅ **Mantıklı, yapılmalı** | En büyük kurulum sürtünmesi; boş KB'nin canlı bedeli ölçüldü |
| 2. Eksikleri gerçek sorulardan bulmak | ✅ **Mantıklı, EN YÜKSEK değer** | V1 `Signal` altyapısı bunu neredeyse bedavaya veriyor |
| 3. Yapılandırılmış alan ↔ RAG ayrımı | ✅ **Doğru ilke, kısmen zaten var** | Saat/adres zaten kolonda; çift kopya riski gerçek |
| 4. Kapsam/kaynak/onay/sürüm + yetki filtresi + sır indekslenmez | ✅ **Doğru; sır kısmı ZATEN var** | Onay/sürüm eksik (şema işi); sır kapısı bugün çalışıyor |

---

## 1. Host metninden alan önerisi çıkarma

**Bugün ne var:** `KnowledgeBaseItem` = `category · title · content · language · isActive`. Host her kalemi ELLE
yazıyor. Yapılandırılmış alanlar ayrı: `Property.checkInTime/checkOutTime/address/city`, `supplyProfileJson`.
Ekleme yolu tek tek form; toplu metin yapıştırma YOK.

**Öneri neden doğru:** canlı turda ölçtük — boş KB'de asistan konum ve tesis sorularını temellendiremiyor.
Kurulum maliyeti düşmeden bu boşluk kapanmıyor. Host'un elinde metin zaten var (karşılama mesajı, ev rehberi).

**Tasarım (önerilen):**
- Host metni yapıştırır → sistem **taslak öneri** listesi üretir: `{ hedefAlan, çıkarılanDeğer, kaynakSatır, güven }`.
- Hedef alan iki türlü olabilir: **yapılandırılmış kolon** ("Çıkış 11.00" → `checkOutTime`) veya **KB kalemi**
  ("Çöp binanın arkasında" → `category: trash`).
- **Hiçbir öneri kendiliğinden yazılmaz.** Mevcut değerle çelişki varsa yan yana gösterilir ve host seçer.
  (Deponun `.ics` "Dosyadan içe aktar" önizlemesi bunun emsali: kaydetmeden önce ne olacağını göster, host onaylasın.)
- Çıkarım LLM'siz başlayabilir: saat/tarih kalıpları, "çıkış/giriş", "wifi/şifre", "çöp", "otopark" gibi dar bir
  kalıp kümesi. LLM ancak bu taban çalıştıktan sonra ve **yalnız öneri üretmek için** eklenir; kararı host verir.

**Kritik kural (kurucu şartı, aynen katılıyorum):** *misafirin söylediği şey otomatik olarak mülk gerçeğine
dönüşmez.* Bu, V1'de zaten pinli bir ilke: `Signal` bir **gözlemdir**, `PropertyMemory` ise kaynağı açık bir
**iddiadır** ve misafir mesajından doğrudan hafıza yazılmaz. Aynı sınır burada da geçerli olmalı: host metni =
host beyanı (güvenilir kaynak), misafir mesajı = gözlem (kanıt değil).

**Maliyet:** UI + çıkarım servisi + öneri şeması. Yapılandırılmış alanlar için migration GEREKMEZ (kolonlar var);
öneri kalemlerini kalıcı saklamak istersek küçük bir tablo gerekir (taslakları geçici tutarsak gerekmez).

---

## 2. Eksikleri gerçek sorulardan bulmak — **en yüksek değerli madde**

**Bugün ne var (ve bu önemli):** V1 ile her misafir mesajı zaten sınıflandırılıp `Signal` olarak yazılıyor
(`source: guest_message`, `kind: message.intent`, `category`, `occurredAt`, PII'siz). Yani "bu mülkte son N günde
hangi konu kaç kez soruldu" sorusunun verisi **bugün toplanıyor**. Ek olarak `PropertyMemory` örüntü mantığı
(≥3 sinyal / 180 gün) hazır.

**Eksik olan tek parça:** "bu konuda ONAYLI cevap var mı?" bağı. Bunun için sinyal kategorisi ile KB kalemi
arasında bir eşleme gerekiyor (`trash` sinyali ↔ `category: trash` KB kalemi). Bu eşleme dar ve deterministik
yapılabilir — LLM gerekmez.

**Tasarım (önerilen):**
- Kural: *kategori K için son 90 günde ≥3 misafir sorusu var VE o mülkte K kategorisinde aktif KB kalemi YOK*
  → "eksik bilgi" önerisi.
- Öneri **tekilleştirilir** (mülk × kategori tek satır) ve **önem sırasına** konur (soru sayısı + yakınlık).
- **Bildirim yağmuru yasak** (kurucu şartı): öneriler bir listede birikir, mesaj başına bildirim YOK. En fazla
  periyodik bir özet.
- Host tek cevap yazar, **ilgili daireleri seçer** (çoklu mülke tek yazımla uygulanır), onaylar.

**Neden bu madde ilk yapılmalı:** yüzlerce alanı peşinen doldurtmak yerine, ürünün kendi ölçtüğü gerçek boşluğu
kapatır. Veri zaten akıyor; eksik olan yalnız okuma yüzeyi ve eşleme kuralı. **Migration gerekmez** (Signal ve
KnowledgeBaseItem mevcut); yalnız öneri durumunu (görüldü/kapatıldı) saklamak istersek küçük bir tablo gerekir.

---

## 3. Yapılandırılmış alan ↔ RAG ayrımı

**Katılıyorum ve bir uyarı ekliyorum.** İlke doğru: saat/olanak/kural gibi **kesin ve kısa** gerçekler
yapılandırılmış alandan; uzun kullanım talimatları ve rehberler retrieval'dan gelmeli. Aynı bilginin iki kopyası
tutulmamalı — çünkü ikisi ayrışır ve hangisinin doğru olduğu belirsizleşir.

**Bugünkü durum:** `checkInTime/checkOutTime/address/city` zaten kolon ve prompt'a doğrudan giriyor. Ama host
aynı bilgiyi bir KB kalemine de yazabilir ("Çıkış saati 11:00") — **çift kopya bugün mümkün ve engellenmiyor.**
Madde 1'deki çıkarım aracı bu riski artıracağı için, o araç **çelişki tespitiyle birlikte** gelmeli: bir öneri
yapılandırılmış alana aitse KB kalemi olarak YAZILMAMALI.

**RAG konusunda ölçülü olalım:** bugün KB kalemleri zaten mülk-kapsamlı ve az sayıda (tavan `KB_ITEM_CAP`), yani
tamamı prompt'a sığıyor. Vektör araması **bugün gerekli değil**; gerekliliği ölçülmeden eklenmemeli (kurucunun
kendi talimatı: yeni vektör servisi veya GraphRAG mevcut altyapı yeterliyse eklenmez). Gerçek ihtiyaç, kalem
sayısı tavanı zorladığında veya uzun rehber metinleri girdiğinde doğar. O noktada ilk adım **kaynak-kimlikli
parçalama + anahtar kelime/kategori filtresi**, vektör değil.

---

## 4. Kapsam, kaynak, onay, sürüm, geçerlilik + yetki filtresi + sırlar

**Sırlar: bugün ZATEN korunuyor** — ve bu çalışma bahanesiyle gevşetilmeyecek. QR yüzeyinde `withoutSecretKbItems`
içerik sezgiseliyle TAM tarama yapıyor, `QR_SECRET_CATEGORIES` kategori bacağı var, `verifiedActiveStay` şartı
var ve tarama tavanı aşılırsa **fail-closed** (kalem elenir). Bu turda ölçtük: kötü niyetli talimat içeren bir KB
kalemi modele **hiç gitmiyor**. Retrieval eklense bile bu eleme retrieval'ın ÖNÜNDE kalmalı.

**Yetki filtresi retrieval'dan önce:** bugün de böyle — KB sorgusu `propertyId` ile başlıyor, org kapsamı
rota katmanında. Retrieval eklenirse kural aynen korunmalı: **önce kiracı/mülk/aktiflik/görünürlük filtresi,
sonra arama.** Filtresiz bir indeks üzerinde arama yapıp sonra elemek kabul edilemez.

**Eksik olanlar (şema işi):** `KnowledgeBaseItem` bugün `isActive` dışında durum taşımıyor —
**onay durumu, sürüm, kaynak (host mu, çıkarım mı, öneriden mi geldi), geçerlilik zamanı YOK.** Öneri doğru:
- `source`: `host_manual | extracted_draft | suggestion_accepted`
- `approvedAt` / `approvedBy`: taslak ile onaylı ayrımı (madde 1 ve 2 bunu zorunlu kılar)
- `version` veya `supersededById`: güncellenen bilgi eski cevaplara kaynak olmaya devam etmesin
- `expiresAt` (opsiyonel): mevsimlik bilgiler

Bu alanlar **migration ister** ve dolu tabloya eklendiği için hepsi nullable/varsayılanlı olmalı (deponun kuralı:
dolu tabloya `@unique`/required-no-default eklenmez). `PropertyMemory` bu alanların çoğunu (source, evidence,
confidence, observedAt, lastConfirmedAt, expiresAt, status) **zaten taşıyor** — yani sözleşme repoda mevcut,
KB tarafına aynı disiplini getirmek tutarlılık sağlar.

---

## KOD HAZIRLIĞI PLANI (kurucu onayı 09-08: 1/4/5/6 maddeleri uygulanacak)

> Kurucu kararı: değerlendirmede kalmasın, **kod hazırlığına geçilsin**. Şartlar: mülk gerçekleri ile mesaj
> şablonları KAVRAMSAL OLARAK AYRI · mevcut eşdeğer yapılar kullanılsın · metinden çıkarılan bilgi HOST ONAYINDAN
> ÖNCE AKTİFLEŞMESİN · mevcut içerik silinmesin/sessizce değişmesin · kurulum-eksikler ile incelenecek öneriler
> AYRI GÖRÜNÜMLER · sıra VERİ BAĞIMLILIĞINA göre · gerçek model eval'i bitmeden düşük güven bandı AÇILMAZ ·
> migration ve prod onay kapıları aynen geçerli.

### Kavramsal ayrım (önce bu netleşmeli)
Bugün `KnowledgeBaseItem` İKİ farklı şeyi taşıyor ve bu karışıklık ekranda görünüyor (kurucunun ekran
görüntüsündeki "Giriş Talimatı / Çıkış Mesajı / Karşılama Mesajı" kalemleri `{isim}` yer tutucusu içeriyor):
- **MÜLK GERÇEĞİ** (çöp yeri, otopark, ev kuralları) → AI'nın cevap üretirken DAYANDIĞI bilgi. Yer tutucu içermez.
- **MESAJ ŞABLONU** (karşılama, giriş talimatı, çıkış mesajı) → misafire AYNEN gönderilen metin, `{isim}`/`{daire}`
  yer tutucularıyla. Bunlar zaten `TRIGGER_CATEGORIES` (`welcome · checkin · checkout`) olarak kodda ayrılmış ve
  `MessageTemplate` diye AYRI bir model de var.
**Karar:** yeni alan çıkarımı YALNIZ mülk gerçeklerine uygulanır; şablon kalemleri kapsam dışıdır (yer tutuculu
metinden "alan" çıkarmak yanlış veri üretir). Mevcut kategoriler bu ayrımı zaten taşıdığı için yeni bir tablo
gerekmez — `TRIGGER_CATEGORIES` tek kaynak olarak kullanılır.

### Sıra (veri bağımlılığı)
**A1 — Kaynak/onay/sürüm alanları (`KnowledgeBaseItem`) · migration 53 ister · ÖNCE**
Her şeyin ön koşulu: taslak ile onaylı ayrımı olmadan ne öneri üretilebilir ne de "onaylı cevap var mı?" sorusu
sorulabilir. Varsayılanlı/nullable eklenir (dolu tabloya required-no-default/unique EKLENMEZ — depo kuralı):
`source` (`legacy` · `host_manual` · `extracted_draft` · `suggestion_accepted`) · `reviewState`
(`legacy` · `approved` · `draft`) · `approvedAt` · `sourceRef` (çıkarımın geldiği metin parçasının PII'siz
işaretçisi — ALINTI DEĞİL) · `supersededById`.

🚨 **ESKİ SATIRLARIN KAYNAĞI VE ONAYI VARSAYILMAZ (kurucu düzeltmesi 09-08).** Planın ilk hâli "mevcut
satırların hepsi `host_manual`+`approved` doğar" diyordu; bu YANLIŞTI. O satırların gerçekte host'un mu
yazdığı, kopyalamayla mı geldiği, hiç gözden geçirilip geçirilmediği KAYIT ALTINDA DEĞİL — bugünkü şemada
böyle bir alan hiç yoktu. Onları "host onayladı" diye damgalamak, veriye sonradan sahte bir gerçek yazmak
olurdu (V0.4'te "çıkarım backfill'i YOK" kararının aynısı). Bu yüzden:
- **Mevcut satırlar `source="legacy"` + `reviewState="legacy"` + `approvedAt=NULL` doğar** = "bu satır onay
  sözleşmesinden ÖNCE vardı; kaynağı ve onayı hakkında hüküm vermiyoruz".
- **Davranış birebir korunur:** AI erişim filtresi allowlist'tir → `reviewState ∈ {legacy, approved}`.
  `legacy` bugün de modele gidiyordu, gitmeye devam eder. Sadece `draft` MODELE ASLA GİTMEZ (kurucunun
  "host onayından önce aktifleşmesin" şartının kod karşılığı).
- Kolon varsayılanı `legacy` olarak KALIR (iki adımlı "sonra host_manual yap" numarası YOK): kuralın adı
  **"kaynağını beyan etmeyen satır legacy'dir"**. Geçmiş satırlar da, yarın kaynağını yazmayı unutan bir
  kod yolu da "bilmiyoruz" der ve hiçbiri sahte onay üretmez. `approved` bir varsayılan DEĞİL, `api/kb`
  POST'unda AÇIKÇA yazılan bir eylemdir — bu sayede o yazımı silen bir mutasyon testlerde YAKALANIR.
- **Genel PATCH `source`/`reviewState`'e DOKUNMAZ** (zod şemasında bu alanlar yok, istemci kendini
  onaylayamaz). Bir `isActive` düğmesi içerik incelemesi değildir; bir içerik düzenlemesinden "host onayladı"
  sonucunu çıkarmak da tam olarak kurucunun yasakladığı varsayımdır. Onay YALNIZ A5'in açık onay yolundan
  gelir. Kopyalama satırın onay soyunu (`source`/`reviewState`/`approvedAt`) AYNEN devralır — böylece ne
  sahte onay üretilir ne de bir taslak kopyalanarak onaylıya dönüştürülebilir.

**A2 — GETİRİLEN ↔ KULLANILAN kaynak izlenebilirliği · migration ister (küçük) · A1'den bağımsız**
🚨 **`usedSources` TEK BAŞINA ayrımı KANITLAMAZ (kurucu düzeltmesi 09-08).** Planın ilk hâli "`usedSources`
boşsa retrieval başarısızlığıdır" diyordu; bu YANLIŞTI. `usedSources` MODELİN BEYANIDIR — modele hiç kalem
verilmemiş olabilir (bilgi yokluğu), kalem verilmiş ama model onu kullanmamış/beyan etmemiş olabilir
(retrieval ya da temellendirme başarısızlığı). İkisi de aynı boş listeyi üretir. Ayrımı yapan tek şey
**KODUN bildiği "ne getirildi"** ile **modelin beyan ettiği "ne kullanıldı"**nın YAN YANA kaydedilmesidir:
- `retrievedCount` — `fetchKnowledgeBaseForPrompt`'un GERÇEKTEN istemde gönderdiği kalem sayısı (koddan,
  beyandan değil) + `retrievedDropped` (tavan yüzünden düşen).
- `usedCount` — modelin `usedSources` beyanından doğrulanmış kalem sayısı.
- Sınıflandırma: `retrieved=0` → **bilgi yokluğu** (öneri üretilebilir) · `retrieved>0 && used=0` →
  **temellendirme/retrieval başarısızlığı** (yeni kalem eklemek YANLIŞ cevaptır; teşhis kaydı) ·
  `dropped>0` → tavan sorunu, ayrı kova.
Taşıyıcı: `RiskEvent`'e iki küçük Int kolonu (PII yok, kalem KİMLİĞİ değil SAYISI). Kalem kimliği saklamak
QR'da misafire hangi sırrın gösterildiğini ima edebileceği için bilinçli olarak DIŞARIDA.

**A3 — Eksik bilgi analizi (üç sınıf) · migration GEREKMEZ · A1+A2 sonrası**
`Signal` verisi zaten akıyor. Kural: mülk × kategori için son 90 günde ≥3 misafir sorusu →
· o kategoride ONAYLI kalem YOK → **bilgi yokluğu** → host'a "ekle" önerisi
· kalem VAR ama sorularda `usedSources` boş → **retrieval başarısızlığı** → öneri DEĞİL, teşhis kaydı
· sinyal `complaint`/operasyonel → **operasyonel talep** → öneri üretilmez (V3 görev konusu)
Öneriler mülk × kategori bazında TEKİLLEŞTİRİLİR, önem sırasına konur; **mesaj başına bildirim YOK**.

**A4 — Kurulum şablonları (madde 1'in hafif hâli) · migration GEREKMEZ · bağımsız, hemen yapılabilir**
Kısa kurulum şablonları `KB_PRESETS` olarak ZATEN VAR (Wi-Fi, giriş, otopark, çöp, kurallar, çıkış) ve tek tıkla
formu DOLDURUYOR, kaydetmiyor — yani "host onayından önce aktifleşmez" şartını bugün de sağlıyor. Yapılacak:
eksik-bilgi analizinden gelen kategoriyi bu şablonlarla eşleştirip "şunu ekle" önerisini tek tıkla doldurulabilir
hâle getirmek. Yeni yapı gerekmez.

**A5 — Host metninden alan önerisi · migration GEREKMEZ (A1'in `draft` durumunu kullanır) · EN SON**
Metin yapıştırılır → deterministik kalıp çıkarımı (saat, "çıkış/giriş", "çöp", "otopark", "wifi") → **taslak**
öneriler. Hedefi yapılandırılmış kolon olan öneri (`checkOutTime`) KB kalemi olarak YAZILMAZ (çift kopya yasağı);
mevcut değerle çelişiyorsa yan yana gösterilir ve **host seçer**. Hiçbir mevcut kalem silinmez/değiştirilmez;
öneri kabul edilirse YENİ kalem `suggestion_accepted`+`approved` olarak doğar, eskisi `supersededById` ile
işaretlenir (iz kaybı yok).
**Mesaj şablonları mülk gerçeği SAYILMAZ** (kurucu, 09-08) — ama içlerindeki AÇIK bilgi taslak öneri
üretebilir: "Çıkış saati 11:00'dir, anahtarı kutuya bırakın" cümlesinden `checkOutTime=11:00` ÖNERİSİ çıkar,
şablonun kendisi kalem olmaz. 🚨 **Yer tutucu gerçeğe DÖNÜŞMEZ:** `{isim}` · `{daire}` · `{tarih}` gibi
işaretler içeren cümleden alan çıkarımı yapılmaz (çıkarılan değer yer tutucu içeriyorsa öneri düşürülür) —
aksi hâlde "Sayın {isim}" metninden misafir adı diye `{isim}` yazan bir "gerçek" üretilirdi.

### Ayrı görünümler (kurucu şartı)
- **"Kurulum ve eksikler"** — host'un tamamlaması gereken işler (A3 önerileri + A4 şablonları).
- **"İncelenecek öneriler"** — metinden çıkarılan taslaklar (A5), her biri onay/ret bekler.
İkisi karışmaz: ilki "bilgi eksik", ikincisi "bilgi önerildi, onayın lazım".

### Durum (09-08)
**A1 KODLANDI — YEREL, PUSH EDİLMEDİ (migration 53 push kapısında).** Yapılanlar:
`prisma/schema.prisma` beş kolon (`source · reviewState · approvedAt · sourceRef · supersededById`) +
`prisma/migrations/53_kb_review_state` (tek `ADD COLUMN` bloğu, hepsi `DEFAULT 'legacy'`/nullable) ·
kapalı kümeler ve TEK onay kapısı `src/lib/kb-review.ts` · AI yolu `lib/ai/kb-fetch.ts` içinde `AND`'lenir
(çağıran ezemez) · şablon gönderici + önizleme + "Gönderilenler" ekranı ortak `GUEST_DELIVERABLE_KB_WHERE` ·
`api/kb` POST açıkça `host_manual`+`approved`+`approvedAt` yazar, PATCH onay iddiası ÜRETMEZ, COPY onay
soyunu devralır · taslak mülk hafızasına da girmez. Kanıt: 21 yeni test (10 + 4 + 7), 11 iki yönlü mutasyonun
tamamı yakalandı, tam kapılar yeşil, boş+dolu tabloda migration zinciri doğrulandı (eski satır `legacy`,
sonraki satır beyan ettiği değer).

**Bilinçli olarak KAPI KONMAYAN host yüzeyleri (A5'te karara bağlanacak):** Bilgi Tabanı ekranı, inbox'ın
mülk bilgisi paneli ve dashboard'daki "aktif bilgi kaydı" sayacı `reviewState`e BAKMAZ. Gerekçe: bunlar
host'un KENDİ verisini gördüğü yüzeyler — taslağı host'tan saklamak zaten amacın tersi. Bugün taslak üreten
yol olmadığı için hiçbiri değişmiş davranış göstermiyor; A5 geldiğinde "Kurulum ve eksikler" / "İncelenecek
öneriler" ayrımı bu üç yüzeyin metnini de netleştirecek (özellikle sayaç: taslak "aktif kayıt" sayılmamalı).

**A2 KODLANDI — YEREL, PUSH EDİLMEDİ (migration 54 push kapısında).** Yapılanlar:
`RiskEvent`'e altı nullable kolon (`kbRetrieved · kbDropped · kbPendingApproval · kbVersionAt ·
srcDeclared · srcVerified`) + `prisma/migrations/54_risk_event_grounding` · `kb-fetch` artık onay
kapısında kalan sayıyı ve bilgi SÜRÜMÜNÜ de döndürüyor (sorgu sayısı artmadan: `count` → `groupBy`) ·
`ai/index.ts` modelin BEYANI ile DOĞRULANANI ayrı taşıyor (`sourceAudit`) — `verifyUsedSources`'ın
sessizce elediği uydurma atıf artık sayılıyor · QR rotası ve dört `auto_reply` karar kaydı sayaçları
yazıyor · okuma tarafı `lib/ai/grounding.ts` (`classifyGrounding`) etiketi HÜKÜM DEĞİL hipotez olarak
döndürüyor (`decisive` bugün hiçbir sınıfta `true` değil) ve yeni kalem önerisini yalnız `absent`
sınıfında meşru sayıyor. Kanıt: 26 yeni test (15 + 5 + 6), 12 iki yönlü mutasyonun tamamı yakalandı,
tam kapılar yeşil (3760 test / 338 dosya), sıfır drift.

### Hâlâ YAPILMAYANLAR (açıkça)
A3–A5 kodlanmadı. Düşük güven bandı (`QR_INFORMATIONAL_BAND_ENABLED`) **gerçek model eval'i bitmeden
AÇILMAYACAK** — varsayılan kapalı kalır. Migration 53 yerelde hazır ve test edildi; taze `pg_dump` + açık
push onayı olmadan GÖNDERİLMEZ. "Kurulum ve eksikler" / "İncelenecek öneriler" ayrı görünümleri A3–A5 ile
gelir; bugün KB ekranı taslak ÜRETMEDİĞİ için değişmedi (üreten yol yokken ayrı sekme boş kutu olurdu).

## Önerilen sıra (bağımlılıkla)
1. **Eksik bilgi tespiti (madde 2)** — veri zaten akıyor, migration gerekmez, değeri en yüksek. Okuma yüzeyi +
   deterministik eşleme kuralı + tekilleştirme/önem sırası.
2. **KB kalemine kaynak/onay/sürüm alanları (madde 4)** — madde 1'in ön koşulu; tek küçük migration.
3. **Host metninden alan önerisi (madde 1)** — taslak + çelişki gösterimi + host seçimi; yapılandırılmış alan
   çakışması engellenir.
4. **Retrieval (madde 3)** — yalnız kalem sayısı/uzunluğu gerçekten tavanı zorladığında; önce kaynak-kimlikli
   parçalama, vektör en son ve ölçümle.

**Bu turda uygulanmadı; V2'ye de geçilmedi.** Mevcut QR güvenlik kısıtları (sır eleme, yetki filtresi, eskalasyon
dalları) bu çalışmada gevşetilmeyecek — madde 4'ün açık şartı ve deponun değişmezi.
