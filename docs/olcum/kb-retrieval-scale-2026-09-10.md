# Retrieval ölçek ölçümü — 30 / 100 / 300 kalem (2026-09-10, commit 1395dc8 + çalışma ağacı (rapor kodla aynı commit'e girer; hash ebeveyndir))

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
| hibrit bm25 (n-gram KAPALI) | 34 | 96% | 100% | **100%** | 100% | 0.8 | 348 | 15.5 | 1 | 2.6 | 0 |
| hibrit n-gram AÇIK (her sorguda) | 34 | 96% | 100% | **100%** | 100% | 0.9 | 417 | 7.5 | 1.1 | 3.1 | 0 |
| hibrit RRF (bm25+ngram) | 34 | 95% | 100% | **100%** | 100% | 1.9 | 698 | 10.5 | 1 | 2.6 | 0 |
| hibrit VARSAYILAN (n-gram auto=TR, CombSUM) | 34 | 97% | 100% | **100%** | 100% | 0.9 | 397 | 5.6 | 0.9 | 2.3 | 0 |
| hibrit CANLI (varsayılan + kb-fetch tavanı 200) | 34 | 97% | 100% | **100%** | 100% | 0.9 | 397 | 5.3 | 1 | 2.4 | 0 |

N-gram AYRI ÖLÇÜM — soru türüne göre inPrompt(metin) / ortalama gürültü:

| Soru türü | n | n-gram KAPALI | n-gram auto (VARSAYILAN) | n-gram AÇIK |
|---|---|---|---|---|
| tr | 30 | 30/30 · gürültü 0.80 | 30/30 · gürültü 0.80 | 30/30 · gürültü 0.80 |
| syn | 30 | 30/30 · gürültü 0.83 | 30/30 · gürültü 1.30 | 30/30 · gürültü 1.27 |
| typo | 30 | 30/30 · gürültü 0.83 | 30/30 · gürültü 0.80 | 30/30 · gürültü 0.80 |
| morph | 30 | 30/30 · gürültü 0.87 | 30/30 · gürültü 0.87 | 30/30 · gürültü 0.87 |
| en | 30 | 30/30 · gürültü 0.53 | 30/30 · gürültü 0.53 | 30/30 · gürültü 0.70 |
| guide | 3 | 3/3 · gürültü 0.67 | 3/3 · gürültü 0.67 | 3/3 · gürültü 0.67 |

Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## n=100 konu kalemi (toplam 112 kalem, 193 soru)

| Yapılandırma | havuz | hit@1 | hit@3 | inPrompt (METİN) | inPrompt (kimlik) | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | 30 | — | — | **51%** | 51% | 29.3 | 4513 | — | — | — | — |
| hibrit bm25 (n-gram KAPALI) | 112 | 96% | 97% | **99%** | 99% | 2.2 | 679 | 15.1 | 1.5 | 4.5 | 0 |
| hibrit n-gram AÇIK (her sorguda) | 112 | 95% | 97% | **99%** | 99% | 2.3 | 731 | 16.4 | 1.6 | 3.7 | 0 |
| hibrit RRF (bm25+ngram) | 112 | 94% | 96% | **99%** | 99% | 5.0 | 1403 | 15.2 | 1.5 | 3.7 | 0 |
| hibrit VARSAYILAN (n-gram auto=TR, CombSUM) | 112 | 96% | 97% | **99%** | 99% | 2.2 | 684 | 14.8 | 1.5 | 3.8 | 0 |
| hibrit CANLI (varsayılan + kb-fetch tavanı 200) | 112 | 96% | 97% | **99%** | 99% | 2.2 | 684 | 14.4 | 1.5 | 4.1 | 0 |

N-gram AYRI ÖLÇÜM — soru türüne göre inPrompt(metin) / ortalama gürültü:

| Soru türü | n | n-gram KAPALI | n-gram auto (VARSAYILAN) | n-gram AÇIK |
|---|---|---|---|---|
| tr | 38 | 38/38 · gürültü 1.97 | 38/38 · gürültü 2.00 | 38/38 · gürültü 2.03 |
| syn | 38 | 37/38 · gürültü 2.45 | 37/38 · gürültü 2.53 | 37/38 · gürültü 2.47 |
| typo | 38 | 38/38 · gürültü 2.05 | 38/38 · gürültü 1.87 | 38/38 · gürültü 1.92 |
| morph | 38 | 38/38 · gürültü 2.55 | 38/38 · gürültü 2.66 | 38/38 · gürültü 2.68 |
| en | 38 | 38/38 · gürültü 1.87 | 38/38 · gürültü 1.87 | 38/38 · gürültü 2.58 |
| guide | 3 | 3/3 · gürültü 2.67 | 3/3 · gürültü 2.67 | 3/3 · gürültü 2.67 |

Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## n=300 konu kalemi (toplam 336 kalem, 193 soru)

| Yapılandırma | havuz | hit@1 | hit@3 | inPrompt (METİN) | inPrompt (kimlik) | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |
|---|---|---|---|---|---|---|---|---|---|---|---|
| legacy (en yeni 30 + 24k) | 30 | — | — | **60%** | 60% | 29.2 | 2925 | — | — | — | — |
| hibrit bm25 (n-gram KAPALI) | 336 | 96% | 96% | **100%** | 100% | 2.5 | 1172 | 47.4 | 2.3 | 4.9 | 0 |
| hibrit n-gram AÇIK (her sorguda) | 336 | 96% | 97% | **100%** | 100% | 2.8 | 1266 | 47.4 | 2.9 | 5.3 | 0 |
| hibrit RRF (bm25+ngram) | 336 | 94% | 95% | **99%** | 99% | 3.8 | 1445 | 52.9 | 3 | 6 | 0 |
| hibrit VARSAYILAN (n-gram auto=TR, CombSUM) | 336 | 96% | 97% | **100%** | 100% | 2.6 | 1192 | 54.7 | 2.7 | 5.9 | 0 |
| hibrit CANLI (varsayılan + kb-fetch tavanı 200) | 200 | 96% | 97% | **100%** | 100% | 2.9 | 939 | 24.7 | 2 | 4.2 | 0 |

N-gram AYRI ÖLÇÜM — soru türüne göre inPrompt(metin) / ortalama gürültü:

| Soru türü | n | n-gram KAPALI | n-gram auto (VARSAYILAN) | n-gram AÇIK |
|---|---|---|---|---|
| tr | 38 | 38/38 · gürültü 2.24 | 38/38 · gürültü 2.50 | 38/38 · gürültü 2.50 |
| syn | 38 | 38/38 · gürültü 2.84 | 38/38 · gürültü 2.95 | 38/38 · gürültü 2.95 |
| typo | 38 | 38/38 · gürültü 2.26 | 38/38 · gürültü 2.34 | 38/38 · gürültü 2.45 |
| morph | 38 | 38/38 · gürültü 2.45 | 38/38 · gürültü 2.34 | 38/38 · gürültü 2.34 |
| en | 38 | 38/38 · gürültü 2.39 | 38/38 · gürültü 2.39 | 38/38 · gürültü 3.32 |
| guide | 3 | 3/3 · gürültü 5.67 | 3/3 · gürültü 5.67 | 3/3 · gürültü 5.67 |

Güncelleme sonrası yeni metin: 10/10 · Silme sonrası geri gelmeme: 10/10

## Okuma kılavuzu
- Legacy sıralama soruya bakmaz; hit@k anlamsızdır ('—'). inPrompt = en yeni 30 kalem + 24k bütçe içinde doğru kaynak var mı.
- **CANLI satırı gerçek akıştır:** 300 konu kalemi (336 kalem) canlı tavanın (200) üstündedir; tavan dışındaki kalemin cevabı bloğa GİREMEZ ve bu kayıp burada dürüstçe görünür.
  300 kalem ürün plan tavanının (60/mülk) çok üstündedir; canlıda hiçbir mülk tavana çarpmaz — ama ölçüm canlı yolu ölçer, idealize etmez.
- n-gram kaynağı ANLAMSAL DEĞİLDİR (karakter 3-gram yazım benzerliği). Ayrı ölçüm (09-10): yazım hatasında katkı yok (OSA fuzzy zaten var); ek varyasyonunda 09-09'daki gürültü düşüşü
  kök sökücü kaçağının telafisiydi, kök düzelince auto ≈ kapalı (isabet eşit; gürültü eşit ya da az); İngilizce sorguda AÇIK olmak Türkçe metne düşen gramlarla bloğu büyütür →
  varsayılan **auto** (yalnız Türkçe algılanan sorguda) KORUNDU, ölçülen katkı ≈0 — 'kapalı'ya çekme kararı kurucunun. Gömme tabanlı kaynak: sözleşme hazır, ücretli servis onayı bekler; ÜRETİMDE YOK.
