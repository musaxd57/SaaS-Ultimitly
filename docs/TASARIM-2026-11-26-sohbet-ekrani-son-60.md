# Sohbet ekranı: son 60 mesaj + "Daha eski mesajları göster" (K2-S, 2026-11-26)

Kurucu kararı (aynen, `docs/KURUCU-TALIMATI-2026-11-26-sabah-cevaplar.md`): "son 60 mesaj gözüksün üstte daha eski mesajları göster tuşu
olsun öyle yapalım hem bu hızlandırır da di mi bizi. burda doğru şekilde kur".

## Bugün ne oluyordu

`src/app/(app)/inbox/[id]/page.tsx` konuşmayı BÜTÜN mesajlarıyla okuyordu (`include: { messages: { orderBy: (createdAt, id) asc } }`) ve
`<AutoRefresh seconds={30} />` sayfayı 30 sn'de bir yeniden okutuyordu: 400 mesajlık konuşmada her yenilemede 400 satır veritabanından
okunuyor, 400 baloncuk sunucuda çiziliyor ve tarayıcıya gönderiliyordu.

## Karar

- Ekran **en yeni 60 mesajla** açılır. Daha eski mesaj varsa listenin ÜSTÜNDE **"Daha eski mesajları göster"** bağlantısı çıkar.
- Bağlantı adres parametresidir: `?eski=N` → en yeni `60 × (N + 1)` mesaj (`?eski=1` → 120). Sunucu bileşeni aynı yolla okur; 30 sn'lik
  yenileme (`router.refresh`) adresi korur → yenileme de yalnız gösterilen pencereyi okur. Yeni API rotası YOK (kiracı sınırı ve rol kapısı
  sayfanın kendi kapılarıdır: `requireManagerSession` + konuşmanın işletme koşulu).
- Bağlantı geri hedefini (`from`, yalnız kabul edilmiş biçim) korur; `replace` + `scroll={false}`: tarayıcı geçmişi her tıklamada uzamaz
  (geri = listeye dön), kaydırma yerinde kalır.
- Sıra kesin: `(createdAt, id)`. Pencere = azalan sırada `take N + 1` → ters çevrilir; fazladan satır yalnız "daha eski var" bilgisidir.
- Saf kurallar yaprak modülde: `src/lib/inbox-message-window.ts` (`parseOlderPages`, `messageWindowSize`, `windowFromNewestFirst`,
  `windowCoversTail`, `olderMessagesHref`).

### Parametre sınırı ve tavan

- Kabul: yalnız `1 … 20` arası ondalık tam sayı. Negatif, `0`, ondalık, boş, boşluklu, `1e1`, `0x2`, çöp ya da 20'den büyük → varsayılan
  (60). Yinelenen parametrede ilki (`from` ile aynı kural).
- Tavan `?eski=20` = **bütün geçmiş** (düğme kalkar). Gerekçe: tavanda pencereyi sabitlemek düğmeyi "basınca hiçbir şey olmayan" hâle
  getirirdi ve 1.260'tan eski mesaja ulaşılamazdı; bütün geçmişi okumak bugünkü davranıştır (daha kötüsü değil) ve yalnız ev sahibi 20 kez
  bastığında olur. Elle yazılan `?eski=21` ve üstü varsayılana döner (görev şartı "dev sayı → varsayılan").

## §2 envanter — `conversation.messages` kullanan her hesap

| Hesap (sayfa / yardımcı) | Tam geçmiş ister mi | Ne yapıldı |
|---|---|---|
| Ekrandaki baloncuklar (`ConversationThread.messages`, iptal edilmiş kuyruk satırı süzgeciyle) | Hayır — değişen tek şey bu | Yalnız pencere |
| `lastInboundId` (karar tutuşu notu `heldEvent`, `decisionCoversHold`) | EVET (60'tan fazla ev sahibi mesajı → son misafir mesajı pencere dışında) | Ayrı dar sorgu: `message.findFirst(direction=inbound, (createdAt,id) desc, select id)`, konuşmayla AYNI turda |
| `aiSuggestExceedsLength` (uzunluk uyarısı: cevapsız misafir mesajları + son gelen mesaj) | Sonek yeter, ama sonek pencereden uzun olabilir (60'tan fazla cevapsız mesaj) | `windowCoversTail` yetmezse pencereden eski mesajlar okunur (aşağıda) |
| `preparedDraftOf` (hazır taslak: son gerçek mesaj + son iptalsiz cevaptan sonraki misafir metinleri) | Sonek yeter; son İPTALSİZ cevap pencere dışında olabilir | Aynı mekanizma (iptal durumu hesaba katılır) |
| Karar kartı `later` ("talepten sonra misafir yazdı mı") | Yalnız son misafir mesajı | Sonek son misafir mesajını içerir (aynı mekanizma) |
| Karar kartı `request` (talep alıntısı, `messageId` ile) | EVET (talep mesajı çok eski olabilir) | Eksik olan talep mesajları kimlikle, kart bağlamıyla AYNI turda okunur (yalnız gerekirse) |
| Kuyruk durumları (`outboxByMessage`, iptal süzgeci) | Mesaj okumuyor | Okuma konuşmayla aynı tura alındı (pencere kararından önce gerekir), `organizationId` koşulu eklendi |
| `isInternalRecord`, `resolveOutboundRoute`, `isClosingHandled` | `messages` okumuyor | Değişmedi |
| İstemci: son mesaj kimliği (öneriyi silme), son misafir mesajı ("AI öner" sonucunun kaydedildiği mesaj) | Son mesaj pencerede; son misafir mesajı pencere dışında olabilir | Yeni alan `lastInboundMessageId` (sunucunun dar sorgusundan) |
| Çeviri düğmesi, söz / öğe / iç not kartları | `messages` okumuyor (kendi sorguları) | Değişmedi |

### Pencere yetmezse ne olur (`windowCoversTail`)

Geriye tarayan hesaplar ilk "sonlandırıcı" mesajda durur: son misafir mesajı ve son İPTALSİZ cevap (giden, otomatik şablon değil). Pencere
konuşmanın bir sonekidir; ikisini de içeriyorsa her tarama pencere içinde durur → sonuç bütün geçmişle aynı. İçermiyorsa (ör. 60'tan fazla
cevapsız misafir mesajı, ya da penceredeki tek cevap iptal edilmiş yapay zekâ taslağı) pencereden eski mesajlar **ana Promise.all turunda**
okunur (`(createdAt, id)` sınırıyla; eşit zaman damgalı mesaj kaybolmaz) ve hesaplar bütün geçmişle yapılır; ekrana yine yalnız pencere gelir.
Ardışık yeni tur yok (`request-path-queries` derinlik ≤ 3 değişmedi).

## Sınırlar (bilinçli)

- Pencere satır sayısıyla ölçülür; iptal edilmiş kuyruk satırları (misafire gitmemiş yapay zekâ taslağı) pencerede yer kaplar ama
  gösterilmez → ekranda 60'tan az baloncuk görünebilir. Uç durum: en yeni 60 satırın HEPSİ iptal edilmiş taslaksa liste boş görünür (düğme
  vardır). Pratikte oluşmaz; hesaplar etkilenmez.
- Sayfa başına iki yeni küçük okuma: son misafir mesajının kimliği (her açılışta) ve talep mesajı (yalnız karar kartı varken ve mesaj pencere
  dışındaysa). Pencereden eski okuma yalnız pencere yetmediğinde (bugünkü maliyet).
- Yeni mesaj gelince pencere kayar (her zaman en yeni 60 × (N+1)); kaydırma konumu tarayıcıda korunur.

## Yapılmayanlar

- Kurucunun ilk fikri (ilk 50 hemen, gerisi arkada yüklensin): kurucu kendi ikinci yolunu seçti; yapılmadı.
- Sonsuz kaydırma / otomatik yükleme, mesaj sayacı ("150 mesajdan 60'ı"), yeni API rotası, şema / migration / ortam anahtarı: yok.
- Yapay zekâ tarafının geçmiş penceresi (`channel-thread-window`), "AI öner" rotası, misafire giden hiçbir şey: değişmedi.

## Testler

- `tests/integration/inbox-message-window-page.test.ts` — (a) 150 mesajda son 60 + bağlantı; mesaj tablosuna giden her okuma `LIMIT`li
  (b) `?eski=1` → 120, `from` korunur; tavan bütün geçmiş; geçersiz değerler varsayılan (c) ≤ 60 ve 61 (d) eşit zaman damgası, pencere sınırı
  eşitlik grubunun ortasında (e) uzunluk uyarısı (eşitlik sınırında), karar tutuşu notu, hazır taslak (iptal edilmiş cevapla), karar kartı —
  ilgili mesaj pencere dışındayken bütün geçmişle aynı (f) başka işletme 404.
- `tests/unit/inbox-message-window.test.ts` — saf kurallar. `tests/ui/thread-older-messages.test.tsx` — bağlantı konumu, `lastInboundMessageId`.
- Kırmızı-önce: eski kodda yeni sayfa testlerinden 9'u kırmızı ((a), (b), (c) 61, (d), (e) uzunluk / tutuşu / kart'taki pencere iddiaları);
  "davranış aynı" iddiaları eski kodda yeşil (beklenen — eski kod bütün geçmişi okuyordu) ve pencere-yalnız hesaplamanın FARKLI sonuç
  verdiğini aynı testte gösterir (anti-vakumluk).

## Kurucuya soru

Yok (kurucu davranışı açıkça seçti). Bilgi: tavanda (20. tıklama) bütün geçmiş gösterilir — farklı isterseniz söyleyin.
