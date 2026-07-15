import Link from "next/link";
import {
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
  ChevronDown,
  QrCode,
  ClipboardCheck,
  BarChart3,
  BookOpen,
  PenLine,
  Bot,
  Quote,
  Ban,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { BrandMark } from "@/components/brand";
import { LeadForm } from "@/components/marketing/lead-form";
import { StructuredData } from "@/components/marketing/structured-data";
import { Reveal } from "@/components/marketing/reveal";
import { DemoFrame } from "@/components/marketing/demo-frame";
import { LandingDemo } from "@/components/marketing/landing-demo";
import { NavScroll } from "@/components/marketing/nav-scroll";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { cn } from "@/lib/utils";

// Public marketing landing page (logged-out visitors). Turkish-first, sells the
// real edges: native Turkish AI, safety (no auto-reply on complaints), 24/7,
// fast setup. Server component for speed/SEO; tiny client islands add motion.

const STEPS = [
  {
    icon: Plug,
    title: "1. Hesabınızı bağlayın",
    body: "Airbnb / Booking bağlantınızı birkaç tıkla ekleyin — kod yok, teknik bilgi yok. Takılırsanız adım adım yanınızdayız.",
  },
  {
    icon: Brain,
    title: "2. AI sizi öğrenir",
    body: "Önceki cevaplarınızdan üslubunuzu, dairelerinizi ve sık sorulan soruları öğrenir; zamanla size daha çok benzer. Sadece sizin girdiğiniz bilgilerden konuşur — bilmediğini uydurmaz, size sorar.",
  },
  {
    icon: MessageSquareReply,
    title: "3. Gerisini o halleder",
    body: "Misafir mesajları gece 3’te bile, sizin tonunuzla yanıtlanır. İsterseniz önce siz onaylayın, isterseniz tamamen AI’a bırakın — kontrol her zaman sizde.",
  },
];

// Honest 3-tier sales scenarios — mirror the REAL safety architecture:
// tier 1 auto-sends, tier 2 calms + gathers info (host approves; optional
// auto pre-reply the host knowingly enables), tier 3 always waits for the host.
const DEMO_SCENARIOS: { tier: 1 | 2 | 3; message: string; outcome: string }[] = [
  {
    tier: 1,
    message: "Merhaba, wifi şifresi nedir?",
    outcome: "Bilgi tabanınızdaki Wi-Fi bilgisiyle anında, sizin üslubunuzla yanıtlar.",
  },
  {
    tier: 1,
    message: "Check-in saat kaçta, erken gelebilir miyiz?",
    outcome: "Dairenizin gerçek giriş saatiyle anında yanıtlar; erken giriş isteğini size iletir.",
  },
  {
    tier: 1,
    message: "Wo kann ich parken?",
    outcome: "Almanca soruya Almanca cevap verir — otopark bilginizden.",
  },
  {
    tier: 2,
    message: "Ev çok soğuk, hiç memnun kalmadık.",
    outcome:
      "Sakin bir cevap taslağı hazırlar, foto/detay ister, sorunu size işaretler — söz vermez, suçu kabul etmez. Dilerseniz \"aldık, ilgileniyoruz\" ön-yanıtını otomatik de gönderir (siz açarsanız).",
  },
  {
    tier: 3,
    message: "Daire hiç temiz değildi, iade istiyorum.",
    outcome: "Para/iade tespit edilir; otomatik cevap GÖNDERİLMEZ — taslak + e-posta ile size düşer.",
  },
  {
    tier: 3,
    message: "Airbnb komisyonu çok, IBAN atayım direkt ödeyeyim?",
    outcome: "Platform dışı ödeme = kırmızı çizgi. AI asla kabul etmez, sizi uyarır.",
  },
];
const TIER_META: Record<1 | 2 | 3, { chip: string; cls: string }> = {
  1: { chip: "Anında yanıtlar", cls: "bg-emerald-50 text-emerald-700" },
  2: { chip: "Yatıştırır + bilgi toplar", cls: "bg-yellow-50 text-yellow-800" },
  3: { chip: "Durur, size bırakır", cls: "bg-amber-50 text-amber-700" },
};

// The market context: two familiar-but-costly ways to handle guest messages,
// and the bounded middle path Lixus takes. Fresh copy on purpose — the safety
// promise is already stated elsewhere on the page, so this section sells the
// TIME/TRUST trade-off instead of restating it.
const COMPARE: { chip: string; icon: typeof PenLine; title: string; body: string; ours?: boolean }[] = [
  {
    chip: "Eski usul",
    icon: PenLine,
    title: "Hepsini kendiniz yazmak",
    body: "Uykudan, yemekten, tatilden çalınan dakikalar. Geç kalan her cevap, misafirin başka bir ilana bakması için bir fırsattır — siz de telefondan hiç kopamazsınız.",
  },
  {
    chip: "Diğer uç",
    icon: Bot,
    title: "Hepsini bota devretmek",
    body: "Sınır çizilmemiş bir bot, kurnaz bir mesajla konudan çıkarılabilir; gergin bir pazarlıkta ağzından ne çıkacağını önceden kimse bilemez. Bunu fark eden misafirin güvenini geri kazanmak zordur.",
  },
  {
    chip: "Lixus’un yolu",
    icon: ShieldCheck,
    title: "Sınırı belli otomasyon",
    body: "Cevabı bilgi tabanınızda yazan iş saniyeler içinde biter; yorum ve karar isteyen konuşma olduğu gibi önünüze gelir. Hızı makineden, sağduyuyu sizden alırsınız.",
    ours: true,
  },
];

// The enumerated red lines — the closed set the safety gate enforces in code.
// Shown once, as a single explicit commitment (the rest of the page mentions
// safety in passing; this is the concrete list a host can hold us to).
const RED_LINES = [
  "Para ve iade talepleri",
  "Şikayetlerin çözümü",
  "Rezervasyon iptalleri",
  "Güvenlik ve acil durumlar",
  "Kötü yorum pazarlıkları",
  "Platform dışı ödeme teklifleri",
  "İnsanla görüşme talepleri",
];

const FEATURES = [
  {
    icon: Globe,
    title: "Türkçe öncelikli, çok dilli",
    body: "Misafir hangi dilde yazarsa o dilde cevap alır — Türkçe, İngilizce, Almanca, Rusça, Arapça ve daha fazlası. Yabancı araçların aksine Türkçe’si çeviri kokmaz.",
  },
  {
    icon: ShieldCheck,
    title: "Şikayetlerde devreyi size verir",
    body: "Şikayet, iade veya iptal mesajlarını asla kendi başına sonuçlandırmaz — işaretleyip size iletir. Emin değilse göndermez, taslağı onayınıza bırakır.",
  },
  {
    icon: Moon,
    title: "7/24, siz uyurken bile",
    body: "Gece-gündüz, hafta sonu fark etmez. Hızlı yanıt = daha mutlu misafir = daha iyi değerlendirme.",
  },
  {
    icon: UserRound,
    title: "Robot gibi değil, sizin gibi",
    body: "Eski cevaplarınızdan yazış tarzınızı öğrenir ve zamanla size daha da benzer. Misafir bir botla değil, ev sahibiyle konuştuğunu hisseder.",
  },
  {
    icon: Wrench,
    title: "Dakikalar içinde kurulum",
    body: "Kaydolun, bağlantınızı ekleyin, daire bilgilerinizi girin — bitti. Kurulum ekibi, eğitim, kod yok. Aynı gün yanıt almaya başlarsınız.",
  },
  {
    icon: LayoutDashboard,
    title: "Tek panel",
    body: "Airbnb ve Booking mesajları, otomatik karşılama, giriş-çıkış ve günlük işleriniz tek ekranda. Uygulamadan uygulamaya koşturmak yok.",
  },
];

// Display tiers — keep PRICES + property ranges in sync with src/lib/billing/plans.ts
// (DEFAULT_PLANS). Reverse-trial: 14 gün tam Pro ücretsiz (kart yok), sonra plan seçilir.
// TÜM ücretli planlar AYNI çekirdek ürün özelliklerini alır (kod'da per-özellik kilit
// YOK — premiumAllowed tek boolean; enforcement yalnız propertyLimit). Planlar SADECE
// daire sayısı + destek seviyesiyle ayrışır. Özellikleri üst plana özelmiş gibi
// göstermeyin (Başlangıç müşterisi karşılama/giriş/çıkış + raporları da kullanır).
const TIERS = [
  {
    name: "Başlangıç",
    price: "₺449",
    unit: "/ay",
    desc: "1–2 daireli ev sahipleri için",
    features: [
      "2 daireye kadar",
      "Tüm AI özellikleri dahil",
      "7/24 otomatik misafir yanıtı (Türkçe + çok dilli)",
      "Otomatik karşılama, giriş ve çıkış mesajları",
      "Doluluk ve performans raporları",
      "Şikayette otomatik durma",
      "E-posta desteği",
    ],
    highlight: false,
  },
  {
    name: "Pro",
    price: "₺899",
    unit: "/ay",
    desc: "3–7 daireli profesyonel hostlar",
    features: [
      "7 daireye kadar",
      "Başlangıç’taki tüm AI özellikleri",
      "Öncelikli destek",
    ],
    highlight: true,
  },
  {
    name: "İşletme",
    price: "₺1.699",
    unit: "/ay",
    desc: "8–25 daireli profesyoneller",
    features: [
      "25 daireye kadar",
      "Başlangıç’taki tüm AI özellikleri",
      "Birebir kurulum + öncelikli destek",
    ],
    highlight: false,
  },
];

const FAQS = [
  {
    q: "Airbnb hesabıma ya da takvimime zarar verir mi?",
    a: "Hayır, hesabınız güvende. Lixus AI yalnızca misafir mesajlarınızı okur ve yanıtlar; takviminize, fiyatlarınıza veya rezervasyonlarınıza dokunmaz. Kontrol her zaman sizde kalır.",
  },
  {
    q: "Yanlış ya da uygunsuz cevap verir mi?",
    a: "Şikayet, iade, iptal gibi hassas mesajları asla otomatik sonuçlandırmaz — doğrudan size düşer. Dilerseniz (siz açarsanız) yalnızca kısa bir \"mesajınızı aldık, ilgileniyoruz\" bekletme yanıtı otomatik gider; çözüm ve karar her zaman sizdedir. Emin olmadığı her durumda taslağı hazırlar, göndermeden önce onayınızı bekler.",
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
    a: "Hayır. Kaydolun, Airbnb/Booking bağlantınızı birkaç tıkla yapın, daire bilgilerinizi ekleyin — AI hemen yanıtlamaya başlar. Takılırsanız kurulumda yanınızdayız.",
  },
  {
    q: "Ücretsiz deneyebilir miyim? Kart gerekiyor mu?",
    a: "Evet. 14 gün boyunca tüm Pro özellikleri ücretsiz, kart gerekmez. Beğenirseniz devam edersiniz; beğenmezseniz hiçbir şey ödemezsiniz.",
  },
  {
    q: "İstediğim zaman durdurabilir miyim?",
    a: "Evet. Otomatik gönderimi tek tıkla kapatabilir, aboneliğinizi dilediğiniz zaman sonlandırabilirsiniz. Taahhüt yok.",
  },
  {
    q: "Misafir, yanıtın yapay zekâdan geldiğini anlar mı?",
    a: "Bu sizin seçiminiz. Varsayılan olarak otomatik yanıtların altına kısa bir bilgilendirme notu eklenir — şeffaflığın güveni artırdığını düşünüyoruz. Dilerseniz bu notu ayarlardan kapatırsınız. Her iki durumda da yanıtlar sizin girdiğiniz bilgilerden ve sizin üslubunuzdan üretilir.",
  },
  {
    q: "Misafir verileri nasıl saklanıyor?",
    a: "Veriler KVKK gözetilerek işlenir: misafir kişisel verileri saklama süresi dolunca anonimleştirilir, tüm verinizi dilediğinizde tek dosya hâlinde indirebilir, hesabınızı sildiğinizde kalıcı olarak sildirebilirsiniz. Misafir mesajları yalnızca size yanıt üretmek için kullanılır; reklam veya başka amaçla işlenmez.",
  },
];

// Honest trust chips: "KVKK odaklı" (not an absolute compliance certification
// claim while the DPA/legal work is in progress) and "otomatik sonuçlandırmaz"
// (the opt-in holding acknowledgement exists — resolution is always human).
const TRUST = ["Türkiye’de geliştirildi", "KVKK odaklı tasarım", "Şikayeti otomatik sonuçlandırmaz", "Kullanıcı dostu arayüz"];

// The real panels a customer uses — shown as little "screens" on the landing.
const PANELS = [
  {
    icon: LayoutDashboard,
    name: "Panel",
    body: "Günlük AI özeti, bugünkü giriş/çıkışlar, bekleyen mesajlar ve doluluk — sabah açınca her şey bir bakışta.",
  },
  {
    icon: MessageSquareReply,
    name: "Mesajlar",
    body: "Airbnb + Booking tek gelen kutusunda. Güvenli sorulara AI otomatik cevap verir; dilerseniz önce önerir, tek tıkla gönderirsiniz.",
  },
  {
    icon: QrCode,
    name: "Misafir Sohbetleri",
    body: "Daireye astığınız QR ile misafir, konaklama boyunca AI’a soru sorar; çözemezse size iletilir.",
  },
  {
    icon: ClipboardCheck,
    name: "Görevler",
    body: "Temizlik ve giriş hazırlığı görevleri rezervasyondan otomatik oluşur; Kanban’da takip edersiniz.",
  },
  {
    icon: BarChart3,
    name: "Raporlar",
    body: "Performans skoru, daireye göre doluluk, şikayet yoğunluğu ve en çok sorulan konular.",
  },
  {
    icon: BookOpen,
    name: "Bilgi Tabanı",
    body: "Wi-Fi, giriş talimatı, ev kuralları — AI ve otomatik mesajlar bu bilgilerle konuşur.",
  },
];

export function LandingPage() {
  // Optional WhatsApp contact — set NEXT_PUBLIC_WHATSAPP to a BUSINESS number
  // (digits only, with country code). If unset, only the e-mail contact shows.
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP?.replace(/\D/g, "");
  // Optional demo video — set NEXT_PUBLIC_DEMO_VIDEO to a YouTube/Loom EMBED URL.
  // If unset, the whole demo section is hidden (no empty placeholder box).
  const demoVideo = process.env.NEXT_PUBLIC_DEMO_VIDEO;
  // Live "try the AI" block — mirrors the /api/demo/ai kill-switch so the
  // section and the endpoint appear/disappear together.
  const aiDemoEnabled = process.env.LANDING_DEMO_ENABLED === "1";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <StructuredData faqs={FAQS} />
      <NavScroll />
      {/* Nav */}
      <header
        id="site-nav"
        className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur transition-shadow duration-300"
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BrandMark className="size-5" />
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
            <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>
              Giriş Yap
            </Link>
            <Link href="/register" className={cn(buttonVariants({ size: "sm" }))}>
              Ücretsiz Dene
            </Link>
            <MobileNav />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-aura" aria-hidden="true" />
        <div className="relative z-10 mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <span className="badge-in inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/60 px-3 py-1 text-xs font-medium text-accent-foreground shadow-sm ring-1 ring-border/50">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Airbnb &amp; Booking ev sahipleri için yapay zekâ asistanı
          </span>
          <Reveal as="h1" delay={60} className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Misafir mesajlarını <span className="text-primary">7/24, güvenle</span> yanıtlayan yapay zekâ.
          </Reveal>
          <Reveal as="p" delay={140} className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Özelleştirilebilir otomatik yanıtlama — misafiriniz hangi dilde yazarsa o dilde cevap
            alır. Şikayet, iade gibi riskli konuları otomatik yanıtlamaz, size bırakır.
          </Reveal>
          <Reveal delay={220} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "cta-glow cta-arrow w-full sm:w-auto")}>
              14 gün ücretsiz dene <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a href="#nasil" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}>
              Nasıl çalışır?
            </a>
          </Reveal>
          <p className="mt-4 text-sm text-muted-foreground">
            Kredi kartı gerekmez · Dakikalar içinde kurulum · İstediğiniz zaman iptal
          </p>
          {/* Trust strip (honest, pre-launch) */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {TRUST.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-foreground/80 shadow-sm"
              >
                <Check className="size-3 text-primary" aria-hidden="true" /> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Lixus AI in action — a real demo video if configured, otherwise a
          static example conversation so this section is never empty. */}
      <section className="border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">Lixus AI iş başında</Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Misafir hangi dilde yazarsa o dilde yanıt. İster tam otomatik gönderir, ister AI önerir siz tek
            tıkla onaylarsınız — riskli mesajları her zaman size bırakır.
          </Reveal>

          {demoVideo ? (
            <Reveal delay={120} className="mt-10 aspect-video overflow-hidden rounded-2xl border border-border bg-foreground/5 shadow-sm">
              <iframe
                src={demoVideo}
                title="Lixus AI demo"
                className="size-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </Reveal>
          ) : (
            <Reveal delay={120} className="mt-10">
              <DemoFrame src="/urun.html" title="Lixus AI ürün turu" />
            </Reveal>
          )}
        </div>
      </section>

      {/* How it works */}
      <section id="nasil" className="scroll-mt-20 border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">Üç adımda kurulur</Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Bugün kurun, bu gece gelen ilk mesajı AI yanıtlasın.
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 80} className="card-lift rounded-xl border border-border bg-card p-6">
                <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5.5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Setup walkthrough — animated, static iframe (public/kurulum.html) */}
      <section className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">
            Kurulumu 20 saniyede izleyin
          </Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Ücretsiz dene → hesap aç → e-posta onayı → bağlantıyı kur → token'ı yapıştır. Hepsi bu.
          </Reveal>
          <Reveal delay={120} className="mt-10">
            <DemoFrame />
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="ozellikler" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">Neden Lixus AI?</Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Yabancı araçlar Türkçe’yi çeviri gibi konuşur; Lixus AI sizin gibi. Üstelik riskli mesajı asla tek başına yanıtlamaz.
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 70} className="card-lift rounded-xl border border-border bg-card p-6">
                <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="size-5.5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Panels showcase — the real screens, styled as little windows */}
      <section className="border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">
            Açtığınız panelde her şey bir arada
          </Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Mesajdan temizliğe, rapordan misafir sohbetine — tüm operasyonunuz tek ekranda.
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PANELS.map((p, i) => (
              <Reveal
                key={p.name}
                delay={i * 70}
                className="card-lift overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-4 py-2.5">
                  <span className="size-2.5 rounded-full bg-red-400/70" />
                  <span className="size-2.5 rounded-full bg-amber-400/80" />
                  <span className="size-2.5 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <p.icon className="size-3.5 text-primary" aria-hidden="true" /> {p.name}
                  </span>
                </div>
                <p className="p-5 text-sm text-muted-foreground">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* More — shipped features the rest of the page doesn't spell out */}
      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-2xl font-bold tracking-tight">Panelin içinde dahası var</Reveal>
          <Reveal className="mx-auto mt-8 grid max-w-3xl gap-x-8 gap-y-3 sm:grid-cols-2">
            {[
              "Airbnb + Booking mesajları tek gelen kutusunda",
              "A–F performans skoru ile işletme karnesi",
              "Daireye göre doluluk (geçen aya kıyasla)",
              "AI önceki cevaplarınızdan üslubunuzu öğrenir",
              "Gece/gündüz çalışma saati ayarı",
              "İki adımlı güvenlik (2FA)",
              "Otomatik karşılama, check-in ve checkout mesajları",
              "Türkçe, İngilizce, Almanca, Rusça, Arapça ve daha fazlası",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* What the AI answers vs. leaves to the host — honest example scenarios
          (static, no API cost), plus the live demo when the operator has
          enabled the public endpoint (LANDING_DEMO_ENABLED=1). */}
      <section id="canli-demo" className="scroll-mt-20 border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <Reveal as="h2" className="text-3xl font-bold tracking-tight">
            Neyi kendisi yanıtlar, neyi size bırakır?
          </Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Örnek misafir mesajları — yeşiller otomatik yanıtlanır, turuncular güvenlik
            kapısına takılıp onayınıza gelir. Zor konuşmalarda da yalnız değilsiniz: AI
            profesyonel taslağı saniyeler içinde hazırlar, riskli kararları size bırakır.
          </Reveal>
          <Reveal delay={160} className="mx-auto mt-10 grid max-w-4xl gap-4 text-left sm:grid-cols-2">
            {DEMO_SCENARIOS.map((s) => (
              <div key={s.message} className="card-lift rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-medium">&ldquo;{s.message}&rdquo;</p>
                <p className="mt-2 text-sm text-muted-foreground">{s.outcome}</p>
                <span
                  className={cn(
                    "mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                    TIER_META[s.tier].cls,
                  )}
                >
                  {TIER_META[s.tier].chip}
                </span>
              </div>
            ))}
          </Reveal>
          {aiDemoEnabled ? (
            <Reveal delay={220} className="mt-10">
              <h3 className="text-xl font-semibold">Kendiniz deneyin</h3>
              <div className="mt-4">
                <LandingDemo />
              </div>
            </Reveal>
          ) : null}
        </div>
      </section>

      {/* The trade-off: manual vs. unbounded bot vs. bounded automation */}
      <section className="border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">
            Mesaj yüküne iki eski çözüm, bir yenisi
          </Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
            Tek dairede idare edilir; daireler çoğaldıkça misafir mesajları sessizce yarı zamanlı bir işe
            dönüşür. Bugüne kadarki iki seçenek de bir şeyden vazgeçmenizi istiyordu — ya zamanınızdan ya
            kontrolünüzden.
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {COMPARE.map((c, i) => (
              <Reveal
                key={c.title}
                delay={i * 90}
                className={cn(
                  "card-lift flex flex-col rounded-xl border bg-card p-6",
                  c.ours ? "border-primary ring-1 ring-primary" : "border-border",
                )}
              >
                <span
                  className={cn(
                    "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    c.ours ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <c.icon className="size-3.5" aria-hidden="true" /> {c.chip}
                </span>
                <h3 className="mt-4 text-lg font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Founder story + the enumerated red lines (stated ONCE, concretely) */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">
            Bunu bir yazılım şirketi değil, bir ev sahibi başlattı
          </Reveal>
          <Reveal delay={100} className="relative mt-10 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <Quote className="absolute -top-4 left-8 size-8 rounded-full bg-primary p-1.5 text-primary-foreground" aria-hidden="true" />
            <div className="space-y-4 text-[15px] leading-relaxed text-foreground/90">
              <p>
                On civarında daireyi kendim işletiyorum. Bu işin görünmeyen mesaisi mesajlaşmadır: giriş
                saati, otopark, şifre… aynı sorular, her hafta, çoğu gece yarısı.
              </p>
              <p>
                Hazır araçları denedim. Kimi yalnızca öneri hazırlıyordu — gönderme zahmeti yine bende
                kalıyordu. Kimi de her şeyi robota devrediyordu; oysa hassas bir konuşmada botun ne
                söyleyeceğini kimse garanti edemez. Ben ortasını istedim: cevabı belli olan işi benim
                ağzımdan anında halletsin, yorum isteyen her şeyi bana getirsin.
              </p>
              <p>
                Lixus’u önce kendi dairelerim için kurdum; sizin açtığınız panel, benim misafirlerimi
                yönettiğim panelin ta kendisi. Bir aracın nasıl çalışması gerektiğini en iyi, ona muhtaç
                olan bilir.
              </p>
            </div>
            <p className="mt-6 text-sm font-semibold">— Lixus AI’ın kurucusu</p>
          </Reveal>

          {/* Red lines — the one place the closed list is spelled out */}
          <Reveal delay={160} className="mt-8 rounded-2xl border border-border bg-card/60 p-6">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Ban className="size-4 text-primary" aria-hidden="true" /> Koda gömülü kırmızı çizgiler
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Şu yedi başlıkta son söz hiçbir zaman yazılımın değildir — hangi ayarı açarsanız açın:
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {RED_LINES.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground/80"
                >
                  {r}
                </span>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Bu başlıklarda yazılım taslağı hazırlar, sizi anında bilgilendirir — ama son sözü asla kendisi
              söylemez.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Pricing */}
      <section id="fiyatlar" className="scroll-mt-20 border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">Basit, şeffaf fiyatlandırma</Reveal>
          <Reveal as="p" delay={80} className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            <strong className="text-foreground">14 gün boyunca tüm Pro özellikleri ücretsiz</strong> — kart
            istemeden. Beğenirseniz daire sayınıza göre seçin; daire başına değil, sabit aylık. Taahhüt yok.
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {TIERS.map((t, i) => (
              <Reveal
                key={t.name}
                delay={i * 90}
                className={cn(
                  "card-lift flex flex-col rounded-xl border bg-card p-6",
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
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
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
              </Reveal>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            25’ten fazla daire mi yönetiyorsunuz?{" "}
            <a href="#demo" className="font-medium text-foreground underline underline-offset-2">
              Büyük portföyler için bize ulaşın
            </a>
            .
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="sss" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight">Sık sorulan sorular</Reveal>
          <div className="mt-10 space-y-4">
            {FAQS.map((f, i) => (
              <Reveal
                as="details"
                key={f.q}
                delay={Math.min(i * 60, 240)}
                className="card-lift group rounded-xl border border-border bg-card p-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA + lead form */}
      <section id="demo" className="scroll-mt-20 border-t border-border bg-primary py-16 text-primary-foreground">
        <div className="mx-auto max-w-xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Kendiniz başlayın ya da birlikte kuralım</h2>
          <p className="mx-auto mt-3 max-w-md text-center text-primary-foreground/80">
            Hemen ücretsiz deneyin ya da bilgilerinizi bırakın, size dönüp kurulumda yardımcı olalım. 14 gün
            ücretsiz, kart yok, taahhüt yok.
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
              <BrandMark className="size-4.5" />
            </span>
            <span className="text-sm font-semibold">Lixus AI</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Lixus AI · Airbnb &amp; Booking ev sahipleri için yapay zekâ asistanı
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">Giriş</Link>
            <Link href="/entegrasyonlar" className="hover:text-foreground">Entegrasyonlar</Link>
            <Link href="/gizlilik" className="hover:text-foreground">Gizlilik &amp; KVKK</Link>
            <Link href="/kosullar" className="hover:text-foreground">Koşullar</Link>
            <Link href="/on-bilgilendirme" className="hover:text-foreground">Ön Bilgilendirme</Link>
            <Link href="/mesafeli-satis" className="hover:text-foreground">Mesafeli Satış</Link>
            {whatsapp ? (
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
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
