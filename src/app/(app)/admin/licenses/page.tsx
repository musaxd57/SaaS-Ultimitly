import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating } from "@/lib/auth/impersonation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LicenseQueue } from "@/components/admin/license-queue";
import { licensesEnabled } from "@/lib/licenses/secret";

export const dynamic = "force-dynamic";

// Operatör: işletme belgesi kuyruğu (Faz 1a) — yalnız 2FA'lı operatör, kendi hesabından (bürünmede değil). Veri API'den
// (`/api/admin/licenses`); sayfa yalnız kabuk.
export default async function LicensesQueuePage() {
  const session = await requireAuth();
  if (!isSuperAdmin(session)) redirect("/dashboard");
  if (isImpersonating(session)) redirect("/admin");
  if (!licensesEnabled()) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title="İşletme belgeleri" description="Resmî kayıt okuması, hak sahipliği kanıtı ve karar. Belge dosyası saklanmaz." />
      <Card>
        <CardContent className="pt-6">
          <LicenseQueue />
        </CardContent>
      </Card>
    </div>
  );
}
