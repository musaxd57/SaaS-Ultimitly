import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// SORGU SONDASI (optimizasyon turu 11-19, yalnız test). Bir işin veritabanına kaç kez gittiğini ve en uzun ARDIŞIK bekleme zincirini
// (şelale derinliği) ölçer — ürün kodu DEĞİŞMEZ:
//  · SQL sayısı: Prisma'nın sorgu olayı (`$on("query")`). Test ortamında `src/lib/db.ts` olayı zaten açar (`DB_SLOW_QUERY_MS`
//    varsayılanı 1000 > 0 → `{ emit: "event", level: "query" }`); kapalı bulunursa ölçüm boş kalır ve `probeQueries` FIRLATIR
//    (sessiz sıfır = sahte kazanç olurdu).
//  · Prisma çağrısı + derinlik: `$use` ara katmanı her çağrının başlangıç / bitiş anını yazar ve başlangıçta sabit gecikme ekler.
//    Derinlik(çağrı) = 1 + max(derinlik(ö) : ö.bitiş <= çağrı.başlangıç). Gecikme yüzünden aynı `Promise.all` içindeki çağrılar
//    birbirinin bitişini göremez; ardışık çağrı öncekinin bitişinden sonra başlar. Gecikme, kritik yol boyunca biriken gerçek sorgu /
//    işlem süresi farkından BÜYÜK seçilmeli: küçükse dallar arası kayma sahte bir bağımlılık (+1) üretir (ölçüldü: pano 12 ms'de 10 / 11
//    arasında oynuyor, 30-50 ms'de sabit; ağır yük altında çok dallı yüzeyde yine nadiren +1).
// Ara katman ve dinleyici süreç başına BİR kez kurulur (Prisma kaldırma yolu vermez); ölçüm dışında hiçbir şey yapmaz.
// ---------------------------------------------------------------------------

export interface ProbeOp {
  op: string;
  start: number;
  end: number;
  depth: number;
}

export interface ProbeResult<T> {
  result: T;
  /** Veritabanına giden SQL ifadesi sayısı (BEGIN / COMMIT dahil). */
  sql: number;
  /** Prisma istemci çağrısı sayısı (iç içe `include` tek çağrıdır, birden çok SQL olabilir). */
  ops: number;
  /** En uzun ardışık Prisma çağrısı zinciri. */
  depth: number;
  /** "model.işlem" → sayı. */
  byOp: Record<string, number>;
  sqlTexts: string[];
  timeline: ProbeOp[];
}

interface ActiveProbe {
  sql: string[];
  ops: { op: string; start: number; end: number }[];
  delayMs: number;
}

let installed = false;
let active: ActiveProbe | null = null;

function install(): void {
  if (installed) return;
  installed = true;
  const client = prisma as unknown as {
    $on(event: "query", cb: (e: { query: string }) => void): void;
    $use(mw: (params: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>): void;
  };
  client.$on("query", (e) => {
    active?.sql.push(e.query);
  });
  client.$use(async (params, next) => {
    const probe = active;
    if (!probe) return next(params);
    const start = performance.now();
    if (probe.delayMs > 0) await new Promise((r) => setTimeout(r, probe.delayMs));
    try {
      return await next(params);
    } finally {
      probe.ops.push({ op: `${params.model ?? "$raw"}.${params.action}`, start, end: performance.now() });
    }
  });
}

function depthOf(ops: { op: string; start: number; end: number }[]): ProbeOp[] {
  const sorted = [...ops].sort((a, b) => a.start - b.start);
  const out: ProbeOp[] = [];
  for (const o of sorted) {
    let d = 1;
    for (const p of out) if (p.end <= o.start && p.depth + 1 > d) d = p.depth + 1;
    out.push({ ...o, depth: d });
  }
  return out;
}

/**
 * `fn`i sonda altında koşturur. `delayMs` > 0: her Prisma çağrısına gecikme (derinlik ölçümü için; sayım için 0 yeter).
 * Aynı anda tek sonda (iç içe çağrı fırlatır).
 */
export async function probeQueries<T>(fn: () => Promise<T>, opts: { delayMs?: number } = {}): Promise<ProbeResult<T>> {
  install();
  if (active) throw new Error("probeQueries: iç içe sonda desteklenmez");
  const probe: ActiveProbe = { sql: [], ops: [], delayMs: opts.delayMs ?? 0 };
  active = probe;
  let result: T;
  try {
    result = await fn();
    // Sorgu olayı motorun geri çağrısıyla gelir; son çağrının olayı sonucu birkaç an geçebilir.
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    active = null;
  }
  if (probe.ops.length > 0 && probe.sql.length === 0) {
    throw new Error("probeQueries: Prisma sorgu olayı kapalı — SQL sayımı yapılamaz (DB_SLOW_QUERY_MS=0?)");
  }
  const timeline = depthOf(probe.ops);
  const byOp: Record<string, number> = {};
  for (const o of probe.ops) byOp[o.op] = (byOp[o.op] ?? 0) + 1;
  return {
    result,
    sql: probe.sql.length,
    ops: probe.ops.length,
    depth: timeline.reduce((m, o) => Math.max(m, o.depth), 0),
    byOp,
    sqlTexts: probe.sql,
    timeline,
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
