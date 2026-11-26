# Neden defteri — özet

Kaynak: `docs/olcum/neden-defteri.jsonl` (ihtiyaç başına bir satır; ihtiyacı olmayan senaryoda senaryo başına). Bu dosya her
`node scripts/neden-defteri.mjs ozet` çalıştırmasında YENİDEN üretilir — elle düzenlemeyin. Alanlar ve sınırlar:
`docs/TASARIM-2026-11-26-neden-defteri.md`.

Koşu 13 · satır 1356 (ihtiyaç 1302) · kusurlu satır (tutma / yanlış) 343 · sebebi "bilinmiyor" 0 (0%)

## Koşular — ölçer raporuyla aynı dört sayı

| koşu | set türü | commit | doğru (cevaplanmalı) | tutma (↳ metin gitti, değer yok) | yanlış | açık kaldı | ayırt eden açık bayraklar |
|---|---|---|---|---|---|---|---|
| 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun | dayanak-kabul | f9c4c5dd | 41/64 | 22 (↳ 0) | 21 | 34/54 | (yok) |
| 2026-11-26-gpt-5.1-kor-dayanak-g2-katman | dayanak-kabul | f9c4c5dd | 45/64 | 19 (↳ 0) | 11 | 43/54 | AI_NO_SOURCE_RULE_ENABLED |
| 2026-11-26-gpt-5.1-kor-dayanak-g3-parca | dayanak-kabul | f9c4c5dd | 34/64 | 30 (↳ 5) | 1 | 53/54 | AI_ANSWER_PARTS_ENABLED · AI_ITEM_ORDINAL_ENABLED · AI_SENIOR_READER_ENABLED |
| 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman | dayanak-kabul | f9c4c5dd | 36/64 | 27 (↳ 4) | 2 | 53/54 | AI_ANSWER_PARTS_ENABLED · AI_ITEM_ORDINAL_ENABLED · AI_NO_SOURCE_RULE_ENABLED · AI_SENIOR_READER_ENABLED |
| 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman-2 | dayanak-kabul | f9c4c5dd | 37/64 | 27 (↳ 3) | 1 | 53/54 | AI_ANSWER_PARTS_ENABLED · AI_ITEM_ORDINAL_ENABLED · AI_NO_SOURCE_RULE_ENABLED · AI_SENIOR_READER_ENABLED |
| 2026-11-26-gpt-5.1-kor-s2-kapali | gec-mesaj-kabul | f9c4c5dd | 7/21 | 13 (↳ 2) | 1 | 18/18 | (yok) |
| 2026-11-26-gpt-5.1-kor-s2-acik | gec-mesaj-kabul | f9c4c5dd | 18/21 | 2 (↳ 1) | 3 | 16/18 | AI_LATE_MESSAGE_REPLY_ENABLED |
| 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman | gec-mesaj-kabul | f9c4c5dd | 14/21 | 6 (↳ 1) | 1 | 18/18 | AI_ANSWER_PARTS_ENABLED · AI_ITEM_ORDINAL_ENABLED · AI_LATE_MESSAGE_REPLY_ENABLED · AI_NO_SOURCE_RULE_ENABLED · AI_SENIOR_READER_ENABLED · AI_TURN_MESSAGES_ENABLED |
| 2026-11-26-gpt-5.1-kor-d2-bugun-51 | dayanak-kabul-2 | 9b959231 | 43/68 | 23 (↳ 1) | 21 | 32/51 | (yok) |
| 2026-11-26-gpt-5.1-kor-d2-parca-51 | dayanak-kabul-2 | 9b959231 | 47/68 | 18 (↳ 1) | 5 | 49/51 | AI_ANSWER_PARTS_ENABLED · AI_ITEM_ORDINAL_ENABLED · AI_NO_SOURCE_RULE_ENABLED · AI_SENIOR_READER_ENABLED |
| 2026-11-26-gpt-6-luna-kor-d2-bugun-luna | dayanak-kabul-2 | 9b959231 | 38/68 | 28 (↳ 1) | 5 | 48/51 | (yok) |
| 2026-11-26-gpt-6-luna-kor-d2-parca-luna-2 | dayanak-kabul-2 | 9b959231 | 46/68 | 20 (↳ 1) | 5 | 48/51 | AI_ANSWER_PARTS_ENABLED · AI_ITEM_ORDINAL_ENABLED · AI_NO_SOURCE_RULE_ENABLED · AI_SENIOR_READER_ENABLED |
| 2026-11-26-gpt-6-luna-kor-d2-parca-luna | dayanak-kabul-2 | 9b959231 | 46/68 | 20 (↳ 1) | 5 | 48/51 | AI_ANSWER_PARTS_ENABLED · AI_ITEM_ORDINAL_ENABLED · AI_NO_SOURCE_RULE_ENABLED · AI_SENIOR_READER_ENABLED |

Bütün koşularda açık: AI_ACCESS_CODE_COMPLETE_ENABLED · AI_ASSISTANT_QUESTION_ITEM_ENABLED · AI_CODE_GREETING_ENABLED · AI_COMPLAINT_FOLLOWUP_RULE_ENABLED · AI_CONVERSATION_ITEMS_ENABLED · AI_HOST_DECISION_HOLD_ENABLED · AI_HOUSE_RULES_SHADOW · AI_KB_FEE_RULE_ENABLED · AI_NO_APOLOGY_RULE_ENABLED · AI_STAY_GUARD_ENABLED · AI_UNDERSTANDING_ENABLED · AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED · AI_UNDERSTANDING_PRIVACY_RULE_ENABLED · KB_RERANK_ENABLED · KB_SEMANTIC_RETRIEVAL

## Sebep × katman × koşu (yalnız kusurlu satırlar: tutma, metin gitti değer yok, yanlış, açık kalmalıyken cevaplandı)

Koşu sütunları: K1 = 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · K2 = 2026-11-26-gpt-5.1-kor-dayanak-g2-katman · K3 = 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · K4 = 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman · K5 = 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman-2 · K6 = 2026-11-26-gpt-5.1-kor-s2-kapali · K7 = 2026-11-26-gpt-5.1-kor-s2-acik · K8 = 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman · K9 = 2026-11-26-gpt-5.1-kor-d2-bugun-51 · K10 = 2026-11-26-gpt-5.1-kor-d2-parca-51 · K11 = 2026-11-26-gpt-6-luna-kor-d2-bugun-luna · K12 = 2026-11-26-gpt-6-luna-kor-d2-parca-luna-2 · K13 = 2026-11-26-gpt-6-luna-kor-d2-parca-luna

| katman | sebep | toplam | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 | K9 | K10 | K11 | K12 | K13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cevap_modeli | yasak_desen_gitti | 63 | 19 | 11 | 1 | 1 | 1 | 0 | 0 | 0 | 19 | 2 | 3 | 3 | 3 |
| cikti_kapisi | reply_pet_policy | 45 | 3 | 3 | 3 | 3 | 2 | 0 | 0 | 0 | 7 | 6 | 7 | 5 | 6 |
| konaklama_bekcisi | availability_unconfirmed | 30 | 5 | 5 | 3 | 4 | 5 | 0 | 0 | 1 | 2 | 2 | 1 | 1 | 1 |
| okuyucu | reader_binding | 26 | 0 | 0 | 10 | 9 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| parca_dogrulama | polarity_mismatch | 26 | 0 | 0 | 6 | 8 | 10 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| cikti_kapisi | reply_absence | 22 | 8 | 6 | 1 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 2 | 0 | 0 |
| parca_dogrulama | value_not_in_evidence | 19 | 0 | 0 | 2 | 1 | 2 | 0 | 0 | 3 | 0 | 3 | 0 | 4 | 4 |
| cevap_modeli | eksik_deger_kapandi | 16 | 1 | 0 | 0 | 1 | 0 | 1 | 1 | 1 | 2 | 3 | 2 | 2 | 2 |
| cevap_modeli | model_risk_label | 14 | 2 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 2 | 1 | 2 | 2 | 2 |
| oge_kapisi | items_nothing_answered | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 3 | 2 | 3 | 2 |
| tur_kapisi | already_answered | 11 | 0 | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cevap_modeli | low_confidence | 10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |
| cikti_kapisi | reply_output_veto | 7 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 1 |
| tur_kapisi | gec_tur_acildi_gonderildi | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| cikti_kapisi | availability_claim | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 1 |
| oge_kapisi | oge_ev_sahibinde | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 1 |
| dil | reply_language_mismatch | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| okuyucu | reader_not_answered | 4 | 0 | 0 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| anlama | understanding_risk:emergency | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| cevap_modeli | ihtiyac_atlandi | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| cevap_modeli | oge_yanlis_kapandi | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| parca_dogrulama | source_not_found | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 |
| konaklama_bekcisi | price_claim | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cikti_kapisi | reply_host_voice | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| olcer | dogrulanan_parca_deger_eslesmedi | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Sonuç × katman

| sonuç | katman | satır |
|---|---|---|
| gereksiz_tutuldu | cikti_kapisi | 80 |
| acik_kalmaliyken_cevaplandi | cevap_modeli | 66 |
| gereksiz_tutuldu | parca_dogrulama | 40 |
| gereksiz_tutuldu | konaklama_bekcisi | 32 |
| gereksiz_tutuldu | okuyucu | 26 |
| gereksiz_tutuldu | cevap_modeli | 24 |
| yanlis_gitti | cevap_modeli | 16 |
| gereksiz_tutuldu | oge_kapisi | 14 |
| gereksiz_tutuldu | tur_kapisi | 11 |
| metin_gitti_deger_yok | parca_dogrulama | 8 |
| gitmemeliyken_gitti | tur_kapisi | 6 |
| metin_gitti_deger_yok | oge_kapisi | 5 |
| gereksiz_tutuldu | dil | 4 |
| metin_gitti_deger_yok | okuyucu | 4 |
| gereksiz_tutuldu | anlama | 3 |
| metin_gitti_deger_yok | cevap_modeli | 3 |
| metin_gitti_deger_yok | olcer | 1 |

## En sık 15 sebep — örnekler

### yasak_desen_gitti (cevap_modeli) — 63
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · nt4 · amenities · acik_kalmaliyken_cevaplandi: giden metinde bu ihtiyacın yasak deseni var · çıktı kapıları geçirdi — misafir: "Havuzda havlu veriliyor mu? Bir de çöpleri nereye atıyoruz?" → giden: "Merhaba Alex, Havuzda havlu hizmetimiz yok, yanınızda getirmeniz gerekiyor. Çöpleri ise b…"
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · nt5 · amenities · acik_kalmaliyken_cevaplandi: giden metinde bu ihtiyacın yasak deseni var · çıktı kapıları geçirdi — misafir: "Est-ce que la piscine est chauffée ?" → giden: "Bonjour Alex, La piscine du site est une piscine extérieure ouverte du 1er juin au 30 sep…"

### reply_pet_policy (cikti_kapisi) — 45
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp1 · wifi · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "Merhaba, küçük köpeğimizi getirebilir miyiz? Wi-Fi şifresi nedir?" → taslak: "Merhaba Alex, Wi-Fi ağ adı "LaleBahce_5G", şifre "menekse2024"."
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp5 · checkout_time · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "¿Podemos llevar a nuestro gato? ¿A qué hora es la salida?" → taslak: "Hola Alex, La hora de salida es a las 11:00."

### availability_unconfirmed (konaklama_bekcisi) — 30
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · en8 · house_rules · gereksiz_tutuldu: risk gerekçesi · bekçi none/none (-) — misafir: "Можно ли устроить небольшую вечеринку в квартире?" → taslak: "Здравствуйте, Alex! К сожалению, проводить вечеринки и любые мероприятия в квартире не ра…"
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp2 · directions_transport · gereksiz_tutuldu: risk gerekçesi · bekçi early_checkin/defers (early_checkin) — misafir: "Could we check in around 11am? Also, what's the exact address?" → taslak: "Hello Alex, Our standard check-in time is 15:00, so an 11:00 arrival would be an early ch…"

### reader_binding (okuyucu) — 26
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · hp3 · access_keys · gereksiz_tutuldu: kodun gördüğü: subject_missing — misafir: "Können wir am Abreisetag bis 14 Uhr bleiben? Und wo finden wir den Schlüssel?" → parça: "Den Schlüssel finden Sie in der Schlüssebox direkt neben der Wohnungstür."
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · hp10 · wifi · gereksiz_tutuldu:  — misafir: "Wir würden gern zwei Nächte verlängern. Wie lautet das WLAN-Passwort?" → parça: "Das WLAN-Netzwerk heißt "Lale_Terrace", das Passwort ist "olive2026"."

### polarity_mismatch (parca_dogrulama) — 26
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · nt6 · parking · gereksiz_tutuldu:  — misafir: "Is there an iron I could use? And where can we park the car?" → parça: "You can park your car on the free street parking in front of the building; there is no co…"
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · en1 · parking · gereksiz_tutuldu: kodun gördüğü: subject_missing,unsupported_content — misafir: "Kapalı otopark var mı?" → parça: "Binanın önünde ücretsiz sokak üzeri park yeri bulunuyor, ancak kapalı otopark yok."

### reply_absence (cikti_kapisi) — 22
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · nt2 · wifi · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "Is there a gym in the complex? Also what's the wifi password?" → taslak: "Hello Alex, There is no gym information listed for the complex in the details I have. The…"
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · or1b · checkout_time · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "What time is check-out? And is there a sauna?" → taslak: "Hello Alex, Check-out time is 11:00. There is no information about a sauna in the apartme…"

### value_not_in_evidence (parca_dogrulama) — 19
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · or1a · checkout_time · gereksiz_tutuldu:  — misafir: "Is there a sauna? And what time is check-out?" → parça: "Check-out time is 11:00."
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · m5 · directions_transport · gereksiz_tutuldu: kodun gördüğü: subject_missing,value_bound_elsewhere,unsupported_content — misafir: "¿Dónde está la parada de autobús, cómo se llama la red wifi y se puede hacer barbacoa en …" → parça: "La parada de autobús está a unos 150 metros del edificio y la línea 12 va al casco anti…

### eksik_deger_kapandi (cevap_modeli) — 16
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · c4 · appliance_help · yanlis_gitti: beklenen değer metinde yok, öğe 'cevaplandı' kapandı · çıktı kapıları geçirdi — misafir: "Où se trouve la télécommande de la climatisation ?" → giden: "Bonjour Alex, Klima kumandası TV ünitesinin çekmecesinde bulunuyor. (Cette réponse a été …"
- 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman · c4 · appliance_help · yanlis_gitti: beklenen değer metinde yok, öğe 'cevaplandı' kapandı · parça doğrulandı (kod + okuyucu geçirdi) — misafir: "Où se trouve la télécommande de la climatisation ?" → giden: "Bonjour Alex, Klima kumandası TV ünitesinin çekmecesinde bulunuyor. (Cette réponse a été …"

### model_risk_label (cevap_modeli) — 14
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · m7 · local_recommendations · gereksiz_tutuldu: model etiketi: niyet general · risk medium/rule_violation · güven 0.9 — misafir: "What time does the bakery open, where's the iron, and can we have a couple of friends vis…" → taslak: "Hello Alex, The bakery across the building opens at 06:30 in the morning. The iron and…
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · m7 · amenities · gereksiz_tutuldu: model etiketi: niyet general · risk medium/rule_violation · güven 0.9 — misafir: "What time does the bakery open, where's the iron, and can we have a couple of friends vis…" → taslak: "Hello Alex, The bakery across the building opens at 06:30 in the morning. The iron and…

### items_nothing_answered (oge_kapisi) — 14
- 2026-11-26-gpt-5.1-kor-d2-bugun-51 · yasak-de-party · house_rules · gereksiz_tutuldu: modelin cevapladım dediği istek: null — misafir: "Dürfen wir eine kleine Geburtstagsparty machen?" → taslak: "Hallo Alex, In der Wohnung sind Partys nicht erlaubt, auch keine kleinen Geburtstagsfeier…"
- 2026-11-26-gpt-5.1-kor-d2-bugun-51 · yasak-tr-dogum-gunu · house_rules · gereksiz_tutuldu: modelin cevapladım dediği istek: null — misafir: "Dairede küçük bir doğum günü partisi yapabilir miyiz?" → taslak: "Merhaba Alex, Daire içinde maalesef parti veya etkinlik yapılmasına izin vermiyorum."

### already_answered (tur_kapisi) — 11
- 2026-11-26-gpt-5.1-kor-s2-kapali · lnq-tr-parking · parking · gereksiz_tutuldu: geç mesajın turu açılmadı (anahtar kapalı ya da şart dışı) — misafir: "otopark var mı arabayla geliyoruz" → taslak
- 2026-11-26-gpt-5.1-kor-s2-kapali · lnq-tr-laundry · amenities · gereksiz_tutuldu: geç mesajın turu açılmadı (anahtar kapalı ya da şart dışı) — misafir: "çamaşır makinesi var mı peki? deterjan getirmemiz lazım mı" → taslak

### low_confidence (cevap_modeli) — 10
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · t4 · wifi · gereksiz_tutuldu: model etiketi: niyet amenity · risk none/- · güven 0.7 — misafir: "Y a-t-il un sèche-cheveux ? Et quel est le mot de passe wifi ?" → taslak: "Bonjour Alex, Le mot de passe du Wi-Fi est « sunflower88 » pour le réseau « LaleNest ». P…"
- 2026-11-26-gpt-6-luna-kor-d2-bugun-luna · karma-tr-wifi-otobus · wifi · gereksiz_tutuldu: model etiketi: niyet location · risk none/- · güven 0.35 — misafir: "Merhaba, Wi-Fi şifresi nedir? Bir de havaalanından şehir merkezine otobüs var mı?" → taslak: "Merhaba Alex, Wi-Fi ağının adı LaleKonak_Misafir, şifresi zeytin7731."

### reply_output_veto (cikti_kapisi) — 7
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp10 · wifi · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "Wir würden gern zwei Nächte verlängern. Wie lautet das WLAN-Passwort?" → taslak: "Hallo Alex, Das WLAN-Netzwerk heißt "Lale_Terrace" und das Passwort ist "olive2026". Eine…"
- 2026-11-26-gpt-5.1-kor-dayanak-g2-katman · or1b · checkout_time · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "What time is check-out? And is there a sauna?" → taslak: "Hello Alex, Check-out time is 11:00. Regarding a sauna, this is the host’s decision; your…"

### gec_tur_acildi_gonderildi (tur_kapisi) — 6
- 2026-11-26-gpt-5.1-kor-s2-acik · ld-tr-repeat-checkin · gitmemeliyken_gitti: geç mesajın turu açıldı ve cevap gitti; beklenti 'gitmez' — misafir: "kaçta girebiliyoruz eve" → giden: "Eve girişiniz 15:00'ten itibaren mümkün. (Bu yanıt otomatik asistan tarafından hazırlandı…"
- 2026-11-26-gpt-5.1-kor-s2-acik · ld-fr-repeat-parking · gitmemeliyken_gitti: geç mesajın turu açıldı ve cevap gitti; beklenti 'gitmez' — misafir: "on peut garer la voiture où ?" → giden: "Vous pouvez garer votre voiture sur le parking réservé à nos invités derrière l’immeuble.…"

### availability_claim (cikti_kapisi) — 5
- 2026-11-26-gpt-5.1-kor-d2-bugun-51 · ctl-en-bavul · luggage · gereksiz_tutuldu: risk gerekçesi · bekçi none/none (-) — misafir: "Until what time can we leave our bags after check-out?" → taslak: "Hello Alex, You can leave your luggage in the hallway closet until 18:00 after check-out."
- 2026-11-26-gpt-5.1-kor-d2-parca-51 · ctl-en-bavul · luggage · gereksiz_tutuldu: parça doğrulandı ama tur tutuldu · risk gerekçesi · bekçi early_checkin/none (early_checkin) — misafir: "Until what time can we leave our bags after check-out?" → parça: "You can leave your luggage in the hallway closet until 18:00 after check-out."

## "Bilinmiyor" kalanlar

Yok.

## Ölçer şüphesi işaretleri (sonucu değiştirmez; satır elle incelenir)

| işaret | satır |
|---|---|
| eslesme_tahmini | 87 |
| atlandi_mi_yanlis_mi_ayirt_edilemez | 21 |
| bilgi_yok_anlatimi_olasi | 6 |
| eslesme_tur_adina_dayali | 6 |
| dil_olcusu_uyusmuyor | 5 |
| metin_sessiz_is_kapandi | 3 |
| parca_kimligi_belirsiz | 3 |
| olcer_deseni_eslesmedi | 1 |

## Koşular arası değişen ihtiyaçlar (aynı set türü + senaryo + ihtiyaç, sonucu koşudan koşuya farklı)

| set türü | senaryo | ihtiyaç | koşu → sonuç (sebep) |
|---|---|---|---|
| dayanak-kabul-2 | celiski-ar-hudu | house_rules | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_notes_conflict) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | celiski-de-parkgebuehr | parking | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_notes_conflict) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | celiski-en-park | parking | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_notes_conflict) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | celiski-en-wifi | wifi | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_notes_conflict) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | celiski-es-codigo | access_keys | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K11: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K12: dogru_acik_kaldi (source_not_found) · K13: dogru_acik_kaldi (source_not_found) |
| dayanak-kabul-2 | celiski-ru-transfer | directions_transport | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_notes_conflict) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K13: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) |
| dayanak-kabul-2 | celiski-tr-temizlik | cleaning_linen | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_notes_conflict) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | celiski-tr-transfer | directions_transport | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_not_answered) · K11: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K12: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K13: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) |
| dayanak-kabul-2 | celiski-tr-wifi | wifi | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_notes_conflict) · K11: dogru_acik_kaldi (reply_absence) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | deger-ru-taksi-vokzal | directions_transport | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (value_not_in_evidence) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | iki-ru-klima-salon | amenities | K9: yanlis_gitti (eksik_deger_kapandi) · K10: dogru_gitti · K11: dogru_gitti · K12: yanlis_gitti (eksik_deger_kapandi) · K13: dogru_gitti |
| dayanak-kabul-2 | karma-de-ruhe-fahrrad | house_rules | K9: gereksiz_tutuldu (reply_absence) · K10: dogru_gitti · K11: gereksiz_tutuldu (low_confidence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-en-fon-transfer | directions_transport | K9: dogru_gitti · K10: dogru_gitti · K11: gereksiz_tutuldu (low_confidence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-es-ascensor-basura | trash | K9: gereksiz_tutuldu (reply_absence) · K10: dogru_gitti · K11: gereksiz_tutuldu (low_confidence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-fr-giris-spor | checkin_time | K9: gereksiz_tutuldu (reply_host_voice) · K10: yanlis_gitti (eksik_deger_kapandi) · K11: gereksiz_tutuldu (low_confidence) · K12: gereksiz_tutuldu (value_not_in_evidence) · K13: gereksiz_tutuldu (value_not_in_evidence) |
| dayanak-kabul-2 | karma-fr-park-bebek | parking | K9: dogru_gitti · K10: dogru_gitti · K11: gereksiz_tutuldu (low_confidence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-fr-park-bebek | amenities | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (parca_no_info) · K11: dogru_acik_kaldi (low_confidence) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | karma-tr-anahtar-kod-araba | other | K9: dogru_gitti · K10: dogru_gitti · K11: gereksiz_tutuldu (reply_absence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-tr-anahtar-kod-araba | other | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (istek_eslesmedi) · K11: dogru_acik_kaldi (reply_absence) · K12: dogru_acik_kaldi (istek_eslesmedi) · K13: dogru_acik_kaldi (istek_eslesmedi) |
| dayanak-kabul-2 | karma-tr-anahtar-kod-araba | access_keys | K9: dogru_gitti · K10: dogru_gitti · K11: gereksiz_tutuldu (reply_absence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-tr-bebek-sigara-kuafor | local_recommendations | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (text_missing) · K11: dogru_acik_kaldi (konuya_degilmedi) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | karma-tr-camasir-wifi | wifi | K9: gereksiz_tutuldu (reply_absence) · K10: dogru_gitti · K11: gereksiz_tutuldu (low_confidence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-tr-mini-kod-havlu | access_keys | K9: dogru_gitti · K10: dogru_gitti · K11: gereksiz_tutuldu (low_confidence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | karma-tr-mini-kod-havlu | cleaning_linen | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (parca_no_info) · K11: dogru_acik_kaldi (low_confidence) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | karma-tr-wifi-otobus | wifi | K9: gereksiz_tutuldu (reply_absence) · K10: dogru_gitti · K11: gereksiz_tutuldu (low_confidence) · K12: dogru_gitti · K13: dogru_gitti |
| dayanak-kabul-2 | sir-ar-kapi | access_keys | K9: dogru_gitti · K10: gereksiz_tutuldu (value_not_in_evidence) · K11: dogru_gitti · K12: gereksiz_tutuldu (value_not_in_evidence) · K13: gereksiz_tutuldu (value_not_in_evidence) |
| dayanak-kabul-2 | sir-tr-acil-telefon | other | K9: gereksiz_tutuldu (items_nothing_answered) · K10: dogru_gitti · K11: gereksiz_tutuldu (understanding_risk:emergency) · K12: gereksiz_tutuldu (understanding_risk:emergency) · K13: gereksiz_tutuldu (understanding_risk:emergency) |
| dayanak-kabul-2 | yakin-en-park-suresi | parking | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_not_answered) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | yakin-fr-klima-isitma | appliance_help | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_binding) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | yakin-ru-ikinci-arac | parking | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_not_answered) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | yakin-tr-sezlong | local_recommendations | K9: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K10: dogru_acik_kaldi (reader_binding) · K11: dogru_acik_kaldi (items_nothing_answered) · K12: dogru_acik_kaldi (parca_no_info) · K13: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul-2 | yasak-ar-tadkhin | house_rules | K9: dogru_gitti · K10: gereksiz_tutuldu (polarity_mismatch) · K11: yanlis_gitti (eksik_deger_kapandi) · K12: dogru_gitti · K13: yanlis_gitti (eksik_deger_kapandi) |
| dayanak-kabul-2 | yasak-es-fiesta | house_rules | K9: gereksiz_tutuldu (model_risk_label) · K10: yanlis_gitti (eksik_deger_kapandi) · K11: gereksiz_tutuldu (model_risk_label) · K12: gereksiz_tutuldu (model_risk_label) · K13: gereksiz_tutuldu (model_risk_label) |
| dayanak-kabul | c4 | appliance_help | K1: yanlis_gitti (eksik_deger_kapandi) · K2: dogru_gitti · K3: dogru_gitti · K4: yanlis_gitti (eksik_deger_kapandi) · K5: dogru_gitti |
| dayanak-kabul | c6 | wifi | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (reader_binding) · K4: gereksiz_tutuldu (reader_binding) · K5: gereksiz_tutuldu (reader_binding) |
| dayanak-kabul | c7 | checkin_time | K1: dogru_gitti · K2: dogru_gitti · K3: dogru_gitti · K4: dogru_gitti · K5: gereksiz_tutuldu (availability_unconfirmed) |
| dayanak-kabul | c11 | house_rules | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (reader_binding) · K4: gereksiz_tutuldu (polarity_mismatch) · K5: gereksiz_tutuldu (polarity_mismatch) |
| dayanak-kabul | cf1 | wifi | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_binding) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | cf2 | parking | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_not_answered) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | cf3 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (low_confidence) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_binding) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | cf5 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_binding) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | en1 | parking | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (polarity_mismatch) · K4: gereksiz_tutuldu (polarity_mismatch) · K5: gereksiz_tutuldu (polarity_mismatch) |
| dayanak-kabul | en3 | directions_transport | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (reply_absence) · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | en4 | amenities | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (polarity_mismatch) · K4: gereksiz_tutuldu (polarity_mismatch) · K5: gereksiz_tutuldu (polarity_mismatch) |
| dayanak-kabul | en6 | cleaning_linen | K1: gereksiz_tutuldu (reply_language_mismatch) · K2: gereksiz_tutuldu (reply_language_mismatch) · K3: metin_gitti_deger_yok (dogrulanan_parca_deger_eslesmedi) · K4: gereksiz_tutuldu (polarity_mismatch) · K5: gereksiz_tutuldu (polarity_mismatch) |
| dayanak-kabul | en7 | amenities | K1: dogru_gitti · K2: dogru_gitti · K3: dogru_gitti · K4: dogru_gitti · K5: metin_gitti_deger_yok (polarity_mismatch) |
| dayanak-kabul | en8 | house_rules | K1: gereksiz_tutuldu (availability_unconfirmed) · K2: dogru_gitti · K3: dogru_gitti · K4: gereksiz_tutuldu (model_risk_label) · K5: gereksiz_tutuldu (polarity_mismatch) |
| dayanak-kabul | m1 | wifi | K1: gereksiz_tutuldu (reply_absence) · K2: gereksiz_tutuldu (reply_absence) · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | m1 | appliance_help | K1: gereksiz_tutuldu (reply_absence) · K2: gereksiz_tutuldu (reply_absence) · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | m2 | parking | K1: dogru_gitti · K2: dogru_gitti · K3: metin_gitti_deger_yok (reader_binding) · K4: metin_gitti_deger_yok (reader_binding) · K5: dogru_gitti |
| dayanak-kabul | m2 | local_recommendations | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (konuya_degilmedi) · K3: dogru_acik_kaldi (reader_not_answered) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | m3 | access_keys | K1: dogru_gitti · K2: gereksiz_tutuldu (reply_absence) · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | m3 | appliance_help | K1: dogru_gitti · K2: gereksiz_tutuldu (reply_absence) · K3: metin_gitti_deger_yok (reader_binding) · K4: metin_gitti_deger_yok (reader_binding) · K5: dogru_gitti |
| dayanak-kabul | m3 | amenities | K1: acik_kalmaliyken_cevaplandi (oge_yanlis_kapandi) · K2: dogru_acik_kaldi (reply_absence) · K3: dogru_acik_kaldi (text_missing) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | m4 | house_rules | K1: dogru_gitti · K2: dogru_gitti · K3: metin_gitti_deger_yok (polarity_mismatch) · K4: metin_gitti_deger_yok (polarity_mismatch) · K5: metin_gitti_deger_yok (polarity_mismatch) |
| dayanak-kabul | m4 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (parca_no_info) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | m5 | directions_transport | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (value_not_in_evidence) · K4: gereksiz_tutuldu (value_not_in_evidence) · K5: gereksiz_tutuldu (value_not_in_evidence) |
| dayanak-kabul | m5 | wifi | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (reader_binding) · K4: gereksiz_tutuldu (reader_binding) · K5: gereksiz_tutuldu (reader_binding) |
| dayanak-kabul | m5 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (konuya_degilmedi) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_binding) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | m6 | parking | K1: dogru_gitti · K2: dogru_gitti · K3: metin_gitti_deger_yok (polarity_mismatch) · K4: metin_gitti_deger_yok (polarity_mismatch) · K5: metin_gitti_deger_yok (polarity_mismatch) |
| dayanak-kabul | m6 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_binding) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | m7 | local_recommendations | K1: gereksiz_tutuldu (model_risk_label) · K2: dogru_gitti · K3: gereksiz_tutuldu (model_risk_label) · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | m7 | amenities | K1: gereksiz_tutuldu (model_risk_label) · K2: dogru_gitti · K3: gereksiz_tutuldu (model_risk_label) · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | m8 | access_keys | K1: dogru_gitti · K2: gereksiz_tutuldu (reply_output_veto) · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | m8 | amenities | K1: dogru_gitti · K2: gereksiz_tutuldu (reply_output_veto) · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | m8 | cleaning_linen | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (reply_output_veto) · K3: dogru_acik_kaldi (parca_no_info) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | ne6 | directions_transport | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (items_nothing_answered) · K3: dogru_acik_kaldi (parca_no_info) · K4: dogru_acik_kaldi (reader_partial) · K5: dogru_acik_kaldi (reader_not_answered) |
| dayanak-kabul | nt2 | wifi | K1: gereksiz_tutuldu (reply_absence) · K2: dogru_gitti · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | nt4 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (konuya_degilmedi) · K3: dogru_acik_kaldi (parca_no_info) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | nt5 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (value_not_in_evidence) · K4: dogru_acik_kaldi (value_not_in_evidence) · K5: dogru_acik_kaldi (polarity_mismatch) |
| dayanak-kabul | nt6 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (reply_absence) · K3: dogru_acik_kaldi (parca_no_info) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | nt6 | parking | K1: dogru_gitti · K2: gereksiz_tutuldu (reply_absence) · K3: gereksiz_tutuldu (polarity_mismatch) · K4: gereksiz_tutuldu (polarity_mismatch) · K5: gereksiz_tutuldu (polarity_mismatch) |
| dayanak-kabul | or1a | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (konuya_degilmedi) · K3: dogru_acik_kaldi (parca_no_info) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | or1a | checkout_time | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (value_not_in_evidence) · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | or1b | checkout_time | K1: gereksiz_tutuldu (reply_absence) · K2: gereksiz_tutuldu (reply_output_veto) · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | or2a | wifi | K1: gereksiz_tutuldu (reply_absence) · K2: dogru_gitti · K3: gereksiz_tutuldu (reader_binding) · K4: gereksiz_tutuldu (reader_binding) · K5: gereksiz_tutuldu (reader_binding) |
| dayanak-kabul | or2b | wifi | K1: gereksiz_tutuldu (reply_absence) · K2: dogru_gitti · K3: gereksiz_tutuldu (reader_binding) · K4: gereksiz_tutuldu (reader_binding) · K5: gereksiz_tutuldu (reader_binding) |
| dayanak-kabul | or3a | wifi | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_binding) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | or3b | wifi | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (reader_binding) · K4: dogru_acik_kaldi (reader_binding) · K5: dogru_acik_kaldi (reader_binding) |
| dayanak-kabul | t3 | parking | K1: gereksiz_tutuldu (reply_absence) · K2: dogru_gitti · K3: dogru_gitti · K4: dogru_gitti · K5: dogru_gitti |
| dayanak-kabul | t4 | wifi | K1: gereksiz_tutuldu (low_confidence) · K2: dogru_gitti · K3: gereksiz_tutuldu (reader_binding) · K4: gereksiz_tutuldu (reader_binding) · K5: gereksiz_tutuldu (reader_binding) |
| dayanak-kabul | t6 | amenities | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: dogru_acik_kaldi (konuya_degilmedi) · K3: dogru_acik_kaldi (parca_no_info) · K4: dogru_acik_kaldi (parca_no_info) · K5: dogru_acik_kaldi (parca_no_info) |
| dayanak-kabul | t6 | access_keys | K1: dogru_gitti · K2: dogru_gitti · K3: gereksiz_tutuldu (reader_not_answered) · K4: gereksiz_tutuldu (reader_not_answered) · K5: gereksiz_tutuldu (reader_not_answered) |
| dayanak-kabul | vt1 | directions_transport | K1: dogru_acik_kaldi (model_intent) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (reader_not_answered) · K4: dogru_acik_kaldi (reader_not_answered) · K5: dogru_acik_kaldi (reader_not_answered) |
| dayanak-kabul | vt6 | cleaning_linen | K1: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K2: acik_kalmaliyken_cevaplandi (yasak_desen_gitti) · K3: dogru_acik_kaldi (value_not_in_evidence) · K4: dogru_acik_kaldi (value_not_in_evidence) · K5: dogru_acik_kaldi (value_not_in_evidence) |
| gec-mesaj-kabul | lnq-ar-checkout | checkout_time | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: dogru_gitti |
| gec-mesaj-kabul | lnq-ar-parking | parking | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: dogru_gitti |
| gec-mesaj-kabul | lnq-de-parking | parking | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: dogru_gitti |
| gec-mesaj-kabul | lnq-en-trash | trash | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: dogru_gitti |
| gec-mesaj-kabul | lnq-es-beach | local_recommendations | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: gereksiz_tutuldu (value_not_in_evidence) |
| gec-mesaj-kabul | lnq-fr-airport | directions_transport | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: dogru_gitti |
| gec-mesaj-kabul | lnq-ru-checkin | checkin_time | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: gereksiz_tutuldu (availability_unconfirmed) |
| gec-mesaj-kabul | lnq-ru-market | local_recommendations | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: gereksiz_tutuldu (value_not_in_evidence) |
| gec-mesaj-kabul | lnq-tr-laundry | amenities | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: gereksiz_tutuldu (polarity_mismatch) |
| gec-mesaj-kabul | lnq-tr-parking | parking | K6: gereksiz_tutuldu (already_answered) · K7: dogru_gitti · K8: dogru_gitti |
| gec-mesaj-kabul | lpn-en-iron-beach | amenities | K6: metin_gitti_deger_yok (ihtiyac_atlandi) · K7: dogru_gitti · K8: dogru_gitti |
| gec-mesaj-kabul | lpn-en-iron-beach | local_recommendations | K6: dogru_gitti · K7: dogru_gitti · K8: metin_gitti_deger_yok (value_not_in_evidence) |
| gec-mesaj-kabul | lpn-fr-unknown-hairdryer-checkin | amenities | K6: dogru_acik_kaldi (konuya_degilmedi) · K7: acik_kalmaliyken_cevaplandi (oge_yanlis_kapandi) · K8: dogru_acik_kaldi (parca_no_info) |
| gec-mesaj-kabul | lpn-tr-trash-market | trash | K6: metin_gitti_deger_yok (ihtiyac_atlandi) · K7: metin_gitti_deger_yok (ihtiyac_atlandi) · K8: dogru_gitti |
| gec-mesaj-kabul | lu-tr-hairdryer | amenities | K6: dogru_acik_kaldi (already_answered) · K7: acik_kalmaliyken_cevaplandi (oge_yanlis_kapandi) · K8: dogru_acik_kaldi (parca_no_info) |

## İhtiyacı olmayan senaryolar (autoSend beklentisi; ihtiyaç toplamlarına girmez)

| koşu | sonuç | sebep | satır |
|---|---|---|---|
| 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman | dogru_tutuldu | already_answered | 5 |
| 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman | dogru_tutuldu | closing_ack_open | 3 |
| 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman | dogru_tutuldu | items_nothing_answered | 3 |
| 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman | dogru_tutuldu | low_confidence | 3 |
| 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman | dogru_tutuldu | reply_output_veto | 1 |
| 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman | gitmemeliyken_gitti | gec_tur_acildi_gonderildi | 3 |
| 2026-11-26-gpt-5.1-kor-s2-acik | dogru_tutuldu | already_answered | 5 |
| 2026-11-26-gpt-5.1-kor-s2-acik | dogru_tutuldu | closing_ack_open | 3 |
| 2026-11-26-gpt-5.1-kor-s2-acik | dogru_tutuldu | items_nothing_answered | 1 |
| 2026-11-26-gpt-5.1-kor-s2-acik | dogru_tutuldu | low_confidence | 5 |
| 2026-11-26-gpt-5.1-kor-s2-acik | dogru_tutuldu | reply_output_veto | 1 |
| 2026-11-26-gpt-5.1-kor-s2-acik | gitmemeliyken_gitti | gec_tur_acildi_gonderildi | 3 |
| 2026-11-26-gpt-5.1-kor-s2-kapali | dogru_tutuldu | already_answered | 16 |
| 2026-11-26-gpt-5.1-kor-s2-kapali | dogru_tutuldu | low_confidence | 2 |

