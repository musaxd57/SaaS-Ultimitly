# SERT İNCELEME — K26 üç iş (`git diff 6583bcde..05f74b48`, dal dev/gates) — salt okuma

Koşulan: hiçbir test / tsc / build koşulmadı (kural). Bütün bulgular kod okumasıyla; satır numaraları 05f74b48 ağacında.

## P1
Bulgu yok. Şartlar tek tek kontrol edildi: şema / migration / yeni anahtar yok · misafire giden yol yok (yalnız pano, görev kartı, Girişler,
Raporlar; `DECIDED_STATUSES` yalnız `export` oldu) · model çağrısı yok · kelime listesi yok (konu adı yapılı etiketten) · bütün yeni okumalar
işletme kapsamlı · temizlikçiye yeni alan gitmiyor (aşağıda "temiz bulunan alanlar").

## P2

### P2-1 · Birleşik çıkış satırı onaylı GEÇ ÇIKIŞI yok sayıyor → ekranda yanlış saat
- Yer: `src/modules/intelligence/incidents/attention.ts:543-557` (`departingStay` saati: tarih-yalnız kayıtta yalnız `Property.checkOutTime`).
- Senaryo: Lale 3'ün çıkış saati 11:00; ev sahibi misafirin geç çıkışını 14:00'e ONAYLAMIŞ (`DecisionRequest kind=late_checkout`, karar
  saati 14:00); misafirin açık bir sözü / bırakılmış isteği var. Çıkış günü 10:00'da pano: **"Lale 3 bugün 11:00'de çıkıyor"**. Aynı anda
  Görevler panosundaki temizlik kartı "Misafir çıkışı 14:00 · geç çıkış onaylı" der (`src/lib/tasks/checkout-times.ts:37-45`,
  `approvedLateCheckouts` + `laterTime`). İki ekran çelişir; ev sahibi misafirin 11:00'de gittiğini sanıp temizlikçiyi erkene yönlendirebilir.
- Neden yanlış: projede çıkış saatinin TEK kuralı var (mülk saati · onaylı geç çıkış'tan en geçi — misafir beyanını tasarım bilerek dışarıda
  bırakmış, bu ayrı); yeni satır o kuralın yarısını kopyaladı. Tasarım notu (`docs/TASARIM-2026-11-25-cikistan-once-acik-konu.md` "Saat")
  geç çıkış onayından söz etmiyor — bilinçli bir seçim olarak yazılmamış.
- En küçük düzeltme: birleşik satır ÇIKACAK gruplar için (yalnız o zaman, tek sorgu) `approvedLateCheckouts(organizationId, ids)` okunur,
  saat `laterTime(property.checkOutTime, late)`; okunamazsa saat yazılmaz (yanlış saat yerine "bugün çıkıyor"). Daha da dar seçenek: onaylı
  geç çıkış varsa saati hiç yazmamak. Test: geç çıkış onaylı konaklamada başlık "11:00'de" İÇERMEZ.

## P3 (tek satır)
- `attention.ts:766-771` + `departure-open.ts:63-67` — yutulan sözün "gecikti" / "1 gündür açık" durumu birleşik satırda yok; saatsiz (dilim)
  sözde "yarın akşam" da düşüyor ("sıcak su konusu açık"). Tasarım soru 1'de kısmen yazılı; geciken söz için "(söz gecikti)" eki düşünülebilir.
- `attention.ts:659` — `group.hoursWaiting` acil bırakılan isteğin ve açık karar kartının konuşmasından da beslenir → o konuşmanın kendi satırı
  dururken birleşik satır da "misafir N saattir cevap bekliyor" der (bilgi kaybı değil, tekrar).
- `attention.ts:1015` — aynı konaklamanın iki konuşması (ör. kanal + QR) iki cevapsız satır üretirse birleşik satır yalnız birine bağlanır;
  ötekinin bağlantısı panelden kalkar (saat bilgisi max ile korunuyor).
- `src/lib/tasks/last-maintenance.ts:34` — not kısaltması UTF-16 `slice`; 79. birimde emoji varsa yarım vekil karakter (bozuk glif) kalır.
- `src/app/(app)/reports/page.tsx` "Kimseye atanmamış" satırı silinmiş kullanıcının (assignedTo SetNull) temizliklerini de sayar — etiket
  yalnız atanmamışı söylüyor (`reports.ts` yorumu bunu biliyor, ekran söylemiyor).
- `src/lib/reports.ts` `getCleanerMonthCounts` — geçen ay bitip bu ay yeniden açılıp bitirilen görev iki ayda da sayılır (yalnız mevcut ay
  gösterildiği için görünür etkisi küçük).
- `src/app/(app)/reports/page.tsx` — yeni sorgu `Promise.all` içinde `.catch`sız: okuma hatası bütün Raporlar sayfasını düşürür (öteki
  bölümlerle aynı desen; Girişler'deki yeni kart ise doğru biçimde `.catch`li).
- `src/app/(app)/arrivals/page.tsx:31` — sıra yükleyicisi `loadArrivalReadiness`ten SONRA sırayla bekleniyor (birbirine bakmıyorlar;
  `Promise.all` ile paralel olabilir).
- `src/lib/tasks/day-order-load.ts` — vadesi geçmiş (dünden kalan) bitmemiş temizlik sıraya girmez (pencere bugünden başlıyor) — bilinçli
  olabilir, kartta söylenmiyor.
- `src/lib/tasks/last-maintenance-query.ts` — LATERAL + ilişkili alt sorgu `DISTINCT ON`dan ÖNCE her kapanmış bakım görevi için koşar
  (`TaskUpdate(taskId)` dizinli → doğrusal, bugün sorun değil; dairede binlerce kapanmış bakım işi olursa büyür).

## Temiz bulunan alanlar (ne denendi)
- (1) Yutulma / bilgi kaybı: söz `continue` ile `commitmentRows`a girmeden ÖNCE `addTopic` her zaman konu ekliyor → grubun konusu boş kalamaz,
  birleşik satır mutlaka çıkar; bırakılan isteğin `kinds`i hiç boş değil (`conversation-items/store.ts:658`). Konusuz + Sorunsuz grupta
  yutulan satırlar listeden SİLİNMEZ (yalnız birleşik satır çıkarken silinir) → "yalnız cevapsız" satır aynen kalır.
- (1) `heldConversationIds` kontrolünün yeri: eski ve yeni sıra arasında yalnız `continue`'lar yer değiştirdi, hiçbiri arada `push` yapmıyor →
  var olan satırlar birebir aynı. `departingSoon` koşulu değişmedi.
- (1) Kiracı / kapsam: `missingHeld` okuması `propertyId in propertyIds` ile; `twoPropertyRefs` işletme kapsamlı; `options.propertyId`
  daraltmasında bütün kaynaklar (`conversations`, `commitments`, `held`) zaten daraltılmış.
- (1) Saat eki tablosu 00–59 için tek tek denendi (11'de, 10'da, 09:30'da, 14:15'te, 13'te, 16'da, 40'ta, 50'de, 00:00'da) — doğru.
  `time <= nowClock` sözlük kıyası "SS:DD" sıfır dolgulu, `h23` → doğru; tam saatinde yazmama testle pinli.
- (1) Sorunlu durumu: ev sahibi Lixus'tan cevap verince `host-send.ts:311` durumu `answered` yapıyor → "Sorunlu" satırı kendiliğinden kalkar.
- (1) Testler: `todayAt(...)` ile "şimdi" sabitlenen testlerde mesajların "şimdi"den sonra kalması sonucu değiştirmiyor (son söz giden);
  söz saati `WHEN` kalıbı bugün / yarın ikisini de kabul ediyor → gece yarısı yakınında koşu güvenli; tarih `stayDayInZone`.
- (2) SQL: işletme kapsamı `Property.organizationId` ile, yabancı daire kimliği istense de okunmuyor (testli); yeniden açılıp kapanan görevde
  en son `done` satırı seçiliyor; şu an açık olan görev (`status ≠ done`) hiç girmiyor; `ANY(${ids}::text[])` parametreli.
- (2) Not + durum TEK istek: rota (`api/tasks/[id]/route.ts:249-256`) durum ve notu tek `TaskUpdate` satırına yazıyor; blur kaydı sürerken
  (`savingNotes`, eşzamanlı eklenir) not ikinci kez gönderilmiyor; personelin not göndermesi rotada zaten serbest → personel kapanışı bozulmaz.
- (2) Personel sızıntısı: sayfa sorguyu yalnız `canManage` iken kuruyor, `card-data.ts` de `ctx.canManage` olmadan `null` veriyor (çift kapı).
- (3) Ay penceresi `getMonthlyReport` ile aynı (`zonedDateStart` ay+1); ay sınırı testi işletme diliminde ±1 dk ile pinli; test "şimdi"si ayın
  10'u öğlen → ayın 1'i / son günü kırılganlığı yok.
- (3) `groupBy` + `updates: { some }` süzgeci doğru (kanıtsız "bitti" sayılmıyor, testli); adlar işletme kapsamlı okunuyor.
- (3) Girişler / Raporlar `requireManagerSession` arkasında; personel Raporlar'da `/tasks`a yönleniyor (testli). Gün penceresi kapsayıcı
  (`[from, to]`) iki sorguda da aynı, gün etiketi eşlemesi tutarlı. Erken giriş seçimi Girişler satırıyla aynı (en erken onaylı saat).
- (3) Sıra kuralı tasarımdaki kuralla birebir; "erken istenen, saati daha geç olsa da önce" seçimi kurucu sorusu 1 olarak yazılı (kusur değil).
- Ekran metinleri: sade Türkçe, "-in" hitabı ("ekleyin"), teknik sözcük yok.

## Emin değilim
- Ev sahibi misafire Lixus dışından (doğrudan kanalda) cevap verirse senkron konuşmanın "Sorunlu" durumunu kaldırıyor mu, ölçmedim — kaldırmıyorsa
  birleşik satır çıkış öncesi her seferinde "konuşma Sorunlu olarak işaretli" der (bilgi yanlış değil ama bayat olabilir).
- `reservation.status === "completed"` + tarih-yalnız çıkış "bugün": misafir çoktan çıkmışken satır "bugün çıkıyor" der; eski
  `departing_unanswered` satırı da aynı durum süzgecini kullanıyordu, yeni bir gerileme değil.

---

## Ana oturum — bulguların sonucu (11-25)

- **P2-1 (onaylı geç çıkış) DÜZELTİLDİ:** birleşik satır tarih-yalnız kayıtta dairenin saati ile onaylı geç çıkıştan GEÇ olanı yazar
  (`approvedLateCheckouts`, görev kartıyla aynı kaynak); okunamazsa saat yazılmaz. Okuma panelin öteki okumalarıyla aynı turda başlar
  (`request-path-queries` derinlik pini aynı sınırla yeşil — ilk sürüm ardışık bir tur ekliyordu, pin yakaladı).
- **P3 düzeltilen:** son bakım notu kod noktasıyla kısaltılır (emoji bölünmez).
- **P3 bırakılanlar (bilinçli; kurucu sorusu ya da ikinci adım):** yutulan sözün "gecikti" durumu satırda yok (söz saati var) · acil istek
  konuşmasının bekleme saati iki satırda · iki konuşmalı konaklamada tek bağlantı · "Kimseye atanmamış" silinmiş kişiyi de sayar · iki ayda
  sayılan yeniden açılmış temizlik · Raporlar okumasında hata yakalama yok (sayfanın öteki bölümleriyle aynı desen) · Girişler'de sıra önerisi
  ardışık okunuyor · dünden kalan temizlik sıraya girmiyor · son bakım sorgusu çok sayıda kapanmış işte yavaşlayabilir.
