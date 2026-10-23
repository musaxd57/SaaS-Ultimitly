import {
  LayoutDashboard,
  MessageSquare,
  QrCode,
  Send,
  ListChecks,
  PackageOpen,
  CalendarDays,
  CalendarX2,
  Building2,
  BookOpen,
  FileText,
  BarChart3,
  Settings,
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
  { href: "/guest-chats", label: "Misafir Sohbetleri", icon: QrCode },
  { href: "/sent", label: "Gönderilenler", icon: Send },
  { href: "/tasks", label: "Görevler", icon: ListChecks },
  { href: "/hazirlik", label: "Hazırlık", icon: PackageOpen },
  { href: "/calendar", label: "Takvim", icon: CalendarDays },
  { href: "/cancellations", label: "İptaller", icon: CalendarX2 },
  { href: "/properties", label: "Mülkler", icon: Building2 },
  { href: "/knowledge", label: "Bilgi Tabanı", icon: BookOpen },
  { href: "/templates", label: "Şablonlar", icon: FileText },
  { href: "/reports", label: "Raporlar", icon: BarChart3 },
  { href: "/settings", label: "Ayarlar", icon: Settings },
];

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((i) => pathname.startsWith(i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? "Lixus AI";
}
