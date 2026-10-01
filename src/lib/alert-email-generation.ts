import "server-only";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// UYARI ADRESİ KUŞAĞI (15 ajan A13 F2, 10-01; migration YOK): işletme başına `SystemLock` satırında tamsayı sayaç.
// Her yeni doğrulama isteği ve her doğrudan uyarı adresi değişikliği kuşağı ARTIRIR; doğrulama bağlantısı imzasında kuşağı
// taşır ve onay onu TÜKETİR (bir sonraki değere geçirir) → bağlantı tek kullanımlık, en son istek geçerli; adres eski değerine
// dönünce eski bağlantılar canlanmaz. `Organization.updatedAt` KULLANILMAZ: OAuth belirteç yenilemesi ve üslup profili
// yenilemesi satırı arka planda günceller, bağlantılar kendiliğinden geçersizleşirdi.
// ---------------------------------------------------------------------------

const PREFIX = "alert-email-gen:";
/** Satır bir kilit değil sayaçtır: süresi hiç dolmaz (süresi dolan kilitleri silen bir süpürge olursa dokunmasın). */
const NEVER = new Date("9999-12-31T00:00:00.000Z");

/** Kuşağı ATOMİK artırır ve yeni değeri döndürür (ilk çağrı 1). */
export async function bumpAlertEmailGeneration(organizationId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ holder: string | null }[]>`
    INSERT INTO "SystemLock" ("name", "lockedUntil", "holder", "updatedAt")
    VALUES (${PREFIX + organizationId}, ${NEVER}, '1', NOW())
    ON CONFLICT ("name") DO UPDATE
      SET "holder" = (COALESCE("SystemLock"."holder", '0')::bigint + 1)::text, "updatedAt" = NOW()
    RETURNING "holder"`;
  const value = Number(rows[0]?.holder);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("alert-email generation: geçersiz sayaç");
  return value;
}

/** Bağlantının kuşağı hâlâ GÜNCEL ise tüketir (bir sonrakine geçirir) ve `true` döner; değilse hiçbir şey değişmez. */
export async function consumeAlertEmailGeneration(organizationId: string, generation: number): Promise<boolean> {
  const r = await prisma.systemLock.updateMany({
    where: { name: PREFIX + organizationId, holder: String(generation) },
    data: { holder: String(generation + 1) },
  });
  return r.count === 1;
}
