import { describe, it, expect } from "vitest";
import { contextDiagnostics } from "@/lib/ai/context-diagnostics";
import { selectHistoryForPrompt } from "@/lib/ai/prompts";
import { aiGenerationRow } from "@/lib/ai/generation-trace";

// ---------------------------------------------------------------------------
// BAĞLAM KURUCU TANISI (kurucu talimatı 2026-09-07, bağlam sözleşmesi madde 11): kimlik / sayı / zaman — METİN YOK; seçimi değiştirmez;
// güvenlik penceresi tavana takıldığında (kaydırma saldırısı) bekleyen sayısı pencereden BÜYÜK görünür.
// ---------------------------------------------------------------------------

type Msg = { id: string; createdAt: Date; direction: "inbound" | "outbound"; body: string; author?: string };
const t0 = Date.parse("2026-10-12T08:00:00Z");
const msg = (i: number, direction: "inbound" | "outbound", body = `mesaj ${i}`, author?: string): Msg => ({
  id: `cmsg${String(i).padStart(4, "0")}`,
  createdAt: new Date(t0 + i * 60_000),
  direction,
  body,
  author: author ?? (direction === "inbound" ? "guest" : "host"),
});

describe("bağlam kurucu tanısı", () => {
  it("kısa konuşma: hepsi dahil, kimlikler kronolojik, en eski an, karakter toplamı, bekleyen = son cevaptan sonraki misafir mesajları", () => {
    const h = [msg(1, "inbound", "Merhaba"), msg(2, "outbound", "Hoş geldiniz"), msg(3, "inbound", "Wi-Fi?"), msg(4, "inbound", "Bir de havlu")];
    const sel = selectHistoryForPrompt(h);
    const d = contextDiagnostics(h, sel);
    expect(d).toEqual({
      v: 1,
      includedIds: ["cmsg0001", "cmsg0002", "cmsg0003", "cmsg0004"],
      includedCount: 4,
      omittedCount: 0,
      oldestIncludedAt: new Date(t0 + 60_000).toISOString(),
      totalChars: "Merhaba".length + "Hoş geldiniz".length + "Wi-Fi?".length + "Bir de havlu".length,
      pendingCount: 2,
      pendingIncludedCount: 2,
      olderMemoryUsed: false,
    });
  });

  it("🚨 kaydırma saldırısı: 30 cevapsız misafir mesajı → tavan 25 girer, tanı bekleyen 30 / dahil 25 gösterir (pencere taşması görünür)", () => {
    const h = Array.from({ length: 30 }, (_, i) => msg(i + 1, "inbound"));
    const d = contextDiagnostics(h, selectHistoryForPrompt(h));
    expect(d).toMatchObject({ includedCount: 25, omittedCount: 5, pendingCount: 30, pendingIncludedCount: 25 });
  });

  it("otomatik şablon mesajı bekleyen pencereyi KAPATMAZ (operatif cevap değil)", () => {
    const h = [msg(1, "inbound"), msg(2, "outbound", "Hoş geldiniz!", "automation"), msg(3, "inbound")];
    expect(contextDiagnostics(h, selectHistoryForPrompt(h)).pendingCount).toBe(2);
  });

  it("METİN taşımaz; kimlik biçimine uymayan değer yazılmaz; seçim değişmez", () => {
    const h = [msg(1, "inbound", "Adım Ayşe Yılmaz, telefonum 05551112233"), { ...msg(2, "inbound"), id: "Ayşe Yılmaz" }];
    const sel = selectHistoryForPrompt(h);
    const before = sel.map((m) => m.id);
    const d = contextDiagnostics(h, sel);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/Ayşe|Yılmaz|0555/);
    expect(d.includedIds).toEqual(["cmsg0001"]);
    expect(sel.map((m) => m.id)).toEqual(before);
  });
});

describe("üretim izi satırı — tanı + araç özeti", () => {
  const base = {
    organizationId: "org1",
    conversationId: "conv1",
    surface: "channel_auto" as const,
    model: "m",
    promptVersion: "p1",
    decision: "auto_sent" as const,
  };
  it("araç özeti yalnız kapalı alanlar (değer / kapsam YAZILMAZ); sözleşme sürümü en büyük araç sürümü", () => {
    const row = aiGenerationRow({
      ...base,
      toolResults: [
        { tool: "availability", toolVersion: 2, status: "ok", reasons: ["fresh_source"], asOf: "2026-10-12T08:00:00.000Z", value: { nights: 3 }, scope: { organizationId: "org1", propertyId: "p" } } as never,
        { tool: "extension", toolVersion: 1, status: "stale", reasons: [], asOf: "2026-10-12T08:00:00.000Z" },
      ],
    })!;
    const tools = JSON.parse(row.toolResultsJson!);
    expect(tools).toEqual([
      { tool: "availability", toolVersion: 2, status: "ok", reasons: ["fresh_source"], asOf: "2026-10-12T08:00:00.000Z" },
      { tool: "extension", toolVersion: 1, status: "stale", reasons: [], asOf: "2026-10-12T08:00:00.000Z" },
    ]);
    expect(row.toolResultsJson).not.toMatch(/nights|org1|propertyId/);
    // Gerekçe kapalı küme kodu değilse izde YER ALMAZ (tipte değil burada zorlanır).
    const free = aiGenerationRow({
      ...base,
      toolResults: [{ tool: "availability.check", toolVersion: 3, status: "ok", reasons: ["fresh_source", "Ayşe Yılmaz aradı", "05551112233"], asOf: "2026-10-12T08:00:00.000Z" }],
    })!;
    expect(JSON.parse(free.toolResultsJson!)[0].reasons).toEqual(["fresh_source"]);
    expect(row.toolContractVersion).toBe(2);
  });

  it("araç yok → null; tanı tavanı aşarsa YAZILMAZ (kırpılmış JSON yanıltır)", () => {
    expect(aiGenerationRow({ ...base, toolResults: [] })).toMatchObject({ toolResultsJson: null, toolContractVersion: null, contextDiagnosticsJson: null });
    const huge = { v: 1 as const, includedIds: Array.from({ length: 2_000 }, (_, i) => `cmsg${i}xxxxx`), includedCount: 0, omittedCount: 0, oldestIncludedAt: null, totalChars: 0, pendingCount: 0, pendingIncludedCount: 0, olderMemoryUsed: false };
    expect(aiGenerationRow({ ...base, contextDiagnostics: huge })!.contextDiagnosticsJson).toBeNull();
  });
});
