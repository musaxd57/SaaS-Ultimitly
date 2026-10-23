import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "./button";
import { cn } from "@/lib/utils";

type LinkButtonProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof buttonVariants>;

/** A Next.js Link styled as a button (avoids nesting <a> inside <button>). */
export function LinkButton({ className, variant, size, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
