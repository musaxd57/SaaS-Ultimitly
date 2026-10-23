import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// E-posta konu satırı TEK satır (gece güvenlik denetimi 09-28). Konuya misafirin görünen adı / mesajı girer; iCal `\n` kaçışı
// ve sağlayıcı adı gerçek satır sonu taşıyabilir. İki gönderim yolu (Resend HTTP, SMTP) aynı noktadan geçer; satır sonu ve
// diğer denetim karakterleri boşluğa iner. Normal konu birebir aynı.
// ---------------------------------------------------------------------------

const sendMail = vi.fn(async (_opts: Record<string, unknown>) => ({}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
  createTransport: () => ({ sendMail }),
}));

import { emailService, singleLineSubject } from "@/lib/email-core";

const HOSTILE = "Yeni mesaj: Ada\r\nBcc: saldirgan@example.com\u2028X-Test: 1";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sendMail.mockClear();
});

describe("konu satırı tek satır", () => {
  it("saf: satır sonu / NEL / U+2028 / sekme boşluğa iner; normal konu aynen", () => {
    expect(singleLineSubject(HOSTILE)).toBe("Yeni mesaj: Ada Bcc: saldirgan@example.com X-Test: 1");
    expect(singleLineSubject("a\u0085b\tc")).toBe("a b c");
    const normal = "Şikâyet: Lale 7 — misafir “Ayşe” yazdı";
    expect(singleLineSubject(normal)).toBe(normal);
  });

  it("🚨 Resend yolu: sağlayıcıya giden konu satır sonu taşımaz", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await emailService.sendReporting("host@example.com", HOSTILE, "<p>x</p>");
    expect(out.ok).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { subject: string };
    expect(body.subject).not.toMatch(/[\r\n\u2028]/);
    expect(body.subject).toBe(singleLineSubject(HOSTILE));
  });

  it("🚨 SMTP yolu: sendMail'e giden konu satır sonu taşımaz", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_HOST", "smtp.example.com");
    const out = await emailService.sendReporting("host@example.com", HOSTILE, "<p>x</p>");
    expect(out.ok).toBe(true);
    const subject = (sendMail.mock.calls[0]?.[0] as { subject: string }).subject;
    expect(subject).not.toMatch(/[\r\n\u2028]/);
    expect(subject).toBe(singleLineSubject(HOSTILE));
  });
});

describe("15 ajan A13 — yön denetimi ve vekil çift", () => {
  it("🚨 konu satırında yön denetim karakterleri düşer (misafir adındaki U+202E konuyu tersine çeviremez); normal metin aynen", () => {
    expect(singleLineSubject("Şikâyet: ‮atsed nilxuL‬ — Lale 7")).toBe("Şikâyet: atsed nilxuL — Lale 7");
    expect(singleLineSubject("a⁦b⁩c‏d؜e")).toBe("abcde");
    expect(singleLineSubject("Misafir “Ayşe” 👍")).toBe("Misafir “Ayşe” 👍");
  });
});
