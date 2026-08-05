import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework (minor info-leak hardening).
  poweredByHeader: false,
  // Safe, additive security headers on every response. CSP is TWO-TIER (Codex P2):
  //  * ENFORCED: only the directives that cannot break this app, because the app
  //    never uses the features they gate — object-src (plugins), base-uri (<base>
  //    hijack), frame-ancestors (clickjacking; mirrors X-Frame-Options) and
  //    form-action. form-action was VERIFIED before enforcing, not assumed: all 25
  //    <form> elements are JS-handled (onSubmit + preventDefault), none carries an
  //    `action=` attribute, and the one method="GET" search form submits to its own
  //    URL. Paddle's checkout is an iframe — forms INSIDE it answer to that
  //    document's CSP, not ours. So the directive costs nothing today and blocks
  //    the classic injected-form credential exfil (<form action="https://evil">).
  //  * REPORT-ONLY: the FULL policy incl. script-src. Enforcing script-src needs
  //    per-request nonces for Next's inline bootstrap (ayrı altyapı turu) —
  //    'unsafe-inline'ı enforce etmek koruma katmaz, nonce'suz sıkılaştırmak
  //    paneli komple kırar. NOT: `report-uri`/`report-to` YOK — ihlaller yalnız
  //    ziyaretçinin KENDİ tarayıcı konsolunda görünür, merkezi toplanmaz. Nonce
  //    turunda script-src'i enforce'a çekerken bir rapor endpoint'i de eklenir.
  //
  //    The report-only policy must describe the app HONESTLY, or the enforcement
  //    round is guaranteed to break billing on day one. It used to say
  //    `script-src 'self'` and `connect-src 'self'` while the settings page loads
  //    Paddle.js from cdn.paddle.com and Paddle talks to its own origins — i.e. the
  //    "target" policy was one nobody could ever switch on. Paddle is now named.
  //    `frame-src` stays broad on purpose: the landing demo video's origin comes
  //    from NEXT_PUBLIC_DEMO_VIDEO, so it isn't knowable at build time.
  async headers() {
    // Paddle sandbox AYRI origin kullanır (sandbox-cdn / sandbox-buy ...). Canlı
    // production'da olsa da report-only politikanın sandbox testinde de doğru
    // olması gerekir, yoksa politika yalan söyler.
    const paddleScript = "https://cdn.paddle.com https://sandbox-cdn.paddle.com";
    const cspEnforced = [
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      // Aşağıdaki dördü de "bu uygulama bu özelliği HİÇ kullanmıyor" kanıtına
      // dayanıyor (kaynak taraması: src/ + public/ genelinde sıfır eşleşme), o
      // yüzden nonce altyapısı olmadan enforce edilebiliyorlar:
      //  · script-src-attr: satır-içi olay özniteliği (onclick="...") YOK — React
      //    olayları addEventListener ile bağlar. Enjekte edilen <img onerror=...>
      //    sınıfını script-src'yi enforce ETMEDEN kapatır. script-src'den bağımsız
      //    bir CSP3 direktifidir; desteklemeyen tarayıcı yok sayar.
      //  · worker-src: new Worker / SharedWorker / serviceWorker YOK.
      //  · manifest-src: rel="manifest" / .webmanifest YOK.
      //  · media-src: <video>/<audio>/new Audio YOK ('none' değil 'self' —
      //    ileride self-host bir mp4 eklenirse sessizce kırılmasın. Landing demo
      //    videosu <iframe>'dir, frame-src alanındadır.)
      "script-src-attr 'none'",
      "worker-src 'none'",
      "manifest-src 'none'",
      "media-src 'self'",
    ].join("; ");
    const cspReportOnly = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "script-src-attr 'none'",
      "worker-src 'none'",
      "manifest-src 'none'",
      "media-src 'self'",
      "img-src 'self' data: https:",
      `script-src 'self' 'unsafe-inline' ${paddleScript}`,
      // Paddle overlay EBEVEYN dokümana HARİCİ bir stylesheet enjekte ediyor;
      // 'unsafe-inline' harici <link> URL'ini KAPSAMAZ. Ayrıca public/urun.html
      // ve public/kurulum.html (landing iframe'i) Google Fonts'tan stylesheet
      // çekiyor. İkisi de yazılmazsa enforce günü overlay stilsiz açılır ve
      // ürün turu iframe'i bozulur — yani politika hâlâ açılamaz olurdu.
      `style-src 'self' 'unsafe-inline' ${paddleScript} https://fonts.googleapis.com`,
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.paddle.com",
      "frame-src 'self' https:",
    ].join("; ");
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Content-Security-Policy", value: cspEnforced },
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        ],
      },
      {
        // The public guest QR concierge URL carries a bearer token IN THE PATH.
        // Never leak it via the Referer header (not even to our own pages the
        // chat footer links to) — a leaked token = access to that apartment's chat.
        source: "/c/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // Şifre sıfırlama sayfası: e-postadaki bağlantı bir challenge TOKEN'ı
        // taşır. Token FRAGMENT'te durur (`#t=`) ve fragment zaten `Referer`'a
        // hiç girmez — bu başlık İKİNCİ savunmadır: sayfaya bir gün query'li bir
        // parametre (ör. `?next=`) eklenirse, global politika
        // (`strict-origin-when-cross-origin`) onu AYNI-ORIGIN gezinmelerde tam
        // URL olarak sızdırırdı. `no-referrer` bu yolu kapatır.
        // (Global kural `/(.*)` de eşleşir; Next'te SON eşleşen başlık kazanır —
        // `/c/:path*` emsalinin dayandığı davranışın aynısı.)
        source: "/sifremi-unuttum",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // E-posta dogrulama sayfasi: token FRAGMENT'te (#t=) gelir ve TEK
        // BASINA OTURUM BASAR. Fragment zaten `Referer`'a girmez; bu baslik
        // ikinci savunma (sayfaya bir gun query'li parametre eklenirse global
        // `strict-origin-when-cross-origin` onu tam URL olarak sizdirirdi).
        source: "/e-posta-dogrula",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // Brand assets are MEANT to be embedded by OTHER sites (Hospitable's OAuth
      // consent screen hotlinks the app logo; partner directories do the same).
      // The global CORP: same-site above makes browsers BLOCK exactly that
      // cross-origin <img> load — the consent screen showed a broken "Lixus AI
      // logo" box. These two public files opt back into cross-origin embedding
      // (last matching header wins in Next). Everything else stays same-site.
      ...["/lixus-logo.png", "/lixus-logo-icon.png"].map((source) => ({
        source,
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      })),
    ];
  },
  // Pin the workspace root to this project so Next doesn't pick a stray
  // package-lock.json in a parent directory (silences the "inferred workspace
  // root" multi-lockfile warning on dev start).
  outputFileTracingRoot: projectRoot,
  // ESLint is intentionally not configured for the MVP; type-checking via tsc still runs.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
    // Client Router Cache lifetime. Next 15 defaults DYNAMIC pages to 0s, which
    // turns every back/forward navigation ("← Mesajlar") into a full server
    // re-render — session check + Prisma queries + RSC stream on each click,
    // felt as sluggish paging. 30s serves recently visited pages instantly from
    // the client cache. Freshness stays correct: every mutating component in
    // the app calls router.refresh() (which purges this cache) and the inbox
    // runs a 30s AutoRefresh anyway — the window matches that cadence.
    staleTimes: { dynamic: 30 },
  },
  webpack: (config, { dev }) => {
    // Disable webpack's persistent filesystem cache for production builds. On CI
    // hosts that persist .next/cache across deploys (e.g. Railway's cache mount),
    // a stale cache left by an older/incompatible build can emit corrupt chunks
    // and break prerendering of the auto-generated /500 and /_error pages
    // ("<Html> should not be imported outside of pages/_document"). Compiling
    // fresh every production build avoids that whole class of failure; dev keeps
    // its fast-refresh cache.
    if (!dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
