# Sözlük — belirsiz tek kelime ölçümü (2026-09-26)

> Kaynak: dış inceleme (ChatGPT, `lexicon.ts`) + kurucu kararı "ikisi birden" (önce dar sözlük düzeltmesi, sonra
> embedding ölçümü; anlamsal aramayı açma kararı kurucuda). Kod: `src/lib/ai/retrieval/lexicon.ts` (`expandOnly`),
> saat alanı sezgisi `time-fields.ts` (`matchConcepts(…, {loose})`). Test: `tests/unit/kb-retrieval-lexicon-ambiguity.test.ts`.

## Kapsam ve sınır

- Etki yalnız **30 kalemi ya da 24 bin karakteri aşan** bilgi tabanında. Küçük bilgi tabanında seçim yapılmaz, tamamı
  isteme gider (sözlük hiçbir şeyi değiştirmez).
- Güvenlik açığı değil, **arama kalitesi**: yanlış kavram fazladan kalem getirir, bazen doğru kalemin önüne geçer.
- Canlıda anlama katmanı açık: misafirin sorusu (her dilde) Türkçe arama sorgusuna yeniden yazılır. Sözlük onun
  yanında deterministik yedektir.

## Önce / sonra (40 kalemlik bilgi tabanı, üretim seçicisi)

| Misafir mesajı | Önce: tetiklenen kavram | Önce: istemde (sırayla) | Sonra: kavram | Sonra: istemde |
|---|---|---|---|---|
| Daire çok sıcak | klima, **sıcak su** | sıcak su, klima, … | klima | sıcak su, klima, … ¹ |
| Power outage in the apartment | **su kesintisi**, elektrik | elektrik, **su kesintisi** | elektrik | **yalnız elektrik** |
| Elektrik kesintisi var | **su kesintisi**, elektrik | elektrik, su kesintisi | elektrik | elektrik, su kesintisi ¹ |
| Bagajlarımızı depoya bırakabilir miyiz? | **su kesintisi** | bagaj, su kesintisi | — | bagaj, su kesintisi ¹ |
| Eşyalarımızı girişten önce bırakabilir miyiz? | giriş, **kayıp eşya** | bagaj, kayıp eşya, … | giriş | bagaj, kayıp eşya ¹ |
| Daireye merdivenle mi çıkılıyor? | **yangın** | **yangın**, alarm, asansör | — | **asansör** önce |
| Alarm kodu ne? | şifre, **yangın** | **yangın**, alarm | şifre | **alarm** önce |

¹ Kalan gürültü sözlükten değil, kelimenin kalemin METNİNDE geçmesinden (BM25): "sıcak" sıcak su kaleminde,
"kesinti" / "depo" su kesintisi kaleminde, "eşya" kayıp eşya kaleminde yazıyor. Bunu sözlük çözemez; anlamsal arama
(embedding) ya da anlama katmanının sorgusu çözer.

**Geri çağırma kaybı yok** (kalıplarla): "Sıcak su gelmiyor", "Suyun sıcağı gelmiyor", "Su kesintisi var mı?", "No
water…", "water outage", "Su deposu var mı?", "Duman alarmı ötüyor", "Smoke alarm is beeping", "Yangın merdiveni
nerede?", "Eşyamı unuttum", "I left something" → doğru kavram. Saat alanı kuralı birebir aynı ("Giriş" başlıklı
kalemde "Merdiven kapısı 23:00'te kilitlenir" giriş saati sayılmaz).

Kanıt: kırmızı-önce 30 testin 10'u eski sözlükte düşer. Retrieval + ölçek + saat alanı testleri 17 dosyada 366 test
yeşil. Mutasyonda 14 mutantın 13'ü öldü. Yaşayan L11 ("water outage" kalıbını silmek) eşdeğer mutant; nedeni ↓.

## Tipli kalıp eşleştirici (kurucu onayı: "B + C + tipli eşleştirici", aynı gün)

Çok kelimeli `detectOnly` kalıpları durak sözcükleri ("çok", "no", "how to") düşürüyor ve **tek kelimeye** iniyordu.
Artık her sözlük kaydının türü belli: terim (tespit + genişletme) · yalnız tespit · yalnız genişletme · **birebir kalıp**
(`phrases`: durak sözcükler korunur, içerik sözcükleri kök alınır — "Oda çok sıcaktı" yine eşleşir). Tek kelimeye inen
kayıt test tarafından reddedilir (`lexiconProblems`, 17 kayıt düzeltildi: 4'ü birebir kalıp, 4'ü aynı davranışı açık
yazan tek kelime, 9'u zaten var olan terimin tekrarıydı → silindi).

| Misafir mesajı | Önce | Sonra |
|---|---|---|
| Sıcak su gelmiyor · Duşun suyu sıcak değil · Dairede sıcak su yok | klima + sıcak su | yalnız sıcak su |
| Su soğuk akıyor | ısıtma | — |
| Is there hot water? · Is the tap water drinkable? | su kesintisi | — (sıcak su sorusu yalnız sıcak su) |
| Where can I get groceries? | adres + market | yalnız market |
| Can you check the AC? | giriş + klima | yalnız klima |
| Daire çok sıcak · Oda çok sıcaktı / Oda çok soğuk / There is no water / How do I get there? | klima / ısıtma / su kesintisi / adres | aynı (geri çağırma korunur) |

"check" kalıptan değil kök sökücüden geliyordu: "checkin" Türkçe "-in" eki sanılıp "check"e iniyordu. Kök korundu
("checkinler" → "checkin"); "checking in" birebir kalıbı eklendi. Yan etki (doğru yönde): İngilizce bilgi tabanında
"Check the heating before 22:00." artık GİRİŞ saati sayılmıyor — eskiden mülk ayarıyla sahte saat çelişkisi üretip giriş
sorularında gereksiz devre yol açabiliyordu. Saat alanı kuralının "başka konu" sezgisi kalıpların içerik sözcüklerini
yine görür ("Get the keys at 15:00." giriş başlığında yine ödünç alınmaz).

Kanıt: kırmızı-önce 38 testin 15'i eski kodda düşer; retrieval + ölçek + saat alanı + kapı testleri 19 dosyada 426 test
yeşil; mutasyon 16/16 (ilk koşuda sözleşmenin "yalnız genişletme" dalı pinsizdi → test eklendi).

## Dokunulmayan iki kök çakışması (kurucuya soruldu)

| Kök | Yanlış tetikleme | Not |
|---|---|---|
| "parking" → **park** | "Yakında park var mı?" (yeşil alan) → otopark | Çoğu zaman otopark kastediliyor; bırakıldı |
| "giriş" → **gir** | "Havuza girebilir miyiz?" → giriş | "Kaçta girebilirim?" de aynı kökten bulunuyor; ayırmak kalıp ister |
