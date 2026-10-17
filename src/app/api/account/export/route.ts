import { isImpersonating } from "@/lib/auth/impersonation";
import { NextResponse } from "next/server";
import { forbidden, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { buildOrganizationDataExport } from "@/lib/data-export";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK m.11 SELF-SERVE data access — the HOST exports THEIR OWN organization's
// data (no operator needed). Scoped strictly to session.organizationId. The
// payload comes from the SINGLE-SOURCE allowlist builder shared with the
// operator route (src/lib/data-export.ts) — see there for the exact scope and
// the secrets-exclusion contract; a parity test pins the two routes together.
// ---------------------------------------------------------------------------
export const GET = withManage(async (session, req) => {
  // K8 (kurucu kararı 09-28): destek görünümü (bürünme) tüm misafir verisini indiremez — GET olsa da.
  if (isImpersonating(session)) return forbidden("Destek görünümünde müşteri verisi dışa aktarılamaz.");
  // Gece-4 S7-05: başka siteden açılan bağlantı (SameSite=Lax çerez üst düzey GET'te gider) saatte 3'lük dışa aktarma hakkını yakıp sahibin
  // KVKK dökümünü bir saat kilitleyebiliyordu. Yalnız aynı siteden ya da adres çubuğundan (none) — operatör dışa aktarmasıyla aynı kural.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return forbidden();
  // OWNER-ONLY (Codex): the export carries the org's calendar-feed URLs
  // (bearer-like credentials), invoices and consent evidence — manager-level
  // access is not enough for a full-account data handover. withManage already
  // 403s staff; this narrows the remaining manager case.
  // 🚨 SIRA (09-23, güvenlik ajanı): yetki kontrolü KOTADAN ÖNCE. Eskiden kota önce
  // tüketiliyordu ve kova ORG başınaydı → bir yönetici üç 403'lük istekle SAHİBİN KVKK
  // veri dışa aktarımını bir saat kilitleyebiliyordu (depo kuralı: bütçe doğrulamadan
  // SONRA tüketilir).
  if (session.role !== "owner") return forbidden();

  // Limitsizdi: export tum org verisini TEK string'e yaziyor; esszamanli birkac istek replikayi dusurebilir.
  const limited = await rateLimit(`account-export:${session.organizationId}`, 3, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const orgId = session.organizationId;
  const payload = await buildOrganizationDataExport(orgId);
  if (!payload) return forbidden();

  await writeAudit({
    organizationId: orgId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "data.export_self",
    metadata: { email: session.email },
  });

  const safeName = payload.organization.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-verilerim-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...payload }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never let a proxy/browser cache a file full of credentials + PII.
      "Cache-Control": "no-store",
    },
  });
});
