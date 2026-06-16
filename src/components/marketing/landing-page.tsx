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
  PlayCircle,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LeadForm } from "@/components/marketing/lead-form";
import { StructuredData } from "@/components/marketing/structured-data";
import { cn } from "@/lib/utils";

// Public marketing landing page (logged-out visitors). Turkish-first, sells the
// real edges: native Turkish AI, safety (no auto-reply on complaints), 24/7,
// done-for-you setup. Static server component for speed/SEO.

const STEPS = [
  {
    icon: Plug,
    title: "1. Bağlayın",
    body: "Airbnb / Booking bağlantınızı birkaç tıkla ekleyin — teknik bilgi gerekmez. İsterseniz kurulumda size yardımcı oluruz.",
  },
  {
    icon: Brain,
    title: "2. AI öğrenir",
    body: "Lixus AI önceki cevaplarınızdan üslubunuzu, dairelerinizi ve sık sorulan soruları öğrenir; zamanla size daha çok benzer. Bilgi tabanınızı kullanır, asla bilgi uydurmaz.",
  },
  {
    icon: MessageSquareReply,
    title: "3. 7/24 yanıtlar",
    body: "Misafir mesajları gece 3’te bile anında, doğru ve sizin tonunuzla yanıtlanır. İsterseniz onaylarsınız, isterseniz tamamen AI’a bırakırsınız.",
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
    body: "Önceki cevaplarınızdan yazış tarzınızı öğrenir ve zamanla size daha çok benzer. Misafir bir asistanla değil, sizinle konuşuyormuş gibi hisseder.",
  },
  {
    icon: Wrench,
    title: "Dakikalar içinde kurulum",
    body: "Kaydolun, Airbnb/Booking bağlantınızı ekleyin, dairelerinizin bilgilerini girin — teknik bilgi gerekmez. Sade panelinizi hemen kullanmaya başlarsınız.",
  },
  {
    icon: LayoutDashboard,
    title: "Tek panel",
    body: "Tüm misafir mesajları, otomatik karşılama, check-in/checkout ve günlük operasyon tek ekranda.",
  },
];

// Display tiers — keep PRICES + property ranges in sync with src/lib/billing/plans.ts
// (DEFAULT_PLANS). Reverse-trial model: 14 gün tam Pro ücretsiz (kart yok), sonra plan
// seçilir. Başlangıç ₺449 (2 daire) · Pro ₺899 (7) · İşletme ₺1.699 (∞).
const TIERS = [
  {
    name: "Başlangıç",
    price: "₺449",
    unit: "/ay",
    desc: "1–2 daireli ev sahipleri için",
    features: ["7/24 otomatik yanıt", "Türkçe + çok dilli", "Şikayet koruması", "E-posta desteği"],
    highlight: false,
  },
  {
    name: "Pro",
    price: "₺899",
    unit: "/ay",
    desc: "3–7 daireli profesyonel hostlar",
    features: ["Başlangıç’taki her şey", "Otomatik karşılama & check-in", "Detaylı performans raporları", "Öncelikli destek"],
    highlight: true,
  },
  {
    name: "İşletme",
    price: "₺1.699",
    unit: "/ay",
    desc: "8+ daire / yönetim şirketleri",
    features: ["Pro’daki her şey", "Sınırsız daire", "Özel kurulum", "Telefon desteği"],
    highlight: false,
  },
];

const FAQS = [
  {
    q: "Airbnb hesabıma ya da takvimime zarar verir mi?",
    a: "Hayır. Lixus AI yalnızca misafir mesajlarınızı okur ve yanıtlar; takviminize, fiyatlarınıza veya rezervasyonlarınıza dokunmaz. Kontrol her zaman sizde kalır.",
  },
  {
    q: "Yanlış ya da uygunsuz cevap verir mi?",
    a: "Şikayet, iade ve iptal gibi hassas mesajlar asla otomatik gönderilmez — doğrudan size iletilir. AI emin olmadığında mesajı kendiliğinden göndermez; hazırladığı taslağı onayınıza bırakır.",
  },
  {
    q: "Misafirim yabancı; AI onun dilinde mi cevap verir?",
    a: "Evet. AI misafirin yazdığı dili algılar ve o dilde yanıtlar — Türkçe, İngilizce, Rusça, Almanca, Arapça ve daha fazlası. Siz panelinizi Türkçe yönetirsiniz, misafir kendi dilinde yanıt alır.",
  },
  {
    q: "Hangi platformları destekliyor?",
    a: "Airbnb ve Booking.com misafir mesajlarını destekler. Bağlantıyı kurulumda adım adım gösteriyoruz; sonrasında her iki platformu tek panelden yönetirsiniz.",
  },
  {
    q: "Kurulum zor mu? Teknik bilgi gerekir mi?",
    a: "Hayır. Kaydolun, Airbnb/Booking bağlantınızı birkaç tıkla yapın, dairelerinizin bilgilerini ekleyin — AI hemen yanıtlamaya başlar. Takılırsanız kurulumda yanınızdayız.",
  },
  {
    q: "Ücretsiz deneyebilir miyim? Kart gerekiyor mu?",
    a: "Evet. 14 gün boyunca tüm Pro özellikleri ücretsiz, kart gerekmez. Beğenirseniz devam edersiniz; beğenmezseniz hiçbir şey ödemezsiniz.",
  },
  {
    q: "İstediğim zaman durdurabilir miyim?",
    a: "Evet. Otomatik gönderimi tek tıkla kapatabilir, aboneliğinizi dilediğiniz zaman sonlandırabilirsiniz. Taahhüt yok.",
  },
];

export function LandingPage() {
  // Optional WhatsApp contact — set NEXT_PUBLIC_WHATSAPP to a BUSINESS number
  // (digits only, with country code, e.g. 905xxxxxxxxx). Never hardcode a
  // personal number; if unset, only the e-mail contact is shown.
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP?.replace(/\D/g, "");
  // Optional demo video — set NEXT_PUBLIC_DEMO_VIDEO to a YouTube/Loom EMBED URL
  // (e.g. https://www.youtube.com/embed/XXXX). If unset, a placeholder is shown.
  const demoVideo = process.env.NEXT_PUBLIC_DEMO_VIDEO;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <StructuredData faqs={FAQS} />
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
          Airbnb ve Booking misafir mesajlarınızı Lixus AI yanıtlasın — Türkçe öncelikli, güvenli ve
          her zaman sizin kontrolünüzde. Siz uyurken bile. Kurulum birkaç dakika, teknik bilgi gerekmez.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
            14 gün ücretsiz dene <ArrowRight className="size-4" />
          </Link>
          <a href="#nasil" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}>
            Nasıl çalışır?
          </a>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Kredi kartı gerekmez · Dakikalar içinde kurulum · İstediğiniz zaman iptal</p>
      </section>

      {/* Demo video */}
      <section className="border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Lixus AI iş başında</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Misafir mesajı geldiğinde AI’ın nasıl anında, doğru ve sizin tonunuzla yanıtladığını görün.
          </p>
          <div className="mt-10 aspect-video overflow-hidden rounded-2xl border border-border bg-foreground/5 shadow-sm">
            {demoVideo ? (
              <iframe
                src={demoVideo}
                title="Lixus AI demo"
                className="size-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <span className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <PlayCircle className="size-8" />
                </span>
                <p className="text-sm font-medium">Demo videosu çok yakında</p>
              </div>
            )}
          </div>
        </div>
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

      {/* More — shipped features the rest of the page doesn't spell out */}
      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight">Panelin içinde dahası var</h2>
          <div className="mx-auto mt-8 grid max-w-3xl gap-x-8 gap-y-3 sm:grid-cols-2">
            {[
              "Airbnb + Booking mesajları tek gelen kutusunda",
              "A–F performans skoru ile işletme karnesi",
              "Daireye göre doluluk (geçen aya kıyasla)",
              "AI önceki cevaplarınızdan üslubunuzu öğrenir",
              "Gece/gündüz çalışma saati ayarı",
              "İki adımlı güvenlik (2FA)",
              "Otomatik karşılama, check-in ve checkout mesajları",
              "Türkçe, İngilizce, Almanca, Arapça ve daha fazlası",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{item}</span>
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
            Her şey açık başlayın: <strong className="text-foreground">14 gün boyunca tüm Pro
            özellikleri ücretsiz</strong> — kart gerekmez. Sonra daire sayınıza göre seçin.
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

      {/* Final CTA + lead form */}
      <section id="demo" className="scroll-mt-20 border-t border-border bg-primary py-16 text-primary-foreground">
        <div className="mx-auto max-w-xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Ücretsiz demo isteyin</h2>
          <p className="mx-auto mt-3 max-w-md text-center text-primary-foreground/80">
            Bilgilerinizi bırakın, size dönüp kurulumu birlikte yapalım. 14 gün ücretsiz, taahhüt yok.
          </p>
          <div className="mt-8">
            <LeadForm />
          </div>
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
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">Giriş</Link>
            <Link href="/gizlilik" className="hover:text-foreground">Gizlilik &amp; KVKK</Link>
            <Link href="/kosullar" className="hover:text-foreground">Koşullar</Link>
            <Link href="/on-bilgilendirme" className="hover:text-foreground">Ön Bilgilendirme</Link>
            <Link href="/mesafeli-satis" className="hover:text-foreground">Mesafeli Satış</Link>
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
            <a href="mailto:iletisimlixusai@gmail.com" className="hover:text-foreground">İletişim</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
