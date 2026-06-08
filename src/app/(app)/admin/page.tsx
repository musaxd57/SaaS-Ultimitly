import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSuperAdmin } from "@/lib/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCustomerForm } from "@/components/admin/add-customer-form";
import { ImpersonateButton } from "@/components/admin/impersonate-button";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAuth();
  // SUPER-ADMIN ONLY. Anyone else is sent back to their dashboard.
  if (!isSuperAdmin(session)) redirect("/dashboard");

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      hospitableTokenEnc: true,
      _count: { select: { properties: true, users: true } },
    },
  });

  // Primary org (allowed to use the shared env token) = PRIMARY_ORG_ID, or the
  // oldest org — which is the first row since we ordered by createdAt asc.
  const primaryId = process.env.PRIMARY_ORG_ID || orgs[0]?.id;
  const envSet = Boolean(process.env.HOSPITABLE_API_TOKEN);

  function connection(org: (typeof orgs)[number]): { label: string; ok: boolean } {
    if (org.hospitableTokenEnc) return { label: "Kendi bağlantısı", ok: true };
    if (org.id === primaryId && envSet) return { label: "Ortak (env)", ok: true };
    return { label: "Bağlı değil", ok: false };
  }

  const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });

  return (
    <>
      <PageHeader
        title="Operatör Paneli"
        description="Tüm müşteri hesaplarını buradan yönet. Bir hesaba girip onun gelen kutusunu/ayarlarını çalıştırabilir, sonra kendi hesabına dönebilirsin."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Müşteriler ({orgs.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2 font-medium">İşletme</th>
                  <th className="px-4 py-2 font-medium">Daire</th>
                  <th className="px-4 py-2 font-medium">Kullanıcı</th>
                  <th className="px-4 py-2 font-medium">Hospitable</th>
                  <th className="px-4 py-2 font-medium">Eklendi</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => {
                  const conn = connection(org);
                  const isSelf = org.id === session.organizationId;
                  return (
                    <tr key={org.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {org.name}
                        {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(buradasın)</span> : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{org._count.properties}</td>
                      <td className="px-4 py-3 text-muted-foreground">{org._count.users}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            conn.ok
                              ? "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                              : "inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                          }
                        >
                          {conn.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{dateFmt.format(org.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {isSelf ? null : <ImpersonateButton organizationId={org.id} orgName={org.name} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Yeni Müşteri Ekle</CardTitle>
        </CardHeader>
        <CardContent>
          <AddCustomerForm />
        </CardContent>
      </Card>
    </>
  );
}
