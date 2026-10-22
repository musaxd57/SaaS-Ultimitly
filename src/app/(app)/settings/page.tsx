import Link from "next/link";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiVoiceForm } from "@/components/settings/ai-voice-form";
import { styleProfileBody } from "@/lib/ai/style-profile";
import { BulkTimesForm } from "@/components/settings/bulk-times-form";
import { NightHoursForm } from "@/components/settings/night-hours-form";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { DataExportButton } from "@/components/settings/data-export-button";
import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";
import { Bot, HeartHandshake, KeyRound, LogOut } from "lucide-react";
import { billingTabAvailable } from "@/lib/billing/billing-tab";
import { AiTestCard } from "@/components/settings/ai-test-card";
import { TestEmailButton } from "@/components/settings/test-email-button";
import { AlertEmailForm } from "@/components/settings/alert-email-form";
import { TimezoneForm } from "@/components/settings/timezone-form";
import { AutomationPrefsForm } from "@/components/settings/automation-prefs-form";
import { IcalPrivacyForm } from "@/components/settings/ical-privacy-form";
import { AccountCard } from "@/components/settings/account-card";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { HospitableConnectCard } from "@/components/settings/hospitable-connect-card";
import { ChannelHealthLines, type ChannelHealthRow } from "@/components/settings/channel-health-line";
import { connectionHealth, connectionHealthText } from "@/lib/channels/health";
import { PaddlePlans } from "@/components/settings/paddle-plans";
import { cancelNoticeDate } from "@/lib/billing/cancel-notice";
import { checkoutPendingActive } from "@/lib/billing/checkout-pending";
import { TRIAL_END_REASON_IDENTITY_REUSED, TRIAL_IDENTITY_REUSED_MESSAGE } from "@/lib/billing/trial-identity";
import { TRIAL_END_REASON_OPERATOR, TRIAL_OPERATOR_ENDED_MESSAGE } from "@/lib/billing/trial-operator";
import { resumeEnabled } from "@/lib/billing/resume";
import { cardTrialPriceIds, TRIAL_CARD_REQUIRED_MESSAGE } from "@/lib/billing/trial-card-gate";
import {
  SettingsSections,
  type SettingsViewGroup,
  type SettingsViewItem,
} from "@/components/settings/settings-sections";
import { SETTINGS_NAV, deriveInitialViewId } from "@/lib/settings-nav";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { getEntitlement, premiumAllowed, isFounderOrg } from "@/lib/billing/subscription";
import { planChangeEnabled } from "@/lib/billing/plan-change";
import { defaultPlans, annualPriceMinor, annualMonthlyEquivalentMinor } from "@/lib/billing/plans";
import { appLocale, appBillingCurrency } from "@/lib/app-config";
import { isSuperAdmin } from "@/lib/admin";
import { isHospitableOAuthConfigured } from "@/lib/hospitable-oauth";
import { isDemoOrg } from "@/lib/demo-tenant/constants";
import { hostCommitmentAutoEnabled } from "@/lib/guest-commitments-core";
import { orgTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ hospitable?: string; tab?: string }>;
}) {
  const session = await requireManagerSession();
  const { hospitable: hospitableResult, tab: tabParam } = await searchParams;
  // The channel token belongs to THIS account. Its OWNER can connect it
  // themselves (self-service, with instructions), and the operator (super-admin,
  // incl. while impersonating) can also do it for a non-technical customer.
  // Staff/manager-only users just see a neutral note.
  const isOperator = isSuperAdmin(session);
  const isOwner = session.role === "owner";
  const canManageChannel = isOwner || isOperator;
  const hospitableInfo = canManageChannel ? await getConnectionInfo(session.organizationId) : null;
  // Kanal bağlantısı sağlığı (V0 §2f; sağlayıcıdan bağımsız, bağlantı satırının okuma kaydından). Ölçüm yoksa satır çizilmez.
  const healthNow = new Date();
  const channelHealthRows: ChannelHealthRow[] = (
    await prisma.channelConnection.findMany({
      where: { organizationId: session.organizationId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true, lastReadOkAt: true, lastReadErrorAt: true, lastReadErrorKind: true, createdAt: true },
    })
  ).flatMap((c) => {
    const h = connectionHealth(c, healthNow);
    // Bağlantıyı yalnız sahip / operatör onarır; ötekine "yeniden bağlanın" değil nötr çağrı.
    const text = connectionHealthText(h, { canFix: canManageChannel });
    return text ? [{ id: c.id, text, warn: h.state === "error" || h.state === "stale" }] : [];
  });
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
        autoClosingReplyEnabled: true,
        closingReplyText: true,
        lateCheckoutOfferText: true,
        autoTaskFromMessageEnabled: true,
        autoCommitmentsEnabled: true,
        autoSupplyRequestEnabled: true,
        icalShowGuestName: true,
        handoffHoldHours: true,
        autoReplyHospitable: true,
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
  // Yıllık fiyatlar. ⚠️ Env YOKSA boş kalır ve arayüz aylık/yıllık seçicisini
  // HİÇ çizmez — yani yıllık satışa açılması tek başına bir env işidir, kod
  // değişikliği değil. Üçü birden dolu olmadan seçici gösterilmez: iki kademede
  // yıllık, birinde aylık olan bir tablo müşteriyi yanıltır.
  const paddleAnnualPriceByCode: Record<string, string> = {
    free: process.env.PADDLE_PRICE_BASLANGIC_YILLIK?.trim() || "",
    pro: process.env.PADDLE_PRICE_PRO_YILLIK?.trim() || "",
    business: process.env.PADDLE_PRICE_ISLETME_YILLIK?.trim() || "",
  };
  // Tek kural `billingTabAvailable` (gelen kutusu kilitli anahtarı ve konuşma bandı da aynı kurala bakar).
  const paddleReady = isOwner && billingTabAvailable(session.role);
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
  // "Ödemeniz işleniyor" (kurucu onayı 10-10): az önce tamamlanan ödemenin aboneliği henüz yazılmadıysa plan kartları kilitli.
  // Yalnız ödeme kartı çizilirken (Paddle hazır) okunur; okuma hatası sayfayı düşürmez (kilitsiz sayılır — sunucu kapısı ödeme rotasında).
  // Deneme kimliği (kurucu onayı 10-10): deneme aynı ilan / takvim başka hesapta görüldüğü için bittiyse kartta sade not.
  const trialEndReason = paddleReady
    ? ((await prisma.subscription.findUnique({ where: { organizationId: session.organizationId }, select: { trialEndReason: true } }).catch(() => null))
        ?.trialEndReason ?? null)
    : null;
  const checkoutPendingNow =
    paddleReady && !canManagePaddleSub && (await checkoutPendingActive(session.organizationId).catch(() => false));

  // ── İşletme Ayarları › Yapay Zekâ — voice + how the AI answers ───────────────
  const aiView = (
    <>
      <AiVoiceForm
        tone={org?.aiReplyTone ?? "warm"}
        signature={org?.aiSignature ?? ""}
        name={session.name}
        // Yapay zekânın GERÇEKTEN kullandığı gövde (F13): eski — işaretsiz — profil kullanılmaz, burada da gösterilmez
        // ("hazırlanıyor" metni görünür; bir sonraki senkronda yenilenir).
        styleProfile={styleProfileBody(org?.aiStyleProfile)}
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
            closingReply={org?.autoClosingReplyEnabled ?? false}
            closingText={org?.closingReplyText ?? ""}
            lateCheckoutOffer={org?.lateCheckoutOfferText ?? ""}
            taskFromMessage={org?.autoTaskFromMessageEnabled ?? false}
            commitmentsAuto={hostCommitmentAutoEnabled() ? (org?.autoCommitmentsEnabled ?? true) : null}
            supplyRequest={org?.autoSupplyRequestEnabled ?? false}
          />
        </CardContent>
      </Card>
    </>
  );

  // ── OTOMASYON DURUMU (kurucu 10-22 U5: "Olur ama güzel yap görünüşü yerinide") ──────────────────────────────────────────────────
  // Dört açma / kapama anahtarı sekmenin EN ÜSTÜNDE tek kartta, gerçek anahtar biçiminde (ray + top). Eskiden ana AI anahtarı küçük gri
  // bir çip gibi görünüyordu ve sayfanın ~1.500 px aşağısındaydı; üç zamanlanmış mesajın anahtarı da kendi uzun açıklama kartlarının
  // içindeydi. Davranış aynı (aynı alanlar, aynı abonelik kilidi); ayrıntılı açıklamalar aşağıdaki kartlarda kalır. Anahtarlar yalnız
  // BURADA — aynı alan için iki kontrol durum olarak ayrışırdı.
  const automationRows = [
    {
      field: "autoReplyHospitable" as const,
      icon: Bot,
      title: "AI misafir mesajlarını yanıtlasın",
      desc: "Güvenli, düşük riskli cevaplar otomatik gider; riskli ya da belirsiz her mesaj size kalır.",
      enabled: org?.autoReplyHospitable ?? false,
    },
    {
      field: "autoWelcome" as const,
      icon: HeartHandshake,
      title: "Karşılama mesajı",
      desc: "Rezervasyon onaylanınca bir kez gider.",
      enabled: org?.autoWelcome ?? false,
    },
    {
      field: "autoCheckin" as const,
      icon: KeyRound,
      title: "Giriş bilgileri mesajı",
      desc: "Girişe 4 gün kala bir kez gider.",
      enabled: org?.autoCheckin ?? false,
    },
    {
      field: "autoCheckout" as const,
      icon: LogOut,
      title: "Çıkış mesajı",
      desc: "Çıkış günü sabah 08:00'de bir kez gider.",
      enabled: org?.autoCheckout ?? false,
    },
  ];
  const automationStatusView = (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Otomasyon durumu</CardTitle>
        <p className="text-sm text-muted-foreground">Misafire kendiliğinden giden mesajları buradan açıp kapatırsınız.</p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {automationRows.map((r) => (
            <li key={r.field} className="flex items-center gap-3 py-3">
              <span
                aria-hidden="true"
                className={
                  r.enabled && !automationLocked
                    ? "flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                }
              >
                <r.icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.title}</p>
                <p id={`automation-${r.field}-desc`} className="text-xs text-muted-foreground">
                  {r.desc}
                </p>
              </div>
              <AutoReplyToggle
                variant="switch"
                field={r.field}
                label={r.title}
                enabled={r.enabled}
                locked={automationLocked}
                describedBy={`automation-${r.field}-desc`}
              />
            </li>
          ))}
        </ul>
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Karşılama, giriş ve çıkış mesajları AI&apos;dan geçmez ve AI anahtarından bağımsızdır: her dairenin{" "}
          <Link href="/properties" className="underline underline-offset-2">
            mülk sayfasındaki
          </Link>{" "}
          &quot;Otomatik mesajlar&quot; bölümüne yazdığınız metin aynen gider.
          {automationLocked ? " Aboneliğiniz aktif değil; otomatik mesajlar şu an duraklatıldı." : null}
        </p>
      </CardContent>
    </Card>
  );

  // ── İşletme Ayarları › Otomatik Mesajlar — the scheduled messages ────────────
  const autoMessagesView = (
    <>
      {/* ── AI ANA ANAHTARI (kurucu 09-12) ──────────────────────────────────
          🚨 Bu anahtar Ayarlar'da HİÇ YOKTU (yalnız Mesajlar sayfasının
          üstünde). Panel onboarding'i host'u `/settings`e gönderiyor ve
          anahtar orada olmadığı için ÇIKMAZ SOKAKTI.

          🚨 AD DEĞİŞTİ: "Otomatik yanıt" host'a "her otomatik mesaj" diye
          okunuyordu. Kodda ölçülen gerçek: bu alan YALNIZ misafir mesajına
          verilen AI cevabını (`applyChannelAutoReply`) kapatır; aşağıdaki üç
          yaşam-döngüsü mesajı onu SELECT ETMİYOR bile. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI misafir mesajlarını yanıtlasın</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, misafirin <strong>yazdığı mesaja</strong> AI cevap üretir ve güvenlik
            kapısından geçen düşük riskli cevaplar otomatik gider. Riskli veya belirsiz her mesaj
            size bırakılır. Kapatırsanız AI cevap <strong>göndermez</strong>; öneri düğmesi
            Mesajlar ekranında çalışmaya devam eder.
          </p>
          {/* 🚨 BAĞIMSIZLIK AÇIKÇA YAZILI. Ölçüldü: üç gönderici bu alanı
              okumuyor. Eskiden üç ipucu da "Ana şalter de açık olmalı"
              diyordu — ÜÇÜ DE YANLIŞTI ve host "hepsini kapattım" sanıyordu. */}
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <strong>Aşağıdaki üç mesaj bu anahtardan bağımsızdır.</strong> Karşılama, giriş ve
            çıkış mesajları AI&apos;dan geçmez — her dairenin{" "}
            <Link href="/properties" className="underline underline-offset-2">
              mülk sayfasındaki
            </Link>{" "}
            &quot;Otomatik mesajlar&quot; bölümüne yazdığınız metin aynen gider. AI anahtarı kapalıyken de, kendi anahtarları
            açıksa gönderilirler. Dört anahtar da sayfanın üstündeki &quot;Otomasyon durumu&quot; kartındadır.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Otomatik Karşılama Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, <strong>rezervasyon yapılır yapılmaz</strong> (birkaç dakika içinde) o dairenin{" "}
            <strong>karşılama metni</strong> (mülk sayfası → Otomatik mesajlar) <strong>tek sefer</strong> gönderilir
            — sıcak bir &quot;hoş geldiniz / teşekkürler&quot; mesajı (adres/kod/Wi-Fi içermez, onlar
            Giriş Bilgileri&apos;nde). Metne{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> yazarsanız
            misafirin adıyla değiştirilir. Bu özellik açıldıktan <strong>sonra</strong> yapılan
            rezervasyonlara gider; eskilere gönderilmez. Karşılama metni olmayan daireler atlanır.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Otomatik Giriş Bilgileri Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, girişe <strong>4 gün kala</strong> o dairenin{" "}
            <strong>giriş metni</strong> (mülk sayfası → Otomatik mesajlar) misafirin adıyla{" "}
            <strong>tek sefer</strong> gönderilir — adres, kapı/kasa kodu, Wi-Fi gibi pratik
            bilgiler. Metne{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> /{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{daire}"}</code> yazabilirsiniz.
            Bu özellik açıldıktan <strong>sonra</strong> yapılan rezervasyonlara gider; eskilere
            gönderilmez. Giriş metni olmayan daireler atlanır.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Otomatik Çıkış Mesajı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Açıkken, <strong>çıkış günü sabah 08:00&apos;da</strong> o dairenin{" "}
            <strong>çıkış metni</strong> (mülk sayfası → Otomatik mesajlar), misafirin adıyla{" "}
            <strong>tek sefer</strong> aynı-gün hatırlatması olarak gönderilir. Metnin içine{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{isim}"}</code> yazın (örn.
            &quot;Merhaba {"{isim}"}, bugün çıkış günü...&quot;). Çıkış metni olmayan daireler
            atlanır.
          </p>
        </CardContent>
      </Card>

      <NightHoursForm
        startHour={org?.autoReplyStartHour ?? 0}
        endHour={org?.autoReplyEndHour ?? 9}
      />
    </>
  );

  // ── İşletme Ayarları › Bağlantılar — channel connection only ─────────────────
  const hospitableView =
    canManageChannel && hospitableInfo ? (
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
          <ChannelHealthLines rows={channelHealthRows} />
        </CardContent>
      </Card>
    ) : (
      <Card id="hospitable" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="text-base">Kanal Bağlantısı (Airbnb / Booking)</CardTitle>
        </CardHeader>
        <CardContent>
          {isDemoOrg(session.organizationId) ? (
            <p className="text-sm text-muted-foreground">
              Bu bir <strong>örnek hesaptır</strong>: mülkler, rezervasyonlar ve mesajlar kurgusaldır ve
              hiçbir kanala bağlı değildir. Gerçek bir hesapta Airbnb / Booking bağlantısı buradan kurulur;
              kurulduğunda misafir mesajları ve rezervasyonlar otomatik olarak akar.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Airbnb / Booking bağlantısını <strong>hesap sahibi</strong> kurar ve yönetir. Bağlantı yoksa
              hesap sahibinden kurmasını isteyin; kurulduğunda misafir mesajlarınız otomatik olarak buraya
              akmaya başlar.
            </p>
          )}
          <ChannelHealthLines rows={channelHealthRows} />
        </CardContent>
      </Card>
    );

  // Check-in/out times feed AI replies + welcome/check-in messages → AI ve Otomasyon.
  const bulkTimesView = (
    <BulkTimesForm
      defaultCheckIn={sampleProperty?.checkInTime ?? "14:00"}
      defaultCheckOut={sampleProperty?.checkOutTime ?? "11:00"}
    />
  );

  // Calendar-feed guest-name privacy → Genel.
  const icalPrivacyView = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Takvim Akışı Gizliliği</CardTitle>
      </CardHeader>
      <CardContent>
        <IcalPrivacyForm showGuestName={org?.icalShowGuestName ?? false} />
      </CardContent>
    </Card>
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
              locale={appLocale()}
              currency={appBillingCurrency()}
              checkoutPending={checkoutPendingNow}
              trialNotice={
                trialEndReason === TRIAL_END_REASON_IDENTITY_REUSED
                  ? TRIAL_IDENTITY_REUSED_MESSAGE
                  : trialEndReason === TRIAL_END_REASON_OPERATOR
                    ? TRIAL_OPERATOR_ENDED_MESSAGE
                    : null
              }
              subscriptionStatus={entitlement.status}
              resumeEnabled={canManagePaddleSub && resumeEnabled()}
              cardTrialNotice={entitlement.cardRequired ? TRIAL_CARD_REQUIRED_MESSAGE : null}
              // Yenileme iptal edildi (kurucu 10-17): ödenmiş dönem sürerken kullanıcı paketini o tarihe kadar kullanır — tarih işletmenin
              // saat diliminde, uzun biçimde ("17 Kasım 2026").
              cancelScheduledUntil={cancelNoticeDate(entitlement, orgTimezone(org?.timezone), appLocale())}
              annualAvailable={defaultPlans().every((p) => (paddleAnnualPriceByCode[p.code] ?? "") !== "")}
              plans={defaultPlans().map((p) => ({
                code: p.code,
                name: p.name,
                priceMinor: p.priceMinor,
                annualPriceMinor: annualPriceMinor(p.priceMinor),
                annualMonthlyEquivalentMinor: annualMonthlyEquivalentMinor(p.priceMinor),
                currency: p.currency,
                propertyLimit: p.propertyLimit,
                priceId: paddlePriceByCode[p.code] ?? "",
                annualPriceId: paddleAnnualPriceByCode[p.code] ?? "",
                trialPriceId: cardTrialPriceIds()[p.code] ?? "",
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
              olarak), takvim kaynakları, tedarik kayıtları, bilgi tabanı, şablonlar, kullanıcı
              listesi, abonelik ve faturalar, denetim ve onay kayıtları — tek bir JSON dosyası
              olarak indirebilirsiniz. Şifreler, 2FA anahtarları ve kanal bağlantı
              anahtarları hiçbir zaman dâhil edilmez.
            </p>
            {/* U10 (kurucu 10-22): döküm ŞİFREYLE iner + sahibe bilgi e-postası (düz bağlantı değil). */}
            <DataExportButton />
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
            <DeleteAccountCard twoFactorEnabled={Boolean(me?.twoFactorEnabledAt)} />
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
        {automationStatusView}
        {aiView}
        {autoMessagesView}
        {bulkTimesView}
      </>
    ),
    baglantilar: hospitableView,
    genel: (
      <>
        {notificationsView}
        {timezoneView}
        {icalPrivacyView}
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
        description="İşletme, otomasyon ve hesap ayarlarınızı yönetin."
      />

      {/* Master-switch status is operator-only plumbing (an env var, not an in-app
          toggle) — a COMPACT one-line status row, not the old full banner. */}
      {isOperator ? (
        <div
          className={
            masterOn
              ? "flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-300"
              : "flex flex-wrap items-center gap-2 rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300"
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
                <code className="rounded bg-amber-100 dark:bg-amber-500/15 px-1 py-0.5">AUTO_REPLY_ENABLED=1</code>.
              </>
            )}
          </span>
        </div>
      ) : null}

      <SettingsSections groups={groups} initialViewId={initialViewId} />
    </div>
  );
}
