# Tasarım 2026-11-18 — Kuyrukta "hazırlanıyor / dış gönderim başladı / sonuç belirsiz" ayrımı ve atomik iptal

> Kurucu 11-18 akşam (AYNEN `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md`, "Ödeme ve migration"): öncelik "outbox'ta
> hazırlanıyor / dış gönderim başladı / sonuç belirsiz ayrımı … `cancelRequestedAt` tek başına yarışı kapatmaz — iptal ile gönderim
> başlangıcı aynı satırda atomik karar vermeli." Kolonlar migration 98 ile hazır (`dispatchStartedAt`, `cancelRequestedAt`, `cancelReason`,
> `decisionRequestId`). Kalıcı kuyruk anahtarı (`DURABLE_OUTBOX_ENABLED`) kapalı olduğu için değişiklik açılışa kadar hiçbir gönderimi
> etkilemez; testler anahtar açıkken koşar.
> **Durum (11-19):** K1 (gönderim başlangıcı işareti + atomik iptal), K2 (talep süresi dolan satırın ayrımı) ve K3 (dış iptal yolları:
> Girişler'den elle gönderim · konuşma silme · daire silme · misafir silme talebi · saklama süpürgesinin iki dalı) YAZILDI
> (`src/lib/outbox/dispatch.ts`, `worker.ts`). Silme yolları iptal isteğini KENDİ işlemlerinin içinde yazar (`cancelRequestWrite`); işçinin
> talebi ezilmez, satır gönderim başlangıcında reddedilir. İptal isteği taşıyan satır dirilmez (elle "tekrar dene" ve abonelik dönüşü
> onu bekleyene almaz). K4 (karar mesajı kuyruğa) sırada.

## 1. Bugün

Kuyruk satırının yaşamı: `pending` → (işçi talep eder) `sending` → sağlayıcıya istek → `sent` / `failed` / `ambiguous` → …
`sending` iki ayrı şeyi tek durumda taşıyor:

1. **Hazırlanıyor:** işçi satırı aldı; gönderim öncesi kontrolleri (konuşma devralındı mı, rezervasyon iptal mi, metin güncel mi…) koşuyor.
   Sağlayıcıya henüz hiçbir şey gitmedi.
2. **Dış gönderim başladı:** istek sağlayıcıya çıktı; cevap bekleniyor.

Bu yüzden iki sorun var:

- **Dışarıdan iptal yarışı.** Bir satırı dışarıdan iptal etmek isteyen her yol (konuşma silme, daire silme, misafir silme talebi, elle
  gönderimin kuyruk satırını bırakması, karar mesajının sıradaki cevabı geçmesi) yalnız `pending` satırı iptal edebiliyor. Satır `sending`
  ise "henüz gitmedi, iptal edebilirim" ile "çoktan gitti" ayırt edilemiyor; iptal isteği yazılsa bile işçi onu ne zaman okuyacağı belli
  olmadığı için istek gönderimle yarışır (kurucunun notu: tek başına `cancelRequestedAt` yarışı kapatmaz).
- **Gereksiz "ulaşmış olabilir" incelemesi.** İşçi çökerse (talep süresi dolarsa) `sending` satır "belirsiz"e alınıyor — mesaj hiç
  gönderilmemiş olsa bile. Hazırlık aşamasında çöken satır için bu, ev sahibine yanlış bir "misafire ulaşmış olabilir" uyarısıdır.

## 2. Kural: gönderimin başlangıcı ve iptal AYNI satırda, koşullu yazımla karar verir

İki koşullu yazım, aynı satır (veritabanı satır kilidi ikisini sıraya sokar; ikisi birden başarılı OLAMAZ):

| Kim | Yazım | Başarı koşulu |
|---|---|---|
| İşçi, sağlayıcıya istek atmadan HEMEN önce | `dispatchStartedAt = şimdi` | satır hâlâ bu işçinin talebinde, `sending`, ve `cancelRequestedAt` BOŞ |
| İptal isteyen | `cancelRequestedAt = şimdi`, `cancelReason = …` | satır `sending` ve `dispatchStartedAt` BOŞ |

- İşçinin yazımı 0 satır değiştirirse: ya talep kaybedildi (hiçbir şey yapmaz) ya da iptal istendi → satırı `canceled` yapar, **istek atmaz**.
- İptal isteyenin yazımı 0 satır değiştirirse: gönderim çoktan başladı → iptal EDİLEMEZ; çağırana "gönderim başladı" döner (sonuç gönderimin
  kendisinden okunur). İptal isteyen bunu "iptal edildi" sayamaz.
- `pending` / `blocked` satır bugünkü gibi doğrudan iptal edilir.

Tek giriş noktası (yeni, küçük modül `src/lib/outbox/dispatch.ts`):

- `markDispatchStarted(satır, talep) → "started" | "cancel_requested" | "lost"`
- `requestOutboxCancel(kapsam, neden) → { canceled, requested, dispatching }` — kapsamdaki her satır için yukarıdaki kuralı uygular;
  `dispatching > 0` ise çağıran bunu kullanıcıya / kayda dürüstçe yansıtır.
- `outboxPhase(satır) → queued | preparing | dispatching | uncertain | sent | failed | canceled` — arayüz ve teşhis tek sözlük kullanır.

## 3. Yan kazanç: hazırlıkta çöken satır "belirsiz" olmaz

Talep süresi dolan `sending` satır:
- `dispatchStartedAt` BOŞ → sağlayıcıya istek atılmadığı KESİN → `pending`e geri bırakılır (yeniden denenir), "belirsiz" incelemesi doğmaz;
  `cancelRequestedAt` doluysa `canceled`.
- `dispatchStartedAt` DOLU → bugünkü gibi "belirsiz" (uzlaştırma / inceleme).

Her yeni talepte `dispatchStartedAt` sıfırlanır (önceki denemenin işareti yeni denemeye taşınmaz — önceki denemenin sonucu zaten yazıldı).

## 4. Karar mesajı kuyruğa girer (kurucu: "kalıcı çözüm, kararları konuşma kuyruğuna alıp göndermeden önce yeniden doğrulamak")

Bugün karar mesajı kuyruk açıkken de doğrudan gider (11-18 gündüz) — çünkü kuyruktaki sıra onu bekletebiliyor ve işçi kararı yeniden
doğrulamıyordu. Atomik kural yerleşince:

1. Karar mesajı kuyruğa `decisionRequestId` ile yazılır (kolon hazır).
2. İşçi gönderim öncesi kontrolde kararın HÂLÂ geçerli olduğunu yeniden okur (karar kartı aynı sürümde ve "onaylandı" mı; rezervasyon iptal
   değil mi; erken girişte daire hâlâ hazır mı). Geçerli değilse satır iptal edilir, kart yeniden açılır ("Gönderilemedi").
3. Karar mesajı sıradaki yapay zekâ cevabının önüne geçer: aynı konuşmada bekleyen yapay zekâ satırı için `requestOutboxCancel` çağrılır —
   hazırlıktaysa iptal olur, gönderimi başladıysa karar mesajı onun sonucunu bekler (iki mesaj birbirini ezmez).
4. Bağlı ihtiyaç yalnız kanal kabul edince kapanır (bugünkü kural aynen).

Bu adım ayrı dilimdir (kararın yeniden doğrulanması karar çekirdeğine dokunur); önce 2–3. bölümler yerleşir.

## 5. Dilimler

| Dilim | Ne | Not |
|---|---|---|
| K1 | `dispatch.ts` (üç fonksiyon) + işçide gönderim başlangıcı işareti + iptal isteğini onurlandırma | anahtar kapalıyken etkisiz; yarış testleri (iptal ↔ başlangıç, iki yönde) |
| K2 | Talep süresi dolan satırın ayrımı (hazırlık → geri bırak, gönderim başladı → belirsiz) | "belirsiz" sayısını azaltır; eski satırlar (`dispatchStartedAt` boş, gerçekte gönderilmiş olabilir) için geçiş kuralı ↓ |
| K3 | Dış iptal yolları tek girişe: konuşma / daire silme, silme talebi, elle gönderimin satırı bırakması | bugün "sending" satır bu yollardan kaçıyor |
| K4 | Karar mesajı kuyruğa (§4) | karar çekirdeği |

**Geçiş kuralı (K2 — yazıldığı hâliyle):** bu kod yayına girmeden önce talep edilmiş bir satırın `dispatchStartedAt`'ı boştur ama isteği
atılmış olabilir. Satır kendini tanıtır: işareti YAZAN sürümün işçisi talep belirtecine bir önek koyar (`d1:`); "hazırlıkta çöktü → yeniden
dene" hükmü yalnız önekli talebe verilir. Öneksiz (eski sürümün) talepte işaretin yokluğu kanıt sayılmaz, satır eskisi gibi "belirsiz"e gider.
Kurtarma ile yavaş kalmış işçi de aynı satırda yarışır: kurtarma satırı geri bıraktıysa işçi talebini kaybeder ve isteği atamaz; işçi işareti
önce yazdıysa satır "belirsiz" yoluna gider.

## 6. Kurucuya sorular

- **KU-1:** Gönderimi başlamış bir mesaj iptal edilemediğinde (ör. konuşma silinirken mesaj tam o an gidiyordu) ev sahibine ne denir?
  Önerim: işlem tamamlanır, ekranda tek satır — "Bir mesaj gönderim sırasındaydı; misafire ulaşmış olabilir." (yeni metin).
- **KU-2:** Karar mesajı sıradaki yapay zekâ cevabının önüne geçince, iptal edilen yapay zekâ cevabı için ev sahibine ayrıca bir şey
  gösterilsin mi? Önerim: hayır (karar mesajı zaten misafire gitti; iptal edilen taslak gelen kutusunda not olarak görünmez).
