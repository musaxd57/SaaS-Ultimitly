"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPLY_ITEMS } from "@/lib/constants";

/**
 * Per-property supply/linen profile editor: how many of each item ONE arrival
 * (turnover) consumes. Saved as { key: qty } to the property. Feeds the
 * deterministic prep/shopping plan on /hazirlik. Self-contained PATCH so it
 * doesn't touch the main property form. Can also copy the current values to any
 * selected subset of the org's apartments (a host with 20 identical flats fills
 * it once).
 */
export function SupplyProfileForm({
  propertyId,
  initial,
  canManage = true,
  siblings = [],
}: {
  propertyId: string;
  initial: Record<string, number>;
  canManage?: boolean;
  /** All of the org's properties (id + name) — the copy-to targets. */
  siblings?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of SUPPLY_ITEMS) m[it.key] = initial[it.key] ? String(initial[it.key]) : "";
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Which apartments to copy to. Default: every apartment (incl. this one) selected.
  const [targets, setTargets] = useState<Set<string>>(() => new Set(siblings.map((s) => s.id)));

  const linen = SUPPLY_ITEMS.filter((i) => i.kind === "linen");
  const consumables = SUPPLY_ITEMS.filter((i) => i.kind === "consumable");

  /** Current form values as a { key: qty>0 } object. */
  function currentProfile(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(qty)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  }

  function toggleTarget(id: string) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setApplied(null);
  }

  const allSelected = siblings.length > 0 && targets.size === siblings.length;
  function toggleAll() {
    setTargets(allSelected ? new Set() : new Set(siblings.map((s) => s.id)));
    setApplied(null);
  }

  // Copy the current values to the SELECTED apartments (overwrites their profiles).
  async function applyToSelected() {
    if (busy || targets.size === 0) return;
    const many = targets.size > 1;
    if (!confirm(`Bu profil seçili ${targets.size} daireye uygulanacak ve mevcut profil${many ? "lerinin" : "inin"} yerini alacak. Emin misiniz?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    setApplied(null);
    try {
      const res = await fetch("/api/properties/bulk-supply-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplyProfile: currentProfile(), propertyIds: [...targets] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setApplied(typeof data.updated === "number" ? data.updated : null);
        setPicking(false);
        router.refresh();
      } else {
        setError(data.error ?? "Uygulanamadı.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    setApplied(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplyProfile: currentProfile() }),
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
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Kaydet
            </Button>
            {siblings.length > 1 ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPicking((p) => !p)}>
                <Copy className="size-4" /> Dairelere kopyala
              </Button>
            ) : null}
            {saved ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check className="size-4" /> Kaydedildi
              </span>
            ) : null}
            {applied !== null ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check className="size-4" /> {applied} daireye uygulandı
              </span>
            ) : null}
          </div>

          {picking && siblings.length > 1 ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Hangi dairelere kopyalansın?</p>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {allSelected ? "Tümünü kaldır" : "Tümünü seç"}
                </button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {siblings.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={targets.has(s.id)}
                      onChange={() => toggleTarget(s.id)}
                    />
                    <span className="truncate">
                      {s.name}
                      {s.id === propertyId ? <span className="text-xs text-muted-foreground"> (bu daire)</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <Button type="button" size="sm" disabled={busy || targets.size === 0} onClick={applyToSelected}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                  Seçili {targets.size} daireye uygula
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Malzeme profili yalnızca sahip/yönetici tarafından düzenlenebilir.
        </p>
      )}
    </form>
  );
}
