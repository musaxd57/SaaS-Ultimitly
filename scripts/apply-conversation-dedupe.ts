#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// APPLY — Conversation dedupe (Faz C). TEK, ALL-OR-NOTHING TRANSACTION.
//
// ⚠️ VARSAYILAN OLARAK KAPALI. Yazma için ÜÇ şart birden gerekir:
//     DEDUPE_APPLY=1
//     APPLY_PHASE_A_DEPLOYED_SHA=<Railway'de ACTIVE olan commit>
//     DEDUPE_EXPECT_GROUPS / _LOSERS / _EXACT_DUPES  (dry-run rakamlarıyla BİREBİR)
//   Biri eksik/uyumsuzsa hiçbir yazma yapılmadan durur.
//
// ⚠️ ÇALIŞTIRMADAN HEMEN ÖNCE TAZE `pg_dump` + SHA256 ALINACAK. Bu script
//   yedek almaz ve yedeği doğrulayamaz — operatörün yükümlülüğü.
//
// ── NEDEN TEK TRANSACTION ───────────────────────────────────────────────────
// Popülasyon küçük ve KAPALI (Faz A'dan sonra yeni çift satır üretilemez):
// 7 grup / 14 satır / 58 mesaj. Grup-başına transaction, yarıda kalan bir
// koşuda "yarısı birleşmiş" bir dünya bırakır ve ikinci koşunun beklenen
// sayıları artık tutmaz. Tek TX'te ya hepsi olur ya hiçbiri.
//
// ── NEDEN KİLİTLER ──────────────────────────────────────────────────────────
// Faz A'nın NS-43 kimlik kilidini YENİDEN KULLANIR: birleştirme sürerken
// eşzamanlı bir sync üçüncü satırı açamaz. Kilit sırası GLOBAL SÖZLEŞMEYE
// uyar — önce erasure(NS 40, org) sonra identity(NS 43, thread); her iki küme
// de deterministik sırada alınır, böylece iki apply koşusu da kilitlenemez.
//
// ── DEĞİŞMEZ ────────────────────────────────────────────────────────────────
// Hiçbir BENZERSİZ mesaj/olay kaybolmaz. Düşen tek şey, aynı sağlayıcı
// olayının TÜM anlamlı alanları eşit olan fazlalık kopyasıdır.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";

import {
  CONVERSATION_FIELD_POLICY,
  assertPolicyCoverage,
  classifyGroup,
  resolveTimeouts,
  statusRank,
} from "./dryrun-conversation-dedupe";

/** Faz A (kimlik kilidi) commit'i — apply'ın ön koşulu. */
export const PHASE_A_COMMIT = "3effd99";
/** Faz A ile aynı namespace — birleştirme, sync'in kullandığı kilidi alır. */
const CONVERSATION_IDENTITY_LOCK_NS = 43;
/** erasure.ts ile aynı namespace — global kilit sırası 40 → 43 korunur. */
const ERASURE_LOCK_NS = 40;

type Row = Record<string, unknown> & { id: string };

/**
 * TEST-ONLY seam: tüm kilitler ALINDIKTAN hemen sonra ateşlenir. Testler
 * "apply, sync'i gerçekten bekletiyor mu" sorusunu ZAMANLAMAYA bağlı olmadan
 * ölçmek için kullanır. Üretimde null → sıfır maliyet, sıfır davranış.
 */
export const __applyHooks: { afterLocks: null | (() => Promise<void>) } = { afterLocks: null };

export interface ApplyExpectations {
  groups: number;
  losers: number;
  exactDuplicates: number;
}

export interface ApplyOutcome {
  groups: number;
  losers: number;
  messagesDropped: number;
  messagesMovedUnique: number;
  messagesMovedNull: number;
  refsRepointed: { messageOutbox: number; riskEvent: number; shadowVerdict: number };
  conversationsBefore: number;
  conversationsAfter: number;
  messagesBefore: number;
  messagesAfter: number;
  noop: boolean;
}

// ---------------------------------------------------------------------------
// Conversation'a referans veren MODEL ENVANTERİ — şemadan runtime'da türetilir.
//
// Elle yazılmış bir liste, ileride eklenen bir modeli SESSİZCE atlar ve
// birleşmeden sonra dangling referans bırakır. Bunun yerine DMMF taranır:
// `Conversation` tipine ilişkisi olan VEYA `conversationId` alanı taşıyan her
// model bulunur; bulunanlar bilinen kümeyle karşılaştırılır ve BİLİNMEYEN
// varsa apply hiçbir yazma yapmadan durur.
// ---------------------------------------------------------------------------
const HANDLED_REFERENCES = {
  /** FK + onDelete: Cascade — mesajlar taşınır/ayıklanır, sonra loser silinir. */
  cascade: ["Message"],
  /** FK YOK — loser silinince dangling kalır, bu yüzden keeper'a repoint edilir. */
  repoint: ["MessageOutbox", "RiskEvent", "ShadowVerdict"],
} as const;

export function inventoryConversationReferences(): string[] {
  const found = new Set<string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    if (model.name === "Conversation") continue;
    for (const f of model.fields) {
      // YALNIZ SAHİP TARAF. `relationFromFields` dolu olan taraf FK'yi TUTAN
      // taraftır. Geri-ilişkiler (Property.conversations, Reservation.conversations)
      // Conversation'a işaret ETMEZ — Conversation onlara işaret eder; bir
      // konuşma silinince orada dangling bir şey kalmaz, liste kısalır.
      // Bu ayrımı yapmayan bir tarama apply'ı kalıcı olarak bloklardı.
      if (f.kind === "object" && f.type === "Conversation" && (f.relationFromFields?.length ?? 0) > 0) {
        found.add(model.name);
      }
      if (f.kind === "scalar" && f.name === "conversationId") found.add(model.name);
    }
  }
  return [...found].sort();
}

/** Bilinmeyen referans → apply DURUR (fail-closed). */
export function assertReferenceCoverage(): void {
  const handled = new Set<string>([...HANDLED_REFERENCES.cascade, ...HANDLED_REFERENCES.repoint]);
  const unknown = inventoryConversationReferences().filter((m) => !handled.has(m));
  if (unknown.length) {
    throw new Error(
      `Conversation'a referans veren DESTEKLENMEYEN model(ler): ${unknown.join(", ")} — apply durduruldu`,
    );
  }
}

/**
 * Railway'de ACTIVE olan commit gerçekten Faz A'yı içeriyor mu?
 *
 * DÜRÜST SINIR: bu kontrol, operatörün Railway panelinden OKUDUĞU SHA'nın Faz
 * A'yı içerdiğini kanıtlar — Railway'in o an onu koşturduğunu KANITLAMAZ.
 * O adım insana aittir; buradaki kapı onu bilinçli ve doğrulanmış bir eylem
 * yapar. git yoksa / SHA bilinmiyorsa fail-closed.
 */
export function assertPhaseADeployed(sha: string | undefined, cwd = process.cwd()): void {
  const value = (sha ?? "").trim();
  if (!value) throw new Error("APPLY_PHASE_A_DEPLOYED_SHA yok — Railway'de ACTIVE commit'i ver");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", PHASE_A_COMMIT, value], { cwd, stdio: "ignore" });
  } catch {
    throw new Error(
      `Verilen deploy SHA Faz A'yı (${PHASE_A_COMMIT}) İÇERMİYOR ya da bilinmiyor — apply durduruldu`,
    );
  }
}

/** Saf: env → beklenen sayılar. Eksik/geçersizse fail-closed. */
export function resolveExpectations(env: Record<string, string | undefined>): ApplyExpectations {
  const read = (key: string) => {
    const raw = env[key];
    if (raw == null || String(raw).trim() === "") throw new Error(`${key} yok — beklenen sayı verilmeli`);
    const n = Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 0) throw new Error(`${key} negatif olmayan tam sayı olmalı`);
    return n;
  };
  return {
    groups: read("DEDUPE_EXPECT_GROUPS"),
    losers: read("DEDUPE_EXPECT_LOSERS"),
    exactDuplicates: read("DEDUPE_EXPECT_EXACT_DUPES"),
  };
}

/** Politika yönlerine göre keeper'a yazılacak alanları hesaplar (saf). */
export function mergedConversationFields(rows: Row[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const maxDate = (f: string) => {
    const vals = rows.map((r) => r[f] as Date | null).filter((v): v is Date => v instanceof Date);
    return vals.length ? new Date(Math.max(...vals.map((d) => d.getTime()))) : null;
  };
  const minDateConservative = (f: string) => {
    const vals = rows.map((r) => r[f] as Date | null);
    // NULL = "hiç senklenmedi" → EN İHTİYATLI değer; varsa o kazanır.
    if (vals.some((v) => v == null)) return null;
    return new Date(Math.min(...(vals as Date[]).map((d) => d.getTime())));
  };
  const singleNonNull = (f: string) => rows.map((r) => r[f]).find((v) => v != null) ?? null;

  for (const [field, policy] of Object.entries(CONVERSATION_FIELD_POLICY)) {
    switch (policy) {
      case "status_rank": {
        const best = rows.reduce((a, b) => (statusRank(String(b.status)) > statusRank(String(a.status)) ? b : a));
        out.status = best.status;
        break;
      }
      case "max_wins":
        out[field] = maxDate(field);
        break;
      case "min_wins":
        out[field] = minDateConservative(field);
        break;
      case "single_non_null":
        out[field] = singleNonNull(field);
        break;
      // keeper_wins / anon_guard: keeper'ın değeri zaten yerinde, YAZILMAZ
      // (anon_guard için kritik: kaybedenden ad OKUNMAZ).
      // row_identity / identity_key / system_managed: dokunulmaz.
      default:
        break;
    }
  }
  // createdAt min_wins ile hesaplandı; null gelemez (NOT NULL kolon) ama
  // fail-safe: hesaplanamadıysa keeper'ınkini koru.
  if (out.createdAt == null) delete out.createdAt;
  return out;
}

export async function applyConversationDedupe(
  prisma: PrismaClient,
  opts: {
    expectations: ApplyExpectations;
    deployedSha?: string;
    allowPrimary?: boolean;
    timeouts?: ReturnType<typeof resolveTimeouts>;
    /** TEST-ONLY: git/deploy kapısını atlar. Üretim yolunda ASLA kullanılmaz. */
    skipDeployGate?: boolean;
    cwd?: string;
  },
): Promise<ApplyOutcome> {
  assertPolicyCoverage();
  assertReferenceCoverage();
  if (!opts.skipDeployGate) assertPhaseADeployed(opts.deployedSha, opts.cwd);
  const timeouts = opts.timeouts ?? resolveTimeouts();

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${timeouts.statementMs}`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${timeouts.lockMs}`);
      await tx.$executeRawUnsafe(`SET LOCAL idle_in_transaction_session_timeout = ${timeouts.idleTxMs}`);

      const conversationsBefore = await tx.conversation.count();
      const messagesBefore = await tx.message.count();

      const keys = await tx.$queryRaw<{ propertyId: string; externalReservationId: string }[]>`
        SELECT "propertyId", "externalReservationId"
        FROM "Conversation"
        WHERE "externalReservationId" IS NOT NULL
        GROUP BY "propertyId", "externalReservationId"
        HAVING COUNT(*) > 1
        ORDER BY "propertyId", "externalReservationId"
      `;

      // İKİNCİ KOŞU = NO-OP. Çakışma kalmadıysa beklenen sayılar da 0 olmalı;
      // aksi halde operatör bayat rakamlarla koşuyor demektir.
      if (keys.length === 0) {
        if (opts.expectations.groups !== 0) {
          throw new Error(
            `Çakışan grup YOK ama DEDUPE_EXPECT_GROUPS=${opts.expectations.groups} — zaten uygulanmış olabilir, rakamları tazele`,
          );
        }
        return {
          groups: 0,
          losers: 0,
          messagesDropped: 0,
          messagesMovedUnique: 0,
          messagesMovedNull: 0,
          refsRepointed: { messageOutbox: 0, riskEvent: 0, shadowVerdict: 0 },
          conversationsBefore,
          conversationsAfter: conversationsBefore,
          messagesBefore,
          messagesAfter: messagesBefore,
          noop: true,
        } satisfies ApplyOutcome;
      }

      // ── KİLİTLER: önce erasure(org), sonra identity(thread) — ikisi de sıralı ──
      const orgRows = await tx.$queryRaw<{ organizationId: string }[]>`
        SELECT DISTINCT p."organizationId"
        FROM "Property" p
        WHERE p.id IN (
          SELECT DISTINCT c."propertyId" FROM "Conversation" c
          WHERE c."externalReservationId" IS NOT NULL
        )
        ORDER BY 1
      `;
      for (const o of orgRows) {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${ERASURE_LOCK_NS}::int4, hashtext(${o.organizationId}))`,
        );
      }
      for (const k of keys) {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${CONVERSATION_IDENTITY_LOCK_NS}::int4, hashtext(${`${k.propertyId}:${k.externalReservationId}`}))`,
        );
      }

      if (__applyHooks.afterLocks) await __applyHooks.afterLocks();

      // ── KİLİT İÇİNDE planı YENİDEN ölç (dry-run anındaki dünya hâlâ geçerli mi) ──
      let losers = 0;
      let dropped = 0;
      let movedUnique = 0;
      let movedNull = 0;
      const refs = { messageOutbox: 0, riskEvent: 0, shadowVerdict: 0 };

      for (const key of keys) {
        const rows = (await tx.conversation.findMany({
          where: { propertyId: key.propertyId, externalReservationId: key.externalReservationId },
        })) as unknown as Row[];
        const msgs = (await tx.message.findMany({
          where: { conversationId: { in: rows.map((r) => r.id) } },
        })) as unknown as (Record<string, unknown> & { id: string; conversationId: string })[];

        const plan = classifyGroup(rows, msgs);
        // TEK fark/çelişki → HİÇBİR yazma yapmadan rollback (all-or-nothing).
        if (plan.failed) {
          throw new Error(`Kilit altında ÇELİŞKİ bulundu (${plan.failed}) — tüm işlem geri alındı`);
        }

        const loserIds = plan.losers.map((l) => l.id);
        losers += loserIds.length;

        // 1) Tam eşit fazlalık kopyaları düşür (canonical = keeper'daki satır).
        if (plan.dropExactIds.length) {
          const res = await tx.message.deleteMany({ where: { id: { in: plan.dropExactIds } } });
          if (res.count !== plan.dropExactIds.length) throw new Error("duplicate silme sayısı tutmadı — rollback");
          dropped += res.count;
        }
        // 2) Benzersiz ve anahtarsız mesajları TAŞI (asla düşürme).
        const toMove = [...plan.moveUniqueIds, ...plan.moveNullIds];
        if (toMove.length) {
          const res = await tx.message.updateMany({
            where: { id: { in: toMove } },
            data: { conversationId: plan.keeper.id },
          });
          if (res.count !== toMove.length) throw new Error("mesaj taşıma sayısı tutmadı — rollback");
          movedUnique += plan.moveUniqueIds.length;
          movedNull += plan.moveNullIds.length;
        }
        // 3) FK'sız referansları keeper'a repoint et.
        refs.messageOutbox += (
          await tx.messageOutbox.updateMany({
            where: { conversationId: { in: loserIds } },
            data: { conversationId: plan.keeper.id },
          })
        ).count;
        refs.riskEvent += (
          await tx.riskEvent.updateMany({
            where: { conversationId: { in: loserIds } },
            data: { conversationId: plan.keeper.id },
          })
        ).count;
        refs.shadowVerdict += (
          await tx.shadowVerdict.updateMany({
            where: { conversationId: { in: loserIds } },
            data: { conversationId: plan.keeper.id },
          })
        ).count;

        // 4) Kolonları YÖNLÜ birleştir.
        const merged = mergedConversationFields(rows);
        if (Object.keys(merged).length) {
          await tx.conversation.update({ where: { id: plan.keeper.id }, data: merged });
        }

        // 5) Boşalan kaybedenleri sil (mesajları kalmamış olmalı).
        const stray = await tx.message.count({ where: { conversationId: { in: loserIds } } });
        if (stray !== 0) throw new Error("kaybedende mesaj kaldı — rollback");
        const del = await tx.conversation.deleteMany({ where: { id: { in: loserIds } } });
        if (del.count !== loserIds.length) throw new Error("kaybeden silme sayısı tutmadı — rollback");

        // 6) SON KOŞULLAR — KİLİTLENMİŞ KAPSAMA scoped.
        //
        // ⚠️ Buradaki iddialar bilinçli olarak GLOBAL DEĞİL. Global "önce−sonra"
        // eşitliği, apply sürerken BAŞKA bir thread'e mesaj yazan eşzamanlı bir
        // sync yüzünden tutmaz ve apply'ı sebepsiz rollback'e sürüklerdi —
        // sync cron'u 2 dakikada bir koştuğu için bu nadir değil, MUHTEMELDİR.
        // Kilit altındaki anahtarlarda ise sayılar kararlıdır (sync de aynı
        // NS-43 kilidini almak zorunda), dolayısıyla scoped iddia hem doğru hem
        // yanlış-pozitif üretmez.
        const left = await tx.conversation.count({
          where: { propertyId: key.propertyId, externalReservationId: key.externalReservationId },
        });
        if (left !== 1) throw new Error(`anahtar başına ${left} satır kaldı — rollback`);

        const expectedOnKeeper = msgs.length - plan.dropExactIds.length;
        const onKeeper = await tx.message.count({ where: { conversationId: plan.keeper.id } });
        if (onKeeper !== expectedOnKeeper) {
          throw new Error(`keeper mesaj sayısı ${onKeeper} ≠ beklenen ${expectedOnKeeper} — rollback`);
        }
      }

      // ── ONAY: operatörün verdiği beklenti BİREBİR tutmalı ────────────────
      const e = opts.expectations;
      if (keys.length !== e.groups) throw new Error(`grup ${keys.length} ≠ beklenen ${e.groups} — rollback`);
      if (losers !== e.losers) throw new Error(`kaybeden ${losers} ≠ beklenen ${e.losers} — rollback`);
      if (dropped !== e.exactDuplicates) {
        throw new Error(`tam-eşit-duplicate ${dropped} ≠ beklenen ${e.exactDuplicates} — rollback`);
      }

      // Toplamlar RAPOR İÇİN ölçülür; eşitlik İDDİA EDİLMEZ (↑gerekçe). Kilit
      // altındaki her anahtar zaten tek tek doğrulandı.
      const conversationsAfter = await tx.conversation.count();
      const messagesAfter = await tx.message.count();

      return {
        groups: keys.length,
        losers,
        messagesDropped: dropped,
        messagesMovedUnique: movedUnique,
        messagesMovedNull: movedNull,
        refsRepointed: refs,
        conversationsBefore,
        conversationsAfter,
        messagesBefore,
        messagesAfter,
        noop: false,
      } satisfies ApplyOutcome;
    },
    { timeout: Math.max(120_000, timeouts.statementMs * 8), maxWait: 15_000 },
  );
}

/** Saf biçimlendirici — yalnız kategori + sayı. */
export function formatApplyOutcome(o: ApplyOutcome): string[] {
  const pad = (l: string, v: unknown) => `${l.padEnd(52)} ${v}`;
  const L: string[] = [];
  L.push("");
  L.push(o.noop ? "=== APPLY — NO-OP (çakışma yok) ===" : "=== APPLY — UYGULANDI (tek transaction) ===");
  L.push("");
  L.push(pad("Birleştirilen grup", o.groups));
  L.push(pad("Silinen kaybeden konuşma", o.losers));
  L.push(pad("Düşürülen tam-eşit duplicate mesaj", o.messagesDropped));
  L.push(pad("Taşınan BENZERSİZ mesaj", o.messagesMovedUnique));
  L.push(pad("Taşınan externalId NULL mesaj", o.messagesMovedNull));
  L.push(pad("Repoint MessageOutbox", o.refsRepointed.messageOutbox));
  L.push(pad("Repoint RiskEvent", o.refsRepointed.riskEvent));
  L.push(pad("Repoint ShadowVerdict", o.refsRepointed.shadowVerdict));
  L.push("");
  L.push(pad("Conversation", `${o.conversationsBefore} → ${o.conversationsAfter}`));
  L.push(pad("Message", `${o.messagesBefore} → ${o.messagesAfter}`));
  L.push("");
  L.push("Hiçbir BENZERSİZ mesaj/olay kaybolmadı; düşen yalnız fazlalık kopyalardır.");
  L.push("");
  return L;
}

async function main() {
  if (process.env.DEDUPE_APPLY !== "1") {
    console.error("[dedupe-apply] DEDUPE_APPLY=1 verilmedi — VARSAYILAN KAPALI, hiçbir şey yapılmadı.");
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[dedupe-apply] DATABASE_URL yok — bağlanılmadı.");
    process.exitCode = 1;
    return;
  }
  let prisma: PrismaClient | undefined;
  try {
    const expectations = resolveExpectations(process.env);
    prisma = new PrismaClient();
    const outcome = await applyConversationDedupe(prisma, {
      expectations,
      deployedSha: process.env.APPLY_PHASE_A_DEPLOYED_SHA,
    });
    console.log(formatApplyOutcome(outcome).join("\n"));
    process.exitCode = 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known = /rollback|beklenen|APPLY_PHASE_A|DEDUPE_|Faz A|DESTEKLENMEYEN|ÇELİŞKİ|politika haritası/i.test(msg);
    console.error(`[dedupe-apply] BAŞARISIZ (hiçbir değişiklik yapılmadı): ${known ? msg : ((e as Error)?.name ?? "Error")}`);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}

const invokedDirectly = /apply-conversation-dedupe\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? "");
if (invokedDirectly) void main();
