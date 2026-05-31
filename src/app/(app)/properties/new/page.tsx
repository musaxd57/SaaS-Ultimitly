import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { ArrowLeft } from "lucide-react";
import { PropertyForm } from "@/components/properties/property-form";

export const dynamic = "force-dynamic";

export default function NewPropertyPage() {
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
