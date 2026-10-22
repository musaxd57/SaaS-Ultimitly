import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, BookOpen, ArrowLeftRight, CheckSquare } from "lucide-react";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { orgTimezone } from "@/lib/timezone";
import { stayEndedBefore } from "@/modules/availability/core";
import { canManage } from "@/lib/api";
import { prisma } from "@/lib/db";
import { reservationAmountNumber } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import {
  ConversationThread,
  type ThreadMessage,
} from "@/components/inbox/conversation-thread";
import { DeleteConversationButton } from "@/components/inbox/delete-conversation-button";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { KB_CATEGORY, RESERVATION_STATUS, TASK_STATUS, TASK_TYPE, replyToneOrWarm } from "@/lib/constants";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";
import { channelLabel, riskTypeLabel } from "@/lib/ui-labels";
import { getReturningGuestInfo } from "@/lib/returning-guest";
import { CLOSING_HANDLED_REASON, isClosingHandled } from "@/lib/conversation-attention";
import { getAdjacency } from "@/lib/turnover";
import { listConversationItems } from "@/lib/conversation-items/store";
import { isOpenForHost } from "@/lib/conversation-items/core";
import { ITEM_STATUS_LABELS_TR, itemKindLabel, itemTone } from "@/lib/conversation-items/view";
import { ConversationItemsCard, type ConversationItemRow } from "@/components/inbox/conversation-items-card";
import { conversationItemsEnabled } from "@/lib/conversation-items/flag";
import { preparedDraftOf } from "@/lib/conversation-items/prepared-draft";
import { hostOfferForGate } from "@/lib/automation";
import { loadStayEdgeSummary } from "@/modules/availability/stay-edges-load";
import { aiSuggestExceedsLength, MESSAGE_TOO_LONG_REASON } from "@/lib/ai/message-length";
import { HANDOFF_NOTICE_REASON } from "@/lib/ai/output-veto";
import { skipNoteReasonFor } from "@/lib/inbox-skip-note";
import { SKIP_REASON_LABELS, skipReasonActionFor } from "@/lib/inbox-skip-labels";
import { billingTabAvailable } from "@/lib/billing/billing-tab";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";
import { decisionAiTextEnabled } from "@/lib/decisions/ai-text";
import { listConversationDecisions } from "@/lib/decisions/store";
import {
  buildDecisionCards,
  decisionCardContextFor,
  decisionLinkedItemIds,
  neighborDecidedTimes,
  resolvedDecisionRows,
  visibleDecisions,
} from "@/lib/decisions/card";
import { isImpersonating } from "@/lib/auth/impersonation";
import { isOpenDecision } from "@/lib/decisions/core";
import { DecisionPanel } from "@/components/inbox/decision-panel";
import { CommitmentsCard, type CommitmentRow } from "@/components/inbox/commitments-card";
import { ActionSuggestions } from "@/components/ai-suggestions/action-suggestions";
import { aiActionSuggestionsEnabled, getConversationSuggestions } from "@/lib/ai-suggestions/load";
import { commitmentLateAt, hostCommitmentAutoEnabled, isCommitmentKind, storedCommitmentWhen, type CommitmentKind } from "@/lib/guest-commitments-core";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const session = await requireManagerSession();
  const { id } = await params;
  const sp = await searchParams;

  // 🔙 GERİ HEDEFİ — geldiğin listeye döner (filtre + sayfa korunur).
  // ⚠️ AÇIK YÖNLENDİRME KAPISI: değer istemciden gelir, o yüzden YALNIZ kendi
  // gelen kutusu yollarımız kabul edilir. `startsWith("/inbox")` TEK BAŞINA
  // YETMEZ — `//evil.tld` protokol-göreli bir DIŞ adrestir ve `/inbox@evil.tld`
  // gibi biçimler de vardır; bu yüzden tam eşleşme ya da `/inbox?` öneki aranır.
  const rawFrom = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const backHref = rawFrom === "/inbox" || (rawFrom?.startsWith("/inbox?") ?? false) ? rawFrom! : "/inbox";

  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    include: {
      // Yalnız sayfanın kullandığı alanlar (DENETIM 08-09 #10 / ACIK-08 §15): `property: true` sunucuya `icalToken`, `chatToken` gibi
      // erişim sırlarını, `reservation: true` misafir iletişim alanlarını da çekiyordu. İstemciye bugün de yalnız projeksiyon gidiyor;
      // daraltma savunma derinliği — bir sonraki eklenen prop'un sırrı sızdırması yapısal olarak imkânsız (alan yoksa tür hatası).
      property: { select: { name: true, checkInTime: true, checkOutTime: true, address: true, city: true } },
      reservation: {
        select: {
          id: true,
          guestName: true,
          guestExternalId: true,
          arrivalDate: true,
          departureDate: true,
          status: true,
          currency: true,
          totalAmount: true,
          totalAmountDec: true,
        },
      },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) notFound();

  // Message stamps are real instants → render on the host's wall clock, not the
  // server's. Date-only reservation values below keep using formatDate (UTC).
  const orgRow = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { timezone: true, lateCheckoutOfferText: true, aiReplyTone: true },
  });
  const TZ = orgTimezone(orgRow?.timezone);

  // Returning-guest context — matched only by the reliable Hospitable guest id
  // (never name/email), so there are no false "welcome back" positives.
  const returning = conversation.reservation
    ? await getReturningGuestInfo(session.organizationId, {
        id: conversation.reservation.id,
        guestExternalId: conversation.reservation.guestExternalId,
        // Ölçüt: "bu konaklamadan ÖNCE gelenler" (takvimdeki şu an DEĞİL).
        arrivalDate: conversation.reservation.arrivalDate,
      })
    : null;
  // Liste bilinçli kısa (kart dar bir kenar çubuğunda). Gizlenen satır sayısı
  // YAZILIR: "26. konaklama" rozetinin altında 5 satır görüp gerisini yok
  // sanmak, kırpmayı sessiz veri kaybına çevirirdi.
  const hiddenStays = returning ? returning.stayCount - 1 - returning.pastStays.length : 0;

  // Konaklama bitti mi — aşağıdaki kenar/devir bloklarının kapısı. Oto-yanıtın "konaklama bitti" kuralıyla AYNI
  // fonksiyon (TEK TARİH KURALI; eski ham kıyas New York'ta çıkış günü boyunca blokları gizliyordu).
  const stayIsOver = conversation.reservation
    ? stayEndedBefore(conversation.reservation.departureDate, new Date(), TZ)
    : false;

  // K10 (kurucu kararı 09-30): son oto-yanıt tutuşu konuyu ev sahibine bırakan bir cevap yüzündense (karar kaydı `handoff_notice`)
  // not "Misafir cevabınızı bekliyor" der. `skippedReason` bilerek aynı kalır (on tüketicisi var) — not, son misafir mesajının
  // karar kaydından TÜRETİLİR (benzersiz anahtar; okuma hatası bugünkü notu gösterir).
  const lastInboundId = [...conversation.messages].reverse().find((m) => m.direction === "inbound")?.id ?? null;
  const [kb, adjacency, tasks, outboxRows, stayEdges, itemViews, heldEvent] = await Promise.all([
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId: conversation.propertyId, isActive: true },
      orderBy: { category: "asc" },
    }),
    // Same adjacency data the AI prompt uses for early-checkin/late-checkout
    // reasoning — surfaced here so the host sees the turnover context too,
    // not just the model. Read-only; confirmed/completed bookings only.
    conversation.reservation
      ? getAdjacency(
          conversation.propertyId,
          conversation.reservation.arrivalDate,
          conversation.reservation.departureDate,
        )
      : null,
    conversation.reservation
      ? prisma.task.findMany({
          where: { reservationId: conversation.reservation.id },
          orderBy: [{ status: "asc" }, { dueAt: "asc" }],
          select: { id: true, type: true, title: true, status: true, dueAt: true },
        })
      : [],
    // Durable Outbox delivery status per outbound message (#3): a queued / sending /
    // ambiguous / review reply must never look like a normally-delivered bubble.
    prisma.messageOutbox.findMany({ where: { conversationId: id }, select: { messageId: true, status: true } }),
    // Müsaitlik motoru dilim 2: erken giriş / geç çıkış / uzatma gecelerinin durumu + kanıtı.
    // YALNIZ HOST'A — yapay zekâya bağlı DEĞİL. Biten konaklamada sorulmaz (sorgu da atılmaz).
    conversation.reservation && !stayIsOver
      ? loadStayEdgeSummary(
          session.organizationId,
          conversation.propertyId,
          {
            id: conversation.reservation.id,
            arrival: conversation.reservation.arrivalDate,
            departure: conversation.reservation.departureDate,
            status: conversation.reservation.status,
          },
          { timeZone: TZ },
        )
      : null,
    // Konuşma öğeleri (09-26): misafirin isteklerinden ev sahibinde açık kalanlar. Okuma hatası sayfayı düşürmez.
    listConversationItems(prisma, { organizationId: session.organizationId, conversationId: conversation.id }).catch(() => []),
    conversation.skippedReason === "low_confidence_or_risky" && lastInboundId
      ? prisma.riskEvent
          .findUnique({
            where: {
              organizationId_surface_triggerId_finalDecision: {
                organizationId: session.organizationId,
                surface: "auto_reply",
                triggerId: lastInboundId,
                finalDecision: "human_review",
              },
            },
            select: { reason: true },
          })
          .catch(() => null)
      : null,
  ]);
  const skipNoteReason = skipNoteReasonFor({
    skippedReason: conversation.skippedReason,
    heldReason: heldEvent?.reason ?? null,
    reservationStatus: conversation.reservation?.status ?? null,
  });
  // Plan bağlantısı yalnız Faturalandırma sekmesi gerçekten varken (sahip + Paddle yapılandırılmış).
  const bandAction = skipReasonActionFor(skipNoteReason ?? conversation.skippedReason, billingTabAvailable(session.role));

  // HOST KARAR MOTORU (Faz 1, `HOST_DECISIONS_ENABLED`): ev sahibinin kararını bekleyen konaklama istekleri sayfanın EN ÜSTÜNDE
  // (telefonda da ilk görünen). Yalnız sahip / yönetici (kart misafir mesajının türevi — personel görmez). Okuma hatası sayfayı düşürmez.
  const decisionViews =
    hostDecisionsEnabled() && canManage(session)
      ? await listConversationDecisions(prisma, {
          organizationId: session.organizationId,
          conversationId: conversation.id,
          timeZone: TZ,
          now: new Date(),
        }).catch(() => [])
      : [];
  const shownDecisions = visibleDecisions(decisionViews);
  // Kart bağlamı karar rotasıyla AYNI kurucudan (olgu parmak izi iki yerde aynı girdilerle); sayfanın zaten yüklediği komşu /
  // gece özeti verilir (ikinci sorgu yok).
  const decisionCards =
    shownDecisions.length > 0
      ? await decisionCardContextFor({
          organizationId: session.organizationId,
          conversation,
          timeZone: TZ,
          now: new Date(),
          needsEarlyRule: shownDecisions.some((v) => v.kind === "early_checkin"),
          preloaded: { adjacency, stayEdgeLines: stayEdges?.lines ?? [] },
        })
          .then((ctx) => buildDecisionCards(shownDecisions, ctx))
          .catch(() => [])
      : [];
  const resolvedRows = resolvedDecisionRows(decisionViews, TZ);
  // Kartı / sonuç satırı olan talebin konuşma öğesi "Açık işler"de ikinci kez görünmez.
  const decisionItems = decisionLinkedItemIds(decisionViews);
  // Son misafir mesajının tutuşu bir karar kartıyla anlatılıyorsa "AI emin olamadı / misafir cevabınızı bekliyor" bandı tekrar olur.
  const decisionCoversHold = shownDecisions.some((v) => isOpenDecision(v.effective) && v.messageId === lastInboundId);
  // Açıklar üstte, sonra en yeni. Kart dar bir rayda: en fazla 20 satır.
  const itemRows: ConversationItemRow[] = [...itemViews]
    .filter((v) => !decisionItems.has(v.id))
    .sort(
      (a, b) =>
        Number(isOpenForHost(b.effective)) - Number(isOpenForHost(a.effective)) || b.messageAt.getTime() - a.messageAt.getTime(),
    )
    .slice(0, 20)
    .map((v) => ({
      id: v.id,
      kindLabel: itemKindLabel(v.kind),
      statusLabel: ITEM_STATUS_LABELS_TR[v.effective],
      tone: itemTone(v.effective, v.sensitivity),
      open: isOpenForHost(v.effective),
      at: formatDateTime(v.messageAt, TZ),
    }));
  const outboxByMessage = new Map(
    outboxRows.filter((o) => o.messageId).map((o) => [o.messageId as string, o.status]),
  );

  // Yapay zekâ EYLEM ÖNERİLERİ (⑤ ilk dilim, kurucu 10-12: "öner + tek tıkla onay"): görev + söz. Yalnız yönetici, destek görünümünde YOK
  // (yazma kapalı — K8), anahtar kapalıyken veri hiç ÜRETİLMEZ. Okunamazsa öneri yok (sayfa etkilenmez).
  // Söz → görev otomatik açıkken (öneri anahtarı kapalı olsa da) SÖZ kartları görünür: belirsiz saat / hangi söz seçimi ve günlük sınır
  // aşımı ancak buradan çözülür (kurucu 10-17 gece). Görev / Wi-Fi önerisi yine öneri anahtarına bağlı.
  const suggestionsOn = aiActionSuggestionsEnabled();
  const actionSuggestions =
    (suggestionsOn || hostCommitmentAutoEnabled()) && canManage(session) && !isImpersonating(session)
      ? (await getConversationSuggestions(session.organizationId, conversation.id).catch(() => [])).filter(
          (s) => suggestionsOn || s.kind === "commitment",
        )
      : [];

  // Misafire verilen AÇIK sözler (açık taahhüt hafızası A, kurucu kararı 10-10; migration 62) — yalnız yönetici görür / işaretler.
  const commitmentNow = new Date();
  const commitmentRows: CommitmentRow[] = canManage(session)
    ? (
        await prisma.guestCommitment.findMany({
          where: { conversationId: conversation.id, organizationId: session.organizationId, status: "open" },
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          take: 20,
          select: { id: true, kind: true, topic: true, dueAt: true, duePrecision: true, dayPart: true, source: true },
        })
      )
        .filter((c): c is typeof c & { kind: CommitmentKind } => isCommitmentKind(c.kind))
        .map((c) => {
          // Saat UYDURULMAZ (kurucu 10-17 gece): dilim / gün sözünde "yarın akşam", "bugün (saat belirtilmedi)"; açık saatte 30 dk pay
          // dolmadan "gecikti" denmez (kalan 0 → "zamanı geldi").
          const precise = c.duePrecision == null || c.duePrecision === "time";
          const rawLeft = Math.floor((c.dueAt.getTime() - commitmentNow.getTime()) / 60_000);
          return {
            id: c.id,
            kind: c.kind,
            topic: c.topic,
            dueLabel: precise ? formatDateTime(c.dueAt, TZ) : storedCommitmentWhen(c, commitmentNow, TZ),
            // Pay yalnız söz → görev otomatik açıkken (O16: anahtar kapalıyken bugünkü görünüm).
            minutesLeft: hostCommitmentAutoEnabled() && commitmentNow.getTime() < commitmentLateAt(c).getTime() ? Math.max(0, rawLeft) : rawLeft,
            precise,
            auto: c.source === "auto",
          };
        })
    : [];

  // Turnover day = the adjacent booking's checkout/checkin falls on the SAME
  // calendar day (property timezone) as this stay's arrival/departure — decided
  // once in `getAdjacency` with the availability engine's date rule.
  // 🚨 DEVİR UYARISI YALNIZ HÂLÂ YAPILACAK İŞ İÇİNSE GÖSTERİLİR (kullanıcı kararı).
  // Bu bant bir OPERASYON uyarısı: "temizlik çıkışla giriş arasına sıkışıyor".
  // GEÇMİŞ bir konaklamada söyleyecek bir şey yok — iş çoktan yapıldı (ya da
  // yapılmadı, ama artık yapılamaz. Kullanıcı ekran görüntüsüyle bildirdi:
  // 11–12 Haziran'da biten bir rezervasyonda "devir günü" yazması gürültü.
  // ⚠️ Karşılaştırma GÜN ANAHTARI ile: `departureDate` iCal'de 12:00Z, Hospitable'da
  // 00:00Z damgalı — ham `Date` karşılaştırması iki kaynağı farklı ele alırdı.
  // "Aynı gün devir" kararı `getAdjacency`de, müsaitlik motorunun takvim günü kuralıyla verilir
  // (istemle AYNI karar — ekran ile model aynı olguyu görür).
  const turnoverIn = !stayIsOver && adjacency?.previousSameDay === true;
  const turnoverOut = !stayIsOver && adjacency?.nextSameDay === true;
  // Host Karar Motoru (bayraklı): komşu misafirin ONAYLANMIŞ geç çıkışı / erken girişi devir kutusuna yansır — karar kartıyla
  // çelişmesin ("önceki misafir 11:00" yazarken kartta "geç çıkışı 12:00 onaylandı"). Okuma hatası standart saati gösterir.
  const neighborTimes =
    hostDecisionsEnabled() && conversation.reservation && (turnoverIn || turnoverOut)
      ? await neighborDecidedTimes({
          organizationId: session.organizationId,
          propertyId: conversation.propertyId,
          reservationId: conversation.reservation.id,
          stay: { arrivalDate: conversation.reservation.arrivalDate, departureDate: conversation.reservation.departureDate },
          timeZone: TZ,
          now: new Date(),
        }).catch(() => ({ previousLateCheckout: null, nextEarlyCheckin: null }))
      : { previousLateCheckout: null, nextEarlyCheckin: null };

  // K10-t: cevapsız misafir mesajlarından biri ya da "AI öner"in cevaplayacağı son gelen mesaj 8.000 karakteri aşıyor mu (oto-yanıt
  // kaydından bağımsız; "AI öner" rotasıyla AYNI kural).
  const tooLongForAi = aiSuggestExceedsLength(conversation.messages);
  const messages: ThreadMessage[] = conversation.messages
    // A superseded AI draft (its outbox row was CANCELED by the send-time veto) never reached
    // the guest — hide it from the thread. It is NOT deleted: the row stays for export/audit
    // as "not delivered". Every other outbox state still renders (with its status badge).
    .filter((m) => outboxByMessage.get(m.id) !== "canceled")
    .map((m) => ({
      id: m.id,
      direction: m.direction as "inbound" | "outbound",
      senderName: m.senderName,
      authorType: m.authorType,
      body: m.body,
      outboxStatus: outboxByMessage.get(m.id) ?? null,
      createdAtLabel: formatDateTime(m.createdAt, TZ),
    }));

  // HAZIR TASLAK (kurucu 09-26, "Otomatik hazır dursun"; konuşma öğeleri): en son misafir mesajının kayıtlı taslağı,
  // müsaitlik uyarısı yeniden hesaplanarak (`prepared-draft.ts`). Bayrak kapalıyken gösterilmez — bugünkü davranış.
  const preparedDraft =
    conversationItemsEnabled() && canManage(session)
      ? preparedDraftOf(
          conversation.messages.filter((m) => outboxByMessage.get(m.id) !== "canceled"),
          {
            stayTimes: { checkIn: conversation.property.checkInTime, checkOut: conversation.property.checkOutTime },
            hostOfferText: hostOfferForGate(orgRow?.lateCheckoutOfferText),
          },
        )
      : null;

  // Values for substituting {{placeholders}} in message templates.
  const wifiItem = kb.find((k) => k.category === "wifi");
  const templateVars: Record<string, string> = {
    guestName: conversation.reservation?.guestName ?? conversation.guestIdentifier,
    propertyName: conversation.property.name,
    checkInTime: conversation.property.checkInTime,
    checkOutTime: conversation.property.checkOutTime,
    wifiInfo: wifiItem ? wifiItem.content : "",
  };


  return (
    <>
      <AutoRefresh seconds={30} />
      {/* 🚨 EYLEM SATIRI KALDIRILDI (kurucu 09-11: "mesaj yeri en üste kadar
          uzasın"). "← Mesajlar" ve "Sil" artık kartın KENDİ başlık satırında,
          sağda (`headerActions` slotu) — kartın üstünde artık hiçbir şey yok,
          yani mesaj listesi 3.5rem (buton 2rem + `gap-6` 1.5rem) kazandı.
          Bilgi kaybı YOK: iki düğme de aynı yerde, bir satır aşağıda. */}
      {/* "Cevap gerekmedi" etiketi TÜRETİLİR (inceleme 09-25): kayıttaki `closing_ack` misafir yeniden yazdıktan sonra da
          durur — yeni bir soru varken "sohbeti kapattı" yazmasın. Kapanış satırlarında eski risk gerekçesi gösterilmez. */}
      {/* K10-t: uzun mesaj uyarısı KAYITTAN BAĞIMSIZ türetilir — oto-yanıt kapalı / mesai dışı olsa da ev sahibi görür. */}
      {/* 09-28 inceleme: ev sahibi "Cevaplandı" / "Tamamlandı" yaptıysa uyarı gizlenir; uyarı yolunun risk sebebi (uzun acil mesaj →
          "Sebep: güvenlik / acil durum") uyarıyla BİRLİKTE gösterilir — eskiden uyarı sebebi saklıyordu. */}
      {tooLongForAi && conversation.status !== "answered" && conversation.status !== "closed" ? (
        <p className="rounded-md border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          🤖 {SKIP_REASON_LABELS[MESSAGE_TOO_LONG_REASON]}
          {riskTypeLabel(conversation.lastRiskType) ? ` · Sebep: ${riskTypeLabel(conversation.lastRiskType)}` : ""}
        </p>
      ) : tooLongForAi ? null : conversation.skippedReason &&
      conversation.status !== "answered" &&
      !(decisionCoversHold && (skipNoteReason === "low_confidence_or_risky" || skipNoteReason === HANDOFF_NOTICE_REASON)) &&
      (conversation.skippedReason !== CLOSING_HANDLED_REASON || isClosingHandled(conversation)) ? (
        <p className="rounded-md border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          🤖 {SKIP_REASON_LABELS[skipNoteReason ?? conversation.skippedReason] ?? "Otomatik yanıt beklemede"}
          {riskTypeLabel(conversation.lastRiskType) && !conversation.skippedReason.startsWith("closing_ack")
            ? ` · Sebep: ${riskTypeLabel(conversation.lastRiskType)}`
            : ""}
          {bandAction ? (
            <>
              {" "}
              <Link href={bandAction.href} className="font-medium underline underline-offset-2">
                {bandAction.label}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {/* min-w-0 ZORUNLU — mesaj balonundaki `break-words` BU İŞİ GÖRMEZ:
          `overflow-wrap:break-word` satır kırma fırsatı ekler ama spec gereği
          MIN-CONTENT hesabına KATILMAZ (katılan değer `anywhere`). Bu yüzden
          misafirin yapıştırdığı 114 karakterlik bölünemez Airbnb linki
          (`source_impression_id=…`) sütunun min-content'ini 486 px'e çıkarıyor,
          `min-width:auto` yüzünden sütun küçülmeyi reddediyor ve TELEFONDA
          SAYFA YATAY KAYIYOR (ölçüldü: scrollWidth 560 → 390/360/414 = temiz).
          `max-w-[90%]` de kurtarmaz: yüzdeler intrinsic boyutlamada çözülmez.
          Çözüm sütunu küçülebilir yapmak; link o zaman `break-words` ile
          SARAR (kırpılmaz) — balonun kendisine `anywhere`/`break-all` VERİLMEDİ,
          o normal Türkçe metni de kelime ortasından bölerdi. */}
      {/* Sağ ray SABİT 20rem; kalan genişliğin TAMAMI konuşmaya gider. Eski
          `lg:grid-cols-3` (2/3 ≈ %66) geniş ekranda yazma alanını gereksiz dar
          bırakıyordu (kurucu: "genişliğini de biraz daha arttır"). */}
      {/* `lg:flex-1 lg:min-h-0`: kabuk bu yolda dikey flex kapsayıcı kurar
          (`app-shell.tsx` `fillsViewport`), böylece bu satır ÜSTÜNDEKİ her şeyden
          (eylem satırı, "Otomatik yanıt beklemede" bandı, deneme/limit bandı)
          ARTAN alanın tamamını alır. Eskiden yükseklik `calc(100vh/0.95-11rem)`
          sabitiydi ve bandları saymıyordu → ölçüldü: tek bandda `<main>` 46 px,
          iki bandda 109 px taşıyordu. */}
      <DecisionPanel
        conversationId={conversation.id}
        decisions={decisionCards}
        resolved={resolvedRows}
        readOnly={isImpersonating(session)}
        aiText={decisionAiTextEnabled()}
      />

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:min-h-0">
          <ConversationThread
            conversationId={conversation.id}
            messages={messages}
            status={conversation.status}
            priority={conversation.priority}
            propertyId={conversation.propertyId}
            guestName={conversation.guestIdentifier}
            propertyLabel={`${conversation.property.name} · ${channelLabel(conversation.channel)} · ${conversation.property.checkInTime} → ${conversation.property.checkOutTime}`}
            propertyTitle={
              [conversation.property.address, conversation.property.city].filter(Boolean).join(", ") || undefined
            }
            templateVars={templateVars}
            canReply={canManage(session)}
            defaultTone={replyToneOrWarm(orgRow?.aiReplyTone)}
            initialDraft={preparedDraft}
            headerActions={
              <>
                <LinkButton
                  href={backHref}
                  variant="outline"
                  size="sm"
                  aria-label={backHref.includes("status=problem") ? "Sorunlu konuşmalara dön" : "Mesajlara dön"}
                >
                  <ArrowLeft className="size-4" />
                  <span className="hidden sm:inline">
                    {backHref.includes("status=problem") ? "Sorunlu konuşmalar" : "Mesajlar"}
                  </span>
                </LinkButton>
                <DeleteConversationButton conversationId={conversation.id} />
              </>
            }
          />
        </div>

        {/* Sağ ray KENDİ İÇİNDE kayar (lg): konuşma kartı görünür alana
            sabitlendiği için, uzun bir rezervasyon/görev listesi SAYFAYI
            kaydırsaydı kart yerinde durup altında yine boşluk açılırdı —
            kurucunun şikâyet ettiği davranışın ta kendisi. Yükseklik kartla
            AYNI ifadeden gelir; ikisi ayrışırsa satır yüksekliği zıplar —
            ikisi de artık `lg:h-full` (grid satırının kendisi ölçüyü verir). */}
        <div className="min-w-0 space-y-4 lg:h-full lg:min-h-[26rem] lg:overflow-y-auto lg:pr-1">
          <ConversationItemsCard conversationId={conversation.id} items={itemRows} canManage={canManage(session)} />
          <ActionSuggestions items={actionSuggestions} />
          {/* 🚨 "Mülk" KARTI KALDIRILDI (kurucu 09-11): adres çoğu hostta boş
              olduğu için kart pratikte TEK BİR SATIR gösteriyordu — giriş/çıkış
              saati. O satır artık konuşma kartının başlık satırında; adres,
              varsa, aynı satırın `title` ipucunda. Bilgi kaybı YOK, bir kart
              yüksekliği kazanıldı. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4 text-muted-foreground" /> Rezervasyon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {conversation.reservation ? (
                <>
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{conversation.reservation.guestName}</p>
                    <Badge tone={RESERVATION_STATUS.tone(conversation.reservation.status)}>
                      {RESERVATION_STATUS.label(conversation.reservation.status)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {formatDate(conversation.reservation.arrivalDate)} –{" "}
                    {formatDate(conversation.reservation.departureDate)}
                  </p>
                  <p className="text-muted-foreground">
                    {formatCurrency(
                      reservationAmountNumber(conversation.reservation),
                      conversation.reservation.currency,
                    )}
                  </p>
                  {returning ? (
                    <div className="mt-2 space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2">
                      <Badge tone="warning">🔁 {returning.stayCount}. konaklama</Badge>
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {returning.pastStays.map((s) => (
                          <li key={s.id}>
                            {s.propertyName} · {formatDate(s.arrivalDate)}–{formatDate(s.departureDate)}
                          </li>
                        ))}
                      </ul>
                      {hiddenStays > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          ve {hiddenStays} önceki konaklama daha
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {turnoverIn || turnoverOut ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning-foreground">
                      <ArrowLeftRight className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {/* Saate ek yazılmaz ("11:00'te" yanlıştı: "on bir'de"); onaylanmış komşu saati varsa o yazılır. */}
                        {turnoverIn
                          ? neighborTimes.previousLateCheckout
                            ? `Devir günü: giriş günü önceki misafir çıkıyor (onaylı geç çıkış: ${neighborTimes.previousLateCheckout}).`
                            : `Devir günü: giriş günü önceki misafir çıkıyor (standart çıkış ${conversation.property.checkOutTime}).`
                          : neighborTimes.nextEarlyCheckin
                            ? `Devir günü: çıkış günü yeni misafir giriyor (onaylı erken giriş: ${neighborTimes.nextEarlyCheckin}).`
                            : `Devir günü: çıkış günü yeni misafir giriyor (standart giriş ${conversation.property.checkInTime}).`}
                      </span>
                    </div>
                  ) : null}
                  {stayEdges && stayEdges.lines.length > 0 ? (
                    <div className="mt-2 space-y-1 rounded-md border p-2 text-xs" data-testid="stay-edges">
                      <p className="font-medium">Önceki ve sonraki geceler</p>
                      <ul className="space-y-0.5">
                        {stayEdges.lines.map((l) => (
                          <li
                            key={l.text}
                            className={
                              l.tone === "warn"
                                ? "text-warning-foreground"
                                : l.tone === "ok"
                                  ? "text-success"
                                  : "text-muted-foreground"
                            }
                          >
                            {l.text}
                          </li>
                        ))}
                      </ul>
                      {stayEdges.footer ? <p className="text-muted-foreground">{stayEdges.footer}</p> : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">Bağlı rezervasyon yok.</p>
              )}
            </CardContent>
          </Card>
          {/* Görsel inceleme 10-21 #5: rezervasyon (tarihler, devir günü uyarısı) cevabı değiştirir → söz formundan ÖNCE. */}
          {canManage(session) ? (
            <CommitmentsCard conversationId={conversation.id} commitments={commitmentRows} readOnly={isImpersonating(session)} />
          ) : null}

          {conversation.reservation ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckSquare className="size-4 text-muted-foreground" /> Görevler
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Bu konaklama için görev yok.</p>
                ) : (
                  tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{t.title}</p>
                        <Badge tone={TASK_TYPE.tone(t.type)}>{TASK_TYPE.label(t.type)}</Badge>
                      </div>
                      <Badge tone={TASK_STATUS.tone(t.status)}>{TASK_STATUS.label(t.status)}</Badge>
                    </div>
                  ))
                )}
                <LinkButton
                  href={`/tasks?propertyId=${conversation.propertyId}`}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Tüm görevleri gör
                </LinkButton>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4 text-muted-foreground" /> Bilgi Tabanı
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {kb.length === 0 ? (
                <p className="text-sm text-muted-foreground">Bu mülk için bilgi yok.</p>
              ) : (
                kb.map((k) => (
                  <div key={k.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{k.title}</span>
                    <Badge tone={KB_CATEGORY.tone(k.category)}>{KB_CATEGORY.label(k.category)}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
