# Sözcük ağları — envanter, "Anahtarı kaybettim" neden giriş sorusuydu, eklenenler, eklenebilecekler

> Kurucu 10-29 gece: "Anahtarı kaybettim check-in sorusu değil ki — bana sözcük ağlarını ve kelime yakalamalarını at, örneklerle,
> neler eklenebilir." Bu belge onun cevabıdır. Ölçümler 10-29 gece, saf fonksiyonlar (`classifyFallback`, `detectRiskTypes`,
> `isSafetyEmergencyText`, `hazardEvidenceOf`) ~140 örnek mesajla koşuldu; model / veritabanı / OpenAI yok.
> Kural (kurucu K-1029-C): sözcük ağı ve ek okuma **karar vermez**; yalnız **ipucu** ya da **sıkılaştıran yedek** olur (bir mesajı ev
> sahibine BIRAKABİLİR, asla misafire bir şey GÖNDERTMEZ). Anlamı model okur.

## 1. Neden "Anahtarı kaybettim" giriş sorusu sayılıyordu (10-29 akşamına kadar)

Sınıflandırıcı (`fallback.ts` `detectIntent`) sırayla bakar: şikâyet → iade → erken ayrılma → insan isteği → erken giriş → geç çıkış →
**giriş** → çıkış → Wi-Fi … İlk tutan kazanır.

1. Şikâyet listesinde (236 giriş) "kayb", "lost", "missing" YOK. "anahtar dönmüyor" var ama "anahtar kayb…" yok.
2. Cihaz arızası kuralı "anahtar"ı cihaz sayıyor ama yalnız beş arıza fiilini tanıyor (bozuldu, bozulmuş, arızalı, arızalandı,
   arızalanmış) — "kaybettim" onlardan değil.
3. **Giriş KONU listesi** `"giriş", "check-in", "anahtar", "key", "kapı kodu", "access" …` — "anahtarı kaybettim" içinde "anahtar"
   geçiyor → niyet `checkin`, öncelik `standard`.
4. Risk ağlarında (`RISK_NETS`) kayıp OLAYI için hiçbir satır yoktu. `access_security` etiketi kapının yüksek riskli listesinde,
   arayüzde ("giriş / erişim sorunu"), öğe eşlemesinde (`access_keys`) HAZIRDI ama hiçbir sözcük ağı onu üretmiyordu.

Sonuç: tutulmuyor, e-posta yok, görev yok; yalnız cevap modeli kendisi `access_security` derse tutuluyordu. Almanca / Fransızca /
İspanyolca / Rusça / Arapça kayıp cümlelerinde hiçbir etiket yoktu (`general`).

**Yapısal ders:** KONU ağı bir mesajın NE HAKKINDA olduğunu söyler ("anahtar"), NE OLDUĞUNU söylemez ("kaybettim"). Konu ağı olay
ağından önce koştuğu için, eksik olay tespiti "sıradan giriş sorusu" görüntüsünün arkasına saklanıyordu.

## 2. Ağ türleri

| Tür | Ne söyler | Örnek ağ | Örnek sözcük |
|---|---|---|---|
| **KONU** | mesaj ne hakkında | `KEYWORDS.checkin`, `wifi`, `parking`, cihaz envanteri | "anahtar", "şifre", "otopark", "klima" |
| **OLAY** | ne oluyor | şikâyet listesi, olumsuz fiiller, acil ağı, tehlike okuyucusu, **erişim kaybı (yeni)** | "bozuk", "su gelmiyor", "yangın", "kaybettim" |
| **EYLEM / DURUŞ** | misafir ne yapıyor / ne istiyor | iade, iptal, kötü yorum tehdidi, platform dışı ödeme, insan isteği, ayrımcılık, enjeksiyon | "iade", "1 yıldız veririm", "IBAN", "gerçek kişi" |
| **KORUMA** | eşleşmeyi geri alır | olumsuzlama, koşul, "acil çıkış", "fire exit", "acil değil" | "sorun yok", "sorun olursa", "acil değil" |
| **BEYAZ LİSTE** | cevap gerekmez / nezaket cevabı | kapanış sözcükleri, övgü | "teşekkürler", "harikaydı" |

## 3. Ağ envanteri (özet; satır numaraları `fallback.ts`)

| Ağ | Tür | Büyüklük | Diller | Örnekler | Ne yapar |
|---|---|---|---|---|---|
| Şikâyet (`KEYWORDS.complaint`) | OLAY | ~236 | 8 dil | "çalışmıyo", "kirli", "broken", "funktioniert nicht", "не работает" | niyet şikâyet, oto-cevap yok, uyarı e-postası |
| Olumsuz fiiller | OLAY | ~188 | çoğu TR, biraz EN | "su gelmiyo", "kapı açılmıyo", "anahtar dönmüyo", "door won't open" | şikâyet |
| Cihaz arızası (cihaz × fiil) | OLAY×KONU | 115 cihaz, 5 fiil | TR | "klima bozuldu", "kombi arızalı" | şikâyet |
| İade | EYLEM | ~102 | 8 dil | "iade", "refund", "remboursement" | `money_refund` |
| Erken ayrılma / iptal | EYLEM | 68 | 8 dil | "iptal et", "leave early", "stornieren" | `cancellation` |
| İnsan isteği | EYLEM | 22 | TR, EN | "gerçek kişi", "talk to the host" | devir |
| Kötü yorum tehdidi | EYLEM | 34 | TR, EN | "1 yıldız veririm", "leave a bad review" | `review_threat` |
| Platform dışı ödeme | EYLEM | 41 | TR, EN | "elden ödeme", "iban gönder", "pay you directly" | `platform_policy` |
| Ayrımcılık | EYLEM | 33 | TR, EN | "yabancı olmasın" | `discrimination` |
| Kural ihlali (evcil hayvan, parti, fazla kişi, çıkmayı reddetme) | EYLEM+KONU | ~80 | TR, EN | "köpeğimiz", "party", "çıkmak istemiyorum" | `rule_violation` |
| Acil ağı | OLAY | ~300 + 66 tam sözcük + 9 kalıp | 7 dil | "yangın", "gaz kaçağı", "bayıldı", "kilitli kaldı", "locked out", "su bastı", "intihar" | `safety_emergency`, tur düzeyi tutuş |
| Tehlike okuyucusu (`hazard-evidence.ts`) | OLAY + KORUMA | onlarca kalıp | 7 dil | yalnız yangın / duman / gaz / su / elektrik | açık / olası / anılış |
| **Erişim kaybı (YENİ, 10-29 gece)** | OLAY (nesne × kayıp fiili) | ~45 nesne, ~110 fiil, ~45 kalıp | 7 dil | aşağıda §4 | `access_security` |
| Giriş / çıkış / Wi-Fi / otopark / konum / temizlik / olanak | KONU | 7–15'er | TR, EN | "anahtar", "şifre", "otopark" | yalnız niyet etiketi (yedek taslak) |
| Enjeksiyon | EYLEM (saldırı) | 44 kalıp | 7 dil | "ignore previous instructions", "önceki talimatları unut" | `prompt_injection` |

## 4. Bu gece eklenen: erişim kaybı ağı (`isAccessLossText`, kurucu GD4 "hosta kalsın, öncelikli gösterilsin")

**Nasıl okur:** aynı CÜMLEDE bir **nesne** (anahtar, kapı / oda kartı, otopark / garaj kumandası, anahtar kutusu, key, key card, fob,
lockbox, Schlüssel, clé, badge, llave, ключ, مفتاح) ile bir **kayıp fiili** (kaybettim / kayboldu / kayıp / bulamıyorum / çaldırdım /
çalındı / kilitte kırıldı / içeride unuttum / kutusu boş …; lost my / can't find / stolen / broke in the lock / missing / is empty;
verloren / gestohlen; perdu / volé; perdido / robaron; потерял / украли; فقدت / سرق). Ek OKUNMAZ: fiilin tam biçimleri listede;
varsayım biçimi ("kaybedersem", "if I lose") listede olmadığı için eşleşmez. Bir de nesnesiz / bitişik kilitli kalma kalıpları
("kapıda kaldık", "locked myself out", "anahtarı unuttum", "locked out", "kilitli kaldım", "ausgesperrt").

**Örnekler — artık ev sahibine kalır:**

| Mesaj | Önce | Şimdi |
|---|---|---|
| Anahtarı kaybettim | giriş sorusu, oto-cevap gidebilir, e-posta yok | tutulur, ev sahibine acil e-posta, konuşma **Acil** |
| Anahtarımı kaybettim, yedek var mı? Wi-Fi şifresi ne? | anahtar kısmı da cevaplanabilir | **Wi-Fi cevaplanır**, anahtar isteği ev sahibinde açık + Acil |
| Çantam çalındı, anahtar da içindeydi | giriş sorusu | tutulur + Acil |
| Anahtar kutusu boş | giriş sorusu | tutulur + Acil |
| Anahtar kilitte kırıldı | giriş sorusu | tutulur + Acil |
| I lost my keys / I can't find my keys | giriş sorusu | tutulur + Acil |
| Ich habe meinen Schlüssel verloren / J'ai perdu la clé / He perdido la llave / Я потерял ключ / فقدت المفتاح | **hiç etiket yok** | tutulur + Acil |
| I'm locked out / Kapıda kilitli kaldım | tutuluyordu ama **oto-yanıt kapalıyken e-posta yoktu** | tutulur + e-posta + Acil (etiket acil kalır) |

**Örnekler — dokunulmaz (kontrol vakaları, test pinli):**

| Mesaj | Neden |
|---|---|
| Anahtarı nereden alacağız? / Where do I pick up the keys? | kayıp fiili yok — giriş sorusu, bilgi tabanından cevaplanır |
| Anahtarı kaybedersem ne olur? / What if I lose the key? | varsayım biçimi listede yok |
| Pasaportumu kaybettim / Kartımı kaybettim / I lost my credit card | nesne anahtar değil (çıplak "kart" bilerek yok) |
| Kumandayı bulamıyorum | TV kumandası — yalnız "otopark / garaj / kapı kumandası" nesne |
| Trafikte sıkıştık, anahtarı nereden alacağız? | "sıkıştık" cümle düzeyinde aranmaz (yalnız "kilitte sıkıştı") |
| We got lost, where is the key box? / I forgot to ask, where do we leave the keys? | "got lost" yol kaybı; "forgot" yalnız "forgot my key" bitişik |
| Anahtarı aldım. Cüzdanımı kaybettim. | ayrı cümleler |
| We love Turkey! | "key" tam sözcük |
| İçeri giremiyor muyuz erken? / I can't get in touch with the cleaner | "içeri giremiyor" ve "can't get in" bilerek alınmadı |

**Bilinen fazla tutuş (güvenli yön, sabah sorusu GD4-b):** "Kayıp anahtar ücreti ne kadar?", "Dairenin iki anahtarını da kaybettik,
ne kadar ödememiz gerekiyor?" — SSS gibi görünen ama kaybı bildiren / kayıp sözcüğü taşıyan sorular da ev sahibine kalır (önce
bilgi tabanındaki ücreti söyleyebiliyordu). "Daireyi bulamıyoruz, anahtar kutusu nerede?" de aynı cümlede "bulamıyoruz" + "anahtar"
taşıdığı için tutulur.

## 5. Eklenebilecekler (kurucu kararı bekleyenler — ÖNCE / SONRA)

| # | Sınıf | Bugün | Öneri | Önce → sonra örneği |
|---|---|---|---|---|
| B | Çoğul / farklı kilitli kalma: "Eve giremiyoruz", "We cannot get in", "Wir kommen nicht rein", "No podemos entrar" | etiket yok, oto-cevap gidebilir | **Yedek**: yer (eve / daireye / binaya / into the apartment) × giremiyoruz / cannot get in. Çıplak "giremiyor" ALINMAZ ("Erken giremiyor muyuz?") | "Eve giremiyoruz" → bugün model ne derse; sonra: tutulur + e-posta + Acil |
| D | İçeride mahsur kalma: "Asansörde kaldık", "My son is locked in the bathroom" | yalnız TR "kilitli kaldı" | **Yedek → acil**: yer (asansör / banyo / elevator / bathroom) × mahsur / stuck / locked in | "We are stuck in the elevator" → bugün etiket yok; sonra acil (tur düzeyi) |
| E | Yanlış kod: "Kapı kodu yanlış", "The code you sent is wrong" | "kapı şifresi yanlış" **Wi-Fi** sayılıyor! | **Yedek**: kod / şifre / code × yanlış / hatalı / wrong — YALNIZ kapı / kilit / anahtar kutusu / bina sözcüğüyle aynı cümlede ("Şifre yanlış galiba wifi" Wi-Fi kalır) | "Kapı kodu yanlış" → bugün oto-cevap koda yeniden dokunabilir; sonra ev sahibine Acil |
| F | "isn't working" kısaltması; diğer dillerde "anahtar dönmüyor" | "The door code isn't working" etiketsiz | şikâyet listesine "isn't working / aren't working / wasn't working"; DE/FR/ES/RU/AR "dönmüyor" erişim ağına | — |
| H | Anahtar kutusunu bulamama: "Anahtar kutusunu bulamıyoruz" | **bu gece tutulmaya başladı** (sözünüz "bulamıyorum gibi şeyler hosta") | Seçenek: (a) böyle kalsın, (b) bilgi tabanında kutunun yeri yazılıysa cevap gitsin + ev sahibine bildirim | "We can't find the key box" → şimdi tutulur |
| I | Kapı kilitlenmiyor (EN ve diğer diller) | yalnız TR şikâyet | **Yedek** `access_security` (güvenlik hissi) | "The door won't lock" → bugün etiketsiz |
| L | Akıllı kilit pili bitti / çevrimdışı | etiketsiz | **Yedek** `access_security` | "The smart lock battery is dead" |
| N | Kayıp SSS'si ("Kayıp anahtar ücreti?") | şimdi tutuluyor | Sabah sorusu GD4-b: SSS cevaplansın mı? Ek okuyarak değil, MODELİN "olay mı soru mu" sinyaliyle (K-1029-C) | — |
| G2 | Görev | kayıp anahtar için görev yok | İstenirse "erişim — acil" görevi (2 saat) | — |

Hepsi **yalnız sıkılaştırır** (daha çok ev sahibine bırakır). Uzun vadeli doğru yol (K-1029-C araştırması): anlama katmanı her istek
için "olay mı / soru mu / varsayım mı" sinyali verir; sözcük ağı yalnız modelin kaçırdığı durumda emniyet kemeri olur.

## 6. E-posta ne zaman gider, ne zaman yalnız panelde görünür

Bildirim taşıyıcısı bugün **yalnız e-posta** (WhatsApp / SMS / anlık bildirim kodu YOK — kurucu notu: en önemlileri ileride WhatsApp'tan,
`docs/claude/acik-isler.md`). Alıcı: işletmenin **uyarı adresi**, yoksa **en eski sahip**; personel ve operatör asla.

| # | Ne zaman | Konu satırı | Sıklık / tekrar | Bayrak |
|---|---|---|---|---|
| A1 | Kelime yolu uyarısı — her senkron geçişinde, **oto-yanıt kapalı olsa da**: cevapsız (≤72 sa) misafir mesajı şikâyet / iade / açık-olası tehlike / **kayıp anahtar / kilitli kalma (yeni)** | ⚠️ Acil misafir mesajı — {misafir} ({daire}) | konuşma başına bir ("Yeni → Sorunlu" kilidi); düşerse geri alınır | yok (alıcı yeter) |
| A1b | A1'in öğe kipi (öğe kipi açıkken, acil / enjeksiyon değilse) | aynı | mesaj başına bir | konuşma öğeleri açık |
| A2 | Model yolu: cevap modeli / anlama katmanı yüksek risk dedi, kapı tuttu | aynı | konuşma başına bir | oto-yanıt açık + mesai içi + premium |
| A3 | Olası fiziksel tehlike, anlama katmanı koşamadı | aynı | işletme başına saatte 3 | oto-yanıt açık |
| A4 | Ev sahibine bırakılan hassas istek (öğe kipi) | aynı | mesaj başına bir | konuşma öğeleri açık |
| A5 | "Misafir cevabınızı bekliyor" — sessiz kalan gerçek açık ihtiyaç | Misafir cevabınızı bekliyor — … | mesaj başına bir, aynı ihtiyaç bir yıl tekrar yok | oto-yanıt açık |
| A6 | Karar kartı | Karar bekliyor: … | kart başına bir | `HOST_DECISIONS_ENABLED` (kapalı) |
| A7 | QR sohbetinde devir | ⚠️ Misafir sohbetinde size devredilen mesaj — {daire} | konaklama başına 5 dk bekleme; kritik (acil / **kayıp anahtar, yeni**) beklemesiz, saatte en çok 3 | `QR_ESCALATION_EMAIL_ENABLED` (kapalı) |
| A8 | Ev sahibinin elle açtığı konuşmada şikâyet | Acil Şikayet: … | olay başına bir | yok |

**Yalnız panelde görünenler (e-posta YOK):** "Dikkat Gerektirenler" satırları (cevapsız 6 sa+, ayrılış yaklaşırken cevapsız, bağlantı
sağlığı, gönderim doğrulanamadı, söz gecikmesi, tekrarlayan sorun …), gelen kutusu rozetleri ("N açık iş", "Karar bekliyor",
"Gönderim doğrulanamadı", kırmızı **Acil** simgesi), konuşma sayfasındaki "Sebep:" şeridi, kaynak / asistan sorusu (kurucu 10-23:
yalnız panel). Giden misafir mesajı teslim edilemezse ev sahibine e-posta GİTMEZ — panelde görünür.

**Öncelik ("Acil" işareti) kim yazar:** model yolu (A2), olası tehlike (A3), elle açılan şikâyet (A8), QR devri; **yeni:** kelime yolu
uyarısında acil ve erişim kaybı (A1), öğe kipinde tutulan acil / erişim kaybı isteği. Şikâyet / iade önceliği bilerek DEĞİŞMEDİ.
Gelen kutusu bugün önceliğe göre DEĞİL, son mesaj zamanına göre sıralı (önceliğe göre sıralama kurucu kararı — sabah sorusu).
"Dikkat Gerektirenler"de erişim kaybı acil satırla aynı üst sırada (99).


## K-1029-C envanteri — bugün bir tutuşu GEVŞETEN ek / koşul / olumsuzluk okuyucuları (10-30, tasarım S14; her örnek denemeyle doğrulandı)

Kurucu ilkesi (K-1029-C): sözcük kuralı yalnız SIKILAŞTIRIR; "bu acil / şikâyet DEĞİL" kararını anlamı okuyan model vermeli. Aşağıdaki 15
kural bugün tek başına gevşetiyor. "Doğru" sütunu kuralın amacı, "Yanlış" sütunu gerçek bir acil / şikâyetin aynı kuralla düştüğü örnek.

| # | Kural (dosya) | Neyi gevşetiyor | Doğru gevşetme | Yanlış gevşetme (bugün) |
|---|---|---|---|---|
| 1 | Varsayım listesi (`hazard-evidence.ts` HYPOTHETICAL) | açık yangın / gaz / su → "anıldı" | "Yangın çıkarsa ne yapmalıyım?" | "Yangın çıktı ne olursa olsun yardım edin!" ("olursa" deyimde) |
| 2 | Geçmiş listesi (aynı dosya, PAST) | süren olay → geçmiş | "Dün gece yangın çıkmıştı, şimdi her şey yolunda." | "Dün gece yangın çıktı ve mutfak hâlâ yanıyor" |
| 3 | "anıldı → temizlendi" (model koşmadan) | acil etiketi silinir | "Mutfakta duman yok, merak etmeyin." | "No way the fire is under control, it keeps spreading" |
| 4 | Olumsuzluk penceresi (NEG_BEFORE / NEG_AFTER) | canlı yangın anılması düşer | (3 ile aynı) | (3 ile aynı — "No way" olumsuzluk sayılıyor) |
| 5 | Dedektör "if" okuyucusu (`gas-detector-alarm.ts`) | öten CO alarmı → varsayım | "If the CO alarm goes off, what should I do?" | "If you ask me, the CO alarm is beeping" |
| 6 | Dedektör olumsuzluğu | (son hükümde gevşetme bulunamadı) | "The CO alarm is not beeping, I just want to know where it is." | — |
| 7 | "when" yöntem sorusu | öten alarm → nasıl yapılır sorusu | "When the CO alarm goes off, what do I do?" | "When the CO alarm goes off, my son is lying on the floor" |
| 8 | "acil değil" (`fallback.ts` NOT_URGENT) | "acil" sözcüğü silinir | "Acil değil, havlu lazım." | "Acil değil, adam yerde yatıyor, bilinci yok" |
| 9 | "acil çıkış" / "polis merkezi" yer adı | güvenlik sözcüğü silinir | "Polis merkezi nerede?" | "Polis merkezi nerede? Biri kapımızı kırmaya çalışıyor" |
| 10 | Olay dışı çerçeve (NON_INCIDENT_FRAMES) | 8'in silmesi kalıcı olur | "Doktor olan arkadaşım yangın söndürücünün yerini merak ediyor." | "Hastanedeki rutin kontrol randevumuz için acil değil ama annem yerde yatıyor, konuşmuyor" |
| 11 | "sorun yok / olmaz" (PROBLEM_NEGATIONS) | şikâyet → genel | "Sorun yok, teşekkür ederiz." | "Sorun olmaz demiştiniz ama oldu." |
| 12 | Koşullu "sorun olursa?" (soru işaretiyle) | şikâyet → genel | "Bir sorun olursa sizi arayabilir miyiz?" | "Sorun yaşarsak ne yapmalıyız? Su bu sabah hiç gelmedi?" |
| 13 | "şikâyetim yok" (COMPLAINT_NOUN_NEGATIONS) | şikâyet → genel | "Şikayetim yok, çok memnunuz." | "Şikayet etmiyorum ama bu gece çok gürültü oldu." |
| 14 | Koşul eki (CONDITIONAL_TAIL "-sa/-se") | arıza şikâyeti → genel | "Su gelmiyorsa ne yapmalıyız?" | "Kombi yanmıyorsa, bu sabahtan beri böyle." |
| 15 | Belirsiz acil maskesi (övgü / "internet düştü") | yalnız model "hayır" derse | "Daireye bayıldık, harika bir yer!" | bulunamadı ("annem bayıldı" maskelenmiyor) |

Kalıcı çözüm tasarımın A10'u: anlama katmanına `situation` alanı (süren / varsayım / geçmiş / eylem isteği / bilgi), anahtar kapalı, ücretli
ölçümle açılır. Ara dönem: yukarıdaki yanlış gevşetmelerin YALNIZ SIKILAŞTIRAN düzeltmeleri (deyim istisnası, "hâlâ" süreklilik işareti,
"if you ask me" kalıbı, bilinç kaybı / zorla giriş acil ağına) çok ajanlı çekişmeli doğrulamadan geçen ölçüde kodlanır; diğerleri modele kalır.
