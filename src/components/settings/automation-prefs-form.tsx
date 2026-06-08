"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Per-tenant automation preferences each customer controls:
 *  - autoReplyDisclosure: show the "(machine-prepared)" note on AUTO replies.
 *  - handoffHoldHours: how long the AI stays silent after a human-handoff request.
 */
export function AutomationPrefsForm({
  disclosure,
  holdHours,
}: {
  disclosure: boolean;
  holdHours: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [autoReplyDisclosure, setDisclosure] = useState(disclosure);
  const [handoffHoldHours, setHoldHours] = useState(String(holdHours));
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
        body: JSON.stringify({
          autoReplyDisclosure,
          handoffHoldHours: Number(handoffHoldHours),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(true);
        startTransition(() => router.refresh());
      } else {
        setError(data.fields?.handoffHoldHours ?? data.fields?.autoReplyDisclosure ?? data.error ?? "Kaydedilemedi.");
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
          checked={autoReplyDisclosure}
          onChange={(e) => { setDisclosure(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Otomatik yanıt notu</span>
          <span className="block text-xs text-muted-foreground">
            Otomatik gönderilen cevapların sonuna “(Bu yanıt otomatik hazırlandı)” notu eklensin.
            Kapatırsanız misafir bu notu görmez. (Elle gönderdiğiniz cevaplarda zaten görünmez.)
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="hold-hours" className="block text-sm font-medium">
          İnsan devri bekleme süresi (saat)
        </label>
        <p className="mb-1.5 text-xs text-muted-foreground">
          Misafir “gerçek bir kişiyle / ev sahibiyle görüşmek istiyorum” dediğinde, AI bu konuşmada
          kaç saat sussun? (0–72) Bu sürede siz devralırsınız.
        </p>
        <Input
          id="hold-hours"
          type="number"
          min={0}
          max={72}
          value={handoffHoldHours}
          onChange={(e) => { setHoldHours(e.target.value); setSaved(false); }}
          className="w-28"
        />
      </div>

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
