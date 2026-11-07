import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseConfig, describeConfig, RR, CAP } from "../eval/rag-lab/config";
import { labHistory, type LabQuery } from "../eval/rag-lab/core";
import { RERANK_HOT_PATH_DEADLINE_MS, RERANK_MAX_CANDIDATES } from "@/lib/ai/semantic/rerank";
import { KB_RETRIEVAL_WIDE_CHAR_BUDGET, KB_RETRIEVAL_WIDE_MAX_CHUNKS } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// A9 #3 (09-27, kodda doğrulandı): ölçerin `prod` yapılandırması yorumunda "canlının kendisi" diyordu ama yeniden sıralayıcıda
// SORU BAŞINA ayrı çağrı dalını koşuyordu; canlıda `KB_RERANK_PER_QUESTION` kapalı → üretim ilk 20 adayı TEK çağrıda sıralar.
// Eşik de modelden bağımsız 0,4'tü (üretim large'da 0,25). `live` tabanı ürünün KENDİ bayrak okuyucularından çözülür; rapor
// her yapılandırmanın çözülmüş parametrelerini yazar.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv("OPENAI_EMBEDDING_MODEL", "");
  vi.stubEnv("KB_RERANK_PER_QUESTION", "");
  vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("`live` = canlının bayraklardan çözülmüş hâli", () => {
  it("bayraklar canlıdaki gibi (soru başına + geniş blok KAPALI): ilk 20 aday TEK çağrı, small @ 0,4, üretim tavanı", () => {
    const cfg = parseConfig("live");
    expect(cfg.semantic).toEqual({ t: 0.4, model: "text-embedding-3-small" });
    expect(cfg.understanding).toBe(true);
    expect(cfg.rerank).toEqual({ ...RR, deadlineMs: RERANK_HOT_PATH_DEADLINE_MS });
    expect(cfg.rerank?.k).toBe(RERANK_MAX_CANDIDATES);
    expect(cfg.rerank?.window).toBeUndefined(); // ölçerde pencere yok = `unionTopCandidates(lists, k)` tek çağrı (üretimin kapalı yolu)
    expect(cfg.fetchCap).toBe(CAP);
    expect(cfg.select).toBeUndefined();
    expect(describeConfig(cfg)).toContain(`ilk ${RERANK_MAX_CANDIDATES} TEK çağrı`);
    expect(describeConfig(cfg)).toContain("eşik 0.4");
  });

  it("large gömme seçilirse eşik ÜRETİMİN large eşiği (0,25) olur", () => {
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
    expect(parseConfig("live").semantic).toEqual({ t: 0.25, model: "text-embedding-3-large" });
  });

  it("soru başına bayrağı açıksa üretim penceresi; geniş blok bayrağı açıksa üretimin geniş bütçesi", () => {
    vi.stubEnv("KB_RERANK_PER_QUESTION", "1");
    vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "1");
    const cfg = parseConfig("live");
    expect(cfg.rerank?.window).toBe("prod");
    expect(cfg.select).toEqual({ budgetChars: KB_RETRIEVAL_WIDE_CHAR_BUDGET, maxChunks: KB_RETRIEVAL_WIDE_MAX_CHUNKS });
    expect(describeConfig(cfg)).toContain("soru başına çağrı");
  });

  it("KONTROL — `prod` adı anlamını KORUR (soru başına pencere; eski raporlar aynı adla yeniden üretilebilir) ve `live` ile ayrışır", () => {
    const prod = parseConfig("prod");
    expect(prod.rerank?.window).toBe("prod");
    expect(prod.semantic?.t).toBe(0.4);
    expect(describeConfig(prod)).not.toBe(describeConfig(parseConfig("live")));
  });

  it("taban üstüne belirteç uygulanır (`live+wide`, `live+lex`)", () => {
    expect(parseConfig("live+wide").select).toEqual({ budgetChars: KB_RETRIEVAL_WIDE_CHAR_BUDGET, maxChunks: KB_RETRIEVAL_WIDE_MAX_CHUNKS });
    expect(parseConfig("live+lex").semantic).toBeNull();
  });
});

describe("`phist` = üretim biçimli geçmiş (A9 #4)", () => {
  const q = (history?: LabQuery["history"]): LabQuery => ({ id: "x", group: "single_tr", cls: "p", lang: "tr", text: "Otopark var mı?", history, answers: [] });

  it("kapalıyken ESKİ biçim birebir (geçmişsiz satırda geçmiş yok → önbellek anahtarları değişmez)", () => {
    expect(labHistory(q(), false)).toBeUndefined();
    expect(labHistory(q([{ direction: "outbound", body: "Hoş geldiniz" }]), false)).toEqual([
      { direction: "outbound", body: "Hoş geldiniz" },
      { direction: "inbound", body: "Otopark var mı?" },
    ]);
  });

  it("açıkken güncel mesaj HER satırda geçmişte (üretimin kanal / öneri yolu gibi)", () => {
    expect(labHistory(q(), true)).toEqual([{ direction: "inbound", body: "Otopark var mı?" }]);
    expect(labHistory(q([{ direction: "outbound", body: "Hoş geldiniz" }]), true)).toHaveLength(2);
  });

  it("belirteç ve rapor satırı", () => {
    expect(parseConfig("live+phist").prodHistory).toBe(true);
    expect(parseConfig("live").prodHistory).toBeUndefined();
    expect(describeConfig(parseConfig("live+phist"))).toContain("geçmiş ÜRETİM biçimi");
  });
});
