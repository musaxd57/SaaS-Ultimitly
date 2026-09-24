/* ---------------------------------------------------------------------------
 * GERÇEK MİSAFİR MESAJLARINDAN EVAL ADAYI ÇIKARMA — SALT OKUMA (09-24, kurucu: "host hesabımdaki mesajları
 * kesinlikle bozmadan, hiçbir değişiklik yapmadan salt okuma ile kullanalım").
 *
 * Kurucunun makinesinde, elle çalıştırılır; hiçbir şey bunu otomatik çağırmaz:
 *   npx tsx scripts/eval-real-export.ts --email <giriş e-postanız>
 *   (ya da --org <organizasyon kimliği>)   seçenekler: --candidates 180 --rest 120 --seed <metin>
 *
 * Veritabanı adresi GİZLİ sorulur (ekrana basılmaz, komut geçmişine yazılmaz); istenirse EVAL_REAL_DATABASE_URL.
 *
 * 🚨 SALT OKUMA — üç katman:
 *   1. Tek işlem, ilk komut `SET TRANSACTION READ ONLY`: PostgreSQL bu işlemde HER yazmayı reddeder.
 *   2. `SHOW transaction_read_only` tam olarak "on" değilse hiçbir veri okunmadan durur (`readOnlyVerified`).
 *   3. Betik yalnız SELECT çalıştırır — yazma çağrısı içermediği mekanik olarak pinli (`tests/unit/eval-real.test.ts`).
 * Sorgu süresi 60 sn ile sınırlı; tek seferde en fazla --max (varsayılan 20.000) mesaj okunur.
 *
 * 🚨 GİZLİLİK: mesaj METNİ ekrana basılmaz; çıktı yalnız git'in yok saydığı `evals/private/` altına (ya da depo
 * dışına) yazılır, anonimleştirilmiş olarak (`src/lib/eval-real/anonymize.ts`). Veritabanı kimliği, tarih, konuşma
 * ve rezervasyon bilgisi dosyaya GİRMEZ (öğe kimliği "r-0001" gibi sıra numarasıdır).
 * Sonraki adım: `npx tsx scripts/eval-real-label.ts` (etiketleme). Protokol: `docs/EVAL-MUHURLU-FINAL.md`.
 * ------------------------------------------------------------------------- */

import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
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


function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

interface MsgRow {
  body: string;
  guestIdentifier: string | null;
  guestName: string | null;
  propertyId: string;
}

async function main(): Promise<void> {
  const email = arg("--email")?.trim();
  const orgArg = arg("--org")?.trim();
  if (!email === !orgArg) throw new Error("tam olarak biri gerekli: --email <giriş e-postası> ya da --org <kimlik>");
  const out = guardedOutputPath(REPO, arg("--out") ?? "evals/private/real-candidates.json", gitIgnored);
  const candidateQuota = intArg("--candidates", 180, 1000);
  const restQuota = intArg("--rest", 120, 1000);
  const max = intArg("--max", 20000, 100000);
  const seed = arg("--seed")?.trim() || randomBytes(8).toString("hex");

  const url = process.env.EVAL_REAL_DATABASE_URL?.trim() || (await askHidden("Veritabanı adresi (DATABASE_URL, ekrana basılmaz): "));
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error("geçerli bir postgres adresi değil");
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });

  try {
    const data = await prisma.$transaction(
      async (tx) => {
        // 1) İşlemin İLK komutu: salt okuma. 2) Doğrulanmadan hiçbir veri okunmaz.
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        if (!readOnlyVerified(await tx.$queryRawUnsafe("SHOW transaction_read_only"))) {
          throw new Error("salt-okuma doğrulanamadı — hiçbir veri okunmadı");
        }
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");

        let orgId = orgArg ?? "";
        if (email) {
          const users = await tx.$queryRaw<{ organizationId: string }[]>`
            SELECT "organizationId" FROM "User" WHERE lower(email) = lower(${email}) LIMIT 2`;
          if (users.length !== 1) throw new Error("bu e-postayla tek bir kullanıcı bulunamadı");
          orgId = users[0].organizationId;
        }
        const orgs = await tx.$queryRaw<{ name: string }[]>`SELECT name FROM "Organization" WHERE id = ${orgId}`;
        if (orgs.length !== 1) throw new Error("organizasyon bulunamadı");
        const users = await tx.$queryRaw<{ name: string | null }[]>`SELECT name FROM "User" WHERE "organizationId" = ${orgId}`;
        const props = await tx.$queryRaw<{ id: string; name: string; address: string | null; checkInTime: string | null; checkOutTime: string | null }[]>`
          SELECT id, name, address, "checkInTime", "checkOutTime" FROM "Property" WHERE "organizationId" = ${orgId}`;
        const msgs = await tx.$queryRaw<MsgRow[]>`
          SELECT m.body, c."guestIdentifier", r."guestName", c."propertyId"
          FROM "Message" m
          JOIN "Conversation" c ON c.id = m."conversationId"
          JOIN "Property" p ON p.id = c."propertyId"
          LEFT JOIN "Reservation" r ON r.id = c."reservationId"
          WHERE p."organizationId" = ${orgId}
            AND m.direction = 'inbound'
            AND (m."authorType" IS NULL OR m."authorType" = 'guest')
          ORDER BY m."createdAt" DESC
          LIMIT ${max}`;
        return { orgName: orgs[0].name, users, props, msgs };
      },
      { maxWait: 15_000, timeout: 180_000 },
    );

    const placeNames = [data.orgName, ...data.props.flatMap((p) => [p.name, p.address ?? ""])].filter(Boolean);
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
    console.log(`Okunan misafir mesajı: ${data.msgs.length} · tekrar ayıklandıktan sonra aday katmanı ${sample.population.candidate}, diğer ${sample.population.rest}`);
    console.log(`Örnek: ${file.items.filter((x) => x.stratum === "candidate").length} aday + ${file.items.filter((x) => x.stratum === "rest").length} diğer = ${file.items.length}`);
    console.log(`Yazıldı: ${path.relative(REPO, out)} · SHA-256 ${createHash("sha256").update(json).digest("hex")}`);
    console.log("Sonraki adım: npx tsx scripts/eval-real-label.ts");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // Hata mesajı adres/metin taşımaz (yalnız bizim ürettiğimiz sınıf mesajı ya da Prisma kodu).
    const code = (err as { code?: string })?.code;
    console.error(`Durdu: ${err instanceof Error && !code ? err.message : `veritabanı hatası${code ? ` (${code})` : ""}`}`);
    process.exit(1);
  });
}
