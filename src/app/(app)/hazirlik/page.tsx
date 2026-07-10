import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { getPrepPlan, type PrepPlanItem } from "@/lib/supply";
import { formatDayInTz } from "@/lib/utils";
import { PackageOpen, ShoppingCart, WashingMachine } from "lucide-react";

export const dynamic = "force-dynamic";

const RANGES = [
  { days: 1, label: "Bugün" },
  { days: 7, label: "7 gün" },
  { days: 14, label: "14 gün" },
];

function ItemList({ items }: { items: PrepPlanItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-3 text-sm">
          <span>{it.label}</span>
          <span className="font-semibold tabular-nums">
            {it.qty} <span className="text-xs font-normal text-muted-foreground">{it.unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function HazirlikPage({
  searchParams,
}: {
  searchParams: Promise<{ gun?: string }>;
}) {
  const session = await requireAuth();
  const sp = await searchParams;
  const days = [1, 7, 14].includes(Number(sp.gun)) ? Number(sp.gun) : 7;

  const plan = await getPrepPlan(session.organizationId, { days });
  const hasNeeds = plan.linen.length > 0 || plan.consumables.length > 0;
  const rangeLabel =
    days === 1
      ? formatDayInTz(plan.start)
      : `${formatDayInTz(plan.start)} – ${formatDayInTz(new Date(plan.end.getTime() - 1))}`;

  return (
    <>
      <PageHeader
        title="Hazırlık & Alışveriş"
        description="Yaklaşan girişlere göre çamaşır ve malzeme ihtiyacınız — rezervasyonlarınızdan otomatik hesaplanır."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <LinkButton
            key={r.days}
            href={`/hazirlik?gun=${r.days}`}
            variant={r.days === days ? "default" : "outline"}
            size="sm"
          >
            {r.label}
          </LinkButton>
        ))}
        <span className="ml-1 text-sm text-muted-foreground">
          {rangeLabel} · {plan.totalArrivals} giriş
        </span>
      </div>

      {!hasNeeds ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {plan.totalArrivals === 0 ? (
              <>Bu aralıkta giriş yok — hazırlık gerekmiyor.</>
            ) : plan.missingProfile.length > 0 ? (
              <>
                Bu aralıkta {plan.totalArrivals} giriş var ama malzeme profili tanımlı değil.
                <br />
                <span className="text-foreground">
                  Mülkler → daire → “Malzeme Profili”nden giriş başına adetleri girin, liste burada oluşsun.
                </span>
              </>
            ) : (
              <>Hesaplanacak bir ihtiyaç bulunamadı.</>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {plan.consumables.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShoppingCart className="size-4 text-muted-foreground" /> Alınacaklar (sarf)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ItemList items={plan.consumables} />
                </CardContent>
              </Card>
            ) : null}

            {plan.linen.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <WashingMachine className="size-4 text-muted-foreground" /> Hazırlanacak (çamaşır/tekstil)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ItemList items={plan.linen} />
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageOpen className="size-4 text-muted-foreground" /> Daire Bazında
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {plan.perProperty.map((p) => (
                <div key={p.propertyId} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <p className="mb-1.5 text-sm font-medium">
                    {p.propertyName}{" "}
                    <span className="text-xs font-normal text-muted-foreground">· {p.arrivals} giriş</span>
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {p.items.map((it) => (
                      <span key={it.key}>
                        {it.label}: <span className="font-medium text-foreground tabular-nums">{it.qty}</span> {it.unit}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {plan.missingProfile.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Profili tanımlı olmayan (bu yüzden sayılmayan) daireler: {plan.missingProfile.join(", ")}. Mülkler →
              daire → “Malzeme Profili”nden ekleyin.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
