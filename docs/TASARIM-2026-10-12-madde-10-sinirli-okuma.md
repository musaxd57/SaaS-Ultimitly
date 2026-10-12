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
- Konuşma kayıtları (`AI_CONVERSATION_STATE_ENABLED`) ya da üretim izi (`AI_GENERATION_TRACE_ENABLED`) açıksa toplamlar ("misafire giden
  cevap: N", atlanan satır) konuşmanın tamamından sayılır → başa kadar okunur (iki anahtar da canlıda kapalı; açılırken sayım sorgusu
  ayrı bir tur).
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
  (gerekçe kodda: bir üstteki koşul + son satırın misafir olması bugün bunu sağlar; sabit büyürse bağlayıcı olur).
- **Ölçüm (yerel PostgreSQL, 7 tekrarın ortancası, cevap modeli sahte):** 200 mesajlık konuşmada tur 12,3 ms → 12,6 ms (aynı);
  2.000 mesajlık konuşmada tur 65,6 ms → 11,3 ms; yalnız okuma 67,1 ms → 7,9 ms.
- **Bilinçli tek fark (sahiplenme):** model çalışırken gelen YENİ misafir mesajı (C2) iki yolda da cevabı durdurur (testli). Kesit
  konuşmanın tamamı değilken, kesitin en eski satırından DAHA ESKİ damgalı bir misafir mesajı o sırada senkronla eklenirse "görülmemiş"
  sayılmaz ve cevap gider; bugünkü kod turu bir kez erteleyip yeniden modellerdi. O satır hiçbir tüketicinin penceresine girmez (kesit her
  geriye bakışı kapsar) → yeniden modellenen turun girdisi aynı olurdu; fark yalnız fazladan bir model çağrısıdır (Haiku 10-12 de aynı
  sonuca vardı).

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
