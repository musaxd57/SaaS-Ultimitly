import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI — HİZMET ÜCRETİ SORUSU ÖDEME DEĞİLDİR (kurucu kararı 4.13, 10-28: "Bilgi tabanında yazan hizmet ücreti cevaplansın").
// Bugün "Ekstra yatağın gecelik ücreti ne kadar?" anlama katmanında `payment_invoice` (ödeme / fatura) sayılıyor → öğe hassas → her zaman
// ev sahibinde; bilgi tabanında "Ekstra yatak gecelik 300 TL" yazsa da. Ücret kuralı anahtarı (`AI_KB_FEE_RULE_ENABLED`) cevap istemine
// "bilgi tabanındaki sabit hizmet ücretini koşuluyla söyle" kuralını ekler; AYNI anahtar anlama istemine bu eki ekler: hizmet ücreti sorusu
// hizmetin kendi niyetini alır, ödeme / fatura yalnız NASIL / NEREYE ödeneceği ve ödeme sorunu. İade / iptal / konaklama fiyatı / erken
// giriş - geç çıkış ücreti / evcil hayvan ücreti bugünkü niyetlerinde kalır (ev sahibinde). Kapalıyken istem, önbellek anahtarı ve istek
// gövdesi BAYT BAYT eski.
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
  UNDERSTANDING_PRIVACY_RULE_ADDENDUM,
  UNDERSTANDING_SERVICE_FEE_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
  understandGuestMessages,
  understandingSystemPromptFor,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { evalRuntime, understandingModeLabel } from "../eval/run-meta";

const RAW = {
  language: "tr",
  requests: [{ intent: "amenities", query_tr: "ekstra yatak ücret", query_original: "q" }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};
function modelReturns(content: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
}
const systemOf = (f: ReturnType<typeof modelReturns>, i = 0) =>
  (JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body)) as { messages: { role: string; content: string }[] }).messages.find(
    (m) => m.role === "system",
  )!.content;

beforeEach(() => {
  __resetUnderstandingCache();
  vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-service-fee-000000000000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("istem", () => {
  it("🚨 kapalı: istem bayt bayt eski; açık: ek EN SONDA (öteki eklerle birlikte de)", () => {
    expect(understandingSystemPromptFor({})).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(understandingSystemPromptFor({ serviceFee: false })).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(understandingSystemPromptFor({ serviceFee: true })).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_SERVICE_FEE_ADDENDUM}`);
    const all = understandingSystemPromptFor({ items: true, threat: true, privacy: true, serviceFee: true });
    expect(all.endsWith(UNDERSTANDING_SERVICE_FEE_ADDENDUM)).toBe(true);
    expect(all).toContain(UNDERSTANDING_PRIVACY_RULE_ADDENDUM);
    expect(understandingSystemPromptFor({ items: true, privacy: true })).not.toContain("SERVICE FEES");
  });

  it("ek: hizmet ücreti hizmetin niyetini alır; ödeme / fatura yalnız nasıl / nereye ödeme + ödeme sorunu; para kararları yerinde kalır", () => {
    expect(UNDERSTANDING_SERVICE_FEE_ADDENDUM).toContain("is NOT payment_invoice");
    expect(UNDERSTANDING_SERVICE_FEE_ADDENDUM).toContain("use the intent of the service itself");
    // Ev sahibinde kalanlar açıkça sayılır (kurucu: iade / iptal / ödeme sorunları yine ev sahibinde).
    for (const kept of ["cancellation_refund", "early_checkin", "late_checkout", "pets", "the price of the stay"]) {
      expect(UNDERSTANDING_SERVICE_FEE_ADDENDUM).toContain(kept);
    }
    expect(UNDERSTANDING_SERVICE_FEE_ADDENDUM).toMatch(/how or where to pay/);
  });

  it("örnekler ölçüm setlerinden farklı (ezber yok) — anlama + hizmet ücreti setleri", () => {
    const dir = path.resolve(__dirname, "../../evals");
    const files = readdirSync(dir).filter((f) => /^(understanding-|luna-dev-service-fee)/.test(f) && f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(3);
    const texts: string[] = [];
    for (const f of files) {
      const set = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as {
        scenarios?: { text?: string; message?: string; messages?: (string | { text?: string })[] }[];
      };
      for (const s of set.scenarios ?? []) {
        for (const t of [s.text, s.message, ...(s.messages ?? []).map((m) => (typeof m === "string" ? m : m.text))]) {
          if (typeof t === "string" && t.length >= 24) texts.push(t);
        }
      }
    }
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) expect(UNDERSTANDING_SERVICE_FEE_ADDENDUM).not.toContain(t.slice(0, 24));
  });
});

describe("çağrı (davranışsal — istek gövdesi)", () => {
  it("🚨 ücret kuralı kapalı: modele giden istem eki TAŞIMAZ; açık: taşır, önbellek ayrı girdi", async () => {
    const f = modelReturns(RAW);
    vi.stubGlobal("fetch", f);
    const msg = "Ekstra yatağın gecelik ücreti ne kadar?";
    await understandGuestMessages({ guestMessage: msg });
    expect(systemOf(f, 0)).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "1");
    const second = await understandGuestMessages({ guestMessage: msg });
    expect(second.status === "ok" && second.cached).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
    expect(systemOf(f, 1).endsWith(UNDERSTANDING_SERVICE_FEE_ADDENDUM)).toBe(true);
  });

  it("anahtar yalnız '1' ile açılır (ücret kuralının kendi okuyucusu)", async () => {
    const f = modelReturns(RAW);
    vi.stubGlobal("fetch", f);
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "true");
    await understandGuestMessages({ guestMessage: "Otopark günlük kaç lira?" });
    expect(systemOf(f, 0)).toBe(UNDERSTANDING_SYSTEM_PROMPT);
  });
});

describe("ölçüm koşu kimliği", () => {
  it("kip etiketi 'fee' taşır ve anlama istemi kimliği anahtarla değişir", () => {
    expect(understandingModeLabel({ serviceFee: true })).toBe("fee");
    expect(understandingModeLabel({ items: true, privacy: true, serviceFee: true })).toBe("items+prv+fee");
    const off = evalRuntime().prompts?.understanding;
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "1");
    const on = evalRuntime().prompts?.understanding;
    expect(on).not.toBe(off);
    expect(on).toMatch(/^[0-9a-f]{12}$/);
  });
});
