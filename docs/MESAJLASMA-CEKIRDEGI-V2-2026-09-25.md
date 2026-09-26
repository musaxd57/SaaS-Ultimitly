# Mesajlaşma çekirdeği v2 — Konuşma Anlama Durumu, Host Karar Motoru, kapanışa sessizlik, bekleme sözü (2026-09-25)

Kurucu talebi (uzun mesaj + ChatGPT ekran görüntüsü, özet):

- **Kapanış:** "Guest yalnızca 'Teşekkürler', 'Tamamdır', '👍', 'Harika', 'Anladım' gibi conversation-closing acknowledgment
  gönderiyorsa ve açıkta cevaplanmamış başka bir soru/istek yoksa AI hiçbir şey göndermesin." İçeride handled /
  no_reply_needed. Son mesaja değil, cevapsız mesajların hepsine bakılır ("Anladım teşekkürler ama 12'de gelebilir miyiz?"
  → işlenir).
- **Host Karar Motoru:** AI her şeyi kendisi doğrular. Politika karar veriyorsa ev sahibi hiç karışmaz. Yalnız
  istisnalar ev sahibine KARAR KARTI olarak gider ([İzin ver] [Reddet] [Farklı saat] [Özel talimat]). HOST APPROVED →
  REVALIDATE → SEND. Bekleyen karar sırasında yeni mesaj gelirse kart güncellenir ya da iptal olur. Tekrarlayan karar
  kural ÖNERİSİ doğurur; sessiz öğrenme yok. Misafir "sorup döneceğim" görmez.
- **Bekleme sırasında ne gider:** "A — tam sessizlik / B — nötr 'Talebiniz alındı'. Ben burada henüz kural koymak
  istemiyorum … Şimdi sabitlemeyelim."
- **Netleştirme** son çaredir: önce bağlamdan çöz; gerekirse olası anlamı öneren TEK soru ("Erken check-in'i mi
  kastediyorsunuz?"); hedef netleştirme oranı < %0,01, eval metriği.
- **Eylem makbuzu** (sabit kural): "AI gerçekleşmemiş bir eylemi gerçekleşmiş gibi söyleyemez." Yön: regex yerine
  claimedActions ↔ doğrulanmış eylem.
- **Konuşma Anlama Durumu:** sistem her mesajı sıfırdan değerlendirmesin. Konuşmanın canlı bir durumu olsun: misafir /
  rezervasyon, mülk, konaklama evresi, açık sorular, açık talepler, bekleyen ev sahibi kararları, en son geçen tarih/saat,
  konuşulan konu, misafirin planları, sonradan yaptığı düzeltmeler, tamamlanan ve açık işler.
- **Ekran görüntüsü:** "10'da havaalanına çıkacağız" bir yere gitmektir, daireden çıkış DEĞİL; "10 demiştim ama 11
  olacak" bir düzeltmedir. "Kelimeye değil cümlenin anlamına bakması."

Bu belge: bu turda kodda ne yapıldı (migration YOK, hepsi kırmızı-önce + mutasyon), üç ajanın araştırma bulguları ve
kurucu onayı isteyen büyük parçalar.

## 1. Bu turda kodda yapılanlar

### 1.1 Kapanışa sessizlik + "cevap gerekmedi" hâli (`ai/closing-turn.ts`, `lib/conversation-attention.ts`)
- **Kanal, sözcük yolu:** cevapsız misafir mesajlarının HEPSİ teşekkür/onay (`isClosingAck`) ise ve misafire daha önce
  bir cevap gittiyse model çağrılmaz, hiçbir şey gönderilmez. İlk mesaj ("İyi akşamlar", "Merhaba") bir selamdır, modele
  gider. Övgü ("Harika bir konaklamaydı!") bu yolda SUSTURULMAZ (inceleme, ↓1.6): nezaket cevabı açıksa o cevabı alır,
  kapalıysa modele gider; yalnız anlam yolu susturabilir. Nezaket cevabı (kullanıcı açarsa) aynen çalışır.
- **Kanal, anlam yolu (`semanticClosingHolds`):** sözcük listesi "Anladım", "Anladım teşekkürler", "Kolay gelsin",
  "Tamam anladım", "Understood" ifadelerini TANIMIYOR (ölçüldü). Listeyi büyütmek yerine şu şartlarla anlam yolu
  kullanılıyor:
  - misafire daha önce bir cevap gitti;
  - cevapsız hiçbir mesajda soru işareti yok, hepsinde bir teşekkür/onay/veda sinyali var ve kelime ağı hiçbirinde bir
    niyet (erken giriş, şikâyet…) görmüyor — bu sözcük kuralları yalnız SIKILAŞTIRIR;
  - anlama katmanı cevapsız mesajların tamamında yalnız `greeting_thanks` gördü ve listesi tavanda (5) değil (tavandaki
    liste kesilmiş olabilir);
  - cevap modeli istemin kapanış kuralına uydu (genel niyet, güven < 0.4), eksik bilgi ve eylem önerisi boş;
  - kapı güven 1 ile baştan koşunca hiçbir engel çıkmadı.

  Son şart **birleşim değişmezidir**: kelime ağının, beyanın ya da anlama katmanının konaklama isteği, risk niyeti,
  injection, çıktı vetosu, saat çelişkisi ve dil hiçbir koşulda susturulamaz. "İlk düşen kontrol düşük güven mi" sorusu
  ölü mantıktı ve kaldırıldı (kapının güvene bağlı kontrolleri yalnız `confidence_invalid` ve `low_confidence`).
- **QR:** teşekküre devir yok, ev sahibine uyarı yok, model ve günlük kota harcanmıyor. Eskiden her teşekkür düşük
  güvenden devrediliyordu: misafir "kaydedildi" metnini alıyor, ev sahibi uyarılıyordu. Kanalla aynı kurallar: önceki
  cevap şart ve son cevaptan sonraki TÜM misafir mesajları kapanış olmalı (yapay zekâ duraklatılmışken yazılmış bir soru
  bir "teşekkürler"in arkasında kaybolmasın).
- **Karar kaydı:** yeni `finalDecision = no_reply` (şema yorumu; migration yok), gerekçe `closing_ack` ya da
  `closing_ack_semantic`.
- **"Cevap gerekmedi" hâli:** konuşmanın durumu değiştirilmiyor, hâl türetiliyor. Koşul: `skippedReason = closing_ack`
  ve damga son mesaja yetişmiş. `answered` yazılsaydı senkron onu `new`e geri çevirirdi; `closed` yazılsaydı misafir
  yeniden yazdığında bile konuşma açılmazdı.
  - Bu hâldeki konuşma şu yerlerde görünmüyor: pano "Bekleyen Mesajlar", açık konuşma sayacı, gelen kutusu "Yeni"
    sekmesi, "Dikkat gerektirenler" ve oto-yanıt önizlemesi.
  - "Tümü" sekmesinde kendi etiketiyle görünüyor. "Sorunlu" asla gizlenmez. Misafir yeniden yazınca hâl kendiliğinden
    düşer.
  - 🚨 **Gizleme yalnız açık iş olmadığı KESİNSE** (`closingMayHide`, inceleme ↓1.6). Gizlenmez:
    - son cevap yapay zekânın devir / şikâyet bekletme cevabıysa;
    - son cevap bir soru ya da tutar/indirim taşıyorsa ("Tamam olur" bir teklif KABULÜDÜR);
    - son ev sahibi mesajından sonra ev sahibine bırakılmış bir misafir mesajı varsa (karar kaydı `human_review`, ya da
      gönderilmiş ama kararı ev sahibine bırakan erteleme; okuma hatası = açık sayılır);
    - sağlayıcının son mesaj damgası karar verilen mesajdan 2 dakikadan fazla ilerideyse (içe alınmamış bir fotoğraf
      mesajı kararın ardından gelmiş olabilir).

    Bu durumlarda misafire yine HİÇBİR ŞEY gitmez ama konuşma görünür kalır (`closing_ack_open`; etiket "Misafir teşekkür
    etti; otomatik cevap gönderilmedi. Açık bir konu varsa yanıtlayın."). Yanlış gizleme gerçek bir işi kaybettirir,
    gereksiz görünürlük ucuzdur.
- **Cevap oranı (Raporlar):** yapay zekânın bilerek cevapsız bıraktığı kapanış mesajı (karar kaydı `no_reply`) cevap
  bekleyen mesaj sayılmaz; önceki cevapsız mesajın saati aynen işler.
- **Önizleme paritesi:** Ayarlar "AI cevabını gör" kartı artık aynı yüklemi kullanıyor. Eskiden övgü için "normal AI
  akışına düşer" yazıyordu ve hiç gönderilmeyecek bir taslak gösteriyordu. Oto-yanıt önizleme penceresinde kapanışlar
  "size bırakılır" listesine girmiyor.
- **Mutasyon:** 35 mutantın 32'si öldürüldü, ardından H3 düzeltmesiyle 15/15. Gerekçesi yazılı eşdeğer mutantlar:
  - K6: kanalda `gateFailure === "blocked"`. Bugün düşük güvende kapıdan sonraki adımlar koşmuyor; koruma, bir adımın
    kararı asla ezilmesin diye duruyor.
  - Q4: QR'da `escalate`. Kapının göndereceği cevap asla susturulmasın diye duruyor.
  - H3 gerçek bir pin eksiğiydi: SQL `<> 'closing_ack'` NULL satırı gerçekten düşürüyor. Damgalı ama gerekçesiz fikstür
    eklendi.

### 1.2 Konuşma Anlama Durumu v1, dilim A — zaman ve evre (`ai/stay-timeline.ts`)
- **Ölçülen kusur:** istemin "Zaman bağlamı" satırı sunucu saatini ham tarih damgasıyla kıyaslıyordu. Yalnız tarih
  saklanan rezervasyonda bu şu hataları üretiyordu:
  - İstanbul'da çıkış sabahı 03:00'ten itibaren model "Konaklama tamamlandı (check-out gerçekleşti)" okuyordu; oysa
    misafir hâlâ dairedeydi.
  - Varıştan önceki akşam "Girişe 0 gün kaldı" yazıyordu.
  - Hiçbir model bugünün tarihini bilmiyordu.
- **Şimdi:**
  - "Bugün" org diliminde hesaplanıyor. Günler `calendarDateOf` ile, gün farkı takvim günü olarak.
  - Evreler: varıştan önce / yarın / bugün / konaklamada / çıkış yarın / çıkış bugün / bitti.
  - İstemde şu satır var: "Bugün: 25.09.2026 Cuma, saat 10:40 (dilim) · Yarın: …" + "göreli gün ifadelerini bu
    tarihlere göre çöz".
  - Giriş ve çıkış gün adıyla yazılıyor.
  - Satır iddia ölçümünün bağlamına da giriyor.
  - Dört yüzey (kanal, gelen kutusu önerisi, Ayarlar testi, QR) org dilimini geçiriyor. QR'da rezervasyon ayrıntısı
    yine yok; bugünün tarihi kişisel veri değil.
- **İnceleme düzeltmeleri (↓1.6):**
  - Onaylanmamış rezervasyon "henüz ONAYLANMADI … onaylı bir konaklama gibi anlatma", iptal planlanan tarihleriyle
    yazılır (evre anlatılmaz). Geçersiz tarih "rezervasyon yok" gibi okunur.
  - 00:00–04:59 arası saat satırı "misafirin 'yarın'ı çoğu zaman BUGÜNÜ kasteder; kesin sonuç gerektiren konuda tek soru"
    ipucunu taşır.
  - Giriş/çıkış günü standart saat geçtiyse "bugün bu saat GEÇTİ" yazılır; bilgi tabanıyla çelişen standart saat bu
    satırda tekrarlanmaz.
  - "Konaklama bitti" kontrolü (`automation.ts`) de takvim günü kuralına geçti: batı dilimlerinde (New York) yalnız
    tarih saklanan çıkış, çıkış günü boyunca "bitti" sayılıyordu (misafir dairedeyken yapay zekâ susuyordu).
  - Komşu rezervasyon satırları (erken giriş / geç çıkış baskısı) aynı gün kuralıyla, gün adıyla yazılır.
- **Mutasyon:** 15/15 (ilk dilim); inceleme dilimi ↓1.6.

### 1.3 Çıkış saati: yolculuk ≠ çıkış, düzeltme = yeni saat
- **İstem:** "bir YERE gitmek çıkış saati DEĞİLDİR" ("10'da havaalanına çıkacağız", "yemeğe çıkıyoruz"). Düzeltmede
  YENİ saat yazılıyor.
- **Kod:** anlamı model çözüyor. `timeCorrectedInMessage` yalnız halüsinasyon durdurucu: kayıtlı eski saat ve yeni saat
  aynı cümlede geçmeli (tam sayı; "110" içinden "11" okunmaz) ve ayrılmayı reddetme vetosu aynen geçerli. Eskiden
  düzeltme reddediliyor, eski saat kayıtlı kalıyordu. İnceleme sonrası (↓1.6) ek şartlar:
  - cümlede bir düzeltme ("demiştim / yerine / değil / instead…") ya da çıkış işareti olmalı;
  - cümlede TAM İKİ saat belirteci olmalı ve eski ile yeni saat FARKLI belirteçlerde okunmalı (tek "10" hem 10:00 hem
    22:00 okunuşuyla iki saati birden karşılayamaz; üç saatli uçuş cümlesi bu yoldan kabul edilmez);
  - sayaç ("2 kişi", "10 tane"), numara ("oda 10") ve tarih ("10/11") saat değildir; "10 pm" yalnız 22:00'dır.
  - "Yazılan saat" yolunda sonraki cümleciğe bakma yalnız ipucu cümleciğinde saat yoksa yapılır.
- Kodun "yolculuk" için ek sözcük kuralı YAZILMADI. Kurucu ilkesi anlamın modelden gelmesi; kayıt da yalnız sıkılaştırır.

### 1.4 Netleştirme politikası (istem)
Sırası şöyle:
1. Önce BAĞLAMDAN çöz: konu, açık istek, evre ve tarih ("Bugün / Zaman bağlamı" satırları), saat.
2. İki anlam gerçekten eşitse EN OLASI anlamı öneren tek soru sor ("Yarınki girişinizi, yani erken check-in'i mi
   kastediyorsunuz?").
3. Genel netleştirme ("Biraz daha açıklar mısınız?") yazılmaz.

"EN FAZLA BİR soru" tavanı aynen kaldı. Oran eval metriği olarak ölçülecek (↓§5).

### 1.5 Bekleme sözü yasağı (kurucu kararı: "Guest hiçbir 'soruyorum/döneceğim' mesajı almayacak")
- **Çıktı vetosu:** bekleme sözleri artık tutuluyor. Önceden "I'll check with the host" BİLEREK geçiyordu; doğrulanmış
  erken giriş akışı buna dayanıyordu. Tutulanlar:
  - TR: soracağım, danışacağım, kontrol edeceğim, "ev sahibiniz teyit edecek / netleştirecek / size bilgi verecek /
    ilgilenecek / onaylayacak / size döner", sorarım; "soruyorum" yalnız ev sahibine soruluyorsa, "kontrol ediyorum /
    bakıyorum" yalnız 1. tekil.
  - EN: I'll check (with the host) / Let me check. / I'll look into it / keep you posted / find out / double-check /
    "your host will review your request and let you know" / "you'll hear back".
  - DE/FR/ES/RU/AR: 1. şahıs gelecek sözü (DE devrik dizim dahil) ve ev sahibi öznesiyle gelecek. Şimdiki zaman olgu
    cümleleri bilerek dışarıda ("Je vous confirme que…").
  - 🚨 Süreç anlatımı söz DEĞİLDİR (inceleme ↓1.6): 09-25 gövdeleri yalnız 1. şahıs ya da EV SAHİBİ öznesiyle söz
    sayılır — "Girişte site güvenliği adınızı soracak", "Temizlik ekibi daireyi kontrol edecek", "Her misafirden önce
    daireyi kontrol ediyoruz", "We will verify your ID at check-in", "The host will check for damages after checkout"
    geçer. Misafire sorulan netleştirme de söz değildir ("Emin olmak için soruyorum: …?", "Let me check if I understood:
    …?", "Je vais vous demander une précision…?", "Уточню: …?").
- **Ölçüm:**
  - İlk sürüm, 1.287 cevaplık derlem: 9 yeni veto, hepsi ev sahibi adına verilen gelecek sözü; biri doğrudan izin
    iddiası ("onaylayacaktır"). Hiçbir önceki veto düşmedi.
  - İnceleme sonrası, 168 cümlelik 6 dilli batarya: yanlış pozitif 23 → 0, kaçan söz 76 → 1 (bilerek kapsam dışı edilgen
    "dönüş yapılacaktır").
  - Derlemde veto 19 → 33: 14 yeninin hepsi ev sahibi adına söz ("ev sahibiniz teyit edecek", "your host will check …
    and confirm"); kaybolan veto 0. 540 gerçek model cevabında yeni tutma 0; koddan kurulan metinler ve 24 örnek cevapta 0.
- **İnsan talebi muafiyeti KALKTI:** muafiyet "ev sahibinize soracağım ve size döneceğim" devir cevabını otomatik
  geçiriyordu. Söz taşıyan devir artık tutulur. Model insan talebini etiketlediyse (`riskType` human_request) ya da anlama
  katmanı insan talebi gördüyse yükseltme yolu ev sahibine ACİL bildirir ("Sorunlu"); devir sessizce ölmez. İstemin devir
  cümlesi zaten olgudur ("Mesajınız kaydedildi; ev sahibiniz görebilir.").
- **Erken giriş akışı:** taslak YALNIZ bu vetoyla tutulduysa doğrulanmış erken giriş akışı yine koşar. Sonuç iki
  durumdan biri:
  - doğrulanmış onay sözün yerine gider;
  - ev sahibi kontrol listesini görür, misafire söz gitmez.

  "Yalnız veto tuttu" demek, veto olmasa kapının geçeceği ya da akışın zaten kabul ettiği bir gerekçeyle tutacağı
  anlamına gelir. Kapı güvenden ya da riskten kapanıyorsa akış yine koşmaz (P2). Bekçi (ağ çağrısı, 20 sn tavan) bu
  durumda yalnız bir katman erken giriş isteği gördüyse çağrılır; başka konuda veto zaten tutar.
- **Kayıtlı ev sahibi metinleri:** kayıtlı erken giriş notu bugünkü vetoya takılırsa kural KAPANMAZ; not düşer ve mülk
  sayfası "Kayıtlı notunuz artık misafire gönderilmiyor … Yeni bir not yazıp kaydedin." der (eskiden kural sessizce
  "kapalı" görünüyordu). Geç çıkış teklif metni kayıtta vetodan geçer ("Teklif metni söz ya da yapılmamış bir işlem
  içeremez …").
- **İstem:**
  - Geç çıkış teklif bloğu artık "ev sahibinin teyit edeceğini belirt" EMRETMİYOR; "onayına bağlı olduğunu belirt" diyor.
  - Açık "BEKLEME SÖZÜ YASAK" maddesi eklendi.
  - Örnek 16'daki "marked as urgent" eylem iddiası çıkarıldı.
  - Örnek 13 başlığındaki "söz verilebilecek tek şey ilgilenildiğidir" çelişkisi düzeltildi. Pin büyük harfli olduğu
    için bunu kaçırıyordu.

### 1.6 İnceleme turu (09-25) — üç ajan, bulgular kodda doğrulandı
Üç inceleme ajanı (kapanış · zaman/yazılan saat · bekleme sözü) turun kodunu düşmanca okudu ve bataryalarla ölçtü. Her
bulgu kodda yeniden üretildi, sonra kırmızı-önce düzeltildi. Üç ayrı commit (her biri tek başına tip denetiminden geçer):
veto `6c7b439` · kapanış `1785250` · zaman `a83459d`.

**Kapanış (P1/P2):**
- Övgü listesi dolgu sözcükleri ("is / are / the / it") yüzünden soru işaretsiz soruyu kabul ediyordu: "is the apartment
  clean", "Can you recommend a great restaurant", "Perfect, we are here" (varış bildirimi). Bunlar susturulup
  gizleniyordu. Övgü sözcük yolundan çıkarıldı; `isPositiveFeedback` soru açan ilk sözcükte (is/are/can/could/recommend…)
  övgü demez, "here" dolgu değil.
- İki modelin uyuşması yetmiyordu: istem aynı "soru yok" hükmünü bilgi tabanının cevaplayamadığı soruya da verdirir,
  anlama katmanı beş istekten sonrasını keser. Sözcüksel itirazlar eklendi (↑1.1).
- Teklif kabulü, devirden sonraki teşekkür ve ev sahibine bırakılmış soru gizleniyordu → `closingMayHide` (↑1.1).
- İlk mesaj selamı ("İyi akşamlar") kapanış sayılıyordu → önceki cevap şartı.
- QR yalnız son mesaja bakıyordu → tüm cevapsız mesajlar.
- Cevap oranı kapanış mesajlarını cevapsız sayıyordu.

**Zaman ve yazılan saat (P2/P3):** ↑1.2 ve ↑1.3. Ölçülen en ağır bulgu: batı dilimlerinde çıkış günü boyunca yapay zekâ
susuyordu (yalnız tarih saklanan çıkış, gün başıyla ham damga kıyası).

**Bekleme sözü (P1/P2):** ↑1.5. Ajansız gövdeler süreç anlatımını tutuyordu (kanalda taslak, QR'da devir); "I'll check."
gibi en yaygın sözler kaçıyordu; insan talebi muafiyeti yasaklanan sözü otomatik geçiriyordu.

**Bilinen sınırlar (bilinçli, pinli ya da belgeli):**
- Edilgen söz ("Size dönüş yapılacaktır") tutulmaz: edilgen çatı olgu cümlesiyle aynı biçimdedir ("Kahvaltı 8'de
  servis edilir"), edilgen dal bu yüzden hiç yok.
- Şablon yedek metinleri (`fallback.ts`) "döneceğim / ilettim" taşıyabilir: bunlar yalnız ev sahibine gösterilen
  taslaktır; kaynak `openai` olmayan cevap kapıdan hiçbir zaman otomatik gitmez.
- Çıkıştan sonra gelen teşekkür kapanış yoluna hiç girmez: "konaklama bitti" kontrolü önce koşar (gerekçe
  `reservation_ended`, misafire yine hiçbir şey gitmez). Konuşma "cevap gerekmedi" diye işaretlenmez.
- Konaklama eval'i (`evals/stay-change.json`) bekçiyi puanlar, vetoyu değil. Veto artık bazı erteleme cevaplarını da
  tutar, bu yüzden eval'in "gereksiz inceleme" sayısı kanalda gerçekten tutulan cevabı birebir göstermez. Birleşim
  tablosu bir sonraki ücretli koşuda veto dahil yeniden okunmalı.
- Bekleme sırasında misafire ne gideceği (A tam sessizlik / B nötr alındı) SABİTLENMEDİ (kurucu). Veto bir cevabı
  tuttuğunda bugünkü davranış: misafire hiçbir şey gitmez, taslak ev sahibine.

**Mutasyon (inceleme dilimi):** `a83459d` üzerinde 90 mutant, ayrık worktree, M0 yeşil → 73 öldürüldü, 17 yaşadı. Yaşayanlar
testin kendisinin kör noktasıydı; her biri için ÖZGÜN örnek yazıldı (`80ef335`):
- `hasOpenHostWork`in beş iç bacağı (pencere, erteleme, doğrulanmış onay muafiyeti, en güçlü karar, okuma hatası)
  entegrasyonda sınanmıyordu → sahte veritabanlı saf birim testi.
- İnsan talebi muafiyetini geri getiren mutant yaşıyordu: testin İngilizce misafir mesajı dil kapısına takılıyordu, yani
  test vetoyu hiç sınamıyordu → Türkçe istek + kapı kanıtı `g.d = reply_output_veto`.
- QR anlam yolunun iki şartı, üç veto freni/dalı, zaman satırının iki kuralı ve yazılan saatin iki kuralı başka şartların
  arkasında kalıyordu → yalnız o kuralın ayırdığı örnekler.
- `replyAuthorOf`taki `systemEventType` denetimi ölü koddu → silindi. Bir mutant (V11) kendisi hatalıydı (tek harf).
Yeniden koşu `80ef335` üzerinde: yaşayan 17 + düzeltilmiş V11 + yeni üç bacak (politika metni muafiyeti, pencereyi
yalnız EV SAHİBİ cevabının kapatması, boş pencere) = 20 mutant, M0 yeşil, **20/20 öldürüldü**.

### 1.7 İkinci inceleme turu (09-25) — üç ajan daha, dört commit
Üç ajan turun kodunu yeniden düşmanca okudu (kapanış · bekleme sözü vetosu · zaman). Her bulgu kodda yeniden üretildi,
kırmızı-önce düzeltildi: kapanış `935b491` · veto `42809cb` · tek tarih kuralı `8227d8d` · yazılan saat `41c6eca`.

**Kapanış (P1×3, P2×3):**
- Yapay zekânın son cevabı soru ya da TEKLİF taşıyorsa ("Yol tarifini de gönderebilirim", "…mı kastediyorsunuz?")
  misafirin "Olur / Evet"i bir CEVAPTIR → kapanış kısayolu kapalı, model cevaplar (`closableAfter`). Ev sahibinin teklifinin
  (soru işaretsiz de) kabulü kapanıştır ama görünür kalır.
- Karşılama / giriş otomasyonundan sonra gelen ilk "İyi akşamlar" bir selamdır: "önceki cevap" = misafir mesajından SONRA
  giden cevap (`hasPriorReply`).
- Karar ertelemesi ya da devir cümlesi taşıyan son cevaptan sonraki teşekkür gizlenmez — niyet etiketi olmasa da (QR bot
  mesajı), konaklama dışı konuda da ("Evcil hayvan kabulü ev sahibinizin kararıdır") — `handsOffToHost`.
- Nezaket cevabı (açıksa) YALNIZ gizleme izinliyken gider; anlam yolu soru ekinde, gizli istek sözcüğünde (ama / lütfen /
  but / please …), rakamda ve 2'den fazla artık sözcükte itiraz eder; övgü cümleciği soru açan sözcükle başlıyorsa övgü
  değildir; ":(" kapanış değildir; QR ikinci kapanışı da tanır; senkron toleransı 5 sn; açık iş penceresi 200 karar kaydı;
  Ayarlar önizlemesi `missingInfo` / `actionSuggestion`u kapıya verir (parite).

**Bekleme sözü vetosu:** bağımsız ajan bataryası (389 cümle, 7 dil) kaçan sözü 131 → 1 (bilinçli: "Teyit ediyorum, giriş
15:00" bir olgu onayıdır), yanlış pozitifi 44 → 13 indirdi. Kalan 13'ün hepsi bu turdan ÖNCE de vardı: ajansız 09-12
gövdeleri ("Uygulama size kodu gönderecek") ve 1. çoğul geniş zaman süreç anlatımı ("Faturayı çıkışta göndeririz") —
güvenli yön, taslak ev sahibine gider. Yeni biçimler: Türkçe istek kipi ("Hemen sorayım", "Bir bakayım"; misafire sorulan
"Size bir şey sorayım: …?" değil), 1. tekil geniş zaman ("kontrol ederim"; "Ben olsam … bakarım" tavsiyesi değil), ekip /
görevli öznesi YALNIZ geri dönüş / onay fiilleriyle ("Ekibimiz size bilgi verecek"; "Görevlimiz bagajlarınızla
ilgilenecek" bir hizmet anlatımıdır), ev sahibinin kararını bildiren geçmiş ("Ev sahibiniz erken girişinizi onayladı",
"Your host has approved…"), İngilizce "I've sent someone / We'll get it fixed / Consider it done / I can ask the host", ve
DE/FR/ES/RU/AR 1. şahıs + ev sahibi öznesi. İki nokta ile açılan duyuru, dil değişikliği bildirimi ("I'll reply in English
from now on"), önceki gerçek mesaja atıf ("As I mentioned", "I've sent you the door code in the previous message") serbest.
Ölçüm: 1.287 gerçek model cevabında yeni veto 1 (gerçek iddia: "Takvime baktım, … müsait"), düşen 0; koddan kurulan 121
metinde (erken giriş onayı/politikası, bekletme, nezaket, few-shot) yeni veto 0. Batarya satırlarının 121/140'ı
kırmızı-önce. Kanal: model insan talebi NİYETİYLE devir yazıp kapı kapandıysa risk etiketi boş olsa da konuşma yükseltilir
(önce misafir hiçbir şey almıyor, ev sahibi de haberdar olmuyordu).

**Tek tarih kuralı (P1, zaman ajanı):** saklanan rezervasyon tarihi "yalnız tarih" (D 00:00Z Hospitable, D 12:00Z iCal
tarih değeri) iken dört yol onu org dilimine çeviriyordu. QR sohbet New York'ta çıkıştan bir gün ÖNCE 11:00'de kapanıyor,
girişten bir gün önce 15:00'te açılıyordu (devir akşamı içeride kalan misafir gelecek konaklamanın sohbetini
sahiplenebiliyordu); çıkış hatırlatması ABD dilimlerinde bir gün önce gidiyor, outbox'taki gönderim anı vetosu çıkış günü
sabahı mesajı iptal ediyordu; aynı gün giriş yapan misafire karşılama / giriş mesajı hiç gitmiyordu (Auckland'da dün
başlamış konaklamaya gidiyordu); gelen kutusu devir blokları çıkış günü boyunca gizleniyordu. Hepsi `calendarDateOf`
(seçim sorgusu üst küme: bugünün iki çapası eklenir, kesin karar bellekte; önizleme gönderici ile aynı kural; "konaklama
bitti mi" tek fonksiyon `stayEndedBefore`). İstanbul davranışı değişmedi. Bilinen sınır (çekirdek yorumu düzeltildi): tam
00:00Z/12:00Z'ye düşen GERÇEK an tarih sanılır — Los Angeles 17:00 PDT, Honolulu 14:00, New York 20:00 EDT girişleri
(yalnız saatli iCal etkinlikleri); ingest'te +1 ms eklemek reddedildi (var olan satırları değiştirip yapay ingest olayı
üretirdi). QR aday ağı da genişledi (`793d87b`): varış ağı "şimdi + 12 sa" idi → UTC+13/+14'te (Auckland yazı,
Kiritimati) giriş saati 12:00–13:00 iken "yalnız tarih" iCal satırı (D 12:00Z) giriş anında ağın dışında kalıyor, sohbet
bir saat geç açılıyordu; ağ 36 sa, kesin karar yine `isOpenNow`. **Açık kalan (ev sahibi yüzeyleri, misafire görünmez):**
pano ("Bugünkü çıkışlar"), Görevler sayfası, İptaller, raporlar, tedarik ve yaşam döngüsü GÖREV oluşturma
(`automation.ts` `todayStart` kapısı: New York'ta bugünün yalnız-tarih girişine "giriş hazırlığı" görevi açılmaz) hâlâ
rezervasyon tarihini org gününün başına kıyaslıyor — İstanbul ve AB dilimlerinde (UTC+0…+3) doğru, ABD / UTC+12 üstünde
ayrı dilim.

**Misafirin yazdığı çıkış saati (P2, `stated-time.ts`):** yanlış kabul rezervasyona YAZILIR ve istem "hatırla, yeniden
sorma" der. Ajan bataryasında (518 mesaj × aday saat) yanlış KABUL 107 → 28, yanlış RED 30 → 11: saat / tarih içindeki
rakam ("11:00'de" içindeki "00", "12.10.2026"), sabah / akşam okunuşu, baştaki sıfır (24 saat), ileri bakış yalnız saatten
ibaret cümleciğe, "için / so / since" cümlecik sınırı, değiştirilen saat ("10'da değil"), giriş etiketi, sayaç / para /
ay adı / sıra sayısı / yaş, düzeltmede yeni saatin kendi cümleciği; kaçan doğru beyanlar (kıvrık kesme işareti, "checking
out", "buçuk" = :30, "öğlen" = 12:00, "11'e kadar", "çıkmaz sokak" ret değil). Kalan yanlış kabullerin hepsi AYNI
cümlecikte başka eylemin saati ("Kahvaltıyı 9'da yapıp 10'da çıkarız", "Our train leaves at 9") — anlamı cevap modeli
çözer, bu yüklem uydurma durdurucu.

**Mutasyon (ikinci inceleme dilimi):** `41c6eca` üzerinde 67 mutant (kapanış 20 · veto 15 · tek tarih kuralı 11 ·
yazılan saat 22 — kısmi kopya: gün kuralını eski `dateKeyInTimeZone` okunuşuna döndüren mutantlar `todayKey(tarih)` ile),
ayrık worktree, M0 yeşil → **63 öldürüldü, 4 yaşadı**. Dördü de testin kör noktasıydı, pinlendi (`bb8ac51`):
- `handsOffToHost` erteleme bacağı — örnekler erteleme ile devir cümlesini BİRLİKTE taşıyordu → yalnız erteleme;
- açık iş penceresi tavanı 200 — testler bir avuç mesajla koşuyordu → 120 ve 250 misafir mesajı;
- Ayarlar önizlemesi kapı girdisine eksik bilgi / eylem önerisi vermezse "cevap gerekmez" diyordu → önizleme paritesi;
- öğle yemeği freni — örnekte "sonra" cümleciği böldüğü için fren hiç sınanmıyordu → aynı cümlecik.
Yeniden koşu `bb8ac51` üzerinde: **4/4 öldürüldü**.

**Son kontrol (ajanlar):** üç bağımsız ajan başlatıldı — veto ve yazılan saat için KÖR batarya (kodu okumadan önce
yazılır), gün kuralı + kapanış için kod incelemesi. Kod inceleme ajanı organizasyonun aylık harcama sınırına takılıp yarıda
kaldı (sınır 30 Eylül'de yenilenir); kontrol listesi elle yürütüldü: kalan ham gün kıyasları tarandı (misafire görünenler
kapandı, ev sahibi yüzeyleri ↑açık listede), QR aday ağı düzeltildi, insan talebi yükseltmesi yalnız kapı cevabı TUTTUĞUNDA
koşar (atomik `problem` claim'i çift e-postayı önler).

**Kör bataryalar (ajan kodu okumadan önce yazdı, sonuçtan sonra ayar yok):**
- *Bekleme sözü vetosu* — 368 cevap, 7 dil: kaçan 51/183, yanlış pozitif 8/185. Kaçanların çoğu DE/FR/ES/RU/AR'da
  (ev sahibi onayı "hat genehmigt / одобрил", ekip sözü "Unser Team wird Sie kontaktieren", "I'm checking with the host
  now", İngilizce dışı teklifler). Bunların HEPSİ canlı sürümde de geçiyordu (gerileme değil); iki yanlış pozitif bu turun
  eklemesiydi (nesnesiz Arapça "سألت", "aşağıya ekledim"). Bu batarya üzerinde hazırlanan yama (kaçan 51 → 15, 12'si
  edilgen; yanlış pozitif 8 → 4, dördü kabul edilmiş sınır; korpus ve koddan kurulan metinde yeni veto 0) ayrı dilimde
  (#162, ↓§1.8) — batarya artık kör değil, yeni kör ölçüm harcama sınırı yenilenince.
- *Yazılan saat* — 477 mesaj: yanlış kabul 92/448, yanlış red 76/347. Bu turun KENDİ eklemelerinden doğan dört yanlış kabul
  ve bir CPU sorunu push'tan ÖNCE kapandı (`7fd861c`, mutasyon 9/9): düzeltme yolunun yeni cümlecik bulucusu boşluk
  dizisinde karesel (20.000 boşluk 0,3 ms → 869 ms; onay yolu zaten ~0,9 sn) → satır içi boşluk tek boşluğa iner, 4.000
  karakter üstünde kanıt aranmaz · "2 buçuk saatte / 10 buçuk euro" · "Çıkmaz sokakta 10'da buluşalım" · "The power will be
  out until 2pm" · "08'de" +12. Kalanlar tur öncesinden (sonraki dilim): ret biçimleri ("çıkamayız", "can't check out"),
  cümle bölücüsünün "a.m./p.m." noktaları, "gece", İngilizce gün dilimi ("tonight at 9"), düzeltme yolunda olay adı
  ("Kahvaltı 10 demiştim ama 9 olsun"), soru cümleciğinden ileri bakış.

### 1.8 Kör veto bataryası dilimi (#162)
Bağımsız ajanın kodu görmeden yazdığı 368 cümle (7 dil) repoda: `tests/helpers/veto-blind-battery-2026-09-25.ts` +
regresyon pini `tests/unit/output-veto-blind-battery.test.ts`. Kaçan 51/183 → **15** (12'si edilgen çatı — bilinçli
kapsam dışı; 3'ü etiketi tartışmalı), yanlış tutma 8/185 → **4** (dördü önceden kabul edilmiş sınır: ajansız gelecek
"Uygulama size kodu gönderecek", 1. çoğul süreç "Faturayı çıkışta göndeririz"). Batarya bu dilimde ayar için kullanıldı,
artık kör değil.
- **Eklenen (yalnız sıkılaştırır):**
  - ev sahibinin kararını bildiren geçmiş, DE/FR/ES/RU/AR (TR/EN vardı);
  - ekip öznesiyle geri dönüş sözü 5 dilde; TR "Ekibimiz konuyla ilgilenecek(tir)", "gerekeni yapacak(tır)", ev sahibine/ekibe
    teklif ("sorabilirim");
  - şimdi yapıyorum: "I'm checking with / asking the host", "estoy consultando", "уточняю", "lassen Sie mich", "laissez-moi";
  - "leave it with me", "I'm on it", "bear with me", "give me a few minutes to check", "would you like me to";
  - teklifler: "kann ich … nachfragen", "je peux", "puedo", "могу", "يمكنني";
  - tamirci / tesisatçı / elektrikçi öznesi.
- **Dar istisnalar:**

  | Geçer (atıf, olgu ya da dürüst sınır) | Tutulur (iddia ya da söz) |
  |---|---|
  | "size (dün) ilettim" | "size dönmesi için ilettim" (amaç cümleciği) |
  | "aşağıya / buraya ekledim" | "notun sonuna / mesaja ekledim" |
  | "Ev sahibinin numarasını size yazdım" | "ekibine yazdım / söyledim / mesaj gönderdim" (alıcı YÖNELME hâlinde) |
  | alışkanlık: "genelde / normalde", "her + zaman ya da durum adı" (tek sabit `HABITUAL_BEFORE`) | "Her şeyi iletirim", "ama bu sefer ben dönerim" |
  | "As we informed you", "I informed you", "We've emailed you" | "I've informed the host" |
  | Arapça "سألت / راسلت" nesnesi ev sahibi değilse; "متأكد" (eminim) | "سألت المضيف" |
  | olumsuz yetki: "No puedo verificar", "Ich kann das nicht klären", "Не могу уточнить", "لا يمكنني", "Je peux pas vérifier" | aynı fiillerin olumlu teklifi |
- **Son gözden geçirme:** harcama sınırı nedeniyle ajan yerine elle yapıldı. Bataryayı geçen ilk yama sürümü, bataryada
  OLMAYAN biçimlerde:
  - 6 gerçek iddiayı geçiriyordu (HEAD bunları tutuyordu — gerileme olurdu);
  - 8 dürüst cümleyi tutuyordu.

  İstisnalar daraltıldı; 30 ikiz cümle ve dal üyesi başına 18 cümle pinli.
- **Ölçüm:** 1.287 gerçek model cevabında yeni tutma 0, düşen 0. Koddan kurulan 121 metinde fark yok. Ayar bataryası değişmedi
  (yanlış tutma 13/220, kaçan 1/169).
- **Mutasyon:** `174edda` üzerinde 67 mutant (her yeni dal, dal üyesi ve istisna), ayrık worktree, M0 yeşil →
  **67/67 öldürüldü**.

### 1.9 Yazılan çıkış saati — kör batarya dilimi (#161b)
Misafirin yazdığı çıkış saati rezervasyona YAZILIR (`guestCheckoutTime`) ve istem "hatırla, yeniden sorma" der. Bu yüzden
yanlış KABUL tehlikelidir, yanlış RED yalnız kaydı atlar. Bağımsız ajanın kodu görmeden yazdığı batarya repoda:
- 477 mesaj × aday saat (TR/EN/DE/FR/ES) + 74 saldırgan sonda: `tests/helpers/stated-time-blind-battery-2026-09-25.ts`;
- regresyon pini: `tests/unit/stated-time-blind-battery.test.ts`.

Batarya bu dilimde ayar için kullanıldı, artık kör değil.

| Ölçüm (tartışmasız etiketler) | Önce | Sonra |
|---|---|---|
| Yanlış kabul | 67 / 407 | **1** |
| Yanlış red | 55 / 318 | **19** |
| Saldırgan sonda yanlışı | 51 / 74 | **2** (ikisi de red) |
| 3.999 karakterde en kötü CPU | ~11 ms | **~9 ms** |

- **Artık beyan sayılmayan cümlecikler:**
  - yapamama ve olumsuz niyet: "10'da çıkamayız", "çıkış yapmayacağız", "çıkmayı düşünmüyoruz", "can't leave",
    "aren't leaving". Mesajın tamamı düşmez; aynı mesajdaki "13'te çıkarız" kalır;
  - soru / istek: "12'de çıkabilir miyiz?", "13.30'da çıksak olur mu?", "Can we check out at 1pm?". Soru işareti
    OLMADAN da biçimden tanınır ("miyiz", "-sAk", "can we"). Soru işaretli cümlenin son cümleciği de sorudur. "11'de
    çıkacağız, olur mu?" beyanı etkilenmez;
  - önceki beyanın aktarımı: "10'da çıkacağımızı yazmıştım". Aynı mesajda yeni saatli beyan yoksa aktarım teyittir.
- **Öğleden sonra okunuşu yalnız 1–7 (13:00–19:59):** "10:30'da çıkış" artık 22:30'u doğrulamıyor.
- **Gün dilimi:**
  - "gece 11" = 23:00, "gece 12" = 00:00;
  - İngilizce sayının önünde ("tonight at 9") ve ardında ("at 11 at night", "tomorrow morning");
  - "akşam üstü", "sabah erken", "7h du soir", "7 Uhr abends";
  - düzeltmede yeni saat eskisinin öğleden sonrasını miras alır ("Akşam 10 dedim ama 9 olacak" = 21:00).
- **Başka işin saati çıkış değil:**
  - başka aracın kalkışı ("Our train leaves at 10", "Trenimiz 10'da gidiyor"); kalıp yalnız 3. tekil fiille çalışır,
    "tren istasyonuna gidiyoruz" ayrılmadır;
  - UZUN YOL aracının kalkış İSMİ ("our departure flight", "the flight's departure", "departure of our train", "départ du
    vol", "vol de départ"). Taksi / transfer isim dalında yok: kapıdan alma saati çoğunlukla misafirin çıktığı saattir
    ("Our departure transfer is at 9" kabul, kontrol satırı pinli);
  - gezi ("plaja gidiyoruz", "head out for dinner", "checked out the old town");
  - nesneli "leave the car", yemeğin saati ("After breakfast at 9");
  - ulaç ("kalkıp", "yapıp"), "diye", "-dığından", şart kipi ("gelecekse") ve DE/FR/ES bağlaçları cümlecik böler.
    "-ınca" bölmez: ölçüldü, bataryada gereksiz, "taksi gelince çıkarız" çıkış saatini taşır.
- **Nötrlenen ifadenin yerine işaret sözcüğü (`OTHER_EVENT_MARK`), boşluk DEĞİL:** boşlukla silinen "train leaves",
  "We leave tomorrow, the train leaves at 10" cümlesinin ikinci cümleciğini "the … at 10" bırakıyordu. İleri bakış bunu
  yalnız-saat cümleciği sanıp tren saatini kabul ediyordu. Aynı açık düzeltme yolunda da vardı: "Checkout was 11, the bus
  leaves at 13" otobüs saatini düzeltme diye kabul ediyordu. Mutasyon turu buldu (aşağıda).
- **Düzeltme yolu:** olay adı ("Kahvaltı 10 demiştim ama 9 olsun", "Giriş 14 değil 15'te") çıkış ipucu yoksa düzeltmeyi
  düşürür; ad, nötrlemeden ÖNCEKİ cümleden okunur. Tarih ("Oct 11", "ayın 11'i", "12'si") saat değildir.
- **Kapsam (yanlış red azaldı):**
  - ASCII yazım ("cikiyoruz") ve ters tırnak ("10`da");
  - "a.m." noktaları, "be out / be gone by", "we're off", "hit the road", "heading to the airport";
  - gece yarısı, "öğleye doğru", "3'e doğru";
  - DE "reisen … ab / checken … aus", FR "partir / quitter / 10h / 11h30" (süre "dans 2h30" hariç), ES "saldremos / a las".
- **CPU:** saat belirtecinin ÖNÜNE bakan her kalıp `$`'a çapalıdır ve birkaç sözcüktür. Metnin tamamı her belirteçte
  baştan taranıyordu (karesel): 4.000 karakterlik "çıkış 1 1 1 …" 33–41 ms. Artık yalnız son 64 karakter (`beforeOf`),
  ~9 ms.
- **Bilinen sınırlar (pinli):**
  - "Sabah erkenden, 6'da çıkıyoruz": gün dilimi virgülün öteki cümleciğinde;
  - çeyrek / "half past" / sözle saat;
  - bitişik "1030";
  - soru ile cevabın ayrı cümlede olması ("Kaçta mı çıkıyoruz? 11'de.");
  - çıplak sayının önünde ipucu yoksa ("Our checkout time is 10.") okunmaz (eski davranış, red).
- **Mutasyon:**
  - `6c9b607` üzerinde 74 mutant → 71 öldü. Yaşayan üçü:
    - I2 ve Q2: soru işaretsiz soru ikizi eksikti, eklendi;
    - O7 (Almanca/Fransızca/İspanyolca araç fiili) ÖLÜ değil ZARARLIYDI: "Wir reisen morgen ab, Zug fährt um 10" satırını
      yeni bir yanlış kabule çeviriyordu. Silindi; işaret sözcüğü sınıfı kapattı.
  - Takip commit'leri üzerinde 33 + 2 mutant: işaret sözcüğü (iki yol), isim dalının her parçası, Q2'nin iki yarısı,
    aşırı uygulama (transfer, "departure time", araçsız "départ du") ve pencere boyu (8/20). Hepsi öldü.
  - Eşdeğer mutant (koşulmadı, gerekçeli): pencereyi TAM önek yapmak sonucu değiştirmez, yalnız CPU'yu artırır.

### 1.10 CI #1170 — kuyruk vade kapısı tek saat
`5d13552`'nin CI'ı `outbox-connection` testinde ("sağlıklı bağlantıda normal teslim") düştü: teslim 0. "Wait for CI"
açık olduğu için Railway o sürümü yayınlamadı.

Kök neden:
- worker'ın claim sorgusu `availableAt <= now` kıyasını JS saatiyle yapar;
- enqueue ise `availableAt`'i şema varsayılanından (`@default(now())`) alıyordu. Bu başka bir saattir ve `timestamp(3)`'e
  YUVARLANIR; JS saati milisaniyeye TABANLANIR;
- aynı milisaniyedeki enqueue + drain satırı "vadesi gelmedi" gösteriyordu.

Düzeltme: `enqueueOutbound` ve `enqueueProactive` `availableAt`'i worker'ın saatiyle yazar (`ENQUEUE_CLOCK`). Belirlenimci
test: JS saati 5 sn geride (yalnız `Date` sahte). Düzeltmesiz iki test kırmızı; mutasyon 3/3.

Canlı etki yok: dayanıklı kuyruk bayrağı kapalı; açık olsaydı en fazla bir tur gecikme.

AYNI SINIF e-posta kuyruğunda da vardı (`EmailOutbox.nextAttemptAt`, bayrak canlıda AÇIK). Etkisi: nadiren bir doğrulama /
şifre sıfırlama e-postası bir poller turu (≤15 sn) gecikir, kaybolmaz. Kimlik e-postası akışı olduğu için kurucu onayına
bırakılmıştı.

**E-posta kuyruğu — DÜZELTİLDİ (kurucu onayı 09-25).** Onayın şartı: "aynı kök neden olduğunu regresyon testiyle doğrula;
mail kaybı, çift gönderim, yeniden deneme ve sürüm davranışı değişmiyorsa tek satırı uygula".
- **Düzeltme:** `enqueueIdentityEmail`'in `create`'inde tek satır: `nextAttemptAt: new Date()`. Kuyruğa satır yazan tek yer
  burası; `nextAttemptAt`'i yalnız bu modül okur. Yeniden deneme (`settleNow + bekleme`) ve kurtarma (`now`) zaten JS
  saatiyle yazıyordu; dokunulmadı.
- **Kök neden aynı, kanıtı** (`tests/integration/email-outbox-enqueue-clock.test.ts`, JS saati 5 sn geride):
  - düzeltmesiz satırın vadesi JS saatinin **~5,06 sn ilerisinde** damgalandı, yani şema varsayılanının saatiyle;
  - enqueue'dan hemen sonra koşan drain hiçbir şey almadı (`claimed: 0`);
  - düzeltmesiz 5 test kırmızıydı; süre dolumu kontrolü iki durumda da yeşil (beklenen).
- **Davranış değişmedi, aynı sahte saat altında:**
  - iki paralel drain → tek gönderim;
  - hata → 1 dk bekleme, hemen koşan drain yeniden göndermez, süre dolunca gönderir; sır korunur (kayıp yok);
  - yeni istek eski nesli iptal eder, yalnız yeni kod bir kez gider;
  - süresi dolan sır gitmez.
- **Mevcut kuyruk ve rota testleri** değişmeden yeşil: 8 dosya, 101 test. Kapsananlar: çift gönderim, SKIP LOCKED, parti
  ortasında kurtarma, lease yenileme, deneme bütçesi, süre dolumu, sürüm, alıcı/AAD, saklama.
- **Mutasyon 3/3** (commit `f2f5e64`): satırı geri al, geleceğe damga, epoch damga.

### 1.11 Ev sahibi yüzeylerinde tek tarih kuralı — dilim 166a (09-26)
İkinci inceleme misafire görünen gün kıyaslarını `calendarDateOf`'a taşımış, ev sahibi yüzeylerini "AÇIK" bırakmıştı. Bunlar
saklı tarihi ham `>= org gün başı` ile kıyaslıyordu. İstanbul'da (ve UTC ile +12 arasındaki her dilimde) bu doğrudur; ama:
- **New York'ta** bugünün 00:00Z çapası gün başından (04:00Z) küçük kalır, yarının 00:00Z çapası ise bugünün penceresine
  girer. Sonuç:
  - aynı gün yapılan rezervasyona giriş hazırlığı görevi, bugün çıkana temizlik görevi AÇILMIYORDU;
  - "Eksik görevleri oluştur" düğmesi görünmüyordu;
  - pano ve günlük rapor bugünün girişi yerine YARININKİNİ listeliyordu (kırmızı koşuda ölçüldü: `['Yarin Gelen']`).
- **Auckland'da** dünün 12:00Z çapası gün başına eşit düşer ve "bugün" sayılıyordu (geçmiş girişe hazırlık görevi).

Düzeltme:
- `onOrAfterToday` (bellekte, `calendarDateOf`).
- `lib/day-where.ts`: sayım ve listeler için KESİN takvim günü aralığı `where`'i:
  - tanım: kenar günlerin çapaları ∨ (yerel pencere ∧ komşu günlerin çapaları değil);
  - gerekçe: ofset −12..+14 sa içinde iç günlerin çapaları hep penceredeyse, dışarıda kalabilen yalnız kenar günlerin, içeri
    sızabilen yalnız komşu günlerin çapalarıdır.
- Kullanan yüzeyler:
  - `createReservationTasks`;
  - Görevler sayfasındaki eksik temizlik sayısı (`reservationsMissingCleaningWhere`);
  - pano bugünkü giriş / çıkış / görev listeleri;
  - `getOpsStats` bugünkü giriş / çıkış;
  - `api/reports/daily` listeleri. Bu rota kartlarla AYNI küme olmak zorunda; `date` sözleşmesi (org gece yarısı) değişmedi.
- Vadesiz görev hiçbir aralığa girmez, sınırsız aralığa da (`dueAt: { not: null }`).

Kanıt (`tests/integration/host-day-rule.test.ts`, `day-where-exact.test.ts`):
- **Kırmızı-önce:** eski kodda işaretli 7 test düştü (New York ×5, Auckland ×2). İstanbul testleri, eski kodda da yeşil olan
  değişmez ("düğmedeki sayı = açılan temizlik görevi", 7 dilim) ve B dosyası geçti.
- **Veritabanı ızgarası:** 11 dilim (+14 … −12, yarım saatlik ofsetler ve üç DST günü dahil) × 4–6 "şimdi" anı × 5 aralık
  biçimi (bugün / bugün ve sonrası / geçmiş / yedi gün / ters) × üç alan (giriş / çıkış / vade). ~2.100 değer: yarım saat
  adımları, çapalar ve her dilimin yerel gece yarısı ±1 ms. Sorgu ile bellekteki karar HER hücrede aynı kümeyi seçti.
- **İstanbul, UTC, Berlin, Kolkata, Tokyo'da** yeni karar eskisiyle BİREBİR (her "şimdi"nin ±3 günü). New York'ta tek fark
  bugünün 00:00Z çapası, Auckland'da tek fark dünün 12:00Z çapası.
- **İlgili 22 test dosyası yeşil** (272 test).
- **Mutasyon 25/25 öldürüldü** (commit `427b9d2`, worktree koşucusu, M0 yeşil):
  - eski kurala dönüş (giriş / çıkış);
  - `>=` → `>`;
  - kenar çapaları ve komşu hariç tutmanın her biri ayrı ayrı düşürüldü;
  - ters aralık koruması;
  - çapanın 00:00Z / 12:00Z yarısı;
  - pencere uçlarında ±1 ms;
  - iki uç boşken dönüş (rezervasyon / görev);
  - eksik temizlik süzgecinin iki koşulu;
  - sayfanın org dilimi yerine UTC kullanması;
  - pano ve günlük rapor listelerinin süzgeci ya da alanı;
  - `date` sözleşmesi.

**167a — pano "Bugünkü Görevler" saati (09-26, commit `4a6f6e0`):**
- Sorun: pano her vadenin SAATİNİ org diliminde basıyordu. Yaşam döngüsü görevinin vadesi rezervasyon TARİHİ olduğu için
  İstanbul'da her Hospitable çıkış temizliği "· 03:00", iCal olanlar "· 15:00" görünüyordu (gece üçte temizlik gibi).
- Düzeltme: `taskDueTimeLabel` — yalnız-tarih çapası → saat yok, gerçek an → org saati.
- Kanıt: kırmızı-önce (eski kodda "· 03:00" göründü); mutasyon 3/3.

**167b — ONAY BEKLİYOR (e-posta şablonuna dokunuyor):** elle girilen görev vadesinin saati tutarsız.
- Form `datetime-local` gönderir; sunucu (`z.coerce.date()`) bunu SUNUCU saatinde (Railway = UTC) okur.
- Sonuç, İstanbul'daki ev sahibi 10:00 girdiğinde:
  - pano 13:00 gösterir;
  - görev atama e-postası `toLocaleDateString("tr-TR")` ile dilimsiz, yani UTC biçimler ve tesadüfen 10:00 gösterir;
  - 21:00–23:59 arası girilen vade kartta ertesi güne düşer.
- Doğrusu: form saati org diliminde okunur (`zonedWallClockToUtc`), e-posta org diliminde biçimlenir ve çapada saat
  göstermez.
- Neden onay: e-posta içeriği değişir. Ayrıca eski satırların e-postada gösterilen saati kayar; yeniden atanan eski görevde
  +3 sa görünür.

**166b-1 — takvim ve görev kartı (09-26, commit `0bb5f50`):**
- Sorun: takvim sayfası rezervasyon gününü, görev kartı vade gününü ham "an → yerel gün" ile buluyordu (`toLocaleDateString`,
  `formatDayInTz`, `daysUntilDate`). New York'ta her Hospitable girişi takvimde bir gün erken görünüyordu; yaşam döngüsü
  görevi de kartta "dün" çıkıyordu. Görev kartı üç yeri besliyor: etiket, "Bugün / Bu hafta" süzgeci ve WhatsApp temizlik
  listesi.
- Düzeltme: ikisi de `calendarDateOf`. "Bugün" org gününe göre (`todayKey`), gün farkı `nightsBetween`.
- Kanıt:
  - kırmızı-önce: eski kodda 3 test düştü (New York takvim, New York kart, Auckland kart);
  - İstanbul eşdeğerliği pinli: çapa, gece yarısı sınırı ve gerçek an;
  - ilgili 12 dosya yeşil (92 test);
  - mutasyon 6/6.

Açık (166b-2, misafire görünmez; TR/AB'de doğru):
- doluluk ve tahmin — gece semantiği: "giriş ≤ bugün ∧ çıkış ≥ yarın", iki aralıkla kesin ifade edilir;
- İptaller sayfasının gün / hafta / ay pencereleri;
- rapor görev penceresi (ay başı … dün);
- tedarik ufku;
- aylık rapor doluluğu (`dayKeyTz`).

## 2. Konuşma Anlama Durumu (CUS) — hedef ve yol

### 2.1 Bugün ne var (ajan envanteri, 09-25)
| Öğe | Kim görüyor | Eksik |
|---|---|---|
| `conversationState.isFirstOperatorReply` | cevap istemi (kanal, QR) | teslim edilmiş cevabı değil giden satırı sayıyor; gelen kutusu önerisi ve Ayarlar testi hiç almıyor |
| Rezervasyon tarihleri + evre | cevap istemi | ✅ artık org diliminde, takvim günüyle (§1.2); anlama katmanı ve bekçi tarih GÖRMÜYOR |
| Komşu rezervasyon (devir) | cevap istemi (kanal, öneri) | QR, anlama, bekçi |
| Misafirin beyan ettiği çıkış saati | cevap istemi | tek alan, üzerine yazılıyor; düzeltme zinciri yok |
| Açık konular (`openTopics`) | yalnız QR | kelime tabanlı, pencere dışı |
| Karar kaydı (`RiskEvent` + `sc/u/ir/ec/g`) | raporlar, yeniden değerlendirme | hiçbir istem |
| Anlama katmanı çıktısı | retrieval, kapı, erken giriş | cevap modeli (paralel koşuyor) |

### 2.2 v1 dilim B — YAPILDI, bayrak `AI_CONVERSATION_STATE_ENABLED` varsayılan KAPALI
Kalıcı kaynaklardan kodla kurulur ve cevap modeli çağrısından ÖNCE hazırdır. PII yok, metin yok.
- **Kod:**
  - saf kurucu `ai/conversation-state.ts`;
  - yükleyici `ai/conversation-state-loader.ts`: kiracı kapsamlı; bayrak kapalıyken SIFIR sorgu; hata olursa durum yok.
- **Bağlı yüzeyler:** kanal oto-yanıtı, gelen kutusu "AI öner", QR.
- **Blok:** istemde geçmişin ardında "KONUŞMA KAYITLARI". Söylenecek bir şey yoksa yazılmaz. Bayrak kapalıyken istem bayt
  bayt aynı (pinli).
- **Sohbet evresi:**
  - misafire giden mesaj sayısı (sistem olayı ve gövdesiz satır hariç);
  - bunların ev sahibinin kendisinin yazdığı kısmı;
  - son giden mesajdan sonraki misafir mesajı sayısı.
- **Açık kayıtlar (en fazla 5, son 10 misafir mesajının karar kayıtlarından):** `pending_host` · `deferred_to_host` ·
  `host_replied` · `code_approved`.
  - Kayıt yoksa o mesaj hakkında HİÇBİR ŞEY söylenmez ("bilinmiyor" ≠ "istek yok").
  - Konu adı yalnız model / kod kaynaklı kapalı-küme kodlardan gelir; kelime ağının uyarısı konu adı olmaz.
  - İstem, konu adlarının ETİKET olduğunu, olgu olmadığını söyler.
- **Gönderilen yaşam döngüsü mesajları:** karşılama / giriş / çıkış (rezervasyonun damgaları, kiracı kapsamlı).
- **Kurallar (mekanik pin `conversation-state-prompt.test.ts`):**
  - durum modülünü YALNIZ istem, tip ve yükleyici içe aktarır; hiçbir kapı okumaz;
  - yükleyiciyi YALNIZ üç cevap yüzeyi çağırır.
- **Ayrı commit — selam tekrarı paritesi (bayraksız):** gelen kutusu "AI öner" `isFirstOperatorReply` vermiyordu, taslak
  devam eden konuşmada da yeniden selamlıyordu. Kural artık üç yüzeyde tek kaynak: `countPriorOperatorReplies`.
- **Mutasyon:**
  - selam paritesi 8/8 (konuşma kapsamı dahil);
  - dilim B 31 mutant → 28 öldü. Yaşayan üçü eksik ikizdi, eklendi → **31/31**:
    - CB20: kapsayan geçiş (test aynı konuyu kullanıyordu, yeni karar eskinin üstüne yazıyordu);
    - CB22: aynı konu en yeni konumuna taşınır;
    - CB28: sistem işareti yazar alanından bağımsız elenir.
  - Eşdeğer (koşulmadı, gerekçeli): yükleyicinin karar penceresi dilimi (kurucu zaten pencereler) ve bekleyen mesaj
    kimliğinin sorgudan elenmesi (o kimlikle kayıt olamaz).
- **Anlama katmanına tarih satırı — YAPILDI (aynı bayrak, commit `d743170` + `d9acd61`):**
  - Anlama katmanı "yarın 11'de" gibi ifadenin konaklamadaki yerini ancak bugünü ve rezervasyonun GÜNLERİNİ bilerek okur.
    Bu yüzden katmanın girdisine koddan kurulan İngilizce bir satır eklendi (`stay-timeline.ts understandingDateLine`).
  - Satırın içeriği:
    - bugün ve yarın (org dilimi, tek tarih kuralı);
    - rezervasyonun giriş ve çıkış günleri; iptal ya da onaysız rezervasyon işaretli;
    - gece yarısından sonra "yarın = bugün" ipucu.
  - YALNIZ GÜN hassasiyeti: dakika yazılmaz, satır önbellek anahtarına girer ve gün içinde sabit kalır.
  - Tek karar noktası `retrieveKbForPrompt`. Bayrak kapalıyken satır hesaplanmaz, alan gitmez. Anlama katmanı canlıda açık
    ve mühürlü eval'le ölçülmüş olduğundan girdisi ve önbellek anahtarı bayt bayt aynı kalır (pinli).
  - Dört yüzey tarih bağlamını verir:
    - QR rezervasyon ayrıntısını bilinçli vermez (yalnız bugün/yarın; "rezervasyon yok" DENMEZ);
    - Ayarlar testi cevap modeliyle aynı örnek konaklamayı kullanır.
  - Geçersiz dilim varsayılan dilime düşer.
  - İzolasyon pini `kb-retrieve.ts`'i bilinçli ekler; kapı değildir, yalnız bayrağı okur.
  - Kanıt: yeni testler eski kodda kırmızı; mutasyon 13/13 (yaşayan DL4, UTC/İstanbul gün farkı ikiziyle kapandı).
  - 🚨 Bayrak açılınca anlama katmanının girdisi değişir. Açma sırası kör eval + eşli koşu; stay-change eval'i de yeniden
    koşulur (katman canlıda ölçülmüş yapılandırmayla açık).
- **Açma sırası:**
  1. Kör set `evals/conversation-state.json`: "yarın erken" varıştan önce, çıkıştan önce ve rezervasyonsuz; düzeltme;
     yolculuk; kapanış. Ajanla yazılacak; harcama sınırı nedeniyle 30 Eylül sonrası.
  2. Bayrak kapalı/açık eşleştirilmiş koşu.
  3. Kurucu onayı.

### 2.3 v2 — kalıcı konuşma defteri (MIGRATION → taze pg_dump + açık onay)
- **Tablo:** `ConversationItem`.
- **Alanlar:** `organizationId`, `conversationId`, `reservationId`, `sourceMessageId`, `kind` (request / question / plan /
  decision), `topic`, `status` (open / pending_host / answered / superseded / cancelled / done), `version` (CAS),
  `dayKey`, `hhmm`, `basis`, `supersededById`, `writer`.
- **Anahtar:** `(org, sourceMessageId, kind, topic)` tekil.
- **Kim yazar:** model DOĞRUDAN yazmaz.
  - `open`: kod, anlama katmanının doğrulanmış çıkarımından. Saat misafirin metninde geçmeli; gün kodda çözülür.
  - `pending_host`: kapı sonucu.
  - `answered`: teslim kancası.
  - `superseded`: aynı konuda yeni gün/saat geldiğinde. Düzeltme zinciri böyle tutulur.
  - `done`: makbuz (doğrulanmış onay gitti, görev bitti).
  - `decision` / `cancelled`: yalnız ev sahibi eylemi. Modelin "istek yok"u hiçbir kaydı kapatmaz.
- **KVKK:** misafir metni tutulmaz ama satırlar misafir mesajından türer. Bu yüzden:
  - `DATA_RETENTION_MONTHS` sonrası silinir (misafir kaynaklı sinyaller gibi);
  - kişinin silinme talebinde silinir;
  - dedupe aracının taşıma listesine girer;
  - dışa aktarım ve PII kanarya kararı yazılır.

## 3. Host Karar Motoru — tasarım (UYGULANMADI; migration + metin + e-posta onayı ister)

### 3.1 Bugün (ajan, kod satırlarıyla doğrulandı)
- **Erken giriş çekirdeği:** dört durum var (`approvable · pending · needs_host · not_early`), otomatik RED yok.
  Kendiliğinden gönderdiği tek şey, kural `auto` iken iki modelin aynı saati okuduğu, tek konulu mesaj.
- **Ev sahibinin gördüğü:**
  - "AI emin olamadı" bandı.
  - "AI cevap öner"e basınca kontrol listesi ve hazır cevap. Bu, modeli yeniden çağırıyor ve kota yakıyor.
  - "Bu cevabı kullan" yalnız yazma kutusuna kopyalıyor.
  - **Onay/red düğmesi YOK.**
  - `/reply` rotası ev sahibi adına gönderiyor ama hiçbir olguyu YENİDEN DOĞRULAMIYOR. 09:00'da hazırlanan taslak
    14:00'te değişmeden gidebilir (TOCTOU).
- **Geç çıkış:**
  - Doğrulama yok.
  - Tek ayar org genelindeki serbest metin teklif.
  - Verilen istisnalar hiçbir yerde yapısal kaydedilmiyor. Onaylanan geç çıkış sonraki misafirin erken giriş
    kontrolünde görünmez; tersi de geçerli.

### 3.2 Hedef akış
1. Misafir isteği gelir.
2. AI doğrular: rezervasyon, gün (yarın gerçekten çıkış mı), sonraki rezervasyon, temizlik, kural, ücret.
3. Politika karar verebiliyorsa kodla kurulan doğrulanmış metin gider (bugünkü erken giriş gibi).
4. Veremiyorsa **karar kartı** açılır: istek, AI'nin doğruladıkları, düğmeler.
5. Ev sahibi tıklar.
6. **Yeniden doğrulama:**
   - Kart CAS ile kilitlenir.
   - İstekten sonra misafir yazdıysa işlem durur.
   - Olgular yeniden yüklenip ev sahibinin gördüğüyle kıyaslanır. Kesin durdurma sebepleri: rezervasyon iptal, gün
     ya da saat geçmiş, yeni çakışma. Başka bir önemli değişiklik varsa 409 ve tazelenmiş kart döner.
7. Kodla kurulan metin (6 dil) gider. İdempotent anahtar kart + sürüm; yazar ev sahibi; `aiAssisted`.
8. Kart `sent`e geçer, görev notu ve denetim kaydı yazılır.

### 3.3 Veri modeli (öneri — MIGRATION)
- **Tablo:** `DecisionRequest`.
- **Alanlar:** `organizationId`, `propertyId`, `conversationId`, `reservationId`, `kind` (early_checkin / late_checkout),
  `status`, `version`, `supersedesId`, `requestMessageId`, `requestedTime`, `dayKey`, `failedCodes`, `factsJson`
  (yalnız saat/sayı/kimlik), `factsHash`, `ruleHash`, `lang`, `resolution` (approve / reject / counter / custom),
  `decidedTime`, `decidedById`, `decidedAt`, `resultMessageId`, `notifiedAt`.
- **Durumlar:** pending · deciding · sent · send_unverified · superseded · cancelled · expired · answered_manually ·
  resolved_by_policy.
- **Neden yeni tablo:**
  - Migration'sız seçenek sağlam değil. `RiskEvent` tekillik anahtarı ikinci, insan kararını kaydedemiyor.
  - `AuditLog`un durumu ve tekil anahtarı yok.
  - Gönderim talebi yalnız 120 sn karşılıklı dışlama sağlıyor.

### 3.4 Karar gecikirse misafire ne gider — SABİTLENMEDİ (kurucu: "Şimdi sabitlemeyelim")
- Tek yapılandırma noktası önerisi: `decisions/ack-policy.ts` → `silence | neutral_ack`. İleride aciliyet/SLA girdisi
  eklenebilir.
- Bugünkü davranış aynen kalır:
  - kanalda tutulan taslak = tam sessizlik (A);
  - QR'da olgu cümlesi "Mesajınız kaydedildi; ev sahibiniz görebilir." (B'ye yakın).
- "Söz" hiçbir seçenekte yok (§1.5).

### 3.5 Güncelleme / iptal / kural önerisi
- **Kart bekliyorken yeni misafir mesajı:** oto-yanıt turu akışı yeniden koşar.
  - Aynı tür, yeni saat → v1 `superseded`, v2 kartı açılır.
  - "Boş verin, 15'te geliriz" → standart saatte `not_early` → `cancelled`.
  - İlgisiz mesaj → kartta "misafir yeniden yazdı" görünür; eski düğmeler yeniden onaya kadar çalışmaz.
- **Kural önerisi:** aynı mülk, tür ve koşulda son 8 karar onaysa kart "kural oluşturalım mı?" diye sorar. Kabul edilirse
  önceden doldurulmuş form açılır ve kural taslak kipte kaydedilir. **Sessiz öğrenme yok.**

### 3.6 Onay gereken kararlar
1. `DecisionRequest` migration'ı (taze pg_dump + açık "push et").
2. Onay / red / farklı saat metinleri (6 dil).
3. Yeni e-posta türü; ilk canlı denemeler birlikte yapılır.
4. Bu gönderimlerin "ev sahibi yazdı + aiAssisted" sayılması; raporlar etkilenir.
5. Bekleme sırasında A/B (§3.4).
6. Otomatik geç çıkış onayı ve özel talimatın otomatik gönderimi. İkisi de v1 DIŞINDA, eval ister.

## 4. Eylem makbuzu — `claimedActions` (YAPILDI 09-25, bayrak `AI_ACTION_CLAIMS_ENABLED` varsayılan KAPALI)

### 4.0 Uygulama (09-25)
- **Kod:** saf modül `ai/action-claims.ts`:
  - kapalı küme `CLAIMED_ACTION_KINDS`;
  - katı ayrıştırıcı `parseClaimedActions`;
  - kapı yüklemi `actionClaimHold`;
  - kanıt `actionClaimEvidence` / `cleanActionClaimEvidence`;
  - istem bloğu `ACTION_CLAIMS_PROMPT_BLOCK`.
- **Bayrak tek yerde okunur:** `suggestReply`.
  - Açıksa: kullanıcı isteminin GÖREV çerçevesine alan tanımı girer ve cevap katı çözülür.
  - Kapalıysa: istem bayt bayt aynı (blok boş dize). Model alanı gönderse bile sonuçta alan YOK, kapı görmez (pinli).
  - Sistem istemine konmadı: önbellekli önek bayraktan bağımsız.
- **Katı çözüm:**
  - alan yok / dizi değil / metin olmayan öğe → `unknown`;
  - kümede olmayan kod → `other` (yine eylem);
  - tekrar tekilleşir.
- **Kapı (kanal + QR + Ayarlar önizlemesi + demo aynı yüklem):**
  - boş olmayan beyan → `action_claim`; `unknown` → `action_claim_undeclared`; boş liste geçer;
  - alan yoksa (bayrak kapalı, şablon, koddan kurulan metin) kural koşmaz;
  - yer: kelime tabanlı çıktı vetosunun HEMEN ARDINDA. İkisi de tutarsa gerekçe bugünküyle aynı (`reply_output_veto` /
    QR `unverified_commitment`); yeni gerekçe yalnız kelime ağının kaçırdığını gösterir. Güvenlik kontrolleri (risk,
    niyet, enjeksiyon) önde, güven arkada.
- **Erken giriş akışı ölmez:**
  - teşhis kipi (`skipOutputVetoForDiagnosis`) çıktı vetosuyla BİRLİKTE beyan kontrolünü de atlar;
  - akış, beyanın tuttuğu taslakta da koşar ve modelin metnini koddan kurulan metinle değiştirir;
  - koddan kurulan metin (`verifiedEarlyCheckinResult`) beyanı `[]` yapar. Bayrak kapalıyken alan eklenmez.
- **Yükseltme:** insan talebinde beyan yüzünden tutulan devir cevabı sessiz kalmaz. Mevcut yükseltme yolu (niyete bakar,
  gerekçeye değil) Sorunlu + acil + ev sahibine e-posta yapar.
- **Kayıt ve rapor:**
  - `RiskEvent.reason` iki yeni kod (REASONS + QR `ESCALATION_REASONS` paritesi);
  - kanıtta `g.ma` (kodlar ya da `["unknown"]`, metin yok);
  - raporlarda "Yapılmamış bir işten söz ediyordu — size bırakıldı" satırı.
- **Ölçüm düzeneği hazır:** `tests/eval/model-reply-compare.eval.test.ts`.
  - Bayrak açık koşuda kapıya beyanı verir.
  - Üç açma sayısını raporlar: `unknown` oranı · cevabı KB'de olan soruda beyan yüzünden gitmeyen · kod dağılımı.
  - Rapor başlığı bayrağın durumunu yazar.
- **Kanıt (commit `ecc3dfc`):**
  - yeni entegrasyon testleri eski kodda 7 kırmızı (kontroller yeşil);
  - 5 dosyada 126 test yeşil;
  - mutasyon 27/27. Kapsam: ayrıştırıcının her dalı, kapı / QR / önizleme / demo paritesi, teşhis atlaması, koddan kurulan
    metnin `[]`'i, bayrak kapalıyken alanın yokluğu, gerekçe listeleri, kanıt temizleyicisi, rapor sorgusu.
- **Açma sırası:**
  1. Cevap kıyası eval'i bayrak AÇIK (~1–3 $, kurucu onayı).
  2. `unknown` ≈ 0 ve bilgi sorusunda gereksiz tutma kabul edilebilir.
  3. Kurucu onayı → canlıda bayrak.
  - Bayrak açık kalırken insan talebi devir cevaplarının beyan yüzünden tutulma oranı raporda izlenir (tasarım gereği
    yükseltilir).

### 4.1 Tasarım (ilk hâli)
- **Alan:** cevap JSON'una yeni `claimedActions` alanı.
- **Kapalı küme:** `forwarded_to_host · notified_team · contacted_third_party · booked_or_reserved · scheduled ·
  created_task · updated_reservation · granted_exception · checked_availability · arranged_service · payment_action ·
  will_follow_up · other`.
- **Katı ayrıştırma:** eksik ya da geçersiz → `unknown`; tanınmayan eylem → `other`, yani yine eylem.
- **Kapı:** boş olmayan liste → `action_claim`; `unknown` → `action_claim_undeclared`. Hiçbir aracımız yok, yani
  makbuz da yok. Doğrulanmış erken giriş metni `[]` taşır.
- **Neden bayraklı ve ölçüm önce:**
  - Cevap çağrısı `json_object` kipinde, katı şema değil. Model alanı bazen atlarsa `unknown` her cevabı tutar ve
    otomatik yanıt çöker.
  - 24 örneğin hepsine alanı eklemek istem değişikliğidir.
  - Önce cevap kıyası eval'i (~1–3 $) ile `unknown` oranı ve yanlış etiket ölçülmeli, sonra kurucu onayıyla açılmalı.
- Bu turdaki regex genişletmesi (§1.5) aynı kuralın deterministik YEDEĞİ. `claimedActions` açılınca ikisi birleşimle
  çalışır; hiçbirinin "yok"u diğerinin "var"ını silemez.

## 5. Eval metrikleri (eklenecek; ücretli koşu = kurucu onayı)
- Netleştirme oranı (hedef < %0,01) ve genel netleştirme sayısı. Genel netleştirme 0 olmalı.
- Kapanış: gereksiz cevap oranı; yanlış susturma (gerçek soru susturuldu) 0 olmalı.
- Bekleme sözü: misafire giden "soracağım/döneceğim" 0 olmalı.
- Zaman: "yarın erken" doğru anlam oranı (varış yarın / çıkış yarın / rezervasyon yok).
- Çıkış saati: yolculuk yanlış kaydı 0; düzeltme kabulü.
