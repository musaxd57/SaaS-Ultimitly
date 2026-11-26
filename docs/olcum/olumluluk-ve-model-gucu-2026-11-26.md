# Olumluluk ("var / yok") denetimi ve okuyucunun anlama gücü — 26 Kasım

Kurucu kararları (26 Kasım, aynen): S-2 → "önce kontrol et" · "salak salak hala yanlış eksik cevaplar gitmemeli modelin anlama bağlam gücünü
test et". Kalıcı kural (11-18): anlam / amaç / niyet kararı kelime ya da yapı listesiyle verilmez, modele bırakılır; kod yalnız modelin
dediğini doğrular.

Ürün kodu DEĞİŞMEDİ. Öneri ayrı belgede: `docs/TASARIM-2026-11-26-olumluluk-karari-modele.md`.

## 1. Yöntem

| parça | dosya | ne yapar |
|---|---|---|
| tablo (Görev A) | `evals/olumluluk-tablosu.json` | 99 satır: (a) üç parça koşusundaki (g3 · g4 · g4b) 27 `polarity_mismatch` reddi, ayrıntı dosyalarından BİREBİR; (b) yanlış alarm çiftlerinin gerçekten ters çevrilmiş 23 hâli; (c) 49 dürüst ek satır (aynı dil olumlu / olumsuz, bir kalemde iki konu iki yön, yer değiştirmiş iki yön, ücret, diller arası tr / en / de / fr / es / ru / ar). Her satırda beklenen karar + gerekçe. |
| vakalar (Görev B) | `evals/okuyucu-gucu-vakalari.json` | 88 vaka: çelişki 23 + 8 kontrol · dil 16 + 6 kontrol · maske 12 · eksik 17 + 6 kontrol. |
| ücretsiz ölçer | `tests/eval/polarity-table-replay.ts` (+ çekirdek `polarity-table-core.ts`) | ürünün KENDİ işlevi `composeVerifiedReply` (`meaningJudge: "reader"` = parça kipinde okuyucu koşarken kodda kalan denetimler). İhtiyaç sözcükleri / konuları ürünün işlevleriyle (`needTerms`, `requestTopics`). Model yok. |
| ücretli ölçer | `tests/eval/part-reader-strength.ts` | ürünün KENDİ okuyucusu `runPartReader` (istem değişmedi, model / çaba ürünün ortam değişkenlerinden: `gpt-5.1`, çaba gönderilmez — ölçülen koşularla aynı). Ek soru kolları yalnız betiğin `fetch` sarmalayıcısında. |
| özet | `tests/eval/part-reader-strength-report.ts` | küme × kol oranları + birleşik hat (kod tutarsa tutulur, geçirirse okuyucu — ürünün sırası). |
| çıktılar | `docs/olcum/olumluluk-tablosu-2026-11-26.json` · `okuyucu-gucu-2026-11-26.json` · `okuyucu-gucu-ozet-2026-11-26.json` | satır / çağrı başına hüküm. |

**Kurulumun sadakati:** 27 reddin 27'si bu kurulumla birebir yeniden üretildi — sorun listesi ve danışma bulguları (`advisory`) dahil.

Koşturma:
```
npx tsx --tsconfig tests/workers/tsconfig.json tests/eval/polarity-table-replay.ts
NODE_USE_ENV_PROXY=1 npx tsx --tsconfig tests/workers/tsconfig.json tests/eval/part-reader-strength.ts --runs 3
npx tsx --tsconfig tests/workers/tsconfig.json tests/eval/part-reader-strength-report.ts
```

## 2. Hangi olumluluk dalı tetikleniyor (analizin "emin değilim" dediği yer — artık kesin)

Yöntem: `answer-binding.ts`in depo DIŞINDA (scratchpad) etiketli bir kopyası; her `issues.add("polarity_mismatch")` satırı kendi satır
numarasını yazar. Kopyanın sonucu üründen bayt bayt farklı çıkmadı (27/27 aynı). Satır numaraları ürün dosyasıyla aynı.

| dal | ne okuyor | 27 yanlış / haklı reddin dağılımı | ters cevap tutuşları (tablonun b + c satırları) |
|---|---|---|---|
| **2288** "bütün kalemin olumluluğu ↔ bütün parçanın olumluluğu" | konuyu anan kalem cümlelerinin HEPSİ tek olumluluk sayılır; içlerinden biri olumsuzsa ("Kapalı otopark yok.") kalem olumsuz | 10 (nt6 ×2, hp4 ×3, m6 ×2, ne2 ×2, nt5) | 26 |
| **2296** "yan cümle başına" | parçanın virgülle ayrılan her yan cümlesi kalemin olumluluğunda olmalı | 14 (en1 ×3, en4 ×3, en6 ×2, c11 ×2, nt6, m6, en7, en8) | 6 |
| **2279** "kimlik başına (çok konulu kalem)" | ikinci kimlik (balkon) kendi yan cümlesiyle okunur | 3 (m4 ×3) | 6 |
| 2042 / 2043 ücret kutbu | ücretsiz ↔ ücretli | 0 | 3 |

Yanlış alarmın üç somut mekanizması:
- **2288, iki yönlü kalem:** kalem "Binanın önünde ücretsiz sokak parkı var. Kapalı otopark yok." bütünüyle "olumsuz" okunuyor; yalnız olumlu
  yarıyı söyleyen doğru parça ("free street parking in front of the building") ters sayılıyor. **Aynı okuma tersini de geçiriyor** (bölüm 3.2).
- **2296, virgül:** "Rauchen ist in der gesamten Unterkunft, einschließlich der Terrasse, nicht erlaubt." — yan cümle "Rauchen ist in der
  gesamten Unterkunft" konuyu anıyor ama olumsuzluğu taşımıyor ("nicht erlaubt" virgülden sonra) → olumlu sayılıyor → ters.
- **2279, ikinci kimlik:** "Il est interdit de fumer dans le logement, y compris sur le balcon." — "y compris sur le balcon" yan cümlesi balkon
  kimliğini taşıyor, olumsuzluk taşımıyor → kalemde balkon olumsuz → ters.

## 3. Görev A — ücretsiz tablo sonuçları

### 3.1 Bugünkü hâl (99 satır; 53 "geçmeli", 46 "tutulmalı")

| | doğru tutma | haksız tutma (yanlış alarm) | kaçırma (ters cevabı kod geçiriyor) | doğru geçirme |
|---|---|---|---|---|
| toplam | 40 | **28** | **6** | 25 |
| grup a (27 gerçek ret) | 3 (haklı: ne2 ×2, nt5 — ama sebep olumluluk değil, "bilgilerde yok" anlatımı) | 24 | 0 | 0 |
| grup b (23 ters) | 20 | 0 | 3 | 0 |
| grup c (49 ek) | 17 | 4 | 3 | 25 |
| aynı dil | 12 | 9 | 1 | 11 |
| diller arası | 28 | 19 | 5 | 14 |

Dil kırılımı (parçanın dili): tr 8/5/0/6 · en 12/8/3/9 · de 5/2/0/3 · fr 6/6/1/2 · es 4/2/0/2 · ru 3/4/2/2 · ar 2/1/0/1
(doğru tutma / haksız tutma / kaçırma / doğru geçirme).

Grup c'deki dört haksız tutma: c-08 "Daire içinde parti ve etkinlik yapılamıyor." ↔ "Parti ve etkinlik yapılamaz." (Türkçe ↔ Türkçe, ikisi de
olumsuz!) · c-18 kahve makinesi var / kapsül dahil değil · c-30 Arapça "التدخين غير مسموح…" ↔ "Smoking is not allowed…" · c-34 "Parties and
events are not allowed in the apartment." ↔ "Parti ve etkinlik yapılamaz."

### 3.2 Bugün kodun GEÇİRDİĞİ ters cevaplar (birebir)

| satır | kalem | ters parça | neden geçti |
|---|---|---|---|
| b-03 | Binanın önünde ücretsiz sokak parkı var. Kapalı otopark yok. | Street parking in front of the building is not available. | 2288: kalem bütünüyle "olumsuz", parça olumsuz → uyumlu sayıldı |
| b-13 | (aynı) | Il n’y a pas de stationnement dans la rue devant l’immeuble. | aynı |
| b-20 | (aynı) | Парковаться перед зданием нельзя. | aynı |
| c-19 | Capsule coffee machine in the kitchen; capsules are not included. | There is a capsule coffee machine in the kitchen and capsules are included. | kalem karışık okunmadı, bütünü olumsuz; parça olumlu ama kapsül yan cümlesi ayrı yakalanmadı (kod okuması, emin değilim) |
| c-25 | Havuz misafirler için ücretsizdir. | Using the pool costs extra. | "costs extra" ücret sözlüğünde yok |
| c-29 | Breakfast is not included in the price. | Завтрак включён в стоимость. | konu kalemde bulunamadı (`subject_missing`) → değersiz parça olumluluk dalları hiç koşmadı |

Sonuç: **yanlış alarmı üreten okuma ile ters cevabı kaçıran okuma AYNI** (2288'in iki yönlü kalemi bütün olarak okuması). Kod bu biçimde
"emin" değil — iki yönde de yanılıyor. Bugün bu altı satırın altısını da okuyucu tutuyor (bölüm 5.1); yani bugün misafire gitmiyorlar.

### 3.3 "Yalnız emin olduğunda tut" adayları (ürün kodu değişmeden, sarmalayıcıyla)

Aday ürünün hükmünü sarar: ürün `polarity_mismatch` ile tuttuysa ve aday "emin değilim" derse olumluluk bulgusu tutmaz (kodda kalan öteki
bulgu varsa yine tutar; ardından ürünün kapsam denetimi `missesAskedFacility` de koşulur). Olumluluk ürünün kendi okumasıyla
(`partSignature(…).negative`), dil ürünün `confidentLanguage` işleviyle.

| aday | tanım ("emin" = kod tutar) | geri kazanılan doğru cevap | HÂLÂ kodda tutulan ters | KAÇAN ters (kod geçirir) | bugüne göre yeni kaçan | kalan haksız tutma |
|---|---|---|---|---|---|---|
| bugün | — | 0 | 40 | 6 | 0 | 28 |
| A1 | iki taraf da CÜMLE düzeyinde tek yönlü ve yönler ters | 27 | 14 | 32 | 26 | 1 |
| A2 | iki taraf da YAN CÜMLE (virgül dahil) düzeyinde tek yönlü ve yönler ters | 28 | 12 | 34 | 28 | 0 |
| A3 | A1 + iki taraf da aynı tanınan dilde | 28 | 0 | 46 | 40 | 0 |
| A4 | yalnız kalem cümle düzeyinde tek yönlüyse bugünkü kural; karışık kalemde okuyucuya | 19 | 22 | 24 | 18 | 9 |

**Hiçbir aday "kodda ters cevap kaçırma = 0" şartını sağlamıyor.** Sebep yapısal: ters çevrilmiş cevabın çoğu, yanlış alarmla aynı biçimde
(iki yönlü kalem, diller arası, virgüllü yan cümle). Kodun "emin değilim" dediği her yer, o biçimdeki ters cevabı da okuyucuya bırakır.
A3'ün sıfır tutması ayrıca bir ölçüm bulgusu: ürünün `confidentLanguage` işlevi kısa kalem metinlerinde (ör. "Binada asansör var.") dili
belirleyemiyor (null) → "aynı dil" şartı neredeyse hiç sağlanmıyor.

Bu yüzden asıl soru kodun tek başına değil, **kod + okuyucu birleşiminin** ters cevabı kaçırıp kaçırmadığı → Görev B.

## 4. Görev B — okuyucunun gücü (ücretli)

Model `gpt-5.1-2025-11-13` (ürün okuyucusunun ayarı; çaba gönderilmez). Her vaka **3 kez** (istenen en az 2). 1.089 çağrı, **$1,15** (bütçe
$4; liste fiyatı tahmini, `reply-scoring.ts` `PRICES`). Okuyucu hiçbir çağrıda düşmedi.

"Yanlış geçir" = beklenen "tut", okuyucu tutmadı (en tehlikeli sınıf). "Kararsız" = üç koşuda hüküm değişti.

| küme | kol | vaka | doğru karar (koşu ort.) | kararsız | yanlış geçir (vaka / çağrı) | haksız tutma (vaka) |
|---|---|---|---|---|---|---|
| 1 olumluluk (Görev A tablosu) | ürün | 99 | **97,0%** | 0 | **0 / 0** | 3 |
| 1 olumluluk, notu maskelenen 6 satır | maskesiz | 6 | 100% | 0 | 0 | 0 |
| 2 çelişkili notlar | ürün | 31 | 86,0% | 2 | **5 / 13** | 0 |
| 2 çelişkili notlar | + ek soru (`notes_conflict`) | 31 | 94,6% | 1 | **2 / 5** | 0 |
| 3 dil | ürün | 22 | 27,3% | 0 | **16 / 48** | 0 |
| 3 dil | + ek soru (`in_guest_language`) | 22 | **100%** | 0 | 0 | 0 |
| 4 maske | ürün (maskeli) | 12 | 50,0% | 0 | 0 | **6** |
| 4 maske | maskesiz | 12 | 100% | 0 | 0 | 0 |
| 5 eksik / bilgi yok | ürün | 23 | 95,7% | 0 | **1 / 3** | 0 |

### 4.1 Küme 1 — olumluluk tablosu
- 46 ters cevabın **46'sını** okuyucu üç koşunun üçünde de tuttu (sebep: `binding` 122 çağrı, `not_answered` 15, `partial` 1). Bugün kodun
  geçirdiği altı ters cevap (bölüm 3.2) dahil.
- 27 yanlış alarm satırının 24 doğru cevabından 22'sini okuyucu geçirdi; kalan 2 (c11 ×2) + c-30 = 3 haksız tutmanın üçü de **maske
  hatası** (bölüm 4.4): notlar okuyucuya tamamen silinmiş gidiyor. Maskesiz kolda üçü de geçti.
- Dil kırılımında hata yok (tr / en / de / fr / es / ru / ar hepsi %100, maske satırları hariç).
- İlk koşuda dört "haksız tutma" daha görüldü (c-04, c-05, c-20, c-32 — evcil hayvan); sebep BENİM fikstür hatamdı: aynı ek bilgi tabanında
  "Evcil hayvan kabul edilmez." ve "Pets are allowed." birlikte duruyordu, okuyucu çelişkiyi doğru görüp tuttu. "Pets are allowed." ayrı
  tabana taşındı, küme 1 yeniden koşuldu (sayılar düzeltilmiş hâl; ilk koşunun $0,31'i maliyete dahil).

### 4.2 Küme 2 — çelişkili notlar: yanlış geçirilenler (birebir)

| vaka | notlar | parça | ürün kolu | ek soru kolu |
|---|---|---|---|---|
| cf-cop-1 | "Çöpler salı ve cuma akşamı toplanır." / "Çöp her akşam alınır, kapının önüne bırakın." | Çöpler salı ve cuma akşamı toplanıyor; ayrıca çöpü her akşam kapınızın önüne bırakabilirsiniz. (g3 cf4 birebir) | 3/3 geçti | **3/3 geçti** (`notes_conflict` false) |
| cf-cop-2 | (aynı) | Çöpler salı ve cuma akşamı toplanıyor; her akşam çöpü kapının önüne bırakabilirsiniz. (g4 cf4 birebir) | 3/3 geçti | 2/3 geçti |
| cf-cop-4 | (aynı) | Garbage is collected every evening; just leave it outside the door. | 3/3 geçti | 0/3 (tuttu) |
| cf-key-1 | "Anahtar resepsiyondan alınır." / "Anahtar kapının yanındaki kutuda, kod 4821." | La clé est à récupérer à la réception. | 2/3 geçti | 0/3 |
| cf-wifi-3 | iki farklı şifre | The Wi-Fi network is LaleKonak and the password is lale1234 or gul5678. | 2/3 geçti | 0/3 |

Öteki 18 çelişki vakası (iki Wi-Fi şifresi, ücretsiz ↔ 150 TL, iki havuz saati, iki çıkış saati, izin ↔ yasak, dahil ↔ ücretli) ürün kolunda
da üç koşunun üçünde tutuldu. Sekiz kontrol vakası (genel kural + istisna, kural + ücret, aynı değerin tekrarı) iki kolda da geçti
(`notes_conflict` 24/24 false) — ek soru haksız tutma üretmedi.
- **Çöp örneği gerçekten çelişki mi — emin değilim.** Model iki notu "belediye salı / cuma toplar, bina görevlisi her akşam kapıdan alır" diye
  uzlaştırıyor olabilir; bu okuma savunulabilir. Ama misafire giden birleşim ("her akşam kapıya bırakın") notların hiçbirinin tek başına
  söylemediği bir talimat ve set yazarı bunu "tut" bekliyor.
- **Ek soru kolunun sınırı:** ek cümledeki örnek ("collected on some days in one note and every day in another") çöp vakasının kendisini
  anlatıyor → 94,6% iyimser (sızıntı). Buna rağmen cf-cop-1'i üç koşuda da geçirdi.

### 4.3 Küme 3 — dil
Ürün okuyucusunun isteminde dil sorusu YOK; 16 yanlış-dilli parçanın 16'sını da (48/48 çağrı) geçirdi — Türkçe parça Fransız / İspanyol /
İngiliz / Alman / Rus / Arap misafire, yabancı selam arasına sıkışmış kısa Türkçe cümle (g1 c4 biçimi), İngilizce parça Türk misafire. Tek
ek soru (`in_guest_language`) ile 16/16 tutuldu, 6 aynı-dil kontrolü 6/6 geçti, üç koşuda kararsızlık yok.

### 4.4 Küme 4 — maske: analiz §3.2'nin iddiası ürünün KENDİ işleviyle sınandı; mekanizma DAHA AĞIR
- `buildPartReaderUserContent` gerçek çıktısı: İngilizce "password:" taşıyan kalem notlarda varsa NOTES satırı **tamamen**
  `<<<- [REDACTED_UNPARSEABLE_JSON]>>>` oluyor. Yani yalnız şifre değil, notun ve ARDINDAN gelen bütün notların metni okuyucuya gitmiyor.
  Sebep: `redact.ts` yapısal temizleyicisi kalem satırının "- [WIFI]" köşeli parantezini JSON dizisi adayı sayıyor, ayrıştıramıyor, kalanda
  hassas anahtar ("password") görünce adaydan itibaren her şeyi `[REDACTED_UNPARSEABLE_JSON]` ile değiştiriyor (`src/lib/redact.ts:281`).
  "password: olive2026" tek başına verilince beklenen `password: [REDACTED]` çıkıyor; sorun kalem satırı biçiminde.
- Yan etki Wi-Fi dışına taşıyor: teras bilgi tabanında sigara sorusunun notlarına Wi-Fi kalemi de giriyor ("Lale_Terrace" sözcüğü "terrace"
  konusunu anıyor) → sigara notu da siliniyor. Tabloda c11 ×2 ve c-30 bu yüzden haksız tutuldu.
- Türkçe "şifre:" kalemi maskelenmiyor (mask-11 / mask-12 kontrolü; analizin dediği gibi).
- Parça metni maskelenmiyor.
- Model: maskeli hâlde 6 doğru şifre cevabının 6'sı haksız tutuldu (`binding`, `not_answered`); maskesiz hâlde 6'sı geçti. **Yanlış şifreli 4
  parça (olive2025, olive2062, sunflower89, daisy88) iki hâlde de tutuldu** — maskesiz okuyucu yanlış şifreyi de yakalıyor.

### 4.5 Küme 5 — eksik cevap / "bilgi yok"
17 vakanın 16'sı üç koşuda tutuldu (yarım cevap `partial` 27 çağrı, `not_answered` 12, `binding` 9). Altı tam cevap kontrolü geçti.
Yanlış geçirilen tek vaka (birebir):
- **eks-13** (3/3 geçti): misafir "Есть ли кофемашина?", notlar "Dairede bulaşık makinesi ve çamaşır makinesi var. Çamaşır kurutma makinesi
  yoktur.", parça *"Записи о кофемашине у меня нет."* ("kayıtlarımda kahve makinesi yok"). Okuyucu bunu "sorulana cevap" sayıyor. Kurucu
  kuralı "bilgim yok misafire gitmez"in ihlali. Parça kipinde bu parçanın koddan geçip geçmeyeceği (alıntı ister) ayrı bir soru — bu
  ölçümde okuyucu tek başına sınandı.
- Benzer "belirtilmemiş" anlatımları (eks-9 İspanyolca, eks-10 sauna, eks-11 Fransızca birebir nt5, eks-12 Türkçe, eks-14 tramvay) okuyucu
  tuttu.

## 5. Birleşik hat (olumluluk tablosu; kod tutarsa tutulur, geçirirse okuyucunun üç koşusu)

| kod kuralı | doğru (ort.) | yanlış geçir | haksız tutma | ters cevabı kim tuttu: kod / yalnız okuyucu |
|---|---|---|---|---|
| bugün | 71,7% | 0 | 28 | 40 / 6 |
| A1 | 97,0% | 0 | 3 | 14 / 32 |
| A2 | 97,0% | 0 | 3 | 12 / 34 |
| A3 | 97,0% | 0 | 3 | 0 / 46 |
| A4 | 90,9% | 0 | 9 | 22 / 24 |
| A2, maske hatası olmasaydı (maskesiz kol) | 100% | 0 | 0 | 12 / 34 |

Hiçbir birleşimde ters cevap misafire gitmedi (99 satır × 3 koşu). Bedel: A1 / A2 / A3'te ters cevabın çoğunu artık TEK bir model hükmü
tutuyor — Opus 10-23 B1'in "izin ↔ yasak tek bir model hükmüne bırakılmaz" gerekçesi tam da bu. Ölçüm bu hükmün bu tabloda kararlı
olduğunu gösteriyor; daha geniş bir setin aynısını göstereceğini göstermiyor.

## 6. Maliyet
1.089 okuyucu çağrısı, $1,15 (ilk tam koşu $0,83 + düzeltilmiş küme 1'in yeniden koşusu $0,31 + deneme koşusu $0,03 — sonuncusu çıktı dosyasına
dahil değil). Çağrı başına ~$0,001 (sistem istemi önbellekte).

## 7. Ölçerin sınırları
1. **Vakaları ben yazdım** (b, c satırları ve Görev B'nin çoğu); a satırları ve "birebir" işaretli vakalar gerçek koşulardan. Görülmemiş, başka
   birinin yazdığı bir set değil. Okuyucu bu sette çok iyi çıktı; aynı başarı kör sette doğrulanmadan kabul edilmemeli.
2. Okuyucu tek parçayla çağrıldı (üründe aynı turun bütün doğrulanmış parçaları birlikte gider), tarih satırı (DATES) ve önceki konuşma yok.
3. Küme 1'de notlar ürünün kuralıyla kuruldu (dayanak kalem + konuyu anan kalemler). Kümeler 2–5'te notlar elle verildi.
4. Ek soru kollarının cümlesi bu betikte; çelişki cümlesi test vakasına benzer örnek taşıyor (iyimser).
5. A1–A4 "emin" tanımları ürünün olumsuzluk okumasını (`partSignature`) kullanıyor — o okumanın zayıflığı (ör. Almanca "keinen" olumsuz
   okunmuyor: c-46) adaylara da geçiyor.
6. Adayın kapsam denetimi taklidi (`missesAskedFacility`) ürünün sırasının yaklaşığıdır; ürün olumluluk bulgusu kalkınca başka danışma
   bulgularını da (okuyucu kipinde tutmayanlar) yazar, hüküm değişmez.
7. Fiyatlar liste fiyatı; fatura değil.
8. Ürünün sağlayıcı sağlık kaydı başarı sonrası veritabanına yazmaya çalıştı (`systemLock`), ortamda veritabanı adresi olmadığı için
   sessizce düştü; ölçüme etkisi yok.
