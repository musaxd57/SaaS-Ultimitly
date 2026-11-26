# Grup B doğrulama (78 bulgu) — kod: `wt-dev`, yollar `src/` altına göre

**Özet.** Sayım: DOĞRU 21 · KISMEN 26 · ORTAM 3 · KARAR 15 · YANLIŞ 0 · GÖRSEL 13 (toplam 78; ayrıntı satırlar aşağıda).
En önemli gerçek kusurlar: (1) B037 ev sahibi yanıt kutusu "Wi-Fi şifresini yazmayın" diyor, oysa QR'da Wi-Fi verilir (kurucu 10-11) — eski/çelişkili uyarı; (2) B001/B007/B012/B017 model cevap vermeyince misafir ekranı gerçekten sessiz (yazıyor… yalnız POST sürerken; sonra hiçbir durum yok); (3) B033 çıkış yapmış misafire "giriş gününüzde tekrar okutun" gidiyor (tek metin iki durum); (4) B062 Girişler eksik satırları salt-okuma, eylem yok (bilinçli ama bedeli gerçek); (5) B075/B076 takvim telefonda yalnız hareketli günleri gösteriyor, satırlar tıklanmıyor.
Denetçinin en büyük yanılgıları: (1) "ev adı hiçbir yerde yok / dil yok" — ev sahibi "Misafire görünen ad" girerse başlık "<ad> · Misafir Asistanı" olur, arayüz dili tarayıcı diline göre tr/en seçilir (denetim ortamında ad boştu, betik tr-TR çalıştı); (2) "ekrana eylem yok" bulguları (B022/B027/B029) bilinçli kararlar — kapalı/engel ekranında dış bağlantı yok, kurtarma yolu ev sahibinde ("Cihaz kilidini sıfırla"); (3) B057 "silmede onay yok" yanlış: onay penceresi var; B059 "girdiler 36-38 px" yanlış: `Input`/`Select` `h-10` = 40 px.
Kök sebepler: **K-A** üst çubuk simgeleri ve küçük hedefler (bkz. B036); **K-B** model yokken sessizlik + K10 kararı (bkz. B001); **K-C** QR "taraf etiketleri / işletme ekibi" metni kurucu sorusunda (bkz. B002); **K-D** başlıkta ev adı yalnız "Misafire görünen ad" girilirse (bkz. B003).
Düzeltme türü kısaltmaları: metin = müşteri/misafire görünen yazı değişir (kurucuya sorulur) · görsel = yazı değişmez · davranış = yeni davranış/özellik.

| kimlik | hüküm | kanıt (dosya:satır — alıntı) | tür | not |
|---|---|---|---|---|
| B001 | KISMEN | `components/guest-chat/guest-chat.tsx:427-434` `{sending ? … t.typing}` yalnız POST sürerken; `:243` iyimser balon; `:301-302` başarıda `loadHistory` — "Gönderildi" işareti yok; hata dalı VAR (`:260-270` geri alma + `role="alert"` `:435-446`). Cevap tutulunca rota `record(null,true)` döner (`api/chat/[token]/route.ts:1082`, `:171-172`) ve istemci `reply`ı okumaz | davranış | **KARAR çarpışması:** önerilen "Mesajınızı aldım, en kısa sürede yazacağım" = `handoff_notice` sınıfı ("mesajınız kaydedildi", `docs/claude/kalici-urun-kararlari.md:64` K10 "Hiçbir şey gitmesin") + host adına söz (route.ts:162-165 eski metin gerekçesi). Çarpmayan: yalnız durum işareti ("Gönderildi" ✓) — cümle değil, iddia da etmiyorsa. "Gönderilemedi" hata dalı zaten var |
| B007 | DOĞRU | bkz. B001; model yok → `consumeDailyAiBudgetForQr`/model arızası dalında `record(null,true)` (route.ts:1076-1093), GET yalnız misafir satırını döner | davranış | iki mesaj: ortam (betik iki kez gönderdi); sessizlik kodda doğru |
| B008 | DOĞRU | `guest-chat-thread.tsx:80-83` balonda yalnız saat; işaret/üç nokta yok (üç nokta yalnız `sending`) | davranış | bkz. B001 |
| B012 | DOĞRU | bkz. B001/B007 (İngilizce: `typing` "Lixus AI is typing…" yalnız gönderim sırasında) | davranış | |
| B017 | DOĞRU | bkz. B001/B007 | davranış | üç mesaj = üç betik koşusu (ortam) |
| B018 | KISMEN | `guest-chat.tsx:82-86,225-229` aynı metnin yeniden denemesi tek `requestId` kullanır (sunucu dedupe `route.ts:761-765`); bilinçli ikinci aynı mesaj yeni kimlik alır | davranış | iki aynı soru betikten (ortam); "tekrarı önleyen yok" yanlış, kasıtlı tekrar engellenmez |
| B002 | KARAR | `guest-chat-copy.ts:51` "…işletme ekibi görüşmeye katılabilir." ; `:83` "Otomatik asistan + ev sahibi…"; EN `:109,:111` "Our team…" / "Automated assistant + host". `CLAUDE.md:533` "QR taraf etiketleri (Türkçe "İşletme ekibi" ×3 + alt yazı) … SORUDA"; `docs/claude/acik-isler.md:199` | metin | Kurucu 11-06 ev-sahibi-ağzı kuralı + bu satırlar açık soru. Bulgu DOĞRU, karar bekliyor. "+" ve "üçüncü şahıs" tutarsızlığı kodda gerçek |
| B009 | KARAR | bkz. B002 | metin | |
| B014 | KARAR | bkz. B002 (EN: "team" üstte, "host" altta — tutarsızlık kodda gerçek `:109,:111`) | metin | |
| B020 | KARAR | bkz. B002/B014 | metin | |
| B025 | KARAR | bkz. B002; ek: `boundElsewhere` metni "bize yazın" (`:67-68`) — ses aynı ekranda karışık | metin | |
| B045 | KARAR | önizleme sabit TR metinler: `guest-chat-thread.tsx:27-35`; bkz. B002 | metin | |
| B003 | KISMEN | `app/c/[token]/page.tsx:78` `placeName={ctx.property.guestDisplayName}`; `guest-chat-copy.ts:48` `titleFor` → "<ad> · Misafir Asistanı"; ayar `components/properties/property-form.tsx:109` "Misafire görünen ad (isteğe bağlı)". İç mülk adı bilinçli çıkmaz (`guest-chat-copy.ts:45` + `guest-chat-thread.tsx:25-29`) | metin/davranış | **K-D.** Denetim işletmesinde ad boştu (ortam); ev sahibi adı/logosu özelliği yok (yeni özellik) |
| B010 | KISMEN | bkz. B003 | metin | |
| B013 | KISMEN | bkz. B003 (EN başlık `:101` "Lixus AI Guest Assistant") | metin | |
| B019 | KISMEN | bkz. B003 | metin | |
| B026 | KISMEN | `guest-chat.tsx:365,407` başlık `title`; kod ekranı + `boundElsewhere` aynı başlığı kullanır; bkz. B003 | metin | |
| B031 | KARAR | `app/c/[token]/page.tsx:62-65` kapalı/etkin-değil ekranları "yalnız marka" (U4 yorumu `:75`); `guest-notice.tsx:21-26` mülk adı ASLA yazılmaz | metin | numaralandırma koruması: hangi eve ait olduğu bilerek söylenmez |
| B004 | KISMEN | `guest-chat-copy.ts:23-38` dil `Accept-Language`'dan, yalnız tr/en (Türkçe ilk tercih değilse İngilizce); seçici yok. Betik `locale="tr-TR"` (`scripts/claude-work/screenshots.ts:198`) | davranış | "yalnız Türkçe" yanlış (iki dil var); seçici yok = doğru; üçüncü dil = İngilizce'ye düşer. Misafirin mesaj dilinde cevap: `ai/language-signal.ts` |
| B011 | KISMEN | bkz. B004 | davranış | |
| B021 | KARAR | arayüz dili tarayıcı diline bağlı, mesaj diline değil (`guest-chat-copy.ts:6-9`, U2 kurucu 10-22); betik İngilizce bağlam açtı (`screenshots.ts:426-427`) | davranış | ortam + tasarım |
| B023 | KISMEN | bkz. B004; `boundElsewhere` EN metni var (`:100-101`), TR bağlamda TR görünür | davranış | |
| B028 | KISMEN | bkz. B004; `unavailable*`/`inactive*` iki dilde var (`:97-106,:128-133`) | davranış | |
| B030 | KISMEN | bkz. B004 | davranış | |
| B046 | KARAR | ev sahibi önizlemesi bilerek TR sabit: `guest-chat-thread.tsx:27-35` "ev sahibinin 'misafirin gördüğü ekran' önizlemesi bunları okur" | davranış | dil etiketi yok = doğru |
| B005 | DOĞRU | `guest-chat-copy.ts:83` "Kapı kodu gibi giriş bilgileri güvenlik için burada paylaşılmaz." yön yok; `guest-chat.tsx:497` `text-[11px]` | metin | |
| B015 | DOĞRU | EN `:111` cümle aynı biçimde biter | metin | |
| B006 | GÖRSEL | `guest-chat.tsx:497` `text-[11px]`; `guest-chat-thread.tsx:81` saat `text-[11px]`; "Gizlilik" satır içi `underline` `:499` | görsel | 11 px = ölçüm doğru |
| B016 | ORTAM | karşılama kartı yalnız `messages.length === 0` iken (`guest-chat.tsx:413`); EN koşusu aynı token'la ve önceki mesajlardan sonra (`screenshots.ts:426`) | davranış | karşılama mesajı ilk mesajla kayboluyor = kodda gerçek (telefonda uzun bekleyen bir davranış); "hazır soru düğmeleri" yok = yeni özellik |
| B022 | KARAR | `guest-chat.tsx:417-419` yalnız metin, form/düğme yok (`:463` `!boundElsewhere`); `CLAUDE.md` "QR: per-stay device binding" (kalici-kararlar); kurtarma yolu ev sahibi tarafında `ResetDeviceButton` (`app/(app)/guest-chats/[id]/page.tsx:281`) | davranış | misafir tarafı eylemsiz = bilinçli güvenlik |
| B024 | KISMEN | `guest-chat-copy.ts:67-68` sebep söyleniyor ("yalnızca ilk açılan cihazda"); uygulamanın adı yok (kanal bilinmeyen kimliksiz yüzey) | metin | "sebep açıklanmıyor" yanlış |
| B027 | KARAR | `guest-notice.tsx:24-26` "🚨 DIŞ BAĞLANTI YOK … Misafire verilebilecek TEK doğru yönlendirme ev sahibidir" ; 5 koşul tek metin (`:15-19`, numaralandırma koruması) | davranış | |
| B029 | KARAR | bkz. B027 (`page.tsx:70-72` `!ctx.open` → GuestNotice, bağlantısız) | davranış | |
| B032 | KISMEN | `guest-chat-copy.ts:103-105` "Şu an aktif bir konaklama görünmüyor" — "aktif" iç terim, ev sahibi ağzı değil; metinler var | metin | |
| B033 | DOĞRU | `page.tsx:70-73` `!ctx.open` tek `inactiveHint` ("giriş gününüzde … tekrar okutarak") hem girişten önce hem çıkıştan sonra | metin/davranış | çıkış yapmış misafire de gösteriliyor |
| B034 | KARAR | `app/(app)/guest-chats/page.tsx:~192` rozet "Ev sahibine iletildi" = `priority==="urgent"`; `api/chat/[token]/route.ts:171-172` "Ev sahibi QR sohbetleri panelinde 'Ev sahibine iletildi' işaretini … görür" | metin | rozet ev sahibine hitap ediyor: metin gerçekten tuhaf; kurucu K10 yalnız MİSAFİRE gitmeyeni söyler |
| B040 | KARAR | bkz. B034 (`guest-chats/[id]/page.tsx:152-155`) | metin | |
| B035 | KISMEN | kart tamamı `<Link className="block px-4 py-3 hover:bg-accent">` (`guest-chats/page.tsx:~187`); ok/ipucu yok, açıklama "Bir sohbeti açıp…" (`:~145`) | görsel | tıklanabilir = kodda doğru; görsel ipucu yok |
| B036 | GÖRSEL | **K-A kök:** `components/shell/panel-theme.tsx:52` `size-8` (32 px); `shell/app-shell.tsx:467-472` menü `p-2`+`size-5` (36 px); çıkış `Button size="sm"` `components/ui/button.tsx:22` `h-10 … sm:h-8` (mobil 40, masaüstü 32) | görsel | diğer "hedef <40 px" bulguları bu kökten: bkz. B036 |
| B037 | DOĞRU | `components/guest-chats/reply-box.tsx:~156-158` "Kapı kodu, Wi-Fi şifresi … buraya yazmayın — bunları Airbnb/Booking mesajından iletin." HER ZAMAN görünür (koşulsuz). Çelişen karar: `docs/claude/ai-guvenlik.md:374` "QR: KAPI KODU YOK, Wi-Fi VERİLSİN (kurucu kararı 10-11)"; `guest-chat-copy.ts:83` yorumu + `guest-chat-thread.tsx:30-31` "Wi-Fi artık bağlı cihazdaki misafire verilebilir" | metin | **gerçek kusur**: uyarı eski kuraldan kalma; kapı kodu kısmı geçerli, Wi-Fi kısmı değil |
| B038 | DOĞRU | `reply-box.tsx:~110` placeholder "Misafire yanıtınızı yazın (Enter gönderir, Shift+Enter yeni satır)…" | metin/görsel | telefonda kesilme = görsel; metin telefona uygun değil |
| B039 | KISMEN | rozet sebep taşımaz (priority yalnız `urgent`, `guest-chats/[id]/page.tsx:152`); bekleme süresi/vurgu yok. (Aynı soru iki kez = ortam) | davranış | |
| B041 | GÖRSEL | bkz. B036; `reply-box.tsx:~150-160` uyarılar `text-[11px]`; "Tüm sohbetler"/"Misafirin gördüğü ekran" düz `text-sm` bağlantı (`[id]/page.tsx:128-140`) | görsel | |
| B042 | KISMEN | metin `reply-box.tsx:~144-150` yalnız `!aiPaused` iken (kurucu 09-11 gerekçesi `:~134-141`); düğme `GuestChatResumeAi` yalnız `aiPaused` iken (`[id]/page.tsx:274-277`) — yani "şu an ekranda yok" doğru, yazıldıktan sonra çıkar; renk amber (`text-amber-700`), kırmızı değil | metin | davranış kurucu kararı; geri açma yolu = "AI yanıtlarını yeniden başlat" düğmesi (otomatik süre yok `resume-ai-button.tsx:11`) |
| B043 | KISMEN | önizleme salt okunur (`misafir-ekrani/page.tsx:89-95,112-117`), gönderim/yazıyor yok bilinçli; mesaj sessizliği bkz. B001 | davranış | |
| B044 | ORTAM | betik her viewport için ayrı mesaj gönderir (`screenshots.ts:317-319` döngü içinde, `sendGuestMessage`); masaüstü ilk mesajdan sonra, telefon ikinci koşuda çekildi | görsel | "güncelleme saati/yenile" yok = ayrı konu |
| B047 | GÖRSEL | bkz. B036; "Sohbete dön" `text-sm` bağlantı (`misafir-ekrani/page.tsx:93-95`) | görsel | |
| B048 | GÖRSEL | `app/(app)/tasks/page.tsx` filtre + paylaş düğmesi başlıkla aynı sayfada; temizlikçi görünümü aynı sayfa (`app-shell.tsx:214` staff yalnız /tasks) | görsel | yerleşim, yazı değişmez |
| B049 | GÖRSEL | bkz. B036; durum `Select` `h-9` (`task-board.tsx:~522`) = 36 px, "Yapamıyorum" `py-1 text-xs` (`:~611`) | görsel | |
| B050 | DOĞRU | `task-board.tsx:517-536` durum `<Select>` (done kartında da durur: `:~519` koşulsuz) + `:559-569` "Başladım/Bitti" düğmesi; yorum: "Durum kutusu yine durur (geri alma vb.)" | davranış/görsel | iki kontrol aynı işi yapar; "Bitti" `confirmDialog` ister (`:189-197`), liste ise doğrudan `setStatus` |
| B051 | KISMEN | `task-board.tsx:612-618` küçük kırmızı bağlantı; dokununca açılır: neden kutusu + "Ev sahibine bildir" / "Vazgeç" (`:576-610`), sonra "Ev sahibine bildirildi…" (`:574`) | metin/görsel | sonuç dokunmadan önce yazmıyor = doğru |
| B052 | GÖRSEL | bkz. B036 | görsel | |
| B053 | DOĞRU | `components/shell/app-shell.tsx:214` `if (isStaff) return i.href === "/tasks"` | davranış | tek öğeli menü kodda böyle; bilinçli sadeleştirme (tek sayfa) |
| B054 | GÖRSEL | bkz. B048; `tasks/page.tsx:215-224` bilgi kartı + filtreler | görsel | |
| B055 | GÖRSEL | bkz. B036; silme düğmesi `min-h-[40px] min-w-[40px]` (`task-board.tsx:~461`) zaten 40 | görsel | "çöp kutusu küçük" kısmen yanlış |
| B056 | KISMEN | tek dokunuş "Başladım→Bitti" YALNIZ atanan/staff için (`task-board.tsx:559-569` `!canManage`); yönetici kartında iki `Select` (`:519`, `:543`) — denetim yönetici görünümü | davranış | |
| B057 | KISMEN | `task-board.tsx:455-470` çöp kutusu yalnız `canManage`, done kartta da var; ONAY VAR: `confirmDialog` "Bu görevi silmek istiyor musunuz? Görev ve notları kalıcı olarak silinir." (`:289-296`); geri alma yok | görsel | "onay görünmüyor" yanlış (diyalog tıklayınca açılır) |
| B058 | ORTAM | `components/tasks/task-form.tsx:~101` `<Input type="datetime-local">` — biçim tarayıcı diline bağlı (en-US) | görsel | |
| B059 | KISMEN | `components/ui/input.tsx:10`/`select.tsx:14` `h-10` (40 px), buton `h-10`; küçük olan üst çubuk simgeleri (bkz. B036) | görsel | "giriş kutuları 36-38 px" yanlış |
| B060 | DOĞRU | `task-form.tsx:~60` Başlık `required` ama `Field` zorunlu işareti çizmez (`components/form-field.tsx`); placeholder yok | görsel/metin | |
| B061 | DOĞRU | `task-form.tsx:~121-126` Durum seçenekleri `awaiting_review`/`blocked` hariç → "Yapılacak/Devam ediyor/Tamamlandı" seçilebilir; `:21` `propertyId: properties[0]?.id` — daire ÖNCEDEN seçili; düğme formun en altı | davranış/görsel | "Tamamlandı yeni görevde anlamsız" doğru |
| B062 | KARAR | `components/arrivals/arrivals-list.tsx:6` "salt-okuma"; `app/(app)/arrivals/page.tsx:11` "(kurucu H1, 11-05; salt-okuma)"; `FactorLine` `:34-45` eylemsiz; altta yalnız `Konuşma · Mülk · Görevler` (`:121-133`, Görevler daireye filtreli) | davranış | bedel gerçek (eksik satırı çözmek için eylem yok) — yeni özellik, kurucuya sorulur |
| B063 | GÖRSEL | bkz. B036; alt bağlantılar `text-sm gap-3` (`arrivals-list.tsx:121`) | görsel | |
| B064 | DOĞRU | `app/(app)/arrivals/page.tsx:42` açıklama aynen | metin | |
| B065 | KISMEN | `arrivals-list.tsx:37-44` satır = nokta + `f.label` + " — eksik: " + `f.missing`; "açık/vade/görevin kapanması" etiketleri `lib/readiness-list/evaluate` içinde (okunmadı) | metin | düzenleme biçimi doğru; kelime kaynağı doğrulanmadı |
| B066 | DOĞRU | `arrivals-list.tsx:76-82` günler yalnız satırı olanlardan kurulur; boş gün başlığı/"giriş yok" yok (genel boş kart yalnız hiç satır yoksa `:71-74`) | davranış | ortam: seed'de yalnız bugün giriş var; kod davranışı yine de doğru |
| B067 | KISMEN | bağlantılar `text-primary hover:underline` (`arrivals-list.tsx:123,127,132`) — renkli, çizgi yalnız hover; "Ayrıntılar" `<details><summary>` `text-xs` (`:108-111`) | görsel | |
| B068 | DOĞRU | `app/(app)/hazirlik/page.tsx:~104-108` boş durumda düz metin; aynı dosyada `LinkButton` kullanımı var (`:81`) ama boş durumda yok | davranış | |
| B069 | GÖRSEL | bkz. B036; aralık düğmeleri `LinkButton size="sm"` (`hazirlik/page.tsx:79-88`) | görsel | |
| B070 | KISMEN | `components/supply/supply-stock-form.tsx:58-72` tam satır `<button aria-expanded>` (açılır); sağda "opsiyonel · düzenle" veya "N kalem girili · düzenle"; ok yok | görsel | tıklanabilir = doğru; stok sayısı girili kalemse görünür (seed boş) |
| B071 | DOĞRU | `hazirlik/page.tsx:~104-108` "Malzeme profili tanımlı değil… Mülkler → daire → “Malzeme Profili”nden … liste burada oluşsun." | metin | |
| B072 | DOĞRU | `app/(app)/cancellations/page.tsx:157` açıklama aynen | metin | |
| B073 | DOĞRU | `cancellations/page.tsx:208` "iptal/red/süresi-dolmuş" aynen | metin | |
| B074 | GÖRSEL | bkz. B036; filtre hapları `Link` (`cancellations/page.tsx`) | görsel | |
| B075 | DOĞRU | `app/(app)/calendar/page.tsx:172-174` `agendaDays … .filter(arrivals>0 \|\| departures>0)`; yorum `:233-234` "Yalnız hareketli günler"; dolu ama hareketsiz geceler listede yok | davranış | bilinçli ajanda tasarımı; "1 dolu" yalnız hareketli günlerde |
| B076 | DOĞRU | ajanda satırları `<p>` (`:262-281`), masaüstü `<p>` (`:328-336`) — `Link` yok | davranış | yeni özellik |
| B077 | GÖRSEL | bkz. B036; daire hapları `px-3 py-1 text-xs` (`:200`) | görsel | |
| B078 | KISMEN | `:328-336` `truncate` + `title="Giriş: misafir — daire"` (tooltip); rozet `text-[10px]` (`:319`); masaüstü "N dolu" (`:322`, `title="…N/M daire dolu"`) ↔ telefon "N/M dolu" (`:256`) AYRI işaretleme | görsel | "1 dolu"↔"1/2 dolu" farkı ayrı bileşen: doğru |
