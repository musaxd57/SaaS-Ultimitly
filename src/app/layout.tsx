import { appCanonicalOrigin } from "@/lib/app-config";
import { themeBootScript } from "@/lib/theme";
import { ThemeScope } from "@/components/theme-scope";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/toaster";
import { ConfirmHost } from "@/components/confirm-host";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

const DESCRIPTION =
  "Airbnb ve Booking misafir mesajlarını 7/24, güvenle yanıtlayan yapay zekâ. Misafiriniz hangi dilde yazarsa o dilde cevap alır; şikayet ve iade gibi riskli konuları otomatik yanıtlamaz, size bırakır. Temizlik ve check-in görevleri otomatik, tüm operasyon tek panelde.";

export const metadata: Metadata = {
  metadataBase: new URL(appCanonicalOrigin()),
  title: {
    default: "Lixus AI — Airbnb & Booking için AI Misafir Asistanı",
    template: "%s · Lixus AI",
  },
  description: DESCRIPTION,
  applicationName: "Lixus AI",
  keywords: [
    "Airbnb asistanı", "yapay zekâ misafir iletişimi", "Booking otomatik yanıt",
    "kısa dönem kiralama yazılımı", "Airbnb otomasyon", "misafir mesaj yönetimi",
    "Lixus AI", "lixusai", "lixus ai", "Lixus AI Türkiye",
  ],
  openGraph: {
    type: "website",
    locale: "tr_TR",
    url: appCanonicalOrigin(),
    siteName: "Lixus AI",
    title: "Lixus AI — Airbnb & Booking için AI Misafir Asistanı",
    description: DESCRIPTION,
  },
  twitter: {
    // A real 1200x630 card exists now (opengraph-image.tsx + twitter-image.tsx),
    // so the large-image card renders correctly (was "summary" while no asset).
    card: "summary_large_image",
    title: "Lixus AI — Airbnb & Booking için AI Misafir Asistanı",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={inter.variable}>
      <head>
        {/* İlk boyamadan ÖNCE koşar → tema flaşı yok. Betik hem TERCİHİ hem
            KAPSAMI kontrol eder: panel dışı bir yola doğrudan girildiğinde
            `dark` sınıfı hiç eklenmez (karanlık mod yalnız panelde geçerli).
            ⚠️ Satır-içi betik: `script-src` bugün enforce edilmiyor. Nonce
            turunu yapan kişi buna nonce vermezse ilk boyamada tema bozulur —
            doğru düzeltme CSP'yi gevşetmek değil, nonce eklemektir. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        {/* Tema kapsamının TEK sorumlusu — her yol değişiminde doğru durumu
            yeniden kurar. Kökte, çünkü panel dışı sayfalar (404, hata sınırı,
            landing) panel ağacının DIŞINDA render oluyor. */}
        <ThemeScope />
        {/* Kökte mount edilir: toast() çağıran bileşen ağaçta nerede olursa
            olsun bir dinleyici HER ZAMAN vardır (aksi halde lib native alert'e
            düşer — sessiz hata yok). */}
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  );
}
