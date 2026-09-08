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
**A1 — Kaynak/onay/sürüm alanları (`KnowledgeBaseItem`) · migration ister · ÖNCE**
Her şeyin ön koşulu: taslak ile onaylı ayrımı olmadan ne öneri üretilebilir ne de "onaylı cevap var mı?" sorusu
sorulabilir. Nullable/varsayılanlı eklenir (dolu tabloya required/unique EKLENMEZ — depo kuralı):
`source` (`host_manual` varsayılan · `extracted_draft` · `suggestion_accepted`) · `status`
(`approved` varsayılan · `draft`) · `approvedAt` · `sourceRef` (çıkarımın geldiği metin parçası, PII'siz kısa
alıntı DEĞİL, yalnız satır no/uzunluk) · `supersededById`. **Mevcut satırların hepsi `host_manual`+`approved`
doğar → davranış birebir aynı.** AI erişimi bugünkü `isActive` filtresine `status: "approved"` şartını EKLER;
yani taslak bir kalem MODELE ASLA GİTMEZ (kurucunun "host onayından önce aktifleşmesin" şartının kod karşılığı).

**A2 — `usedSources` kaydı · migration ister (küçük) · A1'den bağımsız, eksik-bilgi analizinin ön koşulu**
Bugün modelin hangi kaleme dayandığı ölçülüyor ama SAKLANMIYOR. Üç sınıfı (bilgi yokluğu / retrieval
başarısızlığı / operasyonel talep) ayırmanın tek yolu bu: aynı soru için kayıt VAR ama `usedSources` BOŞ ise bu
bir **retrieval başarısızlığıdır**, yeni kalem eklemek yanlış cevaptır. `RiskEvent`'e `usedSourceCount` (Int?)
veya ayrı bir küçük tablo; PII yok.

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

### Ayrı görünümler (kurucu şartı)
- **"Kurulum ve eksikler"** — host'un tamamlaması gereken işler (A3 önerileri + A4 şablonları).
- **"İncelenecek öneriler"** — metinden çıkarılan taslaklar (A5), her biri onay/ret bekler.
İkisi karışmaz: ilki "bilgi eksik", ikincisi "bilgi önerildi, onayın lazım".

### Bu turda YAPILMAYANLAR (açıkça)
A1–A5'in hiçbiri bu turda kodlanmadı; bu bölüm plandır. Düşük güven bandı (`QR_INFORMATIONAL_BAND_ENABLED`)
**gerçek model eval'i bitmeden AÇILMAYACAK** — varsayılan kapalı kalır. Migration'lar yerelde hazırlanır ve
taze `pg_dump` + açık push onayı olmadan gönderilmez.

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
