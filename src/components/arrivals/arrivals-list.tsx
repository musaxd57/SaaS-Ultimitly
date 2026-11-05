import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OVERALL_LABEL, type Factor, type Overall } from "@/lib/readiness-list/evaluate";

// ---------------------------------------------------------------------------
// "Girişler" listesinin görünümü (salt-okuma, sunucu bileşeni — istemci durumu yok). Satır başına bir konaklama: genel durum +
// faktörler (durum cümlesi + eksik kalan şart). Bilinmeyen gri, engel kırmızı, temizlik hazır yeşil; v1'de "HAZIR" etiketi yok (H-2).
// ---------------------------------------------------------------------------

export interface ArrivalsListRow {
  reservationId: string;
  propertyId: string;
  propertyName: string;
  guestName: string | null;
  dayKey: string;
  dayLabel: string;
  checkInTime: string | null;
  conversationId: string | null;
  overall: Overall;
  factors: Factor[];
}

const OVERALL_TONE: Record<Overall, "destructive" | "muted" | "success"> = {
  not_ready: "destructive",
  unknown: "muted",
  cleaning_ready: "success",
};

const DOT: Record<Factor["state"], string> = {
  blocking: "bg-red-500",
  unknown: "bg-slate-400",
  ok: "bg-emerald-500",
  info: "bg-sky-500",
};

function FactorLine({ f }: { f: Factor }) {
  return (
    <li className="flex gap-2 text-sm" data-state={f.state}>
      <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[f.state])} />
      <span className="min-w-0">
        <span className="text-foreground">{f.label}</span>
        {f.missing && (f.state === "blocking" || f.state === "unknown") ? <span className="text-muted-foreground"> — eksik: {f.missing}</span> : null}
      </span>
    </li>
  );
}

/** Hep görünenler: engeller + bilinmeyenler; hiçbiri yoksa temizlik satırı (durum ve kim). Sıra korunur. */
function primaryOf(factors: Factor[]): { f: Factor; i: number }[] {
  const indexed = factors.map((f, i) => ({ f, i }));
  const urgent = indexed.filter(({ f }) => f.state === "blocking" || f.state === "unknown");
  return urgent.length > 0 ? urgent : indexed.filter(({ f }) => f.key === "cleaning");
}

/** Açılır "Ayrıntılar": geri kalan (bilgi / tamam) satırlar. */
function restOf(factors: Factor[]): { f: Factor; i: number }[] {
  const shown = new Set(primaryOf(factors).map(({ i }) => i));
  return factors.map((f, i) => ({ f, i })).filter(({ i }) => !shown.has(i));
}

export function ArrivalsList({ rows, truncated }: { rows: ArrivalsListRow[]; truncated: number }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Bugün ve sonraki iki günde giriş yok.</CardContent>
      </Card>
    );
  }
  const days: { key: string; label: string; rows: ArrivalsListRow[] }[] = [];
  for (const r of rows) {
    const last = days.at(-1);
    if (last && last.key === r.dayKey) last.rows.push(r);
    else days.push({ key: r.dayKey, label: r.dayLabel, rows: [r] });
  }
  return (
    <div className="space-y-6">
      {days.map((d) => (
        <section key={d.key} className="space-y-3" aria-label={d.label}>
          <h2 className="text-sm font-semibold text-muted-foreground">{d.label}</h2>
          {d.rows.map((r) => (
            <Card key={r.reservationId} data-testid="arrival-row" data-overall={r.overall}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">
                      {r.propertyName}
                      {r.checkInTime ? <span className="font-normal text-muted-foreground"> · giriş {r.checkInTime}</span> : null}
                    </div>
                    {r.guestName ? <div className="truncate text-sm text-muted-foreground">{r.guestName}</div> : null}
                  </div>
                  <Badge tone={OVERALL_TONE[r.overall]}>{OVERALL_LABEL[r.overall]}</Badge>
                </div>
                {/* Codex 11-05 (görsel inceleme): önce ne eksik — engeller ve bilinmeyenler hep görünür; bilgi satırları açılır "Ayrıntılar"da. */}
                <ul className="space-y-1.5">
                  {primaryOf(r.factors).map(({ f, i }) => (
                    <FactorLine key={`${f.key}-${i}`} f={f} />
                  ))}
                </ul>
                {restOf(r.factors).length > 0 ? (
                  <details className="group">
                    <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                      Ayrıntılar ({restOf(r.factors).length})
                    </summary>
                    <ul className="mt-1.5 space-y-1.5">
                      {restOf(r.factors).map(({ f, i }) => (
                        <FactorLine key={`${f.key}-${i}`} f={f} />
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="flex flex-wrap gap-3 text-sm">
                  {r.conversationId ? (
                    <Link href={`/inbox/${r.conversationId}`} className="text-primary hover:underline">
                      Konuşma
                    </Link>
                  ) : null}
                  <Link href={`/properties/${r.propertyId}`} className="text-primary hover:underline">
                    Mülk
                  </Link>
                  {/* Bu dairenin görevleri (satırdaki görev dayanakları orada açılır). */}
                  <Link href={`/tasks?propertyId=${encodeURIComponent(r.propertyId)}`} className="text-primary hover:underline">
                    Görevler
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
      {truncated > 0 ? (
        <p className="text-sm text-muted-foreground">Ayrıca {truncated} giriş daha var; liste ilk {rows.length} girişi gösteriyor.</p>
      ) : null}
    </div>
  );
}
