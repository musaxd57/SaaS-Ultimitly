# Erken giriş kanıt modeli — mevcut durum, eleştiri, tasarım (09-24)

Kurucu isteği (özet): *"Sensitive request = BLOCK değil. Sensitive request = özel doğrulama workflow'unu çalıştır.
Yeterli kesinlik varsa doğru cevabı otomatik ver; yoksa tahmin etme, mevcut safe/human-review/holding akışını kullan.
Birleşim kuralı kalsın. REQUEST ≠ APPROVE ≠ REJECT ≠ BLOCK. UNKNOWN ile REJECT asla karışmasın."*

Bu belge önce **ne olduğunu** (kod), sonra **beş bağımsız incelemenin** (ürün/iş akışı · güvenlik/LLM · veri modeli/
eşzamanlılık · temizlik/operasyon · test/eval) bulgularını, sonra **kararları** ve **uygulama sırasını** verir. Her
iddia kodla doğrulandı; doğrulanamayan UNVERIFIED yazılır. Sıfırdan yeniden tasarım YOK: mevcut çekirdek genişletilir.

## A. Bugün olan (kod)

| Alan | Olan | Yer |
|---|---|---|
| Karar çekirdeği | Saf `decideEarlyCheckin(facts, rule)`; 15 kapalı-küme kontrol kodu; durum `approvable / needs_host / not_early`; ücret kararın NİTELİĞİ (durum değil); otomatik = kural `auto` + onaylanabilir + iki model aynı saat + tek konu | `lib/early-checkin/core.ts` |
| REDDETME yok | Hiçbir kod otomatik "hayır" demez: `before_window`, `overlap`, `previous_still_in` → `needs_host`. Modelin ret cevabı hassas sayılır, tutulur | core.ts, `availability-claims.ts` |
| Birleşim | hassas istek = kelime ağı ∨ bekçi ∨ beyan ∨ ret ∨ anlama ∨ niyet etiketi; iddia da birleşim; bir katmanın yokluğu yalnız KENDİ "evet"ini kaldırır | `availability-claims.ts:847-859` |
| Otomatik onay yolu | Yalnız KODDA kurulan metin (6 dil, günü adlandırır, ücret kuraldan); kapı bu metinle BAŞTAN koşar; muafiyet birebir metin + tek tür | `reply.ts`, `automation.ts`, `availability-claims.ts:831-835` |
| Olgu yükleyici | org kapsamlı; önceki çıkış = misafir bildirimi ile varsayılanın GEÇ olanı (bildirim yalnız sıkılaştırır); çakışma; bozuk satır = çakışma; aynı gün devir yoksa dün gece yalnız taze kaynakla boş | `load.ts` |
| HAZIR | BU devrin (çıkış gününe bağlı / bağsız) temizlik görevlerinin HEPSİ kapalı + bir "bitti" kaydı önceki çıkış anından sonra, sunucu saati, ≥5 dk | `readiness.ts` |
| Temizlik sonrası yeniden değerlendirme | Yalnız hazırlık yüzünden tutulmuş cevapsız isteği BİR KEZ yeniden aday yapar (atomik CAS, döngü koruması) | `recheck.ts` |
| Host kuralı | mülk başına `off/draft/auto`, `earliest`, `fee{amount,currency}`, `note`; bozuk satır = kapalı; yazma yönetici kapılı, kiracı 404, denetim alan adıyla | `rules.ts`, `api/properties/[id]/early-checkin-rule` |
| Ücret | YALNIZ host'un kaydı, kodda biçimlenir; model tutar üretmez; form ve gecelik aralık yalnız yöneticiye | `reply.ts`, `properties/[id]/page.tsx` |
| Personel ("staff") | ZATEN dar temizlik rolü: sayfalar YALNIZ `/tasks` (middleware), API'ler: görevler (yalnız KENDİNE atanmış; durum/not/foto/checklist işareti) + yükleme; konuşma/rezervasyon/KB/ayar/para rotalarının HEPSİ `withManage` | `middleware.ts:80-90`, `api/tasks/*`, `route-guard.ts` |
| Temizlik olayları | `TaskUpdate{userId, status, note, photoUrl, createdAt}` — kim, ne zaman, sunucu saati; foto özel depolamada, görev bağlı | `schema.prisma`, `api/tasks/[id]`, `api/upload` |
| Misafirin bildirdiği çıkış | cevap modelinin `statedCheckoutTime`ı (mesajda harfiyen saat + çıkış ipucu) → `Reservation.guestCheckoutTime` (TEK alan, resmi çıkıştan AYRI; üzerine yazılır) | `stated-time.ts`, `automation.ts:~2086` |
| Kanıt | `RiskEvent.kbEvidenceJson.ec = {s,f,a}` (PII yok) + giriş hazırlığı görevine not | `workflow.ts`, `grounding.ts` |

## B. Önerilerden hangileri ZATEN vardı

- REQUEST ≠ BLOCK: doğrulama iş akışı 09-24'te kuruldu; birleşim yalnız tespit.
- UNKNOWN ≠ REJECT: otomatik ret YOK (ret durumu hiç yok).
- Temizlikçinin dar rolü: `staff` bugün zaten yalnız `/tasks`, yalnız kendi görevleri, para/konuşma rotaları kapalı.
- Temizlikçi kimliği + zaman damgası + foto + not + checklist: `TaskUpdate` + görev.
- READY'nin devre bağlanması: görev `reservationId` = ayrılan konaklama + `dueAt` = çıkış günü; "evvelsi günün işareti"
  bugünkü devirde sayılmaz (çıkış anından sonra şartı).
- "En erken otomatik onay saati": kuraldaki `earliest` BUGÜN ZATEN böyle çalışıyor — daha erken istek `before_window`
  → host (ret değil). Eksik olan yalnız formdaki ad ("En erken giriş saati" taban gibi okunuyor).
- Ücret: kuraldaki tutar; yapay zekâ üretmez.
- Resmi çıkış ile misafirin bildirdiği çıkış AYRI alanlar (property `checkOutTime` ↔ `guestCheckoutTime`).
- Takvim çakışması READY'yi geçemez (`overlap` ayrı kod).

## C. Gerçekten eksik olanlar (doğrulandı)

1. **Senaryo 2 imkânsız** (dört inceleme de buldu): READY çıkış anından ÖNCE atılırsa (`before_checkout`) sayılmaz ve
   `previous_still_in` ayrıca düşer → "önceki misafir 11:00 dedi, temizlikçi 08:50'de hazır dedi, 09:00 isteği"
   HER ZAMAN host'a gider; mevcut testler bunu TERS yönde pinliyor.
2. **Bekleyen istek kayboluyor** (ürün P1, bekçi açılınca): iki model ertelemeyi doğrularsa erteleme cevabı GİDER,
   konuşma `answered` olur; temizlik bitince yeniden değerlendirme `status:new` istediği için O KONUŞMAYA ULAŞAMAZ;
   dikkat akışı son mesajı bizimki olan konuşmayı atlar → host sinyal almaz.
3. **Gelecek günün isteği** ("yarın 12'de") hiç otomatik onaylanamaz (`not_arrival_day` yeniden değerlendirme
   kümesinde değil; pencere 24 sa).
4. **Gün doğrulanmıyor** (güvenlik P2): varış günü gelen "YARIN 12'de" mesajı "bugün 12:00" onayı alabilir.
5. **Geç onay geçmiş saati söyler**: 09:00'da 12:00 istenir, temizlik 13:30'da biter → "12:00 itibarıyla" + ücret.
   Standart giriş geçtikten sonra da onay üretilebilir.
6. **Modellerin görmediği mesaj**: anlama katmanı son 5 cevapsız mesajı 1.000, bekçi 1.200 karakterde kesiyor;
   "tek konu" ve saat yalnız bunlardan → görünmeyen ikinci istek onayın arkasında kaybolabilir.
7. **Bilgi sorusu ↔ izin isteği karışık**: "Erken giriş ücretli mi?" izin motorunu koşturur (`time_unknown`) ve
   insana gider (niyet etiketi birleşimde istek sayılıyor; bilinçli bedel). Eval bunu ölçemiyor.
8. **Bavul bırakma erken girişe katlanıyor** (üç istemde) → bavul isteğine erken giriş onayı + ücret gidebilir.
9. **Olay/aktör/duruş yok**: anlama şeması saatin HANGİ olaya ait olduğunu, planlanan/beyan/gerçekleşen ayrımını
   taşımıyor; `statedCheckoutTime` bavul/havalimanı/istek cümlelerini de çıkış sayıyor; istem bunu "gerçek" gibi
   sunuyor (sonraki cevapta onaylanmamış geç çıkışı ima edebilir); pano resmi saat yerine onu gösteriyor.
10. **TOCTOU**: kararla gönderim arasında olgular yeniden okunmuyor; kuyruk (kapalı) satırı onay olduğunu bilmiyor →
    "bugün (14 Ekim)" günler sonra gidebilir.
11. **Denetim yetersiz**: `ec` yalnız `{s,f,a}` — hangi READY, hangi kural sürümü, hangi önceki konaklama, onaylanan saat
    yok; kural yerinde güncelleniyor → "neden evet dedi" sonradan kurulamıyor.
12. **Temizlikçiye misafir verisi sızıyor** (operasyon P1 — girişi açmadan ÖNCE kapanmalı): sistem görev
    başlıklarında misafir ADI; yapay zekâ görevlerinde misafirin mesajı AYNEN açıklama → `GET /api/tasks`, PATCH
    cevabı, atama e-postası (temizlikçinin kutusuna, saklama süresi dışına), WhatsApp paylaşım metni.
13. **Temizlikçi devir görevlerini görmüyor** (operasyon P1): sistem temizlik görevleri ATANMAMIŞ oluşuyor; panoda
    atama kontrolü yok → temizlikçi READY'nin dayandığı görevi hiç görmez.
14. **Personel hesabı açılamıyor**: ürün içinde davet/ekip akışı yok (yalnız kayıt ve operatör paneli sahip açar).
15. **Olumsuz operasyonel kanıt kaydedilemiyor**: "misafir içeride / giremiyorum" yalnız serbest not; yükleyici
    okumuyor. Açık bakım/arıza görevi de hazırlığı engellemiyor ("Daireniz hazır" arıza açıkken gidebilir).
16. **Görev tarihi rezervasyonu izlemiyor**: uzayan/kısalan konaklamada `dueAt` eski günde kalır → hazırlık
    `ready_unknown`, temizlikçi yanlış güne gider.
17. **Görev durumu + geçmiş atomik değil**: durum yazılıp kayıt düşerse "son bitti" geri alınmış işaret olabilir.

## D. İncelemelerin eleştirileri (özet) ve E. kararlar

| # | Eleştiri (kaynak) | Karar |
|---|---|---|
| 1 | 9+ yeni durum gereksiz; ücret nitelik, pencere/taslak zaten kod (ürün, güvenlik, test) | **KABUL** — ↓F: 4 durum |
| 2 | Otomatik ret (VERIFIED_UNAVAILABLE) yeniden "hayır"ı getirir; tek sert olgu `overlap` = veri çelişkisi (ürün, test) | **KABUL** — otomatik ret YOK; olumsuz kanıt → host |
| 3 | Misafirin "çıktık"ı onay kanıtı olamaz; misafir beyanı yalnız sıkılaştırır (güvenlik) | **KABUL** — ↓G |
| 4 | READY'yi çıkıştan önce kabul: yalnız ayrılan konaklamaya BAĞLI görevde, aynı gün, kimlikli "başladım"→"hazır" sırası, açık sorun yok, host açık rızası (güvenlik, operasyon, veri, test) | **KABUL** — ↓I |
| 5 | Yeni rol dizesi ("cleaner") YASAK: middleware/app-shell `=== "staff"` sınar → yeni rol inbox'ı rol denetimsiz açardı (operasyon) | **KABUL** — `staff` kalır |
| 6 | Temizlikçi girişi açılmadan misafir verisi sızıntısı kapanmalı (operasyon P1) | **KABUL** — dilim sırası ilk |
| 7 | Ayrı kural tablosu / org varsayılanı + mülk ezmesi ŞİMDİ yok (veri, ürün) | **KABUL** — ↓L |
| 8 | Turnover/Readiness tablosu, Issue tablosu yok (değişmez 11) (veri, operasyon) | **KABUL** — Task/TaskUpdate yeter |
| 9 | Yeni LLM bekçisi yerine DETERMİNİSTİK sayı/saat eşleştirme (güvenlik) | **KABUL** — ↓N |
| 10 | Bilgi sorusu için KODDAN kurulan politika metni (izin vermez → hem bilgi hem izin isteğinde doğru; bekletme mesajı da olur) (ürün) | **KABUL, DEĞİŞTİRİLEREK** — yalnız kural `auto` iken; konuşma host'un dikkat akışında kalır (↓F) |
| 11 | Gece yarısında READY'yi saatle düşürme (operasyon) | **KISMEN** — aynı gün devirde işaret DEVİR GÜNÜ atılmalı (kurucu: "dünkü READY bugün sayılmaz"); boşluklu varışta son devrin READY'si + aradaki TÜM geceler kanıtla boş (veri P3) |
| 12 | Uçtan uca kilit YOK; iyimser yeniden doğrulama (test, veri) | **KABUL** — ↓T |
| 13 | Denetim kanıtına saat/tutar yazma (veri) ↔ saat/tutar yaz (güvenlik) | **ORTA YOL** — kimlik + zaman damgası + kural sürümü; onaylanan saat ve tutar giden mesajdadır (saklama kuralına tabi) |
| 14 | "İki bağımsız model" aynı model — saat için deterministik çapraz kontrol (güvenlik P3) | **KABUL** — misafir metnindeki sayısal saat onaylananla çelişirse taslak |
| 15 | Mutasyon koşucusu: her sıfırdan-farklı çıkış "öldürüldü" (zaman aşımı, sözdizimi) (test P3) | **KABUL** (ayrı iş) |

## F. Nihai durum makinesi (tasarım)

`status` ∈ {`not_early`, `approvable`, `pending`, `needs_host`} + nitelikler `fee`, `autoSend`, kapalı-küme `failed[]`.

- **not_early** (NOT_APPLICABLE): istenen saat standart girişe eşit/sonra, 05:00 öncesi (geç varış), ya da karar anında
  standart giriş saati GEÇMİŞ.
- **approvable** (VERIFIED): tüm zorunlu kontroller geçti. `fee` null → ücretsiz, dolu → ücretli (kuraldan).
  `autoSend` = kural `auto` ∧ iki kaynak aynı saat ∧ tek konu ∧ (yeni) tüm cevapsız mesajlar modellerce TAM görüldü ∧
  (yeni) istenen gün = varış günü ∧ (yeni) misafir metnindeki sayısal saat onaylanan saatle çelişmiyor ∧ (yeni) onay
  anında saat geçmemiş. Otomatik değilse host'a HAZIR TASLAK.
- **pending** (NOT_YET_VERIFIED) — YENİ: düşen kontrollerin HEPSİ "kanıt henüz yok" türünden VE kanıt GELEBİLİR
  (`not_ready`, `ready_unknown`, `not_arrival_day`; `previous_still_in` YALNIZ host `readyBeforeCheckout` rızasıyla —
  rıza yoksa beklenen çıkışı hiçbir kanıt aşamaz → host; `previous_checkout_unknown` → host, hazırlık ölçülemez).
  Temizlik/varış günü geldiğinde yeniden değerlendirilir; host'un dikkat akışında görünür. (09-24 inceleme: ilk
  sürüm hiç gelmeyecek kanıtı "bekliyor" sayıp boşa yeniden değerlendirme ve yanıltıcı panel sözü üretiyordu.)
- **needs_host** (HOST_REVIEW): diğer her şey — kural kapalı, `before_window` (OUTSIDE_AUTO_CONFIRM_WINDOW), çakışma,
  saat okunamadı/çelişkili, rezervasyon onaylı değil, çok konu, bavul, açık sorun görevi, gizli mesaj.

Yalnız OTOMATİK gönderimi durduran kodlar (onaylanabilir kalır, host tek tıkla gönderir): `single_source_time`,
`multi_intent`, `clock_unknown` (saat okunamadı), `open_maintenance` (mülkte bağsız tarihsiz/gecikmiş açık bakım),
`cleaning_note` (temizlikçinin bugünkü notu — bugün sorun bildiriminin tek yolu), `day_unverified`, `not_fully_read`,
`time_mismatch_text`, `queued_delivery` (kalıcı kuyruk açık).

Otomatik RET durumu YOK. "Ücretli mi?" gibi bilgi soruları motorun durumu değil, motordan ÖNCEKİ yönlendirmedir
(↓K). Misafire giden: `approvable+autoSend` → kod onay metni; `pending/needs_host` → (kural `auto` ise) koddan
kurulan bekletme/politika metni (izin vermez, ret etmez, söz vermez) + host'a dikkat kalemi; aksi → bugünkü davranış.

## G. Kanıt hiyerarşisi (önceki misafirin çıkışı)

| Seviye | Kaynak | Kullanım |
|---|---|---|
| G0 resmi çıkış | mülk `checkOutTime` + rezervasyon tarihi | beklenen an |
| G1 plan / G2 beyan | misafir mesajı (anlama katmanı `events[]`: `planned` / `declared`) | YALNIZ sıkılaştırır (geç olan) + host/temizlikçiye bilgi |
| G3 gerçekleşen ("çıktık") | misafir mesajı (`completed`) | YALNIZ bilgi (temizlikçiye "misafir çıktığını bildirdi"); onay kanıtı DEĞİL |
| G4 temizlik başladı | kimlikli personel/yönetici `in_progress` kaydı, BU devrin görevinde, devir günü | güçlü operasyonel kanıt (misafir yok) |
| G5 temizlik bitti + HAZIR | kimlikli `done` kaydı, BU devrin görevinde, devir günü, ≥5 dk, tüm devir görevleri kapalı | onay için ZORUNLU |
| N1 olumsuz | temizlikçinin kapalı-küme sorun bildirimi (misafir içeride / erişim yok) → açık sorun görevi | onayı engeller (`not_ready`), host'a acil |
| N2 | görev yeniden açıldı / açık bakım görevi | onayı engeller |
| N3 | çakışma / yeni işgal | `needs_host` |

Onay G5 ister. G5 beklenen andan (G0 ∨ G1/G2'nin geç olanı) ÖNCE ise ancak: görev ayrılan konaklamaya BAĞLI ∧ aynı
görevde aynı gün daha önce G4 var ∧ açık sorun yok ∧ host kuralında açık rıza (`readyBeforeCheckout`). Misafir
beyanları hiçbir zaman "evet" üretmez.

## H. Temizlikçi izin modeli

`staff` rolü (yeni rol dizesi YOK). Sayfa: yalnız `/tasks`. API: görevler (yalnız kendine atanmış), yükleme, foto.
Görev PERSONEL GÖRÜNÜMÜ (tek yerden): sistem/yapay zekâ görevlerinde başlık = görev türü etiketi (misafir adı YOK),
açıklama yalnız elle yazılmış görevlerde, iç kimlikler yok; atama e-postası ve paylaşım metni aynı görünümden.
Görecekleri: mülk adı/adresi, devir saatleri (resmi çıkış, "misafirin bildirdiği" çıkış, sonraki giriş + onaylanmış
erken giriş saati), checklist, foto, not, sorun bildir. Göremeyecekleri: misafir mesajı/adı/iletişimi, fiyat/ücret/
ödeme/rapor/ayar (bugün de kapalı; sızıntı noktaları ↑C-12 kapatılır). Hesap: yönetici "Ekip" davetiyle (rol sabit
`staff`, kullanılamaz parola + parola belirleme bağlantısı, e-posta doğrulanır); kaldırma = SİLME değil devre dışı
(oturum sayacı artar) — READY kanıtının yazarı kaybolmasın. **Kimlik akışı → kurucu onayı + ilk denemeler birlikte;
bayrak kapalı gelir.**

**Uygulanan (dilim 3, 09-24):** misafir verisi sızıntısı kapandı — tek kural `lib/tasks/staff-view.ts` (sistem görevi →
tür adı; yapay zekâ görevi → yalnız kendi "Tür: konu" başlığımız, açıklama yok; elle görev → aynen). Uygulandığı
yerler: personel görev listesi + görev güncelleme cevabı, personele atama e-postası, görev panosu kartı
(`card-data.ts`), temizlik listesi (WhatsApp / kopyala — alıcısı temizlikçi, her oturumda). Kalan: devir saatleri
kartı, iki adımlı "Daire hazır", kapalı-küme sorun bildirimi, varsayılan temizlikçi + atama, davet (kimlik akışı →
kurucu onayı).

## I. READY yaşam döngüsü / geçersizleşme

READY = BU devrin temizlik görevinde kimlikli (`userId` dolu) `done` kaydı. Geçersiz (sayılmaz) eğer:
1. aynı gün devirde işaret devir gününde değil (dünkü işaret bugün sayılmaz);
2. <5 dk (geri alma penceresi);
3. devir kümesinde açık görev var (yeniden açılmış, "kontrol bekliyor" dahil) ya da açık sorun/bakım görevi var;
4. işaretten sonra aynı devirde "yeniden aç" ya da olumsuz bildirim geldi;
5. ayrılan konaklama değişti ve görev o güne ait değil (`dueAt` senkronu ile eski işaret düşer);
6. çakışma / yeni işgal (rezervasyon düzeyi) — READY çakışmayı ASLA geçmez;
7. beklenen çıkıştan önce atıldı ve (bağlı görev ∧ aynı gün "başladım" ∧ host rızası) şartı yok;
8. yazar yok (sistem kaydı) — yalnız insan işareti sayılır.

Temizlikçi akışı: Başladım (`in_progress`) → Temizlik bitti (isteğe bağlı kontrol: `awaiting_review`) → **Daire hazır**
(`done`, iki adımlı onay). Bayat işaret günü gelince "bugün için yenile" ile yeniden onaylanır.

## J. En erken OTOMATİK onay saati

Mevcut `earliest` alanı AYNEN bu anlamdadır: daha erken istek reddedilmez, host'a gider (`before_window`). Değişen:
formdaki ad "Otomatik onay için en erken saat" + açıklama; misafire/modele söylenmez (taban gibi okunur). Mülk
düzeyinde kalır (≈10 mülk; org varsayılanı + ezme öncelik belirsizliği ve bozuk satırda sessiz geri düşme getirir) —
"tüm mülklere kopyala" kolaylığı yeterli.

## K. Ücret bağlantısı

Tek kaynak kuraldaki `fee`. Onay metninde kodda biçimlenir. Bilgi sorusu ("ücretli mi?"): koddan kurulan POLİTİKA
metni (ücret + "uygunluk o günün temizliğine bağlı, ev sahibinizin kararı") — izin vermez, ret etmez, söz vermez;
yalnız kural `auto` iken otomatik. Model yazdığı cevaplarda (taslak) tutar geçerse DETERMİNİSTİK eşleştirme: erken
giriş bağlamında her para tutarı kuraldaki tutara EŞİT olmalı; indirim/muafiyet/pazarlık ifadesi → tut (kurucu
senaryo 16-17). Ücretin modele salt-okunur verilmesi bu eşleştirme gelmeden AÇILMAZ (09-24 incelemesi: bekçi açılınca
iki model ertelemesiyle yanlış tutar/indirim gidebilirdi — ilk sürüm geri alındı, yama saklı).

**Uygulandı (dilim 8, 09-24):** hassas istekte modelin yazdığı cevabın gidebildiği TEK yol iki modelin doğruladığı
ertelemedir; o erteleme para söylüyorsa gerekçe `price_claim` (kanal → taslak, QR → devir). Birleşim, ikisi de yalnız
sıkılaştırır: biçim dedektörü `ai/stay-money.ts` (para sembolü `\p{Sc}`, kod/ad, yüzde, dar indirim-muafiyet sözlüğü;
yedi dil; `ai/claim-support.ts` KULLANILMAZ) ∨ bekçinin yeni zorunlu alanı `reply_states_price` (eksik = bekçi düştü).
Host'un teklif metni aynen aktarılırsa muaf; ücretin VARLIĞINDAN tutarsız söz ("olası ücret") para değildir. Öncelik:
izin/takvim iddiası (`availability_claim`) → ertelenmemiş istek (`availability_unconfirmed`) → para (`price_claim`).
Doğrulanmış onay metni (kodda, kuralın ücretiyle) muaf ve `price_claim` tutuşunda da onun yerine geçebilir. Bugün izinli
tutar kümesi BOŞ (modele ücret verilmiyor); kural modele açılırken kuraldaki tutar izinli kümeye girer. Kanıt: `lx` `m`,
`gv` `p`. Kırmızı-önce: eski kodda "€99" uyduran erteleme taslak kuralında GİDİYORDU (senaryo 16b).
**İnceleme turu (09-24):** bekçi artık TUTARLARI çıkarır (`reply_amounts`) + tutar dışı fiyat sözü (`reply_price_terms`),
kıyas KODDA (saat yuvalarıyla aynı ilke) — host'un geç çıkış teklifinin tutarı YALNIZ geç çıkış isteğinde izinli, çeviride
ve kısmi aktarımda da (aynı tutar + birim); teklifi erken giriş / ek gece isteğine aktarmak para ifadesidir. Para birimi
sözlüğü tek kaynak `money-lexicon.ts` (iddia desteği gölge ölçümü de okur). Bekçi redaksiyonla uzayan taslağı tam
göremezse hüküm vermez. Kör batarya (ayarsız): para 109/139, temiz 137/138, tutarsız ücret sözü 28/28; ayar sonrası
(görülmüş) 130/139 · 138/138 · 28/28 — kalan 9 serbest anlatım bekçinin işi. Reddedilen: kontrolü hassas olmayan
cevaplara genişletmek (çevrilmiş teklif aktaran çıkış saati cevapları üretimde tutulurdu; genel tutar doğrulaması P5).

**Bilgi sorusu (dilim 6, senaryo 10b):** anlama katmanı VE bekçi koşup "istek yok" der, tek sinyal cevap modelinin
`early_checkin` konu etiketi, tek konu ve host kuralı `auto` + KAYITLI ücret → koddan kurulan politika metni ("Erken giriş
ücreti X. Erken girişin mümkün olup olmadığı o günkü temizliğe bağlıdır; kararı ev sahibiniz verir." + host notu) gider;
kapı bu metinle baştan koşar, gerekçe `early_checkin_policy`. Ücret kaydı yoksa metin YOK ("ücretsiz" varsayılmaz).
Anlam katmanları kapalıyken (bugünkü üretim) bilgi sorusu kanıtlanamaz → davranış değişmez.

## L. Kural deposu — AutomationRule (şimdilik) + tipli depo

`rules.ts` ZATEN tipli depodur: karar motoru `EarlyCheckinRule` alır, satırı görmez. Uygunluk: org kapsamı ✓, mülk
kapsamı (koşul JSON'u) ✓, tür (`triggerType`) ✓, açık/kapalı ✓, bozuk = kapalı ✓, zaman damgası ✓. Eksikler (migration
GEREKTİRMEDEN kapatılır): eşzamanlı kayıtta çift satır (mülk satırı `FOR UPDATE` ile kilit), `isEnabled` okuma aynası,
sürüm = satır `updatedAt` + içerik özeti (denetime yazılır), mülk silinince kural satırı da silinir, yeniden
değerlendirme deposu atlayıp JSON'u kendisi okuyor (depo fonksiyonu). Ayrı tabloya geçiş: org varsayılanı, ikinci tipli
kural ya da kural GEÇMİŞİ gerçekten gerekince, bir sonraki onaylı migration paketinde (`INSERT … SELECT`), karar motoru
DEĞİŞMEDEN.

## M. Migration

Bu turda migration GEREKMİYOR: READY/sorun/başladım = Task + TaskUpdate; kural = AutomationRule; denetim = RiskEvent
kanıtı; personel = User (`staff`). Misafirin çıkış kanıtında duruş/zaman gerekirse ileride Reservation'a üç nullable
kolon (duruş, gözlem anı, kaynak mesaj) — saklama/silme bloklarına bağlanarak; bugün güvenlik için gerekmez (beyan
yalnız sıkılaştırır). Railway riski: başarısız `migrate deploy` açılışı düşürür (QR, oto-yanıt, webhook) + her migration
push'u taze `pg_dump` + kurucu onayı ister.

## N. Birleşim kuralının son hâli

Risk TESPİTİ birleşimdir (değişmez): hiçbir katmanın "istek yok"u başka bir katmanın isteğini silmez. ONAY birleşim
DEĞİLDİR: yalnız deterministik doğrulanmış koşullar + kodda kurulan metin; hiçbir modelin "evet"i kapı atlatmaz.
Bilgi/politika metni de kodda kurulur ve izin vermez. Model yazdığı her cevap: kapı + deterministik sayı/saat/gün
eşleştirmesi (karar kapsamındaki olgular dışında saat/tutar/tarih → tut).

## O. Anlama şeması (zaman/olay/aktör/duruş)

`events[]` (strict, yalnız enum): olay `checkout_departure | early_checkin_request | arrival_eta | luggage_drop |
luggage_pickup | travel | other`; aktör `writer | other_person`; duruş `question | request | planned | tentative |
declared | completed | withdrawn`; saat `HH:MM|null` (`normalizeHhmm`); gün `{rel_days, weekday, month, day}|null`.
Yazarın ayrılan/gelen misafir olduğu KODDA (konuşmanın rezervasyonu) belirlenir. Bavul/havalimanı/yolculuk saati
ASLA çıkış kanıtı değildir. Tanınmayan değer: izin verdiği yerde düşer, kısıtladığı yerde "bilinmiyor" sayılır.
Redaksiyon aynen (tarih/saat dizileri korunur; enum serbest metin eklemez).

## R. Bağımsız düşmanca inceleme (dilim 1, 09-24) — bulgular ve karar

| Bulgu | Önem | Karar |
|---|---|---|
| "Başka gün" kontrolü TR ekli adları ("Cumartesiye", "15 ekimde"), büyük İ ("15 EKİM"), Arapça hareke ("غدًا") ve gün adlarını, aynı adlı "next Wednesday"i, "iki gün sonra"yı, ABD tarihini ("10/15") kaçırıyordu → yanlış günün onayı otomatik gidebilirdi | P1 | **DÜZELTİLDİ** — sözcük bazlı, en uzun ad kazanır, TR ek ≤5, iki okumalı eğik çizgi; yanlış alarm sınırları da (завтрак, غداء, среди) |
| `pending` hiç gelmeyecek kanıtı bekliyordu (rızasız beklenen çıkış, bilinmeyen çıkış saati) | P2 | **DÜZELTİLDİ** — ↑F |
| Çıkıştan önceki kanıt konaklama içi ek temizlik görevinden gelebiliyordu | P2 | **DÜZELTİLDİ** — yalnız yaşam döngüsü çıkış temizliği |
| Geri alınmış "başladım" kanıt sayılıyordu | P2 | **DÜZELTİLDİ** — "bitti"nin HEMEN önceki kaydı |
| Panel dün gece doğrulanamadı nedenini gizliyordu | P2 | **DÜZELTİLDİ** |
| Açık sorun: gelen konaklamaya bağlı bakım, temizlikçinin notu, bağsız bakım görülmüyordu | P2 | **DÜZELTİLDİ** — gelen konaklama → host; not/bağsız bakım → yalnız otomatik durur |
| Yarım/çeyrek saat anlatımları yanlış okunuyordu; cümle sonundaki saat anma sayılmıyordu | P3 | **DÜZELTİLDİ** |
| Saat okunamayınca kontrol açık kapı geçiyordu | P3 | **DÜZELTİLDİ** (`clock_unknown`) |
| Maske metni uzatınca "tamamı okunmadı" kaçabiliyordu | P3 | **DÜZELTİLDİ** (100 karakter pay) |
| Geçmiş taraması yeni kimlik/son-durum şartını uygulamıyor ("tek kaynak" iddiası) | P3 | **BELGELENDİ** — tarama üst sınır sayar; sorgu verisi kimlik taşımıyor |
| Yeniden değerlendirme sonrası, onay yerine gecikmiş bir "ev sahibine soracağım" gidebilir (bekçi açıkken) | P3 | **DÜZELTİLDİ (dilim 6)** — yeniden değerlendirme turunda (aynı mesaj daha önce yalnız hazırlık yüzünden tutulduysa; ölçüt taramanınkiyle aynı) YALNIZ doğrulanmış onay gider |

## S. Eşzamanlılık / TOCTOU (dilim 2, analiz + karar)

| Aralık | Ne değişebilir | Karar |
|---|---|---|
| Model çağrıları (sn) | temizlik, rezervasyon, kural | Olgular model çağrılarından SONRA, kapı kararından hemen önce okunur (aynı geçiş). |
| Karar → doğrudan gönderim (ms–sn) | temizlikçi görevi yeniden açar, eşzamanlı senkron yeni çakışma getirir | Yeniden okuma YOK — kabul edilen kalan risk (pencere, olguların okunduğu geçişle aynı); çift gönderimi `claim` (CAS) engeller. |
| Karar → KUYRUKLU teslim (dk–gün; 402 → bloklu, geri çekilme) | her şey; onay "bugün (14 Ekim)" der | **Otomatik onay YOK** (`queued_delivery`, bayrak kapalıyken etkisiz): kuyruk işçisi onayı yeniden doğrulayamıyor. İşçide yeniden doğrulama ayrı iş. |
| Bekleyen istek → temizlik bitti | — | Yeniden değerlendirme KARAR VERMEZ; tüm hat (model + kapı + olgular) baştan koşar. |
| Kural kaydı ↔ kural kaydı | iki sekme / çift tık | Mülk satırı `FOR UPDATE` → yazımlar sıralanır, tek satır. |
| Görev durumu ↔ geçmiş kaydı (atomik değil, C-17) | durum "bitti", kayıt düşmüş | "Bitti" kanıtı yok → hazır DEĞİL (güvenli yön); atomik yazım dilim 4. |

## U. Denetlenebilirlik (dilim 2)

Karar kaydı (`RiskEvent.kbEvidenceJson.ec`): `s` durum · `f` düşen kontroller · `a` otomatik gitti mi · `dr` hazırlığın
ölçüldüğü devrin rezervasyon kimliği · `rm`/`rt` hazır hükmünü veren "bitti" kaydının kimliği ve anı (dakika) · `rh`
kural içerik parmak izi (12 hex) · `n` istenen saati okuyan model sayısı · `dc` hazırlık çıkıştan önceki kanıtlı
işarete dayandı (önceki misafirin çıkışı doğrulandı). Metin / saat / tutar / misafir verisi YOK (onaylanan saat ve
tutar giden mesajdadır). Her alan `grounding.ts`te AYRI doğrulanır: bozuk dayanak yalnız kendini düşürür; `s/f/a`
bozuksa `ec` hiç yazılmaz. Kural yerinde güncellendiği için `rh` "karar anındaki kural bugünkünden farklı mı"yı
cevaplar; tam kural geçmişi ayrı tablo ister (L). Denetim kaydı (kural değişimi) değer değil alan adı taşır (kural).

## P–X. (tur sonunda doldurulur: Set B bulguları, oranlar, mutasyon, kapılar, üretim etkisi, push)
