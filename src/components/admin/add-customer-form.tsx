"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";

/**
 * Create a new customer org + its owner login (super-admin only). After
 * creating, the operator connects that customer's own Hospitable token by
 * entering the account → Settings.
 */
export function AddCustomerForm() {
  const router = useRouter();
  const [form, setForm] = useState({ organizationName: "", name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setDone(null);
    try {
      const res = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(`"${form.organizationName}" eklendi. Hesabına girip Ayarlar'dan Hospitable bağlayabilirsin.`);
        setForm({ organizationName: "", name: "", email: "", password: "" });
        router.refresh();
      } else {
        setErrors(data.fields ?? { _: data.error ?? "Eklenemedi." });
      }
    } catch {
      setErrors({ _: "Bağlantı hatası." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Müşteri için bir hesap ve giriş bilgisi oluştur. Sonra <strong>&quot;Hesaba gir&quot;</strong> ile
        içeri girip <strong>Ayarlar → Hospitable Bağlantısı</strong>&apos;ndan onların kendi Hospitable
        token&apos;ını bağlarsın. Müşterinin Airbnb verisi yalnızca o zaman akmaya başlar.
      </p>
      <Field label="İşletme adı" htmlFor="c-org" error={errors.organizationName}>
        <Input id="c-org" value={form.organizationName} onChange={(e) => set("organizationName", e.target.value)} placeholder="Örn. Ahmet Apartmanları" required />
      </Field>
      <Field label="Yetkili adı" htmlFor="c-name" error={errors.name}>
        <Input id="c-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ahmet Yılmaz" required />
      </Field>
      <Field label="Giriş e-postası" htmlFor="c-email" error={errors.email}>
        <Input id="c-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="ahmet@ornek.com" required />
      </Field>
      <Field label="Geçici şifre (en az 8 karakter)" htmlFor="c-pw" error={errors.password}>
        <Input id="c-pw" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••••" minLength={8} required />
      </Field>
      {errors._ ? <p className="text-sm text-destructive">{errors._}</p> : null}
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        Müşteri oluştur
      </Button>
      {done ? (
        <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
          <Check className="size-4" /> {done}
        </p>
      ) : null}
    </form>
  );
}
