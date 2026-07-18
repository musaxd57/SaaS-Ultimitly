"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Loader2 } from "lucide-react";

// KVKK guest-level explicit erasure (m40) — per-reservation host control.
// Two-step: preview the scope (counts) → explicit confirm → irreversible scrub.
// Copy is deliberately HONEST: our copy is anonymized + tombstoned; the channel's
// (Airbnb/Hospitable) copy is NOT ours to delete, and the legal clock is 30 days.

interface Scope {
  conversations: number;
  inboundMessages: number;
  outboundMessages: number;
  tombstoneKeys: number;
}

export function GuestErasureControl({
  reservationId,
  initialErased,
}: {
  reservationId: string;
  initialErased: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "loading" | "confirm" | "working" | "done">(
    initialErased ? "done" : "idle",
  );
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setError(null);
    setPhase("loading");
    try {
      const res = await fetch(`/api/reservations/${reservationId}/erase`);
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { scope: Scope };
      setScope(json.scope);
      setPhase("confirm");
    } catch {
      setError("Kapsam alınamadı, tekrar deneyin.");
      setPhase("idle");
    }
  }

  async function execute() {
    setError(null);
    setPhase("working");
    try {
      const res = await fetch(`/api/reservations/${reservationId}/erase`, { method: "POST" });
      if (!res.ok) throw new Error();
      setPhase("done");
      router.refresh();
    } catch {
      setError("Silme tamamlanamadı, tekrar deneyin.");
      setPhase("confirm");
    }
  }

  if (phase === "done") {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        KVKK: misafir verisi kalıcı olarak anonimleştirildi (senkron geri getiremez).
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-1.5">
      {phase === "idle" || phase === "loading" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs text-destructive"
          disabled={phase === "loading"}
          onClick={loadPreview}
        >
          {phase === "loading" ? <Loader2 className="size-3 animate-spin" /> : <ShieldAlert className="size-3" />}
          KVKK: misafiri kalıcı sil
        </Button>
      ) : null}

      {phase === "confirm" || phase === "working" ? (
        <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <p className="font-medium text-destructive">
            Geri alınamaz: misafirin adı/iletişim bilgileri ve {scope?.inboundMessages ?? 0} misafir
            mesajının içeriği anonimleştirilir ({scope?.conversations ?? 0} konuşma; ev sahibi
            kayıtlarında yalnız ad redakte edilir).
          </p>
          <p className="text-muted-foreground">
            Senkron bu veriyi bir daha İÇERİ ALMAZ (kalıcı koruma kaydı). Airbnb/Hospitable&apos;daki
            kopyayı Lixus silemez — misafir kanala ayrıca başvurmalıdır. Yasal süre: talepten
            itibaren 30 gün.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              disabled={phase === "working"}
              onClick={execute}
            >
              {phase === "working" ? <Loader2 className="size-3 animate-spin" /> : null}
              Evet, kalıcı anonimleştir
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={phase === "working"}
              onClick={() => setPhase("idle")}
            >
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
