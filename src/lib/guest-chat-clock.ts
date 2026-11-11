import { orgTimezone } from "@/lib/timezone";

/**
 * Misafirin QR sohbetinde mesajın yanındaki saat ("07:29"): İŞLETMENİN saat diliminde, 24 saat biçiminde. Misafir dairededir; saat sunucuda
 * kurulur (tarayıcı saat dilimine güvenilmez, sunucu / istemci çizimi ayrışmaz). Geçersiz tarih ya da dilim → boş metin (saat çizilmez).
 */
export function guestChatClock(at: Date, timeZone: string | null | undefined): string {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: orgTimezone(timeZone), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  } catch {
    return "";
  }
}
