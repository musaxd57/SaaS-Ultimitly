"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Mülk Hafızası kartında OLASI ÇELİŞKİ uyarıları (değişmez 13; kurucu 10-11). Yalnız ev sahibine; "Bilerek böyle" işaretler, uyarı kalkar.
export interface ContradictionItem {
  memoryIds: string[];
  text: string;
}

export function MemoryContradictions({ propertyId, items }: { propertyId: string; items: ContradictionItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function acknowledge(index: number, memoryIds: string[]) {
    setBusy(index);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/memory-acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryIds }),
      });
      if (!res.ok) {
        setError("İşaretlenemedi. Tekrar deneyin.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2" data-testid="memory-contradictions">
      {items.map((c, i) => (
        <div key={c.memoryIds.join(",") + i} className="flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">{c.text}</span>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => acknowledge(i, c.memoryIds)}>
            Bilerek böyle
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
