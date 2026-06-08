"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, ShieldOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";

/**
 * Two-factor auth (authenticator app) setup. Three states:
 *   - off → "Enable" starts setup (shows the secret key to add to the app),
 *   - setting up → enter the first 6-digit code to confirm,
 *   - on → shows active, "Disable" requires a current code.
 */
export function TwoFactorCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [secret, setSecret] = useState<string | null>(null); // shown during setup
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function call(body: object) {
    const res = await fetch("/api/account/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  async function startSetup() {
    setBusy(true);
    setError(null);
    setDone(null);
    const { ok, data } = await call({ action: "setup" });
    setBusy(false);
    if (ok && data.secret) setSecret(data.secret);
    else setError(data.error ?? "Kurulum başlatılamadı.");
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await call({ action: "enable", code });
    setBusy(false);
    if (ok) {
      setEnabled(true);
      setSecret(null);
      setCode("");
      setDone("2FA açıldı. Artık girişte telefonundaki kod istenecek.");
    } else {
      setError(data.fields?.code ?? data.error ?? "Kod doğrulanamadı.");
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await call({ action: "disable", code });
    setBusy(false);
    if (ok) {
      setEnabled(false);
      setCode("");
      setDone("2FA kapatıldı.");
    } else {
      setError(data.fields?.code ?? data.error ?? "Kapatılamadı.");
    }
  }

  // --- Active ---------------------------------------------------------------
  if (enabled) {
    return (
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
          <ShieldCheck className="size-4" /> İki adımlı giriş AÇIK.
        </p>
        <p className="text-sm text-muted-foreground">
          Girişte şifrenin yanında telefonundaki Authenticator kodunu da gireceksin. Kapatmak için
          mevcut bir kodu gir.
        </p>
        <form onSubmit={disable} className="flex flex-wrap items-end gap-2">
          <Field label="Mevcut kod" htmlFor="tf-off" className="min-w-[200px] flex-1">
            <Input id="tf-off" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 haneli kod" />
          </Field>
          <Button type="submit" variant="outline" disabled={busy || code.length < 6}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
            2FA&apos;yı kapat
          </Button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {done ? <p className="text-sm font-medium text-emerald-600">{done}</p> : null}
      </div>
    );
  }

  // --- Setting up (secret shown) -------------------------------------------
  if (secret) {
    return (
      <form onSubmit={confirmEnable} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Telefonunda <strong>Google Authenticator</strong> ya da <strong>Authy</strong> aç →
          &quot;Hesap ekle&quot; → <strong>&quot;Kurulum anahtarı gir&quot;</strong> de ve aşağıdaki
          anahtarı yaz (hesap adı: Lixus AI):
        </p>
        <div className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm tracking-wider break-all">
          {secret.match(/.{1,4}/g)?.join(" ")}
        </div>
        <p className="text-sm text-muted-foreground">
          Eklenince uygulama 6 haneli kod üretmeye başlar. O kodu buraya gir:
        </p>
        <Field label="Uygulamadaki kod" htmlFor="tf-on" error={error ?? undefined} className="max-w-[240px]">
          <Input id="tf-on" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 haneli kod" autoFocus />
        </Field>
        <Button type="submit" disabled={busy || code.length < 6}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Doğrula ve aç
        </Button>
      </form>
    );
  }

  // --- Off ------------------------------------------------------------------
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Şifrene ek bir güvenlik katmanı. Açıkken, girişte telefonundaki Authenticator uygulamasından
        6 haneli bir kod istenir — şifren çalınsa bile telefonun olmadan kimse giremez.
      </p>
      <Button onClick={startSetup} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        İki adımlı girişi (2FA) kur
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {done ? <p className="text-sm font-medium text-emerald-600">{done}</p> : null}
    </div>
  );
}
