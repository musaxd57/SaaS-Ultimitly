"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, ShieldOff, Check, KeyRound, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";

/**
 * Two-factor auth (authenticator app) setup. Three states:
 *   - off → "Enable" starts setup (shows the secret key to add to the app),
 *   - setting up → enter the first 6-digit code to confirm,
 *   - on → shows active, "Disable" requires a current code + the single-use
 *     RECOVERY CODES section (generate/renew needs a current code too; the
 *     plaintexts are displayed exactly once).
 */
export function TwoFactorCard({
  initialEnabled,
  initialRecoveryRemaining = 0,
}: {
  initialEnabled: boolean;
  initialRecoveryRemaining?: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [secret, setSecret] = useState<string | null>(null); // shown during setup
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Recovery codes: unused count + the one-time plaintext reveal after (re)gen.
  const [recoveryRemaining, setRecoveryRemaining] = useState(initialRecoveryRemaining);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function call(body: object) {
    try {
      const res = await fetch("/api/account/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { ok: res.ok, data: await res.json().catch(() => ({})) };
    } catch {
      // Network reject — surface a generic error instead of leaving the spinner stuck.
      return { ok: false, data: {} };
    }
  }

  async function startSetup() {
    setBusy(true);
    setError(null);
    setDone(null);
    const { ok, data } = await call({ action: "setup" });
    setBusy(false);
    if (ok && data.secret) setSecret(data.secret);
    // The "already active" guard returns its message in fields._, so read that first.
    else setError(data.fields?._ ?? data.error ?? "Kurulum başlatılamadı.");
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
      // Codes die with 2FA (server clears them) — reflect that immediately.
      setRecoveryRemaining(0);
      setRecoveryCodes(null);
      setDone("2FA kapatıldı.");
    } else {
      setError(data.fields?.code ?? data.error ?? "Kapatılamadı.");
    }
  }

  async function generateRecoveryCodes(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryBusy(true);
    setRecoveryError(null);
    setCopied(false);
    const { ok, data } = await call({ action: "recovery_codes", code: recoveryCodeInput });
    setRecoveryBusy(false);
    if (ok && Array.isArray(data.codes)) {
      setRecoveryCodes(data.codes);
      setRecoveryRemaining(data.codes.length);
      setRecoveryCodeInput("");
    } else {
      setRecoveryError(data.fields?.code ?? data.fields?._ ?? data.error ?? "Kodlar oluşturulamadı.");
    }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch {
      setRecoveryError("Kopyalanamadı — kodları elle not edin.");
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

        {/* ---- Recovery codes (single-use backup second factor) ---- */}
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <KeyRound className="size-4" /> Kurtarma kodları
            <span className="text-muted-foreground">
              — {recoveryRemaining > 0 ? `${recoveryRemaining} adet kullanılmamış` : "henüz yok"}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Telefonunu kaybedersen bu tek kullanımlık kodlardan biriyle giriş yapabilirsin.
            {recoveryRemaining > 0
              ? " Yenilersen eski kodların TAMAMI geçersiz olur."
              : " Oluşturman şiddetle önerilir — yoksa telefon kaybında hesaba erişemezsin."}
          </p>
          {recoveryCodes ? (
            <div className="space-y-2">
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Bu kodlar <strong>bir daha gösterilmeyecek</strong>. Her biri tek kullanımlıktır —
                şifre yöneticine kaydet veya yazdır.
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-background px-3 py-2 font-mono text-sm tracking-wider">
                {recoveryCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={copyRecoveryCodes}>
                <Copy className="size-4" /> {copied ? "Kopyalandı ✓" : "Hepsini kopyala"}
              </Button>
            </div>
          ) : (
            <form onSubmit={generateRecoveryCodes} className="flex flex-wrap items-end gap-2">
              <Field label="Mevcut kod" htmlFor="tf-rec" className="min-w-[200px] flex-1">
                <Input
                  id="tf-rec"
                  inputMode="numeric"
                  value={recoveryCodeInput}
                  onChange={(e) => setRecoveryCodeInput(e.target.value)}
                  placeholder="Uygulamadaki 6 haneli kod"
                />
              </Field>
              <Button type="submit" variant="outline" disabled={recoveryBusy || recoveryCodeInput.length < 6}>
                {recoveryBusy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {recoveryRemaining > 0 ? "Kodları yenile" : "Kodları oluştur"}
              </Button>
            </form>
          )}
          {recoveryError ? <p className="text-sm text-destructive">{recoveryError}</p> : null}
        </div>
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
        <strong className="text-foreground">Ne işe yarar?</strong> Şifrene ek bir güvenlik katmanı.
        Açıkken girişte, şifrenin yanında telefonundaki uygulamadan 6 haneli bir kod da istenir —
        şifren çalınsa bile telefonun olmadan kimse giremez. Kod 30 saniyede bir yenilenir.
      </p>
      <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p className="mb-1.5 font-medium text-foreground">Nasıl yapılır? (2 dakika)</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>
            Telefonuna <strong>Google Authenticator</strong> (veya Authy) uygulamasını indir —
            ücretsiz.
          </li>
          <li>
            Aşağıdaki <strong>&quot;2FA kur&quot;</strong> butonuna bas; ekranda bir anahtar çıkar.
          </li>
          <li>
            Uygulamada <strong>&quot;Hesap ekle → Kurulum anahtarı gir&quot;</strong> de; anahtarı yaz
            (anahtar türü: <strong>Zaman bazlı / Time based</strong>).
          </li>
          <li>Uygulamanın ürettiği 6 haneli kodu buraya gir → 2FA açılır.</li>
        </ol>
        <p className="mt-1.5 text-xs">
          Not: Telefonunu kaybetmemek için uygulamanın yedeklemesini (bulut senkron) açık tut.
        </p>
      </div>
      <Button onClick={startSetup} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        İki adımlı girişi (2FA) kur
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {done ? <p className="text-sm font-medium text-emerald-600">{done}</p> : null}
    </div>
  );
}
