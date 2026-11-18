"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, ShieldCheck } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Field } from "@/components/form-field";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { fragmentToken } from "@/lib/fragment-token";

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

const PRIMARY_LINK =
  "inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90";

/**
 * UX-14 (kurucu 11-13 "akışı düşünerek yap"): kurtarılamaz durumda TEK sonraki adım.
 *  · Anahtar yok / süresi dolmuş: giriş ekranı "tekrar gönder" kutusu AÇIK gelir (`?verify=…`, login-form) — eskiden "Girişe dön"
 *    kutuyu kapalı açıyordu, kullanıcı "tekrar gönder"i aramak zorundaydı.
 *  · Başka hesapla oturum açık: "Girişe dön" girişe gidip oturum açık olduğu için panoya atıyordu (döngü) — önce çıkış.
 *  · Bilinmeyen sebep: eski davranış (girişe dön).
 */
export function failedNextStep(reason: string): { href: string; label: string; hint: string | null; apiRoute: boolean } {
  if (reason === "missing" || reason === "expired") {
    return { href: `/login?verify=${reason}`, label: "Yeni bağlantı isteyin", hint: "E-posta adresinizi girip yeni bir doğrulama bağlantısı isteyin.", apiRoute: false };
  }
  if (reason === "session_mismatch") {
    return { href: "/api/auth/logout", label: "Çıkış yapın", hint: null, apiRoute: true };
  }
  return { href: "/login", label: "Girişe dön", hint: "Giriş ekranından yeni bir doğrulama bağlantısı isteyebilirsiniz.", apiRoute: false };
}

// Formda kalınan durum — kullanıcı düzeltip tekrar deneyebilir.
const RETRY: Record<string, string> = {
  password: "Şifre hatalı. Kayıt olurken belirlediğiniz şifreyi girin.",
  error: "Doğrulama şu an tamamlanamadı. Lütfen birazdan tekrar deneyin.",
};

export function VerifyEmailForm() {
  const [state, setState] = useState<State>("reading");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  // F5 (Codex 11-17): başlangıçta BOŞ — eskiden "error" idi ve geçerli bağlantı açılınca, hiçbir işlem yapılmadan "Doğrulama şu an
  // tamamlanamadı" görünüyordu (şifre alanı da hataya bağlanıyordu). Sebep yalnız bir gönderim sonucu ya da anahtarsız açılışla yazılır.
  const [reason, setReason] = useState<string | null>(null);
  // React 18 StrictMode dev'de effect'i iki kez koşturur; fragment okuma ve
  // adres çubuğu temizliği tek sefer olmalı.
  const started = useRef(false);

  // Olay dinleyicisi güncel durumu buradan okur (gönderim sürerken / bittikten sonra gelen bağlantı işlenmez).
  const stateRef = useRef<State>("reading");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    /** Adres çubuğundaki parçayı okur ve HER durumda temizler. */
    function takeFragmentToken(): string | null {
      const token = fragmentToken(window.location.hash);
      // Eşleşme OLMASA DA adres çubuğu temizlenir: kırpılmış/bozuk bir token da
      // geçmişte durmamalı. `history.state` KORUNUR — Next App Router'ın
      // yönlendirici durumu o nesnede yaşıyor.
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
      return token;
    }
    // 🚨 AYNI SEKMEDE AÇILAN BAĞLANTI (Codex 11-10 A4): sayfa açıkken (ör. anahtarsız açılıp "bağlantı geçersiz" gösterirken) e-postadaki
    // GEÇERLİ bağlantı aynı sekmede açılırsa adresin yalnız `#` kısmı değişir, sayfa yeniden yüklenmez — parça yalnız ilk kurulumda
    // okunduğu için geçerli bağlantıda, hiçbir işlem yapılmadan, eski hata ekranı kalıyordu. `replaceState` bu olayı tetiklemez.
    function onHashChange() {
      if (!window.location.hash) return;
      const next = takeFragmentToken();
      if (!next) return; // anahtarsız parça: açık formu bozma
      if (stateRef.current === "submitting" || stateRef.current === "done") return;
      setToken(next);
      setPassword("");
      setReason(null); // yeni bağlantı: önceki denemenin hatası taşınmaz
      setState("form");
    }
    window.addEventListener("hashchange", onHashChange);

    if (!started.current) {
      started.current = true;
      const token = takeFragmentToken();
      if (!token) {
        setReason("missing");
        setState("failed");
      } else {
        setToken(token);
        setReason(null);
        setState("form");
      }
    }
    return () => window.removeEventListener("hashchange", onHashChange);
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
    const next = failedNextStep(reason ?? "error");
    return (
      <div className="space-y-4">
        {/* `FormError` kendi uyarı simgesini basar — içeride ikinci simge yok (UX-14: çift simge). */}
        <FormError>{(reason !== null && FATAL[reason]) || FATAL.error}</FormError>
        {next.hint ? <p className="text-sm text-muted-foreground">{next.hint}</p> : null}
        {next.apiRoute ? (
          // Çıkış bir API rotasıdır (çerezi siler, girişe yönlendirir) — istemci yönlendiricisi değil, tam sayfa geçişi.
          <a href={next.href} className={PRIMARY_LINK}>
            {next.label}
          </a>
        ) : (
          <Link href={next.href} className={PRIMARY_LINK}>
            {next.label}
          </Link>
        )}
      </div>
    );
  }

  const retryText = reason !== null && reason in RETRY ? RETRY[reason] : null;
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
          aria-describedby={retryText !== null && state === "form" ? FORM_ERROR_ID : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      {retryText !== null && state === "form" ? <FormError id={FORM_ERROR_ID}>{retryText}</FormError> : null}
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
