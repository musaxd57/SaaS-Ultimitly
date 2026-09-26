"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, AlertCircle, ShieldCheck } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Field } from "@/components/form-field";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// E-POSTA DOĞRULAMA — token URL FRAGMENT'inden okunur.
//
// 🚨 Fragment HTTP isteğinin parçası DEĞİL: sunucuya, Railway edge log'una,
// vekillere ve `Referer` başlığına HİÇ girmez.
//
// ⚠️ `sessionStorage`/`localStorage` KULLANILMAZ — orada yazdığımız an sekme
// kapansa bile diskte kalır. React state'i sayfa yenilenince kaybolur.
//
// 🚨 PAROLA ADIMI — HESAP ÖN-ELE-GEÇİRME KAPISI (08-06). KALDIRMA.
// Sayfa eskiden mount'ta token'ı OTOMATİK POST ediyordu ve tek tıkla oturum
// açılıyordu. Bu, bir saldırganın KURBANIN adresiyle kaydolup (register mevcut
// e-postada enumeration'a karşı sessiz 201 döner), sonra kimliksiz
// `resend-verification` ile kurbanın kutusuna token yollatmasına ve KURBANIN
// tıklamasıyla hesabın doğrulanmasına izin veriyordu — ardından saldırgan KENDİ
// parolasıyla giriyordu. Artık doğrulama için parola da gerekiyor: saldırıda
// token kurbanda, parola saldırgandadır; ikisi bir kişide buluşmaz.
//
// ⚠️ Sayfa yenilenirse token kaybolur (fragment adres çubuğundan temizlendi,
// state sıfırlandı) — kullanıcı e-postadaki bağlantıya yeniden tıklar. Token
// TÜKENMEDİĞİ için bağlantı hâlâ çalışır; sunucu tarafında tüketim ancak parola
// doğrulandıktan SONRA olur.
// ---------------------------------------------------------------------------

const FORM_ERROR_ID = "verify-email-form-error";

type State = "reading" | "form" | "submitting" | "done" | "failed";

// Kurtarılamaz durumlar — kullanıcı bu sayfada bir şey yapamaz.
const FATAL: Record<string, string> = {
  missing: "Bağlantıda doğrulama anahtarı yok. E-postadaki bağlantıyı olduğu gibi açtığınızdan emin olun.",
  expired: "Bu doğrulama bağlantısı artık geçerli değil. Süresi dolmuş ya da daha önce kullanılmış olabilir.",
  session_mismatch:
    "Şu an başka bir hesapla giriş yapmış durumdasınız. Önce çıkış yapın, sonra bağlantıya tekrar tıklayın.",
  error: "Doğrulama şu an tamamlanamadı. Lütfen birazdan tekrar deneyin.",
};

// Formda kalınan durum — kullanıcı düzeltip tekrar deneyebilir.
const RETRY: Record<string, string> = {
  password: "Şifre hatalı. Kayıt olurken belirlediğiniz şifreyi girin.",
  error: "Doğrulama şu an tamamlanamadı. Lütfen birazdan tekrar deneyin.",
};

export function VerifyEmailForm() {
  const [state, setState] = useState<State>("reading");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState<string>("error");
  // React 18 StrictMode dev'de effect'i iki kez koşturur; fragment okuma ve
  // adres çubuğu temizliği tek sefer olmalı.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const raw = window.location.hash;
    const m = /(?:^#|&)t=([A-Za-z0-9._~%-]+)(?:&|$)/.exec(raw);
    // Eşleşme OLMASA DA adres çubuğu temizlenir: kırpılmış/bozuk bir token da
    // geçmişte durmamalı. `history.state` KORUNUR — Next App Router'ın
    // yönlendirici durumu o nesnede yaşıyor.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );

    if (!m) {
      setReason("missing");
      setState("failed");
      return;
    }

    setToken(decodeURIComponent(m[1]));
    setState("form");
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof data.reason === "string" ? data.reason : "error";
        setReason(code);
        // Yalnız düzeltilebilir hatalarda formda kalınır; token ölmüşse ya da
        // yabancı bir oturum açıksa bu sayfada yapılacak bir şey kalmaz.
        setState(code in RETRY ? "form" : "failed");
        return;
      }
      setState("done");
      // 2FA açık hesapta sunucu oturum BASMAZ — kullanıcı normal girişten geçer.
      // Tam sayfa geçişi: sunucu bileşenleri yeni çerezle render edilsin
      // (router.push RSC önbelleğini kullanabilir).
      window.location.assign(data.requiresLogin ? "/login" : "/dashboard");
    } catch {
      setReason("error");
      setState("form");
    }
  }

  if (state === "reading") {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Bağlantı okunuyor…
      </p>
    );
  }

  if (state === "done") {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-emerald-600" />
        E-postanız doğrulandı, yönlendiriliyorsunuz…
      </p>
    );
  }

  if (state === "failed") {
    return (
      <div className="space-y-4">
        <FormError>
          <span className="inline-flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {FATAL[reason] ?? FATAL.error}
          </span>
        </FormError>
        <p className="text-sm text-muted-foreground">
          Giriş ekranından yeni bir doğrulama bağlantısı isteyebilirsiniz.
        </p>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Girişe dön
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="inline-flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <span>
          Güvenliğiniz için son bir adım: kayıt olurken belirlediğiniz{" "}
          <strong className="text-foreground">şifreyi</strong> girin. Böylece bu hesabın gerçekten
          size ait olduğundan emin oluyoruz.
        </span>
      </p>
      <Field label="Şifreniz" htmlFor="verify-password">
        <PasswordInput
          id="verify-password"
          autoComplete="current-password"
          autoFocus
          aria-describedby={reason in RETRY ? FORM_ERROR_ID : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      {reason in RETRY && state === "form" ? (
        <FormError id={FORM_ERROR_ID}>{RETRY[reason]}</FormError>
      ) : null}
      <Button type="submit" className="w-full" disabled={state === "submitting" || !password}>
        {state === "submitting" ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Doğrulanıyor…
          </>
        ) : (
          "E-postamı doğrula"
        )}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Şifrenizi hatırlamıyor musunuz?{" "}
        <Link href="/sifremi-unuttum" className="font-medium text-primary hover:underline">
          Şifremi unuttum
        </Link>
      </p>
    </form>
  );
}
