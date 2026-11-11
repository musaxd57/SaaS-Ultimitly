# Daha otomatik, bir o kadar güvenli: otomasyon yol haritası (tasarım — kod YOK)

> Kurucu 11-10 / 11-11: "sistemi birazcık daha fazla içinde otomasyon bulunan AaaS tipine de yaklaştıralım; manuellikten uzaklaşıp daha
> otomatik ama bir o kadar da güvenli" + başlık listesi (dinamik bilgi tabanı + canlı veri araçları · kısa / uzun süreli hafıza ·
> karmaşıklığa göre yönlendirme · deterministik yürütme, katı şema, istem iyileştirme · ek satışın geri ödemesi · Debezium / Kafka Connect ·
> CRDT ya da olay kaynağı · ileride Railway yanında Akash, önce %10 / %90).
>
> Bu belge karar DEĞİL öneridir: her başlıkta **bugün kodda ne var** (11-11, üç tarama ajanı + kodda teyit), **ne eksik**, **önerim** ve
> **kurucu sorusu**.
> 🔧 **11-11 gece düzeltmesi (kurucu: "emin misin, bir Sonnet ajanına sertçe kontrol ettirt"):** denetim 21 bulgu çıkardı; kodda doğrulananlar
> bu sürüme işlendi (§1.3 tekrar gelen misafir · §1.4 "modelsiz yol" · §1.7 tablo ayrımı · §1.8 Akash'ın daraltılması AÇIKÇA yazıldı · adım
> adları `OT-` oldu — kuyruk belgesindeki O1–O4 ile karışmasın). Bayrak adları, "varsayılan kapalı" ve katı şema iddiaları doğru çıktı. Müşteriye / misafire giden her değişiklik ayrıca önce → sonra örneğiyle sorulur. Ücretli ölçüm ancak kurucu "şimdi" deyince.

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
| Modelin kendisinin araç çağırması (function calling) | — | **YOK** — bugün aracı kod çağırıyor (aşağıda ayrım) |

**Değerlendirme.** İstenen "RAG + Text-to-SQL / API araçları"nın güvenli hâli bizde zaten kurulmuş: aracı **model değil kod** çağırıyor
(anlama katmanı niyeti söyler → kod ilgili doğrulayıcıyı çalıştırır → sonuç cümlesini kod kurar ya da olgu olarak isteme koyar). Modelin
serbestçe SQL yazması önerilmez: kiracılar arası sızma, enjeksiyon ve "aynı soruya iki farklı sonuç" riski; ayrıca kurucunun 09-07 kuralına
("canlı olgu yalnız doğrulanmış araç sonucundan") ters düşer.

**Eksik olan:** (a) yazılmış araçların üçü kapalı duruyor — ölçülüp açılmadı; (b) araç yelpazesi dar. Sıradaki adaylar (hepsi salt-okuma,
kiracı kapsamlı, sonucu kod kurar): rezervasyon olguları (giriş / çıkış günü, kişi sayısı), görev durumu ("temizlik bitti mi" — yalnız ev
sahibine / ekibe), giriş bilgisinin gönderilip gönderilmediği, geç çıkışın ertesi gün takvimine etkisi. (c) `ai/tools/contract.ts` ortak
sözleşmesini bugün yalnız müsaitlik aracı kullanıyor (kod sonucu alıp cümleyi kuruyor; sonuç isteme "doğrulanmış araç sonucu" olarak
GİRMİYOR) ve bir kayıt defteri yok → araçlar tek kayıt defterinden (ad · sürüm · girdi şeması · çıktı şeması · kimin görebileceği) geçmeli;
yeni araç eklemek tek dosyalık iş olmalı. Şemalar bizde `zod` ile yazılır (istenen Pydantic / JSON Schema'nın TypeScript karşılığı; yardımcı
model çağrıları bugün de katı şemayla — `semantic/structured-call.ts`, karar metni, WhatsApp ev sahibi döngüsü, geçmişten öğrenme).

**"Function calling" konusunda net ayrım (denetim: belge kendi içinde çelişiyordu).** Yapılmayacak olan: modelin SERBEST SQL yazması ve
modelin misafir yüzeyinde kendi başına araç zinciri kurması. Yapılabilecek olan — ve istediğiniz "strict mode" tam budur: modelin, kayıt
defterindeki kapalı listeden **bir araç adı + katı şemalı parametre** seçmesi; aracı yine kod, kiracı kapsamıyla çalıştırır. Önerim: bunu önce
ev sahibi yüzeyinde ("Ask Lixus") açmak; misafir yüzeyinde seçimi kod yapmaya devam etsin (anlama katmanının çıkardığı öğe türü → araç),
çünkü orada yanlış araç = misafire yanlış olgu. Karar sorusu AA-2.

**Ev sahibi tarafı ("Ask Lixus").** "Bu ay kaç gece doluyum?", "en çok hangi dairede şikâyet var?" gibi sorular için de serbest SQL yerine
**hazır, parametreli sorgu kataloğu** (anlam katmanı): model yalnız "hangi sorgu + hangi parametre" seçer, sorguyu kod çalıştırır. En yakın
zemin zaten yazılı: WhatsApp ev sahibi döngüsü (`src/lib/host-channel/**`, `HostQuestion`) — yeni bir yüzey değil, onun genişlemesi olur.

### 1.2 Kısa süreli hafıza (konuşma içi)
- Konuşma penceresi: son 25 mesaj + son cevap (`channel-thread-window.ts`) — AÇIK.
- Konuşma kayıtları (kodun kurduğu, metinsiz durum özeti: hangi aşamadayız, ilk cevap mı, önceki söz ne) — `ai/conversation-state.ts`,
  anahtar `AI_CONVERSATION_STATE_ENABLED` **kapalı**.
- Konuşma öğeleri (mesajı isteklere böler; güvenli kısım cevaplanır, hassas kısım ev sahibinde) — canlıda açıktı.
- Eylem beyanı ("ilettim / kontrol ettim" ancak makbuzu varsa) — `ai/action-claims.ts`, **kapalı**.

**Eksik:** kapalı iki parçanın ölçümü + açılması. Yeni bir yapı gerekmiyor.

### 1.3 Uzun süreli hafıza (misafir profili)
- **Daire hafızası** var: `PropertyMemory` + `Signal` (olgular, tekrarlayan sorunlar) — `src/modules/intelligence/**`.
- **Başka kalıcı hafızalar da var** (ilk sürümde atlanmıştı): `VerifiedAnswer` — daire başına doğrulanmış cevap parçası, üç bağımsız teyit,
  bugün yalnız GÖLGE ölçüm (`src/lib/answer-reuse/**`, `AI_ANSWER_REUSE_SHADOW_ENABLED`, tasarım
  `docs/TASARIM-2026-10-23-dogrulanmis-cevap-tekrari.md`) · `GuestCommitment` (misafire verilmiş açık sözler) · `PropertyInstruction`
  (ev sahibinin daire talimatları) · geçmiş cevaplardan öğrenme tabloları.
- **Misafir profili YOK.** "Bu misafirin N. konaklaması" hesabı var (`returning-guest.ts`) ama TEK tüketicisi gelen kutusundaki ev sahibi
  rozeti (`inbox/[id]/page.tsx:116`); yapay zekâya ve misafire giden hiçbir metne girmiyor, hiçbir tercih saklanmıyor.
- Kurucunun 09-07 değişmezleri: 10 — "misafir anlık görüntüsü ≠ profil; otomatik birleştirme yok"; 14 — Airbnb'den türeyen veride kalıcı
  hafıza / analiz çekirdeğe varsayım olarak gömülmez, veri sınıfı başına saklama / silme / fesih tanımlanır (Airbnb Direct başvurusu için kritik).

**Önerim (karar kurucuda — KVKK metni + migration ister):** dar, yapılandırılmış bir "misafir notu":
kiracı başına, **yalnız kanalın verdiği kalıcı misafir kimliğiyle** (ad benzerliğiyle birleştirme yok), serbest metin değil kapalı alanlar
(tercih edilen dil · önceki konaklama sayısı · önceki konaklamada açılmış sorun türleri · ev sahibinin elle yazdığı tek satırlık not).
Saklama süresi rezervasyon verisiyle aynı; silme talebinde birlikte gider; modele yalnız "dil" ve "dönen misafir" bilgisi gider, not ev
sahibine / ekibe görünür. Kullanım: doğru dilde ilk mesaj, ev sahibine "tekrar gelen misafir" bilgisi (bugün yalnız rozet), ekibe "geçen
sefer klima sorunu yaşamıştı" hatırlatması. Misafire "tekrar hoş geldiniz" yazmak ayrı bir karar (müşteriye giden metin). Değişmez 14
gereği: bu not Airbnb'den gelen veriyle beslenecekse saklama / silme / fesih kuralı baştan yazılır; yazılamıyorsa yalnız ev sahibinin elle
girdiği satır tutulur.

### 1.4 Karmaşıklığa göre yönlendirme
- Katman başına ayrı model ayarı var (`AI_UNDERSTANDING_MODEL`, `AI_STAY_GUARD_MODEL`, `KB_RERANK_MODEL`, cevap `OPENAI_MODEL`).
- **Bugün gerçekten modelsiz giden tek metin:** işletmenin açtığı kısa nezaket cevabı ("teşekkürler"e tek satır; `autoClosingReplyEnabled`).
  Koddan kurulan öteki metinler (erken giriş ücreti / onayı; kapalı olanlar: müsaitlik, uzatma, kodla selam) model çağrısını ATLAMIYOR:
  önce cevap modeli çağrılıyor, kod metni taslağın yerine sonradan konuyor (`automation.ts:2712`, `ai/code-built-result.ts`). Kelime ağı
  sınıflandırıcının metni misafire otomatik gitmez. Yani "kod cevabı" bugün maliyet / gecikme kazandırmıyor.
- Anlama katmanı varsayılan olarak cevap modeliyle aynı modeli kullanıyor (`semantic/config.ts`); yönlendirme kararı için tam model zaten ödeniyor.
- "Modeli atla" altyapısının temeli yazılı ama yalnız gölgede: doğrulanmış cevap tekrarı (§1.3 `VerifiedAnswer`).
- **Açık bir yönlendirici YOK:** her cevaplanabilir mesaj aynı (en güçlü) cevap modeline gidiyor.

**Önerim (ilk sürümdeki "dört şerit" dayanağı yanlıştı — yeniden yazıldı).** Yeni bir yönlendirici kurmak yerine var olan üç parçayı sırayla
gerçek kazanca çevirmek:
1. **Anlama katmanını küçük modele almak** (katman başına model ayarı hazır) — yönlendirme kararının maliyeti düşmeden hiçbir şerit kazandırmaz.
   Ücretli A/B şart.
2. **Kod metni kesinleştiğinde cevap çağrısını atlamak:** bugün atılan taslak için ödenen çağrı kalkar. Şart: kod metni yedi dilde ve ev
   sahibinin ağzından hazır olan konular (bugün yalnız erken giriş); Wi-Fi / çıkış saati için şablon yok — önce onlar yazılır ve onaylanır.
3. **Doğrulanmış cevap tekrarını gölgeden çıkarmak** (10-23 tasarımı): aynı daire + aynı soru + üç teyit → model çağrısız aynı cevap.
   Gölge ölçümünün sonucu görülmeden açılmaz.
4. **İnsan:** risk, şikâyet, para, belirsizlik (bugünkü kapılar aynen).
"Küçük model tek konulu soruyu yazsın" (eski 2. şerit) ancak 1–3 ölçüldükten sonra değerlendirilir. Kazanç iddiası bu sürümde ölçüme bağlı;
ölçülmeden "maliyet düşer" denmez.

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
   canlıya alma yok; her varyantın kimliği (özet) rapora yazılır. Gerekçe (düzeltildi): (i) misafire gideni değiştiren her istem kararı
   size sorulur — otomatik seçilen istem bu kuralı atlar; (ii) istem değişikliği gönderim kapılarının yeniden kalibrasyonudur, ölçümsüz
   girmez; (iii) otomatik derlenen istem okunamaz hâle gelir, hata olunca neden analizi yapılamaz; (iv) DSPy Python'dur, kod tabanı
   TypeScript — aynı yöntem bizdeki ölçüm altyapısıyla yapılır. Yöntemini (ölç, kıyasla, seç) alıyoruz, otomatik yazımını almıyoruz.

### 1.6 Ek satışın geri ödemesi ("up-sell payback")
- Kodda misafirden para alan / hizmet satan akış **yok**; erken giriş ve geç çıkış ücreti ev sahibinin kuralından / metninden okunur,
  tahsilat ev sahibi ile misafir arasında.
- Tasarım hazır: `docs/TASARIM-2026-11-06-misafir-hizmetleri-ve-dogrudan-rezervasyon.md` (P0 hukuk teyidi → P1 beş hizmet şablonu →
  P2 kazanç paneli …; sorular D-1…D-7 kurucuda).

⚠️ **Yorumum (size sorulmadan yazılmıştı — soru AA-9):** "Up-sell Payback"i "ek hizmet gelirinin abonelik ücretini ne kadar karşıladığını
ev sahibine göstermek" diye okudum. Başka bir şey kastediyorsanız (ör. Lixus'un ek satıştan pay alması, misafire dönük teklif akışı) bu
bölüm ona göre yeniden yazılır.

**"Geri ödeme" ölçüsü (önerim, P2'ye eklenir):** ev sahibinin panelinde tek satır — "Bu ay Lixus üzerinden onayladığınız ek hizmetler:
₺X (beyan) · abonelik: ₺Y". Yalnız ev sahibinin onayladığı ve "ödendi" diye işaretlediği kalemler sayılır; tahmin / model hesabı yok
(V2 para etkisi kuralı: sahte kesinlik yok). Ön koşul: P0 + P1.

### 1.7 Debezium (CDC) · Kafka Connect · olay kaynağı · CRDT
**Bugün (tablolar aynı şey değil — ilk sürüm hepsini "işlemsel kuyruk" diye tek kefeye koymuştu):**
| Tablo | Ne | İşlemle birlikte mi | Not |
|---|---|---|---|
| `IngestEvent` | rezervasyon / konuşma / mesaj olguları; tek tüketici: daire hafızası | evet | satırlar işlenince GÜNCELLENİR (`dispatchedAt`); görev olayları bilinçli dışarıda |
| `EmailOutbox` | kimlik e-postaları | evet | — |
| `MessageOutbox` | giden mesaj durum makinesi | evet | **anahtarı kapalı** (`DURABLE_OUTBOX_ENABLED`) |
| `OperationalEvent` | takip numaralı işlem izi | hayır (en iyi çaba, düşebilir) | 90 gün sonra silinir |
| `WebhookEvent` | gelen ödeme olayları, tekilleştirme | — | olay günlüğü değil |
| `AuditLog` | kim ne yaptı | evet | — |
Tüketiciler aynı süreçte, 2 dakikalık senkron turunda.

**Değerlendirme (dürüstçe):** hacim düşük (10-16 kuyruk belgesinin ölçüsü: dakikada birkaç mesaj). Kafka + Connect + Debezium ayrı bir
küme, şema kaydı ve 7/24 işletim demek; Debezium ayrıca PostgreSQL'de mantıksal çoğaltma yuvası ister — tüketici durursa günlük dosyaları
şişer ve veritabanını doldurur, barındırıcının bu ayara izin vermesi gerekir (`docs/TASARIM-2026-10-16-transactional-outbox.md` §3).
Bugün tek tüketicimiz var ve o da aynı süreçte. **Şimdi kurmak maliyet ve arıza yüzeyi ekler, karşılığını vermez.** Olay kaynağına TAM
geçiş (durumu yalnız olaylardan türetmek) de önerilmez: kişisel veri taşıyan olaylar silme talebiyle (KVKK) çatışır. Kişisel veri
taşımayan olay günlüğü (bugünkü `IngestEvent` böyle) silmeyle çatışmaz — o yüzden "durum tabloları + kişisel verisiz olay günlüğü" karması
doğru denge. CRDT yalnız çevrimdışı çok yazarlı istemci için gerekir (ör. temizlikçi telefonu internet yokken iş işaretliyor) — bugün öyle
bir istemci yok; olursa alan başına "son yazan + sunucu hakem" yeterli.

**Önerim — "CDC'ye hazır" olmak (ucuz, bugün yapılabilir, geri dönüşü yok):**
1. Tek **olay zarfı** (kimlik · tür · sürüm · olduğu an · kiracı · konu kimliği · PII'siz yük) — `IngestEvent` bunu büyük ölçüde taşıyor.
   Giden mesaj ve görev olaylarını aynı zarfa almak var olan bir kararı DEĞİŞTİRİR ("görev olayları bilinçli dışarıda", konu türü kapalı
   küme) — ayrı karar; önerim önce yalnız giden mesaj.
2. **Tüketici başına imleç** (bugün tek `dispatchedAt` damgası → ikinci tüketici eklenemiyor): `tüketici adı + son işlenen olay`.
   Böylece "daire hafızası", "ev sahibi bildirimi", "raporlama" ayrı ayrı ilerler; biri bozulunca diğeri durmaz. Ek kazanç: olay satırı
   artık güncellenmez (yalnız-ekle olur). Kafka gelirse imleci Kafka tutar; bu adım Kafka'dan ÖNCEKİ dönem içindir.
3. Her tüketici **tekrar işlemeye dayanıklı** (bugünkü `dedupeKey` deseni).
Bu üçü olduktan sonra (olay satırı yalnız-ekle olduğu için) Debezium o tabloya uygulama kodu değişmeden bağlanabilir; barındırıcı ayarı ve
işletim yükü yine gerekir. Bağlama zamanı (tetikleyiciler): ikinci bir
servis olayları tüketmeye başlayınca · ayrı bir analiz deposu istenince · olay hızı tek süreçli tüketiciyi aşınca.

### 1.8 Railway yanında Akash (önce %10 / %90)
**Bugün:** uygulama konteyner olarak paketli (`Dockerfile`, `railway.json`); tek PostgreSQL; açılışta `prisma migrate deploy`; oturum
durumsuz (imzalı çerez); hız sınırı ve kilitler veritabanında; zamanlanmış iş süreç içinde ama `SystemLock` ile tekil.
`docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md` iki kopya ön koşullarını saymıştı.

⚠️ **İsteğinizi daralttım — açıkça yazıyorum.** Siz uygulama sunucularının Railway + Akash arasında %10 / %90 → %50 / %50 bölünmesini, iki
gerekçeyle istediniz: maliyet ve sansürden uzak kalmak. Aşağıdaki önerim uygulamayı ilk aşamada Akash'a TAŞIMIYOR (yalnız açık site); bu
sizin kararınız değil benim önerim, gerekçesi güvenlik + KVKK. Kabul etmezseniz Aşama B'nin dört ön koşulu öne alınır (soru AA-7).

**İki gerekçeniz bu planda ne kadar karşılanıyor:**
- **Maliyet:** elimde karşılaştırma YOK ve uydurmuyorum. Ölçülecek olan: Railway'in bugünkü aylık faturası (uygulama + veritabanı ayrı ayrı) ↔
  aynı işlemci / bellek için Akash'ta güncel fiyat + yük dengeleyici + veritabanına çıkış trafiği. Açık site tek başına küçük bir yük
  olduğu için Aşama A maliyeti anlamlı düşürmez; asıl tasarruf uygulamanın kendisi taşınırsa doğar.
- **Sansür:** veritabanı Railway'de kaldıkça Railway'in engellenmesi / hesabın kapanması Akash'taki kopyayı da durdurur. Bu mimari sansür
  hedefini KARŞILAMAZ; karşılaması için veritabanının da Railway dışında bir yerde (ya da kopyasının) durması ve alan adı / trafik
  yönlendirmesinin iki barındırıcıdan bağımsız olması gerekir. Aşama A yalnız "tanıtım sitesi erişilebilir kalsın" kısmını karşılar.

**İki yerde birden çalışmak için eksikler (teknik):**
1. **Sürüm kayması:** her konteyner açılışta migration koşuyor; Prisma bunu veritabanı kilidiyle sıraya koyar (yarış yok — ilk sürümdeki
   iddia yanlıştı, `docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md`). Gerçek risk: iki barındırıcı farklı anda yayına girerse eski
   kod yeni şemayla (ya da tersi) çalışır + kilit zaman aşımı → migration ayrı, tekil bir adım olmalı; yayın sırası tanımlanmalı.
2. **Trafik bölüştürücü:** %10 / %90 için ağırlıklı yönlendirme + sağlık denetimi (ör. Cloudflare yük dengeleyici). İki tarafta vekil
   zinciri farklı olur: `TRUSTED_PROXY_HOPS` her barındırıcıda ayrı ayarlanır; Cloudflare başlığına güvenen ayar (`TRUST_CF_HEADER`) bugün
   bilerek kapalı — açılması ayrı bir güvenlik kararı (hız sınırı ve onay kaydındaki IP buna bağlı).
3. **Veritabanına uzaktan erişim:** Akash'taki kopya Railway'deki PostgreSQL'e internetten bağlanır → şifreli bağlantı, havuz sınırı,
   gecikme (bölgeler uzaksa her sorgu yavaşlar).
4. **Süreç içi önbellekler:** doğruluk bunlara bağlı değil; tek istisna bellekteki anlamsal dizin (kopyalar ayrı ayrı kurar — maliyet).
5. **Açık site ayrı bir uygulama değil:** tanıtım sayfası, hukuk sayfaları ve paylaşım görseli aynı Next.js uygulamasının içinde. Aşama A
   için bunların sır gerektirmeyen ayrı bir derlemesi / dağıtımı yazılmalı — "yalnız açık site" bedava değil, ayrı bir iş.

**Asıl engel güvenlik ve hukuk (önce bunu konuşmalıyız):**
- Akash sağlayıcıları izne bağlı olmayan üçüncü taraflardır; konteynere verilen ortam değişkenleri (şifreleme anahtarı, oturum sırrı,
  veritabanı adresi, model anahtarı) ve bellek, konteyneri çalıştıran makinenin sahibince **okunabilir** (gizli hesaplama sunan sağlayıcı
  seçilmedikçe — bu cümleyi henüz birincil kaynaktan doğrulamadım; karar öncesi doğrulanacak). Bizim kuralımız: şifreleme anahtarı kasada
  ve veritabanı yedeğinden ayrı; anahtarı tanımadığımız bir sağlayıcıya vermek bu kuralı fiilen kaldırır.
- KVKK: misafir verisinin, kim olduğu ve hangi ülkede bulunduğu sözleşmeyle bağlı olmayan bir işleyicide işlenmesi yurt dışına aktarım /
  veri işleyen yükümlülüklerine takılır.

**Önerim — iki aşama:**
- **Aşama A:** Akash'ta yalnız **sır ve kişisel veri taşımayan** yükler: tanıtım sitesi, herkese açık sayfalar, durum sayfası. Kazanımı
  sınırlı (yukarıda): Akash'ı gerçek trafikle tanımak + sitenin erişilebilirliği.
- **Aşama B (uygulamanın kendisi — asıl istediğiniz):** (i) gizli hesaplama sunan sağlayıcı + sözleşme, (ii) hukuk görüşü, (iii) migration'ın
  tek adıma alınması + yayın sırası, (iv) yük dengeleyici ile %10 deneme ve geri alma planı, (v) sansür hedefi için veritabanının yeri.
Zamanlama sizin dediğiniz gibi: web sitesi tamamen bittikten sonra.

## 2. Önerilen sıra (bağımlılığa göre; her adım ayrı onay + ölçüm)
| Adım | Ne otomatikleşir | Güvenlik kapısı | Ön koşul |
|---|---|---|---|
| OT-1 | Yazılmış ama kapalı doğrulanmış araçlar (müsaitlik, uzatma, tarih okuma) + konuşma kayıtları + eylem beyanı açılır — sıra ve ölçü `docs/RAILWAY-ACILIS-2026-10-15.md` §3'te zaten yazılı ("güvenlik ölçüleri 0, gereksiz soru 0") | kapılar aynı; araç sonucu yoksa cevap ev sahibine | ücretli ölçüm zamanı (kurucu) · Railway · iki etkileşim: kalıcı kuyruk açılınca doğrulanmış erken giriş otomatik onayı kapanır; karar motoru ile kalıcı kuyruk birlikte açılmaz |
| OT-2 | Araç kayıt defteri + 3–4 yeni salt-okuma araç (rezervasyon olguları, görev durumu, giriş bilgisi gönderildi mi) | kiracı kapsamı testle; sonuç cümlesini kod kurar | OT-1 |
| OT-3 | Cevap çıktısı katı şema | önce / sonra aynı sette fark ölçümü | ücretli ölçüm |
| OT-4 | Model çağrısını azaltma: anlama katmanı küçük modele → kod metni kesinleşince cevap çağrısı atlanır → doğrulanmış cevap tekrarı gölgeden çıkar (§1.4) | her biri ayrı A/B; ölçülmeden trafik yok | OT-1, OT-3 · ölçüm |
| OT-5 | Plan → yürüt → yaz tablosu + ev sahibi karar motorunun açılması | ev sahibi onayı gereken öğe türleri listesi kurucuda | OT-2 |
| OT-6 | İstem turnuvası (geliştirme setinde, insan onaylı) | mühürlü setlere dokunulmaz | — |
| OT-7 | Olay zarfı + tüketici başına imleç ("CDC'ye hazır") | davranış değişmez; kâhin testi | migration onayı |
| OT-8 | Misafir notu (dar profil) | KVKK metni + silme / saklama testleri | kurucu kararı · migration |
| OT-9 | Ek hizmetler P0 → P1 → "geri ödeme" satırı | hukuk teyidi; Airbnb mesajında iz yok | D-1…D-7 |
| OT-10 | Akash Aşama A (açık site) | sır / kişisel veri yok | site bitince |

## 3. Kurucu soruları
- **AA-1 (sıra):** yukarıdaki sıra uygun mu; öne almak istediğiniz adım var mı? (Önerim: OT-1 → OT-2 → OT-3; çünkü yazılmış kod boşta duruyor.)
- **AA-2 (araç seçimi):** serbest SQL yok. Modelin kapalı listeden "araç adı + katı şemalı parametre" seçmesi önce ev sahibi yüzeyinde
  ("Ask Lixus") açılsın, misafir yüzeyinde aracı kod seçmeye devam etsin mi? (Önerim: evet. Örnek — ev sahibi WhatsApp'tan "bu hafta kaç giriş
  var?" yazar → model `haftalik_girisler(başlangıç, bitiş)` seçer → kod yalnız o işletmenin verisinde çalıştırır → "Bu hafta 6 giriş var:
  …". Misafir "yarın boş mu?" yazarsa aracı model değil kod seçer.)
- **AA-3 (misafir notu):** dar profil saklansın mı? Hangi alanlar: dil · önceki konaklama sayısı · önceki sorun türleri · ev sahibinin tek satırlık notu? (KVKK metni ve yeni tablo gerekir.)
- **AA-4 (küçük model):** OT-4 için ücretli A/B ölçümünü ne zaman yapalım; "küçük model" adayı siz mi seçersiniz?
- **AA-5 (onaysız otomatik adımlar):** hangi iş adımları ev sahibi onayı OLMADAN ilerlesin? Örnekler (hepsi bugün onaylı ya da kapalı):
  temizlik "Bitti" işaretlenince erken giriş isteyen misafire onayın gitmesi · geç çıkış onaylanınca temizlik görevinin saatinin
  kayması · misafirin "havlu bitti" mesajından temizlikçiye görev açılması.
- **AA-6 (Kafka / Debezium):** şimdi kurmayıp "CDC'ye hazır" (OT-7) ile ilerleyelim mi? (Önerim: evet; tetikleyiciler §1.7.)
- **AA-7 (Akash):** isteğinizi daralttım (§1.8 başı). İki soru: (1) hangisi önce gelir — maliyet mi, sansürden uzak kalmak mı? Sansürse
  veritabanının yeri de plana girer. (2) Aşama A (yalnız açık site) ile başlayıp uygulama için gizli hesaplama + hukuk görüşünü şart mı
  koşalım, yoksa uygulamanın %10'unu riski bilerek daha erken mi deneyelim?
- **AA-8 (istem turnuvası):** otomatik istem yazımı yerine "varyantları ölç, insan seçsin" yöntemi uygun mu?
- **AA-9 (ek satışın geri ödemesi):** "Up-sell Payback" ile neyi kastediyorsunuz? Ben "ek hizmet geliri abonelik ücretini ne kadar
  karşılıyor, ev sahibine göster" diye okudum (§1.6); başka bir şeyse söyleyin.

## 4. Bilerek yapılmayanlar (ve neden)
- Modelin serbest SQL yazması ve misafir yüzeyinde kendi araç zincirini kurması: kiracı sızması ve belirlenimsizlik riski. (Kapalı listeden
  katı şemalı araç seçimi ayrı konu — AA-2.)
- Kafka kümesi + Debezium şimdi: tek tüketici, düşük hacim; işletim yükü karşılıksız.
- Tam olay kaynağı: silme talebiyle çatışır; karma model yeterli.
- CRDT: çevrimdışı çok yazarlı istemci yok.
- Uygulamanın sırlarıyla birlikte tanımadığımız sağlayıcıda çalışması: şifreleme anahtarı kuralı ve KVKK.
