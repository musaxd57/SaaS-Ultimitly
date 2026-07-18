"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut, Loader2, Shield, ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { NAV_ITEMS, titleForPath } from "@/lib/nav";
import { USER_ROLE, type UserRole } from "@/lib/constants";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AppShellProps {
  user: { name: string; email: string; role: UserRole; orgName: string };
  superAdmin?: boolean;
  guestChatEnabled?: boolean;
  impersonating?: { actorName: string; orgName: string } | null;
  // Subscription summary shown in the sidebar user card; clicking it opens billing.
  // Undefined → the card is not a link and shows no plan (e.g. non-owner roles).
  plan?: { label: string; href: string };
  children: React.ReactNode;
}

export function AppShell({ user, superAdmin, guestChatEnabled, impersonating, plan, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [exiting, setExiting] = useState(false);

  async function exitImpersonation() {
    setExiting(true);
    try {
      await fetch("/api/admin/exit", { method: "POST" });
      router.push("/admin");
      router.refresh();
    } catch {
      // Network reject — let the operator retry instead of a stuck spinner.
      setExiting(false);
    }
  }

  // Close the mobile sidebar with Escape (accessibility).
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      // Network reject — reset so the user can retry (session stays until cleared).
      setLoggingOut(false);
    }
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Staff (cleaning crew) only get the Tasks tab — every other page is
  // owner/manager-only (middleware redirects them away; this hides the links).
  const isStaff = user.role === "staff";
  const navItems = NAV_ITEMS.filter((i) => {
    if (isStaff) return i.href === "/tasks";
    // The QR "Misafir Sohbetleri" tab only shows when the feature is enabled.
    if (i.href === "/guest-chats") return Boolean(guestChatEnabled);
    return true;
  });

  const navLinks = (
    <nav className="flex flex-col gap-1">
      {navItems.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            isActive(href)
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Icon className="size-4.5 shrink-0" />
          {label}
        </Link>
      ))}
    </nav>
  );

  // Card body reused whether or not the card is a billing link.
  const userCardInner = (
    <>
      <div className="flex items-center gap-2">
        <Avatar name={user.name} className="size-8" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{USER_ROLE.label(user.role)}</p>
        </div>
      </div>
      {plan ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
          <span className="text-xs text-muted-foreground">Abonelik</span>
          <span className="truncate text-xs font-semibold text-foreground">{plan.label}</span>
        </div>
      ) : null}
    </>
  );

  const sidebarBody = (
    // Fixed logo (top) + a SINGLE scrolling nav area + a user card PINNED to the
    // bottom. The nav owns the overflow (min-h-0 lets the flex child shrink so it
    // actually scrolls), so on any viewport height the card sits at the very
    // bottom — it never floats up into the middle.
    <div className="flex h-full flex-col p-4">
      <div className="flex shrink-0 items-center justify-between px-1">
        <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BrandMark className="size-5" />
          </div>
          <span className="text-base font-semibold tracking-tight">
            Lixus <span className="text-primary">AI</span>
          </span>
        </Link>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Menüyü kapat"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {navLinks}
        {superAdmin ? (
          <Link
            href="/admin"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive("/admin")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Shield className="size-4.5 shrink-0" />
            Operatör Paneli
          </Link>
        ) : null}
      </div>

      {plan ? (
        <Link
          href={plan.href}
          onClick={() => setMobileOpen(false)}
          className="mt-4 block shrink-0 rounded-lg border border-border bg-muted/40 p-3 transition-colors hover:bg-muted/70"
        >
          {userCardInner}
        </Link>
      ) : (
        <div className="mt-4 shrink-0 rounded-lg border border-border bg-muted/40 p-3">{userCardInner}</div>
      )}
    </div>
  );

  return (
    // zoom: .95 — the panel's global visual scale. The user compared pages at
    // browser zoom 90-95% vs 100% and picked ~95 for EVERY panel page ("öküz
    // gibi yayılmasın"): same layout, everything ~5% smaller, like a built-in
    // Ctrl-minus. CSS zoom scales layout correctly (unlike transform) and is
    // supported everywhere modern; older Firefox ignores it → falls back to 100%.
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]" style={{ zoom: 0.95 }}>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen border-r border-border bg-card lg:block">
        {sidebarBody}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-border bg-card shadow-xl">
            {sidebarBody}
          </aside>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-h-screen flex-col">
        {impersonating ? (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 sm:px-6">
            <span>
              <strong>{impersonating.orgName}</strong> hesabındasın (operatör: {impersonating.actorName}).
              Yaptığın her şey bu müşteriyi etkiler.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-700 bg-amber-100 hover:bg-amber-200"
              onClick={exitImpersonation}
              disabled={exiting}
            >
              {exiting ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeft className="size-4" />}
              Kendi hesabıma dön
            </Button>
          </div>
        ) : null}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Menüyü aç"
            >
              <Menu className="size-5" />
            </button>
            <h1 className="text-sm font-semibold sm:text-base">{titleForPath(pathname)}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.orgName}</span>
            <Button variant="ghost" size="sm" onClick={logout} disabled={loggingOut}>
              {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              <span className="hidden sm:inline">Çıkış</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {/* Settings uses the two-column (side-nav + content) layout, so it gets a
              wider container; every other page stays at the reading-width cap. */}
          <div
            className={cn(
              "mx-auto w-full space-y-6",
              pathname.startsWith("/settings") ? "max-w-7xl" : "max-w-6xl",
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
