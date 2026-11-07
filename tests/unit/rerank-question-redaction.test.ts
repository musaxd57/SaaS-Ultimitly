import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// #211 (gece güvenlik turu, S2 P3 — kodda doğrulandı 09-27): yeniden sıralayıcıya giden misafir metni ÖNCE kırpılıp (1.500
// karakter; önceki mesajların BAŞI) SONRA redakte ediliyordu → kesime denk gelen telefon numarasının parçası ("0532 123 4")
// telefon kalıbına uymayıp OpenAI'ye açık gidiyordu. Artık her mesaj önce redakte edilir, sonra birleştirilip kırpılır. PII
// taşımayan metinde istem BAYT BAYT aynı (ölçer önbelleği etkilenmez).
// ---------------------------------------------------------------------------

const users: string[] = [];
vi.mock("@/lib/ai/semantic/structured-call", () => ({
  callStructuredJson: vi.fn(async (input: { user: string }) => {
    users.push(input.user);
    return { ok: true, data: { answers: [], related: [] }, ms: 10 };
  }),
}));

import { prepareRerankScores, rerankQuestionText, RERANK_QUESTION_CHARS } from "@/lib/ai/semantic/rerank";

const T0 = Date.UTC(2026, 0, 1);
const item = (id: string, content: string) => ({ id, category: "general", title: id, content, updatedAt: new Date(T0) });
const items = [item("a", "Otopark bina önünde."), item("b", "Wifi şifresi kartta.")];
const candidates = [[{ key: "a#0" }, { key: "b#0" }]];
const PHONE = "0532 123 45 67";

beforeEach(() => {
  users.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "sk-test-rerank-0000000000000000");
  vi.stubEnv("AI_SEMANTIC_API_KEY", "");
  vi.stubEnv("AI_SEMANTIC_MODEL", "");
  vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
  vi.stubEnv("KB_RERANK_PER_QUESTION", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("yeniden sıralayıcıya giden soru önce redakte, sonra kırpılır", () => {
  it("🚨 güncel mesajda kesime denk gelen telefon numarasının hiçbir parçası isteme gitmez", async () => {
    const prefix = "otopark ".repeat(Math.ceil(RERANK_QUESTION_CHARS / 8)).slice(0, RERANK_QUESTION_CHARS - 6);
    const guestMessage = `${prefix} ${PHONE} numarasından arayın`;
    expect(guestMessage.indexOf(PHONE)).toBeLessThan(RERANK_QUESTION_CHARS);
    expect(guestMessage.indexOf(PHONE) + PHONE.length).toBeGreaterThan(RERANK_QUESTION_CHARS);
    await prepareRerankScores({ items, guestMessage, candidates });
    expect(users).toHaveLength(1);
    expect(users[0]).not.toMatch(/0532|123 4/);
  });

  it("🚨 önceki cevapsız mesajın BAŞI kırpılırken yarım kalan telefon numarası da gitmez", async () => {
    // Kalan yer 25 karakter → önceki mesaj numaranın ortasından kırpılır: " 123 45 67 lütfen arayın."
    const current = "q".repeat(RERANK_QUESTION_CHARS - 26);
    const earlier = `Numaram ${PHONE} lütfen arayın.`;
    expect(RERANK_QUESTION_CHARS - current.length - 1).toBe(25);
    expect(earlier.slice(earlier.length - 25)).toBe(" 123 45 67 lütfen arayın.");
    await prepareRerankScores({ items, guestMessage: current, pending: [earlier], candidates });
    expect(users).toHaveLength(1);
    expect(users[0]).not.toMatch(/45 67|123 45/);
  });

  it("KONTROL — PII taşımayan metinde soru metni BİREBİR eskisi (kırpma kuralı aynı)", async () => {
    const guestMessage = "Otopark nerede? Wifi şifresi ne?";
    await prepareRerankScores({ items, guestMessage, pending: ["Merhaba, iyi akşamlar."], candidates });
    expect(users[0]).toContain(rerankQuestionText(guestMessage, ["Merhaba, iyi akşamlar."]));
  });
});
