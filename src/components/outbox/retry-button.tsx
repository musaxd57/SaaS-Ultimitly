"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Tenant-bound manual retry for ONE definitively-failed outbox row. Rendered
 * ONLY next to rows the server already judged retryable (`failed`, not 402) —
 * the server route re-checks the same guard, so a stale button can't force a
 * send: it just gets a 409 and the list refreshes to the true state.
 */
export function OutboxRetryButton({ outboxId }: { outboxId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/outbox/${outboxId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Yeniden kuyruğa alınamadı.");
      }
      // Refresh on success AND on 409 — either way the row's real state changed
      // (or was never what the stale page showed), so re-render from the server.
      startTransition(() => router.refresh());
    } catch {
      setError("Bağlantı hatası — tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  const working = busy || isPending;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={retry} disabled={working}>
        {working ? <Loader2 className="mr-1 size-3 animate-spin" /> : <RotateCcw className="mr-1 size-3" />}
        Yeniden dene
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
