"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight, Rocket, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface OnboardingStep {
  done: boolean;
  title: string;
  desc: string;
  href: string;
  cta: string;
}

// Per-browser "I've seen it, stop showing me" flag. Kept in localStorage so the
// dismissal needs no schema change / API call — it cannot affect the working
// product, and the server still hides the card outright once every step is done.
const DISMISS_KEY = "lixus_onboarding_dismissed";

/**
 * "Başlarken" checklist shown on the dashboard until the account is set up.
 * Guides a new customer through connect → properties → AI voice → inbox, so they
 * progress through the panels quickly. Disappears once every step is done, or
 * when the host dismisses it with the × button.
 */
export function OnboardingGuide({ steps }: { steps: OnboardingStep[] }) {
  // Start shown on both server and first client render (no hydration mismatch);
  // hide after mount if the host previously dismissed it.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      // localStorage can throw in private mode — fall back to showing the card.
    }
  }, []);

  if (dismissed) return null;

  const doneCount = steps.filter((s) => s.done).length;
  // The first not-yet-done step is the one we nudge them toward next.
  const nextIndex = steps.findIndex((s) => !s.done);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore — worst case the card reappears on next load.
    }
    setDismissed(true);
  };

  return (
    <Card className="border-primary/30 bg-accent/30">
      <CardContent className="relative p-5">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Kurulum rehberini gizle"
          title="Gizle"
          className="absolute right-2.5 top-2.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-3 pr-8">
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
