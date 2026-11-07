"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Ayarlar › Bildirimler › WhatsApp bildirimleri (tasarım §5.4). Numara + rıza → tek kullanımlık kod + "WhatsApp'ta aç" bağlantısı; ev sahibi
 * kodu kendi WhatsApp'ından gönderir, bağlantı etkinleşir. Sunucu `available:false` derse kart HİÇ çizilmez (anahtar kapalı / liste dışı).
 * Metinler taslak — kurucu onayını bekliyor (sabah raporu §4d).
 */

type BindingView = { status: "pending" | "active" | "suspended"; masked: string; expiresAt: string | null };
type Status = { available: false } | { available: true; consentText: string; binding: BindingView | null };
type Started = { code: string; masked: string; expiresAt: string; link: string };

const NETWORK = "İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.";

export function WhatsAppBindingCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [number, setNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/host-channel", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Status;
      setStatus(data);
      if (data.available && data.binding?.status !== "pending") setStarted(null);
    } catch {
      // Kart sessizce gizli kalır; sayfanın geri kalanı etkilenmez.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/host-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: number.trim(), consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.code) setStarted(data as Started);
      else if (res.ok && data.alreadyActive) await load();
      else setError(data.fields?.number ?? data.fields?.consent ?? data.fields?._ ?? data.error ?? "Kod alınamadı.");
    } catch {
      setError(NETWORK);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/host-channel", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Kaldırılamadı.");
      setStarted(null);
      await load();
    } catch {
      setError(NETWORK);
    } finally {
      setBusy(false);
    }
  }

  if (!status || !status.available) return null;
  const binding = status.binding;

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h3 className="text-sm font-semibold">WhatsApp bildirimleri</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Cevabını bilmediğimiz bir misafir sorusu geldiğinde size WhatsApp&apos;tan kısa bir soru gönderelim; cevabınızı oradan yazın.
      </p>

      {binding?.status === "active" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            Bağlı numara: <strong className="tabular-nums">{binding.masked}</strong>
          </p>
          <Button type="button" variant="outline" size="sm" onClick={remove} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Bağlantıyı kaldır
          </Button>
        </div>
      ) : started || binding?.status === "pending" ? (
        <div className="space-y-2">
          {started ? (
            <>
              <p className="text-sm">
                Aşağıdaki kodu <strong className="tabular-nums">{started.masked}</strong> numaralı WhatsApp&apos;ınızdan bize gönderin. Kod 15
                dakika geçerlidir.
              </p>
              <p className="font-mono text-lg font-semibold tracking-wider" aria-label="Bağlama kodu">
                {started.code}
              </p>
              <div className="flex flex-wrap gap-2">
                <a href={started.link} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })}>
                  WhatsApp&apos;ta aç
                </a>
                <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
                  <RefreshCw className="size-4" aria-hidden />
                  Durumu yenile
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm">
                <strong className="tabular-nums">{binding?.masked}</strong> numarasından kodun gelmesi bekleniyor.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
                <RefreshCw className="size-4" aria-hidden />
                Durumu yenile
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
                Vazgeç
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={start} className="space-y-3">
          {binding?.status === "suspended" ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Şifreniz değiştiği için <strong className="tabular-nums">{binding.masked}</strong> numarasına soru gönderilmiyor. Numaranızı yeniden
              doğrulayın.
            </p>
          ) : null}
          <div className="max-w-sm">
            <label htmlFor="host-whatsapp-number" className="mb-1 block text-xs font-medium text-muted-foreground">
              WhatsApp numaranız
            </label>
            <Input
              id="host-whatsapp-number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="+90 532 123 45 67"
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{status.consentText}</span>
          </label>
          <Button type="submit" variant="outline" disabled={busy || !consent || !number.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Kodu al
          </Button>
        </form>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
