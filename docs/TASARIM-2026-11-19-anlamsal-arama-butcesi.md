# TASARIM 2026-11-19 — Anlamsal arama: belge işleme bütçesi ↔ misafir sorgusu

> Kurucu talimatı 11-19 akşam, madde 2 (AYNEN: `docs/KURUCU-TALIMATI-2026-11-19-aksam-ajan-turu-cevabi.md`). Bu belge KOD DEĞİLDİR: bugünkü
> davranışın çalıştırılarak doğrulanması + önerilen yapı + alternatifler + bedel + sorular. Doğrulama testleri dal `agent/emb-1119`,
> `tests/integration/kb-semantic-stale-vector-and-budget.test.ts` (11 test, gömme sağlayıcısı taklit, ağ yok; ürün kodu değişmedi).
> Misafire giden davranışı değiştiren her öneri §3.6'da önce / sonra örneğiyle; hiçbiri kurucu onayı olmadan yazılmaz.

---

## 1. Doğrulama sonuçları (önce bunlar)

### 1.1 "Güncel bilgi henüz vektörleşmediyse eski şifreyi getirmeyelim" — BUGÜN ESKİ ŞİFRE GELMİYOR (bulgu YOK)

Çalıştırılarak gösterildi (uçtan uca: veritabanı → `retrieveKbForPrompt` → istem bloğu `packKnowledgeBase`):

| Senaryo | Karar | İstemde yeni şifre | İstemde eski şifre |
|---|---|---|---|
| Şifre değişti, ısıtma bütçesi dolu, bellek deposunda eski vektör DURUYOR | `cold` (sözcüksel) | var | yok |
| Kalıcı depo açık, yazma kancası HİÇ koşmadı (eski satır tabloda), süreç yeniden başladı / başka kopya | `cold` | var | yok |
| Uzun rehber (5 parça), yalnız şifre cümlesi değişti, öteki 4 parçanın vektörü güncel | `cold` (yarım harita yok) | var | yok |
| KONTROL: bütçe açılınca yeni metin ısınır | `ok` | var | yok |
| Soğuk pencerede 6 örnek mesaj (Türkçe doğrudan / parafraz, selam, teşekkür, Rusça, Arapça) | `cold` / `not_needed` | 6/6 var | 0/6 |

Neden yapısal olarak gelemiyor (kodda izlendi):
1. **Metin her istekte veritabanından okunur** (`kb-fetch.ts:76`, önbellek yok); dizin önbelleği İÇERİK parmak izlidir (kimlik + `updatedAt` +
   başlık/içerik özeti, `retrieval/index-cache.ts:45`) — eski içeriğin dizini yeni kümeye dönmez.
2. **Vektör depoları İÇERİK adreslidir:** bellek anahtarı model + gömme metninin özeti (`semantic-retrieval.ts:102`); kalıcı depo satırı
   (kalem, girdi özeti) ile ve YALNIZ bugünkü metinlerin özetleriyle istenir (`vector-store.ts:130`), dönen satır özetle yeniden eşlenir
   (`:159`). Eski metnin vektörü yeni metnin anahtarıyla bulunamaz.
3. **Yarım harita yok:** bir parça eksikse kararın tamamı sözcükseldir (`semantic-retrieval.ts:297-304`).
4. Vektör yalnız SIRA üretir; isteme giren metin her zaman güncel dizinin parçasıdır. Bir anahtar hatası olsa bile en kötü sonuç yanlış
   sıralamadır, eski metin değil. Eski METNİN tek olası yolu dizin önbelleği / bilgi tabanı okuması olurdu — ikisi de içerik anahtarlı / taze.

Test vakum değil: mutasyon listesinde (`…/codex-1117/aksam/emb/mut-emb.json`) dizin parmak izini yalnız kimliğe indiren mutant eski
şifreyi isteme sokar ve testi düşürmelidir; vektör anahtarını metnin ilk 20 karakterine indiren mutant eski vektörü yeni metne verir
(`ok` döner) ve testi düşürmelidir. (Koşmadım — ana oturum koşar.)

Kapsam dışı ama aynı sonuç ("misafire eski şifre"), vektörle İLGİSİZ, ölçülmedi — bulgu değil, not:
- Ev sahibi kaydı düzenlemek yerine YENİ bir Wi-Fi kaydı açar ve eskisini etkin bırakırsa iki kayıt da güncel sayılır (saat dışı alanlarda
  çelişki koruması yok).
- Konuşma geçmişinde eski şifre geçiyorsa: istem KURAL-1 kaynak 3'ü yalnız "Bilgi Tabanı'nda olmayan soruda" kullanır (`prompts.ts:110-118`);
  modelin buna uyduğu ölçülmedi.

### 1.2 "Sınır dolunca hazır ve güncel vektörler kullanılamaz hâle gelmiyor" — KURUCUNUN GÖZLEMİ DOĞRU (iki koşulla)

- A işletmesi GERÇEK düzenlemelerle (rotaların kancası `afterKbItemsChanged`) süreç bütçesini 13 turda tüketti (1.860 parça metni; kalan küçük pay da dolduruldu). Bütçe TAMAMEN doluyken
  B'nin önceden ısınmış bilgi tabanı `ok` kaldı; B'nin misafir mesajı başına **tek gömme isteği** (yalnız sorgu metinleri), aynı soru ikinci kez **sıfır istek**
  (sorgu vektörü süreç önbelleğinden). Sebep: bütçe yalnız arka plan ısıtmasında okunur (`semantic-retrieval.ts:186, :214`), sıcak yol yalnız
  sorguyu gömer (`:306-307`) ve bütçeye bakmaz.
- **Koşul 1 (G2'nin bulgusu, bugünkü açık):** bütçe doluyken B KENDİ kaydını düzenlerse B `cold` kalır, ısıtma reddedilir. Reddedilen iş kuyrukta
  bekletilmez: pencere açıldıktan sonraki İLK misafir sorusu (yine sözcüksel) ısıtmayı yeniden tetikler. İçerik güncel kalır — kayıp yalnız
  anlamsal arama.
- **Koşul 2 (bellek tahliyesi):** bellek deposu süreç başına 4.096 parça (`:62`), LRU. B'nin iki sorusu arasında ≥ 4.096 yeni parça girerse (bütçe
  2.000/saat/süreç → ≥ ~2 saat doymuş ısıtma) B'nin vektörleri tahliye edilir. Kalıcı depo KAPALIYKEN B `cold` kalır ve yeniden ısıtma bütçeye
  takılır; AÇIKKEN depodan okunur, `ok` (test bellek tavanını küçülterek ölçtü). 🚨 `KB_VECTOR_STORE_ENABLED` açılış belgesinin "AÇILIŞTA 1"
  listesinde DEĞİL (§5'te tarif var) → soru E-4.

### 1.3 Maliyet ölçümleri (doğruluk değil, bedel)

| Ölçüm | Sonuç |
|---|---|
| Aynı süreçte aynı uzunlukta şifre değişimi (5 parçalı rehber) | 1 parça yeniden gömüldü — **değişmeyen parça bugün yeniden işlenmiyor** (parça başına içerik özeti var) |
| Başa kısa cümle (ilk parçanın boş payına sığar) | 1 parça |
| Başa uzun ek (~170 karakter, payı aşar) | 5/5 parça — açgözlü paketleme sınırları kaydırır |
| Yalnız başlık değişimi | 5/5 — başlık gömme metninin önekinde (bilinçli) |
| Kalıcı depo açık + düzenleyen süreçte vektörler bellekte YOK | 5/5 — kanca kalemin BÜTÜN satırlarını siler (`vector-store.ts:230` sürüm uyuşmazlığı kalem düzeyinde), değişmeyen 4 parça yeniden ödenir |
| Aynı kayıt birkaç saniye arayla 5 kez kaydedildi | 5 ayrı gömme — kuyrukta birleştirme yok |

Para ölçeği (kodun kendi tahmini, `semantic-retrieval.ts:68`): tavan 2.000 metin/saat ≈ 300k token ≈ 0,6 sent/saat → doymuş süreç ayda ~4 $. Yani
sorun bugün FATURA değil ADALET: bir işletme ötekilerin hazırlanmasını geciktirebiliyor; tavan da süreç başına (kopya sayısıyla çarpılır).

---

## 2. Bugünkü yapı (envanter)

| Parça | Yer | Not |
|---|---|---|
| Ne zaman anlamsal arama koşar | `retrieval/select.ts:532` `retrievalNeeded` | yalnız ≤30 kalem / ≤24k sığmayan bilgi tabanı. Plan tavanı 15 / 30 / 60 kalem → yalnız büyük bilgi tabanları |
| Sıcak yol | `semantic-retrieval.ts:250-332` | yalnız sorgu gömülür (1,5 sn), eksik parça → `cold` + arka plan ısıtması |
| Bellek deposu | `:95-125` | LRU 4.096, içerik anahtarlı, kiracılar ortak |
| Isıtma bütçesi | `:127-135` | süreç belleği, 2.000 metin/saat, TÜM kiracılar ortak, hepsi-ya-hiç |
| Isıtma tetikleri | `kb/after-change.ts:22`, `kb-warm.ts:63` | her kayıt yazımında hemen (beklenmeden) + süreç açılışında bir kez; reddedilen iş kuyruğa alınmaz |
| Kalıcı depo | `vector-store.ts` (migration 87, `KB_VECTOR_STORE_ENABLED` kapalı) | metin saklanmaz; okuma 250 ms tavanlı; yazma kalem sürümü tutuyorsa |
| Temizlik | `vector-store.ts:230`, `:250` | kalem `updatedAt` ≠ satır sürümü → sil (kalem düzeyinde) |
| Sorgu vektörü önbelleği | `provider.ts:106` | LRU 256, içerik anahtarlı |
| Misafir sorgusunun para kapısı | `daily-budget.ts` | gömme ayrıca sayılmaz; o mesajın AI çağrısı işletmenin günlük AI tavanına sayılır (QR'da önce, kanalda `peek` + sonra) |
| Kopyalar arası ortak sayaç (VAR) | `RateLimitCounter` (`schema.prisma:39`), `rate-limit.ts:140` | dağıtık, atomik, DB saati; `daily-budget.ts` QR payı bu tabloyla migration'sız kuruldu |

---

## 3. Kurucunun istedikleri — bugün / önerilen / alternatif / bedel

### 3.1 İşletme başına arka plan (belge işleme) bütçesi
- **Bugün:** yok; süreç başına tek ortak sayaç (`:127`). G2 + EMB-2: tek işletme 13 düzenleme turunda herkesin saatlik payını bitiriyor.
- **Önerilen:** iki kova, sıra önemli ("kendi kovası önce" — `daily-budget.ts` QR deseninin aynısı): (1) işletme kovası
  `kb-embed-org:<orgId>` (saatlik); taşarsa ORTAK kovaya DOKUNMADAN reddedilir; (2) ortak arka plan kovası `kb-embed-bg` (saatlik). Bir ısıtma
  işi (bir dairenin eksik parçaları) ya tamamen alınır ya hiç (yarım ısınmış bilgi tabanı zaten `cold` kalır — yarım ödeme boşa gider).
- **Alternatif:** daire başına kova (aynı işletmenin bir dairesi ötekini bekletmez) — bedeli daha çok anahtar; işletme kovasının içinde ikinci
  kova olarak sonra eklenebilir.
- **Bedel:** her ısıtma işinde 1–2 atomik DB yazması (iş başına, parça başına değil). Kova büyüklüğü bir ürün kararı (E-1). Büyük bilgi tabanının tam
  yeniden gömmesi tahminen 60–300 parça (ölçülmedi; tavan bilgi tabanı başına 1.000); öneri işletme başına saatte 600.

### 3.2 Misafir sorgularına ayrılmış kapasite
- **Bugün:** fiilen ayrı — sorgu gömmesi arka plan bütçesine hiç bakmıyor (ölçüldü: bütçe doluyken B'nin sorusu gömüldü). Ortak olan tek
  şey sağlayıcının kendisi (hız sınırı / kesinti); bugünkü tavanda (≤ ~5k token/dk arka plan, kodun tahmini) anlamlı değil.
- **Önerilen:** bu ayrımı KORUMAK ve pinlemek: sıcak yol hiçbir arka plan kovasını okumaz. Üstte bir sağlayıcı tavanı gelirse (§3.3)
  misafir payı ondan AYRILIR: arka plan en fazla (tavan − misafir payı) kullanır; misafir trafiği sessizken arka plan payını kullanamaz
  ama misafir payı arka plan dolu olduğu için asla daralmaz.
- **Alternatif:** misafir sorgusunu da sayaca yazmak (görünürlük) — her misafir mesajına bir DB yazması ekler; günlük AI tavanı zaten
  dolaylı sınır. Önerim: yalnız say, reddetme (ilk dilimde hiç yazmamak da kabul).
- **Bedel:** pin + belge; davranış değişmez.

### 3.3 Sağlayıcı MALİYET tavanı (en üstte)
- **Bugün:** süreç başına 2.000/saat (fiilen kopya sayısı × 2.000); misafir sorgularında tavan yok (günlük AI tavanı dolaylı).
- **Önerilen:** `kb-embed-global` günlük kova (metin sayısı; token yerine metin — parça ≤ 1.200 karakter, tahmin yeterli): arka plan + misafir
  toplamı. Taşarsa arka plan durur, misafir sorgusu SÖZCÜKSELE düşer (bugünkü `unavailable` davranışı) + geçiş tabanlı tek alarm
  (`alert-state.ts` deseni; çağrı başına alarm YOK).
- **Alternatif:** gerçek token sayımı (sağlayıcının `usage` alanı) — daha doğru, ama bütçe kararı isteği göndermeden ÖNCE verilmeli; metin
  sayısı önceden bilinir.
- **Bedel:** misafirin anlamsal araması tavanda kapanır — tavan, olağan trafiğin çok üstünde seçilmeli (E-2).

### 3.4 Bütçeyi uygulama kopyaları BİRLİKTE görür
- **Bugün:** süreç belleği; her kopya ve her yeniden başlatma sıfırdan sayar.
- **Önerilen (ŞEMASIZ):** `RateLimitCounter` tablosu (dağıtık, atomik, DB saati; QR payı aynı tabloyla migration'sız kuruldu). Gereken tek yeni
  parça "n al — sığmıyorsa sayacı ARTIRMADAN reddet" ifadesi: bugünkü `rateLimit` her vuruşu (reddedileni de) +1 sayar
  (`daily-budget.ts` QR açıklaması). Tek ifade: pencere dolmuşsa `count = n`, sığıyorsa `count + n`, değilse dokunma; dönüşten verilip
  verilmediği okunur. DB arızasında bugünkü süreç içi sayaç yedek kalır (ısıtma isteğe bağlı bir iyileştirme; fail-soft).
- **Alternatif:** yeni tablo `KbEmbedBudget(scope, windowStart, used)` — migration ister, kazancı yok.
- **Bedel:** iş başına bir DB yazması; saat dilimi kuralı `rate-limit.ts` ile aynı (`now() AT TIME ZONE 'utc'`).

### 3.5 Aynı kaydın art arda düzenlenmesi — ara sürümlere para yok; değişmeyen parça yeniden işlenmez
**Ara sürümler.** Bugün her kayıt anında ısıtma başlatır; 5 kayıt = 5 gömme (ölçüldü).
- **Önerilen A (şemasız):** daire başına GECİKMELİ ısıtma: kanca daireyi "kirli" işaretler (süreç içi, son kayıttan D saniye sonra çalışır;
  her yeni kayıt saati yeniden kurar). Çalışınca bilgi tabanının O ANKİ hâlini okur → kuyrukta yalnız güncel sürüm. Reddedilen iş pencere
  açılınca yeniden planlanır (bugün kayboluyor → G2'nin "pencere açılana kadar ve ilk misafir sorusuna kadar" süresi kısalır).
- **Önerilen B (MIGRATION):** kalıcı kuyruk `KbEmbedJob { propertyId @id, dirtyAt, dueAt, attempts, lastOutcome }`; kanca upsert eder, 2 dakikalık
  zamanlanmış iş vadesi gelenleri `FOR UPDATE SKIP LOCKED` ile alır. Yeniden başlatmada kaybolmaz, kopyalar aynı işi iki kez almaz, reddedilen
  iş `dueAt = pencere sonu` ile kendiliğinden döner.
- **Bedel:** gecikme D kadar bilgi tabanı `cold` kalır (bu sürede güncel kayıtta sözcüksel — doğruluk kaybı yok, anlamsal kapsam kaybı var).
  Öneri D = 20 sn (E-5). A'da kopyalar arası çift iş mümkün (her kopya kendi düzenlemesini geciktirir; ikinci kopya kalıcı depoda satırı
  bulursa gömmez) — sınırlı.

**Değişmeyen parça.** Bugün parça başına içerik özeti VAR (bellek + kalıcı depo); aynı süreçte değişmeyen parça yeniden gömülmüyor (ölçüldü 1/5).
İki boşluk ölçüldü:
1. Kalıcı depo temizliği KALEM düzeyinde (`itemUpdatedAt ≠ updatedAt` → kalemin bütün satırları silinir); düzenleyen süreçte vektör bellekte
   yoksa (tahliye, soğuk kopya) değişmeyen parçalar yeniden ödenir (5/5). **Önerilen (şemasız):** temizlik kalemin BUGÜNKÜ parça özetlerini
   hesaplayıp yalnız artık geçmeyen özetleri siler, kalanların sürüm damgasını yeniler (`UPDATE … SET itemUpdatedAt = k.updatedAt WHERE inputHash
   IN (bugünkü)`). Sürüm kuralı (eski ısıtma eski satır yazamaz) aynen kalır. Bedel: kancada bilgi tabanını okuyup parçalamak (yalnız
   parçalayıcı; dizin kurulmaz).
2. Açgözlü paketleme: parça payını aşan ekleme sonraki sınırları kaydırır (5/5). İçerikle belirlenen sınır bunu yerelleştirir ama getirme
   parçalarını değiştirir → ölçek düzeneği + `rag-lab` ölçümü olmadan ÖNERİLMEZ; sıklığı bilinmiyor. Başlık değişiminde bütün parçalar
   (bilinçli, bağlam öneki).

### 3.6 Güncel bilgi vektörleşmediyse: güncel kayıtta sözcüksel; SAĞLAM DAYANAK yoksa cevap otomatik gitmez
- **Bugün (doğrulandı):** soğuk pencerede karar GÜNCEL kayıtlarda sözcükseldir (§1.1). Sözcüksel isabet yoksa geri çekilme: en yeni 30 kayıt
  (`select.ts:726`) + istem notu "'bilgi yok' deme — insana devret". `sem` / `fb` gönderim kapısına GİRMİYOR (yalnız karar kaydında,
  `automation.ts:2708`). Ne zaman uzun sürer: bütçe dolu (G2), sağlayıcı arızası, kalıcı depo kapalıyken yeniden başlatma / tahliye.
- **Kural A (dar, şemasız, anahtarlı — misafire gideni DEĞİŞTİRİR):** anlamsal kaynak bu kararda yoksa (`sem` = `cold` / `unavailable`) VE
  sözcüksel isabet yoksa (`fb` = `no_lexical_hits`) VE mesajda bir bilgi isteği varsa → otomatik gönderim tutulur, taslak ev sahibine.
  "Bilgi isteği var mı" kararı ANLAMA KATMANININ istek listesinden gelir, kelime listesinden DEĞİL (kurucu 11-18 akşam kuralı). Ölçüm bunun
  şart olduğunu gösterdi: "Teşekkürler, her şey çok güzel!" soğuk pencerede `fb = no_lexical_hits` — yalnız `fb`'ye bakan kural teşekkürü de tutardı.
- **Kural B (genel dayanak, var olan iş):** 11-12 dayanak mimarisi (cevap parçaları kipi + okuyucu, `AI_ANSWER_PARTS_ENABLED` vb., KAPALI, kör
  ölçüm bekliyor): her parça güncel kayıttan birebir alıntıya dayanmak zorunda — soğuk pencereye özel kural gerekmez.
- **Önerim:** B ana yol; A yalnız B açılana kadar geçici emniyet, önce ücretsiz tekrar oynatmayla "kaç mesaj tutulurdu" ölçülerek.

Önce / sonra (46 kalemli daire; ev sahibi Wi-Fi şifresini az önce değiştirdi, yeni metin henüz vektörleşmedi). "Getirme bugün" sütunu testte
ÖLÇÜLDÜ (`EMB-ORNEK`); model koşmadı → "bugün ne gider" sütunu isteme giren bilgiye göre beklenen cevaptır, ölçülmüş cevap değil.

| Misafir mesajı | Getirme bugün (ölçüldü) | Bugün ne gider | Kural A ile | Kural B ile |
|---|---|---|---|---|
| "Wi-Fi şifresi ne?" | sözcüksel isabet, istemde yalnız Wi-Fi kaydı (yeni şifre) | "Wi-Fi şifremiz YENI-7305." (kapılar geçerse) | AYNI (dayanak var) | AYNI (alıntı kayıtta) |
| "İnternete bağlanmak için ne yazmam gerekiyor?" | sözcüksel isabet YOK → en yeni 30 kayıt (düzenlenen Wi-Fi kaydı en yeni olduğu için içinde) + devret notu | büyük olasılıkla "Wi-Fi şifremiz YENI-7305." | TUTULUR → ev sahibi taslağı görür, onaylarsa gider | alıntı Wi-Fi kaydından birebirse gider |
| "Merhaba, nasılsınız?" | arama sorgusu yok (`empty_query`, gömme gerekmez) | selam cevabı | etkilenmez | etkilenmez |
| "Teşekkürler, her şey çok güzel!" | sözcüksel isabet yok (`no_lexical_hits`) | kısa teşekkür / kapanışa sessizlik kuralı | etkilenmez (istek yok — anlama katmanı) | etkilenmez |
| "Какой пароль от вайфая?" | sözcüksel isabet (yabancı dil sözlüğü) | yeni şifre (Rusça) | AYNI | AYNI |

Açık noktalar: QR'da "tutmak" ne demek (orada ev sahibi taslak akışı yok; K10 gereği devir cümlesi misafire gitmez — misafire ne gideceği ayrı karar) · anlama
katmanı başarısızsa soğuk pencerede tut / gönder · tutulan mesajın panel etiketi YENİ müşteri metni ister (metin koda konmaz, önce soru).

### 3.7 Reddedilen iş kaybolmasın
Bugün bütçe reddederse iş unutulur; yalnız bir sonraki misafir sorusu / düzenleme / yeniden başlatma yeniden dener (ölçüldü: tahliye kolunda
yeniden ısıtma 0, sonra yine `cold`). §3.5 A ya da B'nin yeniden planlaması bunu çözer; kova ayrımıyla birlikte G2'nin senaryosu "A kendi
kovasını bitirir, B'nin işi B'nin kovasından hemen geçer" olur.

---

## 4. İlk kabul testi (taslak) — "A yoğun düzenlerken B'nin güncel bilgi tabanında anlamsal arama sürer"

```ts
it("A yoğun düzenlerken B'nin güncel bilgi tabanında anlamsal arama sürer", async () => {
  // Kurulum: kalıcı depo açık; B 46 kalem, ısınmış; A 30 uzun kalem.
  // 1) A gerçek kancayla (afterKbItemsChanged) 300/dk sınırı içinde düzenler, kendi işletme kovasını bitirir.
  // 2) Her 10 A düzenlemesinde bir B misafir sorusu → sem === "ok"; B'nin sorusu başına tek gömme isteği.      [BUGÜN ✓ — EMB-2 test 1]
  // 3) A hâlâ düzenlerken B bir kaydını düzenler → gecikme + ısıtma süresi içinde sem === "ok" ve istemde yeni metin. [BUGÜN ✗ — cold (G2)]
  // 4) "Başka kopya": süreç belleği sıfırlanır (restart) → bütçe sayacı DB'de kalır: A'nın kovası dolu, B'ninki değil. [BUGÜN ✗ — süreç belleği]
  // 5) A'nın reddedilen işleri ortak kovanın sayacını ARTIRMAZ (RateLimitCounter satırı okunur).               [BUGÜN yok]
  // 6) Ortak arka plan kovası doluyken B'nin sorgu gömmesi yapılır (misafir payı).                              [BUGÜN ✓ — ayrı yol]
  // 7) A'nın kendi son sürümü: cold → güncel kayıtta sözcüksel, eski içerik istemde yok.                       [BUGÜN ✓]
}, 300_000);
```

Ek kontroller: bütçe doluyken eski şifre isteme girmez (EMB-1 testleri aynen kalır) · 5 ardışık kayıt → tek gömme (gecikmeli ısıtma) ·
kalıcı depo açıkken düzenleyen süreçte bellek boşken yalnız değişen parça gömülür (bugün 5/5 → 1/5).

---

## 5. Dilimleme önerisi

| Dilim | İçerik | Şema | Misafire dokunur mu |
|---|---|---|---|
| D0 | Kalıcı depoyu açılışta açmak (`KB_VECTOR_STORE_ENABLED=1`; migration 87 zaten onaylı, açılış yedeğiyle gider) | yok (var olan) | hayır (yalnız `cold` süresi kısalır) |
| D1 | Kova ayrımı: işletme kovası → ortak arka plan kovası, "n al ya da sayacı artırmadan reddet" ifadesi, `RateLimitCounter` üzerinde; sıcak yolun kovasız kaldığı pin; DB arızasında süreç içi yedek | ŞEMASIZ | hayır |
| D2 | Gecikmeli ısıtma + reddedilen işi yeniden planlama (süreç içi) | ŞEMASIZ | hayır |
| D3 | Temizliği parça özeti düzeyine indirmek (değişmeyen parçanın satırı kalır) | ŞEMASIZ | hayır |
| D4 | Günlük sağlayıcı tavanı + misafir payı + geçiş tabanlı alarm | ŞEMASIZ | tavana çarpınca misafir sorgusu sözcüksele düşer (bugünkü arıza davranışı) |
| D5 | Kural A (soğuk pencerede dayanak yoksa tut) — YA DA Kural B'yi beklemek | ŞEMASIZ | EVET → kurucu onayı + önce/sonra |
| D6 | Kalıcı kuyruk tablosu `KbEmbedJob` | MIGRATION (kurucu onayı) | hayır |

D1–D4 yeni davranıştır → her biri varsayılan kapalı anahtarla; yeni anahtar açılış belgesine + `env-check` + ölçüm koşu kimliği pinlerine girer.

---

## 6. Açık sorular (kurucu)

- **E-1** İşletme kovası: saatte 600 parça metni (tipik büyük bilgi tabanının ~2 tam yeniden gömmesi) uygun mu? Daire başına ikinci kova şimdi mi?
- **E-2** Ortak tavan: arka plan saatte 2.000 (bugünkü süreç başı değer, artık TÜM kopyalar için) + misafir payı; günlük üst tavan kaç olsun?
  (Kodun kendi tahminiyle doymuş arka plan ayda ~4 $ / kopya — tavan para için değil adalet için.)
- **E-3** Soğuk pencerede dayanak: Kural A (geçici, dar) mı, yoksa genel dayanak işini (parça kipi) mi bekleyelim? QR'da tutulan mesaj ne olsun?
- **E-4** Kalıcı depo (`KB_VECTOR_STORE_ENABLED`) açılışta "1" mi? B'nin tahliyeye dayanıklılığı buna bağlı (ölçüldü).
- **E-5** Gecikmeli ısıtmada bekleme: 20 sn? (O süre içinde bilgi tabanı güncel kayıtta sözcüksel.)
- **E-6** Kalıcı kuyruk (migration) şimdi mi, çok kopyaya geçince mi? (Bugün tek kopya — `docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md`.)

## 7. Not: "her soru için veritabanı / model gerekmez" önerisinin bu alana düşen kısmı
Bugün zaten içerik anahtarlı yeniden kullanım var: dizin önbelleği (bilgi tabanı parmak izi, 10 dk) · sorgu vektörü önbelleği (metin özeti; aynı
soru ikinci kez sağlayıcıya gitmez — ölçüldü) · parça vektörleri (metin özeti). Misafir mesajı başına anlamsal yolun gömme isteği 1 (ölçüldü),
tekrarında 0. Seçimin kendisi milisaniyedir; "bilgi tabanı sürümü + mesaj" anahtarlı bir sonuç önbelleği kayda değer kazanç getirmez, önerilmez.
Bir mesajdaki veritabanı sorgu sayısı bu belgede ÖLÇÜLMEDİ. Yeni bir önbellek eklenirse anahtarı içerik parmak izi olmalı (`max(updatedAt)` değil).
