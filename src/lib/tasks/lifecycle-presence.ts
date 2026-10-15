// ---------------------------------------------------------------------------
// YAŞAM DÖNGÜSÜ GÖREVİ "ZATEN VAR MI?" KURALI (kurucu D7, 10-15) — `createReservationTasks` ile görevler sayfasındaki "Eksik görevleri
// oluştur (N)" sayısı AYNI kararı versin diye tek yerde (saf, veritabanısız).
//
// Kurucu (aynen): "Ara temizlik sözü veya manuel temizlik, otomatik çıkış temizliğini engellemesin; mevcut söz görevi korunsun. Ancak
// tamamlanmış sistem görevi yalnız aynı rezervasyonun aynı çıkış temizliğiyse tekrar oluşturmayı engellesin. Çıkış tarihi sonradan
// değişmişse eski tamamlanmış işi otomatik olarak yeni tarihin temizliği sayma."
//
// Kural: tür T (giriş hazırlığı → giriş günü, çıkış temizliği → çıkış günü) için görev "var" sayılır ⇔ rezervasyonda
//   · SİSTEMİN açtığı (origin "system") ve BİTMEMİŞ bir T görevi var (ev sahibi tarihini elle taşımış olsa bile — o görev budur), ya da
//   · SİSTEMİN açtığı, BİTMİŞ bir T görevi var ve vadesi rezervasyonun ŞİMDİKİ hedef günüyle AYNI takvim günü.
// Elle açılmış görev (manual), söz görevi (manual) ve mesajdan açılan görev (ai) HİÇBİR ZAMAN "var" saymaz.
// ---------------------------------------------------------------------------
import { calendarDateOf } from "@/modules/availability/core";

export type LifecycleType = "checkin_prep" | "cleaning";

export type LifecycleTaskLite = { type: string; origin: string; status: string; dueAt: Date | null };

/** Saf: rezervasyonun bu türden yaşam döngüsü görevi zaten var mı (yukarıdaki kural). */
export function lifecycleTaskPresent(
  type: LifecycleType,
  target: Date,
  tasks: readonly LifecycleTaskLite[],
  timeZone: string,
): boolean {
  const targetDay = calendarDateOf(target, timeZone).key;
  return tasks.some(
    (t) =>
      t.type === type &&
      t.origin === "system" &&
      (t.status !== "done" || (t.dueAt !== null && calendarDateOf(t.dueAt, timeZone).key === targetDay)),
  );
}

/** Görev okuması için seçim (iki çağıran aynı alanları okur). */
export const LIFECYCLE_TASK_LITE_SELECT = { type: true, origin: true, status: true, dueAt: true } as const;
