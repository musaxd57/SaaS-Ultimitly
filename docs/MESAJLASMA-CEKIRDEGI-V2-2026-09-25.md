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
- **Kanal, sözcük yolu:** cevapsız misafir mesajlarının HEPSİ teşekkür/onay/övgü ise model çağrılmaz, hiçbir şey
  gönderilmez. Artık övgü ("Harika bir konaklamaydı!") ve önceki cevabı olmayan teşekkür de bu yolda. Eskiden ikisi de
  modele gidiyordu ve modelin cevabı otomatik gidebiliyordu. Nezaket cevabı (kullanıcı açarsa) aynen çalışır.
- **Kanal, anlam yolu (`semanticClosingHolds`):** sözcük listesi "Anladım", "Anladım teşekkürler", "Kolay gelsin",
  "Tamam anladım", "Understood" ifadelerini TANIMIYOR (ölçüldü). Listeyi büyütmek yerine şu şartlarla anlam yolu
  kullanılıyor:
  - anlama katmanı cevapsız mesajların tamamında yalnız `greeting_thanks` gördü;
  - cevap modeli istemin kapanış kuralına uydu (genel niyet, güven < 0.4);
  - kapı güven 1 ile baştan koşunca hiçbir engel çıkmadı.

  Son şart **birleşim değişmezidir**: kelime ağının, beyanın ya da anlama katmanının konaklama isteği, risk niyeti,
  injection, çıktı vetosu, saat çelişkisi ve dil hiçbir koşulda susturulamaz. "İlk düşen kontrol düşük güven mi" sorusu
  ölü mantıktı ve kaldırıldı (kapının güvene bağlı kontrolleri yalnız `confidence_invalid` ve `low_confidence`).
- **QR:** teşekküre devir yok, ev sahibine uyarı yok, model ve günlük kota harcanmıyor. Eskiden her teşekkür düşük
  güvenden devrediliyordu: misafir "kaydedildi" metnini alıyor, ev sahibi uyarılıyordu.
- **Karar kaydı:** yeni `finalDecision = no_reply` (şema yorumu; migration yok), gerekçe `closing_ack` ya da
  `closing_ack_semantic`.
- **"Cevap gerekmedi" hâli:** konuşmanın durumu değiştirilmiyor, hâl türetiliyor. Koşul: `skippedReason = closing_ack`
  ve damga son mesaja yetişmiş. `answered` yazılsaydı senkron onu `new`e geri çevirirdi; `closed` yazılsaydı misafir
  yeniden yazdığında bile konuşma açılmazdı.
  - Bu hâldeki konuşma şu yerlerde görünmüyor: pano "Bekleyen Mesajlar", açık konuşma sayacı, gelen kutusu "Yeni"
    sekmesi, "Dikkat gerektirenler" ve oto-yanıt önizlemesi.
  - "Tümü" sekmesinde kendi etiketiyle görünüyor. "Sorunlu" asla gizlenmez. Misafir yeniden yazınca hâl kendiliğinden
    düşer.
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
- **Mutasyon:** 15/15.

### 1.3 Çıkış saati: yolculuk ≠ çıkış, düzeltme = yeni saat
- **İstem:** "bir YERE gitmek çıkış saati DEĞİLDİR" ("10'da havaalanına çıkacağız", "yemeğe çıkıyoruz"). Düzeltmede
  YENİ saat yazılıyor.
- **Kod:** anlamı model çözüyor. `timeCorrectedInMessage` yalnız halüsinasyon durdurucu: kayıtlı eski saat ve yeni saat
  aynı cümlede geçmeli (tam sayı; "110" içinden "11" okunmaz) ve ayrılmayı reddetme vetosu aynen geçerli. Eskiden
  düzeltme reddediliyor, eski saat kayıtlı kalıyordu.
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
    ilgilenecek / onaylayacak", soruyorum, danışıyorum, sorarım.
  - EN: check with, find out, double-check, let me check.
  - DE/FR/ES/RU/AR: 1. şahıs gelecek sözü. Şimdiki zaman olgu cümleleri bilerek dışarıda ("Je vous confirme que…").
- **Ölçüm (1.287 cevaplık derlem):** 9 yeni veto, hepsi ev sahibi adına verilen gelecek sözü; biri doğrudan izin
  iddiası ("onaylayacaktır"). Hiçbir önceki veto düşmedi.
- **Erken giriş akışı:** taslak YALNIZ bu vetoyla tutulduysa bekçi ve doğrulanmış erken giriş akışı yine koşar. Sonuç
  iki durumdan biri:
  - doğrulanmış onay sözün yerine gider;
  - ev sahibi kontrol listesini görür, misafire söz gitmez.

  "Yalnız veto tuttu" demek, veto olmasa kapının geçeceği ya da akışın zaten kabul ettiği bir gerekçeyle tutacağı
  anlamına gelir. Kapı güvenden ya da riskten kapanıyorsa akış yine koşmaz (P2).
- **İstem:**
  - Geç çıkış teklif bloğu artık "ev sahibinin teyit edeceğini belirt" EMRETMİYOR; "onayına bağlı olduğunu belirt" diyor.
  - Açık "BEKLEME SÖZÜ YASAK" maddesi eklendi.
  - Örnek 16'daki "marked as urgent" eylem iddiası çıkarıldı.
  - Örnek 13 başlığındaki "söz verilebilecek tek şey ilgilenildiğidir" çelişkisi düzeltildi. Pin büyük harfli olduğu
    için bunu kaçırıyordu.

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

### 2.2 v1 dilim B (sıradaki; bayrak `AI_CONVERSATION_STATE_ENABLED`, varsayılan KAPALI)
Kalıcı kaynaklardan kodla kurulur ve iki model çağrısından ÖNCE hazırdır. PII yok, metin yok.
- **Sohbet evresi:** ilk temas / devam; teslim edilmiş cevap sayısı; cevapsız misafir mesajı sayısı; ev sahibi yazdı mı.
- **Açık kayıtlar (en fazla 5):** son misafir mesajlarının karar kayıtlarından türetilir. Durum kodları:
  `pending_host` · `deferred_to_host` · `host_replied` · `code_approved` · `unknown`. Kayıt yoksa "bilinmiyor"dur,
  "istek yok" DEĞİL.
- **Gönderilen yaşam döngüsü mesajları:** karşılama / giriş / çıkış.
- **Anlama katmanına tarih satırı:** yalnız gün, dakika yok; önbellek anahtarı bozulmasın.
- **Kurallar:**
  - Hiçbir kapı bu bloğu OKUMAZ (pin).
  - Bekçi yalnız metne bakmaya devam eder. Yanlış bir durum iki modeli birden yanıltmasın.
  - Geçmiş sınıflandırmalar "etiket" olarak işaretlenir, olgu gibi sunulmaz.
- **Açma sırası:**
  1. Kör set `evals/conversation-state.json`: "yarın erken" varıştan önce, çıkıştan önce ve rezervasyonsuz; düzeltme;
     yolculuk; kapanış.
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

## 4. Eylem makbuzu — `claimedActions` (tasarım; bayraklı, UYGULANMADI)
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
