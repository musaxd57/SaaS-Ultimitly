/* ---------------------------------------------------------------------------
 * GERÇEK MİSAFİR MESAJLARINDAN EVAL ADAYI ÇIKARMA — SALT OKUMA (09-24, kurucu: "host hesabımdaki mesajları
 * kesinlikle bozmadan, hiçbir değişiklik yapmadan salt okuma ile kullanalım").
 *
 * Kurucunun makinesinde, elle çalıştırılır; hiçbir şey bunu otomatik çağırmaz:
 *   npx tsx scripts/eval-real-export.ts --email <giriş e-postanız>
 *   seçenekler: --candidates 180 --rest 120 --seed <metin> --out <yol> --force (var olan dosyanın üzerine yaz)
 *
 * Veritabanı adresi GİZLİ sorulur (ekrana basılmaz, komut geçmişine yazılmaz); istenirse EVAL_REAL_DATABASE_URL.
 * YALNIZ kendi kuruluşunuz: e-posta bir SAHİP (owner) hesabı olmalı; okumadan önce kuruluşun adı gösterilir ve
 * "EVET" yazmanız istenir (başka bir müşterinin verisi yanlışlıkla okunmasın — KVKK amaçla sınırlılık).
 *
 * 🚨 SALT OKUMA — üç katman (her okuma işlemi için ayrı ayrı, `readOnly`):
 *   1. İşlemin ilk komutu `SET TRANSACTION READ ONLY`: PostgreSQL bu işlemde HER yazmayı reddeder.
 *   2. Tüm SET komutlarından SONRA `SHOW transaction_read_only` tam olarak "on" değilse hiçbir veri okunmaz.
 *   3. Betik yalnız sabit SELECT'ler çalıştırır — izinli ham komutların listesi mekanik olarak pinli
 *      (`tests/unit/eval-real.test.ts`). Sorgu süresi 60 sn ile sınırlı; en fazla --max (20.000) mesaj.
 *
 * 🚨 GİZLİLİK: mesaj METNİ ekrana basılmaz. Ad ve adresler YALNIZ bellekte, maskeleme için okunur; dosyaya
 * anonimleştirilmiş metin yazılır (`src/lib/eval-real/anonymize.ts`). Veritabanı kimliği, tarih, konuşma ve
 * rezervasyon bilgisi dosyaya GİRMEZ (öğe kimliği "r-0001" gibi sıra numarasıdır). Çıktı yalnız git'in yok saydığı
 * `evals/private/` altına (ya da depo dışına). Sonraki adım: `npx tsx scripts/eval-real-label.ts`.
 * Protokol: `docs/EVAL-MUHURLU-FINAL.md`.
 * ------------------------------------------------------------------------- */

import { PrismaClient, type Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { anonymizeGuestText } from "../src/lib/eval-real/anonymize";
import { guessLanguage, stratifiedSample } from "../src/lib/eval-real/sampling";
import { guardedOutputPath, readOnlyVerified, type CandidateFile, type CandidateItem } from "../src/lib/eval-real/labeling";
import { gitIgnoredIn } from "./eval-real-shared";

const REPO = path.resolve(__dirname, "..");
const gitIgnored = gitIgnoredIn(REPO);
const MAX_BODY = 4000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
function intArg(name: string, dflt: number, max: number): number {
  const v = Number(arg(name));
  return Number.isInteger(v) && v >= 0 ? Math.min(v, max) : dflt;
}

export function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    if (hidden) {
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (!muted) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

/**
 * SALT-OKUMA işlemi: ilk komut READ ONLY, ardından süre sınırı, EN SON doğrulama; doğrulanmadan `fn` ÇAĞRILMAZ.
 * Betikteki ham komutların TEK kaynağı burasıdır (pinli).
 */
export async function readOnly<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
      if (!readOnlyVerified(await tx.$queryRawUnsafe("SHOW transaction_read_only"))) {
        throw new Error("salt-okuma doğrulanamadı — hiçbir veri okunmadı");
      }
      return fn(tx);
    },
    { maxWait: 15_000, timeout: 180_000 },
  );
}

interface MsgRow {
  body: string;
  guestIdentifier: string | null;
  guestName: string | null;
  propertyId: string;
}

async function main(): Promise<void> {
  const email = arg("--email")?.trim();
  if (!email) throw new Error("gerekli: --email <kendi giriş e-postanız> (yalnız kendi kuruluşunuzun mesajları okunur)");
  const out = guardedOutputPath(REPO, arg("--out") ?? "evals/private/real-candidates.json", gitIgnored);
  // Etiketleme başladıktan sonra yeniden üretmek etiketleri boşa çıkarır → varsayılan olarak üzerine YAZILMAZ.
  if (existsSync(out) && !process.argv.includes("--force")) {
    throw new Error("aday dosyası zaten var — yeniden üretmek etiketleri geçersiz kılar (bilerek istiyorsanız --force)");
  }
  const candidateQuota = intArg("--candidates", 180, 1000);
  const restQuota = intArg("--rest", 120, 1000);
  const max = intArg("--max", 20000, 100000);
  const seed = arg("--seed")?.trim() || randomBytes(8).toString("hex");

  const url = process.env.EVAL_REAL_DATABASE_URL?.trim() || (await ask("Veritabanı adresi (DATABASE_URL, ekrana basılmaz): ", true));
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error("geçerli bir postgres adresi değil");
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });

  try {
    // 1) Kuruluşu çöz ve ONAY al (ayrı salt-okuma işlemi; kullanıcı düşünürken işlem açık kalmaz).
    const org = await readOnly(prisma, async (tx) => {
      const users = await tx.$queryRaw<{ organizationId: string; role: string }[]>`
        SELECT "organizationId", role FROM "User" WHERE lower(email) = lower(${email}) LIMIT 2`;
      if (users.length !== 1) throw new Error("bu e-postayla tek bir kullanıcı bulunamadı");
      if (users[0].role !== "owner") throw new Error("yalnız kuruluş SAHİBİ (owner) kendi verisini dışa aktarabilir");
      const orgId = users[0].organizationId;
      const orgs = await tx.$queryRaw<{ name: string }[]>`SELECT name FROM "Organization" WHERE id = ${orgId}`;
      if (orgs.length !== 1) throw new Error("kuruluş bulunamadı");
      const counts = await tx.$queryRaw<{ properties: bigint; messages: bigint }[]>`
        SELECT
          (SELECT count(*) FROM "Property" WHERE "organizationId" = ${orgId}) AS properties,
          (SELECT count(*) FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
             JOIN "Property" p ON p.id = c."propertyId"
           WHERE p."organizationId" = ${orgId} AND m.direction = 'inbound') AS messages`;
      return { id: orgId, name: orgs[0].name, properties: Number(counts[0].properties), messages: Number(counts[0].messages) };
    });
    const answer = await ask(
      `Okunacak kuruluş: "${org.name}" (${org.properties} mülk, ${org.messages} misafir mesajı). Yalnız okunur, hiçbir şey değişmez. Devam için EVET yazın: `,
    );
    if (answer !== "EVET") throw new Error("onay verilmedi — hiçbir mesaj okunmadı");

    // 2) Mesajları oku (yeni salt-okuma işlemi).
    const data = await readOnly(prisma, async (tx) => {
      const users = await tx.$queryRaw<{ name: string | null }[]>`SELECT name FROM "User" WHERE "organizationId" = ${org.id}`;
      const props = await tx.$queryRaw<{ id: string; name: string; address: string | null; checkInTime: string | null; checkOutTime: string | null }[]>`
        SELECT id, name, address, "checkInTime", "checkOutTime" FROM "Property" WHERE "organizationId" = ${org.id}`;
      const msgs = await tx.$queryRaw<MsgRow[]>`
        SELECT m.body, c."guestIdentifier", r."guestName", c."propertyId"
        FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId"
        JOIN "Property" p ON p.id = c."propertyId"
        LEFT JOIN "Reservation" r ON r.id = c."reservationId"
        WHERE p."organizationId" = ${org.id}
          AND m.direction = 'inbound'
          AND (m."authorType" IS NULL OR m."authorType" = 'guest')
        ORDER BY m."createdAt" DESC, m.id DESC
        LIMIT ${max}`;
      return { users, props, msgs };
    });

    const placeNames = [org.name, ...data.props.flatMap((p) => [p.name, p.address ?? ""])].filter(Boolean);
    const hostNames = data.users.map((u) => u.name ?? "").filter(Boolean);
    const propById = new Map(data.props.map((p) => [p.id, p]));
    const items = data.msgs
      .filter((m) => typeof m.body === "string" && m.body.trim().length >= 2 && m.body.length <= MAX_BODY)
      .map((m) => {
        const p = propById.get(m.propertyId);
        const text = anonymizeGuestText(m.body, {
          personNames: [m.guestIdentifier ?? "", m.guestName ?? "", ...hostNames].filter(Boolean),
          placeNames,
        });
        return { text, checkIn: p?.checkInTime || "15:00", checkOut: p?.checkOutTime || "11:00" };
      });

    const sample = stratifiedSample(items, { text: (i) => i.text, candidateQuota, restQuota, seed });
    const file: CandidateFile = {
      kind: "lixus-real-candidates",
      version: 1,
      seed,
      population: sample.population,
      items: sample.picked.map(({ item, stratum }, i): CandidateItem => ({
        id: `r-${String(i + 1).padStart(4, "0")}`,
        stratum,
        text: item.text,
        lang: guessLanguage(item.text),
        checkIn: item.checkIn,
        checkOut: item.checkOut,
      })),
    };
    mkdirSync(path.dirname(out), { recursive: true });
    const json = `${JSON.stringify(file, null, 1)}\n`;
    writeFileSync(out, json, "utf8");
    // Yalnız SAYILAR basılır — metin asla.
    const nCand = file.items.filter((x) => x.stratum === "candidate").length;
    console.log(`Okunan misafir mesajı: ${data.msgs.length} · tekrarsız aday katmanı ${sample.population.candidate}, diğer ${sample.population.rest}`);
    console.log(`Örnek: ${nCand} aday + ${file.items.length - nCand} diğer = ${file.items.length}`);
    console.log(`Yazıldı: ${path.relative(REPO, out)} · SHA-256 ${createHash("sha256").update(json).digest("hex")}`);
    console.log("Sonraki adım: npx tsx scripts/eval-real-label.ts");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // Hata metni YALNIZ bizim ürettiğimiz sınıf mesajıysa basılır. Veritabanı / bağlantı hataları (Prisma) sunucu
    // adresi ve kullanıcı adı taşıyabilir → yalnız hata KODU (inceleme 09-24).
    const e = err as { code?: unknown; errorCode?: unknown; name?: unknown };
    const dbCode = typeof e?.code === "string" ? e.code : typeof e?.errorCode === "string" ? e.errorCode : null;
    const ours = err instanceof Error && !dbCode && !String(e?.name ?? "").startsWith("PrismaClient");
    console.error(`Durdu: ${ours ? (err as Error).message : `veritabanı hatası${dbCode ? ` (${dbCode})` : ""}`}`);
    process.exit(1);
  });
}
