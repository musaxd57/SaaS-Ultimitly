# İnceleme 2026-11-19 — kurucunun gece raporuna cevabı: madde madde durum

> Kaynak AYNEN: `docs/KURUCU-TALIMATI-2026-11-19-gece-raporuna-cevap.md`. Kurucunun kendi istekleri baştaki dört paragraf ve sondaki iki
> satır; ortadaki blok Codex'in aktarılan cevabı (kodda doğrulanarak uygulandı, kurucunun sözü önce gelir). Çalışma düzeni: kolay / orta
> kodu Opus 5.5 yazdı (push etmez), satır satır incelendi; zor kod ana oturumda; kontroller Haiku 5.5 alt ajanlarında.

## Durum tablosu

| Madde | Durum | Commit |
|---|---|---|
| vCPU sorusu | Cevaplandı: 4 vCPU / 15 GB; tam kapı veritabanlı kol tek sıra + veritabanısız kol 3 işçi, süre testleri en sonda (~40 dk) | — |
| Ödeme: iptal ≠ iade | ✅ Yazıldı | `4321526b` |
| ÖD-2 iki anahtar | ✅ Yazıldı | `e3cb5c4d` |
| ÖD-1 / ÖD-3 destek bağlantısı | ✅ Opus paketi, incelendi | `c3e87ea6` |
| AK-1 / KU-1 Lixus kendisi bakar | ✅ 1. dilim (anahtar KAPALI); 2. dilim + ev sahibi metinleri soruda | `961b00ff` |
| İK-1 | ✅ metin; `Mesajlara dön` düğmesi yapılamaz (aşağıda) | `37136970` |
| İK-2 | Zaten yapılmıştı (11-19 D3): iç kayıtta Gönder yok, "İç notlar" kartı ayrı | — |
| İK-3 | ✅ kısa onay (silme kalıcı — `deleteMany`, geri alma yok) | `52e7c10c` |
| EG-1 | ✅ yeni kuralda 30 dk başlangıç | `b60d2b83` |
| EG-2 | Anahtar zaten var (`EARLY_CHECKIN_FREE_ONLY_ENABLED`); pilot açılırken birlikte açılır (açılış belgesi) | — |
| EG-3 | Sentetik örnek bankası zaten var (30 örnek, iki ayrık küme); gerçek vakadan yeniden yazım + ham mesaj dışarı çıkışı AYRI onay | — |
| EG-4 | Tasarım + soru (aşağıda); kod yok | — |
| UA-1 | Sırada: tasarım → kod (karşılaştırma sayfası) | — |
| YÇ-1…3 | Onaylandı ("yç-1 önerin mantıklı"); Y2 anahtar arkasında sırada, açma model ölçümünden sonra (kredi) | — |

## 1. Ödeme — iptal ≠ iade (`4321526b`)

Bugüne kadar: para alınmış ama abonelik hesaba bağlanmamışsa, Paddle'da abonelik iptal görünce kayıt bırakılıyor ve yeni ödeme açılıyordu.
Şimdi kayıt YALNIZ aynı işlemin Paddle'da **onaylanmış (approved) TAM (full) iadesi** okunursa bırakılır:
- abonelik hiç kurulmamışsa: iade okumasından sonra işlem yeniden okunur; arada abonelik bağlandıysa bırakılmaz (yarış — Haiku incelemesi);
- abonelik iptalse: iade şart; iade yoksa kayıt "bekliyor" kalır, operatör paneli "iptal ≠ iade" der;
- bekleyen, reddedilmiş, kısmi iade, başka işlemin iadesi, iade okunamaması → bırakılmaz (yedi ayrı test);
- operatörün kanıtla bırakması eskisi gibi;
- normal kullanılmış ve sonradan iptal edilmiş abonelik bu kuralın konusu değil (yalnız "ödendi, bağlanmadı" kaydı).
Sınır: iade listesinin yalnız ilk sayfası (50 kayıt) okunur — güvenli yön (bulamazsa bırakmaz).

## 2. ÖD-2 — tek doğrulama kodu, iki anahtar (`e3cb5c4d`)

Ekranın anında doğrulaması `BILLING_INSTANT_LINK_ENABLED`, arka plandaki saatlik bağlama `BILLING_PAID_SWEEP_LINK_ENABLED` (ikisi de KAPALI).
Aynı çekirdek; biri kapalıyken öteki çalışır (testli). Yarışta plan bir kez açılır (11-19 P2 testleri, değişmedi).

## 3. ÖD-1 / ÖD-3 (`c3e87ea6`)

Destek e-posta bağlantısı bekleme cümlesinin altında BAŞTAN görünür. 2 dakika sonra bağlantının metni **"Destekle iletişime geç"** olur ve
yanında kısa takip numarası (ilk 8 karakter, sunucudaki `shortCorrelationId` ile aynı kural, testte pinli) + "Takip numarasını kopyala"
(tam numarayı kopyalar). "Ödemeniz alındı" yalnız sunucunun doğruladığı "ödendi" kaydında yazar (`lib/billing/checkout-pending-shared.ts`).

Açık nokta (soru Ö-a): anında doğrulama ekranındaki "Ödeme tamamlandı. Planınız hazır olduğunda…" cümlesi (sizin 11-18 metniniz) Paddle
ödeme penceresi "tamamlandı" dediğinde, sunucu doğrulamasından ÖNCE görünüyor. Codex'in "doğrulanmadıysa 'Ödemeniz alındı' yazmayalım"
şartına göre "Ödeme tamamlandı" da doğrulama sonrasına mı kalsın?

## 4. AK-1 / KU-1 — belirsiz gönderimde Lixus kanalı kendisi okur (`961b00ff`, anahtar `CHANNEL_SEND_RECONCILE_ENABLED` KAPALI)

Tasarım: `docs/TASARIM-2026-11-19-belirsiz-gonderimi-lixus-kendisi-dogrular.md`. Yanıt koparsa Lixus konuşmanın kanal geçmişini okur:
- elde mesaj kimliği varsa kimlikle → Gönderildi;
- kimlik yoksa: gönderim başlangıcından SONRA, aynı metinli, ev sahibi tarafı, başka hiçbir kayda ait olmayan mesaj → gönderildi sayılır,
  kayda ayrı kanıt kodu yazılır ("kanalda içerikle görüldü");
- görünmüyorsa → asla kendiliğinden yeniden gönderilmez; kuyrukta 6 bakış / ~31 dk sürer, sonra "kanalda görünmüyor" ile "kanal okunamadı"
  ayrı kodla incelemeye düşer.
- KU-1: silinen konuşmanın gönderimi başlamış satırı da aynı uzlaştırmadan geçer. İptalin kazandığı ve hazırlıkta çöken iş 11-19 K1/K2
  testleri, "kanal kabul etti, yanıt kayboldu" bu dilimin testi.

**Kurucu ile Codex'in ayrıştığı tek yer:** Codex "yalnız metin ve saate dayanarak bizim gönderdiğimiz sonucuna varmayalım" diyor; siz
"mesaj sekmesine girsin, varsa gitmiştir" dediniz. Sizin sözünüz uygulandı, Codex'in kaygısı iki yolla karşılandı: (a) metinle eşleşme
"bizim isteğimiz başarılı" diye değil "misafire ulaştı" diye kaydedilir (ayrı kanıt kodu) — ev sahibi aynı metni elle göndermiş olsa da
misafir metni almıştır; (b) aynı metni iki kez yazan ev sahibinin öteki mesajı, başka kayda ait olduğu için bu gönderimi doğrulamaz.

Bilinmeyen: Hospitable mesaj listesinde mesajın API'den mi uygulamadan mı yazıldığını ayıran bir alan olup olmadığı repoda doğrulanmadı
(belgesi bu ağdan açılmıyor). Varsa eşleşme daha da sıkılaşır.

2. dilim (sırada): doğrudan yoldaki (cevap rotası, karar kartı) "doğrulanamadı" kayıtlarının zamanlanmış yeniden bakışı + ev sahibine
görünen metinler — önce / sonra soruda (A-a).

## 5. İK-1 — `Mesajlara dön` neden yok

Ret yalnız ESKİ bir sekmede, eski formun kendi kodu içinde görünür; o kod sunucunun gönderdiği `error` metnini gösterir, sunucu oraya düğme
ekleyemez. Metin sizin cümleniz oldu: "Bu ekrandan artık konuşma oluşturulamıyor." Yeni sürümde form zaten yok.

## 6. EG-4 — "geçerli erişim hazır" ne demek (tasarım, kod YOK)

Envanter (Haiku, kodla doğrulandı): giriş bilgisi bugün serbest metin (bilgi tabanı kalemi / otomatik giriş mesajı şablonu); geçerlilik
saati alanı yok, akıllı kilit bağlantısı yok. Onay metni giriş bilgisi taşımaz; yalnız kuralın notu aynen eklenir. Yani Lixus bugün
"12:00'de bu kod çalışır mı" bilemez. Codex'in iki gözlemi de doğru: önceden gitmiş mesaj yetmez (kod saate bağlı olabilir), gitmemiş mesaj
da engel olmamalı (bilgi onayla birlikte güvenle verilebiliyorsa).

Öneri (soru E-a): kurala ev sahibinin AÇIK beyanı eklenir — "Giriş bilgisi erken saatte de geçerli" (varsayılan KAPALI). Otomatik onay
yalnız bu işaretliyse çıkar; değilse hazır cevap size gelir.
- Önce: daire hazır, ücretsiz, misafir 12:00 istiyor → "12:00'den itibaren giriş yapabilirsiniz." kendiliğinden gider; kapı kodu 15:00'te
  açılıyorsa misafir kapıda kalır.
- Sonra, işaret yok: aynı metin size hazır cevap olarak gelir; panelde "Giriş bilgisinin erken saatte çalıştığı belirtilmedi" satırı.
- Sonra, işaret var: onay kendiliğinden gider (bugünkü gibi).
Bedeli: işareti koymayan ev sahibinde otomatik onay hiç çıkmaz (dar pilot için doğru yön).

## 7. UA-1 ve YÇ (sırada)

- UA-1: "Bu rezervasyon Lale 3 ve Lale 5'te görünüyor" + `Kayıtları karşılaştır` → iki kayıt yan yana (kaynak: kanal / iCal / elle;
  tarih, misafir, son eşitleme). Elle girilen kopyada "Bu kaydı kaldır"; kanaldan gelen kayıtta silme yok, kaynak bağlantısını düzeltme
  yolu (hangi takvim / ilan hangi daireye bağlı). Çözülene kadar kapı bilgisi gitmez (bugün zaten tutuluyor). Önce tasarım belgesi.
- YÇ: Y2 — cevabın değinmediği istek açık kalır; etiketler "Havlu teslimi bekleniyor" · "Onarım bekleniyor" · "Onarım tamamlandı · misafir
  teyidi yok"; sessizlik teyit sayılmaz. Anahtar arkasında yazılır, model ölçümünden sonra açılır.
