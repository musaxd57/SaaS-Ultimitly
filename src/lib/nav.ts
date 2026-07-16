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

export interface NavGroup {
  /** Section heading shown in the sidebar; null = ungrouped top item (Panel). */
  label: string | null;
  items: NavItem[];
}

// 13 flat entries overwhelmed a first-time customer (Codex audit) — grouped by
// how a host actually works: the daily loop, guest-facing content, then admin.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Panel", icon: LayoutDashboard }],
  },
  {
    label: "Günlük Operasyon",
    items: [
      { href: "/inbox", label: "Mesajlar", icon: MessageSquare },
      { href: "/tasks", label: "Görevler", icon: ListChecks },
      { href: "/hazirlik", label: "Hazırlık", icon: PackageOpen },
      { href: "/calendar", label: "Takvim", icon: CalendarDays },
    ],
  },
  {
    label: "Misafir & İçerik",
    items: [
      { href: "/guest-chats", label: "Misafir Sohbetleri", icon: QrCode },
      { href: "/knowledge", label: "Bilgi Tabanı", icon: BookOpen },
      { href: "/templates", label: "Şablonlar", icon: FileText },
    ],
  },
  {
    label: "Yönetim",
    items: [
      { href: "/properties", label: "Mülkler", icon: Building2 },
      { href: "/sent", label: "Gönderilenler", icon: Send },
      { href: "/cancellations", label: "İptaller", icon: CalendarX2 },
      { href: "/reports", label: "Raporlar", icon: BarChart3 },
      { href: "/settings", label: "Ayarlar", icon: Settings },
    ],
  },
];

// Flat view — kept for titleForPath and anything that needs "all routes".
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((i) => pathname.startsWith(i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? "Lixus AI";
}
