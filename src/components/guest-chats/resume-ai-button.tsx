"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner/manager button to RE-ENABLE the QR AI on a thread it had handed off to the
 * team. Shown only while the thread is in the "human support" (paused) state. Posts
 * to the resume-ai endpoint (which records the resume marker), then refreshes — the
 * guest then sees a "Lixus AI yeniden etkinleştirildi" separator and the AI answers
 * subsequent messages again. There's no auto-resume on a timer by design.
 */
export function GuestChatResumeAi({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/guest-chats/${conversationId}/resume-ai`, { method: "POST" });
      if (!res.ok) {
        setError("Yapılamadı. Lütfen tekrar deneyin.");
        return;
      }
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void resume()}
        disabled={busy}
        className="inline-flex h-8 items-center rounded-md border border-primary/40 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        {busy ? "…" : "🤖 AI yanıtlarını yeniden başlat"}
      </button>
      <span className="text-[11px] text-muted-foreground">
        Siz yazdıkça AI susar; hazır olduğunuzda buradan tekrar açın.
      </span>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
