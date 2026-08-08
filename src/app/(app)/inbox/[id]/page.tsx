import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarDays, BookOpen, Clock, ArrowLeftRight, CheckSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { orgTimezone } from "@/lib/timezone";
import { canManage } from "@/lib/api";
import { prisma } from "@/lib/db";
import { reservationAmountNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import {
  ConversationThread,
  type ThreadMessage,
} from "@/components/inbox/conversation-thread";
import { DeleteConversationButton } from "@/components/inbox/delete-conversation-button";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { KB_CATEGORY, RESERVATION_STATUS, TASK_STATUS, TASK_TYPE } from "@/lib/constants";
import { formatDate, formatDateTime, formatCurrency, daysUntilDate } from "@/lib/utils";
import { channelLabel, riskTypeLabel } from "@/lib/ui-labels";
import { getReturningGuestInfo } from "@/lib/returning-guest";
import { getAdjacency } from "@/lib/turnover";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const session = await requireAuth();
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
      property: true,
      reservation: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) notFound();

  // Message stamps are real instants → render on the host's wall clock, not the
  // server's. Date-only reservation values below keep using formatDate (UTC).
  const orgRow = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { timezone: true },
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

  const [kb, adjacency, tasks, outboxRows] = await Promise.all([
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
  ]);
  const outboxByMessage = new Map(
    outboxRows.filter((o) => o.messageId).map((o) => [o.messageId as string, o.status]),
  );

  // Turnover day = the adjacent booking's checkout/checkin falls on the SAME
  // Istanbul calendar day as this stay's arrival/departure (daysUntilDate diffs
  // any two dates, not just "today" — reused rather than a new same-day helper).
  const turnoverIn =
    adjacency?.previousDeparture && conversation.reservation
      ? daysUntilDate(adjacency.previousDeparture, conversation.reservation.arrivalDate) === 0
      : false;
  const turnoverOut =
    adjacency?.nextArrival && conversation.reservation
      ? daysUntilDate(adjacency.nextArrival, conversation.reservation.departureDate) === 0
      : false;

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

  // Values for substituting {{placeholders}} in message templates.
  const wifiItem = kb.find((k) => k.category === "wifi");
  const templateVars: Record<string, string> = {
    guestName: conversation.reservation?.guestName ?? conversation.guestIdentifier,
    propertyName: conversation.property.name,
    checkInTime: conversation.property.checkInTime,
    checkOutTime: conversation.property.checkOutTime,
    wifiInfo: wifiItem ? wifiItem.content : "",
  };


// Why the AI last held back on this thread — honest, host-facing wording.
const SKIP_REASON_LABELS: Record<string, string> = {
  escalated_to_human: "AI riskli konu tespit etti — cevap size bırakıldı",
  complaint: "Şikayet algılandı — otomatik cevap gönderilmedi, size bırakıldı",
  low_confidence_or_risky: "AI emin olamadı — taslak onayınızı bekliyor",
  closing_ack: "Misafir sohbeti kapattı — cevap gerekmedi",
  human_hold: "İnsan devri istendi — AI bu konuşmada beklemede",
  reservation_ended: "Konaklama bitti/iptal — otomatik yanıt bu konuşmada kapalı",
  // Kota dolduğunda sebep GÖRÜNÜR olmalı: aksi hâlde host "AI neden sustu?"
  // sorusunun cevabını hiçbir yerde bulamaz (denetim, 07-31).
  daily_budget:
    "Günlük AI sınırınıza ulaşıldı — bu konuşma sınır yenilenince otomatik yanıtlanacak",
  not_connected:
    "Airbnb / Booking bağlantısı kurulu değil — otomatik yanıt gönderilemiyor. Ayarlar'dan bağlantınızı kontrol edin.",
  // "Model emin olamadı"dan AYRI: buna ulaşılamadı demek. Geçici olduğu için
  // konuşma damgalanmaz, servis dönünce kendiliğinden yeniden denenir.
  ai_unavailable:
    "AI servisine geçici olarak ulaşılamadı — bağlantı düzelince bu konuşma otomatik olarak yeniden denenecek",
  // Mevcut müşterilerin gündüz mesajlarının sessizce cevapsız kalmasının TEK
  // sebebi buydu ve hiçbir ekranda yazmıyordu (şema varsayılanı hâlâ gece-only).
  outside_hours:
    "Oto-yanıtın aktif saat aralığı dışında — Ayarlar → AI ve Otomasyon'dan aralığı 7/24 yapabilirsiniz",
  // Gönderim kanalı reddetti. Konuşma kaybolmaz: bir süre sonra kendiliğinden
  // yeniden denenir (denetim, 08-01 — eskiden 2 dakikada bir sessizce yeniden
  // denenip her seferinde kota yakıyor, host hiçbir yerde sebebi göremiyordu).
  // ⚠️ SÜRE GERÇEK OLMALI (denetim, 08-01). Eski metin "birazdan" diyordu ama
  // geri çekilme penceresi 4 SAAT (`SEND_FAILURE_HOLD_MS`) — host 10 dakika
  // sonra bakıp hiçbir şey olmayınca "ürün bozuk" diyor ya da boşuna bekliyor.
  send_failed:
    "Mesaj kanala iletilemedi — bağlantınızı kontrol edin. Otomatik deneme yaklaşık 4 saat sonra tekrarlanır; acilse mesajı elle yanıtlayın.",
  // Sistem yenilenmeyi İZLEMİYOR — sabit aralıklarla yeniden deniyor. Metin de
  // bunu söylemeli (denetim, 08-01).
  subscription_inactive:
    "Hospitable aboneliğiniz pasif görünüyor — mesaj gönderilemiyor. Abonelik yenilendikten sonra en geç birkaç saat içinde yeniden denenir.",
  rate_limited:
    "Kanal geçici olarak yoğun — bu konuşma kısa süre sonra otomatik olarak yeniden denenecek",
  // ⚠️ BELİRSİZ SONUÇ (denetim, 08-01 — üçüncü tur). Mesaj misafire ULAŞMIŞ
  // OLABİLİR: gönderim isteği zaman aşımına/5xx'e düştü ve sağlayıcı geçmişinden
  // güvenle doğrulanamadı, bu yüzden satır bilerek incelemeye park edildi ve
  // ASLA kör tekrar gönderilmedi. Metin host'u "elle yanıtla"ya çağırırsa misafir
  // ÇİFT mesaj alabilir — o yüzden ÖNCE kontrol etmesini söylüyor.
  delivery_unverified:
    "Gönderim sonucu doğrulanamadı — mesaj iletilmiş OLABİLİR. Elle yanıtlamadan önce konuşmayı kanal üzerinden kontrol edin.",
};
  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title={conversation.guestIdentifier}
        description={`${conversation.property.name} · ${channelLabel(conversation.channel)}`}
      >
        <LinkButton href={backHref} variant="outline" size="sm">
          <ArrowLeft className="size-4" /> {backHref.includes("status=problem") ? "Sorunlu konuşmalar" : "Mesajlar"}
        </LinkButton>
        <DeleteConversationButton conversationId={conversation.id} />
      </PageHeader>

      {conversation.skippedReason && conversation.status !== "answered" ? (
        <p className="rounded-md border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          🤖 {SKIP_REASON_LABELS[conversation.skippedReason] ?? "Otomatik yanıt beklemede"}
          {riskTypeLabel(conversation.lastRiskType) ? ` · Sebep: ${riskTypeLabel(conversation.lastRiskType)}` : ""}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ConversationThread
            conversationId={conversation.id}
            messages={messages}
            status={conversation.status}
            priority={conversation.priority}
            propertyId={conversation.propertyId}
            templateVars={templateVars}
            canReply={canManage(session)}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4 text-muted-foreground" /> Mülk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {/* Property name already shown in the page header above — avoid
                  repeating it here, just the details the header doesn't have. */}
              {conversation.property.address ? (
                <p className="text-muted-foreground">
                  {[conversation.property.address, conversation.property.city]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
              <p className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3.5" />
                {conversation.property.checkInTime} → {conversation.property.checkOutTime}
              </p>
            </CardContent>
          </Card>

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
                        {turnoverIn
                          ? `Giriş günü aynı günde önceki misafir saat ${conversation.property.checkOutTime}'te çıkıyor — devir günü.`
                          : `Çıkış günü aynı günde yeni misafir saat ${conversation.property.checkInTime}'te giriyor — devir günü.`}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">Bağlı rezervasyon yok.</p>
              )}
            </CardContent>
          </Card>

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
