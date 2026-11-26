# Opus dilim sonu incelemesi — S2 (geç içeri alınan misafir mesajı) — 2026-11-12

Konu: `AI_LATE_MESSAGE_REPLY_ENABLED` (VARSAYILAN KAPALI). Tasarım `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §2.1–§2.3.
İncelenen aralık `5d6f91fc..8eab0c88`; düzeltmeler `e7335f78` · `f5b694a1` · `375355c2`.

Yöntem: Opus 5.5 ajanı kodu okuyarak 10 alanda inceledi (anahtar kapalı eşdeğerliği · yanlış gönderim · sıra varsayımları · gönderim yolları ·
döngü / maliyet · senkron yazıcısı · istek defteri / görünürlük · testler · ölçüm geçerliliği · tasarım belgesi). Her bulgu kodda yeniden
doğrulandı; ardından Haiku dar incelemesi ve mutasyon turu.

## Sonuç

- Anahtar KAPALIYKEN davranış değişmiyor (inceleme + Haiku + uçtan uca test).
- 2 ciddi (P1), 9 orta (P2), 13 küçük (P3) bulgu. Kodda doğrulananların hepsi düzeltildi ya da belgelendi; ikisi S2 dışı (ayrı kayıt).
- Mutasyon: 29/29 öldürüldü, M0 yeşil (`f5b694a1`).

## Bulgular ve yapılanlar

| Kimlik | Önem | Bulgu | Doğrulama | Yapılan |
|---|---|---|---|---|
| S2-4a | P1 (yalnız kuyruk yolu) | Geç mesajdan SONRA yazılıp cevabımızın gördüğü bir misafir mesajı varsa, geç mesaja bağlanan gönderim kimliği gönderim anı vetosuna takılıyor ("tetikten sonra misafir yazdı") → taslak iptal, tur her geçişte yeniden modelleniyor (24 saat). | Kodda doğrulandı (`outbox/worker.ts` tetik kıyası) | Şart 3: o durumda tur açılmaz. Birim + kuyruk entegrasyon testi. |
| S2-2a | P1 | Kaçırılan cevabımız soru / teklifle bitiyorsa, ondan ÖNCE yazılmış "Evet lütfen" ardına konunca o teklifin kabulü gibi okunur. | Kodda doğrulandı (`closableAfter` yolu) | Şart 4: cevabımız cevap bekliyorsa (`invitesAnswer`) tur açılmaz. Birim + entegrasyon + geliştirme setine üç senaryo. |
| S2-2b | P3 → gerçek | Geç "teşekkürler" cevabımıza saniyelerle yakın yazıldıysa gizleme kuralının 5 sn'lik damga kıyası onu son hareket sanar: konuşma listeden düşer, kısa nezaket cevabı gider. | Uçtan uca testte üretim biçimiyle kuruldu | Karar verilen mesaj ardına taşınmış geç mesajsa gizleme yok, nezaket cevabı yok. Entegrasyon + uçtan uca test. |
| S2-2c | P3 | "Kaçırılan cevabın yazarı" kontrolü yedekliydi (eşdeğer mutant). | Doğru | Tek taramaya indi; ölü "cevap yok" erken çıkışı da kaldırıldı. |
| S2-3a | P2 | İstem geçmişinde saatler geriye gidiyor; geç + yeni mesaj turunda model geç soruyu atlayabiliyor. | Ölçümde görüldü (2 senaryodan birinde geç soru açık kaldı) | İstem işareti ölçüldü ve DAHA KÖTÜ çıktı (geri alındı, `8eab0c88`). Görünürlük istek defterinde: açık kalan istek ev sahibine bildirilir. Belgede. |
| S2-3b | P3 | Dönen `late` değeri üretimde kullanılmıyordu. | Doğru | Artık kullanılıyor (S2-2b, S2-7a). |
| S2-5a | P3 | Saat dışı / günlük sınır beklemesi geç mesajı 24 saatin dışına itebilir. | Doğru | Belgede: o durumda bugünkü sonuç (konuşma "Yeni", ev sahibi görür). |
| S2-6a | P3 (S1'den kalma) | Cevabımız sağlayıcıdan AYRI bir ev sahibi satırı olarak geri gelirse geç mesaj görünmez kalabilir. | Doğrulanmadı | S2 dışı — açık işlere yazıldı. |
| S2-7a | P2 | İstek defteri yokken (anlama katmanı emin değil / plan hatası) geç turun cevabı giderse, cevabın karşılamadığı geç soru iz bırakmadan "Cevaplandı" olur. | Kodda doğrulandı | Defter (konuşma öğeleri) kapalıysa taşıma yok; defter açık ama tur bölünemediyse kapı tutar (`late_without_ledger`, kapının SON kontrolü). Birim + entegrasyon. |
| S2-8a | P2 | Senkron yazıcısı → zamanlanmış geçiş zincirinden geçen test yoktu. | Doğru | Yeni dosya `tests/integration/late-message-sync-to-reply.test.ts` (senkron → cevap → senkron; üç senaryo). |
| S2-8b | P2 | Kuyruk vetosu şekli testsizdi. | Doğru | Eklendi (S2-4a). |
| S2-8c | P3 | Boş-görünüm döngüsündeki çağrı hiçbir testle pinli değildi. | Doğru | Eklendi (ilk sayfa süzülünce boş kalan konuşma). |
| S2-8d | P3 | Kapanış testi üretimde ulaşılan dalı sınamıyordu. | Doğru | S2-2b testleri. |
| S2-9a | P2 | Ölçerde zamanlama gerçekçi değildi (1 dakika ara, son mesaj damgası "şimdi"). | Doğru | Geç mesaj cevabımızdan 4 sn önce; konuşmanın son mesaj damgası sağlayıcının son mesajı. |
| S2-9b | P2 | "Gitmemeli" sınıfları anahtar kapalı kolda da geçiyordu. | Doğru | "Tur açıldı mı" sayımı (açıldı / açılmadı · gizlenen kapanış hedef 0). |
| S2-9c | P3 | Geliştirme setinde eksik biçimler. | Doğru | Dört senaryo eklendi (teklif / soru ile biten cevap · iki tur sonrası). |
| S2-10a | P2 | Tasarım "kuyruk yolunda yanlış veto olmaz" diyordu — yanlış. | Doğru | §2.1 düzeltildi. |
| S2-10b–d | P3 | Tasarımın üç cümlesi kesin değildi (teslim doğrulaması modelden sonra · acil yolu · ev sahibinin teslim edilememiş cevabı). | Doğru | §2.1 düzeltildi; teslim edilememiş ev sahibi denemesi artık turu ev sahibine bırakır (şart 1, ham satırlarla). |

Haiku dar incelemesi (düzeltmeler üzerinde): temiz; tek bulgu — önizleme (deneme) kipi istek defterini kurmadığı için her geç turu "tutuldu"
gösterirdi → önizleme geç mesajı taşımaz (`375355c2`).

## S2 dışı, ayrıca doğrulanacak

- Kuyruk yolunda (anahtarı bugün kapalı) ev sahibinin teslim edilememiş cevabından sonra yapay zekâ taslağı OLAĞAN turda da gönderim anı
  vetosuna takılıp her geçişte yeniden üretilebilir (veto "tetikten sonra ev sahibi yazdı" sayımında teslim durumuna bakmıyor; akış o satırı
  görünümden süzüyor). İnceleme sırasında fark edildi, doğrulanmadı — `docs/claude/acik-isler.md`.

## Kural (bu dilimden)

- Bir mesajı "cevapsız tur"a taşıyan değişiklik, o turun GÖNDERİM KİMLİĞİNİN bağlandığı mesajı da değiştirir → gönderim anı denetimlerinin
  (veto, geçilmiş taslak) o mesaja göre ne göreceği ayrıca sınanır.
- Zamana bakan bir kural (5 sn tolerans gibi) eklendiğinde ölçer ve testler ÜRETİM zamanlamasıyla kurulur; dakikalık aralıklı fikstür o dalı
  hiç sınamaz.
- "Gitmemeli" beklentisi tek başına ayırt etmez: özellik kapalıyken de geçen beklenti, özelliğin mesajı sessizce düşürdüğü gerilemeyi kaçırır.
