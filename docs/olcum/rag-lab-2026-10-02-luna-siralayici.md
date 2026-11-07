# RAG lab — aşama bazlı kayıp (2026-10-02)

- commit: 112e514
- ortam gömmesi (yapılandırma başka model demiyorsa): text-embedding-3-small
- model: gpt-5.1
- small eşiği (T_PROD): 0.4
- okuma tavanı: 400
- yeniden sıralayıcı sabitleri: ilk 60 · kırpma 600
- yapılandırma live (çözülmüş): gömme text-embedding-3-small @ eşik 0.4 · anlama AÇIK · geçmiş yalnız geçmişli satırda (eski ölçer) · sıralayıcı ilk 60 TEK çağrı · kırpma 600 · tavan 2500 ms · okuma 400 · blok varsayılan kr / varsayılan parça
- yapılandırma live+rrm:gpt-6-luna+rre:none (çözülmüş): gömme text-embedding-3-small @ eşik 0.4 · anlama AÇIK · geçmiş yalnız geçmişli satırda (eski ölçer) · sıralayıcı ilk 60 TEK çağrı · kırpma 600 · tavan 2500 ms · model gpt-6-luna · çaba none · okuma 400 · blok varsayılan kr / varsayılan parça
- yapılandırma live+rrm:gpt-6-luna+rre:low (çözülmüş): gömme text-embedding-3-small @ eşik 0.4 · anlama AÇIK · geçmiş yalnız geçmişli satırda (eski ölçer) · sıralayıcı ilk 60 TEK çağrı · kırpma 600 · tavan 2500 ms · model gpt-6-luna · çaba low · okuma 400 · blok varsayılan kr / varsayılan parça
- yapılandırma prod+rrm:gpt-6-luna+rre:none (çözülmüş): gömme text-embedding-3-small @ eşik 0.4 · anlama AÇIK · geçmiş yalnız geçmişli satırda (eski ölçer) · sıralayıcı üretim penceresi soru başına çağrı · kırpma 600 · tavan 2500 ms · model gpt-6-luna · çaba none · okuma 400 · blok varsayılan kr / varsayılan parça
- ücretli gruplar: single_tr,single_xx,multi,neg
- önbellek: /tmp/lixus-rag-lab-cache
- çağrılar: {"embedCalls":216,"embedTextsSent":372,"llm":{"understand":{"hits":2384,"calls":0},"rerank":{"hits":11,"calls":2363}}}
- durum: tamam

Ölçü: blokta = cevap cümlesi istem bloğunda (iki sorulu mesajda İKİ cevap da). Aşama sütunları KAÇAN CEVAP sayısıdır:
okuma = okuma tavanı/onay süzgeci · parça = iğne parça sınırında bölünmüş · geri = geri çekilme (legacy kümesi) ·
eşik = aday listesinde yok, kosinüs eşik altı (ya da anlamsal yok) · aday-diğer = eşik üstü ama aday değil · pencere =
aday listesinde ama yeniden sıralayıcının ilk K'sının dışında · bütçe(rr) = pencerede, yeniden sıralamadan sonra bütçeye
girmedi · bütçe = aday listesinde, bütçeye girmedi (yeniden sıralayıcı yok) · kırpma = pencerede ama kırpılmış metin iğneyi
taşımıyor (bilgi). Negatif satırında blokta = — ; `neg parça` ortalama seçilen parça, `neg geri` geri çekilme sayısı.

| KB | boyut | yapılandırma | grup | n | blokta | okuma | parça | geri | eşik | aday-diğer | pencere | bütçe(rr) | pencerede (kuru) | bütçe | kırpma | neg parça | neg geri | sızıntı |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| perq-dev | 60 | live | multi | 120 | 110/120 (%92) | 0 | 0 | 0 | 6 | 0 | 0 | 4 | 0 | 0 | 0 |  |  | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:low | multi | 120 | 104/120 (%87) | 0 | 0 | 0 | 6 | 0 | 0 | 3 | 0 | 7 | 0 |  |  | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:none | multi | 120 | 107/120 (%89) | 0 | 0 | 0 | 6 | 0 | 0 | 7 | 0 | 0 | 0 |  |  | 0 |
| perq-dev | 60 | prod+rrm:gpt-6-luna+rre:none | multi | 120 | 107/120 (%89) | 0 | 0 | 0 | 6 | 0 | 2 | 5 | 0 | 0 | 0 |  |  | 0 |
| perq-dev | 60 | live | neg | 34 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10.8 | 5 | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:low | neg | 34 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10.8 | 5 | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:none | neg | 34 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10.8 | 5 | 0 |
| perq-dev | 60 | prod+rrm:gpt-6-luna+rre:none | neg | 34 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10.8 | 5 | 0 |
| perq-dev | 60 | live | single_tr | 221 | 215/221 (%97) | 0 | 0 | 0 | 5 | 0 | 0 | 1 | 0 | 0 | 3 |  |  | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:low | single_tr | 221 | 212/221 (%96) | 0 | 0 | 0 | 5 | 0 | 0 | 1 | 0 | 3 | 3 |  |  | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:none | single_tr | 221 | 214/221 (%97) | 0 | 0 | 0 | 5 | 0 | 0 | 2 | 0 | 0 | 3 |  |  | 0 |
| perq-dev | 60 | prod+rrm:gpt-6-luna+rre:none | single_tr | 221 | 213/221 (%96) | 0 | 0 | 0 | 5 | 0 | 1 | 2 | 0 | 0 | 3 |  |  | 0 |
| perq-dev | 60 | live | single_xx | 221 | 217/221 (%98) | 0 | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 0 | 3 |  |  | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:low | single_xx | 221 | 217/221 (%98) | 0 | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 0 | 3 |  |  | 0 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:none | single_xx | 221 | 217/221 (%98) | 0 | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 0 | 3 |  |  | 0 |
| perq-dev | 60 | prod+rrm:gpt-6-luna+rre:none | single_xx | 221 | 216/221 (%98) | 0 | 0 | 2 | 1 | 0 | 0 | 2 | 0 | 0 | 3 |  |  | 0 |

Yeniden sıralayıcı gecikmesi (ms, kaydı olan çağrılar) ve boyları. `blok / KB` = blok karakteri / bilgi tabanı karakteri
(ortanca, %; A9 #8): %90'a yaklaşan yapılandırmada bilgi tabanının neredeyse TAMAMI gidiyor — "blokta" oranı orada getirme
başarısı değil, bütçenin bilgi tabanından büyük olmasıdır (soru başına 60 kalem + geniş bütçe).

| KB | boyut | yapılandırma | çağrı (süreli) | başarısız / tavan aşımı | p50 | p95 | istek ort. karakter | blok ort. karakter | blok / KB |
|---|---|---|---|---|---|---|---|---|---|
| perq-dev | 60 | live | 560 | 3 | 857 | 1266 | 8581 | 3703 | %22 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:low | 560 | 66 | 1127 | 3180 | 8581 | 3700 | %22 |
| perq-dev | 60 | live+rrm:gpt-6-luna+rre:none | 560 | 0 | 941 | 1352 | 8581 | 3705 | %22 |
| perq-dev | 60 | prod+rrm:gpt-6-luna+rre:none | 560 | 1 | 1013 | 1426 | 8243 | 3708 | %22 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `112e514`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | — |
| Üslup özeti | `gpt-5.1` | — |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `990d40f68cf2` · anlama `e0b06a18027f` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
