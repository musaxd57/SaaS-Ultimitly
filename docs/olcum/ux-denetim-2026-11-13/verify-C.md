# Grup C doğrulama (60 bulgu; kod = wt-dev, yalnız okuma)

Özet: DOĞRU 24 · KISMEN 21 · ORTAM 4 · KARAR 0 · YANLIŞ 1 · GÖRSEL 3 · (kök sebebe bağlı "bkz." 7, KISMEN/DOĞRU sayılmadı: C005/C009/C016/C022/C032/C053/C055 kök sebep 1'e atıf; kök-sebep hükmü C003'te).
Gerçek kusurlar (en önemli 5): (1) Telefonda konuşma ayrıntısında cevap kutusu sayfa akışında; araç çubuğu + 52vh liste + 104px kutu sonrası "Gönder" aşağıda, yapışkan değil, tam ekran düğmesi yalnız lg (C008/C012). (2) Üst çubuk tema simgesi 32 px (`size-8`), hamburger 36 px, filtre çipleri/seçiciler/arama `h-8` = 32 px; çıkış telefonda 40 px, masaüstünde 32 px (C003/C005/C009). (3) Raporlarda skor, şikayet oranına yalnız %20 ağırlık veriyor; 3 konuşmayla "Mükemmel" etiketi çıkabiliyor, formül hiçbir yerde açıklanmıyor; "Açık Şikayetler" (konuşma durumu) ile "size bırakıldı" (olay günlüğü) farklı kaynaklar (C033/C034). (4) Mobil menü kaydırılıyor ama kaydırma ipucu yok; menü düz 14 madde, gruplama yok (C058-C060). (5) Şablon kartlarında ham `{{guestName}}` gösterimi, "Kendime uyarla" yalnız ~30 px, metin 3 satırda kesik ve açıklama yalnız form içinde (C029-C031).
Denetçinin büyük yanılgıları: (a) 127.0.0.1 bağlantısı ve "03:00 PM" ortam artığı (`type="time"`, APP_URL/Host allowlist); (b) "Mülk Hafızası 0 bilgi" seed'in doğrudan `createMany` yazmasından (hafıza tablosu KB rotalarıyla eşitlenir), (c) "Oto-yanıt: Kapalı" soluk etiket değil; `role="switch"`, "Açık/Kapalı/Kilitli" yazısı var; ayrıca simge düğmelerinin `aria-label`+`title`'ı ve tüm silmelerde onay penceresi var, denetçi göremedi.

KÖK SEBEP 1 (dokunma hedefi): `src/components/ui/button.tsx:22-26` size default `h-10`(40), `sm` `h-10 … sm:h-8` (telefonda 40, masaüstünde 32), `icon` `size-10 sm:size-9`; `input.tsx:10` ve `select.tsx:33` `h-10` (40). Yani ortak bileşenler telefonda 40 px (10-21 düzeltmesi, yorum button.tsx:21). Altında kalanlar yerel geçersiz kılmalar: tema düğmesi `panel-theme.tsx:52` `size-8` (32, her ekranda); hamburger `app-shell.tsx:~467` `p-2`+`size-5` = 36; çıkış `Button ghost sm` = 40x40 telefonda / 32 px masaüstü (`app-shell.tsx:481`); üst çubukta öğeler arası `gap-3` (12 px) — çıkış ile tema bitişik değil; inbox çipleri `inbox/page.tsx:311` `h-8`; arama `:343` `h-8`; konuşma Durum/Öncelik `conversation-thread.tsx:729` `h-8`; Şablonlar "Kendime uyarla" `template-manager.tsx:397` `py-1.5 text-xs` (~30). Not: 40 px "<40" sayılmaz; denetçinin "36-38 px giriş alanı" iddiası ortak bileşen koduyla UYUŞMUYOR (ölçüm aracı farklı olabilir). Düzeltme türü: görsel.

| kimlik | hüküm | kanıt | düzeltme | not |
|---|---|---|---|---|
| C001 | DOĞRU | `dashboard/page.tsx:209` OnboardingGuide sayfanın başında; `onboarding-guide.tsx:56` `collapsed` varsayılan false (yalnız önceki daraltma mount sonrası okunur) | görsel/yerleşim | demo org'da kart yok; yeni işletmede 6 adım açık |
| C002 | KISMEN | StatCard `href` ile `Link`+`card-lift cursor-pointer` (`stat-card.tsx:39,60`); pano 4 kartın 3'ünde href var (`page.tsx:253,285,294`), "Aynı Gün Devir" bağlantısız; liste satırları `Link` + hover (`page.tsx:413-418`), ok/"Aç" işareti yok | görsel | "tıklanabilir değil" yanlış, "belli değil" doğru |
| C003 | KISMEN | kök sebep 1; "Tümü" `page.tsx:395` `text-xs` ama `after:-inset-2` ile 8 px genişletilmiş vuruş alanı; daraltma düğmesi `onboarding-guide.tsx:168` `size-8`; tema `size-8` | görsel | 10 hedefin bir kısmı genişletilmiş alanla örtülü |
| C004 | GÖRSEL | `inbox/page.tsx:300-324` filtre çipleri `flex-wrap` + arama formu `flex-nowrap`, üst satırda üç düğme (`:259-271`); yapı yazıldığı gibi | görsel/yerleşim | ekran-yarısı ölçüsü yalnız görüntüyle |
| C005 | KISMEN | bkz. kök sebep 1; çipler `h-8` `inbox/page.tsx:311`, arama girişi `:343` `h-8`; "Ara"/"Oto-yanıt testi" `Button sm` = telefonda 40 | görsel | "Ara" ve test düğmesi telefonda 40 (altında değil) |
| C006 | YANLIŞ | `auto-reply-toggle.tsx:93` `role="switch"`, `:88` "Açık/Kapalı/Kilitli" yazısı, açıklama `title=` (`inbox/page.tsx:267`) ve kilitliyse "planınızı seçin" bağlantısı (`:137`) | görsel | soluk görünüm doğru olabilir ama etiket değil anahtar |
| C007 | KISMEN | sıralama `lastMessageAt desc` (`inbox/page.tsx:82`), aciliyet sırası yok; satırda `AlertTriangle` + sr-only "Acil" (`:467-468`) + "Sorunlu" rozeti (`:478`) | davranış (sıralama) / görsel | "Acil" sözcüğü yalnız ekran okuyucuya |
| C008 | DOĞRU | kart `rounded-xl lg:h-full` (telefonda yükseklik dayatılmaz, `conversation-thread.tsx:695`); liste `max-h-[52vh]` (`:822`); "Gönder" kutudan sonra akışta (`:1340`); sabit/yapışkan yok; tam ekran düğmesi `hidden lg:inline-flex` (`:777`) | görsel/yerleşim | klavye açılınca kaybolma iddiası kodla doğrulanamaz (akışta olduğu için sayfa kayar) |
| C009 | KISMEN | kök sebep 1; Durum/Öncelik `h-8` (`conversation-thread.tsx:729`); geri/Sil `Button sm` = 40 telefonda | görsel | seçiciler gerçekten 32 |
| C010 | KISMEN | `thread:772` `gap-2` (8 px); Sil `variant="outline"` (`delete-conversation-button.tsx:41`) ve silmeden önce `confirmDialog` (`:19-22`, "Sil" onayı) | görsel | kırmızı çöp kutusu kodla doğrulanmadı; onay VAR |
| C011 | KISMEN | başlık saatleri mülk varsayılanı `property.checkInTime→checkOutTime` (`inbox/[id]/page.tsx:457`), kart "Bağlı rezervasyon yok." (`:588`); çelişki değil, kaynak farkı; seed konuşması rezervasyona bağlı değil (ORTAM payı) | metin | başlıktaki saat "mülk varsayılanı" diye ayrılmıyor |
| C012 | GÖRSEL | yapı: başlık+Durum/Öncelik+künye+düğmeler tek karta (`conversation-thread.tsx:~740-790`); kapladığı alan yalnız görüntüyle | görsel/yerleşim | bkz. C008 |
| C013 | DOĞRU | `thread:791` "Sorunlu konuşmada yapay zekâ cevap göndermez", `:945` "AI cevap öner" (aynı ekranda "yapay zekâ"/"AI" karışık); düğmenin sorunluda ne yaptığı doğrulanmadı | metin | metin değişikliği → kurucuya sorulur |
| C014 | DOĞRU | `conversation-form.tsx:94,111,137` yerel `required`, `form-field.tsx`'te yıldız yok; yalnız `:101` "(opsiyonel)" | metin/görsel | |
| C015 | DOĞRU | `conversation-form.tsx:110` etiket, `:111` placeholder yok | metin | |
| C016 | KISMEN | bkz. kök sebep 1; Input/Select/Button telefonda 40 | görsel | |
| C017 | KISMEN | `inbox/new/page.tsx:37` "Bir misafir konuşması başlatın."; form etiketi "İlk mesaj (misafirden gelen)" (`conversation-form.tsx:131`) yönü söylüyor; sonrasında ne olacağı yazmıyor | metin | |
| C018 | DOĞRU | `properties/page.tsx:149,171` `Eksik: …` düz `<p>`, kartın tamamı `Link` (`:109`), ayrı düğme yok | davranış/görsel | tamamlama için kart → mülk sayfası |
| C019 | DOĞRU | `properties/page.tsx:109` `<Link href=/properties/id>` tüm kart, ok/etiket yok | görsel | |
| C020 | DOĞRU | `:115` "{n} rez.", `:132` "{n} bilgi", `:155` "{done}/{total} hazır" | metin | |
| C021 | ORTAM | `property-form.tsx:139,147` `type="time"`, varsayılan `"15:00"` (`:32`) → AM/PM tarayıcı dili (en-US) | — | ürün kusuru değil |
| C022 | KISMEN | bkz. kök sebep 1; "36-38 px alan" Input `h-10` ile çelişiyor | görsel | |
| C023 | KISMEN | yalnız `property-form.tsx:109` "(isteğe bağlı)"; aynı Field mekanizması (C014); alan listesi tek tek doğrulanmadı | metin | |
| C024 | KISMEN | `kb-manager.tsx:738-766` Düzenle/Kopyala/Pasifleştir/Sil `min-h-[40px] min-w-[40px]` + `aria-label`+`title`; yani 40x40, "<40" ve etiketsiz iddiası zayıf; Sil, Pasifleştir'in hemen yanında ama `confirmDialog` var (`:276-279`) | görsel | yan yana yakınlık doğru |
| C025 | KISMEN | görünür metin yok ama `aria-label`+`title` var (`:741-766`); Kopyala = "Diğer dairelere kopyala" | görsel/metin | tooltip dokunmatikte görünmez |
| C026 | DOĞRU | `knowledge/page.tsx:100` KbManager; grid `lg:grid-cols-3`, telefonda tek sütun: form kartı kayıtlardan önce (`kb-manager.tsx:~447-460`); Şablonlar kartı üstte | görsel/yerleşim | |
| C027 | DOĞRU | `knowledge/page.tsx:79` tek paragraf; `kb-template-suggestions.tsx:162-163` "metin sizin cümlenizdir, doldurmanız gereken bir şey yok" | metin | |
| C028 | KISMEN | `kb-template-suggestions.tsx:148,153`; X yalnız `setDismissed(true)` (`:42,115`) → oturum içi, yenileyince geri gelir (kalıcı değil) | metin | |
| C029 | DOĞRU | `template-manager.tsx:379-400` `flex items-start justify-between` telefonda da yan yana, `line-clamp-3` (`:391`) | görsel | |
| C030 | DOĞRU | `:324,391` `line-clamp-3`; tam metin yalnız form/uyarla | davranış | |
| C031 | DOĞRU | gövde ham basılıyor (`:324,391`); yer tutucu açıklaması yalnız form ipucunda (`:257`) | metin | `{{…}}` depolanan gerçek biçim |
| C032 | KISMEN | kök sebep 1; "Kendime uyarla" `px-2.5 py-1.5 text-xs` (`:397`), "Varsayılan Şablonlar" aç/kapa `py-1.5` (`:364`) ~30 px | görsel | |
| C033 | DOĞRU | `lib/reports.ts:821-827` şikayet 0.2 ağırlık (`100-oran`), `:838` ≥90 "Mükemmel"; `reports/page.tsx:30` eşik 20, `:224-226` "Az veri"; formül açıklaması yok | metin/davranış | kurucuya sorulur |
| C034 | KISMEN | oran/Açık Şikayetler = `status==="problem"` konuşma (`reports.ts:814`); risk kartı olay günlüğü, "kayıt özelliğinin açıldığı andan itibaren" (`page.tsx:431`) → farklı kaynak; seed'de olay yok (ORTAM payı) | metin | "AI Cevapları 0 / 3 konuşma" da farklı sayaç |
| C035 | KISMEN | kutu yalnız `!channelConnected && !demo` (`reports/page.tsx:177`), düz `<p>`, bağlantı yok (`:178-181`); bağlantısız yeni işletme = ORTAM payı | metin/görsel | |
| C036 | KISMEN | skor doluluğu "(bu gece)" (`:245-248`), alt kart "bu ay" (`:468`); sayfa açıklaması "her kart kendi dönemini belirtir" (`:174`) | metin | iki farklı dönem gerçek |
| C037 | DOĞRU | `:348-409` etiketler, `:431` "Sayım olay bazlıdır…" | metin | |
| C038 | ORTAM | `properties/[id]/page.tsx:260` `baseUrlFromHost(host)` (`email-verify.ts:149-155`): 127.*/localhost için http, aksi halde allowlist → `appBaseUrl()`; üretimde canonical alan adı | — | doğrudan `appBaseUrl()` değil ama sahte Host'a karşı korumalı; kesilme GÖRSEL |
| C039 | ORTAM | KB kartı `knowledgeBase isActive` (`:79`), hafıza `propertyMemory kind=fact source=kb_item` (`memory/read.ts:14-39`); seed `createMany` (`seed.ts:120`) hafızayı eşitlemez, KB rotaları eşitler | — | iki ayrı kaynak, üretimde senkron beklenir; "bilgi" sayımı kopmuşsa yine tutarsız görünür |
| C040 | DOĞRU | başlıklar `page.tsx:440,480` | metin | |
| C041 | KISMEN | bağımsız formlar: `property-form:181`, `nightly-rate-form:124`, `early-checkin-rule-form:180`, `supply-profile-form:183`, `auto-messages-card:166` (Önizle'den önce pasif, `:164`), `default-cleaner-form:132`; çok sayıda Kaydet doğru; "kaydedilmemiş değişiklik uyarısı" araması yapılmadı | davranış | otomatik mesajlarda Kaydet VAR |
| C042 | KISMEN | `auto-messages-card.tsx:145` placeholder "Bu mesaj boşsa gönderilmez."; "Bu mesaj boş — gönderilmez." tam dizesi grep'te bulunmadı (başka kaynaktan geliyor olabilir) | metin | |
| C043 | DOĞRU | "Mülkü sil" (`page.tsx:276`), "Mülk Hafızası", "Bu daire…" (`:589`); nav "Mülkler" (`lib/nav.ts`) | metin | |
| C044 | ORTAM | bkz. C038 | — | |
| C045 | KISMEN | bkz. C041 | görsel | |
| C046 | KISMEN | sayfa tek akış; `Tabs`/`<details>` yok (grep), yalnız `id="otomatik-mesajlar"` çapası (`:375`); 10 ekran yüksekliği doğrulanmadı | görsel/davranış | |
| C047 | DOĞRU | `property-form.tsx:153` "Temizlik tamponu (dk)", `supply-profile-form.tsx:162` "Boş/0 bıraktığınız kalem", `guest-chat-settings.tsx:138` "kodsuz konaklamada"; "turnover" gövdede yok (yalnız kod adı) | metin | "Bir giriş (turnover)" dizesi grep'te yok, doğrulanamadı |
| C048 | KISMEN | `properties/[id]/page.tsx:268-282` Geri ve "Mülkü sil" PageHeader'da yan yana; `DeleteButton` çerçeveli, `confirmDialog` destructive, gövde "geri alınamaz" (`delete-button.tsx:39`) | görsel | onay VAR |
| C049 | ORTAM | bkz. C039 | — | |
| C050 | KISMEN | `guest-chat-settings.tsx:5,38,122-129` `QRCodeCanvas` + `downloadQr` (PNG indir) var; sohbet kapalıyken yalnız "aç" düğmesi (`:151`) | görsel | seed'de kapalı olabilir |
| C051 | DOĞRU | `guest-chat-settings.tsx:136-138` tek paragraf, "kodsuz konaklama", "sohbet kodu" | metin | |
| C052 | DOĞRU | `sent/page.tsx:371-378` EmptyState yalnız metin, `children` düğme yok (bağlantısız dal) | metin/davranış | |
| C053 | KISMEN | bkz. kök sebep 1; bağlantı `sent/page.tsx:339` `py-1.5 text-sm` ≈ 32 px | görsel | |
| C054 | DOĞRU | `sent/page.tsx:343` "Gönderim kuyruğu durumu" | metin | |
| C055 | KISMEN | bkz. kök sebep 1; `queue/page.tsx:122-125` `py-1.5 text-sm` | görsel | |
| C056 | DOĞRU | üst çubuk `titleForPath` ön ek eşleşmesiyle "Gönderilenler" (`nav.ts:46-50`), sayfa `queue/page.tsx:113` "Gönderim Kuyruğu", geri `:125` "Gönderilenler" | metin | |
| C057 | DOĞRU | `queue/page.tsx:152-156` EmptyState düğmesiz | davranış/metin | |
| C058 | KISMEN | nav alanı `overflow-y-auto` (`app-shell.tsx:311`), kullanıcı kartı altta sabit (`:279-281`); kaydırma ipucu kodda yok; Raporlar/Ayarlar listenin sonunda (`nav.ts:38-39`) | görsel | kaydırılabiliyor |
| C059 | DOĞRU | `lib/nav.ts:25-39` düz 14 madde, grup/ayraç yok | görsel/davranış | |
| C060 | DOĞRU | `nav.ts:26-28` "Mesajlar", "Misafir Sohbetleri", "Gönderilenler" art arda, açıklama yok | metin | |
