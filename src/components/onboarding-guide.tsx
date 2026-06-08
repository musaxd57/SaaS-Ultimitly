import Link from "next/link";
import { CheckCircle2, ArrowRight, Rocket, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface OnboardingStep {
  done: boolean;
  title: string;
  desc: string;
  href: string;
  cta: string;
  icon: LucideIcon;
}

/**
 * "Başlarken" checklist shown on the dashboard until the account is set up.
 * Guides a new customer through connect → properties → AI voice → inbox, so they
 * progress through the panels quickly. Disappears once every step is done.
 */
export function OnboardingGuide({ steps }: { steps: OnboardingStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  // The first not-yet-done step is the one we nudge them toward next.
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <Card className="border-primary/30 bg-accent/30">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Rocket className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Başlarken — kurulumun {doneCount}/{steps.length} tamam</p>
            <p className="text-xs text-muted-foreground">
              Birkaç adımda Lixus AI misafirlerinize yanıt vermeye başlasın.
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => {
            const isNext = i === nextIndex;
            return (
              <li
                key={s.title}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                  s.done
                    ? "border-border bg-card/50"
                    : isNext
                      ? "border-primary/40 bg-card"
                      : "border-border bg-card/50",
                )}
              >
                <span className="shrink-0">
                  {s.done ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : (
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                        isNext ? "border-primary text-primary" : "border-muted-foreground/40 text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through")}>
                    {s.title}
                  </p>
                  {!s.done ? <p className="text-xs text-muted-foreground">{s.desc}</p> : null}
                </div>
                {!s.done ? (
                  <Link
                    href={s.href}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      isNext
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border border-border hover:bg-accent",
                    )}
                  >
                    {s.cta} <ArrowRight className="size-3.5" />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
