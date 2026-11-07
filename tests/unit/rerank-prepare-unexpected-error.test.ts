import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// A6 #5 (09-27, kodda doğrulandı): `prepareRerankScores`in genel `catch {}`i programlama hatasını sessizce `failed, ms: 0` diye
// yazıyordu (ağ / model arızası zaten `llmRerank` içinde sınıflanır, buraya düşmez). Artık kısıtlı bildirim gider; misafirin yolu
// yine bugünkü sıra (fırlatmaz).
// ---------------------------------------------------------------------------

const reported = vi.fn(async () => ({ sent: false }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: (...args: unknown[]) => reported(...(args as [])),
}));

import { prepareRerankScores } from "@/lib/ai/semantic/rerank";

describe("yeniden sıralayıcı hazırlığında beklenmedik hata", () => {
  it("🚨 fırlatmaz, 'failed' döner ve BİLDİRİLİR", async () => {
    const out = await prepareRerankScores({ items: null as never, guestMessage: "Otopark?", candidates: [[{ key: "a#0" }, { key: "b#0" }]] });
    expect(out).toEqual({ status: "failed", ms: 0 });
    expect(reported).toHaveBeenCalledTimes(1);
    expect((reported.mock.calls[0] as unknown[])[0]).toBe("kb-rerank-prepare");
  });
});
