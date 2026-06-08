import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

const DESCRIPTION =
  "Airbnb ve Booking misafir mesajlarınızı 7/24, Türkçe öncelikli ve güvenli biçimde yanıtlayan yapay zekâ asistanı. Temizlik ve check-in görevleri otomatik akışta, tüm operasyon tek panelde.";

export const metadata: Metadata = {
  metadataBase: new URL("https://lixusai.com"),
  title: {
    default: "Lixus AI — Airbnb & Booking için AI Misafir Asistanı",
    template: "%s · Lixus AI",
  },
  description: DESCRIPTION,
  applicationName: "Lixus AI",
  keywords: [
    "Airbnb asistanı", "yapay zekâ misafir iletişimi", "Booking otomatik yanıt",
    "kısa dönem kiralama yazılımı", "Airbnb otomasyon", "misafir mesaj yönetimi", "Lixus AI",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    url: "https://lixusai.com",
    siteName: "Lixus AI",
    title: "Lixus AI — Airbnb & Booking için AI Misafir Asistanı",
    description: DESCRIPTION,
  },
  twitter: {
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
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
