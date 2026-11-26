# Neden defteri — özet

Kaynak: `docs/olcum/neden-defteri.jsonl` (ihtiyaç başına bir satır; ihtiyacı olmayan senaryoda senaryo başına). Bu dosya her
`node scripts/neden-defteri.mjs ozet` çalıştırmasında YENİDEN üretilir — elle düzenlemeyin. Alanlar ve sınırlar:
`docs/TASARIM-2026-11-26-neden-defteri.md`.

Koşu 8 · satır 761 (ihtiyaç 707) · kusurlu satır (tutma / yanlış) 193 · sebebi "bilinmiyor" 0 (0%)

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

Bütün koşularda açık: AI_ACCESS_CODE_COMPLETE_ENABLED · AI_ASSISTANT_QUESTION_ITEM_ENABLED · AI_CODE_GREETING_ENABLED · AI_COMPLAINT_FOLLOWUP_RULE_ENABLED · AI_CONVERSATION_ITEMS_ENABLED · AI_HOST_DECISION_HOLD_ENABLED · AI_HOUSE_RULES_SHADOW · AI_KB_FEE_RULE_ENABLED · AI_NO_APOLOGY_RULE_ENABLED · AI_STAY_GUARD_ENABLED · AI_UNDERSTANDING_ENABLED · AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED · AI_UNDERSTANDING_PRIVACY_RULE_ENABLED · KB_RERANK_ENABLED · KB_SEMANTIC_RETRIEVAL

## Sebep × katman × koşu (yalnız kusurlu satırlar: tutma, metin gitti değer yok, yanlış, açık kalmalıyken cevaplandı)

Koşu sütunları: K1 = 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · K2 = 2026-11-26-gpt-5.1-kor-dayanak-g2-katman · K3 = 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · K4 = 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman · K5 = 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman-2 · K6 = 2026-11-26-gpt-5.1-kor-s2-kapali · K7 = 2026-11-26-gpt-5.1-kor-s2-acik · K8 = 2026-11-26-gpt-5.1-kor-s2-acik-parca-katman

| katman | sebep | toplam | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|---|---|---|---|---|---|---|---|---|---|---|
| cevap_modeli | yasak_desen_gitti | 33 | 19 | 11 | 1 | 1 | 1 | 0 | 0 | 0 |
| okuyucu | reader_binding | 26 | 0 | 0 | 10 | 9 | 7 | 0 | 0 | 0 |
| parca_dogrulama | polarity_mismatch | 25 | 0 | 0 | 6 | 8 | 10 | 0 | 0 | 1 |
| konaklama_bekcisi | availability_unconfirmed | 23 | 5 | 5 | 3 | 4 | 5 | 0 | 0 | 1 |
| cikti_kapisi | reply_absence | 15 | 8 | 6 | 1 | 0 | 0 | 0 | 0 | 0 |
| cikti_kapisi | reply_pet_policy | 14 | 3 | 3 | 3 | 3 | 2 | 0 | 0 | 0 |
| tur_kapisi | already_answered | 11 | 0 | 0 | 0 | 0 | 0 | 11 | 0 | 0 |
| parca_dogrulama | value_not_in_evidence | 8 | 0 | 0 | 2 | 1 | 2 | 0 | 0 | 3 |
| tur_kapisi | gec_tur_acildi_gonderildi | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| cevap_modeli | eksik_deger_kapandi | 5 | 1 | 0 | 0 | 1 | 0 | 1 | 1 | 1 |
| cevap_modeli | model_risk_label | 5 | 2 | 0 | 2 | 1 | 0 | 0 | 0 | 0 |
| cikti_kapisi | reply_output_veto | 4 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| dil | reply_language_mismatch | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 1 |
| okuyucu | reader_not_answered | 4 | 0 | 0 | 2 | 1 | 1 | 0 | 0 | 0 |
| cevap_modeli | ihtiyac_atlandi | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 |
| cevap_modeli | oge_yanlis_kapandi | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| konaklama_bekcisi | price_claim | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| cevap_modeli | low_confidence | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| olcer | dogrulanan_parca_deger_eslesmedi | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Sonuç × katman

| sonuç | katman | satır |
|---|---|---|
| acik_kalmaliyken_cevaplandi | cevap_modeli | 36 |
| gereksiz_tutuldu | cikti_kapisi | 33 |
| gereksiz_tutuldu | okuyucu | 26 |
| gereksiz_tutuldu | konaklama_bekcisi | 25 |
| gereksiz_tutuldu | parca_dogrulama | 25 |
| gereksiz_tutuldu | tur_kapisi | 11 |
| metin_gitti_deger_yok | parca_dogrulama | 8 |
| gereksiz_tutuldu | cevap_modeli | 6 |
| gitmemeliyken_gitti | tur_kapisi | 6 |
| yanlis_gitti | cevap_modeli | 5 |
| gereksiz_tutuldu | dil | 4 |
| metin_gitti_deger_yok | okuyucu | 4 |
| metin_gitti_deger_yok | cevap_modeli | 3 |
| metin_gitti_deger_yok | olcer | 1 |

## En sık 15 sebep — örnekler

### yasak_desen_gitti (cevap_modeli) — 33
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · nt4 · amenities · acik_kalmaliyken_cevaplandi: giden metinde bu ihtiyacın yasak deseni var · çıktı kapıları geçirdi — misafir: "Havuzda havlu veriliyor mu? Bir de çöpleri nereye atıyoruz?" → giden: "Merhaba Alex, Havuzda havlu hizmetimiz yok, yanınızda getirmeniz gerekiyor. Çöpleri ise b…"
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · nt5 · amenities · acik_kalmaliyken_cevaplandi: giden metinde bu ihtiyacın yasak deseni var · çıktı kapıları geçirdi — misafir: "Est-ce que la piscine est chauffée ?" → giden: "Bonjour Alex, La piscine du site est une piscine extérieure ouverte du 1er juin au 30 sep…"

### reader_binding (okuyucu) — 26
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · hp3 · access_keys · gereksiz_tutuldu: kodun gördüğü: subject_missing — misafir: "Können wir am Abreisetag bis 14 Uhr bleiben? Und wo finden wir den Schlüssel?" → parça: "Den Schlüssel finden Sie in der Schlüssebox direkt neben der Wohnungstür."
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · hp10 · wifi · gereksiz_tutuldu:  — misafir: "Wir würden gern zwei Nächte verlängern. Wie lautet das WLAN-Passwort?" → parça: "Das WLAN-Netzwerk heißt "Lale_Terrace", das Passwort ist "olive2026"."

### polarity_mismatch (parca_dogrulama) — 25
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · nt6 · parking · gereksiz_tutuldu:  — misafir: "Is there an iron I could use? And where can we park the car?" → parça: "You can park your car on the free street parking in front of the building; there is no co…"
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · en1 · parking · gereksiz_tutuldu: kodun gördüğü: subject_missing,unsupported_content — misafir: "Kapalı otopark var mı?" → parça: "Binanın önünde ücretsiz sokak üzeri park yeri bulunuyor, ancak kapalı otopark yok."

### availability_unconfirmed (konaklama_bekcisi) — 23
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · en8 · house_rules · gereksiz_tutuldu: risk gerekçesi · bekçi none/none (-) — misafir: "Можно ли устроить небольшую вечеринку в квартире?" → taslak: "Здравствуйте, Alex! К сожалению, проводить вечеринки и любые мероприятия в квартире не ра…"
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp2 · directions_transport · gereksiz_tutuldu: risk gerekçesi · bekçi early_checkin/defers (early_checkin) — misafir: "Could we check in around 11am? Also, what's the exact address?" → taslak: "Hello Alex, Our standard check-in time is 15:00, so an 11:00 arrival would be an early ch…"

### reply_absence (cikti_kapisi) — 15
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · nt2 · wifi · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "Is there a gym in the complex? Also what's the wifi password?" → taslak: "Hello Alex, There is no gym information listed for the complex in the details I have. The…"
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · or1b · checkout_time · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "What time is check-out? And is there a sauna?" → taslak: "Hello Alex, Check-out time is 11:00. There is no information about a sauna in the apartme…"

### reply_pet_policy (cikti_kapisi) — 14
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp1 · wifi · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "Merhaba, küçük köpeğimizi getirebilir miyiz? Wi-Fi şifresi nedir?" → taslak: "Merhaba Alex, Wi-Fi ağ adı "LaleBahce_5G", şifre "menekse2024"."
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp5 · checkout_time · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "¿Podemos llevar a nuestro gato? ¿A qué hora es la salida?" → taslak: "Hola Alex, La hora de salida es a las 11:00."

### already_answered (tur_kapisi) — 11
- 2026-11-26-gpt-5.1-kor-s2-kapali · lnq-tr-parking · parking · gereksiz_tutuldu: geç mesajın turu açılmadı (anahtar kapalı ya da şart dışı) — misafir: "otopark var mı arabayla geliyoruz" → taslak
- 2026-11-26-gpt-5.1-kor-s2-kapali · lnq-tr-laundry · amenities · gereksiz_tutuldu: geç mesajın turu açılmadı (anahtar kapalı ya da şart dışı) — misafir: "çamaşır makinesi var mı peki? deterjan getirmemiz lazım mı" → taslak

### value_not_in_evidence (parca_dogrulama) — 8
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · or1a · checkout_time · gereksiz_tutuldu:  — misafir: "Is there a sauna? And what time is check-out?" → parça: "Check-out time is 11:00."
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · m5 · directions_transport · gereksiz_tutuldu: kodun gördüğü: subject_missing,value_bound_elsewhere,unsupported_content — misafir: "¿Dónde está la parada de autobús, cómo se llama la red wifi y se puede hacer barbacoa en …" → parça: "La parada de autobús está a unos 150 metros del edificio y la línea 12 va al casco anti…

### gec_tur_acildi_gonderildi (tur_kapisi) — 6
- 2026-11-26-gpt-5.1-kor-s2-acik · ld-tr-repeat-checkin · gitmemeliyken_gitti: geç mesajın turu açıldı ve cevap gitti; beklenti 'gitmez' — misafir: "kaçta girebiliyoruz eve" → giden: "Eve girişiniz 15:00'ten itibaren mümkün. (Bu yanıt otomatik asistan tarafından hazırlandı…"
- 2026-11-26-gpt-5.1-kor-s2-acik · ld-fr-repeat-parking · gitmemeliyken_gitti: geç mesajın turu açıldı ve cevap gitti; beklenti 'gitmez' — misafir: "on peut garer la voiture où ?" → giden: "Vous pouvez garer votre voiture sur le parking réservé à nos invités derrière l’immeuble.…"

### eksik_deger_kapandi (cevap_modeli) — 5
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · c4 · appliance_help · yanlis_gitti: beklenen değer metinde yok, öğe 'cevaplandı' kapandı · çıktı kapıları geçirdi — misafir: "Où se trouve la télécommande de la climatisation ?" → giden: "Bonjour Alex, Klima kumandası TV ünitesinin çekmecesinde bulunuyor. (Cette réponse a été …"
- 2026-11-26-gpt-5.1-kor-dayanak-g4-parca-katman · c4 · appliance_help · yanlis_gitti: beklenen değer metinde yok, öğe 'cevaplandı' kapandı · parça doğrulandı (kod + okuyucu geçirdi) — misafir: "Où se trouve la télécommande de la climatisation ?" → giden: "Bonjour Alex, Klima kumandası TV ünitesinin çekmecesinde bulunuyor. (Cette réponse a été …"

### model_risk_label (cevap_modeli) — 5
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · m7 · local_recommendations · gereksiz_tutuldu: model etiketi: niyet general · risk medium/rule_violation · güven 0.9 — misafir: "What time does the bakery open, where's the iron, and can we have a couple of friends vis…" → taslak: "Hello Alex, The bakery across the building opens at 06:30 in the morning. The iron and…
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · m7 · amenities · gereksiz_tutuldu: model etiketi: niyet general · risk medium/rule_violation · güven 0.9 — misafir: "What time does the bakery open, where's the iron, and can we have a couple of friends vis…" → taslak: "Hello Alex, The bakery across the building opens at 06:30 in the morning. The iron and…

### reply_output_veto (cikti_kapisi) — 4
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · hp10 · wifi · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "Wir würden gern zwei Nächte verlängern. Wie lautet das WLAN-Passwort?" → taslak: "Hallo Alex, Das WLAN-Netzwerk heißt "Lale_Terrace" und das Passwort ist "olive2026". Eine…"
- 2026-11-26-gpt-5.1-kor-dayanak-g2-katman · or1b · checkout_time · gereksiz_tutuldu: giden metin kod kapısına takıldı, bütün tur tutuldu — misafir: "What time is check-out? And is there a sauna?" → taslak: "Hello Alex, Check-out time is 11:00. Regarding a sauna, this is the host’s decision; your…"

### reply_language_mismatch (dil) — 4
- 2026-11-26-gpt-5.1-kor-dayanak-g1-bugun · en6 · cleaning_linen · gereksiz_tutuldu: risk gerekçesi — misafir: "¿Ponéis toallas de playa?" → taslak: "Hola Alex, Plaj havlusu sağlamıyorum, sadece banyo havluları ve nevresimler bulunuyor."
- 2026-11-26-gpt-5.1-kor-dayanak-g2-katman · en6 · cleaning_linen · gereksiz_tutuldu: risk gerekçesi — misafir: "¿Ponéis toallas de playa?" → taslak: "Hola Alex, Plaj havlusu sağlamıyorum; dairede yalnız banyo havlusu ve nevresimler mevcut."

### reader_not_answered (okuyucu) — 4
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · t2 · wifi · gereksiz_tutuldu:  — misafir: "Wie ist das WLAN-Passwort, und gibt es eine Waschmaschine?" → parça: "Das WLAN-Netz heißt "LaleNest", das Passwort ist "sunflower88"."
- 2026-11-26-gpt-5.1-kor-dayanak-g3-parca · t6 · access_keys · gereksiz_tutuldu: kodun gördüğü: subject_missing — misafir: "¿Hay lavavajillas? ¿Cuál es el código de la caja de llaves?" → parça: "La caja de llaves está junto a la puerta y el código se envía la mañana del día de llegad…"

### ihtiyac_atlandi (cevap_modeli) — 3
- 2026-11-26-gpt-5.1-kor-s2-kapali · lpn-tr-trash-market · trash · metin_gitti_deger_yok: tur gitti; cevap bu ihtiyacı taşımıyor (modelin cevapladım dediği: ["R1"]) — misafir: "çöpü nereye atıcaz" → giden: "En yakın market yaklaşık 3 dakika yürüme mesafesinde, her gün 07:00–23:00 saatleri arasın…"
- 2026-11-26-gpt-5.1-kor-s2-kapali · lpn-en-iron-beach · amenities · metin_gitti_deger_yok: tur gitti; cevap bu ihtiyacı taşımıyor (modelin cevapladım dediği: ["R1"]) — misafir: "is there an iron?" → giden: "The seaside promenade in Moda is about an 8-minute walk from the apartment. (This reply w…"

## "Bilinmiyor" kalanlar

Yok.

## Ölçer şüphesi işaretleri (sonucu değiştirmez; satır elle incelenir)

| işaret | satır |
|---|---|
| eslesme_tahmini | 40 |
| atlandi_mi_yanlis_mi_ayirt_edilemez | 16 |
| bilgi_yok_anlatimi_olasi | 6 |
| dil_olcusu_uyusmuyor | 5 |
| eslesme_tur_adina_dayali | 3 |
| metin_sessiz_is_kapandi | 3 |
| olcer_deseni_eslesmedi | 1 |

## Koşular arası değişen ihtiyaçlar (aynı set türü + senaryo + ihtiyaç, sonucu koşudan koşuya farklı)

| set türü | senaryo | ihtiyaç | koşu → sonuç (sebep) |
|---|---|---|---|
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

