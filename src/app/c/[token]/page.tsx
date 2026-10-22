import type { Metadata } from "next";
import { resolveGuestChat } from "@/lib/guest-chat";
import { GuestChat } from "@/components/guest-chat/guest-chat";
import { GuestNotice } from "@/components/guest-chat/guest-notice";
import { headers } from "next/headers";
import { isSupportViewCookieHeader } from "@/lib/guest-chat-support-view";
import { GUEST_COPY, guestLocaleFromAcceptLanguage } from "@/components/guest-chat/guest-chat-copy";

export const dynamic = "force-dynamic";

// Public guest concierge page — never indexed.
export const metadata: Metadata = {
  title: "Misafir Yardım",
  robots: { index: false, follow: false },
};

/**
 * The public page a guest reaches by scanning the in-apartment QR. Mirrors the
 * API's two switches: the global GUEST_CHAT_ENABLED kill-switch and the
 * per-apartment chatEnabled flag (via resolveGuestChat).
 *
 * 🚨 ARTIK `notFound()` YOK (kurucu, 09-11). Eskiden beş ayrı koşul ürünün B2B
 * 404'üne düşüyordu ve o sayfanın iki çıkışı da `/` idi — yani dairedeki QR'ı
 * okutan misafir Lixus'un SATIŞ sayfasına iniyordu. Artık markalı, misafire
 * yazılmış bir ekran döner. Ayrıntılı gerekçe: `components/guest-chat/guest-notice.tsx`.
 *
 * ⚠️ Sayfa hâlâ HTTP 200 döndürüyor (Next `notFound()` kullanılmadığı için).
 * Bu bilinçli: bu yüzey `robots: noindex` ile zaten indekslenmiyor ve misafire
 * doğru ekranı göstermek, bir tarayıcıya doğru durum kodunu vermekten önemli.
 */
export default async function GuestChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Ekran dili (kurucu 10-22 U2): tarayıcının dil tercihi — Türkçe ilk tercih değilse İngilizce.
  const locale = guestLocaleFromAcceptLanguage((await headers()).get("accept-language"));
  const t = GUEST_COPY[locale];
  // 🚨 Destek görünümü (bürünmüş operatör) misafir sohbetine GİRMEZ (kurucu kararı 09-30): sohbet açılsaydı konaklama bu cihaza
  // kilitlenir, gerçek misafir dışarıda kalırdı. Karar her şeyden önce — sohbet bileşeni (bağlayan uçlar) hiç yüklenmez.
  if (await isSupportViewCookieHeader((await headers()).get("cookie"))) {
    return (
      <GuestNotice
        title="Destek görünümünde misafir sohbeti açılmaz"
        body="Bu bağlantıyı açmak misafirin sohbetini bu cihaza kilitlerdi."
        hint="Konuşmaları panelde 'QR Misafir Sohbetleri' sayfasından okuyabilirsiniz."
      />
    );
  }
  // Sayfa yalnız "açık mı" bilgisini kullanır → bilgi tabanı çekilmez / taranmaz (#211; sayfa hız sınırsız, her yükleme iki tam sır
  // taraması yapıyordu). Ekran birebir aynı.
  const ctx = process.env.GUEST_CHAT_ENABLED === "1" ? await resolveGuestChat(token, undefined, { knowledgeBase: false }) : null;

  // 🚨 BEŞ KOŞUL, TEK METİN (numaralandırma koruması — hangi sebep olduğu
  // SÖYLENMEZ): global anahtar kapalı · token bilinmiyor · mülk silinmiş ·
  // QR panelden kapatılmış · abonelik bitmiş.
  if (!ctx) {
    return (
      <GuestNotice lang={locale} brand={t.title} title={t.unavailableTitle} body={t.unavailableBody} hint={t.unavailableHint} />
    );
  }

  // Closed outside an active stay (vacant / before check-in / after checkout).
  if (!ctx.open) {
    return (
      <GuestNotice lang={locale} brand={t.title} title={t.inactiveTitle} body={t.inactiveBody} hint={t.inactiveHint} />
    );
  }

  return <GuestChat token={token} locale={locale} />;
}
