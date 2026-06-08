import { ImageResponse } from "next/og";

export const alt = "Lixus AI — Airbnb & Booking için AI Misafir Asistanı";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Auto-generated social-share card (no image file needed).
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "90px",
          background: "#1b2740",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 70, fontWeight: 700, letterSpacing: -1 }}>Lixus AI</div>
        <div style={{ fontSize: 42, marginTop: 28, color: "#dbe3f0", maxWidth: 940, lineHeight: 1.25 }}>
          Misafirlerinize 7/24, kendi dillerinde, insan gibi cevap veren yapay zekâ
        </div>
        <div style={{ fontSize: 28, marginTop: 44, color: "#9fb0cc" }}>
          Airbnb & Booking ev sahipleri için
        </div>
      </div>
    ),
    { ...size },
  );
}
