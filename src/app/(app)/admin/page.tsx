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

  const [orgs, leads, auditLogs] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        hospitableTokenEnc: true,
        _count: { select: { properties: true, users: true } },
      },
    }),
    prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        action: true,
        createdAt: true,
        metadataJson: true,
        actor: { select: { email: true } },
        organization: { select: { name: true } },
      },
    }),
  ]);

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
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={`/api/admin/export?orgId=${org.id}`}
                            className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                            title="KVKK veri dışa aktarımı (JSON)"
                          >
                            Veri indir
                          </a>
                          {isSelf ? null : <ImpersonateButton organizationId={org.id} orgName={org.name} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Demo Talepleri ({leads.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Henüz demo talebi yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">İsim</th>
                    <th className="px-4 py-2 font-medium">E-posta</th>
                    <th className="px-4 py-2 font-medium">Telefon</th>
                    <th className="px-4 py-2 font-medium">Mesaj</th>
                    <th className="px-4 py-2 font-medium">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-3 font-medium">{l.name}</td>
                      <td className="px-4 py-3">
                        <a href={`mailto:${l.email}`} className="text-primary hover:underline">{l.email}</a>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                      <td className="px-4 py-3 max-w-xs text-muted-foreground">{l.message ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{dateFmt.format(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Denetim Kayıtları (son 50 işlem)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditLogs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Henüz kayıt yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">İşlem</th>
                    <th className="px-4 py-2 font-medium">Yapan (operatör)</th>
                    <th className="px-4 py-2 font-medium">İşletme</th>
                    <th className="px-4 py-2 font-medium">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium">{log.action}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {(() => {
                          try {
                            const m = log.metadataJson ? JSON.parse(log.metadataJson) : null;
                            return m?.operatorEmail ?? log.actor?.email ?? "—";
                          } catch {
                            return log.actor?.email ?? "—";
                          }
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{log.organization?.name ?? "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {dateFmt.format(log.createdAt)} {log.createdAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
