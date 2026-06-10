"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Public "request a demo / free trial" form on the landing page. */
export function LeadForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [website, setWebsite] = useState(""); // honeypot — humans never fill this
  const [consent, setConsent] = useState(false);
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
        body: JSON.stringify({ ...form, website, consent }),
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
          <Input aria-label="Adınız" placeholder="Adınız" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
        </div>
        <div>
          <Input aria-label="E-posta" type="email" placeholder="E-posta" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          {errors.email ? <p className="mt-1 text-xs text-destructive">{errors.email}</p> : null}
        </div>
      </div>
      <Input aria-label="Telefon" placeholder="Telefon (opsiyonel)" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
      <textarea
        aria-label="Mesajınız"
        placeholder="Kaç daireniz var, ne zaman başlamak istersiniz? (opsiyonel)"
        value={form.message}
        onChange={(e) => set("message", e.target.value)}
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* Honeypot: hidden from humans; bots that fill it get silently dropped. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
          className="mt-0.5 size-4 shrink-0 rounded border-input"
        />
        <span>
          <Link href="/gizlilik" className="underline hover:text-foreground">KVKK Aydınlatma Metni</Link>
          &apos;ni okudum; demo talebime dönüş yapılması için ad, e-posta ve telefon bilgilerimin
          işlenmesine açık rıza veriyorum.
        </span>
      </label>
      {errors.consent ? <p className="text-xs text-destructive">{errors.consent}</p> : null}
      {errors._ ? <p className="text-sm text-destructive">{errors._}</p> : null}
      <Button type="submit" className="w-full" size="lg" disabled={busy || !consent}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Ücretsiz demo iste
      </Button>
      <p className="text-center text-xs text-muted-foreground">Kredi kartı gerekmez.</p>
    </form>
  );
}
