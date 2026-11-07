import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isCloudContainer, recoverDecision } from "../../scripts/env-recover.mjs";

// ---------------------------------------------------------------------------
// `npm run env:recover` yıkıcıdır (`git reset --hard`). CLAUDE.md: "reset --hard YALNIZ
// bu konteynerde; operatörün klonunda ASLA" — 09-23'e kadar bu kural yalnız METİNDİ.
// ---------------------------------------------------------------------------

describe("env:recover — yalnız bulut konteynerinde", () => {
  it("🚨 yerel makine (işaret yok) → REDDEDİLİR", () => {
    expect(isCloudContainer({}, () => false)).toBe(false);
    expect(isCloudContainer({ CI: "1", HOME: "C:\\\\Users\\\\x" }, () => false)).toBe(false);
  });

  it("bulut konteyneri işaretlerinden biri yeterli", () => {
    expect(isCloudContainer({ CCR_AGENT_PROXY_ENABLED: "1" }, () => false)).toBe(true);
    expect(isCloudContainer({}, (p: string) => p === "/root/.ccr")).toBe(true);
  });

  it("package.json komutu ÇIPLAK `reset --hard` DEĞİL, korumalı betiği çağırır", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.scripts["env:recover"]).toBe("node scripts/env-recover.mjs");
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/reset --hard/);
  });

  it("🚨 KONTEYNERDE BİLE kirli ağaçta REDDEDİLİR (09-23: tam bu yoldan ~30 dosyalık iş silindi)", () => {
    expect(recoverDecision({ container: true, porcelain: " M src/lib/x.ts\n", force: false })).toEqual({
      ok: false,
      reason: "dirty_tree",
    });
    expect(recoverDecision({ container: true, porcelain: "?? yeni-dosya.ts\n", force: false }).ok).toBe(false);
    expect(recoverDecision({ container: false, porcelain: "", force: true })).toEqual({ ok: false, reason: "not_container" });
  });

  it("temiz ağaç ya da bilinçli --force → izin", () => {
    expect(recoverDecision({ container: true, porcelain: "", force: false })).toEqual({ ok: true });
    expect(recoverDecision({ container: true, porcelain: " M a.ts\n", force: true })).toEqual({ ok: true });
  });
});
