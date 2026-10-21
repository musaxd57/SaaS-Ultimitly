# Anlama ölçümü — neden analizi ve kurucuya sorular (2026-10-21)

Kaynak: `docs/olcum/anlama-e2e-dev-live-2026-10-21.md` (54 senaryo, 75 istek, gerçek model: cevap `gpt-6-luna` low, anlama / sıralayıcı `gpt-5.1`;
Railway açılış listesi §1 bayrakları; denetçi `gpt-5.1`). İkinci kol (`AI_TOPIC_ABSENCE_ENABLED=1`) aynı sonucu verdi ama 3 satırda denetçi
düştü (rapor GEÇERSİZ; denetçi düzeltildi, yeniden koşulacak). Tasarım: `docs/TASARIM-2026-10-21-anlama-olcumu.md`.

## Özet (canlı kol, düzeltilmiş ölçer)

| ölçü | sonuç |
|---|---|
| yanlış bilgi misafire giden (yanlış bağ / çelişen / desteksiz iddia) | **0/44** · iddia denetçisi: 63 destekli, 0 yanlış bağ |
| tutulması gereken istek misafire sızdı | **0/25** |
| acil yolu | **6/6** |
| cevaplanması gereken istek gereksiz tutuldu (ev sahibinde açık) | **5/44** |
| sessiz düşen (ne cevap ne ev sahibinde açık iş) | 1 (bulaşık makinesi, aşağıda D) |
| aynı sözcük / farklı anlam çiftleri ikisi de doğru | 7/9 |
| anlama: beklenen istek bulundu · bağlı soruya "kendi konusu" (kod koruması yakaladı) | 70/75 · 2 |

Ölçerin kendi kusurları ilk raporda ürün hatası gibi görünüyordu (sıra sayısı noktası cümle sonu sayılıyordu; bağlaçlı tek cümlecikte değer
yanlış ada bağlanıyordu; ürünün bilerek modeli çağırmadığı tehlikeli arıza "koşu düştü" sayılıyordu) — düzeltildi, rapor yeniden koşuldu.

## Gereksiz tutmaların nedenleri (taslak doğruydu, kapı tuttu)

| senaryo | taslak (gitmedi) | tutan | neden türü |
|---|---|---|---|
| Sauna ne kadar önce haber / ne kadar kalınır | "Sauna için en az 2 saat önceden resepsiyona haber vermeniz gerekiyor. Her rezervasyon 1 saat sürüyor." | `availability_unconfirmed` | **sözcük kuralı**: kalemdeki "rezervasyon" takvim müsaitliği sanıldı |
| Balkonda 22:30'da müzik (ikinci kolda) | "Quiet hours begin at 10:00 pm, and music is not allowed on the balcony during that time." | `availability_unconfirmed` | **sözcük kuralı**: "tonight" takvim sorusu sanıldı |
| Bisikletler kaçta teslim (es) | "Hay que devolver las bicicletas antes de las 21:00." | `items_nothing_answered` | **cevap modelinin beyanı**: hangi isteği cevapladığını beyan etmedi |
| Klima çalışmıyor, nasıl soğutacağız | KB tarifi (MODE / kar tanesi) | `items_fix_unverified` | **cevap modelinin beyanı**: kaynak beyan etmedi (aynı taslak ikinci kolda gitti — kararsız) |
| 25 kg köpek | "Bilgi tabanındaki koşula göre … 25 kg köpeğiniz bu koşulu karşılamıyor. İstisna olup olmayacağı ev sahibinizin kararıdır; mesajınız kaydedildi…" | çıktı vetosu | model bilinen cevabı verip yine "ev sahibinin kararı" ekledi + **"bilgi tabanındaki" iç kaynak anlatımı** |
| Hafta içi otopark ücretsiz mi (fr) | "Votre hôte pourra vous renseigner sur le stationnement en semaine." | düşük güven | model KB'deki koşullu bilgiyi (hafta sonu ücretsiz, garaj 25 EUR) misafirin sorusuna uygulamadı |

Ortak nokta: **kararı veren şey anlam değil, sözcük ya da modelin kendi beyanı.** Doğru taslak sözcük kuralı ("rezervasyon", "tonight") ya da modelin
eksik etiketi yüzünden tutuluyor; tersine aynı taslak bir koşuda gidip ötekinde tutulabiliyor (klima). Kurucunun yönüyle aynı: karar, cevabın
anlamının bilgi tabanıyla doğrulanmasına dayanmalı.

## Kurucuya sorular (müşteriye gideni değiştirir — onaysız uygulanmadı)

**A. Müsaitlik kapısı yalnız gerçek takvim sorusunda (anlama katmanı) devreye girsin mi?**
Bugün: cevabın / mesajın içindeki sözcük ("rezervasyon", "tonight", "müsait") takvim iddiası sanılıyor. Öneri: kapı yalnız anlama katmanı isteği
`availability / extend_stay / date_change / early_checkin / late_checkout` diye anladığında ya da cevapta açık TARİH + müsaitlik iddiası olduğunda.
- Önce: "Sauna ne kadar önce haber vermeliyim?" → tutulur (ev sahibine). Sonra: "Sauna için en az 2 saat önceden resepsiyona haber verin; her rezervasyon 1 saattir." gider.
- Değişmeyen: "17 Ekim'de daire boş mu?" → yine kapıda (takvim sorusu).

**B. Cevap modelinin beyanı eksikse bağımsız doğrulama karar versin mi?**
Bugün: model "hangi isteği cevapladım / hangi kaynağa dayandım" etiketini unutursa doğru cevap tutulur. Öneri: etiket eksikse ikinci bir model
(ölçerdeki iddia denetçisinin ürün sürümü) cevabın her iddiasını bilgi tabanından BİREBİR alıntıyla doğrular; kod alıntıyı kalemde arar; hepsi
destekliyse ve istek cevaplandıysa gider, tek bir desteksiz / yanlış bağlı iddia varsa tutulur. Maliyet: gönderilecek her cevapta bir ek çağrı.
- Önce: "¿Hasta qué hora hay que devolver las bicicletas?" → doğru taslak tutulur. Sonra: "Hay que devolver las bicicletas antes de las 21:00." gider.
- Tutucu yön korunur: "Havuz 22:00'de kapanır" (22:00 spor salonunun saati) → denetçi "yanlış bağ" der → tutulur.

**C. Dayanak kontrolü sözcük örtüşmesinden iddia bağına taşınsın mı?** (`tests/unit/grounding-binding-battery.test.ts`)
Bugünkü kontrol iki yönde de anlamı ölçmüyor: doğru açıklamayı reddedebiliyor ("Havuz her gün 20:00'ye kadar kullanılabilir" — "kadar" kalemde yok),
anlamı bozulmuş cümleyi kabul edebiliyor ("2 saat önceden haber verin" → "2 saat kullanabilirsiniz"; "ikinci araç ücretli" → "ücretsiz"; koşullu
geç çıkış koşulsuz). Önerilen "gövde 4 + iki kaydı birleştir" bunu kötüleştirir (havuz + spor salonu metni birleşince "Havuz 22:00" geçer — pinli).
Öneri: B'deki iddia doğrulaması bu kontrolün yerine geçer (aynı konu + aynı ilişki türü + aynı koşul, tek cümleden alıntı).

**D. Arıza çözüm sorusunda şikâyet çıkarılmadıysa kod şikâyet öğesi eklesin mi?**
"El lavavajillas muestra un error y no arranca. ¿Cómo lo reiniciamos?" → anlama katmanı yalnız "çözüm isteği" çıkardı; tarif gitti (doğru), ama ev
sahibinin önünde açık iş kalmadı — tarif işe yaramazsa ev sahibinin haberi olmaz. Öneri: çözüm isteği var, aynı mesajda şikâyet yoksa kod bir şikâyet
öğesi ekler (ev sahibinde açık; misafire giden cevap DEĞİŞMEZ).

**E. "Bilgi tabanındaki …" gibi OLUMLU iç kaynak anlatımı da silinsin / tutulsun mu?**
Kural (10-21 T1) iç kaynak anlatımını yasaklıyor; bugünkü kalıplar yalnız olumsuzla birlikte olanı ("bilgi tabanımda yok") yakalıyor. Ölçümde model
"Bilgi tabanındaki koşula göre yalnızca 10 kg altındaki köpekler kabul ediliyor" yazdı. Öneri: kaynak işaretli giriş ("bilgi tabanına göre",
"according to the knowledge base", "sistemdeki bilgiye göre") cümleden silinir, cümlenin geri kalanı aynı kalır ("10 kg altındaki köpekler kabul
ediliyor; 25 kg köpeğiniz bu koşulu karşılamıyor.").

**F. Koşullu bilgi misafirin durumuna uygulanarak cevaplansın mı (istem)?**
"Le parking est-il gratuit pendant la semaine ?" → model "ev sahibiniz bilgi verir" dedi; KB "sokak hafta sonu ücretsiz, garaj günlük 25 EUR". Öneri
(istem): koşullu kural misafirin sorduğu duruma uygulanarak cevaplanır ("Hafta içi sokak park ücretli; garaj günlük 25 EUR, 24 saat önceden ayırtılır"),
koşul KB'de yoksa ev sahibine kalır. Ölçülecek: aynı set + kör set, yanlış bilgi 0 korunmalı.

## Sıradaki ölçüm

1. Denetçi düzeltmesiyle ikinci kol yeniden; her kol 3 tekrar (koşudan koşuya değişim ölçüldü: klima taslağı bir kolda gitti bir kolda tutuldu).
2. Claude üretimi 286 senaryoluk set (`evals/understanding-e2e-gen.json`) aynı ölçerle — örneklem önce insan gözüyle denetlenir.
3. Mühürlü kör set (`evals/sealed/…`) yalnız A–F kararlarından sonra, BİR kez.
