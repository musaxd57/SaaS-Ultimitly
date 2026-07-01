import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { ArrowLeft } from "lucide-react";
import { PropertyForm } from "@/components/properties/property-form";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage() {
  const session = await requireAuth();
  // Staff can't create properties (API 403s); send them back instead of a dead form.
  if (session.role !== "owner" && session.role !== "manager") redirect("/properties");
  return (
    <>
      <PageHeader title="Yeni Mülk" description="Yeni bir mülk ekleyin.">
        <LinkButton href="/properties" variant="outline" size="sm">
          <ArrowLeft className="size-4" /> Geri
        </LinkButton>
      </PageHeader>
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <PropertyForm mode="create" />
        </CardContent>
      </Card>
    </>
  );
}
