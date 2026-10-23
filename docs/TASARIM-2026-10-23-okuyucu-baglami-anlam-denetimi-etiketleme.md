# Tasarım — okuyucu bağlamı, anlam denetiminin okuyucuya geçişi, insan etiketi, kör setin neden analizi (10-23 sabah-3)

> Kurucu (10-23): "misafirin bu turdaki mesajını ve önceki 3 mesajını görüyor. bunu 16ya çıkar, 3 çok az … luna 6'nın 1 milyon token
> penceresi var, neden cimrilik yapıyoruz" · "bilgi yoklar hosta gözükebilir, müşteriye gitmesin". Codex'in S1–S4 cevabı + "kullanılmış
> kör setteki 1 yanlış gönderim ve 26 gereksiz tutmanın nedenleri yeni koşudan önce incelensin". Önceki rapor:
> `docs/RAPOR-2026-10-23-sabah-parca-okuyucu-ve-kor-olcum.md`. Parça kipi KAPALI — bu belgedeki her şey geliştirme + ölçüm.

## 1. Okuyucunun bağlamı (kurucu: 3 → 16) — YAPILDI

| | önce | şimdi |
|---|---|---|
| bu turun misafir metni | son 1.200 karakter | 8.000 karakter (kanal mesajının yapay zekâ sınırı, `message-length.ts`) |
| önceki konuşma | yalnız misafirin son 3 mesajı, 600 karakter | son **16** mesaj, **iki taraflı** (ev sahibi / asistan cevapları dahil), mesaj başına 1.000 karakter |
| istek satırı | anlama katmanının genişlettiği arama sorgusu | misafirin kendi sözleri (özgün dildeki sorgu) + ihtiyaç türü |

Neden iki taraflı (Codex S2): "Peki onun ücreti?" ancak önceki cevapla anlaşılır. Neden kendi sözleri: "Kahvaltı kaça kadar?" bitişi sorar;
genişletilmiş "kahvaltı saatleri" başlangıcı da sorar — okuyucu yanlış soruyu değerlendirip doğru cevabı tutuyordu. Arama sorgusu yalnız
getirmede kalır.

"Bilgi yok" / "emin değilim" / okuyucunun tutma sebepleri **yalnız ev sahibine** görünür (panelde açık iş, gerekirse tek e-posta); misafire
hiçbir koşulda gitmez (CLAUDE.md "BİLGİM YOK MİSAFİRE ASLA GİTMEZ"; parça kipinde tutulan parça misafire giden metne hiç girmez).

**Açık soru (kurucu):** cevap modelinin kendi geçmiş penceresi (`selectHistoryForPrompt`: 25 mesaj + 6.000 karakter) kalıcı karar; aynı
"cimrilik yok" gerekçesiyle büyütülsün mü? Müşteriye gideni değiştirir → önce sorulur (rapor §5).

## 2. Anlam denetimi kod → okuyucu (Codex S3)

Codex: "okuyucu yalnız tutabiliyorsa, eski kelime kapılarının gereksiz tuttuğu cevapları kurtaramaz; yanlış tutan anlam kontrollerinin gerçekten
değiştirilmesi gerekir." Okuyucunun "evet"i yine tek başına izin DEĞİL: kodda kalan denetimler + okuyucu birlikte.

| kod denetimi | ne yapıyor | karar |
|---|---|---|
| `text_missing` · `too_long` · `source_not_found` | yapı | **kodda kalır** |
| `evidence_missing` · `evidence_not_in_source` | alıntı yok / kaynakta yok (kaynak geçerliliği) | **kodda kalır** |
| `value_not_in_evidence` | parçadaki sayı / saat / tutar kaynakta yok (sayı–birim) | **kodda kalır** (Rusça "−2" gibi yazım farkı kodda düzeltilir) |
| `value_conflict` | iki kaynak çelişiyor | **kodda kalır** |
| son metin denetimi, sır, yetki, işlem onayı, tazelik, bütün kapı | | **kodda kalır** |
| `unsupported_content` | parçanın sözcükleri alıntıda yok ("atabilirsiniz" ↔ "atılır") | **aday → okuyucu** (`supported_by_notes`) |
| `subject_missing` · `subject_unknown` · `subject_mismatch` | konu sözcüğü bulunamadı (başka dil, zamir "It costs …") | **aday → okuyucu** (`answers_request` / `binding_ok`) |
| `value_bound_elsewhere` | değer başka hizmete bağlı (250 TL ek yatağın) | **aday → okuyucu** — Codex: "kod sayı/birimi, okuyucu tutarın hangi hizmete ve koşula ait olduğunu doğrular" |
| `condition_dropped` · `condition_added` · `variant_omitted` · `polarity_mismatch` · `direction_mismatch` · `aspect_missing` · `subject_partial` | koşul / istisna / yön / olumluluk | kör setin neden analizine göre (§4): gereksiz tutması ölçülenler okuyucuya, doğru tutanlar kodda kalır |

🚨 Ölçülen ince nokta: bağ denetimi kısa devre yapar — "konu bulunamadı" çıktığında o parçanın koşul / olumluluk denetimi hiç koşmaz. Yani
bir aday okuyucuya taşınınca yalnız o satır değil, arkasındaki denetimler de okuyucuya kalır. Bu yüzden her aday, kör setin neden analizinde
(§4) **gereksiz tuttuğu sayı doğru tuttuğundan belirgin fazlaysa** taşınır; doğru tutan aday kodda kalır.

Taşınan denetim kodda **çalışmaya devam eder** ve kararı ölçüm izine yazılır (tutmaz) — böylece okuyucunun aynı vakada ne dediği ölçülür,
geri dönüş tek satırlık.

### 2a. Ölçüm ve karar (10-23 sabah-3) — YAPILDI

Kanıtlanmış-kötü vakalarla okuyucu sınaması: `evals/part-reader-vs-code.json` (39 vaka: 23 yanlış taslak — kodun yakalamak için yazıldığı her
sınıf, TR / EN / DE / ES / RU; 16 doğru taslak — kör set incelemesinde kodun gereksiz tuttuğu sınıfların YENİ yazılmış benzerleri) · ölçer
`tests/eval/part-reader-vs-code.eval.test.ts` · sonuç `docs/olcum/part-reader-vs-code-2026-10-23-luna-low.json` (Luna, düşük çaba, her vaka 2
okuma).

| | yanlış geçiş (kötü taslak gitti) | gereksiz tutma (doğru cevap tutuldu) |
|---|---|---|
| kod denetimleri | 0 / 23 | **12 / 16** |
| okuyucu | **0 / 46 okuma** | 2 / 32 okuma (aynı vaka: "ek yatak alabilir miyiz, ne kadar?" ↔ yalnız ücret — "kısmen") |

Kodun doğru tuttuğu 23 kötü taslağın **23'ünü** okuyucu iki okumada da tuttu. Kör setin incelemesinde de kodun 19 tutmasının 19'u gereksizdi.
→ **Karar:** okuyucu koşarken kod YALNIZ `CODE_KEPT_ISSUES`'u tutar — alıntı yok / kalemde yok · parçadaki sayı-saat-tutar alıntıda yok ·
iki kaynak çelişiyor · ihtiyacın konusu hiç bilinmiyor (+ yapı: metin yok, çok uzun, kaynak yok). Konu, koşul, değişke, olumluluk, yön, değer
bağı, içerik, sorulan yön / tesis ANLAM denetimidir: tutmaz, `advisory` olarak ize yazılır (okuyucu tutarsa tutma kaydında da). Okuyucu
kapalı / düşmüşse bütün parçalar zaten tutulur (Opus G1), yani kodun anlam denetimi yalnız okuyucu GERÇEKTEN okuyacakken susar.
Sır, yetki, işlem onayı, tazelik, çıktı vetosu, son metin denetimi ve bütün kapı yerinde (parça doğrulaması onların önüne eklenir).

### 2b. Alıntı iki kalemi birleştirebilir; çevrilmiş başlık (#199) — YAPILDI

Kör set: 5 doğru cevap "kaynak yok" diye tutuldu — genel kural ve istisnası iki ayrı kalemdeydi, model ikisini tek alıntıda birleştirdi; bir
Rusça cevapta model kalem başlığını çevirip alıntıya kattı ("Интернет: …"). Şimdi (`groundEvidence`): bütün alıntı bir kaynakta geçmiyorsa
cümlelerine bölünür, HER cümle (en az 8 harf) bir kaynakta birebir aranır; başındaki rakamsız ≤ 40 karakterlik "Başlık:" atılıp kalan da
aranır. Tek cümlesi bile bulunamayan alıntı dayanaksız. Sayı / değer denetimi gevşemez (uydurma saat yine düşer, pinli).

### 2c. Açık — kurucuya soru (müşteriye gideni değiştirir)

- Sözcük etiketi "kural ihlali" (köpek / parti / fazla kişi / sigara) bugün yalnız "ev kuralları" isteğine bağlanır; anlama katmanı isteği
  "evcil hayvan" sayınca etiket bağlanamaz ve BÜTÜN mesaj hassas olur (aynı mesajdaki sauna saati de tutulur). Önerim: etiketin hangi
  aileden geldiğine bakıp (köpek → evcil hayvan isteği) yalnız o isteği tutmak; parti / fazla kişi / sigara bugünkü gibi. Soru 9'daki
  ilkenizle aynı ("bu soru tutulursa aynı mesajdaki bağımsız cevaplar da tutulmasın").
- Bugünkü akış (Railway açılınca çalışan): "… için ev sahibinize sorabilirsiniz / danışabilirsiniz" misafire gidebiliyor (kör sette 2 kez,
  istek de "cevaplandı" kapandı). 100 ölçüm dosyasında bu cümleli 49 taslağın 48'i zaten tutulmuş; kaçan biçim istemin öğrettiği değil.

## 3. İnsan etiketi (Codex S4) — sayfa YAYINDA

https://claude.ai/artifact/9tGjT8eYyvvdggdkiVEfwQ — 35 örnek; her örnekte misafirin mesajı (+ önceki mesajlar), değerlendirilen soru,
bilgi tabanındaki not, gidecek cevap. Üç ayrı soru: sorulanı cevaplıyor mu (evet / kısmen / hayır / belirsiz) · bilgi notta yazıyor mu
(evet / hayır / belirsiz) · eksik ya da yanıltıcı koşul var mı (yok / var / belirsiz) + not. Benim etiketim gösterilmez (yönlendirmesin).
İşaretler sayfanın veritabanında (`labels/<örnek>`); `ArtifactData list labels` ile okunur. Yalnız geliştirme örneği; kör kabul setine karışmaz.

## 4. Kullanılmış kör setin neden analizi

Ben seti açmadım. Ayrı bir incelemeci (Opus) seti, kör koşunun commit'inde (`b47f246f`) iki kolda ayrıntılı yeniden koşar; her yanlış gönderim
ve her gereksiz tutma için sebep sınıfı (okuyucu alanı · kod denetimi · anlama katmanı · cevap modelinin taslağı · tur tutması · beklenti hatası)
ve "tutma doğru muydu" hükmü yazar. Ayrıntılar geliştirmede kullanılacağı için (Codex) **sonraki kabul yeni, görülmemiş bir setle** yapılır —
yine ayrı yazar, mühürlü.

Bugünkü akışın 9 yanlış gönderimi ayrıca listelenir: Railway açılınca çalışacak olan o akış (Codex S1 notu).

## 5. Sıra

1. İncelemecinin raporu → §2'deki koşul / istisna satırlarının kararı.
2. Kod: taşınan denetimler okuyucu varken tutmaz (yalnız iz); Rusça yazım farkı; okuyucu istemi kalan boşluklar.
3. Geliştirme setinde ölçüm (yanlış gönderim / gereksiz tutma ayrı) + kurucunun etiketleri gelince okuyucu etiketle karşılaştırılır.
4. Yeni kör set (ayrı yazar) → tek kabul koşusu → rapor.
5. Bugünkü akışın yanlış gönderimleri için ayrı öneri (müşteriye gideni değiştirir → önce/sonra örnekli soru).
