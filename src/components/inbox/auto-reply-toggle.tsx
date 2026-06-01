"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toggle an organization AI auto-reply switch. Generic over the settings field
 * (`autoReplyWhatsapp` for WhatsApp, `autoReplyHospitable` for channel/night
 * auto-reply) so the same control serves both. When on, safe and high-confidence
 * guest messages are answered automatically; complaints and risky messages still
 * wait for a human.
 */
export function AutoReplyToggle({
  field,
  label,
  enabled,
  title,
}: {
  field: "autoReplyWhatsapp" | "autoReplyHospitable";
  label: string;
  enabled: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next }),
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
      title={title}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        on
          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
      {label}: {on ? "Açık" : "Kapalı"}
    </button>
  );
}
