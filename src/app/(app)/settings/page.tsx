import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { AiVoiceForm } from "@/components/settings/ai-voice-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { aiReplyTone: true, aiSignature: true },
  });

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="AI'nın sesi: yanıt tonu ve her cevabın sonuna eklenecek imzan."
      />
      <AiVoiceForm tone={org?.aiReplyTone ?? "warm"} signature={org?.aiSignature ?? ""} />
    </>
  );
}
