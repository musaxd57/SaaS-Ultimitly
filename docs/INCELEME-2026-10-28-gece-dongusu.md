# Gece döngüsü — derin hata ayıklama bulguları (10-28 / 10-29 gece)

> Kurucu (aynen): "soru sormadan ilerle, debugging yap ama sadece kendin oku, her 30 dk'da 1 derin ve geniş çapta didik didik debugging".
> Alt ajan yok; her bulgu kodda ölçülür. Yalnız TUTMA yönündeki düzeltmeler ve iç hatalar uygulanır; müşteriye gideni gevşeten ya da yeni
> davranış kuran bulgu önce / sonra örnekli SORU olarak buraya yazılır.

## Tur 1 — `ai/host-contact-filler.ts` (bu gece yazılan R13-b/c silicisi) × konuşma öğeleri kipi (canlı)

### GD1 — P1 (kendi kodum, tutma yönünde düzeltme) — misafirin sorduğu varsayımsal durumun cevabı silinince istek sessizce "cevaplandı" kapanıyor
- Mesaj: "Otopark var mı? Wi-Fi bozulursa ne yapmalıyım?" · model: "Otopark arkada. Wi-Fi bozulursa ev sahibinize yazın." · model beyanı: iki
  istek de cevaplandı (`answeredRequests`).
- Silici "yazın" cümlesini çıkarır (kurucu: hiçbir koşulda gitmez) → misafire yalnız otopark gider; ama öğe kipinde Wi-Fi isteği modelin beyanıyla
  "cevaplandı" kapanır → ev sahibi o soruyu GÖRMEZ.
- Düzeltme: çıkarılan cümle misafirin TAM sorduğu duruma cevapsa (`guestAskedThisSituation`) cümle silinmez, bütün cevap tutulur
  (`hostContactOnly`) — ev sahibi yanıtlar. Genel kapanış (soruyla ilgisiz) silinmeye devam eder.
- Durum: ✅ 10-29 — kırmızı-önce test (`host-contact-filler.test.ts` GD1), mutasyon 3/3, ilgili 107 test yeşil.

### GD2 — P3 (bilinen sınır, düzeltilmedi) — koşul eki sezgisi yer adlarına takılabilir
- `asksHypotheticalSituation`: "Bursa'dan geliyoruz" → "Bursa" "-rsa" koşul eki gibi okunur. Etkisi dar: koşullu "arayın" cümlesinin KALMASI için
  ayrıca konu örtüşmesi + bilgi tabanı dayanağı gerekiyor. Yazıldı, değiştirilmedi.

### GD3 — P3 (bilinen sınır) — önceki cevapsız mesaj varsayımsal, son mesaj yaşanan olay
- "Anahtarı kaybedersem?" (cevapsız) → "Anahtarı kaybettim" (yeni): silici iki metni birlikte okuduğu için "kaybederseniz ev sahibinizi arayın"
  (dayanaklıysa) KALIR. Tek mesajda ("Anahtarı kaybettim") silici cümleyi çıkarır, içerik kalmazsa tutar (ölçüldü). İlk taslakta "sözcük ağı bunu
  zaten tutar" yazmıştım — ÖLÇÜM YANLIŞLADI (↓GD4); düzeltildi.

### GD4 — P2 — SORU (davranış değişikliği) — kayıp anahtar sözcük ağında sorun sayılmıyor
Ölçüldü (kapı, model niyeti "genel", cevap "Anahtarı kaybederseniz ev sahibinizi arayın."):

| misafir | sözcük ağı | bugün |
|---|---|---|
| "Anahtarı kaybettim" | `checkin`, şikâyet değil | kapı GEÇİRİR (silici "arayın"ı çıkarır → içerik yoksa tutulur) |
| "I lost the key" | `checkin`, şikâyet değil | aynı |
| "Anahtarı kaybettim, ne yapmalıyım?" | `checkin`, şikâyet değil | aynı |

Kayıp anahtar bir ERİŞİM / GÜVENLİK olayıdır (kilit değişimi, yedek anahtar, ücret). Bugün tek koruma modelin niyeti. Önerim: "anahtar(ı) kaybettim /
kayboldu / bulamıyorum / lost (my) key / locked out" yaşanan olay kalıbı sözcük ağında erişim sorunu sayılsın → cevap ne olursa olsun ev sahibine
kalır (yedek anahtar bilgisi bilgi tabanında olsa bile ilk cevap ev sahibinden). Önce: model "genel" derse bilgi tabanındaki "yedek anahtar
resepsiyonda" cevabı gidebilir. Sonra: her kayıp anahtar bildirimi ev sahibinde. **Böyle yapalım mı?**

## Tur 2 — aynı silici, cümle içi karışım + koşul sezgisi

### GD5 — P1 (kendi kodum, tutma yönünde düzeltme) — bilgiyle AYNI cümledeki talimat silinirken bilgi de gidiyor
Ölçüldü (tsx deneme betiği, sonra silindi):

| misafir | model cevabı | bugün misafire giden |
|---|---|---|
| "Havlu nerede? Otopark var mı?" | "Havlular yatak odasındaki dolapta, bir sorun olursa ev sahibinize yazın. Otopark binanın arkasında." | "Otopark binanın arkasında." — havlu cevabı KAYBOLUR |
| "Klima nasıl açılır? Otopark?" | "Kumanda komodinin üstünde, çalışmazsa ev sahibinizi arayın. Otopark arkada." | "Otopark arkada." — klima cevabı KAYBOLUR |

Silici cümle bazında çalışıyor; virgülle bağlanmış bilgi yan cümlesi talimatla birlikte siliniyor. Öğe kipinde model havlu isteğini "cevaplandı"
beyan ettiği için istek ev sahibine hiç görünmeden kapanır (GD1 ile aynı sınıf).
- Düzeltme (TUTMA yönü): silinecek cümlenin başka bir yan cümlesi bilgi taşıyorsa (anlamlı, koşul yan cümlesi değil, yalnız genel "sorun /
  herhangi / any issue" sözcüklerinden ibaret değil) cümle silinmez, BÜTÜN cevap tutulur — ev sahibi yanıtlar. Koşul yan cümlesi + talimattan
  ibaret genel kapanış ("Bir sorun olursa, ev sahibinize yazın.") silinmeye devam eder.
- **SORU (sabah, müşteriye giden metin):** tutmak yerine yalnız talimat yan cümlesini silip bilgiyi göndermek mümkün:
  önce (bu düzeltmeyle) → cevap tutulur, ev sahibi yanıtlar · sonra (öneri) → misafire "Havlular yatak odasındaki dolapta. Otopark binanın
  arkasında." gider. "Talimat yok" silicisi (`no-instruction-filler.ts`) bunu yan cümle düzeyinde zaten yapıyor; aynı yöntem. **Böyle yapalım mı?**

### GD6 — P2 (iç hata, tutma yönü) — koşul eki sezgisi İngilizce sözcüklere takılıyor
`asksHypotheticalSituation` Türkçe koşul ekini (`-rsa / -rse`) sözcük sonunda arıyor; İngilizce "of course", "worse", "nurse", "horse" de
eşleşiyor. Ölçüldü: "Of course, the wifi is not working" (YAŞANAN olay) → varsayımsal sayılıyor. Etkisi: konu örtüşür ve bilgi tabanı dayanağı
varsa koşullu "ev sahibinizi arayın" cümlesi sorunu bildiren misafire GİDER (kurucu: "savrulmasın"). Düzeltme: bilinen İngilizce "-rse"
sözcükleri ve "Bursa" (GD2) koşul aranmadan önce silinir → bu durumda cümle çıkar / cevap tutulur.

### GD7 — P1 (kendi kodum, iç hata) — `hostContactOnly` işareti yeniden yazma ve kod metni birleşiminde yanlış metne yapışıyor
- `mergeSeniorRewrite` (kıdemli okuyucu "bir kez yeniden yaz", kanal + QR): sonuç İLK taslağın alanlarını yayıp metni yeni çağrıdan alıyor;
  `hostContactOnly` ilk taslaktan kalıyor, yeni çağrınınki DÜŞÜYOR. Yeni metin yalnız "Bir sorun olursa ev sahibinize yazın."dan ibaretse
  (silici içerik bulamadı → metin aynen + işaret) kapı işareti görmez → cümle misafire GİDER (kurucu: "kesinlikle bu gidemesin"). Ters yönde
  ilk taslağın işareti yeni, düzgün metni gereksiz tutar.
- `codeBuiltResult` (doğrulanmış erken giriş / müsaitlik / uzatma / politika KOD metni): model taslağının işaretini koda taşıyor → kodla kurulan
  onaylı metin `reply_host_contact_only` ile gereksiz tutuluyor.
- Düzeltme: işaret METNE aittir — birleşimde yeni çağrıdan alınır (`verifiedPartsOnly` ile aynı kural), kod metninde düşer.

**Tur 2 durumu:** GD5 / GD6 / GD7 ✅ 10-29 — kırmızı-önce (4 test), mutasyon 12/12 (ilk koşuda 3 yaşayan → sayı taşıyan, genel ve nezaket
yan cümlesi pinleri eklendi), ilgili 343 test yeşil. Not: "Herhangi bir sorunda, ev sahibinize yazın." / "Should anything go wrong, message
your host." koşullu talimat SAYILMIYOR — "bilgim yok" yönlendirmesi olarak `refersGuestToHost` yakalıyor ve kapı bütün cevabı tutuyor (bugünkü
davranış, güvenli yön). Kurucunun "genel kapanış çıkar" kararı bu iki kalıpta silme değil tutma üretiyor — sabah sorusu GD8.

### GD8 — SORU (sabah) — "Herhangi bir sorunda / Should anything go wrong" kapanışı çıkarılmıyor, bütün cevap tutuluyor
| misafir | model cevabı | bugün |
|---|---|---|
| "Otopark var mı?" | "Otopark arkada. Herhangi bir sorunda ev sahibinize yazın." | cevap TUTULUR (ev sahibi yanıtlar) |
| "Is there parking?" | "Parking is behind the building. Should anything go wrong, message your host." | cevap TUTULUR |

Öneri: bu iki kalıp da "koşullu kapanış" sayılsın → kapanış çıkar, "Otopark arkada." gider (R13-c'nin öteki kalıplarıyla aynı). Bu müşteriye
giden metni GEVŞETİR (bugün tutuluyor) → **böyle yapalım mı?**

### CI notu (10-29)
CI 1681 (`4465b0fd`) veritabanısız kolda bir kez kırmızı; aynı kodu içeren CI 1683 (`f4fb30eb`) altı işin hepsinde yeşil, yerel tam kapı da
yeşil → tek seferlik kararsız test (log sağlayıcı dışı adreste, test adı okunamadı). Tekrarlarsa adıyla izlenecek.

## Tur 3 — çıktı vetosu dış kabuğu + silicinin güvenlik uyarısı sözlüğü

- `output-veto.ts` dış kabuğu (yer tutucu → söz → devir sırası, görünmez karakter ayıklama, Türkçe küçük harf ikinci biçim) satır satır okundu:
  yeni bulgu yok (önceki 15 ajan / Codex turlarında ölçülmüş, süre pinleri yerinde).

### GD9 — P2 (kendi kodum, tutma yönü) — güvenlik uyarısı sözlüğü tehlike sözcüğüne benzeyen adlara takılıyordu
`SAFETY_WARNING` Türkçe gövdeleri ek sınırı olmadan eşliyordu: "Gazino tarafında bir sorun olursa ev sahibinizi arayın.", "Gaziantep'ten
gelirken sorun olursa …", "Polisaj makinesi bozulursa …" güvenlik uyarısı sanılıp KORUNUYOR, misafire gidiyordu (ölçüldü). Düzeltme:
gazete / gazino / gazoz / gazi-, polisaj / polisiye / polister, karbonat dışlandı; "gaz kokusu", "gazı", "polise", "karbon monoksit" korunur.
✅ kırmızı-önce, mutasyon 5/5, dosya 32/32. Bilinen sınır: büyük harfli "GAZI" (gazı) `/i` yüzünden dışlanır → cümle çıkar (tutma yönü değil
ama çok seyrek; model büyük harfle yazmaz).

## Tur 4 — QR kapısı (`guest-chat-gate.ts` `evaluateEscalation`)
Sıra satır satır okundu: ad enjeksiyonu → model kaynağı → riskli niyet → model risk etiketi → kelime ağı (şikâyet / iade / erken ayrılış /
insan) → enjeksiyon (mesaj + geçmiş) → kelime risk etiketi (51 bağlam kaldırma dahil) → doğrulanmamış tehlike → model risk düzeyi → "bilgim
yok" (hakem hükmü yalnız aynı metne) → `hostContactOnly` → kıdemli okuyucu (ödeme / özür) → çıktı vetosu → eylem beyanı → güvence → acil
yönerge → iç kaynak → evcil hayvan → kanıtsız arıza. Kanal kapısıyla aynı sıra ve yüklemler; GD7 sonrası kod metni (`codeBuiltResult`) ve
yeniden yazma birleşimi işareti doğru taşıyor. Yeni bulgu yok.

## Hız turu (kurucu 10-29: "AI mesaj hızı, panellerin açılma hızları, her tuşun / panel geçişinin hızı; 404 ve yavaşlıkta nasıl ilerlediği görselle")
Görsel rapor: https://claude.ai/artifact/3GRNGfjqfiPHB8ZhbjBN5k (tablolar + yavaş ağ film şeritleri + 404 görüntüleri). Ölçüm: yerel üretim derlemesi,
gerçek hacme yakın KURGUSAL veri (10 daire · 1.504 rezervasyon · 1.336 konuşma · 16.659 mesaj), Chromium, 3–5 tekrar ortanca; canlı (Railway) kapalı.
- Sayfa açılışı (normal ağ): ana içerik 0,14–0,69 sn; en yavaş Görevler (0,69) ve Takvim (0,52). Düğmeler: 98 düğme, ortanca 80 ms, %90'ı 145 ms altı.
- Yapay zekâ cevabı (docs/olcum, 4.780 gerçek ölçüm): tam akış ortanca 7,0 sn / %90 11,2 sn / %99 22 sn; QR ortanca 5,8 sn ("Lixus AI yazıyor…" görünür).
- **HZ1 — SORU:** her menü geçişi ~0,4 sn; veri + kod 0,1 sn'de hazır, ~0,3 sn React 19'un yükleniyor iskeletinden sonraki zorunlu bekletmesi
  (`globalMostRecentFallbackTime + 300`, react-dom 19.2.7, ölçüldü). Öneri: hızlı sayfalarda `loading.tsx` kaldırılıp tıklanan menü öğesinde
  gösterge (`useLinkStatus`) → beklenen ~0,1–0,2 sn; yavaş ağda eski sayfa kalır + gösterge. Yalnız panel; misafire dokunmaz. **Böyle yapalım mı?**
- **HZ2 — SORU:** yavaş 3G'de menü tıklamasından sonra ~1 sn ekranda hiçbir değişiklik yok (0,1 / 0,3 / 0,7 sn kareleri aynı). HZ1 ile aynı düzeltme.
- **HZ3 — SORU:** Takvim 539 KB HTML (75 KB sıkıştırılmış); yavaş 3G'de kullanılabilir 5,5 sn (ötekiler ~2,1). Öneri: ilk ekranda iki hafta / hücre
  sadeleştirme, önce/sonra ölçümüyle.
- HZ4 — bilgi: Görevler bütün açık görevleri tek seferde yüklüyor (bilinçli). Kurgusal veride 474 açık görev → 1 MB HTML; gerçek hesapta düşükse sorun yok.
- HZ5 — bilgi: sayfa başı 315–375 KB; yavaş 3G'de içerik 2–2,5 sn, tam yüklenme 7–8 sn.
- **HZ6 — SORU:** oturumsuz ziyaretçi var olmayan adrese girince 404 yerine giriş sayfası görüyor (oturum açıkken düzgün 404). Öneri: oturumsuza da
  genel 404; panel adresleri girişe yönlendirmeye devam.
- HZ7 — bilgi: model yanıt veremezse "AI cevap öner" sabit bir taslak gösteriyor ("AI emin değil" etiketiyle, otomatik gitmez).

## KURUCU TALİMATLARI — 10-29 gece (özet; aynen konuşma kaydında)
**Mesaj 1 (GD cevapları):**
- GD1 beğenilmedi: "ev sahibinize yazın" kod bazında YASAK (model yazamasın); doğru cevap TUTULMASIN, gitsin; ama diğer soru görmezden gelinmesin —
  cevaplanmamış soru varken asla "cevaplandı" yazılamaz.
- Ek / koşul eki ("-rsa") kod bazında KARAR vermesin; yalnız modele yardımcı unsur. "Milyar dolarlık AI şirketleri / açık kaynak en iyi modeller nasıl
  yapıyorsa öyle"; ajanlarla derin araştırma; sorulacakları sabah sor.
- "Anahtarı kaybettim" check-in sorusu DEĞİL → sözcük ağlarını ve kelime yakalamalarını örnekle yaz, neler eklenebileceğini uzun uzun düşün. GD4 = EVET:
  kayıp / bulamıyorum gibi şeyler ev sahibine kalsın, ÖNCELİKLİ gösterilsin. Soru: e-posta ne zaman gidiyor, panelde ne zaman gösteriliyor? İleride
  WhatsApp'tan en önemlileri bağlanacak (not alındı: `docs/claude/acik-isler.md`).
- EV SAHİBİNİZE YAZIN YASAK, her dilde, her biçimde ("Herhangi bir sorunda ev sahibinize yazın" dahil).
- Soru: model, bilerek bozuk virgül / yanlış işaret / eksik yazım / yazım hatasında anlam farkını her dilde anlıyor mu?
- GD5 önerisi geçici olarak uygulansın (yan cümle silinir, bilgi gider); kurucu sonra el atacak.
- GD7 anlaşılmadı: Haiku 5.5 ile hızlı karşılıklı düşünerek yeniden ele al, kararı tekrar taratarak; uygula; nasıl düzeltildiğini uzun yaz. Son karar Claude'da.
- Ajanlar derin araştırmaya.

**Mesaj 2 (hız raporu cevapları + 9 saat):**
- HZ1: 300 ms dayanağı var ama evrensel değil → kurulu sürümde performans kaydıyla doğrulanmalı. Hedef: tıklama anında karşılık; hızlı geçişte içerik
  hazır olur olmaz; yavaş geçişte menü + üst bölüm kullanılabilir, içerik alanı kendi iskeletini gösterir; mobil menü kapanınca gösterge sabit üst
  bölümde küçük belirsiz ilerleme olarak sürer; hata / iptal / başka sayfaya geçişte gösterge doğru biter, sonsuza dönmez, menüyü kilitlemez.
  "Gezinme başladı" ≠ "veri hazır" (`useLinkStatus` adres güncellenince kapanabilir). Bütün iskeletleri kaldırmak önceden hazırlamayı değiştirir →
  önce 1–2 sayfada karşılaştırmalı deneme. Atlassian: iskelet yerleşimi korur, çok kısa yüklemede gereksiz hareket yok, içerik hazır olunca kalkar.
- HZ2: öneri beğenildi (uygula).
- HZ3 Takvim: sunucu bekleme / aktarım / çizim / etkileşime hazır ayrı ölçülmeli; doğrudan açılış ile menüden geçiş ayrı. Aday: mobil ajanda ve masaüstü
  takvim aynı HTML'de üretilip biri CSS ile gizleniyor olabilir. Öncelik: tekrarları azalt, ilk görünümde gerekli özet, ayrıntı uygun yerde, kazancı ölç.
  Hiçbir sadeleştirme rezervasyonu, giriş/çıkış hareketini, "diğer kayıtlar" sayısını saklamamalı; yüklenmemiş tarih boş / müsait görünmemeli.
  **"TAKVİM TASARIMINA KOMPLE EL ATICAZ — 1 AYLIK KALMIYACAK, BÜTÜN DAİRELER TAM AIRBNB TAKVİM GÖRÜNÜMÜ GİBİ: DAİRELER YATAY, ÜSTTE TARİH, GİREN
  MÜŞTERİLERİN KALDIĞI GÜN ADEDİ BELLİ OLACAK."**
- 404: panelde silinmiş / erişilemeyen kayıt → yetki politikasına uygun, bilgi sızdırmayan sonuç; QR, şifre sıfırlama, doğrulama bağlantıları kendi
  güvenlik akışlarında. Yalnız "404" yazan ekran yetmez: bilinmeyen adreste HTTP durum kodu kontrol edilmeli (Next streaming yanıtta 404 ekranını 200
  ile gösterebiliyor). Özel adres listesi yalnız sol menüden çıkarılmamalı; asıl yetki kontrolü veri okunurken / işlemde.
- **9 saat (19:52 → ~04:52 UTC):** bütün istekler; süre dolmadan durmak yasak; derinlik azalmayacak; iş bölünebilir; kapılar koşarken paralel iş; CI
  kontrolleri; soru sorma (gece modu).

### HZ1 KANITI (10-29 gece, kurulu sürümde ölçüldü — `scratchpad/hz1-proof.mjs`, ham çıktı `perf-out/hz1-proof.json`)
Yöntem: sayfa yüklenmeden `setTimeout` sarmalandı; menü tıklamasından sonra kurulan her zamanlayıcının gecikmesi, kurulma ve ateşlenme anı
kaydedildi; DOM gözlemcisi iskeletin gelişini ve yeni başlığın görünmesini, kaynak zamanlaması hedef sayfanın verisi (RSC) ile sayfa kodunun
bitişini yazdı; uzun görevler (ana iş parçacığı meşgul mü) ayrıca izlendi. 6 sayfa × 3 tıklama = 18 geçiş:
- **15/18:** veri + kod 80–210 ms'de hazır; hemen ardından TEK bir zamanlayıcı kuruluyor (gecikme 167–285 ms), hedefi = iskeletin göründüğü an
  + ~300 ms (fark ±15 ms) ve içerik tam o zamanlayıcı ateşlenince ekrana geliyor. Arada uzun görev YOK (ana iş parçacığı boşta bekliyor).
  → Bekleme iş değil, React 19'un Suspense gösterim bekletmesi (`globalMostRecentFallbackTime + 300`). Kurucunun şartı karşılandı: kurulu
  sürümde, bu geçişlerde neden bu.
- **1/18 (Şablonlar):** iskelet görünmeden veri geldi → bekleme yok, içerik 89 ms. Yani kural evrensel değil: iskelet bir kez çizilmişse işler.
- **2/18 (Görevler):** veri 150–270 ms; bekleme sayfanın kendi çizimi (80 ms uzun görev) ve büyük HTML — zamanlayıcı değil.
Sonuç: hızlı sayfalarda 250–300 ms'lik bekleme gerçek ve önlenebilir; Görevler gibi ağır sayfada asıl iş çizim süresi.
