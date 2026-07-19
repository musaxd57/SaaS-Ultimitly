"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BulkTimesForm({
  defaultCheckIn,
  defaultCheckOut,
}: {
  defaultCheckIn: string;
  defaultCheckOut: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Legacy rows may hold un-padded "9:30" (the old free-text era accepted H:MM);
  // <input type="time"> treats that as invalid and renders EMPTY, with dirty=false
  // so it couldn't even be re-saved. Zero-pad on the way in.
  const padTime = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : t;
  };
  const [checkInTime, setCheckIn] = useState(padTime(defaultCheckIn));
  const [checkOutTime, setCheckOut] = useState(padTime(defaultCheckOut));
  const [baseCheckIn, setBaseCheckIn] = useState(padTime(defaultCheckIn));
  const [baseCheckOut, setBaseCheckOut] = useState(padTime(defaultCheckOut));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = checkInTime !== baseCheckIn || checkOutTime !== baseCheckOut;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/properties/bulk-times", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkInTime, checkOutTime }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.fields?.checkInTime ?? data.fields?.checkOutTime ?? data.error ?? "Kaydedilemedi");
        return;
      }
      setResult(`${data.updated} daireye uygulandı.`);
      setBaseCheckIn(checkInTime);
      setBaseCheckOut(checkOutTime);
      startTransition(() => router.refresh());
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-muted-foreground" /> Tüm Dairelerin Check-in / Check-out Saati
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Buraya girdiğin saatler <strong>tüm dairelere</strong> uygulanır. AI cevaplarında ve
            karşılama bilgisinde bu saatler kullanılır.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Native time picker (same as the property form): the host taps a
                clock and picks HH:MM — no need to type the ":00" by hand. */}
            <Field label="Check-in" htmlFor="bulk-checkin">
              <Input
                id="bulk-checkin"
                type="time"
                value={checkInTime}
                onChange={(e) => { setCheckIn(e.target.value); setResult(null); }}
              />
            </Field>
            <Field label="Check-out" htmlFor="bulk-checkout">
              <Input
                id="bulk-checkout"
                type="time"
                value={checkOutTime}
                onChange={(e) => { setCheckOut(e.target.value); setResult(null); }}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Tüm dairelere uygula
            </Button>
            {result && !dirty ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check className="size-4" /> {result}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
