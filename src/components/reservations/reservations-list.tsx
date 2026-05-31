"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { RESERVATION_CHANNEL, RESERVATION_STATUS } from "@/lib/constants";

export interface ReservationRow {
  id: string;
  guestName: string;
  propertyName: string;
  arrivalLabel: string;
  departureLabel: string;
  channel: string;
  status: string;
  amountLabel: string;
}

export function ReservationsList({ items }: { items: ReservationRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function updateStatus(id: string, status: string) {
    setBusyId(id);
    await fetch(`/api/reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!window.confirm("Bu rezervasyonu silmek istediğinize emin misiniz?")) return;
    setBusyId(id);
    await fetch(`/api/reservations/${id}`, { method: "DELETE" });
    setBusyId(null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="hidden grid-cols-12 gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid">
        <span className="col-span-3">Misafir</span>
        <span className="col-span-3">Mülk</span>
        <span className="col-span-2">Tarihler</span>
        <span className="col-span-1">Kanal</span>
        <span className="col-span-2">Durum</span>
        <span className="col-span-1 text-right">İşlem</span>
      </div>
      <div className="divide-y divide-border">
        {items.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-12 sm:items-center sm:gap-3"
          >
            <div className="sm:col-span-3">
              <p className="text-sm font-medium">{r.guestName}</p>
              <p className="text-xs text-muted-foreground">{r.amountLabel}</p>
            </div>
            <div className="text-sm text-muted-foreground sm:col-span-3">{r.propertyName}</div>
            <div className="text-xs text-muted-foreground sm:col-span-2">
              {r.arrivalLabel} → {r.departureLabel}
            </div>
            <div className="sm:col-span-1">
              <Badge tone={RESERVATION_CHANNEL.tone(r.channel)}>
                {RESERVATION_CHANNEL.label(r.channel)}
              </Badge>
            </div>
            <div className="sm:col-span-2">
              <Select
                value={r.status}
                disabled={busyId === r.id}
                onChange={(e) => updateStatus(r.id, e.target.value)}
                className="h-8 text-xs"
              >
                {RESERVATION_STATUS.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center justify-end sm:col-span-1">
              <button
                onClick={() => remove(r.id)}
                disabled={busyId === r.id}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                aria-label="Sil"
              >
                {busyId === r.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
