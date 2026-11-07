"use client";

import { useState } from "react";

/**
 * Beklenmeyen hata ekranındaki takip numarasının TAMAMINI panoya kopyalar (kurucu kararı 10-10 §5: "kısa biçim ekranda, tamamı 'kopyala'
 * ile panoya"). Ekranda zaten kısa numara yazılı; düğme yalnız tam numarayı taşır.
 */
export function TrackingNumberCopy({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
        } catch {
          /* pano izni yok — kısa numara ekranda yazılı */
        }
      }}
    >
      {copied ? "Takip numarası kopyalandı" : "Takip numarasını kopyala"}
    </button>
  );
}
