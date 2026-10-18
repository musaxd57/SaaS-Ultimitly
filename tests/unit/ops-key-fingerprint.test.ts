import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describeKeys, fingerprint } from "../../scripts/ops-key-fingerprint.mjs";

// ---------------------------------------------------------------------------
// Anahtar parmak izi aracı (gece-4 S10-11): değer ASLA çıktıya düşmez; aynı değer aynı izi, farklı değer farklı izi verir; uygulamanın
// kaynak sırası (ENCRYPTION_KEY, yoksa AUTH_SECRET) söylenir. Test değerleri yapaydır.
// ---------------------------------------------------------------------------

const SCRIPT = path.resolve(__dirname, "../../scripts/ops-key-fingerprint.mjs");
const FAKE_KEY = "test-yapay-anahtar-1234567890-abcdefghijklmnop";
const FAKE_AUTH = "test-yapay-auth-secret-0987654321";

describe("ops-key-fingerprint", () => {
  it("parmak izi: 8 onaltılık hane, kararlı, değeri içermez; farklı değer farklı iz", () => {
    const a = fingerprint(FAKE_KEY);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint(FAKE_KEY)).toBe(a);
    expect(fingerprint(`${FAKE_KEY}x`)).not.toBe(a);
    expect(fingerprint(` ${FAKE_KEY}`)).not.toBe(a); // kırpılmaz (uygulama da kırpmaz)
  });

  it("kaynak sırası crypto-core ile aynı + boşluk uyarısı; satırlarda değer yok", () => {
    const both = describeKeys({ ENCRYPTION_KEY: FAKE_KEY, AUTH_SECRET: FAKE_AUTH }).join("\n");
    expect(both).toContain(`ENCRYPTION_KEY: parmak izi ${fingerprint(FAKE_KEY)}`);
    expect(both).toContain("Uygulama ENCRYPTION_KEY kullanır.");
    const onlyAuth = describeKeys({ AUTH_SECRET: FAKE_AUTH }).join("\n");
    expect(onlyAuth).toContain("ENCRYPTION_KEY: tanımlı değil");
    expect(onlyAuth).toContain("AUTH_SECRET'tan türetir");
    expect(describeKeys({ ENCRYPTION_KEY: `${FAKE_KEY}\n` }).join("\n")).toContain("boşluk var");
    for (const text of [both, onlyAuth]) {
      expect(text).not.toContain(FAKE_KEY);
      expect(text).not.toContain(FAKE_AUTH);
    }
  });

  it("betik olarak çalışınca (ortam ve --stdin) çıktıda değer yok", () => {
    const env = { PATH: process.env.PATH ?? "", ENCRYPTION_KEY: FAKE_KEY, AUTH_SECRET: FAKE_AUTH } as unknown as NodeJS.ProcessEnv;
    const fromEnv = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8" });
    expect(fromEnv.status).toBe(0);
    expect(fromEnv.stdout).toContain(fingerprint(FAKE_KEY));
    expect(fromEnv.stdout + fromEnv.stderr).not.toContain(FAKE_KEY);
    const fromStdin = spawnSync(process.execPath, [SCRIPT, "--stdin"], { env: { PATH: env.PATH } as unknown as NodeJS.ProcessEnv, input: `${FAKE_KEY}\n`, encoding: "utf8" });
    expect(fromStdin.status).toBe(0);
    expect(fromStdin.stdout).toContain(`parmak izi ${fingerprint(FAKE_KEY)}`);
    expect(fromStdin.stdout + fromStdin.stderr).not.toContain(FAKE_KEY);
  });
});
