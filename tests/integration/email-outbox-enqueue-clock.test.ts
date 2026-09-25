import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { enqueueIdentityEmail, drainEmailOutboxOnce } from "@/lib/email-outbox";

// ---------------------------------------------------------------------------
// E-POSTA KUYRUĞU VADE KAPISI TEK SAAT (ENQUEUE_CLOCK, 09-25 — mesaj kuyruğundaki CI #1170 ile AYNI kök neden).
// Drain `"nextAttemptAt" <= now` kıyasını KENDİ (JS) saatiyle yapar; enqueue ise `nextAttemptAt`i şema varsayılanına
// (`@default(now())`) bırakıyordu — başka bir saat, timestamp(3)'e YUVARLANIR. JS saati milisaniyeye TABANLANIR →
// enqueue'dan hemen sonra koşan drain (rotaların gönderim tetiği) yeni satırı "vadesi gelmedi" görüp alamıyordu;
// kimlik e-postası bir sonraki 15 sn'lik tura kalıyordu, testte ise rastgele kırmızı = atlanan yayın.
// Belirlenimci sınama: JS saati 5 sn GERİDE (yalnız `Date` sahte; Prisma'nın zamanlayıcılarına dokunulmaz).
// Aynı dosya, düzeltmenin mail kaybı / çift gönderim / yeniden deneme / sürüm (idempotency) davranışını
// DEĞİŞTİRMEDİĞİNİ aynı sahte saat altında sınar.
// ---------------------------------------------------------------------------
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));

type SendFn = (to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;
const okSend = () => vi.fn<SendFn>(async () => ({ ok: true }));
const failSend = () => vi.fn<SendFn>(async () => ({ ok: false, error: "HTTP 500" }));

async function makeUser() {
  const org = await prisma.organization.create({ data: { name: "Clock Org" } });
  return prisma.user.create({ data: { organizationId: org.id, name: "Umut", email: "u@x.com", passwordHash: "x", role: "owner" } });
}

/** Rotaların sözleşmesi: hash ve kuyruk satırı AYNI işlemde. */
async function enqueueCode(userId: string, secret: string) {
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { pwChangeCodeHash: `hash-of-${secret}`, pwChangeCodeExpiresAt: expiresAt, pwChangeCodeAttempts: 0 },
    });
    return enqueueIdentityEmail(tx, { userId, kind: "pw_change_code", secret, recipient: "u@x.com", expiresAt });
  });
}

/** JS saati veritabanının 5 sn gerisinde (donmuş). */
function jsClockBehind() {
  const real = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(real - 5_000));
}

const rowOf = (id: string) => prisma.emailOutbox.findUniqueOrThrow({ where: { id } });

describe("e-posta kuyruğu vade kapısı — enqueue ile drain aynı saat", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("🚨 KÖK NEDEN: yeni satırın vadesi drain'in kıyasladığı saatle damgalanır (şema varsayılanının saatiyle DEĞİL)", async () => {
    const u = await makeUser();
    jsClockBehind();
    const id = await enqueueCode(u.id, "12345678");
    // Saat donmuş: enqueue anındaki JS saati = şimdi. Şema varsayılanıyla damgalanan satır ~5 sn ileride çıkar.
    expect((await rowOf(id)).nextAttemptAt.getTime()).toBe(Date.now());
  });

  it("🚨 BELİRTİ: enqueue'dan hemen sonra koşan drain (gönderim tetiği) kimlik e-postasını teslim eder", async () => {
    const u = await makeUser();
    jsClockBehind();
    const id = await enqueueCode(u.id, "12345678");
    const send = okSend();
    const out = await drainEmailOutboxOnce({ send });
    expect(out).toMatchObject({ claimed: 1, sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toContain("12345678");
    expect(await rowOf(id)).toMatchObject({ status: "sent", payloadEnc: null });
  });

  it("ÇİFT GÖNDERİM YOK: hemen koşan iki paralel drain satırı TAM BİR kez teslim eder", async () => {
    const u = await makeUser();
    jsClockBehind();
    const id = await enqueueCode(u.id, "12345678");
    const send = okSend();
    await Promise.all([drainEmailOutboxOnce({ send }), drainEmailOutboxOnce({ send })]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await rowOf(id)).toMatchObject({ status: "sent" });
  });

  it("YENİDEN DENEME: sağlayıcı hatası bekleme süresini korur — hemen koşan drain yeniden GÖNDERMEZ, süre dolunca gönderir", async () => {
    const u = await makeUser();
    jsClockBehind();
    const id = await enqueueCode(u.id, "12345678");
    const fail = failSend();
    expect(await drainEmailOutboxOnce({ send: fail })).toMatchObject({ claimed: 1, retried: 1 });
    const pending = await rowOf(id);
    expect(pending).toMatchObject({ status: "pending", attemptCount: 1 });
    expect(pending.payloadEnc).toBeTruthy(); // yeniden denenecek → sır korunur (mail kaybı yok)
    expect(pending.nextAttemptAt.getTime()).toBe(Date.now() + 60_000); // ilk bekleme 1 dk, drain'in saatiyle

    const send = okSend();
    expect(await drainEmailOutboxOnce({ send })).toMatchObject({ claimed: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();

    const afterBackoff = new Date(Date.now() + 61_000);
    expect(await drainEmailOutboxOnce({ send, now: () => afterBackoff })).toMatchObject({ claimed: 1, sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await rowOf(id)).toMatchObject({ status: "sent", attemptCount: 1 });
  });

  it("SÜRÜM (idempotency): yeni istek eski nesli iptal eder; yalnız YENİ kod bir kez gider", async () => {
    const u = await makeUser();
    jsClockBehind();
    const first = await enqueueCode(u.id, "11111111");
    const second = await enqueueCode(u.id, "22222222");
    expect(await rowOf(first)).toMatchObject({ status: "canceled", version: 1, payloadEnc: null });
    expect(await rowOf(second)).toMatchObject({ status: "pending", version: 2 });

    const send = okSend();
    expect(await drainEmailOutboxOnce({ send })).toMatchObject({ claimed: 1, sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toContain("22222222");
    expect(send.mock.calls[0][2]).not.toContain("11111111");
  });

  it("SÜRESİ DOLAN SIR hâlâ asla gitmez (vade kapısı süre kapısını gevşetmez)", async () => {
    const u = await makeUser();
    jsClockBehind();
    const id = await enqueueCode(u.id, "12345678");
    const send = okSend();
    const pastExpiry = new Date(Date.now() + 10 * 60_000 + 1_000);
    expect(await drainEmailOutboxOnce({ send, now: () => pastExpiry })).toMatchObject({ claimed: 0, canceled: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(await rowOf(id)).toMatchObject({ status: "canceled", payloadEnc: null });
  });
});
