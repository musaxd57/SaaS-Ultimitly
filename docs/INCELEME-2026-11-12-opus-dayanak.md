# Opus dilim sonu incelemesi — dayanak / istem katmanı / çok mesajlı tur / ölçer — 2026-11-12

> Kapsam: 5d6f91fc sonrasındaki commitler (istem katmanı `AI_NO_SOURCE_RULE_ENABLED`, parça doğrulayıcısı, kıdemli okuyucu, çok mesajlı tur
> `AI_TURN_MESSAGES_ENABLED`, canlı hat ölçeri, geliştirme setleri) ve işlenmemiş iki belge. İnceleme "en derin ve sert" istendi; bulgular
> ilerledikçe dosyaya yazıldı. Her bulgu önce KODDA doğrulandı (deneme ya da yayınlanmış kodla kıyas), sonra düzeltildi ya da gerekçesiyle
> kayda geçti. Ajan yalnız inceledi; kodu Claude yazdı. Mühürlü setler açılmadı.
>
> İlgili belgeler: `docs/INCELEME-2026-11-12-istem-denetimi.md` (denetim + ölçüm) · `docs/TASARIM-2026-11-12-dayanak-ve-yetki-mimarisi.md`.

## 1. Özet

| Sınıf | Sayı | Sonuç |
|---|---|---|
| P1 (anahtarlı yolda yanlış cevabı GEÇİREN delik / kemersiz yan etki) | 4 | 4 düzeltildi |
| P2 | 15 | 13 düzeltildi · 1 kabul edildi (gerekçeli) · 1 kısmen (bilinen sınır kayıtlı) |
| P3 | 8 | 6 düzeltildi · 2 kayıt |
| Belge ↔ kod (D-1…D-7) | 7 | belgeler düzeltildi |

İncelemenin en önemli üç sonucu:

1. **Kendi yazdığım "kısa yol" delikti.** Etiketli, rakamsız değerler (ağ adı, harfli şifre) için eklediğim kısa yol, değerin HANGİ nesneye ait
   olduğunu ve harf farkını denetlemiyordu: `Kapı kodu: lalekapi. Wi-Fi bilgisi kartta.` kaydıyla `Wi-Fi şifresi "lalekapi"` parçası geçiyordu.
   Kısa yol kaldırıldı; değer artık kayıt tarafında etiketli iddia olarak okunur ve öteki değerlerle AYNI denetimlerden geçer.
2. **Anahtarsız bir değişiklik misafir tarafında izin yönlüydü.** Saatten sonraki noktayı cümle sonu sayan düzeltme cevap tarafı için yazılmıştı
   ama aynı bölücü misafir mesajındaki istek tespitinde de kullanılıyordu: "Çıkış saati 11:00. Biraz uzatabilir miyiz?" isteğinin türü geç
   çıkıştan uzatmaya dönüyordu (yayınlanmış kodla kıyas, ölçüldü). Bölücü iki yana ayrıldı; misafir tarafı eski sınırla.
3. **Ölçer bir yanlış gönderimi saymamıştı.** Kayıtlı bir raporda uydurma "There are ATMs available in the area" cevabı misafire gitmiş ve yanlış
   gönderim sayılmamıştı (sonu kapalı desen çoğulu kaçırdı). Ölçer ve setler düzeltildi; bütün kollar son kodla yeniden ölçüldü.

## 2. Bulgular ve yapılan

### 2.1 Parça doğrulayıcısı (`ai/answer-binding.ts`, `ai/claim-support.ts`)

| # | Bulgu | Kodda doğrulama | Yapılan |
|---|---|---|---|
| P1-1 | Etiketli değer kısa yolu başka nesnenin tek gizli değerini sorulan şeye bağlıyor | Deneme: kapı kodu Wi-Fi şifresi diye geçti | Kısa yol kaldırıldı. Kayıt tarafında etiketli rakamsız değer kod iddiası (`labelledLiterals`); ancak (a) parçadaki etiket ailesiyle aynı aile ve (b) değerin cümlesi ihtiyacın konusuna bağlıysa dayanak. Yalnız etiket satırından ibaret satır ("Şifre: …") konuyu kendinden önceki ilk içerikli cümleden devralır |
| P1-2 | Kısa yol büyük / küçük harf ve Türkçe harf farkını yok sayıyor | Deneme: `lalemisafir` ⟵ `Şifre: LaleMisafir` geçti | Değer ana yoldan (birebir) kıyaslanır |
| P1-3 | Kimlik başına olumluluk, yüklemsiz yan cümlede bütün cümlenin olumluluğunu devralıyor | Deneme: "Çamaşır makinesi yok, kurutma makinesi de yok." ⟵ "Çamaşır makinesi mutfakta, kurutma makinesi yok." geçti | Olumluluk HÜKÜM VEREN yan cümleden: yüklem, olumsuzluk ya da yer eki taşıyan yan cümle hüküm verir; vermeyen yan cümle aynı cümledeki sonraki hüküm verenin olumluluğunu alır |
| P2-3 | "misafir" konu sözcüğü oldu (geniş zaman kuyruğu daraltılınca) | Deneme: "Misafir getirmek ücretsizdir." ⟵ "Misafir otoparkı ücretsizdir." geçti | Rol adı kuralı konu seçiminde: özgül sözcüğün yanında düşer; genel baş adla tamlamada ("misafir odası") kalır; tek başınaysa konu bilinmiyor (kodun tuttuğu sebep) |
| P3-2 | Etiketli kod geri sarması ev sahibi karar metni denetimini de sıkılaştırır | Kod okundu: yalnız sıkılaştırır, o yol kapalı | Kayıt |

Bilinen sınırlar (eskiden beri; bu turda dokunulmadı, kayıt): yalnız nitelik sözcüğü taşıyan ihtiyaç ("ücretsiz mi?") nitelik sözcüğünü konu
sayar · İngilizce "guest" ihtiyaç sözcüklerinde düşer ("guest room" ↔ "game room" ayrılamaz, doğru cevap tutulur) · aynı sözlük konusundaki iki
cihaz konu kimliğiyle ayrılamaz · rakamlı değerde ad ↔ şifre yer değişimi okuyucunun işi.

### 2.2 Kıdemli okuyucu (`ai/semantic/absence-judge.ts`)

| # | Bulgu | Yapılan |
|---|---|---|
| P2-4 | İç kaynak hükmünde misafir mesajını gören okumanın dayanaksız oyu sayılmıyor; kısaltılmış ("…") sadık alıntı da dayanaksız düşüyor | Okuyucu alıntısı için atlama işaretine dayanıklı dayanak: parçaların hepsi taslakta, aynı sırayla, bitişik; birden çok parçada en az biri iki sözcük; en çok dört parça. Uydurma cümle yine dayanaksız. Cevap parçası doğrulayıcısı atlamayı KABUL ETMEZ |
| P2-5 | Selamı alıntılayan ama doğru oy veren okuma oyunu kaybediyor | KABUL: o durumda karar kelime kuralına kalır (ölçüm: gerçek itiraf 51/51 iki okumada da görüldü, kelime kuralı 17/17). İkinci okutma eklenmedi (ek model çağrısı) |
| P2-6 | Ücret satırında zamir belirsizliği ("It is still true") | Bayrağın adı açık yazıldı. Ölçüm (6 okuma): yalnız fiyat 0/36 yanlış tutma · gerçek ödeme 24/24 tutuldu |
| P3-1 | Selam kanıtı kuralı düz "bilgim yok" hakemini de değiştirir | Railway belgesinde hakem anahtarına not |
| P3-4 | İki okuma artık eş değil; sıra tipte / adda görünmüyor | `combineAbsenceReadings({ withGuest, draftOnly })` adlı girdi (28 çağrı) |
| Haiku | Alıntı kıyasında NUL karakteri parçaları kaydırıyor (taslağın kendi kuyruğu alıntı yerine geçiyor) | NUL silinir; pinli. Atlama işaretinin öteki yazımları ("..", ". . .") da tanınır |

### 2.3 Çok mesajlı tur (`ai/turn-messages.ts`)

| # | Bulgu | Yapılan |
|---|---|---|
| P1-4 | Anahtar tek başına açılınca önceki mesajdaki BİLİNMEYEN soruya uydurma cevap (ölçüldü: 15 senaryoda 2 yanlış; kapalıyken 0) — kod kemeri yok | Kemer KODDA: yalnız cevap parçaları kipinde. Railway belgesinde ön şart + ölçülen yan etki |
| P2-7 | "Yazıldığı an" başlığı yalnız son mesajın anı; dünkü "yarın" bugüne göre okunur | Gün şartı: bütün mesajların anı bilinmeli ve son mesajla aynı takvim gününde olmalı; değilse eski biçim |
| P2-8 | Kod notu her durumda doğru değil | Not yeniden yazıldı |
| P2-9 | Misafir kendi mesajında sahte "[2/2]" etiketi kurabilir | Her mesaj tek satır (satır sonları görünür işaret) |

### 2.4 İstem katmanı (`ai/prompts.ts`, `conversation-items/reply-block.ts`)

| # | Bulgu | Yapılan |
|---|---|---|
| P2-10 | KURAL-1 parantezi ve KURAL-5 maddeleri güveni koşulsuz 0.4 altına indirtiyor (iki soruluk turda bilinen cevap da tutulur) | Üç çapa: yalnız hiçbir istek cevaplanamadığında |
| P2-11 | KURAL-3 yol tarifi "rota kayıtlarında yoksa bunu söyle" (bilgisizlik açıklaması emri) | Çapa: "rota isteğini cevaplama" |
| P2-12 | Kaynak şartı üçüncü kaynağı (ev sahibinin bu sohbetteki açık cevabı) saymıyor | Blok üç kaynağı sayar; başlık notu parça kipi DIŞINDA üçüncü kaynağı anar |
| D-1 | Niyet bölümü "TÜM soruları eksiksiz yanıtla" katmanda çapasız | Çapa eklendi |
| P3-5 | ÖRNEK 24 başlığı "HİÇBİRİNİ atlama" | Çapa eklendi |
| (ek) | Katmanın kural cümlesindeki örnek sözcüklerinden ikisi mühürlü kabul setinin sorularında geçiyor (içerik açılmadan, yalnız SAYI bakıldı) | Örnekler konu adı taşımayan genel anlatıma çevrildi; eski sözcükler pinle yasak |

Her çapa pinli: anahtar kapalıyken ve istek defteri olmayan yolda cümle aynen durur; bütün katman birleşimlerinde eksik çapa yok.

### 2.5 Anahtarsız değişiklikler

| # | Bulgu | Yapılan |
|---|---|---|
| P2-1 | Saatten sonraki nokta = cümle sonu değişikliği misafir tarafındaki İSTEK tespitini de etkiliyor (izin yönü) | Bölücü iki yana ayrıldı (`"request"` / `"claim"`); çağıran yanını yazmak zorunda. Misafir tarafı yayınlanmış sınırla; cevap tarafı düzeltmesi yerinde |

### 2.6 Ölçer ve setler (`tests/eval/live-pipeline.eval.test.ts`, `evals/*-dev.json`)

| # | Bulgu | Yapılan |
|---|---|---|
| P2-13 | Kayıtlı raporda uydurma cevap yanlış gönderim sayılmadı (sonu kapalı desen) | Desenler açıldı; raporlar son kodla yeniden üretildi |
| P2-14 | Yanlış değer giden ihtiyaç, öğe eşleşmesi kurulamazsa "gereksiz tutma" sayılıyor | İhtiyaca KONU deseni: konu geçip beklenen değer yoksa yanlış gönderim; "metin gitti ama değer yok" ayrı satır |
| P2-15 | Zayıf beklentiler | Sıkılaştırıldı; konu deseni eklenince doğru cevabın farklı yazımları da kabul edilir (yoksa doğru cevap yanlış sayılırdı) |
| P3-6 | Geliştirme seti depoda yoktu | Eklendi |
| P3-7 | İki rapor aynı başlıkla farklı ölçü | Aynı ölçü |
| P3-8 | Ayrıntı dosyası geçersiz koşuda da yazılıyor (set kısmi koşuda yanar) | Yalnız GEÇERLİ koşuda |

### 2.7 İncelemeden SONRA, yeniden ölçümde bulunan (aynı tur)

| Bulgu | Yapılan |
|---|---|
| Parça kipi + okuyucu kolunda 1 yanlış gönderim: "Havuz barı kaça kadar açık?" → havuzun saati gitti. Model üç koşunun üçünde aynı parçayı yazdı; parça okuyucusu birinde geçirdi. Kod "barı"yı tesis saymıyordu (kısa kökte yalnız tam sözcük) ve eksik tesis okuyucu kipinde yalnız danışmaydı | Kısa tesis kökünde ad çekimi tanınır; iki tesisli istekte eksik tesis okuyucu kipinde de kodda tutulur. Yeniden ölçüm: 0 yanlış |
| Katmanın kural cümlesindeki örnek sözcüklerinden ikisi mühürlü kabul setinin sorularında geçiyor (yalnız sayı bakıldı) | Örnekler konu adı taşımayan genel anlatıma çevrildi (kör koşudan önce) |
| Okuyucu setlerinde "iletişim" hükmünde 3 fazla oy (ikisi bugünden önce de vardı): hepsi zaten ödeme için tutulan taslaklar | Davranış etkisi yok; kayıt |

### 2.8 Yapılamayan

Kör (kabul) koşuları: iki kez başlatıldı, ikisi de çıktı yazmadan durdu — ilki ölçüm ortamı yeniden başladığı için, ikincisi OpenAI hesabının
kredisi bittiği için (`credit_balance_exhausted`). Mühürler sağlam; komutlar denetim belgesi §6.4 ve S2 tasarımı §2.3'te.

## 3. Kanıt

- Kırmızı-önce: her delik için önce geçen (yanlış) davranışı gösteren test yazıldı, sonra düzeltildi.
- Mutasyon (ayrık çalışma ağacı, M0 yeşil): 44 mutanttan 43'ü öldü; yaşayan (rol adının yanındaki özgül sözcük) sözlükte konu etiketi olmayan sözcükle pinlendi ve
  takip turunda öldü (7/7); eksik tesis düzeltmesi 5/5.
- Haiku dar incelemesi (her değişiklik grubundan sonra): kodda doğrulanan bulgular düzeltildi (NUL karakteri, atlama yazımları, ölçerde sıfır
  saatlik satır); doğrulanmayanlar uygulanmadı.
- Tam kapı + derleme + CI: yayın raporunda.

## 4. İncelemenin doğru bulduğu, değişmeyenler

- Yeni iki anahtar kapalıyken modele giden istem bayt bayt aynı (pinli).
- Sessiz boşa düşme: her çapa tam bir kez aranır; bütün birleşimlerde eksik çapa yok (pinli).
- Okuma sırası her çağıranda sabit; selam kanıtı kuralı yalnız kapalı hitap listesiyle çalışır.
