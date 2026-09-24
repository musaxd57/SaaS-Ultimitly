# Anlam katmanı — şema tabanlı niyet çıkarıcı, sorgu yeniden yazma ve bağımsız bekçi (2026-09-24)

> Kurucu (09-24): *"Cümlenin anlamına ve amacına bakıyor muyuz? … kural çalıştırmak zorunda
> kalmazsınız, sistem üç cümlenin de aynı niyete hizmet ettiğini doğrudan anlar. … Trilyonluk
> şirketler LLM'lerle nasıl yapıyorsa öyle yap."*

## 1. Neden (ölçüm)

Müsaitlik vetosunun ilk sürümü kelime kalıplarıyla kuruldu. Uygulamayı görmeyen bir ajanın
yazdığı **kör batarya** (`evals/stay-change.json`, `dev` bölümü: 268 misafir mesajı, 326 cevap,
7 dil) ile ölçüldü:

| sınıf | kelime ağı — `dev` (ilk kör batarya) | kelime ağı — `holdout` (ikinci kör batarya, TEK ölçüm) |
|---|---|---|
| konaklama isteği (ek gece, erken giriş, geç çıkış, tarih değişikliği, müsaitlik sorusu) | 77/125 (%62) | **77/170 (%45)** |
| istek olmayan zor benzerde yanlış alarm | 10/143 → **8/143** | 28/161 → **26/161 (%16)** |
| takvim iddiası ("o gece boş", "doluyuz", "sizden sonra misafir yok") | 31/57 | **26/73 (%36)** |
| izin / söz ("see you at 11", "çıkışınızı 13:00'e aldım", "genelde sorun olmaz") | 19/60 → **20/60** | **13/95 (%14)** |
| erteleme cümlesi tanıma | 70/76 | 44/77 |
| tarafsız cevapta yanlış alarm | 0/118 | 2/127 |

İkinci inceleme turundaki (09-24) oklu değişimler DOĞRULUK düzeltmeleridir, holdout'a bakılarak yapılmadı:
İngilizce kısaltmalar ("you're / we'll / I'll") kalıp yapısı yüzünden hiç eşleşmiyordu; genel müsaitlik kalıbı
öznesizdi ve taksi/market/otopark sorularını istek sayıyordu (↓2.1). Holdout satırları yalnız yeniden ölçüldü.

`holdout`un yanlış alarmları kelime tabanlı yöntemin yapısal sınırıdır: olumsuz ya da vazgeçilmiş istek
("Geç çıkışa gerek yok, 10'da çıkarız"), karşı-olgusal ("Keşke daha uzun kalabilseydik ama…"), olanak
müsaitliği ("14 Ekim'de otopark müsait mi?"), bilgilendirme ("Tarihleri uygulamadan değiştirdim, onaylandı")
ve eş sesli kelime ("Verlängerungskabel", "wifi extender"). Hepsi ANLAM ayrımıdır. Holdout'a bakıp kalıp
yazılmadı; bu hatalar yalnız raporlandı. Yanlış alarmın bedeli taslaktır (güvenli yön). Model katmanları
açılıp ölçülünce kelime ağının istek bacağı yalnız "model katmanı düştüğünde" rolüne indirilebilir
(ayrı karar).

İnsan dili kalıpla kapatılamaz. Görülen hataları kalıpla kapatmak o bataryaya aşırı uyum üretir
("kural çöplüğü"). Kelime ağı bu yüzden **dondu**. Artık yalnız yedek olarak çalışıyor ve yalnız iki
doğruluk hatası düzeltildi (Almanca söz dizimi, Türkçe katlamada "If → ıf"). Ölçülmüş düzeyinin
düşmemesi circirle pinli: `tests/unit/stay-change-backstop-floor.test.ts`.

## 2. Mimari — dört katman, tek karar, hepsi yalnız SIKILAŞTIRIR

```
misafir mesajı ─► [3] ANLAMA KATMANI (LLM, şema) ─► niyetler + yeniden yazılmış sorgular + istek yuvaları
                        │ sorgular                      │ konaklama sinyali
                        ▼                               │
                  retrieval (BM25 + n-gram + [embedding]) ── deterministik alt sorgular ∪ model sorguları
                        ▼                               │
                  cevap modeli ─► reply + [2] ŞEMA BEYANI (stayChangeAsked, replyStance)
                        ▼                               │
                  kod kapısı ─► [4] BAĞIMSIZ BEKÇİ (ikinci LLM, şema) — yalnız otomatik gönderim ADAYI
                        ▼                               ▼
                  evaluateAvailability(yedek [1] + beyan + bekçi + anlama + mülkün standart saatleri)
                        ▼
                  gönder │ taslak (kanal) / devir (QR) + RiskEvent.reason + kbEvidenceJson.sc
```

| katman | dosya | nasıl | varsayılan |
|---|---|---|---|
| [1] deterministik yedek | `ai/availability-claims.ts` | dar kelime ağı; model yokken de çalışır | açık, **büyütülmez** |
| [2] cevap modelinin beyanı | `ai/prompts.ts` (Bölüm 4.5, 12/13, 24 few-shot) + `ai/index.ts` | aynı çağrı, ek maliyet yok; STRICT çözüm | açık (iddia duruşu zorlanır) |
| [3] anlama katmanı | `ai/semantic/understand.ts` + `understanding-schema.ts` | OpenAI Structured Outputs (`json_schema`, `strict`) | `AI_UNDERSTANDING_ENABLED=1` |
| [4] bağımsız bekçi | `ai/semantic/guard.ts` | ikinci model, yalnız aday taslak | `AI_STAY_GUARD_ENABLED=1` |

Ortak: `ai/semantic/stay-change.ts` (kapalı kümeler, çözücüler, KODDA saat kıyası, politika kipi),
`ai/semantic/structured-call.ts` (tek ağ kapısı; 64 KB tavan, kalıcı arıza geçiş alarmı `semantic`
kanalı), `ai/semantic/config.ts` (anahtar/model/zaman aşımı tek kaynak).

### 2.0 Değişmez: BELİRSİZLİK GÜVENLİ DEĞİLDİR (kurucu, 09-24)

Ölçülen açık (kurucunun ve dış incelemenin tarifi): **"bekçi çöktü → kelime ağı bir şey bulamadı → cevap
otomatik gitti."** Sonda ile yeniden üretildi: bekçi düşmüş (ya da bayrak kapalı) + cevap modelinin beyan alanları
eksik + niyet etiketi `early_checkin` + örtük izin ("See you at 11!") → kapı `null` döndürüyordu. Üstelik bir
test bu davranışı "KONTROL: kapı eski davranışta (GEÇER)" diye pinliyordu.

```
HASSAS İSTEK (herhangi bir katman)           ve   herhangi bir güvenlik sinyali
  kelime ağının isteği                             YOK (bekçi kapalı)
  cevap modelinin beyanı / niyet etiketi           DÜŞTÜ (zaman aşımı, bozuk JSON)
  bekçinin isteği (ret, kaydırılmış saat)          TANINMIYOR / EKSİK (beyan alanı yok)
  anlama katmanının isteği                         ÇELİŞİYOR (beyan "istek yok", etiket "erken giriş")
                                             =>  OTOMATİK GÖNDERİM YOK (insana)
```

* **Kelime ağı yalnız ENGELLER.** Sessizliği izin değildir; erteleme cümlesi de artık izin değildir (yalnız
  kanıtta `lx: d`). Eskiden beyan yokken kelime ağının erteleme cümlesi TEK BAŞINA, beyan `defers` iken ikinci
  anahtar olarak isteği serbest bırakıyordu.
* **Bekçi yoksa erteleme kanıtlanamaz** → hassas istek her kipte, devir cevabında da insana. Bekçi kapalı
  (üretim varsayılanı) ile bekçi düşmüş aynı muameleyi görür: doğrulayıcı yok.
* **Her arızada her mesaj durmaz:** hiçbir katmanda hassas istek yoksa ("Check-in saati kaç?" + mülkün saati)
  karar yalnız iddia bacağına kalır ve cevap gider. Bilgi sorusunu izin talebinden ("Saat 12'de gelebilir
  miyiz?") ayıran, katmanların İSTEK sinyalidir.
* Kanal yolunda tutulan devir cevabı (niyet `human_request`, `riskType: human_request`) mevcut acil yükseltme
  yolundan host'a e-posta ile bildirilir; QR'da misafir dürüst devir metnini görür.
* Ürün etkisi (bilinçli): bekçi açılana kadar erken giriş / geç çıkış / uzatma / tarih isteklerine OTOMATİK
  cevap gitmez, taslak host'a düşer (isteğe bağlı deterministik bekletme mesajı aynen çalışır). İki model
  hemfikir olduğunda (bekçi açık) doğru erteleme yine otomatik gider.

### 2.1 Karar kuralı (`evaluateAvailability`)

* **HASSAS İSTEK:** GÜÇLÜ sinyaller (isteğe ayrılmış alanlar): kelime ağının isteği · bekçinin isteği (ret ya da
  **kodda** standart dışı bulunan saat dahil) · beyan edilen istek (tanınmayan `asked` dahil) ya da ret · anlama
  katmanının isteği. ZAYIF sinyal: cevap modelinin niyet etiketi (`early_checkin`/`late_checkout`) — istem bu etiketi
  konu SORULARINA da verir ("erken check-in sorusu"), bu yüzden tek başına bekçinin "istek yok"unu ezmez.
* **İDDİA** (her kipte, devir cevabında da): kelime ağının iddiası · beyan `grants`/`states_calendar`
  · bekçinin takvim/izin hükmü · **tanınmayan duruş** (her durumda — geçerli bir izin duruşundan gevşek olamaz) ·
  **beyan hiç yok** ve hassas istek var → `availability_claim`.
* **DOĞRULAYICI YOK** (bekçi kapalı ya da düştü) + hassas istek (güçlü ya da zayıf) → `availability_unconfirmed`
  (kip ve erteleme ne olursa olsun).
* **İSTEK** (bekçi koştu): herhangi bir GÜÇLÜ sinyalin isteği → **erteleme kanıtı yoksa** `availability_unconfirmed`,
  her kipte; **devir cevabı da muaf değil** ("Tabii. Mesajınız kaydedildi…" bir geç çıkış isteğine EVET gibi
  okunur). Zayıf sinyal tek başına yalnız `AI_STAY_POLICY=enforce` ile karar verir.
* **Düşmanca inceleme (09-24, değişmezden sonra):** bekçinin tek başına "istek yok" hükmü beyanın ve anlama
  katmanının isteğini susturuyordu (P1-1); devir cevabı iki model kuralını atlıyordu (P1-2); niyet etiketi ile
  beyanın "çelişkisini" iddia saymak bilgi sorularını kalıcı tutup bekçiyi hiç çağırtmıyordu (P2-2); tanınmayan
  duruş bağlamsız izni geçiriyordu (P2-3). Dördü de kırmızı-önce testle kapatıldı.
* **ERTELEME = iki bağımsız model:** güvenilir beyan `defers` (çelişkisiz) **ve** bekçinin
  `reply_defers_to_host` hükmü. Kelime ağı bekçinin "ertelemiyor" hükmünü ezemez.
  - Erteleme = kararın ev sahibine AİT olduğunu söylemek. "Mesajınız kaydedildi" tek başına erteleme
    değildir (yalnız kayıt bildirir). "Ev sahibiniz onaylar / onaylayacaktır" da erteleme değildir, onayı
    önceden kestirir. "Ev sahibinizin onayına bağlı" ise ertelemedir. (Kelime ağının erteleme tanıması
    kanıt ve yedek ölçüsü olarak kalır.)
* **BEYANIN GÜVENİLİRLİĞİ** (F01 kuralı): beyan yoksa, duruş kapalı küme dışındaysa (`unknown`) ya da beyan
  "istek yok" derken aynı modelin niyet etiketi `early_checkin`/`late_checkout` ise duruş BİLİNMİYOR sayılır;
  hassas istek varsa cevap iddiadır. Yedek (şablon) cevapta (`source: "fallback"`) ortada model duruşu yoktur,
  bu kural uygulanmaz (host uyarısı "takvim iddiası" değil "istek var" der).
* **EV SAHİBİNİN TEKLİFİ** (Ayarlar'daki geç çıkış teklif metni): istemin gösterdiği aynı temizlenmiş
  metin kelime ağının iddia taramasından çıkarılır. Ev sahibinin kendi sözünü aktarmak iddia değildir.
  Bekçiye de "ev sahibinin teklifi" olarak gösterilir: olduğu gibi aktarmak ertelemedir; değiştirmek,
  belirli bir güne onaylamak ya da üstüne izin eklemek izindir.
* **SAAT KODDA:** `H:MM` ve `HH:MM` kabul edilir, sıfır dolgulu biçime getirilir. Gece 05:00'ten önceki
  bir giriş saati geç varıştır, erken giriş sayılmaz (00:30 varış 15:00 girişten "erken" değildir).
* **TEKLİF MUAFİYETİ YALNIZ ERTELEMEYLE** (ikinci inceleme): teklif metni ancak cevap kararı ev sahibine de
  bırakıyorsa iddia taramasından çıkarılır; erteleme teklifin DIŞINDA aranır (teklifin kendi "müsaitlik varsa"sı
  kendini onaylayamaz). Teklifi aynen aktarıp ertelemeyen cevap bir güne izin gibi okunur → iddia. Bekçi koştuysa
  erteleme onun hükmüyle; koşmadıysa güvenilir `defers` beyanı + erteleme cümlesi yalnız teklif metnini iddia
  taramasından çıkarır — izin DEĞİLDİR (hassas istek bekçisiz yine tutulur), ama ilk geçişin bekçiyi
  çağırabilmesi için şarttır (iddia tutuşu bekçiyi tetiklemez). Bilgi sorusuna eklenen teklif eskisi gibi gider.
* **STANDART ÇIKIŞ BİLGİSİ İZİN DEĞİL** (son denetimde DARALTILDI): "Çıkış günü 11:00'e kadar kalabilirsiniz /
  you can stay until 11:00 on your departure day" izin sayılmaz. Saat KODDA kıyaslanır. Kural yalnız izin
  kalıplarına uygulanır; takvim kalıbının saat bastırması korunur. Dört şart birlikte aranır:
  - saat mülkün çıkışına BİREBİR eşit (am/pm'siz 1–6 dakikalı da olsa öğleden sonra; 12am / 00:00 = 0);
  - cümlecikte tarih, gün, akşam ya da uzatma işareti yok ("on your departure day" / "çıkış günü" gün sayılmaz);
  - cevapta olumlu onay yok ("Sure!", "Tabii");
  - Türkçe ek yalnız yönelme eki ('e/'a/'ye/'ya).

  İlk sürüm "≤" kıyası yapıyordu ve 22 gerçek izni gizliyordu: "until 2:30", "Akşam 7'ye kadar", "until 12am",
  "until 10 October", "11:00 on Sunday", "8 gün kadar". Mülkün çıkış saati bilinmiyorsa eski davranış
  sürer (izin sayılır).
* **GENEL MÜSAİTLİK KALIBININ ÖZNESİ** (son denetimde DARALTILDI): yalnız nesnenin müsaitlik fiiline ya da
  yüklemine BİTİŞİK olduğu üçüncü taraf yapısı silinir. Örnekler: "book a taxi", "is the supermarket open",
  "taksi ayırt-", "otopark müsait mi", "restoranda yer var mı", "Parkplatz … frei".
  - Genel kalıp KALAN metinde yeniden aranır; hiçbir şey silinmediyse sonuç eskisiyle birebir aynıdır.
  - Silme izin yönlüdür, bu yüzden tek kanonik biçimde yapılır.
  - İlk sürüm nesne sözcüğü mesajın herhangi bir yerinde geçince susturuyordu ve gerçek istekleri düşürüyordu:
    "We love the BEACH", "come by CAR", "OTOPARK var mı?", "TAKSİT", "ARACılığıyla", "MASAL".
  - Uzatma, erken/geç giriş-çıkış ve tarih değişikliği kalıplarına uygulanmaz.
  - Kapalı sınıftır, genişletilmez. Bilinen sınır güvenli yöndedir: nesnesi önceki yan cümlede kalan fiil
    ("…kiralamak istiyoruz, nereden kiralayabiliriz?") istek sayılır.
  - Kör batarya: istek TP/FP dev 77/8, holdout 77/26. Bu sayılar ilk sürümle aynıdır, yani ölçülmüş yanlış
    alarm düzeltmeleri korundu.
* **KISALTMALAR** (doğruluk düzeltmesi): "'s", "'re", "'ve" ve U+02BC kesmesi kapsandı. Açık biçimleri ("is",
  "are", "have") zaten kapsanıyordu.
* **BEKÇİ TUTUŞTA DA KOŞAR:** bekçi yalnız otomatik gönderim adayında değil, tek engeli `availability_unconfirmed`
  olan taslakta da koşar (kanal + QR). Böylece kelime ağının tanımadığı doğru ertelemeler ("Das muss Ihr Gastgeber
  entscheiden") iki bağımsız modelin (beyan + bekçi) birlikte hükmüyle gidebilir; tek model yine gevşetemez.
* **ANLAMA KATMANI DÜŞTÜYSE** kanıtta `u: "failed"` yazar ("off"tan ayrı); karar değişmez.
* **GEREKÇE:** `RiskEvent.reason` kapının İLK düşen kontrolünden gelir. Müsaitlik kodu yalnız müsaitlik
  kontrolü kapattıysa yazılır; model arızası ya da başka bir veto "Müsaitlik" satırına sayılmaz. `sc`
  kanıtı ayrıca politikanın ne dediğini yine ölçer.
* Erteleme dedektörü tek biçimle çalışır: küçük harf + Türkçe ASCII katlama. Homoglif ve görünmez
  karakter adayları yalnız KISITLAYICI dedektörlerdedir (CLAUDE.md katlama kuralı).

### 2.2 Kipler ve gölge ölçümü

`AI_STAY_POLICY` varsayılanı **gölgedir** ve artık tek bir şeyi yönetir: bekçi koşup istek görmediğinde cevap
modelinin **niyet etiketi tek başına** tutsun mu. Bekçi yoksa ya da düştüyse ↑2.0 değişmezi her kipte tutar; güçlü
sinyaller (beyan, anlama katmanı, bekçi, kelime ağı) her kipte karar verir. `enforce` kipinin kararı **her zaman** hesaplanır ve `kbEvidenceJson.sc.ev` alanına yazılır.
Böylece açmadan önce gerçek trafikte "açsaydık kaç taslak daha çıkardı" okunabilir: `sc.v` ile
`sc.ev` farkı.

`sc` kanıt alanı (PII yok, kapalı küme):

| alan | anlam |
|---|---|
| `v` / `ev` | uygulanan karar / `enforce` kipinin kararı (`-` = temiz) |
| `lx` | kelime ağı: `c` iddia, `r` istek, `d` erteleme |
| `d` | beyan `asked/stance` ya da `absent` |
| `g`, `gv` | bekçi `off/ok/failed`; hüküm `q` istek, `s` takvim, `a` izin, `d` erteleme, `x` ret, `t` kaydırılmış saat |
| `u` | anlama katmanı `off/req/none/failed` |
| `ri` | cevap modelinin niyet etiketi konaklama değişikliği adlandırıyorsa (`early_checkin`/`late_checkout`); yoksa alan yok |

Retrieval kanıtına (`retrieval`) anlama katmanından `uq` (eklenen sorgu sayısı), `uf` (geri çekilmede öne
alınan kalem), `un` (`ok/cached/failed`), `unMs` ve `ui` (niyet etiketleri) girer. `q` yalnız deterministik alt
sorgulardır. Katman retrieval'da beklenmediyse (paralel koştu) `un/unMs/ui` kapıdan sonra
`evidenceAfterUnderstanding()` ile eklenir. Sorgu **metni girmez**.

### 2.3 Risk niyetleri kapıda (`semantic/intent-risk.ts`, `AI_INTENT_POLICY`)

Anlama katmanı yalnız konaklama değişikliğini değil, mesajın **niyetini** de kapalı bir kümeye indirir. Bu
niyetlerden dördü kapıya bağlıdır: acil durum > şikâyet > iptal/iade > insan talebi. Öncelik bu sıradadır ve
kanıta tek kod yazılır.

**Neden gerekli (ölçüldü, 09-24).** Aşağıdaki mesajlar kelime ağını ve risk etiketi dedektörünü GEÇİYOR.
Bugün tek savunma cevap modelinin kendi etiketi:

| Mesaj | Niyet |
|---|---|
| "My daughter cut her hand badly, where is the nearest hospital?" | acil |
| "Kapının kilidi takılıyor, dışarıda kaldık." | acil |
| "There are ants all over the kitchen counter." | şikâyet |
| "Komşular gece boyunca bağırdı, hiç uyuyamadık." | şikâyet |
| "I would like to get back the amount for the last two nights." | iade |
| "Can I speak with the owner directly please?" · "Ev sahibiyle bizzat konuşabilir miyim?" | insan |

**Kurallar:**

* **Yalnız sıkılaştırır:** sinyal bir gönderimi engelleyebilir, hiçbir zaman sebep olamaz.
* **Varsayılan gölge:** `AI_INTENT_POLICY=enforce` yoksa karar vermez. `enforce` kararı her koşuda
  hesaplanır ve kanıta yazılır.
* **Son kontrol:** kanal kapısında güven eşiğinden sonra, QR'da iki geçiş çıkışının (bilgi bandı ve tam güven)
  önünde durur. Gerekçe `understanding_risk` yalnız başka hiçbir kontrol kapatmadığında görünür. Gölge
  ölçümün sorusu tam olarak budur: "yalnız anlama katmanı neyi yakalardı?"
* **İnsan talebi:** cevap modelinin kendi devir cevabı (`intent === "human_request"`) muaftır, kelime
  ağındaki kuralla aynı. Acil, şikâyet ve iptal devir cevabında da muaf değildir.
* **Katman kapalı ya da düştüyse:** sinyal yoktur ve davranış birebir eskisidir. Kanıtta `ir` alanı da yazılmaz.
* **Parite:** kanal kapısı, QR kapısı ve Ayarlar önizlemesi aynı yüklemi kullanır. Gerekçe kodu RiskEvent
  kümesindedir. Raporlarda "Hassas konu — size bırakıldı" satırı yalnız sayı sıfırdan büyükse görünür.
* **Kanıt** `kbEvidenceJson.ir = { v, ev, k }`: uygulanan karar, `enforce` kararı ve niyet kodu. Yalnız
  kapalı küme kodlar taşınır, metin taşınmaz.
* **E-posta (kurucu "sen seç", 09-24 → EVET, yalnız `enforce`):** kanal kapısını YALNIZ anlama katmanının risk
  niyeti kapattıysa, model kaynaklı hassas sinyalle aynı acil yükseltme yolu koşar: konuşma "Sorunlu" + acil,
  ev sahibine e-posta (atomik claim: aynı konuşmaya ikinci e-posta yok). Gerekçe: sinyalin anlamı zaten
  "insana"; sessiz taslak, dolaylı dildeki acil durum ve şikâyetin host'a GEÇ ulaşması demekti. Rozet
  (`lastRiskType`) ve karar kaydı niyetin etiketini taşır (acil → `safety_emergency`, şikâyet → `complaint`,
  iptal-iade → `money_refund`, insan → `human_request`); karar kaydının gerekçesi `understanding_risk` kalır.
  Gölge kipte kapı kapanmaz, e-posta da gitmez. QR'da devir zaten host'a bildirilir.

## 3. Sorgu yeniden yazma / çoklu sorgu (kurucunun Gemini örneği)

"Giriş saati kaçtı bir de evcil hayvan getirebiliyor muyduk?" → anlama katmanı iki istek üretir:
`checkin_time` → "giriş saati check-in", `pets` → "evcil hayvan kabul politikası". Bu sorgular
deterministik alt sorgulara **birleşim** olarak eklenir. Hiçbir alt sorgunun yerine geçmez, adayı
daraltmaz, bilgi tabanına kalem ekleyemez (seçilebilecek küme yetki, onay ve sır süzgeçlerinden
önce kurulur). Aynı sorgular embedding açıkken ham metinleriyle gömülür.

Birleşimin üç sınırı var (inceleme 09-24; model sorguları deterministik davranışı asla kötüleştiremez):

* **Sıra:** güncel mesajın alt sorguları → cevapsız önceki sorular → modelin sorguları (en fazla 6; ÖNCE her
  isteğin Türkçesi, SONRA özgün dil — Türkçe olmayan misafirin 4.–5. sorusu da sorgu alır).
* **Pay:** modelin sorguları bütçenin en fazla **üçte birini** alır — KARAKTER ve PARÇA olarak, gerçekten isteme
  girenle ölçülür. Ek sorgunun çektiği saat çelişkisi partnerleri de onun payına sayılır (özgün sorunun
  çelişkisini tamamlayan partner özgün sayılır). Misafirin kendi sorusu bütçeden itilemez. Paya sığmayan ek-sorgu
  parçası ATLANIR ve bütçe kesmesini tetiklemez (son denetim: önce bütçe kontrolü gelince sığacak özgün parçalar
  dışarıda kalıyordu).
* **Tekrar eden konu pay yemez:** ek sorgunun en iyi PARÇASI, özgün bir sorgunun ilk 3 parçasından biriyse o ek
  sorgu seçime katılmaz. Kıyas parça düzeyindedir (son denetim: kalem kimliğiyle kıyas, çok parçalı bir kılavuzun
  wifi bölümü çıkınca aynı kılavuzun evcil hayvan bölümünü soran ek sorguyu da düşürüyordu).
* **Bağlam taşınmaz:** önceki misafir mesajlarının kökleri ek sorguya eklenmez (bağlamı model zaten çözdü).
* **Geri çekilme daralmaz:** deterministik sorguların hiç isabeti yoksa legacy kümesi (en yeni ≤30) AYNEN
  kalır, kırpılmaz. Modelin isabetleri en fazla 4 öğe olarak ÖNE gelir ve ön ekin TOPLAMI ≤3.000 karakterdir
  (taşınan bütün kalemler + eklenen parçalar birlikte). Legacy'deki kalem tavana sığıyorsa bütün olarak taşınır;
  sığmıyorsa ya da legacy dışındaysa yalnız eşleşen PARÇASI öne eklenir, legacy kalemi yerinde kalır. Son denetim:
  taşıma sayılmıyordu, 19k'lık bir kılavuz öne alınınca istemin açgözlü doldurması legacy'nin sığdırdığı onlarca
  kalemi dışarı itiyordu. Saati dizinde başka bir parçayla çelişen parça hiç eklenmez (bu dal çelişki
  korumasından geçmez). Legacy bloğundan en fazla bu kadar içerik yer değiştirir.
* **Redaksiyon:** anlam katmanına giden metinde geçerli tarih/saat dizileri ve BİTİŞİK tarih/saat aralıkları
  ("10.00-12.00", "12.10.2026-14.10.2026") korunur; telefon biçimleri yine redakte edilir.
* Selamlaşma/teşekkür (`greeting_thanks`) sorgu üretmez. Türkçe karakter 3-gram'ı sorgu başına açılır
  (Türkçe yeniden yazım için açık, özgün dilde yazılmış sorgu için dilin kendisine göre).

Kazanımlar (pinli: `tests/unit/understanding.test.ts`):

* **Eş anlamlı ve çok dilli sorular.** "Gibt es hier eine Schwitzkabine?" kelime aramasında
  hiçbir şey bulmuyor. Büyük bilgi tabanında eski sauna kalemi geri çekilme kümesinin dışında
  kalıyor. Yeniden yazılmış "sauna" sorgusuyla kalem kümenin **başına** geliyor (`fb:
  no_lexical_hits` korunur, küme daralmaz).
* **Bağlam çözümü.** "Peki büyük köpek?" önceki konuşmadan "evcil hayvan köpek kabul" olur.
* Katman kapalıyken sonuç `selectKbForPrompt` ile **birebir** aynı ve ağ çağrısı yok
  (davranışsal pin). Katman düşerse sonuç eski davranışla aynı, kanıtta `un: failed` yazar.

## 4. Veri, maliyet, gecikme

* **İşleyen:** OpenAI. Cevap üretiminin zaten kullandığı işleyen olduğu için **yeni alt-işleyen yok**.
  Modele gitmeden önce bilinen adlar ve değer biçimli PII (telefon, e-posta, uzun kod) redakte
  edilir (`shadow-ai.ts` ile aynı sıra). **Tarih ve saatler korunur** (`ai/semantic/redact.ts`): isteğin
  kendisi onlardır; genel redaksiyon "2026-10-14"ü uzun kod sanıp siliyordu.
* **Ayraç güvenliği:** veri bloklarını sınırlayan `<<<`/`>>>` dizilerinin taklidi silinir; iki ve daha
  fazla açılı ayraç ÇALIŞMASI bütünüyle gider (tek geçişte `<<<` silmek `>><<<>` girdisinden yeni bir
  `>>>` üretiyordu).
* **Maliyet:** anlama katmanı mesaj başına bir küçük çağrı yapar (süreç içi 10 dk önbellek var).
  Bekçi yalnız otomatik gönderim adayında bir küçük çağrı yapar. Beyanın ek maliyeti yok.
* **Gecikme:** anlama katmanı YALNIZ retrieval sorgulara ihtiyaç duyduğunda (hibrit + büyük bilgi
  tabanı) beklenir. Tipik host bilgi tabanında (küçük KB) ya da legacy acil durdurmada cevap
  üretimiyle **paralel** koşar ve yalnız kapıdan önce beklenir. Bekçi gönderimden önce koşar. Zaman
  aşımları `AI_SEMANTIC_TIMEOUT_MS` ile ayarlanır (reasoning 12 sn, klasik 6 sn, **tavan 20 sn**: QR yolunda
  anlama + cevap + bekçi ardışık koşabilir; 60 sn'lik eski tavan `qr-in:` talebinin 120 sn TTL'ini aşıp
  misafirin yeniden denemesini ikinci kez işletebiliyordu).
* **Model:** `AI_SEMANTIC_MODEL`; boşsa `OPENAI_MODEL`. Reasoning modelinde düşünme çabası
  `AI_SEMANTIC_REASONING_EFFORT` (none/minimal/low/medium/high; boşsa gönderilmez). Küçük ve hızlı bir
  model ya da düşük çaba seçmek maliyet ile gecikme kararıdır; önce eval ile ölçülür.
* **Kalıcı arıza alarmı:** kota/anahtar/model arızasına ek olarak 400 "desteklenmeyen parametre / değer /
  şema" da kalıcıdır (sınıf `request`): model değişince her çağrı sessizce ölmesin diye geçiş tabanlı
  alarm gider (`model-provider:semantic`). Sıradan 400 (uzunluk, içerik) alarm değildir.

## 5. Açma sırası (kurucu kararı; hiçbiri ölçmeden açılmaz)

1. OpenAI kredisi yüklenir. Bu ortamdaki anahtar 09-23'ten beri `insufficient_quota` veriyor.
2. `RUN_REAL_EVAL=1 npm run eval -- tests/eval/stay-change.eval.test.ts` koşulur. Rapor
   `docs/olcum/stay-change-eval-<tarih>.md` dosyasına yazılır. Genelleme ölçüsü **yalnız `holdout`**
   satırlarıdır. Tek bir çağrı düşerse rapor GEÇERSİZ sayılır.
3. `AI_UNDERSTANDING_ENABLED=1` açılır: sorgu yeniden yazma ve anlama. Karar etkisi gölgede kalır.
4. `AI_STAY_GUARD_ENABLED=1` açılır: bekçi zorlar, gölgede değildir.
5. 1–2 hafta `RiskEvent.kbEvidenceJson.sc` izlenir: `v` ile `ev` farkı ve gereksiz taslak oranı.
6. `AI_STAY_POLICY=enforce` açılır.
7. Aynı gölge dönemde `kbEvidenceJson.ir` de izlenir: `ev = understanding_risk` olan kayıtlar gerçekten hassas
   mıydı (ev sahibinin sonraki cevabı ve konuşma durumu)? Yanlış alarm oranı kabul edilebilirse
   `AI_INTENT_POLICY=enforce` açılır.

Hepsi tek env ile geri alınır. Migration yok.

## 6. Doğrulanmış takvim gelince (Airbnb Direct)

Kural "iddia yasak" değildir. Kural, iddianın **yalnız doğrulanmış takvim sonucuyla eşleşmesi**dir.
Müsaitlik motorunun `verified` kararı `verifiedToolResults` olarak isteme girdiğinde:

* beyan `grants` ya da bekçinin izin hükmü, doğrulanmış sonuçla eşleşiyorsa geçirilir (ayrı dilim +
  golden set);
* anlama katmanının saat ve tarih yuvaları motorun sorgusu olur.

Sohbetteki "kalabilirsiniz" rezervasyonu değiştirmez. Uzatma, platform değişiklik talebinin
onaylanmasıyla kesinleşir; otomatik onay = V3 Aksiyonlar.

## 7. Bilinen sınırlar

* Model katmanları **ölçülmedi**: kredi yok. Bayraklar kapalı, kararlar gölgede.
* Beyan aynı modelden gelir; enjeksiyonla kandırılan üretici etiketini de yanlış yazabilir. Bu
  yüzden izin yönlü karar tek beyana dayanmaz. Bekçi ikinci, bağımsız hükümdür.
* Anlama katmanı küçük bilgi tabanında da koşar: sinyal retrieval'dan bağımsız değerlidir, ama
  maliyeti vardır.
* Önizleme yüzeyleri (Ayarlar testi, landing demo) ve inbox önerisi bekçiyi çalıştırmaz. Beyan ve
  yedek aynıdır. Inbox önerisi uyarıyı kapıyla aynı politikadan ve aynı girdiyle (cevapsız misafir
  mesajlarının tamamı) hesaplar (`tests/integration/ai-suggest-availability.test.ts`).
* Bekçi, takip izinlerini anlamak için cevapsız mesajlardan önceki konuşmanın son 6 mesajını görür
  ("Peki 13:00?" → "Evet, olur!"). Daha eski bağlam gitmez.
