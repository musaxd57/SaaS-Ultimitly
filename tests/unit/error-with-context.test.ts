import { describe, it, expect } from "vitest";
import { errorWithContext } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// HATA SARMALAYICISI Prisma özetini KORUR (10-01, 15 ajan incelemesi A12 — ölçüldü). Sarmalayıcılar `${err.message} (row …)` yazıyordu;
// yeni hatanın adı "Error" olduğu için `reportError`ın Prisma özeti devre dışı kalıyor, doğrulama hatasının argüman ağacı (misafir adı,
// mesaj gövdesi) log'a, Sentry'ye ve alarm e-postasına gidiyordu. Senkron özetleri (hospitable-sync) ve üç satır sarmalayıcısı (oto-yanıt
// nezaket kaydı, giden kuyruk, e-posta kuyruğu) artık `errorWithContext` / `formatErrorForLog` kullanır.
// ---------------------------------------------------------------------------

function prismaValidationError(): Error {
  const e = new Error(
    '\nInvalid `prisma.conversation.create()` invocation:\n\n{\n  data: {\n    guestIdentifier: "Lale Testkişi",\n    lastMessageAt: new Date("Invalid Date"),\n  }\n}\n\nInvalid value for argument `lastMessageAt`: Provided Date object is invalid.',
  );
  e.name = "PrismaClientValidationError";
  return e;
}

describe("errorWithContext", () => {
  it("🚨 Prisma doğrulama hatası: argüman ağacı (misafir adı) GEÇMEZ, yapısal özet + bağlam eki kalır", () => {
    const wrapped = errorWithContext(prismaValidationError(), " (row abc123)");
    expect(wrapped.message).not.toContain("Lale");
    expect(wrapped.message).not.toContain("guestIdentifier");
    expect(wrapped.message).toContain("PrismaClientValidationError");
    expect(wrapped.message).toContain("conversation.create");
    expect(wrapped.message.endsWith(" (row abc123)")).toBe(true);
  });

  it("KONTROL — sıradan hata: ad + ileti (redakte) + bağlam eki", () => {
    const wrapped = errorWithContext(new Error("socket hang up"), " (conversation c1)");
    expect(wrapped.message).toBe("Error: socket hang up (conversation c1)");
  });

  it("KONTROL — hata olmayan değer metne çevrilir", () => {
    expect(errorWithContext("boom", " (row r1)").message).toBe("boom (row r1)");
  });
});
