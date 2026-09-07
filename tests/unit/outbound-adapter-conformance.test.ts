import { vi, afterEach } from "vitest";
import { describeOutboundConformance, type ConformanceHarness, type ConformanceScenario } from "../helpers/outbound-conformance";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import { hospitableOutboundAdapter } from "@/lib/channels/hospitable-outbound";

// ---------------------------------------------------------------------------
// AYNI KİT, İKİ ADAPTÖR (V0.2): (1) ortak fake, (2) GERÇEK Hospitable adaptörü —
// yalnız HTTP katmanı (global fetch) stub'lı; `sendMessage` ve `hospitableFetch`
// gerçek. Fake'in gerçekçilik varsayımları böylece gerçek adaptörle doğrulanır:
// biri saparsa bu dosyada iki harness'ten biri kırmızı olur.
// ---------------------------------------------------------------------------

// ── (1) FAKE ────────────────────────────────────────────────────────────────
describeOutboundConformance("ortak fake (tests/helpers/fake-channel.ts)", () => {
  const fake = new FakeOutboundProvider();
  const DEST = "res-conf-1";
  const TOKEN = "tok-conf-SECRET-9f3a";
  const h: ConformanceHarness = {
    adapter: fake.adapter(),
    arrange(s: ConformanceScenario) {
      fake.registerReservation(DEST, TOKEN);
      switch (s) {
        case "succeed": fake.behave({ mode: "succeed" }); break;
        case "reject_404": fake.registerReservation(DEST, "tok-of-ANOTHER-tenant"); break; // sahiplik başkasında → 404
        case "reject_401": fake.behave({ mode: "reject", status: 401 }); break;
        case "reject_422": fake.behave({ mode: "reject", status: 422 }); break;
        case "rate_limit_30": fake.behave({ mode: "rate_limit", retryAfterSec: 30 }); break;
        case "blocked_402": fake.behave({ mode: "blocked" }); break;
        case "outage_503": fake.behave({ mode: "outage", status: 503 }); break;
        case "status_408": fake.behave({ mode: "status_408" }); break;
        case "timeout_lost": fake.behave({ mode: "timeout", delivered: false }); break;
        case "timeout_delivered": fake.behave({ mode: "timeout", delivered: true }); break;
      }
    },
    attempts: () => fake.attempts.length,
    deliveries: () => fake.deliveries.length,
    lastToken: () => fake.lastToken(),
    clearAmbientCredentials() {},
    reset: () => fake.reset(),
  };
  return h;
});

// ── (2) GERÇEK Hospitable adaptörü, fetch stub'lı ────────────────────────────
describeOutboundConformance("gerçek Hospitable adaptörü (fetch stub)", () => {
  let scenario: ConformanceScenario = "succeed";
  let attempts = 0;
  let deliveries = 0;
  let lastAuth: string | undefined;
  let seq = 0;

  const fetchStub = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    attempts++;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    lastAuth = headers.Authorization?.replace(/^Bearer /, "");
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
    switch (scenario) {
      case "succeed":
        deliveries++;
        return json(200, { data: { id: `prov-${++seq}` } });
      case "reject_404": return json(404, { message: "Reservation not found" });
      case "reject_401": return json(401, { message: "Unauthenticated" });
      case "reject_422": return json(422, { message: "Invalid body" });
      case "rate_limit_30": return json(429, { message: "Too Many Attempts" }, { "Retry-After": "30" });
      case "blocked_402": return json(402, { message: "Subscription not active" });
      case "outage_503": return json(503, { message: "Service Unavailable" });
      case "status_408": return json(408, { message: "Request Timeout" });
      case "timeout_lost":
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      case "timeout_delivered":
        deliveries++; // POST sağlayıcıya ULAŞTI, yanıt gelmeden zaman aşımı
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const h: ConformanceHarness = {
    adapter: hospitableOutboundAdapter,
    arrange(s) {
      scenario = s;
    },
    attempts: () => attempts,
    deliveries: () => deliveries,
    lastToken: () => lastAuth,
    clearAmbientCredentials() {
      vi.stubEnv("HOSPITABLE_API_TOKEN", ""); // istemcinin env fallback'i kapalı
    },
    reset() {
      attempts = 0;
      deliveries = 0;
      lastAuth = undefined;
      scenario = "succeed";
      fetchStub.mockClear();
      vi.stubGlobal("fetch", fetchStub);
      vi.stubEnv("HOSPITABLE_API_TOKEN", "");
    },
  };
  return h;
});
