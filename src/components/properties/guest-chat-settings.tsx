"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner/manager control to turn the public guest QR concierge on/off for one
 * apartment and copy the link to embed in the printed QR. Only rendered when
 * the global GUEST_CHAT_ENABLED switch is on (the page gates it), so it never
 * appears before the operator has opted the whole feature in.
 */
export function GuestChatSettings({
  propertyId,
  enabled,
  url,
}: {
  propertyId: string;
  enabled: boolean;
  url: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setError("İşlem başarısız oldu. Lütfen tekrar deneyin.");
        return;
      }
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable — the URL is selectable in the field */
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Dairenin içine asacağın QR'ı okutan misafir, bilgi tabanından genel sorularını yapay zekâya
        sorar; çözülemeyen konu sana mesaj olarak düşer. Güvenlik için kapı kodu/Wi-Fi burada
        paylaşılmaz.
      </p>

      <button
        type="button"
        onClick={() => void toggle(!enabled)}
        disabled={busy}
        className={
          enabled
            ? "inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
            : "inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        }
      >
        {busy ? "…" : enabled ? "Misafir chat'i kapat" : "Misafir chat'i aç"}
      </button>

      {enabled && url ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Misafir bağlantısı (QR'a göm):</p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-border bg-muted px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent"
            >
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
