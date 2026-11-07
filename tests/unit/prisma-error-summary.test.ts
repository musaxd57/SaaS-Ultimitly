import { describe, it, expect, vi, afterEach } from "vitest";
import { formatErrorForLog, prismaErrorSummary, prismaLogEventSummary } from "@/lib/redact";

vi.mock("@/lib/email-core", () => ({ emailService: { sendReporting: vi.fn(async () => ({ ok: true })) } }));
import { reportError } from "@/lib/report-error-core";

// ---------------------------------------------------------------------------
// İNCELEME AJANI b5 (09-30) — PRİSMA HATA METNİ VERİ TAŞIR: doğrulama hatası argüman ağacını (mesaj gövdesi, taslak cevap, not),
// ham sorgu hatası "Failing row contains (…)" / "Key (…)=(…)" satırını basar. Redaksiyon bu alan adlarını tanımadığı için metin log'a,
// Sentry'ye ve alarm e-postasına açık gidiyordu. Prisma hatası artık YALNIZ yapısal özetle yazılır (ad · kod · model.işlem · kısıt
// alan adları · PostgreSQL kodu); başka hatalar eskisi gibi.
// ---------------------------------------------------------------------------

function prismaError(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  const e = new Error(message);
  e.name = name;
  return Object.assign(e, extra);
}

const SECRETS = ["4455", "Lale2024", "Ayse Hanim", "ayse.yilmaz@example.com", "0555 123 45 67"];

const validation = prismaError(
  "PrismaClientValidationError",
  "\nInvalid `prisma.message.update()` invocation:\n\n{\n  where: { id: \"m1\" },\n  data: {\n    aiSuggestedReply: \"Kapi kodu 4455, Wi-Fi sifresi Lale2024. Iyi tatiller Ayse Hanim\",\n    bogus: 1\n  }\n}\n\nUnknown argument `bogus`.",
);
const unique = prismaError(
  "PrismaClientKnownRequestError",
  "\nInvalid `prisma.rateLimitCounter.create()` invocation:\n\n\nUnique constraint failed on the fields: (`key`)",
  { code: "P2002", meta: { modelName: "RateLimitCounter", target: ["key"] } },
);
const raw = prismaError(
  "PrismaClientKnownRequestError",
  "Raw query failed. Code: `23505`. Message: `Key (key)=(login-acct:ayse.yilmaz@example.com) already exists.`",
  { code: "P2010" },
);
const failingRow = prismaError(
  "PrismaClientUnknownRequestError",
  "\nInvalid `prisma.auditLog.create()` invocation:\n\nError occurred during query execution: Failing row contains (a1, {\"email\":\"ayse.yilmaz@example.com\",\"phone\":\"0555 123 45 67\"}).",
);

afterEach(() => vi.restoreAllMocks());

describe("Prisma hatası — yapısal özet (inceleme b5)", () => {
  it.each([validation, unique, raw, failingRow])("🚨 formatErrorForLog veri taşımaz: %#", (err) => {
    const line = formatErrorForLog(err);
    for (const s of SECRETS) expect([s, line.includes(s)]).toEqual([s, false]);
    expect(line.startsWith(err.name)).toBe(true);
  });

  it("özet hata ayıklamaya yeter: işlem, kod, kısıt alanları, PostgreSQL kodu", () => {
    expect(prismaErrorSummary(validation)).toBe("PrismaClientValidationError message.update");
    expect(prismaErrorSummary(unique)).toBe("PrismaClientKnownRequestError P2002 rateLimitCounter.create target=key unique_violation");
    expect(prismaErrorSummary(raw)).toBe("PrismaClientKnownRequestError P2010 pg=23505");
    expect(prismaErrorSummary(failingRow)).toBe("PrismaClientUnknownRequestError auditLog.create");
  });

  it("🚨 nedeni Prisma hatası olan hata da özetlenir", () => {
    const wrapped = new Error("kayıt yazılamadı", { cause: validation });
    const line = formatErrorForLog(wrapped);
    expect(line).toContain("cause: PrismaClientValidationError message.update");
    for (const s of SECRETS) expect(line.includes(s)).toBe(false);
  });

  it("🚨 reportError: log satırı özet + yığın çerçeveleri; veri yok", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportError("test.ctx", failingRow);
    const out = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("PrismaClientUnknownRequestError auditLog.create");
    expect(out).toMatch(/\s+at /);
    for (const s of SECRETS) expect([s, out.includes(s)]).toEqual([s, false]);
  });

  it("🚨 Prisma'nın kendi hata olayı: ileti YAZILMAZ, yalnız özet", () => {
    const line = prismaLogEventSummary({ message: failingRow.message, target: "quaint::connector::metrics" });
    expect(line).toBe("prisma:error target=quaint::connector::metrics auditLog.create");
    for (const s of SECRETS) expect(line.includes(s)).toBe(false);
    expect(prismaLogEventSummary({ message: raw.message })).toBe("prisma:error pg=23505");
  });

  it("KONTROL — Prisma dışı hata eskisi gibi (ad + ileti, redakte)", () => {
    expect(prismaErrorSummary(new Error("x"))).toBeNull();
    expect(formatErrorForLog(new TypeError("boom 42"))).toBe("TypeError: boom 42");
    const fake = new Error("Invalid `prisma.x.y()` invocation");
    fake.name = "PrismaLookalike";
    expect(prismaErrorSummary(fake)).toBeNull();
  });
});
