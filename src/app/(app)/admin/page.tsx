import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSuperAdmin } from "@/lib/admin";
import { clientIp, parseForwardedFor, pickClientHop, trustedProxyHops } from "@/lib/rate-limit";
import { canonicalMailbox } from "@/lib/email-identity";
import { auditActionLabel } from "@/lib/audit";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCustomerForm } from "@/components/admin/add-customer-form";
import { ImpersonateButton } from "@/components/admin/impersonate-button";
import { Reset2faForm } from "@/components/admin/reset-2fa-form";
import { QualityAuditCard } from "@/components/admin/quality-audit-card";
import { qualityAuditConfigured } from "@/lib/quality-audit";
import { shadowAiEnabled, shadowModel } from "@/lib/shadow-ai";
import { LeadActions } from "@/components/admin/lead-actions";
import { isDemoOrg } from "@/lib/demo-tenant/constants";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAuth();
  // SUPER-ADMIN ONLY. Anyone else is sent back to their dashboard.
  if (!isSuperAdmin(session)) redirect("/dashboard");

  const [orgs, leads, auditLogs, shadowRows] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        hospitableTokenEnc: true,
        // V0.7: bağlantı durumu satırdan (revoked/disconnected görünür); kolon backfill öncesi fallback.
        channelConnections: { where: { provider: "hospitable" }, select: { status: true, revokedReason: true }, take: 1 },
        subscription: { select: { status: true, planCode: true, provider: true, trialEndsAt: true } },
        _count: { select: { properties: true, users: true } },
      },
    }),
    prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        action: true,
        createdAt: true,
        metadataJson: true,
        actor: { select: { email: true } },
        organization: { select: { name: true } },
      },
    }),
    // Gölge pilotu (Aşama-1) — salt-okuma özet. PII yok: kapalı-set kodlar.
    prisma.shadowVerdict.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        model: true,
        gateDecision: true,
        gateRiskType: true,
        verdict: true,
        riskType: true,
        confidence: true,
        agrees: true,
        error: true,
        latencyMs: true,
        organization: { select: { name: true } },
      },
    }),
  ]);

  // Gölge pilot özeti: uyum oranı + iki yönlü ayrışma sayısı (Aşama-2 ham girdisi).
  // YALNIZ AKTİF MODELİN satırları özetlenir — model değiştiğinde (GLM → Luna) iki
  // pilotun satırlarını tek bir uyum oranında toplamak yanıltıcı olurdu.
  const activeShadowModel = shadowModel();
  const activeRows = shadowRows.filter((r) => r.model === activeShadowModel);
  const legacyShadowCount = shadowRows.length - activeRows.length;
  const shadowTotal = activeRows.length;
  const shadowOk = activeRows.filter((r) => r.verdict !== null);
  // Split the no-verdict rows the way the table below does: "pending" = a claim
  // whose process died before a verdict (shown "yarım", NOT a failure), vs a real
  // error string (shown "arıza"). The summary used to lump both into "arıza".
  const shadowHalf = activeRows.filter((r) => r.error === "pending").length;
  const shadowError = activeRows.filter((r) => r.error && r.error !== "pending").length;
  const shadowAgree = shadowOk.filter((r) => r.agrees === true).length;
  const shadowStricter = shadowOk.filter(
    (r) => r.agrees === false && r.gateDecision === "auto_sent",
  ).length; // gölge daha sıkı: kapı gönderdi, gölge tutardı (olası risk-kaçırma adayı)
  const shadowLooser = shadowOk.filter(
    (r) => r.agrees === false && r.gateDecision === "human_review",
  ).length; // gölge daha gevşek: kapı tuttu, gölge gönderirdi (olası yanlış-alarm adayı)

  // ── Operatör teşhisi ────────────────────────────────────────────────────────
  // 1) Proxy başlıkları. `TRUST_X_REAL_IP` / `TRUST_CF_HEADER` bayrakları
  //    "önce CANLI bir isteğin başlıklarını gör" notuyla kapalı bırakıldı
  //    (rate-limit.ts). Burası o notu tek tıkla cevaplanabilir hâle getiriyor:
  //    yeni bir yüzey açmadan (sayfa zaten operatör-only ve force-dynamic) şu
  //    anki isteğin ham zincirini ve limitleyicinin kullandığı IP'yi gösterir.
  //    Ayrı bir "clientIp" kopyası YOK — gerçek fonksiyon çağrılıyor, yoksa
  //    teşhis ile davranış zamanla ayrışırdı.
  const requestHeaders = await headers();
  const xffChain = parseForwardedFor(requestHeaders.get("x-forwarded-for") ?? "");
  const activeHops = trustedProxyHops();
  const proxyHeaders = {
    xff: requestHeaders.get("x-forwarded-for"),
    xRealIp: requestHeaders.get("x-real-ip"),
    cfConnectingIp: requestHeaders.get("cf-connecting-ip"),
    resolved: clientIp({ headers: requestHeaders }),
  };
  // Bayrağı körlemesine çevirmemek için: her aday adımın ne vereceğini ÖNCEDEN
  // göster. Operatör hangi satırın kendi adresi olduğunu bilir, karar bakışla verilir.
  const hopPreview = xffChain.length
    ? [1, 2, 3].filter((h) => h <= xffChain.length).map((h) => ({ hops: h, value: pickClientHop(xffChain, h) }))
    : [];
  // 2) Deneme suistimali kanaryası. `musa+1@`, `m.usa@` ve `musa@` tek posta
  //    kutusudur ama bizim için ayrı hesaplardır → her biri kendi 14 günlük
  //    denemesini alır. Bugün maliyeti düşük (PMS bağlamayan deneme org'u
  //    neredeyse hiçbir şey harcamaz) ve engellemek kimlik davranışını
  //    değiştirir + kalıcı kanonik kolon (migration) ister. O yüzden şimdilik
  //    ENGELLEMİYORUZ, SAYIYORUZ: reklam açıldığında bu sayı sıfırdan
  //    kalkıyorsa politika kararı zamanı gelmiş demektir.
  const ownerEmails = await prisma.user.findMany({
    where: { role: "owner" },
    select: { email: true, organizationId: true },
    take: 5000, // kanarya; tam envanter değil
  });
  const mailboxGroups = new Map<string, Set<string>>();
  for (const u of ownerEmails) {
    const box = canonicalMailbox(u.email);
    const set = mailboxGroups.get(box) ?? new Set<string>();
    set.add(u.organizationId);
    mailboxGroups.set(box, set);
  }
  const sharedMailboxes = [...mailboxGroups.values()].filter((s) => s.size > 1);
  const sharedMailboxOrgs = sharedMailboxes.reduce((n, s) => n + s.size, 0);

  // Primary org (allowed to use the shared env token) = PRIMARY_ORG_ID, or the
  // oldest org — which is the first row since we ordered by createdAt asc.
  const primaryId = process.env.PRIMARY_ORG_ID || orgs[0]?.id;
  const envSet = Boolean(process.env.HOSPITABLE_API_TOKEN);

  function connection(org: (typeof orgs)[number]): { label: string; ok: boolean } {
    // Durum SAKLI veriden — sağlayıcı sağlığı değil (V0.7). Satır varsa otorite.
    const row = org.channelConnections[0];
    const envLabel = org.id === primaryId && envSet ? " · ortak (env) devrede" : "";
    if (row?.status === "revoked") return { label: `İptal edildi (${row.revokedReason ?? "revoked"})${envLabel}`, ok: false };
    if (row?.status === "active" || (!row && org.hospitableTokenEnc)) return { label: "Kendi bağlantısı", ok: true };
    if (row?.status === "disconnected") return { label: `Bağlantı kesildi${envLabel}`, ok: Boolean(envLabel) };
    if (org.id === primaryId && envSet) return { label: "Ortak (env)", ok: true };
    return { label: "Bağlı değil", ok: false };
  }

  // Billing mode at a glance (the operator picks it on create; see admin/customers).
  function billing(org: (typeof orgs)[number]): { label: string; tone: "green" | "amber" | "red" | "gray" } {
    const sub = org.subscription;
    if (!sub) return { label: "Kayıtsız (grandfathered)", tone: "amber" }; // legacy row-less org
    switch (sub.status) {
      case "trialing": {
        const d = sub.trialEndsAt
          ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000))
          : null;
        return { label: d != null ? `Deneme · ${d}g` : "Deneme", tone: "green" };
      }
      case "active":
        return { label: sub.provider === "manual" ? "Manuel · aktif" : `Ücretli · ${sub.provider}`, tone: "green" };
      case "grandfathered":
        return { label: "Ücretsiz / iç hesap", tone: "gray" };
      case "past_due":
        return { label: "Ödeme bekliyor", tone: "amber" };
      case "canceled":
        return { label: "İptal", tone: "red" };
      default:
        return { label: sub.status, tone: "gray" };
    }
  }
  const toneClass: Record<"green" | "amber" | "red" | "gray", string> = {
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300",
    red: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300",
    gray: "bg-muted text-muted-foreground",
  };

  const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });

  return (
    <>
      <PageHeader
        title="Operatör Paneli"
        description="Tüm müşteri hesaplarını buradan yönet. Bir hesaba girip onun gelen kutusunu/ayarlarını çalıştırabilir, sonra kendi hesabına dönebilirsin."
      />

      <Card>
        <CardHeader>
          {/* Demo (inceleme) hesabı müşteri SAYILMAZ — "gerçek kullanım" sayısını şişirmesin
              (kurucu kararı 09-23); satırı listede "Demo" etiketiyle görünür kalır. */}
          <CardTitle className="text-base">Müşteriler ({orgs.filter((o) => !isDemoOrg(o.id)).length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2 font-medium">İşletme</th>
                  <th className="px-4 py-2 font-medium">Daire</th>
                  <th className="px-4 py-2 font-medium">Kullanıcı</th>
                  <th className="px-4 py-2 font-medium">Faturalama</th>
                  <th className="px-4 py-2 font-medium">Hospitable</th>
                  <th className="px-4 py-2 font-medium">Eklendi</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => {
                  const conn = connection(org);
                  const isSelf = org.id === session.organizationId;
                  return (
                    <tr key={org.id} className="border-b last:border-0 transition-colors hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium">
                        {org.name}
                        {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(buradasın)</span> : null}
                        {isDemoOrg(org.id) ? (
                          <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                            Demo
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{org._count.properties}</td>
                      <td className="px-4 py-3 text-muted-foreground">{org._count.users}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const b = billing(org);
                          return (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[b.tone]}`}>
                              {b.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            conn.ok
                              ? "inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                              : "inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                          }
                        >
                          {conn.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{dateFmt.format(org.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={`/api/admin/export?orgId=${org.id}`}
                            className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                            title="KVKK veri dışa aktarımı (JSON)"
                          >
                            Veri indir
                          </a>
                          {isSelf ? null : <ImpersonateButton organizationId={org.id} orgName={org.name} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Demo Talepleri ({leads.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Henüz demo talebi yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">İsim</th>
                    <th className="px-4 py-2 font-medium">İletişim</th>
                    <th className="px-4 py-2 font-medium">Mesaj</th>
                    <th className="px-4 py-2 font-medium">Tarih</th>
                    <th className="px-4 py-2 font-medium">Takip</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 align-top transition-colors hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium">{l.name}</td>
                      <td className="px-4 py-3">
                        <a href={`mailto:${l.email}`} className="text-primary hover:underline">{l.email}</a>
                        {l.phone ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {l.phone}
                            {" · "}
                            <a
                              href={`https://wa.me/${l.phone.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                            >
                              WhatsApp
                            </a>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 max-w-xs text-muted-foreground">{l.message ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{dateFmt.format(l.createdAt)}</td>
                      <td className="px-4 py-3">
                        <LeadActions
                          leadId={l.id}
                          status={l.status}
                          note={l.note}
                          followUpAt={l.followUpAt ? l.followUpAt.toISOString().slice(0, 10) : null}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Yeni Müşteri Ekle</CardTitle>
        </CardHeader>
        <CardContent>
          <AddCustomerForm />
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">2FA Sıfırla (kilitli kalan müşteri)</CardTitle>
        </CardHeader>
        <CardContent>
          <Reset2faForm />
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">AI Kalite Denetçisi (Claude — gölge)</CardTitle>
        </CardHeader>
        <CardContent>
          <QualityAuditCard
            orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
            defaultOrgId={primaryId ?? ""}
            configured={qualityAuditConfigured()}
          />
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Gölge Pilotu (Aşama-1 — karar yetkisi yok)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            İkinci model (<code className="font-mono text-xs">{activeShadowModel}</code>) her
            otomatik-yanıt kararında (nezaket kapanışı dahil) aynı misafir mesajını bağımsız
            sınıflandırır; hükmü yalnız <strong>kaydedilir</strong> — gönderimi etkilemez.
            &quot;Kapı&quot; kolonu kapının <strong>kararıdır</strong> (teslimat değil). Bu tablo
            Aşama-2 insan değerlendirmesinin ham girdisidir.
          </p>
          {!shadowAiEnabled() ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Pasif: Railway&apos;e <code className="font-mono text-xs">SHADOW_AI_ENABLED=1</code>{" "}
              eklendiğinde başlar (anahtar verilmezse OpenAI endpoint&apos;inde{" "}
              <code className="font-mono text-xs">OPENAI_API_KEY</code> kullanılır; model başına ilk{" "}
              200 mesajda otomatik durur).
            </p>
          ) : null}
          {legacyShadowCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Aşağıdaki özet yalnız aktif modeli kapsar. Önceki modellerden{" "}
              <strong>{legacyShadowCount}</strong> kayıt daha var; karışmasın diye ayrı tutuluyor.
            </p>
          ) : null}
          {shadowTotal > 0 ? (
            <>
              <p className="text-sm">
                <strong>{shadowTotal}</strong> gölge kaydı · başarılı hüküm {shadowOk.length} ·{" "}
                uyum{" "}
                <strong>
                  {shadowOk.length > 0 ? Math.round((shadowAgree / shadowOk.length) * 100) : 0}%
                </strong>{" "}
                · gölge daha sıkı <strong>{shadowStricter}</strong> · gölge daha gevşek{" "}
                <strong>{shadowLooser}</strong> · yarım {shadowHalf} · arıza {shadowError}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1.5 pr-3">Zaman</th>
                      <th className="py-1.5 pr-3">İşletme</th>
                      <th className="py-1.5 pr-3">Kapı</th>
                      <th className="py-1.5 pr-3">Gölge</th>
                      <th className="py-1.5 pr-3">Gölge riski</th>
                      <th className="py-1.5 pr-3">Güven</th>
                      <th className="py-1.5">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.slice(0, 10).map((r) => (
                      <tr key={r.id} className="border-b border-border/60 transition-colors hover:bg-muted/50">
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {r.createdAt.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" })}
                        </td>
                        <td className="py-1.5 pr-3">{r.organization.name}</td>
                        {/* "onayladı" (≠ teslim edildi): outbox worker'ın send-time
                            vetosu kapı-sonrası bir yaşam-döngüsü olayıdır — gölge,
                            KARARLARI kıyaslar, teslimatı değil. */}
                        <td className="py-1.5 pr-3">{r.gateDecision === "auto_sent" ? "onayladı" : "insana"}</td>
                        <td className="py-1.5 pr-3">{r.verdict ?? "—"}</td>
                        <td className="py-1.5 pr-3">{r.riskType ?? "—"}</td>
                        <td className="py-1.5 pr-3">{r.confidence != null ? r.confidence.toFixed(2) : "—"}</td>
                        <td className="py-1.5">
                          {r.error === "pending" ? (
                            // Claim yazıldı ama süreç hüküm gelmeden öldü — kör
                            // retry YOK (dedupe engeller); insan görsün diye ayrı etiket.
                            <span className="text-muted-foreground">yarım</span>
                          ) : r.error ? (
                            <span className="text-destructive">arıza</span>
                          ) : r.agrees === true ? (
                            <span className="text-emerald-600 dark:text-emerald-400">uyumlu</span>
                          ) : r.agrees === false ? (
                            <span className="text-amber-600 dark:text-amber-400">ayrıştı</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {legacyShadowCount > 0 ? "Aktif model için henüz gölge kaydı yok." : "Henüz gölge kaydı yok."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Operasyon Teşhisi (yalnız operatör)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Bu isteğin proxy başlıkları</p>
            <p className="text-xs text-muted-foreground">
              Hız limiti istemciyi XFF zincirinden tanır. Zinciri istemci ancak{" "}
              <strong>soldan</strong> uzatabilir; sağdaki adımları bizim altyapımız yazar, o yüzden
              sağdan sayarız. Kaç adım geri sayılacağı{" "}
              <code className="font-mono">TRUSTED_PROXY_HOPS</code> ile belirlenir (şu an{" "}
              <strong>{activeHops}</strong>).
            </p>
            <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
              <li>x-forwarded-for: {proxyHeaders.xff ?? "—"}</li>
              <li>x-real-ip: {proxyHeaders.xRealIp ?? "—"}</li>
              <li>cf-connecting-ip: {proxyHeaders.cfConnectingIp ?? "—"}</li>
              <li className="pt-1 font-semibold">
                limitleyicinin kullandığı: {proxyHeaders.resolved}
              </li>
            </ul>
            {hopPreview.length > 1 ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Hangi ayar hangi adresi seçer (kendi adresini tanı, ona göre karar ver):
                </p>
                <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
                  {hopPreview.map((h) => (
                    <li key={h.hops} className={h.hops === activeHops ? "font-semibold" : ""}>
                      TRUSTED_PROXY_HOPS={h.hops} → {h.value}
                      {h.hops === activeHops ? "  ← aktif" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Doğru ayar, <strong>kendi gerçek adresini</strong> veren satırdır. Yanlış ayarda tüm
              ziyaretçiler tek adrese (altyapının kendi adresi) indirgenir; o zaman limitler kişi
              başına değil global çalışır ve bir saldırgan login kovasını doldurup herkesi
              429&apos;a düşürebilir. Beklenenden kısa bir zincirde kod, taklit edilebilir bir
              değere düşmek yerine en sağdaki adımda kalır (limit gevşer, kimlik seçilemez).
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Aynı posta kutusundan çoklu işletme</p>
            <p className="text-xs text-muted-foreground">
              Gmail&apos;de <code className="font-mono">ad+etiket@</code> ve{" "}
              <code className="font-mono">a.d@</code> aynı posta kutusudur; sistem bunları ayrı hesap
              sayar. Aşağısı <strong>şu anda aynı anda yaşayan</strong> hesapları sayar.
            </p>
            {/* DÜRÜSTLÜK NOTU — bu sayı bir suistimal ölçüsü DEĞİL, sınırı burada
                yazılı olmazsa yanlış güven verir:
                (1) `Property.hospitableId` globalde benzersiz olduğu için art arda
                    deneme açan biri ESKİ hesabını silmek ZORUNDA kalır; o an posta
                    kutusu başına tek canlı org kalır ve bu sayı 0 gösterir.
                (2) Farklı posta kutuları (kendi alan adı, tek kullanımlık servis,
                    başka sağlayıcı) tanım gereği hiç görünmez.
                Yani düşük bir sayı "suistimal yok" demek DEĞİLDİR. */}
            <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              <strong>Bu sayı bir suistimal ölçüsü değildir.</strong> Art arda deneme açan biri, aynı
              mülkleri yeniden bağlayabilmek için eski hesabını silmek zorunda kalır — o an bu sayı
              sıfıra döner. Farklı posta kutuları da hiç görünmez. Düşük değer &quot;suistimal
              yok&quot; anlamına gelmez; yalnızca &quot;aynı anda duran kopya hesap yok&quot; demektir.
            </p>
            <p className="text-sm">
              {sharedMailboxes.length === 0 ? (
                <span className="text-muted-foreground">
                  Aynı posta kutusundan birden çok işletme yok.
                </span>
              ) : (
                <>
                  <strong>{sharedMailboxes.length}</strong> posta kutusu ·{" "}
                  <strong>{sharedMailboxOrgs}</strong> işletme · en büyük grup{" "}
                  <strong>{Math.max(...sharedMailboxes.map((s) => s.size))}</strong>
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Denetim Kayıtları (son 50 işlem)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditLogs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Henüz kayıt yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">İşlem</th>
                    <th className="px-4 py-2 font-medium">Yapan (operatör)</th>
                    <th className="px-4 py-2 font-medium">İşletme</th>
                    <th className="px-4 py-2 font-medium">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0 transition-colors hover:bg-muted/50">
                      <td className="px-4 py-2.5 font-medium" title={log.action}>{auditActionLabel(log.action)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {(() => {
                          try {
                            const m = log.metadataJson ? JSON.parse(log.metadataJson) : null;
                            return m?.operatorEmail ?? log.actor?.email ?? "—";
                          } catch {
                            return log.actor?.email ?? "—";
                          }
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{log.organization?.name ?? "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {dateFmt.format(log.createdAt)} {log.createdAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
