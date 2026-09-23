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
≤30 kalemlik KB'de seçim yapılmaz; blok legacy ile BİREBİR. Bedel: bu KB'lerde blok artık legacy boyutunda
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
sürer). Kırmızı-önce: eski eşikle 2 test düşer. Mutasyon 6/6. Seçim MEKANİĞİ testleri küçük fikstürde eski
eşiği açıkça verir (`tests/helpers/select-mechanics.ts`); rota entegrasyon testleri 30 kalemi aşan KB kurar.
Eşleştirilmiş gerçek-model eval'i v2: R4/R5 dolgu 20 → 34 (hibrit mekaniği sınamaya devam etsin).
