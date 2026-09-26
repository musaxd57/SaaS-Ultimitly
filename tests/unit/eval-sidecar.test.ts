import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DATA_MARKER, REPORT_MARKER, writeSidecar } from "../eval/sidecar";

// ---------------------------------------------------------------------------
// EVAL SIDECAR SÖZLEŞMESİ (09-11).
//
// `scripts/eval-compare-models.mjs` iki modeli yan yana koyarken koşuların
// çıktısını MARKDOWN'dan değil, bu yan-dosyadan okur ve dosya yolunu STDOUT'taki
// işaret satırlarından bulur. Yani işaret biçimi ile dosya adı kuralı bir
// SÖZLEŞMEDİR — sessizce değişirse kıyas betiği koşuyu bulamaz ve "eksik"
// damgasıyla döner (sahte "geçti" üretmez ama kıyas da yapılamaz).
// ---------------------------------------------------------------------------

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "eval-sidecar-"));
  dirs.push(d);
  return d;
}

describe("writeSidecar — makine-okunur koşu çıktısı", () => {
  it("markdown adının KÖKÜNÜ kullanır (.md → .json), eşleşme tahmine bırakılmaz", () => {
    const dir = tmp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const jsonPath = writeSidecar(dir, "eval-2026-09-11-120000-ab12.md", {
      suite: "qr-kb-coverage",
      version: 3,
      meta: { commit: "abc1234" },
      rows: [{ id: "E1", outcome: "ok" }],
    });
    expect(path.basename(jsonPath)).toBe("eval-2026-09-11-120000-ab12.json");
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(parsed.suite).toBe("qr-kb-coverage");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.meta.commit).toBe("abc1234");
    log.mockRestore();
  });

  it("HER İKİ yolu da stdout'a basar — koşucu dosya adı TAHMİN ETMEZ", () => {
    const dir = tmp();
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      lines.push(String(m));
    });
    writeSidecar(dir, "eval-2026-09-11.md", { suite: "s", version: 1, meta: {}, rows: [] });
    log.mockRestore();
    const report = lines.find((l) => l.startsWith(REPORT_MARKER));
    const data = lines.find((l) => l.startsWith(DATA_MARKER));
    expect(report, "REPORT işareti basılmadı").toBeTruthy();
    expect(data, "DATA işareti basılmadı").toBeTruthy();
    expect(report!.slice(REPORT_MARKER.length)).toBe(path.join(dir, "eval-2026-09-11.md"));
    expect(data!.slice(DATA_MARKER.length)).toBe(path.join(dir, "eval-2026-09-11.json"));
  });

  it("işaret metinleri kıyas betiğinin ARADIĞI metinlerle AYNI", () => {
    // ⚠️ Bu satır KAYNAK TARAMASIDIR ve tek yönlüdür (betik gerçekten koşturulmuyor);
    // amacı, iki dosyadan biri değişip diğeri unutulduğunda suit'in kırmızıya
    // düşmesi. Davranışsal yarı ↑yukarıdaki iki testtedir.
    const script = readFileSync(path.resolve(__dirname, "../../scripts/eval-compare-models.mjs"), "utf8");
    expect(script).toContain(`const DATA_MARKER = "${DATA_MARKER}"`);
    expect(script).toContain(`const REPORT_MARKER = "${REPORT_MARKER}"`);
  });
});
