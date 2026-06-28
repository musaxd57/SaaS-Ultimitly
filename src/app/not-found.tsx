import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
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
        <p className="text-5xl font-bold tracking-tight text-primary">404</p>
        <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.
        </p>
      </div>
      <Link href="/" className={cn(buttonVariants())}>
        <ArrowLeft className="size-4" /> Ana sayfaya dön
      </Link>
    </div>
  );
}
