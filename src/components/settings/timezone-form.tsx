"use client";

import { useMemo, useState } from "react";
import { Loader2, Check, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Org saat dilimi: raporlar, gün sınırları (Bugün/Bu ay), otomatik mesaj saat
 * pencereleri ve QR sohbet açık-saat kapısı bu dilime göre çalışır. Sunucu
 * kapalı-set doğrular (IANA); varsayılan Europe/Istanbul.
 */
export function TimezoneForm({ initial }: { initial: string }) {
  const [tz, setTz] = useState(initial || "Europe/Istanbul");
  const [baseline, setBaseline] = useState(initial || "Europe/Istanbul");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = tz !== baseline;

  // Tarayıcının bildiği tam IANA listesi; desteklemeyen eski tarayıcıda kısa
  // yedek liste (kaydedilen değeri sunucu yine doğrular).
  const zones = useMemo<string[]>(() => {
    try {
      const list = Intl.supportedValuesOf("timeZone");
      // Mevcut değer listede yoksa (alias vb.) başa ekle ki select onu gösterebilsin.
      return list.includes(tz) ? list : [tz, ...list];
    } catch {
      return Array.from(new Set([tz, "Europe/Istanbul", "Europe/London", "Europe/Berlin", "America/New_York", "Asia/Dubai", "UTC"]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(true);
        setBaseline(tz); // new baseline → button disables until the next change
      } else setError(data.fields?.timezone ?? data.error ?? "Kaydedilemedi.");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Raporlar, &quot;Bugün&quot; gün sınırları ve otomatik mesaj saat pencereleri bu dilime göre
        hesaplanır. Türkiye&apos;deki daireler için varsayılan (Europe/Istanbul) doğrudur —
        değiştirmeniz gerekmez.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="org-timezone" className="mb-1 block text-xs font-medium text-muted-foreground">
            Saat dilimi (IANA)
          </label>
          <select
            id="org-timezone"
            value={tz}
            onChange={(e) => { setTz(e.target.value); setSaved(false); }}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" disabled={busy || !dirty}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : saved && !dirty ? <Check className="size-4 text-emerald-600" /> : <Globe className="size-4" />}
          {saved && !dirty ? "Kaydedildi" : "Kaydet"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
