import {
  LayoutDashboard,
  MessageSquare,
  QrCode,
  Send,
  ListChecks,
  PackageOpen,
  CalendarDays,
  CalendarCheck2,
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
  { href: "/arrivals", label: "Girişler", icon: CalendarCheck2 },
  { href: "/hazirlik", label: "Hazırlık", icon: PackageOpen },
  { href: "/calendar", label: "Takvim", icon: CalendarDays },
  { href: "/cancellations", label: "İptaller", icon: CalendarX2 },
  { href: "/properties", label: "Daireler", icon: Building2 },
  { href: "/knowledge", label: "Bilgi Tabanı", icon: BookOpen },
  { href: "/templates", label: "Şablonlar", icon: FileText },
  { href: "/reports", label: "Raporlar", icon: BarChart3 },
  { href: "/settings", label: "Ayarlar", icon: Settings },
];

/**
 * Menüde yeri olmayan ama panelin içinde açılan sayfaların üst çubuk başlığı. Yoksa çubuk "Lixus AI" yazıyordu — telefonda sayfanın
 * hangi bölüm olduğunu söyleyen tek yer orası (FB gezisi 11-20: rezervasyon ayrıntısı ve kayıt karşılaştırma). Ad, sayfanın kendi
 * başlığındaki sözcüktür (yeni terim yok).
 */
const SECONDARY_TITLES: { href: string; label: string }[] = [{ href: "/reservations", label: "Rezervasyon" }];

export function titleForPath(pathname: string): string {
  // Yol PARÇASI eşleşir ("/tasks" → "/tasks", "/tasks/new"; "/tasksx" değil) — önek karşılaştırması "/sent" ile "/sentinel"i karıştırırdı.
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const match = [...NAV_ITEMS, ...SECONDARY_TITLES].filter((i) => under(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Lixus AI";
}
