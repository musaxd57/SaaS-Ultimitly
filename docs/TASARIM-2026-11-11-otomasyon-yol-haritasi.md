# Daha otomatik, bir o kadar güvenli: otomasyon yol haritası (tasarım — kod YOK)

> Kurucu 11-10 / 11-11: "sistemi birazcık daha fazla içinde otomasyon bulunan AaaS tipine de yaklaştıralım; manuellikten uzaklaşıp daha
> otomatik ama bir o kadar da güvenli" + başlık listesi (dinamik bilgi tabanı + canlı veri araçları · kısa / uzun süreli hafıza ·
> karmaşıklığa göre yönlendirme · deterministik yürütme, katı şema, istem iyileştirme · ek satışın geri ödemesi · Debezium / Kafka Connect ·
> CRDT ya da olay kaynağı · ileride Railway yanında Akash, önce %10 / %90).
>
> Bu belge karar DEĞİL öneridir: her başlıkta **bugün kodda ne var** (11-11, üç tarama ajanı + kodda teyit), **ne eksik**, **önerim** ve
> **kurucu sorusu**. Müşteriye / misafire giden her değişiklik ayrıca önce → sonra örneğiyle sorulur. Ücretli ölçüm ancak kurucu "şimdi" deyince.

## 0. Sınırlar (değişmez — bu belgedeki hiçbir öneri bunları gevşetmez)
- Yapay zekâ karar verici değil yardımcı operatör; riskli / belirsiz mesaj insana kalır.
- Canlı olgu (müsaitlik, rezervasyon, ücret, görev durumu) model hafızasından değil **kodun doğruladığı sonuçtan** gelir (kurucu talimatı 09-07).
- Misafire söz verilmez; özür / kusur kabulü / tazminat yok; misafire giden her metin ev sahibinin ağzından (ben / biz).
- Airbnb / Booking mesajına ek hizmet teklifi, fiyat, dış bağlantı yazılmaz; Lixus para tutmaz.
- Migration, anahtar açma, müşteriye giden yeni metin: kurucu onayı. Model değişimi: ölçüm (A/B) + onay.

## 1. Kavram kavram: bugün ne var, ne eksik

### 1.1 Dinamik bilgi (RAG + canlı veriye erişen araçlar)
| | Bugün | Durum |
|---|---|---|
| Bilgi tabanı getirme (sözcüksel, karma sıralama) | `src/lib/ai/retrieval/**`, tek boğaz `selectKbForPrompt` | AÇIK |
| Anlamsal (gömme) kaynak, model yeniden sıralayıcı | `KB_SEMANTIC_RETRIEVAL`, `KB_RERANK_ENABLED` | kodda var, anahtar kapalı (canlıda anlamsal açıktı) |
| Müsaitlik — kodun hesapladığı tek cümle | `ai/verified-availability.ts`, `ai/tools/availability-tool.ts` | kodda var, **kapalı** |
| Konaklama uzatma | `ai/verified-extension.ts` | kodda var, **kapalı** |
| Tarih okuma ("yarın", "cuma") | `ai/date-reading.ts` | kodda var, **kapalı** |
| Erken giriş (kural + temizlik kanıtı + takvim) | `src/lib/early-checkin/**` | AÇIK (kural yoksa ev sahibine) |
| Modelin kendisinin araç çağırması (function calling) | — | **YOK** (bilerek) |

**Değerlendirme.** İstenen "RAG + Text-to-SQL / API araçları"nın güvenli hâli bizde zaten kurulmuş: aracı **model değil kod** çağırıyor
(anlama katmanı niyeti söyler → kod ilgili doğrulayıcıyı çalıştırır → sonuç cümlesini kod kurar ya da olgu olarak isteme koyar). Modelin
serbestçe SQL yazması önerilmez: kiracılar arası sızma, enjeksiyon ve "aynı soruya iki farklı sonuç" riski; ayrıca kurucunun 09-07 kuralına
("canlı olgu yalnız doğrulanmış araç sonucundan") ters düşer.

**Eksik olan:** (a) yazılmış araçların üçü kapalı duruyor — ölçülüp açılmadı; (b) araç yelpazesi dar. Sıradaki adaylar (hepsi salt-okuma,
kiracı kapsamlı, sonucu kod kurar): rezervasyon olguları (giriş / çıkış günü, kişi sayısı), görev durumu ("temizlik bitti mi" — yalnız ev
sahibine / ekibe), giriş bilgisinin gönderilip gönderilmediği, geç çıkışın ertesi gün takvimine etkisi. (c) `ai/tools/contract.ts` ortak
sözleşmesi yazılmış ama hiçbir isteme bağlı değil → araçlar tek kayıt defterinden (ad · sürüm · girdi şeması · çıktı şeması · kimin
görebileceği) geçmeli; yeni araç eklemek tek dosyalık iş olmalı.

**Ev sahibi tarafı ("Ask Lixus").** "Bu ay kaç gece doluyum?", "en çok hangi dairede şikâyet var?" gibi sorular için de serbest SQL yerine
**hazır, parametreli sorgu kataloğu** (anlam katmanı): model yalnız "hangi sorgu + hangi parametre" seçer, sorguyu kod çalıştırır.

### 1.2 Kısa süreli hafıza (konuşma içi)
- Konuşma penceresi: son 25 mesaj + son cevap (`channel-thread-window.ts`) — AÇIK.
- Konuşma kayıtları (kodun kurduğu, metinsiz durum özeti: hangi aşamadayız, ilk cevap mı, önceki söz ne) — `ai/conversation-state.ts`,
  anahtar `AI_CONVERSATION_STATE_ENABLED` **kapalı**.
- Konuşma öğeleri (mesajı isteklere böler; güvenli kısım cevaplanır, hassas kısım ev sahibinde) — canlıda açıktı.
- Eylem beyanı ("ilettim / kontrol ettim" ancak makbuzu varsa) — `ai/action-claims.ts`, **kapalı**.

**Eksik:** kapalı iki parçanın ölçümü + açılması. Yeni bir yapı gerekmiyor.

### 1.3 Uzun süreli hafıza (misafir profili)
- **Daire hafızası** var: `PropertyMemory` + `Signal` (olgular, tekrarlayan sorunlar) — `src/modules/intelligence/**`.
- **Misafir profili YOK.** Yalnız "bu misafirin N. konaklaması" her sorguda hesaplanıyor (`returning-guest.ts`, kanalın kalıcı misafir
  kimliğiyle); hiçbir tercih saklanmıyor.
- Kurucunun 09-07 değişmezi 10: "misafir anlık görüntüsü ≠ profil; otomatik birleştirme yok".

**Önerim (karar kurucuda — KVKK metni + migration ister):** dar, yapılandırılmış bir "misafir notu":
kiracı başına, **yalnız kanalın verdiği kalıcı misafir kimliğiyle** (ad benzerliğiyle birleştirme yok), serbest metin değil kapalı alanlar
(tercih edilen dil · önceki konaklama sayısı · önceki konaklamada açılmış sorun türleri · ev sahibinin elle yazdığı tek satırlık not).
Saklama süresi rezervasyon verisiyle aynı; silme talebinde birlikte gider; modele yalnız "dil" ve "dönen misafir" bilgisi gider, not ev
sahibine / ekibe görünür. Kullanım: doğru dilde ilk mesaj, "tekrar hoş geldiniz" (bugün de hesaplanıyor), ekibe "geçen sefer klima
sorunu yaşamıştı" hatırlatması.

### 1.4 Karmaşıklığa göre yönlendirme
- Katman başına ayrı model ayarı var (`AI_UNDERSTANDING_MODEL`, `AI_STAY_GUARD_MODEL`, `KB_RERANK_MODEL`, cevap `OPENAI_MODEL`).
- Modelsiz yollar var: kelime ağı sınıflandırıcı, kapanış / nezaket cevabı, koddan kurulan metinler (erken giriş ücreti, müsaitlik cümlesi,
  kodla selam).
- **Açık bir yönlendirici YOK:** her cevaplanabilir mesaj aynı (en güçlü) cevap modeline gidiyor.

**Önerim:** dört şeritli yönlendirici — kararı anlama katmanının çıktısı + kod verir, model değil:
1. **Kod cevabı** (model yok): tek istekli, cevabı doğrulanmış araçta ya da tek bir bilgi tabanı olgusunda olan soru (çıkış saati, Wi-Fi,
   erken giriş ücreti, müsaitlik).
2. **Küçük model**: tek konulu, riski olmayan, bilgi tabanında dayanağı bulunan soru.
3. **Tam model**: çok parçalı / bağlam gerektiren mesaj.
4. **İnsan**: risk, şikâyet, para, belirsizlik (bugünkü kapılar aynen).
Kazanç: maliyet ve gecikme düşer, 1. şeritte "aynı soruya her zaman aynı cevap". Risk: 2. şeridin kalitesi → **ücretli A/B ölçümü şart**
(kurucu zamanı söyleyecek); ölçüm geçmeden hiçbir mesaj küçük modele gitmez.

### 1.5 Deterministik yürütme (anlamsal yönlendirme, "derleyici", katı şema, istem iyileştirme)
- Anlama katmanı ve yardımcı hakemler **katı şemayla** çağrılıyor (`semantic/structured-call.ts`, `strict: true`; sonuç kodda yeniden
  doğrulanıyor).
- **Cevap çağrısı katı şemada DEĞİL** (`ai/index.ts`: `json_object`); alan eksikliği / biçim kayması kodda yakalanıyor (F01) ama şema
  garantisi yok.
- Kod kararı / model metni ayrımı: erken giriş, müsaitlik, uzatma, ev sahibi karar motoru (`src/lib/decisions/**`, anahtar kapalı) bu
  ayrımla yazılmış.
- Ölçüm altyapısı var (`tests/eval/**`, hata neden analizi, istem kimliği = istemin özeti); **otomatik istem iyileştirme YOK**.

**Önerim — üç adım:**
1. **Cevap çıktısı katı şemaya** taşınır (aynı alanlar; kapılar değişmez). Ölçüm: şema öncesi / sonrası aynı sette cevap farkı.
2. **"Plan → yürüt → yaz" hattı** (kurucunun "LLM derleyici" dediği): mesaj → tipli öğeler (bugünkü konuşma öğeleri) → her öğe için kod
   kararı (araç sonucu · kural · "ev sahibine") → model yalnız izin verilen öğelerin metnini yazar → çıktı vetosu. Bugün parçaları var;
   eksik olan tek bir "öğe türü → yürütücü" tablosu ve karar motorunun açılması.
3. **İstem turnuvası (DSPy'nin bize uyan kısmı):** istemin kendisi elle yazılmaya devam eder; ama değişiklik adayı N varyantla
   geliştirme setinde (mühürlü / kör setlere DOKUNMADAN) koşulur, kapı ölçüleriyle sıralanır, kazanan **insan onayıyla** girer. Otomatik
   canlıya alma yok; her varyantın kimliği (özet) rapora yazılır. Gerekçe: DSPy'nin otomatik derlediği istemler okunamaz hâle geliyor ve
   "isteme yalnız kod yazar" kuralımızla çelişiyor — yöntemini (ölç, kıyasla, seç) alıyoruz, otomatik yazımını almıyoruz.

### 1.6 Ek satışın geri ödemesi ("up-sell payback")
- Kodda misafirden para alan / hizmet satan akış **yok**; erken giriş ve geç çıkış ücreti ev sahibinin kuralından / metninden okunur,
  tahsilat ev sahibi ile misafir arasında.
- Tasarım hazır: `docs/TASARIM-2026-11-06-misafir-hizmetleri-ve-dogrudan-rezervasyon.md` (P0 hukuk teyidi → P1 beş hizmet şablonu →
  P2 kazanç paneli …; sorular D-1…D-7 kurucuda).

**"Geri ödeme" ölçüsü (önerim, P2'ye eklenir):** ev sahibinin panelinde tek satır — "Bu ay Lixus üzerinden onayladığınız ek hizmetler:
₺X (beyan) · abonelik: ₺Y". Yalnız ev sahibinin onayladığı ve "ödendi" diye işaretlediği kalemler sayılır; tahmin / model hesabı yok
(V2 para etkisi kuralı: sahte kesinlik yok). Ön koşul: P0 + P1.

### 1.7 Debezium (CDC) · Kafka Connect · olay kaynağı · CRDT
**Bugün:** olaylar veritabanının içinde, işlemle birlikte yazılıyor (işlemsel kuyruk deseni):
`IngestEvent` (rezervasyon / mesaj olguları; tek tüketici: daire hafızası), `MessageOutbox` (giden mesaj durum makinesi),
`EmailOutbox`, `OperationalEvent` (yalnız-ekle; veritabanı tetikleyicisiyle korunuyor), `WebhookEvent`, `AuditLog`. Tüketiciler aynı
süreçte, 2 dakikalık senkron turunda.

**Değerlendirme (dürüstçe):** ~10 daire ölçeğinde günde birkaç bin olay var. Kafka + Connect + Debezium ayrı bir küme, şema kaydı ve
7/24 işletim demek; bugün tek tüketicimiz var ve o da aynı süreçte. **Şimdi kurmak maliyet ve arıza yüzeyi ekler, karşılığını vermez.**
Olay kaynağına tam geçiş (durumu yalnız olaylardan türetmek) de önerilmez: silme talebi (KVKK) "değişmez günlük" ile çatışır; bugünkü
"durum tabloları + yalnız-ekle olay günlüğü" karması bu yüzden doğru denge. CRDT yalnız çevrimdışı çok yazarlı istemci için gerekir
(ör. temizlikçi telefonu internet yokken iş işaretliyor) — bugün öyle bir istemci yok; olursa alan başına "son yazan + sunucu hakem"
yeterli.

**Önerim — "CDC'ye hazır" olmak (ucuz, bugün yapılabilir, geri dönüşü yok):**
1. Tek **olay zarfı** (kimlik · tür · sürüm · olduğu an · kiracı · konu kimliği · PII'siz yük) — `IngestEvent` bunu büyük ölçüde taşıyor;
   giden mesaj ve görev olayları da aynı zarfa girer.
2. **Tüketici başına imleç** (bugün tek `dispatchedAt` damgası → ikinci tüketici eklenemiyor): `tüketici adı + son işlenen olay`.
   Böylece "daire hafızası", "ev sahibi bildirimi", "raporlama" ayrı ayrı ilerler; biri bozulunca diğeri durmaz.
3. Her tüketici **tekrar işlemeye dayanıklı** (bugünkü `dedupeKey` deseni).
Bu üçü olduktan sonra Debezium, o olay tablosuna **uygulamayı değiştirmeden** bağlanır. Bağlama zamanı (tetikleyiciler): ikinci bir
servis olayları tüketmeye başlayınca · ayrı bir analiz deposu istenince · olay hızı tek süreçli tüketiciyi aşınca.

### 1.8 Railway yanında Akash (önce %10 / %90)
**Bugün:** uygulama konteyner olarak paketli (`Dockerfile`, `railway.json`); tek PostgreSQL; açılışta `prisma migrate deploy`; oturum
durumsuz (imzalı çerez); hız sınırı ve kilitler veritabanında; zamanlanmış iş süreç içinde ama `SystemLock` ile tekil.
`docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md` iki kopya ön koşullarını saymıştı.

**İki yerde birden çalışmak için eksikler (teknik):**
1. **Migration tek yerden:** bugün her konteyner açılışta migration koşuyor; iki barındırıcı aynı anda açılırsa yarışır (hiç denenmedi)
   → migration ayrı, tekil bir adım olmalı.
2. **Trafik bölüştürücü:** %10 / %90 için ağırlıklı yönlendirme + sağlık denetimi (ör. Cloudflare yük dengeleyici); iki tarafta
   `TRUSTED_PROXY_HOPS` farklı olur (hız sınırı ve onay kaydındaki IP buna bağlı).
3. **Veritabanına uzaktan erişim:** Akash'taki kopya Railway'deki PostgreSQL'e internetten bağlanır → şifreli bağlantı, havuz sınırı,
   gecikme (bölgeler uzaksa her sorgu yavaşlar).
4. **Süreç içi önbellekler:** doğruluk bunlara bağlı değil (kopya başına ayrı önbellek sorun değil); tek istisna bellekteki anlamsal
   dizin (kopyalar ayrı ayrı kurar — maliyet, tutarsızlık değil).

**Asıl engel güvenlik ve hukuk (önce bunu konuşmalıyız):**
- Akash sağlayıcıları izne bağlı olmayan üçüncü taraflardır; konteynere verilen ortam değişkenleri (şifreleme anahtarı, oturum sırrı,
  veritabanı adresi, model anahtarı) ve bellek, konteyneri çalıştıran makinenin sahibince **okunabilir** (gizli hesaplama sunan sağlayıcı
  seçilmedikçe — doğrulanacak). Bizim kuralımız: şifreleme anahtarı kasada ve veritabanı yedeğinden ayrı; anahtarı tanımadığımız bir
  sağlayıcıya vermek bu kuralı fiilen kaldırır.
- KVKK: misafir verisinin, kim olduğu ve hangi ülkede bulunduğu sözleşmeyle bağlı olmayan bir işleyicide işlenmesi yurt dışına aktarım /
  veri işleyen yükümlülüklerine takılır.

**Önerim — iki aşama:**
- **Aşama A (riski düşük, hedefe hizmet eder):** Akash'ta yalnız **sır ve kişisel veri taşımayan** yükler: tanıtım sitesi, herkese açık
  sayfalar, durum sayfası. "Sansürden uzak" hedefi en çok buradadır (sitenin erişilebilir kalması); maliyet de burada ölçülür.
- **Aşama B (uygulamanın kendisi):** ancak (i) gizli hesaplama sunan sağlayıcı + sözleşme, (ii) hukuk görüşü, (iii) migration'ın tek
  adıma alınması, (iv) yük dengeleyici ile %10 deneme ve geri alma planı hazır olunca.
Zamanlama kurucunun dediği gibi: web sitesi tamamen bittikten sonra.

## 2. Önerilen sıra (bağımlılığa göre; her adım ayrı onay + ölçüm)
| Adım | Ne otomatikleşir | Güvenlik kapısı | Ön koşul |
|---|---|---|---|
| O-1 | Yazılmış ama kapalı doğrulanmış araçlar (müsaitlik, uzatma, tarih okuma) + konuşma kayıtları + eylem beyanı ölçülüp açılır | kapılar aynı; araç sonucu yoksa cevap ev sahibine | ücretli ölçüm zamanı (kurucu) · Railway |
| O-2 | Araç kayıt defteri + 3–4 yeni salt-okuma araç (rezervasyon olguları, görev durumu, giriş bilgisi gönderildi mi) | kiracı kapsamı testle; sonuç cümlesini kod kurar | O-1 |
| O-3 | Cevap çıktısı katı şema | önce / sonra aynı sette fark ölçümü | ücretli ölçüm |
| O-4 | Dört şeritli yönlendirici (kod · küçük model · tam model · insan) | A/B geçmeden küçük modele trafik yok | O-1, O-3 · ölçüm |
| O-5 | Plan → yürüt → yaz tablosu + ev sahibi karar motorunun açılması | ev sahibi onayı gereken öğe türleri listesi kurucuda | O-2 |
| O-6 | İstem turnuvası (geliştirme setinde, insan onaylı) | mühürlü setlere dokunulmaz | — |
| O-7 | Olay zarfı + tüketici başına imleç ("CDC'ye hazır") | davranış değişmez; kâhin testi | migration onayı |
| O-8 | Misafir notu (dar profil) | KVKK metni + silme / saklama testleri | kurucu kararı · migration |
| O-9 | Ek hizmetler P0 → P1 → "geri ödeme" satırı | hukuk teyidi; Airbnb mesajında iz yok | D-1…D-7 |
| O-10 | Akash Aşama A (açık site) | sır / kişisel veri yok | site bitince |

## 3. Kurucu soruları
- **AA-1 (sıra):** yukarıdaki sıra uygun mu; öne almak istediğiniz adım var mı? (Önerim: O-1 → O-2 → O-3; çünkü yazılmış kod boşta duruyor.)
- **AA-2 (araç yerine SQL):** modelin serbest SQL yazması yerine "kodun çağırdığı doğrulanmış araç + hazır sorgu kataloğu" ile ilerleyelim mi? (Önerim: evet.)
- **AA-3 (misafir notu):** dar profil saklansın mı? Hangi alanlar: dil · önceki konaklama sayısı · önceki sorun türleri · ev sahibinin tek satırlık notu? (KVKK metni ve yeni tablo gerekir.)
- **AA-4 (küçük model):** O-4 için ücretli A/B ölçümünü ne zaman yapalım; "küçük model" adayı siz mi seçersiniz?
- **AA-5 (onaysız otomatik adımlar):** hangi iş adımları ev sahibi onayı OLMADAN ilerlesin? Örnekler (hepsi bugün onaylı ya da kapalı):
  temizlik "Bitti" işaretlenince erken giriş isteyen misafire onayın gitmesi · geç çıkış onaylanınca temizlik görevinin saatinin
  kayması · misafirin "havlu bitti" mesajından temizlikçiye görev açılması.
- **AA-6 (Kafka / Debezium):** şimdi kurmayıp "CDC'ye hazır" (O-7) ile ilerleyelim mi? (Önerim: evet; tetikleyiciler §1.7.)
- **AA-7 (Akash):** Aşama A (yalnız açık site) ile başlayalım mı; uygulamanın kendisi için gizli hesaplama + hukuk görüşü şartını kabul ediyor musunuz?
- **AA-8 (istem turnuvası):** otomatik istem yazımı yerine "varyantları ölç, insan seçsin" yöntemi uygun mu?

## 4. Bilerek yapılmayanlar (ve neden)
- Modelin araç / SQL seçmesi: kiracı sızması ve belirlenimsizlik riski; kod-çağrılı araç aynı işi güvenli yapar.
- Kafka kümesi + Debezium şimdi: tek tüketici, düşük hacim; işletim yükü karşılıksız.
- Tam olay kaynağı: silme talebiyle çatışır; karma model yeterli.
- CRDT: çevrimdışı çok yazarlı istemci yok.
- Uygulamanın sırlarıyla birlikte tanımadığımız sağlayıcıda çalışması: şifreleme anahtarı kuralı ve KVKK.
