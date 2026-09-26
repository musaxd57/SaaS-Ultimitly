# Conversation dedupe — DRY-RUN aracı (Faz B)

> ## ✅ KAPANDI — 2026-07-26. Dry-run koştu, apply uygulandı, migration 45 canlı.
> 7 grup birleşti · 7 loser silindi · 29 tam-eşit duplicate düştü · benzersiz/NULL
> mesaj kaybı 0 · Conversation 1335→1328, Message 17465→17436.
>
> ⚠️ **§4'teki alan politikası tablosu SÜPERSEDE EDİLDİ** (`6ad385b`). Orada
> yazan `status_rank` / `max_wins` / `min_wins` **artık kullanılmıyor**: apply
> **identity-only** çalışır (yalnız `reservationId`/`externalConversationId`, o da
> keeper NULL'ken) ve dokuz canlı-durum alanının HERHANGİ birinde fark varsa grup
> `live_state_conflict` ile fail-closed olur — rank/tahmin YOK. Sebep: eski rank
> `closed`+`new`'i `new` yapıp AI'yı host'un kapattığı thread'de yeniden
> silahlandırabiliyordu. Tablo tasarım anındaki hâliyle, TARİHSEL KAYIT olarak
> duruyor; yürürlükteki sözleşme `scripts/dryrun-conversation-dedupe.ts`
> içindeki `CONVERSATION_FIELD_POLICY`'dir.

## Codex şartları — nasıl karşılandı

| Şart | Karşılık |
|---|---|
| **#1** P2002 retry yalnız beklenen Conversation bileşik kısıtı için | `isUniqueViolation(err, ["propertyId","externalReservationId"])` (set eşitliği) — Message hedefli P2002 eşleşmez. **Davranışsal negatif regresyon testi** `tests/integration/sync-p2002-retry-scope.test.ts`: Message kısıtı → importThread **1 kez** çağrılır (retry yok); Conversation kısıtı → **tam 2 kez** (bir retry). |
| **#2** "Hiçbir mesaj silinmez" netleştirildi | Aşağıda §5 — invariant artık **"hiçbir BENZERSİZ mesaj/olay kaybolmaz"**. |
| **#3** Alan envanteri + her alana açık politika | §4 ve §5 — `Record<keyof Prisma.ConversationScalarFieldEnum, …>` ile **derleme zamanı eksiksiz**, ayrıca `assertPolicyCoverage()` ile runtime fail-closed. |
| **#4** Yalnız sayı raporla | §6 — çıktı listesi; rapor uzunluğunun veri hacminden bağımsız olduğu testle pinli. |
| **#5** Dry-run zorunlu read-only, apply bu turda yok | `SET TRANSACTION READ ONLY` + `REPEATABLE READ` + 3 zaman aşımı; dosyada tek bir UPDATE/DELETE/INSERT yok. |

## 0. Neden şimdi güvenli bir zemin var

`3effd99` (Faz A) ile `importThread` artık NS-43 rezervasyon-kimlik advisory
kilidi altında çalışıyor. Sonuç, dedupe tasarımını doğrudan etkiliyor:

**Çakışan grup popülasyonu artık KAPALI bir küme.** Yeni çift satır üretilemez,
dolayısıyla dry-run'ın ölçtüğü tablo ile apply'ın göreceği tablo arasında
"yeni çakışma belirdi" riski yok. Kalan tek risk mevcut satırların
değişmesi (yeni mesaj gelmesi) — bunu apply adımı kilit altında yeniden
doğrulayarak karşılar.

## 1. Prod'un ölçülmüş gerçeği (2026-07-26 preflight, çıkış kodu 10)

| Ölçüm | Değer |
|---|---|
| Toplam Conversation | 1335 |
| Çakışan Hospitable grubu | 7 |
| Grup büyüklüğü | hepsi **tam 2 satır** (3+ yok) |
| `externalConversationId` | 7 grubun **tamamında AYNI** |
| Çelişkili / karışık / kanıtsız grup | **0 / 0 / 0** |
| Etkilenen Conversation | 14 |
| Gruplardaki mesaj satırı | 58 — 29 tam-eşit duplicate düşer, 29 canonical kalır |
| MessageOutbox / RiskEvent / ShadowVerdict | **0 / 0 / 0** |
| QR / manuel çakışması | 0 |

Yorum: 7 grubun tamamı **bizim yarış artığımız** — sağlayıcı tek thread
verdiği hâlde iki satır açılmış. Otomatik birleştirme için gereken kanıt
gücü en yüksek kova bu.

## 2. Değişmez kurallar (aracın sözleşmesi)

1. **DRY-RUN tek mod.** Bu turda apply yolu YAZILMADI; araçta yazma yeteneği yok.
2. **Hiçbir BENZERSİZ mesaj/olay kaybolmaz** (↓§5 — eski "hiçbir satır silinmez"
   ifadesi hem yanlış hem mekanik olarak imkânsızdı).
3. **`externalConversationId` çelişkisi = o grup için FAIL-CLOSED.** Grup
   raporlanır, plan üretilmez, apply o gruba dokunmaz. (Bugün 0, ama araç
   ölçtüğü ana göre davranır, geçmiş rapora güvenmez.)
4. **Çıktı yalnız kategori + sayı.** Misafir adı, mesaj gövdesi, rezervasyon
   kimliği, konuşma id'si, URL, kimlikten türetilmiş etiket **basılmaz** —
   preflight ile aynı disiplin, aynı test (rapor satır sayısı veri hacminden
   bağımsız + tüm dönüş değerinde kimlik taraması).
5. **Salt-okuma aşaması** preflight'ın kapılarını aynen kullanır: `READ ONLY`
   + `REPEATABLE READ` + `statement/lock/idle-tx timeout` + primary onayı.

## 3. Keeper seçimi — deterministik, beraberlik imkânsız

Sıralama ölçütleri, ilk ayrımda karar (hepsi tek sorguda, `ORDER BY`):

| # | Ölçüt | Yön | Gerekçe |
|---|---|---|---|
| 1 | `reservationId IS NOT NULL` | önce | Konaklama bağı olan satır bağlamı taşır; NULL olan onu geri getiremez |
| 2 | mesaj sayısı | çok olan | Taşınacak satır sayısını azaltır |
| 3 | `createdAt` | eski olan | Tarihsel olarak "asıl" thread |
| 4 | `id` | küçük olan | Son çare — beraberliği yapısal olarak imkânsız kılar |

4. ölçüt sayesinde iki farklı koşu **aynı keeper'ı** seçer; plan tekrar
üretilebilir ve karşılaştırılabilir.

## 4. Conversation alan envanteri — EKSİKSİZ, derleme zamanı zorlanan

`CONVERSATION_FIELD_POLICY: Record<keyof typeof Prisma.ConversationScalarFieldEnum, …>`
→ şemaya yeni bir kolon eklenirse **dosya derlenmez**; politika seçmeden
ilerlemek imkânsızdır. Ayrıca `assertPolicyCoverage()` runtime'da da
şema ↔ harita eşitliğini doğrular ve sapmada dry-run'ı **durdurur**.
18 scalar alanın tamamı:

| Kolon | Politika | Neden |
|---|---|---|
| `id` | `row_identity` | Kaybeden satır kalkar; birleşecek şey yok |
| `propertyId`, `externalReservationId` | `identity_key` | Tanım gereği eşit; farklıysa gruplama bozuk → fail |
| `status` | `status_rank` | **problem > new > waiting > answered > closed.** "Sorunlu" düşerse şikâyet gizlenir. `closed → answered` yönü bilinçli taviz: **görünürlüğü artıran** yön güvenlidir |
| `autoReplyHoldUntil` | `max_wins` | İnsana devir penceresi KISALMAMALI |
| `lastMessageAt` | `max_wins` | Gelen kutusu sıralaması (sessizce unutulmadı) |
| `autoReplyAttemptedAt` | `max_wins` | En yeni damga doğru bilgi |
| `syncCursorAt` | `min_wins` | İhtiyatlı: ileri alınırsa import ATLANIR = mesaj kaybı |
| `createdAt` | `min_wins` | Thread'in gerçek doğuşu |
| `reservationId` | `single_non_null` | İki FARKLI yerel konaklama → **fail-closed** |
| `externalConversationId` | `single_non_null` | İki FARKLI sağlayıcı thread'i → **fail-closed** |
| `guestIdentifier` | `anon_guard` | KVKK sentinel'ine gerçek ad geri yazılmaz |
| `channel`, `priority`, `skippedReason`, `lastRiskLevel`, `lastRiskType` | `keeper_wins` | Görüntüleme/analitik; risk bayrağı `status`'te korunuyor. **Fark olursa SAYILIR** (`keeper_wins_differences`) — sessiz geçmez |
| `updatedAt` | `system_managed` | Prisma yönetir |

## 5. Mesaj sınıflandırması — invariant DÜZELTİLDİ

**"Hiçbir mesaj satırı silinmez" YANLIŞTI ve mekanik olarak İMKÂNSIZ.**
`Message @@unique([conversationId, externalId])` yüzünden keeper'da zaten var
olan bir `externalId`'yi taşımak kısıtı ihlal eder; kaybeden satırı yerinde
bırakmak da mümkün değildir (kaybeden konuşma silinince cascade götürür).
Doğru invariant: **hiçbir BENZERSİZ mesaj/olay kaybolmaz.**

| Sınıf | Tanım | Plan |
|---|---|---|
| **benzersiz** | `externalId` keeper'da YOK | `UPDATE conversationId` — taşınır |
| **tam eşit kopya** | `externalId` aynı **ve TÜM anlamlı alanlar eşit** | Tek canonical (keeper'ınki) kalır; fazlalık kopya düşer. Kaybolan **olay yok** |
| **çelişkili** | `externalId` aynı, **herhangi bir anlamlı alan farklı** | **FAIL-CLOSED** — grup hiç planlanmaz |
| **anahtarsız** | `externalId IS NULL` | Güvenle eşleştirilemez → **tamamı taşınır, asla düşürülmez** (gövdeleri aynı olsa bile) |

"Anlamlı alan" = `MESSAGE_FIELD_POLICY`'de `strict` olan HER ŞEY (15 scalar'ın
13'ü): `externalId`, `direction`, `senderName`, `body`, `language`,
`createdAt` (sağlayıcı zamanı), `authorType`, `systemEventType` ve **AI
işaretlerinin tamamı** (`aiAssisted`, `aiIntent`, `aiConfidence`,
`aiSourcesJson`, `aiSuggestedReply`). `aiAssisted` özellikle kritik: raporlar
AI-kredisini `Message.aiAssisted` üzerinden sayar, yanlış kopyayı seçmek
faturaya komşu bir sayıyı sessizce kaydırırdı.

⚠️ **Gerçekçi fail-closed beklentisi:** `senderName` thread bazında çözülür
(`senderFullName(m) ?? guestName`), yani ad henüz çözülmemişken import edilen
kopyada "Misafir" yazıyor olabilir; `createdAt` de sağlayıcı zamanı
ayrıştırılamazsa yerel `now()`'a düşer. Bu iki alan 7 grubun bir kısmını
fail-closed'a itebilir. **Bu bir arıza değil, tasarımın çalıştığının
kanıtıdır** — dry-run sayıyı gösterecek, kararı veriyle vereceğiz.

## 6. FK'sız tablolar

`MessageOutbox` / `RiskEvent` / `ShadowVerdict` üzerinde `conversationId`'nin
FK'si **yok** → kaybeden satır silinirse dangling kalır. Plan bunları
keeper'a **repoint** eder (`updateMany`). Prod'da bugün üçü de **0**, ama
araç sayıyı ölçer ve sıfır olmayan durumda repoint'i plana yazar —
"bugün sıfır" bir kod garantisi değildir.

## 6b. Dry-run çıktısı — yalnız sayılar

Rapor **hiçbir** ham id, ad, gövde, URL veya hash etiketi basmaz; uzunluğu
veri hacminden bağımsızdır (testle pinli). Basılanlar:

- grup: çakışan / planlanan / **fail-closed** (+ 4 ayrı sebep sayacı) /
  `keeper_wins` farkı olan grup / tavan aşıldı mı
- konuşma: etkilenen / keeper / kaybeden (planlanan gruplarda)
- mesaj: çakışan gruplardaki toplam / taşınacak **benzersiz** / taşınacak
  `externalId` **NULL** / **tam eşit duplicate** / **çelişkili** (grubu
  fail-closed yapan)
- ilişkili modeller: `MessageOutbox`, `RiskEvent`, `ShadowVerdict` referansı
- **birleşme öncesi → beklenen sonrası**: Conversation ve Message toplamları

Çıkış kodu: `0` temiz · `10` planlanacak grup var · `20` en az bir
fail-closed grup var · `1` hata.

## 7. Apply aşaması — bu sıra AYNEN uygulandı (2026-07-26)

Sıra, atlanmaz:

1. **Taze `pg_dump`** (preflight yedeği yeterli değil; arada Faz A deploy oldu).
2. Grup başına **tek transaction**, **NS-43 kimlik kilidi altında** — Faz A'nın
   kilidini yeniden kullanır, böylece birleştirme sürerken eşzamanlı bir sync
   üçüncü satırı açamaz.
3. Kilit içinde **planı yeniden doğrula** (keeper/mesaj sayıları hâlâ aynı mı).
   Sapma → o grup atlanır, rapor edilir. (Billing'deki "apply'dan önce yeniden
   preview" deseninin aynısı.)
4. Taşı → repoint → kolon birleştir → boşalan kaybeden satırı sil.
5. **Son-koşul iddiası**: anahtar başına tam 1 satır ve mesaj sayısı beklenen
   birleşim değerine eşit; değilse transaction **rollback**.
6. Ancak bundan sonra unique migration; ardından iki paralel sync testi.

## 8. Bu tasarımın kapsamadıkları (bilinçli)

- `cleanupDuplicateConversations` **değiştirilmez**. O ayrı bir araç ve
  unique ile **aynı kural değildir** — kesişirler, hiçbiri diğerini kapsamaz.
- `NULLS NOT DISTINCT` kullanılmaz; manuel satırların `NULL`'ları serbest kalır.
- Farklı `externalConversationId` taşıyan hiçbir grup otomatik birleştirilmez.
