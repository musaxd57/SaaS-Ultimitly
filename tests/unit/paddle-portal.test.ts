import { describe, it, expect, afterEach, vi } from "vitest";
import { createPortalSession } from "@/lib/payments/paddle";

// Unit-test the customer-portal link parsing against the Paddle API response
// shape, with fetch mocked (no network). The route-level gating is covered in
// tests/integration/billing-portal-route.test.ts.
describe("createPortalSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // stubEnv restores the .env-provided value on unstub — a raw `delete` would
    // wipe it and leak "Paddle unconfigured" into later test files (flaky).
    vi.unstubAllEnvs();
  });

  function mockPaddle(subResp: unknown, portalResp: unknown) {
    return vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/portal-sessions") ? portalResp : subResp;
      return { json: async () => body } as Response;
    });
  }

  it("returns overview + cancel links from the Paddle API shape", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    mockPaddle(
      { data: { customer_id: "ctm_1" } },
      {
        data: {
          urls: {
            general: { overview: "https://portal/overview" },
            subscriptions: [{ id: "sub_1", cancel_subscription: "https://portal/cancel" }],
          },
        },
      },
    );
    expect(await createPortalSession("sub_1")).toEqual({
      overview: "https://portal/overview",
      cancel: "https://portal/cancel",
    });
  });

  it("returns overview with null cancel when no matching subscription deep link", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    mockPaddle(
      { data: { customer_id: "ctm_1" } },
      { data: { urls: { general: { overview: "https://portal/overview" }, subscriptions: [] } } },
    );
    expect(await createPortalSession("sub_1")).toEqual({ overview: "https://portal/overview", cancel: null });
  });

  it("returns null when the subscription has no customer_id", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    mockPaddle({ data: {} }, {});
    expect(await createPortalSession("sub_1")).toBeNull();
  });

  it("returns null when Paddle is not configured (no API key) and never calls the API", async () => {
    vi.stubEnv("PADDLE_API_KEY", ""); // force-unconfigured regardless of .env
    const spy = vi.spyOn(global, "fetch");
    expect(await createPortalSession("sub_1")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("never throws — returns null when the overview url is missing", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    mockPaddle({ data: { customer_id: "ctm_1" } }, { data: { urls: {} } });
    expect(await createPortalSession("sub_1")).toBeNull();
  });
});
