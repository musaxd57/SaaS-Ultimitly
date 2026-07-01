"use client";

import { useState } from "react";
import { Loader2, Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Per-tenant alert e-mail: where THIS account's urgent complaint/refund alerts
 * are sent. Each customer sets their own address (boş bırakılırsa sistem
 * varsayılanına düşer).
 */
export function AlertEmailForm({ initial }: { initial: string }) {
  const [email, setEmail] = useState(initial);
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
        body: JSON.stringify({ alertEmail: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSaved(true);
      else setError(data.fields?.alertEmail ?? data.error ?? "Kaydedilemedi.");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[220px] flex-1">
        <label htmlFor="alert-email" className="mb-1 block text-xs font-medium text-muted-foreground">
          Uyarı e-posta adresi
        </label>
        <Input
          id="alert-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSaved(false); }}
          placeholder="ornek@mail.com"
        />
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4 text-emerald-600" /> : <Mail className="size-4" />}
        {saved ? "Kaydedildi" : "Kaydet"}
      </Button>
      {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
