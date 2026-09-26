import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { embedTexts, embeddingModel, EMBEDDING_BATCH_MAX } from "@/lib/ai/embeddings/provider";

// ---------------------------------------------------------------------------
// RAG LAB — DİSK ÖNBELLEĞİ (#189, 09-26). Aynı metnin gömmesi ve aynı istemin model çıktısı bir kez ödenir; deney
// yapılandırmaları arasında karşılaştırma aynı girdiyle yapılır (koşudan koşuya model gürültüsü karşılaştırmaya karışmaz).
// Yer: `RAG_LAB_CACHE` ya da işletim sisteminin geçici dizini — depo DIŞINDA (vektörler/çıktılar repoya girmez).
// Anahtar = içerik özeti (model + tam istem/metin) → istem değişince önbellek kendiliğinden bayatlar.
// ---------------------------------------------------------------------------

export const RAG_LAB_CACHE = process.env.RAG_LAB_CACHE?.trim() || path.join(tmpdir(), "lixus-rag-lab-cache");

export function digest(parts: unknown): string {
  return createHash("sha256").update(typeof parts === "string" ? parts : JSON.stringify(parts)).digest("base64url");
}

let embedCalls = 0;
let embedTextsSent = 0;

/** Gömme (üretim istemcisi `embedTexts`), disk önbellekli. Sağlayıcı düşerse fırlatır (eksik ölçüm sonuç sayılmaz). */
export async function embedCached(texts: readonly string[]): Promise<Map<string, Float32Array>> {
  const model = embeddingModel();
  const dir = path.join(RAG_LAB_CACHE, "emb", model);
  mkdirSync(dir, { recursive: true });
  const out = new Map<string, Float32Array>();
  const missing: string[] = [];
  for (const t of new Set(texts)) {
    const f = path.join(dir, `${digest(t)}.bin`);
    if (existsSync(f)) {
      const buf = readFileSync(f);
      out.set(t, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    } else missing.push(t);
  }
  for (let i = 0; i < missing.length; i += EMBEDDING_BATCH_MAX) {
    const batch = missing.slice(i, i + EMBEDDING_BATCH_MAX);
    embedCalls += 1;
    embedTextsSent += batch.length;
    // Geçici sağlayıcı arızası (hız sınırı / ağ): artan beklemeyle 4 deneme; yine olmazsa FIRLAT (eksik ölçüm sonuç sayılmaz).
    let vecs: number[][] | null = null;
    for (let attempt = 0; attempt < 4 && !vecs; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
      vecs = await embedTexts(batch, { quiet: true });
    }
    if (!vecs) throw new Error("embedding provider failed");
    batch.forEach((t, j) => {
      const v = Float32Array.from(vecs[j]);
      writeFileSync(path.join(dir, `${digest(t)}.bin`), Buffer.from(v.buffer));
      out.set(t, v);
    });
  }
  return out;
}

const llmStats = new Map<string, { hits: number; calls: number }>();

/** Model çıktısı, disk önbellekli. `run` null dönerse (arıza) yazılmaz ve null döner. */
export async function llmCached<T>(kind: string, keyParts: unknown, run: () => Promise<T | null>): Promise<T | null> {
  const dir = path.join(RAG_LAB_CACHE, "llm", kind);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${digest(keyParts)}.json`);
  const s = llmStats.get(kind) ?? { hits: 0, calls: 0 };
  llmStats.set(kind, s);
  if (existsSync(f)) {
    s.hits += 1;
    return JSON.parse(readFileSync(f, "utf8")) as T;
  }
  s.calls += 1;
  const v = await run();
  if (v !== null) writeFileSync(f, JSON.stringify(v));
  return v;
}

/**
 * `llmCached` + GECİKME: taze çağrının süresi yanına (`.ms`) yazılır, önbellekten okunurken geri verilir (üretimin sıcak yol
 * tavanını ölçümde uygulamak ve p50/p95 raporlamak için). Süresi kaydedilmemiş eski girdi `ms: null` döner (tavan uygulanmaz,
 * gecikme istatistiğine girmez — uydurma süre yazılmaz).
 */
export async function llmCachedTimed<T>(
  kind: string,
  keyParts: unknown,
  run: () => Promise<{ value: T | null; ms: number }>,
): Promise<{ value: T | null; ms: number | null; fresh: boolean }> {
  const dir = path.join(RAG_LAB_CACHE, "llm", kind);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${digest(keyParts)}.json`);
  const s = llmStats.get(kind) ?? { hits: 0, calls: 0 };
  llmStats.set(kind, s);
  if (existsSync(f)) {
    s.hits += 1;
    const msFile = `${f}.ms`;
    const ms = existsSync(msFile) ? Number(readFileSync(msFile, "utf8")) : null;
    return { value: JSON.parse(readFileSync(f, "utf8")) as T, ms: ms !== null && Number.isFinite(ms) ? ms : null, fresh: false };
  }
  s.calls += 1;
  const { value, ms } = await run();
  if (value !== null) {
    writeFileSync(f, JSON.stringify(value));
    writeFileSync(`${f}.ms`, String(ms));
  }
  return { value, ms, fresh: true };
}

/**
 * DENEY: üretim istemcisi dışında başka bir gömme modeli (ör. text-embedding-3-large, `dimensions` ile 1536'ya kısaltılmış —
 * üretimin boyut sözleşmesi aynı kalsın). Yalnız ölçüm; üretime geçmesi ayrı karar. Disk önbellekli, geçici arızada yeniden dener.
 */
export async function embedCachedWith(texts: readonly string[], model: string, dimensions: number): Promise<Map<string, Float32Array>> {
  // small'ın doğal boyutu 1536: `dimensions: 1536` ile dönen vektör doğal vektörün AYNISI → eski önbellek dizini yeniden kullanılır.
  const dir =
    model === "text-embedding-3-small" && dimensions === 1536
      ? path.join(RAG_LAB_CACHE, "emb", model)
      : path.join(RAG_LAB_CACHE, "emb", `${model}@${dimensions}`);
  mkdirSync(dir, { recursive: true });
  const out = new Map<string, Float32Array>();
  const missing: string[] = [];
  for (const t of new Set(texts)) {
    const f = path.join(dir, `${digest(t)}.bin`);
    if (existsSync(f)) {
      const buf = readFileSync(f);
      out.set(t, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    } else missing.push(t);
  }
  const key = process.env.OPENAI_API_KEY?.trim() ?? "";
  for (let i = 0; i < missing.length; i += EMBEDDING_BATCH_MAX) {
    const batch = missing.slice(i, i + EMBEDDING_BATCH_MAX);
    embedCalls += 1;
    embedTextsSent += batch.length;
    let vecs: number[][] | null = null;
    for (let attempt = 0; attempt < 4 && !vecs; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
      try {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, input: batch, dimensions }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
        const sorted = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
        if (sorted.length === batch.length) vecs = sorted;
      } catch {
        /* yeniden dene */
      }
    }
    if (!vecs) throw new Error(`embedding provider failed (${model})`);
    batch.forEach((t, j) => {
      const v = Float32Array.from(vecs![j]);
      let n = 0;
      for (const x of v) n += x * x;
      const norm = Math.sqrt(n) || 1;
      for (let k = 0; k < v.length; k++) v[k] /= norm;
      writeFileSync(path.join(dir, `${digest(t)}.bin`), Buffer.from(v.buffer));
      out.set(t, v);
    });
  }
  return out;
}

export function cacheStats(): { embedCalls: number; embedTextsSent: number; llm: Record<string, { hits: number; calls: number }> } {
  return { embedCalls, embedTextsSent, llm: Object.fromEntries(llmStats) };
}

export function dotF32(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
