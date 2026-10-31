# Madde 10 — kanal oto-yanıtında sınırlı konuşma okuması (UYGULANDI 10-12, kurucu "Şimdi yap")

> Kurucu talimatı 2026-09-07, bağlam sözleşmesi madde 10 ("yalnız gereken satırlar, sınırlı sorgu"). Durum çizelgesi:
> `docs/YOL-PLANI-DURUM-2026-10-09.md` "Ortak bağlam kurucu" satırı. Aşağıdaki envanter (Haiku taraması, kodla teyitli) uygulamanın
> dayanağıdır; "Uygulama" bölümü ne yapıldığını ve nasıl kanıtlandığını söyler.

## Uygulama (10-12)

- `src/lib/channel-thread-window.ts`: konuşma sondan, `(conversationId, createdAt)` indeksiyle 200'lük sayfalarla okunur (keyset; eşit
  damgada kimlik kopma noktası). Süzgeçler (teslim edilmemiş taslak, sondaki otomatik şablon) aynı sırayla uygulanır; kesit
  `threadWindowSufficient` sağlanana kadar geriye genişler — koşulların her biri ↓ "Tüketiciler"deki bir geriye bakışı kapsar.
  Konuşma ilk sayfaya sığıyorsa dizi bugünküyle birebir aynıdır. Mesajlar artık erken çıkışlardan (saat dışı, kapalı, devir bekletmesi,
  bitmiş konaklama) SONRA okunur — o durumlarda hiç okunmaz.
- Konuşma kayıtları (`AI_CONVERSATION_STATE_ENABLED`) ya da üretim izi (`AI_GENERATION_TRACE_ENABLED`) açıkken de sınırlı (10-12 ikinci
  tur): kayıtların kendi kesit koşulu (son 10 misafir mesajı + kayıtların cevap kuralıyla bir cevap — sistem olayı işaretli satır kapanış
  kuralında cevap, kayıtlarda değil) ve kesit ÖNCESİ toplamlar veritabanında SAYILIR, satır okunmaz: cevap toplamı ham SQL
  (`conversationStatePriorTotals`, `replyAuthor` kuralının birebir karşılığı — boş dize yazar / sistem olayı, JS `trim()` boşluk kümesi),
  iz tanısının "atlanan" sayısı ORM sayımı. SQL ↔ JS eşitliği 600 rastgele satırda HER sınırda özellik testiyle sabit
  (`conversation-state-prior-totals.test.ts`). 🚨 Haiku'nun yakaladığı hata: sınır ilk sürümde ham SQL'e TARİH PARAMETRESİ olarak
  bağlanıyordu → veritabanı oturum saat dilimi UTC+14'te sayım 2 yerine 56 (ölçüldü, kırmızı). Düzeltme: sınır kesitin en eski satırının
  kendisinden okunur (alt sorgu) — saat diliminden bağımsız; test oturumu UTC+14'e alıp koşar.
- Kalıcı outbox süzgecinin konuşma çapındaki tetikleyicisi okunmayan kısımda tek bir varlık sorgusuyla aranır.
- **Kanıt (kâhin, `tests/integration/channel-thread-window-oracle.test.ts`):** tohumlu rastgele konuşmalar (misafir / ev sahibi / yapay
  zekâ / otomatik şablon / eski ad kuralı / sistem olayı / boş gövde / eşit damga / sonda şablon) aynı kimliklerle yeniden kurulur, önce
  tam okumayla sonra 1–2–3–7 satırlık sayfalarla koşar; cevap modeli GERÇEK (`suggestReply` istemi kendisi kurar), karşılaştırılan:
  modele giden istem metni + anlama / bekçi istekleri, gönderim, sonuç, karar kayıtları, konuşma satırı, outbox, üretim izi. Varsayılan
  bayraklar, anlama + bekçi, kalıcı outbox, konuşma kayıtları + iz. Mutasyon (kâhin üzerinde, `scripts/mutation-run.mjs`): ilk tur
  7/15 — rastgele konuşmalarda 25 satırlık pencere neredeyse her zaman yetiyordu, yeterlilik koşulları bağlayıcı olmuyordu. Düzeltme: bekçi
  koşulu anlama koşuluna katıldı (aynı sabit, son dolu cevap ≤ son cevap → kapsanıyordu; artık ikisinin büyüğü tek koşul) + koşul
  başına HEDEFLİ senaryo (boş gövdeli ev sahibi mesajı, 200+ cevapsız mesaj + dolu sistem satırı, ilk cevaptan önce misafir mesajı
  olmayan kesit, ev sahibine bırakılmış eski talep). İkinci tur **12/13**; yaşayan tek mutant "en az 2 misafir mesajı" — EŞDEĞER
  (gerekçe kodda: bir üstteki koşul + son satırın misafir olması bugün bunu sağlar; sabit büyürse bağlayıcı olur). Bayraklı mod (kayıtlar /
  iz): ilk tur 12/15 (kayıt kesit koşulları + sınırın kendisi bağlayıcı değildi) → iki hedefli senaryo + her sınırı tarayan özellik testi →
  **15/15**.
- **Ölçüm (yerel PostgreSQL, 7 tekrarın ortancası, cevap modeli sahte):** 200 mesajlık konuşmada tur 12,3 ms → 12,6 ms (aynı);
  2.000 mesajlık konuşmada tur 65,6 ms → 11,3 ms; yalnız okuma 67,1 ms → 7,9 ms.
- **Bilinçli tek fark (sahiplenme):** model çalışırken gelen YENİ misafir mesajı (C2) iki yolda da cevabı durdurur (testli). Kesit
  konuşmanın tamamı değilken, kesitin en eski satırından DAHA ESKİ damgalı bir misafir mesajı o sırada senkronla eklenirse "görülmemiş"
  sayılmaz ve cevap gider; bugünkü kod turu bir kez erteleyip yeniden modellerdi. O satır hiçbir tüketicinin penceresine girmez (kesit her
  geriye bakışı kapsar) → yeniden modellenen turun girdisi aynı olurdu; fark yalnız fazladan bir model çağrısıdır (Haiku 10-12 de aynı
  sonuca vardı).

## Diğer yüzeyler (10-12 gece)

- **Gelen kutusu "AI cevap öner"** (`api/conversations/[id]/ai-suggest`): aynı sınırlı okuyucu (kanalın yeterlilik koşulu + konuşma
  kayıtları koşulu; bu yüzeyde süzgeç yok, son satır giden olabilir — "en az 2 misafir mesajı" koşulu burada bağlayıcı, son GELEN mesajı
  kesite alır). Sıra artık `(createdAt, id)` (eskiden yalnız `createdAt`; eşit damgada PostgreSQL sırası rastgeleydi). Aynı turda **K7
  bağlantısı** bu yüzeyde de: getirme / anlama geçmişi yazar etiketi taşır (otomatik şablon mesajı cevapsız pencereyi sıfırlamaz — kanal
  düzeltmesinin eşi). Kâhin: `ai-suggest-thread-window-oracle.test.ts` (taslak + modele giden istekler + kaydedilen öneri birebir).
- **QR konuşma kayıtları** (`loadConversationStateForConversation`): eskiden son 200 satır okunup toplamlar YALNIZ o pencereden sayılıyordu
  (Haiku 10-12: uzun QR konuşmasında "misafire giden mesaj" eksik). Artık kiracı kontrolü → sınırlı okuyucu (kayıtların koşulu) → kesit
  öncesi sayım. Kâhin: `conversation-state-qr-window.test.ts` (bütün satırlarla kurulan özetle birebir; eski pencerenin eksik saydığı ayrıca
  sabit).

## Envanter (uygulama öncesi hâl)

`applyChannelAutoReply` (`src/lib/automation.ts` ~1594) konuşmayı `include.messages` ile **tavansız** okur (bütün kolonlar, eski → yeni).
Dizi sonra iki kez kırpılır: teslim edilmemiş giden taslaklar (~1733) ve sondaki otomatik mesajlar (~1744). Uzun konuşmada her turda
yüzlerce satır belleğe gelir.

## Tüketiciler

**Yalnız SONU okuyanlar** (son N satırla birebir aynı sonuç): son mesaj / boş mu · uzun mesaj kuralı (`ai/message-length.ts`) · son giden
indeksi + cevapsız misafir metinleri · kapanış kısayolu · döngü bekçisi (son giden) · nezaket kapanışı (`maybeSendClosingCourtesy`) · öğe turu
kimlikleri · bekleyen misafir mesajları / karar turu / dil sinyali · istem penceresi (`selectHistoryForPrompt`, 25 satır + karakter bütçesi)
· kapı geçmişi (aynı pencere) · konaklama bekçisi geçmişi · getirme alt sorguları (`pendingGuestMessages`) · anlama penceresi
(`understandingWindow`, cevapsız + son N bağlam).

**Konuşmanın TAMAMINA bakanlar** (sınırlı okumada sorgu ya da sayaç ister):

| Tüketici | Neye bakıyor | Sınırlı okumada karşılığı (öneri) |
|---|---|---|
| `closableAfter` (`ai/closing-turn.ts`) | ilk misafir mesajından sonra hiç cevap var mı | `countPriorOperatorReplies` benzeri indeksli varlık sorgusu |
| `closingMayHide` + `hasOpenHostWork` (`conversation-attention.ts`) | son ev sahibi cevabının indeksi, ardından misafir kimlikleri | son cevaplayan giden satırın zamanı (tek sorgu) + o andan sonraki satırlar |
| `verifyNonKbSource` "history" (`ai/index.ts`) | konuşmada hiç giden mesaj var mı | varlık sorgusu |
| konuşma kayıtları toplamları (`conversation-state.ts`, bayrak `AI_CONVERSATION_STATE_ENABLED`) | misafire giden mesaj SAYISI | sayım sorgusu |
| bayat cevap koruması `seenInboundIds` (~3356) | okunan BÜTÜN gelen kimlikleri `notIn` listesi | okunan en yeni gelen mesajın (zaman, kimlik) filigranı — liste sınırsız büyümez |
| bağlam tanısı `omittedCount` (yalnız iz açıkken) | dizi uzunluğu | sayım (ya da "okunan satır içinde" diye belgelenir) |

## Plan önerisi (uygulama öncesi; yukarıdaki "Uygulama" bölümü ondan farklıysa o geçerli)

1. Tüketicileri tek tek sorguya çevirmek yerine okuma = **son N satır (ör. 200) + yukarıdaki dört varlık / sayım sorgusu + filigran**.
2. Eşdeğerlik testi: mevcut entegrasyon testleri + rastgele uzun konuşmalarda eski / yeni yolun karar, istem ve kapı girdisinin birebir aynı
   olduğu kâhin testi (N'yi aşan konuşmalar dahil).
3. Ölçüm: yerel PG'de 2.000 mesajlık konuşmada tur süresi önce / sonra.

## Aynı taramada çıkan, ayrıca işlenenler

- **Düzeltildi (10-12, K7 bağlantısı):** getirme ve anlama girdisi yazar etiketi taşımıyordu → otomatik şablon mesajı orada "cevap" sayılıyordu
  (kapı saymıyordu). `tests/integration/automation-message-pending-wiring.test.ts`.
- **Bilinçli, değişmedi:** enjeksiyon taraması yalnız istem penceresine bakar — modelin GÖRDÜĞÜ dizi ile kapının taradığı dizi aynı olmalı
  (09-12 kuralı); pencere dışı metin modele gitmez.
- **Ölçüldü, değişmedi (kurucu 10-12 "Sessiz kalsın"):** döngü bekçisi (~1833) "son giden"i yönle bulur (otomatik mesaj dahil), ama
  nezaketi gönderen `maybeSendClosingCourtesy`'nin kendi bekçisi (K7) şablonu atlar → nezaket → otomatik şablon → "teşekkürler" dizisinde
  ikinci nezaket GİTMEZ (`closing_ack`). İlk taramadaki "yeniden gidebilir" tahmini yanlıştı; karar `auto-reply-channel.test.ts`'te pinli.
