"use client";

import { useState } from "react";
import { Loader2, Check, KeyRound, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";

/**
 * Account / login card. Changing the password is gated by an E-MAIL CODE (not
 * the current password): the user requests a code, we e-mail it to their own
 * address, and they enter it together with the new password. This lets a user
 * who FORGOT their password still recover while logged in, without a stale
 * session alone being enough to silently change the password.
 */
export function AccountCard({ email }: { email: string }) {
  const [step, setStep] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    setInfo(null);
    setDone(false);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStep("code");
        setInfo(`Doğrulama kodu ${email} adresine gönderildi. (Spam klasörünü de kontrol edin.)`);
      } else {
        setError(data.error ?? data.fields?._ ?? "Kod gönderilemedi.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmChange(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", code, newPassword: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
        setStep("idle");
        setCode("");
        setPw("");
        setInfo(null);
      } else {
        setError(
          data.fields?.code ?? data.fields?.newPassword ?? data.error ?? "Şifre güncellenemedi.",
        );
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
        lixusai.com/login adresinden bu e-posta ve şifrenle girersin. Şifreni değiştirmek için
        e-postana bir doğrulama kodu göndeririz — mevcut şifreni bilmene gerek yok.
      </p>

      {step === "idle" ? (
        <Button type="button" onClick={requestCode} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
          Şifreyi değiştir (e-postaya kod gönder)
        </Button>
      ) : (
        <form onSubmit={confirmChange} className="space-y-3">
          <Field label="E-postana gelen 6 haneli kod" htmlFor="pw-code" className="max-w-[220px]">
            <Input
              id="pw-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="______"
              required
            />
          </Field>
          <Field label="Yeni şifre (en az 8 karakter)" htmlFor="new-pw" className="max-w-[320px]">
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || pw.length < 8 || code.length !== 6}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              Şifreyi güncelle
            </Button>
            <Button type="button" variant="ghost" onClick={requestCode} disabled={busy}>
              Kodu tekrar gönder
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep("idle");
                setCode("");
                setError(null);
                setInfo(null);
              }}
              disabled={busy}
            >
              Vazgeç
            </Button>
          </div>
        </form>
      )}

      {info ? <p className="text-xs text-muted-foreground">{info}</p> : null}
      {done ? (
        <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
          <Check className="size-4" /> Şifre güncellendi. Bunu unutma!
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
