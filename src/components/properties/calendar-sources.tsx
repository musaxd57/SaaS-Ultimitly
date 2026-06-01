"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2, Plus, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fromNow } from "@/lib/utils";

export interface CalendarSourceRow {
  id: string;
  label: string;
  url: string;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastResult: string | null;
}

interface Props {
  propertyId: string;
  sources: CalendarSourceRow[];
}

/**
 * Manage external iCal subscriptions (Airbnb, Booking.com …) for a property.
 * Reservations are pulled in on demand via the per-source "Senkronla" button.
 */
export function CalendarSources({ propertyId, sources }: Props) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addSource() {
    setError(null);
    if (label.trim().length < 2 || !/^https?:\/\/.+/i.test(url.trim())) {
      setError("Kaynak adı ve geçerli bir http(s) bağlantısı gerekli.");
      return;
    }
    setAdding(true);
    const res = await fetch(`/api/properties/${propertyId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), url: url.trim() }),
    });
    setAdding(false);
    if (res.ok) {
      setLabel("");
      setUrl("");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.fields ? Object.values(data.fields).join(" ") : "Eklenemedi.");
    }
  }

  async function syncSource(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/calendar-sources/${id}/sync`, { method: "POST" });
    setBusyId(null);
    if (res.ok) router.refresh();
    else window.alert("Senkronizasyon başarısız oldu.");
  }

  async function deleteSource(id: string) {
    if (!window.confirm("Bu takvim bağlantısını silmek istiyor musunuz?")) return;
    setBusyId(id);
    const res = await fetch(`/api/calendar-sources/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Airbnb / Booking.com&apos;daki &quot;takvimi dışa aktar&quot; iCal bağlantısını buraya
        ekleyin. &quot;Senkronla&quot; deyince rezervasyonlar otomatik düşer.
      </p>

      {sources.length > 0 && (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{s.label}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => syncSource(s.id)}
                    disabled={busyId === s.id}
                    title="Şimdi senkronla"
                  >
                    {busyId === s.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteSource(s.id)}
                    disabled={busyId === s.id}
                    title="Sil"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <p className="truncate text-xs text-muted-foreground" title={s.url}>
                {s.url}
              </p>
              {s.lastSyncedAt && (
                <p className="mt-1 flex items-center gap-1 text-xs">
                  {s.lastStatus === "error" ? (
                    <AlertCircle className="size-3 text-destructive" />
                  ) : (
                    <CheckCircle2 className="size-3 text-emerald-600" />
                  )}
                  <span className="text-muted-foreground">
                    {fromNow(s.lastSyncedAt)} · {s.lastResult ?? ""}
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <Input
          placeholder="Kaynak adı (örn. Airbnb, Booking)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          placeholder="https://www.airbnb.com/calendar/ical/...ics"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" onClick={addSource} disabled={adding} className="w-full">
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Takvim bağlantısı ekle
        </Button>
      </div>
    </div>
  );
}
