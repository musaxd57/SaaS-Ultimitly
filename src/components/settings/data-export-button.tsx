"use client";

import { useId, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";

/**
 * KVKK veri dökümü — ŞİFREYLE (U10, kurucu 10-22: "şifre sorulsun"). Eskiden düz bir bağlantıydı: açık oturumu olan herkes tek tıkla bütün
 * misafir verisini indirebiliyordu. Şimdi düğme şifre alanını açar; doğru şifreyle dosya iner ve sahibe "verileriniz indirildi" e-postası
 * gider. Şifre hiçbir yerde saklanmaz (istek gövdesinde bir kez).
 */
export function DataExportButton() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const errorId = useId();

  async function download() {
    if (busy) return;
    if (!password) {
      setError("İndirmek için şifrenizi girin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
        setError(body?.fields?.password ?? body?.error ?? "İndirilemedi. Lütfen tekrar deneyin.");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "lixus-verilerim.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setPassword("");
      setOpen(false);
      setDone(true);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-1.5">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setDone(false);
            setOpen(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <Download className="size-4" aria-hidden="true" /> Verilerimi indir (JSON)
        </button>
        <p role="status" className="text-xs text-muted-foreground">
          {done ? "İndirildi. Güvenliğiniz için e-posta adresinize bilgi gönderildi." : ""}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void download();
      }}
      className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
    >
      <label htmlFor={fieldId} className="block text-sm font-medium">
        Şifreniz
      </label>
      <p className="text-xs text-muted-foreground">
        Dosya bütün misafir verinizi içerir; güvenlik için şifrenizi soruyoruz. İndirince e-posta adresinize bilgi gider.
      </p>
      <input
        id={fieldId}
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm"
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          aria-disabled={busy || undefined}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 aria-disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
          İndir
        </button>
        <button
          type="button"
          onClick={() => {
            if (busy) return;
            setOpen(false);
            setPassword("");
            setError(null);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Vazgeç
        </button>
      </div>
    </form>
  );
}
