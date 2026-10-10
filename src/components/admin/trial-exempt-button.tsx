"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Operatör: DENEMEYİ GERİ VER (deneme kimliği istisnası; kurucu onayı 10-10). Aynı ilan / takvim başka hesapta görüldüğü için denemesi
 * biten kuruluşta meşru durum varsa (ilan yeni sahibe geçti vb.) — kuruluş kimlik kuralından muaf olur, deneme yeniden başlar. API yalnız
 * 2FA'lı operatör, her işlem denetim kaydında.
 */
export function TrialExemptButton({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exempt() {
    if (!window.confirm("Bu işletmenin denemesi yeniden başlasın ve ilan kontrolünden muaf tutulsun mu?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/trial-identity-exempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) {
        setError("İşlem yapılamadı.");
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
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void exempt()}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Denemeyi geri ver
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
