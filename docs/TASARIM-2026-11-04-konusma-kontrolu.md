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

## 8. Kurucu cevapları (11-04 akşam)
- **K-1 ✅** önerildiği gibi: QR ve kanalda tek host cevabı kontrolü değiştirmez; susturmak = Devral.
- **K-2 ✅** elle "Sorunlu" = takip işareti; AI'ı kapatmaz; seçimde küçük "[Devral]" önerisi.
- **K-3 ✅ yön + geliştir:** "AI hostun mesajını bilsin; hostlar çoğunlukla Airbnb/Booking'den yazacak, en iyi akışı kuralım" (Codex görüşü
  alınabilir). Önerilen akış §9.
- **K-4 ✅** olayı owner + manager çözer.
- **K-5** açıklama istendi (sohbette anlatıldı); onay bekliyor.
- **K-6 ✅** migration onaylı (açılıştan önce taze yedek kuralı geçerli).
- **K-7** Vrbo başvurusu yok, ürün geliştirme aşamasında → web kancası SONRAYA; şimdilik yalnız sağlayıcıdan bağımsız alım tasarımı.
- **Yeni öneri (kurucu):** host durdurdu, kendi yazacaktı, vazgeçti → AI'ya "şöyle şöyle yaz" der → AI düşünceyi host'un sesiyle cümleye
  döker, ÖNİZLEME + [Gönder] (kendiliğinden gitmez; bütün kapılardan geçer). WhatsApp cevap diliminin (talimat biçimli host cevabı →
  taslak → önizleme) panel karşılığı; aynı çekirdek kullanılır.
- **Model:** Haiku'nun ölçümle daha iyi olduğu katmanlarda geçiş; açılış listesine (Railway) katman bazında sağlayıcı/model anahtarı yazılır.

## 9. Dış kanaldan host cevabı (K-3) — önerilen akış
1. Senkron, Lixus'tan gönderilmemiş bir host mesajı getirir → `authorType: host`, kaynak "dış kanal" (var) + konuşma içerik sürümü artar →
   kuyruktaki / üretilmekte olan AI taslakları geçersiz (bugünkü "yeni mesaj eski taslağı iptal eder" kuralı host mesajına da uygulanır).
2. **Host cevabı okuması (model, yapılandırılmış çıktı):** açık öğelerin her biri için "bu mesaj onu cevapladı mı (tam / kısmi / hayır)";
   host bir şey SÖZ verdi mi (→ açık taahhüt hafızası, var); host "devralıyorum / ben ilgilenirim" dedi mi; tehlike için "çözüldü" beyanı var mı.
   WhatsApp cevap dilimindeki "cevap → soru eşleme" çekirdeği yeniden kullanılır.
3. Tam cevaplanan öğe "host cevapladı (dış kanal)" kapanır; AI o öğeye ASLA yeniden cevap yazmaz, sonraki cevaplarında host'un söylediğiyle
   çelişmez (host mesajı bağlamda; çelişki okuyucuda kontrol). Kısmi / cevapsız öğeler açık kalır, bağımsız ve güvenliyse AI cevaplar.
4. "Ben ilgilenirim" türü beyan otomatik Devral SAYILMAZ (K-1 ilkesi); panelde "Host bu konuşmayı üstlenmiş görünüyor [Devral]" önerisi.
5. Tehlike için "çözüldü / teknisyen geldi" beyanı olayı KAPATMAZ; panelde "Olay çözüldü mü? [Evet, çözüldü]" önerisi (K-T2).
6. **Aktif sohbet beklemesi (soru):** host dış kanalda son X dakikada yazdıysa yeni misafir mesajına AI hemen girmesin mi (host o an
   konuşuyor olabilir; yazdığını göremiyoruz)? Önerim: host'un son mesajından sonraki 10 dk içinde gelen misafir mesajı AI'da bekler; 10 dk
   içinde host yazarsa AI hiç girmez, yazmazsa güncel bağlamla değerlendirilir (eski taslak değil). Codex görüşü istenebilir.
7. Ölçüm: geçmiş konuşmalardan host cevabı → öğe eşleme doğruluğu (kör set) + yanlış "cevaplandı" oranı (en tehlikeli hata).

## 10. Codex 11-04 öğleden sonra görüşüyle güncelleme (benim kararlarım — kurucu: "son karar sende")

### 10.1 K-3 dış kanal host cevabı — sabit 10 dk YERİNE kısa host önceliği (kabul, gerekçeli)
Codex haklı: sabit 10 dk hem bağımsız soruyu gereksiz bekletir hem 9:59'da gelen soruya 1 sn sonra AI'ı sokar; "yakın host etkinliği" sinyali
ile "bu soru ne kadar bekler" kararı ayrı tutulur. §9 madde 6 şöyle değişir:
- **Host önceliği penceresi** ihtiyaç bazındadır: dış kanaldan host yazdıktan sonra gelen NORMAL (tehlike dışı) yeni ihtiyaç host'a kısa bir
  cevap fırsatı tanır — başlangıç **90 sn**, ölçülecek. Pencere ihtiyacın İLK misafir mesajından sayılır; misafirin aynı soruya "?" eklemesi
  başa sarmaz, gerçekten yeni soru kendi penceresini alır.
- Host o ihtiyacı cevaplarsa bekleyen AI cevabı KALKAR (değerlendirme iptal, gönderim yok). Host başka konuda yazdıysa bağımsız sorunun
  beklemesi başa SARMAZ.
- Pencere bitince yalnız YENİDEN DEĞERLENDİRME başlar (güncel konuşma okunur; eski taslak kullanılmaz) — "gönder" izni değildir.
- Tehlike tespiti, uyarı ve tehlike akışı pencereye takılmaz. Devral / güvenlik engeli / belirsiz gönderim pencere bitince kalkmaz.
- Gölge ölçüm: 90 / 180 / 600 sn kolları aynı akışta yalnız KAYDEDİLİR (gereksiz bekleme, tekrarlanan cevap, host'un üstüne konuşma,
  yanlış kapanan ihtiyaç); karar ölçümle. Not: AI önce cevapladığı için host'un susması "host cevaplamazdı" kanıtı sayılmaz.
- Öncül: senkron gecikmesi ölçülür (bugün 2 dk tur → 90 sn pencere anlamsız olabilir; web kancası gelene kadar pencere "host mesajının
  BİZE ulaştığı an"dan değil, mesajın kanal zamanından sayılır).

### 10.2 K-3 netleştirmeleri (kabul)
- "Dış kanaldan cevaplandı" yalnız host mesajıyla İLİŞKİLENDİRİLEN öğelere; kapsam belirsizse iş AÇIK kalır.
- "Bir daha cevaplamaz" kalıcı yasak değil: misafir "anlamadım, tekrar açıklar mısınız?" derse bu YENİ bir ihtiyaçtır.
- "Host'la çelişmez" körü körüne itaat değil: yanlış daire / çelişen saat / güvenlik → AI o kısma girmez, host'a bırakır (panelde "host'un
  mesajı bilgi tabanıyla çelişiyor" notu); tek host mesajı bilgi tabanını KENDİLİĞİNDEN değiştirmez (WhatsApp → bilgi tabanı akışı ayrı, onaylı).
- Cevap ≠ ilgilenme ≠ çözme: "Ben ilgilenirim" = sorumluluk bildirimi (öğe host'ta, `pending_host`); "Teknisyen geldi, düzeldi" = çözüm
  KANITI (panelde tek "çözüldü mü?" önerisi; güvenlik olayında kapanış yine K-4 kuralıyla).
- **Sıra:** önce host mesajını kaydet + o konuşmanın kuyruktaki / üretilmekte olan AI işlerini geçersiz kıl (sürüm++), SONRA anlam analizi —
  aralık bırakılmaz. Host'un kendi taslakları silinmez.
- **Köken ayrımı:** bizim AI cevabımızın geri senkronu (sağlayıcı kimliği bizim gönderim kaydımızda) · kanal otomatik şablonu (sağlayıcının
  mesaj türü / rolü; Q2 kuralı zaten var) · gerçek host mesajı ayrı tutulur; yalnız "gönderen = host" alanına güvenilmez.

### 10.3 K-5 belirsiz tehlike — Codex şartları (kabul)
- İlk host bildirimi BEKLEMEZ: bugünkü "olası tehlike + anlama yok → Sorunlu + seyrek e-posta" anında olur; yeniden değerlendirme onun
  yerine geçmez, YANINDA koşar.
- +1 / +5 / +15 dk ilk tespit anından; kalıcı iş kaydı (yeniden başlatmada kaybolmaz; iki işçi tek sonuç).
- **Teknik hata ≠ anlam belirsizliği:** yeniden deneme YALNIZ teknik hata (zaman aşımı, 5xx, ağ) için. Model cevap verdi ama "belirsiz"
  dediyse aynı metin tekrar sorulmaz ("tehlikesiz" diyene kadar sormak güvenli değil) → doğrudan tek inceleme işi. Anlama anahtarı
  KASITLI kapalıysa tekrar denenmez.
- Sonuç uygulanırken güncel durum yeniden okunur: host müdahalesi, yeni misafir mesajı, başka açık tehlike varsa eski değerlendirme yeni
  durumu ezmez; yalnız İLGİLİ `hazard_unverified` engeli koşullu kapanır (sürüm koşulu).
- Ayrı / ağırlaşan tehlike "tek bildirim" bahanesiyle bastırılmaz (§3.3 olay kimliği).
- Engel kalkınca eski taslak gönderilmez; soru hâlâ açık ve güncelse cevap YENİDEN hazırlanır.

### 10.4 Host talimatından AI'nin yazdığı mesaj + ortak kapının ayrışması (kabul)
- Önizleme + açık [Gönder]; misafire giden metin yine kod kapılarından (sır, ödeme yöntemi, iç sistem anlatımı…) geçer.
- **Kapı ikiye ayrılır:** (a) ORTAK kontroller — yetki (owner/manager), hedef konuşma / kiracı, rezervasyon iptali, belirsiz gönderim, silme
  (KVKK) — HER gönderimde; (b) OTOMASYON kuralları — kontrol kipi (`auto`/`host`), Devral, hazard engeli, yazma oturumu, sessiz saat — YALNIZ
  AI'nın kendi başına gönderdiği mesajlarda. İnsanın onayladığı gönderim (elle yazılan ya da önizlemesi onaylanan) AI duraklatılmış / Devral
  durumunda da GİDER (bugün kuyrukta da elle mesaj durum vetosuna takılmaz — `replyVeto` "manual host reply always goes").
- Tehlike engeli açıkken host'un önizlemeli mesajı gider ama metin "tehlike çözüldü" türü bir iddia taşıyorsa (ör. "sorun yok, kullanmaya
  devam edin") önizlemede uyarı gösterilir — engel insan onayıyla kapatılmadıkça.

### 10.5 Codex statik bulgularının konuşma kontrolüyle bağı
- P1 #3 (doğrudan gönderim tamamlanması daha yeni durumu ezer) bugünkü modelde kuyruk kuralıyla kapatıldı (`host-send.ts`, `automation.ts`;
  11-04). Yeni modelde aynı ilke `controlVersion` ile genelleşir: tamamlama gönderim başındaki sürüme bağlıdır.
- P1 #4 (kuyruktaki AI cevabı rezervasyon iptalinden sonra) → (a) ORTAK kontrollerin ilk üyesi.

## 11. G0 (gölge) uygulama planı — 11-04 akşam (kod henüz YOK; push'tan ve istek 9 raporundan sonra başlar)

Amaç: hiçbir kararı DEĞİŞTİRMEDEN yeni modelin bugünküyle nerede ayrıştığını ölçmek (kurucunun bulduğu hata dahil: tehlike açıkken host'un
tek cevabı AI'ı yeniden açıyor).
1. **Migration (yalnız yeni tablo — dolu tabloya kolon yok):** `ConversationBlock` — `organizationId` · `conversationId` (konuşma silinince
   satır da gider) · `kind` (`safety_incident` · `hazard_unverified` · `host_takeover` · `technical` · `legacy_problem`) · `scope`
   (`conversation` / `item`) + `itemId?` · `sourceMessageId?` · `evidence` (kısa KOD; misafir metni ASLA — KVKK) · `status` (`active` /
   `resolved`) · açılış / kapanış kim-ne zaman-neden. Tekillik `(conversationId, kind, sourceMessageId)` (yineleme güvenli). `Conversation.
   controlMode / controlVersion` kolonları G2'de (Devral) — G0'da gerekmez.
2. **Kayıt (gölge yazıcı):** bugün `problem` yazan dört yol (model `automation.ts` applyChannelAutoReply · kelime `sendDueAlerts` ·
   `escalateUnverifiedHazard` · QR tehlike yükseltmesi) AYNI işlemde bir engel satırı da açar. Kapanış G0'da YOK (yalnız açılır; G1'de
   "Olay çözüldü").
3. **`autoSendDecision` (saf karar + okuyucu):** girdiler = aktif engeller + öğe tutmaları + bugünkü ortak kontroller (org / abonelik / saat /
   iptal-bitmiş konaklama — 10.4 a). Bugünkü iki karar noktasında (inline `applyChannelAutoReply` gönderimden önce · kuyruk `replyVeto`)
   ÇAĞRILIR, sonucu bugünküyle kıyaslanır; uyuşmazlık yalnız sayılır: `logEvent("conversation_control.shadow_mismatch", { rule, direction })`
   (metin / kimlik yok). Bugünkü karar uygulanır.
4. **Ölçüler (olay günlüğünden, betik):** yeni-durdurur-eski-gönderir (ör. açık tehlikede host cevabından sonra AI) · eski-durdurur-yeni-gönderir
   (ör. tek kötü taslak bütün konuşmayı durduruyor) · kural başına sayı. Kabul testleri §5'teki kenar durumları (gerçek PG + iki süreç).
5. **Testler:** gölge yazıcı her yolda satır açar (yineleme tek satır) · karar fonksiyonu tablo testleri · çağrı noktalarında davranış BİREBİR
   aynı (eski testler değişmeden yeşil) · uyuşmazlık olayı metin taşımaz.
6. **Kıyasın iki inceliği (11-04 akşam, kod okuması):** (a) model yolu `problem`i güvenlik DIŞI sebeplerle de yazar (iade, şikâyet, insan
   talebi — `automation.ts` applyChannelAutoReply `modelSensitive`); yeni modelde bunlar ÖĞE tutmasıdır (öğe defteri zaten var), konuşma
   engeli DEĞİL → gölge yazıcı yalnız `safety_emergency` → `safety_incident`, doğrulanamayan tehlike → `hazard_unverified` açar; geri kalan
   yükseltmelerde "bugün durur, yeni model yalnız öğeyi tutar" ayrışması ÖLÇÜLMEK İSTENEN şeydir. (b) G0'dan ÖNCE `problem` olmuş konuşmanın
   engel kaydı yoktur → kıyasta `legacy_problem` sayılır (sahte "yeni model gönderirdi" sayımı olmasın); ayırt etmek için G0 açılış anı
   (ilk gölge kaydı) eşik alınır.
