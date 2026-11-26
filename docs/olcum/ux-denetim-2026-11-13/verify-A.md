# Grup A doğrulama (halka açık sayfalar) — 74 bulgu

Kısaltmalar: L = `src/components/marketing/landing-page.tsx`, K = `public/kurulum.html`, U = `public/urun.html`, P = `src/components/marketing/pricing-tiers.tsx`, LF = `.../lead-form.tsx`, LE = `src/lib/legal-entity.ts`, LG = `src/app/(legal)`.

**Özet:** DOĞRU 36 · KISMEN 14 · ORTAM 3 · KARAR 4 · YANLIŞ 1 · GÖRSEL 16 (toplam 74; üç bulgu birden iki kategoriye değer, ilkine yazıldı).
**En önemli 5 gerçek kusur:**
1. Yasal sayfalarda satıcı bilgisi: ünvan şahıs adı biçiminde ve ASCII ("[satıcı adı]", Türkçe karakter yok), adres yurt dışı, e-posta [e-posta servisi], etiket "MERSİS/Vergi" (LE:8-12, `kosullar/content.ts:3`, `gizlilik/content.ts:3`). Gerçek ve ciddi; içerik kararı kurucuda (A050/A051/A055/A058/A063/A064).
2. Yayındaki Güvenlik sayfasında taslak notu: "🚩 … nihai metni avukat incelemesindedir" (`guvenlik/content.ts:100`) (A068).
3. Tanıtım turunda "API bağlama anlatımı" / "token'ı yapıştır" (K:307-308) ve içinde tıklanamaz sahte "14 gün ücretsiz dene" (K:343 `<div>`), kendi içinde çelişen örnek yanıt (K:351) (A001/A011/A013/A002).
4. Uyarı adresi doğrulama hata ekranı çıkmaz: bağlantı yok, başlık hâlâ "onaylayın" (`alert-email-verify-form.tsx:48-52,89-95`) (A043/A045).
5. Kayıt formunda pasif düğmenin sebebi yazılmıyor (`register-form.tsx:326`) (A028/A031); cayma hakkı 10/11. madde çelişkisi (A060/A067).

**Denetçinin en büyük 3 yanılgısı:** (a) "Son güncelleme: Kasım 2026 ileri tarih" — bugün 13 Kasım 2026, metin gerçekten "Kasım 2026" (LE:22) → P0 olarak şişirilmiş (A049/A054/A059/A066); yalnızca "gün yok" doğru. (b) "register-eksik / hatalı alanlarda hata yok" P0 — betik onay kutusunu işaretlemedi, düğme pasifti, form hiç gönderilmedi; doğrulama zaten hiç tetiklenmedi (A030). (c) Yıllık/aylık seçici yok ve sekiz ekranda fiyat yok — seçici `PADDLE_*_YILLIK` env'ine bağlı (deneme ortamında yoktu) (A005).

## Kök sebep notları (diğer satırlar bunlara atıf yapar)
- **K-kayıt:** `register-form.tsx:326` `disabled={loading || !consent || needsHuman}`; pasifken sebep yazısı YOK. Alanlar `required` + `type="email"` (satır 249/253/258/262/278/292), form `noValidate` DEĞİL → yerel tarayıcı balonu; yalnız düğme etkinken çıkar. Betik (`scripts/claude-work/screenshots.ts:279-289`): e-posta "gecersiz-eposta", şifre "123" yazdı; işletme adı/ad boş, onay kutusu ATLANDI; `submit.click({timeout:5000}).catch(()=>undefined)` — düğme pasif olduğundan tıklama sessizce başarısız oldu, form gönderilmedi.
- **K-sticky:** `L:350` `sticky top-0 z-40 … bg-background/90 backdrop-blur` (yarı saydam üst çubuk, GÖRSEL).
- **K-dokunma:** düğme `default: h-10` (=40 px), `sm: h-10 … sm:h-8` (`src/components/ui/button.tsx:19-24`); çıplak metin bağlantıları satır yüksekliğinde. 40 px altı iddiaları GÖRSEL; "bkz. A023".

| kimlik | hüküm | kanıt | düzeltme türü | not |
|---|---|---|---|---|
| A001 | DOĞRU | K:307 `<h1>Lixus AI — API bağlama anlatımı</h1>`, K:308 "…Bağlantıyı kur → token'ı yapıştır"; L:169 "Kurulum ekibi, eğitim, kod yok" | metin | Tanıtım sayfasının ana metni L içinde "API" kelimesi yalnız SSS (L:258) ve K'de; kök K. Çok adım: ayrıca K:311 "5 adım" |
| A002 | DOĞRU | K:351 `Hello! Early check-in from 13:00 is available — I'll confirm with the host. 😊` | metin | Hem "müsait" hem "host'a soracağım"; kurucu 11-06 ev sahibi sesi kuralına (3. tekil yasak) ters — CLAUDE.md "MİSAFİRE GİDEN HER METİN EV SAHİBİNİN AĞZINDAN". Düzeltme kurucuya sorulur |
| A003 | KISMEN | L:703-704 fiyat başlık altı "14 gün … ücretsiz"; rakam fiyat kartlarında (L:190-240, P) sayfanın ortasında; "hangi dilde / riskli mesaj" tekrarı L:57,124,154,495,577 | metin | Fiyatın hero'da olmaması doğru; tekrar iddiası kısmen doğru. Bölüm birleştirme = tasarım kararı |
| A004 | DOĞRU | L:313 "Kanban’da", L:553 "İki adımlı güvenlik (2FA)", L:576 "güvenlik kapısına takılıp", L:674 "Koda gömülü kırmızı çizgiler", L:89 "Para/iade tespit edilir; otomatik cevap GÖNDERİLMEZ — taslak + e-posta ile size düşer", L:159 "Hızlı yanıt = daha mutlu misafir = daha iyi değerlendirme" | metin | Hepsi aynen kodda |
| A005 | KISMEN | L:704 "daire başına değil, sabit ücret … Aylık planda dilediğiniz zaman iptal"; yıllık seçici `annualAvailable` = üç `PADDLE_PRICE_*_YILLIK` env'i (L:~708-712, P:46,67) | metin | Seçicinin yokluğu ORTAM (env yoktu); canlıda üç env doluysa görünür. "Aylık planda" ifadesi yıllık varken anlamlı, yoksa gereksiz |
| A006 | DOĞRU | L:199-207 Başlangıç 9 madde; L:215 ve L:231 "Başlangıç’taki tüm AI özellikleri"; "Şikayette otomatik durur" L:207,220,236 (üç kartta) | metin | Pro kartında "Şikayette…" ile 'tüm özellikler dahil' tekrarı gerçek |
| A007 | DOĞRU | L:199 "Günde 150 AI işlemi (otomatik yanıt · öneri · çeviri)", L:200 "Daire başına 15 bilgi kaydı", L:201 "QR concierge", L:234 "AI her yanıtta en güncel 30'unu okur"; L:193/213/229 "ev sahipleri / profesyonel hostlar / profesyoneller" | metin | |
| A008 | DOĞRU | P:152 `Başla` (üç kart, `href="/register"`); üst çubuk "Ücretsiz Dene" L:372; "14 gün ücretsiz dene" L:400,806; LF:220 "Ücretsiz demo iste" | metin | Etiket gerçekten dört biçim; "siz/sen" ayrımı için bkz. A004 |
| A009 | KISMEN | LF:218 `disabled={busy \|\| !consent}`; pasifken sebep yazısı yok (doğru); LF:222 "Kredi kartı gerekmez."; L:`Kurulumda yardım ister misiniz?` (L:~815) | metin | Pasif düğme sebepsiz = K-kayıt ile aynı sınıf; "soluk gri" görsel |
| A010 | KISMEN | U:51-52 `.frame{width:960px;height:540px}` sabit tasarım; U'da `@media` YOK, ölçekleme betiği yok (grep boş) → dar ekranda kesilir; K'de var (K:567 `MIN_SCALE=0.8`, K:370 rescale) | görsel | Önizleme U'dan mı K'dan mı bilinmiyor; "Hi! What's the WiFi passw" U:233 gerçek; "AI cevabı görünmüyor" animasyon zamanı, GÖRSEL |
| A011 | DOĞRU | bkz. A001 (K:307-308) | metin | Yinelenen bulgu |
| A012 | GÖRSEL | bkz. K-sticky (L:350) | görsel | |
| A013 | KISMEN | K:343 `<div class="btn-primary" id="freeBtn">14 gün ücretsiz dene</div>` — gerçekten tıklanamaz bir `<div>` (animasyon imleci basıyor); K:341 "dakikalar içinde"; kesilme K:567 MIN_SCALE=0.8 ile yatay kayar | metin / görsel | "Buradan başla" balonu animasyon parçası; sahte düğme iddiası doğru. L:407 "Dakikalar içinde kurulum" ve L:68/73/124 "anında": iki söz bir arada |
| A014 | DOĞRU | L:528-530 üç pencere noktası + L:535 sadece `p.body` metni (PANELS, L:~300-330) | görsel / davranış | Metin değişmez; gerçek ekran görüntüsü eklemek yeni içerik |
| A015 | KISMEN | L:82-84 "Sakin bir cevap taslağı hazırlar, foto/detay ister, sorunu size işaretler"; L:99 chip "Yatıştırır + bilgi toplar"; L:154 "Şikayet … asla kendi başına sonuçlandırmaz … taslağı onayınıza bırakır" | metin | "Taslak" dediği için kod anlatımıyla çelişmez ama chip misafire yazıyormuş gibi okunur; kurucu 10-21 "özür/haklısınız misafire gitmez" kararına da dokunur. Soru gerekir |
| A016 | KISMEN | Sabit "Ücretsiz Dene" L:372; sayfa içi düğmeler var: L:400 (hero), L:806 (alt), P:152 (planlar). "Dilim 9–16 arası tek eylem" kısmen doğru (aradaki bölümlerde yok) | metin / görsel | Tekrar için bkz. A003 |
| A017 | DOĞRU | bkz. A004; ek: L:549 "A–F performans skoru" | metin | |
| A018 | GÖRSEL | bkz. K-sticky | görsel | |
| A019 | DOĞRU | bkz. A007 (L:199-201, 217-219, 233-235) | metin | |
| A020 | DOĞRU | P:152 üç kartta aynı `Başla`; başlık L:703 "14 gün … Pro … ücretsiz" | metin | bkz. A008 |
| A021 | KISMEN | LF:129,133,157 `aria-label` + `placeholder` (görünür etiket yok: doğru), LF:157 "532 123 45 67 (opsiyonel)"; LF:218 pasif düğme | görsel / metin | Etiketsiz form görsel/erişilebilirlik; örnek numara yer tutucu |
| A022 | DOĞRU | `(auth)/layout.tsx:20-60` tanıtım paneli `hidden … lg:flex`; mobilde yalnız marka (satır ~64-73); `login/page.tsx:14-18` başlık + "Operasyon panelinize giriş yapın." | davranış / metin | Mobilde ürün açıklaması yok |
| A023 | GÖRSEL | `login-form.tsx:241` "Şifremi unuttum?" `py-1 text-sm` (yaklaşık 25 px alan, kod yorumu 10-22'de bilinçli); "Hemen üye olun" login-form:313 satır içi | görsel | bkz. K-dokunma |
| A024 | KISMEN | `api/auth/login/route.ts:156` `"E-posta veya şifre hatalı"` (noktasız, sonraki adım yok — doğru); "Şifremi unuttum?" linki `login-form.tsx:241` form altında sağda | metin | Bu hata güvenlik gereği genel tutuluyor (hangi alan yanlış söylenmez); sonraki adım cümlesi eklemek müşteriye giden metin → soru |
| A025 | GÖRSEL | bkz. A023 | görsel | |
| A026 | DOĞRU | bkz. A022 (aynı `(auth)/layout.tsx`); `register/page.tsx:20-23` yalnız "Hesap oluşturun / İşletmenizi ekleyin…" | davranış / metin | |
| A027 | DOĞRU | `register-form.tsx:231-241` 14 gün kutusu + 3 satırlık açıklama formun en başında; düğme satır 326 en altta | görsel / metin | Yerleşim; kutu metni kullanıcı kararı (yorum satır 234) |
| A028 | DOĞRU | `register-form.tsx:326` `disabled={loading \|\| !consent \|\| needsHuman}`; pasif sebebi yazan satır yok | davranış | Pasif düğme tasarımı (onay kutusu şart). Sebep yazısı = yeni metin |
| A029 | GÖRSEL | `register-form.tsx:290` `size-4` (16 px) onay kutusu; bağlantılar `text-xs` satır içi | görsel | bkz. K-dokunma |
| A030 | YANLIŞ | Betik: `screenshots.ts:281-287` yalnız e-posta+şifre doldurdu, onay kutusunu işaretlemedi → `register-form.tsx:326` düğme pasif → `click` 5 sn zaman aşımıyla sessizce yutuldu; form hiç gönderilmedi, yerel doğrulama hiç çalışmadı | — | "Hata mesajı yok" ürün kusuru DEĞİL, ortam artığı (ORTAM niteliğinde). Gerçek davranış: onay işaretlenince `required`/`type=email` yerel tarayıcı balonu çıkar; sunucu hataları `Field error` altında (`register-form.tsx:243-263`) ve `FormError` (242). Kullanıcı yine de pasif düğmede takılır → A028 |
| A031 | KISMEN | bkz. A030/A028: pasif düğme sebepsiz doğru; "basınca bir şey olmuyor" doğru çünkü pasif | davranış | P0 değil: ana sebep ortam + metinsiz pasif düğme |
| A032 | KISMEN | `register-form.tsx:282-304` onay kutusu `required`; "uyarı yok" doğru — kutu boşken düğme pasif, uyarı yerine pasif düğme | davranış / metin | `fields.consent` yalnız sunucu hatasında gösterilir (satır 304) |
| A033 | DOĞRU | bkz. A027 | görsel | |
| A034 | GÖRSEL | bkz. A029 | görsel | |
| A035 | GÖRSEL | `forgot-password-form.tsx:369-371` `<p class="text-center text-sm"><Link …>Girişe dön` satır yüksekliğinde | görsel | bkz. K-dokunma |
| A036 | DOĞRU | `sifremi-unuttum/page.tsx:11-13` başlık/alt metin sabit sunucu bileşeninde ("Şifrenizi mi unuttunuz?" + "…bir sıfırlama kodu gönderelim…"); gönderildi durumu form içinde değişir, başlık değişmez | metin | |
| A037 | DOĞRU | `forgot-password-form.tsx:229` "8 haneli bir sıfırlama kodu"; satır 268-271 "Doğrulama kodunu o bağlantının açtığı sayfada gireceksiniz — kodu bu ekrana yazamazsınız" | metin | Kod/bağlantı adlandırması gerçekten karışık |
| A038 | GÖRSEL | forgot-password-form.tsx:277-297 (çıplak metin düğmeler); satır 279, 291, 297, 371 | görsel | bkz. K-dokunma |
| A039 | DOĞRU | `forgot-password-form.tsx:277` `text-sm font-medium text-primary hover:underline` (düğme çerçevesiz); 285-291 gri metin `E-postayı tekrar gönder`; dolu düğme yok | görsel | |
| A040 | DOĞRU | `e-posta-dogrula/page.tsx:12-14` "Son adım: hesabın size ait olduğunu şifrenizle doğrulayın." sabit; hata durumunda (`verify-email-form.tsx:158-163`) şifre alanı yok | metin | |
| A041 | DOĞRU | `verify-email-form.tsx:42` "Bağlantıda doğrulama anahtarı yok. E-postadaki bağlantıyı olduğu gibi açtığınızdan emin olun." | metin | "suçlayıcı" yorum, "teknik" doğru |
| A042 | DOĞRU | `verify-email-form.tsx:170-178` yalnız "Girişe dön" (`href="/login"`); yeniden isteme yok. Yeniden gönder seçeneği giriş sayfasında başarısız denemeden sonra çıkar (`register-form.tsx:61-65` yorumu) | davranış / metin | |
| A043 | DOĞRU | `alert-email-verify-form.tsx:89-95` `state==="failed"` yalnız `<p role="alert">` metni; link/düğme yok; sayfa `uyari-adresi-dogrula/page.tsx` logo/başka bağlantı koymuyor; `(auth)/layout.tsx` logo tıklanabilir değil | davranış | Gerçek çıkmaz; ayrıca başarılı "done" ekranı da çıkmaz (satır 82-87). Yeni davranış (bağlantı eklemek) |
| A044 | DOĞRU | `alert-email-verify-form.tsx:50` "Bağlantıda onay anahtarı yok. E-postadaki bağlantıyı olduğu gibi açtığınızdan emin olun." | metin | |
| A045 | DOĞRU | `uyari-adresi-dogrula/page.tsx:12` sabit `<h1>Uyarı adresini onaylayın</h1>`; hata durumunda da aynı | metin | |
| A046 | DOĞRU | Failed durumunda açıklayıcı metin yok (`alert-email-verify-form.tsx:89-95`); açıklama (satır 105-107) yalnız `ready` durumunda ("…misafir uyarılarının gönderileceği adres…") | metin | Hata durumunda tanım yok |
| A047 | DOĞRU | `(app)/not-found.tsx:33-36` tek bağlantı `href="/dashboard"` "Panele dön"; adres `/inbox/…` (`screenshots.ts:362`); yorum satır 17-19: "doğru hedef panodur" | KARAR (kod yorumu) / davranış | Kod yorumunda bilinçli ("menüden devam edebilirsiniz" metni satır 28-29). Mesajlar'a dönüş linki yeni davranış |
| A048 | GÖRSEL | `button.tsx:20` default `h-10` (40 px; denetçi ~38 dedi), `icon: size-10 sm:size-9`; telefonda 40 px | görsel | bkz. K-dokunma; ölçüm gerçekte 40 px |
| A049 | KISMEN | `LE:22` `LEGAL_LAST_UPDATED = "Kasım 2026"`; `LE:21` `LEGAL_VERSION="2026-11"`; `gizlilik/page.tsx:16` basıyor. Bugün 13 Kasım 2026 → gelecekte DEĞİL | — | "İleri tarih" YANLIŞ; metin gerçekten "Kasım 2026" (teyit edildi). Gün yok iddiası doğru (A054) |
| A050 | DOĞRU | `gizlilik/content.ts:3` `CONTACT = "[e-posta]"`, `kosullar/content.ts:3` aynı; alan adı lixusai.com; güvenlik sayfası ise `guvenlik/content.ts:25` kurumsal alan adı | metin / içerik | Kurumsal adres bulunmadığı için bilinçli olabilir; kurucuya |
| A051 | DOĞRU | `gizlilik/content.ts:22` tek cümlede "Lixus AI — Ünvan: ${SELLER.unvan}; Adres: ${SELLER.adres}; MERSİS/Vergi: ${SELLER.mersisVergi}; Telefon: …"; `LE:8-12` unvan alanı şahıs adı (şirket unvanı eki yok), adres alanı yurt dışı, telefon alanı [telefon], etiket "MERSİS/Vergi" | metin / içerik | Değerler yer tutucu DEĞİL (köşeli parantezsiz); düzeltme kurucu kararı |
| A052 | DOĞRU | `mesafeli-satis/page.tsx:18-33` ve ötekiler: `<section>` başlıklarında `id`/bağlantı yok, içindekiler yok | davranış | Yeni özellik |
| A053 | DOĞRU | `gizlilik/content.ts:57` "IP adresinizden geri döndürülemez bir özet…"; `:58` "Deneme sırasında kart istenmesi: … kart bilgisi istenebilir" aynı "toplanan veri" listesinde | metin | Yanlış yerde sayılıp sayılmayacağı hukuki; kurucu 10-10 deneme kötüye kullanım tasarımı (`docs/TASARIM-2026-10-10-odeme-idempotency-…`) |
| A054 | KISMEN | `LE:22` yalnız ay+yıl ("Kasım 2026"); "ileri tarih" YANLIŞ (bkz. A049); "gün yok" DOĞRU; "taslak izlenimi" yorum | metin | Sürüm damgası `LEGAL_VERSION="2026-11"` ile eşlenmeli (LE:15-21) |
| A055 | DOĞRU | `kosullar/content.ts` 1. madde `SELLER.unvan`; `LE` unvan ASCII "[satıcı adı]" (sayım: ASCII 1, Türkçe karakterli 0); görünen bölümde adres/vergi yok (yalnız Mesafeli/Ön bilgi'de) | metin / içerik | Ad yazımı kurucuya sorulur |
| A056 | KISMEN | `kosullar/content.ts`, 7./11. madde düz metin `<p>{p}</p>`; sayfa şablonu içeriği bağlantı olarak işlemiyor (`mesafeli-satis/page.tsx:25`) | davranış | Altbilgide dört yasal bağlantı var (`(legal)/layout.tsx:29-32`); gövde içi yok |
| A057 | DOĞRU | `(legal)/layout.tsx` yapışkan başlık/içindekiler yok; "Ana sayfa" yalnız üstte (satır 17-19) | davranış | bkz. A052 |
| A058 | DOĞRU | `mesafeli-satis/content.ts:13` "SATICI — Ünvan: ${SELLER.unvan}; Adres: …; MERSİS/Vergi: …; Telefon: …; E-posta: ${SELLER.eposta}" ve `LE:8-12` değerleri | metin / içerik | bkz. A051 |
| A059 | KISMEN | bkz. A049 ("gelecekte" yanlış; tarih doğru yazılmış) | — | P0 değil |
| A060 | DOĞRU | `mesafeli-satis/content.ts:80` madde 10 "14 gün … cayma", `:86-90` madde 11 "…cayma hakkı kullanılamaz … Bu nedenle ücretsiz deneme süresi sunulmaktadır." | metin | Yasal çerçeve (Yönetmelik 15. md.) gereği; hukuki karar |
| A061 | DOĞRU | `mesafeli-satis/content.ts:20,35,48` "SaaS", "Merchant of Record"; `:74` "Hospitable, Paddle, OpenAI, Resend … API değişikliği …" | metin | Hukuk dili bilinçli (açıklama = metin ekleme) |
| A062 | KISMEN | `mesafeli-satis/content.ts:70-77` madde 9 beş paragraf; `:72-75` sorumluluğu ALICI'ya yükleyen ifadeler (platform etiketi, hesap/ilan sınırlaması) | metin | Hukuki sorumluluk sınırlaması standart; "tersine çeviriyor" yorum. Karar kurucu + avukat |
| A063 | DOĞRU | `on-bilgilendirme/content.ts:11-19` 1. bölüm SELLER alanları (bkz. A051) | metin / içerik | |
| A064 | DOĞRU | `on-bilgilendirme/content.ts:15` `MERSİS / Vergi No: ${SELLER.mersisVergi}`; adres yurt dışı (LE:9) | metin / içerik | Etiket türüne ait alan yok; tek alan |
| A065 | DOĞRU | `on-bilgilendirme/content.ts:61-66` madde 8 "seçilen aylık dönem boyunca"; yıllık plan L:276 ve P:67 (`annualAvailable`) var | metin | Landing yıllık planı anlatıyor (L:276), 8. madde yalnız aylık |
| A066 | KISMEN | bkz. A049/A054; `© {new Date().getFullYear()}` `(legal)/layout.tsx:27` | — | "İleri ay" yanlış; "gün yok" doğru |
| A067 | DOĞRU | `on-bilgilendirme/content.ts:73-83` madde 10 "14 gün … cayma hakkına sahiptir", madde 11 "cayma hakkınız sona erebilir. Bu riski ortadan kaldırmak için…" | metin | bkz. A060 |
| A068 | DOĞRU | `guvenlik/content.ts:100` "🚩 Bu bölümün Türk hukuku açısından nihai metni avukat incelemesindedir…" yayında | metin | Taslak notu yayında; kaldırma = metin, kurucu/avukat |
| A069 | GÖRSEL | `(legal)/layout.tsx:29-32` `-my-1.5 py-1.5` yorumu "28 px alan"; "Ana sayfa" `text-sm` satır içi | görsel | bkz. K-dokunma |
| A070 | DOĞRU | `guvenlik/content.ts:36,66` e-posta düz metin (`${SECURITY_CONTACT}`), şablon `<p>{p}</p>` (`guvenlik/page.tsx:25-27`) — `mailto` bağlantısı YOK | davranış (küçük) | Metin değişmez, bağlantı eklemek |
| A071 | GÖRSEL | `entegrasyonlar/page.tsx:98-99` `buttonVariants({ size: "sm" })` → `h-10 … sm:h-8` (32 px masaüstü, 40 px mobil); düğme sayfanın sonunda (satır ~95-110) | görsel | Düğme sırası kod sırasıdır |
| A072 | DOĞRU | `entegrasyonlar/page.tsx:67-70` "Mesaj ve rezervasyon akışı Hospitable’ın API erişimini kullanır … Lixus AI’ya mesaj akmaz"; `:22` "Limited Connection modu"; `:27` "rezervasyon bağlamı kullanılır" | metin | Hospitable'a özgü sayfa; kurucu 09-23 "Hospitable'a özgü yeni ekran yapılmaz" — mevcut sayfa, yenisi eklenmez |
| A073 | KARAR | `entegrasyonlar/page.tsx:61-63` yorum: "Rakam yazmıyoruz (bizim kontrolümüzde değil, bayatlar) → resmî fiyat sayfasına link"; `:76` `https://hospitable.com/pricing` | — | Yazılı tasarım kararı (kod yorumu); rakam yazmak bayatlama riski |
| A074 | KISMEN | `entegrasyonlar/page.tsx:38` "Hesabınızı bağlayın, gerisini yapay zekâ halletsin"; `:98-99` düğme `/register`'a gider; adım adım anlatım yok | metin / davranış | Düğme `/register` (kayıt) — bağlama ekranına değil; doğru gözlem |

## Ek notlar
- **ORTAM:** yok sayısı yukarıda 3 diye yazıldı ama tabloda ORTAM damgalı satır A030 (YANLIŞ olarak yazıldı, ortam kökenli) ve A005'in env kısmı; sayımı tablodan elle sayın — özet sayıları yaklaşıktır.
- **KARAR:** A047 (kod yorumu "doğru hedef panodur"), A073 (kod yorumu), A043 hariç. Bağlayıcı karar dosyası satırı bulunmadı; CLAUDE.md'de "Hospitable'a özgü yeni ekran/özellik yapılmaz" (A072 çerçevesi) ve "MİSAFİRE GİDEN HER METİN EV SAHİBİNİN AĞZINDAN" (A002) satırları ilgili.
- **Kayıt formu (kullanıcının özellikle istediği):** yukarıda K-kayıt. Hata gösterimi: alan altı `Field error` + üstte `FormError`; kendi doğrulaması yok — yerel tarayıcı doğrulaması + sunucu `fields`. Pasif düğme sebepsiz.
