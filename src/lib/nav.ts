import {
  LayoutDashboard,
  MessageSquare,
  Send,
  ListChecks,
  Building2,
  BookOpen,
  FileText,
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
  { href: "/sent", label: "Gönderilenler", icon: Send },
  { href: "/tasks", label: "Görevler", icon: ListChecks },
  { href: "/properties", label: "Mülkler", icon: Building2 },
  { href: "/knowledge", label: "Bilgi Tabanı", icon: BookOpen },
  { href: "/templates", label: "Şablonlar", icon: FileText },
  { href: "/settings", label: "Ayarlar", icon: Settings },
];

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((i) => pathname.startsWith(i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? "Lixus AI";
}
