#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// DRY-RUN Conversation dedupe planlayıcı (Faz B)
//
// SALT OKUMA. Bu dosyada APPLY YOLU YOKTUR — hiçbir UPDATE/DELETE/INSERT
// üretmez, hiçbir satırı değiştirmez. Yalnız planı hesaplar ve SAYILARI basar.
// Gerçek yazma ayrı bir tur, ayrı bir onay ve TAZE bir pg_dump ister.
//
// GİRDİ GERÇEĞİ (2026-07-26 prod preflight, çıkış kodu 10): 1335 konuşma,
// 7 çakışan Hospitable grubu, hepsi TAM 2 satır, 7'sinin de
// externalConversationId AYNI, çelişki 0, 14 satır, 58 mesaj, FK'sız
// tablolarda 0 satır. Faz A (NS-43 kimlik kilidi) shipped olduğu için bu
// popülasyon KAPALI: yeni çift satır üretilemez.
//
// ─── DEĞİŞMEZ: "HİÇBİR BENZERSİZ MESAJ/OLAY KAYBOLMAZ" ─────────────────────
// "hiçbir mesaj satırı silinmez" ifadesi YANLIŞTI ve mekanik olarak İMKÂNSIZ:
// `Message @@unique([conversationId, externalId])` yüzünden, keeper'da zaten
// var olan bir externalId'yi taşımak kısıtı ihlal eder; kaybeden satırı yerinde
// bırakmak da mümkün değildir (kaybeden konuşma silinince cascade onu götürür).
// Doğru kural (Codex):
//   · externalId AYNI + TÜM anlamlı alanlar EŞİT  → tam kopya; tek canonical
//     satır (keeper'ınki) kalır, fazlalık düşürülebilir
//   · externalId AYNI + herhangi bir anlamlı alan FARKLI → **FAIL-CLOSED**
//   · externalId NULL → güvenle eşleştirilemez → **tamamı taşınır, düşürülmez**
//
// ─── ÇIKTI HİJYENİ ────────────────────────────────────────────────────────
// Yalnız kategori + sayı. Ham id, ad, gövde, URL veya kimlikten türetilmiş
// hash/etiket BASILMAZ (preflight ile aynı disiplin, aynı test).
// ---------------------------------------------------------------------------

import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

// ── Zaman aşımı kapıları (preflight ile birebir sözleşme) ──────────────────
export const DEFAULT_TIMEOUTS = { statementMs: 30_000, lockMs: 3_000, idleTxMs: 15_000 };
export const MAX_STATEMENT_TIMEOUT_MS = 120_000;
export const MAX_LOCK_TIMEOUT_MS = 15_000;
export const MAX_IDLE_TX_TIMEOUT_MS = 60_000;
/** Tek koşuda incelenecek en fazla çakışan grup. Aşılırsa RAPORLANIR. */
export const MAX_GROUPS = 500;

function readMs(env: NodeJS.ProcessEnv, key: string, fallback: number, max: number): number {
  const raw = env[key];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1_000 || n > max) {
    throw new Error(`${key} 1000..${max} aralığında tam sayı olmalı (0/sınırsız kabul edilmez)`);
  }
  return n;
}

export function resolveTimeouts(env?: NodeJS.ProcessEnv) {
  const src = env ?? process.env;
  return {
    statementMs: readMs(src, "DEDUPE_STATEMENT_TIMEOUT_MS", DEFAULT_TIMEOUTS.statementMs, MAX_STATEMENT_TIMEOUT_MS),
    lockMs: readMs(src, "DEDUPE_LOCK_TIMEOUT_MS", DEFAULT_TIMEOUTS.lockMs, MAX_LOCK_TIMEOUT_MS),
    idleTxMs: readMs(src, "DEDUPE_IDLE_TX_TIMEOUT_MS", DEFAULT_TIMEOUTS.idleTxMs, MAX_IDLE_TX_TIMEOUT_MS),
  };
}

// ---------------------------------------------------------------------------
// 1) CONVERSATION ALAN ENVANTERİ — derleme zamanı EKSİKSİZ
//
// `Record<keyof typeof Prisma.ConversationScalarFieldEnum, …>` sayesinde şemaya
// YENİ BİR KOLON eklenirse bu dosya DERLENMEZ; politika seçmeden ilerlemek
// imkânsızdır. Ayrıca runtime'da da doğrulanır (assertPolicyCoverage) —
// jeneratör/derleyici uyuşmazlığında bile sessiz geçiş olmaz.
// ---------------------------------------------------------------------------
export type ConversationMergePolicy =
  /** Satır kimliği; kaybeden satır kaldırılır, birleştirilecek bir şey yok. */
  | "row_identity"
  /** Kimlik anahtarının parçası — tanım gereği eşit; farklıysa gruplama bozuk demektir. */
  | "identity_key"
  /** Keeper'ın değeri yaşar. Fark KABUL EDİLİR ama SAYILIR (sessiz değil). */
  | "keeper_wins"
  /** En büyük (en yeni) kazanır. */
  | "max_wins"
  /** En küçük (en eski/en ihtiyatlı) kazanır. */
  | "min_wins"
  /** "Dikkat isteyen" durum kazanır (problem > new > waiting > answered > closed). */
  | "status_rank"
  /** En fazla BİR farklı non-null değer olabilir; iki farklı non-null → FAIL-CLOSED. */
  | "single_non_null"
  /** Misafir kimliği: KVKK anonimleştirme sentinel'ine gerçek ad geri YAZILMAZ. */
  | "anon_guard"
  /** Prisma'nın yönettiği damga; birleşmede anlamı yok. */
  | "system_managed";

export const CONVERSATION_FIELD_POLICY: Record<
  keyof typeof Prisma.ConversationScalarFieldEnum,
  ConversationMergePolicy
> = {
  id: "row_identity",
  propertyId: "identity_key",
  externalReservationId: "identity_key",
  // İki satır FARKLI yerel rezervasyona bağlıysa bunlar aynı konaklama değildir.
  reservationId: "single_non_null",
  // Sağlayıcı iki FARKLI thread id'si verdiyse birleştirme yasak (preflight'ın
  // "ÇELİŞKİ" kovasının plan tarafındaki karşılığı).
  externalConversationId: "single_non_null",
  // "Sorunlu" bayrağı ASLA düşmemeli — şikâyet gizlenirdi. Ters yön (closed →
  // answered) bilinçli taviz: görünürlüğü ARTIRAN yön güvenli olandır.
  status: "status_rank",
  // İnsana devir penceresi KISALMAMALI; AI host'un üstüne konuşmamalı.
  autoReplyHoldUntil: "max_wins",
  // Gelen kutusu sıralaması doğru kalsın (sessizce unutulmasın).
  lastMessageAt: "max_wins",
  // Modeli boşuna tekrar çağırmamak için tutulan damga; en yenisi doğru bilgi.
  autoReplyAttemptedAt: "max_wins",
  // İHTİYATLI YÖN: cursor ileri alınırsa import ATLANIR = mesaj kaybı.
  // Geri almak yalnız idempotent bir yeniden import demektir.
  syncCursorAt: "min_wins",
  // Thread'in gerçek doğuşu en eskisidir.
  createdAt: "min_wins",
  guestIdentifier: "anon_guard",
  // Görüntüleme/analitik alanları: risk bayrağı zaten `status` üzerinden
  // korunuyor. Fark olursa SAYILIR, sessiz geçmez.
  channel: "keeper_wins",
  priority: "keeper_wins",
  skippedReason: "keeper_wins",
  lastRiskLevel: "keeper_wins",
  lastRiskType: "keeper_wins",
  updatedAt: "system_managed",
};

// ---------------------------------------------------------------------------
// 2) MESSAGE ALAN ENVANTERİ — aynı sertlikte
// ---------------------------------------------------------------------------
export type MessageComparePolicy =
  /** Satır kimliği — doğası gereği farklı, kıyaslanmaz. */
  | "row_identity"
  /** Değiştirdiğimiz alanın ta kendisi. */
  | "reparented"
  /** ANLAMLI: eşit değilse tam-kopya DEĞİLDİR → FAIL-CLOSED. */
  | "strict";

export const MESSAGE_FIELD_POLICY: Record<
  keyof typeof Prisma.MessageScalarFieldEnum,
  MessageComparePolicy
> = {
  id: "row_identity",
  conversationId: "reparented",
  externalId: "strict",
  direction: "strict",
  senderName: "strict",
  body: "strict",
  language: "strict",
  createdAt: "strict", // sağlayıcı zamanı
  authorType: "strict",
  systemEventType: "strict",
  // AI işaretleri de ANLAMLI: `aiAssisted` doğrudan AI-kredisi metriğini besler
  // (raporlar Message.aiAssisted sayar). Yanlış kopyayı seçmek faturaya komşu
  // bir sayıyı sessizce kaydırırdı.
  aiAssisted: "strict",
  aiIntent: "strict",
  aiConfidence: "strict",
  aiSourcesJson: "strict",
  aiSuggestedReply: "strict",
};

/** Şema ↔ politika sürüklenmesine karşı RUNTIME kapısı (fail-closed). */
export function assertPolicyCoverage(): void {
  const check = (label: string, schema: string[], policy: string[]) => {
    const missing = schema.filter((f) => !policy.includes(f));
    const extra = policy.filter((f) => !schema.includes(f));
    if (missing.length || extra.length) {
      throw new Error(
        `${label} politika haritası şema ile uyuşmuyor (eksik:${missing.length} fazla:${extra.length}) — dry-run durduruldu`,
      );
    }
  };
  check("Conversation", Object.keys(Prisma.ConversationScalarFieldEnum), Object.keys(CONVERSATION_FIELD_POLICY));
  check("Message", Object.keys(Prisma.MessageScalarFieldEnum), Object.keys(MESSAGE_FIELD_POLICY));
}

/** Dikkat isteyen durum kazanır. closed → answered yönü bilinçli tavizdir. */
const STATUS_RANK: Record<string, number> = { problem: 5, new: 4, waiting: 3, answered: 2, closed: 1 };
export function statusRank(s: string): number {
  return STATUS_RANK[s] ?? 0;
}

// `anon_guard` (guestIdentifier) bir APPLY yükümlülüğüdür, dry-run ölçümü değil:
// birleştirme kaybedenden ad OKUMAZ (keeper'ın değeri yaşar), dolayısıyla
// KVKK diriltmesi zaten yapısal olarak imkânsızdır. Burada sentinel listesi
// TUTULMUYOR — bilinçli: `ANON_ID` ("Misafir") aynı zamanda "adı henüz
// çözülmedi" placeholder'ıdır (hospitable-sync guestName fallback'i), yani
// sentinel'e bakan bir sayaç BELİRSİZ rakam üretirdi. Apply turunda kural
// `data-retention.ts`'teki gerçek sabitlerle uygulanacak.

type ConversationRow = Record<string, unknown> & { id: string };
type MessageRow = Record<string, unknown> & { id: string; conversationId: string };

function sameScalar(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null && b === null) return true;
  return a === b;
}

/** Deterministik keeper: beraberlik YAPISAL olarak imkânsız (son ölçüt id). */
export function pickKeeper(rows: ConversationRow[], messageCount: Map<string, number>): ConversationRow {
  return [...rows].sort((x, y) => {
    const xr = x.reservationId ? 1 : 0;
    const yr = y.reservationId ? 1 : 0;
    if (xr !== yr) return yr - xr; // konaklama bağı olan önce
    const xm = messageCount.get(x.id) ?? 0;
    const ym = messageCount.get(y.id) ?? 0;
    if (xm !== ym) return ym - xm; // çok mesajlı önce
    const xc = (x.createdAt as Date).getTime();
    const yc = (y.createdAt as Date).getTime();
    if (xc !== yc) return xc - yc; // eski önce
    return x.id < y.id ? -1 : 1; // son çare — beraberlik imkânsız
  })[0];
}

export type FailReason =
  | "conversation_field_conflict"
  | "reservation_id_conflict"
  | "external_conversation_id_conflict"
  | "message_content_conflict";

export interface DedupeReport {
  ctx: {
    db: string;
    in_recovery: boolean;
    read_only: string;
    isolation: string;
    statement_timeout: string;
    lock_timeout: string;
    idle_tx_timeout: string;
  };
  groups: {
    conflicting: number;
    planned: number;
    fail_closed: number;
    capped: boolean;
    fail_reasons: Record<FailReason, number>;
    /** `keeper_wins` politikalı bir alanın farklı çıktığı grup sayısı (sessiz değil). */
    keeper_wins_differences: number;
  };
  conversations: { affected: number; keepers: number; losers_planned: number };
  messages: {
    in_conflict_groups: number;
    planned_move_unique: number;
    planned_move_null_external: number;
    planned_drop_exact_duplicate: number;
    conflicting_blocking: number;
  };
  relations: { message_outbox_repoint: number; risk_event_repoint: number; shadow_verdict_repoint: number };
  totals: {
    conversations_before: number;
    conversations_after_expected: number;
    messages_before: number;
    messages_after_expected: number;
  };
}

/**
 * Planı hesaplar. TEK `REPEATABLE READ` + `READ ONLY` transaction:
 * yazma DB tarafından reddedilir (niyet değil, zorlama) ve tüm sayımlar tek
 * snapshot'tan gelir, dolayısıyla birbiriyle çelişemez.
 */
export async function planConversationDedupe(
  prisma: PrismaClient,
  opts: { timeouts?: ReturnType<typeof resolveTimeouts>; allowPrimary?: boolean; maxGroups?: number } = {},
): Promise<DedupeReport> {
  assertPolicyCoverage();
  const timeouts = opts.timeouts ?? resolveTimeouts();
  const allowPrimary = opts.allowPrimary ?? false;
  const maxGroups = opts.maxGroups ?? MAX_GROUPS;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${timeouts.statementMs}`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${timeouts.lockMs}`);
      await tx.$executeRawUnsafe(`SET LOCAL idle_in_transaction_session_timeout = ${timeouts.idleTxMs}`);

      const ctx = (
        await tx.$queryRaw<DedupeReport["ctx"][]>`
          SELECT current_database()::text AS db,
                 pg_is_in_recovery() AS in_recovery,
                 current_setting('transaction_read_only')::text AS read_only,
                 current_setting('transaction_isolation')::text AS isolation,
                 current_setting('statement_timeout')::text AS statement_timeout,
                 current_setting('lock_timeout')::text AS lock_timeout,
                 current_setting('idle_in_transaction_session_timeout')::text AS idle_tx_timeout
        `
      )[0];
      if (ctx.read_only !== "on") throw new Error("READ ONLY uygulanmadı — plan hesaplanmadı");
      if (!ctx.in_recovery && !allowPrimary) {
        throw new Error("PRIMARY veritabanı. Bilerek koşacaksan DEDUPE_ALLOW_PRIMARY=1 ver");
      }

      const conflictKeys = await tx.$queryRaw<{ propertyId: string; externalReservationId: string }[]>`
        SELECT "propertyId", "externalReservationId"
        FROM "Conversation"
        WHERE "externalReservationId" IS NOT NULL
        GROUP BY "propertyId", "externalReservationId"
        HAVING COUNT(*) > 1
        ORDER BY "propertyId", "externalReservationId"
        LIMIT ${maxGroups + 1}
      `;
      const capped = conflictKeys.length > maxGroups;
      const keys = capped ? conflictKeys.slice(0, maxGroups) : conflictKeys;

      const report: DedupeReport = {
        ctx,
        groups: {
          conflicting: keys.length,
          planned: 0,
          fail_closed: 0,
          capped,
          fail_reasons: {
            conversation_field_conflict: 0,
            reservation_id_conflict: 0,
            external_conversation_id_conflict: 0,
            message_content_conflict: 0,
          },
          keeper_wins_differences: 0,
        },
        conversations: { affected: 0, keepers: 0, losers_planned: 0 },
        messages: {
          in_conflict_groups: 0,
          planned_move_unique: 0,
          planned_move_null_external: 0,
          planned_drop_exact_duplicate: 0,
          conflicting_blocking: 0,
        },
        relations: { message_outbox_repoint: 0, risk_event_repoint: 0, shadow_verdict_repoint: 0 },
        totals: {
          conversations_before: await tx.conversation.count(),
          conversations_after_expected: 0,
          messages_before: await tx.message.count(),
          messages_after_expected: 0,
        },
      };

      let plannedLosers = 0;
      let plannedDrops = 0;

      for (const key of keys) {
        const rows = (await tx.conversation.findMany({
          where: { propertyId: key.propertyId, externalReservationId: key.externalReservationId },
        })) as unknown as ConversationRow[];
        report.conversations.affected += rows.length;

        const msgs = (await tx.message.findMany({
          where: { conversationId: { in: rows.map((r) => r.id) } },
        })) as unknown as MessageRow[];
        report.messages.in_conflict_groups += msgs.length;

        const perConv = new Map<string, number>();
        for (const m of msgs) perConv.set(m.conversationId, (perConv.get(m.conversationId) ?? 0) + 1);

        const keeper = pickKeeper(rows, perConv);
        const losers = rows.filter((r) => r.id !== keeper.id);

        // ── Konuşma alanları: politikası olmayan/çelişen alan → FAIL-CLOSED ──
        let failed: FailReason | null = null;
        let keeperWinsDiff = false;
        for (const [field, policy] of Object.entries(CONVERSATION_FIELD_POLICY)) {
          const values = rows.map((r) => r[field]);
          const allSame = values.every((v) => sameScalar(v, values[0]));
          if (allSame) continue;
          switch (policy) {
            case "identity_key":
              failed ??= "conversation_field_conflict"; // gruplama bozuk — imkânsız olmalı
              break;
            case "single_non_null": {
              const nonNull = values.filter((v) => v !== null && v !== undefined);
              const distinct = new Set(nonNull.map((v) => String(v)));
              if (distinct.size > 1) {
                failed ??=
                  field === "reservationId" ? "reservation_id_conflict" : "external_conversation_id_conflict";
              }
              break;
            }
            case "keeper_wins":
              keeperWinsDiff = true;
              break;
            case "anon_guard":
            case "status_rank":
            case "max_wins":
            case "min_wins":
            case "row_identity":
            case "system_managed":
              break; // açık politikası var; fark beklenen
          }
        }
        if (keeperWinsDiff) report.groups.keeper_wins_differences++;

        // ── Mesaj sınıflandırması ────────────────────────────────────────────
        const keeperByExt = new Map<string, MessageRow>();
        for (const m of msgs) {
          if (m.conversationId === keeper.id && m.externalId != null) {
            keeperByExt.set(String(m.externalId), m);
          }
        }
        let moveUnique = 0;
        let moveNull = 0;
        let dropExact = 0;
        let conflicting = 0;
        for (const m of msgs) {
          if (m.conversationId === keeper.id) continue;
          if (m.externalId == null) {
            moveNull++; // güvenle eşleştirilemez → TAŞINIR, asla düşürülmez
            continue;
          }
          const twin = keeperByExt.get(String(m.externalId));
          if (!twin) {
            moveUnique++;
            continue;
          }
          const strictEqual = Object.entries(MESSAGE_FIELD_POLICY)
            .filter(([, p]) => p === "strict")
            .every(([f]) => sameScalar(m[f], twin[f]));
          if (strictEqual) dropExact++;
          else conflicting++;
        }
        report.messages.conflicting_blocking += conflicting;
        if (conflicting > 0) failed ??= "message_content_conflict";

        if (failed) {
          report.groups.fail_closed++;
          report.groups.fail_reasons[failed]++;
          continue; // plan üretilmez; bu gruba APPLY de dokunmayacak
        }

        report.groups.planned++;
        report.conversations.keepers++;
        plannedLosers += losers.length;
        report.messages.planned_move_unique += moveUnique;
        report.messages.planned_move_null_external += moveNull;
        plannedDrops += dropExact;

        const loserIds = losers.map((l) => l.id);
        report.relations.message_outbox_repoint += await tx.messageOutbox.count({
          where: { conversationId: { in: loserIds } },
        });
        report.relations.risk_event_repoint += await tx.riskEvent.count({
          where: { conversationId: { in: loserIds } },
        });
        report.relations.shadow_verdict_repoint += await tx.shadowVerdict.count({
          where: { conversationId: { in: loserIds } },
        });
      }

      report.conversations.losers_planned = plannedLosers;
      report.messages.planned_drop_exact_duplicate = plannedDrops;
      report.totals.conversations_after_expected = report.totals.conversations_before - plannedLosers;
      report.totals.messages_after_expected = report.totals.messages_before - plannedDrops;
      return report;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: Math.max(60_000, timeouts.statementMs * 6),
      maxWait: 10_000,
    },
  );
}

/** Saf biçimlendirici — YALNIZ kategori + sayı. Kimlik/PII içermez. */
export function formatDedupeReport(r: DedupeReport): string[] {
  const pad = (l: string, v: unknown) => `${l.padEnd(54)} ${v}`;
  const L: string[] = [];
  L.push("");
  L.push("=== Conversation dedupe DRY-RUN (SALT OKUMA — APPLY YOK) ===");
  L.push("");
  L.push(pad("veritabanı", r.ctx.db));
  L.push(pad("rol", r.ctx.in_recovery ? "replica (in recovery)" : "PRIMARY"));
  L.push(pad("erişim modu / izolasyon", `${r.ctx.read_only} / ${r.ctx.isolation}`));
  L.push(
    pad("statement / lock / idle-tx", `${r.ctx.statement_timeout} / ${r.ctx.lock_timeout} / ${r.ctx.idle_tx_timeout}`),
  );
  L.push("");
  L.push("--- Gruplar ---");
  L.push(pad("Çakışan grup", r.groups.conflicting));
  L.push(pad("  planlanan (birleştirilebilir)", r.groups.planned));
  L.push(pad("  FAIL-CLOSED (dokunulmayacak)", r.groups.fail_closed));
  L.push(pad("    · konuşma alanı çelişkisi", r.groups.fail_reasons.conversation_field_conflict));
  L.push(pad("    · farklı yerel reservationId", r.groups.fail_reasons.reservation_id_conflict));
  L.push(pad("    · farklı externalConversationId", r.groups.fail_reasons.external_conversation_id_conflict));
  L.push(pad("    · mesaj içerik çelişkisi", r.groups.fail_reasons.message_content_conflict));
  L.push(pad("  keeper_wins alanı farklı çıkan grup", r.groups.keeper_wins_differences));
  if (r.groups.capped) L.push(`  ⚠ GRUP TAVANI (${MAX_GROUPS}) AŞILDI — bu koşu tamamı kapsamıyor.`);
  L.push("");
  L.push("--- Konuşmalar ---");
  L.push(pad("Etkilenen satır", r.conversations.affected));
  L.push(pad("  keeper", r.conversations.keepers));
  L.push(pad("  kaybeden (planlanan gruplarda)", r.conversations.losers_planned));
  L.push("");
  L.push("--- Mesajlar ---");
  L.push(pad("Çakışan gruplardaki toplam", r.messages.in_conflict_groups));
  L.push(pad("  taşınacak BENZERSİZ", r.messages.planned_move_unique));
  L.push(pad("  taşınacak externalId NULL (asla düşmez)", r.messages.planned_move_null_external));
  L.push(pad("  tam eşit duplicate (tek canonical kalır)", r.messages.planned_drop_exact_duplicate));
  L.push(pad("  ÇELİŞKİLİ (grubu fail-closed yapan)", r.messages.conflicting_blocking));
  L.push("");
  L.push("--- İlişkili modellerde taşınacak referans ---");
  L.push(pad("MessageOutbox (FK YOK)", r.relations.message_outbox_repoint));
  L.push(pad("RiskEvent (FK YOK)", r.relations.risk_event_repoint));
  L.push(pad("ShadowVerdict (FK YOK)", r.relations.shadow_verdict_repoint));
  L.push("");
  L.push("--- Birleşme öncesi / beklenen sonrası ---");
  L.push(pad("Conversation", `${r.totals.conversations_before} → ${r.totals.conversations_after_expected}`));
  L.push(pad("Message", `${r.totals.messages_before} → ${r.totals.messages_after_expected}`));
  L.push("");
  L.push("DEĞİŞMEZ: hiçbir BENZERSİZ mesaj/olay kaybolmaz. Düşen tek şey, aynı");
  L.push("sağlayıcı olayının TÜM anlamlı alanları eşit olan fazlalık kopyasıdır.");
  L.push("externalId NULL mesajlar güvenle eşleştirilemediği için hep taşınır.");
  L.push("");
  L.push("BU BİR PLANDIR. Hiçbir satır değiştirilmedi. Apply ayrı tur + ayrı onay");
  L.push("+ TAZE pg_dump ister; apply yolu bu dosyada YOKTUR.");
  L.push("");
  return L;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[dedupe-dryrun] DATABASE_URL yok — bağlanılmadı.");
    process.exitCode = 1;
    return;
  }
  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient();
    const report = await planConversationDedupe(prisma, {
      allowPrimary: process.env.DEDUPE_ALLOW_PRIMARY === "1",
    });
    console.log(formatDedupeReport(report).join("\n"));
    process.exitCode = report.groups.fail_closed > 0 ? 20 : report.groups.planned > 0 ? 10 : 0;
  } catch (e) {
    const known = e instanceof Error && /READ ONLY|PRIMARY|DEDUPE_|politika haritası/.test(e.message);
    console.error(`[dedupe-dryrun] başarısız: ${known ? e.message : ((e as Error)?.name ?? "Error")}`);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
