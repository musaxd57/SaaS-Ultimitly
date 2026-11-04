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