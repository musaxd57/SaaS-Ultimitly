"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { Button } from "@/components/ui/button";

// H2 (kurucu kararı 10-13 "Evet, düğme ekle"): kanal iptal edilmiş rezervasyonu yeniden etkin gösteriyorsa ev sahibi kanaldan doğruladıktan
// sonra rezervasyonu tek tıkla yeniden açar. Onay penceresi ŞART (geri alınabilir ama otomatik karşılama / giriş mesajları akışa girer).
export function ReactivateReservationButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onClick() {
    const ok = await confirmDialog({
      title: "Rezervasyon yeniden açılsın mı?",
      body: "Kanalda rezervasyonun gerçekten etkin olduğunu kontrol ettiyseniz açın. Otomatik karşılama ve giriş mesajları yeniden planlanır.",
      confirmLabel: "Yeniden aç",
    });
    if (!ok) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(reservationId)}/reactivate`, { method: "POST" });
      if (res.ok) {
        toast.success("Rezervasyon yeniden açıldı.");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? "Yeniden açılamadı. Sayfayı yenileyip tekrar deneyin.");
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    }
    setLoading(false);
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading} className="shrink-0">
      {loading ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
      Gerçekten etkin — yeniden aç
    </Button>
  );
}
