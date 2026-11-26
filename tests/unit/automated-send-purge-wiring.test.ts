import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// K7 (09-30): otomatik mesaj gönderim izleri (metin taşımasa da) süresiz tutulmaz — zamanlanmış senkronun saatlik bakımına
// bağlı olmalı. Davranış `automated-message-echo` testinde (14 gün sınırı); burada yalnız BAĞLANTI pinlenir.
// ---------------------------------------------------------------------------

describe("otomatik mesaj izi silme — saatlik bakıma bağlı", () => {
  it("scheduled-sync saatlik işlerinde purgeAutomatedSends çağrılır", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/scheduled-sync.ts"), "utf8");
    expect(src).toMatch(/await hourly\("automated-send-purge",[^\n]*purgeAutomatedSends\(prisma\)\)/);
    expect(src.indexOf('import { purgeAutomatedSends } from "@/lib/automated-sends";')).toBeGreaterThan(-1);
  });
});
