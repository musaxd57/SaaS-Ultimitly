import "server-only";

import { isSecureExternalUrl } from "@/lib/secure-url";

// ---------------------------------------------------------------------------
// Hospitable Public API v2 client
// Docs: https://developer.hospitable.com/docs/public-api-docs
//
// Hospitable connects Airbnb / Booking.com / direct channels and exposes a
// unified API for properties, reservations and guest messaging. We use it to
// (1) pull guest messages into the inbox and (2) send replies back to the
// guest on their original channel (Airbnb, Booking, ...).
//
// Required env var:
//   HOSPITABLE_API_TOKEN — a Personal Access Token (Hospitable → Settings → API)
// Optional:
//   HOSPITABLE_API_BASE_URL — override the API base (defaults to production v2)
//
// Rate limits (enforced by Hospitable):
//   - 2 messages / minute per reservation
//   - 50 requests / 5 minutes globally
// hospitableFetch honours the `Retry-After` header on HTTP 429 and retries with
// exponential backoff on transient (5xx / network) failures, so callers never
// have to think about rate limiting.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://public.api.hospitable.com/v2";
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
/**
 * TEK bir `hospitableFetch` çağrısının TOPLAM duvar-saati bütçesi — tüm denemeler
 * VE tüm uykular dahil (denetim, 08-01).
 *
 * SORUN: `Retry-After` tavanı 120 sn ama DENEME BAŞINA. `MAX_RETRIES = 3` olduğu
 * için tek bir çağrı 3 × 120 = 6 DAKİKA uyuyabiliyordu ve bu uyku SENKRON KİLİDİ
 * TUTULURKEN gerçekleşiyor (TTL 15 dk). Üst üste üç 429'lu istek TTL'i aşıyor,
 * TTL dolunca İKİNCİ bir koşu aynı org için eşzamanlı başlıyor ve tüm duplicate
 * korumasının dayandığı "aynı org iki kez koşmaz" varsayımı deliniyordu.
 * Mülk döngüsü her yinelemede yeni bir istek açtığı için 10 daireli bir hesapta
 * en kötü hâl ~60 dakikaydı.
 *
 * 120 sn seçildi çünkü:
 *   · 5xx/ağ yolunu AYNEN korur (4 × 20 sn timeout + 1+2+4 sn geri çekilme ≈ 87 sn),
 *   · 429 yolunun kötü hâlini ~440 sn → ~140 sn'ye indirir.
 *
 * ⚠️ YENİ BİR HATA SINIFI AÇMAZ: denemeler tükendiğinde zaten AYNI
 * `HospitableError` atılıyordu; bütçe yalnız aynı hatayı DAHA ERKEN getirir.
 * Çağıranlar (senkron döngüsü, outbox) onu bugünkü gibi yakalayıp `continue`
 * eder → "bu turu atla, 2 dakika sonra tekrar dene". `Retry-After` değeri
 * KORUNUR, böylece outbox worker'ı sağlayıcının penceresine erteleyebilir.
 */
const CALL_BUDGET_MS = Number(process.env.HOSPITABLE_CALL_BUDGET_MS) || 120_000;

/** Thrown when the Hospitable API returns an error or is misconfigured. */
export class HospitableError extends Error {
  status?: number;
  /** Parsed `Retry-After` (seconds) on a 429, when the provider sent one. */
  retryAfterSec?: number;
  constructor(message: string, status?: number, retryAfterSec?: number) {
    super(message);
    this.name = "HospitableError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * `Retry-After` (delta-seconds) → sınırlı bekleme süresi.
 *
 * ⚠️ TAVAN 3600 İDİ VE BU BİR DOĞRULUK AÇIĞIYDI (denetim, 07-31). Bu uyku
 * senkron kilidi TUTULURKEN gerçekleşiyor; kilidin TTL'i ise 15 dakika
 * (scheduled-sync.ts). Yani tek bir 429 yanıtı kilidi TTL'in ötesine taşıyabilir,
 * TTL dolunca İKİNCİ bir koşu aynı org için eşzamanlı başlar — ve tüm duplicate
 * korumasının dayandığı "aynı org iki kez koşmaz" varsayımı delinir
 * (`linkProperty` findFirst-sonra-create'i unique kısıt taşımıyor).
 *
 * ⚠️ AMA 120 SANİYE TTL SORUNUNU ÇÖZMEZ — eski yorum bunu "kapandı" diye
 * anlatıyordu ve YANLIŞTI (denetim, 08-01). Tavan DENEME başınadır: `MAX_RETRIES`
 * 3 olduğu için tek bir `hospitableFetch` çağrısı 3 × 120 = 6 DAKİKA uyuyabilir,
 * üst üste üç 429'lu istek 15 dakikalık TTL'i aşar. 120 saniyenin tek yaptığı
 * en kötü hâli 1 saatten 6 dakikaya indirmektir.
 *
 * TTL'i gerçekten koruyan ÜÇ mekanizma AYRI:
 *   · `CALL_BUDGET_MS` — çağrı başına TOPLAM duvar-saati bütçesi (↑yukarıda),
 *   · `withSyncLock`'un in-process `running` bayrağı (tek replikada ulaşılabilir
 *     tek eşzamanlılık yolunu kapatır — scheduled-sync.ts),
 *   · `renewLock` — org döngüsünün her turunda ilerleme-tetikli kilit yenileme.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n, 120);
}

/** True when a Personal Access Token is present in the environment. */
export function isHospitableConfigured(): boolean {
  return Boolean(process.env.HOSPITABLE_API_TOKEN);
}

function baseUrl(): string {
  return (process.env.HOSPITABLE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Low-level authenticated request to the Hospitable API.
 * Resolves with the parsed JSON body, or throws HospitableError after
 * exhausting retries (or immediately for client 4xx errors).
 */
async function hospitableFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  retries = MAX_RETRIES,
): Promise<T> {
  // Multi-tenant: callers pass the connecting org's token. When omitted we fall
  // back to the global env token (legacy single-tenant path + tests).
  const tok = token || process.env.HOSPITABLE_API_TOKEN;
  if (!tok) {
    throw new HospitableError("HOSPITABLE_API_TOKEN .env dosyasında tanımlı değil.");
  }

  // ⚠️ TAM-URL KAÇIŞ KAPISI KALDIRILDI. Eskiden `path` "http" ile başlıyorsa
  // olduğu gibi kullanılıyordu — yani bir gün `links.next` gibi SAĞLAYICIDAN
  // gelen bir değer buraya girse kiracının Bearer token'ı sağlayıcının
  // gösterdiği HERHANGİ bir adrese giderdi. Bugün tüm çağıranlar sabit literal
  // geçiyor ve sayfalama sayfa NUMARASI kullanıyor, yani ulaşılamazdı; kapıyı
  // silmek o "bugün" varsayımını kalıcı hale getirir.
  const url = `${baseUrl()}${path}`;

  // HTTPS-pin (P2): never send the per-tenant Bearer token to an insecure
  // endpoint. Fail BEFORE any network call (no partial send, no retry) — the boot
  // gate already refuses an http HOSPITABLE_API_BASE_URL in production, so this is
  // defence-in-depth. The URL is not included in the error (it can carry a token).
  if (!isSecureExternalUrl(url)) {
    throw new HospitableError("Hospitable API base URL is not https — refused (no token sent).");
  }

  const callStartedAt = Date.now();
  const remainingMs = () => CALL_BUDGET_MS - (Date.now() - callStartedAt);
  /** Uyku + ARDINDAN gelecek denemenin timeout'u bütçeye SIĞIYOR mu? */
  const canAfford = (waitMs: number) => waitMs + TIMEOUT_MS <= remainingMs();

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Network error or timeout — retry with exponential backoff.
      if (attempt < retries && canAfford(2 ** attempt * 1000)) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new HospitableError(`Hospitable'a ulaşılamadı: ${msg}`);
    }

    // Rate limited — wait for the server-provided window, then retry.
    if (res.status === 429 && attempt < retries) {
      const retryAfterSec = parseRetryAfter(res.headers.get("Retry-After"));
      const waitMs = Math.max(0, retryAfterSec ?? 2 ** attempt) * 1000;
      if (!canAfford(waitMs)) {
        // ⚠️ BÜTÇE DOLDU → UYUMA. Bu uyku senkron kilidi TUTULURKEN gerçekleşir;
        // uyumak kilidi TTL'in ötesine taşır ve ikinci bir koşu aynı org için
        // eşzamanlı başlar. `retryAfterSec` KORUNUR: outbox worker'ı sağlayıcının
        // kendi penceresine erteleyebilsin.
        throw new HospitableError(
          "Hospitable hız sınırı (HTTP 429) — çağrı bütçesi doldu, bu tur atlanıyor.",
          429,
          retryAfterSec,
        );
      }
      await sleep(waitMs);
      continue;
    }

    // Transient server error — back off and retry.
    if (res.status >= 500 && attempt < retries && canAfford(2 ** attempt * 1000)) {
      await sleep(2 ** attempt * 1000);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // A 429 that reached here (retries exhausted, e.g. the outbox worker's single-shot
      // send) carries the provider's Retry-After so the caller can defer to its window.
      const retryAfterSec = res.status === 429 ? parseRetryAfter(res.headers.get("Retry-After")) : undefined;
      throw new HospitableError(
        `Hospitable API hatası (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
        res.status,
        retryAfterSec,
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json().catch(() => ({}))) as T;
  }
}

// ---------------------------------------------------------------------------
// Response types (kept intentionally tolerant — the API returns more fields
// than we model; we only declare what we use).
// ---------------------------------------------------------------------------

/** Hospitable list endpoints wrap results in a `{ data, meta, links }` envelope. */
interface ListEnvelope<T> {
  data?: T[];
  meta?: { current_page?: number; last_page?: number };
  links?: { next?: string | null };
}

/** Hard cap on pages to fetch, so a misbehaving endpoint can never loop forever. */
const MAX_PAGES = 40;

/**
 * Fetch every page of a paginated list endpoint and concatenate the results.
 * Stops when an empty page is returned, the last page is reached (per `meta`),
 * or there is no `links.next`. If the endpoint isn't paginated it simply
 * returns the single page.
 */
/**
 * Tek bir listelemeden alınacak EN FAZLA satır sayısı.
 *
 * `MAX_PAGES` sayfa sayısını sınırlıyordu ama sayfa BOYUTUNU sağlayıcı belirler —
 * yani satır sayısının gerçek bir tavanı yoktu. Geçmişi derin bir hesapta "mesajları
 * çek" tek istekte on binlerce satır çekip belleğe alabilir, ardından her satır için
 * DB işlemi koşabilirdi. Bu tavan iki tarafı da sınırlar; kardeş içe-aktarıcılarla
 * (CSV 10.000 satır, iCal 10.000 etkinlik) da aynı büyüklükte.
 */
const MAX_ITEMS = 10_000;

async function fetchAllPages<T>(
  path: string,
  params?: URLSearchParams,
  token?: string,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = new URLSearchParams(params);
    p.set("page", String(page));
    const res = await hospitableFetch<ListEnvelope<T>>(`${path}?${p.toString()}`, {}, token);
    const batch = res.data ?? [];
    items.push(...batch);

    // Satır tavanı: sayfa sayısı değil TOPLAM satır. Sessizce kesiyoruz —
    // fırlatmak, geçmişi derin tek bir hesabın TÜM senkronunu durdururdu.
    if (items.length >= MAX_ITEMS) return items.slice(0, MAX_ITEMS);
    if (batch.length === 0) break;
    const lastPage = res.meta?.last_page;
    if (typeof lastPage === "number") {
      if (page >= lastPage) break;
    } else if (!res.links?.next) {
      break;
    }
  }
  return items;
}

export interface HospitableProperty {
  id: string;
  name: string;
  public_name?: string;
  address?: { city?: string; country?: string; street?: string } | string | null;
}

/**
 * List the properties the token can access. Used by the connection test and
 * to map Hospitable properties onto our own Property records.
 */
export async function listProperties(token?: string): Promise<HospitableProperty[]> {
  return fetchAllPages<HospitableProperty>("/properties", undefined, token);
}

/**
 * Validate a Personal Access Token by listing the properties it can access.
 * Used by the "Connect Hospitable" flow. Returns the property count (or throws
 * HospitableError on an invalid/unauthorized token).
 */
export async function verifyToken(token: string): Promise<{ properties: number }> {
  const props = await fetchAllPages<HospitableProperty>("/properties", undefined, token);
  return { properties: props.length };
}

// Reservations and messages are modelled tolerantly (an index signature) until
// we confirm the exact field names against the live API; the diagnostics probe
// reports their shape so the sync mapping can be written precisely.
export interface HospitableReservation {
  id: string;
  code?: string;
  check_in?: string;
  check_out?: string;
  arrival_date?: string;
  departure_date?: string;
  platform?: string;
  status?: string;
  reservation_status?: { current?: { category?: string } };
  guest?: {
    id?: string | number; // stable per-person guest id (consistent across this guest's reservations)
    name?: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  total_price?: number;
  currency?: string;
  last_message_at?: string | null;
  conversation_id?: string | number;
  conversation_language?: string;
  [key: string]: unknown;
}

export interface HospitableMessage {
  id?: string | number;
  [key: string]: unknown;
}

/**
 * List reservations. Hospitable requires a `properties[]` filter, so pass the
 * property UUIDs to scope the query (optionally narrowed by date range).
 */
export async function listReservations(
  options?: {
    propertyIds?: string[];
    startDate?: string;
    endDate?: string;
  },
  token?: string,
): Promise<HospitableReservation[]> {
  const params = new URLSearchParams();
  for (const id of options?.propertyIds ?? []) params.append("properties[]", id);
  if (options?.startDate) params.set("start_date", options.startDate);
  if (options?.endDate) params.set("end_date", options.endDate);
  // Ask Hospitable to embed the guest record so we get the guest's name (the
  // bare reservation only carries guest COUNTS, not the name).
  params.set("include", "guest");
  return fetchAllPages<HospitableReservation>("/reservations", params, token);
}

/** List the full message thread for a single reservation (all pages). */
export async function listMessages(
  reservationId: string,
  token?: string,
): Promise<HospitableMessage[]> {
  return fetchAllPages<HospitableMessage>(
    `/reservations/${encodeURIComponent(reservationId)}/messages`,
    undefined,
    token,
  );
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** On a 429, the provider's `Retry-After` (seconds) when present — the caller defers to it. */
  retryAfterSec?: number;
}

/**
 * Send a message to the guest on a reservation's thread (delivered on the
 * original channel — Airbnb, Booking, ...). Never throws: returns a result so
 * the caller can decide whether to persist the reply.
 *
 * Endpoint: POST /reservations/{uuid}/messages  body: { body }
 * (Rate limited to 2/min per reservation; hospitableFetch absorbs 429s.)
 */
export async function sendMessage(
  reservationId: string,
  body: string,
  token?: string,
  // The durable outbox passes { retries: 0 } so a POST is attempted EXACTLY ONCE —
  // the worker owns retry/reconcile, and a non-idempotent POST must never be silently
  // re-sent inside the client (that is the in-fetch duplicate window). Omitted → the
  // default retry behaviour (unchanged for every existing caller).
  opts?: { retries?: number },
): Promise<SendResult> {
  if (!reservationId || !body) {
    return { ok: false, error: "reservationId ve body gerekli" };
  }
  try {
    const res = await hospitableFetch<{ data?: { id?: string | number } }>(
      `/reservations/${encodeURIComponent(reservationId)}/messages`,
      { method: "POST", body: JSON.stringify({ body }) },
      token,
      opts?.retries,
    );
    const id = res?.data?.id;
    return { ok: true, id: id != null ? String(id) : undefined };
  } catch (err) {
    const retryAfterSec = err instanceof HospitableError ? err.retryAfterSec : undefined;
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryAfterSec };
  }
}
