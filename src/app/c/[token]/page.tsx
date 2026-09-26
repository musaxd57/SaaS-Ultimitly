import type { Metadata } from "next";
import { resolveGuestChat } from "@/lib/guest-chat";
import { GuestChat } from "@/components/guest-chat/guest-chat";
import { GuestNotice } from "@/components/guest-chat/guest-notice";

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
  const ctx = process.env.GUEST_CHAT_ENABLED === "1" ? await resolveGuestChat(token) : null;

  // 🚨 BEŞ KOŞUL, TEK METİN (numaralandırma koruması — hangi sebep olduğu
  // SÖYLENMEZ): global anahtar kapalı · token bilinmiyor · mülk silinmiş ·
  // QR panelden kapatılmış · abonelik bitmiş.
  if (!ctx) {
    return (
      <GuestNotice
        title="Bu sohbet şu anda kullanılamıyor"
        body="Karekod artık geçerli değil ya da sohbet kapatılmış olabilir."
        hint="Yardıma ihtiyacınız varsa lütfen ev sahibinizle iletişime geçin — rezervasyonunuzu yaptığınız uygulamanın mesaj bölümünden ulaşabilirsiniz."
      />
    );
  }

  // Closed outside an active stay (vacant / before check-in / after checkout).
  if (!ctx.open) {
    return (
      <GuestNotice
        title="Şu an aktif bir konaklama görünmüyor"
        body="Sohbet yalnızca konaklamanız sürerken açıktır."
        hint="Bir rezervasyonunuz varsa giriş gününüzde bu karekodu tekrar okutarak buraya ulaşabilirsiniz."
      />
    );
  }

  return <GuestChat token={token} />;
}
