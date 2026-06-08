"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Link2, Plug, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import type { HospitableConnectionInfo } from "@/lib/hospitable-credentials";

/**
 * Connect THIS organization's own Hospitable account (multi-tenant). Each
 * customer pastes their Personal Access Token once; it is validated and stored
 * encrypted server-side. The founder's original org can one-click "claim" the
 * existing env token instead of re-entering it.
 */
export function HospitableConnectCard({ info }: { info: HospitableConnectionInfo }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "claim" | "disconnect">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function post(body: object, kind: "connect" | "claim") {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/hospitable/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setDone(`Bağlandı — ${data.properties ?? 0} mülk bulundu.`);
        setToken("");
        router.refresh();
      } else {
        setError(data.error ?? "Bağlanılamadı.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm("Hospitable bağlantısını kesmek istediğine emin misin? Mesaj çekme/gönderme durur.")) return;
    setBusy("disconnect");
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/hospitable/connect", { method: "DELETE" });
      if (res.ok) router.refresh();
      else setError("Bağlantı kesilemedi.");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Status line */}
      {info.connected ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Check className="size-4 shrink-0" />
          <span>
            <strong>Bağlı.</strong>{" "}
            {info.ownToken
              ? `Bu hesabın kendi Hospitable bağlantısı kullanılıyor${info.label ? ` (${info.label})` : ""}.`
              : "Sistemin ortak (env) Hospitable bağlantısı kullanılıyor."}
          </span>
        </div>
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <strong>Bağlı değil.</strong> Bu hesabın misafir mesajları çekilemez/gönderilemez.
          Aşağıdan Hospitable hesabını bağla.
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Hospitable&apos;da <strong>Settings → API → Personal Access Token</strong> oluştur, token&apos;ı
        kopyala ve aşağıya yapıştır. Token şifrelenerek saklanır; sadece bu hesabın
        mülklerine erişir.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          post({ token }, "connect");
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <Field label="Hospitable Personal Access Token" htmlFor="hosp-token" className="min-w-[260px] flex-1">
          <Input
            id="hosp-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="hospitable_pat_..."
            autoComplete="off"
          />
        </Field>
        <Button type="submit" disabled={busy !== null || token.trim().length < 10}>
          {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          Bağla
        </Button>
      </form>

      {/* One-click claim of the existing env token (founder's primary org only). */}
      {info.envAvailable && !info.ownToken ? (
        <div className="rounded-md border border-dashed border-muted-foreground/30 p-3">
          <p className="mb-2 text-sm text-muted-foreground">
            Bu sistemde zaten bir Hospitable bağlantısı (ortam değişkeni) var. Tek tıkla bu
            hesaba kalıcı olarak aktarabilirsin — sonra ortak bağlantıya ihtiyaç kalmaz.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => post({ claimEnv: true }, "claim")}
          >
            {busy === "claim" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Mevcut bağlantıyı bu hesaba aktar
          </Button>
        </div>
      ) : null}

      {info.ownToken ? (
        <Button type="button" variant="outline" disabled={busy !== null} onClick={disconnect}>
          {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
          Bağlantıyı kes
        </Button>
      ) : null}

      {done ? (
        <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
          <Check className="size-4" /> {done}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
