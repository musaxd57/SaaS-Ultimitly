# Cevap tekrarı — benzerlik ölçümü (geliştirme seti)

Set: `evals/answer-reuse-2026-10-23.json` · 10 grup · 90 soru · 170 çift (aynı 38 · yakın 42 · alakasız 90) · gömme text-embedding-3-small · anlama gpt-5.1

| yöntem | eşik | doğru tekrar (aynı ihtiyaç) | 🚨 yanlış tekrar (yakın / alakasız) |
|---|---|---|---|
| ham metin benzerliği | 0.5 | 16/38 | 31/132 |
| ham metin benzerliği | 0.55 | 12/38 | 26/132 |
| ham metin benzerliği | 0.6 | 8/38 | 18/132 |
| ham metin benzerliği | 0.65 | 5/38 | 13/132 |
| ham metin benzerliği | 0.7 | 5/38 | 9/132 |
| ham metin benzerliği | 0.75 | 3/38 | 3/132 |
| ham metin benzerliği | 0.8 | 1/38 | 2/132 |
| ham metin benzerliği | 0.85 | 0/38 | 1/132 |
| ham metin benzerliği | 0.9 | 0/38 | 0/132 |
| anlama sorgusu benzerliği | 0.5 | 38/38 | 40/132 |
| anlama sorgusu benzerliği | 0.55 | 38/38 | 32/132 |
| anlama sorgusu benzerliği | 0.6 | 38/38 | 21/132 |
| anlama sorgusu benzerliği | 0.65 | 38/38 | 15/132 |
| anlama sorgusu benzerliği | 0.7 | 38/38 | 10/132 |
| anlama sorgusu benzerliği | 0.75 | 32/38 | 6/132 |
| anlama sorgusu benzerliği | 0.8 | 26/38 | 3/132 |
| anlama sorgusu benzerliği | 0.85 | 22/38 | 1/132 |
| anlama sorgusu benzerliği | 0.9 | 19/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.5 | 27/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.55 | 27/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.6 | 27/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.65 | 27/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.7 | 27/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.75 | 25/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.8 | 23/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.85 | 22/38 | 0/132 |
| sorgu benzerliği + kod kapısı | 0.9 | 19/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.5 | 12/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.55 | 9/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.6 | 5/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.65 | 3/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.7 | 3/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.75 | 3/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.8 | 1/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.85 | 0/38 | 0/132 |
| ham benzerlik + kod kapısı | 0.9 | 0/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.5 | 8/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.55 | 8/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.6 | 8/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.65 | 8/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.7 | 8/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.75 | 7/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.8 | 6/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.85 | 6/38 | 0/132 |
| sorgu + kapı + AYNI DİL (ilk dilim) | 0.9 | 4/38 | 0/132 |

## En benzer YAKIN (farklı ihtiyaç) çiftler

| çapa | soru | ham | sorgu | kapı |
|---|---|---|---|---|
| Köpeğimizi getirebilir miyiz? | Kedi getirebilir miyiz? | 0.702 | 0.867 | terms_not_covered |
| Kahvaltı var mı? | Fiyata kahvaltı dahil mi? | 0.732 | 0.843 | condition_mismatch |
| Kahvaltı var mı? | Is breakfast included? | 0.563 | 0.843 | condition_mismatch |
| Havuz kaçta kapanıyor? | Havuz cumartesi kaçta kapanıyor? | 0.779 | 0.794 | condition_mismatch |
| Kahvaltı var mı? | Kahvaltı kaçta? | 0.842 | 0.764 | aspect_not_answered |
| Köpeğimizi getirebilir miyiz? | Köpeği evde yalnız bırakabilir miyiz? | 0.738 | 0.751 | condition_mismatch |
| Giriş saat kaçta? | Gece 2'de varırsak sorun olur mu? | 0.395 | 0.730 | terms_not_covered |
| Kahvaltı var mı? | Kahvaltıyı odaya getirebilir misiniz? | 0.715 | 0.727 | terms_not_covered |
| Giriş saat kaçta? | Saat 11'de gelsek olur mu? | 0.565 | 0.697 | kind_not_reusable |
| Çıkış saat kaçta? | 13:00'te çıkabilir miyiz? | 0.583 | 0.682 | kind_not_reusable |
| Köpeğimizi getirebilir miyiz? | Köpek için ek ücret var mı? | 0.569 | 0.671 | terms_not_covered |
| Otopark var mı? | Otopark ücretli mi? | 0.860 | 0.666 | terms_not_covered |
| Wi-Fi şifresi neydi? | Wi-Fi ağının adı ne? | 0.686 | 0.658 | terms_not_covered |
| Çıkış saat kaçta? | Cumartesi çıkış saati farklı mı? | 0.645 | 0.636 | condition_mismatch |
| Havuz kaçta kapanıyor? | Sauna kaçta kapanıyor? | 0.576 | 0.631 | terms_not_covered |
| Klima nasıl çalışıyor? | Can you fix the air conditioner? | 0.320 | 0.624 | kind_not_reusable |
| Giriş saat kaçta? | Erken giriş yapabilir miyiz? | 0.635 | 0.617 | kind_not_reusable |
| Çöpleri nereye atıyoruz? | Çöp çok kötü kokuyor, alır mısınız? | 0.481 | 0.616 | terms_not_covered |
| Çöpleri nereye atıyoruz? | Çöpleri hangi gün topluyorlar? | 0.739 | 0.612 | terms_not_covered |
| Havlu var mı? | Havluları değiştirebilir misiniz? | 0.491 | 0.596 | kind_not_reusable |

## En az benzer AYNI çiftler

| çapa | soru | ham | sorgu | kapı |
|---|---|---|---|---|
| Çöpleri nereye atıyoruz? | Çöp konteyneri nerede? | 0.599 | 0.730 | ok |
| Giriş saat kaçta? | Daireye en erken kaçta girebiliyoruz normalde? | 0.407 | 0.736 | terms_not_covered |
| Çöpleri nereye atıyoruz? | Atıkları nerede bırakabiliriz? | 0.720 | 0.737 | terms_not_covered |
| Havlu var mı? | Do you provide towels? | 0.271 | 0.747 | ok |
| Köpeğimizi getirebilir miyiz? | Evcil hayvan kabul ediyor musunuz? | 0.477 | 0.748 | terms_not_covered |
| Köpeğimizi getirebilir miyiz? | Are pets allowed? | 0.384 | 0.748 | terms_not_covered |
| Giriş saat kaçta? | Kaçta yerleşebiliriz? | 0.350 | 0.770 | terms_not_covered |
| Havuz kaçta kapanıyor? | Until when is the pool open? | 0.298 | 0.776 | ok |
| Havlu var mı? | Havlu getirmemiz gerekiyor mu? | 0.764 | 0.777 | ok |
| Havuz kaçta kapanıyor? | Akşam havuza kaça kadar girebiliriz? | 0.644 | 0.785 | terms_not_covered |
| Klima nasıl çalışıyor? | Wie schalte ich die Klimaanlage ein? | 0.465 | 0.786 | kind_not_reusable |
| Klima nasıl çalışıyor? | Klimayı nasıl açıyoruz? | 0.723 | 0.795 | kind_not_reusable |
| Klima nasıl çalışıyor? | How do I turn on the AC? | 0.359 | 0.800 | kind_not_reusable |
| Havlu var mı? | Gibt es Handtücher? | 0.251 | 0.804 | ok |
| Çöpleri nereye atıyoruz? | Where do we put the garbage? | 0.476 | 0.823 | terms_not_covered |

## Kapının ret sebepleri (aynı / yakın)

| sebep | aynı | yakın + alakasız |
|---|---|---|
| ok | 27 | 0 |
| kind_not_reusable | 3 | 23 |
| condition_mismatch | 0 | 6 |
| kind_mismatch | 0 | 75 |
| terms_not_covered | 8 | 27 |
| aspect_not_answered | 0 | 1 |

## Anlama katmanının sorgusu

| grup | rol | soru | tür | sorgu |
|---|---|---|---|---|
| checkout_time | anchor | Çıkış saat kaçta? | checkout_time | çıkış saati check-out |
| checkout_time | same | Evi saat kaça kadar boşaltmamız gerekiyor? | checkout_time | çıkış saati checkout |
| checkout_time | same | Check-out time? | checkout_time | çıkış saati check-out |
| checkout_time | same | What time do we need to leave the apartment? | checkout_time | çıkış saati checkout |
| checkout_time | same | Wann ist der Check-out? | checkout_time | çıkış saati check-out |
| checkout_time | same | Во сколько выезд? | checkout_time | çıkış saati checkout |
| checkout_time | same | Son gün daireden en geç kaçta çıkmalıyız? | checkout_time | çıkış saati check-out |
| checkout_time | near | Çıkışı iki saat geciktirebilir miyiz? | late_checkout | geç çıkış talebi |
| checkout_time | near | 13:00'te çıkabilir miyiz? | late_checkout | geç çıkış saat 13:00 |
| checkout_time | near | Cumartesi çıkış saati farklı mı? | checkout_time | cumartesi çıkış saati |
| checkout_time | near | Çıkışta anahtarı nereye bırakalım? | access_keys | çıkışta anahtar teslimi nereye bırakılır |
| checkout_time | near | Can we have a late checkout? | late_checkout | geç çıkış talebi |
| trash | anchor | Çöpleri nereye atıyoruz? | trash | çöp atma noktası nereye |
| trash | same | Atıkları nerede bırakabiliriz? | trash | çöp atıkları nereye bırakılır |
| trash | same | Where do we put the garbage? | trash | çöp nereye atılır |
| trash | same | Çöp konteyneri nerede? | trash | çöp konteyneri yeri çöp atma |
| trash | same | Wo werfen wir den Müll weg? | trash | çöp atma noktası çöp kutusu |
| trash | near | Cam şişeler için ayrı kutu var mı? | trash | cam şişe geri dönüşüm çöp kutusu |
| trash | near | Çöp çok kötü kokuyor, alır mısınız? | trash | çöp alınması kötü koku |
| trash | near | Çöpleri hangi gün topluyorlar? | trash | çöp toplama günleri |
| trash | near | Is there recycling? | trash | geri dönüşüm çöp atık |
| wifi_password | anchor | Wi-Fi şifresi neydi? | wifi | wifi şifresi |
| wifi_password | same | İnternet şifresini alabilir miyim? | wifi | wifi internet şifresi |
| wifi_password | same | What's the wifi password? | wifi | wifi şifresi |
| wifi_password | same | WLAN Passwort bitte? | wifi | wifi şifresi |
| wifi_password | same | Пароль от вайфая? | wifi | wifi şifresi |
| wifi_password | near | Wi-Fi çalışmıyor, bağlanamıyoruz. | wifi | wifi çalışmıyor bağlantı sorunu |
| wifi_password | near | İnternet hızı ne kadar? | wifi | internet hızı wifi hızı |
| wifi_password | near | Wi-Fi ağının adı ne? | wifi | wifi ağı adı ssid |
| wifi_password | near | The wifi keeps disconnecting. | wifi | wifi kopuyor bağlantı sorunu |
| parking | anchor | Otopark var mı? | parking | otopark park yeri |
| parking | same | Arabayı nereye park edebiliriz? | parking | otopark park yeri |
| parking | same | Is there parking? | parking | otopark park yeri |
| parking | same | Gibt es einen Parkplatz? | parking | otopark park yeri |
| parking | same | Aracımızı bırakabileceğimiz bir yer var mı? | parking | otopark park yeri |
| parking | near | Otopark ücretli mi? | parking | otopark ücreti park yeri ücretli mi |
| parking | near | İki araba için yer var mı? | parking | iki araba için otopark park yeri |
| parking | near | Elektrikli araç şarj istasyonu var mı? | parking | elektrikli araç şarj istasyonu park yeri |
| parking | near | How much is parking per day? | parking | otopark günlük ücret fiyat |
| pool_hours | anchor | Havuz kaçta kapanıyor? | amenities | havuz çalışma saatleri kapanış saati |
| pool_hours | same | Havuz ne zamana kadar açık? | amenities | havuz çalışma saatleri ne zamana kadar açık |
| pool_hours | same | Until when is the pool open? | amenities | havuz açık olduğu saatler |
| pool_hours | same | Bis wann ist der Pool geöffnet? | amenities | havuz çalışma saatleri açık olduğu saatler |
| pool_hours | same | Akşam havuza kaça kadar girebiliriz? | amenities | havuz kullanım saatleri akşam |
| pool_hours | near | Havuz cumartesi kaçta kapanıyor? | amenities | havuz açılış kapanış saatleri cumartesi |
| pool_hours | near | Havuz ısıtmalı mı? | amenities | havuz ısıtmalı mı |
| pool_hours | near | Sauna kaçta kapanıyor? | amenities | sauna çalışma saatleri kaçta kapanıyor |
| pool_hours | near | Havuza çocuklar girebilir mi? | amenities | havuz kullanımı çocuklar |
| pool_hours | near | Is the pool open in winter? | amenities | havuz kışın açık mı |
| pets | anchor | Köpeğimizi getirebilir miyiz? | pets | evcil hayvan köpek kabul |
| pets | same | Evcil hayvan kabul ediyor musunuz? | pets | evcil hayvan kabul politikası |
| pets | same | Are pets allowed? | pets | evcil hayvan kabul politikası |
| pets | same | Dürfen wir unseren Hund mitbringen? | pets | evcil hayvan köpek kabul |
| pets | near | Kedi getirebilir miyiz? | pets | evcil hayvan kedi kabul |
| pets | near | Köpek için ek ücret var mı? | pets | köpek evcil hayvan ek ücret politikası |
| pets | near | Köpeği evde yalnız bırakabilir miyiz? | pets | evcil hayvan köpek yalnız bırakma |
| pets | near | Is there a dog park nearby? | local_recommendations | yakındaki köpek parkı |
| checkin_time | anchor | Giriş saat kaçta? | checkin_time | giriş saati check-in |
| checkin_time | same | Kaçta yerleşebiliriz? | checkin_time | giriş saati yerleşme |
| checkin_time | same | What time is check-in? | checkin_time | giriş saati check-in |
| checkin_time | same | Ab wann können wir einchecken? | checkin_time | giriş saati check-in |
| checkin_time | same | Daireye en erken kaçta girebiliyoruz normalde? | checkin_time | giriş saati en erken saat |
| checkin_time | near | Erken giriş yapabilir miyiz? | early_checkin | erken giriş |
| checkin_time | near | Saat 11'de gelsek olur mu? | early_checkin | erken giriş saat 11 |
| checkin_time | near | Gece 2'de varırsak sorun olur mu? | checkin_time | gece geç giriş saati |
| checkin_time | near | Bavulları erken bırakabilir miyiz? | luggage | erken bavul bırakma bagaj bırakma |
| breakfast | anchor | Kahvaltı var mı? | amenities | kahvaltı var mı |
| breakfast | same | Gibt es Frühstück? | amenities | kahvaltı var mı |
| breakfast | same | Is there breakfast? | amenities | kahvaltı var mı |
| breakfast | same | Sabahları kahvaltı veriliyor mu? | amenities | kahvaltı var mı |
| breakfast | near | Kahvaltı kaçta? | amenities | kahvaltı saati |
| breakfast | near | Fiyata kahvaltı dahil mi? | amenities | kahvaltı dahil mi |
| breakfast | near | Is breakfast included? | amenities | kahvaltı dahil mi |
| breakfast | near | Glutensiz kahvaltı hazırlanabilir mi? | amenities | glutensiz kahvaltı imkanları |
| breakfast | near | Kahvaltıyı odaya getirebilir misiniz? | amenities | kahvaltı odaya servis |
| towels | anchor | Havlu var mı? | amenities | havlu var mı |
| towels | same | Do you provide towels? | amenities | havlu mevcut mu |
| towels | same | Havlu getirmemiz gerekiyor mu? | amenities | havlu sağlanıyor mu |
| towels | same | Gibt es Handtücher? | amenities | havlu var mı sağlanıyor mu |
| towels | near | Havluları değiştirebilir misiniz? | cleaning_linen | havlu değişimi temizlik |
| towels | near | Plaj havlusu var mı? | amenities | plaj havlusu var mı |
| towels | near | Havlular kirli geldi. | complaint_issue | kirli havlu şikayet |
| ac_use | anchor | Klima nasıl çalışıyor? | appliance_help | klima kullanım talimatı |
| ac_use | same | How do I turn on the AC? | appliance_help | klima açma kullanma |
| ac_use | same | Klimayı nasıl açıyoruz? | appliance_help | klima kullanımı açma kapama |
| ac_use | same | Wie schalte ich die Klimaanlage ein? | appliance_help | klima klima açma kullanma |
| ac_use | near | Klima çalışmıyor. | complaint_issue | klima arızası çalışmıyor |
| ac_use | near | Klima kumandası nerede? | appliance_help | klima kumandası nerede |
| ac_use | near | Klima su damlatıyor. | complaint_issue | klima su damlatıyor arıza |
| ac_use | near | Can you fix the air conditioner? | complaint_issue | klima arızası tamir |
