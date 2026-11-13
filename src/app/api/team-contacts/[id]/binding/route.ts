import { badRequest, jsonOk, noStore, notFound, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit, auditActor, auditImpersonation } from "@/lib/audit";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { revokeStaffBindings, startStaffBinding } from "@/lib/team-contacts/service";
import { staffWhatsAppAvailable } from "@/lib/team-contacts/availability";
import { teamContactsEnabled } from "@/lib/team-contacts/flag";

// ---------------------------------------------------------------------------
// Ekip kişisinin WhatsApp bağı (T3, §9 İ3). POST → kişiye özel kod + `wa.me` bağlantısı (kod yalnız bu yanıtta; saklanan özeti). Kişi kodu
// KENDİ telefonundan temizlikçi numarasına gönderir, web kancası bağı etkinleştirir — ev sahibi numara yazmaz. DELETE → bağı kaldırır.
// POST: başka işletmenin / giriş yapabilen bir kullanıcının kimliği 404 (varlık sızdırılmaz). DELETE yalnız kendi işletmesinde kapatır;
// başka kimlikte `{ revoked: false }` (yine sızıntı yok). Denetim kaydı kod / numara taşımaz.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const START_PER_ORG_PER_HOUR = 30;
const NOT_AVAILABLE = "WhatsApp bağlantısı bu hesapta henüz açık değil.";

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!teamContactsEnabled()) return notFound();
  const { id } = await params;
  if (!ID_RE.test(id)) return notFound();
  if (!staffWhatsAppAvailable()) return badRequest({ _: NOT_AVAILABLE });
  const limit = await rateLimit(`team-contact-code:${session.organizationId}`, START_PER_ORG_PER_HOUR, 60 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const r = await startStaffBinding({ organizationId: session.organizationId, userId: id, provider: WHATSAPP_CLOUD_PROVIDER });
  if (!r.ok) return r.reason === "not_found" ? notFound() : badRequest({ _: NOT_AVAILABLE });
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "team_contact.binding_started",
    metadata: { userId: id, ...auditImpersonation(session) },
  });
  return noStore(jsonOk({ code: r.code, link: r.link, expiresAt: r.expiresAt }));
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!teamContactsEnabled()) return notFound();
  const { id } = await params;
  if (!ID_RE.test(id)) return notFound();
  const revoked = await revokeStaffBindings({ organizationId: session.organizationId, userId: id });
  if (revoked > 0) {
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: auditActor(session),
      action: "team_contact.binding_revoked",
      metadata: { userId: id, ...auditImpersonation(session) },
    });
  }
  return noStore(jsonOk({ revoked: revoked > 0 }));
});
