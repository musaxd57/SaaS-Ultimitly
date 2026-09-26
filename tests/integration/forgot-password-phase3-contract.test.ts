import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// FAZ 3 SÖZLEŞMESİ — ESKİ KOD YOLU GERİ GELEMEZ
//
// Faz 3 (08-09) `pwResetCode*` tabanlı sıfırlama yolunu kaldırdı. Kaldırma iki
// fail-closed kapıdan sonra yapıldı (Codex): taze prod smoke `via="challenge"`
// ve `EmailOutbox` kind='pw_reset_code' → pending/claimed/sending = 0.
//
// Bu dosya İKİ YÖNÜ birden pinler:
//   (A) BAYRAK VARSAYIMI KALKTI — `PASSWORD_RESET_CHALLENGE_ENABLED` artık
//       hiçbir davranışı değiştirmiyor. Değeri ne olursa olsun challenge yolu
//       koşar. (Eskiden bayrak kapalıyken eski yol devreye giriyordu; o dalın
//       geri gelmediğini kanıtlayan tek şey budur.)
//   (B) ESKİ YOLA DÖNÜŞ ENGELLİ — rota `pwResetCode*` kolonlarına DOKUNMUYOR ve
//       `pw_reset_code` outbox türü artık YOK.
//
// ⚠️ Kolonlar şemada DURUYOR (Faz 4 ayrı karar) — yani "kolon yok" diye bir
// koruma yok; koruma, rotanın onlara yazmamasıdır ve bu ancak testle tutulur.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});

import { POST } from "@/app/api/account/forgot-password/route";

const ROUTE = "src/app/api/account/forgot-password/route.ts";
const OUTBOX = "src/lib/email-outbox.ts";

/** `KINDS` setindeki tür adları. ⚠️ Kaynaktan okunuyor çünkü `KINDS` bilinçli
 *  olarak DIŞA AÇIK DEĞİL — yalnız test görsün diye üretim API'si genişletilmez
 *  (kardeşi `email-outbox-kind-parity.test.ts` de aynı yöntemi kullanıyor). */
function outboxKinds(): string[] {
  const src = readFileSync(OUTBOX, "utf8");
  const m = /const KINDS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(src);
  expect(m, "KINDS seti bulunamadı").toBeTruthy();
  return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}
const EMAIL = "host@example.com";

function reqFrom(body: unknown, ip: string) {
  return new Request("http://localhost/api/account/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  }) as never;
}

function routeSrc(): string {
  return readFileSync(ROUTE, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

describe("Faz 3 — bayrak varsayımı kalktı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "H", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  // Üç env durumu da AYNI sonucu vermeli. Eski yolu geri getiren bir değişiklik
  // neredeyse kesinlikle bayrağı yeniden okumakla başlar; o an bu üçlü ayrışır.
  for (const [label, value] of [
    ["bayrak SET DEĞİL", undefined],
    ["bayrak = 0", "0"],
    ["bayrak = 1", "1"],
  ] as const) {
    it(`${label} → challenge satırı yazılır, pwResetCode* DOKUNULMAZ`, async () => {
      if (value === undefined) vi.stubEnv("PASSWORD_RESET_CHALLENGE_ENABLED", "");
      else vi.stubEnv("PASSWORD_RESET_CHALLENGE_ENABLED", value);

      const res = await POST(reqFrom({ action: "request", email: EMAIL }, `5.5.${value ?? 0}.1`));
      expect(res.status).toBe(200);

      expect(await prisma.passwordResetChallenge.count()).toBe(1);
      const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      // 🚨 ASIL İDDİA: eski kolonlar BOŞ kaldı. Bayrak kapalıyken eski yol
      // dönseydi `pwResetCodeHash` dolardı ve bu satır kırmızı olurdu.
      expect(u.pwResetCodeHash).toBeNull();
      expect(u.pwResetCodeExpiresAt).toBeNull();
    });
  }

  it("bayrak adı kaynakta HİÇ GEÇMİYOR (ölü env okuması kalmadı)", () => {
    expect(routeSrc()).not.toMatch(/PASSWORD_RESET_CHALLENGE_ENABLED/);
  });
});

describe("Faz 3 — eski yola dönüş engelli", () => {
  it("rota `pwResetCode*` kolonlarının hiçbirine YAZMIYOR", () => {
    const src = routeSrc();
    // Tek izinli geçiş: parite yazmasının hiçbir satırla eşleşmeyen id'si.
    // (`data: { pwResetCodeAttempts: 0 }` — `where: { id: "__timing_parity__" }`)
    const parity = src.indexOf("__timing_parity__");
    expect(parity).toBeGreaterThan(-1);
    const withoutParity = src.slice(0, parity) + src.slice(parity + 400);
    expect(withoutParity).not.toMatch(/pwResetCodeHash/);
    expect(withoutParity).not.toMatch(/pwResetCodeExpiresAt/);
  });

  it("`pw_reset_code` outbox türü ARTIK YOK", () => {
    const kinds = outboxKinds();
    expect(kinds).not.toContain("pw_reset_code");
    // KONTROL: liste boşalmadı — bu olmadan "her şeyi sil" mutasyonu yeşil geçerdi.
    expect(kinds).toContain("pw_reset_challenge");
    expect(kinds).toContain("pw_change_code");
  });

  it("rota linksiz 'yalnız kod' e-postasını ARTIK ÜRETMİYOR", () => {
    // `resetCodeEmailHtml` kaldırıldı; sıfırlamanın tek şablonu bağlantı+kod.
    expect(routeSrc()).not.toMatch(/resetCodeEmailHtml/);
    expect(routeSrc()).toMatch(/pw_reset_challenge/);
  });

  it("rota artık ESKİ kod doğrulamasını yapmıyor (bcrypt compare yok)", () => {
    // Eski confirm dalı `verifyPassword(code, codeHash)` koşuyordu. Challenge
    // yolunda kod doğrulaması `verifyChallenge` içinde ve tokenHash'e bağlı.
    expect(routeSrc()).not.toMatch(/verifyPassword\(/);
    expect(routeSrc()).toMatch(/verifyChallenge\(/);
  });

  it("HESAP başına confirm kovası geri gelmedi (`forgot-confirm:` yok)", () => {
    // m47'nin kapattığı delik tam buydu: bütçe hesaba bağlıyken saldırgan
    // kurbanın adresiyle onu yakabiliyordu. Bütçe artık challenge SATIRINDA.
    expect(routeSrc()).not.toMatch(/forgot-confirm:/);
    // KONTROL: rotanın diğer iki kovası DURUYOR.
    // (09-23: kova anahtarı IPv6 /64'e indirgeyen `rateLimitClientKey`ten gelir.)
    expect(routeSrc()).toMatch(/forgot:\$\{rateLimitClientKey\(req\)\}/);
    expect(routeSrc()).toMatch(/forgot-req:\$\{email\}/);
  });
});
