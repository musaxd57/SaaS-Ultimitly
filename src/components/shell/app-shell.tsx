"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Hotel, Menu, X, LogOut, Loader2, Shield, ArrowLeft } from "lucide-react";
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
  children: React.ReactNode;
}

export function AppShell({ user, superAdmin, guestChatEnabled, impersonating, children }: AppShellProps) {
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

  // The QR "Misafir Sohbetleri" tab only makes sense when the feature is enabled
  // for this deployment, and never for staff (whose page redirects them away).
  const navItems = NAV_ITEMS.filter((i) =>
    i.href === "/guest-chats" ? Boolean(guestChatEnabled) && user.role !== "staff" : true,
  );

  const navLinks = (
    <nav className="flex flex-1 flex-col gap-1">
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

  const sidebarBody = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between px-1">
        <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Hotel className="size-4.5" />
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
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex items-center gap-2">
          <Avatar name={user.name} className="size-8" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{USER_ROLE.label(user.role)}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
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
          <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
