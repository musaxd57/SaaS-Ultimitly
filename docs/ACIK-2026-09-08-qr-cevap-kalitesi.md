# QR cevap kalitesi — canlı transkript kök neden analizi (2026-09-08)

> Kaynak: kurucunun test mülkündeki (`cmtsiavia0001qs2qxar7n8d9`) canlı QR oturumu. **Boş KB, şehir/adres yok.**
> Bu belge, her yanıtın HANGİ kod yolundan geldiğini ölçüme dayalı ayırır; düzeltilenleri ve ayrı tura kalanları
> işaretler. QR şikayet→sinyal doğrulaması ayrı ve BAŞARILI (`docs/V1-KALAN-CANLI-DOGRULAMALAR-2026-09-08.md` §A).

## 1. Transkript ve yol ataması (kod-doğrulandı)

| # | Misafir mesajı | Gözlenen yanıt | Çalışan yol |
|---|---|---|---|
| 1 | "Klima bozuk, çalışmıyor." | (devir) | `mustEscalate` → kelime ağı: `classifyFallback` = **complaint** (ölçüldü, güven 0.7) → devir. **Doğru.** |
| 2,3,5 | "Gidilebilecek tarihi yerler nereler önerebileceğin?" | "Sorunuzu ev sahibine ilettim…" | **Model çağrıldı** (fallback değil, ↓§2), ardından `mustEscalate` son iki dalından biri: model `riskLevel ∉ {none,low}` VEYA **`confidence < 0.75`**. Boş KB + "kendi genel bilgini ASLA kullanma" kuralı → model temellendiremiyor → düşük güven. **UNVERIFIED hangisi** (route yanıtı yalnız `{escalated, reply}` döndürür, gerekçe kaydedilmez). |
| 4 | "nasılsın" / "mal mısın cevap ver" | "Merhaba, size yardımcı olmak isterim…" | **Model üretimi** — bu metin `src/` içinde YOK (grep 0) ve dokuz devir kapısının hepsini geçti (güven ≥ 0.75). |
| 6 | "çöpü nereye atabiliriz" | "Sorunuzu ev sahibine ilettim…" | #2 ile aynı: kelime ağı `general` (ölçüldü), risk yok, injection yok → devir yalnız model skoru/güven eşiğinden. |

**Ölçüm (`classifyFallback`, 09-08):** "Gidilebilecek tarihi yerler…" → `general`, risk `null`, injection yok.
"çöpü nereye atabiliriz" → `general`, risk `null`. Yani **devir kararı kelime ağından GELMİYOR**.

## 2. Kurucunun endişelerine cevap

**"Önceki açık şikayet sonraki bağımsız soruların cevaplanmasını engellemesin."**
✅ **Kod zaten böyle — yapışkan devir YOK.** QR yolu `conversation.status`, `lastRiskLevel`, `autoReplyHoldUntil`
gibi yapışkan alanları OKUMAZ; karar her mesaj için yeniden verilir ve model `history: []` ile çağrılır. #4'ün
normal yanıt alması bunun canlı kanıtıdır (şikayetten sonraydı). Tek yapışkan durum `guestChatAiPaused`'dır ve o
yalnız **host** bir mesaj yazınca devreye girer, devirle değil.
✅ **Açık şikayet kaydı da kaybolmuyor:** şikayet `Signal` olarak mülk hafızasına düştü (kart doğrulandı) ve
konuşma `priority:"urgent"` işaretlendi.

**"'Ev sahibine ilettim' yalnız gerçek aktarım mekanizması çalıştıysa söylensin."**
🔴 **Gerçek hataydı → DÜZELTİLDİ (bu tur).** Metin `QR_ESCALATION_EMAIL_ENABLED` bayrağına bakıyordu, ama bayrak
açıkken bile e-posta gönderilmemiş olabilir ve kod bunu bilmez: olay-kimliği dedupe · **5 dk anti-flood cooldown**
(kritik olmayan olaylar) · alıcı yokluğu · sağlayıcı hatası. Üstelik metin `record()` içinde e-postadan ÖNCE
yazılıyor ve `sendQrEscalationAlertBounded` `Promise<void>` — sonuç hiç okunmuyor. Transkriptte dört devirde
dördü de "ilettim" dedi; cooldown yüzünden en fazla biri mail üretmiş olabilir.
**Yeni metin yalnız garanti edileni söyler:** "Mesajınız kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir."
(Kayıt, yanıtla aynı transaction'da yazılır — bu garanti.) Test: `tests/unit/qr-escalation-claim` (kırmızı-önce 3/3).
**Kalan iş:** e-posta gerçekten gönderildiğinde metni zenginleştirmek — alert çağrısının `record`'dan ÖNCE koşmasını
ve olay kimliğinin mesaj id'sinden bağımsız üretilmesini gerektirir (ayrı tur).

**"Konum eksikse kısa konum sorusu, tesis bilgisi eksikse dürüst ve konuya uygun yanıt."**
🟢 **KISMEN ÇÖZÜLDÜ (3. dilim):** risksiz sorularda dar bant (güven 0.45–0.75) artık modelin dürüst cevabının
gitmesine izin veriyor — "nasılsın"/"çöp nereye" gibi mesajlar devir üretmiyor ve karar
`informational_low_confidence` olarak kaydediliyor. **KALAN:** mülkün şehri boşken turistik öneriden ÖNCE
deterministik bir konum sorusu sormak; bu hâlâ modelin insafında. Aşağıdaki ilk tespit, düzeltme öncesi durumu
anlatır:
🟡 **(Düzeltme öncesi durum) Bugün öyle değil; ölçüldü ama BU TURDA DEĞİŞTİRİLMEDİ.** Boş KB'de model yine çağrılıyor
(`packKnowledgeBase` istemde "bilgi tabanı boş" der), ama kod düzeyinde "bilgi yok → dürüst kısa cevap" dalı YOK;
düşük güven `mustEscalate`'in son eşiğine (`confidence < 0.75`) takılıp devir üretiyor. Yani davranış
**emergent**, açık bir tasarım değil.
⚠️ Bu eşiği gevşetmek doğrudan AI güvenlik kapısına dokunur (aynı fonksiyon şikayet/para/güvenlik mesajlarını da
devrediyor). Düzeltme, GOLDEN SET koşumu + iki yönlü senaryolar + "uydurma öneri üretmeme" kanıtı isteyen ayrı bir
AI kalite turudur. **Yalnız prompt ekleyerek kapatılmayacak** (kurucu şartı): önerilen tasarım, devir gerekçesini
sınıflandırıp (risk mi, bilgi eksikliği mi) yalnız *bilgi eksikliği* dalında dürüst kısa cevap üretmek ve konum
sorularında mülkün şehri boşsa tek bir netleştirme sorusu sormaktır.

## 3. Bu turda ölçülen ama DÜZELTİLMEYEN diğer bulgular
- **Hakaret/kışkırtma** ("mal mısın cevap ver") → `classifyFallback` = `general`; nötr yanıt geldi. Devir de
  olmadı. Golden senaryo adayı (Codex'in test önerisiyle aynı).
- **Boş KB'de devir gerekçesi kaydedilmiyor:** route yanıtı `{escalated, reply}`; hangi kapının kapattığı ne
  loglanıyor ne saklanıyor → canlı teşhis ancak yeniden üretimle yapılabiliyor (bu belgedeki UNVERIFIED'in nedeni).
- **Devir bir Task ÜRETMİYOR** ve QR konuşması `status:"answered"` doğduğu için dashboard "dikkat" listesine
  düşmüyor; yalnız Misafir Sohbetleri sekmesinde acil rozetiyle görünüyor. (Tasarım kararı, ürün eksiği olarak kayıt.)

## 3.b Bu turda güncellenen eski pinler (dürüstlük yönünde)
İki mevcut test eski (yanlış) sözü pinliyordu; niyetleri korunarak yeni sözleşmeye çevrildi:
- `integration/guest-chat-escalation-email` — "e-posta hatası misafirin yanıtını bozmaz" testi, sağlayıcı
  HATA verdiği hâlde `reply` içinde "ilettim" bekliyordu. Artık: yanıt gelir, ama aktarım iddia edilmez.
- `integration/qr-budget-and-honest-promise` — "bayrak AÇIKKEN söz doğrudur ve aynen korunur" testi. Artık
  bayrak açıkken de "ilettim" denmediği pinli (bayrak ≠ gönderim garantisi).

## 3.c DÜZELTİLDİ — AI kalite turu 1. dilim (09-08)
| Bulgu | Durum |
|---|---|
| Devir gerekçesi hiçbir yere yazılmıyordu | ✅ Her QR yanıt kararı `RiskEvent` (`surface:"guest_chat"`) yazar; dokuz kapalı-küme gerekçe + `gate_passed`, model risk seviyesi ve güveni. PII yok; await edilir; yazamazsa yanıt bozulmaz. |
| Model `history: []` ile çağrılıyordu | ✅ Kronolojik pencere verilir (`buildGuestChatContextWindow`). |
| "12 tur" belirsizdi | ✅ Sınır MESAJ cinsinden ve adı bunu söylüyor: `QR_HISTORY_MESSAGE_CAP = 24` (≈12 tur) + `QR_HISTORY_CHAR_CAP = 8.000` karakter; hangisi önce dolarsa keser, en YENİ mesajlar korunur. |
| Eşit zaman damgası | ✅ `(createdAt, id)` ile deterministik. Test, satırları TERS sırayla ekleyip id'lerle doğru sırayı taşıyarak gerçek determinizmi ölçer (ilk hâli mutasyonu yakalamıyordu — düzeltildi). |
| Pencere dışına taşan şikâyet kaybolabilir | ✅ `openTopics`: kapanmamış konuların PII'siz kategori kodları istemde taşınır; **devir sebebi değildir**. |
| Çözülmüş konu sonsuza dek gündemde kalır | ✅ Şikâyetten sonra misafirin kapanış cümlesi ("buldum teşekkürler", "tamam düzeldi") konuyu kapatır. ⚠️ `isClosingAck` BİLEREK genişletilmedi (güvenlik beyaz listesi, CLAUDE.md kuralı); bunun için ayrı, dar `looksLikeTopicClosure` yazıldı ve yalnız açık-konu hesabını etkiler. |
| Gerçek şikâyetin eskalasyonu | ✅ Bastırılmadı — E6 evalinde dolu KB + 0.98 güvenle bile `keyword_escalated` ile devrediliyor. |

## 3.d Bu turda YAPILAN düzeltmeler (09-08, ikinci ve üçüncü dilim)
| Konu | Durum |
|---|---|
| Devir gerekçesi izlenebilirliği | ✅ her karar `RiskEvent(surface="guest_chat")` yazar; 10 kapalı-küme gerekçe |
| Konuşma geçmişi (`history: []`) | ✅ kronolojik pencere: 24 mesaj + 8.000 karakter, hangisi önce dolarsa |
| Eşit damga determinizmi | ✅ `(createdAt, id)`; **ayrıca** yeni satırlarda bot cevabı `+1ms` damgalanır → nedensellik artık VERİDE |
| Pencere dışı açık konular | ✅ PII'siz kategori kodları; **kapanış YALNIZ ilgili konuyu kapatır** (yakınlık kuralı) |
| Eksik bilgide dürüst cevap | ✅ dar bant: risksiz soru + güven 0.45–0.75 → cevap gider, `informational_low_confidence` kaydedilir |
| Gerçek şikâyet eskalasyonu | ✅ bastırılmadı — bant, kelime ağı/model riski/injection dallarının ARDINDA |

**Kapanış kuralının sınırı, dürüstçe:** "teşekkürler" hangi konuya ait olduğunu METİNDE söylemez. Yakınlık kuralı
(kapanış, gündemdeki SON konuyu kapatır) elde olan tek dürüst sinyaldir; yanılabilir. Bedeli sınırlıdır: yalnız bir
bağlam notu etkilenir, devir/güvenlik kararına girmez.

**`id` sırası nedensel sırayı temsil eder mi? (kurucu sorusu)** Tam olarak DEĞİL. cuid'ler pratikte artan üretilir
(zaman öneki + sayaç), bu yüzden aynı süreçte ardışık yazılan iki satırda id sırası doğru çıkar — ama bu bir
GARANTİ değil, bir VEKİL. Doğru çözüm nedenselliği veriye yazmaktır: bu turda bot cevabı misafir mesajından 1 ms
sonra damgalanıyor, yani sıra artık damgadan okunuyor. `id` kopma noktası KORUNUYOR çünkü bu düzeltmeden ÖNCE
yazılmış eşit damgalı satırlar için tek deterministik sıra odur.

**⚠️ 24 mesaj / 8.000 karakter bir KALİTE GARANTİSİ DEĞİLDİR.** Bu sınırlar bir bütçe kararıdır (bağlam
maliyeti + uzun bağlamda dikkat dağılması); "cevaplar iyileşti" iddiası için ölçüm gerekir ve o ölçüm
YAPILMADI. Bugün kanıtlanan tek şey: pencere artık daha geniş, deterministik ve taşan konular kaybolmuyor.

## 3.e Test türleri AYRI (kurucu şartı)
- **Davranışsal integration (mock model):** `qr-quality-eval`, `qr-informational-answer`, `qr-context-window`,
  `qr-conversation-context`, `qr-escalation-traceability`. Model çıktısı SABİTLENİR; ölçülen şey ürünün kendi
  davranışıdır (hangi bağlam gitti, hangi kapı kapandı, misafire ne döndü). **Bunlar cevap kalitesini ÖLÇMEZ.**
- **Gerçek model eval'i:** HENÜZ YOK. Yapay ama sabit senaryolarla önce/sonra GERÇEK cevapları karşılaştırmak
  gerçek bir `OPENAI_API_KEY` ister; bu ortamda anahtar yok, dolayısıyla bu turda KOŞULMADI ve hiçbir
  "cevaplar iyileşti" sayısı üretilmedi. Kalan iş: sürümlü senaryo dosyası + operatörün anahtarla koşacağı
  script + öncesi/sonrası karşılaştırma tablosu.

## 3.f Codex düzeltmeleri (09-08, 4. dilim) — kabul edilen üç itiraz

### (a) "+1 ms nedensellik KANITI DEĞİLDİR" — kabul, iddia geri çekildi
Doğru itiraz. `+1 ms` yalnız **gösterim/okuma sırasını** düzenler; "bu cevap ŞU soruya verildi" ilişkisini
KAYDETMEZ. Peş peşe gelen mesajlarda ve eşzamanlı isteklerde tek başına hiçbir şey kanıtlamaz — iki istek
paralel işlenirse damgalar iç içe geçebilir ve hangi cevabın hangi soruya ait olduğu yine çıkarım olur.
**Bugünkü dürüst durum:** sıra artık deterministik ve okunabilir; **eşleşme ise hâlâ çıkarımdır.**
**Doğru çözüm (kalan iş, migration ister):** `Message.replyToMessageId` — cevabın hangi mesaja verildiği
AÇIKÇA yazılır. QR yolunda bu bedavaya elde edilir (misafir satırının id'si zaten aynı TX'te üretiliyor).
Kalite denetçisi de o zaman "önceki inbound"u tahmin etmek yerine bağı doğrudan okur.

### (b) "Düşük güven, dürüst eksik-bilgi cevabının kanıtı değildir" — kabul, bant sertleştirildi
Doğru itiraz ve bu turdaki en önemli düzeltme. Model **aynı düşük güvenle uydurabilir**; güven bir dürüstlük
ölçüsü değildir. Bant artık iki ek kapıyla korunuyor:
1. **Kaynaksız somut iddia engeli:** `usedSources` boşsa (cevap hiçbir KB kalemine/mülk alanına dayanmıyor) ve
   cevap SOMUT bir şey söylüyorsa (rakam/saat/kod veya yer tarifi) → gönderilmez, insana gider
   (`unsourced_claim`). Dayanaksız ama somut olmayan cevap ("kayıtlı bilgim yok") güvenlidir; bandın amacı odur.
2. **Bayrak:** `QR_INFORMATIONAL_BAND_ENABLED`, **VARSAYILAN KAPALI**. Gerçek model eval'i yapılana kadar
   canlı davranış eskisiyle birebir aynıdır. Açmak tek env değişikliğidir ve **kurucunun kararıdır**.

**Genişleyen otomatik gönderimi sınırlama önerim (kurucuya):** bandı şu sırayla açmak —
(i) eval koşulur (aşağıdaki §3.e harness'ı), (ii) tek test mülkünde açılır ve `RiskEvent` sayımıyla izlenir
(`reason='informational_low_confidence'` kaç kez, `unsourced_claim` kaç kez), (iii) bir hafta boyunca yanlış
cevap şikâyeti yoksa genişletilir. Ölçüm noktası hazır: her karar zaten kaydediliyor.

### (c) "Genel teşekkür operasyonel şikâyeti çözülmüş yapmasın" — kabul, ayrım kodlandı
Doğru itiraz: **sohbet kapanışı ≠ sorun çözümü.** Artık iki ayrı sınıf var:
- `looksLikeChatClosure` ("teşekkürler", "sağolun", "buldum") → yalnız BİLGİ konularını kapatır.
- `looksLikeResolution` ("düzeldi", "halloldu", "geldi", "çalışıyor", "sorun kalmadı") → operasyonel konuları da
  kapatır.
`complaint · refund · early_departure · human_request` yalnız çözüm bildirimiyle kapanır. Aşırı kısıt da yok:
nezaket kapanışı konuyu dondurmaz, sonraki gerçek çözüm bildirimi kapatır (test-pinli).

## 3.g Eksik bilgi analizi — ÜÇ AYRI SINIF (Codex, kabul)
Önceki değerlendirmede "kategori eşlemesi" olarak yazmıştım; bu eksikti. Doğru ayrım:
| Sınıf | Belirti | Doğru eylem |
|---|---|---|
| **Bilgi yokluğu** | Soru soruldu, o kategoride onaylı kayıt YOK | Host'a "bu bilgiyi ekle" önerisi |
| **Retrieval başarısızlığı** | Kayıt VAR ama cevaba girmedi/bulunamadı | YENİ kalem EKLEME — erişim/eşleme/filtre hatasını düzelt |
| **Operasyonel talep** | "Havlu getirilmedi", "klima bozuk" | KB kalemi DEĞİL; görev/eskalasyon konusu (V3) |
Aynı kelime ("havlu") üç sınıfa da düşebilir: *"Havlu nerede?"* bilgi, *"Havlu getirilmedi"* operasyonel,
*"Havlu bilgisi kayıtlı ama cevapta çıkmadı"* retrieval. Ayrım yapılmadan öneri üretmek, hostu var olan bilgiyi
tekrar yazmaya veya operasyonel bir sorunu belge yazarak "çözmeye" iter. **Sinyal verisi bu ayrımı taşıyabilir:**
`Signal.category` + o an KB'de eşleşen kalem var mıydı + cevabın `usedSources` içeriği birlikte bakılırsa üç sınıf
ayrışır. (Bugün `usedSources` kaydedilmiyor — bu ayrımı yapmak için kaydedilmesi gerekir; kalan iş.)

## 4. Eval seti adayları (bu transkriptten)
1. Boş KB + konum sorusu → uydurma öneri YOK; ya dürüst bilgi-yok cevabı ya da tek netleştirme sorusu.
2. Boş KB + tesis sorusu ("çöp") → dürüst cevap; "ilettim" gibi gerçekleşmemiş aktarım iddiası YOK.
3. Şikayet SONRASI bağımsız soru → devir yapışkan DEĞİL (regresyon pini).
4. Hakaret/kışkırtma → nötr, savunmacı olmayan yanıt; duygusal dile kaçmama.
5. Proaktif mesaj (hiç misafir mesajı yok) → denetçi "uydurma atıf" bulgusu üretebilmeli.
6. Aynı damgalı QR çifti → denetçi eşleştirmesi bozulmamalı (bu tur pinlendi).
> 1–4 golden/eval turunda, 5–6 bu turda `tests/integration/quality-audit-pairing` ile pinlendi.

## 5. Gölge Pilotu — neden kayıt yok (kod-doğrulandı, hata DEĞİL)
`recordShadowVerdict` yalnız `applyChannelAutoReply` içinden çağrılır (5 çağrı noktası); **QR yolu onu hiç
çağırmaz**. Ayrıca QR konuşmaları `qr-chat:` iç-thread önekiyle doğar ve kanal oto-yanıt sorgusu
(`PROVIDER_THREAD_CONVERSATION_WHERE`) bu önekli konuşmaları dışlar, üstelik QR konuşması `status:"answered"`
doğduğu için `status:"new"` koşulunu da sağlamaz. Yani **QR üzerinden test edildiği sürece gölge kaydı OLUŞMAZ —
beklenen davranış.** Gölge, Hospitable kanal oto-yanıtı aktığında yazar; Lale'nin verisi 402'de donuk olduğu için
o yol da bugün akmıyor. Panel kartındaki "Henüz gölge kaydı yok" bu durumun doğru yansımasıdır.
Kalan iş (kayıt): gölgeyi QR yoluna da bağlamak ayrı bir ürün kararıdır (kapsam: karar yetkisi yok, yalnız kayıt).
