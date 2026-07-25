import type { Metadata } from "next";
import Link from "next/link";
import { Plug, MessageSquare, CalendarOff, ShieldCheck, ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Entegrasyonlar",
  description:
    "Lixus AI, Airbnb ve Booking.com misafir mesajlarınıza güvenilir bağlantı ortakları üzerinden erişir. Airbnb/Booking hesabınızı Hospitable ile bağlayın.",
};

const HIGHLIGHTS = [
  {
    icon: MessageSquare,
    title: "Mesajları okur ve yanıtlar",
    body: "Airbnb/Booking misafir mesajlarınız Lixus AI'ya akar; AI 7/24, misafirin dilinde yanıtlar.",
  },
  {
    icon: CalendarOff,
    title: "Takviminize dokunmaz",
    body: "Hospitable'ın “Limited Connection” modunu öneririz — müsaitlik ve fiyatlarınız tamamen sizde kalır.",
  },
  {
    icon: ShieldCheck,
    title: "Yalnızca mesajlaşma",
    body: "Gelir/ödeme verinize erişmeyiz; sadece mesaj okuma/gönderme ve rezervasyon bağlamı kullanılır.",
  },
];

export default function IntegrationsPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Entegrasyonlar</h1>
        <p className="text-muted-foreground">
          Lixus AI, Airbnb ve Booking.com misafir mesajlarınıza güvenilir bağlantı ortakları
          üzerinden erişir. Hesabınızı bağlayın, gerisini yapay zekâ halletsin.
        </p>
      </header>

      {/* Featured partner: Hospitable */}
      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plug className="size-6" />
          </span>
          <div>
            <h2 className="text-xl font-semibold">Hospitable</h2>
            <p className="text-sm text-muted-foreground">Airbnb · Booking.com bağlantısı</p>
          </div>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Airbnb ve Booking.com hesabınızı <strong className="text-foreground">Hospitable</strong> üzerinden
          bağlarsınız; Lixus AI misafir mesajlarınızı okur ve sizin adınıza güvenle yanıtlar. Hospitable
          resmi bir Airbnb yazılım ortağıdır ve bağlantıyı güvenli şekilde sağlar.
        </p>

        {/* ÖN KOŞUL — sayfanın en üstünde, bağlan düğmesinden ÖNCE. Bu, ürünü
            denemek isteyen hostun karşılaşacağı ilk gerçek maliyet; kurulumun
            ortasında öğrenmesi kötü bir sürpriz olur. Rakam YAZILMAZ (bizim
            kontrolümüzde değil, bayatlar) → resmî fiyat sayfasına link. */}
        <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50/60 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          <p className="font-semibold">Bağlantı için ücretli bir Hospitable planı gerekir</p>
          <p className="mt-1">
            Mesaj ve rezervasyon akışı Hospitable’ın API / Connected Integrations erişimini kullanır.
            Bu erişim yalnızca ücretli planlarda (<strong>Host</strong>, <strong>Professional</strong>,{" "}
            <strong>Mogul</strong>) bulunur; ücretsiz <strong>Essentials</strong> planında API ve
            Connected Integrations yoktur, dolayısıyla Lixus AI’ya mesaj akmaz.
          </p>
          <p className="mt-2">
            <strong>Hospitable ücreti Lixus AI aboneliğine dahil değildir</strong> ve doğrudan
            Hospitable’a ödenir. Güncel tutar için{" "}
            <a
              href="https://hospitable.com/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              Hospitable fiyat sayfasına
            </a>{" "}
            bakın.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} className="rounded-xl border border-border p-4">
              <h.icon className="size-5 text-primary" />
              <p className="mt-2 text-sm font-medium">{h.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{h.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/register" className={cn(buttonVariants({ size: "sm" }))}>
            Hesabınızı bağlayın
          </Link>
          <a
            href="https://hospitable.com"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
          >
            Hospitable hakkında <ExternalLink className="size-3.5" />
          </a>
        </div>
      </section>

      <p className="text-sm text-muted-foreground">
        Daha fazla bağlantı seçeneği yakında.{" "}
        <Link href="/" className="text-primary hover:underline">
          Ana sayfaya dönün
        </Link>
        .
      </p>
    </div>
  );
}
