/* ---------------------------------------------------------------------------
 * GEÇMİŞ MİSAFİR MESAJLARININ TOPLU TARAMASI — SALT OKUMA, YALNIZ SAYI (09-24, kurucu: "admin hesabından önceden
 * çektiğimiz her mesajla kontrol edebilir miyiz — kesinlikle bozmadan, salt okuma").
 *
 * Kurucunun makinesinde, elle çalıştırılır; hiçbir şey bunu otomatik çağırmaz:
 *   npx tsx scripts/eval-real-stats.ts --email <giriş e-postanız>   (isteğe bağlı: --out <yol>, --max 50000)
 *
 * Set B'den (etiketli örnek, doğruluk ölçer) FARKI: tüm geçmiş taranır, etiket yoktur, model ÇAĞRILMAZ, yalnız
 * deterministik katman + veritabanı olguları. Çıktı YALNIZ SAYI: kaç mesaj konaklama değişikliği isteği (kelime ağı —
 * ALT SINIR), kaç tanesi yalnız erken giriş, varış günü mü soruldu, aynı gün devir var mıydı, temizlik görevi var mıydı,
 * misafir sorduğunda daire hazır mıydı / girişe kadar hazır oldu mu, soruların saat dağılımı. Mesaj metni, ad, kimlik,
 * tarih ne ekrana ne dosyaya yazılır. Hesap: `src/lib/eval-real/replay-stats.ts` (ürünle AYNI hazırlık ve tarih kuralı).
 *
 * 🚨 SALT OKUMA: dışa aktarım betiğinin PİNLİ `readOnly` yardımcısı kullanılır (ilk komut SET TRANSACTION READ ONLY,
 * doğrulama SHOW transaction_read_only, 60 sn sorgu sınırı); bu betikte ham komut YOK, yalnız SELECT (mekanik pin
 * `tests/unit/eval-real.test.ts`). Yalnız kuruluş SAHİBİ kendi verisini tarar; okumadan önce "EVET" onayı.
 * ------------------------------------------------------------------------- */

import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { replayStats, type ReplayCleaning, type ReplayMessage, type ReplayReservation } from "../src/lib/eval-real/replay-stats";
import { guardedOutputPath } from "../src/lib/eval-real/labeling";
import { orgTimezone } from "../src/lib/timezone";
import { ask, readOnly } from "./eval-real-export";
import { gitIgnoredIn } from "./eval-real-shared";

const REPO = path.resolve(__dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const email = arg("--email")?.trim();
  if (!email) throw new Error("gerekli: --email <kendi giriş e-postanız> (yalnız kendi kuruluşunuzun mesajları okunur)");
  const out = guardedOutputPath(REPO, arg("--out") ?? "evals/private/replay-stats.json", gitIgnoredIn(REPO));
  if (existsSync(out) && !process.argv.includes("--force")) throw new Error("sonuç dosyası zaten var (bilerek yenilemek için --force)");
  const maxArg = Number(arg("--max"));
  const max = Number.isInteger(maxArg) && maxArg > 0 ? Math.min(maxArg, 200000) : 50000;

  const url = process.env.EVAL_REAL_DATABASE_URL?.trim() || (await ask("Veritabanı adresi (DATABASE_URL, ekrana basılmaz): ", true));
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error("geçerli bir postgres adresi değil");
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const org = await readOnly(prisma, async (tx) => {
      const users = await tx.$queryRaw<{ organizationId: string; role: string }[]>`
        SELECT "organizationId", role FROM "User" WHERE lower(email) = lower(${email}) LIMIT 2`;
      if (users.length !== 1) throw new Error("bu e-postayla tek bir kullanıcı bulunamadı");
      if (users[0].role !== "owner") throw new Error("yalnız kuruluş SAHİBİ (owner) kendi verisini tarayabilir");
      const orgs = await tx.$queryRaw<{ name: string; timezone: string | null }[]>`
        SELECT name, timezone FROM "Organization" WHERE id = ${users[0].organizationId}`;
      if (orgs.length !== 1) throw new Error("kuruluş bulunamadı");
      return { id: users[0].organizationId, name: orgs[0].name, timezone: orgs[0].timezone };
    });
    const answer = await ask(`Taranacak kuruluş: "${org.name}". Yalnız okunur, hiçbir şey değişmez; çıktı yalnız sayıdır. Devam için EVET yazın: `);
    if (answer !== "EVET") throw new Error("onay verilmedi — hiçbir mesaj okunmadı");

    const data = await readOnly(prisma, async (tx) => {
      const properties = await tx.$queryRaw<{ id: string; checkInTime: string | null; checkOutTime: string | null }[]>`
        SELECT id, "checkInTime", "checkOutTime" FROM "Property" WHERE "organizationId" = ${org.id}`;
      const reservations = await tx.$queryRaw<ReplayReservation[]>`
        SELECT r.id, r."propertyId", r.status, r."arrivalDate", r."departureDate", r."guestCheckoutTime"
        FROM "Reservation" r JOIN "Property" p ON p.id = r."propertyId"
        WHERE p."organizationId" = ${org.id}`;
      const cleanings = await tx.$queryRaw<ReplayCleaning[]>`
        SELECT t."propertyId", t."reservationId", t."dueAt", t.status, t."createdAt",
          (SELECT max(u."createdAt") FROM "TaskUpdate" u WHERE u."taskId" = t.id AND u.status = 'done') AS "doneAt"
        FROM "Task" t JOIN "Property" p ON p.id = t."propertyId"
        WHERE p."organizationId" = ${org.id} AND t.type = 'cleaning'`;
      const messages = await tx.$queryRaw<ReplayMessage[]>`
        SELECT m.body, m."createdAt", c."propertyId", c."reservationId"
        FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId"
        JOIN "Property" p ON p.id = c."propertyId"
        WHERE p."organizationId" = ${org.id}
          AND m.direction = 'inbound'
          AND (m."authorType" IS NULL OR m."authorType" = 'guest')
        ORDER BY m."createdAt" DESC, m.id DESC
        LIMIT ${max}`;
      return { properties, reservations, cleanings, messages };
    });

    const stats = replayStats({ timeZone: orgTimezone(org.timezone), ...data });
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(stats, null, 1)}\n`, "utf8");
    // Yalnız SAYILAR basılır — metin asla.
    const e = stats.earlyOnly;
    console.log(`Taranan misafir mesajı: ${stats.messages} · konaklama değişikliği isteği (kelime ağı, alt sınır): ${stats.stayRequests.any}`);
    console.log(`Yalnız erken giriş: ${e.messages} mesaj · ${e.requests} istek (rezervasyon başına ilk soru) · varış günü sorulan: ${e.askedOnArrivalDay} · aynı gün devir: ${e.sameDayTurnover}`);
    console.log(`Temizlik görevi olan: ${e.cleaningTaskFound} · sorulduğunda hazır: ${e.readyWhenAsked} · girişe kadar hazır oldu (üst sınır): ${e.readyLaterSameDay}`);
    console.log(`Yazıldı: ${path.relative(REPO, out)}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // Veritabanı / bağlantı hataları (Prisma) sunucu adresi taşıyabilir → yalnız hata KODU (dışa aktarımla aynı kural).
    const e = err as { code?: unknown; errorCode?: unknown; name?: unknown };
    const dbCode = typeof e?.code === "string" ? e.code : typeof e?.errorCode === "string" ? e.errorCode : null;
    const ours = err instanceof Error && !dbCode && !String(e?.name ?? "").startsWith("PrismaClient");
    console.error(`Durdu: ${ours ? (err as Error).message : `veritabanı hatası${dbCode ? ` (${dbCode})` : ""}`}`);
    process.exit(1);
  });
}
