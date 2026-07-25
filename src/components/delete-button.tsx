"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { useRestoreFocusOnIdle } from "@/lib/use-restore-focus";
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
  // Diyalog odağı tetikleyiciye iade eder, AMA hemen ardından setLoading(true)
  // düğmeyi disabled yapıp odağı <body>'ye düşürür. BAŞARIDA satır/sayfa zaten
  // gider (isConnected kapısı boşa odaklamayı önler); HATA dalında düğme geri
  // gelir ve kullanıcı yeniden denemek için odağı orada bulmalıdır.
  const { ref: btnRef, arm } = useRestoreFocusOnIdle<HTMLButtonElement>(loading);

  async function onDelete() {
    if (!(await confirmDialog({ title: confirmText, confirmLabel: label, destructive: true })))
      return;
    arm();
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
    <Button ref={btnRef} variant="destructive" size="sm" onClick={onDelete} disabled={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      {label}
    </Button>
  );
}
