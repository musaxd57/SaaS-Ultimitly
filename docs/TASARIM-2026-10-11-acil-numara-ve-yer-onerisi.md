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
