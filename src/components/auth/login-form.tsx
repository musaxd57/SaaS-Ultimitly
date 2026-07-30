"use client";

import { useState, useEffect, useRef } from "react";
import { Field } from "@/components/form-field";
import { FormError } from "@/components/form-error";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

/** Form-bazlı hata düğümünün id'si; alanlara aria-describedby ile bağlanır. */
const FORM_ERROR_ID = "login-form-error";

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
  /**
   * ALANA ATFEDİLEBİLEN hatalar. Genel `error`den ayrı tutulur çünkü ikisinin
   * doğru davranışı FARKLIDIR: alan hatası o alanı `aria-invalid` yapar ve
   * `aria-describedby` ile ona bağlanır; "e-posta VEYA şifre hatalı" gibi
   * atfedilemeyen bir hatada hangi alanın yanlış olduğu BİLİNMEZ — ikisini de
   * geçersiz ilan etmek doğru yazılmış adresi de suçlamak olurdu.
   */
  const [fieldError, setFieldError] = useState<{ email?: string; code?: string }>({});
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  // Uçuştaki yeniden-gönderimin SONUCU, isteğin gönderildiği adrese bağlıdır.
  // Alan gönderim sırasında KİLİTLENMEZ (kullanıcı yeni fark ettiği yazım
  // hatasını düzeltebilmeli), o yüzden geç gelen cevabın hangi adrese ait
  // olduğunu bilmek gerekir: adres bu arada değiştiyse eski sonuç YOK SAYILIR —
  // aksi hâlde ekran, hiç mail gitmemiş YENİ adres için "gönderildi" derdi.
  const latestEmail = useRef(email);
  useEffect(() => {
    latestEmail.current = email;
  }, [email]);

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
    setFieldError((f) => (f.email || f.code ? {} : f));
    if (opts.resetResent) setResent(false);
  }

  async function resendVerification() {
    if (!email) {
      // Bu hata TAM OLARAK e-posta alanına aittir — genel banda düşürülürse
      // ekran okuyucu kullanıcısı hangi alanı dolduracağını bilemez.
      setFieldError({ email: "Önce e-posta adresinizi girin." });
      return;
    }
    if (resending) return;
    setResending(true);
    const target = email; // bu isteğin SAHİBİ olan adres
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      // Yarış kapısı: cevap dönene kadar kullanıcı adresi değiştirmişse bu sonuç
      // BAYATTIR — ne başarı ne hata gösterilir (yeni adres için hiçbir şey
      // gönderilmedi). Sadece `resending` finally'de düşer, buton yeniden aktif olur.
      if (latestEmail.current !== target) return;
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
      setFieldError({}); // "önce e-posta girin" uyarısı da bayatladı
      setResent(true);
    } catch {
      if (latestEmail.current !== target) return; // bayat hata da gösterilmez
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setResending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // Alan hataları da sıfırlanır. `error` ile `fieldError` AYRI state'ler
    // olduğundan, birini temizleyip diğerini unutmak alanı yanlışlıkla
    // "geçersiz" damgalı bırakır — üstelik yeni istek henüz sonuçlanmamıştır.
    setFieldError({});
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
        // Kod hatası kod alanına aittir (e-posta/şifre zaten kabul edildi).
        if (res.ok) setFieldError({});
        else setFieldError({ code: data.error ?? "Doğrulama kodu hatalı" });
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
      {/* Atfedilemeyen (form-bazlı) hata: duyurulur ve AŞAĞIDAKİ iki alana
          `aria-describedby` ile bağlanır — alana geri dönen kullanıcı hatayı
          tekrar duyar. `aria-invalid` KONMAZ: hangisinin yanlış olduğu
          bilinmiyor, ikisini de geçersiz ilan etmek yanlış bilgi olurdu. */}
      <FormError id={FORM_ERROR_ID}>{error}</FormError>
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
      <Field label="E-posta" htmlFor="email" error={fieldError.email}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-describedby={error ? FORM_ERROR_ID : undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearStaleFeedback({ resetResent: true });
          }}
          required
        />
      </Field>
      <Field label="Şifre" htmlFor="password">
        <PasswordInput
          id="password"
          autoComplete="current-password"
          aria-describedby={error ? FORM_ERROR_ID : undefined}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearStaleFeedback();
          }}
          required
        />
      </Field>
      {!twoFactor ? (
        <div className="text-right">
          <Link href="/sifremi-unuttum" className="text-sm text-primary hover:underline">
            Şifremi unuttum?
          </Link>
        </div>
      ) : null}
      {twoFactor ? (
        <Field
          label={useRecovery ? "Kurtarma kodu" : "Doğrulama kodu"}
          htmlFor="code"
          error={fieldError.code}
        >
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
        </Field>
      ) : null}
      {twoFactor ? (
        <div className="space-y-2.5">
          {useRecovery ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              <p className="mb-0.5 font-medium text-foreground">Kurtarma koduyla giriş</p>
              <p>
                Kaydettiğiniz tek kullanımlık kurtarma kodlarından birini girin. Kullandığınız kod
                geçersiz olur; kalan kodlarınızı Ayarlar&apos;dan yenileyebilirsiniz.
              </p>
              <p className="mt-1">
                Kurtarma kodlarınız da yoksa{" "}
                <a href="mailto:iletisimlixusai@gmail.com" className="text-primary underline hover:no-underline">
                  iletisimlixusai@gmail.com
                </a>{" "}
                adresinden bize ulaşın.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Telefonunuzdaki Authenticator uygulamasını açıp Lixus AI kodunu girin.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
              setError(null);
              // Alan boşaltıldı ve TÜRÜ değişti: "Doğrulama kodu hatalı"
              // artık geçerli değil, alanı damgalı bırakmamalı.
              setFieldError({});
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
            Bu cihazı 30 gün hatırla
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
