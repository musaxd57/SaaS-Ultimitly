import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// M-2 dilim 2 (Opus S5) — ÜYELİK ONARIMI çekirdeği (`scripts/membership-backfill.ts`; uygulama bu modülü İÇE AKTARMAZ — dosya okur).
//
// Ne zaman: `/api/health?strict=1` → 503 `users_without_membership` (HİÇ üyelik satırı olmayan kullanıcı var; böyle biri giriş yapamaz).
// Sebep: dilim 1 ile dilim 2 aynı yayında gitti ya da geri dönüşte dilim-1 öncesi kod hesap açtı; migration 94 yalnız BİR kez koşar.
// Ne yazar: migration 94'ün İFADESİNİN AYNISI (tek kaynak — dosyadan okunur, kopya yok): yalnız HİÇ üyelik satırı olmayan kullanıcıya ana
// işletmesinde etkin üyelik. Çıkarılmış (`revoked`) satırı olan kişiye DOKUNMAZ (dirilmez); tekrar koşulabilir.
// 🚨 Satır SİLEN bir çıkarma yolu ya da "askıda hesap" (Ü-1) eklendikten sonra bu çekirdek KOŞULMAZ — "satırı yok" artık "hiç üye olmadı"
// demek olmaz; körlemesine koşmak çıkarılan kişiyi ana işletmesine geri yazar (Opus S11). O tasarımla birlikte yeniden tanımlanır.
// ---------------------------------------------------------------------------

export const MEMBERSHIP_BACKFILL_MIGRATION = "prisma/migrations/94_membership_backfill_repeat/migration.sql";

/** Migration 94'teki TEK `INSERT INTO "Membership"` ifadesi (yorum satırları atılır). Birden fazla / hiç yoksa fırlatır. */
export function membershipBackfillStatement(root: string = process.cwd()): string {
  const statements = readFileSync(join(root, MEMBERSHIP_BACKFILL_MIGRATION), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (statements.length !== 1 || !/^INSERT INTO "Membership"/i.test(statements[0]!)) {
    throw new Error(`${MEMBERSHIP_BACKFILL_MIGRATION}: tek bir INSERT INTO "Membership" ifadesi bekleniyordu (${statements.length} ifade)`);
  }
  return statements[0]!;
}

export interface MembershipGap {
  /** HİÇ üyelik satırı olmayan kullanıcı sayısı. */
  count: number;
  /** Bu hesapların açılış anı aralığı (kimlik / e-posta basılmaz) — hangi yayın aralığının artığı olduğunu gösterir. */
  oldestCreatedAt: Date | null;
  newestCreatedAt: Date | null;
}

/** SALT-OKUMA: üyelik satırı olmayan kullanıcılar (yalnız sayı + açılış anı aralığı). */
export async function membershipGap(db: Pick<PrismaClient, "$queryRaw">): Promise<MembershipGap> {
  const rows = await db.$queryRaw<{ count: number; oldest: Date | null; newest: Date | null }[]>`
    SELECT count(*)::int AS "count", min(u."createdAt") AS "oldest", max(u."createdAt") AS "newest"
    FROM "User" u
    WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u."id")`;
  const r = rows[0];
  return { count: r?.count ?? 0, oldestCreatedAt: r?.oldest ?? null, newestCreatedAt: r?.newest ?? null };
}

export type MembershipBackfillResult =
  | { ok: true; inserted: number; remaining: number }
  | { ok: false; reason: "count_changed"; expected: number; actual: number };

/**
 * YAZAR — yalnız salt-okuma koşusunun bildirdiği sayı BİREBİR verilirse (`expected`): sayı o arada değiştiyse hiçbir şey yazmadan durur
 * (önce taze salt-okuma). Sayım ve yazım TEK işlemde, AYNI anlık görüntüde (REPEATABLE READ — Haiku 11-06: ayrı ifadelerde araya giren yeni
 * hesap da yazılıyordu, "N onaylandı, N+1 yazıldı"): yazılan küme tam olarak onaylanan kümedir; araya giren hesap sonraki salt-okumada
 * görünür. İşlemden sonra kalan yeniden sayılır (0 beklenir; araya giren hesap varsa > 0 → betik 1 ile çıkar).
 */
export async function applyMembershipBackfill(
  db: Pick<PrismaClient, "$transaction" | "$queryRaw">,
  expected: number,
  root: string = process.cwd(),
): Promise<MembershipBackfillResult> {
  const statement = membershipBackfillStatement(root);
  const written = await db.$transaction(
    async (tx) => {
      const before = await membershipGap(tx);
      if (before.count !== expected) return { ok: false as const, actual: before.count };
      return { ok: true as const, inserted: await tx.$executeRawUnsafe(statement) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (!written.ok) return { ok: false, reason: "count_changed", expected, actual: written.actual };
  return { ok: true, inserted: written.inserted, remaining: (await membershipGap(db)).count };
}
