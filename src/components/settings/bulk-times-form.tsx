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
  const [checkInTime, setCheckIn] = useState(defaultCheckIn);
  const [checkOutTime, setCheckOut] = useState(defaultCheckOut);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <Field label="Check-in" htmlFor="bulk-checkin">
              <Input
                id="bulk-checkin"
                value={checkInTime}
                onChange={(e) => { setCheckIn(e.target.value); setResult(null); }}
                placeholder="14:00"
              />
            </Field>
            <Field label="Check-out" htmlFor="bulk-checkout">
              <Input
                id="bulk-checkout"
                value={checkOutTime}
                onChange={(e) => { setCheckOut(e.target.value); setResult(null); }}
                placeholder="11:00"
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Tüm dairelere uygula
            </Button>
            {result ? (
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
