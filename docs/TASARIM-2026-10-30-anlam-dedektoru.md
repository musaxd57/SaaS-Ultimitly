# TASARIM 10-30 — Yasak anlamlar için anlam (embedding) dedektörü

Kurucu 10-30 sabah (aynen): "tabiki tutulsun … aynı anlama geliyor bunları embedding yapsana yasak olan kelimelere kodlarla öyle bir sistem
varsa kesinlikle öyle yap ve artık kelime bazında kod yazmandan sıkıldım anlam aynı sen hala sadece kelimeden tutturmaya çalışıyorsun".

## Sorun (ölçülmüş)
- Ev sahibine yönlendirme dedektörü dört turdur (v1 → v4) sözcük kalıbıyla büyüyor. Her çekişmeli incelemede yeni kaçak biçimler çıktı:
  v3'te 102, v4'te 33 bulgu. Kalıp listesi 7 dilde yüzlerce satır; her yeni biçim yeni bir kalıp ve yeni bir fazla silme riski.
- "Bilgim yok" ağı da aynı durumda. 10-30 probu: "Telefon numarası paylaşılmamış" türü 16 iç sistem cümlesinden 12'si bugün gidiyor.
- K-1029-C ölçümü bu sınıfın sözcük kalıbıyla kapatılamayacağını gösterdi: 23 "yalnız sıkılaştıran" yamanın 23'ü karşı örnekle düştü.

## Yaklaşım
Giden cevabın her cümlesi bir vektöre çevrilir (`embedTexts`, mevcut altyapı: `text-embedding-3-small`, 1536 boyut, önbellekli,
arızada `null`). Yasak anlam bankasındaki örnek cümlelere göre en yakın komşu (k-NN) oylaması yapılır.

**Sınıflar (her biri olumlu ve olumsuz örneklerle):**
| Sınıf | Olumlu örnek (yasak) | Olumsuz örnek (benzer ama serbest) |
|---|---|---|
| `host_referral` | "Please confirm the time with your host." · "Bu durumu ev sahibinize aktarabilirsiniz." · "Avísenos si necesita algo más." | "I'll check with your host and get back to you." (söz → veto) · "The cleaner will confirm the time with your host." |
| `third_person_host` | "Your host lives next door." · "Ev sahibiniz Ayşe Hanım çok yardımseverdir." | "Ben Ayşe, size yardımcı olmaktan mutluluk duyarım." (ev sahibinin kendi sesi) |
| `internal_system` | "Telefon numarası paylaşılmamış." · "This isn't listed." · "No details were provided about the sauna." | "Kahvaltı fiyata dahil değil." (olgu) · "Parking is not available on site." (olgu) |
| `host_private` | "Ev sahibiniz şu an İstanbul'da." · "Your host works as a doctor." · ev sahibinin adresi / kimlik no | ev sahibinin adı ("Ben Ayşe") |

**Banka:** v2–v4 test vakaları (7 dil, ~600 cümle, zaten etiketli) + Claude kredisiyle üretilecek kör örnekler (görev #244) + gerçek
cevaplardan doğrulanmış örnekler. Banka kodda sabit bir dosya; vektörleri ilk kullanımda hesaplanır ve önbellekte tutulur.

**Karar:** k=7 en yakın komşudan yasak sınıfın ağırlıklı oyu eşiği geçerse cümle o sınıftan sayılır. Eşik ölçümle seçilir:
- Hedef: geliştirme setinde kaçırma ≈ 0.
- Fazla tutma, 3.274 gerçek cevapta elle örneklenip sayılır.

Sözcük kalıpları kalkmaz, YEDEK olur. Herhangi biri "yasak" derse yasaktır; anlam dedektörü yalnız tutma yönünde ekler.

**Ne yapılır:**
- `host_referral` → bugünkü süzgeç akışı (silinir, cevap gider, istek açık kalır).
- Öteki üç sınıf → cevabın tamamı tutulur, ev sahibine kalır (kurucu 10-30: "kesinlikle gidemez").

**Arızada:** Embedding servisi düşerse sözcük yedeği aynen çalışır. Bugünkü davranış, yani hiçbir şey gevşemez.

## Maliyet ve süre
- Cevap başına bir toplu embedding çağrısı (cevap ~5–15 cümle). `text-embedding-3-small` 1 milyon token 0,02 $: cevap başına ~0,00001 $.
- Ek gecikme ~150–300 ms (tek çağrı). Cevap modelinin süresi yanında küçük.
- Ölçüm: 3.274 cevap ≈ 16 bin cümle ≈ 400 bin token ≈ 0,01 $.

## Ölçüm planı (kod yazmadan önce, sonra kurucuya)
1. Geliştirme seti: v2–v4 test cümleleri, birini dışarıda bırakarak k-NN. Sınıf başına kaçırma ve fazla tutma.
2. Kör set: Claude'un ayrı bir oturumda yazdığı, bankaya hiç girmemiş örnekler (görev #244).
3. Gerçek cevaplar: 3.274 cevapta sözcük dedektörüne göre ek tutuşlar. Örneklem elle okunur; kurucuya önce / sonra örnekleriyle sunulur.
4. Anahtar `AI_SEMANTIC_BANNED_MEANING_ENABLED`. Ölçüm ve kurucu onayından sonra varsayılan açık olur.

## Açık sorular (ölçümden sonra kurucuya)
- Eşik: kaçırmayı sıfıra yaklaştıran eşikte fazla tutma kabul edilebilir mi?
- `third_person_host` sınıfı mülk anlatımıyla karışabilir. Örnek: "Ev sahibiniz olarak size …" kendi sesidir. Gerçek örneklerle gösterilecek.

## Ölçüm sonucu (10-30 öğleden sonra, gerçek embedding, ~0,01 $) — KARAR: embedding tek başına karar veremez
Banka: v3/v4 test cümleleri (288 yasak, 98 benzer-ama-serbest) + 3.274 gerçek cevaptan 4.215 cümle (`text-embedding-3-small`).
- **Geliştirme seti (birini dışarıda bırak, en yakın komşu):** yasak 288 cümlenin 261'i yakalandı, AMA serbest 98 cümlenin 47'si de
  yasak sayıldı. Sebep ölçüldü: embedding KONUYU ölçer, "kim ne yapacak"ı ölçmez — "I'll mention it to your host" (söz) ile "Please
  mention it to your host" (yönlendirme), "Your host arranged a taxi for you" ile "…just call him when you land" en yakın komşu.
- **Gerçek cümlelerde:** sözcük dedektörünün yakaladığı 13 cümlenin yalnız 2'sini buldu; tuttuğu 13 yeni cümlenin çoğu yasak değildi.
- **Sonuç:** anlam kararı cümleyi OKUYAN modelin işidir (kıdemli okuyucu — tek çağrı, yedi dil). Embedding yalnız aday bulucu olabilir;
  bu turda kurulmadı. Kod yedeği: `ai/host-voice-guard.ts` (üçüncü kişi ev sahibi · arka plan · üçüncü taraf, yedi dil, kapı `reply_host_voice`).
- Aynı ölçümün yan bulgusu: istemin kendisi modele "mesajınız kaydedildi, ev sahibiniz görebilir" / "ev sahibinizin kararıdır" kalıplarını
  öğretiyordu → K-1029-A istem katmanına "MESAJI EV SAHİBİ YAZIYOR" kuralı eklendi (birinci çoğul kişi, devir cümlesi yok, üçüncü taraf yok).
