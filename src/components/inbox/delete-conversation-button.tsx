"use client";

import { useState } from "react";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Delete a conversation (and all of its messages) and return to the inbox.
 * Guarded by the shared confirm dialog since it is irreversible.
 */
export function DeleteConversationButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const ok = await confirmDialog({
      title: "Bu konuşmayı silmek istiyor musunuz?",
      body: "Konuşma ve TÜM mesajları kalıcı olarak silinir. Bu işlem geri alınamaz.",
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/inbox");
        router.refresh();
      } else {
        setBusy(false);
        toast.error("Konuşma silinemedi.");
      }
    } catch {
      setBusy(false);
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    }
  }

  return (
    // UX denetimi 11-13 (C010): "Sil" geri okunun 8 px yanındaydı (onay penceresi var, ama yanlış dokunuş yine de pencereyi açıyordu).
    // Fazladan 16 px aralık; yazı ve davranış aynı.
    <Button variant="outline" size="sm" onClick={remove} disabled={busy} className="ml-4">
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4 text-destructive" />
      )}
      Sil
    </Button>
  );
}
