"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Fields = Record<string, string>;

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    organizationName: "",
    name: "",
    email: "",
    password: "",
  });
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [consent, setConsent] = useState(false);

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setFields(data.fields);
        setError(data.error ?? "Kayıt başarısız oldu");
        return;
      }
      if (data.verifyEmail) {
        // Anti-bot: the account is inert until the e-mailed link is clicked.
        setSent(true);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-5 text-sm text-emerald-900">
        <p className="font-semibold">Hesabın oluşturuldu — son bir adım kaldı! 📧</p>
        <p>
          <strong>{form.email}</strong> adresine bir <strong>doğrulama bağlantısı</strong> gönderdik.
          Maildeki butona tıkla; giriş otomatik tamamlanır.
        </p>
        <p className="text-xs text-emerald-700">
          Mail birkaç dakikada gelmezse spam/gereksiz klasörüne bak. Bağlantı 24 saat geçerlidir.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="organizationName">İşletme adı</Label>
        <Input
          id="organizationName"
          value={form.organizationName}
          onChange={update("organizationName")}
          placeholder="Örn. Bosphorus Stays"
          required
        />
        {fields.organizationName ? (
          <p className="text-xs text-destructive">{fields.organizationName}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Adınız</Label>
        <Input id="name" value={form.name} onChange={update("name")} required />
        {fields.name ? <p className="text-xs text-destructive">{fields.name}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">E-posta</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update("email")}
          required
        />
        {fields.email ? <p className="text-xs text-destructive">{fields.email}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Şifre</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update("password")}
          required
        />
        {fields.password ? (
          <p className="text-xs text-destructive">{fields.password}</p>
        ) : (
          <p className="text-xs text-muted-foreground">En az 8 karakter.</p>
        )}
      </div>
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-input"
            required
          />
          <span>
            <Link href="/kosullar" target="_blank" className="text-primary hover:underline">
              Kullanım Koşulları
            </Link>{" "}
            ve{" "}
            <Link href="/gizlilik" target="_blank" className="text-primary hover:underline">
              Gizlilik Politikası
            </Link>
            &apos;nı okudum, kabul ediyorum.
          </span>
        </label>
        {fields.consent ? <p className="text-xs text-destructive">{fields.consent}</p> : null}
      </div>
      <Button type="submit" className="w-full" disabled={loading || !consent}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        Hesap Oluştur
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Zaten hesabınız var mı?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}
