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

## Yeni bulgu: kalıp sanılan tek kelimeler (KURUCU KARARI BEKLİYOR)

Çok kelimeli `detectOnly` kalıpları durak sözcükleri ("çok", "no", "when can i", "how to", "nereye") düşürüyor.
Sonuçta kalıp **tek bir kelimeye** iniyor ve o kelime geçen her soru kavramı tetikliyor. Aşağıdakiler bugünkü
davranış; hiçbiri değiştirilmedi.

| Kalıp → iniyor | Yanlış tetikleme örneği | Seçenek |
|---|---|---|
| "çok sıcak" → **sıcak** (klima) | "Sıcak su gelmiyor", "Duşun suyu sıcak değil" → klima | (a) aynen bırak · (b) "daire/oda/ev sıcak" kalıpları ("Dairede sıcak su yok" yine klima olur) · (c) klima tespitini kaldır ("Daire çok sıcak" sözlükte klimayı bulamaz) |
| "no water" → **water** (su kesintisi) | "Is there hot water?", "Is the tap water drinkable?" → su kesintisi | (a) aynen · (b) kaldır (İngilizce "no water" sözlükte bulunmaz; anlama katmanı bulur) |
| "çok soğuk" → **soğuk** (ısıtma) | "Su soğuk akıyor" → ısıtma | (a) aynen · (b) kaldır / kalıp |
| "when can i check in" → **check** (giriş) | "Can you check the AC?" → giriş | (a) aynen · (b) kaldır ("check in" / "checkin" terimleri zaten var) |
| "how to get there" → **get** (adres) | "Where can I get groceries?" → adres | (a) aynen · (b) kaldır |
| "nereye park" → **park** (otopark) | "Yakında park var mı?" (yeşil alan) → otopark | (a) aynen · (b) kaldır |

Kalıcı çözüm: kalıp eşleşmesini durak sözcükler dahil ham sözcük dizisi üzerinden yapmak. Bu bir mekanizma değişikliği;
ayrı öneri olarak sorulur.
