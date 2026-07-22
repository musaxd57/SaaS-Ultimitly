import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, CalendarDays, CalendarSync, ArrowDownToLine, QrCode } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { DeleteButton } from "@/components/delete-button";
import { PropertyForm } from "@/components/properties/property-form";
import { SupplyProfileForm } from "@/components/properties/supply-profile-form";
import { parseSupplyProfile } from "@/lib/supply";
import { PackageOpen } from "lucide-react";
import { CalendarFeed } from "@/components/properties/calendar-feed";
import { CalendarSources } from "@/components/properties/calendar-sources";
import { GuestChatSettings } from "@/components/properties/guest-chat-settings";
import { ReservationPinControl } from "@/components/properties/reservation-pin-control";
import { listReservationsForPinManagement } from "@/lib/guest-chat-pin";
import { GuestErasureControl } from "@/components/properties/guest-erasure-control";
import { guestErasureEnabled, reservationsWithSourceTombstone } from "@/lib/erasure";
import { generateCalendarToken } from "@/lib/export/ics";
import { KB_CATEGORY, RESERVATION_STATUS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ gecmis?: string | string[] }>;
}) {
  const session = await requireAuth();
  // Staff get a read-only view; only owner/manager see edit/delete/sync controls
  // (mirrors the API, which 403s these for staff).
  const canManage = session.role === "owner" || session.role === "manager";
  const { id } = await params;
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      knowledgeBase: { where: { isActive: true }, orderBy: { category: "asc" } },
      reservations: { orderBy: { arrivalDate: "desc" }, take: 5 },
      calendarSources: { orderBy: { createdAt: "asc" } },
      organization: { select: { qrChatPinRequired: true } },
    },
  });
  if (!property) notFound();

  // QR PIN feature (Faz 5) is master-gated by the env switch; the per-reservation
  // PIN control + strict-mode toggle only appear when it's on AND the host can manage.
  const pinFeatureEnabled = process.env.QR_PIN_ENABLED === "1";
  const showPinControls = canManage && process.env.GUEST_CHAT_ENABLED === "1" && pinFeatureEnabled && property.chatEnabled;

  // For PIN management the "last 5 by arrival desc" list is WRONG (Codex 3): a
  // fully-booked apartment pushes the CURRENTLY-STAYING guest out behind future
  // bookings, so the host couldn't reach it to set a PIN. When the controls are
  // shown, list ACTIVE + UPCOMING stays instead (soonest first, generous window)
  // so every stay that can need a PIN is reachable. Otherwise keep the recent list.
  const reservationList = showPinControls
    ? await listReservationsForPinManagement(property.id)
    : property.reservations;

  // KVKK explicit-erasure (m40): the "already erased" state is decided by an actual
  // TOMBSTONE, not merely a masked name — a retention-anonymized row (no tombstone)
  // must still offer the erasure button, not falsely read as "permanently erased".
  const showErasure = session.role === "owner" && guestErasureEnabled();

  // KVKK erasure REACH (Codex 07-22, P2): the rendered list above is capped (last-5
  // or active+upcoming-25), and the erasure control only renders on listed rows — so
  // an OLD guest's deletion request (KVKK m.11, 30-day SLA) had NO UI surface at all.
  // When erasure is enabled, a separate PAGED full-history list (newest first) makes
  // every reservation reachable without changing anyone else's default view. Always
  // server-side paginated — never an unbounded render.
  const HISTORY_PAGE_SIZE = 25;
  const rawHistPage = (await searchParams)?.gecmis;
  const parsedHistPage = Number.parseInt(
    (Array.isArray(rawHistPage) ? rawHistPage[0] : rawHistPage) ?? "",
    10,
  );
  const historyPage =
    Number.isFinite(parsedHistPage) && parsedHistPage >= 1 ? Math.min(parsedHistPage, 10_000) : 1;
  const historyRows = showErasure
    ? await prisma.reservation.findMany({
        where: { propertyId: property.id },
        orderBy: [{ arrivalDate: "desc" }, { id: "desc" }], // deterministic across equal dates
        skip: (historyPage - 1) * HISTORY_PAGE_SIZE,
        take: HISTORY_PAGE_SIZE + 1, // +1 row = "has a next page" probe
        select: {
          id: true,
          guestName: true,
          arrivalDate: true,
          departureDate: true,
          status: true,
          sourceReference: true,
        },
      })
    : [];
  const historyHasNext = historyRows.length > HISTORY_PAGE_SIZE;
  const historyList = historyRows.slice(0, HISTORY_PAGE_SIZE);

  // Erasure state computed over EVERY rendered row (audit fix precedent): the main
  // list AND the history page — an id appearing in both gets one consistent answer.
  const erasedIds = showErasure
    ? await reservationsWithSourceTombstone(session.organizationId, [
        ...reservationList,
        ...historyList,
      ])
    : new Set<string>();
  // Strict mode with PIN-less active/upcoming stays = those chats are locked until
  // the host generates a code — surface a clear warning on the toggle.
  const pinlessActiveUpcoming = showPinControls
    ? reservationList.filter((r) => r.status !== "cancelled" && !r.chatPinHash).length
    : 0;

  // Sibling properties (for "copy supply profile to selected apartments").
  const siblings = await prisma.property.findMany({
    where: { organizationId: session.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Lazily ensure the property has a calendar feed token (backfill for
  // properties created before the feature existed).
  let icalToken = property.icalToken;
  if (!icalToken) {
    icalToken = generateCalendarToken();
    await prisma.property.update({ where: { id: property.id }, data: { icalToken } });
  }

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const feedUrl = `${protocol}://${host}/api/calendar/${icalToken}`;

  return (
    <>
      <PageHeader title={property.name} description="Mülk ayarları ve bilgileri.">
        <LinkButton href="/properties" variant="outline" size="sm">
          <ArrowLeft className="size-4" /> Geri
        </LinkButton>
        {canManage ? (
          <DeleteButton
            endpoint={`/api/properties/${property.id}`}
            redirectTo="/properties"
            label="Mülkü sil"
          />
        ) : null}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mülk Ayarları</CardTitle>
            </CardHeader>
            <CardContent>
              <PropertyForm
                mode="edit"
                canManage={canManage}
                property={{
                  id: property.id,
                  name: property.name,
                  address: property.address ?? "",
                  city: property.city ?? "",
                  country: property.country ?? "",
                  checkInTime: property.checkInTime,
                  checkOutTime: property.checkOutTime,
                  cleaningBufferMinutes: property.cleaningBufferMinutes,
                  notes: property.notes ?? "",
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageOpen className="size-4 text-muted-foreground" /> Malzeme Profili
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SupplyProfileForm
                propertyId={property.id}
                canManage={canManage}
                initial={parseSupplyProfile(property.supplyProfileJson)}
                siblings={siblings}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowDownToLine className="size-4 text-muted-foreground" /> Kanal Takvimleri (içe aktar)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CalendarSources
                propertyId={property.id}
                canManage={canManage}
                sources={property.calendarSources.map((s) => ({
                  id: s.id,
                  label: s.label,
                  url: s.url,
                  lastSyncedAt: s.lastSyncedAt ? s.lastSyncedAt.toISOString() : null,
                  lastStatus: s.lastStatus,
                  lastResult: s.lastResult,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarSync className="size-4 text-muted-foreground" /> Takvim Senkronizasyonu (dışa aktar)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CalendarFeed feedUrl={feedUrl} />
            </CardContent>
          </Card>

          {canManage && process.env.GUEST_CHAT_ENABLED === "1" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <QrCode className="size-4 text-muted-foreground" /> Misafir Chat (QR)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <GuestChatSettings
                  propertyId={property.id}
                  propertyName={property.name}
                  enabled={property.chatEnabled}
                  url={
                    property.chatEnabled && property.chatToken
                      ? `${protocol}://${host}/c/${property.chatToken}`
                      : null
                  }
                  pinFeatureEnabled={pinFeatureEnabled}
                  strictMode={property.organization.qrChatPinRequired}
                  pinlessActiveUpcoming={pinlessActiveUpcoming}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4 text-muted-foreground" /> Bilgi Tabanı
              </CardTitle>
              <Link href="/knowledge" className="text-xs font-medium text-primary hover:underline">
                Düzenle
              </Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {property.knowledgeBase.length === 0 ? (
                <p className="text-sm text-muted-foreground">Henüz bilgi eklenmemiş.</p>
              ) : (
                property.knowledgeBase.map((k) => (
                  <div key={k.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{k.title}</span>
                    <Badge tone={KB_CATEGORY.tone(k.category)}>{KB_CATEGORY.label(k.category)}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4 text-muted-foreground" />{" "}
                {showPinControls ? "Aktif & Yaklaşan Rezervasyonlar" : "Son Rezervasyonlar"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reservationList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Rezervasyon yok.</p>
              ) : (
                reservationList.map((r) => (
                  <div key={r.id} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.guestName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(r.arrivalDate)} – {formatDate(r.departureDate)}
                        </p>
                      </div>
                      <Badge tone={RESERVATION_STATUS.tone(r.status)}>
                        {RESERVATION_STATUS.label(r.status)}
                      </Badge>
                    </div>
                    {showPinControls && r.status !== "cancelled" ? (
                      <ReservationPinControl reservationId={r.id} initialHasPin={Boolean(r.chatPinHash)} />
                    ) : null}
                    {showErasure ? (
                      <GuestErasureControl reservationId={r.id} initialErased={erasedIds.has(r.id)} />
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {showErasure ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="size-4 text-muted-foreground" /> Tüm Rezervasyonlar
                  (KVKK Silme)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Silme talebi gönderen misafirin konaklaması yukarıdaki listede yoksa burada
                  bulun — tüm geçmiş, en yeniden eskiye, sayfa sayfa.
                </p>
                {historyList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {historyPage > 1 ? "Bu sayfada kayıt yok." : "Rezervasyon yok."}
                  </p>
                ) : (
                  historyList.map((r) => (
                    <div key={r.id} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{r.guestName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(r.arrivalDate)} – {formatDate(r.departureDate)}
                          </p>
                        </div>
                        <Badge tone={RESERVATION_STATUS.tone(r.status)}>
                          {RESERVATION_STATUS.label(r.status)}
                        </Badge>
                      </div>
                      <GuestErasureControl reservationId={r.id} initialErased={erasedIds.has(r.id)} />
                    </div>
                  ))
                )}
                {historyPage > 1 || historyHasNext ? (
                  <div className="flex items-center justify-between pt-1 text-sm">
                    {historyPage > 1 ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/properties/${property.id}?gecmis=${historyPage - 1}`}
                      >
                        ← Daha yeni
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span className="text-xs text-muted-foreground">Sayfa {historyPage}</span>
                    {historyHasNext ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/properties/${property.id}?gecmis=${historyPage + 1}`}
                      >
                        Daha eski →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
