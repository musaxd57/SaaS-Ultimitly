# TASARIM — Konuşma kontrolü (kim cevaplar · neyin engeli var · hangi ihtiyaç açık) — ENVANTER (11-04)

> Kurucu istekleri ve hedef akış: `docs/KURUCU-2026-11-04-konusma-kontrolu-ve-model-kararlari.md` §2–§3. Bu dosya önce BUGÜNKÜ kodu
> envanterler (kod satır referanslı, ajan taraması + doğrulanacak), sonra tasarım + karar soruları eklenecek. Kod bu belge onaylanınca.

## 0. Envanter özeti (bugün)

Terminoloji notu: kodda "escalated" diye bir durum yok. Durum DB'de `"problem"`, panelde "Sorunlu". Yükseltme izi ayrıca `skippedReason` (`escalated_to_human`, `complaint`, `hazard_unverified`), `priority:"urgent"` ve `ai*` triyaj alanlarında tutuluyor.

## 1. Durum değerleri, set ve clear

**Tanım**
- `prisma/schema.prisma:590`: `status String @default("new") // new | waiting | answered | problem | closed`. Kolon düz TEXT, enum değil.
- `src/lib/constants.ts:83-92`: seçilebilenler new "Yeni", answered "Cevaplandı", problem "Sorunlu", closed "Tamamlandı". `waiting` seçenekten kaldırıldı ama eski satırlarda duruyor (`LEGACY_CONVERSATION_STATUSES`, constants.ts:92).

**problem'e SET eden otomatik yollar**
- Model yolu: `src/lib/automation.ts:3664-3666`, `applyChannelAutoReply`. `updateMany where status≠problem` ile `status:"problem"`, `priority:"urgent"`, `skippedReason:"escalated_to_human"` yazılır, `buildTriageData(source:"model")` eklenir. Koşul `modelSensitive` (`modelFlagged || nluSensitive`, :3649-3650). Ardından acil e-posta/WhatsApp gider (:3693-3770).
- Kelime yolu: `automation.ts:6287` (`sendDueAlerts`, `new→problem`, `skippedReason:"complaint"`, source `keyword`). Scheduled-sync her turda önce bunu çağırır (`src/lib/scheduled-sync.ts:626`).
- `applyInboundMessageRules`: `automation.ts:1706`, koşulsuz `update` ile `problem` + `urgent`, ayrıca koşullu triyaj `updateMany` (:1723-1735). Tek çağıran elle konuşma açan `src/app/api/conversations/route.ts:77`. Kanal sync yolundan çağrılmıyor.
- Olası tehlike + anlama katmanı koşmadı: `src/lib/hazard-unverified-alert.ts:54-58` (`escalateUnverifiedHazard`). `skippedReason:"hazard_unverified"`, `lastRiskType:"safety_emergency"`. Çağıran `escalateHazard`, `automation.ts:2126`, iki yerde: :3491 (öğe kipi) ve :3660.
- QR sohbet durum yükseltmez. Bkz. bölüm 3.

**problem'den CLEAR eden yollar**
- Host elle yanıt, satır içi: `src/lib/host-send.ts:142` ve :178, `→"answered"`.
- Host elle yanıt, kuyruklu: `src/lib/outbox/worker.ts:445-470` (`markConversationDelivered`, `→"answered"`). Host yanıtı problem'i kapatır. AI satırı problem'i ezmez (:463).
- Host panel PATCH: `src/app/api/conversations/[id]/route.ts:22`, `conversationUpdateSchema` (`validators.ts:202`). UI ipucu `conversation-thread.tsx:668-674`.
- Otomatik geri alma: `automation.ts:6379`, `sendDueAlerts` e-posta başarısız olursa `problem→new` yapar.
- Yeniden açma: `automation.ts:1827`, `applyInboundMessageRules`, `closed/answered→new`.
- Sync: `src/lib/ingest/write-service.ts:406` ve :449-463. `computedStatus` = son mesaj inbound ise "new", değilse "answered". `problem/closed/waiting` korunur, yani sync problem'i kaldırmaz.

**Diğer answered yazanlar**
- `automation.ts:1136`, `:4097` (claim `status∈{new,waiting}`), `:4227`.
- `outbox/worker.ts:1620` (iyileştirici, yalnız new/waiting).
- `src/lib/guest-chat.ts:269` (QR konuşması hep "answered" doğar).

## 2. Sorunlu'da AI auto-reply engeli

- Kanal: `automation.ts:1987`, `if (conversation.status === "problem") return {skippedReason:"complaint"}` (`applyChannelAutoReply`, :1923). Ek olarak claim `status∈{new,waiting}` olduğu için problem satırı claim edilemez (:4097; kapanış nezaketi :1136).
- Aday seçimi: `dueAutoReplyWhere`, `automation.ts:4703`, `status: new + waiting`.
- Outbox worker: `replyVeto`, `worker.ts:521`, AI satırı için `problem/closed` ise `"escalated_or_closed"`. Manuel host satırı veto edilmez. `holding_ack` durum kontrolünden muaf (:513). Teslim sonrası AI problem'i `answered` yapamaz (:463).
- QR rotası: durum kontrolü yok (bölüm 3-4).

## 3. Host yanıtı

**Kanal**
- `src/app/api/conversations/[id]/reply/route.ts` çağırır `sendHostMessage` (`host-send.ts:57`). Aynı çekirdeği `decisions/decide.ts` ve `host-channel/answer.ts` da kullanır.
- Önce kanala teslim, sonra Message + `status:"answered"` aynı TX'te (:131-143).
- Outbox bayrağı açıksa (`durableOutboxEnabledFor`, :75) niyet + mesaj kuyruğa yazılır, `kickOutboxDrain` çağrılır. `answered` teslimde `markConversationDelivered` ile yazılır (`worker.ts:875-889`). Teslimden sonra yeni inbound varsa dokunulmaz (:464).

**QR**
- `src/app/api/guest-chats/[id]/reply/route.ts`. Message `authorType:"host"` yazılır, yalnız `lastMessageAt` güncellenir. Status yazılmaz.
- AI duraklatma türetilir: son host/`system resume` mesajı karar verir (`guest-chat.ts:100-120`, `guestChatAiPausedForStay` :138). Alan yok, mesaj zaman çizelgesi var.
- Yeniden açma: `POST src/app/api/guest-chats/[id]/resume-ai/route.ts`. `authorType:"system"`, `systemEventType:"guest_chat_ai_resumed"` mesajı yazar. UI: `components/guest-chats/resume-ai-button.tsx`. Zamanlayıcıyla kendiliğinden açılmaz.

**WhatsApp host cevabı**
- `host-channel/answer.ts:869` `sendHostMessage(aiAssisted:true)` çağırır. Dosya konuşma status'u kendisi yazmaz. :449 olan `HostQuestion.status`, konuşma durumu değil.
- Etki `host-send.ts:142` (satır içi) veya `worker.ts:466` (kuyruk) üzerinden `answered` olur.

## 4. Konuşma başına AI açık/kapalı alanı

- `Conversation.autoReplyHoldUntil` (`schema.prisma:606`) tek susturma alanı. Yazanlar: `automation.ts:4178` (gönderim hatası), :4297 (`human_request` devri), `worker.ts:866`, :1687.
- Okuyanlar: `automation.ts:1990`, :4740, `worker.ts:522` (`ai_paused`).
- Yardımcı alanlar: `autoReplyAttemptedAt` (:611), `skippedReason`, `lastRiskLevel`, `lastRiskType`.
- `aiPaused`, `autoReplyEnabled` gibi bir alan yok. Org düzeyinde `Organization.autoReplyHospitable`, saat penceresi ve global anahtar (`autoReplySwitchOn`) var (`automation.ts:2012-2024`).
- QR duraklatma için alan bulunamadı, mesaj zaman çizelgesinden türetiliyor.

## 5. Konuşma öğeleri

- Durumlar `ITEM_STATUSES` (`conversation-items/core.ts:40`): open, pending_host, answered, withdrawn, superseded, done. Şema yorumu `schema.prisma:1574`.
- Geçişler `nextStatus` (`core.ts:580`). Hassas öğe AI cevabıyla kapanmaz. Acil öğe vazgeçme/supersede ile kapanmaz. Yalnız host kapatır.
- Uygulama `applyItemEvent` (`store.ts:175`). Olaylar:
  - `held`/`answered`: `flow.ts:206-242`.
  - `withdrawn`: `store.ts:257`.
  - `superseded`: `store.ts:326`.
  - `host_done`: `items/[itemId]/route.ts:18`, `decisions/decide.ts:207, 321, 358`.
- AI cevabı bunları `answered` yapar (`settleSentTurnItems`, `automation.ts:4487`). Kuyrukta kesin hata olursa `pending_host`'a geri açılır (`worker.ts:934`, :1080), teslim edilirse yeniden kapanır (`worker.ts:886`, `recloseDeliveredItems` :1085).
- Host yanıtı depolanmış öğeyi kapatmaz. Okumada `effectiveStatus` (`core.ts:613`), öğe mesajından sonra host yazdıysa `host_replied` türetir (`store.ts:402-425`).
- WhatsApp cevabı yalnız o turun öğelerini kapatır (`answer.ts:980-995`, `answerTurnItems`).
- Öğe kipi bayrağı: `flag.ts`, `AI_CONVERSATION_ITEMS_ENABLED=1`.

## 6. Gönderim anı yeniden doğrulama (`outbox/worker.ts`)

`sendTimeVeto` (:760), POST'tan hemen önce:
- global AI anahtarı (`auto_reply_disabled`)
- org anahtarları (`orgSwitchCancelReason`)
- abonelik (`billingCancelReason`)
- kanal-duraklatma işareti (`CHANNEL_PAUSED_STALE_MARK`)

`replyVeto` (:485):
- hedef konuşma/mesaj var mı, kiracı eşleşiyor mu (`conversation_gone`, `message_gone`, `tenant_mismatch`)
- yalnız AI satırı için: status `problem/closed` (:521), `autoReplyHoldUntil>now` (:522), cevap mesajından sonra gelen herhangi mesaj (`SUPERSEDED_BY_NEWER_MESSAGE`, :526-528)
- tetik mesajdan sonra gelen misafir mesajı (:539-550)

Lifecycle satırları için ayrı `lifecycleVeto` (:557) var. Manuel host satırı durum nedeniyle veto edilmez. Satır içi yolda sürüm/bayatlık koruması claim sorgusunda: `automation.ts:4097`, `messages: none unseenInbound`.

## 7. Tehlike uyarıları

- Model/NLU: `automation.ts:3649-3770`. Tehlike doğrulanamadıysa `escalateHazard` (:3660, hazard-unverified-alert.ts:54). E-posta saatte org başına 3 ile sınırlı (:32, :62), alıcı org `alertEmail` yoksa owner (:60-61). E-posta başarısız olursa işaret geri alınmaz (:83-95). Aynı yolda WhatsApp `onAlert`.
- Kelime yolu: `sendDueAlerts` (`automation.ts:6049`).
- Yeniden değerlendirme: `sendDueAlerts` her 2 dk'da (`instrumentation.ts:27`, `scheduled-sync.ts:626`) iki aday kümesini tarar, `ALERT_MAX_AGE_MS` yaş penceresi içinde. `hazard_unverified` işaretli veya başka nedenle problem olmuş konuşmada yeni, işaretten sonraki mesajlar yeniden bildirilir (:6115, :6129-6141, :6176-6178). Durumu değiştirmez, yalnız yükseltme/bildirim yapar. Bu tarama kelime ağıyla çalışıyor.
- Un-escalate: yalnız e-posta başarısızlığında geri alma (:6379, kelime yolu). Model/hazard yolu bilerek geri almaz (:3744-3768). Başka otomatik temizleme bulunamadı. Çıkış host yanıtı veya PATCH.
- QR: `chat/[token]/route.ts:795-821`, duraklatılmış konuşmada açık tehlikede `recordRiskEvent` + `sendQrEscalationAlertBounded`. Status değişmez, `priority:"urgent"` (:310). E-posta dedupe: `qrEscalationEmailAt`/`qrEscalationEmailMessageId` (`schema.prisma:519-520`), `guest-chat-alerts.ts`.

## 8. Panele gerçek zamanlı/itme

- SSE, WebSocket, push bulunamadı.
- Yalnız polling: `src/components/inbox/auto-refresh.tsx` (`router.refresh()`, varsayılan 30 sn, sekme görünürken, `visibilitychange`'te anında). Kullanıldığı yerler: `inbox/page.tsx:253`, `inbox/[id]/page.tsx:374`, `guest-chats/page.tsx:104`, `guest-chats/[id]/page.tsx:123`, hepsi `seconds={30}`.
- Misafir QR sohbeti: `components/guest-chat/guest-chat.tsx:149`, 5 sn `setInterval`.
- Arka plan: `instrumentation.ts:27` 2 dk dahili cron (`/api/cron/sync`). 15 sn'lik poller (:177) kimlik e-posta outbox'ı için, mesaj outbox'ı değil. Mesaj outbox'ı `kickOutboxDrain` (`worker.ts:1870`) ile anında tetiklenir.
---

## 1. Teşhis — bugünkü yapının asıl kusuru

Tek bir alan (`Conversation.status`) dört ayrı şeyi taşıyor: **gelen kutusu etiketi** (Yeni / Cevaplandı / Sorunlu / Tamamlandı), **AI anahtarı**
(`problem` → AI durur, §2), **tehlike kaydı** (`lastRiskType` + `problem`) ve **iş takibi** (Sorunlu = "bakılacak"). Sonuçlar:
- Host "İlgileniyorum" yazar → kanal yolu `answered` yapar (host-send / worker) → tehlike hiç çözülmeden AI yeniden açılır (kurucunun bulduğu hata).
- QR'da aynı host davranışı AI'ı DURDURUR (mesaj zaman çizelgesinden türetilir), kanalda AÇAR → aynı niyet iki ürün davranışı.
- `hazard_unverified` (anlama katmanı yok) konuşmayı süresiz kapatır; model düzelince kimse yeniden bakmaz.
- Tek kötü taslak (dil / dayanak) öğe kipi kapalıyken bütün konuşmayı etkileyebilir; öğe kipi açıkken öğe bazında tutulur (iyi temel).
- Kim / neden / hangi mesaj yüzünden durduğu görünmez; "Sorunlu" bir sebep değil bir sonuç.
- Tekrar hafızası metin parmak iziyle çalışıyor; "olay" kavramı yok (K-T1 bugün yamayla kapandı, kalıcı çözüm §3.3).

İyi temeller (korunur): öğe defteri (`ConversationItem`, öğe bazlı tutma) · dayanıklı kuyruk + gönderim anı vetosu (`replyVeto`,
`sendTimeVeto`) · "yeni mesaj eski taslağı geçersiz kılar" kuralı · CLAIM-THEN-SEND · host karar motoru.

## 2. Model — üç bağımsız gerçek + tek karar noktası

| Gerçek | Kayıt | Kim değiştirir | Ne DEĞİŞTİREMEZ |
|---|---|---|---|
| **Açık ihtiyaçlar** | `ConversationItem` (var) | AI cevabı (güvenli öğe), host cevabı (hedeflediği öğe), host "Bitti" | Bir öğenin cevabı başka öğeyi kapatmaz |
| **Kontrol** | `Conversation.controlMode` (`auto` / `host`) + `controlVersion` + kim/ne zaman | Yalnız owner/manager açık işlemi (Devral / AI'ye geri ver) | Model, misafir metni, süre, host'un tek cevabı, sağlayıcı senkronu |
| **Engeller** | `ConversationBlock` satırları (tür, kapsam, kaynak mesaj, kanıt, durum) | Sistem açar; kapatma türüne göre (aşağıda) | Bir engelin kapanması diğerini kaldırmaz |

**Tek karar noktası** `autoSendDecision(conversationId, draft)` → `{ allowed, reasons[] }`. Hem taslak üretilmeden ÖNCE hem kuyruğa girerken
hem gönderimden HEMEN önce (worker) çağrılır; QR, kanal, WhatsApp cevabı, otomatik yaşam döngüsü mesajları AYNI fonksiyonu kullanır.
İzin şartları: `controlMode = auto` · taslağın `controlVersion`'ı güncel · taslağın dayandığı son misafir mesajından sonra yeni misafir
mesajı yok (var) · konuşma kapsamlı aktif engel yok · taslağın öğesinde öğe kapsamlı engel yok · host'un kuyrukta bekleyen mesajı yok
(sıra) · aktif yazma oturumu yok (§4) · org / abonelik / saat penceresi (var).

**"Sorunlu" etiketi** bundan sonra TÜRETİLİR: host ilgisi gereken açık öğe VEYA aktif engel varsa panelde "Sorunlu" görünür; AI'ı o etiket
değil engel/kontrol durdurur. Etiket elle de konabilir (takip işareti), ama elle konan etiket otomasyonu KAPATMAZ — kapatmak isteyen
host "Devral" der (kurucu: "host bilerek sus dediyse susması doğru" → Devral bu niyetin açık hali).

## 3. Engeller (blocker) — türler ve kapanış kuralları

| Tür | Açan | Kapsam | Kapanış | Süre dolması |
|---|---|---|---|---|
| `safety_incident` (açık tehlike) | Kod veya model (yangın, gaz, duman, zorla giriş, mahsur, tehdit…) | Konuşma (olağan cevaplar durur; acil numara cevabı istisnası korunur) | YALNIZ owner/manager "Olay çözüldü" | ASLA çözmez |
| `hazard_unverified` (olası tehlike, anlama yok/hata) | Kod (olası + model sonuç vermedi) | Konuşma | Sınırlı yeniden değerlendirme (§3.2) ya da host | Çözmez; tekrarlar biter → tek iş + tek bildirim |
| `host_takeover` | Host "Devral" | Konuşma | Owner/manager "AI'ye geri ver" | ASLA |
| `item_hold` (tek ihtiyaç: iade, arıza, kötü taslak, dayanak yok, yanlış dil) | Öğe defteri (var) | Yalnız o öğe | Host cevabı / "Bitti" / öğe kuralları (var) | — |
| `technical` (sağlayıcı geçici hata, kota) | Gönderim katmanı | Konuşma ya da kuyruk satırı | Kendiliğinden toparlanır (var: `autoReplyHoldUntil`) | Evet (teknik) |

Kurallar: her engel `sourceMessageId` + kısa kanıt kodu (metin değil; KVKK) + açılış/kapanış kim/ne zaman taşır. Yeni tehlike (farklı tür ya
da çözümden SONRA gelen) yeni satırdır — eski "çözüldü" onayı onu kapatamaz. Teknik toparlanma başka bir engeli silemez.

### 3.1 Host cevabı ≠ çözüm (K-T2)
"Prizden duman çıkıyor" → `safety_incident` açılır, host uyarılır. Host "Gördüm, ilgileniyorum" yazar → mesaj gider, hedef öğe
"host cevapladı" olur, **olay açık kalır**, AI olağan cevap vermez. Host "Olay çözüldü" der → engel kapanır → diğer engeller ve kontrol
yeniden hesaplanır (Devral varsa AI yine kapalı). Bugünkü `answered` yazımı problem'i kaldırma ETKİSİNİ kaybeder (etiket türetilmiş olur).

### 3.2 Değerlendirilemeyen olası tehlike (K-T3)
`hazard_unverified` açılınca kalıcı iş kaydı (yeniden değerlendirme işi): +1 dk, +5 dk, +15 dk (3 deneme, kuyruk/iş tablosu — cron'a ek hızlı
uyandırma). Sonuç: **tehlike** → `safety_incident`'e yükselir + uyarı · **tehlike değil** (bağlam: "çaydanlıktan buhar, normal mi?") →
engel "model değerlendirdi: tehlike değil" diye kapanır, iz kalır, ilgili soru normal akışa döner · **hâlâ belirsiz** → engel kalır, host'a
TEK açık iş + TEK bildirim (sonsuz tekrar yok, sessiz unutma yok). Bu sırada gelen yeni mesajlar kaydedilir, tehlike taraması sürer.

### 3.3 Olay kimliği ve uyarı tekrarı (K-T1'in kalıcı hali)
Uyarı tekrarı metin parmak izine değil OLAY satırına bağlanır: aynı açık olaya ait tekrar mesajlar yeni e-posta üretmez; **ağırlaşma**
(ör. duman → alev, tehdit → zorla giriş; şiddet sırası kodda) aynı olayda ŞİDDETİ yükseltir ve yeniden uyarır; olay çözüldükten sonra gelen
aynı metin YENİ olaydır. (Bugünkü yama — yeniden açmada hafıza silme — olay kaydı gelene kadar köprüdür.)

## 4. Üç host işlemi

| İşlem | Kalıcı kontrol | Etki |
|---|---|---|
| **Yanıtla** (mesaj/ihtiyaç seçili) | DEĞİŞMEZ | Sunucuda süreli yazma oturumu: oturum varken AI gönderimleri bekler; gönderimde host mesajı kuyruğa SIRAYLA girer; yalnız hedef öğe cevaplanır |
| **Devral** | `host`, sürüm++ | Kalıcı; sekme kapanması / süre / misafir mesajı / model açamaz |
| **AI'ye geri ver** | `auto`, sürüm++ | Yalnız SONRAKİ yeni misafir mesajları; eski taslaklar ve birikmiş sorular topluca GİTMEZ (host görür, isterse öğe öğe "AI cevaplasın" der) |

Yazma oturumu (Codex ayarları, ölçümle başlanır): sekme başına kimlik · ≈20 sn yenileme · yenileme kesilirse 60 sn sonra geçersiz ·
hareketsiz 90 sn uyarı / 120 sn yalnız oturum biter (tek tıkla uzatılır) · misafir mesajı hareketsizlik sayacını SIFIRLAMAZ · taslak hiçbir
süre dolumunda gönderilmez/kaybolmaz · kayıt PostgreSQL'de kısa işlemlerle (açık işlem / bağlantı kilidi tutulmaz). Gönderilmiş ama sonucu
belirsiz host mesajı "iletimde" görünür; yeniden açma bahanesiyle tekrar gönderilmez.

Panel durum satırı (tek satır, sebepler birlikte): "Otomatik cevaplar açık [Devral]" · "Musa devraldı · 14:32 [AI'ye geri ver]" ·
"Güvenlik: prizden duman bildirimi · 14:31 [Olayı incele] [Olay çözüldü]" · "Siz yazarken otomatik cevaplar bekliyor · 1 yeni mesaj".
Eş zamanlı iki yönetici: kontrol uçları `If-Match: <controlVersion>` ister; bayat ekran 409 alır ("Bu konuşma az önce değişti").

## 5. Kenar durumları (kabul testleri — gerçek PG + iki süreç)
1. Devralma anında üretilmekte olan AI taslağı → sürüm değişti → gönderim anında veto, sağlayıcıya hiçbir şey gitmez.
2. Kuyrukta bekleyen eski AI cevabı + Devral/geri ver → sürüm farkı → iptal; "geri ver" onu canlandırmaz.
3. İki yönetici aynı anda Devral / geri ver → biri 409; son durum tek ve tutarlı.
4. İki açık olay (yangın + gaz) → biri çözülünce AI hâlâ kapalı.
5. Host yazarken bağlantı kopar → 60 sn sonra oturum geçersiz; taslak kaybolmaz, gitmez.
6. Host Airbnb uygulamasından (Lixus dışından) cevap verir → senkron gelir: önceki taslaklar geçersiz (yeni mesaj kuralı); kontrol
   değişmez; hangi öğeyi cevapladığı bilinmez → öğeler "host cevapladı (dış kanal)" türetilir, kapanmaz (soru K-3).
7. Yeni konaklamaya kontrol TAŞINMAZ (Devral konaklama/konuşma kapsamlı; yeni rezervasyon yeni konuşma).
8. İki sekme aynı hesap → bayat sekmenin yenilemesi yeni sekmenin oturumunu düşüremez.
9. Gönderim sırasında yeni misafir mesajı → host mesajı gider (insan kararı), AI taslağı geçersiz; panelde "görmediğiniz 1 mesaj".
10. Durdur–yeniden aç yarışı → sürüm koşulu; ölçüt sağlayıcıya GERÇEKTEN giden mesajlar.

## 6. Geçiş (çalışan ürün bozulmaz)
- **G0 gölge:** yeni tablolar + `autoSendDecision` yalnız KAYDEDER; eski karar uygulanır; uyuşmazlıklar olay günlüğüne (hangi kural, hangi
  yöne). Ölçüler: gereksiz durdurma · yanlış yeniden açılma · host müdahalesiz toparlanma · cevapsız kalan bağımsız soru · yakalanan tehlike.
- **G1:** olay engeli + "Olay çözüldü" + host cevabının olayı kapatmaması (müşteri akışı değişir → önce/sonra onayı).
- **G2:** Devral / AI'ye geri ver + sürüm + If-Match (QR ve kanal aynı anlam).
- **G3:** yazma oturumu. **G4:** canlı panel (PostgreSQL bildirimi + SSE; kopunca veritabanından yeniden okuma; 30 sn yoklama yedek).
- Eski `problem` satırları nedeni belirsiz diye AÇILMAZ: geçişte `legacy_problem` engeli olarak taşınır, host bakıp kapatır.

## 7. Kurucuya sorular (önce / sonra örnekli)
- **K-1 (QR farkı):** Bugün QR'da host cevap yazınca AI duruyor; kanalda durmuyor (hatta açılıyor). Önerim: ikisinde de tek cevap kontrolü
  DEĞİŞTİRMEZ; susturmak isteyen "Devral" der. Örnek — önce (QR): host "Havlu getiriyorum" yazdı → AI sonraki Wi-Fi sorusuna cevap vermez,
  host elle açana kadar. Sonra: Wi-Fi sorusu AI'dan cevap alır; havlu öğesi host'ta kalır. Uygun mu?
- **K-2 (Sorunlu etiketi):** Elle "Sorunlu" seçmek bundan sonra yalnız takip işareti olsun, AI'ı kapatmasın (kapatmak = Devral) — mı, yoksa
  elle Sorunlu = Devral mı sayılsın? Önerim ilki + seçim anında "AI'ı da durdurayım mı? [Devral]" küçük önerisi.
- **K-3 (dış kanal host cevabı):** Host Airbnb uygulamasından yazarsa AI o konuşmada ne yapsın? Önerim: kontrol değişmez, önceki taslaklar
  iptal, açık öğeler "dış kanaldan cevaplandı (doğrulanmadı)" — AI o öğelere yeniden cevap yazmaz, yeni sorulara yazar.
- **K-4 (olayı kim çözer):** owner + manager (önerim); personel (staff) yalnız not bırakır?
- **K-5 (belirsiz tehlike tekrarları):** +1 / +5 / +15 dk, sonra tek iş + tek bildirim — uygun mu?
- **K-6 (migration):** `Conversation` kontrol alanları (nullable / varsayılanlı) + `ConversationBlock` + yazma oturumu + yeniden değerlendirme işi
  tabloları. Onay + açılıştan önce taze yedek.
- **K-7 (web kancası, K-A1):** Airbnb / Booking / Vrbo için ortak alım ucu (imza doğrulama → ham olay kalıcı → bildirim → işçi o konuşmayı
  çeker). Bu üç sağlayıcının ortaklık API erişimi bugün yok (Airbnb Direct sözleşmesi boş adaptör); kod sağlayıcıdan bağımsız alım + sözleşme
  testleriyle hazırlanır, gerçek bağlantı erişim gelince. Vrbo için başvuru durumu nedir?
