# Retrieval baseline — legacy vs hibrit (2026-09-09, commit 94a842e + çalışma ağacı (rapor kodla aynı commit'e girer; hash ebeveyndir))

> Model YOK, DB YOK. Ölçülen: modele giden bilgi bloğunda ilgili cümle var mı (isabet), blok karakteri (maliyet vekili),
> ilgisiz kalem sayısı (gürültü), seçim süresi (ms). Legacy = `kb-fetch` (en yeni 30) + `packKnowledgeBase` (24k) aynası;
> hibrit = `selectKbForPrompt` (bayrak `KB_RETRIEVAL_MODE=hybrid`, varsayılan KAPALI). Bu rapor modelin CEVABINI ölçmez;
> gerçek model eval'ini kurucu koşar (`docs/EVAL-CALISTIRMA.md`). Üretici: `tests/unit/kb-retrieval-baseline.test.ts`.

| Senaryo | Sınıf | Legacy isabet | Hibrit isabet | Legacy kar. | Hibrit kar. | Legacy gürültü | Hibrit gürültü | Hibrit ms | Geri çekilme |
|---|---|---|---|---|---|---|---|---|---|
| long_middle_oldest | uzun metin ortası (kalem en eski) | ❌ | ✅ | 3941 | 879 | 30 | 1 | 31.6 | none |
| long_middle_newest | uzun metin ortası (kalem en yeni) | ✅ | ✅ | 7842 | 879 | 20 | 1 | 15.5 | none |
| synonym_tr | Türkçe eşanlam | ✅ | ✅ | 2911 | 408 | 20 | 1 | 6.6 | none |
| synonym_en | İngilizce soru / Türkçe kalem | ✅ | ✅ | 2893 | 390 | 20 | 1 | 6.7 | none |
| wrong_category | yanlış kategori | ✅ | ✅ | 2934 | 431 | 20 | 1 | 9.4 | none |
| multi_question | çok soru | ✅ | ✅ | 2941 | 438 | 20 | 1 | 7 | none |
| source_conflict | kaynak çelişkisi | ✅ | ✅ | 2970 | 318 | 20 | 0 | 5.6 | none |
| malicious_source | kaynakta kötü niyetli talimat | ✅ | ✅ | 2996 | 374 | 21 | 1 | 5.4 | none |
| typo | yazım hatası | ✅ | ✅ | 2877 | 225 | 20 | 0 | 8.1 | none |
| context_carry | konuşma bağlamı (ince soru) | ✅ | ✅ | 2909 | 510 | 20 | 2 | 5.3 | none |
| uppercase_tr | büyük harf Türkçe | ✅ | ✅ | 2877 | 374 | 20 | 1 | 5 | none |
| greeting_only | selamlaşma (geri çekilme) | — | — | 2825 | 2825 | 0 | 0 | 3.7 | empty_query |
| no_hits | isabet yok (geri çekilme) | — | — | 2825 | 2825 | 0 | 0 | 4.1 | no_lexical_hits |

## Notlar
- **long_middle_oldest:** 35 kalem > KB_ITEM_CAP 30: legacy en yeni 30'u alır, rehber düşer.
- **source_conflict:** Retrieval çelişkiyi GİZLEMEZ: aynı kategoride saat taşıyan her parça gider (P4 iki kaynağı görür).
- **malicious_source:** Retrieval politika DEĞİLDİR: kalem sözcüksel olarak eşleşirse yine seçilir. Buradaki kazanım maruziyet AZALMASI; asıl koruma sır elemesi + injection vetosu (değişmedi).
- **greeting_only:** Beklenen: hibrit == legacy (empty_query).
- **no_hits:** Beklenen: hibrit == legacy (no_lexical_hits) — model dürüst 'bilgi yok' diyebilsin (E1).
- **malicious_source:** legacy'de kötü niyetli kalem modele GİDER (sızıntı ölçümü ✅ legacy / ❌ hibrit); bu bir maruziyet farkıdır, politika değil.

## Okuma kılavuzu
- İsabet '—' = senaryonun ilgili cümlesi yok (geri çekilme sınıfı); orada beklenen, hibrit bloğun legacy ile AYNI olmasıdır.
- Karakter farkı, istem maliyetinin vekilidir (token sayısı ölçülmedi; tahmin YAZILMADI).
- Gürültü = blokta yer alan ilgisiz kalem başlığı sayısı.
