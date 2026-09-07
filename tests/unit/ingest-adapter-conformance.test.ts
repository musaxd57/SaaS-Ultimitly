import { vi, afterEach, beforeAll } from "vitest";
import { describeIngestConformance, KIT, type IngestHarness, type IngestScenario } from "../helpers/ingest-conformance";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";

// Gerçek istemcinin yeniden deneme uykuları (1s, 2s, 4s) çağrı bütçesine bağlı; test
// hızlı bitsin diye bütçe tek denemeye yetecek kadar daraltılır. Modül sabiti import'ta
// okunuyor → hoisted.
vi.hoisted(() => {
  process.env.HOSPITABLE_CALL_BUDGET_MS = "21000";
});
import { hospitableIngestAdapter } from "@/lib/channels/hospitable-ingest";

// ---------------------------------------------------------------------------
// FAKE — sağlayıcı tarafı doğrudan programlanır.
// ---------------------------------------------------------------------------
describeIngestConformance("ortak fake (tests/helpers/fake-ingest.ts)", () => {
  const fake = new FakeIngestProvider();
  const ORIGINAL_ENV = process.env.HOSPITABLE_API_TOKEN;
  const h: IngestHarness = {
    adapter: fake.adapter(),
    arrange(s: IngestScenario) {
      fake.addProperty(KIT.TOKEN, KIT.PROPERTY, "Test Property");
      const A = canonicalReservation({
        externalId: KIT.RES_A,
        channel: "airbnb",
        status: "confirmed",
        guest: { externalId: "g-1", name: "Alex Guest", email: "alex@example.com", phone: "+900000" },
        conversationExternalId: "conv-A",
        lastMessageAt: new Date("2026-05-30T10:00:00Z"),
      });
      const B = canonicalReservation({
        externalId: KIT.RES_B,
        channel: "booking",
        status: "cancelled",
        terminal: true,
        guest: { externalId: "g-2", name: "Masked Guest", email: null, phone: null },
      });
      switch (s) {
        case "two_reservations":
          fake.setReservations(KIT.PROPERTY, [A, B]);
          break;
        case "duplicate_reservation":
          fake.setReservations(KIT.PROPERTY, [A, A]);
          break;
        case "status_variants":
          fake.setReservations(KIT.PROPERTY, [
            canonicalReservation({ externalId: "v-pending", status: "pending" }),
            canonicalReservation({ externalId: "v-past", status: "completed", terminal: true }),
            canonicalReservation({ externalId: "v-declined", status: "cancelled", terminal: true }),
            canonicalReservation({ externalId: "v-vrbo", channel: "vrbo" }),
          ]);
          break;
        case "messages_unsorted":
          fake.setMessages(KIT.RES_A, [
            canonicalMessage({ externalId: "m-3", createdAt: new Date("2026-05-30T11:00:00Z") }),
            canonicalMessage({ externalId: "m-1", direction: "outbound", senderName: "Ev Sahibi", createdAt: new Date("2026-05-30T09:00:00Z") }),
            canonicalMessage({ externalId: "m-2", createdAt: new Date("2026-05-30T10:00:00Z") }),
          ]);
          break;
        case "message_without_body":
          fake.setMessages(KIT.RES_A, [canonicalMessage({ externalId: "m-1", body: "dolu" }), canonicalMessage({ externalId: "m-2", body: null })]);
          break;
        case "two_pages":
          fake.setReservations(KIT.PROPERTY, ["p1-1", "p1-2", "p2-1"].map((id) => canonicalReservation({ externalId: id })));
          break;
        case "unowned_property":
          fake.setReservations("prop-of-ANOTHER", [A]); // veri var ama bu token görmez
          break;
        case "reject_401": fake.behave({ mode: "reject", status: 401 }); break;
        case "reject_403": fake.behave({ mode: "reject", status: 403 }); break;
        case "reject_404": fake.behave({ mode: "reject", status: 404 }); break;
        case "rate_limit": fake.behave({ mode: "rate_limit", retryAfterSec: 0 }); break;
        case "outage_503": fake.behave({ mode: "outage", status: 503 }); break;
        case "network_down": fake.behave({ mode: "network" }); break;
      }
    },
    attempts: () => fake.requests.length,
    lastToken: () => fake.lastToken(),
    clearAmbientCredentials() {
      delete process.env.HOSPITABLE_API_TOKEN;
    },
    reset() {
      fake.reset();
      if (ORIGINAL_ENV === undefined) delete process.env.HOSPITABLE_API_TOKEN;
      else process.env.HOSPITABLE_API_TOKEN = ORIGINAL_ENV;
    },
  };
  return h;
});

// ---------------------------------------------------------------------------
// GERÇEK Hospitable ingest adaptörü — HTTP katmanı stub'lı. ⚠️ Canlı doğrulama DEĞİL:
// gövde şekilleri Hospitable API v2 belgesine/istemcinin beklediği zarf'a göre
// programlandı; gerçek 401/403/429 gövdeleri canlıda gözlenmedi.
// ---------------------------------------------------------------------------
describeIngestConformance("gerçek Hospitable ingest adaptörü (fetch stub)", () => {
  let scenario: IngestScenario = "two_reservations";
  let attempts = 0;
  let lastAuth: string | undefined;
  const ORIGINAL_ENV = process.env.HOSPITABLE_API_TOKEN;

  const page = (data: unknown[], current: number, last: number) =>
    new Response(JSON.stringify({ data, meta: { current_page: current, last_page: last } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const err = (status: number, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify({ message: `err ${status}` }), { status, headers: { "content-type": "application/json", ...extra } });

  const RAW_A = {
    id: KIT.RES_A,
    code: "HMA1",
    platform: "airbnb",
    status: "accepted",
    arrival_date: "2026-06-01",
    departure_date: "2026-06-05",
    guest: { id: "g-1", first_name: "Alex", last_name: "Guest", email: "alex@example.com", phone: "+900000" },
    conversation_id: "conv-A",
    conversation_language: "en",
    last_message_at: "2026-05-30T10:00:00Z",
  };
  const RAW_B = {
    id: KIT.RES_B,
    platform: "booking.com",
    status: "cancelled",
    arrival_date: "2026-07-01",
    departure_date: "2026-07-03",
    guest: { id: "g-2", full_name: "Masked Guest" },
  };

  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    attempts++;
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    lastAuth = headers.Authorization?.replace(/^Bearer /, "");
    const pageNo = Number(new URL(url).searchParams.get("page") ?? "1");
    switch (scenario) {
      case "two_reservations":
        return page([RAW_A, RAW_B], 1, 1);
      case "duplicate_reservation":
        return page([RAW_A, RAW_A], 1, 1);
      case "status_variants":
        return page(
          [
            { id: "v-pending", platform: "airbnb", status: "request", arrival_date: "2026-06-01", departure_date: "2026-06-02" },
            { id: "v-past", platform: "airbnb", reservation_status: { current: { category: "checked_out" } }, arrival_date: "2026-01-01", departure_date: "2026-01-02" },
            { id: "v-declined", platform: "airbnb", status: "declined", arrival_date: "2026-06-01", departure_date: "2026-06-02" },
            { id: "v-vrbo", platform: "homeaway", status: "accepted", arrival_date: "2026-06-01", departure_date: "2026-06-02" },
          ],
          1,
          1,
        );
      case "messages_unsorted":
        return page(
          [
            { id: "m-3", body: "üçüncü", sender_type: "guest", sender: { full_name: "Alex Guest" }, created_at: "2026-05-30T11:00:00Z" },
            { id: "m-1", body: "cevap", sender_type: "host", sender_role: "host", sender: { full_name: "Ev Sahibi" }, created_at: "2026-05-30T09:00:00Z" },
            { id: "m-2", body: "ikinci", sender_type: "guest", sender: { full_name: "Alex Guest" }, created_at: "2026-05-30T10:00:00Z" },
          ],
          1,
          1,
        );
      case "message_without_body":
        return page(
          [
            { id: "m-1", body: "dolu", sender_type: "guest", sender: { full_name: "Alex Guest" }, created_at: "2026-05-30T09:00:00Z" },
            { id: "m-2", sender_type: "guest", sender: { full_name: "Alex Guest" }, created_at: "2026-05-30T10:00:00Z" },
          ],
          1,
          1,
        );
      case "two_pages":
        return pageNo === 1
          ? page([{ id: "p1-1", platform: "airbnb", status: "accepted", arrival_date: "2026-06-01", departure_date: "2026-06-02" }, { id: "p1-2", platform: "airbnb", status: "accepted", arrival_date: "2026-06-01", departure_date: "2026-06-02" }], 1, 2)
          : page([{ id: "p2-1", platform: "airbnb", status: "accepted", arrival_date: "2026-06-01", departure_date: "2026-06-02" }], 2, 2);
      case "unowned_property":
        return page([], 1, 1); // stub varsayımı (canlıda gözlenmedi)
      case "reject_401": return err(401);
      case "reject_403": return err(403);
      case "reject_404": return err(404);
      case "rate_limit": return err(429, { "Retry-After": "0" });
      case "outage_503": return err(503);
      case "network_down": throw new TypeError("fetch failed");
    }
  });

  beforeAll(() => {
    process.env.HOSPITABLE_API_BASE_URL = "https://public.api.hospitable.test/v2";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const h: IngestHarness = {
    adapter: hospitableIngestAdapter,
    arrange(s) {
      scenario = s;
      vi.stubGlobal("fetch", fetchStub);
    },
    attempts: () => attempts,
    lastToken: () => lastAuth,
    clearAmbientCredentials() {
      delete process.env.HOSPITABLE_API_TOKEN;
    },
    reset() {
      attempts = 0;
      lastAuth = undefined;
      fetchStub.mockClear();
      if (ORIGINAL_ENV === undefined) delete process.env.HOSPITABLE_API_TOKEN;
      else process.env.HOSPITABLE_API_TOKEN = ORIGINAL_ENV;
    },
  };
  return h;
});
