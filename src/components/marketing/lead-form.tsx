"use client";

import { useState } from "react";
import { Loader2, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Public "request a demo / free trial" form on the landing page. */
export function LeadForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDone(true);
      else setErrors(data.fields ?? { _: data.error ?? "Gönderilemedi." });
    } catch {
      setErrors({ _: "Bağlantı hatası." });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 text-center">
        <Check className="mx-auto size-8 text-emerald-600" />
        <p className="mt-2 font-semibold text-emerald-900">Talebiniz alındı!</p>
        <p className="mt-1 text-sm text-emerald-800">
          En kısa sürede sizinle iletişime geçip kurulumunuzu birlikte yapacağız.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Input placeholder="Adınız" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
        </div>
        <div>
          <Input type="email" placeholder="E-posta" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          {errors.email ? <p className="mt-1 text-xs text-destructive">{errors.email}</p> : null}
        </div>
      </div>
      <Input placeholder="Telefon (opsiyonel)" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
      <textarea
        placeholder="Kaç daireniz var, ne zaman başlamak istersiniz? (opsiyonel)"
        value={form.message}
        onChange={(e) => set("message", e.target.value)}
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {errors._ ? <p className="text-sm text-destructive">{errors._}</p> : null}
      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Ücretsiz demo iste
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Kredi kartı gerekmez. Size dönüp kurulumu birlikte yapalım.
      </p>
    </form>
  );
}
