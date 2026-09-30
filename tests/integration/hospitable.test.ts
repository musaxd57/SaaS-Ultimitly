import { describe, it, expect, afterEach, vi } from "vitest";
import {
  listProperties,
  listReservations,
  listMessages,
  sendMessage,
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

  // -------------------------------------------------------------------------
  // ÇAĞRI BAŞINA DUVAR-SAATİ BÜTÇESİ (denetim, 08-01).
  //
  // `Retry-After` tavanı 120 sn ama DENEME BAŞINA: `MAX_RETRIES = 3` ile tek bir
  // çağrı 3 × 120 = 6 DAKİKA uyuyabiliyordu — ve bu uyku SENKRON KİLİDİ
  // TUTULURKEN gerçekleşiyor (TTL 15 dk). Üst üste üç 429'lu istek TTL'i aşıyor,
  // TTL dolunca ikinci bir koşu aynı org için eşzamanlı başlıyor ve tüm duplicate
  // korumasının dayandığı "aynı org iki kez koşmaz" varsayımı deliniyordu.
  // -------------------------------------------------------------------------
  it("BÜYÜK Retry-After'da UYUMAZ: bütçe dolunca 429'u HEMEN fırlatır", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    // 120 sn uyku + 20 sn timeout > 120 sn bütçe → ilk denemede bile sığmaz.
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse("rate limited", { status: 429, headers: { "Retry-After": "120" } }));

    const started = Date.now();
    await expect(listProperties()).rejects.toMatchObject({
      name: "HospitableError",
      status: 429,
      // Sağlayıcının penceresi KORUNUR: outbox worker'ı ona göre erteleyebilsin.
      retryAfterSec: 120,
    });
    // ⬅️ ARIZADA burada 3 × 120 sn uyunurdu (test timeout'una takılırdı).
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // hiçbir tekrar bütçeye sığmadı
  });

  it("bütçeye SIĞAN bekleme normal şekilde uygulanır (regresyon pini)", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse("rate limited", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    await expect(listProperties()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // uyudu ve tekrar denedi
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

  // -------------------------------------------------------------------------
  // CODEX 09-30 (B1): TAM LİSTE YA DA HATA. Okunamayan sayfa ({} / bozuk JSON) eskiden "boş sayfa" sayılıp KISMİ liste tam
  // gibi dönüyordu → senkron thread imlecini ilerletiyor, hayalet rezervasyon temizliği gerçek rezervasyonları silebiliyordu.
  // -------------------------------------------------------------------------
  function brokenJson(): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
      text: async () => '{"data": [{"id": "m3"',
    } as unknown as Response;
  }

  it("🚨 2. sayfa bozuk JSON → mesaj listesi HATA verir, ilk sayfayı tam liste diye DÖNDÜRMEZ", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "m1", body: "a" }, { id: "m2", body: "b" }], meta: { current_page: 1, last_page: 2 } }))
      .mockResolvedValueOnce(brokenJson());

    await expect(listMessages("r1")).rejects.toBeInstanceOf(HospitableError);
  });

  it("🚨 ilk sayfa bozuk JSON → hata (eskiden boş liste = 'thread boş' sayılıyordu)", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch").mockResolvedValueOnce(brokenJson());

    await expect(listMessages("r1")).rejects.toBeInstanceOf(HospitableError);
  });

  it("🚨 zarfsız yanıt ({} / data dizi değil) → hata", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch").mockResolvedValueOnce(jsonResponse({}));
    await expect(listReservations({ propertyIds: ["p1"] })).rejects.toBeInstanceOf(HospitableError);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(jsonResponse({ data: { id: "r1" } }));
    await expect(listReservations({ propertyIds: ["p1"] })).rejects.toBeInstanceOf(HospitableError);
  });

  it("🚨 'daha fazla sayfa var' diyen BOŞ sayfa → hata (meta.last_page ve links.next)", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "r1" }], meta: { current_page: 1, last_page: 3 } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { current_page: 2, last_page: 3 } }));
    await expect(listReservations({ propertyIds: ["p1"] })).rejects.toBeInstanceOf(HospitableError);

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "r1" }], links: { next: "https://x/2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], links: { next: "https://x/3" } }));
    await expect(listReservations({ propertyIds: ["p1"] })).rejects.toBeInstanceOf(HospitableError);
  });

  it("🚨 sayfa tavanı (40) aşılınca hata — sessiz kesme yok", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    let n = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      n += 1;
      return jsonResponse({ data: [{ id: `r${n}` }], meta: { current_page: n, last_page: 999 } });
    });
    await expect(listReservations({ propertyIds: ["p1"] })).rejects.toBeInstanceOf(HospitableError);
    expect(n).toBe(40);
  });

  it("🚨 satır tavanı (10.000) aşılınca hata; tam 10.000 satır ve son sayfa → TAM liste", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}` }));
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: rows(0, 6_000), meta: { current_page: 1, last_page: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ data: rows(6_000, 4_001), meta: { current_page: 2, last_page: 2 } }));
    await expect(listReservations({ propertyIds: ["p1"] })).rejects.toBeInstanceOf(HospitableError);

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: rows(0, 6_000), meta: { current_page: 1, last_page: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ data: rows(6_000, 4_000), meta: { current_page: 2, last_page: 2 } }));
    expect(await listReservations({ propertyIds: ["p1"] })).toHaveLength(10_000);
  });

  it("KONTROL — boş ilk sayfa (gerçekten boş liste) ve zarflı tek sayfa TAM liste döner", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch").mockResolvedValueOnce(jsonResponse({ data: [], meta: { current_page: 1, last_page: 1 } }));
    expect(await listMessages("r1")).toEqual([]);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(jsonResponse({ data: [] }));
    expect(await listMessages("r1")).toEqual([]);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(jsonResponse({ data: [{ id: "m1" }], links: { next: null } }));
    expect(await listMessages("r1")).toHaveLength(1);
  });

  it("KONTROL — gönderimde (POST) okunamayan 2xx gövde teslim sayılır (hata DEĞİL: mesaj gitmiş olabilir, yeniden gönderilmesin)", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch").mockResolvedValueOnce(brokenJson());
    const result = await sendMessage("res-uuid", "Merhaba");
    expect(result.ok).toBe(true);
    expect(result.id).toBeUndefined();
  });

  it("sends a message via POST to the reservation messages endpoint", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse({ data: { id: 555 } }, { status: 201 }));

    const result = await sendMessage("res-uuid", "Merhaba!");

    expect(result.ok).toBe(true);
    expect(result.id).toBe("555");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/reservations/res-uuid/messages");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ body: "Merhaba!" });
  });

  it("returns ok:false (never throws) when a send fails", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "tok");
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse("unprocessable", { status: 422 }));

    const result = await sendMessage("res-uuid", "Hi");

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
