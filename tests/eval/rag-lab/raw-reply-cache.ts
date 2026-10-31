import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { digest, OfflineMiss, paceModelCall, RAG_LAB_CACHE } from "./cache";

// ---------------------------------------------------------------------------
// CEVAP MODELİNİN HAM ÇIKTISI ÖNBELLEKTE (Codex 09-30, C6). Eski önbellek `suggestReply`in İŞLENMİŞ sonucunu (cevap metni,
// normalize niyet) istek kimliğiyle saklıyordu: model sonrası işleme (uzunluk kırpma, niyet normalizasyonu, kod selamı…) değişip
// istem aynı kalırsa ölçüm ESKİ işlemenin çıktısını okurdu — "müşteriye bugün ne gider" sorusu yanlış cevaplanırdı. Artık cevap
// çağrısının HAM API yanıtı, GÖNDERİLEN istek gövdesinin birebir özetiyle saklanır; her koşuda bugünkü `suggestReply` işlemesi
// ham yanıt üzerinde yeniden çalışır. Ürün koduna dokunulmaz: yalnız bu kapsamdaki `fetch` (AsyncLocalStorage) yakalanır.
//
// Eski (işlenmiş) girdiler ÜCRETLİ çağrı gerekmesin diye yedek olarak okunabilir; çağıran onları AYRI sayar (rapor "eski işleme"
// satırı) — sessizce karışmaz. Çevrimdışı kipte (`RAG_LAB_OFFLINE=1`) ham kayıt yoksa ve yedek de yoksa yüksek sesle hata.
// ---------------------------------------------------------------------------

const CHAT_URL = "https://api.openai.com/v1/chat/completions";

interface RawScope {
  /** Ham kayıt yoksa ağa çıkılsın mı ("block" = eski işlenmiş kayıt var, ücret ödenmez). */
  onMiss: "network" | "block";
  hit: boolean;
  fetched: boolean;
  blocked: boolean;
  offlineMiss: boolean;
}

const scope = new AsyncLocalStorage<RawScope>();
let realFetch: typeof fetch | null = null;

function rawDir(): string {
  const dir = path.join(RAG_LAB_CACHE, "llm", "reply-raw");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Ham kaydın dosya yolu — anahtar GÖNDERİLEN gövdenin birebir özeti (model, mesajlar, biçim, sıcaklık / tavan, çaba). */
export function rawReplyCachePath(requestBody: string): string {
  return path.join(rawDir(), `${digest(requestBody)}.json`);
}

/** Saklanmaya değer ham yanıt: tamamlanmış (kesilmemiş) ve içerikli. Kesilmiş yanıt saklanırsa her tekrar yedek cevaba düşerdi. */
function storable(text: string): boolean {
  try {
    const data = JSON.parse(text) as { choices?: { finish_reason?: string; message?: { content?: unknown } }[] };
    const choice = data?.choices?.[0];
    return typeof choice?.message?.content === "string" && choice.finish_reason !== "length";
  } catch {
    return false;
  }
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

async function wrappedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const real = realFetch!;
  const ctx = scope.getStore();
  if (!ctx || urlOf(input) !== CHAT_URL || typeof init?.body !== "string") return real(input, init);
  const file = rawReplyCachePath(init.body);
  if (existsSync(file)) {
    ctx.hit = true;
    return new Response(readFileSync(file, "utf8"), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (ctx.onMiss === "block" || process.env.RAG_LAB_OFFLINE === "1") {
    // Ağa ÇIKILMAZ; `suggestReply` bunu arıza görüp yedek cevaba düşer, çağıran eski kaydı ya da hatayı değerlendirir.
    if (ctx.onMiss === "block") ctx.blocked = true;
    else ctx.offlineMiss = true;
    return new Response(JSON.stringify({ error: { message: "rag-lab: ham kayıt yok, ağa çıkılmadı" } }), { status: 599 });
  }
  await paceModelCall();
  ctx.fetched = true;
  const res = await real(input, init);
  if (!res.ok) return res;
  const text = await res.text();
  if (storable(text)) writeFileSync(file, text);
  return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
}

function install(): void {
  if (globalThis.fetch === wrappedFetch) return;
  realFetch = globalThis.fetch;
  globalThis.fetch = wrappedFetch as typeof fetch;
}

/**
 * `fn` içindeki cevap çağrısı ham önbellekten geçer. Sonuç: `fn`in değeri + ham kayıttan mı okundu (`hit`), ağa mı çıkıldı
 * (`fetched`), eski kayıt yüzünden ağa çıkılmadan mı bırakıldı (`blocked`). Çevrimdışı kipte ham kayıt yoksa `OfflineMiss`.
 */
export async function withRawReplyCache<T>(
  fn: () => Promise<T>,
  opts: { onMiss: "network" | "block" } = { onMiss: "network" },
): Promise<{ value: T; hit: boolean; fetched: boolean; blocked: boolean }> {
  install();
  const ctx: RawScope = { onMiss: opts.onMiss, hit: false, fetched: false, blocked: false, offlineMiss: false };
  const value = await scope.run(ctx, fn);
  if (ctx.offlineMiss) throw new OfflineMiss("RAG_LAB_OFFLINE: cevap modelinin ham çıktısı önbellekte yok — ağa çıkılmadı");
  return { value, hit: ctx.hit, fetched: ctx.fetched, blocked: ctx.blocked };
}

/** Test yardımcısı: yakalamayı kaldır (asıl `fetch` geri gelir). */
export function __uninstallRawReplyCache(): void {
  if (realFetch && globalThis.fetch === wrappedFetch) globalThis.fetch = realFetch;
  realFetch = null;
}
