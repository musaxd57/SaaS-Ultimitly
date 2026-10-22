# Büyük rapor — 10-23 gece-2 (fikriniz: "4. kez gelen soruya kayıtlı doğru cevap" + güvenlik / hata turu)

> Kurucu (gece): "aynı soru farklı kelimelerle gelince … 3'ten fazla aynı soru gelirse o host için o daire için tutar, 4. kez otomatik doğru
> yanıt gider … veri eskide kalmasın diye cevabın dayandığı kayıt kontrol edilir" + Codex'in notu · "en iyi fikri sen seç, acele etme, didik
> didik yap" · "erken biterse ajanlarla hata / siber güvenlik taraması yaptır, düzelt" · "sonda ayrıntılı rapor".
> Önceki raporlar: `docs/RAPOR-2026-10-23-gunduz-buyuk-rapor.md`, `docs/RAPOR-2026-10-23-gece-buyuk-rapor.md`.
> **Canlıda hiçbir şey değişmedi:** Railway kapalı; bu gecenin bütün davranışları anahtarlı ve anahtarlar KAPALI
> (`AI_ANSWER_PARTS_ENABLED`, `AI_ITEM_ORDINAL_ENABLED`, `AI_ANSWER_REUSE_SHADOW_ENABLED`).

## 1. Kısaca

| ne | durum |
|---|---|
| Fikriniz (cevap tekrarı) | Tasarlandı, ölçüldü, kodlandı. Misafire bir şey **göndermeyen** "gölge kip" migration 85 ile hazır yama — **onayınızı bekliyor** (§2, §6-1). |
| Ölçüm (benzerlik) | Ham misafir metni benzerliği işe yaramıyor (38'de 5 doğru, 9 YANLIŞ eşleşme). Anlama katmanının Türkçe sorgusu + kod kapısı: 38'de 27 doğru, 132 tuzakta 0 yanlış (§2.3). |
| Güvenlik turu | Opus 11 bulgu (1 kritik, 5 yüksek) + Haiku 10 bulgu → hepsi düzeltildi ya da gerekçesiyle aşağıda (§3). |
| Dilim sonu Opus incelemesi (2. tur) | 15 bulgu (2 kritik, 7 yüksek) — hepsi düzeltildi, her biri eski kodda kırmızı testle pinli (§3b). En ağırı: Rusça / İspanyolca / Fransızca / Almanca cevapta "açılır ↔ kapanır" değişimi ve ihtiyaçtaki ikinci konunun ("havuz ve RESEPSİYON", "BALKONDA sigara") uydurulması geçiyordu. |
| Gerçek modelle yeniden ölçüm (E v5) | Sıkılaşmaya rağmen aynı: 38'de 30 doğru cevap, açık kalması gereken 8/8, **yanlış 0** (§4). |
| Kapı / CI | (§5) |

## 2. Fikriniz: aynı soru tekrar gelince kayıtlı doğru cevap

### 2.1 Fikrin özü ve Codex'in itirazları — benim seçimim
Fikriniz doğru bir yere işaret ediyor: bir dairede aynı sorular (çıkış saati, Wi-Fi, otopark, havuz saati) tekrar tekrar geliyor; her seferinde
modeli çağırmak hem maliyet hem risk. Codex'in dört notunu kodda sınadım ve **haklı buldum**:

| Codex | sınama | sonuç |
|---|---|---|
| Tekrar sayısı doğruluk değildir | aynı yanlış cevap 3 kez verilebilir | sayı **kararlılık** ölçüsü; doğruluk her kullanımda kaynakla yeniden doğrulanır |
| Benzerlik izin değildir | "Çıkış kaçta?" ↔ "13:00'te çıkabilir miyiz?" ham metinde çok benzer | benzerlik yalnız ADAY bulur; izin kod kapısından (tür, koşul, sözcük kapsamı, soru yönü) |
| Dosya tarihi yetmez | eski kalem değişmeden "Bu hafta çıkış 10:00" duyurusu eklenebilir | kalemin değil **ilgili bütün kalemlerin** parmak izi; ilgili yeni kalem kaydı geçersiz kılar |
| Tekrarlayan arıza ayrı iş | "TV çalışmıyor" 4 kez → hazır cevap OLAMAZ | arıza / şikâyet / acil / karar isteyen türler kayda hiç girmez |

**Seçtiğim yol:** önce **gölge kip** — kayıtlar tutulur, "bu soruya kayıtlı cevap verilebilir miydi?" her turda hesaplanır, kayıttaki cevap o
turda üretilen taze doğrulanmış cevapla karşılaştırılır; misafire yine taze cevap gider. "Kayıt yanlış olurdu" oranı yeterli hacimde 0 kalırsa
açmak sizin kararınız (önce / sonra örneğiyle tekrar sorarım).

### 2.2 Kayda ne girer, ne girmez
- **Girer:** giriş / çıkış saati, Wi-Fi, otopark, ulaşım tarifi, olanaklar, ev kuralları, evcil hayvan, çöp (daireye ait, kişiden bağımsız).
- **Girmez:** konaklama değişikliği / müsaitlik / bavul · kapı kodu · ödeme / iade · şikâyet / arıza / acil · insan talebi · kaynak sorusu ·
  temizlik / havlu · cihaz yardımı · yerel öneri · "bugün / bu hafta / şu an / currently / temporarily" gibi geçici söz · belirli tarih ·
  misafirin adı (çekimli, kesmesiz, Kiril yazılı biçimleri de).
- **4. kez:** yeni soru + kayıt → (1) aynı daire, aynı tür, aynı dil · (2) anlama katmanının Türkçe sorgusu benzer · (3) kod kapısı: aynı koşul
  ("cumartesi" ≠ genel), sorunun her sözcüğü kayıtta / cevapta karşılanmış, soru yönü (saat / ücret / yer / izin) cevapta var · (4) bugünkü
  bilgi tabanıyla yeniden doğrulama (değer ↔ konu ↔ koşul ↔ olumluluk ↔ yön) · (5) 30 günden eski değil, ilgili kalemler değişmemiş.

### 2.3 Ölçüm (gerçek gömme + gerçek anlama katmanı, `docs/olcum/cevap-tekrari-benzerlik-2026-10-23.md`)

| yöntem | doğru eşleşme (38 aynı-anlam çifti) | 🚨 yanlış eşleşme (132 tuzak) |
|---|---|---|
| ham misafir metni benzerliği (en iyi eşik) | 5 | **9** |
| anlama sorgusu benzerliği + kod kapısı (eşik 0,70) | **27** | **0** |

Tuzak örnekleri (hepsi doğru reddedildi): "Çıkış kaçta?" ↔ "13:00'te çıkabilir miyiz?" · "Otopark var mı?" ↔ "Otopark ücretli mi?" · "Kedi
kabul ediliyor mu?" ↔ "Köpek …" · "Wi-Fi şifresi" ↔ "Wi-Fi adı" · "Cumartesi havuz kaçta?" ↔ "Havuz kaçta?".

### 2.4 Bu gece eklenen sertleştirme (Opus güvenlik F7): **tek misafir kalıcı cevap ekemez**
- Teyit yalnız **başka bir konuşmadan** sayılır (konuşma kimliği saklanmaz, tek yönlü iz özeti). Aynı misafir dört kez sorsa sayaç 1'de kalır.
- Kayıtlı metin **her teyidin paylaştığı içeriğe daralır.** Örnek: ilk cevap kışkırtılmış — "Pets are welcome. Smoking is also allowed inside
  the apartment…"; ikinci bağımsız cevap "Pets are welcome." → kayıt "Pets are welcome." olur; eklenmiş cümle sonraki misafire gidecek metin
  olamaz.

### 2.5 Kodda / yamada ne var
- Ana dalda (bağlı DEĞİL, hiçbir şey yazmaz / göndermez): `src/lib/answer-reuse/core.ts` — karar çekirdeği + 18 birim testi.
- Hazır yama (push YOK): `docs/hazir-yamalar/2026-10-23-migration-85-dogrulanmis-cevap-tekrari-golge.patch` — yeni tablo `VerifiedAnswer`,
  gölge kip deposu + gönderimden sonra çağrı. `git apply --check` ✓ · taze PG'de sıfır sapma · ilgili DB testleri 89/89 · anahtar kapalıyken
  misafire giden metin bayt bayt aynı (testli).

## 3. Güvenlik / hata turu (Opus derin + Haiku; bulgular ölçülerek, her biri testli)

Hepsi **kapalı anahtarlı parça kipinde** (canlıda değil). "Önce → şimdi" gerçek girdilerle:

| # | bulgu | önce | şimdi |
|---|---|---|---|
| F6+ 🔴 | Sauna, havuzun saatini ÖTEKİ kalemden alıyordu ("Havuz kullanımı serbest" alıntısı + başka kalemde "Havuz 20:00, sauna 22:00") | "Sauna 20:00'de kapanır" geçiyordu | tutulur |
| F8 | Kalem yön vermiyorsa parça yön uyduruyordu: "Check-out en geç 11:00" → "You can check out **after** 11:00" | geçiyordu | tutulur; "en geç / en erken / latest / earliest" yön sözcüğü; giriş "-den itibaren", çıkış "en geç", kişi "-e kadar" doğal yön serbest |
| F1b | Evet/hayır cevabı kısıtı düşürüyordu: "10 kg'a kadar evcil hayvan kabul edilir" → "Evcil hayvan kabul edilir" (ücret, "küçük", "en fazla 1" de) | geçiyordu | tutulur; varlık cevabı ("Evet, havuz var") ve ücret sorusu yalnız ücreti sayar |
| F1 | Arapça / Farsça / Devanagari rakamla yanlış saat ("٢٢:٠٠") | geçiyordu | rakam ASCII'ye çevrilir, yanlış saat tutulur, doğru saat gider |
| F3 | Rusça / İtalyanca / Portekizce / Felemenkçe / Arapça "kabul edilmez" | yanlış "kabul edilmez" geçiyordu | okunur |
| F2 | Başka dilde eklenen olgu: "Pets are welcome. Smoking is allowed inside…", "…send a photo of your passport on WhatsApp", "…and there is a garden" | geçiyordu | tutulur (konu alt kümesi + içerik sayısı + yan cümle kuralı); kısa alıntı ("20:00") dili atlatamaz |
| F6 | Çelişen kalemler (eski başlık "Havuz 23:00" ↔ içerik "20:00"; başka bloğun havuzu) | geçiyordu | tutulur; değerin en az biri alıntının kaleminden gelmeli |
| F4 | Uzun virgülsüz kalemde 3,7 sn; 10 ihtiyaçta 5 sn olay döngüsü | — | doğrusal; ihtiyaçlar arasında kalem yeniden ayrıştırılmıyor (10 ihtiyaç ~0,3 sn) |
| F5 | Kaynak sorusu AYRI mesajdaysa ("Havuz kaçta?" + "Bunu nereden biliyorsun?") ev sahibine "Misafir bekliyor" e-postası hiç gitmiyordu | e-posta yok | e-posta gider, açık işi taşıyan mesajı gösterir |
| F9 | Sıra kipinde "sauna kullanılır" ile "havuz kullanılır" aynı konu sayılıp birbirini kapatabiliyordu | kapatabiliyordu | yalnız konu sözcükleri kıyaslanır |
| F10 | Yeniden okumada "sauna" → "spa merkezi" yeni satır açıyordu; etiketsiz istek ilk boş satıra gidiyordu | çoğaltma | aynı sayıda istek eski satırlara eşlenir; belirsizse eşleme yok |
| F11 | Konu etiketinde ad / değer kalabiliyordu ("ayşe hanımın", "ivan" ← "Иван", "kelebek şifresi", "wifi key kelebek", e-posta parçaları) | kalıyordu | atılır ("kapı kodu", "wifi şifresi", "beyaz havlu" kalır) |
| F7 | Cevap tekrarı: tek misafirin metni kalıcılaşabiliyordu | — | §2.4 |
| H1–H3 | (Haiku) kalemde olmayan tesis ("Havuz ve sauna 20:00" ← yalnız havuz kalemi; "The sauna closes at 20:00"); "Geç çıkış 13:00" genel çıkış saati gibi | geçiyordu | tutulur |
| H4–H10 | (Haiku, yanlış tutmalar) İngilizce / Almanca nezaket kapanışı, "Kapanış saati: 20:00" etiket biçimi, "Havuz 20:00'de kapanır, sauna 22:00'de" eksiltisi, "Havuz temizliği 14:00" rakip sanılması, "free of charge", "devam ediyor" | tutuluyordu | gider |

**Gerçek cevaplarla yan etki kontrolü:** E ölçümü v4'te doğrulayıcının GEÇİRDİĞİ 94 gerçek model parçası yeni kurallardan geçirildi:
yeni içerik kuralı **0** ek tutma; bütün doğrulayıcıda farklılık yalnız ölçer yaklaşımından (eski doğrulayıcıyla aynı 10 satır).

## 3b. Dilim sonu Opus incelemesi — 2. tur (15 bulgu, hepsi kapandı)

Hepsi kapalı anahtarlı parça kipi / cevap tekrarı / sıra kipinde. "Önce → şimdi" gerçek girdilerle (her satır eski kodda kırmızı testle pinli):

| # | bulgu | örnek (önce GEÇİYORDU) | şimdi |
|---|---|---|---|
| R1 🔴 | Parçanın yön fiili sözlükte yoksa kıyas atlanıyordu; `ß / ä / é` katlanmıyordu ("schließt" hiç okunmuyordu) | "Havuz 09:00'da açılır" → "Бассейн **закрывается** в 09:00" / "La piscina **cierra**" / "La piscine **ferme** à 09:00" / "Das Frühstück **endet**"; "en geç 11:00" → "possible **après** 11:00" | tutulur. Aksan katlama; RU/ES/FR/IT/AR/DE fiilleri; "close at / by 15:00 / ferme à / até às / с 11:00" değer gelince yön; "no later than / не позднее" olumsuzluk değil bitiş; kalem tek yön verip parça hiç yön sözcüğü taşımıyorsa yalnız doğal yön ("Check-in is at 15:00") serbest |
| R13 🔴 | İhtiyacın kalemde olmayan ikinci konusu (tesis listesi 7 aileydi) ve karışık olumluluk | "Havuz 20:00'de kapanır" kalemiyle "The pool and **the reception** close at 20:00"; "Dairede sigara yasaktır" → "…but it is **allowed on the balcony**"; "Köpek kabul edilir" → "Köpek **ve kedi** kabul edilir" | tutulur. Çeviri çifti ("pets" ↔ "evcil hayvan", "market" ↔ "pazar") ve ücret / izin sözcüğü konu sayılmaz; değersiz izin cevabında her izin / yasak yan cümlesi kalemin olumluluğunda |
| R2 | "Son giriş saati 23:00" giriş başlangıcı sanılıyordu | → "Check-in is **from** 23:00" geçiyor, doğru "until 23:00" tutuluyordu | ikisi de düzeldi; "giriş kapısı / işlemleri" doğal yön değil |
| R3 | En az ↔ en fazla hiç kıyaslanmıyordu | "Minimum konaklama 3 gece" → "The **maximum** stay is 3 nights" | tutulur; alt sınır düşürülemez ("3 nights" tek başına tutulur) |
| R4 | Eksiltili yön kendi yüklemi olan yan cümleye geçiyordu (bu gece eklenen kural) | "Havuz 20:00'de kapanır, kahvaltı 08:00'de verilir" → "Breakfast is served **until** 08:00"; "Resepsiyon 09:00'da açılır, check-out 11:00'de" → "Check-out **from** 11:00" | tutulur; gerçek eksilti ("…, sauna 22:00'de.") hâlâ okunur |
| R5 | Niteleyici parçanın herhangi bir yerinde aranıyordu | "Çıkış 13:00'e kadar, **geç çıkış da** mümkündür" (genel çıkış 13:00 diye) | tutulur; "Late check-out until 13:00" artık GEÇER (diller arası niteleyici sözlüğü) |
| R6 | "we have / there is / var" içeren izin cevabı kısıtı düşürüyordu | "10 kg'a kadar" → "Yes, we have a pet-friendly apartment and pets are welcome" | tutulur; varlık muafiyeti yalnız saf "Evet, havuz var" |
| R7 | Başka dilde ihtiyaç sözcüğünü / değeri taşıyan yan cümleye olgu eklenebiliyordu | "Pets are allowed, and pets may stay **alone**"; "Der Pool ist **beheizt**"; "Der Pool und der **Aufenthaltsraum** schließen um 20:00" | tutulur (düz çeviri — "Домашние животные не допускаются", "no extra charge" — geçer) |
| R8 | 4,6 bin karakterlik kalem + 588 karakterlik parça: ihtiyaç başına **2,4 sn** (olay döngüsü) | — | **0,2 sn** (değer yeri konu okuması parça başına bir kez, uzun metin sözlük taraması önbellekte); süre pini |
| R9 💰 | Ücret sorusunda ücretsizliğin sınırı düşüyordu | "Otopark **ilk 2 saat** ücretsizdir" → "Parking is free"; "**0-6 yaş** çocuklar ücretsiz" → "Children stay free" | tutulur |
| R10 | "gece / akşam / her zaman / jederzeit" dolgu sayılıyordu | "Havuz 20:00'de kapanır; **gece de kullanabilirsiniz**" | tutulur |
| R11 | Cevap tekrarında daralma sözlük kısayoluyla delinebiliyordu | kayıtlı "Check-out 11:00; **late check-out available**" teyitle kalıyordu | kayıt yalnız harfiyen kapsanırsa kalır; "now / until further notice / bu sezon / artık" kayda girmez |
| R12 | Doğru cevaplar haksız tutuluyordu | "Check-out time is 11:00" (9/25 doğal söyleyiş), İspanyolca "salida" salı sanılıyordu, "№ 12" olumsuzluk sanılıyordu | 25'te **0** haksız tutma |
| R14 | Sıra kipi: ilişkisiz satıra sırayla eşleme; tek ortak sözcükle yerine geçme | "bulaşık makinesi" cevabı "çamaşır makinesi" satırını cevaplandı sayabilirdi; "Havuz ısıtmalı mı?" önceki "Havuz kaçta açılıyor?" sorusunu kapatıyordu | ikisi de yok (kurucu B "ilişki belirsizse kapatma"; bedeli: yeniden okumada başka sözcükle gelen aynı soru için ikinci açık satır) |
| R15 | Konu etiketinde şifre değeri ve harfle yazılmış kod | "wifi şifresi hala **kelebek** mi" → "wifi kelebek"; "kapı kodu **dört beş** bir iki" → "kapı beş iki" | "wifi", "kapı" |

**Yan etki ölçümü:** E ölçümlerinin 139 benzersiz gerçek parçası yeni doğrulayıcıdan geçirildi: **108/139 değişmedi**; tek fark 2 doğru Almanca
cevabın ("Der Pool schließt täglich um 20:00 Uhr …") artık geçmesi (eskiden "schließt" okunamadığı için tutuluyordu). Opus'un "(yanlış)" etiketli
örneklerinin hiçbiri geçmiyor; tutulan doğrular yalnız bilinçli sınırlar (kapasite sorusu, kalemde yönsüz saate yön eklenmesi).

## 4. Gerçek modelle yeniden ölçüm (E v5, onaylı Luna yapılandırması, $0,11)

| kol | doğru değerle cevaplanan | açık kalması gereken açık kaldı | 🚨 yanlış | "bilgim yok" / iç kaynak | giden mesaj |
|---|---|---|---|---|---|
| yeni akış · okuyucu açık · v4 (dünkü kod) | 30/38 | 8/8 | 0 | 0 | 25/32 |
| yeni akış · okuyucu açık · **v5 (bu gecenin sertleştirmesiyle)** | **30/38** | **8/8** | **0** | **0** | 25/32 |

v5'te farklılaşan 4 senaryonun ikisi kazanç, ikisi kayıp: biri modelin kendi düşük güveni (doğrulayıcı değil), öteki "devam ediyor"
söyleyişi — bu gece düzeltildi. Rapor: `docs/olcum/live-pipeline-2026-10-22-gpt-6-luna-needs-2026-10-23-e1023-new-on-v5.{md,json}`.

## 5. Kalite kapıları

(sonuç bekleniyor)

## 6. Sorularınız (karar sizde)

1. **Migration 85 (cevap tekrarı gölge kipi):** yeni tablo, veri taşımaz, misafire HİÇBİR şey değişmez; Railway açılınca taze yedekten sonra
   uygulanır ve ölçmeye başlar. Onaylıyor musunuz?
2. **Kaydedilmiş cevabı göndermek (ikinci adım, gölge ölçümden sonra):** gölge kipte "kayıt yanlış olurdu" 0 kalırsa, aynı soru 4. kez
   geldiğinde model çağrılmadan kayıtlı cevap gitsin mi? Örnek: misafir "Check-out saat kaçta?" → "Çıkış saati 11:00." (3 ayrı misafire
   aynı doğrulanmış cevap gitmiş, bilgi tabanı değişmemiş, 30 gün dolmamış). Wi-Fi şifresi bu listede olsun mu?
3. **Başka dilde cevap parçalarında son güvence:** kod artık eklenen olgu cümlelerini, tesis adlarını ve sayı farkını yakalıyor. Hâlâ
   yakalayamadığı ince durum: değer taşıyan cümleye tek bir yanlış sıfat eklenmesi. Kıdemli okuyucunun ZATEN yapılan çağrısına "bu cevapta
   kalemde olmayan bilgi var mı?" sorusu eklensin mi (ek çağrı yok; etkisi açılmadan ölçülür)? Önerim: evet, parça kipini açmadan önce.
4. **Yönsüz bilgi tabanı satırları:** "Havuz 20:00" (açılış mı kapanış mı belli değil) yazan kalemde model "kapanır" derse artık tutuluyor.
   Bilgi tabanı ekranında "saatin açılış mı kapanış mı olduğunu yazın" ipucu gösterelim mi?
5. (Önceki rapordan açık) parça kipinin misafire giden biçimi · B paneli · etiketin yeniden okumada ipucu olması.

## 7. Bilinen sınırlar (hepsi TUTMA yönünde — yanlış göndermez, ev sahibine bırakır)
- Kapasite soruları ("daire kaç kişilik") her zaman ev sahibine kalır ("kişi / kapasite" nitelik sözcüğü, konu sözcüğü kalmıyor).
- Kalem yön vermiyorsa ("Kahvaltı 08:00'de verilir") parçanın "from 08:00" demesi tutulur (yön uydurma kuralı).
- İhtiyaç sözcükleri yalnız Türkçe gelirse başka dildeki ikinci konu ("Der Pool und der **Garten**") yalnız tesis listesindeyse yakalanır —
  üretimde misafirin kendi sözcükleri de ihtiyaca girdiği için çoğu durumda yakalanır.
- Zamir ile başlayan başka dil cevabı ("It closes at 20:00") konu sözcüğü taşımadığı için tutulabilir.
- Türkçe kalemde değer konudan ÖNCE gelirse ("10 kg'a kadar evcil hayvan …") değerli cevap bağlanamaz → tutulur.
- Benzer harfle yazılmış olumsuzluk ("nοt", Yunanca o) okunmuyor — model böyle yazmaz, ölçüm dışı.

## 8. Ortam notları ve hatam
- **Hatam (açıkça):** önceki dilimde ayrı çalışma ağacında `prisma generate` koştum; o ağacın `node_modules`'ı ana depoya bağlıydı ve ana
  Prisma istemcisinin üzerine yazdı (tam kapı koşarken). 15 saniye sonra fark edip ana istemciyi yeniden ürettim; kapıda hata çıkmadı. O ağaç
  artık kendi kopyasını kullanıyor; bu gece her üretimde ana istemcinin özetini önce / sonra karşılaştırdım (aynı).
- Ücretli ölçüm: yalnız E v5 (onaylı E kararı kapsamında), $0,11.
