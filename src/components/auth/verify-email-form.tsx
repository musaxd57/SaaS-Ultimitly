"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { FormError } from "@/components/form-error";

// ---------------------------------------------------------------------------
// E-POSTA DOĞRULAMA — token URL FRAGMENT'inden okunur.
//
// 🚨 Fragment HTTP isteğinin parçası DEĞİL: sunucuya, Railway edge log'una,
// vekillere ve `Referer` başlığına HİÇ girmez. Bu token tek başına OTURUM
// bastığı için (şifre sıfırlamadakinin aksine ikinci faktörü yok) sunucu
// tarafında görünür bir yerde taşınması kabul edilemezdi.
//
// ⚠️ `sessionStorage`/`localStorage` KULLANILMAZ — orada yazdığımız an sekme
// kapansa bile diskte kalır. React state'i sayfa yenilenince kaybolur.
// ---------------------------------------------------------------------------

type State = "reading" | "verifying" | "done" | "failed";

const MESSAGES: Record<string, string> = {
  missing: "Bağlantıda doğrulama anahtarı yok. E-postadaki bağlantıyı olduğu gibi açtığınızdan emin olun.",
  expired: "Bu doğrulama bağlantısı artık geçerli değil. Süresi dolmuş ya da daha önce kullanılmış olabilir.",
  error: "Doğrulama şu an tamamlanamadı. Lütfen birazdan tekrar deneyin.",
};

export function VerifyEmailForm() {
  const [state, setState] = useState<State>("reading");
  const [reason, setReason] = useState<string>("error");
  // Çift çağrıyı önler: React 18 StrictMode dev'de effect'i iki kez koşturur ve
  // token TEK KULLANIMLIK — ikinci çağrı "expired" alıp kullanıcıya yanlışlıkla
  // hata gösterirdi.
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

    setState("verifying");
    void (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: decodeURIComponent(m[1]) }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setReason(typeof data.reason === "string" ? data.reason : "error");
          setState("failed");
          return;
        }
        setState("done");
        // Oturum çerezi basıldı; tam sayfa geçişi yapılır ki sunucu bileşenleri
        // yeni çerezle render edilsin (router.push RSC önbelleğini kullanabilir).
        window.location.assign("/dashboard");
      } catch {
        setReason("error");
        setState("failed");
      }
    })();
  }, []);

  if (state === "failed") {
    return (
      <div className="space-y-4">
        <FormError>
          <span className="inline-flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {MESSAGES[reason] ?? MESSAGES.error}
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
    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      {state === "done" ? (
        <>
          <CheckCircle2 className="size-4 text-emerald-600" />
          E-postanız doğrulandı, panele yönlendiriliyorsunuz…
        </>
      ) : (
        <>
          <Loader2 className="size-4 animate-spin" />
          E-postanız doğrulanıyor…
        </>
      )}
    </p>
  );
}
