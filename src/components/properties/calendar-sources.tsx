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
  /** Staff (read-only) see the sources but can't add/sync/delete (API also 403s). */
  canManage?: boolean;
}

/** Feed URLs embed bearer-like export secrets (Codex #21) — never render the
 *  full value on screen (screenshots, shoulder-surfing, screen shares). Host +
 *  masked tail is enough to recognize which source it is. */
function maskFeedUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…${url.slice(-6)}`;
  } catch {
    return `…${url.slice(-6)}`;
  }
}

/**
 * Manage external iCal subscriptions (Airbnb, Booking.com …) for a property.
 * Reservations are pulled in on demand via the per-source "Senkronla" button.
 */
export function CalendarSources({ propertyId, sources, canManage = true }: Props) {
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
    try {
      const res = await fetch(`/api/properties/${propertyId}/calendar-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), url: url.trim() }),
      });
      if (res.ok) {
        setLabel("");
        setUrl("");
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.fields ? Object.values(data.fields).join(" ") : "Eklenemedi.");
      }
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setAdding(false);
    }
  }

  async function syncSource(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/calendar-sources/${id}/sync`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert("Senkronizasyon başarısız oldu.");
      } else if (
        // The endpoint returns 200 even when the feed couldn't be fetched/parsed
        // (bad URL, unreachable, empty). Surface that instead of a silent "success".
        Array.isArray(data?.errors) &&
        data.errors.length > 0 &&
        (data.imported ?? 0) + (data.updated ?? 0) === 0
      ) {
        window.alert(`Senkronizasyon başarısız: ${data.errors[0]}`);
        router.refresh(); // still refresh so the error badge + zaman damgası güncellensin
      } else {
        router.refresh();
      }
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSource(id: string) {
    if (!window.confirm("Bu takvim bağlantısını silmek istiyor musunuz?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/calendar-sources/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else window.alert("Takvim bağlantısı silinemedi.");
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
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
                {canManage ? (
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
                      Senkronla
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteSource(s.id)}
                      disabled={busyId === s.id}
                      title="Sil"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" /> Sil
                    </Button>
                  </div>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{maskFeedUrl(s.url)}</p>
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

      {canManage ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <Input
            placeholder="Kaynak adı (örn. Airbnb, Booking)"
            aria-label="Takvim kaynağı adı"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Input
            placeholder="https://www.airbnb.com/calendar/ical/...ics"
            aria-label="Takvim (.ics) bağlantısı"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button size="sm" onClick={addSource} disabled={adding} className="w-full">
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Takvim bağlantısı ekle
          </Button>
        </div>
      ) : null}
    </div>
  );
}
