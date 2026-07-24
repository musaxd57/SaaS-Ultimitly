import {
  Sparkles,
  MessageSquare,
  LogIn,
  LogOut,
  AlertTriangle,
  Trophy,
  BedDouble,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { riskTypeLabel } from "@/lib/ui-labels";
import {
  getAiOpsReport,
  getTopTopics,
  getHostPerformanceScore,
  getOccupancyByProperty,
} from "@/lib/reports";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

// Friendly Turkish labels for the AI intent taxonomy.
const INTENT_LABEL: Record<string, string> = {
  wifi: "Wi-Fi",
  parking: "Otopark",
  location: "Konum / Yol tarifi",
  checkin: "Giriş",
  checkout: "Çıkış",
  early_checkin: "Erken giriş",
  late_checkout: "Geç çıkış",
  early_departure: "Erken ayrılma",
  human_request: "İnsan desteği isteniyor",
  cleaning: "Temizlik",
  amenity: "Ekipman / Eşya",
  complaint: "Şikayet",
  refund: "İade",
  general: "Genel",
};

export default async function ReportsPage() {
  const { organizationId } = await requireAuth();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Risk view reads the append-only RiskEvent HISTORY (Codex #32) — the old
  // Conversation snapshot kept only the LAST decision per thread, so earlier
  // risks vanished and a stale one looked current. No backfill by design:
  // counting starts when the event log shipped (the card says so).
  const HELD_REASONS = ["escalated_to_human", "keyword_escalated", "low_confidence_or_risky"];
  const [riskRows, heldRows, heldResolved] = await Promise.all([
    prisma.riskEvent.groupBy({
      by: ["riskLevel"],
      where: { organizationId, occurredAt: { gte: since30 }, riskLevel: { not: null } },
      _count: { _all: true },
    }),
    prisma.riskEvent.groupBy({
      by: ["reason"],
      where: {
        organizationId,
        occurredAt: { gte: since30 },
        finalDecision: "human_review",
        reason: { in: HELD_REASONS },
      },
      _count: { _all: true },
    }),
    // Held-for-human threads the host has since answered = manually resolved.
    // Thread STATE, not decision history — stays on Conversation on purpose.
    prisma.conversation.count({
      where: {
        property: { organizationId },
        lastMessageAt: { gte: since30 },
        skippedReason: { in: ["escalated_to_human", "complaint", "low_confidence_or_risky"] },
        status: "answered",
      },
    }),
  ]);
  const riskCount = (lvl: string) =>
    riskRows.find((r) => r.riskLevel === lvl)?._count._all ?? 0;
  const heldCount = (reason: string) =>
    heldRows.find((r) => r.reason === reason)?._count._all ?? 0;
  const heldTotal = heldRows.reduce((sum, r) => sum + r._count._all, 0);
  const riskTypeRows = await prisma.riskEvent.groupBy({
    by: ["riskType"],
    where: { organizationId, occurredAt: { gte: since30 }, riskType: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { riskType: "desc" } },
    take: 5,
  });

  const [ai, topics, score, occupancy, connection] = await Promise.all([
    getAiOpsReport(organizationId),
    getTopTopics(organizationId, 6),
    getHostPerformanceScore(organizationId),
    getOccupancyByProperty(organizationId),
    getConnectionInfo(organizationId),
  ]);

  const maxTopic = Math.max(1, ...topics.map((t) => t.count));
  // A felt "value delivered" line: how many messages the AI handled and a rough
  // time-saved estimate (~4 dk per message a host would otherwise type). Show
  // minutes until it crosses an hour so small numbers don't round down to
  // "~0 saat" (which reads like nothing happened).
  const autoMessages = ai.aiReplies + ai.welcomes + ai.checkins + ai.checkouts;
  const savedMinutes = autoMessages * 4;
  const savedHours = Math.round(savedMinutes / 60);
  // Overall occupancy ring (this month) — a simple average across units, shown as
  // a donut at the top of the per-property occupancy card.
  const overallOccupancy =
    occupancy.length > 0
      ? Math.round(occupancy.reduce((s, o) => s + o.thisMonthRate, 0) / occupancy.length)
      : 0;

  return (
    <>
      <PageHeader
        title="Raporlar"
        description="AI performansı, şikayet yoğunluğu ve operasyon metrikleri. Her kart kendi dönemini belirtir (AI etkinliği son 30 gün, doluluk bu ay)."
      />

      {!connection.connected ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Airbnb / Booking bağlantısı kurulunca bu raporlar misafir mesajları ve rezervasyonlarla
          otomatik dolar.
        </p>
      ) : null}

      {/* AI & automation activity */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="AI Cevapları" value={ai.aiReplies} icon={Sparkles} />
        <StatCard label="Karşılama" value={ai.welcomes} icon={MessageSquare} />
        <StatCard label="Giriş Bilgileri" value={ai.checkins} icon={LogIn} />
        <StatCard label="Çıkış Mesajları" value={ai.checkouts} icon={LogOut} />
      </div>
      {autoMessages > 0 ? (
        <p className="text-sm text-muted-foreground">
          Son 30 günde Lixus AI <strong className="text-foreground">{autoMessages}</strong> mesajı sizin yerinize
          yanıtladı
          {savedMinutes >= 60 ? (
            <> — tahminen <strong className="text-foreground">~{savedHours} saat</strong> kazandırdı.</>
          ) : (
            <> — tahminen <strong className="text-foreground">~{savedMinutes} dakika</strong> kazandırdı.</>
          )}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Host performance + response time */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-muted-foreground" /> Performans Skoru
            </CardTitle>
            {score.hasData ? <Badge tone="success">{score.grade}</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {score.hasData ? (
              <>
                <p className="text-3xl font-semibold">{score.score}/100</p>
                <p className="text-sm text-muted-foreground">{score.label}</p>
                <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
                  {score.breakdown.responseRate !== null ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Yanıt oranı (24 saat içinde)</span>
                      <span className="font-medium">%{score.breakdown.responseRate}</span>
                    </div>
                  ) : null}
                  {score.breakdown.taskCompletionRate !== null ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Görev tamamlama</span>
                      <span className="font-medium">%{score.breakdown.taskCompletionRate}</span>
                    </div>
                  ) : null}
                  {score.breakdown.occupancyRate !== null ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Doluluk (bugün)</span>
                      <span className="font-medium">%{score.breakdown.occupancyRate}</span>
                    </div>
                  ) : null}
                  {score.breakdown.complaintRate !== null ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Şikayet oranı</span>
                      <span className="font-medium">%{score.breakdown.complaintRate}</span>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <EmptyState
                title="Skor için yeterli veri yok"
                description="Misafir mesajlarına yanıt verip görevleri tamamladıkça otomatik hesaplanır."
                className="py-6"
              />
            )}
          </CardContent>
        </Card>

        {/* Top guest topics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" /> En Çok Sorulanlar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topics.length === 0 ? (
              <EmptyState title="Henüz veri yok" className="py-6" />
            ) : (
              topics.map((t) => (
                <div key={t.intent} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{INTENT_LABEL[t.intent] ?? t.intent}</span>
                    <span className="text-muted-foreground">{t.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60"
                      style={{ width: `${(t.count / maxTopic) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Complaints by property */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-muted-foreground" /> Açık Şikayetler (daireye göre)
            </CardTitle>
            <Badge tone={ai.openProblems > 0 ? "destructive" : "muted"}>{ai.openProblems}</Badge>
          </CardHeader>
          <CardContent>
            {ai.problemsByProperty.length === 0 ? (
              <EmptyState title="Açık şikayet yok" className="py-6" />
            ) : (
              // One bordered container with row dividers — per-row borders made
              // a box-in-box grid that read heavy/noisy.
              <div className="divide-y divide-border rounded-lg border border-border">
                {ai.problemsByProperty.map((p) => (
                  <div key={p.propertyName} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-medium">{p.propertyName}</span>
                    <Badge tone="destructive">{p.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI risk visibility (Faz-A): what the AI held back and why, last 30 days */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-muted-foreground" /> AI Risk Görünümü (son 30 gün)
            </CardTitle>
            <Badge tone={heldTotal > 0 ? "secondary" : "muted"}>{heldTotal} size bırakıldı</Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {heldTotal === 0 && riskRows.length === 0 ? (
              <EmptyState title="Son 30 günde riskli mesaj yok" className="py-6" />
            ) : (
              <>
                {/* Single container + dividers (not five bordered boxes) — calmer, shorter. */}
                <div className="divide-y divide-border rounded-lg border border-border">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span>Yüksek riskli mesaj</span>
                    <Badge tone={riskCount("high") > 0 ? "destructive" : "muted"}>{riskCount("high")}</Badge>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span>Orta riskli mesaj</span>
                    <Badge tone={riskCount("medium") > 0 ? "secondary" : "muted"}>{riskCount("medium")}</Badge>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span>Şikayet — size bırakıldı</span>
                    <Badge tone="muted">{heldCount("keyword_escalated") + heldCount("escalated_to_human")}</Badge>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span>Düşük güven — onay bekledi</span>
                    <Badge tone="muted">{heldCount("low_confidence_or_risky")}</Badge>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span>Size bırakılanlardan yanıtladığınız</span>
                    <Badge tone={heldResolved > 0 ? "success" : "muted"}>{heldResolved}</Badge>
                  </div>
                </div>
                {riskTypeRows.length > 0 ? (
                  <div className="space-y-1 border-t border-border pt-2">
                    <p className="text-xs font-medium text-muted-foreground">En sık risk türleri</p>
                    {riskTypeRows.map((row) => (
                      <div key={row.riskType} className="flex items-center justify-between text-xs">
                        <span>{riskTypeLabel(row.riskType) ?? row.riskType}</span>
                        <span className="font-medium">{row._count._all}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <p className="pt-1 text-xs text-muted-foreground">
                  Riskli/şikayet içeren mesajlar otomatik cevaplanmaz — burada AI&apos;ın neyi size
                  bıraktığını ve neyin çözüldüğünü görürsünüz. Sayım olay bazlıdır ve kayıt
                  özelliğinin açıldığı andan itibaren birikir; daha eski dönem gösterilmez.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Occupancy by property — full-width row: the donut + per-property bars
            need the space, and an odd card count otherwise leaves an empty cell. */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BedDouble className="size-4 text-muted-foreground" /> Doluluk (daireye göre)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {occupancy.length === 0 ? (
              <EmptyState title="Henüz veri yok" className="py-6" />
            ) : (
              <>
                {/* Overall occupancy donut (this month, averaged across units) */}
                <div className="flex items-center justify-center gap-4 border-b border-border pb-4">
                  <div
                    className="grid size-24 shrink-0 place-items-center rounded-full"
                    style={{
                      background: `conic-gradient(hsl(var(--primary)) ${overallOccupancy * 3.6}deg, hsl(var(--muted)) ${overallOccupancy * 3.6}deg)`,
                    }}
                  >
                    <div className="grid size-[68px] place-items-center rounded-full bg-card text-center">
                      <div>
                        <div className="text-xl font-bold leading-none">%{overallOccupancy}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">ortalama</div>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">Bu ay ortalama doluluk</p>
                    <p className="text-muted-foreground">{occupancy.length} daire</p>
                  </div>
                </div>
                {occupancy.map((o) => (
                  <div key={o.propertyId} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{o.propertyName}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-muted-foreground">%{o.thisMonthRate}</span>
                        {o.delta !== 0 ? (
                          <span
                            className="group relative inline-flex"
                            title="Geçen ayın aynı günlerine göre değişim — ayın 1'inden bugüne kadarki doluluk, geçen ayın aynı tarih aralığıyla karşılaştırılır."
                          >
                            <Badge tone={o.delta > 0 ? "success" : "muted"} className="cursor-help">
                              {o.delta > 0 ? "+" : ""}
                              {o.delta}
                            </Badge>
                            <span className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 hidden w-56 rounded-md bg-foreground px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-background shadow-lg group-hover:block">
                              Geçen ayın <strong>aynı günlerine</strong> göre değişim — ayın
                              1&apos;inden bugüne kadarki doluluk, geçen ayın aynı tarih aralığıyla
                              karşılaştırılır.
                            </span>
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60"
                        style={{ width: `${Math.min(100, Math.max(0, o.thisMonthRate))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
