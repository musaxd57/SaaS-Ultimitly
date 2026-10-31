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

## 10-30 sabahı (devam) — K-1029-A artık KODDA (taslak değil)

Yukarıdaki "KOD yarım" kaydından sonra: taslak ağaca alındı, kırmızı-önce koşuldu, kanal / QR / e-posta bağlantısı ve istem yasağı yazıldı.
Davranış (sorular F1–F7 cevaplanana kadar tasarımın güvenli yönü):
- **Silinir:** misafiri ev sahibine yazmaya / ulaşmaya yönlendiren cümle, yedi dilde, koşullu ya da koşulsuz ("Herhangi bir sorunda ev
  sahibinize yazın", "Feel free to message your host", "En cas de problème, écrivez à votre hôte", "Bir sıkıntı olursa bize yazabilirsiniz").
  Yan cümle ise yalnız o kısım ("Havlular dolapta, sorun olursa ev sahibinize yazın" → "Havlular dolapta."). Gaz / yangın / duman / acil
  numara uyarısı silinmez (ama "Gaz kokusu alırsanız ev sahibinize yazın" yazma yönlendirmesidir → silinir).
- **Doğru cevap yine gider; cevapsız soru AÇIK kalır, asla "cevaplandı" olmaz:** silinen cümle bir soruyu cevaplıyorduysa (konu /
  sözcük örtüşmesi) o soru açık kalır; sahipsiz ve genel olmayan silmede hepsi açılır; olasılık sorusu ("Wi-Fi giderse?") hep açık.
  Öğe kipinde: güvenli istek cevaplanır, açık kalan size; öğe kipi kapalıyken: tur tutulur + tek "Misafir cevabınızı bekliyor" e-postası;
  QR'da: kalan doğru cevap gider + size devir.
- **İstem katmanı VARSAYILAN AÇIK** (kurucu "istem + kod"): modele "ev sahibine yönlendirme cümlesi yazma" kuralı; acil kapatma
  `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=1` (istem tabana döner; kod süzgeci yine koşar). Açılış belgesinde yazılı.
- **"Arayın" (F1 sorusu):** cevap gelene kadar güvenli yön — "Anahtarı kaybedersem ne yapmalıyım?" → "…ev sahibinizi arayın." tek başına
  gitmez, soru size açık iş. Sizin cevabınızla değişir.
- Testler: 40+ kırmızı-önce vaka (yedi dil, GD5 yan cümle, güvenlik uyarısı, "cevaplandı" kuralı), kanal entegrasyonu (öğe kipi açık /
  kapalı), istem pini (varsayılan açık, yalnız "1" kapatır, fark yalnız üç çapada), süre pini (144 bin karaktere kadar doğrusal).

## 10-30 sabahı (devam) — gecenin kodunun sert incelemesi (Ultracode iş akışı + çekişmeli doğrulama)

18 bulgu doğrulandı (biri reddedildi: edilgen varsayım). Kayıp anahtar ağı, uyarı önceliği, menü geçiş göstergesi ve 404 sınıflandırması —
hepsi BU GECE yazdığım kod. Ayrım kuralı: başka sözcüğün İÇİNDE eşleşme (hata) ve kaçırılan kayıp cümlesi (yalnız sıkılaştırır) düzeltildi;
anlam belirsizliğinden doğan fazla tutuşu azaltmak misafire giden cevabı GEVŞETİR → aşağıda soru.

### Düzeltilenler (kırmızı-önce testli, `night/review-fixes`)
- **C1 — kalıp başka sözcüğün içinde:** "I just clocked out from work … wifi password?" ve "blackout curtains blocked out the light" kilitli
  kalma ("locked out") sayılıyor, "I forgot my keyboard" anahtar unutma sayılıyordu; çıkış notu "…and locked the key box." da. Kalıplar artık
  sözcük başında; "key" sözcük olarak; "locked the key" yalnız "in / inside" ile. "I forgot my keys", "I locked the keys in the apartment",
  "LOCKED OUT" yine tutuluyor.
- **C6 — Almanca:** "finde … nicht" alt dizesi "Findet die Schlüsselübergabe nicht persönlich statt?" ve "befindet" içinde eşleşiyordu → tam sözcük.
- **C7 — kaçan kapı önü bildirimi (yedi dilde):** "There's no key in the lockbox", "We opened the lockbox but it was empty", "Kodu girdim,
  kutu açıldı ama anahtar yok", "Anahtar kutusunu açtık ama boş", "Kein Schlüssel im Schlüsselkasten", "Il n'y a pas de clé dans la boîte",
  "No hay llave en la caja", "В ключнице нет ключа", "لا يوجد مفتاح في الصندوق" → artık ev sahibine + Acil. Kutu ile "boş" arasında en çok üç
  sözcük, araya virgül girmez ("…keys in the lockbox, the fridge is empty" kutu değil).
- **C8 — kaçan kayıp:** "The keys are gone", "Der Schlüssel ist weg / verschwunden", "Les clés ont disparu", "Je n'arrive pas à trouver les
  clés", "Ключи пропали", "Дверь захлопнулась, ключи внутри", "I left my keys inside and the door closed", "Las llaves se quedaron dentro",
  klavyesiz Almanca "Schluessel", "المفتاح ضائع".
- **C9:** "We lost the key and we are not leaving at 11" — reddedilen çıkış saati rezervasyona yazılıyordu (kontrol yalnız ilk etikete
  bakıyordu; kayıp anahtar etiketi öne geçince "çıkmıyoruz" etiketi görünmüyordu). Artık bütün etiketler okunur.
- **C10/C11:** öğe kipi kapalıyken "Anahtarımı kaybettim, kapıdayız" + ardından "Ayrıca daire çok kirli" → e-posta yalnız kirli satırı
  alıntılıyor, konuşma Acil olmuyordu. Artık sıra: acil → kayıp anahtar → diğer.
- **C13:** ev sahibi kayıp anahtarı telefonda çözüp önceliği düşürdükten sonra misafir "Wi-Fi şifresi?" yazınca öncelik yeniden Acil
  oluyordu. Artık yalnız isteğin İLK bildiriminde yükseltir.
- **C14–C16 (menü geçişi):** geri tuşuyla başlangıç sayfasına dönünce şerit 15 sn dönüyor ve yanlış menü seçili kalıyordu; açık sayfanın
  bağlantısına / logoya tık beklemeyi iptal etmiyordu; 15 sn güvenlik süresi her adres değişiminde baştan başlıyordu; ekran okuyucu "Sayfa
  yükleniyor"u iki kez okuyordu. Dördü de düzeldi.
- **C17 (güvenlik, veri sızıntısı yoktu):** `/%69nbox` gibi yüzde kodlu özel adres ara katmanın giriş yönlendirmesini atlıyor, yalnız sayfa
  kapısı durduruyordu. Yol artık çözülerek sınıflanıyor; bozuk kodlama ya da çözümde `..` → girişe.

### Soru (gevşetme yönü — önce/sonra) — Kayıp anahtar ağının anlam belirsizliği fazla tutuşları
Ağ yalnız SIKILAŞTIRIR; fazla tutuş = misafire cevap gitmez + size "Acil" e-posta. İnceleme şunları buldu (hepsi bu gece başladı):

| Misafir mesajı | Bugün (dün geceden beri) | Önerim |
|---|---|---|
| "Bisikletleri dışarıda kilitli bırakabilir miyiz?" | tutulur + Acil e-posta | cevap gider ("dışarıda kilitli" kalıbı → "dışarıda kilitli kaldık / kilitliyiz") |
| "Ayer nos quedamos fuera hasta tarde, ¿a qué hora cierra la piscina?" | tutulur + Acil | cevap gider ("nos quedamos fuera" → yalnız "fuera del / de la …" ile) |
| "On s'est perdu, où est la boîte à clés ?" / "Мы потерялись, где ключи?" | tutulur + Acil | cevap gider (İngilizce eşi "We got lost, where is the key box?" zaten gidiyor — pinli) |
| "We can't find parking, where is the key box?" / "Park yeri bulamadık, anahtarı nereden alıyoruz?" | tutulur + Acil | cevap gider (fiil başka nesneye bağlı; virgülden sonra soru) |
| "Anahtarları masaya bıraktık, bir bardak kırıldı kusura bakmayın" / "Keys are on the table, nothing is missing" | tutulur + Acil | **tutulur ama Acil DEĞİL** (kırılma bildirimi size zaten gider; anahtar kaybı değil) |
| "Wir haben unsere Anreise auf Freitag verlegt, wo bekommen wir den Schlüssel?" | tutulur + Acil | cevap gider ("verlegt" burada "ertelendi") |

Önerilen yöntem: genel durum sözcükleri ("kırıldı", "missing", "is empty", "kayıp") anahtar sözcüğüne BİTİŞİK olmalı (en çok iki sözcük
arayla); "bulamadık / can't find / lost our" virgülle ayrılmış ve ardından soru gelen yan cümlede başka nesneye bağlıysa anahtarla
eşleşmez. Kaybetme fiili + anahtar aynı yan cümlede olduğu sürece ("Anahtarı, sanırım restoranda, kaybettim" dahil) tutuş aynen kalır.
**Böyle yapalım mı, yoksa "anahtar + kayıp sözcüğü aynı cümlede → hep size" mi kalsın?** (Bilinerek tutulan: "Kayıp anahtar ücreti ne?"
ve "anahtarı unuttuğumuzda ne yapmalıyız?" — ek okunmaz, K-1029-C.)

### K-1029-A ücretsiz tekrar oynatma (tasarım S13) — ölçüldü, iki kaçak kapatıldı
`tests/eval/host-contact-replay.ts` → `docs/olcum/host-contact-replay-2026-10-30.md`. Geçmiş ölçümlerin 3.274 model cevabı (kurgusal fikstür,
model çağrısı yok) eski (0e0e1a1e) ve yeni süzgeçten + kapının metne bakan iki kuralından ("bilgim yok" itirafı, çıktı vetosu) geçirildi.
- **İlk koşu bir sorun buldu (düzeltildi):** silme, eskiden TAMAMI tutulan 74 cevabı kapıdan geçiriyordu. En kötüleri: K10 devir bildirimi
  ("ваше сообщение сохранено, хозяин может его увидеть") silinince yanındaki "это решение хозяина" (ev sahibinin kararı) cümlesi misafire
  gidiyordu; geriye yalnız "Здравствуйте, Alex!" selamı kalıp o gidiyordu. Düzeltme: devir / kayıt / görünürlük bildirimi SİLİNMEZ (K10
  "hiçbir şey gitmesin" — veto ve "bilgim yok" kuralı cevabı eskisi gibi tutar), kalan metin kararı ev sahibine bırakıyorsa ya da yalnız
  selam kaldıysa cevabın tamamı tutulur. Kırmızı-önce: 5 test eski süzgeçte kırmızı.
- **Son durum:** sistem düzeyinde YENİ tutuş 0; eskiden tutulup şimdi giden 15 cevap — hepsi "gerçek bilgi + yönlendirme" ("Size ayrılan
  otopark yeri P2." + "kuaför için ev sahibiniz bilgi verebilir" → yalnız ilk cümle gider, kuaför sorusu size açık kalır). Bu K-1029-A'nın
  istediği davranış; 15 örneğin tamamı raporda önce/sonra yazılı.
- **Açık bulgu (soru, kodlanmadı):** bu 15'ten biri "Telefon numarası paylaşılmamış." — bir "bilgim yok" cümlesi, ama "bilgim yok"
  dedektörü "paylaşılmamış"ı tanımıyor (eskiden yanındaki yönlendirme yüzünden tutuluyordu). Önerim: dedektöre "<bilgi adı> paylaşılmamış /
  paylaşılmadı / hasn't been shared" eklemek (yalnız tutar; "Wi-Fi şifresi henüz paylaşılmamış" da size kalır). Ekleyeyim mi?
- **A13 (kapı yedeği) bilerek YAPILMADI:** bugün süzgeçten SONRA metni değiştiren yollar yalnız silen konu süzgeci ve kurucunun onayladığı
  sabit kod metinleri (erken giriş, müsaitlik); yedek bu kod metinlerini tutabilirdi. Yeni bir "metni değiştiren" yol eklenirse yeniden ele alınır.
- **A12 (kısmi gönderim acil durdurma) eklendi:** `AI_HOST_CONTACT_PARTIAL_DISABLED=1` → konulu silmede cevabın tamamı tutulur (varsayılan
  kapalı; açılış belgesinde).

### Haiku 5.5 inceleme döngüsü (inceleme düzeltmeleri üstüne) — 7 bulgu, hepsi düzeltildi + testli
Almanca bileşik sözcük ("Hausschlüssel vergessen") sözcük başı sınırıyla kaçıyordu · "I locked my keys" (iyelikli, "inside"sız) düşmüştü ·
"There is no key deposit, right?", "Нет ключа от Wi-Fi" (Wi-Fi şifresi) ve "The lockbox is not empty" yanlışlıkla Acil oluyordu · aynı
kayıp anahtar sorununu yineleyen YENİ mesaj ("Hâlâ anahtar yok, kapıdayız") önceliği yükseltmiyordu (artık: ilk bildirim ya da turun en
yeni mesajı acil isteği taşıyorsa) · "#icerik" atlama bağlantısı ve aynı menüye ikinci tık gezinme göstergesini bozuyordu.


### Mutasyon (10-30, `scripts/mutation-run.mjs`, ayrık worktree, M0 yeşil) — 35/35
K-1029-A 13 mutant (dedektör birleşimi, sahipsiz silme, olasılık sorusu, defter yok kararı, kapı dalı, K10 / görünürlük bildirimi koruması,
karar kalıntısı, yalnız selam, güvenlik uyarısının yazma istisnası, istem anahtarı "true" yazımı, kısmi gönderim durdurma), GD7 3, yüzde
kodlu yol 2, inceleme düzeltmeleri 17 (sözcük sınırları, kutu–boş olumsuzluğu, Almanca bileşik, çıkış saati etiketleri, uyarı sırası, öncelik
ölçütü, gezinme göstergesinin dört düzeltmesi, Rusça çıplak "нет ключа"). İlk koşuda 2 yaşayan (KA3 olasılık sorusu, KA6 veto kalıbındaki
bildirim) → iki pin eklendi, yeniden koşu 2/2.

## 10-30 öğle — K-1029-A v2 + v3: iki sert inceleme turu (dün geceki kod push EDİLMEDİ, önce düzeltildi)

### v2 — Opus 5.5 derin incelemesinin P1'leri
Opus incelemesi (`scratchpad/opus-k1029a-review.md`, 12 bulgu + P3'ler) dün geceki K-1029-A kodunun **eski kurala göre gerilediği** yerleri
buldu. Kök neden: eskiden "ev sahibine yönlendirme" cümlesi `bilgim yok` kuralıyla cevabın TAMAMINI tutuyordu ve bu, yanındaki zayıf
cümleleri de örtüyordu. Silme bu ağı kaldırınca bazı şeyler misafire gitmeye, bazı sorular sessizce "cevaplandı" kapanmaya başladı.
Opus'un somut örneklerinden 58 vakalık bir tablo kuruldu: **v1 7/58 → v2 58/58**.

| # | v1'de misafire giden / olan | v2 |
|---|---|---|
| F5 | "I'm not sure about the sauna hours; please message your host." → "I'm not sure about the sauna hours." gider, sauna sorusu "cevaplandı" | Silmeden sonra kalan metin şunlardan birini söylüyorsa cevabın TAMAMI tutulur (eski davranış): belirsizlik, yetersizlik, paylaşılmamış bilgi, müsaitliğe bağlılık, özür, ret. |
| F1 | "Otopark: ev sahibinize sorabilirsiniz." → "Otopark." gider | Baş kısım yalnız konu etiketi ya da nezaketse bütün cümle çıkar, o konu açık kalır. |
| F6 / F11 | "Binada sauna var. Detaylar için ev sahibinize yazabilirsiniz." → sauna "cevaplandı" | Konusuz yönlendirme önceki cümlenin konusunu taşır. |
| F7 | "…message your host; your host can also see it." AYNEN gidiyordu | Bildirim taşıyan başvurma cümlesi cevabın tamamını tutar. |
| F9 | Gaz talimatlı cümle bütün olarak silinip ocak cevabı talimatsız gidiyordu | Yalnız "and message your host" kuyruğu çıkar; temiz ayrılamıyorsa cevabın tamamı tutulur. |
| F3 / F4 / F8 / F10 / F12 / F2 | Bunlar gidiyordu: "110" numarası güvenlik uyarısı sanılıyordu; satır sonuyla bölünmüş cümle; yalnız teşekkür; taslakta yasaklı cümle; DE / FR / ES / RU kapanış; yedi dilde 52 kalıp | Hepsi düzeltildi. |

### v3 — dört mercekli çekişmeli inceleme (Ultracode iş akışı; 4 bulucu + 4 doğrulayıcı ajan, her bulgu ayrıca problandı)
Dört mercek: aklama (yasaklı cümle silinince geriye kalanın misafire yanlış gitmesi), aşırı uygulama, güvenlik + bağlantı, kapsam + maliyet.
Çıkan 44 bulgunun 43'ü doğrulandı. Doğrulanmayan tek bulgu: tutulan cevabın `reply` alanında yasaklı cümle duruyor, ama hiçbir yol onu
göndermiyor. v2 yapısal olarak yeniden kuruldu:

| Bulgu sınıfı | v2'de misafire giden / olan (örnek) | v3 |
|---|---|---|
| Güvenlik adımı başvurmadan SONRA (launder-01) | "If you smell gas, message your host and leave the apartment immediately." → cümle bütün silinip "leave" adımı kayboluyordu (EN / FR / ES / RU, CO alarmı) | Başvurmadan sonra adım varsa ya da temiz ayrılamıyorsa cevabın TAMAMI tutulur ve taslak BOŞ kalır. Adımsız ise bütün cümle çıkar. Tehlike zincirinde yalnız "arayın" kalır. |
| Göndergesel / konulu koşullu yönlendirme (launder-02, -07) | "We do have a sauna. If you have any questions about it, please message your host." → "We do have a sauna." gider, açılış saati "cevaplandı" | Silme dört kapsamdan biri sayılır. Kapanış: kalan gider. Konulu: kalan metin aynı konuya değiniyorsa tutulur. Koşullu konulu: istek açık kalır. Göndergesel ("bu konuda / about it / for details"): neyin cevapsız kaldığı belli olmadığı için cevabın TAMAMI tutulur. |
| Etiket baş kısmı / başlık satırı (launder-03) | "Speaking of the sauna." / "**Parking**" tek başına gidiyordu | Etiket sözcükleri yedi dile genişledi ("Regarding / Was … betrifft / Что касается / -e gelince"). Gövdesi tamamen silinen başlık da düşer. |
| Kalan metin "bilmiyorum / yardımcı olamam / listelenmemiş" (launder-04, -05) | "Unfortunately, I can't help with the airport transfer. Please contact your host." → ilk cümle gidiyordu | Kalan metin sınavı yedi dilde tek kalıpla yapılır (yetersizlik, tahmin, "not listed", "host hasn't mentioned"). |
| "only if" kuyruğu (launder-06) | "A baby cot can be provided, but only if you message your host in advance." → koşulsuz izin gidiyordu | Kısıtlayan kuyrukta bütün cümle çıkar. |
| Zamir önceki cümlede (launder-08) | "Your host Mehmet lives nearby. If anything comes up, just message him." AYNEN gidiyordu | Önceki cümle ev sahibini andıysa zamirli talimat da silinir; üçüncü kişi (şoför, temizlikçi, komşu) anılıyorsa silinmez. |
| Aşırı uygulama (overhold-3 … -12) | "No need to tell your host" / "The door sensor will alert the host" / "Kodu tekrar yazın" / "let me know your arrival time" / "Bize bildirdiğiniz sorun çözüldü" tutuluyordu | Hepsi artık dokunulmaz: olumsuz yapı, cihaz ya da üçüncü kişi öznesi, nesneli "yazın", misafirden kendi bilgisini isteme, "sorun" adı. |
| Bağlantı (safety-wiring) | Tutulan cevapta yasaklı cümle "AI öner" taslağına, Ayarlar testine ve demoya yazılıyordu | Tutulan cevapta bütün yüzeyler silinmiş taslağı (`hostContactDraft`) kullanır. Ayarlar test rotası silme kaydını döndürmez. |
| **Kapsam (cost-coverage-01…08)** | 140 gündelik biçimin 102'si misafire gidiyordu: TR "ev sahibinizle iletişim kurabilirsiniz / temasa geçin / e-posta gönderin / yazışabilirsiniz / koordine edin", "Sorunuz varsa yazın", "sormaktan çekinmeyin"; EN "coordinate / arrange … with your host", "report it to your host", "feel free to ask!"; DE "Kontakt aufnehmen", "sich an uns wenden"; FR "je vous conseille de contacter"; ES "ponerse en contacto con"; RU "Сообщите об этом хозяину"; AR "يرجى إبلاغ المضيف". Konulu olanlarda erken giriş / geç çıkış sessizce "cevaplandı" kapanıyordu | 140'ın 138'i yakalanıyor. İkisi bilerek dışarıda: "zur Verfügung stehen" ve "a su disposición" (talimat değil "buradayız" — soru 5). 67 cümlelik "dokunulmaz" listesi temiz: birinci kişi "I'll mention it to your host", cihaz / üçüncü kişi öznesi, ilgi hâli "хозяина", nesneli "ayarlayabilirsiniz", "nicht kontaktieren". Konulu biçimlerde istek açık kalır (altı dilde pinli). |
| Bilgi isteği (cost-coverage-08) | v2'nin istisnası "If anything comes up, let us know the details." cümlesini de muaf tutuyordu (gidiyordu) | İstisna yalnız misafirin KENDİ bilgisini isteyen cümlede ("let me know your arrival time") geçerli. Genel ihtiyaç koşulluysa cümle kapanıştır. |
| Süre (cost-coverage-09…11) | Başvurma cümle başındayken uzun virgül zinciri 50 binde 128 sn sürüyordu. Çapasız `\p{L}{2,}` 25–31 sn, sondaki ayraç / nokta dizisi 3–5 sn | Hepsi doğrusal (50 binde en ağırı yaklaşık 0,4 sn). 14 yeni süre pini var; 7'si eski kodda kırmızı. |

**Kendi bulduğum (inceleme dışı):** "Ev sahibiniz size haber verecek" gibi ev sahibi öznesiyle verilen sözü süzgeç "haber verme" sanıp
siliyordu. Bu çıktı vetosunu kör ediyordu: veto sözü göremiyor ve cevabın geri kalanı gidiyordu (R13'ten beri var). Düzeltme: haber verme kalıbı yalnız
misafirin kipiyle ("haber verin / verebilirsiniz") çalışıyor. Ulaç biçimi ("arayıp / yazıp") yalnız yönelme / belirtme ekli ev sahibiyle
çalışıyor. Tekrar oynatma bu daraltmanın bir yan etkisini yakaladı ("Havluların yerini ev sahibiniz size bildirebilir" gidiyordu). "size
bildirebilir / söyleyebilir / açıklayabilir" bilgi yönlendirmesine eklendi, pinli.

**Tekrar oynatma (3.274 gerçek model cevabı, model çağrısı yok):**
- K-1029-A öncesine (0e0e1a1e) göre kaybedilen tutuş 0.
- Sistem düzeyinde yeni tutuş 6.
- Kalkan tutuş 7: hepsi "gerçek bilgi + başka konu için yönlendirme"; o konu size açık kalır, biri aşağıda soru 2.
- v2 → v3: 3 yeni tutuş, 0 gevşeme.

**Kırmızı-önce:** yeni testlerin 232'si v2'de (cee4a57d) kırmızı. İlgili birim testleri 141 dosya / 6.899, entegrasyon 13 dosya / 226 yeşil.

**Mutasyon (`scripts/mutation-run.mjs`, ayrık worktree, M0 yeşil) — 42/42.** 42 mutant: süzgeç 16, dedektör 20, taslak bağlantısı 6.
- Süzgeç mutantları: kapsamlar, konulu dokunuş, güvenlik keep / hold / adım, saf koşul sınırı, kısıtlayan kuyruk, başlık düşürme, artık,
  kalan metin sınavı, güvenlik kuyruğu kapanışı, boş taslak, zamir, "diğer konular", üç süre düzeltmesi.
- Dedektör mutantları: üçüncü kişi, birinci kişi, iki bilgi isteği ayrımı, söz öznesi, ulaç ekli, Rusça yönelme, "nicht", birliktelik,
  Arapça "سؤال", "varsa", iyelik ekli "host's", "not reachable", "bildirebilir", "kurmanıza gerek yok", "нам / мне", "bei weiteren
  Fragen", "sich … an uns", "iletişim kur" iki dedektör.
- İlk koşu 34/42. Yaşayan 8 mutant pinlendi ve yeniden koşuda 8/8 öldü. A1: üçüncü kişi öznesinde nesne aralıklı iş fiili. A19 / A20: iki
  dedektör birbirini örtüyordu, her biri yalnız kendi yakaladığı biçimle pinlendi. W1 / W2 / W4 / W5 / W6: tutulan cevabın silinmiş taslağı
  hiçbir testle sınanmıyordu (kanal izi, kıdemli okuyucunun yeniden yazdığı taslağın izi, QR izi, Ayarlar önizlemesi, tanıtım demosu); beş
  entegrasyon pini eklendi.

**Bilinen fazla tutuş / fazla açma (güvenli yön, kodlanmadı):**
- "…If anything comes up, let us know the details." cevabın tamamını tutar ("details" göndergesel sayılıyor).
- İspanyolcada silinen cümlenin "con" sözcüğü gevşek eşleşmeyle cevaplanmış Wi-Fi isteğine de bağlanıp onu açık bırakabiliyor. Misafire cevap
  yine gider; size gereksiz bir "açık iş" düşer.
- "Checking out at 8 is fine; please let your host know…" uzun biçimi ve adres + "for directions from the airport" konulu dokunuşla tutulur.
- Konulu dokunuş ("Otopark P2'de. Otopark için ev sahibinize yazın.") tutulur.

### Sabah soruları (K-1029-A v3 — önce / sonra)
1. **Ret cümlesi.** Örnek: "Merhaba, güvenlik nedeniyle başka bir dairenin giriş kodunu paylaşamam. Kendi dairenizin giriş bilgileri için ev
   sahibinize platform üzerinden yazabilirsiniz."
   - **Önce ve bugün:** cevabın tamamı tutulur.
   - **Seçenek:** yönlendirme silinir, "…paylaşamam." misafire gider, soru size açık kalır.
   - Hangisi?
2. **Başka kaynağa havale.** Örnek: "Bu konuda en net bilgiyi yerel ulaşım uygulamalarından … alabilirsiniz; ev sahibiniz de size yönlendirme
   konusunda yardımcı olabilir."
   - **Önce:** tamamı tutulurdu.
   - **Bugün:** ilk cümle gider, soru size açık kalır.
   - "Uygulamalara bakın" türü cevap gitsin mi, yoksa bu tür havale de tutulsun mu?
3. **Teşekküre "rica ederim".** Örnek: "Rica ederim, ne zaman ihtiyaç olursa yazabilirsiniz."
   - **v1:** aynen giderdi.
   - **Bugün:** geriye yalnız "Rica ederim." kalır, bu yüzden tamamı tutulur (kapanışa sessizlik kuralıyla uyumlu).
   - **Seçenek:** "Rica ederim." gitsin.
4. **Ev sahibini anlatan baş kısım.** Örnek: "Ev sahibiniz Ayşe Hanım çok yardımseverdir, bir sorun olursa ona yazın."
   - **Bugün:** "Ev sahibiniz Ayşe Hanım çok yardımseverdir." gider.
   - Tek başına gitsin mi, yoksa bu baş kısım da silinsin mi?
5. **Bilerek yakalanmayan biçimler** (birinci savunma istem yasağı): ev sahibi anılmadan "send them a message"; adıyla "Please message Ayşe
   if anything breaks"; "Bei Fragen stehen wir Ihnen gerne zur Verfügung" / "estamos a su disposición" (talimat değil, "buradayız").
   - Eklensin mi?
6. **"Telefon numarası paylaşılmamış." tek başına** (yönlendirmesiz).
   - **Bugün:** "bilgim yok" dedektörü tanımıyor, gider.
   - Dedektöre "<bilgi> paylaşılmamış / hasn't been shared" eklensin mi? Yalnız tutma yönünde çalışır.
7. **Kısmi cevap + konusuz yönlendirme.** Örnek: "Binada sauna var. Detaylar için ev sahibinize yazabilirsiniz."
   - **Dün gece (v1):** "Binada sauna var." giderdi, sauna "cevaplandı" kapanırdı.
   - **Bugün (v3):** neyin cevapsız kaldığı belli olmadığı için cevabın TAMAMI tutulur, size gelir.
   - **Seçenek:** "Binada sauna var." gitsin, sauna sorusu size AÇIK kalsın.
   - Hangisi? (K-1029-A "doğru cevap gider" diyor; ama "detaylar" neyin cevaplanmadığını söylemiyor.)

### K-1029-C — ek / koşul sezgileri: "yalnız sıkılaştıran" yamaların hepsi reddedildi (ölçüldü, kod DEĞİŞMEDİ)
Envanterdeki gevşetebilen beş sözcük ağı grubu için bir iş akışı koştu: G1 varsayımsal / geçmiş zaman eki, G2 olumsuzluk, G3 CO dedektörü,
G4 acil ağı nötrleyicileri, G5 şikâyet koşulu. Tasarımcı ajanlar 23 "yalnız sıkılaştırır" yama önerdi. Her öneriyi ayrı bir doğrulayıcı
sınadı: değişikliği yeniden kurdu, testlerdeki 40.697 dizgeyi eski ve yeni koddan geçirdi, karşı örnek aradı. **23'ünün 23'ü reddedildi.**
Her biri yeni yanlış alarm üretiyordu; 10'u bir yerde gevşetiyordu. Örnekler (yama → doğrulayıcının bulduğu karşı örnek):
- G1 ("ne olursa olsun" deyimi koşul değil): "Yangın çıktı ne olursa olsun yardım edin!" doğru yakalanıyor. Ama "Yangın çıkarsa çıkalım
  mı?" varsayımsal sorusu da gerçek olay sanılıyor.
- G2 (olumsuzluk kapsamı): "No way the fire is under control" düzeliyor. Ama "I do not smell the smoke anymore, thank you" / "No hay fuego,
  sigue saliendo agua" yangın alarmına dönüyor.
- G3 (CO dedektörü "Sorry if …" kalıbı): "Sorry if the CO alarm goes off tonight, we will be cooking a lot." acil sayılıyor.
- G4 ("bilinci yok", "break-in"): "Komşuların hiç bilinci yok, gece 3'te müzik açıyorlar" / "There was a break in the water supply" /
  "Das Bett ist eingebrochen" acil sayılıyor.
- G5 ("sorun olmaz demiştiniz ama…"): "Geç çıkış için sorun olmaz demiştiniz ama yine de teyit edeyim…" şikâyet sayılıyor.

**Sonuç:** bu sınıfın sözcük kalıbıyla kapatılamayacağı ölçüldü. Kurucunun K-1029-C yönü doğrulanmış oldu: ek / koşul eki karar vermesin,
anlamı model okusun. Bugünkü kod güvenli yönde (fazla tutar) kaldı. Ayrıntı ve tüm karşı örnekler iş akışı kaydında
(`wexl11rzw`, `scratchpad/k1029c/`).

## 10-30 akşam — K-1029-A v4: v3'ün çekişmeli yeniden incelemesinin 33 bulgusu + düzenli ifade motorunun en kötü kipi

v3 push edildikten sonra aynı dört mercekle (aklama, aşırı uygulama, güvenlik + bağlantı, maliyet) bir tur daha koşuldu. Bulucuların her
bulgusu ayrı bir doğrulayıcıda yeniden üretildi; 33 bulgu kaldı. Hepsi kodda; vakalar `tests/unit/host-contact-v4.test.ts`te
(203 vaka: 103 yakalanmalı, 32 dokunulmamalı, 68 bütün cevap; v4-cases ilk 199 vakası kırmızı-önce ölçüldü). **Kırmızı-önce:** v3 (98b5d838) bu dosyada 192 vakayı kaçırıyordu.

### Bulgu sınıfları — önce / sonra

| Sınıf | Örnek | v3 | v4 |
|---|---|---|---|
| LEAK-01 nesneli İngilizce başvurma | "Please confirm the time with your host." | gider | silinir |
| LEAK-02 "also / then" | "Please also inform your host." | gider | silinir |
| LEAK-03 Türkçe biçimler | "Herhangi bir sorunuz olursa buradan yazabilirsiniz." · "Bu durumu ev sahibinize aktarabilirsiniz." | gider | silinir |
| LEAK-04 ekip / ortak ev sahibi | "Feel free to contact our team." · "Please message your co-host." | gider | silinir |
| LEAK-05…08 DE / FR / ES / RU / AR | "Klären Sie das am besten direkt mit Ihrem Gastgeber." · "Posez la question à votre hôte." · "Avísenos si necesita algo más." · "Уточните этот вопрос у хозяина." · "راجع المضيف بخصوص ذلك." | gider | silinir |
| LAUNDER-01 silinen cümlede belirsizlik | "Street parking is free. I'm not 100% sure about this, so it's best to confirm with your host." | "Street parking is free." gider (kesin gibi) | cevabın tamamı tutulur |
| LAUNDER-02 / VETO-1 silinen cümlede söz / iletme iddiası | "Your late checkout until 14:00 is approved. I've passed this on to your host — just message them if anything changes." | iddia cümlesi silinir, onay gider, veto göremez | tamamı tutulur |
| LAUNDER-03 ön koşul + izin | "Early check-in is possible. Please arrange it with your host beforehand." | "Early check-in is possible." gider (koşulsuz evet) | tamamı tutulur |
| SETTLE-01 "gerekirse / isterseniz" | "Erken giriş temizlik programına bağlı. Gerekirse ev sahibinize yazabilirsiniz." | ilk cümle gider, istek kapanır | tamamı tutulur |
| SETTLE-01 sınırı (mutasyonun M0 kontrol koşusu yakaladı) | "Wi-Fi şifresi Lale1234. Si besoin, envoyez-nous un message." · "Wi-Fi şifresi … Gerekirse ev sahibinize yazabilirsiniz." | şifre gider | şifre gider (genel kapanış; v2 pini korunur) — yalnız kalan belirsizlik ya da izin söylüyorsa ("Late checkout is possible. If you'd like, message your host.") tamamı tutulur |
| fp-01 kendi konusuyla yan cümle (GD5) | "The pool is open until 22:00, but for the sauna hours please message your host." | cümlenin tamamı silinir | havuz bilgisi gider, sauna yan cümlesi silinir |
| fp-02 teşekkür | "Thanks for contacting us, and if you need extra towels, they're in the hallway closet." | silinir | dokunulmaz |
| fp-03 / fp-04 arıza kapanışı | "The lockbox code is 4821. If that doesn't work, message your host." | tamamı tutulur | kod gider, kapanış silinir (R13-b/c) |
| fp-05 / fp-06 işletme / akraba | "The hostel next door rents bikes. Just ask them at the front desk." · "There's a bakery … Ask the owner for the pistachio simit." | silinir | dokunulmaz (ev sahibi değil) |
| fp-07 geçmiş olgu | "Ev sahibinize daha önce haber verilen kombi arızası yarın 10:00'da giderilecek." | silinir | dokunulmaz |
| fp-09 olumsuz | "You don't need to arrange anything with your host; the lockbox code is 4821." | silinir | dokunulmaz |
| fp-10 hizmet amacı | "If you're arriving after 22:00, please let us know so we can leave the hallway light on." | silinir | dokunulmaz |
| SAFE-1 güvenlik + yazma | "If the smoke alarm goes off, call your host immediately; for anything else, feel free to message them." | tamamı | arama kalır, yazma yan cümlesi silinir |
| SAFE-2 devam cümlesi | "If you smell gas … open all the windows. Then leave the apartment and call your host from outside." | tahliye adımı silinir | dokunulmaz |
| SAFE-3 / 5 "veya" | "If you ever smell gas, call 112 or message your host right away." | 112 adımı da silinir ya da yarım kalır | "call 112." kalır; nesnesiz çıplak fiil ("call or message your host") → tamamı tutulur |
| SAFE-4 Arapça tehlike | "إذا شممت رائحة غاز، افتح النوافذ وغادر الشقة فوراً وراسل المضيف." | tehlike tanınmaz | adımlar kalır, yazma silinir |
| SAFE-6 yanık kokusu / açık kablo | "If you notice a burning smell from the heater, unplug it immediately and message your host." | tehlike tanınmaz | adım kalır, yazma silinir |

fp ve SAFE düzeltmeleri kurucunun mevcut kararlarının (GD5: yalnız talimat yan cümlesi silinir; R13-b/c: genel kapanış çıkar, cevap gider;
K-1029-A kapsamı ev sahibi) uygulanmasıdır; misafire giden yeni bir metin türü açmaz. LAUNDER / SETTLE yalnız tutma yönündedir.

### Gerçek cevaplarda tekrar oynatma (ücretsiz, model yok)
3.274 benzersiz model cevabı (`docs/olcum/*.json`): **v3 → v4 davranış farkı 0** (gönderilen metin ve tutuş aynı). K-1029-A öncesine
(0e0e1a1e) göre: kaybedilen tutuş 0 · sistem düzeyinde yeni tutuş 6 · kalkan tutuş 7 (v3 ile aynı). Rapor
`docs/olcum/host-contact-replay-2026-10-30.md`.

### Bulunan ikinci şey: düzenli ifade motorunun en kötü kipi (eskiden kalan, ölçüldü, düzeltildi)
v4'ün maliyet probunda "silmeden sonra uzun boşluk" biçimi sırayla değişen sürelerde koştu: yalnız 16.000 karakterde 0,6 sn, uzun bir
Türkçe metinden SONRA 9,4 sn. Kök neden süzgeçte değil, **çıktı vetosunda** (v4 öncesinden kalma):
- V8 bir düzenli ifadeyi ilk çalıştırmada ve bellek temizliğinde kodu atıldıktan sonra **yorumlayıcıda** koşturur. Derlenmiş kipte de
  konum atlatan hızlı denetim her durumda devrede değildir.
- Vetonun iki alternatifinde geriye bakış fiil gövdesinden ÖNCE yazılıydı: "her … -yorum" ve alışkanlık + geniş zaman. Bu yüzden bakış
  her konumda koşuyordu. Yorumlayıcıda 8.000 karakterlik sekme dizisi 4,3 sn sürdü; 2.000 karakterde 0,28 sn, yani karesel. Derlenmiş
  kodun bozuk durumunda 16.000 karakter 8 sn sürdü. 09-28 ReDoS ölçümü yalnız derlenmiş kipte yapıldığı için "yavaş değil" demişti.
- Düzeltme 09-28'deki gibidir: önce gövde ileriye bakışla sınanır, kabul edilen dil aynı kalır. Sonuç: 8.000 karakter 4,3 sn → 9 ms.
- Ek olarak altı söz kalıbında alternatiflerin ortak `(?<!\p{L})` sınırı tek öbeğe toplandı (`factorLeadingBoundary`). İyileştirmesiz
  kipte 3–9 kat hızlandı.
- Eşdeğerlik: eski ve yeni veto 69.710 metinde (ölçüm cevapları, test dizgeleri, türetilmiş alışkanlık / "olsam" / satır sonu
  biçimleri) **0 fark**.

**Yeni pin:** `tests/unit/regex-worst-mode-cost.test.ts` vetoyu, dedektörü ve süzgeci ayrı bir süreçte V8'in iki kötü kipinde
(`--no-regexp-optimization`, `--regexp-interpret-all`) 4.000 karakterlik boşluk dizilerinde süreler; eşik 1,5 sn.
- v3 + eski veto ölçümü: veto 1,0–25,7 sn, süzgeç 22–189 sn.
- v4 ölçümü: en çok 0,44 sn.
- Süzgeç zincirinin 256 kalıbı iki kipte tek tek tarandı (boşluk, sekme, NBSP, satır sonu, uzun sözcük, virgül zinciri, Arapça bitişik
  "و", Rusça). Karesel şüpheli **0**.

**Süzgecin kendi maliyeti:**
- Önceki cümleye bağlı okumalar (işletme mi, yalnız ev sahibi mi, güvenlik talimatı mı) önceki cümle değişince bir kez hesaplanıyor.
  Uzun cümle + 1.666 kısa başvurma biçiminde 100.000 karakter 4,3 sn → 1,1 sn.
- Cümle başına veto yalnız cevabın tamamı vetoya takılıyorsa koşuyor. 109.098 metinde "cümle takılır, bütün takılmaz" karşı örneği 0.
- Konu okumasına tek girdilik önbellek: süzgeç ve "cevaplandı" kuralı aynı kalan metni art arda okuyordu. 50 bin karakterde ~0,25 sn
  kazanç; üretimde de aynı metin okunuyor.
- v4 her cümlede daha çok iş yapıyor (yeni biçimler, Arapça bitişik "و" ile binlerce yan cümle). Önbellekten sonra tsx'te v3 ile aynı
  düzeyde (dört koşu toplamı 4,9 sn / 4,8 sn). Süre pinleri bu makinede v3'te en çok 1,1–1,3 sn, v4'te ~1,2 sn ölçtü (eşik 1,5; üç
  ardışık koşu yeşil).
- CI bu makineden yaklaşık %30 hızlı: v3'ün süre dosyası CI 1693'te 5,9 sn, burada 8,3 sn sürdü.
- Üretimde süzgecin girdisi `capReply` ile en çok 4.000 karakter.
- Yeni Arapça pin 35.000 karakterde. Gerekçesi yorumunda ölçümüyle yazılı: 12,6 / 25 / 50 / 100 bin karakterde 0,2 / 0,33 / 0,68 / 1,2 sn,
  yani doğrusal.

### Mutasyon (`scripts/mutation-run.mjs`, ayrık worktree)
35 mutant (9c8e7dee). İlk koşu: 26 öldü. Yaşayan yedisi gerçek eksik pindi ve pinlendi (`host-contact-v4.test.ts`): genel ihtiyaç kapanışı ön koşul sayılmaz (F4), yaz-sonra-adım (F10), "İlgili bir sorunuz olursa" (F16), işletme + "Ask the owner" (F17), acil numara güvenlik cümlesi (F18), akıllı kilit / sensör ev sahibine haber verir (A2), ev sahibinin önerdiği taksi (A5). Konu önbelleğinden dönen dizinin kopya olması da pinlendi (R1). Yeniden koşu (6d8090cc): **8/8 öldü**. Kalan tek mutant C1 (işletme okumasının önbelleği her seferinde yeniden hesaplanır): aynı değer üretir, yalnız süreyi etkiler — gerekçeli EŞDEĞER. Gövde-önce veto mutantları (V2: ileriye bakış kaldırıldı) en kötü kip süre pininde zaman aşımıyla öldü.

### Bilinen davranışlar (güvenli yön, kayda)
- **Ev sahibi önceki cümlede anılmışsa zamirli kapanış:** "Ihr Gastgeber wohnt nebenan. Bei Fragen können Sie sich gerne an ihn
  wenden." Bu durumda ilk cümle gider, kapanış silinir (sabah sorusu 4 ile aynı sınıf).
- **"İsterseniz / If needed" kapanışı:** kendi başına genel kapanıştır (silinir, cevap gider). Kalan metin belirsizlik ("bağlı / depends") ya da
  izin ("mümkün / possible") söylüyorsa cevabın tamamı tutulur (SETTLE-01). İlk v4 taslağı bunu her durumda tutuyordu; v2'nin "Si besoin" pinini
  mutasyonun kontrol koşusu kırdı, kural inceltildi.
- **Ön koşul kuralı:** silinen parça bir ön koşul söylüyor ("önceden haber vermeniz gerekiyor"), kalan da bir izin söylüyorsa ("evcil
  hayvan kabul ediliyor") tamamı tutulur. Genel sorun kapanışı ön koşul sayılmaz.
