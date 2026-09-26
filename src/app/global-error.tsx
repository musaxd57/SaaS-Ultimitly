"use client";

import { useEffect } from "react";

/**
 * Son çare hata sınırı: kök layout'un KENDİSİ patladığında devreye girer ve
 * kendi <html>/<body>'sini render etmek ZORUNDADIR (kök layout render
 * edilemediği için).
 *
 * Bu dosya yokken Next'in yerleşik ekranı basılıyordu: İngilizce, markasız,
 * "Application error: a client-side exception has occurred". Türk host için
 * hem anlaşılmaz hem de ürünün dışında görünüyordu.
 *
 * Buraya hiçbir uygulama bileşeni (Card/Button/Tailwind sınıfları) İTHAL
 * EDİLMEZ: kök layout patladıysa global stil de yüklenmemiş olabilir, o yüzden
 * stiller satır içidir. Ham hata metni gösterilmez; yalnız destek digest'i.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kök hata:", error?.digest ?? "digest yok");
  }, [error]);

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#ffffff",
          color: "#0f172a",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
            Lixus AI
          </p>
          <h1 style={{ margin: "0.75rem 0 0.5rem", fontSize: "1.25rem", fontWeight: 600 }}>
            Bir şeyler ters gitti
          </h1>
          <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.6, color: "#475569" }}>
            Uygulama beklenmedik bir hatayla karşılaştı. Sayfayı yenilemeyi deneyin; sorun sürerse
            bize bildirin.
          </p>
          {error?.digest ? (
            <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#64748b" }}>
              Destek referansı: <span style={{ fontFamily: "ui-monospace, monospace" }}>{error.digest}</span>
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "none",
              background: "#0f172a",
              color: "#ffffff",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
