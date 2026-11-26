import { badRequest, jsonOk, noStore, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit, auditActor, auditImpersonation } from "@/lib/audit";
import { hostBindingForUser, hostChannelSecret, revokeHostBindingsForUser, startHostBinding } from "@/lib/host-channel/binding";
import { HOST_CHANNEL_CONSENT_TEXT, HOST_CHANNEL_CONSENT_VERSION } from "@/lib/host-channel/consent";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import { waMeLink, whatsAppBusinessNumber } from "@/lib/host-channel/whatsapp/link";

// ---------------------------------------------------------------------------
// Ayarlar › WhatsApp bildirimleri — numara bağlama (tasarım §5.3–5.4). Yalnız sahip / yönetici (`withManage`; personel asla — K10);
// bürünmede yazma kapalı (K8, sarmalayıcı). Her kullanıcı yalnız KENDİ bağlantısını görür / başlatır / kaldırır (işletme + kullanıcı).
//  · Anahtar kapalı / işletme listede değil / numara arama anahtarı ya da numaramız yapılandırılmamış → `available:false` (kart gizlenir).
//  · Başlat: numara + rıza kutusu → tek kullanımlık kod (15 dk) + `wa.me` bağlantısı; ev sahibi kodu KENDİ WhatsApp'ından gönderir, web kancası
//    bağlantıyı etkinleştirir. Kod yalnız bu yanıtta görünür (saklanan özeti).
//  · 🚨 Ret sebepleri ayrıntılı DÖNMEZ (Haiku 10-30 P2-4): "başka hesapta bağlı" / "başka hesapta bekliyor" tek genel cümle — aksi hâlde bir
//    hesap başka numaraların Lixus'ta bağlı olup olmadığını yoklayabilirdi. Kullanıcı ve işletme başına hız sınırı (kod yenileyerek numarayı
//    kilitleme / yoklama seli).
//  · Denetim kaydı: yalnız olay adı (numara / kod yazılmaz).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const START_PER_USER = 5;
const START_PER_USER_WINDOW_MS = 15 * 60_000;
const START_PER_ORG_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60_000;

const NOT_AVAILABLE = "WhatsApp bildirimleri bu hesapta henüz açık değil.";
const BAD_NUMBER = "Numarayı ülke koduyla yazın (ör. +90 532 123 45 67).";
const CANNOT_BIND = "Bu numara şu anda bağlanamıyor. Başka bir numara deneyin ya da daha sonra tekrar deneyin.";
const CONSENT_REQUIRED = "Devam etmek için onay kutusunu işaretleyin.";

function availableFor(organizationId: string): string | null {
  const flags = hostChannelFlagsFromEnv();
  if (!flags.channel) return null;
  if (flags.orgIds !== "*" && !flags.orgIds.has(organizationId)) return null;
  if (!hostChannelSecret()) return null;
  return whatsAppBusinessNumber();
}

export const GET = withManage(async (session) => {
  if (!availableFor(session.organizationId)) return noStore(jsonOk({ available: false }));
  const binding = await hostBindingForUser(session.organizationId, session.userId);
  return noStore(jsonOk({ available: true, consentText: HOST_CHANNEL_CONSENT_TEXT, binding }));
});

export const POST = withManage(async (session, req) => {
  const businessNumber = availableFor(session.organizationId);
  if (!businessNumber) return badRequest({ _: NOT_AVAILABLE });
  const data = await readJsonCappedOrNull<{ number?: unknown; consent?: unknown }>(req);
  const rawNumber = typeof data?.number === "string" ? data.number.slice(0, 40) : "";
  if (data?.consent !== true) return badRequest({ consent: CONSENT_REQUIRED });
  if (!rawNumber.trim()) return badRequest({ number: BAD_NUMBER });

  const perUser = await rateLimit(`host-channel-start:${session.userId}`, START_PER_USER, START_PER_USER_WINDOW_MS);
  if (!perUser.ok) return tooManyRequests(perUser.retryAfter);
  const perOrg = await rateLimit(`host-channel-start-org:${session.organizationId}`, START_PER_ORG_PER_DAY, DAY_MS);
  if (!perOrg.ok) return tooManyRequests(perOrg.retryAfter);

  const r = await startHostBinding({
    organizationId: session.organizationId,
    userId: session.userId,
    provider: WHATSAPP_CLOUD_PROVIDER,
    rawNumber,
    optInTextVersion: HOST_CHANNEL_CONSENT_VERSION,
  });
  if (!r.ok) {
    if (r.reason === "already_active") return noStore(jsonOk({ alreadyActive: true }));
    if (r.reason === "bad_number") return badRequest({ number: BAD_NUMBER });
    return badRequest({ number: CANNOT_BIND });
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "host_channel.binding_started",
    metadata: { consentVersion: HOST_CHANNEL_CONSENT_VERSION, ...auditImpersonation(session) },
  });
  return noStore(jsonOk({ code: r.code, masked: r.masked, expiresAt: r.expiresAt, link: waMeLink(businessNumber, r.code) }));
});

export const DELETE = withManage(async (session) => {
  const revoked = await revokeHostBindingsForUser(session.organizationId, session.userId);
  if (revoked > 0) {
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: auditActor(session),
      action: "host_channel.binding_revoked",
      metadata: { ...auditImpersonation(session) },
    });
  }
  return noStore(jsonOk({ revoked: revoked > 0 }));
});
