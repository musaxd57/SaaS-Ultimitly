import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// ZAMANLAMA PARİTESİ — `request` YOLUNUN BİLİNMEYEN-E-POSTA DALI
//
// 🚨 NEDEN AYRI DOSYA: Faz 3'te (08-09) eski kod yolu kaldırıldı ve onunla
// birlikte `confirm` dalının parite pinleri de gitti. `request` dalının paritesi
// ise HÂLÂ CANLI bir korumadır ve onu pinleyen HİÇBİR test kalmıyordu — yani
// silme işlemi sessiz bir kapsam kaybı üretecekti. Codex'in kısıtı buydu:
// "verificationCode zamanlama paritesini koru ve AYRI testle pinle."
//
// Korunan şey: bilinen adres bir bcrypt hash'i + iki satır yazması yapıyor;
// bilinmeyen adres HİÇBİR ŞEY yapmazsa ölçülebilir biçimde HIZLI döner ve
// sabit-200 + genel-metin + hız-limiti üçlüsünün kurduğu enumeration koruması
// tek bir yan kanalla delinir. 08-06'da `confirm` tarafında ölçülen fark
// 362 ms'ti — ağ üzerinden önemsizce ayırt edilir.
//
// ⚠️ BU TESTLER SÜRE ÖLÇMEZ. CI'da duvar-saati ölçmek flaky olurdu; onun yerine
// YAPISAL değişmez pinlenir: parite işi kaynakta DURUYOR ve gerçekten koşuyor.
// (Deponun `forgot-password` zamanlama pinlerinde kullandığı yöntemin aynısı.)
// ---------------------------------------------------------------------------

vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});

import { POST } from "@/app/api/account/forgot-password/route";

const ROUTE = "src/app/api/account/forgot-password/route.ts";
const EMAIL = "host@example.com";

function reqFrom(body: unknown, ip: string) {
  return new Request(`http://localhost/api/account/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  }) as never;
}

/** Yorumları ELEYEREK oku. ⚠️ Eleme SATIR BAŞINA çapalanır — `//` içeren bir
 *  URL'in kalanı silinmesin (08-07'de bir pini vacuous yapan hata buydu). */
function routeCode(): string {
  return readFileSync(ROUTE, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

describe("forgot-password — request dalı zamanlama paritesi", () => {
  it("bilinmeyen-e-posta dalı bcrypt maliyeti ÖDER (`hashPassword(verificationCode())`)", () => {
    expect(routeCode()).toMatch(/hashPassword\(\s*verificationCode\(\)\s*\)/);
  });

  it("`verificationCode` HÂLÂ TANIMLI — Faz 3'te 'eski akışın parçası' diye silinmedi", () => {
    // Bu fonksiyon eski 8 haneli kod üretecinin ta kendisi ve silinmesi CAZİP
    // görünür; ama tek çağrı yeri artık parite dalıdır. Silinirse bilinmeyen dal
    // bir bcrypt kadar hızlanır.
    expect(routeCode()).toMatch(/function verificationCode\(\)/);
  });

  it("parite YAZMASI KOŞULSUZ — bilinmeyen-e-posta dalında HİÇ dallanma yok", () => {
    // 🚨 BU TEST BİR KEZ VACUOUS YAZILDI (08-09, ölçüldü). İlk hâli
    // `not.toMatch(/if \(emailOutboxEnabled\(\)\)/)` diyordu; pariteyi
    // `if (process.env.EMAIL_OUTBOX_ENABLED === "1")` ile geri kapılayan mutasyon
    // YEŞİL geçti — çünkü tarama tek bir YAZIMI arıyordu, YAPIYI değil.
    // Doğru değişmez yazımdan bağımsız: bilinmeyen-e-posta dalının gövdesinde
    // hiçbir koşul olmamalı; içindeki her satır KOŞULSUZ çalışmalı.
    const code = routeCode();
    const open = code.indexOf("if (!user) {");
    expect(open).toBeGreaterThan(-1); // çapa kayarsa test SESSİZCE no-op olmasın
    const parity = code.indexOf("__timing_parity__", open);
    expect(parity).toBeGreaterThan(open);
    const body = code.slice(open + "if (!user) {".length, parity);
    // Dal gövdesinde ikinci bir `if (` = parite koşullu hâle gelmiş demektir.
    expect(body).not.toMatch(/\bif\s*\(/);
    // Ve bcrypt maliyeti bu koşulsuz gövdenin İÇİNDE ödeniyor.
    expect(body).toMatch(/hashPassword\(\s*verificationCode\(\)\s*\)/);
  });

  it("İKİ-İŞLEMLİ anti-desen kaynakta YOK (08-06 oracle'ı geri gelmesin)", () => {
    // `verifyPassword(x, await hashPassword(x))` = hash + compare = İKİ bcrypt.
    expect(routeCode()).not.toMatch(/verifyPassword\([^)]*await hashPassword/);
  });

  describe("davranışsal: parite gerçekten KOŞUYOR", () => {
    beforeEach(async () => {
      await resetDb();
      __resetRateLimit();
      vi.clearAllMocks();
      const org = await prisma.organization.create({ data: { name: "Org" } });
      await prisma.user.create({
        data: { organizationId: org.id, name: "H", email: EMAIL, passwordHash: "old", role: "owner" },
      });
    });

    it("bilinmeyen adres 200 döner ve GÖZLENEBİLİR bir iz bırakmaz", async () => {
      const res = await POST(reqFrom({ action: "request", email: "yok@example.com" }, "4.4.4.1"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      // Parite yazması bilerek HİÇBİR satırla eşleşmeyen bir id kullanıyor →
      // maliyet ödenir, veri değişmez. Eşleşen bir id kullanılsaydı bilinmeyen
      // adres istekleri gerçek bir kullanıcının sayacını sıfırlardı.
      const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(u.pwResetCodeAttempts).toBe(0);
      expect(u.passwordHash).toBe("old");
      expect(await prisma.passwordResetChallenge.count()).toBe(0);
    });

    it("KONTROL: bilinen adres AYNI gövdeyi döner (fark yalnız yazılan satırlarda)", async () => {
      const res = await POST(reqFrom({ action: "request", email: EMAIL }, "4.4.4.2"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(await prisma.passwordResetChallenge.count()).toBe(1);
    });
  });
});
