import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BrandMark className="size-5" />
            </span>
            <span className="text-base font-semibold tracking-tight">
              Lixus <span className="text-primary">AI</span>
            </span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Ana sayfa
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">{children}</main>
      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} Lixus AI</span>
          {/* Dokunma alanı 28 px (yazı 16 px'ti, 10-22): dikey dolgu + eşit eksi pay, yerleşim aynı; sarınca satır arası 16 px > 2×6 px. */}
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/gizlilik" className="-my-1.5 py-1.5 hover:text-foreground">Gizlilik</Link>
            <Link href="/kosullar" className="-my-1.5 py-1.5 hover:text-foreground">Kullanım Koşulları</Link>
            <Link href="/on-bilgilendirme" className="-my-1.5 py-1.5 hover:text-foreground">Ön Bilgilendirme</Link>
            <Link href="/mesafeli-satis" className="-my-1.5 py-1.5 hover:text-foreground">Mesafeli Satış</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
