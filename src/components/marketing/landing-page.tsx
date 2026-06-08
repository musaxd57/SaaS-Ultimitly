import Link from "next/link";
import {
  Hotel,
  Globe,
  ShieldCheck,
  Moon,
  UserRound,
  Wrench,
  LayoutDashboard,
  Plug,
  Brain,
  MessageSquareReply,
  Check,
  ArrowRight,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Public marketing landing page (logged-out visitors). Turkish-first, sells the
// real edges: native Turkish AI, safety (no auto-reply on complaints), 24/7,
// done-for-you setup. Static server component for speed/SEO.

const STEPS = [
  {
    icon: Plug,
    title: "1. Bağlayın",
    body: "Mevcut Airbnb / Booking bağlantınızı saniyeler içinde ekleyin. İsterseniz kurulumu tamamen biz yaparız — siz hiçbir teknik şeyle uğraşmazsınız.",
  },
  {
    icon: Brain,
    title: "2. AI öğrenir",
    body: "Lixus AI sizin üslubunuzu, dairelerinizi ve sık sorulan soruları öğrenir; bilgi tabanınızı kullanır, asla bilgi uydurmaz.",
  },
  {
    icon: MessageSquareReply,
    title: "3. 7/24 yanıtlar",
    body: "Misafir mesajları gece 3’te bile anında, doğru ve sizin tonunuzla yanıtlanır. Siz sadece onaylar ya da bırakırsınız.",
  },
];

const FEATURES = [
  {
    icon: Globe,
    title: "Türkçe öncelikli, çok dilli",
    body: "Misafire kendi dilinde yanıt verir — Türkçe, İngilizce, Almanca, Arapça ve daha fazlası. Global araçların aksine Türkçe’de doğal ve akıcı.",
  },
  {
    icon: ShieldCheck,
    title: "Güvenli — riski insana bırakır",
    body: "Şikayet, iade veya iptal mesajlarına asla otomatik cevap göndermez; bunları size iletir. Emin olmadığında konuşturmaz, susar.",
  },
  {
    icon: Moon,
    title: "7/24, siz uyurken bile",
    body: "Gece-gündüz, hafta sonu fark etmez. Hızlı yanıt = daha mutlu misafir = daha iyi değerlendirme.",
  },
  {
    icon: UserRound,
    title: "İnsan gibi ton, robot değil",
    body: "Sizin yazış tarzınızı taklit eder. Misafir bir asistanla değil, sizinle konuşuyormuş gibi hisseder.",
  },
  {
    icon: Wrench,
    title: "Sizin yerinize kurulum",
    body: "Done-for-you: bağlantıyı, bilgi tabanını ve ayarları biz hazırlarız. Siz sadece temiz panelinizi kullanırsınız.",
  },
  {
    icon: LayoutDashboard,
    title: "Tek panel",
    body: "Tüm misafir mesajları, otomatik karşılama, check-in/checkout ve günlük operasyon tek ekranda.",
  },
];

const TIERS = [
  {
    name: "Başlangıç",
    price: "₺499",
    unit: "/ay",
    desc: "1–2 daireli ev sahipleri için",
    features: ["7/24 otomatik yanıt", "Türkçe + çok dilli", "Şikayet koruması", "E-posta desteği"],
    highlight: false,
  },
  {
    name: "Pro",
    price: "₺999",
    unit: "/ay",
    desc: "3–7 daireli profesyonel hostlar",
    features: ["Başlangıç’taki her şey", "Otomatik karşılama & check-in", "Üslup öğrenme", "Öncelikli destek"],
    highlight: true,
  },
  {
    name: "İşletme",
    price: "₺1.490+",
    unit: "/ay",
    desc: "8+ daire / yönetim şirketleri",
    features: ["Pro’daki her şey", "Sınırsız daire", "Özel kurulum", "Telefon desteği"],
    highlight: false,
  },
];

const FAQS = [
  {
    q: "Airbnb hesabıma ya da takvimime zarar verir mi?",
    a: "Hayır. Lixus AI takvime ve fiyatlara dokunmaz — yalnızca misafir mesajlarını okur ve yanıtlar. Rezervasyonlarınız ve fiyatlarınız sizde kalır.",
  },
  {
    q: "Yanlış ya da uygunsuz cevap verir mi?",
    a: "Şikayet, iade ve iptal gibi hassas mesajlar asla otomatik gönderilmez; size iletilir. AI emin olmadığında söz vermez, taslağı insan onayına bırakır.",
  },
  {
    q: "Kurulum zor mu? Teknik bilgi gerekir mi?",
    a: "Hayır. İsterseniz kurulumu baştan sona biz yaparız. Siz yalnızca temiz panelinizden misafirlerinizi takip edersiniz.",
  },
  {
    q: "Hangi platformları destekliyor?",
    a: "Airbnb ve Booking.com misafir mesajları (Hospitable bağlantısı üzerinden). Mevcut bağlantınızı kullanır.",
  },
  {
    q: "İstediğim zaman durdurabilir miyim?",
    a: "Evet. Otomatik gönderimi tek tıkla kapatabilir, dilediğinizde aboneliğinizi sonlandırabilirsiniz. Taahhüt yok.",
  },
];

export function LandingPage() {
  // Optional WhatsApp contact — set NEXT_PUBLIC_WHATSAPP to a BUSINESS number
  // (digits only, with country code, e.g. 905xxxxxxxxx). Never hardcode a
  // personal number; if unset, only the e-mail contact is shown.
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP?.replace(/\D/g, "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Hotel className="size-4.5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Lixus <span className="text-primary">AI</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#nasil" className="hover:text-foreground">Nasıl çalışır</a>
            <a href="#ozellikler" className="hover:text-foreground">Özellikler</a>
            <a href="#fiyatlar" className="hover:text-foreground">Fiyatlar</a>
            <a href="#sss" className="hover:text-foreground">SSS</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Giriş Yap
            </Link>
            <Link href="/register" className={cn(buttonVariants({ size: "sm" }))}>
              Ücretsiz Dene
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/60 px-3 py-1 text-xs font-medium text-accent-foreground">
          <ShieldCheck className="size-3.5" /> Airbnb &amp; Booking ev sahipleri için yapay zekâ asistanı
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Misafirlerinize 7/24, kendi dillerinde, <span className="text-primary">insan gibi</span> cevap veren yapay zekâ
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          Airbnb ve Booking misafir mesajlarınızı Lixus AI yanıtlasın — Türkçe öncelikli, hatasız ve güvenli.
          Siz uyurken bile. Kurulumu biz yaparız.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
            14 gün ücretsiz dene <ArrowRight className="size-4" />
          </Link>
          <a href="#nasil" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}>
            Nasıl çalışır?
          </a>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Kredi kartı gerekmez · Kurulum ücretsiz · İstediğiniz zaman iptal</p>
      </section>

      {/* How it works */}
      <section id="nasil" className="border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Üç adımda kurulur</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Karmaşık değil. Bağlayın, AI öğrensin, gerisini o halletsin.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.title} className="rounded-xl border border-border bg-card p-6">
                <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5.5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="ozellikler" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Neden Lixus AI?</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Global araçların Türkçe’de yapamadığını, güvenli ve sizin yerinize yapar.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-card p-6">
                <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="size-5.5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="fiyatlar" className="border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Basit, şeffaf fiyatlandırma</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Kurulum ücretsiz, 14 gün deneme. Daire sayınıza göre seçin.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={cn(
                  "flex flex-col rounded-xl border bg-card p-6",
                  t.highlight ? "border-primary shadow-lg ring-1 ring-primary" : "border-border",
                )}
              >
                {t.highlight ? (
                  <span className="mb-3 inline-flex w-fit rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                    En popüler
                  </span>
                ) : null}
                <h3 className="text-lg font-semibold">{t.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{t.price}</span>
                  <span className="text-sm text-muted-foreground">{t.unit}</span>
                </div>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {t.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={cn(buttonVariants({ variant: t.highlight ? "default" : "outline" }), "mt-6 w-full")}
                >
                  Başla
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="sss" className="py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Sık sorulan sorular</h2>
          <div className="mt-10 space-y-4">
            {FAQS.map((f) => (
              <div key={f.q} className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold">{f.q}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-primary py-16 text-primary-foreground">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">Misafir mesajlarıyla uğraşmayı bırakın</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            Lixus AI sizin yerinize, sizin tonunuzla yanıtlasın. 14 gün ücretsiz deneyin, farkı görün.
          </p>
          <Link
            href="/register"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "mt-8")}
          >
            Hemen ücretsiz başla <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Hotel className="size-4" />
            </span>
            <span className="text-sm font-semibold">Lixus AI</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Lixus AI · Airbnb &amp; Booking ev sahipleri için yapay zekâ asistanı
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">Giriş</Link>
            {whatsapp ? (
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                WhatsApp
              </a>
            ) : null}
            <a href="mailto:iletisim@lixusai.com" className="hover:text-foreground">İletişim</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
