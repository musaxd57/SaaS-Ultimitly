"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in the console for debugging; no sensitive data shown.
    console.error("App error:", error?.digest ?? error?.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BrandMark className="size-6" />
        </span>
        <span className="text-lg font-semibold tracking-tight">
          Lixus <span className="text-primary">AI</span>
        </span>
      </Link>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Bir şeyler ters gitti</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Beklenmedik bir hata oluştu. Tekrar deneyebilir ya da ana sayfaya dönebilirsiniz.
          Sorun sürerse ekibimize bildirin.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCw className="size-4" /> Tekrar dene
        </Button>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Ana sayfa
        </Link>
      </div>
    </div>
  );
}
