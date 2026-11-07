import { jsonOk, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { withManage } from "@/lib/route-guard";
import { backfillReservationTasks } from "@/lib/automation";

/**
 * Create the standard check-in/cleaning tasks for every existing reservation
 * that doesn't have them yet (button target). Useful for reservations imported
 * via iCal before task automation existed.
 */
export const POST = withManage(async (session) => {
  // 🚨 HIZ LİMİTİ ŞART — KALDIRMA. `backfillReservationTasks` org'un iptal
  // olmayan TÜM rezervasyonlarını `take` OLMADAN çekip her biri için 2 sorgu
  // daha koşuyor. İşlem idempotent olduğu için ikinci çağrı hiçbir şey YAZMAZ
  // ama MALİYETİ düşmez → 10.000 rezervasyonlu bir kiracı sıfır iş için
  // sınırsız kez 20.000 sorgu üretebiliyordu. Bu bir "bir kez bas" düğmesi;
  // saatte 3 fazlasıyla yeterli.
  const limited = await rateLimit(`tasks-backfill:${session.organizationId}`, 3, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  return jsonOk(await backfillReservationTasks(session.organizationId));
});
