import "server-only";

import { currentCorrelation, newCorrelationId, runWithCorrelation } from "./correlation";
import { logEvent } from "./event-log";
import { reportError as reportErrorCore, type ReportOutcome } from "./report-error-core";

// Server-only marker over the pure implementation (crypto.ts precedent).
// The FULL reporter — redaction, Sentry envelope client, email leg, throttle —
// lives in report-error-core.ts so operator scripts (tsx, where "server-only"
// doesn't resolve) can exercise the REAL code path end to end. App code
// imports THIS path. One implementation, nothing duplicated.
export * from "./report-error-core";

/**
 * Uygulamanın hata raporlayıcısı = çekirdek + TAKİP NUMARASI + olay günlüğü (kurucu kararı 10-10). Süren işlem yoksa (zamanlanmış iş,
 * arka plan) bu hata için yeni numara açılır: log satırı, Sentry etiketi, alarm e-postası ve olay günlüğü satırı AYNI numarayı taşır →
 * e-postadaki numarayla operatör ekranında arama. Asla fırlatmaz (çekirdek gibi).
 */
export async function reportError(context: string, err: unknown): Promise<ReportOutcome> {
  const run = async () => {
    const outcome = await reportErrorCore(context, err);
    // Bağlam adı koddan gelir; olay günlüğünün kod biçimine indirgenir (boşluk → "-"), biçime uymazsa alan düşer.
    await logEvent("error.reported", { context: context.replace(/\s+/g, "-").slice(0, 64) });
    return outcome;
  };
  return currentCorrelation() ? run() : runWithCorrelation({ id: newCorrelationId(), organizationId: null }, run);
}
