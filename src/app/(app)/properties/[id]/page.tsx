import { isImpersonating } from "@/lib/auth/impersonation";
import Link from "next/link";
import { baseUrlFromHost } from "@/lib/auth/email-verify";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, Brain, CalendarDays, CalendarSync, ArrowDownToLine, MessageSquareText, QrCode } from "lucide-react";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { orgTimezone } from "@/lib/timezone";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { DeleteButton } from "@/components/delete-button";
import { PropertyForm } from "@/components/properties/property-form";
import { SupplyProfileForm } from "@/components/properties/supply-profile-form";
import { parseSupplyProfile } from "@/lib/supply";
import { PackageOpen } from "lucide-react";
import { CalendarFeed } from "@/components/properties/calendar-feed";
import { CalendarSources } from "@/components/properties/calendar-sources";
import { CalendarFileImport } from "@/components/properties/calendar-file-import";
import { GuestChatSettings } from "@/components/properties/guest-chat-settings";
import { ReservationPinControl } from "@/components/properties/reservation-pin-control";
import { listReservationsForPinManagement } from "@/lib/guest-chat-pin";
import { GuestErasureControl } from "@/components/properties/guest-erasure-control";
import { guestErasureEnabled, reservationsWithSourceTombstone } from "@/lib/erasure";
import { generateCalendarToken } from "@/lib/export/ics";
import { getCalendarSourceUrl, maskFeedUrl } from "@/lib/calendar-source-url";
import { KB_CATEGORY, RESERVATION_STATUS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { getMemoryContradictions, getPropertyMemory } from "@/modules/intelligence";
import { MemoryContradictions } from "@/components/properties/memory-contradictions";
import { ActionSuggestions } from "@/components/ai-suggestions/action-suggestions";
import { aiActionSuggestionsEnabled, getPropertyWifiSuggestions } from "@/lib/ai-suggestions/load";
import { getNightlyRate } from "@/modules/intelligence/money/rates";
import { RATE_STALE_DAYS } from "@/modules/intelligence/money/impact";
import { NightlyRateForm } from "@/components/properties/nightly-rate-form";
import { EarlyCheckinRuleForm } from "@/components/properties/early-checkin-rule-form";
import { loadEarlyCheckinRule } from "@/lib/early-checkin/rules";
import { HouseRulesForm } from "@/components/properties/house-rules-form";
import { houseRulesCardEnabled } from "@/lib/house-rules/flag";
import { HistoryLearnPanel } from "@/components/properties/history-learn-panel";
import { historyCompareAllowed, historyLearnEnabled, propertyInstructionsAllowed } from "@/lib/history-learn/service";
import { propertyInstructionsPromptEnabled } from "@/lib/history-learn/prompt-instructions";
import { houseRuleFormValues, loadHouseRules } from "@/lib/house-rules/store";
import { apartmentResolvable, usesApartmentToken } from "@/lib/kb-placeholders";
import { GUEST_DELIVERABLE_KB_WHERE } from "@/lib/kb-review";
import { AutoMessagesCard } from "@/components/properties/auto-messages-card";
import { AUTO_MESSAGE_LABEL } from "@/lib/auto-messages/render";
import { loadAutoMessagesView } from "@/lib/auto-messages/store";
import { LOCAL_TIPS_DEMAND_CAP, LOCAL_TIPS_DEMAND_DAYS, localTipsDemand } from "@/lib/local-tips-demand";
import { localTipsPrefillHref } from "@/lib/kb-prefill";
import { stayGuardEnabled } from "@/lib/ai/semantic/guard";
import { understandingEnabled } from "@/lib/ai/semantic/understand";
import { sentimentTone, signalCategoryLabel, signalKindLabel } from "@/modules/intelligence/labels";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ gecmis?: string | string[] }>;
}) {
  const session = await requireManagerSession();
  // Staff get a read-only view; only owner/manager see edit/delete/sync controls
  // (mirrors the API, which 403s these for staff).
  const canManage = session.role === "owner" || session.role === "manager";
  const { id } = await params;
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      knowledgeBase: { where: { isActive: true }, orderBy: { category: "asc" } },
      reservations: { orderBy: { arrivalDate: "desc" }, take: 5 },
      calendarSources: { orderBy: { createdAt: "asc" } },
      organization: { select: { qrChatPinRequired: true, timezone: true, aiSignature: true } },
    },
  });
  if (!property) notFound();

  // V1 MÜLK HAFIZASI — salt okuma, kiracı+mülk kapsamlı. Okunamazsa sayfa yine çalışır
  // ("AI bozulsa PMS çalışır"): kart "okunamadı" der, hiçbir başka bölüm etkilenmez.
  const memory = await getPropertyMemory(session.organizationId, property.id, 8).catch(() => null);
  // Değişmez 13 (kurucu 10-11): olası çelişki uyarıları — yalnız yönetici; okunamazsa uyarı yok (sayfanın geri kalanı etkilenmez).
  // Destek görünümünde (bürünme, salt-okunur — K8) gösterilmez: "Bilerek böyle" yazması reddedilir (Haiku 4. tur).
  const contradictions =
    canManage && !isImpersonating(session) ? await getMemoryContradictions(session.organizationId, property.id).catch(() => []) : [];
  // Yapay zekâ EYLEM ÖNERİSİ (⑤ ilk dilim, kurucu 10-12): misafire yazılan Wi-Fi bilgisi bilgi tabanındakinden farklıysa "güncelle". Yalnız
  // yönetici, destek görünümünde yok, anahtar kapalıyken üretilmez.
  const wifiSuggestions =
    aiActionSuggestionsEnabled() && canManage && !isImpersonating(session)
      ? await getPropertyWifiSuggestions(session.organizationId, property.id).catch(() => [])
      : [];
  // V2 para etkisi: ev sahibinin tipik gecelik aralığı (isteğe bağlı). Okunamazsa form boş açılır.
  const nightlyRate = canManage ? await getNightlyRate(session.organizationId, property.id).catch(() => null) : null;
  const earlyCheckinRule = canManage ? await loadEarlyCheckinRule(session.organizationId, property.id).catch(() => null) : null;
  // Ev kuralları (#188): kart bayrağı açık + yönetici. Okunamazsa her konu "bana sor" görünür (kural yok = bugünkü davranış).
  const houseRules =
    canManage && houseRulesCardEnabled()
      ? houseRuleFormValues(await loadHouseRules(session.organizationId, property.id).catch(() => []))
      : null;
  // Kurucu T4 (10-21): otomatik mesajlar (karşılama / giriş / çıkış) — giriş mesajı kapı kodu taşıyabilir → yalnız yönetici. Okunamazsa
  // kart çıkmaz (sayfanın geri kalanı etkilenmez).
  const autoMessages = canManage
    ? await loadAutoMessagesView(session.organizationId, property, property.organization.aiSignature?.trim() || undefined).catch(() => null)
    : null;
  const nightlyRateStale = nightlyRate ? Date.now() - nightlyRate.enteredAt.getTime() > RATE_STALE_DAYS * 86_400_000 : false;
  // B1 (kurucu 10-11): mülkte "Yerel Tavsiye" kalemi yokken son 30 günde çevre önerisi soran misafir sayısı — yalnız yönetici.
  // Okunamazsa hatırlatma çıkmaz (sayfanın geri kalanı etkilenmez).
  const localTipsAsked =
    canManage && !property.knowledgeBase.some((k) => k.category === "local_tips")
      ? await localTipsDemand(session.organizationId, property.id).catch(() => 0)
      : 0;

  // QR PIN feature (Faz 5) is master-gated by the env switch; the per-reservation
  // PIN control + strict-mode toggle only appear when it's on AND the host can manage.
  const pinFeatureEnabled = process.env.QR_PIN_ENABLED === "1";
  const showPinControls = canManage && process.env.GUEST_CHAT_ENABLED === "1" && pinFeatureEnabled && property.chatEnabled;

  // For PIN management the "last 5 by arrival desc" list is WRONG (Codex 3): a
  // fully-booked apartment pushes the CURRENTLY-STAYING guest out behind future
  // bookings, so the host couldn't reach it to set a PIN. When the controls are
  // shown, list ACTIVE + UPCOMING stays instead (soonest first, generous window)
  // so every stay that can need a PIN is reachable. Otherwise keep the recent list.
  const reservationList = showPinControls
    ? await listReservationsForPinManagement(property.id)
    : property.reservations;

  // KVKK explicit-erasure (m40): the "already erased" state is decided by an actual
  // TOMBSTONE, not merely a masked name — a retention-anonymized row (no tombstone)
  // must still offer the erasure button, not falsely read as "permanently erased".
  const showErasure = session.role === "owner" && guestErasureEnabled();

  // KVKK erasure REACH (Codex 07-22, P2): the rendered list above is capped (last-5
  // or active+upcoming-25), and the erasure control only renders on listed rows — so
  // an OLD guest's deletion request (KVKK m.11, 30-day SLA) had NO UI surface at all.
  // When erasure is enabled, a separate PAGED full-history list (newest first) makes
  // every reservation reachable without changing anyone else's default view. Always
  // server-side paginated — never an unbounded render.
  const HISTORY_PAGE_SIZE = 25;
  const rawHistPage = (await searchParams)?.gecmis;
  const parsedHistPage = Number.parseInt(
    (Array.isArray(rawHistPage) ? rawHistPage[0] : rawHistPage) ?? "",
    10,
  );
  const historyPage =
    Number.isFinite(parsedHistPage) && parsedHistPage >= 1 ? Math.min(parsedHistPage, 10_000) : 1;
  const historyRows = showErasure
    ? await prisma.reservation.findMany({
        where: { propertyId: property.id },
        orderBy: [{ arrivalDate: "desc" }, { id: "desc" }], // deterministic across equal dates
        skip: (historyPage - 1) * HISTORY_PAGE_SIZE,
        take: HISTORY_PAGE_SIZE + 1, // +1 row = "has a next page" probe
        select: {
          id: true,
          guestName: true,
          arrivalDate: true,
          departureDate: true,
          status: true,
          sourceReference: true,
        },
      })
    : [];
  const historyHasNext = historyRows.length > HISTORY_PAGE_SIZE;
  const historyList = historyRows.slice(0, HISTORY_PAGE_SIZE);

  // Erasure state computed over EVERY rendered row (audit fix precedent): the main
  // list AND the history page — an id appearing in both gets one consistent answer.
  const erasedIds = showErasure
    ? await reservationsWithSourceTombstone(session.organizationId, [
        ...reservationList,
        ...historyList,
      ])
    : new Set<string>();
  // Strict mode with PIN-less active/upcoming stays = those chats are locked until
  // the host generates a code — surface a clear warning on the toggle.
  const pinlessActiveUpcoming = showPinControls
    ? reservationList.filter((r) => r.status !== "cancelled" && !r.chatPinHash).length
    : 0;

  // 🚨 DAİRE NUMARASI OKUNAMADI (kurucu kararı 09-30): `{daire}` kullanan misafire gidebilir kalemler bu mülk için
  // doldurulamıyorsa karşılama / giriş / çıkış mesajı GİTMEZ ve yapay zekâ numarayı söylemez — ev sahibi hangi metnin neden
  // durduğunu burada görür (düzeltme mülk adında). Numara okunabiliyorsa sorgu bile yapılmaz. Kalemler mülke bağlıdır.
  // Kurucu T4: otomatik mesajlar artık ayrı tabloda — onlar da listelenir (gönderilmeyen asıl metinler onlar).
  const apartmentBlocked =
    canManage && !apartmentResolvable(property.name)
      ? [
          ...(autoMessages ?? [])
            .filter((m) => usesApartmentToken(m.body))
            .map((m) => ({ id: `auto-message-${m.kind}`, title: AUTO_MESSAGE_LABEL[m.kind] })),
          ...(
            await prisma.knowledgeBaseItem.findMany({
              where: { propertyId: property.id, ...GUEST_DELIVERABLE_KB_WHERE },
              select: { id: true, title: true, content: true },
              orderBy: { updatedAt: "desc" },
              take: 400,
            })
          ).filter((k) => usesApartmentToken(k.title) || usesApartmentToken(k.content)),
        ]
      : [];

  // Sibling properties (for "copy supply profile to selected apartments").
  const siblings = await prisma.property.findMany({
    where: { organizationId: session.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Lazily ensure the property has a calendar feed token (backfill for
  // properties created before the feature existed).
  let icalToken = property.icalToken;
  // K8 (kurucu kararı 09-28): destek görünümü (bürünme) salt okunur — sayfa açılışı da YAZMAZ; anahtar sahibin ilk ziyaretinde
  // üretilir, o zamana kadar besleme kartı gösterilmez.
  if (!icalToken && !isImpersonating(session)) {
    icalToken = generateCalendarToken();
    await prisma.property.update({ where: { id: property.id }, data: { icalToken } });
  }

  // 🚨 HAM `Host` KULLANILMAZ — GERİ ALMA. Bu URL GİZLİ `icalToken`'ı taşıyor ve
  // host onu kopyalayıp Airbnb/Booking'e yapıştırıyor; token o beslemenin TEK
  // kimlik bilgisi. Sahte bir `Host` başlığı bu satırı
  // `https://saldirgan.com/api/calendar/<token>` yapardı ve host token'ı kendi
  // eliyle saldırgana taşırdı. `baseUrlFromHost` ALLOWLIST'li (localhost/127/
  // canonical/APP_URL host'u); tanınmayan host canonical'a düşer.
  // (CLAUDE.md değişmezi: "Railway arkasında hiçbir route `req.url`/Host'tan
  // mutlak URL kurmasın" — bu sayfa o kuralın dışında kalmış tek yerdi.)
  const headerList = await headers();
  const baseUrl = baseUrlFromHost(headerList.get("host"));
  // Destek görünümünde (bürünme) takvim bağlantısı sayfaya YAZILMAZ (10-01, 15 ajan incelemesi A02-F1): bağlantı kalıcı bir gizli
  // adrestir — 2 saatlik bürünme sınırından, çıkıştan ve operatör listesinden çıkarılmadan SONRA da çalışır, kullanımı denetim kaydına
  // girmez, misafir adını taşıyabilir. QR bağlantısıyla aynı kural (kurucu kararı 09-30).
  const feedUrl = icalToken && !isImpersonating(session) ? `${baseUrl}/api/calendar/${icalToken}` : null;

  return (
    <>
      <PageHeader title={property.name} description="Mülk ayarları ve bilgileri.">
        <LinkButton href="/properties" variant="outline" size="sm">
          <ArrowLeft className="size-4" /> Geri
        </LinkButton>
        {canManage ? (
          <DeleteButton
            endpoint={`/api/properties/${property.id}`}
            redirectTo="/properties"
            label="Mülkü sil"
            confirmText={`“${property.name}” mülkünü silmek istiyor musunuz?`}
            confirmBody="Bu mülkün rezervasyonları, misafir konuşmaları, görevleri, bilgi tabanı ve takvim bağlantıları da kalıcı olarak silinir. Bu işlem geri alınamaz."
          />
        ) : null}
      </PageHeader>

      {/* min-w-0 ZORUNLU, kozmetik DEĞİL: grid çocukları varsayılan olarak
          `min-width:auto` alır, yani sütun İÇERİĞİN min-content'i kadar geniş
          olmak zorundadır. Sağdaki kartta 99 karakterlik iCal feed adresi
          (`white-space:nowrap`) duruyor → sütun 742 px'e şişiyor, `truncate`
          hiç devreye giremiyor ve 390 px'lik telefonda SAYFA YATAY KAYIYORDU
          (ölçüldü: documentElement.scrollWidth 757 → 390). min-w-0 sütunun
          küçülmesine izin verir; kısaltma o zaman gerçekten çalışır. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {apartmentBlocked.length > 0 ? (
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40" data-testid="apartment-number-warning">
              <CardHeader>
                <CardTitle className="text-base">Daire numarası okunamadı</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  Mülk adında daire numarası bulunamadı. Bu yüzden &#123;daire&#125; yazan şu metinler bu mülk için doldurulamıyor:
                </p>
                <ul className="list-disc pl-5">
                  {apartmentBlocked.slice(0, 8).map((k) => (
                    <li key={k.id}>{k.title}</li>
                  ))}
                </ul>
                <p>
                  Bunlardan otomatik mesajlar (karşılama, giriş, çıkış) bu mülke gönderilmez; yapay zekâ da daire numarasını söylemez.
                  Düzeltmek için mülk adına daire numarasını ekleyin (örnek: &quot;Lale Daire 5&quot;).
                </p>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mülk Ayarları</CardTitle>
            </CardHeader>
            <CardContent>
              <PropertyForm
                mode="edit"
                canManage={canManage}
                property={{
                  id: property.id,
                  name: property.name,
                  address: property.address ?? "",
                  city: property.city ?? "",
                  country: property.country ?? "",
                  checkInTime: property.checkInTime,
                  checkOutTime: property.checkOutTime,
                  cleaningBufferMinutes: property.cleaningBufferMinutes,
                  notes: property.notes ?? "",
                }}
              />
              {/* Para içeren ayarlar (gecelik aralık, erken giriş ücreti) YALNIZ yöneticiye görünür — kurucu: temizlik
                  personeli paraya dokunmaz, ücreti görmez (inceleme 09-24). */}
              {canManage ? (
                <>
                  <div className="mt-6 border-t border-border pt-4">
                    <NightlyRateForm
                      propertyId={property.id}
                      canManage={canManage}
                      initial={nightlyRate ? { low: nightlyRate.low, high: nightlyRate.high, currency: nightlyRate.currency } : null}
                      stale={nightlyRateStale}
                    />
                  </div>
                  <div className="mt-6 border-t border-border pt-4">
                    <EarlyCheckinRuleForm
                      propertyId={property.id}
                      canManage={canManage}
                      initial={earlyCheckinRule}
                      autoActive={stayGuardEnabled() && understandingEnabled()}
                    />
                  </div>
                  {houseRules ? (
                    <div className="mt-6 border-t border-border pt-4">
                      <HouseRulesForm propertyId={property.id} canManage={canManage} initial={houseRules} />
                    </div>
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>

          {autoMessages ? (
            <Card id="otomatik-mesajlar" data-testid="auto-messages-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquareText className="size-4 text-muted-foreground" /> Otomatik mesajlar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AutoMessagesCard
                  propertyId={property.id}
                  canEdit={!isImpersonating(session)}
                  items={autoMessages.map((m) => ({
                    kind: m.kind,
                    body: m.body,
                    revision: m.revision,
                    needsReview: m.needsReview,
                    lastSkipReason: m.lastSkipReason,
                    kbChangedAfter: m.kbChangedAfter,
                    preview: m.preview,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageOpen className="size-4 text-muted-foreground" /> Malzeme Profili
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SupplyProfileForm
                propertyId={property.id}
                canManage={canManage}
                initial={parseSupplyProfile(property.supplyProfileJson)}
                siblings={siblings}
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowDownToLine className="size-4 text-muted-foreground" /> Kanal Takvimleri (içe aktar)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CalendarSources
                propertyId={property.id}
                canManage={canManage}
                tz={orgTimezone(property.organization?.timezone)}
                sources={property.calendarSources.map((s) => {
                  // Mask on the SERVER: the raw feed URL is a secret (bearer-like
                  // query token) and must not ride to the browser in the RSC
                  // payload — the old render-time mask still shipped the full
                  // value. Resolve through THE accessor so encrypted (and,
                  // post-contract, sentinel) rows display the same masked host.
                  const resolved = getCalendarSourceUrl(s, session.organizationId);
                  return {
                    id: s.id,
                    label: s.label,
                    urlMasked: resolved.ok ? maskFeedUrl(resolved.url) : "…(çözülemedi)",
                    lastSyncedAt: s.lastSyncedAt ? s.lastSyncedAt.toISOString() : null,
                    lastStatus: s.lastStatus,
                    lastResult: s.lastResult,
                  };
                })}
              />
              {canManage ? (
                <div className="mt-4 border-t border-border pt-3">
                  {/* İKİ AYRI SEÇENEK (kurucu 09-08): yukarısı URL'den DÜZENLİ
                      senkronizasyon, burası TEK SEFERLİK dosya aktarımı. Ayrım
                      başlıkta da yazılı — host hangisini yaptığını bilmeli. */}
                  <p className="mb-2 text-xs font-medium">Dosyadan içe aktar (tek seferlik)</p>
                  <CalendarFileImport propertyId={property.id} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarSync className="size-4 text-muted-foreground" /> Takvim Senkronizasyonu (dışa aktar)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {feedUrl ? (
                <CalendarFeed feedUrl={feedUrl} propertyId={property.id} />
              ) : isImpersonating(session) ? (
                <p className="text-sm text-muted-foreground">Destek görünümünde takvim bağlantısı gösterilmez.</p>
              ) : null}
            </CardContent>
          </Card>

          {canManage && process.env.GUEST_CHAT_ENABLED === "1" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <QrCode className="size-4 text-muted-foreground" /> Misafir Chat (QR)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <GuestChatSettings
                  propertyId={property.id}
                  propertyName={property.name}
                  enabled={property.chatEnabled}
                  url={
                    // Destek görünümünde bağlantı sayfaya HİÇ yazılmaz (kurucu kararı 09-30: operatör sohbeti açıp cihaz bağlamasın).
                    property.chatEnabled && property.chatToken && !isImpersonating(session)
                      ? `${baseUrl}/c/${property.chatToken}`
                      : null
                  }
                  supportView={isImpersonating(session)}
                  pinFeatureEnabled={pinFeatureEnabled}
                  strictMode={property.organization.qrChatPinRequired}
                  pinlessActiveUpcoming={pinlessActiveUpcoming}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4 text-muted-foreground" /> Bilgi Tabanı
              </CardTitle>
              <Link href="/knowledge" className="text-xs font-medium text-primary hover:underline">
                Düzenle
              </Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {localTipsAsked > 0 ? (
                <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-testid="local-tips-nudge">
                  Son {LOCAL_TIPS_DEMAND_DAYS} günde {localTipsAsked >= LOCAL_TIPS_DEMAND_CAP ? `${LOCAL_TIPS_DEMAND_CAP}+` : localTipsAsked} misafir
                  çevre önerisi sordu —{" "}
                  <Link href={localTipsPrefillHref(property.id)} className="font-medium underline-offset-2 hover:underline">
                    &apos;Yerel Tavsiye&apos; ekleyin
                  </Link>
                  .
                </p>
              ) : null}
              {property.knowledgeBase.length === 0 ? (
                <p className="text-sm text-muted-foreground">Henüz bilgi eklenmemiş.</p>
              ) : (
                property.knowledgeBase.map((k) => (
                  <div key={k.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{k.title}</span>
                    <Badge tone={KB_CATEGORY.tone(k.category)}>{KB_CATEGORY.label(k.category)}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Geçmişten öğren (migration 65): yönetici + anahtar açık + bürünme DEĞİL (destek görünümü salt-okunur, K8). */}
          {canManage && historyLearnEnabled() && !isImpersonating(session) ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="size-4 text-muted-foreground" /> Geçmişten öğren
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HistoryLearnPanel
                  // Başka daireye geçişte panel yeniden kurulur: eski dairenin yoklaması / geç dönen okuması yeni daireye yazamaz (Haiku 10-15).
                  key={property.id}
                  propertyId={property.id}
                  canCompare={historyCompareAllowed(session)}
                  canInstruct={propertyInstructionsAllowed(session)}
                  instructionsActive={propertyInstructionsPromptEnabled()}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="size-4 text-muted-foreground" /> Mülk Hafızası
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {memory === null ? (
                <p className="text-sm text-muted-foreground">Hafıza şu an okunamadı.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Bu daire için Bilgi Tabanı&apos;nda {memory.facts.length} bilgi kayıtlı
                    {memory.patterns.length > 0 ? ` · ${memory.patterns.length} sık tekrar eden konu` : ""}.
                  </p>
                  <ActionSuggestions items={wifiSuggestions} />
                  <MemoryContradictions
                    propertyId={property.id}
                    items={contradictions.map((c) => ({ memoryIds: c.memoryIds, text: c.text }))}
                  />
                  {memory.patterns.length > 0 ? (
                    <div className="space-y-1">
                      {memory.patterns.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2">
                          {/* Ham başlık ("complaint: 3 sinyal / 40 gün") İç kayıt biçimidir; host'a
                              kategorinin Türkçe adı gösterilir (demo denetimi 09-23). */}
                          <span className="truncate text-sm">Sık tekrar eden konu: {signalCategoryLabel(p.category)}</span>
                          <Badge tone="warning">{p.evidenceCount} kez</Badge>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {memory.recentSignals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Henüz kayıtlı konu yok. Misafir mesajları ve rezervasyon değişiklikleri burada konu olarak birikir.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {memory.recentSignals.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm">
                            {signalCategoryLabel(s.category)}
                            <span className="ml-2 text-xs text-muted-foreground">{formatDate(s.occurredAt)}</span>
                          </span>
                          <Badge tone={sentimentTone(s.sentiment)}>{signalKindLabel(s.kind)}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4 text-muted-foreground" />{" "}
                {showPinControls ? "Aktif & Yaklaşan Rezervasyonlar" : "Son Rezervasyonlar"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reservationList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Rezervasyon yok.</p>
              ) : (
                reservationList.map((r) => (
                  <div key={r.id} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.guestName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(r.arrivalDate)} – {formatDate(r.departureDate)}
                        </p>
                      </div>
                      <Badge tone={RESERVATION_STATUS.tone(r.status)}>
                        {RESERVATION_STATUS.label(r.status)}
                      </Badge>
                    </div>
                    {showPinControls && r.status !== "cancelled" ? (
                      <ReservationPinControl reservationId={r.id} initialHasPin={Boolean(r.chatPinHash)} />
                    ) : null}
                    {showErasure ? (
                      <GuestErasureControl reservationId={r.id} initialErased={erasedIds.has(r.id)} />
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {showErasure ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="size-4 text-muted-foreground" /> Tüm Rezervasyonlar
                  (KVKK Silme)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Silme talebi gönderen misafirin konaklaması yukarıdaki listede yoksa burada
                  bulun — tüm geçmiş, en yeniden eskiye, sayfa sayfa.
                </p>
                {historyList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {historyPage > 1 ? "Bu sayfada kayıt yok." : "Rezervasyon yok."}
                  </p>
                ) : (
                  historyList.map((r) => (
                    <div key={r.id} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{r.guestName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(r.arrivalDate)} – {formatDate(r.departureDate)}
                          </p>
                        </div>
                        <Badge tone={RESERVATION_STATUS.tone(r.status)}>
                          {RESERVATION_STATUS.label(r.status)}
                        </Badge>
                      </div>
                      <GuestErasureControl reservationId={r.id} initialErased={erasedIds.has(r.id)} />
                    </div>
                  ))
                )}
                {historyPage > 1 || historyHasNext ? (
                  <div className="flex items-center justify-between pt-1 text-sm">
                    {historyPage > 1 ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/properties/${property.id}?gecmis=${historyPage - 1}`}
                      >
                        ← Daha yeni
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span className="text-xs text-muted-foreground">Sayfa {historyPage}</span>
                    {historyHasNext ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/properties/${property.id}?gecmis=${historyPage + 1}`}
                      >
                        Daha eski →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
