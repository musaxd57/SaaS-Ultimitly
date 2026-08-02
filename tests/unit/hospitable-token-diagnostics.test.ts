import { describe, it, expect, vi } from "vitest";
import { createCipheriv, randomBytes, scryptSync } from "crypto";
import { encryptSecret } from "@/lib/crypto-core";
import {
  classifyCiphertext,
  decryptsUnderKey,
  diagnoseHospitableTokens,
  verdictFor,
  type TokenDiagnostics,
} from "@/lib/hospitable-token-diagnostics-core";

// ---------------------------------------------------------------------------
// Teşhis aracı PROD'a karşı burada çalıştırılamaz (ne DB ne ağ erişimi var).
// Tek güvence bu testler: aracın SAYDIĞI şey doğru mu, SIR sızdırıyor mu,
// ve YAZIYOR mu.
// ---------------------------------------------------------------------------

// Test ortamında ENCRYPTION_KEY set DEĞİL → crypto-core `AUTH_SECRET`'e düşer
// (vitest.config.ts). Kutu paritesi pini bu değere dayanır.
const ENV_SECRET = "test-secret-min-16-characters-long";
const OTHER_SECRET = "bambaska-bir-anahtar-degeri-123456";

/** Farklı bir anahtarla v1 kutusu üret (auth_failed üretmenin dürüst yolu). */
function encryptUnder(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", scryptSync(secret, "lixus-secret-box-v1", 32), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

function fakeDb(orgRows: { a: string | null; r: string | null }[], twoFaRows: string[]) {
  const organization = { findMany: vi.fn(async () => orgRows.map((o) => ({ hospitableTokenEnc: o.a, hospitableRefreshTokenEnc: o.r }))) };
  const user = { findMany: vi.fn(async () => twoFaRows.map((s) => ({ twoFactorSecret: s }))) };
  // ⚠️ Yazma metotları BİLEREK YOK: araç bir şey yazmaya kalkarsa test "is not a
  // function" ile patlar. "Salt-okuma" iddiası böylece yapısal olarak pinlenir.
  return { organization, user } as never;
}

describe("hospitable token teşhisi", () => {
  // ── Kutu paritesi (SÜRÜKLENME PİNİ) ──────────────────────────────────────
  it("yerel alternatif-anahtar kutusu crypto-core ile AYNI anahtarı türetir", () => {
    const payload = encryptSecret("gizli-deger");
    // Aynı ham sır → aynı anahtar → açılmalı. SALT/ALG sürüklenirse bu düşer.
    expect(decryptsUnderKey(payload, ENV_SECRET)).toBe(true);
    // Farklı sır → açılmamalı (aksi hâlde sonda her şeyi "açıldı" sayardı).
    expect(decryptsUnderKey(payload, OTHER_SECRET)).toBe(false);
  });

  // ── Sınıflandırma ────────────────────────────────────────────────────────
  it("üç durumu ayırır: ok · auth_failed · malformed", () => {
    expect(classifyCiphertext(encryptSecret("x"))).toBe("ok");
    // Başka anahtarla yazılmış = prod'da görülen "unable to authenticate data".
    expect(classifyCiphertext(encryptUnder("x", OTHER_SECRET))).toBe("auth_failed");
    for (const bad of ["", "duz-metin", "v2.a.b.c", "v1.a.b"]) {
      expect(classifyCiphertext(bad)).toBe("malformed");
    }
  });

  // ── Sayım + alternatif anahtar sondası ───────────────────────────────────
  it("alanları ayrı sayar ve alternatif anahtarla açılanları işaretler", async () => {
    const good = encryptSecret("iyi");
    const foreign = encryptUnder("yabanci", OTHER_SECRET);
    const d = await diagnoseHospitableTokens(
      fakeDb(
        [
          { a: good, r: good },
          { a: foreign, r: null }, // bozuk erişim token'ı, refresh YOK
          { a: null, r: null }, // hiç bağlanmamış org
        ],
        [good],
      ),
      OTHER_SECRET,
    );

    expect(d.organizations).toBe(3);
    expect(d.accessToken).toMatchObject({ present: 2, ok: 1, authFailed: 1, malformed: 0, okUnderAltKey: 1 });
    expect(d.refreshToken).toMatchObject({ present: 1, ok: 1, authFailed: 0 });
    expect(d.twoFactorSecret).toMatchObject({ present: 1, ok: 1, authFailed: 0 });
    expect(d.altKeyTried).toBe(true);
  });

  it("alternatif anahtar verilmezse hipotez sondası HİÇ koşmaz", async () => {
    const d = await diagnoseHospitableTokens(fakeDb([{ a: encryptUnder("x", OTHER_SECRET), r: null }], []));
    expect(d.accessToken.authFailed).toBe(1);
    expect(d.accessToken.okUnderAltKey).toBe(0);
    expect(d.altKeyTried).toBe(false);
  });

  // ── 🚨 SIR SIZDIRMAZ ─────────────────────────────────────────────────────
  it("dönen yapının TÜM yaprakları sayı/boolean — sır taşıyacak alan YOK", async () => {
    const secretText = "cok-gizli-token-degeri";
    const d = await diagnoseHospitableTokens(
      fakeDb([{ a: encryptSecret(secretText), r: encryptUnder(secretText, OTHER_SECRET) }], []),
      OTHER_SECRET,
    );
    // Ayrıştırılmış yapı üzerinden gezilir — `JSON.stringify(...).toContain(...)`
    // DEĞİL: o assertion kaçışlama yüzünden boş yere geçebilir (08-01 dersi).
    const leaves: unknown[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === "object") Object.values(v).forEach(walk);
      else leaves.push(v);
    };
    walk(d);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) expect(["number", "boolean"]).toContain(typeof leaf);
  });

  // ── Hüküm ────────────────────────────────────────────────────────────────
  const counts = (ok: number, authFailed = 0, malformed = 0) => ({
    present: ok + authFailed + malformed,
    ok,
    authFailed,
    malformed,
    okUnderAltKey: 0,
  });
  const diag = (a: number[], r: number[], t: number[]): TokenDiagnostics => ({
    organizations: 1,
    accessToken: counts(a[0], a[1], a[2]),
    refreshToken: counts(r[0], r[1], r[2]),
    twoFactorSecret: counts(t[0], t[1], t[2]),
    altKeyTried: false,
  });

  it.each([
    ["hepsi açılıyor → clean", diag([2, 0, 0], [2, 0, 0], [1, 0, 0]), "clean"],
    ["hiçbiri açılmıyor → genel anahtar uyuşmazlığı", diag([0, 2, 0], [0, 2, 0], [0, 1, 0]), "global_key_mismatch"],
    ["bazısı açılıyor → izole", diag([1, 1, 0], [1, 0, 0], [1, 0, 0]), "isolated"],
    // ⚠️ Şifreli hiç değer yoksa "temiz" DEMEZ: ölçecek şey olmaması, sorun
    // olmamasıyla aynı şey değildir ve öyle raporlamak yanıltıcı olurdu.
    ["hiç şifreli değer yok → ölçülemedi", diag([0, 0, 0], [0, 0, 0], [0, 0, 0]), "inconclusive"],
    // Yalnız BAŞKA bir alanda başarı olması bile anahtarın doğru olduğunu kanıtlar.
    ["tek başarı 2FA'da bile olsa izole sayılır", diag([0, 1, 0], [0, 1, 0], [1, 0, 0]), "isolated"],
    // Biçim bozukluğu da hatadır — sessizce "temiz" sayılmamalı.
    ["yalnız biçim bozuk satır → izole", diag([1, 0, 1], [0, 0, 0], [0, 0, 0]), "isolated"],
  ])("%s", (_name, d, expected) => {
    expect(verdictFor(d as TokenDiagnostics)).toBe(expected);
  });
});
