"use client";

import { useState, useEffect } from "react";
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
  // Second-factor fallback: enter a single-use RECOVERY code instead of the
  // authenticator code ("telefonuma erişemiyorum").
  const [useRecovery, setUseRecovery] = useState(false);
  // Default OFF: a deliberate opt-in, so a shared/front-desk computer never
  // silently keeps a 30-day 2FA-skip cookie.
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // E-mail verification: shown when login is blocked for an unverified account, or
  // when the verify link was bad/expired (?verify= flag from the verify route).
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("verify");
    if (v === "expired" || v === "missing") {
      setNeedsVerify(true);
      setError("Doğrulama bağlantısı geçersiz ya da süresi dolmuş. E-postanı gir ve yeni bağlantı iste.");
    }
  }, []);

  async function resendVerification() {
    if (!email) {
      setError("Önce e-posta adresini gir.");
      return;
    }
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Bir 429/5xx yanıtı throw ETMEZ — ok kontrolü olmadan kullanıcıya yalan
      // "gönderildi" gösterilir ve hiç gelmeyecek bir e-postayı bekler.
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Çok sık denendi — birkaç dakika sonra tekrar deneyin."
            : "Bağlantı gönderilemedi. Lütfen tekrar deneyin.",
        );
        return;
      }
      setResent(true);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(twoFactor
            ? useRecovery
              ? { recoveryCode: code, rememberDevice }
              : { code, rememberDevice }
            : {}),
        }),
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
        if (data?.needsVerification) setNeedsVerify(true);
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
      {needsVerify ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          {resent ? (
            <p>Yeni doğrulama bağlantısı gönderildi — gelen kutunu (ve spam&apos;i) kontrol et.</p>
          ) : (
            <button
              type="button"
              onClick={resendVerification}
              className="font-medium text-amber-900 underline hover:no-underline"
            >
              Doğrulama mailini tekrar gönder
            </button>
          )}
        </div>
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
        {!twoFactor ? (
          <div className="text-right">
            <Link href="/sifremi-unuttum" className="text-sm text-primary hover:underline">
              Şifremi unuttum?
            </Link>
          </div>
        ) : null}
      </div>
      {twoFactor ? (
        <div className="space-y-2">
          <Label htmlFor="code">{useRecovery ? "Kurtarma kodu" : "Doğrulama kodu"}</Label>
          <Input
            id="code"
            inputMode={useRecovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            placeholder={
              useRecovery ? "XXXX-XXXX-XXXX" : "Authenticator uygulamasındaki 6 haneli kod"
            }
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
          <p className="text-xs text-muted-foreground">
            {useRecovery
              ? "Kurtarma kodların tek kullanımlıktır — kullandığın kod geçersiz olur."
              : "Telefonundaki Authenticator uygulamasını aç ve Lixus AI kodunu gir."}
          </p>
          <button
            type="button"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
              setError(null);
            }}
            className="text-xs text-primary underline hover:no-underline"
          >
            {useRecovery ? "Authenticator kodu ile gir" : "Koduma erişemiyorum — kurtarma kodu kullan"}
          </button>
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
        <Link href="/register" className="font-medium text-primary hover:underline">
          Hemen üye olun
        </Link>
      </p>
    </form>
  );
}
