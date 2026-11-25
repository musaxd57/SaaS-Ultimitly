import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { flushQueryEvents } from "./query-event-barrier";

// ---------------------------------------------------------------------------
// SORGU SONDASI (optimizasyon turu 11-19, yalnız test). Bir işin veritabanına kaç kez gittiğini ve en uzun ARDIŞIK bekleme zincirini
// (şelale derinliği) ölçer — ürün kodu DEĞİŞMEZ:
//  · SQL sayısı: Prisma'nın sorgu olayı (`$on("query")`). Test ortamında `src/lib/db.ts` olayı zaten açar (`DB_SLOW_QUERY_MS`
//    varsayılanı 1000 > 0 → `{ emit: "event", level: "query" }`); kapalı bulunursa ölçüm boş kalır ve `probeQueries` FIRLATIR
//    (sessiz sıfır = sahte kazanç olurdu).
//  · Prisma çağrısı + derinlik (`depth: true`): `$use` ara katmanı çağrıları TURLARA böler. Bir tur ancak önceki turun bütün çağrıları
//    bittikten ve iş `quietMs` boyunca yeni çağrı yapmadıktan sonra salıverilir; çağrının turu = verildiği andaki tur + 1. Böylece
//    birbirinden bağımsız çağrılar aynı tura düşer, bir sonuca BAĞLI çağrı bir sonraki tura. Derinlik = tur sayısı. Ölçüm saate bağlı
//    DEĞİLDİR: yük altındaki duraklama yalnız turu geciktirir, çağrıyı yanlış tura koymaz (ilk sürüm sabit gecikme + zaman sırası
//    kullanıyordu; yükte dallar arası kayma sahte +1 üretiyordu — ölçüldü).
//    Sınır: bir çağrı, sonucunu beklediği çağrıdan `quietMs`ten uzun süre sonra (veritabanı dışı bir beklemeyle) verilirse ayrı tura
//    düşebilir; istek yolunda böyle bir bekleme yok.
// Ara katman ve dinleyici süreç başına BİR kez kurulur (Prisma kaldırma yolu vermez); ölçüm dışında çağrıyı olduğu gibi geçirir.
//  · Ölçümün iki ucu bariyerlidir (11-25): sorgu olayı sonuçtan SONRA gelebilir — ölçümden önceki hazırlık sorgusunun olayı ölçüme
//    düşmesin (+1), son sorgunun olayı da kaçmasın (−1) diye başta ve sonda işaret sorgusu atılıp olayı beklenir
//    (`query-event-barrier.ts`; eskiden sonda sabit 20 ms bekleniyordu, başta hiçbir şey yoktu). İşaret çağrısı sayılmaz (`bypass`).
// ---------------------------------------------------------------------------

export interface ProbeOp {
  op: string;
  /** Çağrının turu (1 = iş başlarken verilen çağrılar). `depth: true` değilse hep 1. */
  round: number;
  start: number;
  end: number;
}

export interface ProbeResult<T> {
  result: T;
  /** Veritabanına giden SQL ifadesi sayısı (BEGIN / COMMIT dahil). */
  sql: number;
  /** Prisma istemci çağrısı sayısı (iç içe `include` tek çağrıdır, birden çok SQL olabilir). */
  ops: number;
  /** En uzun ardışık Prisma çağrısı zinciri (tur sayısı); `depth: true` değilse 0. */
  depth: number;
  /** "model.işlem" → sayı. */
  byOp: Record<string, number>;
  sqlTexts: string[];
  timeline: ProbeOp[];
}

interface Gate {
  op: string;
  round: number;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

interface ActiveProbe {
  sql: string[];
  ops: ProbeOp[];
  rounds: boolean;
  /** İşaret (bariyer) sorgusu atılırken ara katman çağrıyı saymaz / tura koymaz. */
  bypass: boolean;
  quietMs: number;
  released: number;
  inFlight: number;
  queue: Gate[];
  lastIssue: number;
  timer: ReturnType<typeof setTimeout> | null;
}

let installed = false;
let active: ActiveProbe | null = null;

function schedule(p: ActiveProbe): void {
  if (p.timer) return;
  p.timer = setTimeout(() => {
    p.timer = null;
    if (p.inFlight > 0 || p.queue.length === 0) return;
    const quietFor = performance.now() - p.lastIssue;
    if (quietFor < p.quietMs) {
      p.timer = setTimeout(() => {
        p.timer = null;
        schedule(p);
      }, p.quietMs - quietFor);
      return;
    }
    release(p);
  }, p.quietMs);
}

function release(p: ActiveProbe): void {
  p.released++;
  const batch = p.queue;
  p.queue = [];
  for (const g of batch) {
    p.inFlight++;
    const rec: ProbeOp = { op: g.op, round: g.round, start: performance.now(), end: 0 };
    p.ops.push(rec);
    g.run().then(
      (v) => {
        rec.end = performance.now();
        p.inFlight--;
        g.resolve(v);
        schedule(p);
      },
      (e) => {
        rec.end = performance.now();
        p.inFlight--;
        g.reject(e);
        schedule(p);
      },
    );
  }
}

/** Ölçüm bitince bekleyen çağrılar olduğu gibi salıverilir (iş takılı kalmasın). */
function drain(p: ActiveProbe): void {
  if (p.timer) clearTimeout(p.timer);
  p.timer = null;
  const batch = p.queue;
  p.queue = [];
  for (const g of batch) g.run().then(g.resolve, g.reject);
}

function install(): void {
  if (installed) return;
  installed = true;
  const client = prisma as unknown as {
    $on(event: "query", cb: (e: { query: string }) => void): void;
    $use(mw: (params: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>): void;
  };
  client.$on("query", (e) => {
    // Bağlantı havuzunun kendi yoklaması (çıplak `SELECT 1`) ölçülen işin sorgusu değildir; ara sıra düşüp "aynı sayı" iddiasını oynatırdı
    // (ölçüldü 11-21: 1.500 çağrıda 4 kez; `tests/helpers/query-event-barrier.ts`).
    if (/^\s*SELECT 1\s*$/i.test(e.query)) return;
    active?.sql.push(e.query);
  });
  client.$use(async (params, next) => {
    const probe = active;
    if (!probe || probe.bypass) return next(params);
    const op = `${params.model ?? "$raw"}.${params.action}`;
    if (!probe.rounds) {
      const rec: ProbeOp = { op, round: 1, start: performance.now(), end: 0 };
      probe.ops.push(rec);
      try {
        return await next(params);
      } finally {
        rec.end = performance.now();
      }
    }
    return new Promise((resolve, reject) => {
      probe.queue.push({ op, round: probe.released + 1, run: () => next(params), resolve, reject });
      probe.lastIssue = performance.now();
      schedule(probe);
    });
  });
}

/**
 * `fn`i sonda altında koşturur. `depth: true`: çağrılar turlara bölünür (derinlik ölçümü; her tur ≈ `quietMs` gecikir). Sayım için gerekmez.
 * Aynı anda tek sonda (iç içe çağrı fırlatır).
 */
export async function probeQueries<T>(fn: () => Promise<T>, opts: { depth?: boolean; quietMs?: number } = {}): Promise<ProbeResult<T>> {
  install();
  if (active) throw new Error("probeQueries: iç içe sonda desteklenmez");
  const probe: ActiveProbe = {
    sql: [],
    ops: [],
    rounds: opts.depth === true,
    bypass: true,
    quietMs: opts.quietMs ?? 15,
    released: 0,
    inFlight: 0,
    queue: [],
    lastIssue: 0,
    timer: null,
  };
  active = probe;
  const client = prisma as unknown as PrismaClient;
  let result: T;
  try {
    // Baş bariyer: ölçümden ÖNCEKİ sorguların geç gelen olayları burada tüketilir ve atılır.
    await flushQueryEvents(client, { rows: probe.sql });
    probe.sql.length = 0;
    probe.bypass = false;
    result = await fn();
    // Son bariyer: son sorgunun olayı sonuçtan sonra gelebilir — işaretin olayı görülene kadar beklenir (sabit bekleme değil).
    probe.bypass = true;
    await flushQueryEvents(client, { rows: probe.sql });
  } finally {
    active = null;
    drain(probe);
  }
  if (probe.ops.length > 0 && probe.sql.length === 0) {
    throw new Error("probeQueries: Prisma sorgu olayı kapalı — SQL sayımı yapılamaz (DB_SLOW_QUERY_MS=0?)");
  }
  const byOp: Record<string, number> = {};
  for (const o of probe.ops) byOp[o.op] = (byOp[o.op] ?? 0) + 1;
  return {
    result,
    sql: probe.sql.length,
    ops: probe.ops.length,
    depth: probe.rounds ? probe.ops.reduce((m, o) => Math.max(m, o.round), 0) : 0,
    byOp,
    sqlTexts: probe.sql,
    timeline: [...probe.ops].sort((a, b) => a.start - b.start),
  };
}

/** Okunur özet (rapor / hata iletisi için). */
export function probeSummary(r: Pick<ProbeResult<unknown>, "sql" | "ops" | "depth" | "byOp">): string {
  const ops = Object.entries(r.byOp)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}×${v}`)
    .join(" ");
  return `sql=${r.sql} ops=${r.ops} depth=${r.depth} [${ops}]`;
}
