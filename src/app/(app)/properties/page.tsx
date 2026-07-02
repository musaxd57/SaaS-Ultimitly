import Link from "next/link";
import { Building2, Plus, MapPin, Clock } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { getConnectionInfo } from "@/lib/hospitable-credentials";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const session = await requireAuth();
  const canManage = session.role === "owner" || session.role === "manager";
  const [properties, connection] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { reservations: true, tasks: true, knowledgeBase: true, calendarSources: true } },
        knowledgeBase: { where: { isActive: true }, select: { category: true } },
      },
    }),
    getConnectionInfo(session.organizationId),
  ]);

  // Booking-readiness: the handful of things that make the AI genuinely useful
  // for an apartment. Pure derivation from data already on the card's query —
  // shows the host exactly what's still missing.
  const readiness = (p: (typeof properties)[number]) => {
    const cats = new Set(p.knowledgeBase.map((k) => k.category));
    const items: { label: string; done: boolean }[] = [
      { label: "Wi-Fi bilgisi", done: cats.has("wifi") },
      { label: "Giriş talimatı", done: cats.has("checkin") },
      { label: "Ev kuralları", done: cats.has("rules") },
      { label: "Çıkış mesajı", done: cats.has("checkout") },
      { label: "Kanal bağlantısı (Hospitable/iCal)", done: Boolean(p.hospitableId) || p._count.calendarSources > 0 },
    ];
    return { items, done: items.filter((i) => i.done).length };
  };

  return (
    <>
      <PageHeader title="Mülkler" description="Yönettiğiniz tüm mülkler ve ayarları.">
        {canManage ? (
          <LinkButton href="/properties/new">
            <Plus className="size-4" /> Yeni mülk
          </LinkButton>
        ) : null}
      </PageHeader>

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Henüz mülk eklenmemiş"
          description={
            connection.connected
              ? "Airbnb / Booking bağlı — daireleriniz ilk eşitlemede otomatik eklenir. Dilerseniz elle de ekleyebilirsiniz."
              : "Airbnb / Booking bağlantısını kurunca daireleriniz otomatik eklenir. Dilerseniz şimdi elle de ekleyebilirsiniz."
          }
        >
          {canManage ? (
            <LinkButton href="/properties/new" size="sm">
              <Plus className="size-4" /> İlk mülkü ekle
            </LinkButton>
          ) : null}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => {
            const ready = readiness(p);
            const missing = ready.items.filter((i) => !i.done).map((i) => i.label);
            return (
              <Link key={p.id} href={`/properties/${p.id}`}>
                <Card className="h-full p-5 transition-colors hover:border-primary/40 hover:bg-accent/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Building2 className="size-5" />
                    </div>
                    <Badge tone="muted">{p._count.reservations} rez.</Badge>
                  </div>
                  <h3 className="mt-3 font-semibold">{p.name}</h3>
                  {p.city || p.address ? (
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {[p.address, p.city].filter(Boolean).join(", ")}
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" /> {p.checkInTime} → {p.checkOutTime}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{p._count.tasks} görev</span>
                    <span>·</span>
                    <span>{p._count.knowledgeBase} bilgi</span>
                    <span
                      className={
                        ready.done === ready.items.length
                          ? "ml-auto rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
                          : "ml-auto rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
                      }
                      title={
                        missing.length > 0
                          ? `Eksik: ${missing.join(", ")}`
                          : "Wi-Fi, giriş, kurallar, çıkış mesajı ve kanal bağlantısı tamam"
                      }
                    >
                      {ready.done}/{ready.items.length} hazır
                    </span>
                  </div>
                  {missing.length > 0 ? (
                    <p className="mt-1.5 text-xs text-amber-700/80">Eksik: {missing.join(", ")}</p>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
