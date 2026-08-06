# Derin denetim bulguları — 2026-08-01
> **Ham kayıt.** 9 bağımsız derin-okuma agent'i, her biri TEK bir alt sistemi
> baştan sona okudu. Toplam 52 bulgu; her biri uygulanmadan önce KODLA yeniden
> doğrulandı (agent raporlarının kayda değer bir kısmı yanlış çıkar).
>
> ⚠️ Bu turda çürütme (adversarial doğrulama) aşaması TAMAMLANAMADI: doğrulayıcı
> agent'lara verdiğim JSON şeması fazla katıydı (`additionalProperties: false`)
> ve agent'lar şema reddi döngüsüne girdi. 9 hüküm geldi (8 onay, 1 ret), kalan
> ~20 doğrulayıcı bu yüzden öldü. Bulgular etkilenmedi; yalnız bağımsız ikinci
> göz eksik kaldı. Kalanlar tek tek elle doğrulandı.

**Dağılım:** KRİTİK 5 · YÜKSEK 14 · ORTA 18 · DÜŞÜK 15
**Bugünkü durum:** 28 uygulandı (↓indeks) · 23 açık + 1 belge-düzeltmesiyle çözüldü (#47) (↓tam metin)

---

## ✅ UYGULANANLAR — indeks (28 bulgu)

> **Bu bölüm 08-06'da KISALTILDI.** Uygulanmış bulguların tam anlatımı (kanıt
> blokları, tetikleyici, etki analizi, önerilen düzeltme) **bu dosyanın git
> geçmişinde** duruyor — `git log -p docs/DENETIM-BULGULARI-2026-08-01.md`.
> Kalıcı olması gereken KURALLAR zaten `CLAUDE.md` "KALICI KARARLAR"a terfi
> ettirildi; kodun kendisi ve testleri repoda. Burada yalnız "ne bulunmuştu,
> nerede" izi bırakıldı ki bir sonraki denetim aynı yeri iki kez keşfetmesin.
>
> ⚠️ **AÇIK bulgular AŞAĞIDA TAM METİNLE duruyor** — onlar backlog, kısaltılmadı.

- **1.** ✅ UYGULANDI (08-01) · 🔴 KRİTİK — Kalici (4xx) gonderim hatasi sonsuz yeniden-deneme dongusune giriyor: her turda bir OpenAI cagrisi + bir kota birimi yanar, konusma damgalanmaz ve host'a hicbir sebep gorunmez.
  · Yer: `src/lib/automation.ts:1673-1687, src/lib/automation.ts:1899-1923, src/lib/messaging.ts:76-79`
- **2.** ✅ UYGULANDI (08-01) · 🔴 KRİTİK — Şikayet/akıllı görevlerin `Task.description` alanı misafirin mesajını KELİMESİ KELİMESİNE tutuyor ve HİÇBİR temizlik süpürgesi ona dokunmuyor — iki süpürgedeki yorum da açıkça "açıklamalar şablon metindir" diyerek yanlış yöne sevk ediyor
  · Yer: `src/lib/automation.ts:811-821, src/lib/automation.ts:1433, src/lib/automation.ts:2806, src/lib/tasks/detect.ts:166, src/lib/data-retention.ts:127 ve 136-147, src/lib/erasure.ts:462 ve 463-470`
- **3.** ✅ UYGULANDI (08-01) · 🔴 KRİTİK — Erasure/retention outbox gövdesini anonimleştirirken `blocked` satırı iptal etmiyor; `reactivateBlockedOutbox` o satırı OTOMATİK canlandırıp misafire "[saklama süresi doldu — içerik silindi]" gönderiyor.
  · Yer: `src/lib/erasure.ts:510-521, src/lib/data-retention.ts:188-208, src/lib/outbox/worker.ts:489-503, src/lib/outbox/worker.ts:414-419, src/lib/scheduled-sync.ts:300`
- **4.** ✅ UYGULANDI (bu tur) · 🔴 KRİTİK — QR'ın "sır asla bağlamda olmaz" değişmezi `aiStyleProfile` ile deliniyor: ev sahibinin Wi-Fi/kapı kodu içeren geçmiş cevaplarından üretilmiş serbest metin, halka açık istem'e hiçbir deterministik filtre olmadan giriyor
  · Yer: `src/app/api/chat/[token]/route.ts:500-503,528 · src/lib/guest-chat.ts:25-31,500-507 · src/lib/ai/prompts.ts:886-899 · src/lib/automation.ts:1985-2010 · src/lib/report-error-core.ts:69-73,103`
- **5.** ✅ UYGULANDI (bu tur) · 🔴 KRİTİK — Güvenlik kapısı ve şikayet uyarısı yalnız EN SON gelen mesaja bakıyor; arka arkaya gelen iki misafir mesajında şikayet kalıcı olarak kayboluyor.
  · Yer: `src/lib/automation.ts:1043, src/lib/automation.ts:1288, src/lib/automation.ts:93, src/lib/automation.ts:134, src/lib/automation.ts:2689, src/lib/automation.ts:2706-2711`
- **6.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — 07-31'de eklenen "aktif saat araligi disinda" gorunurluk duzeltmesi canlida HIC calismiyor: runDueChannelAutoReplies ayni kosulu org seviyesinde kontrol edip erken donuyor.
  · Yer: `src/lib/automation.ts:1029-1039, src/lib/automation.ts:1791-1794, src/lib/automation.ts:2907, src/app/(app)/inbox/[id]/page.tsx:154-156`
- **8.** ✅ KISMEN UYGULANDI (08-01: alarm; kalan MIGRATION-BEKLEYEN-ISLER §4) · 🟠 YÜKSEK — Yaşam-döngüsü gönderimlerinin (welcome/checkin/checkout) hata dalları TAMAMEN sessiz: belirsiz hatada damga kalıyor, misafir mesajı almıyor, önizleme ekranı "gönderildi" diyor; kesin hatada sonsuz sessiz tekrar başlıyor
  · Yer: `src/lib/automation.ts:2215-2231, src/lib/automation.ts:2344-2358, src/lib/automation.ts:2615-2629 (hata dalları) · src/lib/automation.ts:2423, :2481, :2874 (önizleme) · src/lib/automation.ts:2151-2152 (sıra+tavan)`
- **9.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — `sendDueAlerts`'in "süre bütçesinden MUAF, uyarı susturulamaz" garantisi çağrı yerinde delik: `syncHospitable` fırlatırsa şikayet uyarısı geçişi HİÇ koşmuyor
  · Yer: `src/lib/scheduled-sync.ts:286-287, :304-318, :343-353 · src/lib/hospitable-sync.ts:165 · src/lib/automation.ts:2644, :2697-2705`
- **10.** ✅ KISMEN UYGULANDI (08-01) · 🟠 YÜKSEK — Tarihi cozulemeyen rezervasyon sessizce yazilmiyor, konusma REZERVASYONSUZ dogar ve oto-yanitin 'iptal/bitmis konaklamaya cevap verme' kapisi hic calismaz.
  · Yer: `src/lib/hospitable-sync.ts:545, src/lib/hospitable-sync.ts:298-308, src/lib/hospitable-sync.ts:876, src/lib/automation.ts:1012-1024`
- **11.** ✅ KISMEN UYGULANDI (08-01) · 🟠 YÜKSEK — 429 geri-cekilme butcesi senkron kilidinin 15 dakikalik TTL'ini hala kolayca asiyor; parseRetryAfter yorumu bu riski KAPANDI diye anlatiyor.
  · Yer: `src/lib/hospitable.ts:28-29, src/lib/hospitable.ts:44-62, src/lib/hospitable.ts:129-133, src/lib/hospitable.ts:196, src/lib/scheduled-sync.ts:76`
- **13.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — Aynı işletme için İKİNCİ bir Paddle aboneliği açılmasını engelleyen sunucu-tarafı hiçbir kapı yok; ikinci abonelik yerel satırı ezer ve birincisi görünmez şekilde faturalanmaya devam eder.
  · Yer: `src/app/api/billing/consent/route.ts:19-64, src/components/settings/paddle-plans.tsx:526, src/app/(app)/settings/page.tsx:121-135, src/app/api/webhooks/paddle/route.ts:196-210, src/app/api/webhooks/paddle/route.ts:81-91`
- **14.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — Impersonation altında yapılan plan değişikliği (gerçek, anında tahsilat) denetim kaydına MÜŞTERİ tarafından yapılmış gibi yazılıyor — operatörün izi kalmıyor.
  · Yer: `src/app/api/billing/plan-change/route.ts:168-173, src/lib/audit.ts:51, src/lib/admin.ts:85-96`
- **15.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — QR concierge, `suggestReply` çağıran TEK yer olarak org günlük AI bütçesinin tamamen dışında — ve bu, kimlik doğrulaması olmayan tek yüzey
  · Yer: `src/app/api/chat/[token]/route.ts:1-21,461-505 · src/lib/ai/daily-budget.ts:5-23,127-136 · src/lib/billing/plan-limits.ts:63-83,135`
- **16.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — QR eskalasyonu "ev sahibine ilettim" diyor ama varsayılan kurulumda ev sahibine hiçbir kanaldan ulaşmıyor: e-posta bayrağı KAPALI ve konuşma bilerek "answered" olduğu için hiçbir dikkat yüzeyine düşmüyor
  · Yer: `src/app/api/chat/[token]/route.ts:482,489-496,541-555 · src/lib/guest-chat-alerts.ts:80-82,101 · src/lib/guest-chat.ts:169-170 · src/app/(app)/dashboard/page.tsx:66`
- **17.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — Deterministik prompt-injection vetosu boşluk normalizasyonu yapmıyor; çift boşluk, satır sonu veya kırılmayan boşluk (U+00A0) tüm çok-kelimeli kalıpları deliyor.
  · Yer: `src/lib/ai/fallback.ts:426-448, src/lib/ai/fallback.ts:457-465, src/lib/ai/fallback.ts:245-247`
- **18.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — PROBLEM_NEGATIONS girdileri çapasız önek olduğu için OLUMLU şikayet kalıplarını da siliyor; "sorun yaşamaktayız" deterministik olarak şikayet sayılmıyor.
  · Yer: `src/lib/ai/fallback.ts:186-199, src/lib/ai/fallback.ts:259-265`
- **19.** ✅ UYGULANDI (08-01) · 🟠 YÜKSEK — Escalation testinin "MODEL YOLU" bolumu model yolunu hic test etmiyor; e-posta basarisizliginda claim'in geri ALINMAMASI kurali tum suitte pinsiz.
  · Yer: `tests/integration/escalation-email-retry.test.ts:144-182, src/lib/automation.ts:1361-1398`
- **20.** ✅ UYGULANDI (08-01) · 🟡 ORTA — persistRiskVisibility'nin "ayni sebep ise yazma" korumasi risk alanlarini da atliyor: ardisik iki low_confidence_or_risky mesajda ikincisinin deterministik risk etiketi (safety_emergency / rule_violation) inbox'ta hic gorunmez.
  · Yer: `src/lib/automation.ts:162-181, src/lib/automation.ts:1482-1488, src/app/(app)/inbox/[id]/page.tsx:171-176`
- **21.** ✅ UYGULANDI (08-01) · 🟡 ORTA — statedCheckoutTime rezervasyona guvenlik kapisindan ONCE yaziliyor: insana devredilen/vetolanan bir mesaj bile Reservation.guestCheckoutTime'i degistirir ve kanit kontrolu olumsuzlamayi ayirt etmiyor.
  · Yer: `src/lib/automation.ts:1242-1251, src/lib/automation.ts:1288, src/lib/ai/stated-time.ts:19-42`
- **28.** ✅ UYGULANDI (08-01) · 🟡 ORTA — Env'de tanımlı OLMAYAN bir Paddle fiyatıyla gelen abonelik olayı, durumu sessizce "active" yapar ama planı ya ESKİ değerinde bırakır ya da EN UCUZ plana ("free"/Başlangıç) düşürür; hiçbir uyarı çıkmaz.
  · Yer: `src/lib/payments/paddle.ts:103-113, src/app/api/webhooks/paddle/route.ts:161-168, src/app/api/webhooks/paddle/route.ts:197, src/app/api/webhooks/paddle/route.ts:243`
- **29.** ✅ UYGULANDI (08-01) · 🟡 ORTA — Devir (handoff) durumu sohbet detay ekranında KESİLMİŞ pencereden hesaplanıyor: 200+ mesajda "İnsan desteğinde" rozeti ve "AI'yı yeniden etkinleştir" düğmesi kayboluyor, 1000+ mesajda düğme kalıcı olarak ulaşılamaz oluyor
  · Yer: `src/app/(app)/guest-chats/[id]/page.tsx:19,28,68-72,87,118,191-195 · src/lib/guest-chat.ts:521-538 · src/app/api/chat/[token]/route.ts:456-459`
- **31.** ✅ UYGULANDI (08-01) · 🟡 ORTA — statedCheckoutTime kanıt kontrolü virgül/noktalı virgülle ayrılmış cümlecikleri tek segment sayıyor; alakasız bir saat rezervasyona çıkış saati olarak yazılabiliyor.
  · Yer: `src/lib/ai/stated-time.ts:35, src/lib/ai/stated-time.ts:31-34, src/lib/automation.ts:1242-1250`
- **32.** ✅ UYGULANDI (08-01) · 🟡 ORTA — Impersonation sırasında yapılan 7 hassas işlemin denetim kaydı, operatörü değil MÜŞTERİNİN kendi kullanıcısını fail olarak yazıyor — en kritiği zorunlu KVKK imha kaydı.
  · Yer: `src/app/api/reservations/[id]/erase/route.ts:44, src/app/api/reservations/[id]/chat-pin/route.ts:34,55, src/app/api/properties/[id]/chat/route.ts:36, src/app/api/properties/[id]/reset-chat/route.ts:33, src/app/api/properties/[id]/rotate-ical/route.ts:46, src/app/api/outbox/[id]/retry/route.ts:37, src/app/api/billing/plan-change/route.ts:170`
- **33.** ✅ UYGULANDI (08-01) · 🟡 ORTA — Impersonation yapan operatör, müşterinin hesabında 2FA'yı SIFIRDAN kurup etkinleştirebiliyor — gizli anahtar yalnız operatörde kalır, müşteri kendi hesabından kalıcı olarak kilitlenir.
  · Yer: `src/app/api/account/2fa/route.ts:52-112 (özellikle 63-83 setup, 85-112 enable)`
- **34.** ✅ UYGULANDI (08-01) · 🟡 ORTA — "SIRA adil: en eski cevapsiz mesaj once islenir" testi siralamayi hic olcmuyor — orderBy asc->desc mutasyonunu yakalamaz.
  · Yer: `tests/integration/auto-reply-starvation.test.ts:172-184, src/lib/automation.ts:1837-1844`
- **36.** ✅ UYGULANDI (08-01) · 🟡 ORTA — Gunluk kotanin org gecisini SONLANDIRAN kolu (break + kalan konusmalara sebep yazma) hic test edilmiyor; "gercek sebebi ezme" duzeltmesi mutasyonla kirilmaz.
  · Yer: `tests/integration/auto-reply-daily-budget.test.ts:87-192, src/lib/automation.ts:1869-1896`
- **46.** ✅ UYGULANDI (08-01) · 🔵 DÜŞÜK — Harf içermeyen mesajlar (yalnız emoji/noktalama) koşulsuz "kapanış onayı" sayılıyor; 🆘/🚨/🔥 gibi imdat emojileri sessizce yutuluyor.
  · Yer: `src/lib/ai/fallback.ts:406-407, src/lib/ai/fallback.ts:396-397, src/lib/automation.ts:1068-1072, src/lib/automation.ts:1118-1121, src/lib/automation.ts:1899-1915`
- **48.** ✅ UYGULANDI (08-01) · 🔵 DÜŞÜK — api-route-scoping'deki "guard TEK BASINA kapsam sayilmaz" testi mantiksal olarak bir onceki testin sonucu — bugun sifir assertion calistiriyor.
  · Yer: `tests/unit/api-route-scoping.test.ts:76-85`

---

## ⏳ AÇIK BULGULAR — tam metin (24 bulgu)

## 7. 🟠 YÜKSEK — Durable Outbox acilinca konusma "new" + giden-kuyruk durumunda kalir; outbox satiri blocked/failed'e duserse konusma sonsuza kadar `already_answered` doner, damgalanmaz ve aday slotunu kalici isgal eder.
**Yer:** `src/lib/automation.ts:1575-1604, src/lib/automation.ts:1049-1062, src/lib/outbox/enqueue.ts:113-118, src/lib/outbox/worker.ts:623-640`

**Kanıt:** enqueueOutbound giden Message'i yaratir ama konusma durumuna DOKUNMAZ (bilincli):

```
// NOTE (Codex #6): the conversation is NOT marked "answered" here. ...
// "answered/sent" is set by the worker ONLY once the provider confirms delivery.
```

applyChannelAutoReply'in bu dali da ayni sozu veriyor:

```
// the outbound Message this enqueue creates makes the NEXT cycle skip (its last message
// is now outbound -> already_answered)
```

Sonraki turda gercekten oyle olur: son mesaj outbound + externalId yok -> yalnizca `status:"canceled"` outbox satirlari filtrelenir (automation.ts:1049-1060); `blocked`/`failed` satirlar filtrelenmez -> `last.direction !== "inbound"` -> `already_answered`.

Ama `already_answered`, runDueChannelAutoReplies'in damgalama listesinde YOK (automation.ts:1899-1908) ve `failures` listesine de girmiyor. Worker tarafinda ise 402 kalici terminal:

```
if (kind === "blocked") {
  // HTTP 402 "subscription not active" — a PERSISTENT integration-paused state ...
  status: "blocked", ...
```

yani `applyDeliveryEffect` hic kosmaz, konusma asla "answered" olmaz.

**Tetikleyici:** `DURABLE_OUTBOX_ENABLED=1` acilir (AÇIK İŞLER listesinde bekleyen adim) ve org'un Hospitable aboneligi 402'dedir — CLAUDE.md'ye gore Nuve'nin CANLI durumu tam olarak budur. Her oto-yanit karari enqueue edilir, worker 402 gorup satiri `blocked` yapar, konusma `status:"new"` + outbound kuyruk halinde donar. Ayni sey `failed` (attempts exhausted) icin de gecerli. 25 boyle konusma birikince `take: 25` (siralama `lastMessageAt asc`) tamamen dolar.

**Etki:** Org'un oto-yaniti sessizce ve tamamen olur: yeni misafir mesajlari aday listesine hic giremez. Hicbir sayacta gorunmez — `already_answered` ne `sent` sayilir, ne `failures`'a girer, ne `skippedReason` yazar, ne Sentry'ye duser. Bu, automation.ts:1811-1819'da belgelenip kapatildigi soylenen ACLIK sinifinin outbox yolundan geri gelmesidir.

**Önerilen düzeltme:** Ya kanonik filtreyi genislet (canceled'in yani sira terminal `blocked`/`failed` outbox satirinin Message'ini da dus — o mesaj misafire ULASMADI, thread'i cevaplanmis gostermemeli), ya da `already_answered` sonucunu damgala (`autoReplyAttemptedAt`); misafir yeni mesaj yazinca `lastMessageAt` damgayi gectigi icin konusma kendiliginden geri gelir. Ek olarak worker terminal `blocked`/`failed` durumunda konusmaya gorunur bir `skippedReason` yazmali.

---

## 12. 🟠 YÜKSEK — Gönderilenler ekranı teslim edilmemiş outbox mesajlarını (canceled/pending/failed/review) "gönderildi" diye listeliyor ve sayıyor — oysa aynı düzeltme reports.ts ve quality-audit.ts'e uygulanmış.
**Yer:** `src/app/(app)/sent/page.tsx:118-124, src/app/(app)/sent/page.tsx:203, src/lib/outbox/worker.ts:505-512`

**Kanıt:** /sent'in tek filtresi: `const replyWhere: Prisma.MessageWhereInput = { direction: "outbound", OR: [{ authorType: "ai" }, { authorType: null, senderName: "GuestOps AI" }], conversation: { property: { organizationId: orgId }, channel: { not: "chat" } } };` — outbox durumu HİÇ sorgulanmıyor (dosyada `messageOutbox` geçmiyor). Sayaç da aynı where ile: `prisma.message.count({ where: replyWhere })` (satır 203). Karşılaştır: reports.ts:702-711 ve quality-audit.ts:98-107 aynı pencerede `messageOutbox.findMany({ where: { organizationId, status: { not: "sent" }, messageId: { not: null }, createdAt: { gte: since } } })` ile `undeliveredIds` çıkarıp `id: { notIn: undeliveredIds }` uyguluyor. worker.ts:508-512 `cancelRow` yorumu ise şunu iddia ediyor: "Because every guest/host view derives visibility from that single status ... the cancellation and the invisibility are ATOMIC" — /sent için bu YANLIŞ (inbox/[id]/page.tsx:113 ve automation.ts:1050 filtreliyor, /sent filtrelemiyor).

**Tetikleyici:** DURABLE_OUTBOX_ENABLED=1 iken herhangi bir AI oto-yanıtı enqueue edilir (Message ENQUEUE anında yazılır, automation.ts:1579). Send-time veto onu iptal ederse (host arada elle cevapladı → `superseded_by_newer_message`; thread "Sorunlu"ya döndü → `escalated_or_closed`) ya da satır `pending`/`failed`/`review`de kalırsa, mesaj yine de Gönderilenler'de "Oto-yanıt" olarak, enqueue zaman damgasıyla görünür.

**Etki:** Host, misafire hiç ulaşmamış bir mesajı gönderilmiş sanır — ve CLAUDE.md'nin bayrak açılışı için işaret ettiği doğrulama ekranı tam olarak burası ("İlk gerçek gönderimleri Gönderilenler'den doğrula"). Yani outbox'ı canlıya alırken güvenilecek ekran, sessizce yanlış cevap veren ekran.

**Önerilen düzeltme:** reports.ts:702 desenini birebir uygula: `replyWhere`'e org+pencere kapsamlı `undeliveredIds` çıkarımı ekle (`status: { not: "sent" }, messageId: { not: null }`) ve hem findMany hem count aynı where'i kullanmaya devam etsin (ekranın kendi "sayaç ile liste aynı koşulu paylaşsın" kuralı zaten var).

---

## 22. 🟡 ORTA — Durable-outbox yolunda kalıcı `failed` olan bir oto-yanıt, konuşmayı sonsuza dek `already_answered` durumunda bırakıyor: ne yeniden denenir, ne damgalanır, sebep alanı da null'lanmıştır — ve `take:25` kuyruğunun BAŞINDA yer işgal eder
**Yer:** `src/lib/automation.ts:1575-1614 (enqueue dalı), :1609-1613 (skippedReason null), :1049-1062 (already_answered), :1897-1915 (damgalanan sebep listesi), :1838-1844 (sıra + tavan)`

**Kanıt:** Enqueue dalı bilerek durum claim'i yapmıyor ve sebebi temizliyor:
```
1609  await prisma.conversation
1610    .update({
1611      where: { id: conversation.id },
1612      data: { skippedReason: null, lastRiskLevel: result.riskLevel, lastRiskType: result.riskType },
1613    })
```
`enqueueOutbound` (outbox/enqueue.ts:88-104) `externalId`'siz bir OUTBOUND Message yaratıyor. Worker teslimi doğrulamadıkça konuşma "new" kalıyor (`worker.ts:449-456` → `markConversationDelivered` yalnız onaylı teslimde).

Sonraki turda `applyChannelAutoReply` şu dala giriyor (:1049-1062): son mesaj outbound ve `externalId` yok → yalnız `status:"canceled"` outbox satırları süzülüyor. Kalıcı `failed` satır `canceled` DEĞİL (`worker.ts:651` `status: "failed"`; `canceled` yalnız veto yolunda, `worker.ts:514-522`) → süzülmüyor → `return { sent: false, skippedReason: "already_answered" }`.

`runDueChannelAutoReplies`'in damgalama listesi (:1899-1909) `already_answered` İÇERMİYOR → `autoReplyAttemptedAt` yazılmıyor. Aday sorgusu ise `status: "new"` + `lastMessageAt >= freshSince` + `autoReplyAttemptedAt` boş → satır KALICI aday. Sıra `orderBy: { lastMessageAt: "asc" }` (:1838) ve tavan `take: 25` (:1844) → en e

**Tetikleyici:** `DURABLE_OUTBOX_ENABLED=1` açıldıktan sonra bir oto-yanıtın outbox satırı kesin hatayla deneme bütçesini tüketip `failed`'a düşüyor (Hospitable kalıcı 4xx). Konuşma o andan itibaren her 2 dakikada seçiliyor, iki sorgu koşuyor, `already_answered` dönüyor; misafirin mesajı bir daha ASLA modellenmiyor ve gönderilmiyor. Yeterince böyle satır birikince 25 slotun tamamını kaplayıp yeni misafir mesajlarını açlığa sokuyorlar.

**Etki:** Misafirin sorusu kalıcı cevapsız kalıyor ve konuşmanın `skippedReason`'ı null'landığı için inbox'ta hiçbir gerekçe rozeti yok (yalnız thread içindeki mesajın outbox durum rozeti kalıyor, `inbox/[id]/page.tsx:120`). Daha kötüsü: `:1811-1819`'daki yorumun "KALICI AÇLIK" diye tarif ettiği ve SQL filtresiyle kapatılan sınıf, bayrak açık yolda yeniden açılıyor — o filtre yalnız DAMGALANMIŞ satırları kapsıyor, damgalanamayan bu satırları değil. Bugün canlıda etkisi yok (bayrak KAPALI) ama bayrak açılışı lansman kontrol listesinde.

**Önerilen düzeltme:** İki seçenekten biri: (1) `applyChannelAutoReply`'ın süzme dalını (:1049-1060) `status: { in: ["canceled", "failed"] }` yapmak — kesin teslim edilmemiş bir taslak da thread'in kuyruğunu temsil etmemeli, böylece konuşma yeniden değerlendirilir; ya da (2) `runDueChannelAutoReplies`'te `already_answered` için de `autoReplyAttemptedAt` damgalamak (satır adaylıktan düşer, misafir yeni yazınca `lastMessageAt` damgayı geçtiği için kendiliğinden geri gelir). (1) tercih edilir: hem açlığı hem cevapsız kalmayı birden çözer. Ayrıca `failed` satırda `skippedReason`'ı geri yaz ki inbox'ta sebep görünsün.

---

## 23. 🟡 ORTA — Supply 'kendini iyilestiren' supurge, ithal edilmis mesajlari 48 saatlik pencerede hic goremiyor — cunku pencere SAGLAYICI zaman damgasina bakiyor, ithal anina degil.
**Yer:** `src/lib/supply.ts:289, src/lib/supply.ts:314-323, src/lib/hospitable-sync.ts:1023, src/lib/hospitable-sync.ts:420-423`

**Kanıt:** Ithal edilen satirin `createdAt`'i saglayicinin damgasi:
  hospitable-sync.ts:1023 `createdAt: parseDate(m.created_at) ?? undefined,`
Supurge ise ayni kolonu 'son 48 saat' diye suzuyor:
  supply.ts:289 `const SUPPLY_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000;`
  supply.ts:317 `createdAt: { gte: new Date(now.getTime() - SUPPLY_SWEEP_WINDOW_MS) },`
Yani 48 saatten eski bir misafir mesaji ithal edildigi ANDA zaten pencerenin disindadir; inline turetme basarisiz olsa bile supurge o satiri ASLA secemez. Senkron tarafindaki yorum bunun tersini vaat ediyor:
  hospitable-sync.ts:420-423 "...the end-of-run sweep re-derives anything missed, so a transient error is a delay — not permanent loss."
Ayni yanilgi supply.ts:293-296'da da yazili ("the next sync deduped the message by externalId and never re-emitted the job" — cozuldu deniyor).

**Tetikleyici:** Herhangi bir >48 saatlik saglayici damgali mesajin ilk kez ithal edildigi an + o mesaj icin `recordSupplyRequestFromMessage`'in gecici hata vermesi (DB hickirigi, baglanti havuzu, timeout). Bu marjinal degil: (a) Hospitable ilk baglandiginda geriye 540 gunluk pencere (scheduled-sync.ts:252) tum eski thread'leri ithal eder, o kosuda mesajlarin NEREDEYSE TAMAMI 48 saatten eskidir; (b) saatlik derin gecis de surekli eski konaklamalardan mesaj ceker.

**Etki:** Kayip GECICI degil KALICI: mesaj bir dahaki senkronda `externalId` ile dedupe edilir, inline is bir daha uretilmez ve supurge o satiri goremez → misafirin 'ekstra havlu/carsaf' talebi hazirlik planina hicbir zaman girmez. Codex 07-24 #5'te tam olarak bu sinifi kapatmak icin yazilan mekanizma, en buyuk vaka grubunu (toplu/eski ithalat) kapsam disi birakiyor. Kosu sonunda `supply-derivation org:...` alarmi duser ama 'gecikme' diye okunur, oysa kayiptir.

**Önerilen düzeltme:** Supurgeyi ithal anina gore penceresle — mesaj satirinda ayri bir `importedAt` yoksa en ucuz dogru filtre `Conversation.updatedAt`/`syncCursorAt` uzerinden yurumek ya da Message'a `@@index` + `id` (cuid, monotonik degil) yerine kalici bir `importedAt DateTime @default(now())` kolonu eklemektir (migration — kullanici onayi gerekir). Migration'siz ara cozum: inline turetme basarisiz olan `sourceMessageId`'leri kosu icinde toplayip supurgeye ACIK LISTE olarak gecmek (pencereden bagimsiz). Her hâlükârda hospitable-sync.ts:420-423 ve supply.ts:293-296 yorumlari bugunku kapsami dogru anlatacak sekild

---

## 24. 🟡 ORTA — fetchAllPages sayfa sayisi tavaninda SESSIZCE kesiyor ve `per_page` hic istemiyor — kirpilmis bir rezervasyon listesi, tam listeden ayirt edilemiyor.
**Yer:** `src/lib/hospitable.ts:170-171, src/lib/hospitable.ts:190-215, src/lib/hospitable.ts:281-297`

**Kanıt:** hospitable.ts:171 `const MAX_PAGES = 40;`
hospitable.ts:196-199 `for (let page = 1; page <= MAX_PAGES; page++) { const p = new URLSearchParams(params); p.set("page", String(page)); ... }`  ← `per_page` HICBIR yerde set edilmiyor (repo genelinde arandi: yalnizca outbox/worker.ts'te alakasiz bir MAX_PAGES var).
Dongu 40. sayfadan sonra kosulu bitirip :214 `return items;` ile KISMI listeyi dondurur — istisna yok, bayrak yok, sayac yok, log yok. Cagiranlar (`listReservations` :296, `listMessages` :304, `listProperties` :229) donen dizinin eksik olup olmadigini bilemez.
Satir tavani icin yazilan aciklama (:179-188) 10.000'i operatif tavan gibi sunuyor: "`MAX_PAGES` sayfa sayisini sinirliyordu ama sayfa BOYUTUNU saglayici belirler — yani satir sayisinin gercek bir tavani yoktu." Bu yalnizca YUKARI yon icin dogru; ASAGI yonde de MAX_PAGES bagliyor ve gercek tavan `min(40 × saglayiciSayfaBoyutu, 10.000)`. Sayfa boyutu istenmedigi ve dogrulanmadigi icin bu deger bilinmiyor.

**Tetikleyici:** Bir dairenin secili pencerede (derin gecis: geriye 540 + ileri 365 gun ≈ 905 gun, scheduled-sync.ts:252-254) 40 sayfadan fazla rezervasyonu olmasi. Saglayici varsayilani 25/sayfa ise tavan 1.000 satir; 10/sayfa ise 400 satir — yuksek doluluklu bir dairede 905 gun × ~3-4 gecelik konaklama zaten bu mertebede.

**Etki:** Kirpilan rezervasyonlar ve UZERLERINDEKI TUM MESAJ THREAD'LERI o kosuda (ve sayfa boyutu degismedigi surece HER kosuda) hic iceri alinmaz: oto-yanit da sikayet eskalasyonu da onlari hic gormez. Kosu `ok: true` doner, `fetchFailures` artmaz, hicbir alarm cikmaz — bu dosyanin 07-31 turunda kapatmaya calistigi 'sessiz kayip' sinifinin ta kendisi, ama istemci katmaninda.

**Önerilen düzeltme:** Iki satir: (1) `p.set("per_page", "100")` (ya da saglayicinin izin verdigi ust deger) — sayfa boyutunu pinlemek MAX_PAGES'i anlamli bir satir tavanina cevirir; (2) kirpilma OLGUSU'nu disari ver — `fetchAllPages` `{ items, truncated }` dondursun, `syncHospitable` `truncated` gorunce kosu basina tek aggregate `reportError` bassin (kardeslerin emsali). MAX_ITEMS kirpmasi (:205) da ayni bayragi set etmeli.

---

## 25. 🟡 ORTA — Claim sorgusunda `LIMIT ${batchSize}` en dışta; kilitlenen/puanlanan aday kümesi SINIRSIZ — maliyet batch'e değil biriken kuyruğa bağlı ve TX Prisma'nın 5 sn varsayılanında koşuyor, aşınca drain fail-CLOSED duruyor.
**Yer:** `src/lib/outbox/worker.ts:250-267, src/lib/outbox/worker.ts:237-249, src/lib/outbox/worker.ts:274, src/lib/outbox/worker.ts:181-190, src/lib/outbox/worker.ts:829-836, src/lib/db.ts:8-12`

**Kanıt:** En içteki `locked` alt-sorgusunda LIMIT YOK: `SELECT s."id", ... FROM "MessageOutbox" s WHERE s."status" IN ('pending','ambiguous') AND s."availableAt" <= ${now} ... ORDER BY s."availableAt" ASC, s."createdAt" ASC FOR UPDATE SKIP LOCKED` (250-267). `ranked` katmanı bu kümenin HER satırı için korelasyonlu bir skaler alt-sorgu koşuyor (`SELECT count(*) FROM "MessageOutbox" h WHERE h."organizationId" = ... AND h."externalReservationId" = ... AND h."claimedAt" > ${now}::timestamptz - interval '60 seconds'`, 237-249) ve ancak ondan sonra `LIMIT ${batchSize}` (274) uygulanıyor. Tüm bu iş `prisma.$transaction(async (tx) => {...})` içinde, HİÇBİR seçenek verilmeden (181) — yani Prisma'nın interaktif TX varsayılanı (timeout 5000ms, maxWait 2000ms). Repo bunun farkında: ağır TX'lerde açıkça yükseltiyor (`{ timeout: 60_000, maxWait: 15_000 }` hospitable-sync.ts:292; `{ timeout: 180_000, maxWait: 15_000 }` hospitable-sync.ts:392, erasure.ts:609). Hata hâlinde 830-836: `catch { await reportError("outbox-claim", err); return acc; }` — fail-CLOSED, hiçbir satır alınmıyor.

**Tetikleyici:** Sağlayıcı arızası veya uzun 402/timeout serisi biriktirince `pending`+`ambiguous` aday sayısı büyür (drain yalnız 2 dakikada bir 20 satır boşaltıyor: DEFAULT_BATCH=20, scheduled-sync.ts:371). Aday sayısı × MessageOutbox'ın org satır sayısı çarpımı 5 sn'yi aştığı an claim TX P2028 ile düşer; hiçbir satır claim edilmediği için aday kümesi KÜÇÜLMEZ, bir sonraki geçişte daha da büyür — kendini besleyen kalıcı durma. MessageOutbox'ta hiçbir silme/retention yolu yok (repoda `messageOutbox.deleteMany` geçmiyor), tablo sonsuza kadar büyüyor.

**Etki:** Tüm giden mesaj kuyruğu sessizce durur (tek throttle'lı reportError dışında sinyal yok) ve tam olarak sağlayıcı arızasından sonra, yani kuyruğun en dolu olduğu anda. Ekranda satırlar "sıraya alındı" kalır.

**Önerilen düzeltme:** İki adım: (1) claim TX'ine açık `{ timeout: 30_000, maxWait: 10_000 }` ver (repo emsali var). (2) Aday kümesini sınırla — ama `rn` doğruluğunu koruyarak: en içteki taramayı `LIMIT ${batchSize * 4}` gibi bir tavanla kes ve `recent` alt-sorgusunu destekleyecek `@@index([organizationId, externalReservationId, claimedAt])` ekle; ayrıca NOT EXISTS için `@@index([conversationId, status])`. (Not: naif `LIMIT` en içe konursa rezervasyon-başı 2/dk kapağının `rn` sıralaması bozulur — tavan batch'ten belirgin büyük seçilmeli.)

---

## 26. 🟡 ORTA — `claimExpiresAt` TÜM batch için bir kez hesaplanıyor (5 dk / 20 satır); 20 sn'lik Hospitable timeout'uyla son satırların lease'i gönderimden ÖNCE bitiyor — email-outbox.ts'te bulunup düzeltilmiş olan aynı hata worker.ts'te duruyor.
**Yer:** `src/lib/outbox/worker.ts:39, src/lib/outbox/worker.ts:819-820, src/lib/outbox/worker.ts:831, src/lib/outbox/worker.ts:839-841, src/lib/outbox/worker.ts:153-169`

**Kanıt:** `const CLAIM_TTL_MS = 5 * 60_000;` (39) ve `const DEFAULT_BATCH = 20;` (40). Drain başında TEK damga: `const nowDate = now(); const expiry = new Date(nowDate.getTime() + CLAIM_TTL_MS);` (819-820), sonra `claimBatch(token, nowDate, expiry, ...)` tüm satırlara AYNI `claimExpiresAt`'i yazıyor (226-227). İşleme SERİ: `for (const row of rows) { await processOne(row, token, resolved, acc); }` (839-841). Satır başına üst sınır: hospitable.ts:28 `const TIMEOUT_MS = 20_000` (outbox `{ retries: 0 }` geçiyor, worker.ts:110) + tokenFor + veto sorguları. 20 × 20 sn = 400 sn > 300 sn. `recoverStaleClaims` (153-169) `status IN ('sending','reconciling') AND claimExpiresAt <= now` gördüğü satırı `ambiguous`'a çevirip `claimedBy: null` yapıyor. Karşılaştır: email-outbox.ts:84-95 aynı hatayı ADIYLA belgeliyor ve DB `now()` ile CAS anında lease'i yeniden damgalayarak çözüyor (413-419); worker.ts'te böyle bir yenileme yok.

**Tetikleyici:** İki drain'in çakışması gerekiyor: `runScheduledSync` global SystemLock TTL'i 15 dk (scheduled-sync.ts:78) ve geçiş bütçesi 12 dk + son org (satır 276) — CLAUDE.md'nin kendi ifadesiyle "TTL aşımı imkânsız DEĞİL". Aşarsa ikinci replika drain'e girer, `recoverStaleClaims` ilk drain'in HÂLÂ uçuşta olan `sending` satırlarını (lease'leri batch başından beri sayıyor) `ambiguous`'a çevirir. İlk drain'in gönderimi BAŞARIYLA döner ama `settle`'ın `{ id, claimedBy: token, status: fromStatus }` koşulu tutmaz (312-315) → hiçbir şey yazılmaz.

**Etki:** Misafire GİDEN mesaj sistemde `ambiguous` → (defaultReconcile hiçbir zaman doğrulamaz, 129-132) → `review` olarak kalır. Konuşma "answered" işaretlenmez, lifecycle *SentAt damgalanmaz, thread'de "sağlayıcıdan doğrulanamadı" rozeti çıkar ve ops ekranı bu sınıfa yeniden gönderim düğmesi vermez. `healDeliveryEffects` bunu ONARAMAZ: yalnız `status: "sent"` satırları tarıyor (698-703, 768-772). Ayrıca `acc.sent++` `done` false olsa da artıyor (646) → koşu logu da yalan söylüyor.

**Önerilen düzeltme:** Lease'i satır başına, gönderimin hemen ÖNCESİNDE yenile (email-outbox.ts:413-419 deseni): `processOne` girişinde `updateMany({ where: { id, claimedBy: token, status: row.status }, data: { claimExpiresAt: <DB now() + TTL> } })`; ya da en azından `CLAIM_TTL_MS`'i `batchSize × (provider timeout + pay)` üzerinden türet. `acc.sent++`/`acc.reconciled++` sayaçlarını `done` bayrağına bağla.

---

## 27. 🟡 ORTA — EMAIL_OUTBOX_ENABLED kapatılırsa kuyruktaki kimlik e-postaları KALICI olarak mahsur kalır — drain, süre-dolumu iptali ve retention silme üçü de bayrağın arkasında; mesaj outbox'ında aynı sorun bilinçle çözülmüş.
**Yer:** `src/lib/email-outbox.ts:310-312, src/lib/email-outbox.ts:319-323, src/lib/email-outbox.ts:504-509, src/lib/email-outbox.ts:583-589, src/lib/outbox/worker.ts:134-145, src/lib/scheduled-sync.ts:369`

**Kanıt:** `drainEmailOutboxOnce`: `if (!emailOutboxEnabled()) return result;` (312) — bu satır süre-dolumu iptalinin (320-323 `updateMany({ where: { status: "pending", expiresAt: { lte: now } }, data: { status: "canceled", payloadEnc: null } })`) ÜSTÜNDE. `sweepEmailOutbox`: `if (!emailOutboxEnabled()) return out;` (508) — recovery VE retention silmelerinin (583-589) üstünde. Mesaj outbox'ında tam tersi bilinçle yapılmış: worker.ts:134-138 "The WORKER must drain the queue even when the enqueue flag is OFF — otherwise an emergency rollback (flag flipped off) would strand already-queued messages forever" ve scheduled-sync.ts:369 `if (durableOutboxEnabled() || (await hasDrainableOutbox()))`. email-outbox'ta bu eşdeğer yok.

**Tetikleyici:** Bayrak bugün CANLI (`EMAIL_OUTBOX_ENABLED=1`). Acil geri alma için 0'a çekilirse: o anda `pending` olan doğrulama/şifre-sıfırlama satırları hiçbir zaman drain edilmez, `expiresAt` geçtiğinde bile `canceled`'a çevrilmez, 7/30 günlük retention silmesi de koşmaz.

**Etki:** (1) Bayrağın kapandığı ana denk gelen kullanıcı e-postasını hiç almaz — hash'i (`pwResetCodeHash` vb.) yazıldığı için ekranda "kod gönderildi" görür; ancak elle tekrar isteyerek (legacy yol) çözebilir. (2) Modülün kendi sözleşmesi delinir: "payloadEnc is NULLed on EVERY terminal transition" ve 7/30 günlük saklama (99-101) fiilen durur — ham doğrulama token'ı/kodu içeren `payloadEnc` şifreli metni DB'de süresiz kalır.

**Önerilen düzeltme:** worker.ts desenini kopyala: `sweepEmailOutbox` içindeki süre-dolumu iptali + retention silmesi bayraktan MUAF olsun (ikisi de dış çağrı yapmaz, boş kuyrukta no-op'tur); veya `drainEmailOutboxOnce`/`sweepEmailOutbox` çağrı yerine `hasDrainableEmailOutbox()` eşdeğeri koy.

---

## 30. 🟡 ORTA — QR PIN kilitlenmesi kalıcı olarak beslenebiliyor: fotoğrafı çeken saldırgan, meşru misafirin konaklamayı ASLA bağlayamayacağı bir döngü kurabiliyor (ve ev sahibinin bunu görecek hiçbir sinyali yok)
**Yer:** `src/lib/guest-chat-pin.ts:36-38,170-206,230-247 · src/app/api/chat/[token]/route.ts:225-248`

**Kanıt:** Kalıcı kilit: `QR_PIN_MAX_ATTEMPTS = 10`, `QR_PIN_LOCKOUT_MS = 15 * 60_000` (`guest-chat-pin.ts:36-38`). 10. hatalı denemede kilit kuruluyor ve sayaç sıfırlanıyor:
```ts
// guest-chat-pin.ts:238-242
if ((post?.chatPinFailedCount ?? 0) >= QR_PIN_MAX_ATTEMPTS) {
  await prisma.reservation.updateMany({ where: { id: reservationId },
    data: { chatPinLockedUntil: new Date(now.getTime() + QR_PIN_LOCKOUT_MS), chatPinFailedCount: 0 } });
}
```
Rotadaki per-IP tavan bunu engellemiyor: `rateLimit('guestchat-pin:'+clientIp, 8, 5*60_000)` (`route.ts:235`) = 15 dakikalık pencerede 24 deneme hakkı, kilidi taze tutmak için gereken 10'dan fazlası. Yani TEK bir IP kilidi süresiz besleyebilir.

Kritik nokta: saldırgan bu yola ancak konaklama BAĞLANMAMIŞKEN girebiliyor (`route.ts:225-227` — bağlıysa `match`/`mismatch` ile erken dönüş). Kilit ise misafirin bağlanmasını engellediği için konaklama bağlanmamış KALIYOR → saldırı kendi kendini besliyor.

**Tetikleyici:** `QR_PIN_ENABLED=1` ve konaklamanın PIN'i var (ya da org strict mode). Daireden QR fotoğrafı olan biri (önceki misafir / temizlikçi / komşu — PIN özelliğinin savunmak için var olduğu tam kişi), 15 dakikada bir 10 hatalı ama BİÇİMİ DOĞRU (6 haneli) PIN gönderiyor. Meşru misafir giriş yaptığında ekranda sürekli "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin" görüyor ve sohbeti hiç açamıyor.

**Etki:** PIN özelliği kendi tehdit modelindeki saldırgan tarafından tamamen etkisizleştiriliyor: "saldırgan konaklamayı çalar" riski, "hiç kimse kullanamaz" arızasına dönüşüyor. Ev sahibi için hiçbir sinyal yok (tekrarlayan kilitlenme ne audit'e ne alarma düşüyor) ve `setReservationPin` kilidi temizlese bile saldırgan saniyeler içinde yeniden kuruyor — pratikte etkili bir çare yok. Misafir açısından ürün "bozuk" görünüyor.

**Önerilen düzeltme:** Kilidi kimliğe göre kademelendir: kilit süresini ardışık kilitlenmelerde artır (exponential) ve/veya `chatPinFailedCount`'u sıfırlamak yerine kilit sayacını ayrı tut, böylece tekrarlayan saldırı daha maliyetli olsun. En az bir görünürlük ekle: N'inci kilitlenmede ev sahibine (mevcut `sendQrEscalationAlertBounded` altyapısıyla, PII'siz) bildirim + audit kaydı — bugün bu olay hiçbir yere yazılmıyor. Ayrıca kilitli konaklamada ev sahibine panelden "bu cihazı ben onaylıyorum" (manuel bağlama) kaçış yolu düşünülebilir.

---

## 35. 🟡 ORTA — Onbellek pini kendi testinde "public"i yakaladigini iddia ediyor ama tarayici cikarim filtresi ciplak `public` degerini hic gormuyor.
**Yer:** `tests/unit/response-cache-policy.test.ts:55-60, 83-97`

**Kanıt:** Tarayicinin literal cikarimi:
```ts
function cacheControlLiterals(src: string): string[] {
  const literals = src.match(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g) ?? [];
  return literals.map((l) => l.slice(1, -1))
    .filter((v) => /\b(max-age|s-maxage|no-store|no-cache|must-revalidate|immutable)\b/i.test(v));
}
```
Filtrede `public` YOK. Yani `headers: { "Cache-Control": "public" }` literali daha `CACHEABLE` hakemine ulasmadan eleniyor. Buna ragmen ayni dosyada hakemin dogrulugunu "pinleyen" test aciktan sunu diyor:
```ts
for (const bad of ["public, max-age=60", "s-maxage=600", "max-age=0, s-maxage=600", "max-age=030", "public"]) {
  expect(CACHEABLE.test(bad), bad).toBe(true);
}
```
`CACHEABLE.test("public")` gercekten true — ama tarama boru hattinda o deger asla test edilmiyor. Okuyan kisi "ciplak public de kapsanmis" sonucunu cikarir; kapsanmamis.

**Tetikleyici:** Bir API rotasina `return new NextResponse(json, { headers: { "Cache-Control": "public" } })` eklenmesi. `offenders` bos kalir, test yesil gecer. (RFC 9111'de tek basina `public` yaniti paylasimli onbellege sokar ve heuristik tazelik uygulanir — bu testin savundugu tehdidin en saf hali.)

**Etki:** Kiraciya ozel bir JSON yaniti CDN/proxy tarafindan saklanabilir hale gelir ve bir musterinin verisi baskasina servis edilir; kodun hicbir yerinde hata gibi gorunmez ve pin sessiz kalir.

**Önerilen düzeltme:** `cacheControlLiterals` filtresine `public` (ve istenirse `proxy-revalidate`) ekle — ya da daha basiti: `Cache-Control` yazan satirdaki/ dosyadaki TUM literal'leri `CACHEABLE`'a ver, on-filtreyi kaldir.

---

## 37. 🟡 ORTA — plan-limits testindeki gerekce yorumu artik yanlis: "applyChannelAutoReply sayaca dokunmuyor" diyor, kaynak kodun kendi yorumu bu iddianin yalan oldugunu yaziyor.
**Yer:** `tests/unit/plan-limits.test.ts:111-117, src/lib/billing/plan-limits.ts:126-131, src/lib/automation.ts:1259-1261`

**Kanıt:** Test:
```ts
it("kart 'AI YANITI' DEMEZ — sayac misafire giden yaniti saymiyor", () => {
  // `consumeDailyAiBudget` yalniz panel ici islemlerden cagriliyor (oneri,
  // ceviri, test, hazirlik ozeti); `applyChannelAutoReply` sayaca dokunmuyor.
  expect(landing).not.toContain("AI yaniti");
});
```
Kaynak bunun tersini soyluyor (`automation.ts:1259`):
```ts
if (!options.dryRun && result.source === "openai") {
  await consumeDailyAiBudget(conversation.property.organizationId).catch(() => {});
}
```
ve `plan-limits.ts:126-131` acikca: "sebebi 07-31'den beri TERSINE dondu ve yorum bir sure yalan soyledi: sayac artik misafire giden otomatik yaniti DA sayiyor... 'Yanit' dememesinin sebebi kapsamin DAHA GENIS olmasi". Test yorumu tam da duzeltilmis olan yanlis inanci yeniden uretiyor.

**Tetikleyici:** Kod okumasi — testi/yorumu okuyan bir sonraki tur "oto-yanit kotadan dusmuyor" varsayimiyla hareket eder.

**Etki:** Fiyatlandirma/kota konusunda musteriye ne satildigi hakkinda yanlis zihinsel model. Somut risk: biri "madem oto-yanit sayilmiyor, kotayi sadece panel islemleri icin dusurelim" ya da tersi bir karar verir; ayrica 07-31'de duzeltilen kapsam hatasi (en buyuk harcama kaleminin sayaca dokunmamasi) yanlislikla geri getirilebilir.

**Önerilen düzeltme:** Test yorumunu kaynagin yorumuyla esitle (kapsam DAHA GENIS: oto-yanit + panel islemleri). Bonus: `expect(landing).not.toContain("AI yaniti")` Turkce cogul/iyelik ekli bicimi ("AI yanitlari") yakalamaz — gerekiyorsa regex'e cevir.

---

## 38. 🔵 DÜŞÜK — runDueChannelAutoReplies dongusunde try/catch yok; applyChannelAutoReply'in acik `throw err`i org'un o turdaki kalan tum otomasyonunu (yasam-dongusu mesajlari dahil) ve toplu ariza alarmini dusuruyor.
**Yer:** `src/lib/automation.ts:1719-1726, src/lib/automation.ts:1864-1865, src/lib/scheduled-sync.ts:334-338`

**Kanıt:** Teslimat BASARILI olduktan SONRA acik bir rethrow var:

```
} catch (err) {
  // Delivery already SUCCEEDED. ...
  if (!isUniqueViolation(err, ["conversationId", "externalId"])) throw err;
  await conversationDone;
}
```

Dongu ise ciplak:
```
for (const c of eligible) {
  const outcome = await applyChannelAutoReply(c.id);
```
(1864-1924 arasinda hicbir try/catch yok.) Cagiran tarafta ise auto-reply, kardes yollarin ONUNDE:
```
const auto = canAutomate ? await runDueChannelAutoReplies(org.id) : { sent: 0 };
const welcome = canAutomate ? await sendDueWelcomes(org.id) : { sent: 0 };
const checkin = ...; const checkout = ...;
```

**Tetikleyici:** Basarili bir gonderimden sonra `$transaction`in P2002 [conversationId, externalId] DISINDA bir hata vermesi — ornegin konusma ayni anda silinmis (P2025), baglanti havuzu tukenmis, ya da statement timeout. Ayrica ayni etkiyi dongudeki korunmasiz `prisma.conversation.updateMany` (claim, 1656) veya `fetchKnowledgeBaseForPrompt` / `getAdjacency` uzerindeki bir DB hatasi da uretir.

**Etki:** Tek bir konusmadaki DB hickirigi (a) o turda kalan aday konusmalarin islenmemesine, (b) `failures` toplu reportError'unun HIC gonderilmemesine (o ana kadar biriken gercek gonderim arizalari kaybolur), (c) ayni org icin welcome/check-in/check-out mesajlarinin o gecise hic girmemesine yol acar. Kayip degil gecikme, ama gorunurlugu tam olarak kaybettigi nokta arizanin yasandigi tur.

**Önerilen düzeltme:** Dongunun govdesini try/catch'e al; beklenmedik hatayi `failures`'a ayri bir etiketle ekleyip (`unexpected`) bir sonraki konusmaya devam et. Boylece toplu alarm da kosar, kardes gecisler de calisir.

---

## 39. 🔵 DÜŞÜK — Sayisal `conversation_id` sessizce dusuruluyor; `externalConversationId` kalici NULL kalinca duplicate-temizleme aracinin 'iki farkli provider thread'i, silme' freni hic devreye girmiyor.
**Yer:** `src/lib/hospitable.ts:267, src/lib/hospitable-sync.ts:76-78, src/lib/hospitable-sync.ts:878, src/lib/conversations-cleanup.ts:105-115`

**Kanıt:** Tip alanin sayi olabilecegini ACIKCA soyluyor:
  hospitable.ts:267 `conversation_id?: string | number;`
Ama okuma yalnizca string kabul eden yardimciyla yapiliyor:
  hospitable-sync.ts:76-78 `function str(value: unknown): string | null { return typeof value === "string" && value.length ? value : null; }`
  hospitable-sync.ts:878 `externalConversationId: str(reservation.conversation_id),`
Kardes alanlarin hepsi sayiya karsi korunmus — `String(reservation.id)` (:788), `m.id != null ? String(m.id) : null` (:967), `g?.id ? String(g.id) : null` (:568) — yalniz bu biri degil. Repo'nun kendi fixture'i saglayicinin id'leri SAYI olarak serilestirdigini gosteriyor: tests/integration/hospitable-sync.test.ts:428 `id: 5001` (mesaj id'si sayi).
Tuketici taraf:
  conversations-cleanup.ts:109-111 `a.externalConversationId != null && b.externalConversationId != null && a.externalConversationId !== b.externalConversationId`
Iki taraf da null oldugunda bu kosul asla true olmaz.
Ayrica alan YALNIZ create dalinda yaziliyor (:878); update dalinda (:904-919) backfill yok → bir kez null dogan satir sonsuza dek null kalir.

**Tetikleyici:** Hospitable `conversation_id`'yi JSON sayisi olarak donduruyorsa (mesaj id'lerini oyle dondurdugu fixture'larda kabul edilmis) — ya da alan hic gelmiyorsa — tum konusmalarda `externalConversationId` NULL olur ve bir daha dolmaz.

**Etki:** `cleanupDuplicateConversations` GERI ALINAMAZ bir silme yapiyor (conversations-cleanup.ts:41-44 'a wrong delete costs them a guest's history permanently'). `conversationIdsConflict` freni tam olarak 'saglayici bu ikisini farkli thread sayiyor, insana birak' demek icin var; alan hep null olunca fren yok ve karar sadece `sameStay`'e kalir. Ikincil olarak m45 duplicate adli tibbi ('hepsinde AYNI externalConversationId') gelecekte tekrar yapilamaz — kanit alani bos.

**Önerilen düzeltme:** `externalConversationId: reservation.conversation_id != null ? String(reservation.conversation_id) : null` (mesaj/guest id'leriyle ayni desen) ve update dalina 'yalniz bossa doldur' backfill'i ekle: `...(existing.externalConversationId ? {} : { externalConversationId: convId })`. Genel kural olarak `str()`'nin saglayici KIMLIKLERI icin yanlis arac oldugu yorumla isaretlenmeli — bugun uc yerde String(), bir yerde str() kullaniliyor.

---

## 40. 🔵 DÜŞÜK — Adopt-and-heal yorumu 'POST id ile GET id farkliysa' vakasini kapsadigini soyluyor; sorgu `externalId: null` filtresiyle tam olarak o vakayi disliyor.
**Yer:** `src/lib/hospitable-sync.ts:983-996, src/lib/automation.ts:1714`

**Kanıt:** Yorum (hospitable-sync.ts:984-985): "...when the provider returned no message id (or a POST id that differs from this GET id) the local row's externalId stayed NULL". Ikinci parantez ici YANLIS: gonderim yolu POST id'yi dondurdugunde satira YAZIYOR —
  automation.ts:1714 `...(delivery.providerMessageId ? { externalId: delivery.providerMessageId } : {}),`
(ayni desen :300 ve :507'de de var). Yani POST id != GET id oldugunda yerel satirin `externalId`'si NULL DEGIL, POST id'sidir. Sorgu ise sadece null'lari ariyor:
  hospitable-sync.ts:993 `where: { conversationId, direction: "outbound", externalId: null, body },`
Ustelik ust taraftaki dedupe seti de GET id'yi bulamaz (:956-963 yalniz DB'deki externalId'leri yukler, orada POST id var) → :1011 `db.message.create(...)` calisir.

**Tetikleyici:** Hospitable POST /reservations/{id}/messages yanitinda donen id ile GET /reservations/{id}/messages'ta ayni mesaj icin donen id farkliysa. (Not: canli API'ye cikmadan bunu dogrulayamadim — kod tarafi kesin, saglayici davranisi varsayim.)

**Etki:** AI'nin gonderdigi her yanit bir sonraki senkronda IKINCI kez, `authorType: "host"` ve `senderName: senderFullName(m) ?? "Ev sahibi"` ile (:1018-1019) yazilir: misafir thread'i ekranda cift gorunur ve rapor sayimlari AI yanitini ev-sahibi yaniti olarak kredilendirir (rapor sayimi `senderName "GuestOps AI" OR aiAssisted` uzerinden yurudugu icin bu satir AI sayilmaz). Daha onemlisi yorum, bakim yapan kisiye 'bu vaka kapsandi' diyor — gercek bir duplicate arizasi arastirilirken yanlis yone sevk eder.

**Önerilen düzeltme:** Ya yorumdan yanlis iddiayi cikar ("yalnizca saglayici POST'ta id DONDURMEDIGINDE devreye girer"), ya da orphan sorgusunu gercekten kapsayici yap: ayni gövdeli outbound satiri `externalId: null` VEYA 'bu batch'te gorulmeyen bir externalId tasiyan' olarak ara ve heal et. Ikincisi riskli oldugundan (yanlis satiri sahiplenme) en azindan yorumun duzeltilmesi sart; kalici cozum gonderim yolunda POST id'sini ayri bir kolonda (or. `providerPostId`) tutup dedupe'u iki id uzerinden yapmaktir.

---

## 41. 🔵 DÜŞÜK — Durum geçiş haritası kapalı DEĞİL: retention ve erasure `status`'ü doğrudan yazıyor ve `ambiguous → canceled` haritada BULUNMAYAN bir geçiş — teslim edilmiş olabilecek mesaj "hiç gönderilmedi" diye kaydediliyor.
**Yer:** `src/lib/data-retention.ts:188-198, src/lib/erasure.ts:510-517, src/lib/outbox/state.ts:70-80, src/lib/outbox/worker.ts:304-311`

**Kanıt:** state.ts:75 `ambiguous: ["reconciling"],` — `canceled` listede yok, yani `canTransition("ambiguous", "canceled") === false`. Buna rağmen data-retention.ts:194-197 `status: { in: ["pending", "ambiguous"] }, claimedBy: null` → `data: { body: ANON_BODY, status: "canceled" }` ve erasure.ts:513-516 aynısını yapıyor. Bu iki yazma `settle`'ın kapısını (worker.ts:304-311 `if (typeof targetStatus === "string" && (!isOutboxStatus(targetStatus) || !canTransition(fromStatus, targetStatus))) { ... return false; }`) hiç görmüyor — doğrudan `prisma.messageOutbox.updateMany`. state.ts:25-26'nın "every transition goes through assertTransition, so no free-string drift creeps in" iddiası bu iki modül için geçerli değil.

**Tetikleyici:** 24 aylık retention süpürgesi (`anonymizeOldGuestData`) veya bir misafirin açık silme talebi, kuyrukta `ambiguous` bir satır varken koşar.

**Etki:** `canceled` semantiği kodda "hiçbir POST yapılmadan veto edildi" (worker.ts:506); `ambiguous` ise "POST edildi, sonucu bilinmiyor — misafire ulaşmış OLABİLİR". Etiketi değiştirmek mesajı host thread'inden tamamen kaldırıyor (inbox/[id]/page.tsx:113 `.filter((m) => outboxByMessage.get(m.id) !== "canceled")`) — misafir Airbnb'de görüyor olabilir, host göremiyor. Asıl risk ileriye dönük: geçiş kapısının delik olduğu iki nokta tam da durum makinesini bilmeyen modüller.

**Önerilen düzeltme:** Bu iki yazmayı ya `canceled` yerine ayrı bir terminal etikete (`purged`) taşı, ya da `ALLOWED.ambiguous`'a `canceled`'ı bilinçli olarak ekleyip gerekçeyi state.ts'e yaz. Ek olarak: `status` yazan tüm dosyaları kaynak-tarama pin testiyle sabitle (repo bu deseni zaten kullanıyor) ki gelecekte üçüncü bir modül sessizce eklenmesin.

---

## 42. 🔵 DÜŞÜK — plan-change.ts'teki proration yorumu, gönderilen davranışın ve UI metninin TERSİNİ söylüyor: "downgrade sonraki dönemde geçerli olur".
**Yer:** `src/lib/billing/plan-change.ts:53-60, src/components/settings/paddle-plans.tsx:441-446`

**Kanıt:** plan-change.ts:55-57 yorumu: "Downgrade → apply at the next billing period so the customer keeps the tier they already paid for until it renews (no refund math)." Oysa aynı akışın müşteriye gösterdiği metin (paddle-plans.tsx:442-444): "Değişiklik **hemen** geçerli olur (yeni plan limitleri anında uygulanır); aradaki fark bir sonraki faturanıza yansıtılır." CLAUDE.md kalıcı kararı da bunu doğruluyor ("downgrade HEMEN geçer, fark sonraki faturaya"). `prorated_next_billing_period` yalnız FATURALAMAYI erteler, item değişimini değil — webhook `subscription.updated` ile yeni fiyatı alır almaz planCode düşer (route.ts:167) ve `propertyLimit`/`limitsForOrg` anında daralır.

**Tetikleyici:** Kodu okuyan biri (ya da gelecekteki bir tur) "müşteri dönem sonuna kadar üst pakette kalıyor" varsayımıyla hareket ederse: örn. downgrade sonrası sınır kontrollerini gevşetmeye gerek yok sanır, ya da destekte müşteriye yanlış bilgi verir.

**Etki:** Doğrudan arıza değil ama para semantiği hakkında tek-kaynak olması gereken yerde yanlış yöne sevk eden bir iddia; downgrade sonrası "neden dairem/KB kaydım kilitlendi" sorusunun cevabı bu yorumda aranırsa bulunamaz.

**Önerilen düzeltme:** Yorumu gerçekle eşitle: "Downgrade → item değişimi HEMEN geçerli (limitler anında daralır); yalnız proration farkı sonraki faturaya yazılır (iade matematiği yok)."

---

## 43. 🔵 DÜŞÜK — Fatura tutarı okunamazsa Invoice sessizce 0 TL olarak yazılıyor — oysa aynı fonksiyon eksik para birimi için bilerek fail-closed davranıyor.
**Yer:** `src/app/api/webhooks/paddle/route.ts:291-320`

**Kanıt:** route.ts:294-295 `const grand = str(totals?.grand_total) ?? str((data.totals as ...)?.grand_total); const amountMinor = grand ? Number.parseInt(grand, 10) : NaN;` ve route.ts:320 `amountMinor: Number.isFinite(amountMinor) ? amountMinor : 0`. Hemen üstünde para birimi için TERS karar var (route.ts:304-311): eksikse satır YAZILMAZ + `reportError` ile sayfalanır, gerekçe yorumda "a missing invoice is recoverable from Paddle, a wrong one corrupts the books". Aynı gerekçe tutar için de geçerliyken tutar sessizce 0'lanıyor. Satır bir kez yazıldıktan sonra düzeltilemez: aynı `providerRef` ile ikinci deneme route.ts:288-289 `findFirst` erken dönüşüne ve `Invoice @@unique([provider, providerRef])`'e takılır (route.ts:332 P2002 → return).

**Tetikleyici:** `details.totals.grand_total` alanının bulunmadığı / string olmayan biçimde geldiği herhangi bir transaction olayı (Paddle payload biçim değişikliği, kısmi payload, ileride eklenecek bir olay tipi). Kod-doğrulaması: alan yoksa `str()` null → NaN → 0 dalı kesin.

**Etki:** Muhasebe kaydı "ödendi, 0,00" olarak kalıcılaşır; hem gelir raporu hem TTK m.82 kapsamında 10 yıl saklanacak fatura iskeleti yanlış olur ve retry ile kendiliğinden düzelmez. Sessiz — hiçbir alarm çıkmaz.

**Önerilen düzeltme:** Tutar için de para birimiyle aynı sözleşmeyi uygula: `grand_total` yoksa veya `Number.isFinite` değilse Invoice YAZMA + `reportError` ile sayfala (eksik fatura Paddle'dan geri alınabilir, yanlış fatura alınamaz).

---

## 44. 🔵 DÜŞÜK — verifyUsedSources, `property:city` iddiasını mülkün city alanı BOŞKEN de kabul ediyor — uydurma kaynak kanıt olarak görünüyor.
**Yer:** `src/lib/ai/index.ts:43-50`

**Kanıt:** Kardeş alan varlık kontrollü: `if (src === "property:address") return Boolean(input.property.address);` (43). Hemen altındaki beyaz liste ise yalnız İSİM kontrolü yapıyor: `const field = src.slice("property:".length); return field === "checkInTime" || field === "checkOutTime" || field === "name" || field === "city";` (48-49). `PropertyContext.city` NULLABLE (`city?: string | null`, types.ts:31) — yani city null olan bir mülkte model `"usedSources":["property:city"]` derse bu iddia hayatta kalıyor. Fonksiyonun kendi yorumu (45-47) tam bunu yasaklıyor: "a blanket `true` let the model inject a fabricated source … that then showed as a 'used context' chip, contradicting the invented-source-dropped guarantee".

**Tetikleyici:** city alanı boş bir mülk + model çıktısında `usedSources: ["property:city"]` (örn. cevapta şehir adı geçmemesine rağmen kaynak listesine eklenmesi).

**Etki:** Host'un öneri panelindeki "Kullandığı bağlam" çipi ve `Message.aiSourcesJson` kaydı, gerçekte var olmayan bir veri alanını kanıt olarak gösterir. Kanıt zincirinin ("kaynağı olmayan olgu cevapta OLAMAZ", prompts.ts:221-222) tek doğrulama noktası budur; tek alanda delik açık kalmış.

**Önerilen düzeltme:** `|| (field === "city" && Boolean(input.property.city))` — address ile aynı desen. Aynı şekilde `reservation:*` dalında da alanların boş olmadığı kontrol edilebilir.

---

## 45. 🔵 DÜŞÜK — Bilgi tabanı kategorileri isteme BÜYÜK HARFLE yazılıyor ama doğrulayıcı harf duyarlı karşılaştırıyor — GERÇEK kaynaklar sessizce düşüyor.
**Yer:** `src/lib/ai/prompts.ts:743, src/lib/ai/index.ts:40-42, src/lib/constants.ts:105-118`

**Kanıt:** İstemde kategori büyütülüyor: `const line = \`- [${k.category.toUpperCase()}] ${k.title}: ${k.content}\`;` (prompts.ts:743) → model prompt'ta `[WIFI]`, `[LOCAL_TIPS]`, `[CHECKIN]` görüyor. Doğrulayıcı ise saklanan değerle birebir karşılaştırıyor: `const kbCats = new Set(input.knowledgeBase.map((k) => k.category)); … if (src.startsWith("kb:")) return kbCats.has(src.slice(3));` (index.ts:40-42). Kategoriler KÜÇÜK harf enum: `{ value: "wifi" }`, `{ value: "local_tips" }` (constants.ts:110,116). Yani `"kb:WIFI"` → `kbCats.has("WIFI")` → false → kanıt DÜŞÜRÜLÜR. Örnekler küçük harf öğretiyor (`"usedSources":["kb:wifi"]`, prompts.ts:454) ama modelin gördüğü blok büyük harfli — çelişkili sinyal.

**Tetikleyici:** Model, KB bloğunda gördüğü yazımı kopyalayarak `"usedSources":["kb:WIFI"]` döndürür (aynı yanıt gerçekten kb:wifi'ye dayansa bile).

**Etki:** Kanıt alanı sessizce boşalır: öneri panelindeki "Kullandığı bağlam" bölümü boş görünür, `Message.aiSourcesJson` null kalır, Faz-B kanıt denetimi ("model gerçekten KB'ye mi dayandı?") kör olur. Uydurma kaynağı düşürme garantisi çalışıyor ama aynı mekanizma GERÇEK kaynağı da düşürüyor — ve iki durum dışarıdan ayırt edilemiyor.

**Önerilen düzeltme:** Karşılaştırmayı harf-duyarsız yap: `kbCats` kurulurken `k.category.toLowerCase()`, sorguda `src.slice(3).trim().toLowerCase()`. Alternatif olarak istemde kategoriyi büyütmeyi bırak — ama harf-duyarsız karşılaştırma her iki yazımı da kurtarır.

---

## 47. ✅ ÇÖZÜLDÜ (08-06, BELGE düzeltilerek) · 🔵 DÜŞÜK — CLAUDE.md "OpenAI istek sözleşmesi TEK KAYNAK: ai/openai-compat.ts (üç çağrı yeri: ana yanıt, gölge, hazırlık özeti)" diyor; ana yanıt yolu bu modülü HİÇ kullanmıyor — bakımcıyı yanlış dosyaya yönlendiriyor.
**Yer:** `src/lib/ai/index.ts:102-131, src/lib/ai/index.ts:307-322, src/lib/ai/translate.ts:131-153, src/lib/ai/openai-compat.ts:1-85`

**Kanıt:** `grep -rn "openai-compat" src/` yalnız İKİ tüketici gösteriyor: supply-ai.ts:11 ve shadow-ai.ts:10. Ana yanıt üretimi gövdeyi elle kuruyor: `const payload: Record<string, unknown> = { model, response_format: …, messages: … }; if (!isReasoningModel(model)) payload.temperature = 0.4; if (isReasoningModel(model)) payload.max_completion_tokens = 2000; else payload.max_tokens = 900;` (index.ts:106-121) ve endpoint'i sabit yazıyor (`fetch("https://api.openai.com/v1/chat/completions")`, 123). `summarizeHostStyle` (308-322) ve `translate` (133-153) de aynı şekilde kendi gövdelerini kuruyor. Yani openai-compat'ın üç kuralından ana yanıt yolunda YALNIZ ikincisi (gövde model ailesine göre) elle kopyalanmış; birincisi (`resolveCompatKey` anahtar-sağlayıcı eşleşmesi) ve üçüncüsü (`compatModelMatchesEndpoint` model↔endpoint uyumu) hiç yok.

**Tetikleyici:** Bir bakımcı (ya da sonraki bir Claude/Codex turu) istek sözleşmesinde bir kural değiştirmek için CLAUDE.md'ye güvenip yalnız `openai-compat.ts`'i düzenler.

**Etki:** Değişiklik yalnız gölge + hazırlık özeti yollarına iner; MİSAFİRE GİDEN yanıt ve çeviri eski şekilde kalır — ve bu fark yalnız canlıda, model ailesi değiştiği gün (ör. `OPENAI_MODEL` reasoning olmayan bir modele düşerse) görünür. Bugün canlıda bir arıza YOK (üç kopya bugün tutarlı, endpoint sabit olduğu için 1. kural konusuz, 3. kural ihlali yalnız 404 + fallback = güvenli yön); risk tamamen "tek kaynak" iddiasının yanlış olmasından geliyor.

**Önerilen düzeltme:** Ya `callOpenAI` (index.ts), `summarizeHostStyle` ve `translate` gerçekten `applyCompatModelParams` + `resolveCompatBaseUrl`/`resolveCompatKey`/`compatModelMatchesEndpoint` üzerinden geçsin, ya da CLAUDE.md'deki cümle gerçeğe çekilsin ("iki çağrı yeri: gölge + hazırlık özeti; ana yanıt/çeviri kendi gövdesini kurar"). İkisinden biri şart — bugünkü hâl sessiz bir tuzak.

**✅ YAPILAN (08-06):** İKİNCİ seçenek — belge gerçeğe çekildi. CLAUDE.md'deki
"TEK KAYNAK" cümlesi, `openai-compat.ts`'i yalnız `shadow-ai.ts` +
`supply-ai.ts`'in kullandığını ve ana yanıt (`ai/index.ts`, İKİ çağrı) ile
çevirinin (`ai/translate.ts`) OpenAI'yi DOĞRUDAN çağırıp reasoning kurallarını
kendi elleriyle uyguladığını AÇIKÇA söylüyor. Ek olarak
`tests/unit/openai-request-contract.test.ts` gerçek mimariyi PİNLER: doğrudan
çağıranların TAM listesi (yenisi eklenirse kırmızı → karar zorunlu), her birinin
`isReasoningModel` + `max_completion_tokens` + `max_tokens` dallanması taşıdığı,
ve compat'i import edenlerin tam listesi.

**Ana yanıt yolunu compat'e TAŞIMA (birinci seçenek) BİLİNÇLİ OLARAK YAPILMADI:**
gönderim hot-path'i, davranış bugün zaten doğru (dört çağrı yeri de doğru
dallanıyor), endpoint sabit olduğu için 1. ve 3. kural konusuz, ve kazanç yalnız
estetik. Yapılacaksa kendi turunda + golden set ile.

---

## 49. 🔵 DÜŞÜK — Org-yaraticilari "kapali liste" pini Prisma ic ice (nested) create ve createMany bicimlerini goremez; ayrica dosya basina yalniz ILK create cagrisini denetler.
**Yer:** `tests/unit/deployment-timezone.test.ts:151-185 (ozellikle 165 ve 181)`

**Kanıt:** ```ts
if (/\borganization\.create\s*\(/.test(src)) { creators.set(...) }
...
const call = src.match(/organization\.create\s*\(([\s\S]{0,400})/);
expect(call![1], `${file}: create cagrisinda timezone YOK`).toMatch(/timezone/);
```
Uc ayri kor nokta: (1) `prisma.user.create({ data: { organization: { create: { name } } } })` — deyimsel Prisma nested write; `organization.create(` desenine UYMAZ. (2) `organization.createMany(` — `create\s*\(` parantez sarti yuzunden eslesmez. (3) `src.match` global DEGIL → bir dosyada iki `organization.create` varsa yalniz ilki denetlenir; ayrica pencere 400 karakterle sinirli, uzun bir `data` blogunda `timezone` disarida kalabilir (bu yon yanlis-pozitif, guvenli).
Testin kendi iddiasi ise mutlak: "ILERIDE eklenecek ucuncu bir yaraticinin ayni sessiz varsayilana dusmesini engeller — listeye girmeden fark edilmemesi imkansiz".

**Tetikleyici:** Yeni bir kayit/onboarding akisinin org'u nested write ile yaratmasi (ornegin davet/ekip akisi). Liste pini yesil kalir, org sema varsayilanina duser.

**Etki:** .com'da bugun zararsiz (sema varsayilani Europe/Istanbul dogru), ama .eu acilisinda dogrudan yanlis: yeni org yanlis dilimle dogar → raporlarin gun siniri, otomatik mesaj saat penceresi ve QR acik-saat kapisi kayar; belirti saat dilimi hatasina benzemez.

**Önerilen düzeltme:** Deseni genislet: `/\borganization\.(create|createMany|upsert)\s*\(/` VE `/organization:\s*\{\s*create\b/`. `matchAll` kullanip dosyadaki HER create'i denetle; 400 karakterlik pencere yerine parantez sayarak cagri govdesini cikar (confirm-toast-hardening'deki JSX etiketi tarayicisinin emsali var).

---

## 50. 🔵 DÜŞÜK — Uc kaynak-tarama pini de yalnizca src/app/api altini yuruyor; Next'te tamamen gecerli olan src/app/<baska>/route.ts hicbirinin radarinda degil ve "test kendini bosa dusurmesin" korumalari da bunu gormez.
**Yer:** `tests/unit/api-route-scoping.test.ts:26,67-69; tests/unit/response-cache-policy.test.ts:24,65-67; tests/unit/email-identity.test.ts:80,100`

**Kanıt:** Ucunde de tek kok: `const API_DIR = path.resolve(__dirname, "../../src/app/api")`. Kendini-dogrulama korumalari sadece "yeterince dosya bulundum" diyor:
`expect(routes.length).toBeGreaterThan(50)` / `expect(files.length).toBeGreaterThan(50)` / `expect(byEmail.length).toBeGreaterThanOrEqual(5)`.
Api disindaki bir route.ts eklendiginde bu sayilar degismez, uc pin de yesil kalir. api-route-scoping'in "mantik route.ts DISINA tasinarak taramadan kacirilamaz" testi (109-115) de yalniz API_DIR icindeki yabanci dosyalari sayiyor — dizin DISINA cikmayi kapsamiyor.
Bugun ihlal yok (kod-dogrulandi: `find src/app -name route.ts -not -path "src/app/api/*"` bos, `use server` kullanan dosya yok).

**Tetikleyici:** `src/app/(app)/export/route.ts` ya da `src/app/webhooks/x/route.ts` gibi App Router'da tamamen gecerli bir handler eklenmesi. Kiraci kapsami, cache-control ve e-posta normalizasyonu sozlesmelerinin ucu birden o rotaya UYGULANMAZ ve hicbir test kirmizi olmaz.

**Etki:** Uc guvenlik sozlesmesinin de kapsami, kimsenin yazmadigi bir konvansiyona ("her handler api/ altinda durur") bagli. Ihlal ancak elle inceleme ile gorunur.

**Önerilen düzeltme:** Koku `src/app`'e cikar ve `**/route.ts` filtresi uygula (kapsam ayni kalir, gelecege karsi kapali olur); ya da ayri bir tek satirlik pin: `src/app` altinda `api/` disinda route.ts BULUNAMAZ.

---

## 51. 🔵 DÜŞÜK — E-posta normalizasyon pini dosya granulerliginde: bir rotada normalizeEmail'in TEK bir cagrisi, ayni dosyadaki tum `where: { email` sorgularini akla ediyor.
**Yer:** `tests/unit/email-identity.test.ts:97-103`

**Kanıt:** ```ts
const byEmail = routes.filter((r) => /where:\s*\{\s*email\b/.test(r.src));
const missing = byEmail.filter((r) => !/normalizeEmail\s*\(/.test(r.src)).map((r) => r.rel);
expect(missing).toEqual([]);
```
Olcut "dosyada normalizeEmail gecer mi". `src/app/api/account/forgot-password/route.ts` bugun UC ayri `where: { email }` tasiyor (72, 175, 183) ve ucu de ayni normalize edilmis degiskeni kullaniyor (60. satir) — yani su an temiz. Ama dorduncu bir sorgu `where: { email: body.email }` diye yazilsa, dosyada 60. satirdaki cagri durdugu icin test yine yesil kalir.

**Tetikleyici:** Ayni dosyaya ham (normalize edilmemis) bir e-posta sorgusu eklemek.

**Etki:** Kimlik uzayi sessizce ikiye bolunur: "MUSA@Gmail.com" ile "musa@gmail.com" farkli kullanicilar gibi davranabilir — sifre sifirlama/dogrulama-tekrar gibi yollarda hesabin bulunamamasi ya da ikinci bir hesabin olusmasi. Dosyanin kendi basligi bunu "SOZLESME PINI" diye sunuyor.

**Önerilen düzeltme:** Satir/ifade duzeyine in: `where: { email` gecen her esleme icin, ayni ifade icinde normalize edilmis bir degiskenin (ya da `normalizeEmail(`) kullanildigini asserte et; en pratigi: rotalarda `where: { email }` yalnizca `const email = ... normalizeEmail(...)` ile tanimlanmis degiskeni kullanabilir seklinde bir yerel kural.

---

## 52. 🔵 DÜŞÜK — AI harcama pininin SPENDERS listesi hala elle yazili: "isim gercek mi" kontrolu, ismin bir ROTAYI bulup bulmadigini olcmuyor — bugun alti isimden ikisi sifir rota esliyor.
**Yer:** `tests/unit/ai-cost-guards.test.ts:131-196 (147-154 ve 166-172)`

**Kanıt:** Dosya kendi tarihcesinde iki kez sahte guvence verdigini yaziyor ve cozum olarak sunu ekliyor:
```ts
for (const name of SPENDERS) {
  const declared = allSrc.some((f) => new RegExp(`export (async )?function ${name}\\b`).test(readFileSync(f, "utf8")));
  expect(declared, `"${name}" diye bir export YOK — tarayici bu ismi asla bulamaz`).toBe(true);
}
```
Bu yalnizca sembolun VAR oldugunu kanitlar, tarayiciya kapsam kattigini degil. Kod-dogrulamasi (grep, src/app/api/**/route.ts): `classifyMessage` -> 0 rota, `summarizeHostStyle` -> 0 rota (ikisi de yalniz `src/lib/automation.ts` icinden cagriliyor). Yani alti isimden ikisi, tam da yorumun kapattigini soyledigi "sessiz kor nokta" durumunda — sadece bu sefer ad gercek oldugu icin assertion gecerek kor noktayi gizliyor. Ayrica olcut "dosyada `consumeDailyAiBudget(` gecsin": `hospitable/auto-reply-test/route.ts` istek basina 12'ye kadar model cagrisi yapip TEK birim tuketiyor (route.ts:39-42'de bilincli, ama pin bunu 1000 cagri/birim olsa da ayni sekilde onaylar).

**Tetikleyici:** Yeni bir rotanin modeli, SPENDERS'ta olmayan yeni bir yardimci uzerinden cagirmasi (or. `generateWeeklyOpsSummary`). Tarayici o rotayi hic bulmaz, `spenderRoutes.length >= 6` korumasi da mevcut 8 rota sayesinde gecer.

**Etki:** Kotasiz bir AI rotasi tekrar eklenebilir ve pin bunu goremez — dosyanin kapatmayi amacladigi hatanin tam olarak kendisi. Ikincil: "her rota butceden geciyor" ifadesi, fan-out'lu rotalarda orantisiz muhasebeyi de onayliyor.

**Önerilen düzeltme:** SPENDERS'i elle yazmak yerine turet: `src/lib/ai/openai-compat.ts` (tek istek sozlesmesi) icindeki cagriyi kullanan modulleri bul, oradan rotalara dogru bir seviyelik import grafigini coz; en azindan her SPENDER ismi icin `spenderRoutes` katkisinin > 0 oldugunu ya da isim bilincli olarak 'rota-disi' listesinde oldugunu asserte et.

---

## Agent'ların KENDİ eledikleri şüpheler (kod-doğrulaması yanlış çıktı)
- SUPHE: $transaction basarisiz olduktan sonra `await conversationDone` (automation.ts:1725) ayni PrismaPromise'i yeniden bekledigi icin update'i CALISTIRMAZ, memoize edilmis reddedilmis promise'i tekrar firlatir. KOD-DOGRULAMASI YANLIS CIKTI: node_modules/@prisma/client/runtime/library.js icindeki cr
- SUPHE: Kapinin injection vetosu `messages.slice(-6)` bakiyor ama prompt daha genis bir gecmis penceresi tasiyorsa, -7. mesaja gomulu bir injection modele ulasip vetodan kacar. KOD-DOGRULAMASI YANLIS CIKTI: prompts.ts:818-824 de `history.slice(-6)` kullaniyor ve `history` ile `gateContext.history` AY
- SUPHE: `result.reply` bos gelirse outboundBody yalnizca otomasyon notu + imzadan olusur ve misafire anlamsiz bir mesaj gider (automation.ts:1273-1276). KOD-DOGRULAMASI YANLIS CIKTI: suggestReply (ai/index.ts:213) `typeof parsed.reply === "string" && parsed.reply.trim()` sartini saglamadan ASLA `sour
- SUPHE: dryRun dalinin bir yerinde yan etki sizmis olabilir (onizleme 12 konusmayi geziyor). KOD-DOGRULAMASI: tum yazmalar `!options.dryRun` ile kapili — persistRiskVisibility (1007/1014/1021/1036/1080/1119/1144/1175/1483), courtesy (1088), reservation.update (1242), consumeDailyAiBudget (1259), esca
- SUPHE: Kota `consume` atlanabilecek bir dal var — ornegin escalation ya da already_claimed yolunda model cagrisi yapilip birim dusulmuyor olabilir. KOD-DOGRULAMASI YANLIS CIKTI: consume (1259-1261) suggestReply'in HEMEN ardinda, kapidan ONCE ve `source === "openai"` disinda kosulsuz. Modelin cagrild
- SUPHE: Iki es zamanli gecis ayni konusmada iki mesaj gonderebilir ya da escalation e-postasini iki kez atabilir. KOD-DOGRULAMASI: gonderim `updateMany where status in ["new","waiting"]` atomik claim'i ile (1656-1662), escalation `updateMany where status not "problem"` claim'i ile (1309-1319) korunuy
- ŞÜPHE: QR concierge thread'leri `sendDueAlerts`'e sızıp `maybeSendHoldingAck` üzerinden hayalet bir "gönderildi" mesajı üretebilir (çünkü `sendOnChannel` qr-chat hedefinde `{ok:true, skipped:true}` dönüyor ve ack yine de Message yazıyor). KOD-DOĞRULAMASI YANLIŞ ÇIKARDI: QR konuşmaları `guest-chat.ts
- ŞÜPHE: Elle yaratılan (externalReservationId null) bir konuşma `sendDueAlerts`'e düşüp misafire hiç ulaşmayan bir bekletme mesajını yerel olarak "gönderilmiş" gibi kaydedebilir. YANLIŞ ÇIKARDI: `POST /api/conversations` her zaman `applyInboundMessageRules`'ü çağırıyor ve o da `classifyMessage` kulla
- ŞÜPHE: `sendDueWelcomes`/`Checkins`/`Checkouts` geri alması (`updateMany where { sourceReference, property }` — `*SentAt` koşulu YOK, automation.ts:2223-2228 / :2350-2355 / :2621-2626) aynı `sourceReference`'ı paylaşan, daha önce BAŞARIYLA gönderilmiş kardeş satırın damgasını da null'layıp ikinci bi
- ŞÜPHE: `currentHourInTimeZone(org.timezone)` (automation.ts:1030 ve :1791) `orgTimezone()` sarmalayıcısını ATLIYOR; bozuk bir dilim değerinde `timezone.ts:145-146` sessizce `now.getHours()`'a (Railway'de UTC) düşüyor ve aynı fonksiyonun geri kalanı `orgTimezone()` kullandığı için aktif-saat penceres
- ŞÜPHE: `arrivalDate`/`departureDate` UTC geceyarısında saklanıyorsa negatif UTC ofsetli (ör. America/New_York) bir org'da `arrivalDate >= zonedDayRange(now,tz).start` koşulu BUGÜNKÜ girişi/çıkışı düşürür ve `dateKeyInTimeZone` bir gün geri kayar → tüm yaşam-döngüsü gönderimleri sessizce ölür. DOĞRUL
- SUPHE: Senkron, 'answered' bir konusmayi computedStatus ile tekrar 'new'e cevirip (importThread:912, preserve listesi yalnizca problem/closed/waiting — :885) ayni misafir mesajina IKINCI bir oto-yanit gonderilmesine yol acabilir. KOD-DOGRULAMASI YANLIS CIKARDI: applyChannelAutoReply yerel mesaj kuyr
- SUPHE: Ayni status geri-cevrilmesi sendDueAlerts'te tekrar eskalasyon e-postasi uretebilir (aday sorgusu yalnizca `status: "new"` bakiyor — automation.ts:2679). YANLIS CIKTI: dongu hemen ardindan `if (!last || last.direction !== "inbound") continue;` (automation.ts:2707) diyor; cevaplanmis thread'in
- SUPHE: Rezervasyonsuz (unlinked) konusmada AI, wifi sifresi / kapi kodu / tam adres gibi gizli KB icerigini paylasabilir. YANLIS CIKTI: hem model yolu (prompts.ts:781-782 `isConfirmedStay = reservation != null && (...)`, :803 preBookingBlock) hem deterministik yol (fallback.ts:636-639 `stayVerified`
- SUPHE: importThread'in sondaki `lastMessageAt` yazimi (:1055-1058) saglayicinin degerini yazdigi icin, oto-yanitin now() damgasini GERIYE cekip konusmayi 72 saatlik uyari penceresinden (ALERT_MAX_AGE_MS) dusurebilir. DOGRULANAMADI: skip-check (:341) saglayici imleci ilerlemediginde thread'i zaten it
- SUPHE: parseRetryAfter'in 0 / bosluk-iceren degerlerde `Number()` ile 0 uretip `?? 2**attempt` fallback'ini atlamasi (hospitable.ts:58-61) ani ard arda 4 istek yakar. GERCEK ama ONEMSIZ: saglayicinin `Retry-After: 0` gondermesi icin bir sebep yok ve etkisi yalnizca 3 retry'in bosa harcanmasi — ayri 
- SUPHE: liveIds eksik gelirse linkProperty CANLI bir ilana bagli mulku baska ilana yeniden isaret edebilir (:702-705). YANLIS/ULASILAMAZ: `listProperties` hata durumunda firlatiyor (kismi liste yok), tek kismi-liste yolu 40 sayfayi asan bir hesap — ve dal zaten yalnizca AYNI ISIMLI ikinci bir mulk va
- "Ambiguous satır sonunda pending'e düşüp ikinci kez POST edilebiliyor" — YANLIŞ. Kod-doğrulaması: token-miss yolu `reconciling` satırını `ambiguous`'a park ediyor (worker.ts:554), `processOne`'ın reconciling dalında `pending` hedefi hiç yok (571-589), ve state.ts:75 `ambiguous: ["reconciling"]` başk
- "Batch içindeki lease çakışması aynı mesajı iki kez gönderir" — YANLIŞ. Uçuşta lease'i biten satır `recoverStaleClaims` ile `pending`'e DEĞİL `ambiguous`'a gidiyor (worker.ts:159-165) ve ambiguous'un tek çıkışı reconcile. Sonuç duplicate değil, yanlış "teslim edilmedi" kaydı (bulgu #4).
- "reports.ts iptal edilmiş AI taslaklarını AI-yanıt olarak sayıyor" — YANLIŞ. reports.ts:702-711 `status: { not: "sent" }` ile `undeliveredIds` çıkarıp `id: { notIn: undeliveredIds }` uyguluyor. Aynısı quality-audit.ts:98-121'de var. Sorun YALNIZ /sent ekranında.
- "email-outbox'ta retention silmesi sürüm numarasını sıfırlayıp eski bir satırın diriltilmesine yol açabilir" — YANLIŞ. `deleteMany` yalnız `sent` (7g) ve `canceled`/`failed` (30g) satırları siliyor (583-588); `pending`/`claimed`/`sending` hiç silinmiyor, dolayısıyla `_max(version)` her zaman canlı n
- "`hasDrainableOutbox` `blocked` saymadığı için bayrak kapalıyken blocked satırlar sonsuza kadar mahsur kalır" — YANLIŞ. `reactivateBlockedOutbox` bayraktan bağımsız, org döngüsü içinde (scheduled-sync.ts:300) ve drain kontrolünden (369) ÖNCE koşuyor → satır `pending` olduğu anda `hasDrainableOutbox`
- "`enqueueOutbound` dedupe'unda `messageId ?? \"\"` boş kimlikle findUnique'e gidip 500 üretir" — pratikte ULAŞILAMAZ: `messageId` null olan satırlar yalnız `enqueueProactive`'ten doğuyor ve onların idempotencyKey ad-alanı (`welcome:`/`checkin:`/`checkout:`) reply yollarının (`manual:`/`auto:`/`holdi
- ŞÜPHE: past_due grace penceresi `currentPeriodEnd` gelecekte olduğu için uzayabilir (subscription.ts:128 fallback zinciri). YANLIŞ: `pastDueSince`, status past_due'ya çözüldüğü HER olayda aynı update içinde yazılıyor (route.ts:188-189 + 205-210), dolayısıyla status past_due iken `pastDueSince` null 
- ŞÜPHE: Paddle'dan gelen `trialing` durumu yerel denemeyi uzatabilir/sıfırlayabilir. YANLIŞ: webhook `trialEndsAt`'i yalnız `status==="active"` iken ve yalnız NULL'a yazıyor (route.ts:205); başka hiçbir yazma yolu yok. (Ters yön — tarihsiz `trialing` satırının süresi-dolmuş sayılması — bilinçli fail-
- ŞÜPHE: `consumePlanChangeNonce`'ın fırsatçı süpürgesi (`startsWith` sorgusu) devam eden bir plan değişikliğinin `plan-change-pending:` kilidini silebilir. YANLIŞ: prefix `plan-change-nonce:` ve `plan-change-pending:` ondan başlamaz.
- ŞÜPHE: `orgFromProviderRef`, transaction id'sini başka bir org'un abonelik providerRef'iyle eşleştirip yanlış org'a bağlayabilir. YANLIŞ: sorgu `provider:"paddle"` ile pinli (route.ts:87) ve iki id uzayı da Paddle tarafından üretilip `@@unique([provider, providerRef])` ile tekil; çapraz eşleşme için
- ŞÜPHE: Yakalanmış geçerli bir webhook gövdesi 5 dakikadan sonra tekrar oynatılabilir. YANLIŞ: `ts` imzalanan dizenin parçası (paddle.ts:85) ve `Math.abs(now - tsNum) > tolerance` ile ayrıca kontrol ediliyor; yeni bir ts için geçerli h1 üretmek gizli anahtarı gerektirir.
- ŞÜPHE: `plan-change` rotası aynı yükseltmeyi arka arkaya uygulayıp çifte tahsilat yapabilir (yerel planCode webhook gelene kadar bayat kalıyor). YANLIŞ: PATCH'ten önce `getSubscriptionCurrentPriceId` ile "zaten bu fiyattayım" kontrolü var (plan-change/route.ts:101-105) ve eşleşirse Paddle'a hiç doku
- ŞÜPHE: `nowMinutesInTz` içindeki `Intl.DateTimeFormat("en-GB", { hour12: false, hour: "2-digit" })` gece yarısında "24" üretip 1440+ dakika döndürebilir; bu, giriş günü sohbetini 00:00'dan itibaren AÇAR ve devir boşluğu kapısını (fonksiyonun asıl güvenlik amacı) delerdi. KOD/SPEK DOĞRULAMASI: ECMA-4
- ŞÜPHE: `resolveGuestChat`'teki `orderBy: { arrivalDate: "asc" }` ikincil sıralama taşımıyor; aynı konaklamanın Hospitable + iCal'den ÇİFT kaydı (CLAUDE.md 07-29 (3)'te belgeli senaryo) beraberlik yaratıp sıralamayı belirsizleştirir, cihaz bağlaması iki satır arasında salınır ve misafir kendi sohbeti
- ŞÜPHE: Halka açık GET yanıtında `Cache-Control: no-store` yok (`api.ts:55-57`), araya giren bir paylaşımlı önbellek bir misafirin geçmişini başkasına servis edebilir. DOĞRULAMA: `dynamic = "force-dynamic"`, claim dalında yanıt `Set-Cookie` taşıyor, ETag/If-None-Match mantığı kaynakta hiç yok ve depo
- ŞÜPHE: `looksLikeSecret` düzenli ifadeleri atlatılıp izinli bir kategoriye (ör. "welcome", "rules") gizlenmiş bir kapı kodu istemde kalabilir. DOĞRULAMA: kod taşıyan iki hazır şablon (`wifi`, `checkin`) zaten kategori olarak eleniyor (`kb-manager.tsx:33-43`) ve yaygın "kod/şifre: <değer>" biçimlerin
- ŞÜPHE: Misafirin gönderdiği mesaj model çağrısından SONRA kaydedildiği için, model koşarken host yanıt verirse thread'de host mesajı misafirinkinden ÖNCE görünüyor (route.ts:434-448). DOĞRULAMA: sıra gerçekten böyle oluyor, ama kilidin sözleşmesi ("AI host'un üstüne konuşmaz") ihlal edilmiyor ve mes
- ŞÜPHE: `claimKeyedOutboundSend` içindeki `deleteMany({ name: { startsWith: "outbound-send:" } })` süpürgesi, kimliksiz bir misafir isteğinde TÜM kiracıların claim satırlarına dokunuyor (outbound-claim.ts:89-91). DOĞRULAMA: koşul `lockedUntil < now` ile sınırlı — süresi dolmuş bir claim tanım gereği 
- ŞÜPHE: Kesilmiş (2000+ karakter) bir model yanıtı yine de oto-gönderilebilir. YANLIŞ ÇIKTI: capReply truncated=true olduğunda confidence min(clamp01(x), 0.5) yapılıyor (index.ts:235-239) ve hem ana kapı (automation.ts:153) hem QR kapısı (chat route:125) 0.75 istiyor → yalnız taslak kalıyor.
- ŞÜPHE: Model listede olmayan bir riskType uydurup yüksek-riskli etiket kontrolünü atlayabilir. YANLIŞ ÇIKTI: liste dışı değer null'a kıstırılıyor (index.ts:259-262) ve HIGH_STAKES_RISK_TYPES zaten TÜM 11 geçerli etiketi kapsıyor — yani null bir etiket kapıyı gevşetmiyor, diğer bacaklar (fb çapraz-ko
- ŞÜPHE: detectRiskType'ta money_refund/review_threat/platform_policy/cancellation, rule_violation ve discrimination'ın ÜSTÜNDE olduğu için ikisi birlikte geçen bir mesaj deterministik trio vetosunu atlatır. YANLIŞ ÇIKTI: üstteki her etiketin kelime ağı KEYWORDS.complaint veya KEYWORDS.refund veya KEY
- ŞÜPHE: Büyük harfle yazılmış Türkçe injection ("ÖNCEKI TALIMATLARI UNUT") deterministik vetodan kaçar. YANLIŞ ÇIKTI: INJECTION_PATTERNS_ASCII (fallback.ts:453-455) kalıp kaynağını da mesajı da ASCII-kanonik forma indiriyor; elle izleyerek doğruladım, eşleşiyor. (Kaçış boşluk normalizasyonundan geliy
- ŞÜPHE: QR concierge kapısı (mustEscalate) konuşma geçmişini injection için taramıyor. YANLIŞ ÇIKTI: o rota modele `history: []` veriyor (api/chat/[token]/route.ts:525), yani taranacak bir geçmiş yüzeyi yok; guestName ise taranıyor (route:103).
- ŞÜPHE: Model `"riskLevel": null` döndürerek riskLevel kapısını fail-open geçebilir. KISMEN DOĞRU AMA BULGU DEĞİL: `String(parsed.riskLevel ?? "none")` (index.ts:221) açık null'ı "yok" sayıp "none" yapıyor — ama "none" meşru bir değer ve kapı yine intent blocklist + fb çapraz-kontrolü + injection + t
- ŞÜPHE: guestIdentifier `fillPlaceholders` üzerinden KB bloğuna SANITIZE EDİLMEDEN giriyor (automation.ts:1190-1194), yani sahte ayraç enjekte edilebilir. BÜYÜK ÖLÇÜDE ÖRTÜLÜ: `guestFirstName` (automation.ts:2015-2019) `/\s+/` ile bölüp ilk parçayı aldığı için satır sonu/boşluk taşıyan yükler zaten k
- ŞÜPHE: `normalizeLang` yorumu "en default" diyor ama kod "und" döndürüyor (index.ts:96-100) — yanlış dilde mesaj gidebilir. YANLIŞ ÇIKTI: tüketicilerin hepsi `notes[l] ?? notes.en` / `HOLDING_ACK_TEXTS[lang] ?? .en` deseniyle İngilizceye düşüyor (automation.ts:243, 551) → davranış yorumla aynı, yaln
- ŞÜPHE: `/api/admin/exit` superadmin kontrolü yapmıyor → yetki yükseltme. YANLIŞ: exitImpersonation (admin.ts:112-142) yalnızca oturumdaki İMZALI `actorUserId`'ye geri döner, yani sadece AŞAĞI iner; üstelik requireSession o actor'ın epoch'unu zaten doğrulamıştır (api.ts:36-42) ve actor kaydı yoksa ot
- ŞÜPHE: `bindOrCheckStay(reservationId, ...)` org/property kontrolü yapmıyor → başka org'un rezervasyonuna cihaz bağlanabilir. YANLIŞ: reservationId asla client'tan gelmiyor; yalnız `resolveGuestChat(token)`'ın döndürdüğü `ctx.activeReservation.id` kullanılıyor (chat/[token]:340,360) ve o da `propert
- ŞÜPHE: middleware matcher'ı nokta içeren yolları dışlıyor (`.*\\..*`) → staff `/inbox/xxx.yyy` gibi bir yolla sayfa katmanı kapısını atlayabilir. YANLIŞ: atlatma için gerçekten eşleşen bir route segmenti gerekir; tüm dinamik segmentler DB kimlikleri (cuid/uuid/`qrconv_<cuid>`/64-hex token) ve hiçbir
- ŞÜPHE: `/api/conversations/[id]/translate-message` mesajı yalnız id ile çekiyor → başka konuşmanın mesajı okunabilir. YANLIŞ: sorgu `where: { id: parsed.data.messageId, conversationId: id }` (translate-message:49-52) ve `id` zaten org-kapsamlı findFirst'ten geçmiş (:39-43).
- ŞÜPHE: `properties/[id]/page.tsx:138` iCal feed URL'ini ham `Host` başlığından kuruyor → host-injection ile token sızar. DOĞRULANDI AMA SÖMÜRÜLEBİLİR DEĞİL: sayfa `headers()` kullandığı için tamamen dinamik, paylaşılan bir önbelleğe girmiyor; üretilen URL yalnız isteği yapan kullanıcının kendi ekran
- ŞÜPHE: middleware staff yönlendirmesi DB rolünü değil JWT rolünü okuyor ve kayan yeniden-imza (middleware.ts:60) rolü hiç tazelemiyor → DB'de staff'a düşürülen bir yönetici sayfa katmanında yönetici kalır. Kod olarak DOĞRU, ama BUGÜN TETİKLENEMEZ: repoda rol DEĞİŞTİREN hiçbir yüzey yok (grep: `role:
- "api-route-scoping, sorguyu bir yardimci dosyaya tasiyarak atlatilabilir" — HAYIR: rota o zaman `organizationId` string'ini kaybeder ve 71-74'teki kume-esitligi testi kirmizi olur; ayrica 109-115 src/app/api altinda route.ts disinda dosya olmasini yasakliyor (bugun gercekten sifir).
- "kb-plan-limits-route yanlis plan sinirinda kosuyor (free=15 olmasi gerekirken business=60 varsayiyor)" — HAYIR: subscription.ts:89-101 aboneliksiz org'a planCode "grandfathered" veriyor ve plan-limits.ts:94 FALLBACK_LIMITS = business. Varsayim dogru.
- "auto-reply-channel.test.ts'in `@/lib/ai` mock'u `summarizeHostStyle` icermiyor, uretimde undefined cagri gizleniyor" — HAYIR: `summarizeHostStyle` yalniz `refreshStyleProfile` icinden cagriliyor (automation.ts:2004) ve o da sadece `scheduled-sync.ts:329`'dan cagriliyor; test edilen yollarda hic cal
- "golden set, kapinin confidence>=0.75 ve source===openai kollarini hic sinamiyor" — kismen dogru ama sahte guvence degil: o iki kol baska yerde gercekten test ediliyor (auto-reply-channel.test.ts:198-206 dusuk guven; demo-ai-route.test.ts:119-123 fallback source).
- "railway.json pini zayif, startCommand baska bir seviyeye yazilarak atlatilir" — Railway sematiginde startCommand `deploy` altindadir; `config.deploy.startCommand` dogru yere bakiyor.
- "prompts.ts istemci-paketi taramasi zayif (dinamik import / tek tirnak / @/lib/ai uzerinden dolayli zincir gormuyor)" — teknik olarak dogru ama gercek koruma `import "server-only"` (ai-cost-guards.test.ts:247 ile pinli): dolayli zincir kurulursa Next build kirilir. Tarama ikinci katman, tek dayanak 

## Kontrol edilip SAĞLAM bulunanlar
- Kapinin sirasi ve icerigi dogru: source!==openai reddi, NEVER_AUTO_REPLY_INTENTS, classifyFallback capraz-kontrolu, deterministik injection vetosu (son mesaj + gecmis + misafir adi), deterministik yuksek-riskli backstop, model riskType vetosu, riskLe
- Kesilmis model yaniti otomatik gidemiyor: capReply truncated ise confidence 0.5'e klempleniyor (ai/index.ts:235-239), kapi 0.75 istiyor; finish_reason=length ise callOpenAI null donuyor ve fallback'e dusuluyor (ai/index.ts:148-151).
- callOpenAI ve suggestReply hicbir kosulda firlatmiyor; OpenAI kesintisi `source:"fallback"` uretiyor ve kapi bunu reddediyor — gonderim yolu model arizasinda fail-closed.
- senderName "GuestOps AI" sihirli string'i her iki gonderim yolunda da (inline 1707, outbox 1586) ve holding-ack / closing-courtesy'de aynen korunuyor.
- Escalation e-postasi basarisiz olunca claim BILINCLI olarak geri alinmiyor ve gerekce kodda tam yaziyor (1366-1399); holding-ack ile otomatik gorev, e-posta arizasindan bagimsiz olarak yine kosuyor (1405-1440) — idempotency kilidi claim'in kendisi.
- Escalation alarm alicisi role-filtreli owner ya da org'un kendi alertEmail'i; env fallback'e ASLA dusmuyor (1322-1338) — operator sizintisi yok.
- Ambiguous gonderim hatasinda (timeout/5xx/ag) claim TUTULUYOR, definitive'de birakiliyor; isDefinitiveSendFailure tek kaynak ve manuel/yasam-dongusu yollariyla paylasilmis (messaging.ts:76-79).
- Iptal edilmis (canceled) outbox taslagi konusmayi "cevaplanmis" gostermiyor: son mesaj id'siz outbound ise canceled satirlar filtreleniyor ve sicak yola ekstra sorgu yalnizca o sekilde binmiyor (1049-1060).
- peekDailyAiBudget okuma hatasinda fail-OPEN (daily-budget.ts:119-124) — KULLANIM kapisi icin dogru yon; kimlik kapilari etkilenmiyor.
- Kota tavanina carpan konusma "new" kaliyor ve autoReplyAttemptedAt DAMGALANMIYOR; kalan adaylara da sebep yaziliyor ama gercek sebebi olan satirlar (human_hold / reservation_ended) ezilmiyor (1876-1894).
- recordRiskEvent ve recordShadowVerdict tamamen kendi icinde yutuluyor; golge sinifllandiricinin gonderim/escalation yoluna sizacak bir hata ya da gecikme yolu yok (risk-events.ts:57-86, shadow-ai.ts:340-345).
- human_request niyetinde AI thread'te susturuluyor (autoReplyHoldUntil) ve aday sorgusu bu satirlari DAMGALAMADAN disliyor — sure dolunca kendiliginden geri geliyorlar (1615-1623, 1730-1738, 1827-1833).
- Aday sorgusunun uygunluk filtresi SQL'de ve tavan (take:25) UYGUN satirlara uygulaniyor; JS tarafindaki ikinci filtre ikinci savunma olarak duruyor (1811-1853) — belgelenen aclik sinifi bu dort sebep icin gercekten kapali.
- Claim-then-send dört gönderim yolunda da doğru kurulmuş: welcome/checkin/checkout `*SentAt`'i atomik `updateMany ... welcomeSentAt: null` ile claim ediyor (automation.ts:2200, :2333, :2604), oto-yanıt ve nezaket kapanışı ise `status in [new,waiting] 
- Kesin/belirsiz hata ayrımı tek kaynaktan geliyor ve dört yolda da tutarlı: `isDefinitiveSendFailure` (messaging.ts:76-79) yalnız 4xx≠408'i kesin sayıyor; belirsizde damga/claim TUTULUYOR, yani aynı gövde asla ikinci kez POST edilmiyor.
- `sendOnChannel` `qr-chat:` ön ekli ve null hedefleri iç thread sayıp Hospitable'a sahte id POST etmiyor (messaging.ts:44-46, 58) ve tek atış yapıyor (`{ retries: 0 }`), yani istemci içi tekrar duplicate penceresi açmıyor.
- `lifecycleOutboxOwns` (automation.ts:2082-2092) bayrak-KAPALI yolu outbox'a karşı doğru çitliyor: `status: { not: "failed" }` sayesinde pending/blocked/review/ambiguous/sent/canceled satırı olan bir rezervasyon ikinci kez POST edilmiyor, yalnız kesin
- `sendDueCheckouts` gün eşleşmesi doğru: pencere org-yerel gün sınırından yürüyor ve `addZonedDays` kullanıyor (:2541), ardından her satır org dilimindeki takvim günü ile karşılaştırılıyor (:2568) — `departureDate asc` sıralaması bugünkü çıkışları 25'
- `zonedDayRange`/`zonedDateStart`/`addZonedDays` DST-doğru: gün sonu sabit +24h değil, ERTESİ yerel geceyarısı − 1 ms (timezone.ts:101) ve offset sabit-nokta ile iki adımda çözülüyor (timezone.ts:130-131) — 23/25 saatlik günlerde kaymıyor.
- `sendDueAlerts`'te claim-then-notify sözleşmesi doğru uygulanmış: sonucu yutmayan `sendReporting` kullanılıyor (email-core.ts:151-159, asla fırlatmaz) ve başarısızlıkta geri alma YALNIZ `status`'e dokunuyor (automation.ts:2776-2778) — `skippedReason`
- `ALERT_MAX_AGE_MS` (72 s) gerçekten çalışıyor: `Message.createdAt` içe aktarımda sağlayıcının damgasından yazılıyor (`hospitable-sync.ts:1023 createdAt: parseDate(m.created_at) ?? undefined`), yani yeniden senkron eski bir mesajı "taze" göstermiyor.
- `recordRiskEvent` yeniden denemeye dayanıklı ve asla fırlatmıyor: `@@unique([organizationId, surface, triggerId, finalDecision])` hedefli P2002 sessizce yutuluyor, diğer her hata raporlanıyor (risk-events.ts:82-85); kapalı-set clamp'leri sayesinde mi
- `maybeSendClosingCourtesy` belirsiz hatada claim'i TUTUYOR (automation.ts:489-493); "praise" dalı model yoluna düşse bile oradaki claim `already_claimed` ile duruyor (:1660-1662) — ikinci bir nezaket mesajı imkânsız.
- `removeAutoTasksForCancelledReservation` kapsamı doğru daraltılmış: yalnız `origin: "system"`, yalnız `status not done`, yalnız iki yaşam-döngüsü tipi (automation.ts:680-690) — host'un kendi görevi ve mesaj-kaynaklı (ai) görev iptalde silinmiyor.
- `createReservationTasks` tip-başına idempotent (automation.ts:605-609) ve "bugün" sınırını org yerel gününden alıyor (:616), yani bugünkü giriş/çıkış görevleri sunucu UTC günü yüzünden düşmüyor.
- `runDueChannelAutoReplies`'in uygunluk filtresi hem SQL'de (automation.ts:1820-1834, alan-referanslı `autoReplyAttemptedAt < lastMessageAt` + `autoReplyHoldUntil` kapısı) hem JS'te (:1851-1853) — damgalanmış satırların 25'lik tavanı doldurup açlık ya
- Günlük AI kotası doğru konumlanmış: model çağrısından önce yalnız `peek` (automation.ts:1173), tüketim ancak model GERÇEKTEN yanıt verdiyse (`result.source === "openai"`, :1259) — OpenAI kesintisinde kota yanmıyor ve konuşma damgalanmadığı için pence
- syncCursorAt ilerlemesi mesaj yazimlariyla AYNI transaction'in icinde (hospitable-sync.ts:1055-1058, TX sinirlari :377-393) — dongu ortasinda hata olursa konusma create/update dahil her sey rollback olur; ayri bir 'geri alma' gerekmiyor ve yok olmasi
- syncCursorAt'i baska HICBIR modul yazmiyor (repo geneli grep: yalnizca hospitable-sync.ts) — yani outbound yollarin now() damgasiyla kirlenmesi yapisal olarak imkansiz; kolon yorumundaki iddia (schema.prisma:459-465) kodla ortusuyor.
- Konusma yeni yaratilirken syncCursorAt bilerek NULL birakiliyor (:866-872) — tek mesajli/ayni damgali thread'de 'yaratildigi anda guncel' tuzagi gercekten kapali.
- Thread kimlik kilidi (NS 43, :746-761) importThread'in ILK isi (:794), canonical okuma kilidin icinde (:823) ve P2002 icin tek sinirlandirilmis retry var (:407-413); m45 `@@unique([propertyId, externalReservationId])` (schema.prisma:511) canli → ayni
- Mesaj dedupe her yolda uygulaniyor: bellek ici `seenExternalIds` (:956-963) + ilk kullanimda rezervasyon (:979) + DB `@@unique([conversationId, externalId])` (schema.prisma:556) ve P2002 YALNIZ o kisit icin dedupe-hit sayiliyor (:1030), yabanci P2002
- Erasure iki-siralama teoremi gercekten uygulanmis: kosu basi guard sadece optimizasyon (:269-276), her iki write-TX de once org advisory kilidini alip guard'i TAZE okuyor (:286-289, :380-382); anahtar eksik/parmak izi uyusmaz ise BLOCK_ALL fail-close
- Retention diriltme koruyucusu hem rezervasyon (:607-614, ANON_NAME sentinel) hem konusma (:850-857, :893-903) tarafinda; era filtresi zaman damgasi yoksa fail-closed atliyor (:970-973) ve retention ile erasure cutoff'lari 'siki olan kazanir' diye bir
- upsertReservationCalendar'daki P2002 kurtarmasi yalniz `[propertyId, sourceReference]` ile sinirli (:650), baska unique ihlali firlatiliyor — dedupe-hit'te de yaris kazananin satiri benimseniyor.
- Her satir-basi hata sinifi artik kosu-basi TEK aggregate reportError ile gorunur (link :475-484, fetch :465-474, rezervasyon :485-496, thread :497-512, supply :453-462) ve SAYI bilerek context anahtarinin disinda tutulmus (:498-501) — throttle/Issue-
- linkProperty, hala CANLI baska bir ilana bagli ayni isimli mulku asla calmiyor (:697-705, `liveIds` kontrolu) — capraz-daire veri karismasi bu yoldan olusmuyor.
- hospitableFetch, Bearer token'i gondermeden ONCE https pinini uyguluyor (hospitable.ts:101-103) — insecure base URL'de hicbir kismi gonderim yok.
- Aynı satırı iki worker alamaz: claim `pg_try_advisory_xact_lock` (worker.ts:184-187) + `FOR UPDATE SKIP LOCKED` (267) + settle'ın `{ id, claimedBy: token, status: fromStatus }` guard'ı (312-315) üçlüsü; kilidi alamayan worker `[]` dönüp o geçişi pas 
- Belirsiz (ambiguous) gönderim ASLA körlemesine tekrarlanmıyor: token-miss park hedefi statüye göre ayrışıyor (`row.status === "reconciling" ? "ambiguous" : "pending"`, worker.ts:554) ve `defaultReconcile` gövde/zaman benzerliğiyle asla "sent" demiyor
- `classifySendResult` 402'yi `blocked`, 429'u `rate_limited` yapıyor ve ikisi de `attemptCount: { decrement: 1 }` ile claim'in artışını geri alıyor (worker.ts:612-620, 631-638) → 402/429 fırtınası gerçek mesajı `failed`'a itemiyor.
- `enqueueProactive`/`enqueueOutbound` dedupe'u satırı HANGİ statüde olursa olsun buluyor (enqueue.ts:185-195) → `canceled`/`review`/`blocked` bir satır yeniden enqueue ile diriltilemiyor; scheduler replay'i temiz dedupe-hit.
- Konuşma başına FIFO + tek-uçuş guard'ı doğru: `NOT EXISTS` hem in-flight (`sending`/`reconciling`) hem daha eski `(createdAt, id)` kardeşi blokluyor (worker.ts:256-265), yani aynı thread'e sıradışı sırada iki mesaj gitmiyor.
- Rezervasyon başına 2/dk kapağı atomik: `rn + recent <= 2` (272) claim'i serileştiren advisory kilidin altında ve `claimedAt` settle tarafından hiç temizlenmiyor → sayım gerçek deneme saati üzerinden.
- `enqueueOutbound` Message + outbox satırını TEK transaction'da yazıyor ve `externalId` bilinçli boş bırakılıyor (enqueue.ts:87-124) → "kuyrukta ama teslim edilmiş görünen" mesaj yok.
- reports.ts:702-711 ve quality-audit.ts:98-107 teslim edilmemiş outbox mesajlarını AI-yanıt sayımından doğru şekilde çıkarıyor.
- email-outbox: batch lease hatası gerçekten çözülmüş — lease claimed→sending CAS anında DB `now()` ile yeniden damgalanıyor (email-outbox.ts:413-419) ve sağlayıcı çağrısı 15 sn (Resend) / 12 sn faz (SMTP) ile sınırlı, 3 dk'lık lease'in çok altında.
- email-outbox güncellik kapısı (currency gate) üç geçişte de (pre-send CAS, failure settle, sweep recovery) NS-42 advisory kilidi altında koşuyor ve bayat nesli `pending`'e değil `canceled`'a gönderiyor (399-408, 449-456, 519-529) → süperseded bir kod
- email-outbox sweep'i `claimed` (hiç POST edilmedi → bedava requeue) ile `sending` (belirsiz → attempt + backoff harcar) arasında doğru ayrım yapıyor (543-575).
- `settle` çalışma-zamanı geçiş kapısı gerçek: illegal hedefte hiçbir şey yazmıyor, reportError basıyor ve claim'in doğal olarak expire etmesine bırakıyor (worker.ts:304-311).
- `markConversationDelivered`/`stampLifecycleSent` yalnız DOĞRULANMIŞ teslimde koşuyor; `holding_ack` bilinçle etkisiz (worker.ts:449-457) → şikayet thread'i "Sorunlu" kalıyor.
- ops.ts manuel yeniden gönderimi doğru şekilde DAR: yalnız `failed` ve `lastErrorCode !== "HTTP 402"`, updateMany guard'ıyla IDOR-güvenli ve idempotent (39-41, 145-162).
- İmza doğrulama sağlam: HMAC `${ts}:${rawBody}` ham gövde üzerinden, ±5 dk pencere, `timingSafeEqual` öncesi uzunluk kontrolü; bozuk hex h1 `Buffer.from` tarafından kırpıldığı için uzunluk kontrolünde düşer (paddle.ts:56-96). Sahte veya yakalanıp yeni
- Sıra koruması UPDATE'in WHERE'inde ATOMİK: `OR: [{lastEventAt: null}, {lastEventAt: {lte: occurredAt}}]` (route.ts:214-216, 232-237) → geç gelen eski bir `past_due`/`canceled`, taze `active` durumu ezemez; eşit damga idempotent yeniden uygulanır, kay
- `resolveOrgId` ham `custom_data.organizationId`'yi HİÇBİR dalda kullanmıyor (route.ts:106-131): önce kendi kaydettiğimiz `providerRef` (provider="paddle" pinli), sonra oturumdan doğmuş TAZE consent; 30 günlük bayat consent ilk-bağlama yapamaz, gelece
- Sırasız teslimat doğru sonuçlanıyor: `transaction.completed` önce gelse de `subscription.created` önce gelse de ikisi de AYNI consentId üzerinden aynı org'a bağlanır; transaction fiyat-eşleşmesinden bilinçli muaf (route.ts:275-277), Invoice tekilliği
- Ödeme alınıp entitlement kaybı riski webhook tarafında kapalı: WebhookEvent yalnız `status==="processed"` ise duplicate sayılır (route.ts:378-385), geçici hata 5xx döner (route.ts:421) ve Paddle retry'ında apply idempotent koştuğu için mutasyon kaybo
- past_due grace doğru çapalanmış: `pastDueSince` past_due'ya İLK geçişte damgalanır ve sonraki dunning olaylarında `existing?.pastDueSince ?? ...` ile korunur (route.ts:188-189), past_due'dan çıkışta null'lanır; `getEntitlement` bunu okur, `updatedAt`
- Deneme süresi sıfırlanamıyor: `trialEndsAt` yalnız kayıt anında yazılır (register/admin-customers) ve aktivasyonda temizlenir (route.ts:205); webhook başka hiçbir yerde yazmıyor. Tarihsiz `trialing` satırı fail-closed olarak SÜRESİ DOLMUŞ sayılır (su
- Plan değişikliği zinciri sağlam: HMAC'li önizleme token'ı + `jti`'nin Paddle'a DOKUNMADAN ÖNCE tek-kullanımlık claim'i (plan-change/route.ts:69), tutarın yeniden önizlenip eşleşme şartı (:87), definitive(4xx)=release+retry vs ambiguous=asla ikinci PA
- SystemLock ad alanları çakışmıyor: `plan-change-nonce:` süpürgesi (plan-change.ts:198-200) `plan-change-pending:` kilidini ve `outbound-send:` claim'lerini silmez — prefix'ler ayrık.
- Kurucu muafiyeti ve fail-open/fail-closed yönü doğru: `isFounderOrg` yalnız `active`'i zorlar planı bozmaz (subscription.ts:140-142), `limitsForOrg` KULLANIM kapısı olarak DB hatasında fail-OPEN (plan-limits.ts:120-122), kimlik kapıları (withOwner) e
- Kısmi env yapılandırması müşteriyi eşleşmeyen bir fiyata sokamaz: kart butonu `!p.priceId` iken devre dışı (paddle-plans.tsx:517, 526), yani UI'dan yalnız env'de tanımlı üç fiyat açılabilir.
- Token çözümü fail-closed ve ayırt edilemez: `token.length < 16`, bilinmeyen token, `chatEnabled=false` ve `premiumAllowed=false` dallarının hepsi `null` → 404 (guest-chat.ts:387-418; route.ts:262,329). Token global benzersiz olduğu için çapraz-kiracı
- Cihaz bağlama claim'i gerçekten atomik: `updateMany({ where: { id, chatBoundHash: null } })` ile koşullu yazım, kaybedilen yarışta hash yeniden okunup karşılaştırılıyor; karşılaştırma eşit-uzunluk kontrolü + `timingSafeEqual` ile yapılıyor (guest-cha
- `allowClaim` zorunlu parametre yapılmış (guest-chat.ts:283) — PIN gerektiren yolda yanlışlıkla claim edilmesi derleme hatasına dönüşüyor; dört çağrı yerinin dördü de niyetini açıkça yazıyor (route.ts:225,231,248,273-274,361-362).
- KB sır elemesi iki katmanlı ve sayaç DOĞRU: kategori elemesi SQL WHERE'de (guest-chat.ts:503), içerik elemesi `looksLikeSecret` ile (`:507`), ve `droppedTotal` İKİ elemeyi birden topluyor (`:516`) — modele söylenen "kaç kalem düştü" sayısı gerçeği ya
- `chatPinHash` yalnız `pinRequired` boolean'ını türetmek için select ediliyor ve dönen `activeReservation` şeklinden çıkarılıyor — hash fonksiyondan hiç çıkmıyor (guest-chat.ts:446-447,476-488).
- PIN doğrulaması KARŞILAŞTIRMANIN KENDİSİNİ atomik slot rezervasyonuyla kapılıyor (guest-chat-pin.ts:170-183): çok replikalı bir patlama bile pencere başına en fazla MAX tahmin deneyebiliyor. Ayrıca hash CAS'i sayesinde host PIN'i döndürürse yarışan e
- Devir kilidi doğru kurulmuş: misafir rotasının recheck+insert'i ve host yanıt rotasının insert'i AYNI `pg_advisory_xact_lock(41, hashtext(convId))` üzerinde seri (guest-chat.ts:99-106; route.ts:437-445; guest-chats/[id]/reply/route.ts:44-45). Recheck
- Devir durumu `authorType`'tan okunuyor, `senderName`'den değil (message-author.ts:69-86; reply/route.ts:53-54; resume-ai/route.ts:44-47) — adını "Lixus AI" veya `__lixus_ai_resumed__` yapan bir host bot/resume işareti taklit edemiyor; inbound yön her
- `mustEscalate` model yolunun tamamını kapsıyor (route.ts:96-126): source!=openai, intent blocklist, paylaşılan `HIGH_STAKES_RISK_TYPES` (tek kaynak, automation.ts:59-63), `classifyFallback` çapraz-kontrolü, mesaj VE misafir adı üzerinde injection vet
- Deterministik fallback yanıtı misafire ASLA gitmiyor: `source !== "openai"` → escalate → sabit "ilettim" metni kullanılıyor (route.ts:104,541-543). Kesilmiş model yanıtı da (finish_reason=length → null → fallback, ai/index.ts:148-151) aynı yoldan ele
- Eskalasyon e-postası claim'i kiracıya bağlı: `updateMany` koşulu rezervasyona YALNIZ `property: { organizationId }` üzerinden erişiyor (guest-chat-alerts.ts:114), claim sonrası her hata dalında (alıcı yok / transport hatası / beklenmeyen istisna) cla
- Idempotency claim'i doğru sınıflandırıyor: aynı gövde → `duplicate` (no-op), aynı id farklı gövde → 409, store hatası → 503 fail-closed; ve claim yalnız HİÇBİR ŞEY kaydedilmemişse geri alınıyor (route.ts:395-418,434-448,558-563) — kaydedilmiş bir alı
- Bağlanmamış ya da eşleşmeyen cihaz sıfır yazım ve sıfır model harcaması yapıyor: GET (route.ts:275-280) ve POST (`:363-375`) her ikisi de geçmişi ve göndermeyi kapıdan çeviriyor; `chatUsage` sayacı bile artmıyor.
- Konaklama penceresi simetrik ve TÜM adaylar üzerinde değerlendiriliyor (guest-chat.ts:456-473): back-to-back devir gününde 10:00'da çıkan misafir, 12:00-15:00 arası KAPALI, 16:00'da gelen misafir seçiliyor — 12 saatlik ileri bakış penceresinin çektiğ
- Konuşma kimliği yarış-güvenli: deterministik PK + planlı kompozit unique'in İKİSİ de "beklenen yarış" sayılıyor, yabancı P2002 yeniden fırlatılıyor, kompozit dalında kazananın id'si varsayılmayıp kimlik anahtarından yeniden okunuyor ve uyuşmazlıkta f
- Kapı sırası doğru ve yalnız KISITLAYICI: source!==openai → intent blocklist → classifyFallback çapraz-kontrolü → mesaj injection vetosu → geçmiş+isim injection vetosu → deterministik safety/rule/discrimination vetosu → yüksek-riskli riskType etiketi 
- HIGH_STAKES_RISK_TYPES (automation.ts:59-63) ile RISK_TYPES (risk-events.ts:32-36) BİREBİR aynı 11 etiketi taşıyor → modelin verdiği HERHANGİ bir geçerli riskType etiketi oto-gönderimi durduruyor; tek muafiyet tasarlanmış human_request/human_request 
- riskType clamp'i aşılamıyor: `typeof parsed.riskType === "string" && RISK_TYPES.has(parsed.riskType) ? parsed.riskType : null` (index.ts:259-262) — liste dışı bir etiket null olur, aşağı akışta hiçbir anlam taşıyamaz.
- Bilinmeyen intent hem "general"a kıstırılıyor hem confidence ≤0.5'e çekiliyor (index.ts:232-242) → yeni/uydurma bir intent string'i kapıyı geçemez.
- Tanınmayan riskLevel değeri ("High", "critical") FAIL-CLOSED: "high"a düşüyor (index.ts:221-230), sessizce "none" olmuyor.
- Kesilmiş model çıktısı (finish_reason=length) null döndürüyor (index.ts:148-151) → deterministik fallback → source "fallback" → kapı ilk satırda reddediyor.
- capReply mantığı doğru: >2000 karakter yanıt truncated işaretlenir ve confidence min(...,0.5)'e kıstırılır (index.ts:193-206, 235-239) → 0.75 tabanının altında kalır, misafire OTOMATİK gitmez; QR kapısı da aynı 0.75 tabanını kullanıyor (api/chat/[tok
- Fallback yolu ASLA oto-gönderim izni veremiyor: `suggestReplyFallback` her zaman `source: "fallback"` yazıyor (fallback.ts:799) ve kapı bunu ilk satırda kesiyor; ayrıca fallback confidence tavanı 0.7 (fallback.ts:296).
- Fallback'in secret-gate'i doğru: wifi/checkin/location KB içeriği yalnız confirmed/completed rezervasyonda veya verifiedActiveStay ile veriliyor (fallback.ts:635-638, 692, 711, 729-731).
- Türkçe İ/I katlaması kısıtlayıcı netlerde üç yönlü çalışıyor (foldTurkishLower + foldTurkishLowerTr + foldTurkishAscii, fallback.ts:210-257) ve INJECTION_PATTERNS'in ASCII ikizi (453-455) "ÖNCEKİ TÜM TALİMATLARI UNUT"u yakalıyor; beyaz listelere (isP
- isPositiveFeedback gerçek bir beyaz liste: tek bilinmeyen kelime bile mesajı normal model+kapı yoluna düşürüyor, ayrıca rakam/soru/negatif-emoji/injection ön elemeleri var (fallback.ts:373-390).
- detectRiskType'ın öncelik sırası kapıyı zayıflatmıyor: trio'nun (safety/rule/discrimination) ÜSTÜNDEKİ tüm etiketler (prompt_injection, safety_emergency, review_threat, platform_policy, money_refund, cancellation) kapıda AYRICA çapraz-kontrol ediliyo
- Kapının geçmiş taraması ile modelin gördüğü geçmiş penceresi AYNI: automation.ts:1285 `messages.slice(-6)` ve prompts.ts:821 `history.slice(-6)` — parite var, ayrıca guestIdentifier ve reservation.guestName yüzeyleri de taranıyor.
- QR concierge yolunda geçmiş enjeksiyonu yüzeyi YOK: api/chat/[token]/route.ts:525 `history: []` geçiyor, yani mustEscalate'in geçmişi taramaması bir boşluk yaratmıyor.
- dryRun (önizleme/test kartı) hiçbir yan etki üretmiyor: statedCheckoutTime rezervasyona yazılmıyor (automation.ts:1242), kotadan düşmüyor, persist yapılmıyor.
- sanitizePromptValue kontrol karakterlerini ve <> işaretlerini temizleyip boşluğu normalize ediyor ve uzunluk kapıyor (prompts.ts:629-636); rezervasyon adı, mülk adı/adresi ve host geç-çıkış teklifi bu yoldan geçiyor.
- translate FAIL-CLOSED: finish_reason=length dahil her başarısızlıkta {ok:false} dönüyor, orijinal metni çeviri gibi sunmuyor (translate.ts:156-169); girdi 6000 karakterle sınırlı, LRU 200/6saat.
- DEFAULT_OPENAI_MODEL = "gpt-5.1" (model-family.ts:26) üretimle aynı ailede → env düşse bile istek şekli (reasoning yolu) sessizce değişmiyor.
- prompts.ts `server-only` ile mühürlü ve tavanlar yaprak modülde (limits.ts) → kara liste/sistem promptu tarayıcı paketine giremiyor.
- 25 dinamik rotanın TAMAMI ([id]/[token]) doğru değişkenle kapsamlı: her biri ya `property: { organizationId: session.organizationId }` ya doğrudan `organizationId: session.organizationId` ile findFirst/deleteMany/updateMany yapıyor; sahiplik kontrolü
- Güncelleme şemalarının hiçbiri `propertyId` kabul etmiyor → bir kaydı başka org'un mülküne taşıma yolu YOK: validators.ts:114-117 (reservationUpdateSchema = yalnız status/notes), :154-157 (conversationUpdateSchema = yalnız status/priority), :177-200 
- Client'tan gelen ilişki id'leri her yerde çapraz-doğrulanıyor: conversations/route.ts:46-56 ve tasks/route.ts:49-59 `reservationId`'yi hem propertyId hem organizationId ile birlikte arıyor; tasks/[id]:88-92 ve tasks/route.ts:40-44 `assignedToId`'yi o
- requireSession (api.ts:16-53) role VE organizationId'yi DB'den tazeliyor (JWT dondurmuyor), DB hatasında fail-CLOSED null dönüyor; requireAuth (auth/index.ts:38-75) sayfa yolunda fail-open ama capability'yi "staff"a clamp ediyor ve redirect() try/cat
- Impersonation epoch zinciri üç yerde birden zorlanıyor: api.ts:36-42, auth/index.ts:57-64, (app)/layout.tsx:37-45 — hem üstlenilen kullanıcının hem GERÇEK operatörün sessionEpoch'u kontrol ediliyor.
- 81 rotanın 14'ü oturumsuz; hepsi gerekçeli: 2 cron (CRON_SECRET + uzunluk kontrollü timingSafeEqual), 5 auth akışı, 2 token rotası, health, demo/ai, leads (5/saat IP), paddle webhook.
- Süper-admin kararı `actorEmail(session)` (admin.ts:31-40) üzerinden veriliyor → operatör impersonation'da yetkisini koruyor, müşteri kendi e-postasıyla asla superadmin olamıyor (JWT imzalı, actorEmail yalnız enterOrganization'da yazılıyor).
- `claimEnv` ile paylaşılan Hospitable env token'ını çalma yolu kapalı: hospitable/connect/route.ts:50-55 `isPrimaryOrg` kapısı; ayrıca getOrgHospitableToken (hospitable-credentials.ts:113-115) env fallback'i yalnız primary org'a veriyor ve production'
- OAuth round-trip'i başlatan org+user'a bağlı: authorize state cookie'sine org+user paketleniyor (authorize:50), callback exchange'den ÖNCE `bound.organizationId !== session.organizationId || bound.userId !== session.userId` kontrolü yapıyor (callback
- E-posta kimliği tek hakemden geçiyor: normalizeEmail + benzersiz kolonda exact `findUnique` — login:33/45, register:64-65, admin/customers:41-42, forgot-password:60/72, resend-verification:29/35, admin/reset-2fa:32/41 (eski `mode:"insensitive"` findF
- Kod tek-kullanım tüketimleri atomik ve yarış-korumalı: TOTP step burn (login:142-154), e-posta doğrulama (verify-email:44-48), şifre kodu (password:136-144 + 175-186), reset kodu (forgot-password:162-170 + 195-207), kurtarma kodu (recovery-codes.ts:2
- Depolama nesne anahtarı kiracı sınırı: storage/keys.ts:33-46 katı şekil kontrolü + storage/photo/[...key]:29-30 `orgIdFromKey(key) !== session.organizationId → 404`; yazma tarafında isAcceptablePhotoUrl org+task segmentini de doğruluyor (tasks/[id]:5
- Staff sınırı API'de DB-yetkili: tasks GET assigned-only (tasks/route.ts:15), tasks PATCH assigned-only + alan bazlı 403 (tasks/[id]:38-66) + checklist'te yalnız `done` toggle (:71-84), upload'da task ataması kontrolü (upload:76-83).
- Tüm (app) sayfa sorguları org-kapsamlı; sayaç ve liste AYNI `where`'i paylaşıyor (inbox:70-81, cancellations:100-109, guest-chats:45-52, tasks:57-88, sent:117-206).
- buildOrganizationDataExport (data-export.ts:73-255) yedi sorgunun HEPSİNİ verilen organizationId ile kapsıyor; sırlar allowlist dışında ve feed URL'leri maskeleniyor (:31-71).
- golden-scenarios.test.ts: kapiya bilerek zararsiz 0.9/openai hukmu veriliyor (BENIGN_MODEL_RESULT), yani gercekten "model yanlis siniflandirsa bile kod vetolar mi" olculuyor; her risk sinifinda hem tehdit hem ovgu-tuzagi senaryosu var (yildiz ovgusu,
- email-identity.test.ts:50-58 pozitif kontrolu dogru kurulmus: ASCII bir adresin KABUL edildigi asserte edildigi icin, CONFUSABLES testleri "her sey baska bir sebepten reddediliyor" bosluguna dusmuyor.
- kb-plan-limits-route.test.ts:53-54'teki `planLimitsFor("business")` varsayimi kod-dogrulandi: aboneligi olmayan org `getEntitlement` -> planCode "grandfathered" -> `planLimitsFor` FALLBACK_LIMITS = business (subscription.ts:87-102, plan-limits.ts:94-
- rate-limit.test.ts:54-61 gercek bir atomiklik testi (10 escuzamanli istek, tam 5 gecer, satir count=10) ve TRUSTED_PROXY_HOPS bolumu "fazla tahmin TEHLIKELI" senaryosunu (saldirgan zinciri beklenen uzunluga sisirir) uyari olarak degil assertion olara
- ai-cost-guards.test.ts:191 olcutu import satirini degil CAGRIYI ariyor (`/consumeDailyAiBudget\s*\(/`) — yorumda iddia edilen mutasyon-sertlestirmesi gercekten yapilmis.
- response-cache-policy.test.ts:47 CACHEABLE regex'i `s-maxage`, `max-age=030` ve `max-age=0, s-maxage=600` (klasik CDN kalibi) icin dogru calisiyor; global next.config blogu ve CSP form-action/script-src ayrimi da dogru pinlenmis.
- demo-ai-route.test.ts:81-124: `wouldAutoSend` testleri gercek uretim kapisini MOCK'SUZ kosuyor (refund intent, injection metni, fallback source) — landing rozetinin "gercek kapi" iddiasi dogru.
- ai-multi-question.test.ts:165-198: 2.000 karakter gonderim esigi icin gercek off-by-one pini var (2000 gecer + reportError yok / 2001 guven 0.5'e kisilir + reportError var) ve saklama tavani (4.000) ayri asserte ediliyor.
- confirm-toast-hardening.test.ts:383-398: `confirmDialog` sonucu-yok-sayilan cagri taramasi guvenli yonde hata veriyor (`.then()` bicimi bile ihlal sayilir); JSX etiketi tarayicisi da parantez sayarak calisiyor.
- Test kosum ortami: vitest.config.ts `fileParallelism: false` + helpers/db.ts resetDb'nin `rateLimitCounter` ve `chatUsage` dahil her tabloyu temizlemesi sayesinde DB-destekli limitler dosyalar arasi sizmiyor; m45 unique index'i dusuren dosyalar icin 
- escalation-email-retry.test.ts:124-141: kalici arizanin sonsuz donguye donmedigi, `ALERT_MAX_AGE_MS` yas penceresiyle gercekten test edilmis (mesaj yaslandirilinca hic denenmiyor).
