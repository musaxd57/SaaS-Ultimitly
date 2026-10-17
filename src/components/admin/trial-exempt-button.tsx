"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Operatör: deneme kimliği istisnası (kurucu onayı 10-10). Aynı ilan / takvim başka hesapta görüldüyse ve meşru bir durum varsa (ilan yeni
 * sahibe geçti vb.) kuruluş kimlik kuralından muaf olur. İki hâl (Haiku 10-17): K1-B işareti (`flag`, deneme zaten sürüyor) → "İşareti
 * kaldır"; ESKİ kuralla biten deneme (`ended`) → "Denemeyi geri ver" (yeni deneme süresi). API yalnız 2FA'lı operatör, her işlem denetimde.
 */
export function TrialExemptButton({ organizationId, mode }: { organizationId: string; mode: "flag" | "ended" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exempt() {
    const question =
      mode === "ended"
        ? "Bu işletmenin denemesi yeniden başlasın ve ilan kontrolünden muaf tutulsun mu?"
        : "İşaret kaldırılsın ve bu işletme ilan kontrolünden muaf tutulsun mu? (Deneme zaten sürüyor; süresi değişmez.)";
    if (!window.confirm(question)) return;
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
        {mode === "ended" ? "Denemeyi geri ver" : "İşareti kaldır"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
