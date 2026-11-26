# Doğrulanmış erken giriş iş akışı (09-24)

Kurucu: *"Sensitive request = BLOCK değil. Sensitive request = özel doğrulama workflow'unu çalıştır. Her şey
doğrulanmışsa early_checkin olması nedeniyle human review'a düşmemeli. Gerekli bilgiler eksikse, çelişki varsa,
cevabın güvenliği doğrulanamıyorsa veya gerçekten host kararı gerekiyorsa insan incelemesine düşsün."*
Birleşim kuralı AYNEN kalır (bir katmanın "istek yok"u başka katmanın isteğini silemez); o kural yalnız TESPİT
içindir, otomatik ret demek değildir.

Kod: `src/lib/early-checkin/` (`core.ts` saf karar · `load.ts` tek DB okuması · `reply.ts` onay metni · `rules.ts`
kural deposu · `workflow.ts` bağlantı · `panel.ts` host satırları). Migration YOK.

> **Güncelleme (09-24 ikinci tur):** kanıt modeli bu akışın ÜSTÜNE kuruldu — dört durum (`pending` = kanıt gelebilir,
> otomatik ret yok), kimlikli / son-durum "bitti", host rızasıyla çıkıştan önceki kanıtlı hazırlık, yalnız otomatik
> gönderimi durduran metin/olgu kontrolleri, karar kaydı dayanakları, kuyruklu teslimde otomatik onay yok, temizlikçi
> görünümü. Kurallar ve gerekçeler: `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md` (bu belgeyle çelişkide o geçerlidir).

## 1. Ne zaman koşar

Kanal oto-yanıtında kapı **müsaitlik yüzünden kapandıysa** (`availability_unconfirmed` / `availability_claim`) **ya
da** iki model ertelemeyi doğrulayıp **geçtiyse** ("ev sahibine soracağım") VE tüm katmanların gördüğü istek türü
**TEK ve `early_checkin`** ise (`stayRequestKinds`: kelime ağı · beyan · niyet etiketi · anlama katmanı · bekçi; KODDA
kaymış saatler dahil; türü belirsiz istek `unknown` olur ve "yalnız erken giriş"e asla evet dedirtmez). Başka her
türde (geç çıkış, uzatma, tarih değişikliği, belirsiz) akış hiç DB'ye dokunmadan `null` döner → bugünkü davranış.

"AI cevap öner" (inbox) aynı akışı koşar ve host'a kontrol listesi + (uygunsa) hazır cevap gösterir; orada hiçbir şey
gönderilmez. QR sohbeti resmî giriş saatinde açıldığı için orada erken giriş yolu yoktur.

## 2. Kontroller (ChatGPT'nin 8 maddesi → kod)

| # | Soru | Kod | Kapalı küme kodu (düşerse) |
|---|---|---|---|
| 1 | Önceki misafir ne zaman çıkıyor? | aynı gün ayrılan rezervasyon; saat = misafirin BİLDİRDİĞİ ile mülk varsayılanından GEÇ olanı (temkin) | `previous_checkout_unknown`, `previous_still_in` |
| 2 | O gün çakışan rezervasyon var mı? | varış gecesini işgal eden başka satır + aynı gün iki ayrılan (iptal sayılmaz) | `overlap` |
| 3 | Daire hazır mı? | BU DEVRİN (çıkış gününe bağlı) temizlik görevlerinin HEPSİ kapalı + en az bir "bitti" kaydı önceki çıkış ANINDAN sonra ve ≥5 dk'lık (sunucu zamanı; fotoğraf değil). Konaklama içi başka bir temizlik görevinin geç kapanması hazır YAPMAZ (inceleme 09-24, P1) | `not_ready`, `ready_unknown` |
| 3b | Aynı gün devir yoksa dün gece boş muydu? | YALNIZ müsaitlik motorunun taze kaynaklı "boş" hükmü | `previous_night_unverified` |
| 4 | İstenen saat izin penceresinde mi? | host'un "en erken" saati; standarttan erken değilse / 05:00 öncesi (geç varış) ise akış uygulanmaz (`not_early`) | `before_window` |
| 5 | Ücret ne? | YALNIZ host'un kayıtlı kuralı okunur; model tutar üretmez, hesaplamaz | — |
| 6 | Host onayı mı, otomatik mi? | kural: kapalı (varsayılan) / taslak / otomatik | `rule_off` |
| 7 | Cevap verilere uygun mu? | onay metni KODDA kurulur (6 dil, selamsız, GÜNÜ adlandırır: "bugün (14 Ekim) saat 12:00 itibarıyla"), model metni DEĞİL | — |
| 8 | Uydurma izin/müsaitlik yok mu? | kapı TÜM kontrolleri bu metinle BAŞTAN koşar; müsaitlik muafiyeti YALNIZ birebir aynı metin + tek tür | — |

Ek: rezervasyon yok / onaylı değil / varış bugün değil → `no_reservation`, `reservation_not_confirmed`,
`not_arrival_day`; saat okunamadı / iki model farklı okudu → `time_unknown`, `time_conflict`.

**Otomatik gönderim ek şartları** (onaylanabilir olsa da yoksa host'a hazır TASLAK): istenen saati iki bağımsız
model (anlama katmanı + bekçi) AYNI okumalı — saat yalnız o model erken giriş İSTEĞİ gördüyse sayılır
(`single_source_time`) — ve tek konu olmalı (`multi_intent`): anlama katmanının istek listesi yalnız erken giriş
(± selam / giriş saati) VE cevap modelinin kendi niyet etiketi `early_checkin`/`checkin` (inceleme 09-24, P1-2:
"insanla görüşmek istiyorum" gibi ikinci bir istek onayın arkasında kaybolmasın). Anlama katmanının sorgusuz istek
kalemleri artık DÜŞMEZ (risk niyeti sorguya bağlı değil). Kelime ağı bir mesajdaki TÜM türleri verir (eskiden
yalnız önceliklisini).

## 3. Gönderim

`verifiedEarlyCheckinResult`: metin (kod) ve niyet (`early_checkin` — modelin `human_request` etiketi onay metnine
muafiyet taşımaz) değişir; GÜVEN, risk seviyesi, risk türü ve beyan AYNEN kalır (inceleme 09-24: güveni 1'e çekmek
≥0.75 tabanını kaldırıyor ve karar kaydına uydurma ölçüm yazıyordu) → güven / acil / şikâyet / injection / çıktı
vetosu / anlama katmanı risk niyeti bu metinle yeniden koşar. Geçerse gider; gerekçe `early_checkin_verified` (`RiskEvent.reason`), kanıt `kbEvidenceJson.ec = {s, f, a}`
(yalnız kapalı küme kodlar; saat/tutar/metin yok). Otomatik onaydan sonra rezervasyonun `checkin_prep` görevine not
düşer ("Erken giriş 13:00 otomatik onaylandı.") — ücret TUTARI nota girmez (görev geçmişini temizlik de görür); ücret
misafire giden mesajdadır. Kuyruk yolunda not "onay mesajı gönderime alındı" der (teslim henüz doğrulanmadı).

Kapanmazsa bugünkü davranış: model cevabı taslak (host'a), geçen erteleme gider. Hata = bugünkü davranış.

## 3b. Temizlik bitince yeniden değerlendirme (`recheck.ts`)

Gerçek sıra çoğunlukla şudur: misafir sabah sorar (temizlik bitmedi → host'a), temizlikçi öğlen "bitti" der. Oto-yanıt
tutulan mesajı bir daha denemez (damga). Zamanlanmış geçiş, oto-yanıttan HEMEN ÖNCE, kuralı **otomatik** olan
mülklerde şu konuşmaları **bir kez** yeniden aday yapar: hâlâ cevapsız (`new`), damga güncel mesaj için, o mesajın
kararı "insana" ve `ec` kanıtında düşen kontrollerin HEPSİ hazırlıkla ilgili (`not_ready` / `ready_unknown`), şimdi
hazır (aynı yükleyici: önceki çıkıştan sonra, ≥5 dk) ve karar işaret OTURMADAN verilmiş. Tarama karar vermez,
göndermez; sonraki geçiş tüm hattı (model + kapı + akış) baştan koşar.

Döngü koruması: karar kaydı aynı mesaj için ikinci "insana" kararını yazmaz (tekillik anahtarı), yani "son karar"
yeniden kontrolden sonra değişmeyebilir → yeniden kontrol, varış rezervasyonunun **giriş hazırlığı görevine not**
olarak yazılır ("Temizlik bitti; bekleyen erken giriş isteği yeniden kontrol ediliyor.") ve aynı işaretten sonra
ikinci kez yapılmaz. Giriş hazırlığı görevi yoksa yeniden kontrol de yok (bugünkü davranış). Aşama kendi alarm
anahtarıyla koşar; düşerse oto-yanıt geçişi yine koşar.

## 4. Kural (mülk sayfası → "Erken giriş")

Depo: kullanılmayan `AutomationRule` tablosu (org kapsamlı; `triggerType = early_checkin_request`, koşul
`{propertyId}`), mülk başına tek satır; yok / bozuk = KAPALI. Rota `PUT/DELETE /api/properties/[id]/early-checkin-rule`
yönetici kapılı (`withManage`), başka kiracının mülkü 404,
denetim kaydı alan adıyla (değer yok). Not misafire OLDUĞU GİBİ gider: ödeme yöntemi, bağlantı, ayraç ve çıktı
vetosuna takılan söz ("göndereceğiz", "ayarladım") kayıtta reddedilir. Formun örnek notu doğrulamadan geçer (pinli).
Form ve gecelik fiyat aralığı mülk sayfasında YALNIZ yöneticiye çizilir (personel ücreti görmez). Ücret alanı Türkçe
yazımı okur ("1.500" = bin beş yüz, "12,50") ve misafire nasıl yazılacağını gösterir; belirsiz yazım ("1,500") hata
verir, sessizce düşmez. Otomatik seçenek, iki yapay zekâ kontrolü kapalıyken bunu açıkça söyler.

## 5. Bugünkü sınırlar (dürüst)

* **Üretimde bugün otomatik gitmez:** `AI_UNDERSTANDING_ENABLED` + `AI_STAY_GUARD_ENABLED` kapalı ve OpenAI
  anahtarının kredisi yok → saat iki modelden okunamaz (`time_unknown`) → host'a kontrol listesi. Açma sırası
  `docs/ANLAM-KATMANI-2026-09-24.md` §5 (eval + kurucu onayı).
* **Aynı gün devir dışı:** dün gece boşluğu yalnız taze takvim kaynağıyla kanıtlanır; köprü (Hospitable) tazeliği
  kaydedilmiyor, kurucu org'da iCal beslemesi yok → bugün "doğrulanamadı" (host'a).
* **Temizlik "bitti" işareti** bugün mevcut görev ekranından (`TaskUpdate` status `done`); temizlikçiye özel dar rol
  ve iki adımlı "Daire hazır" düğmesi ayrı iş (`docs/TASARIM-2026-09-24-coklu-istek-ve-temizlik-hazir.md` §B).
* Ödeme alınmaz / "ödendi" denmez; ödeme adımı host'un notunda.

## 6. Kanıt

`tests/unit/early-checkin.test.ts` (çekirdek: her kontrol tek başına düşürür, tüm tekli+ikili bozulmalarda otomatik
yok; metin; kural doğrulama; hazırlık; muafiyet yalnız birebir metin + tek tür; kanıt temizleme; panel) ·
`tests/integration/early-checkin-workflow.test.ts` (olgu yükleyici, kiracı yalıtımı, kural deposu, kanal uçtan uca:
doğrulanmış → gider; erteleme yerine geçer; taslak kipi; tek eksik → insan + kod; kod metni vetoya takılırsa gitmez;
geç çıkışta akış yok; bayraklar kapalıyken otomatik yok; "AI öner" yükü; rota rol/kiracı/doğrulama) ·
`tests/ui/early-checkin-panel.test.tsx` (panel bağlantısı, "Bu cevabı kullan" göndermez) ·
`tests/integration/early-checkin-recheck.test.ts` (sabah tutulan istek temizlik bitince bir kez yeniden aday olur ve
onay gider; yeniden koşu yine tutulursa ikinci açma yok; taze işaret / taslak kural / başka sebep / host cevabı /
işaretten sonraki karar / başka kiracı → dokunulmaz; oturma penceresindeki karar açılır) ·
`tests/integration/scheduled-sync-early-checkin-recheck.test.ts` (geçiş sırası; hata oto-yanıtı bloklamaz).
