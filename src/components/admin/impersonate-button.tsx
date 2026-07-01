"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Enter (impersonate) a customer org, then land on its dashboard. */
export function ImpersonateButton({ organizationId, orgName }: { organizationId: string; orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function enter() {
    if (!confirm(`"${orgName}" hesabına girilecek. Onun gelen kutusunu/ayarlarını göreceksin. Devam?`)) return;
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
        alert("Hesaba girilemedi.");
      }
    } catch {
      setBusy(false);
      alert("Bağlantı hatası.");
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={enter} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
      Hesaba gir
    </Button>
  );
}
