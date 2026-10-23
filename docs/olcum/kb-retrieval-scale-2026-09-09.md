# Retrieval ölçek ölçümü — 30 / 100 / 300 kalem (2026-09-09, commit 3a4d0d2 + çalışma ağacı (rapor kodla aynı commit'e girer; hash ebeveyndir))

> Sentetik mülk KB'leri (`tests/helpers/kb-retrieval-synthetic.ts`, tohum 42): 38 konu × 3 TR paraphrase + EN varyant,
> konu başına TR / eşanlam / yazım-hatası / EK VARYASYONU (morph) / EN soruları, n/10 çeldirici, her 50 kaleme 7k rehber (3 gömülü gerçek).
> `updatedAt` 400 güne tohumlu yayılır. Model YOK: 'cevabın kaynakla desteklenmesi' burada ÖLÇÜLMEZ (gerçek eval: eşleştirilmiş harness).
> hit@k = doğru kalem kimliği seçim sıralamasının ilk k'sında; **inPrompt(metin) = CEVAP İÇİN GEREKLİ CÜMLE istem bloğunda** (asıl ölçü);
> inPrompt(kimlik) = doğru kalem kimliği blokta (eski ölçü, kıyas için); noise = seçilen ilgisiz kalem; chars = blok karakteri (maliyet vekili);
> ms = seçici süresi (soğuk: indeks kurulumu dahil; ılık: önbellek). **CANLI** = `kb-fetch` okuma tavanı (en yeni 200) uygulanmış hibrit.
> Üretici: `tests/unit/kb-retrieval-scale.test.ts`. ANLAMSAL (embedding) kaynak ÜRETİMDE YOK — burada hiçbir satır anlamsal retrieval ölçmez.

## n=30 konu kalemi (toplam 34 kalem, 153 soru)

| Yapılandırma | havuz | hit@1 | hit@3 | inPrompt (METİN) | inPrompt (kimlik) | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | 30 | — | — | **90%** | 90% | 29.1 | 4371 | — | — | — | — |
| hibrit bm25 (n-gram KAPALI) | 34 | 92% | 97% | **99%** | 99% | 1.6 | 455 | 17.5 | 1.3 | 3.5 | 4 |
| hibrit n-gram AÇIK (her sorguda) | 34 | 93% | 97% | **99%** | 99% | 1.5 | 507 | 8.7 | 1.2 | 3.2 | 3 |
| hibrit RRF (bm25+ngram) | 34 | 92% | 97% | **99%** | 99% | 2.5 | 778 | 8.2 | 1.1 | 3 | 3 |
| hibrit VARSAYILAN (n-gram auto=TR, CombSUM) | 34 | 93% | 97% | **99%** | 99% | 1.5 | 482 | 6.8 | 1.2 | 3.5 | 3 |
| hibrit CANLI (varsayılan + kb-fetch tavanı 200) | 34 | 93% | 97% | **99%** | 99% | 1.5 | 482 | 5.9 | 1.2 | 3.5 | 3 |

N-gram AYRI ÖLÇÜM — soru türüne göre inPrompt(metin) / ortalama gürültü:

| Soru türü | n | n-gram KAPALI | n-gram auto (VARSAYILAN) | n-gram AÇIK |
|---|---|---|---|---|
| tr | 30 | 30/30 · gürültü 0.80 | 30/30 · gürültü 0.80 | 30/30 · gürültü 0.80 |
| syn | 30 | 30/30 · gürültü 0.93 | 30/30 · gürültü 1.37 | 30/30 · gürültü 1.33 |
| typo | 30 | 30/30 · gürültü 0.83 | 30/30 · gürültü 0.80 | 30/30 · gürültü 0.80 |
| morph | 30 | 29/30 · gürültü 5.03 | 29/30 · gürültü 3.90 | 29/30 · gürültü 3.90 |
| en | 30 | 30/30 · gürültü 0.50 | 30/30 · gürültü 0.50 | 30/30 · gürültü 0.70 |
| guide | 3 | 3/3 · gürültü 0.67 | 3/3 · gürültü 0.67 | 3/3 · gürültü 0.67 |

Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## n=100 konu kalemi (toplam 112 kalem, 193 soru)

| Yapılandırma | havuz | hit@1 | hit@3 | inPrompt (METİN) | inPrompt (kimlik) | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | 30 | — | — | **51%** | 51% | 29.3 | 4513 | — | — | — | — |
| hibrit bm25 (n-gram KAPALI) | 112 | 91% | 95% | **98%** | 98% | 3.5 | 825 | 16.9 | 1.8 | 5.2 | 2 |
| hibrit n-gram AÇIK (her sorguda) | 112 | 92% | 95% | **98%** | 98% | 3.1 | 834 | 15.9 | 2.2 | 5.5 | 1 |
| hibrit RRF (bm25+ngram) | 112 | 89% | 93% | **98%** | 98% | 5.7 | 1486 | 19.3 | 2.1 | 5.3 | 1 |
| hibrit VARSAYILAN (n-gram auto=TR, CombSUM) | 112 | 92% | 95% | **98%** | 98% | 2.9 | 778 | 20.1 | 2 | 5.6 | 1 |
| hibrit CANLI (varsayılan + kb-fetch tavanı 200) | 112 | 92% | 95% | **98%** | 98% | 2.9 | 778 | 17 | 2.1 | 5.3 | 1 |

N-gram AYRI ÖLÇÜM — soru türüne göre inPrompt(metin) / ortalama gürültü:

| Soru türü | n | n-gram KAPALI | n-gram auto (VARSAYILAN) | n-gram AÇIK |
|---|---|---|---|---|
| tr | 38 | 38/38 · gürültü 2.39 | 38/38 · gürültü 2.39 | 38/38 · gürültü 2.42 |
| syn | 38 | 37/38 · gürültü 2.92 | 37/38 · gürültü 3.11 | 37/38 · gürültü 3.05 |
| typo | 38 | 38/38 · gürültü 2.32 | 38/38 · gürültü 2.08 | 38/38 · gürültü 2.08 |
| morph | 38 | 35/38 · gürültü 8.11 | 35/38 · gürültü 5.11 | 35/38 · gürültü 5.11 |
| en | 38 | 38/38 · gürültü 2.03 | 38/38 · gürültü 2.03 | 38/38 · gürültü 2.76 |
| guide | 3 | 3/3 · gürültü 3.00 | 3/3 · gürültü 3.00 | 3/3 · gürültü 3.00 |

Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## n=300 konu kalemi (toplam 336 kalem, 193 soru)

| Yapılandırma | havuz | hit@1 | hit@3 | inPrompt (METİN) | inPrompt (kimlik) | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | 30 | — | — | **60%** | 60% | 29.2 | 2925 | — | — | — | — |
| hibrit bm25 (n-gram KAPALI) | 336 | 90% | 92% | **98%** | 98% | 6.4 | 1425 | 52.2 | 2.9 | 7 | 2 |
| hibrit n-gram AÇIK (her sorguda) | 336 | 92% | 94% | **98%** | 98% | 4.9 | 1389 | 52.5 | 3.8 | 7.1 | 1 |
| hibrit RRF (bm25+ngram) | 336 | 90% | 91% | **97%** | 97% | 5.7 | 1537 | 51.8 | 4 | 8.1 | 1 |
| hibrit VARSAYILAN (n-gram auto=TR, CombSUM) | 336 | 92% | 94% | **97%** | 97% | 4.7 | 1312 | 49.4 | 3.8 | 8 | 1 |
| hibrit CANLI (varsayılan + kb-fetch tavanı 200) | 200 | 92% | 94% | **98%** | 98% | 4.3 | 1076 | 30.1 | 2.8 | 6.6 | 1 |

N-gram AYRI ÖLÇÜM — soru türüne göre inPrompt(metin) / ortalama gürültü:

| Soru türü | n | n-gram KAPALI | n-gram auto (VARSAYILAN) | n-gram AÇIK |
|---|---|---|---|---|
| tr | 38 | 38/38 · gürültü 2.74 | 38/38 · gürültü 2.87 | 38/38 · gürültü 2.87 |
| syn | 38 | 38/38 · gürültü 3.74 | 37/38 · gürültü 3.84 | 37/38 · gürültü 3.84 |
| typo | 38 | 38/38 · gürültü 2.63 | 38/38 · gürültü 2.61 | 38/38 · gürültü 2.71 |
| morph | 38 | 35/38 · gürültü 19.95 | 35/38 · gürültü 11.16 | 35/38 · gürültü 11.16 |
| en | 38 | 38/38 · gürültü 2.74 | 38/38 · gürültü 2.74 | 38/38 · gürültü 3.63 |
| guide | 3 | 2/3 · gürültü 7.00 | 2/3 · gürültü 7.00 | 3/3 · gürültü 6.67 |

Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## Okuma kılavuzu
- Legacy sıralama soruya bakmaz; hit@k anlamsızdır ('—'). inPrompt = en yeni 30 kalem + 24k bütçe içinde doğru kaynak var mı.
- **CANLI satırı gerçek akıştır:** 300 konu kalemi (336 kalem) canlı tavanın (200) üstündedir; tavan dışındaki kalemin cevabı bloğa GİREMEZ ve bu kayıp burada dürüstçe görünür.
  300 kalem ürün plan tavanının (60/mülk) çok üstündedir; canlıda hiçbir mülk tavana çarpmaz — ama ölçüm canlı yolu ölçer, idealize etmez.
- n-gram kaynağı ANLAMSAL DEĞİLDİR (karakter 3-gram yazım benzerliği). Ayrı ölçüm: yazım hatasında katkı yok (OSA fuzzy zaten var), ek varyasyonunda gürültüyü azaltır,
  İngilizce sorguda Türkçe metne düşen gramlar isabeti düşürüp bloğu büyütür → varsayılan **auto** (yalnız Türkçe algılanan sorguda). Gömme tabanlı kaynak: sözleşme hazır, ücretli servis onayı bekler; ÜRETİMDE YOK.
