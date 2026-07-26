#!/usr/bin/env node
// ---------------------------------------------------------------------------
// SALT-OKUMA PREFLIGHT — Conversation @@unique([propertyId, externalReservationId])
//
// Codex'in şartı: unique migration'dan ÖNCE gerçeği ölç. Bu script HİÇBİR ŞEY
// YAZMAZ, HİÇBİR SATIR SİLMEZ ve HAM MİSAFİR/KİMLİK VERİSİ BASMAZ.
//
// ⚠️ BU SCRIPT'İ ÇALIŞTIRMAK BAŞLI BAŞINA BİR OPERASYONDUR. Salt-okuma olması
//    "zararsız" demek DEĞİLDİR: uzun süren bir SELECT tablo üzerinde ACCESS
//    SHARE tutar, boot'taki `prisma migrate deploy`in ALTER TABLE'ı ACCESS
//    EXCLUSIVE beklerken kuyruğa girer ve ARDINDAKİ TÜM sorgular o ALTER'ın
//    arkasında bloklanır — salt-okuma bir script üretim kesintisi üretebilir.
//    Aşağıdaki üç zaman aşımı (statement/lock/idle-tx) tam olarak bunun içindir.
//
// ─── NE SORUYORUZ ──────────────────────────────────────────────────────────
//   Aynı (propertyId, externalReservationId) üzerindeki birden fazla konuşma
//   YARIŞ ARTIĞI mı, yoksa sağlayıcının GERÇEKTEN ayrı thread'leri mi?
//
// AYIRT EDİCİ ÖLÇÜT: grup içindeki `externalConversationId` değerleri.
//   · hepsi AYNI                 → kesin yarış artığı; dedupe + unique doğru yol
//   · karışık (bir kısmı NULL)   → belirsiz; dedupe ELDE, gözetimli yapılmalı
//   · hepsi NULL                 → sağlayıcı kanıtı YOK; dedupe gözetimli
//   · GERÇEKTEN FARKLI           → sağlayıcı iki thread vermiş ⇒ BU UNIQUE YANLIŞ
//                                  (karar 1'den karar 2'ye döner)
//
// ─── SINIFLANDIRMA ŞART (yoksa yanlış cevap verir) ─────────────────────────
// `externalReservationId` kolonu AŞIRI YÜKLÜ, üç ayrı üretici yazar:
//   1. sync      → Hospitable rezervasyon UUID'si   (hospitable-sync.ts:693)
//   2. QR        → "qr-chat:{propertyId}:{reservationId}" (chat/[token]:139,165)
//   3. manuel    → hiç yazılmaz = NULL              (api/conversations:53)
// (iCal HİÇ konuşma yaratmaz — yalnız Reservation.)
// QR satırlarını Hospitable çakışmasıyla aynı kovaya atmak KARARI BOZAR: QR
// markerları tasarım gereği tekrar eder ve `externalConversationId` taşımaz,
// yani "sağlayıcı kanıtı yok" görünürler. Bu yüzden AYRI sayılırlar.
//
// ⚠️ LEGACY QR RİSKİ: deterministik `qrconv_{reservationId}` id'sinden ÖNCEKİ
//    rastgele-id'li QR satırları aynı marker'ı paylaşıyor olabilir. Aynı
//    rezervasyon için iki legacy QR satırı varsa unique migration PATLAR —
//    Hospitable ile hiç ilgisi olmayan bir sebepten. Ayrıca ölçülür.
//
// ─── POSTGRESQL NULL SEMANTİĞİ (dokunma) ───────────────────────────────────
// `(propertyId, NULL)` çiftleri UNIQUE altında sınırsız tekrar edebilir →
// manuel konuşmalar kısıtlanmaz, İSTENEN budur. `NULLS NOT DISTINCT` (PG15+)
// KULLANILMAMALI: mülk başına tek manuel konuşmaya iner, ürünü kırar.
//
// ─── KOD-DOĞRULAMASI (script çalışmadan önce yapıldı) ──────────────────────
//   1. `importThread` mevcut thread'i `findFirst({ propertyId,
//      externalReservationId })` ile arar (hospitable-sync.ts:641) — kod ZATEN
//      "rezervasyon başına tek konuşma"yı invariant kabul ediyor. Skip-check
//      yolu da aynı anahtarı kullanır (hospitable-sync.ts:298).
//   2. Hospitable payload'ında `conversation_id` TEKİLDİR, dizi değil
//      (hospitable.ts:241).
//   3. EN GÜÇLÜSÜ: çağırdığımız uçlar `GET /reservations` ve
//      `GET|POST /reservations/{uuid}/messages` (hospitable.ts:270,279,316) —
//      `/conversations` diye bir uç YOK, thread seçici YOK.
//   4. ÇELİŞKİLİ TEK SİNYAL: `chat/[token]/route.ts:147-149` yorumu "aynı
//      rezervasyonun birden çok gerçek thread'i meşru" diyor — KAYNAKSIZ ve
//      *tablo-geneli tek-kolon* unique'ten bahsediyor, önerilen BİLEŞİK
//      kısıttan değil. Doğruysa `importThread` bugün ZATEN bozuktur.
//   5. `externalConversationId` YALNIZ create'te yazılır (hospitable-sync.ts:694)
//      ve UPDATE dalında HİÇ tazelenmez. Yani her satırın değeri O SATIR
//      YARATILDIĞI ANDAKİ değerdir — "sağlayıcı bize iki farklı thread id'si
//      verdi mi" sorusu için doğru kanıt, ama GÜNCEL diye okunamaz.
//      ⚠️ Bu, "partial unique'i externalConversationId üzerine kur"
//      alternatifini DOĞRUDAN ETKİLER: hiç tazelenmeyen + QR/manuel satırlarda
//      NULL olan bir kolon üzerine unique kurmak güvenli değildir.
//
// ─── KULLANIM ──────────────────────────────────────────────────────────────
//   1. ÖNCE prod yedeği (pg_dump) al.
//   2. Tercihen read-replica ya da snapshot'a bağlan. Primary'ye bağlanmak
//      BİLİNÇLİ bir eylem olsun diye ayrıca onay ister:
//
//   DATABASE_URL=... PREFLIGHT_ALLOW_PRIMARY=1 \
//     node scripts/preflight-conversation-dupes.mjs
//
//   İsteğe bağlı (üst sınır MAX_STATEMENT_TIMEOUT_MS ile kapalı):
//     PREFLIGHT_STATEMENT_TIMEOUT_MS, PREFLIGHT_LOCK_TIMEOUT_MS,
//     PREFLIGHT_IDLE_TX_TIMEOUT_MS
//
// ─── ÇIKIŞ KODLARI ─────────────────────────────────────────────────────────
//    0  çakışma YOK — unique bu veriyle sorunsuz uygulanır
//   10  çakışma VAR ama çelişkili conversation id YOK — gözetimli dedupe gerekir
//   20  DUR: en az bir grupta GERÇEKTEN farklı conversation id → karar 2'ye döner
//    1  hata / güvenlik kapısı reddi
// ---------------------------------------------------------------------------

import { pathToFileURL } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";

/** QR markerının değişmez öneki — `ensureGuestChatConversation` ile birebir. */
export const QR_PREFIX = "qr-chat:";
const QR_LIKE = `${QR_PREFIX}%`;

/** Örnek listesi sert tavanı: rapor asla sınırsız satır basmaz. */
export const SAMPLE_LIMIT = 50;

/**
 * Zaman aşımı tavanları. `0` = sınırsız olduğu için ASLA kabul edilmez;
 * sınırsız statement_timeout tam da kaçınmak istediğimiz kilit-kuyruğu
 * senaryosunu geri getirir.
 */
export const DEFAULT_TIMEOUTS = { statementMs: 30_000, lockMs: 3_000, idleTxMs: 15_000 };
export const MAX_STATEMENT_TIMEOUT_MS = 120_000;
export const MAX_LOCK_TIMEOUT_MS = 15_000;
export const MAX_IDLE_TX_TIMEOUT_MS = 60_000;

function readMs(env, key, fallback, max) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1_000 || n > max) {
    throw new Error(`${key} 1000..${max} aralığında tam sayı olmalı (0/sınırsız kabul edilmez)`);
  }
  return n;
}

/** Saf: env → doğrulanmış zaman aşımları. Geçersiz değerde fail-closed. */
export function resolveTimeouts(env) {
  const src = env ?? process.env;
  return {
    statementMs: readMs(src, "PREFLIGHT_STATEMENT_TIMEOUT_MS", DEFAULT_TIMEOUTS.statementMs, MAX_STATEMENT_TIMEOUT_MS),
    lockMs: readMs(src, "PREFLIGHT_LOCK_TIMEOUT_MS", DEFAULT_TIMEOUTS.lockMs, MAX_LOCK_TIMEOUT_MS),
    idleTxMs: readMs(src, "PREFLIGHT_IDLE_TX_TIMEOUT_MS", DEFAULT_TIMEOUTS.idleTxMs, MAX_IDLE_TX_TIMEOUT_MS),
  };
}

/**
 * Tek REPEATABLE READ + READ ONLY transaction içinde ölçer.
 *
 * READ ONLY neden ŞART: "yalnız SELECT yazdım" bir NİYET beyanıdır, garanti
 * değil. `SET TRANSACTION READ ONLY` garantiyi VERİTABANINA yaptırır — bir
 * yazım denemesi sunucu tarafından reddedilir. Ayrıca ayarın gerçekten
 * uygulandığı `current_setting` ile DOĞRULANIR; uygulanmadıysa hiç ölçüm
 * yapmadan durur.
 *
 * REPEATABLE READ neden: aynı GROUP BY iki kez (toplam + örnek) çalışıyor.
 * READ COMMITTED'da her ifade taze snapshot görür → eşzamanlı yazımlarda iki
 * çıktı birbiriyle çelişebilir. Tek snapshot bunu yapısal olarak imkânsız kılar.
 */
export async function collectPreflight(prisma, opts = {}) {
  const timeouts = opts.timeouts ?? resolveTimeouts();
  const allowPrimary = opts.allowPrimary ?? false;
  const sampleLimit = opts.sampleLimit ?? SAMPLE_LIMIT;

  return prisma.$transaction(
    async (tx) => {
      // ── Kapılar: HERHANGİ bir veri sorgusundan ÖNCE ────────────────────────
      // (PostgreSQL erişim modunun transaction'ın ilk sorgusundan önce
      //  ayarlanmasını ister.)
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${timeouts.statementMs}`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${timeouts.lockMs}`);
      await tx.$executeRawUnsafe(
        `SET LOCAL idle_in_transaction_session_timeout = ${timeouts.idleTxMs}`,
      );

      const ctx = (
        await tx.$queryRaw`
          SELECT current_database()::text                              AS db,
                 pg_is_in_recovery()                                   AS in_recovery,
                 current_setting('transaction_read_only')::text        AS read_only,
                 current_setting('transaction_isolation')::text        AS isolation,
                 current_setting('statement_timeout')::text            AS statement_timeout,
                 current_setting('lock_timeout')::text                 AS lock_timeout,
                 current_setting('idle_in_transaction_session_timeout')::text AS idle_tx_timeout
        `
      )[0];

      // Niyet değil, KANIT: sunucu gerçekten salt-okuma modunda mı?
      if (ctx.read_only !== "on") {
        throw new Error("READ ONLY uygulanmadı — ölçüm yapılmadan durduruldu");
      }
      // Primary'ye bağlanmak bilinçli bir eylem olmalı (tercih: replica/snapshot).
      if (!ctx.in_recovery && !allowPrimary) {
        throw new Error(
          "PRIMARY veritabanı. Tercih replica/snapshot; bilerek primary'de koşacaksan PREFLIGHT_ALLOW_PRIMARY=1 ver",
        );
      }

      // ── 1) Sınıf bazında toplamlar (tek geçiş, ucuz) ──────────────────────
      const totals = (
        await tx.$queryRaw`
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE "externalReservationId" IS NULL)::int AS manual_null,
                 COUNT(*) FILTER (WHERE "externalReservationId" LIKE ${QR_LIKE})::int AS qr,
                 COUNT(*) FILTER (
                   WHERE "externalReservationId" IS NOT NULL
                     AND "externalReservationId" NOT LIKE ${QR_LIKE}
                 )::int AS hospitable
          FROM "Conversation"
        `
      )[0];

      // ── 2) Çakışan gruplar — TAM sayılar, JS'e sınırsız satır çekilmeden ───
      // Sınıflandırma kovaları (Hospitable):
      //   conflicting = birden fazla FARKLI conversation id  → unique YANLIŞ olur
      //   mixed       = bir değer + en az bir NULL           → belirsiz, gözetimli
      //   all_null    = hiç conversation id yok              → kanıt yok, gözetimli
      //   same        = hepsi aynı değer                     → kesin yarış artığı
      const groups = (
        await tx.$queryRaw`
          WITH g AS (
            SELECT ("externalReservationId" LIKE ${QR_LIKE}) AS is_qr,
                   COUNT(*)::int AS n_rows,
                   COUNT(DISTINCT "externalConversationId")::int AS distinct_conv,
                   COUNT(*) FILTER (WHERE "externalConversationId" IS NULL)::int AS null_conv
            FROM "Conversation"
            WHERE "externalReservationId" IS NOT NULL
            GROUP BY "propertyId", "externalReservationId"
            HAVING COUNT(*) > 1
          )
          SELECT
            COUNT(*) FILTER (WHERE NOT is_qr)::int AS hosp_groups,
            COUNT(*) FILTER (WHERE NOT is_qr AND distinct_conv > 1)::int AS hosp_conflicting,
            COUNT(*) FILTER (WHERE NOT is_qr AND distinct_conv = 1 AND null_conv > 0)::int AS hosp_mixed,
            COUNT(*) FILTER (WHERE NOT is_qr AND distinct_conv = 1 AND null_conv = 0)::int AS hosp_same,
            COUNT(*) FILTER (WHERE NOT is_qr AND distinct_conv = 0)::int AS hosp_all_null,
            COUNT(*) FILTER (WHERE is_qr)::int AS qr_groups,
            COALESCE(SUM(n_rows) FILTER (WHERE NOT is_qr), 0)::int AS hosp_rows,
            COALESCE(SUM(n_rows) FILTER (WHERE is_qr), 0)::int AS qr_rows,
            COALESCE(MAX(n_rows), 0)::int AS max_group_rows
          FROM g
        `
      )[0];

      const conflictGroups = groups.hosp_groups + groups.qr_groups;

      // ── 3) SINIRLI örnek — ham kimlik YERİNE geri-döndürülemez etiket ──────
      // Etiket md5(propertyId:externalReservationId)'in ilk 8 hanesi: preflight
      // çıktısıyla ileriki DRY-RUN dedupe çıktısını, hiçbir kimlik basmadan
      // satır satır eşleştirmeye yarar. LIMIT sert; rapor asla şişmez.
      const sample = conflictGroups
        ? await tx.$queryRaw`
            WITH g AS (
              SELECT "propertyId" AS pid,
                     "externalReservationId" AS ext,
                     ("externalReservationId" LIKE ${QR_LIKE}) AS is_qr,
                     COUNT(*)::int AS n_rows,
                     COUNT(DISTINCT "externalConversationId")::int AS distinct_conv,
                     COUNT(*) FILTER (WHERE "externalConversationId" IS NULL)::int AS null_conv
              FROM "Conversation"
              WHERE "externalReservationId" IS NOT NULL
              GROUP BY "propertyId", "externalReservationId"
              HAVING COUNT(*) > 1
            )
            SELECT substr(md5(pid || ':' || ext), 1, 8) AS label,
                   is_qr, n_rows, distinct_conv, null_conv
            FROM g
            ORDER BY (distinct_conv > 1) DESC, n_rows DESC, label ASC
            LIMIT ${sampleLimit}
          `
        : [];

      // ── 4) Bağlı kayıt hacmi — dedupe planı için (içerik YOK, yalnız sayı) ─
      // RiskEvent / ShadowVerdict / MessageOutbox'ta conversationId üzerinde FK
      // YOK: bir konuşma silinirse bu satırlar DANGLING kalır. MessageOutbox
      // için bu belgeli bir taviz DEĞİL (kuyruktaki gönderim yok olan konuşmayı
      // gösterir) → dedupe planı bunu ele almak ZORUNDA. Hacmi burada ölçülür.
      // NOT: MessageOutbox/RiskEvent/ShadowVerdict.conversationId indeksli
      // değildir; bu join seq scan olabilir — statement_timeout sınırlar.
      const impact = conflictGroups
        ? (
            await tx.$queryRaw`
              WITH dupes AS (
                SELECT "propertyId" AS pid, "externalReservationId" AS ext
                FROM "Conversation"
                WHERE "externalReservationId" IS NOT NULL
                GROUP BY 1, 2
                HAVING COUNT(*) > 1
              ), affected AS (
                SELECT c.id AS id, (c."externalReservationId" LIKE ${QR_LIKE}) AS is_qr
                FROM "Conversation" c
                JOIN dupes d ON d.pid = c."propertyId" AND d.ext = c."externalReservationId"
              )
              SELECT
                (SELECT COUNT(*)::int FROM affected) AS conversations,
                (SELECT COUNT(*)::int FROM affected WHERE is_qr) AS qr_conversations,
                (SELECT COUNT(*)::int FROM "Message" m JOIN affected a ON a.id = m."conversationId") AS messages,
                (SELECT COUNT(*)::int FROM "MessageOutbox" o JOIN affected a ON a.id = o."conversationId") AS outbox,
                (SELECT COUNT(*)::int FROM "RiskEvent" r JOIN affected a ON a.id = r."conversationId") AS risk_events,
                (SELECT COUNT(*)::int FROM "ShadowVerdict" s JOIN affected a ON a.id = s."conversationId") AS shadow_verdicts
            `
          )[0]
        : { conversations: 0, qr_conversations: 0, messages: 0, outbox: 0, risk_events: 0, shadow_verdicts: 0 };

      // ── 5) Legacy QR satırları — migration'ı Hospitable'dan bağımsız patlatır ─
      const qr = (
        await tx.$queryRaw`
          SELECT COUNT(*)::int AS qr_total,
                 COUNT(*) FILTER (
                   WHERE "reservationId" IS NULL OR id <> ('qrconv_' || "reservationId")
                 )::int AS qr_legacy
          FROM "Conversation"
          WHERE "externalReservationId" LIKE ${QR_LIKE}
        `
      )[0];

      return { ctx, totals, groups, sample, impact, qr, timeouts, sampleLimit };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      // Her ifadeyi statement_timeout sınırlar; bu, tüm transaction için
      // istemci tarafı üst sınırdır (5 ölçüm sorgusu × pay).
      timeout: Math.max(60_000, timeouts.statementMs * 6),
      maxWait: 10_000,
    },
  );
}

/** Saf karar fonksiyonu — DB'siz test edilebilir. */
export function decide(stats) {
  const { groups, qr } = stats;
  const conflictGroups = groups.hosp_groups + groups.qr_groups;
  if (groups.hosp_conflicting > 0) {
    return { code: "CELISKI", exitCode: 20 };
  }
  if (conflictGroups > 0 || qr.qr_legacy > 0) {
    return { code: "DEDUPE_GEREKLI", exitCode: 10 };
  }
  return { code: "TEMIZ", exitCode: 0 };
}

/** Saf biçimlendirici — hiçbir ham kimlik/PII içermez. */
export function formatReport(stats, decision) {
  // Zaman aşımı değerleri rapora NİYETTEN değil, sunucunun kendi
  // `current_setting` cevabından (ctx) basılır — gerçekten uygulandığı görünsün.
  const { ctx, totals, groups, sample, impact, qr, sampleLimit } = stats;
  const pad = (label, value) => `${String(label).padEnd(52)} ${value}`;
  const L = [];

  L.push("");
  L.push("=== Conversation duplicate preflight (SALT OKUMA) ===");
  L.push("");
  L.push(pad("veritabanı", ctx.db));
  L.push(pad("rol", ctx.in_recovery ? "replica (in recovery)" : "PRIMARY"));
  L.push(pad("erişim modu / izolasyon", `${ctx.read_only} / ${ctx.isolation}`));
  L.push(
    pad(
      "statement / lock / idle-tx timeout",
      `${ctx.statement_timeout} / ${ctx.lock_timeout} / ${ctx.idle_tx_timeout}`,
    ),
  );
  L.push("");

  L.push("--- Satır sınıfları ---");
  L.push(pad("Toplam konuşma", totals.total));
  L.push(pad("  manuel (externalReservationId NULL)", totals.manual_null));
  L.push(pad("  QR (qr-chat: marker)", totals.qr));
  L.push(pad("  Hospitable (rezervasyon UUID)", totals.hospitable));
  L.push(pad("  · bunlardan legacy QR (qrconv_ dışı id)", qr.qr_legacy));
  L.push("");
  L.push("NOT: manuel satırlar kısıtlamayı İLGİLENDİRMEZ — PostgreSQL'de NULL'lar");
  L.push("     distinct sayılır. `NULLS NOT DISTINCT` KULLANILMAMALI (mülk başına");
  L.push("     tek manuel konuşmaya iner, ürünü kırar).");
  L.push("");

  L.push("--- Çakışan gruplar (aynı propertyId + aynı externalReservationId) ---");
  L.push(pad("Hospitable grup", groups.hosp_groups));
  L.push(pad("  · hepsi AYNI conversation id (yarış artığı)", groups.hosp_same));
  L.push(pad("  · karışık (değer + NULL) → belirsiz", groups.hosp_mixed));
  L.push(pad("  · hepsi NULL → sağlayıcı kanıtı yok", groups.hosp_all_null));
  L.push(pad("  · FARKLI conversation id → ÇELİŞKİ", groups.hosp_conflicting));
  L.push(pad("QR grup (legacy çift satır)", groups.qr_groups));
  L.push(pad("En kalabalık gruptaki satır sayısı", groups.max_group_rows));
  L.push("");

  if (sample.length) {
    L.push(`--- Örnek gruplar (en fazla ${sampleLimit}; etiket = md5 ilk 8, kimlik DEĞİL) ---`);
    for (const g of sample) {
      const kind = g.is_qr ? "QR  " : "HOSP";
      const verdict = g.distinct_conv > 1 ? "ÇELİŞKİ" : g.distinct_conv === 0 ? "kanıt-yok" : g.null_conv > 0 ? "karışık" : "aynı";
      L.push(
        `  ${g.label}  ${kind}  satır=${g.n_rows}  farklı-conv=${g.distinct_conv}  null-conv=${g.null_conv}  → ${verdict}`,
      );
    }
    if (sample.length === sampleLimit) {
      L.push(`  … LİSTE ${sampleLimit} SATIRDA KIRPILDI (yukarıdaki sayılar TAM).`);
    }
    L.push("");
  }

  L.push("--- Dedupe'un taşıyacağı bağlı kayıt hacmi ---");
  L.push(pad("Etkilenen konuşma satırı", impact.conversations));
  L.push(pad("  bunlardan QR", impact.qr_conversations));
  L.push(pad("  mesaj (FK cascade VAR)", impact.messages));
  L.push(pad("  outbox (FK YOK → dangling riski)", impact.outbox));
  L.push(pad("  riskEvent (FK YOK)", impact.risk_events));
  L.push(pad("  shadowVerdict (FK YOK)", impact.shadow_verdicts));
  L.push("");

  L.push("--- KARAR ---");
  if (decision.code === "CELISKI") {
    L.push("⛔ DUR. En az bir Hospitable grubunda GERÇEKTEN farklı conversation id var.");
    L.push("   @@unique([propertyId, externalReservationId]) bu veriyle YANLIŞTIR:");
    L.push("   meşru ayrı thread'leri birleştirmeye zorlar. Karar 1 → KARAR 2.");
    L.push("   Önce sağlayıcı davranışını doğrula; doğru anahtarı tasarlarken");
    L.push("   externalConversationId'nin bugün HİÇ güncellenmediğini unutma.");
  } else if (decision.code === "DEDUPE_GEREKLI") {
    L.push("⚠️ Çakışma VAR, fakat çelişkili conversation id YOK.");
    L.push("   Unique migration ŞU ANDA UYGULANAMAZ — önce dedupe şart.");
    if (groups.hosp_mixed || groups.hosp_all_null) {
      L.push("   'karışık' / 'kanıt-yok' grupları otomatik silmeye UYGUN DEĞİL:");
      L.push("   sağlayıcı kanıtı eksik → gözetimli, elde onaylı dedupe.");
    }
    if (qr.qr_legacy) {
      L.push("   Legacy QR satırları AYRI bir iş: deterministik qrconv_ id'si");
      L.push("   keeper'ı belirler, Hospitable yarışıyla karıştırma.");
    }
  } else {
    L.push("✅ Çakışma YOK. Unique migration bu veriyle sorunsuz uygulanır.");
  }
  L.push("");
  L.push("   ZORUNLU SIRA (atlanmaz): (0) prod yedek → (1) bu preflight →");
  L.push("   (2) ÖNCE SYNC TARAFI (org-scoped advisory lock/TX + P2002 sonrası");
  L.push("   canonical satırı YENİDEN OKUMA) → (3) FK + TÜM mesajları koruyan");
  L.push("   DRY-RUN dedupe → (4) yedek → (5) EN SON unique migration →");
  L.push("   (6) iki paralel sync testinde TEK conversation + TEK mesaj seti.");
  L.push("   Unique TEK BAŞINA yarışı çözmez; yalnız ikinci yazımı 500'e çevirir.");
  L.push("");
  return L;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[preflight] DATABASE_URL yok — bağlanılmadı.");
    process.exitCode = 1;
    return;
  }
  let prisma;
  try {
    const timeouts = resolveTimeouts();
    prisma = new PrismaClient();
    const stats = await collectPreflight(prisma, {
      timeouts,
      allowPrimary: process.env.PREFLIGHT_ALLOW_PRIMARY === "1",
    });
    const decision = decide(stats);
    console.log(formatReport(stats, decision).join("\n"));
    process.exitCode = decision.exitCode;
  } catch (e) {
    // Hata metni bağlantı dizesi taşıyabilir → yalnız tip + bizim yazdığımız mesaj.
    const known = e instanceof Error && /READ ONLY|PRIMARY|PREFLIGHT_/.test(e.message);
    console.error(`[preflight] başarısız: ${known ? e.message : (e?.name ?? "Error")}`);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}

// Yalnız doğrudan çalıştırılınca koş; testler fonksiyonları import edebilsin.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
