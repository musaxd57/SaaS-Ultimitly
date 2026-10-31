/* ---------------------------------------------------------------------------
 * KALICI GÖMME DEPOSU (migration 87 `KbChunkVector`; kurucu 10-23 "Bilgi tabanı iki yeni tablo ana dala", 10-28 "tamamdır … en uzun vadeli
 * en iyi olacak şekilde"). Tasarım: `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md` §10.1 +
 * `docs/TASARIM-2026-10-28-dosya-rag-cumle-ve-anlam.md` §4.2 (K1–K7).
 *
 * NEDEN: parça vektörleri süreç belleğinde (LRU); her yayında / yeniden başlatmada sıfırlanıyor ve o daireye gelen ilk misafir sorusu
 * anlamsal aramasız (sözcüksel, "cold") kalıyordu, bütün bilgi tabanları da yeniden ödenerek gömülüyordu. Depo vektörü bir kez üretip saklar.
 *
 * SÖZLEŞME:
 *  · Anahtar `KB_VECTOR_STORE_ENABLED` YALNIZ "1" (STRICT_ONE_FLAGS). Kapalıyken bu modül veritabanına HİÇ dokunmaz (okuma / yazma / silme
 *    yok) — davranış bayt bayt bugünkü bellek deposu.
 *  · METİN SAKLANMAZ. Satır = (kalem, model, tarif, tür, girdi özeti, sıra) → vektör baytları. Tablo her zaman yeniden kurulabilir önbellektir.
 *  · Kiracı yalıtımı OKUMANIN kendisinde: satırlar yalnız çağıranın verdiği kalem kimlikleriyle istenir; kalem kimlikleri çağıranın kiracı
 *    süzgeçli bilgi tabanı okumasından gelir. Başka işletmenin satırı istenemez.
 *  · Okuma zaman sınırlı (`VECTOR_STORE_READ_TIMEOUT_MS`); her satır doğrulanır (türün izinli boyutu · bayt = boyut × 4 · sonlu sayılar);
 *    bozuk satır silinir ve EKSİK sayılır. Çağıran eksik kalırsa bugünkü gibi "cold" der (YARIM HARİTA YOK).
 *  · Yazma yalnız ısıtmadan (`semantic-retrieval.ts scheduleWarm`): sorgu vektörü ASLA yazılmaz. Her satır üretildiği andaki kalem
 *    sürümünü (`itemUpdatedAt`) taşır ve YALNIZ kalem hâlâ o sürümdeyse yazılır (kalem satırı `FOR SHARE` ile kilitlenerek) → düzenlemeden
 *    önce başlamış bir ısıtma eski metnin satırını bırakamaz (Haiku 10-28).
 *  · Temizlik sürüm uyuşmazlığıyla (saat karşılaştırması yok): yazma kancası (`kb/after-change.ts`) değişen dairelerde, açılış bütün
 *    depoda `itemUpdatedAt ≠ kalem.updatedAt` satırlarını ve başka model / tarif satırlarını siler. Kalem / daire / işletme silinince
 *    satırlar cascade ile gider.
 *  · ASLA FIRLATMAZ: her arıza "depoda yok" demektir (bellek deposu + ısıtma bugünkü gibi çalışır).
 * ------------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";

/** Eşleşme birimi türleri (K1). Bugün yalnız `chunk` yazılır; öteki türler cümle / soru düzeyi anlam araması dilimlerinde. */
export const KB_VECTOR_KINDS = ["chunk", "sentence", "question", "item"] as const;
export type KbVectorKind = (typeof KB_VECTOR_KINDS)[number];

/** Bugünkü gömme metni tarifi (K2): `embeddingTextFor` (kategori · başlık önekli parça metni). Tarif değişirse yeni sürüm adı verilir. */
export const KB_VECTOR_RECIPE = "c1";

/** Sıcak yolda depo okumasının tavanı: aşılırsa o karar bugünkü gibi sözcüksel devam eder (misafir beklemez). */
export const VECTOR_STORE_READ_TIMEOUT_MS = 250;
/** Arka plan ısıtmasında depo okumasının tavanı (misafir beklemiyor; aşılırsa eksikler gömülür). */
export const VECTOR_STORE_WARM_READ_TIMEOUT_MS = 5_000;

/** Tek sorguda istenen girdi özeti tavanı (IN listesi; büyük bilgi tabanı dilimlere bölünür). */
const READ_BATCH = 500;

/** Anahtar yalnız tam "1" ile açılır. */
export function vectorStoreEnabled(): boolean {
  return process.env.KB_VECTOR_STORE_ENABLED === "1";
}

/**
 * Tarif girdisinin özeti (K3). Belirlenimci tarifte girdi = gömülen metin; değer bellek deposunun anahtarıyla AYNI özet
 * (`semantic-retrieval.ts storeKey`) — iki depo aynı metni aynı anahtarla tanır.
 */
export function inputHashOf(text: string): string {
  return createHash("sha256").update(text).digest("base64url");
}

/**
 * Tür + tarif başına izinli boyutlar (K6). Sabit "1.536 değilse bozuk" kuralı ileride 512 boyutlu cümle / soru satırlarını ilk okumada
 * silerdi; izinli küme türe göre. Bilinmeyen tür / tarif → boş küme (satır bozuk sayılır).
 */
export function allowedDims(kind: string, recipe: string): readonly number[] {
  if (recipe !== KB_VECTOR_RECIPE) return [];
  switch (kind) {
    case "chunk":
    case "item":
      return [1536];
    case "sentence":
    case "question":
      return [512, 1536];
    default:
      return [];
  }
}

/** Vektörü saklanacak baytlara çevirir (Float32, küçük-sonlu). */
export function encodeVector(vec: readonly number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  vec.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
}

/** Saklanan satırı doğrular ve çözer; geçersizse `null` (çağıran satırı bozuk sayar). */
export function decodeVector(row: { kind: string; recipe: string; dims: number; vector: Uint8Array }): Float32Array | null {
  if (!allowedDims(row.kind, row.recipe).includes(row.dims)) return null;
  if (row.vector.byteLength !== row.dims * 4) return null;
  const buf = Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
  const out = new Float32Array(row.dims);
  for (let i = 0; i < row.dims; i++) {
    const v = buf.readFloatLE(i * 4);
    if (!Number.isFinite(v)) return null;
    out[i] = v;
  }
  return out;
}

/** Bir isteğin parça girdisi: hangi kalemin hangi metni. */
export interface StoredChunkRef {
  kbItemId: string;
  text: string;
}

/** `vectors`: metin → vektör. `found`: depoda KENDİ satırı bulunan (kalem, girdi özeti) çiftleri (`pairKey`). */
type ReadResult = { vectors: Map<string, Float32Array>; found: Set<string>; timedOut: boolean };

/** (kalem, girdi özeti) çifti anahtarı. */
export function pairKey(kbItemId: string, inputHash: string): string {
  return `${kbItemId}|${inputHash}`;
}

/** Test kancası: okuma gecikmesi / arızası benzetimi için sorgunun yerine geçer. */
let readOverride: ((args: { kbItemIds: string[]; model: string; hashes: string[] }) => Promise<ReadRow[]>) | null = null;

interface ReadRow {
  id: string;
  kbItemId: string;
  inputHash: string;
  kind: string;
  recipe: string;
  dims: number;
  vector: Uint8Array;
}

async function readRows(kbItemIds: string[], model: string, hashes: string[]): Promise<ReadRow[]> {
  if (readOverride) return readOverride({ kbItemIds, model, hashes });
  const rows: ReadRow[] = [];
  for (let i = 0; i < hashes.length; i += READ_BATCH) {
    rows.push(
      ...(await prisma.kbChunkVector.findMany({
        where: { kbItemId: { in: kbItemIds }, model, recipe: KB_VECTOR_RECIPE, kind: "chunk", ord: 0, inputHash: { in: hashes.slice(i, i + READ_BATCH) } },
        select: { id: true, kbItemId: true, inputHash: true, kind: true, recipe: true, dims: true, vector: true },
      })),
    );
  }
  return rows;
}

/**
 * Depodan parça vektörlerini okur: metin → vektör. Yalnız verilen kalem kimlikleriyle (kiracı süzgeçli) ve zaman sınırıyla. Bozuk satırlar
 * arka planda silinir ve sonuçta yoktur. Anahtar kapalıyken, boş istekte ya da arızada boş harita. Fırlatmaz.
 */
export async function loadChunkVectors(model: string, refs: readonly StoredChunkRef[], timeoutMs: number): Promise<ReadResult> {
  const empty: ReadResult = { vectors: new Map(), found: new Set(), timedOut: false };
  if (!vectorStoreEnabled() || refs.length === 0) return empty;
  const byHash = new Map<string, string>();
  for (const r of refs) byHash.set(inputHashOf(r.text), r.text);
  const kbItemIds = [...new Set(refs.map((r) => r.kbItemId))];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const rows = await Promise.race([readRows(kbItemIds, model, [...byHash.keys()]), timeout]);
    if (rows === "timeout") return { vectors: new Map(), found: new Set(), timedOut: true };
    const vectors = new Map<string, Float32Array>();
    const found = new Set<string>();
    const corrupt: string[] = [];
    for (const row of rows) {
      const text = byHash.get(row.inputHash);
      if (text === undefined) continue;
      const vec = decodeVector(row);
      if (!vec) {
        corrupt.push(row.id);
        continue;
      }
      vectors.set(text, vec);
      found.add(pairKey(row.kbItemId, row.inputHash));
    }
    if (corrupt.length > 0) {
      void prisma.kbChunkVector.deleteMany({ where: { id: { in: corrupt } } }).catch((err) => void reportError("kb-vector-store-delete-corrupt", err));
    }
    return { vectors, found, timedOut: false };
  } catch (err) {
    void reportError("kb-vector-store-read", err);
    return empty;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Bir metni taşıyan kalem + ısıtmanın gördüğü kalem sürümü. */
export interface ChunkOwner {
  kbItemId: string;
  updatedAt: Date;
}

/**
 * Isıtmanın ürettiği parça vektörlerini saklar. Aynı metin birden çok kalemde geçiyorsa her kaleme bir satır (kalem silinince yalnız kendi
 * satırı gider). Yazma YALNIZ kalem hâlâ ısıtmanın gördüğü sürümdeyse yapılır: kalem satırları `FOR SHARE` ile kilitlenir (eşzamanlı
 * düzenleme bu işlem bitene kadar bekler, sonra yazma kancasının temizliği bu satırı sürüm uyuşmazlığından siler), silinmiş ya da
 * değişmiş kalemin satırı hiç yazılmaz. Yazılan (kalem, girdi özeti) çiftlerini döner. Fırlatmaz.
 */
export async function persistChunkVectors(
  model: string,
  entries: readonly { owners: readonly ChunkOwner[]; text: string; vector: ArrayLike<number> }[],
): Promise<Set<string>> {
  const written = new Set<string>();
  if (!vectorStoreEnabled() || entries.length === 0) return written;
  try {
    const ids = [...new Set(entries.flatMap((e) => e.owners.map((o) => o.kbItemId)))];
    await prisma.$transaction(async (tx) => {
      const current = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>`
        SELECT "id", "updatedAt" FROM "KnowledgeBaseItem" WHERE "id" = ANY(${ids}::text[]) FOR SHARE`;
      const version = new Map(current.map((r) => [r.id, r.updatedAt.getTime()]));
      const data = entries.flatMap((e) => {
        const vector = encodeVector(Array.from(e.vector));
        const inputHash = inputHashOf(e.text);
        const seen = new Set<string>();
        return e.owners.flatMap((o) => {
          if (seen.has(o.kbItemId) || version.get(o.kbItemId) !== o.updatedAt.getTime()) return [];
          seen.add(o.kbItemId);
          written.add(pairKey(o.kbItemId, inputHash));
          return [{ kbItemId: o.kbItemId, model, recipe: KB_VECTOR_RECIPE, kind: "chunk", inputHash, ord: 0, dims: e.vector.length, vector, itemUpdatedAt: o.updatedAt }];
        });
      });
      if (data.length > 0) await tx.kbChunkVector.createMany({ data, skipDuplicates: true });
    });
    return written;
  } catch (err) {
    void reportError("kb-vector-store-write", err);
    return new Set();
  }
}

/**
 * Değişen dairelerin kalemlerinde ARTIK GEÇMEYEN belirlenimci satırları siler (K7): satırın kalem sürümü kalemin bugünkü sürümü değilse
 * satır eski metnindir. Saat karşılaştırması yok (uygulama ile veritabanı saati farklı olabilir). Metni değişmeyen kalem (ör. aç-kapa) bir
 * kez yeniden ısıtılır — ucuz. Model üretimli türler (`question`) burada silinmez; onların temizliği ileriki dilimde. Fırlatmaz.
 */
export async function purgeStaleVectors(propertyIds: readonly string[]): Promise<number> {
  if (!vectorStoreEnabled() || propertyIds.length === 0) return 0;
  try {
    return await prisma.$executeRaw`
      DELETE FROM "KbChunkVector" v
      USING "KnowledgeBaseItem" k
      WHERE v."kbItemId" = k."id"
        AND k."propertyId" = ANY(${[...propertyIds]}::text[])
        AND v."kind" IN ('chunk', 'sentence', 'item')
        AND v."itemUpdatedAt" <> k."updatedAt"`;
  } catch (err) {
    void reportError("kb-vector-store-purge-stale", err);
    return 0;
  }
}

/**
 * Açılışta: bugünkü model + tarif dışındaki satırları ve kalem sürümü tutmayan belirlenimci satırları (bütün depoda) siler — model ya da
 * tarif değişince eski vektörler kalmasın, kancanın göremediği bir eski satır en geç bir sonraki açılışta gitsin. Fırlatmaz.
 */
export async function purgeOtherModelVectors(model: string): Promise<number> {
  if (!vectorStoreEnabled()) return 0;
  try {
    const res = await prisma.kbChunkVector.deleteMany({ where: { OR: [{ model: { not: model } }, { recipe: { not: KB_VECTOR_RECIPE } }] } });
    const stale = await prisma.$executeRaw`
      DELETE FROM "KbChunkVector" v
      USING "KnowledgeBaseItem" k
      WHERE v."kbItemId" = k."id"
        AND v."kind" IN ('chunk', 'sentence', 'item')
        AND v."itemUpdatedAt" <> k."updatedAt"`;
    return res.count + stale;
  } catch (err) {
    void reportError("kb-vector-store-purge-models", err);
    return 0;
  }
}

/** Test kancası. */
export function __setVectorStoreReadForTests(fn: typeof readOverride): void {
  readOverride = fn;
}
