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
} from "./dryrun-conversation-dedupe";

/** Faz A (kimlik kilidi) commit'i — apply'ın ön koşulu. */
export const PHASE_A_COMMIT = "3effd99";
/** Faz A ile aynı namespace — birleştirme, sync'in kullandığı kilidi alır. */
const CONVERSATION_IDENTITY_LOCK_NS = 43;
/** erasure.ts ile aynı namespace — global kilit sırası 40 → 43 korunur. */
const ERASURE_LOCK_NS = 40;

export type Row = Record<string, unknown> & { id: string };

/**
 * TEST-ONLY seam: tüm kilitler ALINDIKTAN hemen sonra ateşlenir. Testler
 * "apply, sync'i gerçekten bekletiyor mu" sorusunu ZAMANLAMAYA bağlı olmadan
 * ölçmek için kullanır. Üretimde null → sıfır maliyet, sıfır davranış.
 */
export const __applyHooks: {
  afterLocks: null | (() => Promise<void>);
  /**
   * Bir grubun FOR UPDATE satır kilitleri alındıktan HEMEN sonra, o grubun
   * kilitli konuşma id'leriyle çağrılır. Testler bunu, kilit TUTULURKEN
   * deterministik bir eşzamanlı yazma/insert denemesi enjekte etmek için
   * kullanır (B2/B3 kırmızı-önce testleri). Üretimde null → sıfır maliyet.
   */
  afterRowLock: null | ((conversationIds: string[]) => Promise<void>);
} = { afterLocks: null, afterRowLock: null };

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
  refsRepointed: { messageOutbox: number; riskEvent: number; shadowVerdict: number; signal: number };
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
  /**
   * FK YOK — loser silinince dangling kalır, bu yüzden keeper'a repoint edilir.
   * `Signal` (V1) istisna: FK'si VAR ama `onDelete: SetNull` — dangling KALMAZ, fakat
   * sinyalin türediği mesaj keeper'a taşındığı için bağ da keeper'ı izlemeli; SetNull'a
   * bırakmak izlenebilirliği (kaynak konuşma) sessizce koparırdı. Bu yüzden repoint.
   */
  repoint: ["MessageOutbox", "RiskEvent", "ShadowVerdict", "Signal"],
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
export function assertPhaseADeployed(
  sha: string | undefined,
  opts: { cwd?: string; requiredCommit?: string } = {},
): void {
  const value = (sha ?? "").trim();
  if (!value) throw new Error("APPLY_PHASE_A_DEPLOYED_SHA yok — Railway'de ACTIVE commit'i ver");
  const required = opts.requiredCommit ?? PHASE_A_COMMIT;
  const cwd = opts.cwd ?? process.cwd();
  // GERÇEK git — davranış mock'lanMAZ. `merge-base --is-ancestor` semantiği
  // testlerde gerçek bir geçici depoda sınanır; sahte bir runner yalnız kendi
  // dallanmamızı ölçer, boş güvence üretir.
  const git = (args: string[]) => void execFileSync("git", args, { cwd, stdio: "ignore" });

  // 1) BİLİNİYOR MU — "içermiyor" ile "hiç bilmiyorum"u AYIR.
  //    Sığ (shallow) bir klonda Faz A commit'i nesne olarak bulunmaz ve
  //    `merge-base` yine hata verir; ikisini aynı mesaja yıkmak operatöre
  //    "deploy yanlış" dedirtir, oysa sorun klonun derinliğidir.
  for (const ref of [required, value]) {
    try {
      git(["cat-file", "-e", `${ref}^{commit}`]);
    } catch {
      throw new Error(
        `Commit ${ref} bu klonda BİLİNMİYOR — sığ (shallow) klon olabilir; tam geçmişle çalıştır`,
      );
    }
  }
  // 2) İÇERİYOR MU.
  try {
    git(["merge-base", "--is-ancestor", required, value]);
  } catch {
    throw new Error(`Verilen deploy SHA Faz A'yı (${required}) İÇERMİYOR — apply durduruldu`);
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

/**
 * IDENTITY-ONLY birleştirme (Codex denetimi B1/B2/B4, 2026-07-26 sonrası).
 *
 * Yazılan TEK şey: keeper'da NULL olan bir kimlik-bağlantı alanına (yalnız
 * `single_non_null` politikalı `reservationId`/`externalConversationId`),
 * grup içinde bulunan non-null değerin aktarılmasıdır. `classifyGroup` zaten
 * iki dolu-fakat-FARKLI değeri fail-closed'a düşürdüğü için buraya ulaşan
 * her `single_non_null` alanda en fazla BİR distinct non-null değer vardır —
 * bu yüzden "hangisini seçelim" belirsizliği yoktur.
 *
 * `live_state` politikalı HİÇBİR alan (status, priority, skippedReason,
 * lastRiskLevel, lastRiskType, lastMessageAt, syncCursorAt,
 * autoReplyHoldUntil, autoReplyAttemptedAt) burada YOKTUR — ne okunur ne
 * yazılır. `keeper_wins`/`anon_guard` (channel, guestIdentifier, createdAt)
 * da yazılmaz; keeper'ın kendi değeri neyse o kalır.
 */
export function mergedConversationFields(rows: Row[], keeper: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, policy] of Object.entries(CONVERSATION_FIELD_POLICY)) {
    if (policy !== "single_non_null") continue;
    if (keeper[field] != null) continue; // keeper'da zaten var — dokunma, gereksiz yazım yok
    const resolved = rows.map((r) => r[field]).find((v) => v != null) ?? null;
    if (resolved != null) out[field] = resolved;
  }
  return out;
}

export async function applyConversationDedupe(
  prisma: PrismaClient,
  opts: {
    expectations: ApplyExpectations;
    deployedSha?: string;
    timeouts?: ReturnType<typeof resolveTimeouts>;
    /** TEST-ONLY: git/deploy kapısını atlar. Üretim yolunda ASLA kullanılmaz. */
    skipDeployGate?: boolean;
    cwd?: string;
    /**
     * Transaction'ın İLK ifadesinden hemen önce çağrılır. Çağrılmadıysa hata
     * kapılardan geldi ve HİÇBİR transaction açılmadı demektir — "değişiklik
     * yok" ancak o zaman DÜRÜSTÇE söylenebilir.
     */
    onTransactionStart?: () => void;
  },
): Promise<ApplyOutcome> {
  assertPolicyCoverage();
  assertReferenceCoverage();
  if (!opts.skipDeployGate) assertPhaseADeployed(opts.deployedSha, { cwd: opts.cwd });
  const timeouts = opts.timeouts ?? resolveTimeouts();

  return prisma.$transaction(
    async (tx) => {
      opts.onTransactionStart?.();
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
          refsRepointed: { messageOutbox: 0, riskEvent: 0, shadowVerdict: 0, signal: 0 },
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
      const refs = { messageOutbox: 0, riskEvent: 0, shadowVerdict: 0, signal: 0 };

      for (const key of keys) {
        // ── 0) DETERMİNİSTİK FOR UPDATE — id ASC sırayla, TEK TEK ─────────────
        //
        // Codex denetimi B2/B3 (2026-07-26): NS-43 yalnız `importThread`'i
        // serileştirir. Auto-reply, insana-devir escalation'ı, manuel yanıt
        // rotası ve outbox healer bu satırları NS-43 ALMADAN günceller/mesaj
        // ekler. `SELECT ... FOR UPDATE` bunu PostgreSQL'in KENDİ kilit
        // mekanizmasıyla kapatır:
        //   (a) bu satırları güncelleyen HERHANGİ bir eşzamanlı UPDATE, biz
        //       transaction'ı bitirene kadar BLOKLANIR (B2 — lost update artık
        //       imkânsız: zaten bu alanları hiç YAZMIYORUZ, o yüzden bloke
        //       olan yazıcı bizim commit'imizden SONRA kendi güncel durumuna
        //       sorunsuz uygulanır);
        //   (b) Message.conversationId FK'si bir INSERT sırasında ebeveyn
        //       satırda FOR KEY SHARE ister; FOR UPDATE bununla ÇAKIŞIR — yani
        //       bu gruba yeni bir Message INSERT'i de aynı şekilde bloklanır
        //       (B3 — check-then-delete penceresi kapanır: satır kilitliyken
        //       hiçbir INSERT commit olamaz, biz silene kadar bekler ya da
        //       biz commit ettikten sonra FK ihlaliyle AÇIKÇA başarısız olur;
        //       "sessizce cascade ile kaybolma" senaryosu yapısal olarak yok).
        //
        // Tek tek (id ASC) kilitleniyor — tek bir `WHERE id = ANY(...)` DEĞİL —
        // çünkü PostgreSQL'in ORDER BY + FOR UPDATE ile locking'i SIRALAMASI
        // planlayıcıya bağlıdır (sort ile lock'un hangisi önce çalışır garanti
        // değildir). Ayrı round-trip'lerle kilitlemek, kilit alım SIRASINI
        // istemci tarafında MUTLAK olarak sabitler.
        const toLock = await tx.conversation.findMany({
          where: { propertyId: key.propertyId, externalReservationId: key.externalReservationId },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        for (const { id } of toLock) {
          await tx.$queryRawUnsafe(`SELECT id FROM "Conversation" WHERE id = $1 FOR UPDATE`, id);
        }
        if (__applyHooks.afterRowLock) {
          await __applyHooks.afterRowLock(toLock.map((r) => r.id));
        }

        // ── 1) KİLİT ALTINDA taze veriyle YENİDEN OKU ─────────────────────────
        // Bu, classifyGroup'un kullanacağı TEK doğru kaynaktır — yukarıdaki
        // `toLock` okuması yalnız "hangi id'leri kilitleyeceğiz" sorusuna
        // cevaptı, karara KATILMAZ (o an bayat olabilirdi).
        const rows = (await tx.conversation.findMany({
          where: { id: { in: toLock.map((r) => r.id) } },
          orderBy: { id: "asc" },
        })) as unknown as Row[];
        const msgs = (await tx.message.findMany({
          where: { conversationId: { in: rows.map((r) => r.id) } },
        })) as unknown as (Record<string, unknown> & { id: string; conversationId: string })[];

        const plan = classifyGroup(rows, msgs);
        // TEK fark/çelişki → HİÇBİR yazma yapmadan rollback (all-or-nothing).
        // CANLI DURUM farkı da (live_state_conflict) buraya düşer: rank/tahmin
        // YOK, hangi alan(lar) farklıysa adıyla raporlanır.
        if (plan.failed) {
          const detail = plan.liveStateDiffFields.length ? `: ${plan.liveStateDiffFields.join(",")}` : "";
          throw new Error(`Kilit altında ÇELİŞKİ bulundu (${plan.failed}${detail}) — tüm işlem geri alındı`);
        }

        const loserIds = plan.losers.map((l) => l.id);
        losers += loserIds.length;

        // 2) Tam eşit fazlalık kopyaları düşür (canonical = keeper'daki satır).
        if (plan.dropExactIds.length) {
          const res = await tx.message.deleteMany({ where: { id: { in: plan.dropExactIds } } });
          if (res.count !== plan.dropExactIds.length) throw new Error("duplicate silme sayısı tutmadı — rollback");
          dropped += res.count;
        }
        // 3) Benzersiz ve anahtarsız mesajları TAŞI (asla düşürme).
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

        // 4) Kimlik alanlarını (YALNIZ identity) birleştir — canlı durum YOK.
        const merged = mergedConversationFields(rows, plan.keeper);
        if (Object.keys(merged).length) {
          await tx.conversation.update({ where: { id: plan.keeper.id }, data: merged });
        }

        // 5) SİLMEDEN HEMEN ÖNCE — kilit altında mesaj + referans envanterini
        //    YENİDEN doğrula (Codex denetimi #5).
        //
        //    Message: FOR UPDATE + FK sayesinde bu noktada YENİ bir satır
        //    OLAMAZ (kilit boyunca herhangi bir INSERT bloklanmış olurdu);
        //    `stray === 0` garantilidir, yine de AÇIKÇA doğrulanır (savunma
        //    derinliği — varsayım değil, ölçüm).
        //
        //    MessageOutbox/RiskEvent/ShadowVerdict FK'SIZ: satır kilidi
        //    onları OTOMATİK korumaz (FK olmadığı için INSERT hiçbir tuple
        //    kilidi istemez). Bu yüzden repoint BURADA — mümkün olan EN GEÇ
        //    noktada, silmeden hemen önce — çalıştırılır: idempotent
        //    olduğundan güvenle (yeniden) çalıştırılabilir, ve pencereyi bu
        //    tek round-trip'e indirger (sıfıra indiren bir FK yok, dürüstçe
        //    kalan tek artık budur).
        //    Signal (V1) FK'li ama SetNull: silme onu dangling BIRAKMAZ, bağı
        //    KOPARIR — repoint silmeden ÖNCE olmak zorunda (sonra iz yok).
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
        refs.signal += (
          await tx.signal.updateMany({
            where: { conversationId: { in: loserIds } },
            data: { conversationId: plan.keeper.id },
          })
        ).count;
        const stray = await tx.message.count({ where: { conversationId: { in: loserIds } } });
        if (stray !== 0) throw new Error("kaybedende mesaj kaldı — rollback");

        // 6) Boşalan kaybedenleri sil.
        const del = await tx.conversation.deleteMany({ where: { id: { in: loserIds } } });
        if (del.count !== loserIds.length) throw new Error("kaybeden silme sayısı tutmadı — rollback");

        // 7) SON KOŞULLAR — KİLİTLENMİŞ KAPSAMA scoped.
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
  L.push(pad("Repoint Signal (V1)", o.refsRepointed.signal));
  L.push("");
  L.push(pad("Conversation", `${o.conversationsBefore} → ${o.conversationsAfter}`));
  L.push(pad("Message", `${o.messagesBefore} → ${o.messagesAfter}`));
  L.push("");
  L.push("Hiçbir BENZERSİZ mesaj/olay kaybolmadı; düşen yalnız fazlalık kopyalardır.");
  L.push("");
  return L;
}

/**
 * Hata sınıflandırması — "hiçbir değişiklik yapılmadı" İDDİASI NE ZAMAN KURULABİLİR?
 *
 * · Kapı hatası (transaction HİÇ açılmadı) → kesin: değişiklik yok.
 * · Transaction İÇİNDEKİ guard hatası → PostgreSQL rollback eder → değişiklik yok.
 * · Bunların DIŞINDA (bağlantı kopması, süreç ölümü, bilinmeyen hata) → SONUÇ
 *   BELİRSİZ. Commit tam o anda gerçekleşmiş OLABİLİR. Burada "değişiklik yok"
 *   demek yalan olur ve operatörü apply'ı TEKRAR çalıştırmaya iter — asıl
 *   tehlike budur. Bu yüzden ayrı çıkış kodu (3) ve açık talimat veriliyor.
 */
export function classifyApplyFailure(
  enteredTransaction: boolean,
  err: unknown,
): { ambiguous: boolean; exitCode: number; lines: string[] } {
  const msg = err instanceof Error ? err.message : "";
  const isOurGuard = /rollback|geri alındı|APPLY_PHASE_A|DEDUPE_|DESTEKLENMEYEN|politika haritası|İÇERMİYOR|BİLİNMİYOR/i.test(msg);
  const deterministic = !enteredTransaction || isOurGuard;
  if (deterministic) {
    return {
      ambiguous: false,
      exitCode: 1,
      lines: [
        `[dedupe-apply] BAŞARISIZ — hiçbir değişiklik yapılmadı: ${msg || (err as Error)?.name || "Error"}`,
        enteredTransaction
          ? "  (transaction içi guard → PostgreSQL rollback etti)"
          : "  (kapı hatası → transaction hiç açılmadı)",
      ],
    };
  }
  return {
    ambiguous: true,
    exitCode: 3,
    lines: [
      `[dedupe-apply] BAŞARISIZ — SONUÇ BELİRSİZ: ${(err as Error)?.name ?? "Error"}`,
      "  Commit tam o anda gerçekleşmiş OLABİLİR; uygulandı da denemez, uygulanmadı da.",
      "  ⚠️ APPLY'I TEKRAR ÇALIŞTIRMA.",
      "  Önce SALT-OKUMA dry-run koş: 7 grup görünüyorsa hiçbir şey olmamış,",
      "  0 grup görünüyorsa işlem commit olmuş demektir. Kararı ona göre ver.",
    ],
  };
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
  let enteredTransaction = false;
  try {
    const expectations = resolveExpectations(process.env);
    prisma = new PrismaClient();
    const outcome = await applyConversationDedupe(prisma, {
      expectations,
      deployedSha: process.env.APPLY_PHASE_A_DEPLOYED_SHA,
      onTransactionStart: () => {
        enteredTransaction = true;
      },
    });
    console.log(formatApplyOutcome(outcome).join("\n"));
    process.exitCode = 0;
  } catch (e) {
    const verdict = classifyApplyFailure(enteredTransaction, e);
    console.error(verdict.lines.join("\n"));
    process.exitCode = verdict.exitCode;
  } finally {
    await prisma?.$disconnect();
  }
}

const invokedDirectly = /apply-conversation-dedupe\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? "");
if (invokedDirectly) void main();
