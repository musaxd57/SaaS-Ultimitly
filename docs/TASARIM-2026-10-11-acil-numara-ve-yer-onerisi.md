# Acil numara sorusu ve yer önerisi — öneri (10-11)

> Kurucu soruları (10-11): "Resmî acil numaraları modele kodla mı besleyelim? Yalnız sorulan şeyin numarası söylensin; ev sahibini
> şikâyet bağlamındaysa komple bıraksın, hasta varsa numara versin — Luna 6.0 bu ayrımda iyi mi?" · "Bilgi tabanında yoksa yemek /
> gezi önerisine cevap veriyor mu? Guesty / Hospitable ne yapıyor? Bu temel soruyu bile ev sahibine bırakırsa ev sahibi Lixus'u kullanmaz."
> Bu belge ÖNERİDİR — hiçbiri uygulanmadı (misafire giden davranış → kurucu onayı).

## 1. Bugün ne oluyor (kodda)

- İstem KURAL-1: model YALNIZ bilgi tabanı + mülk / rezervasyon bilgisi + bu sohbetteki ev sahibi cevaplarını kullanır; kendi genel
  bilgisinden öneri / numara üretmez (`src/lib/ai/prompts.ts` KURAL-1).
- Bilgi tabanında yoksa "bilgim yok" misafire GİTMEZ (`ai/absence.ts`) → konuşma ev sahibine kalır, misafire bir şey gitmez (K10).
- Sonuç: "Ambulans numarası ne?" ve "Yakında iyi bir restoran?" sorularının ikisi de, bilgi tabanında yoksa, bugün ev sahibine kalır.
- 10-11'den beri: misafire hiçbir durumda "112'yi / acil servisi arayın" yönergesi gitmez (kurucu kararı; kod + istem + çıktı taraması).

## 2. Rakipler (Haiku web taraması; sayfalar ağ politikası yüzünden tam okunamadı — arama özetlerinden)

| Ürün | Yer önerisi | Acil durum |
|---|---|---|
| Hospitable (Inbox AI) | Bağlam yetmezse yerel WEB ARAMASI yapabiliyor; ev sahibine önce bölge bilgisi yüklemesi öneriliyor | Bağlam yetmezse cevap vermiyor, ev sahibine e-posta; devirde ev sahibinin HAZIR metni AYNEN gidiyor |
| Hostaway (Inbox AI) | Hangi soru türüne AI'ın cevap vereceğini ev sahibi seçiyor; veri yoksa AI eksik bilgiyi adlandırıp bilgi tabanına eklemeyi ÖNERİYOR | Güvenlik konuları yalnız insana |
| Guesty | Rehber Google Maps kullanıyor (elle); Autopilot düşük güvende ekibe devrediyor | Belgelenmiş politika bulunamadı |
| Enso Connect | AI rehber oluşturucu: Google Places'ten yakındaki yerleri TEK TIKLA çekip ev sahibine gösteriyor (kurulumda) | Belirsiz mesaj ev sahibine |
| Airbnb (referans) | — | Misafire "yerel polisi / acil servisi hemen arayın"; ev sahibine acil rehberinde yerel numaraları listelemesi öneriliyor |

Ortak desen: **canlı cevapta genel bilgi değil, ev sahibinin onayladığı veri**; boşluk ev sahibine "şunu ekleyin" diye gösteriliyor ya da
yakındaki yerler KURULUMDA bir kez çekilip ev sahibine onaylatılıyor. Hiçbir ürünün AI'ı gaz / yangın durumunda misafire numara vermiyor
(belgelenmiş olarak). Kaynak bağlantıları: karar listesi 10-11 bölümü / Haiku raporu.

## 3. Öneri A — "Ambulans / polis numarası ne?"

**Ne yaparız:** resmî acil numaraları kodda tutarız (yapay zekâ uydurmaz): Türkiye için yalnız **112** (tek acil numara; 155 / 156 / 110'un bugün
ayrıca yönlenip yönlenmediği kaynaklarda tutarsız → ilk sürümde YOK). Ev sahibi bilgi tabanına kendi numaralarını (kapıcı, yakın hastane)
eklediyse onlar da geçerli.

**Ne zaman söylenir:** yalnız misafir numarayı AÇIKÇA sorduğunda ve anlama katmanı bağlamı "bilgi / yardım" okuduğunda. Metni KOD kurar,
yönerge cümlesi yoktur ("arayın" yok).

**Ne zaman söylenmez (komple ev sahibine kalır):** aynı turda ev sahibini şikâyet / tehdit / iade / "polise gideceğim" bağlamı; tehlike anı
(o zaman zaten hiçbir şey gitmez, ev sahibine acil uyarı).

| Misafir yazar | Bugün | Öneri |
|---|---|---|
| "Annem fenalaştı, ambulans numarası ne?" | Ev sahibine kalır, misafire bir şey gitmez | "Türkiye'de acil numara 112'dir." + ev sahibine ACİL uyarı |
| "Polisin numarası kaç?" | Ev sahibine kalır | "Türkiye'de acil numara 112'dir." |
| "Ev sahibi depozitomu vermiyor, polisi arayacağım, numara ne?" | Ev sahibine kalır | Ev sahibine kalır (şikâyet bağlamı) — misafire bir şey gitmez |
| "Mutfakta gaz kokusu var!" | Hiçbir şey gitmez, ev sahibine acil uyarı | Aynı (numara sorusu değil) |

**Luna 6.0 bu ayrımda iyi mi?** Ölçmeden söyleyemem. Önerim: 30–40 senaryoluk küçük bir set (hasta + numara, merak + numara, gürültü
şikâyeti + polis, ev sahibini şikâyet + polis, tehlike) üzerinde anlama katmanının "bilgi mi / şikâyet mi" ayrımını 5.1 ve Luna 6.0 ile
ölçmek. Ücretli çağrı: yaklaşık 80–160 model çağrısı (iki model × set × 2 tekrar) — onayınızla.

## 4. Öneri B — Bilgi tabanında olmayan yer önerisi

| Seçenek | Ne olur | Risk |
|---|---|---|
| **B1 (önerilen) — ev sahibi döngüsü** | Misafir bilgi tabanında olmayan bir yer sorduğunda ev sahibine "Bu soru bilgi tabanınızda yok — 'Çevre önerileri' ekleyin" ipucu; mülk sayfasında adresten **bir kerelik** "yakındaki yerler" önerisi (ör. 5 restoran, 3 market, eczane), ev sahibi işaretleyip onaylayınca bilgi tabanına girer (Enso / Guesty deseni). Sonraki misafirler cevabı alır. | Yer verisi için harita servisi (Google Places vb.) anahtarı + maliyet; ev sahibi onaylamazsa boşluk sürer |
| B2 — model genel bilgisinden önerir | Bilgi tabanında yoksa model kendi bildiğinden yer söyler (Hospitable'ın web araması deseninin zayıf hâli) | Kapanmış / yanlış yer, uydurma adres; KURAL-1 delinir; "AI uydurdu" şikâyeti ev sahibine döner |
| B3 — bugünkü gibi | Ev sahibine kalır | Kurucunun kaygısı: "ev sahibi Lixus'u kullanmaz" |

Örnek (B1): Misafir "Yakında kahvaltı yeri var mı?" → bilgi tabanında "Çevre: Lale Kahvaltı Evi, 3 dk yürüme" varsa → "Lale Kahvaltı Evi 3
dakika yürüme mesafesinde." · yoksa → misafire bir şey gitmez, ev sahibi gelen kutusunda "bilgi tabanına ekleyin" ipucu + tek tıkla öneri listesi.

## 5. Karar soruları

1. Acil numara: Öneri A'yı (yalnız 112, kod metni, şikâyet bağlamında bırak) uygulayalım mı? Önce Luna / 5.1 ölçümü (ücretli) yapalım mı?
2. Yer önerisi: B1 (ev sahibi döngüsü + bir kerelik yakındaki yerler önerisi) mi, B2 (model genel bilgisi) mi? B1 için harita servisi
   seçimi ve maliyeti ayrı karar.

## 6. B1 uygulama tasarımı (kurucu B1'i seçti, 10-11) — onay için

**Bugün kodda (ölçüldü):** model ev sahibinin TÜM mesajlarını taramaz; yalnız AYNI sohbetteki önceki cevapları kullanır (KURAL-1 kaynak 3).
Geçmiş ev sahibi cevaplarından bilgi tabanı önerisi (Bacak B) 09-11'den beri kapalı. Gelen kutusundaki taslakta "Eksik bilgi: …" satırı var,
ama oradan bilgi tabanına giden bir yol yok. Bilgi tabanında "Yerel Tavsiye" (`local_tips`) kategorisi zaten var.

**Önerilen üç parça (misafire giden metne dokunmaz):**
1. **Gelen kutusu:** taslakta "Eksik bilgi" satırı çıktığında yanında **"Bilgi tabanına ekle"** düğmesi → bilgi tabanı formu açılır; mülk,
   kategori (yer sorusuysa "Yerel Tavsiye") ve başlık ("Yakındaki restoranlar") önceden dolu. Ev sahibi yazıp kaydeder; sonraki misafir cevabı alır.
2. **Mülk sayfası:** mülkte hiç "Yerel Tavsiye" kalemi yoksa ve son 30 günde misafirler yer sordaysa küçük bir hatırlatma: "Son 30 günde
   4 misafir çevre önerisi sordu — 'Yerel Tavsiye' ekleyin." (sayı anlama katmanının `local_recommendations` etiketinden; metin taşımaz).
3. **(Ayrı karar) Yakındaki yerler önerisi:** mülk adresinden bir kerelik liste (restoran, market, eczane) → ev sahibi işaretler, bilgi
   tabanına eklenir. Harita servisi gerekir: Google Places (ücretli, kalite yüksek) ya da OpenStreetMap (ücretsiz, Türkiye'de veri eksik
   olabilir) — fiyatlar bu turda doğrulanmadı.

Örnek: Misafir "Yakında kahvaltı yeri var mı?" → bilgi tabanında yok → misafire bir şey gitmez (bugünkü gibi) → gelen kutusunda taslak
"Eksik bilgi: yakındaki kahvaltı yerleri" + **[Bilgi tabanına ekle]** → ev sahibi "Lale Kahvaltı Evi, 3 dk yürüme" yazar → sonraki misafir
"Lale Kahvaltı Evi 3 dakika yürüme mesafesinde." cevabını alır.

## 7. Ölçüm sonucu — Luna 6.0 (10-11, kurucu onayıyla; 33 senaryo × 2 tekrar = 66 anlama çağrısı)

Rapor: `docs/olcum/acil-numara-2026-10-11-gpt-6-luna-mv3u05l3.md` (+ `.json`). Set: `evals/emergency-number.json` (geliştirme seti — görüldü;
açmadan önce kör setle doğrulanmalı).

| Karar kuralı | Doğru | Bırakılmalıyken numara (🚨) | Numara verilmeliyken bırakma |
|---|---|---|---|
| Ölçüldüğü gibi: yalnız EN ÖNCELİKLİ niyet ("acil" şikâyeti gölgeliyor) | 43/62 | 19 | 0 |
| Tüm niyetler: şikâyet / iade / insan talebi niyetinden BİRİ varsa bırak (aynı yanıtlar, ek çağrı yok) | 58/62 | 4 | 0 |
| + koddan "ev sahibi / depozito / iade / iptal / şikâyet / dolandır / hakaret" sinyali (hesap, ölçülmedi) | ~60/62 | 2 ("Kapı kodu çalışmıyor, 2 saattir dışarıdayız, polisi arayacağız") | 0 |

- Luna "polis / ambulans" geçen HER mesaja "acil" niyeti koyuyor; ev sahibi şikâyetini çoğu zaman AYRICA işaretliyor ama her zaman değil
  (h1 "Ev sahibi depozitomu vermiyor", h12 "Ev sahibi iptal etti" bir tekrarda yalnız "acil").
- Yardım / merak / güvenlik / hastalık sorularının HEPSİ doğru: 38/38 yanıtta numara verilecekti, hiçbiri gereksiz bırakılmadı.
- Tekrarlar arası karar tutarlılığı 30/33.
- Belirsiz iki senaryo ("Ev sahibi izinsiz içeri girdi, korkuyorum, polis numarası?"): Luna ikisinde de "acil" dedi → bugünkü kuralla
  numara verilir; koddan "ev sahibi" sinyali eklenirse BIRAKILIR — ev sahibinin kendisi tehdit olduğunda numarayı ona bırakmak doğru mu?
  Sizin kararınız. → **Kurucu: "Size kalsın"** — bırakılır.

## 8. Uygulama (10-11 akşam; anahtar `AI_EMERGENCY_NUMBER_ENABLED` KAPALI)

- Kod: `src/lib/ai/emergency-number.ts` (karar, LLM'siz) + QR rotası (normal yol + açık tehlike dalı). Kural tam metni `docs/claude/ai-guvenlik.md`.
- Ölçümdeki tek kaçış (h4 "Kapı kodu çalışmıyor … polisi arayacağız": Luna kapı + acil dedi, ev sahibi sözcüğü yok) konaklama konusu
  kuralıyla kapandı: numara yalnız acil / selam / diğer / yakın yer / ulaşım niyetleriyle birlikte verilir → ölçüm setinin Luna niyetleriyle
  62/62 (verilmesi gereken 38/38, bırakılması gereken 24/24). Geliştirme seti — açmadan önce kör setle ölçülmeli.
- Örnekler (anahtar AÇIKKEN): "Annem fenalaştı, ambulans numarası kaçtı?" → "Ambulans: 112" + ev sahibine acil uyarı · "Türkiye'de polis
  numarası kaç?" → "Polis: 155" · "Mutfakta yangın çıktı! İtfaiye numarası ne?" → modelsiz "İtfaiye: 110" + acil uyarı · "Ev sahibi
  depozitomu vermiyor, polisi arayacağım. Numara ne?" → hiçbir şey (bugünkü gibi) · "Polis kaç dakikada gelir?" → numara sorusu sayılmaz.
- Bilinen sınır: "yönetici / manager" ev sahibi sözcüğü sayılır ("Bina yöneticisi bağırıyor, polis numarası?" → numara gitmez; fazla
  eşleşme bilinçli, bedeli bugünkü davranış). Platform adı (Airbnb / Booking) ve yabancının tehdidi numarayı DURDURMAZ (Haiku 2. tur).
  Kanal (Airbnb / Booking mesajı) yolu YOK — kurucuya sorulacak.
- B1: gelen kutusu "Bilgi tabanına ekle" + mülk sayfası hatırlatması uygulandı (`src/lib/kb-prefill.ts`, `src/lib/local-tips-demand.ts`).
  Adres yalnız mülk + kategori taşır; modelin "eksik bilgi" özeti (misafir adı içerebilir) sekmenin oturum belleğinde, 10 dakika, bir kez.

## 9. Neden analizi → istem kuralı → kör doğrulama (10-11 akşam, kurucu onaylı ücretli koşular)

| Koşu | Anlama kuralı | Ürün kararı (kod + anlama) | 🚨 anlaşmazlıkta numara |
|---|---|---|---|
| Geliştirme, istem kuralı kapalı (66 çağrı) | 58/62 | 62/62 (kod kuralları) | 0 |
| Geliştirme, istem kuralı açık (66 çağrı) | 62/62 | — | 0 |
| Kör acc1, kapalı (20) | 16/18 | 15/18 → yeni kod 18/18 | 1 → 0 |
| Kör acc1, açık (20) | 18/18 | 16/18 → yeni kod 18/18 | 0 |

- Neden analizi raporu `docs/olcum/acil-numara-2026-10-11-gpt-6-luna-mv3u05l3-neden.md` (31 çağrı).
- İstem kuralı açıkken model anlaşmazlık mesajlarında "acil" etiketini düşürüyor (24/24) — önizlemedeki "acil kalkmaz" ile farklı; açık karar.
- Kör setten açılan 3 senaryo (`seen`) artık görüldü; düzeltmenin kör doğrulaması kör set 2 (acc2) ile.

