import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// ---------------------------------------------------------------------------
// TİP DENETİMİ / DERLEME BELLEK TAVANI AÇIKÇA VERİLİR (CI 1779, 11-11).
//
// Tip denetimi ~2,5 GB bellek ister. Node'un varsayılan tavanı makinenin belleğine göre değişir: depo private yapılınca GitHub'ın daha küçük
// makinesinde tavan ~2 GB'a düştü ve `tsc` / `next build` "JavaScript heap out of memory" ile çöktü (kod değişmeden kırmızı CI). Yerelde
// tavan zaten yüksek olduğu için hata push'tan önce görülemedi. Tavan artık işin içinde sabit: sonuç makine boyutuna bağlı değil.
// Bu pin, tavanı taşımayan YENİ bir tip denetimi / derleme adımının sessizce eklenmesini yakalar.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const MIN_HEAP_MB = 4096;

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Workflow = { env?: Record<string, string>; jobs: Record<string, { env?: Record<string, string>; steps?: Step[] }> };

/** Tip denetimi ya da üretim derlemesi koşan adımlar (bellek isteyen iki komut). */
const HEAVY = /\bnpm\s+run\s+(typecheck|build)\b|\btsc\b|\bnext\s+build\b/;

function heapLimitMb(options: string | undefined): number | null {
  const m = /--max-old-space-size=(\d+)/.exec(options ?? "");
  return m ? Number(m[1]) : null;
}

/** Bellek tavanı eksik / düşük olan ağır adımlar: `iş › adım`. */
function heavyStepsWithoutLimit(wf: Workflow): string[] {
  const out: string[] = [];
  for (const [jobName, job] of Object.entries(wf.jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.run || !HEAVY.test(step.run)) continue;
      // GitHub'da adımın ortam değişkeni işinkini, işinki iş akışınınkini EZER (birleştirmez): geçerli değer en içteki tanımdır. Adımda
      // tavansız bir NODE_OPTIONS varsa dışarıdaki tavan KAYBOLUR — o yüzden önce geçerli değer bulunur, tavan onda aranır.
      const effective = step.env?.NODE_OPTIONS ?? job.env?.NODE_OPTIONS ?? wf.env?.NODE_OPTIONS;
      const limit = heapLimitMb(effective);
      if (limit === null || limit < MIN_HEAP_MB) out.push(`${jobName} › ${step.name ?? step.run}`);
    }
  }
  return out;
}

function heavySteps(wf: Workflow): string[] {
  return Object.entries(wf.jobs).flatMap(([j, job]) => (job.steps ?? []).filter((s) => s.run && HEAVY.test(s.run)).map((s) => `${j} › ${s.name}`));
}

describe("CI: tip denetimi ve derleme adımları bellek tavanını açıkça taşır", () => {
  const wf = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;

  it("ağır adımların hepsi en az 4 GB tavanla koşar", () => {
    expect(heavyStepsWithoutLimit(wf)).toEqual([]);
  });

  it("tarama boş değil: iki tip denetimi + iki derleme adımı görülüyor", () => {
    expect(heavySteps(wf).sort()).toEqual(
      ["build › next build (via npm script — includes prisma generate)", "e2e › Build (production)", "test-nodb › Type-check", "verify-serial › Type-check"].sort(),
    );
  });

  it("tarayıcı eksik tavanı gerçekten yakalar (yapay iş akışı)", () => {
    const fake: Workflow = {
      jobs: {
        a: { steps: [{ name: "tavansız", run: "npm run typecheck" }] },
        b: { steps: [{ name: "düşük tavan", run: "npm run build", env: { NODE_OPTIONS: "--max-old-space-size=2048" } }] },
        c: { steps: [{ name: "çıplak tsc", run: "npx tsc --noEmit" }] },
        d: { env: { NODE_OPTIONS: "--max-old-space-size=4096" }, steps: [{ name: "iş düzeyinde tavan", run: "npm run build" }] },
        e: { steps: [{ name: "ilgisiz", run: "npm run lint" }] },
        f: { steps: [{ name: "yeterli", run: "npm run typecheck", env: { NODE_OPTIONS: "--use-openssl-ca --max-old-space-size=6144" } }] },
        // Adımdaki tavansız değer, iş düzeyindeki tavanı EZER → tavan yok sayılır.
        g: { env: { NODE_OPTIONS: "--max-old-space-size=4096" }, steps: [{ name: "adım tavanı ezdi", run: "npm run build", env: { NODE_OPTIONS: "--use-openssl-ca" } }] },
        h: { steps: [{ name: "çift boşluk", run: "npm  run   build" }] },
      },
    };
    expect(heavyStepsWithoutLimit(fake)).toEqual(["a › tavansız", "b › düşük tavan", "c › çıplak tsc", "g › adım tavanı ezdi", "h › çift boşluk"]);
  });
});

describe("Dockerfile: derleme aşaması tavanı taşır, çalışan kap taşımaz", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  // Yorum satırları atılır: açıklamadaki bir "NODE_OPTIONS" sözü kuralı ne sağlar ne bozar.
  const code = dockerfile
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  const runnerAt = code.search(/^FROM .* AS runner$/m);
  const builder = code.slice(0, runnerAt);
  const runner = code.slice(runnerAt);

  it("iki aşama da bulunuyor (ayrıştırma boş dönmüyor)", () => {
    expect(runnerAt).toBeGreaterThan(0);
    expect(builder).toMatch(/^FROM .* AS builder$/m);
    expect(builder).toMatch(/^RUN npm run build$/m);
  });

  it("derleme aşamasında tavan `npm run build`dan ÖNCE ayarlanır (en az 4 GB)", () => {
    const env = /^ENV NODE_OPTIONS=(.*)$/m.exec(builder);
    expect(env).not.toBeNull();
    expect(heapLimitMb(env![1])).toBeGreaterThanOrEqual(MIN_HEAP_MB);
    expect(builder.indexOf(env![0])).toBeLessThan(builder.search(/^RUN npm run build$/m));
  });

  it("çalışan kapta NODE_OPTIONS YOK — derleme tavanı üretimdeki sürecin belleğini değiştirmez", () => {
    expect(runner).not.toMatch(/NODE_OPTIONS/);
  });
});
