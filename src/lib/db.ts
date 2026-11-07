import { PrismaClient } from "@prisma/client";
import { prismaLogEventSummary } from "./redact";
import { slowQueryLine, slowQueryThresholdMs } from "./db-slow-query";

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
  // Yavaş sorgu görünürlüğü (altyapı envanteri 10-21, madde 26): eşik açıksa sorgu olayı dinlenir, yalnız eşiği aşan tek satır yazılır.
  const slowMs = slowQueryThresholdMs();
  const client = new PrismaClient({
    log: slowMs > 0 ? [{ emit: "event", level: "error" }, { emit: "event", level: "query" }] : [{ emit: "event", level: "error" }],
  });
  const on = (client as unknown as { $on(event: string, cb: (e: Record<string, unknown>) => void): void }).$on.bind(client);
  on("error", (e) => {
    console.error(prismaLogEventSummary(e as { message?: unknown; target?: unknown }));
  });
  if (slowMs > 0) {
    on("query", (e) => {
      const line = slowQueryLine(e, slowMs);
      if (line) console.warn(line);
    });
  }
  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Üretimde de süreç başına TEK istemci (yatay ölçek denetimi 10-15): modül iki pakette (ör. rota + arka plan işi) ayrı yüklense bile ikinci
// bir bağlantı havuzu açılmaz. Havuz tavanı `DATABASE_URL` içindeki `connection_limit` ile verilir (Railway listesi).
globalForPrisma.prisma = prisma;
