# UX / UI denetimi — doğrulanmış kayıt (11-13)

> Denetçi model (Claude çalışma paketi, istek 5) ürünün 61 sayfasını masaüstü + telefon ekran görüntüsüyle inceledi: 531 bulgu
> (33 P0 · 237 P1 · 261 P2). P0 + P1'in tamamı (270) dört ajan tarafından KODDA izlendi. Bu belge o izlemenin kaydıdır.
> Ham malzeme (satıcı bilgileri sansürlü): `docs/olcum/ux-denetim-2026-11-13/` — `REPORT.md` (denetçinin kurucu raporu),
> `verify-A.md` … `verify-D.md` (hüküm tabloları), `bulgular.json` (531 bulgunun sade sürümü), `dokunma-hedefi-once.md` (ölçüm).
> Bu belgede hiçbir kod değişmedi. Misafire / müşteriye görünen hiçbir yazı, kurucu cevabı gelmeden değişmez (§8).

## 1. Yöntem ve sınırlar

- **Denetçi yalnız görüntüyü gördü:** kodu, ürün kararlarını, deneme ortamını bilmiyordu. Düğmelere basmadı (onay pencerelerini göremedi).
- **Doğrulama:** her P0 / P1 bulgu için ajan kodu okudu ve tek hüküm verdi: `DOĞRU` (kodda aynen) · `KISMEN` (özü doğru, ayrıntı / kapsam
  yanlış) · `GÖRSEL` (yalnız görüntüyle yargılanır; ilgili sınıf yazıldı) · `KARAR` (yazılı bir ürün kararı öyle istiyor) · `ORTAM` (deneme
  ortamının artığı) · `YANLIŞ` (kod öyle değil). Ajanlar hiçbir şey çalıştırmadı, yalnız okudu.
- **Bulgu kimlikleri:** A = halka açık sayfalar (tanıtım, giriş, kayıt, yasal) · B = misafir QR sohbeti, QR paneli, görevler, girişler,
  takvim · C = pano, gelen kutusu, konuşma, daireler, bilgi tabanı, şablonlar, raporlar, menü · D = ayarlar + yeni hesabın boş sayfaları.
  `bulgular.json` içinde her P0 / P1 bulgunun `kimlik` alanı bu kimliktir; P2'lerin kimliği yok (doğrulanmadılar).
- **Deneme ortamı:** uygulama `127.0.0.1:3100`'de koştu · yapay zekâ anahtarı YOKTU (QR'da cevap gelmedi) · ödeme sağlayıcısı sahte
  anahtarla · tarayıcı başsız Chromium, dil en-US · veriler `prisma/seed` kurgusu · "boş" sayfalar için betik gerçek kayıt akışı yerine
  `createUserWithMembership(..., "seed")` ile işletme açtı (abonelik satırı yazılmadı) · bugünün tarihi 13 Kasım 2026.
- **Satır numaraları:** tablolardaki dosya:satır atıfları doğrulama anındaki (`40dc29b9` öncesi) hâldir; 40dc29b9'un dokunduğu dosyalarda
  birkaç satır kaymış olabilir. Atıf yaklaşık ise tabloda `~` vardır.
- **Sınır:** P2 bulguları (261) doğrulanmadı. "Klavye açılınca Gönder kayboluyor" gibi davranış iddiaları kodla doğrulanamadı (tabloda
  yazılı). Ölçümler (40 px altı hedef, 12 px altı yazı) tarayıcı betiğinindir (`scripts/claude-work/screenshots.ts`; ölçüt: genişlik VEYA
  yükseklik 40 px'ten küçük).

## 2. Sayılar

Hüküm sütunundan sayıldı (270 satır). Ajan özetlerindeki sayılar yaklaşıktı (plan belgesindeki "≈ 103 · 78 · 49 · 19 · 12 · 2" onlardan
gelir); burada tablonun kendisi esas alındı.

| grup | DOĞRU | KISMEN | GÖRSEL | KARAR | ORTAM | YANLIŞ | toplam |
|---|---|---|---|---|---|---|---|
| A (74) | 43 | 18 | 11 | 1 | 0 | 1 | 74 |
| B (78) | 21 | 26 | 13 | 15 | 3 | 0 | 78 |
| C (60) | 25 | 27 | 2 | 0 | 5 | 1 | 60 |
| D (58) | 25 | 14 | 16 | 0 | 3 | 0 | 58 |
| **toplam** | **114** | **85** | **42** | **16** | **11** | **2** | **270** |

Notlar: A030 tabloda `YANLIŞ`, ama kökeni ortamdır (betik onay kutusunu işaretlemedi). A047'nin hükmü `DOĞRU`, düzeltme türü
"kod yorumunda bilinçli" diye yazılmış (KARAR sayılmadı). Yani gerçek "ortam artığı" sayısı 12'dir.

P0'lar (33): DOĞRU 15 · KISMEN 9 · ORTAM 4 · KARAR 3 · YANLIŞ 1 · GÖRSEL 1.

## 3. 33 P0 — tek tek hüküm

| kimlik | sayfa | denetçinin başlığı (kısa) | hüküm | bir satır |
|---|---|---|---|---|
| A030 | kayıt (eksik) | hatalı alanlarda hata yok | YANLIŞ | betik onay kutusunu işaretlemedi → düğme pasifti, form hiç gönderilmedi; doğrulama tetiklenmedi |
| A031 | kayıt (eksik) | soluk "Hesap Oluştur" sebep söylemiyor | KISMEN | pasif düğmenin sebebi yazılmıyor (doğru); P0 değil → UX-3 |
| A043 | uyarı adresi doğrulama | çıkmaz ekran | DOĞRU | hata ekranında bağlantı / düğme yok, logo tıklanmıyor |
| A049 | gizlilik | "Kasım 2026" gelecekte | KISMEN | bugün 13 Kasım 2026 → ileri tarih DEĞİL; yalnız "gün yok" doğru |
| A050 | gizlilik | KVKK adresi kişisel e-posta servisi | DOĞRU | iletişim adresi alan adlı değil → UX-6 |
| A058 | mesafeli satış | satıcı bilgileri güven vermiyor | DOĞRU | şahıs adı biçimi, yurt dışı adres, kişisel e-posta, "MERSİS/Vergi" etiketi → UX-6 |
| A059 | mesafeli satış | tarih gelecekte | KISMEN | bkz. A049 |
| A063 | ön bilgilendirme | satıcı bilgileri güven vermiyor | DOĞRU | bkz. A058 |
| A064 | ön bilgilendirme | MERSİS etiketi yurt dışı adresle uyuşmuyor | DOĞRU | tek alan "MERSİS / Vergi No" → UX-6 |
| B001 | misafir sohbeti | gönderimden sonra geri bildirim yok | KISMEN | "yazıyor…" yalnız istek sürerken; "gönderildi" işareti yok; hata dalı VAR → UX-1 |
| B007 | misafir sohbeti (mesaj) | cevap gelmeyince ekran sessiz | DOĞRU | model cevap vermeyince ekranda hiçbir durum yok → UX-1 |
| B012 | misafir sohbeti (EN) | durum bilgisi yok | DOĞRU | bkz. B007 |
| B017 | misafir sohbeti (EN, mesaj) | tam sessizlik | DOĞRU | bkz. B007 (üç aynı mesaj = üç betik koşusu) |
| B022 | başka cihaz | ekranda eylem yok | KARAR | cihaz bağlama + kurtarma ev sahibinde ("Cihaz kilidini sıfırla") |
| B023 | başka cihaz | yalnız Türkçe | KISMEN | metnin İngilizcesi var; dil tarayıcıdan seçilir, betik tr-TR koştu; seçici yok |
| B029 | konaklama dışı | çıkmaz sokak | KARAR | dış bağlantı yok, tek metin beş koşul (numaralandırma koruması) |
| B030 | konaklama dışı | yalnız Türkçe | KISMEN | bkz. B023 |
| B037 | QR paneli (ayrıntı) | misafir Wi-Fi soruyor, uyarı "buraya yazmayın" | DOĞRU | uyarı 10-11 kararından önceki kuraldan kalma → UX-2 |
| B062 | girişler | sorunu söylüyor, çözdürmüyor | KARAR | sayfa bilerek salt-okuma (H1, 11-05); bedel gerçek → UX-10 |
| B063 | girişler | telefonda hedefler küçük | GÖRSEL | alt bağlantılar `text-sm gap-3` (40dc29b9'da dokunulmadı) |
| B068 | hazırlık | boş durumda düğme yok, yol tarifi var | DOĞRU | boş durum düz metin |
| C008 | konuşma | Gönder telefonda ilk ekranda kesik | DOĞRU | yanıt kutusu akışta, yapışkan değil; tam ekran yalnız `lg` → UX-4 |
| C009 | konuşma | hedeflerin çoğu 40 px altı | KISMEN | Durum / Öncelik `h-8` (32 px) doğru — 40dc29b9'da telefonda 40 px oldu; geri / Sil zaten 40 |
| C024 | bilgi tabanı | simgeler küçük, sil aç/kapatın dibinde | KISMEN | simgeler zaten 40×40 + etiketli; Sil yan yana doğru, onay penceresi VAR |
| C038 | daire ayrıntısı | dışa aktarma 127.0.0.1 gösteriyor | ORTAM | adres `baseUrlFromHost` (yalnız 127.* / localhost için http, aksi hâlde `appBaseUrl()`) |
| C044 | daire ayrıntısı (telefon) | aynı | ORTAM | bkz. C038 |
| D001 | bağlantılar | Hospitable nedir hiç yazmıyor | KISMEN | yalnız "(Hospitable üzerinden)" geçiyor; açıklama yok → UX-7 |
| D002 | bağlantılar | aynı şeye üç ad | DOĞRU | "bağlantı anahtarı (Access Token)", "Token", "Hospitable Personal Access Token", "Hospitable access token" → UX-7 |
| D011 | abonelik | mevcut plan / ücretli planlar ilişkisi belirsiz | ORTAM | betiğin işletmesinde abonelik satırı yoktu → "Tam erişim"; gerçek kayıt 14 günlük deneme yazar |
| D012 | abonelik | "Bu plana geç" soluk, sebep yok | DOĞRU | sebep yalnız üstteki onay satırında, düğmenin yanında değil → UX-3 |
| D022 | yapay zekâ ayarları | 8 ekran, aynı açıklama üç kez | DOĞRU | açıklama tekrarı kodda (`settings/page.tsx:331-398`) |
| D053 | boş abonelik | deneme süresi / bitiş tarihi yok | ORTAM | süre ortam artığı; ama gerçek denemede de bitiş TARİHİ yazmıyor (yalnız gün) → UX-8 |
| D054 | boş abonelik | plan düğmeleri soluk | DOĞRU | bkz. D012 |

## 4. Gerçek kusurlar (kök sebebe göre)

Yalnız `DOĞRU` / `KISMEN` hükümlü olanlar; her satırdaki kimlikler aynı kök sebebe bağlı bulgulardır.

| # | kök sebep | kimlikler | düzeltme türü | durum |
|---|---|---|---|---|
| 1 | Misafir QR sohbetinde cevap tutulunca ekranda hiçbir durum yok | B001 B007 B008 B012 B017 (B043 önizleme) | davranış + yeni misafir yazısı | soru UX-1 |
| 2 | Ev sahibi QR yanıt kutusu uyarısı Wi-Fi'yi de yasaklıyor (10-11 kararından eski) | B037 | metin | soru UX-2 |
| 3 | Pasif düğme sebebini söylemiyor (kayıt, demo formu, plan düğmeleri, ayar "Kaydet"leri) | A028 A031 A032 A009 D012 D054 D009 D023 | davranış | soru UX-3 |
| 4 | Telefonda konuşma ekranında yanıt kutusu + Gönder akışta, aşağıda | C008 C012 | görsel / yerleşim | soru UX-4 |
| 5 | Tanıtım turunda geliştirici dili + çelişkili, üçüncü şahıs örnek cevap; tıklanamaz sahte düğme | A001 A011 A002 A013 | metin | soru UX-5 |
| 6 | Yasal sayfalar: satıcı bilgileri, "MERSİS/Vergi" etiketi, yayında taslak notu, cayma maddeleri çelişkili okunuyor, gün yok, yıllık yenileme maddesi eksik | A050 A051 A055 A058 A063 A064 A068 A060 A067 A054 A065 | metin (hukuk) | soru UX-6 |
| 7 | Bağlantılar kartı: Hospitable açıklanmıyor; aynı şeye beş ad | D001 D002 D004 | metin | soru UX-7 (D005 yapıldı, §7) |
| 8 | Deneme süresinde bitiş TARİHİ yok (yalnız kalan gün) | D053 | metin | soru UX-8 |
| 9 | Konaklama dışı ekranı çıkış yapmış misafire de "giriş gününüzde tekrar okutun" diyor; "aktif konaklama" iç terim | B033 B032 | metin | soru UX-9 |
| 10 | Raporlar: 3 konuşmayla "Mükemmel" etiketi; şikâyet / risk / doluluk kartları farklı kaynak ve dönem | C033 C034 C036 | metin / davranış | soru UX-12 |
| 11 | Çıkmaz ekranlar: uyarı adresi doğrulama, e-posta doğrulama hatası, hazırlık / gönderilenler / kuyruk / takvim / girişler / boş gelen kutusu | A043 A045 A046 A042 B068 C052 C057 D036 D047 D048 D050 B066 | davranış (yeni düğme / bağlantı) | sorulmadı — İE-2 yalnız takvimin masaüstü boş durumunu (aynı metin) alır |
| 12 | Yerel sınıfla ezilen dokunma hedefleri (tema 32, menü 36, süzgeçler 32, seçiciler 32–36…) | B036 C003 C005 C009 C032 B049 B041 B077 D049 D015 | görsel | **yapıldı (§7)** |
| 13 | Yıkıcı düğme komşu düğmeye bitişik (onay pencereleri VAR) | C010 C048 C024 B057 | görsel | İE-2 |
| 14 | Tıklanabilir kart / satırda görsel ipucu yok | C002 C019 B035 B070 | görsel | İE-2 |
| 15 | Mobil menüde kaydırma ipucu yok; menü düz 14 madde | C058 C059 C060 | görsel (ipucu) / metin (gruplama) | İE-2 yalnız ipucu |
| 16 | Takvim telefonda yalnız hareketli günler; satırlar tıklanmıyor | B075 B076 | davranış | bilinçli ajanda tasarımı; sorulmadı |
| 17 | Ürün içi sözlük dağınık (yapay zekâ / AI, Oto-yanıt / Otomatik yanıt, Check-in / Giriş, Mülk / Daire, sen / siz) | A004 A007 C013 C043 D020 D025 D035 C020 C047 | metin | sorulmadı (tek sözlük kararı kurucunun) |
| 18 | 2FA kurulumunda QR yok, yalnız elle anahtar | D029 | davranış | sorulmadı (kimlik akışı) |
| 19 | Hata metinleri teknik ("Bağlantıda doğrulama anahtarı yok…") | A041 A044 A037 | metin | sorulmadı |
| 20 | Şablon kartlarında ham `{{guestName}}`, "Kendime uyarla" kartın yarısı | C029 C030 C031 | görsel + metin | "Kendime uyarla" ölçüsü yapıldı (§7); gerisi sorulmadı |

Denetçinin YANILDIĞI yerler (kodda bakıldı): silmelerde onay penceresi yok (B057, C010, C024, C048 — hepsinde `confirmDialog` var) ·
giriş kutuları 36–38 px (B059, C016, C022 — `Input` / `Select` `h-10` = 40 px) · "Oto-yanıt: Kapalı" soluk etiket (C006 — gerçek
anahtar, `role="switch"`) · ev adı hiç yok (B003 — ev sahibi "Misafire görünen ad" girerse başlık "<ad> · Misafir Asistanı" olur;
betikte boştu) · yalnız Türkçe (B004 — iki dil var, tarayıcı diline göre).

## 5. Deneme ortamının artıkları (ürün kusuru DEĞİL)

| kimlik | artık | kanıt |
|---|---|---|
| A030 | kayıt formu hiç gönderilmedi | betik onay kutusunu atladı; pasif düğmeye tıklama 5 sn zaman aşımıyla yutuldu (`screenshots.ts:279-289`) |
| A049 A054 A059 A066 | "Kasım 2026 ileri tarih" | bugün 13 Kasım 2026 (`legal-entity.ts:22`); yalnız "gün yok" kısmı gerçek |
| A005 D013 D055 | yıllık plan seçici yok | üç `PADDLE_PRICE_*_YILLIK` env'i CI'da tanımsızdı (`claude-work.yml:47-49`) |
| B016 B044 | karşılama kartı kayboldu / masaüstü-telefon farklı mesaj sayısı | betik her görünüm için ayrı mesaj gönderdi (`screenshots.ts:317-319`) |
| B058 C021 D020 (saat kısmı) | "03:00 PM", "mm/dd/yyyy" | yerel `type="time"` / `datetime-local` alanı, tarayıcı dili en-US |
| C038 C044 | 127.0.0.1 bağlantısı | `baseUrlFromHost` yalnız 127.* / localhost için o adresi kurar, aksi hâlde allowlist → `appBaseUrl()` |
| C039 C049 | "Mülk Hafızası 0 bilgi" | seed bilgi tabanını `createMany` ile yazar; hafıza yalnız bilgi tabanı rotalarıyla eşitlenir |
| D011 D053 | "Tam erişim (daire sınırı yok)" | betiğin işletmesinde abonelik satırı yok → eski hesap gibi görünür; gerçek kayıt `newTrialSubscriptionData()` yazar |
| D028 | `demo@guestops.ai` | seed kullanıcısı (`prisma/seed.ts:74`); kod başka marka basmıyor |

Aynı soruyu iki / üç kez yazan misafir (B007, B017, B018, B039) de betiğin birden çok koşusudur — ama sessizliğin kendisi gerçektir (§4 #1).

## 6. Kurucu kararına çarpanlar

Kararlar DEĞİŞMEDİ. Bulgu kararın bedelini gösteriyorsa bedel yazıldı.

| kimlik | karar (dosya:satır) | bedel |
|---|---|---|
| B001 B007 (öneri kısmı) | K10 "Hiçbir şey gitmesin" — `docs/claude/kalici-urun-kararlari.md:64` | denetçinin önerdiği "Mesajınızı aldım, en kısa sürede yazacağım" cümlesi bu kararın yasakladığı sınıf; cümlesiz bir durum işareti çarpmaz → UX-1 |
| B002 B009 B014 B020 B025 B045 | QR taraf etiketleri ("işletme ekibi" ×3 + alt yazı) açık soruda — `CLAUDE.md` "11-06 gece (3)", `docs/claude/acik-isler.md:199` | aynı ekranda üç anlatıcı ("işletme ekibi", "Otomatik asistan + ev sahibi", "bize yazın"); karar bekliyor |
| B031 | kapalı ekranlarda yalnız marka, mülk adı ASLA — `src/components/guest-chat/guest-notice.tsx` başlık yorumu, `src/app/c/[token]/page.tsx` U4 yorumu | misafir kapalı ekranda hangi ev olduğunu görmez |
| B021 B046 | arayüz dili tarayıcıdan, mesaj dilinden değil (U2, 10-22) — `src/components/guest-chat/guest-chat-copy.ts:2-5`; önizleme bilerek Türkçe — `guest-chat-thread.tsx:26-27` | İngilizce telefondan Türkçe yazan misafir İngilizce arayüz görür |
| B022 B027 B029 | dış bağlantı yok + tek metin beş koşul (numaralandırma koruması) — `guest-notice.tsx:14-26`; QR cihaz bağlama — `docs/claude/kalici-kararlar.md:447` | misafir tarafında eylem yok; kurtarma ev sahibinin "Cihaz kilidini sıfırla" düğmesinde |
| B034 B040 | rozet "Ev sahibine iletildi" — `src/app/api/chat/[token]/route.ts:172` yorumu | kurucu kararı değil, kod yorumu; rozet okuyana (ev sahibine) üçüncü şahısla hitap ediyor. Metin değişikliği → sorulmadı (UX listesinde yok, ekleme önerisi §9) |
| B062 | Girişler salt-okuma (kurucu H1, 11-05) — `src/app/(app)/arrivals/page.tsx:11`, `arrivals-list.tsx:8` | eksik satırı çözmek için sayfadan eylem yok → UX-10 |
| A073 | Hospitable fiyatı yazılmaz (bayatlar) — `src/app/(legal)/entegrasyonlar/page.tsx:62-63` yorumu | müşteri ikinci aboneliğin tutarını sayfada görmez (resmî fiyat sayfasına bağlantı var) |
| A047 | panel 404'ünde tek hedef pano — `src/app/(app)/not-found.tsx` yorumu (hüküm DOĞRU, kod yorumunda bilinçli) | silinmiş konuşmadan gelen kişi Mesajlar'a değil panoya döner |

## 7. 40dc29b9'da yapılan görsel düzeltmeler (YAPILDI)

Hiçbir yazı değişmedi; masaüstü görünümü aynı. Testler `76d99895`'te: `tests/unit/phone-touch-targets.test.ts` (sınıf pinleri — ölçü değil
kaynak taraması) ve `tests/ui/ux-links-no-copy-change.test.tsx` (iki bağlantının görünen metni birebir aynı).

| düzeltme | dosya | ilgili bulgu |
|---|---|---|
| tema düğmesi telefonda 32 → 40 px | `src/components/shell/panel-theme.tsx` | B036 |
| menü düğmesi 36 → 40 px | `src/components/shell/app-shell.tsx` | B036 C058 |
| gelen kutusu süzgeçleri ve arama 32 → 40 px | `src/app/(app)/inbox/page.tsx` | C005 |
| konuşma: Durum / Öncelik / Ton seçicileri 32 → 40 px | `src/components/inbox/conversation-thread.tsx` | C009 |
| şablon "Kendime uyarla" ~30 → 40 px | `src/components/templates/template-manager.tsx` | C032 |
| takvim ay okları 32 → 40 px, daire süzgeçleri yükseltildi | `src/app/(app)/calendar/page.tsx` | B077 D049 |
| abonelik plan düğmeleri 32 → 40 px | `src/components/settings/paddle-plans.tsx` | D015 |
| görev durum + atanan seçicisi 36 → 40 px | `src/components/tasks/task-board.tsx` | B049 |
| QR paneli: Yanıtla + yanıt kutusu 36–38 → 40 px | `src/components/guest-chats/reply-box.tsx` | B041 |
| kurulum kartı "daralt" 32 → 40 px | `src/components/onboarding-guide.tsx` | C003 |
| misafir sohbetinde saat, kapı kodu notu, alt bilgi 11 → 12 px | `src/components/guest-chat/guest-chat.tsx`, `guest-chat-thread.tsx` | B006 |
| bağlantı kartında `my.hospitable.com` tıklanabilir (metin aynı) | `src/components/settings/hospitable-connect-card.tsx` | D005 |
| güvenlik sayfasında bildirim e-postası tıklanabilir (metin aynı) | `src/app/(legal)/guvenlik/page.tsx` | A070 |

Yalnız telefon genişliği (sm altı) büyüdü. Ortak bileşenler (`button.tsx`, `input.tsx`, `select.tsx`) zaten telefonda 40 px'ti (10-21);
kusur yerel sınıf ezmeleriydi.

**Önce / sonra ölçümü.** "Önce" = 40dc29b9'dan önceki yerel gezi (`screenshots.ts`, 12 Kasım gecesi), sayfa başına 40 px altı etkileşimli
öğe sayısı; tablo `docs/olcum/ux-denetim-2026-11-13/dokunma-hedefi-once.md` (yerel + CI sütunları). Telefonda 61 sayfada 732 etkileşimli
öğenin 643'ü 40 px altı ölçüldü (ölçüt genişlik VEYA yükseklik; satır içi metin bağlantıları da sayılır). Seçilmiş sayfalar (telefon):

| sayfa | etkileşimli | 40 px altı (önce) | sonra |
|---|---|---|---|
| gelen kutusu | 17 | 14 | ölçülmedi |
| konuşma | 18 | 17 | ölçülmedi |
| QR paneli (ayrıntı) | 9 | 9 | ölçülmedi |
| takvim | 9 | 9 | ölçülmedi |
| görevler | 34 | 34 | ölçülmedi |
| şablonlar | 22 | 22 | ölçülmedi |
| pano | 18 | 10 | ölçülmedi |

**"Sonra" ölçümü YAPILMADI** — İE-2'nin ilk adımı (aynı betikle yerel gezi). Abonelik sayfasında yerel (42 / 39) ve CI (11 / 11) sayıları
farklı: ödeme bileşeninin iki koşuda farklı yüklenmesi olabilir, doğrulanmadı.

## 8. Kurucu soruları (plan belgesi §3, UX-1…UX-12)

Hepsinde: hiçbiri cevapsız değişmez. Misafire giden örnekler ev sahibinin ağzındandır. Metin önerileri Claude'undur, karar kurucunun.

**UX-1 — QR'da sessizlik.** Bulgular: B001 B007 B008 B012 B017 (B043). Karar: K10 (`kalici-urun-kararlari.md:64`).
- ÖNCE (misafir ekranı): misafirin balonu, altında yalnız saat `04:08`. "Yazıyor…" yalnız istek sürerken; sonra hiçbir şey.
- SONRA (önerim): balonun altında küçük `04:08 · Gönderildi` (EN `Sent`). Cümle YOK, ev sahibi adına söz YOK, okundu / iletildi iddiası YOK.
- Reddedilen (K10'a çarpar): "Mesajınızı aldım, en kısa sürede yazacağım."

**UX-2 — Ev sahibi QR yanıt kutusundaki uyarı.** Bulgu: B037. Karar: QR'da Wi-Fi verilir (`docs/claude/ai-guvenlik.md:374`, 10-11).
- ÖNCE: "⚠️ Bu, misafirle paylaşılan bir sohbet kanalıdır. Kapı kodu, Wi-Fi şifresi ve kişisel/hassas bilgileri buraya yazmayın — bunları
  Airbnb/Booking mesajından iletin."
- SONRA: "⚠️ Bu, misafirle paylaşılan bir sohbet kanalıdır. Kapı kodu ve kişisel/hassas bilgileri buraya yazmayın — bunları Airbnb/Booking
  mesajından iletin."

**UX-3 — Pasif düğme sebep söylemiyor.** Bulgular: A028 A031 A032 A009 D012 D054.
- ÖNCE (kayıt): onay kutusu boşken "Hesap Oluştur" soluk; basınca hiçbir şey olmuyor. ÖNCE (abonelik): üç "Bu plana geç" soluk; sebep
  kartların üstündeki küçük satırda ("Ücretli plana geçmeden önce bu onay gereklidir.").
- SONRA (önerim): düğme hep basılabilir; kutu boşsa basınca tarayıcının kendi uyarısı kutuyu gösterir (yeni yazımız yok).
- ⚠️ Emin olmadığım yer: tarayıcı uyarısı yalnız `<form>` içindeki `required` alanda çalışır. Kayıt formu böyle (`register-form.tsx`);
  plan düğmeleri form değil (JS düğmesi) — orada ya forma sarmak ya da kutuyu kaydırıp vurgulamak gerekir. Kimlik akışı → ilk denemeler
  kurucuyla (plan İE-4).

**UX-4 — Telefonda konuşma ekranında Gönder aşağıda.** Bulgular: C008 C012.
- ÖNCE: telefonda başlık + Durum / Öncelik + mesaj listesi (en çok ekran yüksekliğinin %52'si) + yanıt kutusu alt alta; Gönder ilk ekranda yarım.
- SONRA: telefonda yanıt kutusu + Gönder ekranın altına sabit; liste arkasından kayar. Yazı değişmez. Masaüstü yerleşimi pinli, dokunulmaz
  (`docs/claude/acik-isler.md` "Panel yerleşimi (lg)").

**UX-5 — Tanıtım turu.** Bulgular: A001 A011 A002 A013. Kural: ev sahibi sesi (CLAUDE.md, 11-06).
- ÖNCE başlık: "Lixus AI — API bağlama anlatımı" / "Ücretsiz dene → hesap aç → e-posta onayı → Bağlantıyı kur → token'ı yapıştır".
- SONRA başlık (önerim): "Kurulum nasıl yapılır?" / "Ücretsiz deneyin → hesabınızı açın → e-postanızı onaylayın → Airbnb / Booking'i bağlayın".
- ÖNCE örnek cevap: "Hello! Early check-in from 13:00 is available — I'll confirm with the host. 😊" (hem "müsait" hem "soracağım" + üçüncü şahıs).
- SONRA örnek cevap (iki seçenek, tek anlamlı, ev sahibinin ağzından): (a) misafir "Hi! Is early check-in possible?" → "Hello! Yes, you can
  check in from 13:00." · (b) soruyu değiştirmek: "What time is check-out?" → "Check-out is at 11:00." (b) ürünün bugünkü davranışına daha
  yakın: erken giriş hassas istek, ürün doğrulamadan "evet" demez.
- Ayrıca: içindeki "14 gün ücretsiz dene" tıklanamaz bir animasyon parçası (A013) — kaldırmak ya da düğmeye çevirmek.

**UX-6 — Yasal sayfalar.** Bulgular: A049 A050 A051 A054 A055 A058 A059 A060 A063 A064 A065 A066 A067 A068. Hukuk / işletme kararı;
satıcı bilgilerinin kendisi bu belgeye YAZILMADI.
- Taslak notu — ÖNCE: "🚩 Bu bölümün Türk hukuku açısından nihai metni avukat incelemesindedir…" (`guvenlik/content.ts:100`) · SONRA: not kalkar.
- Etiket — ÖNCE: "MERSİS / Vergi No: [vergi numarası]" · SONRA: numaranın türüne göre tek etiket (ör. "Vergi kimlik no"); hangisi olduğu
  kurucuda.
- İletişim — ÖNCE: kişisel (ücretsiz servis) e-posta adresi · SONRA: alan adlı bir adres (güvenlik sayfası zaten `security@` alan adlı).
- Tarih — ÖNCE: "Son güncelleme: Kasım 2026" · SONRA: gün-ay-yıl (ör. "Son güncelleme: 13 Kasım 2026"); ileri tarih iddiası YANLIŞ (§5).
- Cayma — ÖNCE: madde 10 "14 gün … cayma hakkına sahiptir", madde 11 "cayma hakkınız sona erebilir" · SONRA: tek net ifade (avukatla).
- Yıllık plan — ön bilgilendirme madde 8 yalnız "aylık dönem" diyor; yıllık plan tanıtımda var (A065).
- Soru: hangilerine dokunalım?

**UX-7 — Bağlantılar sayfası.** Bulgular: D001 D002 D004 (D005 yapıldı, §7). Hospitable'a özgü YENİ ekran yapılmaz (09-23); mevcut karta
bir cümle bu kurala çarpmaz (D001 notu).
- ÖNCE: "Aşağıdan Airbnb / Booking bağlantınızı (Hospitable üzerinden) kurun." · SONRA: "Airbnb ve Booking mesajlarınızı Hospitable adlı
  hizmet üzerinden alıyoruz; bağlamak için Hospitable hesabınızdan bir bağlantı anahtarı alın."
- ÖNCE adlar: "bağlantı anahtarı (Access Token)" · "Token" · "Hospitable Personal Access Token" (alan etiketi) · "Hospitable access token"
  (yer tutucu) · SONRA: her yerde "bağlantı anahtarı"; alan etiketi "Hospitable bağlantı anahtarı", yer tutucu "Bağlantı anahtarını buraya
  yapıştırın".

**UX-8 — Deneme süresi.** Bulgu: D053 (D011 ortam).
- ÖNCE (üç yer): kenar çubuğu "Pro · deneme 12g" · şerit "Pro ücretsiz deneme: 12 gün kaldı." · abonelik "ücretsiz deneme, 12 gün kaldı".
- SONRA: şerit "Pro ücretsiz deneme: 12 gün kaldı (25 Kasım'da biter)." · abonelik "ücretsiz deneme, 12 gün kaldı (25 Kasım'da biter)" ·
  kenar çubuğu dar, aynı kalır.

**UX-9 — Konaklama dışı ekranı.** Bulgular: B033 B032. Karar çarpması: tek metin beş koşul / numaralandırma koruması (`guest-notice.tsx:14-17`).
- ÖNCE (girişten önce de çıkıştan sonra da): "Şu an aktif bir konaklama görünmüyor" / "Sohbet yalnızca konaklamanız sürerken açıktır." /
  "Bir rezervasyonunuz varsa giriş gününüzde bu karekodu tekrar okutarak buraya ulaşabilirsiniz."
- SONRA (plan önerisi, iki metin): girişten önce "Sohbetimiz giriş gününüzde açılıyor; o gün bu karekodu yeniden okutun." · çıkıştan sonra
  "Konaklamanız sona erdiği için bu sohbeti kapattık. Bize rezervasyon yaptığınız uygulamanın mesajlarından yazabilirsiniz."
- ⚠️ Bedel (yeni bulgu, kodda bakıldı): bugün `!ctx.open` boş daire / girişten önce / çıkıştan sonra durumlarını TEK metinle gösteriyor.
  İki metin, QR'ı okutan herkese (ör. kodun fotoğrafını çekmiş biri) dairenin bir konaklamanın hemen öncesinde mi sonrasında mı olduğunu
  söyler. Alternatif (tek metin, sızıntısız): "Bu sohbet yalnız konaklama süresince açık. Bize rezervasyon yaptığınız uygulamanın
  mesajlarından yazabilirsiniz." — çıkış yapmış misafire de anlamlı. Önerim bu alternatif.

**UX-10 — Girişler sayfasında eksik satırlarının yanında eylem yok.** Bulgular: B062 (ayrıca B066 / D050: boş günlerin başlığı yok). Karar:
salt-okuma (H1, 11-05, `arrivals/page.tsx:11`).
- ÖNCE: "Temizlik açık · atanan: … · başlanmadı — eksik: çıkıştan (11:00) sonra "bitti" kaydı" (eylemsiz) + altta "Konuşma · Mülk · Görevler".
- SONRA (seçenek): satırın yanında "Birini ata" / "Giriş bilgisini gönder" gibi tek dokunuşluk eylem. Yeni davranış; "giriş bilgisini
  gönder" misafire mesaj göndermek demek → ayrı onay ister.
- Soru: bugünkü hâli kalsın mı?

**UX-11 — Telefonda 44 px.** Bulgular: B036 C003 C009 D006 A023 (ve bütün "40 px altı" bulguları). Bugün ortak bileşenler ve 40dc29b9'dan
sonra yerel ezmeler 40 px. Denetçinin "tek kural" önerisi 44 px. Önerim: şimdilik hayır; önce İE-2'nin "sonra" ölçümü.

**UX-12 — Raporlar.** Bulgular: C033 (C034 C036 aynı sayfanın kaynak / dönem farkları).
- ÖNCE: "91/100 · Mükemmel · Az veri: son 30 günde 3 konuşma — skor henüz kesin değil." (etiket eşiği `reports.ts:838` ≥ 90; az veri eşiği
  `reports/page.tsx:30` = 20).
- SONRA: 20 konuşmanın altında etiket yok: "91/100 · Az veri: son 30 günde 3 konuşma — skor henüz kesin değil."

## 9. Önerilen sıra

1. **İE-2 (onaysız, yazı değişmez):** "sonra" ölçümü (aynı betik) → yıkıcı düğme boşlukları (C010 C048) → menü kaydırma ipucu (C058) →
   takvimde masaüstü boş durum (aynı metin, D048) → tıklanabilir kart oku (C002 C019 B035).
2. **Cevaba göre İE-4:** önce misafiri etkileyenler (UX-1, UX-2, UX-9), sonra para / güven (UX-6, UX-8, UX-3), sonra yerleşim ve metin
   (UX-4, UX-5, UX-7, UX-12), en son UX-10 ve UX-11.
3. **Soru listesine eklenmesi önerilen (bu kayıtta bulundu, §3'te yok):** QR panel rozeti "Ev sahibine iletildi" okuyana (ev sahibine)
   üçüncü şahısla hitap ediyor (B034 B040; denetçi önerisi "Yanıtınızı bekliyor") · çıkmaz ekranlara tek düğme (§4 #11) · ürün içi tek
   sözlük (§4 #17) · 2FA'da QR (D029).

## 10. Kurucu kararları (11-13) ve uygulama
Her satır kırmızı-önce testli; misafire / müşteriye giden metin değişiklikleri kurucunun o maddeye verdiği cevaba dayanır.

| Madde | Kurucu kararı | Uygulama | Commit |
|---|---|---|---|
| UX-1 / UX-2 / UX-9 | onay | QR'da "Gönderildi" işareti · ev sahibi uyarısında Wi-Fi · konaklama dışı tek metin | `2651b9ad` |
| UX-3 | "düğme hep basılabilir" | kayıt ve plan düğmeleri soluk değil; onay boşsa istek gitmez, uyarı kutunun altında, odak kutuda | `2a40e62c` · `f7d4b5f3` |
| UX-4 | onay | telefonda konuşma ekranında Gönder hep görünür (yapışkan yazma alanı) | `bdefb896` · `f7d4b5f3` |
| UX-5 | sade dil | kurulum animasyonu: sade adımlar, tek anlamlı örnek, sahte düğmeler gerçek bağlantı | `e4d2e202` · `50a606ae` |
| UX-6 | onay | yasal sayfalar: gün-ay-yıl tarih (sürümden), Partita IVA etiketi, yıllık yenileme, cayma maddeleri | `11e9b3c1` · `50a606ae` |
| UX-7 / UX-13 | onay | bağlantı kartında tek ad + Hospitable açıklaması · QR acil işareti "Yanıtınızı bekliyor" | `a001a747` |
| UX-8 | "milyarlık siteler gibi" | deneme bandı kademeli (ilk yarıda yok · son 7 gün nötr · son 3 gün amber · son gün kalın; kapatma 24 / 12 / 4 saat) | `0a6f911c` |
| UX-10 b | "uzun uzun düşünerek" | Girişler: üç gün hep başlığıyla; eksik satırın yanında onu çözen ekrana bağlantı (D1 + D2) | `269ce1eb` |
| UX-10 a (D3) | "ilk 2'si kesinlikle olur" | Girişler satırından doğrudan atama (yalnız başlanmamış görev); sunucuda bayat satır ön şartı (409); atanan kişiye panoyla aynı e-posta | `1b6871fa` |
| "Giriş mesajını gönderin" (D5) | "ilk 2'si kesinlikle olur" | KOD HAZIR — onay penceresinde misafirin göreceği TAM metin + "geri alınamaz" uyarısı; otomatik gönderimle aynı talep damgası (çift gönderim yok); acil durdurma onurlandırılır; Haiku incelemesinin 6 bulgusu düzeltildi. Misafire giden ilk gerçek gönderim kurucuyla (Railway açılınca) | `1a48cc1d` · `d5c73b3c` · `c7090deb` · `5cad75e1` |
| UX-12 | "Skor, 20 konuşmadan sonra görünür. Şu an N konuşma var." | eşik altında skor yerine bu cümle (`PERF_MIN_CONVERSATIONS = 20`) | `534d1e4a` |
| UX-14 | onay | çıkmaz ekranlara tek sonraki adım; bağlantı düğmesi tek kuraldan | `325cffb9` |
| UX-15 | "Mülk" → "Daire" | arayüz metinleri (45 dosya); modele giden metinler ve Hospitable'ın kendi terimi bilerek dışarıda | `211cbbe3` |
| UX-16 | onay | iki adımlı giriş kurulumunda QR kod | `5abad5a4` |
| UX-11 | ölçüm | küçük yazı 88 → 62; dokunma hedefi ölçüsü satır içi bağlantıları da saydığı için değişmedi → gerçek uygulamada yalnız düğmeler telefonda ölçülecek | SIRADA |

**Ödeme ekranı (kurucu 11-13: "en yasal şekilde; onaylandığı mı kabul edildiği mi — kelime seçimleri önemli"):** üç ayrı, boş başlayan,
zorunlu kutu — "Ön Bilgilendirme Formu'nu okudum ve bu bilgileri aldığımı onaylıyorum." · "Mesafeli Satış Sözleşmesi'ni okudum ve kabul
ediyorum." · "Ücretli planın 14 günlük cayma süresi dolmadan hemen başlamasını onaylıyorum. Bu nedenle cayma hakkımı kaybedeceğimi kabul
ediyorum." Sunucu üçünü ayrı alan olarak ister; kartla deneme fiyatında hizmet deneme bitince başladığı için üçüncü kutu YOK (istemci ve
sunucu aynı kural). Metinler tek kaynakta (`src/lib/billing/consent-copy.ts`) ve onay kaydındaki `legalTextHash`'e girer. Sözleşmelerde
zımni onay ("kullanmaya başlamakla onay vermiş sayılır") kalktı; Gizlilik Politikası hiçbir yerde "kabul" ettirilmez ve sözleşmenin parçası
sayılmaz (KVKK); kayıt kutusu yalnız Kullanım Koşulları'nı kabul ettirir; yasal sayfa gövdesi 16 piksel (≈ 12 punto). Araştırma ve
avukata sorular: `scratchpad/handoff/ODEME-ONAY-HUKUK.md` (d-1 Paddle'ın asıl satıcı olması, d-5 kartla deneme). Commit `f72065dd`.
