# Görülmemiş (kör) set — neden analizi (26 Kasım 2026)

> Opus araştırma ajanının çıktısı (kod yazmadı, yalnız ayrıntı dosyalarını ve kodu okudu). Ana oturum sayıları özet raporlarla karşılaştırdı; "emin değilim" diye işaretlenenler DOĞRULANMADI. Ölçüm tablosu: `docs/INCELEME-2026-11-12-istem-denetimi.md` §6.4. Açma kararı kurucudadır.


## DURUM
- TAMAM: bölüm 1–7 yazıldı. Öneri bölüm 6, emin olmadıklarım bölüm 7 sonu.
- Kaynak: beş `*-ayrinti.json` (commit f9c4c5dd, gpt-5.1, 26 Kasım). Kod yalnız okundu; vitest / ağ / model çağrısı YOK.
  Tek "çalıştırma": `redact.ts` FIELD_RE düzenli ifadesinin Python kopyası (bölüm 3.2) — ürün fonksiyonuyla ayrıca doğrulanmalı.
- Toplamlar ayrıntı dosyalarından yeniden hesaplandı, raporlarla birebir aynı (g1 41/22/34/21 · g2 45/19/43/11 · g3 34/30/53/1 ·
  g4 36/27/53/2 · g4-2 37/27/53/1).

Kısaltmalar: OK = doğru değerle gitti · H = gereksiz tutma · W = yanlış gönderim · "aç" = açık kalması gereken ihtiyaç.
g4b = g4'ün ikinci koşusu (`g4-parca-katman-2`).

---

## 1. Kol başına sınıf dökümü

Hücre: cevaplanmalı ihtiyaç `doğru / tutma / yanlış` · açık kalmalı ihtiyaç `açık kaldı / yanlış`

| senaryo sınıfı (adet) | g1 bugün | g2 +kaynak | g3 parça | g4 parça+kaynak | g4b (2. koşu) |
|---|---|---|---|---|---|
| control (12) | 11/0/**1** · – | 12/0/0 · – | 10/2/0 · – | 9/2/**1** · – | 9/3/0 · – |
| explicit_no (8) | 7/2/0 · – | 8/1/0 · – | 5/4/0 · – | 5/4/0 · – | 4/5/0 · – |
| held_plus_answer (10) | 1/9/0 · 11/0 | 1/9/0 · 11/0 | 1/9/0 · 11/0 | 1/9/0 · 11/0 | 1/9/0 · 11/0 |
| mixed (8) | 12/4/0 · 2/**6** | 10/6/0 · 6/**2** | 8/8/0 · 8/0 | 10/6/0 · 8/0 | 12/4/0 · 8/0 |
| conflict (5) | 2/0/0 · 0/**5** | 2/0/0 · 1/**4** | 2/0/0 · 4/**1** | 2/0/0 · 4/**1** | 2/0/0 · 4/**1** |
| near_entity (6) | – · 5/**1** | – · 6/0 | – · 6/0 | – · 6/0 | – · 6/0 |
| near_topic_no_answer (6) | 2/1/0 · 3/**3** | 2/1/0 · 5/**1** | 2/1/0 · 6/0 | 2/1/0 · 6/0 | 2/1/0 · 6/0 |
| order (6) | 3/3/0 · 3/**3** | 5/1/0 · 4/**2** | 3/3/0 · 6/0 | 4/2/0 · 6/0 | 4/2/0 · 6/0 |
| tiny_kb (6) | 2/3/0 · 4/**1** | 4/1/0 · 5/0 | 2/3/0 · 5/0 | 2/3/0 · 5/0 | 2/3/0 · 5/0 |
| value_transfer (7) | 1/0/0 · 6/**1** | 1/0/0 · 5/**2** | 1/0/0 · 7/0 | 1/0/0 · 7/0 | 1/0/0 · 7/0 |

Okuma:
- Yanlış gönderimlerin hepsi "açık kalmalı" tarafında (bir istisna: c4 — dil hatası, bölüm 2.1-E). Parça kipi bu tarafı neredeyse sıfırlıyor.
- Parça kipinin bedeli control / explicit_no / mixed sınıflarında: doğru ve basit cevaplar tutuluyor (bölüm 3).
- held_plus_answer: 10 cevaplanmalı ihtiyacın 9'u BEŞ KOLDA DA tutuluyor — kollardan bağımsız, tur düzeyindeki kapılar (bölüm 3.6).

---

## 2. Yanlış gönderimler

### 2.1 g1 (bugünkü hat) — 21 yanlış, beş sınıf

| sınıf | adet | senaryolar |
|---|---|---|
| A. Uydurma değer (bilgi tabanında olmayan olgu, çoğu "yok" çıkarımı) | 6 | nt4 · nt6 · m2 · m5 · m6 · t6 |
| B. Çelişkili iki kalemden birini seçme | 7 | cf1 · cf2 · cf3 · cf4 · cf5 · or3a · or3b |
| C. Yakın varlıktan değer aktarma | 2 | ne6 · vt6 |
| D. Cevabı olmayan soruya "bilgi yok" anlatımı / oyalama / sessiz kapanış | 5 | nt5 · or1a · m4 · m8 · m3 |
| E. Doğru değer, YANLIŞ DİL (ölçer "yanlış değer" saydı) | 1 | c4 |

Örnekler:
- **A — uydurma.** nt6 (bahçe evi; bilgi tabanında ütü yok): "Is there an iron I could use?" → *"There is an iron in the apartment that you
  can use."* Misafir olmayan bir ütüyü arayacak. m2: "yakında market var mı?" (teras dairesi; market kalemi yok) → *"Çevrede yürüme
  mesafesinde birkaç market de bulabilirsiniz."* t6: "¿Hay lavavajillas?" (mini; hiçbir şey yazmıyor) → *"El apartamento no tiene
  lavavajillas."* m6 aynı sınıf: kalem "bulaşık + çamaşır makinesi var" diyor, model kapalı liste sayıp *"отдельной кофемашины нет"* yazdı.
  m5: kalem "terasta sigara yasak" diyor, model *"barbekü de yasak"* ekledi.
- **B — çelişki.** cf1 (iki Wi-Fi kalemi: lale1234 / gul5678): "Wi-Fi şifresi neydi?" → *"şifre ise gul5678"*. cf2 (otopark "ücretsiz" ve
  "günlük 150 TL" iki kalem) → *"it is charged 150 TL per day"*. Doğru davranış: ev sahibine sormak (çelişkiyi misafir çözemez).
- **C — aktarma.** vt6: "son temizlik ne kadar?" → *"La limpieza semanal solo está incluida de forma gratuita en estancias de más de 7
  noches"* (haftalık temizlik bilgisi son temizliğin cevabı gibi gitti). ne6: "tramvay durağı var mı?" → *"pas de tram indiqué … arrêt de bus
  à 150 m"* (aynı zamanda D sınıfı anlatım).
- **D — cevabı olmayan soru.** or1a: "Is there a sauna?" → *"There is no sauna mentioned among the facilities."* nt5: "Havuz ısıtmalı mı?" →
  *"Elle n'est pas indiquée comme étant chauffée."* m8: "çarşaflar değiştiriliyor mu?" → *"talebinizi buradan yazabilirsiniz, temizlik
  programına göre yardımcı olmaya çalışırım"* ve öğe "cevaplandı" kapandı. m3: bulaşık makinesi sorusu metinde HİÇ geçmedi ama öğe
  "cevaplandı" kapandı (metin yanlış değil; iş yanlış kapandı → ev sahibi açık soruyu görmez).
- **E — dil.** c4: Fransızca soru → *"Bonjour Alex, Klima kumandası TV ünitesinin çekmecesinde bulunuyor."* Değer doğru, gövde Türkçe.
  Ürünün dil kapısı geçirdi (kısa tek cümle; kapı yalnız "iki taraf da eminse" tutar — `automation.ts:887-903`, kod okuması). Ölçer bunu
  Fransızca "tiroir" deseni olmadığı için "yanlış değer" saydı; gerçek sınıfı dil.

"Ölçerin yanlış saydığı" sınıfı: yok. 21'in 21'i misafir açısından kusurlu bir gönderim. Yalnız ne6'nın "otobüs önerisi" kısmı tartışmalı
(set yazarı yasaklamış; bir insan ev sahibi de söyleyebilirdi) — ama aynı metin "bilgilerde tramvay yok" anlatımı taşıdığı için yine yanlış.

### 2.2 g2 (+ kaynak kuralı) — 11 yanlış

| sınıf | adet | senaryolar |
|---|---|---|
| A. Uydurma | **0** | — (g1'deki 6'sı da kalktı) |
| B. Çelişki | 6 | cf1 · cf2 · cf4 · cf5 · or3a · or3b |
| C. Yakın varlıktan aktarma | 2 | vt6 · **vt1 (yeni)** |
| D. "Bilgi yok" anlatımı | 2 | nt5 · m6 |
| F. Devir / erteleme cümlesi | 1 | m4 |

Örnekler:
- B: cf2 → *"It is free for guests, and the daily parking fee is 150 TL."* (iki çelişkili kalemi aynı cümlede yan yana koydu — g1'den bile kötü).
- C (yeni): vt1 "How much would a transfer to the city centre cost?" → *"An airport transfer is 25 Euro …"* (havaalanı fiyatı şehir merkezi
  sorusuna). g1'de bu senaryo tutulmuştu.
- D: m6 → *"записи о кофемашине у меня нет"* ("kayıtlarımda kahve makinesi yok") — kurucu kuralı "bilgim yok misafire gitmez"in ihlali.
- F: m4 → *"Pour la présence d'un fer à repasser, cela dépend de notre équipement et sera confirmé par nos soins."* Yanlış bilgi değil; ama
  K10 (devir cümlesi misafire gitmez) ihlali; ölçer konu sözcüğü geçtiği için yanlış saydı. En hafif sınıf.

### 2.3 Parça kollarındaki yanlışlar — ayrıntılı

**cf4 (üç parça koşusunun ÜÇÜNDE de, tek kalıcı yanlış).** Bilgi tabanı (konak_celiski) iki çelişkili kalem: "Çöpler salı ve cuma akşamı
toplanır." / "Çöp her akşam alınır, kapının önüne bırakın." Misafir: "Çöpler hangi günler toplanıyor? Ayrıca eczane yakın mı?"
Giden (g4): *"Çöpler salı ve cuma akşamı toplanıyor; her akşam çöpü kapının önüne bırakabilirsiniz."*
- Model iki çelişkili kalemi UZLAŞTIRAN üçüncü bir cümle kurdu (bilgi tabanının söylemediği "salı-cuma toplanır ama her akşam
  bırakabilirsiniz"). Misafir çöpü her akşam kapıya koyar, iki gün kapıda bekler.
- Hangi katman bıraktı: (1) kod doğrulaması çelişkiyi `value_conflict` ile yalnız DEĞER aralığı (saat / tutar / sayı) olan yerlerde arar
  (`answer-binding.ts` `rivalIssue` → `boundSitesFor(c.cls)`); "salı ve cuma" ↔ "her akşam" sıklık sözcüğüdür, değer aralığı değildir →
  görünmedi. (2) Parça okuyucusunun isteminde "notların KENDİ aralarında çeliştiği" durum için kural yok (`part-reader.ts:82` yalnız parça ↔
  not çelişkisini sorar); okuyucu her olgunun notlarda geçtiğini görüp onayladı. g4'te model iki kalemi birlikte alıntıladı, okuyucu yine
  geçirdi. Havuz / Wi-Fi / otopark çelişkilerini okuyucu `reader_binding` ile yakalıyor (cf1/2/3/5 üç koşuda da tutuldu) — çünkü orada
  parçanın değeri öteki notla doğrudan çatışıyor; çöpte model iki notu birleştirince çatışma görünmez oldu.
- Ölçer hatası mı: hayır. Gerçek yanlış.
- g1 ve g2'de de aynı senaryo yanlış (salı/cuma seçildi). Yani parça kipi bu sınıfı kötüleştirmedi, çözemedi.

**c4 (yalnız g4'ün birinci koşusunda).** g1'deki dil hatasının aynısı: parça metni Türkçe alıntıdan Türkçe yazıldı (*"Klima kumandası TV
ünitesinin çekmecesinde bulunuyor."*), parça doğrulaması geçti (değer alıntıda var), dil kapısı kısa metinde emin olamadığı için tutmadı.
Kök: parça kipinde misafirin diline ayrıca bakan bir katman yok. g3 ve g4b'de aynı senaryo Fransızca gitti → model kararsızlığı.

**Ölçerin YANLIŞ saymadığı ama yanlış olan bir gönderim daha: g3 en6.** "¿Ponéis toallas de playa?" → *"Hola Alex, Plaj havlusu
sağlamıyorum."* İspanyol misafire Türkçe gövde. Ölçer bunu "metin gitti ama değer yok" (tutma) saydı; dil ölçüsü `langOk=false` doğru
gördü ama yanlış gönderime eklenmedi. g1 / g2'de aynı senaryonun Türkçe taslağı ürünün dil kapısında tutulmuştu (`reply_language_mismatch`);
parça kipinde metin tek kısa cümle olduğu için kapıdan geçti.
→ Parça kollarının gerçek "zararlı gönderim" sayısı: g3 2 (cf4 + en6) · g4 2 (cf4 + c4) · g4b 1 (cf4). Üçünde ortak kalıcı kök cf4;
ikinci kök "parça kipinde dil denetimi yok" (3 koşuda 2 kez).

---

## 3. Parça kipinde kaybedilen cevaplar

g1'de doğru gidip parça kolunda gitmeyen cevaplanmalı ihtiyaçlar: g3 14 · g4 12 · g4b 12. Aynı kollarda g1'de tutulup parça kipinde giden:
g3 7 · g4 7 · g4b 8 (nt2 Wi-Fi, m1 ×2, or1b, t3, m7 ×2, c4 …) — bunlar g1'in "bilgim yok" cümlesi yüzünden bütün turu tutan kapıdan
(`reply_absence`) kurtulan kardeş cevaplar; parça kipinin asıl kazancı.

### 3.1 Kayıpların sebebe göre dökümü (g4 esas; g3 / g4b farkı parantezde)

| sebep (hangi katman) | g4 ihtiyaç | senaryolar | parça doğru muydu? |
|---|---|---|---|
| **a. Kod: `polarity_mismatch`** (kodda kalan denetim, okuyucu serbest bırakamaz) | 6 (+en6 zaten tutma; g4b +en7, en8) | nt6 · en1 · en4 · c11 · m4 · m6 | 6/6 DOĞRU |
| **b. Okuyucu `reader_binding` — Wi-Fi, İngilizce bilgi tabanı** | 2 (+or2a, or2b, t2, t4, hp10 g1'de de tutma) | c6 · m5-wifi | hepsi DOĞRU, birebir |
| c. Okuyucu `reader_binding` — diğer | 2 | m2 (fiyat düşmüş) · m3 (çamaşır makinesi) | m2 savunulabilir · m3 doğru |
| d. Okuyucu `reader_not_answered` | 1 | t6 ("kod varış sabahı gönderilir") | tartışmalı |
| e. Kod: `value_not_in_evidence` (diller arası) | 1 | m5-otobüs | DOĞRU |
| f. Yanlış alıntı (model değeri başka kalemden alıntıladı) | g3: 1 (or1a) · g4b: hp5 | or1a / hp5 | metin doğru, alıntı yanlış |
| g. Tur kapısı (anlama katmanı / risk etiketi) | g3: en3 · g4b: c7 | en3 (`reply_absence`) · c7 (erken giriş sanıldı) | DOĞRU |

"Metin gitti ama değer yok" (g3 5 · g4 4 · g4b 3): m2 · m3 · m4 · m6 · en7 = bir parça doğrulanıp gitti, kardeş parça (a / b / c sebebiyle)
tutuldu → kısmi gönderim; tutulan istek ev sahibinde açık. Zararsız. **İstisna g3 en6: dil hatası, aslında yanlış gönderim** (bölüm 2.3).

### 3.2 (b) Wi-Fi kaybının kökü — yüksek olasılıkla REDAKSİYON (kanıt güçlü, ürün fonksiyonuyla doğrulanmadı)
- Örüntü kesin: İngilizce bilgi tabanlı setlerde (teras, mini) Wi-Fi cevabı üç parça koşusunun HİÇBİRİNDE geçmedi (c6, m5, or2a, or2b, t2,
  t4, hp10 → 7 senaryo × 3 koşu = 21/21 tutma); Türkçe bilgi tabanlı bahçe evinde (nt2, c2, m1, hp1, hp7) 15/15 doğrulandı.
- Mekanizma: okuyucuya giden notlar `redactForSemanticModel(…, "ours")` → `redactSensitive` → `FIELD_RE` (`src/lib/redact.ts:18-42`).
  "password: olive2026" anahtar=değer kalıbı → **"password: [REDACTED]"**. Türkçe "şifre: menekse2024" kalıba uymaz → açık kalır. Parça ise
  "пароль: olive2026", "mot de passe est sunflower88", "şifresi olive2026" → maskelenmez. Okuyucu parçada şifreyi, notta `[REDACTED]`
  görüyor → "değer notlarda yok / bağ yanlış" → tutuyor. (Python kopyasıyla gösterildi: notlar maskeleniyor, parçalar maskelenmiyor.)
- Güvenlik bedeli yok gibi görünüyor: aynı şifre aynı sağlayıcıya cevap isteminde zaten gidiyor (redact.ts başlık yorumu da bunu söylüyor:
  "cevap istemi bu içeriği zaten taşıyor"). Yine de bu bir gizlilik kararıdır → kurucuya sorulur.
- Geri kazanım: 6 ihtiyaç (c6, m5-wifi, or2a, or2b, t2, t4; hp10 tur kapısında kalır). Yanlış artırma riski DÜŞÜK: çelişkili Wi-Fi (konak,
  Türkçe "şifre") zaten maskesiz ve okuyucu onu doğru tutuyor (cf1, or3a, or3b → 9/9 tutuldu).
- Öneri (kod yazmadım): okuyucu katmanında bilgi tabanı / parça metni (yazar "ours") için anahtar=değer maskesini kaldırmak YA DA parça ve
  notlara AYNI maskeyi simetrik uygulamak (ikincisi diller arası "пароль" yüzünden yetmez → birincisi). Önce ücretsiz birim testi:
  `buildPartReaderUserContent` bu yedi girdiyle çağrılıp notta `[REDACTED]` görüldüğü kanıtlanır.

### 3.3 (a) `polarity_mismatch` — kodun en pahalı yanlış alarmı
Üç parça koşusunda 27 `polarity_mismatch` reddi: **24'ü doğru bir cevabı** tuttu, yalnız 2–3'ü haklıydı (ne2 g3/g4 "high chair is not
listed" ve nt5 g4b "piscine n'est pas indiquée" — ikisi de aslında "bilgi yok" anlatımı; ters olumluluk değil).
Yanlış alarmların iki ortak biçimi (örnekler birebir):
1. **Kalemde iki şey, iki yön** ("var" + "yok"): "Binanın önünde ücretsiz sokak parkı var. Kapalı otopark yok." ↔ *"Binanın önünde ücretsiz
   sokak parkı var, ancak kapalı otopark yok."* (en1, Türkçe ↔ Türkçe, kelimesi kelimesine!) · "Washing machine available; no dryer." ↔
   *"There is a washing machine …, but there is no tumble dryer."* (en4) · nt6 / m6 / hp4 parka yalnız olumlu yarıyı yazan parçalar.
2. **Diller arası olumsuzluk**: "Smoking is not allowed anywhere, including the terrace." ↔ *"Rauchen ist … einschließlich der Terrasse,
   nicht erlaubt."* (c11) · "Sigara içmek yasaktır, balkonda da içilmez." ↔ *"Il est interdit de fumer …, y compris sur le balcon."* (m4) ·
   "Beach towels are not provided." ↔ *"No proporcionamos toallas de playa"* (en6) · "Parties and events are not allowed." ↔ *"… не
   разрешается."* (en8).
Hangi dalın tetiklediğini kod okumasıyla kesinleştiremedim (`answer-binding.ts:2250-2296` üç ayrı olumluluk dalı) — **emin değilim**;
davranış kesin.
- Geri kazanım: g4'te 6–7, g4b'de 9 ihtiyaç. Ama bu denetim BİLİNÇLİ kodda tutuluyor (Opus 10-23 B1: "izin ↔ yasak" ev sahibini en çok haksız
  duruma düşüren sınıf). Gevşetmek bir güvenlik katmanını değiştirmektir → kurucuya sorulur.
- Öneri: (i) bu 24 (parça, alıntı) çiftini + her birinin TERS çevrilmiş hâlini ("Kapalı otopark var", "Rauchen ist erlaubt") çevrimdışı bir
  tabloya koyup (ücretsiz, model yok) önce ölçmek; (ii) iki seçenek: dedektörü bu iki biçimde düzeltmek, ya da kod yalnız EMİN olduğunda
  (tek konu, iki taraf da tanınan dilde) tutsun, emin olmadığında karar okuyucunun `supported_by_notes` sorusuna kalsın (okuyucu istemi ters
  evet/hayırı zaten açıkça soruyor — `part-reader.ts:79-83`). İkincisi kurucunun 11-18 "anlam kararı modele" kuralına daha uygun.

### 3.4 (c)(d) okuyucunun model kararları — güvenle geri kazanılamaz
- m2: parça "400 m'de saatlik ücretli otopark" dedi, "3 EUR"yu düşürdü → `binding`. g4b'de model "3 EUR"yu yazınca geçti. Okuyucu tutarlı;
  düzeltme yeri parça yazarı ("kalemdeki bütün değerleri koru"). İstem değişikliği → ölçüm ister.
- m3: aynı anlamlı Almanca parça g3 / g4'te tutuldu, g4b'de geçti → saf okuyucu kararsızlığı. Sebebi görünmüyor (**emin değilim**).
- t6: "Kutunun şifresi ne?" ↔ "kod varış sabahı gönderilir" — okuyucu "sorulanı vermiyor" diyor; set "cevaplandı" bekliyor. İkisi de
  savunulabilir. Okuyucunun zaten var olan `only_known_case` / `keepOpen` yolu (gönder ama açık bırak) bu tür için uygun olabilir — öneri,
  ölçülmedi.

### 3.5 (e)(f) kod / alıntı
- m5-otobüs (üç koşuda da): İspanyolca "parada de autobús … 150 metros … línea 12" ↔ "Bus stop 150 m …; line 12 …" → `value_not_in_evidence`
  (ize düşen yan bulgu `subject_missing`, `value_bound_elsewhere`). Diller arası konu eşleşmesi kaçıyor gibi; **emin değilim**. 1 ihtiyaç.
- or1a (g3) / hp5 (g4b): model "11:00"ı "Çıkış: anahtarı kutuya koyun …" kalemiyle alıntıladı; 11:00 mülk bilgisinde var. Kod doğru reddetti.
  Rastgele (öteki koşularda doğru alıntı). Öneri: değer, konuyu anan TEK bir gösterilen kaynakta birebir varsa kod alıntıyı oraya
  yeniden bağlasın — ölçülmeli, risk orta.

### 3.6 Kollardan bağımsız en büyük havuz: held_plus_answer (9/10, beş kolda da)
g4'te 7 senaryoda cevap parçası DOĞRULANDI ama bütün tur tutuldu: hp1 / hp5 / hp7 evcil hayvan kapısı (`reply_pet_policy`), hp2 / hp3 /
hp8 / hp9 erken giriş / geç çıkış (`availability_unconfirmed`). Riskli istek ev sahibinde kalırken doğrulanmış parçanın gitmesi yeni bir
ürün davranışıdır (S3 evcil hayvan ayrımı kodu var, anahtarı KAPALI; müsaitlik için karşılığı yok) → kurucu sorusu, burada önerilmez.

### 3.7 Özet: güvenle geri kazanılabilir olanlar (yanlışı artırmadan, tahmin)
| iş | katman | kazanç (g4'e göre) | yanlış riski | kurucu sorusu? |
|---|---|---|---|---|
| Okuyucu notlarında KB değerini maskeleme | redaksiyon | +6 | düşük | evet (gizlilik) |
| Olumluluk dedektörü yanlış alarmları | kod doğrulaması | +6…9 | orta (güvenlik katmanı) | evet |
| Diller arası konu eşleşmesi (m5-otobüs) | kod doğrulaması | +1 | düşük | hayır (ölçerek) |
| Alıntıyı doğru kaleme yeniden bağlama | kod | +0…1 | orta | hayır (ölçerek) |
Kaba üst sınır: g4 36 → ~48–50 (g1 41, g2 45), yanlış 1–2 düzeyinde kalırsa. Bu bir TAHMİN; her iş tek tek ölçülmeden doğru sayılmaz.

---

## 4. g4'ün iki koşusu arasındaki fark (kararsızlık)

İhtiyaç düzeyinde 5 fark, 5 farklı senaryoda; hepsinin kökü model ifadesindeki küçük değişiklik + ifadeye duyarlı doğrulayıcı:

| senaryo | g4 → g4b | neden |
|---|---|---|
| en7 | OK → tutma | g4b parçası "Çamaşır makinesi var, ancak kurutma makinesi yoktur" diye İKİ yönü yazdı → `polarity_mismatch` (3.3 biçim 1) |
| c4 | YANLIŞ → OK | g4 parçayı Türkçe yazdı (dil), g4b Fransızca |
| c7 | OK → tutma | g4b'de anlama katmanı "check-in saati ne?" sorusunu erken giriş saydı (`early_checkin`) → `availability_unconfirmed`, tur tutuldu |
| m2 | tutma → OK | g4 "3 EUR"yu düşürdü → okuyucu `binding`; g4b yazdı → geçti |
| m3 | tutma → OK | aynı anlamlı parça; okuyucu hükmü döndü |

Sonuç: koşudan koşuya ±5 ihtiyaç gürültü var. g3 ↔ g4 farkı 6 ihtiyaç (en3, en8, or1a, c4, m7 ×2) → **gürültüyle aynı büyüklükte**.
Toplamların gürültüsü: doğru 36↔37, yanlış 2↔1; tek koşuluk g1 / g2 / g3 sayıları da bu kadar oynayabilir.

---

## 5. Kaynak kuralı (g2) ne kazandırıyor, neye mal oluyor

g1 → g2:
- Yanlış 21 → 11: kalkan 11 (uydurma 6'nın 6'sı, "bilgi yok" anlatımı 3, c4 dili, m3 sessiz kapanış), yeni 1 (vt1 değer aktarma).
  **Kalan 11'in 6'sı çelişki, 2'si aktarma** — kaynak kuralı bu iki sınıfa dokunmuyor.
- Doğru 41 → 45 (+8 / −5). Kazanç: model cevapsız soruyu hiç anmayınca kardeş cevaplar gitti (or2a, or2b, t3, t4, m7 ×2, nt2, en8).
  Kayıp: model aynı kuralla bu kez "kayıtlarımda yok" / "mesajınız kaydedildi" cümlesi yazdı, kapı BÜTÜN turu tuttu (nt6, m3 ×2, m8 ×2).
  Yani kaynak kuralı istemle "anma" ister, ama model bazen anmak yerine anlatıyor — parça kipinin yapısal çözdüğü şey tam bu.
- Maliyet / gecikme farkı yok (tek model çağrısı; $0.82 ↔ $0.84).

Parça kipiyle birlikte (g3 ↔ g4 / g4b): doğru 34 ↔ 36 / 37, tutma 30 ↔ 27 / 27, açık 53 ↔ 53 / 53, yanlış 1 ↔ 2 / 1. Fark bölüm 4'teki
gürültü içinde; **ölçülebilir ek fayda yok, ölçülebilir zarar da yok.** Parça kipinde "cevapsız soru" zaten `no_info` ile cümle üretmiyor;
kaynak kuralının g2'deki işi orada yapısal olarak yapılmış oluyor.

Parça kipinin bedeli (g1 / g2'ye göre): medyan süre ~6,5 sn → ~8,3–8,7 sn, p90 ~8,3 → ~11,6–12,6 sn; maliyet +%7–19 (okuyucu çağrısı).

---

## 6. ÖNERİ (kurucuya gidecek, sade)

**Kısa cevap:** açılış adayı **parça kipi + okuyucu + öğe sırası (+ kaynak kuralı)** — ölçülen g4. Ama **bugünkü hâliyle açılmamalı**.
Bugünkü hat 74 mesajın 21'inde misafire yanlış ya da uydurma bir şey gönderiyor; kaynak kuralı tek başına bunu 11'e indiriyor ama
çelişkili bilgiyi seçmeyi hiç durdurmuyor. Parça kipi yanlışı 1–2'ye indiriyor, karşılığında doğru cevapların bir kısmını tutuyor
(64'ten 41–45 yerine 34–37). Bu tutmaların yarıdan fazlası iki düzeltilebilir kusurdan geliyor (Wi-Fi şifresinin okuyucuya maskeli
gitmesi, "var/yok" içeren doğru cevapların ters sanılması).

Kaynak kuralını birlikte açmak: zararı ölçülmedi, ek faydası da ölçülmedi (gürültü içinde). Parça kipinin ölçülmemiş bir yoldan düştüğü
durumlar için bir sigorta olarak açılabilir; "kazandırıyor" diye sunulmamalı.

**Önce / sonra örnekleri** (misafir mesajı → bugünkü hat → önerilen birleşim; "önerilen" = g4'te ölçülen davranış, düzeltme gerekenler belirtildi)

1. *"Ütü var mı? Arabayı nereye park ederiz?"* (bilgilerde ütü yok; sokak parkı ücretsiz)
   - Bugün: *"Dairede kullanabileceğiniz bir ütü var. Arabanızı binanın önündeki ücretsiz sokak parkına bırakabilirsiniz."* — ütü uydurma.
   - Önerilen (ölçülen): hiçbir şey gitmiyor; iki soru da panelde açık (park cevabı "var/yok" yanlış alarmına takılıyor).
   - Önerilen (yanlış alarm düzeltilince beklenen): *"Arabanızı binanın önündeki ücretsiz sokak parkına bırakabilirsiniz."* Ütü sorusu
     panelde açık kalır.
2. *"Wi-Fi şifresi neydi?"* (bilgilerde iki farklı şifre yazılı)
   - Bugün: *"Wi-Fi ağ adı LaleKonak, şifre gul5678."* — iki şifreden biri; yarı ihtimalle yanlış.
   - Önerilen: hiçbir şey gitmez; soru panelde açık (iki bilgi çeliştiği için) — üç koşunun üçünde de.
3. *"Is there a sauna? And what time is check-out?"* (sauna bilgisi yok)
   - Bugün: *"There is no sauna mentioned among the facilities. Our check-out time is 11:00."* — "bilgilerde yok" anlatımı misafire gitti.
   - Önerilen: *"Our check-out time is 11:00."* Sauna sorusu panelde açık.
4. Bedeli gösteren örnek — *"Какой пароль от Wi-Fi?"* (tek şifre, bilgiler İngilizce)
   - Bugün: *"Сеть Wi-Fi называется Lale_Terrace, пароль: olive2026."* — doğru, gidiyor.
   - Önerilen (ölçülen): GİTMİYOR — kontrol eden model şifreyi maskeli görüp doğrulayamıyor. Düzeltilince gider.
5. Hâlâ açık risk — *"Çöpler hangi günler toplanıyor?"* (bir kalem "salı ve cuma", öteki "her akşam")
   - Bugün de önerilen de yanlış gönderiyor; önerilen: *"Çöpler salı ve cuma akşamı toplanıyor; her akşam çöpü kapının önüne
     bırakabilirsiniz."* — iki çelişkili bilgiden kendi uzlaştırmasını kuruyor. Açmadan önce düzeltilmeli.

**Açmadan önce (sıra önerisi):**
1. Çelişki: okuyucuya "notlar kendi aralarında çelişiyorsa tut" sorusu (anlam kararı modelde kalır) + cf4 tipi vakalarla ölçüm.
2. Parça kipinde dil: misafirin dilinde olmayan parça gitmesin (3 parça koşusunun 2'sinde Türkçe gövde yabancı misafire gitti: c4, en6).
3. Okuyucu notlarında maskeleme (kurucu sorusu: gizlilik) — +6 cevap beklentisi.
4. Olumluluk yanlış alarmı (kurucu sorusu: güvenlik katmanı) — +6…9 cevap beklentisi; önce ters çevrilmiş çiftlerle ücretsiz tablo.
5. Ölçer düzeltmeleri (bölüm 7) — yoksa sonraki ölçüm de "bilgi yok" ve dil hatalarını eksik sayar.

**Gereken ek ölçüm:**
- Bu set yandı. Düzeltmelerden sonra KULLANILMAMIŞ bir kör set; kol başına en az 2 koşu (bölüm 4: ±5 ihtiyaç gürültü). Kollar: g1 (taban),
  g4 düzeltilmiş, g3 düzeltilmiş (kaynak kuralının parça kipinde gerçekten bir şey yapıp yapmadığını ayırmak için).
- Okuyucusuz parça kipi hiç ölçülmedi — okuyucunun tek başına ne tuttuğu / ne kurtardığı bilinmiyor (gecikme ve maliyetin kaynağı o).
- Çevrimdışı ve ücretsiz: bu dosyadaki (parça, alıntı) çiftleriyle olumluluk / redaksiyon / diller arası konu tabloları + ters mutantlar.
- held_plus_answer (S3 evcil hayvan ayrımı) parça kipiyle ayrı ölçüm — en büyük tek kazanç havuzu (7 doğrulanmış parça) ama ürün kararı.

---

## 7. Ölçerin kendi sınırları / şüpheli sayımlar

1. **"Bilgim yok" sayacı kör (raporda 0, gerçekte g1 4 · g2 3).** `ABSENCE_LEAK` (`live-pipeline.eval.test.ts:546`) yalnız birkaç kalıp arıyor;
   *"n'est pas indiquée"* (nt5, g1+g2), *"no sauna mentioned"* (or1a g1), *"pas d'information"* (m4 g1), *"pas de tram indiqué"* (ne6 g1),
   *"записи … у меня нет"* (m6 g2) yakalanmıyor. Parça kollarında giden metinlerde bu türden ifade bulamadım (0) — ama aynı kör sayaçla
   değil, elle taranmış geniş kalıpla.
2. **Dil ölçüsü kısa yabancı-dilli gövdeyi göremiyor.** `languageMatches` (`reply-scoring.ts:41-52`) Türkçe harf YOĞUNLUĞUNA bakıyor; Fransızca
   selam + Fransızca açıklama satırı arasındaki kısa Türkçe cümle (c4: g1 ve g4) `langOk=true`. Ayrıca dil hatası yanlış gönderim sayacına hiç
   girmiyor: g3 en6 (İspanyola Türkçe) "metin gitti ama değer yok" olarak TUTMA sayıldı.
3. **Dil hatası "yanlış değer" diye sayılıyor** (c4: Fransızca desen yok + öğe "cevaplandı" → yanlış). Toplam doğru ama sınıf yanlış;
   kök neden analizini yanıltabilir.
4. **Açık kalmalı ihtiyaçta öğe "cevaplandı" kapanınca metin sessiz olsa da yanlış sayılıyor** (g1 m3). Bence doğru (iş yanlış kapandı, ev
   sahibi görmez) ama "misafire yanlış bilgi gitti"den farklı bir zarar; raporda ayrı satır olsa okunması kolaylaşır.
5. **ne6 yasak listesi** otobüs bilgisini de yasaklıyor; bilgi tabanındaki doğru alternatifi önermek tartışmalı. Bu sette sonucu değiştirmedi
   (metin aynı zamanda "bilgilerde yok" anlatımı taşıyordu).
6. **Tek koşu gürültüsü**: g4 iki koşusu 5 ihtiyaçta ayrışıyor; g1 / g2 / g3 tek koşu. ±5'lik farklar (g3↔g4) karar dayanağı olmamalı.
7. **held_plus_answer 9/10 her kolda tutma** — kollar arası farkı etkilemiyor ama mutlak "doğru %" oranlarını her kolda ~%14 aşağı çekiyor.
8. Kontrol ettiğim ve sorun bulmadığım: bütün yanlış gönderimlerde `sent=true` (gitmeyen metin yanlış sayılmamış); toplamlar raporlarla
   birebir; "aynı türden iki ihtiyaç" sıkı kuralı bu sette hiçbir yanlış üretmedi.

### Emin olmadıklarım (ayrı)
- 3.2 redaksiyon: Python kopyasıyla gösterildi, ürünün `buildPartReaderUserContent` çıktısıyla doğrulanmadı (yüksek olasılık).
- 3.3: olumluluk denetiminin hangi dalının tetiklendiği.
- 3.4 m3 okuyucu hükmünün sebebi; 3.5 m5-otobüs `value_not_in_evidence` kökü.
- Ürün dil kapısının c4 / en6'yı neden geçirdiği: "iki taraf da eminse tut" kuralı + kısa metin olduğu kod okumasından çıkarım; ölçülmedi.
- 3.7 kazanç tahminleri ölçüm değil; ne2 / nt5'i bugün yalnız olumluluk denetimi tutuyordu — düzeltmeden sonra başka bir katmanın ("bilgi
  yok" kapısı) tutacağı varsayımı doğrulanmadı.
