"use client";

import { useState } from "react";
import { Plug, Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Verifies the Hospitable API connection (token + property access) and shows
 * the result inline. A one-click setup check — nothing is sent or changed.
 */
export function HospitableTestButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/hospitable/test");
      const data = await res.json();
      setResult(
        data.ok
          ? { ok: true, text: `Bağlandı · ${data.count} mülk` }
          : { ok: false, text: data.error ?? "Bağlantı başarısız" },
      );
    } catch {
      setResult({ ok: false, text: "İstek gönderilemedi" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={test}
        disabled={busy}
        title="Hospitable API bağlantısını test et (token + mülk erişimi)"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
        Hospitable testi
      </button>
      {result ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium",
            result.ok ? "text-emerald-600" : "text-destructive",
          )}
        >
          {result.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          {result.text}
        </span>
      ) : null}
    </div>
  );
}
