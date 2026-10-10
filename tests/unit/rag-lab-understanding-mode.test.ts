import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// RAG LAB — ANLAMA KİPİ ÜRETİMİN KARAR NOKTASIYLA AYNI BAYRAKLARDAN (10-10, Haiku incelemesi + kodda doğrulandı).
// Lab anlama katmanını SABİT "öğe + kural" kipiyle çağırıyordu; canlıda şikâyet takibi (`AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1`) de açık →
// ölçülen istem canlınınki değildi. Üstelik rapor kimliği (`evalRuntime`) kipi bayraklardan hesaplıyor, koşular "kip: items" yazıp
// "öğe + kural" ile koşuyordu (10-01'deki kimlik hatasının ikizi). Artık kip `kb-retrieve.ts` ile aynı dört bayraktan; 10-10 öncesi
// koşuların kipi (öğe + kural, ± İngilizce köprü) ESKİ önbellek anahtarıyla okunur (kredi boşa gitmesin), başka her kip istemin özetiyle.
// ---------------------------------------------------------------------------

// Anlama çağrısı gerçeğe devreden casusla sarılır: modele giden kip görünür (ağ yok — sahte cevap).
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return {
    ...actual,
    understandGuestMessages: vi.fn(async () => ({
      status: "ok" as const,
      value: { language: "tr" as const, requests: [], stay: { requested: false, kind: "none" as const, checkinTime: null, checkoutTime: null } },
      ms: 1,
      cached: false,
    })),
  };
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as core from "../eval/rag-lab/core";
import { digest } from "../eval/rag-lab/cache";
import { evalRuntime, understandingModeLabel } from "../eval/run-meta";
import { UNDERSTANDING_ENGLISH_QUERY_ADDENDUM, understandingSystemPromptFor } from "@/lib/ai/semantic/understand";

afterEach(() => vi.unstubAllEnvs());

function flags(on: { items?: boolean; rules?: boolean; cfu?: boolean; en?: boolean }) {
  vi.stubEnv("OPENAI_API_KEY", "sk-unit-test-key-xxxxxxxxxxxxxxxx");
  vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
  vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", on.items ? "1" : "");
  vi.stubEnv("AI_HOUSE_RULES_SHADOW", on.rules ? "1" : "");
  vi.stubEnv("AI_COMPLAINT_FOLLOWUP_RULE_ENABLED", on.cfu ? "1" : "");
  vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", on.en ? "1" : "");
}

describe("lab anlama kipi = üretimin bayrakları", () => {
  it("canlı bayraklar (öğe + kural + şikâyet takibi) → kip üçünü taşır", () => {
    flags({ items: true, rules: true, cfu: true });
    expect(core.labUnderstandingMode()).toEqual({ items: true, rules: true, complaintFollowup: true, english: false });
  });

  it("bayrak yoksa temel kip (sabit 'öğe + kural' DEĞİL)", () => {
    flags({});
    expect(core.labUnderstandingMode()).toEqual({ items: false, rules: false, complaintFollowup: false, english: false });
  });

  it("🚨 rapor kimliği lab'ın GERÇEKTEN koştuğu kipi yazar (istem özeti de aynı istemden)", () => {
    for (const on of [{ items: true, rules: true, cfu: true }, { items: true }, { items: true, rules: true, en: true }, {}]) {
      flags(on);
      const m = core.labUnderstandingMode();
      expect(evalRuntime().prompts?.understandingMode).toBe(understandingModeLabel(m));
    }
  });
});

describe("önbellek anahtarı — eski koşuların kipi eski anahtarla", () => {
  it("🚨 öğe + kural (10-10 öncesi her koşu) → BİREBİR eski sürüm ve kip nesnesi", () => {
    expect(core.labUnderstandingKeyParts({ items: true, rules: true, complaintFollowup: false, english: false })).toEqual({
      version: core.UND_PROMPT_VERSION,
      mode: { items: true, rules: true },
    });
  });

  it("öğe + kural + köprü → köprü koşularının anahtarı (eski sürüm + ek özeti)", () => {
    expect(core.labUnderstandingKeyParts({ items: true, rules: true, complaintFollowup: false, english: true })).toEqual({
      version: digest([core.UND_PROMPT_VERSION, UNDERSTANDING_ENGLISH_QUERY_ADDENDUM]),
      mode: { items: true, rules: true, english: true },
    });
  });

  it("başka her kip istemin KENDİ özetiyle — şikâyet takibi açık kip eski girdiyi okumaz", () => {
    const live = { items: true, rules: true, complaintFollowup: true, english: false };
    const parts = core.labUnderstandingKeyParts(live);
    expect(parts.version).toBe(digest(understandingSystemPromptFor(live)));
    expect(parts.version).not.toBe(core.UND_PROMPT_VERSION);
    expect(parts.mode).toEqual(live);
    expect(core.labUnderstandingKeyParts({ items: true, rules: false, complaintFollowup: false, english: false }).version).not.toBe(
      core.UND_PROMPT_VERSION,
    );
  });
});

describe("bağlantı: labUnderstand modeli bayrak kipiyle ÇAĞIRIR", () => {
  it("🚨 canlı bayraklarla çağrı şikâyet takibi kipini taşır; bayraksız çağrı sabit 'öğe + kural' DEĞİL", async () => {
    // Önbellek dizini modül YÜKLENİRKEN okunur → ortam ayarlandıktan sonra modüller TAZE yüklenir (gerçek lab önbelleğine yazılmaz).
    const dir = mkdtempSync(path.join(tmpdir(), "rag-mode-"));
    try {
      vi.stubEnv("RAG_LAB_CACHE", dir);
      vi.stubEnv("RAG_LAB_OFFLINE", "");
      vi.stubEnv("RAG_LAB_RPM", "");
      vi.resetModules();
      const lab = await import("../eval/rag-lab/core");
      const cacheMod = await import("../eval/rag-lab/cache");
      expect(cacheMod.RAG_LAB_CACHE).toBe(dir);
      const spy = vi.mocked((await import("@/lib/ai/semantic/understand")).understandGuestMessages);
      const q = { id: "q", group: "single_tr", cls: "tr", lang: "tr" as const, text: "Klima çalışmıyor, ne yapalım?", answers: [] };
      flags({ items: true, rules: true, cfu: true });
      await lab.labUnderstand(q);
      expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ items: true, rules: true, complaintFollowup: true, english: false });
      flags({});
      await lab.labUnderstand({ ...q, text: "Otopark var mı?" });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ items: false, rules: false, complaintFollowup: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
