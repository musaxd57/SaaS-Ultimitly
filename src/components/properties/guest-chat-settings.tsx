"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import { Download } from "lucide-react";

/**
 * Owner/manager control to turn the public guest QR concierge on/off for one
 * apartment, copy the link, and download a STATIC QR (encodes the link directly,
 * generated client-side → no third party, no expiry, never leaves the browser).
 * Only rendered when the global GUEST_CHAT_ENABLED switch is on.
 */
export function GuestChatSettings({
  propertyId,
  propertyName,
  enabled,
  url,
  pinFeatureEnabled = false,
  strictMode = false,
}: {
  propertyId: string;
  propertyName: string;
  enabled: boolean;
  url: string | null;
  /** Faz 5: whether the QR PIN feature is on (env). Shows the strict-mode toggle. */
  pinFeatureEnabled?: boolean;
  /** Org-wide: require a PIN for EVERY stay (not just those with a generated PIN). */
  strictMode?: boolean;
}) {
  const router = useRouter();
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [strict, setStrict] = useState(strictMode);
  const [strictBusy, setStrictBusy] = useState(false);

  async function toggleStrict(next: boolean) {
    setStrictBusy(true);
    setError(null);
    const prev = strict;
    setStrict(next); // optimistic
    try {
      const res = await fetch(`/api/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qrChatPinRequired: next }),
      });
      if (!res.ok) {
        setStrict(prev);
        setError("Ayar kaydedilemedi. Lütfen tekrar deneyin.");
      }
    } catch {
      setStrict(prev);
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setStrictBusy(false);
    }
  }

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

  async function resetBinding() {
    if (resetting) return;
    setResetting(true);
    setError(null);
    setResetDone(false);
    try {
      const res = await fetch(`/api/properties/${propertyId}/reset-chat`, { method: "POST" });
      if (!res.ok) {
        setError("Sıfırlama başarısız oldu. Lütfen tekrar deneyin.");
        return;
      }
      setResetDone(true);
      setTimeout(() => setResetDone(false), 3000);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setResetting(false);
    }
  }

  function downloadQr() {
    const canvas = qrRef.current; // the hidden 1024px canvas → crisp print resolution
    if (!canvas) return;
    const slug =
      propertyName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "daire";
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `lixus-qr-${slug}.png`;
    a.click();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Dairenin içine asacağınız QR'ı okutan misafir, bilgi tabanından genel sorularını yapay zekâya
        sorar; çözülemeyen konu size mesaj olarak düşer. Güvenlik için kapı kodu/Wi-Fi burada
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
        {busy ? "…" : enabled ? "Misafir sohbetini kapat" : "Misafir sohbetini aç"}
      </button>

      {enabled && url ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Misafir bağlantısı:</p>
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

          <div className="flex flex-col items-start gap-2 pt-1">
            <QRCodeCanvas
              value={url}
              size={184}
              level="M"
              marginSize={2}
              className="rounded-md border border-border bg-white p-2"
            />
            {/* Hidden hi-res copy (1024px) — used only for a crisp printable download. */}
            <QRCodeCanvas
              ref={qrRef}
              value={url}
              size={1024}
              level="M"
              marginSize={2}
              className="hidden"
            />
            <button
              type="button"
              onClick={downloadQr}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="size-4" /> QR'ı indir (PNG)
            </button>
            <p className="text-[11px] text-muted-foreground">
              Statik ve süresiz QR — bir kez yazdırıp daireye asın, güncellemeye gerek kalmaz.
            </p>
          </div>

          <div className="mt-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => void resetBinding()}
              disabled={resetting}
              className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {resetting ? "…" : "Sohbet cihaz kilidini sıfırla"}
            </button>
            {resetDone ? <span className="ml-2 text-xs text-emerald-600">Sıfırlandı</span> : null}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sohbet, her konaklamada onu ilk açan cihaza kilitlenir (güvenlik). Misafir telefonunu
              değiştirdi veya sohbete erişemiyorsa kilidi sıfırlayın; misafir tekrar açtığında yeni cihaz
              bağlanır.
            </p>
          </div>

          {pinFeatureEnabled ? (
            <div className="mt-2 border-t border-border pt-3">
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={strict}
                  disabled={strictBusy}
                  onChange={(e) => void toggleStrict(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-input"
                />
                <span>
                  <span className="font-medium text-foreground">Tüm konaklamalarda giriş kodu zorunlu</span>{" "}
                  <span className="text-muted-foreground">(işletme geneli)</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Açıkken her rezervasyon için misafir, ev sahibinin verdiği giriş kodunu girmeden sohbeti
                    açamaz. Kod oluşturmadığınız rezervasyonlarda sohbet kilitli kalır. Kapalıyken yalnızca
                    kod oluşturduğunuz rezervasyonlarda kod istenir.
                  </span>
                </span>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
