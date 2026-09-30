import { PrismaClient } from "@prisma/client";
import { prismaLogEventSummary } from "./redact";

// Prevent multiple Prisma instances during dev hot-reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * 🚨 Üretimde Prisma'nın kendi hata kaydedicisi (`log: ["error"]`) başarısız sorgunun TAM iletisini — argüman ağacı, "Failing row
 * contains (…)", "Key (…)=(…)" — redaksiyonsuz stdout'a basıyordu (inceleme b5, 09-30; misafir e-postası / telefonu / kapı kodu
 * Railway loglarında). Artık hata OLAY olarak alınır ve yalnız yapısal özet yazılır (`prismaLogEventSummary`: model.işlem, kod,
 * kısıt türü — ileti yok). Hatanın kendisi çağırana fırlatılmaya devam eder; çağıranın `reportError` / `formatErrorForLog`u da
 * aynı özeti kullanır. Geliştirmede ayrıntı gerekir → eski kaydedici.
 */
function createPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "development") return new PrismaClient({ log: ["error", "warn"] });
  const client = new PrismaClient({ log: [{ emit: "event", level: "error" }] });
  (client as unknown as { $on(event: "error", cb: (e: { message?: unknown; target?: unknown }) => void): void }).$on("error", (e) => {
    console.error(prismaLogEventSummary(e));
  });
  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
