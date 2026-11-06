import type { Prisma, PrismaClient, User } from "@prisma/client";

// ---------------------------------------------------------------------------
// M-2 ÜYELİK — TEK YAZICI (dilim 1; kurucu / Codex 11-06 K-2, tasarım docs/TASARIM-2026-11-06-uyelik-modeli-M2.md §6.2).
//
// Kimlik kullanıcıda, yetki üyelikte. Dilim 2'den beri OTURUM üyelikten doğrulanır (`lib/api.ts`, `lib/auth/index.ts`, `(app)/layout.tsx`);
// `User.organizationId` / `User.role` (ana işletme aynası) kalan okuyucular için yazılmaya devam eder (dilim 3 envanteri). Her yeni kullanıcı
// aynı işlemde ana işletme üyeliğini de alır.
//  · Bütün kullanıcı yaratan yollar (kayıt, operatör müşteri açma, demo kiracı, yerel tohum) BURADAN geçer — `user.create` başka yerde
//    yazılmaz (pin: `tests/unit/membership-single-writer.test.ts`).
//  · Tetikleyici YOK (testler şemayı `db push` ile kurar → testte olmaz, üretimde olur → eksik yazımı gizlerdi), "üyelik yoksa eski
//    sütuna düş" YOK (silinen üyelik kişiyi geri üye yapardı) — Opus M11.
//  · `singleMembershipGuard` = kullanıcı kimliği: kişi başına TEK üyelik veritabanında imkânsız (geçici bekçi, dilim 6c'ye kadar).
//  · Demo değişmezi (Opus M17): demo işletmesine yalnız demo kimlikleri, demo kimlikleri yalnız demo işletmesine üye olur.
// "server-only" İÇE AKTARILMAZ: yerel tohum (`prisma/seed.ts`) bunu düz `tsx` altında çağırır; modül sır taşımaz.
// ---------------------------------------------------------------------------

export const MEMBERSHIP_ROLES = ["owner", "manager", "staff"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
/**
 * Üyeliğin kökeni — kötüye kullanım sinyalleri yalnız kurucu kökenleri sayar (Opus M9). `backfill` yalnız migration 93 / 94 ve onarım betiğinde
 * yazılır; `repair` girişte / e-posta doğrulamada kayan dağıtım artığının onarımıdır (`repairHomeMembershipIfMissing`).
 */
export type MembershipOrigin = "signup" | "operator" | "demo" | "seed" | "repair";

/** `src/lib/demo-tenant/constants.ts` ile AYNI değerler (o modül sunucu yolunu içe aktarır; eşitlik birim testte pinli). */
export const DEMO_ORG_ID_FOR_MEMBERSHIP = "lxdemo-org";
export const DEMO_ID_PREFIX_FOR_MEMBERSHIP = "lxdemo-";

export class MembershipInvariantError extends Error {
  constructor(readonly reason: "demo_boundary" | "bad_role") {
    super(`membership_invariant:${reason}`);
  }
}

type Tx = Prisma.TransactionClient;
type NewUser = Omit<Prisma.UserUncheckedCreateInput, "role" | "organizationId"> & { organizationId: string; role: MembershipRole };

function assertInvariant(userId: string | undefined, organizationId: string, role: string, origin: MembershipOrigin): void {
  if (!(MEMBERSHIP_ROLES as readonly string[]).includes(role)) throw new MembershipInvariantError("bad_role");
  const demoOrg = organizationId === DEMO_ORG_ID_FOR_MEMBERSHIP;
  const demoIdentity = origin === "demo" || (userId?.startsWith(DEMO_ID_PREFIX_FOR_MEMBERSHIP) ?? false);
  if (demoOrg !== demoIdentity) throw new MembershipInvariantError("demo_boundary");
}

/**
 * Kullanıcıyı ANA işletme üyeliğiyle birlikte AYNI işlemde yaratır. Çağıran işlemi açar (kayıt, operatör, demo, tohum).
 * Rol zorunludur (varsayılan "owner"a düşmez — Opus M19).
 */
export async function createUserWithMembership(tx: Tx, data: NewUser, origin: MembershipOrigin): Promise<User> {
  assertInvariant(data.id, data.organizationId, data.role, origin);
  const user = await tx.user.create({ data });
  await tx.membership.create({
    data: { userId: user.id, organizationId: user.organizationId, role: data.role, origin, singleMembershipGuard: user.id },
  });
  return user;
}

/**
 * Ana işletmedeki rolü AYNA ile birlikte günceller (bugün yalnız demo yenilemesi rol yazar). Üyelik yoksa (ör. kayan dağıtımda doldurmadan
 * sonra açılmış hesap) yaratılır — ayna ile üyelik ayrışmasın. Kullanıcı bu işletmede değilse hiçbir şey yazmaz (0 döner).
 */
export async function setHomeMembershipRole(
  tx: Tx,
  userId: string,
  organizationId: string,
  role: MembershipRole,
  origin: MembershipOrigin,
): Promise<number> {
  assertInvariant(userId, organizationId, role, origin);
  const mirrored = await tx.user.updateMany({ where: { id: userId, organizationId }, data: { role } });
  if (mirrored.count === 0) return 0;
  const current = await tx.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { id: true, role: true },
  });
  if (!current) {
    await tx.membership.create({ data: { userId, organizationId, role, origin, singleMembershipGuard: userId } });
  } else if (current.role !== role) {
    // Rol değişimi üyelik KUŞAĞINI artırır (dilim 2: o işletmedeki oturumlar yeniden doğrulanır). Aynı rol → yazım yok.
    await tx.membership.update({ where: { id: current.id }, data: { role, epoch: { increment: 1 } } });
  }
  return mirrored.count;
}

/**
 * KAYAN DAĞITIM ARTIĞI ONARIMI (kurucu 11-06: "işletmesi olmayan kişi akışını sen kur"; tasarım §13). HİÇ üyelik satırı olmayan kişiye ana
 * işletmesinde ETKİN üyelik yazar — migration 94 ile AYNI kural (rol aynadan, kuşak 0, köken `repair`). Çağrılma anı: giriş — doğru ŞİFREDEN
 * sonra, ikinci adımdan ÖNCE (kurtarma kodunu tüketme kararı son üyelik durumuyla verilsin diye — sonra koşsa üyeliksiz sanılan kişinin kodu
 * yakılmadan oturum basılırdı); e-posta doğrulama — belirteç + şifreden sonra. Onarım HİÇBİR ŞEY VERMEZ: oturumu basmaz (ikinci adım yine
 * ister), yalnız hesabın zaten sahip olması gereken satırı geri yazar (migration 94 / onarım betiği aynı satırı yazardı).
 * Satırı OLAN kişiye (çıkarılmış dahil) HİÇBİR ŞEY yazmaz: çıkarılan kişi geri gelmez. İki eşzamanlı giriş: tekil bekçi ikinci yazımı sessizce
 * geçer (`skipDuplicates`). Yazdıysa `true`.
 * 🚨 Değişmez: "üyelik satırı yok" ⇔ "hiç üye olmadı". Üyelik satırı SİLİNMEZ (tek yazıcı pini — yazıcının kendisi dahil) ve askıdaki hesap
 * (Ü-1, dilim 6) ayrı bir işaret taşıyacak, onarım onu ATLAYACAK. Bu değişmez bozulursa onarım çıkarılmış kişiyi geri sokardı.
 */
export async function repairHomeMembershipIfMissing(db: Tx | Pick<PrismaClient, "user" | "membership">, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, role: true, memberships: { select: { id: true }, take: 1 } },
  });
  if (!user || user.memberships.length > 0) return false;
  assertInvariant(user.id, user.organizationId, user.role, "repair");
  const written = await db.membership.createMany({
    data: [{ userId: user.id, organizationId: user.organizationId, role: user.role, origin: "repair", singleMembershipGuard: user.id }],
    skipDuplicates: true,
  });
  return written.count === 1;
}
