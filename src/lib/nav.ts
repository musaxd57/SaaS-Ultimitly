import {
  LayoutDashboard,
  MessageSquare,
  CalendarDays,
  CalendarRange,
  ListChecks,
  Building2,
  BookOpen,
  BarChart3,
  FileText,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/inbox", label: "Mesajlar", icon: MessageSquare },
  { href: "/reservations", label: "Rezervasyonlar", icon: CalendarDays },
  { href: "/calendar", label: "Takvim", icon: CalendarRange },
  { href: "/tasks", label: "Görevler", icon: ListChecks },
  { href: "/properties", label: "Mülkler", icon: Building2 },
  { href: "/knowledge", label: "Bilgi Tabanı", icon: BookOpen },
  { href: "/templates", label: "Şablonlar", icon: FileText },
  { href: "/reports", label: "Raporlar", icon: BarChart3 },
];

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((i) => pathname.startsWith(i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? "GuestOps AI";
}
