import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, badRequest, forbidden, jsonOk, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { isSuperAdmin } from "@/lib/admin";
import { auditActor, writeAuditInTx } from "@/lib/audit";
import { isImpersonating } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { findEventsByCorrelation } from "@/lib/event-log";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// TAKİP NUMARASIYLA OLAY ARAMA — YALNIZ OPERATÖR (kurucu kararı 10-10 §5). Müşteri "ödeme yapamadım, takip numaram 7f3a91b2" dediğinde
// operatör numarayla o işlemin bütün olaylarını (onay kaydı → ödeme ekranı → webhook → abonelik / fatura → hata) bulur.
//  · Süper-admin + 2FA (`isSuperAdmin`, tek boğaz); bürünme (destek görünümü) oturumunda okunamaz; başka sitenin yönlendirmesi reddedilir.
//  · Operatör kimliğine bağlı hız sınırı (saatte 60, geçersiz istek de sayılır); her arama ZORUNLU denetim kaydı — kayıt yazılamazsa
//    sonuç dönmez. Kayıtta numaranın yalnız ilk 8 karakteri.
//  · Dönen veri olay günlüğünün kendisi (kapalı küme olay adı + izinli alanlar) + aynı numaralı onay kaydının kimliği / planı / zamanı
//    (IP / tarayıcı bilgisi DÖNMEZ).
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  if (isImpersonating(session)) return forbidden("Olay araması operatörün kendi hesabından yapılır — önce destek görünümünden çıkın.");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return forbidden("Olay araması yalnız operatör panelinden yapılır.");
  }
  const limited = await rateLimit(`admin-events:${session.actorUserId ?? session.userId}`, 60, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const q = new URL(req.url).searchParams.get("id")?.trim().toLowerCase() ?? "";
  if (q.length > 64) return badRequest({ id: "Takip numarasını kontrol edin." });

  try {
    await writeAuditInTx(prisma, {
      organizationId: session.organizationId,
      actorUserId: auditActor(session),
      action: "operator.event_search",
      metadata: { prefix: q.slice(0, 8).replace(/[^0-9a-f]/g, "") },
    });
  } catch (err) {
    void reportError("admin.event-search-audit", err);
    return NextResponse.json({ ok: false, error: "Kayıt yazılamadı; arama yapılmadı. Biraz sonra yeniden deneyin." }, { status: 503 });
  }

  const result = await findEventsByCorrelation(q);
  if (!result) return badRequest({ id: "Takip numarası 8 karakterlik kısa numara ya da tam numara olmalı." });
  // Sonucu dönen HER işletmenin kendi denetim kaydına da yazılır (bürünme girişi gibi — işletmenin kaydında "operatör olaylarıma baktı"
  // görünür; Haiku güvenlik incelemesi 10-12). Kayıt yazılamazsa sonuç dönmez.
  const orgs = [...new Set([...result.events.map((e) => e.organizationId), ...result.consents.map((c) => c.organizationId)])].filter(
    (id): id is string => typeof id === "string" && id !== session.organizationId,
  );
  if (orgs.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const organizationId of orgs) {
          await writeAuditInTx(tx, {
            organizationId,
            actorUserId: auditActor(session),
            action: "operator.event_search",
            metadata: { prefix: q.slice(0, 8).replace(/[^0-9a-f]/g, "") },
          });
        }
      });
    } catch (err) {
      void reportError("admin.event-search-audit", err);
      return NextResponse.json({ ok: false, error: "Kayıt yazılamadı; arama sonucu gösterilmedi. Biraz sonra yeniden deneyin." }, { status: 503 });
    }
  }
  return jsonOk({ ok: true, ...result });
}
