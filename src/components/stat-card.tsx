import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: string;
  tone?: "default" | "warning" | "destructive" | "success";
  className?: string;
  /** When set, the whole card becomes a link to this route (with a hover cue). */
  href?: string;
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-amber-700",
  destructive: "bg-destructive/12 text-destructive",
  success: "bg-success/12 text-success",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  className,
  href,
}: StatCardProps) {
  const card = (
    <Card className={cn("p-5", href && "transition-colors hover:bg-accent/40", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-lg",
              toneClasses[tone],
            )}
          >
            <Icon className="size-5" />
          </div>
        ) : null}
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}
