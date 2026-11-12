# S3 (evcil hayvan ayrımı) — dilim sonu sert incelemesi ve sonuçları (2026-11-12)

> Kapsam: `3f018001..7e883f11` (S3 dilimi; anahtar `AI_HELD_PET_SPLIT_ENABLED`, KAPALI). İnceleme Opus 5.5 ile salt-okuma yapıldı
> (hiçbir şey çalıştırmadı, mühürlü sete dokunmadı). Her bulgu kodda yeniden okundu; "kodla doğrulandı" yazanlar ayrıca gerçek
> fonksiyon çağrılarıyla denendi. Tasarım + ölçüm: `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §3 / §3.1.

## Sonuç (tek paragraf)

Anahtar KAPALIYKEN hiçbir davranış değişmiyor (inceleme de doğruladı) — kimse etkilenmedi. Anahtar AÇIKKEN ilk yazım güvenli değildi:
(1) "cevabın dayanağı bilgi tabanında var mı" şartı bilerek kaba bir ön süzgeçti ve soruyla ilgili ama cevabı içermeyen bir kalem
varsa uydurma cevabı dayanaklı sayıyordu; (2) onay / ret sözcük ağında Arapça hiç yoktu, yaygın onay öbekleri ve ücret sözcüğü
taşımayan tutarlar geçiyordu; (3) kör setteki tek yanlış değer "evcil hayvanla ilgisiz" diye etiketlenmişti, oysa anahtar kapalıyken
gitmiyordu — bu değişikliğin açtığı yoldan gitti. **S3 bu hâliyle açılmaz.** Yapılanlar: dal artık yalnız kodun doğruladığı cevap
parçalarında (`verifiedPartsOnly`) ve yalnız aynı turda çıkarılmış evcil hayvan isteğinde açılır (anahtar tek başına hiçbir şeyi
değiştirmez); sözcük ağındaki doğrulanmış delikler kapatıldı; belgeler düzeltildi. Açmak için gerekenler en altta.

## Bulgular

| No | Önem | Bulgu | Doğrulama | Yapılan |
|---|---|---|---|---|
| S3-1 | — | Anahtar kapalıyken kapı hükmü, plan çıktısı ve istem baytları aynı | okundu | — |
| S3-1a | P3 | Ölçüm koşu kimliğine yeni anahtar girdi: bu dilimin öncesi / sonrası koşularının kimliği farklı | doğru | kayıt (kozmetik) |
| S3-1b | P3 | İstemdeki evcil hayvan cümlesi sistem isteminde değil, mesaj başına blokta — istem kimliği iki kolu ayırmıyor | doğru | açık; iki kolu rapor başlığındaki anahtar satırı ayırıyor |
| S3-2a | P2 | Dal, ÖNCEKİ turdan bekleyen evcil hayvan sorusunda da açılıyordu: (a) ölçülmemiş kapsam (setler tek turluk); (b) bu turda anlama katmanının çıkaramadığı yeni bir evcil hayvan sorusunu okuyan bugünkü kemer atlanıyordu | doğru | **düzeltildi** — dal ve istem işareti yalnız BU TURUN isteğinde; turlar arası serbest bırakma ayrı karar (soru aşağıda) |
| S3-2b | P3 | İhtiyacın türü plan sırasındaki dizinle eşleniyordu (kırılgan) | doğru | **düzeltildi** — ihtiyaç kendi türünü taşır |
| S3-3a | P3 | Dayanak listesi, istem bütçesi yüzünden modele gösterilmeyen kalemi de içerebilir | doğru (nadir) | açık |
| S3-3c | **P1** | Dayanak şartı kaba: isteğin TEK sözcüğü ya da kaba sözlük konusu herhangi bir kalemde geçince "dayanak var". Kahvaltı sorusu ↔ "restoran önerileri" kalemi · "mutfakta mikrodalga var mı" ↔ "mutfakta bulaşık makinesi" kalemi · Wi-Fi HIZI ↔ Wi-Fi şifresi kalemi | **kodla doğrulandı** (üçü de dayanaklı çıktı) | şart sıkılaştırılmadı; **dal doğrulanmış cevap parçalarına bağlandı** (her cevap bilgi tabanındaki cümleyle birebir alıntı + konu / değer bağı). Kaba şart ek kemer olarak kaldı; sınırı kodda ve testte yazılı |
| S3-3d | P3 | "Saat 12'de giriş yapabilir miyiz?" giriş saati türüyle okunursa mülk alanı dolu olduğu için dayanaklı sayılır | doğru; "Evet …" sözcük ağında, çıplak saat cümlesi müsaitlik / konaklama kapısında | kayıt |
| S3-3e | P2 | Adres mülk kaydından gelir, bilgi tabanında yoksa "dayanaksız" diye tutulur (gereksiz tutma) | doğru | açık (güvenli yön; ölçümde görünür) |
| S3-4a | **P1** | Sözcük ağında Arapça yok: "evcil hayvanlar kabul edilir" / "köpeklere izin verilmez" anlamındaki Arapça cümleler geçiyordu | **kodla doğrulandı** | **düzeltildi** — Arapça hayvan sözcükleri (bitişik öneklerle), onay / ret / izin sözcükleri |
| S3-4b | **P1** | Yaygın onay öbekleri geçiyordu: "Mümkün." · "Sure thing!" · "That's possible." · "Kein Thema!" · "Pas de souci !" · "¡Claro que sí!" · boşluksuz uzun tire ("Sure—the …") | **kodla doğrulandı** | **düzeltildi** — öbekler listede, tek başına "mümkün / possible / möglich / posible / можно", uzun tire yan cümle sınırı |
| S3-4c | **P1** | Ücret sözcüğü taşımayan tutar geçiyordu: "Ekstra gecelik 300 TL eklenir." · "There's an extra $20 per night." | **kodla doğrulandı** | **düzeltildi** — başka hizmetin adını taşımayan cümlede para tutarı sızıntıdır |
| S3-4d | P2 | Arap virgülü / soru işareti cümle sınırı sayılmıyordu ("Hayır, şifre …" anlamındaki cümle) | doğru | **düzeltildi** |
| S3-4e | P2 | Gereksiz tutmalar (güvenli yön): "maalesef / unfortunately / sorry" her yerde; "kalabilir", "bring", "are welcome", "gelebilir", "можно" başka konuda da; başka hizmetin olumsuz doğru cevabı ("Dairede ütü yok.") | doğru | açık — kör setteki 8 gereksiz tutmanın açıklaması; daraltma ancak ölçümle |
| S3-4f | P3 | Adres numarası temizliği ("No. 12") adres bağlamına bağlı değil | doğru (zorlama örnek) | açık |
| S3-4g | P3 | Yeni kalıplar V8'in en kötü iki kipinde ölçülmemişti (proje kuralı) | doğru | **düzeltildi** — altı ölçüm eklendi, en çok 31 ms |
| S3-5a | P2 | İstem "bilgisi notlarda yoksa cevaplama" diyordu; giriş / çıkış saati ve adres mülk kaydından gelir — model onları da cevaplamayabilir | doğru | **düzeltildi** — "bilgi tabanında ya da mülk bilgilerinde (giriş / çıkış saati, adres)" |
| S3-5b | P3 | İstem "Hayır / Maalesef" sözcüklerini cevabın her yerinde yasaklıyor; öteki sorunun olumsuz doğru cevabı yeniden yazılıyor ya da düşüyor | doğru | tasarım gereği (kapıyla tutarlı) |
| S3-6a | P2 | Pinlenmemiş davranışlar: başka hizmet + yapamama olumsuzluğu · ilgili-ama-cevapsız kalem · Arapça / tire · çok turlu durum | doğru | **düzeltildi** — birim testleri eklendi (çok turlu durum birim düzeyinde) |
| S3-6b | P3 | Tasarım belgesi eskimiş: anlamı yere göre değişen sözcükler "cümle başında" değil, yan cümlenin TAMAMI olduğunda sızıntı | doğru | **düzeltildi** |
| S3-7a | P2 | Geliştirme setinin yasak kalıpları kapının kendi sözcük listesiyle neredeyse aynı: kapının kaçırdığı sözcüğü ölçer de kaçırır ("yanlış izin 0" sözcük düzeyinde döngüsel) | doğru | açık — kabul ölçümünde cevabı sözcük listesinden bağımsız okuyan denetim şart (aşağıda) |
| S3-7b | P2 | S3 satırları, evcil hayvanlı senaryodaki evcil hayvan DIŞI "açık kalmalı" ihtiyaçları saymıyordu (uydurmanın gittiği yer) | doğru; kör raporun toplam yanlış satırı da 1 (S3 satırıyla aynı) | **düzeltildi** — ayrı satır |
| S3-7c | **P1** | Kör setteki tek yanlış değer anahtar kapalıyken 0, açıkken 1: "evcil hayvanla ilgisiz" etiketi nedenselliği gizliyor — bu değişikliğin açtığı yoldan giden yanıltıcı bir cevap | doğru | **düzeltildi** — etiket kalktı, belgeler ve kurucu raporu düzeltildi |
| S3-7d | P3 | Geliştirme raporlarının hangi commit'te koştuğu | bakıldı: kapalı / açık / parça kolları `04d90bca`, dayanak kolu `b81b6618`, kör koşular `74f5f543` | kayıt — tasarım tablosundaki "son hâl" sütunu `b81b6618` |
| S3-8a | P3 | Kodun kurduğu metinler (doğrulanmış erken giriş / müsaitlik) bekleyen evcil hayvan sorusu varken yine tutulur | doğru; bugünkü davranışla aynı | kayıt (bu metinler parça işareti taşımaz → bugünkü kemer) |

## Sıkılaştırmanın dar incelemesi (Haiku, aynı sabah)

Sıkılaştırma yazıldıktan sonraki dar inceleme: anahtar kapalıyken fark yok, yeni kalıplarda karesel iş yok. Ama sözcük ağında YİNE
kaçak buldu; hepsi gerçek fonksiyonla denendi, hepsi denetimden geçiyordu ve kapatıldı: "Uygundur." · "Yok, …" · "Out of the question." ·
"Gern." · "Разумеется." · "Con mucho gusto." · "Pourquoi pas." · Arapça "sorun değil" / "tabii ki" anlamındaki öbekler · "15 euros" ·
"300 liradır" · "Un supplément s'applique." · "Ek ödeme gerekir." · Arapça uzatma çizgisiyle bölünmüş hayvan sözcüğü. İki ayrı incelemenin
iki ayrı kaçak listesi bulması, 1. sınırın (aşağıda) kanıtıdır: sözcük listesi tamamlanamaz.

## Bilerek kapatılmayan sınırlar (anahtar açılmadan önce bilinmeli)

1. **Sözcük ağı bir ağdır.** Her dolaylı izni sayamaz ("Sizi ve küçük arkadaşınızı bekliyoruz"). Bugüne kadarki 69 evcil hayvanlı (24 geliştirme + 45 kör)
   senaryoda model böyle bir cümle yazmadı; garanti değildir.
2. **Dayanak şartı kabadır** (S3-3c). Tek başına güvence değildir; güvence cevap parçalarının kodla doğrulanmasıdır.
3. **Gereksiz tutma** (S3-4e, S3-3e): güvenli yönde, ölçümle izlenir.
4. **Geliştirme ölçümünün yanlış izin sayısı sözcük düzeyinde döngüseldir** (S3-7a).

## Açmak için gerekenler (sıra)

1. Cevap parçaları kipinin kendi kabul ölçümü (`AI_ANSWER_PARTS_ENABLED` + `AI_ITEM_ORDINAL_ENABLED` — S3 onlarsız etkisiz).
2. Cevabı misafirin mesajıyla birlikte okuyan denetim (kıdemli okuyucu) — sözcük listesinden bağımsız ikinci katman; kendi ölçümüyle.
3. Yeni bir mühürlü set (ilki yakıldı) ile S3'ün bu yapılandırmada kabul ölçümü; yanlış izin sayısı bağımsız okumayla da sayılır.
4. Kurucu kararı.

## Kurucuya soru (yeni)

Evcil hayvan sorusu ÖNCEKİ bir mesajda sorulmuş ve henüz cevaplanmamışsa, misafirin sonraki mesajına cevap gitsin mi?

- Misafir dün: "Köpeğimizi getirebilir miyiz?" (cevaplanmadı) · bugün: "Otopark nerede?"
- Bugün: cevap gitmez (ikisi de ev sahibinde). Anahtar açıkken de (bu hâliyle): gitmez.
- Seçenek: otopark cevabı gitsin, köpek sorusu ev sahibinde kalsın — ayrı ölçümle (çok turlu senaryolar).

## Geliştirme setindeki sayılar (parça kipi, karşılaştırma için)

| Yapılandırma (cevap modeli gpt-5.1) | Yanındaki sorunun doğru cevabı giden | Yanlış izin | Yanlış / uydurma giden |
|---|---|---|---|
| Bugün (anahtar kapalı) | 0/21 | 0 | 0 |
| S3 ilk yazım, öğe kipi | 20/21 | 0 | 1 (+ cevabı olmayan yan soruda 5/5 uydurma) |
| S3 + dayanak şartı, öğe kipi (kör sette ölçülen) | 19/21 | 0 | 0 (kör sette 1) |
| S3 + cevap parçaları kipi, ilk yazım (`04d90bca`) | 16/21 | 0 | 0 (cevabı olmayan yan soruda 0/15 uydurma) |
| **Son hâl** — doğrulanmış parça + aynı tur + genişletilmiş sözcük ağı (`dda799c8`) | 15/21 | 0 | 0 (cevabı olmayan yan soruda 0/15 uydurma) |

Son hâlin raporları: `docs/olcum/live-pipeline-2026-11-12-gpt-5.1-held-pet-split-dev-s3-sonhal-parca.md` ·
`…-held-pet-unknown-dev-s3-sonhal-parca.md`. Altı gereksiz tutmanın sebepleri (hepsi güvenli yönde): parça doğrulayıcısı Wi-Fi
cümlesini reddetti (2; aynı senaryolar önceki koşuda geçmişti — model / doğrulayıcı oynaklığı) · İngilizce giriş saati cevabını
müsaitlik doğrulaması tuttu (1) · cevabı misafirin mesajıyla okuyan denetim "cevap eksik" dedi (2) · **benim eklediğim Arapça kalıp
selamı ("مرحباً") onay sözcüğü saydı (1)** — ölçüm yakaladı, düzeltildi ve gerçek taslakla pinlendi (bu rapor düzeltmeden ÖNCEKİ
commit'te koştu). Ölçümün öğrettiği: sözcük ağına her ekleme gereksiz tutma da üretebilir; ekleme birim testiyle değil canlı
ölçümle sınanır.
