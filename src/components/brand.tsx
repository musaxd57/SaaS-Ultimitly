import { Hotel } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Hotel className="size-4.5" />
      </div>
      {!iconOnly ? (
        <span className="text-base font-semibold tracking-tight text-foreground">
          GuestOps <span className="text-primary">AI</span>
        </span>
      ) : null}
    </div>
  );
}
