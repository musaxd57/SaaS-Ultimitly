"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Delete a conversation (and all of its messages) and return to the inbox.
 * Guarded by a confirm() since it is irreversible.
 */
export function DeleteConversationButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm("Bu konuşmayı ve tüm mesajlarını kalıcı olarak silmek istiyor musunuz?")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/inbox");
        router.refresh();
      } else {
        setBusy(false);
        window.alert("Konuşma silinemedi.");
      }
    } catch {
      setBusy(false);
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4 text-destructive" />
      )}
      Sil
    </Button>
  );
}
