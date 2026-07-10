"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPLY_ITEMS } from "@/lib/constants";

/**
 * Org-level on-hand supply stock editor (collapsible). What the host currently has
 * in storage; the prep plan subtracts it and shows the NET amount to buy. Optional —
 * leaving everything 0/blank means the plan shows the gross need (today's behavior).
 */
export function SupplyStockForm({ initial }: { initial: Record<string, number> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of SUPPLY_ITEMS) m[it.key] = initial[it.key] ? String(initial[it.key]) : "";
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filledCount = Object.values(initial).filter((v) => v > 0).length;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const stock: Record<string, number> = {};
    for (const [k, v] of Object.entries(qty)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n > 0) stock[k] = n;
    }
    try {
      const res = await fetch("/api/hazirlik/stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock }),
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

  return (
    <div className="mb-4 rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
      >
        <span className="flex items-center gap-2 font-medium">
          <Boxes className="size-4 text-muted-foreground" /> Eldeki stok
        </span>
        <span className="text-xs text-muted-foreground">
          {filledCount > 0 ? `${filledCount} kalem girili · ` : "opsiyonel · "}
          {open ? "gizle" : "düzenle"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border p-3">
          <p className="mb-3 text-xs text-muted-foreground">
            Depoda hâlihazırda olan miktarları girin; liste “net alınacak”ı (ihtiyaç − elde) gösterir.
            Aldıkça/harcadıkça bu sayıları güncelleyin. Boş bırakırsanız brüt ihtiyaç görünür.
          </p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {SUPPLY_ITEMS.map((it) => (
              <label key={it.key} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {it.label} <span className="text-xs text-muted-foreground">({it.unit})</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  inputMode="numeric"
                  value={qty[it.key]}
                  onChange={(e) => {
                    setQty((q) => ({ ...q, [it.key]: e.target.value }));
                    setSaved(false);
                  }}
                  className="h-9 w-24 rounded-md border border-border bg-background px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="0"
                />
              </label>
            ))}
          </div>
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          <div className="mt-3 flex items-center gap-3">
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Stoğu kaydet
            </Button>
            {saved ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check className="size-4" /> Kaydedildi
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
