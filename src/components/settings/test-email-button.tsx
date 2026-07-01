"use client";

import { useState } from "react";
import { Mail, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TestEmailButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/test-email", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, msg: `Test e-postası gönderildi → ${data.to}. Gelen kutunu kontrol et.` });
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

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        Test e-postası gönder
      </Button>
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
