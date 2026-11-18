# İnceleme 2026-11-18 — Codex 11-17 raporu (957e91c1 denetimi): kodda doğrulama + durum

> Kaynak (AYNEN): `docs/KURUCU-TALIMATI-2026-11-18-codex-raporu-ve-orkestrasyon.md`. Bu dosya o raporun madde madde KODDA doğrulanmış
> hâli ve durumudur. Yöntem: yedi doğrulama ajanı (yalnız okuma) → her hüküm ana oturumda kodda / kırmızı-önce testle yeniden sınandı →
> düzeltme. Codex önerisi karar değildir: daha doğru çözüm varsa o uygulandı ve gerekçesi yazıldı.
> Çalışma düzeni (kurucu 11-18): Claude orkestratör; kod yazan Opus ajanları ayrık çalışma ağacında, push'suz; her çıktı satır satır
> incelendi (ör. ödeme-2'de ajanın eklediği tavan dalında açlık kusuru bulundu, geri gönderildi); en zor parça (ödeme-1) ana oturumda yazıldı.

Durum simgeleri: ✅ düzeltildi (commit) · 🔧 yazılıyor / incelemede · 📋 planlı (dalga) · ❓ kurucu kararı · ➖ kod değişikliği gerekmiyor.

## 1. En önemli üç bulgu (Codex'in sırası: önce 1, sonra 2 ve 3 paralel)

| # | Codex iddiası | Kodda | Açılışta tetiklenir mi | Durum |
|---|---|---|---|---|
| ÖDEME-1 | Ödeme alınmış, abonelik bağlanmamışken 10 dk kilit düşünce yeni ödeme işlemi açılıyor | DOĞRU — iki kipte de kırmızı-önce testle yeniden üretildi (`checkout-paid-awaiting.test.ts`). Niyet kapalı kipte işlem olayı hiçbir şey yazmıyordu | Evet (anahtar gerekmez) | ✅ `12e5c1f1` + `9c5c013a` — "ödeme alındı, abonelik bekleniyor" süreyle kapanmayan kayıt; tasarım `docs/TASARIM-2026-11-18-odeme-alindi-abonelik-bekleniyor.md` |
| ÖDEME-2 | Yeniden işleme işi en eski 200 kaydı seçip vadeye sonra bakıyor; arkadaki vadesi gelmiş olay hiç denenmiyor, tur işareti yine ilerliyor | DOĞRU (`paddle-replay.ts`) | Evet | ✅ `57557676`, `b6fa2706` — vade koşulu sorguda, sayfalama; tavanı aşan tur birkaç koşuya yayılan tek mantıksal tur (imleç + dondurulmuş an), tavan alarmı |
| MESAJ-3 | Dış hedefi olmayan elle açılmış konuşmada cevap yalnız kaydediliyor ama "Mesaj gönderildi" deniyor | DOĞRU (`host-send.ts` `skipped` alanını okumuyor) | Evet | ✅ `8b4d077e`, `344ac34d`, `2fd04d7d` — tek teslim sonucu (`lib/delivery-outcome.ts`: yalnız kayıt · QR'da görünür · sıraya alındı · kanal kabul etti · doğrulanamadı · gitmedi); ekran ve karar paneli duyuruyu bu sonuçtan seçer; yerel kayıt düşerse başarı dönülmez. Yeni ev sahibi metni ❓ Y-1 |

Codex'in uzun vadeli önerisi (ÖDEME-2: olay başına "sonraki deneme zamanı" sütunu) migration ister → migration turu adayı (§6). Şemasız
düzeltme birebir aynı seçimi yapıyor (kâhin testi) ve bugünkü ölçeğin çok üstünü taşıyor.

**Kanıt (dalga 1):** her düzeltme kırmızı-önce testle başladı; mutasyon (ayrık çalışma ağacı, kontrol koşusu yeşil): ödeme-1 39 / 41 →
yaşayan iki mutant eşdeğer değildi, eksik kollar pinlendi (`8f2fe356`), yeniden koşuda öldü · ödeme-2 52 / 53 → pinlendi, yeniden koşuda
öldü · mesaj doğruluğu 31 / 31. Opus sert incelemesi (ödeme-1): P1 / P2 yok; altı P3 + iki "emin değilim" işlendi (`6bd7ff79`).

## 2. "Kalan önemli açıklar" 1–7

| # | İddia | Kodda | Açılışta | Durum |
|---|---|---|---|---|
| 1 | Plan değişikliği sürerken abonelik değişirse işlem eski aboneliğe gidiyor | DOĞRU, pencere 1–3 sn (`plan-change/route.ts`) | Evet (`PADDLE_PLAN_CHANGE_ENABLED`) | ✅ `1931e574`, `06def63b` — PATCH'ten hemen önce yeniden okuma (ret: var olan metin), PATCH sonrası değişim → denetim işareti + operatör alarmı (202 dalı dahil). Aynı sınıf "devam ettir": `2df90d3f` (belirteç aboneliği bağlar) |
| 2 | Onaylıdan "bekliyor"a dönen rezervasyona kuyruktaki giriş mesajı gidiyor | DOĞRU, yalnız kalıcı kuyruk yolunda (`worker.ts lifecycleVeto`) | Hayır (kuyruk kapalı) | ✅ `c29e45a8` — durum kuralı tek kaynakta (`lib/lifecycle-status.ts`); işçi onaylı olmayan (iptal de olmayan) rezervasyonun satırını İPTAL ETMEZ, 20 dk arayla yeniden bakmak üzere bekletir; yeniden onaylanınca gider. Doğrudan yolun bugünkü davranışıyla eşitlik (göndermez, sonraki geçişte yeniden bakar). ❓ yalnız bilgi: iptal isteseydiniz yeniden onaylanan misafire giriş bilgisi hiç gitmezdi (tek anahtar) |
| 3 | Misafire ulaşmamış ev sahibi cevabı açık ihtiyacı gizliyor | DOĞRU (`HOST_OUTBOUND_WHERE` teslim durumuna bakmıyor; dört okuyucu) | Kuyruk yolu hayır; yerel cevap evet | ✅ `2f819d23` — KESİN gitmemiş (başarısız / iptal) cevap dört okuyucuda da ihtiyacı kapatmaz (tek kaynak `outbox/undelivered.ts`) · ❓ yerel / doğrulanamayan cevap (S-1, S-2) bugünkü gibi kaldı |
| 4 | Kuyrukta ihtiyaç güncellemesi düşerse teslim etkisi yine damgalanıyor | KISMEN — damga doğru; onarıcıda yeniden kapatma adımı hiç yok; etki güvenli yönde (fazladan açık iş) | Hayır | ✅ `79b0c89e` — yeniden kapatmanın sonucu teslim etkisine katılır; onarıcıda yeniden kapatma adımı var |
| 5 | QR'da süren isteğin tekrarı mesajı kaybettirebiliyor (`deduped: true`) | DOĞRU, tetik dar (üç koşul birlikte) | Evet (`GUEST_CHAT_ENABLED`) | ✅ `26fdb86a` — süren istek `pending` (kayıt yok); ekran balonu ve kimliği korur, aynı kimlikle 3 / 6 / 12 sn arayla yeniden sorar (kilit ömrü aşılınca metni geri verir). Kilidini canlı bir işçiye kaptıran eski işçi de `pending` der. Yeni misafir metni yok |
| 6 | Elle görev oluşturma tekrar güvenli değil | DOĞRU (`api/tasks` işlem kimliği okumuyor) | Evet | ✅ `a8f0e9d9` — form başına istek kimliği; şemasız (var olan `dedupeKey` + danışma kilidi + tek işlem); aynı kimlik ikinci görev açmaz (200 + ilk görev), aynı kimlik + farklı içerik açık hata (kurucu 10-15 kuralı) |
| 7 | Otomatik mesaj sırasında 200 gönderilemeyen kayıt 201.'yi kalıcı engelliyor | DOĞRU (imleç her geçişte sıfırlanıyor) | Evet (büyük portföy) | ✅ `2e75ec00` — metni olmayan daire aday sorgusuna hiç girmez; ilk dört sayfa her geçişte baştan, kalan dört sayfa kalıcı imlecin ardından okunur (imleç incelenen son adaya ilerler, sona varınca başa sarar; hız sınırıyla yarıda kalan geçişte yazılmaz); okuma sınırı arkada aday bırakırsa operatöre alarm. Dilim sonu incelemesi (Opus) bir köşe buldu, yayına girmeden düzeltildi (`1791afc1`): aynı rezervasyon iki dairede kayıtlıysa eskiden ilk satır belirliyordu, yeni tarama kardeş satırın dairesinin metnini gönderebiliyordu → "rezervasyon başına tek aday = ilk satır" kuralı açık yazıldı; misafire giden küme yayındaki kodla aynı. Misafire giden küme aynı (eski seçim testte kâhin), yalnız sıra değişir |

## 3. Öteki doğrulanan eksikler

| Konu | Kodda | Durum |
|---|---|---|
| Karar cevabının bağı mesajdan ayrı yazılıyor (G2-01) | DOĞRU — bağın kalıcı yazılmadığı dört yol | ✅ `772374f0`, `105dbd80` — bağ mesaj satırıyla AYNI işlemde yazılır (`onRecorded`); karar kapanışı bağı silmez |
| Karar + kuyruk: kuyruğa kabul = tamamlandı (K2-01) | DOĞRU, belgelenmiş engel; iki anahtar birlikte açılamaz | ✅ `a37335f7`, `fe0745cb` — karar mesajı kalıcı kuyruk açıkken de DOĞRUDAN yoldan gider (emsal elle giriş mesajı); kart gerçek gönderim sonucuna göre kapanır. İnceleme düzeltmesi: doğrudan yol operatörün "teslimatı durdur" frenini atlıyordu → fren çekiliyken gönderilmez, kart yeniden açılır |
| Onay ile gönderim arası rezervasyon iptali (G2-02) | KISMEN — doğrudan yolda ms; asıl açık kuyrukta (ev sahibi satırı vetodan muaf) | ✅ `a37335f7` — kilitten sonra, gönderimden hemen önce rezervasyon taze okunur; iptalse gönderim yok, kart yeniden açılır, var olan uyarı. Kalan pencere okuma → kanal isteği (ms; otomatik mesajlardaki bilinçli pencereyle aynı sınıf) |
| Kuyrukta son kontrol → gönderim penceresi | KISMEN — pencere Codex'in tarifinden farklı yerde (yanıt satırında varlık vetosu ↔ son talep; otomatik mesajda son talep ↔ gönderim) | 📋 migration turu — kalıcı çözüm `MessageOutbox.cancelRequestedAt` (gönderime bağlanma tek atomik koşullu yazım; silme / iptal yolları talep edilmiş satırı işaretler). Kuyruk açılışta kapalı; açılmadan önce yapılır |
| Açık ihtiyaç listesi ilk 500 / konuşma sayfası 20 satır | DOĞRU | ✅ `0bf2d7a3`, `6b167235` — "ev sahibi yazdı" süzgeci sorguya indi, tavan yalnız adaylara, aşımda alarm (eski ve yeni yol rastgele verilerle aynı kümeyi veriyor); konuşma sayfasında açık işlerin HEPSİ görünür, sayaç toplamdan. Bilinen sınır: aday süzgeci öğenin kayıt anına bakar (15 dk pay) — sağlayıcı saati bundan fazla ilerideyse açık öğe aday dışında kalabilir. ❓ "N kapanmış iş gizlendi" / "Tümünü göster" metni |
| Görev saati sunucu saat dilimine göre | DOĞRU (sunucu UTC ise 15:00 → 18:00) | ✅ `2bcdf87a` — formun dilimsiz saati İŞLETMENİN diliminde okunur (oluşturma + güncelleme); dilim taşıyan değer bugünkü gibi. Var olan kayıtlar değişmez. Not: tam UTC 00:00 / 12:00'a düşen saat 1 ms ileri alınır ("saatsiz gün" çapasıyla karışmasın) — kalıcı çözüm migration turunda (vade hassasiyeti) |
| Giriş: hesap başına 20 deneme sınırı eşzamanlı istekte gevşiyor | DOĞRU (~54 / 15 dk; sınır dalgasında doğru parola tanınmayan cihazdan girebiliyor) | ✅ `753aa3b4` — hak bcrypt'ten ÖNCE atomik ayrılır; doğru parolada / doğrulama yapılamadığında yalnız ayrıldığı pencereye iade. İnceleme düzeltmesi: başarısız daldaki zamanlama eşitliği turu okumaya düşmüştü → denetim yazımıyla aynı sınıfta yazma |
| Bayat oturumun kod isteği yeni kodu eziyor | DOĞRU, etkisi düşük | ✅ `44ca97de` — kod yazması oturum sürümüne koşullu; tutmazsa kod / e-posta yok, 401 |
| Sıfırlama e-postası canlılık kapısı kendi kaydına bakmıyor | DOĞRU, pencere ms | ✅ `8d2c8634` — gönderim kapısı satırın KENDİ sıfırlama kaydına bakar (ikinci parça — kayıt ile kuyruk satırı aynı işlemde — zamanlama eşitliği pinleri yüzünden ayrı tur) |
| Son yazmada süre sonu | KISMEN | ✅ `02dd2ed2` — kod değişmedi; "süre kararı hak alma anında verilir" yorumu + iki yönlü sözleşme testi |
| Doğrulama ekranı geçerli bağlantıda hata gösteriyor | DOĞRU (`reason` başlangıçta "error") | ✅ `669d93ce` |
| Alıntılanan misafir sözü ev sahibi sözü sayılıyor | DOĞRU; misafire gitmez, yanlış iç görev açar — bugünkü davranış ÇALIŞTIRILARAK ölçüldü: dört biçimde kesin söz çıkıyor (düz tırnaklı aktarma, İngilizce alıntı, `>` ile iletilmiş satır, "… demişsiniz") | ❓ kod YOK — öneri + ölçülmüş önce / sonra `docs/TASARIM-2026-11-18-alintilanan-soz-gorev-acmasin.md` (G1-a…G1-d) |
| Ev sahibi cevabında değer ↔ hizmet bağı / olumsuzluk | DOĞRU; `HOST_QUESTIONS_ENABLED` kapalı → açılmadan önce şart | 📋 anahtar ön şartı · ❓ |
| `translateTo` ile önizlemesiz model çıktısı gönderimi | DOĞRU; arayüzde çağıran yok | ✅ `e4ed8633` — alan API'den kaldırıldı: gelirse 400 (var olan "Tanınmayan alan gönderildi." cümlesi), değere bakılmaz; sessizce yok sayılmaz (istemci çevrildi sanıp çevrilmemiş metni gönderirdi). Çeviri dalı, ücretli özellik ve günlük bütçe denetimi bu rotadan kalktı; misafir mesajını ev sahibine çeviren salt-okuma rotası değişmedi. Mutasyon 6 / 6 |
| Eski sekme: şablon / mülk formu başkasının değişikliğini eziyor | DOĞRU (23 sürümsüz PATCH / PUT rotası sayıldı) | ✅ `0de0df45` (şablon), `26af4da3` (daire formu) — form açıldığı sürümü yollar; arada değiştiyse kayıt yapılmaz (409), yazılan formda kalır, var olan bilgi tabanı çatışma metni çıkar. Öteki sürümsüz rotalar risk sırasıyla listelendi (en riskli: stok formu) — dokunulmadı. ❓ şablon / daire için ayrı çatışma cümlesi |
| Operatör yapay zekâ kalite konsolu geç yanıt | DOĞRU | ✅ `4c0f1611` — geç gelen yanıt yalnız hâlâ en son istekse uygulanır |
| "Ekstra hazırlık gerekmiyor" eksik profile rağmen | DOĞRU (dar) | 📋 dalga 2 · ❓ metin |
| Yardımcı okuma hatası boş liste gibi | DOĞRU | ✅ `6b167235`, `94d8bef3`, `82d5bc0e` — "Açık işler" kartı okuma düşünce kaybolmaz (var olan "Durum okunamadı. Sayfayı yenileyin." cümlesi); karar okuması düşünce hata kaydı düşer (panel hâlâ boş görünür — arayüz durumu ❓ metin onayıyla) |
| Görev panosu bayat atama | DOĞRU (sunucu koruması hazır, pano göndermiyor) | ✅ `30741ab7` — pano kartın gördüğü atananı ön şart olarak yollar; çatışmada var olan uyarı + yenileme. Başlamış işi panodan yeniden atamak serbest kaldı (pinli karar) |
| QR okuma konumu | DOĞRU | ✅ `26fdb86a` — misafir geçmişi okurken arka plan sorgusu ekranı aşağı çekmez; kendi gönderiminde ve cevabında sona iner |
| "AI bu cevaptan emin" rozeti | KISMEN — kod doğru; etiket modelin kendi beyanını doğruluk gibi sunuyor | ❓ metin |

## 4. Codex'e eklenenler / Codex'ten ayrılan yerler

- **ÖDEME-1, niyet kapalı kip:** Codex'in senaryosu niyet akışıydı; kodda açılış varsayılanı olan kapalı kipte durumun daha kötü olduğu
  görüldü (kilidi yalnız istemci yazıyordu). Düzeltme iki kipi de kapsıyor; istemci sinyali sunucuda Paddle'dan doğrulanıyor.
- **ÖDEME-1, kalıcı engelin tersi:** "süreyle kapanmasın" tek başına müşteriyi kalıcı kilitleyebilirdi (yenileme işlemleri, olayların ters
  sırası, sonradan iptal edilen abonelik). Kayıt yalnız kanıtla açılır ve yalnız kanıtla kapanır; uzlaştırma + operatör serbest bırakma eklendi.
- **ÖDEME-2:** şemasız çözüm seçildi; tur tavanı bir "sessiz sınır" olmasın diye mantıksal tur imleci + alarm eklendi.
- **Kalan-4:** damgayı geri tutmak tek başına bir şey düzeltmez (onarıcıda adım yok) — onarıcıya adım eklenir.
- **Kuyruk penceresi:** pencere Codex'in söylediği yerde değil; gerçek pencereler ayrı ayrı testle gösterilecek.

## 5. Kurucu soruları (birikiyor; her biri önce / sonra örneğiyle rapora girecek)

- Ö-1 yeni müşteri metni (ödeme alındı, henüz tanımlanmadı) · Ö-2 abonelik olayı gelmezse kendiliğinden kurtarma · Ö-3 migration turu
  (tasarım belgesi §6).
- Plan değişikliği sürerken abonelik değişirse müşteriye "başarılı" yerine bekleme metni mi.
- S-1…S-4: elle konuşmada kaydedilen cevap konuşmayı "Cevaplandı" yapsın / ihtiyaçları kapatsın mı; doğrulanamayan gönderim ihtiyacı
  kapatsın mı; düğme "Kaydet" mi olsun; yerel cevaptaki sözden görev üretilsin mi.
- Kalan-2: "bekliyor"a dönen rezervasyonun kuyruk mesajı ertelensin mi iptal mi edilsin.
- Y-1 / Y-2: kanala bağlı olmayan konuşmadaki yeni ev sahibi metinleri ("Cevabınız kaydedildi. Bu konuşma bir kanala bağlı olmadığı için
  misafire gönderilmedi." + yazma alanı notu) ve aynı durumun WhatsApp karşılığı.
- H-1…H-8: ürün yönü soruları — `docs/TASARIM-2026-11-18-ev-sahibine-nerede-soruyoruz-ve-ilk-akis.md` §11.
- Dalga 2a bilgi / karar: (a) giriş — saldırganın denemesi SÜRERKEN (sayaç sınırda) sahibin tanınmayan cihazdan doğru parolası da o an
  429 alır (eskiden 200); "kova doluyken yalnız tanınan cihaz girer" kararının eşzamanlı hâli. (b) pano — başlamış işi panodan yeniden
  atamak serbest kalsın mı (bugün serbest, pinli). (c) görev — aynı istek kimliği + farklı içerik için ayrı bir ev sahibi metni
  (bugün var olan "Geçersiz istek"; arayüz bu duruma düşmüyor). (d) QR — bekleme sırasında misafire ayrı bir "gönderiliyor" /
  "henüz iletilemedi" metni ister misiniz (bugün var olan "yazıyor" göstergesi ve var olan hata metni kullanılıyor).
- AY-1…AY-5: arayüz yönü — `docs/TASARIM-2026-11-18-arayuz-yonu-taslagi.md` §6.

## 6. Migration turu adayları (kod YOK; tek onay)

`WebhookEvent.nextAttemptAt` + `attempts` (olay başına deneme zamanı) · ödeme kaydında abonelik kimliği · `Message.deliveryPath` +
`Message.replyScope` · `MessageOutbox.cancelRequestedAt` · görev istek kimliği.
