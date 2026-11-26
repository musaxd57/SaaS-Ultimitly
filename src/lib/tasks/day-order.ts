// ---------------------------------------------------------------------------
// TEMİZLİK GÜN SIRASI ÖNERİSİ (plan madde 10-A, kurucu 11-25; tasarım `docs/TASARIM-2026-11-25-temizlikci-gun-sirasi-ve-ay-sayimi.md`).
// Saf kural (DB yok). Yalnız ÖNERİ: hiçbir görevin saati / ataması / durumu değişmez; yalnız yöneticinin Girişler sayfasında görünür.
//
// Sıra: ① o gün girişi olan VE erken giriş isteği (bekleyen) ya da onayı olan daire ② o gün girişi olan öteki daire ③ o gün girişi olmayan
// (yalnız çıkış) daire. Grup içinde giriş saati erken olan önce, saati bilinmeyen grubun sonunda. Eşitlikte daire adı, sonra görev kimliği
// (kararlı: girdi sırası sonucu değiştirmez). "Erken giriş" yalnız YAPILI kayıttan gelir (`DecisionRequest`), kelime okunmaz.
// ---------------------------------------------------------------------------

/** Erken giriş kaydı: onaylanmış karar ya da ev sahibinin kararını bekleyen istek. */
export type EarlyMark = "approved" | "requested" | null;

export interface CleaningJob {
  taskId: string;
  propertyName: string;
  /** Görevin vadesinin işletme takvimindeki günü (YYYY-MM-DD). */
  dayKey: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Aynı dairede AYNI gün başlayan konaklama; yoksa `null` (yalnız çıkış temizliği). */
  arrival: { checkInTime: string | null; early: EarlyMark } | null;
}

export interface DayOrderGroup {
  dayKey: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Önerilen sırayla (en az iki iş). */
  jobs: CleaningJob[];
}

function rank(j: CleaningJob): number {
  if (!j.arrival) return 2;
  return j.arrival.early ? 0 : 1;
}

/** Saati bilinmeyen grubun sonunda ("HH:MM" sözlük sırası = saat sırası). */
const timeKey = (j: CleaningJob): string => j.arrival?.checkInTime ?? "99:99";

const cmpText = (a: string, b: string): number => a.localeCompare(b, "tr");
const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareJobs(a: CleaningJob, b: CleaningJob): number {
  return (
    rank(a) - rank(b) ||
    cmpId(timeKey(a), timeKey(b)) ||
    cmpText(a.propertyName, b.propertyName) ||
    cmpId(a.taskId, b.taskId)
  );
}

/** Bir kişinin bir gündeki işleri, önerilen sırayla (girdi değişmez). */
export function orderDayJobs(jobs: readonly CleaningJob[]): CleaningJob[] {
  return [...jobs].sort(compareJobs);
}

/**
 * (gün, atanan kişi) grupları; yalnız EN AZ İKİ işi olan grup döner (tek iş → sıra numarası gürültüdür). Gruplar güne, sonra kişi adına göre;
 * atanmamış işler o günün sonunda kendi grubunda.
 */
export function cleaningDayOrderGroups(jobs: readonly CleaningJob[]): DayOrderGroup[] {
  const byKey = new Map<string, DayOrderGroup>();
  for (const j of jobs) {
    const key = `${j.dayKey}\u0000${j.assigneeId ?? ""}`;
    const g = byKey.get(key) ?? { dayKey: j.dayKey, assigneeId: j.assigneeId, assigneeName: j.assigneeName, jobs: [] };
    g.jobs.push(j);
    byKey.set(key, g);
  }
  return [...byKey.values()]
    .filter((g) => g.jobs.length >= 2)
    .map((g) => ({ ...g, jobs: orderDayJobs(g.jobs) }))
    .sort(
      (a, b) =>
        cmpId(a.dayKey, b.dayKey) ||
        Number(a.assigneeId === null) - Number(b.assigneeId === null) ||
        cmpText(a.assigneeName ?? "", b.assigneeName ?? "") ||
        cmpId(a.assigneeId ?? "", b.assigneeId ?? ""),
    );
}
