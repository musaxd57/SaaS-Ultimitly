"use client";

import { useState } from "react";
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
    if (!window.confirm(confirmText)) return;
    setLoading(true);
    const res = await fetch(endpoint, { method: "DELETE" });
    if (res.ok) {
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } else {
      setLoading(false);
      window.alert("Silme işlemi başarısız oldu.");
    }
  }

  return (
    <Button variant="destructive" size="sm" onClick={onDelete} disabled={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      {label}
    </Button>
  );
}
