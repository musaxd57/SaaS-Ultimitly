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
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("verify");
    if (v === "expired" || v === "missing") {
      setNeedsVerify(true);
      setError(
        "Doğrulama bağlantısı geçersiz ya da süresi dolmuş. E-posta adresinizi girip yeni bağlantı isteyin.",
      );
    }
  }, []);

  /** Kimlik alanlarından biri düzenlenince ekrandaki hata bir DURUM olarak bayatlar
   *  (şifre sıfırlamadaki ile aynı kural: hata zamanla değil, kullanıcı düzeltmeye
   *  başlayınca kalkar). E-posta değişirse "gönderildi" durumu da sıfırlanır — yoksa
   *  yanlış adrese gönderdikten sonra doğru adres için tekrar isteme yolu kapanıyordu
   *  (buton "gönderildi" metniyle yer değiştirdiği için sayfa yenilemeden çıkış yoktu). */
  function clearStaleFeedback(opts: { resetResent?: boolean } = {}) {
    setError((e) => (e ? null : e));
    if (opts.resetResent) setResent(false);
  }

  async function resendVerification() {
    if (!email) {
      setError("Önce e-posta adresinizi girin.");
      return;
    }
    if (resending) return;
    setResending(true);
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
      setError(null); // başarıda eski kırmızı uyarı ekranda kalmasın
      setResent(true);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setResending(false);
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
            <p>Yeni doğrulama bağlantısı gönderildi. Gelmediyse spam klasörünü kontrol edin.</p>
          ) : (
            <button
              type="button"
              onClick={resendVerification}
              disabled={resending}
              className="font-medium text-amber-900 underline hover:no-underline disabled:opacity-60"
            >
              {resending ? "Gönderiliyor…" : "Doğrulama bağlantısını tekrar gönder"}
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
          onChange={(e) => {
            setEmail(e.target.value);
            clearStaleFeedback({ resetResent: true });
          }}
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
          onChange={(e) => {
            setPassword(e.target.value);
            clearStaleFeedback();
          }}
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
            onChange={(e) => {
              setCode(e.target.value);
              clearStaleFeedback();
            }}
            autoFocus
            required
          />
          <p className="text-xs text-muted-foreground">
            {useRecovery
              ? "Kurtarma kodlarınız tek kullanımlıktır — kullandığınız kod geçersiz olur."
              : "Telefonunuzdaki Authenticator uygulamasını açıp Lixus AI kodunu girin."}
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
            Bu cihazı 30 gün hatırla — tekrar kod sorulmasın
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
