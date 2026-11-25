import type { Prisma, PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// İŞLEM İSTEMCİSİNE ARAYA GİRME (yalnız test; 11-25). Genel Prisma temsilcisine kurulan casus İŞLEM istemcisinin (`tx`) çağrısını görmez
// (CLAUDE.md "Çalışma dersleri", 11-04): bir yazım etkileşimli işleme taşınınca eski casuslar sessizce boşa düşer — test yeşil kalır ama
// artık hiçbir şeyi sınamaz (ölçüldü: abonelik yazımı işleme alınınca üç yarış testinden ikisi kancası hiç çalışmadan yeşildi).
// Bu yardımcı `prisma.$transaction`ı sarar: etkileşimli işlemin geri çağrısına verilen `tx`in seçilen model işlemini `around` ile değiştirir.
// Dizi biçimli `$transaction([...])` olduğu gibi geçer. Dönen fonksiyon özgün `$transaction`ı geri koyar.
// ---------------------------------------------------------------------------

type Around = (real: (args: unknown) => Promise<unknown>, args: unknown) => Promise<unknown>;

export function interceptTxOperation(prisma: PrismaClient, model: string, operation: string, around: Around): () => void {
  const client = prisma as unknown as { $transaction: (...a: unknown[]) => Promise<unknown> };
  const original = client.$transaction;
  const bound = original.bind(prisma);
  client.$transaction = (arg: unknown, ...rest: unknown[]) => {
    if (typeof arg !== "function") return bound(arg, ...rest);
    const callback = arg as (tx: Prisma.TransactionClient) => Promise<unknown>;
    return bound((tx: Prisma.TransactionClient) => {
      const delegate = (tx as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[model];
      const patchedDelegate = new Proxy(delegate, {
        get(target, prop, receiver) {
          if (prop !== operation) return Reflect.get(target, prop, receiver);
          return (args: unknown) => around((a) => target[operation]!(a), args);
        },
      });
      const patchedTx = new Proxy(tx as object, {
        get(target, prop, receiver) {
          return prop === model ? patchedDelegate : Reflect.get(target, prop, receiver);
        },
      }) as Prisma.TransactionClient;
      return callback(patchedTx);
    }, ...rest);
  };
  return () => {
    client.$transaction = original;
  };
}
