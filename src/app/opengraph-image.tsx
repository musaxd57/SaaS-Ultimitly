import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Lixus AI — Airbnb & Booking için AI Misafir Asistanı";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// ---------------------------------------------------------------------------
// Real social-share card (Codex #39). Rendered ONCE at build time (static
// route). Everything on it is existing, verified product content:
//   * headline + badge = the landing hero copy (landing-page.tsx),
//   * the right-hand panel = the landing's honest 3-tier scenario cards
//     (DEMO_SCENARIOS / TIER_META) — real guest questions, real tier labels,
//   * NO invented customers, quotes or usage numbers (copy-honesty rule).
// Fonts: Inter v3.19 (OFL, assets/og/ + LICENSE) — the site's own typeface,
// loaded explicitly because the default bundled font lacks Turkish ş/ğ/ı.
// ---------------------------------------------------------------------------

const BLUE = "#60a5fa"; // landing accent hsl(213 94% 68%)
const MUTED = "#9fb0cc";

const interRegular = readFile(join(process.cwd(), "assets", "og", "Inter-Regular.woff"));
const interSemiBold = readFile(join(process.cwd(), "assets", "og", "Inter-SemiBold.woff"));

// The landing hero headline, split so "7/24, güvenle" carries the accent color
// (same emphasis as the hero). Word-spans + flex-wrap: satori-safe inline flow.
const HEADLINE: { text: string; accent?: boolean }[] = [
  { text: "Misafir" },
  { text: "mesajlarını" },
  { text: "7/24,", accent: true },
  { text: "güvenle", accent: true },
  { text: "yanıtlayan" },
  { text: "yapay" },
  { text: "zekâ." },
];

// Real scenario messages + tier labels from the landing (landing-page.tsx).
const TIERS: { message: string; label: string; dot: string; chipBg: string; chipText: string }[] = [
  {
    message: "“Merhaba, wifi şifresi nedir?”",
    label: "Anında yanıtlar",
    dot: "#10b981",
    chipBg: "#d1fae5",
    chipText: "#065f46",
  },
  {
    message: "“Ev çok soğuk, hiç memnun kalmadık.”",
    label: "Yatıştırır + bilgi toplar",
    dot: "#eab308",
    chipBg: "#fef9c3",
    chipText: "#854d0e",
  },
  {
    message: "“Daire hiç temiz değildi, iade istiyorum.”",
    label: "Durur, size bırakır",
    dot: "#f59e0b",
    chipBg: "#ffedd5",
    chipText: "#9a3412",
  },
];

export default async function OpengraphImage() {
  const [regular, semibold] = await Promise.all([interRegular, interSemiBold]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "56px 64px",
          background: "linear-gradient(135deg, #141d33 0%, #1b2740 55%, #223259 100%)",
          fontFamily: "Inter",
        }}
      >
        {/* Left: brand + headline (real hero copy). FIXED width — flex-grow let the
            unbreakable chip text push the card past the 1200px canvas edge. */}
        <div style={{ display: "flex", flexDirection: "column", width: 616 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 76,
                height: 76,
                borderRadius: 20,
                background: "rgba(96,165,250,0.16)",
                border: "1px solid rgba(148,197,253,0.35)",
              }}
            >
              {/* BrandMark — the apartment-tower glyph (src/components/brand.tsx / icon.svg) */}
              <svg viewBox="0 0 32 32" width="48" height="48" fill="none">
                <path d="M9 23V11.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V23" stroke="#eaf1fd" strokeWidth="1.7" strokeLinejoin="round" />
                <path d="M18 15.5h4a1 1 0 0 1 1 1V23" stroke="#eaf1fd" strokeWidth="1.7" strokeLinejoin="round" />
                <path d="M7 23h18" stroke="#eaf1fd" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M11.5 14h3M11.5 17h3M20.5 18.5h0.01" stroke="#eaf1fd" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ display: "flex", marginLeft: 22, fontSize: 46, fontWeight: 600, letterSpacing: -1 }}>
              <span style={{ color: "#f8fafc" }}>Lixus</span>
              <span style={{ color: BLUE, marginLeft: 12 }}>AI</span>
            </div>
          </div>

          <div style={{ display: "flex", marginTop: 30, fontSize: 23, color: MUTED }}>
            Airbnb &amp; Booking ev sahipleri için yapay zekâ asistanı
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", marginTop: 16, maxWidth: 616 }}>
            {HEADLINE.map((w, i) => (
              <span
                key={i}
                style={{
                  fontSize: 51,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  letterSpacing: -1,
                  color: w.accent ? BLUE : "#f8fafc",
                  marginRight: 14,
                }}
              >
                {w.text}
              </span>
            ))}
          </div>

          {/* Real trust chips from the landing (no absolute claims) */}
          <div style={{ display: "flex", marginTop: 34, alignItems: "center" }}>
            {["KVKK odaklı tasarım", "Şikayeti otomatik sonuçlandırmaz"].map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  fontSize: 18,
                  color: "#cdd9ee",
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 999,
                  padding: "7px 16px",
                  marginRight: 14,
                }}
              >
                {chip}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", marginTop: 26, fontSize: 22, color: MUTED }}>www.lixusai.com</div>
        </div>

        {/* Right: the honest 3-tier model (real landing scenario cards) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 392,
            flexShrink: 0,
            background: "#f8fafc",
            borderRadius: 26,
            padding: "26px 28px",
            boxShadow: "0 18px 50px rgba(4,10,26,0.45)",
          }}
        >
          <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: "#64748b", letterSpacing: 2 }}>
            MİSAFİR MESAJI → AI KARARI
          </div>
          {TIERS.map((t, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 18,
                paddingTop: i === 0 ? 4 : 18,
                borderTop: i === 0 ? "none" : "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", fontSize: 21, color: "#0e1425", lineHeight: 1.3 }}>{t.message}</div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
                <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: t.dot }} />
                <div
                  style={{
                    display: "flex",
                    marginLeft: 10,
                    fontSize: 16,
                    fontWeight: 600,
                    color: t.chipText,
                    background: t.chipBg,
                    borderRadius: 999,
                    padding: "5px 14px",
                  }}
                >
                  {t.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}
