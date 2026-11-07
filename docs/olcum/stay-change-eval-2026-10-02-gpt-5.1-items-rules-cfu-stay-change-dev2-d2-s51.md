# Konaklama değişikliği anlam katmanı — eval (2026-10-02)

Durum: **GEÇERLİ** · veri sürümü 1 · istek 153 · cevap 180
Anlama: `gpt-5.1` · reasoning_effort: model varsayılanı · Bekçi: `gpt-5.1` · reasoning_effort: model varsayılanı · anlama kipi: items+rules+cfu

Set: `evals/stay-change-dev2.json` (bölümler: dev2) — `dev2` geliştirme setidir (okundu); `acc10` kör kabul setidir (koşudan önce okunmadı; bu koşuyla GÖRÜLDÜ sayılır). Cevap satırlarında bekçi taslağın kendi misafir mesajını görür (`guest` alanı).

## Deterministik yedek (kelime ağı)

| bölüm · sınıf | doğru |
|---|---|
| dev2|claim | 13/36 (36%) |
| dev2|deferral | 17/27 (63%) |
| dev2|grant | 6/54 (11%) |
| dev2|istek(doğru=var) | 33/86 (38%) |
| dev2|neutral | 44/45 (98%) |
| dev2|none(doğru=yok) | 52/67 (78%) |
| dev2|offer | 9/9 (100%) |
| dev2|refusal | 9/9 (100%) |

## Bekçi — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev2|istek|ar | 5/6 (83%) |
| dev2|istek|de | 5/6 (83%) |
| dev2|istek|en | 22/23 (96%) |
| dev2|istek|es | 6/6 (100%) |
| dev2|istek|fr | 6/6 (100%) |
| dev2|istek|ru | 6/6 (100%) |
| dev2|istek|tr | 33/33 (100%) |
| dev2|none|ar | 5/5 (100%) |
| dev2|none|de | 4/4 (100%) |
| dev2|none|en | 16/17 (94%) |
| dev2|none|es | 5/5 (100%) |
| dev2|none|fr | 5/5 (100%) |
| dev2|none|ru | 4/4 (100%) |
| dev2|none|tr | 23/27 (85%) |

## Anlama katmanı — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev2|istek|ar | 5/6 (83%) |
| dev2|istek|de | 5/6 (83%) |
| dev2|istek|en | 20/23 (87%) |
| dev2|istek|es | 6/6 (100%) |
| dev2|istek|fr | 5/6 (83%) |
| dev2|istek|ru | 6/6 (100%) |
| dev2|istek|tr | 30/33 (91%) |
| dev2|none|ar | 5/5 (100%) |
| dev2|none|de | 4/4 (100%) |
| dev2|none|en | 16/17 (94%) |
| dev2|none|es | 5/5 (100%) |
| dev2|none|fr | 5/5 (100%) |
| dev2|none|ru | 4/4 (100%) |
| dev2|none|tr | 23/27 (85%) |

## BİRLEŞİM — kelime ağı ∨ bekçi ∨ anlama (ürünün tutuşu)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev2|istek (doğru = tutuldu) | 83/86 (97%) |
| dev2|none (doğru = gitti; yanlış = GEREKSİZ İNCELEME) | 48/67 (72%) |

`none` satırında yanlış kalan pay = gereksiz insan incelemesi (kurucu: özellikle bakılacak oran). ALT SINIRDIR:
cevap modelinin beyanı ve konu etiketi (`ri`) bu harness'ta koşmaz; canlıda `sc` kanıtıyla ayrıca ölçülür
(`docs/ANLAM-KATMANI-2026-09-24.md` §2.2).

## Bekçi — cevap duruşu (claim/grant durmalı; erteleme/teklif/tarafsız gitmeli)

| bölüm · sınıf · dil | doğru |
|---|---|
| dev2|claim|ar | 2/2 (100%) |
| dev2|claim|de | 3/3 (100%) |
| dev2|claim|en | 9/9 (100%) |
| dev2|claim|es | 3/3 (100%) |
| dev2|claim|fr | 2/2 (100%) |
| dev2|claim|ru | 3/3 (100%) |
| dev2|claim|tr | 14/14 (100%) |
| dev2|deferral|ar | 1/1 (100%) |
| dev2|deferral|de | 2/2 (100%) |
| dev2|deferral|en | 7/7 (100%) |
| dev2|deferral|es | 2/2 (100%) |
| dev2|deferral|fr | 2/2 (100%) |
| dev2|deferral|ru | 2/2 (100%) |
| dev2|deferral|tr | 11/11 (100%) |
| dev2|grant|ar | 4/4 (100%) |
| dev2|grant|de | 4/4 (100%) |
| dev2|grant|en | 12/13 (92%) |
| dev2|grant|es | 4/4 (100%) |
| dev2|grant|fr | 4/4 (100%) |
| dev2|grant|ru | 3/3 (100%) |
| dev2|grant|tr | 22/22 (100%) |
| dev2|neutral|ar | 4/4 (100%) |
| dev2|neutral|de | 3/3 (100%) |
| dev2|neutral|en | 9/11 (82%) |
| dev2|neutral|es | 3/3 (100%) |
| dev2|neutral|fr | 3/3 (100%) |
| dev2|neutral|ru | 3/3 (100%) |
| dev2|neutral|tr | 17/18 (94%) |
| dev2|offer|ar | 1/1 (100%) |
| dev2|offer|de | 1/1 (100%) |
| dev2|offer|en | 2/2 (100%) |
| dev2|offer|es | 1/1 (100%) |
| dev2|offer|tr | 4/4 (100%) |
| dev2|refusal|ar | 1/1 (100%) |
| dev2|refusal|en | 3/3 (100%) |
| dev2|refusal|fr | 1/1 (100%) |
| dev2|refusal|ru | 1/1 (100%) |
| dev2|refusal|tr | 3/3 (100%) |

## Karar ölçüleri — dev2 (cevap modeli beyanı / konu etiketi hariç: alt sınır)

| ölçü | değer |
|---|---|
| Tehlikeli kaçak (istek → tutulmadı) | 3/86 (3%) — early 3 |
| Gereksiz inceleme (istek yok → tutuldu) | 19/67 (28%) |
| Bilgi sorusu (erken giriş konulu, istek yok) → incelemeye düştü | 4/4 (100%) |
| Bilgi sorusu → politika metnine uygun (cevap modeli hariç, alt sınır) | 0/4 (0%) |
| Bilinmiyor (model düştü; satır sayılmadı) | bekçi 0 · anlama 0 · satır 0 |
| Yalnız TEK katmanın yakaladığı istek | kelime ağı 0 · bekçi 5 · anlama 0 |

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `f756008250f0` · anlama `7110591352fb` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
