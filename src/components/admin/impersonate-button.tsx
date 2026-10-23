"use client";

import { useState } from "react";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Enter (impersonate) a customer org, then land on its dashboard. */
export function ImpersonateButton({ organizationId, orgName }: { organizationId: string; orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function enter() {
    const ok = await confirmDialog({
      title: `"${orgName}" hesabına girilecek.`,
      body: "Gelen kutusunu ve ayarlarını salt okunur göreceksiniz.",
      confirmLabel: "Hesaba gir",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setBusy(false);
        // Hız sınırı (operatör kimliğine bağlı, 30/saat): sunucunun "çok fazla istek" metni — operatör neden giremediğini bilsin.
        const tooMany = res.status === 429 ? ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error : null;
        toast.error(typeof tooMany === "string" && tooMany ? tooMany : "Hesaba girilemedi.");
      }
    } catch {
      setBusy(false);
      toast.error("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={enter} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
      Hesaba gir
    </Button>
  );
}
