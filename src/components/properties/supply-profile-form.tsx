"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPLY_ITEMS } from "@/lib/constants";

/**
 * Per-property supply/linen profile editor: how many of each item ONE arrival
 * (turnover) consumes. Saved as { key: qty } to the property. Feeds the
 * deterministic prep/shopping plan on /hazirlik. Self-contained PATCH so it
 * doesn't touch the main property form.
 */
export function SupplyProfileForm({
  propertyId,
  initial,
  canManage = true,
}: {
  propertyId: string;
  initial: Record<string, number>;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of SUPPLY_ITEMS) m[it.key] = initial[it.key] ? String(initial[it.key]) : "";
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linen = SUPPLY_ITEMS.filter((i) => i.kind === "linen");
  const consumables = SUPPLY_ITEMS.filter((i) => i.kind === "consumable");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    // Send only positive quantities; empty/0 clears the item.
    const supplyProfile: Record<string, number> = {};
    for (const [k, v] of Object.entries(qty)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n > 0) supplyProfile[k] = n;
    }
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplyProfile }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Kaydedilemedi.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  const row = (it: (typeof SUPPLY_ITEMS)[number]) => (
    <label key={it.key} className="flex items-center justify-between gap-3 text-sm">
      <span>
        {it.label} <span className="text-xs text-muted-foreground">({it.unit})</span>
      </span>
      <input
        type="number"
        min={0}
        max={999}
        inputMode="numeric"
        value={qty[it.key]}
        disabled={!canManage}
        onChange={(e) => {
          setQty((q) => ({ ...q, [it.key]: e.target.value }));
          setSaved(false);
        }}
        className="h-9 w-20 rounded-md border border-border bg-background px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        placeholder="0"
      />
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Bir giriş (turnover) başına ortalama tüketim. Kaç misafir kaldığından bağımsızdır —
        her çıkışta yataklar komple toplanır. Boş/0 bıraktığınız kalem sayılmaz.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Çamaşır / Tekstil</p>
          {linen.map(row)}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sarf Malzeme</p>
          {consumables.map(row)}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canManage ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Kaydet
          </Button>
          {saved ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
              <Check className="size-4" /> Kaydedildi
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Malzeme profili yalnızca sahip/yönetici tarafından düzenlenebilir.
        </p>
      )}
    </form>
  );
}
