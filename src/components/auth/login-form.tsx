"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [twoFactor, setTwoFactor] = useState(false);
  // Default OFF: a deliberate opt-in, so a shared/front-desk computer never
  // silently keeps a 30-day 2FA-skip cookie.
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(twoFactor ? { code, rememberDevice } : {}) }),
      });
      const data = await res.json().catch(() => ({}));

      // Account has 2FA: password accepted, now prompt for the 6-digit code.
      if (data?.twoFactorRequired) {
        setTwoFactor(true);
        setError(res.ok ? null : (data.error ?? "Doğrulama kodu hatalı"));
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Giriş başarısız oldu");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      // Same-origin only: reject protocol-relative ("//evil.com") and "/\" forms.
      const safeNext =
        next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\");
      router.push(safeNext ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
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
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Şifre</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {twoFactor ? (
        <div className="space-y-2">
          <Label htmlFor="code">Doğrulama kodu</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Authenticator uygulamasındaki 6 haneli kod"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
          <p className="text-xs text-muted-foreground">
            Telefonundaki Authenticator uygulamasını aç ve Lixus AI kodunu gir.
          </p>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Bu cihazı 30 gün hatırla — tekrar kod sorma
          </label>
        </div>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {twoFactor ? "Doğrula ve Gir" : "Giriş Yap"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Hesabınız yok mu?{" "}
        <Link href="/#demo" className="font-medium text-primary hover:underline">
          Ücretsiz demo isteyin
        </Link>
      </p>
    </form>
  );
}
