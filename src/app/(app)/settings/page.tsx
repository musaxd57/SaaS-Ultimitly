import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiVoiceForm } from "@/components/settings/ai-voice-form";
import { BulkTimesForm } from "@/components/settings/bulk-times-form";
import { WelcomeTestButton } from "@/components/settings/welcome-test-button";
import { NightHoursForm } from "@/components/settings/night-hours-form";
import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const [org, sampleProperty] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        aiReplyTone: true,
        aiSignature: true,
        autoWelcome: true,
        autoReplyStartHour: true,
        autoReplyEndHour: true,
      },
    }),
    prisma.property.findFirst({
      where: { organizationId: session.organizationId },
      select: { checkInTime: true, checkOutTime: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const masterOn = process.env.AUTO_REPLY_ENABLED === "1";

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="AI'nın sesi ve otomatik mesaj ayarları."
      />

      <div
        className={
          masterOn
            ? "rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            : "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        }
      >
        {masterOn ? (
          <>
            <strong>Otomatik gönderim ana şalteri: AÇIK.</strong> Aşağıdaki toggle'lar
            (gece oto-yanıt / otomatik karşılama) açıksa, mesajlar gerçekten gönderilir.
          </>
        ) : (
          <>
            <strong>Otomatik gönderim ana şalteri: KAPALI.</strong> Aşağıdaki toggle'ları açsanız
            bile <strong>hiçbir otomatik mesaj gönderilmez</strong>. Açmak için Railway'de
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5">AUTO_REPLY_ENABLED=1</code>
            ayarlayın.
          </>
        )}
      </div>

      <AiVoiceForm tone={org?.aiReplyTone ?? "warm"} signature={org?.aiSignature ?? ""} />

      <BulkTimesForm
        defaultCheckIn={sampleProperty?.checkInTime ?? "14:00"}
        defaultCheckOut={sampleProperty?.checkOutTime ?? "11:00"}
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Otomatik Karşılama Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, yaklaşan rezervasyonlara o dairenin <strong>Karşılama Mesajı</strong> bilgi
            tabanı girişi <strong>tek sefer</strong> otomatik gönderilir. Metnin içine{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> yazarsanız,
            gönderirken misafirin adıyla değiştirilir (örn. &quot;Merhaba {"{isim}"}👋&quot; →
            &quot;Merhaba Bircan👋&quot;). Karşılama girişi olmayan daireler atlanır; sadece
            yaklaşan rezervasyonlara gider.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AutoReplyToggle
              field="autoWelcome"
              label="Otomatik karşılama"
              enabled={org?.autoWelcome ?? false}
              title="Açıkken: yaklaşan rezervasyon onaylarında, o dairenin karşılama mesajı misafire bir kez otomatik gider. Güvenlik ana şalteri (AUTO_REPLY_ENABLED) da açık olmalı."
            />
            <WelcomeTestButton />
          </div>
        </CardContent>
      </Card>

      <NightHoursForm
        startHour={org?.autoReplyStartHour ?? 0}
        endHour={org?.autoReplyEndHour ?? 9}
      />
    </>
  );
}
