"use client";

import { useEffect, useState } from "react";
import { Mail, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Bir kez başarıyla doğrulandıktan sonra buton kalıcı olarak gizlenir (kullanıcı
// isteği — tek seferlik kurulum aracı, sürekli duran bir düğme değil). Bayrak
// tarayıcıda (localStorage) tutulur; sunucu tarafında bir "test edildi" alanı
// taşımaya değmez, temizlenirse buton zararsızca geri gelir.
const STORAGE_KEY = "lixus-test-email-sent";

export function TestEmailButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Daha önceki bir ziyarette gönderilmişse blok hiç görünmez. Effect içinde
  // (SSR/hydration uyumsuzluğu olmasın diye) okunur.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setHidden(true);
    } catch {
      // storage kapalıysa buton görünür kalır — zararsız
    }
  }, []);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/test-email", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, msg: `Test e-postası gönderildi → ${data.to}. Gelen kutunu kontrol et.` });
        try {
          localStorage.setItem(STORAGE_KEY, "1");
        } catch {
          // storage yoksa yalnız bu oturumda gizlenir
        }
      } else {
        const fieldMsg = data?.fields ? Object.values(data.fields)[0] : null;
        setResult({ ok: false, msg: (fieldMsg as string) ?? data?.error ?? "Gönderilemedi." });
      }
    } catch {
      setResult({ ok: false, msg: "İstek gönderilemedi." });
    } finally {
      setBusy(false);
    }
  }

  // Önceki ziyarette doğrulanmış → bölüm tamamen kalkar (yardım metni dahil).
  if (hidden) return null;

  return (
    <div className="space-y-2">
      {/* Başarıdan sonra buton + açıklama kaybolur; yalnız onay satırı kalır. */}
      {!result?.ok ? (
        <>
          <p className="text-xs text-muted-foreground">
            E-postaların geldiğini doğrulamak için bir test maili gönderin:
          </p>
          <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            Test e-postası gönder
          </Button>
        </>
      ) : null}
      {result ? (
        <p
          className={
            result.ok
              ? "flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              : "flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {result.ok ? (
            <Check className="mt-0.5 size-4 shrink-0" />
          ) : (
            <X className="mt-0.5 size-4 shrink-0" />
          )}
          {result.msg}
        </p>
      ) : null}
    </div>
  );
}
