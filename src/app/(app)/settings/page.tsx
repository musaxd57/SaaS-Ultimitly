import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiVoiceForm } from "@/components/settings/ai-voice-form";
import { BulkTimesForm } from "@/components/settings/bulk-times-form";
import { NightHoursForm } from "@/components/settings/night-hours-form";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";
import { AiTestCard } from "@/components/settings/ai-test-card";
import { TestEmailButton } from "@/components/settings/test-email-button";
import { AlertEmailForm } from "@/components/settings/alert-email-form";
import { TimezoneForm } from "@/components/settings/timezone-form";
import { AutomationPrefsForm } from "@/components/settings/automation-prefs-form";
import { IcalPrivacyForm } from "@/components/settings/ical-privacy-form";
import { AccountCard } from "@/components/settings/account-card";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { HospitableConnectCard } from "@/components/settings/hospitable-connect-card";
import { PaddlePlans } from "@/components/settings/paddle-plans";
import {
  SettingsSections,
  type SettingsViewGroup,
  type SettingsViewItem,
} from "@/components/settings/settings-sections";
import { SETTINGS_NAV, deriveInitialViewId } from "@/lib/settings-nav";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { getEntitlement, premiumAllowed, isFounderOrg } from "@/lib/billing/subscription";
import { planChangeEnabled } from "@/lib/billing/plan-change";
import { DEFAULT_PLANS } from "@/lib/billing/plans";
import { isSuperAdmin } from "@/lib/admin";
import { isHospitableOAuthConfigured } from "@/lib/hospitable-oauth";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ hospitable?: string; tab?: string }>;
}) {
  const session = await requireAuth();
  const { hospitable: hospitableResult, tab: tabParam } = await searchParams;
  // The channel token belongs to THIS account. Its OWNER can connect it
  // themselves (self-service, with instructions), and the operator (super-admin,
  // incl. while impersonating) can also do it for a non-technical customer.
  // Staff/manager-only users just see a neutral note.
  const isOperator = isSuperAdmin(session);
  const isOwner = session.role === "owner";
  const canManageChannel = isOwner || isOperator;
  const hospitableInfo = canManageChannel ? await getConnectionInfo(session.organizationId) : null;
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { twoFactorEnabledAt: true },
  });
  // Unused 2FA recovery codes — the card nudges when none exist.
  const recoveryRemaining = me?.twoFactorEnabledAt
    ? await prisma.twoFactorRecoveryCode.count({ where: { userId: session.userId, usedAt: null } })
    : 0;
  // Free/expired tier: automation toggles render inert (server suppresses sends).
  const automationLocked = !(await premiumAllowed(session.organizationId));
  const [org, sampleProperty, properties] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        aiReplyTone: true,
        aiSignature: true,
        aiStyleProfile: true,
        alertEmail: true,
        timezone: true,
        autoReplyDisclosure: true,
        autoHoldingReplyEnabled: true,
        autoClosingReplyEnabled: true,
        closingReplyText: true,
        lateCheckoutOfferText: true,
        autoTaskFromMessageEnabled: true,
        autoSupplyRequestEnabled: true,
        icalShowGuestName: true,
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

  // Paddle plan/upgrade card — OWNER only (billing is an account-owner concern),
  // and only when Paddle is configured (client token + at least one price id).
  // Dormant otherwise, so the whole Faturalandırma section never appears until
  // billing is wired up. Price ids are public. (API auth stays withManage — this
  // is a nav-visibility choice, not an authorization change.)
  const paddleClientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() || "";
  const paddleEnv = process.env.NEXT_PUBLIC_PADDLE_ENV?.trim() === "production" ? "production" : "sandbox";
  const paddlePriceByCode: Record<string, string> = {
    free: process.env.PADDLE_PRICE_BASLANGIC?.trim() || "",
    pro: process.env.PADDLE_PRICE_PRO?.trim() || "",
    business: process.env.PADDLE_PRICE_ISLETME?.trim() || "",
  };
  const paddleReady =
    isOwner &&
    Boolean(paddleClientToken) &&
    Object.values(paddlePriceByCode).some((id) => id.length > 0);
  const entitlement = paddleReady ? await getEntitlement(session.organizationId) : null;
  // Can we offer the Paddle-hosted "manage subscription" portal (change plan /
  // cancel / update card)? Only when the org has a real Paddle subscription AND
  // the server API key is set (the portal link is a server-side Paddle API call).
  const paddleApiReady = Boolean(process.env.PADDLE_API_KEY?.trim());
  const managedSub =
    paddleReady && paddleApiReady
      ? await prisma.subscription.findUnique({
          where: { organizationId: session.organizationId },
          select: { provider: true, providerRef: true, status: true },
        })
      : null;
  // Manageable = a LIVE Paddle subscription (active / past_due). A CANCELED sub
  // still carries a providerRef, but the customer no longer has a subscription to
  // manage — they must be able to start a NEW checkout, so it must NOT lock the
  // cards. (Excluding canceled here re-opens checkout for lapsed customers.)
  const canManagePaddleSub =
    managedSub?.provider === "paddle" &&
    Boolean(managedSub?.providerRef) &&
    managedSub?.status !== "canceled";

  // ── İşletme Ayarları › Yapay Zekâ — voice + how the AI answers ───────────────
  const aiView = (
    <>
      <AiVoiceForm
        tone={org?.aiReplyTone ?? "warm"}
        signature={org?.aiSignature ?? ""}
        name={session.name}
        styleProfile={org?.aiStyleProfile}
      />

      {properties.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI&apos;yı Deneyin</CardTitle>
          </CardHeader>
          <CardContent>
            <AiTestCard properties={properties} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Otomasyon Tercihleri</CardTitle>
        </CardHeader>
        <CardContent>
          <AutomationPrefsForm
            disclosure={org?.autoReplyDisclosure ?? true}
            holdHours={org?.handoffHoldHours ?? 12}
            holdingAck={org?.autoHoldingReplyEnabled ?? false}
            closingReply={org?.autoClosingReplyEnabled ?? false}
            closingText={org?.closingReplyText ?? ""}
            lateCheckoutOffer={org?.lateCheckoutOfferText ?? ""}
            taskFromMessage={org?.autoTaskFromMessageEnabled ?? false}
            supplyRequest={org?.autoSupplyRequestEnabled ?? false}
          />
        </CardContent>
      </Card>
    </>
  );

  // ── İşletme Ayarları › Otomatik Mesajlar — the scheduled messages ────────────
  const autoMessagesView = (
    <>
      <Card>
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
              locked={automationLocked}
              title="Açıkken: yaklaşan rezervasyon onaylarında, o dairenin karşılama mesajı misafire bir kez otomatik gider. Güvenlik ana şalteri (AUTO_REPLY_ENABLED) da açık olmalı."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
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
              locked={automationLocked}
              title="Açıkken: girişe 4 gün kala, o dairenin 'Giriş Talimatı' bilgi tabanı girişi misafire bir kez otomatik gider. Ana şalter (AUTO_REPLY_ENABLED) da açık olmalı."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Otomatik Çıkış Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, <strong>çıkış günü sabah 08:00&apos;da</strong> o dairenin{" "}
            <strong>Çıkış Mesajı</strong> bilgi tabanı girişi, misafirin adıyla{" "}
            <strong>tek sefer</strong> aynı-gün hatırlatması olarak gönderilir. Metnin içine{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> yazın (örn.
            &quot;Merhaba {"{isim}"}, bugün çıkış günü...&quot;). Çıkış girişi olmayan daireler
            atlanır.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AutoReplyToggle
              field="autoCheckout"
              label="Otomatik çıkış mesajı"
              enabled={org?.autoCheckout ?? false}
              locked={automationLocked}
              title="Açıkken: çıkış günü sabah 08:00'da, o dairenin çıkış mesajı misafire bir kez aynı-gün hatırlatması olarak gider. Ana şalter (AUTO_REPLY_ENABLED) da açık olmalı."
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

  // ── İşletme Ayarları › Bağlantılar — channel connection + calendar feed ──────
  const connectionsView = (
    <>
      {canManageChannel && hospitableInfo ? (
        <Card id="hospitable" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="text-base">Airbnb / Booking Bağlantısı</CardTitle>
          </CardHeader>
          <CardContent>
            <HospitableConnectCard
              info={hospitableInfo}
              oauthEnabled={isHospitableOAuthConfigured()}
              oauthResult={hospitableResult}
            />
          </CardContent>
        </Card>
      ) : (
        <Card id="hospitable" className="scroll-mt-24">
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

      <BulkTimesForm
        defaultCheckIn={sampleProperty?.checkInTime ?? "14:00"}
        defaultCheckOut={sampleProperty?.checkOutTime ?? "11:00"}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Takvim Akışı Gizliliği</CardTitle>
        </CardHeader>
        <CardContent>
          <IcalPrivacyForm showGuestName={org?.icalShowGuestName ?? false} />
        </CardContent>
      </Card>
    </>
  );

  // ── İşletme Ayarları › Bildirimler — complaint alert email ───────────────────
  const notificationsView = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Acil Bildirim E-postası</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Misafir <strong>şikayet/iade</strong> yazınca, aşağıdaki <strong>kendi adresinize</strong>{" "}
          anında uyarı maili gider (uyurken bile kaçırmazsınız). Adresi boş bırakırsanız
          hesabınızın e-posta adresi kullanılır.
        </p>
        <AlertEmailForm initial={org?.alertEmail ?? ""} />
        <TestEmailButton />
      </CardContent>
    </Card>
  );

  // ── İşletme Ayarları › Saat Dilimi ───────────────────────────────────────────
  const timezoneView = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saat Dilimi</CardTitle>
      </CardHeader>
      <CardContent>
        <TimezoneForm initial={org?.timezone ?? "Europe/Istanbul"} />
      </CardContent>
    </Card>
  );

  // ── Faturalandırma — subscription (OWNER only, only when Paddle-ready) ────────
  // FOUNDER ORG: internal access is an explicit entitlement (isFounderOrg → never
  // paywalled), NOT a subscription. A leftover sandbox/test Paddle row must not
  // masquerade as a paying customer, and portal/plan-change buttons would hit real
  // Paddle APIs with a stale providerRef — so the founder sees an internal-access
  // note instead of the plan cards.
  const billingView =
    paddleReady && entitlement ? (
      isFounderOrg(session.organizationId) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aboneliğiniz</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              <strong>Kurucu hesabı — dahili erişim.</strong> Bu hesapta tüm özellikler Paddle
              aboneliğinden bağımsız olarak açıktır ve ödeme alınmaz.
            </p>
            <p className="text-xs text-muted-foreground">
              Müşterilerin gördüğü plan/portal kartı bu hesapta gösterilmez. Gerçek ödeme veya plan
              değişikliği testleri için ayrı bir test müşteri hesabı kullanın.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aboneliğiniz</CardTitle>
          </CardHeader>
          <CardContent>
            <PaddlePlans
              clientToken={paddleClientToken}
              environment={paddleEnv}
              email={session.email}
              organizationId={session.organizationId}
              currentPlanCode={entitlement.planCode}
              currentPlanName={entitlement.planName}
              grandfathered={entitlement.grandfathered}
              active={entitlement.active}
              trialDaysLeft={entitlement.trialDaysLeft}
              manageable={canManagePaddleSub}
              planChangeEnabled={canManagePaddleSub && planChangeEnabled()}
              plans={DEFAULT_PLANS.map((p) => ({
                code: p.code,
                name: p.name,
                priceMinor: p.priceMinor,
                currency: p.currency,
                propertyLimit: p.propertyLimit,
                priceId: paddlePriceByCode[p.code] ?? "",
              }))}
            />
          </CardContent>
        </Card>
      )
    ) : null;

  // ── Hesap ve Güvenlik — identity + security, then owner-only data/danger zone ──
  const accountView = (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hesap / Giriş Bilgileri</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountCard email={session.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">İki Adımlı Giriş (2FA)</CardTitle>
        </CardHeader>
        <CardContent>
          <TwoFactorCard
            initialEnabled={Boolean(me?.twoFactorEnabledAt)}
            initialRecoveryRemaining={recoveryRemaining}
          />
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verileriniz (KVKK)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Copy mirrors the export route's ACTUAL content (Codex #34 completed):
                the export now really is comprehensive, so the broad claim is honest. */}
            <p className="text-sm text-muted-foreground">
              İşletmenize ait verileri — daireler, rezervasyonlar, misafir konuşmaları ve mesajlar
              (AI karar bilgileri dâhil), görevler ve görev güncellemeleri (fotoğraflar bağlantı
              olarak), takvim kaynakları, tedarik kayıtları, bilgi bankası, şablonlar, kullanıcı
              listesi, abonelik ve faturalar, denetim ve onay kayıtları — tek bir JSON dosyası
              olarak indirebilirsiniz. Şifreler, 2FA anahtarları ve Hospitable bağlantı
              token&apos;ları hiçbir zaman dâhil edilmez.
            </p>
            <a
              href="/api/account/export"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Verilerimi indir (JSON)
            </a>
            <p className="text-xs text-muted-foreground">
              Belirli bir misafire ait verileri silmek için ilgili rezervasyonu ve konuşmayı
              panelden silebilirsiniz; biri diğerini otomatik silmez, bu yüzden tam silme için ikisini de silin.{" "}
              {isOwner && !isOperator ? (
                <>
                  Hesabınızın tamamen silinmesini aşağıdaki <strong>“Hesabı Sil”</strong> bölümünden
                  yapabilirsiniz.
                </>
              ) : (
                <>
                  Hesabın tamamen silinmesi için{" "}
                  <a href="mailto:iletisimlixusai@gmail.com" className="underline hover:text-foreground">
                    iletisimlixusai@gmail.com
                  </a>{" "}
                  adresine yazın.
                </>
              )}{" "}
              Verilerinizin nasıl işlendiğini{" "}
              <a href="/gizlilik" className="underline hover:text-foreground">
                Gizlilik Politikası
              </a>
              ’nda görebilirsiniz.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* KVKK aydınlatma (AI/veri kullanımı) BİLİNÇLİ olarak yalnız Gizlilik
          Politikası'nda (/gizlilik) yaşar — buradaki tekrar-kart kullanıcı
          isteğiyle kaldırıldı (2026-07-15). Yükümlülük politika metniyle
          karşılanıyor; ayarları tekrar kalabalıklaştırma. */}
      {isOwner && !isOperator ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Hesabı Sil</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteAccountCard />
          </CardContent>
        </Card>
      ) : null}
    </>
  );

  // Map view id → its rendered content, then build the nav groups (labels come
  // from SETTINGS_NAV) filtered to the views that actually have content for THIS
  // role. İşletme Ayarları is kept to just THREE sub-views (so the left nav isn't
  // fragmented): AI ve Otomasyon merges the AI cards + the scheduled auto-messages;
  // Genel merges notifications + timezone. Nothing is removed — same cards, fewer
  // pages. Faturalandırma is the only view that can vanish (non-owner, or Paddle
  // not configured); every İşletme view + Hesap ve Güvenlik always has content.
  const viewContent: Record<string, React.ReactNode> = {
    "ai-otomasyon": (
      <>
        {aiView}
        {autoMessagesView}
      </>
    ),
    baglantilar: connectionsView,
    genel: (
      <>
        {notificationsView}
        {timezoneView}
      </>
    ),
    faturalandirma: billingView,
    "hesap-guvenlik": accountView,
  };

  const groups: SettingsViewGroup[] = SETTINGS_NAV.map((g) => ({
    label: g.label,
    items: g.items
      .filter((i) => viewContent[i.id] != null)
      .map<SettingsViewItem>((i) => ({ id: i.id, label: i.label, content: viewContent[i.id] })),
  })).filter((g) => g.items.length > 0);

  const visibleIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const initialViewId = deriveInitialViewId({ hospitable: hospitableResult, tab: tabParam, visibleIds });

  return (
    // Settings uses the FULL shell width (not the old narrow centered column): a
    // compact sticky nav on the left, wide content on the right.
    <div className="w-full space-y-6">
      <PageHeader
        title="Ayarlar"
        description="AI'nın sesi ve otomatik mesaj ayarları."
      />

      {/* Master-switch status is operator-only plumbing (an env var, not an in-app
          toggle) — a COMPACT one-line status row, not the old full banner. */}
      {isOperator ? (
        <div
          className={
            masterOn
              ? "flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800"
              : "flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
          }
        >
          <span
            className={
              masterOn
                ? "inline-block size-2 rounded-full bg-emerald-500"
                : "inline-block size-2 rounded-full bg-amber-500"
            }
            aria-hidden
          />
          <span>
            <strong>Otomatik gönderim ana şalteri: {masterOn ? "AÇIK" : "KAPALI"}.</strong>{" "}
            {masterOn ? (
              "Aşağıdaki seçenekler açıksa mesajlar gerçekten gönderilir."
            ) : (
              <>
                Açmak için Railway&apos;de{" "}
                <code className="rounded bg-amber-100 px-1 py-0.5">AUTO_REPLY_ENABLED=1</code>.
              </>
            )}
          </span>
        </div>
      ) : null}

      <SettingsSections groups={groups} initialViewId={initialViewId} />
    </div>
  );
}
