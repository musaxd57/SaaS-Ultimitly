"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Operatör: ödemesi alınmış, aboneliği hesaba bağlanmamış kaydı SERBEST BIRAK (Codex 11-17). Kayıt durdukça müşteri yeniden ödeme
 * yapamaz (ikinci tahsilat olmasın diye); ödeme iade edildiyse / başka yoldan çözüldüyse operatör bırakır. API yalnız 2FA'lı operatör,
 * destek görünümünde kapalı, işlem denetimde.
 */
export function CheckoutReleaseButton({ intentId }: { intentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (
      !window.confirm(
        "Bu ödeme kaydı serbest bırakılsın mı? Müşteri yeniden ödeme yapabilir hâle gelir. Yalnız ödemeyi iade ettiyseniz ya da aboneliği başka yoldan çözdüyseniz bırakın.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/checkout-release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "İşlem yapılamadı.");
        return;
      }
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void run()}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Serbest bırak
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
