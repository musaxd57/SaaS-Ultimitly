# Kurucu kararları — 10-23 akşam (öğle raporu §4 + tasarım §7 cevapları, AYNEN)

> Soru metinleri: `docs/RAPOR-2026-10-23-ogle-okuyucu-anlam-denetimi-ve-etiketler.md` §4, `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md` §7.
> Kurucunun mesajı değiştirilmeden aşağıda; ardından soru aracındaki seçimleri. Uygulama durumu: `docs/claude/durum.md`.

## Mesaj (aynen)

Okuyucu artık daha çok şey görüyor AI dimi okuyucu dediğin ve Eksik dört parça: bunları yaptın mı
4.0
4.1 için önerin mantıklı
4.2 önerin iyi
4.3 önerin iyide hatan var adam evcil hayvan ücretsiz gelebilir yazmışsa host direk cevap olarak tabiki evcil hayvanınızı getirebilirsiniz yazabilir ama host yasak demişse yasak diye gitsin ki platformlarda evcil hayvan getirmek isteyenler onun için para ödüyor yani isterlerse getirebilirler para ödemiş kişiler onun için cevap vermemeye daha çok çalışsın evet veya hayır demesin net değilse çünkü evcil hayvan yasakta olamaz airbnbde evcil hayvan için rezervasyon yapabiliyorsun ücretli olarak kbye böyle yazmışsa host uyarılabilir hatta uyarı gibi çıkabilir kısaca
4.4 yani üstte dediğim gibi kabul edilmez genelde yazamazlar çünkü isterlerse ekstra ücret ödeyip rezervasyona evcil hayvanıda katabiliyorlar hosta uyarı çıkabilir ama emin olalım model sallamasın onun dışında bedavaysa ve onun için rezervasyon yapılmamışsa evcil hayvan için hostta kabul ediyorsa gidebilir onun dışında yasaksa rezervasyona evcil hayvanda eklenmeli model onu görebiliyor mu mesela kimlerin geldiğini kaç kişi evcil hayvan var mı onu görsün airbnbden api alacağımız zaman
4.5 ev sahibinize sorabilirsiniz yazamaz yasak onlar bilgisi yok sayılsın cevap tutulsun ve salak host kendi telefon numarasını yazamaz benim bildiğim yasak bile olabilir rezervasyondan önce kural daha şey sık mesajları daha kola engelliyor modelimiz onuda göz önünde bulundursun müşteri rezervasyon yaptırmışmı yaptırmamış mı konaklıyor mu gelecek mi bu çok önemli bunun bilgisi gitsin modele rezervasyon yapılırsa numara sorulmuşsa acil durumda gidebilir ama rezervasyon varsa ve mantık kurallarına uyuyorsa genelde mesela müşteri daha içeri girmeden acil durum nasıl verebilir ev ile ilgili böyle bir durumda mantıksız durumunda hosta bıraksın ama modeli besle salak salak şeyleri bırakmasın bilgisi olsun yani
4.6 evet ölç ama işe yarıyacaksa ve model AI zorlanmayacaksa salak gibi yapma yani.
4.7 ileride kesinlikle yapmak istiyorum fine tuning ve modelin en iyi çalıştığı durumlar nasıl en hatasız çalıştığı doğru olduğu durumları tespit edelim testlerini yapabilirsin.
4.8 evet koş
4.9 salak klimayı soğuğa nasıl alırım diyor klima kumandasını bulmadan onu neden sorsun ondan emin olamadım  çekmecede yazıyorda asıl soruya sorulan cevabı vermiyor yeri gitsin mi sence önerin mantıklı önerini beğendim test ile yap en doğrusu nasıl olucaksa öyle yapalım hep.
4.10 A iyi sakın Byi yapma

5. Bilgi tabanı: dosya, RAG / gömme, tarama — durum ve plan bunu en iyi şekilde yap çok önemli uzun uzun düşün acele etme öneri için haiku modelinden yardım al son kontrolleri yaptırt opusa öneride al acele etme çıktı vermek için
4.8

## Soru aracındaki seçimler (aynen)

- 4.0 (okuyucu mu karar verir): **"A — okuyucu karar verir (Önerim)"**
- Evcil hayvan kuralı: **"Ayı seçiyorumda yardımcı hayvanı sorusu ile normal evcil hayvan sorusu ayrışsın onların farklı olduğu yardımcı hayvanın cidden olduğundan emin misin bu arada"**
- Rezervasyon kişi / evcil hayvan sayısı saklansın mı: **"Evet, saklayalım (Önerim)"**
- Bilgi tabanı iki yeni tablo ana dala: **"Evet, ana dala al (Önerim)"**

## Yorum (uygulamaya giren hâli — kurucunun sözleri esas)

- **4.0 A:** okuyucu anlam hakemi; kodda kalanlar (alıntı · değer · çelişki · konu · ters olumluluk + sır / yetki / işlem / bütün kapı) okuyucu serbest bırakamaz. Kodda zaten böyle; kararla kesinleşti.
- **4.1 B:** kısmi gönderimde açık kalan ihtiyaç için mesaj başına TEK "Misafir cevabınızı bekliyor" e-postası; aynı ihtiyaca ikinci e-posta yok (Soru 10 kalıcı kaydı).
- **4.2 B:** "… dahil mi?" sorusunda kaynakta ilgili ücret yazıyorsa cevaba eklenir ("Dahil değil; kişi başı 250 TL."); tutar yalnız ev sahibinin kaydından.
- **4.3:** "kural ihlali" etiketi yalnız kendi ihtiyacını tutar (aynı mesajdaki bağımsız sorular gider).
- **4.4 A + yardımcı hayvan ayrı:** bilgi tabanı açıkça ücretsiz ve izinli diyorsa "Evet, getirebilirsiniz" gider; ücretli / koşullu ya da "yasak / kabul edilmez" ise cevap GİTMEZ, ev sahibine kalır; "yasak" yazan bilgi tabanına uyarı (yardımcı hayvanlar her durumda kabul edilmeli — Airbnb yardım makalesi 1869). Yardımcı hayvan (görme engelli köpeği vb.) sorusu evcil hayvan sorusundan AYRI ihtiyaçtır ve her zaman ev sahibine kalır. Model sallamasın: uyarı kodla / kalem metniyle doğrulanır.
- **4.5:** "ev sahibinize sorabilirsiniz / danışabilirsiniz / isteyebilirsiniz / ev sahibiniz kesin bilgi verebilir" = bilgim yok → cevap tutulur. Onaylı rezervasyondan önce iletişim bilgisi (telefon, e-posta, bağlantı) gitmez (Airbnb; kod var: `channels/airbnb-message-policy.ts`). Rezervasyon aşaması (ön soru / onaylı / gelecek / konaklıyor / ayrıldı) modele açıkça gider; girişten önce evle ilgili "acil durum" mantıksızdır → ev sahibine.
- **4.6:** ölç; yalnız işe yarıyor ve model zorlanmıyorsa öner.
- **4.7:** ince ayar ileride kesin; şimdi modelin en hatasız çalıştığı koşulları ölçerek tespit et.
- **4.8:** koş (yanmış kabul seti, ayrıntılı neden analizi).
- **4.9:** okuyucu tutarsa bir kez yeniden yaz; konum + asıl eylem birlikte ("Kumanda komodinin çekmecesinde; mavi kar tanesi tuşuna basarak soğutmaya alabilirsiniz."). Testle, en doğru hâliyle.
- **4.10 A:** "Giriş kaçta? 12'de girebilir miyiz?" turu bugünkü gibi tutulur; B ASLA.
- **§5 / 7-A…7-G:** "en iyi şekilde yap" — önerilerim (önce yükleme, sonra şablon + dışa aktarma; plan sınırına sayılır; tarama kartı panelde; eksik bilgi döngüsü e-posta + panel; kalıcı embedding deposu) uygulanır, Haiku önerisi + Opus son kontrol ve öneri ile.
