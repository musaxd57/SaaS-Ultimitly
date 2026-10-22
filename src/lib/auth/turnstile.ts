import "server-only";

// ---------------------------------------------------------------------------
// KAYIT FORMUNDA CLOUDFLARE TURNSTILE (kurucu 10-22 U15: "Ya gerçekten 300 kişi kayıt olursa onu doğru şekilde çözelim claudeflare kesin
// olsun"). Sert kayıt tavanı YOK — gerçek kalabalık reddedilmez; bot kaydı formda insan doğrulamasıyla kesilir. Anahtar KAPALI
// (`SIGNUP_TURNSTILE_ENABLED`): açmak = Cloudflare panelinde site anahtarı + gizli anahtar, env'e ikisi, gizlilik metnine Cloudflare
// (ziyaretçinin tarayıcısı Cloudflare'e bağlanır), ilk denemeler kurucuyla.
//
// Karar kuralları:
//   · Anahtar açık ama iki anahtardan biri eksik → doğrulama YOK (yanlış yapılandırma bütün kayıtları kilitlemesin); açılış uyarısı basar.
//   · Cloudflare "geçmedi" derse (success:false, eylem adı uyuşmuyor, belirteç yok) → kayıt REDDEDİLİR.
//   · Cloudflare'e ulaşılamazsa (ağ hatası, zaman aşımı, 5xx, okunamayan cevap) → kayıt GEÇER + hata kaydı. Cloudflare kesintisi bütün
//     kayıtları durdurmaz; IP başına saatlik kova ve doğrulama e-postası yayma (email-outbox) yine çalışır.
// Belirteç tek kullanımlıktır (Cloudflare tarafında); ikinci gönderimde success:false döner.
// ---------------------------------------------------------------------------

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Formdaki widget'ın `action` adı; doğrulamada aynısı beklenir (başka sayfanın belirteci kayıtta geçmez). */
export const TURNSTILE_REGISTER_ACTION = "register";
const VERIFY_TIMEOUT_MS = 5_000;
const MAX_TOKEN_LENGTH = 2048;

function keys(): { siteKey: string; secret: string } | null {
  if (process.env.SIGNUP_TURNSTILE_ENABLED !== "1") return null;
  const siteKey = (process.env.TURNSTILE_SITE_KEY ?? "").trim();
  const secret = (process.env.TURNSTILE_SECRET_KEY ?? "").trim();
  return siteKey && secret ? { siteKey, secret } : null;
}

/** Kayıt formuna verilecek site anahtarı; anahtar kapalı ya da yapılandırma eksikse null (widget çizilmez, sunucu da doğrulamaz). */
export function turnstileSiteKey(): string | null {
  return keys()?.siteKey ?? null;
}

export type TurnstileVerdict = "ok" | "rejected" | "unavailable" | "disabled";

export interface TurnstileDeps {
  fetch?: typeof fetch;
}

/** Sunucu tarafı doğrulama. `ip` Cloudflare'e ek sinyal olarak gider (isteğe bağlı). */
export async function verifyTurnstileToken(
  token: unknown,
  ip: string | null,
  deps: TurnstileDeps = {},
): Promise<TurnstileVerdict> {
  const k = keys();
  if (!k) return "disabled";
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return "rejected";
  const body = new URLSearchParams({ secret: k.secret, response: token });
  if (ip) body.set("remoteip", ip);
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    return "unavailable";
  }
  if (!res.ok) return "unavailable";
  let data: { success?: unknown; action?: unknown } | null;
  try {
    data = (await res.json()) as { success?: unknown; action?: unknown } | null;
  } catch {
    return "unavailable";
  }
  if (!data || typeof data !== "object") return "unavailable";
  if (data.success !== true) return "rejected";
  // Eylem adı Cloudflare cevabında varsa birebir uymalı (başka bir formun belirteci kayıtta kullanılamaz).
  if (data.action !== undefined && data.action !== TURNSTILE_REGISTER_ACTION) return "rejected";
  return "ok";
}
