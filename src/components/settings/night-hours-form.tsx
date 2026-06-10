"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function NightHoursForm({
  startHour,
  endHour,
}: {
  startHour: number;
  endHour: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [start, setStart] = useState(startHour);
  const [end, setEnd] = useState(endHour);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReplyStartHour: start, autoReplyEndHour: end }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.fields?.autoReplyStartHour ?? data.error ?? "Kaydedilemedi");
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Moon className="size-4 text-muted-foreground" /> Oto-yanıt Aktif Saat Aralığı
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Oto-yanıt yalnızca bu saat aralığında çalışır. Aralık gece yarısını da geçebilir
            (örn. 22:00 → 06:00). Başlangıç ile bitiş eşitse <strong>tüm gün</strong> sayılır.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Başlangıç" htmlFor="night-start">
              <Select id="night-start" value={String(start)} onChange={(e) => setStart(Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Bitiş" htmlFor="night-end">
              <Select id="night-end" value={String(end)} onChange={(e) => setEnd(Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Kaydet
            </Button>
            {saved ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check className="size-4" /> Kaydedildi ({pad(start)}–{pad(end)})
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
