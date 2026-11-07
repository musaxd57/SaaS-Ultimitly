import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// KIDEMLİ OKUYUCU — HİZMET ÜCRETİNİ SÖYLEMEK PLATFORM DIŞI ÖDEME DEĞİLDİR (kurucu kararı 4.13, 10-28: "Bilgi tabanında yazan hizmet ücreti
// cevaplansın"). Canlı ölçüm (fee413-parts): "Bebek yatağı ve mama sandalyesini getirebiliyoruz; ikisi birlikte 250 TL'dir." gibi 7 taslakta
// okuyucu "ev sahibine platform dışı ödeme" dedi ve cevap tutuldu — taslak ödemenin nasıl / nereye yapılacağını hiç söylemiyordu. Ücret
// kuralı anahtarıyla (`AI_KB_FEE_RULE_ENABLED`) istem bir açıklama satırı alır; kapalıyken istem ve istek gövdesi BAYT BAYT eski. Elden /
// havale / bağlantı / kapıda ödeme isteyen taslak yine "platform dışı ödeme"dir (satır bunu açıkça korur).
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import {
  SENIOR_READER_FEE_LINE,
  SENIOR_READER_SYSTEM_PROMPT,
  runAbsenceJudge,
  seniorReaderSystemPrompt,
} from "@/lib/ai/semantic/absence-judge";

afterEach(() => vi.unstubAllEnvs());

const FULL = {
  admits_missing_info: false,
  quote: "",
  pays_host_off_platform: false,
  payment_quote: "",
  off_platform_contact: false,
  contact_quote: "",
  apology_or_fault: false,
  apology_quote: "",
  names_internal_source: false,
  source_quote: "",
};
const reply = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }));
const systemOf = (f: ReturnType<typeof vi.fn>, i: number) =>
  (JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body)) as { messages: { content: string }[] }).messages[0].content;

describe("istem", () => {
  it("🚨 kapalı: istem bayt bayt eski; açık: satır ödeme tanımının hemen ardında", () => {
    expect(seniorReaderSystemPrompt({ feeRule: false })).toBe(SENIOR_READER_SYSTEM_PROMPT);
    const on = seniorReaderSystemPrompt({ feeRule: true });
    expect(on).not.toBe(SENIOR_READER_SYSTEM_PROMPT);
    expect(on).toContain(SENIOR_READER_FEE_LINE);
    expect(on.replace(`${SENIOR_READER_FEE_LINE}\n`, "")).toBe(SENIOR_READER_SYSTEM_PROMPT);
    expect(on.indexOf(SENIOR_READER_FEE_LINE)).toBeGreaterThan(on.indexOf("pays_host_off_platform = false when the payment goes to a THIRD PARTY"));
    expect(on.indexOf(SENIOR_READER_FEE_LINE)).toBeLessThan(on.indexOf("off_platform_contact = true"));
  });

  it("satır: yalnız fiyat söylemek ödeme değildir; elden / havale / bağlantı / kapıda isteyen yine ödemedir", () => {
    expect(SENIOR_READER_FEE_LINE).toMatch(/only states the price/);
    expect(SENIOR_READER_FEE_LINE).toMatch(/without saying how or where to pay/);
    expect(SENIOR_READER_FEE_LINE).toMatch(/still true when the draft also asks/);
  });

  it("satır ölçüm setlerindeki taslakları ezberlemez", () => {
    for (const f of ["airbnb-fee-statements.json", "airbnb-message-policy.json"]) {
      const set = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals", f), "utf8")) as { cases: { draft: string }[] };
      for (const c of set.cases) expect(SENIOR_READER_FEE_LINE).not.toContain(c.draft.slice(0, 28));
    }
  });
});

describe("çağrı (davranışsal — istek gövdesi)", () => {
  it("🚨 ücret kuralı kapalı: okuyucu eski istemi gönderir; açık: satırlı istemi (iki okumada da)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    const off = vi.fn(async () => reply(FULL));
    await runAbsenceJudge({ guestMessage: "q", reply: "r", senior: true, fetchImpl: off as unknown as typeof fetch });
    for (const i of [0, 1]) expect(systemOf(off, i)).toBe(SENIOR_READER_SYSTEM_PROMPT);
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "1");
    const on = vi.fn(async () => reply(FULL));
    await runAbsenceJudge({ guestMessage: "q", reply: "r", senior: true, fetchImpl: on as unknown as typeof fetch });
    for (const i of [0, 1]) expect(systemOf(on, i)).toBe(seniorReaderSystemPrompt({ feeRule: true }));
  });

  it("bilgim-yok hakemi (okuyucu kapalı) ücret anahtarından etkilenmez", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "1");
    const f = vi.fn(async () => reply({ admits_missing_info: false, quote: "" }));
    await runAbsenceJudge({ guestMessage: "q", reply: "r", senior: false, fetchImpl: f as unknown as typeof fetch });
    expect(systemOf(f, 0)).not.toContain(SENIOR_READER_FEE_LINE);
  });
});
