import type { Prisma, PrismaClient } from "@prisma/client";
import type { UserRole } from "@/lib/constants";

// ---------------------------------------------------------------------------
// M-2 DİLİM 2 — OTURUM ÜYELİKTEN (tasarım docs/TASARIM-2026-11-06-uyelik-modeli-M2.md §3; Opus M4, M15).
//
// Oturumun işletmesi JWT'deki `organizationId`dir ve o işletmedeki ÜYELİK her istekte okunur. Eskiden `requireSession` / `requireAuth`
// işletmeyi kullanıcı satırından (ana işletme) ÜSTÜNE YAZIYORDU — üyelikte bu, B işletmesindeki oturumu sessizce A'ya taşırdı. Artık:
//  · üyelik yok / etkin değil / kuşak farklı / kimlik farklı → oturum GEÇERSİZ (yeniden giriş);
//  · rol üyelikten (kişinin O işletmedeki rolü);
//  · iddiasız eski belirteç: kuşak 0, kimlik denetimi atlanır (doldurulan üyelik kuşağı 0 → kimse çıkışa düşmez; toplu `sessionEpoch`
//    artırma YAPILMAZ — WhatsApp bağları, "beni hatırla" ve tanınan cihaz çerezleri ölürdü).
// ---------------------------------------------------------------------------

export interface SessionMembershipRow {
  id: string;
  role: string;
  status: string;
  epoch: number;
}

/**
 * Kullanıcı sorgusuna eklenen üyelik seçimi — TEK Prisma çağrısı, İKİ SQL sorgusu (iç içe seçim `relationJoins` olmadan ayrı sorgu; Opus
 * S12). İki satır da bu istekte yeniden okunur; aralarında işlemsel tutarlılık gerekmez (her biri kendi başına doğrulanır).
 */
export function sessionMembershipInclude(organizationId: string) {
  return {
    where: { organizationId },
    select: { id: true, role: true, status: true, epoch: true },
    take: 1,
  } satisfies Prisma.User$membershipsArgs;
}

/** Üyelik bu oturumu taşıyabilir mi: etkin + kuşak aynı + (belirteç kimlik taşıyorsa) kimlik aynı. */
export function membershipMatchesSession(
  m: SessionMembershipRow | null | undefined,
  session: { membershipId?: string; membershipEpoch?: number },
): m is SessionMembershipRow {
  if (!m || m.status !== "active") return false;
  if ((session.membershipEpoch ?? 0) !== m.epoch) return false;
  if (session.membershipId !== undefined && session.membershipId !== m.id) return false;
  return true;
}

export interface LoginMembership {
  id: string;
  organizationId: string;
  role: string;
  epoch: number;
}

/**
 * Girişte / e-posta doğrulamada / operatör çıkışında oturumun işletmesi (Opus M15): son kullanılan AKTİFSE o → ana işletme AKTİFSE o →
 * en eski aktif üyelik. Hiçbiri yoksa `null` — oturum BASILMAZ (çağıran sade metinle reddeder; giriş döngüsü yok).
 */
export async function pickLoginMembership(
  db: Pick<PrismaClient, "membership"> | Prisma.TransactionClient,
  user: { id: string; organizationId: string; lastActiveOrganizationId?: string | null },
): Promise<LoginMembership | null> {
  const active = await db.membership.findMany({
    where: { userId: user.id, status: "active" },
    select: { id: true, organizationId: true, role: true, epoch: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return (
    active.find((m) => user.lastActiveOrganizationId && m.organizationId === user.lastActiveOrganizationId) ??
    active.find((m) => m.organizationId === user.organizationId) ??
    active[0] ??
    null
  );
}

/** Seçilen üyelikten oturum iddiaları (işletme + rol + üyelik kimliği + kuşak). */
export function membershipClaims(m: LoginMembership): { organizationId: string; role: UserRole; membershipId: string; membershipEpoch: number } {
  return { organizationId: m.organizationId, role: m.role as UserRole, membershipId: m.id, membershipEpoch: m.epoch };
}

/**
 * Hiç etkin üyeliği olmayan kişiye girişte gösterilen metin (bu dala yalnız doğru şifre + ikinci faktörle ulaşılır). Davet ipucu YOK (Opus
 * S5): bugün bu dala yalnız kayan dağıtım artığı (sistem arızası) düşer, davet yoktur; çıkarılan kişinin metni dilim 6a ile birlikte yazılır.
 */
export const NO_ACTIVE_MEMBERSHIP_TEXT = "Hesabınız şu an hiçbir işletmeye bağlı değil.";
