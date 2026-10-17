"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// UYARI ADRESİ ONAYI (kurucu kararı 09-30). Belirteç URL PARÇASINDAN okunur (sunucuya, kayıtlara, Referer'a girmez) ve adres
// çubuğundan hemen silinir. Onay OTOMATİK GİTMEZ: e-posta güvenlik tarayıcıları bağlantıları kendiliğinden açar — onay ancak
// açık bir tıklamayla (POST) olur. Belirteç depolanmaz (yalnız React durumu).
// ---------------------------------------------------------------------------

type State = "reading" | "ready" | "submitting" | "done" | "failed";

export function AlertEmailVerifyForm() {
  const [state, setState] = useState<State>("reading");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const m = /(?:^#|&)t=([A-Za-z0-9._~%-]+)(?:&|$)/.exec(window.location.hash);
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (!m) {
      setMessage("Bağlantıda onay anahtarı yok. E-postadaki bağlantıyı olduğu gibi açtığınızdan emin olun.");
      setState("failed");
      return;
    }
    setToken(decodeURIComponent(m[1]!));
    setState("ready");
  }, []);

  async function confirm() {
    setState("submitting");
    try {
      const res = await fetch("/api/alert-email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setState("done");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      setMessage(data.fields?._ ?? data.error ?? "Onay şu an tamamlanamadı. Lütfen birazdan tekrar deneyin.");
      setState("failed");
    } catch {
      setMessage("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
      setState("ready");
    }
  }

  if (state === "reading") {
    return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Yükleniyor" />;
  }
  if (state === "done") {
    return (
      <p className="flex items-start gap-2 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        Adres onaylandı. Misafir uyarıları artık bu adrese gönderilecek.
      </p>
    );
  }
  if (state === "failed") {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Bu adres bir Lixus AI hesabında misafir uyarılarının gönderileceği adres olarak girildi. Onaylıyorsanız aşağıdaki
        düğmeye tıklayın. Siz istemediyseniz bu sayfayı kapatabilirsiniz; adres eklenmez.
      </p>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <Button type="button" onClick={() => void confirm()} disabled={state === "submitting"}>
        {state === "submitting" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        Adresi onayla
      </Button>
    </div>
  );
}
