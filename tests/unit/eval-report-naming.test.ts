import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { uniqueReportName, reviewQuote, REVIEW_QUOTE_MAX } from "../eval/sidecar";

// ---------------------------------------------------------------------------
// U16 + U22 (Codex 10-07) — ölçüm raporu yardımcıları.
//  U16: aynı gün / model ikinci koşu öncekinin raporunu ve ücretli ham yan dosyasını eziyordu.
//  U22: insan inceleme bölümü cevabı 320 karakterde İŞARETSİZ kesiyordu (sondaki tehlikeli ifade görünmüyordu).
// ---------------------------------------------------------------------------

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "eval-name-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("U16 — uniqueReportName", () => {
  it("boş klasörde ad aynen", () => {
    expect(uniqueReportName(dir, "live-pipeline-2026-10-07-gpt-5.1.md")).toBe("live-pipeline-2026-10-07-gpt-5.1.md");
  });
  it("🚨 rapor VARSA -2, o da varsa -3 (ezilmez)", () => {
    writeFileSync(path.join(dir, "r.md"), "1");
    expect(uniqueReportName(dir, "r.md")).toBe("r-2.md");
    writeFileSync(path.join(dir, "r-2.md"), "2");
    expect(uniqueReportName(dir, "r.md")).toBe("r-3.md");
  });
  it("🚨 yalnız ham yan dosya (.json) varsa da ad değişir — ücretli ham çıktı ezilmez", () => {
    writeFileSync(path.join(dir, "r.json"), "{}");
    expect(uniqueReportName(dir, "r.md")).toBe("r-2.md");
  });
});

describe("U22 — reviewQuote", () => {
  it("🚨 320 karakterden uzun cevap TAMAMEN gösterilir (sondaki ifade görünür)", () => {
    const text = `${"Merhaba, bilgiler şöyle. ".repeat(20)}Sonda: kapı kodu 4590.`;
    expect(text.length).toBeGreaterThan(320);
    const q = reviewQuote(text, "r.md");
    expect(q).toContain("kapı kodu 4590"); // ⬅️ ESKİDE 320. karakterde kesiliyordu
    expect(JSON.parse(q)).toBe(text);
  });
  it("tavanı aşan cevap AÇIK işaretle kesilir ve yan dosyayı gösterir", () => {
    const text = "a".repeat(REVIEW_QUOTE_MAX + 25);
    const q = reviewQuote(text, "live-pipeline-x.md");
    expect(q).toContain("[+25 karakter kesildi — tam metin: live-pipeline-x.json]");
  });
});
