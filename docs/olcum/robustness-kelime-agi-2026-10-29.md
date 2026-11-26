# Sağlamlık — sözcük ağları, temiz / bozuk (kol 1, modelsiz) — 2026-10-29

Temel: 40 mesaj, tr en de fr es ru ar. Hüküm: acil → erişim kaybı → şikâyet → yok.
Temel doğruluk: 98% (39/40)

| bozulma | değişmezlik (bozuk = temel) | doğruluk (bozuk = olması gereken) |
|---|---|---|
| P1 | 100% (40/40) | 98% (39/40) |
| P3u | 100% (40/40) | 98% (39/40) |
| P3l | 100% (40/40) | 98% (39/40) |
| P4 | 100% (40/40) | 98% (39/40) |
| P5 | 68% (27/40) | 65% (26/40) |
| P11 | 65% (26/40) | 63% (25/40) |

## Dile göre (P11 = noktalama yok + aksansız + yazım hatası + küçük harf)
| dil | temel doğru | P5 doğru | P11 doğru |
|---|---|---|---|
| tr | 93% (13/14) | 71% (10/14) | 64% (9/14) |
| en | 100% (8/8) | 75% (6/8) | 75% (6/8) |
| de | 100% (4/4) | 50% (2/4) | 50% (2/4) |
| fr | 100% (4/4) | 50% (2/4) | 50% (2/4) |
| es | 100% (4/4) | 50% (2/4) | 50% (2/4) |
| ru | 100% (3/3) | 67% (2/3) | 67% (2/3) |
| ar | 100% (3/3) | 67% (2/3) | 67% (2/3) |

## Hükmü değişen vakalar
| id | olması gereken | temel | bozulma | bozuk metin | bozuk hüküm |
|---|---|---|---|---|---|
| tr-complaint-dirty | complaint | complaint | P5 | Daire çok kiri, banyoda saç var. | none |
| tr-lost-key | access | access | P11 | anathari kaybettim ne yapmaliyiz | none |
| tr-ac-broken | complaint | complaint | P11 | klima clismiyor icerisi cok sicak | none |
| tr-flood | emergency | emergency | P11 | banyoyu su batsi prize dogru geliyor | none |
| tr-lockbox-empty | access | access | P5 | Anahtra kutusu boş, kapıdayız. | none |
| tr-lockbox-empty | access | access | P11 | aanhtar kutusu bos kapidayiz | none |
| tr-locked-out-kids | emergency | emergency | P5 | Kapıda kilili kaldık, çocuklar yanımda. | none |
| en-lost-key | access | access | P11 | i lost my kys and we are outside | none |
| en-ac-broken | complaint | complaint | P5 | The AC is not wokring and it's really hot. | none |
| en-locked-myself-out | access | access | P5 | I lockd myself out. | none |
| en-locked-myself-out | access | access | P11 | i lockde myself out | none |
| de-lost-key | access | access | P5 | Ich habe meinen Schlüssel verolren. | none |
| de-lost-key | access | access | P11 | ich habe meinen schlussel verlroen | none |
| de-heating | complaint | complaint | P5 | Die Heizung funktionirt nicht. | none |
| de-heating | complaint | complaint | P11 | die heizung funktionietr nicht | none |
| fr-lost-key | access | access | P5 | J'ai predu la clé de l'appartement. | none |
| fr-lost-key | access | access | P11 | j'ai predu la cle de l'appartement | none |
| fr-heating | complaint | complaint | P5 | Le chauffage ne focntionne pas. | none |
| fr-heating | complaint | complaint | P11 | le chauffage ne foctionne pas | none |
| es-lost-key | access | access | P11 | he perdido la llaev del apartamento | none |
| es-fire | emergency | emergency | P5 | Hay fego en la cocina, ayuda. | none |
| es-ac | complaint | complaint | P5 | El aire acondicionado no funcioan. | none |
| es-ac | complaint | complaint | P11 | el aire acondicionado no fnciona | none |
| ru-lost-key | access | access | P5 | Я потерля ключ от квартиры. | none |
| ru-fire | emergency | emergency | P11 | в квартире поар | none |
| ar-lost-key | access | access | P11 | فقدت مفتح الشقة | none |
| ar-fire | emergency | emergency | P5 | يوجد حيرق في المطبخ! | none |
