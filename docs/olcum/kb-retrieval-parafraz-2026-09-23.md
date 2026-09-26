# Retrieval — kelime paylaşmayan (parafraz) sorular ve küçük-KB eşiği (09-23)

Model YOK, ağ YOK, ücretli servis YOK. Sentetik KB (`tests/helpers/kb-retrieval-synthetic.ts`, seed 42) +
ölçek harness'ının soruları + YENİ parafraz/negatif kümesi (`tests/helpers/kb-paraphrase-set.ts`, 82 + 20
sorgu; ajan ölçümü, sentetik). Ölçü **inPrompt(metin)** = cevap CÜMLESİ istem bloğunda mı (ölçek
harness'ıyla aynı). Legacy = en yeni 30 kalem (`packKnowledgeBase`, 24k).

## Bulgu: hibrit, tipik host KB'sinde legacy'den AZ bilgi taşıyordu

Parafraz kümesinin 82 sorgusundan 74'ü altın kalemle hiçbir güçlü kökü paylaşmıyor (yalnız 11'inde
sözlük kavramı ipucu var). Sözcüksel seçici böyle bir soruda ya hiç isabet bulamıyor (dürüst geri çekilme)
ya da tesadüfi bir kelimeyle ("gece", "akşam", "araba") YANLIŞ kaleme daralıyor — cevap bloğa hiç girmiyor.

Eski küçük-KB şartı `kalem ≤ 12 VE ≤ 6k` idi (12 = seçimin ÇIKTI tavanı). 13–30 kalemlik, tamamı 6k'ya
sığan KB — yani tipik bir host — daraltılıyordu:

| KB | sınıf | hibrit ÖNCE | hibrit SONRA | legacy |
|---|---|---|---|---|
| 15 kalem (3,1k) | parafraz TR | %33 | **%100** | %100 |
| 15 kalem | parafraz EN | %83 | **%100** | %100 |
| 20 kalem (3,6k) | parafraz TR | %35 | **%100** | %100 |
| 20 kalem | parafraz EN | %78 | **%100** | %100 |
| 15/20 kalem | ölçek soruları (tr/syn/typo/morph/en/guide) | %100 | %100 | %100 |

Bu, 09-11'de bayrak açılırken yazılan "hibrit legacy'den AZ bilgi taşımaz" değişmezinin ihlaliydi; o günkü
yan etki ölçümü yalnız kelime paylaşan soruları kullandığı için görmedi.

**Düzeltme (`select.ts`):** küçük-KB kalem eşiği legacy tavanı (`KB_ITEM_CAP` = 30). Tamamı 6k'ya sığan
(⚠️ ikinci turda 24k'ya çıktı, ↓) ≤30 kalemlik KB'de seçim yapılmaz; blok legacy ile BİREBİR. Bedel: bu KB'lerde blok artık legacy boyutunda
(15 kalemde ~133–440 → 3.129 karakter; ≈ +0,8k token, gpt-5.1 fiyatıyla cevap başına ~0,1 sent). Kötü niyetli
kalem maruziyeti de legacy ile aynı (retrieval zaten politika değildi; koruma sır elemesi + injection vetosu).

## Büyük KB (>30 kalem ya da >6k): sözcüksel yöntemin YAPISAL sınırı — düzeltilmedi

| KB | sınıf | hibrit | legacy | blok (hibrit / legacy) |
|---|---|---|---|---|
| 34 kalem | ölçek | %100 | %90 | 164–426 / 4.220 |
| 34 kalem | parafraz TR / EN | %36 / %64 | %91 / %91 | ~1.550 / 4.220 |
| 112 kalem | ölçek | %97–100 | %50 | 412–612 / 4.361 |
| 112 kalem | parafraz TR / EN | %29 / %46 | %54 / %54 | ~2.000 / 4.361 |
| 336 kalem | ölçek | %100 | %61 | ~950 / 2.772 |
| 336 kalem | parafraz TR / EN | %24 / %51 | %56 / %56 | ~2.200 / 2.772 |

**Denenen ve REDDEDİLEN ücretsiz kural — "zayıf kanıtta daraltma":** en üstteki parçanın sorgunun güçlü
köklerinin ne kadarını karşıladığına bakıp düşük kapsamda geri çekilmek. Ayrışma temiz değil: 112/336
kalemde ölçek sorularının 15–19'u (/193) da düşük kapsam kovasına düşüyor; bu sorular geri çekilince en
yeni 30'a iner ve cevabı kaybeder (inPrompt %99 pini). Parafraz kazancı yalnız "şansa" legacy düzeyine
çıkmak olurdu. Kural eklenmedi.

Doğru araç anlamsal aday kaynağıdır (embedding): ölçüm düzeneği `tests/eval/embedding-e4.eval.test.ts`
(gerçek çağrı kurucunun, `npm run eval`, maliyet < 0,1 sent). E5 (üretime bağlama) kararı o ölçüme bağlı:
parafraz inPrompt belirgin artmalı, ölçek sınıfı %99'un altına inmemeli, negatif sorgularda blok şişmemeli.

## Kanıt

`tests/unit/kb-retrieval-small-kb.test.ts` (15/20 kalemde her parafrazın cevabı blokta ve blok legacy ile
birebir · ESKİ eşikle aynı KB'de 46 sorgunun 20'si düşüyordu · sınır 30/31 · 6k'yı aşan ≤30 kalemde seçim
sürer). Kırmızı-önce: eski eşikle 2 test düşer. Mutasyon 6/6. (⚠️ İlk turda seçim mekaniği testleri eski eşiği
veren bir sarmalayıcı kullanıyordu; ikinci turda KALDIRILDI ↓.) Rota entegrasyon testleri 30 kalemi aşan KB kurar.
Eşleştirilmiş gerçek-model eval'i v2: R4/R5 dolgu 20 → 34 (hibrit mekaniği sınamaya devam etsin).

## İkinci tur (aynı gün) — dış eleştiri, ajan önerileri, ölçümler

**Dış bir yapay zekânın üç eleştirisi, kodla sınandı:**
1. *"Kalem SAYISIYLA karar vermek tehlikeli; 15 kalem 50k token olabilir"* — **öncül yanlış**: kural
   sayı VE karakter birlikte (15 kalem 50k token → karakter eşiğini aşar → seçim yapılır).
2. *"Küçük KB'de filtre kapanınca zararlı içerik modele ulaşıyor"* — **yarı doğru**: retrieval hiç
   güvenlik katmanı değildi (legacy ve ≤12 kalemlik KB hep tüm kümeyi gönderiyordu), ama KB içeriği için
   HİÇBİR tarama yoktu → her boyutta çalışan KB talimat-ele-geçirme süzgeci eklendi (↓).
3. *"Eski davranışı taklit eden sarmalayıcı test geçirmek içindir"* — **kısmen haklı**: sarmalayıcı
   üretim kodunu değiştirmiyordu ama üretim varsayılanını da sınamıyordu → kaldırıldı; seçim mekaniği
   testleri üretim varsayılanlarıyla, 30 kalemi aşan (nötr dolgulu) fikstürde koşar.

**Karakter eşiği 6k → 24k (legacy'nin kendi bütçesi)** — ajan ölçümü, kodda tekrarlandı:

| KB | parafraz TR (önce → sonra) | parafraz EN | legacy |
|---|---|---|---|
| 21 kalem / 7,6k | %35 → **%100** | %53 → **%100** | %100 |
| 26 kalem / 8,8k | %41 → **%100** | %61 → **%100** | %100 |
| 30 kalem / 9,9k | %38 → **%100** | %56 → **%100** | %100 |

**Cevapsız önceki misafir soruları sorguya** (son cevaptan sonraki, en fazla 3): art arda iki soruda
İLK sorunun cevabı isteme %12/%10 → **%99/%97** (100/300 kalem). Bedel: 300 kalemde son sorunun cevabı
%100 → %95 (bütçe paylaşılıyor); blok +100–330 karakter.

**Ölçülüp REDDEDİLENLER (tekrar denenmesin):**
- İsabetsiz soruda önceki misafir mesajıyla yeniden sorgu: takip sorusunda +12–15 puan, ama ilgisiz
  parafraz sorusunda −5–8 puan (100/300 kalem) → net belirsiz.
- Anahtar kelime sınıflandırıcısının niyetini kategori ipucu yapmak: parafrazda 0/44 doğru kategori,
  %11 yanlış kategori ("nerede" → konum).
- İsabetsizlikte en yeni 30 yerine tahmini kategorinin kalemleri: daha kötü (16→14, 8→6, 11→9).
- Kategorilerin retrieval katkısı (ablasyon: hepsini "general" yap): anahtar kelimeli soruda ±1 puan.
  Kategoriler zamanlanmış mesajları ve sır gizlemeyi yönetir; retrieval için yeni kategori eklenmez.

**KB talimat-ele-geçirme süzgeci** (`detectKbInstructionHijack`, `kb-fetch` tek boğaz, her boyutta):
misafir kalıpları KB'de 16 gerçekçi host cümlesinin 10'unda yanlış pozitif → ayrı dar liste. İki ayrı
ajanın KÖR bataryası: 150 meşru metin + repodaki 530+ KB metni **0 yanlış pozitif**; kör v2 ilk koşu
**22/60** saldırı (genelleme ölçüsü; sonra 38/60, görülmüş küme). Kalan sınıf "düz emir" (kodu paylaş,
devretme, teknisyen yolda de): meşru host talimatıyla biçimce aynı → çıktı katmanları (sır filtresi,
çıktı vetosu, kelime ağı kapısı) ve hesap güvenliği karşılar. Eleme sessiz değil: host "Yapay zekâ
kullanmıyor" rozetini görür; karar kaydında `hj`.

## Üçüncü tur (aynı gün): "kurumsal RAG" önerileri tek tek ölçüldü

Kurucunun ilettiği öneri tablosu (hibrit yoğun+seyrek arama · çapraz-kodlayıcı yeniden sıralama · "sabit
karakter/kalem sınırı yerine %80 üstü alaka, en iyi 3–5 parça" · "Lost in the Middle"). Üç ajan: sektör
araştırması (web), yerel reranker fizibilitesi (ölçüm), kesme kuralları (ölçüm, repo değişmeden).

**1. Skor eşiğiyle dinamik kesme — REDDEDİLDİ (ölçüldü).** Üretim seçicisinin parametrik kopyası (970
kontrolde üretimle birebir) 100/300 kalemde; ölçek 193 + parafraz 82 + negatif 20 + iki sorulu 190 mesaj:

| varyant (n=100 / 300) | ölçek kaçan /193 | parafraz inPrompt | iki soru, ikisi de kaçan /190 | ort. blok |
|---|---|---|---|---|
| **bugünkü** (göreli taban 0,25·en iyi, 6k/12) | **1 / 0** | %38 / %38 | **2 / 6** | 685 / 1195 |
| puan ≥ 0,8, en fazla 5 | 2 / 6 | %34 / %35 | 8 / 11 | 451 / 637 |
| göreli 0,5 + 6k/12 | 1 / 1 | %37 / %38 | 4 / 6 | 475 / 1016 |
| diz (en büyük boşluk) | 4 / 5 | %35 / %38 | 8 / 8 | 416 / 889 |

Puan bir yüzde DEĞİL: en iyi parça her sorguda ~1,00 + bonus alır; cevabı KB'de olmayan (negatif) sorgular da
1,00–1,35 alıyor ("dişçi önerir misiniz?" 1,35) → "≥0,8" kuralı pratikte "her zaman ilk 5" demek, hiçbir
eşik cevaplanabilir ile cevaplanamazı ayıramıyor (dengeli doğruluk en iyi 0,70–0,71; ham BM25'te 0,77–0,79).
Her kesme cevap kaybettiriyor; kazanç mesaj başına ~60 token. Sektör de mutlak eşiği güvenilir saymıyor
(Cohere: puan sorguya bağlı, kalibrasyon ister; Vectara: göreli "diz" kesmesi).

**2. Asıl açık kesme değil ADAY ÜRETİMİ.** 275 cevaplanabilir sorunun 58'inde cevap parçası sözcüksel
aday listesine HİÇ girmiyor (çoğu parafraz). Kesme yalnız listeyi kısaltır; bunu yalnız ikinci bir aday
üreticisi (embedding) kapatır → **üretim yolu yazıldı, anahtar KAPALI** (`KB_SEMANTIC_RETRIEVAL`):
- alt sorgu BAŞINA anlamsal puan (tek mesaj vektörü iki konunun karışımı),
- her alt sorgu, ait olduğu HAM cümle + virgülle bölündüyse kendisiyle sorulur; puan en yüksek kosinüs
  ("Gece çok üşüdük, evi ılık yapabilir miyiz?" virgülle ikiye bölünür, "gece çok üşüdük" tek başına anlamsız),
- sıcak yol 1,5 sn bütçe; soğuk KB misafiri bekletmez (arka planda ısıtma, saatlik tavan), yarım harita yok,
- kalıcı sağlayıcı arızası geçiş tabanlı alarm (ayrı anahtar), kanıtta `sem` durumu.

**3. Yeniden sıralamada anlamsal uyum bonusu (ölçüldü, kâhin sinyal).** Mevcut bonusların hepsi sözcükseldi;
kusursuz anlamsal sinyal verildiğinde bile iki sorulu parafraz mesajında iki cevap birden bloğa yalnız
**%87** giriyordu ("gece" kelimesiyle gelen ilgisiz sessizlik kuralı, kelime paylaşmayan ısıtma cevabını
geçiyordu). Kavram ipucuyla aynı büyüklükte bonus → **≥%90**. Anlamsal kaynak yokken etkisi sıfır.

**4. Çapraz-kodlayıcı (cross-encoder) — ŞİMDİLİK HAYIR (ölçüldü).** Aynı sınıf rastgele ağırlıklı ONNX
modellerle bu makinede (4 vCPU): 25 aday × ~128 token küçük model 320–490 ms, taban model 650–1.240 ms, büyük
model 2,2 sn+; çağrı Node olay döngüsünü BLOKLUYOR (ayrı iş parçacığı şart); en iyi çok dilli modelin lisansı
ticari kullanıma kapalı (jina v2), temiz lisanslı olan taban boyutlu (gte-multilingual); Türkçe kazancı
yayımlanmış bir ölçümde yok; HuggingFace erişimi bu ortamda kapalı olduğu için kalite ölçülemedi. Bizde seçilen
blok zaten ≤12 parça ve onu okuyan gpt-5.1 fiilen yeniden sıralayıcıdır. Barındırılan reranker (Cohere) yeni
alt-işleyen = KVKK + onay. Yeniden değerlendirme ölçütü: E4 sonrası hassasiyet (yanlış ilk parça) sorunu
kalırsa `gte-multilingual-reranker-base`, 10 aday × 128 token, iş parçacığında (~0,5 sn) — kalite testi
(`quality.mjs`, ajan betiği) önce.

**5. "Lost in the Middle".** Seçilen blok ≤6k karakter ve en iyi parça önde; tam küme (≤24k) kodda
`updatedAt` sırasında. Uzunluk etkisi 5–10k token'da küçük ama sıfır değil (NoLiMa: sözcük örtüşmesi düşük
sorularda etkili uzunluk birçok modelde ~2k token). Tam kümeyi alakaya göre sıralamak istemi değiştirir →
yalnız gerçek-model eval'iyle karar verilir (kredi); ölçülmeden değiştirilmedi.

**Sektör (web araştırması):** STR rakiplerinin (Guesty ReplyAI, Hostaway, Hospitable, HostAI, Enso, Breezeway)
hiçbiri retrieval mimarisini açıklamıyor; Airbnb'nin kendi destek sistemi: embedding ile ilk 30 makale +
LLM ile yeniden sıralama. Anthropic "Contextual Retrieval": bağlamsal parça başlığı + BM25 + rerank ile ilk-20
kaçırma %5,7 → %1,9; KB 200k token altındaysa "hepsini isteme koy + önbellek" önerisi — bizim ≤24k tam küme
kuralımızla aynı yön. Bağlamsal parça metni (kategori · başlık) gömme tarafında zaten var.
