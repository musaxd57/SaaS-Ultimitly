import { NextResponse } from "next/server";
import { forbidden, notFound, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { isImpersonating } from "@/lib/auth/impersonation";
import { PAID_FEATURE_INACTIVE_MESSAGE, PAID_FEATURE_TRIAL_MESSAGE, paidPlanFeatureAllowed } from "@/lib/billing/subscription";
import { rateLimit } from "@/lib/rate-limit";
import { auditActor, writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { kbExportFilename, renderKbExport } from "@/lib/kb-export";
import { KB_APPROVAL_GATE_WHERE } from "@/lib/kb-review";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// BİLGİ TABANINI DOSYA OLARAK DIŞA AKTAR (kurucu 10-28, §7-A (3): "özellik olarak olsun, deneme sürümünde olmasın"). Biçim içe aktarıcının
// okuduğu biçim (`kb-export.ts`) → dosya yeniden yüklenebilir. `?propertyId=` tek daire, yoksa bütün daireler (işletme kapsamında).
//  · Yönetici / sahip (`withManage`) — personel bilgi tabanını düzenleyemez, dışa da aktaramaz.
//  · Destek görünümünde (bürünme) KAPALI: kalemler kapı / Wi-Fi şifresi taşıyabilir (K8: destek görünümü müşteri verisi indirmez).
//  · Ücretli paket kapısı (deneme sürümü kapalı), saatte 10 dışa aktarma (işletme başına), denetim kaydı (sayılar; metin yok).
//  · Yalnız etkin kalemler (pasif kalem dosyaya girerse yeniden yüklemede etkin olurdu) ve ONAY KAPISINDAN geçmiş olanlar (`KB_APPROVAL_GATE_WHERE`:
//    eski + onaylı; Haiku 10-28 — onay bekleyen taslak dosyaya girip yeniden yüklemede ev sahibinin yazdığı metin gibi dönmesin).
// ---------------------------------------------------------------------------
export const GET = withManage(async (session, req) => {
  if (isImpersonating(session)) return forbidden("Destek görünümünde müşteri verisi dışa aktarılamaz.");
  const gate = await paidPlanFeatureAllowed(session.organizationId);
  if (!gate.ok) return forbidden(gate.reason === "trial" ? PAID_FEATURE_TRIAL_MESSAGE : PAID_FEATURE_INACTIVE_MESSAGE);
  const limited = await rateLimit(`kb-export:${session.organizationId}`, 10, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const propertyId = new URL(req.url).searchParams.get("propertyId") || undefined;
  const properties = await prisma.property.findMany({
    where: { organizationId: session.organizationId, ...(propertyId ? { id: propertyId } : {}) },
    orderBy: { name: "asc" },
    select: {
      name: true,
      knowledgeBase: {
        where: { isActive: true, ...KB_APPROVAL_GATE_WHERE },
        orderBy: [{ category: "asc" }, { title: "asc" }, { id: "asc" }],
        select: { category: true, title: true, content: true },
      },
    },
  });
  // Başka işletmenin ya da var olmayan dairenin kimliği → boş değil 404 (varlık sızdırılmaz, kapsam dışı istek fark edilir).
  if (propertyId && properties.length === 0) return notFound("Daire bulunamadı.");

  const text = renderKbExport(properties.map((p) => ({ name: p.name, items: p.knowledgeBase })));
  const at = new Date();
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "kb.export",
    metadata: { properties: properties.length, items: properties.reduce((n, p) => n + p.knowledgeBase.length, 0), scoped: Boolean(propertyId) },
  });
  return new NextResponse(`\uFEFF${text}`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${kbExportFilename(at)}"`,
      "cache-control": "no-store",
    },
  });
});
