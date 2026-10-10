import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, badRequest, forbidden, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { isSuperAdmin } from "@/lib/admin";
import { auditActor, writeAuditInTx } from "@/lib/audit";
import { isImpersonating } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { buildOrganizationDataExport } from "@/lib/data-export";
import { parseOperatorExportRequest } from "@/lib/operator-export";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK / GDPR data export — SUPER-ADMIN ONLY. Returns a downloadable JSON dump
// of ONE organization's data so the operator can satisfy a host's data-access
// request. Read-only. The payload is the SAME single-source allowlist builder
// as the owner's self-serve /api/account/export (src/lib/data-export.ts): the
// operator answer to a data-access request must never be NARROWER than the
// self-serve one (it used to omit billing/consents/audit/risk/delivery). A
// parity test pins both routes to identical structures; secrets are excluded
// by the builder's allowlists. The export itself is audit-logged.
// ---------------------------------------------------------------------------
// 🚨 KURUCU KARARI 09-30: dışa aktarma YALNIZ operatörün KENDİ hesabından (bürünme oturumu değil), 2FA'lı (`isSuperAdmin` `mfa`
// ister), AMAÇLA ve ZORUNLU kayıtla: hangi işletme · kim · ne zaman · destek amacı. Kayıt yazılamazsa indirme OLMAZ. Sırlar
// (parola, 2FA sırrı, bağlantı anahtarları, takvim adresleri) kurucunun allowlist'iyle zaten dışarıda (`data-export.ts`).
// Ev sahibine anlık bildirim / panelde erişim geçmişi YOK (kurucu kararı); kayıt iç denetim içindir.
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  if (isImpersonating(session)) return forbidden("Dışa aktarma operatörün kendi hesabından yapılır — önce destek görünümünden çıkın.");
  // Operatör kimliğine bağlı tavan (Haiku operatör denetimi 10-10): her çağrı bir işletmenin TAM dökümü + zorunlu kayıt.
  const limited = await rateLimit(`admin-export:${session.actorUserId ?? session.userId}`, 20, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  // 10-01 (15 ajan incelemesi A02-F5): uç GET ve durum değiştirir (zorunlu kayıt + tam döküm); oturum çerezi SameSite=Lax olduğu için
  // başka bir sitenin üst düzey yönlendirmesi çerezi taşırdı → sahte amaçlı "yasal talep" kaydı + operatörün indirme klasörüne döküm.
  // Tarayıcının kendi bildirdiği kaynak yalnız aynı site (panel formu) ya da elle girilen adres ("none") olabilir; başlık hiç yoksa
  // (eski tarayıcı / komut satırı) bugünkü gibi.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return forbidden("Dışa aktarma yalnız operatör panelinden başlatılır.");
  }

  const parsed = parseOperatorExportRequest(new URL(req.url).searchParams);
  if (!parsed.ok) return badRequest(parsed.errors);
  const { orgId, purpose, ticket } = parsed;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return badRequest({ orgId: "İşletme bulunamadı." });

  // ZORUNLU kayıt İNDİRMEDEN ÖNCE: yazılamazsa (veritabanı arızası) veri çıkmaz.
  try {
    await writeAuditInTx(prisma, {
      organizationId: orgId,
      // Bürünme yukarıda reddedildiği için fail oturumun kendisi; yine de ortak kural (`auditActor`) — kapı bir gün kalkarsa
      // kayıt müşteriyi değil operatörü göstermeye devam eder (denetim pini).
      actorUserId: auditActor(session),
      action: "data.export",
      // Operatör kimliği opak `actorUserId` ile kayıtlı; e-posta müşterinin KVKK ihracına ham girdiği için YAZILMAZ (denetim,
      // 08-01 — beşinci tur). Amaç kapalı küme; talep numarası yalnız harf / rakam / tire.
      metadata: { purpose, ...(ticket ? { ticket } : {}) },
    });
  } catch (err) {
    void reportError("admin.export-audit", err);
    return NextResponse.json({ ok: false, error: "Kayıt yazılamadı; dışa aktarma yapılmadı. Biraz sonra yeniden deneyin." }, { status: 503 });
  }

  const payload = await buildOrganizationDataExport(orgId);
  if (!payload) return badRequest({ orgId: "İşletme bulunamadı." });

  const safeName = payload.organization.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-export-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...payload }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never let a proxy/browser cache a file full of guest PII (parity with the
      // self-service account/export route).
      "Cache-Control": "no-store",
    },
  });
}
