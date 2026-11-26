# Acil numara — hata nedeni analizi (gpt-6-luna)


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `3cd6e28`

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

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=1` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=1` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=0`

İstem kimliği (SHA-256 ilk 12): cevap `fb2e7678bd79` (öğe + yabancı dil örneği `7146c50f9004`) · anlama `f7b021ad9ffc` (kip: items+rules+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.


Kaynak koşu: `acil-numara-2026-10-11-gpt-6-luna-mv44y3ts.json`. Ölçüm kuralı: şikâyet / iade / insan talebi niyetinden biri → hold, aksi → give.

Vaka: 2 · toplam model çağrısı: 22. Modelin açıklaması İPUCUDUR (sonradan kurulan gerekçe); karşı deneme KANITTIR
(ifade çıkarılıp aynı katman yeniden koşuldu; BÜTÜN tekrarlarda düzelten ifade tetikleyicidir, bir kısmında düzelten kısmi etkidir).

## g5

- Mesaj: "Arabamızın camı kırılmış, çantamız çalınmış. Polisin numarası ne?"
- Beklenen: give · Gözlenen: [complaint_issue] → hold
- Özgün mesaj yeniden: 1/2 doğru ([emergency] → give | [complaint_issue] → hold)
- **Kanıt: KARARSIZ — özgün mesaj yeniden koşunca çoğunlukla doğru; hata tekrar farkı (ifade çıkarma burada kanıt değildir)**
- **Önerilen düzeltme katmanı: MODEL SINIRI — kural var, tek ifade suçlu değil; çoğunluk oyu / daha yüksek çaba / başka model ölçülmeli**
- Modelin açıklaması: Olayı bir şikâyet olarak değerlendirip complaint_issue etiketi verdim. Ancak istenen numara polisin numarası; ev sahibine ulaşma, iade veya konaklamayla ilgili bir sorun talebi değil.
- Modelin "beni etkiledi" dediği: "Arabamızın camı kırılmış, çantamız çalınmış.", "Polisin numarası ne?"
- Şimdi verirdiği: other
- Talimatlarda kural: YOK · test beklentisine: katılıyor · eksik bilgi: yok
- Modelin iddiası karşı denemede: "Arabamızın camı kırılmış, çantamız çalınmış." → DOĞRULANDI · "Polisin numarası ne?" → doğrulanmadı

| çıkarılan ifade | tür | doğru | çıktılar |
|---|---|---|---|
| "Arabamızın camı kırılmış, çantamız çalınmış." | modelin andığı | 2/2 | [emergency] → give \| [emergency] → give |
| "Polisin numarası ne?" | modelin andığı | 0/2 | [complaint_issue] → hold \| [complaint_issue] → hold |
| "Arabamızın camı kırılmış" | cümle | 0/2 | [complaint_issue] → hold \| [complaint_issue] → hold |
| "çantamız çalınmış" | cümle | 1/2 | [emergency] → give \| [complaint_issue] → hold |

## g11

- Mesaj: "Someone broke into our car. How do I contact the police, what's the number?"
- Beklenen: give · Gözlenen: [complaint_issue] → hold
- Özgün mesaj yeniden: 2/2 doğru ([emergency] → give | [emergency] → give)
- **Kanıt: KARARSIZ — özgün mesaj yeniden koşunca çoğunlukla doğru; hata tekrar farkı (ifade çıkarma burada kanıt değildir)**
- **Önerilen düzeltme katmanı: MODEL SINIRI — kural var, tek ifade suçlu değil; çoğunluk oyu / daha yüksek çaba / başka model ölçülmeli**
- Modelin açıklaması: İlk cümleyi genel bir şikâyet olarak yorumlayıp complaint_issue verdim; ancak mesaj ev sahibiyle ilgili bir şikâyet değil. Misafir polise nasıl ulaşacağını ve numarayı soruyor.
- Modelin "beni etkiledi" dediği: "Someone broke into our car.", "How do I contact the police, what's the number?"
- Şimdi verirdiği: Polisle iletişim / acil durum iletişim bilgisi talebi; complaint_issue, cancellation_refund veya human_request değil.
- Talimatlarda kural: belirsiz · test beklentisine: katılıyor · eksik bilgi: VAR
- Modelin iddiası karşı denemede: "Someone broke into our car." → DOĞRULANDI · "How do I contact the police, what's the number?" → doğrulanmadı

| çıkarılan ifade | tür | doğru | çıktılar |
|---|---|---|---|
| "Someone broke into our car." | modelin andığı | 2/2 | [emergency] → give \| [emergency] → give |
| "How do I contact the police, what's the number?" | modelin andığı | 0/2 | [complaint_issue] → hold \| [complaint_issue] → hold |
| "How do I contact the police" | cümle | 0/2 | [complaint_issue] → hold \| [complaint_issue] → hold |
| "what's the number" | cümle | 2/2 | [emergency] → give \| [emergency] → give |

## Doğrulama (4. adım)

- Düzeltmeden sonra bu vakalar AYNI ayarla yeniden ölçülür (her biri tekrarların çoğunda doğru olmalı).
- Kör set (görülmemiş sorular) yeniden ölçülür — düzeltme yalnız görülen sorulara uymuş olmasın.
- Misafire giden metni değiştiren düzeltme kurucuya önce / sonra örneğiyle sorulur; kod kuralı kırmızı-önce + mutasyonla pinlenir.

