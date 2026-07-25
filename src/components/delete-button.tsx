"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeleteButtonProps {
  endpoint: string;
  redirectTo?: string;
  label?: string;
  confirmText?: string;
}

export function DeleteButton({
  endpoint,
  redirectTo,
  label = "Sil",
  confirmText = "Bu kaydı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.",
}: DeleteButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    if (!(await confirmDialog({ title: confirmText, confirmLabel: label, destructive: true })))
      return;
    setLoading(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        if (redirectTo) router.push(redirectTo);
        router.refresh();
      } else {
        setLoading(false);
        toast.error("Silme işlemi başarısız oldu.");
      }
    } catch {
      setLoading(false);
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    }
  }

  return (
    <Button variant="destructive" size="sm" onClick={onDelete} disabled={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      {label}
    </Button>
  );
}
