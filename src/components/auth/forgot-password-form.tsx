"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "request" | "confirm" | "done";

export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.fields?.email ?? data.error ?? "İstek başarısız oldu.");
        return;
      }
      setStep("confirm");
      setCooldown(30);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", email, code, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.fields?.code ?? data.fields?.newPassword ?? data.error ?? "İşlem başarısız oldu.",
        );
        return;
      }
      setStep("done");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          Şifreniz güncellendi. Artık yeni şifrenizle giriş yapabilirsiniz.
        </p>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Giriş yap
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {step === "request" ? (
        <form onSubmit={requestCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-posta</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Hesabınıza kayıtlı e-postaya 8 haneli bir sıfırlama kodu göndereceğiz.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Kod gönder
          </Button>
        </form>
      ) : (
        <form onSubmit={confirm} className="space-y-4">
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <strong>{email}</strong> kayıtlıysa bir kod gönderdik. Gelen kutunu (ve spam klasörünü)
            kontrol et.
          </p>
          <div className="space-y-2">
            <Label htmlFor="code">Doğrulama kodu</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="8 haneli kod"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">Yeni şifre</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="En az 8 karakter"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Şifreyi sıfırla
          </Button>
          <button
            type="button"
            onClick={() => requestCode()}
            disabled={loading || cooldown > 0}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {cooldown > 0 ? `Kodu tekrar gönder (${cooldown})` : "Kodu tekrar gönder"}
          </button>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Girişe dön
        </Link>
      </p>
    </div>
  );
}
