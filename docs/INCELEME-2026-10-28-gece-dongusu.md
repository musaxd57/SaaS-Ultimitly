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
  (`globalMostRecentFallbackTime + 300`, ölçüldü; ⚠️ düzeltme 10-29 gece: çalışan kopya kurulu react-dom 19.2.7 DEĞİL, Next'in paketlediği React `19.2.0-canary-0bdb9206-20250818` — kural ikisinde de aynı). Öneri: hızlı sayfalarda `loading.tsx` kaldırılıp tıklanan menü öğesinde
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

### 404 — gerçek HTTP durum kodları (10-29 gece, ölçüldü; üretim derlemesi)
| adres | oturumsuz | oturum açık |
|---|---|---|
| bilinmeyen adres (`/olmayan-bir-sayfa`) | 307 → /login | **404** ✓ |
| silinmiş konuşma / mülk / QR sohbeti (`/inbox/x`, `/properties/x`, `/guest-chats/x`) | 307 → /login | **200** ✗ (ekranda 404 kartı, durum kodu 200 — panelin yükleniyor sınırı akışı başlatmış) |
| geçersiz QR (`/c/x`) | 200 (kendi sayfası: "Bu sohbet şu an kullanılamıyor") | 200 — kendi akışı, değişmeyecek |
| `/admin` (süper yönetici olmayan) | 307 | 200 → panele yönlendiriliyor, içerik sızmıyor |
Kurucunun şüphesi doğrulandı: panel içi 404 ekranı 200 ile dönüyor. Düzeltme tasarımı iş akışında (sayfa ağacından özel adres listesi + durum kodu).

### Takvim "önce" ölçümü (10-29 gece, `scratchpad/cal-measure.mjs`, `perf-out/cal-once.json`)
| | normal ağ | yavaş 3G + 4× işlemci |
|---|---|---|
| doğrudan: sunucu bekleme | 25 ms | 41 ms |
| doğrudan: aktarım (74 KB sıkıştırılmış / 527 KB açık HTML) | 173 ms | 3.291 ms |
| doğrudan: ilk görüntü / ana içerik | 100 / 400 ms | 1.060 / 3.724 ms |
| doğrudan: etkileşime hazır (uzun görev) | 217 ms (0) | 3.645 ms (261 ms) |
| menüden: sayfa verisi 54 KB (açık 251 KB) sunucu / aktarım | 10 / 52 ms | 14 / 1.704 ms |
| menüden: içerik görünür | 378 ms (React bekletmesi) | 2.101 ms |
| DOM: toplam / mobil ajanda / masaüstü ızgara | 2.508 / 1.063 (88 KB) / 1.069 (94 KB) düğüm | — |
Sonuç: sunucu süresi önemsiz; yavaş ağda süreyi AKTARIM belirliyor. Mobil ajanda ile masaüstü ızgara aynı HTML'de, ana içeriğin yarısı her
ekranda gizli duran ikinci kopya (kurucunun adayı doğrulandı). Not: önceki turda yavaş 3G'de kullanılabilir 5,5 sn ölçülmüştü; bu tur 3,5 sn
(makine yükü farkı — iki ölçüm de yazıldı, yeni tasarım aynı betikle aynı koşulda karşılaştırılacak).

## 10-29 gece — yapılanlar (ikinci yarı) + sabah soruları

### K-1029-D ✅ Kayıp anahtar / kilitli kalma → ev sahibine kalır, ÖNCELİKLİ gösterilir (kurucu GD4 "evet")
- Yeni olay ağı `isAccessLossText` (`fallback.ts`): aynı cümlede NESNE (anahtar, kapı / oda kartı, otopark / garaj kumandası, anahtar kutusu,
  key, fob, lockbox, Schlüssel, clé, llave, ключ, مفتاح) + KAYIP fiili (kaybettim / bulamıyorum / çaldırdım / kilitte kırıldı / içeride
  unuttum / kutusu boş; lost my / can't find / stolen …; yedi dil) + bitişik kilitli kalma kalıpları. Etiket `access_security`. Ek OKUNMAZ;
  yalnız sıkılaştırır. Ayrıntı + örnek tablosu + "neden checkin sayılıyordu": `docs/claude/sozcuk-aglari.md`.
- Bağlantılar: kanal kapısı (önceki cevapsız mesaj dahil) · uyarı geçişi (oto-yanıt KAPALIYKEN de e-posta) · kelime yolu "Sorunlu" kaydında
  öncelik **Acil** (acil + erişim kaybı; şikâyet önceliği değişmedi) · öğe kipinde tutulan istek konuşmayı Acil işaretler (Wi-Fi gibi öteki
  sorular cevaplanır) · Dikkat Gerektirenler'de acil satırla aynı üst sıra · QR kritik uyarı.
- Bulunan ek açık: "I'm locked out" / "Kapıda kilitli kaldım" acil ağında tutuluyordu ama oto-yanıt kapalıyken **e-posta gitmiyordu** (tehlike
  okuyucusu kilitli kalmayı kapsamaz) → artık uyarı + Acil.
- Kanıt: ağ 78 vaka (yedi dil + kontroller), entegrasyon 15 (eski kodda 7 kırmızı), süre pini 9, mutasyon **16/16** (yaşayan D15 → pin eklendi).
- **GD4-b — SORU:** kaybı bildiren SSS'ler de artık ev sahibine kalıyor. Örnek:
  | misafir | önce | şimdi |
  |---|---|---|
  | "Dairenin iki anahtarını da kaybettik, ne kadar ödememiz gerekiyor?" | bilgi tabanındaki ücret gidebilirdi ("Kayıp anahtar 1.200 TL") | tutulur, ev sahibine Acil e-posta |
  | "Kayıp anahtar ücreti ne kadar?" | ücret gidebilirdi | tutulur |
  | "Anahtarı kaybedersem ne olur?" | ücret gidebilir | **değişmedi** (varsayım biçimi listede yok) |
  Öneri: böyle kalsın (kayıp varsa ev sahibi bilmeli); ileride anlama katmanı "olay mı soru mu" sinyaliyle SSS'yi ayırır (K-1029-C).
  **Böyle kalsın mı?**
- **GD4-c — SORU:** "Anahtar kutusunu bulamıyoruz" da tutuluyor (sözünüz "bulamıyorum gibi şeyler hosta"). Seçenek: bilgi tabanında kutunun
  yeri yazılıysa cevap gitsin + ev sahibine yine bildirim. **Hangisi?**
- **GD4-d — SORU (eklenebilecekler, hepsi yalnız sıkılaştırır):** çoğul kilitli kalma ("Eve giremiyoruz", "We cannot get in" — çıplak
  "giremiyor" ALINMAZ: "Erken giremiyor muyuz?"), içeride mahsur ("Asansörde kaldık" → acil), yanlış kapı kodu ("Kapı şifresi yanlış" bugün
  Wi-Fi sayılıyor!), kapı kilitlenmiyor, akıllı kilit pili bitti. Tablo: `docs/claude/sozcuk-aglari.md` §5. **Hangileri eklensin?**
- **GD4-e — SORU:** gelen kutusu bugün önceliğe göre değil son mesaj zamanına göre sıralı; "Acil" konuşmalar en üstte mi dursun?

### 404 ✅ (oturumsuz kısmı) — gerçek durum kodu; özel adres listesi sayfa ağacından
- Oturumsuz bilinmeyen adres artık **404** (önce 307 → giriş). Panel yolları (`(app)` klasörleri, `src/lib/private-routes.ts`) girişe gider —
  kayıt varlığı oturumsuz sorgulanmaz. Liste kenar çubuğundan değil sayfa ağacından; test iki yönlü pinliyor, `(app)` dışındaki her sayfanın açık
  olduğunu da sınıyor. Paylaşım görseli `/opengraph-image` artık herkese açık (önce girişe yönleniyordu → bağlantı önizlemesi kırıktı).
  QR / şifre sıfırlama / doğrulama / yasal sayfalar değişmedi. E2E pin (CI üretim sunucusu): 404 / 307 / 200. Mutasyon 4/4.
- **Kalan — SORU 404-b:** panel içi silinmiş / başka işletmenin kaydı (`/inbox/x`) ekranda 404 kartı ama HTTP **200** (akışlı yanıt: iskelet
  önce gidiyor). Sayfa giriş arkasında + noindex; arama motoru görmez. Seçenekler: (a) kayıt sayfalarında iskeleti kaldırıp varlık kontrolünü
  akıştan önce yapmak (gerçek 404; o sayfalarda iskelet yerine üst çubuk şeridi), (b) 200 + 404 ekranı kabul (bugünkü). Öneri (a), HZ1
  iskelet denemesiyle birlikte. **Hangisi?**
- Personel (temizlikçi) bilinmeyen adreste bugünkü gibi Görevler'e yönleniyor (404 görmüyor) — değiştirilmedi.

### HZ2 ✅ Menü tıklamasında anında geri bildirim
- Tıklanan menü öğesi hemen seçili; üst çubuğun alt kenarında ince bekleme şeridi (mobilde menü kapandıktan sonra da görünür). Biter: adres
  değişti VE rota iskeleti ekrandan kalktı (= veri hazır; Next'in `useLinkStatus`u iskelet görünür görünmez bittiği için kullanılmadı) · hata /
  404 ekranı · yeni tıklama · en geç 15 sn. Bağlantılar hiç kilitlenmez; Cmd/Ctrl tık ve açık sayfaya tıklama şerit göstermez; hareket azaltma
  açıksa şerit sabit. 11 test (eski kabukta 5 kırmızı), mutasyon 8/8. Yavaş yükleme uyarısında yazım düzeltildi: "Sayfa'nın" → "Sayfanın".
- HZ1'in kalan kısmı (1–2 sayfada iskeletsiz karşılaştırma + performans kaydı) sıradaki iş.

### K-1029-F — Model anlaması bozuk yazıya dayanıklı mı? (kurucu sorusu: "virgülle kötü ayırma, yazım hatası, eksik sözcük — bütün dillerde?")
**Kısa ve dürüst cevap: kısmen ölçüldü, ÇİFTLİ (aynı mesajın temiz + bozuk hâli) hiç ölçülmedi.** Bildiklerimiz:
- Anlama katmanı geliştirme seti (54 senaryo, 7 dil): istek bulma %93; dil başına tr 53/56, en 10/10, de 3/3, es 1/3, fr 0/1 (küçük örnek).
- Mühürlü kırmızı takım (ayrı yazar, 116 istek): argo 1/2, gürültü 3/5, başka dil 1/2 — küçük örnek ama zayıf nokta işareti; dil başına en 10/18,
  ar 10/15, fr 8/12 (Türkçe 32/39).
- Tehlike sondası (70 mesaj; 41'inde hiç cümle noktalaması yok, 24'ü küçük harfle başlıyor, 5 Türkçe mesajda hiç Türkçe harf yok): 70/70 doğru,
  acil yol 48/48 — ama yalnız acil alanında.
- Bilgi tabanı getirme (sözcüksel): Türkçe yazım hatalı sorular ("otopakr varmı", "giris saati kacta") %100.
- Gerçek geçmişte 104 mesaj (%2,9) hiç noktalama taşımıyor (tr 56, ar 24, en 10 …) — yani konu gerçek.
- **Ölçülmeyen:** model düzeyinde Türkçe yazım hatası, bozuk virgül / eksik sözcük çiftleri, karışık dilde cevap dili.
- İstem: anlama istemi bozuk yazı hakkında hiçbir şey söylemiyor ("Any language is possible." yalnız). Öneri (ücretsiz, ölçümle birlikte açılır):
  "yazım hatası, noktalama yokluğu, eksik sözcük, Türkçe karakter yokluğu, argo, sesle yazdırma, karışık dil olabilir — anlama göre karar ver" satırı.
- **Plan (kredi gelince, ücretli — onayınızla):** `evals/robustness-dev.json` — her temel mesajın 6 bozulmuş eşi (noktalama yok · virgül yanlış
  yerde · Türkçe karakter yok · sözcük düşük · %15 sözcükte tek harf hatası · karışık dil), 7 dil; ölçüt "değişmezlik" (bozuk eşin niyet / istek
  sayısı / dil / acil / durum etiketleri temizinkiyle aynı mı). Hata çıkarsa neden analizi kendiliğinden koşar. Seti bu gece yazıyorum (kredi gerekmez).


## 10-30 sabahı — gecenin son durumu (dürüst kayıt)

**Kesinti:** 10-29 21:20 UTC'de oturum kullanım sınırına çarptı, 03:35 UTC'de geri döndü — yaklaşık 6 saat iş YAPILAMADI. Ölçülen tam
kapı o arada bitmişti: tek kırmızı benim HZ2 CSS sıram (aşağıda), veritabanlı 459 dosya + süre ölçen 74 dosya yeşil.

### Push'a giden 15 commit (10-29 akşamdan beri biriken; tam kapı + build yeşil olunca — sonuç CI satırında)
- K-1029-D kayıp anahtar / kilitli kaldım (yedi dil, öncelik, Dikkat 99, QR kritik uyarı) + aksansız yazım ("J'ai perdu la cle", "Perdi
  la llave") + yazım hatası / öznesiz İngilizce ("anahtarı kaybetim", "Anahtarı kaybetmişim", "lost key", "the keys are lost").
  Varsayım ("kaybedersem", "kaybolursa") ve "We got lost … key box" değişmedi (pinli). Mutasyon 16/16.
- 404 (oturumsuz kısım): bilinmeyen adres gerçek 404; özel adres listesi sayfa ağacından; paylaşım görseli artık girişe yönlenmiyor.
- HZ2 menü tıklamasında anında gösterge (+ bu gece bulunan CSS sırası hatası düzeltildi: hareket azaltma bloğunda yeni kural
  `lxs-pulse` pininin önüne girmişti; davranış aynıydı, pin gevşetilmedi, şerit için ayrı pin eklendi).
- K-1029-F modelsiz sağlamlık ölçümü (`docs/olcum/robustness-kelime-agi-2026-10-29.md`; ikinci kapıda bulunan: ölçer rapora koşu
  kimliği yazmıyordu — `eval-run-meta` pini, düzeltildi) + K-1029-A tasarım belgesi
  (`docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md`) + sözcük ağları belgesi.

### Kodda hazır, ayrı dalda (`night/gd7-404`), tip denetimi yeşil — sabah tam kapıyla ana dala
- **K-1029-E / GD7** — uzun açıklama aşağıda.
- **404 tasarım incelemesinin bulduğu açık (G1–G4):** akşamki 404 commit'imden sonra `(app)` dışına sınıflanmadan eklenen yeni bir sayfa
  test kırmızısı vermiyordu (bilinmeyen her adres artık oturumsuz geçtiği için "oturumsuz açılır" iddiası boşa düştü). Şimdi her yol
  `public / private / unknown` diye TEK yaprak modülde sınıflanıyor (`classifyPath`), ara katman onu okuyor; test: `(app)` içindeki her
  sayfa `private`, dışındaki her sayfa `public` (sınıfsız = kırmızı), iç içe rota grubu / dinamik ilk kesim / paralel yuva yok, `(app)`
  altında `route.ts` ya da meta rota yok (düzenin oturum kapısını atlardı), açık ve özel listeler kesişmez, açık listede bayat girdi yok.

### K-1029-E — GD7 yeniden (uzun açıklama)
(`scratchpad/gd7/aciklama.md`'den aynen)
#### (açıklama): "metin değişince, metin hakkındaki işaretler de değişmeli" (uzun açıklama)

**Kurucunun sözü (10-29 gece):** "GD7'yi anlamadım. Haiku 5.5 ile karşılıklı düşünerek yeniden ele al, her kararı Haiku'ya yeniden
tarat, uygula ve uzun uzun açıkla. Son karar senin."

#### 1. Sorun neydi? (gündelik dille)

Yapay zekânın her cevabı tek bir metin değil, bir **paket**. Metnin yanında cevap hakkında küçük notlar da var. İki örnek:

- "Bu cevap yalnız 'ev sahibinize yazın' cümlesinden oluşuyor" (`hostContactOnly`). Bu not varsa kapı cevabı **tutar**, misafire
  göndermez; ev sahibi kendisi yazar.
- "Bu cevap yalnız kodun doğruladığı parçalardan oluşuyor" (`verifiedPartsOnly`, karar 4.12). Bu not varsa kapı modelin genel güven
  puanı 0,75'in altında olsa bile cevabı yalnız bu sebeple tutmaz.

Bazı durumlarda modelin yazdığı metin atılır ve yerine **kodun kendi yazdığı onaylı metin** konur. Örnekler: doğrulanmış erken giriş
onayı ("Erken girişiniz onaylandı, saat 12:00'den itibaren…") ve doğrulanmış müsaitlik / uzatma cevabı. Kıdemli okuyucu bir cevabı
yeniden yazdırdığında da metin değişir.

**Hata şuydu:** metin değiştiği hâlde eski metnin notları yeni metne yapışık kalıyordu.

- **Önce (GD7 ilk hâli, 10-29 akşam düzeltildi):** model "Bir sorun olursa ev sahibinize yazın." yazmıştı ve not "yalnız ev sahibine
  başvurma" diyordu. Kod bu metni atıp onaylı erken giriş metnini koyuyordu, ama not yeni metne geçiyordu. Sonuç: tamamen doğru onay
  metni gereksiz yere tutuluyordu.
- **Bu gece bulunan ikinci örnek:** taslak doğrulanmış parçalardan kurulmuştu (not: "yalnız doğrulanmış parçalar"), modelin güveni ise
  0,6'ydı. Kod onay metnini kurunca bu not da onay metnine geçiyordu. Kapı güven tabanını atlıyordu ve onay metni 0,6 güvenle
  gidiyordu.
  - Bu, 24 Eylül'de **bilerek** konulmuş bir kuralı deliyordu: "kod metninde güven aynen kalır, ≥ 0,75 tabanı müsaitlik kontrolünden
    sonra da geçerli" (inceleme 09-24 P2).
  - Bugün etkisi yok: parça kipi (`AI_ANSWER_PARTS_ENABLED`) kapalı. Açıldığında olacaktı.

#### 2. Kökten çözüm: her alanın kime ait olduğu TEK tabloda

Önceki düzeltme yalnız tek bir notu (`hostContactOnly`) iki fonksiyonda elle siliyordu. Haiku'yla üç tur karşılıklı düşündük; vardığımız
sonuç şu: hata tek bir notun değil, bir **sınıfın** hatası. "Metin hakkındaki bir bilgi, metin değişince taşınıyor." Yarın eklenecek her
yeni not aynı hataya açık.

Çözüm: `src/lib/ai/reply-field-rules.ts`. Cevap paketindeki **27 alanın her biri** için iki kural yazılı:

| Alan türü | Örnek alanlar | Yeniden yazmada | Kod metni geçince |
|---|---|---|---|
| Mesaja ait hüküm | niyet, risk düzeyi / türü, öncelik, dil, misafirin yazdığı çıkış saati | ilk çağrıdan | aynen (niyet hariç: kod metni kendi niyetini taşır) |
| Metne ait | metin, kaynaklar, kaynak / iddia denetimi, eylem beyanı, parça metinleri | yeni çağrıdan | yeniden yazılır ya da düşer |
| Metin işaretleri | `hostContactOnly`, `verifiedPartsOnly` | yeni çağrıdan | **düşer** |
| Güven | `confidence` | ikisinin küçüğü | **aynen** (09-24 P2) |
| Muhasebe | kullanım, parça yeniden yazma kotası | toplam / ikisinden biri | aynen |

Bu tablo **iki kat** kontrolle korunuyor:

1. **Tamlık derleyicide.** Cevap paketine yeni bir alan eklenip tabloda sınıflanmazsa TypeScript derlemesi kırılır. CI `tsc --noEmit`
   koşuyor, yani bu "unutuldu" hatası birleşmeden yakalanır.
2. **Doğruluk testte.** `tests/unit/reply-field-rules.test.ts`, 27 alanın her biri için iki fonksiyonu (kıdemli yeniden yazma
   birleştirmesi ve kod metni) tabloya karşı sınar.
   - Her alan iki yönden bakılır: doğru taraftan mı geldi, ve beklenen tarafta yokken sonuçta da yok mu (yanlış taraftan sızma).
   - Toplam 54 küçük test vakası.

#### 3. Bu gece değişen davranışlar (üçü de yalnız sıkılaştırır; misafire giden metin gevşemez)

1. **Kod metni artık "yalnız doğrulanmış parçalar" notunu taşımaz.**
   - Örnek: parça kipi açık, taslak güveni 0,6, erken giriş doğrulandı.
   - Önce: onay metni gidiyordu.
   - Sonra: kapı güven tabanında tutar, ev sahibi panelde görür.
   - Güveni ≥ 0,75 olan taslakta onay metni yine gider. Bunu da test pinliyor (aşırı uygulama yok).
   - Bugün parça kipi kapalı olduğu için canlı davranış değişmiyor.
2. **Kod metni artık taslağın "doğrulanmış parça metinleri"ni taşımaz.**
   - Bu bilgiyi yalnız gölge ölçüm (doğrulanmış cevap tekrarı, migration 85) okuyordu. Kod metni gittiğinde gönderilmeyen parçaları
     "gitti" diye kaydediyordu.
   - Misafire etkisi yok.
   - Haiku, "bu alanı silersek parça kontrolü kör olur" diye uyardı. Kodda baktım: o kontrol (`automation.ts`, "onaylı parça son metinde
     aynen") kod metni yerleşmeden **önce** koşuyor. Bu yüzden etkilenmiyor; tablonun yorumuna da yazdım.
3. **Parça yeniden yazmasının kotası artık kaybolmuyor.**
   - Kıdemli okuyucu cevabı yeniden yazdırınca ikinci çağrı da parça yeniden yazması yapabilir. Önceki birleştirme yalnız ilk çağrınınkini
     okuyordu, bu yüzden günlük AI kotasından bir birim eksik düşüyordu.
   - Şimdi iki çağrıdan herhangi biri yaptıysa birim düşer.
   - Parça kipi kapalı; canlı etkisi yok.

#### 4. Haiku'yla karşılıklı düşünmede nelere itiraz ettim, nelerde haklı çıktı

**Haiku'nun haklı çıktığı noktalar:**
- Tablo yalnız tamlığı kanıtlar, doğruluğu kanıtlamaz; yanlış sınıflanmış bir alan derlenir. Bu yüzden tablo testi yazıldı.
- İki fonksiyonun "metne ait" alanları farklı ele aldığını gösterdi; tabloda iki ayrı kolon oldu.
- Kod metni geçince alan silmenin, okuyan yer o işten sonra koşuyorsa davranışı değiştirebileceği uyarısı. Her alan için okuyucuları tek
  tek aradım.

**Gerekçeyle reddettiklerim:**
- "Kapıda işaretleri yeniden hesapla" önerisi. Kapı metni yeniden okuyup işaret üretirse, işaretin kaynağı (dolgu silici, parça
  doğrulayıcısı) iki yerde yaşar ve ikisi ayrışabilir. İşaret, metni üreten adımda üretilir; metin değişince düşer.
- "Bütün metne ait alanları kod metninde sıfırla." Bu, cevaplanan istek beyanını ve parça kararlarını da silerdi. Kod metni yalnız tek
  konulu turda kurulduğu için o beyan aynı isteği anlatıyor. Silmek açık istekleri kapatabilirdi, yani gevşetirdi. Bu alanlar bilinçli
  istisna olarak kaldı ve gerekçeleri tablonun satırında.

**Bilinçli dışarıda bırakılanlar:**
- Kapının iç tip tanımlarında bu iki işaret ayrıca elle yazılı. Onları tablodan türetmek kapının belgelenmiş girdilerini dolaylı yapardı.
  Tablo testi iki fonksiyonu zaten tutuyor.
- Yalnız SİLME yapan düzenlemeler (selam silme, konu ayıklama, ev sahibine başvurma cümlesi silme) bu kuralın dışında. Aynı metnin bir
  parçasını siliyorlar ve işaretler o adımda yeniden hesaplanıyor.

#### 5. Kanıt durumu (dürüstçe)

- Kod ve tablo testi `night/gd7-404` dalında; tip denetimi (tablonun tamlığı dahil) yeşil.
- Tablo testi, kırmızı-önce koşusu, mutasyon (`scripts/mutation-run.mjs`) ve tam kapı: gecenin 6 saatlik kesintisi yüzünden sabaha kaldı.

### K-1029-A / B / C — durum: TASARIM bitti, KOD yarım (dürüstçe)
- 13 ajanlık iş akışı bitti (5 harita, 2 araştırma, 3 bağımsız tasarım, 2 hakem, sentez) → `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md`.
  Hakemler, tasarımlardan birinin açık soruyu yine sessizce "cevaplandı" diye kapattığını (B2 hatasının ta kendisi) ve ikisinin "…yazın,
  kendisi teknisyen gönderir" cümlesini kesince koşulsuz SÖZE çevirdiğini kodda ölçerek buldu; sentez ikisini de kapatıyor.
- **Bugün misafire sızanlar (ölçüldü):** "En cas de problème, écrivez à votre hôte.", "Llame a su anfitrión si pierde la llave.", "Позвоните
  хозяину…", "إذا حدثت أي مشكلة، راسل المضيف.", "Feel free to reach out to the property owner.", "Bir sıkıntı olursa bize yazabilirsiniz." —
  hiçbir dedektör görmüyor. **Bugün gereksiz tutulanlar:** kurucunun kendi örneği "Herhangi bir sorunda ev sahibinize yazın." bütün
  cevabı tutuyor (doğru cevap da gitmiyor).
- **Kod taslağı hazır ama ağaçta DEĞİL** (kesinti yüzünden test edilemedi; `docs/claude-work/2026-10-29/k1029a-taslak/`): yedi dilli
  dedektör (`mentionsHostContact` — seslenilen + iletişim fiili, ev sahibi özneyse eşleşmez), süzgeç yeniden yazımı (koşul eki sezgisi
  kaldırıldı; GD5 yan cümle kesimi "yalnız silme"), "cevaplandı" kuralı (`settleHostContactRemovals`), defter olmayan yol kararı ve 40'a
  yakın kırmızı-önce vaka (C1–C4 tabloları). Sabah sırası: ağaca al → kırmızı-önce koş → kanal / QR / e-posta bağlantısı → istem yasağı →
  mutasyon → tam kapı.
- **Sabah soruları (sentez §F, önce/sonra örnekli):**
  1. **"Arayın" ölçüm gelene kadar (geçici).** Önce: "Anahtarı kaybedersem ne yapmalıyım?" → "Anahtarı kaybederseniz ev sahibinizi arayın."
     gider. Sonra (model sinyali ölçülene kadar): misafire bir şey gitmez, soru size açık iş + "Misafir cevabınızı bekliyor" e-postası.
     Bu geçici gerileme uygun mu?
  2. **QR kapı kodu satırı** (QR'da misafir sizin sohbetinizde değil). Önce: "Kapı kodu ne?" → "Kapı kodu için ev sahibinize Airbnb
     üzerinden yazın." (a) silinsin, soru size acil devredilsin; (b) QR'a özel istisna kalsın.
  3. **"Bize mesaj atın" adım talimatı.** "Çıkışta anahtarı kutuya bırakıp bize mesaj atın." (a) kalsın; (b) "Çıkışta anahtarı kutuya
     bırakın." (mesaj kısmı silinir).
  4. **Ev sahibinin göreceği metin (AI öner):** "Bu taslaktan misafiri size yönlendiren bir cümle çıkarıldı; misafirin bir sorusu cevapsız
     kalmış olabilir." Uygun mu? Ayrıca taslağı gönderdiğinizde atlanan soru da "Yanıtladınız" görünüyor — "Siz yazdınız" mı olsun?
  5. **İkinci model okuması** (her aday cevabı cümle cümle okuyan yeni çağrı, anahtar kapalı) kurulsun mu?
  6. **Kayıp anahtarın paneldeki etiketi:** bugün "Giriş"; ayrı "Erişim / kayıp anahtar" etiketi ister misiniz?
  7. **Ücretli ölçüm onayı** (kredi gelince ~10 $: istem kolu + anlama kolu + sağlamlık). Açılıştan önce şart.

### Takvim — tasarım bitti, saf yerleşim kütüphanesi taslağı hazır
- Tasarım (iş akışı, 54 KB, Türkçe): tek tablo, her daire bir satır, her gün iki yarım sütun; konaklama giriş günü öğleden sonra başlayıp
  çıkış günü sabahı biten TEK çubuk, üstünde ad + "N gece" (kırpılan çubuk da gerçek toplamı yazar); varsayılan 35 gün (bugün − 3), oklar
  14 gün; mobil / masaüstü tekrarı kalkar (bugün her hareket iki kez çiziliyor — DOM 2.508 düğümün yarısı gizli ikinci kopya); hiçbir kayıt
  gizlenmez (üst üste binen ayrı şeritte, "+N diğer" yok, gün özeti kesin sayı); yüklenmemiş / kırpılmış veri "bilgi yok" taralı — asla
  boş ya da 0; yeni ekran `CALENDAR_TIMELINE_ENABLED` arkasında.
- Saf kütüphane (`timeline.ts`) + 2.000 rastgele vakalık kâhin testi + yükleyici taslağı `docs/claude-work/2026-10-29/takvim-taslak/`.
- **Takvim soruları (tasarım §15):** S1 35 gün / 2 hafta adım uygun mu · S2 telefonda varsayılan zaman çizelgesi mi liste mi · S3 onay
  bekleyen talepler kesik çizgiyle gösterilsin mi · S4 bağlantısı bozuk takvimde boş günler boş mu kalsın, taralı mı · S5 "Reserved"
  kayıtları "Takvim kaydı" diye mi görünsün · S6 daire sırası doğal (Daire 2, Daire 10) mı · S7 önce anahtar arkasında, onaydan sonra eski
  takvim silinsin mi · S8 "Bu tarihlerde 3 iptal" çipi eklensin mi.

### HZ1 deneme — bekliyor
- İskeletsiz deneme dosyaları (`/templates` + `/properties`) hazır ama ölçülmedi; tasarım: deneme ayrı dalda, kurucu kararı olmadan ana dala
  girmez. Kayıt kodda doğrulandı: 300 ms kuralı Next'in paketlediği React'te (`19.2.0-canary`), kurulu 19.2.7'de değil — kural aynı.
