import * as React from "react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
}

/** Minimal initials avatar (no image support needed for MVP). */
const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ name, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex size-9 shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary",
        className,
      )}
      {...props}
    >
      {initials(name) || "?"}
    </div>
  ),
);
Avatar.displayName = "Avatar";

export { Avatar };
