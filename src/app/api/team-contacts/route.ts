import { badRequest, jsonOk, noStore, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { writeAudit, auditActor, auditImpersonation } from "@/lib/audit";
import { createTeamContact, listTeamContacts } from "@/lib/team-contacts/service";
import { staffWhatsAppAvailable } from "@/lib/team-contacts/availability";
import { teamContactsEnabled } from "@/lib/team-contacts/flag";
import { isDemoOrg } from "@/lib/demo-tenant/constants";

// ---------------------------------------------------------------------------
// Ayarlar › Ekip kişileri (T3; tasarım docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md §9 İ5). Yalnız sahip / yönetici
// (`withManage`; bürünmede yazma kapalı). Anahtar `TEAM_CONTACTS_ENABLED` kapalıyken 404 (yüzey yok).
//  · Ekle: yalnız ad. Kişi giriş yapamaz, e-posta almaz; görev atamasında ve dairenin temizlikçisi listesinde görünür.
//  · İşletme başına üst sınır + saatlik ekleme sınırı (kayıt seli). Denetim kaydı adı TAŞIMAZ (yalnız kişi kimliği).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const MAX_CONTACTS_PER_ORG = 50;
const CREATE_PER_ORG_PER_HOUR = 20;

export const GET = withManage(async (session) => {
  // Demo işletmesinde yüzey YOK: üyelik değişmezi demo dışı kökenli kişiyi reddeder (yazılsaydı 500 olurdu).
  if (!teamContactsEnabled() || isDemoOrg(session.organizationId)) return notFound();
  const contacts = await listTeamContacts(session.organizationId);
  return noStore(jsonOk({ whatsapp: staffWhatsAppAvailable(), contacts }));
});

export const POST = withManage(async (session, req) => {
  // Demo işletmesinde yüzey YOK: üyelik değişmezi demo dışı kökenli kişiyi reddeder (yazılsaydı 500 olurdu).
  if (!teamContactsEnabled() || isDemoOrg(session.organizationId)) return notFound();
  const data = await readJsonCappedOrNull<{ name?: unknown }>(req);
  const limit = await rateLimit(`team-contact-create:${session.organizationId}`, CREATE_PER_ORG_PER_HOUR, 60 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const count = await prisma.user.count({ where: { organizationId: session.organizationId, loginDisabled: true } });
  if (count >= MAX_CONTACTS_PER_ORG) return badRequest({ name: "Ekip kişisi sınırına ulaştınız." });
  const r = await createTeamContact({ organizationId: session.organizationId, name: data?.name });
  if (!r.ok) return badRequest({ name: "Bir ad yazın." });
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "team_contact.created",
    metadata: { userId: r.userId, ...auditImpersonation(session) },
  });
  return noStore(jsonOk({ userId: r.userId, name: r.name }));
});
