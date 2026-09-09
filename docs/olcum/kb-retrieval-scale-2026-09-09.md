# Retrieval ölçek ölçümü — 30 / 100 / 300 kalem (2026-09-09, commit 94a842e + çalışma ağacı (rapor kodla aynı commit'e girer; hash ebeveyndir))

> Sentetik mülk KB'leri (`tests/helpers/kb-retrieval-synthetic.ts`, tohum 42): 36 konu × 3 TR paraphrase + EN varyant,
> konu başına TR/EN/eşanlam/yazım-hatası soruları, n/10 çeldirici, her 50 kaleme 7k rehber (3 gömülü gerçek).
> `updatedAt` 400 güne tohumlu yayılır. Model YOK: 'cevabın kaynakla desteklenmesi' burada ÖLÇÜLMEZ (gerçek eval).
> hit@k = doğru kalem kimliği seçim sıralamasının ilk k'sında; inPrompt = doğru kaynak istem bloğunda; noise = seçilen ilgisiz kalem;
> chars = blok karakteri (maliyet vekili); ms = seçici süresi (soğuk: indeks kurulumu dahil; ılık: önbellek). Üretici: `tests/unit/kb-retrieval-scale.test.ts`.

## n=30 konu kalemi (toplam 34 kalem, 123 soru)

| Yapılandırma | hit@1 | hit@3 | inPrompt | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | — | — | 90% | 29.1 | 4371 | — | — | — | — |
| hibrit bm25 | 94% | 100% | 100% | 0.8 | 352 | 14.2 | 1.4 | 3.3 | 0 |
| hibrit RRF (bm25+ngram) | 93% | 99% | 100% | 1.8 | 718 | 8.9 | 1.3 | 3.5 | 0 |
| hibrit birleşik (bm25+ngram, CombSUM) | 94% | 99% | 100% | 1.0 | 457 | 5.9 | 1.2 | 3.5 | 0 |

Soru türüne göre inPrompt (birleşik CombSUM): guide 3/3 · tr 30/30 · en 30/30 · syn 30/30 · typo 30/30
Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## n=100 konu kalemi (toplam 112 kalem, 155 soru)

| Yapılandırma | hit@1 | hit@3 | inPrompt | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | — | — | 51% | 29.3 | 4513 | — | — | — | — |
| hibrit bm25 | 93% | 97% | 99% | 2.7 | 726 | 27.4 | 1.9 | 5.6 | 0 |
| hibrit RRF (bm25+ngram) | 91% | 95% | 99% | 5.3 | 1475 | 15.3 | 2.2 | 5.5 | 0 |
| hibrit birleşik (bm25+ngram, CombSUM) | 92% | 96% | 99% | 2.8 | 830 | 15.1 | 2.1 | 5.7 | 0 |

Soru türüne göre inPrompt (birleşik CombSUM): guide 3/3 · tr 38/38 · en 38/38 · syn 37/38 · typo 38/38
Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## n=300 konu kalemi (toplam 336 kalem, 155 soru)

| Yapılandırma | hit@1 | hit@3 | inPrompt | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | — | — | 59% | 29.2 | 2925 | — | — | — | — |
| hibrit bm25 | 93% | 94% | 99% | 3.3 | 1220 | 54.5 | 3.2 | 7.9 | 0 |
| hibrit RRF (bm25+ngram) | 91% | 93% | 99% | 4.3 | 1439 | 52.4 | 4.1 | 8.2 | 0 |
| hibrit birleşik (bm25+ngram, CombSUM) | 94% | 95% | 99% | 3.6 | 1325 | 48.4 | 3.9 | 7.9 | 0 |

Soru türüne göre inPrompt (birleşik CombSUM): guide 3/3 · tr 38/38 · en 38/38 · syn 37/38 · typo 38/38
Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## Okuma kılavuzu
- Legacy sıralama soruya bakmaz; hit@k anlamsızdır ('—'). inPrompt = en yeni 30 kalem + 24k bütçe içinde doğru kaynak var mı.
- 300 kalem ürün plan tavanının (60/mülk) üstündedir; ölçek davranışı için sentetiktir. Hibritte `kb-fetch` okuma tavanı 200'dür (canlıda en yeni 200).
- n-gram kaynağı ANLAMSAL değildir (yazım benzerliği); gömme tabanlı kaynak sözleşmesi hazır, ücretli servis onayı bekler.
