"use client";

import { useState } from "react";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2, Plus, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fromNow } from "@/lib/utils";

export interface CalendarSourceRow {
  id: string;
  label: string;
  /** Pre-masked ON THE SERVER (host + tail). The raw feed URL is a secret and
   *  never reaches the client — render-time masking would still ship the full
   *  value in the RSC payload, and post-contract the client couldn't mask at
   *  all (it would only ever see the sentinel). */
  urlMasked: string;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastResult: string | null;
}

interface Props {
  propertyId: string;
  sources: CalendarSourceRow[];
  /** Staff (read-only) see the sources but can't add/sync/delete (API also 403s). */
  canManage?: boolean;
  /** Host's operating timezone — `lastSyncedAt` is a real instant, so its
   *  past-30-days absolute-day fallback must read on the host's calendar.
   *  Resolved server-side (orgTimezone) and passed down; a client component
   *  cannot read the org row itself. */
  tz?: string;
}

/**
 * Manage external iCal subscriptions (Airbnb, Booking.com …) for a property.
 * Reservations are pulled in on demand via the per-source "Senkronla" button.
 */
/** Preset source names: the two channels ~every Turkish host uses get one-tap
 *  chips; "Diğer" keeps the free-text path open (Vrbo, Google Takvim, PMS
 *  exports…) — the API contract is unchanged, label is still a plain string. */
const PRESET_SOURCES = ["Airbnb", "Booking.com"] as const;

export function CalendarSources({ propertyId, sources, canManage = true, tz }: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState<string | null>(null); // "Airbnb" | "Booking.com" | "custom" | null
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addSource() {
    setError(null);
    const effectiveLabel = preset === "custom" ? label.trim() : (preset ?? "");
    if (!preset) {
      setError("Önce kaynağı seçin: Airbnb, Booking.com veya Diğer.");
      return;
    }
    if (effectiveLabel.length < 2) {
      setError("Kaynak adı gerekli (örn. Vrbo, Google Takvim).");
      return;
    }
    // https-only, matching the server rule exactly (feed URLs embed secrets;
    // the API rejects http). Validating here too saves a round-trip and avoids
    // a misleading "http(s)" hint the server would contradict.
    if (!/^https:\/\/.+/i.test(url.trim())) {
      setError("Yalnızca https ile başlayan iCal bağlantısı kabul edilir.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/calendar-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: effectiveLabel, url: url.trim() }),
      });
      if (res.ok) {
        setPreset(null);
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
        toast.error("Takvim güncellenemedi.");
      } else if (
        // The endpoint returns 200 even when the feed couldn't be fetched/parsed
        // (bad URL, unreachable, empty). Surface that instead of a silent "success".
        Array.isArray(data?.errors) &&
        data.errors.length > 0 &&
        (data.imported ?? 0) + (data.updated ?? 0) === 0
      ) {
        toast.error(`Senkronizasyon başarısız: ${data.errors[0]}`);
        router.refresh(); // still refresh so the error badge + zaman damgası güncellensin
      } else {
        router.refresh();
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSource(id: string) {
    const ok = await confirmDialog({
      title: "Bu takvim bağlantısını silmek istiyor musunuz?",
      body: "Bu kaynaktan gelen rezervasyonlar artık güncellenmez.",
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/calendar-sources/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else toast.error("Takvim bağlantısı silinemedi.");
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">Takvim bağlantısı: düzenli senkronizasyon.</strong>{" "}
        Airbnb / Booking.com&apos;daki &quot;takvimi dışa aktar&quot; iCal bağlantısını buraya
        ekleyin; bağlantı düzenli aralıklarla yeniden okunur (&quot;Senkronla&quot; anında çeker).
        Elinizdeki bir dosyayı bir kez aktarmak için aşağıdaki &quot;Dosyadan içe aktar&quot;ı
        kullanın. Bu ilanın rezervasyonları kanal bağlantınızdan zaten geliyorsa aynı ilanın
        iCal&apos;ini ayrıca eklemeyin — rezervasyonlar iki kez görünebilir.
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
                      title="Şimdi güncelle"
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
              <p className="truncate text-xs text-muted-foreground">{s.urlMasked}</p>
              {s.lastSyncedAt && (
                <p className="mt-1 flex items-center gap-1 text-xs">
                  {s.lastStatus === "error" ? (
                    <AlertCircle aria-label="Son okuma başarısız" className="size-3 text-destructive" />
                  ) : s.lastStatus === "partial" ? (
                    // Kısmi okuma (F16): okunanlar alındı ama takvimin tamamı değil — yeşil "tamam" DEĞİL.
                    <AlertCircle aria-label="Takvimin bir kısmı okunamadı" className="size-3 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <CheckCircle2 aria-label="Son okuma başarılı" className="size-3 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span className="text-muted-foreground">
                    {fromNow(s.lastSyncedAt, tz)} · {s.lastResult ?? ""}
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <div role="group" aria-label="Takvim kaynağı" className="flex flex-wrap gap-1.5">
            {[...PRESET_SOURCES, "Diğer"].map((option) => {
              const value = option === "Diğer" ? "custom" : option;
              const active = preset === value;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPreset(active ? null : value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
          {preset === "custom" && (
            <Input
              placeholder="Kaynak adı (örn. Vrbo, Google Takvim)"
              aria-label="Takvim kaynağı adı"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
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
