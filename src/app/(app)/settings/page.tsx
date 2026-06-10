import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiVoiceForm } from "@/components/settings/ai-voice-form";
import { BulkTimesForm } from "@/components/settings/bulk-times-form";
import { MessagePreviewButton } from "@/components/settings/message-preview-button";
import { NightHoursForm } from "@/components/settings/night-hours-form";
import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";
import { AiTestCard } from "@/components/settings/ai-test-card";
import { TestEmailButton } from "@/components/settings/test-email-button";
import { AlertEmailForm } from "@/components/settings/alert-email-form";
import { AutomationPrefsForm } from "@/components/settings/automation-prefs-form";
import { AccountCard } from "@/components/settings/account-card";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { HospitableConnectCard } from "@/components/settings/hospitable-connect-card";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { isSuperAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  // The channel token belongs to THIS account. Its OWNER can connect it
  // themselves (self-service, with instructions), and the operator (super-admin,
  // incl. while impersonating) can also do it for a non-technical customer.
  // Staff/manager-only users just see a neutral note.
  const isOperator = isSuperAdmin(session);
  const canManageChannel = session.role === "owner" || isOperator;
  const hospitableInfo = canManageChannel ? await getConnectionInfo(session.organizationId) : null;
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { twoFactorEnabledAt: true },
  });
  const [org, sampleProperty, properties] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        aiReplyTone: true,
        aiSignature: true,
        alertEmail: true,
        autoReplyDisclosure: true,
        handoffHoldHours: true,
        autoWelcome: true,
        autoCheckin: true,
        autoCheckout: true,
        autoReplyStartHour: true,
        autoReplyEndHour: true,
      },
    }),
    prisma.property.findFirst({
      where: { organizationId: session.organizationId },
      select: { checkInTime: true, checkOutTime: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
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
        ) : isOperator ? (
          <>
            <strong>Otomatik gönderim ana şalteri: KAPALI.</strong> Aşağıdaki toggle'ları açsanız
            bile <strong>hiçbir otomatik mesaj gönderilmez</strong>. Açmak için Railway'de
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5">AUTO_REPLY_ENABLED=1</code>
            ayarlayın.
          </>
        ) : (
          <>
            <strong>Otomatik gönderim şu an kapalı.</strong> Aşağıdaki toggle'ları açsanız bile
            otomatik mesaj gönderilmez. Bu özelliği etkinleştirmek için bizimle iletişime geçin.
          </>
        )}
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Hesap / Giriş Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountCard email={session.email} />
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">İki Adımlı Giriş (2FA)</CardTitle>
        </CardHeader>
        <CardContent>
          <TwoFactorCard initialEnabled={Boolean(me?.twoFactorEnabledAt)} />
        </CardContent>
      </Card>

      {canManageChannel && hospitableInfo ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Hospitable Bağlantısı (Airbnb / Booking)</CardTitle>
          </CardHeader>
          <CardContent>
            <HospitableConnectCard info={hospitableInfo} />
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Kanal Bağlantısı (Airbnb / Booking)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Airbnb / Booking bağlantınız <strong>operatörünüz tarafından kurulur ve yönetilir</strong>.
              Sizin bir şey yapmanıza gerek yok — bağlantı kurulduğunda misafir mesajlarınız otomatik
              olarak buraya akmaya başlar.
            </p>
          </CardContent>
        </Card>
      )}

      {properties.length > 0 ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">AI Cevap Testi (gönderMEZ)</CardTitle>
          </CardHeader>
          <CardContent>
            <AiTestCard properties={properties} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Acil Bildirim E-postası</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Misafir <strong>şikayet/iade</strong> yazınca, aşağıdaki <strong>kendi adresinize</strong>{" "}
            anında uyarı maili gider (uyurken bile kaçırmazsınız). Adresi boş bırakırsanız sistem
            varsayılanı kullanılır.
          </p>
          <AlertEmailForm initial={org?.alertEmail ?? ""} />
          <p className="text-xs text-muted-foreground">
            E-postaların geldiğini doğrulamak için bir test maili gönderin:
          </p>
          <TestEmailButton />
        </CardContent>
      </Card>

      <AiVoiceForm tone={org?.aiReplyTone ?? "warm"} signature={org?.aiSignature ?? ""} name={session.name} />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Otomasyon Tercihleri</CardTitle>
        </CardHeader>
        <CardContent>
          <AutomationPrefsForm
            disclosure={org?.autoReplyDisclosure ?? true}
            holdHours={org?.handoffHoldHours ?? 12}
          />
        </CardContent>
      </Card>

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
            Açıkken, <strong>rezervasyon yapılır yapılmaz</strong> (birkaç dakika içinde) o dairenin{" "}
            <strong>Karşılama Mesajı</strong> bilgi tabanı girişi <strong>tek sefer</strong> gönderilir
            — sıcak bir &quot;hoş geldiniz / teşekkürler&quot; mesajı (adres/kod/Wi-Fi içermez, onlar
            Giriş Bilgileri&apos;nde). Metne{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> yazarsanız
            misafirin adıyla değiştirilir. Bu özellik açıldıktan <strong>sonra</strong> yapılan
            rezervasyonlara gider; eskilere gönderilmez. Karşılama girişi olmayan daireler atlanır.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AutoReplyToggle
              field="autoWelcome"
              label="Otomatik karşılama"
              enabled={org?.autoWelcome ?? false}
              title="Açıkken: yaklaşan rezervasyon onaylarında, o dairenin karşılama mesajı misafire bir kez otomatik gider. Güvenlik ana şalteri (AUTO_REPLY_ENABLED) da açık olmalı."
            />
            <MessagePreviewButton
              endpoint="/api/hospitable/welcome-test"
              label="Karşılama önizleme"
              missingNote={'"Karşılama Mesajı" girişi yok'}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Otomatik Giriş Bilgileri Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, girişe <strong>4 gün kala</strong> o dairenin{" "}
            <strong>Giriş Talimatı</strong> bilgi tabanı girişi misafirin adıyla{" "}
            <strong>tek sefer</strong> gönderilir — adres, kapı/kasa kodu, Wi-Fi gibi pratik
            bilgiler. Metne{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> /{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{daire}"}</code> yazabilirsiniz.
            Bu özellik açıldıktan <strong>sonra</strong> yapılan rezervasyonlara gider; eskilere
            gönderilmez. Giriş Talimatı girişi olmayan daireler atlanır.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AutoReplyToggle
              field="autoCheckin"
              label="Otomatik giriş bilgileri"
              enabled={org?.autoCheckin ?? false}
              title="Açıkken: girişe 4 gün kala, o dairenin 'Giriş Talimatı' bilgi tabanı girişi misafire bir kez otomatik gider. Ana şalter (AUTO_REPLY_ENABLED) da açık olmalı."
            />
            <MessagePreviewButton
              endpoint="/api/hospitable/checkin-test"
              label="Giriş bilgileri önizleme"
              missingNote={'"Giriş Talimatı" girişi yok'}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Otomatik Çıkış Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, çıkıştan <strong>bir gün önce akşam 18:00&apos;da</strong> o dairenin{" "}
            <strong>Çıkış Mesajı</strong> bilgi tabanı girişi, misafirin adıyla{" "}
            <strong>tek sefer</strong> gönderilir. Metnin içine{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> yazın (örn.
            &quot;Merhaba {"{isim}"}, yarın çıkış günü...&quot;). Tek gecelik konaklamalara{" "}
            <strong>gönderilmez</strong>; çıkış girişi olmayan daireler atlanır.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AutoReplyToggle
              field="autoCheckout"
              label="Otomatik çıkış mesajı"
              enabled={org?.autoCheckout ?? false}
              title="Açıkken: çıkıştan bir gün önce akşam 18:00'da, o dairenin çıkış mesajı misafire bir kez otomatik gider. Tek gecelik konaklamalara gönderilmez. Ana şalter (AUTO_REPLY_ENABLED) da açık olmalı."
            />
            <MessagePreviewButton
              endpoint="/api/hospitable/checkout-test"
              label="Çıkış önizleme"
              missingNote={'"Çıkış Mesajı" girişi yok'}
            />
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
