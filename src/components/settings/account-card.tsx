"use client";

import { useState } from "react";
import { Loader2, Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";

/**
 * Account / login card: shows the owner's login email and lets them set a new
 * password while signed in (so a forgotten password can be recovered).
 */
export function AccountCard({ email }: { email: string }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
        setPw("");
      } else {
        setError(data.fields?.newPassword ?? data.error ?? "Şifre güncellenemedi.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Giriş e-postan: <strong className="font-medium">{email}</strong>
      </p>
      <p className="text-xs text-muted-foreground">
        lixusai.com/login adresinden bu e-posta ve şifrenle girersin. Şifreni
        unuttuysan aşağıdan yenisini belirle (girişin açıkken).
      </p>
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <Field label="Yeni şifre (en az 8 karakter)" htmlFor="new-pw" className="min-w-[220px] flex-1">
          <Input
            id="new-pw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="••••••••"
            minLength={8}
            required
          />
        </Field>
        <Button type="submit" disabled={busy || pw.length < 8}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Şifreyi güncelle
        </Button>
      </form>
      {done ? (
        <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
          <Check className="size-4" /> Şifre güncellendi. Bunu unutma!
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
