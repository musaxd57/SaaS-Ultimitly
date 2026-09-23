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
import { isDemoOrg } from "@/lib/demo-tenant/constants";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const session = await requireAuth();
  const demo = isDemoOrg(session.organizationId);
  const canManage = session.role === "owner" || session.role === "manager";
  const [properties, connection] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { reservations: true, tasks: true, knowledgeBase: true, calendarSources: true } },
        knowledgeBase: { where: { isActive: true }, select: { category: true } },
        // 🚨 SAĞLIK OKUNUYOR, SATIR SAYMAK YETMİYOR (kurucu, 09-11: "bozuk
        // besleme yeşil 'hazır' → düzelt"). Eski sorgu yalnız `_count` çekiyordu,
        // yani rozetin ölçütü "satır VAR MI" idi; kalıcı olarak bozuk bir besleme
        // (`lastStatus:"error"`) "hazır" yeşilini üretiyordu ve `title` ipucu da
        // "kanal bağlantısı tamam" diyordu.
        calendarSources: { select: { lastStatus: true, lastSyncedAt: true } },
      },
    }),
    getConnectionInfo(session.organizationId),
  ]);

  // Booking-readiness: the handful of things that make the AI genuinely useful
  // for an apartment. Pure derivation from data already on the card's query —
  // shows the host exactly what's still missing.
  const readiness = (p: (typeof properties)[number]) => {
    const cats = new Set(p.knowledgeBase.map((k) => k.category));
    // 🚨 BESLEME SAĞLIĞI DÖRT DURUMU AYIRIR (eskiden SIFIRINI ayırıyordu):
    // hiç senkron olmadı · son senkron başarılı · son senkron BAŞARISIZ · kaynak yok.
    // "Bozuk" ayrı bir hâldir: eksik DEĞİL, ama hazır da DEĞİL — host'un müdahale
    // etmesi gereken tek durum budur ve rozet onu SAKLIYORDU.
    const broken = p.calendarSources.filter((c) => c.lastStatus === "error").length;
    const never = p.calendarSources.filter((c) => !c.lastSyncedAt && c.lastStatus !== "error").length;
    const hasChannel = Boolean(p.hospitableId) || p._count.calendarSources > 0;
    const items: { label: string; done: boolean }[] = [
      { label: "Wi-Fi bilgisi", done: cats.has("wifi") },
      { label: "Giriş talimatı", done: cats.has("checkin") },
      { label: "Ev kuralları", done: cats.has("rules") },
      { label: "Çıkış mesajı", done: cats.has("checkout") },
      // Bozuk besleme "tamam" SAYILMAZ: satır duruyor ama veri akmıyor.
      // Demo (inceleme) hesabında kanal adımı YOK: sahte bağlantı kurulmaz (kurucu kuralı) ve
      // inceleme ekibi bağlantı kuramaz — adım her kartta "eksik" görünürdü.
      ...(demo ? [] : [{ label: "Kanal bağlantısı (Airbnb/Booking ya da takvim)", done: hasChannel && broken === 0 }]),
    ];
    return { items, done: items.filter((i) => i.done).length, broken, never };
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
                    {/* 🚨 BOZUK BESLEME KENDİ RENGİNİ ALIR. Eski rozet iki
                        renkliydi (yeşil "hepsi tamam" / amber "eksik var") ve
                        bozuk besleme İKİSİNE DE uymuyordu — eksik değil ama
                        çalışmıyor. Üçüncü hâl KIRMIZI ve "hazır" DEMEZ. */}
                    <span
                      className={
                        ready.broken > 0
                          ? "ml-auto rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive"
                          : ready.done === ready.items.length
                            ? "ml-auto rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400"
                            : "ml-auto rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300"
                      }
                      title={
                        ready.broken > 0
                          ? "Takvim beslemesi hata veriyor — rezervasyonlar güncellenmiyor olabilir. Mülk sayfasından bağlantıyı kontrol edin."
                          : missing.length > 0
                            ? `Eksik: ${missing.join(", ")}`
                            : "Wi-Fi, giriş, kurallar, çıkış mesajı ve kanal bağlantısı tamam"
                      }
                    >
                      {ready.broken > 0
                        ? "Takvim beslemesi hatalı"
                        : `${ready.done}/${ready.items.length} hazır`}
                    </span>
                  </div>
                  {ready.broken > 0 ? (
                    <p className="mt-1.5 text-xs text-destructive">
                      Takvim beslemesi hata veriyor — yeni rezervasyonlar gelmiyor olabilir.
                    </p>
                  ) : null}
                  {ready.never > 0 && ready.broken === 0 ? (
                    /* "Hiç senkron olmadı" da AYRI bir hâl: bağlantı kurulmuş ama
                       veri henüz akmamış. Eskiden bu da "hazır" sayılıyordu. */
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Takvim beslemesi henüz ilk kez senkronlanmadı.
                    </p>
                  ) : null}
                  {missing.length > 0 ? (
                    <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300/80">Eksik: {missing.join(", ")}</p>
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
