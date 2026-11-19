# Tasarım 2026-11-19 — Belirsiz gönderimi Lixus kendisi doğrular (AK-1 / KU-1)

> Kurucu 11-19 (AYNEN `docs/KURUCU-TALIMATI-2026-11-19-gece-raporuna-cevap.md`): "AK-1 gönderim neden doğrulanamadı mesela adamların
> mesajlarını görebiliyoruz ki onun mesaj sekmesine girsin varsa gitmiştir dediğin şeyler şuan saçma değil mi" · "KU-1 için belirsiz bir
> durum web sitemizde bizden kaynaklanmasın". Codex'in aktarılan cevabı aynı yönde, bir şartla: "sadece metin ve saate dayanarak bizim
> gönderdiğimiz sonucuna varmayalım … Kanal geçmişinde henüz görünmemesi ise tek başına tekrar gönderme sebebi olmasın."

## 1. Bugün (envanter, kodla doğrulandı)

- Kanala gönderimde (Hospitable `POST /reservations/{id}/messages`) bizim ürettiğimiz bir referans ya da tekrar-güvenlik anahtarı YOK; gövde
  yalnız metin. Başarılı yanıttan sağlayıcının mesaj kimliği okunur.
- Yanıt koparsa (zaman aşımı, 5xx, ağ) sonuç belirsizdir ve kimlik elimizde değildir.
- **Kuyruk yolu** (kalıcı kuyruk; canlıda KAPALI): satır "belirsiz"e gider, uzlaştırma 6 deneme / ~31 dakika sürer — ama varsayılan
  uzlaştırma kanalı HİÇ okumaz, hep "bulunamadı" der (`outbox/worker.ts defaultReconcile`). Sonunda satır "inceleme"ye düşer: "misafire
  ulaşmış olabilir; konuşmayı kontrol etmeden yeniden göndermeyin".
- **Doğrudan yol** (canlıda BUGÜN çalışan): cevap rotası "Gönderim doğrulanamadı — mesaj ulaşmış olabilir. Tekrar göndermeden önce konuşmayı
  kontrol edin." der; karar kartı "gönderim doğrulanamadı" kalır. Kanal okunmaz.
- Kurucunun itirazı haklı: konuşmanın kanal geçmişi zaten okunabiliyor (senkron her 2 dakikada okuyor); "siz bakın" demeden önce Lixus bakmalı.

## 2. Kural

Belirsiz gönderimden sonra Lixus kanal konuşmasını OKUR ve üç sonuçtan birine varır:

| Kanıt | Sonuç | Neden |
|---|---|---|
| Elimizde sağlayıcı kimliği var ve kanalda o kimlikli mesaj görünüyor | **Gönderildi** | kesin |
| Kanalda, bizim gönderim başlangıcımızdan SONRA, birebir aynı metinli, başka hiçbir kayda ait olmayan ev sahibi tarafı mesaj görünüyor | **Misafire ulaştı** (kanalda görünüyor) | Codex şartı: bu, "bizim isteğimiz başarılı oldu" iddiası DEĞİLDİR — ev sahibi aynı metni elle de göndermiş olabilir. Ama her iki durumda da misafir bu metni almıştır; ev sahibinin bilmek istediği budur. Kanıt türü ayrı kaydedilir ("içerikle görüldü") |
| Kanalda görünmüyor | **Henüz görünmüyor** → aralıklı yeniden bakılır; **asla kendiliğinden yeniden gönderilmez** | Codex: "görünmemesi tek başına tekrar gönderme sebebi olmasın" |

"Başka hiçbir kayda ait olmayan": o mesaj kimliği başka bir kuyruk satırının sağlayıcı kimliği değil ve yerelde başka bir mesaja bağlı değil
(aynı metni iki kez yazan ev sahibinin ikinci mesajı birinci gönderimi "doğrulamaz"). Aday birden çoksa en erkeni alınır.

Zaman penceresi: gönderim başlangıcının 2 dakika öncesi (saat kayması) … 24 saat sonrası. Başlangıç anı: kuyrukta "dış gönderim başladı"
işareti (11-19, K1), doğrudan yolda gönder'e basılan an.

Okuma yapılamazsa (sağlayıcı arızası, belirteç yok) karar verilmez, sonra yeniden bakılır. Bütün bakışlar bittiğinde hâlâ görünmüyorsa satır
incelemeye düşer — ama artık sebebiyle: "kanalda görünmüyor" (Lixus baktı) ile "kanal okunamadı" (bakamadı) AYRI kodlardır. Yalnız ikincisinde
"ulaşmış olabilir" dürüst bir cümledir (kurucu KU-1: "'Misafire ulaşmış olabilir' ancak buna rağmen sonuç bulunamazsa gösterilsin").

## 3. Yerleşim

- Kanal katmanı (`src/lib/channels`): giden adaptöre isteğe bağlı "konuşmayı oku" (`readThread`); Hospitable adaptörü var olan liste
  okumasını ve senkronun normalleştiricisini kullanır. Çekirdek sağlayıcıyı import etmez (sınır pini).
- Saf karar (`src/lib/outbox/reconcile-match.ts`): satırın metni + başlangıç anı + kanal mesajları + "başka kayda ait kimlikler" → sonuç.
  Metin karşılaştırması biçim farkını (satır sonu, baş/son boşluk, Unicode biçimi) yok sayar, içeriği değil.
- Kuyruk: varsayılan uzlaştırma bu kararı kullanır (6 deneme / ~31 dk; deneme sayısı ve bekleme bugünkü gibi).
- Doğrudan yol (cevap rotası, karar kartı): belirsiz sonuçtan hemen sonra bir kez bakılır; görülürse sonuç "gönderildi" gibi işlenir (mesaj
  satırı kanal kimliğiyle yazılır — senkron onu ikinci kez içeri almaz). Görülmezse bugünkü belirsiz yol; sonraki bakışlar ikinci dilimde
  (zamanlanmış iş, karar kartı "doğrulanamadı" kayıtları).
- KU-1: silinen konuşmanın gönderimi başlamış satırı da kuyrukta aynı uzlaştırmadan geçer (satır konuşmaya bağlı değil; kanal hedefini taşır).

## 4. Testler (kurucu / Codex: "iptalin kazandığı, kanalın kabul edip yanıtın kaybolduğu ve işçinin hazırlıkta çöktüğü durumları ayrı ayrı")

- İptal kazandı → istek atılmadı (11-19 K1, var).
- Hazırlıkta çöktü → "belirsiz" olmadan yeniden denenir (11-19 K2, var).
- **Kanal kabul etti, yanıt kayboldu** → uzlaştırma kanalda metni görür → "misafire ulaştı"; aynı metin bizim başlangıcımızdan ÖNCE yazılmışsa
  ya da başka kayda aitse → görmez; kanal okunamıyor → karar yok; hiçbir dalda yeniden gönderim yok.

## 5. Kurucuya (metin) — örnekli

Kuyruk ekranındaki inceleme satırı bugün: "İnceleme bekliyor — misafire ulaşmış olabilir; konuşmayı kontrol etmeden yeniden göndermeyin."
Öneri:
- Lixus baktı, görmedi: **"Kanalda görünmüyor — Lixus konuşmayı 30 dakika boyunca kontrol etti; mesaj misafire ulaşmamış görünüyor."**
  + [Yeniden gönder]
- Kanal okunamadı: **"Kanal şu an okunamıyor — gönderim doğrulanamadı."** (yeniden bakış sürer)
Cevap rotasındaki belirsiz cevap ve karar kartı metinleri ikinci dilimde, aynı ilkeyle.
