"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * On-demand AI summary of the prep plan. Button-triggered so the model's latency
 * (akashML/GLM ~several seconds) never blocks the page render. Shown only when the
 * env has an AI provider configured. Cosmetic: the deterministic list stands alone.
 */
export function SupplyAiSummary({ days, enabled }: { days: number; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/hazirlik/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSummary(data.summary ?? null);
        if (!data.summary) setError("Bu aralıkta özetlenecek bir ihtiyaç yok.");
      } else {
        // Include the (redacted) upstream reason so a wrong model id / key is visible.
        setError(data.detail ? `${data.error ?? "Özet oluşturulamadı."} (${data.detail})` : data.error ?? "Özet oluşturulamadı.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Yapay zekâ özeti</p>
        <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {busy ? "Yazılıyor…" : summary ? "Yeniden özetle" : "AI özeti oluştur"}
        </Button>
      </div>
      {busy ? (
        <p className="mt-2 text-xs text-muted-foreground">Birkaç saniye sürebilir…</p>
      ) : null}
      {summary ? <p className="mt-2 whitespace-pre-wrap text-sm">{summary}</p> : null}
      {error ? <p className="mt-2 text-sm text-muted-foreground">{error}</p> : null}
    </div>
  );
}
