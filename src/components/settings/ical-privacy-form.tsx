"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Calendar-feed privacy: the public per-property iCal feed is subscribed to by
 * third parties (Airbnb, Booking, Google Calendar). By default the guest's name
 * is hidden (only busy dates leave the system — KVKK data minimization). A host
 * who wants the name inside their own calendar can opt in here. Org-wide.
 */
export function IcalPrivacyForm({ showGuestName }: { showGuestName: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [icalShowGuestName, setShow] = useState(showGuestName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icalShowGuestName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(true);
        startTransition(() => router.refresh());
      } else {
        setError(data.fields?.icalShowGuestName ?? data.error ?? "Kaydedilemedi.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={icalShowGuestName}
          onChange={(e) => { setShow(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Takvim akışında misafir adını göster</span>
          <span className="block text-xs text-muted-foreground">
            Mülklerinizin iCal takvim bağlantısı Airbnb, Booking ve Google Takvim gibi dış
            servislere abone edilir. Varsayılan olarak (KAPALI) misafirin adı bu akışta
            görünmez — yalnızca “Rezervasyon” ve dolu tarihler paylaşılır (KVKK veri
            minimizasyonu; blok-tarih için ad gerekmez). Açarsanız misafirin adı takvim
            başlığında da görünür — bilginin gittiği tüm dış servislerde de görüneceğini unutmayın.
          </span>
        </span>
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
    </form>
  );
}
