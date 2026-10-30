// ---------------------------------------------------------------------------
// OPENAI İSTEM ÖNBELLEĞİ (kurucu 10-30: "modelimizdeki prompt caching'i kullanalım"). SAF, yaprak modül.
//
// OpenAI istem önbelleği kendiliğinden çalışır (1.024 token üstü, birebir aynı önek) ama varsayılan saklama bellekte ve kısadır (dakikalar):
// ~10 dairelik bir işletmede mesajlar saatlere yayılır, aynı sistem istemi bir sonraki çağrıya kadar çoğu kez önbellekten düşer. İki alan:
//   · `prompt_cache_key` — aynı amaçlı istekler aynı önbellek makinesine yönlendirilir (amaç başına SABİT anahtar; misafir / org verisi
//     İÇERMEZ).
//   · `prompt_cache_retention: "24h"` — önek 24 saate kadar tutulur.
// Ölçüldü (10-30, gerçek API): gpt-5.1 · gpt-6-luna · gpt-5-mini · gpt-4.1-mini iki alanı da hatasız kabul ediyor; gpt-5.1 ikinci çağrıda
// 2.884 girdi tokeninin 2.688'ini önbellekten okudu (önbellekten okunan girdi ~%90 ucuz). Önbellek ÇIKTIYI DEĞİŞTİRMEZ.
// Yalnız istek OpenAI'ye gidiyorsa eklenir (OpenAI-uyumlu başka uç bilinmeyen alanı reddedebilir).
// Acil kapatma: `OPENAI_PROMPT_CACHE_DISABLED=1` (iki alan da gönderilmez). `OPENAI_PROMPT_CACHE_RETENTION=in_memory` yalnız saklamayı
// varsayılana döndürür.
// ---------------------------------------------------------------------------

const OPENAI_HOST = "api.openai.com";

export type PromptCachePurpose =
  | "reply"
  | "translate"
  | "style"
  | `semantic:${string}`;

/** Bu isteğe eklenecek önbellek alanları (boş nesne = hiçbir şey eklenmez). */
export function promptCacheFields(
  purpose: PromptCachePurpose,
  url: string,
  env: Record<string, string | undefined> = process.env,
): { prompt_cache_key?: string; prompt_cache_retention?: "24h" } {
  if (env.OPENAI_PROMPT_CACHE_DISABLED === "1") return {};
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return {};
  }
  if (host !== OPENAI_HOST) return {};
  const key = `lixus:${purpose}`.slice(0, 64);
  const retention = (env.OPENAI_PROMPT_CACHE_RETENTION ?? "24h").trim();
  return retention === "24h" ? { prompt_cache_key: key, prompt_cache_retention: "24h" } : { prompt_cache_key: key };
}
