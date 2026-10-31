-- ---------------------------------------------------------------------------
-- OTO-YANIT AKTİF SAAT PENCERESİ — VARSAYILAN 0/9 → 0/0 (kurucu iş emri, 09-11)
--
-- 🚨 ÖLÇÜLEN CANLI KUSUR. `isWithinActiveHours` "start == end → TÜM GÜN" kuralını
-- uygular; 0/9 ise `hour >= 0 && hour < 9` demektir, yani AI günün yalnız 9
-- saatinde (00:00–08:59 org saatinde) çalışır ve **15 saatinde SUSAR** — üstelik
-- susan 15 saat misafir trafiğinin tamamına yakınını kapsar. Saat 09:05'te gelen
-- bir soru en erken ERTESİ GECE 00:00'da cevaplanır (~15 saat); misafir o gece
-- yarısından önce çıkış yaparsa `reservation_ended` ile HİÇ cevaplanmaz.
--
-- Uygulama katmanı 07-31'de yeni org'ları kurtardı (`NEW_ORG_AUTO_REPLY_WINDOW`
-- = 0/0, kayıt rotalarında açıkça yazılıyor) ama:
--   (a) ŞEMA VARSAYILANI hâlâ 9 ve bu bir TUZAK — org yaratan üçüncü bir yol
--       (seed, davet akışı, test fikstürü) eklendiği an sessizce gece-only bir
--       org doğar;
--   (b) düzeltmeden ÖNCE kurulmuş org'lara geriye dönük UYGULANMADI. 55
--       migration'ın tamamı tarandı: bu iki kolona dokunan başka hiçbir UPDATE
--       ya da backfill YOK (yalnız 00_init'teki CREATE TABLE). Kodun kendi
--       yorumu da bunu yazıyor: "mevcut TÜM org'ları (kurucu org dâhil) gündüz
--       boyunca ilgilendiriyor".
--
-- ⚠️ Bu arada satış sayfası üç yerde "7/24" diyor → vaat ile davranış çelişiyor.
-- ---------------------------------------------------------------------------

-- 1) Şema varsayılanı. Yalnız katalog değişikliği: mevcut satırları YENİDEN
--    YAZMAZ, tablo kilitlenmez, yeni INSERT'ler 0 alır.
ALTER TABLE "Organization" ALTER COLUMN "autoReplyEndHour" SET DEFAULT 0;

-- 2) DAR BACKFILL — yalnız HİÇ ELLENMEMİŞ satırlar.
--
-- 🚨 KAPSAM BİLİNÇLİ OLARAK DAR: koşul tam olarak eski ŞEMA VARSAYILANIDIR
-- (0/9). Host'un bilinçli seçtiği HER pencere (22/6 gece sessizliği · 8/20
-- mesai · 0/0 zaten 7/24) DOKUNULMADAN kalır. "0/9'u bilinçli seçen host"
-- teorik olarak mümkündür ama o değer eski varsayılanla BİREBİR aynıdır ve
-- ayırt edilemez; yön kuralı burada AI'ın çalışmasından yana: 15 saat susan
-- bir üründen, gece penceresini yeniden kurması gereken bir host daha iyidir
-- (ve o host ayarı Ayarlar → AI ve Otomasyon'dan tek ekranda geri alır).
--
-- GERİ ALMA (gerekirse, tek satır):
--   UPDATE "Organization" SET "autoReplyEndHour" = 9
--    WHERE "autoReplyStartHour" = 0 AND "autoReplyEndHour" = 0;
--   ALTER TABLE "Organization" ALTER COLUMN "autoReplyEndHour" SET DEFAULT 9;
-- ⚠️ Geri alma, backfill'den SONRA 0/0'a geçmiş org'ları da 0/9 yapar — yani
-- tam ters çevrilebilir DEĞİL. Bedeli kabul edildi (yön kuralı ↑).
UPDATE "Organization"
   SET "autoReplyEndHour" = 0
 WHERE "autoReplyStartHour" = 0
   AND "autoReplyEndHour" = 9;
