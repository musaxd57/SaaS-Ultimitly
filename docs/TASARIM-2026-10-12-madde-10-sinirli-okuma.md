# Madde 10 — kanal oto-yanıtında sınırlı konuşma okuması (envanter + plan, UYGULANMADI)

> Kurucu talimatı 2026-09-07, bağlam sözleşmesi madde 10 ("yalnız gereken satırlar, sınırlı sorgu"). Durum çizelgesinde açık iş:
> `docs/YOL-PLANI-DURUM-2026-10-09.md` "Ortak bağlam kurucu" satırı. Bu not 10-12 envanteridir (Haiku taraması, satırlar kodla teyit
> edildi). Sıcak yol olduğu için uygulama ayrı, ölçülü bir turdur; misafire giden cevap DEĞİŞMEMELİ (eşdeğerlik testi şart).

## Bugün

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

## Plan önerisi (karar değil)

1. Tüketicileri tek tek sorguya çevirmek yerine okuma = **son N satır (ör. 200) + yukarıdaki dört varlık / sayım sorgusu + filigran**.
2. Eşdeğerlik testi: mevcut entegrasyon testleri + rastgele uzun konuşmalarda eski / yeni yolun karar, istem ve kapı girdisinin birebir aynı
   olduğu kâhin testi (N'yi aşan konuşmalar dahil).
3. Ölçüm: yerel PG'de 2.000 mesajlık konuşmada tur süresi önce / sonra.

## Aynı taramada çıkan, ayrıca işlenenler

- **Düzeltildi (10-12, K7 bağlantısı):** getirme ve anlama girdisi yazar etiketi taşımıyordu → otomatik şablon mesajı orada "cevap" sayılıyordu
  (kapı saymıyordu). `tests/integration/automation-message-pending-wiring.test.ts`.
- **Bilinçli, değişmedi:** enjeksiyon taraması yalnız istem penceresine bakar — modelin GÖRDÜĞÜ dizi ile kapının taradığı dizi aynı olmalı
  (09-12 kuralı); pencere dışı metin modele gitmez.
- **Açık soru, değişmedi:** döngü bekçisi (~1833) "son giden"i yönle bulur (otomatik mesaj dahil). Nezaket cevabı → otomatik şablon →
  "teşekkürler" dizisinde son giden şablondur, bekçi devreye girmez; nezaket kapanışı (ev sahibinin açtığı seçenek) yeniden gidebilir.
  Kenar durum, ölçülmedi; misafire giden metni değiştirdiği için düzeltme kurucu kararı ister.
