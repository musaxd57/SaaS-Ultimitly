"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";

// ---------------------------------------------------------------------------
// "Bu dairenin temizlikçisi" (kurucu 11-05 gece): bir kez seçilir, sonraki temizlikler kabul beklemeden o kişinin iş listesine düşer.
// Kişi değişince ESKİ kişide duran başlanmamış gelecekteki temizlikler için AÇIK soru sorulur (gizli toplu değişiklik yok).
// ---------------------------------------------------------------------------

export function DefaultCleanerForm({
  propertyId,
  propertyName,
  currentUserId,
  members,
  openFutureCount,
}: {
  propertyId: string;
  propertyName: string;
  currentUserId: string | null;
  members: { id: string; name: string }[];
  /** Şu anki temizlikçide duran başlanmamış gelecekteki temizlik sayısı. */
  openFutureCount: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentUserId ?? "");
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    const nextName = members.find((m) => m.id === next)?.name ?? null;
    let moveOpen = false;
    if (currentUserId && next && next !== currentUserId && openFutureCount > 0) {
      moveOpen = await confirmDialog({
        title: `${propertyName}'in gelecekteki ${openFutureCount} açık temizliği de ${nextName ?? "yeni kişi"} adına geçsin mi?`,
        body: "Başlanmamış ve sistemin açtığı temizlikler taşınır. Başlanmış ya da elle atanmış işlere dokunulmaz.",
        confirmLabel: "Evet, geçsin",
        cancelLabel: "Hayır, yalnız yeniler",
      });
    }
    setBusy(true);
    const before = value;
    setValue(next);
    try {
      const res = await fetch(`/api/properties/${propertyId}/default-cleaner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: next || null, moveOpen }),
      });
      if (!res.ok) {
        setValue(before);
        const data = (await res.json().catch(() => null)) as { error?: string; fields?: { userId?: string } } | null;
        toast.error(data?.fields?.userId ?? data?.error ?? "Kaydedilemedi. Lütfen tekrar deneyin.");
        return;
      }
      toast.success(next ? "Kaydedildi. Sonraki temizlikler bu kişiye atanacak." : "Kaydedildi. Temizlikler atanmadan açılacak.");
      router.refresh();
    } catch {
      setValue(before);
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Select
        value={value}
        disabled={busy}
        onChange={(e) => void save(e.target.value)}
        className="h-9 text-sm"
        aria-label="Bu dairenin temizlikçisi"
      >
        <option value="">Kimse (görevler atanmadan açılır)</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <p className="text-xs text-muted-foreground">Yeni rezervasyonun temizliği kabul beklemeden bu kişinin iş listesine düşer.</p>
    </div>
  );
}
