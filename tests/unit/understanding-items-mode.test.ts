import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI — KONUŞMA ÖĞELERİ KİPİ (09-26, `AI_CONVERSATION_ITEMS_ENABLED`). Her istek hangi cevapsız mesajdan
// (`message`) + misafirin vazgeçtiği istekler (`withdrawn`). Bayrak kapalıyken şema / istem / önbellek anahtarı / çözücü
// çıktısı BAYT BAYT eski (mevcut `understanding.test.ts` pinleri + burada ayrıca).
// ---------------------------------------------------------------------------
vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: vi.fn(async () => {}),
  noteModelProviderSuccess: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import {
  UNDERSTANDING_INTENTS,
  UNDERSTANDING_JSON_SCHEMA,
  UNDERSTANDING_JSON_SCHEMA_ITEMS,
  parseUnderstanding,
  understandingWindow,
} from "@/lib/ai/semantic/understanding-schema";
import {
  UNDERSTANDING_ITEMS_PROMPT_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
  buildUnderstandingUserContent,
  understandGuestMessages,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { NOT_FULLY_READ_MARGIN } from "@/lib/early-checkin/workflow";

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
const RAW_ITEMS = {
  language: "tr",
  requests: [
    { intent: "payment_invoice", query_tr: "ödeme yöntemi", query_original: "ödeme yöntemi", message: 1 },
    { intent: "wifi", query_tr: "wifi şifresi", query_original: "wifi şifresi", message: 2 },
  ],
  stay_change: STAY_NONE,
  withdrawn: [],
};

function modelReturns(content: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
}
const bodyOf = (f: ReturnType<typeof modelReturns>, i = 0) =>
  JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body));

beforeEach(() => __resetUnderstandingCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("öğe kipi şeması", () => {
  it("temel şemadan türetilir; strict; her alan zorunlu; temel şema DEĞİŞMEZ", () => {
    const s = UNDERSTANDING_JSON_SCHEMA_ITEMS.schema;
    expect(UNDERSTANDING_JSON_SCHEMA_ITEMS.strict).toBe(true);
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    const item = s.properties.requests.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.properties.message).toEqual({ type: "integer" });
    expect(item.properties.intent.enum).toEqual([...UNDERSTANDING_INTENTS]);
    const w = s.properties.withdrawn.items;
    expect([...w.required].sort()).toEqual(Object.keys(w.properties).sort());
    expect(w.properties.intent.enum).toEqual([...UNDERSTANDING_INTENTS]);
    // Temel şema öğe alanlarını TAŞIMAZ (kapalıyken bayt bayt eski).
    expect(Object.keys(UNDERSTANDING_JSON_SCHEMA.schema.properties)).not.toContain("withdrawn");
    expect(Object.keys(UNDERSTANDING_JSON_SCHEMA.schema.properties.requests.items.properties)).not.toContain("message");
  });
});

describe("çözücü", () => {
  it("öğe kipinde mesaj numarası ve vazgeçmeler okunur", () => {
    const u = parseUnderstanding({ ...RAW_ITEMS, withdrawn: [{ intent: "early_checkin", message: 0 }] }, { items: true });
    expect(u?.requests.map((r) => [r.intent, r.message])).toEqual([
      ["payment_invoice", 1],
      ["wifi", 2],
    ]);
    expect(u?.withdrawn).toEqual([{ intent: "early_checkin", message: 0 }]);
  });

  it("geçersiz numara isteği DÜŞÜRMEZ, numarasız bırakır (sinyal kaybolmasın)", () => {
    const u = parseUnderstanding(
      {
        ...RAW_ITEMS,
        requests: [
          { intent: "complaint_issue", query_tr: "", query_original: "", message: 0 },
          { intent: "wifi", query_tr: "wifi", query_original: "wifi", message: 1.5 },
          { intent: "parking", query_tr: "otopark", query_original: "otopark", message: "2" },
          { intent: "pets", query_tr: "evcil", query_original: "evcil" },
        ],
      },
      { items: true },
    );
    expect(u?.requests.map((r) => r.intent)).toEqual(["complaint_issue", "wifi", "parking", "pets"]);
    expect(u?.requests.every((r) => r.message === undefined)).toBe(true);
  });

  it("geçersiz vazgeçme kaydı düşer; aynı kayıt tekilleşir; alan yoksa boş liste", () => {
    const u = parseUnderstanding(
      {
        ...RAW_ITEMS,
        withdrawn: [
          { intent: "early_checkin", message: 1 },
          { intent: "early_checkin", message: 1 },
          { intent: "EARLY", message: 1 },
          { intent: "wifi", message: -1 },
          { intent: "wifi", message: 1.2 },
          { intent: "wifi" },
          "wifi",
          null,
        ],
      },
      { items: true },
    );
    expect(u?.withdrawn).toEqual([{ intent: "early_checkin", message: 1 }]);
    const { withdrawn: _drop, ...noWithdrawn } = RAW_ITEMS;
    expect(parseUnderstanding(noWithdrawn, { items: true })?.withdrawn).toEqual([]);
  });

  it("KAPALIYKEN çıktı bayt bayt eski: ham veride alanlar olsa bile mesaj numarası / vazgeçme YOK", () => {
    const u = parseUnderstanding({ ...RAW_ITEMS, withdrawn: [{ intent: "wifi", message: 1 }] });
    expect(u).toEqual({
      language: "tr",
      requests: [
        { intent: "payment_invoice", queryTr: "ödeme yöntemi", queryOriginal: "ödeme yöntemi" },
        { intent: "wifi", queryTr: "wifi şifresi", queryOriginal: "wifi şifresi" },
      ],
      stay: { requested: false, kind: "none", checkinTime: null, checkoutTime: null },
    });
    expect(Object.keys(u!)).not.toContain("withdrawn");
  });
});

describe("pencere — istem ile öğe eşlemesi AYNI liste", () => {
  const history = [
    { id: "m1", direction: "inbound" as const, body: "Merhaba" },
    { id: "m2", direction: "outbound" as const, body: "Hoş geldiniz" },
    { id: "m3", direction: "inbound" as const, body: "IBAN'ınızı atar mısınız?" },
    { id: "m4", direction: "inbound" as const, body: "  " },
    { id: "m5", direction: "inbound" as const, body: "Bir de Wi-Fi şifresi neydi?" },
  ];

  it("[n] numaraları pencerenin cevapsız listesiyle birebir (boş gövde atlanır, kimlik taşınır)", () => {
    const win = understandingWindow(history, "Bir de Wi-Fi şifresi neydi?");
    expect(win.unanswered.map((m) => m.id)).toEqual(["m3", "m5"]);
    expect(win.unseen).toBe(0);
    const content = buildUnderstandingUserContent({ guestMessage: "Bir de Wi-Fi şifresi neydi?", history });
    expect(content).toContain("[1] <<<IBAN'ınızı atar mısınız?>>>");
    expect(content).toContain("[2] <<<Bir de Wi-Fi şifresi neydi?>>>");
    expect(content).not.toContain("m3");
  });

  it("güncel mesaj geçmişte yoksa kimliksiz eklenir; tavan aşılırsa görülmeyenler sayılır", () => {
    expect(understandingWindow([], "Selam").unanswered).toEqual([{ id: undefined, body: "Selam", at: undefined }]);
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, direction: "inbound" as const, body: `soru ${i}` }));
    const win = understandingWindow(many, "soru 6");
    expect(win.unanswered.map((m) => m.id)).toEqual(["g2", "g3", "g4", "g5", "g6"]);
    expect(win.unseen).toBe(2);
  });

  it("uzunluk payı tek kaynak (erken giriş akışı aynı sabiti kullanır)", () => {
    expect(NOT_FULLY_READ_MARGIN).toBe(100);
  });
});

describe("çağrı — öğe kipi ayrı şema, istem eki ve önbellek girdisi", () => {
  it("items: true → öğe şeması + istem eki; aynı içerik kapalı kipte AYRI çağrı (önbellek karışmaz)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = modelReturns(RAW_ITEMS);
    const on = await understandGuestMessages({ guestMessage: "IBAN? Wi-Fi?", items: true, fetchImpl: f });
    expect(on.status).toBe("ok");
    expect(bodyOf(f).response_format).toEqual({ type: "json_schema", json_schema: UNDERSTANDING_JSON_SCHEMA_ITEMS });
    expect(bodyOf(f).messages[0].content).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ITEMS_PROMPT_ADDENDUM}`);
    expect(on.status === "ok" && on.value.withdrawn).toEqual([]);

    const off = await understandGuestMessages({ guestMessage: "IBAN? Wi-Fi?", fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).response_format).toEqual({ type: "json_schema", json_schema: UNDERSTANDING_JSON_SCHEMA });
    expect(bodyOf(f, 1).messages[0].content).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(off.status === "ok" && Object.keys(off.value)).not.toContain("withdrawn");
  });

  it("karar noktası kb-retrieve: bayrak açıkken öğe kipi, kapalıyken temel şema", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = modelReturns(RAW_ITEMS);
    vi.stubGlobal("fetch", f);
    const base = { items: [], guestMessage: "IBAN? Wi-Fi?", history: [] };
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
    __resetUnderstandingCache();
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 1).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA_ITEMS);
    // Yalnız tam "1" açar.
    __resetUnderstandingCache();
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "true");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 2).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
  });
});
