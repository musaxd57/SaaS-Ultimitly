"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toggle WhatsApp AI auto-reply for the organization. When on, safe and
 * high-confidence guest WhatsApp messages are answered automatically; complaints
 * and risky messages still wait for a human.
 */
export function AutoReplyToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoReplyWhatsapp: next }),
    });
    setBusy(false);
    if (res.ok) {
      setOn(next);
      router.refresh();
    } else {
      window.alert("Ayar güncellenemedi.");
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title="Açıkken: güvenli ve emin olunan WhatsApp mesajlarına AI otomatik cevap verir. Şikayet/riskli mesajlar her zaman size kalır."
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        on
          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
      WhatsApp oto-yanıt: {on ? "Açık" : "Kapalı"}
    </button>
  );
}
