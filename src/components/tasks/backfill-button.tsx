"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Recovery action: create the standard check-in/cleaning tasks for any reservation
 * that doesn't have them yet. New Hospitable/iCal/manual bookings now auto-create
 * tasks, so the page only shows this button when `count > 0` (reservations still
 * missing tasks). Idempotent and safe to re-run.
 */
export function BackfillTasksButton({ count }: { count?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/tasks/backfill", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const created: number = data?.created ?? 0;
        window.alert(
          created > 0
            ? `${created} görev oluşturuldu.`
            : "Yeni görev oluşturulmadı — tüm rezervasyonların görevleri zaten var veya geçmiş tarihli.",
        );
        router.refresh();
      } else {
        window.alert("Görevler oluşturulamadı.");
      }
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
      {count ? `Eksik görevleri oluştur (${count})` : "Eksik görevleri oluştur"}
    </Button>
  );
}
