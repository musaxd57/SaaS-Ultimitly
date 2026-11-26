# Acil numara — hata nedeni analizi (gpt-6-luna)


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `def4526`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-6-luna` | low |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `f68615f7bc1b` (öğe + yabancı dil örneği `b3b1f227a75a`) · anlama `00b769433021` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


Kaynak koşu: `acil-numara-2026-10-11-gpt-6-luna-mv3u05l3.json`. Ölçüm kuralı: şikâyet / iade / insan talebi niyetinden biri → hold, aksi → give.

Vaka: 3 · toplam model çağrısı: 31. Modelin açıklaması İPUCUDUR (sonradan kurulan gerekçe); karşı deneme KANITTIR
(ifade çıkarılıp aynı katman yeniden koşuldu; BÜTÜN tekrarlarda düzelten ifade tetikleyicidir, bir kısmında düzelten kısmi etkidir).

## h1

- Mesaj: "Ev sahibi depozitomu vermiyor, polisi arayacağım. Numara ne?"
- Beklenen: hold · Gözlenen: [emergency] → give
- Özgün mesaj yeniden: 2/2 doğru ([cancellation_refund, emergency] → hold | [complaint_issue, emergency] → hold)
- **Kanıt: KARARSIZ — özgün mesaj yeniden koşunca çoğunlukla doğru; hata tekrar farkı (ifade çıkarma burada kanıt değildir)**
- **Önerilen düzeltme katmanı: MODEL SINIRI — kural var, tek ifade suçlu değil; çoğunluk oyu / daha yüksek çaba / başka model ölçülmeli**
- Modelin açıklaması: “Polisi arayacağım” ifadesini acil durum olarak yorumladım. Ancak mesajın asıl bağlamı depozitonun iade edilmemesiyle ilgili bir ev sahibi şikâyeti; ayrıca misafir bir numara soruyor.
- Modelin "beni etkiledi" dediği: "Ev sahibi depozitomu vermiyor", "polisi arayacağım", "Numara ne?"
- Şimdi verirdiği: complaint_issue (gerekirse insan desteğine yönlendirme)
- Talimatlarda kural: YOK · test beklentisine: katılıyor · eksik bilgi: yok
- Modelin iddiası karşı denemede: "Ev sahibi depozitomu vermiyor" → doğrulanmadı · "polisi arayacağım" → DOĞRULANDI · "Numara ne?" → DOĞRULANDI

| çıkarılan ifade | tür | doğru | çıktılar |
|---|---|---|---|
| "Ev sahibi depozitomu vermiyor" | modelin andığı | 0/2 | [emergency] → give \| [emergency] → give |
| "polisi arayacağım" | modelin andığı | 2/2 | [cancellation_refund, human_request] → hold \| [complaint_issue, human_request] → hold |
| "Numara ne?" | modelin andığı | 2/2 | [complaint_issue] → hold \| [complaint_issue] → hold |

## h4

- Mesaj: "Kapı kodu çalışmıyor, 2 saattir dışarıdayız. Polisi arayacağız, numara ne?"
- Beklenen: hold · Gözlenen: [access_keys, emergency] → give
- Özgün mesaj yeniden: 0/2 doğru ([access_keys, emergency] → give | [access_keys, emergency] → give)
- **Kanıt: TETİKLEYİCİ İFADE — aşağıdaki ifade çıkınca hata BÜTÜN tekrarlarda düzeliyor**: "Polisi arayacağız"
- Kısmi etki (tekrarların bir kısmında düzeldi): "Kapı kodu çalışmıyor", "2 saattir dışarıdayız"
- **Önerilen düzeltme katmanı: İSTEM — talimatlar bu durumu kapsamıyor ya da belirsiz; açık bir kural / örnek eklenmeli**
- Modelin açıklaması: Kapı kodunun çalışmamasını erişim sorunu (access_keys), polis ve numara ifadesini acil durum (emergency) olarak yorumladım. Mesajın ev sahibine acil olarak aktarılması gerektiğini ayrıca etiketlemedim.
- Modelin "beni etkiledi" dediği: "Kapı kodu çalışmıyor", "2 saattir dışarıdayız", "Polisi arayacağız, numara ne?"
- Şimdi verirdiği: access_keys ve human_request
- Talimatlarda kural: YOK · test beklentisine: katılıyor · eksik bilgi: yok
- Modelin iddiası karşı denemede: "Kapı kodu çalışmıyor" → kısmen · "2 saattir dışarıdayız" → kısmen · "Polisi arayacağız, numara ne?" → doğrulanmadı

| çıkarılan ifade | tür | doğru | çıktılar |
|---|---|---|---|
| "Kapı kodu çalışmıyor" | modelin andığı | 1/2 | [emergency] → give \| [complaint_issue, emergency] → hold |
| "2 saattir dışarıdayız" | modelin andığı | 1/2 | [complaint_issue, emergency] → hold \| [access_keys, emergency] → give |
| "Polisi arayacağız, numara ne?" | modelin andığı | 0/2 | [access_keys] → give \| [access_keys] → give |
| "Polisi arayacağız" | cümle | 2/2 | [access_keys, complaint_issue] → hold \| [access_keys, complaint_issue] → hold |
| "numara ne" | cümle | 0/2 | [access_keys] → give \| [access_keys] → give |

## h12

- Mesaj: "Ev sahibi rezervasyonumu son anda iptal etti, polise gideceğim. Numara?"
- Beklenen: hold · Gözlenen: [emergency] → give
- Özgün mesaj yeniden: 2/2 doğru ([complaint_issue] → hold | [complaint_issue, other] → hold)
- **Kanıt: KARARSIZ — özgün mesaj yeniden koşunca çoğunlukla doğru; hata tekrar farkı (ifade çıkarma burada kanıt değildir)**
- **Önerilen düzeltme katmanı: MODEL SINIRI — kural var, tek ifade suçlu değil; çoğunluk oyu / daha yüksek çaba / başka model ölçülmeli**
- Modelin açıklaması: “Polise gideceğim” ve “Numara?” ifadesini acil durum ya da polis numarası talebi gibi yorumlayıp emergency etiketini verdim. Ancak mesajın açık bağlamı ev sahibinin son anda iptaliyle ilgili bir şikâyet.
- Modelin "beni etkiledi" dediği: "Ev sahibi rezervasyonumu son anda iptal etti", "polise gideceğim", "Numara?"
- Şimdi verirdiği: complaint_issue
- Talimatlarda kural: belirsiz · test beklentisine: katılıyor · eksik bilgi: VAR
- Modelin iddiası karşı denemede: "Ev sahibi rezervasyonumu son anda iptal etti" → doğrulanmadı · "polise gideceğim" → DOĞRULANDI · "Numara?" → DOĞRULANDI

| çıkarılan ifade | tür | doğru | çıktılar |
|---|---|---|---|
| "Ev sahibi rezervasyonumu son anda iptal etti" | modelin andığı | 0/2 | [emergency] → give \| [emergency] → give |
| "polise gideceğim" | modelin andığı | 2/2 | [complaint_issue, human_request] → hold \| [complaint_issue, human_request] → hold |
| "Numara?" | modelin andığı | 2/2 | [complaint_issue] → hold \| [complaint_issue] → hold |

## Doğrulama (4. adım)

- Düzeltmeden sonra bu vakalar AYNI ayarla yeniden ölçülür (her biri tekrarların çoğunda doğru olmalı).
- Kör set (görülmemiş sorular) yeniden ölçülür — düzeltme yalnız görülen sorulara uymuş olmasın.
- Misafire giden metni değiştiren düzeltme kurucuya önce / sonra örneğiyle sorulur; kod kuralı kırmızı-önce + mutasyonla pinlenir.

