import Link from "next/link";
import { zonedDayRange } from "@/lib/automation";
import { orgTimezone } from "@/lib/timezone";
import {
  LogIn,
  LogOut,
  MessageSquare,
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  ListChecks,
  Users,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
// ⚠️ `buildDailySummary` ARTIK KULLANILMIYOR (kart kaldırıldı) ama SİLİNMEDİ:
// `/api/reports/daily` onu kullanıyor ve test-pinli bir JSON sözleşmesi.
import { getOpsStats } from "@/lib/reports";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { premiumAllowed } from "@/lib/billing/subscription";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { AttentionPanel } from "@/components/attention-panel";
import { OnboardingGuide, type OnboardingStep } from "@/components/onboarding-guide";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { CONVERSATION_STATUS, PRIORITY, TASK_TYPE } from "@/lib/constants";
import { formatTime, truncate } from "@/lib/utils";
import { isDemoOrg } from "@/lib/demo-tenant/constants";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireAuth();
  const orgId = session.organizationId;
  const now = new Date();
  // "Today" is the host's local calendar day (org timezone), not the server's
  // UTC day — otherwise arrivals/departures can land on the wrong date.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true, aiSignature: true, autoReplyHospitable: true },
  });
  const TZ = orgTimezone(org?.timezone);
  const { start: dayStart, end: dayEnd } = zonedDayRange(now, TZ);
  const scope = { property: { organizationId: orgId } };

  const [stats, arrivalsRaw, departuresRaw, conversations, tasksToday] = await Promise.all([
    getOpsStats(orgId),
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { gte: dayStart, lte: dayEnd },
      },
      include: { property: { select: { name: true, checkInTime: true } } },
      orderBy: { arrivalDate: "asc" },
    }),
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        departureDate: { gte: dayStart, lte: dayEnd },
      },
      include: { property: { select: { name: true, checkOutTime: true } } },
      orderBy: { departureDate: "asc" },
    }),
    prisma.conversation.findMany({
      where: { ...scope, status: { in: ["new", "waiting", "problem"] } },
      include: {
        property: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
    }),
    // Tasks due today (any priority) — the operational "to-do for today".
    prisma.task.findMany({
      where: { ...scope, status: { not: "done" }, dueAt: { gte: dayStart, lte: dayEnd } },
      include: { property: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
    }),
  ]);
  // Collapse duplicate Hospitable rows (same sourceReference) but keep each
  // manual/iCal booking (null sourceReference) — mirrors getOpsStats so the
  // cards and the lists agree and never undercount.
  const dedupeBookings = <T extends { sourceReference: string | null }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (r.sourceReference == null) return true;
      if (seen.has(r.sourceReference)) return false;
      seen.add(r.sourceReference);
      return true;
    });
  };
  const arrivals = dedupeBookings(arrivalsRaw);
  const departures = dedupeBookings(departuresRaw);

  // "Başlarken" onboarding: compute setup progress. The card only renders until
  // every step is done, then disappears for established accounts.
  const [connection, conversationCount, kbCount, premiumOk, attention] = await Promise.all([
    getConnectionInfo(orgId),
    prisma.conversation.count({ where: scope }),
    prisma.knowledgeBaseItem.count({ where: { isActive: true, ...scope } }),
    premiumAllowed(orgId),
    // 🚨 INTELLIGENCE BOZULSA PMS ÇALIŞIR (bounded context kuralı): bu okuma
    // panelin GİRİŞ SAYFASINI 500'e düşüremez. Hata → satır yok, kart basılmaz.
    findAttentionItems(orgId).catch(() => []),
  ]);
  const onboardingSteps: OnboardingStep[] = [
    {
      done: connection.connected,
      title: "Airbnb / Booking bağlantınızı kurun",
      // Açıklama başlığı TEKRARLAMAZ. Altı adımın beşi yeni bilgi veriyordu,
      // bu biri "bağlantınızı kurun"u iki kez söylüyordu: ilk açılışta en çok
      // okunan yüzeyde ölü metin, mobilde de üç satır boşa yer.
      desc: "Bağlandıktan sonra rezervasyonlarınız ve misafir mesajlarınız buraya otomatik akar.",
      href: "/settings#hospitable",
      cta: "Bağlantıyı kur",
    },
    {
      done: stats.totalProperties > 0,
      title: "Daireleriniz hazır olsun",
      desc: "Bağlantı kurulunca daireleriniz otomatik gelir; birkaç dakika sürebilir.",
      href: "/properties",
      cta: "Daireleri gör",
    },
    {
      done: kbCount > 0,
      title: "Bilgi tabanınızı doldurun",
      desc: "AI misafire buradaki bilgilerden cevap verir — Wi-Fi, giriş, otopark, kurallar. Hazır şablonlarla birkaç dakika sürer.",
      href: "/knowledge",
      cta: "Bilgi ekle",
    },
    {
      done: Boolean(org?.aiSignature?.trim()),
      title: "AI sesinizi ve imzanızı ayarlayın",
      desc: "AI'ın tonunu seçin ve mesaj imzanızı ekleyin — misafire sizin üslubunuzla yazsın.",
      href: "/settings",
      cta: "Ayarla",
    },
    {
      done: conversationCount > 0,
      title: "Gelen kutunuzu keşfedin",
      desc: "Her misafir mesajına AI hazır bir cevap önerir — tek tıkla gönderin ya da düzenleyin.",
      href: "/inbox",
      cta: "Gelen kutusu",
    },
    {
      // "Done" must mean AUTOMATION CAN ACTUALLY SEND, not just "toggle is on":
      // an expired trial (premium gate) or a platform master switch that is off
      // silently suppresses every send — showing this step as complete then
      // would be a lie (Codex audit finding).
      done:
        Boolean(org?.autoReplyHospitable) &&
        premiumOk &&
        process.env.AUTO_REPLY_ENABLED === "1",
      title: "Otomatik yanıtı açın",
      // ⚠️ METİN PLANDAN SÖZ ETMEK ZORUNDA (kullanıcı kararı). Bu adımın "done"u
      // `premiumOk` de istiyor (↑yukarıdaki yorum) ama eski metin yalnız
      // "hazır hissettiğinizde açın" diyordu → denemesi biten host 5/6'da
      // kilitleniyor, gönderildiği toggle DEVRE DIŞI çiziliyor ve neden
      // olduğunu hiçbir yerde okumuyordu.
      desc: "Basit sorular kendiliğinden yanıtlanır, şikayet gibi riskli konular her zaman size bırakılır. Otomatik yanıt ücretli planlara dâhildir — deneme süreniz bittiyse önce planınızı seçin.",
      // Toggle'ın ASIL evi Ayarlar (diğer AI ayarlarının yanı). `/inbox` bir
      // liste ekranı; host oraya gidip anahtarı aramak zorunda kalıyordu.
      href: "/settings",
      cta: "Ayarlara git",
    },
  ];

  // Sort today's tasks urgent-first, then by due time.
  const priorityRank: Record<string, number> = { urgent: 0, standard: 1, low: 2 };
  const sortedTasksToday = [...tasksToday].sort(
    (a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1),
  );

  // ⚠️ Özet HESABI da kaldırıldı (kart gitti, ↓render). `capGuests` misafir
  // ADLARINI RSC payload'ına yazan tek yerdi ve kimse çizmiyordu; bırakmak
  // gereksiz bir PII yüzeyi olurdu.

  // Guard against an empty/blank name so the greeting never shows a dangling
  // comma or trailing space (e.g. accounts created without a display name).
  const firstName = session.name?.trim().split(/\s+/)[0] ?? "";
  const greeting = firstName ? `Merhaba, ${firstName} 👋` : "Merhaba 👋";

  return (
    <>
      <PageHeader
        title={greeting}
        description={now.toLocaleDateString("tr-TR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: TZ,
        })}
      />

      {/* Getting-started guide — only until the account is fully set up. */}
      {/* ⚠️ 6/6 kapısı ARTIK BİLEŞENİN İÇİNDE (istemci tarafı) — kutlama anı
          "az önce bitti" bilgisini gerektiriyor ve o yalnız istemcide var.
          Bileşen 6/6'da SSR'da da boş basar, yani flash yok. */}
      {/* Demo (inceleme) hesabında kurulum rehberi YOK: sahte kanal bağlantısı kurulmaz ve
          "Bağlantıyı kur" adımı inceleme ekibine tamamlanamaz bir iş olarak görünürdü. */}
      {isDemoOrg(orgId) ? null : <OnboardingGuide steps={onboardingSteps} />}

      {/* V2.1 — bu kart, hemen aşağıdaki notun tarif ettiği şeyin ta kendisi:
          kutucukların GÖSTEREMEDİĞİ durumları söyler ve SAKİN GÜNDE HİÇ BASMAZ
          (`items.length === 0` → `null`). Önbellek tablosu İSTEMEDİ: hepsi
          mevcut kolonlardan hesaplanıyor, migration yok, hiçbir şey yazılmıyor. */}
      <AttentionPanel items={attention} />

      {/* 🚨 "AI GÜNLÜK ÖZET" KARTI KALDIRILDI (kullanıcı kararı 08-08) — GERİ EKLEME.
          İKİ ayrı kusuru vardı ve ikisi de ölçüldü:
          (1) İÇİNDE AI YOKTU. `buildDailySummary` düz string birleştirmedir; tek
              bir model çağrısı yapmaz. "AI" etiketi ürünün kendi hakkındaki en
              görünür yanlış beyanıydı.
          (2) ÜRETTİĞİ HER SAYI AYNI EKRANDA ZATEN VARDI — altı cümle parçasının
              altısı da: giriş/çıkış sayısı → liste kartlarının rozetleri;
              doluluk % → "Doluluk (bu gece)" kutucuğu; sorunlu sayısı →
              "Sorunlu Konuşmalar"; acil görev → "Acil Görevler"; giriş/çıkış
              isimleri → alttaki listelerin kendisi (üstelik orada SAAT de var,
              özet ise adları 3'te kesiyordu). Yani kart, 40 px aşağıdaki
              bilgiyi daha eksik biçimde tekrar ediyordu.
          ⚠️ `buildDailySummary` ve `/api/reports/daily` DURUYOR — çalışan bir
          JSON sözleşmesi ve test-pinli; kaldırılan yalnız bu KART.
          Gerçek bir AI özeti isteniyorsa tasarımı ayrı: kutucukların
          GÖSTEREMEDİĞİ şeyleri söylemeli (tekrar eden arıza, cevapsız kalıp
          çıkışı yaklaşan misafir, bilgi tabanı boşluğu) ve sakin günde HİÇ
          görünmemeli. Önbellek tablosu ister = migration = ayrı karar. */}

      {/* Stat row — ONE row, no duplicates: arrivals/departures counts already
          live on the list cards right below (their badges), so tiles repeating
          them were pure filler. Every tile here is information the lists do NOT
          show, and every tile carries a hint line so none is a bare number. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          className="lxp-in"
          label="Acil Görevler"
          value={stats.urgentTasks}
          icon={AlertTriangle}
          tone={stats.urgentTasks > 0 ? "destructive" : "default"}
          hint="acil öncelikli açık görev"
          href="/tasks"
        />
        {/* ⚠️ BU KUTUCUK İKİ KEZ DEĞİŞTİ, GEREKÇESİ ÖNEMLİ.
            (1) Eskiden "Bu Gece Kalan" idi ve hint'i "bu gece evde kalan MİSAFİR"
                diyordu — oysa DAİRE sayıyordu (`Reservation`'da kişi sayısı kolonu
                yok, o sayı hiçbir zaman misafir sayısı olamazdı).
            (2) Doluluk gece-katına geçince o sayı doluluk kutucuğuyla AYNI oldu;
                yerine kısa süre "Bugün Boşalan" kondu — ama O DA devir olmayan
                her günde hemen aşağıdaki "Bugünkü Çıkışlar" rozetiyle aynı sayıyı
                gösteriyordu (10 dairelik portföyde günlerin çoğu).
            Şimdiki hâli hiçbir yüzeyde olmayan tek bilgi: aynı gün DEVİR. Temizlik
            çıkış saati ile giriş saati arasına sıkışır — panelin tek deadline'ı. */}
        <StatCard
          className="lxp-in"
          label="Aynı Gün Devir"
          value={stats.sameDayTurnovers}
          icon={Users}
          tone={stats.sameDayTurnovers > 0 ? "warning" : "default"}
          hint="aynı daireye bugün yeni misafir geliyor"
        />
        <StatCard
          className="lxp-in"
          // "bugün" DEĞİL "bu gece": tanım gece-katı (sektör standardı — STR/CoStar,
          // Airbnb, Hostaway, AirDNA hepsi oda-GECESİ üzerinden sayar; Booking'in
          // extranet'indeki "Stayovers" kovası da bu). Bugün çıkışı olan daire,
          // yerine yeni misafir gelmediyse dolu SAYILMAZ — çıkış listede DURUR.
          label="Doluluk (bu gece)"
          value={`%${stats.occupancyRate}`}
          icon={BedDouble}
          // Boş sayısı burada: ayrı kutucuk yapmak doluluğun aritmetik tümleyenini
          // ikinci kez göstermek olurdu.
          hint={`${stats.occupiedToday}/${stats.totalProperties} daire dolu · ${Math.max(0, stats.totalProperties - stats.occupiedToday)} boş`}
          href="/reports"
        />
        <StatCard
          className="lxp-in"
          label="Sorunlu Konuşmalar"
          value={stats.problemConversations}
          icon={AlertTriangle}
          tone={stats.problemConversations > 0 ? "destructive" : "default"}
          hint="insan incelemesi bekleyen"
          href="/inbox?status=problem"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Arrivals */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="size-4 text-muted-foreground" /> Bugünkü Girişler
            </CardTitle>
            <Badge tone="muted">{arrivals.length}</Badge>
          </CardHeader>
          <CardContent>
            {arrivals.length === 0 ? (
              <EmptyState title="Bugün giriş yok" className="py-6" />
            ) : (
              // Busy days (10-15+ arrivals) scroll INSIDE the card (~7 rows
              // visible) instead of stretching the whole page — the header
              // badge still shows the full count, nothing is hidden.
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {arrivals.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.guestName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.property.name}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-muted-foreground">
                    {r.property.checkInTime}
                  </span>
                </div>
              ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Departures */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <LogOut className="size-4 text-muted-foreground" /> Bugünkü Çıkışlar
            </CardTitle>
            <Badge tone="muted">{departures.length}</Badge>
          </CardHeader>
          <CardContent>
            {departures.length === 0 ? (
              <EmptyState title="Bugün çıkış yok" className="py-6" />
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {departures.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.guestName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.property.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-sm font-medium text-muted-foreground">
                      {r.guestCheckoutTime ?? r.property.checkOutTime}
                    </span>
                    {r.guestCheckoutTime ? (
                      <span className="block text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        misafirin verdiği saat
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending messages */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" /> Bekleyen Mesajlar
            </CardTitle>
            <Link href="/inbox" className="text-xs font-medium text-primary hover:underline">
              Tümü
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title={connection.connected ? "Bekleyen mesaj yok" : "Henüz mesaj yok"}
                description={
                  connection.connected
                    ? "Tüm konuşmalar güncel."
                    : "Airbnb / Booking bağlantısını kurunca misafir mesajları burada görünür."
                }
                className="py-6"
              />
            ) : (
              conversations.map((c) => (
                <Link
                  key={c.id}
                  href={`/inbox/${c.id}`}
                  className="block rounded-lg border border-border px-3 py-2 hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{c.guestIdentifier}</p>
                    <Badge tone={CONVERSATION_STATUS.tone(c.status)} className="shrink-0">
                      {CONVERSATION_STATUS.label(c.status)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.messages[0] ? truncate(c.messages[0].body, 70) : c.property.name}
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Today's tasks */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4 text-muted-foreground" /> Bugünkü Görevler
            </CardTitle>
            <Link href="/tasks" className="text-xs font-medium text-primary hover:underline">
              Tümü
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {sortedTasksToday.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Bugün görev yok"
                description="Yeni rezervasyonlarda görevler otomatik açılır."
                className="py-6"
              />
            ) : (
              sortedTasksToday.map((t) => (
                <Link
                  key={t.id}
                  href="/tasks"
                  className="block rounded-lg border border-border px-3 py-2 hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t.title}</p>
                    <Badge tone={PRIORITY.tone(t.priority)}>{PRIORITY.label(t.priority)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {TASK_TYPE.label(t.type)} · {t.property.name}
                    {t.dueAt ? ` · ${formatTime(t.dueAt, TZ)}` : ""}
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

    </>
  );
}
