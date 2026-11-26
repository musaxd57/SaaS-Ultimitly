# TASARIM — Model çalışmadığında da acil misafir mesajı ev sahibine ulaşsın (T1, 2026-11-04)

> **Durum:** tasarım. Dilim 0 (Y1 + Y2, anahtarsız sıkılaştırma) YAPILDI — commit `db89aeaf` (11-04 gece). Dilim 1–5 için kod yazılmadı; kurucu
> onayı bekliyor (§6).
> **Kaynak:** derin denetim TUR 2 bulguları A-1 (tıbbi acil), A-2 (açık tehlike uyarısız), A-4 (gaz biçimleri), K-1 / K-2 / K-3.
> Bulgular üç ayrı tasarımla (A: var olan kanıtı yeniden kullan · B: ayrı tıbbi okuyucu · C: çekirdek + geniş + gölge) çözüldü. Bir hakem
> üçünü birbirinin kümelerinde ölçtü ve A'yı seçti; B'den ve C'den parçalar eklendi. Bu belge o birleşimdir.
> **Kod:** `dev/gates`, HEAD `6251d73d`, yalnız okundu. Ölçümler yalnız saf fonksiyonlarla yapıldı; veritabanı, ağ ve model kullanılmadı, kör set açılmadı.
> Ölçüm betikleri ve prototipler repo dışında (oturum çalışma alanı; tasarım ajanlarının kopyası); uygulamada testlere dönüşür.

**Bu belgede geçen üç parça (sade adlarıyla):**
- **Uyarı geçişi:** her 2 dakikada bir cevapsız misafir mesajlarına bakan ve gerekirse ev sahibine "⚠️ Acil misafir mesajı" e-postası (+ WhatsApp)
  gönderen iş (`sendDueAlerts`). Model çalışmadığında ev sahibine giden **tek** otomatik yol budur.
- **Acil sözcük ağı:** "yangın", "bayıldı", "nefes alamıyor", "kalp krizi" gibi sözcükleri arayan geniş liste (`isSafetyEmergencyText`).
- **Tehlike okuyucusu:** yangın / gaz / elektrik / su ve kişisel tehlikeyi (mahsur kalma, zorla giriş, tehdit) cümle bağlamıyla okuyan, "açık /
  olası / yalnız anılış / yok" diyen kod (`hazardEvidenceOf`). QR sohbeti bu okuyucunun "açık" hükmüyle bugün zaten modeli beklemeden ev
  sahibine devrediyor.

---

## 0. Kısa özet (öneri biçiminde)

**Bunu böyle yapıyorum.** Uyarı geçişi bugün bir mesajı acil saymak için iki şart istiyor: acil sözcük ağı **ve** tehlike okuyucusu ikisi birden
tutmalı. Bu kural kanaldaki yanlış alarmları ("Fire TV", "Gaz ocağı var mı?") süzmek için konmuştu (10-14). Bedeli şu: tehlike okuyucusu
tıbbi durumu hiç tanımadığı için **bayılma, nefes durması, kalp krizi ve ağır kanama model çalışmadığında hiçbir uyarı üretmiyor (0/37)**.
Okuyucunun "açık" dediği yangın ve elektrik çarpması da sözcük ağı sessizse uyarısız kalıyor ("Ev yanıyor", "Çocuğu akım çarptı").

**Büyük şirketler böyle yapıyor.** Büyük platformlar can güvenliğini yapay zekâya bırakmaz ve modelin ayakta olmasına bağlamaz. Airbnb misafire
uygulama içinde 7/24 güvenlik hattı düğmesi koyar, Uber yolculuk ekranında acil yardım düğmesi tutar. Destek yazılımlarında "acil" mesajlar
modelden bağımsız kurallarla doğrudan insana yönlendirilir. Yeni bir alarm kuralı da önce ölçülür, sonra açılır; çünkü yanlış alarm, alarmın
kendisini değersizleştirir.

**Önerim bu:**
1. Tehlike okuyucusunun **açık** hükmü tek başına uyarı için yeterli olsun. Sözcük ağı şartı yalnız "olası" düzeyde kalsın.
2. Okuyucuya **tıbbi acil** okuması eklensin: 9 tür, 7 dil, 10-31 kişisel tehlike okuyucusunun koşul / soru / geçmiş / abartı korumalarıyla.
3. Okuyucuya eksik **gaz** biçimleri eklensin ("Tüp gaz kaçırıyor", "Ich rieche Gas").
4. İki bilinen yanlış alarm sınıfı için süzgeç olsun: Türkçe övgü "bayıldı" ve sıcaktan "nefes alamıyoruz".
5. Her şey anahtar arkasında, varsayılan **kapalı** olsun. Açmadan önce ayrı yazarın kör setiyle ve gerçek geçmiş mesajlarla ölçülsün.

**Misafire giden hiçbir metin değişmez.** Değişen tek şey ev sahibine giden acil uyarıdır. Yan etkisi de yalnız sıkılaştırmadır: uyarı alan
konuşmada o tur otomatik cevap gitmez (S2).

**Örnek:**
- Oto-yanıtı kapalı bir işletmede gece "Babam nefes almıyor" geliyor. Bugün ev sahibine hiçbir şey gitmiyor. Sonra ≤2 dakikada "⚠️ Acil misafir
  mesajı" e-postası ve WhatsApp aynı anda gidiyor, konuşma Sorunlu + Acil oluyor.
- "Bayıldım, harika bir ev!" bugün de sonra da uyarı üretmiyor.

**Böyle yapalım mı?** Kararı değiştiren 12 soru §6'da, her biri önce / sonra örnekli.

---

## 1. Sorun (ölçüldü)

### 1.1 Model çalışmadığında ev sahibine hangi yol kalıyor

| Durum | Model / anlama katmanı | Ev sahibine bildirim üretebilen yol |
|---|---|---|
| Oto-yanıt kapalı (işletme ayarı ya da dağıtım anahtarı) | koşmaz | yalnız uyarı geçişi |
| Mesai dışı | koşmaz | yalnız uyarı geçişi |
| Fatura duraklaması | koşmaz | yalnız uyarı geçişi (fatura kontrolünden önce koşar) |
| Günlük AI kotası doldu | modelden önce durur | yalnız uyarı geçişi |
| Oto-yanıt açık ama model arızalı | kapı her zaman tutar, misafire bir şey gitmez | uyarı geçişi + yalnız "olası" fiziksel tehlikede ek e-posta (saatte 3) |
| QR sohbeti, model yok | devir | QR devir e-postası (misafir metni yok, WhatsApp yok); "açık" tehlikede model beklenmez |

Uyarı geçişinin bugünkü kuralı, sade hâliyle:

> Mesaj **şikâyet / iade** ise uyar. **Anahtar / giriş kaybı** ise uyar. **Acil sözcük ağı tutuyor VE tehlike okuyucusu "açık" ya da "olası"
> diyor** ise ACİL uyar. Kişisel tehlike (mahsur / zorla giriş / tehdit) "açık" ise sözcük ağı gerekmez (10-31).

### 1.2 Bugünkü davranış (model yokken; ölçüldü)

| Sınıf | Örnek | Acil sözcük ağı | Tehlike okuyucusu | Ev sahibine bugün |
|---|---|---|---|---|
| **Tıbbi acil (A-1)**, 37 cümle, 7 dil | "Annem bayıldı" · "Babam nefes almıyor" · "Il est inconscient" · "أمي أغمي عليها" | 28/37 tutuyor | 37/37 **yok** | **hiçbir şey (0/37)** |
| **Açık fiziksel tehlike, sözcük ağı sessiz (A-2, K-3)** | "Ev yanıyor" · "Çocuğu akım çarptı" · "Ocağın üstünde alev var söndüremiyoruz" | yok | **açık** | **hiçbir şey** (QR'da aynı mesaj modelsiz kritik devir alıyor) |
| **Gaz biçimleri (A-4)** | "Tüp gaz kaçırıyor" · "Ich rieche Gas" · "Из плиты идёт газ" | 2/3 tutuyor | yok | **hiçbir şey** |
| Su (K-2) | "Musluktan / Vanadan / Sayaçtan su fışkırıyor" | yok | **yalnız anılış** (HEAD'de geriledi, §1.3) | hiçbir yolda hiçbir şey |
| Karışık tur | "Annem bayıldı, klima da çalışmıyor" | tutuyor | yok | uyarı var, ama **klima şikâyeti** sayesinde |
| Duman / gaz, iki ağ da tutuyor (K-1, A-3 sonrası) | "Merdivenden duman geliyor" · "Der Herd riecht nach Gas" | tutuyor | olası / açık | ACİL uyarı (bugün de doğru) |

Sözcük ağının dil başına tıbbi kapsamı: TR 4/7 · EN 5/5 · DE 4/5 · FR 4/5 · ES 4/5 · RU 4/5 · AR 3/5. Can güvenliği zamanlaması (`lifeSafetyOf`)
tıbbiyi 31/37 tanıyor, ama yalnız **zamanlama** için kullanılıyor; uyarı kararına girmiyor.

**Model çalışırken de küçük bir boşluk var:** sözcük ağının tanımadığı 9 tıbbi cümlede ("Meine Mutter ist ohnmächtig geworden", "Il est
inconscient", "أمي أغمي عليها" …) kelime kapısı tutmuyor. Karar tamamen modelde kalıyor.

### 1.3 HEAD'de bulunan iki gerileme / açık (bayraksız düzeltilecek, Dilim 0)

| | Ne oldu | Etki |
|---|---|---|
| **Y1 (K-2 gerilemesi, `56b44775`)** | "fışkır" kökü çekimsiz yazılmış; "fışkır**ıyor**"un eki, kaçağın ek aldığı sanılıyor | "Musluktan su fışkırıyor" olası → yalnız anılış. Oto-yanıt açık ve anlama katmanı düşükken çalışan "olası tehlike" e-postası artık hiç koşmuyor. |
| **Y2** | Türkçe övgü süzgeci ("havuz**a** bayıldı") bulunma ekini de yönelme sanıyor | "Eşim banyo**da** bayıldı" övgü diye maskeleniyor. Anlama katmanı "acil değil" derse acil etiketi kalkıyor. |

### 1.4 Bulgu → bu belgede

| Bulgu | Bugün | Bu belgede |
|---|---|---|
| A-1 tıbbi acil | 0/37 uyarı | Dilim 2 |
| A-2 / K-3 açık tehlike, sözcük ağı sessiz | uyarı yok | Dilim 1 |
| A-4 gaz biçimleri | uyarı yok | Dilim 3 |
| K-1 duman / gaz | A-3 ile düzeldi (`00f4713e`) | değişmez, pinlenir |
| K-2 su fışkırma | HEAD'de geriledi | Dilim 0 (Y1) |

---

## 2. Öneri

### 2.1 İlke

1. **Bir okuyucu, iki görünüm, iki anahtar.**
   - Yeni okumalar (tıbbi, gaz biçimleri) var olan tehlike okuyucularının **içine**, aynı koruma makinesiyle yazılır. Bugünkü fonksiyonlar
     değişmez; genişletilmiş görünüm ayrı fonksiyon olarak dışa açılır. Okuyucular ortam değişkeni okumaz, saf kalır.
   - Hangi tüketicinin hangi görünümü okuyacağına anahtar karar verir:
     - **Anahtar 1 `HAZARD_ALERT_V2_ENABLED`:** yalnız ev sahibi uyarısı. Misafire dönük hiçbir yol yeni görünümü okumaz.
     - **Anahtar 2 `HAZARD_GATE_V2_ENABLED`:** aynı görünüm kanal kapısında ve QR'da. Misafir tarafında sıkılaştırmadır; ayrı onayla, sonra açılır.
2. **Sözcük ağı karar vermez, yalnız sıkılaştırır (K-1029-C).** Yeni kanıt bir mesajı ev sahibine bırakabilir, misafire hiçbir şey
   göndertmez. Bugün uyarı alan hiçbir mesaj, kapıda tutulan hiçbir mesaj gevşemez.
3. **Koşul / soru / önlem / övgü / abartı uyarı değildir** (10-31). Tıbbi okuma bu korumaları 10-31'den aynen alır ve tıbbiye özgü korumalar ekler (§2.3).
4. **Acil sözcük ağının kendisine dokunulmaz.** Ağın çok sayıda başka çağıranı var: görev, ad maskesi, uzun mesaj yolu.

### 2.2 Uyarı geçişinin yeni kuralı (Anahtar 1)

| Tehlike okuyucusu (genişletilmiş görünüm) | Bugün | Sonra |
|---|---|---|
| **Açık** (fiziksel, kişisel ya da tıbbi) | sözcük ağı da şart (kişisel hariç) | **tek başına ACİL uyarı.** Tek istisna ısı abartısı: oda / ev + "yanıyor" + sıcak / klima bağlamı varsa ve başka yangın kanıtı yoksa yeni uyarı doğmaz, bugünkü kurala düşer (§2.5). |
| **Olası** fiziksel | sözcük ağıyla ACİL | aynı (değişmez) |
| **Olası** tıbbi (soru, geçmiş, aktarım, bitmiş olay) | — | uyarmaz; model işidir. Sözcük ağının tıbbi sözcükleri bunu uyarıya çevirmez. |
| **Belirsiz tıbbi bildirim:** Türkçe çıplak "X bayıldı", acil ipucu yok | — | **Rozetsiz uyarı.** Konuşma Sorunlu olur, aynı e-posta ve WhatsApp gider, Acil rozeti yazılmaz. Model cevap verebilecek durumdaysa (oto-yanıt açık + mesai içi) önce **6 dakika** model bakar; konuşma hâlâ cevapsızsa uyarı gider. Süre mesajın sisteme geldiği andan sayılır. |
| Şikâyet / iade / erişim kaybı | uyarı | aynı (değişmez) |
| 8.000 karakterden uzun mesaj | yalnız sözcük ağı | aynı (değişmez, K10-t) |

**Uyarı gidince ne olur?** Bugünkü acil yolun aynısı:
- Konuşma Sorunlu + Acil olur, "⚠️ Acil misafir mesajı" e-postası gider, karar kaydı yazılır.
- Mesaj başına tek bildirim gider. E-posta düşerse talep geri alınır, sonraki geçiş yeniden dener.
- **Teslim:** tıbbi ve fiziksel açık hüküm can güvenliği sayılır, e-posta ve WhatsApp **aynı anda ve hemen** gider (hibrit kural). Can
  güvenliği okuyucusu bugün "Babam nefes almıyor", "Il est inconscient", "أمي أغمي عليها" cümlelerini tanımıyor; bunun için ona `medical`
  gerekçesi eklenir.
- **Konuşma öğeleri açıkken:** bugün etiketsiz mesaj öğe yoluna düşüyor ve orada hiç öğe kurulamadığı için **e-posta hiç gitmiyor** (üç
  tasarımın da ölçtüğü tuzak). Yeni kuralın yakaladığı mesaj, uyarı geçişinin içinde "acil" etiketini alır ve bugünkü acil yoldan gider.
- **Sorunlu konuşmada yeniden bildirim (10-31 kuralı):** tıbbi olay alt türüyle sayılır (`medical:bilinç`, `medical:nefes` …).
  - "Annem bayıldı, ayılmıyor" → uyarı.
  - "Hâlâ ayılmadı" → yok (aynı olay).
  - "Şimdi nefes almıyor" → yeni uyarı (kötüleşme bastırılmaz).
  - "Mutfakta yangın var" → yeni uyarı.

### 2.3 Tıbbi acil okuması (`person-danger.ts` içinde, ayrı `medicalDangerOf`)

**Kapsam: 9 tür × 7 dil (TR, EN, DE, FR, ES, RU, AR).** Yalnız olayı **bildiren** çekimli öbek okunur; isim tek başına yetmez.

| Tür | Örnek (açık) | Bilerek dışarıda |
|---|---|---|
| Bilinç kaybı | "bilinci kapalı", "yere yığıldı", "fainted", "bewusstlos", "s'est évanouie", "se desmayó", "потерял сознание", "أغمي عليها" | "bayıldım / bayıldık" (övgü), "havuza bayıldı" (sevmek) |
| Nefes | "nefes almıyor", "not breathing", "atmet nicht", "ne respire pas", "no respira", "не дышит", "لا يتنفس" | sıcak / havasız / koku / toz bağlamı |
| Kalp / inme | "kalp krizi geçiriyor", "having a stroke", "Herzinfarkt", "crise cardiaque", "infarto", "инсульт", "نوبة قلبية" | "kalp hastasıyım", "geçirirse" |
| Ağır kanama | "kanaması durmuyor", "bleeding heavily", "blutet stark", "сильное кровотечение", "ينزف بشدة" | "burnum biraz kanıyor" |
| Zehirlenme | "çamaşır suyu içti", "swallowed bleach", "a avalé de la javel" | "ilacını içti", "zehirlendik" (gıda) |
| Nöbet | "havale geçiriyor", "having a seizure", "Krampfanfall", "convulsión" | "nöbetçi eczane" |
| Alerjik şok | "boğazı şişiyor", "allergic reaction" + nefes, "choc anaphylactique" | "fıstık alerjim var" |
| Ambulans çağrısı | "ambulans çağırın / yolda", "112'yi aradık", "call an ambulance", "вызовите скорую" | "ambulans sesleri geliyor" |
| Yüksekten düşme (kişi öznesi şart) | "balkondan düştü", "fell down the stairs" | "telefonum balkondan düştü" |

**Korumalar:**
- **10-31'den aynen:** koşul, Türkçe koşul eki, soru, geçmiş, aktarım, olumsuz, tam sözcük.
- **Tıbbiye özgü (A, B, C tasarımlarında ölçüldü):**
  - abartı / "neredeyse" ("I almost had a heart attack", "casi me desmayo");
  - Türkçe övgü (yönelme eki, derece zarfı "çok / resmen", olumlu söz "harika / teşekkür");
  - duygu nedeni ve görme tepkisi ("sevinçten", "görünce", "when she saw");
  - alışkanlık ("her seferinde", "sabahları", "whenever", "dès que");
  - şaka işareti (😂, haha; tehlike okuyucusundaki şaka listesi yeniden kullanılır);
  - mecaz özne ("le voisin est inconscient, il met la musique");
  - uzak geçmiş ("yıllar önce", "years ago"): yalnız tıbbide; kişisel türlerin geçmiş kuralı değişmez;
  - bitmiş olay ("kendine geldi", "she's fine now");
  - 1. kişi bayılma ("I fainted"): yazan kişi bilinçli → olası.
- **Hava şikâyeti:** mesajda sıcak / havasız / klima / rutubet varsa nefes türü tıbbi sayılmaz ("Bu sıcakta nefes alamıyor insan").
- **Türkçe çıplak "X bayıldı":** yalnız acil ipucuyla açık olur. İpucu listesi: ayılmıyor, kendine gelmiyor, tepki vermiyor, nefes, yere, yardım,
  ambulans, 112, hastane, ne yapalım, ne yapacağız, bilmiyoruz, açamıyoruz. İpucu yoksa "belirsiz bildirim" sayılır (§2.2, S1).
- **Olayın ardındaki yardım sorusu soru sayılmaz:** "Annem bayıldı ne yapalım?" → açık. Kişisel türlere genişletilmesi S5.
- **Ambulans istisnası:** ambulans / hastane çağrıldıysa olay "bitmiş" sayılmaz (S11).

### 2.4 Gaz biçimleri (tehlike okuyucusunun ek tablosu)

**Eklenen biçimler:**
- Türkçe ettirgen "(tüp) gaz kaçırıyor".
- Geçmiş "gaz koktu".
- Kaynaklı "ocaktan gaz geliyor". Kaynaksız "gaz geliyor mu?" besleme sorusudur, eklenmez.
- İngilizce "gas is leaking"; Almanca "ich rieche Gas", "verliert Gas"; Rusça "идёт газ"; Arapça iki sözcük sırası ("الغاز يتسرب").
- Koku fiili ile gaz arasında **tek yoğunluk zarfı**: "ça sent **fort** le gaz", "huele **mucho** a gas", "riecht **stark** nach Gas". Bu biçimi
  üç tasarımın üçü de kaçırmıştı.

Biçimler aynı olumsuz / koşul / ekipman korumalarından geçer. Uyarıda Anahtar 1 ile, QR ve kapıda Anahtar 2 ile okunur. Gaz soru biçimleri: S10.

### 2.5 Isı abartısı yalnız uyarı kuralında

"Ev yanıyor sıcaktan, klimanın kumandası nerede?" mesajını okuyucu bugün "açık yangın" sayıyor; QR'da modelsiz kritik devir oluyor. Bu kural
okuyucuyu **değiştirmez** (QR'da gevşeme olmaz). Yalnız yeni "açık tek başına" kuralının bu mesajda yeni bir uyarı doğurmasını önler. Malzeme
nesneleri (perde, yatak, koltuk, kablo, priz) bu istisnaya girmez: "Perde yanıyor sıcaktan" açık kalır.

### 2.6 Ne değişir, ne DEĞİŞMEZ

**Anahtar 1 açıkken değişenler:**
- Ev sahibine giden acil uyarı (e-posta + WhatsApp, Sorunlu, Acil).
- Uyarı geçişi her geçişte otomatik cevaptan önce koştuğu için, uyarı alan konuşmada o tur otomatik cevap gitmez. Bu bugünkü acil yolun da
  davranışıdır (S2).
- Tıbbi mesajdan bakım görevi açılmaz (S7).

**Değişmeyenler:**
- **Misafire giden her metin** (istem, kapı metni, QR cevabı, devir metni).
- Acil sözcük ağı ve 8.000 karakter üstü uzun mesaj yolu.
- QR davranışı (Anahtar 2 kapalıyken).
- "Olası tehlike" e-postasının metni ve saatlik 3 tavanı.
- WhatsApp saatte 10 tavanı. Saatlik e-posta tavanı da eklenmez: can güvenliğinde susturmak kaçırmaktan pahalıdır, yağmuru mesaj başına tek
  bildirim ve "aynı olay 3 saat" kuralı keser.
- Aday seçimi (72 saat, 60 sn bütçe) ve ev sahibinin elle açtığı konuşma yolu.
- Bugün uyarı üreten her mesaj, aynı daldan aynı biçimde uyarmaya devam eder.

---

## 3. Önce / sonra örnekleri

**Tablodaki kısaltmalar:**
- **"Model yokken":** oto-yanıt kapalı, mesai dışı, fatura duraklaması, kota dolu ya da model arızalı.
- **ACİL uyarı:** konuşma Sorunlu + Acil rozeti; "⚠️ Acil misafir mesajı" e-postası + WhatsApp aynı anda.
- **Rozetsiz uyarı:** aynı e-posta + WhatsApp ve Sorunlu, ama Acil rozeti yok; model cevap verebilecekse önce 6 dakika bekler.
- **—:** hiçbir şey; konuşma "Yeni" kalır.

**Hiçbir satırda misafire yeni bir metin gitmez.** "Ölçüm" sütunu:
- **ölçüldü:** bugünkü kodun kopyası ve hakem birleşim benzetimiyle, saf fonksiyonla ölçüldü.
- **öngörülen:** önerilen ama prototipte henüz olmayan parça; uygulamada kırmızı-önce testle ölçülecek.

| # | Dil | Misafir mesajı | Bugün (model yokken) | Sonra (Anahtar 1 açık, model yokken) | Ölçüm |
|---|---|---|---|---|---|
| **Gerçek acil** | | | | | |
| 1 | TR | Annem bayıldı, ayılmıyor | — | **ACİL uyarı** | ölçüldü |
| 2 | TR | Babam nefes almıyor | — | **ACİL uyarı** | ölçüldü |
| 3 | TR | Annem bayıldı (çıplak) | — | **Rozetsiz uyarı** (S1) | ölçüldü |
| 4 | TR | Annem bayıldı ne yapalım? | — | **ACİL uyarı** (benzetimde rozetsiz; ipucu listesine "ne yapalım" eklenince) | öngörülen |
| 5 | TR | Ev yanıyor | — | **ACİL uyarı** | ölçüldü |
| 6 | TR | Çocuğu akım çarptı | — | **ACİL uyarı** | ölçüldü |
| 7 | TR | Ocağın üstünde alev var söndüremiyoruz | — | **ACİL uyarı** | ölçüldü |
| 8 | TR | Tüp gaz kaçırıyor | — | **ACİL uyarı** | ölçüldü |
| 9 | TR | Oğlum çamaşır suyu içti | — | **ACİL uyarı** (zehirlenme türü) | öngörülen |
| 10 | EN | My father is not breathing | — | **ACİL uyarı** | ölçüldü |
| 11 | DE | Meine Mutter ist ohnmächtig geworden | — | **ACİL uyarı** | ölçüldü |
| 12 | DE | Ich rieche Gas | — | **ACİL uyarı** | ölçüldü |
| 13 | FR | Il est inconscient | — | **ACİL uyarı** | ölçüldü |
| 14 | FR | Ça sent fort le gaz | — | **ACİL uyarı** (yoğunluk zarfı) | öngörülen |
| 15 | ES | Mi padre no respira | — | **ACİL uyarı** | ölçüldü |
| 16 | RU | У сына сильное кровотечение | — | **ACİL uyarı** | ölçüldü |
| 17 | RU | Из плиты идёт газ | — | **ACİL uyarı** | öngörülen |
| 18 | AR | أمي أغمي عليها | — | **ACİL uyarı** | ölçüldü |
| 19 | AR | ابني ينزف بشدة | — | **ACİL uyarı** | ölçüldü |
| **Bugün de uyarı alan (değişmez)** | | | | | |
| 20 | TR | Duman dedektörü öttü, pil bitmiş galiba | ACİL uyarı (kurucu kararı H3) | aynı | ölçüldü |
| 21 | TR | Annem bayıldı, klima da çalışmıyor | uyarı (şikâyet dalından, Acil) | aynı | ölçüldü |
| **Kontroller: uyarı OLMAMALI** | | | | | |
| 22 | TR | Bayıldım, harika bir ev! | — | — | ölçüldü |
| 23 | TR | Gaz ocağı var mı? | — | — | ölçüldü |
| 24 | TR | Yerden ısıtma yok mu? | — | — | ölçüldü |
| 25 | TR | Yangın tüpü nerede? | — | — | ölçüldü |
| 26 | TR | Ev yanıyor sıcaktan, klimanın kumandası nerede? | — (QR: modelsiz kritik devir) | — (QR aynen; gevşeme yok) | ölçüldü |
| 27 | TR | Dün annem bayıldı ama şimdi iyi, teşekkürler | — | — | ölçüldü |
| 28 | TR | Babam iki yıl önce kalp krizi geçirdi, asansör var mı? | — | — | ölçüldü |
| 29 | TR | Bu sıcakta nefes alamıyor insan | — | — | ölçüldü |
| 30 | TR | Kızım biraz ateşlendi, eczane var mı? | — | — | ölçüldü |
| 31 | EN | I almost had a heart attack when I saw the cleaning fee | — | — | ölçüldü |
| 32 | DE | Es ist so stickig, man bekommt keine Luft | — | — | ölçüldü |
| 33 | FR | Que faire si quelqu'un s'évanouit ? | — | — | ölçüldü |
| 34 | ES | Me encantó, casi me desmayo con la vista | — | — | ölçüldü |
| 35 | RU | Есть ли аптечка? | — | — | ölçüldü |
| 36 | AR | ماذا نفعل إذا أغمي على أحد؟ | — | — | ölçüldü |
| **Bilinen yanlışlar ve kaçanlar** | | | | | |
| 37 | TR | Çocuklar bayıldı, tekrar geleceğiz | — | **Rozetsiz uyarı (yanlış alarm)**. Model cevap verebilecekse model karar verir. S1'in bedeli. | ölçüldü |
| 38 | EN | My wife fainted when she saw the sunset, absolutely stunning | — | **ACİL (yanlış)** benzetimde. Görme tepkisi korumasının "when she saw" biçimiyle düşmesi bekleniyor. | ölçüldü / düzeltme öngörülen |
| 39 | EN | Grandma collapsed in the kitchen | — | prototipte — ("grandma" özne listesinde yok); envanter genişliğiyle ACİL | öngörülen |
| 40 | TR | Musluktan su fışkırıyor | — | — (S8). Dilim 0 sonrası oto-yanıt açık + anlama düşükken "olası tehlike" e-postası geri gelir. | ölçüldü |

**Oto-yanıt açık ve model çalışırken:** uyarı geçişi aynı geçişte otomatik cevaptan önce koşar. Bu yüzden 1–19 numaralı satırlar bu durumda da
≤2 dakikada Sorunlu olur ve o tur misafire otomatik cevap gitmez (S2). Tek fark 3 numaralı satırda: rozetsiz uyarıdan önce 6 dakika model bakar.

---

## 4. Yanlış alarm ölçümü

### 4.1 Kontrol kümeleri

| Küme | Yazan | İçerik |
|---|---|---|
| Hakemin bağımsız kümesi | hakem, prototiplere bakmadan | 53 gerçek acil + 71 zor olumsuz, 7 dil |
| Çapraz kümeler | her tasarım öteki ikisinin kümesinde koşuldu, o kümelere göre ayarlanmadı | A için 244 yabancı olumlu / 250 yabancı olumsuz |
| 10-31 görülmüş setleri | başka yazar (kişisel tehlike işi) | 315 olumlu / 287 zor olumsuz, 7 dil |
| Birleşim benzetimi | yukarıdakilerin toplamı (A'ya yabancı + ayarsız kümeler + hakem) | 359 olumlu / 409 zor olumsuz |

**Zor olumsuz aileleri:**
- övgü ve abartı ("bayıldım", "çocuklar bayıldı", "my heart stopped when I saw the view");
- ısı abartısı ("oda yanıyor resmen");
- koşul ("biri bayılırsa…"), geçmiş ("iki yıl önce kalp krizi"), kurgu ("dizide adam bayıldı");
- vücut ateşi, cihaz / ışık ("kombi yanıyor mu", "Fire TV");
- gaz bilgisi ("gaz ocağı var mı"), sıcakta nefes, uyku ("passed out");
- nesne çökmesi ("the bed collapsed"), küçük kanama, mecaz.

### 4.2 Sonuç

| Ölçüm | Bugün | Yalnız A | Önerilen birleşim (yaklaşık benzetim) |
|---|---|---|---|
| 409 zor olumsuz: **yeni ACİL** | — | 25 | **13** (+7 rozetsiz) |
| 359 gerçek acil: uyarı alan | 41 | 307 | **307** (ACİL 257 · rozetsiz 9 · bugünkü daldan 41); A'ya göre kayıp **0** |
| 10-31 görülmüş setleri: yeni yanlış / kayıp | — | 0 / 0 | **0 / 0** |
| Hakem kümesi: gerçek acil yakalama | 15/53 | 46/53 | — |
| Hakem kümesi: yeni yanlış alarm | — | 2/71 (ikisi de Türkçe çıplak övgü "bayıldı") | ikisi de rozetsize iner (ölçüldü) |
| Çapraz (yalnız A): yabancı küme yakalama / yeni yanlış | — | %82,8 / %7,6 | — |

**Kalan 13 yanlış ACİL** (hepsi yeni süzgeçlerin hedefi; bu süzgeçler henüz **ölçülmedi**):

| Sınıf | Adet | Örnek | Planlanan süzgeç |
|---|---|---|---|
| Gaz | 3 | "Kombi gaz kaçırıyor mu nasıl anlarız?" | 1'i benzetim artefaktı ("kaçırırsa"; gerçek kalıpta koşul eki eşleşmez). 2'si ettirgen soru biçimi: kanonik biçimi ("kaçıyor mu") bugün de ACİL alıyor, yeni biçim onunla aynı davranıyor → S10 |
| Belirsiz mutfak | 1 | "Mutfak yanıyor, aspiratör açık mı?" | — (gerçekten iki anlamlı) |
| Şaka | 2 | "…bewusstlos ins Bett gefallen 😂" | şaka işareti |
| Alışkanlık | 2 | "dès que", "sabahları" | alışkanlık listesi |
| Mecaz özne | 2 | "Le voisin est inconscient…" | mecaz özne |
| Görme tepkisi | 1 | "My wife fainted when she saw the sunset…" | görme tepkisi |
| Hafif / bitmiş | 1 | "Annem sıcakta biraz fenalaştı, şimdi dinleniyor" | bitmiş olay |
| Şaka (yangın) | 1 | "La cuisine est en feu… c'était une blague 😂" | şaka işareti |

### 4.3 Bu sayılar neden bağlayıcı değil

- Kümelerin bir kısmı C tasarımının kendi ayarladığı kümeler; C'den alınan süzgeçlerin etkisi bu yüzden iyimser görünür.
- 10-31 deneyimi de aynı yönde: tarafsız kör sette ilk ölçüm 75/105 yakalama ve 5/105 yanlış alarm verdi.
- Bu yüzden anahtar açılmadan önce iki ölçüm şart (S12):

| Ölçüm | Nasıl | Önerilen eşik |
|---|---|---|
| **(i) Kör set** | Ayrı bir yazar, kalıpları görmeden yazar: 7 dil; gerçek tıbbi / fiziksel bildirim + zor olumsuz + gerçek sağlık sorusu / süreğen durum. Tasarımı yazan görmez. Bir kez ölçülür, sonra "görülmüş" sete döner. | İlk koşuda yeni yanlış ACİL ≤ %2. Görülen her yanlış düzeltildikten sonra 0. Modelsiz yakalama ≥ %80. |
| **(ii) Gerçek geçmiş** | Railway açıldığında, kurucunun makinesinde, salt okuma (`eval-real-stats` deseni, model / kredi yok). Anahtar açık / kapalı uyarı sayısı farkı çıkarılır. | **Her yeni ACİL tek tek okunur.** Tek yanlış ACİL varsa düzeltilir ve ölçüm yeniden koşulur. |

### 4.4 Bugün zaten var olan yanlış alarmlar (bu belge DEĞİŞTİRMEZ)

- **QR, model yokken kritik devir:** "Bayıldım, harika bir ev!" ve "Gaz ocağı var mı?".
- **Kanal ACİL:**
  - "Balkonda mangal yanıyor, duman komşuya gidiyor mu?"
  - "S'il force la porte, que faire ?" (S5 bunu düzeltir)
  - "Gaz kaçağı vardı, tamirci geldi düzeltti"
  - "Kombi gaz kaçıyor mu nasıl anlarız?" ve "Gaz kaçıyor mu diye kontrol ettim, sorun yok" (ölçüldü: okuyucu "gazda şüphede açık"
    diyor, sözcük ağı da tutuyor)

Bunları süzmek **gevşetmedir**; ayrı karar ister (§7).

---

## 5. Uygulama

### 5.1 Dilimler

| Dilim | İçerik | Bulgu | Anahtar |
|---|---|---|---|
| **0** | Y1 ("fışkır" çekimli biçim) + Y2 (bulunma eki övgü değil). Ayrı commit, yalnız sıkılaştırır; kurucuya haber verilir. | K-2 | **yok** |
| **1** | Saf uyarı kuralı (yeni yaprak dosya `ai/danger-alert.ts`, tek fonksiyon; kapalı dalı bugünkü kuralın kopyası) + açık tek başına + ısı abartısı + uyarı etiketi / öncelik / öğe kipi bağlantısı + mesaj başına okuma önbelleği | A-2, K-3 | Anahtar 1 |
| **2** | `medicalDangerOf` + uyarıya bağlanma + can güvenliği `medical` gerekçesi + `medical:<alt tür>` + rozetsiz sınıf (6 dk) + bakım görevi istisnası | A-1 | Anahtar 1 |
| **3** | Gaz ek biçimleri (genişletilmiş görünüm) | A-4 | Anahtar 1 |
| **4** (isteğe bağlı) | Gölge kip: davranış değişmez, yalnız "açık olsaydı uyarırdı" satırı olay günlüğüne yazılır | — | `HAZARD_ALERT_V2_SHADOW_ENABLED` |
| **5** (ayrı onay) | Aynı görünüm kanal kapısında ve QR'da: tıbbi açık hükümde QR modeli beklemez; kayıt sebebi "fiziksel tehlike" değil tıbbi | — | Anahtar 2 |

**Sıralama ve açılış:**
- Dilim 1 ısı abartısı olmadan açılmaz (yanlış alarm ölçüldü).
- Her dilimden sonra Haiku dar inceleme; son dilimde Opus sert inceleme.
- Açılış sırası: kör set → gerçek geçmiş taraması → (gölge haftası) → Anahtar 1 → 1–2 hafta → Anahtar 2 kararı.

**Kod bağlantıları (HEAD `6251d73d`):**

| Yer | Değişiklik |
|---|---|
| `ai/hazard-evidence.ts:564-565`, `:954-955` | Dilim 0 (Y1, Y2) |
| `ai/hazard-evidence.ts` gaz tablosu (`:225-233`) | Ek biçimler; bugünkü fonksiyon değişmez, genişletilmiş görünüm ayrı fonksiyon |
| `ai/person-danger.ts` | `medicalDangerOf`; 10-31 tür listesine kendiliğinden girmez |
| `automation.ts:6255-6264` | `emergencyHit` / `alertHit` → yeni saf kural |
| `automation.ts:6266-6275` | "aynı olay" türleri: `medical:<alt tür>` |
| `automation.ts:6290`, `:6323` | Öğe kipi ve risk türü: açık hükümde `safety_emergency` etiketi; rozetsiz sınıfta Acil önceliği yazılmaz |
| `automation.ts:6410` | can güvenliği |
| `sendDueAlerts` org seçimi | oto-yanıt / mesai / saat dilimi alanları (6 dk kuralı; `Message.ingestedAt`'ten sayılır) |
| `ai/life-safety.ts:86-91` | `medical` gerekçesi |
| `tasks/detect.ts:259` | Tıbbi okumanın yakaladığı mesajda (fiziksel tehlike yoksa) bakım görevi yok (S7) |
| `scripts/env-check.mjs:639` | `STRICT_ONE_FLAGS`'e yeni anahtarlar |
| `docs/RAILWAY-ACILIS-2026-10-15.md` | açılmayı bekleyenler listesi (pin `railway-doc-flags.test.ts`) |
| Anahtar 2: `fallback.ts:2925` (risk etiketi), QR `route.ts:872-873`, `:883-926`, `:810` / `:914` | Kapı / QR. Tıbbi kayıt sebebi kapalı kümeye eklenir (`risk-events.ts:72-73`; kolon metin, migration yok); rapor sayfası sayımı bağlanır. |

**Anahtar kuralları:**
- Yalnız `"1"` açar; varsayılan kapalı.
- Çağrı anında okunur; geri dönüş için yeniden dağıtım gerekmez.
- **Kapalıyken çıktı bayt bayt bugünkü:** okuyucuların bugünkü fonksiyonları değişmez, yeni fonksiyonlar çağrılmaz.
- Migration ve şema değişikliği yok.

### 5.2 Gölge kip (isteğe bağlı, Dilim 4)

- **Ne yazar:** her cevapsız mesaj için "yeni kural açık olsaydı ne derdi" satırı, var olan yalnız-ekle olay günlüğüne (`logEvent`, 90 gün, metin
  taşımaz). Bu satır karar kaydına (`RiskEvent`) yazılmaz, çünkü karar kaydı ev sahibinin rapor sayfasında sayılıyor.
- **Rapor:** salt okuma betiği; kurucu org için mesaj metni yalnız kurucunun makinesinde, öteki işletmeler için yalnız sayı.
- **Sınır:** ~10 dairede bir hafta birkaç isabet görür. Gerçek dilde **yanlış alarmı** ölçer, **yakalamayı** ölçemez. Bu yüzden geçmiş taraması
  şart, gölge isteğe bağlı (S12).

### 5.3 Test planı (K2: kırmızı-önce · iki yönlü mutasyon · entegrasyon · tam kapı)

**Saf testler** (her biri anahtar açık ve kapalı iki kez koşar):
- **Uyarı kuralı tablosu:** §3'ün tamamı. Kapalıyken bugünkü kuralın kopyasıyla birebir aynı sonuç.
- **Tıbbi tablo:** 7 dil × (açık: bildirim, kişi öznesi, yardım sorusu) × (olası: soru, geçmiş, uzak geçmiş, aktarım, bitmiş, alışkanlık,
  duygu nedeni, "passed out") × (yok: koşul, Fransızca "s'il", olumsuz, abartı, Türkçe övgü, hava şikâyeti).
- **10-31 görülmüş setleri:** anahtar açıkken yeni yanlış 0, kayıp 0 (ölçüldü 0/287, 0/315).
- **Dilim 0 tablosu:**
  - "Musluktan su fışkırıyor" → olası.
  - "…fışkırıyorsa ne yapayım?" → yalnız anılış.
  - "Eşim banyoda bayıldı" → etiket modelle kalkmaz.
  - "Çocuklar havuza bayıldı" → maskeli kalır.

**Kırmızı-önce:** testler önce bugünkü kodda koşulur. "Babam nefes almıyor" → uyarı ve "Ev yanıyor" → uyarı beklentileri kırmızı olmalı;
kapalı-anahtar beklentileri yeşil olmalı.

**Mutasyon** (yalnız `scripts/mutation-run.mjs`, M0 kontrol koşusu zorunlu):
- **Kaldırma yönü (yakalanmalı):** açık-tek-başına dalı · tıbbi bağlantı · her koruma ailesi tek tek · ısı abartısı · uyarı etiketi
  bağlantısı (öğe kipi testi kırmızı olmalı) · can güvenliği `medical` gerekçesi · `medical:` alt türü · 6 dk bekleme · ipucu listesi.
- **Aşırı uygulama yönü (yakalanmalı):**
  - "yalnız tıbbi olası hariç" koşulunu sil → "Dün annem bayıldı ama şimdi iyi" uyarır;
  - korumayı her zaman doğru yap → olumlu satırlar düşer;
  - ısı bağlamını her zaman doğru yap → "Ev yanıyor" düşer;
  - anahtar okumasını her zaman açık yap → kapalı bayt-bayt testi kırmızı;
  - ambulans istisnasını bütün türlere yay → bitmiş olay uyarır.

**Entegrasyon (gerçek veritabanı; e-posta ve WhatsApp casusları; anahtar ortam değişkeniyle):**

| # | Kurulum | Beklenen |
|---|---|---|
| a | Oto-yanıt kapalı + "Babam nefes almıyor" | Kapalı: hiçbir şey, konuşma Yeni. Açık: doğru alıcıya (işletmenin uyarı adresi, yoksa sahibi) "⚠️ Acil misafir mesajı"; konuşma Sorunlu + Acil + `safety_emergency`; karar kaydı; WhatsApp aynı anda; ikinci geçişte ikinci e-posta yok. |
| b | Konuşma öğeleri açık + "Ev yanıyor" | Sorunlu + e-posta. Kırmızı-önce: etiket bağlantısı olmadan e-posta hiç gitmiyordu. |
| c | Kontroller (§3, 22–36) | Hiçbir şey; oto-yanıt açık işletmede cevap normal akışta. |
| d | Sorunlu konuşma | "Annem bayıldı, ayılmıyor" → uyarı · "Hâlâ ayılmadı" → yok · "Şimdi nefes almıyor" → yeni · "Mutfakta yangın var" → yeni. |
| e | E-posta düştü | Talep geri alınır, sonraki geçiş yeniden dener. |
| f | Çıplak "Annem bayıldı" | Oto-yanıt kapalı: hemen rozetsiz uyarı. Oto-yanıt açık + mesai içi: 5. dakikada yok, 7. dakikada cevapsızsa var, arada cevap varsa yok. Geç gelen mesajda süre sisteme geliş anından sayılır. |
| g | Anahtar 1 açık, Anahtar 2 kapalı, QR + "Babam nefes almıyor" | QR davranışı bugünküyle aynı. |
| h | Görev özelliği açık | "Babam nefes almıyor" bakım görevi açmaz; "Ev yanıyor" bugünkü yangın görevini açar. |

**Tam kapı:**
- `npm test` (paralel kapı) + build. Push sonrası CI sonucu kontrol edilir.
- Pinler: `railway-doc-flags`, `env-strict-flags`, `brand-name-absent` (fikstürde mülk adı "Lale").
- Raporda KOD / CI / DEPLOY / PROD ayrı yazılır.

### 5.4 Süre pini (misafir metninde karesel iş yok)

**Kalıp kuralları:**
- Her kalıp sabit sözcükle başlar.
- Tekrarlar sınırlıdır.
- Gövdeden önce sınırsız geriye bakış yoktur; alternatif başına geriye bakış da yoktur (tek ön sınır).
- Metin 8.000 kod noktasında kesilir; yan cümle tavanı 64.

**Ön süzgeç zorunlu:** tıbbi / gaz kökü yoksa yeni kalıplar hiç koşmaz. Aynı mesaj uyarı geçişinde bir kez okunur (önbellek).

**Ölçüm:**
- Hakem, varsayılan kipte 8.000 karakterlik girdilerde tıbbi okumayı ≤6 ms ölçtü; büyüme doğrusal.
- En kötü düzenli ifade kipi uygulamada ölçülecek.

**Pinler:**
- Yeni `*-cost.test.ts`: 4.000–50.000 karakter; uzun tek sözcük, boşluk dizisi, tekrarlanan kök, çok baytlı karakter dizisi; eski / yeni sonuç
  kıyası.
- `regex-worst-mode-cost.test.ts` listesine yeni okuyucu (iki kötü kip, sınır 1,5 sn).

### 5.5 Geri alma ve riskler

**Geri alma:**
- Anahtar silinir ya da `0` yapılır; sonraki geçişte bugünkü davranış döner.
- Yazılmış Sorunlu / karar kaydı satırları bugünkü akışın satırlarıdır, silinmeleri gerekmez.
- Dilim 0 ayrı commit'tir ve gerileme düzeltmesidir; geri alınması önerilmez.

**Riskler:**
1. **Yanlış ACİL (en büyük risk).** Ev sahibine gece gereksiz e-posta + WhatsApp gider. Konuşma Sorunlu olur ve o konuşmada yapay zekâ ev
   sahibi devralana kadar durur. Önlem: kör set, gerçek geçmiş, süzgeçler, kademeli açılış.
2. **Belirsiz biçimlerde kaçırma.** Çıplak "bayıldı", "passed out", oda + "yanıyor" + sıcak gerçekten iki anlamlıdır. Kod bunları ACİL'den
   indirir; bedeli, model yokken bu biçimlerdeki gerçek acilin rozetsiz uyarı alması ya da hiç uyarı almamasıdır (S1, S6).
3. **Bakım.** Tıbbi sözcükler artık üç yerde yaşar: sözcük ağı, can güvenliği listesi, yeni okuma. Yeni okuma bir liste değil, "olay öbeği +
   koruma" katmanıdır. Uzun vadede can güvenliğinin tıbbi satırı yeni okumadan türetilebilir; bu ayrı karar.
4. **Uyarı geçişinden önce otomatik cevap çağıran yeni bir yol eklenirse** bu kemer kalkar. Önlem: sıra pinlenir (entegrasyon testi).

---

## 6. Kurucuya sorular (önce / sonra örnekli)

**S1 — Çıplak "Annem bayıldı" ne olsun?**
- **Bugün:** model yokken hiçbir şey.
- **Önerim:**
  - Model cevap veremiyorsa: Acil rozetsiz uyarı (e-posta + WhatsApp hemen, Sorunlu).
  - Model cevap verebiliyorsa: önce 6 dakika model bakar, konuşma hâlâ cevapsızsa aynı uyarı.
  - "Annem bayıldı, ayılmıyor / ne yapalım / yardım edin / ambulans" → ACİL.
- **Bedeli (ölçüldü):** "Çocuklar bayıldı, tekrar geleceğiz" model yokken rozetsiz uyarı üretir.
- **Seçenek:** çıplak biçim de ACİL olsun. O zaman aynı övgü cümlesi gece Acil e-posta + WhatsApp üretir (A ve B tasarımlarında ölçüldü).
- **Seçenek:** çıplak biçim hiç uyarmasın. O zaman gerçek "Annem bayıldı" model yokken kaybolur.

**S2 — Uyarı geçişi model çalışırken de otomatik cevaptan önce koşsun mu?** (Önerim: evet; bugünkü düzen bu, 10-31 kararıyla aynı.)
- **Bugün:** oto-yanıt açık işletmede "Ev yanıyor" kelime kapısına takılmıyor. Model ve anlama katmanı ikisi birden "risk yok" derse cevap
  gidebilir; kod kemeri yok.
- **Sonra:** konuşma ≤2 dakikada Sorunlu olur; misafire o tur otomatik cevap gitmez; ev sahibine ACİL uyarı.

**S3 — Isı abartısı yalnız uyarıda uygulansın mı?** (Önerim: evet.)
- **Örnek mesaj:** "Ev yanıyor sıcaktan, klimanın kumandası nerede?"
- **Sonra, kanal:** yeni uyarı yok.
- **Sonra, QR:** bugünkü gibi modelsiz devir (gevşeme yok).
- **Değişmeyen:** çıplak "Ev yanıyor" ACİL kalır.
- **Alternatif:** okuyucunun kendisinde "açık" yerine "olası" demek; QR'da da model karar verir. Bu bir gevşetme olur, önermiyorum.

**S4 — Bir okuyucu, iki anahtar mı?** (Önerim: evet, önce Anahtar 1.)
- **Anahtar 1:** misafir tarafında yalnız S2'deki "o tur cevap gitmez" etkisi var.
- **Anahtar 2, örnek QR:** "Babam nefes almıyor".
  - Bugün: model yokken normal devir (5 dk soğuma, kritik değil); model varken model cevaplayabilir.
  - Sonra: model çağrılmadan kritik devir; misafire cevap gitmez.
- **Anahtar 2, örnek kanal kapısı:** "Il est inconscient" bugün kelime kapısına takılmıyor; sonra tutar.
- **Öneri:** Anahtar 2, Anahtar 1'den 1–2 hafta sonra ayrı onayla açılsın.

**S5 — "Olayın ardındaki yardım sorusu soru değildir" kuralı 10-31 kişisel türlerine de uygulansın mı?** (Önerim: evet.)
- **Bugün:** "Biri kapıyı zorluyor ne yapalım?" olası sayılıyor, model yokken uyarı yok. Virgüllü yazımı ("…zorluyor, ne yapalım?") ACİL.
- **Sonra:** ikisi de ACİL.
- **Aynı turda:** Fransızca "S'il force la porte, que faire ?" bugün yanlış ACİL alıyor. Bitişik "s'il" koşul sayılınca uyarı yok olur.

**S6 — İngilizce "passed out" olası kalsın mı?** (Önerim: evet.)
- **Doğru davranış:** "My kids passed out as soon as we arrived, they loved the beds!" → uyarı yok.
- **Bedeli:** "My wife passed out in the shower" → model yokken uyarı yok (kaçar); model varsa model karar verir.
- **Seçenek:** kişi + "passed out" ACİL olsun. O zaman uyku cümleleri gece Acil üretir.

**S7 — Tıbbi mesajdan bakım görevi açılmasın mı?** (Önerim: açılmasın, eski durumda da.)
- **Bugün:** görev özelliği açıksa "Annem bayıldı" temizlikçinin listesine "acil güvenlik" bakım görevi açıyor.
- **Sonra:** tıbbi okumanın yakaladığı mesajda (açık ya da belirsiz; fiziksel tehlike yoksa) görev yok; uyarı ve Sorunlu aynen kalır.
  Çıplak "Annem bayıldı" da buna dahil.
- **Değişmeyen:** "Ev yanıyor" yangın görevini bugünkü gibi açar.

**S8 — Model yokken olası su uyarsın mı?** (Önerim: hayır; üç tasarım da aynı yönde.)
- **Örnek mesaj:** "Musluktan su fışkırıyor".
- **Bugün ve sonra:** model yokken uyarı yok. Dilim 0 ile, oto-yanıt açık ve anlama katmanı düşükken "olası tehlike" e-postası (saatte 3) geri gelir.
- **Seçenek:** model yokken olası su da uyarsın. O zaman "Kombiden su damlıyor" gibi mesajlar da Acil olur.

**S9 — Kendine zarar ayrı tasarım mı?** (Önerim: evet, bu belgenin hemen ardından öncelikli.)
- **Bugün:** "Kendimi öldürmek istiyorum" hiçbir ağda yok. "I want to kill myself" sözcük ağında var, ama uyarı geçişine ulaşmıyor.
- **Neden ayrı:** ev sahibine gidecek metin ve "kime haber verilir" sorusu tıbbiden farklı.

**S10 — Gaz soru biçimleri.** (Önerim: bu dilimde yeni biçim bugünkü biçimle aynı davransın; soru yanlış alarmı ayrı karar.)
- **Bugün (ölçüldü):** "Kombi gaz kaçıyor mu nasıl anlarız?" ve "Gaz kaçıyor mu diye kontrol ettim, sorun yok" kanalda **zaten ACİL** uyarı
  alıyor. Okuyucu "gazda şüphede açık" diyor, sözcük ağı da tutuyor. Aynı cümlelerin ettirgen biçimi ("gaz kaçırıyor mu …") uyarı almıyor,
  çünkü okuyucu bu biçimi tanımıyor.
- **Sonra:** ettirgen biçim de ACİL olur (ölçüldü). Kural tutarlı olur: biçim değişince hüküm değişmez.
- **Seçenek:** iki biçim birlikte soru / koşul korumasına alınsın. "Kombi gaz kaçıyor mu nasıl anlarız?" o zaman uyarı almaz. Bu bugünkü
  davranışı **gevşetir**; gazda "şüphede uyar" kararınıza dokunur, ayrı test ister.

**S11 — Ambulans / hastane çağrıldıysa olay "bitmiş" sayılmasın mı?** (Önerim: evet; misafir daireden ayrılıyor olabilir, ev sahibi bilmeli.)
- **Sonra ACİL (öngörülen; istisna B tasarımından, prototipte yok):** "Annem bayıldı, şimdi kendine geldi ama ambulans çağırdık" (bugün
  hiçbir şey; birleşim benzetiminde de "bitmiş olay" sayılıp uyarı yok).
- **Uyarı yok:** "Dün annem bayıldı ama şimdi iyi" bugün de sonra da.

**S12 — Açılış ölçümü.** (Önerim: kör set + gerçek geçmiş şart, gölge haftası isteğe bağlı.)
- **(i) Kör set:** ayrı yazar.
- **(ii) Gerçek geçmiş:** Railway açılınca, sizin makinenizde, salt okuma. Kurucu org için yalnız sizin göreceğiniz liste, öteki işletmeler için
  yalnız sayı.
- **(iii) Gölge haftası:** bir hafta yalnız kayıt.
- **Bugün:** sayılar yalnız bizim yazdığımız kümelerden.
- **Sonra:** gerçek misafir dilinde kaç yeni ACİL çıktığı tek tek okunmuş olur. Örneğin geçmişte "Çocuklar bayıldı, tekrar geleceğiz" gibi bir
  mesaj varsa açılıştan önce görülür ve süzgeç düzeltilir.

**Haber (soru değil):** Dilim 0'daki Y1 ve Y2 gerileme / sıkılaştırma düzeltmeleridir; anahtarsız ve ayrı commit olarak gelir.

---

## 7. Kapsam dışı

**Gevşetmeler (her biri ayrı karar + ayrı test):**
- QR'da model yokken bugünkü yanlış kritik devirler ("Bayıldım, harika bir ev!", "Gaz ocağı var mı?").
- Bugünkü kanal uyarı yolunun mevcut yanlış alarmları ("Gaz kaçağı vardı, tamirci geldi düzeltti", "Balkonda mangal yanıyor…",
  gaz soru biçimleri — S10).

**Bu belgede dokunulmayan yollar:**
- Kendine zarar (S9; ayrı tasarım).
- QR'da WhatsApp yokluğu (ayrı dilim).
- Ev sahibinin elle açtığı konuşma yolu (`applyInboundMessageRules`).
- 8.000 karakter üstü uzun mesaj yolu (K10-t).
- Acil sözcük ağının kendisi.
- "Olası tehlike" e-postasının metni ve tavanı.
- Saatlik e-posta tavanı (eklenmiyor).
- Model, istem, anlama katmanı: değişiklik yok. Misafire giden hiçbir metin değişmez.

**Ayrı küçük sözlük dilimi (okuyucu boşluğu; üç tasarımın üçü de kaçırdı):**
- "Çamaşır makinesi yanıyor"
- "Se está quemando la cocina"
- "Salon yanıyor yardım"
- "boru patladı"

**Ayrı iş:** Mevcut tehlike okuyucusunun en kötü düzenli ifade kipindeki süresi. Ayrıntısı repo dışında tutuldu.
