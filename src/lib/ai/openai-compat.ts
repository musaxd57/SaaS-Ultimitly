import { isReasoningModel } from "./model-family";

// ---------------------------------------------------------------------------
// OpenAI-UYUMLU İSTEK SÖZLEŞMESİ — tek kaynak.
//
// Üç ayrı yer (ana yanıt üretimi, gölge sınıflandırıcı, hazırlık özeti) aynı
// `/chat/completions` biçimini konuşuyor ve aynı üç tuzağa basabiliyor. Kural
// yazılı olmazsa biri diğerlerinden sessizce ayrışır ve bu, ancak canlıda bir
// arıza olarak görünür. O yüzden kurallar burada, bir kez:
//
//  1) ANAHTAR-SAĞLAYICI EŞLEŞMESİ. Ana hesabın `OPENAI_API_KEY`'i YALNIZ istek
//     gerçekten OpenAI'ye gidiyorsa devreye girer. Aksi hâlde tek bir base-URL
//     yazımı, ana faturalandırma anahtarını üçüncü bir sağlayıcıya Bearer olarak
//     taşırdı. Başka endpoint = kendi anahtarını ver, yoksa özellik pasif kalır.
//  2) GÖVDE MODEL AİLESİNE GÖRE. Reasoning modelleri (o-serisi, gpt-5 ailesi —
//     Luna dahil) özel `temperature`'ı REDDEDER ve tavanı `max_completion_tokens`
//     ile alır; o tavan gizli düşünme token'larını da kapsadığı için klasik
//     `max_tokens` değerleri (200-600) boş yanıt üretir. `chat_template_kwargs`
//     ise vLLM/GLM uzantısıdır; OpenAI onu tanımaz ve 400 döner.
//  3) MODEL↔ENDPOINT UYUMU. `zai-org/GLM-5.2` gibi satıcı-ön-ekli bir slug
//     OpenAI'de 404'tür. Env yarım güncellenirse (endpoint çevrildi, model
//     unutuldu) bu HER istekte tekrarlanan sessiz bir arızaya döner; isteği hiç
//     yapmadan adı konmuş bir hata döndürmek hem parayı hem teşhis süresini
//     kurtarır.
// ---------------------------------------------------------------------------

/** Ana modelin de kullandığı endpoint. Anahtar/gövde kuralları buna bakar. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Env'den gelen base URL'i normalize et (sondaki `/` kimliği bozmasın). */
export function resolveCompatBaseUrl(raw: string | undefined): string {
  return (raw?.trim() || OPENAI_BASE_URL).replace(/\/$/, "");
}

/**
 * Kullanılacak anahtar. Özelliğe adanmış anahtar varsa o; yoksa SADECE endpoint
 * OpenAI iken ana hesabın anahtarı. Üçüncü taraf endpoint + adanmış anahtar yok
 * = `undefined` (çağıran fail-closed davranır).
 */
export function resolveCompatKey(dedicated: string | undefined, baseUrl: string): string | undefined {
  const own = dedicated?.trim();
  if (own) return own;
  return baseUrl === OPENAI_BASE_URL ? process.env.OPENAI_API_KEY?.trim() || undefined : undefined;
}

/**
 * Model id'si bu endpoint'e ait mi? Satıcı-ön-ekli slug ("saglayici/model")
 * OpenAI'de yoktur — OpenAI id'leri `/` içermez (ince ayar modelleri bile
 * `ft:gpt-4o:...` biçimindedir). Yanlış eşleşmeyi ağ isteğinden ÖNCE yakalar.
 */
export function compatModelMatchesEndpoint(model: string, baseUrl: string): boolean {
  if (baseUrl !== OPENAI_BASE_URL) return true; // üçüncü taraf: slug normaldir
  return !model.includes("/");
}

export interface CompatModelParams {
  model: string;
  baseUrl: string;
  /** Reasoning OLMAYAN modele verilecek örnekleme sıcaklığı. */
  temperature: number;
  /** Reasoning OLMAYAN model için çıktı tavanı. */
  maxTokens: number;
  /** Reasoning modeli için tavan — gizli düşünme token'larını da kapsar. */
  maxCompletionTokens: number;
}

/** Gövdeye model ailesine ve endpoint'e uygun parametreleri ekler (yerinde). */
export function applyCompatModelParams(
  payload: Record<string, unknown>,
  { model, baseUrl, temperature, maxTokens, maxCompletionTokens }: CompatModelParams,
): Record<string, unknown> {
  if (isReasoningModel(model)) {
    payload.max_completion_tokens = maxCompletionTokens;
  } else {
    payload.temperature = temperature;
    payload.max_tokens = maxTokens;
  }
  // vLLM/GLM-uyumlu endpoint'lerde düşünme kapatılır; OpenAI bu alanı 400'ler.
  if (baseUrl !== OPENAI_BASE_URL) payload.chat_template_kwargs = { enable_thinking: false };
  return payload;
}
