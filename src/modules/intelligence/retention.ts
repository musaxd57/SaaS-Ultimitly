import "server-only";

import { prisma } from "@/lib/db";

// KVKK veri sınıfı (değişmez 14): misafir mesajından türeyen sinyal = "guest-derived" sınıfı →
// misafir verisiyle AYNI saklama süresi (DATA_RETENTION_MONTHS); süre dolunca PURGE (anonimleştirme
// değil — satırda PII yok, ama türetildiği veri artık yok). Rezervasyon kaynaklı sinyaller ve
// KB/insan hafızası mülkün kendi operasyon kaydıdır, saklanır. Erasure (m.11): satır SetNull ile
// kalır (PII taşımaz); mülk silinince cascade.
export async function purgeExpiredSignals(cutoff: Date): Promise<{ deleted: number }> {
  const r = await prisma.signal.deleteMany({ where: { source: "guest_message", occurredAt: { lt: cutoff } } });
  return { deleted: r.count };
}
