"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Operatör: riskli deneme listesinde DENEMEYİ BİTİR / GERİ VER (kurucu Q4, 10-17). Bitirilen hesap kapanmaz; müşteri ayarlarda sebepsiz
 * onaylı metni görür. API yalnız 2FA'lı operatör, destek görünümünde kapalı, her işlem denetimde.
 */
export function TrialEndButton({ organizationId, mode }: { organizationId: string; mode: "end" | "restore" | "card_exempt" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const question =
      mode === "end"
        ? "Bu işletmenin ücretsiz denemesi şimdi bitirilsin mi? Hesap kapanmaz; otomatik mesajlar durur, müşteri plan seçerek devam edebilir."
        : mode === "restore"
          ? "Bu işletmeye bugünden başlayan yeni bir deneme süresi verilsin mi?"
          : "Bu işletmeden kart istenmesin mi? Otomatik işler hemen açılır ve işletme bundan sonra kart kontrolünden muaf olur.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/trial-end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action: mode }),
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
        {mode === "end" ? "Denemeyi bitir" : mode === "restore" ? "Denemeyi geri ver" : "Kart şartını kaldır"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
