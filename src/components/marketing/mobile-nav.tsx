"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "#nasil", label: "Nasıl çalışır" },
  { href: "#ozellikler", label: "Özellikler" },
  { href: "#fiyatlar", label: "Fiyatlar" },
  { href: "#sss", label: "SSS" },
];

/** Mobile-only hamburger menu: the anchor nav + login link, which are hidden on
 *  small screens in the desktop header. Closes on link tap or Escape. */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
        aria-expanded={open}
        className="inline-flex size-10 items-center justify-center rounded-lg border border-border bg-card text-foreground"
      >
        {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-16 z-30 cursor-default bg-black/20"
          />
          <nav className="absolute inset-x-0 top-16 z-40 border-b border-border bg-background p-3 shadow-lg">
            <div className="mx-auto flex max-w-6xl flex-col gap-1">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
                >
                  {l.label}
                </a>
              ))}
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent"
              >
                Giriş Yap
              </Link>
            </div>
          </nav>
        </>
      ) : null}
    </div>
  );
}
