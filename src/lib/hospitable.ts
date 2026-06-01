import "server-only";

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

/** Thrown when the Hospitable API returns an error or is misconfigured. */
export class HospitableError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HospitableError";
    this.status = status;
  }
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
  retries = MAX_RETRIES,
): Promise<T> {
  const token = process.env.HOSPITABLE_API_TOKEN;
  if (!token) {
    throw new HospitableError("HOSPITABLE_API_TOKEN .env dosyasında tanımlı değil.");
  }

  const url = path.startsWith("http") ? path : `${baseUrl()}${path}`;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Network error or timeout — retry with exponential backoff.
      if (attempt < retries) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new HospitableError(`Hospitable'a ulaşılamadı: ${msg}`);
    }

    // Rate limited — wait for the server-provided window, then retry.
    if (res.status === 429 && attempt < retries) {
      const retryAfter = res.headers.get("Retry-After");
      const waitSec =
        retryAfter !== null && retryAfter !== "" && Number.isFinite(Number(retryAfter))
          ? Number(retryAfter)
          : 2 ** attempt;
      await sleep(Math.max(0, waitSec) * 1000);
      continue;
    }

    // Transient server error — back off and retry.
    if (res.status >= 500 && attempt < retries) {
      await sleep(2 ** attempt * 1000);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HospitableError(
        `Hospitable API hatası (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
        res.status,
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

/** Hospitable list endpoints wrap results in a `{ data: [...] }` envelope. */
interface ListEnvelope<T> {
  data?: T[];
}

export interface HospitableProperty {
  id: string;
  name: string;
  public_name?: string;
  address?: { city?: string; country?: string; street?: string } | string | null;
}

/**
 * List the properties the token can access. Used by the connection test and,
 * later, to map Hospitable properties onto our own Property records.
 */
export async function listProperties(): Promise<HospitableProperty[]> {
  const res = await hospitableFetch<ListEnvelope<HospitableProperty>>("/properties");
  return res.data ?? [];
}

// Reservations and messages are modelled tolerantly (an index signature) until
// we confirm the exact field names against the live API; the diagnostics probe
// reports their shape so the sync mapping can be written precisely.
export interface HospitableReservation {
  id: string;
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
export async function listReservations(options?: {
  propertyIds?: string[];
  startDate?: string;
  endDate?: string;
}): Promise<HospitableReservation[]> {
  const params = new URLSearchParams();
  for (const id of options?.propertyIds ?? []) params.append("properties[]", id);
  if (options?.startDate) params.set("start_date", options.startDate);
  if (options?.endDate) params.set("end_date", options.endDate);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await hospitableFetch<ListEnvelope<HospitableReservation>>(`/reservations${qs}`);
  return res.data ?? [];
}

/** List the message thread for a single reservation. */
export async function listMessages(reservationId: string): Promise<HospitableMessage[]> {
  const res = await hospitableFetch<ListEnvelope<HospitableMessage>>(
    `/reservations/${encodeURIComponent(reservationId)}/messages`,
  );
  return res.data ?? [];
}
