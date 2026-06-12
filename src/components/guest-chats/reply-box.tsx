"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Host reply box for a QR guest-chat thread. The reply is stored as the host's
 * message ("Ev sahibiniz") and the guest sees it when they reopen the chat (or
 * live if they keep it open). There's no phone push — the QR is an anonymous web
 * page — so this reaches the guest on their next visit to the chat.
 */
export function GuestChatReply({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/guest-chats/${conversationId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setError("Gönderilemedi. Lütfen tekrar deneyin.");
        return;
      }
      setText("");
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-1 border-t border-border pt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          maxLength={2000}
          placeholder="Misafire yanıt yaz (sohbeti tekrar açınca görür)…"
          className="max-h-28 min-h-[38px] flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="inline-flex h-9 shrink-0 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "…" : "Yanıtla"}
        </button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
