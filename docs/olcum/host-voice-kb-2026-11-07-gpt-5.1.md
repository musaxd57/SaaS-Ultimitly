# Bilgi tabanındaki üçüncü şahıs → birinci kişi — ücretli A/B (2026-11-07, gpt-5.1)

Set: `evals/host-voice-kb-2026-11-07.json` · 26 senaryo × 2 örnek × 2 kol · istem kimliği kapalı `d409de06877e` / açık `10ed5c3b6d82`
Maliyet (yaklaşık): 0.68 USD · çağrı hatası: 0

| Küme · kol | Cevap | Üçüncü şahıs | Kapıdan geçti | Ev sahibi sesi kapısı tuttu | Olgu doğru | Geçti + olgu doğru | Dil doğru |
|---|---|---|---|---|---|---|---|
| üçüncü şahıs kalem · kapalı | 42 | 3/42 (7%) | 29/42 (69%) | 0/42 (0%) | 38/42 (90%) | 29/42 (69%) | 42/42 (100%) |
| üçüncü şahıs kalem · açık | 42 | 5/42 (12%) | 29/42 (69%) | 0/42 (0%) | 36/42 (86%) | 29/42 (69%) | 41/42 (98%) |
| kontrol (nötr kalem) · kapalı | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) |
| kontrol (nötr kalem) · açık | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) |

## Örnekler (örnek 0, iki kol yan yana)

- **contact-tr** (kb3p, tr) — "Size hangi saatlerde ulaşabilirim?"
  - kapalı: Merhaba, Bana her gün 09:00–22:00 saatleri arasında ulaşabilirsiniz. — kapı: geçti
  - açık: Merhaba, Bana her gün 09:00–22:00 saatleri arasında ulaşabilirsiniz. — kapı: geçti
- **contact-en** (kb3p, en) — "What hours can I reach you?"
  - kapalı: Hello, You can reach me every day between 09:00 and 22:00. — kapı: geçti
  - açık: Hello, You can reach me every day between 09:00 and 22:00. — kapı: geçti
- **contact-de** (kb3p, de) — "Zu welchen Zeiten kann ich Sie erreichen?"
  - kapalı: Hallo, Sie können mich jeden Tag zwischen 09:00 und 22:00 Uhr erreichen. — kapı: geçti
  - açık: Hallo, Sie können mich täglich zwischen 09:00 und 22:00 Uhr erreichen. — kapı: geçti
- **breakfast-tr** (kb3p, tr) — "Kahvaltı imkânı var mı?"
  - kapalı: Merhaba, Evet, kahvaltı imkânı var. Kişi başı 300 TL karşılığında kahvaltı hazırlayabiliyorum; sadece bir gün önceden haber vermeniz yeterli. — kapı: geçti
  - açık: Merhaba, Evet, kahvaltı imkânı var. Kişi başı 300 TL karşılığında kahvaltı hazırlıyorum; sadece bir gün önceden haber vermeniz yeterli. — kapı: geçti
- **breakfast-en** (kb3p, en) — "Is breakfast available?"
  - kapalı: Hello, Yes, breakfast is available. I can prepare it for 300 TL per person, and it needs to be requested at least one day in advance. — kapı: geçti
  - açık: Hello, Evet, kahvaltı mümkün. Kişi başı 300 TL karşılığında kahvaltı hazırlayabiliyorum; bir gün önceden haber vermeniz yeterli. — kapı: geçti
- **breakfast-ru** (kb3p, ru) — "Есть ли возможность заказать завтрак?"
  - kapalı: Здравствуйте! Да, такую возможность я предоставляю. Я могу приготовить завтрак по цене 300 TL с человека, при этом мне нужно узнать об этом как минимум за один день заранее. — kapı: geçti
  - açık: Здравствуйте! Да, такая возможность есть. Я могу подготовить завтрак по цене 300 TL с человека, при этом нужно предупредить минимум за один день. — kapı: geçti
- **transfer-tr** (kb3p, tr) — "Havalimanından daireye nasıl gelebilirim, transfer var mı?"
  - kapalı: Merhaba, Havalimanından gelmek için isterseniz sizin için havalimanı transferi ayarlayabiliyorum; ücreti tek yön 1.200 TL. — kapı: geçti
  - açık: Merhaba, Havalimanından daireye isterseniz transfer ayarlayabilirim; ücreti tek yön 1.200 TL’dir. Transfer talep ederseniz havalimanına varış saatinizi ve kişi sayısını yazmanız yeterli. — kapı: blocked
- **transfer-en** (kb3p, en) — "Do you offer an airport transfer?"
  - kapalı: Hello, Yes, we can arrange an airport transfer for you; the fee is 1,200 TL. If you would like to use this service, please let us know. — kapı: geçti
  - açık: Hello, Yes, I can arrange an airport transfer for you; the cost is 1,200 TL. If you would like to book it, please let me know your arrival airport, flight number and landing time. — kapı: geçti
- **transfer-de** (kb3p, de) — "Bieten Sie einen Flughafentransfer an?"
  - kapalı: Hallo, Ja, ich kann für Sie einen Flughafentransfer organisieren; die Fahrt kostet 1.200 TL. — kapı: geçti
  - açık: Hallo, Ja, ich kann für Sie einen Flughafentransfer organisieren; die Kosten betragen 1.200 TL. — kapı: geçti
- **latecheckout-tr** (kb3p, tr) — "Geç çıkış ücreti ne kadar?"
  - kapalı: Merhaba, Geç çıkış için, çıkış saatinizi 14:00’e kadar uzatmanız durumunda 500 TL ücret alıyoruz. Geç çıkış her durumda bizim onayımıza tabidir. — kapı: availability_unconfirmed
  - açık: Merhaba, Geç çıkış imkanı ve ücreti bizim onayımıza bağlıdır; net tutar ve uygunluk için karar vermemiz gerekiyor. Mesajınız kaydedildi; ev sahibiniz görebilir. — kapı: blocked · üçüncü şahıs · OLGU EKSİK
- **latecheckout-en** (kb3p, en) — "How much does late checkout cost?"
  - kapalı: Hello, Late check-out until 14:00 is 500 TL and depends on our approval, based on availability and cleaning schedule. Your request has been recorded and is visible to your host. — kapı: blocked · üçüncü şahıs
  - açık: Hello, Late check-out is subject to my approval and the fee is 500 TL to stay until 14:00. Our regular check-out time is 11:00. — kapı: availability_unconfirmed
- **parking-tr** (kb3p, tr) — "Otopark var mı?"
  - kapalı: Merhaba, Binanın önündeki otoparkta size ücretsiz bir park yeri ayırıyorum. — kapı: geçti
  - açık: Merhaba, Binanın önündeki otoparkta misafirlerimiz için ücretsiz bir park yeri ayırıyorum. — kapı: geçti
- **parking-en** (kb3p, en) — "Is there parking?"
  - kapalı: Hello, Yes, there is parking in front of the building and I reserve one spot there for guests free of charge. — kapı: geçti
  - açık: Hello, Yes, there is parking available. I reserve one free spot for you in the parking area in front of the building. — kapı: geçti
- **luggage-tr** (kb3p, tr) — "Çıkıştan sonra bavullarımızı bir süre bırakabilir miyiz?"
  - kapalı: Merhaba, Çıkıştan sonra bavullarınızı dairede 18:00'e kadar bırakabilirsiniz. — kapı: availability_claim
  - açık: Merhaba, Çıkıştan sonra bavullarınızı dairede 18:00'e kadar bırakabilirsiniz. — kapı: availability_unconfirmed
- **luggage-en** (kb3p, en) — "Can we leave our luggage after checkout?"
  - kapalı: Hello, Yes, you can leave your luggage in the apartment after checkout, up to 18:00. — kapı: availability_unconfirmed
  - açık: Hello, Yes, you can leave your luggage in the apartment after checkout; it can stay there until 18:00. — kapı: geçti
- **pets-tr** (kb3p, tr) — "Köpeğimizi getirebilir miyiz?"
  - kapalı: Merhaba, Evcil hayvan kabulü bizim onayımıza tabidir; mesajınız kaydedildi, ev sahibiniz görebilir. — kapı: blocked · üçüncü şahıs · OLGU EKSİK
  - açık: Merhaba, Evcil hayvan kabulü iznimize bağlıdır; bu konu ev sahibinizin kararıdır, mesajınız kaydedildi ve ev sahibiniz görebilir. — kapı: blocked · üçüncü şahıs · OLGU EKSİK
- **pets-de** (kb3p, de) — "Dürfen wir unseren Hund mitbringen?"
  - kapalı: Hallo, Haustiere, also auch Ihr Hund, sind nur nach unserer vorherigen Zustimmung möglich; diese Entscheidung liegt bei uns als Gastgebern. Ihre Anfrage wurde vermerkt und ist für uns sichtbar. — kapı: blocked · OLGU EKSİK
  - açık: Hallo, Haustiere, einschließlich Hunde, sind nur mit unserer vorherigen Zustimmung erlaubt. Das ist unsere Entscheidung; Ihre Anfrage wurde notiert und ist für uns sichtbar. — kapı: blocked · OLGU EKSİK
- **extrabed-tr** (kb3p, tr) — "Ek yatak alabilir miyiz?"
  - kapalı: Merhaba, Ek yatak sağlayabiliyorum, gecelik ücreti 250 TL. Hazırlamamı isterseniz lütfen bildirir misiniz? — kapı: geçti
  - açık: Merhaba, Ek yatak sağlayabilirim; ücreti gecelik 250 TL'dir. Uygunluk ve hazırlık benim onayıma bağlıdır; mesajınız kaydedildi, ev sahibiniz görebilir. — kapı: blocked · üçüncü şahıs
- **extrabed-ru** (kb3p, ru) — "Можно ли получить дополнительную кровать?"
  - kapalı: Здравствуйте! Я могу предоставить дополнительную кровать; стоимость составляет 250 TL за ночь. Предоставление дополнительной кровати зависит от моего подтверждения, ваше сообщение сохранено и я смогу его увидеть. — kapı: blocked
  - açık: Здравствуйте! Да, я могу предоставить дополнительную кровать; стоимость составляет 250 TL за ночь. — kapı: geçti
- **welcome-tr** (kb3p, tr) — "Anahtarı nasıl alacağız?"
  - kapalı: Merhaba, Girişte sizi binanın önünde ben karşılıyorum ve anahtarı elden teslim ediyorum. — kapı: geçti
  - açık: Merhaba, Girişte binanın önünde sizi karşılıyorum ve anahtarı elden teslim ediyorum. — kapı: geçti
- **laundry-en** (kb3p, en) — "Is there a laundry service?"
  - kapalı: Hello, Yes, there is a laundry service. I offer free laundry once a week during your stay. — kapı: geçti
  - açık: Hello, Yes, there is. I offer a free laundry service once a week. — kapı: geçti
- **wifi-tr** (control, tr) — "Wi-Fi şifresi nedir?"
  - kapalı: Merhaba, Wi-Fi ağımızın adı "LaleHome", şifresi deniz2024. — kapı: geçti
  - açık: Merhaba, Wi-Fi ağımızın adı "LaleHome", şifresi deniz2024. — kapı: geçti
- **wifi-en** (control, en) — "What's the wifi password?"
  - kapalı: Hello, The Wi-Fi network is "LaleHome" and the password is deniz2024. — kapı: geçti
  - açık: Hello, The Wi‑Fi network is "LaleHome" and the password is "deniz2024". — kapı: geçti
- **checkout-tr** (control, tr) — "Çıkış saati kaçta?"
  - kapalı: Merhaba, Çıkış saati 11:00. — kapı: geçti
  - açık: Merhaba, Çıkış saati 11:00. — kapı: geçti
- **trash-tr** (control, tr) — "Çöpleri nereye atabiliriz?"
  - kapalı: Merhaba, Çöpleri her gün 20:00'den sonra bina girişindeki konteynere atabilirsiniz. — kapı: geçti
  - açık: Merhaba, Çöpleri her gün 20:00'den sonra bina girişindeki konteynere atabilirsiniz. — kapı: geçti
- **ac-en** (control, en) — "Where is the AC remote?"
  - kapalı: Hello, The AC remote is in the drawer next to the TV. — kapı: geçti
  - açık: Hello, The AC remote is in the drawer next to the television. — kapı: geçti

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `6d7ed3c8`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | low |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-6-luna` | low |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-6-luna` | medium |
| Üslup özeti | `gpt-6-luna` | none |
| Karar metni yazıcısı | `claude-haiku-5-5` | yok (klasik model) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_HOST_VOICE_GUARD_DISABLED=(boş)` · `AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_REFERRAL_JUDGE_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `d409de06877e` (öğe + yabancı dil örneği `5f75f4706871`) · anlama `9caaf057e8f5` (kip: cfu+fee)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
