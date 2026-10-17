import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating } from "@/lib/auth/impersonation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AiQualityConsole } from "@/components/admin/ai-quality-console";
import { isDemoOrg } from "@/lib/demo-tenant/constants";

export const dynamic = "force-dynamic";

// Kurucu yapay zekâ kalite konsolu — yalnız 2FA'lı operatör, kendi hesabından. Sayfa YALNIZ işletme listesini taşır; izler API'den
// amaçla (ve kayıtla) okunur (`/api/admin/ai-quality`).
export default async function AiQualityPage() {
  const session = await requireAuth();
  if (!isSuperAdmin(session)) redirect("/dashboard");
  if (isImpersonating(session)) redirect("/admin");

  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

  return (
    <div className="space-y-6">
      <PageHeader title="Yapay Zekâ Kalite Konsolu" description="Cevap kararlarının izi — salt-okuma, her görüntüleme kayıtlı." />
      <Card>
        <CardContent className="pt-6">
          <AiQualityConsole orgs={orgs.filter((o) => !isDemoOrg(o.id))} />
        </CardContent>
      </Card>
    </div>
  );
}
