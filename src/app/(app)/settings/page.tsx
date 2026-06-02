import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiVoiceForm } from "@/components/settings/ai-voice-form";
import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { aiReplyTone: true, aiSignature: true, autoWelcome: true },
  });

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="AI'nın sesi ve otomatik mesaj ayarları."
      />

      <AiVoiceForm tone={org?.aiReplyTone ?? "warm"} signature={org?.aiSignature ?? ""} />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Otomatik Karşılama Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, yaklaşan rezervasyonlara o dairenin <strong>Karşılama Mesajı</strong> bilgi
            tabanı girişi, misafirin adıyla ve imzanla <strong>tek sefer</strong> otomatik gönderilir.
            Karşılama girişi olmayan daireler atlanır. (Her daire için Bilgi Tabanı'na
            "Karşılama Mesajı" kategorisinde bir giriş ekleyin.)
          </p>
          <AutoReplyToggle
            field="autoWelcome"
            label="Otomatik karşılama"
            enabled={org?.autoWelcome ?? false}
            title="Açıkken: yaklaşan rezervasyon onaylarında, o dairenin karşılama mesajı misafire bir kez otomatik gider. Güvenlik ana şalteri (AUTO_REPLY_ENABLED) da açık olmalı."
          />
        </CardContent>
      </Card>
    </>
  );
}
