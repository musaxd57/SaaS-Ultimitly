# TASARIM 2026-11-25 — Çıkıştan önce açık konu satırı (plan madde 7)

Kaynak: `docs/PLAN-2026-11-25-urun-fikirleri-iki-ajan.md` §7 · kurucu örneği: "Lale 3 yarın 11:00'de çıkıyor; sıcak su konusu açık."
Sınır (plan): yeni satır türü değil, var olan satırların birleşimi; ilk hâl yalnız açık istek + açık söz + "Sorunlu" durumu okur;
"cevaplandı ama çözülmedi" türetilmez. Misafire hiçbir şey gitmez, veritabanı / anahtar değişikliği yok, model çağrısı yok.

## Bugün ne var (okuma)
- `findAttentionItems` (`src/modules/intelligence/incidents/attention.ts`) — tek tüketici pano (`dashboard/page.tsx` → `AttentionPanel`).
- Aynı konaklama için ayrı satırlar: `departing_unanswered` (çıkışa ≤ 24 sa, misafir ≥ 2 sa cevapsız) · `held_request` (konuşma başına,
  ev sahibine bırakılan hassas istek; acil / erişim kaybı 99, öteki 88) · `commitment_due` (söz başına, en çok 3 satır).
- "Sorunlu" (`Conversation.status = "problem"`) konuşma, son sözü bizdeyse panelde HİÇ görünmüyor.
- Çıkış penceresi tek kural `departingWithinSoonWindow` (tarih-yalnız çıkışta bugün / yarın, saatli kayıtta 24 sa).

## Ne ekleniyor
Çıkışı penceredeki (onaylı / tamamlanmış) bir rezervasyonda AÇIK KONU varsa o rezervasyonun satırları TEK satıra toplanır.
- Satır türü yine `departing_unanswered` ("çıkışı yaklaşan" ailesi; yeni tür yok) + yapılı ek alan `departureOpen`.
- Açık konu kaynakları (hepsi zaten okunan kayıtlar — yeni sorgu YOK; tek istisna ↓):
  1. bırakılan istek (`held` özeti, acil / erişim kaybı OLMAYAN) → konu adı `itemKindLabel` (ör. "ödeme / fatura"),
  2. açık söz (zaten okunan söz satırları, tavandan ÖNCE) → konu adı `commitmentLabel` konusu varsa konu ("sıcak su"), yoksa tür,
  3. konuşma "Sorunlu" → "konuşma Sorunlu olarak işaretli" (konu adı UYDURULMAZ; `lastRiskType` bayat olabilir, okunmaz).
- Cevapsız mesaj tek başına AÇIK KONU DEĞİL: yalnız cevapsız mesaj varsa bugünkü satır AYNEN kalır; konu varsa cevapsızlık birleşik satıra
  "misafir N saattir cevap bekliyor" parçası olur (iki satır olmaz).
- Rezervasyonun yutulan satırları (cevapsız · bırakılan istek · söz) listeden çıkar → aynı konu iki satırda görünmez. Yer açılan söz
  tavanına (3) öteki konaklamaların sözleri girer.
- Önem = yutulanların en büyüğü, en az 90 (bugünkü çıkış satırının tabanı); bağlantı en önemli parçanın konuşması; kesinlik: bırakılan
  istek varsa "inferred" (bugünkü "otomatik sınıflandırma, doğrulayın" eki), yoksa "observed".
- Saat: saatli çıkış kaydında işletme saatiyle; tarih-yalnız kayıtta dairenin çıkış saati (`Property.checkOutTime`, misafire giden
  şablonların da kaynağı); geçerli "SS:DD" değilse saat yazılmaz. Misafirin yazdığı çıkış saati (C-9 beyan) OKUNMAZ.

## Önce / sonra (pano)
Önce (3 satır): "Size bırakılan istek: ödeme / fatura · Lale 3 · misafire yanıt verin" · "Misafire söz verildi: Arıza / bakım · sıcak su ·
Lale 3 · 18:00 · ilgili görev tamamlanmadı · 2 sa kaldı" · "Çıkışı yaklaşan misafir 3 saattir cevap bekliyor · Lale 3".
Sonra (1 satır): **"Lale 3 yarın 11:00'de çıkıyor"** / "sıcak su, ödeme / fatura konuları açık · misafir 3 saattir cevap bekliyor".
Tek konu: "Lale 3 yarın 11:00'de çıkıyor" / "sıcak su konusu açık". Yalnız Sorunlu: "Lale 3 bugün çıkıyor" / "konuşma Sorunlu olarak işaretli".

## Kenar durumları (satır ÇIKMAZ)
İptal / bekleyen rezervasyon (bugünkü durum süzgeci: yalnız confirmed / completed) · çıkış penceresi dışı · çıkışı geçmiş · rezervasyonsuz
konuşma · aynı rezervasyon iki dairede etkin kayıtlı (`activeBookingConflicts`, zaten okunuyor — o satır ayrı uyarı veriyor; daire tahmin
edilmez) · başka işletmenin verisi (bütün okumalar işletme kapsamlı).

## Bilerek dışarıda
- Acil / erişim kaybı bırakılan istek (önem 99) yutulmaz, kendi satırı kalır (o konuşmanın Sorunlu işareti de birleşik satıra girmez).
- `decision_pending` (karar kartı) yutulmaz: ayrı eylemi var ("onaylayın ya da reddedin"), konusu bırakılan istekten zaten düşülüyor.
- Söz okuması bugünkü pencereyle (−48 sa … +24 sa, saatsiz söz gün bitmeden yok): 48 saatten eski açık söz birleşik satıra da girmez.

## Performans
Yeni okuma yok; sorgu seçimleri genişledi (rezervasyon kimliği / durumu / kaynak kimliği, dairenin çıkış saati). Tek istisna: bırakılan
isteği olan bir konuşma aday listesinde YOKSA (aday tavanı), o konuşmaların rezervasyonu tek sorguyla okunur — yalnız gerektiğinde.

## Kurucuya sorular
1. Tek bırakılan istek / tek söz bile çıkışa ≤ 24 sa kala birleşik satıra dönüyor (söz satırının "2 sa kaldı" ayrıntısı birleşik satırda yok).
   Söz saati de görünsün mü? (ör. "sıcak su konusu açık (söz 18:00)").
2. Acil istek ayrı kalıyor — doğru mu?
3. 48 saatten eski açık söz de çıkıştan önce hatırlatılsın mı? (bugün "unutulmuş söz kartı doldurmasın" kuralıyla düşüyor; ek bir sorgu ister).

## Test planı
`tests/integration/attention-departure-open.test.ts` (davranışsal, `stayDayInZone`): (a) istek → tek satır + metin · (b) konu yok → yok ·
(c) çıkış 3 gün sonra → eski satırlar aynen · (d) istek + söz + cevapsız → TEK satır · (e) iptal → yok · (f) başka işletme sızmaz ·
Sorunlu tek başına · acil istek ayrı · iki dairede kayıt → yok. Metin: `tests/unit/departure-open-text.test.ts` (saat eki, tekil / çoğul).
