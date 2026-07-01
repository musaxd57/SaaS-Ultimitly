"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * KVKK right-to-erasure: lets the OWNER permanently delete the whole account +
 * all data. Re-authenticates with the password; the server route (owner-only,
 * impersonation-blocked) does the cascade delete and clears the session.
 */
export function DeleteAccountCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!password) {
      setError("Onaylamak için şifrenizi girin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.fields?.password ?? data?.error ?? "Hesap silinemedi. Lütfen tekrar deneyin.");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Hesabınızı ve <strong>tüm verilerinizi</strong> (daireler, mesajlar, görevler, rezervasyonlar,
        bilgi tabanı) kalıcı olarak siler. Bu işlem <strong>geri alınamaz</strong>. (KVKK — verilerin
        silinmesini isteme hakkı.)
      </p>

      {!open ? (
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
        >
          <Trash2 className="size-4" /> Hesabımı kalıcı olarak sil
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Emin misiniz? Onaylamak için şifrenizi girin — hesap ve tüm veriler kalıcı silinecek.
          </p>
          <Input
            type="password"
            value={password}
            placeholder="Şifreniz"
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={remove} disabled={busy || !password}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Evet, kalıcı olarak sil
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setError(null);
              }}
            >
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
