import type { Config } from "tailwindcss";

const config: Config = {
  // 🚨 "class" — VARSAYILAN "media" DEĞİL. İki sebep:
  //  1. Karanlık mod yalnız PANELDE geçerli (ürün kararı); "media" kapsamı
  //     seçmeye izin vermez, işletim sistemi tercihini her sayfaya uygular.
  //  2. Bugün zaten bir kusur var: `(legal)/entegrasyonlar/page.tsx` içinde tek
  //     bir `dark:` sınıfı duruyor ve "media" varsayılanı yüzünden işletim
  //     sistemi karanlık olan ziyaretçide ŞU AN ateşleniyor — çevresindeki her
  //     şey açık kalırken. "class"a geçmek onu da kapatıyor.
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // ⚠️ ARA BOYUTLAR — kaynakta KULLANILIYOR ama varsayılan ölçekte YOK.
      // `size-4.5` ve `size-5.5` beş yerde yazılmış (sidebar ikonları, landing
      // adım/özellik ikonları, marka işareti) ve Tailwind bu sınıflar için
      // HİÇ CSS ÜRETMİYORDU → ikonlar lucide'ın varsayılanı olan 24px'te
      // kalıyordu. Yani yazarın niyeti hiç uygulanmamış: sidebar ikonu, yanındaki
      // `size-4`/`size-5` öğelerden görünür biçimde büyüktü.
      // Sınıfları size-5'e çevirmek yerine ölçeğe eklemek, yazılmış tasarımı
      // olduğu gibi çalıştırır ve tamamen katkısaldır (bugün hiçbir yerde
      // çalışan bir stili değiştirmez — çünkü bugün hiç çalışmıyorlar).
      spacing: { "4.5": "1.125rem", "5.5": "1.375rem" },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
