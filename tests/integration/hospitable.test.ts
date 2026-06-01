import { describe, it, expect, afterEach, vi } from "vitest";
import {
  listProperties,
  listReservations,
  listMessages,
  HospitableError,
} from "@/lib/hospitable";

/** Build a minimal fetch Response stub. */
function jsonResponse(body: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers(init.headers),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("hospitable client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("throws when no token is configured", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "");
    await expect(listProperties()).rejects.toThrow(/HOSPITABLE_API_TOKEN/);
  });

  it("sends a Bearer auth header and parses the data envelope", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "secret-token");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ data: [{ id: "p1", name: "Daire 1" }, { id: "p2", name: "Daire 2" }] }),
    );

    const props = await listProperties();

    expect(props).toHaveLength(2);
    expect(props[0]).toMatchObject({ id: "p1", name: "Daire 1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/properties");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("retries on HTTP 429 honouring Retry-After, then succeeds", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse("rate limited", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "p1", name: "Daire 1" }] }));

    const props = await listProperties();

    expect(props).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws HospitableError with the HTTP status on a 4xx error", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse("Unauthenticated", { status: 401 }));

    await expect(listProperties()).rejects.toMatchObject({
      name: "HospitableError",
      status: 401,
    });
    await expect(listProperties()).rejects.toBeInstanceOf(HospitableError);
  });

  it("lists reservations from the /reservations endpoint", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse({ data: [{ id: "r1", platform: "airbnb" }] }));

    const reservations = await listReservations({ propertyIds: ["prop-uuid-1"] });

    expect(reservations).toHaveLength(1);
    expect(reservations[0].id).toBe("r1");
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/reservations");
    expect(calledUrl).toContain("properties");
    expect(calledUrl).toContain("prop-uuid-1");
  });

  it("lists messages for a reservation at the nested messages endpoint", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse({ data: [{ id: "m1", body: "hi" }] }));

    const messages = await listMessages("r1");

    expect(messages).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/reservations/r1/messages");
  });

  it("fetches every page when meta.last_page indicates more", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "p1", name: "A" }], meta: { current_page: 1, last_page: 2 } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "p2", name: "B" }], meta: { current_page: 2, last_page: 2 } }),
      );

    const props = await listProperties();

    expect(props).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });
});
