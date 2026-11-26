# Konaklama değişikliği anlam katmanı — eval (2026-10-02)

Durum: **GEÇERLİ** · veri sürümü 1 · istek 160 · cevap 200
Anlama: `gpt-6-luna` · reasoning_effort: low · Bekçi: `gpt-6-luna` · reasoning_effort: low · anlama kipi: items+rules+cfu

Set: `evals/stay-change-acc10.json` (bölümler: acc10) — `dev2` geliştirme setidir (okundu); `acc10` kör kabul setidir (koşudan önce okunmadı; bu koşuyla GÖRÜLDÜ sayılır). Cevap satırlarında bekçi taslağın kendi misafir mesajını görür (`guest` alanı).

## Deterministik yedek (kelime ağı)

| bölüm · sınıf | doğru |
|---|---|
| acc10|claim | 17/40 (43%) |
| acc10|deferral | 21/30 (70%) |
| acc10|grant | 4/60 (7%) |
| acc10|istek(doğru=var) | 37/88 (42%) |
| acc10|neutral | 49/50 (98%) |
| acc10|none(doğru=yok) | 55/72 (76%) |
| acc10|offer | 7/10 (70%) |
| acc10|refusal | 10/10 (100%) |

## Bekçi — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| acc10|istek|ar | 6/6 (100%) |
| acc10|istek|de | 7/7 (100%) |
| acc10|istek|en | 22/22 (100%) |
| acc10|istek|es | 6/6 (100%) |
| acc10|istek|fr | 6/6 (100%) |
| acc10|istek|ru | 6/6 (100%) |
| acc10|istek|tr | 35/35 (100%) |
| acc10|none|ar | 5/5 (100%) |
| acc10|none|de | 5/5 (100%) |
| acc10|none|en | 18/18 (100%) |
| acc10|none|es | 5/5 (100%) |
| acc10|none|fr | 5/5 (100%) |
| acc10|none|ru | 5/5 (100%) |
| acc10|none|tr | 29/29 (100%) |

## Anlama katmanı — misafir isteği (+ KODDA saat kıyası)

| bölüm · sınıf · dil | doğru |
|---|---|
| acc10|istek|ar | 6/6 (100%) |
| acc10|istek|de | 7/7 (100%) |
| acc10|istek|en | 22/22 (100%) |
| acc10|istek|es | 6/6 (100%) |
| acc10|istek|fr | 6/6 (100%) |
| acc10|istek|ru | 6/6 (100%) |
| acc10|istek|tr | 35/35 (100%) |
| acc10|none|ar | 5/5 (100%) |
| acc10|none|de | 5/5 (100%) |
| acc10|none|en | 17/18 (94%) |
| acc10|none|es | 5/5 (100%) |
| acc10|none|fr | 5/5 (100%) |
| acc10|none|ru | 5/5 (100%) |
| acc10|none|tr | 28/29 (97%) |

## BİRLEŞİM — kelime ağı ∨ bekçi ∨ anlama (ürünün tutuşu)

| bölüm · sınıf · dil | doğru |
|---|---|
| acc10|istek (doğru = tutuldu) | 88/88 (100%) |
| acc10|none (doğru = gitti; yanlış = GEREKSİZ İNCELEME) | 54/72 (75%) |

`none` satırında yanlış kalan pay = gereksiz insan incelemesi (kurucu: özellikle bakılacak oran). ALT SINIRDIR:
cevap modelinin beyanı ve konu etiketi (`ri`) bu harness'ta koşmaz; canlıda `sc` kanıtıyla ayrıca ölçülür
(`docs/ANLAM-KATMANI-2026-09-24.md` §2.2).

## Bekçi — cevap duruşu (claim/grant durmalı; erteleme/teklif/tarafsız gitmeli)

| bölüm · sınıf · dil | doğru |
|---|---|
| acc10|claim|ar | 3/3 (100%) |
| acc10|claim|de | 3/3 (100%) |
| acc10|claim|en | 10/10 (100%) |
| acc10|claim|es | 3/3 (100%) |
| acc10|claim|fr | 3/3 (100%) |
| acc10|claim|ru | 2/2 (100%) |
| acc10|claim|tr | 16/16 (100%) |
| acc10|deferral|ar | 2/2 (100%) |
| acc10|deferral|de | 2/2 (100%) |
| acc10|deferral|en | 8/8 (100%) |
| acc10|deferral|es | 2/2 (100%) |
| acc10|deferral|fr | 2/2 (100%) |
| acc10|deferral|ru | 2/2 (100%) |
| acc10|deferral|tr | 12/12 (100%) |
| acc10|grant|ar | 4/4 (100%) |
| acc10|grant|de | 4/4 (100%) |
| acc10|grant|en | 15/15 (100%) |
| acc10|grant|es | 4/4 (100%) |
| acc10|grant|fr | 4/4 (100%) |
| acc10|grant|ru | 5/5 (100%) |
| acc10|grant|tr | 24/24 (100%) |
| acc10|neutral|ar | 4/4 (100%) |
| acc10|neutral|de | 3/3 (100%) |
| acc10|neutral|en | 12/12 (100%) |
| acc10|neutral|es | 4/4 (100%) |
| acc10|neutral|fr | 4/4 (100%) |
| acc10|neutral|ru | 3/3 (100%) |
| acc10|neutral|tr | 20/20 (100%) |
| acc10|offer|de | 1/1 (100%) |
| acc10|offer|en | 3/3 (100%) |
| acc10|offer|es | 1/1 (100%) |
| acc10|offer|ru | 1/1 (100%) |
| acc10|offer|tr | 4/4 (100%) |
| acc10|refusal|ar | 1/1 (100%) |
| acc10|refusal|de | 1/1 (100%) |
| acc10|refusal|en | 2/2 (100%) |
| acc10|refusal|fr | 1/1 (100%) |
| acc10|refusal|ru | 1/1 (100%) |
| acc10|refusal|tr | 4/4 (100%) |

## Karar ölçüleri — acc10 (cevap modeli beyanı / konu etiketi hariç: alt sınır)

| ölçü | değer |
|---|---|
| Tehlikeli kaçak (istek → tutulmadı) | 0/88 (0%) |
| Gereksiz inceleme (istek yok → tutuldu) | 18/72 (25%) |
| Bilgi sorusu (erken giriş konulu, istek yok) → incelemeye düştü | 3/3 (100%) |
| Bilgi sorusu → politika metnine uygun (cevap modeli hariç, alt sınır) | 1/3 (33%) |
| Bilinmiyor (model düştü; satır sayılmadı) | bekçi 0 · anlama 0 · satır 0 |
| Yalnız TEK katmanın yakaladığı istek | kelime ağı 0 · bekçi 0 · anlama 0 |

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `42b0398`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-6-luna` | low |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-6-luna` | low |
| Çeviri | `gpt-5.1` | — |
| Üslup özeti | `gpt-5.1` | — |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`

İstem kimliği (SHA-256 ilk 12): cevap `f756008250f0` · anlama `f7b021ad9ffc` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
