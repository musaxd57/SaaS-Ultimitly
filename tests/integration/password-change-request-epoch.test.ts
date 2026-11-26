import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db";
import { prisma } from "@/lib/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// F2 (Codex 11-17) — İPTAL EDİLMİŞ OTURUMUN "KOD İSTE" İSTEĞİ YENİ KODU EZMEZ. Gerçek PostgreSQL.
//
// "Parola değiştirme kodu iste" oturum sürümünü (epoch) yalnız isteğin BAŞINDA denetliyordu; ardından bcrypt (+ parola kapısının kuyruğu)
// ve KOŞULSUZ yazma geliyordu. Arada parola sıfırlanıp (sürüm arttı) yeni cihaz bir kod istediyse, eski oturumun uçuştaki isteği o kodu
// ezip kutuya fazladan bir kod yolluyordu. Şimdi yazma başlangıçta denetlenen sürümü koşul olarak taşır (onay dalındaki U43 deseni);
// tutmazsa kuyruk satırı / e-posta ÜRETİLMEDEN 401. Araya girme ZAMANLA değil: `hashPassword` döndükten hemen sonra kurulur.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const sendReporting = vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: true }));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: (...a: unknown[]) => (sendReporting as (...x: unknown[]) => unknown)(...a) },
}));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});

/** Açıkken: bu isteğin kod hash'i üretildikten HEMEN sonra "yeni cihaz parolayı sıfırladı + kod istedi" yazılır. */
let interleave = false;
let interleaved = 0;
const NEW_DEVICE_CODE = "11112222";
let newDeviceCodeHash = "";
let userId = "";

vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  return {
    ...actual,
    hashPassword: vi.fn(async (pw: string) => {
      const out = await actual.hashPassword(pw);
      if (interleave) {
        interleave = false;
        interleaved++;
        await prisma.user.update({
          where: { id: userId },
          data: {
            sessionEpoch: 2,
            pwChangeCodeHash: newDeviceCodeHash,
            pwChangeCodeExpiresAt: new Date(Date.now() + 10 * 60_000),
            pwChangeCodeAttempts: 0,
          },
        });
      }
      return out;
    }),
  };
});

import { hashPassword } from "@/lib/auth/password";
import { POST as changePassword } from "@/app/api/account/password/route";

function requestReq() {
  return new NextRequest("http://localhost/api/account/password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.10" },
    body: JSON.stringify({ action: "request" }),
  });
}

for (const outbox of [true, false]) {
  describe(`parola değiştirme kodu isteği oturum sürümüne koşullu (F2) — kuyruk ${outbox ? "AÇIK" : "KAPALI"}`, () => {
    beforeEach(async () => {
      await resetDb();
      __resetRateLimit();
      vi.unstubAllEnvs();
      if (outbox) vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
      sendReporting.mockClear();
      interleave = false;
      interleaved = 0;
      newDeviceCodeHash = await hashPassword(NEW_DEVICE_CODE);
      const org = await prisma.organization.create({ data: { name: "Org" } });
      const user = await prisma.user.create({
        data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: await hashPassword("eski-parola-1"), role: "owner", sessionEpoch: 1, emailVerifiedAt: new Date() },
      });
      userId = user.id;
      session = { userId, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 1 };
    });

    it("🚨 istek sürerken oturum iptal edilip yeni cihaz kod istediyse: 401, yeni cihazın kodu YERİNDE, kuyruk satırı / e-posta YOK", async () => {
      interleave = true;
      const res = await changePassword(requestReq());
      expect(interleaved).toBe(1); // araya girme gerçekten kuruldu
      expect(res.status, "iptal edilmiş oturumun isteği kodu yazdı").toBe(401);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pwChangeCodeHash: true, sessionEpoch: true } });
      expect(row.pwChangeCodeHash).toBe(newDeviceCodeHash); // ezilmedi
      expect(row.sessionEpoch).toBe(2);
      expect(await prisma.emailOutbox.count({ where: { userId } })).toBe(0);
      expect(sendReporting).not.toHaveBeenCalled();
    });

    it("KONTROL — araya girme yoksa istek 200 ve kod yazılır (kuyrukta satır ya da gönderim)", async () => {
      const res = await changePassword(requestReq());
      expect(res.status).toBe(200);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pwChangeCodeHash: true } });
      expect(row.pwChangeCodeHash).not.toBeNull();
      if (outbox) expect(await prisma.emailOutbox.count({ where: { userId, kind: "pw_change_code" } })).toBe(1);
      else expect(sendReporting).toHaveBeenCalledTimes(1);
    });
  });
}
