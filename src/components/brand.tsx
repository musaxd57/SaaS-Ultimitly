import { cn } from "@/lib/utils";

/**
 * The Lixus AI logo glyph — apartment towers, identical to the favicon
 * (src/app/icon.svg) and the PNG lockup (public/lixus-logo.png). Drawn with
 * `currentColor` strokes so it inherits the surrounding text color and stays
 * crisp at any size + theme (light/dark) — a raster logo could do neither.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="M9 23V11.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V23" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M18 15.5h4a1 1 0 0 1 1 1V23" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7 23h18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M11.5 14h3M11.5 17h3M20.5 18.5h0.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

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
        <BrandMark className="size-5" />
      </div>
      {!iconOnly ? (
        <span className="text-base font-semibold tracking-tight text-foreground">
          Lixus <span className="text-primary">AI</span>
        </span>
      ) : null}
    </div>
  );
}
