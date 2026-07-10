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
import { generateCalendarToken } from "@/lib/export/ics";
import { KB_CATEGORY, RESERVATION_STATUS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
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
    },
  });
  if (!property) notFound();

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
                <CalendarDays className="size-4 text-muted-foreground" /> Son Rezervasyonlar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {property.reservations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Rezervasyon yok.</p>
              ) : (
                property.reservations.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2">
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
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
