# Grup D doğrulama (ayarlar sekmeleri + yeni hesabın boş sayfaları) — 58 bulgu

Özet sayılar: DOĞRU 22 · KISMEN 17 · ORTAM 2 · KARAR 0 · YANLIŞ 0 · GÖRSEL 17 (kök sebep tek: dokunma hedefi / yerleşim).
En önemli gerçek kusurlar: (1) Plan kartlarında yalnız ad/fiyat/daire sınırı var, özellik/KDV/öneri yok, pasif "Bu plana geç"in nedeni düğmenin yanında değil onay satırında (D012/D013/D014). (2) Bağlantılar kartında aynı şey 5 adla geçiyor (anahtar/token/Personal Access Token/Access Token), adımdaki adres bağlantı değil, "Hospitable" hiç açıklanmıyor (D001/D002/D005). (3) 2FA kurulumunda QR yok, yalnız elle anahtar (D029). (4) Boş takvim/girişler/gelen kutusunda sonraki adıma götüren düğme yok; takvimde masaüstünde boş durum mesajı hiç yok (D036/D047/D048/D050). (5) Otomasyon Tercihleri / AI ve takvim gizliliği metinleri iç jargon dolu; AI sekmesinde aynı açıklama üç kez (D017/D018/D024/D007).
Denetçinin en büyük yanılgıları: (1) "Tam erişim (daire sınırı yok)" ve tarihsiz deneme: ekran görüntüsü betiği boş işletmeyi `"seed"` ile açtı, Subscription satırı oluşmadı; gerçek kayıt 14 günlük deneme satırı yazıyor ve gün sayısı gösteriliyor (D011/D053). (2) Yıllık plan "yok": yıllık fiyat env'i CI'da tanımsızdı (D013). (3) "Anahtarların kaydet düğmesi yok / pasif": anahtarlar kendiliğinden kaydediyor; Kaydet yalnız değişiklik olunca etkin (D023).

Not: telefonda `Button` size default/sm = `h-10` (40 px), `icon` = `size-10` (src/components/ui/button.tsx:20-24); "40 px altı" ölçümleri çoğunlukla ham onay kutusu (`size-4`/`h-4 w-4`), `h-9` select/input, `h-8` plan düğmeleri ve satır içi bağlantılar — bkz. D006.

| kimlik | hüküm | kanıt | düzeltme türü | not |
|---|---|---|---|---|
| D001 | KISMEN | settings/page.tsx:418 başlık "Airbnb / Booking Bağlantısı"; hospitable-connect-card.tsx:152 yalnız "Bağlı değil" kutusunda "(Hospitable üzerinden)"; 199-203 plan uyarısı Hospitable'ı hazır varsayıyor | metin | Hospitable'ın ne olduğu hiçbir yerde yazmıyor. CLAUDE.md "Hospitable'a özgü yeni ekran/özellik yapılmaz": mevcut karta açıklama cümlesi yeni ekran değil, çarpmaz; ama yeni Hospitable'a özgü akış (kayıt yönlendirme vb.) çarpar |
| D002 | DOĞRU | hospitable-connect-card.tsx:161 "bağlantı anahtarı (Access Token)"; 219 "Bağlantı anahtarı nasıl alınır"; 242 "Token"; 254 "Hospitable Personal Access Token"; 260 yer tutucu "Hospitable access token"; 235 "kutuya yapıştırın" | metin | |
| D003 | KISMEN | hospitable-connect-card.tsx:150 sarı "Bağlı değil" + 199 sarı "Önce:" kutusu, form 247'de altta; ama ikinci kutu "OAuth" açıksa "Hospitable ile Bağlan" düğmesini (205-211) önce gösteriyor | görsel | Sayfa uzunluğu görüntüyle ölçülür; sıra kodda doğru |
| D004 | DOĞRU | :201 "API erişimi içeren (ücretli) bir planda"; 151 "çekilemez/gönderilemez"; 238 "tam-yetkili yönetici"; 175-176 "arayüzde tekrar görüntülenmez"; 242 "uçtan uca şifreli" | metin | |
| D005 | DOĞRU | :222 `<strong>my.hospitable.com</strong>` düz kalın, `<a>` yok; 223-224 "Apps (veya Settings → Integrations) → API access → Access tokens" | metin (bağlantı eklemek = yazı değişmez, görsel/davranış küçük) | |
| D006 | GÖRSEL | :264 "Bağla" `Button` varsayılan `h-10`=40 px (button.tsx:20); Input h-9; ham `size-4` onay kutuları (ical-privacy-form.tsx:55 `size-4`) | görsel | Kök sebep; diğer "dokunma hedefi" bulgularında "bkz. D006". Telefonda sekme seçici/üst çubuk ikonları da kod dışı ölçümle |
| D007 | DOĞRU | ical-privacy-form.tsx:62-66 "iCal… abone edilir… (KAPALI)… KVKK veri minimizasyonu; blok-tarih için ad gerekmez" | metin | |
| D008 | GÖRSEL | bkz. D006; timezone-form.tsx:~80 select `h-9`; onay kutusu `size-4` | görsel | |
| D009 | DOĞRU | timezone-form.tsx:88 `variant="outline"` + Globe ikonu, `disabled={busy \|\| !dirty}`; ical-privacy-form.tsx:76 varsayılan (dolu) + Check ikonu `disabled={busy \|\| !dirty}` | görsel / metin | Pasiflik "değişiklik yok" demek, tasarım gereği; neden metni yok. E-posta kartı (alert-email-form) okunmadı |
| D010 | DOĞRU | timezone-form.tsx:72 "Saat dilimi (IANA)"; 27 `Intl.supportedValuesOf("timeZone")` (alfabetik, Chromium'da Africa/Abidjan ile başlar — doğrulanamadı, tarayıcı); varsayılan 16 "Europe/Istanbul"; 62-63 '"Bugün" gün sınırları' | metin + davranış (kısa/Türkçe liste) | Açıklama Türkiye için "değiştirmeniz gerekmez" diyor |
| D011 | ORTAM | paddle-plans.tsx:594 `grandfathered ? "Tam erişim (daire sınırı yok)"`; subscription.ts:95-101 Subscription satırı YOKSA grandfathered; screenshots.ts:250 `createUserWithMembership(..., "seed")` abonelik yazmıyor; gerçek kayıt register/route.ts:250-252 `tx.subscription.create(newTrialSubscriptionData())` (pro, trialing, trialEndsAt) | metin (yalnız kayıtsız eski hesap için) | Gerçek deneme hesabı "Pro — ücretsiz deneme, N gün kaldı" görür (paddle-plans.tsx:596-606). Seed işletmesi (prisma/seed.ts) de abonelik satırı yazmıyor → "Tam erişim" |
| D012 | DOĞRU | paddle-plans.tsx:823 `disabled={!ready \|\| !activePriceId \|\| !accepted \|\| …}`; neden yalnız onay satırı 652 "Ücretli plana geçmeden önce bu onay gereklidir." (kartların üstünde, `text-xs`); düğme yanında neden yok | metin / davranış | Hazır değilse etiket "Yükleniyor…/Sayfayı yenileyin" (833-836) |
| D013 | KISMEN | paddle-plans.tsx:795-801 kartta yalnız ad, fiyat, `${n} daireye kadar`; yıllık anahtar 742 `annualAvailable` = `defaultPlans().every(p => paddleAnnualPriceByCode[p.code] !== "")` (settings/page.tsx:562) — CI'da yalnız PADDLE_PRICE_BASLANGIC/PRO/ISLETME verilmiş (claude-work.yml:47-49), yıllık id yok | metin / yeni davranış | Özellik farkı ve KDV kartta yok: DOĞRU. "Yıllık yok": ORTAM (env eksik) |
| D014 | DOĞRU | paddle-plans.tsx:790-799 yalnız `isCurrent` vurgusu; "önerilen" ya da daire sayısına göre öneri kodu yok | davranış | Ürün kararı arayan "fiyat/özellik" belgesi `docs/claude/fiyat-ve-ozellikler.md` |
| D015 | GÖRSEL | bkz. D006; paddle-plans.tsx:646 onay kutusu `h-4 w-4`; plan düğmeleri `h-8` (:823) | görsel | |
| D016 | DOĞRU | paddle-plans.tsx:868-871 `text-[11px]` "Ödeme, satıcı olarak Paddle üzerinden… İstediğiniz zaman iptal edebilirsiniz." | metin | |
| D017 | DOĞRU | settings/page.tsx:331,357,374,392 dört kart yalnız paragraf; anahtarlar 270-312 "Otomasyon durumu" kartında; 340-352 açıklama aynı şeyi tekrarlıyor | metin | |
| D018 | DOĞRU | page.tsx:336 "güvenlik kapısından geçen"; 345 "bağımsızdır"; automation-prefs-form.tsx:270 "tetiklemez"; 271 "kusursuz değildir… varsayılan KAPALI"; page.tsx:348,370 `{isim}` | metin | |
| D019 | GÖRSEL | bkz. D006; automation-prefs-form.tsx:159,176 `size-4`; ai-test-card.tsx:132 çipler | görsel | |
| D020 | KISMEN | night-hours-form.tsx:76-88 `<Select>` 24 saat; bulk-times-form.tsx:92,100 `type="time"` (AM/PM tarayıcı diline bağlı = ORTAM); etiketler 74,89 "Check-in / Check-out" İngilizce = gerçek | metin | Biçim farkı tarayıcıya göre, başlık İngilizce'si gerçek |
| D021 | DOĞRU | schema.prisma:130-131 `autoReplyStartHour/EndHour @default(0)`; night-hours-form.tsx:73 "eşitse tüm gün" yalnız açıklamada; gelen kutusu rozeti "7/24" (inbox/page.tsx:248) | metin | settings/page.tsx:421-422 kod yedeği `?? 9` DB'de hiç devreye girmez (varsayılan 0) |
| D022 | DOĞRU | bkz. D017 (page.tsx:331-398) | metin / yerleşim | Anahtar kontrolü kasıtlı yalnız "Otomasyon durumu"nda (yorum 266-269) |
| D023 | KISMEN | Kaydet: automation-prefs-form.tsx:322, night-hours-form.tsx:92, ai-voice-form.tsx:~117 (3) + bulk-times-form.tsx:109 "Tüm dairelere uygula"; anahtarlar `auto-reply-toggle.tsx:56` `fetch PATCH /api/settings` ile anında kaydeder | metin | "Anahtarlarda kaydet yok" tasarım gereği otomatik kayıt; Kaydet etkin değilken (dirty=false) soluk — nedeni metin yok |
| D024 | DOĞRU | automation-prefs-form.tsx:270-271 "tetiklemez… Mesaj çözümlemesi kusursuz değildir; … varsayılan KAPALI" | metin | |
| D025 | KISMEN | page.tsx:331 "AI misafir mesajlarını yanıtlasın", inbox/page.tsx:263 "Oto-yanıt", night-hours "Oto-yanıt"; "Check-in/Check-out" vs "Giriş… mesajı" (page.tsx:374) | metin | "yapay zekânın beklemesi" ayrıca doğrulanmadı |
| D026 | KISMEN | bkz. D020 | metin | |
| D027 | GÖRSEL | bkz. D006 | görsel | |
| D028 | ORTAM | account-card.tsx:96 `Giriş e-postanız: {email}` kullanıcının kendi e-postası; `demo@guestops.ai` prisma/seed.ts:74 tohum verisi | — | Kod başka marka basmıyor |
| D029 | DOĞRU | two-factor-card.tsx:241-245 "Kurulum anahtarı gir… anahtarı yazın" + gruplanmış `secret`; 281-282 "(anahtar türü: Zaman bazlı / Time based)"; dosyada `qr`/`otpauth` yok | davranış | Sunucu yalnız `secret` döndürüyor (62-63) |
| D030 | KISMEN | two-factor-card.tsx:287 küçük not; AMA 2FA açıldıktan sonra kurtarma kodları var (34-39, 170-225 "Kodları oluştur/yenile", "kullanılmamış" sayacı); kod yazma ekranı kurulum adımında değil kurulum sonrası kartta. Destek yolu: yönetici "2FA'yı sıfırla" (CLAUDE.md kimlik bölümü) — kullanıcıya gösterilmiyor | metin | Kurulum akışında kodlardan söz edilmemesi doğru |
| D031 | GÖRSEL | bkz. D006 | görsel | |
| D032 | KISMEN | delete-account-card.tsx:94-97 uyarı düğmeden ÖNCE (düğme 110), bağlantı değil `<strong>`; düğme etkin (105-110, sunucu reddeder) | metin / görsel | "Kutunun en altında" yanlış; "bağlantısız, düğme etkin" doğru |
| D033 | GÖRSEL | bkz. D006; dashboard/page.tsx:129,136,143 CTA düğmeleri | görsel | |
| D034 | GÖRSEL | onboarding-guide.tsx:53 katlanabilir kart (DISMISS_KEY "katlanmış"); açıklamalar uzun (dashboard/page.tsx:119-143) | görsel | |
| D035 | DOĞRU | dashboard/page.tsx:119 "…bağlayın ya da… takvim bağlantısını ekleyin"; 133 "Hesap bağlantısıyla… takvim bağlantısı için daireyi önce elle ekleyin"; başlık onboarding-guide.tsx:201 "kurulumun 3/6 tamam" (iyelik) ↔ adımlar "-iniz" | metin | Hitap karışık (kurulumun / -iniz) |
| D036 | DOĞRU | inbox/page.tsx:413-425 bağlantı yokken yalnız `LinkButton /inbox/new` "Yeni konuşma"; metin "bağlantıyı kurunca… akar" bağlantısız | davranış + metin | |
| D037 | GÖRSEL | bkz. D006 | görsel | |
| D038 | GÖRSEL | inbox/page.tsx filtre/arama satırı EmptyState'ten önce | görsel | |
| D039 | KISMEN | inbox/page.tsx:263 `Oto-yanıt (${activeWindow})`, activeWindow "7/24" (248); gerçek `AutoReplyToggle` düğmesi, `title` ipucu 268; "Oto-yanıt testi" auto-reply-test-button.tsx:134 | metin | Durum bilgisi değil düğme; ipucu yalnız üzerine gelince |
| D040 | GÖRSEL | bkz. D006; link-button.tsx:22 sm `h-10 sm:h-8` | görsel | |
| D041 | KISMEN | properties/page.tsx:~75 başlıkta "Yeni mülk"; 91-99 `!channelConnected` ise "Airbnb / Booking'i bağlayın" (default) + "İlk mülkü ekle" `variant="outline"` — iki koyu birincil iddiası: "Yeni mülk" + "bağlayın"; "İlk mülkü ekle" çerçeveli | görsel | "Yeni mülk" ile "İlk mülkü ekle" aynı eylem: doğru |
| D042 | GÖRSEL | bkz. D006; knowledge/page.tsx:96 "Mülk ekle" `size="sm"` | görsel | |
| D043 | DOĞRU | knowledge/page.tsx:79 uzun açıklama "Karşılama, giriş ve çıkış mesajlarını… Şablonlar bölümünü…" boş durumda da duruyor | metin | |
| D044 | KISMEN | tasks/page.tsx:264-277 "Görev yok / Yeni rezervasyonlarda görevler otomatik açılır… elle görev ekleyebilirsiniz" + "Görev ekle" düğmesi (yalnız yönetici); bağlantıya yönlendirme yok | metin | |
| D045 | GÖRSEL | bkz. D006 | görsel | |
| D046 | KISMEN | shell/app-shell.tsx:481 `aria-label="Çıkış yapın"`, 483 `<span className="hidden sm:inline">Çıkış</span>` → telefonda yalnız ikon | görsel | Ekran okuyucuda etiket var |
| D047 | DOĞRU | calendar/page.tsx:237-241 EmptyState yalnız metin, düğme yok | davranış + metin | |
| D048 | DOĞRU | calendar/page.tsx:237 EmptyState `md:hidden` blokta; masaüstü ızgara 290 boş durum yok | davranış | |
| D049 | GÖRSEL | bkz. D006; calendar ay okları `size-8` (:225) | görsel | |
| D050 | DOĞRU | arrivals-list.tsx:71 "Bugün ve sonraki iki günde giriş yok." yalnız metin | davranış | |
| D051 | DOĞRU | arrivals/page.tsx:42 "Temizlik yalnız çıkıştan sonraki “bitti” kaydıyla hazır sayılır; bilinmeyen hazır gösterilmez." | metin | |
| D052 | GÖRSEL | bkz. D006 | görsel | |
| D053 | ORTAM | bkz. D011; ayrıca gerçek denemede gün sayısı üç yerde: paddle-plans.tsx:596-606, app/(app)/layout.tsx:81-83 kenar çubuğu "Pro · deneme Ng", layout.tsx:110 TrialBanner; bitiş TARİHİ yazılmıyor (yalnız gün). Kenar çubuğu "Abonelik: Tam erişim" = grandfathered planName (subscription.ts:101) | metin (tarih eklemek) | Deneme e-postaları: lib/billing/trial-reminders.ts var (içerik okunmadı) |
| D054 | DOĞRU | bkz. D012 | metin / davranış | |
| D055 | KISMEN | bkz. D013 | metin | |
| D056 | DOĞRU | bkz. D014 | davranış | |
| D057 | GÖRSEL | bkz. D006; paddle-plans.tsx:646 | görsel | |
| D058 | DOĞRU | paddle-plans.tsx:868-871 `text-[11px] text-muted-foreground`, iptal cümlesi sonda | metin | Paddle satıcı olarak yazılması hukuki gereklilik olabilir (kurucuya sor) |
