# Bekleyen risk — öğe (istek) bazında temsil · inceleme + öneri (2026-09-26)

> Kurucu isteği (09-26): eski cevapsız gerçek risk yeni mesajla **kaybolmamalı**, ama eski risk **tüm konuşmayı bloke
> etmemeli**; risk istek bazında tutulmalı. Örnek: 1) "IBAN'ınızı atar mısınız?" 2) "Wi-Fi şifresi neydi?" → IBAN açık
> hassas öğe olarak ev sahibinde kalır (tehlikeli otomatik cevap yok), Wi-Fi bağımsız ve güvenliyse normal cevaplanır.
> "Önce mevcut mimaride istek/soru düzeyi öğe/durum var mı incele; yoksa migration yazma, mevcut yapıyla nasıl temsil
> edileceğini ve eksik kalıcı durumu raporla."
>
> Bu turda **üretim kodu değişmedi.** Önceki turun konuşma düzeyi kapısı (`6c0e6b4`: bekleyen herhangi bir yüksek riskli
> etiket → cevabın tamamı tutulur) istenen şeyin tersi olduğu için gönderilmeden geri alındı; yedek dal
> `backup/pending-highstakes-conversation-gate-2026-09-26`.
> Karakterizasyon testi: `tests/integration/pending-risk-item-scenarios.test.ts` (7 test, bugünkü davranışı pinler;
> tasarım uygulanınca bilerek değişir).

## 1. Kısa cevap

**Kanal yolunda (Airbnb/Booking) istek ya da soru düzeyinde öğe/durum YOK.** Var olanlar mesaj düzeyinde ve kısmi:

| Yapı | Ne taşır | Eksik |
|---|---|---|
| `RiskEvent` (karar kaydı) | tetikleyici **mesaj** başına karar (`triggerId`, `finalDecision`, `reason`, `riskType`) | Kanal oto-yanıtı her geçişte yalnız **son** mesaj için yazar (`automation.ts`, `triggerId: last.id`). Aynı senkron dalgasında gelen önceki riskli mesajın kendi kaydı hiç olmayabilir (kelime yolu yalnız şikâyet/iade için `hit.id` yazar). |
| `hasOpenHostWork` (`conversation-attention.ts`) | son **ev sahibi** mesajından sonra tutulmuş misafir mesajı var mı | Yalnız kapanış gizleme kapısında kullanılır; gelen kutusu, "Dikkat Gerektirenler" ya da kapı okumaz. |
| Konuşma Anlama Durumu v1 (`conversation-state.ts`, bayrak kapalı) | konu başına açık öğe (`pending_host` / `deferred_to_host` / `host_replied` / `code_approved`) | Tutulan mesajdan sonra yapay zekâ **herhangi** bir cevap gönderince öğeyi kapatır ("o geçiş bu mesajı da kapsadı"). `hasOpenHostWork` aynı öğeyi açık sayar: **iki görünüm çelişir** (testli). `platform_policy` konu kümesinde yok → "other". |
| Anlama katmanı (`understanding-schema.ts`) | cevapsız mesajlardaki **istek başına** niyet + sorgu | İsteğin **hangi mesajdan** geldiği yok, istek başına risk yok, geri çekme yok. |
| Konaklama birleşim değişmezi (`stayRequestKinds`, `evaluateAvailability`) | katmanların birleşimi | **Tur** düzeyinde (tüm cevapsız mesajlar tek küme). |
| "Sorunlu" (`status: problem`) | ev sahibine yükseltme | **Konuşma** düzeyinde KALICI durdurma (kalıcı ürün kararı): hem model yolu hem kelime yolu (`sendDueAlerts`) yazar; sonraki her mesaj `complaint` ile atlanır. |
| **QR yolu** (`api/chat/[token]`) | her mesaj kendi başına değerlendirilir; riskli mesaja hemen deterministik devir metni, karar kaydı mesaj başına | Öğe bazlı **emsal** budur: IBAN → devir, ardından Wi-Fi → normal cevap (testli). Kanalda karşılığı yok. |

## 2. Üç senaryo — bugünkü davranış (testli)

Model çıktısı belirlenimsiz; her senaryo iki dalda koşuldu. İstem "birden fazla konu varsa niyet olarak **en yüksek
riskli** olanı seç, ama reply'da **TÜM** soruları yanıtla" diyor (`prompts.ts` BÖLÜM 3) → gerçekte "etiketledi" dalı olası.

| Senaryo | Model etiketlemedi | Model etiketledi (`platform_policy`) |
|---|---|---|
| **1** IBAN → Wi-Fi (ayrı mesajlar) | 1. geçiş: IBAN kelime ağıyla tutulur (sessiz taslak, `new`). 2. geçiş: kapı bekleyen mesajda `platform_policy`'ye **bakmaz** → Wi-Fi cevabı **gider**; model IBAN'ı da görür ve istem onu da cevaplatır. Konuşma `answered`, risk rozeti silinir → **IBAN gelen kutusunda iz bırakmaz**; yalnız karar kaydında kalır. | Wi-Fi cevabı da gitmez; konuşma **Sorunlu + acil + e-posta**; sonraki bağımsız soru ("Otopark var mı?") model çağrılmadan atlanır → **tüm konuşma bloke**. |
| **2** IBAN → "Boşverin, gerek kalmadı" | "Anlaşıldı" gider. IBAN öğesi için **iptal/geçersiz hâli yok**; kapanış kapısı açık iş sayar, Anlama Durumu kapatır. | IBAN turu Sorunlu olduysa "boşverin" **hiçbir şey değiştirmez** (model çağrılmaz, Sorunlu kalır). |
| **3** "IBAN'ınızı atar mısınız? Bir de Wi-Fi şifresi neydi?" (tek mesaj) | Mesaj **tek öğe**: kelime ağı mesajın tamamını tutar → Wi-Fi kısmı da otomatik cevaplanmaz; tek karar kaydı (`platform_policy`). | Sorunlu → yapay zekâ bu konuşmada durur. |
| (emsal) QR, senaryo 1 | IBAN → devir metni ("kaydedildi; ev sahibiniz görebilir"), Wi-Fi → normal cevap; IBAN açık iş (`deferred_to_host`). | — |

Ek sınıf farkı (mevcut kural, `tests/integration/unanswered-window.test.ts` pinli, 08-01 kararı): bekleyen **şikâyet /
iade / erken ayrılma / insan talebi** ve **acil / kural ihlali / ayrımcılık** etiketi sonraki zararsız sorunun cevabını da
TUTAR (konuşma düzeyi); **platform dışı ödeme / yorum tehdidi / erişim güvenliği / iptal / para iadesi** etiketine bekleyen
mesajda hiç bakılmaz (kayıp). Yani bugün iki sınıfın da davranışı kurucunun istediğinden farklı — biri fazla bloke eder,
öteki kaybeder.

## 3. Kök nedenler

1. **Cevap modeli tur düzeyinde:** tek `intent` / `riskType` / `riskLevel` + tek `reply`; hangi öğeleri cevapladığını
   söyleyen alan yok. Riskli öğenin etiketi güvenli sorunun cevabına bulaşır.
2. **"Sorunlu" konuşma düzeyinde kalıcı** (kalıcı ürün kararı) — öğe bazlı "açık hassas istek" hâli yok.
3. **Gönderim konuşmayı `answered` yapar ve rozeti siler** — tutulan öğe ev sahibi yüzeylerinden düşer
   ("Dikkat Gerektirenler"de de bu tür satır yok).
4. **Öğe yaşam döngüsü yok:** geri çekme / geçersiz kılma / ev sahibinin öğeyi çözmesi yazılacak yer yok; türetilmiş iki
   görünüm aynı öğeye farklı hüküm veriyor.
5. **Aynı dalgada gelen mesajların** yalnız sonuncusuna karar kaydı yazılıyor.

## 4. Mevcut yapıyla (migration'sız) temsil — öneri

**Öğe = misafir mesajı** (`Message.id`, var). **Öğe durumu = o mesajın karar kaydı** (`RiskEvent`, `triggerId` = mesaj).

**Önerilen yol (A) — QR paritesi, sıralı öğe işleme (bayrak arkasında, varsayılan kapalı):**
1. Her geçişte cevapsız mesajlar eskiden yeniye öğe olarak işlenir. Mesaj başına kelime ağı (tam, mesaj bazlı) hassas
   derse o öğe için: kendi karar kaydı (yeni kapalı-küme gerekçe, ör. `pending_sensitive_item`; benzersiz anahtar
   idempotent) + QR'daki gibi deterministik devir metni ("Mesajınız kaydedildi; ev sahibiniz görebilir") → öğe
   `deferred_to_host`, cevapsız pencere doğal olarak sıfırlanır.
2. Sonra kalan (güvenli) öğe(ler) için model normal koşar: modelin girdisinde IBAN artık "devredildi" olarak geçmişte
   durur, cevapsız değildir → modelin etiketleri yalnız kalan öğeye aittir (birleşim o öğe için **tam**).
3. Ev sahibine görünürlük "Sorunlu" yerine öğe bazlı: karar kaydından türetilen gelen kutusu rozeti + "Dikkat
   Gerektirenler"de yeni satır türü (açık hassas istek) + konuşma önceliği `urgent` (QR emsali, yalnız görsel).
4. İki türetilmiş görünüm tek kurala bağlanır: tutulan/devredilen öğeyi yalnız **ev sahibinin yazması**, **kodun
   doğrulanmış onayı** ya da (onaylanırsa) **geri çekme** kapatır; sonraki yapay zekâ cevabı kapatmaz.

**Alternatif (B) — sessiz tutma + cevap kapsamı dışında bırakma:** hassas öğeye misafire bir şey gitmez; güvenli soru
cevaplanırken istemde "bu mesaj ev sahibine bırakıldı, cevaplama" notu + cevabın o öğenin konusuna **değmediğini**
kodla doğrulayan veto (ör. ödeme/IBAN → para sözlüğü) + modelin tur etiketi tutulan öğenin etiketiyle aynıysa ona atfedilir,
atfedilemeyen yüksek riskli etiket cevabın tamamını tutar. Daha karmaşık, çıkarım içerir; misafir IBAN'da sessizlik görür.

**Birleşim değişmezi öğe kapsamında:** kelime ağı zaten mesaj başına → tam. Model katmanları tur düzeyinde → (A)'da öğeler
sırayla işlendiği için tek öğeli turda tam; iki TAZE ve kelime ağına temiz mesajın aynı turda gelmesinde model etiketi
bölünemez → cevabın tamamı tutulur (güvenli yön, "mümkün olduğunca"). Kesinleştirmek için anlama katmanı şemasına istek
başına `message_index` + `risk` alanı eklenebilir (model çıktı şeması; DB değişikliği değil).

**Sınır ve bedel:** fazladan `RiskEvent` satırları raporların "insana kaldı" sayımını şişirmemeli (ayrı gerekçe,
raporda ayrı satır). Senaryo 3 (tek mesajda iki istek) bu yolda da **tek öğe** kalır.

## 5. Eksik kalıcı durum (migration ister — YAZILMADI)

- **İstek düzeyi kimlik** (bir mesajda birden çok istek — senaryo 3): istek defteri satırı {konuşma, mesaj, istek sırası,
  konu, hassasiyet, durum (açık / cevaplandı / tutuldu / devredildi / geri çekildi / geçersiz / ev sahibi çözdü), kararı
  veren katmanlar, cevaplayan mesaj, zamanlar}. Planlanmış iki yapıyla birleşir: **CUS v2 defteri** ve Host Copilot
  **`DecisionRequest`** (Faz 0 onay paketi K1–K10).
- **Cevap ↔ öğe bağı:** `Message.replyToMessageId` (CLAUDE.md'de zaten "doğrusu bu, migration" diye not edilmiş) ya da
  çoklu bağ tablosu.
- **Geri çekme / geçersiz kılma olayı:** hangi katman, hangi kanıtla karar verdi.
- **Ev sahibinin öğe üzerindeki eylemi** (çözüldü / yok say) — `DecisionRequest`.

## 6. Kurucu kararı gereken noktalar

- **D1** "Sorunlu = konuşma düzeyinde kalıcı durdurma" kalıcı kararı öğe bazına inecek mi? Hangi sınıflarda (acil durum,
  şikâyet dahil mi)?
- **D2** 08-01 kararı (bekleyen şikâyet → sonraki zararsız soru da tutulur, `unanswered-window.test.ts`) öğe bazına mı
  inecek?
- **D3** Tutulan hassas öğeye misafire bir şey gidecek mi (QR gibi devir metni — yol A) yoksa sessiz mi kalacak (yol B)?
  Bugün kanalda yüksek risk = sessiz taslak; bekletme mesajı yalnız opt-in ve yalnız hafif şikâyette.
- **D4** Güvenli cevap tutulan öğeye değinebilir mi (ör. "Ödemeler platform üzerinden yapılır") yoksa hiç değinmez mi?
- **D5** "Boşverin" hangi sınıflarda öğeyi kapatır (acil / şikâyet de mi?), hangi katman(lar)ın hükmüyle?
- **D6** Senaryo 3: tek mesajdaki istekler bölünecek mi (istek defteri = migration) yoksa mesaj tek öğe mi kalacak?
